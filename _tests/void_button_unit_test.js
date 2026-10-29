/* ==========================================================================
 * _tests/void_button_unit_test.js
 * 作废按钮（凭证作废 GAP-2）单元测试 —— 零依赖、零浏览器、零生产接触
 *
 *   node _tests/void_button_unit_test.js
 *
 * ── 设计要点 ──────────────────────────────────────────────────────────────
 * 前端 finance.js 是 IIFE 包裹的浏览器脚本，作废相关函数（__canVoid / openVoid /
 * doVoid / _statusBadge）均为 IIFE 私有，无法直接 require。本测试采用
 * **源码锚点抽取 + Node vm 沙箱执行** 的方式：按唯一锚点正则从生产源码抽取
 * 真实函数体，注入最小 DOM/依赖桩后在 vm 中执行并断言——
 * 测的是生产代码本身，而非复制品；源码一旦漂移，抽取失败会立即 FATAL 报错。
 *
 * ── 覆盖范围 ──────────────────────────────────────────────────────────────
 *  A 角色白名单真值表：__VOID_ROLES 常量 + __canVoid() 全角色判定
 *  B 按钮渲染条件：status × isReconciled × canVoid 全组合真值表
 *  C doVoid 交互契约：reason 边界(1/2/200/201/空白)、confirm 门控、
 *    PATCH 路径与载荷、成功/失败分支、弹窗与刷新行为
 *  D openVoid 弹窗契约：必填元素/文案/防劫持标记/遮罩/取消/二次挂载去重/兜底
 *  E 前后端契约一致性：白名单与后端 requireRole 对齐、reason min/max 对齐
 *  F 状态徽章渲染：void → 已作废
 *
 * 退出码：0=全部通过；2=存在失败项；3=环境/抽取失败
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIN_JS = path.join(REPO_ROOT, 'js', 'admin-pages', 'finance.js');
const ROUTES_JS = path.join(REPO_ROOT, 'server', 'src', 'routes', 'v1', 'index.js');

/* ────────────────────────── 极简断言引擎（对齐 server/test 风格） ──────────── */
const CHECKS = [];
let SEQ = 0;
function check(group, name, expected, actual, note) {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  CHECKS.push({ seq: ++SEQ, group, name, expected, actual, pass, note: note || '' });
  return pass;
}
function checkTrue(group, name, cond, note) { return check(group, name, true, !!cond, note); }

