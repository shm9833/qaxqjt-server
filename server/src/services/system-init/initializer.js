'use strict';

/**
 * services/system-init/initializer.js —— 系统初始化编排器
 * 流程：配置/环境检测 → 数据库连接 → 表结构同步(索引/约束) → 初始数据加载 → 完成标记
 * 特性：
 *   - 进度回调 onProgress(step, percent, message)
 *   - 全量审计日志：内存 lines + 文件 logs/init-YYYYMMDD-HHmmss.log
 *   - 依赖注入（prisma/runner/logDir/clock），便于单测
 *   - 任一步失败即中止，已执行步骤保留现场，不做破坏性回滚（数据库 DDL 由 Prisma 保证幂等）
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { runAllChecks, checkDatabase, ROOT_DIR } = require('./env-check');

const PRISMA_CLI = path.join(ROOT_DIR, 'node_modules', 'prisma', 'build', 'index.js');
const SEED_SCRIPT = path.join(ROOT_DIR, 'prisma', 'seed.js');
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'prisma', 'migrations');
const DEFAULT_LOG_DIR = path.join(ROOT_DIR, 'logs');
const MARKER_ID = 'set_sys_init_at';
const MARKER_KEY = 'system_initialized_at';

const STEPS = [
  { key: 'precheck', name: '基础配置与环境检测', percent: 8 },
  { key: 'db_connect', name: '数据库连接', percent: 25 },
  { key: 'schema_sync', name: '数据表结构/索引/约束创建', percent: 55 },
  { key: 'seed', name: '初始数据加载（管理员/字典/权限）', percent: 82 },
  { key: 'finish', name: '完成标记与审计日志', percent: 100 }
];

function pad(n) {
  return String(n).padStart(2, '0');
}
function tsName(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 默认命令执行器：在 ROOT_DIR 下运行 node 子进程 */
function makeDefaultRunner() {
  return function run(args, opts) {
    return new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        args,
        { cwd: ROOT_DIR, env: process.env, maxBuffer: 10 * 1024 * 1024, timeout: (opts && opts.timeoutMs) || 180000 },
        (err, stdout, stderr) => {
          if (err) {
            err.stdout = stdout;
            err.stderr = stderr;
            reject(err);
          } else {
            resolve({ code: 0, stdout: stdout || '', stderr: stderr || '' });
          }
        }
      );
      child.stdout && child.stdout.on('data', () => {});
    });
  };
}

function hasMigrations() {
  try {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      return false;
    }
    return fs.readdirSync(MIGRATIONS_DIR).some(n => /^\d{8,}/.test(n));
  } catch (_) {
    return false;
  }
}

/**
 * 执行初始化
 * @param {object} options
 * @param {boolean} options.confirm 必须显式 true
 * @param {boolean} [options.runSchema=true]
 * @param {boolean} [options.runSeed=true]
 * @param {Function} [options.onProgress]
 * @param {object} [options.prisma] 注入
 * @param {Function} [options.runner] 注入
 * @param {string} [options.logDir]
 * @param {Function} [options.clock]
 * @param {object} [options.audit] 审计函数 {audit}
 */
