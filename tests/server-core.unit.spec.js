/* tests/server-core.unit.spec.js — server/src 配置/密码学/响应/校验/错误兜底/鉴权/请求日志
 *
 * 用法：node tests/server-core.unit.spec.js
 * 依赖：测试自身零依赖（Node 内置 assert/fs/path）；被测模块按真实 require 加载
 *      （其自身依赖 joi/bcryptjs/jsonwebtoken/nanoid 等为 server 已安装依赖，不连数据库/网络）
 *
 * 覆盖：
 *   config            env 默认值/校验降级、idByCtx 前缀与长度、CORS 解析、nowMs
 *   utils/crypto      bcrypt 往返/坏 hash、JWT access/refresh 签发校验、串钥拒绝、jti/iss/aud
 *   utils/response    success/fail/created/noContent、生产隐藏 detail、pageMeta 边界
 *   middleware/validate  body/query/paginate/params、默认值/剥离未知/非法抛 Joi
 *   middleware/error-handler 404/401/Joi/Prisma 三码/BusinessError/未知500
 *   middleware/auth   isPublic、requireAuth 载荷映射与匿名策略、requireRole 精确名单、corsOrigin
 *   middleware/request-log traceId/密码脱敏/状态级别
 */

'use strict';

/* 必须在 require 任何 server 模块前就位（config 在加载时校验 process.env） */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/qaxqjt_unit';
process.env.JWT_ACCESS_SECRET = 'unit_test_access_secret_0123456789';
process.env.JWT_REFRESH_SECRET = 'unit_test_refresh_secret_0123456789';
process.env.BCRYPT_ROUNDS = '8'; // 单测加速（生产默认 12）

const assert = require('assert');
const path = require('path');

const SRC = path.join(__dirname, '..', 'server', 'src');
const config = require(path.join(SRC, 'config'));
const cryptoUtil = require(path.join(SRC, 'utils', 'crypto'));
const resp = require(path.join(SRC, 'utils', 'response'));
const { validate, Joi } = require(path.join(SRC, 'middleware', 'validate'));
const { errorHandler, BusinessError, ERROR_MAP } = require(path.join(SRC, 'middleware', 'error-handler'));
const auth = require(path.join(SRC, 'middleware', 'auth'));

const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓ ' + name); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}

const makeCtx = () => ({ status: 200, body: undefined, method: 'GET', path: '/v1/x', ip: '127.0.0.1', state: {}, request: { headers: {} } });
async function runHandler(ctx, next) { const mw = errorHandler(); await mw(ctx, next || (async () => {})); }

