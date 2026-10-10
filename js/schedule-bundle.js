/* schedule-bundle.js — auto-merged from 11 small JS (v20260930c)
 * 合并目的：减少 HTTP 请求数 12→2，降低首屏 TCP 连接开销
 * 保留 app.js 单独 defer（497KB 不合并）
 * 顺序与原 schedule.html 一致（head→body 末尾）
 * 各子模块自带 IIFE / 防重复注入保护，合并后安全
 * 生成时间：2026-09-30T08:22:42.231Z
 */

/* ===== [1/11] js/favicon-inject.js (1450 bytes) ===== */
(function() {
  'use strict';
  var FAVICON_KEY = 'qaxqjt_custom_favicon';
  var saved = null;
  try {
    var raw = localStorage.getItem(FAVICON_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; }
  if (!saved) return;

  var href = '';
  if (saved.type === 'svg') {
    href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(saved.content);
  } else if (saved.type === 'image') {
    href = 'data:' + (saved.mime || 'image/png') + ';base64,' + saved.content;
  } else {
    return;
  }

  var rels = [
    { rel: 'icon', sizes: null, type: saved.type === 'svg' ? 'image/svg+xml' : (saved.mime || 'image/png') },
    { rel: 'shortcut icon', sizes: null, type: saved.type === 'svg' ? 'image/svg+xml' : (saved.mime || 'image/png') },
    { rel: 'apple-touch-icon', sizes: '180x180', type: null }
  ];

  rels.forEach(function(r) {
    var link = document.querySelector('link[data-custom-favicon="' + r.rel + '"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = r.rel;
      link.setAttribute('data-custom-favicon', r.rel);
      if (r.sizes) link.setAttribute('sizes', r.sizes);
      if (r.type) link.setAttribute('type', r.type);
      document.head.appendChild(link);
    }
    link.href = href;
  });

  try {
    if (typeof module !== 'undefined' && module.exports) module.exports = { applyFavicon: function(){} };
  } catch (e) {}
})();

/* ===== [2/11] js/wechat-fallback.js (8791 bytes) ===== */
/**
 * 秦安县秦剧团文化演出有限公司云端预约系统 - 微信内置浏览器友好降级引导
 * -------------------------------------------------------------
 * 功能：
 *   0. 【优先执行】在 <meta charset> 后注入 WeChat/移动端专属 meta 标签
 *      - apple-mobile-web-app-capable / status-bar-style / title
 *      - format-detection (禁止电话号码/邮箱自动识别)
 *      - theme-color (顶栏配色，与蓝色国风主色一致)
 *      - wechat:author / wechat:digest (微信卡券分享元数据)
 *      - x5-orientation / x5-page-mode (QQ/X5 内核横屏控制)
 *   1. 自动检测当前 UA 是否为微信内置浏览器 (MicroMessenger)
 *   2. 在「直播接口页 / 含外链跳转（快手、抖音）」等微信可能拦截的页面：
 *      - 页面顶部插入一条可关闭的黄色提醒条，提示：
 *        『为保障直播/预约体验，建议点击右上角【⋯】→ 选择【在浏览器打开】』
 *   3. 在首页/任意页显示首次欢迎提示（可关闭，localStorage 记住 7 天不再弹出）
 *   4. 监听外链跳转（target=_blank）若在微信中，尝试提示用户（避免直接弹出未经授权）
 *
 * 部署：所有前台 HTML 引用 <script src="js/wechat-fallback.js" defer>
 *       后台页面引用 <script src="../js/wechat-fallback.js" defer>
 * -------------------------------------------------------------
 */
(function () {
  'use strict';

  // ================================================================
  // 【P0 优先】在 <meta charset> 之后注入 WeChat/移动端专属 meta 标签
  // ================================================================
  function injectMetaTags() {
    if (!document.head) return;
    var charsetMeta = document.querySelector('meta[charset]');
    var refNode = charsetMeta ? charsetMeta.nextSibling : document.head.firstChild;

    var metaList = [
      // iOS WebApp 模式
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { name: 'apple-mobile-web-app-title', content: '秦安县秦剧团文化演出有限公司' },
      // 禁止自动识别
      { name: 'format-detection', content: 'telephone=no,email=no,address=no,date=no' },
      // 顶栏主题色（蓝色国风主色 #0F4C81）
      { name: 'theme-color', content: '#0F4C81' },
      { name: 'msapplication-TileColor', content: '#0F4C81' },
      // 微信分享专属元数据
      { name: 'wechat:author', content: '秦安县秦剧团文化演出有限公司' },
      { name: 'wechat:digest', content: '秦安本土老牌专业秦腔演出团体，承接乡村庙会、惠民下乡、节庆专场、企业庆典等各类戏曲演出预约' },
      // QQ / X5 内核
      { name: 'x5-orientation', content: 'portrait' },
      { name: 'x5-page-mode', content: 'app' },
      { name: 'x5-fullscreen', content: 'true' },
      // UC 内核
      { name: 'uc-orientation', content: 'portrait' },
      { name: 'uc-fullscreen', content: 'yes' }
    ];

    for (var i = 0; i < metaList.length; i++) {
      var def = metaList[i];
      if (!def || !def.name) continue;
      // 避免重复注入
      var existing = document.querySelector('meta[name="' + def.name + '"]');
      if (existing) {
        if (def.content) existing.setAttribute('content', def.content);
        continue;
      }
      var m = document.createElement('meta');
      m.setAttribute('name', def.name);
      m.setAttribute('content', def.content);
      if (refNode && refNode.parentNode) {
        refNode.parentNode.insertBefore(m, refNode);
      } else {
        document.head.appendChild(m);
      }
    }
  }
  // 立即执行（不等待 DOMContentLoaded，保证 meta 在 <head> 解析第一时间就位）
  if (document.head) injectMetaTags();
  else document.addEventListener('DOMContentLoaded', injectMetaTags);

  var ua = (navigator.userAgent || '').toString();
  var isWechat = /MicroMessenger/i.test(ua);
  var isMiniProgram = /miniProgram/i.test(ua) || window.__wxjs_environment === 'miniprogram';

  // —— 非微信环境，直接退出 ——
  if (!isWechat && !isMiniProgram) return;

  var STORAGE_KEY = 'qaxqjt_wx_tip_closed_at';
  var TIP_TTL_MS = 7 * 24 * 3600 * 1000; // 7天

  function shouldShowTip() {
    try {
      var closedAt = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10) || 0;
      // 直播页/外链页：每次进入都提示
      var path = (location.pathname || '').toLowerCase();
      var alwaysPages = ['live-api', 'booking', 'services'];
      for (var i = 0; i < alwaysPages.length; i++) {
        if (path.indexOf(alwaysPages[i]) !== -1) return true;
      }
      // 其他页 7天内不再提示
      return Date.now() - closedAt > TIP_TTL_MS;
    } catch (e) { return true; }
  }

  function closeTip() {
    try {
      var bar = document.getElementById('wx-ua-tip-bar');
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch (e) {}
  }

  function buildTipBar() {
    // —— 样式（内联，不依赖 CSS 文件，页面加载第一时间能看到）——
    var css = [
      '#wx-ua-tip-bar{position:fixed;top:0;left:0;right:0;z-index:2147483647;',
      'background:linear-gradient(90deg,#fff8e6,#ffefcc);border-bottom:2px solid #e6a23c;',
      'padding:10px 48px 10px 16px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",KaiTi,serif;',
      'font-size:14px;line-height:1.55;color:#7d4e00;box-shadow:0 2px 14px rgba(230,162,60,0.18);}',
      '#wx-ua-tip-bar .t1{font-weight:600;display:block;margin-bottom:2px;}',
      '#wx-ua-tip-bar .t2{font-size:12px;color:#a56e10;}',
      '#wx-ua-tip-bar b{color:#c0392b;}',
      '#wx-ua-tip-bar .cls{position:absolute;top:8px;right:10px;cursor:pointer;',
      'background:rgba(192,57,43,0.1);border:1px solid rgba(192,57,43,0.25);color:#c0392b;',
      'padding:3px 10px;border-radius:14px;font-size:12px;user-select:none;line-height:1.4;}',
      '#wx-ua-tip-bar .cls:active{background:rgba(192,57,43,0.2);}',
      'body{padding-top:54px !important;}'
    ].join('');

    var style = document.createElement('style');
    if (style.styleSheet) style.styleSheet.cssText = css;
    else style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'wx-ua-tip-bar';
    bar.innerHTML =
      '<span class="cls" id="wx-tip-close">知道了</span>' +
      '<span class="t1">📱 微信访问 · 体验提示</span>' +
      '<span class="t2">直播、预约、外链支付建议点击右上角【<b>⋯</b>】→ 选择【<b>在浏览器打开</b>】即可获得完整体验，避免出现「未经授权」。</span>';

    var insert = function () {
      if (document.body) document.body.insertBefore(bar, document.body.firstChild);
      else document.documentElement.appendChild(bar);

      var cls = document.getElementById('wx-tip-close');
      if (cls) cls.onclick = closeTip;
    };
    if (document.readyState === 'loading' && !document.body) {
      document.addEventListener('DOMContentLoaded', insert);
    } else {
      insert();
    }
  }

  // —— 主入口 ——
  if (shouldShowTip()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', buildTipBar);
    } else {
      buildTipBar();
    }
  }

  // —— 监听外链 <a target=_blank>，click 时额外提醒 ——
  function bindExternalLinks() {
    try {
      var links = document.querySelectorAll('a[target="_blank"]');
      links.forEach(function (a) {
        if (a.__wxTipBound) return;
        a.__wxTipBound = true;
        a.addEventListener('click', function (ev) {
          var href = (a.href || '').toLowerCase();
          if (href.indexOf('http') !== 0) return;
          // 外链（非本域）
          if (href.indexOf(location.host) === -1) {
            // 发出一个小的页面提示（不拦截跳转，只提醒）
            // R22 CSP合规：使用 wx-tip-link-alert CSS class 替代 style.borderColor/style.background
            try {
              var tip = document.getElementById('wx-ua-tip-bar');
              if (tip) try { tip.classList.add('wx-tip-link-alert'); } catch (_csp) {}
            } catch (e) {}
          }
        }, { passive: true });
      });
    } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindExternalLinks);
  } else {
    bindExternalLinks();
  }
})();

/* ===== [3/11] js/year-lite.js (1670 bytes) ===== */
(function() {
  'use strict';

  function updateYearPlaceholders() {
    var currentYear = new Date().getFullYear();
    var yearPattern = /\{year\}/g;

    function replaceInTextNodes(element) {
      var nodes = element.childNodes;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.nodeType === Node.TEXT_NODE) {
          if (yearPattern.test(node.nodeValue)) {
            node.nodeValue = node.nodeValue.replace(yearPattern, currentYear);
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
            replaceInTextNodes(node);
          }
        }
      }
    }

    if (document.body) {
      replaceInTextNodes(document.body);
    }

    var allElements = document.querySelectorAll('*');
    for (var j = 0; j < allElements.length; j++) {
      var elem = allElements[j];
      var attrs = elem.attributes;
      for (var k = 0; k < attrs.length; k++) {
        var attr = attrs[k];
        if (yearPattern.test(attr.value)) {
          attr.value = attr.value.replace(yearPattern, currentYear);
        }
      }
    }

    if (document.title && yearPattern.test(document.title)) {
      document.title = document.title.replace(yearPattern, currentYear);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateYearPlaceholders);
  } else {
    updateYearPlaceholders();
  }

  window.YearLite = {
    getYear: function() {
      return new Date().getFullYear();
    },
    update: updateYearPlaceholders
  };
})();

