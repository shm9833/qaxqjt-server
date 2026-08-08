'use strict';

/**
 * src/middleware/error-handler.js —— 全局错误兜底
 * 把 Prisma/JWT/Joi/业务异常统一序列化为前端可消费的 JSON
 */
const { fail } = require('../utils/response');
const logger = require('../utils/logger');
const { isDev } = require('../config');

// 统一错误码表（前端按 code 做 i18n / 分支）
const ERROR_MAP = {
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400 },
  UNAUTHORIZED: { code: 'UNAUTHORIZED', status: 401 },
  FORBIDDEN: { code: 'FORBIDDEN', status: 403 },
  NOT_FOUND: { code: 'NOT_FOUND', status: 404 },
  CONFLICT: { code: 'CONFLICT', status: 409 },
  UNPROCESSABLE: { code: 'UNPROCESSABLE', status: 422 },
  RATE_LIMITED: { code: 'RATE_LIMITED', status: 429 },
  INTERNAL: { code: 'INTERNAL_ERROR', status: 500 }
};

class BusinessError extends Error {
  constructor(key, message, detail = undefined) {
    super(message || key);
    this.key = key;
    this.detail = detail;
  }
}

const errorHandler = () => async (ctx, next) => {
  try {
    await next();
    if (ctx.status === 404 && !ctx.body) {
      fail(ctx, ERROR_MAP.NOT_FOUND.code, `路由不存在 ${ctx.method} ${ctx.path}`, undefined, 404);
    }
  } catch (err) {
    // koa-jwt 401
    if (err.status === 401 || err.name === 'UnauthorizedError') {
      return fail(ctx, ERROR_MAP.UNAUTHORIZED.code, err.message || '未登录或 token 已失效', isDev ? err.stack : undefined, 401);
    }
    // Joi 校验
    if (err && err.isJoi === true && err.name === 'ValidationError') {
      const fields = (err.details || []).map(d => ({ field: d.path.join('.'), message: d.message }));
      return fail(ctx, ERROR_MAP.VALIDATION_ERROR.code, '参数校验失败', fields, 400);
    }
    // Prisma 已知错误
    if (err && err.code && String(err.code).startsWith('P')) {
      if (err.code === 'P2002') {
        const target = (err.meta && err.meta.target) || 'unique';
        return fail(ctx, ERROR_MAP.CONFLICT.code, `唯一约束冲突：${Array.isArray(target) ? target.join(',') : target}`, isDev ? err.message : undefined, 409);
      }
      if (err.code === 'P2025') {
        return fail(ctx, ERROR_MAP.NOT_FOUND.code, '记录不存在或已删除', isDev ? err.message : undefined, 404);
      }
      if (err.code === 'P2003') {
        return fail(ctx, ERROR_MAP.UNPROCESSABLE.code, '外键关联不存在（parent 未创建）', isDev ? err.message : undefined, 422);
      }
    }
    // 业务显式抛出
    if (err instanceof BusinessError) {
      const m = ERROR_MAP[err.key] || ERROR_MAP.INTERNAL;
      return fail(ctx, m.code, err.message, err.detail, m.status);
    }
    // 未知 500
    logger.error({ err, path: ctx.path, method: ctx.method }, 'Unhandled error');
    fail(
      ctx,
      ERROR_MAP.INTERNAL.code,
      isDev ? err.message : '服务器内部错误，请联系管理员',
      isDev ? err.stack : undefined,
      500
    );
  }
};

module.exports = { errorHandler, BusinessError, ERROR_MAP };
