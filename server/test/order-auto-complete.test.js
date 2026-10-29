'use strict';

/**
 * orders 演出结束自动完结测试（v20261029b）
 * 覆盖：list/stats/detail 前惰性触发 autoCompleteExpiredOrders；
 *       performance 状态 + performanceEndDate 已过 → 自动置 completed（completedDate=演出结束日）；
 *       未过期/非 performance 状态 → 不动；同步排期 + 审计留痕。
 * 桩：prisma（order/scheduleV2）+ audit-service（参照 orders-integration.test.js 模式）
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

// 可控行为：autoQuery 模拟「演出结束已过期」的订单集合；updates 记录 update 调用
let autoRows = [];      // autoCompleteExpiredOrders 的 findMany（where.performanceEndDate 存在时）返回
const updates = [];     // order.update 调用记录
const scheduleUpserts = [];

const stubPrisma = {
  order: {
    findMany: async args => {
      if (args.where && args.where.performanceEndDate) return autoRows; // 自动完结查询
      return []; // 列表/其他查询
    },
    count: async () => 0,
    groupBy: async () => [],
    aggregate: async () => ({ _count: { id: 0 }, _sum: { finalAmount: null } }),
    findUnique: async args => ({
      id: args.where.id, orderNo: 'ORD-TEST-001', status: 'performance',
      performanceStartDate: new Date('2026-10-20T00:00:00Z'),
      performanceEndDate: new Date('2026-10-22T00:00:00Z')
    }),
    update: async args => {
      updates.push(args);
      return { id: args.where.id, orderNo: 'ORD-TEST-001', status: 'performance',
        performanceStartDate: new Date('2026-10-20T00:00:00Z'),
        performanceEndDate: new Date('2026-10-22T00:00:00Z'), ...args.data };
    }
  },
  orderItem: { createMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) },
  orderRefund: { deleteMany: async () => ({ count: 0 }), count: async () => 0 },
  finPaymentV1: { deleteMany: async () => ({ count: 0 }), create: async () => ({}), findMany: async () => [], count: async () => 0 },
  finLedgerV1: { count: async () => 0 },
  scheduleV2: {
    findFirst: async () => ({ id: 'sch_1' }),
    update: async args => { scheduleUpserts.push(['update', args.data.status]); return {}; },
    create: async args => { scheduleUpserts.push(['create', args.data.status]); return {}; },
    findMany: async () => []
  },
  customersV1: { findFirst: async () => null }
};
require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: stubPrisma };

const auditCalls = [];
const auditId = require.resolve('../services/audit-service', { paths: [controllerDir] });
require.cache[auditId] = { id: auditId, filename: auditId, loaded: true, exports: { audit: async args => { auditCalls.push(args); } } };

const app = require('../src/app');
const handler = app.callback();

function signToken(role) {
  return jwt.sign(
    { sub: 'acc_test', username: 'testadmin', role, realName: '测试管理员' },
    process.env.JWT_ACCESS_SECRET,
    { issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' }
  );
}

test('演出结束已过期的 performance 订单在列表访问时自动完结', async () => {
  autoRows = [{ id: 'ord_expired_1', orderNo: 'ORD-EXP-1', performanceEndDate: new Date('2026-10-25T00:00:00Z') }];
  updates.length = 0; scheduleUpserts.length = 0; auditCalls.length = 0;

  const res = await request(handler)
    .get('/v1/orders?page=1&pageSize=10')
    .set('Authorization', 'Bearer ' + signToken('super_admin'));
  assert.strictEqual(res.status, 200);

  assert.strictEqual(updates.length, 1, '应恰好更新 1 条过期订单');
  assert.strictEqual(updates[0].where.id, 'ord_expired_1');
  assert.strictEqual(updates[0].data.status, 'completed');
  assert.ok(updates[0].data.completedDate instanceof Date, 'completedDate 应写入（取演出结束日）');
  assert.strictEqual(updates[0].data.completedDate.toISOString().substring(0, 10), '2026-10-25');
  assert.strictEqual(scheduleUpserts.length, 1, '应同步排期状态');
  assert.strictEqual(scheduleUpserts[0][1], 'completed');
  assert.strictEqual(auditCalls.length, 1);
  assert.strictEqual(auditCalls[0].action, 'ORDER_AUTO_COMPLETE');
});

test('未过期/非 performance 状态订单不被改动（幂等）', async () => {
  autoRows = []; // 无过期单
  updates.length = 0;

  const res = await request(handler)
    .get('/v1/orders?page=1&pageSize=10')
    .set('Authorization', 'Bearer ' + signToken('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(updates.length, 0, '无过期单时不应有任何 update');
});

test('自动完结单单失败不影响其余订单（逐单隔离）', async () => {
  autoRows = [
    { id: 'ord_bad_1', orderNo: 'ORD-BAD-1', performanceEndDate: new Date('2026-10-24T00:00:00Z') },
    { id: 'ord_good_1', orderNo: 'ORD-GOOD-1', performanceEndDate: new Date('2026-10-25T00:00:00Z') }
  ];
  updates.length = 0;
  const origUpdate = stubPrisma.order.update;
  stubPrisma.order.update = async args => {
    if (args.where.id === 'ord_bad_1') throw new Error('simulated db error');
    return origUpdate(args);
  };
  try {
    const res = await request(handler)
      .get('/v1/orders?page=1&pageSize=10')
      .set('Authorization', 'Bearer ' + signToken('super_admin'));
    assert.strictEqual(res.status, 200, '单单失败不应导致列表接口 5xx');
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0].where.id, 'ord_good_1');
  } finally {
    stubPrisma.order.update = origUpdate;
  }
});

test('detail 详情访问同样触发自动完结', async () => {
  autoRows = [{ id: 'ord_expired_2', orderNo: 'ORD-EXP-2', performanceEndDate: new Date('2026-10-23T00:00:00Z') }];
  updates.length = 0;

  const res = await request(handler)
    .get('/v1/orders/ord_expired_2')
    .set('Authorization', 'Bearer ' + signToken('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].where.id, 'ord_expired_2');
  assert.strictEqual(updates[0].data.status, 'completed');
});