/* ===== [4/11] js/api-config.js (6187 bytes) ===== */
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
    ATTENDANCE: '/v1/attendance',
    ATTENDANCE_LEAVES: '/v1/attendance/leaves',
    WAGE_BATCHES: '/v1/wage-batches',
    WAGE_BATCH_CONFIRM: function (id) { return '/v1/wage-batches/' + id + '/confirm'; },
    WAGE_BATCH_POST: function (id) { return '/v1/wage-batches/' + id + '/post'; },
    FIN_LEDGER: '/v1/fin/ledger',
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
    if (global.location && /\.edgeone\.(app|dev)$/i.test(global.location.hostname)) {
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

/* ===== [5/11] js/api-request.js (10747 bytes) ===== */
/* ==========================================================================
 * js/api-request.js —— 前端统一 fetch 请求封装
 * ----------------------------------------------------------------------------
 * 功能：
 *   1. 单一入口：QAXQJT_API.request(method, path, options)
 *   2. 自动注入 Bearer Token，401 时自动 refresh（单次重试），再次 401 跳登录
 *   3. CORS 失败 / 网络失败：自动降级为 localStorage 模式（兼容后端未启动场景）
 *   4. 统一错误提示：依赖页面全局 showToast(msg, type)，如无则 alert
 *   5. 分页：{ page, pageSize, keyword } 自动拼 querystring
 *
 * 与经验 ID 100081984 + 100079856 一致：同源路径优先 / 错误分支可行动化
 * ========================================================================== */
(function (global) {
  'use strict';

  var CFG = global.QAXQJT_API_CONFIG || {};
  var RESOLVE_URL = CFG.resolveUrl || function (p) { return p; };
  var _refreshPromise = null; // 并发 refresh 串行锁
  var _networkHealthy = true;  // 连通性缓存（失败一次短时降级）

  function _toast(msg, type) {
    if (typeof global.showToast === 'function') {
      try { global.showToast(msg, type || (type === 'success' ? 'success' : 'error')); return; } catch (_e) {}
    }
    if (typeof console !== 'undefined' && console.warn) console.warn('[toast]', type, msg);
  }

  function _qs(obj) {
    if (!obj) return '';
    var parts = [];
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v === undefined || v === null || v === '') return;
      if (Array.isArray(v)) {
        v.forEach(function (x) { parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(x))); });
      } else {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
      }
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  /**
   * 核心请求方法
   * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
   * @param {string} path  相对路径（/v1/xxx）或完整 URL
   * @param {{body?:any,query?:any,headers?:object,timeoutMs?:number,skipAuth?:boolean,showErrorToast?:boolean,fallback?:function,fallbackRead?:function}} opts
   */
  async function request(method, path, opts) {
    opts = opts || {};
    var showError = opts.showErrorToast !== false;
    var timeoutMs = Number(opts.timeoutMs) || 15000;

    // 1. 强制降级？直接走 fallback（用户在系统页勾选后端离线模式）
    if (CFG.isFallbackMode && CFG.isFallbackMode() && typeof opts.fallback === 'function') {
      try { return await opts.fallback({ reason: 'force_fallback' }); }
      catch (e) { throw e; }
    }
    if (CFG.isFallbackMode && CFG.isFallbackMode() && typeof opts.fallbackRead === 'function') {
      try { return await opts.fallbackRead({ reason: 'force_fallback' }); }
      catch (e) { throw e; }
    }

    var fullUrl = RESOLVE_URL(path) + _qs(opts.query);
    var ctrl = new (global.AbortController || function () { var o = {}; o.abort = function () {}; return o; })();
    var timer = setTimeout(function () { try { ctrl.abort(); } catch (_e) {} }, timeoutMs);

    var headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
    if (!opts.skipAuth) {
      var t = CFG.getAccessToken && CFG.getAccessToken();
      if (t) headers['Authorization'] = 'Bearer ' + t;
    }
    var hasBody = opts.body !== undefined && opts.body !== null;
    var isFormData = typeof global.FormData !== 'undefined' && opts.body instanceof FormData;
    if (hasBody && !isFormData) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json; charset=utf-8';
    }

    var init = {
      method: method,
      headers: headers,
      credentials: (CFG.BASE === '' || CFG.BASE === undefined) ? 'same-origin' : 'include',
      signal: ctrl.signal
    };
    if (hasBody) {
      init.body = isFormData ? opts.body : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    }

    try {
      var res = await global.fetch(fullUrl, init);
      clearTimeout(timer);
      _networkHealthy = true;

      // 2xx 但非 204：解析 JSON
      var data;
      if (res.status !== 204) {
        try { data = await res.json(); } catch (_parseErr) { data = null; }
      }

      if (res.ok && (data === null || data === undefined || data.ok === true || data.ok === undefined)) {
        return data && data.data !== undefined ? data.data : data;
      }

      // 401 → refresh 重试一次（非 login 接口自身）
      // 【Fix-20260929 M4】仅对幂等/准幂等方法自动重试；POST 等创建类请求不重试，
      // 避免 token 恰好在提交瞬间过期时刷新后重放，造成重复建单/重复创建排期
      if (res.status === 401 && !/\/auth\/login$/.test(path) && !opts.__refreshed__ &&
          ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE'].indexOf(String(method).toUpperCase()) >= 0) {
        var ok = await _doRefresh();
        if (ok) {
          return request(method, path, Object.assign({}, opts, { __refreshed__: true }));
        }
      }

      // 后端明确的业务错误
      var msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
      if (showError) _toast(msg, 'error');
      var err = new Error(msg);
      err.status = res.status;
      err.code = (data && data.error && data.error.code) || 'HTTP_' + res.status;
      err.detail = data && data.error && data.error.detail;
      err.response = res;
      err.data = data;
      throw err;
    } catch (err) {
      clearTimeout(timer);
      var isNetErr = !err.status || err.name === 'AbortError' || /Failed to fetch|NetworkError|TypeError.*fetch/i.test(err.message || '');
      if (isNetErr) {
        _networkHealthy = false;
        // 读请求自动走 localStorage 降级（兼容后端未启动）
        if (method === 'GET' && typeof opts.fallbackRead === 'function') {
          _toast('后端未连通，已启用本地离线模式（数据仅本地可用）', 'warn');
          CFG.setFallbackMode(true);
          try { return await opts.fallbackRead({ reason: 'network_fail', err: err }); }
          catch (e2) { throw e2; }
        }
        // 写请求：仅当显式提供 fallback 时才降级（写本地）
        if (typeof opts.fallback === 'function') {
          try { return await opts.fallback({ reason: 'network_fail', err: err }); }
          catch (e2) { throw e2; }
        }
      }
      throw err;
    }
  }

  async function _doRefresh() {
    if (_refreshPromise) return _refreshPromise;
    var rt = CFG.getRefreshToken && CFG.getRefreshToken();
    if (!rt) {
      _kickToLogin(true);
      return false;
    }
    _refreshPromise = (async function () {
      try {
        var res = await global.fetch(RESOLVE_URL(CFG.PATHS && CFG.PATHS.AUTH_REFRESH || '/v1/auth/refresh'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt })
        });
        if (!res.ok) throw new Error('refresh ' + res.status);
        var data = await res.json();
        if (data && data.ok && data.data && data.data.accessToken) {
          CFG.setAccessToken(data.data.accessToken);
          return true;
        }
        throw new Error('refresh invalid');
      } catch (_e) {
        CFG.clearAuth && CFG.clearAuth();
        _kickToLogin(false);
        return false;
      } finally {
        _refreshPromise = null;
      }
    })();
    return _refreshPromise;
  }

  function _kickToLogin(needLogin) {
    CFG.clearAuth && CFG.clearAuth();
    if (typeof global.window === 'undefined') return;
    if (needLogin !== false) _toast('系统安全升级已完成，您的登录状态已失效，即将跳转到登录页重新登录', 'error');
    var cur = global.location.pathname;
    var isAdmin = /\/admin\//.test(cur) || /admin[\/]?login\.html$/i.test(cur);
    var target = isAdmin ? 'login.html' : (global.location.origin + '/admin/login.html');
    if (!/login\.html/i.test(cur)) setTimeout(function () { global.location.href = target; }, 3000);
  }

  var API = {
    request: request,
    get: function (p, opts) { return request('GET', p, opts); },
    post: function (p, body, opts) { return request('POST', p, Object.assign({}, opts || {}, { body: body })); },
    put: function (p, body, opts) { return request('PUT', p, Object.assign({}, opts || {}, { body: body })); },
    patch: function (p, body, opts) { return request('PATCH', p, Object.assign({}, opts || {}, { body: body })); },
    del: function (p, opts) { return request('DELETE', p, opts); },

    // 图形验证码：captcha 为用户输入，captchaId 为 GET /v1/auth/captcha 下发的 challenge id
    // （开关关闭时后端忽略二者；开关开启时二者必传且一次性消费）
    getCaptcha: function () {
      return request('GET', (CFG.PATHS && CFG.PATHS.AUTH_CAPTCHA) || '/v1/auth/captcha', {
        skipAuth: true,
        showErrorToast: false
      });
    },
    login: async function (username, password, captcha, captchaId) {
      var r = await request('POST', (CFG.PATHS && CFG.PATHS.AUTH_LOGIN) || '/v1/auth/login', {
        body: { username: username, password: password, captcha: captcha || '', captchaId: captchaId || '' },
        skipAuth: true,
        showErrorToast: true
      });
      if (r && r.accessToken) {
        CFG.setAccessToken(r.accessToken);
        CFG.setRefreshToken(r.refreshToken);
        CFG.setCurrentUser(r.user);
        if (r.user && r.user.forcePwdChange) {
          setTimeout(function () {
            _toast('首次登录，请立即修改密码', 'warn');
          }, 300);
        }
      }
      return r;
    },
    logout: async function () {
      try { await request('POST', (CFG.PATHS && CFG.PATHS.AUTH_LOGOUT) || '/v1/auth/logout', { showErrorToast: false }); } catch (_e) {}
      CFG.clearAuth();
      _kickToLogin(false);
    },
    me: function () { return request('GET', (CFG.PATHS && CFG.PATHS.AUTH_ME) || '/v1/auth/me'); },
    changeMyPwd: function (oldPwd, newPwd) {
      return request('PATCH', CFG.PATHS.ACCOUNT_ME_PWD || '/v1/accounts/me/password', {
        body: { oldPassword: oldPwd, newPassword: newPwd }
      });
    },
    isNetworkHealthy: function () { return _networkHealthy; }
  };

  // backward compat：若页面已有全局 QAXQJT_API 则扩展，否则赋值
  global.QAXQJT_API = Object.assign(global.QAXQJT_API || {}, API);
})(typeof window !== 'undefined' ? window : this);

/* ===== [6/11] js/real-performers.js (4647 bytes) ===== */
/*!
 * real-performers.js · 20260922
 * 真实演职人员统一加载层（admin 派工/排期/阵容页共用）
 * 数据源：GET /v1/performers（在册真实人员）；本地缓存 qaxqjt_performers_v1
 * 不内置任何假名单：无数据/未登录时所有分组为空。
 */
