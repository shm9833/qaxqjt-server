'use strict';

/**
 * performers 演职人员花名册集成测试（HTTP 层 / supertest）
 * 覆盖：鉴权守卫（401/403）、列表分页、create 校验+成功、detail 404、
 *       update、remove 软删、self-register 公开接口校验+成功、review
 * 桩：prisma（performersDbV1 及工资同步相关 model）+ audit-service
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://stub:stub@stub.neon.db/stub';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_jwt_access_secret_min_64_chars_xxxxxxxxxxxx';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_min_64_chars_xxxxxxxxxxx';
process.env.JWT_ISSUER = process.env.JWT_ISSUER || 'qaxqjt-cloud';
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'qaxqjt-admin-front';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const controllerDir = path.resolve(__dirname, '../src/controllers');
const prismaId = require.resolve('../utils/prisma', { paths: [controllerDir] });

let captured = {};
const stubPrisma = {
  performersDbV1: {
    findMany: async args => { captured.findMany = args; return []; },
    count: async args => { captured.count = args; return 0; },
    findUnique: async args => { captured.findUnique = args; return null; },
    findFirst: async args => { captured.findFirst = args; return null; },
    create: async args => { captured.create = args; return { id: 'pf_new_001', ...args.data }; },
    update: async args => { captured.update = args; return { id: args.where.id, ...args.data }; },
    updateMany: async () => ({ count: 0 })
  },
  // 工资同步链路：draft 批次为空 → 不触发工资条创建/更新
  wageBatchesV1: { findMany: async () => [], update: async () => ({}) },
  wageItemsV1: { findFirst: async () => null, update: async () => ({}), create: async () => ({}) },
  wageRulesV1: { findFirst: async () => null },
  attendanceV1: { findMany: async () => [], groupBy: async () => [] },
  castSheetCrew: { findMany: async () => [] },
  play: { findMany: async () => [] }
};
require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: stubPrisma };

const auditId = require.resolve('../services/audit-service', { paths: [controllerDir] });
require.cache[auditId] = { id: auditId, filename: auditId, loaded: true, exports: { audit: async () => {} } };

const app = require('../src/app');
const handler = app.callback();

function signToken(role) {
  return jwt.sign(
    { sub: 'acc_test', username: 'testadmin', role, realName: '测试管理员' },
    process.env.JWT_ACCESS_SECRET,
    { issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' }
  );
}
const auth = role => ({ Authorization: 'Bearer ' + signToken(role) });
const reset = () => { captured = {}; };

// ========== 鉴权守卫 ==========

test('GET /v1/performers 无 token 返回 401', async () => {
  const res = await request(handler).get('/v1/performers');
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
});

test('GET /v1/performers 带 staff 角色（不在名单）返回 403', async () => {
  const res = await request(handler).get('/v1/performers').set(auth('staff'));
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'FORBIDDEN');
});

// ========== 列表 ==========

test('GET /v1/performers 带 super_admin 返回 200 + 分页结构 + 默认排除 deleted', async () => {
  reset();
  const res = await request(handler).get('/v1/performers?page=1&pageSize=10').set(auth('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.strictEqual(res.body.meta.page, 1);
  assert.strictEqual(res.body.meta.pageSize, 10);
  // 默认 where.status = { not: 'deleted' }
  assert.deepStrictEqual(captured.findMany.where.status, { not: 'deleted' });
  assert.strictEqual(captured.findMany.skip, 0);
  assert.strictEqual(captured.findMany.take, 10);
  assert.deepStrictEqual(captured.findMany.orderBy, { createdAt: 'desc' });
});

test('GET /v1/performers?status=active 透传 where.status', async () => {
  reset();
  const res = await request(handler).get('/v1/performers?status=active').set(auth('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(captured.findMany.where.status, 'active');
});

test('GET /v1/performers?keyword=张三 构造 OR 模糊匹配', async () => {
  reset();
  const res = await request(handler).get('/v1/performers?keyword=%E5%BC%A0%E4%B8%89').set(auth('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(captured.findMany.where.OR), 'keyword 必须构造 OR');
  assert.ok(captured.findMany.where.OR.some(c => c.name && c.name.contains === '张三'));
});

// ========== create ==========

test('POST /v1/performers 缺少 name 返回 400 VALIDATION_ERROR', async () => {
  const res = await request(handler)
    .post('/v1/performers')
    .set(auth('super_admin'))
    .send({ primaryRole: '生角' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /v1/performers 成功返回 201 + 自动分配工号 PF001', async () => {
  reset();
  const res = await request(handler)
    .post('/v1/performers')
    .set(auth('super_admin'))
    .send({ name: '张三', primaryRole: '生角', dailyRate: 300 });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.data.name, '张三');
  assert.strictEqual(res.body.data.staffNo, 'PF001', '无 staffNo 时应自动分配 PF001');
  assert.strictEqual(res.body.data.status, 'active');
  assert.strictEqual(res.body.data.dailyRate, 300);
});

// ========== detail ==========

test('GET /v1/performers/:id 不存在返回 404 NOT_FOUND', async () => {
  reset();
  const res = await request(handler).get('/v1/performers/pf_notexist').set(auth('super_admin'));
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'NOT_FOUND');
  assert.strictEqual(captured.findUnique.where.id, 'pf_notexist');
});

// ========== update ==========

test('PATCH /v1/performers/:id 成功返回 200 + 更新字段', async () => {
  reset();
  const res = await request(handler)
    .patch('/v1/performers/pf_001')
    .set(auth('super_admin'))
    .send({ phone: '13900000000', status: 'left' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(captured.update.where.id, 'pf_001');
  assert.strictEqual(captured.update.data.phone, '13900000000');
  assert.strictEqual(captured.update.data.status, 'left');
});

// ========== remove（软删）==========

test('DELETE /v1/performers/:id 返回 200 + status=deleted（软删除）', async () => {
  reset();
  const res = await request(handler).delete('/v1/performers/pf_001').set(auth('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.status, 'deleted');
  // 软删走 update，不是 prisma.delete
  assert.strictEqual(captured.update.where.id, 'pf_001');
  assert.strictEqual(captured.update.data.status, 'deleted');
});

// ========== self-register（公开，无需鉴权）==========

test('POST /v1/performers/self-register 未确认条例返回 400', async () => {
  const res = await request(handler)
    .post('/v1/performers/self-register')
    .send({ name: '李四', idCardNo: '110101199001011234', regulationsConfirmed: false });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  assert.match(res.body.error.message, /条例/);
});

test('POST /v1/performers/self-register 身份证号格式错误返回 400', async () => {
  const res = await request(handler)
    .post('/v1/performers/self-register')
    .send({ name: '李四', idCardNo: '123', regulationsConfirmed: true });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /v1/performers/self-register 成功返回 201 + status=pending', async () => {
  reset();
  const res = await request(handler)
    .post('/v1/performers/self-register')
    .send({ name: '李四', idCardNo: '110101199001011234', regulationsConfirmed: true, primaryRole: '旦角' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.data.status, 'pending');
  assert.strictEqual(res.body.data.name, '李四');
});

// ========== review ==========

test('PATCH /v1/performers/:id/review 非法 action 返回 400', async () => {
  reset();
  const res = await request(handler)
    .patch('/v1/performers/pf_001/review')
    .set(auth('super_admin'))
    .send({ action: 'invalid' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /v1/performers/:id/review 人员不存在返回 404', async () => {
  reset();
  const res = await request(handler)
    .patch('/v1/performers/pf_notexist/review')
    .set(auth('super_admin'))
    .send({ action: 'approve' });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'NOT_FOUND');
});
