/* ==========================================================================
 * server/test/voucher-void-integration.test.js
 * 凭证作废功能 · 集成测试（真实 HTTP 端到端，零外部依赖、零生产接触）
 *
 *   node server/test/voucher-void-integration.test.js
 *
 * ── 与 voucher-void-backfill.verify.js 的分工 ────────────────────────────────
 * verify 脚本偏"分支级/桩测试"（stubPrisma 驱动控制器各分支 + 真实库 schema 往返）。
 * 本脚本是**真正的集成测试**：起本地 Koa app，走完整中间件链
 *   HTTP → koaBody → errorHandler → jwtAuth → requireAuth → validate(Joi) →
 *   requireRole → financeCtrl.voidVoucher → Prisma(临时 SQLite)
 * 用真实 JWT（与生产同一 signAccess + 同一密钥算法）驱动，断言 HTTP 状态码、
 * 响应体、DB 落库字段、审计留痕、汇总排除等**端到端可观测结果**。
 *
 * ── 执行架构 ──────────────────────────────────────────────────────────────
 * Phase 0  环境准备：临时 SQLite(os.tmpdir, ASCII 路径) → prisma db push →
 *          注入 DATABASE_URL/JWT 密钥到 process.env → require config/app
 *          （因此全链路 Prisma 单例都指向临时库，杜绝碰生产库）
 *          → http.createServer(app.callback()).listen(0)
 * Phase 1  数据准备：经真实 HTTP 制单（POST /fin/ledger）× N，覆盖
 *          已复核(可作废)/草稿(不可作废)/已对账(不可作废) 三类前置状态
 * Phase 2  执行校验：作废端点全分支（鉴权/校验/状态机/幂等/成功）
 * Phase 3  结果校验：DB 字段往返、审计 LEDGER_VOID、汇总排除 void、
 *          失败用例无副作用、通用 PATCH 无法绕过专用端点
 * Phase 4  清理：关服务、断连、删临时 SQLite 文件
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
const TMP_DB = path.join(os.tmpdir(), `qaxqjt-it-${RUN_TAG}.db`);
const DB_URL = 'file:' + TMP_DB.replace(/\\/g, '/');

/* ────────────────────────── 极简断言引擎 ────────────────────────── */
const CHECKS = [];
let SEQ = 0;
function check(group, name, expected, actual, extra) {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  CHECKS.push({ seq: ++SEQ, group, name, expected, actual, pass, note: extra || '' });
  return pass;
}
function checkTrue(group, name, cond, extra) { return check(group, name, true, !!cond, extra); }
const pad2 = n => String(n).padStart(2, '0');
const monthKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

/* ────────────────────────── 全局句柄 ────────────────────────── */
let prisma = null, server = null, BASE = '', TOKENS = {};

/* ────────────────────────── HTTP 客户端（内置 fetch） ────────────────────────── */
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
/* 便捷断言：响应状态码 + 错误码 */
function expectStatus(group, name, r, status, code) {
  check(group, name + ' · HTTP 状态', status, r.status, 'code=' + (r.json && r.json.error && r.json.error.code));
  if (code) check(group, name + ' · 错误码', code, r.json && r.json.error && r.json.error.code);
}
function errMsg(r) { return (r.json && r.json.error && r.json.error.message) || ''; }

