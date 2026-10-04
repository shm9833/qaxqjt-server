'use strict';

/**
 * schedules 控制器重构版单元测试
 * 覆盖：纯函数（toApi/_dateStr/_weekStr/_statusText/_parseTypeFromRemark）、
 *       buildListWhere 查询条件构造、list 的 select 投影、stats 的 groupBy 聚合、
 *       calendar 轻量投影、conflicts 冲突检测。
 * 使用 require.cache 桩替换 prisma，捕获查询参数。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const controllerDir = path.resolve(__dirname, '../src/controllers');
const prismaId = require.resolve('../utils/prisma', { paths: [controllerDir] });

// 桩 prisma：捕获各方法的调用参数
let captured = {};
const stubPrisma = {
  scheduleV2: {
    findMany: async args => { captured.findMany = args; return []; },
    count: async args => { captured.count = args; return 0; },
    findUnique: async args => { captured.findUnique = args; return null; },
    create: async args => { captured.create = args; return args && args.data; },
    update: async args => { captured.update = args; return args && args.data; },
    delete: async args => { captured.delete = args; return {}; },
    groupBy: async args => { captured.groupBy = args; return []; },
    aggregate: async args => {
      captured.aggregate = args;
      return { _count: { id: 0 }, _sum: { feeAmount: null, audienceSize: null, actualAttendance: null } };
    }
  }
};
require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: stubPrisma };

// 清除 audit-service 依赖的副作用
const auditId = require.resolve('../services/audit-service', { paths: [controllerDir] });
if (require.cache[auditId]) {
  // 替换为无操作桩
  require.cache[auditId].exports = { audit: async () => {} };
} else {
  require.cache[auditId] = { id: auditId, filename: auditId, loaded: true, exports: { audit: async () => {} } };
}

const sched = require('../src/controllers/schedules');

function reset() { captured = {}; }

// ========== 纯函数测试 ==========

test('_dateStr：Date → YYYY-MM-DD', () => {
  assert.strictEqual(sched._dateStr(new Date(2026, 8, 30)), '2026-09-30');
  assert.strictEqual(sched._dateStr(null), '');
  assert.strictEqual(sched._dateStr(undefined), '');
});

test('_weekStr：Date → 中文星期', () => {
  // 2026-09-30 是星期三
  assert.strictEqual(sched._weekStr(new Date(2026, 8, 30)), '星期三');
  assert.strictEqual(sched._weekStr(null), '');
});

test('_statusText：状态码 → 中文', () => {
  assert.strictEqual(sched._statusText('scheduled'), '已排期');
  assert.strictEqual(sched._statusText('confirmed'), '已确认');
  assert.strictEqual(sched._statusText('draft'), '待确认');
  assert.strictEqual(sched._statusText('completed'), '已完成');
  assert.strictEqual(sched._statusText('cancelled'), '已取消');
  assert.strictEqual(sched._statusText('unknown'), 'unknown');
  assert.strictEqual(sched._statusText(null), '待确认');
});

test('_parseTypeFromRemark：从 remark 提取「类型:xxx」', () => {
  assert.strictEqual(sched._parseTypeFromRemark('类型:庙会包场\n其他备注'), '庙会包场');
  assert.strictEqual(sched._parseTypeFromRemark('类型：文旅演出'), '文旅演出');
  assert.strictEqual(sched._parseTypeFromRemark('普通备注无类型'), '');
  assert.strictEqual(sched._parseTypeFromRemark(null), '');
});

test('toApi：DB 行 → 前端字段映射', () => {
  const row = {
    id: 's1', scheduleNo: 'SCH-001', orderId: 'o1', status: 'confirmed',
    playId: 'p1', playTitle: '火焰驹',
    scheduleDateStart: new Date(2026, 8, 30, 19, 30),
    scheduleDateEnd: new Date(2026, 8, 30, 22, 30),
    performanceTime: '夜场',
    venueProvince: '甘肃省', venueCity: '天水市', venueDistrict: '秦安县', venueAddress: '文化广场',
    audienceSize: 500, feeAmount: 10000,
    remark: '类型:商演\n重要客户',
    createdBy: 'admin',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z')
  };
  const api = sched.toApi(row);
  assert.strictEqual(api.id, 's1');
  assert.strictEqual(api.scheduleNo, 'SCH-001');
  assert.strictEqual(api.status, 'confirmed');
  assert.strictEqual(api.statusText, '已确认');
  assert.strictEqual(api.playTitle, '火焰驹');
  assert.strictEqual(api.date, '2026-09-30');
  assert.strictEqual(api.week, '星期三');
  assert.strictEqual(api.time, '夜场');
  assert.strictEqual(api.type, '商演');
  assert.strictEqual(api.venue, '秦安县 · 文化广场');
  assert.strictEqual(api.feeAmount, 10000);
  assert.strictEqual(api.leader, 'admin');
});

test('toApi(null) 返回 null', () => {
  assert.strictEqual(sched.toApi(null), null);
});

// ========== buildListWhere 查询条件构造 ==========

test('buildListWhere：无参数返回空 where', () => {
  const where = sched.buildListWhere({});
  assert.deepStrictEqual(where, {});
});

test('buildListWhere：keyword 触发 OR 搜索（4个字段）', () => {
  const where = sched.buildListWhere({ keyword: '火焰' });
  assert.ok(Array.isArray(where.OR) && where.OR.length === 4);
});

test('buildListWhere：status 精确匹配', () => {
  const where = sched.buildListWhere({ status: 'confirmed' });
  assert.strictEqual(where.status, 'confirmed');
});

test('buildListWhere：year+month 构造日期范围', () => {
  const where = sched.buildListWhere({ year: '2026', month: '9' });
  assert.ok(where.scheduleDateStart);
  assert.ok(where.scheduleDateStart.gte instanceof Date);
  assert.ok(where.scheduleDateStart.lte instanceof Date);
  assert.strictEqual(where.scheduleDateStart.gte.getFullYear(), 2026);
  assert.strictEqual(where.scheduleDateStart.gte.getMonth(), 8);
});

test('buildListWhere：dateFrom/dateTo 构造范围', () => {
  const where = sched.buildListWhere({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
  assert.ok(where.scheduleDateStart.gte instanceof Date);
  assert.ok(where.scheduleDateStart.lte instanceof Date);
});

test('buildListWhere：playId 和 orderId 过滤', () => {
  const where = sched.buildListWhere({ playId: 'p1', orderId: 'o1' });
  assert.strictEqual(where.playId, 'p1');
  assert.strictEqual(where.orderId, 'o1');
});

// ========== list 接口：验证 select 投影 + 分页 ==========

test('list：findMany 使用 select 投影（不全量取字段）', async () => {
  reset();
  const ctx = { query: { page: '1', pageSize: '20' }, state: {}, body: null, status: 0 };
  await sched.list(ctx);
  assert.ok(captured.findMany.select, 'findMany 必须有 select');
  assert.strictEqual(captured.findMany.select.id, true);
  assert.strictEqual(captured.findMany.select.playTitle, true);
  assert.strictEqual(captured.findMany.select.scheduleDateStart, true);
  // 不应包含未使用的字段（如 weatherForecast 之外的冗余）
  assert.strictEqual(captured.findMany.skip, 0);
  assert.strictEqual(captured.findMany.take, 20);
  assert.deepStrictEqual(captured.findMany.orderBy, { scheduleDateStart: 'asc' });
});

test('list：year/month 参数透传到 where', async () => {
  reset();
  const ctx = { query: { year: '2026', month: '9' }, state: {}, body: null, status: 0 };
  await sched.list(ctx);
  assert.ok(captured.findMany.where.scheduleDateStart);
});

// ========== stats 接口：验证 groupBy + aggregate ==========

test('stats：使用 groupBy 按 status 聚合 + aggregate 求和', async () => {
  reset();
  const ctx = { query: { year: '2026', month: '9' }, state: {}, body: null, status: 0 };
  await sched.stats(ctx);
  assert.ok(captured.groupBy, 'stats 必须调用 groupBy');
  assert.deepStrictEqual(captured.groupBy.by, ['status']);
  assert.ok(captured.aggregate, 'stats 必须调用 aggregate');
  assert.ok(captured.aggregate._sum.feeAmount);
  assert.strictEqual(ctx.body.data.year, 2026);
  assert.strictEqual(ctx.body.data.month, 9);
  assert.strictEqual(ctx.body.data.total, 0);
});

test('stats：groupBy 结果正确映射到各状态计数', async () => {
  reset();
  stubPrisma.scheduleV2.groupBy = async () => [
    { status: 'confirmed', _count: { id: 3 } },
    { status: 'draft', _count: { id: 1 } },
    { status: 'completed', _count: { id: 2 } }
  ];
  stubPrisma.scheduleV2.aggregate = async () => ({
    _count: { id: 6 },
    _sum: { feeAmount: 30000, audienceSize: 1000, actualAttendance: 800 }
  });
  const ctx = { query: { year: '2026', month: '9' }, state: {}, body: null, status: 0 };
  await sched.stats(ctx);
  assert.strictEqual(ctx.body.data.total, 6);
  assert.strictEqual(ctx.body.data.confirmed, 3);
  assert.strictEqual(ctx.body.data.draft, 1);
  assert.strictEqual(ctx.body.data.completed, 2);
  assert.strictEqual(ctx.body.data.totalFee, 30000);
  assert.strictEqual(ctx.body.data.totalAudience, 1000);
  assert.strictEqual(ctx.body.data.totalAttendance, 800);
});

// ========== calendar 接口：验证轻量投影 ==========

test('calendar：使用精简 select，返回 toCalendarItem 格式', async () => {
  reset();
  stubPrisma.scheduleV2.findMany = async args => {
    captured.findMany = args;
    return [{
      id: 's1', scheduleNo: 'SCH-1', playTitle: '火焰驹', status: 'confirmed',
      scheduleDateStart: new Date(2026, 8, 30, 19, 30), performanceTime: '夜场',
      venueDistrict: '秦安县', venueAddress: '文化广场'
    }];
  };
  const ctx = { query: { year: '2026', month: '9' }, state: {}, body: null, status: 0 };
  await sched.calendar(ctx);
  // 验证 select 只包含日历所需字段
  assert.strictEqual(captured.findMany.select.feeAmount, undefined, 'calendar 不应取 feeAmount');
  assert.strictEqual(captured.findMany.select.remark, undefined, 'calendar 不应取 remark');
  assert.strictEqual(captured.findMany.select.playTitle, true);
  // 验证返回格式
  const item = ctx.body.data[0];
  assert.strictEqual(item.id, 's1');
  assert.strictEqual(item.title, '火焰驹');
  assert.strictEqual(item.date, '2026-09-30');
  assert.strictEqual(item.venue, '秦安县 · 文化广场');
  assert.strictEqual(item.feeAmount, undefined, '日历项不应包含财务字段');
});

// ========== conflicts 接口：验证冲突检测逻辑 ==========

test('conflicts：同日 ≥2 场未取消排期判定为冲突', async () => {
  reset();
  stubPrisma.scheduleV2.findMany = async () => [
    { id: 's1', scheduleNo: 'SCH-1', playTitle: '火焰驹', scheduleDateStart: new Date(2026, 8, 30, 19, 30) },
    { id: 's2', scheduleNo: 'SCH-2', playTitle: '周仁回府', scheduleDateStart: new Date(2026, 8, 30, 14, 0) },
    { id: 's3', scheduleNo: 'SCH-3', playTitle: '三滴血', scheduleDateStart: new Date(2026, 8, 28, 19, 30) }
  ];
  const ctx = { query: {}, state: {}, body: null, status: 0 };
  await sched.conflicts(ctx);
  assert.strictEqual(ctx.body.data.total, 1);
  assert.strictEqual(ctx.body.data.conflicts[0].date, '2026-09-30');
  assert.strictEqual(ctx.body.data.conflicts[0].count, 2);
  assert.strictEqual(ctx.body.data.conflicts[0].items.length, 2);
});

test('conflicts：无冲突时返回空数组', async () => {
  reset();
  stubPrisma.scheduleV2.findMany = async () => [
    { id: 's1', scheduleNo: 'SCH-1', playTitle: '火焰驹', scheduleDateStart: new Date(2026, 8, 30, 19, 30) }
  ];
  const ctx = { query: {}, state: {}, body: null, status: 0 };
  await sched.conflicts(ctx);
  assert.strictEqual(ctx.body.data.total, 0);
  assert.deepStrictEqual(ctx.body.data.conflicts, []);
});

// ========== create 接口：验证必填校验 ==========

test('create：缺少 date 抛出校验错误', async () => {
  const ctx = { request: { body: { orderId: 'o1' } }, state: { user: { username: 'admin' } }, body: null, status: 0 };
  await assert.rejects(() => sched.create(ctx), /date 必填/);
});

test('create：缺少 orderId 抛出校验错误', async () => {
  const ctx = { request: { body: { date: '2026-09-30' } }, state: { user: { username: 'admin' } }, body: null, status: 0 };
  await assert.rejects(() => sched.create(ctx), /orderId 必填/);
});

// ========== detail 接口 ==========

test('detail：记录不存在抛 NOT_FOUND', async () => {
  reset();
  stubPrisma.scheduleV2.findUnique = async () => null;
  const ctx = { params: { id: 's999' }, state: {}, body: null, status: 0 };
  await assert.rejects(() => sched.detail(ctx), /排期不存在/);
});

test('detail：记录存在返回 toApi 投影', async () => {
  reset();
  stubPrisma.scheduleV2.findUnique = async () => ({
    id: 's1', scheduleNo: 'SCH-1', orderId: 'o1', status: 'confirmed',
    playId: 'p1', playTitle: '火焰驹',
    scheduleDateStart: new Date(2026, 8, 30, 19, 30),
    scheduleDateEnd: new Date(2026, 8, 30, 22, 30),
    performanceTime: '夜场',
    venueProvince: '甘肃省', venueCity: '天水市', venueDistrict: '秦安县', venueAddress: '文化广场',
    audienceSize: 500, feeAmount: 10000,
    remark: '类型:商演', createdBy: 'admin',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z')
  });
  const ctx = { params: { id: 's1' }, state: {}, body: null, status: 0 };
  await sched.detail(ctx);
  assert.strictEqual(ctx.body.data.id, 's1');
  assert.strictEqual(ctx.body.data.statusText, '已确认');
  assert.strictEqual(ctx.body.data.date, '2026-09-30');
});

// ========== create 成功路径 ==========

test('create：成功创建并返回 toApi', async () => {
  reset();
  stubPrisma.scheduleV2.create = async args => { captured.create = args; return args.data; };
  const ctx = {
    request: { body: { date: '2026-09-30', orderId: 'o1', title: '火焰驹', time: '夜场', type: '商演' } },
    state: { user: { username: 'admin' } }, body: null, status: 0
  };
  await sched.create(ctx);
  assert.strictEqual(captured.create.data.orderId, 'o1');
  assert.strictEqual(captured.create.data.playTitle, '火焰驹');
  assert.ok(captured.create.data.scheduleDateStart instanceof Date);
});

test('create：conflictCheck=true 且同日已有排期时抛 CONFLICT', async () => {
  reset();
  stubPrisma.scheduleV2.count = async () => 1;
  const ctx = {
    request: { body: { date: '2026-09-30', orderId: 'o1', conflictCheck: true } },
    state: { user: { username: 'admin' } }, body: null, status: 0
  };
  await assert.rejects(() => sched.create(ctx), /已有 1 场排期/);
});

// ========== update 成功路径 ==========

test('update：记录不存在抛 NOT_FOUND', async () => {
  reset();
  stubPrisma.scheduleV2.findUnique = async () => null;
  const ctx = { params: { id: 's999' }, request: { body: { status: 'confirmed' } }, state: {}, body: null, status: 0 };
  await assert.rejects(() => sched.update(ctx), /排期不存在/);
});

test('update：成功更新 status 字段', async () => {
  reset();
  stubPrisma.scheduleV2.findUnique = async () => ({ id: 's1', scheduleNo: 'SCH-1', performanceTime: '夜场' });
  stubPrisma.scheduleV2.update = async args => { captured.update = args; return { id: 's1', scheduleNo: 'SCH-1', status: 'confirmed', performanceTime: '夜场', playTitle: '火焰驹', scheduleDateStart: new Date(2026, 8, 30, 19, 30), venueDistrict: '秦安县', venueAddress: '文化广场', orderId: 'o1', remark: '', createdBy: 'admin', createdAt: new Date(), updatedAt: new Date() }; };
  const ctx = { params: { id: 's1' }, request: { body: { status: 'confirmed' } }, state: { user: { username: 'admin' } }, body: null, status: 0 };
  await sched.update(ctx);
  assert.strictEqual(captured.update.where.id, 's1');
  assert.strictEqual(captured.update.data.status, 'confirmed');
  assert.ok(captured.update.data.ts, 'update 必须写 ts');
});

test('update：completedDate 触发 status=completed', async () => {
  reset();
  stubPrisma.scheduleV2.findUnique = async () => ({ id: 's1', scheduleNo: 'SCH-1', performanceTime: '夜场' });
  stubPrisma.scheduleV2.update = async args => { captured.update = args; return { id: 's1', scheduleNo: 'SCH-1', status: 'completed', performanceTime: '夜场', playTitle: '', scheduleDateStart: new Date(2026, 8, 30), venueDistrict: '', venueAddress: '', orderId: 'o1', remark: '', createdBy: 'admin', createdAt: new Date(), updatedAt: new Date() }; };
  const ctx = { params: { id: 's1' }, request: { body: { completedDate: '2026-10-01', actualAttendance: 480 } }, state: { user: { username: 'admin' } }, body: null, status: 0 };
  await sched.update(ctx);
  assert.strictEqual(captured.update.data.status, 'completed');
  assert.ok(captured.update.data.completedDate instanceof Date);
  assert.strictEqual(captured.update.data.attendanceStatus, '已完成');
});

// ========== remove 成功路径 ==========

test('remove：记录不存在抛 NOT_FOUND', async () => {
  reset();
  stubPrisma.scheduleV2.findUnique = async () => null;
  const ctx = { params: { id: 's999' }, state: {}, body: null, status: 0 };
  await assert.rejects(() => sched.remove(ctx), /排期不存在/);
});

test('remove：成功删除返回 noContent', async () => {
  reset();
  stubPrisma.scheduleV2.findUnique = async () => ({ id: 's1', scheduleNo: 'SCH-1' });
  stubPrisma.scheduleV2.delete = async args => { captured.delete = args; return {}; };
  const ctx = { params: { id: 's1' }, state: { user: { username: 'admin' } }, body: null, status: 0 };
  await sched.remove(ctx);
  assert.strictEqual(captured.delete.where.id, 's1');
  assert.strictEqual(ctx.status, 204);
});
