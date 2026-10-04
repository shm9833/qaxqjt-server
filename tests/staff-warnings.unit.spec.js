/* tests/staff-warnings.unit.spec.js — staff.html 考勤预警规则单元测试
 *
 * 用法：node tests/staff-warnings.unit.spec.js
 * 依赖：无（Node 内置 vm/assert/fs；函数体直接从 admin/staff.html 抽取）
 *
 * 覆盖：
 *   A. 辅助函数 _countByType / _attWarnCard / _attStaffWarnCard / _attOverviewHead
 *      / _attWarnListByLevel / _attWarnListByDept
 *   B. renderAttWarnings 内联分类规则（切片抽取）：红/橙/黄三级触发条件、
 *      级别优先级、触发文案、部门归属、严重度排序
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'admin', 'staff.html');
const html = fs.readFileSync(SRC, 'utf8');

function sliceBetween(s, markA, markB) {
  const a = s.indexOf(markA);
  const b = s.indexOf(markB, a);
  assert(a >= 0 && b > a, '抽取失败：' + markA.slice(0, 40) + ' / ' + markB.slice(0, 40));
  return s.slice(a, b);
}

/* 段1：六个独立辅助函数（2028-2183） */
const CODE_FUNCS = sliceBetween(html, 'function _attWarnCard(level, title, detail){', '// 全员视图：切换"按严重程度/按部门分组"');

/* 段2：renderAttWarnings 内联分类+排序块，包成 __classify */
const SLICE_CLASSIFY = sliceBetween(html,
  'Object.keys(mergeKeys).forEach(function(k){',
  'var redCount = people.filter');
const CODE_CLASSIFY =
  'function __classify(byStaff, yearAbsentMap, rosterById, year){\n' +
  '  var people=[]; var mergeKeys={};\n' +
  '  Object.keys(byStaff).forEach(function(k){ mergeKeys[k]=1; });\n' +
  '  Object.keys(yearAbsentMap).forEach(function(k){ mergeKeys[k]=1; });\n' +
  SLICE_CLASSIFY +
  '\n  return people;\n}';

const sb = { console };
vm.createContext(sb);
vm.runInContext(CODE_FUNCS + '\n' + CODE_CLASSIFY, sb, { filename: 'att-warn.js' });

const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓ ' + name); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}

/* 构造花名册 */
function roster(rows) { const m = {}; rows.forEach(r => { m[r.id] = r; }); return m; }
const ROSTER = roster([
  { id: 'p1', name: '张三', dept: '演员队', staffNo: 'PF001' },
  { id: 'p2', name: '李四', dept: '乐队', staffNo: 'PF002' },
  { id: 'p3', name: '王五', dept: '舞美队', staffNo: 'PF003' },
  { id: 'p4', name: '赵六', dept: '行政', staffNo: 'PF004' },
]);

