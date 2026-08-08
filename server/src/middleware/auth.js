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
 * requireRole('super_admin') 或 requireRole(['ops','finance_admin'])
 * role level 数字越小权限越低，高等级 level 自动放行低等级接口（如 super_admin.level 999 > ops 800）
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
  const userLvl = ROLE_LEVEL[user.role] || 0;
  const ok = allowed.some(r => user.role === r || (ROLE_LEVEL[r] !== undefined && userLvl >= ROLE_LEVEL[r]));
  if (!ok) {
    throw new BusinessError('FORBIDDEN', `需要角色 ${allowed.join('/')}，当前 ${user.role}`);
  }
  return next();
};

/**
 * CORS 动态白名单（与 .env CORS_ORIGINS 保持单一来源）
 */
const corsOrigin = ctx => {
  const origin = ctx.get('origin');
  if (!origin) return '*';
  if (CORS_ORIGINS_ARRAY.length === 0) return origin; // 开发时放行
  if (CORS_ORIGINS_ARRAY.includes(origin) || CORS_ORIGINS_ARRAY.includes('*')) return origin;
  return ''; // 不匹配则拒绝
};

module.exports = { jwtAuth, requireAuth, requireRole, ROLE_LEVEL, corsOrigin, isPublic };
