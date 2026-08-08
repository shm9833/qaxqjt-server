#!/usr/bin/env node
/* ==========================================================================
 * scripts/test-fallback-recovery.js
 * ----------------------------------------------------------------------------
 * 降级逻辑 & 弱网恢复自动化验证脚本（模拟真实 EdgeOne Pages 网络波动）
 *
 *  覆盖 4 阶段：
 *    [P0_BASELINE]  在线（正常 3001，0 丢包，RTT~5ms）→ 基准耗时
 *    [P1_OFFLINE]   硬断网（ECONNREFUSED）→  localStorage 降级写入
 *    [P2_WEAKNET]   弱网（30% 丢包 + 300~2000ms 随机抖动 + 2 次重试）
 *    [P3_RECOVERY]  恢复在线 → 测"从弱网/离线切换后，首次 BK 在线成功"耗时
 *
 *  日志严格匹配前端 api-request.js 真实文案（不可臆写，见 grep 来源）：
 *    · "[submitAppointment] API 不可用（force_fallback），已降级 localStorage 写入"
 *    · "[submitAppointment] API 不可用（network_fail），已降级 localStorage 写入"
 *    · "后端未连通，已启用本地离线模式（数据仅本地可用）"
 *
 *  运行：  node scripts/test-fallback-recovery.js
 *          （会在同目录生成 fallback-test-report_YYYYMMDD-HHmmss.json + .txt）
 * ========================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------- 配置（贴近真实 EdgeOne 波动画像） ----------
const CFG = {
  ONLINE_BASE:   process.env.ONLINE_BASE   || 'http://127.0.0.1:3001',
  OFFLINE_BASE:  process.env.OFFLINE_BASE  || 'http://127.0.0.1:19999', // 无监听
  WEAK_LOSS:     Number(process.env.WEAK_LOSS    || 0.30), // 30% 丢包
  WEAK_MIN_MS:   Number(process.env.WEAK_MIN_MS   || 300),
  WEAK_MAX_MS:   Number(process.env.WEAK_MAX_MS   || 2000),
  WEAK_RETRY:    Number(process.env.WEAK_RETRY    || 2),   // 同 fetch 重试次数
  TIMEOUT_MS:    Number(process.env.TIMEOUT_MS     || 8000),
  OUT_DIR:       path.join(process.cwd(), 'scripts', 'fallback-test-artifacts'),
  SIM_LOCALSTORAGE_FILE: null, // 脚本内自动分配
};
CFG.SIM_LOCALSTORAGE_FILE = path.join(CFG.OUT_DIR, 'simulated_localStorage.json');

// ---------- 工具 ----------
function pad(n, w=2){ return String(n).padStart(w,'0'); }
function ts(){ const d=new Date(); return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
function nowMs(){ return Number(process.hrtime.bigint() / 1000000n); }
function rand(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
const LOG = (pfx, ...a)=>console.log(`[${new Date().toISOString().slice(11,19)}] [${pfx}]`, ...a);

// ---------- 模拟 localStorage（对应前端 window.localStorage） ----------
const LS_KEYS = {
  APT:  'qaxqjt_appointments',
  SEQ:  'qaxqjt_appointments_seq_26',
  FB:   'qaxqjt_fallback_mode',
  TOK:  'qaxqjt_access_token',
};
function loadLS(){
  try { return JSON.parse(fs.readFileSync(CFG.SIM_LOCALSTORAGE_FILE,'utf8')); }
  catch(_) { return { [LS_KEYS.APT]:'[]', [LS_KEYS.SEQ]:'0', [LS_KEYS.FB]:'0' }; }
}
function saveLS(ls){
  fs.mkdirSync(path.dirname(CFG.SIM_LOCALSTORAGE_FILE),{recursive:true});
  fs.writeFileSync(CFG.SIM_LOCALSTORAGE_FILE, JSON.stringify(ls, null, 2));
}
function lsIsFb(ls){ return ls[LS_KEYS.FB] === '1' || ls[LS_KEYS.FB] === 'true'; }
function lsSetFb(ls, flag){ ls[LS_KEYS.FB] = flag ? '1' : '0'; saveLS(ls); }

// 降级写入 localStorage（完全复刻前端 app.js submitAppointment fallback 逻辑）
function writeFallbackAppointment(ls, payload){
  let seq = parseInt(ls[LS_KEYS.SEQ]||'0',10) + 1;
  ls[LS_KEYS.SEQ] = String(seq); saveLS(ls);
  const bookingId = `26-QA-${String(seq).padStart(4,'0')}`;
  const row = Object.assign({}, payload, {
    bookingId, id: bookingId, status: 'pending', statusText: '待审核',
    bookingTimeText: new Date().toISOString().slice(0,10),
    localStorageOnly: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const arr = JSON.parse(ls[LS_KEYS.APT]||'[]');
  arr.unshift(row); ls[LS_KEYS.APT] = JSON.stringify(arr); saveLS(ls);
  return row;
}

// ---------- 自定义 HTTP 请求（复刻 api-request.js request() 的行为） ----------
/*
 * 规则匹配前端（api-request.js L48-L141）：
 *   1. 若 CFG.isFallbackMode === true 且传了 fallback/Read → 直接 force_fallback 不发请求
 *   2. 发请求，超时：AbortController abort → 走 isNetErr
 *   3. 401 且非 login → refresh 重试一次（本脚本简化：跳过 refresh，直接当业务错误）
 *   4. HTTP ok 且 ok===true/undefined → 返回 data（或整个 payload 非包裹时的 data）
 *   5. 其他业务状态码抛错；catch 中 isNetErr 走降级分支（GET→fallbackRead+SETFB=1；写→fallback）
 *   6. isNetErr 判定：!status || name==='AbortError' || /Failed to fetch|NetworkError|fetch/i
 */