(async () => {
  console.log('staff-warnings.unit.spec — 考勤预警辅助函数与分类规则\n');

  /* ========== A. 辅助函数 ========== */
  await t('_countByType: 按类型计数（late 与 late_over 合并）', () => {
    const rows = [{ type: 'late' }, { type: 'late_over' }, { type: 'PL' }, { type: 'normal' }, { type: 'absent' }];
    assert.strictEqual(sb._countByType(rows, ['late', 'late_over']), 2);
    assert.strictEqual(sb._countByType(rows, ['PL']), 1);
    assert.strictEqual(sb._countByType(rows, ['absent']), 1);
    assert.strictEqual(sb._countByType([], ['late']), 0);
  });
  await t('_attWarnCard: 三色底/边框/图标，detail 为空时不渲染明细行', () => {
    const red = sb._attWarnCard('red', 'R', 'D');
    assert(red.indexOf('rgba(220,53,69,0.08)') >= 0 && red.indexOf('🚫') >= 0 && red.indexOf('>D<') >= 0);
    const orange = sb._attWarnCard('orange', 'O', 'D');
    assert(orange.indexOf('rgba(253,126,20,0.08)') >= 0 && orange.indexOf('⚠️') >= 0);
    const yellow = sb._attWarnCard('yellow', 'Y', '');
    assert(yellow.indexOf('rgba(255,193,7,0.10)') >= 0 && yellow.indexOf('🔔') >= 0);
    assert(yellow.indexOf('font-size:0.82rem') < 0, '空 detail 不应渲染明细');
  });
  await t('_attStaffWarnCard: data 属性、姓名双引号转义、触发项逐条列出', () => {
    const card = sb._attStaffWarnCard('p1', '张"三', 'red', ['线1', '线2']);
    assert(card.indexOf('data-staff-id="p1"') >= 0);
    assert(card.indexOf('data-staff-name="张&quot;三"') >= 0);
    assert(card.indexOf('att-staff-warn-card') >= 0);
    assert(card.indexOf('>线1<') >= 0 && card.indexOf('>线2<') >= 0);
    assert.strictEqual(sb._attStaffWarnCard('', '', 'yellow', []).indexOf('data-staff-id=""') >= 0, true);
  });
  await t('_attOverviewHead: 月份标题、8 个统计 chip、模式按钮选中态', () => {
    const h = sb._attOverviewHead({
      monthLabel: '2026年9月', totalRoster: 27, peopleWithRecords: 20,
      totLate: 4, totPL: 3, totAbsent: 2, redCount: 1, orangeCount: 2, yellowCount: 3, mode: 'dept',
    });
    assert(h.indexOf('2026年9月 全员考勤预警总览') >= 0);
    assert(h.indexOf('在册人数') >= 0 && h.indexOf('>27<') >= 0);
    assert(h.indexOf('解聘风险(人)') >= 0 && h.indexOf('>1<') >= 0);
    assert(h.indexOf('需关注(人)') >= 0 && h.indexOf('>5<') >= 0); // orange+yellow
    assert(h.indexOf('data-att-warn-mode="dept"') >= 0);
    // dept 模式：部门按钮反色（深底），level 按钮白
    assert(/data-att-warn-mode="dept"[^>]*background:#7a3e00/.test(h));
    assert(/data-att-warn-mode="level"[^>]*background:#fff/.test(h));
    assert(h.indexOf('data-att-warn-export="1"') >= 0);
  });
  await t('_attWarnListByLevel: 仅渲染非空分组，人数标题正确', () => {
    const people = [
      { id: 'p1', name: '张三', level: 'red', lines: ['r'] },
      { id: 'p2', name: '李四', level: 'yellow', lines: ['y1'] },
      { id: 'p3', name: '王五', level: 'yellow', lines: ['y2'] },
    ];
    const html1 = sb._attWarnListByLevel(people, { red: 1, orange: 0, yellow: 2 });
    assert(html1.indexOf('解聘风险 / 严重违规（1人）') >= 0);
    assert(html1.indexOf('临近解聘红线') < 0, 'orange=0 不应出该组');
    assert(html1.indexOf('临近预警阈值（2人）') >= 0);
    assert(html1.indexOf('data-staff-id="p3"') >= 0);
    assert.strictEqual(sb._attWarnListByLevel(people, { red: 0, orange: 0, yellow: 0 }), '');
  });
  await t('_attWarnListByDept: 有红色部门排最前且默认展开，无红色折叠', () => {
    const people = [
      { id: 'p4', name: '赵六', level: 'yellow', lines: ['x'], dept: '行政' },
      { id: 'p1', name: '张三', level: 'red', lines: ['x'], dept: '演员队' },
    ];
    const html1 = sb._attWarnListByDept(people, ROSTER);
    const iActor = html1.indexOf('演员队'), iAdmin = html1.indexOf('行政');
    assert(iActor >= 0 && iAdmin >= 0 && iActor < iAdmin, '红色部门应排前');
    // 演员队展开（body 无 display:none），行政折叠
    const actorSec = html1.slice(iActor, iAdmin);
    assert(actorSec.indexOf('att-dept-body') >= 0 && actorSec.indexOf('display:none') < 0);
    const adminSec = html1.slice(iAdmin);
    assert(adminSec.indexOf('display:none;') >= 0);
    // 在册/预警人数与徽标
    assert(adminSec.indexOf('在册 1 人 · 预警 1 人') >= 0);
    assert(actorSec.indexOf('解聘') >= 0);
  });
  await t('_attWarnListByDept: 固定部门顺序（乐队在舞美前）+ 无预警部门绿色提示', () => {
    const people = [
      { id: 'p3', name: '王五', level: 'yellow', lines: ['x'], dept: '舞美队' },
      { id: 'p2', name: '李四', level: 'yellow', lines: ['x'], dept: '乐队' },
    ];
    const html1 = sb._attWarnListByDept(people, ROSTER);
    assert(html1.indexOf('乐队') < html1.indexOf('舞美队'));
    // 演员队/行政在册但无预警 → 绿色提示
    assert(html1.indexOf('考勤正常部门') >= 0);
    assert(html1.indexOf('演员队（1人）') >= 0 && html1.indexOf('行政（1人）') >= 0);
  });

  /* ========== B. 内联分类规则（生产代码切片） ========== */
  const classify = (byStaff, yearAbsent) => sb.__classify(byStaff, yearAbsent || {}, ROSTER, 2026);

  await t('分类: 当月旷工≥2 → 红色解聘文案', () => {
    const ps = classify({ p1: { id: 'p1', name: '张三', absent: 2, late: 0, pl: 0 } });
    assert.strictEqual(ps.length, 1);
    assert.strictEqual(ps[0].level, 'red');
    assert(ps[0].lines.join('').indexOf('当月旷工 2 天，已达解聘标准') >= 0);
    assert.strictEqual(ps[0].dept, '演员队');
    assert.strictEqual(ps[0].staffNo, 'PF001');
  });
  await t('分类: 全年旷工≥3（仅全年记录、当月无记录）→ 红色', () => {
    const ps = classify({}, { p2: { count: 3, id: 'p2', name: '李四' } });
    assert.strictEqual(ps.length, 1);
    assert.strictEqual(ps[0].level, 'red');
    assert(ps[0].lines[0].indexOf('2026 年累计旷工 3 次') >= 0);
    assert.strictEqual(ps[0].yAbsent, 3);
    assert.strictEqual(ps[0].dept, '乐队');
  });
  await t('分类: 迟到3次红色（取消全勤）/ 2次黄色 / 事假2次红色 / 1次黄色', () => {
    const ps = classify({
      a: { id: '', name: 'A', absent: 0, late: 3, pl: 0 },
      b: { id: '', name: 'B', absent: 0, late: 2, pl: 0 },
      c: { id: '', name: 'C', absent: 0, late: 0, pl: 2 },
      d: { id: '', name: 'D', absent: 0, late: 0, pl: 1 },
    });
    const byName = {}; ps.forEach(p => { byName[p.name] = p; });
    assert.strictEqual(byName.A.level, 'red');
    assert(byName.A.lines.join('').indexOf('已取消全勤奖') >= 0);
    assert.strictEqual(byName.B.level, 'yellow');
    assert.strictEqual(byName.C.level, 'red');
    assert(byName.C.lines.join('').indexOf('已达2次上限') >= 0);
    assert.strictEqual(byName.D.level, 'yellow');
  });
  await t('分类: 当月旷工1 或 全年旷工1-2 → 橙色', () => {
    const ps = classify(
      { a: { id: '', name: 'A', absent: 1, late: 0, pl: 0 } },
      { b: { count: 2, id: '', name: 'B' } }
    );
    const byName = {}; ps.forEach(p => { byName[p.name] = p; });
    assert.strictEqual(byName.A.level, 'orange');
    assert.strictEqual(byName.B.level, 'orange');
    assert(byName.A.lines.join('').indexOf('再 1 天触发解聘') >= 0);
  });
  await t('分类: 红色优先级覆盖黄/橙，但全部触发文案都保留', () => {
    const ps = classify({ p1: { id: 'p1', name: '张三', absent: 2, late: 2, pl: 1 } },
      { p1: { count: 1, id: 'p1', name: '张三' } });
    assert.strictEqual(ps.length, 1);
    assert.strictEqual(ps[0].level, 'red');
    const all = ps[0].lines.join('');
    assert(all.indexOf('当月旷工 2 天') >= 0);
    assert(all.indexOf('迟到/早退 2 次') >= 0);   // 黄色文案仍列出
    assert(all.indexOf('事假 1 次') >= 0);
    assert(all.indexOf('年累计旷工 1 次') >= 0);   // 橙色文案仍列出
  });
  await t('分类: 无触发项的人不出现在结果中', () => {
    const ps = classify({ p1: { id: 'p1', name: '张三', absent: 0, late: 0, pl: 0 } });
    assert.strictEqual(ps.length, 0);
  });
  await t('分类: 未在册人员 dept 回落“未在册/已离职”，key 为 ? 时姓名“未知”', () => {
    const ps = classify({ '?': { id: '', name: '未知', absent: 0, late: 2, pl: 0 } });
    assert.strictEqual(ps[0].dept, '未在册/已离职');
    const ps2 = classify({ ghost: { id: 'g9', name: '临时工', absent: 1, late: 0, pl: 0 } });
    assert.strictEqual(ps2[0].dept, '未在册/已离职');
  });
  await t('排序: red→orange→yellow；同级当月旷工降序；再同名按中文', () => {
    const ps = classify({
      z: { id: '', name: '橙人甲', absent: 1, late: 0, pl: 0 },
      a: { id: '', name: '红人甲', absent: 2, late: 0, pl: 0 },
      b: { id: '', name: '红人乙', absent: 3, late: 0, pl: 0 },
      y: { id: '', name: '黄人甲', absent: 0, late: 2, pl: 0 },
    });
    assert.strictEqual(JSON.stringify(ps.map(p => p.name + ':' + p.level)),
      JSON.stringify(['红人乙:red', '红人甲:red', '橙人甲:orange', '黄人甲:yellow']));
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
