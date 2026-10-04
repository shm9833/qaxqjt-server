'use strict';

/**
 * 单元测试：前端 js/troupe-cloud-store.js 纯内核 + createStore 依赖注入
 * 覆盖：归一化/消毒/合并、本机缓存秒开、云端权威应用、首次迁移、多设备模板合并补传、
 *       GET 失败降级、写失败 dirty+重试、PUT 去抖、bootstrap 去重、TTL 新鲜度。
 * 运行：node --test server/test/
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../js/troupe-cloud-store.js');
const {
  DEFAULT_GRADES, GRADE_KEYS,
  safeParse, normalizeGrades, sanitizeTemplates, mergeTemplates, createStore
} = T;

/* -------------------------------- 测试夹具 -------------------------------- */

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    _dump: () => Object.fromEntries(m)
  };
}

function fakeApi() {
  const calls = [];
  let getResp = { wageGrades: null, templates: [] };
  let failGetOnce = false;
  let failPutOnce = false;
  return {
    calls,
    setGet: r => { getResp = r; },
    failGetOnce: () => { failGetOnce = true; },
    failPutOnce: () => { failPutOnce = true; },
    putCalls: () => calls.filter(c => c.method === 'PUT'),
    request(method, path, opts) {
      calls.push({ method, path, opts });
      return new Promise((resolve, reject) => {
        if (method === 'GET' && failGetOnce) { failGetOnce = false; const e = new Error('network down'); e.code = 'NETWORK'; return reject(e); }
        if (method === 'PUT' && failPutOnce) { failPutOnce = false; const e = new Error('500'); e.code = 'SERVER_ERROR'; return reject(e); }
        if (method === 'GET') return resolve(getResp);
        resolve({ ok: true });
      });
    }
  };
}

function fakeTimers() {
  let q = [];
  return {
    setTimeout(fn) { const id = { fn }; q.push(id); return id; },
    clearTimeout(id) { const i = q.indexOf(id); if (i >= 0) q.splice(i, 1); },
    flush() { const cur = q; q = []; cur.forEach(t => t.fn()); },
    pending: () => q.length
  };
}

function captureReport() {
  const logs = [];
  return { logs, report: { info: m => logs.push(['info', m]), warn: m => logs.push(['warn', m]), error: m => logs.push(['error', m]) } };
}

function makeStore(api, storage, timers, report, t) {
  const tm = timers || fakeTimers();
  return createStore({
    storage: storage || memStorage(),
    api: api || fakeApi(),
    setTimeout: tm.setTimeout,
    clearTimeout: tm.clearTimeout,
    report: report || captureReport().report,
    now: t ? t.now : () => 1000000
  });
}

function cloudGrades(over) {
  const g = {};
  GRADE_KEYS.forEach(k => { g[k] = { name: DEFAULT_GRADES[k].name + '云', daily: DEFAULT_GRADES[k].daily + 1 }; });
  return Object.assign(g, over || {});
}
function localGrades() {
  const g = {};
  GRADE_KEYS.forEach(k => { g[k] = { name: DEFAULT_GRADES[k].name + '机', daily: DEFAULT_GRADES[k].daily + 9 }; });
  return g;
}
function tpl(id, name) { return { id, name, days: 3, savedAt: '2026-09-28T08:00:00.000Z', data: [{ cat: 'actor', name: '张三', role: '主演', grade: 'W5', daily: 400 }] }; }

/* ============================== 纯函数 ============================== */

test('safeParse: 坏 JSON 回退默认值', () => {
  assert.equal(safeParse('{bad', null), null);
  assert.equal(safeParse('', 42), 42);
  assert.deepEqual(safeParse('{"a":1}', null), { a: 1 });
});

test('normalizeGrades/sanitizeTemplates: 浏览器侧同口径兜底（与后端一致）', () => {
  assert.equal(normalizeGrades(null), null);
  assert.equal(Object.keys(normalizeGrades({})).length, 7);
  assert.equal(sanitizeTemplates('x'), null);
  assert.deepEqual(sanitizeTemplates([]), []);
});

test('mergeTemplates: 云端顺序优先、本机独有追加、同 id 不重复、封顶 50', () => {
  const cloud = [tpl('a', '云端A'), tpl('b', '云端B')];
  const local = [tpl('b', '本机B（应忽略）'), tpl('c', '本机C'), tpl('d', '本机D')];
  const m = mergeTemplates(cloud, local);
  assert.equal(m.appended, 2);
  assert.deepEqual(m.list.map(x => x.id), ['a', 'b', 'c', 'd']);
  assert.equal(m.list[1].name, '云端B'); // 云端版本权威

  const bigCloud = Array.from({ length: 50 }, (_, i) => tpl('c' + i, 'x'));
  const moreLocal = [tpl('local_only', 'y')];
  assert.equal(mergeTemplates(bigCloud, moreLocal).list.length, 50);
});

/* ============================== 缓存秒开 ============================== */

