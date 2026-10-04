'use strict';

/**
 * src/services/security-config.js —— 安全配置热更新（基于 Setting 表）
 * 当前承载：登录图形验证码开关 security.login.captcha.enabled
 *   - 启动时从 DB 加载到内存
 *   - 30s 定时轮询刷新
 *   - system-settings 写入命中 key 时主动 reload（秒级生效）
 */
const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

const KEY_CAPTCHA = 'security.login.captcha.enabled';

let _captchaEnabled = null;   // boolean|null
let _captchaUpdatedAt = null; // string
let _loaded = false;
let _poller = null;

async function reloadCaptchaEnabled() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY_CAPTCHA } });
    const enabled = !!(row && row.value === '1');
    const prev = _captchaEnabled;
    _captchaEnabled = enabled;
    _captchaUpdatedAt = row && row.updatedAt ? new Date(row.updatedAt).toISOString() : null;
    _loaded = true;
    if (prev !== enabled) {
      logger.info({ module: 'security-config', key: KEY_CAPTCHA, enabled, updatedAt: _captchaUpdatedAt }, '登录验证码开关变更');
    }
    return enabled;
  } catch (e) {
    logger.error({ err: e.message, key: KEY_CAPTCHA }, '加载登录验证码开关失败，保持原值');
    return _captchaEnabled;
  }
}

function getCaptchaEnabled() {
  if (!_loaded) {
    // 首次未加载时异步触发一次（不阻塞调用方），并返回 false 兜底
    reloadCaptchaEnabled().catch(() => {});
    return false;
  }
  return _captchaEnabled === true;
}

function getCaptchaUpdatedAt() {
  return _captchaUpdatedAt;
}

const POLL_MS = 30 * 1000;
function startSecurityConfigPoller() {
  if (_poller) return;
  reloadCaptchaEnabled().catch(() => {});
  _poller = setInterval(() => { reloadCaptchaEnabled().catch(() => {}); }, POLL_MS);
  _poller.unref?.(); // 不阻止进程退出
}

function stopSecurityConfigPoller() {
  if (_poller) { clearInterval(_poller); _poller = null; }
}

module.exports = {
  KEY_CAPTCHA,
  getCaptchaEnabled,
  getCaptchaUpdatedAt,
  reloadCaptchaEnabled,
  startSecurityConfigPoller,
  stopSecurityConfigPoller
};
