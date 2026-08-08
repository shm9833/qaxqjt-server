'use strict';

/**
 * src/config/index.js —— 运行时配置（单一可信来源，来自 .env）
 * 规则：所有环境相关配置都走这里；禁止业务代码直接读 process.env
 */
const joi = require('joi');
const path = require('path');

const CORS_ORIGINS_ARRAY = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const schema = joi
  .object({
    NODE_ENV: joi.string().valid('development', 'test', 'staging', 'production').default('development'),
    APP_PORT: joi.number().integer().min(1).max(65535).default(3001),
    APP_NAME: joi.string().default('qaxqjt-cloud-booking'),
    APP_VERSION: joi.string().default('V2026.8.3'),
    APP_BASE_URL: joi.string().uri().optional(),

    DATABASE_URL: joi.string().required().description('Prisma DSN，MySQL 或 PostgreSQL'),

    REDIS_HOST: joi.string().optional(),
    REDIS_PORT: joi.number().integer().optional(),
    REDIS_PASSWORD: joi.string().optional(),

    JWT_ACCESS_SECRET: joi.string().min(16).required().description('生产至少 64 字节随机'),
    JWT_REFRESH_SECRET: joi.string().min(16).required().description('与 access 用两个不同密钥'),
    JWT_ACCESS_TTL_MIN: joi.number().integer().min(5).max(1440).default(30),
    JWT_REFRESH_TTL_DAY: joi.number().integer().min(1).max(90).default(7),
    JWT_ISSUER: joi.string().default('qaxqjt-cloud'),
    JWT_AUDIENCE: joi.string().default('qaxqjt-admin-front'),

    BCRYPT_ROUNDS: joi.number().integer().min(8).max(15).default(12),

    CORS_ORIGINS: joi.array().items(joi.string()).default([]),
    CORS_CREDENTIALS: joi.boolean().default(true),

    RATE_LIMIT_WINDOW_MS: joi.number().integer().default(60000),
    RATE_LIMIT_MAX: joi.number().integer().default(200),

    LOG_LEVEL: joi.string().valid('trace', 'debug', 'info', 'warn', 'error', 'fatal').default('info'),

    FIN_DOUBLE_CHECK_ABOVE: joi.number().precision(2).default(10000)
  })
  .unknown()
  .required();

const { value: env, error } = schema.validate({ ...process.env, CORS_ORIGINS: CORS_ORIGINS_ARRAY });

if (error) {
  // 不抛 fatal 让 /healthz 仍可用，但必须打印红警
  // eslint-disable-next-line no-console
  console.error(
    '[CONFIG FATAL] .env 配置校验失败（按 .env.example 补齐必填）：\n' +
      error.details.map(d => `  · ${d.message}`).join('\n')
  );
}

/** 约定：1 = 毫秒时间戳，同步 MySQL _ts BIGINT 列 */
const nowMs = () => Date.now();

const idPrefixes = {
  account: 'acc',
  role: 'role',
  perm: 'perm',
  audit: 'aud',
  loginAttempt: 'lat',
  session: 'sess',
  customer: 'cus',
  appointment: 'apt',
  apptPlay: 'app',
  apptAudit: 'apa',
  order: 'ord',
  orderItem: 'oit',
  payment: 'pay',
  refund: 'rfd',
  schedule: 'sch',
  scheduleVenue: 'svn',
  castSheet: 'cas',
  castCrew: 'ccr',
  setting: 'set',
  backup: 'bak',
  migration: 'mig',
  performer: 'pf',
  play: 'pla',
  playCast: 'pc',
  invItem: 'inv',
  invRecord: 'ivr',
  content: 'ct',
  wageRule: 'wru',
  wageBatch: 'wba',
  wageItem: 'wit',
  ledger: 'led',
  invoice: 'fin',
  recon: 'rec',
  debt: 'dbt',
  attendance: 'att',
  punch: 'pch',
  leave: 'lea',
  overtime: 'ovt'
};

const idByCtx = (prefix, size = 8, nanoid) => {
  const p = idPrefixes[prefix] || prefix;
  const tail = (nanoid && typeof nanoid === 'function' ? nanoid(size) : randomAlpha(size)).replace(/-|_/g, '');
  return `${p}_${tail}`;
};

const randomAlpha = n => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < n; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
};

module.exports = {
  env,
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  nowMs,
  idByCtx,
  idPrefixes,
  CORS_ORIGINS_ARRAY,
  ROOT_DIR: path.resolve(__dirname, '..', '..')
};
