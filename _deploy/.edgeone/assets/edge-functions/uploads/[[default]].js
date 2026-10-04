/**
 * EdgeOne Pages Edge Function —— /uploads/* 反向代理到后端 Koa 服务
 * 路由匹配：/uploads/*  →  此函数  →  http://1.14.106.173:3001/uploads/*
 *
 * 用于本地文件下载（封面图片、附件等）
 */
const DEFAULT_BACKEND_URL = 'http://1.14.106.173:3001';

const FORWARD_RESPONSE_HEADERS = [
  'content-type', 'cache-control', 'etag', 'last-modified',
  'content-length', 'content-disposition'
];

export const onRequest = async (context) => {
  const { request, env } = context;

  if (request.method.toUpperCase() === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,HEAD,OPTIONS',
        'access-control-max-age': '86400'
      }
    });
  }

  const backendBase = (env && env.API_BACKEND_URL) || DEFAULT_BACKEND_URL;
  const backendOrigin = backendBase.replace(/\/+$/, '');

  const url = new URL(request.url);
  const pathname = url.pathname || '/';
  const backendUrl = backendOrigin + pathname + (url.search || '');

  const reqHeaders = new Headers();
  reqHeaders.set('user-agent', request.headers.get('user-agent') || 'EdgeOne-Proxy');

  let backendResp;
  try {
    backendResp = await fetch(backendUrl, {
      method: request.method,
      headers: reqHeaders,
      redirect: 'manual'
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: 'BACKEND_UNREACHABLE', detail: String(err && err.message ? err.message : err) }),
      { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } }
    );
  }

  const respHeaders = new Headers();
  FORWARD_RESPONSE_HEADERS.forEach((h) => {
    const v = backendResp.headers.get(h);
    if (v) respHeaders.set(h, v);
  });
  respHeaders.set('access-control-allow-origin', '*');
  respHeaders.set('x-edge-proxy', 'qaxqjt-uploads');

  const respBody = await backendResp.arrayBuffer();
  return new Response(respBody, {
    status: backendResp.status,
    statusText: backendResp.statusText,
    headers: respHeaders
  });
};
