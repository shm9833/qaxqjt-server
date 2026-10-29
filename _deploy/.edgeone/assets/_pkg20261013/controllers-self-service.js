/**
 * src/controllers/self-service.js —— 员工自助服务控制器
 * 1. 员工登录（身份证号 + 手机号后6位）→ JWT
 * 2. 打卡签到（GPS 定位）
 * 3. 个人信息查看
 * 4. 工资条查询
 * 5. 兑账核对 + 工资发放确认（含签名）
 */
const { nanoid } = require('nanoid');
const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');
const { success, pagedSuccess, parsePage } = require('../utils/response');
const { idByCtx, nowMs, env } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const punchParams = require('../services/punch-params');
const perfWindow = require('../services/perf-ops-window');

// 员工自助专用 access token：30 天长效（手机打卡场景免频繁重登），
// 仍使用同一 JWT 密钥/issuer/audience，role='performer' 限定只能访问本人数据
const PERFORMER_TTL_DAY = 30;
const signPerformerToken = payload =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: `${PERFORMER_TTL_DAY}d`
  });

// 员工登录限流：同 IP 10 分钟内最多 20 次失败（手机号后6位仅百万组合，防枚举爆破）
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 20;
const _loginFails = new Map(); // ip -> { count, resetAt }
function _loginLimited(ip) {
  const now = Date.now();
  const rec = _loginFails.get(ip);
  if (!rec || rec.resetAt < now) {
    _loginFails.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  rec.count++;
  return rec.count > LOGIN_MAX_FAILS;
}
function _loginFailClear(ip) {
  _loginFails.delete(ip);
}

// 统一鉴权：未登录 401，非员工角色 403
const requirePerformer = user => {
  if (!user) throw new BusinessError('UNAUTHORIZED', '请先登录');
  if (user.role !== 'performer') throw new BusinessError('FORBIDDEN', '仅限员工自助使用');
  return user;
};

// 东八区当天 YYYY-MM-DD + 当日起止 UTC 时间
const cnTodayRange = () => {
  const ymd = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const start = new Date(ymd + 'T00:00:00Z');
  return { ymd, start, end: new Date(start.getTime() + 24 * 3600 * 1000) };
};

// ========== 1. 员工登录（身份证号 + 手机号后6位） ==========
const login = async ctx => {
  const { idCardNo, phoneSuffix } = ctx.request.body;
  if (!idCardNo || !/^\d{17}[\dX]$/.test(idCardNo)) {
    throw new BusinessError('VALIDATION_ERROR', '身份证号格式不正确（18位）');
  }
  if (!phoneSuffix || !/^\d{6}$/.test(phoneSuffix)) {
    throw new BusinessError('VALIDATION_ERROR', '请输入手机号后6位');
  }
  if (_loginLimited(ctx.ip)) {
    throw new BusinessError('RATE_LIMITED', '尝试过于频繁，请 10 分钟后再试');
  }

  // 查找已审核通过且在职的演职人员
  const perf = await prisma.performersDbV1.findFirst({
    where: {
      idCardNo: idCardNo.toUpperCase(),
      status: 'active',
      reviewStatus: 'approved',
      phone: { endsWith: phoneSuffix }
    }
  });
  if (!perf) {
    // 诊断查询：凭身份证号+手机号后6位（本人凭证）给出可操作的明确提示，
    // 避免被退回/审核中人员看到笼统的"身份信息不匹配"而不知如何重填 Fix-20261011d
    const diag = await prisma.performersDbV1.findFirst({
      where: { idCardNo: idCardNo.toUpperCase(), phone: { endsWith: phoneSuffix } },
      orderBy: { updatedAt: 'desc' },
      select: { status: true, reviewStatus: true }
    });
    if (diag) {
      if (diag.reviewStatus === 'rejected') {
        throw new BusinessError('UNAUTHORIZED', '您的入职登记已被退回，请打开入职登记页修改资料后重新提交');
      }
      if (diag.reviewStatus === 'expired' || diag.status === 'deleted') {
        throw new BusinessError('UNAUTHORIZED', '您的入职登记已过期，请重新打开入职登记页提交');
      }
      if (diag.reviewStatus === 'pending') {
        throw new BusinessError('UNAUTHORIZED', '您的入职登记正在审核中，请耐心等待管理员审核');
      }
      if (diag.status === 'disabled') {
        throw new BusinessError('UNAUTHORIZED', '账号已停用，请联系管理员');
      }
    }
    throw new BusinessError('UNAUTHORIZED', '身份信息不匹配、账号未启用或审核未通过，请前往入职登记页核对已有信息或相似信息，确认补充正确后提交审核');
  }

  _loginFailClear(ctx.ip);

  // 构造员工自助 JWT（role = performer，长效 30 天，仅可访问本人数据）
  const payload = {
    sub: perf.id,
    username: perf.idCardNo,
    role: 'performer',
    realName: perf.name
  };
  const accessToken = signPerformerToken(payload);

  // 记录登录时间戳
  await prisma.performersDbV1.update({
    where: { id: perf.id },
    data: { ts: BigInt(nowMs()) }
  });

  return success(ctx, {
    accessToken,
    tokenType: 'Bearer',
    expiresInDay: PERFORMER_TTL_DAY,
    user: {
      id: perf.id,
      name: perf.name,
      staffNo: perf.staffNo,
      idCardNo: perf.idCardNo,
      phone: perf.phone,
      primaryRole: perf.primaryRole,
      rankGrade: perf.rankGrade,
      dailyRate: perf.dailyRate ? Number(perf.dailyRate) : null,
      avatarUrl: perf.avatarUrl
    }
  });
};

// ========== 2. 个人信息 ==========
const profile = async ctx => {
  requirePerformer(ctx.state.user);
  const perf = await prisma.performersDbV1.findUnique({
    where: { id: ctx.state.user.sub }
  });
  if (!perf) throw new BusinessError('NOT_FOUND', '员工信息不存在');

  return success(ctx, {
    id: perf.id,
    name: perf.name,
    staffNo: perf.staffNo,
    gender: perf.gender,
    idCardNo: perf.idCardNo,
    phone: perf.phone,
    primaryRole: perf.primaryRole,
    rankGrade: perf.rankGrade,
    dailyRate: perf.dailyRate ? Number(perf.dailyRate) : null,
    transportType: perf.transportType,
    bankAccount: perf.bankAccount,
    bankName: perf.bankName,
    hireDate: perf.hireDate ? perf.hireDate.toISOString().slice(0, 10) : null,
    employmentType: perf.employmentType,
    status: perf.status,
    avatarUrl: perf.avatarUrl,
    regulationsConfirmed: perf.regulationsConfirmed,
    reviewStatus: perf.reviewStatus
  });
};

// ========== 3. 打卡签到（GPS 定位） ==========
const punch = async ctx => {
  const user = requirePerformer(ctx.state.user);
  // v20261013 演出操作时限：演出正式开始后开放，结束后24小时自动关闭（连场自动续接）
  const w = await perfWindow.computeWindow();
  if (!w.opsOpen) {
    throw new BusinessError('FORBIDDEN', `当前不在演出开放时段内，打卡通道已关闭（演出正式开始后开放，结束后${w.params.closeHoursAfter}小时自动关闭）` + (w.nextOpenDate ? '；下次开放：' + w.nextOpenDate + ' 起' : ''));
  }
  const { punchType, gpsLatitude, gpsLongitude, gpsAddress } = ctx.request.body;
  if (!punchType || !['in', 'out'].includes(punchType)) {
    throw new BusinessError('VALIDATION_ERROR', '打卡类型必填（in=上班/out=下班）');
  }
  // GPS 定位必填（用户要求打卡必须带定位）
  if (gpsLatitude == null || gpsLongitude == null
      || isNaN(Number(gpsLatitude)) || isNaN(Number(gpsLongitude))
      || Number(gpsLatitude) === 0 && Number(gpsLongitude) === 0) {
    throw new BusinessError('VALIDATION_ERROR', '打卡需要 GPS 定位，请在浏览器提示中允许获取位置');
  }
  const lat = Number(gpsLatitude), lng = Number(gpsLongitude);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new BusinessError('VALIDATION_ERROR', 'GPS 坐标不合法');
  }

  // 取东八区当天日期
  const { ymd: today, start: dayStart, end: dayEnd } = cnTodayRange();

  // 查当天是否已打过该类型卡
  const existing = await prisma.employeePunchV1.findFirst({
    where: {
      performerId: user.sub,
      punchDate: { gte: dayStart, lt: dayEnd },
      punchType
    }
  });
  if (existing) {
    throw new BusinessError('CONFLICT', '今天已经打过' + (punchType === 'in' ? '上班' : '下班') + '卡了');
  }

  // v20261012 打卡新规：日场基准 13:30 / 晚场基准 19:30（可在管理端改），
  // 迟到 1 元/分（单场封顶 30 元，≥30 分本场失效）；装台/卸台日不计迟到不计罚款
  const P = await punchParams.getPunchParams();
  let status = 'normal';
  let sessionType = '';
  let lateMinutes = 0, lateFine = 0, showInvalid = false;
  let autoRemark = null;

  // 装台/卸台日判定：当日考勤已录 stage_in/stage_out → 不计迟到不计罚款不计薪
  const stageAtt = await prisma.attendanceV1.findFirst({
    where: { staffId: user.sub, attendanceDate: dayStart, attendanceType: { in: punchParams.STAGE_TYPES } },
    select: { attendanceType: true }
  });

  const mins = punchParams.cnMinutesNow();
  if (stageAtt) {
    sessionType = 'stage';
    autoRemark = '装台/卸台日：不计薪资、不计迟到、不计奖励';
  } else {
    sessionType = punchParams.sessionForMinutes(mins, P);
    if (punchType === 'in') {
      const r = punchParams.computeLateResult(mins, sessionType, P);
      lateMinutes = r.lateMinutes; lateFine = r.fine; showInvalid = r.invalid;
      status = r.status;
      const sText = sessionType === 'night' ? '晚场' : '日场';
      if (r.status === 'late') {
        autoRemark = `迟到${r.lateMinutes}分钟，罚款${r.fine}元（${sText}·${P.lateFinePerMin}元/分钟，单场上限${P.lateFineCap}元）`;
      } else if (r.status === 'late_invalid') {
        autoRemark = `迟到${r.lateMinutes}分钟（满${P.lateInvalidMinutes}分钟）本场失效，罚款${r.fine}元`;
      }
    }
    // 下班卡：新规未定义晚场下班基准，不自动判早退，一律记正常
  }

  const rec = await prisma.employeePunchV1.create({
    data: {
      id: idByCtx('punch', 12, nanoid),
      performerId: user.sub,
      punchDate: dayStart,
      punchType,
      gpsLatitude: lat,
      gpsLongitude: lng,
      gpsAddress: gpsAddress || null,
      status,
      remark: autoRemark,
      ts: BigInt(nowMs())
    }
  });

  return success(ctx, {
    id: rec.id,
    punchDate: today,
    punchType,
    punchTime: rec.punchTime.toISOString(),
    status,
    sessionType,
    lateMinutes,
    lateFine,
    showInvalid,
    gpsLatitude: lat,
    gpsLongitude: lng,
    gpsAddress: rec.gpsAddress,
    remark: rec.remark
  });
};

