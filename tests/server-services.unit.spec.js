/* tests/server-services.unit.spec.js — server/src/services 服务层单元测试
 *
 * 用法：node tests/server-services.unit.spec.js
 * 依赖：测试自身零依赖（Node 内置 assert/path）；Prisma 单例以内存方法桩替换，
 *      全程不连数据库/网络。
 *
 * 覆盖：
 *   order-payment-sync 增量对账模型：target/net/diff、幂等、部分补差、退款抵减、
 *     EPS 死区、负收款钳制、0.1+0.2 舍入、流水+台账同事务字段契约、
 *     10000 复核阈值、actor/makerAccountId、冲销禁令（diff<0 只告警）
 *   audit-service      字段映射、匿名回退、UA 截断、detail JSON、写库失败隔离
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/qaxqjt_unit';
process.env.JWT_ACCESS_SECRET = 'unit_test_access_secret_0123456789';
process.env.JWT_REFRESH_SECRET = 'unit_test_refresh_secret_0123456789';
process.env.BCRYPT_ROUNDS = '8';

const assert = require('assert');
const path = require('path');

const SRC = path.join(__dirname, '..', 'server', 'src');

/* ---------- Prisma 单例打桩（必须在 require 服务之前拿到引用） ---------- */
const prisma = require(path.join(SRC, 'utils', 'prisma'));

let payRows = [];
let txCalls = 0;
let findManyCalls = 0;
let lastPayCreate = null;
let lastLedgerCreate = null;

prisma.finPaymentV1 = {
  findMany: async () => { findManyCalls += 1; return payRows; }
};
prisma.$transaction = async fn => {
  txCalls += 1;
  return fn({
    finPaymentV1: { create: async ({ data }) => { lastPayCreate = data; return data; } },
    finLedgerV1: { create: async ({ data }) => { lastLedgerCreate = data; return data; } }
  });
};

let auditCreateImpl = async () => ({ ok: true });
prisma.auditLog = { create: (...args) => auditCreateImpl(...args) };

const { syncOrderPayments } = require(path.join(SRC, 'services', 'order-payment-sync'));
const { audit } = require(path.join(SRC, 'services', 'audit-service'));

const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓ ' + name); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}

const resetState = (rows = []) => {
  payRows = rows;
  txCalls = 0;
  findManyCalls = 0;
  lastPayCreate = null;
  lastLedgerCreate = null;
};

/* 静默服务内 console.warn（diff<0 / 审计失败路径），并断言确实告警 */
let warns = [];
const origWarn = console.warn;
console.warn = (...args) => { warns.push(args.join(' ')); };

