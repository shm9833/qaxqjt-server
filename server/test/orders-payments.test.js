'use strict';

/**
 * 订单收款登记 POST /v1/orders/:id/payments 集成测试（HTTP 层 / supertest）
 * 覆盖：鉴权守卫（401/403/财务角色放行）、Joi 校验（400）、订单不存在（404）、
 *       已取消/退款订单（409）、超付拒绝（409）、成功路径状态机
 *       （confirmed→partial_paid / →paid、draft 经 confirmed、后段状态不改 status）、
 *       事务断言（finPaymentV1.create 流水 + finLedgerV1.create 台账凭证 + order.update 回写）
 * 桩：prisma（含 $transaction 交互式回调桩）+ audit-service，模式同 orders-integration.test.js
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
// findUnique 返回值可被测试用例覆盖（registerPayment 首尾各调用一次）
let _orderRecord = null;

const stubPrisma = {
  order: {
    findUnique: async args => { captured.findUnique = args; return _orderRecord; },
    update: async args => { captured.update = args; return { id: args.where.id, ...args.data }; },
    findMany: async () => [],
    count: async () => 0,
    create: async args => ({ id: 'ord_new_001', ...args.data }),
    delete: async () => ({})
  },
  orderItem: { createMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) },
  orderRefund: { deleteMany: async () => ({ count: 0 }), count: async () => 0 },
  finPaymentV1: {
    deleteMany: async () => ({ count: 0 }),
    count: async () => 0,
    findMany: async () => [],
    create: async args => { captured.paymentCreate = args; return { id: 'pay_stub', ...args.data }; }
  },
  finLedgerV1: {
    count: async () => 0,
    create: async args => { captured.ledgerCreate = args; return { id: 'ledger_stub', ...args.data }; }
  },
  scheduleV2: { findFirst: async () => null, findMany: async () => [], create: async () => ({}), update: async () => ({}), deleteMany: async () => ({ count: 0 }) },
  customersV1: { findFirst: async () => null, create: async args => ({ id: 'cust_new_001', ...args.data }) },
  // registerPayment 使用交互式事务：prisma.$transaction(async tx => {...})
  $transaction: async fn => fn({
    finPaymentV1: { create: async args => { captured.txPaymentCreate = args; return { id: 'pay_tx', ...args.data }; } },
    finLedgerV1: { create: async args => { captured.txLedgerCreate = args; return { id: 'ledger_tx', ...args.data }; } },
    order: { update: async args => { captured.txOrderUpdate = args; return { id: args.where.id, ...args.data }; } }
  })
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
// 默认被测订单：confirmed，应付 10000，已收 1000
const payOrder = (over = {}) => ({
  id: 'ord_pay_001', orderNo: 'T-PAY-001', status: 'confirmed',
  finalAmount: 10000, paidAmount: 1000, customerName: '测试客户', ...over
});
const post = (body, role = 'super_admin', id = 'ord_pay_001') =>
  request(handler).post('/v1/orders/' + id + '/payments').set(auth(role)).send(body);

// ========== 鉴权守卫 ==========

test('收款 无 token 返回 401', async () => {
  reset();
  const res = await request(handler).post('/v1/orders/ord_pay_001/payments').send({ amount: 100 });
  assert.strictEqual(res.status, 401);
});

test('收款 staff 角色返回 403 FORBIDDEN', async () => {
  reset();
  const res = await post({ amount: 100 }, 'staff');
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'FORBIDDEN');
});

test('收款 finance_cashier 财务角色放行（进入业务逻辑后 404）', async () => {
  reset();
  const res = await post({ amount: 100 }, 'finance_cashier', 'ord_notexist');
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'NOT_FOUND');
  assert.ok(captured.findUnique, '必须已进入 registerPayment 业务逻辑');
});

// ========== Joi 校验（路由层 validate） ==========

test('收款 缺少 amount 返回 400 VALIDATION_ERROR', async () => {
  reset();
  const res = await post({ remark: '未填金额' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('收款 amount=0 返回 400（必须为正数）', async () => {
  reset();
  const res = await post({ amount: 0 });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('收款 amount 负数返回 400', async () => {
  reset();
  const res = await post({ amount: -500 });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('收款 非法 payChannel 返回 400', async () => {
  reset();
  const res = await post({ amount: 100, payChannel: 'bitcoin' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

// ========== 业务前置校验 ==========

test('收款 订单不存在返回 404 NOT_FOUND', async () => {
  reset();
  const res = await post({ amount: 100 }, 'super_admin', 'ord_notexist');
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'NOT_FOUND');
  assert.ok(!captured.txPaymentCreate, '404 时不得产生任何写入');
});

test('收款 cancelled 订单返回 409 不能登记', async () => {
  reset();
  _orderRecord = payOrder({ status: 'cancelled' });
  const res = await post({ amount: 100 });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error.code, 'CONFLICT');
  assert.match(res.body.error.message, /不能登记收款/);
  assert.ok(!captured.txPaymentCreate, '终态订单不得产生任何写入');
});

test('收款 refunded 订单返回 409', async () => {
  reset();
  _orderRecord = payOrder({ status: 'refunded' });
  const res = await post({ amount: 100 });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error.code, 'CONFLICT');
});

test('收款 超付返回 409 且提示超过应付', async () => {
  reset();
  // 已收 1000 + 本次 9100 = 10100 > 应付 10000
  _orderRecord = payOrder();
  const res = await post({ amount: 9100 });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error.code, 'CONFLICT');
  assert.match(res.body.error.message, /超过应付/);
  assert.match(res.body.error.message, /10100/);
  assert.ok(!captured.txOrderUpdate, '超付时不得回写订单');
});

// ========== 成功路径：状态机 + 事务断言 ==========

test('收款 部分收款成功：201 + partial_paid + 事务三写入全量断言', async () => {
  reset();
  _orderRecord = payOrder(); // confirmed / 应付10000 / 已收1000
  const res = await post({ amount: 4000, payChannel: 'wechat', payDate: '2026-10-20', remark: '第二笔' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.data.id, 'ord_pay_001');

  // 事务：收款流水（PAY 单号 / payType in / 渠道 / 状态 confirmed）
  const pay = captured.txPaymentCreate;
  assert.ok(pay, '事务内必须创建收款流水');
  assert.match(pay.data.payNo, /^PAY/);
  assert.strictEqual(pay.data.payType, 'in');
  assert.strictEqual(pay.data.payChannel, 'wechat');
  assert.strictEqual(pay.data.amount, 4000);
  assert.strictEqual(pay.data.status, 'confirmed');
  assert.strictEqual(pay.data.currency, 'CNY');
  assert.strictEqual(pay.data.orderId, 'ord_pay_001');
  assert.strictEqual(pay.data.remark, '第二笔');
  assert.ok(pay.data.payDate instanceof Date && pay.data.payDate.getTime() === new Date('2026-10-20').getTime());

  // 事务：台账收入凭证（LSR 单号 / receipt / 演出收入 / 贷方 / <1万不复核）
  const ledger = captured.txLedgerCreate;
  assert.ok(ledger, '事务内必须创建台账凭证');
  assert.match(ledger.data.voucherNo, /^LSR/);
  assert.strictEqual(ledger.data.voucherType, 'receipt');
  assert.strictEqual(ledger.data.voucherCategory, '演出收入');
  assert.strictEqual(ledger.data.creditAmount, 4000);
  assert.strictEqual(ledger.data.debitAmount, 0);
  assert.strictEqual(ledger.data.cashFlowType, 'in');
  assert.strictEqual(ledger.data.doubleCheckRequired, false);
  assert.strictEqual(ledger.data.status, 'draft');
  assert.strictEqual(ledger.data.voucherNo, pay.data.voucherNo, '流水与台账凭证号必须一致');
  assert.match(ledger.data.summary, /T-PAY-001/);

  // 事务：订单回写（paidAmount 累加 + 状态推进 partial_paid）
  const upd = captured.txOrderUpdate;
  assert.ok(upd, '事务内必须回写订单');
  assert.strictEqual(upd.where.id, 'ord_pay_001');
  assert.strictEqual(upd.data.paidAmount, 5000);
  assert.strictEqual(upd.data.status, 'partial_paid');
});

test('收款 收齐尾款：confirmed + 收满 → 状态推进 paid', async () => {
  reset();
  _orderRecord = payOrder({ paidAmount: 9000 });
  const res = await post({ amount: 1000 });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(captured.txOrderUpdate.data.paidAmount, 10000);
  assert.strictEqual(captured.txOrderUpdate.data.status, 'paid');
});

test('收款 大额 ≥10000 触发台账 doubleCheckRequired', async () => {
  reset();
  _orderRecord = payOrder({ paidAmount: 0 });
  const res = await post({ amount: 10000 });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(captured.txLedgerCreate.data.doubleCheckRequired, true);
  assert.strictEqual(captured.txOrderUpdate.data.status, 'paid');
});

test('收款 draft 订单收款：路径经 confirmed，终态写入 paid', async () => {
  reset();
  _orderRecord = payOrder({ status: 'draft', paidAmount: 0, finalAmount: 5000 });
  const res = await post({ amount: 5000 });
  assert.strictEqual(res.status, 201);
  const upd = captured.txOrderUpdate.data;
  assert.strictEqual(upd.paidAmount, 5000);
  assert.strictEqual(upd.status, 'paid', 'draft 收齐应一次性写入终态 paid（路径 draft→confirmed→paid）');
});

test('收款 后段状态（performing）只回写 paidAmount 不改状态', async () => {
  reset();
  _orderRecord = payOrder({ status: 'performing' });
  const res = await post({ amount: 500 });
  assert.strictEqual(res.status, 201);
  const upd = captured.txOrderUpdate.data;
  assert.strictEqual(upd.paidAmount, 1500);
  assert.ok(!('status' in upd), '演出中订单收款不得自动推进状态');
});

test('收款 未传 payChannel 默认回退 transfer', async () => {
  reset();
  _orderRecord = payOrder();
  const res = await post({ amount: 100, payChannel: undefined });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(captured.txPaymentCreate.data.payChannel, 'transfer');
});
