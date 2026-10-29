/* ==========================================================================
 * _tests/cast_sheet_manage_unit_test.js
 * 「已发布阵容管理」面板 前端单元测试（纯 Node + vm 迷你 DOM，零浏览器依赖）
 *
 *   node _tests/cast_sheet_manage_unit_test.js
 *
 * 覆盖：
 *   A 源码锚点：window.__castSheetManage 暴露的能力 + 关键端点路径
 *   B 列表渲染：行结构、公开/未公开标签、操作按钮与禁用态
 *   C 权限规则：admin/创建者/他人 的可操作性判定
 *   D 公开切换：调用 /visibility 且 public 取反、成功 toast、加载态锁定
 *   E 删除：二次确认（confirm=false 不调用；true 调用 DELETE）、CONFLICT 提示
 *
 * 退出码：0=全部通过；2=存在失败项；3=环境准备失败
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const MANAGE_JS = path.join(REPO_ROOT, 'js', 'admin-pages', 'cast-sheet-manage.js');

/* ────────────── 极简断言引擎 ────────────── */
const CHECKS = [];
let SEQ = 0;
function check(group, name, expected, actual, note) {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  CHECKS.push({ seq: ++SEQ, group, name, expected, actual, pass, note: note || '' });
  return pass;
}
function checkTrue(group, name, cond, note) { return check(group, name, true, !!cond, note); }

/* ────────────── 迷你 DOM ────────────── */
function makeEl(id) {
  return {
    id: id || '', style: {}, textContent: '', innerHTML: '', disabled: false, value: '',
    children: [], title: '',
    appendChild(c) { this.children.push(c); return c; },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, remove() {}, closest() { return null; }, scrollIntoView() {}
  };
}
function makeDom() {
  const reg = Object.create(null);
  const doc = {
    readyState: 'complete',
    body: makeEl('body'),
    getElementById(id) { if (!reg[id]) reg[id] = makeEl(id); return reg[id]; },
    createElement() { return makeEl(); },
    addEventListener() {},
    querySelectorAll() { return []; }
  };
  return { doc, reg, el: id => doc.getElementById(id) };
}

/* ────────────── 沙箱构造 ────────────── */
function buildSandbox(opts) {
  const { doc } = makeDom();
  const calls = [];
  const toasts = [];
  const confirmResult = { value: true };

  const getRows = { value: [] };      // GET 列表返回
  const postImpl = opts.postImpl || (() => Promise.resolve({}));
  const delImpl = opts.delImpl || (() => Promise.resolve());

  const api = {
    get(p, o) { calls.push({ m: 'get', p, o }); return Promise.resolve(getRows.value); },
    post(p, b, o) { calls.push({ m: 'post', p, b, o }); return postImpl(p, b); },
    del(p, o) { calls.push({ m: 'del', p, o }); return delImpl(p); }
  };

  const storage = {};
  const sandbox = {
    console,
    Promise, JSON, Array, Object, String, Number, Date, Math, Error, setTimeout, clearTimeout,
    document: doc,
    window: null,
    QAXQJT_API: api,
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; }
    },
    showToast: (m, t) => toasts.push({ m, t }),
    confirm: () => confirmResult.value
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, calls, toasts, getRows, confirmResult, el: makeDom().el };
}

function loadManage() {
  const src = fs.readFileSync(MANAGE_JS, 'utf8');
  return src;
}