function isNetErrByMsg(err, status){
  if(!status) return true;
  if(err && err.name === 'AbortError') return true;
  const m = (err && (err.message || '')) || '';
  return /Failed to fetch|NetworkError|TypeError.*fetch|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET|ENOTFOUND/i.test(m);
}

function httpRequest(method, url, { body, timeoutMs=CFG.TIMEOUT_MS, headers={} } = {}){
  return new Promise((resolve, reject)=>{
    const u = new URL(url);
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const opts = {
      method, hostname:u.hostname, port:u.port, path:u.pathname + u.search,
      headers: Object.assign({ 'Accept':'application/json' }, headers,
                payload ? { 'Content-Type':'application/json', 'Content-Length':payload.length } : {}),
    };
    let finished=false;
    const req = http.request(opts, (res)=>{
      const chunks=[]; res.on('data',c=>chunks.push(c));
      res.on('end',()=>{
        if(finished) return; finished=true;
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null; try { if(text) data = JSON.parse(text); } catch(e){ data = { _raw:text }; }
        resolve({ status:res.statusCode, ok:res.statusCode>=200 && res.statusCode<300, data, text });
      });
    });
    req.on('error', (e)=>{ if(finished)return; finished=true; reject(Object.assign(e,{status:0})); });
    req.on('timeout', ()=>{ if(finished)return; finished=true; req.destroy(Object.assign(new Error('Aborted by timeout'),{name:'AbortError',status:0})); });
    req.setTimeout(timeoutMs);
    if(payload) req.write(payload);
    req.end();
  });
}

/* 弱网/离线包装：按当前 phase 决定是否"模拟丢包/延迟/ECONNREFUSED"
 *   phaseMode: 'online' | 'offline' | 'weak'
 */
