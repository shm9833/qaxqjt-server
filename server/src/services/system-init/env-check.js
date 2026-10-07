'use strict';

/**
 * services/system-init/env-check.js —— 系统初始化前的运行环境检测
 * 检测项：Node 版本 / 平台资源（CPU·内存·磁盘）/ 必需依赖 / 环境变量与密钥强度
 *       / 端口占用 / 数据库连通性与 provider 匹配
 * 纯函数 + 可注入依赖，便于单元测试；不做任何写操作。
 */
const os = require('os');
const fs = require('fs');
const net = require('net');
const path = require('path');
const pkg = require('../../../package.json');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const SCHEMA_PATH = path.join(ROOT_DIR, 'prisma', 'schema.prisma');

const WEAK_SECRETS = [
  'changeme',
  'change_me',
  'secret',
  'your-secret-key',
  'insecure',
  '1234567890123456',
  'qwertyuiopasdfgh',
  'jwt_access_secret',
  'jwt_refresh_secret'
];

function ok(key, label, detail, extra) {
  return Object.assign({ key, label, status: 'pass', detail: detail || '' }, extra || {});
}
function warn(key, label, detail, extra) {
  return Object.assign({ key, label, status: 'warn', detail: detail || '' }, extra || {});
}
function fail(key, label, detail, extra) {
  return Object.assign({ key, label, status: 'fail', detail: detail || '' }, extra || {});
}

