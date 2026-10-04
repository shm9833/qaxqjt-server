/* tests/js-core.unit.spec.js — js/api-config.js + js/api-request.js 单元测试
 *
 * 用法：node tests/js-core.unit.spec.js
 * 依赖：无（Node 内置 vm/assert/fs；整文件实时加载，不复制代码）
 *
 * 覆盖：
 *   api-config   BASE 解析优先级（全局变量/localStorage/EdgeOne/https/同源）、
 *                resolveUrl 拼接、token/user 存取与异常容错、fallback 开关、PATHS
 *   api-request  Bearer 注入、querystring、信封解包、204/JSON 解析失败、
 *                业务错误、401→refresh 单次重试（含并发锁/无 refresh token 踢登录）、
 *                网络失败 GET 离线降级/写降级、强制离线模式、credentials 同源策略、
 *                login/logout 副作用、isNetworkHealthy
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const JS = path.join(__dirname, '..', 'js');
const SRC_CONFIG = fs.readFileSync(path.join(JS, 'api-config.js'), 'utf8');
const SRC_REQUEST = fs.readFileSync(path.join(JS, 'api-request.js'), 'utf8');

const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓ ' + name); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}

/* ---- 手工环境：内存 localStorage + 可控 timer + 可脚本化 fetch ---- */
function makeEnv(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.storage);
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  if (opts.storageThrows) {
    localStorage.getItem = () => { throw new Error('SecurityError'); };
    localStorage.setItem = () => { throw new Error('SecurityError'); };
    localStorage.removeItem = () => { throw new Error('SecurityError'); };
  }
  const timers = [];
  const env = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    localStorage,
    location: opts.location || { hostname: 'localhost', protocol: 'http:', pathname: '/index.html', origin: 'http://localhost', href: '' },
    setTimeout: (fn, ms) => { const id = { fn, ms, cancelled: false }; timers.push(id); return id; },
    clearTimeout: id => { if (id) id.cancelled = true; },
    AbortController: function () { this.signal = { aborted: false }; this.abort = () => { this.signal.aborted = true; }; },
    toasts: [],
    showToast: (msg, type) => { env.toasts.push({ msg, type }); }
  };
  env.flushTimers = function () {
    // 按延时升序执行；执行中新入队的下一轮继续处理
    let guard = 0;
    while (guard++ < 50) {
      const pending = timers.filter(x => !x.cancelled && !x.done).sort((a, b) => a.ms - b.ms);
      if (!pending.length) break;
      pending.forEach(x => { x.done = true; x.fn(); });
    }
  };
  env.calls = [];
  env.fetchImpl = opts.fetch || (async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: null }) }));
  env.fetch = async function (url, init) {
    env.calls.push({ url, init });
    return env.fetchImpl(url, init, env.calls.length);
  };
  if (opts.globalBase) env.__QAXQJT_API_BASE__ = opts.globalBase;
  env.window = env;
  vm.createContext(env);
  vm.runInContext(SRC_CONFIG, env, { filename: 'api-config.js' });
  vm.runInContext(SRC_REQUEST, env, { filename: 'api-request.js' });
  return env;
}
const jsonRes = (status, body, extra) => Object.assign({
  ok: status >= 200 && status < 300, status, json: async () => body
}, extra || {});
async function rejects(p) {
  try { await p; } catch (e) { return e; }
  throw new Error('预期被拒绝，却正常 resolve');
}

