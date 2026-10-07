'use strict';

/**
 * controllers/system-init.js —— 系统初始化 HTTP 接口（仅 super_admin）
 *   GET  /v1/system/init/status  环境检测 + 初始化标记（只读，幂等安全）
 *   POST /v1/system/init/run     执行初始化（高危，body.confirm=true）
 *   GET  /v1/system/init/log     读取最近一次初始化日志
 */
const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const { env } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');
const envCheck = require('../services/system-init/env-check');
const initializer = require('../services/system-init/initializer');

const status = async ctx => {
  const port = Number((ctx.query && ctx.query.port) || env.APP_PORT || 3001);
  const [report, marker] = await Promise.all([
    // HTTP 在线场景：端口必然被本服务占用，传 portSelf 使该项记 pass
    envCheck.runAllChecks({ prisma, port, portSelf: true }),
    initializer.getInitMarker(prisma)
  ]);
  return success(ctx, { checks: report, initialized: !!marker, marker });
};

const run = async ctx => {
  const b = ctx.request.body || {};
  if (b.confirm !== true) {
    throw new BusinessError('VALIDATION_ERROR', '初始化会重建表结构并重置种子数据，必须显式传 confirm: true');
  }
  const progress = [];
  const report = await initializer.runInitialization({
    confirm: true,
    runSchema: b.runSchema !== false,
    runSeed: b.runSeed !== false,
    prisma,
    ctx,
    audit: { audit },
    onProgress: (step, percent, message) => progress.push({ step, percent, message, at: new Date().toISOString() })
  });
  try {
    await audit({
      ctx,
      module: 'system-init',
      action: 'SYSTEM_INIT_RUN',
      detail: {
        status: report.status,
        runSchema: b.runSchema !== false,
        runSeed: b.runSeed !== false,
        logFile: report.logFile
      }
    });
  } catch (_) {
    /* 审计写入失败不影响初始化结果返回 */
  }
  // 业务级失败仍返回 200 + 完整报告（前端据 report.status 展示失败现场与日志，非传输层错误）
  return success(ctx, { report, progress });
};

const log = async ctx => {
  const latest = initializer.latestLog();
  if (!latest) {
    return success(ctx, { file: null, content: '' });
  }
  return success(ctx, latest);
};

module.exports = { status, run, log };