/** 从 package.json engines.node（形如 "24.x" / ">=18"）取主版本号 */
function requiredNodeMajor() {
  const raw = String((pkg.engines && pkg.engines.node) || '').trim();
  const m = raw.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 极简版本比较：当前 process.version 是否 >= major.minor.patch */
function nodeMeets(wantMajor) {
  const cur = process.versions.node.split('.').map(Number);
  if (!wantMajor) {
    return true;
  }
  return cur[0] > wantMajor || cur[0] === wantMajor;
}

function checkNode() {
  const want = requiredNodeMajor();
  const current = process.versions.node;
  if (!nodeMeets(want)) {
    return fail('node', 'Node.js 版本', `当前 v${current}，要求 v${want}.x（engines），请升级 Node`);
  }
  return ok('node', 'Node.js 版本', `v${current}（要求 v${want}.x）`);
}

function bytesGB(n) {
  return Math.round((n / 1024 / 1024 / 1024) * 10) / 10;
}

function checkSystem() {
  const checks = [];
  checks.push(
    ok('platform', '操作系统/架构', `${os.type()} ${os.release()} · ${os.arch()} · ${os.cpus().length} vCPU`)
  );
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const freeGB = bytesGB(freeMem);
  if (freeGB < 0.3) {
    checks.push(fail('memory', '可用内存', `仅剩 ${freeGB}GB / 共 ${bytesGB(totalMem)}GB，建议 ≥512MB`));
  } else if (freeGB < 0.5) {
    checks.push(warn('memory', '可用内存', `仅剩 ${freeGB}GB / 共 ${bytesGB(totalMem)}GB，建议 ≥512MB`));
  } else {
    checks.push(ok('memory', '可用内存', `${freeGB}GB 可用 / 共 ${bytesGB(totalMem)}GB`));
  }
  // 磁盘（Node 18.15+ 提供 fs.statfsSync；不可用时跳过）
  try {
    if (typeof fs.statfsSync === 'function') {
      const st = fs.statfsSync(ROOT_DIR);
      const freeDisk = Number(st.bavail) * Number(st.bsize);
      const totalDisk = Number(st.blocks) * Number(st.bsize);
      if (freeDisk < 512 * 1024 * 1024) {
        checks.push(fail('disk', '磁盘剩余空间', `仅剩 ${bytesGB(freeDisk)}GB / ${bytesGB(totalDisk)}GB，建议 ≥1GB`));
      } else {
        checks.push(ok('disk', '磁盘剩余空间', `${bytesGB(freeDisk)}GB 可用 / ${bytesGB(totalDisk)}GB`));
      }
    } else {
      checks.push(warn('disk', '磁盘剩余空间', '当前 Node 不支持 statfs，已跳过'));
    }
  } catch (e) {
    checks.push(warn('disk', '磁盘剩余空间', `检测失败：${e.message}`));
  }
  return checks;
}

function checkDependencies() {
  const deps = Object.keys(pkg.dependencies || {});
  const missing = [];
  deps.forEach(name => {
    try {
      require.resolve(name, { paths: [ROOT_DIR] });
    } catch (_) {
      missing.push(name);
    }
  });
  if (missing.length) {
    return fail('deps', '运行依赖完整性', `缺少 ${missing.length} 个依赖：${missing.join(', ')}（执行 npm install）`);
  }
  return ok('deps', '运行依赖完整性', `${deps.length} 个生产依赖全部可解析`);
}

function checkEnvVars(envObj) {
  const env = envObj || process.env;
  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter(k => !String(env[k] || '').trim());
  if (missing.length) {
    return fail('env', '必填环境变量', `缺失：${missing.join(', ')}（参照 .env.example）`);
  }
  return ok('env', '必填环境变量', `DATABASE_URL / JWT_ACCESS_SECRET / JWT_REFRESH_SECRET 均已配置`);
}

function secretLooksWeak(s) {
  const v = String(s || '');
  if (WEAK_SECRETS.some(w => v.toLowerCase().includes(w))) {
    return true;
  }
  if (/^(.)\1+$/.test(v)) {
    return true;
  } // aaaa...
  return false;
}

function checkSecrets(envObj) {
  const env = envObj || process.env;
  const isProd = env.NODE_ENV === 'production';
  const access = String(env.JWT_ACCESS_SECRET || '');
  const refresh = String(env.JWT_REFRESH_SECRET || '');
  if (!access || !refresh) {
    return warn('secrets', 'JWT 密钥强度', 'JWT 密钥未配置（env 检测会报 fail）');
  }
  if (isProd && (access.length < 32 || refresh.length < 32)) {
    return fail(
      'secrets',
      'JWT 密钥强度',
      `生产环境密钥长度不足（access=${access.length}/refresh=${refresh.length}，要求 ≥32）`
    );
  }
  if (secretLooksWeak(access) || secretLooksWeak(refresh)) {
    return fail('secrets', 'JWT 密钥强度', '检测到弱口令/占位密钥，请使用随机字符串（openssl rand -hex 32）');
  }
  if (access === refresh) {
    return warn('secrets', 'JWT 密钥强度', 'access/refresh 密钥相同，建议使用两个独立密钥');
  }
  if (access.length < 16 || refresh.length < 16) {
    return fail('secrets', 'JWT 密钥强度', '密钥长度不足 16 位');
  }
  return ok(
    'secrets',
    'JWT 密钥强度',
    `access ${access.length} 位 / refresh ${refresh.length} 位，双密钥${access === refresh ? '' : '独立'}`
  );
}

/** 读取 schema.prisma 的 datasource provider（只解析 datasource 块，忽略注释中的示例） */
function schemaProvider(schemaPath) {
  try {
    const txt = fs.readFileSync(schemaPath || SCHEMA_PATH, 'utf8');
    const ds = txt.match(/datasource\s+\w+\s*\{([\s\S]*?)\}/);
    const body = ds ? ds[1] : txt;
    const m = body.match(/^\s*provider\s*=\s*["']([a-z]+)["']/m);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

/** 解析 DATABASE_URL scheme：file: → sqlite；mysql: → mysql；postgresql: → postgresql */
function urlScheme(rawUrl) {
  const u = String(rawUrl || '').trim();
  if (!u) {
    return null;
  }
  if (u.startsWith('file:')) {
    return 'sqlite';
  }
  const m = u.match(/^([a-z]+):/i);
  return m ? m[1].toLowerCase() : null;
}

function providerMatches(provider, scheme) {
  if (!provider || !scheme) {
    return false;
  }
  if (provider === 'sqlite') {
    return scheme === 'sqlite';
  }
  if (provider === 'mysql') {
    return scheme === 'mysql';
  }
  if (provider === 'postgresql') {
    return scheme === 'postgresql' || scheme === 'postgres';
  }
  return false;
}

/**
 * 端口占用探测
 * @param {number} port
 * @param {string} [host]
 * @param {boolean} [selfExpected] 检测由运行中的服务自身发起时，端口被占用是预期状态 → 记 pass
 */
function probePort(port, host, selfExpected) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', err => {
      if (err.code === 'EADDRINUSE') {
        if (selfExpected) {
          resolve(ok('port', `端口 ${port} 占用情况`, `端口 ${port} 已被本服务占用（HTTP 服务在线）`));
        } else {
          resolve(fail('port', `端口 ${port} 占用情况`, `端口 ${port} 已被占用，请更换 APP_PORT 或停止占用进程`));
        }
      } else {
        resolve(warn('port', `端口 ${port} 占用情况`, `探测异常：${err.message}`));
      }
    });
    server.once('listening', () =>
      server.close(() => resolve(ok('port', `端口 ${port} 占用情况`, `端口 ${port} 空闲可监听`)))
    );
    server.listen(typeof port === 'number' ? port : 0, host || '0.0.0.0');
  });
}

