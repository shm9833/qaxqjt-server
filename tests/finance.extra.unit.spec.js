/* tests/finance.extra.unit.spec.js — 财务管理页补充单元测试
 *
 * 用法：node tests/finance.extra.unit.spec.js
 * 依赖：无（Node 内置 vm/assert/fs；函数体直接从 admin/finance.html 抽取）
 *
 * 三部分：
 *   A. 财务页既有函数：_esc / _fmtMoney / _fmtDate / _statusBadge / _finYM / _finM0 / _finRows
 *   B. renderExtras 集成：年/当月收支、利润率、订单待收笔数、支出分类正则（人员/设备/其他）
 *   C. 月度对账弹窗 DOM 交互：开窗、年度下拉、关闭、年度切换、遮罩点击、加载失败、弹窗内导出
 *   D. 20260925 代码块边界数据：空年份、大额千分位、全对账/全未对账、订单边界、残缺凭证
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'admin', 'finance.html');
const html = fs.readFileSync(SRC, 'utf8');

function sliceBetween(s, markA, markB) {
  const a = s.indexOf(markA);
  const b = s.indexOf(markB, a);
  assert(a >= 0 && b > a, '抽取失败：' + markA + ' / ' + markB);
  return s.slice(a, b);
}
/* 段 A：2247 区基础函数 */
const CODE_A = sliceBetween(html, 'function _esc(s){', 'async function load(){');
/* 段 B：_finYM/_finM0/_finRows/_finSet */
const CODE_B = sliceBetween(html, 'function _finYM(d){', 'async function renderExtras(){');
/* 段 R：renderExtras */
const CODE_R = sliceBetween(html, 'async function renderExtras(){', 'function _renderFinMonthChart(monthly, year){');
/* 段 C：20260925 代码块 */
const CODE_C = sliceBetween(html, 'var _FIN_VTT=', '\n  function bind(');

const tick = ms => new Promise(r => setTimeout(r, ms || 30));
const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓ ' + name); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}

/* API 桩：按 url 分发 {items}，支持 __reject / 自定义覆盖 */
function apiStub(fix) {
  return {
    get(url) {
      const key = url.indexOf('/fin/ledger') >= 0 ? 'ledger' : url.indexOf('/orders') >= 0 ? 'orders' : 'schedules';
      const f = fix[key];
      if (f && f.__reject) return Promise.reject(new Error(key + ' api down'));
      return Promise.resolve({ items: ((f || []).slice ? f.slice() : []) });
    },
  };
}

/* ================= 段 A / B 纯函数沙箱 ================= */
function sandboxAB() {
  const sb = { console, document: { querySelector() { return null; } } };
  vm.createContext(sb);
  vm.runInContext(CODE_A + '\n' + CODE_B, sb, { filename: 'fin-base.js' });
  return sb;
}

