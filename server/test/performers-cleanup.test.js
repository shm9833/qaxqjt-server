'use strict';

/**
 * performers 清理接口（cleanupDisabled）单元测试
 * 覆盖需求点：
 *   1. 禁用前置删除（remove 仅删 disabled，active/pending → 403）
 *   2. 清理接口 ids 批量 / 默认分页两种模式
 *   4. 删除/清理审计留痕（操作人 ctx、时间戳、被删人员明细）
 *   5. 并发安全（条件 updateMany，count=0 不抛异常，重复清理 cleaned:0）
 *   6. pageSize 归一化（默认50、最小1、上限200）
 * 权限（requireRole）与 Joi 入参校验在 HTTP 层测试（performers-integration.test.js）覆盖
 * 使用 require.cache 桩替换 prisma / audit-service，不连数据库
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://stub:stub@127.0.0.1:3306/stub';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_jwt_access_secret_min_64_chars_xxxxxxxxxxxx';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_min_64_chars_xxxxxxxxxxx';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const controllerDir = path.resolve(__dirname, '../src/controllers');
const prismaId = require.resolve('../utils/prisma', { paths: [controllerDir] });

// ========== 桩 prisma（状态可按用例覆盖，全程记录调用参数） ==========
const state = {
  findManyResult: null, // null = 用内联默认（[]）
  countResults: null, // 数组：每次 count 顺序返回；null 恒返回 0
  updateManyResult: { count: 0 },
  findUniqueResult: null,
  updateResult: null,
  calls: { findMany: [], count: [], updateMany: [], findUnique: [], update: [] }
};

const reset = () => {
  state.findManyResult = null;
  state.countResults = null;
  state.updateManyResult = { count: 0 };
  state.findUniqueResult = null;
  state.updateResult = null;
  state.calls = { findMany: [], count: [], updateMany: [], findUnique: [], update: [] };
  auditCalls.length = 0;
};

const auditCalls = [];

const stubPrisma = {
  performersDbV1: {
    findMany: async args => {
      state.calls.findMany.push(args);
      return state.findManyResult || [];
    },
    count: async args => {
      state.calls.count.push(args);
      if (Array.isArray(state.countResults) && state.countResults.length) return state.countResults.shift();
      return 0;
    },
    updateMany: async args => {
      state.calls.updateMany.push(args);
      return state.updateManyResult;
    },
    findUnique: async args => {
      state.calls.findUnique.push(args);
      return state.findUniqueResult;
    },
    update: async args => {
      state.calls.update.push(args);
      return state.updateResult || Object.assign({ id: args.where.id }, args.data);
    }
  }
};
require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: stubPrisma };

// ========== 桩 audit（记录全部审计调用） ==========
const auditId = require.resolve('../services/audit-service', { paths: [controllerDir] });
require.cache[auditId] = {
  id: auditId,
  filename: auditId,
  loaded: true,
  exports: { audit: async payload => { auditCalls.push(payload); } }
};

const ctrl = require('../src/controllers/performers/core');

const makeCtx = (body = {}) => ({
  request: { body },
  params: { id: 'pf_test_1' },
  query: {},
  state: { user: { id: 'acc_admin_1', username: 'admin', role: 'super_admin' } },
  status: 0,
  body: null
});

const disabledRow = (over = {}) => Object.assign(
  { id: 'pf_test_1', name: '张三', staffNo: 'QXT-001', status: 'disabled', primaryRole: '生角', employmentType: '全职', rankGrade: 'W3', dailyRate: 300 },
  over
);

// ========== 一、默认分页模式 ==========

test('cleanup：无 body 走分页模式，where=disabled、updatedAt 升序、take 默认 50', async () => {
  reset();
  const ctx = makeCtx({});
  await ctrl.cleanupDisabled(ctx);
  assert.strictEqual(state.calls.findMany.length, 1);
  const args = state.calls.findMany[0];
  assert.deepStrictEqual(args.where, { status: 'disabled' });
  assert.deepStrictEqual(args.orderBy, { updatedAt: 'asc' }, '分页模式按 updatedAt 升序取最旧禁用记录');
  assert.strictEqual(args.take, 50);
  assert.ok(args.select, 'findMany 必须 select 限定字段');
  assert.strictEqual(args.select.id, true);
  assert.strictEqual(ctx.body.ok, true);
  assert.deepStrictEqual(ctx.body.data, { cleaned: 0, remaining: 0, skipped: 0 });
  assert.strictEqual(state.calls.updateMany.length, 0, '无目标时不得执行 updateMany');
  assert.strictEqual(auditCalls.length, 0, '无清理动作时不得写审计');
});

test('cleanup：pageSize=10 透传 take=10', async () => {
  reset();
  await ctrl.cleanupDisabled(makeCtx({ pageSize: 10 }));
  assert.strictEqual(state.calls.findMany[0].take, 10);
});

test('cleanup：pageSize 归一化（0/NaN→50，负数→1，超上限→200，字符串数字可解析）', async () => {
  reset();
  const cases = [
    [0, 50],
    [-5, 1],
    ['abc', 50],
    [null, 50],
    [999, 200],
    [201, 200],
    [1, 1],
    ['20', 20],
    [10.9, 10]
  ];
  for (const [input, expected] of cases) {
    reset();
    await ctrl.cleanupDisabled(makeCtx({ pageSize: input }));
    assert.strictEqual(state.calls.findMany[0].take, expected, `pageSize=${JSON.stringify(input)} 应归一化为 ${expected}`);
  }
});

test('cleanup：分页成功路径——条件软删 + 返回 cleaned/remaining/pageSize', async () => {
  reset();
  state.findManyResult = [
    { id: 'p1', name: '张三', staffNo: 'QXT-001', primaryRole: '生角', employmentType: '全职', rankGrade: 'W3', dailyRate: 300 },
    { id: 'p2', name: '李四', staffNo: 'QXT-002', primaryRole: '旦角', employmentType: '全职', rankGrade: 'W2', dailyRate: 280 }
  ];
  state.countResults = [5, 3]; // 清理前 5 条 disabled，清理后剩 3
  state.updateManyResult = { count: 2 };
  const ctx = makeCtx({ pageSize: 10 });
  await ctrl.cleanupDisabled(ctx);

  // 并发安全：updateMany 必须带 status='disabled' 条件
  assert.strictEqual(state.calls.updateMany.length, 1);
  const um = state.calls.updateMany[0];
  assert.deepStrictEqual(um.where, { id: { in: ['p1', 'p2'] }, status: 'disabled' });
  assert.strictEqual(um.data.status, 'deleted');
  assert.ok(um.data.updatedAt instanceof Date);
  assert.strictEqual(typeof um.data.ts, 'bigint');

  assert.deepStrictEqual(ctx.body.data, { cleaned: 2, remaining: 3, skipped: 0, pageSize: 10 });
  assert.strictEqual(state.calls.count.length, 2, '清理前后各 count 一次');
});

// ========== 二、ids 批量模式 ==========

test('cleanup：ids 模式按 id:in 查询，不按 updatedAt 排序、不分页 take', async () => {
  reset();
  state.findManyResult = [disabledRow({ id: 'p1' })];
  state.countResults = [1, 0];
  state.updateManyResult = { count: 1 };
  const ctx = makeCtx({ ids: ['p1'] });
  await ctrl.cleanupDisabled(ctx);

  const args = state.calls.findMany[0];
  assert.deepStrictEqual(args.where, { status: 'disabled', id: { in: ['p1'] } });
  assert.strictEqual(args.orderBy, undefined);
  assert.strictEqual(args.take, undefined);
  assert.strictEqual(ctx.body.data.cleaned, 1);
  assert.strictEqual(ctx.body.data.skipped, 0);
});

test('cleanup：ids 过滤非字符串/空串元素', async () => {
  reset();
  state.findManyResult = [];
  await ctrl.cleanupDisabled(makeCtx({ ids: ['p1', 123, null, '', 'p2', { x: 1 }] }));
  assert.deepStrictEqual(state.calls.findMany[0].where.id.in, ['p1', 'p2']);
});

test('cleanup：ids 超过 200 截断为 200', async () => {
  reset();
  state.findManyResult = [];
  const ids = Array.from({ length: 205 }, (_, i) => 'p' + i);
  await ctrl.cleanupDisabled(makeCtx({ ids }));
  assert.strictEqual(state.calls.findMany[0].where.id.in.length, 200);
});

test('cleanup：ids 为空数组时回退分页模式', async () => {
  reset();
  await ctrl.cleanupDisabled(makeCtx({ ids: [] }));
  const args = state.calls.findMany[0];
  assert.deepStrictEqual(args.where, { status: 'disabled' });
  assert.strictEqual(args.take, 50);
});

test('cleanup：ids 全部不是 disabled 时 cleaned:0、skipped=请求数、不写库不审计', async () => {
  reset();
  state.findManyResult = [];
  state.countResults = [2]; // 库中另有 2 条 disabled（非本次目标）
  const ctx = makeCtx({ ids: ['x1', 'x2', 'x3'] });
  await ctrl.cleanupDisabled(ctx);
  assert.deepStrictEqual(ctx.body.data, { cleaned: 0, remaining: 2, skipped: 3 });
  assert.strictEqual(state.calls.updateMany.length, 0);
  assert.strictEqual(auditCalls.length, 0);
});

test('cleanup：ids 请求 3 条但仅 2 条仍为 disabled，skipped=1', async () => {
  reset();
  state.findManyResult = [disabledRow({ id: 'p1' }), disabledRow({ id: 'p2' })];
  state.countResults = [2, 0];
  state.updateManyResult = { count: 2 };
  const ctx = makeCtx({ ids: ['p1', 'p2', 'p3'] });
  await ctrl.cleanupDisabled(ctx);
  assert.strictEqual(ctx.body.data.cleaned, 2);
  assert.strictEqual(ctx.body.data.skipped, 1, 'p3 不是 disabled（已被启用/删除）→ skipped');
});

// ========== 三、并发场景 ==========

test('cleanup：查到目标但 updateMany count=0（被并发请求先删）不抛异常，cleaned:0', async () => {
  reset();
  state.findManyResult = [disabledRow({ id: 'p1' }), disabledRow({ id: 'p2' })];
  state.countResults = [0, 0];
  state.updateManyResult = { count: 0 };
  const ctx = makeCtx({ ids: ['p1', 'p2'] });
  await ctx_guard_no_throw(ctx);
  assert.strictEqual(ctx.body.data.cleaned, 0);
  assert.strictEqual(ctx.body.data.skipped, 2);
  // 汇总审计仍如实记录 cleaned:0，逐条明细保留目标快照（可追溯并发竞争）
  const summary = auditCalls.find(a => a.action === 'PERFORMER_CLEANUP_DISABLED');
  assert.ok(summary, '即使 count=0 也要写汇总审计');
  assert.strictEqual(summary.detail.cleaned, 0);
  const details = auditCalls.filter(a => a.action === 'PERFORMER_SOFT_DELETE');
  assert.strictEqual(details.length, 2);
});

async function ctx_guard_no_throw(ctx) {
  await assert.doesNotReject(() => ctrl.cleanupDisabled(ctx));
}

test('cleanup：重复清理（已无 disabled）直接 cleaned:0，无写库无审计', async () => {
  reset();
  state.findManyResult = [];
  state.countResults = [0];
  const ctx = makeCtx({ pageSize: 50 });
  await ctrl.cleanupDisabled(ctx);
  assert.strictEqual(ctx.body.data.cleaned, 0);
  assert.strictEqual(ctx.body.data.remaining, 0);
  assert.strictEqual(state.calls.updateMany.length, 0);
  assert.strictEqual(auditCalls.length, 0);
});

// ========== 四、审计字段 ==========

test('cleanup：审计含汇总（requested/cleaned/pageSize/at）+ 逐条明细（操作人/人员信息/deletedAt/via）', async () => {
  reset();
  state.findManyResult = [
    { id: 'p1', name: '张三', staffNo: '', primaryRole: null, employmentType: '全职', rankGrade: null, dailyRate: 300 },
    { id: 'p2', name: '李四', staffNo: null, primaryRole: '旦角', employmentType: null, rankGrade: 'W2', dailyRate: null }
  ];
  state.countResults = [2, 0];
  state.updateManyResult = { count: 2 };
  const ctx = makeCtx({ ids: ['p1', 'p2'] });
  await ctrl.cleanupDisabled(ctx);

  assert.strictEqual(auditCalls.length, 3, '1 条汇总 + 2 条逐条明细');
  const summary = auditCalls[0];
  assert.strictEqual(summary.module, 'performers');
  assert.strictEqual(summary.action, 'PERFORMER_CLEANUP_DISABLED');
  assert.strictEqual(summary.detail.requested, 2);
  assert.strictEqual(summary.detail.cleaned, 2);
  assert.strictEqual(summary.detail.pageSize, 50, 'ids 模式 pageSize 仍取归一化默认值回传');
  assert.ok(!Number.isNaN(Date.parse(summary.detail.at)), 'at 必须是 ISO 时间字符串');

  const d1 = auditCalls.find(a => a.targetId === 'p1');
  assert.strictEqual(d1.action, 'PERFORMER_SOFT_DELETE');
  assert.strictEqual(d1.ctx.state.user.username, 'admin', '审计透传 ctx → 操作人可追溯');
  assert.strictEqual(d1.detail.name, '张三');
  assert.strictEqual(d1.detail.staffNo, null, '空串工号归一化为 null');
  assert.strictEqual(d1.detail.primaryRole, null);
  assert.strictEqual(d1.detail.dailyRate, 300);
  assert.strictEqual(d1.detail.via, 'cleanup', '明细须标记来自批量清理');
  assert.ok(!Number.isNaN(Date.parse(d1.detail.deletedAt)));

  const d2 = auditCalls.find(a => a.targetId === 'p2');
  assert.strictEqual(d2.detail.staffNo, null);
  assert.strictEqual(d2.detail.dailyRate, null, 'null 日薪保持 null');
});

// ========== 五、remove：禁用前置删除守卫链 ==========

test('remove：人员不存在抛 NOT_FOUND', async () => {
  reset();
  state.findUniqueResult = null;
  await assert.rejects(
    () => ctrl.remove(makeCtx()),
    err => err.key === 'NOT_FOUND'
  );
  assert.strictEqual(state.calls.updateMany.length, 0);
});

test('remove：status=deleted 抛 NOT_FOUND', async () => {
  reset();
  state.findUniqueResult = disabledRow({ status: 'deleted' });
  await assert.rejects(() => ctrl.remove(makeCtx()), err => err.key === 'NOT_FOUND');
});

test('remove：status=active 抛 FORBIDDEN 并提示先禁用', async () => {
  reset();
  state.findUniqueResult = disabledRow({ status: 'active' });
  await assert.rejects(
    () => ctrl.remove(makeCtx()),
    err => err.key === 'FORBIDDEN' && /禁用/.test(err.message)
  );
  assert.strictEqual(state.calls.updateMany.length, 0, '未禁用人员不得执行删除写库');
});

test('remove：status=pending 抛 FORBIDDEN', async () => {
  reset();
  state.findUniqueResult = disabledRow({ status: 'pending' });
  await assert.rejects(() => ctrl.remove(makeCtx()), err => err.key === 'FORBIDDEN');
});

test('remove：disabled 条件软删成功，返回 status=deleted 并写快照审计', async () => {
  reset();
  state.findUniqueResult = disabledRow();
  state.updateManyResult = { count: 1 };
  const ctx = makeCtx();
  await ctrl.remove(ctx);

  assert.deepStrictEqual(state.calls.updateMany[0].where, { id: 'pf_test_1', status: 'disabled' });
  assert.strictEqual(state.calls.updateMany[0].data.status, 'deleted');
  assert.deepStrictEqual(ctx.body.data, { id: 'pf_test_1', status: 'deleted' });

  assert.strictEqual(auditCalls.length, 1);
  const a = auditCalls[0];
  assert.strictEqual(a.action, 'PERFORMER_SOFT_DELETE');
  assert.strictEqual(a.targetId, 'pf_test_1');
  assert.strictEqual(a.detail.name, '张三');
  assert.strictEqual(a.detail.staffNo, 'QXT-001');
  assert.strictEqual(a.detail.dailyRate, 300);
  assert.ok(!Number.isNaN(Date.parse(a.detail.deletedAt)));
  assert.strictEqual(a.detail.via, undefined, '单条删除明细不带 cleanup 标记');
  assert.strictEqual(a.ctx.state.user.username, 'admin');
});

test('remove：快照为 disabled 但条件更新 count=0（并发竞争）抛 CONFLICT 且不写审计', async () => {
  reset();
  state.findUniqueResult = disabledRow();
  state.updateManyResult = { count: 0 };
  await assert.rejects(() => ctrl.remove(makeCtx()), err => err.key === 'CONFLICT');
  assert.strictEqual(auditCalls.length, 0, '竞争失败不得写删除成功审计');
});

// ========== 六、disable / enable 状态机（删除前置动作） ==========

test('disable：人员不存在抛 NOT_FOUND', async () => {
  reset();
  state.findUniqueResult = null;
  await assert.rejects(() => ctrl.disable(makeCtx()), err => err.key === 'NOT_FOUND');
});

test('disable：已 deleted 抛 NOT_FOUND', async () => {
  reset();
  state.findUniqueResult = disabledRow({ status: 'deleted' });
  await assert.rejects(() => ctrl.disable(makeCtx()), err => err.key === 'NOT_FOUND');
});

test('disable：已是 disabled 幂等返回 unchanged:true，不写库不审计', async () => {
  reset();
  state.findUniqueResult = disabledRow({ status: 'disabled' });
  const ctx = makeCtx();
  await ctrl.disable(ctx);
  assert.deepStrictEqual(ctx.body.data, { id: 'pf_test_1', status: 'disabled', unchanged: true });
  assert.strictEqual(state.calls.update.length, 0);
  assert.strictEqual(auditCalls.length, 0);
});

test('disable：active → disabled，写库并记录 PERFORMER_DISABLE（from/to/操作人）', async () => {
  reset();
  state.findUniqueResult = disabledRow({ status: 'active' });
  const ctx = makeCtx();
  await ctrl.disable(ctx);
  assert.strictEqual(state.calls.update[0].data.status, 'disabled');
  assert.strictEqual(ctx.body.data.status, 'disabled');
  assert.strictEqual(ctx.body.data.unchanged, undefined);
  assert.strictEqual(auditCalls.length, 1);
  assert.strictEqual(auditCalls[0].action, 'PERFORMER_DISABLE');
  assert.strictEqual(auditCalls[0].detail.from, 'active');
  assert.strictEqual(auditCalls[0].detail.to, 'disabled');
  assert.strictEqual(auditCalls[0].ctx.state.user.username, 'admin');
});

test('enable：disabled → active，记录 PERFORMER_ENABLE', async () => {
  reset();
  state.findUniqueResult = disabledRow({ status: 'disabled' });
  const ctx = makeCtx();
  await ctrl.enable(ctx);
  assert.strictEqual(state.calls.update[0].data.status, 'active');
  assert.strictEqual(auditCalls[0].action, 'PERFORMER_ENABLE');
  assert.strictEqual(auditCalls[0].detail.from, 'disabled');
  assert.strictEqual(auditCalls[0].detail.to, 'active');
});