// 打卡记录行补全：按打卡时间推场次/迟到分钟/罚款（v20261012 新规口径，与打卡时计算一致）
const _enrichPunchRow = (r, P) => {
  let sessionType = '';
  let lateMinutes = 0, lateFine = 0, showInvalid = r.status === 'late_invalid';
  if (r.status === 'late' || r.status === 'late_invalid' || r.status === 'normal') {
    const mins = punchParams.cnMinutesFromUtcDate(r.punchTime);
    sessionType = punchParams.sessionForMinutes(mins, P);
    if (r.punchType === 'in') {
      const calc = punchParams.computeLateResult(mins, sessionType, P);
      lateMinutes = calc.lateMinutes;
      lateFine = calc.fine;
      showInvalid = showInvalid || calc.invalid;
    }
  }
  return {
    id: r.id,
    punchDate: r.punchDate.toISOString().slice(0, 10),
    punchType: r.punchType,
    punchTime: r.punchTime.toISOString(),
    status: r.status,
    statusText: r.status === 'late_invalid' ? '本场失效' : (r.status === 'late' ? '迟到' : (r.status === 'early' ? '早退' : '正常')),
    sessionType,
    lateMinutes,
    lateFine,
    showInvalid,
    gpsLatitude: r.gpsLatitude != null ? Number(r.gpsLatitude) : null,
    gpsLongitude: r.gpsLongitude != null ? Number(r.gpsLongitude) : null,
    gpsAddress: r.gpsAddress,
    remark: r.remark
  };
};

