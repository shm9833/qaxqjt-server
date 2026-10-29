'use strict';

/**
 * src/controllers/perf-ops-window.js —— 演出入职/演职操作开放时限（v20261013 新规）
 *
 * GET /v1/performers/self-register/window  公开：入职登记通道是否开放（自助登记页加载时查询）
 * GET /v1/self-service/ops-window          员工端：演职操作通道状态（打卡等按钮启用依据）
 * GET /v1/system/perf-ops-window           管理端：查看时限参数
 * PUT /v1/system/perf-ops-window           管理端：修改时限参数（super_admin/ops）
 */
const svc = require('../services/perf-ops-window');
const { success } = require('../utils/response');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const publicWindow = async ctx => {
  const w = await svc.computeWindow();
  return success(ctx, {
    enabled: w.enabled,
    registerOpen: w.registerOpen,
    message: w.registerOpen ? '' : w.message,
    nextOpenDate: w.nextOpenDate
  });
};

const opsWindow = async ctx => {
  const w = await svc.computeWindow();
  const ctl = w.control || { mode: 'open' };
  return success(ctx, {
    enabled: w.enabled,
    opsOpen: w.opsOpen,
    registerOpen: w.registerOpen,
    // v20261017：休假/暂停进行中时优先返回总控文案，否则维持原演出窗口文案
    message: w.opsOpen ? '' : (ctl.mode !== 'open' ? w.message : `演职操作通道已关闭（演出正式开始后开放，结束后${w.params.closeHoursAfter}小时自动关闭）`),
    nextOpenDate: w.nextOpenDate,
    control: ctl
  });
};

const getParamsCtrl = async ctx => {
  const p = await svc.getParams();
  const w = await svc.computeWindow();
  return success(ctx, { params: p, registerOpen: w.registerOpen, opsOpen: w.opsOpen, nextOpenDate: w.nextOpenDate, runs: w.runs });
};

const saveParamsCtrl = async ctx => {
  const body = ctx.request.body || {};
  if (body.openDaysBefore !== undefined && Number(body.openDaysBefore) < 0) {
    throw new BusinessError('VALIDATION_ERROR', 'openDaysBefore 不能小于0');
  }
  const username = ctx.state.user && ctx.state.user.username;
  const before = await svc.getParams();
  const p = await svc.saveParams(body, username);
  try {
    await audit({
      ctx,
      module: 'setting',
      action: 'PERF_OPS_WINDOW_UPDATE',
      targetType: 'setting',
      targetId: 'perf_ops_window',
      detail: {
        before,
        after: p,
        changedFields: Object.keys(p).filter(k => JSON.stringify(p[k]) !== JSON.stringify(before[k]))
      }
    });
  } catch (_) {}
  return success(ctx, p);
};

module.exports = { publicWindow, opsWindow, getParamsCtrl, saveParamsCtrl };