async function requestWithNetworkPhase(method, rawUrl, { body, phaseMode, fallback, fallbackRead, showToast=true, retryLeft=CFG.WEAK_RETRY, authToken } = {}){
  const ls = loadLS();
  const headers = authToken ? { Authorization: 'Bearer ' + authToken } : {};

  // 规则 1：force_fallback 预检查（复刻 api-request.js L55）
  if(lsIsFb(ls)){
    if(method==='GET' && typeof fallbackRead==='function'){
      if(showToast) LOG('TOAST', '后端未连通，已启用本地离线模式（数据仅本地可用）');
      const ret = await fallbackRead({ reason:'force_fallback' });
      return { _via:'force_fallback_read', data: ret, ok:true };
    }
    if(typeof fallback==='function'){
      const ret = await fallback({ reason:'force_fallback' });
      return { _via:'force_fallback_write', data: ret, ok:true };
    }
  }

  // 规则 2：按 phase 注入网络故障
  let attempt = 0;
  while(true){
    attempt++;
    const t0 = nowMs();
    try {
      // --- 弱网模拟 ---
      if(phaseMode === 'weak'){
        const delay = rand(CFG.WEAK_MIN_MS, CFG.WEAK_MAX_MS);
        await sleep(delay);
        if(Math.random() < CFG.WEAK_LOSS){
          const e = new Error('Simulated network reset');
          e.code = 'ECONNRESET'; e.status = 0;
          throw e;
        }
      }
      // --- 离线模拟：全部打到 OFFLINE_BASE ---
      const url = (phaseMode === 'offline')
        ? CFG.OFFLINE_BASE + (rawUrl.startsWith('http') ? (new URL(rawUrl)).pathname+(new URL(rawUrl)).search : rawUrl)
        : rawUrl;

      const res = await httpRequest(method, url, { body, headers });
      if(res.ok){
        const payload = res.data;
        // api-request.js L100-102：ok=true 且 data.ok / data.data
        if(payload === null || payload === undefined || payload.ok === true || payload.ok === undefined){
          const inner = (payload && payload.data !== undefined) ? payload.data : payload;
          return { _via:'network', status:res.status,
                   data: inner,      // 内层业务数据（appointment 行 / healthz data 壳）
                   outer: payload,   // 外层 ok/code/msg/ts（供 healthz code=0 判定）
                   ok:true, elapsedMs: nowMs()-t0, attempt };
        }
        // 业务层 ok=false → 抛
        const msg = (payload && payload.error && payload.error.message) || ('HTTP '+res.status);
        const err = new Error(msg); err.status = res.status; err.code = (payload && payload.error && payload.error.code) || ('HTTP_'+res.status);
        throw err;
      } else {
        const err = new Error('HTTP '+res.status); err.status = res.status; err.data = res.data; throw err;
      }
    } catch(err) {
      const net = isNetErrByMsg(err, err.status);
      // isNetErr → 自动降级 / 重试
      if(net){
        if(method==='GET' && typeof fallbackRead==='function'){
          if(showToast) LOG('TOAST', '后端未连通，已启用本地离线模式（数据仅本地可用）');
          lsSetFb(loadLS(), true); // api-request.js L130
          const ret = await fallbackRead({ reason:'network_fail', err });
          return { _via:'network_fail_read', data: ret, ok:true, elapsedMs: nowMs()-t0, attempt };
        }
        if(typeof fallback === 'function'){
          const ret = await fallback({ reason:'network_fail', err, attempt });
          return { _via:'network_fail_write', data: ret, ok:true, elapsedMs: nowMs()-t0, attempt };
        }
        // 非 GET 且没传 fallback 且还能重试 → 弱网重试
        if(phaseMode === 'weak' && retryLeft > 0){
          LOG('WEAK', `丢包/超时，剩余重试 ${retryLeft}（attempt ${attempt}）`);
          retryLeft--; continue;
        }
      }
      throw err;
    }
  }
}

// ---------- 业务动作（与 booking.html submitAppointment / 健康检查 对齐） ----------
const DUMMY_PAYLOADS = [
  { customerName:'自动化测试_基线', phone:'13800000001', serviceType:'乡村庙会戏曲演出', shows:1,
    preferredStartDate:'2026-10-01', venue:'甘肃天水市秦安县兴国镇文化广场', remarks:'自动化测试-基线', agreeBookingNotice:true },
  { customerName:'自动化测试_离线', phone:'13800000002', serviceType:'政府惠民下乡巡演', shows:2,
    preferredStartDate:'2026-10-02', venue:'甘肃天水市秦安县陇城镇中心小学', remarks:'自动化测试-断网降级', agreeBookingNotice:true },
  { customerName:'自动化测试_弱网', phone:'13800000003', serviceType:'节庆专场文艺演出', shows:1,
    preferredStartDate:'2026-10-03', venue:'甘肃天水市秦安县莲花镇文化中心', remarks:'自动化测试-弱网抖动', agreeBookingNotice:true },
  { customerName:'自动化测试_恢复', phone:'13800000004', serviceType:'天水文旅合作演出', shows:3,
    preferredStartDate:'2026-10-04', venue:'甘肃天水市秦安县大剧院', remarks:'自动化测试-恢复后首次成功', agreeBookingNotice:true },
];

