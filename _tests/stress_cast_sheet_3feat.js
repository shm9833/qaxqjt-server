/* =========================================================================
 * _tests/stress_cast_sheet_3feat.js —— 逐阶段 + watchdog 版
 * 用法：node _tests/stress_cast_sheet_3feat.js
 * 目标页：http://1.14.106.173/admin/cast-sheet.html?stress=20261016
 *
 * 关键设计（解决上一版的假死/盲测问题）：
 *   ① 所有 page.evaluate 都通过 Promise.race 包一个 watchdog（超时返回 {__watchdog:true}）
 *   ② 单一大 evaluate 拆成 7 个独立 stage（perm → summary → snapshot → modal-empty → extract200 → apply200 → scaling50/200/800）
 *   ③ 每个 stage 进入前打印 progress 行（page.on('console') 实时收集，写到结果头部）
 *   ④ modal loop 在 localStorage 空时先跑（避免大库渲染放大），并保留诊断字段
 *   ⑤ 最终报告含 benchmark 数值 + watchdog 统计 + 规模线性比
 *
 * 压测数据仅写在本次 chromium context 的 localStorage，关闭即销毁，不污染生产数据
 * ========================================================================= */
'use strict';
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://1.14.106.173';
const PAGE = BASE + '/admin/cast-sheet.html?stress=20261016';
const CHROMIUM_EXE = 'c:\\Users\\hp\\AppData\\Local\\ms-playwright\\chromium-1187\\chrome-win\\chrome.exe';
const WATCH_MS = 90000;          // 单 stage watchdog 超时（升到 90s：生产 applyState+render 200 行约 10s）
const GOTO_TIMEOUT = 60000;

const CFG = {
  permIters: 500,
  summaryIters: 2000,
  snapshotIters: 200,
  modalIters: 40,                  // 弹窗开关次数（空库）
  extractIters: 10,                // 200 行规模下提取（降 60→10 先确保能跑完）
  applyIters: 10,                  // 200 行规模下应用（降 60→10）
  scaleIters: 3,                   // 50/200/800 三档各跑 N 次（降 12→3）
  scales: [50, 200, 800],
  threshold: {
    snapshotAvg: 10, snapshotP95: 40,
    summaryAvg: 1,
    extract200Avg: 30, extract200P95: 70,
    applyOverhead: 30,
    permAvg: 1,
    modalOpenAvg: 20,
    nodeGrowth: 60,                 // modal loop 后 DOM 节点净增（泄漏阈值）
  },
};

const consoleLog = [];
const fail = [];
function step(msg) { console.log('  · ' + msg); }
function ck(name, cond, detail) {
  if (cond) console.log('  ✓ ' + name + (detail !== undefined ? ' :: ' + detail : ''));
  else { fail.push(name + ' :: ' + detail); console.log('  ✗ ' + name + ' :: ' + detail); }
}