async function checkDatabase(prisma, deps) {
  const env = (deps && deps.env) || process.env;
  const provider = schemaProvider(deps && deps.schemaPath);
  const scheme = urlScheme(env.DATABASE_URL);
  if (!provider) {
    return fail('db', '数据库 Provider', '无法从 prisma/schema.prisma 读取 provider');
  }
  if (!scheme) {
    return fail('db', '数据库连接串', 'DATABASE_URL 为空或协议无法识别');
  }
  if (!providerMatches(provider, scheme)) {
    return fail(
      'db',
      '数据库 Provider 匹配',
      `schema provider=${provider} 但 DATABASE_URL 协议=${scheme}，二者必须一致（检查 .env 或 schema.prisma）`
    );
  }
  // 连通性：SELECT 1，5 秒超时
  if (prisma && typeof prisma.$queryRaw === 'function') {
    let timedOut = false;
    const timer = new Promise(resolve =>
      setTimeout(() => {
        timedOut = true;
        resolve(Symbol('timeout'));
      }, 5000)
    );
    try {
      const r = await Promise.race([prisma.$queryRaw`SELECT 1`, timer]);
      if (timedOut || typeof r === 'symbol') {
        return fail('db', '数据库连通性', `连接 ${scheme} 超时（>5s），检查网络/白名单/连接串`);
      }
      return ok('db', '数据库连接', `provider=${provider} · SELECT 1 成功`);
    } catch (e) {
      return fail('db', '数据库连通性', `连接失败：${e.message || e}`);
    }
  }
  return warn('db', '数据库连通性', '未提供 prisma 客户端，跳过连通性探测');
}

function summarize(checks) {
  return checks.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 }
  );
}

/**
 * 执行全部检测
 * @param {{prisma?:object, port?:number, env?:object, schemaPath?:string, host?:string}} deps
 */
async function runAllChecks(deps) {
  deps = deps || {};
  const checks = [];
  checks.push(checkNode());
  checkSystem().forEach(c => checks.push(c));
  checks.push(checkDependencies());
  checks.push(checkEnvVars(deps.env));
  checks.push(checkSecrets(deps.env));
  if (deps.port) {
    checks.push(await probePort(deps.port, deps.host, deps.portSelf));
  }
  checks.push(await checkDatabase(deps.prisma, deps));
  const summary = summarize(checks);
  return {
    ok: summary.fail === 0,
    summary,
    node: process.versions.node,
    hostname: os.hostname(),
    uptimeSec: Math.round(os.uptime()),
    checkedAt: new Date().toISOString(),
    checks
  };
}

module.exports = {
  runAllChecks,
  checkNode,
  checkSystem,
  checkDependencies,
  checkEnvVars,
  checkSecrets,
  checkDatabase,
  probePort,
  schemaProvider,
  urlScheme,
  providerMatches,
  requiredNodeMajor,
  nodeMeets,
  ROOT_DIR
};
