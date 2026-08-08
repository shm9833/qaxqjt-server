/**
 * ================================================================
 *  批量把 v20260804-2 新模板（JSON Perf + 防重复注入保护）同步到
 *  42 个 admin + 部署类页面，替换旧的 DeadButtonFallback/SuperPatch 注入块
 *  运行：node _tests\_apply_new_template.js
 * ================================================================
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_FILE = path.join(__dirname, '_template_DBF_SP_new.txt');
const OFFICIAL_TEMPLATE = path.join(ROOT, '通用复制模板_DeadButtonFallback_SuperPatch_v20260804.txt');

// ---------- 1. 读取新模板中两个 script 块 ----------
const fullTpl = fs.readFileSync(TEMPLATE_FILE, 'utf-8');
// 提取：从 "<!-- 🔧 E块死按钮兜底" 注释开始，到 "<!-- 🔚 按钮兜底双脚本块 结束 -->" 结束
const START_RE = /<!--\s*🔧\s*E块死按钮兜底[^\n]*?-->/i;
const END_RE   = /<!--\s*🔚\s*按钮兜底双脚本块\s*结束.*?-->/i;
const sIdx = START_RE.exec(fullTpl);
const eIdx = END_RE.exec(fullTpl);
if (!sIdx || !eIdx) { console.error('❌ 新模板提取失败：未找到起始/结束标记', {s:!!sIdx,e:!!eIdx}); process.exit(1); }
const NEW_BLOCK = '\r\n' + fullTpl.slice(sIdx.index, eIdx.index + eIdx[0].length).replace(/\r?\n/g, '\r\n').replace(/\r?\n?$/, '\r\n');
console.log(`[ℹ️] 新注入块长度：${NEW_BLOCK.length} 字符`);

// ---------- 1.5 同步覆盖官方通用模板原文件 ----------
// 官方模板文件 = 新模板全文（替换版本号等）
fs.writeFileSync(OFFICIAL_TEMPLATE, fullTpl.replace(/\r?\n/g, '\r\n'), 'utf-8');
console.log('[✅] 已同步覆盖官方通用模板原文件：' + path.relative(ROOT, OFFICIAL_TEMPLATE));

// ---------- 2. 找出所有 admin / deploy 类 HTML ----------
const htmlFiles = [];
function walk(dir){
  const list = fs.readdirSync(dir);
  for(const f of list){
    const full = path.join(dir, f);
    const st = fs.statSync(full);
    if(st.isDirectory()) walk(full);
    else if(f.toLowerCase().endsWith('.html')) htmlFiles.push(full);
  }
}
walk(ROOT);
const targetFiles = htmlFiles.filter(f=>{
  const rel = path.relative(ROOT, f).replace(/\\/g,'/');
  return rel.startsWith('admin/') || rel.startsWith('deploy-')
      || rel.includes('deploy') || rel.includes('vercel')
      || rel.includes('netlify') || rel.includes('cloudflare')
      || rel.includes('surgio') || rel.includes('qinglong')
      || rel.startsWith('status-') || rel.startsWith('upgrade-')
      || rel.startsWith('backup-') || rel.startsWith('repair-');
});
console.log(`[ℹ️] 候选页面数：${targetFiles.length}`);

// ---------- 3. 逐个页面替换 ----------
// 旧注入块起始/结束特征（兼容多种写法）
const OLD_START_MARKERS = [
  /<!--\s*🔧\s*E块死按钮兜底/i,
  /<script[\s\S]*?DeadButtonFallback/i,
  /<!--\s*E块死按钮兜底/i
];
const OLD_END_MARKERS = [
  /<!--\s*🔚\s*按钮兜底双脚本块\s*结束.*?-->/i,
  /按钮兜底双脚本块\s*结束/i,
  /<script id="adminSuperPatchV20260730">[\s\S]*?<\/script>\s*(?:<!--[^]*?-->)?\s*$/i
];

let updated = 0, skipped = 0, missed = [];
for (const file of targetFiles) {
  let content = fs.readFileSync(file, 'utf-8');
  const original = content;

  // 定位结束位置：优先找 "🔚 按钮兜底双脚本块 结束" HTML注释
  let endIdx = -1;
  for (const re of [/<!--\s*🔚\s*按钮兜底双脚本块\s*结束[^>]*?-->/i,
                    /<script id="adminSuperPatchV20260730">[\s\S]*?<\/script>\s*(?:<!--[\s\S]*?-->)?\s*(?=<\/body>)/i]) {
    const m2 = re.exec(content);
    if (m2) { endIdx = m2.index + m2[0].length; break; }
  }
  if (endIdx < 0) { missed.push(file + ' (找不到结束标记)'); skipped++; continue; }

  // 定位起始位置：在 endIdx 之前 最近的 "🔧 E块死按钮兜底" 注释
  const before = content.slice(0, endIdx);
  const startRes = [/<!--\s*🔧\s*E块死按钮兜底[^\n]*?-->/i,
                    /<!--\s*E块死按钮兜底/i,
                    /<!--\s*🔧/i];
  let startIdx = -1;
  for (const re of startRes) {
    let found;
    let pos = -1;
    const mm = before.match(re);
    if (mm) pos = mm.index;
    if (pos >= 0 && (startIdx < 0 || pos < startIdx)) startIdx = pos;
  }
  if (startIdx < 0) { missed.push(file + ' (找不到起始标记)'); skipped++; continue; }

  // 执行替换
  content = content.slice(0, startIdx) + NEW_BLOCK + content.slice(endIdx);
  if (content !== original) {
    fs.writeFileSync(file, content, 'utf-8');
    updated++;
    // 快速验证：新标记是否出现
    if (!content.includes('__DBF_V20260804_INJECTED__')) console.warn('  ⚠️ ' + path.relative(ROOT,file) + ' 替换后缺少 DBF 标记');
    if (!content.includes('JSON.stringify(payload)')) console.warn('  ⚠️ ' + path.relative(ROOT,file) + ' 替换后缺少 JSON Perf');
  } else {
    skipped++;
  }
}

console.log(`\n==== 替换完成 ====`);
console.log(`  ✅ 已更新：${updated} 个页面`);
console.log(`  ⏭  跳过：${skipped} 个（含：未注入/格式不匹配）`);
if (missed.length) {
  console.log(`\n  ❌ 未匹配（${missed.length}）：`);
  missed.slice(0,10).forEach(m=>console.log('    · '+m));
  if (missed.length>10) console.log(`    ... 其余 ${missed.length-10} 个略`);
}
process.exit(missed.length && updated===0 ? 1 : 0);