/* ────────────────────────── Phase 0：环境准备 ────────────────────────── */
async function setup() {
  console.log('════════════════════════════════════════════════════════════');
  console.log(' 凭证作废功能 · 集成测试（真实 HTTP 端到端）  RUN ' + RUN_TAG);
  console.log('════════════════════════════════════════════════════════════');
  console.log('[Phase 0] 环境准备');
  console.log('  临时 SQLite : ' + TMP_DB);

  // ① 先建表（此时 process.env 尚未被 app 读取，安全）
  execSync('npx prisma db push --accept-data-loss --skip-generate', {
    cwd: SERVER_ROOT,
    env: Object.assign({}, process.env, { DATABASE_URL: DB_URL }),
    stdio: 'pipe', timeout: 180000
  });
  console.log('  prisma db push : OK');

  // ② 注入运行配置：必须在 require('../src/config') 之前完成，
  //    这样整个链路的 PrismaClient 单例都连临时库，物理上不可能碰生产库。
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = DB_URL;
  process.env.JWT_ACCESS_SECRET = 'it-void-access-secret-0123456789abcdef';
  process.env.JWT_REFRESH_SECRET = 'it-void-refresh-secret-0123456789abcdef';
  process.env.LOG_LEVEL = 'error';

  // ③ 拦截 setInterval：记录 + unref。app 依赖链中存在后台轮询定时器
  //    （performers/helpers.js 定时清理、security-config 轮询等），
  //    若不干预会阻止进程退出，且在 Windows/Node 上于 exit 时触发 libuv 断言崩溃。
  const _timers = [];
  const _origSetInterval = global.setInterval;
  global.setInterval = function () {
    const h = _origSetInterval.apply(null, arguments);
    try { if (h && typeof h.unref === 'function') h.unref(); } catch (_) {}
    _timers.push(h);
    return h;
  };
  global.__IT_TIMERS = _timers;

  const app = require('../src/app');
  prisma = require('../src/utils/prisma');          // 与 app 同一单例（临时库）
  const { signAccess } = require('../src/utils/crypto');
  await prisma.finLedgerV1.count();                  // 连接自检
  console.log('  PrismaClient 连接自检 OK（临时库）');

  // ④ 真实 JWT（与生产同密钥/同 signAccess，仅 payload 不同）
  const mk = (sub, username, role) => signAccess({ sub, username, role, realName: 'IT-' + role, roles: [role] });
  TOKENS = {
    superAdmin:   mk('acc_it_super',   'it_super',   'super_admin'),
    financeAdmin: mk('acc_it_finadmin', 'it_finadmin', 'finance_admin'),
    financeMaker: mk('acc_it_maker',   'it_maker',   'finance_maker'),
    checker:      mk('acc_it_checker', 'it_checker', 'finance_checker'),
    ops:          mk('acc_it_ops',     'it_ops',     'ops')
  };

  // ⑤ 起服务（app.callback() → 独立 http server，随机端口）
  server = http.createServer(app.callback());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  BASE = 'http://127.0.0.1:' + port;
  console.log('  HTTP 服务已起 : ' + BASE);
}

/* ────────────────────────── Phase 1：数据准备（真实 HTTP） ─────────────────── */
async function seed() {
  console.log('[Phase 1] 数据准备（经真实 HTTP 制单）');
  const out = {};

  // 制单（super_admin 在写名单内）→ 草稿；amounts 形如 { creditAmount: 1000 } / { debitAmount: 200 }
  const mkDraft = async (amounts, summary) => {
    const body = Object.assign({ summary: summary, voucherCategory: 'performance' }, amounts);
    const r = await req('POST', '/v1/fin/ledger', { token: TOKENS.superAdmin, body: body });
    if (r.status !== 201) throw new Error('制单失败 HTTP ' + r.status + ' ' + JSON.stringify(r.json));
    return r.json.data;
  };
  // 复核（super_admin 属 M-15 豁免名单，可复核自己制单）
  const toChecked = async id => {
    const r = await req('PATCH', '/v1/fin/ledger/' + id, { token: TOKENS.superAdmin, body: { status: 'checked' } });
    if (r.status !== 200 || r.json.data.status !== 'checked') throw new Error('复核失败 HTTP ' + r.status + ' ' + JSON.stringify(r.json));
    return r.json.data;
  };

  // V1：将用于"成功作废" + 汇总排除断言（收入 1000）
  out.v1 = await toChecked((await mkDraft({ creditAmount: 1000 }, 'IT-待作废收入凭证')).id);
  // V2：将用于 finance_admin 角色成功作废（支出 200）
  out.v2 = await toChecked((await mkDraft({ debitAmount: 200 }, 'IT-finance_admin 作废凭证')).id);
  // V3：仅草稿（不可作废）
  out.v3 = await mkDraft({ creditAmount: 500 }, 'IT-草稿凭证');
  // V4：已复核但已对账（不可作废；无对账端点 → 直连 prisma 置位）
  out.v4 = await toChecked((await mkDraft({ creditAmount: 300 }, 'IT-已对账凭证')).id);
  await prisma.finLedgerV1.update({ where: { id: out.v4.id }, data: { isReconciled: true, reconciledAt: new Date() } });
  out.v4 = await prisma.finLedgerV1.findUnique({ where: { id: out.v4.id } });

  check('P1 数据准备', 'V1 状态/金额', { status: 'checked', credit: '1000' }, { status: out.v1.status, credit: String(out.v1.creditAmount) });
  check('P1 数据准备', 'V2 状态/支出', { status: 'checked', debit: '200' }, { status: out.v2.status, debit: String(out.v2.debitAmount) });
  check('P1 数据准备', 'V3 为草稿', 'draft', out.v3.status);
  check('P1 数据准备', 'V4 已复核且已对账', { status: 'checked', isReconciled: true }, { status: out.v4.status, isReconciled: out.v4.isReconciled });
  console.log('  已备：V1(checked 收入1000) V2(checked 支出200) V3(draft) V4(checked+已对账)');
  return out;
}

