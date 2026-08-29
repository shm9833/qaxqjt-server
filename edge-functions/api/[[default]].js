/**
 * EdgeOne Pages Edge Function —— /api/* 反向代理到后端 Koa 服务
 * 路由匹配：/api/*  →  此函数  →  http://1.14.106.173:3001/*
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

async function handleRequest(context) {
  const { request, env } = context;
  const backendBase = (env && env.API_BACKEND_URL) || DEFAULT_BACKEND_URL;
  const backendOrigin = backendBase.replace(/\/+$/, '');

  const url = new URL(request.url);
  const pathname = url.pathname || '/';
  const search = url.search || '';

  let backendPath = pathname;
  if (backendPath === '/api' || backendPath === '/api/') {
    backendPath = '/';
  } else if (backendPath.startsWith('/api/')) {
    backendPath = backendPath.slice(4);
  } else if (backendPath.startsWith('/api')) {
    backendPath = backendPath.slice(4) || '/';
  }

  const backendUrl = backendOrigin + backendPath + search;

  const reqHeaders = new Headers();
  FORWARD_REQUEST_HEADERS.forEach((h) => {
    const v = request.headers.get(h);
    if (v) reqHeaders.set(h, v);
  });

  const method = request.method.toUpperCase();
  const hasBody = !(method === 'GET' || method === 'HEAD' || method === 'OPTIONS');

  const init = {
    method: request.method,
    headers: reqHeaders,
    redirect: 'manual'
  };
  if (hasBody) {
    init.body = request.body;
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

  // 使用 text() 而非直接传递 body stream，避免 V8 isolate 中流消费问题
  const respBody = await backendResp.text();

  return new Response(respBody, {
    status: backendResp.status,
    statusText: backendResp.statusText,
    headers: respHeaders
  });
}

async function handleOptions(context) {
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

export const onRequest = handleRequest;
export const onRequestOptions = handleOptions;
