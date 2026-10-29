'use strict';

/**
 * 差旅路费（TravelExpenseV1）归集与工资条集成 单元测试
 * 覆盖：
 *   1. _travelExpenseByStaffMonth：按月份日期范围过滤、按人员聚合、关联 ScheduleV2 拼场次标题
 *   2. _calcWageItem：路费纳入 transportAllowance 与 grossPay、明细写入 otherDeductionNote、remark 标注
 *   3. _calcWageItem 无路费时保持原口径（transportAllowance=0，无差旅备注）
 *   4. travel-expenses.create：description→remark 映射、expenseDate 字符串→Date、人员姓名回填、
 *      不写 schema 不存在的列（scheduleTitle/description）
 * 使用 require.cache 桩替换 prisma / audit-service（沿用 finance-m15.test.js 模式）。
 *
 * 修复记录（2026-10-26）：
 *   控制器新增「同人同月查重」逻辑（create 前调 travelExpenseV1.findFirst 过滤
 *   pending/active 状态的重复路费单）后，本文件桩未同步该方法，导致 create 用例
 *   直接 TypeError 500。修复方式：桩补 findFirst——按传入查询条件在 teRows 中
 *   命中 pending/active 记录则返回（模拟重复），否则返回 null（放行）；
 *   并将查询参数记录到 stubPrisma._lastDupCheck 供断言扩展。
 *   教训：控制器新增 prisma 模型方法调用时，所有引用该模型桩的测试文件需同步补齐。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const wagesDir = path.resolve(__dirname, '../src/controllers/wages');
const controllerDir = path.resolve(__dirname, '../src/controllers');
const prismaId = require.resolve('../utils/prisma', { paths: [controllerDir] });

// ---- 桩 prisma ----
let teRows = [];
let schedRows = [];
let createdData = null;
let perfRow = { name: '张三' };
const stubPrisma = {
  travelExpenseV1: {
    findMany: async args => { stubPrisma._lastTeQuery = args; return teRows; },
    findFirst: async args => { stubPrisma._lastDupCheck = args; return teRows.find(r => ['pending', 'active'].includes(r.status)) || null; },
    create: async args => { createdData = args.data; return { ...args.data, createdAt: new Date(0), updatedAt: new Date(0) }; }
  },
  scheduleV2: {
    findMany: async args => schedRows.filter(s => args.where.id.in.includes(s.id))
  },
  performersDbV1: {
    findUnique: async () => perfRow
  }
};
require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: stubPrisma };

// ---- 桩 audit-service ----
const auditId = require.resolve('../services/audit-service', { paths: [controllerDir] });
require.cache[auditId] = { id: auditId, filename: auditId, loaded: true, exports: { audit: async () => {} } };

const helpers = require('../src/controllers/wages/helpers');
const travelCtrl = require('../src/controllers/travel-expenses');

// ========== 1. _travelExpenseByStaffMonth ==========
test('_travelExpenseByStaffMonth 按日期范围过滤并聚合', async () => {
  teRows = [
    { performerId: 'p1', amount: 100.5, expenseDate: new Date(Date.UTC(2026, 9, 3)), scheduleId: 's1' },
    { performerId: 'p1', amount: 50.25, expenseDate: new Date(Date.UTC(2026, 9, 20)), scheduleId: 's1' },
    { performerId: 'p2', amount: 88, expenseDate: new Date(Date.UTC(2026, 9, 10)), scheduleId: null }
  ];
  schedRows = [{ id: 's1', playTitle: '铡美案', scheduleDateStart: new Date(Date.UTC(2026, 9, 20)), venueAddress: '秦安大剧院' }];

  const map = await helpers._travelExpenseByStaffMonth('2026-10');

  // 月份过滤用 gte/lt 日期范围（expenseDate 为 DateTime 列）
  const w = stubPrisma._lastTeQuery.where;
  assert.ok(w.expenseDate.gte instanceof Date, 'gte 应为 Date');
  assert.strictEqual(w.expenseDate.gte.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.strictEqual(w.expenseDate.lt.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.strictEqual(w.status, 'active');

  // 聚合：p1 两笔合计 150.75，p2 一笔 88
  assert.strictEqual(map.p1.total, 150.75);
  assert.strictEqual(map.p1.count, 2);
  assert.strictEqual(map.p2.total, 88);
  assert.strictEqual(map.p2.count, 1);

  // 场次标题关联拼接（剧目+日期+地点）
  assert.strictEqual(map.p1.items[0].scheduleTitle, '铡美案 2026-10-20 秦安大剧院');
  // 无场次记录时标题为空串
  assert.strictEqual(map.p2.items[0].scheduleTitle, '');
  // expenseDate 输出为 YYYY-MM-DD
  assert.strictEqual(map.p1.items[0].expenseDate, '2026-10-03');
});

// ========== 2. _calcWageItem 含路费 ==========
test('_calcWageItem 将路费纳入 transportAllowance 与 grossPay', () => {
  const perf = { id: 'p1', name: '张三', staffNo: 'PF001', rankGrade: 'A', dailyRate: 200 };
  const att = { workDays: 10 };
  const travelExp = {
    total: 150.75, count: 2,
    items: [{ scheduleTitle: '铡美案 2026-10-20 秦安大剧院', expenseDate: '2026-10-03', amount: 100.5 }]
  };
  const item = helpers._calcWageItem(perf, att, null, null, null, travelExp);

  assert.strictEqual(item.baseWage, 2000);
  assert.strictEqual(item.transportAllowance, 150.75);
  assert.strictEqual(item.grossPay, 2150.75);
  assert.strictEqual(item.travelExpenseTotal, 150.75);
  assert.strictEqual(item.travelExpenseCount, 2);
  assert.strictEqual(item.travelExpenseItems.length, 1);

  // 明细持久化到 otherDeductionNote（双向追溯）
  const note = JSON.parse(item.otherDeductionNote);
  assert.strictEqual(note.travelExpense, 150.75);
  assert.strictEqual(note.travelExpenseCount, 2);
  assert.strictEqual(note.travelExpenseItems[0].scheduleTitle, '铡美案 2026-10-20 秦安大剧院');

  // 备注标注
  assert.ok(item.remark.includes('差旅路费¥150.75（2笔）'), 'remark 应标注差旅路费');
});

// ========== 3. _calcWageItem 无路费（原口径不变） ==========
test('_calcWageItem 无路费时 transportAllowance=0 且无差旅备注', () => {
  const perf = { id: 'p1', name: '张三', staffNo: 'PF001', rankGrade: 'A', dailyRate: 200 };
  const att = { workDays: 10 };
  const item = helpers._calcWageItem(perf, att, null, null, null, null);

  assert.strictEqual(item.transportAllowance, 0);
  assert.strictEqual(item.grossPay, 2000);
  assert.strictEqual(item.travelExpenseTotal, 0);
  assert.strictEqual(item.travelExpenseCount, 0);
  assert.deepStrictEqual(item.travelExpenseItems, []);
  assert.ok(!item.remark.includes('差旅路费'), 'remark 不应出现差旅路费');
});

// ========== 4. travel-expenses.create 字段映射与 schema 对齐 ==========
function mkCtx(body) {
  return {
    params: {},
    query: {},
    request: { body },
    state: { user: { sub: 'admin', username: 'admin', role: 'super_admin', roles: [] } },
    status: 0,
    body: null
  };
}

test('create 将 description 映射到 remark、expenseDate 转 Date，且不写 schema 外列', async () => {
  createdData = null;
  perfRow = { name: '李四' };
  const ctx = mkCtx({
    performerId: 'pf_x1',
    expenseDate: '2026-10-15',
    amount: 150.5,
    description: '测试差旅路费'
  });
  await travelCtrl.create(ctx);

  assert.ok(createdData, 'prisma.create 应被调用');
  // description → remark 列
  assert.strictEqual(createdData.remark, '测试差旅路费');
  // expenseDate 字符串 → Date
  assert.ok(createdData.expenseDate instanceof Date, 'expenseDate 应为 Date');
  assert.strictEqual(createdData.expenseDate.toISOString(), '2026-10-15T00:00:00.000Z');
  // 人员姓名回填
  assert.strictEqual(createdData.performerName, '李四');
  // schema 对齐守卫：不得包含 scheduleTitle / description 列
  assert.ok(!('scheduleTitle' in createdData), '不得写 scheduleTitle 列');
  assert.ok(!('description' in createdData), '不得写 description 列');
  assert.strictEqual(createdData.status, 'active');
  assert.strictEqual(ctx.status, 201);
});

test('create 缺少 performerId 时抛参数错误', async () => {
  const ctx = mkCtx({ amount: 100 });
  await assert.rejects(() => travelCtrl.create(ctx), /performerId 必填/);
});
