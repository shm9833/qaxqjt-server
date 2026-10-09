/* performers/core.js — 核心 handlers（存在交叉调用，自 performers.js 拆分） */
'use strict';

/**
 * src/controllers/performers.js —— 演职人员花名册 CRUD
 */
const { nanoid } = require('nanoid');
const prisma = require('../../utils/prisma');
const { success, created } = require('../../utils/response');
const { idByCtx, nowMs } = require('../../config');
const { BusinessError } = require('../../middleware/error-handler');
const { audit } = require('../../services/audit-service');
// 复用工资核算唯一扣罚口径（迟到20元/次、迟到超30分钟扣半日、旷工1天扣两日）
const { computeAttendancePenalty } = require('../wages');
const { buildData, syncPerformerToWageItems, allocateStaffNo, toDailyRate, cleanupRejectedRecords } = require('./helpers');
const { detail, list } = require('./independent');

const create = async ctx => {
  const b = ctx.request.body;
  const manualNo = (b.staffNo || '').toString().trim();
  let lastErr = null;
  // 自动分配工号时带唯一冲突重试（并发新增安全）；手工指定工号则不重试
  for (let attempt = 0; attempt < (manualNo ? 1 : 3); attempt++) {
    const staffNo = manualNo || await allocateStaffNo();
    const data = {
      id: b.id || idByCtx('performer', 12, nanoid),
      ...buildData({ ...b, staffNo })
    };
    try {
      const row = await prisma.performersDbV1.create({ data });
      await audit({ ctx, module: 'performers', action: 'PERFORMER_CREATE', targetId: row.id, detail: { name: row.name, staffNo: row.staffNo } });
      // 入职后自动同步到现有 draft 批次工资条（无匹配则无副作用）
      await syncPerformerToWageItems(row.id, { name: row.name, staffNo: row.staffNo, rankGrade: row.rankGrade, dailyRate: row.dailyRate });
      return created(ctx, row);
    } catch (e) {
      lastErr = e;
      if (!manualNo && e && e.code === 'P2002') continue; // 工号并发冲突，重新取号
      throw e;
    }
  }
  throw lastErr;
};


// 禁用/启用演职人员（禁用是删除的前置状态）
const setStatus = status => async ctx => {
  const id = ctx.params.id;
  const before = await prisma.performersDbV1.findUnique({ where: { id } });
  if (!before || before.status === 'deleted') {
    throw new BusinessError('NOT_FOUND', '人员不存在或已删除');
  }
  // 幂等：重复置为相同状态直接返回成功（并发/重试安全）
  if (before.status === status) {
    return success(ctx, { id, status, unchanged: true });
  }
  const row = await prisma.performersDbV1.update({
    where: { id },
    data: { status, updatedAt: new Date(), ts: BigInt(nowMs()) }
  });
  await audit({
    ctx,
    module: 'performers',
    action: status === 'disabled' ? 'PERFORMER_DISABLE' : 'PERFORMER_ENABLE',
    targetId: id,
    detail: { name: before.name, staffNo: before.staffNo || null, from: before.status, to: status }
  });
  return success(ctx, { id: row.id, status: row.status });
};
const disable = setStatus('disabled');
const enable = setStatus('active');

const remove = async ctx => {
  const id = ctx.params.id;
  // 删除前快照（供审计追溯：删了谁、什么行当、日薪多少）
  const before = await prisma.performersDbV1.findUnique({ where: { id } });
  if (!before || before.status === 'deleted') {
    throw new BusinessError('NOT_FOUND', '人员不存在或已删除');
  }
  // 仅允许删除已禁用的人员
  if (before.status !== 'disabled') {
    throw new BusinessError('FORBIDDEN', '仅禁用状态的演职人员可删除，请先将其禁用');
  }
  // 条件更新软删（并发安全：并发重复删除时仅一个请求生效）
  const res = await prisma.performersDbV1.updateMany({
    where: { id, status: 'disabled' },
    data: { status: 'deleted', updatedAt: new Date(), ts: BigInt(nowMs()) }
  });
  if (!res.count) throw new BusinessError('CONFLICT', '该人员状态已变化（可能已被其他操作删除或启用），请刷新后重试');
  await audit({
    ctx, module: 'performers', action: 'PERFORMER_SOFT_DELETE', targetId: id,
    detail: {
      name: before.name,
      staffNo: before.staffNo || null,
      primaryRole: before.primaryRole || null,
      employmentType: before.employmentType || null,
      rankGrade: before.rankGrade || null,
      dailyRate: before.dailyRate != null ? Number(before.dailyRate) : null,
      deletedAt: new Date().toISOString()
    }
  });
  return success(ctx, { id, status: 'deleted' });
};

