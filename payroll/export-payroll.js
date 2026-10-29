/* eslint-disable */
/**
 * export-payroll.js — 独立工资条批量导出（v20261028a）
 * ============================================================
 * 用途：从后端 API 拉取指定结算批次的全部工资条明细，为每个人生成
 *       独立 CSV 工资条（文件名含"姓名+订单名"），并输出全员总表。
 * 口径：
 *   - 出勤天数 = 明细 attDays（当前批次为 6 天，计薪 = 日工资 × 6）
 *   - 项目金额明细 = 计薪工资（按 orderBreakdown 拆分到订单/项目）
 *       + 差旅路费（travelExpenseTotal，计入 transportAllowance）
 *       + 其他补贴（夜场/餐补/满勤/绩效/主角/配角/其他）
 *       + 未关联订单收入差额（baseSalary - ΣbaseShare，如有）
 *   - 扣款明细 = 请假/旷工/迟到/早退/装卸车缺席/借款/社保/公积金/税 等
 *   - 收入小计（应发）= grossPay；扣款小计 = totalDeduction；实发 = netPay
 * 运行：node payroll/export-payroll.js [--month=2026-10] [--batch=WB-xxx]
 * 输出：payroll/<month>/工资条_<工号>_<姓名>_<订单名>_<month>.csv + 工资条总表
 * ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '1.14.106.173';
const PORT = 80;
const USERNAME = 'admin';
const PASSWORD = process.env.QAXQJT_ADMIN_PASS || (() => { console.error('缺少环境变量 QAXQJT_ADMIN_PASS（后台管理员密码）'); process.exit(1); })();
const ROUND = 2;
const n2 = v => Math.round((Number(v) || 0) * 100) / 100;
const eq = (a, b) => Math.abs(n2(a) - n2(b)) <= 0.01;

function req(pathname, method, body, token) {
  return new Promise((res, rej) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const q = http.request({ hostname: HOST, port: PORT, path: pathname, method, headers }, x => {
      const chunks = [];
      x.on('data', c => chunks.push(c));
      x.on('end', () => {
        const d = Buffer.concat(chunks).toString('utf8'); // Buffer 拼接避免 UTF-8 多字节跨 chunk 截断
        let j = null;
        try { j = JSON.parse(d); } catch (_) { /* 非 JSON */ }
        res({ code: x.statusCode, body: d, json: j });
      });
    });
    q.on('error', rej);
    q.setTimeout(20000, () => q.destroy(new Error('timeout: ' + pathname)));
    if (body) q.write(JSON.stringify(body));
    q.end();
  });
}

/** 解析 orderBreakdown（兼容 JSON 字符串与已解析对象；兼容顶层数组与 {orders:{}} 映射） */
function parseOB(raw) {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw || 'null') : raw;
    if (!o) return [];
    if (Array.isArray(o)) return o;
    if (o.orders && typeof o.orders === 'object') return Object.values(o.orders);
    return [];
  } catch (_) { return []; }
}

function parseNote(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch (_) { return {}; }
}

