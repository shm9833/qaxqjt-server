/* ============================================================
 * 按钮兜底机制 · 高并发稳定性压测脚本
 *   模型：N虚拟用户 jsdom模拟DOM → 并发click不同按钮
 *   阶段：RampUp (0→MAX) → Steady (稳态) → RampDown (MAX→0)
 *   指标：RPS / P50-P99 / 成功率 / 锁冲突率 / 分支分布
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

// ========== 配置 ==========
const CONFIG = {
  // 12主页面 + login/inventory = 14个代表性页面参与压测，每个用户随机选一个
  TEST_PAGES: [
    'orders.html','accounts.html','schedule.html','finance.html','staff.html',
    'operas.html','cast-sheet.html','content.html','reports.html','system.html',
    'attendance.html','index.html','login.html','inventory.html'
  ],
  MAX_CONCURRENT: 200,         // 最高并发用户数（jsdom内存友好）
  RAMP_UP_SEC: 5,             // 爬坡时长（秒）
  STEADY_SEC: 10,             // 稳态压测时长（秒）
  RAMP_DOWN_SEC: 3,           // 下坡时长
  THINK_TIME_MIN_MS: 20,      // 用户最小思考时间
  THINK_TIME_MAX_MS: 80,      // 用户最大思考时间
  // 按钮类型分布：偏向核心业务
  BUTTON_DISTRIBUTION: [
    {weight:15, name:'save',     html:'<button class="btn btn-action">保存订单</button>'},
    {weight:10, name:'edit',     html:'<button class="btn btn-sm">编辑</button>'},
    {weight:8,  name:'delete',   html:'<a class="action-link">删除</a>'},
    {weight:8,  name:'view',     html:'<a role="button">查看详情</a>'},
    {weight:10, name:'schedule', html:'<a class="btn btn-action">派工安排</a>'},
    {weight:10, name:'audit',    html:'<button class="btn btn-action">审核通过</button>'},
    {weight:10, name:'sign',     html:'<button class="btn">签订合同</button>'},
    {weight:8,  name:'contract', html:'<a data-action="contract">生成合同</a>'},
    {weight:6,  name:'accept',   html:'<button class="btn btn-primary">确认接单</button>'},
    {weight:5,  name:'export',   html:'<button class="btn">导出Excel</button>'},
    {weight:5,  name:'add',      html:'<button class="btn">新增演员</button>'},
    {weight:5,  name:'fallback', html:'<a class="btn">申请调整</a>'}
  ]
};

// ========== 统计 ==========
const STATS = {
  startedAt: 0,
  endedAt: 0,
  totalClicks: 0,
  successClicks: 0,
  failClicks: 0,
  lockConflicts: 0,
  allLatencies: [],            // 全部延迟
  perBranch: {},               // 按分支
  perSecond: {},               // 每秒RPS
  errors: []
};
for (const b of CONFIG.BUTTON_DISTRIBUTION) {
  STATS.perBranch[b.name] = {count:0, success:0, latencies:[], lock:0};
}

let running = true;
let activeUsers = 0;

// ========== 工具函数 ==========
function rand(min, max){ return Math.floor(Math.random()*(max-min+1))+min; }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function pickWeightedButton() {
  const total = CONFIG.BUTTON_DISTRIBUTION.reduce((s,b)=>s+b.weight,0);
  let r = Math.random()*total;
  for (const b of CONFIG.BUTTON_DISTRIBUTION) {
    if ((r-=b.weight) <= 0) return b;
  }
  return CONFIG.BUTTON_DISTRIBUTION[0];
}

// 计算分位延迟
function pct(arr, p) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a,b)=>a-b);
  const k = (sorted.length-1)*p;
  const f = Math.floor(k), c = Math.ceil(k);
  return f===c ? sorted[f] : (sorted[f]*(c-k) + sorted[c]*(k-f));
}
function avg(arr){ return arr.length? arr.reduce((s,v)=>s+v,0)/arr.length : 0; }

// ========== 初始化单个虚拟用户的DOM环境 ==========
function createVirtualUser(userId) {
  const pageName = CONFIG.TEST_PAGES[rand(0, CONFIG.TEST_PAGES.length-1)];
  const pageHTML = fs.readFileSync(path.join(ROOT,'admin',pageName),'utf-8');
  // 只提取DeadButtonFallback和SuperPatch两个脚本块内容（避免加载无关内容）
  let dbfSrc = '', spSrc = '';
  const dbfMatch = pageHTML.match(/<!-- 🔧 E块死按钮兜底[\s\S]{0,20000}?<\/script>/);
  if (dbfMatch) dbfSrc = dbfMatch[0].replace(/^[\s\S]*?<script>/,'').replace(/<\/script>$/,'');
  const spMatch = pageHTML.match(/<script id="adminSuperPatchV20260730">[\s\S]{0,60000}?<\/script>/);
  if (spMatch) spSrc = spMatch[0].replace(/<script id="adminSuperPatchV20260730">/,'').replace(/<\/script>$/,'');

  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="app"></div></body></html>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/admin/' + pageName
  });
  const {window} = dom;
  const document = window.document;

  // 初始化QinApp和toast钩子
  window.localStorage = window.localStorage || {};
  window.localStorage.setItem = (k,v) => { window.localStorage[k] = v; };
  window.localStorage.getItem = (k) => window.localStorage[k] || null;
  window.__PRESSURE_TEST_MODE__ = true;

  // 🔧 压测专用polyfill + 降噪
  window.confirm = () => true;                    // 删除分支的confirm弹窗 → 默认true
  window.alert = () => {};                         // 屏蔽alert噪声
  try {
    // 屏蔽DeadButtonFallback和SuperPatch的初始化info日志
    const _ci = window.console.info.bind(window.console);
    window.console.info = function(...args){ try { const s = String(args[0]||''); if(s.includes('DeadButtonFallback')||s.includes('SuperPatch')||s.includes('6合1超级补丁')) return; } catch(_){} _ci(...args); };
    const _cw = window.console.warn.bind(window.console);
    window.console.warn = function(...args){ try { const s = String(args[0]||''); if(s.includes('confirm()')||s.includes('Not implemented')) return; } catch(_){} _cw(...args); };
  } catch(_) {}

  const toastCalls = [];
  window.QinApp = {
    Utils: { toast: (msg,type,dur) => { toastCalls.push({t:Date.now(), msg, type}); } }
  };

  // 注入两个脚本
  try {
    const f1 = new window.Function(dbfSrc);
    f1.call(window);
    const f2 = new window.Function(spSrc);
    f2.call(window);
  } catch(e) {
    console.error('用户',userId,'脚本注入失败',e.message);
  }

  return {
    userId, pageName, window, document, toastCalls,
    // 执行一次点击，返回{branch,latency,toasted,lockConflict}
    async clickOnce() {
      const btnInfo = pickWeightedButton();
      const div = document.getElementById('app');
      div.innerHTML = btnInfo.html;
      const btn = div.firstChild;
      const toastCountBefore = this.toastCalls.length;
      const startT = Date.now();
      let lockConflict = false;
      // 监听去抖日志（检查OP_LOCKS冲突）
      if (this.window.__OP_LOCKS) {
        const beforeKeys = Object.keys(this.window.__OP_LOCKS).length;
        const evt = this.window.document.createEvent('Event');
        evt.initEvent('click', true, true);
        btn.dispatchEvent(evt);
        const afterKeys = Object.keys(this.window.__OP_LOCKS).length;
        if (afterKeys > beforeKeys + 2) lockConflict = true;
      } else {
        const evt = this.window.document.createEvent('Event');
        evt.initEvent('click', true, true);
        btn.dispatchEvent(evt);
      }
      // 等待toast或最多50ms
      let waited = 0;
      while (this.toastCalls.length === toastCountBefore && waited < 80) {
        await sleep(2); waited += 2;
      }
      const latency = Date.now() - startT;
      const toasted = this.toastCalls.length > toastCountBefore;
      return { branch: btnInfo.name, latency, toasted, lockConflict, txt: btn.textContent };
    },
    destroy() { dom.window.close(); }
  };
}

// ========== 运行单个虚拟用户主循环 ==========
async function runVirtualUser(userId) {
  activeUsers++;
  const user = createVirtualUser(userId);
  try {
    while (running) {
      const res = await user.clickOnce();
      const now = Date.now();
      const secKey = Math.floor((now-STATS.startedAt)/1000);
      if (!STATS.perSecond[secKey]) STATS.perSecond[secKey] = 0;
      STATS.perSecond[secKey]++;
      STATS.totalClicks++;
      STATS.allLatencies.push(res.latency);
      const br = STATS.perBranch[res.branch];
      if (br) {
        br.count++;
        br.latencies.push(res.latency);
        if (res.lockConflict) { br.lock++; STATS.lockConflicts++; }
        if (res.toasted) { br.success++; STATS.successClicks++; }
        else { STATS.failClicks++; STATS.errors.push({branch:res.branch,userId, reason:'no_toast', txt:res.txt}); }
      }
      // 思考时间
      const tt = rand(CONFIG.THINK_TIME_MIN_MS, CONFIG.THINK_TIME_MAX_MS);
      if (running) await sleep(tt);
    }
  } catch(e) {
    STATS.errors.push({userId, err: String(e)});
  } finally {
    user.destroy();
    activeUsers--;
  }
}

// ========== 主流程：RampUp → Steady → RampDown ==========
async function main() {
  console.log('\n' + '█'.repeat(70));
  console.log('█  秦安县秦剧团云端预约系统 · 按钮兜底机制 高并发稳定性压测');
  console.log('█  配置 MAX_CONCURRENT=',CONFIG.MAX_CONCURRENT,
    'RAMP=',CONFIG.RAMP_UP_SEC,'s STEADY=',CONFIG.STEADY_SEC,'s RDN=',CONFIG.RAMP_DOWN_SEC,'s');
  console.log('█'.repeat(70));

  STATS.startedAt = Date.now();
  const userPromises = [];
  let uid = 1;

  // Phase 1: RampUp
  console.log('\n⏫ Phase 1/3: RampUp (0 →',CONFIG.MAX_CONCURRENT,'用户 用时',CONFIG.RAMP_UP_SEC,'s)');
  const stepInterval = (CONFIG.RAMP_UP_SEC*1000) / CONFIG.MAX_CONCURRENT;
  for (let i=0; i<CONFIG.MAX_CONCURRENT; i++) {
    userPromises.push(runVirtualUser(uid++));
    await sleep(stepInterval);
  }
  console.log('  ✅ RampUp完成 当前活跃用户=',activeUsers);

  // Phase 2: Steady
  console.log('\n🟢 Phase 2/3: Steady 稳态压测',CONFIG.STEADY_SEC,'s');
  const steadyStart = Date.now();
  const steadyTicks = Math.ceil(CONFIG.STEADY_SEC/2);
  for (let t=1; t<=steadyTicks; t++) {
    await sleep(2000);
    const elapsed = ((Date.now()-steadyStart)/1000).toFixed(1);
    const lastSec = Object.entries(STATS.perSecond).slice(-3)
      .map(([s,v])=>`T${s}s:${v}`).join(' ');
    console.log('  t='+elapsed+'s 活跃='+activeUsers+' 累计点击='+STATS.totalClicks
      +' 成功率='+(STATS.totalClicks?(100*STATS.successClicks/STATS.totalClicks).toFixed(1):0)+'% 近秒RPS: '+lastSec);
  }

  // Phase 3: RampDown
  console.log('\n⏬ Phase 3/3: RampDown (',CONFIG.RAMP_DOWN_SEC,'s 内停止所有用户)');
  running = false;
  // 强制等待所有用户循环退出
  const waitDeadline = Date.now() + CONFIG.RAMP_DOWN_SEC*1000 + 2000;
  while (activeUsers>0 && Date.now()<waitDeadline) await sleep(200);
  await Promise.race([Promise.allSettled(userPromises), sleep(2000)]);
  STATS.endedAt = Date.now();

  // ========== 输出报告 ==========
  printReport();
}

function printReport() {
  const durMs = STATS.endedAt - STATS.startedAt;
  const durSec = (durMs/1000).toFixed(1);
  const allLat = STATS.allLatencies;
  const succRate = STATS.totalClicks ? (100*STATS.successClicks/STATS.totalClicks).toFixed(2) : '0.00';
  const lockRate = STATS.totalClicks ? (100*STATS.lockConflicts/STATS.totalClicks).toFixed(2) : '0.00';

  console.log('\n' + '='.repeat(70));
  console.log('  📊 压测结果报告 · 总耗时',durSec,'s  最大并发',CONFIG.MAX_CONCURRENT,'用户');
  console.log('='.repeat(70));

  console.log('\n📈 全局指标:');
  console.log('  总点击数:', STATS.totalClicks.toLocaleString());
  console.log('  成功(触发toast):', STATS.successClicks.toLocaleString(), '   失败:', STATS.failClicks.toLocaleString());
  console.log('  成功率:', succRate, '%');
  console.log('  整体RPS: 平均=', (STATS.totalClicks/(durSec||1)).toFixed(1), ' 峰值=', Math.max(...Object.values(STATS.perSecond),0));
  console.log('  锁冲突次数:', STATS.lockConflicts.toLocaleString(), ' (',lockRate,'%)');
  console.log('  全局延迟(ms): 平均=', avg(allLat).toFixed(1),
    ' P50=', pct(allLat,.5).toFixed(1),
    ' P95=', pct(allLat,.95).toFixed(1),
    ' P99=', pct(allLat,.99).toFixed(1));

  console.log('\n🧩 按分支详情:');
  const header = `  ${'分支'.padEnd(12)}${'次数'.padStart(8)}${'成功'.padStart(8)}${'成功率'.padStart(9)}${'平均ms'.padStart(9)}${'P50'.padStart(8)}${'P95'.padStart(8)}${'P99'.padStart(8)}${'锁冲突'.padStart(8)}`;
  console.log(header);
  console.log('  ' + '-'.repeat(header.length-2));
  for (const name of Object.keys(STATS.perBranch)) {
    const b = STATS.perBranch[name];
    const srate = b.count ? (100*b.success/b.count).toFixed(1)+'%' : '-';
    console.log(`  ${name.padEnd(12)}`
      + `${b.count.toString().padStart(8)}`
      + `${b.success.toString().padStart(8)}`
      + `${srate.padStart(9)}`
      + `${avg(b.latencies).toFixed(1).padStart(9)}`
      + `${pct(b.latencies,.5).toFixed(1).padStart(8)}`
      + `${pct(b.latencies,.95).toFixed(1).padStart(8)}`
      + `${pct(b.latencies,.99).toFixed(1).padStart(8)}`
      + `${b.lock.toString().padStart(8)}`);
  }

  // 按秒RPS
  console.log('\n⏱️  每秒RPS序列:');
  const secKeys = Object.keys(STATS.perSecond).map(Number).sort((a,b)=>a-b);
  const rpsBars = secKeys.map(s => {
    const v = STATS.perSecond[s];
    const maxV = Math.max(...Object.values(STATS.perSecond));
    const barLen = maxV ? Math.round(30*v/maxV) : 0;
    return `  T${s.toString().padStart(2)}s ${v.toString().padStart(5)} │${'█'.repeat(barLen)}${'░'.repeat(30-barLen)}│`;
  });
  for (const l of rpsBars) console.log(l);

  // 错误摘要
  if (STATS.errors.length) {
    console.log('\n⚠️  错误Top20:');
    for (const e of STATS.errors.slice(0,20)) console.log('  -', JSON.stringify(e));
  } else {
    console.log('\n✅ 无错误');
  }

  // 结论
  const pass = Number(succRate) >= 99 && pct(allLat,.99) < 50;
  console.log('\n' + (pass?'✅':'⚠️') + ' 结论: '
    + (pass?'稳定：成功率≥99% 且 P99<50ms，高压下按钮响应正常'
          : '关注：成功率<99% 或 P99≥50ms，建议开启性能日志排查：localStorage.__ENABLE_PERF_LOG__="true"'));
  console.log('='.repeat(70));

  // 保存JSON报告
  const jsonPath = path.join(ROOT,'_tests','stress_report_'+Date.now()+'.json');
  fs.writeFileSync(jsonPath, JSON.stringify({
    config: CONFIG,
    summary: {
      durationSec: durSec,
      totalClicks: STATS.totalClicks,
      successClicks: STATS.successClicks,
      failClicks: STATS.failClicks,
      successRate: Number(succRate),
      avgRps: STATS.totalClicks/(durSec||1),
      peakRps: Math.max(...Object.values(STATS.perSecond),0),
      lockConflicts: STATS.lockConflicts,
      lockRate: Number(lockRate),
      avgLatency: avg(allLat),
      p50: pct(allLat,.5), p95: pct(allLat,.95), p99: pct(allLat,.99)
    },
    perBranch: Object.fromEntries(Object.entries(STATS.perBranch).map(([n,b])=>[n,{
      count:b.count, success:b.success, lock:b.lock,
      successRate:b.count?100*b.success/b.count:0,
      avg:avg(b.latencies), p50:pct(b.latencies,.5), p95:pct(b.latencies,.95), p99:pct(b.latencies,.99)
    }])),
    perSecondRps: STATS.perSecond,
    errors: STATS.errors.slice(0,50),
    pass
  }, null, 2));
  console.log('\n📁 详细JSON报告已保存:', path.relative(ROOT,jsonPath));
  process.exit(pass?0:1);
}

main().catch(e => { console.error('压测失败:',e); process.exit(2); });
