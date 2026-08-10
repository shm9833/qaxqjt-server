'use strict';

/**
 * src/app.js —— Koa 应用组装（不 listen，方便 supertest）
 */

// BigInt JSON 序列化修复（Prisma 的 ts 字段是 BigInt，JSON.stringify 默认不支持）
if (!BigInt.prototype.toJSON) {
  BigInt.prototype.toJSON = function () { return Number(this); };
}

const Koa = require('koa');
const cors = require('@koa/cors');
const helmet = require('koa-helmet');
const compress = require('koa-compress');
const { koaBody } = require('koa-body');
const morgan = require('koa-morgan');
const { env, isDev } = require('./config');
const { errorHandler } = require('./middleware/error-handler');
const { requestLog } = require('./middleware/request-log');
const { jwtAuth, requireAuth, corsOrigin } = require('./middleware/auth');
const v1Router = require('./routes/v1');

const app = new Koa();
app.proxy = true; // 信任 Nginx X-Forwarded-*，获取真实 client IP

// 1. 安全头（Helmet），CSP 宽松以便 Swagger/内嵌 iframe
app.use(
  helmet({
    contentSecurityPolicy: isDev ? false : { useDefaults: true, directives: { 'frame-ancestors': ["'self'"] } },
    hsts: isDev ? false : undefined
  })
);

// 2. 响应压缩（br/gzip）
app.use(
  compress({
    threshold: 1024,
    gzip: { flush: require('zlib').constants.Z_SYNC_FLUSH },
    deflate: { flush: require('zlib').constants.Z_SYNC_FLUSH },
    br: { quality: 8 }
  })
);

// 3. CORS：动态白名单 + Credentials=true
app.use(
  cors({
    origin: ctx => corsOrigin(ctx),
    credentials: env.CORS_CREDENTIALS,
    allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Trace-Id', 'Accept-Language'],
    exposeHeaders: ['X-Trace-Id', 'X-Total-Count', 'X-Request-Id'],
    maxAge: 86400
  })
);

// 4. Body 解析：JSON / form / 文件（50MB，合同扫描件/发票 PDF）
app.use(
  koaBody({
    multipart: true,
    jsonLimit: '5mb',
    formLimit: '5mb',
    textLimit: '5mb',
    formidable: { maxFileSize: 50 * 1024 * 1024, keepExtensions: true, multiples: true },
    parsedMethods: ['POST', 'PUT', 'PATCH', 'DELETE']
  })
);

// 5. 全局错误兜底（最外层 except 404）
app.use(errorHandler());

// 6. 请求日志 + traceId
app.use(requestLog());

// 7. 访问日志（Apache combined 格式，便于 Nginx 采集）
if (!isDev) {
  app.use(morgan('combined', { stream: { write: msg => require('./utils/logger').info(msg.trim()) } }));
}

// 8. JWT 解析：passthrough + requireAuth 两阶段
app.use(jwtAuth());
app.use(requireAuth({ allowAnonymous: true }));

// 9. v1 路由
app.use(v1Router.routes()).use(v1Router.allowedMethods());

module.exports = app;
