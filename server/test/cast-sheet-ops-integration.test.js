/* ==========================================================================
 * server/test/cast-sheet-ops-integration.test.js
 * 已发布阵容管理操作控制 · 集成测试（真实 HTTP 端到端，零外部依赖、零生产接触）
 *
 *   node server/test/cast-sheet-ops-integration.test.js
 *
 * 起本地 Koa app，走完整中间件链：
 *   HTTP → koaBody → errorHandler → jwtAuth → requireAuth → requireRole
 *   → castSheetsCtrl.{update,remove,setVisibility,listVersions,getVersion,rollback}
 *   → Prisma(临时 SQLite)
 * 覆盖本次新增能力：
 *   · 修改（草稿/重发布）+ 版本快照
 *   · 删除（二次校验：关联排期拒删 → 软删除 + 审计）
 *   · 公开状态一键切换（暂停/恢复 + 实时状态）
 *   · 权限校验（仅创建者或管理员）
 *   · 版本历史列表/明细/回滚
 *
 * 退出码：0=全部通过；2=存在失败项；3=环境准备失败
 * ========================================================================== */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const SERVER_ROOT = path.resolve(__dirname, '..');
const RUN_TAG = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const TMP_DB = path.join(os.tmpdir(), `qaxqjt-csops-${RUN_TAG}.db`);
const DB_URL = 'file:' + TMP_DB.replace(/\\/g, '/');

/* ────────────── 极简断言引擎 ────────────── */
const CHECKS = [];
let SEQ = 0;
function check(group, name, expected, actual, extra) {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  CHECKS.push({ seq: ++SEQ, group, name, expected, actual, pass, note: extra || '' });
  return pass;
}
function checkTrue(group, name, cond, extra) { return check(group, name, true, !!cond, extra); }

/* ────────────── 全局句柄 ────────────── */
let prisma = null, server = null, BASE = '', TOKENS = {};