/* ────────────── A. 源码锚点 ────────────── */
function partA() {
  const G = 'A 源码锚点';
  const src = fs.readFileSync(MANAGE_JS, 'utf8');
  checkTrue(G, 'A1 文件存在且非空', src.length > 2000, 'len=' + src.length);
  ['renderList', 'refreshAll', 'toggleVisibility', 'deleteSheet', 'editSheet', 'canOperate', 'isAdmin', 'isPublic']
    .forEach(function (k) {
      checkTrue(G, 'A2 window.__castSheetManage 暴露 ' + k, new RegExp('\\b' + k + '\\s*:').test(src) || new RegExp('function\\s+' + k).test(src));
    });
  checkTrue(G, 'A3 使用 /v1/cast-sheets 列表端点', /\/v1\/cast-sheets'/.test(src));
  checkTrue(G, 'A4 visibility 端点路径拼接', /\/visibility/.test(src));
  checkTrue(G, 'A5 管理员白名单 super_admin+admin', /ADMIN_ROLES\s*=\s*\[\s*'super_admin'\s*,\s*'admin'\s*\]/.test(src));
  checkTrue(G, 'A6 公开态判定 confirmed/locked', /PUBLIC_STATUS\s*=\s*\[\s*'confirmed'\s*,\s*'locked'\s*\]/.test(src));
  checkTrue(G, 'A7 二次确认使用 window.confirm', /window\.confirm\(/.test(src));
}

/* ────────────── 运行完整脚本得到实例 ────────────── */
function runScript(opts) {
  const env = buildSandbox(opts || {});
  vm.runInContext(loadManage(), env.sandbox, { filename: 'cast-sheet-manage.js' });
  return env;
}

/* ────────────── B. 列表渲染 ────────────── */
async function partB() {
  const G = 'B 列表渲染';
  const rows = [
    { id: 'cs_1', sheetNo: 'CS001', playTitle: '火焰驹', performanceDate: '2026-10-20', status: 'confirmed', statusText: '已确认', createdBy: 'acc_owner' },
    { id: 'cs_2', sheetNo: 'CS002', playTitle: '三滴血', performanceDate: '2026-10-21', status: 'draft', statusText: '草稿', createdBy: 'acc_owner' }
  ];
  // 以管理员身份运行（可操作全部）
  const env = runScript({});
  env.sandbox.localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ role: 'super_admin', username: 'root' }));
  env.getRows.value = rows;

  const m = env.sandbox.window.__castSheetManage;
  await m.renderList();

  const html = env.sandbox.document.getElementById('cmTbody').innerHTML;
  checkTrue(G, 'B1 渲染两行', (html.match(/<tr/g) || []).length === 2, 'rows=' + (html.match(/<tr/g) || []).length);
  checkTrue(G, 'B2 含剧目名「火焰驹」', /火焰驹/.test(html));
  checkTrue(G, 'B3 已公开行显示「✅ 已公开」', /✅ 已公开/.test(html));
  checkTrue(G, 'B4 未公开行显示「⏸ 未公开」', /⏸ 未公开/.test(html));
  checkTrue(G, 'B5 已公开行按钮为「暂停公开」', /⏸ 暂停公开/.test(html));
  checkTrue(G, 'B6 未公开行按钮为「恢复公开」', /▶ 恢复公开/.test(html));
  checkTrue(G, 'B7 含 编辑/删除 按钮', /data-cm="edit"/.test(html) && /data-cm="del"/.test(html));
  checkTrue(G, 'B8 管理员不出现 disabled 操作按钮', html.indexOf('disabled title="仅阵容创建者或管理员可操作"') < 0);
  check(G, 'B9 管理员徽标提示可操作全部', true, /可操作全部/.test(env.sandbox.document.getElementById('cmBadge').textContent));
  check(G, 'B10 列表条数写入徽标', true, /共 2 条/.test(env.sandbox.document.getElementById('cmBadge').textContent));

  // 非管理员 + 非创建者 → 按钮禁用
  const env2 = runScript({});
  env2.sandbox.localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ role: 'director', username: 'd1' }));
  env2.sandbox.localStorage.setItem('qaxqjt_current_user', JSON.stringify({ id: 'acc_other', username: 'd1' }));
  env2.getRows.value = rows;
  await env2.sandbox.window.__castSheetManage.renderList();
  const html2 = env2.sandbox.document.getElementById('cmTbody').innerHTML;
  // 2 行 × 3 个操作按钮 = 6 个按钮全部禁用
  checkTrue(G, 'B11 非创建者行按钮全部禁用（2 行 × 3 按钮 = 6）', (html2.match(/disabled title="仅阵容创建者或管理员可操作"/g) || []).length === 6, 'matches=' + (html2.match(/disabled title="仅阵容创建者或管理员可操作"/g) || []).length);
}

