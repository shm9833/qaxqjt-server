/* performers/core.js — 核心 handlers（存在交叉调用，自 performers.js 拆分） */
'use strict';

/**
 * src/controllers/performers.js —— 演职人员花名册 CRUD
 */
const { nanoid } = require('nanoid');
const prisma = require('../../utils/prisma');
const { success, created, pageMeta } = require('../../utils/response');
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


const remove = async ctx => {
  const id = ctx.params.id;
  // 删除前快照（供审计追溯：删了谁、什么行当、日薪多少）
  const before = await prisma.performersDbV1.findUnique({ where: { id } });
  if (!before || before.status === 'deleted') {
    throw new BusinessError('NOT_FOUND', '人员不存在或已删除');
  }
  // 软删
  const row = await prisma.performersDbV1.update({
    where: { id },
    data: { status: 'deleted', updatedAt: new Date(), ts: BigInt(nowMs()) }
  });
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
  return success(ctx, { id: row.id, status: 'deleted' });
};

// ========== 演员自助入职登记（公开接口，无需登录） ==========

const selfRegister = async ctx => {
  const b = ctx.request.body || {};
  // 必须确认已阅读员工管理条例
  if (b.regulationsConfirmed !== true) {
    throw new BusinessError('VALIDATION_ERROR', '请先阅读并确认《公司员工管理条例》');
  }
  if (!b.name || String(b.name).trim().length < 2) {
    throw new BusinessError('VALIDATION_ERROR', '请填写姓名');
  }
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
  selfRegisterStatus,
  review,
};