// 预约提交：在线成功 → BK；失败降级 → 26-QA
async function submitAppointment(payload, { phaseMode, authToken }){
  const url = CFG.ONLINE_BASE + '/api/v1/appointments';
  return requestWithNetworkPhase('POST', url, {
    body: payload, phaseMode, authToken,
    fallback: async ({ reason }) => {
      const ls = loadLS();
      LOG('SUBMIT', `[submitAppointment] API 不可用（${reason}），已降级 localStorage 写入`);
      return writeFallbackAppointment(ls, payload);
    },
  });
}

async function healthz(phaseMode){
  const url = CFG.ONLINE_BASE + '/api/v1/healthz';
  return requestWithNetworkPhase('GET', url, {
    phaseMode,
    fallbackRead: async ({ reason }) => ({ offline:true, version:'LOCAL_FALLBACK', reason, ts:Date.now() }),
  });
}

// ---------- 报告 ----------
function fmtReport(report){
  const lines = [];
  lines.push('='.repeat(80));
  lines.push(' 秦安县秦剧团 · booking.html 降级逻辑 & 弱网恢复自动化测试报告');
  lines.push(' 生成时间: ' + new Date().toISOString());
  lines.push(' 配置    : ONLINE=' + CFG.ONLINE_BASE + ' OFFLINE=' + CFG.OFFLINE_BASE);
  lines.push('         : 弱网 LOSS=' + (CFG.WEAK_LOSS*100).toFixed(0) + '% 延迟=' + CFG.WEAK_MIN_MS + '~' + CFG.WEAK_MAX_MS + 'ms 重试=' + CFG.WEAK_RETRY);
  lines.push('='.repeat(80));
  for(const phase of report.phases){
    lines.push('');
    lines.push('【' + phase.name + '】  目标：' + phase.goal);
    lines.push('  · 健康检查: ' + JSON.stringify(phase.health).replace(/\s+/g,' '));
    lines.push('  · 提交预约: via=' + phase.submit.via + ' bookingId=' + (phase.submit.bookingId||'(none)')
              + ' prefix=' + phase.submit.prefix + ' online=' + (phase.submit.online?'是':'否'));
    lines.push('  · 关键耗时: healthz=' + fmtMs(phase.health.elapsedMs)
              + '  submit=' + fmtMs(phase.submit.elapsedMs)
              + '  attempt=' + (phase.submit.attempt||1));
    if(phase.note) lines.push('  · 备注: ' + phase.note);
  }
  lines.push('');
  lines.push('-'.repeat(80));
  lines.push('总体指标');
  lines.push('  · 在线提交（BK 前缀）耗时:     ' + fmtMs(report.metrics.T_online_ms));
  lines.push('  · 硬断网降级（26-QA 前缀）耗时: ' + fmtMs(report.metrics.T_offline_ms));
  lines.push('  · 弱网抖动平均提交耗时:         ' + fmtMs(report.metrics.T_weak_avg_ms) + ' (丢包后重试)');
  lines.push('  · 恢复首次在线成功耗时:         ' + fmtMs(report.metrics.T_recovery_ms));
  lines.push('  · 总执行耗时:                   ' + fmtMs(report.metrics.T_total_ms));
  lines.push('-'.repeat(80));
  lines.push('降级日志匹配检查（必须全部为 PASS）');
  for(const c of report.checks) lines.push('  · ' + (c.pass?'✅ PASS':'❌ FAIL') + '  ' + c.name + ' → ' + c.detail);
  return lines.join('\n');
}
function fmtMs(v){ return (v==null || isNaN(v)) ? 'N/A' : (Number(v).toFixed(0)+' ms'); }

