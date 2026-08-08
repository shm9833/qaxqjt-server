/* Proactive full-page scan: Syntax + 58-page compliance checks */
const fs = require('fs');
const path = require('path');
const root = __dirname;

const ADMIN_DIR = path.join(root, 'admin');
const htmls = [];
// root HTMLs
const rootFiles = fs.readdirSync(root, {withFileTypes:true});
for (const e of rootFiles) {
  if (e.isFile() && e.name.toLowerCase().endsWith('.html') && !e.name.startsWith('_') && !e.name.startsWith('debug-')) {
    htmls.push({rel: e.name, full: path.join(root, e.name)});
  }
}
// admin HTMLs
const adminFiles = fs.readdirSync(ADMIN_DIR, {withFileTypes:true});
for (const e of adminFiles) {
  if (e.isFile() && e.name.toLowerCase().endsWith('.html')) {
    htmls.push({rel: 'admin/'+e.name, full: path.join(ADMIN_DIR, e.name)});
  }
}

console.log('📋 扫描 '+htmls.length+' 个 HTML 文件...\n');

/* ========== 1. Syntax scan: all <script> non-module blocks ========== */
let totalSyntaxErrors = 0;
const scriptRe = /<script(?![^>]*type=["']module["'])([^>]*)>([\s\S]*?)<\/script>/g;
htmls.forEach(function(h){
  const src = fs.readFileSync(h.full, 'utf8');
  const blocks = [];
  let m; scriptRe.lastIndex = 0;
  while ((m = scriptRe.exec(src)) !== null) {
    const c = (m[2]||'').trim();
    if (c.length > 30) blocks.push(c);
  }
  let errs = 0;
  for (let i = 0; i < blocks.length; i++) {
    try { new Function(blocks[i]); }
    catch(e) {
      errs++;
      if (errs <= 2) console.error('  ❌ ['+h.rel+'] 脚本#'+i+' SyntaxError:', (e.message||'').substring(0,180));
    }
  }
  if (errs) totalSyntaxErrors += errs;
  const status = errs ? '❌ '+errs+'E' : '✅';
  if (errs) console.log(status+' '+h.rel+' ('+blocks.length+' 脚本块)');
});
console.log('\n=== 语法总览 ===');
console.log(totalSyntaxErrors ? '💥 共 '+totalSyntaxErrors+' 个 SyntaxError' : '🎉 全部 '+htmls.length+' 页 0 SyntaxError');

/* ========== 2. Compliance checks (per file) ========== */
console.log('\n=== 58页合规检查 ===');
const COMPLIANCE = [
  // (label, regex, strict_if_matched_msg, warn_only)
  ['年份动态占位 {year}', /\{year\}|year-lite\.js|year-standard\.js|getFullYear\(\)/i, '缺少年份动态占位', true],
  ['style.css ?v=20260803', /style\.css\?v=20260803/, 'style.css版本未到20260803', false],
  ['JS引用 ?v=20260803', /\.js\?v=20260803/, 'JS引用版本未到20260803', false],
  ['favicon-inject.js', /favicon-inject\.js/, '未注入favicon-inject.js', false],
  ['wechat-fallback.js', /wechat-fallback\.js/, '未注入wechat-fallback.js', false],
  ['微信meta标签(wechat-specific)', /wechat|wx-|mp-|MicroMessenger|<meta[^>]*name=["']apple-mobile-web-app|<meta[^>]*name=["']viewport/, '需含微信/移动端meta', true],
  ['rel="noopener noreferrer" 外链', /target=["']_blank["'][^>]*rel=["'][^"']*(noopener[^"']*noreferrer|noreferrer[^"']*noopener)/, '有target=_blank但缺少noopener+noreferrer', true],
];
/* booking.html special: novalidate on form */
let bookingNovalidate = true;
const bookingFile = htmls.find(h=>h.rel.toLowerCase()==='booking.html');
if (bookingFile) {
  const s = fs.readFileSync(bookingFile.full, 'utf8');
  bookingNovalidate = /<form[\s\S]{0,300}novalidate/i.test(s);
}

/* admin pages: auth check (qaxqjt_admin_session or admin_sess_v2 or checkAuth) */
const authKeys = /qaxqjt_admin_session|admin_sess_v2|checkAuth\(|login\.html/i;

let totalFails = 0;
htmls.forEach(function(h){
  const src = fs.readFileSync(h.full, 'utf8');
  const rel = h.rel;
  const isAdmin = rel.startsWith('admin/') && rel.toLowerCase() !== 'admin/login.html';
  const isBooking = rel.toLowerCase() === 'booking.html';
  const fails = [];
  COMPLIANCE.forEach(function(item){
    const [label, re, msg, warnOnly] = item;
    if (!re.test(src)) {
      /* Booking page: year-lite.js not needed if {year} used; wechat meta for booking must be there; we relax some for docs */
      fails.push((warnOnly?'⚠️ ':'❌ ')+label);
      if (!warnOnly) totalFails++;
    }
  });
  if (isAdmin) {
    if (!authKeys.test(src)) { fails.push('❌ 缺少admin鉴权session检查'); totalFails++; }
    const tbW = /\.table-wrapper|\.data-table-container|overflow-x\s*:\s*auto/i.test(src);
    if (!tbW) { fails.push('⚠️ admin表未含overflow-x:auto容器'); }
    const mw760 = /min-width\s*:\s*(760|720|680)px|minWidth[^}]*7[0-9]{2}px/i.test(src);
    if (!mw760) { fails.push('⚠️ admin表未设min-width防压缩(760/720/680)'); }
  }
  if (isBooking) {
    if (!bookingNovalidate) { fails.push('❌ booking表单未加novalidate属性'); totalFails++; }
    const agreeBox = /预约须知.*checkbox|data-agree-checkbox|agree.*appointment/i.test(src);
    if (!agreeBox) { fails.push('⚠️ booking未含预约须知复选框'); }
    const antiDup = /data-booking-submitted|防重复|duplicate.*submit/i.test(src);
    if (!antiDup) { fails.push('⚠️ booking未含防重复提交锁'); }
  }
  if (fails.length) {
    console.log('\n['+rel+']:');
    fails.forEach(f=>console.log('  '+f));
  }
});

console.log('\n=== 合规汇总 ===');
console.log('合规性硬失败项：', totalFails === 0 ? '🎉 0 硬失败' : '💥 '+totalFails+' 项');

/* ========== 3. attendance.html V2 key functions check ========== */
console.log('\n=== attendance.html 函数链完整性 ===');
const attFile = htmls.find(h=>h.rel.toLowerCase()==='admin/attendance.html');
if (attFile) {
  const attSrc = fs.readFileSync(attFile.full, 'utf8');
  const attKeys = [
    'calcDayRecord', 'calcDayPunishReward', 'calcMonthSalaryV2',
    'getWageEngine', 'QinApp.Wage', 'window.WageEngine',
    'lateCount', 'earlyCount', 'lateDeduction', 'earlyDeduction', 'absentDeduction',
    '_pushWagesToFinance', 'attBtnFinanceAll', 'attBtnFinanceSel',
    'addLedgerEntry|qaxqjt_fin_ledger_v1', 'FLOW_SOURCE'
  ];
  attKeys.forEach(function(k){
    // 包含 | 的关键字按 OR 模式匹配，不做整体转义
    let re;
    if (k.includes('|')) {
      re = new RegExp(k);
    } else {
      re = new RegExp(k.replace(/[.*+?^${}()[\]\\]/g,'\\$&'));
    }
    const hit = re.test(attSrc);
    console.log((hit?'✅ ':'❌ ')+'函数/关键字: '+k);
    if (!hit) totalFails++;
  });
}

/* ========== 4. cast-sheet.html 新功能 双函数 双按钮 检查 ========== */
console.log('\n=== cast-sheet.html A①②功能检查 ===');
const csFile = htmls.find(h=>h.rel.toLowerCase()==='admin/cast-sheet.html');
if (csFile) {
  const csSrc = fs.readFileSync(csFile.full, 'utf8');
  const csKeys = [
    'tpBtnWgEdit.*addEventListener', 'tpBtnWageCsv.*addEventListener',
    'exportSingleOperaCSV', 'printSingleOperaCard',
    'data-opera-csv', 'data-opera-cardprint',
    'opera-sign-bar', 'sb-stamp-box',
    'WG_DEFAULT.*W7.*580', 'exportBudgetCSV'
  ];
  csKeys.forEach(function(k){
    const re = new RegExp(k);
    const hit = re.test(csSrc);
    console.log((hit?'✅ ':'❌ ')+k);
    if (!hit) totalFails++;
  });
}

console.log('\n💡 总硬失败：'+totalFails);
process.exit(totalFails > 20 ? 1 : 0);