(function () {
  'use strict';
  if (window.QinRealPerformers) return;

  // 行当口径（20261003 修订）：6 大行 23 角色 + 武场/文场，与 cast-sheet.html _bucketOf 完全一致
  var ROLE_RULES = [
    ['武场', /武场|司鼓|板鼓|梆子|大锣|小锣|马锣|铙|钹|镲|堂鼓|战鼓|木鱼|打击|鼓师|武二手|鼓/],
    ['文场', /文场|板胡|二胡|高胡|椰胡|扬琴|琵琶|三弦|古筝|竹笛|梅管|唢呐|海笛|笙|大提琴|贝司|提琴|电子琴|文二手|琴/],
    ['帽箱', /帽箱|盔箱|盔头|盔|戏帽|帽倌|王帽|纱帽|扎巾|额子|凤冠|驸马套/],
    ['衣箱', /衣箱|箱倌|行头|服装|跟包|化妆|大头|勾脸|脸谱|道具/],
    ['电工', /电工|灯光|音响|话筒|耳麦|麦|配电|设备/],
    ['剧务', /剧务|舞台监督|监督|催场|场记|字幕|装台|布景|拆台/],
    ['前场', /前场|前台|检票|引导|后勤/],
    ['大花脸', /大花脸|大净|铜锤|包公|包拯|徐延昭|尉迟恭/],
    ['二花脸', /二花脸|架子花|武花|副净|武净|花脸|净|张飞|李逵|曹操/],
    ['丑角', /丑/],
    ['武须生', /武须生|靠把|红生|武老生|武生|关羽|关公|赵匡胤/],
    ['文须生', /须生|老生|安工|衰派/],
    ['小生', /小生/],
    ['正旦', /正旦|青衣|老旦/],
    ['小旦', /小旦|花旦|闺门旦|武旦|刀马旦/],
    ['彩旦', /彩旦|丑婆|丑旦/],
    ['二架旦', /二架旦|二路旦|二架女/],
    ['门官', /门官|二架男/],
    ['家院', /家院|老管家|老仆/],
    ['校尉', /校尉/],
    ['刀斧手', /刀斧手|刽子手/],
    ['丫鬟', /丫鬟|丫环|使女/],
    ['彩女', /彩女|宫娥/],
    ['长随官', /长随官|长随/],
    ['龙套', /龙套|青袍|文堂|流行/]
  ];
  // 25 分类（23 角色 + 武场 + 文场）
  function stdRole(role) {
    var s = String(role || '');
    for (var i = 0; i < ROLE_RULES.length; i++) { if (ROLE_RULES[i][1].test(s)) return ROLE_RULES[i][0]; }
    return '前场';
  }
  var GROUP_OF = {
    '文须生':'sheng', '武须生':'sheng', '小生':'sheng',
    '丑角':'chou',
    '大花脸':'jing', '二花脸':'jing',
    '正旦':'dan', '小旦':'dan', '彩旦':'dan', '二架旦':'dan',
    '门官':'erjia', '家院':'erjia',
    '龙套':'juezi', '校尉':'juezi', '刀斧手':'juezi', '丫鬟':'juezi', '彩女':'juezi', '长随官':'juezi',
    '帽箱':'houqin', '电工':'houqin', '前场':'houqin', '衣箱':'houqin', '剧务':'houqin',
    '武场':'wuchang', '文场':'wenchang'
  };
  var KEYS = ['sheng','chou','jing','dan','erjia','juezi','wuchang','wenchang','houqin'];
  function emptyGroups() {
    var g = {};
    KEYS.forEach(function (k) { g[k] = []; });
    return g;
  }

  var groups = emptyGroups();

  function bucket(role) {
    return GROUP_OF[stdRole(role)] || 'houqin';
  }

  function assign(items) {
    groups = emptyGroups();
    var seen = {};
    items.forEach(function (p) {
      var name = p.name || p.performerName || '';
      if (!name || seen[name]) return;
      seen[name] = 1;
      var role = p.primaryRole || p.roleCategory || p.role || '';
      var std = stdRole(role);
      groups[bucket(role)].push({ name: name, role: role, stdRole: std });
    });
    return groups;
  }

  // 先读缓存（cast-sheet 等页面也写同一缓存，schema 兼容）
  try {
    var raw = localStorage.getItem('qaxqjt_performers_v1');
    if (raw) {
      var cached = JSON.parse(raw);
      if (cached && cached._version === 2 && Array.isArray(cached.flat)) {
        assign(cached.flat.map(function (x) { return { name: x.name, primaryRole: x.skill }; }));
      }
    }
  } catch (e) {}

  var ready = Promise.resolve();
  if (window.QAXQJT_API && QAXQJT_API.get) {
    ready = QAXQJT_API.get('/v1/performers', { query: { pageSize: 500 } }).then(function (d) {
      var items = Array.isArray(d) ? d : ((d && d.items) || []);
      assign(items);
      try {
        // 同步写 cast-sheet 兼容缓存（25 分类：23 角色 + 武场/文场）
        writeCompatibleCache(items);
      } catch (e) {}
    }).catch(function () { /* 保持空态，绝不造假数据 */ });
  }

  // cast-sheet.html 兼容：25 分类（与该页 _bucketOf 完全一致，兜底"前场"）
  function canonicalBucket(role) {
    return stdRole(role);
  }
  function writeCompatibleCache(items) {
    var performersGroups = {};
    var flat = items.map(function (p) {
      var name = p.name || p.performerName || '';
      var role = p.primaryRole || p.roleCategory || p.role || '';
      var cat = canonicalBucket(role);
      if (!performersGroups[cat]) performersGroups[cat] = [];
      performersGroups[cat].push({ name: name, skill: role, note: '' });
      return { id: p.id || '', name: name, skill: role, note: '', category: cat };
    });
    localStorage.setItem('qaxqjt_performers_v1', JSON.stringify({ _seededAt: new Date().toISOString(), _version: 2, performers: performersGroups, flat: flat }));
  }
  window.QinRealPerformers = {
    ready: ready,
    stdRole: stdRole,
    groupKey: bucket,
    get groups() { return groups; }
  };
})();

/* ===== [7/11] js/admin-schedule-real.js (22187 bytes) ===== */
/* ============================================================
 * admin-schedule-real.js  v20260922
 * 排期管理页真实数据接线：
 *  - 月历 / 周视图 / 列表卡片 / 档期表 全部来自 GET /v1/schedules
 *  - 同步写入 qaxqjt_schedules_v2（覆盖旧演示种子）
 *  - 冲突预警 / 月度提示 / 素材上传关联下拉 均真实生成
 * ============================================================ */
