'use strict';

/**
 * src/middleware/auth.js —— JWT 鉴权 + 角色/权限守卫
 * 可选跳过：publicUrls（登录/健康检查/预约提交）
 * ctx.state.user = { sub, username, role, realName }
 */
const koaJwt = require('koa-jwt');
const { env, CORS_ORIGINS_ARRAY } = require('../config');
const { BusinessError } = require('./error-handler');

const publicUrls = [
  /^\/v1\/healthz$/,
  /^\/v1\/auth\/(login|refresh)$/,
  /^\/v1\/public\//,
  /^\/v1\/appointments(\/.*)?$/ // 预约公开页提交可匿名，写操作会二次校验
];

const isPublic = path => publicUrls.some(re => re.test(path));

// 鉴权中间件：publicUrl 跳过，其余必填
const jwtAuth = () =>
  koaJwt({
    secret: env.JWT_ACCESS_SECRET,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    key: 'jwtPayload',
    passthrough: true, // 失败不直接 401，交给下面的 guard 决定
    getToken: ctx => {
      const h = ctx.get('authorization') || '';
      if (h.startsWith('Bearer ')) return h.slice(7);
      const q = ctx.query.access_token;
      if (q) return String(q);
      // 兼容 cookie
      const c = ctx.cookies.get('x_a_t');
      return c || null;
    }
  });

// 真正的 guard：决定是否允许匿名
const requireAuth = opts => async (ctx, next) => {
  const payload = ctx.state.jwtPayload;
  if (!payload) {
    if (opts?.allowAnonymous || isPublic(ctx.path)) {
      ctx.state.user = null;
      return next();
    }
    throw new BusinessError('UNAUTHORIZED', '请先登录');
  }
  ctx.state.user = {
    sub: payload.sub,
    username: payload.username,
    role: payload.role,
    realName: payload.realName,
    roles: payload.roles || []
  };
  return next();
};

/**
 * 角色等级（仅保留作参考/导出兼容，鉴权不再使用数值继承）
 *
 * 安全说明：早期实现用 level 数值"高等级自动放行低等级接口"，但各业务族
 * （运营/导演/财务制单/复核/出纳/只读）并非同一条权限链——例如
 * finance_view(只读) 数值高于 finance_admin，会导致只读账号能删除财务凭证、
 * 复核人能当制单人，破坏 maker/checker 分离。故 requireRole 改为与路由
 * 显式名单精确匹配（super_admin 已在各路由名单中显式列出）。
 */
const ROLE_LEVEL = {
  super_admin: 999,
  ops: 800,
  director: 700,
  finance_checker: 600,
  finance_maker: 550,
  finance_admin: 500,
  finance_cashier: 520,
  finance_view: 510,
  staff: 100
};

const requireRole = roles => async (ctx, next) => {
  const user = ctx.state.user;
  if (!user) throw new BusinessError('UNAUTHORIZED', '请先登录');
  const allowed = Array.isArray(roles) ? roles : [roles];
  // 精确名单匹配，禁止跨业务族的等级继承
  if (!allowed.includes(user.role)) {
    throw new BusinessError('FORBIDDEN', `需要角色 ${allowed.join('/')}，当前 ${user.role}`);
  }
  return next();
};

/**
 * CORS 动态白名单（与 .env CORS_ORIGINS 保持单一来源）
 * 安全规则：
 *  - 仅当 Origin 命中显式白名单时才回显该 Origin（配合 credentials=true）
 *  - 白名单为空：开发环境放行便于本地联调；生产环境一律拒绝，防止漏配变成"全放行"
 *  - 生产环境 credentials=true 时不接受 '*' 通配（带凭证的通配响应会被浏览器拦截且等价于全放行）
 */
const corsOrigin = ctx => {
  const origin = ctx.get('origin');
  if (!origin) return '*'; // 无 Origin（同源/非浏览器）不构成跨域
  const allowCreds = env.CORS_CREDENTIALS !== false;
  if (CORS_ORIGINS_ARRAY.length === 0) {
    return env.NODE_ENV === 'production' ? '' : origin;
  }
  if (CORS_ORIGINS_ARRAY.includes(origin)) return origin;
  if (CORS_ORIGINS_ARRAY.includes('*') && !(env.NODE_ENV === 'production' && allowCreds)) return origin;
  return ''; // 不匹配则拒绝
};

module.exports = { jwtAuth, requireAuth, requireRole, ROLE_LEVEL, corsOrigin, isPublic };