/* ────────────── C. 权限规则 ────────────── */
function partC() {
  const G = 'C 权限规则';
  const env = runScript({});
  const m = env.sandbox.window.__castSheetManage;
  const sheetOwnedByMe = { id: 's1', createdBy: 'acc_me' };
  const sheetOther = { id: 's2', createdBy: 'acc_other' };

  env.sandbox.localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ role: 'super_admin' }));
  check(G, 'C1 super_admin 可操作他人阵容', true, m.canOperate(sheetOther));
  env.sandbox.localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ role: 'admin' }));
  check(G, 'C2 admin 可操作他人阵容', true, m.canOperate(sheetOther));

  env.sandbox.localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ role: 'director', username: 'me' }));
  env.sandbox.localStorage.setItem('qaxqjt_current_user', JSON.stringify({ id: 'acc_me', username: 'me' }));
  check(G, 'C3 director 本人创建可操作', true, m.canOperate(sheetOwnedByMe));
  check(G, 'C4 director 他人创建不可操作', false, m.canOperate(sheetOther));

  env.sandbox.localStorage.setItem('qaxqjt_current_user', JSON.stringify({ id: 'acc_x', username: 'x' }));
  env.sandbox.localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ role: 'ops', username: 'x' }));
  check(G, 'C5 ops 本人创建可操作（username 命中）', true, m.canOperate({ id: 's3', createdBy: 'x' }));

  check(G, 'C6 isPublic confirmed → true', true, m.isPublic({ status: 'confirmed' }));
  check(G, 'C7 isPublic locked → true', true, m.isPublic({ status: 'locked' }));
  check(G, 'C8 isPublic draft → false', false, m.isPublic({ status: 'draft' }));
}

/* ────────────── D. 公开切换 ────────────── */
async function partD() {
  const G = 'D 公开切换';
  let posted = null;
  const env = runScript({ postImpl: (p, b) => { posted = { p, b }; return Promise.resolve({ id: 'cs_1', status: 'draft' }); } });
  env.sandbox.localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ role: 'super_admin' }));
  env.getRows.value = [{ id: 'cs_1', sheetNo: 'CS001', playTitle: '火焰驹', status: 'confirmed', statusText: '已确认', createdBy: 'acc_x' }];
  const m = env.sandbox.window.__castSheetManage;
  await m.renderList();

  const btn = { textContent: '⏸ 暂停公开', style: {}, disabled: false };
  await m.toggleVisibility('cs_1', btn);
  check(G, 'D1 调用 /visibility 端点', true, !!posted && /\/v1\/cast-sheets\/cs_1\/visibility$/.test(posted.p));
  check(G, 'D2 已公开 → public=false（暂停）', false, posted && posted.b && posted.b.public);
  checkTrue(G, 'D3 按钮已解锁且文案还原', btn.disabled === false && btn.textContent === '⏸ 暂停公开', 'disabled=' + btn.disabled + ' text=' + btn.textContent);
  checkTrue(G, 'D4 成功 toast（success）', env.toasts.some(t => t.t === 'success' && /暂停公开/.test(t.m)));
  checkTrue(G, 'D5 操作后自动刷新（再次 GET 列表）', env.calls.filter(c => c.m === 'get').length >= 2, 'gets=' + env.calls.filter(c => c.m === 'get').length);

  // 未公开 → public=true（恢复）
  posted = null;
  const env2 = runScript({ postImpl: (p, b) => { posted = { p, b }; return Promise.resolve({}); } });
  env2.sandbox.localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ role: 'admin' }));
  env2.getRows.value = [{ id: 'cs_2', sheetNo: 'CS002', playTitle: '三滴血', status: 'draft', statusText: '草稿', createdBy: 'acc_x' }];
  const m2 = env2.sandbox.window.__castSheetManage;
  await m2.renderList();
  await m2.toggleVisibility('cs_2', { textContent: '▶ 恢复公开', style: {}, disabled: false });
  check(G, 'D6 未公开 → public=true（恢复）', true, posted && posted.b && posted.b.public === true);

  // 非创建者非管理员 → 无权限，不发起请求
  const env3 = runScript({});
  env3.sandbox.localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ role: 'director', username: 'd1' }));
  env3.sandbox.localStorage.setItem('qaxqjt_current_user', JSON.stringify({ id: 'acc_d1' }));
  env3.getRows.value = [{ id: 'cs_3', sheetNo: 'CS003', playTitle: 'X', status: 'confirmed', statusText: '已确认', createdBy: 'acc_other' }];
  const m3 = env3.sandbox.window.__castSheetManage;
  await m3.renderList();
  await m3.toggleVisibility('cs_3', { textContent: 't', style: {}, disabled: false });
  check(G, 'D7 非授权者不发起 visibility 请求', 0, env3.calls.filter(c => c.m === 'post').length);
  checkTrue(G, 'D8 非授权者收到明确拒绝 toast', env3.toasts.some(t => t.t === 'error' && /无权限|仅阵容创建者/.test(t.m)));
}

