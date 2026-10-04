/* tests/admin-pages.unit.spec.js — 其他 admin 页面纯函数单元测试
 *
 * 用法：node tests/admin-pages.unit.spec.js
 * 依赖：无（Node 内置 vm/assert/fs；函数体直接从线上 HTML 抽取）
 *
 * 覆盖：
 *   orders.html    _ordBucket（行当→派工分组）/ _hx_ord（HTML 转义）/ _genId / _pad2
 *   staff.html     fmtCents（分→元）/ pad2 / fmtTS / hashStr / esc
 *   inventory.html _esc / _statusBadge（库存 5 态）/ _fmtDate
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ADMIN = path.join(__dirname, '..', 'admin');
function read(name) { return fs.readFileSync(path.join(ADMIN, name), 'utf8'); }
function sliceBetween(s, markA, markB) {
  const a = s.indexOf(markA);
  const b = s.indexOf(markB, a);
  assert(a >= 0 && b > a, '抽取失败：' + markA + ' / ' + markB);
  return s.slice(a, b);
}
function sliceLine(s, mark) {
  const a = s.indexOf(mark);
  assert(a >= 0, '抽取失败：' + mark);
  const b = s.indexOf('\n', a);
  return s.slice(a, b);
}
function run(code, extra) {
  const sb = Object.assign({ console }, extra || {});
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: 'extract.js' });
  return sb;
}

const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓ ' + name); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}

(async () => {
  console.log('admin-pages.unit.spec — orders / staff / inventory 纯函数\n');

  /* ==================== orders.html ==================== */
  const ordersHtml = read('orders.html');
  const ordersCode =
    sliceBetween(ordersHtml, 'function _ordBucket(role){', 'var box = document.getElementById') + '\n' +
    sliceLine(ordersHtml, 'function _hx_ord(s){') + '\n' +
    sliceBetween(ordersHtml, 'function _genId(prefix){', 'if(!window.__toastH9)');
  const ord = run(ordersCode);

  await t('orders._hx_ord: 五字符转义，null/数字安全', () => {
    assert.strictEqual(ord._hx_ord(`<a href="x">&'y'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;y&#39;&lt;/a&gt;');
    assert.strictEqual(ord._hx_ord(null), '');
    assert.strictEqual(ord._hx_ord(123), '123');
  });
  await t('orders._ordBucket: 乐队(bd) — 司鼓/板胡/二胡/唢呐', () => {
    ['司鼓', '板鼓', '板胡', '二胡', '唢呐', '大提琴'].forEach(r => assert.strictEqual(ord._ordBucket(r), 'bd', r));
  });
  await t('orders._ordBucket: 舞美(wm) — 灯光/服装/道具，且未知行当默认 wm', () => {
    assert.strictEqual(ord._ordBucket('灯光'), 'wm');
    assert.strictEqual(ord._ordBucket('服装'), 'wm');
    assert.strictEqual(ord._ordBucket('道具'), 'wm');
    assert.strictEqual(ord._ordBucket('外星人岗位'), 'wm');
    assert.strictEqual(ord._ordBucket(''), 'wm');
    assert.strictEqual(ord._ordBucket(null), 'wm');
  });
  await t('orders._ordBucket: 生/旦/净/丑/龙套 分组（ls/xiaos/qy/hd/ld/hl/cj/lt）', () => {
    assert.strictEqual(ord._ordBucket('红生'), 'ls');
    assert.strictEqual(ord._ordBucket('老生'), 'ls');
    assert.strictEqual(ord._ordBucket('须生'), 'ls');
    assert.strictEqual(ord._ordBucket('小生'), 'xiaos');
    assert.strictEqual(ord._ordBucket('武生'), 'xiaos');
    assert.strictEqual(ord._ordBucket('青衣'), 'qy');
    assert.strictEqual(ord._ordBucket('正旦'), 'qy');
    assert.strictEqual(ord._ordBucket('花旦'), 'hd');
    assert.strictEqual(ord._ordBucket('老旦'), 'ld');
    assert.strictEqual(ord._ordBucket('花脸'), 'hl');
    assert.strictEqual(ord._ordBucket('丑'), 'cj');
    assert.strictEqual(ord._ordBucket('龙套'), 'lt');
  });
  await t('orders._ordBucket: 分组优先级 — “板胡”不落入后面的生旦分支', () => {
    // “胡”不在生旦净丑正则中，此用例锁定首匹配优先级
    assert.strictEqual(ord._ordBucket('板胡'), 'bd');
  });
  await t('orders._pad2: <10 补零，>=10 原样', () => {
    assert.strictEqual(ord._pad2(0), '00');
    assert.strictEqual(ord._pad2(9), '09');
    assert.strictEqual(ord._pad2(10), '10');
    assert.strictEqual(ord._pad2(31), '31');
  });
  await t('orders._genId: 前缀 + YYYYMMDDHHmmss(14) + 2 位随机数', () => {
    const id = ord._genId('ORD');
    assert(/^ORD\d{14}\d{2}$/.test(id), id);
    const id2 = ord._genId('T');
    assert(/^T\d{16}$/.test(id2), id2);
    const n = Number(id.slice(3));
    assert(Number.isFinite(n) && n > 0);
  });

  /* ==================== staff.html ==================== */
  const staffHtml = read('staff.html');
  const staffCode =
    sliceBetween(staffHtml, 'function fmtCents(c) {', 'function getW()') + '\n' +
    sliceBetween(staffHtml, 'function pad2(n) {', 'function deterministicClocksFor') + '\n' +
    sliceLine(staffHtml, 'function esc(s){');
  const stf = run(staffCode);

  await t('staff.fmtCents: 分→元两位小数', () => {
    assert.strictEqual(stf.fmtCents(1), '¥0.01');
    assert.strictEqual(stf.fmtCents(12345), '¥123.45');
    assert.strictEqual(stf.fmtCents(100), '¥1');       // .00 去尾
    assert.strictEqual(stf.fmtCents(0), '¥0');
  });
  await t('staff.fmtCents: 千分位', () => {
    assert.strictEqual(stf.fmtCents(123456789), '¥1,234,567.89');
    assert.strictEqual(stf.fmtCents(100000), '¥1,000');
    assert.strictEqual(stf.fmtCents(1050), '¥10.50');
  });
  await t('staff.fmtCents: 负数带 - 号；非数/NaN/null → 破折号', () => {
    assert.strictEqual(stf.fmtCents(-150), '-¥1.50');
    assert.strictEqual(stf.fmtCents(-1), '-¥0.01');
    assert.strictEqual(stf.fmtCents('x'), '—');
    assert.strictEqual(stf.fmtCents(NaN), '—');
    assert.strictEqual(stf.fmtCents(null), '—');
    assert.strictEqual(stf.fmtCents(undefined), '—');
  });
  await t('staff.pad2: 补零', () => {
    assert.strictEqual(stf.pad2(0), '00');
    assert.strictEqual(stf.pad2(5), '05');
    assert.strictEqual(stf.pad2(12), '12');
  });
  await t('staff.fmtTS: 空值/0（falsy）空串；非空输出 YYYY-MM-DD HH:mm:ss', () => {
    assert.strictEqual(stf.fmtTS(''), '');
    assert.strictEqual(stf.fmtTS(null), '');
    assert.strictEqual(stf.fmtTS(0), '');           // !0 走空值分支
    const s = stf.fmtTS(new Date(2026, 8, 7, 9, 5, 3).getTime());
    assert(/^2026-09-07 09:05:03$/.test(s), s);
  });
  await t('staff.hashStr: 确定性、非负、空串为 0、非字符串不崩', () => {
    assert.strictEqual(stf.hashStr('PF001'), stf.hashStr('PF001'));
    assert(stf.hashStr('PF001') !== stf.hashStr('PF002'));
    assert.strictEqual(stf.hashStr(''), 0);
    assert(Number.isFinite(stf.hashStr(12345)));
    assert(stf.hashStr('秦安县秦剧团') >= 0);
  });
  await t('staff.esc: 四字符转义', () => {
    assert.strictEqual(stf.esc('<b>"&"'), '&lt;b&gt;&quot;&amp;&quot;');
    assert.strictEqual(stf.esc(null), '');
  });

  /* ==================== inventory.html ==================== */
  const invHtml = read('inventory.html');
  const invCode = sliceBetween(invHtml, 'function _esc(s){', 'async function load(){');
  const inv = run(invCode);

  await t('inventory._esc: 四字符转义', () => {
    assert.strictEqual(inv._esc('<img src="x">&'), '&lt;img src=&quot;x&quot;&gt;&amp;');
    assert.strictEqual(inv._esc(0), '0');
  });
  await t('inventory._statusBadge: 库存 5 态 class 与中文', () => {
    assert.strictEqual(inv._statusBadge('in_stock'), '<span class="status-badge stock">● 在库</span>');
    assert.strictEqual(inv._statusBadge('borrowed'), '<span class="status-badge borrowed">● 借出</span>');
    assert.strictEqual(inv._statusBadge('repair'), '<span class="status-badge repair">● 维修中</span>');
    assert.strictEqual(inv._statusBadge('scrapped'), '<span class="status-badge scrapped">● 报废</span>');
    assert.strictEqual(inv._statusBadge('out_of_stock'), '<span class="status-badge out">● 缺货</span>');
  });
  await t('inventory._statusBadge: 未知状态降级 stock class 且保留原文', () => {
    assert.strictEqual(inv._statusBadge('xyz'), '<span class="status-badge stock">● xyz</span>');
    assert.strictEqual(inv._statusBadge(''), '<span class="status-badge stock">● </span>');
    assert(inv._statusBadge('<i>').indexOf('&lt;i&gt;') >= 0);
  });
  await t('inventory._fmtDate: 空值破折号，UTC ISO 截日期', () => {
    assert.strictEqual(inv._fmtDate(''), '—');
    assert.strictEqual(inv._fmtDate(null), '—');
    assert.strictEqual(inv._fmtDate('2026-09-07T00:00:00.000Z'), '2026-09-07');
  });

  /* ---------- 汇总 ---------- */
  const failed = results.filter(r => !r.ok);
  console.log('\n========================================');
  console.log('总计 ' + results.length + ' 项：✓ ' + (results.length - failed.length) + ' 通过，✗ ' + failed.length + ' 失败');
  if (failed.length) {
    failed.forEach(f => { console.log('\n[FAIL] ' + f.name); console.log(f.err && f.err.stack || f.err); });
    process.exit(1);
  }
  console.log('全部通过');
  process.exit(0);
})().catch(e => { console.error('测试运行器异常:', e); process.exit(2); });
