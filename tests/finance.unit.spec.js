/* tests/finance.unit.spec.js — 财务管理页 20260925 新功能单元测试
 *
 * 用法：node tests/finance.unit.spec.js
 * 依赖：无（仅用 Node 内置 vm/assert/fs，函数体直接从 admin/finance.html 抽取，保证测的就是线上代码）
 *
 * 覆盖范围（admin/finance.html "20260925 月度对账弹窗 + 年度财务汇总 Excel" 代码块）：
 *   1. _finPd / _finD2 / _finN2 / _finMF   日期与金额格式化
 *   2. _finReconStat                        对账状态 4 分支（无发生/已对账/部分/未对账）
 *   3. _finMarkBtn                          防劫持 4 标记
 *   4. _finGather                           年度聚合：跨年过滤、月桶、合计、净额、订单待收、台账排序、API 失败容错
 *   5. exportFinanceXlsx                    3 工作表结构 / 文件名 / 关键单元格数值 / 成功提示
 *   6. _finExportCsv（XLSX 缺失兜底）        BOM / 转义 / 文件名 / warning 提示
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

/* ---------- 从 finance.html 抽取被测代码块（var _FIN_VTT= … function bind( 之前） ---------- */
const SRC = path.join(__dirname, '..', 'admin', 'finance.html');
const html = fs.readFileSync(SRC, 'utf8');
const startAt = html.indexOf('var _FIN_VTT=');
const endAt = html.indexOf('\n  function bind(', startAt);
assert(startAt > 0, 'finance.html 中未找到 var _FIN_VTT= 起点标记');
assert(endAt > startAt, 'finance.html 中未找到 function bind( 终点标记');
const CODE = html.slice(startAt, endAt);

/* ---------- 测试夹具：2026 年度台账/订单/排期 ---------- */
const FIX = {
  ledger: [
    { voucherNo: 'A2', voucherDate: '2026-09-08', creditAmount: 1000, debitAmount: 0, isReconciled: true,  voucherType: 'receipt', voucherCategory: '演出收入', status: 'checked', summary: '演出收入', offsetAccount: '对公账户' },
    { voucherNo: 'A1', voucherDate: '2026-09-07', creditAmount: 0,    debitAmount: 76680, isReconciled: false, voucherType: 'payment', voucherCategory: '工资', status: 'draft', summary: '工资,含"引号"', offsetAccount: '现金' },
    { voucherNo: 'B1', voucherDate: '2025-12-31', creditAmount: 500,  debitAmount: 0 }, // 跨年度，应被过滤
    { voucherNo: 'C1', voucherDate: '2026-01-15', creditAmount: 200,  debitAmount: 50, isReconciled: true }, // 单凭证同时含收/支
  ],
  orders: [
    { orderNo: 'O1', status: 'confirmed',    totalAmount: 5000, paidAmount: 2000 },              // 待收 3000
    { orderNo: 'O2', status: 'cancelled',    totalAmount: 9999 },                                // 已取消，排除
    { orderNo: 'O3', status: 'paid',         totalAmount: 1000, paidAmount: 0 },                 // 已付款状态，排除
    { orderNo: 'O4', status: 'partial_paid', finalAmount: 800,  paidAmount: 300 },               // finalAmount 兜底，待收 500
    { orderNo: 'O5', status: 'confirmed',    totalAmount: 100,  paidAmount: 100 },               // 已结清，排除
  ],
  schedules: [ { date: '2026-09-10' }, { date: '2026-09-20' }, { date: '2027-01-01' } ],
};

/* ---------- XLSX 打桩：捕获 writeFile 的 wb，按 aoa 还原单元格 ---------- */
function makeXlsxStub() {
  const captured = {};
  return {
    __captured: captured,
    utils: {
      aoa_to_sheet(aoa) {
        const ws = {};
        aoa.forEach((row, r) => row.forEach((v, c) => {
          if (v === '' || v == null) return;
          const addr = String.fromCharCode(65 + c) + (r + 1);
          ws[addr] = (v && typeof v === 'object') ? v : { t: 's', v: String(v) };
        }));
        return ws;
      },
      encode_cell({ r, c }) { return String.fromCharCode(65 + c) + (r + 1); },
    },
    write() { return 'x'; },
    writeFile(wb, name) { captured.wb = wb; captured.name = name; },
  };
}

