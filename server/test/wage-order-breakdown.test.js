'use strict';

/**
 * 工资条订单溯源（v20261026 orderBreakdown → v20261027c 演出段口径 → v20261028g 出勤天对齐）单元测试
 * 覆盖：
 *   1. _orderBreakdownByStaff：考勤日期落在订单演出段 [performanceStartDate, performanceEndDate]
 *      即视为参与该订单；showDays = 结算区间∩演出段天数；nightShows 仅 night 计数；
 *      取消/退款订单不参与；打卡总控暂停日排除；未命中演出段的计薪考勤归兜底桶
 *   2. toApi：orderBreakdown JSON 文本→数组解析（含损坏 JSON 与缺失容错）
 *   3. core.generate × v20261028g 出勤天对齐修复（核心）：
 *      - daily_pure 且 showDaysTotal>0 时各单 workDays = showDays（演出中期制单考勤快照偏小，
 *        历史场景 ORD2609071207IHU3 快照 1 ≠ 演出 6，统一取 showDays 防口径打架）
 *      - baseShare = round2(日工资 × showDays)；nightShows/showDays 原样透传
 *      - 多订单按 showDays 降序；非演出考勤兜底桶不计薪（baseShare=0）排最后
 *      - 未设置天工资者不跳过、baseShare=0；baseWage = 日工资 × showDaysTotal
 *   4. monthly 模式回退考勤快照 workDays（不取 showDays），baseShare 仍为 rate×showDays
 *   5. daily_pure 无命中订单（showDaysTotal=0）时快照即计薪，orderBreakdown 仅兜底桶
 *   6. independent.detail：详情接口暴露 orderBreakdown 数组
 * 使用 require.cache 桩替换 prisma / audit-service / punch-control（沿用 travel-expenses.test.js 模式）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const controllerDir = path.resolve(__dirname, '../src/controllers');
const prismaId = require.resolve('../utils/prisma', { paths: [controllerDir] });
const auditId = require.resolve('../services/audit-service', { paths: [controllerDir] });
const punchControlId = require.resolve('../services/punch-control', { paths: [controllerDir] });

// ---- 桩 prisma ----
let attRows = [];
let schedRows = [];
let orderRows = [];
let perfRows = [];
let luRows = [];
let createdWageItems = [];
const stubPrisma = {
  setting: { findUnique: async () => null, upsert: async a => (a.data || a) },
  attendanceV1: {
    findMany: async args => { stubPrisma._lastAttQuery = args; return attRows; }
  },
  scheduleV2: {
    findMany: async args => schedRows.filter(s => (args.where.id.in || []).includes(s.id))
  },
  // v20261027c：订单按演出段∩结算区间查询（状态过滤 + 日期段交集），与 helpers.js 生产条件对齐
  order: {
    findMany: async args => {
      const w = args.where || {};
      const rangeEnd = w.performanceStartDate && w.performanceStartDate.lt;
      const rangeStart = w.performanceEndDate && w.performanceEndDate.gte;
      const notIn = (w.status && w.status.notIn) || [];
      return orderRows.filter(o =>
        notIn.indexOf(o.status) < 0 &&
        o.performanceStartDate && o.performanceEndDate &&
        (!rangeEnd || o.performanceStartDate < rangeEnd) &&
        (!rangeStart || o.performanceEndDate >= rangeStart)
      );
    }
  },
  employeePunchV1: { findMany: async () => [] },
  travelExpenseV1: { findMany: async () => [] },
  employeeLoanV1: { findMany: async () => [] },
  loadUnloadRecordV1: { findMany: async () => luRows },
  performersDbV1: { findMany: async () => perfRows, findUnique: async () => null },
  wageRulesV1: { findMany: async () => [], findFirst: async () => null },
  wageBatchesV1: {
    findMany: async () => [],
    create: async args => ({ ...args.data, createdAt: new Date(0), updatedAt: new Date(0) }),
    deleteMany: async () => ({ count: 0 })
  },
  wageItemsV1: {
    create: async args => {
      createdWageItems.push(args.data);
      return { ...args.data, createdAt: new Date(0), updatedAt: new Date(0) };
    },
    deleteMany: async () => ({ count: 0 }),
    findUnique: async () => stubPrisma._detailRow || null
  },
  $transaction: async arr => Promise.all(arr)
};
require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: stubPrisma };

// ---- 桩 audit-service ----
require.cache[auditId] = { id: auditId, filename: auditId, loaded: true, exports: { audit: async () => {} } };

// ---- 桩 punch-control：仅排除 EXCLUDED_MS 这一天 ----
const EXCLUDED_MS = Date.UTC(2026, 9, 18);
require.cache[punchControlId] = {
  id: punchControlId, filename: punchControlId, loaded: true,
  exports: { getState: async () => ({}), isDateExcludedIn: (_s, ms) => ms === EXCLUDED_MS }
};

const helpers = require('../src/controllers/wages/helpers');
const core = require('../src/controllers/wages/core');
const independent = require('../src/controllers/wages/independent');

const D = (m, d) => new Date(Date.UTC(2026, m - 1, d));

// ========== 1. _orderBreakdownByStaff ==========
test('_orderBreakdownByStaff 按演出日期段归单聚合，showDays=区间∩演出段天数', async () => {
  attRows = [
    // p1：10-01 命中 O1（演出段 10-01~10-02，2 天）
    { staffId: 'p1', attendanceType: 'full', attendanceDate: D(10, 1) },
    // p1：10-05/06/08 命中 O2（演出段 10-05~10-10，6 天）；night 计夜场
    { staffId: 'p1', attendanceType: 'night', attendanceDate: D(10, 5) },
    { staffId: 'p1', attendanceType: 'full', attendanceDate: D(10, 6) },
    { staffId: 'p1', attendanceType: 'full', attendanceDate: D(10, 8) },
    // p1：10-20 无订单演出段 → 兜底桶
    { staffId: 'p1', attendanceType: 'full', attendanceDate: D(10, 20) },
    // p1：打卡总控暂停日 → 整条排除（若误计 fallback 应为 2）
    { staffId: 'p1', attendanceType: 'full', attendanceDate: new Date(EXCLUDED_MS) },
    // p1：非计薪类型（旷工）→ 不进任何桶
    { staffId: 'p1', attendanceType: 'absent', attendanceDate: D(10, 21) },
    // p2：10-05 命中 O2
    { staffId: 'p2', attendanceType: 'full', attendanceDate: D(10, 5) }
  ];
  orderRows = [
    { id: 'O1', orderNo: 'DD20261029001', performanceStartDate: D(10, 1), performanceEndDate: D(10, 2), performanceCount: 2, status: 'confirmed' },
    { id: 'O2', orderNo: 'DD20261029002', performanceStartDate: D(10, 5), performanceEndDate: D(10, 10), performanceCount: 6, status: 'confirmed' },
    // 已取消订单：演出段覆盖整月且场次最多，若状态过滤失效会吞掉 p1 全部考勤
    { id: 'O3', orderNo: 'DD-CANCELLED', performanceStartDate: D(10, 1), performanceEndDate: D(10, 30), performanceCount: 30, status: 'cancelled' }
  ];

  const map = await helpers._orderBreakdownByStaff('2026-10');

  // 查询条件按 attendanceMonth 整月
  assert.deepStrictEqual(stubPrisma._lastAttQuery.where, { attendanceMonth: '2026-10' });

  // p1：O1 快照 1 天 / showDays 2；O2 快照 3 天（night+2 full）/ 1 夜场 / showDays 6
  assert.deepStrictEqual(map.p1.orders.O1, { orderNo: 'DD20261029001', workDays: 1, nightShows: 0, showDays: 2 });
  assert.deepStrictEqual(map.p1.orders.O2, { orderNo: 'DD20261029002', workDays: 3, nightShows: 1, showDays: 6 });
  assert.deepStrictEqual(map.p1.fallback, { workDays: 1, nightShows: 0 });
  // 取消订单不参与（p1 无 O3 桶）
  assert.strictEqual(map.p1.orders.O3, undefined);

  // p2：仅 O2 桶，无兜底
  assert.deepStrictEqual(map.p2.orders.O2, { orderNo: 'DD20261029002', workDays: 1, nightShows: 0, showDays: 6 });
  assert.deepStrictEqual(map.p2.orders, { O2: map.p2.orders.O2 });
  assert.strictEqual(map.p2.fallback.workDays, 0);
});

test('_orderBreakdownByStaff 传 range 时按考勤日期区间过滤', async () => {
  attRows = [];
  orderRows = [];
  await helpers._orderBreakdownByStaff('2026-10', { gte: D(10, 1), lt: D(10, 16) });
  assert.ok(stubPrisma._lastAttQuery.where.attendanceDate, '应按 attendanceDate 区间过滤');
  assert.strictEqual(stubPrisma._lastAttQuery.where.attendanceDate.gte.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.strictEqual(stubPrisma._lastAttQuery.where.attendanceDate.lt.toISOString(), '2026-10-16T00:00:00.000Z');
});

// ========== 2. toApi 解析 orderBreakdown ==========
test('toApi 将 orderBreakdown JSON 文本解析为数组，异常/缺失容错为空数组', () => {
  const base = { id: 'w1', batchId: 'b1' };
  const row1 = { ...base, orderBreakdown: JSON.stringify([{ orderId: 'O1', orderNo: 'DD1', workDays: 2, showDays: 2, nightShows: 1, baseShare: 400 }]) };
  var api1 = helpers.toApi(row1, { wageMonth: '2026-10' });
  assert.strictEqual(Array.isArray(api1.orderBreakdown), true);
  assert.strictEqual(api1.orderBreakdown.length, 1);
  assert.strictEqual(api1.orderBreakdown[0].orderNo, 'DD1');
  assert.strictEqual(api1.orderBreakdown[0].baseShare, 400);

  // 缺失 → 空数组
  assert.deepStrictEqual(helpers.toApi({ ...base }, { wageMonth: '2026-10' }).orderBreakdown, []);
  // 损坏 JSON → 空数组（不抛异常）
  assert.deepStrictEqual(helpers.toApi({ ...base, orderBreakdown: '{oops' }, { wageMonth: '2026-10' }).orderBreakdown, []);
  // 非数组 JSON（如对象）→ 空数组
  assert.deepStrictEqual(helpers.toApi({ ...base, orderBreakdown: '{"a":1}' }, { wageMonth: '2026-10' }).orderBreakdown, []);
});

// ========== 3. core.generate × v20261028g 出勤天对齐（核心修复） ==========
test('generate daily_pure：订单出勤天=showDays 对齐计薪口径（快照偏小场景 ORD2609071207IHU3）', async () => {
  createdWageItems = [];
  perfRows = [
    { id: 'p1', staffNo: 'PF001', name: '张三', rankGrade: 'A', dailyRate: 200, employmentType: '正式' },
    { id: 'p2', staffNo: 'PF002', name: '李四', rankGrade: null, dailyRate: null, employmentType: '外聘' }
  ];
  // 考勤快照刻意偏小：OA 演出段 2 天只录 1 天考勤、OB 演出段 6 天只录 2 天考勤（模拟演出中期制单）
  attRows = [
    { staffId: 'p1', attendanceType: 'full', attendanceDate: D(10, 1) },   // OA 快照 1
    { staffId: 'p1', attendanceType: 'night', attendanceDate: D(10, 10) }, // OB 快照 2（night+full）
    { staffId: 'p1', attendanceType: 'full', attendanceDate: D(10, 11) },
    { staffId: 'p1', attendanceType: 'full', attendanceDate: D(10, 20) },  // 非演出考勤 → 兜底
    { staffId: 'p2', attendanceType: 'full', attendanceDate: D(10, 1) },   // p2 仅 OA
    { staffId: 'p2', attendanceType: 'full', attendanceDate: D(10, 2) }
  ];
  orderRows = [
    // 小单在前、大单在后：验证输出按 showDays 降序（未排序时应保持 OA→OB）
    { id: 'OA', orderNo: 'ORD2609071207IHU3', performanceStartDate: D(10, 1), performanceEndDate: D(10, 2), performanceCount: 2, status: 'confirmed' },
    { id: 'OB', orderNo: 'ORD20261026002', performanceStartDate: D(10, 10), performanceEndDate: D(10, 15), performanceCount: 6, status: 'confirmed' }
  ];

  const ctx = {
    request: { body: { month: '2026-10' } },
    state: { user: { username: 'tester' } }
  };
  await core.generate(ctx);

  assert.strictEqual(createdWageItems.length, 2, 'p1/p2 均应生成（p2 无天工资但有演出场次不跳过）');

  // p1：workDays 取 showDays（1→2、2→6），baseShare=日工资×showDays，按 showDays 降序，兜底桶收尾
  const w1 = createdWageItems.find(x => x.performerId === 'p1');
  assert.deepStrictEqual(JSON.parse(w1.orderBreakdown), [
    { orderId: 'OB', orderNo: 'ORD20261026002', workDays: 6, showDays: 6, nightShows: 1, baseShare: 1200 },
    { orderId: 'OA', orderNo: 'ORD2609071207IHU3', workDays: 2, showDays: 2, nightShows: 0, baseShare: 400 },
    { orderId: null, orderNo: '非演出考勤', workDays: 1, showDays: 0, nightShows: 0, baseShare: 0 }
  ]);
  // baseWage = 日薪 200 × showDaysTotal 8；Σ baseShare（兜底不计薪）= 1600 与 baseWage 一致
  assert.strictEqual(w1.baseWage, 1600);
  const ob1 = JSON.parse(w1.orderBreakdown);
  assert.strictEqual(ob1.reduce((s, o) => s + o.baseShare, 0), 1600);

  // p2：未设置天工资 → baseShare=0、baseWage=0，但出勤天仍对齐 showDays
  const w2 = createdWageItems.find(x => x.performerId === 'p2');
  assert.deepStrictEqual(JSON.parse(w2.orderBreakdown), [
    { orderId: 'OA', orderNo: 'ORD2609071207IHU3', workDays: 2, showDays: 2, nightShows: 0, baseShare: 0 }
  ]);
  assert.strictEqual(w2.baseWage, 0);

  // 响应体（created API）也应通过 toApi 暴露解析后的数组
  assert.ok(Array.isArray(ctx.body.data.items[0].orderBreakdown));
  assert.strictEqual(ctx.body.data.items[0].orderBreakdown[0].orderNo, 'ORD20261026002');
});

// ========== 4. monthly 模式：workDays 保留考勤快照 ==========
test('generate monthly：订单出勤天取考勤快照（不取 showDays），baseShare 仍按 rate×showDays', async () => {
  createdWageItems = [];
  perfRows = [{ id: 'p1', staffNo: 'PF001', name: '王五', rankGrade: null, dailyRate: 200, employmentType: '正式' }];
  // 演出段 6 天，考勤快照仅 1 天
  attRows = [{ staffId: 'p1', attendanceType: 'full', attendanceDate: D(10, 1) }];
  orderRows = [{ id: 'O1', orderNo: 'DD20261029003', performanceStartDate: D(10, 1), performanceEndDate: D(10, 6), performanceCount: 6, status: 'confirmed' }];

  const ctx = {
    request: { body: { month: '2026-10', defaultMode: 'monthly' } },
    state: { user: { username: 'tester' } }
  };
  await core.generate(ctx);

  const w1 = createdWageItems.find(x => x.performerId === 'p1');
  assert.ok(w1, 'monthly 人员始终纳入核算');
  assert.deepStrictEqual(JSON.parse(w1.orderBreakdown), [
    { orderId: 'O1', orderNo: 'DD20261029003', workDays: 1, showDays: 6, nightShows: 0, baseShare: 1200 }
  ]);
  // monthly 底薪口径：baseWage=3800（与 baseShare 口径无关，明细仅展示演出参与）
  assert.strictEqual(w1.baseWage, 3800);
});

// ========== 5. daily_pure 无命中订单：快照即计薪 ==========
test('generate daily_pure 无演出段命中：不出订单条目、baseWage=快照出勤×日工资', async () => {
  createdWageItems = [];
  perfRows = [
    { id: 'p1', staffNo: 'PF001', name: '张三', rankGrade: null, dailyRate: 200, employmentType: '正式' },
    { id: 'p2', staffNo: 'PF002', name: '赵六', rankGrade: null, dailyRate: null, employmentType: '外聘' }
  ];
  attRows = [
    { staffId: 'p1', attendanceType: 'full', attendanceDate: D(10, 3) },
    { staffId: 'p1', attendanceType: 'full', attendanceDate: D(10, 4) }
  ];
  // 订单演出段在 11 月（与结算区间无交集）→ 不参与
  orderRows = [{ id: 'ON', orderNo: 'ORD-NOV', performanceStartDate: D(11, 1), performanceEndDate: D(11, 5), performanceCount: 5, status: 'confirmed' }];

  const ctx = {
    request: { body: { month: '2026-10' } },
    state: { user: { username: 'tester' } }
  };
  await core.generate(ctx);

  const w1 = createdWageItems.find(x => x.performerId === 'p1');
  assert.ok(w1, 'p1 有考勤应生成');
  // showDaysTotal=0 → 无订单条目，仅兜底桶；baseWage=快照 2 天 × 200
  assert.deepStrictEqual(JSON.parse(w1.orderBreakdown), [
    { orderId: null, orderNo: '非演出考勤', workDays: 2, showDays: 0, nightShows: 0, baseShare: 0 }
  ]);
  assert.strictEqual(w1.baseWage, 400);

  // p2 无出勤、无演出场次且无天工资 → 跳过
  const w2 = createdWageItems.find(x => x.performerId === 'p2');
  assert.strictEqual(w2, undefined, 'p2 无出勤且无天工资应跳过');
});

// ========== 5.5 装卸车缺席扣款单价兜底（v20261029a） ==========
test('generate daily_pure 装卸车缺席扣款：未配置单价兜底 30 元/次，已配置优先', async () => {
  createdWageItems = [];
  luRows = [];
  perfRows = [
    { id: 'p3', staffNo: 'PF003', name: '孙七', rankGrade: null, dailyRate: 200, employmentType: '正式' },                        // 未配置单价
    { id: 'p4', staffNo: 'PF004', name: '周八', rankGrade: null, dailyRate: 200, employmentType: '正式', loadUnloadDeduct: 50 }   // 已配置 50
  ];
  attRows = [
    { staffId: 'p3', attendanceType: 'full', attendanceDate: D(10, 1) },
    { staffId: 'p4', attendanceType: 'full', attendanceDate: D(10, 1) }
  ];
  orderRows = [{ id: 'O1', orderNo: 'DD20261029004', performanceStartDate: D(10, 1), performanceEndDate: D(10, 2), performanceCount: 2, status: 'confirmed' }];
  // 装车/卸车缺席各记一次：p3 两次（load+unload）、p4 一次（load）
  luRows = [
    { performerId: 'p3', recordType: 'load', recordDate: D(10, 20), attend: false },
    { performerId: 'p3', recordType: 'unload', recordDate: D(10, 21), attend: false },
    { performerId: 'p4', recordType: 'load', recordDate: D(10, 20), attend: false }
  ];

  const ctx = {
    request: { body: { month: '2026-10' } },
    state: { user: { username: 'tester' } }
  };
  await core.generate(ctx);

  // p3：单价未配置 → 兜底 30，扣款 = 2 × 30 = 60
  const w3 = createdWageItems.find(x => x.performerId === 'p3');
  assert.ok(w3, 'p3 应生成工资条');
  const note3 = JSON.parse(w3.otherDeductionNote);
  assert.strictEqual(note3.loadUnloadAbsentCount, 2);
  assert.strictEqual(note3.loadUnloadUnitPrice, 30, '未配置单价应兜底默认 30 元/次');
  assert.strictEqual(note3.loadUnloadDeduction, 60);

  // p4：单价 50 已配置 → 优先用配置值，扣款 = 1 × 50 = 50
  const w4 = createdWageItems.find(x => x.performerId === 'p4');
  assert.ok(w4, 'p4 应生成工资条');
  const note4 = JSON.parse(w4.otherDeductionNote);
  assert.strictEqual(note4.loadUnloadAbsentCount, 1);
  assert.strictEqual(note4.loadUnloadUnitPrice, 50, '已配置单价应优先于兜底值');
  assert.strictEqual(note4.loadUnloadDeduction, 50);
});

// ========== 6. independent.detail 暴露 orderBreakdown ==========
test('detail 接口返回解析后的 orderBreakdown 数组', async () => {
  stubPrisma._detailRow = {
    id: 'w9', batchId: 'b1',
    orderBreakdown: JSON.stringify([{ orderId: 'O1', orderNo: 'DD1', workDays: 6, showDays: 6, nightShows: 0, baseShare: 1200 }]),
    batch: { id: 'b1', wageMonth: '2026-10', batchNo: 'WB-202610-TEST', status: 'draft' }
  };
  const ctx = { params: { id: 'w9' }, state: {} };
  await independent.detail(ctx);
  assert.strictEqual(ctx.body.ok, true);
  assert.deepStrictEqual(ctx.body.data.orderBreakdown, [
    { orderId: 'O1', orderNo: 'DD1', workDays: 6, showDays: 6, nightShows: 0, baseShare: 1200 }
  ]);
  stubPrisma._detailRow = null;
});
