'use strict';

/**
 * 洛门演出订单花名册 order-roster 控制器单元测试
 * 覆盖：
 *   - 字段校验器（姓名 2-50 / 身份证 GB11643 校验码 / 手机号 11 位）
 *   - Excel 行归一化（中文表头 + 中文状态别名）
 *   - importRoster：逐行校验、批内重复拦截、库内已存在则 upsert 更新、错误行不中断整批
 *   - batchAttendance：枚举守卫 + 事务更新
 *   - create：完整合法字段创建并自动关联在库演职人员
 *   - rolesList：默认角色 + 自定义角色合并去重
 * 桩：require.cache 注入 prisma / audit-service（沿用 finance-m15.test.js 模式）
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { isValidName, isValidMobile, isValidIdCard, normalizeIdCard } = require('../src/utils/validators');

// ========== 校验器 ==========
test('validators: 身份证 GB11643 校验码正确/错误识别', () => {
  assert.strictEqual(isValidIdCard('110101199003078830'), true);
  assert.strictEqual(isValidIdCard('620522199508124568'), true);
  assert.strictEqual(isValidIdCard('110101199003078831'), false); // 校验码错
  assert.strictEqual(isValidIdCard('110101199013078830'), false); // 月份非法
  assert.strictEqual(isValidIdCard('110101199002318830'), false); // 日期非法
  assert.strictEqual(isValidIdCard('11010119900307883'), false);  // 17 位
  assert.strictEqual(isValidIdCard('11010119900307883X'), false); // 末位与校验码不符
});

test('validators: 末位 x 小写也能通过，归一化为 X', () => {
  // 62052219920715005X：加权和模 11 = 2 → 校验码 X
  assert.strictEqual(isValidIdCard('62052219920715005X'), true);
  assert.strictEqual(isValidIdCard('62052219920715005x'), true);
  assert.strictEqual(normalizeIdCard('62052219920715005x'), '62052219920715005X');
});

test('validators: 手机号 11 位（1 开头第二位 3-9）', () => {
  assert.strictEqual(isValidMobile('13993839833'), true);
  assert.strictEqual(isValidMobile('19900001111'), true);
  assert.strictEqual(isValidMobile('12900001111'), false);
  assert.strictEqual(isValidMobile('1399383983'), false);
  assert.strictEqual(isValidMobile('139938398330'), false);
});

test('validators: 姓名 2-50 字符（汉字/字母/间隔号/空格）', () => {
  assert.strictEqual(isValidName('张三'), true);
  assert.strictEqual(isValidName('John Smith'), true);
  assert.strictEqual(isValidName('阿凡提·买买提'), true);
  assert.strictEqual(isValidName('张'), false);
  assert.strictEqual(isValidName('张三123'), false);
});

// ========== 控制器：桩 prisma（必须先装桩再 require 控制器）==========
const controllerDir = path.resolve(__dirname, '../src/controllers');
const prismaId = require.resolve('../utils/prisma', { paths: [controllerDir] });
const auditId = require.resolve('../services/audit-service', { paths: [controllerDir] });

let store = [];
let captured = {};

const stubPrisma = {
  order: { findUnique: async () => ({ id: 'ord_1', orderNo: 'ORD20261008001' }) },
  performersDbV1: {
    // create 自动关联：身份证命中
    findFirst: async args => {
      captured.perfFirst = args;
      return { id: 'pf_match1', idCardNo: '110101199003078830', phone: '13993839833' };
    },
    findMany: async args => {
      captured.perfQuery = args;
      return [{ id: 'pf_match1', idCardNo: '110101199003078830', phone: '13993839833' }];
    }
  },
  orderRosterV1: {
    findMany: async args => {
      const w = (args && args.where) || {};
      if (w.id && w.id.in) return store.filter(r => w.id.in.includes(r.id));
      if (w.idCardNo && w.idCardNo.in) return store.filter(r => w.idCardNo.in.includes(r.idCardNo));
      return store.map(r => ({ ...r }));
    },
    count: async args => {
      const w = (args && args.where) || {};
      if (w.attendanceStatus === null) return store.filter(r => r.attendanceStatus === null).length;
      return store.length;
    },
    groupBy: async () => [],
    findFirst: async () => null,
    findUnique: async args => {
      if (args.where.orderId_idCardNo) {
        return store.find(r => r.orderId === args.where.orderId_idCardNo.orderId && r.idCardNo === args.where.orderId_idCardNo.idCardNo) || null;
      }
      return store.find(r => r.id === args.where.id) || null;
    },
    create: async args => { const row = { id: 'ros_' + (store.length + 1), ...args.data }; store.push(row); captured.lastCreate = args.data; return row; },
    update: async args => {
      const i = store.findIndex(r => r.id === args.where.id);
      if (i < 0) throw new Error('not found');
      store[i] = { ...store[i], ...args.data };
      captured.lastUpdate = args.data;
      return store[i];
    },
    delete: async args => { store = store.filter(r => r.id !== args.where.id); return {}; }
  },
  setting: {
    findUnique: async args => (args.where.key === 'order_roster_roles'
      ? { id: 'set_roles', key: 'order_roster_roles', value: JSON.stringify(['板胡']) }
      : null),
    update: async args => { captured.roleUpdate = args; return {}; },
    create: async args => { captured.roleCreate = args; return {}; }
  },
  $transaction: async ops => {
    captured.txOps = ops.length;
    return Promise.all(ops);
  }
};

require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: stubPrisma };
require.cache[auditId] = { id: auditId, filename: auditId, loaded: true, exports: { audit: async () => {} } };

const roster = require('../src/controllers/order-roster');

function resetStore() {
  store = [];
  captured = {};
}

function mkCtx(body = {}, query = {}) {
  return {
    params: {},
    query,
    request: { body },
    state: { user: { sub: 'acc_super_001', username: 'admin', role: 'super_admin' } },
    status: 0,
    body: null
  };
}

// ========== 行归一化（Excel 中文表头）==========
test('_normalizeRow: 中文表头 + 中文状态别名映射', () => {
  const row = roster._normalizeRow({
    ' 姓名': '张三',
    '身份证号': '110101199003078830',
    '联系方式': '13993839833',
    '角色分配': '主演',
    '参演状态': '已确认',
    '考勤状态': '迟到',
    '备注': '带妆彩排'
  });
  assert.strictEqual(row.name, '张三');
  assert.strictEqual(row.idCardNo, '110101199003078830');
  assert.strictEqual(row.phone, '13993839833');
  assert.strictEqual(row.roleName, '主演');
  assert.strictEqual(row.performStatus, '已确认');
  assert.strictEqual(row.attendanceStatus, '迟到');
  assert.strictEqual(row.remark, '带妆彩排');
});

// ========== 批量导入 ==========
test('importRoster: 2 行合法新建；批内重复/姓名/身份证/手机 4 行计入 failed 且不中断', async () => {
  resetStore();
  const body = {
    orderId: 'ord_1',
    items: [
      { 姓名: '张三', 身份证号: '110101199003078830', 联系方式: '13993839833', 角色分配: '主演', 参演状态: '已确认' },
      { 姓名: '李四', 身份证号: '620522199508124568', 联系方式: '18800002222', 角色: '乐队', 参演状态: '未确认', 考勤状态: '出勤' },
      { 姓名: '王五', 身份证号: '110101199003078830', 联系方式: '13700003333', 角色: '龙套', 参演状态: '已取消' }, // 批内身份证重复
      { 姓名: '赵', 身份证号: '110101199003078830', 联系方式: '13600004444' }, // 姓名长度
      { 姓名: '孙六', 身份证号: '110101199003078831', 联系方式: '13500005555' }, // 校验码错
      { 姓名: '周七', 身份证号: '110101199003078830', 联系方式: '12345678901' } // 手机号段非法
    ]
  };
  const ctx = mkCtx(body);
  await roster.importRoster(ctx);
  assert.strictEqual(ctx.status, 200);
  const d = ctx.body.data;
  assert.strictEqual(d.total, 6);
  assert.strictEqual(d.created, 2);
  assert.strictEqual(d.updated, 0);
  assert.strictEqual(d.failedCount, 4);
  assert.ok(d.failed.some(f => /批内身份证号重复/.test(f.reason)));
  assert.ok(d.failed.some(f => /姓名/.test(f.reason)));
  assert.ok(d.failed.some(f => /身份证号格式非法/.test(f.reason)));
  assert.ok(d.failed.some(f => /手机号格式非法/.test(f.reason)));
});

test('importRoster: 库中已存在同订单同身份证 → 更新而非新建', async () => {
  resetStore();
  store.push({ id: 'ros_old1', orderId: 'ord_1', idCardNo: '620522199508124568', name: '旧名' });
  const ctx = mkCtx({
    orderId: 'ord_1',
    items: [
      { 姓名: '李四', 身份证号: '620522199508124568', 联系方式: '18800002222', 角色: '主持', 参演状态: '已完成' }
    ]
  });
  await roster.importRoster(ctx);
  const d = ctx.body.data;
  assert.strictEqual(d.created, 0);
  assert.strictEqual(d.updated, 1);
  assert.strictEqual(d.failedCount, 0);
  assert.strictEqual(store[0].name, '李四');
  assert.strictEqual(store[0].performStatus, 'completed');
});

test('importRoster: 缺 orderId 抛错；空 items 抛错；超 500 条抛错', async () => {
  resetStore();
  await assert.rejects(() => roster.importRoster(mkCtx({ items: [{}] })), /orderId/);
  await assert.rejects(() => roster.importRoster(mkCtx({ orderId: 'ord_1' })), /items/);
  await assert.rejects(
    () => roster.importRoster(mkCtx({ orderId: 'ord_1', items: Array.from({ length: 501 }, () => ({})) })),
    /500/
  );
});

test('importRoster: 考勤状态别名无法识别 → 计入 failed 不写入', async () => {
  resetStore();
  const ctx = mkCtx({
    orderId: 'ord_1',
    items: [{ 姓名: '张三', 身份证号: '110101199003078830', 联系方式: '13993839833', 角色: '主演', 考勤状态: '未知状态' }]
  });
  await roster.importRoster(ctx);
  assert.strictEqual(ctx.body.data.created, 0);
  assert.strictEqual(ctx.body.data.failedCount, 1);
  assert.match(ctx.body.data.failed[0].reason, /考勤状态无法识别/);
});

// ========== 批量考勤 ==========
test('batchAttendance: 勾选 2 人批量记出勤走事务', async () => {
  resetStore();
  store.push({ id: 'ros_1', orderId: 'ord_1' }, { id: 'ros_2', orderId: 'ord_1' });
  const ctx = mkCtx({ orderId: 'ord_1', ids: ['ros_1', 'ros_2'], attendanceStatus: 'present', attendanceDate: '2026-10-08', remark: '洛门夜场' });
  await roster.batchAttendance(ctx);
  assert.strictEqual(ctx.status, 200);
  assert.strictEqual(ctx.body.data.updated, 2);
  assert.strictEqual(captured.txOps, 2);
  assert.strictEqual(captured.lastUpdate.attendanceStatus, 'present');
});

test('batchAttendance: 非法状态 / 无 scope / 日期非法 均拒绝', async () => {
  resetStore();
  await assert.rejects(
    () => roster.batchAttendance(mkCtx({ orderId: 'ord_1', ids: ['ros_1'], attendanceStatus: 'sleeping' })),
    /考勤状态非法/
  );
  await assert.rejects(
    () => roster.batchAttendance(mkCtx({ ids: [], attendanceStatus: 'present' })),
    /ids|orderId/
  );
  await assert.rejects(
    () => roster.batchAttendance(mkCtx({ orderId: 'ord_1', attendanceStatus: 'late', attendanceDate: '2026-13-99' })),
    /考勤日期非法/
  );
});

// ========== CRUD ==========
test('create: 完整合法字段创建并自动关联在库演职人员', async () => {
  resetStore();
  const ctx = mkCtx({
    orderId: 'ord_1',
    name: '张三',
    idCardNo: '110101199003078830',
    phone: '13993839833',
    roleName: '主演',
    performStatus: 'confirmed'
  });
  await roster.create(ctx);
  assert.strictEqual(ctx.status, 201);
  assert.strictEqual(ctx.body.data.performerId, 'pf_match1');
  assert.match(ctx.body.data.id, /^ros_/);
});

test('create: 身份证校验码错误拒绝且不落库', async () => {
  resetStore();
  const ctx = mkCtx({ orderId: 'ord_1', name: '张三', idCardNo: '110101199003078831', phone: '13993839833', roleName: '主演' });
  await assert.rejects(() => roster.create(ctx), /身份证号格式非法/);
  assert.strictEqual(store.length, 0);
});

test('create: 自定义角色（板胡）创建成功并触发角色字典更新', async () => {
  resetStore();
  const ctx = mkCtx({ orderId: 'ord_1', name: '琴师阿炳', idCardNo: '62052219920715005X', phone: '13911112222', roleName: '板胡' });
  await roster.create(ctx);
  assert.strictEqual(ctx.status, 201);
  // setting.findUnique 返回已有 ['板胡']（桩），merged 去重后不再写入——换一个全新角色断言
  const ctx2 = mkCtx({ orderId: 'ord_1', name: '鼓师老六', idCardNo: '620522199508124568', phone: '13933334444', roleName: '司鼓' });
  await roster.create(ctx2);
  assert.ok(captured.roleUpdate || captured.roleCreate, '新角色应写入自定义字典');
});

// ========== 角色字典 ==========
test('rolesList: 默认角色 + 自定义角色合并去重', async () => {
  resetStore();
  const ctx = mkCtx({}, {});
  await roster.rolesList(ctx);
  assert.ok(ctx.body.data.roles.includes('主演'));
  assert.ok(ctx.body.data.roles.includes('板胡'));
  assert.strictEqual(new Set(ctx.body.data.roles).size, ctx.body.data.roles.length, '角色不应重复');
  assert.strictEqual(ctx.body.data.defaults.length, roster.DEFAULT_ROLES.length);
});
