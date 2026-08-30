/* ==========================================================================
 * js/api-config.js —— 前端单一可信 API 配置来源（核心规则：禁止业务脚本硬编码 URL）
 * ----------------------------------------------------------------------------
 * 使用顺序：
 *   1. 页面全局变量 window.__QAXQJT_API_BASE__（EdgeOne Pages / Nginx SSI 注入）
 *   2. localStorage.getItem('api_base_url')（管理员在 login.html 自定义）
 *   3. 同源相对路径 '/api'（推荐：前端和API部署在同域，Nginx 反代 /api → 后端）
 *   4. 本机开发兜底 'http://localhost:3001'
 *
 * 与经验 ID 100090142 一致：单一可信来源 + 相对路径同源优先
 * ========================================================================== */
(function (global) {
  'use strict';

  var STORAGE_KEYS = {
    API_BASE: 'qaxqjt_api_base_url',
    ACCESS_TOKEN: 'qaxqjt_access_token',
    REFRESH_TOKEN: 'qaxqjt_refresh_token',
    CURRENT_USER: 'qaxqjt_current_user',
    FALLBACK_MODE: 'qaxqjt_fallback_mode' // 后端不可用时，localStorage 模式开关
  };

  var PATHS = {
    AUTH_LOGIN: '/v1/auth/login',
    AUTH_REFRESH: '/v1/auth/refresh',
    AUTH_LOGOUT: '/v1/auth/logout',
    AUTH_ME: '/v1/auth/me',

    ACCOUNTS: '/v1/accounts',
    ACCOUNT_ME_PWD: '/v1/accounts/me/password',

    ROLES: '/v1/roles',
    ROLE_PERMISSIONS: function (rid) { return '/v1/roles/' + rid + '/permissions'; },
    PERMISSIONS: '/v1/permissions',

    AUDIT_LOGS: '/v1/audit-logs',

    CUSTOMERS: '/v1/customers',
    CUSTOMERS_BY_ID: function (id) { return '/v1/customers/' + id; },

    APPOINTMENTS: '/v1/appointments',
    APPOINTMENTS_STATS: '/v1/appointments/stats',
    APPOINTMENTS_BY_ID: function (id) { return '/v1/appointments/' + id; },
    APPOINTMENTS_TRANSITION: function (id) { return '/v1/appointments/' + id + '/transition'; },
    APPOINTMENTS_PLAYS: function (id) { return '/v1/appointments/' + id + '/plays'; },
    APPOINTMENTS_AUDITS: function (id) { return '/v1/appointments/' + id + '/audit-logs'; },

    ORDERS: '/v1/orders',
    ORDERS_BY_ID: function (id) { return '/v1/orders/' + id; },
    SCHEDULES: '/v1/schedules',
    PERFORMERS: '/v1/performers',
    CAST_SHEETS: '/v1/cast-sheets',
    ATTENDANCES: '/v1/attendances',
    WAGE_BATCHES: '/v1/wage-batches',
    FIN_LEDGER: '/v1/fin-ledger',
    INVENTORY: '/v1/inventory',
    CONTENTS: '/v1/contents'
  };

  function _resolveBase() {
    if (global.__QAXQJT_API_BASE__ && typeof global.__QAXQJT_API_BASE__ === 'string') {
      return _stripTrailingSlash(global.__QAXQJT_API_BASE__);
    }
    try {
      var s = global.localStorage && global.localStorage.getItem(STORAGE_KEYS.API_BASE);
      if (s && /^https?:\/\//i.test(s)) return _stripTrailingSlash(s);
    } catch (_e) { /* noop */ }
    // EdgeOne Pages：同源 /api 由 Edge Function 反代到后端（免备案首选）
    if (global.location && /\.edgeone\.app$/i.test(global.location.hostname)) {
      return '';
    }
    // 免备案部署：HTTPS 页面(GitHub Pages)用 HTTPS API；HTTP 页面(服务器直访)用同源 /api
    if (global.location && global.location.protocol === 'https:') {
      return 'https://1.14.106.173';
    }
    return '';
  }

  function _stripTrailingSlash(u) { return u.replace(/\/+$/, ''); }

  var BASE = _resolveBase();
  var HOMOLOGOUS_PROXY_PREFIX = '/api'; // 同源反代路径（与 Nginx location /api { proxy_pass http://node:3001; } 对齐）

  /**
   * 计算最终请求 URL：
   *   - 如果 BASE 为空（同源反代） → /api + path
   *   - 如果 BASE 是 http(s) → BASE + path
   */
  function resolveUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    if (!BASE) {
      return (HOMOLOGOUS_PROXY_PREFIX + path).replace(/^\/+/, '/');
    }
    return BASE + (path.charAt(0) === '/' ? path : '/' + path);
  }

  function getAccessToken() {
    try { return global.localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN) || null; }
    catch (_e) { return null; }
  }
  function setAccessToken(t) {
    try { global.localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, t || ''); } catch (_e) {}
  }
  function getRefreshToken() {
    try { return global.localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN) || null; }
    catch (_e) { return null; }
  }
  function setRefreshToken(t) {
    try { global.localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, t || ''); } catch (_e) {}
  }
  function getCurrentUser() {
    try {
      var s = global.localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
      return s ? JSON.parse(s) : null;
    } catch (_e) { return null; }
  }
  function setCurrentUser(u) {
    try {
      if (!u) global.localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
      else global.localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(u));
    } catch (_e) {}
  }
  function clearAuth() {
    try {
      global.localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
      global.localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
      global.localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    } catch (_e) {}
  }
  function isFallbackMode() {
    try {
      var v = global.localStorage.getItem(STORAGE_KEYS.FALLBACK_MODE);
      return v === '1' || v === 'true';
    } catch (_e) { return false; }
  }
  function setFallbackMode(flag) {
    try {
      global.localStorage.setItem(STORAGE_KEYS.FALLBACK_MODE, flag ? '1' : '0');
    } catch (_e) {}
  }

  global.QAXQJT_API_CONFIG = {
    STORAGE_KEYS: STORAGE_KEYS,
    PATHS: PATHS,
    BASE: BASE,
    HOMOLOGOUS_PROXY_PREFIX: HOMOLOGOUS_PROXY_PREFIX,
    resolveUrl: resolveUrl,
    getAccessToken: getAccessToken,
    setAccessToken: setAccessToken,
    getRefreshToken: getRefreshToken,
    setRefreshToken: setRefreshToken,
    getCurrentUser: getCurrentUser,
    setCurrentUser: setCurrentUser,
    clearAuth: clearAuth,
    isFallbackMode: isFallbackMode,
    setFallbackMode: setFallbackMode
  };
})(typeof window !== 'undefined' ? window : this);
