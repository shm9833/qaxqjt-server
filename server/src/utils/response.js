'use strict';

/**
 * src/utils/response.js —— 统一响应格式
 * 成功：{ ok:true, data, meta }
 * 失败：{ ok:false, error:{ code, message, detail } }
 * 分页：meta = { page, pageSize, total, pageCount }
 */
const { env, nowMs } = require('../config');

const success = (ctx, data, meta = undefined, status = 200) => {
  ctx.status = status;
  ctx.body = {
    ok: true,
    data,
    meta: meta === undefined ? undefined : meta,
    _ts: nowMs(),
    _trace: ctx.state?.traceId || undefined,
    _ver: env.APP_VERSION
  };
};

const fail = (ctx, code, message, detail = undefined, status = 400) => {
  ctx.status = status;
  ctx.body = {
    ok: false,
    error: {
      code,
      message,
      detail: detail === undefined || env.NODE_ENV === 'production' ? undefined : detail
    },
    _ts: nowMs(),
    _trace: ctx.state?.traceId || undefined,
    _ver: env.APP_VERSION
  };
};

const created = (ctx, data, meta = undefined) => success(ctx, data, meta, 201);
const noContent = ctx => {
  ctx.status = 204;
  ctx.body = undefined;
};
const pageMeta = (page, pageSize, total) => {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(500, Math.max(1, Number(pageSize) || 20));
  return {
    page: p,
    pageSize: ps,
    total: Number(total) || 0,
    pageCount: Math.ceil((Number(total) || 0) / ps),
    skip: (p - 1) * ps,
    take: ps
  };
};

module.exports = {
  success,
  fail,
  created,
  noContent,
  pageMeta
};
