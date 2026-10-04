'use strict';

/**
 * accounts.list 软删默认排除的 where 构造与响应契约单测。
 * 用 require.cache 桩替换 src/utils/prisma，捕获 findMany/count 的 where 参数。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const controllerDir = path.resolve(__dirname, '../src/controllers');
const prismaId = require.resolve('../utils/prisma', { paths: [controllerDir] });

let capturedWhere = null;
const stubPrisma = {
  accountsV2: {
    findMany: async args => { capturedWhere = args && args.where; return [{ id: 'acc_x', username: 'u1', status: 'active' }]; },
    count: async args => { capturedWhere = args && args.where; return 1; }
  }
};
require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: stubPrisma };

const accountsCtrl = require('../src/controllers/accounts');

function runList(query) {
  capturedWhere = null;
  const ctx = { query: { ...query }, state: {}, body: null, status: 0 };
  return accountsCtrl.list(ctx).then(() => ({ ctx, where: capturedWhere }));
}

test('默认(无status)：where.status = {not:"deleted"}，软删被排除', async () => {
  const { where, ctx } = await runList({});
  assert.deepStrictEqual(where.status, { not: 'deleted' });
  assert.strictEqual(ctx.body.ok, true);
  assert.ok(Array.isArray(ctx.body.data));
  assert.strictEqual(ctx.body.meta.total, 1);
});

test('status=active：精确匹配 active', async () => {
  const { where } = await runList({ status: 'active' });
  assert.strictEqual(where.status, 'active');
});

test('status=disabled：精确匹配 disabled', async () => {
  const { where } = await runList({ status: 'disabled' });
  assert.strictEqual(where.status, 'disabled');
});

test('status=deleted：审计视图，仅查软删', async () => {
  const { where } = await runList({ status: 'deleted' });
  assert.strictEqual(where.status, 'deleted');
});

test('status=all：不加状态条件，含全部状态（审计）', async () => {
  const { where } = await runList({ status: 'all' });
  assert.ok(!('status' in where), 'where 不应包含 status 键');
});

test('关键词搜索 + 默认软删排除：OR 与 NOT deleted 同时生效', async () => {
  const { where } = await runList({ keyword: '张三' });
  assert.ok(Array.isArray(where.OR) && where.OR.length === 4);
  assert.deepStrictEqual(where.status, { not: 'deleted' });
});

test('role + status=deleted 组合：两个条件都落 where', async () => {
  const { where } = await runList({ role: 'staff', status: 'deleted' });
  assert.strictEqual(where.role, 'staff');
  assert.strictEqual(where.status, 'deleted');
});

test('分页参数透传 skip/take/orderBy', async () => {
  const ctx1 = { query: { page: '2', pageSize: '5' }, state: {}, body: null, status: 0 };
  capturedWhere = null;
  // 重新桩以捕获 findMany 完整参数
  let findArgs = null;
  stubPrisma.accountsV2.findMany = async args => { findArgs = args; return []; };
  stubPrisma.accountsV2.count = async () => 0;
  await accountsCtrl.list(ctx1);
  assert.strictEqual(findArgs.skip, 5);
  assert.strictEqual(findArgs.take, 5);
  assert.deepStrictEqual(findArgs.orderBy, { createdAt: 'desc' });
});
