'use strict';

/**
 * src/utils/crypto.js —— bcrypt 密码 + JWT（access/refresh 双 token）
 * M-11：access 30min + refresh 7day，M-14：bcrypt rounds 可配置
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');
const { env, nowMs, idByCtx } = require('../config');

const hashPassword = async plain => bcrypt.hash(plain, Number(env.BCRYPT_ROUNDS) || 12);
const verifyPassword = async (plain, hash) => {
  try {
    return await bcrypt.compare(plain, hash);
  } catch (_e) {
    return false;
  }
};

const signAccess = payload =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: `${env.JWT_ACCESS_TTL_MIN}m`
  });

const signRefresh = payload =>
  jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: `${env.JWT_REFRESH_TTL_DAY}d`,
    jwtid: idByCtx('session', 20, nanoid)
  });

const verifyAccess = token => jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE });
const verifyRefresh = token => jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE });

module.exports = {
  hashPassword,
  verifyPassword,
  signAccess,
  signRefresh,
  verifyAccess,
  verifyRefresh,
  nowMs
};
