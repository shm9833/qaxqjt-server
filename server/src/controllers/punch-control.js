'use strict';

/**
 * src/controllers/punch-control.js —— 全团打卡总控（v20261017 新规）
 *
 * GET  /v1/attendance/punch-control         管理端：查看当前状态（含区间历史）
 * POST /v1/attendance/punch-control/start   管理端：🏖️全团休假 / ⏸️暂停打卡（body: kind, reason）
 * POST /v1/attendance/punch-control/stop    管理端：▶️恢复开放（收假）
 *
 * 生效：mode!=='open' 时 perf-ops-window.computeWindow 强制 opsOpen=false
 * （员工打卡与工资确认同步关闭），工资核算跳过区间内考勤记录（不计工资）。
 */
const svc = require('../services/punch-control');
const { success } = require('../utils/response');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const getCtrl = async ctx => {
  return success(ctx, await svc.getState());
};

const startCtrl = async ctx => {
  const body = ctx.request.body || {};
  const kind = String(body.kind || '');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const username = ctx.state.user && ctx.state.user.username;
  const before = await svc.getState();
  const range = await svc.startRange(kind, reason, username);
  try {
    await audit({
      ctx,
      module: 'attendance',
      action: 'PUNCH_CONTROL_UPDATE',
      targetType: 'setting',
      targetId: svc.SETTING_KEY,
      detail: { op: 'start', before: { mode: before.mode }, after: range }
    });
  } catch (_) {}
  return success(ctx, await svc.getState());
};

const stopCtrl = async ctx => {
  const username = ctx.state.user && ctx.state.user.username;
  const before = await svc.getState();
  if (before.mode === 'open') {
    throw new BusinessError('CONFLICT', '当前没有进行中的休假/暂停');
  }
  const closed = await svc.closeCurrent(username);
  try {
    await audit({
      ctx,
      module: 'attendance',
      action: 'PUNCH_CONTROL_UPDATE',
      targetType: 'setting',
      targetId: svc.SETTING_KEY,
      detail: { op: 'stop', before: { mode: before.mode, since: before.current && before.current.start }, after: closed }
    });
  } catch (_) {}
  return success(ctx, await svc.getState());
};

module.exports = { getCtrl, startCtrl, stopCtrl };