// 清理已禁用演职人员（支持批量/单条 ids，分页限制单次数量防性能问题）
const CLEANUP_MAX_BATCH = 200;
const cleanupDisabled = async ctx => {
  const b = ctx.request.body || {};
  let ids = Array.isArray(b.ids) ? b.ids.filter(x => typeof x === 'string' && x).slice(0, CLEANUP_MAX_BATCH) : null;
  const pageSize = Math.min(Math.max(parseInt(b.pageSize, 10) || 50, 1), CLEANUP_MAX_BATCH);

  // 目标集合：指定 ids 或按分页取最旧禁用记录
  const where = { status: 'disabled' };
  let targets;
  if (ids && ids.length) {
    targets = await prisma.performersDbV1.findMany({
      where: { ...where, id: { in: ids } },
      select: { id: true, name: true, staffNo: true, primaryRole: true, employmentType: true, rankGrade: true, dailyRate: true }
    });
  } else {
    targets = await prisma.performersDbV1.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      take: pageSize,
      select: { id: true, name: true, staffNo: true, primaryRole: true, employmentType: true, rankGrade: true, dailyRate: true }
    });
  }

  const totalDisabled = await prisma.performersDbV1.count({ where });
  if (!targets.length) {
    return success(ctx, { cleaned: 0, remaining: totalDisabled, skipped: ids ? ids.length : 0 });
  }

  // 条件批量软删（并发安全：只删仍是 disabled 的记录）
  const targetIds = targets.map(t => t.id);
  const res = await prisma.performersDbV1.updateMany({
    where: { id: { in: targetIds }, status: 'disabled' },
    data: { status: 'deleted', updatedAt: new Date(), ts: BigInt(nowMs()) }
  });

  // 审计：汇总一条 + 逐条明细
  const nowIso = new Date().toISOString();
  await audit({
    ctx, module: 'performers', action: 'PERFORMER_CLEANUP_DISABLED',
    detail: { requested: ids ? ids.length : null, cleaned: res.count, pageSize, at: nowIso }
  });
  const byId = {};
  targets.forEach(t => { byId[t.id] = t; });
  // updateMany 不返回成功明细，按目标逐条补审计（disabled->deleted 的条件更新已保证一致性）
  for (const t of targets) {
    await audit({
      ctx, module: 'performers', action: 'PERFORMER_SOFT_DELETE', targetId: t.id,
      detail: {
        name: t.name,
        staffNo: t.staffNo || null,
        primaryRole: t.primaryRole || null,
        employmentType: t.employmentType || null,
        rankGrade: t.rankGrade || null,
        dailyRate: t.dailyRate != null ? Number(t.dailyRate) : null,
        deletedAt: nowIso,
        via: 'cleanup'
      }
    });
  }

  const remaining = await prisma.performersDbV1.count({ where });
  return success(ctx, {
    cleaned: res.count,
    remaining,
    skipped: ids ? ids.length - res.count : 0,
    pageSize
  });
};

// ========== 演员自助入职登记（公开接口，无需登录） ==========

// 校验入职二维码：存在 + 启用 + 未过期
const _validateQrToken = async token => {
  if (!token) return null; // 不带 token 也允许登记（兼容旧链接/后台手工分享）
  const qr = await prisma.qrCodeInviteV1.findUnique({ where: { qrToken: token } });
  if (!qr) throw new BusinessError('VALIDATION_ERROR', '入职二维码不存在，请向管理员索取最新二维码');
  if (qr.status === 'disabled') throw new BusinessError('FORBIDDEN', '该入职二维码已停用，请联系管理员');
  if (qr.status === 'expired' || (qr.expiresAt && qr.expiresAt.getTime() < Date.now())) {
    throw new BusinessError('FORBIDDEN', '该入职二维码已过期，请联系管理员');
  }
  if (qr.maxUses != null && qr.usedCount >= qr.maxUses) {
    throw new BusinessError('CONFLICT', '该入职二维码使用次数已达上限，请联系管理员');
  }
  return qr;
};

