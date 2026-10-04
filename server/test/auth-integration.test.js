'use strict';

/**
 * auth 控制器集成测试（HTTP 层 / supertest）
 * 覆盖：登录成功/失败（密码错/账号不存在）、验证码关闭跳过、
 *       /auth/me 鉴权、/auth/logout、参数校验 400
 * 桩：prisma（accountsV2/loginAttempt/adminSession）+ audit-service + security-config(captcha off) + crypto(verifyPassword)
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://stub:stub@stub.neon.db/stub';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_jwt_access_secret_min_64_chars_xxxxxxxxxxxx';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_min_64_chars_xxxxxxxxxxx';
process.env.JWT_ISSUER = process.env.JWT_ISSUER || 'qaxqjt-cloud';
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'qaxqjt-admin-front';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const controllerDir = path.resolve(__dirname, '../src/controllers');
const prismaId = require.resolve('../utils/prisma', { paths: [controllerDir] });

const stubPrisma = {
  accountsV2: {
    findUnique: async args => {
      // 登录：按 username 查；me：按 id 查
      const w = (args && args.where) || {};
      if (w.username === 'admin') {
        return {
          id: 'acc_admin_001', username: 'admin', passwordHash: 'stub_hash',
          role: 'super_admin', realName: '超级管理员', status: 'active',
          forcePwdChange: false, avatarUrl: null, phone: '13800000000', email: null,
          failedLoginCount: 0, lockedUntil: null,
          userRoles: [{ role: { id: 'r_sa', name: 'super_admin', level: 999, rolePermissions: [] } }]
        };
      }
      if (w.id === 'acc_admin_001') {
        return {
          id: 'acc_admin_001', username: 'admin', role: 'super_admin', realName: '超级管理员',
          status: 'active', phone: '13800000000', email: null, avatarUrl: null,
          forcePwdChange: false, lastLoginAt: null,
          userRoles: [{ role: { id: 'r_sa', name: 'super_admin', level: 999, rolePermissions: [] } }]
        };
      }
      return null;
    },
    update: async args => ({ ...(args && args.data) })
  },
  loginAttempt: { findMany: async () => [], create: async () => ({}) },
  adminSession: { findUnique: async () => null, deleteMany: async () => ({ count: 0 }), create: async () => ({}) }
};
require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: stubPrisma };

// 关闭验证码
const secId = require.resolve('../services/security-config', { paths: [controllerDir] });
require.cache[secId] = {
  id: secId, filename: secId, loaded: true,
  exports: { getCaptchaEnabled: () => false, get: () => ({}), set: async () => {} }
};

// 桩密码校验：控制对错
let _pwdOk = true;
const cryptoId = require.resolve('../utils/crypto', { paths: [controllerDir] });
require.cache[cryptoId] = {
  id: cryptoId, filename: cryptoId, loaded: true,
  exports: {
    verifyPassword: async () => _pwdOk,
    hashPassword: async () => 'hashed',
    signAccess: p => jwt.sign(p, process.env.JWT_ACCESS_SECRET, { issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '30m' }),
    signRefresh: p => jwt.sign(p, process.env.JWT_REFRESH_SECRET, { issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '7d' }),
    verifyRefresh: t => jwt.verify(t, process.env.JWT_REFRESH_SECRET),
    nowMs: () => Date.now()
  }
};

const auditId = require.resolve('../services/audit-service', { paths: [controllerDir] });
require.cache[auditId] = { id: auditId, filename: auditId, loaded: true, exports: { audit: async () => {} } };

const app = require('../src/app');
const handler = app.callback();

function signToken(role) {
  return jwt.sign(
    { sub: 'acc_admin_001', username: 'admin', role, realName: '超级管理员' },
    process.env.JWT_ACCESS_SECRET,
    { issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' }
  );
}
const auth = role => ({ Authorization: 'Bearer ' + signToken(role) });

// ========== 登录 ==========

test('POST /v1/auth/login 缺少 username 返回 400 VALIDATION_ERROR', async () => {
  const res = await request(handler).post('/v1/auth/login').send({ password: '123456' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /v1/auth/login 账号不存在返回 401 UNAUTHORIZED', async () => {
  _pwdOk = true;
  const res = await request(handler)
    .post('/v1/auth/login')
    .send({ username: 'nouser', password: 'whatever' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
});

test('POST /v1/auth/login 密码错误返回 401（含剩余次数提示）', async () => {
  _pwdOk = false;
  const res = await request(handler)
    .post('/v1/auth/login')
    .send({ username: 'admin', password: 'wrongpass' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
  assert.match(res.body.error.message, /用户名或密码错误/);
});

test('POST /v1/auth/login 成功返回 200 + accessToken + refreshToken + user', async () => {
  _pwdOk = true;
  const res = await request(handler)
    .post('/v1/auth/login')
    .send({ username: 'admin', password: process.env.QAXQJT_ADMIN_PWD || '' });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.accessToken, '必须返回 accessToken');
  assert.ok(res.body.data.refreshToken, '必须返回 refreshToken');
  assert.strictEqual(res.body.data.tokenType, 'Bearer');
  assert.strictEqual(res.body.data.user.username, 'admin');
  assert.strictEqual(res.body.data.user.role, 'super_admin');
});

// ========== /auth/me ==========

test('GET /v1/auth/me 无 token 返回 401', async () => {
  const res = await request(handler).get('/v1/auth/me');
  assert.strictEqual(res.status, 401);
});

test('GET /v1/auth/me 带 super_admin token 返回 200 + 用户与角色', async () => {
  const res = await request(handler).get('/v1/auth/me').set(auth('super_admin'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.username, 'admin');
  assert.strictEqual(res.body.data.role, 'super_admin');
  assert.ok(Array.isArray(res.body.data.roles), 'roles 必须是数组');
  assert.ok(Array.isArray(res.body.data.permissions), 'permissions 必须是数组');
});

// ========== /auth/logout ==========

test('POST /v1/auth/logout 带 token 返回 200 + ok=true', async () => {
  const res = await request(handler).post('/v1/auth/logout').set(auth('super_admin')).send({});
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.ok, true);
});

// ========== /auth/refresh ==========

test('POST /v1/auth/refresh 无效 refreshToken 返回 401', async () => {
  const res = await request(handler).post('/v1/auth/refresh').send({ refreshToken: 'invalid.token.here' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
});

// ========== 扫码登录 ==========

test('POST /v1/auth/qrcode/create 返回 200 + token（无需鉴权）', async () => {
  const res = await request(handler).post('/v1/auth/qrcode/create');
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.token, '必须返回 token');
  assert.ok(res.body.data.expiresAt, '必须返回 expiresAt');
});

test('GET /v1/auth/qrcode/status/:token 不存在的 token 返回 expired', async () => {
  const res = await request(handler).get('/v1/auth/qrcode/status/notexist_token_xxx');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.status, 'expired');
});
