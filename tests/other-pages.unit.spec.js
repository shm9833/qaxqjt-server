/* tests/other-pages.unit.spec.js — schedule / operas / accounts 纯函数单元测试
 *
 * 用法：node tests/other-pages.unit.spec.js
 * 依赖：无（Node 内置 vm/assert/fs；函数体直接从线上 HTML 抽取）
 *
 * 覆盖：
 *   schedule.html  __getRoleLevel（角色等级表）/ _typeClass（演出类型分类）
 *                  / _genId / _pad2
 *   operas.html    _txtMatch / 防劫持按钮文本分类链（save/delete/view/export/
 *                  schedule/audit/contract/add/other，含分支优先级）
 *   accounts.html  __fmtDate/__fmtDateShort/__escapeHtml/__getRoleValue/
 *                  __getBadgeStatus + localStorage 补丁层（GC 过期/超量、
 *                  upsert 字段合并与删标清除、delete 新建账号直删/内置打标）
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
  assert(a >= 0 && b > a, '抽取失败：' + markA.slice(0, 36) + ' / ' + markB.slice(0, 36));
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
  console.log('other-pages.unit.spec — schedule / operas / accounts\n');

  /* ==================== schedule.html ==================== */
  const sch = read('schedule.html');
  const schCode =
    sliceBetween(sch, 'var __ROLE_LEVEL = {', 'function __applyRoleMenuFilter') +
    sliceBetween(sch, 'function _typeClass(t){', 'var html = ') +
    sliceBetween(sch, 'function _genId(prefix){', 'if(!window.__toastH9)');
  const S = run(schCode, { window: {}, Math, Date, String, Number });

  await t('schedule.__getRoleLevel: 角色等级表取值，空/未知角色=0', () => {
    assert.strictEqual(S.__getRoleLevel('super_admin'), 999);
    assert.strictEqual(S.__getRoleLevel('admin'), 999);
    assert.strictEqual(S.__getRoleLevel('ops'), 800);
    assert.strictEqual(S.__getRoleLevel('finance_cashier'), 520);
    assert.strictEqual(S.__getRoleLevel('staff'), 100);
    assert.strictEqual(S.__getRoleLevel(''), 0);
    assert.strictEqual(S.__getRoleLevel(null), 0);
    assert.strictEqual(S.__getRoleLevel('ghost'), 0);
  });
  await t('schedule._typeClass: 四类关键词命中，未命中/空值返回空串', () => {
    assert.strictEqual(S._typeClass('庙会演出'), 'type-miaohui');
    assert.strictEqual(S._typeClass('惠民下乡'), 'type-huimin');
    assert.strictEqual(S._typeClass('节庆专场'), 'type-jieqing');
    assert.strictEqual(S._typeClass('商演活动'), 'type-shangyan');
    assert.strictEqual(S._typeClass('企业年会'), 'type-shangyan');
    assert.strictEqual(S._typeClass('传统本戏'), '');
    assert.strictEqual(S._typeClass(''), '');
    assert.strictEqual(S._typeClass(null), '');
  });
  await t('schedule._typeClass: 优先级 — 同时含“庙会+商演”取庙会（首匹配）', () => {
    assert.strictEqual(S._typeClass('庙会商演活动'), 'type-miaohui');
    assert.strictEqual(S._typeClass('企业节庆庆典'), 'type-jieqing'); // 节庆先于商演
    assert.strictEqual(S._typeClass('惠民企业场'), 'type-huimin');
  });
  await t('schedule._pad2 / _genId: 前缀+14位时间+2位随机', () => {
    assert.strictEqual(S._pad2(0), '00');
    assert.strictEqual(S._pad2(9), '09');
    assert.strictEqual(S._pad2(10), '10');
    assert(/^SCH\d{14}\d{2}$/.test(S._genId('SCH')));
  });

  /* ==================== operas.html ==================== */
  const op = read('operas.html');
  const classifyChain = sliceBetween(op, "var tt = 'other';", 'if(!__acqH9(btn, tt))');
  const opCode =
    sliceBetween(op, 'function _txtMatch(txt, list){', "document.addEventListener('click'") +
    'function __classifyBtn(txt){\n  var tt = \'other\';\n' + classifyChain + '\n  return tt;\n}';
  const O = run(opCode);

  await t('operas._txtMatch: 任一关键词包含即真，空列表假', () => {
    assert.strictEqual(O._txtMatch('点击保存按钮', ['保存', '提交']), true);
    assert.strictEqual(O._txtMatch('返回列表', ['保存', '提交']), false);
    assert.strictEqual(O._txtMatch('任意', []), false);
  });
  await t('operas 按钮分类: 8 类典型文本', () => {
    assert.strictEqual(O.__classifyBtn('保存'), 'save');
    assert.strictEqual(O.__classifyBtn('确认接单'), 'save');
    assert.strictEqual(O.__classifyBtn('删除该剧目'), 'delete');
    assert.strictEqual(O.__classifyBtn('驳回'), 'delete');
    assert.strictEqual(O.__classifyBtn('查看详情'), 'view');
    assert.strictEqual(O.__classifyBtn('导出 Excel'), 'export');
    assert.strictEqual(O.__classifyBtn('派工'), 'schedule');
    assert.strictEqual(O.__classifyBtn('待审批'), 'audit');
    assert.strictEqual(O.__classifyBtn('合同管理'), 'contract');
    assert.strictEqual(O.__classifyBtn('新增剧目'), 'add');
    assert.strictEqual(O.__classifyBtn('随便点点'), 'other');
    assert.strictEqual(O.__classifyBtn(''), 'other');
  });
  await t('operas 按钮分类: 优先级 — “取消”被 save 的“确认”之后？实际按链序 save 先匹配含“确认”', () => {
    // 链序锁定：save 分支在 delete 之前；“确认取消”同时含 确认/取消 → save
    assert.strictEqual(O.__classifyBtn('确认取消预约'), 'save');
    // 纯“取消” → delete
    assert.strictEqual(O.__classifyBtn('取消'), 'delete');
    // “审核”不含更前分支关键词 → audit
    assert.strictEqual(O.__classifyBtn('审核'), 'audit');
    // “新增合同” → add（add 在 contract 之后？实际链中 contract 先于 add）
    assert.strictEqual(O.__classifyBtn('新增合同'), 'contract');
  });

  /* ==================== accounts.html ==================== */
  const ac = read('accounts.html');
  /* 内存 localStorage */
  const lsStore = {};
  const localStorageStub = {
    getItem: k => (Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null),
    setItem: (k, v) => { lsStore[k] = String(v); },
    removeItem: k => { delete lsStore[k]; },
  };
  /* 日期函数 + 角色反查 */
  const acCodeBase =
    sliceBetween(ac, 'var __ROLE_LABELS = {', 'var __ALL_PERMS') +
    sliceBetween(ac, 'function __fmtDate(d) {', '// ========== 启动时拉取真实账号列表') +
    sliceBetween(ac, 'function __getCellText(tr, idx) {', 'function openModal(id)') +
    sliceBetween(ac, 'function __escapeHtml(s) {', 'function __renumberAllRows()');
  const A = run(acCodeBase, { Date, String, Number, isNaN });

  await t('accounts.__fmtDate: 空值破折号、字符串/日期对象、非法值原样返回', () => {
    assert.strictEqual(A.__fmtDate(''), '—');
    assert.strictEqual(A.__fmtDate(null), '—');
    const s = A.__fmtDate(new Date(2026, 8, 7, 9, 5));
    assert.strictEqual(s, '2026-09-07 09:05');
    assert.strictEqual(A.__fmtDate('2026-01-02T03:04'), '2026-01-02 03:04'); // 无时区后缀按本地时间解析
    assert.strictEqual(A.__fmtDate('not-a-date'), 'not-a-date');
  });
  await t('accounts.__fmtDateShort: 仅日期部分', () => {
    assert.strictEqual(A.__fmtDateShort(''), '—');
    assert.strictEqual(A.__fmtDateShort(new Date(2026, 8, 7, 9, 5)), '2026-09-07');
    assert.strictEqual(A.__fmtDateShort('bad'), 'bad');
  });
  await t('accounts.__escapeHtml: 五字符转义', () => {
    assert.strictEqual(A.__escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    assert.strictEqual(A.__escapeHtml(null), '');
    assert.strictEqual(A.__escapeHtml(123), '123');
  });
  await t('accounts.__getRoleValue: 中文标签反查 role key，未知回落 staff', () => {
    assert.strictEqual(A.__getRoleValue({ querySelectorAll: () => [{ innerText: '超级管理员' }] }, 0), 'admin');
    assert.strictEqual(A.__getRoleValue({ querySelectorAll: () => [{ innerText: '财务人员' }] }, 0), 'finance');
    assert.strictEqual(A.__getRoleValue({ querySelectorAll: () => [{ innerText: '演出调度' }] }, 0), 'scheduler');
    assert.strictEqual(A.__getRoleValue({ querySelectorAll: () => [{ innerText: '普通员工' }] }, 0), 'staff');
    assert.strictEqual(A.__getRoleValue({ querySelectorAll: () => [{ innerText: '外星人' }] }, 0), 'staff');
    assert.strictEqual(A.__getRoleValue({ querySelectorAll: () => [] }, 0), 'staff');
  });
  await t('accounts.__getBadgeStatus: 含“禁用/✕”→0，其余→1，缺单元格→1', () => {
    assert.strictEqual(A.__getBadgeStatus({ querySelectorAll: () => [{ innerText: '● 禁用' }] }, 0), '0');
    assert.strictEqual(A.__getBadgeStatus({ querySelectorAll: () => [{ innerText: '✕' }] }, 0), '0');
    assert.strictEqual(A.__getBadgeStatus({ querySelectorAll: () => [{ innerText: '● 正常' }] }, 0), '1');
    assert.strictEqual(A.__getBadgeStatus({ querySelectorAll: () => [] }, 0), '1');
  });

  /* ---------- localStorage 补丁层 ---------- */
  const acCodePatch =
    sliceLine(ac, "var __ACCOUNTS_PATCH_KEY = 'qaxqjt_admin_accounts_patch_v1';") + '\n' +
    sliceBetween(ac, 'function __patchRead() {', 'function __patchApplyOnLoad()');
  let nowMs = 1_800_000_000_000; // 固定时钟
  const P = run(acCodePatch, {
    localStorage: localStorageStub,
    Date: { now: () => nowMs },
    JSON, Number, Object, String, console,
  });
  const KEY = 'qaxqjt_admin_accounts_patch_v1';
  const DAY = 24 * 3600 * 1000;

  await t('补丁层: 空存储读取 {}；坏 JSON 安全回落 {}', () => {
    assert.strictEqual(Object.keys(P.__patchRead()).length, 0);
    lsStore[KEY] = '{bad json';
    assert.strictEqual(Object.keys(P.__patchRead()).length, 0);
    delete lsStore[KEY];
  });
  await t('补丁层: upsert 新账号落库，默认 role=staff/status=1，_isNew 保留', () => {
    P.__patchUpsert({ username: 'u1', realname: '王一', _isNew: true });
    const r = P.__patchRead().u1;
    assert.strictEqual(r.username, 'u1');
    assert.strictEqual(r.realname, '王一');
    assert.strictEqual(r.role, 'staff');
    assert.strictEqual(r.status, '1');
    assert.strictEqual(r._deleted, false);
    assert.strictEqual(r._isNew, true);
    assert(r._updatedAt === nowMs);
  });
  await t('补丁层: upsert 部分字段合并保留旧值；正常 upsert 强制清除删标', () => {
    P.__patchUpsert({ username: 'u1', phone: '13900000001' });
    let r = P.__patchRead().u1;
    assert.strictEqual(r.phone, '13900000001');
    assert.strictEqual(r.realname, '王一');  // 旧值保留
    assert.strictEqual(r._isNew, true);      // 新账号标记保留
    // 先打删标，再正常 upsert → 删标必须被清除
    P.__patchDelete('u1');
    assert.strictEqual(P.__patchRead().u1, undefined); // 新账号 delete 直接移除
    P.__patchUpsert({ username: 'u2', realname: '王二' });
    P.__patchDelete('u2'); // u2 也是新账号（_isNew true 由首次 upsert? 否：未传 _isNew → false）
  });
  await t('补丁层: 内置账号 delete 打 _deleted 标记且保留记录；再次正常 upsert 清标', () => {
    // u2 首次 upsert 未带 _isNew → _isNew=false，属于内置账号补丁
    P.__patchUpsert({ username: 'u2', realname: '王二' });
    P.__patchDelete('u2');
    let r = P.__patchRead().u2;
    assert.strictEqual(r._deleted, true);
    assert.strictEqual(r.realname, '王二');
    // 正常 upsert 清除删标（S1-A FIX）
    P.__patchUpsert({ username: 'u2', phone: '138' });
    r = P.__patchRead().u2;
    assert.strictEqual(r._deleted, false);
    assert.strictEqual(r.phone, '138');
  });
  await t('补丁层: delete 空用户名/no-op；新建账号 delete 直接物理移除', () => {
    P.__patchDelete('');
    P.__patchUpsert({ username: 'u3', realname: '王三', _isNew: true });
    P.__patchDelete('u3');
    assert.strictEqual(P.__patchRead().u3, undefined);
  });
  await t('补丁层 GC: _deleted 超 30 天清除；普通记录 90 天内保留、超 90 天清除', () => {
    delete lsStore[KEY];
    nowMs = 1_000_000_000_000;
    lsStore[KEY] = JSON.stringify({
      a: { _deleted: true, _updatedAt: nowMs - (30 * DAY + 1) },   // 删除超30天 → 清
      b: { _deleted: true, _updatedAt: nowMs - (30 * DAY - 1000) }, // 删除29天 → 留
      c: { _updatedAt: nowMs - (90 * DAY + 1) },                    // 普通超90天 → 清
      d: { _updatedAt: nowMs - (90 * DAY - 1000) },                 // 普通89天 → 留
    });
    const g = P.__patchGc();
    assert.strictEqual(g.a, undefined);
    assert.strictEqual(g.c, undefined);
    assert(g.b && g.b._deleted === true);
    assert(g.d);
  });
  await t('补丁层 GC: 超 500 条按 _updatedAt 升序删最旧，保留最新 500', () => {
    delete lsStore[KEY];
    const bulk = {};
    for (let i = 0; i < 505; i++) bulk['k' + i] = { _updatedAt: nowMs + i };
    lsStore[KEY] = JSON.stringify(bulk);
    const g = P.__patchGc();
    const keys = Object.keys(g);
    assert.strictEqual(keys.length, 500);
    assert.strictEqual(g.k0, undefined);
    assert.strictEqual(g.k1, undefined);
    assert.strictEqual(g.k2, undefined);
    assert.strictEqual(g.k3, undefined);
    assert.strictEqual(g.k4, undefined);
    assert(g.k5 && g.k504);
  });
  await t('补丁层 GC: 恰好 500 条不清理；空对象安全', () => {
    delete lsStore[KEY];
    const bulk = {};
    for (let i = 0; i < 500; i++) bulk['k' + i] = { _updatedAt: nowMs + i };
    lsStore[KEY] = JSON.stringify(bulk);
    assert.strictEqual(Object.keys(P.__patchGc()).length, 500);
    assert.strictEqual(Object.keys(P.__patchGc(null)).length >= 0, true);
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