/* ──────────────────── Phase 2：执行校验（作废端点全分支） ─────────────────── */
async function phaseExecute(d) {
  const G = 'P2 端点分支';
  console.log('[Phase 2] 作废端点执行（真实 HTTP 全分支）');
  const reasonOk = '集成测试-数据清理';

  // 鉴权
  expectStatus(G, 'I1 未登录', await req('PATCH', '/v1/fin/ledger/' + d.v1.id + '/void', { body: { reason: reasonOk } }), 401, 'UNAUTHORIZED');
  expectStatus(G, 'I2 ops 角色', await req('PATCH', '/v1/fin/ledger/' + d.v1.id + '/void', { token: TOKENS.ops, body: { reason: reasonOk } }), 403, 'FORBIDDEN');
  expectStatus(G, 'I3 finance_maker 角色', await req('PATCH', '/v1/fin/ledger/' + d.v1.id + '/void', { token: TOKENS.financeMaker, body: { reason: reasonOk } }), 403, 'FORBIDDEN');
  expectStatus(G, 'I4 finance_checker 角色', await req('PATCH', '/v1/fin/ledger/' + d.v1.id + '/void', { token: TOKENS.checker, body: { reason: reasonOk } }), 403, 'FORBIDDEN');

  // 入参校验（Joi）
  expectStatus(G, 'I5 reason 缺失', await req('PATCH', '/v1/fin/ledger/' + d.v1.id + '/void', { token: TOKENS.superAdmin, body: {} }), 400, 'VALIDATION_ERROR');
  expectStatus(G, 'I6 reason 仅1字', await req('PATCH', '/v1/fin/ledger/' + d.v1.id + '/void', { token: TOKENS.superAdmin, body: { reason: 'a' } }), 400, 'VALIDATION_ERROR');
  expectStatus(G, 'I7 reason 201字', await req('PATCH', '/v1/fin/ledger/' + d.v1.id + '/void', { token: TOKENS.superAdmin, body: { reason: 'x'.repeat(201) } }), 400, 'VALIDATION_ERROR');

  // 状态机 / 存在性
  expectStatus(G, 'I8 凭证不存在', await req('PATCH', '/v1/fin/ledger/led_not_exist_zzz/void', { token: TOKENS.superAdmin, body: { reason: reasonOk } }), 404, 'NOT_FOUND');
  const rDraft = await req('PATCH', '/v1/fin/ledger/' + d.v3.id + '/void', { token: TOKENS.superAdmin, body: { reason: reasonOk } });
  expectStatus(G, 'I9 草稿不可作废', rDraft, 409, 'CONFLICT');
  checkTrue(G, 'I9 提示指向"已复核/直接删除"', /已复核|草稿/.test(errMsg(rDraft)), errMsg(rDraft));
  expectStatus(G, 'I10 已对账不可作废', await req('PATCH', '/v1/fin/ledger/' + d.v4.id + '/void', { token: TOKENS.superAdmin, body: { reason: reasonOk } }), 409, 'CONFLICT');

  // 成功路径 ①：super_admin 作废 V1
  const rV1 = await req('PATCH', '/v1/fin/ledger/' + d.v1.id + '/void', { token: TOKENS.superAdmin, body: { reason: reasonOk } });
  expectStatus(G, 'I11 super_admin 作废成功', rV1, 200);
  checkTrue(G, 'I11 响应体 ok:true 且 data.status=void', !!rV1.json && rV1.json.ok === true && rV1.json.data && rV1.json.data.status === 'void');
  check(G, 'I11 响应回填 voidReason = 请求原因', reasonOk, rV1.json.data.voidReason);

  // 成功路径 ②：finance_admin 作废 V2（证明第二放行角色）
  const rV2 = await req('PATCH', '/v1/fin/ledger/' + d.v2.id + '/void', { token: TOKENS.financeAdmin, body: { reason: '财务管理员作废' } });
  expectStatus(G, 'I12 finance_admin 作废成功', rV2, 200);
  check(G, 'I12 V2 落 void', 'void', rV2.json.data.status);

  // 幂等：重复作废
  expectStatus(G, 'I13 重复作废同一凭证', await req('PATCH', '/v1/fin/ledger/' + d.v1.id + '/void', { token: TOKENS.superAdmin, body: { reason: reasonOk } }), 409, 'CONFLICT');
  // 终态保护：不可改 / 不可删
  expectStatus(G, 'I14 作废后 PATCH 修改被拒', await req('PATCH', '/v1/fin/ledger/' + d.v1.id, { token: TOKENS.superAdmin, body: { summary: '试图修改' } }), 409, 'CONFLICT');
  expectStatus(G, 'I15 作废后 DELETE 被拒', await req('DELETE', '/v1/fin/ledger/' + d.v1.id, { token: TOKENS.superAdmin }), 409, 'CONFLICT');
  // 绕过防护：通用 PATCH 写 status=void —— 必须用非终态凭证（草稿 V3），
  // 否则会先被"已作废不可修改"(409) 拦截，测不到状态白名单(400)这条防线
  expectStatus(G, 'I16 通用 PATCH 无法写 void（status 白名单外）', await req('PATCH', '/v1/fin/ledger/' + d.v3.id, { token: TOKENS.superAdmin, body: { status: 'void' } }), 400, 'VALIDATION_ERROR');

  return { reasonOk: reasonOk };
}