/* ────────────── E. 删除 ────────────── */
async function partE() {
  const G = 'E 删除';
  let delPath = null;
  const env = runScript({ delImpl: (p) => { delPath = p; return Promise.resolve(); } });
  env.sandbox.localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ role: 'super_admin' }));
  env.getRows.value = [{ id: 'cs_9', sheetNo: 'CS009', playTitle: '斩黄袍', performanceDate: '2026-10-22', status: 'draft', statusText: '草稿', createdBy: 'acc_x' }];
  const m = env.sandbox.window.__castSheetManage;
  await m.renderList();

  // confirm=false → 不删除
  env.confirmResult.value = false;
  await m.deleteSheet('cs_9', { textContent: '🗑 删除', style: {}, disabled: false });
  check(G, 'E1 二次确认取消 → 不发起 DELETE', 0, env.calls.filter(c => c.m === 'del').length);

  // confirm=true → 删除
  env.confirmResult.value = true;
  await m.deleteSheet('cs_9', { textContent: '🗑 删除', style: {}, disabled: false });
  check(G, 'E2 二次确认通过 → 调用 DELETE', true, delPath === '/v1/cast-sheets/cs_9');
  checkTrue(G, 'E3 删除成功 toast', env.toasts.some(t => t.t === 'success' && /已删除/.test(t.m)));

  // CONFLICT（被排期关联）→ 明确提示
  const env2 = runScript({ delImpl: () => { const e = new Error('该阵容已被排期关联，请先解除关联后再删除'); e.code = 'CONFLICT'; e.status = 409; return Promise.reject(e); } });
  env2.sandbox.localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ role: 'super_admin' }));
  env2.getRows.value = [{ id: 'cs_5', sheetNo: 'CS005', playTitle: 'Y', status: 'confirmed', statusText: '已确认', createdBy: 'acc_x' }];
  const m2 = env2.sandbox.window.__castSheetManage;
  await m2.renderList();
  env2.confirmResult.value = true;
  await m2.deleteSheet('cs_5', { textContent: '🗑 删除', style: {}, disabled: false });
  checkTrue(G, 'E4 关联冲突 → warning toast 提示解除关联', env2.toasts.some(t => t.t === 'warning' && /排期关联/.test(t.m)));

  // 403 无权限 → error toast
  const env3 = runScript({ delImpl: () => { const e = new Error('仅阵容创建者或管理员可执行此操作'); e.code = 'FORBIDDEN'; e.status = 403; return Promise.reject(e); } });
  env3.sandbox.localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ role: 'admin' }));
  env3.getRows.value = [{ id: 'cs_6', sheetNo: 'CS006', playTitle: 'Z', status: 'draft', statusText: '草稿', createdBy: 'acc_x' }];
  const m3 = env3.sandbox.window.__castSheetManage;
  await m3.renderList();
  env3.confirmResult.value = true;
  await m3.deleteSheet('cs_6', { textContent: '🗑 删除', style: {}, disabled: false });
  checkTrue(G, 'E5 FORBIDDEN → error toast（无权限）', env3.toasts.some(t => t.t === 'error' && /无权限/.test(t.m)));
}

/* ────────────── 主入口 ────────────── */
(async function main() {
  const C = { R: '\x1b[31m', G: '\x1b[32m', BLD: '\x1b[1m', CLR: '\x1b[0m' };
  console.log('════════════════════════════════════════════════════════════');
  console.log(' 已发布阵容管理 · 前端单元测试');
  console.log('════════════════════════════════════════════════════════════');
  let fatal = null;
  try {
    partA();
    await partB();
    partC();
    await partD();
    await partE();
  } catch (e) { fatal = e; console.error(C.R + '执行期异常：' + (e && e.stack ? e.stack : e) + C.CLR); }

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
  console.log('');
  console.log((pass === total && !fatal ? C.G : C.R) + `总计 ${total} 项：✓ ${pass} 通过，✗ ${total - pass} 失败` + C.CLR);
  process.exit(total - pass === 0 && !fatal ? 0 : 2);
})();