const punchList = async ctx => {
  const user = requirePerformer(ctx.state.user);
  const { page, pageSize, skip, take } = parsePage(ctx.query);
  const month = (ctx.query.month || '').trim(); // YYYY-MM 格式

  const where = { performerId: user.sub };
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    where.punchDate = { gte: start, lt: end };
  }

  const P = await punchParams.getPunchParams();
  const [rows, total] = await Promise.all([
    prisma.employeePunchV1.findMany({ where, orderBy: [{ punchDate: 'desc' }, { punchTime: 'desc' }], skip, take }),
    prisma.employeePunchV1.count({ where })
  ]);

  return pagedSuccess(ctx, rows.map(r => _enrichPunchRow(r, P)), total, page, pageSize);
};

// ========== 3b. 本人考勤记录（装台/卸台/事故分级等管理侧登记，员工可查看） ==========
const attListSelf = async ctx => {
  const user = requirePerformer(ctx.state.user);
  const { page, pageSize, skip, take } = parsePage(ctx.query);
  const month = (ctx.query.month || '').trim(); // YYYY-MM
  const where = { staffId: user.sub };
  if (month && /^\d{4}-\d{2}$/.test(month)) where.attendanceMonth = month;
  const [rows, total] = await Promise.all([
    prisma.attendanceV1.findMany({ where, orderBy: [{ attendanceDate: 'desc' }], skip, take }),
    prisma.attendanceV1.count({ where })
  ]);
  return pagedSuccess(ctx, rows.map(r => ({
    id: r.id,
    date: r.attendanceDate ? new Date(r.attendanceDate).toISOString().slice(0, 10) : '',
    type: r.attendanceType || '',
    typeText: punchParams.ATT_TYPE_TEXT[r.attendanceType] || r.attendanceType || '',
    remark: r.remark || ''
  })), total, page, pageSize);
};