(async () => {
  console.log('server-services.unit.spec — order-payment-sync / audit-service\n');

  /* ==================== order-payment-sync ==================== */
  await t('空订单/缺 id：零操作且不查库', async () => {
    resetState();
    assert.deepStrictEqual(await syncOrderPayments(null), { synced: 0, target: 0, net: 0, diff: 0 });
    assert.deepStrictEqual(await syncOrderPayments({}), { synced: 0, target: 0, net: 0, diff: 0 });
    assert.strictEqual(findManyCalls, 0);
    assert.strictEqual(txCalls, 0);
  });
  await t('target=0 无流水：幂等零操作', async () => {
    resetState([]);
    const r = await syncOrderPayments({ id: 'ord_1', orderNo: 'SO001', paidAmount: 0 });
    assert.deepStrictEqual(r, { synced: 0, target: 0, net: 0, diff: 0 });
    assert.strictEqual(txCalls, 0);
  });
  await t('首次收款 500：补一笔 in 流水 + receipt 草稿台账（同事务、同 voucherNo）', async () => {
    resetState([]);
    const r = await syncOrderPayments({ id: 'ord_2', orderNo: 'SO002', customerName: '张三', paidAmount: 500 });
    assert.strictEqual(r.synced, 1);
    assert.strictEqual(r.target, 500);
    assert.strictEqual(r.net, 0);
    assert.strictEqual(r.diff, 500);
    assert.strictEqual(txCalls, 1);
    assert.strictEqual(findManyCalls, 1);
    assert.ok(lastPayCreate.id.startsWith('pay_'), lastPayCreate.id);
    assert.ok(/^PAY\d{12}[0-9A-Z]{6}$/.test(lastPayCreate.payNo), lastPayCreate.payNo);
    assert.strictEqual(lastPayCreate.orderId, 'ord_2');
    assert.strictEqual(lastPayCreate.payType, 'in');
    assert.strictEqual(lastPayCreate.payChannel, 'transfer');
    assert.strictEqual(lastPayCreate.amount, 500);
    assert.strictEqual(lastPayCreate.currency, 'CNY');
    assert.strictEqual(lastPayCreate.status, 'confirmed');
    assert.strictEqual(lastPayCreate.payerName, '张三');
    assert.strictEqual(lastPayCreate.createdBy, 'system');
    assert.strictEqual(typeof lastPayCreate.ts, 'bigint');
    assert.ok(lastLedgerCreate.id.startsWith('led_'));
    assert.ok(/^LSR\d{12}[0-9A-Z]{4}$/.test(lastLedgerCreate.voucherNo));
    assert.strictEqual(lastLedgerCreate.voucherNo, lastPayCreate.voucherNo);
    assert.strictEqual(lastLedgerCreate.voucherType, 'receipt');
    assert.strictEqual(lastLedgerCreate.voucherCategory, '演出收入');
    assert.strictEqual(lastLedgerCreate.orderId, 'ord_2');
    assert.strictEqual(lastLedgerCreate.creditAmount, 500);
    assert.strictEqual(lastLedgerCreate.debitAmount, 0);
    assert.strictEqual(lastLedgerCreate.cashFlowType, 'in');
    assert.strictEqual(lastLedgerCreate.cashFlowAmount, 500);
    assert.strictEqual(lastLedgerCreate.status, 'draft'); // 自动凭证一律草稿
    assert.strictEqual(lastLedgerCreate.doubleCheckRequired, false);
    assert.strictEqual(lastLedgerCreate.isReconciled, false);
    assert.strictEqual(lastLedgerCreate.makerAccountId, null); // actor=system
    assert.strictEqual(lastLedgerCreate.createdBy, 'system');
    assert.strictEqual(lastLedgerCreate.remark, '由订单收款自动生成，收款流水号 ' + lastPayCreate.payNo);
    assert.ok(lastLedgerCreate.summary.indexOf('SO002') >= 0 && lastLedgerCreate.summary.indexOf('张三') >= 0);
  });
  await t('幂等：已有 500 in 流水、target=500 → 零操作（重复 PATCH/回填重跑安全）', async () => {
    resetState([{ payType: 'in', amount: 500 }]);
    const r = await syncOrderPayments({ id: 'ord_3', orderNo: 'SO003', paidAmount: 500 });
    assert.strictEqual(r.synced, 0);
    assert.strictEqual(r.diff, 0);
    assert.strictEqual(txCalls, 0);
  });
  await t('部分补差：net=300 target=1000 → 仅补 700', async () => {
    resetState([{ payType: 'in', amount: 300 }]);
    const r = await syncOrderPayments({ id: 'ord_4', orderNo: 'SO004', paidAmount: 1000 });
    assert.strictEqual(r.synced, 1);
    assert.strictEqual(r.diff, 700);
    assert.strictEqual(lastPayCreate.amount, 700);
    assert.strictEqual(lastLedgerCreate.creditAmount, 700);
  });
  await t('退款抵减：in 1000 + out 300 → net=700；target=700 零操作；target=1000 再补 300', async () => {
    resetState([{ payType: 'in', amount: 1000 }, { payType: 'out', amount: 300 }]);
    const r1 = await syncOrderPayments({ id: 'ord_5', orderNo: 'SO005', paidAmount: 700 });
    assert.strictEqual(r1.net, 700);
    assert.strictEqual(r1.synced, 0);
    const r2 = await syncOrderPayments({ id: 'ord_5', orderNo: 'SO005', paidAmount: 1000 });
    assert.strictEqual(r2.synced, 1);
    assert.strictEqual(r2.diff, 300);
  });
  await t('大额阈值：diff≥10000 时台账 doubleCheckRequired=true（边界等值触发）', async () => {
    resetState([{ payType: 'in', amount: 1 }]);
    const r = await syncOrderPayments({ id: 'ord_6', orderNo: 'SO006', paidAmount: 10001 });
    assert.strictEqual(r.diff, 10000);
    assert.strictEqual(lastLedgerCreate.doubleCheckRequired, true);
    resetState([]);
    const r2 = await syncOrderPayments({ id: 'ord_7', orderNo: 'SO007', paidAmount: 9999.99 });
    assert.strictEqual(lastLedgerCreate.doubleCheckRequired, false);
    assert.strictEqual(r2.diff, 9999.99);
  });
  await t('冲销禁令：paidAmount 调减导致 net>target（diff<0）→ 只告警、不动账、保留历史凭证', async () => {
    resetState([{ payType: 'in', amount: 800 }]);
    warns = [];
    const r = await syncOrderPayments({ id: 'ord_8', orderNo: 'SO008', paidAmount: 500 });
    assert.strictEqual(r.synced, 0);
    assert.strictEqual(r.diff, -300);
    assert.strictEqual(r.net, 800);
    assert.strictEqual(txCalls, 0);
    assert.ok(warns.some(w => w.indexOf('order-payment-sync') >= 0 && w.indexOf('SO008') >= 0));
  });
  await t('负 paidAmount 钳制为 0；流水脏数据 amount 缺失按 0 计', async () => {
    resetState([{ payType: 'in' }, { payType: 'out', amount: 'abc' }]);
    const r = await syncOrderPayments({ id: 'ord_9', orderNo: 'SO009', paidAmount: -50 });
    assert.strictEqual(r.target, 0);
    assert.strictEqual(r.net, 0);
    assert.strictEqual(r.synced, 0);
  });
  await t('浮点舍入：0.1+0.2 target 经 round2=0.3 正常补差（EPS=0.001 死区）', async () => {
    resetState([]);
    const r = await syncOrderPayments({ id: 'ord_10', orderNo: 'SO010', paidAmount: 0.1 + 0.2 });
    assert.strictEqual(r.diff, 0.3);
    assert.strictEqual(r.synced, 1);
    assert.strictEqual(lastPayCreate.amount, 0.3);
  });
  await t('EPS 死区：|diff|≤0.001 视为已平账，返回 diff:0 且不补单', async () => {
    resetState([{ payType: 'in', amount: 100.0005 }]);
    const r = await syncOrderPayments({ id: 'ord_11', orderNo: 'SO011', paidAmount: 100 });
    assert.strictEqual(r.synced, 0);
    assert.strictEqual(r.diff, 0);
    assert.strictEqual(txCalls, 0);
  });
  await t('actor 透传：制单人 id 落 createdBy 与 makerAccountId；无客户名时 payerName=null 且摘要无分隔符', async () => {
    resetState([]);
    const r = await syncOrderPayments(
      { id: 'ord_12', orderNo: 'SO012', customerName: '', paidAmount: 10 },
      { actor: 'acc_99' }
    );
    assert.strictEqual(r.synced, 1);
    assert.strictEqual(lastPayCreate.createdBy, 'acc_99');
    assert.strictEqual(lastPayCreate.payerName, null);
    assert.strictEqual(lastLedgerCreate.makerAccountId, 'acc_99');
    assert.strictEqual(lastLedgerCreate.createdBy, 'acc_99');
    assert.strictEqual(lastLedgerCreate.summary, '订单收款（SO012）');
  });

  /* ==================== audit-service ==================== */
  const mkAuditCtx = (over = {}) => ({
    state: { user: { sub: 'acc_1', username: 'admin' } },
    request: { body: {} },
    ip: '5.6.7.8',
    get: h => (h === 'user-agent' ? 'Mozilla/5.0-QAX' : ''),
    ...over
  });
  await t('audit：完整字段映射（id 前缀/操作人/时间戳 BigInt/detail JSON/ip/UA）', async () => {
    let captured = null;
    prisma.auditLog.create = async ({ data }) => { captured = data; return data; };
    await audit({ ctx: mkAuditCtx(), module: 'orders', action: 'create', targetType: 'order', targetId: 'ord_2', detail: { a: 1, b: ['x'] } });
    assert.ok(captured.id.startsWith('aud_'), captured.id);
    assert.strictEqual(captured.accountId, 'acc_1');
    assert.strictEqual(captured.username, 'admin');
    assert.strictEqual(captured.module, 'orders');
    assert.strictEqual(captured.action, 'create');
    assert.strictEqual(captured.targetType, 'order');
    assert.strictEqual(captured.targetId, 'ord_2');
    assert.strictEqual(captured.ipAddress, '5.6.7.8');
    assert.strictEqual(captured.userAgent, 'Mozilla/5.0-QAX');
    assert.strictEqual(captured.detailJson, JSON.stringify({ a: 1, b: ['x'] }));
    assert.ok(captured.actionTs instanceof Date);
    assert.strictEqual(typeof captured.ts, 'bigint');
  });
  await t('audit：module 缺省 general；target 缺省 null；无 detail 时 detailJson=null', async () => {
    let captured = null;
    prisma.auditLog.create = async ({ data }) => { captured = data; return data; };
    await audit({ ctx: mkAuditCtx(), action: 'ping' });
    assert.strictEqual(captured.module, 'general');
    assert.strictEqual(captured.targetType, null);
    assert.strictEqual(captured.targetId, null);
    assert.strictEqual(captured.detailJson, null);
  });
  await t('audit：匿名操作人回退链 — body.username → anonymous', async () => {
    let captured = null;
    prisma.auditLog.create = async ({ data }) => { captured = data; return data; };
    const ctx1 = mkAuditCtx({ state: {}, request: { body: { username: 'tried_login_name' } } });
    await audit({ ctx: ctx1, action: 'login_fail' });
    assert.strictEqual(captured.accountId, null);
    assert.strictEqual(captured.username, 'tried_login_name');
    const ctx2 = mkAuditCtx({ state: {}, request: { body: {} } });
    await audit({ ctx: ctx2, action: 'ping' });
    assert.strictEqual(captured.username, 'anonymous');
  });
  await t('audit：UA 超 480 字符截断；空 UA 落 null', async () => {
    let captured = null;
    prisma.auditLog.create = async ({ data }) => { captured = data; return data; };
    const longUA = 'U'.repeat(600);
    await audit({ ctx: mkAuditCtx({ get: h => (h === 'user-agent' ? longUA : '') }), action: 'x' });
    assert.strictEqual(captured.userAgent.length, 480);
    await audit({ ctx: mkAuditCtx({ get: () => '' }), action: 'x' });
    assert.strictEqual(captured.userAgent, null);
  });
  await t('audit 失败隔离：写库抛错只告警，不向调用方抛出', async () => {
    warns = [];
    prisma.auditLog.create = async () => { throw new Error('DB down'); };
    let threw = false;
    try { await audit({ ctx: mkAuditCtx(), module: 'm', action: 'a' }); }
    catch (_e) { threw = true; }
    assert.strictEqual(threw, false);
    assert.ok(warns.some(w => w.indexOf('[audit] write failed') >= 0 && w.indexOf('DB down') >= 0));
    prisma.auditLog.create = auditCreateImpl;
  });

  console.warn = origWarn;

  /* ==================== 汇总 ==================== */
  const failed = results.filter(r => !r.ok);
  console.log('\n========================================');
  console.log('总计 ' + results.length + ' 项：✓ ' + (results.length - failed.length) + ' 通过，✗ ' + failed.length + ' 失败');
  if (failed.length) {
    failed.forEach(r => { console.error('\n[FAIL] ' + r.name); console.error(r.err && r.err.stack || r.err); });
    process.exit(1);
  }
  console.log('全部通过');
  process.exit(0);
})().catch(e => { console.warn = origWarn; console.error(e); process.exit(1); });