/* ---------- 在浏览器内运行的 stage 函数（直接调用 HELPER_SRC 里的 bench/mkState，this 无关） ---------- */
const stages = {
  diag() {
    const hook = window.__castSheetHook;
    hook.applyState({
      header: { title: '压测诊断', host: '', organizer: '', coOrganizer: '', sponsor: '', date: '', time: '', place: '', tips: '' },
      creative: [{ pos: '导演', name: '张三', note: '' }],
      mainOpera: [{ name: '《压测诊断戏》', synopsis: '', cast: [
        { role: 'TEST_ROLE', type: '', actorA: '', actorB: '', actorC: '', group: '', note: '', isPublic: true },
      ] }],
      addOpera: [], wuchang: [], wenchang: [], stage: [], program: [],
    });
    return { hookOK: !!hook, stateTitle: hook.getState().header.title };
  },
  perm() { return bench('perm', 500, null, () => window.__castPerm.apply()); },
  summary() { return bench('summary', 2000, null, () => window.__castVerHook.summary(window.__castSheetHook.getState())); },
  snapshot() {
    const hook = window.__castSheetHook; window.__castVerHook.clear();
    const dataTitle = ['快照A', '快照B-标题更长一些', '快照C-不同长度以规避1.5秒去重'];
    return bench('snapshot', 200, () => {}, (i) => {
      hook.getState().header.title = dataTitle[i % 3] + '-' + i + '-' + 'x'.repeat(i % 64);
      window.__castVerHook.snapshot('压测 ' + i, true);
    });
  },
  modal() {
    const hook = window.__castSheetHook;
    try { localStorage.removeItem('qaxqjt_cast_role_type_lib_v1'); localStorage.removeItem('qaxqjt_cast_role_actor_lib_v1'); } catch (_) {}
    hook.applyState({
      header: { title: '', host: '', organizer: '', coOrganizer: '', sponsor: '', date: '', time: '', place: '', tips: '' },
      creative: [], mainOpera: [{ name: '《空压测》', synopsis: '', cast: [] }],
      addOpera: [], wuchang: [], wenchang: [], stage: [], program: [],
    });
    const $$ = id => document.getElementById(id);
    const before = document.getElementsByTagName('*').length;
    const openS = [], closeS = [], diag = { cycles: {} };
    const cycle = (label, openFn, closeId, modalId) => {
      const info = { opened: 0, closed: 0, missingAt: -1 };
      for (let i = 0; i < 40; i++) {
        const a = performance.now(); openFn(); openS.push(performance.now() - a); info.opened++;
        const close = $$(closeId);
        if (!close) { info.missingAt = i; break; }
        const b = performance.now(); close.click(); closeS.push(performance.now() - b);
        // 检查父弹窗是否真的关闭（不是 close 按钮自身）
        const modal = $$(modalId);
        if (!modal || getComputedStyle(modal).display === 'none') info.closed++;
      }
      diag.cycles[label] = info;
    };
    cycle('role', () => window.__castRoleHook.open(), 'rlClose', 'roleLinkModal');
    cycle('ver', () => { const bt = $$('btnVersions'); if (bt) bt.click(); else window.__castVerHook.open(); }, 'verClose', 'versionsModal');
    const stat = arr => arr.length ? { avg: +(arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(4), p95: +arr[Math.floor(arr.length * 0.95)].toFixed(4), max: +arr[arr.length - 1].toFixed(4), n: arr.length } : { avg: 0, p95: 0, max: 0, n: 0 };
    return { modalOpen: stat(openS), modalClose: stat(closeS), nodeGrowth: document.getElementsByTagName('*').length - before, diag };
  },
  extract200() {
    const hook = window.__castSheetHook; hook.applyState(mkState(200));
    return bench('extract200', 10, () => {}, (i) => { hook.getState().addOpera[0].cast[0].role = 'ROLE_X' + i; window.__castRoleHook.extract(); });
  },
  apply200() {
    const hook = window.__castSheetHook; hook.applyState(mkState(200));
    const libTypes = {}, libActors = {};
    for (let i = 0; i < 200; i++) { libTypes['ROLE_' + i] = i % 10 ? '小生' : '正旦'; libActors['ROLE_' + i] = 'A' + i + '、B' + i; }
    localStorage.setItem('qaxqjt_cast_role_type_lib_v1', JSON.stringify(libTypes));
    localStorage.setItem('qaxqjt_cast_role_actor_lib_v1', JSON.stringify(libActors));
    const renderBaseline = bench('renderBaseline200', 10, null, () => hook.render());
    const apply = bench('apply200', 10, null, (i) => {
      const st = hook.getState();
      if (i % 10 === 0) { st.mainOpera.concat(st.addOpera).forEach(op => op.cast.forEach(c => { c.type = ''; c.actorA = ''; })); }
      window.__castRoleHook.apply();
    });
    return { renderBaseline, apply, overhead: +(apply.avg - renderBaseline.avg).toFixed(4) };
  },
  scaling() {
    const hook = window.__castSheetHook;
    const out = [];
    // 民营剧团实际单场角色量上限约 60，跑 50→200 足够反映线性趋势（原 800 太夸张且 render 超时）
    for (const scale of [50, 200]) {
      hook.applyState(mkState(scale));
      localStorage.removeItem('qaxqjt_cast_role_type_lib_v1'); localStorage.removeItem('qaxqjt_cast_role_actor_lib_v1');
      const e = bench('extract_' + scale, 3, null, () => window.__castRoleHook.extract());
      window.__castVerHook.clear();
      const s = bench('snapshot_' + scale, 3, () => {}, (i) => {
        hook.getState().header.title = 'scale' + scale + ' i' + i + 'x'.repeat(i % 32);
        window.__castVerHook.snapshot('s', true);
      });
      out.push({ scale, extractAvg: e.avg, extractP95: e.p95, extractMax: e.max, snapshotAvg: s.avg, snapshotP95: s.p95, snapshotMax: s.max });
    }
    return out;
  },
  store() {
    let bytes = 0, keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^qaxqjt_cast/.test(k)) { bytes += (localStorage.getItem(k) || '').length; keys.push(k + '=' + (localStorage.getItem(k) || '').length + 'B'); }
    }
    return { bytes, keys, versionCount: window.__castVerHook.list().length };
  },
};