(function () {
  'use strict';
  if (window.__schedReal) return;
  window.__schedReal = true;

  /* 页面内原有内联脚本渲染月历前，清掉历史演示种子，避免假数据闪现 */
  try { localStorage.removeItem('qaxqjt_schedules_v2'); } catch (_) {}

  var API = window.QAXQJT_API;
  var ROWS = [];                 // 真实排期（已规范化）
  var weekOffset = 0;
  var calWrap = null;            // 包装后的 __renderCalendar
  var inited = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function unwrap(resp) {
    return Array.isArray(resp) ? resp : (resp && (resp.items || resp.list || resp.rows)) || [];
  }
  function norm(s) {
    s = s || {};
    var d = String(s.scheduleDateStart || s.date || '').slice(0, 10);
    return {
      id: s.id || s.scheduleNo || '',
      no: s.scheduleNo || s.id || '',
      date: d,
      title: s.playTitle || s.title || s.plays || '未命名演出',
      venue: s.venueAddress || s.venueDistrict || s.venue || (s.venueCity ? (s.venueCity + (s.venueDistrict || '')) : '') || '',
      type: s.type || s.orderType || '',
      status: s.status || 'draft',
      time: s.time || '',
      remark: s.remark || ''
    };
  }
  function typeClass(t) {
    t = String(t || '');
    if (t.indexOf('庙会') >= 0) return 'type-miaohui';
    if (t.indexOf('惠民') >= 0) return 'type-huimin';
    if (t.indexOf('节庆') >= 0 || t.indexOf('文旅') >= 0) return 'type-jieqing';
    if (t.indexOf('商演') >= 0 || t.indexOf('企业') >= 0) return 'type-shangyan';
    return '';
  }
  function statusBadge(st) {
    var map = {
      draft: { cls: 'badge-warning', text: '⏳ 待确认' },
      scheduled: { cls: 'badge-warning', text: '⏳ 待确认' },
      confirmed: { cls: 'badge-success', text: '✓ 已确认' },
      completed: { cls: 'badge-success', text: '✓ 已完成' },
      performance: { cls: 'badge-success', text: '🎬 已演出' },
      cancelled: { cls: 'badge-danger', text: '✕ 已取消' },
      canceled: { cls: 'badge-danger', text: '✕ 已取消' }
    };
    return map[st] || { cls: 'badge-info', text: esc(st || '—') };
  }
  function selectedYM() {
    var sels = document.querySelectorAll('.admin-filter-bar select');
    var y = sels[0] ? (parseInt(sels[0].value, 10) || new Date().getFullYear()) : new Date().getFullYear();
    var m = sels[1] ? (parseInt(sels[1].value, 10) || (new Date().getMonth() + 1)) : (new Date().getMonth() + 1);
    return { y: y, m: m };
  }

  /* ---------- OBS-1 修复：筛选器默认当前年月、日期框默认今天、清理 {year} 占位文案 ---------- */
  function pad2(n) { return String(n).padStart ? String(n).padStart(2, '0') : (n < 10 ? '0' + n : '' + n); }
  function syncFilterToToday() {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth() + 1;
    var sels = document.querySelectorAll('.admin-filter-bar select');
    if (sels[0]) {
      var yv = String(sels[0].value);
      var hasYear = false;
      Array.prototype.forEach.call(sels[0].options, function (o) { if (o.value === String(y)) hasYear = true; });
      if (!hasYear) {
        var op = document.createElement('option');
        op.value = String(y);
        op.textContent = y + '年';
        sels[0].insertBefore(op, sels[0].firstChild);
      }
      sels[0].value = String(y);
    }
    if (sels[1]) sels[1].value = String(m);
    // 新增排期弹窗日期默认今天（仅当为空或非法值，如历史 {year}-07-20 占位符）
    var dEl = document.getElementById('schedDate');
    if (dEl) {
      var v = (dEl.value || '').trim();
      var d = v ? new Date(v + 'T00:00:00') : null;
      if (!v || !d || isNaN(d.getTime())) dEl.value = y + '-' + pad2(m) + '-' + pad2(now.getDate());
    }
    return { y: y, m: m };
  }
  function initDefaults() {
    var ym = syncFilterToToday();
    // 清理静态标题里的 {year}/7月 占位文案（真实渲染不再覆盖这些节点）
    [
      ['calendarTitleText', ym.y + '年 ' + ym.m + '月 演出排期日历'],
      ['weekTitleText', ym.y + '年 ' + ym.m + '月 本周排期一览'],
      ['listTitleText', ym.y + '年 ' + ym.m + '月 全量排期清单（按日期升序）']
    ].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (el && (el.textContent || '').indexOf('{year}') >= 0) el.textContent = pair[1];
    });
  }

  /* ---------- 数据拉取：按月拉取（替代 pageSize:500 全量拉取） ---------- */
  function refresh() {
    if (!API || typeof API.get !== 'function') return Promise.resolve([]);
    var ym = selectedYM();
    // 重构：只拉当前选中月份的数据，大幅减少传输量
    return API.get('/v1/schedules', { query: { year: ym.y, month: ym.m, page: 1, pageSize: 200 } })
      .then(function (resp) {
        ROWS = unwrap(resp).map(norm).filter(function (r) { return !!r.date; });
        try {
          localStorage.setItem('qaxqjt_schedules_v2', JSON.stringify(ROWS.map(function (r) {
            return { id: r.id, date: r.date, title: r.title, plays: r.title, venue: r.venue, type: r.type, status: r.status };
          })));
        } catch (_) {}
        renderAll();
        return ROWS;
      })
      .catch(function (e) {
        try { console.warn('[schedReal] 拉取真实排期失败', e); } catch (_) {}
        var box = document.getElementById('listCardsReal');
        if (box) box.innerHTML = '<div style="padding:30px 12px;text-align:center;color:#b91c1c;">真实排期加载失败（未登录或网络异常）</div>';
      });
  }

  /* ---------- 月度提示 + 冲突预警（冲突改走后端 /schedules/conflicts） ---------- */
  function renderAlerts(y, m) {
    var prefix = y + '-' + pad(m);
    var monthRows = ROWS.filter(function (r) { return r.date.slice(0, 7) === prefix; });
    var info = document.getElementById('schedInfoAlert');
    var infoBox = document.getElementById('schedInfoContent');
    if (info && infoBox) {
      if (monthRows.length) {
        info.style.display = '';
        infoBox.innerHTML = '<strong>排期提示：</strong>' + y + '年' + m + '月已排 <strong>' + monthRows.length +
          '</strong> 场真实演出。请合理安排演职人员轮休，避免高强度连台演出。';
      } else {
        info.style.display = 'none';
      }
    }
    // 冲突检测：调用后端接口，前端不再全量扫描
    var dateFrom = y + '-' + pad(m) + '-01';
    var lastDay = new Date(y, m, 0).getDate();
    var dateTo = y + '-' + pad(m) + '-' + pad(lastDay);
    if (API && typeof API.get === 'function') {
      API.get('/v1/schedules/conflicts', { query: { dateFrom: dateFrom, dateTo: dateTo } })
        .then(function (resp) {
          var data = resp && resp.data ? resp.data : resp;
          var conflicts = (data && data.conflicts) || [];
          var exist = document.getElementById('schedConflictAlert');
          if (exist) exist.parentNode.removeChild(exist);
          if (conflicts.length && info && info.parentNode) {
            var div = document.createElement('div');
            div.className = 'schedule-alert danger';
            div.id = 'schedConflictAlert';
            var names = conflicts.slice(0, 5).map(function (c) {
              return c.date + '（' + c.items.map(function (it) { return it.playTitle; }).join(' / ') + '）';
            }).join('；');
            div.innerHTML =
              '<div class="alert-icon">⚠️</div>' +
              '<div class="alert-content"><strong>档期冲突预警：</strong>检测到 ' + conflicts.length +
              ' 个日期存在多场连台排期 —— ' + esc(names) + '，请注意演职人员是否重叠。</div>' +
              '<div class="alert-actions"><button class="btn btn-sm" style="background:#b91c1c;color:#fff;" type="button" id="schedConflictBtn">🚨 查看清单</button></div>';
            info.parentNode.insertBefore(div, info);
            var btn = document.getElementById('schedConflictBtn');
            if (btn) btn.addEventListener('click', function () { try { window.__switchView && window.__switchView('list'); } catch (_) {} });
          }
        })
        .catch(function () { /* 接口不可用时静默降级，不影响页面 */ });
    }
  }

  /* ---------- 周视图真实渲染 ---------- */
  function renderWeekGrid(offset) {
    weekOffset = offset || 0;
    var grid = document.getElementById('weekGridReal');
    if (!grid) return;
    var today = new Date();
    var base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var dow = base.getDay(); if (dow === 0) dow = 7;
    var monday = new Date(base); monday.setDate(base.getDate() - dow + 1 + weekOffset * 7);
    var cells = '';
    var hasAny = false;
    for (var i = 0; i < 7; i++) {
      var dt = new Date(monday); dt.setDate(monday.getDate() + i);
      var ds = dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
      var evts = ROWS.filter(function (r) { return r.date === ds; });
      var conflict = evts.length >= 2;
      var isToday = dt.getFullYear() === today.getFullYear() && dt.getMonth() === today.getMonth() && dt.getDate() === today.getDate();
      if (evts.length) hasAny = true;
      var inner = '<div style="font-size:0.78rem;font-weight:700;margin-bottom:8px;color:' + (isToday ? '#7c3aed' : 'var(--primary-dark)') + ';">' +
        (dt.getMonth() + 1) + '/' + dt.getDate() + (isToday ? ' ⭐' : '') + (conflict ? ' ⚠️' : '') + '</div>';
      evts.slice(0, 4).forEach(function (r) {
        inner += '<div class="mini-event ' + typeClass(r.type) + (conflict ? ' conflict' : '') + '" style="font-size:0.7rem;margin-bottom:4px;" title="' +
          esc(r.title + ' · ' + r.venue) + '">' + esc(r.title) + '</div>';
      });
      if (evts.length > 4) inner += '<div style="font-size:0.68rem;opacity:.7;">+' + (evts.length - 4) + '</div>';
      cells += '<div style="padding:10px;border:1px solid ' + (conflict ? '#fca5a5' : 'var(--border-light,#e5e7eb)') +
        ';border-radius:10px;background:' + (conflict ? 'rgba(220,53,69,0.03)' : '#fff') + ';">' + inner + '</div>';
    }
    grid.innerHTML = cells;
    if (!hasAny && !ROWS.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;padding:40px 12px;text-align:center;color:var(--text-light,#888);">本周暂无真实排期</div>';
    }
  }

  /* ---------- 列表卡片真实渲染 ---------- */
  function renderListCards() {
    var box = document.getElementById('listCardsReal');
    if (!box) return;
    var ym = selectedYM();
    var sels = document.querySelectorAll('.admin-filter-bar select');
    var typeKw = sels[2] ? (sels[2].value || '') : '';
    var statusKw = sels[3] ? (sels[3].value || '') : '';
    // 【Fix-20260929 M1】下拉值与后端真实状态枚举对齐：
    //   pending（待确认）=> draft + scheduled；其余按同组状态匹配。
    var STATUS_GROUPS = {
      pending: ['draft', 'scheduled'],
      confirmed: ['confirmed'],
      cancelled: ['cancelled', 'canceled']
    };
    // 【Fix-20260929 M1】"档期冲突"不是存储状态，而是"同日 ≥2 场未取消排期"的派生结果
    var conflictDates = {};
    if (statusKw === 'conflict') {
      ROWS.forEach(function (r) {
        if (r.status === 'cancelled' || r.status === 'canceled') return;
        conflictDates[r.date] = (conflictDates[r.date] || 0) + 1;
      });
    }
    var rows = ROWS.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).filter(function (r) {
      if (r.date.slice(0, 4) !== String(ym.y)) return false;
      if (ym.m && r.date.slice(5, 7) !== pad(ym.m)) return false;
      // 【Fix-20260929 M2】类型下拉值(miaohui/huimin/jieqing/shangyan) 经 typeClass
      //   与真实中文存储（如"庙会 / 节庆专场"或空串）做语义匹配，替代 indexOf 原值比较
      if (typeKw) {
        var typeKey = typeClass(r.type).replace('type-', '');
        if (typeKey !== typeKw) return false;
      }
      if (statusKw) {
        if (statusKw === 'conflict') {
          if (!(conflictDates[r.date] >= 2)) return false;
        } else {
          var group = STATUS_GROUPS[statusKw] || [statusKw];
          if (group.indexOf(r.status) < 0) return false;
        }
      }
      return true;
    });
    var colorMap = {
      miaohui: '#8B0000', huimin: '#28a745', jieqing: '#D4AF37', shangyan: '#17a2b8', other: '#6b7280'
    };
    if (!rows.length) {
      box.innerHTML = '<div style="padding:30px 12px;text-align:center;color:var(--text-light,#888);">📭 当前筛选条件下暂无真实排期</div>';
      try { applyCardSearch(); } catch (_) {}
      return;
    }
    box.innerHTML = rows.map(function (r) {
      var tc = typeClass(r.type);
      var key = tc.replace('type-', '') || 'other';
      var color = colorMap[key] || colorMap.other;
      var md = r.date.slice(5).replace('-', '-');
      var b = statusBadge(r.status);
      var typeText = r.type ? '<span class="badge ' + b.cls + '">' + esc(r.type) + '</span>' : '';
      var venueText = r.venue ? '<span style="color:var(--text-light,#888);font-size:0.82rem;">' + esc(r.venue) + '</span>' : '';
      return '<div style="padding:14px 16px;border-left:4px solid ' + color +
        ';border-radius:8px;background:linear-gradient(90deg,' + color + '0A,#fff);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
          '<span style="display:inline-block;padding:4px 10px;background:' + color + ';color:#fff;border-radius:6px;font-size:0.8rem;font-weight:600;">' + md + '</span>' +
          typeText +
          '<strong style="font-size:0.95rem;">' + esc(r.title) + '</strong>' +
          venueText +
          (r.no ? '<span style="color:#aaa;font-size:0.75rem;">' + esc(r.no) + '</span>' : '') +
        '</div>' +
        '<div style="display:flex;gap:6px;align-items:center;"><span class="badge ' + b.cls + '">' + b.text + '</span></div>' +
      '</div>';
    }).join('');
    // 【Fix-20260929 L5】卡片重渲染后重放顶部搜索关键字
    try { applyCardSearch(); } catch (_) {}
  }

  /* ---------- 【Fix-20260929 L5】顶部搜索：过滤列表视图卡片（表格行由 pagination.js 过滤） ---------- */
  function applyCardSearch() {
    var box = document.getElementById('listCardsReal');
    if (!box) return;
    var kw = String(window.__schedSearchKw || '').trim().toLowerCase();
    var visible = 0;
    Array.prototype.forEach.call(box.children, function (card) {
      if (card.id === 'listCardsSearchEmpty') { card.style.display = 'none'; return; }
      var hit = !kw || (card.textContent || '').toLowerCase().indexOf(kw) >= 0;
      card.style.display = hit ? '' : 'none';
      if (hit) visible++;
    });
    var note = document.getElementById('listCardsSearchEmpty');
    if (kw && visible === 0) {
      if (!note) {
        note = document.createElement('div');
        note.id = 'listCardsSearchEmpty';
        note.style.cssText = 'padding:30px 12px;text-align:center;color:var(--text-light,#888);';
        box.appendChild(note);
      }
      note.textContent = '🔍 没有找到包含「' + kw + '」的档期 / 地点 / 剧目';
      note.style.display = '';
    } else if (note) {
      note.style.display = 'none';
    }
  }
  window.__schedApplyCardSearch = applyCardSearch;

  function bindHeaderSearch() {
    var input = document.querySelector('.admin-search input[type="text"]');
    if (!input || input.__schedSearchBound) return;
    input.__schedSearchBound = true;
    input.setAttribute('aria-label', '搜索档期、地点、剧目');
    var t = null;
    input.addEventListener('input', function () {
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        window.__schedSearchKw = input.value || '';
        try { applyCardSearch(); } catch (_) {}
      }, 200);
    });
    // 【Fix-20260930】铃铛/消息已由 js/admin-notifications.js 提供真实待办面板
    // （capture + stopImmediatePropagation 拦截），此处不再绑定占位提示 toast
  }

  /* ---------- 素材上传下拉 ---------- */
  function renderUploadSelect() {
    var sel = document.getElementById('schedUploadSelect');
    if (!sel) return;
    var html = '<option value="">请选择要补充素材的排期</option>';
    ROWS.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 100).forEach(function (r) {
      html += '<option value="' + esc(r.id) + '">' + esc(r.no || r.id) + ' · 《' + esc(r.title) + '》' + (r.venue ? ' ' + esc(r.venue) : '') + '（' + r.date + '）</option>';
    });
    sel.innerHTML = html;
  }

  function renderAll() {
    var ym = selectedYM();
    renderAlerts(ym.y, ym.m);
    renderWeekGrid(weekOffset);
    renderListCards();
    renderUploadSelect();
    try { if (window.__renderCalendar) window.__renderCalendar(ym.y, ym.m); } catch (_) {}
  }

  /* ---------- 安装视图/导航钩子 ---------- */
  function installHooks() {
    // 包装月历渲染：任意触发（导航/查询/重置）后同步提示条
    if (window.__renderCalendar && !window.__renderCalendar.__schedRealWrapped) {
      var orig = window.__renderCalendar;
      calWrap = function (y, m) {
        var r = orig.apply(this, arguments);
        try { renderAlerts(parseInt(y, 10), parseInt(m, 10)); } catch (_) {}
        return r;
      };
      calWrap.__schedRealWrapped = true;
      window.__renderCalendar = calWrap;
    }
    // 周导航
    [['weekNavPrev', -1], ['weekNavNext', 1], ['weekNavToday', 0]].forEach(function (pair) {
      var btn = document.getElementById(pair[0]);
      if (btn && !btn.__schedRealBound) {
        btn.__schedRealBound = true;
        btn.addEventListener('click', function () {
          weekOffset += pair[1];
          setTimeout(function () { renderWeekGrid(pair[1] === 0 ? 0 : weekOffset); }, 60);
        });
      }
    });
    // 视图切换：切到周/列表时重渲染
    document.querySelectorAll('.view-toggle button').forEach(function (btn) {
      if (btn.__schedRealBound) return;
      btn.__schedRealBound = true;
      btn.addEventListener('click', function () {
        var v = btn.getAttribute('data-view') || 'month';
        setTimeout(function () {
          if (v === 'week') renderWeekGrid(weekOffset);
          else if (v === 'list') renderListCards();
        }, 60);
      });
    });
    // 查询栏按钮：查询=按所选年月重新拉数；今日=筛选器回到今天并重拉；重置=清空类型/状态+回到今天
    document.querySelectorAll('.admin-filter-bar .btn, .admin-filter-bar button').forEach(function (b) {
      if (b.__schedRealBound2) return;
      var txt = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt.indexOf('查询') >= 0 || txt.indexOf('重置') >= 0 || txt.indexOf('今日') >= 0) {
        b.__schedRealBound2 = true;
        b.addEventListener('click', function () {
          if (txt.indexOf('今日') >= 0) {
            syncFilterToToday();
            weekOffset = 0;
          } else if (txt.indexOf('重置') >= 0) {
            var rs = document.querySelectorAll('.admin-filter-bar select');
            if (rs[2]) rs[2].value = '';
            if (rs[3]) rs[3].value = '';
            syncFilterToToday();
          }
          // 查询/重置/今日均需按当前筛选年月重新拉取（原先只本地过滤，切换月份后看不到新月数据）
          setTimeout(function () {
            refresh().then(function () {
              var ym = selectedYM();
              renderAlerts(ym.y, ym.m);
              renderWeekGrid(0);
            });
          }, 60);
        }, true);
      }
    });
    // 年/月下拉直接 change 即重新拉数，无需再点查询
    var ymSels = document.querySelectorAll('.admin-filter-bar select');
    [ymSels[0], ymSels[1]].forEach(function (sel) {
      if (!sel || sel.__schedYmBound) return;
      sel.__schedYmBound = true;
      sel.addEventListener('change', function () {
        refresh().then(function () {
          var ym = selectedYM();
          renderAlerts(ym.y, ym.m);
          weekOffset = 0;
          renderWeekGrid(0);
        });
      });
    });
    // 月历导航“今天”按钮：真实回到今天（拦截内联脚本的 {year}年7月15日 假 toast）
    var calToday = document.getElementById('calNavToday');
    if (calToday && !calToday.__schedTodayBound) {
      calToday.__schedTodayBound = true;
      calToday.addEventListener('click', function (ev) {
        ev.stopPropagation();
        syncFilterToToday();
        weekOffset = 0;
        refresh().then(function () {
          var ym = selectedYM();
          renderAlerts(ym.y, ym.m);
          renderWeekGrid(0);
        });
      }, true);
    }
  }

  function boot() {
    installHooks();
    bindHeaderSearch();
    initDefaults();
    refresh();
    // 内联脚本可能在稍后才挂载 __renderCalendar，再补一次包装
    setTimeout(installHooks, 300);
    setTimeout(installHooks, 1200);
    setTimeout(bindHeaderSearch, 300);
  }
  // 【Fix-20260929 L4】对外暴露真实重载入口（新增/删除/改状态后由内联脚本调用，
  // 替代手工往表格插"临时假行"）；refresh 内部会 renderAll 同步月历/周视图/列表卡片/预警
  window.__schedRealReload = function () { return refresh(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/* ===== [8/11] js/admin-notifications.js (15528 bytes) ===== */
/* ==========================================================================
 * js/admin-notifications.js —— 后台头部「🔔 通知 / ✉️ 消息」真实面板（v20260928a）
 * ----------------------------------------------------------------------------
 * 🔔 通知：聚合真实业务待办（无权限/失败的来源自动隐藏，不报错）
 *   1. 待审核预约申请  GET /v1/appointments/stats          → orders.html
 *   2. 待审核演职人员  GET /v1/performers?status=pending   → staff.html
 *   3. 待确认档期      GET /v1/schedules                   → schedule.html
 *   4. 库存预警        GET /v1/inventory/items             → inventory.html
 *   5. 未收欠款订单    GET /v1/orders                      → orders.html
 * ✉️ 消息：已发布官网公告 GET /v1/contents/public?type=notice → 前台新闻页
 * 设计：按钮 capture 阶段接管 + 全套防劫持标记；面板内全部为真实 href 链接。
 * ========================================================================== */
(function (global) {
  'use strict';
  if (global.__QAXNotif) return;
  global.__QAXNotif = { version: '20260928b' };

  var CACHE_TTL = 60 * 1000; // 60 秒内存缓存
  var cache = { todo: { t: 0, items: null, count: 0 }, msg: { t: 0, items: null } };
  var openPanel = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function markBtn(b) {
    b.__superPatchBound = 1; b.__ts3Done = 1; b.__bindDone = 1; b.__ctE2Done = 1; b.__deadBtnChecked = 1;
    return b;
  }

  function rowsOf(d) {
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.items)) return d.items;
    if (d && Array.isArray(d.rows)) return d.rows;
    if (d && Array.isArray(d.data)) return d.data;
    return [];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtMoney(n) { return '¥' + (Math.round(Number(n || 0) * 100) / 100).toLocaleString('zh-CN'); }
  function ymd(d) { return d ? String(d).slice(0, 10) : ''; }
  function ago(d) {
    var t = d ? new Date(d).getTime() : NaN;
    if (isNaN(t)) return '';
    var h = Math.max(0, Math.round((Date.now() - t) / 3600000));
    if (h < 1) return '刚刚';
    if (h < 24) return h + '小时前';
    return Math.round(h / 24) + '天前';
  }

  function apiGet(path, query) {
    var A = global.QAXQJT_API;
    if (!A) return Promise.reject(new Error('no-api'));
    return A.get(path, { query: query || {}, showErrorToast: false, timeoutMs: 12000 });
  }

  /* ---------------- 🔔 业务待办聚合 ---------------- */
  function loadTodos(force) {
    if (!force && cache.todo.items && (Date.now() - cache.todo.t) < CACHE_TTL) {
      return Promise.resolve(cache.todo);
    }
    var tasks = [
      // 1. 待审核预约（stats 含 pendingCount）
      apiGet('/v1/appointments/stats').then(function (s) {
        var n = Number(s && (s.pendingCount != null ? s.pendingCount : (s.byStatus && s.byStatus.pending))) || 0;
        return n > 0 ? {
          icon: '📋', level: 'warn', href: 'orders.html',
          title: '待审核预约申请', desc: n + ' 条客户预约等待审核处理'
        } : null;
      }).catch(function () { return null; }),

      // 2. 待审核演职人员（自助登记 status=pending）
      apiGet('/v1/performers', { status: 'pending', page: 1, pageSize: 200 }).then(function (d) {
        var n = rowsOf(d).length;
        return n > 0 ? {
          icon: '👨‍🎤', level: 'warn', href: 'staff.html',
          title: '待审核演职人员', desc: n + ' 名人员自助登记，等待审核入库'
        } : null;
      }).catch(function () { return null; }),

      // 3. 待确认档期
      apiGet('/v1/schedules', { page: 1, pageSize: 500 }).then(function (d) {
        var n = rowsOf(d).filter(function (s) { return s.status === 'scheduled'; }).length;
        return n > 0 ? {
          icon: '📅', level: 'warn', href: 'schedule.html',
          title: '待确认演出档期', desc: n + ' 个排期状态为「待确认」'
        } : null;
      }).catch(function () { return null; }),

      // 4. 库存预警
      apiGet('/v1/inventory/items', { page: 1, pageSize: 500 }).then(function (d) {
        var low = rowsOf(d).filter(function (it) {
          var q = Number(it.quantity), safe = Number(it.safetyStock || 0);
          return !isNaN(q) && safe > 0 && q <= safe;
        });
        var names = low.slice(0, 2).map(function (x) { return x.name; }).join('、');
        return low.length > 0 ? {
          icon: '⚠️', level: 'danger', href: 'inventory.html',
          title: '库存预警 ' + low.length + ' 项',
          desc: names + (low.length > 2 ? ' 等' : '') + ' 已达安全库存线'
        } : null;
      }).catch(function () { return null; }),

      // 5. 未收欠款（非取消订单 finalAmount - paidAmount > 0.01）
      apiGet('/v1/orders', { page: 1, pageSize: 500 }).then(function (d) {
        var unpaid = rowsOf(d).filter(function (o) {
          if (['cancelled', 'canceled', 'void'].indexOf(o.status) >= 0) return false;
          var bal = Number(o.finalAmount || 0) - Number(o.paidAmount || 0);
          return bal > 0.01;
        });
        var sum = unpaid.reduce(function (s, o) { return s + (Number(o.finalAmount || 0) - Number(o.paidAmount || 0)); }, 0);
        return unpaid.length > 0 ? {
          icon: '💰', level: 'danger', href: 'orders.html',
          title: '未收欠款 ' + unpaid.length + ' 单',
          desc: '合计待收 ' + fmtMoney(sum)
        } : null;
      }).catch(function () { return null; })
    ];

    return Promise.all(tasks).then(function (arr) {
      var items = arr.filter(Boolean);
      var r = { t: Date.now(), items: items, count: items.length };
      cache.todo = r;
      return r;
    });
  }

  /* ---------------- ✉️ 官网公告消息 ---------------- */
  function loadMsgs(force) {
    if (!force && cache.msg.items && (Date.now() - cache.msg.t) < CACHE_TTL) {
      return Promise.resolve(cache.msg);
    }
    return apiGet('/v1/contents/public', { type: 'notice', page: 1, pageSize: 10 })
      .then(function (d) {
        var items = rowsOf(d).slice(0, 10).map(function (c) {
          return {
            icon: '📢',
            href: '../news.html',
            title: c.title || '（无标题公告）',
            desc: c.summary ? String(c.summary).slice(0, 40) : (c.publishDate ? ymd(c.publishDate) : ''),
            time: ago(c.publishDate || c.updatedAt || c.createdAt),
            blank: true
          };
        });
        var r = { t: Date.now(), items: items };
        cache.msg = r;
        return r;
      })
      .catch(function () { return { t: Date.now(), items: [] }; });
  }

  /* ---------------- 面板 UI ---------------- */
  var CSS_ID = '__qntf-style';
  function injectCss() {
    if (document.getElementById(CSS_ID)) return;
    var css = '' +
      '.qntf-panel{position:fixed;z-index:10000;width:330px;max-width:calc(100vw - 16px);background:#fff;border:1px solid #e5e7eb;border-radius:14px;' +
      'box-shadow:0 16px 44px rgba(15,23,42,.22);overflow:hidden;font-size:13px;color:#1f2937;animation:qntf-in .12s ease-out;}' +
      '@keyframes qntf-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}' +
      '.qntf-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:linear-gradient(135deg,#0F4C81,#16619e);color:#fff;}' +
      '.qntf-head .t{font-weight:700;font-size:.92rem}.qntf-head .r{display:flex;gap:8px;align-items:center}' +
      '.qntf-head button{background:rgba(255,255,255,.16);border:none;color:#fff;border-radius:6px;padding:3px 8px;font-size:.72rem;cursor:pointer;line-height:1.4;}' +
      '.qntf-list{max-height:min(60vh,420px);overflow-y:auto;padding:6px;}' +
      '.qntf-item{display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:10px;text-decoration:none;color:inherit;transition:background .15s;}' +
      '.qntf-item:hover{background:#f3f7fb}.qntf-item .ic{font-size:1.05rem;line-height:1.3;flex-shrink:0}' +
      '.qntf-item .bd{min-width:0;flex:1}.qntf-item .ti{font-weight:600;font-size:.85rem;color:#163b5c;line-height:1.35}' +
      '.qntf-item .ds{font-size:.75rem;color:#6b7280;margin-top:2px;line-height:1.4;word-break:break-all}' +
      '.qntf-item .tm{font-size:.68rem;color:#9ca3af;white-space:nowrap;margin-top:2px}' +
      '.qntf-item .ar{color:#c0c7d0;font-size:.8rem;align-self:center;flex-shrink:0}' +
      '.qntf-item .bdg{display:inline-block;margin-left:6px;font-size:.62rem;font-weight:700;padding:1px 6px;border-radius:999px;vertical-align:1px}' +
      '.qntf-item .bdg.warn{background:#fef3c7;color:#b45309}.qntf-item .bdg.danger{background:#fee2e2;color:#b91c1c}' +
      '.qntf-empty{padding:34px 18px;text-align:center;color:#9ca3af;line-height:1.7}' +
      '.qntf-empty .big{font-size:1.7rem;display:block;margin-bottom:6px}' +
      '.qntf-foot{padding:9px 14px;border-top:1px solid #f0f2f5;text-align:center}' +
      '.qntf-foot a{color:#0F4C81;font-size:.78rem;text-decoration:none;font-weight:600}' +
      '.qntf-dot{display:inline-block;min-width:15px;height:15px;line-height:15px;padding:0 4px;border-radius:999px;' +
      'background:#dc2626;color:#fff;font-size:.62rem;font-weight:700;text-align:center;vertical-align:top;margin-left:-7px;margin-top:-3px;}';
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  function position(panel, btn) {
    var r = btn.getBoundingClientRect();
    panel.style.visibility = 'hidden';
    panel.style.display = 'block';
    var w = panel.offsetWidth;
    var left = Math.min(Math.max(8, r.right - w), Math.max(8, global.innerWidth - w - 10));
    var top = r.bottom + 10;
    if (top + panel.offsetHeight > global.innerHeight - 8) top = Math.max(8, r.top - panel.offsetHeight - 10);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.visibility = '';
  }

  function itemHtml(it) {
    var bdg = it.level ? '<span class="bdg ' + (it.level === 'danger' ? 'danger' : 'warn') + '">' +
      (it.level === 'danger' ? '紧急' : '待办') + '</span>' : '';
    return '<a class="qntf-item" href="' + esc(it.href) + '"' + (it.blank ? ' target="_blank" rel="noopener"' : '') + '>' +
      '<span class="ic">' + it.icon + '</span>' +
      '<span class="bd"><span class="ti">' + esc(it.title) + bdg + '</span>' +
      (it.desc ? '<span class="ds">' + esc(it.desc) + '</span>' : '') + '</span>' +
      (it.time ? '<span class="tm">' + esc(it.time) + '</span>' : '<span class="ar">›</span>') +
      '</a>';
  }

  function close() {
    if (!openPanel) return;
    if (openPanel.el && openPanel.el.parentNode) openPanel.el.parentNode.removeChild(openPanel.el);
    openPanel = null;
  }

  function open(btn, kind) {
    if (openPanel) { close(); return; } // 再点同一按钮=关闭
    injectCss();
    var isTodo = kind === 'todo';
    var panel = document.createElement('div');
    panel.className = 'qntf-panel';
    panel.innerHTML =
      '<div class="qntf-head"><span class="t">' + (isTodo ? '🔔 业务待办通知' : '✉️ 系统公告消息') + '</span>' +
      '<span class="r"><button type="button" data-qntf="refresh" class="qntf-real">🔄 刷新</button></span></div>' +
      '<div class="qntf-list"><div class="qntf-empty">正在加载…</div></div>' +
      (isTodo ? '<div class="qntf-foot"><a href="index.html">前往数据看板查看汇总</a></div>'
        : '<div class="qntf-foot"><a href="../news.html" target="_blank" rel="noopener">在官网查看全部公告 ↗</a></div>');
    document.body.appendChild(panel);
    position(panel, btn);
    openPanel = { el: panel, kind: kind, btn: btn };

    panel.addEventListener('click', function (ev) {
      var rb = ev.target.closest && ev.target.closest('[data-qntf="refresh"]');
      if (rb) { ev.preventDefault(); ev.stopPropagation(); render(true); }
    }, true);

    function render(force) {
      var box = $('.qntf-list', panel);
      box.innerHTML = '<div class="qntf-empty">正在加载…</div>';
      var job = isTodo ? loadTodos(force) : loadMsgs(force);
      job.then(function (r) {
        if (openPanel && openPanel.el !== panel) return; // 已切换/关闭
        var items = r.items || [];
        if (!items.length) {
          box.innerHTML = isTodo
            ? '<div class="qntf-empty"><span class="big">✅</span>暂无待处理通知<br>所有业务流转正常</div>'
            : '<div class="qntf-empty"><span class="big">📭</span>暂无公告消息</div>';
          return;
        }
        box.innerHTML = items.map(itemHtml).join('');
      }).catch(function () {
        box.innerHTML = '<div class="qntf-empty">加载失败，请稍后重试</div>';
      });
    }
    render(false);
  }

  /* ---------------- 按钮绑定 ---------------- */
  function setBadge(btn, count) {
    var dot = btn.querySelector('.notify-dot');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'notify-dot';
      btn.appendChild(dot);
    }
    if (count > 0) {
      dot.textContent = count > 99 ? '99+' : String(count);
      dot.style.cssText = 'display:inline-block;min-width:15px;height:15px;line-height:15px;padding:0 4px;' +
        'border-radius:999px;background:#dc2626;color:#fff;font-size:.62rem;font-weight:700;text-align:center;' +
        'vertical-align:top;margin-left:-8px;margin-top:-4px;';
    } else {
      dot.style.display = 'none';
    }
  }

  function bind() {
    var btns = $all('button.admin-header-btn').filter(function (b) {
      return b.title === '通知' || b.title === '消息';
    });
    btns.forEach(function (b) {
      if (b.__qntfBound) return;
      b.__qntfBound = 1;
      markBtn(b);
      var kind = b.title === '通知' ? 'todo' : 'msg';
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        open(b, kind);
      }, true);
    });

    // 点外部 / Esc 关闭
    document.addEventListener('click', function (ev) {
      if (!openPanel) return;
      if (openPanel.el.contains(ev.target) || openPanel.btn.contains(ev.target)) return;
      close();
    }, false);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') close();
    }, true);
    global.addEventListener('resize', function () { if (openPanel) position(openPanel.el, openPanel.btn); }, true);

    // 静默预加载待办 → 更新红点
    setTimeout(function () {
      loadTodos(false).then(function (r) {
        var bell = $all('button.admin-header-btn').filter(function (b) { return b.title === '通知'; })[0];
        if (bell) setBadge(bell, r.count);
      }).catch(function () {});
    }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  global.__QAXNotif.refreshTodos = function () {
    return loadTodos(true).then(function (r) {
      var bell = $all('button.admin-header-btn').filter(function (b) { return b.title === '通知'; })[0];
      if (bell) setBadge(bell, r.count);
      return r;
    });
  };
})(window);

