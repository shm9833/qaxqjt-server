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
    if (CFG.isFallbackMode && typeof opts.fallback === 'function') {
      try { return await opts.fallback({ reason: 'force_fallback' }); }
      catch (e) { throw e; }
    }
    if (CFG.isFallbackMode && typeof opts.fallbackRead === 'function') {
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
      if (res.status === 401 && !/\/auth\/login$/.test(path) && !opts.__refreshed__) {
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
    if (needLogin !== false) _toast('登录已失效，请重新登录', 'warn');
    var cur = global.location.pathname;
    var isAdmin = /\/admin\//.test(cur) || /admin[\/]?login\.html$/i.test(cur);
    var target = isAdmin ? 'login.html' : (global.location.origin + '/admin/login.html');
    if (!/login\.html/i.test(cur)) setTimeout(function () { global.location.href = target; }, 800);
  }

  var API = {
    request: request,
    get: function (p, opts) { return request('GET', p, opts); },
    post: function (p, body, opts) { return request('POST', p, Object.assign({}, opts || {}, { body: body })); },
    put: function (p, body, opts) { return request('PUT', p, Object.assign({}, opts || {}, { body: body })); },
    patch: function (p, body, opts) { return request('PATCH', p, Object.assign({}, opts || {}, { body: body })); },
    del: function (p, opts) { return request('DELETE', p, opts); },

    login: async function (username, password, captcha) {
      var r = await request('POST', (CFG.PATHS && CFG.PATHS.AUTH_LOGIN) || '/v1/auth/login', {
        body: { username: username, password: password, captcha: captcha || '' },
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
