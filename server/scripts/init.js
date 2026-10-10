'use strict';

/**
 * scripts/init.js —— 系统初始化 CLI
 * 用法：
 *   npm run init                 全流程初始化（检测→建表→种子→标记）
 *   npm run init -- --no-schema  跳过表结构同步
 *   npm run init -- --no-seed    跳过种子数据
 *   npm run init -- --check      只做环境检测，不执行初始化
 */
const { runAllChecks } = require('../src/services/system-init/env-check');
const { runInitialization } = require('../src/services/system-init/initializer');
const { env } = require('../src/config');

const argv = process.argv.slice(2);
const onlyCheck = argv.includes('--check');
const runSchema = !argv.includes('--no-schema');
const runSeed = !argv.includes('--no-seed');

function line(c) {
  const icon = c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️ ' : '❌';
  console.log(`  ${icon} ${c.label.padEnd(22)} ${c.detail}`);
}

async function main() {
  console.log('====== 秦安县秦剧团文化演出有限公司云端预约系统 · 初始化向导 ======');
  console.log(`NODE_ENV=${env.NODE_ENV || 'development'}  APP_PORT=${env.APP_PORT || 3001}`);
  console.log('');

  const report = await runAllChecks({ port: Number(env.APP_PORT) || 3001 });
  console.log(`[环境检测] pass=${report.summary.pass} warn=${report.summary.warn} fail=${report.summary.fail}`);
  report.checks.forEach(line);
  console.log('');

  if (onlyCheck) {
    process.exit(report.ok ? 0 : 2);
  }
  if (!report.ok) {
    console.error('❌ 环境检测未通过，初始化已中止。请按上述 ❌ 项修复后重试。');
    process.exit(2);
  }

  console.log('[开始初始化]');
  const result = await runInitialization({
    confirm: true,
    runSchema,
    runSeed,
    operator: 'cli',
    onProgress: (step, percent, message) => console.log(`  (${String(percent).padStart(3)}%) [${step}] ${message}`)
  });

  console.log('');
  if (result.status === 'success') {
    console.log(`✅ 初始化完成，审计日志：${result.logFile}`);
    process.exit(0);
  } else {
    console.error(`❌ 初始化失败（步骤：${result.steps.find(s => s.status === 'fail')?.key || 'unknown'}）`);
    console.error(`   审计日志：${result.logFile}`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('❌ 初始化异常：', e.message);
  process.exit(1);
});
