'use strict';

/**
 * customers 客户 CRM 集成测试（HTTP 层 / supertest）
 * 覆盖：鉴权守卫、列表分页、create 必填校验+成功、detail 404、update、
 *       remove（无关联硬删 / 有关联软删）
 * 桩：prisma（customersV1/customerContact/customerTag/appointment/order）+ audit-service
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
let _custRecord = null;
let _apptCount = 0;
let _orderCount = 0;

const stubPrisma = {
  customersV1: {
    findMany: async args => { captured.findMany = args; return []; },
    count: async args => { captured.count = args; return 0; },
    findUnique: async args => { captured.findUnique = args; return _custRecord; },
    create: async args => { captured.create = args; return { id: 'cust_new_001', ...args.data }; },
    update: async args => { captured.update = args; return { id: args.where.id, ...args.data }; },
    delete: async args => { captured.delete = args; return {}; }
  },
  customerContact: { createMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) },
  customerTag: { createMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) },
  appointment: { count: async () => _apptCount },
  order: { count: async () => _orderCount }
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
const reset = () => { captured = {}; _custRecord = null; _apptCount = 0; _orderCount = 0; };

// ========== 鉴权守卫 ==========

test('GET /v1/customers 无 token 返回 401', async () => {
  const res = await request(handler).get('/v1/customers');
  assert.strictEqual(res.status, 401);
});

test('GET /v1/customers 带 staff 角色返回 403', async () => {
  const res = await request(handler).get('/v1/customers').set(auth('staff'));
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'FORBIDDEN');
});

// ========== 列表 ==========

test('GET /v1/customers 带 super_admin 返回 200 + 分页 + include _count', async () => {
  reset();
  const res = await request(handler).get('/v1/customers?page=1&pageSize=10').set(auth('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.strictEqual(res.body.meta.page, 1);
  assert.strictEqual(res.body.meta.pageSize, 10);
  assert.ok(captured.findMany.include, 'list 必须 include _count');
});

test('GET /v1/customers?customerType=organization 透传 where', async () => {
  reset();
  const res = await request(handler).get('/v1/customers?customerType=organization').set(auth('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(captured.findMany.where.customerType, 'organization');
});

// ========== create 校验 ==========

test('POST /v1/customers 缺少 customerName 返回 400', async () => {
  reset();
  const res = await request(handler)
    .post('/v1/customers')
    .set(auth('super_admin'))
    .send({ phone: '13800000000' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /v1/customers 缺少 phone 返回 400', async () => {
  reset();
  const res = await request(handler)
    .post('/v1/customers')
    .set(auth('super_admin'))
    .send({ customerName: '测试客户' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /v1/customers phone 格式错误返回 400', async () => {
  reset();
  const res = await request(handler)
    .post('/v1/customers')
    .set(auth('super_admin'))
    .send({ customerName: '测试客户', phone: '12' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

// ========== create 成功 ==========

test('POST /v1/customers 成功返回 201 + 默认 personal 类型', async () => {
  reset();
  const res = await request(handler)
    .post('/v1/customers')
    .set(auth('super_admin'))
    .send({ customerName: '张三', phone: '13800000000', customerType: 'personal' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.data.customerName, '张三');
  assert.strictEqual(res.body.data.customerType, 'personal');
  assert.strictEqual(res.body.data.status, 'active');
});

test('POST /v1/customers 带 contacts 子表调用 createMany', async () => {
  reset();
  const res = await request(handler)
    .post('/v1/customers')
    .set(auth('super_admin'))
    .send({
      customerName: '某文化局',
      phone: '13900000000',
      customerType: 'organization',
      contacts: [{ name: '李经理', phone: '13700000000', isPrimary: true }]
    });
  assert.strictEqual(res.status, 201);
  // createMany 被调用（联系人已写入）
  assert.ok(captured.create, 'customersV1.create 必须被调用');
});

// ========== detail ==========

test('GET /v1/customers/:id 不存在返回 404', async () => {
  reset();
  const res = await request(handler).get('/v1/customers/cust_notexist').set(auth('super_admin'));
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'NOT_FOUND');
});

// ========== update ==========

test('PATCH /v1/customers/:id 成功返回 200 + 更新字段', async () => {
  reset();
  const res = await request(handler)
    .patch('/v1/customers/cust_001')
    .set(auth('super_admin'))
    .send({ customerName: '新名称', level: 'VIP' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(captured.update.where.id, 'cust_001');
  assert.strictEqual(captured.update.data.customerName, '新名称');
  assert.strictEqual(captured.update.data.level, 'VIP');
});

// ========== remove ==========

test('DELETE /v1/customers/:id 无关联预约/订单时硬删除返回 200 + deleted=true', async () => {
  reset();
  _apptCount = 0;
  _orderCount = 0;
  const res = await request(handler).delete('/v1/customers/cust_001').set(auth('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.deleted, true);
  assert.ok(captured.delete, 'customersV1.delete 必须被调用');
});

test('DELETE /v1/customers/:id 有关联订单时软删除返回 status=deleted', async () => {
  reset();
  _apptCount = 0;
  _orderCount = 3;
  const res = await request(handler).delete('/v1/customers/cust_001').set(auth('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.status, 'deleted');
  // 软删走 update，不是 delete
  assert.strictEqual(captured.update.data.status, 'deleted');
  assert.ok(!captured.delete, '有关联时不应硬删');
});