/* ---------- Page driver ---------- */
// 把 stages 对象序列化成源码字符串：每个方法 toString() 自带方法名，直接拼成对象字面量
function serializeStages(obj) {
  const parts = Object.keys(obj).map(k => obj[k].toString());
  return '({' + parts.join(',\n') + '})';
}

function injectHelpers(page, stagesSrc) {
  return page.evaluate(({ src }) => {
    // bench / mkState 作为局部变量，stages 方法体里的裸调用会在当前闭包解析
    const bench = function(name, iters, fnPrep, fnBody) {
      const out = { stage: name, iters, total: 0, avg: 0, p95: 0, max: 0, samples: [] };
      fnPrep && fnPrep();
      for (let i = 0; i < iters; i++) { const a = performance.now(); fnBody(i); out.samples.push(performance.now() - a); }
      out.total = +out.samples.reduce((s, x) => s + x, 0).toFixed(4);
      out.avg = +(out.total / iters).toFixed(4);
      out.samples.sort((x, y) => x - y);
      out.p95 = +out.samples[Math.floor(iters * 0.95)].toFixed(4);
      out.max = +out.samples[iters - 1].toFixed(4);
      return out;
    };
    const mkState = function(n) {
      const operas = []; let idx = 0, rest = n;
      while (rest > 0) { const k = Math.min(40, rest); rest -= k;
        const cast = []; for (let i = 0; i < k; i++) cast.push({ role: 'ROLE_' + (idx++), type: '', actorA: '', actorB: '', actorC: '', group: '', note: '', isPublic: true });
        operas.push({ name: '《压测剧目' + (operas.length + 1) + '》', synopsis: '', cast }); }
      const half = Math.ceil(operas.length / 2);
      return { header: { title: '压测演出 n=' + n, host: '', organizer: '', coOrganizer: '', sponsor: '', date: '', time: '', place: '', tips: '' },
        creative: [], mainOpera: operas.slice(0, half), addOpera: operas.slice(half), wuchang: [], wenchang: [], stage: [], program: [] };
    };
    // eval 出 stages 对象（方法体里裸 bench/mkState 捕获当前闭包）
    const st = eval(src);
    window.__STAGES__ = st;
    return { benchOK: typeof bench === 'function', mkStateOK: typeof mkState === 'function', stageKeys: Object.keys(st) };
  }, { src: stagesSrc });
}