test('getGrades/getTemplates: 无网络时从本机缓存同步秒开', () => {
  const storage = memStorage({
    qaxqjt_wage_grades_v1: JSON.stringify(localGrades()),
    troupe_templates_v1: JSON.stringify([tpl('x', '本机模板')])
  });
  const s = makeStore(undefined, storage);
  assert.equal(s.getGrades().W1.name, DEFAULT_GRADES.W1.name + '机');
  assert.equal(s.getTemplates().length, 1);
});

/* ============================== 云端权威应用 ============================== */

test('bootstrap: 云端有数据时应用云端，本机独有模板合并补传，等级覆盖本机并回写缓存', async () => {
  const storage = memStorage({
    qaxqjt_wage_grades_v1: JSON.stringify(localGrades()),
    troupe_templates_v1: JSON.stringify([tpl('old', '旧模板')])
  });
  const api = fakeApi();
  api.setGet({ wageGrades: cloudGrades(), templates: [tpl('cloud1', '云模板1')], updatedAt: {} });
  const rep = captureReport();
  const s = makeStore(api, storage, fakeTimers(), rep.report);
  const applied = [];
  const res = await s.bootstrap({ onApply: a => applied.push(a) });

  assert.equal(res.source, 'cloud');
  assert.equal(s.getGrades().W1.name, DEFAULT_GRADES.W1.name + '云');
  // 云端模板在前，本机独有 'old' 合并补传（多设备不丢数据）
  assert.deepEqual(s.getTemplates().map(x => x.id), ['cloud1', 'old']);
  assert.equal(JSON.parse(storage.getItem('qaxqjt_wage_grades_v1')).W1.daily, DEFAULT_GRADES.W1.daily + 1);
  assert.equal(applied.length, 1);
  // 只有模板合并补传一次 PUT，等级无 PUT
  assert.equal(api.putCalls().filter(c => c.path === '/v1/troupe-config/wage-grades').length, 0);
  assert.equal(api.putCalls().filter(c => c.path === '/v1/troupe-config/templates').length, 1);
});

/* ============================== 首次自动迁移上云 ============================== */

test('bootstrap: 云端空 + 本机有旧数据 → 自动迁移（等级+模板各 PUT 一次），仅迁移一次', async () => {
  const storage = memStorage({
    qaxqjt_wage_grades_v1: JSON.stringify(localGrades()),
    troupe_templates_v1: JSON.stringify([tpl('local1', '本机模板')])
  });
  const api = fakeApi();
  api.setGet({ wageGrades: null, templates: [] });
  const rep = captureReport();
  const timers = fakeTimers();
  const s = makeStore(api, storage, timers, rep.report);

  await s.bootstrap({});
  assert.equal(api.putCalls().length, 2);
  assert.ok(api.putCalls().some(c => c.path === '/v1/troupe-config/wage-grades'));
  const tplPut = api.putCalls().find(c => c.path === '/v1/troupe-config/templates');
  assert.equal(tplPut.opts.body.templates[0].id, 'local1');
  assert.equal(JSON.parse(storage.getItem('qaxqjt_troupe_cloud_meta_v1')).migrated, true);
  assert.ok(rep.logs.some(([k]) => k === 'info'));

  // 第二次拉取仍为空（模拟极端情况）：已迁移过，不再重复 PUT
  const callsBefore = api.putCalls().length;
  await s.bootstrap({});
  assert.equal(api.putCalls().length, callsBefore);
});

/* ============================== 多设备模板合并补传 ============================== */

test('bootstrap: 云端有模板 + 本机独有模板 → 合并补传，不覆盖云端', async () => {
  const storage = memStorage({
    troupe_templates_v1: JSON.stringify([tpl('cloud1', '同id'), tpl('device2', '本机独有')])
  });
  const api = fakeApi();
  api.setGet({ wageGrades: cloudGrades(), templates: [tpl('cloud1', '云端权威')] });
  const s = makeStore(api, storage, fakeTimers());
  await s.bootstrap({});

  const puts = api.putCalls().filter(c => c.path === '/v1/troupe-config/templates');
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].opts.body.templates.map(x => x.id), ['cloud1', 'device2']);
  assert.equal(puts[0].opts.body.templates[0].name, '云端权威');
});

test('bootstrap: 已对齐设备上云端删除模板后，旧缓存不会复活删除（云端权威）', async () => {
  const storage = memStorage({
    qaxqjt_troupe_cloud_meta_v1: JSON.stringify({ migrated: true }),
    troupe_templates_v1: JSON.stringify([tpl('keep', '保留'), tpl('gone', '已在其他设备删除')])
  });
  const api = fakeApi();
  api.setGet({ wageGrades: cloudGrades(), templates: [tpl('keep', '保留')] });
  const s = makeStore(api, storage, fakeTimers());
  await s.bootstrap({});
  assert.deepEqual(s.getTemplates().map(x => x.id), ['keep']);
  assert.equal(api.putCalls().length, 0);
});

/* ============================== GET 失败降级 ============================== */

