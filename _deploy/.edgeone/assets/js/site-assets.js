/* ==========================================================================
 * js/site-assets.js —— 站点图片位投放层（v20260929a）
 * 数据来源：GET /v1/site-assets/public（无鉴权，返回 {map:{key:url}}）
 * 用法：元素上加 data-asset-key="site.xxx"（<img>）或 data-asset-key-bg="site.xxx"（背景图容器）
 * 原则：无投放值或接口失败时保留页面默认图；favicon 用 key=site.global.favicon。
 * ========================================================================== */
(function (global) {
  'use strict';

  var CACHE_KEY = 'qaxqjt_site_assets_v1';
  var CACHE_TTL = 5 * 60 * 1000; // 5 分钟

  function apiBase() {
    if (global.__QAXQJT_API_BASE__ && typeof global.__QAXQJT_API_BASE__ === 'string') {
      return global.__QAXQJT_API_BASE__.replace(/\/+$/, '');
    }
    try {
      var s = global.localStorage && global.localStorage.getItem('qaxqjt_api_base_url');
      if (s) return String(s).replace(/\/+$/, '');
    } catch (_) {}
    // 同源相对：生产 HTTP / EdgeOne HTTPS / 本地预览均自动适配，避免硬编码协议导致 ERR_CONNECTION_REFUSED
    return (global.location && global.location.origin) ? global.location.origin : '';
  }

  function fetchMap() {
    try {
      var raw = global.sessionStorage && global.sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        var c = JSON.parse(raw);
        if (c && c.t && (Date.now() - c.t) < CACHE_TTL && c.map) return Promise.resolve(c.map);
      }
    } catch (_) {}
    var url = apiBase() + '/v1/site-assets/public';
    return fetch(url, { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('http-' + r.status);
      return r.json();
    }).then(function (j) {
      var map = (j && j.data && j.data.map) || (j && j.map) || {};
      try { global.sessionStorage && global.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), map: map })); } catch (_) {}
      return map;
    }).catch(function () { return {}; });
  }

  function quoteUrl(u) { return "'" + String(u).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

  function applyMap(map) {
    if (!map) return;
    // 1) <img data-asset-key>
    var imgs = document.querySelectorAll('img[data-asset-key]');
    for (var i = 0; i < imgs.length; i++) {
      var u = map[imgs[i].getAttribute('data-asset-key')];
      if (u) imgs[i].src = u;
    }
    // 2) [data-asset-key-bg] 背景图（保留原有渐变层，仅替换 url(...) 部分）
    var bgs = document.querySelectorAll('[data-asset-key-bg]');
    for (var j = 0; j < bgs.length; j++) {
      var el = bgs[j];
      var u2 = map[el.getAttribute('data-asset-key-bg')];
      if (!u2) continue;
      var cur = (el.style && el.style.backgroundImage) || '';
      var nu = 'url(' + quoteUrl(u2) + ')';
      if (/url\((['"]?)[\s\S]*?\1\)/.test(cur)) {
        el.style.backgroundImage = cur.replace(/url\((['"]?)[\s\S]*?\1\)/, nu);
      } else {
        el.style.backgroundImage = (cur ? cur + ', ' : '') + nu;
      }
    }
    // 3) favicon
    var fv = map['site.global.favicon'];
    if (fv) {
      var link = document.querySelector('link[rel="icon"]');
      if (link) link.href = fv;
    }
    // 4) [data-asset-text] 纯文本位（如客服微信号/公众号名，site.text.*）
    var txts = document.querySelectorAll('[data-asset-text]');
    for (var k = 0; k < txts.length; k++) {
      var tv = map[txts[k].getAttribute('data-asset-text')];
      if (tv) txts[k].textContent = tv;
    }
  }

  function boot() { fetchMap().then(applyMap); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.QAXSiteAssets = {
    refresh: function () { try { global.sessionStorage && global.sessionStorage.removeItem(CACHE_KEY); } catch (_) {} return fetchMap().then(applyMap); },
    getMap: fetchMap
  };
})(window);