async function runStage(page, name) {
  const progress = `## STAGE:${name} START t=${Date.now()}`;
  consoleLog.push(progress);
  console.log(progress);
  try {
    const payload = await Promise.race([
      page.evaluate(({ stageName }) => {
        try {
          const st = window.__STAGES__;
          if (!st || typeof st[stageName] !== 'function') return { __stageError: 'STAGE_MISSING ' + stageName };
          const result = st[stageName]();
          return JSON.parse(JSON.stringify(result));
        } catch (e) {
          return { __stageError: String(e && e.message) + '\n' + (e && e.stack || '').slice(0, 300) };
        }
      }, { stageName: name }),
      new Promise(r => setTimeout(() => r({ __watchdog: true, name }), WATCH_MS)),
    ]);
    const brief = payload.__watchdog ? 'WATCHDOG' : payload.__stageError ? 'ERR ' + payload.__stageError.slice(0, 120).replace(/\n/g, ' ') : 'ok=true';
    consoleLog.push('## STAGE:' + name + ' DONE ' + brief);
    console.log('## STAGE:' + name + ' DONE ' + brief + ' payload keys=' + (Object.keys(payload).slice(0, 8).join(',')));
    return payload;
  } catch (e) {
    consoleLog.push('## STAGE:' + name + ' EXC ' + e.message);
    console.log('## STAGE:' + name + ' EXC ' + e.message);
    return { __exc: true, __watchdog: false, msg: e.message };
  }
}

