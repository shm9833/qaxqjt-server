/* tests/js-ui.unit.spec.js — 前端 UI/工具模块单元测试
 *
 * 用法：node tests/js-ui.unit.spec.js
 * 依赖：无（Node 内置 vm/assert/fs；整文件或函数切片实时加载，不复制代码）
 *
 * 覆盖：
 *   js/pagination.js        getPageConfig 路径配置 / 关键词匹配 /
 *                           页码窗口算法（含省略号）/ 分页切片与边界钳制 / 分类过滤
 *   js/year-standard.js     年份优先级链（全局>meta>缓存>本地）/ 缓存 TTL/坏 JSON /
 *                           DOM 渲染替换计数与 script 跳过
 *   js/real-action-guard.js 五标记幂等打标 / 非元素忽略 / 根元素匹配 / 异常吞咽 / 双载幂等
 *   js/year-lite.js         getYear
 *   js/real-performers.js   bucket 8 分组（6 大行+武场/文场） / stdRole 22 岗 /
 *                           v2 缓存装载、按名去重、未知归前场（零假数据契约）
 *   js/wechat-fallback.js   shouldShowTip 直播/预订页常显与 7 天 TTL
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const JS = path.join(__dirname, '..', 'js');
const readJs = n => fs.readFileSync(path.join(JS, n), 'utf8');
function sliceBetween(s, markA, markB) {
  const a = s.indexOf(markA);
  const b = s.indexOf(markB, a);
  assert(a >= 0 && b > a, '抽取失败：' + markA + ' / ' + markB);
  return s.slice(a, b);
}
function run(code, extra) {
  const sb = Object.assign({ console }, extra || {});
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: 'extract.js' });
  return sb;
}

const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓ ' + name); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}

/* ---- 迷你 DOM ---- */
function makeClass() {
  const set = new Set();
  return { add: x => set.add(x), remove: x => set.delete(x), contains: x => set.has(x), _set: set };
}
function fakeEl(tag, cat) {
  const attrs = {};
  if (cat) attrs['data-category'] = cat;
  return {
    tagName: (tag || 'DIV').toUpperCase(),
    children: [], style: {}, textContent: '', innerText: '',
    classList: makeClass(),
    setAttribute(k, v) { attrs[k] = String(v); },
    removeAttribute(k) { delete attrs[k]; },
    hasAttribute(k) { return k in attrs; },
    getAttribute(k) { return (k in attrs ? attrs[k] : null); },
    querySelector() { return null; }
  };
}

