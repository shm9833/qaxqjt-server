'use strict';

/**
 * src/controllers/appointments.js —— 预约 CRUD
 * 兼容 J1 三大场景：
 *   · 庙会包场：packageType=temple_fair, performanceCount>=3, estimatedBudget>¥30k
 *   · 文旅演出：packageType=cultural_tourism, performanceCount=1
 *   · 校园巡演：packageType=campus_tour, performanceCount>=2 + sourceChannel=school
 * 公开页匿名可提交；admin 端全接口；状态机安全流转
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta, noContent } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

// 合法状态流转（预约上游）
const STATUS_FLOW = {
  pending: ['confirmed', 'rejected', 'cancelled', 'converted'],
  confirmed: ['converted', 'cancelled', 'pending'],
  rejected: ['pending'],
  cancelled: ['pending'],
  converted: [] // 终态：已转订单
};
const _checkFlow = (from, to) => {
  if (from === to) return;
  const allows = STATUS_FLOW[from] || [];
  if (!allows.includes(to)) {
    throw new BusinessError('UNPROCESSABLE', `非法状态流转：${from} → ${to}，允许：${allows.join('/') || '无'}`);
  }
};

const _genAppointmentNo = () => {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    'APT' +
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    nanoid(4).toUpperCase()
  );
};

const list = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  const kw = (ctx.query.keyword || '').trim();
  if (kw) {
    where.OR = [
      { appointmentNo: { contains: kw } },
      { customerName: { contains: kw } },
      { organization: { contains: kw } },
      { phone: { contains: kw } }
    ];
  }
  if (ctx.query.status) where.status = ctx.query.status;
  if (ctx.query.packageType) where.packageType = ctx.query.packageType;
  if (ctx.query.source) where.source = ctx.query.source;
  if (ctx.query.customerId) where.customerId = ctx.query.customerId;
  if (ctx.query.fromDate) where.preferredStartDate = { gte: new Date(ctx.query.fromDate) };
  if (ctx.query.toDate) {
    where.preferredStartDate = { ...(where.preferredStartDate || {}), lte: new Date(ctx.query.toDate) };
  }
  const [rows, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        plays: true,
        customer: { select: { id: true, customerName: true, phone: true, level: true } }
      }
    }),
    prisma.appointment.count({ where })
  ]);
  return success(ctx, rows, { ...pageMeta(page, pageSize, total), total });
};

// dashboard 统计
const stats = async ctx => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [byStatus, total, todayNew, pendingCount] = await Promise.all([
    prisma.appointment.groupBy({ by: ['status'], _count: { id: true } }),
    prisma.appointment.count(),
    prisma.appointment.count({ where: { createdAt: { gte: today } } }),
    prisma.appointment.count({ where: { status: 'pending' } })
  ]);
  return success(ctx, {
    total,
    todayNew,
    pendingCount,
    byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count.id]))
  });
};

const create = async ctx => {
  const b = ctx.request.body;
  const isPublic = !ctx.state.user;

  // 1. 必填
  if (!b.customerName || !b.phone || !b.preferredStartDate || !b.performanceCount) {
    throw new BusinessError('VALIDATION_ERROR', 'customerName/phone/preferredStartDate/performanceCount 必填');
  }

  // 2. packageType 场景枚举校验
  const VALID_PKGS = ['temple_fair', 'cultural_tourism', 'campus_tour', 'custom'];
  if (b.packageType && !VALID_PKGS.includes(b.packageType)) {
    throw new BusinessError('VALIDATION_ERROR', `packageType 仅允许：${VALID_PKGS.join('/')}`);
  }

  // 3. 客户：phone 复用老客户 or 新建
  let customer = await prisma.customersV1.findFirst({ where: { phone: b.phone } });
  if (!customer) {
    customer = await prisma.customersV1.create({
      data: {
        id: idByCtx('customer', 12, nanoid),
        customerType: b.customerType || (b.organization ? 'organization' : 'personal'),
        customerName: b.customerName,
        organization: b.organization || null,
        contactPerson: b.contactPerson || b.customerName,
        phone: b.phone,
        backupPhone: b.backupPhone || null,
        email: b.email || null,
        region: b.region || null,
        address: b.address || null,
        sourceChannel: b.sourceChannel || (isPublic ? 'website' : 'manual'),
        firstContactDate: new Date(),
        createdBy: ctx.state.user?.sub || 'public_booking',
        status: 'active',
        ts: BigInt(nowMs())
      }
    });
  }

  // 4. 预约主单
  const packageType = b.packageType || _guessPackage(b);
  const appointment = await prisma.appointment.create({
    data: {
      id: b.id || idByCtx('appointment', 14, nanoid),
      appointmentNo: _genAppointmentNo(),
      source: isPublic ? 'website' : b.source || 'manual',
      status: 'pending',
      customerId: customer.id,
      customerName: b.customerName,
      customerType: customer.customerType,
      organization: b.organization || customer.organization || null,
      phone: b.phone,
      contactPerson: b.contactPerson || b.customerName,
      preferredStartDate: new Date(b.preferredStartDate),
      preferredEndDate: b.preferredEndDate ? new Date(b.preferredEndDate) : null,
      performanceCount: Number(b.performanceCount),
      packageType,
      venueProvince: b.venueProvince || null,
      venueCity: b.venueCity || null,
      venueDistrict: b.venueDistrict || null,
      venueAddress: b.venueAddress || null,
      estimatedBudget: b.estimatedBudget ? Number(b.estimatedBudget) : null,
      totalPerformanceFee: b.totalPerformanceFee ? Number(b.totalPerformanceFee) : null,
      depositAmount: b.depositAmount ? Number(b.depositAmount) : null,
      paymentTerms: b.paymentTerms || null,
      specialRequirements: b.specialRequirements || null,
      remarkInternal: b.remarkInternal || null,
      assignedAccountId: b.assignedAccountId || null,
      smsVerifiedFlag: !!b.smsVerifiedFlag,
      sourceChannel: b.sourceChannel || customer.sourceChannel || null,
      createdBy: ctx.state.user?.sub || 'public_booking',
      ts: BigInt(nowMs())
    }
  });

  // 5. 预约-剧目（plays: [{playId, sortOrder, performanceDate, performanceTime, note}]）
  if (Array.isArray(b.plays) && b.plays.length) {
    await prisma.appointmentPlay.createMany({
      data: b.plays.map(p => ({
        appointmentId: appointment.id,
        playId: String(p.playId),
        sortOrder: Number(p.sortOrder) || 1,
        performanceDate: p.performanceDate ? new Date(p.performanceDate) : null,
        performanceTime: p.performanceTime || null,
        note: p.note || null,
        ts: BigInt(nowMs())
      }))
    });
  }

  // 6. 审计
  await audit({
    ctx,
    module: 'booking',
    action: 'APPOINTMENT_CREATE' + (isPublic ? '_PUBLIC' : ''),
    targetId: appointment.id,
    detail: { no: appointment.appointmentNo, packageType }
  });

  const result = await prisma.appointment.findUnique({
    where: { id: appointment.id },
    include: { plays: true, customer: true }
  });
  return created(ctx, result);
};

const detail = async ctx => {
  const r = await prisma.appointment.findUnique({
    where: { id: ctx.params.id },
    include: {
      plays: { orderBy: { sortOrder: 'asc' } },
      appointmentAudits: { orderBy: { actionTs: 'desc' } },
      customer: true,
      order: true
    }
  });
  if (!r) throw new BusinessError('NOT_FOUND', '预约不存在');
  return success(ctx, r);
};

const update = async ctx => {
  const id = ctx.params.id;
  const b = ctx.request.body;
  const old = await prisma.appointment.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '预约不存在');

  // 状态流转校验
  if (b.status && b.status !== old.status) _checkFlow(old.status, b.status);

  const patch = {};
  [
    'customerName',
    'organization',
    'phone',
    'contactPerson',
    'preferredStartDate',
    'preferredEndDate',
    'performanceCount',
    'packageType',
    'venueProvince',
    'venueCity',
    'venueDistrict',
    'venueAddress',
    'estimatedBudget',
    'totalPerformanceFee',
    'depositAmount',
    'paymentTerms',
    'specialRequirements',
    'remarkInternal',
    'assignedAccountId',
    'smsVerifiedFlag',
    'sourceChannel',
    'convertedOrderId'
  ].forEach(k => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  if (patch.preferredStartDate) patch.preferredStartDate = new Date(patch.preferredStartDate);
  if (patch.preferredEndDate) patch.preferredEndDate = new Date(patch.preferredEndDate);
  if (patch.performanceCount) patch.performanceCount = Number(patch.performanceCount);
  ['estimatedBudget', 'totalPerformanceFee', 'depositAmount'].forEach(k => {
    if (patch[k] != null) patch[k] = Number(patch[k]);
  });

  // 转订单：自动写转换时间
  if (b.status === 'converted' && old.status !== 'converted') {
    patch.conversionToOrderDate = new Date();
  }
  if (b.status === 'rejected') {
    patch.rejectReason = b.rejectReason || old.rejectReason || '管理员驳回';
  }
  patch.status = b.status || old.status;
  patch.updatedAt = new Date();
  patch.ts = BigInt(nowMs());

  const row = await prisma.appointment.update({ where: { id }, data: patch });

  // 子资源：剧目整体替换
  if (Array.isArray(b.plays)) {
    await prisma.appointmentPlay.deleteMany({ where: { appointmentId: id } });
    if (b.plays.length) {
      await prisma.appointmentPlay.createMany({
        data: b.plays.map(p => ({
          appointmentId: id,
          playId: String(p.playId),
          sortOrder: Number(p.sortOrder) || 1,
          performanceDate: p.performanceDate ? new Date(p.performanceDate) : null,
          performanceTime: p.performanceTime || null,
          note: p.note || null,
          ts: BigInt(nowMs())
        }))
      });
    }
  }

  // 状态审计
  if (patch.status !== old.status) {
    await prisma.appointmentAudit.create({
      data: {
        id: idByCtx('apptAudit', 12, nanoid),
        appointmentId: id,
        actionType: 'STATUS_CHANGE',
        actionTs: new Date(),
        operatorAccountId: ctx.state.user?.sub || null,
        operatorName: ctx.state.user?.realName || 'system',
        fromStatus: old.status,
        toStatus: patch.status,
        remark: b.rejectReason || null,
        ts: BigInt(nowMs())
      }
    });
  }
  await audit({
    ctx,
    module: 'booking',
    action: 'APPOINTMENT_UPDATE',
    targetId: id,
    detail: { from: old.status, to: patch.status }
  });
  return success(ctx, row);
};

const remove = async ctx => {
  const id = ctx.params.id;
  const old = await prisma.appointment.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '预约不存在');
  if (old.status === 'converted') {
    throw new BusinessError('CONFLICT', '已转订单的预约不允许删除');
  }
  await prisma.appointmentPlay.deleteMany({ where: { appointmentId: id } });
  await prisma.appointmentAudit.deleteMany({ where: { appointmentId: id } });
  await prisma.appointment.delete({ where: { id } });
  await audit({ ctx, module: 'booking', action: 'APPOINTMENT_DELETE', targetId: id });
  return noContent(ctx);
};

/** 状态推进（简版接口）POST /v1/appointments/:id/transition { to, reason } */
const transition = async ctx => {
  const id = ctx.params.id;
  const { to, reason } = ctx.request.body;
  if (!to) throw new BusinessError('VALIDATION_ERROR', 'to 必填');
  const old = await prisma.appointment.findUnique({ where: { id } });
  if (!old) throw new BusinessError('NOT_FOUND', '预约不存在');
  _checkFlow(old.status, to);
  const patch = { status: to, updatedAt: new Date(), ts: BigInt(nowMs()) };
  if (to === 'converted') patch.conversionToOrderDate = new Date();
  if (to === 'rejected' && reason) patch.rejectReason = reason;
  const row = await prisma.appointment.update({ where: { id }, data: patch });
  await prisma.appointmentAudit.create({
    data: {
      id: idByCtx('apptAudit', 12, nanoid),
      appointmentId: id,
      actionType: 'STATUS_CHANGE',
      actionTs: new Date(),
      operatorAccountId: ctx.state.user?.sub || null,
      operatorName: ctx.state.user?.realName || 'system',
      fromStatus: old.status,
      toStatus: to,
      remark: reason || null,
      ts: BigInt(nowMs())
    }
  });
  await audit({ ctx, module: 'booking', action: 'APPOINTMENT_TRANSITION', targetId: id, detail: { from: old.status, to } });
  return success(ctx, row);
};