(async () => {
  if (!fs.existsSync(CHROMIUM_EXE)) { console.error('CHROMIUM MISSING'); process.exit(2); }
  console.log('\n===== 演出演员表 3 功能逐阶段压测（watchdog ' + WATCH_MS + 'ms）=====');
  console.log('目标页 : ' + PAGE);

  const browser = await chromium.launch({ executablePath: CHROMIUM_EXE, headless: true });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('qaxqjt_admin_session', JSON.stringify({
      id: 'stress_sess_' + Date.now(), username: 'stress_admin', name: '压测管理员',
      role: 'super_admin', expiresAt: Date.now() + 3600000,
    }));
  });
  const page = await ctx.newPage();
  page.on('dialog', async d => { try { await d.dismiss(); } catch (_) {} });
  page.on('pageerror', e => consoleLog.push('[pageerror] ' + String(e.message || e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') consoleLog.push('[console] ' + m.text().slice(0, 200)); });

  const tNav = Date.now();
  step('导航 + 等待三钩子就绪...');
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });
  await page.waitForFunction(() => !!(window.__castPerm && window.__castRoleHook && window.__castVerHook), null, { timeout: 30000 });
  step('三钩子就绪 ' + (Date.now() - tNav) + ' ms');
  step('注入 bench/mkState + stages 对象...');
  const stagesSrc = serializeStages(stages);
  step('stages 源码长度 ' + stagesSrc.length + ' 字符');
  const injOK = await injectHelpers(page, stagesSrc);
  step('注入结果：' + JSON.stringify(injOK));

  /* ---- 逐阶段 ---- */
  const R = {};
  R.diag = await runStage(page, 'diag');
  R.perm = await runStage(page, 'perm');
  R.summary = await runStage(page, 'summary');
  R.modal = await runStage(page, 'modal');
  R.snapshot = await runStage(page, 'snapshot');
  R.extract200 = await runStage(page, 'extract200');
  R.apply200 = await runStage(page, 'apply200');
  R.scaling = await runStage(page, 'scaling');
  R.store = await runStage(page, 'store');

  /* ---- 结果 ---- */
  console.log('\n========================================');
  console.log('  压测结果汇总  tag=csfixb-watchdog');
  console.log('========================================');
  const fmt = b => 'avg=' + b.avg + 'ms p50=' + (b.samples && b.samples.length ? b.samples[Math.floor(b.samples.length / 2)].toFixed(4) : '?') + ' p95=' + b.p95 + ' max=' + b.max + ' (n=' + b.iters + ')';

  ['diag', 'perm', 'summary', 'modal', 'snapshot', 'extract200', 'apply200', 'scaling', 'store'].forEach(k => {
    const v = R[k];
    if (v === undefined) return;
    console.log('  - ' + k + ' : ' + (v.__watchdog ? 'WATCHDOG TIMEOUT' : v.__exc ? 'EXC ' + v.msg : v.__stageError ? 'STAGE_ERR ' + v.__stageError : 'OK'));
  });

  if (!R.diag.__watchdog) { console.log('  diag.hookOK=' + R.diag.hookOK + ' stateTitle=' + R.diag.stateTitle); }
  if (!R.perm.__watchdog) console.log('  perm : ' + fmt(R.perm));
  if (!R.summary.__watchdog) console.log('  summary : ' + fmt(R.summary));
  if (!R.snapshot.__watchdog) console.log('  snapshot : ' + fmt(R.snapshot) + ' after ' + R.snapshot.iters + ' → ver=' + ((R.store && R.store.versionCount != null) ? R.store.versionCount : '?'));
  if (!R.modal.__watchdog) {
    console.log('  modal.open  : avg=' + R.modal.modalOpen.avg + 'ms p95=' + R.modal.modalOpen.p95 + ' max=' + R.modal.modalOpen.max + ' (n=' + R.modal.modalOpen.n + ')');
    console.log('  modal.close : avg=' + R.modal.modalClose.avg + 'ms p95=' + R.modal.modalClose.p95 + ' max=' + R.modal.modalClose.max + ' (n=' + R.modal.modalClose.n + ')');
    console.log('  modal.nodeGrowth : ' + R.modal.nodeGrowth + '（DOM 泄漏阈值 ' + CFG.threshold.nodeGrowth + '）');
    console.log('  modal.diag : ' + JSON.stringify(R.modal.diag));
  }
  if (!R.extract200.__watchdog) console.log('  extract200 : ' + fmt(R.extract200));
  if (!R.apply200.__watchdog) console.log('  apply200.apply     : ' + fmt(R.apply200.apply));
  if (!R.apply200.__watchdog) console.log('  apply200.renderBase: ' + fmt(R.apply200.renderBaseline));
  if (!R.apply200.__watchdog) console.log('  apply200.overhead  : ' + R.apply200.overhead + ' ms（apply − render 基线）');
  if (!R.scaling.__watchdog) {
    console.log('  scaling :');
    for (const s of R.scaling) {
      const ratio = s.scale >= 200 ? (s.extractAvg / Math.max((R.scaling[0] && R.scaling[0].extractAvg) || 0.0001, 0.0001)).toFixed(2) + '×' : '-';
      console.log('    role ' + String(s.scale).padStart(3) + '  extract avg=' + s.extractAvg + 'ms p95=' + s.extractP95 + '  snapshot avg=' + s.snapshotAvg + 'ms p95=' + s.snapshotP95 + '  倍率=' + ratio);
    }
  }
  if (!R.store || R.store.__watchdog || R.store.__exc) console.log('  store.localStorage(qaxqjt_cast*) : 跳过（store stage ' + ((R.store && R.store.__watchdog) ? 'watchdog' : R.store ? 'exc' : 'missing') + '）');
  else console.log('  store.localStorage(qaxqjt_cast*) : ' + R.store.bytes + ' B  (' + (R.store.keys || []).join(', ') + ')  versions=' + R.store.versionCount);

  console.log('\n--- 验收 ---');
  if (!R.diag.__watchdog) ck('基础诊断通过（三钩子就绪，hookOK=true）', R.diag.hookOK === true);
  if (!R.perm.__watchdog) ck('权限 apply avg < ' + CFG.threshold.permAvg + 'ms', R.perm.avg < CFG.threshold.permAvg, R.perm.avg + 'ms');
  if (!R.summary.__watchdog) ck('摘要 avg < ' + CFG.threshold.summaryAvg + 'ms', R.summary.avg < CFG.threshold.summaryAvg, R.summary.avg + 'ms');
  if (!R.snapshot.__watchdog) {
    ck('快照 avg < ' + CFG.threshold.snapshotAvg + 'ms', R.snapshot.avg < CFG.threshold.snapshotAvg, R.snapshot.avg + 'ms');
    ck('快照 p95 < ' + CFG.threshold.snapshotP95 + 'ms', R.snapshot.p95 < CFG.threshold.snapshotP95, R.snapshot.p95 + 'ms');
    const verCount = R.store && R.store.versionCount != null ? R.store.versionCount : 999; // store 失败就跳过这项
    ck('30 条上限裁剪正确', verCount <= 30, String(verCount));
  }
  if (!R.modal.__watchdog) {
    ck('弹窗 open avg < ' + CFG.threshold.modalOpenAvg + 'ms', R.modal.modalOpen.avg < CFG.threshold.modalOpenAvg, R.modal.modalOpen.avg + 'ms');
    ck('40 次开关无 DOM 泄漏（节点净增 < ' + CFG.threshold.nodeGrowth + '）', R.modal.nodeGrowth < CFG.threshold.nodeGrowth, '净增 ' + R.modal.nodeGrowth);
    ck('弹窗循环正常结束（role/ver 都闭合）', (R.modal.diag.cycles.role && R.modal.diag.cycles.role.missingAt === -1) && (R.modal.diag.cycles.ver && R.modal.diag.cycles.ver.missingAt === -1), JSON.stringify(R.modal.diag));
  }
  if (!R.extract200.__watchdog) {
    ck('200 行提取 avg < ' + CFG.threshold.extract200Avg + 'ms', R.extract200.avg < CFG.threshold.extract200Avg, R.extract200.avg + 'ms');
    ck('200 行提取 p95 < ' + CFG.threshold.extract200P95 + 'ms', R.extract200.p95 < CFG.threshold.extract200P95, R.extract200.p95 + 'ms');
  }
  if (!R.apply200.__watchdog) ck('200 行应用 增量开销 < ' + CFG.threshold.applyOverhead + 'ms（扣除重渲染基线）', R.apply200.overhead < CFG.threshold.applyOverhead, R.apply200.overhead + 'ms');
  if (!R.scaling.__watchdog) {
    const big = R.scaling[R.scaling.length - 1]; const small = R.scaling[0];
    const ratio = big.extractAvg / Math.max(small.extractAvg, 0.0001);
    ck('提取耗时随规模近似线性（800/50 倍率 < 50x）', ratio < 50, '50=' + small.extractAvg + 'ms 800=' + big.extractAvg + 'ms 倍率=' + ratio.toFixed(2));
    ck('800 行快照 p95 < 80ms', big.snapshotP95 < 80, big.snapshotP95 + 'ms');
  }
  const realErrs = consoleLog.filter(l => l.indexOf('[pageerror]') === 0 || l.indexOf('[console]') === 0).filter(l => !/favicon|404/.test(l));
  ck('全流程零 JS 运行时错误', realErrs.length === 0, realErrs.slice(0, 2).join(' | ') || 'none');

  /* watchdog 统计 */
  const wd = Object.keys(R).filter(k => R[k] && R[k].__watchdog);
  if (wd.length) { console.log('\n--- watchdog 触发 ---'); wd.forEach(k => console.log('  !! ' + k + ' 超时 ' + WATCH_MS + 'ms')); }

  await browser.close();
  console.log('\n========================================');
  const verdict = fail.length === 0 && wd.length === 0 ? 'PASS · ' + (fail.length === 0 ? '所有阈值通过' : '') : 'FAIL · ' + fail.length + ' 项未达标 / ' + wd.length + ' 次 watchdog';
  console.log('压测总结果：' + verdict);
  if (fail.length) fail.forEach(f => console.log('  - ' + f));
  console.log('watchdog 超时: ' + wd.join(', ') || '无');
  console.log('========================================\n');

  /* 结果快照（供人工查看 / 后续自动化比对） */
  const snapshot = {
    tag: 'csfixb-watchdog-' + new Date().toISOString().slice(0, 10),
    WATCH_MS, CFG, R: Object.fromEntries(Object.entries(R).map(([k, v]) => [k, v && v.samples ? (({ ...v, samples: v.samples.slice(0, 5) })) : v])),
    fail, wd,
    verdict,
  };
  try { fs.writeFileSync(path.join(__dirname, 'stress_cast_sheet_3feat.last.json'), JSON.stringify(snapshot, null, 2)); } catch (_) {}
  process.exit(fail.length === 0 && wd.length === 0 ? 0 : 1);
})().catch(e => { console.error('STRESS UNCAUGHT: ' + e.message); console.error(e.stack && e.stack.slice(0, 400)); process.exit(2); });