/* ================= 弹窗 DOM 桩 ================= */
function makeDom() {
  const store = new Map();
  const bodyKids = [];
  function el(id) {
    if (!store.has(id)) {
      const e = {
        id: id || '', style: {}, dataset: {}, value: '2026', textContent: '',
        _html: '', removed: false, listeners: {},
        get innerHTML() { return this._html; },
        set innerHTML(v) { this._html = String(v); },
        appendChild(c) { return c; },
        addEventListener(type, fn) { this.listeners[type] = fn; },
        remove() { this.removed = true; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
      };
      store.set(id, e);
    }
    return store.get(id);
  }
  const doc = {
    getElementById(id) { return el('#' + id); },
    querySelector(sel) { return el(sel); },
    querySelectorAll(sel) {
      if (sel === '#__frModal') return bodyKids.filter(c => c._isModal && !c.removed);
      return [];
    },
    createElement() {
      const wrap = {
        _html: '',
        set innerHTML(v) { this._html = v; },
        get innerHTML() { return this._html; },
        get firstChild() { const m = el('#__frModal'); m._isModal = true; return m; },
        addEventListener(type, fn) { this.listeners = this.listeners || {}; this.listeners[type] = fn; },
      };
      return wrap;
    },
    body: { appendChild(c) { bodyKids.push(c); return c; } },
  };
  return { doc, el, bodyKids };
}

function makeXlsxStub() {
  const cap = {};
  return {
    __cap: cap,
    utils: {
      aoa_to_sheet(aoa) {
        const ws = {};
        aoa.forEach((row, r) => row.forEach((v, c) => {
          if (v === '' || v == null) return;
          ws[String.fromCharCode(65 + c) + (r + 1)] = (v && typeof v === 'object') ? v : { t: 's', v: String(v) };
        }));
        return ws;
      },
      encode_cell: ({ r, c }) => String.fromCharCode(65 + c) + (r + 1),
    },
    write() { return 'x'; },
    writeFile(wb, name) { cap.wb = wb; cap.name = name; },
  };
}

function modalSandbox(fix, xlsx) {
  const dom = makeDom();
  const toasts = [];
  const sb = {
    API: apiStub(fix),
    _finRows: d => Array.isArray(d) ? d : ((d && d.items) || []),
    _esc: s => String(s == null ? '' : s),
    T: (m, ty) => toasts.push({ m: String(m), ty: String(ty || '') }),
    console, document: dom.doc, XLSX: xlsx || undefined,
  };
  vm.createContext(sb);
  vm.runInContext(CODE_C, sb, { filename: 'fin-modal.js' });
  return { sb, dom, toasts };
}

(async () => {
  console.log('finance.extra.unit.spec — finance.html 既有函数 / renderExtras / 弹窗 DOM / 边界\n');

  /* ========== A. 既有纯函数 ========== */
  const ab = sandboxAB();
  await t('_esc: 四字符转义，null/数字安全', () => {
    assert.strictEqual(ab._esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;\'&lt;/a&gt;');
    assert.strictEqual(ab._esc(null), '');
    assert.strictEqual(ab._esc(123), '123');
  });
  await t('_fmtMoney: 正数带 + 号、千分位两位小数；负数行为锁定为 ¥-', () => {
    assert.strictEqual(ab._fmtMoney(1000), '+¥1,000.00');
    assert.strictEqual(ab._fmtMoney(0), '+¥0.00');
    assert.strictEqual(ab._fmtMoney(-500), '¥-500.00');
    assert.strictEqual(ab._fmtMoney('x'), '+¥0.00');
  });
  await t('_fmtDate: 空值破折号，UTC ISO 截日期', () => {
    assert.strictEqual(ab._fmtDate(''), '—');
    assert.strictEqual(ab._fmtDate(null), '—');
    assert.strictEqual(ab._fmtDate('2026-09-07T00:00:00.000Z'), '2026-09-07');
  });
  await t('_statusBadge: 4 态 class+中文，未知状态降级 draft 且原文转义', () => {
    assert.strictEqual(ab._statusBadge('draft'), '<span class="status-badge draft">● 草稿</span>');
    assert.strictEqual(ab._statusBadge('checked'), '<span class="status-badge checked">● 已复核</span>');
    assert.strictEqual(ab._statusBadge('reconciled'), '<span class="status-badge reconciled">● 已对账</span>');
    assert.strictEqual(ab._statusBadge('void'), '<span class="status-badge void">● 已作废</span>');
    assert.strictEqual(ab._statusBadge('x'), '<span class="status-badge draft">● x</span>');
    assert(ab._statusBadge('<b>').indexOf('&lt;b&gt;') >= 0);
  });
  await t('_finYM: 提取 YYYY-MM，非法值空串', () => {
    assert.strictEqual(ab._finYM('2026-09-08'), '2026-09');
    assert.strictEqual(ab._finYM('2026-09'), '2026-09');
    assert.strictEqual(ab._finYM(''), '');
    assert.strictEqual(ab._finYM(null), '');
    assert.strictEqual(ab._finYM('26-09-01'), '');
  });
  await t('_finM0: ¥ 千分位整数（无小数位）', () => {
    assert.strictEqual(ab._finM0(76680), '¥76,680');
    assert.strictEqual(ab._finM0(0), '¥0');
    assert.strictEqual(ab._finM0(null), '¥0');
    assert.strictEqual(ab._finM0(1234567), '¥1,234,567');
  });
  await t('_finRows: 数组直返 / {items} 解包 / 空值 []', () => {
    // vm 跨域数组原型不同，长度+元素逐一断言
    assert.strictEqual(ab._finRows([1, 2]).length, 2);
    assert.strictEqual(ab._finRows({ items: [3] })[0], 3);
    assert.strictEqual(ab._finRows(null).length, 0);
    assert.strictEqual(ab._finRows({}).length, 0);
  });

  /* ========== B. renderExtras 集成 ========== */
  await t('renderExtras: 年/当月收支卡、利润率、待收笔数、支出分类正则', async () => {
    const sets = {};
    const cap = { monthly: null };
    const sb = {
      API: apiStub({
        ledger: [
          { voucherDate: '2026-09-07', creditAmount: 1000, debitAmount: 0 },
          { voucherDate: '2026-09-08', creditAmount: 0, debitAmount: 50000, voucherCategory: '9月工资' },
          { voucherDate: '2026-09-09', creditAmount: 0, debitAmount: 3000, voucherCategory: '服装采购' },
          { voucherDate: '2026-09-10', creditAmount: 0, debitAmount: 200, voucherCategory: '杂项' },
          { voucherDate: '2026-08-01', creditAmount: 0, debitAmount: 999, voucherCategory: '劳务费' },
        ],
        schedules: [{ date: '2026-09-20' }],
        orders: [
          { status: 'confirmed', totalAmount: 5000, paidAmount: 2000 }, // 待收 3000
          { status: 'partial_paid', totalAmount: 800, paidAmount: 300 }, // 待收 500
          { status: 'cancelled', totalAmount: 9999 },
        ],
      }),
      _finRows: d => Array.isArray(d) ? d : ((d && d.items) || []),
      _finYM: ab._finYM, _finM0: ab._finM0,
      _finSet: (sel, val) => { sets[sel] = val; },
      _renderFinMonthChart() {},
      _renderFinSummary(monthly, shows, year) { cap.monthly = monthly; cap.shows = shows; cap.year = year; },
      _renderFinProjects() {},
      console, document: { querySelector() { return null; } },
    };
    vm.createContext(sb);
    vm.runInContext(CODE_R, sb, { filename: 'fin-render.js' });
    await sb.renderExtras();
    await tick();

    assert.strictEqual(sets['.finance-stat-card.income .fsc-value'], '¥1,000');      // 年收入只算 2026
    assert.strictEqual(sets['.finance-stat-card.expense .fsc-value'], '¥54,199');    // 50000+3000+200+999
    assert.strictEqual(sets['.finance-stat-card.month-income .fsc-value'], '¥1,000');
    assert.strictEqual(sets['.finance-stat-card.month-expense .fsc-value'], '¥53,200');
    assert.strictEqual(sets['.finance-stat-card.month-income .fsc-sub'], '当月 1 笔收入');
    assert.strictEqual(sets['.finance-stat-card.month-expense .fsc-sub'], '当月 3 笔支出');
    assert(sets['.finance-stat-card.profit .fsc-value'].indexOf('¥52,200') >= 0);    // 1000-53200 负
    assert(sets['.finance-stat-card.profit .fsc-sub'].indexOf('利润率') >= 0);
    assert(sets['.finance-stat-card.pending .fsc-value'].indexOf('¥3,500') >= 0);
    assert(sets['.finance-stat-card.pending .fsc-value'].indexOf('(2笔)') >= 0);
    // 分类正则：工资→person、服装→equip、杂项→other
    const sep = cap.monthly['2026-09'];
    assert.strictEqual(sep.person, 50000);
    assert.strictEqual(sep.equip, 3000);
    assert.strictEqual(sep.other, 200);
    assert.strictEqual(cap.monthly['2026-08'].person, 999);
    assert.strictEqual(cap.shows['2026-09'], 1);
  });

  /* ========== C. 弹窗 DOM 交互 ========== */
  const FIX = {
    ledger: [
      { voucherNo: 'A2', voucherDate: '2026-09-08', creditAmount: 1000, debitAmount: 0, isReconciled: true, status: 'checked' },
      { voucherNo: 'A1', voucherDate: '2026-09-07', creditAmount: 0, debitAmount: 76680, isReconciled: false, status: 'draft' },
    ],
    orders: [{ orderNo: 'O1', status: 'confirmed', totalAmount: 5000, paidAmount: 2000 }],
    schedules: [{ date: '2026-09-20' }],
  };
  await t('openMonthlyRecon: 弹窗挂载、年度下拉 2025-2027 默认今年、按钮绑定', async () => {
    const { sb, dom } = modalSandbox(FIX);
    await sb.openMonthlyRecon();
    await tick();
    const modal = dom.el('#__frModal');
    assert(modal._isModal && !modal.removed, '弹窗未挂载到 body');
    assert.strictEqual(typeof modal.listeners.click, 'function');            // 遮罩点击关闭
    assert.strictEqual(typeof dom.el('#__fr_close').onclick, 'function');
    assert.strictEqual(typeof dom.el('#__fr_export').onclick, 'function');
    assert.strictEqual(typeof dom.el('#__fr_year').onchange, 'function');
    // 年度下拉选项（取自 createElement wrap 的原始 HTML）
  });
  await t('_finFillRecon: 表头 4 卡 / 12 月行 / 9 月真实数 / 合计行', async () => {
    const { dom } = modalSandbox(FIX);
    // 复用上一用例的打开结果不可能（沙箱独立），重新打开
    const { sb } = (() => { return {}; })();
    const env = modalSandbox(FIX);
    await env.sb.openMonthlyRecon();
    await tick(40);
    const head = env.dom.el('#__fr_head')._html, body = env.dom.el('#__fr_body')._html, foot = env.dom.el('#__fr_foot')._html;
    assert(head.indexOf('年度总收入') >= 0 && head.indexOf('¥1,000.00') >= 0);
    assert(head.indexOf('订单待收') >= 0 && head.indexOf('¥3,000.00') >= 0);
    assert(body.indexOf('9月') >= 0);
    assert(body.indexOf('¥1,000.00') >= 0 && body.indexOf('¥76,680.00') >= 0);
    assert(body.indexOf('部分 1/2') >= 0);
    assert(foot.indexOf('年度合计') >= 0 && foot.indexOf('1/2') >= 0);
  });
  await t('弹窗: 关闭按钮移除弹窗；年度切到 2025 后 9 月变无发生', async () => {
    const env = modalSandbox(FIX);
    await env.sb.openMonthlyRecon();
    await tick(40);
    const modal = env.dom.el('#__frModal');
    env.dom.el('#__fr_close').onclick();
    assert.strictEqual(modal.removed, true);
    // 重新开窗切 2025（空年）
    const env2 = modalSandbox(FIX);
    await env2.sb.openMonthlyRecon();
    await tick(40);
    const sel = env2.dom.el('#__fr_year');
    sel.value = '2025';
    sel.onchange();
    await tick(40);
    const body = env2.dom.el('#__fr_body')._html;
    assert(body.indexOf('正在汇总 2026') < 0);           // 加载占位已被替换
    assert(body.indexOf('9月') >= 0);                     // 12 行仍在
    assert(body.indexOf('无发生') >= 0);                  // 空月份状态
    assert(body.indexOf('¥1,000.00') < 0);                // 2025 无数据
    assert(env2.dom.el('#__fr_foot')._html.indexOf('0/0') >= 0);
  });
  await t('弹窗: 台账接口失败 → 行内显示“加载失败”不抛异常', async () => {
    const env = modalSandbox({ ledger: { __reject: true }, orders: [], schedules: [] });
    await env.sb.openMonthlyRecon();
    await tick(40);
    const body = env.dom.el('#__fr_body')._html;
    assert(body.indexOf('加载失败') >= 0, body.slice(0, 120));
  });
  await t('弹窗: 导出按钮按所选年度触发 Excel 生成', async () => {
    const xs = makeXlsxStub();
    const env = modalSandbox(FIX, xs);
    await env.sb.openMonthlyRecon();
    await tick(40);
    env.dom.el('#__fr_export').onclick();
    await tick(40);
    assert.strictEqual(xs.__cap.name, '秦安秦剧团_财务年度汇总_2026.xlsx');
    assert.strictEqual(JSON.stringify(xs.__cap.wb.SheetNames), JSON.stringify(['年度汇总', '月度对账', '流水明细']));
  });

  /* ========== D. 边界数据 ========== */
  await t('边界: 空年份 totals 全 0、每月无发生、合计行状态=未对账（行为锁定）', async () => {
    const env = modalSandbox({ ledger: [], orders: [], schedules: [] });
    const g = await env.sb._finGather(2024);
    assert.deepStrictEqual([g.totals.in, g.totals.out, g.totals.net, g.totals.cnt, g.totals.pending], [0, 0, 0, 0, 0]);
    assert.strictEqual(g.months.length, 12);
    assert.strictEqual(env.sb._finReconStat(g.months[0]).t, '无发生');
  });
  await t('边界: 空年份 Excel 状态列=12 个无发生、合计=未对账、空台账/空订单占位', async () => {
    const xs = makeXlsxStub();
    const env = modalSandbox({ ledger: [], orders: [], schedules: [] }, xs);
    await env.sb.exportFinanceXlsx(2024);
    const wb = xs.__cap.wb;
    assert.strictEqual(wb.Sheets['月度对账']['I4'].v, '无发生');
    assert.strictEqual(wb.Sheets['月度对账']['I15'].v, '无发生');
    assert.strictEqual(wb.Sheets['月度对账']['I16'].v, '未对账'); // cnt=0 的合计行实际行为
    // Sheet3 占位 + Sheet1 订单占位
    const a3 = JSON.stringify(wb.Sheets['流水明细']);
    assert(a3.indexOf('本年度暂无台账凭证') >= 0);
    const a1 = JSON.stringify(wb.Sheets['年度汇总']);
    assert(a1.indexOf('本年度暂无订单') >= 0);
  });
  await t('边界: 大额千分位与负净额月份', async () => {
    const env = modalSandbox({
      ledger: [{ voucherNo: 'X1', voucherDate: '2026-03-01', creditAmount: 0, debitAmount: 123456789.5 }],
      orders: [], schedules: [],
    }, makeXlsxStub());
    assert.strictEqual(env.sb._finMF(123456789.5), '¥123,456,789.50');
    const g = await env.sb._finGather(2026);
    assert.strictEqual(g.months[2].out, 123456789.5);
    assert.strictEqual(g.totals.net, -123456789.5);
  });
  await t('边界: 全部已对账 → 每月“已对账”、合计“全部已对账”', async () => {
    const xs = makeXlsxStub();
    const env = modalSandbox({
      ledger: [
        { voucherNo: 'R1', voucherDate: '2026-02-01', creditAmount: 100, debitAmount: 0, isReconciled: true },
        { voucherNo: 'R2', voucherDate: '2026-02-02', creditAmount: 0, debitAmount: 40, isReconciled: true },
      ],
      orders: [], schedules: [],
    }, xs);
    const g = await env.sb._finGather(2026);
    assert.strictEqual(env.sb._finReconStat(g.months[1]).t, '已对账');
    await env.sb.exportFinanceXlsx(2026);
    assert.strictEqual(xs.__cap.wb.Sheets['月度对账']['I16'].v, '全部已对账');
  });
  await t('边界: 订单待收六种情形（取消/退款/完成/结清/超额/空总额均不计）', async () => {
    const env = modalSandbox({
      ledger: [],
      schedules: [],
      orders: [
        { status: 'cancelled', totalAmount: 5000, paidAmount: 0 },        // 排除
        { status: 'refunded', totalAmount: 5000, paidAmount: 0 },         // 排除
        { status: 'completed', totalAmount: 5000, paidAmount: 1000 },     // 已完成即使有余额也排除
        { status: 'paid', totalAmount: 5000, paidAmount: 0 },             // 已付款状态排除
        { status: 'confirmed', totalAmount: 100, paidAmount: 100 },       // 结清排除
        { status: 'confirmed', totalAmount: 100, paidAmount: 150 },       // 超额 rest<0 排除
        { status: 'draft', finalAmount: 700, paidAmount: 200 },           // totalAmount 缺空 → 500
      ],
    });
    const g = await env.sb._finGather(2026);
    assert.strictEqual(g.totals.pending, 500);
    assert.strictEqual(g.totals.pendCnt, 1);
  });
  await t('边界: 残缺凭证（空对象/缺金额/坏日期）不崩且不计入任何桶', async () => {
    const env = modalSandbox({
      ledger: [{}, { voucherDate: 'bad', creditAmount: 'x' }, { voucherDate: '2026-09-01' }],
      orders: [{ status: 'confirmed' }], schedules: [{ date: 'bad' }],
    });
    const g = await env.sb._finGather(2026);
    assert.strictEqual(g.totals.cnt, 1);                 // 仅 09-01 一张（金额 0）
    assert.strictEqual(g.totals.in, 0);
    assert.strictEqual(g.totals.shows, 0);
    assert.strictEqual(g.totals.pending, 0);             // 无金额订单
    assert.strictEqual(g.months[8].cnt, 1);
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
