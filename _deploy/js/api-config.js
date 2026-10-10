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
    // ---- auth ----
    AUTH_LOGIN: '/v1/auth/login',
    AUTH_REFRESH: '/v1/auth/refresh',
    AUTH_LOGOUT: '/v1/auth/logout',
    AUTH_ME: '/v1/auth/me',
    AUTH_CAPTCHA: '/v1/auth/captcha',
    AUTH_QR_CREATE: '/v1/auth/qrcode/create',
    AUTH_QR_CONFIRM: '/v1/auth/qrcode/confirm',
    AUTH_QR_STATUS: function (token) { return '/v1/auth/qrcode/status/' + token; },

    // ---- accounts / IAM ----
    ACCOUNTS: '/v1/accounts',
    ACCOUNTS_BY_ID: function (id) { return '/v1/accounts/' + id; },
    ACCOUNT_RESET_PWD: function (id) { return '/v1/accounts/' + id + '/reset-password'; },
    ACCOUNT_ME_PWD: '/v1/accounts/me/password',

    ROLES: '/v1/roles',
    ROLES_BY_ID: function (id) { return '/v1/roles/' + id; },
    ROLE_PERMISSIONS: function (rid) { return '/v1/roles/' + rid + '/permissions'; },
    PERMISSIONS: '/v1/permissions',

    AUDIT_LOGS: '/v1/audit-logs',

    // ---- customers ----
    CUSTOMERS: '/v1/customers',
    CUSTOMERS_BY_ID: function (id) { return '/v1/customers/' + id; },

    // ---- appointments ----
    APPOINTMENTS: '/v1/appointments',
    APPOINTMENTS_STATS: '/v1/appointments/stats',
    APPOINTMENTS_BY_ID: function (id) { return '/v1/appointments/' + id; },
    APPOINTMENTS_TRANSITION: function (id) { return '/v1/appointments/' + id + '/transition'; },
    APPOINTMENTS_PLAYS: function (id) { return '/v1/appointments/' + id + '/plays'; },
    APPOINTMENTS_AUDITS: function (id) { return '/v1/appointments/' + id + '/audit-logs'; },

    // ---- orders ----
    ORDERS: '/v1/orders',
    ORDERS_STATS: '/v1/orders/stats',
    ORDERS_BY_ID: function (id) { return '/v1/orders/' + id; },
    ORDERS_TRANSITION: function (id) { return '/v1/orders/' + id + '/transition'; },
    ORDERS_PAYMENTS: function (id) { return '/v1/orders/' + id + '/payments'; },

    // ---- performers ----
    PERFORMERS: '/v1/performers',
    PERFORMERS_STATS: '/v1/performers/stats',
    PERFORMERS_BY_ID: function (id) { return '/v1/performers/' + id; },
    PERFORMERS_REVIEW: function (id) { return '/v1/performers/' + id + '/review'; },
    PERFORMERS_PUBLIC: '/v1/performers/public',
    PERFORMERS_SELF_REGISTER: '/v1/performers/self-register',
    PERFORMERS_SELF_REGISTER_STATUS: function (idCard) { return '/v1/performers/self-register/status?idCard=' + encodeURIComponent(idCard); },

    // ---- cast sheets ----
    CAST_SHEETS: '/v1/cast-sheets',
    CAST_SHEETS_BY_ID: function (id) { return '/v1/cast-sheets/' + id; },
    CAST_SHEETS_PUBLIC: '/v1/cast-sheets/public',
    CAST_SHEETS_PUBLIC_BY_ID: function (id) { return '/v1/cast-sheets/public/' + id; },

    // ---- attendance ----
    ATTENDANCE: '/v1/attendance',
    ATTENDANCE_BY_ID: function (id) { return '/v1/attendance/' + id; },
    ATTENDANCE_STATS: '/v1/attendance/stats',
    ATTENDANCE_IMPORT: '/v1/attendance/import',
    ATTENDANCE_LEAVES: '/v1/attendance/leaves',
    ATTENDANCE_LEAVES_APPROVE: function (id) { return '/v1/attendance/leaves/' + id + '/approve'; },

    // ---- wages ----
    WAGES: '/v1/wages',
    WAGES_BY_ID: function (id) { return '/v1/wages/' + id; },
    WAGES_GENERATE: '/v1/wages/generate',
    WAGE_RULES: '/v1/wage-rules',
    WAGE_RULES_BY_GRADE: function (grade) { return '/v1/wage-rules/' + grade; },
    WAGE_BATCHES: '/v1/wage-batches',
    WAGE_BATCH_CONFIRM: function (id) { return '/v1/wage-batches/' + id + '/confirm'; },
    WAGE_BATCH_POST: function (id) { return '/v1/wage-batches/' + id + '/post'; },

    // ---- finance ledger ----
    FIN_LEDGER: '/v1/fin/ledger',
    FIN_LEDGER_BY_ID: function (id) { return '/v1/fin/ledger/' + id; },
    FIN_SUMMARY: '/v1/fin/summary',

    // ---- inventory ----
    INVENTORY_ITEMS: '/v1/inventory/items',
    INVENTORY_ITEMS_BY_ID: function (id) { return '/v1/inventory/items/' + id; },
    INVENTORY_RECORDS: '/v1/inventory/records',

    // ---- plays & categories ----
    PLAYS: '/v1/plays',
    PLAYS_BY_ID: function (id) { return '/v1/plays/' + id; },
    PLAYS_PUBLIC: '/v1/plays/public',
    PLAY_CATEGORIES: '/v1/play-categories',
    PLAY_CATEGORIES_BY_ID: function (id) { return '/v1/play-categories/' + id; },
    PLAY_CATEGORIES_PUBLIC: '/v1/play-categories/public',

    // ---- schedules ----
    SCHEDULES: '/v1/schedules',
    SCHEDULES_BY_ID: function (id) { return '/v1/schedules/' + id; },
    SCHEDULES_CALENDAR: '/v1/schedules/calendar',
    SCHEDULES_CONFLICTS: '/v1/schedules/conflicts',
    SCHEDULES_STATS: '/v1/schedules/stats',
    SCHEDULES_PUBLIC: '/v1/schedules/public',

    // ---- contents ----
    CONTENTS: '/v1/contents',
    CONTENTS_BY_ID: function (id) { return '/v1/contents/' + id; },
    CONTENTS_PUBLIC: '/v1/contents/public',

    // ---- site assets & troupe config ----
    SITE_ASSETS: '/v1/site-assets',
    SITE_ASSETS_BY_KEY: function (key) { return '/v1/site-assets/' + key; },
    SITE_ASSETS_PUBLIC: '/v1/site-assets/public',
    TROUPE_CONFIG: '/v1/troupe-config',
    TROUPE_CONFIG_TEMPLATES: '/v1/troupe-config/templates',
    TROUPE_CONFIG_WAGE_GRADES: '/v1/troupe-config/wage-grades',

    // ---- system ----
    SYSTEM_INFO: '/v1/system/info',
    SYSTEM_SETTINGS: '/v1/system/settings',
    SYSTEM_SETTINGS_BY_ID: function (id) { return '/v1/system/settings/' + id; },
    SYSTEM_SETTINGS_BATCH: '/v1/system/settings/batch',
    SYSTEM_SETTINGS_BY_KEY: function (key) { return '/v1/system/settings/key/' + key; },

    // ---- public stats ----
    STATS_PUBLIC: '/v1/stats/public',

    // ---- health ----
    HEALTHZ: '/v1/healthz',

    // ---- upload ----
    UPLOAD: '/v1/upload',
    UPLOAD_MULTI: '/v1/upload/multi'
  };

  function _resolveBase() {
    if (global.__QAXQJT_API_BASE__ && typeof global.__QAXQJT_API_BASE__ === 'string') {
      return _stripTrailingSlash(global.__QAXQJT_API_BASE__);
    }
    try {
      var s = global.localStorage && global.localStorage.getItem(STORAGE_KEYS.API_BASE);
      if (s && /^https?:\/\//i.test(s)) return _stripTrailingSlash(s);
    } catch (_e) { /* noop */ }
    // 生产统一走同源 /api 反代（Nginx location /api → node:3001；
    // Cloudflare Tunnel / EdgeOne Pages / HTTP 直访均适用，禁止裸 IP 硬编码）
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