const listAudits = async ctx => {
  const rows = await prisma.appointmentAudit.findMany({
    where: { appointmentId: ctx.params.id },
    orderBy: { actionTs: 'desc' }
  });
  return success(ctx, rows);
};

const listPlays = async ctx => {
  const rows = await prisma.appointmentPlay.findMany({
    where: { appointmentId: ctx.params.id },
    orderBy: { sortOrder: 'asc' },
    include: { play: true }
  });
  return success(ctx, rows);
};

const setPlays = async ctx => {
  const id = ctx.params.id;
  const list = Array.isArray(ctx.request.body) ? ctx.request.body : [];
  await prisma.$transaction(async tx => {
    await tx.appointmentPlay.deleteMany({ where: { appointmentId: id } });
    if (list.length) {
      await tx.appointmentPlay.createMany({
        data: list.map((p, i) => ({
          appointmentId: id,
          playId: String(p.playId),
          sortOrder: Number(p.sortOrder) || i + 1,
          performanceDate: p.performanceDate ? new Date(p.performanceDate) : null,
          performanceTime: p.performanceTime || null,
          note: p.note || null,
          ts: BigInt(nowMs())
        }))
      });
    }
  });
  await audit({ ctx, module: 'booking', action: 'APPOINTMENT_SET_PLAYS', targetId: id });
  return success(ctx, { ok: true, count: list.length });
};

function _guessPackage(b) {
  const cnt = Number(b.performanceCount) || 1;
  if (b.sourceChannel === 'school' || /校园|学校|学院/.test(b.organization || '')) return 'campus_tour';
  if (cnt === 1) return 'cultural_tourism';
  if (cnt >= 3) return 'temple_fair';
  return 'custom';
}

module.exports = { list, stats, create, detail, update, remove, transition, listAudits, listPlays, setPlays };
