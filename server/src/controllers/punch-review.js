'use strict';

/**
 * controllers/punch-review.js —— 深夜打卡人工复核（v20261030d）
 *
 * 背景：员工深夜误打卡（如 23:46 的"上班"卡）会被自动判迟到并扣款。
 * 新规：上班卡（北京时间）≥ nightReviewFrom（默认 21:00）时不再自动判迟到，
 *       记 status='pending_review'，由管理端在此复核：
 *       ① 作废（误打卡）→ 物理删除该打卡（EmployeePunchV1 有
 *          (performerId,punchDate,punchType) 唯一约束，留"voided"状态会占坑
 *          挡同日重打卡；删除后审计日志留痕）
 *       ② 确认正常 → status='normal'，remark 追加复核说明
 *       ③ 确认迟到 → status='late'（满失效分钟则 'late_invalid'），remark 追加说明
 * 工资核算口径天然兼容：核算只认 late/late_invalid/normal，pending_review 自动排除；
 * 迟到分钟/罚款不入库，展示与核算均按打卡基准即时计算。
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const punchParams = require('../services/punch-params');
const logger = require('../utils/logger');
const { BusinessError } = require('../middleware/error-handler');

// 待复核列表（按月查，默认当月；路由层已鉴权 super_admin/admin/finance_view）
const list = async ctx => {
  const month = (ctx.query.month || '').match(/^\d{4}-\d{2}$/) ? ctx.query.month : new Date().toISOString().slice(0, 7);
  const from = new Date(month + '-01T00:00:00.000+08:00');
  const to = new Date(from.getTime());
  to.setUTCMonth(to.getUTCMonth() + 1);
  const [rows, performerMap] = await Promise.all([
    prisma.employeePunchV1.findMany({
      where: { status: 'pending_review', punchTime: { gte: from, lt: to } },
      orderBy: { punchTime: 'asc' },
      take: 300
    }),
    prisma.performersDbV1.findMany({ select: { id: true, name: true, staffNo: true } })
  ]);
  const pmap = {};
  performerMap.forEach(p => { pmap[p.id] = p; });
  const P = await punchParams.getPunchParams();
  const items = rows.map(r => {
    const p = pmap[r.performerId] || {};
    const mins = punchParams.cnMinutesFromUtcDate(r.punchTime);
    return {
      id: r.id,
      performerId: r.performerId,
      performerName: p.name || r.performerId,
      staffNo: p.staffNo || '',
      punchType: r.punchType,
      punchTypeText: r.punchType === 'in' ? '上班卡' : '下班卡',
      punchTime: r.punchTime.toISOString(),
      cnTime: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`,
      sessionType: punchParams.sessionForMinutes(mins, P),
      gpsAddress: r.gpsAddress,
      remark: r.remark,
      status: r.status
    };
  });
  ctx.body = { code: 0, message: 'ok', data: { month, count: items.length, items } };
};

// 复核动作：voided（作废=删除误打卡）/ normal（记正常）/ late（确认迟到，按基准重算罚款）
const review = async ctx => {
  const action = ctx.request.body.action;
  const note = (ctx.request.body.note || '').toString().slice(0, 200);
  if (['voided', 'normal', 'late'].indexOf(action) < 0) { throw new BusinessError('VALIDATION_ERROR', 'action 必须为 voided/normal/late'); }

  const rec = await prisma.employeePunchV1.findUnique({ where: { id: ctx.params.id } });
  if (!rec) { throw new BusinessError('NOT_FOUND', '打卡记录不存在'); }
  if (rec.status !== 'pending_review') { throw new BusinessError('CONFLICT', `该记录状态为 ${rec.status}，仅 pending_review 可复核`); }

  const P = await punchParams.getPunchParams();
  const mins = punchParams.cnMinutesFromUtcDate(rec.punchTime);
  const sessionType = punchParams.sessionForMinutes(mins, P);
  const operator = (ctx.state.user && (ctx.state.user.username || ctx.state.user.id)) || 'admin';
  const stamp = `【复核:${operator} ${new Date().toISOString().slice(0, 10)}】${note}`;

  let result = { status: '', lateMinutes: 0, lateFine: 0, deleted: false, remark: '' };
  if (action === 'voided') {
    await prisma.employeePunchV1.delete({ where: { id: rec.id } });
    result.status = 'voided';
    result.deleted = true;
    result.remark = stamp + '（深夜误打卡，已作废删除）';
  } else if (action === 'normal') {
    const updated = await prisma.employeePunchV1.update({
      where: { id: rec.id },
      data: { status: 'normal', remark: ((rec.remark || '') + ' ' + stamp).trim() + '（复核确认正常）' }
    });
    result.status = 'normal';
    result.remark = updated.remark;
  } else {
    const r = punchParams.computeLateResult(mins, sessionType, P);
    const st = r.status === 'late_invalid' ? 'late_invalid' : 'late';
    const updated = await prisma.employeePunchV1.update({
      where: { id: rec.id },
      data: { status: st, remark: ((rec.remark || '') + ' ' + stamp).trim() + `（复核确认迟到${r.lateMinutes}分钟罚${r.fine}元${r.invalid ? '·本场失效' : ''}）` }
    });
    result = { status: st, lateMinutes: r.lateMinutes, lateFine: r.fine, deleted: false, remark: updated.remark };
  }

  try {
    await prisma.auditLog.create({
      data: {
        id: 'al_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        accountId: (ctx.state.user && ctx.state.user.id) || null,
        username: operator,
        action: 'punch_review_' + action,
        module: 'attendance',
        targetType: 'employee_punch',
        targetId: rec.id,
        actionTs: new Date(),
        ts: BigInt(Date.now()),
        detailJson: JSON.stringify({
          performerId: rec.performerId,
          punchTime: rec.punchTime.toISOString(),
          punchType: rec.punchType,
          from: 'pending_review',
          to: result.status,
          note
        })
      }
    });
  } catch (e) { logger.warn('[punch-review] audit log failed: ' + e.message); }

  ctx.body = { code: 0, message: 'ok', data: Object.assign({ id: rec.id }, result) };
};

module.exports = { list, review };