/* ---------- 构造 vm 沙箱并注入被测代码 ---------- */
function makeSandbox(fixtures, opts) {
  opts = opts || {};
  const calls = [];
  const api = {
    get(url) {
      calls.push(url);
      const key = url.indexOf('/fin/ledger') >= 0 ? 'ledger' : url.indexOf('/orders') >= 0 ? 'orders' : 'schedules';
      const f = fixtures[key];
      if (f && f.__reject) return Promise.reject(new Error(key + ' api down'));
      return Promise.resolve({ items: (f || []).slice() });
    },
  };
  const toasts = [];
  const sandbox = {
    API: api,
    _finRows: d => Array.isArray(d) ? d : ((d && d.items) || []),
    _esc: s => String(s == null ? '' : s),
    T: (msg, type) => { toasts.push({ msg: String(msg), type: String(type || '') }); },
    console,
    setTimeout: () => 0,
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
    document: {
      createElement: () => ({ click() {}, remove() {} }),
      body: { appendChild(el) { sandbox.__lastA = el; } },
      querySelectorAll: () => [],
      getElementById: () => null,
    },
    __toasts: toasts,
    __calls: calls,
  };
  sandbox.Blob = class { constructor(parts, o) { this.parts = parts; this.o = o; sandbox.__lastBlob = this; } };
  if (opts.xlsx) sandbox.XLSX = opts.xlsx;
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: 'finance.extract.js' });
  return sandbox;
}

/* ---------- 极简测试运行器（与 tests/e2e-login.spec.js 同风格，无框架） ---------- */
const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓ ' + name); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}