/* ===== [9/11] js/pagination.js (19785 bytes) ===== */
(function (global) {
  'use strict';

  var PAGE_CONFIG = {
    'news.html': { pageSize: 6 },
    'operas.html': { pageSize: 8 },
    'admin/orders.html': { pageSize: 10 },
    'admin/staff.html': { pageSize: 10 },
    'admin/inventory.html': { pageSize: 10 }
  };

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var ctx = this, args = arguments;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, delay || 250);
    };
  }

  function getPageConfig() {
    var path = window.location.pathname;
    var parts = path.split(/[\\/]/);
    var len = parts.length;
    var candidates = [
      parts[len - 2] + '/' + parts[len - 1],
      parts[len - 1]
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (PAGE_CONFIG[candidates[i]]) return PAGE_CONFIG[candidates[i]];
    }
    return null;
  }

  function matchContainer(container) {
    var tagName = container.tagName.toLowerCase();
    if (tagName === 'tbody') return container;
    if (tagName === 'table') {
      var tb = container.querySelector('tbody');
      if (tb) return tb;
    }
    return container;
  }

  function getDirectChildren(container) {
    var host = matchContainer(container);
    var children = [];
    for (var i = 0; i < host.children.length; i++) {
      var node = host.children[i];
      if (node.tagName && node.tagName.toLowerCase() !== 'script' && node.tagName.toLowerCase() !== 'style') {
        children.push(node);
      }
    }
    return children;
  }

  function getText(el) {
    return (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function elementMatchesKeyword(el, keyword) {
    if (!keyword) return true;
    var kw = keyword.toLowerCase();
    if (getText(el).toLowerCase().indexOf(kw) >= 0) return true;
    var data = el.getAttribute && el.getAttribute('data-search');
    if (data && data.toLowerCase().indexOf(kw) >= 0) return true;
    return false;
  }

  function QinPagination() {
    this._instances = [];
  }

  QinPagination.prototype.initAll = function () {
    var self = this;
    var containers = document.querySelectorAll('[data-paginate="list"]');
    var cfg = getPageConfig();
    containers.forEach(function (container) {
      var pageSize = parseInt(container.getAttribute('data-page-size'), 10);
      if (!pageSize && cfg) pageSize = cfg.pageSize;
      if (!pageSize) pageSize = 10;
      if (!container.getAttribute('data-page-size')) {
        container.setAttribute('data-page-size', String(pageSize));
      }
      self._initOne(container);
    });

    var classMap = [
      { sel: '.news-list', size: 6 },
      { sel: '.operas-grid', size: 8 }
    ];
    classMap.forEach(function (item) {
      var el = document.querySelector(item.sel);
      if (el && !el.hasAttribute('data-paginate')) {
        var ok = false;
        for (var k in PAGE_CONFIG) {
          if (window.location.pathname.indexOf(k) >= 0) { ok = true; break; }
        }
        if (ok) {
          el.setAttribute('data-paginate', 'list');
          el.setAttribute('data-page-size', String(item.size));
          self._initOne(el);
        }
      }
    });
  };

  QinPagination.prototype._initOne = function (container) {
    if (container.getAttribute('data-pagination-bound') === '1') return;
    container.setAttribute('data-pagination-bound', '1');

    var host = matchContainer(container);
    var pageSize = parseInt(container.getAttribute('data-page-size'), 10) || 10;
    var state = {
      container: container,
      host: host,
      pageSize: pageSize,
      currentPage: 1,
      searchKeyword: '',
      categoryKey: null,
      categorySelector: null,
      searchInput: null
    };

    var bar = this._renderBar(state);
    if (container.nextSibling) {
      container.parentNode.insertBefore(bar, container.nextSibling);
    } else {
      container.parentNode.appendChild(bar);
    }
    state.bar = bar;

    this._bindSearch(state);
    this._bindCategory(state);
    this._refresh(state);

    var self = this;
    var observer = new MutationObserver(debounce(function () {
      self._refresh(state);
    }, 150));
    observer.observe(host, { childList: true, subtree: false });
    state._observer = observer;

    this._instances.push(state);
  };

  QinPagination.prototype._renderBar = function (state) {
    var bar = document.createElement('div');
    bar.className = 'pagination-bar';
    // —— ★ 全局无限延长修复：pagination-bar 双保险（即使没注入 CSS 也不会撑到 4690px 那种高度）
    try {
      bar.style.maxHeight = '180px';
      bar.style.overflow = 'hidden';
      bar.style.position = 'relative';
      bar.style.minHeight = '0';
    } catch (_s) {}
    bar.innerHTML =
      '<div class="pagination-bar-inner">' +
        '<div class="pagination-controls">' +
          '<button type="button" class="page-btn page-prev" data-action="prev">« 上一页</button>' +
          '<div class="page-numbers" data-page-numbers></div>' +
          '<button type="button" class="page-btn page-next" data-action="next">下一页 »</button>' +
        '</div>' +
        '<div class="pagination-tools">' +
          '<span class="page-jump-wrap">' +
            '跳转到 <input type="number" min="1" class="page-jump-input" data-page-jump> 页' +
          '</span>' +
          '<select class="page-size-select" data-page-size-select>' +
            '<option value="5">5 条/页</option>' +
            '<option value="6">6 条/页</option>' +
            '<option value="8">8 条/页</option>' +
            '<option value="10" selected>10 条/页</option>' +
            '<option value="15">15 条/页</option>' +
            '<option value="20">20 条/页</option>' +
            '<option value="30">30 条/页</option>' +
            '<option value="50">50 条/页</option>' +
          '</select>' +
        '</div>' +
        '<div class="page-info" data-page-info></div>' +
      '</div>';

    /* v20260926b 防首次点击被页面兜底脚本（SuperPatch 6/6 等 document 捕获监听）劫持：
       bar 内静态按钮（上一页/下一页）立即打早退标记，_hasAction/__btnHasBound 均认 */
    try {
      var __bb = bar.querySelectorAll('button');
      for (var __bi = 0; __bi < __bb.length; __bi++) {
        if (!__bb[__bi].__superPatchBound) __bb[__bi].__superPatchBound = 1;
        if (!__bb[__bi].__deadBtnChecked) __bb[__bi].__deadBtnChecked = 1;
      }
    } catch (_bm) {}

    var self = this;
    function getTotalPages(st) {
      var total = self._getVisibleItems(st).length;
      return Math.max(1, Math.ceil(total / st.pageSize));
    }
    function clampPage(st, page) {
      var tp = getTotalPages(st);
      if (page < 1) return 1;
      if (page > tp) return tp;
      return page;
    }
    var ps = bar.querySelector('[data-page-size-select]');
    ps.value = String(state.pageSize);
    ps.addEventListener('change', function () {
      state.pageSize = parseInt(ps.value, 10) || 10;
      state.container.setAttribute('data-page-size', String(state.pageSize));
      state.currentPage = 1;
      self._refresh(state);
    });

    bar.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== bar) {
        if (t.tagName === 'BUTTON') break;
        t = t.parentNode;
      }
      if (!t || t === bar) return;
      e.preventDefault();
      var action = t.getAttribute('data-action');
      var num = t.getAttribute('data-page-num');
      if (action === 'prev') {
        if (state.currentPage > 1) { state.currentPage--; self._refresh(state); }
      } else if (action === 'next') {
        var tp = getTotalPages(state);
        if (state.currentPage < tp) { state.currentPage++; self._refresh(state); }
      } else if (num) {
        state.currentPage = clampPage(state, parseInt(num, 10));
        self._refresh(state);
      }
    });

    var jump = bar.querySelector('[data-page-jump]');
    function doJump() {
      var v = parseInt(jump.value, 10);
      if (!v || v < 1) return;
      state.currentPage = clampPage(state, v);
      self._refresh(state);
    }
    jump.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doJump(); }
    });
    jump.addEventListener('blur', doJump);

    return bar;
  };

  function isElementVisible(el) {
    if (!el) return false;
    var node = el;
    while (node && node !== document.body && node.parentNode) {
      var st = null;
      try { st = window.getComputedStyle ? window.getComputedStyle(node, null) : node.style; } catch (e) { st = node.style; }
      if (!st) { node = node.parentNode; continue; }
      var disp = (st.display || node.style.display || '').toLowerCase();
      var vis = (st.visibility || node.style.visibility || '').toLowerCase();
      if (disp === 'none' || vis === 'hidden') return false;
      node = node.parentNode;
    }
    return true;
  }

  QinPagination.prototype._bindSearch = function (state) {
    var scope = state.container.closest('main, section, .admin-content, body') || document;
    var selectors = 'input[data-search], .search-input, .admin-search input[type="text"], .filter-bar .search-box input, .admin-filter-bar input[placeholder*="搜索"]';
    var input = null;
    try {
      var nodes = scope.querySelectorAll(selectors);
      for (var k = 0; k < nodes.length; k++) {
        if (isElementVisible(nodes[k])) { input = nodes[k]; break; }
      }
      if (!input) {
        for (var k2 = 0; k2 < nodes.length; k2++) {
          if (!nodes[k2].disabled) { input = nodes[k2]; break; }
        }
      }
    } catch (e) {}
    if (!input) {
      try {
        var fallbackNodes = document.querySelectorAll(selectors);
        for (var kf = 0; kf < fallbackNodes.length; kf++) {
          if (!fallbackNodes[kf].disabled) { input = fallbackNodes[kf]; break; }
        }
      } catch (e) {}
    }
    if (!input) {
      try {
        var candidates = document.querySelectorAll('input[type="text"], input[type="search"]');
        for (var i = 0; i < candidates.length; i++) {
          if (!isElementVisible(candidates[i])) continue;
          var ph = (candidates[i].placeholder || '').toLowerCase();
          if (ph.indexOf('搜索') >= 0 || ph.indexOf('search') >= 0) {
            input = candidates[i]; break;
          }
        }
      } catch (e) {}
    }
    if (!input) return;
    state.searchInput = input;
    var self = this;
    input.addEventListener('input', debounce(function () {
      state.searchKeyword = (input.value || '').trim();
      state.currentPage = 1;
      self._refresh(state);
    }, 250));
  };

  QinPagination.prototype._bindCategory = function (state) {
    var scope = state.container.closest('main, section, .admin-content, body') || document;
    var selectors = '.category-btn, .category-tab, .tab-item[data-tab], [data-tab-btn], .staff-tab, .inv-tab';
    var btns = scope.querySelectorAll(selectors);
    if (btns.length === 0) {
      try { btns = document.querySelectorAll(selectors); } catch (e) { btns = []; }
    }
    if (btns.length === 0) return;

    function findActive() {
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].classList.contains('active')) return btns[i];
      }
      return null;
    }
    var active = findActive();
    state.categoryKey = this._extractCategoryKey(active);

    var self = this;
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setTimeout(function () {
          state.categoryKey = self._extractCategoryKey(btn);
          state.currentPage = 1;
          self._refresh(state);
        }, 30);
      });
    });
  };

  QinPagination.prototype._extractCategoryKey = function (btn) {
    if (!btn) return null;
    var keys = ['data-cat', 'data-tab-btn', 'data-tab'];
    for (var i = 0; i < keys.length; i++) {
      var v = btn.getAttribute(keys[i]);
      if (v) return v;
    }
    return btn.textContent || null;
  };

  QinPagination.prototype._getVisibleItems = function (state) {
    var all = getDirectChildren(state.container);
    var keyword = state.searchKeyword;
    var self = this;
    var resolveCat = function (el) {
      var c = el.getAttribute('data-category') || el.getAttribute('data-tab-panel');
      if (c) return c;
      try {
        var tag = el.querySelector('[class*="cat-"], .news-cat-tag, .opera-cat-tag, .cat-tag');
        if (tag) {
          var cls = tag.className || '';
          var m = cls.match(/cat-([a-zA-Z0-9_-]+)/);
          if (m) return m[1];
        }
      } catch (e) {}
      return null;
    };
    var filtered = all.filter(function (el) {
      var isEmpty = el.classList && el.classList.contains('category-empty');
      if (keyword && !elementMatchesKeyword(el, keyword)) return false;
      if (state.categoryKey && state.categoryKey !== 'all') {
        var disp = el.style.display;
        if (disp === 'none' && !keyword) return false;
        var catAttr = resolveCat(el);
        if (isEmpty) {
          if (catAttr && catAttr !== state.categoryKey) return false;
        } else {
          if (catAttr && catAttr !== state.categoryKey && state.categoryKey !== 'all') {
            return false;
          }
        }
      } else {
        if (isEmpty) return false;
        if (el.style.display === 'none' && !keyword) {
          var catAttr2 = resolveCat(el);
          if (catAttr2) return false;
        }
      }
      return true;
    });
    return filtered;
  };

  QinPagination.prototype._refresh = function (state) {
    var host = state.host;
    var all = getDirectChildren(state.container);
    for (var ci = 0; ci < all.length; ci++) {
      var cel = all[ci];
      if (cel.hasAttribute('data-pagination-hidden')) {
        cel.removeAttribute('data-pagination-hidden');
      }
      // B7 CSP合规：使用classList移除.pg-hidden替代style.display恢复
      try { cel.classList.remove('pg-hidden'); } catch (_csp) {}
    }
    var visible = this._getVisibleItems(state);
    var total = visible.length;
    var pageSize = state.pageSize;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;

    var startIdx = (state.currentPage - 1) * pageSize;
    var endIdx = Math.min(total, startIdx + pageSize);

    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el._paginationOrigDisplay === undefined && !el.hasAttribute('data-pagination-hidden')) {
        el._paginationOrigDisplay = true;  // 仅标记已初始化，不再存真实display值
      }
      var inVisible = visible.indexOf(el) >= 0;
      var inPageRange = false;
      if (inVisible) {
        var vi = visible.indexOf(el);
        inPageRange = (vi >= startIdx && vi < endIdx);
      }
      if (!inVisible || !inPageRange) {
        el.setAttribute('data-pagination-hidden', '1');
        // B7 CSP合规：添加.pg-hidden替代el.style.display='none'
        try { el.classList.add('pg-hidden'); } catch (_csp) {}
      } else {
        el.removeAttribute('data-pagination-hidden');
        // B7 CSP合规：移除.pg-hidden替代el.style.display=''
        try { el.classList.remove('pg-hidden'); } catch (_csp) {}
      }
    }

    this._renderNumbers(state, totalPages);
    this._renderInfo(state, total, startIdx, endIdx);
    this._updateArrows(state, totalPages);
    var jump = state.bar.querySelector('[data-page-jump]');
    if (jump) { jump.max = String(totalPages); jump.value = ''; }
  };

  QinPagination.prototype._renderNumbers = function (state, totalPages) {
    var wrap = state.bar.querySelector('[data-page-numbers]');
    if (!wrap) return;
    wrap.innerHTML = '';
    var cur = state.currentPage;
    var maxShow = 7;
    var pages = [];

    if (totalPages <= maxShow) {
      for (var i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      var s = Math.max(2, cur - 2);
      var e = Math.min(totalPages - 1, cur + 2);
      if (s > 2) pages.push('...');
      for (var j = s; j <= e; j++) pages.push(j);
      if (e < totalPages - 1) pages.push('...');
      pages.push(totalPages);
    }

    var frag = document.createDocumentFragment();
    for (var k = 0; k < pages.length; k++) {
      var p = pages[k];
      if (p === '...') {
        var span = document.createElement('span');
        span.className = 'page-dots';
        span.textContent = '...';
        frag.appendChild(span);
      } else {
        var btn = document.createElement('button');
        btn.type = 'button';
        /* v20260926b 防首次点击被兜底脚本劫持：立即打早退标记 */
        btn.__superPatchBound = 1; btn.__deadBtnChecked = 1;
        btn.className = 'page-btn' + (p === cur ? ' active' : '');
        btn.setAttribute('data-page-num', String(p));
        btn.textContent = String(p);
        frag.appendChild(btn);
      }
    }
    wrap.appendChild(frag);
  };

  QinPagination.prototype._renderInfo = function (state, total, startIdx, endIdx) {
    var info = state.bar.querySelector('[data-page-info]');
    if (!info) return;
    if (total === 0) {
      info.textContent = '暂无数据';
    } else {
      info.textContent = '显示 ' + (startIdx + 1) + '-' + endIdx + ' 共 ' + total + ' 条 · 第 ' + state.currentPage + '/' + Math.max(1, Math.ceil(total / state.pageSize)) + ' 页';
    }
  };

  QinPagination.prototype._updateArrows = function (state, totalPages) {
    var prev = state.bar.querySelector('[data-action="prev"]');
    var next = state.bar.querySelector('[data-action="next"]');
    if (prev) prev.disabled = (state.currentPage <= 1);
    if (next) next.disabled = (state.currentPage >= totalPages);
  };

  QinPagination.prototype.refreshAll = function () {
    for (var i = 0; i < this._instances.length; i++) {
      this._refresh(this._instances[i]);
    }
  };

  QinPagination.prototype.destroyAll = function () {
    for (var i = 0; i < this._instances.length; i++) {
      var s = this._instances[i];
      try { s._observer && s._observer.disconnect(); } catch (e) {}
      if (s.bar && s.bar.parentNode) s.bar.parentNode.removeChild(s.bar);
      var all = getDirectChildren(s.container);
      for (var j = 0; j < all.length; j++) {
        if (all[j].getAttribute('data-pagination-hidden') === '1') {
          all[j].removeAttribute('data-pagination-hidden');
          // B7 CSP合规：移除.pg-hidden替代all[j].style.display=''
          try { all[j].classList.remove('pg-hidden'); } catch (_csp) {}
        }
      }
      s.container.removeAttribute('data-pagination-bound');
    }
    this._instances = [];
  };

  var instance = new QinPagination();
  global.QinPagination = {
    init: function () { instance.initAll(); },
    refresh: function () { instance.refreshAll(); },
    destroy: function () { instance.destroyAll(); },
    _raw: instance
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { instance.initAll(); });
  } else {
    setTimeout(function () { instance.initAll(); }, 0);
  }
})(typeof window !== 'undefined' ? window : this);