test('bootstrap: 网络失败时保留本机缓存、给出 warn 友好提示、不抛异常', async () => {
  const storage = memStorage({ qaxqjt_wage_grades_v1: JSON.stringify(localGrades()) });
  const api = fakeApi();
  api.failGetOnce();
  const rep = captureReport();
  const s = makeStore(api, storage, fakeTimers(), rep.report);
  const res = await s.bootstrap({});

  assert.equal(res.source, 'cache');
  assert.equal(s.getGrades().W1.name, DEFAULT_GRADES.W1.name + '机');
  assert.ok(rep.logs.some(([k]) => k === 'warn'));
  assert.ok(rep.logs.some(([, m]) => /本机缓存/.test(m)));
});

test('bootstrap: onError 回调可覆盖默认 warn 提示', async () => {
  const api = fakeApi();
  api.failGetOnce();
  const rep = captureReport();
  const s = makeStore(api, memStorage(), fakeTimers(), rep.report);
  const errs = [];
  await s.bootstrap({ onError: e => errs.push(e) });
  assert.equal(errs.length, 1);
  assert.equal(rep.logs.length, 0); // 提供 onError 后不再重复 warn
});

test('bootstrap: API 不可用时安静退回缓存', async () => {
  const storage = memStorage({ qaxqjt_wage_grades_v1: JSON.stringify(localGrades()) });
  const s = createStore({ storage, report: captureReport().report, setTimeout: fakeTimers().setTimeout, clearTimeout() {} });
  const errs = [];
  const res = await s.bootstrap({ onError: e => errs.push(e) });
  assert.equal(res.source, 'cache');
  assert.equal(errs[0].message, 'API_UNAVAILABLE');
  assert.equal(s.getGrades().W1.name, DEFAULT_GRADES.W1.name + '机');
});

/* ============================== 写操作乐观更新/失败 dirty/重试 ============================== */

test('saveGrades: 乐观写本机 + PUT；PUT 失败置 dirty 并友好报错，flushDirty 补推成功', async () => {
  const storage = memStorage();
  const api = fakeApi();
  const rep = captureReport();
  const s = makeStore(api, storage, fakeTimers(), rep.report);

  s.saveGrades(localGrades());
  assert.equal(JSON.parse(storage.getItem('qaxqjt_wage_grades_v1')).W1.daily, DEFAULT_GRADES.W1.daily + 9); // 本机立即可见
  await Promise.resolve(); await Promise.resolve();
  assert.equal(s.isDirty(), false);

  api.failPutOnce();
  s.saveGrades(cloudGrades());
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(s.isDirty(), true);
  assert.ok(rep.logs.some(([k, m]) => k === 'error' && /工资等级/.test(m)));

  await s.flushDirty();
  assert.equal(s.isDirty(), false);
});

test('saveTemplates: 去抖合并连续保存，只发一次 PUT 且为最终数据', async () => {
  const storage = memStorage();
  const api = fakeApi();
  const timers = fakeTimers();
  const s = makeStore(api, storage, timers, captureReport().report);

  s.saveTemplates([tpl('a', 'A')]);
  s.saveTemplates([tpl('a', 'A'), tpl('b', 'B')]);
  s.saveTemplates([tpl('a', 'A'), tpl('b', 'B'), tpl('c', 'C')]);
  assert.equal(timers.pending(), 1);
  assert.equal(s.getTemplates().length, 3); // 本机即时一致

  timers.flush();
  await Promise.resolve(); await Promise.resolve();
  const puts = api.putCalls().filter(c => c.path === '/v1/troupe-config/templates');
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].opts.body.templates.map(x => x.id), ['a', 'b', 'c']);
});

test('saveTemplates: PUT 失败后 bootstrap 成功会自动补推', async () => {
  const storage = memStorage();
  const api = fakeApi();
  const timers = fakeTimers();
  const s = makeStore(api, storage, timers, captureReport().report);

  s.saveTemplates([tpl('a', 'A')]);
  timers.flush();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(s.isDirty(), false);

  api.failPutOnce();
  s.saveTemplates([tpl('a', 'A'), tpl('b', 'B')]);
  timers.flush();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(s.isDirty(), true);

  api.setGet({ wageGrades: cloudGrades(), templates: [tpl('a', 'A'), tpl('b', 'B')] });
  await s.bootstrap({});
  // bootstrap 末尾 flushDirty 已补推
  assert.equal(s.isDirty(), false);
});

/* ============================== bootstrap 去重 & TTL ============================== */

test('bootstrap: 并发调用去重，只发一次 GET', async () => {
  const api = fakeApi();
  const s = makeStore(api, memStorage(), fakeTimers());
  const [r1, r2] = await Promise.all([s.bootstrap({}), s.bootstrap({})]);
  assert.equal(r1, r2);
  assert.equal(api.calls.filter(c => c.method === 'GET').length, 1);
});

test('hasFreshCache: TTL 60s 内外为新鲜', async () => {
  let cur = 5000000;
  const api = fakeApi();
  const s = createStore({ storage: memStorage(), api, report: captureReport().report, setTimeout: fakeTimers().setTimeout, clearTimeout() {}, now: () => cur });
  await s.bootstrap({});
  assert.equal(s.hasFreshCache(), true);
  cur += 61000;
  assert.equal(s.hasFreshCache(), false);
});