// 成功登记后计数（条件更新防止并发超用）
const _consumeQrToken = async qr => {
  if (!qr) return;
  const res = await prisma.qrCodeInviteV1.updateMany({
    where: {
      id: qr.id,
      status: 'active',
      ...(qr.maxUses != null ? { usedCount: { lt: qr.maxUses } } : {})
    },
    data: { usedCount: { increment: 1 }, ts: BigInt(nowMs()) }
  });
  if (!res.count) throw new BusinessError('CONFLICT', '该入职二维码使用次数已达上限，请联系管理员');
};

// 二维码信息公开查询（扫码进入页面时校验有效性）
const selfRegisterQrInfo = async ctx => {
  const token = (ctx.params.token || '').trim();
  if (!token) throw new BusinessError('VALIDATION_ERROR', '缺少二维码参数');
  const qr = await prisma.qrCodeInviteV1.findUnique({ where: { qrToken: token } });
  if (!qr) return success(ctx, { valid: false, reason: 'not_found' });
  const expired = qr.status === 'expired' || (qr.expiresAt && qr.expiresAt.getTime() < Date.now());
  const full = qr.maxUses != null && qr.usedCount >= qr.maxUses;
  const valid = qr.status === 'active' && !expired && !full;
  return success(ctx, {
    valid,
    reason: !valid ? (qr.status === 'disabled' ? 'disabled' : expired ? 'expired' : 'full') : null,
    title: qr.title,
    expiresAt: qr.expiresAt ? qr.expiresAt.toISOString() : null
  });
};

const selfRegister = async ctx => {
  const b = ctx.request.body || {};
  // 必须确认已阅读员工管理条例
  if (b.regulationsConfirmed !== true) {
    throw new BusinessError('VALIDATION_ERROR', '请先阅读并确认《公司员工管理条例》');
  }
  if (!b.name || String(b.name).trim().length < 2) {
    throw new BusinessError('VALIDATION_ERROR', '请填写姓名');
  }
  // 校验入职二维码（若链接携带）
  const qr = await _validateQrToken(b.qrToken ? String(b.qrToken).trim() : '');
  // 身份证号必填 + 格式校验 + 重复校验
  const idCardNo = (b.idCardNo || '').toString().trim().toUpperCase();
  if (!idCardNo) {
    throw new BusinessError('VALIDATION_ERROR', '请填写身份证号');
  }
  if (!/^\d{17}[\dX]$/.test(idCardNo)) {
    throw new BusinessError('VALIDATION_ERROR', '身份证号格式不正确（应为18位）');
  }
  // 查重：同一身份证号不可重复登记（排除已软删除记录）
  const dup = await prisma.performersDbV1.findFirst({
    where: { idCardNo, status: { not: 'deleted' } },
    select: { id: true, name: true, status: true, reviewStatus: true }
  });
  const dailyRate = toDailyRate(b.dailyRate);
  const baseData = {
    name: String(b.name).trim(),
    idCardNo,
    gender: b.gender || null,
    phone: b.phone || null,
    primaryRole: b.primaryRole || null,
    dailyRate: dailyRate,
    agreedSalary: dailyRate != null ? ('协议天工资 ' + dailyRate + ' 元/天') : (b.agreedSalary || null),
    transportType: b.transportType || null,
    remark: b.remark || null,
    regulationsConfirmed: true,
    ts: BigInt(nowMs())
  };

  if (dup) {
    // 已被退回的记录：允许修改后重新提交，直接更新原记录
    if (dup.reviewStatus === 'rejected') {
      const updated = await prisma.performersDbV1.update({
        where: { id: dup.id },
        data: { ...baseData, status: 'pending', reviewStatus: 'pending', reviewFeedback: null, updatedAt: new Date() }
      });
      await audit({ ctx, module: 'performers', action: 'PERFORMER_SELF_REGISTER', targetId: updated.id, detail: { name: updated.name, idCardNo, resubmit: true } });
      return created(ctx, { id: updated.id, name: updated.name, status: 'pending', reviewStatus: 'pending', resubmit: true, message: '重新提交成功，等待管理员审核' });
    }
    // 审核中或已通过：不允许重复提交
    const hint = dup.status === 'active' ? '已在职' : '审核中';
    throw new BusinessError('CONFLICT', '该身份证号已登记（' + hint + '），同一身份证不可重复提交');
  }

  // 首次登记：先占用二维码名额（原子条件更新，防并发超用），再建登记记录
  await _consumeQrToken(qr);
  const data = {
    id: idByCtx('performer', 12, nanoid),
    staffNo: null,
    ...baseData,
    status: 'pending',
    reviewStatus: 'pending',
    reviewFeedback: null
  };
  const row = await prisma.performersDbV1.create({ data });
  await audit({ ctx, module: 'performers', action: 'PERFORMER_SELF_REGISTER', targetId: row.id, detail: { name: row.name, idCardNo } });
  return created(ctx, { id: row.id, name: row.name, status: 'pending', message: '提交成功，等待管理员审核' });
};