(async () => {
  console.log('js-core.unit.spec — api-config + api-request\n');

  /* ==================== api-config：BASE 解析与 URL 拼接 ==================== */
  await t('BASE 优先级1：window.__QAXQJT_API_BASE__ 取胜并去尾斜杠', () => {
    const env = makeEnv({ globalBase: 'https://edge.example.com/proxy///', storage: { qaxqjt_api_base_url: 'http://ignored:9' } });
    assert.strictEqual(env.QAXQJT_API_CONFIG.BASE, 'https://edge.example.com/proxy');
    assert.strictEqual(env.QAXQJT_API_CONFIG.resolveUrl('/v1/orders'), 'https://edge.example.com/proxy/v1/orders');
  });
  await t('BASE 优先级2：localStorage 的 http(s) 地址生效并去尾斜杠；非 http 值忽略', () => {
    const env1 = makeEnv({ storage: { qaxqjt_api_base_url: 'http://1.2.3.4:3001///' } });
    assert.strictEqual(env1.QAXQJT_API_CONFIG.BASE, 'http://1.2.3.4:3001');
    const env2 = makeEnv({ storage: { qaxqjt_api_base_url: '/api' }, location: { hostname: 'localhost', protocol: 'http:' } });
    assert.strictEqual(env2.QAXQJT_API_CONFIG.BASE, '');
  });
  await t('BASE 优先级3/4：EdgeOne 域名同源；其他 https 页→固定 IP；http 页→同源', () => {
    const eo = makeEnv({ location: { hostname: 'demo.edgeone.app', protocol: 'https:' } });
    assert.strictEqual(eo.QAXQJT_API_CONFIG.BASE, '');
    const eoDev = makeEnv({ location: { hostname: 'x.edgeone.dev', protocol: 'https:' } });
    assert.strictEqual(eoDev.QAXQJT_API_CONFIG.BASE, '');
    const https = makeEnv({ location: { hostname: 'raw.github.com', protocol: 'https:' } });
    assert.strictEqual(https.QAXQJT_API_CONFIG.BASE, 'https://1.14.106.173');
    const http = makeEnv({ location: { hostname: '1.14.106.173', protocol: 'http:' } });
    assert.strictEqual(http.QAXQJT_API_CONFIG.BASE, '');
  });
  await t('resolveUrl：空路径→空串；绝对 URL 原样；同源→/api 前缀；BASE 拼接补斜杠', () => {
    const env = makeEnv();
    const R = env.QAXQJT_API_CONFIG.resolveUrl;
    assert.strictEqual(R(''), '');
    assert.strictEqual(R(null), '');
    assert.strictEqual(R('https://other.com/x'), 'https://other.com/x');
    assert.strictEqual(R('/v1/orders'), '/api/v1/orders');
    const env2 = makeEnv({ globalBase: 'https://api.x.com' });
    assert.strictEqual(env2.QAXQJT_API_CONFIG.resolveUrl('v1/orders'), 'https://api.x.com/v1/orders');
    // 行为锁定：同源模式下无前导斜杠的 path 会拼成 /apixxx（实际调用方均以 / 开头）
    assert.strictEqual(R('v1/orders'), '/apiv1/orders');
  });
  await t('PATHS：资源路径常量与带参构造器', () => {
    const P = makeEnv().QAXQJT_API_CONFIG.PATHS;
    assert.strictEqual(P.ORDERS, '/v1/orders');
    assert.strictEqual(P.CUSTOMERS_BY_ID(42), '/v1/customers/42');
    assert.strictEqual(P.APPOINTMENTS_TRANSITION('ab-1'), '/v1/appointments/ab-1/transition');
    assert.strictEqual(P.ROLE_PERMISSIONS(7), '/v1/roles/7/permissions');
  });

  /* ==================== api-config：token / user / fallback 存取 ==================== */
  await t('access/refresh token 存取；缺省 null', () => {
    const env = makeEnv();
    const C = env.QAXQJT_API_CONFIG;
    assert.strictEqual(C.getAccessToken(), null);
    C.setAccessToken('at-1');
    C.setRefreshToken('rt-1');
    assert.strictEqual(C.getAccessToken(), 'at-1');
    assert.strictEqual(C.getRefreshToken(), 'rt-1');
    C.setAccessToken(''); // 写空串；读取端 || null 归一化为 null
    assert.strictEqual(C.getAccessToken(), null);
  });
  await t('currentUser：JSON 往返；非法 JSON→null；置 null 删除键', () => {
    const env = makeEnv();
    const C = env.QAXQJT_API_CONFIG;
    C.setCurrentUser({ id: 3, name: '管理员', roles: ['admin'] });
    assert.strictEqual(C.getCurrentUser().name, '管理员');
    C.setCurrentUser(null);
    assert.strictEqual(C.getCurrentUser(), null);
    env.localStorage.setItem('qaxqjt_current_user', '{bad json');
    assert.strictEqual(C.getCurrentUser(), null);
  });
  await t('clearAuth 清空三键；fallback 仅 1/true 为真', () => {
    const env = makeEnv();
    const C = env.QAXQJT_API_CONFIG;
    C.setAccessToken('a'); C.setRefreshToken('b'); C.setCurrentUser({ id: 1 });
    C.clearAuth();
    assert.strictEqual(C.getAccessToken(), null);
    assert.strictEqual(C.getRefreshToken(), null);
    assert.strictEqual(C.getCurrentUser(), null);
    assert.strictEqual(C.isFallbackMode(), false);
    C.setFallbackMode(true);
    assert.strictEqual(C.isFallbackMode(), true);
    env.localStorage.setItem('qaxqjt_fallback_mode', 'true');
    assert.strictEqual(C.isFallbackMode(), true);
    C.setFallbackMode(false);
    assert.strictEqual(C.isFallbackMode(), false);
  });
  await t('localStorage 整体抛错时所有存取方法安全降级、不炸', () => {
    const env = makeEnv({ storageThrows: true });
    const C = env.QAXQJT_API_CONFIG;
    assert.strictEqual(C.getAccessToken(), null);
    assert.strictEqual(C.getRefreshToken(), null);
    assert.strictEqual(C.getCurrentUser(), null);
    assert.strictEqual(C.isFallbackMode(), false);
    C.setAccessToken('x'); C.setCurrentUser({ id: 1 }); C.setFallbackMode(true); C.clearAuth();
    assert.ok(true);
  });

  /* ==================== api-request：请求构造 ==================== */
  await t('GET 信封解包：{ok,data} → data；自动带 Bearer 与同源 credentials', async () => {
    const env = makeEnv({ storage: { qaxqjt_access_token: 'tok-1' } });
    const data = await env.QAXQJT_API.get('/v1/orders');
    assert.strictEqual(data, null); // 默认桩返回 data:null
    const call = env.calls[0];
    assert.strictEqual(call.url, '/api/v1/orders');
    assert.strictEqual(call.init.method, 'GET');
    assert.strictEqual(call.init.headers['Authorization'], 'Bearer tok-1');
    assert.strictEqual(call.init.headers['Accept'], 'application/json');
    assert.strictEqual(call.init.credentials, 'same-origin');
    // 跨源 BASE 时 credentials=include
    const env2 = makeEnv({ globalBase: 'https://api.x.com' });
    await env2.QAXQJT_API.get('/v1/orders');
    assert.strictEqual(env2.calls[0].init.credentials, 'include');
    assert.strictEqual(env2.calls[0].url, 'https://api.x.com/v1/orders');
  });
  await t('querystring：跳过空值、数组重复键、中文/空格编码，按 key 顺序', async () => {
    const env = makeEnv();
    await env.QAXQJT_API.get('/v1/performers', { query: { page: 2, pageSize: 10, kw: '秦 安', empty: '', none: null, und: undefined, roles: ['a', 'b'] } });
    const expected = '?page=2&pageSize=10&kw=' + encodeURIComponent('秦 安') + '&roles=a&roles=b';
    assert.strictEqual(env.calls[0].url, '/api/v1/performers' + expected);
  });
  await t('POST 对象 body→JSON+Content-Type；字符串原样；skipAuth 不带 token；无 body 不设 CT', async () => {
    const env = makeEnv({ storage: { qaxqjt_access_token: 'tok' } });
    await env.QAXQJT_API.post('/v1/orders', { name: '火焰驹', n: 2 });
    const post = env.calls[0].init;
    assert.strictEqual(post.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.strictEqual(JSON.parse(post.body).name, '火焰驹');
    await env.QAXQJT_API.request('POST', '/v1/x', { body: 'raw-string' });
    assert.strictEqual(env.calls[1].init.body, 'raw-string');
    await env.QAXQJT_API.request('GET', '/v1/y', { skipAuth: true });
    assert.strictEqual(env.calls[2].init.headers['Authorization'], undefined);
    assert.strictEqual(env.calls[2].init.headers['Content-Type'], undefined);
  });
  await t('204 不解析 body；JSON 解析失败按成功返回 null', async () => {
    const env204 = makeEnv({ fetch: async () => ({ ok: true, status: 204 }) });
    assert.strictEqual(await env204.QAXQJT_API.get('/v1/x'), undefined);
    let parsed = false;
    const envBad = makeEnv({ fetch: async () => ({ ok: true, status: 200, json: async () => { parsed = true; throw new Error('Unexpected token'); } }) });
    assert.strictEqual(await envBad.QAXQJT_API.get('/v1/x'), null);
    assert.strictEqual(parsed, true);
  });

  /* ==================== api-request：错误分支 ==================== */
  await t('业务错误（非 2xx）：throw 带 status/code/detail，showErrorToast:false 静默', async () => {
    const env = makeEnv({ fetch: async () => jsonRes(400, { ok: false, error: { message: '库存不足', code: 'INV_LOW', detail: '行头' } }) });
    const e1 = await rejects(env.QAXQJT_API.get('/v1/inventory'));
    assert.strictEqual(e1.status, 400);
    assert.strictEqual(e1.code, 'INV_LOW');
    assert.strictEqual(e1.message, '库存不足');
    assert.strictEqual(e1.detail, '行头');
    assert.strictEqual(env.toasts.length, 1);
    const envSilent = makeEnv({ fetch: async () => jsonRes(500, { ok: false, error: { message: '炸了' } }) });
    await rejects(envSilent.QAXQJT_API.get('/v1/x', { showErrorToast: false }));
    assert.strictEqual(envSilent.toasts.length, 0);
    // 无 error.message 时回退 HTTP <status>
    const envPlain = makeEnv({ fetch: async () => jsonRes(503, {}) });
    const e3 = await rejects(envPlain.QAXQJT_API.get('/v1/x'));
    assert.strictEqual(e3.message, 'HTTP 503');
    assert.strictEqual(e3.code, 'HTTP_503');
  });
  await t('401 有 refresh token：换新 token 后原请求重试一次（共 3 次请求）', async () => {
    const env = makeEnv({
      storage: { qaxqjt_access_token: 'old', qaxqjt_refresh_token: 'rt' },
      fetch: async (url) => {
        if (url === '/api/v1/auth/refresh') return jsonRes(200, { ok: true, data: { accessToken: 'new' } });
        if (env.calls.length <= 1) return jsonRes(401, { ok: false, error: { message: '未授权' } });
        return jsonRes(200, { ok: true, data: { id: 77 } });
      }
    });
    const data = await env.QAXQJT_API.get('/v1/orders/5');
    assert.strictEqual(data.id, 77);
    assert.strictEqual(env.calls.length, 3);
    assert.strictEqual(env.calls[1].url, '/api/v1/auth/refresh');
    assert.strictEqual(env.calls[2].init.headers['Authorization'], 'Bearer new');
    assert.strictEqual(env.localStorage.getItem('qaxqjt_access_token'), 'new');
  });
  await t('401 并发请求共享同一次 refresh（串行锁）', async () => {
    const env = makeEnv({
      storage: { qaxqjt_access_token: 'old', qaxqjt_refresh_token: 'rt' },
      fetch: async (url) => {
        if (url.indexOf('/auth/refresh') >= 0) return jsonRes(200, { ok: true, data: { accessToken: 'new2' } });
        const auth = env.calls[env.calls.length - 1].init.headers['Authorization'] || '';
        if (auth === 'Bearer new2') return jsonRes(200, { ok: true, data: { ok: 1 } });
        return jsonRes(401, { ok: false, error: { message: '401' } });
      }
    });
    const rs = await Promise.all([
      env.QAXQJT_API.get('/v1/orders/1'),
      env.QAXQJT_API.get('/v1/orders/2')
    ]);
    assert.deepStrictEqual(rs, [{ ok: 1 }, { ok: 1 }]);
    const refreshCalls = env.calls.filter(c => c.url === '/api/v1/auth/refresh').length;
    assert.strictEqual(refreshCalls, 1);
  });
  await t('401 无 refresh token：清登录态并 800ms 后跳 admin/login.html；login 接口自身不刷新', async () => {
    const env = makeEnv({
      location: { hostname: 'h', protocol: 'http:', pathname: '/admin/orders.html', origin: 'http://h', href: '' },
      fetch: async () => jsonRes(401, { ok: false, error: { message: '未授权' } })
    });
    await rejects(env.QAXQJT_API.get('/v1/orders'));
    assert.strictEqual(env.calls.length, 1); // 没有 refresh 请求
    assert.strictEqual(env.localStorage.getItem('qaxqjt_access_token'), null);
    assert.strictEqual(env.location.href, '');
    env.flushTimers();
    assert.strictEqual(env.location.href, 'login.html');
    // 前台页被踢 → 绝对路径
    const envPub = makeEnv({
      location: { hostname: 'h', protocol: 'http:', pathname: '/booking.html', origin: 'http://h', href: '' },
      fetch: async () => jsonRes(401, { ok: false, error: {} })
    });
    await rejects(envPub.QAXQJT_API.get('/v1/appointments'));
    envPub.flushTimers();
    assert.strictEqual(envPub.location.href, 'http://h/admin/login.html');
    // /auth/login 自身 401：不触发 refresh、不跳转
    const envLogin = makeEnv({
      location: { hostname: 'h', protocol: 'http:', pathname: '/admin/login.html', origin: 'http://h', href: '' },
      storage: { qaxqjt_refresh_token: 'rt' },
      fetch: async () => jsonRes(401, { ok: false, error: { message: '密码错误' } })
    });
    await rejects(envLogin.QAXQJT_API.login('u', 'p'));
    assert.strictEqual(envLogin.calls.length, 1);
    assert.strictEqual(envLogin.location.href, '');
  });
  await t('refresh 失败：清登录态 + 跳登录 + 原请求抛 401', async () => {
    const env = makeEnv({
      location: { hostname: 'h', protocol: 'http:', pathname: '/admin/orders.html', origin: 'http://h', href: '' },
      storage: { qaxqjt_access_token: 'old', qaxqjt_refresh_token: 'bad' },
      fetch: async (url) => url.indexOf('/auth/refresh') >= 0
        ? jsonRes(401, { ok: false })
        : jsonRes(401, { ok: false, error: { message: '未授权' } })
    });
    const e = await rejects(env.QAXQJT_API.get('/v1/orders'));
    assert.strictEqual(e.status, 401);
    assert.strictEqual(env.localStorage.getItem('qaxqjt_refresh_token'), null);
    env.flushTimers();
    assert.strictEqual(env.location.href, 'login.html');
  });

  /* ==================== api-request：离线降级 ==================== */
  await t('GET 网络失败：走 fallbackRead、置离线标志、网络健康转 false', async () => {
    const env = makeEnv({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
    let reason = null;
    const out = await env.QAXQJT_API.get('/v1/orders', { fallbackRead: async (ctx) => { reason = ctx.reason; return [{ local: 1 }]; } });
    assert.strictEqual(reason, 'network_fail');
    assert.strictEqual(out[0].local, 1);
    assert.strictEqual(env.localStorage.getItem('qaxqjt_fallback_mode'), '1');
    assert.strictEqual(env.QAXQJT_API.isNetworkHealthy(), false);
  });
  await t('写请求网络失败：无 fallback 则抛错；有 fallback 才降级；成功后健康恢复', async () => {
    const env = makeEnv({ fetch: async () => { throw new TypeError('NetworkError when fetch'); } });
    await rejects(env.QAXQJT_API.post('/v1/orders', { x: 1 }));
    const r = await env.QAXQJT_API.post('/v1/orders', { x: 1 }, { fallback: async ctx => ({ saved: true, reason: ctx.reason }) });
    assert.strictEqual(r.saved, true);
    assert.strictEqual(r.reason, 'network_fail');
    env.fetchImpl = async () => jsonRes(200, { ok: true, data: 'ok' });
    assert.strictEqual(await env.QAXQJT_API.get('/v1/ping', { fallbackRead: async () => 'z' }), 'ok');
    assert.strictEqual(env.QAXQJT_API.isNetworkHealthy(), true);
  });
  await t('强制离线模式：不发请求，直接走 fallbackRead/fallback（reason=force_fallback）', async () => {
    const env = makeEnv({ storage: { qaxqjt_fallback_mode: '1' } });
    const r1 = await env.QAXQJT_API.get('/v1/orders', { fallbackRead: async ctx => ctx.reason });
    const r2 = await env.QAXQJT_API.post('/v1/orders', { x: 1 }, { fallback: async ctx => ctx.reason });
    assert.strictEqual(r1, 'force_fallback');
    assert.strictEqual(r2, 'force_fallback');
    assert.strictEqual(env.calls.length, 0);
  });

  /* ==================== api-request：login / logout ==================== */
  await t('login 成功：写 token/refresh/user；logout 清理且不再请求（错误被吞）', async () => {
    const env = makeEnv({
      location: { hostname: 'h', protocol: 'http:', pathname: '/admin/index.html', origin: 'http://h', href: '' },
      fetch: async (url) => {
        if (url === '/api/v1/auth/login') return jsonRes(200, { ok: true, data: { accessToken: 'A', refreshToken: 'R', user: { id: 9, name: '团长' } } });
        return jsonRes(200, { ok: true });
      }
    });
    const r = await env.QAXQJT_API.login('admin', 'pwd', 'CAP');
    assert.strictEqual(r.user.name, '团长');
    assert.strictEqual(env.localStorage.getItem('qaxqjt_access_token'), 'A');
    assert.strictEqual(env.localStorage.getItem('qaxqjt_refresh_token'), 'R');
    assert.strictEqual(JSON.parse(env.localStorage.getItem('qaxqjt_current_user')).id, 9);
    // login 请求体含三字段且 skipAuth
    assert.strictEqual(JSON.parse(env.calls[0].init.body).captcha, 'CAP');
    assert.strictEqual(env.calls[0].init.headers['Authorization'], undefined);
    await env.QAXQJT_API.logout();
    assert.strictEqual(env.localStorage.getItem('qaxqjt_access_token'), null);
    assert.strictEqual(env.calls.length, 2); // login + logout
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
