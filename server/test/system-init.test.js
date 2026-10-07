'use strict';

/**
 * 系统初始化模块测试：
 *   - env-check：URL scheme/provider 匹配、密钥强度、端口占用、DB 连通性判定
 *   - initializer：步骤编排顺序、失败中止、跳过开关、完成标记与审计日志落盘
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ec = require('../src/services/system-init/env-check');
const init = require('../src/services/system-init/initializer');

const SCHEMA = path.resolve(__dirname, '..', 'prisma', 'schema.prisma');
// 避开弱口令关键字（secret/changeme/...）与全同字符
const GOOD_ENV = {
  NODE_ENV: 'production',
  DATABASE_URL: 'file:./prisma/dev.db',
  JWT_ACCESS_SECRET: 'TESTACCTOKEN0123456789ABCDEFGHIJ01',
  JWT_REFRESH_SECRET: 'TESTREFTOKEN9876543210ZYXWVUTSRQ02'
};

function tmpLogDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qaxqjt-init-'));
}

// ========== env-check 纯函数 ==========
test('env-check: urlScheme 识别 file/mysql/postgresql', () => {
  assert.strictEqual(ec.urlScheme('file:./prisma/dev.db'), 'sqlite');
  assert.strictEqual(ec.urlScheme('mysql://u:p@h:3306/db'), 'mysql');
  assert.strictEqual(ec.urlScheme('postgresql://u:p@h/db?sslmode=require'), 'postgresql');
  assert.strictEqual(ec.urlScheme(''), null);
});

test('env-check: providerMatches 三种数据库矩阵', () => {
  assert.strictEqual(ec.providerMatches('sqlite', 'sqlite'), true);
  assert.strictEqual(ec.providerMatches('mysql', 'mysql'), true);
  assert.strictEqual(ec.providerMatches('postgresql', 'postgresql'), true);
  assert.strictEqual(ec.providerMatches('sqlite', 'postgresql'), false);
  assert.strictEqual(ec.providerMatches('postgresql', 'mysql'), false);
});

test('env-check: schemaProvider 从真实 schema.prisma 读出 sqlite', () => {
  assert.strictEqual(ec.schemaProvider(SCHEMA), 'sqlite');
  assert.strictEqual(ec.schemaProvider(path.join(os.tmpdir(), 'no-such-schema.prisma')), null);
});

test('env-check: 必填环境变量缺失 → fail', () => {
  const r = ec.checkEnvVars({ DATABASE_URL: '', JWT_ACCESS_SECRET: 'x' });
  assert.strictEqual(r.status, 'fail');
  assert.match(r.detail, /JWT_REFRESH_SECRET/);
  assert.strictEqual(ec.checkEnvVars(GOOD_ENV).status, 'pass');
});

test('env-check: 密钥强度——生产短密钥/弱口令/相同密钥/合格密钥', () => {
  assert.strictEqual(ec.checkSecrets({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'short1234', JWT_REFRESH_SECRET: 'x'.repeat(40) }).status, 'fail');
  assert.strictEqual(ec.checkSecrets({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'changeme1234567890', JWT_REFRESH_SECRET: 'y'.repeat(40) }).status, 'fail');
  assert.strictEqual(ec.checkSecrets({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'a'.repeat(40) }).status, 'fail');
  const same = ec.checkSecrets({ NODE_ENV: 'production', JWT_ACCESS_SECRET: GOOD_ENV.JWT_ACCESS_SECRET, JWT_REFRESH_SECRET: GOOD_ENV.JWT_ACCESS_SECRET });
  assert.strictEqual(same.status, 'warn');
  assert.strictEqual(ec.checkSecrets(GOOD_ENV).status, 'pass');
});

test('env-check: 必需 Node 主版本来自 engines（24.x → 24）', () => {
  assert.strictEqual(ec.requiredNodeMajor(), 24);
  assert.strictEqual(typeof ec.nodeMeets(1), 'boolean');
});

test('env-check: 端口被监听 → fail；空闲端口 → pass', async () => {
  const srv = net.createServer();
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const addr = srv.address();
  const busy = await ec.probePort(addr.port, '127.0.0.1');
  assert.strictEqual(busy.status, 'fail');
  // HTTP 在线自检场景：同一被占端口传 selfExpected → pass
  const selfBusy = await ec.probePort(addr.port, '127.0.0.1', true);
  assert.strictEqual(selfBusy.status, 'pass');
  await new Promise(resolve => srv.close(resolve));
  const free = await ec.probePort(addr.port, '127.0.0.1');
  assert.strictEqual(free.status, 'pass');
});

test('env-check: checkDatabase——provider 不匹配直接 fail 不连库', async () => {
  const r = await ec.checkDatabase({ $queryRaw: async () => { throw new Error('should not reach'); } }, {
    env: { DATABASE_URL: 'postgresql://x/y' },
    schemaPath: SCHEMA
  });
  assert.strictEqual(r.status, 'fail');
  assert.match(r.detail, /provider=sqlite[\s\S]*协议=postgresql/);
});

test('env-check: checkDatabase——SELECT 1 成功 pass / 抛错 fail', async () => {
  const ok = await ec.checkDatabase({ $queryRaw: async () => [1] }, { env: GOOD_ENV, schemaPath: SCHEMA });
  assert.strictEqual(ok.status, 'pass');
  const bad = await ec.checkDatabase({ $queryRaw: async () => { throw new Error('ECONNREFUSED'); } }, { env: GOOD_ENV, schemaPath: SCHEMA });
  assert.strictEqual(bad.status, 'fail');
  assert.match(bad.detail, /ECONNREFUSED/);
});

// ========== initializer 编排 ==========
function makeDeps(overrides) {
  const calls = [];
  const prisma = {
    setting: {
      upsert: async args => { calls.push({ fn: 'setting.upsert', args }); return {}; },
      findUnique: async () => null
    },
    $queryRaw: async () => [1]
  };
  const runner = async (args, opts) => {
    calls.push({ fn: 'runner', args, opts });
    if (overrides && overrides.runnerFailAt != null && calls.filter(c => c.fn === 'runner').length === overrides.runnerFailAt) {
      throw new Error('mock runner failure ' + overrides.runnerFailAt);
    }
    return { code: 0, stdout: '[seed] settings: 8 条\n[seed] roles: 9 条\n[seed] 完成\n', stderr: '' };
  };
  const logDir = tmpLogDir();
  const progress = [];
  const opts = Object.assign({
    confirm: true,
    env: GOOD_ENV,
    schemaPath: SCHEMA,
    prisma,
    runner,
    logDir,
    onProgress: (step, percent) => progress.push({ step, percent })
  }, overrides || {});
  return { opts, calls, progress, logDir };
}

test('initializer: 未 confirm 抛 CONFIRM_REQUIRED', async () => {
  const d = makeDeps();
  delete d.opts.confirm;
  await assert.rejects(() => init.runInitialization(d.opts), /confirm/);
});

test('initializer: 全流程成功——5 步 pass、进度递增、db push+seed 各执行一次、标记写入、日志落盘', async () => {
  const d = makeDeps();
  const r = await init.runInitialization(d.opts);
  assert.strictEqual(r.status, 'success');
  assert.deepStrictEqual(r.steps.map(s => s.status), ['pass', 'pass', 'pass', 'pass', 'pass']);
  // 进度百分数严格递增
  const pcts = d.progress.map(p => p.percent);
  for (let i = 1; i < pcts.length; i++) assert.ok(pcts[i] >= pcts[i - 1]);
  assert.strictEqual(pcts[pcts.length - 1], 100);
  // runner 两次：schema(db push，无 migrations 目录) + seed
  const runnerCalls = d.calls.filter(c => c.fn === 'runner');
  assert.strictEqual(runnerCalls.length, 2);
  assert.ok(runnerCalls[0].args[0].includes('index.js'));
  assert.deepStrictEqual(runnerCalls[0].args.slice(1), ['db', 'push', '--skip-generate']);
  assert.strictEqual(runnerCalls[1].args[0], '-r');
  assert.strictEqual(runnerCalls[1].args[1], 'dotenv/config');
  assert.match(runnerCalls[1].args[2], /seed\.js$/);
  // 完成标记
  const ups = d.calls.filter(c => c.fn === 'setting.upsert');
  assert.strictEqual(ups.length, 1);
  assert.strictEqual(ups[0].args.where.id, init.MARKER_ID);
  // 日志文件
  const files = fs.readdirSync(d.logDir);
  assert.strictEqual(files.length, 1);
  const log = fs.readFileSync(path.join(d.logDir, files[0]), 'utf8');
  assert.match(log, /\[precheck\]/);
  assert.match(log, /初始化全部完成/);
});

test('initializer: 无 migrations 目录 → hasMigrations false', () => {
  assert.strictEqual(init.hasMigrations(), false);
});

test('initializer: DB 连接失败 → 中止于 db_connect，runner/标记均不执行', async () => {
  const d = makeDeps({
    prisma: { setting: { upsert: async () => ({}) }, $queryRaw: async () => { throw new Error('boom-db'); } }
  });
  const r = await init.runInitialization(d.opts);
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(r.steps[1].key, 'db_connect');
  assert.strictEqual(r.steps[1].status, 'fail');
  assert.strictEqual(d.calls.filter(c => c.fn === 'runner').length, 0);
  assert.strictEqual(d.calls.filter(c => c.fn === 'setting.upsert').length, 0);
});

test('initializer: schema 同步失败 → 中止于 schema_sync，seed 不执行', async () => {
  const d = makeDeps({ runnerFailAt: 1 });
  const r = await init.runInitialization(d.opts);
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(r.steps[2].status, 'fail');
  assert.strictEqual(d.calls.filter(c => c.fn === 'runner').length, 1);
  assert.strictEqual(d.calls.filter(c => c.fn === 'setting.upsert').length, 0);
});

test('initializer: runSchema=false 跳过建表，仅执行 seed', async () => {
  const d = makeDeps({ runSchema: false });
  const r = await init.runInitialization(d.opts);
  assert.strictEqual(r.status, 'success');
  assert.strictEqual(r.steps[2].status, 'skip');
  assert.strictEqual(r.steps[3].status, 'pass');
  assert.strictEqual(d.calls.filter(c => c.fn === 'runner').length, 1);
});

test('initializer: latestLog 读取失败目录返回 null', () => {
  assert.strictEqual(init.latestLog(path.join(os.tmpdir(), 'qaxqjt-no-such-dir-xyz')), null);
});