// ========== 自助登记状态查询（公开，演员凭手机号/身份证查询审核结果） ==========
// ========== 退回审核信息10分钟后自动清除 ==========

const selfRegisterStatus = async ctx => {
  // 查询前先清理过期的退回记录
  await cleanupRejectedRecords();
  const phone = (ctx.query.phone || '').trim();
  const idCardNo = (ctx.query.idCardNo || '').trim().toUpperCase();
  if (!phone && !idCardNo) {
    throw new BusinessError('VALIDATION_ERROR', '请输入手机号或身份证号');
  }
  const where = { status: { not: 'deleted' } };
  if (phone) where.phone = phone;
  if (idCardNo) where.idCardNo = idCardNo;
  const rows = await prisma.performersDbV1.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, name: true, status: true, reviewStatus: true, reviewFeedback: true, staffNo: true, createdAt: true, primaryRole: true }
  });
  if (!rows.length) {
    return success(ctx, { found: false, message: '未找到该登记记录，请确认信息无误' });
  }
  // 脱敏：不返回身份证号、手机号等敏感信息
  const list = rows.map(r => ({
    name: r.name,
    status: r.status,
    reviewStatus: r.reviewStatus,
    reviewFeedback: r.reviewFeedback,
    staffNo: r.staffNo,
    primaryRole: r.primaryRole,
    createdAt: r.createdAt
  }));
  return success(ctx, { found: true, list });
};

// ========== 管理员审核（通过/退回） ==========

const review = async ctx => {
  const { id } = ctx.params;
  const b = ctx.request.body || {};
  const action = b.action; // 'approve' | 'reject'
  if (action !== 'approve' && action !== 'reject') {
    throw new BusinessError('VALIDATION_ERROR', 'action 必须为 approve 或 reject');
  }
  const row = await prisma.performersDbV1.findUnique({ where: { id } });
  if (!row) throw new BusinessError('NOT_FOUND', '演职人员不存在');

  let patch;
  if (action === 'approve') {
    const manualNo = (b.staffNo || '').toString().trim();
    // 自助登记者原本无工号：审核通过即由后端统一分配正式工号
    const staffNo = manualNo || row.staffNo || await allocateStaffNo();
    patch = {
      status: 'active',
      reviewStatus: 'approved',
      reviewFeedback: null,
      staffNo,
      updatedAt: new Date(),
      ts: BigInt(nowMs())
    };
    // 审核通过时设定薪酬标准
    if (b.dailyRate != null && b.dailyRate !== '') patch.dailyRate = Number(b.dailyRate);
    if (b.rankGrade) patch.rankGrade = String(b.rankGrade).trim();
    if (b.transportType) patch.transportType = String(b.transportType).trim();
  } else {
    patch = {
      status: 'pending',
      reviewStatus: 'rejected',
      reviewFeedback: b.feedback || '资料需补充，请重新填写',
      updatedAt: new Date(),
      ts: BigInt(nowMs())
    };
  }
  const updated = await prisma.performersDbV1.update({ where: { id }, data: patch });
  await audit({ ctx, module: 'performers', action: action === 'approve' ? 'PERFORMER_APPROVE' : 'PERFORMER_REJECT', targetId: id, detail: { name: updated.name, staffNo: updated.staffNo, feedback: patch.reviewFeedback } });
  if (action === 'approve') {
    // 审核通过时同步到现有 draft 批次工资条（含 dailyRate/rankGrade/staffNo/name）
    await syncPerformerToWageItems(updated.id, { name: updated.name, staffNo: updated.staffNo, rankGrade: updated.rankGrade, dailyRate: updated.dailyRate });
  }
  return success(ctx, { id: updated.id, staffNo: updated.staffNo, reviewStatus: updated.reviewStatus, status: updated.status });
};

// ========== 统计聚合（真实数据） ==========
// 秦腔行当/岗位关键词（按子串匹配，兼容"铜锤花脸/刀马旦/W3正生"等复合写法）

module.exports = {
  create,
  remove,
  selfRegister,
  selfRegisterQrInfo,
  selfRegisterStatus,
  review,
};