/* ──────────────────── Phase 3：结果校验（DB/审计/汇总/无副作用） ──────────── */
async function phaseVerify(d) {
  const G = 'P3 结果校验';
  console.log('[Phase 3] 结果校验（直连临时库 + 汇总端点）');

  // ① DB 字段往返（I11 作废后的 V1）
  const v1 = await prisma.finLedgerV1.findUnique({ where: { id: d.v1.id } });
  check(G, 'D1 V1.status = void', 'void', v1.status);
  check(G, 'D2 V1.voidReason 落库 = 请求原因', d.phase2.reasonOk, v1.voidReason);
  checkTrue(G, 'D3 V1.voidedAt 已写且为有效时间', v1.voidedAt instanceof Date && !isNaN(+v1.voidedAt));
  check(G, 'D4 V1.voidedBy = 发起人 sub', 'acc_it_super', v1.voidedBy);
  checkTrue(G, 'D5 V1.updatedAt 已刷新', v1.updatedAt instanceof Date);
  // V2 由 finance_admin 作废
  const v2 = await prisma.finLedgerV1.findUnique({ where: { id: d.v2.id } });
  check(G, 'D6 V2.voidedBy = finance_admin 的 sub', 'acc_it_finadmin', v2.voidedBy);

  // ② 未作废的失败用例对象保持原状（无副作用）
  const v3 = await prisma.finLedgerV1.findUnique({ where: { id: d.v3.id } });
  check(G, 'D7 草稿 V3 未被改动（仍 draft、无 voidReason）', { status: 'draft', voidReason: null }, { status: v3.status, voidReason: v3.voidReason });
  const v4 = await prisma.finLedgerV1.findUnique({ where: { id: d.v4.id } });
  check(G, 'D8 已对账 V4 未被改动（仍 checked、无 voidReason）', { status: 'checked', voidReason: null }, { status: v4.status, voidReason: v4.voidReason });

  // ③ 审计留痕 LEDGER_VOID
  const audits = await prisma.auditLog.findMany({ where: { action: 'LEDGER_VOID', targetId: d.v1.id } });
  check(G, 'D9 审计 LEDGER_VOID 落库条数', 1, audits.length);
  if (audits.length) {
    check(G, 'D10 审计账号 = 发起人', 'acc_it_super', audits[0].accountId);
    let detail = {};
    try { detail = JSON.parse(audits[0].detailJson || '{}'); } catch (_) {}
    check(G, 'D11 审计 detail 含凭证号与原因', { no: v1.voucherNo, reason: d.phase2.reasonOk }, { no: detail.no, reason: detail.reason });
  }

  // ④ 汇总排除 void：作废前基线 → 造一张收入凭证 → 作废 → 回到基线
  const incomeOf = async () => {
    const r = await req('GET', '/v1/fin/summary?months=6', { token: TOKENS.superAdmin });
    if (r.status !== 200 || !Array.isArray(r.json.data)) throw new Error('summary 异常 HTTP ' + r.status);
    const key = monthKey(new Date());
    const row = r.json.data.find(x => x.month === key);
    return row ? Number(row.totalIncome) : 0;
  };
  const base = await incomeOf();
  const v5 = await req('POST', '/v1/fin/ledger', { token: TOKENS.superAdmin, body: { summary: 'IT-汇总排除验证', creditAmount: 1000 } });
  const v5d = await req('PATCH', '/v1/fin/ledger/' + v5.json.data.id, { token: TOKENS.superAdmin, body: { status: 'checked' } });
  const afterAdd = await incomeOf();
  await req('PATCH', '/v1/fin/ledger/' + v5.json.data.id + '/void', { token: TOKENS.superAdmin, body: { reason: '汇总排除验证' } });
  const afterVoid = await incomeOf();
  check(G, 'D12 新增已复核收入凭证 → 汇总收入 +1000', 1000, Math.round(afterAdd - base));
  check(G, 'D13 作废后 → 汇总收入同比回落（不计入收支）', 0, Math.round(afterVoid - base));

  // ⑤ v20261028 口径：列表默认排除作废凭证（收支统计与展示不含 void），
  //    审计痕迹保留 —— 显式传 status=void 仍可查（非物理删除）
  const listR = await req('GET', '/v1/fin/ledger?page=1&pageSize=200', { token: TOKENS.superAdmin });
  checkTrue(G, 'D14 列表默认不含作废凭证（v20261028 收支口径排除 void）',
    listR.status === 200 && Array.isArray(listR.json.data) && !listR.json.data.some(x => x.id === d.v1.id));
  const listVoidR = await req('GET', '/v1/fin/ledger?page=1&pageSize=200&status=void', { token: TOKENS.superAdmin });
  checkTrue(G, 'D15 status=void 显式查询仍可查（审计痕迹保留）',
    listVoidR.status === 200 && Array.isArray(listVoidR.json.data) && listVoidR.json.data.some(x => x.id === d.v1.id && x.status === 'void'));
}

