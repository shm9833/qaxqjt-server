'use strict';

/**
 * schedules 控制器集成测试（HTTP 层 / supertest）
 *
 * 与单元测试的差异：本测试启动真实 Koa 应用（app.callback()），
 * 走全量中间件链（helmet/cors/koaBody/errorHandler/jwtAuth/requireAuth/validate/requireRole），
 * 用 jsonwebtoken 签发真实 JWT，验证：
 *  - 路由匹配（避免之前 orders.html 用 ORD... 撞 :id 路由的 404 类问题）
 *  - 鉴权守卫（无 token → 401，错角色 → 403，正确角色 → 200）
 *  - 参数校验（query 不合 Joi schema → 400 VALIDATION_ERROR）
 *  - 响应格式（success 包装 / 分页 meta / calendar/stats/conflicts 各自结构）
 *  - select 投影 / groupBy 聚合 真实下发到 prisma 层
 *
 * 桩：prisma（require.cache 桩，捕获调用参数）+ audit-service（无操作桩）
 */
// 1. 必须在 require app 之前注入 env（config.js 在 require 时立即校验）
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://stub:stub@stub.neon.db/stub';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || 'test_jwt_access_secret_min_64_chars_xxxxxxxxxxxx';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_min_64_chars_xxxxxxxxxxx';
process.env.JWT_ISSUER = process.env.JWT_ISSUER || 'qaxqjt-cloud';
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'qaxqjt-admin-front';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const request = require('supertest');

// 2. stub prisma：捕获 schedules 用到的全部 model 调用
const controllerDir = path.resolve(__dirname, '../src/controllers');
const prismaId = require.resolve('../utils/prisma', { paths: [controllerDir] });

let captured = {};
const stubPrisma = {
  scheduleV2: {
    findMany: async args => { captured.findMany = args; return []; },
    count: async args => { captured.count = args; return 0; },
    findUnique: async args => { captured.findUnique = args; return null; },
    create: async args => { captured.create = args; return args && args.data; },
    update: async args => { captured.update = args; return args && args.data; },
    delete: async () => ({}),
    groupBy: async args => { captured.groupBy = args; return []; },
    aggregate: async args => {
      captured.aggregate = args;
      return {
        _count: { id: 0 },
        _sum: { feeAmount: null, audienceSize: null, actualAttendance: null }
      };
    }
  },
  // public 接口用到的 model，仅做空返回，避免 require 阶段或路由命中时炸
  play: { findMany: async () => [], count: async () => 0 },
  playCategory: { findMany: async () => [], count: async () => 0 },
  performersDbV1: { findMany: async () => [], count: async () => 0 },
  contentV2: { count: async () => 0 },
  castSheetsV1: { findMany: async () => [], findUnique: async () => null }
};
require.cache[prismaId] = {
  id: prismaId, filename: prismaId, loaded: true, exports: stubPrisma
};

// 3. stub audit-service（避免真实审计写库）
const auditId = require.resolve('../services/audit-service', { paths: [controllerDir] });
require.cache[auditId] = {
  id: auditId, filename: auditId, loaded: true, exports: { audit: async () => {} }
};

// 4. 加载真实 app（一次性，所有测试共享）
const app = require('../src/app');
const handler = app.callback();

function reset() { captured = {}; }

/**
 * 签发 JWT（与 auth.js 的 payload 结构一致）
 * { sub, username, role, realName }
 */
function signToken(role) {
  return jwt.sign(
    { sub: 'acc_test', username: 'testadmin', role, realName: '测试管理员' },
    process.env.JWT_ACCESS_SECRET,
    {
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
      expiresIn: '1h'
    }
  );
}

function auth(role) {
  return { Authorization: 'Bearer ' + signToken(role) };
}

// ========== 健康检查 ==========

test('GET /v1/healthz 无鉴权返回 200 + ok=true', async () => {
  const res = await request(handler).get('/v1/healthz');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.service, 'qaxqjt-api');
});

// ========== 公开接口（无鉴权）==========

test('GET /v1/schedules/public 公开排期无 token 返回 200 + data 数组', async () => {
  const res = await request(handler).get('/v1/schedules/public');
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data), 'data 必须是数组');
});

test('GET /v1/stats/public 公开统计无 token 返回 200', async () => {
  const res = await request(handler).get('/v1/stats/public');
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data, 'data 必须存在');
});

// ========== 鉴权守卫 ==========

test('GET /v1/schedules 无 token 返回 401 UNAUTHORIZED', async () => {
  const res = await request(handler).get('/v1/schedules');
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
});

test('GET /v1/schedules 错误 token（无 Bearer 前缀）返回 401', async () => {
  const res = await request(handler)
    .get('/v1/schedules')
    .set('Authorization', signToken('super_admin')); // 缺 "Bearer "
  assert.strictEqual(res.status, 401);
});

test('GET /v1/schedules 带 staff 角色（不在名单内）返回 403 FORBIDDEN', async () => {
  const res = await request(handler)
    .get('/v1/schedules')
    .set(auth('staff'));
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'FORBIDDEN');
});

// ========== 鉴权成功 + 路由匹配 ==========