(async () => {
  console.log('finance.unit.spec — admin/finance.html 20260925 代码块\n');

  /* ===== 1. 格式化小函数 ===== */
  const sb = makeSandbox(FIX);
  await t('_finPd: null/空串/非法值 → null', () => {
    assert.strictEqual(sb._finPd(null), null);
    assert.strictEqual(sb._finPd(''), null);
    assert.strictEqual(sb._finPd('not-a-date'), null);
  });
  await t('_finPd: YYYY-MM / YYYY-MM-DD / ISO 均可解析', () => {
    const a = sb._finPd('2026-09-07');
    assert.strictEqual(a.getFullYear(), 2026); assert.strictEqual(a.getMonth(), 8); assert.strictEqual(a.getDate(), 7);
    const b = sb._finPd('2026-09'); // 无日 → 补 1 号
    assert.strictEqual(b.getMonth(), 8); assert.strictEqual(b.getDate(), 1);
    assert(!isNaN(sb._finPd('2026-09-07T10:00:00+08:00').getTime()));
  });
  await t('_finD2: 输出 YYYY-MM-DD，空值为空串', () => {
    assert.strictEqual(sb._finD2(new Date(2026, 8, 7)), '2026-09-07');
    assert.strictEqual(sb._finD2(null), '');
  });
  await t('_finN2: 两位小数四舍五入，非数按 0', () => {
    assert.strictEqual(sb._finN2(76680.556), 76680.56);
    // IEEE754 边界：76680.555*100=7668055.4999…，实际得 76680.55（函数行为如实锁定）
    assert.strictEqual(sb._finN2(76680.555), 76680.55);
    assert.strictEqual(sb._finN2(1.006), 1.01);
    assert.strictEqual(sb._finN2(null), 0);
    assert.strictEqual(sb._finN2('12.3'), 12.3);
  });
  await t('_finMF: ¥ 千分位两位小数', () => {
    assert.strictEqual(sb._finMF(1000), '¥1,000.00');
    assert.strictEqual(sb._finMF(0), '¥0.00');
    assert.strictEqual(sb._finMF(75530), '¥75,530.00');
  });

  /* ===== 2. 对账状态 ===== */
  await t('_finReconStat: 无发生/已对账/部分/未对账 4 分支', () => {
    assert.strictEqual(sb._finReconStat({ cnt: 0, rec: 0 }).t, '无发生');
    assert.strictEqual(sb._finReconStat({ cnt: 3, rec: 3 }).t, '已对账');
    assert.strictEqual(sb._finReconStat({ cnt: 2, rec: 1 }).t, '部分 1/2');
    assert.strictEqual(sb._finReconStat({ cnt: 2, rec: 0 }).t, '未对账');
  });
  await t('_finReconStat: 未对账为红底红字（#FFC7CE/#9C0006）', () => {
    const st = sb._finReconStat({ cnt: 1, rec: 0 }).st;
    assert.strictEqual(st.fill.fgColor.rgb, 'FFFFC7CE');
    assert.strictEqual(st.font.color.rgb, 'FF9C0006');
  });

  /* ===== 3. 防劫持标记 ===== */
  await t('_finMarkBtn: 写入 __superPatchBound/__ts3Done/__bindDone/__deadBtnChecked', () => {
    const el = {};
    sb._finMarkBtn(el);
    ['__superPatchBound', '__ts3Done', '__bindDone', '__deadBtnChecked'].forEach(k => assert.strictEqual(el[k], 1));
    sb._finMarkBtn(null); // 不抛异常
  });

  /* ===== 4. 年度聚合 ===== */
  let g;
  await t('_finGather: 拉取 ledger/orders/schedules 三个接口（pageSize=500）', async () => {
    g = await sb._finGather(2026);
    assert(sb.__calls.some(u => u.indexOf('/v1/fin/ledger') >= 0));
    assert(sb.__calls.some(u => u.indexOf('/v1/orders') >= 0));
    assert(sb.__calls.some(u => u.indexOf('/v1/schedules') >= 0));
  });
  await t('_finGather: 跨年度凭证被过滤，9 月桶聚合正确', async () => {
    const sep = g.months[8];
    assert.strictEqual(sep.in, 1000);
    assert.strictEqual(sep.out, 76680);
    assert.strictEqual(sep.cnt, 2);
    assert.strictEqual(sep.rCnt, 1);
    assert.strictEqual(sep.pCnt, 1);
    assert.strictEqual(sep.rec, 1);
    assert.strictEqual(sep.shows, 2); // 2027 年排期不计入
  });
  await t('_finGather: 单凭证同时含收/支时 rCnt/pCnt 各计 1（1 月桶）', async () => {
    const jan = g.months[0];
    assert.strictEqual(jan.in, 200);
    assert.strictEqual(jan.out, 50);
    assert.strictEqual(jan.cnt, 1);
    assert.strictEqual(jan.rCnt, 1);
    assert.strictEqual(jan.pCnt, 1);
  });
  await t('_finGather: 年度合计 = 收入1200 支出76730 净额-75530 凭证3 对账2 场次2', async () => {
    const T = g.totals;
    assert.strictEqual(T.in, 1200);
    assert.strictEqual(T.out, 76730);
    assert.strictEqual(T.net, -75530);
    assert.strictEqual(T.cnt, 3);
    assert.strictEqual(T.rec, 2);
    assert.strictEqual(T.shows, 2);
  });
  await t('_finGather: 订单待收 = 3500（排除取消/已付款/已结清，finalAmount 兜底）', async () => {
    assert.strictEqual(g.totals.pending, 3500);
    assert.strictEqual(g.totals.pendCnt, 2);
  });
  await t('_finGather: 台账按日期正序、同日期按凭证号排序', async () => {
    // vm 跨域数组不能用 deepStrictEqual（原型不同），转 JSON 比较
    assert.strictEqual(JSON.stringify(g.ledger.map(it => it.r.voucherNo)), JSON.stringify(['C1', 'A1', 'A2']));
  });
  await t('_finGather: orders/schedules 接口失败时降级为空数组不抛错', async () => {
    const sb2 = makeSandbox({ ledger: FIX.ledger, orders: { __reject: true }, schedules: { __reject: true } });
    const g2 = await sb2._finGather(2026);
    assert.strictEqual(g2.totals.pending, 0);
    assert.strictEqual(g2.totals.shows, 0);
    assert.strictEqual(g2.totals.in, 1200); // 台账不受影响
  });

  /* ===== 5. Excel 导出（XLSX 打桩捕获 wb） ===== */
  const xs = makeXlsxStub();
  const sbX = makeSandbox(FIX, { xlsx: xs });
  await t('exportFinanceXlsx: 文件名与 3 个工作表', async () => {
    await sbX.exportFinanceXlsx(2026);
    assert.strictEqual(xs.__captured.name, '秦安秦剧团_财务年度汇总_2026.xlsx');
    assert.strictEqual(JSON.stringify(xs.__captured.wb.SheetNames), JSON.stringify(['年度汇总', '月度对账', '流水明细']));
  });
  await t('exportFinanceXlsx: Sheet1 年度总览数值（B6=1200 D6=76730 F6=-75530 F7=3500）', async () => {
    const ws = xs.__captured.wb.Sheets['年度汇总'];
    assert.strictEqual(ws['A6'].v, '年度总收入');
    assert.strictEqual(ws['B6'].v, 1200);
    assert.strictEqual(ws['D6'].v, 76730);
    assert.strictEqual(ws['F6'].v, -75530);
    assert.strictEqual(ws['B7'].v, '2 笔');
    assert.strictEqual(ws['F7'].v, 3500);
  });
  await t('exportFinanceXlsx: Sheet2 9 月行（A12=9月 E12=1000 F12=76680 G12=-75680 I12=部分 1/2）', async () => {
    const ws = xs.__captured.wb.Sheets['月度对账'];
    assert.strictEqual(ws['A3'].v, '月份');
    assert.strictEqual(ws['A12'].v, '9月');
    assert.strictEqual(ws['E12'].v, 1000);
    assert.strictEqual(ws['F12'].v, 76680);
    assert.strictEqual(ws['G12'].v, -75680);
    assert.strictEqual(ws['I12'].v, '部分 1/2');
    assert.strictEqual(ws['I4'].v, '已对账');   // 1 月 1/1
    assert.strictEqual(ws['I5'].v, '无发生');   // 2 月
  });
  await t('exportFinanceXlsx: Sheet2 年度合计行（A16 E16=1200 H16=2/3 I16=部分对账）', async () => {
    const ws = xs.__captured.wb.Sheets['月度对账'];
    assert.strictEqual(ws['A16'].v, '年度合计');
    assert.strictEqual(ws['E16'].v, 1200);
    assert.strictEqual(ws['F16'].v, 76730);
    assert.strictEqual(ws['G16'].v, -75530);
    assert.strictEqual(ws['H16'].v, '2/3');
    assert.strictEqual(ws['I16'].v, '部分对账');
  });
  await t('exportFinanceXlsx: Sheet3 流水正序 + 中文映射 + 合计行', async () => {
    const ws = xs.__captured.wb.Sheets['流水明细'];
    assert.strictEqual(ws['A3'].v, '日期');
    assert.strictEqual(ws['A4'].v, '2026-01-15'); // C1 最早
    assert.strictEqual(ws['A5'].v, '2026-09-07');
    assert.strictEqual(ws['A6'].v, '2026-09-08');
    assert.strictEqual(ws['C5'].v, '付款');        // voucherType 中文映射
    assert.strictEqual(ws['H5'].v, 76680);
    assert.strictEqual(ws['K4'].v, '已对账');
    assert.strictEqual(ws['K5'].v, '未对账');
    assert.strictEqual(ws['A7'].v, '合计');
    assert.strictEqual(ws['G7'].v, 1200);
    assert.strictEqual(ws['H7'].v, 76730);
    assert.strictEqual(ws['I7'].v, '净额 -¥75,530.00');
  });
  await t('exportFinanceXlsx: 成功后 toast 提示包含 3 个工作表说明', async () => {
    const ok = sbX.__toasts.find(x => x.type === 'success');
    assert(ok, '未出现 success 提示');
    assert(ok.msg.indexOf('3 个工作表') >= 0);
  });

  /* ===== 6. CSV 兜底（无 XLSX） ===== */
  const sbC = makeSandbox(FIX); // 不注入 XLSX
  await t('exportFinanceXlsx: XLSX 缺失时 warning + 降级 CSV', async () => {
    await sbC.exportFinanceXlsx(2026);
    assert.strictEqual(sbC.__toasts[0].type, 'warning');
    // 源码中 _finExportCsv 未 await（fire-and-forget），等微任务队列排空
    await new Promise(r => setImmediate(r));
    assert(sbC.__lastBlob, '未生成 CSV Blob');
    assert.strictEqual(sbC.__lastA.download, '秦安秦剧团_财务流水明细_2026.csv');
  });
  await t('_finExportCsv: 带 BOM、表头 + 3 行流水、逗号/引号正确转义', async () => {
    await sbC._finExportCsv(2026);
    const txt = sbC.__lastBlob.parts[0];
    assert.strictEqual(txt.charCodeAt(0), 0xFEFF, '缺少 BOM');
    const lines = txt.slice(1).split('\r\n');
    assert.strictEqual(lines.length, 4); // 表头 + C1/A1/A2
    assert(lines[0].indexOf('凭证号') >= 0 && lines[0].indexOf('对账') >= 0);
    assert(lines[2].indexOf('"工资,含""引号"""') >= 0, 'CSV 转义不正确: ' + lines[2]);
    assert(lines[3].indexOf('1000') >= 0);
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