/* ===== [10/11] js/real-action-guard.js (3434 bytes) ===== */
/* js/real-action-guard.js —— 真实业务按钮护航（v20260922）
 *
 * 背景：各 admin 页内联的 SuperPatch 6/6 与 DeadButtonFallback 都在 document【捕获阶段】
 * 监听 click，凡是非模态框内、无 onclick/href、且未打 __superPatchBound 标记的按钮，
 * 一律 preventDefault + stopPropagation 并弹"演示模式"toast（👁查看/ℹ️详情编辑/📤导出）。
 * 真实业务行按钮（orders/operas/schedule/content 等动态渲染的 <button data-act>）由
 * tbody【冒泡】委托处理，事件在到达 tbody 之前就被 document 捕获兜底劫持。
 *
 * 本脚本统一在按钮【渲染入库后、用户点击前】用 MutationObserver 预打早退标记，
 * 让 document 捕获阶段的两个兜底都"识别为已绑定真实行为"而放行，事件正常到达
 * 各页面既有的 tbody 委托。标记全部幂等，不改变任何业务逻辑。
 *
 * 早退标记契约（与各页内联兜底一致，勿随意改名）：
 *   __superPatchBound = 1  → SuperPatch 6/6 _hasAction() 与 DBF __btnHasBound() 均认
 *   __ts3Done = 1          → DBF 全局早退
 *   __bindDone / __ctE2Done = 1 → DBF 去重早退
 *   __deadBtnChecked = 1   → _hasAction 兜底
 */