test('GET /v1/schedules 带 super_admin token 返回 200 + 分页结构 + select 投影下发', async () => {
  reset();
  const res = await request(handler)
    .get('/v1/schedules?page=1&pageSize=10')
    .set(auth('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.meta, '必须返回分页 meta');
  assert.strictEqual(res.body.meta.page, 1);
  assert.strictEqual(res.body.meta.pageSize, 10);
  assert.ok(captured.findMany.select, 'list 必须用 select 投影');
  assert.strictEqual(captured.findMany.select.id, true);
  assert.strictEqual(captured.findMany.select.playTitle, true);
  assert.strictEqual(captured.findMany.skip, 0);
  assert.strictEqual(captured.findMany.take, 10);
  assert.deepStrictEqual(captured.findMany.orderBy, { scheduleDateStart: 'asc' });
});

test('GET /v1/schedules?year=2026&month=9 透传到 where（年月范围）', async () => {
  reset();
  const res = await request(handler)
    .get('/v1/schedules?year=2026&month=9')
    .set(auth('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.ok(captured.findMany.where.scheduleDateStart, '必须构造日期范围 where');
  assert.ok(captured.findMany.where.scheduleDateStart.gte instanceof Date);
  assert.ok(captured.findMany.where.scheduleDateStart.lte instanceof Date);
});

test('GET /v1/schedules/calendar 带 staff token 返回 200 + year/month 回写', async () => {
  reset();
  const res = await request(handler)
    .get('/v1/schedules/calendar?year=2026&month=9')
    .set(auth('staff'));
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.strictEqual(res.body.meta.year, 2026);
  assert.strictEqual(res.body.meta.month, 9);
  // calendar 必须用 CALENDAR_SELECT 精简投影（不取 remark/feeAmount 等重字段）
  assert.ok(captured.findMany.select, 'calendar 必须用 select 投影');
  assert.strictEqual(captured.findMany.select.id, true);
  assert.strictEqual(captured.findMany.select.scheduleNo, true);
  assert.strictEqual(captured.findMany.select.remark, undefined, 'calendar 不应取 remark');
});

test('GET /v1/schedules/conflicts 带 ops token 返回 200 + conflicts 数组', async () => {
  reset();
  const res = await request(handler)
    .get('/v1/schedules/conflicts?dateFrom=2026-09-01&dateTo=2026-09-30')
    .set(auth('ops'));
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data, 'data 必须存在');
  assert.ok(Array.isArray(res.body.data.conflicts), 'conflicts 必须是数组');
  assert.strictEqual(typeof res.body.data.total, 'number');
});

test('GET /v1/schedules/conflicts 带 finance_view 角色（不在名单）返回 403', async () => {
  const res = await request(handler)
    .get('/v1/schedules/conflicts')
    .set(auth('finance_view'));
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'FORBIDDEN');
});

test('GET /v1/schedules/stats 带 finance_view token 返回 200 + groupBy/aggregate 下发', async () => {
  reset();
  const res = await request(handler)
    .get('/v1/schedules/stats?year=2026&month=9')
    .set(auth('finance_view'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.year, 2026);
  assert.strictEqual(res.body.data.month, 9);
  assert.ok('scheduled' in res.body.data, 'stats 必须含 scheduled 计数');
  assert.ok('totalFee' in res.body.data, 'stats 必须含 totalFee');
  assert.ok(captured.groupBy, 'stats 必须调用 groupBy');
  assert.deepStrictEqual(captured.groupBy.by, ['status']);
  assert.ok(captured.aggregate, 'stats 必须调用 aggregate');
  assert.ok(captured.aggregate._sum.feeAmount);
});

// ========== 路由参数 + 错误路径 ==========

test('GET /v1/schedules/:id 不存在返回 404 NOT_FOUND', async () => {
  reset();
  const res = await request(handler)
    .get('/v1/schedules/sch_notexist_001')
    .set(auth('super_admin'));
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'NOT_FOUND');
  // 验证 findUnique 用了路径参数作为 where.id
  assert.strictEqual(captured.findUnique.where.id, 'sch_notexist_001');
});

test('GET /v1/schedules?year=abc 非法参数返回 400 VALIDATION_ERROR', async () => {
  const res = await request(handler)
    .get('/v1/schedules?year=abc')
    .set(auth('super_admin'));
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(res.body.error.detail), '校验错误必须带 detail 数组');
});

test('GET /v1/schedules/calendar?month=13 越界返回 400', async () => {
  const res = await request(handler)
    .get('/v1/schedules/calendar?month=13')
    .set(auth('staff'));
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

// ========== 路由不存在兜底 ==========

test('GET /v1/schedules/nonexistent/xxx 路径不存在返回 404', async () => {
  const res = await request(handler)
    .get('/v1/schedules/nonexistent/xxx')
    .set(auth('super_admin'));
  assert.strictEqual(res.status, 404);
});

// ========== 405 方法NotAllowed ==========

test('POST /v1/schedules/calendar（只允许 GET）返回 405', async () => {
  const res = await request(handler)
    .post('/v1/schedules/calendar')
    .set(auth('super_admin'));
  // Koa @koa/router allowedMethods 默认返回 405
  assert.ok([405, 404].includes(res.status), '应返回 405 或 404');
});
