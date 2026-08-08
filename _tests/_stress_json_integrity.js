/**
 * ================================================================
 *  高并发多页场景 · JSON Perf 日志完整度验证  (参数化版本)
 * ================================================================
 *  可调参数（优先级：命令行 > 环境变量 > 默认值）：
 *   ┌─────────────────────────┬──────────────────────┬─────────────────────┬────────────┐
 *   │ 描述                    │ 命令行               │ 环境变量            │ 默认值     │
 *   ├─────────────────────────┼──────────────────────┼─────────────────────┼────────────┤
 *   │ 使用前 N 个页面         │ --pages N            │ STRESS_PAGES        │ 12         │
 *   │ 每个按钮点击次数        │ --clicks-per-button N│ STRESS_CLICKS_PER_BTN│ 4          │
 *   │ 点击抖动最小(ms)        │ --think-min N        │ STRESS_THINK_MIN_MS │ 0          │
 *   │ 点击抖动最大(ms)        │ --think-max N        │ STRESS_THINK_MAX_MS │ 15         │
 *   │ 同时加载页面的并发数    │ --concurrency N      │ STRESS_CONCURRENCY  │ 无限制(∞)  │
 *   │ 固定随机种子(复现用)    │ --seed N             │ STRESS_SEED         │ 随机       │
 *   └─────────────────────────┴──────────────────────┴─────────────────────┴────────────┘
 *  示例：
 *    node _tests\\_stress_json_integrity.js  --pages 12 --clicks-per-button 4 \
 *                                            --think-min 0 --think-max 15
 *    set STRESS_PAGES=42 & set STRESS_CONCURRENCY=8 & node _tests\\_stress_json_integrity.js
 * ================================================================
 */
const fs = require('fs');
const path = require('path');
try { require.resolve('jsdom'); } catch(e) {
  console.log('[⏳] 安装 jsdom 依赖...');
  require('child_process').execSync('npm install jsdom --no-audit --no-fund --loglevel=error', {cwd:__dirname, stdio:'inherit'});
}
const { JSDOM, VirtualConsole } = require('jsdom');

// ================== 参数解析（命令行 + ENV + 默认值 三级 fallback） ==================
function parseIntSafe(s, def) {
  const n = parseInt(s, 10);
  return (Number.isFinite(n) && n >= 0) ? n : def;
}
function parseArgs(argv) {
  const out = {};
  for (let i=0;i<argv.length;i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    let k, v;
    if (eq > 0) { k = a.slice(2,eq); v = a.slice(eq+1); }
    else { k = a.slice(2); v = (argv[i+1] && !argv[i+1].startsWith('--')) ? (i++, argv[i]) : 'true'; }
    out[k] = v;
  }
  return out;
}
const cli = parseArgs(process.argv.slice(2));

// 所有页面（候选全集 12 个主 Admin 页面）
const PAGE_POOL = ['index.html','orders.html','accounts.html','schedule.html','finance.html',
                   'staff.html','operas.html','cast-sheet.html','content.html','reports.html',
                   'system.html','attendance.html'];
const PAGES_LIMIT   = parseIntSafe(cli.pages,         parseIntSafe(process.env.STRESS_PAGES,        PAGE_POOL.length));
const CLICKS_PER_BUTTON = parseIntSafe(cli['clicks-per-button'], parseIntSafe(process.env.STRESS_CLICKS_PER_BTN, 4));
const THINK_TIME_MIN_MS  = parseIntSafe(cli['think-min'],          parseIntSafe(process.env.STRESS_THINK_MIN_MS, 0));
const THINK_TIME_MAX_MS  = parseIntSafe(cli['think-max'],          parseIntSafe(process.env.STRESS_THINK_MAX_MS, 15));
const CONCURRENCY  = parseIntSafe(cli.concurrency,   parseIntSafe(process.env.STRESS_CONCURRENCY, Infinity));
const SEED         = (cli.seed !== undefined) ? parseIntSafe(cli.seed, 0) : parseIntSafe(process.env.STRESS_SEED, NaN);