// ========== 4. 工资条查询（仅返回已发布的工资条） ==========
const wageList = async ctx => {
  const user = requirePerformer(ctx.state.user);
  const { page, pageSize, skip, take } = parsePage(ctx.query);
  const month = (ctx.query.month || '').trim();

  const where = { performerId: user.sub, payslipPublished: true };
  if (month) {
    // 工资批次关联查询：先查 wage_batches_v1 中该月份的 batchIds
    const batches = await prisma.wageBatchesV1.findMany({
      where: { wageMonth: month },
      select: { id: true }
    });
    if (batches.length) {
      where.batchId = { in: batches.map(b => b.id) };
    } else {
      // 无匹配批次，返回空
      return pagedSuccess(ctx, [], 0, page, pageSize);
    }
  }

  const [items, total] = await Promise.all([
    prisma.wageItemsV1.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take,
      include: { batch: true }
    }),
    prisma.wageItemsV1.count({ where })
  ]);

  // 批量查确认状态
  const wageIds = items.map(i => i.id);
  const confirmations = await prisma.wageConfirmationV1.findMany({
    where: { wageItemId: { in: wageIds } }
  });
  const confMap = new Map(confirmations.map(c => [c.wageItemId + ':' + c.confirmType, c]));

  const data = items.map(it => {
    const receipt = confMap.get(it.id + ':receipt');
    const check = confMap.get(it.id + ':check');
    return {
      id: it.id,
      batchNo: it.batch?.batchNo || '',
      wageMonth: it.batch?.wageMonth || '',
      performerName: it.performerName,
      staffNo: it.staffNo,
      rankGrade: it.rankGrade,
      attendanceDays: it.attendanceDays ? Number(it.attendanceDays) : null,
      baseWage: it.baseWage ? Number(it.baseWage) : 0,
      chiefRoleTotal: it.chiefRoleTotal ? Number(it.chiefRoleTotal) : 0,
      supportingRoleTotal: it.supportingRoleTotal ? Number(it.supportingRoleTotal) : 0,
      nightShowBonus: it.nightShowBonus ? Number(it.nightShowBonus) : 0,
      holidayBonus: it.holidayBonus ? Number(it.holidayBonus) : 0,
      transportAllowance: it.transportAllowance ? Number(it.transportAllowance) : 0,
      mealAllowance: it.mealAllowance ? Number(it.mealAllowance) : 0,
      fullAttendanceBonus: it.fullAttendanceBonus ? Number(it.fullAttendanceBonus) : 0,
      performanceBonus: it.performanceBonus ? Number(it.performanceBonus) : 0,
      otherAllowance: it.otherAllowance ? Number(it.otherAllowance) : 0,
      socialInsuranceDeduct: it.socialInsuranceDeduct ? Number(it.socialInsuranceDeduct) : 0,
      housingFundDeduct: it.housingFundDeduct ? Number(it.housingFundDeduct) : 0,
      taxDeduct: it.taxDeduct ? Number(it.taxDeduct) : 0,
      otherDeduction: it.otherDeduction ? Number(it.otherDeduction) : 0,
      grossPay: it.grossPay ? Number(it.grossPay) : 0,
      totalDeduction: it.totalDeduction ? Number(it.totalDeduction) : 0,
      netPay: it.netPay ? Number(it.netPay) : 0,
      remark: it.remark,
      receiptStatus: receipt ? receipt.confirmStatus : 'pending',
      checkStatus: check ? check.confirmStatus : 'pending',
      createdAt: it.createdAt.toISOString()
    };
  });

  return pagedSuccess(ctx, data, total, page, pageSize);
};