(async () => {
  console.log('js-ui.unit.spec — pagination / year-standard / guard / performers / wechat\n');

  /* ==================== pagination.js ==================== */
  const PG_SRC = readJs('pagination.js');

  // getPageConfig 切片（闭包私有，只能切片单测；window 由 vm 全局提供）
  const pgCfgWin = { location: { pathname: '' } };
  const getPageConfig = run(
    sliceBetween(PG_SRC, 'var PAGE_CONFIG = {', 'function matchContainer'),
    { window: pgCfgWin }
  ).getPageConfig;
  await t('getPageConfig：新闻 6 / 剧目 8 / 三个 admin 列表 10；多级目录识别 admin/ 前缀；未知页 null', () => {
    const withPath = p => { pgCfgWin.location.pathname = p; return getPageConfig(); };
    assert.strictEqual(withPath('/news.html').pageSize, 6);
    assert.strictEqual(withPath('/operas.html').pageSize, 8);
    assert.strictEqual(withPath('/admin/orders.html').pageSize, 10);
    assert.strictEqual(withPath('/x/y/admin/staff.html').pageSize, 10);
    assert.strictEqual(withPath('/admin/inventory.html').pageSize, 10);
    assert.strictEqual(withPath('/index.html'), null);
    assert.strictEqual(withPath('/about.html'), null);
  });

  // getText + elementMatchesKeyword 切片
  const kwSandbox = run(sliceBetween(PG_SRC, 'function getText(el) {', 'function QinPagination'));
  await t('elementMatchesKeyword：空关键词全通过；空白归一化；data-search 兜底；大小写不敏感', () => {
    const el = {
      textContent: ' 秦腔《火焰驹》  预约 ', innerText: '',
      getAttribute: k => (k === 'data-search' ? 'ABCDEF' : null)
    };
    assert.strictEqual(kwSandbox.elementMatchesKeyword(el, '火焰驹'), true);
    assert.strictEqual(kwSandbox.elementMatchesKeyword(el, '秦腔'), true);
    assert.strictEqual(kwSandbox.elementMatchesKeyword(el, 'abc'), true); // data-search 兜底
    assert.strictEqual(kwSandbox.elementMatchesKeyword(el, 'XYZ'), false);
    assert.strictEqual(kwSandbox.elementMatchesKeyword(el, ''), true);
    assert.strictEqual(kwSandbox.elementMatchesKeyword(el, null), true);
  });

  // 整文件加载（readyState=loading → 只注册 DOMContentLoaded，不初始化）
  function loadPagination() {
    const created = [];
    const documentStub = {
      readyState: 'loading',
      addEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      createDocumentFragment() { return { tagName: 'FRAGMENT', children: [], appendChild(n) { this.children.push(n); } }; },
      createElement(tag) {
        const el = fakeEl(tag);
        el.type = '';
        el.textContent = '';
        created.push(el);
        return el;
      },
      body: null
    };
    const env = {
      window: null, document: documentStub, console,
      setTimeout: (fn) => fn, // 不会触发，占位
      clearTimeout() {},
      MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
    };
    env.window = env;
    vm.createContext(env);
    vm.runInContext(PG_SRC, env, { filename: 'pagination.js' });
    return env;
  }
  const PG = loadPagination();

  // 页码窗口：直接调 _renderNumbers，收集 wrap 内按钮/省略号序列
  function pageSequence(totalPages, cur) {
    const wrap = { innerHTML: '', children: [], appendChild(frag) { this.children = this.children.concat(frag.children); } };
    const raw = PG.QinPagination._raw;
    raw._renderNumbers({ currentPage: cur, bar: { querySelector: s => (s === '[data-page-numbers]' ? wrap : null) } }, totalPages);
    return wrap.children.map(n => (n.tagName === 'BUTTON' ? Number(n.getAttribute('data-page-num')) : '...'));
  }
  await t('页码窗口：≤7 全列；>7 首末页+当前±2+省略号', () => {
    assert.deepStrictEqual(pageSequence(5, 1), [1, 2, 3, 4, 5]);
    assert.deepStrictEqual(pageSequence(7, 4), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepStrictEqual(pageSequence(10, 1), [1, 2, 3, '...', 10]);
    assert.deepStrictEqual(pageSequence(10, 5), [1, '...', 3, 4, 5, 6, 7, '...', 10]);
    assert.deepStrictEqual(pageSequence(10, 10), [1, '...', 8, 9, 10]);
    assert.deepStrictEqual(pageSequence(8, 1), [1, 2, 3, '...', 8]);
    // 当前页按钮带 active
    const wrap = { innerHTML: '', children: [], appendChild(frag) { this.children = this.children.concat(frag.children); } };
    PG.QinPagination._raw._renderNumbers({ currentPage: 3, bar: { querySelector: s => (s === '[data-page-numbers]' ? wrap : null) } }, 5);
    const active = wrap.children.find(n => n.className.indexOf('active') >= 0);
    assert.strictEqual(active.getAttribute('data-page-num'), '3');
  });

  // _refresh 分页切片集成（伪容器 + 伪 bar）
  function buildRefreshState(n, pageSize, currentPage, extra) {
    const host = fakeEl('tbody');
    for (let i = 0; i < n; i++) host.children.push(fakeEl('div'));
    const info = { textContent: '' };
    const prev = { disabled: null }, next = { disabled: null }, jump = { max: '', value: '' };
    const bar = { querySelector: s => ({
      '[data-page-numbers]': { innerHTML: '', appendChild() {} },
      '[data-page-info]': info,
      '[data-action="prev"]': prev,
      '[data-action="next"]': next,
      '[data-page-jump]': jump
    }[s] || null) };
    const state = Object.assign({ container: host, host, pageSize, currentPage, searchKeyword: '', categoryKey: null, bar }, extra || {});
    return { state, host, info, prev, next };
  }
  await t('_refresh：10 条/页 3 → 第1页显 1-3；出界页码钳到末页；箭头禁用态；info 文案', () => {
    const raw = PG.QinPagination._raw;
    const b1 = buildRefreshState(10, 3, 1);
    raw._refresh(b1.state);
    assert.strictEqual(b1.host.children.filter(el => el.classList.contains('pg-hidden')).length, 7);
    assert.strictEqual(b1.info.textContent, '显示 1-3 共 10 条 · 第 1/4 页');
    assert.strictEqual(b1.prev.disabled, true);
    assert.strictEqual(b1.next.disabled, false);

    const b3 = buildRefreshState(10, 3, 3);
    raw._refresh(b3.state);
    assert.strictEqual(b3.info.textContent, '显示 7-9 共 10 条 · 第 3/4 页');

    const bOver = buildRefreshState(10, 3, 99);
    raw._refresh(bOver.state);
    assert.strictEqual(bOver.state.currentPage, 4); // 钳制
    assert.strictEqual(bOver.info.textContent, '显示 10-10 共 10 条 · 第 4/4 页');
    assert.strictEqual(bOver.next.disabled, true);
  });
  await t('_refresh：0 条 → 暂无数据；总页数至少 1', () => {
    const raw = PG.QinPagination._raw;
    const b = buildRefreshState(0, 10, 1);
    raw._refresh(b.state);
    assert.strictEqual(b.info.textContent, '暂无数据');
    assert.strictEqual(b.prev.disabled, true);
    assert.strictEqual(b.next.disabled, true);
  });
  await t('_getVisibleItems：关键词过滤（含 data-search）', () => {
    const host = fakeEl('tbody');
    const a = fakeEl('div'); a.textContent = '火焰驹 演出';
    const b = fakeEl('div'); b.textContent = '五典坡';
    const c = fakeEl('div'); c.textContent = '内部编号'; c.setAttribute('data-search', '火焰驹');
    host.children.push(a, b, c);
    const raw = PG.QinPagination._raw;
    const st = { container: host, host, searchKeyword: '火焰驹', categoryKey: null };
    const vis = raw._getVisibleItems(st);
    assert.strictEqual(vis.length, 2);
    assert.strictEqual(vis.indexOf(a) >= 0, true);
    assert.strictEqual(vis.indexOf(b) < 0, true);
    assert.strictEqual(vis.indexOf(c) >= 0, true);
  });
  await t('_getVisibleItems：分类过滤——异分类剔除、无分类保留、空占位按其分类决定；all 时占位全隐藏', () => {
    const host = fakeEl('tbody');
    const band = fakeEl('div', 'band');
    const actor = fakeEl('div', 'actor');
    const plain = fakeEl('div');
    const emptyActor = fakeEl('div', 'actor'); emptyActor.classList.add('category-empty');
    const emptyBand = fakeEl('div', 'band'); emptyBand.classList.add('category-empty');
    host.children.push(band, actor, plain, emptyActor, emptyBand);
    const raw = PG.QinPagination._raw;
    const st = k => ({ container: host, host, searchKeyword: '', categoryKey: k });
    const bandView = raw._getVisibleItems(st('band')).map(x => x);
    assert.strictEqual(bandView.length, 3); // band + plain + emptyBand
    assert.strictEqual(bandView.indexOf(actor) < 0, true);
    assert.strictEqual(bandView.indexOf(emptyActor) < 0, true);
    const allView = raw._getVisibleItems(st('all'));
    assert.strictEqual(allView.length, 3); // 两个空占位都隐藏
    assert.strictEqual(allView.indexOf(emptyActor) < 0 && allView.indexOf(emptyBand) < 0, true);
  });
  await t('_getVisibleItems：无关键词时 display:none 且带分类的元素剔除；无分类的保留', () => {
    const host = fakeEl('tbody');
    const hiddenActor = fakeEl('div', 'actor'); hiddenActor.style.display = 'none';
    const hiddenPlain = fakeEl('div'); hiddenPlain.style.display = 'none';
    const shown = fakeEl('div');
    host.children.push(hiddenActor, hiddenPlain, shown);
    const vis = PG.QinPagination._raw._getVisibleItems({ container: host, host, searchKeyword: '', categoryKey: null });
    assert.strictEqual(vis.length, 2);
    assert.strictEqual(vis.indexOf(hiddenActor) < 0, true);
    assert.strictEqual(vis.indexOf(hiddenPlain) >= 0, true);
  });

  /* ==================== year-standard.js ==================== */
  function loadYear(opts) {
    opts = opts || {};
    const store = Object.assign({}, opts.storage);
    const env = {
      console: { info() {}, warn() {}, error() {} },
      localStorage: { getItem: k => (k in store ? store[k] : null), setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; } },
      document: {
        readyState: 'loading', addEventListener() {},
        querySelector: opts.metaQuery || (() => null),
        documentElement: opts.root || null
      },
      Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
      JSON, Date, Math, String, Number, isNaN, parseInt
    };
    env.window = env;
    if (opts.serverYear) env.SERVER_STANDARD_YEAR = opts.serverYear;
    vm.createContext(env);
    vm.runInContext(readJs('year-standard.js'), env, { filename: 'year-standard.js' });
    return env;
  }
  await t('年份优先级：全局变量 > meta > 缓存；命中服务端年份时回写缓存', () => {
    const e1 = loadYear({ serverYear: '2035' });
    assert.strictEqual(e1.YearStandard.getCurrentYear(), 2035);
    assert.ok(JSON.parse(e1.localStorage.getItem('qaxqjt_standard_year_cache')).year === 2035);
    const e2 = loadYear({ metaQuery: sel => (sel === 'meta[name="standard-year"]' ? { getAttribute: k => (k === 'content' ? '2034' : null) } : null) });
    assert.strictEqual(e2.YearStandard.getCurrentYear(), 2034);
    const e3 = loadYear({ storage: { qaxqjt_standard_year_cache: JSON.stringify({ year: 2033, timestamp: Date.now() }) } });
    assert.strictEqual(e3.YearStandard.getCurrentYear(), 2033);
  });
  await t('年份边界：越界(2019/2101)/非数忽略；缓存过期或坏 JSON 回退本地年', () => {
    const e1 = loadYear({
      serverYear: '2019',
      metaQuery: sel => (sel === 'meta[name="standard-year"]' ? { getAttribute: k => (k === 'content' ? '2101' : null) } : null)
    });
    assert.strictEqual(e1.YearStandard.getCurrentYear(), new Date().getFullYear());
    const e2 = loadYear({ storage: { qaxqjt_standard_year_cache: JSON.stringify({ year: 2030, timestamp: Date.now() - 3600001 }) } });
    assert.strictEqual(e2.YearStandard.getCurrentYear(), new Date().getFullYear());
    const e3 = loadYear({ storage: { qaxqjt_standard_year_cache: '{corrupt' } });
    assert.strictEqual(e3.YearStandard.getCurrentYear(), new Date().getFullYear());
    const e4 = loadYear({ serverYear: 'abc' });
    assert.strictEqual(e4.YearStandard.getCurrentYear(), new Date().getFullYear());
  });
  await t('render：文本节点+属性替换计数正确；script/template/style 整棵跳过', () => {
    function textNode(v) { return { nodeType: 3, nodeValue: v, firstChild: null, nextSibling: null }; }
    function elem(tag, attrs, kids) {
      const n = {
        nodeType: 1, tagName: tag.toUpperCase(),
        attributes: attrs || [], firstChild: kids[0] || null,
        setAttribute(k, v) { const a = this.attributes.find(x => x.name === k); if (a) a.value = v; else this.attributes.push({ name: k, value: v }); }
      };
      kids.forEach((k, i) => { k.nextSibling = kids[i + 1] || null; });
      return n;
    }
    const t1 = textNode('版权 {year} 秦腔');
    const spanText = textNode('x{year}y');
    const span = elem('span', [], [spanText]);
    const scriptText = textNode('var y="{year}"');
    const script = elem('script', [], [scriptText]);
    const root = elem('div', [{ name: 'title', value: '© {year}' }], [t1, span, script]);
    const env = loadYear({ serverYear: '2036', root });
    const r = env.YearStandard.render();
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.year, 2036);
    assert.strictEqual(r.replaceCount, 3); // title 属性 + 两个文本节点
    assert.strictEqual(t1.nodeValue, '版权 2036 秦腔');
    assert.strictEqual(spanText.nodeValue, 'x2036y');
    assert.strictEqual(root.attributes[0].value, '© 2036');
    assert.strictEqual(scriptText.nodeValue, 'var y="{year}"'); // 整棵跳过
  });

  /* ==================== real-action-guard.js ==================== */
  function loadGuard(docOverrides) {
    const env = {
      window: null,
      document: Object.assign({ readyState: 'loading', addEventListener() {}, querySelectorAll: () => [] }, docOverrides || {}),
      console, setTimeout: () => 0, clearTimeout() {}
    };
    env.window = env;
    vm.createContext(env);
    vm.runInContext(readJs('real-action-guard.js'), env, { filename: 'real-action-guard.js' });
    return env;
  }
  const FLAGS = ['__superPatchBound', '__ts3Done', '__bindDone', '__ctE2Done', '__deadBtnChecked'];
  await t('guard.scan：匹配元素打全 5 个标记且幂等；非元素节点不动；已有真值保留', () => {
    const g = loadGuard();
    const btn = { nodeType: 1 };
    const preset = { nodeType: 1, __superPatchBound: 9 };
    const text = { nodeType: 3 };
    g.__guardRealActions({ nodeType: 1, matches: () => false, querySelectorAll: () => [btn, preset, text] });
    FLAGS.forEach(f => assert.strictEqual(btn[f], 1, f));
    assert.strictEqual(preset.__superPatchBound, 9); // 已有真值不覆盖
    FLAGS.slice(1).forEach(f => assert.strictEqual(preset[f], 1));
    assert.strictEqual(text.__superPatchBound, undefined);
  });
  await t('guard.scan：根元素自身匹配 SEL 时也打标；querySelectorAll 抛错被吞咽', () => {
    const g1 = loadGuard();
    const root = { nodeType: 1, matches: sel => sel.indexOf('data-act') >= 0, querySelectorAll: () => [] };
    g1.__guardRealActions(root);
    assert.strictEqual(root.__deadBtnChecked, 1);
    const g2 = loadGuard();
    g2.__guardRealActions({ nodeType: 1, matches: () => false, querySelectorAll: () => { throw new Error('boom'); } });
    assert.ok(true); // 不抛即可
  });
  await t('guard：双载幂等（__realActionGuard 已存在时早退，scan 仍可用）', () => {
    const g = loadGuard();
    vm.runInContext(readJs('real-action-guard.js'), g, { filename: 'real-action-guard-2.js' });
    assert.strictEqual(g.__realActionGuard, true);
    const btn = { nodeType: 1 };
    g.__guardRealActions({ nodeType: 1, matches: () => false, querySelectorAll: () => [btn] });
    assert.strictEqual(btn.__superPatchBound, 1);
  });

  /* ==================== year-lite.js ==================== */
  await t('YearLite.getYear 返回当前公历年', () => {
    const env = { window: null, document: { readyState: 'loading', addEventListener() {} }, console, Date };
    env.window = env;
    vm.createContext(env);
    vm.runInContext(readJs('year-lite.js'), env, { filename: 'year-lite.js' });
    assert.strictEqual(env.YearLite.getYear(), new Date().getFullYear());
  });

  /* ==================== real-performers.js ==================== */
  const PERF_SRC = readJs('real-performers.js');
  // 切片需包含 ROLE_RULES/stdRole/GROUP_OF 等闭包依赖（20261002 起 bucket 不再自包含）
  const PERF_SLICE_EXTRA = { window: {}, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, Promise, JSON, Date };
  const bucket = run(sliceBetween(PERF_SRC, 'var ROLE_RULES =', 'function assign(items)'), PERF_SLICE_EXTRA).bucket;
  await t('bucket（20261002 口径）：司鼓/竹笛→wuchang/wenchang；灯光/跟包/龙套→juezi；生旦净丑→各组；未知兜底 juezi', () => {
    assert.strictEqual(bucket('司鼓'), 'wuchang');
    assert.strictEqual(bucket('武二手'), 'wuchang');
    assert.strictEqual(bucket('竹笛'), 'wenchang');
    assert.strictEqual(bucket('文二手'), 'wenchang');
    assert.strictEqual(bucket('灯光'), 'juezi');   // 电工
    assert.strictEqual(bucket('跟包'), 'juezi');   // 衣箱
    assert.strictEqual(bucket('龙套'), 'juezi');
    assert.strictEqual(bucket('丫鬟'), 'juezi');
    assert.strictEqual(bucket('须生'), 'sheng');   // 文须生
    assert.strictEqual(bucket('武生'), 'sheng');   // 武须生
    assert.strictEqual(bucket('正旦'), 'dan');
    assert.strictEqual(bucket('闺门旦'), 'dan');   // 小旦
    assert.strictEqual(bucket('老旦'), 'dan');     // 正旦
    assert.strictEqual(bucket('二架女'), 'dan');   // 二架旦
    assert.strictEqual(bucket('二架男'), 'erjia'); // 门官
    assert.strictEqual(bucket('架子花'), 'jing');  // 二花脸
    assert.strictEqual(bucket('丑婆子'), 'chou');  // /丑/ 规则先于彩旦（与 cast-sheet 基线一致）
    assert.strictEqual(bucket(''), 'juezi');
    assert.strictEqual(bucket('外星岗位'), 'juezi');
  });
  const canonicalBucket = run(sliceBetween(PERF_SRC, 'var ROLE_RULES =', 'function writeCompatibleCache'), PERF_SLICE_EXTRA).canonicalBucket;
  await t('canonicalBucket=stdRole：22 岗自映射；旧值归一（老生→文须生、青衣→正旦、花脸→二花脸）；未知→前场', () => {
    assert.strictEqual(canonicalBucket('司鼓'), '武场');
    assert.strictEqual(canonicalBucket('竹笛'), '文场');
    assert.strictEqual(canonicalBucket('灯光'), '电工');
    assert.strictEqual(canonicalBucket('跟包'), '衣箱');
    assert.strictEqual(canonicalBucket('红生'), '武须生');
    assert.strictEqual(canonicalBucket('老生'), '文须生');
    assert.strictEqual(canonicalBucket('武生'), '武须生');
    assert.strictEqual(canonicalBucket('正旦'), '正旦');
    assert.strictEqual(canonicalBucket('青衣'), '正旦');
    assert.strictEqual(canonicalBucket('花脸'), '二花脸');
    assert.strictEqual(canonicalBucket('丑婆'), '丑角'); // /丑/ 规则位置先于彩旦（基线锁定）
    assert.strictEqual(canonicalBucket('小丑'), '丑角');
    assert.strictEqual(canonicalBucket('须生'), '文须生');
    assert.strictEqual(canonicalBucket('门官'), '门官');
    assert.strictEqual(canonicalBucket('武场'), '武场'); // 字面量自映射
    assert.strictEqual(canonicalBucket('文场'), '文场');
    assert.strictEqual(canonicalBucket('未知'), '前场');
  });
  function loadPerformers(store, api) {
    const env = {
      window: null, console,
      localStorage: { getItem: k => (k in store ? store[k] : null), setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; } },
      JSON, Promise, Date
    };
    env.window = env;
    if (api) env.QAXQJT_API = api;
    vm.createContext(env);
    vm.runInContext(PERF_SRC, env, { filename: 'real-performers.js' });
    return env;
  }
  await t('无缓存无 API：8 个分组全空（零假数据契约）', () => {
    const env = loadPerformers({});
    const g = env.QinRealPerformers.groups;
    assert.strictEqual(Object.keys(g).length, 8);
    assert.strictEqual(g.wuchang.length, 0);
    assert.strictEqual(g.sheng.length, 0);
  });
  await t('v2 缓存装载：skill→分组；同名去重；武场/文场分列；未知岗位归 juezi（前场）', async () => {
    const cache = {
      _version: 2,
      flat: [
        { name: '张三', skill: '竹笛' },
        { name: '张三', skill: '二胡' },          // 同名去重
        { name: '李四', skill: '司鼓' },
        { name: '王五', skill: '须生' },
        { name: '赵六', skill: '外卖配送' }   // 未知岗位→前场→juezi
      ]
    };
    const env = loadPerformers({ qaxqjt_performers_v1: JSON.stringify(cache) });
    await env.QinRealPerformers.ready;
    const g = env.QinRealPerformers.groups;
    assert.strictEqual(g.wenchang.length, 1); // 张三（竹笛，同名去重后）
    assert.strictEqual(g.wenchang[0].name, '张三');
    assert.strictEqual(g.wenchang[0].role, '竹笛');
    assert.strictEqual(g.wenchang[0].stdRole, '文场');
    assert.strictEqual(g.wuchang.length, 1); // 李四（司鼓）
    assert.strictEqual(g.wuchang[0].name, '李四');
    assert.strictEqual(g.sheng.length, 1);
    assert.strictEqual(g.sheng[0].name, '王五');
    assert.strictEqual(g.juezi.length, 1);
    assert.strictEqual(g.juezi[0].name, '赵六');
  });
  await t('API 路径：performerName/roleCategory 兜底字段同样可用；数组响应与 {items} 两种信封', async () => {
    const envA = loadPerformers({}, { get: async () => [{ performerName: '钱七', roleCategory: '外卖配送' }] });
    await envA.QinRealPerformers.ready;
    assert.strictEqual(envA.QinRealPerformers.groups.juezi[0].name, '钱七');
    const envB = loadPerformers({}, { get: async () => ({ items: [{ name: '孙八', role: '梆子' }] }) });
    await envB.QinRealPerformers.ready;
    assert.strictEqual(envB.QinRealPerformers.groups.wuchang[0].name, '孙八');
    // API 失败保持空态，绝不造假数据
    const envC = loadPerformers({}, { get: async () => { throw new Error('network down'); } });
    await envC.QinRealPerformers.ready;
    let total = 0;
    Object.keys(envC.QinRealPerformers.groups).forEach(k => { total += envC.QinRealPerformers.groups[k].length; });
    assert.strictEqual(total, 0);
  });
  await t('缓存坏 JSON / 非 v2 schema 安全忽略，保持空态', async () => {
    const e1 = loadPerformers({ qaxqjt_performers_v1: '{bad' });
    await e1.QinRealPerformers.ready;
    assert.strictEqual(e1.QinRealPerformers.groups.wuchang.length, 0);
    const e2 = loadPerformers({ qaxqjt_performers_v1: JSON.stringify({ _version: 1, flat: [] }) });
    await e2.QinRealPerformers.ready;
    assert.strictEqual(e2.QinRealPerformers.groups.wuchang.length, 0);
  });

  /* ==================== wechat-fallback.js shouldShowTip ==================== */
  const WX_SRC = readJs('wechat-fallback.js');
  const wxStore = {};
  const wxSandbox = run(sliceBetween(WX_SRC, 'function shouldShowTip() {', 'function closeTip()'), {
    STORAGE_KEY: 'qaxqjt_wx_tip_closed_at',
    TIP_TTL_MS: 7 * 24 * 3600 * 1000,
    Date,
    localStorage: { getItem: k => (k in wxStore ? wxStore[k] : null) },
    location: { pathname: '/index.html' }
  });
  const shouldShowTip = wxSandbox.shouldShowTip;
  const wxCheck = (pathname, closedAt) => {
    wxSandbox.location.pathname = pathname;
    delete wxStore.qaxqjt_wx_tip_closed_at;
    if (closedAt !== undefined) wxStore.qaxqjt_wx_tip_closed_at = String(closedAt);
    return shouldShowTip();
  };
  await t('shouldShowTip：直播/预订/服务页常显；其他页 7 天 TTL；异常默认显示', () => {
    const now = Date.now();
    assert.strictEqual(wxCheck('/live-api.html', now), true);
    assert.strictEqual(wxCheck('/booking/index.html', now), true);
    assert.strictEqual(wxCheck('/services.html', now), true);
    assert.strictEqual(wxCheck('/index.html', now), false);
    assert.strictEqual(wxCheck('/index.html', now - 7 * 24 * 3600 * 1000 - 1), true);
    assert.strictEqual(wxCheck('/index.html', undefined), true);
    wxSandbox.localStorage = { getItem() { throw new Error('denied'); } };
    assert.strictEqual(wxCheck('/index.html', now), true);
  });

  /* ==================== 汇总 ==================== */
  const failed = results.filter(r => !r.ok);
  console.log('\n========================================');
  console.log('总计 ' + results.length + ' 项：✓ ' + (results.length - failed.length) + ' 通过，✗ ' + failed.length + ' 失败');
  if (failed.length) {
    failed.forEach(r => { console.error('\n[FAIL] ' + r.name); console.error(r.err && r.err.stack || r.err); });
    process.exit(1);
  }
  console.log('全部通过');
})().catch(e => { console.error(e); process.exit(1); });
