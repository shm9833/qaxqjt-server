'use strict';

/**
 * finance 控制器 M-15 双角色约束单元测试
 * 覆盖：update() 提交复核（status: draft→checked）时
 *   - admin / super_admin 角色豁免「制单人≠复核人」（2026-10-07 修复：线上 admin 实际 role=super_admin）
 *   - finance_maker / finance_checker / finance_admin 仍强制制单≠复核
 *   - 非豁免角色复核他人凭证正常放行
 *   - 状态机守卫未被豁免改动破坏（checked 不可重复提交）
 * 使用 require.cache 桩替换 prisma / audit-service（沿用 schedules-controller.test.js 模式）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const controllerDir = path.resolve(__dirname, '../src/controllers');
const prismaId = require.resolve('../utils/prisma', { paths: [controllerDir] });

// 桩 prisma：finLedgerV1.findUnique 返回当前测试设定的 old 行；update 捕获 patch
let currentOld = null;
let captured = {};
const stubPrisma = {
  finLedgerV1: {
    findUnique: async args => { captured.findUnique = args; return currentOld; },
    update: async args => { captured.update = args; return { ...currentOld, ...args.data }; }
  }
};
require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: stubPrisma };

// 桩 audit-service：消除副作用
const auditId = require.resolve('../services/audit-service', { paths: [controllerDir] });
require.cache[auditId] = { id: auditId, filename: auditId, loaded: true, exports: { audit: async () => {} } };

const finance = require('../src/controllers/finance');

function reset(oldRow) {
  currentOld = oldRow;
  captured = {};
}

/** 构造最小可用 ctx */
function mkCtx({ id = 'led_1', role, sub, body }) {
  return {
    params: { id },
    request: { body },
    state: { user: { sub, username: sub, role, realName: sub, roles: [] } },
    status: 0,
    body: null
  };
}

const DRAFT_BY_ADMIN = {
  id: 'led_1',
  voucherNo: 'LED202610080001AB',
  status: 'draft',
  makerAccountId: 'acc_superadmin_001',
  isReconciled: false
};

// ========== M-15 豁免：admin / super_admin ==========

test('M-15: super_admin 复核自己制单的凭证 → 放行（线上 admin 账号实际角色）', async () => {
  reset({ ...DRAFT_BY_ADMIN });
  const ctx = mkCtx({ role: 'super_admin', sub: 'acc_superadmin_001', body: { status: 'checked' } });
  await finance.update(ctx);
  assert.strictEqual(ctx.status, 200);
  assert.strictEqual(ctx.body.ok, true);
  assert.strictEqual(ctx.body.data.status, 'checked');
  // checker 允许等于 maker
  assert.strictEqual(captured.update.data.checkerAccountId, 'acc_superadmin_001');
  assert.ok(captured.update.data.checkedAt instanceof Date);
});

test('M-15: admin 角色复核自己制单的凭证 → 放行', async () => {
  reset({ ...DRAFT_BY_ADMIN, makerAccountId: 'acc_admin_002' });
  const ctx = mkCtx({ role: 'admin', sub: 'acc_admin_002', body: { status: 'checked' } });
  await finance.update(ctx);
  assert.strictEqual(ctx.status, 200);
  assert.strictEqual(ctx.body.data.status, 'checked');
  assert.strictEqual(captured.update.data.checkerAccountId, 'acc_admin_002');
});

// ========== M-15 保持强制：财务角色族 ==========

test('M-15: finance_maker 复核自己制单的凭证 → 403 FORBIDDEN', async () => {
  reset({ ...DRAFT_BY_ADMIN, makerAccountId: 'acc_maker_01' });
  const ctx = mkCtx({ role: 'finance_maker', sub: 'acc_maker_01', body: { status: 'checked' } });
  await assert.rejects(finance.update(ctx), err => {
    assert.strictEqual(err.key, 'FORBIDDEN');
    assert.match(err.message, /M-15/);
    return true;
  });
  // 拦截发生在 update 之前，不得落库
  assert.strictEqual(captured.update, undefined);
});

test('M-15: finance_checker 复核自己制单的凭证 → 403 FORBIDDEN', async () => {
  reset({ ...DRAFT_BY_ADMIN, makerAccountId: 'acc_checker_01' });
  const ctx = mkCtx({ role: 'finance_checker', sub: 'acc_checker_01', body: { status: 'checked' } });
  await assert.rejects(finance.update(ctx), err => {
    assert.strictEqual(err.key, 'FORBIDDEN');
    assert.match(err.message, /M-15/);
    return true;
  });
  assert.strictEqual(captured.update, undefined);
});

test('M-15: finance_admin 不在豁免名单，复核自己制单 → 403 FORBIDDEN', async () => {
  reset({ ...DRAFT_BY_ADMIN, makerAccountId: 'acc_finadmin_01' });
  const ctx = mkCtx({ role: 'finance_admin', sub: 'acc_finadmin_01', body: { status: 'checked' } });
  await assert.rejects(finance.update(ctx), err => {
    assert.strictEqual(err.key, 'FORBIDDEN');
    assert.match(err.message, /M-15/);
    return true;
  });
});

// ========== 正常复核路径不受影响 ==========

test('M-15: finance_checker 复核他人制单的凭证 → 放行', async () => {
  reset({ ...DRAFT_BY_ADMIN, makerAccountId: 'acc_maker_01' });
  const ctx = mkCtx({ role: 'finance_checker', sub: 'acc_checker_01', body: { status: 'checked' } });
  await finance.update(ctx);
  assert.strictEqual(ctx.status, 200);
  assert.strictEqual(ctx.body.data.status, 'checked');
  assert.strictEqual(captured.update.data.checkerAccountId, 'acc_checker_01');
});

test('M-15: super_admin 复核他人制单的凭证 → 放行', async () => {
  reset({ ...DRAFT_BY_ADMIN, makerAccountId: 'acc_maker_01' });
  const ctx = mkCtx({ role: 'super_admin', sub: 'acc_superadmin_001', body: { status: 'checked' } });
  await finance.update(ctx);
  assert.strictEqual(ctx.status, 200);
  assert.strictEqual(captured.update.data.checkerAccountId, 'acc_superadmin_001');
});

// ========== 状态机守卫未被破坏 ==========

test('状态机: 已复核凭证再次提交 checked → 409 CONFLICT（豁免角色也不例外）', async () => {
  reset({ ...DRAFT_BY_ADMIN, status: 'checked', checkerAccountId: 'acc_superadmin_001' });
  const ctx = mkCtx({ role: 'super_admin', sub: 'acc_superadmin_001', body: { status: 'checked' } });
  await assert.rejects(finance.update(ctx), err => {
    assert.strictEqual(err.key, 'CONFLICT');
    return true;
  });
  assert.strictEqual(captured.update, undefined);
});