/* ────────────────────────── 源码锚点抽取 ────────────────────────── */
const SRC = fs.readFileSync(FIN_JS, 'utf8');
function extract(name, re) {
  const m = SRC.match(re);
  if (!m) { console.error('❌ FATAL 抽取失败：' + name + '（源码锚点已漂移，请核对 finance.js 结构）'); process.exit(3); }
  return m[0];
}
const F = {
  esc:        extract('_esc',            /function _esc\(s\)\{[^\n]*\}/),
  statusBadge:extract('_statusBadge',    /function _statusBadge\(s\)\{[\s\S]*?\n  \}/),
  canVoid:    extract('__canVoid',       /function __canVoid\(\)\s*\{[\s\S]*?\n\s*\}/),
  voidRoles:  extract('__VOID_ROLES',    /var __VOID_ROLES = (\[[^\]]*\]);/),
  openVoid:   extract('openVoid',        /function openVoid\(id, tr\)\{[\s\S]*?\n  \}/),
  doVoid:     extract('doVoid',          /async function doVoid\(id, m\)\{[\s\S]*?\n  \}/)
};
/* 行渲染中的按钮可见性条件表达式（L1295）+ 整行按钮标记 */
const renderFrag = (function () {
  const m = SRC.match(/\+ \((r\.status==='checked'[\s\S]*?)\s*\?\s*'<button class="btn btn-sm __fin-void"[^\n]*/);
  if (!m) { console.error('❌ FATAL 抽取失败：行渲染作废按钮条件表达式'); process.exit(3); }
  return { cond: m[1], line: m[0] };
})();

/* ────────────────────────── vm 沙箱装载器 ────────────────────────── */
function load(fragments, globals) {
  const sandbox = Object.assign({ console: console }, globals || {});
  vm.createContext(sandbox);
  vm.runInContext(fragments.join('\n'), sandbox, { filename: 'finance.fragment.js' });
  return sandbox;
}

/* ────────────────────────── 迷你 DOM（供 openVoid 使用） ──────────────────── */
function makeFakeDom() {
  const reg = Object.create(null);
  const removedIds = [];
  function mkEl(id) {
    reg[id] = {
      id: id, _focused: false, _listeners: [], value: '',
      __superPatchBound: undefined, __ts3Done: undefined, onclick: null,
      focus() { this._focused = true; },
      remove() { removedIds.push(id); if (reg[id] === this) delete reg[id]; },
      querySelector(sel) { const k = String(sel).replace(/^#/, ''); return reg[k] || null; },
      addEventListener(t, f) { this._listeners.push({ t: t, f: f }); },
      trigger(t) { this._listeners.filter(function (l) { return l.t === t; }).forEach(function (l) { l.f({ target: reg[id] }); }); },
      click() { if (typeof this.onclick === 'function') return this.onclick(); }
    };
    return reg[id];
  }
  const created = [];
  const document = {
    body: { appendChild() {} },
    getElementById(id) { return reg[id] || null; },
    createElement() {
      const o = {
        _innerHTML: '',
        set innerHTML(v) {
          this._innerHTML = v;
          const re = /\bid="([^"]+)"/g; let mm;
          while ((mm = re.exec(v))) { if (!reg[mm[1]]) mkEl(mm[1]); }
        },
        get innerHTML() { return this._innerHTML; },
        get firstChild() { return reg['__finVoidModal'] || null; }
      };
      created.push(o);
      return o;
    }
  };
  return { document: document, reg: reg, mkEl: mkEl, created: created, removedIds: removedIds };
}

/* ============================ A. 角色白名单真值表 ========================== */
function partA() {
  const G = 'A 角色可见性';
  const ctx = load([F.voidRoles, F.canVoid, 'window = window || {}; window.__finCanVoid = __canVoid;'],
    { window: {} });
  let roles;
  try { roles = vm.runInContext('__VOID_ROLES', ctx); } catch (e) { roles = null; }
  check(G, 'A1 __VOID_ROLES 白名单取值', ['super_admin', 'admin', 'finance_admin'], roles);
  checkTrue(G, 'A2 window.__finCanVoid 已暴露（跨 IIFE 修复）', typeof ctx.window.__finCanVoid === 'function');

  const table = [
    ['super_admin', true], ['admin', true], ['finance_admin', true],
    ['ops', false], ['director', false], ['finance_checker', false],
    ['finance_maker', false], ['finance_cashier', false], ['finance_view', false],
    ['staff', false], ['finance', false], ['', false]
  ];
  table.forEach(function (row) {
    ctx.currentSession = row[0] ? { role: row[0] } : null;
    let got;
    try { got = vm.runInContext('__canVoid()', ctx); } catch (e) { got = 'THROW:' + e.message; }
    check(G, 'A3 role=' + (row[0] || (row[0] === '' ? '(空串)' : '(null session)')) + ' → canVoid', row[1], got);
  });
  // 非白名单角色即便 level 更高也不可见（ops=800 > finance_admin=500，必须白名单而非阈值）
  ctx.currentSession = { role: 'ops' };
  checkTrue(G, 'A4 ops(level800) 不可见——白名单制而非等级阈值', vm.runInContext('__canVoid()', ctx) === false);
}

/* ============================ B. 按钮渲染条件 ============================== */
function partB() {
  const G = 'B 渲染条件';
  const expr = '(' + renderFrag.cond + ')';
  const statuses = ['draft', 'checked', 'reconciled', 'void'];
  const bools = [false, true];
  let n = 0, bad = 0;
  statuses.forEach(function (status) {
    bools.forEach(function (recon) {
      bools.forEach(function (canVoid) {
        const g = { r: { status: status, isReconciled: recon }, window: { __finCanVoid: function () { return canVoid; } } };
        let got;
        try { got = vm.runInNewContext(expr, g); } catch (e) { got = 'THROW:' + e.message; }
        const want = (status === 'checked' && recon === false && canVoid === true);
        n++;
        if (got !== want) { bad++; check(G, 'B1 ' + status + '/recon=' + recon + '/canVoid=' + canVoid, want, got); }
      });
    });
  });
  checkTrue(G, 'B1 渲染条件真值表 16 组合全部符合 status=checked && !isReconciled && canVoid（异常 ' + bad + ' 项）', bad === 0);
  // 防御：window.__finCanVoid 缺失时短路为假值（&& 返回 undefined）且不抛错
  const g2 = { r: { status: 'checked', isReconciled: false }, window: {} };
  let got2; try { got2 = vm.runInNewContext(expr, g2); } catch (e) { got2 = 'THROW:' + e.message; }
  checkTrue(G, 'B2 window.__finCanVoid 缺失 → 短路为假值且不抛错（实际 ' + JSON.stringify(got2) + '）', !got2);
  // 按钮标记契约
  checkTrue(G, 'B3 按钮 class=__fin-void', renderFrag.line.indexOf('__fin-void') >= 0);
  checkTrue(G, 'B4 按钮图标/文案含作废语义与审计提示', renderFrag.line.indexOf('🚫') >= 0 && renderFrag.line.indexOf('审计痕迹') >= 0);
}

/* ============================ C. doVoid 交互契约 =========================== */
async function partC() {
  const G = 'C doVoid';
  const apiCalls = []; const toasts = []; let loadCalls = 0;
  let confirmVal = true; let confirmMsg = '';
  const domC = makeFakeDom(); domC.mkEl('__fin_void_reason');
  const ctx = load([F.doVoid], {
    document: domC.document,
    QAXQJT_PATHS: { FIN_LEDGER_BY_ID: function (i) { return '/v1/fin/ledger/' + i; } },
    API: { patch: function (p, b) { apiCalls.push({ path: p, body: b }); if (ctx.__apiErr) throw new Error('403 无权作废'); return { ok: true }; } },
    T: function (m, t) { toasts.push({ m: m, t: t }); },
    confirm: function (m) { confirmMsg = m; return confirmVal; },
    load: async function () { loadCalls++; }
  });
  const M = { removed: false, remove: function () { this.removed = true; } };
  const setReason = function (v) { domC.reg['__fin_void_reason'].value = v; };
  const reset = function () { apiCalls.length = 0; toasts.length = 0; loadCalls = 0; M.removed = false; confirmVal = true; ctx.__apiErr = false; };

  // C1 长度边界
  const bounds = [
    ['a', false], ['', false], ['   ', false],
    ['ab', true], ['a'.repeat(200), true], ['a'.repeat(201), false]
  ];
  const tag = function (r) {
    var desc = r.length === 0 ? '(空)'
      : (/^\s*$/.test(r) ? '(纯空白 raw=' + r.length + '/trim=0)' : 'len=' + r.length);
    return desc;
  };
  for (const [reason, ok] of bounds) {
    reset(); setReason(reason);
    await ctx.doVoid('LED001', M);
    const called = apiCalls.length === 1;
    check(G, 'C1 reason ' + tag(reason) + ' → 是否发起请求', ok, called);
    if (!ok) checkTrue(G, 'C1 reason ' + tag(reason) + ' 拒绝并提示 2-200 字',
      toasts.some(function (x) { return String(x.m).indexOf('2-200') >= 0; }));
  }
  // C2 confirm 门控（合法原因下取消二次确认 → 不发起请求）
  reset(); confirmVal = false; setReason('合法原因');
  await ctx.doVoid('LED001', M);
  check(G, 'C2w confirm=false → 不发起请求', 0, apiCalls.length);
  checkTrue(G, 'C2 confirm 文案含不可恢复语义', String(confirmMsg).indexOf('不可恢复') >= 0);
  // C3 成功路径：路径/载荷/提示/弹窗移除/刷新
  reset(); setReason('测试数据清理');
  await ctx.doVoid('LED001', M);
  check(G, 'C3 请求路径', ['/v1/fin/ledger/LED001/void'], apiCalls.map(function (c) { return c.path; }));
  check(G, 'C3 请求载荷', [{ reason: '测试数据清理' }], apiCalls.map(function (c) { return c.body; }));
  checkTrue(G, 'C3 成功提示（success）', toasts.some(function (x) { return x.t === 'success' && String(x.m).indexOf('已作废') >= 0; }));
  checkTrue(G, 'C3 成功后关闭弹窗', M.removed === true);
  check(G, 'C3 成功后刷新列表', 1, loadCalls);
  // C4 服务端拒绝（403）→ 失败提示且保留弹窗、不刷新
  reset(); ctx.__apiErr = true; setReason('合法原因');
  await ctx.doVoid('LED001', M);
  checkTrue(G, 'C4 失败提示（error）含「作废失败」', toasts.some(function (x) { return x.t === 'error' && String(x.m).indexOf('作废失败') >= 0; }));
  checkTrue(G, 'C4 失败后保留弹窗（未误关）', M.removed === false);
  check(G, 'C4 失败后不触发刷新', 0, loadCalls);
  // C5 reason 前后空白被 trim
  reset(); setReason('  前后空白  ');
  await ctx.doVoid('LED001', M);
  check(G, 'C5 reason 自动 trim', [{ reason: '前后空白' }], apiCalls.map(function (c) { return c.body; }));
}

/* ============================ D. openVoid 弹窗契约 ======================== */
async function partD() {
  const G = 'D openVoid';
  const dom = makeFakeDom();
  const apiCalls = []; const toasts = [];
  const ctx = load([F.esc, F.doVoid, F.openVoid], {
    document: dom.document,
    QAXQJT_PATHS: { FIN_LEDGER_BY_ID: function (i) { return '/v1/fin/ledger/' + i; } },
    API: { patch: async function (p, b) { apiCalls.push({ path: p, body: b }); return { ok: true }; } },
    T: function (m, t) { toasts.push({ m: m, t: t }); },
    confirm: function () { return true; },
    load: async function () {}
  });
  const tr = { querySelector: function (s) { return s === '.stat-voucher-id' ? { textContent: ' LSR202609230110FMPP ' } : null; } };

  ctx.openVoid('LED001', tr);
  const modal = dom.document.getElementById('__finVoidModal');
  checkTrue(G, 'D1 弹窗已挂载到 DOM', !!modal);
  const html = dom.created[dom.created.length - 1]._innerHTML;
  checkTrue(G, 'D2 弹窗含原因输入框（maxlength=200 必填）',
    html.indexOf('id="__fin_void_reason"') >= 0 && html.indexOf('maxlength="200"') >= 0 && html.indexOf('*') >= 0);
  checkTrue(G, 'D3 弹窗含取消/确认按钮', html.indexOf('id="__fin_void_cancel"') >= 0 && html.indexOf('id="__fin_void_ok"') >= 0 && html.indexOf('确认作废') >= 0);
  checkTrue(G, 'D4 弹窗含不可恢复/审计痕迹风险提示', html.indexOf('不可恢复') >= 0 && html.indexOf('审计痕迹') >= 0);
  checkTrue(G, 'D5 凭证号回显（已 trim）', html.indexOf('LSR202609230110FMPP') >= 0 && html.indexOf(' LSR') < 0);
  checkTrue(G, 'D6 输入框自动聚焦', dom.reg['__fin_void_reason']._focused === true);
  checkTrue(G, 'D7 按钮带 __superPatchBound/__ts3Done 防全局兜底劫持',
    modal.querySelector('#__fin_void_cancel').__superPatchBound === 1 && modal.querySelector('#__fin_void_ok').__ts3Done === 1);
  // D8 确认按钮已接入 doVoid（点击 → 发起 PATCH /void）
  dom.reg['__fin_void_reason'].value = '单元测试原因';
  await modal.querySelector('#__fin_void_ok').click();
  check(G, 'D8 确认按钮接通 doVoid', ['/v1/fin/ledger/LED001/void'], apiCalls.map(function (c) { return c.path; }));
  // D9 取消按钮移除弹窗
  ctx.openVoid('LED001', tr);
  const modal2 = dom.document.getElementById('__finVoidModal');
  modal2.querySelector('#__fin_void_cancel').click();
  checkTrue(G, 'D9 取消按钮关闭弹窗', dom.document.getElementById('__finVoidModal') === null);
  // D10 遮罩点击关闭（target===遮罩本身）
  ctx.openVoid('LED001', tr);
  dom.document.getElementById('__finVoidModal').trigger('click');
  checkTrue(G, 'D10 点击遮罩空白关闭弹窗', dom.document.getElementById('__finVoidModal') === null);
  // D11 二次挂载去重（旧弹窗先被移除）
  const before = dom.removedIds.filter(function (x) { return x === '__finVoidModal'; }).length;
  ctx.openVoid('LED001', tr);
  ctx.openVoid('LED001', tr);
  const after = dom.removedIds.filter(function (x) { return x === '__finVoidModal'; }).length;
  checkTrue(G, 'D11 重复挂载先移除旧弹窗（去重）', after === before + 1);
  // D12 取值容错：tr.querySelector 抛错时以 id 兜底，弹窗仍可用
  const badTr = { querySelector: function () { throw new Error('boom'); } };
  let threw = null;
  try { ctx.openVoid('LED002', badTr); } catch (e) { threw = e.message; }
  const m3 = dom.document.getElementById('__finVoidModal');
  const html3 = dom.created[dom.created.length - 1]._innerHTML;
  checkTrue(G, 'D12 tr 取值异常时不抛出且以 id 兜底', threw === null && !!m3 && html3.indexOf('LED002') >= 0);
}

/* ============================ E. 前后端契约一致性 ========================== */
function partE() {
  const G = 'E 前后端契约';
  const routes = fs.readFileSync(ROUTES_JS, 'utf8');
  const i = routes.indexOf("'/fin/ledger/:id/void'");
  if (i < 0) { check(G, 'E0 后端存在作废路由', true, false, '未找到 /fin/ledger/:id/void'); return; }
  const block = routes.slice(i, routes.indexOf('\n);', i) + 3);
  const rm = block.match(/requireRole\((\[[^\]]*\])\)/);
  let backRoles = null;
  try { backRoles = rm ? rm[1].replace(/'/g, '"') : null; } catch (e) { backRoles = null; }
  if (!backRoles) { check(G, 'E1 后端路由配置 requireRole', true, false); return; }
  const backArr = JSON.parse(backRoles);
  const frontArr = JSON.parse(F.voidRoles.match(/\[[^\]]*\]/)[0].replace(/'/g, '"'));
  check(G, 'E1 后端允许角色', ['super_admin', 'finance_admin'], backArr);
  // 不变量①：后端允许的每个角色，UI 都必须可见（UI 不能隐藏后端放行的角色）
  checkTrue(G, 'E2 后端放行角色 ⊆ 前端白名单', backArr.every(function (r) { return frontArr.indexOf(r) >= 0; }));
  // 不变量②：前端白名单去掉历史别名 admin 后，应与后端完全一致（UI 不能对后端拒绝的角色显示按钮）
  const frontReal = frontArr.filter(function (r) { return r !== 'admin'; });
  check(G, 'E3 前端白名单(去 admin 别名) == 后端允许集', backArr.slice().sort(), frontReal.slice().sort());
  // 不变量③：reason 长度约束前后端一致
  const jm = block.match(/min\((\d+)\)\.max\((\d+)\)/);
  const dm = F.doVoid.match(/reason\.length<(\d+) \|\| reason\.length>(\d+)/);
  check(G, 'E4 后端 Joi reason 约束 [min,max]', ['2', '200'], jm ? [jm[1], jm[2]] : null);
  check(G, 'E5 前端 reason 约束 [min,max] 与后端一致', jm ? [jm[1], jm[2]] : null, dm ? [dm[1], dm[2]] : null);
  // 不变量④：前端请求路径以 /void 结尾且与后端路由段一致
  checkTrue(G, 'E6 前端 PATCH 路径拼接 "/void" 与后端路由一致',
    F.doVoid.indexOf("'/void'") >= 0 && routes.indexOf("'/fin/ledger/:id/void'") >= 0);
}

/* ============================ F. 状态徽章渲染 ============================== */
function partF() {
  const G = 'F 状态徽章';
  const ctx = load([F.esc, F.statusBadge], {});
  const out = vm.runInContext('_statusBadge("void")', ctx);
  checkTrue(G, 'F1 void → 「已作废」文案', String(out).indexOf('已作废') >= 0);
  checkTrue(G, 'F2 void → status-badge void 样式类', String(out).indexOf('status-badge void') >= 0);
  const chk = vm.runInContext('_statusBadge("checked")', ctx);
  checkTrue(G, 'F3 checked → 「已复核」未受影响', String(chk).indexOf('已复核') >= 0);
}

/* ────────────────────────── 主入口 + 报告 ────────────────────────── */
(async function main() {
  const C = { R: '\x1b[31m', G: '\x1b[32m', Y: '\x1b[33m', C: '\x1b[36m', BLD: '\x1b[1m', CLR: '\x1b[0m' };
  console.log('\n' + C.C + C.BLD + '══════ 作废按钮单元测试 · 源码锚点抽取 + vm 沙箱（零依赖） ══════' + C.CLR);
  console.log('被测源码: ' + path.relative(REPO_ROOT, FIN_JS) + '\n');

  partA();
  partB();
  await partC();
  await partD();
  partE();
  partF();

  const groups = {};
  CHECKS.forEach(function (c) { (groups[c.group] = groups[c.group] || []).push(c); });
  let pass = 0;
  for (const g of Object.keys(groups)) {
    const list = groups[g];
    const ok = list.filter(function (c) { return c.pass; }).length;
    console.log(C.BLD + '── ' + g + '  ' + ok + '/' + list.length + ' ──' + C.CLR);
    list.forEach(function (c) {
      const icon = c.pass ? C.G + '  ✅' + C.CLR : C.R + '  ❌' + C.CLR;
      console.log(icon + ' ' + c.name + (c.pass ? '' : ('\n' + C.Y + '       预期=' + JSON.stringify(c.expected) + '  实际=' + JSON.stringify(c.actual) + C.CLR + (c.note ? '  (' + c.note + ')' : ''))));
      if (c.pass) pass++;
    });
    console.log('');
  }
  const total = CHECKS.length;
  const allPass = pass === total;
  console.log('═'.repeat(62));
  console.log((allPass ? C.G + C.BLD + '✅ TOTAL ' : C.R + C.BLD + '❌ TOTAL ') + pass + '/' + total + ' PASS' + C.CLR);
  console.log('═'.repeat(62) + '\n');
  process.exit(allPass ? 0 : 2);
})();