// ========== 5. 兑账核对确认 + 工资发放确认（工资确认必须手写签名） ==========
const wageConfirm = async ctx => {
  const user = requirePerformer(ctx.state.user);
  // v20261013 演出操作时限：与打卡同一窗口（演出开始后开放，结束后24小时关闭）
  const w = await perfWindow.computeWindow();
  if (!w.opsOpen) {
    throw new BusinessError('FORBIDDEN', `当前不在演出开放时段内，确认通道已关闭（演出正式开始后开放，结束后${w.params.closeHoursAfter}小时自动关闭）` + (w.nextOpenDate ? '；下次开放：' + w.nextOpenDate + ' 起' : ''));
  }
  const { wageItemId, confirmType, confirmStatus, signature, remark } = ctx.request.body;
  if (!wageItemId) throw new BusinessError('VALIDATION_ERROR', 'wageItemId 必填');
  if (!confirmType || !['receipt', 'check'].includes(confirmType)) {
    throw new BusinessError('VALIDATION_ERROR', 'confirmType 必填（receipt=工资确认/check=兑账核对）');
  }
  if (!confirmStatus || !['confirmed', 'rejected'].includes(confirmStatus)) {
    throw new BusinessError('VALIDATION_ERROR', 'confirmStatus 必填（confirmed/rejected）');
  }
  // 工资"已收到"确认必须携带手写签名；兑账核对确认不强制签名；有异议(remark)建议填写说明
  if (confirmType === 'receipt' && confirmStatus === 'confirmed') {
    if (!signature || typeof signature !== 'string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(signature)) {
      throw new BusinessError('VALIDATION_ERROR', '工资发放确认需要手写签名，请先在签名框签字');
    }
    if (signature.length > 600 * 1024) {
      throw new BusinessError('VALIDATION_ERROR', '签名图片过大，请重新签名');
    }
  }

  // 校验工资条归属 + 必须已发布
  const item = await prisma.wageItemsV1.findFirst({
    where: { id: wageItemId, performerId: user.sub, payslipPublished: true }
  });
  if (!item) throw new BusinessError('NOT_FOUND', '工资条不存在、未发布或无权限');

  // upsert 确认记录
  const data = {
    confirmStatus,
    signature: signature || null,
    remark: remark || null,
    confirmedAt: new Date(),
    ts: BigInt(nowMs())
  };

  const existing = await prisma.wageConfirmationV1.findUnique({
    where: { wageItemId_confirmType: { wageItemId, confirmType } }
  });

  let rec;
  if (existing) {
    rec = await prisma.wageConfirmationV1.update({
      where: { id: existing.id },
      data
    });
  } else {
    rec = await prisma.wageConfirmationV1.create({
      data: {
        id: idByCtx('wc', 12, nanoid),
        wageItemId,
        performerId: user.sub,
        confirmType,
        ...data
      }
    });
  }

  return success(ctx, {
    id: rec.id,
    wageItemId,
    confirmType,
    confirmStatus: rec.confirmStatus,
    confirmedAt: rec.confirmedAt ? rec.confirmedAt.toISOString() : null,
    signature: rec.signature ? !!rec.signature : false
  });
};

