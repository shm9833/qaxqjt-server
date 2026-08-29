/**
 * EdgeOne Pages Edge Function —— /api/* 反向代理到后端 Koa 服务
 * ----------------------------------------------------------------------------
 * 路由匹配：/api/*  →  此函数  →  http://1.14.106.173:3001/*
 *
 * 设计要点：
 *   1. 前端 js/api-config.js 在同源模式下，会把所有 REST 请求 URL 解析为
 *      HOMOLOGOUS_PROXY_PREFIX + path = /api + /v1/xxx = /api/v1/xxx
 *   2. 本函数剥掉 /api 前缀，转发到后端 http://1.14.106.173:3001/v1/xxx
 *   3. 同源 HTTPS 调用，规避浏览器混合内容 (Mixed Content) 与 CORS 预检
 *   4. 透传 Authorization、Content-Type 等关键请求头，保证 JWT 鉴权链完整
 *   5. 透传响应体与状态码，保留后端原始业务语义
 *
 * 后端环境变量（建议在 EdgeOne 控制台 - 项目设置 - 环境变量 配置）：
 *   - API_BACKEND_URL  默认 http://1.14.106.173:3001
 *     若配置则使用环境变量，方便后续切换后端（如迁移到内网/HTTPS）
 */
const DEFAULT_BACKEND_URL = 'http://1.14.106.173:3001';

// 透传给后端的请求头白名单（小写匹配）
const FORWARD_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'accept-language',
  'x-requested-with',
  'x-trace-id',
  'user-agent',
  'if-none-match',
  'if-modified-since'
];

// 允许透传给客户端的响应头白名单（小写匹配）
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'etag',
  'last-modified',
  'x-trace-id',
  'x-total-count',
  'x-request-id',
  'set-cookie',
  'vary'
];

/**
 * 处理所有 HTTP 方法（GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS）
 */
async function handleRequest(context) {
  const { request, env } = context;

  // 后端地址（优先使用环境变量）
  const backendBase = (env && env.API_BACKEND_URL) || DEFAULT_BACKEND_URL;
  const backendOrigin = backendBase.replace(/\/+$/, '');

  // 解析请求 URL
  const url = new URL(request.url);
  const pathname = url.pathname || '/';
  const search = url.search || '';

  // 剥掉 /api 前缀（支持 /api/v1/xxx 与 /api 三种形式）
  let backendPath = pathname;
  if (backendPath === '/api' || backendPath === '/api/') {
    backendPath = '/';
  } else if (backendPath.startsWith('/api/')) {
    backendPath = backendPath.slice(4); // 保留前导 /
  } else if (backendPath.startsWith('/api')) {
    backendPath = backendPath.slice(4) || '/';
  }

  const backendUrl = backendOrigin + backendPath + search;

  // 构造转发请求头：只透传白名单 + Host 重写
  const reqHeaders = new Headers();
  FORWARD_REQUEST_HEADERS.forEach((h) => {
    const v = request.headers.get(h);
    if (v) reqHeaders.set(h, v);
  });
  // Origin/Referer 不透传，避免后端把 EdgeOne 当作来源做严格校验
  // Host 由 fetch 自动填充为后端 host
  // 对 OPTIONS 预检或无 body 的请求，不传 body
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

  // fetch 后端
  let backendResp;
  try {
    backendResp = await fetch(backendUrl, init);
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'BACKEND_UNREACHABLE',
        message: 'Edge Function 无法连接后端服务',
        backend: backendOrigin,
        path: backendPath,
        detail: String(err && err.message ? err.message : err)
      }),
      {
        status: 502,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        }
      }
    );
  }

  // 构造响应头：白名单透传 + 同源 CORS 放行
  const respHeaders = new Headers();
  FORWARD_RESPONSE_HEADERS.forEach((h) => {
    const v = backendResp.headers.get(h);
    if (v) respHeaders.set(h, v);
  });
  // 同源访问，CORS 全放行（前端与 EdgeOne Pages 同域，不会触发预检；
  // 即便有跨子域调用，也允许）
  respHeaders.set('access-control-allow-origin', '*');
  respHeaders.set('access-control-allow-credentials', 'true');
  respHeaders.set('access-control-allow-methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
  respHeaders.set(
    'access-control-allow-headers',
    'Content-Type,Authorization,X-Requested-With,X-Trace-Id,Accept-Language'
  );
  // 暴露自定义业务头给前端 JS
  respHeaders.set('access-control-expose-headers', 'X-Trace-Id,X-Total-Count,X-Request-Id');
  // 标记经 Edge Function 反代
  respHeaders.set('x-edge-proxy', 'qaxqjt-api');
  respHeaders.set('x-edge-backend', backendOrigin);

  return new Response(backendResp.body, {
    status: backendResp.status,
    statusText: backendResp.statusText,
    headers: respHeaders
  });
}

// 处理 OPTIONS 预检（虽然同源不会触发，但留作扩展兼容）
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

// EdgeOne Pages Function Handlers —— 匹配所有方法
export const onRequest = handleRequest;
export const onRequestOptions = handleOptions;
