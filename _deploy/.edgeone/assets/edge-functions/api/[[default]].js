/**
 * EdgeOne Pages Edge Function —— /api/* 反向代理到后端 Koa 服务
 * 路由匹配：/api/*  →  此函数  →  http://1.14.106.173:3001/*
 *
 * 修复记录：
 *   1. 移除 onRequestOptions handler（EdgeOne 不支持，会导致函数加载失败）
 *   2. OPTIONS 请求在 onRequest 内通过 method 判断处理
 *   3. request.body 不能直接透传，需 await request.arrayBuffer() 读取
 *   4. 响应体用 await resp.text() 而非 resp.body stream
 */
const DEFAULT_BACKEND_URL = 'http://1.14.106.173:3001';

const FORWARD_REQUEST_HEADERS = [
  'authorization', 'content-type', 'accept', 'accept-language',
  'x-requested-with', 'x-trace-id', 'user-agent',
  'if-none-match', 'if-modified-since'
];

const FORWARD_RESPONSE_HEADERS = [
  'content-type', 'cache-control', 'etag', 'last-modified',
  'x-trace-id', 'x-total-count', 'x-request-id', 'set-cookie', 'vary'
];

export const onRequest = async (context) => {
  const { request, env } = context;

  // 处理 OPTIONS 预检请求（onRequestOptions handler 不受 EdgeOne 支持）
  if (request.method.toUpperCase() === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'Content-Type,Authorization,X-Requested-With,X-Trace-Id,Accept-Language',
        'access-control-max-age': '86400'
      }
    });
  }

  const backendBase = (env && env.API_BACKEND_URL) || DEFAULT_BACKEND_URL;
  const backendOrigin = backendBase.replace(/\/+$/, '');

  const url = new URL(request.url);
  const pathname = url.pathname || '/';
  const search = url.search || '';

  // 剥掉 /api 前缀
  let backendPath = pathname;
  if (backendPath === '/api' || backendPath === '/api/') {
    backendPath = '/';
  } else if (backendPath.startsWith('/api/')) {
    backendPath = backendPath.slice(4);
  } else if (backendPath.startsWith('/api')) {
    backendPath = backendPath.slice(4) || '/';
  }

  const backendUrl = backendOrigin + backendPath + search;

  // 构造转发请求头
  const reqHeaders = new Headers();
  FORWARD_REQUEST_HEADERS.forEach((h) => {
    const v = request.headers.get(h);
    if (v) reqHeaders.set(h, v);
  });

  const method = request.method.toUpperCase();
  const hasBody = !(method === 'GET' || method === 'HEAD');

  const init = {
    method: request.method,
    headers: reqHeaders,
    redirect: 'manual'
  };
  if (hasBody) {
    // EdgeOne V8 isolate 中 request.body 不能直接透传，需先读取为 ArrayBuffer
    init.body = await request.arrayBuffer();
  }

  let backendResp;
  try {
    backendResp = await fetch(backendUrl, init);
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false, error: 'BACKEND_UNREACHABLE',
        message: 'Edge Function 无法连接后端服务',
        backend: backendOrigin, path: backendPath,
        detail: String(err && err.message ? err.message : err)
      }),
      { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
    );
  }

  // 构造响应头
  const respHeaders = new Headers();
  FORWARD_RESPONSE_HEADERS.forEach((h) => {
    const v = backendResp.headers.get(h);
    if (v) respHeaders.set(h, v);
  });
  respHeaders.set('access-control-allow-origin', '*');
  respHeaders.set('access-control-allow-credentials', 'true');
  respHeaders.set('access-control-allow-methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
  respHeaders.set('access-control-allow-headers', 'Content-Type,Authorization,X-Requested-With,X-Trace-Id,Accept-Language');
  respHeaders.set('access-control-expose-headers', 'X-Trace-Id,X-Total-Count,X-Request-Id');
  respHeaders.set('x-edge-proxy', 'qaxqjt-api');
  respHeaders.set('x-edge-backend', backendOrigin);

  // 用 text() 而非 body stream，避免 V8 isolate 中流消费超时
  const respBody = await backendResp.text();

  return new Response(respBody, {
    status: backendResp.status,
    statusText: backendResp.statusText,
    headers: respHeaders
  });
};