/** CSV 单元格转义 */
function esc(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** 写带 BOM 的 CSV（保证 Excel 直接打开中文不乱码） */
function writeCsvBom(file, rows) {
  const content = rows.map(r => r.map(esc).join(',')).join('\r\n');
  fs.writeFileSync(file, '\uFEFF' + content, 'utf8');
}

async function main() {
  const argv = process.argv.slice(2);
  const argOf = k => (argv.find(a => a.startsWith('--' + k + '=') || a.startsWith('-' + k + '=') || a.startsWith(k + '=') || a === '--' + k || a === '-' + k) || '');
  let month = '';
  let batchNoFilter = '';
  for (const a of argv) {
    const m = a.match(/^(?:--)?(?:month|batch|out)=(.+)$/);
    if (!m) continue;
    if (/month/.test(a)) month = m[1];
    if (/batch/.test(a)) batchNoFilter = m[1];
  }
  if (!month) month = new Date().toISOString().slice(0, 7);

  // 1) 登录
  const lg = await req('/api/v1/auth/login', 'POST', { username: USERNAME, password: PASSWORD, captcha: '' });
  if (lg.code !== 200 || !(lg.json && lg.json.data && lg.json.data.accessToken)) throw new Error('登录失败 HTTP ' + lg.code);
  const tok = lg.json.data.accessToken;

  // 2) 找目标批次（status=draft 优先，其次最新）
  const bl = await req('/api/v1/wage-batches?page=1&pageSize=50', 'GET', null, tok);
  if (bl.code !== 200) throw new Error('批次列表失败 HTTP ' + bl.code);
  const bd = bl.json.data;
  const batches = Array.isArray(bd) ? bd : bd.list || [];
  let batch = batches.find(b => b.wageMonth === month && b.status === 'draft')
    || batches.find(b => b.wageMonth === month)
    || (batchNoFilter ? batches.find(b => b.batchNo === batchNoFilter) : null)
    || batches[0];
  if (!batch) throw new Error('未找到结算批次');
  const bid = batch.id;
  console.log('[批次] ' + batch.batchNo + ' 期间=' + JSON.stringify(batch.settlePeriod) + ' 状态=' + batch.status);

  // 3) 拉取明细
  const wl = await req('/api/v1/wages?batchId=' + bid + '&page=1&pageSize=500', 'GET', null, tok);
  if (wl.code !== 200) throw new Error('工资明细拉取失败 HTTP ' + wl.code);
  const wd = wl.json.data;
  const items = Array.isArray(wd) ? wd : wd.list || [];
  console.log('[明细] 共 ' + items.length + ' 条');

  // 4) 订单名缓存（订单 organization 优先，其次 customerName，最后 orderNo）
  const orderCache = {};
  const needOrders = [...new Set(items.flatMap(x => parseOB(x.orderBreakdown).map(o => o.orderId || o.id)).filter(Boolean))];
  for (const oid of needOrders) {
    const r = await req('/api/v1/orders/' + oid, 'GET', null, tok);
    if (r.code === 200 && r.json && r.json.data) {
      const o = r.json.data;
      orderCache[oid] = {
        orderNo: o.orderNo || '',
        name: (o.organization || '').trim() || (o.customerName || '').trim() || o.orderNo || oid,
        customerName: o.customerName || '',
        venue: o.venueFullAddress || ''
      };
    } else {
      orderCache[oid] = { orderNo: '', name: '订单' + oid, customerName: '', venue: '' };
    }
  }

  // 5) 逐条构建工资条
  const outDir = path.join(__dirname, month);
  fs.mkdirSync(outDir, { recursive: true });
  const smoke = { batch: batch.batchNo, month, itemCount: items.length, people: 0, attAllSix: true, perPerson: [], issues: [], files: [], totals: { base: 0, allowance: 0, gross: 0, ded: 0, net: 0 } };

  // 收入/扣款项目拆分（通用口径）
  const incomeRows = x => {
    const rows = [];
    const ob = parseOB(x.orderBreakdown);
    let obSum = 0;
    const dayRate = n2(x.dailyRate);
    const att = n2(x.attDays);
    ob.forEach(o => {
      const info = orderCache[o.orderId || o.id] || { name: '订单' + (o.orderId || '') };
      const share = n2(o.baseShare);
      obSum += share;
      rows.push({ item: '演出计薪工资·' + info.name, amount: share, note: (dayRate ? '日工资¥' + dayRate : '') + '×' + att + '天（演出' + n2(o.showDays || o.workDays || att) + '天）' });
    });
    const base = n2(x.baseSalary);
    if (ob.length && !eq(obSum, base)) {
      const diff = n2(base - obSum);
      if (diff > 0.005) rows.push({ item: '其他计薪收入（未关联订单）', amount: diff, note: '底薪' + base + '与订单拆分合计' + n2(obSum) + '差额' });
      else if (diff < -0.005) rows.push({ item: '订单拆分超底薪调整', amount: diff, note: '订单拆分合计超出底薪' });
    }
    if (!ob.length && base > 0.005) rows.push({ item: '计薪工资（未拆分订单）', amount: base, note: dayRate ? '日工资¥' + dayRate + '×' + att + '天' : '' });
    const teT = n2(x.travelExpenseTotal);
    const tr = n2(x.transportAllowance);
    if (tr > 0.005) {
      const other = n2(tr - teT);
      rows.push({ item: '差旅路费', amount: teT, note: (x.travelExpenseCount || 0) + '笔' });
      if (other > 0.005) rows.push({ item: '其他交通补贴', amount: other, note: '' });
    }
    const others = [
      ['夜场补贴', n2(x.nightSubsidy), n2(x.nights) + '场'],
      ['餐费补贴', n2(x.mealAllowance), ''],
      ['节日福利', n2(x.holidayBonus), ''],
      ['满勤奖', n2(x.fullBonus), ''],
      ['绩效奖金', n2(x.performanceBonus), ''],
      ['主角津贴', n2(x.chiefRoleTotal), ''],
      ['配角津贴', n2(x.supportingRoleTotal), ''],
      ['其他补贴', n2(x.otherAllowance), String(x.otherAllowanceNote || '')]
    ];
    others.forEach(([k, v, note]) => { if (v > 0.005) rows.push({ item: k, amount: v, note }); });
    return rows;
  };

  const deductRows = x => {
    const rows = [];
    const note = parseNote(x.otherDeductionNote);
    const dd = [
      ['请假扣款', n2(x.leaveDeduction)],
      ['旷工扣款', n2(x.absentDeduction)],
      ['迟到扣款', n2(x.lateDeduction)],
      ['早退扣款', n2(x.earlyDeduction)],
      ['装卸车缺席扣款', n2(note.loadUnloadDeduction)],
      ['借款抵扣', n2(note.loanDeduction || note.loan)],
      ['社保扣款', n2(x.socialSecurity)],
      ['公积金扣款', n2(x.housingFund)],
      ['个税', n2(x.tax)],
      ['其他扣款', n2(x.otherDeduction) - n2(note.loadUnloadDeduction) - n2(note.loanDeduction || note.loan)]
    ];
    dd.forEach(([k, v]) => { if (v > 0.005) rows.push({ item: k, amount: v, note: k === '装卸车缺席扣款' && note.loadUnloadAbsentCount ? '缺席' + note.loadUnloadAbsentCount + '次×¥' + n2(note.loadUnloadUnitPrice) : '' }); });
    return rows;
  };

  const perMap = new Map();
  for (const x of items) {
    const att = n2(x.attDays);
    if (att !== 6) smoke.attAllSix = false;
    const inc = incomeRows(x);
    const ded = deductRows(x);
    const incSum = n2(inc.reduce((s, r) => s + r.amount, 0));
    const dedSum = n2(ded.reduce((s, r) => s + r.amount, 0));
    const gross = n2(x.grossPay);
    const tded = n2(x.totalDeduction);
    const net = n2(x.netPay);
    const key = x.performerId || x.id;
    if (!perMap.has(key)) perMap.set(key, { name: x.name, staffNo: x.staffNo, rows: [] });
    perMap.get(key).rows.push({ x, inc, ded, incSum, dedSum, gross, tded, net, att });

    // 校验：收入项之和 = 应发；应发-扣款 = 实发
    if (!eq(incSum, gross)) smoke.issues.push(x.staffNo + ' ' + x.name + ' 收入项合计' + incSum + '≠应发' + gross);
    if (!eq(dedSum, tded)) smoke.issues.push(x.staffNo + ' ' + x.name + ' 扣款项合计' + dedSum + '≠扣款合计' + tded);
    if (!eq(gross - tded, net)) smoke.issues.push(x.staffNo + ' ' + x.name + ' 应发' + gross + '-扣款' + tded + '≠实发' + net);
    smoke.totals.base += n2(x.baseSalary);
    smoke.totals.allowance += n2(x.transportAllowance) + n2(x.nightSubsidy) + n2(x.mealAllowance) + n2(x.holidayBonus) + n2(x.fullBonus) + n2(x.performanceBonus) + n2(x.chiefRoleTotal) + n2(x.supportingRoleTotal) + n2(x.otherAllowance);
    smoke.totals.gross += gross;
    smoke.totals.ded += tded;
    smoke.totals.net += net;
  }
  smoke.people = perMap.size;
  if (perMap.size !== items.length) smoke.issues.push('人数(' + perMap.size + ')与明细数(' + items.length + ')不一致（存在一人多条）');

  // 6) 每人生成独立 CSV（一人多条时合并为一份，分块列出）
  const period = batch.settlePeriod || {};
  const periodStr = (period.start || '').slice(0, 10) + ' ~ ' + (period.end || '').slice(0, 10);
  const master = [['工号', '姓名', '订单/项目', '出勤天数', '日工资(元/天)', '计薪工资(元)', '差旅路费(元)', '其他补贴(元)', '应发合计(元)', '扣款合计(元)', '实发合计(元)']];
  for (const [, p] of perMap) {
    const orderNames = [...new Set(p.rows.flatMap(r => parseOB(r.x.orderBreakdown).map(o => (orderCache[o.orderId || o.id] || {}).name).filter(Boolean)))];
    const orderLabel = orderNames.length ? orderNames.join('+') : '未关联订单';
    const fname = '工资条_' + (p.staffNo || '') + '_' + p.name + '_' + orderLabel + '_' + month + '.csv';
    const fpath = path.join(outDir, fname);
    const lines = [];
    lines.push(['秦安县秦剧团 工资条']);
    lines.push(['结算批次', batch.batchNo]);
    lines.push(['姓名', p.name]);
    lines.push(['工号', p.staffNo || '']);
    lines.push(['订单/项目', orderLabel + (orderNames.length ? '' : '')]);
    lines.push(['结算周期', periodStr]);
    const attList = [...new Set(p.rows.map(r => r.att))];
    lines.push(['出勤天数', attList.join('/') + ' 天']);
    const rateList = [...new Set(p.rows.map(r => n2(r.x.dailyRate)).filter(v => v > 0))];
    if (rateList.length) lines.push(['日工资标准', rateList.join('/') + ' 元/天']);
    let pg = 0, pd = 0, pn = 0;
    p.rows.forEach((r, i) => {
      if (p.rows.length > 1) lines.push(['—— 明细 ' + (i + 1) + ' ——']);
      lines.push(['【收入项目】']);
      lines.push(['项目', '金额（元）', '备注']);
      r.inc.forEach(row => lines.push([row.item, n2(row.amount).toFixed(2), row.note || '']));
      lines.push(['收入小计（应发）', r.gross.toFixed(2), '']);
      if (r.ded.length) {
        lines.push(['【扣款项目】']);
        lines.push(['项目', '金额（元）', '备注']);
        r.ded.forEach(row => lines.push([row.item, n2(row.amount).toFixed(2), row.note || '']));
      } else {
        lines.push(['【扣款项目】']);
        lines.push(['无', 0, '']);
      }
      lines.push(['扣款小计', r.tded.toFixed(2), '']);
      lines.push(['【合计】']);
      lines.push(['应发合计', r.gross.toFixed(2), '']);
      lines.push(['扣款合计', r.tded.toFixed(2), '']);
      lines.push(['实发合计', r.net.toFixed(2), '']);
      lines.push(['备注', String(r.x.remark || '').replace(/\r?\n/g, ' ')]);
      pg += r.gross; pd += r.tded; pn += r.net;
    });
    if (p.rows.length > 1) {
      lines.push(['—— 个人汇总 ——']);
      lines.push(['应发合计', n2(pg).toFixed(2), '']);
      lines.push(['扣款合计', n2(pd).toFixed(2), '']);
      lines.push(['实发合计', n2(pn).toFixed(2), '']);
    }
    writeCsvBom(fpath, lines);
    smoke.files.push(fname);
    smoke.perPerson.push({ staffNo: p.staffNo, name: p.name, order: orderLabel, att: attList.join('/'), incomeSum: n2(p.rows.reduce((s, r) => s + r.incSum, 0)), gross: n2(pg), ded: n2(pd), net: n2(pn) });

    // 总表行（按明细逐条）
    p.rows.forEach(r => {
      const ob = parseOB(r.x.orderBreakdown);
      const otherAllow = n2(r.x.transportAllowance) - n2(r.x.travelExpenseTotal) + n2(r.x.nightSubsidy) + n2(r.x.mealAllowance) + n2(r.x.holidayBonus) + n2(r.x.fullBonus) + n2(r.x.performanceBonus) + n2(r.x.chiefRoleTotal) + n2(r.x.supportingRoleTotal) + n2(r.x.otherAllowance);
      master.push([p.staffNo || '', p.name, orderLabel, r.att, n2(r.x.dailyRate), n2(r.x.baseSalary), n2(r.x.travelExpenseTotal), n2(otherAllow), r.gross, r.tded, r.net]);
    });
  }

  // 7) 总表
  const masterFile = path.join(outDir, '工资条总表_' + month + '.csv');
  writeCsvBom(masterFile, master);
  smoke.files.push(path.basename(masterFile));

  // 8) 文件可读回校验（BOM + 无坏值）
  for (const f of smoke.files) {
    const fp = path.join(outDir, f);
    const txt = fs.readFileSync(fp, 'utf8');
    if (!txt.startsWith('\uFEFF')) smoke.issues.push(f + ' 缺少 UTF-8 BOM');
    if (/(^|[,\n])undefined($|[,\n])|NaN|null/.test(txt.replace(/\uFEFF/g, ''))) smoke.issues.push(f + ' 含 undefined/NaN/null 值');
    if (txt.includes('\uFFFD')) smoke.issues.push(f + ' 含乱码字符（UTF-8 截断）');
    const lineCnt = txt.replace(/\uFEFF/g, '').split('\r\n').filter(Boolean).length;
    if (lineCnt < 10) smoke.issues.push(f + ' 行数异常=' + lineCnt);
  }

  // 9) 全员合计 vs 批次合计
  const batchCheck = {
    totalBaseWage: n2(batch.totalBaseWage), calcBase: n2(smoke.totals.base),
    totalAllowance: n2(batch.totalAllowance), calcAllowance: n2(smoke.totals.allowance),
    totalDeduction: n2(batch.totalDeduction), calcDed: n2(smoke.totals.ded),
    totalNetPay: n2(batch.totalNetPay), calcNet: n2(smoke.totals.net)
  };
  if (!eq(batchCheck.totalBaseWage, batchCheck.calcBase)) smoke.issues.push('全员计薪工资 ' + batchCheck.calcBase + ' ≠ 批次 totalBaseWage ' + batchCheck.totalBaseWage);
  if (!eq(batchCheck.totalNetPay, batchCheck.calcNet)) smoke.issues.push('全员实发 ' + batchCheck.calcNet + ' ≠ 批次 totalNetPay ' + batchCheck.totalNetPay);
  if (!eq(batchCheck.totalDeduction, batchCheck.calcDed)) smoke.issues.push('全员扣款 ' + batchCheck.calcDed + ' ≠ 批次 totalDeduction ' + batchCheck.totalDeduction);

  // 10) 冒烟报告
  smoke.batchCheck = batchCheck;
  smoke.pass = smoke.issues.length === 0 && smoke.itemCount === 33 && smoke.people === 33 && smoke.attAllSix;
  fs.writeFileSync(path.join(outDir, '_冒烟测试报告.json'), JSON.stringify(smoke, null, 2), 'utf8');
  console.log('[人员] ' + smoke.people + ' 人 / 明细 ' + smoke.itemCount + ' 条 / 出勤全=6: ' + smoke.attAllSix);
  console.log('[核对] base=' + batchCheck.calcBase + '/' + batchCheck.totalBaseWage + ' allowance=' + batchCheck.calcAllowance + '/' + batchCheck.totalAllowance + ' ded=' + batchCheck.calcDed + '/' + batchCheck.totalDeduction + ' net=' + batchCheck.calcNet + '/' + batchCheck.totalNetPay);
  console.log('[文件] ' + smoke.files.length + ' 个 → ' + outDir);
  console.log('[冒烟] ' + (smoke.pass ? 'PASS ✓' : 'FAIL ✗'));
  if (smoke.issues.length) { console.log('[问题]'); smoke.issues.forEach(i => console.log('  - ' + i)); }
  return smoke;
}

main().then(s => {
  console.log('DONE pass=' + s.pass);
  process.exit(s.pass ? 0 : 2);
}).catch(e => { console.error('FATAL ' + (e && e.message)); process.exit(9); });
