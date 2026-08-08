'use strict';

/**
 * src/utils/prisma.js —— Prisma Client 单例
 */
const { PrismaClient } = require('@prisma/client');
const { isProd, env } = require('../config');
const logger = require('./logger');

const prisma = new PrismaClient({
  datasources: {
    db: { url: env.DATABASE_URL }
  },
  log: isProd
    ? [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }]
    : [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'info' }
      ]
});

if (!isProd) {
  // 开发环境慢查询提示（> 200ms）
  prisma.$on('query' /* as any */, e => {
    const dur = Number(e?.duration || 0);
    if (dur > 200) {
      logger.warn({ type: 'prisma_slow', dur_ms: dur, sql: e.query.slice(0, 180) }, 'Prisma 慢查询');
    }
  });
}

prisma.$on('error', e => logger.error({ err: e }, 'Prisma error'));
prisma.$on('warn', e => logger.warn({ err: e }, 'Prisma warn'));

module.exports = prisma;
