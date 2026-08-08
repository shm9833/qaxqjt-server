'use strict';

/**
 * src/middleware/request-log.js —— 请求日志 + traceId + 耗时
 */
const { nanoid } = require('nanoid');
const logger = require('../utils/logger');

const requestLog = () => async (ctx, next) => {
  const start = Date.now();
  ctx.state.traceId = `tr_${nanoid(10)}`;

  // 不要把密码打印到日志
  const body = ctx.request.body ? JSON.stringify(ctx.request.body).replace(/"password[^"]*":"[^"]*"/g, '"password":"***"') : undefined;

  logger.debug(
    {
      traceId: ctx.state.traceId,
      method: ctx.method,
      path: ctx.path,
      ip: ctx.ip,
      ua: ctx.get('user-agent').slice(0, 180),
      body
    },
    '>> req'
  );
  try {
    await next();
  } finally {
    const dur = Date.now() - start;
    logger[ctx.status >= 500 ? 'error' : ctx.status >= 400 ? 'warn' : 'info'](
      {
        traceId: ctx.state.traceId,
        method: ctx.method,
        path: ctx.path,
        status: ctx.status,
        dur_ms: dur
      },
      '<< res'
    );
  }
};

module.exports = { requestLog };