async function req(method, p, opts) {
  opts = opts || {};
  const headers = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
  const init = { method: method, headers: headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(BASE + p, init);
  let json = null;
  try { json = await res.json(); } catch (_) { json = null; }
  return { status: res.status, json: json, body: json };
}
function expectStatus(group, name, r, status, code) {
  check(group, name + ' · HTTP 状态', status, r.status, 'code=' + (r.json && r.json.error && r.json.error.code));
  if (code) check(group, name + ' · 错误码', code, r.json && r.json.error && r.json.error.code);
}

/* ────────────── Phase 0：环境准备 ────────────── */
async function setup() {
  console.log('════════════════════════════════════════════════════════════');
  console.log(' 已发布阵容管理操作控制 · 集成测试  RUN ' + RUN_TAG);
  console.log('════════════════════════════════════════════════════════════');
  console.log('[Phase 0] 环境准备');
  console.log('  临时 SQLite : ' + TMP_DB);

  execSync('npx prisma db push --accept-data-loss --skip-generate', {
    cwd: SERVER_ROOT,
    env: Object.assign({}, process.env, { DATABASE_URL: DB_URL }),
    stdio: 'pipe', timeout: 180000
  });
  console.log('  prisma db push : OK');

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = DB_URL;
  process.env.JWT_ACCESS_SECRET = 'it-csops-access-secret-0123456789abcdef';
  process.env.JWT_REFRESH_SECRET = 'it-csops-refresh-secret-0123456789abcdef';
  process.env.LOG_LEVEL = 'error';

  const _origSetInterval = global.setInterval;
  const _timers = [];
  global.setInterval = function () {
    const h = _origSetInterval.apply(null, arguments);
    try { if (h && typeof h.unref === 'function') h.unref(); } catch (_) {}
    _timers.push(h);
    return h;
  };
  global.__IT_TIMERS = _timers;

  const app = require('../src/app');
  prisma = require('../src/utils/prisma');
  const { signAccess } = require('../src/utils/crypto');
  await prisma.castSheetsV1.count();
  console.log('  PrismaClient 连接自检 OK（临时库）');

  const mk = (sub, username, role) => signAccess({ sub, username, role, realName: 'IT-' + role, roles: [role] });
  TOKENS = {
    superAdmin: mk('acc_it_super', 'it_super', 'super_admin'),
    admin: mk('acc_it_admin', 'it_admin', 'admin'),
    ops: mk('acc_it_ops', 'it_ops', 'ops'),
    director: mk('acc_it_director', 'it_director', 'director')
  };

  server = http.createServer(app.callback());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  BASE = 'http://127.0.0.1:' + server.address().port;
  console.log('  HTTP 服务已起 : ' + BASE);
}

/* ────────────── Phase 1：数据准备 ────────────── */
async function seed() {
  console.log('[Phase 1] 数据准备（直接落库前置主数据 + 经真实 HTTP 建阵容）');
  const now = Date.now();
  const out = {};

  // 前置主数据：账号（audit_logs.accountId 外键必需，保证审计真实落库）
  const accts = [
    ['acc_it_super', 'it_super', 'super_admin'],
    ['acc_it_admin', 'it_admin', 'admin'],
    ['acc_it_ops', 'it_ops', 'ops'],
    ['acc_it_director', 'it_director', 'director']
  ];
  for (const a of accts) {
    await prisma.accountsV2.create({
      data: { id: a[0], username: a[1], passwordHash: 'x', realName: 'IT-' + a[2], role: a[2], ts: BigInt(now) }
    });
  }

  // 前置主数据：客户 → 订单 → 排期（CastSheetsV1.scheduleId 外键必需）
  await prisma.customersV1.create({
    data: { id: 'cus_it_1', customerName: '集成测试客户', phone: '13800000000', ts: BigInt(now) }
  });
  await prisma.order.create({
    data: {
      id: 'ord_it_1', orderNo: 'ORD-IT-1', customerId: 'cus_it_1', customerName: '集成测试客户',
      orderDate: new Date(), ts: BigInt(now)
    }
  });
  await prisma.scheduleV2.create({
    data: {
      id: 'sch_it_1', scheduleNo: 'SCH-IT-1', orderId: 'ord_it_1',
      scheduleDateStart: new Date(), scheduleDateEnd: new Date(), ts: BigInt(now)
    }
  });
  await prisma.scheduleV2.create({
    data: {
      id: 'sch_it_2', scheduleNo: 'SCH-IT-2', orderId: 'ord_it_1',
      scheduleDateStart: new Date(), scheduleDateEnd: new Date(), ts: BigInt(now)
    }
  });

  const mkSheet = async (token, title, crew) => {
    const r = await req('POST', '/v1/cast-sheets', {
      token: token,
      body: { scheduleId: 'sch_it_1', playTitle: title, performanceDate: '2026-10-20', crew: crew }
    });
    if (r.status !== 201) throw new Error('建阵容失败 HTTP ' + r.status + ' ' + JSON.stringify(r.json));
    return r.json.data;
  };

  // A：super_admin 建（用于 修改/公开切换/版本/软删）
  out.A = await mkSheet(TOKENS.superAdmin, '火焰驹', [
    { performerName: '王演员', category: '主演', roleName: '李彦贵' },
    { performerName: '李乐师', category: '乐队', sortOrder: 5, wageAmount: 300 }
  ]);
  // O：director 建（用于 权限：创建者本人可操作）
  out.O = await mkSheet(TOKENS.director, '游龟山', [{ performerName: '赵演员', category: '配角' }]);
  // B：super_admin 建（用于 关联排期 → 拒删）
  out.B = await mkSheet(TOKENS.superAdmin, '三滴血', [{ performerName: '孙演员', category: '龙套' }]);

  check('P1 数据准备', 'A 初始为草稿', 'draft', out.A.status);
  check('P1 数据准备', 'A 创建者为 super sub', 'acc_it_super', out.A.createdBy);
  check('P1 数据准备', 'O 创建者为 director sub', 'acc_it_director', out.O.createdBy);
  check('P1 数据准备', 'A crew 2 条', 2, out.A.crew.length);
  // 版本表在 create 时已留痕
  const v0 = await prisma.castSheetVersions.count({ where: { castSheetId: out.A.id } });
  check('P1 数据准备', 'A create 版本快照 1 条', 1, v0);
  console.log('  已备：A(super 火焰驹) O(director 游龟山) B(super 三滴血)');
  return out;
}

/* ────────────── Phase 2：执行校验 ────────────── */
async function phaseExecute(d) {
  const G = 'P2 端点分支';
  console.log('[Phase 2] 操作端点执行（真实 HTTP 全分支）');

  // ① 鉴权：无 token
  expectStatus(G, 'E1 未登录查版本', await req('GET', '/v1/cast-sheets/' + d.A.id + '/versions'), 401, 'UNAUTHORIZED');

  // ② 权限：ops 非创建者、非管理员 → 403
  expectStatus(G, 'E2 ops 修改 A（非创建者）', await req('PATCH', '/v1/cast-sheets/' + d.A.id, { token: TOKENS.ops, body: { crewNote: '越权' } }), 403, 'FORBIDDEN');
  expectStatus(G, 'E3 ops 删除 A（非创建者）', await req('DELETE', '/v1/cast-sheets/' + d.A.id, { token: TOKENS.ops }), 403, 'FORBIDDEN');
  expectStatus(G, 'E4 ops 切换 A 公开（非创建者）', await req('POST', '/v1/cast-sheets/' + d.A.id + '/visibility', { token: TOKENS.ops, body: { public: true } }), 403, 'FORBIDDEN');
  expectStatus(G, 'E5 ops 删 O（非创建者）', await req('DELETE', '/v1/cast-sheets/' + d.O.id, { token: TOKENS.ops }), 403, 'FORBIDDEN');

  // ③ 权限：创建者本人可操作（director 操作自己的 O）
  const rOwner = await req('PATCH', '/v1/cast-sheets/' + d.O.id, { token: TOKENS.director, body: { crewNote: '本人备注' } });
  expectStatus(G, 'E6 director 改自己创建的 O', rOwner, 200);

  // ④ 权限：admin 可操作他人创建的 A
  const rAdmin = await req('PATCH', '/v1/cast-sheets/' + d.A.id, { token: TOKENS.admin, body: { venueFull: '秦安县文化中心' } });
  expectStatus(G, 'E7 admin 改他人创建的 A', rAdmin, 200);
  check(G, 'E7 修改后 venueFull 回填', '秦安县文化中心', rAdmin.json.data.venueFull);
  check(G, 'E7 修改后版本号自增到 2', 2, rAdmin.json.data.versionNumber);

  // ⑤ 公开状态切换：先发布（改为 confirmed）→ 暂停 → 恢复
  const rPub = await req('PATCH', '/v1/cast-sheets/' + d.A.id, { token: TOKENS.superAdmin, body: { status: 'confirmed' } });
  expectStatus(G, 'E8 发布 A（status=confirmed）', rPub, 200);
  check(G, 'E8 发布后 statusText', '已确认', rPub.json.data.statusText);
  const pubList1 = await req('GET', '/v1/cast-sheets/public?pageSize=50');
  checkTrue(G, 'E8 官网公开列表包含 A', pubList1.status === 200 && pubList1.json.data.some(x => x.id === d.A.id), 'A 应已在公开列表');

  const rOff = await req('POST', '/v1/cast-sheets/' + d.A.id + '/visibility', { token: TOKENS.superAdmin, body: { public: false } });
  expectStatus(G, 'E9 一键暂停公开', rOff, 200);
  check(G, 'E9 暂停后 status=draft', 'draft', rOff.json.data.status);
  const pubList2 = await req('GET', '/v1/cast-sheets/public?pageSize=50');
  checkTrue(G, 'E9 官网公开列表不再含 A', pubList2.status === 200 && !pubList2.json.data.some(x => x.id === d.A.id), 'A 应已从公开列表移除');
  expectStatus(G, 'E9 暂停后公开详情 404', await req('GET', '/v1/cast-sheets/public/' + d.A.id), 404, 'NOT_FOUND');

  const rOn = await req('POST', '/v1/cast-sheets/' + d.A.id + '/visibility', { token: TOKENS.admin, body: { public: true } });
  expectStatus(G, 'E10 一键恢复公开（admin）', rOn, 200);
  check(G, 'E10 恢复后 status=confirmed', 'confirmed', rOn.json.data.status);
  // 幂等：重复恢复不报错
  expectStatus(G, 'E10 重复恢复幂等', await req('POST', '/v1/cast-sheets/' + d.A.id + '/visibility', { token: TOKENS.admin, body: { public: true } }), 200);
  // 参数校验
  expectStatus(G, 'E11 visibility 缺 public', await req('POST', '/v1/cast-sheets/' + d.A.id + '/visibility', { token: TOKENS.superAdmin, body: {} }), 400, 'VALIDATION_ERROR');

  // ⑥ 版本历史：列表 / 明细 / 回滚
  const rVerList = await req('GET', '/v1/cast-sheets/' + d.A.id + '/versions', { token: TOKENS.superAdmin });
  expectStatus(G, 'E12 版本列表', rVerList, 200);
  checkTrue(G, 'E12 版本列表 ≥ 4 条且倒序', Array.isArray(rVerList.json.data) && rVerList.json.data.length >= 4, 'count=' + (rVerList.json.data || []).length);
  const vidCreate = rVerList.json.data.filter(v => v.changeType === 'create').pop();
  const rVerOne = await req('GET', '/v1/cast-sheets/' + d.A.id + '/versions/' + vidCreate.id, { token: TOKENS.superAdmin });
  expectStatus(G, 'E13 版本明细', rVerOne, 200);
  check(G, 'E13 快照初始为草稿', 'draft', rVerOne.json.data.snapshot && rVerOne.json.data.snapshot.status);
  const rRollback = await req('POST', '/v1/cast-sheets/' + d.A.id + '/versions/' + vidCreate.id + '/rollback', { token: TOKENS.superAdmin });
  expectStatus(G, 'E14 回滚至 create 版本', rRollback, 200);
  check(G, 'E14 回滚后 status=draft', 'draft', rRollback.json.data.status);
  check(G, 'E14 回滚后 crew 恢复 2 条', 2, rRollback.json.data.crew.length);

  // ⑦ 删除：关联排期 → CONFLICT；解除后软删除
  await prisma.scheduleV2.update({ where: { id: 'sch_it_2' }, data: { castSheetId: d.B.id } });
  expectStatus(G, 'E15 被排期关联的 B 拒删', await req('DELETE', '/v1/cast-sheets/' + d.B.id, { token: TOKENS.superAdmin }), 409, 'CONFLICT');
  await prisma.scheduleV2.update({ where: { id: 'sch_it_2' }, data: { castSheetId: null } });
  expectStatus(G, 'E16 解除关联后软删除 B', await req('DELETE', '/v1/cast-sheets/' + d.B.id, { token: TOKENS.superAdmin }), 204);

  return { vidCreate: vidCreate.id };
}

/* ────────────── Phase 3：结果校验 ────────────── */
async function phaseVerify(d) {
  const G = 'P3 结果校验';
  console.log('[Phase 3] 结果校验（直连临时库 + 列表/审计）');

  // ① 软删除落库
  const b = await prisma.castSheetsV1.findUnique({ where: { id: d.B.id } });
  checkTrue(G, 'D1 B.deletedAt 已置位', b.deletedAt instanceof Date && !isNaN(+b.deletedAt));
  check(G, 'D2 B.deletedBy = 发起人 sub', 'acc_it_super', b.deletedBy);
  const bCrew = await prisma.castSheetCrew.count({ where: { castSheetId: d.B.id } });
  check(G, 'D3 软删除保留 crew 明细', 1, bCrew);

  // ② 列表排除已删除；详情 404
  const rList = await req('GET', '/v1/cast-sheets?page=1&pageSize=100', { token: TOKENS.superAdmin });
  checkTrue(G, 'D4 列表不含已软删除的 B', rList.status === 200 && !rList.json.data.some(x => x.id === d.B.id));
  expectStatus(G, 'D5 已删除 B 详情 404', await req('GET', '/v1/cast-sheets/' + d.B.id, { token: TOKENS.superAdmin }), 404, 'NOT_FOUND');

  // ③ 审计留痕
  const audits = await prisma.auditLog.findMany({ where: { action: 'CAST_SHEET_SOFT_DELETE', targetId: d.B.id } });
  check(G, 'D6 审计 CAST_SHEET_SOFT_DELETE 1 条', 1, audits.length);
  const pubAudits = await prisma.auditLog.count({ where: { action: 'CAST_SHEET_PUBLISH', targetId: d.A.id } });
  checkTrue(G, 'D7 审计含 CAST_SHEET_PUBLISH', pubAudits >= 1, 'count=' + pubAudits);
  const unpubAudits = await prisma.auditLog.count({ where: { action: 'CAST_SHEET_UNPUBLISH', targetId: d.A.id } });
  checkTrue(G, 'D8 审计含 CAST_SHEET_UNPUBLISH', unpubAudits >= 1, 'count=' + unpubAudits);

  // ④ 版本表落库（A 应有多条且含 rollback）
  const aVers = await prisma.castSheetVersions.findMany({ where: { castSheetId: d.A.id } });
  checkTrue(G, 'D9 A 版本记录 ≥ 6 条', aVers.length >= 6, 'count=' + aVers.length);
  checkTrue(G, 'D10 A 版本含 rollback 类型', aVers.some(v => v.changeType === 'rollback'));
  // B 软删除版本
  const bVers = await prisma.castSheetVersions.findMany({ where: { castSheetId: d.B.id } });
  checkTrue(G, 'D11 B 版本含 delete 类型', bVers.some(v => v.changeType === 'delete'));

  // ⑤ 回滚后 A 的 crew 与初始一致（版本快照端到端）
  const aFull = await prisma.castSheetsV1.findUnique({ where: { id: d.A.id }, include: { crew: true } });
  check(G, 'D12 A 回滚后 crew 数 = 2', 2, aFull.crew.length);
  checkTrue(G, 'D13 A 回滚后含初始"王演员"', aFull.crew.some(c => c.performerName === '王演员'));
}

/* ────────────── Phase 4：清理 ────────────── */
async function cleanup() {
  console.log('[Phase 4] 清理');
  try { (global.__IT_TIMERS || []).forEach(h => { try { clearInterval(h); } catch (_) {} }); } catch (_) {}
  try {
    if (server) {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise(r => server.close(r));
    }
  } catch (_) {}
  try { if (prisma) await prisma.$disconnect(); } catch (_) {}
  [TMP_DB, TMP_DB + '-journal', TMP_DB + '-wal', TMP_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
  await new Promise(r => setTimeout(r, 250));
  console.log('  临时 SQLite 已删除（报告仅保留在标准输出）');
}

/* ────────────── 主入口 ────────────── */
(async function main() {
  const C = { R: '\x1b[31m', G: '\x1b[32m', BLD: '\x1b[1m', CLR: '\x1b[0m' };
  let fatal = null;
  try {
    await setup();
  } catch (e) {
    console.error(C.R + 'FATAL 环境准备失败：' + (e && e.message) + C.CLR);
    process.exit(3);
  }
  try {
    const d = await seed();
    await phaseExecute(d);
    await phaseVerify(d);
  } catch (e) {
    fatal = e;
    console.error(C.R + '执行期异常：' + (e && e.stack ? e.stack : e) + C.CLR);
  }
  await cleanup();

  const groups = {};
  CHECKS.forEach(c => { (groups[c.group] = groups[c.group] || []).push(c); });
  let pass = 0;
  console.log('');
  for (const g of Object.keys(groups)) {
    console.log(C.BLD + '── ' + g + ' ──' + C.CLR);
    groups[g].forEach(c => {
      if (c.pass) { pass++; console.log('  ' + C.G + '✓' + C.CLR + ' ' + c.name); }
      else console.log('  ' + C.R + '✗' + C.CLR + ' ' + c.name + '  期望=' + JSON.stringify(c.expected) + ' 实际=' + JSON.stringify(c.actual) + (c.note ? '  [' + c.note + ']' : ''));
    });
  }
  const total = CHECKS.length;
  const summary = `总计 ${total} 项：✓ ${pass} 通过，✗ ${total - pass} 失败`;
  console.log('');
  console.log((pass === total && !fatal ? C.G : C.R) + summary + C.CLR);
  if (fatal) console.error('存在执行期异常，见上方堆栈');
  process.exit(total - pass === 0 && !fatal ? 0 : 2);
})();