// ========== 6. 今日打卡状态（快捷查询） ==========
const todayPunchStatus = async ctx => {
  const user = requirePerformer(ctx.state.user);
  const { ymd: today, start: dayStart, end: dayEnd } = cnTodayRange();

  const punches = await prisma.employeePunchV1.findMany({
    where: {
      performerId: user.sub,
      punchDate: { gte: dayStart, lt: dayEnd }
    },
    orderBy: { punchTime: 'asc' }
  });

  // v20261012：附带当前打卡规则参数（员工端展示窗口/罚款口径）+ 逐条补全场次/迟到分钟/罚款
  const P = await punchParams.getPunchParams();
  return success(ctx, {
    date: today,
    hasIn: punches.some(p => p.punchType === 'in'),
    hasOut: punches.some(p => p.punchType === 'out'),
    params: {
      dayWindowStart: P.dayWindowStart, dayWindowEnd: P.dayWindowEnd, dayBaseline: P.dayBaseline,
      nightWindowStart: P.nightWindowStart, nightWindowEnd: P.nightWindowEnd, nightBaseline: P.nightBaseline,
      lateFinePerMin: P.lateFinePerMin, lateFineCap: P.lateFineCap, lateInvalidMinutes: P.lateInvalidMinutes,
      rewardEnabled: P.rewardEnabled, stageDayNoPay: P.stageDayNoPay,
      accidentLevel1Fine: P.accidentLevel1Fine, accidentLevel2Fine: P.accidentLevel2Fine,
      accidentLevel3Fine: P.accidentLevel3Fine, proxyPunchLevel: P.proxyPunchLevel
    },
    punches: punches.map(p => Object.assign(
      { type: p.punchType, time: p.punchTime.toISOString() },
      (({ status, sessionType, lateMinutes, lateFine, showInvalid, gpsLatitude, gpsLongitude, gpsAddress, remark }) =>
        ({ status, sessionType, lateMinutes, lateFine, showInvalid, gpsLatitude, gpsLongitude, gpsAddress, remark }))(_enrichPunchRow(p, P))
    ))
  });
};

module.exports = {
  login,
  profile,
  punch,
  punchList,
  attListSelf,
  wageList,
  wageConfirm,
  todayPunchStatus
};