(async () => {
  console.log('server-core.unit.spec — config / crypto / response / validate / error-handler / auth\n');

  /* ==================== config ==================== */
  await t('env：test 环境标识与关键默认值（端口/版本/TTL/轮次/复核阈值）', () => {
    assert.strictEqual(config.isTest, true);
    assert.strictEqual(config.isDev, false);
    assert.strictEqual(config.isProd, false);
    assert.strictEqual(config.env.APP_PORT, 3001);
    assert.strictEqual(config.env.APP_VERSION, 'V2026.8.3');
    assert.strictEqual(config.env.JWT_ACCESS_TTL_MIN, 30);
    assert.strictEqual(config.env.JWT_REFRESH_TTL_DAY, 7);
    assert.strictEqual(config.env.BCRYPT_ROUNDS, 8); // 来自 process.env
    assert.strictEqual(config.env.FIN_DOUBLE_CHECK_ABOVE, 10000);
    assert.strictEqual(config.env.JWT_ISSUER, 'qaxqjt-cloud');
    assert.strictEqual(config.env.JWT_AUDIENCE, 'qaxqjt-admin-front');
    assert.strictEqual(typeof config.nowMs(), 'number');
    assert.ok(config.nowMs() <= Date.now());
  });
  await t('idByCtx：已知表前缀缩写；未知前缀原样；tail 长度=size 且去除 -/_；随机兜底为字母数字', () => {
    const det = n => ('ab-cd_efGH12'.repeat(2)).slice(0, n);
    assert.strictEqual(config.idByCtx('order', 12, det), 'ord_' + 'ab-cd_efGH12'.replace(/-|_/g, ''));
    assert.strictEqual(config.idByCtx('unknownBiz', 4, det), 'unknownBiz_' + 'ab-c'.replace(/-|_/g, ''));
    const id = config.idByCtx('account', 20); // 无 nanoid → randomAlpha
    assert.ok(/^acc_[A-Za-z0-9]{20}$/.test(id), id);
    const id2 = config.idByCtx('wageBatch', 8, () => '--------');
    assert.strictEqual(id2, 'wba_'); // 全是被剥字符 → 空尾（行为锁定）
  });
  await t('CORS_ORIGINS：逗号分隔/空白裁剪/空项过滤（独立重新加载 config 验证）', () => {
    const cfgPath = require.resolve(path.join(SRC, 'config'));
    const savedOrigins = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = ' https://a.com , ,https://b.com,  ';
    delete require.cache[cfgPath];
    const fresh = require(cfgPath);
    assert.deepStrictEqual(fresh.CORS_ORIGINS_ARRAY, ['https://a.com', 'https://b.com']);
    // 还原缓存为 test 主 config，避免污染后续模块
    delete require.cache[cfgPath];
    if (savedOrigins === undefined) delete process.env.CORS_ORIGINS; else process.env.CORS_ORIGINS = savedOrigins;
    require(cfgPath);
  });

  /* ==================== utils/crypto ==================== */
  await t('bcrypt：hash/verify 往返；错密码 false；坏 hash 不抛错返回 false', async () => {
    const h = await cryptoUtil.hashPassword('QinOpera@2026');
    assert.notStrictEqual(h, 'QinOpera@2026');
    assert.ok(h.startsWith('$2'));
    assert.strictEqual(await cryptoUtil.verifyPassword('QinOpera@2026', h), true);
    assert.strictEqual(await cryptoUtil.verifyPassword('wrong', h), false);
    assert.strictEqual(await cryptoUtil.verifyPassword('x', 'not-a-bcrypt-hash'), false);
    assert.strictEqual(await cryptoUtil.verifyPassword('x', ''), false);
  });
  await t('JWT access：签发可校验、claims 与 iss/aud 正确；篡改/串 refresh 钥均拒绝', () => {
    const tok = cryptoUtil.signAccess({ sub: 'acc_1', username: 'admin', role: 'super_admin' });
    const payload = cryptoUtil.verifyAccess(tok);
    assert.strictEqual(payload.sub, 'acc_1');
    assert.strictEqual(payload.iss, 'qaxqjt-cloud');
    assert.strictEqual(payload.aud, 'qaxqjt-admin-front');
    assert.throws(() => cryptoUtil.verifyAccess(tok.slice(0, -3) + 'xxx')); // 签名被改
    assert.throws(() => cryptoUtil.verifyRefresh(tok));                     // access 不能当 refresh
  });
  await t('JWT refresh：jti 为 sess_ 会话号；串 access 钥拒绝', () => {
    const tok = cryptoUtil.signRefresh({ sub: 'acc_1' });
    const payload = cryptoUtil.verifyRefresh(tok);
    assert.ok(/^sess_[A-Za-z0-9]+$/.test(payload.jti), payload.jti);
    assert.strictEqual(payload.sub, 'acc_1');
    assert.throws(() => cryptoUtil.verifyAccess(tok));
  });

  /* ==================== utils/response ==================== */
  await t('success/created/noContent：信封字段、状态码、traceId 透传', () => {
    const ctx = makeCtx(); ctx.state.traceId = 'tr_x';
    resp.success(ctx, { id: 1 }, { page: 1 });
    assert.strictEqual(ctx.status, 200);
    assert.strictEqual(ctx.body.ok, true);
    assert.deepStrictEqual(ctx.body.data, { id: 1 });
    assert.strictEqual(ctx.body._trace, 'tr_x');
    assert.strictEqual(ctx.body._ver, 'V2026.8.3');
    assert.ok(typeof ctx.body._ts === 'number');
    const c2 = makeCtx();
    resp.created(c2, { id: 2 });
    assert.strictEqual(c2.status, 201);
    assert.strictEqual(c2.body.ok, true);
    const c3 = makeCtx();
    resp.noContent(c3);
    assert.strictEqual(c3.status, 204);
    assert.strictEqual(c3.body, undefined);
    // 无 meta 时键值为 undefined（JSON.stringify 后省略）
    const c4 = makeCtx();
    resp.success(c4, 1);
    assert.strictEqual(c4.body.meta, undefined);
  });
  await t('fail：非生产携带 detail；生产强制剥除 detail', () => {
    const c1 = makeCtx();
    resp.fail(c1, 'FORBIDDEN', '禁止', { why: 'role' }, 403);
    assert.strictEqual(c1.status, 403);
    assert.strictEqual(c1.body.ok, false);
    assert.strictEqual(c1.body.error.code, 'FORBIDDEN');
    assert.deepStrictEqual(c1.body.error.detail, { why: 'role' });
    const savedEnv = config.env.NODE_ENV;
    config.env.NODE_ENV = 'production';
    try {
      const c2 = makeCtx();
      resp.fail(c2, 'FORBIDDEN', '禁止', { secret: 'x' }, 403);
      assert.strictEqual(c2.body.error.detail, undefined);
    } finally { config.env.NODE_ENV = savedEnv; }
  });
  await t('pageMeta：默认值/钳制/转换/skip-take/pageCount', () => {
    assert.deepStrictEqual(resp.pageMeta(), { page: 1, pageSize: 20, total: 0, pageCount: 0, skip: 0, take: 20 });
    assert.deepStrictEqual(resp.pageMeta(3, 10, 25), { page: 3, pageSize: 10, total: 25, pageCount: 3, skip: 20, take: 10 });
    const big = resp.pageMeta(2, 99999, 1001); // pageSize 上限 500
    assert.strictEqual(big.pageSize, 500);
    assert.strictEqual(big.pageCount, 3);
    assert.strictEqual(big.skip, 500);
    const bad = resp.pageMeta(-5, 0, 'abc', 'ignored');
    assert.strictEqual(bad.page, 1);
    assert.strictEqual(bad.pageSize, 20);
    assert.strictEqual(bad.total, 0);
    const str = resp.pageMeta('2', '50', '200');
    assert.deepStrictEqual([str.page, str.pageSize, str.total, str.pageCount], [2, 50, 200, 4]);
  });

  /* ==================== middleware/validate ==================== */
  await t('validate body：默认值填充 + 默认剥离未知字段', async () => {
    const mw = validate({ body: Joi.object({ name: Joi.string().required(), role: Joi.string().default('staff') }) });
    const ctx = { request: { body: { name: '张三', hack: 1 } }, query: {} };
    let nexted = false;
    await mw(ctx, async () => { nexted = true; });
    assert.strictEqual(nexted, true);
    assert.deepStrictEqual(ctx.request.body, { name: '张三', role: 'staff' });
  });
  await t('validate body 非法：抛 Joi ValidationError（isJoi，可被 errorHandler 识别）', async () => {
    const mw = validate({ body: Joi.object({ age: Joi.number().integer().required() }) });
    const ctx = { request: { body: { age: 'x' } }, query: {} };
    let threw = null;
    try { await mw(ctx, async () => {}); } catch (e) { threw = e; }
    assert.ok(threw && threw.isJoi === true);
  });
  await t('validate paginate：合并分页 schema 并写 ctx.query；page<1 拒绝；stripUnknown:false 保留未知', async () => {
    const mw = validate({ paginate: true });
    const ctx = { request: { query: {} }, query: {} };
    await mw(ctx, async () => {});
    assert.deepStrictEqual(ctx.query, { page: 1, pageSize: 20 });
    const ctx2 = { request: { query: { page: 3, pageSize: 50, keyword: '秦腔' } }, query: {} };
    await mw(ctx2, async () => {});
    assert.deepStrictEqual(ctx2.query, { page: 3, pageSize: 50, keyword: '秦腔' });
    const bad = { request: { query: { page: 0 } }, query: {} };
    await assert.rejects(() => mw(bad, async () => {}));
    const keep = validate({ query: Joi.object({ a: Joi.number() }) }, { stripUnknown: false });
    const ctx3 = { request: { query: null }, query: { a: 1, b: 2 } };
    await keep(ctx3, async () => {});
    assert.strictEqual(ctx3.query.b, 2);
  });

  /* ==================== middleware/error-handler ==================== */
  await t('errorHandler：下游空 404 → 路由不存在 JSON', async () => {
    const ctx = makeCtx(); ctx.status = 404; ctx.method = 'POST'; ctx.path = '/v1/nope';
    await runHandler(ctx);
    assert.strictEqual(ctx.status, 404);
    assert.strictEqual(ctx.body.error.code, 'NOT_FOUND');
    assert.ok(ctx.body.error.message.indexOf('/v1/nope') >= 0);
  });
  await t('errorHandler：koa-jwt 401/UnauthorizedError → UNAUTHORIZED', async () => {
    const ctx = makeCtx();
    await runHandler(ctx, async () => { const e = new Error('jwt malformed'); e.name = 'UnauthorizedError'; e.status = 401; throw e; });
    assert.strictEqual(ctx.status, 401);
    assert.strictEqual(ctx.body.error.code, 'UNAUTHORIZED');
  });
  await t('errorHandler：Joi 校验错误 → 400 + 字段明细数组', async () => {
    const sch = Joi.object({ age: Joi.number().integer().required(), name: Joi.string().required() });
    const je = sch.validate({ age: 'x' }, { abortEarly: false }).error;
    const ctx = makeCtx();
    await runHandler(ctx, async () => { throw je; });
    assert.strictEqual(ctx.status, 400);
    assert.strictEqual(ctx.body.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(ctx.body.error.detail));
    assert.ok(ctx.body.error.detail.some(f => f.field === 'age'));
  });
  await t('errorHandler：Prisma P2002/P2025/P2003 → 409 冲突字段 / 404 / 422', async () => {
    const c1 = makeCtx();
    await runHandler(c1, async () => { throw { code: 'P2002', meta: { target: ['username', 'phone'] } }; });
    assert.strictEqual(c1.status, 409);
    assert.strictEqual(c1.body.error.code, 'CONFLICT');
    assert.ok(c1.body.error.message.indexOf('username') >= 0 && c1.body.error.message.indexOf('phone') >= 0);
    const c2 = makeCtx();
    await runHandler(c2, async () => { throw { code: 'P2025', message: 'record missing' }; });
    assert.strictEqual(c2.status, 404);
    assert.strictEqual(c2.body.error.code, 'NOT_FOUND');
    const c3 = makeCtx();
    await runHandler(c3, async () => { throw { code: 'P2003', message: 'fk' }; });
    assert.strictEqual(c3.status, 422);
    assert.strictEqual(c3.body.error.code, 'UNPROCESSABLE');
  });
  await t('errorHandler：BusinessError 命中码表 403；未知 key → 500 INTERNAL_ERROR', async () => {
    const c1 = makeCtx();
    await runHandler(c1, async () => { throw new BusinessError('FORBIDDEN', '无权操作', { rid: 9 }); });
    assert.strictEqual(c1.status, 403);
    assert.strictEqual(c1.body.error.message, '无权操作');
    assert.deepStrictEqual(c1.body.error.detail, { rid: 9 });
    const c2 = makeCtx();
    await runHandler(c2, async () => { throw new BusinessError('NOT_A_KEY', 'boom'); });
    assert.strictEqual(c2.status, 500);
    assert.strictEqual(c2.body.error.code, 'INTERNAL_ERROR');
    assert.ok(Object.keys(ERROR_MAP).length >= 8);
  });
  await t('errorHandler：未知异常 → 500；test 环境对外用固定文案（detail 不外泄）', async () => {
    const ctx = makeCtx();
    await runHandler(ctx, async () => { throw new Error('db password xxx secret'); });
    assert.strictEqual(ctx.status, 500);
    assert.strictEqual(ctx.body.error.code, 'INTERNAL_ERROR');
    assert.strictEqual(ctx.body.error.message, '服务器内部错误，请联系管理员');
    assert.strictEqual(ctx.body.error.detail, undefined);
  });

  /* ==================== middleware/auth ==================== */
  await t('isPublic：健康检查/登录刷新/公开接口/预约提交匿名；其他私域', () => {
    assert.strictEqual(auth.isPublic('/v1/healthz'), true);
    assert.strictEqual(auth.isPublic('/v1/auth/login'), true);
    assert.strictEqual(auth.isPublic('/v1/auth/refresh'), true);
    assert.strictEqual(auth.isPublic('/v1/public/plays'), true);
    assert.strictEqual(auth.isPublic('/v1/appointments'), true);
    assert.strictEqual(auth.isPublic('/v1/appointments/9/transition'), true);
    assert.strictEqual(auth.isPublic('/v1/orders'), false);
    assert.strictEqual(auth.isPublic('/v1/auth/logout'), false);
  });
  await t('requireAuth：无载荷私域→抛 401；公开路径匿名放行 user=null；有载荷映射 user/roles 默认[]', async () => {
    const priv = makeCtx(); priv.path = '/v1/orders';
    await assert.rejects(() => auth.requireAuth()(priv, async () => {}), e => e.key === 'UNAUTHORIZED');
    const pub = makeCtx(); pub.path = '/v1/appointments';
    let called = false;
    await auth.requireAuth()(pub, async () => { called = true; });
    assert.strictEqual(called, true);
    assert.strictEqual(pub.state.user, null);
    const anon = makeCtx(); anon.path = '/v1/secret';
    await auth.requireAuth({ allowAnonymous: true })(anon, async () => {});
    assert.strictEqual(anon.state.user, null);
    const ok = makeCtx(); ok.path = '/v1/orders';
    ok.state.jwtPayload = { sub: 'acc_2', username: 'finance1', role: 'finance_maker', realName: '钱会计' };
    await auth.requireAuth()(ok, async () => {});
    assert.strictEqual(ok.state.user.sub, 'acc_2');
    assert.strictEqual(ok.state.user.realName, '钱会计');
    assert.deepStrictEqual(ok.state.user.roles, []);
  });
  await t('requireRole：精确名单匹配，无等级继承；无 user→401', async () => {
    const mk = role => { const ctx = makeCtx(); ctx.state.user = role ? { role } : null; return ctx; };
    await auth.requireRole(['finance_maker', 'super_admin'])(mk('finance_maker'), async () => {});
    await auth.requireRole('super_admin')(mk('super_admin'), async () => {});
    await assert.rejects(() => auth.requireRole(['finance_maker'])(mk('finance_view'), async () => {}), e => e.key === 'FORBIDDEN');
    await assert.rejects(() => auth.requireRole(['staff'])(mk(null), async () => {}), e => e.key === 'UNAUTHORIZED');
    // 即使 super_admin 数值等级 999，未显式列入名单也不放行（maker/checker 分离安全锁）
    await assert.rejects(() => auth.requireRole(['finance_checker'])(mk('super_admin'), async () => {}), e => e.key === 'FORBIDDEN');
  });
  await t('corsOrigin：无 Origin→*；空白名单非生产回显/生产拒绝；命中回显；* 生产带凭证拒绝', () => {
    const arr = config.CORS_ORIGINS_ARRAY;
    const saved = arr.slice();
    const savedEnv = config.env.NODE_ENV;
    const savedCreds = config.env.CORS_CREDENTIALS;
    try {
      const ctxFor = origin => ({ get: h => (h === 'origin' ? origin : '') });
      arr.splice(0, arr.length);
      config.env.NODE_ENV = 'test';
      assert.strictEqual(auth.corsOrigin(ctxFor('')), '*');
      assert.strictEqual(auth.corsOrigin(ctxFor('https://dev.local')), 'https://dev.local');
      config.env.NODE_ENV = 'production';
      assert.strictEqual(auth.corsOrigin(ctxFor('https://dev.local')), ''); // 空白名单生产一律拒绝
      arr.push('https://a.com');
      assert.strictEqual(auth.corsOrigin(ctxFor('https://a.com')), 'https://a.com');
      assert.strictEqual(auth.corsOrigin(ctxFor('https://evil.com')), '');
      arr.splice(0, arr.length, '*');
      assert.strictEqual(auth.corsOrigin(ctxFor('https://any.com')), ''); // 生产 + credentials=true
      config.env.CORS_CREDENTIALS = false;
      assert.strictEqual(auth.corsOrigin(ctxFor('https://any.com')), 'https://any.com');
    } finally {
      arr.splice(0, arr.length, ...saved);
      config.env.NODE_ENV = savedEnv;
      config.env.CORS_CREDENTIALS = savedCreds;
    }
  });

  /* ==================== middleware/request-log ==================== */
  // 拦截 pino 输出：patch 必须在 require request-log 之前（它捕获 logger 引用）
  const logger = require(path.join(SRC, 'utils', 'logger'));
  const logs = [];
  ['debug', 'info', 'warn', 'error'].forEach(m => { logger[m] = (o, msg) => logs.push(Object.assign({ lvl: m, msg }, o)); });
  const { requestLog } = require(path.join(SRC, 'middleware', 'request-log'));
  await t('requestLog：traceId 格式、password 键脱敏、按状态选 info/warn/error、异常仍记录', async () => {
    const mkLogCtx = (status, body) => ({
      state: {}, method: 'POST', path: '/v1/auth/login', ip: '5.6.7.8', status,
      request: { body: body || null }, get: h => (h === 'user-agent' ? 'UA-' + 'x'.repeat(300) : '')
    });
    const c1 = mkLogCtx(200, { username: 'admin', password: 'secret-pw' });
    await requestLog()(c1, async () => {});
    assert.ok(/^tr_[A-Za-z0-9_-]+$/.test(c1.state.traceId));
    const dbg = logs.find(l => l.msg === '>> req');
    assert.ok(dbg.body.indexOf('"password":"***"') >= 0);
    assert.ok(dbg.body.indexOf('secret-pw') < 0);
    assert.ok(dbg.ua.length <= 180 + 3); // 'UA-' 前缀 + 180
    const info = logs.find(l => l.msg === '<< res');
    assert.strictEqual(info.lvl, 'info');
    logs.length = 0;
    const c2 = mkLogCtx(404);
    await requestLog()(c2, async () => {});
    assert.strictEqual(logs.find(l => l.msg === '<< res').lvl, 'warn');
    logs.length = 0;
    const c3 = mkLogCtx(500);
    await assert.rejects(() => requestLog()(c3, async () => { throw new Error('boom'); }));
    assert.strictEqual(logs.find(l => l.msg === '<< res').lvl, 'error');
  });
  await t('requestLog：改密场景 oldPassword/newPassword/passwordConfirm 全脱敏，键名保留、明文不入日志', async () => {
    const ctx = {
      state: {}, method: 'PATCH', path: '/v1/accounts/me/password', ip: '1.1.1.1', status: 200,
      request: { body: { username: 'admin', oldPassword: 'OLD-SECRET', newPassword: 'NEW-SECRET', passwordConfirm: 'C' } },
      get: () => ''
    };
    logs.length = 0;
    await requestLog()(ctx, async () => {});
    const dbg = logs.find(l => l.msg === '>> req');
    // 三个密码键均遮蔽且保留原键名
    assert.ok(dbg.body.indexOf('"oldPassword":"***"') >= 0, dbg.body);
    assert.ok(dbg.body.indexOf('"newPassword":"***"') >= 0, dbg.body);
    assert.ok(dbg.body.indexOf('"passwordConfirm":"***"') >= 0, dbg.body);
    // 明文全部消失；非密码键保留
    assert.ok(dbg.body.indexOf('OLD-SECRET') < 0);
    assert.ok(dbg.body.indexOf('NEW-SECRET') < 0);
    assert.ok(dbg.body.indexOf('"username":"admin"') >= 0);
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