// ---------- 主流程 ----------
async function main(){
  const REPORT_FILE = path.join(CFG.OUT_DIR, `fallback-test-report_${ts()}`);
  fs.mkdirSync(CFG.OUT_DIR, {recursive:true});
  saveLS({ [LS_KEYS.APT]:'[]', [LS_KEYS.SEQ]:'0', [LS_KEYS.FB]:'0', [LS_KEYS.TOK]:'' });

  const T0 = nowMs();
  LOG('INIT', '脚本输出目录: ' + CFG.OUT_DIR);
  LOG('INIT', '模拟 localStorage 文件: ' + CFG.SIM_LOCALSTORAGE_FILE);
  LOG('INIT', 'ONLINE=' + CFG.ONLINE_BASE + ' OFFLINE=' + CFG.OFFLINE_BASE);

  // 0. 登录拿鉴权 token（GET 列表需要；POST 公开预约不需要）
  let authToken = '';
  try {
    const login = await httpRequest('POST', CFG.ONLINE_BASE + '/api/v1/auth/login', {
      body: { username:'caiwu', password:'Qaxqjt@2026' }
    });
    if(login.ok && login.data && login.data.data){ authToken = login.data.data.accessToken; LOG('LOGIN', 'OK role=' + login.data.data.user.role); }
  } catch(e) { LOG('LOGIN', 'WARN: 未登录 token=' + e.message); }

  const report = { config: Object.assign({}, CFG), phases: [], checks: [], metrics:{} };
  const checks = (n,pass,detail)=>report.checks.push({name:n,pass:!!pass,detail});

  // ======================================================== P0_BASELINE
  LOG('P0', '========== P0_BASELINE: 在线，正常网络 ==========');
  lsSetFb(loadLS(), false);
  const P0 = { name:'P0_BASELINE', goal:'基准：健康检查 200 + POST 返回 BK 前缀（fromMockApi=true）' };
  {
    const hz = await healthz('online');
    const hzCode = (hz.outer && hz.outer.code) !== undefined ? (hz.outer && hz.outer.code) : (hz.data && hz.data.code);
    const hzVersion = (hz.data && hz.data.version) || (hz.outer && hz.outer.data && hz.outer.data.version);
    P0.health = { code:hzCode, version:hzVersion, via:hz._via, elapsedMs:hz.elapsedMs, ok:hz.ok };
    LOG('P0', 'healthz → via=' + hz._via + ' code=' + hzCode + ' elapsed=' + fmtMs(hz.elapsedMs));
    const t0 = nowMs();
    const apt = await submitAppointment(DUMMY_PAYLOADS[0], { phaseMode:'online', authToken });
    const elapsed = apt.elapsedMs || (nowMs()-t0);
    const id = (apt.data && (apt.data.bookingId || apt.data.id)) || '';
    P0.submit = { via: apt._via, bookingId: id, prefix: id.slice(0,2), online: id.startsWith('BK'),
                  fromMockApi: !!(apt.data && apt.data.fromMockApi), elapsedMs: elapsed, attempt: apt.attempt };
    LOG('P0', 'submit → via=' + apt._via + ' bookingId=' + id + ' BK前缀=' + id.startsWith('BK') + ' fromMockApi=' + P0.submit.fromMockApi + ' elapsed=' + fmtMs(elapsed));
    P0.note = '基准值；若 BK 非前缀意味着本地缓存未清/路由不工作';
    report.metrics.T_online_ms = elapsed;
    checks('P0 healthz code=0 & version=MOCK-1.0', hzCode===0 && /MOCK-1\.0/.test(hzVersion||''), `code=${hzCode} version=${hzVersion}`);
    checks('P0 submit 在线 BK 前缀', id.startsWith('BK'), 'bookingId=' + id);
    checks('P0 submit fromMockApi=true', P0.submit.fromMockApi, String(P0.submit.fromMockApi));
  }
  report.phases.push(P0);

  // ======================================================== P1_OFFLINE
  LOG('P1', '========== P1_OFFLINE: 硬断网（打到 19999） ==========');
  lsSetFb(loadLS(), false); // 初始不强制，让 network_fail 分支触发
  const P1 = { name:'P1_OFFLINE', goal:'ECONNREFUSED → 自动降级写入 localStorage（26-QA 前缀）' };
  {
    const t0 = nowMs();
    const hz = await healthz('offline');
    P1.health = { offline: hz.data && hz.data.offline, via:hz._via, elapsedMs: nowMs()-t0, ok:hz.ok, fbModeAfter: loadLS()[LS_KEYS.FB] };
    LOG('P1', 'healthz → via=' + hz._via + ' offline=' + !!(hz.data && hz.data.offline) + ' fbMode=' + P1.health.fbModeAfter);
    // 之后 GET 失败已把 fallback_mode=1 设上（api-request.js L130）
    const t1 = nowMs();
    const apt = await submitAppointment(DUMMY_PAYLOADS[1], { phaseMode:'offline', authToken });
    const elapsed = apt.elapsedMs || (nowMs()-t1);
    const id = (apt.data && (apt.data.bookingId||apt.data.id)) || '';
    P1.submit = { via: apt._via, bookingId: id, prefix: id.slice(0,5), online: id.startsWith('BK'),
                  localStorageOnly: !!(apt.data && apt.data.localStorageOnly), elapsedMs: elapsed, attempt: apt.attempt };
    LOG('P1', 'submit → via=' + apt._via + ' bookingId=' + id + ' 26-QA前缀=' + /^26[\-]QA/.test(id) + ' localStorageOnly=' + P1.submit.localStorageOnly + ' elapsed=' + fmtMs(elapsed));
    P1.note = '若 healthz 为 network_fail_read，则 fallback_mode 已被自动设 1；之后 submit 走 force_fallback_write';
    report.metrics.T_offline_ms = elapsed;
    checks('P1 healthz 走降级/离线 (非 network online)', hz._via!=='network', 'via=' + hz._via);
    checks('P1 submit 26-QA 前缀 & localStorageOnly=true', /^26[\-]QA/.test(id) && P1.submit.localStorageOnly, 'id='+id+' localStorageOnly='+P1.submit.localStorageOnly);
    checks('P1 healthz 失败后 fallback_mode 自动置 1 (持久化)', P1.health.fbModeAfter === '1', 'fbMode='+P1.health.fbModeAfter);
  }
  report.phases.push(P1);

  // ======================================================== P2_WEAKNET
  LOG('P2', '========== P2_WEAKNET: 弱网（30% 丢包 + 300~2000ms 抖动 + 2 次重试） ==========');
  lsSetFb(loadLS(), false); // 取消强制：测真实弱网下丢包重试 → 若最终仍失败才降级
  const P2 = { name:'P2_WEAKNET', goal:'模拟 EdgeOne 抖动：平均提交耗时 ≤ 3s；重试仍失败才回 26-QA 前缀' };
  const weakTimes = [];
  let finalVia = ''; let finalId = '';
  for(let i=0;i<3;i++){
    const ls = loadLS(); if(lsIsFb(ls)) lsSetFb(ls,false); // 每轮清 force 模式（真实用户会刷新/切换页面）
    const t0 = nowMs();
    const apt = await submitAppointment(DUMMY_PAYLOADS[2], { phaseMode:'weak', authToken });
    const elapsed = apt.elapsedMs || (nowMs()-t0);
    weakTimes.push(elapsed); finalVia = apt._via; finalId = (apt.data && (apt.data.bookingId||apt.data.id))||'';
    LOG('P2', `round ${i+1}/3 → via=${apt._via} attempt=${apt.attempt||1} id=${finalId} elapsed=${fmtMs(elapsed)}`);
  }
  const avg = weakTimes.reduce((s,v)=>s+v,0)/weakTimes.length;
  P2.health = { note:'weaknet 阶段直接测提交（省略 healthz 节省时间）' };
  P2.submit = { via: finalVia, bookingId: finalId, prefix: finalId.slice(0, finalId.startsWith('BK')?2:5),
                online: finalId.startsWith('BK'), avgMs: avg, maxMs: Math.max(...weakTimes), minMs: Math.min(...weakTimes), attempt:'见每轮' };
  P2.note = '弱网：若丢包少 2 次重试内救回 → BK 前缀；否则命中 network_fail 写 26-QA';
  report.metrics.T_weak_avg_ms = avg;
  checks('P2 弱网 3 轮平均 ≤ 3000ms', avg <= 3000, `avg=${avg.toFixed(0)}ms  min=${Math.min(...weakTimes)}  max=${Math.max(...weakTimes)}  阈值=3000ms`);
  checks('P2 提交 via ∈ { network, network_fail_write, force_fallback_write }', /network|force_fallback/.test(finalVia), 'finalVia=' + finalVia);
  report.phases.push(P2);

  // ======================================================== P3_RECOVERY
  LOG('P3', '========== P3_RECOVERY: 恢复在线 ==========');
  {
    // 先关掉 fallback_mode（模拟用户刷新页面后系统重新探测）
    const ls = loadLS(); if(lsIsFb(ls)) lsSetFb(ls, false);
    // 先 healthz 确认网络
    const t0 = nowMs();
    const hz = await healthz('online');
    const hzT = nowMs()-t0;
    const p3hzCode = (hz.outer && hz.outer.code) !== undefined ? (hz.outer && hz.outer.code) : (hz.data && hz.data.code);
    LOG('P3', 'healthz 探测 → via=' + hz._via + ' code=' + p3hzCode + ' elapsed=' + fmtMs(hzT));
    // 立即提交（衡量"从离线切换到首次 BK 成功"耗时）
    const t1 = nowMs();
    const apt = await submitAppointment(DUMMY_PAYLOADS[3], { phaseMode:'online', authToken });
    const aptT = apt.elapsedMs || (nowMs()-t1);
    const id = (apt.data && (apt.data.bookingId||apt.data.id)) || '';
    report.phases.push({
      name:'P3_RECOVERY',
      goal:'从离线/弱网恢复后，健康检查立即恢复 code=0，提交立即 BK 前缀成功',
      health: { code:p3hzCode, via:hz._via, elapsedMs: hzT, online: hz._via==='network' },
      submit: { via: apt._via, bookingId: id, prefix: id.slice(0,2), online: id.startsWith('BK'), fromMockApi: apt.data && apt.data.fromMockApi, elapsedMs: aptT, attempt: apt.attempt },
      note: '恢复耗时以 healthz+submit 合计计算；若仍走 force_fallback，说明 fallback_mode 未被清除'
    });
    report.metrics.T_recovery_ms = hzT + aptT;
    checks('P3 恢复后 healthz via=network & code=0', hz._via==='network' && p3hzCode===0, 'via='+hz._via+' code='+p3hzCode);
    checks('P3 恢复后 submit BK 前缀 & fromMockApi=true', id.startsWith('BK') && !!(apt.data&&apt.data.fromMockApi), 'bookingId=' + id + ' fromMockApi=' + !!(apt.data&&apt.data.fromMockApi));
    checks('P3 恢复总耗时（健康检查+提交） ≤ 2000ms', (hzT+aptT) <= 2000, `total=${(hzT+aptT).toFixed(0)}ms  阈值=2000ms`);
  }

  report.metrics.T_total_ms = nowMs() - T0;

  // ---------- 输出 ----------
  const txt = fmtReport(report);
  fs.writeFileSync(REPORT_FILE + '.json', JSON.stringify(report, null, 2));
  fs.writeFileSync(REPORT_FILE + '.txt', txt);
  console.log('\n\n' + txt);
  LOG('REPORT', '.txt → ' + REPORT_FILE + '.txt');
  LOG('REPORT', '.json → ' + REPORT_FILE + '.json');
  LOG('REPORT', '模拟 localStorage → ' + CFG.SIM_LOCALSTORAGE_FILE);
}

main().catch(e => { LOG('FATAL', e.stack || e); process.exit(2); });