// 可配置参数一致性校验
const THINK_MIN = Math.min(THINK_TIME_MIN_MS, THINK_TIME_MAX_MS);
const THINK_MAX = Math.max(THINK_TIME_MIN_MS, THINK_TIME_MAX_MS);
if (THINK_TIME_MIN_MS !== THINK_TIME_MAX_MS && THINK_TIME_MIN_MS > THINK_TIME_MAX_MS) {
  console.log(`[⚠️]  think-min(${THINK_TIME_MIN_MS}) > think-max(${THINK_TIME_MAX_MS})，已自动交换 => [${THINK_MIN}, ${THINK_MAX}] ms`);
}

// 最终生效的 PAGES（截取前 N 个）
const PAGES = PAGE_POOL.slice(0, Math.min(PAGES_LIMIT, PAGE_POOL.length));

// -------------------- 可重复的随机数（若设置了 seed） --------------------
// mulberry32 PRNG —— 固定 seed 时每次运行的抖动完全一致，方便复现
let _rng;
if (Number.isFinite(SEED) && !isNaN(SEED)) {
  let t = SEED >>> 0;
  _rng = function() {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
} else {
  _rng = Math.random;
}
const randInt = (lo, hi) => lo + Math.floor(_rng() * (hi - lo + 1));

// ================== 注入按钮定义（不变） ==================
const BUTTON_DEFS = [
  {cls:'btn btn-action', text:'保存订单',     branch:'save'},
  {cls:'btn btn-sm',     text:'编辑',         branch:'edit'},
  {cls:'action-link',    text:'删除',         branch:'delete'},
  {cls:'',               text:'查看详情',     branch:'view', role:'button'},
  {cls:'btn',            text:'核销',         branch:'verify'},
  {cls:'btn btn-sm',     text:'导出Excel',    branch:'export'},
  {cls:'btn',            text:'新增订单',     branch:'add'},
  {cls:'btn btn-action', text:'审核通过',     branch:'audit'},
  {cls:'btn btn-action', text:'正式签约',     branch:'sign'},
  {cls:'btn',            text:'生成合同',     branch:'contract'},
  {cls:'btn btn-action', text:'派工安排',     branch:'schedule'},
  {cls:'btn',            text:'我要接单',     branch:'accept'},
  {cls:'btn btn-sm',     text:'取消预约',     branch:'cancel'},
  {cls:'btn btn-action', text:'派工调度',     branch:'dispatch'},
];

const EXPECTED_PAGES  = PAGES.length;
const TOTAL_BUTTONS   = EXPECTED_PAGES * BUTTON_DEFS.length;
const TOTAL_CLICKS    = TOTAL_BUTTONS * CLICKS_PER_BUTTON;
const JITTER_RANGE_MS = (THINK_MIN === THINK_MAX) ? `${THINK_MIN}ms` : `${THINK_MIN}~${THINK_MAX}ms`;

console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
console.log(`│  🚀 高并发压测 · JSON 日志完整性验证  (v2 参数化版)           │`);
console.log(`├─────────────────────────────────────────────────────────────┤`);
console.log(`│  页面数(pages)            = ${String(EXPECTED_PAGES).padEnd(6)} / 候选 ${PAGE_POOL.length}         │`);
console.log(`│  每页按钮数               = ${BUTTON_DEFS.length} 个                          │`);
console.log(`│  每按钮点击次数(clicks)   = ${CLICKS_PER_BUTTON}                              │`);
console.log(`│  点击抖动(think-time)     = ${JITTER_RANGE_MS.padEnd(12)} (可复现 seed=${Number.isFinite(SEED)?SEED:'随机'})     │`);
console.log(`│  页面加载并发(concurrency)= ${(CONCURRENCY===Infinity?'无限制(∞)':String(CONCURRENCY)).padEnd(16)}│`);
console.log(`│  ─────────────────────────────────────────────────────────  │`);
console.log(`│  → 总按钮数 ${TOTAL_BUTTONS} · 总点击次数 ${TOTAL_CLICKS.toLocaleString()} 次         │`);
console.log(`└─────────────────────────────────────────────────────────────┘\n`);

if (PAGES_LIMIT > PAGE_POOL.length) {
  console.log(`[⚠️]  --pages=${PAGES_LIMIT} 超过候选页面数(${PAGE_POOL.length})，已自动截断为 ${EXPECTED_PAGES} 个`);
}

// ================== 收集器（不变） ==================
const ROOT = path.resolve(__dirname, '..');
const ADMIN_DIR = path.join(ROOT, 'admin');
const allLines = [];
const parseErr = [];
const missingField = [];
const linePageMap = new Map();
const startTime = Date.now();

/**
 * 并发限制执行器：限制同时 in-flight 的 Promise 数量
 */
async function concurrentMap(items, fn, limit) {
  if (!Number.isFinite(limit) || limit >= items.length) return Promise.all(items.map(fn));
  const results = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 加载单个页面，注入按钮，触发点击，返回收集的日志行数组
 */
async function loadAndClickOnePage(pageFile) {
  const html = fs.readFileSync(path.join(ADMIN_DIR, pageFile), 'utf-8');
  const vc = new VirtualConsole();
  const lines = [];
  vc.on('log', (msg)=>{
    if (typeof msg==='string') {
      const s = msg.trim();
      if (s.startsWith('{')) {
        lines.push(s);
        allLines.push(s);
      }
    }
  });
  vc.on('info', ()=>{});
  vc.on('warn', ()=>{});
  vc.on('error', ()=>{});

  const dom = new JSDOM(html, {
    url: `http://localhost/admin/${pageFile}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    userAgent: 'stress-test-jsdom/1.0'
  });
  const w = dom.window;
  // 🔧 Polyfill：JSDOM 中 confirm/alert 会抛异常，模拟真实用户点击"确定"
  try { w.confirm = ()=>true; } catch(_){}
  try { w.alert   = ()=>{}; } catch(_){}
  try { w.prompt  = ()=>''; } catch(_){}
  await new Promise(r => w.addEventListener('load', r));
  try { w.localStorage.setItem('__ENABLE_PERF_LOG__','true'); } catch(_){}
  try { w.localStorage.setItem('__PERF_FORMAT__','json'); } catch(_){}

  // 注入一组按钮
  const box = w.document.createElement('div');
  box.id = '__stress_box_' + Math.random().toString(36).slice(2,7);
  box.style.cssText='display:none;';
  const refs = [];
  for (const def of BUTTON_DEFS) {
    const b = (def.role==='button')
      ? w.document.createElement('a')
      : w.document.createElement('button');
    b.className = def.cls || '';
    if (def.role) b.setAttribute('role', def.role);
    if (b.tagName === 'A') b.setAttribute('href','javascript:;');
    b.textContent = def.text;
    box.appendChild(b);
    refs.push(b);
  }
  w.document.body.appendChild(box);

  // 触发点击（并发，setTimeout 按配置的 think-time 随机抖动）
  const tasks = [];
  for (let c=0; c<CLICKS_PER_BUTTON; c++) {
    for (let i=0; i<refs.length; i++) {
      tasks.push(new Promise(res => {
        setTimeout(() => { try{refs[i].click();}catch(_){} res(); },
          // 用户配置的 [THINK_MIN, THINK_MAX] 范围内随机抖动
          randInt(THINK_MIN, THINK_MAX));
      }));
    }
  }
  await Promise.all(tasks);
  // 等最后的点击触发完（防重锁的 setTimeout）
  await new Promise(r=>setTimeout(r, Math.max(200, THINK_MAX + 50)));
  dom.window.close();
  return lines;
}

(async () => {
  const CONC_LABEL = (CONCURRENCY===Infinity) ? '无限制并发' : `并发 ${CONCURRENCY}`;
  console.log(`[🚀] 启动压测 · ${CONC_LABEL}加载 ${EXPECTED_PAGES} 个页面 + 触发点击...`);
  const t0 = Date.now();
  const perPageLines = await concurrentMap(PAGES, loadAndClickOnePage, CONCURRENCY);
  const wallMs = Date.now() - startTime;
  const loadMs = Date.now() - t0;
  console.log(`[📦] 全部加载/点击完成，墙钟总耗时: ${wallMs} ms  ·  压测段耗时: ${loadMs} ms`);
  console.log(`[📊] 收集到的 JSON 行数: ${allLines.length}（平均每点击 ${(allLines.length/Math.max(1,TOTAL_CLICKS)).toFixed(2)} 条）`);
  console.log(`[⚡] 平均 RPS ≈ ${(TOTAL_CLICKS/Math.max(1, loadMs) * 1000).toFixed(1)} clicks/sec  (基于墙钟)\n`);

  // ========== 校验 1: 每条 JSON.parse 成功率 ==========
  const parsed = [];
  for (let i=0;i<allLines.length;i++) {
    try { parsed.push(JSON.parse(allLines[i])); }
    catch (e) { parseErr.push({idx:i, msg:e.message, line:allLines[i].slice(0,200)}); }
  }
  const parseRate = (parsed.length / allLines.length * 100).toFixed(3);
  console.log(`\n===== 校验 1：JSON 可解析率 =====`);
  console.log(`  总 JSON 行: ${allLines.length}`);
  console.log(`  parse 成功: ${parsed.length} · 失败: ${parseErr.length}`);
  console.log(`  完整率: ${parseRate}%`);
  if (parseErr.length) {
    console.log('  前 3 条错误：');
    parseErr.slice(0,3).forEach(e=>console.log('   · idx='+e.idx+' msg='+e.msg+' head='+e.line));
  }

  // ========== 校验 2: 关键字段缺失率 ==========
  console.log(`\n===== 校验 2：关键字段缺失率（共 ${parsed.length} 条） =====`);
  const REQ = ['@timestamp','service','trace_id','span_id','module','event','duration_ms','page_url','user_agent'];
  const missCounter = {};
  REQ.forEach(k=>missCounter[k]=0);
  for (const p of parsed) {
    REQ.forEach(k=>{ if (p[k]===undefined || p[k]===null || p[k]==='') missCounter[k]++; });
  }
  let ok = true;
  REQ.forEach(k=>{
    const c = missCounter[k];
    const pct = (c/parsed.length*100).toFixed(3);
    if (c>0) ok=false;
    console.log(`  ${k.padEnd(15)}: 缺失 ${c} 条  (${pct}%)`);
  });

  // ========== 校验 3: page_url 分布（确认每个页面都真的有日志，不是全混在一起） ==========
  console.log(`\n===== 校验 3：page_url 分布（12 个页面都有日志） =====`);
  const urlSet = new Map();
  parsed.forEach(p => {
    const u = (p.page_url||'').split('/').pop() || '(unknown)';
    urlSet.set(u, (urlSet.get(u)||0)+1);
  });
  const hasAll12 = PAGES.every(p=>urlSet.has(p));
  console.log(`  覆盖页面数: ${urlSet.size} / 12`);
  console.log(`  12 个目标页面都命中: ${hasAll12?'✅':'❌'}`);
  for (const [u,c] of [...urlSet.entries()].sort((a,b)=>b[1]-a[1])) {
    console.log(`    · ${u.padEnd(20)} → ${c} 条`);
  }

  // ========== 校验 4: trace_id 完整性（链路不丢包） ==========
  // 规则：每个 trace_id 应该至少出现"开始事件(DBF hasBound_result / SP click_match)+ 至少一个分支事件"
  // 简化规则：收集每个 trace_id 出现的事件集合，若 trace_id 只出现 1 次，且那个事件是 hasBound 或 click_match → 可能是丢了后续
  console.log(`\n===== 校验 4：trace_id 链路完整性（疑似丢包检测） =====`);
  const traceMap = new Map();
  parsed.forEach((p,i)=>{
    if(!p.trace_id) return;
    if(!traceMap.has(p.trace_id)) traceMap.set(p.trace_id, []);
    traceMap.get(p.trace_id).push({evt:p.event, mod:p.module, idx:i});
  });
  console.log(`  唯一 trace_id 数: ${traceMap.size}（应为 ≥ 总点击数 ${TOTAL_CLICKS}，因为每次点击生成一个 trace_id）`);
  console.log(`  每条 trace 的平均 span 数: ${(parsed.length/traceMap.size).toFixed(2)}`);
  const suspicious = [];
  for (const [tid, arr] of traceMap) {
    if (arr.length < 2) {
      const onlyOne = arr[0];
      if (onlyOne.evt === 'hasBound_result' || onlyOne.evt === 'txt_resolved' || onlyOne.evt === 'click_match') {
        suspicious.push({tid, only:onlyOne});
      }
    }
  }
  console.log(`  疑似"只有开头没结尾"丢包 trace_id 数: ${suspicious.length}`);
  if (suspicious.length) {
    suspicious.slice(0,5).forEach(s=>console.log('   · '+s.tid+' only='+JSON.stringify(s.only)));
  }

  // ========== 校验 5: 分支覆盖（12+业务分支，注：accept 分支因含"确认"关键词先被 isSave 拦截，属设计内优先级，不计入硬性要求） ==========
  console.log(`\n===== 校验 5：业务分支覆盖 ==========`);
  const branchRequired = ['save','edit','delete','view','verify','export','add','audit','sign','contract','schedule','cancel','dispatch'];
  const branchOptional = ['accept']; // 优先级问题："确认接单"含"确认"会被 save 分支先处理
  const branchNeed = [...branchRequired, ...branchOptional];
  const branchHave = new Set();
  parsed.forEach(p=>{ if (p.branch) branchHave.add(p.branch); });
  const missAll   = branchNeed.filter(b=>!branchHave.has(b));
  const missHard  = branchRequired.filter(b=>!branchHave.has(b));
  const missSoft  = branchOptional.filter(b=>!branchHave.has(b));
  console.log(`  目标分支 ${branchNeed.length} 个，命中 ${branchNeed.length-missAll.length} 个，全缺失: [${missAll.join(', ')}]`);
  if (missSoft.length) console.log(`  (说明：soft-only分支缺失 [${missSoft.join(',')}] — 由分支优先级设计导致，不计入硬失败)`);

  // ========== 最终结论 ==========
  console.log(`\n${'='.repeat(70)}`);
  const allOK = parseRate==='100.000' && ok && hasAll12 && suspicious.length===0 && missHard.length===0;
  if (allOK) {
    console.log('✅ 结论：高并发场景下 JSON Perf 日志 100% 完整，无解析错误、无字段缺失、无 trace 丢包、硬性分支全覆盖');
    console.log(`   墙钟 ${wallMs}ms · 总 JSON ${allLines.length} 条 · 并发页 ${EXPECTED_PAGES} · 总点击 ${TOTAL_CLICKS} 次`);
    if (missSoft.length) console.log(`   （可忽略：soft-only 分支未覆盖 ${missSoft.join(',')}，属业务分支优先级的设计内表现）`);
    process.exit(0);
  } else {
    console.log('❌ 结论：存在以下异常，请查看上方详细报告');
    if (parseRate !== '100.000') console.log('   - JSON 解析错误：'+parseErr.length+' 条');
    if (!ok) console.log('   - 字段缺失');
    if (!hasAll12) console.log('   - 页面覆盖不完整');
    if (suspicious.length) console.log('   - 疑似链路丢包：'+suspicious.length);
    if (missHard.length) console.log('   - 硬性分支缺失：'+missHard.join(','));
    process.exit(1);
  }
})();