async function runInitialization(options) {
  const opts = options || {};
  if (opts.confirm !== true) {
    const e = new Error('初始化属高危操作，请求必须携带 confirm: true');
    e.code = 'CONFIRM_REQUIRED';
    throw e;
  }
  const prisma = opts.prisma || require('../../utils/prisma');
  const runner = opts.runner || makeDefaultRunner();
  const clock = opts.clock || (() => new Date());
  const logDir = opts.logDir || DEFAULT_LOG_DIR;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const runSchema = opts.runSchema !== false;
  const runSeed = opts.runSeed !== false;

  const startedAt = clock();
  const logFile = path.join(logDir, `init-${tsName(startedAt)}.log`);
  const lines = [];

  const steps = STEPS.map(s => Object.assign({}, s, { status: 'pending', message: '', durationMs: 0 }));
  const stepByKey = {};
  steps.forEach(s => {
    stepByKey[s.key] = s;
  });

  const report = {
    status: 'running',
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    logFile,
    steps,
    envReport: null,
    operator:
      opts.operator || (opts.ctx && opts.ctx.state && opts.ctx.state.user && opts.ctx.state.user.username) || 'cli'
  };

  function emit(stepKey, message) {
    const s = stepByKey[stepKey];
    lines.push(`[${clock().toISOString()}] [${stepKey}] ${message}`);
    s.message = message;
    onProgress(stepKey, s.percent, message);
  }
  function flushLog() {
    try {
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      fs.appendFileSync(logFile, lines.join('\n') + '\n', 'utf8');
    } catch (e) {
      // 日志落盘失败不影响主流程（console.error 在允许清单内）
      console.error('[system-init] 日志写入失败:', e.message);
    }
  }
  function finish(status, stepKey) {
    const s = stepByKey[stepKey];
    // 步骤状态只用 pass/fail/skip；'success' 是整单 report 状态
    s.status = status === 'success' ? 'pass' : status;
    report.status = status === 'fail' ? 'failed' : status;
    report.finishedAt = clock().toISOString();
    flushLog();
    return report;
  }

  // ---- Step 1: 环境/配置检测（不连库）----
  const t0 = clock();
  emit('precheck', '开始检测 Node/依赖/环境变量/密钥/provider 匹配…');
  let envReport;
  try {
    envReport = await runAllChecks({ prisma: null, env: opts.env, schemaPath: opts.schemaPath });
    report.envReport = envReport;
    stepByKey.precheck.durationMs = clock() - t0;
    if (!envReport.ok) {
      const fatal = envReport.checks
        .filter(c => c.status === 'fail')
        .map(c => `${c.label}: ${c.detail}`)
        .join('；');
      emit('precheck', '环境检测未通过：' + fatal);
      return finish('fail', 'precheck');
    }
    stepByKey.precheck.status = 'pass';
    emit('precheck', `环境检测通过（${envReport.summary.pass} pass / ${envReport.summary.warn} warn）`);
  } catch (e) {
    emit('precheck', '环境检测异常：' + (e.message || e));
    return finish('fail', 'precheck');
  }

  // ---- Step 2: 数据库连接 ----
  const t1 = clock();
  emit('db_connect', '正在连接数据库并执行 SELECT 1…');
  try {
    const db = await checkDatabase(prisma, { env: opts.env, schemaPath: opts.schemaPath });
    stepByKey.db_connect.durationMs = clock() - t1;
    if (db.status === 'fail') {
      emit('db_connect', db.detail);
      return finish('fail', 'db_connect');
    }
    stepByKey.db_connect.status = 'pass';
    emit('db_connect', db.detail);
  } catch (e) {
    emit('db_connect', '数据库连接异常：' + (e.message || e));
    return finish('fail', 'db_connect');
  }

  // ---- Step 3: 表结构同步 ----
  if (runSchema) {
    const t2 = clock();
    stepByKey.schema_sync.status = 'running';
    const useMigrate = hasMigrations();
    const args = useMigrate ? [PRISMA_CLI, 'migrate', 'deploy'] : [PRISMA_CLI, 'db', 'push', '--skip-generate'];
    emit('schema_sync', `执行 prisma ${useMigrate ? 'migrate deploy' : 'db push'}（含索引/约束）…`);
    try {
      const r = await runner(args, { timeoutMs: 240000 });
      stepByKey.schema_sync.durationMs = clock() - t2;
      const tail = String(r.stdout || r.stderr || '')
        .trim()
        .split('\n')
        .slice(-2)
        .join(' / ');
      stepByKey.schema_sync.status = 'pass';
      emit('schema_sync', '表结构同步完成' + (tail ? `（${tail.slice(0, 180)}）` : ''));
    } catch (e) {
      stepByKey.schema_sync.durationMs = clock() - t2;
      emit('schema_sync', '表结构同步失败：' + ((e.stderr || e.message || e) + '').slice(0, 500));
      return finish('fail', 'schema_sync');
    }
  } else {
    stepByKey.schema_sync.status = 'skip';
    emit('schema_sync', '已按参数跳过表结构同步');
  }

  // ---- Step 4: 种子数据 ----
  if (runSeed) {
    const t3 = clock();
    stepByKey.seed.status = 'running';
    emit('seed', '执行幂等种子（settings/roles/admin/wageRules）…');
    try {
      const r = await runner(['-r', 'dotenv/config', SEED_SCRIPT], { timeoutMs: 120000 });
      stepByKey.seed.durationMs = clock() - t3;
      stepByKey.seed.status = 'pass';
      const created = (String(r.stdout).match(/\[(?:seed)\][^\n]*/g) || []).slice(-3).join('；');
      emit('seed', '初始数据加载完成' + (created ? `（${created.slice(0, 200)}）` : ''));
    } catch (e) {
      stepByKey.seed.durationMs = clock() - t3;
      emit('seed', '种子执行失败：' + ((e.stdout || e.stderr || e.message || e) + '').slice(0, 500));
      return finish('fail', 'seed');
    }
  } else {
    stepByKey.seed.status = 'skip';
    emit('seed', '已按参数跳过种子数据');
  }

  // ---- Step 5: 完成标记 ----
  const t4 = clock();
  emit('finish', '写入 system_initialized_at 标记…');
  try {
    const nowMs = Date.now();
    await prisma.setting.upsert({
      where: { id: MARKER_ID },
      create: {
        id: MARKER_ID,
        key: MARKER_KEY,
        value: clock().toISOString(),
        group: 'system',
        description: '系统初始化完成时间标记',
        isPublic: false,
        updatedBy: 'sys_init',
        ts: BigInt(nowMs)
      },
      update: { value: clock().toISOString(), updatedBy: 'sys_init', ts: BigInt(nowMs) }
    });
    stepByKey.finish.durationMs = clock() - t4;
    emit('finish', '初始化全部完成 ✅');
  } catch (e) {
    emit('finish', '完成标记写入失败：' + (e.message || e));
    return finish('fail', 'finish');
  }

  if (opts.audit && typeof opts.audit.audit === 'function') {
    try {
      await opts.audit.audit({
        ctx: opts.ctx,
        module: 'system-init',
        action: 'SYSTEM_INIT_RUN',
        detail: { status: 'success', startedAt: report.startedAt, logFile }
      });
    } catch (_) {
      /* 审计不可用不阻断主流程 */
    }
  }

  return finish('success', 'finish');
}

/** 读取初始化标记（未初始化返回 null） */
async function getInitMarker(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: MARKER_KEY } });
    return row ? { initializedAt: row.value, updatedBy: row.updatedBy || null } : null;
  } catch (_) {
    return null;
  }
}

/** 列出/读取最近的初始化日志 */
function latestLog(logDir) {
  const dir = logDir || DEFAULT_LOG_DIR;
  try {
    const files = fs
      .readdirSync(dir)
      .filter(n => /^init-\d{8}-\d{6}\.log$/.test(n))
      .sort()
      .reverse();
    if (!files.length) {
      return null;
    }
    const name = files[0];
    return { file: name, content: fs.readFileSync(path.join(dir, name), 'utf8') };
  } catch (_) {
    return null;
  }
}

module.exports = {
  runInitialization,
  getInitMarker,
  latestLog,
  makeDefaultRunner,
  hasMigrations,
  STEPS,
  MARKER_ID,
  MARKER_KEY,
  DEFAULT_LOG_DIR
};
