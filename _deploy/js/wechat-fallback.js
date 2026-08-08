/**
 * 秦安县秦剧团云端预约系统 - 微信内置浏览器友好降级引导
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
      { name: 'apple-mobile-web-app-title', content: '秦安县秦剧团' },
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
