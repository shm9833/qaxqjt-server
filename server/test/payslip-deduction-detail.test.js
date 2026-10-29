'use strict';

/**
 * 工资条扣款分项明细（v20261029a）前端逻辑单元测试
 * 被测对象：js/admin-pages/staff.pre-3.js（生产文件原样，不改产品代码）
 *   1. _dedDetailCards(note)：6 类扣款分项卡渲染
 *      - 金额单位元→转分（fmt 桩以 FMT<分> 标记断言）；金额 ≤0 的项不渲染
 *      - 原因小字：缺席 N 次 × ¥P/次、事假/旷工 N 天、迟到/早退 N 次、借款抵扣
 *      - loadUnloadDeduction 缺失时回退 count×price；显式值优先
 *      - loanDeduction 缺失时回退 loan；空/全零 note 返回空串
 *   2. showDetail 内 _dnote 解析 IIFE：对象直传 / JSON 文本解析 / 空·损坏容错
 *   3. _backendToFrontend：otherDeductionNote 透传（v20261029a 修复根因）+
 *      attendanceDeduction = late+early+absent+leave 转分 + summary.lateDays/absentFullDays
 *   4. 接线回归：showDetail 模板串中确实调用 _dedDetailCards(_dnote)
 * 提取方式：按标识符定位 + 括号平衡扫描（跳过字符串字面量），vm.runInNewContext 沙箱求值。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const FE_PATH = path.resolve(__dirname, '../../js/admin-pages/staff.pre-3.js');
const src = fs.readFileSync(FE_PATH, 'utf8');

// ---- 源码提取工具：从 openIdx（'{' 或 '('）做括号平衡扫描，跳过字符串字面量与转义 ----
function balancedClose(s, openIdx) {
  let depth = 0, quote = null;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{' || c === '(') depth++;
    else if (c === '}' || c === ')') { depth--; if (depth === 0) return i; }
  }
  throw new Error('括号不平衡：openIdx=' + openIdx);
}

function extractFunction(name) {
  const head = 'function ' + name + '(';
  const at = src.indexOf(head);
  assert.ok(at >= 0, '源码中未找到 ' + name);
  const open = src.indexOf('{', at);
  return src.slice(at, balancedClose(src, open) + 1);
}

// fmt 桩：不格式化，直接以 FMT<分值> 标记输出，便于断言元→分换算
const sandbox = vm.createContext({ fmt: c => 'FMT' + c });
const dedDetailCards = vm.runInNewContext('(' + extractFunction('_dedDetailCards') + ')', sandbox);

// _dnote 解析 IIFE：提取 "(function () { ... })" 表达式，包一层 function(w) 供调用
const dnoteKey = 'var _dnote = ';
const dnoteAt = src.indexOf(dnoteKey);
assert.ok(dnoteAt >= 0, '源码中未找到 var _dnote');
const dnoteOpen = src.indexOf('(', dnoteAt);
const dnoteExpr = src.slice(dnoteOpen, balancedClose(src, dnoteOpen) + 1);
const parseNote = vm.runInNewContext('(function (w) { return ' + dnoteExpr + '(); })');

// _backendToFrontend：仅依赖 JS 内建（Number/JSON/Date/Array），可直接沙箱求值
const backendToFrontend = vm.runInNewContext('(' + extractFunction('_backendToFrontend') + ')');

// ---------- 1. _dedDetailCards：完整 note ----------
test('扣款分项卡：完整 note 渲染 5 张卡（元→分、原因小字、零项隐藏）', () => {
  const note = {
    leave: 50, absent: 100, late: 10, early: 0,
    leaveDays: 1, absentDays: 2, lateTimes: 3, earlyTimes: 0,
    loadUnloadAbsentCount: 2, loadUnloadUnitPrice: 30, loadUnloadDeduction: 60,
    loanDeduction: 200
  };
  const out = dedDetailCards(note);
  const cards = out.split('<div class="payslip-item deduct">').length - 1;
  assert.strictEqual(cards, 5, '应渲染 5 张分项卡（early=0 隐藏）');
  assert.ok(out.includes('🚚 装卸车缺席扣款'), '含装卸车卡');
  assert.ok(out.includes('缺席 2 次 × ¥30/次'), '装卸车原因小字');
  assert.ok(out.includes('-FMT6000'), '装卸车 60 元 → 6000 分');
  assert.ok(out.includes('🏖️ 请假扣款') && out.includes('事假 1 天') && out.includes('-FMT5000'), '请假 50 元');
  assert.ok(out.includes('❌ 旷工扣款') && out.includes('旷工 2 天') && out.includes('-FMT10000'), '旷工 100 元');
  assert.ok(out.includes('⏰ 迟到扣款') && out.includes('迟到 3 次') && out.includes('-FMT1000'), '迟到 10 元');
  assert.ok(!out.includes('早退扣款'), 'early=0 不渲染早退卡');
  assert.ok(out.includes('💳 借款扣款') && out.includes('从当月工资中抵扣借款') && out.includes('-FMT20000'), '借款 200 元');
});

// ---------- 2. 空与零值 ----------
test('扣款分项卡：空 note / 全零 / null 均返回空串', () => {
  assert.strictEqual(dedDetailCards({}), '');
  assert.strictEqual(dedDetailCards({ leave: 0, absent: 0, late: 0, early: 0, loadUnloadDeduction: 0, loanDeduction: 0 }), '');
  assert.strictEqual(dedDetailCards(null), '');
  assert.strictEqual(dedDetailCards(undefined), '');
});

// ---------- 3. 装卸车回退与优先级 ----------
test('扣款分项卡：loadUnloadDeduction 缺失回退 count×price，显式值优先', () => {
  const fallback = dedDetailCards({ loadUnloadAbsentCount: 3, loadUnloadUnitPrice: 30 });
  assert.ok(fallback.includes('-FMT9000'), '缺失显式值时按 3×30=90 元（9000 分）');
  assert.ok(fallback.includes('缺席 3 次 × ¥30/次'), '回退时仍带原因小字');
  const explicit = dedDetailCards({ loadUnloadDeduction: 55, loadUnloadAbsentCount: 2, loadUnloadUnitPrice: 30 });
  assert.ok(explicit.includes('-FMT5500'), '显式 loadUnloadDeduction=55 优先于 count×price');
  const noPrice = dedDetailCards({ loadUnloadAbsentCount: 2, loadUnloadUnitPrice: 0 });
  assert.strictEqual(noPrice, '', '有缺席但单价 0 → 扣款 0，不渲染');
});

// ---------- 4. 借款回退 ----------
test('扣款分项卡：loanDeduction 缺失回退 loan 字段', () => {
  const out = dedDetailCards({ loan: 120 });
  assert.ok(out.includes('-FMT12000'), 'loan=120 元 → 12000 分');
  assert.ok(out.includes('💳 借款扣款'));
  assert.strictEqual(dedDetailCards({ loan: 0 }), '');
});

// ---------- 5. _dnote 解析 ----------
test('_dnote 解析：对象直传 / JSON 文本 / 空串与损坏 JSON 容错', () => {
  // vm 沙箱返回的对象属跨 realm 原型，用 JSON 序列化断言
  const obj = { leave: 1 };
  assert.strictEqual(parseNote({ otherDeductionNote: obj }), obj, '对象类型原样返回');
  assert.strictEqual(JSON.stringify(parseNote({ otherDeductionNote: '{"absent":5}' })), '{"absent":5}', 'JSON 文本解析');
  assert.strictEqual(JSON.stringify(parseNote({ otherDeductionNote: '' })), '{}', '空串 → {}');
  assert.strictEqual(JSON.stringify(parseNote({ otherDeductionNote: null })), '{}', 'null → {}');
  assert.strictEqual(JSON.stringify(parseNote({})), '{}', '字段缺失 → {}');
  assert.strictEqual(JSON.stringify(parseNote({ otherDeductionNote: '{oops' })), '{}', '损坏 JSON → {}');
});

// ---------- 6. _backendToFrontend 透传与汇总 ----------
test('_backendToFrontend：otherDeductionNote 透传 + attendanceDeduction 转分 + summary 天/次数', () => {
  const note = '{"leave":50,"absent":100,"late":10,"early":0,"lateTimes":3,"absentDays":2}';
  const w = {
    id: 'wage_x1', batchId: 'b1', name: '张三', rankGrade: '演员',
    attDays: 2, baseSalary: 200, grossPay: 200, totalDeduction: 360, netPay: -40,
    otherDeductionNote: note
  };
  const out = backendToFrontend(w);
  assert.strictEqual(out.otherDeductionNote, note, 'otherDeductionNote 原样透传（v20261029a 根因修复）');
  assert.strictEqual(out.items.attendanceDeduction, 16000, '考勤相关扣款 = leave+absent+late+early 转分（160 元）');
  assert.strictEqual(out.summary.lateDays, 3);
  assert.strictEqual(out.summary.absentFullDays, 2);
});

test('_backendToFrontend：无 otherDeductionNote 时透传空串且考勤扣款为 0', () => {
  const out = backendToFrontend({ id: 'wage_x2', batchId: 'b1' });
  assert.strictEqual(out.otherDeductionNote, '');
  assert.strictEqual(out.items.attendanceDeduction, 0);
  assert.strictEqual(out.summary.lateDays, 0);
  assert.strictEqual(out.summary.absentFullDays, 0);
});

// ---------- 7. 接线回归 ----------
test('接线回归：showDetail 模板串调用 _dedDetailCards(_dnote)（防"有函数没接线"回归）', () => {
  assert.ok(src.includes('+ _dedDetailCards(_dnote)'), '弹窗 HTML 拼接处必须包含 _dedDetailCards(_dnote)');
  assert.ok(src.includes('otherDeductionNote: w.otherDeductionNote || \'\''), '_backendToFrontend 返回对象必须透传 otherDeductionNote');
});
