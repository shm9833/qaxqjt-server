'use strict';

/**
 * 工资条 PATCH 装卸车扣款审核保存测试（v20261029c）
 * 覆盖 wages/core update 的 note 合并编码：
 *   1. PATCH 4 项扣款时，note 中已有的 loadUnloadDeduction/AbsentCount/UnitPrice/Items 原样保留
 *   2. PATCH loadUnloadDeduction 时金额写入 note，其他字段保留，otherDeduction 仍=4 项之和
 * 桩：prisma（wageItemsV1）+ audit-service
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
const auditId = require.resolve('../services/audit-service', { paths: [controllerDir] });

const BASE_NOTE = {
  leave: 0, absent: 0, late: 0, early: 0,
  travelExpense: 60, travelExpenseCount: 1, travelExpenseItems: [{ date: '2026-10-20', amount: 60, note: '庙会演出' }],
  loadUnloadDeduction: 30, loadUnloadAbsentCount: 1, loadUnloadUnitPrice: 30,
  loadUnloadItems: [{ date: '2026-10-28', type: 'load' }]
};

let wageRow = null;
let updated = null;
const stubPrisma = {
  wageItemsV1: {
    findUnique: async () => wageRow,
    update: async args => { updated = args; return { ...wageRow, ...args.data }; }
  }
};
require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: stubPrisma };
const auditCalls = [];
require.cache[auditId] = { id: auditId, filename: auditId, loaded: true, exports: { audit: async args => { auditCalls.push(args); } } };

const app = require('../src/app');
const handler = app.callback();

function signToken() {
  return jwt.sign(
    { sub: 'acc_test', username: 'testadmin', role: 'super_admin', realName: '测试管理员' },
    process.env.JWT_ACCESS_SECRET,
    { issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' }
  );
}

function makeRow() {
  return {
    id: 'wage_lu_test1', wageMode: 'daily_pure', dailyRate: 350, attendanceDays: 6,
    baseWage: 2100, grossPay: 2160, totalDeduction: 30, netPay: 2130,
    otherDeduction: 0, otherDeductionNote: JSON.stringify(BASE_NOTE),
    batch: { status: 'draft' }
  };
}

test('PATCH 4 项扣款时装卸车扣款字段原样保留（round-trip）', async () => {
  wageRow = makeRow(); updated = null; auditCalls.length = 0;
  const res = await request(handler)
    .patch('/v1/wages/wage_lu_test1')
    .set('Authorization', 'Bearer ' + signToken())
    .send({ leaveDeduction: 20, totalDeduction: 50, netPay: 2090 });
  assert.strictEqual(res.status, 200);
  const note = JSON.parse(updated.data.otherDeductionNote);
  assert.strictEqual(note.leave, 20, 'leave 应更新');
  assert.strictEqual(note.loadUnloadDeduction, 30, '装卸车扣款应保留');
  assert.strictEqual(note.loadUnloadAbsentCount, 1);
  assert.strictEqual(note.loadUnloadUnitPrice, 30);
  assert.deepStrictEqual(note.loadUnloadItems, BASE_NOTE.loadUnloadItems, '逐笔明细应保留');
  assert.deepStrictEqual(note.travelExpenseItems, BASE_NOTE.travelExpenseItems, '差旅明细应保留');
  assert.strictEqual(updated.data.otherDeduction, 20, 'otherDeduction = 4 项之和（不含装卸车）');
});

test('PATCH loadUnloadDeduction 审核改装卸车扣款生效', async () => {
  wageRow = makeRow(); updated = null; auditCalls.length = 0;
  const res = await request(handler)
    .patch('/v1/wages/wage_lu_test1')
    .set('Authorization', 'Bearer ' + signToken())
    .send({ loadUnloadDeduction: 50, totalDeduction: 50, netPay: 2110 });
  assert.strictEqual(res.status, 200);
  const note = JSON.parse(updated.data.otherDeductionNote);
  assert.strictEqual(note.loadUnloadDeduction, 50, '装卸车扣款应更新为 50');
  assert.strictEqual(note.leave, 0, 'leave 应保留');
  assert.strictEqual(note.loadUnloadAbsentCount, 1, '缺席次数保留');
  assert.strictEqual(note.loadUnloadItems.length, 1, '逐笔明细保留');
  assert.strictEqual(updated.data.otherDeduction, 0, 'otherDeduction 不含装卸车');
});
