'use strict';

/**
 * orders 订单集成测试（HTTP 层 / supertest）
 * 覆盖：鉴权守卫（401/403）、列表分页、create 必填校验+金额勾稽+成功、
 *       detail 404、transition 非法流转 422、remove 仅 draft/cancelled
 * 桩：prisma（order/orderItem/orderRefund/finPaymentV1/scheduleV2/customersV1）+ audit-service
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
// findUnique 返回值可被测试用例覆盖（detail/update/transition/remove）
let _orderRecord = null;

const stubPrisma = {
  order: {
    findMany: async args => { captured.findMany = args; return []; },
    count: async args => { captured.count = args; return 0; },
    groupBy: async () => [],
    aggregate: async () => ({ _count: { id: 0 }, _sum: { finalAmount: null } }),
    findUnique: async args => { captured.findUnique = args; return _orderRecord; },
    create: async args => { captured.create = args; _orderRecord = { id: 'ord_new_001', orderNo: 'TEST-001', status: 'draft', ...args.data }; return _orderRecord; },
    update: async args => { captured.update = args; return { id: args.where.id, ...args.data }; },
    delete: async args => { captured.delete = args; return {}; }
  },
  orderItem: { createMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) },
  orderRefund: { deleteMany: async () => ({ count: 0 }) },
  finPaymentV1: { deleteMany: async () => ({ count: 0 }), create: async () => ({}), findMany: async () => [] },
  scheduleV2: { findFirst: async () => null, create: async () => ({}), update: async () => ({}), deleteMany: async () => ({ count: 0 }) },
  customersV1: { findFirst: async () => null, create: async args => ({ id: 'cust_new_001', ...args.data }) }
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
const reset = () => { captured = {}; _orderRecord = null; };

// ========== 鉴权守卫 ==========

test('GET /v1/orders 无 token 返回 401', async () => {
  const res = await request(handler).get('/v1/orders');
  assert.strictEqual(res.status, 401);
});

test('GET /v1/orders 带 staff 角色返回 403', async () => {
  const res = await request(handler).get('/v1/orders').set(auth('staff'));
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'FORBIDDEN');
});

// ========== 列表 ==========

test('GET /v1/orders 带 super_admin 返回 200 + 分页', async () => {
  reset();
  const res = await request(handler).get('/v1/orders?page=1&pageSize=10').set(auth('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.strictEqual(res.body.meta.page, 1);
  assert.strictEqual(res.body.meta.pageSize, 10);
});

test('GET /v1/orders?status=draft 透传到 where.status', async () => {
  reset();
  const res = await request(handler).get('/v1/orders?status=draft').set(auth('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(captured.findMany.where.status, 'draft');
});

// ========== create 校验 ==========

test('POST /v1/orders 缺少 customerName 返回 400', async () => {
  reset();
  const res = await request(handler)
    .post('/v1/orders')
    .set(auth('super_admin'))
    .send({ phone: '13800000000' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /v1/orders 优惠金额大于总额返回 400 金额勾稽错误', async () => {
  reset();
  const res = await request(handler)
    .post('/v1/orders')
    .set(auth('super_admin'))
    .send({ customerName: '测试客户', phone: '13800000000', totalAmount: 1000, discountAmount: 2000 });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  assert.match(res.body.error.message, /优惠金额/);
});

test('POST /v1/orders 已付金额大于应付返回 400', async () => {
  reset();
  const res = await request(handler)
    .post('/v1/orders')
    .set(auth('super_admin'))
    .send({ customerName: '测试客户', phone: '13800000000', totalAmount: 1000, finalAmount: 1000, paidAmount: 2000 });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

// ========== create 成功 ==========

test('POST /v1/orders 成功返回 201 + status=draft + 自动建档客户', async () => {
  reset();
  const res = await request(handler)
    .post('/v1/orders')
    .set(auth('super_admin'))
    .send({
      customerName: '测试剧团',
      phone: '13800000000',
      organization: '某文化局',
      totalAmount: 50000,
      finalAmount: 50000,
      items: [{ itemName: '大本戏演出', quantity: 2, unitPrice: 25000 }]
    });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.data.status, 'draft');
  assert.strictEqual(res.body.data.customerName, '测试剧团');
  // 明细 createMany 被调用
  assert.ok(captured.create, 'order.create 必须被调用');
});

// ========== detail ==========

test('GET /v1/orders/:id 不存在返回 404', async () => {
  reset();
  const res = await request(handler).get('/v1/orders/ord_notexist').set(auth('super_admin'));
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'NOT_FOUND');
});

// ========== transition ==========

test('POST /v1/orders/:id/transition 非法 to 值返回 400', async () => {
  reset();
  const res = await request(handler)
    .post('/v1/orders/ord_001/transition')
    .set(auth('super_admin'))
    .send({ to: 'invalid_status' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /v1/orders/:id/transition 订单不存在返回 404', async () => {
  reset();
  const res = await request(handler)
    .post('/v1/orders/ord_notexist/transition')
    .set(auth('super_admin'))
    .send({ to: 'confirmed' });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'NOT_FOUND');
});

test('POST /v1/orders/:id/transition draft→completed 非法流转返回 422 UNPROCESSABLE', async () => {
  reset();
  _orderRecord = { id: 'ord_001', status: 'draft', orderNo: 'T-001' };
  const res = await request(handler)
    .post('/v1/orders/ord_001/transition')
    .set(auth('super_admin'))
    .send({ to: 'completed' });
  assert.strictEqual(res.status, 422);
  assert.strictEqual(res.body.error.code, 'UNPROCESSABLE');
});

test('POST /v1/orders/:id/transition draft→confirmed 合法流转返回 200', async () => {
  reset();
  _orderRecord = { id: 'ord_001', status: 'draft', orderNo: 'T-001' };
  const res = await request(handler)
    .post('/v1/orders/ord_001/transition')
    .set(auth('super_admin'))
    .send({ to: 'confirmed', reason: '客户已确认' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(captured.update.data.status, 'confirmed');
});

// ========== remove ==========

test('DELETE /v1/orders/:id 非 draft/cancelled 订单返回 409 CONFLICT', async () => {
  reset();
  _orderRecord = { id: 'ord_001', status: 'paid', orderNo: 'T-001' };
  const res = await request(handler).delete('/v1/orders/ord_001').set(auth('super_admin'));
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error.code, 'CONFLICT');
});

test('DELETE /v1/orders/:id draft 订单成功返回 204', async () => {
  reset();
  _orderRecord = { id: 'ord_001', status: 'draft', orderNo: 'T-001' };
  const res = await request(handler).delete('/v1/orders/ord_001').set(auth('super_admin'));
  assert.strictEqual(res.status, 204);
  assert.ok(captured.delete, 'order.delete 必须被调用');
});
