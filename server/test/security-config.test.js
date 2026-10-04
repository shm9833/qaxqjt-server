'use strict';

/**
 * security-config 开关热更新单测：用 require.cache 桩 prisma，验证默认值/加载/变更。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const controllerDir = path.resolve(__dirname, '../src/services');
const prismaId = require.resolve('../utils/prisma', { paths: [controllerDir] });
const loggerId = require.resolve('../utils/logger', { paths: [controllerDir] });

let settingRow = null;
const stubPrisma = { setting: { findUnique: async () => settingRow } };
const stubLogger = { info() {}, error() {}, warn() {} };
require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: stubPrisma };
require.cache[loggerId] = { id: loggerId, filename: loggerId, loaded: true, exports: stubLogger };

const sc = require('../src/services/security-config');

test('初始未加载时 getCaptchaEnabled 返回 false（兜底，不抛）', () => {
  // 模块刚 require 时 _loaded=false
  // 注意：require 时未自动加载，所以首次返回 false 并触发异步 reload
  assert.strictEqual(sc.getCaptchaEnabled(), false);
});

test('Setting 不存在 → enabled=false', async () => {
  settingRow = null;
  const r = await sc.reloadCaptchaEnabled();
  assert.strictEqual(r, false);
  assert.strictEqual(sc.getCaptchaEnabled(), false);
});

test('Setting value="1" → enabled=true', async () => {
  settingRow = { key: sc.KEY_CAPTCHA, value: '1', updatedAt: new Date() };
  const r = await sc.reloadCaptchaEnabled();
  assert.strictEqual(r, true);
  assert.strictEqual(sc.getCaptchaEnabled(), true);
});

test('Setting value="0" → enabled=false', async () => {
  settingRow = { key: sc.KEY_CAPTCHA, value: '0', updatedAt: new Date() };
  const r = await sc.reloadCaptchaEnabled();
  assert.strictEqual(r, false);
  assert.strictEqual(sc.getCaptchaEnabled(), false);
});

test('Setting value 非 "1"（如 "true"）→ 仍 false（严格匹配）', async () => {
  settingRow = { key: sc.KEY_CAPTCHA, value: 'true', updatedAt: new Date() };
  const r = await sc.reloadCaptchaEnabled();
  assert.strictEqual(r, false);
});

test('reload 失败时保持上一值不抛', async () => {
  // 先置 true
  settingRow = { key: sc.KEY_CAPTCHA, value: '1', updatedAt: new Date() };
  stubPrisma.setting.findUnique = async () => settingRow;
  await sc.reloadCaptchaEnabled();
  assert.strictEqual(sc.getCaptchaEnabled(), true);
  // 换抛错桩
  stubPrisma.setting.findUnique = async () => { throw new Error('db down'); };
  const r = await sc.reloadCaptchaEnabled(); // 失败
  assert.strictEqual(r, true); // 保持上一值
  assert.strictEqual(sc.getCaptchaEnabled(), true);
  stubPrisma.setting.findUnique = async () => settingRow; // 还原
});

test('轮询器可启动/停止且不抛', () => {
  sc.startSecurityConfigPoller();
  sc.startSecurityConfigPoller(); // 重复启动幂等
  sc.stopSecurityConfigPoller();
  sc.stopSecurityConfigPoller();
  assert.ok(true);
});
