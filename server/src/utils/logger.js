'use strict';

/**
 * src/utils/logger.js —— pino 结构化日志
 * 开发：pretty 打印，生产：json（ELK / Loki 采集）
 */
const pino = require('pino');
const { env, isDev } = require('../config');

const logger = pino(
  {
    name: env.APP_NAME,
    level: env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    base: { version: env.APP_VERSION, pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: label => ({ level: label })
    },
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname,version' }
        }
      : undefined
  }
);

module.exports = logger;