(function () {
  'use strict';
  if (window.__realActionGuard) return;
  window.__realActionGuard = true;

  // [data-real-bound]：已真实接线的静态工具栏按钮（导出/打印等，无 data-act）的显式契约
  var SEL = 'button[data-act], a[data-act], [role="button"][data-act], [data-real-bound]';
  var FLAGS = ['__superPatchBound', '__ts3Done', '__bindDone', '__ctE2Done', '__deadBtnChecked'];

  function markOne(el) {
    if (!el || el.nodeType !== 1) return;
    for (var i = 0; i < FLAGS.length; i++) {
      try { if (!el[FLAGS[i]]) el[FLAGS[i]] = 1; } catch (_) {}
    }
  }

  // 主动扫描指定根（默认整个 document），供渲染后立即同步调用
  function scan(root) {
    try {
      var scope = root || document;
      var list = scope.querySelectorAll ? scope.querySelectorAll(SEL) : [];
      for (var i = 0; i < list.length; i++) markOne(list[i]);
      // root 自身可能就是按钮
      if (scope.matches && scope.matches(SEL)) markOne(scope);
    } catch (_) {}
  }
  window.__guardRealActions = scan;

  function start() {
    scan(document);
    if (typeof MutationObserver === 'undefined') {
      // 无 MO 的极端环境：定时兜底
      setTimeout(scan, 300); setTimeout(scan, 900); setTimeout(scan, 1800);
      return;
    }
    var mo = new MutationObserver(function (mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var added = mutations[m].addedNodes;
        for (var k = 0; k < added.length; k++) {
          var node = added[k];
          if (node.nodeType !== 1) continue;
          markOne(node);
          if (node.querySelectorAll) {
            var inner = node.querySelectorAll(SEL);
            for (var j = 0; j < inner.length; j++) markOne(inner[j]);
          }
        }
      }
    });
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
    // 兜底：覆盖 observer 启动前已渲染、或非标准插入的节点
    setTimeout(scan, 300); setTimeout(scan, 900); setTimeout(scan, 1800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

/* ===== [11/11] js/admin-mobile-sidebar.js (3270 bytes) ===== */
/* ==========================================================================
 * js/admin-mobile-sidebar.js —— 后台手机端侧边栏抽屉（v20260926m）
 * ----------------------------------------------------------------------------
 * 统一绑定 .admin-sidebar-toggle / .topbar-toggle / #sidebarToggle：
 *   - 打开：#adminSidebar 加 mobile-open，#sidebarOverlay 加 active（缺失自动创建）
 *   - 关闭：点遮罩 / ESC / 点菜单链接后 / 窗口拉宽到 >900px
 *   - 切换按钮立即打防劫持标记（__superPatchBound/__deadBtnChecked），
 *     防止被各页「按钮兜底」document 捕获监听吞掉首次点击
 * 幂等：window.__adminMobileSidebarBound，每页只绑定一次
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__adminMobileSidebarBound) return;
  window.__adminMobileSidebarBound = true;

  function markBtn(b) {
    if (!b) return;
    try {
      b.__superPatchBound = 1;
      b.__deadBtnChecked = 1;
      b.__ts3Done = 1;
      b.__bindDone = 1;
      b.__ctE2Done = 1;
      b.setAttribute('data-real-bound', '1');
    } catch (_) {}
  }

  function init() {
    var sidebar = document.getElementById('adminSidebar') || document.querySelector('.admin-sidebar');
    if (!sidebar) return;
    var toggle = document.querySelector('.admin-sidebar-toggle, .topbar-toggle, #sidebarToggle');

    var overlay = document.getElementById('sidebarOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sidebarOverlay';
      overlay.className = 'admin-sidebar-overlay';
      var host = document.querySelector('.admin-layout') || document.body;
      host.insertBefore(overlay, host.firstChild);
    }

    function isOpen() { return sidebar.classList.contains('mobile-open'); }
    function open() {
      sidebar.classList.add('mobile-open');
      overlay.classList.add('active');
      document.body.classList.add('m-nav-open');
    }
    function close() {
      sidebar.classList.remove('mobile-open');
      overlay.classList.remove('active');
      document.body.classList.remove('m-nav-open');
    }

    markBtn(toggle);
    if (toggle) {
      toggle.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (isOpen()) close(); else open();
      });
    }
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) close();
    });
    // 点击菜单链接后自动收起（同页锚点场景）；真实跳转页面随导航卸载无影响
    var links = sidebar.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function () { if (isOpen()) close(); });
    }
    // 旋转/拉宽到桌面尺寸时复位，避免 mobile-open 残留
    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (window.innerWidth > 900 && isOpen()) close(); }, 150);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