/* ────────────────────────── Phase 4：清理 ────────────────────────── */
async function cleanup() {
  console.log('[Phase 4] 清理');
  // ① 清掉被拦截的后台定时器（否则事件循环不空、进程不退出）
  try { (global.__IT_TIMERS || []).forEach(h => { try { clearInterval(h); } catch (_) {} }); } catch (_) {}
  // ② 关服务：先强断 keep-alive 连接，再 close，避免 undici 客户端 socket 悬挂
  try {
    if (server) {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise(r => server.close(r));
    }
  } catch (_) {}
  // ③ 断 Prisma
  try { if (prisma) await prisma.$disconnect(); } catch (_) {}
  // ④ 删临时 SQLite（含 journal/wal 边车文件）
  [TMP_DB, TMP_DB + '-journal', TMP_DB + '-wal', TMP_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
  await new Promise(r => setTimeout(r, 250)); // 留给句柄关闭收尾，规避 libuv UV_HANDLE_CLOSING 断言
  console.log('  临时 SQLite 已删除（报告仅保留在标准输出）');
}

/* ────────────────────────── 主入口 ────────────────────────── */
(async function main() {
  const C = { R: '\x1b[31m', G: '\x1b[32m', Y: '\x1b[33m', C: '\x1b[36m', BLD: '\x1b[1m', CLR: '\x1b[0m' };
  let fatal = null;
  try {
    await setup();
  } catch (e) {
    console.error(C.R + '❌ FATAL 环境准备失败：' + (e && e.message) + C.CLR);
    process.exit(3);
  }
  try {
    const d = await seed();
    d.phase2 = await phaseExecute(d);
    await phaseVerify(d);
  } catch (e) {
    fatal = e;
    console.error(C.R + '❌ 执行期异常：' + (e && e.stack ? e.stack : e) + C.CLR);
  }
  await cleanup();

  const groups = {};
  CHECKS.forEach(c => { (groups[c.group] = groups[c.group] || []).push(c); });
  let pass = 0;
  console.log('');
  for (const g of Object.keys(groups)) {
    const list = groups[g];
    const ok = list.filter(c => c.pass).length;
    console.log(C.BLD + '── ' + g + '  ' + ok + '/' + list.length + ' ──' + C.CLR);
    list.forEach(c => {
      console.log((c.pass ? C.G + '  ✅' + C.CLR : C.R + '  ❌' + C.CLR) + ' ' + c.name
        + (c.pass ? '' : ('\n' + C.Y + '       预期=' + JSON.stringify(c.expected) + '  实际=' + JSON.stringify(c.actual) + C.CLR + (c.note ? '  (' + c.note + ')' : ''))));
      if (c.pass) pass++;
    });
    console.log('');
  }
  const total = CHECKS.length, allPass = pass === total && !fatal;
  console.log('═'.repeat(64));
  console.log((allPass ? C.G + C.BLD + '✅ 集成测试 TOTAL ' : C.R + C.BLD + '❌ 集成测试 TOTAL ') + pass + '/' + total + ' PASS' + C.CLR);
  console.log('═'.repeat(64) + '\n');
  // 先设退出码，让事件循环自然收尾（最稳）；1.5s 兜底强退（此时句柄已清理，不触发 libuv 断言）
  process.exitCode = allPass ? 0 : 2;
  setTimeout(() => process.exit(allPass ? 0 : 2), 1500).unref();
})();
