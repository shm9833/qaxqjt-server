'use strict';

/**
 * src/server.js —— 启动入口
 *   本机：npm run dev  (nodemon + dotenv/config)
 *   容器：node -r dotenv/config src/server.js
 *   PM2：  pm2-runtime start ecosystem.config.js
 */
// 必须在 require('./app') 之前：以 .env 为唯一权威，覆盖 PM2 守护进程缓存/系统环境变量里的旧值
// （背景：pm2 restart 不带 --update-env 时沿用旧进程环境，dotenv 默认又不覆盖 process.env，
//   曾导致 .env 中轮换的 JWT 密钥/CORS 白名单不生效）
require('dotenv').config({ override: true });

const app = require('./app');
const { env, nowMs } = require('./config');
const logger = require('./utils/logger');
const securityConfig = require('./services/security-config');
const captchaService = require('./services/captcha-service');

const PORT = Number(process.env.APP_PORT || env.APP_PORT || 3001);

const shutdown = async signal => {
  logger.warn({ signal }, '开始优雅关闭...');
  securityConfig.stopSecurityConfigPoller();
  const prisma = require('./utils/prisma');
  try {
    await prisma.$disconnect();
  } catch (_) {}
  server.close(() => {
    logger.info({ signal }, 'HTTP 服务已停止');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error({ signal }, '强制关闭超时，退出');
    process.exit(1);
  }, 9000).unref?.();
};

const server = app.listen(PORT, '0.0.0.0', async () => {
  // 启动安全配置热加载 + 清理过期验证码
  securityConfig.startSecurityConfigPoller();
  captchaService.cleanupExpired().catch(() => {});
  logger.info(
    {
      port: PORT,
      env: env.NODE_ENV,
      version: env.APP_VERSION,
      ts: nowMs()
    },
    `秦安县秦剧团文化演出有限公司云端预约 API 已启动 -> http://127.0.0.1:${PORT}/v1/healthz`
  );
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', reason => {
  logger.error({ err: reason }, 'UnhandledRejection');
});
process.on('uncaughtException', err => {
  logger.error({ err }, 'UncaughtException');
  process.exit(1);
});

module.exports = server;
