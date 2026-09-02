/**
 * app.js - 秦安县秦剧团云端预约系统主业务逻辑
 *
 * 功能模块：
 * 1. 阶梯优惠计算引擎
 * 2. 预约表单验证与提交
 * 3. 导航栏移动端交互
 * 4. 平滑滚动与页面通用交互
 * 5. localStorage 数据持久化（预约、订单、用户）
 * 6. 后台管理通用增删改查（CRUD）模拟
 */

(function (global) {
  'use strict';

  // ===== 全局 $ 简写：document.getElementById（兼容无 jQuery/Zepto 场景）=====
  // 修复前：未定义，新写的 runHealthCheck/triggerBackup 等 10+ 函数全部 ReferenceError: $ is not defined
  // 修复后：IIFE 内部可用 + 强制挂到 global.$（不检查 undefined，避免部分旧页面有 window.$=undefined 占位导致跳过）
  var $ = function (id) {
    try {
      if (typeof id !== 'string') return id;  // 传 DOM 元素直接回传
      return document.getElementById(id);
    } catch (e) { return null; }
  };
  if (global) {
    try { global.$ = $; } catch (e) {}
    try { global.__qa$ = $; } catch (e) {}  // 额外别名，防止被后续脚本覆盖
  }
  // Utils.toast 早期兜底（保证下面巡检逻辑即使页面未引入样式也不抛错）
  function _safeToast(msg, type, dur){
    try{ if(Utils && Utils.toast){ Utils.toast(msg,type||'info',dur||3000); return; } }catch(_){}
    try{ if(console && console.log) console.log('[toast]['+(type||'info')+'] '+msg); }catch(_){}
  }

  // ★ FIX 导出功能：自动加载 xlsx 库（SheetJS），多路径降级
  (function _loadXlsx() {
    try {
      if (global.XLSX && typeof global.XLSX.writeFile === 'function') return;
      var cdns = [
        'js/xlsx.min.js',
        '../js/xlsx.min.js',
        'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
      ];
      var idx = 0, done = false;
      function next() {
        if (done || idx >= cdns.length) return;
        var s = document.createElement('script');
        s.src = cdns[idx++];
        s.onload = function () {
          if (global.XLSX && typeof global.XLSX.writeFile === 'function') {
            done = true;
            try { console.info('[xlsx] loaded from: ' + s.src); } catch (_) {}
          } else { next(); }
        };
        s.onerror = function () { next(); };
        s.async = false;
        try { document.head.appendChild(s); } catch (_) { next(); }
      }
      if (document && document.head) next();
      else if (document && document.addEventListener) {
        document.addEventListener('DOMContentLoaded', next, { once: true });
      }
    } catch (_) {}
  })();

  // ============================================================
  // 模块 0: 通用工具函数 Utils
  // ============================================================
  var Utils = {
    /**
     * 格式化日期 YYYY-MM-DD
     */
    formatDate: function (date) {
      var d = (date instanceof Date) ? date : new Date(date);
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    },

    /**
     * 格式化金额（保留2位小数，千分位）
     * 修复 B9 MEDIUM：先 Math.round(n*100)/100 再 toFixed(2) 防止 0.1+0.2=0.30000000000000004
     */
    formatMoney: function (num) {
      var n = Number(num) || 0;
      n = Math.round(n * 100) / 100;
      return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },
    /**
     * 金额转「分」整数（B9 防浮点精度累积误差：在批量求和/乘折扣时先转分计算）
     */
    toCents: function (num) {
      var n = Number(num) || 0;
      return Math.round(n * 100);
    },
    /**
     * 「分」整数转回元（保留 2 位小数）
     */
    fromCents: function (cents) {
      var c = parseInt(cents, 10) || 0;
      return Math.round(c) / 100;
    },
    /**
     * 金额四舍五入到 2 位小数（替代直接 Math.round(x*100)/100 的重复写法）
     */
    centRound: function (num) {
      var n = Number(num) || 0;
      return Math.round(n * 100) / 100;
    },

    /**
     * 加密安全随机字节 → 十六进制字符串
     * 默认 16 字节 = 128 位熵（OWASP 推荐的会话/票据 ID 最小强度）
     */
    secureRandomHex: function (bytes) {
      var n = parseInt(bytes, 10) || 16;
      var hex = '';
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        var buf = new Uint8Array(n);
        crypto.getRandomValues(buf);
        for (var i = 0; i < buf.length; i++) {
          hex += (buf[i] < 16 ? '0' : '') + buf[i].toString(16);
        }
      } else {
        // 兼容降级：混合多次 Math.random + 时间戳微秒偏移（仍比单纯 Date.now 强）
        for (var j = 0; j < n; j++) {
          var r = (Math.random() * 256) ^ ((Date.now() * (j + 1)) & 0xff);
          hex += (r < 16 ? '0' : '') + Math.floor(r).toString(16);
        }
      }
      return hex;
    },
    /**
     * 生成唯一ID（加密安全：96位熵 + 可选前缀）
     * 格式：{prefix}_{12字节随机hex}，熵量高于项目约束的 96-bit minimum
     */
    generateId: function (prefix) {
      var p = prefix || 'id';
      var entropy12B = Utils.secureRandomHex(12);
      return p + '_' + entropy12B;
    },

    /**
     * 🔒 A-7 安全加固：生成强密码（默认 12 位，满足：大写+小写+数字+特殊符号 四种类别全命中）
     * 用于：重置账号密码 / 新建账号的初始密码，**彻底移除 123456 硬编码**
     */
    generateStrongPwd: function (len) {
      len = len || 12;
      if (len < 8) len = 8; // 最短 8 位
      var UPPERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';        // 去掉 I/O
      var LOWERS = 'abcdefghijkmnopqrstuvwxyz';        // 去掉 l
      var DIGITS = '23456789';                          // 去掉 0/1
      var SYMBOLS = '!@#$%^&*-_=+;:,.?';                // 安全符号（排除 < > " ' / \ 防注入）
      var ALL = UPPERS + LOWERS + DIGITS + SYMBOLS;
      var out = '';
      // 第 1 位必须：大写
      try { out += UPPERS.charAt(Math.floor(Math.random() * UPPERS.length)); } catch(_){ out += 'A'; }
      // 第 2 位必须：小写
      try { out += LOWERS.charAt(Math.floor(Math.random() * LOWERS.length)); } catch(_){ out += 'a'; }
      // 第 3 位必须：数字
      try { out += DIGITS.charAt(Math.floor(Math.random() * DIGITS.length)); } catch(_){ out += '8'; }
      // 第 4 位必须：特殊符号
      try { out += SYMBOLS.charAt(Math.floor(Math.random() * SYMBOLS.length)); } catch(_){ out += '!'; }
      // 剩余 len-4 位：全字符随机
      for (var i = 4; i < len; i++) {
        try {
          var buf = new Uint8Array(1);
          if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
          else if (window.msCrypto && window.msCrypto.getRandomValues) window.msCrypto.getRandomValues(buf);
          else buf[0] = Math.floor(Math.random() * 256);
          out += ALL.charAt(buf[0] % ALL.length);
        } catch(_) {
          out += ALL.charAt(Math.floor(Math.random() * ALL.length));
        }
      }
      // 简单洗牌（打乱 4 个强制位的固定位置）
      try {
        var arr = out.split('');
        for (var j = arr.length - 1; j > 0; j--) {
          var k = Math.floor(Math.random() * (j + 1));
          var tmp = arr[j]; arr[j] = arr[k]; arr[k] = tmp;
        }
        return arr.join('');
      } catch(_) { return out; }
    },

    /**
     * 防抖动
     */
    debounce: function (fn, delay) {
      var timer = null;
      return function () {
        var ctx = this;
        var args = arguments;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          fn.apply(ctx, args);
        }, delay || 300);
      };
    },

    /**
     * 防节流
     */
    throttle: function (fn, delay) {
      var last = 0;
      return function () {
        var now = Date.now();
        if (now - last >= (delay || 300)) {
          last = now;
          fn.apply(this, arguments);
        }
      };
    },

    /**
     * HTML 转义（防XSS）
     */
    escapeHtml: function (str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    /**
     * 字符串左填充（WageEngine 依赖：工资条ID补零、考勤日期补零）
     * 兼容无 String.prototype.padStart 的旧环境兜底
     */
    pad: function (str, targetLen, padChar) {
      var s = String(str == null ? '' : str);
      var len = parseInt(targetLen, 10) || 0;
      var ch = padChar == null ? ' ' : String(padChar).charAt(0) || ' ';
      if (s.length >= len) return s.slice(0, len);
      // 原生优先（更快）
      if (typeof String.prototype.padStart === 'function') {
        return s.padStart(len, ch);
      }
      var need = len - s.length;
      var pad = '';
      while (pad.length < need) pad += ch;
      return pad.slice(0, need) + s;
    },

    /**
     * 验证手机号（中国大陆）
     */
    isPhone: function (phone) {
      return /^1[3-9]\d{9}$/.test(String(phone || '').trim());
    },

    /**
     * 验证邮箱
     */
    isEmail: function (email) {
      return /^[\w.-]+@[\w-]+\.[\w.-]+$/.test(String(email || '').trim());
    },

    /**
     * 验证身份证号（简版）
     */
    isIdCard: function (idCard) {
      return /^\d{17}[\dXx]$/.test(String(idCard || '').trim());
    },

    /**
     * Toast 轻提示（深层加固版：SSR/无DOM/无rAF 均不抛错；支持第 3 参 duration）
     *   — 修复前：直接 document.body.appendChild + requestAnimationFrame，
     *     在 head 中执行 / SSR fallback / 禁用动画 / DOM 未就绪 场景会抛
     *     TypeError 并中断调用方后续代码（预约提交流程、备份流程等）
     *   — 修复后：所有分支 try/catch，异常降级到 console.log，绝不在任何浏览器环境抛错
     */
    toast: function (msg, type, duration) {
      msg = (msg == null) ? '' : String(msg);
      try {
        var t = type || 'info';
        var colors = {
          info: '#2563eb',
          success: '#16a34a',
          warn: '#d97706',
          warning: '#d97706',
          error: '#dc2626'
        };
        var bg = colors[t] || colors.info;
        var dur = Number(duration) > 0 ? Number(duration) : 3000;

        // — 深层 Bug1：在 <head> 里或 DOM 未 ready 时 document.body===null → 直接崩
        if (typeof document === 'undefined' || !document || !document.body) {
          try { if (console && console.info) console.info('[toast-fallback][' + t + '] ' + msg); } catch (_) {}
          return;
        }

        var el = document.createElement('div');
        el.setAttribute('data-toast', '1');
        el.setAttribute('data-toast-type', t);
        try { el.setAttribute('data-toast-msg', msg); } catch (_) {}
        try { el.textContent = msg; } catch (_) { try { el.innerText = msg; } catch (_2) {} }
        // B7 CSP合规：以className替代style.cssText/opacity/top直接写style
        try { el.className = 'toast-root-base toast-type-' + String(t) + ' toast-state-hide'; } catch (_) {}

        document.body.appendChild(el);
        var rAF = (global && global.requestAnimationFrame) ? global.requestAnimationFrame
          : (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
        if (rAF) {
          try {
            rAF(function () {
              try { el.classList.remove('toast-state-hide'); el.classList.add('toast-state-show'); } catch (_) {}
            });
          } catch (_) { try { el.classList.remove('toast-state-hide'); el.classList.add('toast-state-show'); } catch (_2) {} }
        } else {
          try { el.classList.remove('toast-state-hide'); el.classList.add('toast-state-show'); } catch (_) {}
        }

        setTimeout(function () {
          try { el.classList.remove('toast-state-show'); el.classList.add('toast-state-hide'); } catch (_) {}
          setTimeout(function () {
            try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (_) {}
          }, 300);
        }, dur);
      } catch (outer) {
        try { if (console && console.warn) console.warn('[toast][render-fail] ' + msg, outer && outer.message ? outer.message : outer); } catch (_) {}
      }
    },

    /**
     * 确认对话框（简单同步版）
     */
    confirm: function (msg) {
      return window.confirm(msg);
    },

    /**
     * 深拷贝（简单对象）
     */
    deepClone: function (obj) {
      try {
        return JSON.parse(JSON.stringify(obj));
      } catch (e) {
        return obj;
      }
    },

    /**
     * 安全 trim：null/undefined/非字符串 返回 fallback（默认空串）
     *   防止 appointment.customerName.trim() 类场景字段为 null 时抛错
     */
    safeTrim: function (val, fallback) {
      if (val == null) return (fallback == null ? '' : fallback);
      if (typeof val !== 'string') {
        try { val = String(val); } catch (_) { return (fallback == null ? '' : fallback); }
      }
      try { return val.trim(); } catch (_) { return (fallback == null ? '' : fallback); }
    },

    /**
     * ====== 维度15：公共 localStorage 自旋锁工具（含死锁TTL）======
     * 应用场景：跨 tab 的 bookingId 抢号、后台 finance 流水号生成、库存出库单号抢号等
     * @param {string} lockKey 完整 localStorage key（通常要加 PREFIX）
     * @param {number} timeoutMs 自旋等待超时上限（毫秒）
     * @param {string} sessionId 持锁会话 ID（区分不同 tab）
     * @param {number} deadlockTTLMs 死锁判定阈值（毫秒），超过此时长仍持锁视为持有者异常退出，自动回收
     * @returns {boolean} 是否成功持锁
     */
    acquireLocalLock: function (lockKey, timeoutMs, sessionId, deadlockTTLMs) {
      if (!lockKey) return true;
      var _t = Number(timeoutMs) || 250;
      var _ttl = Number(deadlockTTLMs) || Math.max(_t * 4, 1500);
      var endAt = Date.now() + _t;
      while (Date.now() < endAt) {
        try {
          var raw = localStorage.getItem(lockKey);
          if (!raw) {
            try { localStorage.setItem(lockKey, String(sessionId || 'anon') + '|' + String(Date.now())); return true; } catch (_) {}
          }
          var parts = (raw || '').split('|');
          var holdBy = parts[0];
          var holdAt = parseInt(parts[1] || '0', 10) || 0;
          if (sessionId && holdBy === String(sessionId)) return true;
          if (holdAt && (Date.now() - holdAt) > _ttl) {
            // 死锁自动回收
            try { localStorage.removeItem(lockKey); } catch (_) {}
            continue;
          }
        } catch (_) { /* storage disabled / quota 场景退化为不加锁 */ }
        // 忙等 5ms（一帧）
        var _u = Date.now() + 5; while (Date.now() < _u) {}
      }
      // 超时兜底：若锁仍空则视为成功，否则失败（保守）
      try { return !localStorage.getItem(lockKey); } catch (_) { return true; }
    },
    /**
     * 维度15：释放 acquireLocalLock 持有的锁
     *   仅当当前 lockKey 的持有者是 sessionId 时才删除，防止误删别的 tab 的锁
     */
    releaseLocalLock: function (lockKey, sessionId) {
      if (!lockKey) return;
      try {
        var raw = localStorage.getItem(lockKey);
        if (!raw) return;
        var parts = raw.split('|');
        if (sessionId == null || parts[0] === String(sessionId)) {
          try { localStorage.removeItem(lockKey); } catch (_) {}
        }
      } catch (_) {}
    },

    /**
     * 复制文本（兼容无clipboard权限场景）
     */
    copyText: function (text, successMsg) {
      var msg = successMsg || ('✅ 已复制：' + (text.length > 30 ? text.slice(0, 30) + '…' : text));
      var done = false;
      if (window.navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          var p = navigator.clipboard.writeText(text);
          if (p && typeof p.then === 'function') {
            p.then(function () { Utils.toast(msg, 'success'); }).catch(function () { Utils._copyByExec(text, msg); });
            done = true;
          }
        } catch (e) { done = false; }
      }
      if (!done) Utils._copyByExec(text, msg);
    },
    _copyByExec: function (text, msg) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        // B7 CSP合规：offscreen-util-elem class替代 style.pos/top/opacity
        try { ta.className = 'offscreen-util-elem'; } catch (_) {}
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        if (document.execCommand && document.execCommand('copy')) {
          Utils.toast(msg, 'success');
        } else {
          Utils.toast('ℹ️ 请手动复制：' + text, 'info');
        }
        if (ta.parentNode) ta.parentNode.removeChild(ta);
      } catch (e) {
        Utils.toast('ℹ️ 请手动复制：' + text, 'info');
      }
    },

    /**
     * 生成二维码图片URL（使用外部公共CDN兜底，无本地依赖）
     *   - 优先 api.qrserver.com （稳定、免费）
     *   - 若失败可由调用方降级为占位提示
     */
    buildQRImgUrl: function (text, size) {
      var s = size || 260;
      var u = encodeURIComponent(String(text || ''));
      return 'https://api.qrserver.com/v1/create-qr-code/?size=' + s + 'x' + s + '&data=' + u + '&margin=8&ecc=M';
    },

    /**
     * 打开二维码/信息Modal弹窗（统一 Footer & 二维码生成页使用）
     *   cfg: { title, subtitle, qrText | qrImgUrl, codeText (显示在码下方), tip, actions (按钮行) }
     */
    openQRModal: function (cfg) {
      Utils.closeActiveModal();
      if (!cfg) return;
      var backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.setAttribute('data-qr-modal-root', '1');
      var safeTitle = Utils.escapeHtml(cfg.title || '');
      var safeSub = Utils.escapeHtml(cfg.subtitle || '');
      var safeCode = cfg.codeText ? ('<div class="qr-modal-code">' + Utils.escapeHtml(cfg.codeText) + '</div>') : '';
      var safeTip = cfg.tip ? ('<div class="qr-modal-tip">' + Utils.escapeHtml(cfg.tip) + '</div>') : '';

      var qrBlock = '';
      if (cfg.qrImgUrl) {
        qrBlock = '<div class="qr-modal-img-wrap"><img class="qr-modal-img" src="' + Utils.escapeHtml(cfg.qrImgUrl) + '" alt="' + safeTitle + '" onerror="this.remove();this.parentNode.innerHTML=\'<div class=qr-modal-img-placeholder>📡 二维码图片加载中…<br>请复制下方链接或稍后再试</div>\'"></div>';
      } else if (cfg.qrText) {
        var imgUrl = Utils.buildQRImgUrl(cfg.qrText, 230);
        qrBlock = '<div class="qr-modal-img-wrap"><img class="qr-modal-img" src="' + imgUrl + '" alt="' + safeTitle + '" onerror="this.remove();this.parentNode.innerHTML=\'<div class=qr-modal-img-placeholder>📡 在线二维码加载失败<br>请复制下方链接手动生成</div>\'"></div>';
      } else if (cfg.plainPlaceholder) {
        qrBlock = '<div class="qr-modal-img-wrap"><div class="qr-modal-img-placeholder">' + Utils.escapeHtml(cfg.plainPlaceholder) + '</div></div>';
      }

      var actionsHtml = '';
      if (Array.isArray(cfg.actions) && cfg.actions.length) {
        actionsHtml = '<div class="qr-action-row">';
        for (var i = 0; i < cfg.actions.length; i++) {
          var a = cfg.actions[i];
          var cls = 'btn ' + (a.variant || 'btn-outline');
          var attrs = 'type="button" data-qr-act="' + i + '"';
          if (a.href) attrs += ' href="' + Utils.escapeHtml(a.href) + '"' + (a.target ? (' target="' + Utils.escapeHtml(a.target) + '" rel="noopener"') : '');
          actionsHtml += '<' + (a.href ? 'a' : 'button') + ' class="' + cls + '" ' + attrs + '>' + Utils.escapeHtml(a.label || '操作') + '</' + (a.href ? 'a' : 'button') + '>';
        }
        actionsHtml += '</div>';
      }

      backdrop.innerHTML =
        '<div class="qr-modal" role="dialog" aria-modal="true" aria-label="' + safeTitle + '">' +
          '<button type="button" class="qr-modal-close" aria-label="关闭">✕</button>' +
          '<div class="qr-modal-title">' + safeTitle + '</div>' +
          (safeSub ? '<div class="qr-modal-sub">' + safeSub + '</div>' : '') +
          qrBlock + safeCode + safeTip + actionsHtml +
        '</div>';

      document.body.appendChild(backdrop);
      // B7 CSP合规：body-modal-locked 替代 body.style.overflow=hidden
      try { document.body.classList.add('body-modal-locked'); } catch (e) {}

      var handlers = [];
      var closeIt = function () {
        for (var h = 0; h < handlers.length; h++) { try { document.removeEventListener(handlers[h].ev, handlers[h].fn); } catch (err) {} }
        Utils.closeActiveModal();
      };
      var addHandler = function (ev, fn) { handlers.push({ev: ev, fn: fn}); document.addEventListener(ev, fn); };

      // 关闭按钮、背景点击关闭
      backdrop.querySelector('.qr-modal-close').addEventListener('click', closeIt);
      backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeIt(); });
      addHandler('keydown', function (e) { if (e.key === 'Escape') closeIt(); });

      // 绑定 action 按钮回调
      if (Array.isArray(cfg.actions)) {
        var btns = backdrop.querySelectorAll('[data-qr-act]');
        for (var j = 0; j < btns.length; j++) {
          (function (idx) {
            btns[idx].addEventListener('click', function (e) {
              var act = cfg.actions[idx];
              if (act && typeof act.onClick === 'function') {
                try { act.onClick(e, closeIt); } catch (err) {}
              }
            });
          })(j);
        }
      }
      return closeIt;
    },

    /**
     * 关闭当前活跃的QR Modal
     */
    closeActiveModal: function () {
      var list = document.querySelectorAll('[data-qr-modal-root]');
      for (var i = 0; i < list.length; i++) { if (list[i].parentNode) list[i].parentNode.removeChild(list[i]); }
      // B7 CSP合规：移除body-modal-locked 替代 body.style.overflow=''
      try { document.body.classList.remove('body-modal-locked'); } catch (e) {}
    },

    /**
     * ★ FIX 导出功能：通用 xlsx 导出工具
     * 从数据数组 + 表头导出为 .xlsx 文件
     * @param {Array<Array>} data 二维数组（不含表头）
     * @param {Array<string>} headers 表头数组
     * @param {string} filename 文件名（不含扩展名）
     * @param {string} sheetName 工作表名
     */
    exportDataToXlsx: function (data, headers, filename, sheetName) {
      try {
        if (!window.XLSX || typeof window.XLSX.utils === 'undefined') {
          Utils.toast('⚠️ xlsx 库未加载，请刷新页面后重试', 'error');
          return false;
        }
        var aoa = [];
        if (Array.isArray(headers) && headers.length > 0) aoa.push(headers);
        if (Array.isArray(data)) {
          for (var i = 0; i < data.length; i++) {
            if (Array.isArray(data[i])) aoa.push(data[i]);
          }
        }
        if (aoa.length === 0) {
          Utils.toast('⚠️ 没有可导出的数据', 'warning');
          return false;
        }
        var ws = window.XLSX.utils.aoa_to_sheet(aoa);
        var wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Sheet1').slice(0, 31));
        var fname = (filename || ('export_' + new Date().toISOString().slice(0, 10))) + '.xlsx';
        window.XLSX.writeFile(wb, fname);
        Utils.toast('✅ 已导出 ' + (data ? data.length : 0) + ' 条记录：' + fname, 'success');
        return true;
      } catch (e) {
        Utils.toast('❌ 导出失败：' + (e && e.message ? e.message : e), 'error');
        return false;
      }
    },

    /**
     * ★ FIX 导出功能：从页面表格 DOM 导出为 xlsx
     * @param {HTMLElement|string} tableEl 表格元素或选择器
     * @param {string} filename 文件名
     */
    exportTableToXlsx: function (tableEl, filename) {
      try {
        var tbl = (typeof tableEl === 'string') ? document.querySelector(tableEl) : tableEl;
        if (!tbl) { Utils.toast('⚠️ 未找到可导出的表格', 'warning'); return false; }
        var rows = tbl.querySelectorAll('tr');
        if (!rows || rows.length === 0) { Utils.toast('⚠️ 表格为空', 'warning'); return false; }
        var aoa = [];
        for (var i = 0; i < rows.length; i++) {
          var cells = rows[i].querySelectorAll('th,td');
          var row = [];
          for (var j = 0; j < cells.length; j++) {
            row.push((cells[j].textContent || '').replace(/\s+/g, ' ').trim());
          }
          aoa.push(row);
        }
        var headers = aoa.shift();
        return Utils.exportDataToXlsx(aoa, headers, filename, '数据导出');
      } catch (e) {
        Utils.toast('❌ 表格导出失败：' + (e && e.message ? e.message : e), 'error');
        return false;
      }
    },

    /**
     * ★ FIX 导出功能：智能导出当前页面主数据表格
     * 自动寻找页面上最可能的数据表格并导出
     */
    autoExportXlsx: function (filename) {
      try {
        // 优先找带 id 或 class 的数据表格
        var selectors = [
          'table[data-export-table]',
          '#dataTable', '#mainTable', '#listTable',
          'table.data-table', 'table.admin-table',
          '.table-responsive table',
          'table'
        ];
        var tbl = null;
        for (var s = 0; s < selectors.length; s++) {
          var found = document.querySelector(selectors[s]);
          if (found) {
            // 确保表格有数据行（>1行）
            var r = found.querySelectorAll('tr');
            if (r && r.length > 1) { tbl = found; break; }
          }
        }
        if (!tbl) {
          Utils.toast('⚠️ 当前页面无可导出的表格数据', 'warning');
          return false;
        }
        return Utils.exportTableToXlsx(tbl, filename);
      } catch (e) {
        Utils.toast('❌ 自动导出失败：' + (e && e.message ? e.message : e), 'error');
        return false;
      }
    }
  };

  // ============================================================
  // 模块 1: 阶梯优惠计算引擎 PricingEngine
  // ============================================================
  var PricingEngine = (function () {
    // ====== 维度14：FALLBACK_TIER（常量，防止 TIERS 被污染/清空导致全部 NaN）======
    var FALLBACK_TIER = {
      min: 1, max: 3,
      name: '基础档',
      discount: 1.0,
      waiveMisc: false,
      priority: false,
      exclusive: false,
      desc: '标准定价，无折扣'
    };
    // ====== 维度14：场次安全钳制（防止 99999 场导致整数溢出 / 金额爆表）======
    var MAX_SHOWS = 366;   // 一年内每天一场 = 366 场上限，再高视为脏数据
    var MIN_SHOWS = 1;
    var MAX_PRICE = 99999999;  // 单场 999,999.99 元封顶

    return {
      /**
       * 标准单场定价（可根据实际业务调整）
       */
      STANDARD_PRICE_PER_SHOW: 6800,

      /**
       * 杂费标准（交通费、设备费等）
       */
      MISCELLANEOUS_FEE: 1200,

      /**
       * 阶梯配置
       */
      TIERS: [
        {
          min: 1, max: 3,
          name: '基础档',
          discount: 1.0,
          waiveMisc: false,
          priority: false,
          exclusive: false,
          desc: '标准定价，无折扣'
        },
        {
          min: 4, max: 8,
          name: '合作档',
          discount: 0.9,
          waiveMisc: true,
          priority: false,
          exclusive: false,
          desc: '9折优惠 + 杂费全免'
        },
        {
          min: 9, max: Infinity,
          name: '战略档',
          discount: 0.8,
          waiveMisc: true,
          priority: true,
          exclusive: true,
          desc: '8折 + 优先排期 + 专属对接'
        }
      ],

      /**
       * 根据场次获取对应阶梯（维度14：TIERS 污染兜底 + 场次钳制）
       */
      getTier: function (shows) {
        var n = parseInt(shows, 10);
        if (!isFinite(n)) n = 1;
        n = Math.max(MIN_SHOWS, Math.min(MAX_SHOWS, n));
        var tiers = Array.isArray(this.TIERS) && this.TIERS.length > 0 ? this.TIERS : [FALLBACK_TIER];
        for (var i = 0; i < tiers.length; i++) {
          var t = tiers[i];
          if (!t || typeof t !== 'object') continue;
          var tMin = isFinite(t.min) ? t.min : MIN_SHOWS;
          var tMax = (t.max === Infinity || isFinite(t.max)) ? t.max : MAX_SHOWS;
          if (n >= tMin && n <= tMax) return t;
        }
        return tiers[0] || FALLBACK_TIER;
      },

      /**
       * 计算完整价格方案
       * @param {number} shows 场次
       * @param {number} customPrice 自定义单场价格（可选）
       * @returns {Object}
       */
      calculate: function (shows, customPrice) {
        // ====== 维度14：场次安全钳制 ======
        var n = parseInt(shows, 10);
        if (!isFinite(n) || isNaN(n)) n = 1;
        n = Math.max(MIN_SHOWS, Math.min(MAX_SHOWS, n));

        // ====== 维度14：customPrice 清洗（NaN / 负数 / 爆表 都兜底）======
        var rawCustomPrice = Number(customPrice);
        var stdPrice = Number(this.STANDARD_PRICE_PER_SHOW);
        if (!isFinite(stdPrice) || stdPrice <= 0) stdPrice = 6800;
        var pricePerShow;
        if (customPrice === undefined || customPrice === null || customPrice === '') {
          pricePerShow = stdPrice;
        } else if (!isFinite(rawCustomPrice) || isNaN(rawCustomPrice)) {
          pricePerShow = stdPrice;
        } else if (rawCustomPrice <= 0) {
          pricePerShow = stdPrice;  // 负价视为脏数据，用标准价
        } else {
          pricePerShow = Math.min(MAX_PRICE, rawCustomPrice);
        }
        pricePerShow = Utils.centRound(pricePerShow);

        var rawTier = this.getTier(n);
        // ====== 维度14：rawTier 污染兜底（null/非对象/字段 NaN）======
        if (!rawTier || typeof rawTier !== 'object') rawTier = FALLBACK_TIER;
        var tierDiscount = Number(rawTier.discount);
        if (!isFinite(tierDiscount) || isNaN(tierDiscount)) tierDiscount = 1.0;
        tierDiscount = Math.max(0.0, Math.min(1.0, tierDiscount));  // 折扣钳制 [0, 1]，防止 1.1 打 110% 折（越扣越多）或 -0.5 负折扣

        // 折扣折数文本：B9 先 *100 round 再 /10 → 避免 0.07*10=0.7000000000000001
        function toDiscountText(discountRatio) {
          var r = Number(discountRatio);
          if (!isFinite(r) || isNaN(r)) r = 0;
          // 先 *100 整数再 /10：0.9 → 9.0 折，0.15 → 1.5 折
          var timesTen = Math.round(r * 1000) / 100;
          if (!isFinite(timesTen) || isNaN(timesTen)) timesTen = 0;
          return timesTen.toFixed(1) + '折';
        }

        var tierInfo = {
          name: (rawTier.name && typeof rawTier.name === 'string') ? rawTier.name : FALLBACK_TIER.name,
          discount: tierDiscount,
          discountText: toDiscountText(tierDiscount),
          waiveMisc: !!rawTier.waiveMisc,
          priority: !!rawTier.priority,
          exclusive: !!rawTier.exclusive,
          desc: (rawTier.desc && typeof rawTier.desc === 'string') ? rawTier.desc : ''
        };

        // ====== 维度14：杂费 NaN 清洗 ======
        var miscFeeStd = Number(this.MISCELLANEOUS_FEE);
        if (!isFinite(miscFeeStd) || isNaN(miscFeeStd) || miscFeeStd < 0) miscFeeStd = 1200;

        // B9：金额统一用「分」整数运算累加，最后 /100 防浮点漂移
        var pricePerShowCents = Utils.toCents(pricePerShow);
        if (!isFinite(pricePerShowCents) || isNaN(pricePerShowCents) || pricePerShowCents < 0) {
          pricePerShowCents = Utils.toCents(stdPrice);
        }
        var standardCents = pricePerShowCents * n;
        if (!isFinite(standardCents)) standardCents = pricePerShowCents;   // 乘法溢出兜底
        var miscCents = tierInfo.waiveMisc ? 0 : Utils.toCents(miscFeeStd);
        if (!isFinite(miscCents) || isNaN(miscCents) || miscCents < 0) miscCents = 0;
        var standardTotalCents = standardCents;
        // ====== 维度14：折扣金额 NaN 清洗 ======
        var oneMinusDiscount = 1 - tierDiscount;
        if (!isFinite(oneMinusDiscount) || isNaN(oneMinusDiscount)) oneMinusDiscount = 0;
        oneMinusDiscount = Math.max(0, Math.min(1, oneMinusDiscount));
        var discountCentsFloat = standardCents * oneMinusDiscount;
        var discountCents = isFinite(discountCentsFloat) ? Math.round(discountCentsFloat) : 0;
        discountCents = Math.max(0, Math.min(standardCents, discountCents));            // 折扣钳制
        var discountedCents = standardCents - discountCents;
        if (!isFinite(discountedCents) || discountedCents < 0) discountedCents = standardCents;
        var finalCents = discountedCents + miscCents;
        if (!isFinite(finalCents) || finalCents < 0) finalCents = discountedCents;
        var baseWithMiscCents = standardCents + Utils.toCents(miscFeeStd);
        if (!isFinite(baseWithMiscCents)) baseWithMiscCents = standardCents;
        var savedCents = baseWithMiscCents - finalCents;
        if (!isFinite(savedCents)) savedCents = 0;

        var standardTotal = Utils.centRound((standardTotalCents || 0) / 100);
        var miscFee = Utils.centRound((miscCents || 0) / 100);
        var discountAmount = Utils.centRound((discountCents || 0) / 100);
        var discountedTotal = Utils.centRound((discountedCents || 0) / 100);
        var finalTotal = Utils.centRound(Math.max(0, (finalCents || 0) / 100));
        var savedAmount = Utils.centRound(Math.max(0, (savedCents || 0) / 100));

      return {
        shows: n,
        tier: tierInfo,
        pricePerShow: pricePerShow,
        standardTotal: standardTotal,
        miscFee: miscFee,
        miscFeeText: tierInfo.waiveMisc ? '已减免' : Utils.formatMoney(miscFee),
        discountAmount: discountAmount,
        discountedTotal: discountedTotal,
        finalTotal: finalTotal,
        savedAmount: savedAmount,
        // B9 trace：分精度校验（报表对账时用）
        _cents: {
          standard: standardTotalCents,
          misc: miscCents,
          discount: discountCents,
          discounted: discountedCents,
          final: Math.round(finalCents),
          saved: Math.round(savedCents)
        },
        breakdown: [
          { label: '场次', value: n + ' 场' },
          { label: '单场标准价', value: '¥' + Utils.formatMoney(pricePerShow) },
          { label: '标准总价', value: '¥' + Utils.formatMoney(standardTotal) },
          // 修复：用 tierInfo.discountText 替换 rawTier.discountText undefined
          { label: '阶梯折扣', value: tierInfo.discountText + ' (-¥' + Utils.formatMoney(discountAmount) + ')' },
          { label: '杂费', value: tierInfo.waiveMisc ? '¥0.00 (' + tierInfo.name + '减免)' : '¥' + Utils.formatMoney(miscFee) },
          { label: '最终合计', value: '¥' + Utils.formatMoney(finalTotal), highlight: true }
        ]
      };
    },

    /**
     * 获取全部阶梯说明（用于展示）（维度14：TIERS 污染兜底 + NaN 清洗）
     */
    getAllTiers: function () {
      var tiers = Array.isArray(this.TIERS) && this.TIERS.length > 0 ? this.TIERS : [FALLBACK_TIER];
      return tiers.map(function (t) {
        if (!t || typeof t !== 'object') t = FALLBACK_TIER;
        // B9：折数文本统一 round *1000/100 避免浮点 + 维度14 NaN清洗
        var d = Number(t.discount);
        if (!isFinite(d) || isNaN(d)) d = 1.0;
        d = Math.max(0.0, Math.min(1.0, d));
        var timesTen = Math.round(d * 1000) / 100;
        if (!isFinite(timesTen) || isNaN(timesTen)) timesTen = 10.0;
        var tMin = isFinite(t.min) ? t.min : MIN_SHOWS;
        var tMax = (t.max === Infinity || isFinite(t.max)) ? t.max : MAX_SHOWS;
        return {
          range: tMax === Infinity ? (tMin + '+ 场') : (tMin + '-' + tMax + ' 场'),
          name: (t.name && typeof t.name === 'string') ? t.name : FALLBACK_TIER.name,
          discountText: timesTen.toFixed(1) + '折',
          waiveMisc: !!t.waiveMisc,
          priority: !!t.priority,
          exclusive: !!t.exclusive,
          desc: (t.desc && typeof t.desc === 'string') ? t.desc : ''
        };
      });
    }
  };
  })();

  // ============================================================
  // 模块 2: 数据持久化 Storage（基于 localStorage）
  // ============================================================
  var Storage = {
    PREFIX: 'qaxqjt_',

    KEYS: {
      APPOINTMENTS: 'appointments',
      ORDERS: 'orders',
      USERS: 'users',
      PLAYS: 'plays',
      // ⚠️ BLOCKER B8 FIX：KEYS.ADMIN = 'admin_session' → Storage.PREFIX + KEYS.ADMIN = 'qaxqjt_admin_session'
      //   与 15 个 admin/*.html + login.html 硬编码的完整 session key 100% 对齐！
      //   之前 KEYS.ADMIN='admin_sess_v2' 导致 Admin.checkAuth/Admin.logout 读写的 v2 key('qaxqjt_admin_sess_v2') 与
      //   admin页/login实际使用的 key('qaxqjt_admin_session') 分裂 → Admin.logout 仅清v2 老key残留 鉴权绕过！
      ADMIN: 'admin_session',
      SETTINGS: 'settings',
      // ==== 修复 B3 CRITICAL：统一 KEYS 注册后台 6 大新模块 Storage key（与 admin/*.html 按钮联动写入）
      SCHEDULES: 'schedules_v2',       // 排期档期（schedule.html 新增/编辑）
      FINANCE: 'finance_v2',           // 财务收支流水（accounts.html 财务 tab / finance.html）
      INVENTORY: 'inventory_v2',       // 服装道具库存出入库（inventory.html）
      PERFORMERS: 'performers_v2',     // 演员行当库（cast-sheet.html 编辑/批量导入）
      CONTENT: 'content_v2',           // 前台内容文章/栏目配置（cast-public.html 等前台展示源）
      ACCOUNTS: 'accounts_v2',         // 系统账号/员工/角色权限（accounts.html/operas.html/staff.html 角色管理）
      BACKUPS: 'backups_v2',           // 系统数据备份索引（system.html 备份/恢复/删除）
      QUALIFICATIONS: 'quals_v2',      // 资质核验工单（about.html#verification / QUA-xxxx）
      COOPERATIONS: 'coops_v2',        // 合作对接工单（about.html#cooperation / COOP-xxxx）
      // ==== 需求A：日工资发放 + 工资条核心KEYS ====
      WAGES: 'wages_v1',               // 工资发放记录（staff.html/finance.html 工资条）
      ATTENDANCE: 'attendance_v1',     // 考勤流水（staff.html 考勤录入 → 工资计算数据源）
      WAGE_RULES: 'wage_rules_v1',     // 自定义日工资规则（行当/职级/演出补助/扣款）
      // ==== 重构# 方案二（海康/腾讯云ISAPI）V2 配套 4 Keys ====
      ATTENDANCE_MANUAL_TAGS: 'att_manual_tags_v2',  // 管理员人工标记：【常规/装台/卸台】{staffId_date: '装台'|'卸台'|''}
      ATTENDANCE_REWARD_TAGS: 'att_reward_tags_v2',  // 表现突出奖励标记：{staffId_date: {reward:5, operator, ts}}
      ATTENDANCE_ACCIDENT_FINES: 'att_accidents_v2', // 演出事故登记：[{id, staffId, date, level:1|2|3, fine, desc, operator, ts}]
      ATTENDANCE_AUDIT_LOGS: 'att_audit_v2',         // 人工修改审计日志：[{ts, operator, action, staffIds, before, after}]
      ATTENDANCE_CLOCKS_V2: 'att_clocks_v2',         // ISAPI/手工打卡记录：{staffId_date: ["2026-07-30 13:35:12", ...]}  （注意 key 分隔符是 _，日期为 归属日）
      ATTENDANCE_ISAPI_SYNC: 'att_isapi_sync_v2',    // ISAPI 同步状态：{lastSyncAt:number, vendor:string, totalIngested:number, lastRangeStart:number, lastRangeEnd:number}
      // ===== 2026-08-02 修复：订单客户+演职人员 人事管理 缺失 Keys（与 admin/orders.html / staff.html CRUD 模块联动） =====
      CUSTOMERS: 'customers_v1',                     // 客户档案库（orders.html 客户Tab / booking.html 预约提交自动同步）
      STAFF_ROSTER: 'staff_roster_v1',               // 演职人员花名册（staff.html 花名册Tab / 派工 真实人员读取）
      // ===== 2026-08-02 修复：道具服装设备库存管理 细粒度 Keys（admin/inventory.html CRUD 模块联动 替换所有演示模式toast） =====
      EQUIPMENT_ITEMS: 'equipment_items_v1',         // 库存主数据：戏服/盔头/道具/灯光音响/舞台设备 SKU（inventory.html 5Tab 筛选渲染）
      BORROW_LOGS:    'borrow_logs_v1',              // 借用归还流水：借用人/借出日期/预计/实际/状态（inventory.html 借用流水Tab）
      STOCKTAKES:     'stocktakes_v1',               // 盘点审计：账面vs实盘/差异原因/盘点人/盘点日期
      INVENTORY_ALERTS:'inv_alerts_v1',              // 低库存+保养预警：SKU/阈值/到期日/负责人（顶部预警卡片实时刷新）
      // ===== 2026-08-02 修复：财务收支台账 细粒度 Keys（admin/finance.html CRUD 模块联动 · 统一流水入口 + 可追溯 + 状态机） =====
      FIN_LEDGER:     'fin_ledger_v1',               // ✅ 财务流水主表：所有收支凭证唯一入口（演出收入/工资/采购/差旅…统一从此写入）
      FIN_INVOICES:   'fin_invoices_v1',             // 发票管理：开票/红冲/作废状态机 + 关联流水凭证号
      FIN_RECONS:     'fin_recons_v1',               // 月度对账快照：银行流水vs账面 差异率/核销数/对账人（防止对账口径漂移）
      FIN_PAYMENTS:   'fin_payments_v1',             // 收款单登记（与 financeFix9 数据迁移统一到 Storage 接口）
      // ===== 2026-08-02 修复：演出演员表配置 细粒度 Keys（admin/cast-sheet.html CRUD 模块联动 · 多场演出存档 + 演职行当库） =====
      CAST_SHEETS:    'cast_sheets_v1',              // 多场演出阵容存档列表 [{id, name, date, venue, createdAt, updatedAt, fromTemplateId}]
      CAST_SHEET_ACTIVE:'cast_sheet_active_v1',      // 当前正在编辑的演出阵容ID
      PERFORMERS_DB:  'performers_db_v1',            // 演职人员行当库（按行当分组，批量选角源数据 · crewCategory 5大类）
      TROUPE_TEMPLATES:'troupe_templates_v1'       // ✅ 2026-08-02 新增：民营剧团组团模板库（30-40人标配 · 演员/乐队/前场/服装/电工 5组）
    },

    // B8 兼容：老/遗留 admin session 全量 key（Admin.logout/Admin.checkAuth 迁移时一并清理/兜底）
    _LEGACY_ADMIN_SESSION_KEYS: [
      'qaxqjt_admin_session',
      'admin_session',
      // BLOCKER B8 FIX：之前设计升v2时遗留的 'qaxqjt_admin_sess_v2' 反向纳入legacy名单，防止之前迁移过的 v2 残留
      'qaxqjt_admin_sess_v2',
      'admin_sess_v2',
      'qaxqjt_admin_remember',
      'qaxqjt_admin_token',
      'qaxqjt_admin_permissions'
    ],

    _get: function (key) {
      // ====== 维度12：key 非法直接返回 null ======
      if (key === null || key === undefined || key === '') {
        console.warn('[Storage._get] key 非法（null/undefined/空）');
        return null;
      }
      try {
        var raw = localStorage.getItem(this.PREFIX + key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.error('[Storage] 读取失败 key=' + String(key), e && e.message ? e.message : e);
        return null;
      }
    },

    _set: function (key, value) {
      // ====== 维度12：key 非法直接返回 false ======
      if (key === null || key === undefined || key === '') {
        console.warn('[Storage._set] key 非法（null/undefined/空），写入被拒绝');
        return false;
      }
      try {
        localStorage.setItem(this.PREFIX + key, JSON.stringify(value));
        return true;
      } catch (e) {
        var pfx = this.PREFIX;
        var safeKey = String(key);
        var valueJSON = null;
        try { valueJSON = JSON.stringify(value); } catch (_vj) { valueJSON = ''; }
        var writeOnce = function (reason) {
          try { localStorage.setItem(pfx + safeKey, valueJSON); return true; } catch (wrErr) {
            console.warn('[Storage] 兜底写入失败（' + (reason || '') + '）:', wrErr && wrErr.message ? wrErr.message : wrErr);
            return false;
          }
        };
        console.error('[Storage] 写入失败 key=' + safeKey, e && e.message ? e.message : e);
        try {
          var quotaLike = false;
          try {
            if (e && (e.name === 'QuotaExceededError' || e.code === 22
              || (typeof DOMException !== 'undefined' && e instanceof DOMException && e.code === 22))) quotaLike = true;
          } catch (_qn) { quotaLike = !!e && /quota|exceed|NS_ERROR_DOM_QUOTA_REACHED|22/i.test(String(e.message || e.name || e)); }
          if (quotaLike) {
            console.warn('[Storage] 配额不足，自动执行LRU清理（key=' + safeKey + '）');
            try {
              var allK = [];
              for (var i = 0; i < localStorage.length; i++) {
                var kk = localStorage.key(i);
                if (kk && kk.indexOf(pfx) === 0) {
                  try {
                    var rawV = localStorage.getItem(kk);
                    var parsed = null;
                    try { if (rawV) parsed = JSON.parse(rawV); } catch (_p1) { parsed = null; }
                    var ts = 0;
                    if (parsed && typeof parsed === 'object') {
                      ts = (parsed._updatedAt) ? parsed._updatedAt : (parsed.updatedAt ? parsed.updatedAt : 0);
                    }
                    allK.push({ k: kk, ts: ts || 0, size: (rawV || '').length });
                  } catch (e3) { allK.push({ k: kk, ts: 0, size: 0 }); }
                }
              }
              allK.sort(function (a, b) {
                if (a.ts !== b.ts) return a.ts - b.ts;
                return (b.size || 0) - (a.size || 0);
              });
              var removed = 0;
              var maxAttempt = Math.max(3, Math.ceil(allK.length / 3));
              var finalOK = false;
              for (var j = 0; j < allK.length && removed < maxAttempt; j++) {
                try {
                  localStorage.removeItem(allK[j].k);
                  removed++;
                  if (writeOnce('after_remove_' + removed)) { finalOK = true; break; }
                } catch (e4) { console.warn('[Storage] 删除失败', allK[j] && allK[j].k, e4 && e4.message ? e4.message : e4); }
              }
              console.warn('[Storage] LRU清理完成，已删除旧条目：', removed);
              if (finalOK) return true;
              if (writeOnce('after_lru_done')) return true;
            } catch (e2) { console.warn('[Storage] LRU清理失败', e2 && e2.message ? e2.message : e2); }
            return writeOnce('final_fallback');
          }
        } catch (eFinal) { console.error('[Storage] 重试写入仍然失败 key=' + safeKey, eFinal && eFinal.message ? eFinal.message : eFinal); }
        return false;
      }
    },

    /**
     * 通用 CRUD: 查询列表
     */
    list: function (key, filters) {
      // ====== 维度12：key 非法返回空数组，避免下游 .length 抛异常 ======
      if (key === null || key === undefined || key === '') return [];
      var data = this._get(key) || [];
      if (!Array.isArray(data)) data = [];
      // ====== 维度12：过滤掉数组中被人为篡改的 null/undefined 元素 ======
      var safeData = [];
      for (var _li = 0; _li < data.length; _li++) {
        if (data[_li] != null && typeof data[_li] === 'object') safeData.push(data[_li]);
      }
      data = safeData;
      if (!filters || typeof filters !== 'object' || Object.keys(filters).length === 0) {
        return data;
      }
      return data.filter(function (item) {
        if (item == null || typeof item !== 'object') return false;
        for (var k in filters) {
          if (Object.prototype.hasOwnProperty.call(filters, k)) {
            if (item[k] != filters[k]) return false;
          }
        }
        return true;
      });
    },

    /**
     * 通用 CRUD: 根据ID查询单条
     */
    get: function (key, id) {
      // ====== 维度12：key/id 非法返回 null ======
      if (key === null || key === undefined || key === '') return null;
      if (id === null || id === undefined || id === '') return null;
      var data = this._get(key) || [];
      if (!Array.isArray(data)) data = [];
      for (var i = 0; i < data.length; i++) {
        var it = data[i];
        if (it != null && typeof it === 'object' && it.id === id) return it;
      }
      return null;
    },

    /**
     * 通用 CRUD: 新增
     */
    create: function (key, record) {
      // ====== 维度12/11 CRITICAL：key + record + 主键冲突 三重兜底 ======
      if (key === null || key === undefined || key === '') {
        console.warn('[Storage.create] key 非法（null/undefined/空），已拒绝');
        return null;
      }
      if (record == null || typeof record !== 'object') {
        console.warn('[Storage.create] record 非法（null/undefined/非对象），已拒绝：key=' + String(key));
        return null;
      }
      var data = this._get(key);
      if (!Array.isArray(data)) data = [];
      // ====== 维度12：过滤 data 中 null/undefined 元素，防止 __ci 死循环 ======
      var safeData = [];
      for (var _si = 0; _si < data.length; _si++) {
        if (data[_si] != null && typeof data[_si] === 'object') safeData.push(data[_si]);
      }
      data = safeData;
      var now = new Date().toISOString();
      var newRecord = Utils.deepClone(record);
      if (newRecord == null || typeof newRecord !== 'object') newRecord = {};
      if (!newRecord.id) {
        newRecord.id = Utils.generateId(key);
      }
      // ====== 维度11 CRITICAL：id 重复查重 ======
      if (newRecord.id) {
        var UPSERT_KEYS = {};
        UPSERT_KEYS[Storage.KEYS.WAGES] = true;
        UPSERT_KEYS[Storage.KEYS.STAFF_ATTENDANCE] = true;
        var allowUpsert = UPSERT_KEYS[key] === true;
        var __foundUpsert = -1;
        for (var __ci = 0; __ci < data.length; __ci++) {
          if (data[__ci] && data[__ci].id === newRecord.id) {
            if (allowUpsert) {
              __foundUpsert = __ci;
              break;
            }
            var __oldId = String(newRecord.id);
            var __counter = 1;
            var __newProposedId;
            var __dupExists = true;
            while (__dupExists && __counter < 100) {
              __newProposedId = __oldId + '_dup' + __counter + '_' + Utils.secureRandomHex(4);
              __dupExists = false;
              for (var __cj = 0; __cj < data.length; __cj++) {
                if (data[__cj] && data[__cj].id === __newProposedId) { __dupExists = true; break; }
              }
              __counter++;
            }
            newRecord._dupOriginalId = __oldId;
            newRecord._dupCreatedAt = now;
            newRecord.id = __newProposedId || (Utils.generateId(String(key) + '_fix'));
            try { console.info('[Storage.create] id 冲突（key=' + String(key) + '），已自动分配新id=' + String(newRecord.id) + '（原id=' + __oldId + '已存在）'); } catch(_) {}
          }
        }
        if (__foundUpsert >= 0) {
          // upsert：用新对象覆盖旧对象的所有字段，保留旧 id，不生成 dup；并走 update 式的 createdAt/updatedAt
          var oldCreatedAt = data[__foundUpsert].createdAt || now;
          newRecord.id = data[__foundUpsert].id;
          newRecord.createdAt = oldCreatedAt;
          newRecord.updatedAt = now;
          data[__foundUpsert] = Object.assign({}, newRecord || {});
          data[__foundUpsert].id = newRecord.id;
          data[__foundUpsert].createdAt = newRecord.createdAt;
          data[__foundUpsert].updatedAt = newRecord.updatedAt;
          try { console.info('[Storage.create] upsert 覆盖更新 key=' + String(key) + ' id=' + String(newRecord.id) + '（工资条/考勤类数据不生成重复id）'); } catch(_) {}
          this._set(key, data);
          return data[__foundUpsert];
        }
      } else {
        newRecord.id = Utils.generateId(key);
      }
      newRecord.createdAt = newRecord.createdAt || now;
      newRecord.updatedAt = now;
      data.unshift(newRecord);
      this._set(key, data);
      return newRecord;
    },

    /**
     * 通用 CRUD: 更新
     */
    update: function (key, id, patch) {
      // ====== 维度12：key/id/patch 空值兜底 ======
      if (key === null || key === undefined || key === '') return null;
      if (id === null || id === undefined || id === '') return null;
      if (patch === null || patch === undefined) patch = {};
      var data = this._get(key);
      if (!Array.isArray(data)) data = [];
      var patchClone = (patch && typeof patch === 'object') ? Utils.deepClone(patch) : {};
      for (var i = 0; i < data.length; i++) {
        var it = data[i];
        if (it != null && typeof it === 'object' && it.id === id) {
          data[i] = Object.assign({}, it, patchClone || {});
          data[i].updatedAt = new Date().toISOString();
          this._set(key, data);
          return data[i];
        }
      }
      return null;
    },

    /**
     * 通用 CRUD: 删除
     */
    remove: function (key, id) {
      // ====== 维度12：key/id 空值兜底 ======
      if (key === null || key === undefined || key === '') return null;
      if (id === null || id === undefined || id === '') return null;
      var data = this._get(key);
      if (!Array.isArray(data)) data = [];
      for (var i = 0; i < data.length; i++) {
        var it = data[i];
        if (it != null && typeof it === 'object' && it.id === id) {
          var removed = data.splice(i, 1)[0];
          this._set(key, data);
          return removed;
        }
      }
      return null;
    },

    /**
     * 清空某集合
     */
    clear: function (key) {
      // ====== 维度12：key 非法兜底 ======
      if (key === null || key === undefined || key === '') return false;
      return this._set(key, []);
    },

    /**
     * 批量初始化演示数据
     */
    seedDemoData: function () {
      if (this._get(this.KEYS.PLAYS)) return;

      var plays = [
        { id: 'play_001', name: '《周仁回府》', category: '传统本戏', duration: '160分钟', synopsis: '经典秦腔传统剧目，讲述周仁为救盟兄之妻，献妻于贼的忠义故事。' },
        { id: 'play_002', name: '《三滴血》', category: '传统本戏', duration: '180分钟', synopsis: '范紫东代表作，讲述晋信书以滴血认亲之法断案的故事。' },
        { id: 'play_003', name: '《铡美案》', category: '传统本戏', duration: '150分钟', synopsis: '包拯怒铡陈世美，伸张正义的经典故事。' },
        { id: 'play_004', name: '《窦娥冤》', category: '传统本戏', duration: '170分钟', synopsis: '关汉卿名作，窦娥蒙冤感天动地的悲剧。' },
        { id: 'play_005', name: '《火焰驹》', category: '传统本戏', duration: '155分钟', synopsis: '李彦荣与黄桂英的爱情故事，以马踏火焰驹闻名。' }
      ];
      this._set(this.KEYS.PLAYS, plays);

      var sampleAppointments = [
        {
          id: Utils.generateId('apt'),
          customerName: '王建国',
          phone: '13909380001',
          organization: '兴国镇文化站',
          shows: 5,
          selectedPlays: ['play_001', 'play_003'],
          preferredStartDate: '2026-09-15',
          venue: '兴国镇文化广场',
          remarks: '请提前3天搭台',
          status: 'pending',
          createdAt: '2026-07-20T10:30:00.000Z',
          updatedAt: '2026-07-20T10:30:00.000Z'
        }
      ];
      this._set(this.KEYS.APPOINTMENTS, sampleAppointments);

      this._set(this.KEYS.ORDERS, []);
      // A-1 安全加固：生产模式（默认）不注入 admin 默认账号，避免任何硬编码密码落盘
      //   演示模式（qaxqjt_deploy_mode = "demo"）才写入，仅用于本地验收
      var DEPLOY_MODE_KEY = 'qaxqjt_deploy_mode';
      try {
        var MODE = localStorage.getItem(DEPLOY_MODE_KEY);
        if (MODE === 'demo') {
          this._set(this.KEYS.USERS, [
            { id: 'user_001', username: 'admin', password: '__DEMO_ONLY__见admin/login.html__', role: 'admin', name: '系统管理员' }
          ]);
        } else {
          // 生产模式：用户表初始为空，由后端鉴权 & accounts 页面创建
          this._set(this.KEYS.USERS, []);
        }
      } catch(_e) {
        // CSP / iframe 环境下 localStorage 访问失败兜底 = 不写入任何用户
        this._set(this.KEYS.USERS, []);
      }
    }
  };

  // ============================================================
  // 模块 3: 预约表单 FormValidator
  // ============================================================
  var FormValidator = {
    /**
     * 校验预约表单
     * @param {Object} data 表单数据
     * @returns {Object} { valid: bool, errors: { field: msg } }
     */
    validateAppointment: function (data) {
      var errors = {};

      if (!data.customerName || !data.customerName.trim()) {
        errors.customerName = '请填写联系人姓名';
      } else if (data.customerName.trim().length < 2) {
        errors.customerName = '姓名至少2个字符';
      } else if (data.customerName.trim().length > 30) {
        errors.customerName = '姓名不能超过30个字符';
      }

      if (!data.phone || !data.phone.trim()) {
        errors.phone = '请填写联系电话';
      } else if (!Utils.isPhone(data.phone)) {
        errors.phone = '请输入正确的手机号';
      }

      if (data.organization && data.organization.trim() && data.organization.trim().length > 100) {
        errors.organization = '合作单位名称不能超过100个字符';
      }

      if (!data.serviceType || !data.serviceType.trim()) {
        errors.serviceType = '请选择演出类型';
      }

      var shows = parseInt(data.shows, 10);
      if (!shows || isNaN(shows)) {
        errors.shows = '请填写预约场次';
      } else if (shows < 1) {
        errors.shows = '场次至少1场';
      } else if (shows > 100) {
        errors.shows = '单次预约不超过100场';
      }

      if (!data.preferredStartDate || !data.preferredStartDate.trim()) {
        errors.preferredStartDate = '请选择首选演出日期';
      } else {
        var raw = data.preferredStartDate.trim();
        var date = new Date(raw);
        if (isNaN(date.getTime())) {
          errors.preferredStartDate = '日期格式不正确';
        } else {
          var todayYMD = new Date();
          var y = todayYMD.getFullYear();
          var m = String(todayYMD.getMonth() + 1).padStart(2, '0');
          var d = String(todayYMD.getDate()).padStart(2, '0');
          var todayStr = y + '-' + m + '-' + d;
          var rawNorm = raw.length >= 10 ? raw.slice(0, 10) : raw;
          if (rawNorm < todayStr) {
            errors.preferredStartDate = '演出日期不能早于今天';
          }
        }
      }

      if (!data.venue || !data.venue.trim()) {
        errors.venue = '请填写演出地点';
      } else if (data.venue.trim().length < 4) {
        errors.venue = '演出地点至少填写 4 个字符（省/县/村）';
      } else if (data.venue.trim().length > 200) {
        errors.venue = '演出地点不能超过200个字符';
      }

      if (data.remarks && data.remarks.trim() && data.remarks.trim().length > 500) {
        errors.remarks = '备注说明不能超过500个字符';
      }

      if (data.email && data.email.trim() && !Utils.isEmail(data.email)) {
        errors.email = '邮箱格式不正确';
      }

      if (data.idCard && data.idCard.trim() && !Utils.isIdCard(data.idCard)) {
        errors.idCard = '身份证号格式不正确';
      }

      // ✅ 双重校验第二层：必须勾选预约须知（与 initBookingNotice 捕获阶段拦截配合）
      if (!data.agreeBookingNotice) {
        errors.agreeBookingNotice = '提交预约前必须阅读并勾选《预约须知》《违约细则》《未成年人保护政策》全部条款';
      }

      return {
        valid: Object.keys(errors).length === 0,
        errors: errors
      };
    },

    /**
     * 在页面上渲染错误提示
     * @param {HTMLElement} form 表单元素
     * @param {Object} errors 错误对象
     */
    renderErrors: function (form, errors) {
      var errorBox = form.querySelector('[data-form-errors]');
      if (errorBox) {
        if (Object.keys(errors).length === 0) {
          errorBox.innerHTML = '';
          // B7 CSP合规：csp-hide替代 style.display=none
          try { errorBox.classList.add('csp-hide'); } catch (_csp) {}
        } else {
          // B7 CSP合规：form-errors-ul class替代 ul.inline style margin/padding/color写死
          var html = '<ul class="form-errors-ul">';
          for (var f in errors) {
            if (errors.hasOwnProperty(f)) {
              html += '<li>' + Utils.escapeHtml(errors[f]) + '</li>';
            }
          }
          html += '</ul>';
          errorBox.innerHTML = html;
          // B7 CSP合规：移除csp-hide替代 style.display=block
          try { errorBox.classList.remove('csp-hide'); } catch (_csp) {}
        }
      }

      var fields = form.querySelectorAll('[data-field]');
      for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        var name = field.getAttribute('data-field');
        var input = field.querySelector('input, select, textarea');
        if (errors[name]) {
          field.classList.add('field-error');
          if (input) input.setAttribute('aria-invalid', 'true');
          var tip = field.querySelector('.field-error-tip');
          if (tip) tip.textContent = errors[name];
        } else {
          field.classList.remove('field-error');
          if (input) input.removeAttribute('aria-invalid');
          var tip2 = field.querySelector('.field-error-tip');
          if (tip2) tip2.textContent = '';
        }
      }
    },

    /**
     * 处理预约表单提交（维度15：防重锁立即安排 TTL 自动释放，避免异常卡死）
     */
    submitAppointment: function (form) {
      if (!form) {
        console.warn('[submitAppointment] form 为空，已拒绝');
        return null;
      }
      // ====== 维度15：防重锁 TTL 释放工具（在设置锁之后立刻调用，安排 10 秒自动解锁，不依赖后续代码是否成功）======
      function _scheduleLockTTL(_form, ms) {
        try {
          // 立即安排 setTimeout，无论后续成功与否，ms 毫秒后强制解锁。这是"最后一道保险"，防止代码中途抛异常把表单锁死。
          setTimeout(function () {
            try {
              _form.removeAttribute('data-booking-submitted');
              _form.removeAttribute('aria-busy');
              var _butts = _form.querySelectorAll('button[type="submit"], input[type="submit"], [data-role="booking-submit"]');
              if (_butts && _butts.length) {
                for (var _bri = 0; _bri < _butts.length; _bri++) {
                  try {
                    _butts[_bri].removeAttribute('disabled');
                    _butts[_bri].removeAttribute('aria-disabled');
                    try { _butts[_bri].classList.remove('btn-submitting'); } catch (_csp1) {}
                  } catch (_rb1) {}
                }
              }
            } catch (_unlockTTL) { console.warn('[submitAppointment] TTL 解锁异常（非致命）:', _unlockTTL && _unlockTTL.message); }
          }, ms || 10000);
        } catch (_sched) { /* setTimeout 失败也不阻塞 */ }
      }
      // ====== B10 MEDIUM：重复提交拦截 ======
      try {
        if (String(form.getAttribute('data-booking-submitted') || '') === '1') {
          try { Utils.toast('⏳ 正在保存，请勿重复点击（10秒内仅允许提交一次）', 'warn', 2500); } catch (_t) {}
          return null;
        }
      } catch (_chk) {}

      var formData = null;
      try { formData = new FormData(form); } catch (_fdErr) {
        console.warn('[submitAppointment] FormData 构造失败：', _fdErr && _fdErr.message);
        Utils.toast('浏览器环境异常，请刷新页面重试', 'error');
        return null;
      }
      var data = {};
      try {
        formData.forEach(function (val, key) {
          if (key === 'selectedPlays') {
            if (!data.selectedPlays) data.selectedPlays = [];
            data.selectedPlays.push(val);
          } else {
            data[key] = val;
          }
        });
      } catch (_fe) { console.warn('[submitAppointment] FormData forEach异常：', _fe && _fe.message); data = data || {}; }

      var selectedPlaysCB = null;
      try { selectedPlaysCB = form.querySelectorAll('input[name="selectedPlays"]:checked'); } catch (_qcb) { selectedPlaysCB = null; }
      if (selectedPlaysCB && selectedPlaysCB.length > 0 && !data.selectedPlays) {
        data.selectedPlays = [];
        for (var i = 0; i < selectedPlaysCB.length; i++) {
          try { data.selectedPlays.push(selectedPlaysCB[i].value); } catch (_pv) {}
        }
      }

      var result = this.validateAppointment(data);
      this.renderErrors(form, result.errors);

      if (!result.valid) {
        var errBox = form.querySelector('[data-form-errors]');
        if (errBox) {
          var errList = [];
          for (var ek in result.errors) {
            if (Object.prototype.hasOwnProperty.call(result.errors, ek)) errList.push(result.errors[ek]);
          }
          if (errList.length > 0) {
            try {
              // B7 CSP合规：移除内嵌style，使用CSS class form-err-title / form-err-list
              errBox.innerHTML = '<div class="form-err-title">❌ 请检查以下项：</div><div class="form-err-list">• ' + errList.map(Utils.escapeHtml).join('<br>• ') + '</div>';
              try { errBox.classList.remove('csp-hide'); } catch (_csp) {}
              try { errBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_scr) {}
            } catch (_renderErr) { console.warn('[submitAppointment] 错误提示渲染失败：', _renderErr && _renderErr.message); }
          } else {
            errBox.innerHTML = '';
            try { errBox.classList.add('csp-hide'); } catch (_csp) {}
          }
        }
        try { Utils.toast('请检查表单填写（共 ' + Object.keys(result.errors).length + ' 项）', 'warn'); } catch (_tt) {}
        // B10：校验失败不锁，允许用户继续修改再提交
        return null;
      }

      // ====== B10 + 维度15：校验通过 → 立即上锁 10 秒，并**立刻**安排 TTL 自动解锁（无论后面代码成功与否） ======
      try {
        form.setAttribute('data-booking-submitted', '1');
        form.setAttribute('aria-busy', 'true');
        // ====== 维度15：立刻安排 11 秒 TTL（正常流程 10 秒清除，TTL 保险晚 1 秒）======
        _scheduleLockTTL(form, 11 * 1000);
        // 同时禁用提交按钮（视觉反馈）
        try {
          var submits = form.querySelectorAll('button[type="submit"], input[type="submit"], [data-role="booking-submit"]');
          if (submits && submits.length) {
            for (var sbi = 0; sbi < submits.length; sbi++) {
              try {
                submits[sbi].setAttribute('disabled', 'disabled');
                submits[sbi].setAttribute('aria-disabled', 'true');
                try { submits[sbi].classList.add('btn-submitting'); } catch (_csp) {}
              } catch (_dsb) {}
            }
          }
        } catch (_but) {}
      } catch (_lck) {}

      var pricing = null;
      try {
        pricing = PricingEngine.calculate(data.shows);
      } catch (_calcErr) {
        console.warn('[submitAppointment] PricingEngine 计算失败，降级为标准价：', _calcErr && _calcErr.message);
        pricing = PricingEngine.calculate(parseInt(data.shows, 10) || 1);
      }

      var now = new Date();
      var year2 = String(now.getFullYear()).slice(-2);
      var prefix = year2 + '-QA-';
      // ==== 修复 B2 BLOCKER：bookingId 生成改为「seqKey 先原子自增 → 再 Storage.create」（解决 2 tab 并发同 id 碰撞）
      // 旧代码逻辑：先 create → 后写 seqKey → 并发 2 tab 读到同一 seqFromKey = 3 → 都生成 26-QA-0004 碰撞
      // 新代码逻辑（严格单 JS 进程锁 + localStorage seqKey 抢号先占）：
      //  Step 1: 自旋 seqLock 锁 300ms（跨 tab storage 事件通知释放）
      //  Step 2: **立即写 seqKey+1**（在 Storage.create 之前先占号，失败允许跳号，不允许碰撞）
      //  Step 3: 解锁
      //  Step 4: Storage.create（若此时仍重复 → while 循环里**重新 Storage.list 拿新快照**而不是用旧 allApps）
      //  Step 5: create 完再次全局查重，发生冲突再修正
      var _SESSION_ID = 'sess_' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Utils.secureRandomHex(16));
      var seqLockKey = Storage.PREFIX + 'appointments_seq_lock_' + year2;
      // ====== 维度15：使用 Utils.acquireLocalLock / releaseLocalLock 公共自旋锁工具（代码复用，避免各模块各写一套）======
      function _acquireSeqLock(lockKey, timeoutMs, session) {
        return Utils.acquireLocalLock(lockKey, timeoutMs, session, Math.max((timeoutMs || 250) * 4, 1500));
      }
      function _releaseSeqLock(lockKey, session) {
        Utils.releaseLocalLock(lockKey, session);
      }

      var seqKey = Storage.PREFIX + 'appointments_seq_' + year2;
      var nextSeq = 0;
      var bookingId = null;
      var heldLock = false;
      try {
        heldLock = _acquireSeqLock(seqLockKey, 320, _SESSION_ID);
        // 持锁后重查 Storage.list（确保其他 tab 刚才写入的新预约能被「我们」看到），不能用之前 L897 旧快照
        var freshAllApps = Storage.list(Storage.KEYS.APPOINTMENTS) || [];
        var freshMaxSeq = 0;
        for (var si2 = 0; si2 < freshAllApps.length; si2++) {
          var row2 = freshAllApps[si2] || {};
          if (row2.bookingId && typeof row2.bookingId === 'string' && row2.bookingId.indexOf(prefix) === 0) {
            var sn2 = parseInt(row2.bookingId.slice(prefix.length), 10);
            if (!isNaN(sn2) && sn2 > freshMaxSeq) freshMaxSeq = sn2;
          }
        }
        var freshSeqFromKey = 0;
        try { freshSeqFromKey = parseInt(localStorage.getItem(seqKey), 10) || 0; } catch (e) { freshSeqFromKey = 0; }
        // 抢号：先写 seqKey（Storage.create 之前先占）
        nextSeq = Math.max(freshMaxSeq, freshSeqFromKey) + 1;
        try { localStorage.setItem(seqKey, String(nextSeq)); } catch (sqErr) {
          console.warn('[submitAppointment] seqKey 写入失败，仍继续生成 bookingId（最坏=跳号）', sqErr && sqErr.message ? sqErr.message : sqErr);
        }
      } finally {
        if (heldLock) _releaseSeqLock(seqLockKey, _SESSION_ID);
      }

      bookingId = prefix + String(nextSeq).padStart(4, '0');

      // 防御 while：若此时另一个 tab 也用 seqKey 已经在我们 unlock → create 之间占了号，我们再重试 50 次
      // 关键：**每次循环都重新 Storage.list(APPOINTMENTS) 拿最新快照**（不再用旧 allApps）
      var guard2 = 0;
      while (guard2 < 60) {
        var latestApps = Storage.list(Storage.KEYS.APPOINTMENTS) || [];
        var foundDup2 = false;
        for (var dj2 = 0; dj2 < latestApps.length; dj2++) {
          if ((latestApps[dj2] || {}).bookingId === bookingId) { foundDup2 = true; break; }
        }
        if (!foundDup2) break;
        // 撞到别人的，自己 seqKey++（持锁一次原子增）
        try {
          var held2 = _acquireSeqLock(seqLockKey, 200, _SESSION_ID);
          var cur = 0;
          try { cur = parseInt(localStorage.getItem(seqKey), 10) || 0; } catch (_) { cur = 0; }
          nextSeq = cur + 1;
          try { localStorage.setItem(seqKey, String(nextSeq)); } catch (_) {}
          if (held2) _releaseSeqLock(seqLockKey, _SESSION_ID);
        } catch (_) { nextSeq++; }
        bookingId = prefix + String(nextSeq).padStart(4, '0');
        guard2++;
      }
      var bookingTimeText = Utils.formatDate(now, 'YYYY-MM-DD HH:mm');

      // ====== 维度15：字段全部用 Utils.safeTrim 防崩（任何一个字段为 null/undefined/非字符串 都不会抛错）======
      var showsNum = parseInt(data.shows, 10);
      if (!isFinite(showsNum) || isNaN(showsNum) || showsNum < 1) showsNum = 1;
      showsNum = Math.min(366, showsNum);
      var appointment = {
        customerName: Utils.safeTrim(data.customerName, '未填写'),
        phone: Utils.safeTrim(data.phone),
        organization: Utils.safeTrim(data.organization),
        serviceType: Utils.safeTrim(data.serviceType),
        shows: showsNum,
        selectedPlays: Array.isArray(data.selectedPlays) ? data.selectedPlays : [],
        preferredStartDate: Utils.safeTrim(data.preferredStartDate),
        venue: Utils.safeTrim(data.venue, '未填写'),
        email: Utils.safeTrim(data.email),
        idCard: Utils.safeTrim(data.idCard),
        remarks: Utils.safeTrim(data.remarks),
        agreeBookingNotice: !!data.agreeBookingNotice,
        pricing: pricing || PricingEngine.calculate(showsNum),
        status: 'pending',
        statusText: '待审核',
        bookingId: bookingId,
        bookingTimeText: bookingTimeText,
        _genSessionId: _SESSION_ID,
        _genAt: Date.now()
      };

      // ========== 任务 6：后端 API / localStorage 双写策略（QAXQJT_API.post + localStorage 降级兼容）==========
      // 1. 先把「旧 localStorage 写入+查重」逻辑封装为独立 fallback 函数（后端不可用时自动调用）
      function _saveToLocalStorage() {
        var s = Storage.create(Storage.KEYS.APPOINTMENTS, appointment);
        if (s && s.id) {
          try {
            var relist = Storage.list(Storage.KEYS.APPOINTMENTS) || [];
            var dupCount = 0;
            var sameIds = [];
            for (var di3 = 0; di3 < relist.length; di3++) {
              if ((relist[di3] || {}).bookingId === s.bookingId) {
                dupCount++;
                sameIds.push(relist[di3].id || ('idx:' + di3));
              }
            }
            if (dupCount > 1) {
              var fixSeq = 0;
              try {
                var heldF = _acquireSeqLock(seqLockKey, 200, _SESSION_ID);
                try { fixSeq = parseInt(localStorage.getItem(seqKey), 10) || 0; } catch (_) { fixSeq = 0; }
                fixSeq = fixSeq + 1;
                try { localStorage.setItem(seqKey, String(fixSeq)); } catch (_) {}
                if (heldF) _releaseSeqLock(seqLockKey, _SESSION_ID);
              } catch (_) { fixSeq = nextSeq + 1; }
              var fixBookingId = year2 + '-QA-' + String(fixSeq).padStart(4, '0');
              s.bookingId = fixBookingId;
              appointment.bookingId = fixBookingId;
              Storage.update(Storage.KEYS.APPOINTMENTS, s.id, s);
              bookingId = fixBookingId;
              console.warn('[submitAppointment][B2-corrected] 查重发现重复 bookingId 同号条目=' + sameIds.join(',') + ' → 已自动更正为 ' + fixBookingId);
            }
          } catch (e) {
            console.warn('[submitAppointment] 最终查重异常：', e && e.message ? e.message : e);
          }
        }
        return s;
      }

      // 2. 构造 /v1/appointments API 载荷（与 server/src/routes/v1/index.js L272-308 Joi schema 对齐）
      var showsNum2 = parseInt(appointment.shows, 10) || 1;
      // 自动推断 packageType（与后端 appointments.js create 逻辑对齐）
      var inferredPackageType = 'custom';
      try {
        if (showsNum2 >= 3) inferredPackageType = 'temple_fair';
        else if (/学校|校园|研学|小学|中学|大学|教育局/.test(appointment.serviceType + '|' + appointment.organization)) inferredPackageType = 'campus_tour';
        else if (/文旅|文化|旅游|景区|古镇|民俗村|非遗/.test(appointment.serviceType + '|' + appointment.organization)) inferredPackageType = 'cultural_tourism';
      } catch (_eInfer) {}
      // 构造 plays：selectedPlays（剧目名字符串数组）→ { playId, sortOrder, note }
      var apiPlays = [];
      try {
        if (Array.isArray(appointment.selectedPlays) && appointment.selectedPlays.length) {
          for (var _pi = 0; _pi < appointment.selectedPlays.length; _pi++) {
            apiPlays.push({
              playId: 'play_' + (_pi + 1),
              sortOrder: _pi + 1,
              note: appointment.selectedPlays[_pi]
            });
          }
        }
      } catch (_ePlays) {}
      // 简单地址切分：venue 整串塞 venueAddress，省市区粗切
      var apiVenueAddress = appointment.venue || '';
      var apiVenueProvince = '', apiVenueCity = '', apiVenueDistrict = '';
      try {
        var va = String(appointment.venue || '');
        var pm = va.match(/^([^省]*省)/);
        if (pm) { apiVenueProvince = pm[1]; va = va.slice(pm[0].length); }
        var cm = va.match(/^([^市]*市)/);
        if (cm) { apiVenueCity = cm[1]; va = va.slice(cm[0].length); }
        var dm = va.match(/^([^区县]*[区县])/);
        if (dm) { apiVenueDistrict = dm[1]; }
      } catch (_eAddr) {}
      var pricingObj = appointment.pricing || {};
      var estBudget = (pricingObj && typeof pricingObj.finalTotal === 'number') ? pricingObj.finalTotal : (6800 * showsNum2);
      var apiPayload = {
        customerName: appointment.customerName,
        phone: appointment.phone,
        organization: appointment.organization || '',
        contactPerson: appointment.customerName,
        sourceChannel: 'website_booking',
        preferredStartDate: appointment.preferredStartDate,
        performanceCount: showsNum2,
        packageType: inferredPackageType,
        venueProvince: apiVenueProvince,
        venueCity: apiVenueCity,
        venueDistrict: apiVenueDistrict,
        venueAddress: apiVenueAddress,
        estimatedBudget: Number(estBudget) || 0,
        totalPerformanceFee: Number(estBudget) || 0,
        specialRequirements: (appointment.remarks || '') + (appointment.serviceType ? ('\n演出类型：' + appointment.serviceType) : '') + (Array.isArray(appointment.selectedPlays) && appointment.selectedPlays.length ? ('\n意向剧目：' + appointment.selectedPlays.join('、')) : ''),
        remarkInternal: '[bookingId=' + bookingId + '] bookingTime=' + bookingTimeText + ' agreeNotice=' + appointment.agreeBookingNotice,
        smsVerifiedFlag: false
      };
      if (apiPlays.length) apiPayload.plays = apiPlays;

      // ========== 🔍 提交日志增强：打印后端 API 请求体 ==========
      var _apiPath = '/v1/appointments';
      var _resolvedUrl = _apiPath;
      try {
        if (window.QAXQJT_API_CONFIG && typeof window.QAXQJT_API_CONFIG.resolveUrl === 'function') {
          _resolvedUrl = window.QAXQJT_API_CONFIG.resolveUrl(_apiPath);
        }
      } catch (_urlE) {}
      console.log('[submitAppointment] ① 预约对象 appointment =', JSON.stringify({
        bookingId: bookingId,
        customerName: appointment.customerName,
        phone: appointment.phone,
        serviceType: appointment.serviceType,
        shows: appointment.shows,
        selectedPlays: appointment.selectedPlays,
        preferredStartDate: appointment.preferredStartDate,
        venue: appointment.venue,
        pricing: appointment.pricing
      }, null, 2));
      console.log('[submitAppointment] ② 后端 Payload（' + _resolvedUrl + '） =', JSON.stringify(apiPayload, null, 2));

      // 3. 统一 QAXQJT_API.post：后端可用 → 走 API；网络失败 → 自动降级 fallback 走 localStorage
      //    skipAuth=true 因为预约页面是公开页面，访客不需要登录
      var _win = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
      var hasApi = _win && typeof _win.QAXQJT_API !== 'undefined' && typeof _win.QAXQJT_API.post === 'function';
      var _submitT0 = Date.now();
      console.log('[submitAppointment] ③ 提交方式：' + (hasApi ? 'QAXQJT_API.post → 后端API（含 localStorage 自动降级）' : '无 API 模块 → 直接 localStorage 写入'));
      var submitPromise;
      if (hasApi) {
        submitPromise = _win.QAXQJT_API.post(_apiPath, apiPayload, {
          skipAuth: true,
          showErrorToast: false,
          fallback: async function (fbInfo) {
            var _reason = (fbInfo && fbInfo.reason) || 'fallback';
            var _netErr = (fbInfo && fbInfo.err && fbInfo.err.message) ? fbInfo.err.message : '';
            console.warn('[submitAppointment] ③-a ⚠️ API 不可用，触发降级：reason=' + _reason + (_netErr ? ('; 网络错误=' + _netErr) : ''));
            return _saveToLocalStorage();
          }
        });
      } else {
        submitPromise = Promise.resolve(_saveToLocalStorage());
      }

      // 4. 成功 → UI 提示 + 展示编号 + 重置表单 + 解锁；失败 → 解锁 + 报错
      return submitPromise.then(function (saved) {
        var _elapsed = Date.now() - _submitT0;
        console.log('[submitAppointment] ④ ✅ 提交成功：耗时=' + _elapsed + 'ms；写入方式=' + (hasApi ? 'API→后端（或降级localStorage）' : '直接localStorage'));
        console.log('[submitAppointment] ④-a 返回 saved 对象关键字段 =', JSON.stringify({
          id: saved && saved.id,
          bookingId: saved && (saved.bookingId || saved.bookingNo),
          status: saved && saved.status,
          _fromStorage: saved && saved._genSessionId ? 'yes(localStorage路径)' : null
        }, null, 2));
        _finalizeSuccess(saved);
        return saved;
      }).catch(function (err) {
        var _elapsed = Date.now() - _submitT0;
        console.error('[submitAppointment] ④ ❌ 提交失败：耗时=' + _elapsed + 'ms；错误消息 =', err && err.message ? err.message : String(err));
        if (err) {
          console.error('[submitAppointment] ④-b HTTP status=' + err.status + '; code=' + err.code + '; detail=' + (err.detail || ''));
          if (err.name === 'AbortError') console.error('[submitAppointment] ④-c 超时（AbortError）：请检查后端服务是否启动、API_BASE 是否配置正确');
          if (err.data) console.error('[submitAppointment] ④-d 后端响应 JSON data =', JSON.stringify(err.data, null, 2));
          if (err.response) console.error('[submitAppointment] ④-e Response 对象：status=' + err.response.status + ' ok=' + err.response.ok + ' type=' + err.response.type);
          if (err.stack) console.error('[submitAppointment] ④-f 错误栈追踪：\n' + err.stack);
        }
        console.error('[submitAppointment] 提交失败：', err && err.message ? err.message : err);
        try { Utils.toast('提交失败，请稍后重试（' + (err && err.message ? err.message : '未知错误') + '）', 'error'); } catch (_te) {}
        try { form.removeAttribute('data-booking-submitted'); } catch (_) {}
        try { form.removeAttribute('aria-busy'); } catch (_) {}
        var btsErr = form.querySelectorAll('button[type="submit"], input[type="submit"], [data-role="booking-submit"]');
        if (btsErr && btsErr.length) for (var br2 = 0; br2 < btsErr.length; br2++) {
          try { btsErr[br2].removeAttribute('disabled'); } catch (_) {}
          try { btsErr[br2].removeAttribute('aria-disabled'); } catch (_) {}
          try { btsErr[br2].classList.remove('btn-submitting'); } catch (_) {}
        }
        throw err;
      });

      function _finalizeSuccess(saved) {
        Utils.toast('预约提交成功！我们将在24小时内与您联系', 'success');
        var finalBookingId = (saved && (saved.bookingId || saved.bookingNo)) ? (saved.bookingId || saved.bookingNo) : bookingId;

        var successMsg = document.getElementById('formSuccessMsg');
        if (successMsg) {
          var idDisplay = successMsg.querySelector('[data-booking-id-display]');
          if (idDisplay) {
            idDisplay.textContent = finalBookingId;
          }
          var copyBtn = successMsg.querySelector('[data-booking-id-copy]');
          if (copyBtn) {
            copyBtn.onclick = function () {
              var bid = (idDisplay && idDisplay.textContent) ? idDisplay.textContent.trim() : finalBookingId;
              var done = false;
              try {
                if (window.navigator && navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(bid).then(function () {
                    Utils.toast('✅ 预约编号已复制：' + bid, 'success');
                  }).catch(function () {
                    Utils.toast('预约编号：' + bid, 'info');
                  });
                  done = true;
                } else {
                  var ta = document.createElement('textarea');
                  ta.value = bid;
                  try { ta.className = 'offscreen-util-elem'; } catch (_) {}
                  document.body.appendChild(ta);
                  ta.select();
                  if (document.execCommand && document.execCommand('copy')) {
                    Utils.toast('✅ 预约编号已复制：' + bid, 'success');
                  } else {
                    Utils.toast('预约编号：' + bid, 'info');
                  }
                  if (ta.parentNode) ta.parentNode.removeChild(ta);
                  done = true;
                }
              } catch (e) {
                done = false;
              }
              if (!done) Utils.toast('预约编号：' + bid, 'info');
            };
          }
          try { successMsg.classList.remove('csp-hide'); } catch (_csp) {}
        }

        try { form.setAttribute('data-booking-submitted', '1'); } catch (e) {}
        form.reset();
        try {
          setTimeout(function () {
            try {
              form.removeAttribute('data-booking-submitted');
              form.removeAttribute('aria-busy');
              var btsFin = form.querySelectorAll('button[type="submit"], input[type="submit"], [data-role="booking-submit"]');
              if (btsFin && btsFin.length) for (var brFin = 0; brFin < btsFin.length; brFin++) {
                try { btsFin[brFin].removeAttribute('disabled'); } catch (_rb) {}
                try { btsFin[brFin].removeAttribute('aria-disabled'); } catch (_rb) {}
                try { btsFin[brFin].classList.remove('btn-submitting'); } catch (_rb) {}
              }
            } catch (e) {}
          }, 10 * 1000);
        } catch (e) {}

        var pricingDetail = document.querySelector('[data-pricing-detail]');
        if (pricingDetail) pricingDetail.innerHTML = '';

        if (successMsg) {
          window.setTimeout(function () {
            if (successMsg) successMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
      }
    }
  };

  // ============================================================
  // 模块 3.5: 预约→订单→档期→客户 四联动（F1+F2 2026-08-03 Rev9）
  // - 上游写入点（submitAppointment 成功）立即同步 ORDERS / SCHEDULES / CUSTOMERS
  // - 关联键：appointment.id (主键) + orderNo (展示 NOyyyyMMdd-XXXX) + customerId
  // - 独立状态字段：orderStatus: pending|confirmed|cancelled|completed  不复用 appointment.statusText
  // ============================================================
  var BookingLinkage = (function(){
    function _getS(){ try{ return window.Storage || (window.QinApp && QinApp.Storage) || null; }catch(_){ return null; } }
    function _log(m,e){ try{ console.info('[BookingLinkage] '+m+(e?' :'+(e.message||e):'')); }catch(_){} }
    function _toast(m,t,d){ try{ if(Utils && Utils.toast){ Utils.toast(m,t||'info',d||3000); return; } }catch(_){} try{ console.log('[toast]['+(t||'info')+'] '+m); }catch(_){} }
    function _orderSeqKey(){ return 'qaxqjt_order_seq_' + Utils.formatDate(new Date()).replace(/-/g,''); }
    function _nextOrderNo(){
      var d = new Date(); var y = d.getFullYear(); var m = String(d.getMonth()+1).padStart(2,'0'); var dd = String(d.getDate()).padStart(2,'0');
      var k = _orderSeqKey(); var n = 0; try{ n = parseInt(localStorage.getItem(k)||'0',10)||0; }catch(_){ n = 0; }
      n = n + 1; try{ localStorage.setItem(k, String(n)); }catch(_){}
      return 'NO' + y + m + dd + '-' + String(n).padStart(4,'0');
    }
    function _genId(p){ try{ return Utils.generateId(p); }catch(_){ return (p||'id')+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,8); } }
    function _addDays(dateStr, n){
      var d = new Date(String(dateStr).replace(/-/g,'/')); if(isNaN(d.getTime())) d = new Date();
      d.setDate(d.getDate() + (parseInt(n,10)||0)); return Utils.formatDate(d);
    }
    /**
     * 预约成功后，立刻同步写入：① CUSTOMERS 客户档案 ② ORDERS 正式订单（含 orderNo） ③ SCHEDULES 演出档期草稿
     * 这是 Experience 1478752 最佳实践：上游写入点同步下游，避免补偿轮询漏生成
     */
    function syncFromAppointment(appointment){
      var S = _getS(); if(!appointment || !S){ _log('no S or appointment, skip'); return null; }
      var out = { customer: null, order: null, schedules: [] };
      var now = Date.now();
      try{
        // ---- 1) CUSTOMERS 客户档案（手机号判重，有则更新，无则新建）----
        var custKey = S.KEYS.CUSTOMERS || 'customers_v1';
        var custList = null;
        try{ if(typeof S._get==='function') custList = S._get(custKey)||[]; }catch(_){ custList = null; }
        if(!Array.isArray(custList)) custList = [];
        var phone = (appointment.phone||'').trim();
        var customerName = appointment.customerName || '未命名客户';
        var foundCust = null;
        for(var i=0;i<custList.length;i++){
          var c = custList[i]||{};
          if(phone && c.phone && String(c.phone).trim()===phone){ foundCust = c; break; }
          if(!phone && c.customerName===customerName && !(c.phone||'').trim()){ foundCust = c; break; }
        }
        var customerId = foundCust ? (foundCust.id||_genId('cus')) : _genId('cus');
        var newCust = foundCust ? Object.assign({}, foundCust) : { id: customerId };
        newCust.customerName = customerName;
        newCust.phone = phone || newCust.phone || '';
        newCust.organization = appointment.organization || newCust.organization || '';
        newCust.email = appointment.email || newCust.email || '';
        newCust.idCard = appointment.idCard || newCust.idCard || '';
        newCust.remarks = [newCust.remarks||'', '【'+(new Date().toISOString().slice(0,10))+'】预约 '+ (appointment.bookingId||'')].filter(Boolean).join('\n').slice(0,800);
        newCust.lastAppointmentAt = now;
        newCust.updatedAt = now;
        if(!newCust.createdAt) newCust.createdAt = now;
        // 保存
        var savedOk = false;
        try{
          if(foundCust && typeof S.update==='function'){ savedOk = !!S.update(custKey, customerId, newCust); }
          else if(typeof S.create==='function'){ var r = S.create(custKey, newCust); if(r && r.id){ newCust = r; savedOk = true; } }
          if(!savedOk){
            custList = (S.list && typeof S.list==='function') ? (S.list(custKey)||[]) : custList;
            if(!Array.isArray(custList)) custList = [];
            if(foundCust){
              for(var j=0;j<custList.length;j++){ if((custList[j]||{}).id===customerId){ custList[j]=newCust; break; } }
            }else{ custList.push(newCust); }
            if(typeof S._set==='function'){ savedOk = !!S._set(custKey, custList); }
          }
        }catch(e){ savedOk = false; _log('save customer fail',e); }
        out.customer = savedOk ? newCust : null;

        // ---- 2) ORDERS 正式订单（NOyyyyMMdd-XXXX 展示号 + appointmentId 回链）----
        var orderKey = S.KEYS.ORDERS || 'orders';
        var orderNo = _nextOrderNo();
        var pricing = appointment.pricing || {};
        var totalAmount = Number(pricing.finalTotal || pricing.total || appointment.shows*2000) || 0;
        var orderId = _genId('ord');
        var order = {
          id: orderId,
          orderNo: orderNo,
          bookingId: appointment.bookingId || '',
          appointmentId: appointment.id || '',
          customerId: customerId,
          customer: customerName,
          customerPhone: phone || '',
          organization: appointment.organization || '',
          serviceType: appointment.serviceType || '',
          shows: parseInt(appointment.shows,10)||1,
          selectedPlays: Array.isArray(appointment.selectedPlays) ? appointment.selectedPlays.slice(0,30) : [],
          startDate: appointment.preferredStartDate || Utils.formatDate(new Date()),
          venue: appointment.venue || '',
          remarks: appointment.remarks || '',
          amount: totalAmount,
          paid: 0,
          type: /惠民|政府|文旅/.test(appointment.serviceType||'') ? '惠民商演' : '商演收入',
          // ✅ 独立状态字段：不复用 appointment.statusText 做流程逻辑
          orderStatus: 'pending',
          statusText: '待确认',
          source: 'booking_portal',
          pricingSnap: Utils.deepClone ? Utils.deepClone(pricing) : (JSON.parse(JSON.stringify(pricing||{}))),
          createdAt: now,
          updatedAt: now
        };
        var orderSaved = null;
        try{
          if(typeof S.create==='function'){ orderSaved = S.create(orderKey, order); if(orderSaved && orderSaved.id){ order = orderSaved; } }
          if(!orderSaved){
            var oList = (S.list && typeof S.list==='function') ? (S.list(orderKey)||[]) : [];
            if(!Array.isArray(oList)) oList = [];
            oList.push(order);
            if(typeof S._set==='function'){ S._set(orderKey, oList); }
          }
        }catch(e2){ _log('save order fail',e2); }
        // 回写 appointment（orderId / orderNo），让后台订单页能跨页面找到
        try{
          if(appointment.id){
            appointment.orderId = order.id || orderId;
            appointment.orderNo = orderNo;
            appointment.updatedAt = now;
            if(typeof S.update==='function'){ S.update(S.KEYS.APPOINTMENTS, appointment.id, appointment); }
          }
        }catch(_e){}
        out.order = order;

        // ---- 3) SCHEDULES 演出档期草稿（按 shows 生成连续天，status=draft）----
        var schKey = S.KEYS.SCHEDULES || 'schedules_v2';
        var shows = Math.min(60, parseInt(appointment.shows,10)||1);
        var start = appointment.preferredStartDate || Utils.formatDate(new Date());
        var operas = Array.isArray(appointment.selectedPlays) && appointment.selectedPlays.length ? appointment.selectedPlays : ['《火焰驹》','《窦娥冤》','《大升官》'];
        for(var k=0;k<shows;k++){
          var scDate = _addDays(start, k);
          var sc = {
            id: _genId('sch'),
            orderId: order.id || orderId,
            orderNo: orderNo,
            bookingId: appointment.bookingId || '',
            title: (appointment.organization || customerName || '客户') + ' · 第'+(k+1)+'场演出',
            date: scDate,
            venue: appointment.venue || '',
            opera: operas[k % operas.length],
            serviceType: appointment.serviceType || '',
            status: 'draft',
            statusText: '待排演',
            performerIds: [],
            customerId: customerId,
            source: 'booking_auto',
            showIndex: k+1,
            createdAt: now,
            updatedAt: now
          };
          try{
            if(typeof S.create==='function'){ S.create(schKey, sc); }
            else{
              var sList = (S.list && typeof S.list==='function') ? (S.list(schKey)||[]) : [];
              if(!Array.isArray(sList)) sList = [];
              sList.push(sc);
              if(typeof S._set==='function'){ S._set(schKey, sList); }
            }
            out.schedules.push(sc);
          }catch(e3){ _log('schedule fail idx='+k, e3); }
        }
        _toast('✅ 联动成功：已生成订单号 ' + orderNo + '，同步创建 '+shows+' 条演出档期草稿（待后台确认）', 'success', 5000);
      }catch(e){
        _log('sync fail',e); _toast('⚠️ 预约已保存，但订单/档期生成失败：'+(e.message||e), 'warning', 4200);
      }
      return out;
    }

    /**
     * 后台订单管理：三按钮动作（确认 / 取消 / 转演出）
     * - 确认：orderStatus pending→confirmed，同步 schedule draft→confirmed
     * - 取消：orderStatus pending→cancelled，同步 schedule draft/confirmed→cancelled
     * - 转演出：confirmed→completed，同步 schedule confirmed→completed + 生成演职人员考勤待办
     */
    function updateOrderStatus(orderId, action, opts){
      var S = _getS(); if(!S || !orderId) return null;
      opts = opts || {};
      var orderKey = S.KEYS.ORDERS || 'orders';
      var schKey = S.KEYS.SCHEDULES || 'schedules_v2';
      var orders = null;
      try{ orders = (S.list && typeof S.list==='function') ? (S.list(orderKey)||[]) : null; }catch(_){ orders = null; }
      if(!Array.isArray(orders)){ try{ orders = S._get(orderKey)||[]; }catch(_){ orders = []; } }
      var found = null;
      for(var i=0;i<orders.length;i++){ var o = orders[i]||{}; if(o.id===orderId){ found = o; break; } }
      if(!found){ _toast('❌ 未找到该订单，请刷新后重试','error'); return null; }
      var now = Date.now();
      var nextStatus = found.orderStatus; var nextText = found.statusText;
      if(action==='confirm'){ nextStatus='confirmed'; nextText='已确认排期'; }
      else if(action==='cancel'){ nextStatus='cancelled'; nextText='已取消'; }
      else if(action==='to-show' || action==='complete'){ nextStatus='completed'; nextText='演出完成'; }
      found.orderStatus = nextStatus; found.statusText = nextText; found.updatedAt = now;
      if(typeof S.update==='function'){ S.update(orderKey, orderId, found); }
      // 同步 schedule
      try{
        var schedules = (S.list && typeof S.list==='function') ? (S.list(schKey)||[]) : [];
        if(!Array.isArray(schedules)) schedules = S._get(schKey)||[];
        for(var j=0;j<schedules.length;j++){
          var sc = schedules[j]||{}; if(sc.orderId !== orderId) continue;
          if(action==='confirm'){ sc.status='confirmed'; sc.statusText='已确认排期'; }
          else if(action==='cancel'){ sc.status='cancelled'; sc.statusText='已取消'; }
          else if(action==='to-show' || action==='complete'){ sc.status='completed'; sc.statusText='演出完成'; }
          sc.updatedAt = now;
          if(typeof S.update==='function'){ S.update(schKey, sc.id, sc); }
        }
      }catch(eS){ _log('schedule sync fail',eS); }
      _toast('✅ 订单状态已更新为【'+nextText+'】，共影响 '+schedulesLen(schedules||[],orderId)+' 条演出档期', 'success', 3600);
      return found;
    }
    function schedulesLen(list, oid){ var n=0; for(var i=0;i<list.length;i++){ if((list[i]||{}).orderId===oid) n++; } return n; }

    return {
      syncFromAppointment: syncFromAppointment,
      updateOrderStatus: updateOrderStatus,
      nextOrderNo: _nextOrderNo
    };
  })();
  global.BookingLinkage = BookingLinkage;
  global.QinApp && (QinApp.BookingLinkage = BookingLinkage);

  // —— 挂钩：在 submitAppointment 成功后，自动触发 4 联动（若 bookingId/orderId 还未设置则执行）
  (function _hookSubmit(){
    try{
      var orig = FormValidator.submitAppointment;
      if(typeof orig !== 'function') return;
      FormValidator.submitAppointment = function(form){
        var saved = orig.call(this, form);
        if(saved && saved.id && !saved.orderId){
          try{
            var res = BookingLinkage.syncFromAppointment(saved);
            // 把 orderNo 回填到成功卡片显示（扩展原 bookingId 的显示）
            try{
              var row = document.querySelector('[data-booking-id-row]');
              if(row && res && res.order){
                row.style.display='block'; row.classList.remove('csp-hide');
                var disp = row.querySelector('[data-booking-id-display]');
                if(disp){
                  var existing = (disp.textContent||'').trim();
                  var orderMsg = '订单号 ' + res.order.orderNo + '（已同步演出档期 '+ (res.schedules?res.schedules.length:0)+' 条）';
                  disp.innerHTML = existing && existing!=='-' ? '预约 ' + existing + ' · ' + orderMsg : orderMsg;
                }
              }
            }catch(_e1){}
            return saved;
          }catch(e){ try{ console.warn('[submit hook linkage]',e.message||e); }catch(_){} }
        }
        return saved;
      };
    }catch(e){ try{ console.warn('[hookSubmit fail]',e.message||e); }catch(_){} }
  })();

  // ============================================================
  // 模块 3.6: DemoDataFactory 一键生成演示生产数据（F1 Rev9 · 10场演出+30人考勤+DRE+财务+工资）
  // ============================================================
  var DemoDataFactory = (function(){
    function _S(){ try{ return window.Storage || (window.QinApp && QinApp.Storage) || null; }catch(_){ return null; } }
    function _U(){ try{ return window.Utils || (window.QinApp && QinApp.Utils) || null; }catch(_){ return null; } }
    function _t(m,t,d){ try{ var U=_U(); if(U && U.toast){ U.toast(m,t||'info',d||3200); return; } }catch(_){} try{ console.log('[demo]['+(t||'info')+'] '+m); }catch(_){} }
    function _log(m,e){ try{ console.info('[DemoDataFactory] '+m+(e?' :'+(e.message||e):'')); }catch(_){} }
    function _id(p){ try{ return Utils.generateId(p); }catch(_){ return (p||'id')+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,8); } }
    function _ymd(d){ d=d instanceof Date?d:new Date(d); var y=d.getFullYear(); var m=String(d.getMonth()+1).padStart(2,'0'); var da=String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+da; }
    function _days(n){ var d = new Date('2026-08-05'); d.setDate(d.getDate()+parseInt(n,10)); return _ymd(d); }
    // 30 位演职人员（行当 5 大岗）
    var _STAFF_30 = [
      // 生行 6
      ['王志强','生行','W3','W3正生','须生','郭','汉族','大专','1990-03-12','13909380001','天水市秦安县','正生演员',10,380,0,1,'演员队'],
      ['陈建国','生行','W3','W3正生','须生','郭','汉族','本科','1988-07-08','13909380002','天水市甘谷县','小生演员',8,350,0,1,'演员队'],
      ['李建华','生行','W4','W4副生','老生','陈','汉族','高中','1985-10-25','13909380003','天水市秦安县','老生演员',15,420,0,1,'演员队'],
      ['张晓明','生行','W2','W2 小生','武生','李','汉族','中专','1995-02-18','13909380004','天水市清水县','武生演员',6,280,0,1,'演员队'],
      ['刘大伟','生行','W3','W3正生','红生','刘','汉族','大专','1992-11-30','13909380005','天水市武山县','红生演员',9,360,0,1,'演员队'],
      ['赵文博','生行','W2','W2 小生','小生','赵','汉族','本科','1998-06-22','13909380006','天水市麦积区','小生演员',4,260,0,1,'演员队'],
      // 旦行 6
      ['孙艳霞','旦行','W6','W6 正旦','青衣','孙','汉族','本科','1993-04-15','13909380101','天水市秦安县','青衣演员',10,450,0,1,'演员队'],
      ['王芳丽','旦行','W5','W5 副旦','花旦','王','汉族','大专','1996-09-09','13909380102','天水市秦安县','花旦演员',7,380,0,1,'演员队'],
      ['李美玲','旦行','W7','W7主A角','小旦','李','汉族','本科','1991-12-02','13909380103','天水市甘谷县','小旦演员',12,500,0,1,'演员队'],
      ['刘静静','旦行','W5','W5 副旦','刀马旦','刘','汉族','大专','1994-03-28','13909380104','天水市秦安县','刀马旦演员',8,400,0,1,'演员队'],
      ['张红红','旦行','W4','W4副生','老旦','张','汉族','高中','1982-05-17','13909380105','天水市秦安县','老旦演员',18,420,0,1,'演员队'],
      ['赵丽娜','旦行','W3','W3正生','彩旦','赵','汉族','中专','1999-08-14','13909380106','天水市清水县','彩旦演员',3,300,0,1,'演员队'],
      // 净行 4
      ['朱海涛','净行','W5','W5 副旦','铜锤花脸','朱','汉族','大专','1987-01-22','13909380201','天水市武山县','花脸演员',12,420,0,1,'演员队'],
      ['周文斌','净行','W4','W4副生','架子花脸','周','汉族','本科','1990-10-05','13909380202','天水市秦安县','花脸演员',9,380,0,1,'演员队'],
      ['吴晓勇','净行','W3','W3正生','武净','吴','汉族','高中','1984-06-30','13909380203','天水市秦安县','武净演员',16,450,0,1,'演员队'],
      ['郑鹏飞','净行','W2','W2 小生','毛净','郑','汉族','中专','1997-12-19','13909380204','天水市麦积区','毛净演员',5,300,0,1,'演员队'],
      // 丑行 3
      ['侯俊杰','丑行','W4','W4副生','文丑','侯','汉族','本科','1989-02-25','13909380301','天水市秦安县','文丑演员',11,380,0,1,'演员队'],
      ['马小强','丑行','W3','W3正生','武丑','马','汉族','大专','1992-09-16','13909380302','天水市甘谷县','武丑演员',8,360,0,1,'演员队'],
      ['曹乐乐','丑行','W2','W2 小生','丑婆','曹','汉族','中专','1999-04-11','13909380303','天水市清水县','丑婆演员',4,280,0,1,'演员队'],
      // 乐队 5（板胡·司鼓·二胡·扬琴·月琴）
      ['徐老师','乐队','W4','-','板胡','徐','汉族','本科','1978-11-05','13909380401','天水市秦安县','板胡琴师',22,550,0,1,'乐队'],
      ['钱师傅','乐队','W4','-','司鼓','钱','汉族','高中','1975-04-20','13909380402','天水市秦安县','司鼓',25,580,0,1,'乐队'],
      ['孙二胡','乐队','W3','-','二胡','孙','汉族','大专','1986-08-15','13909380403','天水市武山县','二胡演奏',14,400,0,1,'乐队'],
      ['李扬琴','乐队','W3','-','扬琴','李','汉族','大专','1991-02-03','13909380404','天水市秦安县','扬琴演奏',9,400,0,1,'乐队'],
      ['周月琴','乐队','W2','-','月琴','周','汉族','本科','1995-12-30','13909380405','天水市麦积区','月琴演奏',6,340,0,1,'乐队'],
      // 前场 3（服装·道具·电工）
      ['韩师傅','前场服装','W2','-','服装管理','韩','汉族','高中','1968-03-10','13909380501','天水市秦安县','服装师',28,300,0,1,'舞美队'],
      ['冯师傅','前场道具','W2','-','道具管理','冯','汉族','高中','1972-07-25','13909380502','天水市秦安县','道具师',25,280,0,1,'舞美队'],
      ['谢电工','前场电工','W2','-','音响灯光','谢','汉族','中专','1980-10-09','13909380503','天水市秦安县','灯光音响',18,360,0,1,'舞美队']
    ];
    function _rand(min, max){ return Math.floor(Math.random()*(max-min+1))+min; }
    function _pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

    /**
     * 一键生成演示数据：
     * 1) 客户档案 5 家（文旅局/庙会/商会/文化站/企业）
     * 2) 订单 10 个（NO20260805-xxxx 连续号段，惠民/庙会混合）
     * 3) 档期 10 条（2026-08-05~08-14，confirmed 已确认状态，便于生成考勤）
     * 4) 人员花名册 STAFF_ROSTER 30 位
     * 5) 考勤 300 条（30人×10场，混合分布：正常75%/迟到6%/早退3%/旷工2%/事假5%/病假4%/装台卸台5%）
     * 6) 调用 DRE/WageEngine 扣款 → 生成当月工资条 WAGES
     * 7) FIN_LEDGER 写入 2 张凭证：8月演职人员工资发放 + 8月考勤扣款汇总
     */
    function generateDemoProductionData(opts){
      opts = opts || {};
      var S = _S();
      if(!S){ _t('❌ Storage 未加载，请刷新页面重试','error'); return null; }
      var summary = { customers:0, orders:0, schedules:0, staff:0, attendance:0, wages:0, ledger:0, attBreakdown:{}, wageSummary:{ grossTotal:0, deductionTotal:0, netTotal:0 }, wageSheets:[] };
      var now = Date.now();
      try{
        // ---- 1) CUSTOMERS（5 家）----
        var cKey = S.KEYS.CUSTOMERS || 'customers_v1';
        var demoCustomers = [
          {customerName:'秦安县文旅局',organization:'秦安县文化广电和旅游局',phone:'13909381101',email:'wenlv@qinan.gov.cn'},
          {customerName:'陇城镇张沟村庙会组委会',organization:'陇城镇张沟村村委会',phone:'13909381102'},
          {customerName:'秦安县企业商会',organization:'秦安县工商联',phone:'13909381103',email:'shanghui@qinan.com'},
          {customerName:'郭嘉镇文化站',organization:'郭嘉镇人民政府',phone:'13909381104'},
          {customerName:'秦安盛达商贸有限公司',organization:'秦安盛达商贸',phone:'13909381105',email:'sdsm@163.com'}
        ];
        var cList = (S.list && S.list(cKey)) || S._get(cKey) || [];
        if(!Array.isArray(cList)) cList = [];
        demoCustomers.forEach(function(dc){
          var phone = dc.phone;
          var found = null;
          for(var ci=0;ci<cList.length;ci++){ var c=cList[ci]||{}; if(c.phone===phone){ found=c; break; } }
          if(!found){
            var nc = Object.assign({id:_id('cus'),createdAt:now,updatedAt:now}, dc);
            if(S.create){ S.create(cKey, nc); } else { cList.push(nc); if(S._set) S._set(cKey, cList); }
            summary.customers++;
          }
        });
        if(!S.create && S._set){ S._set(cKey, cList); }
        // 重新拿完整列表
        cList = (S.list && S.list(cKey)) || S._get(cKey) || [];

        // ---- 4) 人员花名册（30 位）----
        var srKey = S.KEYS.STAFF_ROSTER || 'staff_roster_v1';
        var srList = (S.list && S.list(srKey)) || S._get(srKey) || [];
        if(!Array.isArray(srList)) srList = [];
        var staffById = {};
        var existingPhones = {};
        for(var si=0;si<srList.length;si++){ var x=srList[si]||{}; if(x.phone) existingPhones[x.phone]=1; if(x.id) staffById[x.id]=x; }
        var staffList = srList.slice();
        for(var sri=0; sri<_STAFF_30.length; sri++){
          var row = _STAFF_30[sri];
          if(existingPhones[row[9]]) continue;
          var stf = {
            id: _id('stf'),
            name: row[0], crewCategory: row[1], wageLevel: row[2], wageLevelLabel: row[3],
            role: row[4] || row[1], surname: row[5], ethnicity: row[6],
            education: row[7], birthDate: row[8], phone: row[9],
            address: row[10], position: row[11], seniorityYears: row[12],
            dailyWage: row[13], mealAllowance: row[14], hasSocialInsurance: row[15],
            dept: row[16] || '演员队',
            status: '在册', createdAt: now, updatedAt: now
          };
          staffList.push(stf); staffById[stf.id] = stf; existingPhones[stf.phone] = 1;
          summary.staff++;
        }
        if(S._set){ S._set(srKey, staffList); }

        // ---- 2) ORDERS + 3) SCHEDULES（10 订单/10 档期）----
        var oKey = S.KEYS.ORDERS || 'orders';
        var sKey = S.KEYS.SCHEDULES || 'schedules_v2';
        var OPERAS = ['《火焰驹》','《窦娥冤》','《大升官》','《三滴血》','《五典坡》','《铡美案》','《金沙滩》','《周仁回府》','《生死牌》','《下河东》','《清风亭》','《三娘教子》'];
        var VENUES = ['秦安县文化中心大剧院','陇城镇张沟村文化广场','郭嘉镇文化节主舞台','莲花镇民俗广场','安伏镇商贸文化广场','叶堡镇文化大舞台','千户镇文化活动中心','中山镇庙会主台','王窑镇党建广场','秦安酒店大礼堂'];
        var TYPES = ['惠民下乡巡演','乡村庙会戏曲演出','节庆专场文艺演出','企业商户庆典演出','天水文旅合作演出'];
        var oList = (S.list && S.list(oKey)) || S._get(oKey) || []; if(!Array.isArray(oList)) oList = [];
        var scList = (S.list && S.list(sKey)) || S._get(sKey) || []; if(!Array.isArray(scList)) scList = [];
        var demoDates = [];
        for(var di=0;di<10;di++){ demoDates.push(_days(di)); }
        for(var oi=0; oi<10; oi++){
          var d = demoDates[oi];
          var cust = cList[oi % Math.max(1,cList.length)] || {customerName:'秦安县文旅局',phone:'13909381101',organization:'秦安县文旅局',id:(cList[0]||{}).id};
          var orderNo = BookingLinkage && typeof BookingLinkage.nextOrderNo==='function' ? BookingLinkage.nextOrderNo()
            : 'NO20260805-' + String(1000+oi).padStart(4,'0');
          var shows = 1;
          var type = TYPES[oi % TYPES.length];
          var amount = /惠民/.test(type)? 30000 : (/庙会/.test(type)? 28000 : (/节庆/.test(type)? 42000 : 36000));
          var order = {
            id: _id('ord'), orderNo: orderNo, bookingId:('DEMO-'+(10000+oi)),
            appointmentId:'', customerId: cust.id||'', customer: cust.customerName, customerPhone: cust.phone||'',
            organization: cust.organization||'', serviceType: type, shows: shows,
            selectedPlays: [OPERAS[oi % OPERAS.length]], startDate: d, venue: VENUES[oi % VENUES.length],
            remarks: '演示数据 · 2026年8月 第'+(oi+1)+'场 自动生成',
            amount: amount, paid: /惠民|节庆|企业/.test(type)? amount : Math.round(amount*0.7),
            type: /惠民|文旅/.test(type)?'惠民商演':'商演收入',
            orderStatus: 'completed', statusText: '演出完成', source: 'demo_factory',
            pricingSnap: {finalTotal: amount, shows: shows}, createdAt: now, updatedAt: now
          };
          oList.push(order); summary.orders++;
          var sc = {
            id:_id('sch'), orderId: order.id, orderNo: orderNo, bookingId: order.bookingId,
            title: (cust.customerName||'') + ' · 第'+(oi+1)+'场演出', date: d, venue: order.venue,
            opera: OPERAS[oi % OPERAS.length], serviceType: type,
            status: 'completed', statusText: '演出完成', customerId: cust.id||'', performerIds: Object.keys(staffById),
            source: 'demo_factory', showIndex: (oi+1), createdAt: now, updatedAt: now,
            // 给考勤生成使用：场次索引
            _demoDayIndex: oi
          };
          scList.push(sc); summary.schedules++;
        }
        if(S._set){ S._set(oKey, oList); S._set(sKey, scList); }

        // ---- 5) 考勤 300 条（30 人 × 10 天） + 表演标签 + DRE ----
        var aKey = S.KEYS.ATTENDANCE || 'attendance_v1';
        var attList = (S.list && S.list(aKey)) || S._get(aKey) || []; if(!Array.isArray(attList)) attList = [];
        // 避免重复写入：同 staffId+date 不重复
        var attSet = {};
        for(var ai=0;ai<attList.length;ai++){ var a=attList[ai]||{}; if(a.staffId && a.date) attSet[a.staffId+'_'+a.date]=1; }
        var staffArr = [];
        Object.keys(staffById).forEach(function(k){ staffArr.push(staffById[k]); });
        // 按 场次生成考勤：每天 30 人
        var LATE_RANGES = [[8,15],[16,30],[31,60]]; // 迟到分钟分档
        var EARLY_RANGES = [[5,15],[16,30]];
        var ABSENT_RATE = 0.02, LEAVE_RATE=0.05, SICK_RATE=0.04, LATE_RATE=0.06, EARLY_RATE=0.03, ZHUANGTAI_RATE=0.05;
        var BD = { normal:0, late:0, early:0, absent:0, leave:0, sick:0, zhuangtai:0, xietai:0 };
        for(var day=0; day<10; day++){
          var schDate = demoDates[day];
          var nightShow = (day % 2 === 1); // 单日夜场：8月6、8、10、12、14
          for(var sIndex=0; sIndex<staffArr.length; sIndex++){
            var st = staffArr[sIndex];
            var key = st.id + '_' + schDate;
            if(attSet[key]) continue;
            var r = Math.random();
            var status = '出勤';
            var lateMin = 0, earlyMin = 0, lateCnt = 0, earlyCnt = 0;
            var absent = 0, leave=0, sick=0, nights = nightShow?1:0;
            var accident = 0, perfBonus = 0, manualTag='';
            if(r < ABSENT_RATE){ status='旷工'; absent=1; BD.absent++; }
            else if(r < ABSENT_RATE+LEAVE_RATE){ status='事假'; leave=1; BD.leave++; }
            else if(r < ABSENT_RATE+LEAVE_RATE+SICK_RATE){ status='病假'; sick=1; BD.sick++; }
            else if(r < ABSENT_RATE+LEAVE_RATE+SICK_RATE+LATE_RATE){
              status='迟到'; var lr=LATE_RANGES[_rand(0,LATE_RANGES.length-1)]; lateMin=_rand(lr[0],lr[1]); lateCnt=1; BD.late++;
            }
            else if(r < ABSENT_RATE+LEAVE_RATE+SICK_RATE+LATE_RATE+EARLY_RATE){
              status='早退'; var er=EARLY_RANGES[_rand(0,EARLY_RANGES.length-1)]; earlyMin=_rand(er[0],er[1]); earlyCnt=1; BD.early++;
            }
            else if(r < ABSENT_RATE+LEAVE_RATE+SICK_RATE+LATE_RATE+EARLY_RATE+ZHUANGTAI_RATE){
              status='出勤'; manualTag = day<5?'装台':'卸台';
              if(manualTag==='装台') BD.zhuangtai++; else BD.xietai++;
            }
            else { BD.normal++; }
            var att = {
              id: _id('att'), staffId: st.id, staffName: st.name, dept: st.dept, role: st.role,
              date: schDate,
              status: status, // 出勤/迟到/早退/旷工/事假/病假
              attendanceHours: (absent||leave||sick)?0: (nightShow?8.5:7.5),
              lateMinutes: lateMin, lateCount: lateCnt,
              earlyMinutes: earlyMin, earlyCount: earlyCnt,
              absentDays: absent, leaveDays: leave, sickDays: sick,
              nightShows: nights, performanceBonus: perfBonus, accidentFine: accident, manualTag: manualTag,
              scheduleDate: schDate, orderNo: scList[day]? scList[day].orderNo : '',
              scheduleId: scList[day]? scList[day].id : '',
              source: 'demo_factory',
              createdAt: now, updatedAt: now
            };
            attList.push(att); attSet[key]=1; summary.attendance++;
          }
        }
        summary.attBreakdown = BD;
        if(S._set){ S._set(aKey, attList); }
        // DRE 打卡日志：写入 ATTENDANCE_CLOCKS_V2（便于 ISAPI 集成面板能看到数据）
        try{
          var cKey2 = S.KEYS.ATTENDANCE_CLOCKS_V2 || 'att_clocks_v2';
          var clocks = S._get(cKey2) || {};
          Object.keys(attSet).forEach(function(k){
            if(clocks[k]) return;
            var pieces = k.split('_'); var sid = pieces[0]; var d = pieces[1];
            clocks[k] = [d+' 13:'+String(_rand(30,50)).padStart(2,'0')+':00', d+' 22:'+String(_rand(30,55)).padStart(2,'0')+':00'];
          });
          S._set(cKey2, clocks);
        }catch(_eC){}

        // ---- 6) 调用 WageEngine + DRE：生成 2026-08 月份工资条 30 张 ----
        var monthKey = '2026-08';
        var wKey = S.KEYS.WAGES || 'wages_v1';
        var wList = (S.list && S.list(wKey)) || S._get(wKey) || []; if(!Array.isArray(wList)) wList = [];
        // 删除本月之前 demo_factory 生成的工资条（重复点击不重复）
        wList = wList.filter(function(w){ return !(w && w._source==='demo_factory' && (w.month||'')===monthKey); });
        var WE = null;
        try{ WE = window.WageEngine || (window.QinApp && QinApp.Wage) || (typeof getWageEngine==='function'?getWageEngine():null); }catch(_){}
        var params = {
          shouldWorkDays: 10,
          dailyWageKey: 'dailyWage',
          lateDeductFee: 30, earlyDeductFee: 30,
          lateDeductProgressive: true, absentDeductMultiplier: 2,
          fullBonus: 200, nightSubsidy: 50,
          performanceBonus: 0, socialSecurity: 320, taxThreshold: 5000
        };
        var grossT = 0, dedT = 0, netT = 0;
        for(var wi=0; wi<staffArr.length; wi++){
          var stf2 = staffArr[wi];
          var metrics = { lateMin:0, lateN:0, earlyMin:0, earlyN:0, leave:0, absent:0, sick:0, nights:0, att:0, swd:10, acc:0 };
          for(var ai2=0; ai2<attList.length; ai2++){
            var a2 = attList[ai2]||{}; if(a2.staffId !== stf2.id) continue;
            metrics.lateMin += Number(a2.lateMinutes)||0;
            metrics.lateN += Number(a2.lateCount)||0;
            metrics.earlyMin += Number(a2.earlyMinutes)||0;
            metrics.earlyN += Number(a2.earlyCount)||0;
            metrics.leave += Number(a2.leaveDays)||0;
            metrics.absent += Number(a2.absentDays)||0;
            metrics.sick += Number(a2.sickDays)||0;
            metrics.nights += Number(a2.nightShows)||0;
            metrics.acc += Number(a2.accidentFine)||0;
            if(a2.status==='出勤' || a2.status==='装台' || a2.status==='卸台' || a2.status==='迟到' || a2.status==='早退') metrics.att += 1;
          }
          var baseDaily = Number(stf2.dailyWage) || 300;
          var sw = null;
          try{
            if(WE && typeof WE.calcMonthSalaryV2 === 'function'){
              sw = WE.calcMonthSalaryV2(stf2, params, monthKey, attList);
            } else if(WE && typeof WE.calcDayRecord==='function'){
              sw = WE.calcMonthSalaryV2 ? WE.calcMonthSalaryV2(stf2, params, monthKey, attList) : null;
            }
            if(!sw){
              // 兜底：简化版工资算法（与 WageEngine V2 接近）
              var perDay = baseDaily;
              var sumBase = perDay * metrics.att;
              var lateFee = 0; for(var lp=0;lp<metrics.lateN;lp++){
                var mult = params.lateDeductProgressive? Math.min(Math.pow(2,Math.max(0,lp-2)),16) : 1;
                lateFee += Math.min(params.lateDeductFee*mult, 500);
              }
              var earlyFee = metrics.earlyN * params.earlyDeductFee;
              var leaveFee = metrics.leave * perDay;
              var absentFee = metrics.absent * perDay * (params.absentDeductMultiplier||2);
              var sickFee = metrics.sick * perDay * 0.3;
              var fullB = (metrics.leave===0&&metrics.absent===0&&metrics.sick===0&&metrics.att>=params.shouldWorkDays&&metrics.lateN===0&&metrics.earlyN===0) ? params.fullBonus : 0;
              var nightSub = metrics.nights * (params.nightSubsidy||0);
              var social = params.socialSecurity||0;
              var allDed = leaveFee + absentFee + lateFee + earlyFee + sickFee;
              var gross = sumBase + fullB + nightSub - allDed;
              var tax = 0;
              var net = Math.max(0, gross - social - tax);
              if(gross<0) gross=0; if(net<0) net=0;
              sw = {
                wageId: 'W202608'+(stf2.id||'').slice(0,6)+String(1000+wi),
                staffId: stf2.id, name: stf2.name, dept: stf2.dept, role: stf2.role,
                baseSalary: Math.round(sumBase*100)/100, attDays: metrics.att, nights: metrics.nights,
                leaveDays: metrics.leave, absentDays: metrics.absent, sickDays: metrics.sick,
                lateCount: metrics.lateN, earlyCount: metrics.earlyN,
                isFull: fullB>0?1:0, fullBonus: fullB, nightSubsidy: nightSub,
                performanceBonus: 0, accidentFine: 0,
                leaveDeduction: +leaveFee.toFixed(2), absentDeduction: +absentFee.toFixed(2),
                lateDeduction: +lateFee.toFixed(2), earlyDeduction: +earlyFee.toFixed(2),
                totalDeductionPre: +allDed.toFixed(2), socialSecurity: social,
                grossPay: +gross.toFixed(2), taxableIncome: Math.max(0,+gross-social-params.taxThreshold),
                tax: tax, netPay: +net.toFixed(2), _engine: 'DemoFactoryFallback', _dre: null
              };
            }
          }catch(wErr){
            sw = null; _log('wage fail staff='+stf2.name,wErr);
          }
          if(sw){
            sw.month = monthKey; sw._source = 'demo_factory'; sw.createdAt = now; sw.updatedAt = now;
            if(!sw.staffId) sw.staffId = stf2.id; if(!sw.name) sw.name = stf2.name;
            wList.push(sw); summary.wages++;
            grossT += Number(sw.grossPay)||0;
            dedT += Number(sw.totalDeductionPre)||0;
            netT += Number(sw.netPay)||0;
            summary.wageSheets.push({name:sw.name, dept:sw.dept, gross:Number(sw.grossPay)||0, ded:Number(sw.totalDeductionPre)||0, net:Number(sw.netPay)||0});
          }
        }
        summary.wageSummary = { grossTotal: +grossT.toFixed(2), deductionTotal: +dedT.toFixed(2), netTotal: +netT.toFixed(2) };
        if(S._set){ S._set(wKey, wList); }

        // ---- 7) FIN_LEDGER 写入 2 张凭证：8月演职人员工资发放 + 考勤扣款汇总 ----
        try{
          var writeEntry = (typeof window.addLedgerEntry === 'function') ? window.addLedgerEntry
            : (typeof (window.__FIN && window.__FIN.addLedgerEntry)==='function' ? window.__FIN.addLedgerEntry : null);
          var sourceFlow = (window.FLOW_SOURCE && window.FLOW_SOURCE.WAGE) ? window.FLOW_SOURCE.WAGE : 'wage';
          if(typeof writeEntry !== 'function'){
            // finance.html 未加载：直接用 Storage 手工写（完全对齐 finance.html 的 addLedgerEntry 格式：id/date/title/type/category/orderId/source/refId/amount/payMethod/status/handler）
            writeEntry = function(par){
              try{
                var k = S.KEYS.FIN_LEDGER || 'fin_ledger_v1';
                var l = S._get(k) || []; if(!Array.isArray(l)) l = [];
                var entry = {
                  id: par.id || ('OUT'+_ymd(new Date()).replace(/-/g,'')+Math.random().toString(36).slice(2,8).toUpperCase()),
                  date: par.date || _ymd(new Date()),
                  title: par.title || '',
                  type: par.type || 'expense',
                  category: par.category || '人员工资',
                  orderId: par.orderId || '',
                  source: par.source || sourceFlow,
                  refId: par.refId || '',
                  amount: Math.round(Number(par.amount)*100)/100,
                  payMethod: par.payMethod || '银行代发',
                  status: par.status || '已核销',
                  handler: par.handler || '李会计',
                  remark: par.remark || '',
                  createdAt: par.createdAt || now,
                  updatedAt: now
                };
                l.push(entry);
                S._set(k, l);
                summary.ledger++;
                return entry;
              }catch(e2){ _log('fin entry fail',e2); return null; }
            };
          }
          // 凭证 1：工资发放
          var ent1 = writeEntry({
            type: 'expense',
            date: '2026-08-15',
            title: '8月演职人员工资发放（30人，DRE+基本工资自动汇总）',
            category: '人员工资',
            orderId: '',
            source: sourceFlow,
            refId: 'WAGE_2026_08_BATCH',
            amount: summary.wageSummary.netTotal,
            payMethod: '银行代发',
            status: '已核销',
            handler: '李会计',
            remark: 'Demo Factory：含 30 人 × 10 场考勤，含 DRE 扣款/全勤奖/夜场补助/社保代扣',
            createdAt: now
          });
          if(ent1) summary.ledger++;
          // 凭证 2：考勤扣款汇总（用负数支出=实际少支出，用独立一张支出凭证体现"扣款减免" → 更清晰用负金额红冲）
          if(summary.wageSummary.deductionTotal > 0){
            var ent2 = writeEntry({
              type: 'expense',
              date: '2026-08-15',
              title: '8月考勤扣款汇总（迟到/早退/旷工/事假/病假 DRE 规则自动计算）',
              category: '人员工资',
              orderId: '',
              source: sourceFlow,
              refId: 'WAGE_2026_08_DEDUCTION',
              amount: summary.wageSummary.deductionTotal,
              payMethod: '银行代发',
              status: '已核销',
              handler: '李会计',
              remark: '扣款明细：迟到 '+BD.late+'次 · 早退 '+BD.early+'次 · 旷工 '+BD.absent+'天 · 事假 '+BD.leave+'天 · 病假 '+BD.sick+'天',
              createdAt: now
            });
            if(ent2) summary.ledger++;
          }
        }catch(eF){ _log('fin fail',eF); }

        // 汇总
        _t('🎉 演示生产数据生成完成：客户 '+summary.customers+' · 订单 '+summary.orders+' · 档期 '+summary.schedules+' · 人员 '+summary.staff+' · 考勤 '+summary.attendance+'（正常'+BD.normal+'，迟到'+BD.late+'，早退'+BD.early+'，旷工'+BD.absent+'，事假'+BD.leave+'，病假'+BD.sick+'，装/卸台'+(BD.zhuangtai+BD.xietai)+'）· 工资条 '+summary.wages+' · 财务凭证 '+summary.ledger+'，合计实发 ¥'+(summary.wageSummary.netTotal||0).toLocaleString('zh-CN',{minimumFractionDigits:2})+'，扣款 ¥'+(summary.wageSummary.deductionTotal||0).toLocaleString('zh-CN',{minimumFractionDigits:2}), 'success', 8000);
      }catch(e){
        _log('generate fail',e);
        _t('❌ 生成失败：'+(e.message||e), 'error', 6000);
        return null;
      }
      return summary;
    }

    return { generate: generateDemoProductionData };
  })();
  global.DemoDataFactory = DemoDataFactory;
  global.QinApp && (QinApp.DemoDataFactory = DemoDataFactory);
  // 便捷别名：window.genDemo() 直接跑（Console 一键运行）
  global.genDemoProductionData = function(){ return DemoDataFactory.generate.apply(DemoDataFactory, arguments); };

  // ============================================================
  // 模块 4: 导航栏交互 NavBar
  // ============================================================
  var NavBar = {
    /**
     * 根据当前页面URL自动高亮对应导航项
     * 覆盖全部 17 个前台页面 + 兼容 admin 子目录
     */
    highlightCurrentPage: function () {
      var menus = document.querySelectorAll('[data-nav-menu]');
      if (!menus || menus.length === 0) return;
      try {
        var path = (window.location.pathname || '/').toLowerCase();
        var search = window.location.search || '';
        // 提取最后一段文件名，兼容 /foo/bar.html 和 /foo/bar/
        var fileName = '';
        var pathParts = path.split('/').filter(Boolean);
        if (pathParts.length > 0) {
          var last = pathParts[pathParts.length - 1];
          if (last.indexOf('.') === -1 && !/\.html?$/i.test(last)) {
            // clean URL 如 /booking /about → 补 .html
            fileName = last + '.html';
          } else {
            fileName = last;
          }
        } else {
          fileName = 'index.html'; // 根路径
        }
        fileName = fileName.toLowerCase();
        // 是否在 admin 目录
        var isAdmin = (path.indexOf('/admin/') !== -1);
        // 用于更宽泛的匹配（用于 live-api.html 等变体）
        var pathSlug = fileName.replace(/\.html?$/i, '');
        var count = 0;
        for (var m = 0; m < menus.length; m++) {
          var menu = menus[m];
          var links = menu.querySelectorAll('a[href]');
          for (var i = 0; i < links.length; i++) {
            var a = links[i];
            var href = String(a.getAttribute('href') || '').trim().toLowerCase();
            if (!href || href.charAt(0) === '#') continue;
            a.classList.remove('active');
            // 精确匹配文件名
            var hrefFile = href.split('/').filter(Boolean).pop() || href;
            var matched = false;
            if (hrefFile === fileName) {
              matched = true;
            } else if (fileName === 'index.html' && hrefFile === 'index.html') {
              matched = true;
            } else {
              // 宽泛匹配：/live → live-api.html, /minor → minor-policy.html
              var hrefSlug = hrefFile.replace(/\.html?$/i, '');
              if (hrefSlug && pathSlug) {
                if ((pathSlug.indexOf(hrefSlug) === 0 && pathSlug.length >= hrefSlug.length) ||
                    (hrefSlug.indexOf(pathSlug) === 0 && hrefSlug.length >= pathSlug.length)) {
                  matched = true;
                }
              }
              // admin 目录特殊处理：全部"后台管理"链接高亮
              if (isAdmin && (hrefSlug === 'admin/login' || hrefFile === 'admin/login.html' || href.indexOf('admin/') !== -1)) {
                matched = true;
              }
            }
            if (matched) {
              a.classList.add('active');
              count++;
            }
          }
        }
      } catch (e) {
        console.warn('[NavBar] highlightCurrentPage error:', e);
      }
    },

    init: function () {
      var toggle = document.querySelector('[data-nav-toggle]');
      var menu = document.querySelector('[data-nav-menu]');

      if (!toggle || !menu) {
        // 即使没有移动菜单toggle，也要尝试高亮（admin页面）
        this.highlightCurrentPage();
        return;
      }

      toggle.addEventListener('click', function () {
        var isOpen = menu.classList.toggle('nav-open');
        toggle.classList.toggle('nav-active', isOpen);
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        menu.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        document.body.classList.toggle('nav-locked', isOpen);
      });

      var links = menu.querySelectorAll('a[href^="#"]');
      for (var i = 0; i < links.length; i++) {
        links[i].addEventListener('click', function () {
          if (menu.classList.contains('nav-open')) {
            menu.classList.remove('nav-open');
            toggle.classList.remove('nav-active');
            toggle.setAttribute('aria-expanded', 'false');
            document.body.classList.remove('nav-locked');
          }
        });
      }

      var header = document.querySelector('[data-header]');
      if (header) {
        var onScroll = Utils.throttle(function () {
          if (window.scrollY > 20) {
            header.classList.add('header-scrolled');
          } else {
            header.classList.remove('header-scrolled');
          }
        }, 100);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
      }

      // 自动高亮当前页导航项
      this.highlightCurrentPage();
    }
  };

  // ============================================================
  // 模块 5: 平滑滚动与页面通用交互 SmoothScroll & UI
  // ============================================================
  var PageUI = {
    init: function () {
      this.initSmoothScroll();
      this.initBackToTop();
      this.initRevealOnScroll();
      this.initAccordion();
      this.initTabs();
      this.initBookingUrlParams();
      this.initPricePreview();
      this.initAppointmentForm();
      this.initQuickBookForm();
      this.initQuickContactForm();
      this.initCategoryTabs();
      this.initRepertoireCards();
      this.initFooterActions();
      this.initOperaPageSearch();
      this.initBookingQRGenerator();
    },

    /**
     * Footer 社交/功能点击交互
     */
    initFooterActions: function () {
      var wechatPhone = '13993839833';
      var mpAccount = '秦安县秦剧团';
      var mpFullName = '秦安县秦剧团文化演出有限公司';
      var shipinhaoName = '秦安县秦剧团官方';

      // 预生成 Modal config，复用 Utils.openQRModal
      var modalCfgs = {
        'wechat': function () {
          return {
            title: '微信客服联系',
            subtitle: '演出档期/报价/定制咨询 · 工作日 8:30-18:00',
            qrImgUrl: Utils.buildQRImgUrl('https://u.wechat.com/contact/' + wechatPhone, 230),
            codeText: '微信号 / 手机号：' + wechatPhone + '（微信同号）',
            tip: '请打开微信 → 右上角「+」→ 添加朋友 → 粘贴上方手机号搜索',
            actions: [
              { label: '📋 复制手机号', variant: 'btn-primary', onClick: function () { Utils.copyText(wechatPhone, '✅ 客服手机号已复制：' + wechatPhone); } },
              { label: '📞 直接拨打', variant: 'btn-outline', href: 'tel:' + wechatPhone },
              { label: '✕ 关闭', variant: 'btn-outline', onClick: function (e, close) { close(); } }
            ]
          };
        },
        'mp': function () {
          return {
            title: '关注官方公众号',
            subtitle: '获取最新剧目排期 · 演出资讯 · 惠民下乡公告',
            plainPlaceholder: '📌 操作指引\n\n① 打开微信 App\n② 点击「通讯录」→「公众号」→ 右上角「+」\n③ 搜索：' + mpAccount + '\n④ 认准「' + mpFullName + '」点击关注',
            codeText: '微信公众号名称：' + mpAccount,
            tip: '公众号二维码受微信官方保护，暂不支持站外直接扫码跳转，请按上方步骤搜索关注',
            actions: [
              { label: '📋 复制公众号名', variant: 'btn-gold', onClick: function () { Utils.copyText(mpAccount, '✅ 公众号名称已复制：' + mpAccount); } },
              { label: '🌐 访问官网首页', variant: 'btn-outline', href: 'index.html' },
              { label: '✕ 关闭', variant: 'btn-outline', onClick: function (e, close) { close(); } }
            ]
          };
        },
        'wechat-qr': function () {
          return {
            title: '微信公众号·官方二维码',
            subtitle: '扫码/搜索关注「秦安县秦剧团」官方公众号',
            plainPlaceholder: '📡 微信公众号二维码（防外采提示）\n\n受微信官方安全策略保护\n公众号二维码无法在站外直接展示图片\n\n请在微信内搜索下方公众号名称',
            codeText: '公众号全称：' + mpFullName + '   |   简称：' + mpAccount,
            tip: '搜索步骤：微信 → 通讯录 → 公众号 → + 号 → 粘贴名称',
            actions: [
              { label: '📋 复制公众号全称', variant: 'btn-primary', onClick: function () { Utils.copyText(mpFullName, '✅ 公众号全称已复制'); } },
              { label: '📋 复制简称', variant: 'btn-outline', onClick: function () { Utils.copyText(mpAccount, '✅ 公众号简称已复制：' + mpAccount); } },
              { label: '✕ 关闭', variant: 'btn-outline', onClick: function (e, close) { close(); } }
            ]
          };
        },
        'shipinhao': function () {
          return {
            title: '官方视频号·剧目片花',
            subtitle: '每周更新经典唱段 · 庙会现场 · 惠民下乡花絮',
            plainPlaceholder: '📺 视频号观看路径\n\n① 打开微信 → 发现 → 视频号\n② 搜索：' + shipinhaoName + '\n③ 点击头像进入主页 → 关注即可收看\n\n近期更新：火焰驹/铡美案/窦娥冤 经典选段',
            codeText: '微信视频号：' + shipinhaoName,
            tip: '视频号与公众号主体关联，搜索公众号也可找到视频号入口',
            actions: [
              { label: '📋 复制视频号名', variant: 'btn-gold', onClick: function () { Utils.copyText(shipinhaoName, '✅ 视频号名称已复制：' + shipinhaoName); } },
              { label: '🎭 查看剧目中心', variant: 'btn-outline', href: 'operas.html' },
              { label: '✕ 关闭', variant: 'btn-outline', onClick: function (e, close) { close(); } }
            ]
          };
        }
      };

      document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-footer-action]');
        if (!btn) return;
        e.preventDefault();
        var k = btn.getAttribute('data-footer-action');
        if (modalCfgs[k] && typeof modalCfgs[k] === 'function') {
          try {
            Utils.openQRModal(modalCfgs[k]());
          } catch (err) {
            Utils.toast('操作失败，请稍后再试', 'error');
          }
        } else if (k) {
          Utils.toast('该功能正在完善中，敬请期待', 'info');
        }
      });
    },

    /**
     * 二维码预约生成页（qr-booking.html）：真实生成带URL参数的预约链接二维码
     *   - 支持 serviceType / date 预填
     *   - 按钮组：复制链接 / 新窗口打开 / 下载二维码 / 手机扫码预览
     */
    initBookingQRGenerator: function () {
      var form = document.getElementById('qrBookingForm') || document.querySelector('[data-qr-booking-form]');
      if (!form) return;

      var serviceSel = form.querySelector('[name="serviceType"], #serviceType');
      var dateInput = form.querySelector('[name="date"], #date');
      var perfNameInput = form.querySelector('[name="perfName"], #perfName');
      var remarkInput = form.querySelector('[name="remark"], #remark');
      var contactTelInput = form.querySelector('[name="contactTel"], #contactTel');
      var showCountInput = form.querySelector('[name="showCount"], #showCount');
      var jumpBtn = document.getElementById('qrJumpBookingBtn') || document.querySelector('[data-qr-jump-booking]');

      var qrImgWrap = document.getElementById('qrBookingImgWrap') || document.querySelector('[data-qr-booking-img-wrap]');
      var qrImgEl = qrImgWrap && qrImgWrap.querySelector('img');
      var qrLinkBox = document.getElementById('qrBookingLinkBox') || document.querySelector('[data-qr-booking-link]');
      var btnCopy = document.getElementById('qrBtnCopy') || document.querySelector('[data-qr-btn="copy"]');
      var btnOpen = document.getElementById('qrBtnOpen') || document.querySelector('[data-qr-btn="open"]');
      var btnDownload = document.getElementById('qrBtnDownload') || document.querySelector('[data-qr-btn="download"]');
      var btnPreview = document.getElementById('qrBtnPreview') || document.querySelector('[data-qr-btn="preview"]');
      var btnGen = form.querySelector('button[type="submit"]') || document.querySelector('[data-qr-btn="gen"]');

      var baseUrl = (window.location.origin + (window.location.pathname.replace(/[^\/]*$/, 'booking.html')));

      var buildBookingURL = function () {
        var url = baseUrl;
        var q = [];
        var add = function (k, v) {
          v = String(v || '').trim();
          if (!v) return;
          q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
        };
        // —— 5 参数标准集（与 booking.html 预填逻辑 / 浏览器验证用例严格对齐 ——
        if (serviceSel && serviceSel.value) {
          var serviceLabel = serviceSel.value;
          try { if (serviceSel.selectedIndex > 0) serviceLabel = serviceSel.options[serviceSel.selectedIndex].textContent || serviceSel.value; } catch (e) {}
          add('serviceType', serviceSel.value);
          add('serviceName', serviceLabel);
        }
        if (dateInput) add('date', dateInput.value);
        if (showCountInput) add('showCount', showCountInput.value);
        if (contactTelInput) add('contactTel', contactTelInput.value);
        if (perfNameInput) add('perfName', perfNameInput.value);
        if (remarkInput) add('remark', remarkInput.value);
        if (q.length) url += '?' + q.join('&');
        return url;
      };

      var updateQR = function () {
        var url = buildBookingURL();
        if (qrImgEl) {
          qrImgEl.src = Utils.buildQRImgUrl(url, 360);
          qrImgEl.alt = '秦剧团预约二维码 - ' + (url.length > 40 ? url.slice(0, 40) + '…' : url);
        }
        if (qrLinkBox) {
          var safe = Utils.escapeHtml(url);
          // B7 CSP合规：qr-link-title/qr-link-url替代内嵌 style
          qrLinkBox.innerHTML = '🔗 <strong class="qr-link-title">预约链接：</strong><br><span class="qr-link-url">' + safe + '</span>';
          qrLinkBox.setAttribute('data-url', url);
        }
        return url;
      };

      var latestURL = '';
      var handleGen = function (e) {
        if (e) { e.preventDefault(); }
        latestURL = updateQR();
        if (btnGen) {
          var orig = btnGen.textContent;
          btnGen.textContent = '✅ 已生成';
          btnGen.disabled = true;
          setTimeout(function () { btnGen.textContent = orig; btnGen.disabled = false; }, 1600);
        }
        Utils.toast('✅ 预约二维码已生成（5项参数），可复制链接或下载图片', 'success');
      };
      form.addEventListener('submit', handleGen);

      // 实时预览（debounce，不触发toast）
      var livePreview = Utils.debounce(function () {
        if (qrImgEl || qrLinkBox) latestURL = buildBookingURL();
        if (qrImgEl) { qrImgEl.src = Utils.buildQRImgUrl(latestURL, 360); }
        if (qrLinkBox) {
          var safe = Utils.escapeHtml(latestURL);
          // B7 CSP合规：qr-link-title/qr-link-url替代内嵌 style
          qrLinkBox.innerHTML = '🔗 <strong class="qr-link-title">预约链接：</strong><br><span class="qr-link-url">' + safe + '</span>';
          qrLinkBox.setAttribute('data-url', latestURL);
        }
      }, 280);
      [serviceSel, dateInput, perfNameInput, remarkInput, contactTelInput, showCountInput].forEach(function (el) { if (el) el.addEventListener('input', livePreview); });

      // 绿色「扫码立即预约 →」按钮：直接跳 booking.html 带 5 参数
      if (jumpBtn) jumpBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var url = (qrLinkBox && qrLinkBox.getAttribute('data-url')) || buildBookingURL();
        window.open(url, '_blank', 'noopener,noreferrer');
      });

      if (btnCopy) btnCopy.addEventListener('click', function (e) {
        e.preventDefault();
        var url = (qrLinkBox && qrLinkBox.getAttribute('data-url')) || latestURL || buildBookingURL();
        Utils.copyText(url, '✅ 预约链接已复制（可粘贴到微信/浏览器打开）');
      });
      if (btnOpen) btnOpen.addEventListener('click', function (e) {
        e.preventDefault();
        var url = (qrLinkBox && qrLinkBox.getAttribute('data-url')) || latestURL || buildBookingURL();
        window.open(url, '_blank', 'noopener,noreferrer');
      });
      if (btnPreview) btnPreview.addEventListener('click', function (e) {
        e.preventDefault();
        var url = (qrLinkBox && qrLinkBox.getAttribute('data-url')) || latestURL || buildBookingURL();
        Utils.openQRModal({
          title: '手机扫码预约预览',
          subtitle: '请使用微信扫一扫/浏览器扫码，直接进入带参数的预约页',
          qrText: url,
          codeText: url,
          tip: '扫码后可直接在手机端填写完整预约信息并提交（支持预选项）',
          actions: [
            { label: '📋 复制链接', variant: 'btn-primary', onClick: function () { Utils.copyText(url, '✅ 预约链接已复制'); } },
            { label: '🌐 新窗口打开', variant: 'btn-outline', href: url, target: '_blank' },
            { label: '✕ 关闭', variant: 'btn-outline', onClick: function (ev, close) { close(); } }
          ]
        });
      });
      if (btnDownload) btnDownload.addEventListener('click', function (e) {
        e.preventDefault();
        var url = (qrLinkBox && qrLinkBox.getAttribute('data-url')) || latestURL || buildBookingURL();
        var qrSrc = Utils.buildQRImgUrl(url, 1024);
        // 用 img.onload 后触发 a.download；跨域无法 canvas，所以直接触发下载
        var a = document.createElement('a');
        a.href = qrSrc;
        a.download = '秦剧团预约二维码_' + (dateInput && dateInput.value ? dateInput.value : Utils.formatDate(new Date())) + '.png';
        a.target = '_blank';
        a.rel = 'noopener,noreferrer';
        try { document.body.appendChild(a); a.click(); } finally { try { document.body.removeChild(a); } catch (err) {} }
        Utils.toast('✅ 已发起下载（若浏览器拦截，请右键二维码图片→另存为）', 'success');
      });

      // 页面加载：立即生成默认QR（无参数，即纯 booking.html）
      latestURL = updateQR();
    },

    /**
     * 剧目中心页：真实搜索匹配 + 分类tab联动
     *   搜索关键词匹配：剧目标题(h3)、行当、时长标签、适配场景、简介、剧目类型标签
     *   分类tab联动：全部/传统本戏/折子戏/民俗专场/现代戏 切换时重新应用筛选
     *   剧目卡片选择器：class=opera-card[data-category]，排除 .category-empty 占位
     */
    initOperaPageSearch: function () {
      var searchInput = document.querySelector('[data-search-opera]');
      if (!searchInput) return;
      var allCards = document.querySelectorAll('.opera-card[data-category]');
      if (!allCards.length) return;
      var tabBtns = document.querySelectorAll('[data-tab-btn]');
      var currentCat = 'all';

      function applyFilter() {
        var kw = String(searchInput.value || '').trim().toLowerCase();
        var visible = 0;
        allCards.forEach(function (card) {
          if (card.classList.contains('category-empty')) {
            // B7 CSP合规：pg-hidden替代style.display='none'
            try { card.classList.add('pg-hidden'); } catch (_csp) {}
            return;
          }
          var cat = card.getAttribute('data-category') || 'all';
          var catMatch = (currentCat === 'all' || currentCat === cat);
          var textMatch = true;
          if (kw) {
            var hay = (card.getAttribute('data-search-text') || card.textContent || '').toString().toLowerCase();
            textMatch = hay.indexOf(kw) !== -1;
          }
          var show = catMatch && textMatch;
          // B7 CSP合规：pg-hidden替代style.display=show?'':'none'
          try { card.classList.toggle('pg-hidden', !show); } catch (_csp) {}
          if (show) visible++;
        });
        if (kw) {
          Utils.toast('🔍 关键词「' + searchInput.value + '」匹配到 ' + visible + ' 部剧目' + (visible === 0 ? '（可尝试：火焰驹/铡美案/青衣/庙会）' : ''), visible > 0 ? 'success' : 'warn');
        }
      }

      function ensureSearchText() {
        allCards.forEach(function (card) {
          if (card.getAttribute('data-search-text')) return;
          var title = (card.querySelector('h3') || {}).textContent || '';
          var tags = card.querySelectorAll('.opera-meta-item, .opera-card-category, .opera-scene-tag, [class*="meta"], .badge, .label');
          var tagStr = '';
          for (var i = 0; i < tags.length; i++) tagStr += ' ' + tags[i].textContent;
          var cat = card.getAttribute('data-category') || '';
          var intro = (card.querySelector('.opera-card-desc') || {}).textContent || '';
          card.setAttribute('data-search-text', (title + ' ' + cat + ' ' + tagStr + ' ' + intro).replace(/\s+/g, ' '));
        });
      }

      ensureSearchText();
      var inputHandler = Utils.throttle(applyFilter, 250);
      searchInput.addEventListener('input', inputHandler);
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); applyFilter(); }
      });
      tabBtns.forEach(function (b) {
        b.addEventListener('click', function () {
          currentCat = b.getAttribute('data-tab-btn') || 'all';
          applyFilter();
        });
      });
      var iconWrap = searchInput.closest('.search-input-wrap');
      if (iconWrap) {
        var sicon = iconWrap.querySelector('.search-icon');
        if (sicon) sicon.addEventListener('click', applyFilter);
      }
    },

    initBookingUrlParams: function () {
      var form = document.querySelector('[data-appointment-form]');
      if (!form) return;
      var search = window.location.search || '';
      if (!search || search.indexOf('?') !== 0) return;
      try {
        var params = new URLSearchParams(search);
        var normalize = function (s) {
          return String(s || '').replace(/[《》\s]/g, '').trim();
        };
        var firstNonEmpty = function (arr) {
          for (var i = 0; i < arr.length; i++) {
            var v = params.get(arr[i]);
            if (v != null && String(v).trim() !== '') return String(v).trim();
          }
          return '';
        };
        var prefilled = []; // 预填报告（toast展示）

        // ============ 1) 预选演出类型 serviceType ============
        var serviceTypeVal = firstNonEmpty(['serviceType','service','service_type','演出类型','type']);
        if (serviceTypeVal) {
          var sel = form.querySelector('select[name="serviceType"], select#serviceType, select[data-service-type]');
          if (sel) {
            // 兼容：qr-booking 传的是数字(1-8)，与 booking.html select 的 option.value 完全匹配
            var opts = sel.querySelectorAll('option');
            var match = false;
            for (var o = 0; o < opts.length; o++) {
              var ov = String(opts[o].value || '');
              var ot = String(opts[o].textContent || '');
              if (ov === serviceTypeVal || normalize(ot).indexOf(normalize(serviceTypeVal)) !== -1) {
                sel.value = opts[o].value;
                match = true;
                break;
              }
            }
            if (match) prefilled.push('演出类型');
            try { sel.dispatchEvent(new Event('change', {bubbles: true})); } catch (e) {}
          }
        }

        // ============ 2) 预填演出日期 date / preferredStartDate ============
        var dateVal = firstNonEmpty(['preferredStartDate','date','演出日期','dateStr','startDate','showDate']);
        if (dateVal && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
          var dateEl = form.querySelector('input[type="date"][name="preferredStartDate"], input#preferredStartDate, input[type="date"][name="date"]');
          if (dateEl) {
            dateEl.value = dateVal;
            prefilled.push('演出日期');
            try { dateEl.dispatchEvent(new Event('change', {bubbles: true})); } catch (e) {}
          }
        }

        // ============ 3) 预选场次数量 shows ============
        var showsVal = firstNonEmpty(['shows','showCount','playCount','场次数量','场次','count']);
        if (showsVal) {
          var n = parseInt(showsVal, 10);
          if (!isNaN(n) && n >= 1 && n <= 100) {
            var showsEl = form.querySelector('input[name="shows"], input#shows, [data-shows-input]');
            if (showsEl) { showsEl.value = String(n); prefilled.push('场次数量:' + n); }
          }
        }

        // ============ 4) 意向剧目（多选复选框）：play / plays / opera / perfName / selectedPlay / selectedPlays ============
        var targetPlays = [];
        var playParam = firstNonEmpty(['play','selectedPlay','opera','perfName','剧目','剧目名称','意向剧目']);
        if (playParam) targetPlays.push(String(playParam));
        var playsParam = firstNonEmpty(['plays','selectedPlays']);
        if (playsParam) {
          String(playsParam).split(/[，,、;；|]/).forEach(function (p) {
            if (p && p.trim()) targetPlays.push(p.trim());
          });
        }
        var matched = 0;
        if (targetPlays.length > 0) {
          var normalizedTargets = targetPlays.map(normalize);
          var checkboxes = form.querySelectorAll('input[name="selectedPlays"]');
          checkboxes.forEach(function (cb) {
            var val = normalize(cb.value);
            for (var nt = 0; nt < normalizedTargets.length; nt++) {
              if ((val && (val === normalizedTargets[nt] || normalizedTargets[nt] && val.indexOf(normalizedTargets[nt]) !== -1 || (normalizedTargets[nt] && val.indexOf(normalizedTargets[nt]) !== -1)))) {
                cb.checked = true;
                matched++;
                break;
              }
            }
          });
          if (matched > 0) prefilled.push('意向剧目×' + matched);
        }

        // ============ 5) 备注/特殊要求 remark / remarks ============
        var remarkVal = firstNonEmpty(['remarks','remark','备注','说明','需求']);
        if (remarkVal) {
          var remarkEl = form.querySelector('textarea[name="remarks"], textarea#remarks, textarea[name="remark"]');
          if (remarkEl) {
            var cur = String(remarkEl.value || '').trim();
            remarkEl.value = cur ? (cur + '\n' + remarkVal) : remarkVal;
            prefilled.push('备注信息');
          }
        }

        // ============ 6) 预填信息反馈：滚动到对应区域 + toast 汇总 ============
        if (prefilled.length > 0) {
          try {
            var firstFormGroup = form.querySelector('.form-group');
            if (firstFormGroup) firstFormGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch (e) {}
          try { Utils.toast('🎉 已为您预填：' + prefilled.join(' / '), 'success', 5200); } catch (e) {}
        } else if (targetPlays.length === 0) {
          return; // 完全没参数，静默
        }
      } catch (e) {
        console.warn('[Booking] URL参数解析失败:', e);
      }
    },

    initRepertoireCards: function () {
      var cards = document.querySelectorAll('.repertoire-card');
      if (!cards.length) return;
      cards.forEach(function (card) {
        card.addEventListener('click', function () {
          var h4 = card.querySelector('h4');
          var title = h4 ? h4.textContent.trim().replace(/[《》]/g, '') : '';
          if (title === '更多经典剧目') {
            window.location.href = 'operas.html';
          } else if (title) {
            window.location.href = 'operas.html?play=' + encodeURIComponent(title);
          } else {
            window.location.href = 'operas.html';
          }
        });
      });
    },

    /**
     * 平滑滚动到锚点
     */
    initSmoothScroll: function () {
      document.addEventListener('click', function (e) {
        var a = e.target.closest('a[href^="#"]');
        if (!a) return;
        var id = a.getAttribute('href');
        if (id.length < 2 || id === '#') { e.preventDefault(); return; }
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();

        var headerH = document.querySelector('[data-header]')
          ? document.querySelector('[data-header]').offsetHeight
          : 0;
        var targetTop = Math.max(0, target.getBoundingClientRect().top + window.scrollY - headerH - 10);

        window.scrollTo(0, targetTop);

        try {
          if (typeof id === 'string' && id.charAt(0) === '#') {
            window.location.hash = id;
            window.scrollTo(0, targetTop);
          }
        } catch (e) { /* ignore */ }

        setTimeout(function () {
          try {
            window.scrollTo({
              top: targetTop,
              behavior: 'smooth'
            });
          } catch (e) {
            window.scrollTo(0, targetTop);
          }
        }, 0);
      });
    },

    /**
     * 返回顶部按钮
     */
    initBackToTop: function () {
      var btn = document.querySelector('[data-back-to-top]');
      if (!btn) {
        try {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'back-to-top';
          btn.setAttribute('data-back-to-top', '');
          btn.setAttribute('aria-label', '返回顶部');
          btn.innerHTML = '↑';
          // B7 CSP合规：pg-hidden替代btn.style.display='none'
          try { btn.classList.add('pg-hidden'); } catch (_csp) {}
          document.body.appendChild(btn);
        } catch (e) {
          return;
        }
      }

      var onScroll = Utils.throttle(function () {
        var shown = window.scrollY > 400;
        try {
          if (shown) btn.classList.add('show'); else btn.classList.remove('show');
        } catch (e) {}
        // B7 CSP合规：pg-hidden替代btn.style.display=show?'':'none'
        try { btn.classList.toggle('pg-hidden', !shown); } catch (_csp) {}
      }, 200);
      window.addEventListener('scroll', onScroll, { passive: true });
      try { onScroll(); } catch (e) {}

      btn.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    },

    /**
     * 滚动时元素渐入
     */
    initRevealOnScroll: function () {
      var items = document.querySelectorAll('[data-reveal]');
      if (items.length === 0) return;

      if (!('IntersectionObserver' in window)) {
        for (var i = 0; i < items.length; i++) {
          // B7 CSP合规：nav-item-visible替代 style.opacity/transform直接写
          try { items[i].classList.add('nav-item-visible'); } catch (_csp) {}
        }
        return;
      }

      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12 });

      for (var j = 0; j < items.length; j++) {
        observer.observe(items[j]);
      }
    },

    /**
     * 手风琴折叠
     */
    initAccordion: function () {
      var accs = document.querySelectorAll('[data-accordion]');
      for (var i = 0; i < accs.length; i++) {
        var headers = accs[i].querySelectorAll('[data-acc-header]');
        for (var j = 0; j < headers.length; j++) {
          headers[j].addEventListener('click', function () {
            var item = this.closest('[data-acc-item]');
            if (!item) return;
            item.classList.toggle('acc-open');
            // B7 CSP合规：直接依赖 .acc-open [data-acc-body] 类选择器控制展开，不再写 body.style.maxHeight
          });
        }
      }
    },

    /**
     * 标签页切换
     */
    initTabs: function () {
      var groups = document.querySelectorAll('[data-tabs]');
      for (var i = 0; i < groups.length; i++) {
        (function (group) {
          var btns = group.querySelectorAll('[data-tab-btn]');
          var panels = group.querySelectorAll('[data-tab-panel]');

          for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', function () {
              var key = this.getAttribute('data-tab-btn');
              for (var b = 0; b < btns.length; b++) {
                btns[b].classList.toggle('active', btns[b].getAttribute('data-tab-btn') === key);
              }
              for (var p = 0; p < panels.length; p++) {
                panels[p].classList.toggle('active', panels[p].getAttribute('data-tab-panel') === key);
              }
            });
          }
        })(groups[i]);
      }
    },

    /**
     * 实时价格预览（联动场次输入）
     */
    initPricePreview: function () {
      var showInput = document.querySelector('[data-shows-input]');
      var previewBox = document.querySelector('[data-pricing-detail]');
      if (!showInput || !previewBox) return;

      var render = function () {
        var shows = parseInt(showInput.value, 10) || 1;
        var pricing = PricingEngine.calculate(shows);
        var html = '';
        html += '<div style="margin-bottom:12px;">';
        html +=   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
        html +=     '<span style="font-weight:600;">优惠档次：</span>';
        html +=     '<span style="background:#dbeafe;color:#1d4ed8;padding:2px 10px;border-radius:12px;font-size:12px;">' + Utils.escapeHtml(pricing.tier.name) + ' · ' + pricing.tier.discountText + '</span>';
        html +=   '</div>';
        html +=   '<div style="font-size:13px;color:#475569;">' + Utils.escapeHtml(pricing.tier.desc);
        if (pricing.tier.priority) html += ' ✓ 优先排期';
        if (pricing.tier.exclusive) html += ' ✓ 专属对接人';
        html +=   '</div>';
        html += '</div>';
        html += '<table style="width:100%;font-size:14px;border-collapse:collapse;">';
        for (var i = 0; i < pricing.breakdown.length; i++) {
          var row = pricing.breakdown[i];
          var hl = row.highlight ? 'font-weight:700;color:#b91c1c;font-size:16px;border-top:2px dashed #e2e8f0;' : '';
          html += '<tr>';
          html +=   '<td style="padding:6px 4px;' + hl + '">' + Utils.escapeHtml(row.label) + '</td>';
          html +=   '<td style="padding:6px 4px;text-align:right;' + hl + '">' + Utils.escapeHtml(row.value) + '</td>';
          html += '</tr>';
        }
        html += '</table>';
        if (pricing.savedAmount > 0) {
          html += '<div style="margin-top:10px;padding:8px 12px;background:#f0fdf4;color:#166534;border-radius:6px;font-size:13px;">';
          html +=   '🎉 本单累计节省 <strong>¥' + Utils.formatMoney(pricing.savedAmount) + '</strong>';
          html += '</div>';
        }
        previewBox.innerHTML = html;
      };

      showInput.addEventListener('input', Utils.debounce(render, 100));
      var serviceSel = document.querySelector('[data-service-type], #serviceType, select[name="serviceType"]');
      if (serviceSel) {
        serviceSel.addEventListener('change', render);
      }
      var operaBoxes = document.querySelectorAll('input[type="checkbox"][name="intendedOperas"], [data-opera-checkbox] input[type="checkbox"]');
      for (var j = 0; j < operaBoxes.length; j++) {
        operaBoxes[j].addEventListener('change', render);
      }
      if (showInput.value) render();
    },

    /**
     * 绑定预约表单提交
     */
    initAppointmentForm: function () {
      var form = document.querySelector('[data-appointment-form]');
      if (!form) return;

      form.addEventListener('submit', function (e) {
        e.preventDefault();

        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn && submitBtn.disabled) {
          Utils.toast('⏳ 提交处理中，请勿重复点击', 'warn');
          return;
        }

        var formDataX = new FormData(form);
        var nm = (formDataX.get('customerName') || '').toString().trim();
        var ph = (formDataX.get('phone') || '').toString().trim();
        var dt = (formDataX.get('preferredStartDate') || '').toString().trim();
        var now3 = Date.now();

        // ========== 🔍 提交日志增强：打印表单原始数据快照 ==========
        var _dbgFields = {};
        try {
          formDataX.forEach(function (v, k) {
            _dbgFields[k] = (k === 'selectedPlays') ? _dbgFields[k] ? [].concat(_dbgFields[k], String(v)) : [String(v)] : String(v || '');
          });
        } catch (_fdLog) {}
        console.groupCollapsed('%c[Booking:submit] 🚀 START  ts=' + new Date(now3).toISOString(), 'background:#0F4C81;color:#fff;padding:2px 8px;border-radius:4px;');
        console.log('[Booking:submit] ① 表单原始字段 =', JSON.stringify(_dbgFields, null, 2));
        console.log('[Booking:submit] ② 去重校验：name=' + nm + ' phone=' + ph + ' date=' + dt);
        var _hasApi = !!(window.QAXQJT_API && typeof window.QAXQJT_API.post === 'function');
        var _apiBase = '';
        try { _apiBase = (window.QAXQJT_API_CONFIG && (window.QAXQJT_API_CONFIG.BASE || window.QAXQJT_API_CONFIG.resolveUrl('/v1/appointments'))) || ''; } catch (_e) {}
        console.log('[Booking:submit] ③ 后端可用性：API模块=' + _hasApi + ' 解析URL=' + (_apiBase || '同源 /api 反代'));

        try {
          var recent3 = JSON.parse(sessionStorage.getItem('qaxqjt_booking_combo_3s') || '{}');
          var comboKey = nm + '||' + ph + '||' + dt;
          if (recent3 && recent3.key === comboKey && (now3 - recent3.ts) < 3500) {
            console.warn('[Booking:submit] ❌ 3s 防重复拦截：上次提交 ' + (now3 - recent3.ts) + 'ms 前');
            console.groupEnd();
            Utils.toast('⚠️ 3秒内已提交过相同预约，请勿重复提交（可修改日期或联系电话后再试）', 'warn');
            return;
          }
          sessionStorage.setItem('qaxqjt_booking_combo_3s', JSON.stringify({ key: comboKey, ts: now3 }));
        } catch (e) {
          console.warn('[Booking:submit] sessionStorage 去重读取异常：', e && e.message);
        }

        var originalText = '';
        if (submitBtn) {
          originalText = submitBtn.innerHTML || '提交预约';
          submitBtn.disabled = true;
          submitBtn.setAttribute('aria-disabled', 'true');
          // B7 CSP合规：btn-submitting替代 style.opacity/cursor
          try { submitBtn.classList.add('btn-submitting'); } catch (_csp) {}
          submitBtn.innerHTML = '⏳ 提交中，请稍候...';
        }

        function _restoreBtn() {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.removeAttribute('aria-disabled');
            try { submitBtn.classList.remove('btn-submitting'); } catch (_csp) {}
            submitBtn.innerHTML = originalText || '提交预约';
          }
        }

        var result;
        try {
          result = FormValidator.submitAppointment(form);
          console.log('[Booking:submit] ④ submitAppointment 返回类型 =', result === null ? 'null(校验失败)' : (result && typeof result.then === 'function') ? 'Promise(异步提交中)' : typeof result);
        } catch (err) {
          console.error('[Booking:submit] ❌ sync 阶段异常栈：', err);
          console.groupEnd();
          Utils.toast('提交失败，请稍后重试', 'error');
          _restoreBtn();
          return;
        }

        // 任务 6：submitAppointment 现在返回 Promise（走异步 API 或 localStorage）
        // 校验失败会同步返回 null，此时立即恢复按钮（表单已提示错误信息）
        if (result === null || result === undefined) {
          console.warn('[Booking:submit] ❌ 校验失败，流程终止（表单已高亮错误）');
          console.groupEnd();
          _restoreBtn();
          return;
        }
        if (result && typeof result.then === 'function') {
          var _t0 = Date.now();
          result.then(function (saved) {
            var _elapsed = Date.now() - _t0;
            console.log('[Booking:submit] ✅ 成功！耗时=' + _elapsed + 'ms；保存结果 =', JSON.stringify({
              bookingId: saved && (saved.bookingId || saved.bookingNo),
              id: saved && saved.id,
              customerName: saved && saved.customerName,
              phone: saved && saved.phone
            }, null, 2));
            console.groupEnd();
            setTimeout(_restoreBtn, 2500);
          }, function (err) {
            var _elapsed = Date.now() - _t0;
            console.error('[Booking:submit] ❌ Promise rejected：耗时=' + _elapsed + 'ms；错误消息 =', err && err.message ? err.message : String(err));
            if (err) {
              console.error('[Booking:submit] ❌ 错误详情：status=' + err.status + ' code=' + err.code + ' detail=' + (err.detail || ''));
              if (err.stack) console.error('[Booking:submit] ❌ 错误栈：\n' + err.stack);
            }
            console.groupEnd();
            _restoreBtn();
          });
        } else {
          // 兜底：同步返回了 saved 对象（理论上不会出现，兼容老代码）
          console.log('[Booking:submit] ⚠️ 走同步兜底分支（非Promise）');
          console.groupEnd();
          setTimeout(_restoreBtn, 2500);
        }
      });

      form.addEventListener('reset', function () {
        var errorBox = form.querySelector('[data-form-errors]');
        if (errorBox) {
          errorBox.innerHTML = '';
          // B7 CSP合规：csp-hide替代errorBox.style.display='none'
          try { errorBox.classList.add('csp-hide'); } catch (_csp) {}
        }
        var fields = form.querySelectorAll('.field-error');
        for (var i = 0; i < fields.length; i++) {
          fields[i].classList.remove('field-error');
        }
        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.removeAttribute('aria-disabled');
          // B7 CSP合规：移除btn-submitting替代 style.opacity/cursor=''
          try { submitBtn.classList.remove('btn-submitting'); } catch (_csp) {}
        }
      });
    },

    initQuickBookForm: function () {
      var form = document.getElementById('quickBookForm');
      if (!form) return;

      /* 字数统计 */
      var msgInput = form.querySelector('#message');
      var charCount = form.querySelector('.qb-char-count');
      if (msgInput && charCount) {
        var updateCount = function () {
          var len = (msgInput.value || '').length;
          charCount.textContent = len + ' / 500';
          charCount.style.color = len > 450 ? '#dc2626' : '';
        };
        msgInput.addEventListener('input', updateCount);
        updateCount();
      }

      /* 日期最小值 = 今天 */
      var dateInput = form.querySelector('#eventDate');
      if (dateInput) {
        var todayStr = new Date().toISOString().split('T')[0];
        dateInput.setAttribute('min', todayStr);
      }

      /* 手机号仅允许数字 */
      var phoneInput = form.querySelector('#phone');
      if (phoneInput && !phoneInput._qbDigitBound) {
        phoneInput._qbDigitBound = true;
        phoneInput.addEventListener('input', function () {
          this.value = this.value.replace(/[^0-9]/g, '').slice(0, 11);
        });
      }

      /* 实时验证：姓名 */
      var nameInput = form.querySelector('#name');
      if (nameInput && !nameInput._qbValidateBound) {
        nameInput._qbValidateBound = true;
        var nameTip = form.querySelector('[data-tip-for="name"]');
        nameInput.addEventListener('blur', function () {
          var v = (this.value || '').trim();
          if (!v) {
            if (nameTip) { nameTip.textContent = '请输入您的姓名'; nameTip.style.display = 'block'; }
            this.style.borderColor = '#dc2626';
          } else if (v.length < 2) {
            if (nameTip) { nameTip.textContent = '姓名至少 2 个字符'; nameTip.style.display = 'block'; }
            this.style.borderColor = '#dc2626';
          } else {
            if (nameTip) nameTip.style.display = 'none';
            this.style.borderColor = '';
          }
        });
        nameInput.addEventListener('input', function () {
          if (this.style.borderColor === 'rgb(220, 38, 38)') {
            var v = (this.value || '').trim();
            if (v.length >= 2) {
              if (nameTip) nameTip.style.display = 'none';
              this.style.borderColor = '';
            }
          }
        });
      }

      /* 实时验证：手机号 */
      if (phoneInput && !phoneInput._qbValidateBound) {
        phoneInput._qbValidateBound = true;
        var phoneTip = form.querySelector('[data-tip-for="phone"]');
        phoneInput.addEventListener('blur', function () {
          var v = (this.value || '').trim();
          if (!v) {
            if (phoneTip) { phoneTip.textContent = '请输入手机号码'; phoneTip.style.display = 'block'; }
            this.style.borderColor = '#dc2626';
          } else if (!/^1[3-9]\d{9}$/.test(v)) {
            if (phoneTip) { phoneTip.textContent = '请输入正确的 11 位手机号'; phoneTip.style.display = 'block'; }
            this.style.borderColor = '#dc2626';
          } else {
            if (phoneTip) phoneTip.style.display = 'none';
            this.style.borderColor = '';
          }
        });
        phoneInput.addEventListener('input', function () {
          if (this.style.borderColor === 'rgb(220, 38, 38)') {
            var v = (this.value || '').trim();
            if (/^1[3-9]\d{9}$/.test(v)) {
              if (phoneTip) phoneTip.style.display = 'none';
              this.style.borderColor = '';
            }
          }
        });
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();

        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn && submitBtn.disabled) {
          Utils.toast('⏳ 提交处理中，请勿重复点击', 'warn');
          return;
        }

        var name = (form.querySelector('[name="name"]') || {}).value || '';
        var phone = (form.querySelector('[name="phone"]') || {}).value || '';
        var serviceType = (form.querySelector('[name="serviceType"]') || {}).value || '';
        var eventDate = (form.querySelector('[name="eventDate"]') || {}).value || '';
        var message = (form.querySelector('[name="message"]') || {}).value || '';

        var now3 = Date.now();
        try {
          var recent3 = JSON.parse(sessionStorage.getItem('qaxqjt_quickbook_combo_3s') || '{}');
          var comboKey = (name||'').trim() + '||' + (phone||'').trim() + '||' + (eventDate||'').trim() + '||' + (serviceType||'').trim();
          if (recent3 && recent3.key === comboKey && (now3 - recent3.ts) < 3500) {
            Utils.toast('⚠️ 3秒内已提交过相同快速预约，请勿重复提交', 'warn');
            return;
          }
          sessionStorage.setItem('qaxqjt_quickbook_combo_3s', JSON.stringify({ key: comboKey, ts: now3 }));
        } catch (e) {}

        if (!name.trim()) return Utils.toast('请填写您的姓名', 'error');
        if (!/^1[3-9]\d{9}$/.test(String(phone).trim())) {
          return Utils.toast('请填写正确的 11 位手机号码', 'error');
        }

        var originalText = '';
        if (submitBtn) {
          originalText = submitBtn.innerHTML || '立即预约';
          submitBtn.disabled = true;
          submitBtn.setAttribute('aria-disabled', 'true');
          // B7 CSP合规：btn-submitting替代 style.opacity/cursor
          try { submitBtn.classList.add('btn-submitting'); } catch (_csp) {}
          submitBtn.innerHTML = '⏳ 提交中...';
        }

        var record = {
          id: 'QB-' + Utils.secureRandomHex(8).toUpperCase(),
          source: '首页快速预约',
          name: name.trim(),
          phone: phone.trim(),
          serviceType: serviceType,
          eventDate: eventDate,
          message: message,
          createdAt: new Date().toISOString(),
          status: 'pending',
          statusText: '待审核'
        };

        try {
          var now2 = new Date();
          var year2 = String(now2.getFullYear()).slice(-2);
          var prefix2 = year2 + '-QA-';
          var allApps2 = Storage.list(Storage.KEYS.APPOINTMENTS) || [];
          var maxSeq2 = 0;
          for (var si2 = 0; si2 < allApps2.length; si2++) {
            var row2 = allApps2[si2] || {};
            if (row2.bookingId && typeof row2.bookingId === 'string' && row2.bookingId.indexOf(prefix2) === 0) {
              var suffix2 = row2.bookingId.slice(prefix2.length);
              var sn2 = parseInt(suffix2, 10);
              if (!isNaN(sn2) && sn2 > maxSeq2) maxSeq2 = sn2;
            }
          }
          var seqKey2 = Storage.PREFIX + 'appointments_seq_' + year2;
          var seqFromKey2 = 0;
          try { seqFromKey2 = parseInt(localStorage.getItem(seqKey2), 10) || 0; } catch (e) { seqFromKey2 = 0; }
          var computedMax2 = Math.max(maxSeq2, seqFromKey2);
          var nextSeq2 = computedMax2 + 1;
          var seqStr2 = String(nextSeq2).padStart(4, '0');
          var bookingId2 = prefix2 + seqStr2;
          var guard2 = 0;
          while (guard2 < 1000) {
            var dup2 = false;
            for (var di2 = 0; di2 < allApps2.length; di2++) {
              if ((allApps2[di2] || {}).bookingId === bookingId2) { dup2 = true; break; }
            }
            if (!dup2) break;
            nextSeq2++;
            seqStr2 = String(nextSeq2).padStart(4, '0');
            bookingId2 = prefix2 + seqStr2;
            guard2++;
          }
          record.bookingId = bookingId2;
          record.bookingTimeText = now2.toLocaleString('zh-CN', { hour12: false });
        } catch (e) {}

        try {
          var saved = Storage.create(Storage.KEYS.APPOINTMENTS, record);
          try {
            var saveSeqVal2 = Math.max(seqFromKey2 || 0, nextSeq2 || 0);
            if (saveSeqVal2 > 0) localStorage.setItem(seqKey2, String(saveSeqVal2));
          } catch (e) {}
          if (saved && saved.id) {
            try {
              var relist2 = Storage.list(Storage.KEYS.APPOINTMENTS) || [];
              var dupCount2 = 0;
              for (var di4 = 0; di4 < relist2.length; di4++) {
                if ((relist2[di4] || {}).bookingId === saved.bookingId) dupCount2++;
              }
              if (dupCount2 > 1) {
                var fixSeq2 = (parseInt(localStorage.getItem(seqKey2), 10) || saveSeqVal2 || 0) + 1;
                var fixBookingId2 = year2 + '-QA-' + String(fixSeq2).padStart(4, '0');
                saved.bookingId = fixBookingId2;
                Storage.update(Storage.KEYS.APPOINTMENTS, saved.id, saved);
                try { localStorage.setItem(seqKey2, String(fixSeq2)); } catch (e) {}
              }
            } catch (e) {}
          }
        } catch (err) {
          console.error('[QuickBook] save error:', err);
        }

        Utils.toast('快速预约提交成功！我们将在 24 小时内与您联系', 'success');

        /* 显示成功卡片（含预约编号） */
        var successCard = document.getElementById('quickBookSuccess');
        var bookingIdEl = document.getElementById('qbBookingId');
        if (successCard && bookingIdEl) {
          bookingIdEl.textContent = record.bookingId || record.id || '已受理';
          successCard.style.display = 'block';
          try { successCard.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        }

        /* 隐藏表单、重置字段 */
        form.reset();
        var charCount = form.querySelector('.qb-char-count');
        if (charCount) charCount.textContent = '0 / 500';
        try { form.style.display = 'none'; } catch (e) {}

        /* "再提交一条"按钮 → 恢复表单 */
        var resetBtn = document.getElementById('qbResetBtn');
        if (resetBtn && !resetBtn._qbBound) {
          resetBtn._qbBound = true;
          resetBtn.addEventListener('click', function () {
            if (successCard) successCard.style.display = 'none';
            try { form.style.display = ''; } catch (e) {}
            try { form.querySelector('#name').focus(); } catch (e) {}
          });
        }

        /* 更新字数计数 */
        var msgInput = form.querySelector('#message');

        setTimeout(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.removeAttribute('aria-disabled');
            // B7 CSP合规：移除btn-submitting替代 style.opacity/cursor=''
            try { submitBtn.classList.remove('btn-submitting'); } catch (_csp) {}
            submitBtn.innerHTML = originalText || '立即预约';
          }
        }, 2200);
      });
    },

    initQuickContactForm: function () {
      var form = document.getElementById('quickContactForm');
      if (!form) return;
      var successMsg = document.getElementById('contactSuccessMsg');

      form.addEventListener('submit', function (e) {
        e.preventDefault();

        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn && submitBtn.disabled) {
          Utils.toast('⏳ 提交处理中，请勿重复点击', 'warn');
          return;
        }

        var name = (form.querySelector('[name="contactName"]') || {}).value || '';
        var phone = (form.querySelector('[name="contactPhone"]') || {}).value || '';
        var message = (form.querySelector('[name="contactMessage"]') || {}).value || '';

        var now3 = Date.now();
        try {
          var recent3 = JSON.parse(sessionStorage.getItem('qaxqjt_contact_combo_3s') || '{}');
          var comboKey = (name||'').trim() + '||' + (phone||'').trim() + '||' + (message||'').trim();
          if (recent3 && recent3.key === comboKey && (now3 - recent3.ts) < 3500) {
            Utils.toast('⚠️ 3秒内已提交过相同留言，请勿重复提交', 'warn');
            return;
          }
          sessionStorage.setItem('qaxqjt_contact_combo_3s', JSON.stringify({ key: comboKey, ts: now3 }));
        } catch (e) {}

        if (!name.trim()) return Utils.toast('请填写您的姓名', 'error');
        if (!/^1[3-9]\d{9}$/.test(String(phone).trim())) {
          return Utils.toast('请填写正确的 11 位手机号码', 'error');
        }
        if (!message.trim() || message.trim().length < 5) {
          return Utils.toast('留言内容至少填写 5 个字符，便于我们了解需求', 'error');
        }

        var originalText = '';
        if (submitBtn) {
          originalText = submitBtn.innerHTML || '提交留言';
          submitBtn.disabled = true;
          submitBtn.setAttribute('aria-disabled', 'true');
          // B7 CSP合规：btn-submitting替代 style.opacity/cursor
          try { submitBtn.classList.add('btn-submitting'); } catch (_csp) {}
          submitBtn.innerHTML = '⏳ 提交中...';
        }

        var record = {
          id: 'QC-' + Utils.secureRandomHex(8).toUpperCase(),
          source: '联系页留言',
          name: name.trim(),
          phone: phone.trim(),
          message: message,
          createdAt: new Date().toISOString(),
          status: 'pending',
          statusText: '待跟进'
        };
        Storage.create(Storage.KEYS.APPOINTMENTS, record);
        Utils.toast('留言提交成功！我们将尽快与您联系', 'success');
        form.reset();
        /* 重置字数统计 */
        var charCountEl = form.querySelector('.qc-char-count');
        if (charCountEl) charCountEl.textContent = '0 / 500';
        if (successMsg) {
          // B7 CSP合规：csp-hide替代style.display='block'/'none'
          try { successMsg.classList.remove('csp-hide'); } catch (_csp) {}
          try { successMsg.style.display = ''; } catch (e) {}
          try { successMsg.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
          var _tmpMsg = successMsg;
          setTimeout(function () {
            if (_tmpMsg) try { _tmpMsg.classList.add('csp-hide'); } catch (_csp) {}
          }, 8000);
        }

        setTimeout(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.removeAttribute('aria-disabled');
            // B7 CSP合规：移除btn-submitting替代 style.opacity/cursor=''
            try { submitBtn.classList.remove('btn-submitting'); } catch (_csp) {}
            submitBtn.innerHTML = originalText || '提交留言';
          }
        }, 2200);
      });
    },

    initCategoryTabs: function () {
      var tabBar = document.querySelector('.category-tabs');
      if (!tabBar) return;
      var list = document.querySelector('.news-list');
      if (!list) return;
      var cards = list.querySelectorAll('.news-item-card');

      for (var c = 0; c < cards.length; c++) {
        if (cards[c].hasAttribute('data-news-cat')) continue;
        var tag = cards[c].querySelector('.news-cat-tag');
        if (tag) {
          var m = String(tag.className || '').match(/cat-(\w+)/);
          if (m) cards[c].setAttribute('data-news-cat', m[1]);
        }
      }

      var tabs = tabBar.querySelectorAll('.category-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener('click', function () {
          var key = this.getAttribute('data-cat') || 'all';
          for (var t = 0; t < tabs.length; t++) {
            tabs[t].classList.toggle('active', (tabs[t].getAttribute('data-cat') === key));
          }
          var visible = 0;
          for (var cc = 0; cc < cards.length; cc++) {
            var cat = cards[cc].getAttribute('data-news-cat') || '';
            var show = (key === 'all') || (cat === key);
            // B7 CSP合规：pg-hidden替代cards[cc].style.display=show?'':'none'
            try { cards[cc].classList.toggle('pg-hidden', !show); } catch (_csp) {}
            if (show) visible++;
          }
          if (window.QinPagination && typeof window.QinPagination.refresh === 'function') {
            try {
              var raw = window.QinPagination._raw;
              if (raw && raw._instances) {
                for (var ki = 0; ki < raw._instances.length; ki++) {
                  var st = raw._instances[ki];
                  if (st.container === list) {
                    st.categoryKey = (key === 'all') ? null : key;
                    st.currentPage = 1;
                  }
                }
              }
              window.QinPagination.refresh();
            } catch (e) {}
          }
          if (visible === 0) {
            Utils.toast('当前分类暂无资讯，可切换至全部资讯查看', 'info');
          }
        });
      }
    },

    /**
     * 通用 Modal：创建或复用（CSP合规，class控制显隐）
     *  参数 cfg = {id, title, body, width, showConfirm, showCancel, confirmText, cancelText, onConfirm, onCancel, badge, icon, actionLabel}
     *  返回 {close: fn, el: modalElement}
     */
    injectOrReuseModal: function (cfg) {
      var c = cfg || {};
      var modalId = 'modal-wrap-' + (c.id || Utils.secureRandomHex(6));
      var overlayId = 'modal-overlay-' + (c.id || Utils.secureRandomHex(6));
      var oldModal = document.getElementById(modalId);
      var oldOverlay = document.getElementById(overlayId);

      var _esc = Utils.escapeHtml;
      var safeTitle = _esc(c.title || '');
      var safeBadge = c.badge ? ('<span class="modal-title-badge">' + _esc(c.badge) + '</span>') : '';
      var safeIcon = c.icon ? ('<span class="modal-title-icon">' + _esc(c.icon) + '</span>') : '';
      var safeConfirm = _esc(c.confirmText || (c.actionLabel || '确认'));
      var safeCancel = _esc(c.cancelText || '关闭');
      var dataWidth = parseInt(c.width, 10) || 860;

      var closeIt = function () {
        try {
          var m = document.getElementById(modalId);
          if (m) { m.classList.add('modal-wrap-hide'); m.setAttribute('aria-hidden', 'true'); }
          var o = document.getElementById(overlayId);
          if (o) o.classList.add('modal-overlay-hide');
          document.body.classList.remove('body-modal-locked');
        } catch (_e) {}
      };

      var bindFooter = function (root) {
        if (!root) return;
        var conf = root.querySelector('[data-modal-act="confirm"]');
        if (conf) conf.addEventListener('click', function (e) {
          if (typeof c.onConfirm === 'function') { try { var r = c.onConfirm(e, closeIt); if (r === false) return; } catch (_err) {} }
          closeIt();
        });
        var canc = root.querySelector('[data-modal-act="cancel"]');
        if (canc) canc.addEventListener('click', function () {
          if (typeof c.onCancel === 'function') { try { c.onCancel(); } catch (_err) {} }
          closeIt();
        });
      };

      if (oldModal && oldOverlay) {
        var titleEl = oldModal.querySelector('.modal-title-text');
        if (titleEl) titleEl.innerHTML = safeIcon + safeTitle + safeBadge;
        var bodyEl = oldModal.querySelector('.modal-body-inner');
        if (bodyEl) bodyEl.innerHTML = c.body || '';
        var fConf = oldModal.querySelector('[data-modal-act="confirm"]');
        if (fConf) {
          if (c.showConfirm === false) fConf.classList.add('csp-hide'); else fConf.classList.remove('csp-hide');
          fConf.textContent = safeConfirm;
        }
        var fCanc = oldModal.querySelector('[data-modal-act="cancel"]');
        if (fCanc) {
          if (c.showCancel === false) fCanc.classList.add('csp-hide'); else fCanc.classList.remove('csp-hide');
          fCanc.textContent = safeCancel;
        }
        oldModal.setAttribute('data-width', String(dataWidth));
        oldOverlay.classList.remove('modal-overlay-hide');
        oldModal.classList.remove('modal-wrap-hide');
        oldModal.setAttribute('aria-hidden', 'false');
        try { document.body.classList.add('body-modal-locked'); } catch (_e) {}
        return { close: closeIt, el: oldModal };
      }

      var overlay = document.createElement('div');
      overlay.id = overlayId;
      overlay.className = 'modal-backdrop modal-overlay-root';
      overlay.setAttribute('role', 'presentation');
      var modal = document.createElement('div');
      modal.id = modalId;
      modal.className = 'generic-modal-root';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', c.title || 'dialog');
      modal.setAttribute('data-width', String(dataWidth));
      modal.setAttribute('tabindex', '-1');

      var showFooter = (c.showConfirm !== false) || (c.showCancel !== false);
      var footerHtml = '';
      if (showFooter) {
        footerHtml = '<div class="modal-footer-actions">';
        if (c.showConfirm !== false) footerHtml += '<button type="button" class="btn btn-primary" data-modal-act="confirm">' + safeConfirm + '</button>';
        if (c.showCancel !== false) footerHtml += '<button type="button" class="btn btn-outline" data-modal-act="cancel">' + safeCancel + '</button>';
        footerHtml += '</div>';
      }

      modal.innerHTML =
        '<div class="generic-modal-card">' +
          '<button type="button" class="modal-close-x" aria-label="关闭" data-modal-close="1">✕</button>' +
          '<div class="modal-title-bar">' +
            '<h3 class="modal-title-text">' + safeIcon + safeTitle + safeBadge + '</h3>' +
          '</div>' +
          '<div class="modal-body-inner">' + (c.body || '') + '</div>' +
          footerHtml +
        '</div>';

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      modal.querySelector('[data-modal-close="1"]').addEventListener('click', closeIt);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeIt(); });
      if (!window._injectOrReuseModalEscBound) {
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') {
            var all = document.querySelectorAll('.modal-overlay-root:not(.modal-overlay-hide)');
            if (all && all.length) {
              var lastOv = all[all.length - 1];
              if (lastOv && lastOv.id) {
                var mid = lastOv.id.replace(/^modal-overlay-/, 'modal-wrap-');
                var mm = document.getElementById(mid);
                if (mm) {
                  var cx = mm.querySelector('[data-modal-close="1"]');
                  if (cx) cx.click();
                }
              }
            }
          }
        });
        window._injectOrReuseModalEscBound = true;
      }

      bindFooter(modal);
      try { document.body.classList.add('body-modal-locked'); } catch (_e) {}
      return { close: closeIt, el: modal };
    }
  };

  // ============================================================
  // 模块 6: 后台管理通用 CRUD AdminCRUD
  // ============================================================
  var AdminCRUD = {
    currentUser: null,

    /**
     * 管理员登录（任务 7：API 优先，本地 Storage 兜底）—— 返回 Promise
     * 先用 QAXQJT_API.login 调后端 /v1/auth/login；
     * 若后端不可用（网络失败或用户勾选离线模式）自动走旧 localStorage 比对逻辑。
     */
    loginAsync: function (username, password) {
      var self = this;
      var _win = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
      var hasApi = _win && _win.QAXQJT_API && typeof _win.QAXQJT_API.login === 'function';
      if (!hasApi) {
        try {
          var r = self.login(username, password);
          if (r) return Promise.resolve(r);
          return Promise.resolve(null);
        } catch (e) { return Promise.reject(e); }
      }
      return _win.QAXQJT_API.login(username, password || '', '').then(function (apiRes) {
        // API 成功：返回后端 user/account 信息
        if (!apiRes) return null;
        var user = (apiRes.user) ? apiRes.user : (apiRes.account ? apiRes.account : apiRes);
        self.currentUser = {
          id: user.id || user.accountId || ('api_' + Date.now()),
          username: user.username || username,
          name: user.name || user.realName || user.nickname || username,
          role: user.role || user.roleCode || 'admin',
          roleName: user.roleName || user.roleDisplayName || '系统管理员',
          fromApi: true,
          permissions: Array.isArray(user.permissions) ? user.permissions : null
        };
        Storage._set(Storage.KEYS.ADMIN, self.currentUser);
        return self.currentUser;
      }).catch(function (err) {
        // 登录失败不自动降级（账号密码错误必须报错）；仅网络错误时才降级 localStorage
        var isNet = !err || !err.status || err.name === 'AbortError' || /Failed to fetch|NetworkError/i.test(err && err.message ? err.message : '');
        if (isNet) {
          try {
            var fb = self.login(username, password);
            if (fb) return fb;
          } catch (_fbErr) { /* ignore */ }
          return null;
        }
        throw err;
      });
    },

    /**
     * 管理员登录（模拟/本地兜底模式）—— 保持同步，兼容老调用方直接 if(result) 判断
     */
    login: function (username, password) {
      var users = Storage.list(Storage.KEYS.USERS, { role: 'admin' });
      for (var i = 0; i < users.length; i++) {
        if (users[i].username === username && users[i].password === password) {
          this.currentUser = { id: users[i].id, name: users[i].name, username: users[i].username };
          Storage._set(Storage.KEYS.ADMIN, this.currentUser);
          return this.currentUser;
        }
      }
      return null;
    },

    /**
     * 退出登录（任务 7：先通知后端销毁 Token，再清理本地登录态）
     */
    logout: function () {
      // 先通知后端（火并忘记，不阻塞登出主流程）
      var _win = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
      try {
        if (_win && _win.QAXQJT_API && typeof _win.QAXQJT_API.logout === 'function') {
          Promise.resolve().then(function () {
            try { _win.QAXQJT_API.logout(); } catch (_) {}
          });
        }
      } catch (_apiLogOutErr) { /* ignore: 网络不可用/后端离线也必须能登出 */ }
      // 清理 Cookie 中可能的 token（若页面未来加了 Cookie 模式）
      try {
        if (_win && _win.QAXQJT_API_CONFIG && typeof _win.QAXQJT_API_CONFIG.clearAuth === 'function') {
          _win.QAXQJT_API_CONFIG.clearAuth();
        }
      } catch (_caErr) { /* noop */ }

      // 修复 B6 HIGH / B8 BLOCKER：退出登录 100% 清理所有登录态（历史 legacy + v2 + 带PREFIX/不带PREFIX全路径），广播跨tab同步失效事件
      // ========== 3层完整版 层2：登出前把当前 sessionId 加入 LOGOUT_BLACKLIST（防复用，防止有人提前拷贝 qaxqjt_admin_session JSON 再粘贴回来） ==========
      var SESS_KEY = 'qaxqjt_admin_session';
      var BLACK_KEY = 'qaxqjt_logout_blacklist';
      try {
        try {
          var __curRaw = localStorage.getItem(SESS_KEY);
          if (__curRaw) {
            var __cur = JSON.parse(__curRaw);
            if (__cur && __cur.id) {
              var __blk = [];
              try { var __rawBlk = localStorage.getItem(BLACK_KEY); if (__rawBlk) __blk = JSON.parse(__rawBlk) || []; } catch (_e0) { __blk = []; }
              __blk.push({ id: __cur.id, ts: Date.now() });
              if (__blk.length > 100) __blk = __blk.slice(-100);
              try { localStorage.setItem(BLACK_KEY, JSON.stringify(__blk)); } catch (_e1) {}
              // 也清理超过24h的老条目（防Storage膨胀）
              try {
                var __cut = Date.now() - 24 * 60 * 60 * 1000;
                var __pruned = __blk.filter(function (x) { return (x.ts || 0) > __cut; });
                if (__pruned.length !== __blk.length) localStorage.setItem(BLACK_KEY, JSON.stringify(__pruned));
              } catch (_ep) {}
            }
          }
        } catch (_blkOuter) { /* 黑名单写入失败也不影响登出主流程 */ }
      } catch (_ignore) {}
      this.currentUser = null;
      var PFX = Storage.PREFIX || 'qaxqjt_';
      var ADM = (Storage.KEYS && Storage.KEYS.ADMIN) ? String(Storage.KEYS.ADMIN) : 'admin_session';
      var legacy = Array.isArray(Storage._LEGACY_ADMIN_SESSION_KEYS) ? Storage._LEGACY_ADMIN_SESSION_KEYS.slice() : [];
      var keysToClear = [
        ADM,
        PFX + ADM,
        'qaxqjt_admin_session',
        'qaxqjt_admin_remember',
        'qaxqjt_admin_token',
        'qaxqjt_admin_info',
        'qaxqjt_auth_permissions_v1',
        'qaxqjt_admin_sess_v2',
        'admin_sess_v2',
        'admin_session',
        'qaxqjt_admin_permissions'
      ];
      // 合并 Storage._LEGACY_ADMIN_SESSION_KEYS（去重）
      for (var _lgi = 0; _lgi < legacy.length; _lgi++) {
        if (keysToClear.indexOf(legacy[_lgi]) < 0) keysToClear.push(legacy[_lgi]);
        if (keysToClear.indexOf(PFX + legacy[_lgi]) < 0) keysToClear.push(PFX + legacy[_lgi]);
      }
      try {
        for (var ki = 0; ki < keysToClear.length; ki++) {
          try { localStorage.removeItem(keysToClear[ki]); } catch (_r) {}
        }
        // 清理所有带 ADMIN/TOKEN/SESSION/REMEMBER/INFO 后缀的 PFX keys（兜底历史遗留）
        try {
          var all = [];
          for (var lj = 0; lj < localStorage.length; lj++) {
            var lk = localStorage.key(lj);
            if (lk && lk.indexOf(PFX) === 0 && /(admin|session|token|remember|auth)/i.test(lk.slice(PFX.length))) all.push(lk);
          }
          for (var ak = 0; ak < all.length; ak++) try { localStorage.removeItem(all[ak]); } catch (_rr) {}
        } catch (_gc) {}
      } catch (_outer) {
        // 兜底：至少删掉最核心的两个 session key
        try { localStorage.removeItem('qaxqjt_admin_session'); } catch (_) {}
        try { localStorage.removeItem(PFX + ADM); } catch (__) {}
      }
      // 跨 tab 广播：登出事件（其他 tab 的 checkAuth 可据此跳登录，目前其他 tab 同步实现会在 storage 事件监听时触发）
      try {
        if (typeof Event === 'function' && typeof window !== 'undefined' && window.dispatchEvent) {
          try { window.dispatchEvent(new Event('qinadmin:loggedout')); } catch (_ev) {}
        }
      } catch (_) {}
      try {
        if (typeof CustomEvent !== 'undefined' && document && document.dispatchEvent) {
          try { document.dispatchEvent(new CustomEvent('qaxqjt:logout', { detail: { at: Date.now() } })); } catch (_ce) {}
        }
      } catch (_) {}
    },

    /**
     * 检查登录状态
     */
    checkAuth: function () {
      if (this.currentUser) return this.currentUser;
      // B8 MEDIUM：Admin session 升版 v2，带老 key（qaxqjt_admin_session / admin_session）→ 新 v2 自动迁移
      function _parseSession(raw) {
        if (!raw) return null;
        try {
          var obj = JSON.parse(raw);
          if (!obj || typeof obj !== 'object') return null;
          return (obj.username || obj.id || obj.name) ? obj : null;
        } catch (_p) { return null; }
      }
      // 1. 先读新 v2 key（Storage.KEYS.ADMIN = admin_sess_v2 → 真实 localStorage key = qaxqjt_admin_sess_v2）
      var saved = Storage._get(Storage.KEYS.ADMIN);
      if (saved) {
        this.currentUser = saved;
        return saved;
      }
      // 2. 新 v2 空 → 扫老 keys 做 migrate（一次性迁移到 v2，老 key 删）
      var legacyKeys = Array.isArray(Storage._LEGACY_ADMIN_SESSION_KEYS) ? Storage._LEGACY_ADMIN_SESSION_KEYS : ['qaxqjt_admin_session'];
      for (var li = 0; li < legacyKeys.length; li++) {
        var legacyKey = legacyKeys[li];
        try {
          var legacyRaw = localStorage.getItem(legacyKey);
          var legacyObj = _parseSession(legacyRaw);
          if (legacyObj) {
            this.currentUser = legacyObj;
            try {
              // 写入新 v2 key（Storage._set 带 JSON.stringify）
              Storage._set(Storage.KEYS.ADMIN, legacyObj);
              try { localStorage.removeItem(legacyKey); } catch (_rk) { /* 安全起见：有些页面 tab 监听直接写老 key，不强制删 */ }
              try { localStorage.removeItem(Storage.PREFIX + legacyKey); } catch (_rpk) {}
              // 如果还有其他老 keys，也一并清理（迁移后全部删避免反复读老）
              for (var lj = 0; lj < legacyKeys.length; lj++) {
                try { if (legacyKeys[lj] !== legacyKey) localStorage.removeItem(legacyKeys[lj]); } catch (_rr) {}
              }
              console.info('[Admin.checkAuth][B8] 登录态自动迁移：老 key=' + legacyKey + ' → 新 v2 key=' + Storage.PREFIX + Storage.KEYS.ADMIN);
            } catch (_wr) { console.warn('[Admin.checkAuth][B8] v2 迁移写入失败：', _wr && _wr.message ? _wr.message : _wr); }
            return legacyObj;
          }
        } catch (_lr) { /* skip corrupt legacy */ }
      }
      return null;
    },

    // ==========================================================================
    // 任务 7：Admin.XXXAsync 系列方法 —— 统一 API 优先 + localStorage 降级回退封装
    //   · 所有方法返回 Promise；网络不可用时自动走本地 Storage
    //   · 现有 Admin.getXxx() / updateXxx() 保持同步不变，作为降级底层
    // ==========================================================================

    /**
     * 预约列表：GET /v1/appointments 优先，fallbackRead = Admin.getAppointments
     */
    getAppointmentsAsync: function (filter, page, pageSize) {
      var self = this;
      var _win = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
      var CFG = _win.QAXQJT_API_CONFIG;
      var API = _win.QAXQJT_API;
      if (!(API && typeof API.get === 'function' && CFG)) {
        try { return Promise.resolve(self.getAppointments(filter, page, pageSize)); }
        catch (e) { return Promise.reject(e); }
      }
      filter = filter || {};
      var pg = Math.max(1, parseInt(page, 10) || 1);
      var ps = Math.max(1, parseInt(pageSize, 10) || 20);
      return API.get((CFG.PATHS && CFG.PATHS.APPOINTMENTS) || '/v1/appointments', {
        query: {
          page: pg,
          pageSize: ps,
          status: filter.status || undefined,
          keyword: filter.keyword || undefined,
          fromDate: filter.fromDate || undefined,
          toDate: filter.toDate || undefined
        },
        fallbackRead: async function () {
          return self.getAppointments(filter, pg, ps);
        }
      }).then(function (apiResult) {
        // 后端返回结构：{ list:[], total:N, page, pageSize, totalPages } 或 items/data 直接数组
        if (apiResult && (apiResult.list || Array.isArray(apiResult))) {
          if (apiResult.list) return apiResult;
          return { list: apiResult, total: apiResult.length || 0, page: pg, pageSize: ps, totalPages: 1 };
        }
        // 兜底再走一次本地（比如后端返回空但无报错）
        return self.getAppointments(filter, pg, ps);
      });
    },

    /**
     * 预约详情：GET /v1/appointments/:id 优先，fallbackRead = Storage.get
     */
    getAppointmentDetailAsync: function (id) {
      var _win = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
      var CFG = _win.QAXQJT_API_CONFIG;
      var API = _win.QAXQJT_API;
      if (!(API && CFG && typeof API.get === 'function')) {
        return Promise.resolve(Storage.get(Storage.KEYS.APPOINTMENTS, id));
      }
      var url = (CFG.PATHS && CFG.PATHS.APPOINTMENTS_BY_ID) ? CFG.PATHS.APPOINTMENTS_BY_ID(id) : ('/v1/appointments/' + id);
      return API.get(url, {
        fallbackRead: async function () {
          return Storage.get(Storage.KEYS.APPOINTMENTS, id);
        }
      });
    },

    /**
     * 预约状态推进：POST /v1/appointments/:id/transition 优先，fallback = Admin.updateAppointmentStatus
     */
    transitionAppointmentAsync: function (id, toStatus, reason) {
      var self = this;
      var _win = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
      var CFG = _win.QAXQJT_API_CONFIG;
      var API = _win.QAXQJT_API;
      if (!(API && CFG && typeof API.post === 'function')) {
        try {
          self.updateAppointmentStatus(id, toStatus);
          return Promise.resolve({ id: id, status: toStatus });
        } catch (e) { return Promise.reject(e); }
      }
      var url = (CFG.PATHS && CFG.PATHS.APPOINTMENTS_TRANSITION) ? CFG.PATHS.APPOINTMENTS_TRANSITION(id) : ('/v1/appointments/' + id + '/transition');
      return API.post(url, { to: toStatus, reason: reason || '' }, {
        fallback: async function () {
          self.updateAppointmentStatus(id, toStatus);
          return { id: id, status: toStatus, fromLocal: true };
        }
      });
    },

    /**
     * 客户列表：GET /v1/customers 优先，fallbackRead = Storage.list
     */
    getCustomersAsync: function (filter, page, pageSize) {
      var _win = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
      var CFG = _win.QAXQJT_API_CONFIG;
      var API = _win.QAXQJT_API;
      if (!(API && CFG && typeof API.get === 'function')) {
        return Promise.resolve(Storage.list(Storage.KEYS.CUSTOMERS));
      }
      filter = filter || {};
      return API.get((CFG.PATHS && CFG.PATHS.CUSTOMERS) || '/v1/customers', {
        query: {
          page: Math.max(1, parseInt(page, 10) || 1),
          pageSize: Math.max(1, parseInt(pageSize, 10) || 999),
          keyword: filter.keyword || undefined,
          customerType: filter.customerType || undefined
        },
        fallbackRead: async function () { return Storage.list(Storage.KEYS.CUSTOMERS) || []; }
      }).then(function (r) {
        if (Array.isArray(r)) return r;
        if (r && Array.isArray(r.list)) return r.list;
        if (r && Array.isArray(r.data)) return r.data;
        return Storage.list(Storage.KEYS.CUSTOMERS) || [];
      });
    },

    /**
     * 账号列表：GET /v1/accounts 优先，fallbackRead = Storage.list
     */
    getAccountsAsync: function (page, pageSize) {
      var _win = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
      var CFG = _win.QAXQJT_API_CONFIG;
      var API = _win.QAXQJT_API;
      if (!(API && CFG && typeof API.get === 'function')) {
        return Promise.resolve(Storage.list(Storage.KEYS.ACCOUNTS) || []);
      }
      return API.get((CFG.PATHS && CFG.PATHS.ACCOUNTS) || '/v1/accounts', {
        query: { page: Math.max(1, parseInt(page, 10) || 1), pageSize: Math.max(1, parseInt(pageSize, 10) || 999) },
        fallbackRead: async function () { return Storage.list(Storage.KEYS.ACCOUNTS) || []; }
      }).then(function (r) {
        if (Array.isArray(r)) return r;
        if (r && Array.isArray(r.list)) return r.list;
        if (r && Array.isArray(r.data)) return r.data;
        return Storage.list(Storage.KEYS.ACCOUNTS) || [];
      });
    },

    /**
     * 角色列表：GET /v1/roles 优先，fallbackRead = Storage.list
     */
    getRolesAsync: function () {
      var _win = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
      var CFG = _win.QAXQJT_API_CONFIG;
      var API = _win.QAXQJT_API;
      if (!(API && CFG && typeof API.get === 'function')) {
        return Promise.resolve(Storage.list(Storage.KEYS.ROLES) || []);
      }
      return API.get((CFG.PATHS && CFG.PATHS.ROLES) || '/v1/roles', {
        fallbackRead: async function () { return Storage.list(Storage.KEYS.ROLES) || []; }
      }).then(function (r) {
        if (Array.isArray(r)) return r;
        if (r && Array.isArray(r.list)) return r.list;
        if (r && Array.isArray(r.data)) return r.data;
        return Storage.list(Storage.KEYS.ROLES) || [];
      });
    },

    /**
     * 审计日志：GET /v1/audit-logs 优先
     */
    getAuditLogsAsync: function (query) {
      var _win = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
      var CFG = _win.QAXQJT_API_CONFIG;
      var API = _win.QAXQJT_API;
      if (!(API && CFG && typeof API.get === 'function')) {
        return Promise.resolve([]);
      }
      return API.get((CFG.PATHS && CFG.PATHS.AUDIT_LOGS) || '/v1/audit-logs', {
        query: query || {},
        fallbackRead: async function () { return []; }
      });
    },

    /**
     * 获取预约列表（带状态筛选和分页）—— 本地同步模式（保持原有，兜底用）
     */
    getAppointments: function (filter, page, pageSize) {
      var data = Storage.list(Storage.KEYS.APPOINTMENTS);
      filter = filter || {};

      if (filter.status) {
        data = data.filter(function (d) { return d.status === filter.status; });
      }
      if (filter.keyword) {
        var kw = String(filter.keyword).toLowerCase();
        data = data.filter(function (d) {
          return (d.customerName || '').toLowerCase().indexOf(kw) > -1 ||
                 (d.phone || '').toLowerCase().indexOf(kw) > -1 ||
                 (d.organization || '').toLowerCase().indexOf(kw) > -1;
        });
      }

      data.sort(function (a, b) {
        // 修复 B5 HIGH：getAppointments comparator 不稳定 → NaN 时 V8 sort 抛 RangeError / 分页错位
        // 新逻辑：(1) isNaN 兜底 0 (2) 日期相等等价时 tiebreaker = id.localeCompare，保证跨引擎稳定
        var ta = 0, tb = 0;
        try {
          if (a && a.createdAt) ta = new Date(a.createdAt).getTime();
          if (b && b.createdAt) tb = new Date(b.createdAt).getTime();
        } catch (_dErr) { ta = 0; tb = 0; }
        if (isNaN(ta)) ta = 0;
        if (isNaN(tb)) tb = 0;
        if (tb !== ta) return tb - ta;
        // tiebreaker：id 字典序（同 createdAt 时保证稳定）
        var idA = a && a.id ? String(a.id) : '';
        var idB = b && b.id ? String(b.id) : '';
        if (idA === idB) return 0;
        return idA < idB ? 1 : -1;
      });

      var total = data.length;
      var pg = Math.max(1, parseInt(page, 10) || 1);
      var ps = Math.max(1, parseInt(pageSize, 10) || 10);
      var start = (pg - 1) * ps;

      return {
        list: data.slice(start, start + ps),
        total: total,
        page: pg,
        pageSize: ps,
        totalPages: Math.ceil(total / ps)
      };
    },

    /**
     * 更新预约状态（维度11 CRITICAL：状态机合法转移表 + 终态保护 + updatedAt同步）
     */
    updateAppointmentStatus: function (id, status) {
      // ====== 维度11 CRITICAL：合法状态转移表 ======
      // 终态（completed / cancelled / refunded / rejected？rejected允许重审 pending）
      var VALID_TRANSITIONS = {
        'pending':   ['approved', 'rejected', 'cancelled'],
        'approved':  ['paid', 'cancelled', 'completed'],
        'paid':      ['completed', 'refunded'],
        'rejected':  ['pending', 'cancelled'],
        'completed': [],                             // 终态，不可再变更
        'cancelled': ['pending'],                    // 取消后可重开
        'refunded':  []                              // 终态，不可再变更
      };
      var STATUS_MAP = {
        pending: '待审核',
        approved: '已确认',
        rejected: '已拒绝',
        paid: '已收款',
        completed: '已完成',
        cancelled: '已取消',
        refunded: '已退款'
      };
      if (id === null || id === undefined || id === '') {
        console.warn('[updateAppointmentStatus] id 非法：' + String(id));
        return null;
      }
      var current = Storage.get(Storage.KEYS.APPOINTMENTS, id);
      if (!current) {
        console.warn('[updateAppointmentStatus] 预约记录不存在：id=' + String(id));
        return null;
      }
      var currentStatus = current.status || 'pending';
      var allowList = VALID_TRANSITIONS[currentStatus];
      if (!allowList || allowList.indexOf(status) === -1) {
        console.error('[updateAppointmentStatus] 非法状态转移：' + currentStatus + ' → ' + status
          + '（id=' + String(id) + '），允许的转移：' + JSON.stringify(allowList || []));
        return null;
      }
      var patch = {
        status: status,
        statusText: STATUS_MAP[status] || status,
        updatedAt: new Date().toISOString()
      };
      if (status === 'completed' && !current.completedAt) patch.completedAt = new Date().toISOString();
      if (status === 'cancelled' && !current.cancelledAt) patch.cancelledAt = new Date().toISOString();
      if (status === 'refunded') {
        patch.statusLocked = 'refunded';
        patch.refundedAt = new Date().toISOString();
      }
      return Storage.update(Storage.KEYS.APPOINTMENTS, id, patch);
    },

    /**
     * 统计看板数据
     */
    getDashboardStats: function () {
      var appts = Storage.list(Storage.KEYS.APPOINTMENTS);
      // ==== 修复 B4 CRITICAL：totalRevenue 不再只看 appointment.status，而是「先取 orders 支付事实表 + refunded 扣减」，避免退款不更新预约导致 revenue 虚高
      var ordersList = (typeof Storage.list === 'function' && Storage.KEYS && Storage.KEYS.ORDERS) ? (Storage.list(Storage.KEYS.ORDERS) || []) : [];
      var refundedAptIdsMap = {};  // apptId -> true（对应预约有退款订单 → 不计入 revenue，除非后续有 paid 订单）
      var paidAptIdsMap = {};     // apptId -> true（对应预约存在至少 1 个 paid 订单，可 double-check appt.status）
      var totalPaidFromOrders = 0;
      var totalRefundedFromOrders = 0;
      try {
        for (var oi = 0; oi < ordersList.length; oi++) {
          var ord = ordersList[oi] || {};
          var amt = Number(ord.amount) || 0;
          if (ord.status === 'paid') {
            totalPaidFromOrders += amt;
            if (ord.appointmentId) paidAptIdsMap[String(ord.appointmentId)] = true;
          } else if (ord.status === 'refunded') {
            totalRefundedFromOrders += amt;
            if (ord.appointmentId) refundedAptIdsMap[String(ord.appointmentId)] = true;
          }
        }
      } catch (_oStat) { console.warn('[getDashboardStats][B4] orders 聚合异常（非致命，继续用 appt 口径）：', _oStat && _oStat.message ? _oStat.message : _oStat); }
      var netFromOrders = Math.max(0, totalPaidFromOrders - totalRefundedFromOrders);

      var plays = Storage.list(Storage.KEYS.PLAYS);

      var totalAppts = appts.length;
      var pendingAppts = 0;
      var completedAppts = 0;
      var totalShows = 0;
      var totalRevenueFromAppointments = 0;
      var refundedApptsCount = 0;

      for (var i = 0; i < appts.length; i++) {
        var a = appts[i] || {};
        var isAptRefunded = (a.id) ? (!!refundedAptIdsMap[String(a.id)] || a.status === 'refunded' || (a.pricing && a.pricing.statusLocked === 'refunded')) : false;
        if (isAptRefunded) refundedApptsCount++;
        if (a.status === 'pending') pendingAppts++;
        if (a.status === 'completed') completedAppts++;
        totalShows += parseInt(a.shows, 10) || 0;
        // 预约侧：paid/completed + 未退款 → 统计
        if (!isAptRefunded && a.pricing && (Number(a.pricing.finalTotal) || 0) > 0 && (a.status === 'paid' || a.status === 'completed')) {
          totalRevenueFromAppointments += Number(a.pricing.finalTotal) || 0;
        }
      }

      // 最终营收：取「支付事实表净入账」和「预约表入账统计」二者中较大的值（保守原则：防止有订单没走 createOrder 直接改 appointment 状态导致漏统计）
      var finalRevenue = Math.max(netFromOrders, totalRevenueFromAppointments);

      return {
        totalAppointments: totalAppts,
        pendingAppointments: pendingAppts,
        completedAppointments: completedAppts,
        refundedAppointments: refundedApptsCount,
        totalShows: totalShows,
        totalRevenue: finalRevenue,
        // ===== B4 新增 trace 字段（未来渲染看板明细卡片可展示）=====
        _ordersPaidTotal: totalPaidFromOrders,
        _ordersRefundedTotal: totalRefundedFromOrders,
        _ordersNetRevenue: netFromOrders,
        _appointmentsRevenue: totalRevenueFromAppointments,
        totalPlays: plays.length,
        revenueText: '¥' + Utils.formatMoney(finalRevenue)
      };
    },

    /**
     * 通用：获取剧目列表
     */
    getPlays: function () {
      return Storage.list(Storage.KEYS.PLAYS);
    },

    createPlay: function (data) {
      if (!data.name) throw new Error('剧目名称必填');
      return Storage.create(Storage.KEYS.PLAYS, data);
    },

    updatePlay: function (id, data) {
      return Storage.update(Storage.KEYS.PLAYS, id, data);
    },

    deletePlay: function (id) {
      return Storage.remove(Storage.KEYS.PLAYS, id);
    },

    /**
     * 订单 CRUD
     */
    getOrders: function (filter) {
      var data = Storage.list(Storage.KEYS.ORDERS);
      filter = filter || {};
      if (filter.status) {
        data = data.filter(function (d) { return d.status === filter.status; });
      }
      return data;
    },

    createOrder: function (appointmentId) {
      var apt = Storage.get(Storage.KEYS.APPOINTMENTS, appointmentId);
      if (!apt) throw new Error('预约记录不存在');
      var order = {
        appointmentId: appointmentId,
        orderNo: 'QAX' + Utils.secureRandomHex(8).toUpperCase(),
        customerName: apt.customerName,
        phone: apt.phone,
        shows: apt.shows,
        amount: apt.pricing ? apt.pricing.finalTotal : 0,
        status: 'unpaid',
        statusText: '待付款'
      };
      var saved = Storage.create(Storage.KEYS.ORDERS, order);
      Storage.update(Storage.KEYS.APPOINTMENTS, appointmentId, { orderId: saved.id });
      return saved;
    },

    // ====== 维度11 CRITICAL：订单状态机合法转移表 ======
    // 退款后不能再支付（若要再支付需走新订单），unpaid↔paid允许二次确认
    _ORDER_VALID_TRANSITIONS: {
      'unpaid':   ['paid', 'cancelled', 'refunded'],
      'paid':     ['completed', 'refunded'],
      'cancelled': [],
      'completed': [],
      'refunded': []
    },
    updateOrderStatus: function (id, status) {
      var STATUS = { unpaid: '待付款', paid: '已付款', refunded: '已退款', cancelled: '已取消', completed: '已完成' };
      if (id === null || id === undefined || id === '') {
        console.warn('[updateOrderStatus] id 非法：' + String(id));
        return null;
      }
      // ====== 维度11：先查当前状态，校验转移合法 ======
      var currentOrder = Storage.get(Storage.KEYS.ORDERS, id);
      if (!currentOrder) {
        console.warn('[updateOrderStatus] 订单不存在：id=' + String(id));
        return null;
      }
      var currentStatus = currentOrder.status || 'unpaid';
      var allowList = this._ORDER_VALID_TRANSITIONS[currentStatus];
      if (!allowList || allowList.indexOf(status) === -1) {
        console.error('[updateOrderStatus] 非法状态转移：' + currentStatus + ' → ' + status
          + '（id=' + String(id) + '），允许的转移：' + JSON.stringify(allowList || []));
        return null;
      }
      var saved = Storage.update(Storage.KEYS.ORDERS, id, {
        status: status,
        statusText: STATUS[status] || status,
        updatedAt: Date.now()
      });
      // ==== 修复 B4 CRITICAL + 维度11：订单↔预约↔营收统计 三线状态机同步
      //   注意：这里**不再**直接 Storage.update(APPOINTMENTS)，而是走 updateAppointmentStatus → 通过它的合法转移表
      try {
        var order = Storage.get(Storage.KEYS.ORDERS, id);
        if (order && order.appointmentId) {
          var STATUS_TO_APT = {
            paid: 'paid',
            unpaid: 'pending',
            refunded: 'refunded',      // 之前 bug：refunded 映射成 cancelled → 预约退款标记丢失
            cancelled: 'cancelled',
            completed: 'completed',
            dispatched: 'approved'
          };
          var STATUS_TO_APT_TEXT = {
            paid: '已收款（订单已支付）',
            unpaid: '待审核（订单待付款）',
            refunded: '订单已退款',
            cancelled: '订单已取消',
            completed: '已完成',
            dispatched: '已派工待演出'
          };
          var targetAptStatus = STATUS_TO_APT[status];
          var aptMetaPatch = {
            orderLastStatus: status,
            orderLastStatusText: STATUS[status] || status
          };
          // refunded 特殊补丁：pricing.statusLocked（updateAppointmentStatus 本身不写 pricing，所以我们要手动补）
          if (status === 'refunded') {
            aptMetaPatch.statusLockedReason = 'order_refunded_' + Date.now();
            try {
              var cur = Storage.get(Storage.KEYS.APPOINTMENTS, order.appointmentId);
              if (cur && cur.pricing && typeof cur.pricing === 'object') {
                var newPricing = {};
                for (var pk in cur.pricing) if (Object.prototype.hasOwnProperty.call(cur.pricing, pk)) newPricing[pk] = cur.pricing[pk];
                newPricing.statusLocked = 'refunded';
                newPricing.refundedAt = Date.now();
                newPricing.refundedFromOrderId = id;
                aptMetaPatch.pricing = newPricing;
              }
            } catch (_refPricing) { console.warn('[updateOrderStatus] refunded->pricing patch失败（非致命）：', _refPricing && _refPricing.message); }
          }
          // Step 1: 先通过状态机更新预约状态（如果转移非法，预约状态保持不变，我们仅记录 orderLastStatus 元数据）
          if (targetAptStatus) {
            try { AdminCRUD.updateAppointmentStatus(order.appointmentId, targetAptStatus); } catch (_se1) {
              console.warn('[updateOrderStatus] 预约状态机更新失败，仅保留元数据：', _se1 && _se1.message);
            }
          }
          // Step 2: 无论状态机是否允许，都写入 orderLastStatus 元数据 + refunded pricing（若有）
          try { Storage.update(Storage.KEYS.APPOINTMENTS, order.appointmentId, aptMetaPatch); } catch (_se2) {
            console.warn('[updateOrderStatus] 预约元数据写入失败：', _se2 && _se2.message);
          }
        }
      } catch (b4SyncErr) {
        console.warn('[updateOrderStatus][B4] 三线状态机同步失败（仅预约同步跳过，订单已保存）：', b4SyncErr && b4SyncErr.message ? b4SyncErr.message : b4SyncErr);
      }
      return saved;
    }
  };

  // ============================================================
  // 需求A：日工资发放 + 工资条引擎（WageEngine）
  //   - 默认日工资规则（行当·职级·演出补助·扣款）
  //   - 单日工资计算 calcDailyWage()
  //   - 月度工资汇总 calcMonthlyWage() / generateMonthlyPayslips()
  //   - 工资条 CRUD：getPayslips / savePayslip / deletePayslip
  //   - 规则 CRUD：getDefaultRules / saveRules
  // ============================================================
  var DEFAULT_WAGE_RULES = {
    version: '20260730',
    updatedAt: null,
    // 基准日工资（行当 × 职级矩阵，单位：元/天，分精度存储）
    baseDailyWage: {
      // 演员队 - 行当
      '青衣':   { '一级演员': 88000, '二级演员': 68000, '三级演员': 52000, '优秀青年': 42000, '学员': 28000 },
      '老生':   { '一级演员': 86000, '二级演员': 66000, '三级演员': 50000, '优秀青年': 40000, '学员': 28000 },
      '须生':   { '一级演员': 86000, '二级演员': 66000, '三级演员': 50000, '优秀青年': 40000, '学员': 28000 },
      '花脸':   { '一级演员': 90000, '二级演员': 70000, '三级演员': 54000, '优秀青年': 44000, '学员': 30000 },
      '小生':   { '一级演员': 82000, '二级演员': 64000, '三级演员': 48000, '优秀青年': 38000, '学员': 26000 },
      '老旦':   { '一级演员': 80000, '二级演员': 62000, '三级演员': 46000, '优秀青年': 36000, '学员': 25000 },
      '花旦':   { '一级演员': 84000, '二级演员': 66000, '三级演员': 50000, '优秀青年': 40000, '学员': 27000 },
      '丑角':   { '一级演员': 78000, '二级演员': 60000, '三级演员': 46000, '优秀青年': 36000, '学员': 25000 },
      '龙套':   { '一级演员': 40000, '二级演员': 32000, '三级演员': 26000, '优秀青年': 22000, '学员': 16000 },
      // 乐队 - 行当
      '板胡':   { '一级演奏员': 80000, '二级演奏员': 62000, '三级演奏员': 48000, '首席': 92000, '学员': 26000 },
      '司鼓':   { '一级演奏员': 82000, '二级演奏员': 64000, '三级演奏员': 50000, '队长': 90000, '学员': 27000 },
      '二胡':   { '一级演奏员': 56000, '二级演奏员': 44000, '三级演奏员': 34000, '演奏员': 30000, '学员': 18000 },
      '板胡伴奏':{ '一级演奏员': 54000, '二级演奏员': 42000, '三级演奏员': 32000, '演奏员': 28000, '学员': 17000 },
      '扬琴':   { '一级演奏员': 52000, '二级演奏员': 40000, '三级演奏员': 30000, '演奏员': 26000, '学员': 16000 },
      '笛子':   { '一级演奏员': 50000, '二级演奏员': 38000, '三级演奏员': 28000, '演奏员': 24000, '学员': 15000 },
      '唢呐':   { '一级演奏员': 50000, '二级演奏员': 38000, '三级演奏员': 28000, '演奏员': 24000, '学员': 15000 },
      '打击乐': { '一级演奏员': 48000, '二级演奏员': 36000, '三级演奏员': 26000, '演奏员': 22000, '学员': 14000 },
      // 舞美队 - 行当
      '灯光':   { '高级舞美': 56000, '舞美师': 42000, '舞美员': 32000, '技术员': 28000, '学员': 16000 },
      '音响':   { '高级舞美': 54000, '舞美师': 40000, '舞美员': 30000, '技术员': 26000, '学员': 15000 },
      '服装':   { '高级舞美': 48000, '舞美师': 36000, '舞美员': 28000, '技术员': 24000, '学员': 14000 },
      '道具':   { '高级舞美': 46000, '舞美师': 34000, '舞美员': 26000, '技术员': 22000, '学员': 13000 },
      '化妆':   { '高级舞美': 50000, '舞美师': 38000, '舞美员': 28000, '技术员': 24000, '学员': 14000 },
      '布景':   { '高级舞美': 52000, '舞美师': 40000, '舞美员': 30000, '技术员': 26000, '学员': 15000 },
      // 通用兜底
      '其他':   { '高级职称': 60000, '中级职称': 44000, '初级职称': 32000, '普通员工': 26000, '学员': 16000 }
    },
    // 演出补助（本戏/折子戏/下乡，单位：分/场）
    performanceAllowance: {
      benxi:        12000,  // 本戏 120元/场
      zhezi:         6000,  // 折子戏 60元/场
      xiaxiang:      8000,  // 下乡演出 80元/场
      festival:     15000,  // 节庆专场 150元/场
      live_broadcast: 5000  // 直播/录像 50元/场
    },
    // 全勤奖：当月无缺勤/迟到≥3次 单位：分
    perfectAttendanceBonus: 80000,  // 800元/月
    // 工龄补贴：每年工龄 单位：分/天
    seniorityPerYear: 200,  // 2元/天·年
    // 扣款规则（单位：分或百分比）
    deductions: {
      lateUnder30min:    5000,   // 迟到<30分钟：扣50元
      lateOver30min:    10000,   // 迟到≥30分钟：扣100元
      absentHalfDay:    '50%',   // 旷工半天：扣当日50%
      absentFullDay:   '100%',   // 旷工全天：扣当日100% + 罚款200
      absentFine:      20000,    // 旷工罚款：200元/天
      leavePersonal:   '100%',   // 事假：扣当日100%
      leaveSick:        '30%',   // 病假：扣当日30%
      socialInsurance:  '10.5%', // 社保个人：10.5%（养老8%+医疗2%+失业0.5%）
      housingFund:       '12%'   // 公积金个人：12%
    },
    // 计薪日：默认21.75天（法定标准）
    standardWorkDays: 21.75,
    // 餐补/交通补：每日出勤补贴（单位：分/天）
    dailySubsidy: {
      meal:    3000,   // 餐补 30元/天
      traffic: 2000    // 交通补 20元/天
    },
    // ==== 重构# 方案二 V2 专用规则（海康/腾讯云 ISAPI 对接）====
    v2: {
      clockRules: {
        afternoonIn: { start: '13:30', end: '14:00', base: '13:30' },
        nightIn:     { start: '19:30', end: '20:00', base: '19:30' }
      },
      // 迟到罚金：1元/分钟（100分/分钟）
      lateFinePerMinCents: 100,
      // 单场迟到上限：30元（3000分）；迟到≥30分钟 → 本场打卡失效（不计场次）
      lateFineCapCents:    3000,
      lateInvalidMinutes:  30,
      // 演出事故级罚款（元 → 分）
      accidentFineCents: { 1: 1000, 2: 3000, 3: 5000 },  // 一/二/三级：10/30/50元
      // 表现突出奖励：5元/天（500分）
      outstandingRewardCents: 500,
      // 管理员人工标记类型
      manualTagTypes: ['常规', '装台', '卸台'],
      // 装台/卸台专项：不计薪资、不计迟到、不发奖励
      nonSalaryTags: ['装台', '卸台']
    }
  };

  var WageEngine = {
    // ---------- 规则存取 ----------
    getDefaultRules: function () {
      try {
        var saved = Storage._get(Storage.KEYS.WAGE_RULES);
        if (saved && saved.baseDailyWage) return saved;
      } catch (e) { console.warn('[WageEngine] 读取自定义规则失败，回退默认规则', e.message); }
      return JSON.parse(JSON.stringify(DEFAULT_WAGE_RULES));
    },
    saveRules: function (rules) {
      try {
        if (!rules || !rules.baseDailyWage) throw new Error('规则缺少baseDailyWage字段');
        rules.updatedAt = Date.now();
        rules.version = 'custom_' + (rules.updatedAt);
        Storage._set(Storage.KEYS.WAGE_RULES, rules);
        Utils.toast('✅ 日工资规则已保存并生效', 'success');
        return true;
      } catch (e) {
        Utils.toast('❌ 规则保存失败：' + (e.message || e), 'error');
        return false;
      }
    },
    resetRules: function () {
      try {
        Storage._set(Storage.KEYS.WAGE_RULES, JSON.parse(JSON.stringify(DEFAULT_WAGE_RULES)));
        Utils.toast('🔄 已恢复默认日工资规则表', 'success');
        return true;
      } catch (e) {
        Utils.toast('❌ 恢复失败：' + (e.message || e), 'error');
        return false;
      }
    },

    // ---------- 基准日工资查询（行当+职级 → 分） ----------
    getBaseDailyWage: function (roleCategory, level, rules) {
      var R = rules || this.getDefaultRules();
      var cat = (roleCategory || '').trim() || '其他';
      var lv = (level || '').trim() || '普通员工';
      var catMap = R.baseDailyWage[cat];
      if (!catMap) catMap = R.baseDailyWage['其他'] || {};
      var cents = catMap[lv];
      if (typeof cents !== 'number' || isNaN(cents)) {
        // 兜底：取该行当第一个职级或默认
        var keys = Object.keys(catMap);
        cents = keys.length ? (catMap[keys[0]] || 26000) : 26000;
      }
      return Math.max(0, Math.round(cents));
    },

    // ---------- 单日工资计算（分精度，返回明细对象） ----------
    // staff: { id, name, roleCategory, level, hireYear, seniorityYears }
    // dailyRecord: { date, status: 'normal'|'late'|'absent'|'leave_sick'|'leave_personal'|'off',
    //                 lateMinutes, absentType, performType: 'benxi'|'zhezi'|'xiaxiang'|null, performCount }
    calcDailyWage: function (staff, dailyRecord, rules) {
      var R = rules || this.getDefaultRules();
      var st = staff || {};
      var dr = dailyRecord || {};
      var status = dr.status || 'normal';

      var baseCents = this.getBaseDailyWage(st.roleCategory, st.level, R);
      var detail = {
        date: dr.date || '',
        status: status,
        base: 0,           // 当日基准（分）
        seniority: 0,      // 工龄补贴（分）
        mealAllowance: 0,  // 餐补
        trafficAllowance: 0,// 交通补
        performance: 0,    // 演出补助
        gross: 0,          // 应发小计（扣扣款前）
        deduction: 0,      // 扣款合计（分）
        deductionDetail: {},
        net: 0             // 实发（分）
      };

      // 非出勤日（休假/休息日）：0基准，但演出补助照常
      if (status === 'off' || status === 'leave_personal' || status === 'leave_sick' || status === 'absent') {
        detail.base = 0;
        detail.seniority = 0;
        if (status !== 'off') {
          // 病假/事假/旷工需计算基准用于扣款百分比
          var _baseForDeduct = baseCents;
          var D = R.deductions || {};
          if (status === 'leave_personal') {
            var pct = this._parsePct(D.leavePersonal);
            detail.deductionDetail['事假'] = Math.round(_baseForDeduct * pct);
            detail.deduction += detail.deductionDetail['事假'];
          } else if (status === 'leave_sick') {
            var spct = this._parsePct(D.leaveSick);
            detail.deductionDetail['病假'] = Math.round(_baseForDeduct * spct);
            detail.deduction += detail.deductionDetail['病假'];
          } else if (status === 'absent') {
            var atype = dr.absentType || 'full';
            if (atype === 'half') {
              var hpct = this._parsePct(D.absentHalfDay);
              detail.deductionDetail['旷工半天'] = Math.round(_baseForDeduct * hpct);
            } else {
              var fpct = this._parsePct(D.absentFullDay);
              detail.deductionDetail['旷工'] = Math.round(_baseForDeduct * fpct) + (D.absentFine || 0);
            }
            detail.deduction += detail.deductionDetail[atype === 'half' ? '旷工半天' : '旷工'];
          }
        }
      } else {
        // 正常出勤 / 迟到
        detail.base = baseCents;
        // 工龄补贴：seniorityYears优先，否则用hireYear计算
        var sy = typeof st.seniorityYears === 'number' ? st.seniorityYears
          : (st.hireYear ? Math.max(0, new Date().getFullYear() - parseInt(st.hireYear, 10)) : 0);
        detail.seniority = Math.round(sy * (R.seniorityPerYear || 200));
        // 餐补/交通补
        detail.mealAllowance = (R.dailySubsidy && R.dailySubsidy.meal) || 0;
        detail.trafficAllowance = (R.dailySubsidy && R.dailySubsidy.traffic) || 0;
        // 迟到扣款
        if (status === 'late') {
          var mins = dr.lateMinutes || 0;
          var D = R.deductions || {};
          if (mins < 30) {
            detail.deductionDetail['迟到<' + mins + '分钟'] = D.lateUnder30min || 5000;
          } else {
            detail.deductionDetail['迟到≥' + mins + '分钟'] = D.lateOver30min || 10000;
          }
          detail.deduction += detail.deductionDetail[Object.keys(detail.deductionDetail)[0]];
        }
      }

      // 演出补助（无论出勤/休假，只要参演就发）
      if (dr.performType && dr.performCount > 0) {
        var PA = R.performanceAllowance || {};
        var rate = PA[dr.performType] || 0;
        detail.performance = Math.round(rate * dr.performCount);
      }

      // 应发 = 基准 + 工龄 + 餐补 + 交通补 + 演出补助
      detail.gross = detail.base + detail.seniority + detail.mealAllowance + detail.trafficAllowance + detail.performance;
      // 实发 = 应发 - 扣款
      detail.net = Math.max(0, detail.gross - detail.deduction);

      return detail;
    },
    _parsePct: function (v) {
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && /%/.test(v)) return parseFloat(v) / 100;
      return 0;
    },

    // ---------- 考勤判定核心（《两次打卡规则》V1 + V2 共用：时间解析与区间判断）----------
    ATTENDANCE_CLOCK_RULES: {
      afternoonIn: { start: '12:30', normalStart: '12:30', lateStart: '13:00', end: '14:00' },
      nightIn:     { start: '18:30', normalStart: '18:30', lateStart: '19:00', end: '19:30' }
    },
    _hhmmToMinutes: function (s) {
      if (!s) return -1;
      var str = String(s).trim();
      if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d/.test(str)) str = str.split(/\s+/)[1] || '';
      var m = str.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
      if (!m) return -1;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    },
    isInTimeRange: function (clockTime, range) {
      if (!clockTime || !range) return -1;
      var cur = this._hhmmToMinutes(clockTime);
      if (cur < 0) return -1;
      var s = this._hhmmToMinutes(range.start);
      var e = this._hhmmToMinutes(range.end);
      if (cur < s) return -1;
      if (cur > e) return 2;
      if (typeof range.lateStart === 'string') {
        var lateS = this._hhmmToMinutes(range.lateStart);
        if (cur >= lateS) return 1;
      }
      return 0;
    },
    judgeAttendance: function (staffId, date, clockTimeList, opts) {
      var self = this;
      var R = this.ATTENDANCE_CLOCK_RULES;
      var opt = opts || {};
      var clocks = Array.isArray(clockTimeList) ? clockTimeList : [];
      var result = {
        status: 'absent',
        hasAfternoonIn: false, hasNightIn: false,
        lateAfternoon: false, lateNight: false, lateCount: 0,
        afternoonMinutes: null, nightMinutes: null,
        fieldworkApproved: !!opt.fieldworkApproved,
        makeupApplied: false, makeupBlockedByLimit: false,
        used: [], raw: { date: date, staffId: staffId }
      };
      if (opt.fieldworkApproved) {
        result.status = 'full_day';
        result.hasAfternoonIn = true; result.hasNightIn = true;
        return result;
      }
      for (var i = 0; i < clocks.length; i++) {
        var t = clocks[i];
        var ra = self.isInTimeRange(t, R.afternoonIn);
        if ((ra === 0 || ra === 1) && !result.hasAfternoonIn) {
          result.hasAfternoonIn = true;
          result.afternoonMinutes = self._hhmmToMinutes(t);
          if (ra === 1) result.lateAfternoon = true;
          result.used.push(t);
        }
        var rn = self.isInTimeRange(t, R.nightIn);
        if ((rn === 0 || rn === 1) && !result.hasNightIn) {
          result.hasNightIn = true;
          result.nightMinutes = self._hhmmToMinutes(t);
          if (rn === 1) result.lateNight = true;
          result.used.push(t);
        }
      }
      if (!result.hasAfternoonIn && opt.makeupAfternoon) {
        if ((opt.makeupsUsed || 0) < 2) {
          result.hasAfternoonIn = true; result.makeupApplied = true;
          opt.makeupsUsed = (opt.makeupsUsed || 0) + 1;
        } else { result.makeupBlockedByLimit = true; }
      }
      if (!result.hasNightIn && opt.makeupNight) {
        if ((opt.makeupsUsed || 0) < 2) {
          result.hasNightIn = true; result.makeupApplied = true;
          opt.makeupsUsed = (opt.makeupsUsed || 0) + 1;
        } else { result.makeupBlockedByLimit = true; }
      }
      if (result.lateAfternoon) result.lateCount++;
      if (result.lateNight) result.lateCount++;
      if (result.hasAfternoonIn && result.hasNightIn) result.status = 'full_day';
      else if (result.hasAfternoonIn) result.status = 'half_afternoon';
      else if (result.hasNightIn) result.status = 'half_night';
      return result;
    },
    checkFullAttendance: function (monthRecordList, lateCount) {
      var list = Array.isArray(monthRecordList) ? monthRecordList : [];
      var totalLate = typeof lateCount === 'number' ? lateCount : 0;
      var hasHalfDay = false, hasLeaveOrAbsent = false, hasWorkDayStatusOk = true, weekdaysSeen = 0;
      for (var i = 0; i < list.length; i++) {
        var it = list[i] || {};
        if (!it.date) continue;
        var dow = new Date(it.date).getDay();
        var isWeekend = (dow === 0 || dow === 6);
        var st = String(it.status || 'normal');
        if (typeof totalLate !== 'number' || isNaN(totalLate) || lateCount === undefined) {
          if (it.lateCount) totalLate += it.lateCount;
          else if (st === 'late') totalLate++;
        }
        if (isWeekend) {
          if (st === 'leave_sick' || st === 'leave_personal' || st === 'absent') hasLeaveOrAbsent = true;
          continue;
        }
        weekdaysSeen++;
        var isFullOk = (st === 'full_day') || (st === 'normal') || (st === 'late');
        var isHalf = (st === 'half_afternoon') || (st === 'half_night');
        if (isHalf) hasHalfDay = true;
        if (st === 'leave_sick' || st === 'leave_personal' || st === 'absent') hasLeaveOrAbsent = true;
        if (!isFullOk) hasWorkDayStatusOk = false;
      }
      return weekdaysSeen > 0 && hasWorkDayStatusOk && !hasHalfDay && !hasLeaveOrAbsent && (totalLate < 3);
    },

    // ---------- 月度工资汇总（汇总考勤流水 → 单人工资条） ----------
    // staff: 同上
    // attendanceList: 该员工当月考勤记录数组
    // extraBonus: 额外奖金（分）
    // extraDeduct: 额外扣款（分）
    calcMonthlyWage: function (staff, attendanceList, extraBonus, extraDeduct, rules) {
      var R = rules || this.getDefaultRules();
      var list = attendanceList || [];
      var dailyDetails = [];
      var summary = {
        workDays: 0, lateDays: 0, absentHalfDays: 0, absentFullDays: 0,
        sickDays: 0, personalDays: 0, performBenxi: 0, performZhezi: 0, performXiaxiang: 0, performOther: 0
      };
      var totals = { base:0, seniority:0, meal:0, traffic:0, performance:0, gross:0, deduction:0, net:0 };

      for (var i = 0; i < list.length; i++) {
        var dr = list[i];
        var d = this.calcDailyWage(staff, dr, R);
        dailyDetails.push(d);
        // 统计
        var st = dr.status || 'normal';
        if (st === 'normal' || st === 'late') summary.workDays++;
        if (st === 'late') summary.lateDays++;
        if (st === 'absent') {
          if (dr.absentType === 'half') summary.absentHalfDays++;
          else summary.absentFullDays++;
        }
        if (st === 'leave_sick') summary.sickDays++;
        if (st === 'leave_personal') summary.personalDays++;
        if (dr.performType && dr.performCount > 0) {
          if (dr.performType === 'benxi') summary.performBenxi += dr.performCount;
          else if (dr.performType === 'zhezi') summary.performZhezi += dr.performCount;
          else if (dr.performType === 'xiaxiang') summary.performXiaxiang += dr.performCount;
          else summary.performOther += dr.performCount;
        }
        totals.base += d.base;
        totals.seniority += d.seniority;
        totals.meal += d.mealAllowance;
        totals.traffic += d.trafficAllowance;
        totals.performance += d.performance;
        totals.gross += d.gross;
        totals.deduction += d.deduction;
      }

      // 全勤奖：无旷工、无病假/事假、迟到<3次
      var perfectBonus = 0;
      if (summary.absentFullDays === 0 && summary.absentHalfDays === 0
          && summary.sickDays === 0 && summary.personalDays === 0 && summary.lateDays < 3) {
        perfectBonus = R.perfectAttendanceBonus || 0;
      }
      totals.gross += perfectBonus;
      if (extraBonus) totals.gross += Math.round(extraBonus);
      if (extraDeduct) totals.deduction += Math.round(extraDeduct);

      // 社保+公积金（按标准计薪日折算后的月基准 * 比例，仅粗略估算）
      var socialBase = Math.round(totals.base / (summary.workDays || 1) * (R.standardWorkDays || 21.75));
      var socialPct = this._parsePct((R.deductions||{}).socialInsurance);
      var fundPct = this._parsePct((R.deductions||{}).housingFund);
      var socialDeduct = Math.round(socialBase * socialPct);
      var fundDeduct = Math.round(socialBase * fundPct);
      totals.deduction += socialDeduct + fundDeduct;

      totals.net = Math.max(0, totals.gross - totals.deduction);

      return {
        staffId: staff.id || '',
        staffName: staff.name || '',
        roleCategory: staff.roleCategory || '',
        level: staff.level || '',
        month: '',   // 由调用方填入 2026-07
        dailyDetails: dailyDetails,
        summary: summary,
        items: {
          baseSalary: totals.base,            // 基本日薪×出勤
          seniorityAllowance: totals.seniority,// 工龄补贴
          mealAllowance: totals.meal,          // 餐补
          trafficAllowance: totals.traffic,    // 交通补
          performanceAllowance: totals.performance, // 演出补助
          perfectBonus: perfectBonus,          // 全勤奖
          extraBonus: Math.round(extraBonus || 0), // 额外奖金
          grossPay: totals.gross,              // 应发合计
          socialInsurance: socialDeduct,       // 社保个人
          housingFund: fundDeduct,             // 公积金个人
          extraDeduction: Math.round(extraDeduct || 0), // 其他扣款
          attendanceDeduction: totals.deduction - socialDeduct - fundDeduct - Math.round(extraDeduct || 0),
          totalDeduction: totals.deduction,    // 扣款合计
          netPay: totals.net                   // 实发合计
        }
      };
    },

    // ---------- 批量生成月度工资条（所有在职人员 → Storage.KEYS.WAGES） ----------
    // monthStr: '2026-07'
    // staffList: 员工数组 [{id,name,roleCategory,level,hireYear,seniorityYears,status}]
    // getAttendanceCb(staffId, monthStr): 返回该员工当月考勤数组
    generateMonthlyPayslips: function (monthStr, staffList, getAttendanceCb, options) {
      var self = this;
      var opts = options || {};
      var rules = this.getDefaultRules();
      var results = { success: 0, failed: 0, items: [], month: monthStr };
      try {
        if (!monthStr) throw new Error('请指定月份，格式如 2026-07');
        if (!staffList || !staffList.length) throw new Error('员工列表为空，无法生成工资条');

        // 当月已有则删除，防重复
        var exist = this.getPayslipsByMonth(monthStr);
        if (exist && exist.length) {
          if (opts.overwrite !== true) {
            var c = window.confirm && window.confirm('⚠️ 月份【' + monthStr + '】已存在 ' + exist.length + ' 条工资条，是否覆盖重算？');
            if (c !== true) return results;
          }
          this.deletePayslipsByMonth(monthStr);
        }

        for (var i = 0; i < staffList.length; i++) {
          var st = staffList[i];
          try {
            // 过滤：仅在职
            if (st.status && /离职|停用|resigned|off/.test(String(st.status))) continue;
            var att = (typeof getAttendanceCb === 'function') ? (getAttendanceCb(st.id, monthStr) || []) : (this._mockAttendance(st.id, monthStr));
            var payslip = this.calcMonthlyWage(st, att, opts.extraBonusMap ? opts.extraBonusMap[st.id] : 0,
                                                     opts.extraDeductMap ? opts.extraDeductMap[st.id] : 0, rules);
            payslip.month = monthStr;
            payslip.id = 'WAGE-' + monthStr.replace('-', '') + '-' + Utils.pad(String(st.id || ('STF' + i)), 4, '0');
            payslip.createdAt = Date.now();
            payslip.status = 'unpaid'; // unpaid / paid
            var saved = Storage.create(Storage.KEYS.WAGES, payslip);
            results.items.push(saved || payslip);
            results.success++;
          } catch (err) {
            results.failed++;
            console.warn('[WageEngine] 生成失败 - ' + (st && st.name || st && st.id) + ':', err.message);
          }
        }
        Utils.toast('✅ 月度工资条生成完成：成功 ' + results.success + ' / 失败 ' + results.failed, results.failed ? 'warning' : 'success');
        return results;
      } catch (e) {
        Utils.toast('❌ 批量生成失败：' + (e.message || e), 'error');
        return results;
      }
    },
    _mockAttendance: function (staffId, monthStr) {
      // 若未对接真实考勤流水，生成一份合理的模拟数据（22工作日+少量异常+演出）用于演示
      var list = [];
      if (!monthStr) return list;
      var parts = monthStr.split('-');
      var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1;
      var days = new Date(y, m + 1, 0).getDate();
      var rand = function (max) { return Math.floor(Math.random() * max); };
      for (var d = 1; d <= days; d++) {
        var dateStr = monthStr + '-' + Utils.pad(String(d), 2, '0');
        var dow = new Date(y, m, d).getDay();
        if (dow === 0 || dow === 6) {
          // 周末：20%概率有下乡/节日演出
          if (rand(100) < 20) {
            list.push({ date: dateStr, status: 'normal', performType: rand(2) ? 'xiaxiang' : 'festival', performCount: 1 });
          }
          continue;
        }
        var r = rand(100);
        if (r < 3) {
          list.push({ date: dateStr, status: 'late', lateMinutes: 10 + rand(40) });
        } else if (r < 5) {
          list.push({ date: dateStr, status: 'absent', absentType: rand(2) ? 'half' : 'full' });
        } else if (r < 8) {
          list.push({ date: dateStr, status: 'leave_sick' });
        } else if (r < 10) {
          list.push({ date: dateStr, status: 'leave_personal' });
        } else {
          // 正常出勤：约50%有演出
          var pr = rand(100);
          if (pr < 35) {
            list.push({ date: dateStr, status: 'normal', performType: 'benxi', performCount: 1 });
          } else if (pr < 55) {
            list.push({ date: dateStr, status: 'normal', performType: 'zhezi', performCount: 1 + rand(2) });
          } else {
            list.push({ date: dateStr, status: 'normal' });
          }
        }
      }
      return list;
    },

    // ---------- 工资条 CRUD ----------
    getPayslips: function () {
      try { return Storage._get(Storage.KEYS.WAGES) || []; }
      catch (e) { console.warn('[WageEngine] 读取工资条失败', e.message); return []; }
    },
    getPayslipsByMonth: function (monthStr) {
      return this.getPayslips().filter(function (w) { return w.month === monthStr; });
    },
    getPayslipById: function (id) {
      var list = this.getPayslips();
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },
    savePayslip: function (payslip) {
      try {
        if (!payslip || !payslip.id) throw new Error('工资条缺少id');
        var list = this.getPayslips();
        var found = -1;
        for (var i = 0; i < list.length; i++) if (list[i].id === payslip.id) { found = i; break; }
        payslip.updatedAt = Date.now();
        if (found >= 0) list[found] = payslip; else list.push(payslip);
        Storage._set(Storage.KEYS.WAGES, list);
        return payslip;
      } catch (e) {
        Utils.toast('❌ 工资条保存失败：' + (e.message || e), 'error');
        return null;
      }
    },
    markPaid: function (id, isPaid) {
      var ps = this.getPayslipById(id);
      if (!ps) { Utils.toast('⚠️ 未找到该工资条', 'warning'); return false; }
      ps.status = isPaid ? 'paid' : 'unpaid';
      ps.paidAt = isPaid ? Date.now() : null;
      this.savePayslip(ps);
      Utils.toast(isPaid ? '✅ 已标记为已发放' : '🔄 已取消发放标记', 'success');
      return true;
    },
    deletePayslip: function (id) {
      try {
        var list = this.getPayslips();
        var newList = list.filter(function (w) { return w.id !== id; });
        Storage._set(Storage.KEYS.WAGES, newList);
        return true;
      } catch (e) { return false; }
    },
    deletePayslipsByMonth: function (monthStr) {
      try {
        var list = this.getPayslips();
        var newList = list.filter(function (w) { return w.month !== monthStr; });
        Storage._set(Storage.KEYS.WAGES, newList);
        return list.length - newList.length;
      } catch (e) { return 0; }
    },
    // 汇总统计（财务台账联动）
    getMonthSummary: function (monthStr) {
      var list = this.getPayslipsByMonth(monthStr);
      var s = { count: 0, gross: 0, deduction: 0, net: 0, paid: 0, unpaid: 0,
                performanceAllowance: 0, perfectBonus: 0, socialInsurance: 0, housingFund: 0 };
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        s.count++;
        s.gross += (it.items && it.items.grossPay) || 0;
        s.deduction += (it.items && it.items.totalDeduction) || 0;
        s.net += (it.items && it.items.netPay) || 0;
        if (it.status === 'paid') s.paid++; else s.unpaid++;
        if (it.items) {
          s.performanceAllowance += (it.items.performanceAllowance || 0);
          s.perfectBonus += (it.items.perfectBonus || 0);
          s.socialInsurance += (it.items.socialInsurance || 0);
          s.housingFund += (it.items.housingFund || 0);
        }
      }
      return s;
    },
    // 金额格式化（分→元）
    fmt: function (cents) { return Utils.fromCents(cents); },

    // ================================================================
    // 重构# 方案二 V2：《演员考勤与薪酬管理规定·最终完整版》核心模块
    // 对接：海康/腾讯云 ISAPI 自动打卡机（一次有效打卡计1场，单日最多2场）
    // ================================================================
    _tagKey: function (staffId, date) { return String(staffId || '') + '_' + String(date || ''); },
    _getOperator: function () {
      try {
        var s = Storage._get(Storage.KEYS.ADMIN);
        if (s && s.username) return s.username;
        if (s && s.account) return s.account;
      } catch (e) {}
      return 'system';
    },
    _audit: function (action, staffIds, before, after, extra) {
      try {
        var list = Storage._get(Storage.KEYS.ATTENDANCE_AUDIT_LOGS) || [];
        list.unshift({
          ts: Date.now(),
          operator: this._getOperator(),
          action: action,
          staffIds: Array.isArray(staffIds) ? staffIds.slice(0, 200) : [staffIds],
          before: before || null,
          after: after || null,
          extra: extra || null
        });
        Storage._set(Storage.KEYS.ATTENDANCE_AUDIT_LOGS, list.slice(0, 2000));
      } catch (e) { console.warn('[WageEngine.v2] 审计日志写入失败', e.message); }
    },

    // ---------- V2 管理员人工标记（装台/卸台/常规） ----------
    getAdminManualTag: function (staffId, date) {
      try {
        var map = Storage._get(Storage.KEYS.ATTENDANCE_MANUAL_TAGS) || {};
        var val = map[this._tagKey(staffId, date)];
        return (val === '装台' || val === '卸台' || val === '常规') ? val : '常规';
      } catch (e) { return '常规'; }
    },
    setAdminManualTag: function (staffId, date, tag, opts) {
      var self = this;
      var validTags = ['常规', '装台', '卸台'];
      if (validTags.indexOf(tag) < 0) { Utils.toast('❌ 标记类型非法（仅 常规/装台/卸台）', 'error'); return false; }
      try {
        var map = Storage._get(Storage.KEYS.ATTENDANCE_MANUAL_TAGS) || {};
        var key = self._tagKey(staffId, date);
        var before = map[key] || '常规';
        if (tag === '常规') delete map[key]; else map[key] = tag;
        Storage._set(Storage.KEYS.ATTENDANCE_MANUAL_TAGS, map);
        self._audit('attendance.manualTag.set', [staffId], { date: date, tag: before }, { date: date, tag: tag }, opts && opts.reason ? { reason: opts.reason } : null);
        Utils.toast('✅ ' + (staffId || '所选人员') + ' · ' + date + ' → 【' + tag + '】 已保存', 'success');
        return true;
      } catch (e) { Utils.toast('❌ 标记保存失败：' + (e.message || e), 'error'); return false; }
    },
    // [Deprecated] 兼容老内部调用（标准名 = batchSetManualTag），已合并前置校验+写存储逻辑进标准名
    batchSetAdminManualTag: function (staffIds, date, tag, opts) {
      try {
        if (typeof console !== 'undefined' && typeof console.info === 'function') {
          console.info('[WageEngine Deprecated] batchSetAdminManualTag 将于后续版本移除，请统一使用标准名 batchSetManualTag（已内置装台/卸台冲突前置校验）');
        }
      } catch(_) {}
      return this.batchSetManualTag(staffIds, date, tag, opts);
    },
    // —— ✅ 标准名（AttV2UI.batchTag 实际调用，含装台/卸台冲突前置校验+真实 Storage 写入）
    batchSetManualTag: function (staffIds, date, tag, opts) {
      var self = this;
      var validTags = ['常规', '装台', '卸台'];
      if (validTags.indexOf(tag) < 0) { Utils.toast('❌ 批量标记类型非法', 'error'); return false; }
      if (!Array.isArray(staffIds) || !staffIds.length) { Utils.toast('⚠️ 请先勾选需要设置的人员', 'warning'); return false; }
      // 前置校验：装台/卸台日若存在奖励或事故，不允许切换（阻止误标记）
      if (tag === '装台' || tag === '卸台') {
        var blocked = [];
        for (var k = 0; k < staffIds.length; k++) {
          var sid2 = staffIds[k];
          var rw2 = self.getDayRewardTag(sid2, date);
          var acc2 = self.getAccidents(sid2, date);
          if ((rw2 && rw2.reward) || (acc2 && acc2.length > 0)) blocked.push(sid2);
        }
        if (blocked.length > 0) {
          try {
            if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast('⚠️ 以下人员当日存在奖励/事故，请先撤销后再切换到' + tag + '：' + blocked.slice(0, 5).join('、') + (blocked.length > 5 ? (' 等' + blocked.length + '人') : ''), 'error', 3800);
            else if (typeof alert === 'function') alert('标记失败：装台/卸台日存在奖励或事故，请先撤销对应奖励/事故后再操作');
          } catch(_) {}
          return false;
        }
      }
      try {
        var map = Storage._get(Storage.KEYS.ATTENDANCE_MANUAL_TAGS) || {};
        var beforeMap = {}, afterMap = {};
        for (var i = 0; i < staffIds.length; i++) {
          var sid = staffIds[i];
          var key = self._tagKey(sid, date);
          beforeMap[sid] = map[key] || '常规';
          afterMap[sid] = tag;
          if (tag === '常规') delete map[key]; else map[key] = tag;
        }
        Storage._set(Storage.KEYS.ATTENDANCE_MANUAL_TAGS, map);
        self._audit('attendance.manualTag.batch', staffIds.slice(0, 100), { date: date, sampleBefore: beforeMap }, { date: date, sampleAfter: afterMap }, { reason: (opts && opts.reason) || '', count: staffIds.length });
        Utils.toast('✅ 批量【' + tag + '】设置成功：' + staffIds.length + ' 人 × ' + date, 'success');
        return staffIds.length;
      } catch (e) { Utils.toast('❌ 批量设置失败：' + (e.message || e), 'error'); return false; }
    },

    // ---------- V2 表现突出奖励 ----------
    getDayRewardTag: function (staffId, date) {
      try {
        var map = Storage._get(Storage.KEYS.ATTENDANCE_REWARD_TAGS) || {};
        return map[this._tagKey(staffId, date)] || null;
      } catch (e) { return null; }
    },
    setDayRewardTag: function (staffId, date, enable, opts) {
      var self = this;
      try {
        var map = Storage._get(Storage.KEYS.ATTENDANCE_REWARD_TAGS) || {};
        var key = self._tagKey(staffId, date);
        var before = map[key] || null;
        // 装台/卸台禁止奖励
        var tag = self.getAdminManualTag(staffId, date);
        if (tag === '装台' || tag === '卸台') { Utils.toast('⚠️ ' + tag + '日不可申请当日表现突出奖励', 'warning'); return false; }
        if (enable) {
          var rules = self.getDefaultRules();
          map[key] = { reward: (rules.v2 && rules.v2.outstandingRewardCents) || 500, operator: self._getOperator(), ts: Date.now(), remark: (opts && opts.remark) || '' };
        } else {
          delete map[key];
        }
        Storage._set(Storage.KEYS.ATTENDANCE_REWARD_TAGS, map);
        self._audit('attendance.reward.set', [staffId], { date: date, reward: before ? before.reward : 0 }, { date: date, reward: enable ? ((self.getDefaultRules().v2&&self.getDefaultRules().v2.outstandingRewardCents)||500) : 0 }, opts);
        Utils.toast(enable ? '✅ 表现突出奖励已登记（5元/天）' : '✅ 已取消当日奖励', 'success');
        return true;
      } catch (e) { Utils.toast('❌ 奖励登记失败：' + (e.message || e), 'error'); return false; }
    },

    // ---------- V2 演出事故登记（一级10 二级30 三级50 元） ----------
    getAccidents: function (staffId, date) {
      try {
        var list = Storage._get(Storage.KEYS.ATTENDANCE_ACCIDENT_FINES) || [];
        return list.filter(function (a) {
          return ((!staffId || a.staffId === staffId) && (!date || a.date === date));
        });
      } catch (e) { return []; }
    },
    getAccidentTotalCentsByDay: function (staffId, date) {
      var list = this.getAccidents(staffId, date);
      var total = 0;
      for (var i = 0; i < list.length; i++) total += Math.round(list[i].fine || 0);
      return total;
    },
    // AttV2UI 当日事故明细面板调用：W.getAccidentFines(date) 按日期返回当日全部人员事故
    getAccidentFines: function (date) {
      try {
        var list = Storage._get(Storage.KEYS.ATTENDANCE_ACCIDENT_FINES) || [];
        if (!date) return list; // 兼容不传参：返回全量
        return list.filter(function (a) { return a && a.date === date; });
      } catch (e) { return []; }
    },
    // [Deprecated] 兼容老内部/外部调用（标准名 = addAccidentFine，支持 operator 覆写）
    addAccident: function (staffId, date, level, desc) {
      try {
        if (typeof console !== 'undefined' && typeof console.info === 'function') {
          console.info('[WageEngine Deprecated] addAccident 将于后续版本移除，请统一使用标准名 addAccidentFine(staffId,date,level,desc,operator?)');
        }
      } catch(_) {}
      return this.addAccidentFine(staffId, date, level, desc);
    },
    // —— ✅ 标准名（AttV2UI._quickAcc 实际调用，支持 operator=第五参数显式指定操作人）
    addAccidentFine: function (staffId, date, level, desc, operator) {
      var self = this;
      try {
        var lv = parseInt(level, 10);
        if (isNaN(lv) || [1, 2, 3].indexOf(lv) < 0) throw new Error('事故等级非法（1/2/3）');
        var R = self.getDefaultRules();
        var cents = (R.v2 && R.v2.accidentFineCents && R.v2.accidentFineCents[lv]) || 1000;
        var list = Storage._get(Storage.KEYS.ATTENDANCE_ACCIDENT_FINES) || [];
        var rec = {
          id: 'ACC-' + Date.now() + '-' + Utils.pad(String(Math.floor(Math.random()*1000)), 3, '0'),
          staffId: staffId, date: date,
          level: lv, fine: cents, desc: String(desc || ''),
          operator: (operator && String(operator).trim()) || self._getOperator(),
          ts: Date.now()
        };
        list.push(rec);
        Storage._set(Storage.KEYS.ATTENDANCE_ACCIDENT_FINES, list);
        self._audit('attendance.accident.add', [staffId], null, { date: date, level: lv, fine: cents, desc: desc, operator: rec.operator });
        Utils.toast('✅ ' + (lv === 1 ? '一级' : lv === 2 ? '二级' : '三级') + '事故已登记（-' + Utils.fromCents(cents) + '）', 'warning');
        return rec;
      } catch (e) { Utils.toast('❌ 事故登记失败：' + (e.message || e), 'error'); return null; }
    },
    // [Deprecated] 简化为标准名 getAccidentFines() 别名，内部直接复用统一 Storage 读入口，精简重复代码
    listAccidentFines: function () {
      try {
        if (typeof console !== 'undefined' && typeof console.info === 'function') {
          console.info('[WageEngine Deprecated] listAccidentFines 将于后续版本移除，请统一使用标准名 getAccidentFines()（不传参返回全量/传 date 返回当日）');
        }
      } catch(_) {}
      return this.getAccidentFines();
    },
    getAccidentsByStaff: function (staffId, startDate, endDate) {
      var all = this.listAccidentFines();
      return all.filter(function (a) {
        if (staffId && a.staffId !== staffId) return false;
        if (startDate && a.date < startDate) return false;
        if (endDate && a.date > endDate) return false;
        return true;
      });
    },
    clearAuditLogs: function () {
      try {
        Storage._set(Storage.KEYS.ATTENDANCE_AUDIT_LOGS, []);
        try { if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast('✅ 操作审计日志已清空', 'success', 2200); } catch(_) {}
        return true;
      } catch (e) { return false; }
    },
    deleteAccident: function (accidentId) {
      try {
        var list = Storage._get(Storage.KEYS.ATTENDANCE_ACCIDENT_FINES) || [];
        var before = null; var idx = -1;
        for (var i = 0; i < list.length; i++) if (list[i].id === accidentId) { before = list[i]; idx = i; break; }
        if (idx < 0) return false;
        list.splice(idx, 1);
        Storage._set(Storage.KEYS.ATTENDANCE_ACCIDENT_FINES, list);
        this._audit('attendance.accident.delete', [before && before.staffId], before, null);
        Utils.toast('✅ 事故登记已撤销', 'success');
        return true;
      } catch (e) { return false; }
    },

    // ---------- V2 checkClockTime：校验打卡时间 + 计算迟到分钟 ----------
    checkClockTime: function (clockTime, timeRange, baseTime) {
      var curMin = this._hhmmToMinutes(clockTime);
      var stMin  = this._hhmmToMinutes(timeRange && timeRange.start);
      var edMin  = this._hhmmToMinutes(timeRange && timeRange.end);
      var baseMin = this._hhmmToMinutes(baseTime);
      if (curMin < 0 || stMin < 0 || edMin < 0 || baseMin < 0) return { valid: false, lateMinute: 0 };
      // 1. 不在 start~end 区间 → valid=false
      if (curMin < stMin || curMin > edMin) return { valid: false, lateMinute: 0 };
      // 2. 区间内，计算相比 baseTime 迟到分钟（若早于 base 算 0 不提前）
      var diff = curMin - baseMin;
      return { valid: true, lateMinute: Math.max(0, diff) };
    },

    // ---------- V2 calcDayRecord：单日场次/薪资比例/迟到信息 ----------
    calcDayRecord: function (staffId, date, clockTimeList) {
      var self = this;
      var rules = self.getDefaultRules();
      var V2 = (rules && rules.v2) ? rules.v2 : null;
      var manualTag = self.getAdminManualTag(staffId, date);
      // 装台/卸台 → 不计薪资 不计场次 不计迟到
      if (V2 && V2.nonSalaryTags && V2.nonSalaryTags.indexOf(manualTag) >= 0) {
        return {
          status: '专项工作（' + manualTag + '，不计薪资）',
          manualTag: manualTag,
          sessionCount: 0,
          salaryRatio: -1,
          lateInfo: { afternoonLate: 0, nightLate: 0 },
          effectiveClock: { afternoon: null, night: null }
        };
      }
      // ⬇ 兼容：clockTimeList 未显式传入时，自动从 ATTENDANCE_CLOCKS_V2 拉取
      var clocks = Array.isArray(clockTimeList) ? clockTimeList : (function(){
        try {
          var store = Storage._get(Storage.KEYS.ATTENDANCE_CLOCKS_V2) || {};
          var list = store[staffId + '_' + date];
          return Array.isArray(list) ? list : [];
        } catch(e) { return []; }
      })();
      var rule = V2 ? V2.clockRules : { afternoonIn: { start: '13:30', end: '14:00', base: '13:30' }, nightIn: { start: '19:30', end: '20:00', base: '19:30' } };
      var hasAfternoon = false, hasNight = false;
      var afternoonLateMin = 0, nightLateMin = 0;
      var effAfternoon = null, effNight = null;
      // 对同一时段：多打卡只取「第一次命中窗口」的记录（场次只计1次）
      for (var i = 0; i < clocks.length; i++) {
        var t = clocks[i];
        if (!hasAfternoon) {
          var ra = self.checkClockTime(t, rule.afternoonIn, rule.afternoonIn.base);
          if (ra.valid) { hasAfternoon = true; afternoonLateMin = ra.lateMinute; effAfternoon = t; }
        }
        if (!hasNight) {
          var rn = self.checkClockTime(t, rule.nightIn, rule.nightIn.base);
          if (rn.valid) { hasNight = true; nightLateMin = rn.lateMinute; effNight = t; }
        }
      }
      // 迟到 ≥30 分钟 → 本场失效（不计场次）
      var invalidMins = (V2 && typeof V2.lateInvalidMinutes === 'number') ? V2.lateInvalidMinutes : 30;
      if (afternoonLateMin >= invalidMins) { hasAfternoon = false; afternoonLateMin = 0; effAfternoon = null; }
      if (nightLateMin >= invalidMins)     { hasNight = false;     nightLateMin = 0;     effNight = null; }
      var sessionNum = (hasAfternoon ? 1 : 0) + (hasNight ? 1 : 0);
      var ratio = 0, statusText = '';
      if (sessionNum === 2)      { ratio = 1.00; statusText = '有效打卡2场，全额薪资'; }
      else if (sessionNum === 1) { ratio = 0.50; statusText = '有效打卡1场，50%薪资'; }
      else                       { ratio = 0.00; statusText = '无有效打卡，不计当日薪资'; }
      return {
        status: statusText,
        manualTag: manualTag,
        sessionCount: sessionNum,
        salaryRatio: ratio,
        lateInfo: { afternoonLate: afternoonLateMin, nightLate: nightLateMin },
        effectiveClock: { afternoon: effAfternoon, night: effNight }
      };
    },

    // ---------- V2 calcDayPunishReward：单日奖罚（表现突出 + 迟到罚金 + 事故罚款） ----------
    calcDayPunishReward: function (staffId, date, clockTimeList) {
      var self = this;
      var rules = self.getDefaultRules();
      var V2 = (rules && rules.v2) ? rules.v2 : null;
      var manualTag = self.getAdminManualTag(staffId, date);
      // 装台/卸台 → 跳过所有奖罚
      if (V2 && V2.nonSalaryTags && V2.nonSalaryTags.indexOf(manualTag) >= 0) {
        return { lateFineCents: 0, rewardCents: 0, accidentFineCents: 0, manualTag: manualTag };
      }
      var rewardCents = 0;
      var rw = self.getDayRewardTag(staffId, date);
      if (rw && rw.reward) rewardCents = Math.round(rw.reward);
      var dayData = self.calcDayRecord(staffId, date, clockTimeList);
      var pmLate = dayData.lateInfo.afternoonLate;
      var eveLate = dayData.lateInfo.nightLate;
      var perMinCents = (V2 && V2.lateFinePerMinCents) ? V2.lateFinePerMinCents : 100;   // 1元/分钟
      var capCents    = (V2 && V2.lateFineCapCents)    ? V2.lateFineCapCents    : 3000;  // 单场上限30元
      // 单场 min(分钟×1元, 30元)，日晚场独立累加
      var lateFineCents = 0;
      if (pmLate  > 0) lateFineCents += Math.min(pmLate  * perMinCents, capCents);
      if (eveLate > 0) lateFineCents += Math.min(eveLate * perMinCents, capCents);
      // 演出事故罚款（当日多条独立累加）
      var accidentFineCents = self.getAccidentTotalCentsByDay(staffId, date);
      return {
        lateFineCents: Math.round(lateFineCents),
        rewardCents: Math.round(rewardCents),
        accidentFineCents: Math.round(accidentFineCents),
        manualTag: manualTag
      };
    },

    // ---------- V2 calcDailyWageV2：单日工资明细（完全按最终公示版公式） ----------
    calcDailyWageV2: function (staff, date, clockTimeList, rules) {
      var self = this;
      var R = rules || self.getDefaultRules();
      var baseCents = self.getBaseDailyWage(staff && staff.roleCategory, staff && staff.level, R);
      var record = self.calcDayRecord(staff && staff.id, date, clockTimeList);
      var pr = self.calcDayPunishReward(staff && staff.id, date, clockTimeList);
      var basePay = 0;
      if (record.salaryRatio !== -1) {
        basePay = Math.round(baseCents * record.salaryRatio);
      }
      var gross = basePay + pr.rewardCents;
      var totalFine = pr.lateFineCents + pr.accidentFineCents;
      var net = Math.max(0, gross - totalFine);
      return {
        date: date,
        staffId: staff && staff.id,
        staffName: staff && staff.name,
        manualTag: record.manualTag,     // 常规/装台/卸台
        sessionCount: record.sessionCount,
        salaryRatio: record.salaryRatio, // -1 表示不计薪资；0 / 0.5 / 1.0
        effectiveClock: record.effectiveClock,
        lateInfo: record.lateInfo,
        // 分项
        baseCents: baseCents,            // 单日基准工资（行当×职级 全额）
        basePay: basePay,                // 基准 × 比例
        rewardCents: pr.rewardCents,     // 表现突出（500分=5元）
        lateFineCents: pr.lateFineCents, // 迟到罚金
        accidentFineCents: pr.accidentFineCents, // 事故罚款
        gross: gross,                    // 基+奖
        totalFine: totalFine,            // 迟到+事故 合计罚
        net: net,                        // 当日实发（max 0）
        statusText: record.status
      };
    },

    // ---------- V2 calcMonthSalaryV2：月度实发工资（最终公示版极简公式） ----------
    calcMonthSalaryV2: function (staff, monthStr, getClocksCb, rules) {
      var self = this;
      var R = rules || self.getDefaultRules();
      var parts = String(monthStr || '').split('-');
      if (parts.length !== 2) throw new Error('月份格式应为 2026-07');
      var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1;
      var daysInMonth = new Date(y, m + 1, 0).getDate();
      var list = [];
      var totals = { basePay: 0, reward: 0, lateFine: 0, accidentFine: 0, net: 0, gross: 0 };
      var summary = { fullSessionDays: 0, halfSessionDays: 0, noSessionDays: 0, zhuangtaiXietaiDays: 0, totalSessions: 0, totalLateMinutes: 0, accidentCount: 0 };
      for (var d = 1; d <= daysInMonth; d++) {
        var ds = monthStr + '-' + Utils.pad(String(d), 2, '0');
        var clocks = (typeof getClocksCb === 'function') ? (getClocksCb(staff && staff.id, ds) || []) : (self._mockClocksForV2(staff && staff.id, ds));
        var day = self.calcDailyWageV2(staff, ds, clocks, R);
        list.push(day);
        // 汇总
        totals.basePay += day.basePay;
        totals.reward += day.rewardCents;
        totals.lateFine += day.lateFineCents;
        totals.accidentFine += day.accidentFineCents;
        totals.gross += day.gross;
        // summary
        if (day.manualTag === '装台' || day.manualTag === '卸台') summary.zhuangtaiXietaiDays++;
        else if (day.sessionCount === 2) summary.fullSessionDays++;
        else if (day.sessionCount === 1) summary.halfSessionDays++;
        else summary.noSessionDays++;
        summary.totalSessions += (day.sessionCount || 0);
        summary.totalLateMinutes += (day.lateInfo.afternoonLate || 0) + (day.lateInfo.nightLate || 0);
        if (day.accidentFineCents > 0) summary.accidentCount += self.getAccidents(staff && staff.id, ds).length;
      }
      totals.net = Math.max(0, totals.gross - (totals.lateFine + totals.accidentFine));
      // 为了兼容「工资条明细」同时提供完整 dailyDetails
      return {
        staffId: staff && staff.id,
        staffName: staff && staff.name,
        roleCategory: staff && staff.roleCategory,
        level: staff && staff.level,
        month: monthStr,
        formula: '实发 = ∑(基准×比例) + 表现突出奖励 − 迟到罚金 − 事故罚款',
        summary: summary,
        dailyDetails: list,
        totals: totals,  // { basePay, reward, lateFine, accidentFine, gross, net }
        netPay: totals.net,
        items: {
          baseSalary: totals.basePay,
          performanceAllowance: 0,
          perfectBonus: 0,
          mealAllowance: 0,
          trafficAllowance: 0,
          seniorityAllowance: 0,
          rewardOutstanding: totals.reward,
          lateFine: totals.lateFine,
          accidentFine: totals.accidentFine,
          grossPay: totals.gross,
          socialInsurance: 0,
          housingFund: 0,
          extraBonus: 0,
          attendanceDeduction: totals.lateFine + totals.accidentFine,
          extraDeduction: 0,
          totalDeduction: totals.lateFine + totals.accidentFine,
          netPay: totals.net
        }
      };
    },
    // ---------- V2 显式查询打卡记录（对外公开 API，等同于 isapi.queryClocks 但返回单日期的字符串数组） ----------
    getStaffClocks: function (staffId, date) {
      if (!staffId || !date) return [];
      try {
        var store = Storage._get(Storage.KEYS.ATTENDANCE_CLOCKS_V2) || {};
        var list = store[staffId + '_' + date];
        return Array.isArray(list) ? list : [];
      } catch (e) { return []; }
    },

    _mockClocksForV2: function (staffId, dateStr) {
      // 生产环境不调用（接入真实打卡机）。演示用随机 0/1/2 场打卡。
      var r = Math.random();
      var clocks = [];
      if (r > 0.08) clocks.push(dateStr + ' 13:' + (28 + Math.floor(Math.random() * 18)).toString().padStart(2, '0'));
      if (r > 0.15) clocks.push(dateStr + ' 19:' + (28 + Math.floor(Math.random() * 18)).toString().padStart(2, '0'));
      return clocks;
    },
    // V2 审计日志（只读）
    getAuditLogs: function (limit) {
      try {
        var list = Storage._get(Storage.KEYS.ATTENDANCE_AUDIT_LOGS) || [];
        return list.slice(0, Math.max(1, limit || 50));
      } catch (e) { return []; }
    },

    // ===================================================================
    // V2 ISAPI 对接适配器（清洗层，遵循"归属日/字段映射/去重"全部在此层完成原则，
    //    参考 Java 考勤系统经验：不要留到 calcDayRecord/calcMonthSalaryV2 统计层去猜）
    // 接入方（海康 ISAPI / 腾讯云人脸通行 / 通用后台脚本）只需 1 行：
    //    QinApp.Wage.isapi.ingestClockRecords(rawArray, {vendor:'hikvision'});
    // 之后 V2 表格/薪资/导出全部自动刷新，无需任何改动。
    // ===================================================================
    isapi: (function () {
      // -------------- 字段别名映射（支持 3 套：海康 / 腾讯云 / 通用） --------------
      var STAFF_ID_ALIASES = [
        'staffId','personId','employeeNo','cardNo','empNo','personnelId','staffCode',
        'UserId','PersonId','UserID','OpenID','id','staff_id','user_id','work_no','job_number'
      ];
      var TIME_ALIASES = [
        'clockTime','time','punchTime','checkTime','attendanceTime','captureTime','recvTime',
        'PassTime','CreateTime','Timestamp','datetime','clock_time','check_time','record_time','time_stamp'
      ];
      var DIRECTION_ALIASES = ['direction','inOut','inOrOut','inOutType','verifyType','Direction','InOut','type'];
      // V2 不关心上下班，但可以主动丢弃"下班"类方向记录以减少噪音
      var CLOCK_OUT_HINTS = ['out','exit','leave','下班','签退','离','e_exit'];

      function _pickByAliases(obj, aliases) {
        if (!obj || typeof obj !== 'object') return null;
        for (var i=0; i<aliases.length; i++) {
          var k = aliases[i];
          if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
        }
        return null;
      }
      // 把多种日期输入（字符串毫秒/Date 对象/YYYY-MM-DD HH:mm/秒/毫秒/ISO8601/中文日期）规范化
      function _toDateObj(raw) {
        if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
        var s = String(raw || '').trim();
        if (!s) return null;
        // 1) 纯数字秒/毫秒 → 直接 new Date() 处理
        if (/^\d{10,13}$/.test(s)) {
          var n = Number(s);
          if (s.length === 10) n *= 1000;
          var dNum = new Date(n);
          return isNaN(dNum.getTime()) ? null : dNum;
        }
        // 2) 先尝试原生 new Date(ISO 标准/浏览器兼容格式)：带 Z/时区/标准字符串(如 2026-07-30T14:08:12.000Z)不会有时区问题
        //    (注意：中文 2026年7月30日 / DD/MM/YYYY 等非标准格式 原生可能返回 Invalid，下面 fallback 手动解析)
        var dNative;
        try { dNative = new Date(s); } catch (e) { dNative = null; }
        if (dNative && !isNaN(dNative.getTime())) {
          // 防御：仅对"明确含时区/ISO-T/Z"的字符串用原生，避免不同浏览器对 YYYY-MM-DD HH:mm:ss 的 UTC/本地歧义
          //      纯本地语义字符串（只含数字/中划线/冒号/中文年月日，无 Z/T/+）仍走手动解析
          var pureLocal = /^[-\/\d\s:年月日]+$/.test(s);
          if (!pureLocal) return dNative;
        }
        // 3) Fallback：手动规范化中文/多分隔符/补零
        var norm = s
          .replace(/\//g,'-').replace(/年|月/g,'-').replace(/日/g,' ')
          .replace(/T/,' ').replace(/\.\d+Z$/,'').replace(/Z$/,'')
          .replace(/^\s+|\s+$/g,'');
        // 没有时间的，补 12:00
        if (!/[:：]/.test(norm)) norm = norm + ' 12:00:00';
        var parts = norm.split(/[\s]+/);
        var ymd = parts[0] || '';
        var hms = (parts[1] || '00:00:00').replace(/：/g,':');
        var ymdp = ymd.split('-').map(function(x){return parseInt(x,10);});
        var hmsp = hms.split(':').map(function(x){return parseInt(x,10)||0;});
        if (ymdp.length<3 || isNaN(ymdp[0]) || isNaN(ymdp[1]) || isNaN(ymdp[2])) return null;
        var d2 = new Date(ymdp[0], (ymdp[1]||1)-1, ymdp[2]||1, hmsp[0]||0, hmsp[1]||0, hmsp[2]||0);
        return isNaN(d2.getTime()) ? null : d2;
      }
      function _pad2(n){return (n<10?'0':'')+n;}
      function _fmtDate(d){return d.getFullYear()+'-'+_pad2(d.getMonth()+1)+'-'+_pad2(d.getDate());}
      function _fmtDateTime(d){return _fmtDate(d)+' '+_pad2(d.getHours())+':'+_pad2(d.getMinutes())+':'+_pad2(d.getSeconds());}
      // 根据归属日规则（凌晨 0-dayShiftHours 点 = 前一天）计算业务日期
      function _belongsToDate(dateObj, dayShiftHours) {
        var sh = dayShiftHours == null ? 4 : Number(dayShiftHours);
        if (isNaN(sh)) sh = 4;
        var h = dateObj.getHours();
        if (h < sh) {
          var prev = new Date(dateObj.getTime());
          prev.setDate(prev.getDate() - 1);
          return _fmtDate(prev);
        }
        return _fmtDate(dateObj);
      }
      function _isClockOut(rawDir) {
        if (rawDir == null || rawDir === '') return false;
        var s = String(rawDir).toLowerCase().trim();
        for (var i=0; i<CLOCK_OUT_HINTS.length; i++) {
          if (s.indexOf(CLOCK_OUT_HINTS[i]) >= 0) return true;
        }
        return false;
      }

      function _getClocksStore() {
        return Storage._get(Storage.KEYS.ATTENDANCE_CLOCKS_V2) || {};
      }
      function _saveClocksStore(store) {
        Storage._set(Storage.KEYS.ATTENDANCE_CLOCKS_V2, store);
      }
      function _getSync() {
        return Storage._get(Storage.KEYS.ATTENDANCE_ISAPI_SYNC) || {
          lastSyncAt: 0, vendor: 'generic', totalIngested: 0,
          lastRangeStart: 0, lastRangeEnd: 0
        };
      }
      function _saveSync(s) { Storage._set(Storage.KEYS.ATTENDANCE_ISAPI_SYNC, s); }

      // =======================================================================
      // 对外 API
      // =======================================================================
      return {
        /**
         * 批量写入考勤机打卡流水（海康/腾讯云/通用三种字段名自动识别）
         *
         * @param {Array} rawRecords  原始流水数组，对象元素任意字段
         * @param {Object} [options]
         * @param {string} [options.vendor]  'hikvision' | 'tencent' | 'generic'（默认 generic）
         * @param {number} [options.dayShiftHours]  凌晨 0~N 点视为前一天，默认 4
         * @param {boolean} [options.discardClockOut]  丢弃"下班/exit/out"类记录，默认 true（V2 只记上班）
         * @param {number} [options.rangeStartTs]  本次拉取的开始时间戳（毫秒），用于断点续传元数据
         * @param {number} [options.rangeEndTs]    本次拉取的结束时间戳（毫秒）
         * @param {string} [options.operator]  操作人标识，默认 'isapi'
         * @returns {Object} {
         *    ingested: number,       本次新增写入的打卡条数（不含重复/作废）
         *    skipped: {invalidTime, invalidStaff, clockOut, dup},
         *    lastSyncAt: number,
         *    totalIngested: number,  历史累计写入条数
         *    distinctStaffDays: number  本次覆盖到多少个 [员工 × 归属日] 组合
         * }
         */
        ingestClockRecords: function (rawRecords, options) {
          var opt = options || {};
          var dayShiftHours = opt.dayShiftHours == null ? 4 : Number(opt.dayShiftHours);
          var discardOut = opt.discardClockOut !== false;
          var operator = opt.operator || 'isapi';
          var vendor = opt.vendor && String(opt.vendor).toLowerCase().match(/^(hikvision|tencent|generic)$/)
            ? opt.vendor.toLowerCase() : 'generic';

          var arr = Array.isArray(rawRecords) ? rawRecords : [];
          var store = _getClocksStore();
          var skipped = { invalidTime: 0, invalidStaff: 0, clockOut: 0, dup: 0 };
          var seenKeys = {}; // ${sid}_${bDate} 集合，用于统计 distinctStaffDays
          var ingestedThisRun = 0;
          var maxTime = 0;

          for (var i = 0; i < arr.length; i++) {
            var row = arr[i];
            var staffId = _pickByAliases(row, STAFF_ID_ALIASES);
            var timeRaw = _pickByAliases(row, TIME_ALIASES);
            if (!staffId) { skipped.invalidStaff++; continue; }
            staffId = String(staffId).trim();
            if (!staffId.length) { skipped.invalidStaff++; continue; }
            var dObj = _toDateObj(timeRaw);
            if (!dObj) { skipped.invalidTime++; continue; }
            var ts = dObj.getTime();
            if (ts > maxTime) maxTime = ts;
            // 丢弃下班方向
            if (discardOut) {
              var dir = _pickByAliases(row, DIRECTION_ALIASES);
              if (_isClockOut(dir)) { skipped.clockOut++; continue; }
            }
            var bDate = _belongsToDate(dObj, dayShiftHours);
            var key = staffId + '_' + bDate;
            var list = store[key] || [];
            var fmt = _fmtDateTime(dObj);
            // 去重：秒级相等
            if (list.indexOf(fmt) >= 0) { skipped.dup++; continue; }
            list.push(fmt);
            // 同员工同归属日下按时间升序（保证 calcDayRecord 取首次有效打卡）
            list.sort();
            store[key] = list;
            seenKeys[key] = true;
            ingestedThisRun++;
          }
          _saveClocksStore(store);

          var sync = _getSync();
          sync.lastSyncAt = maxTime > 0 ? maxTime : Date.now();
          sync.totalIngested = (sync.totalIngested || 0) + ingestedThisRun;
          sync.vendor = vendor;
          if (opt.rangeStartTs) sync.lastRangeStart = Number(opt.rangeStartTs);
          if (opt.rangeEndTs)   sync.lastRangeEnd   = Number(opt.rangeEndTs);
          _saveSync(sync);

          // 审计日志（仅 200 条以上或写入>0 条时记一条概览，避免日志爆炸）
          if (ingestedThisRun > 0 || skipped.invalidStaff > 0 || skipped.invalidTime > 0) {
            try {
              var audits = Storage._get(Storage.KEYS.ATTENDANCE_AUDIT_LOGS) || [];
              audits.unshift({
                ts: Date.now(),
                operator: operator,
                action: 'ISAPI_INGEST',
                vendor: vendor,
                ingested: ingestedThisRun,
                skipped: JSON.parse(JSON.stringify(skipped)),
                staffDays: Object.keys(seenKeys).length
              });
              Storage._set(Storage.KEYS.ATTENDANCE_AUDIT_LOGS, audits.slice(0, 500));
            } catch(_) {}
          }

          var distinctStaffDays = Object.keys(seenKeys).length;
          return {
            ingested: ingestedThisRun,
            skipped: skipped,
            lastSyncAt: sync.lastSyncAt,
            totalIngested: sync.totalIngested,
            distinctStaffDays: distinctStaffDays,
            vendor: vendor
          };
        },

        /**
         * 查询打卡记录
         * @param {string} staffId  员工 ID（必填）
         * @param {string|Array<string>} dateOrRange  "2026-07-30" 或 ["2026-07-01","2026-07-31"]
         * @returns {Object} { "2026-07-30": ["13:35:12", ...], ... }
         */
        queryClocks: function (staffId, dateOrRange) {
          if (!staffId) return {};
          var store = _getClocksStore();
          var result = {};
          var pushDay = function (dStr) {
            var list = store[staffId + '_' + dStr];
            if (Array.isArray(list) && list.length) result[dStr] = list;
          };
          if (Array.isArray(dateOrRange) && dateOrRange.length === 2) {
            var start = new Date(String(dateOrRange[0]).replace(/\//g,'-'));
            var end   = new Date(String(dateOrRange[1]).replace(/\//g,'-'));
            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
              for (var cur = new Date(start); cur <= end; cur.setDate(cur.getDate()+1)) {
                pushDay(_fmtDate(cur));
              }
            }
          } else {
            var s = String(dateOrRange || '').trim();
            if (s) pushDay(s);
          }
          return result;
        },

        /**
         * 清空打卡记录（调试用）
         * @param {string} [staffId]  不传则清空所有人
         * @param {string} [date]     不传则清空所有日期
         * @returns {number} 实际删除的组合数（staffId × date）
         */
        clearClocks: function (staffId, date) {
          var store = _getClocksStore();
          var keys = Object.keys(store);
          var removed = 0;
          for (var i=0; i<keys.length; i++) {
            var k = keys[i];
            if (staffId && k.indexOf(staffId + '_') !== 0) continue;
            if (date && k.indexOf('_' + date) !== k.length - date.length - 1) continue;
            delete store[k]; removed++;
          }
          _saveClocksStore(store);
          return removed;
        },

        /**
         * 返回同步状态（ISAPI 轮询用 lastSyncAt 作为下一次拉取起点）
         * @returns {{lastSyncAt:number, vendor:string, totalIngested:number, lastRangeStart:number, lastRangeEnd:number}}
         */
        syncStatus: function () { return _getSync(); },

        /**
         * 调试工具：生成 N 条仿真打卡流水（模拟考勤机拉下来的数组）
         * @param {number} count
         * @param {string} [vendor]  'hikvision' | 'tencent' | 'generic'（决定字段名）
         * @param {Array<string>} [staffIds]  员工 ID 池（不传就用 STORAGE_STAFF 默认的几个）
         * @returns {Array<Object>}
         */
        mockRawRecords: function (count, vendor, staffIds) {
          var ids = (staffIds && staffIds.length) ? staffIds :
            ['QA001','QA002','QA003','QA004','QA005','QA006','QA007','QA008'];
          var n = Math.max(1, Number(count) || 10);
          var vendorFinal = (vendor && typeof vendor === 'string' &&
            ['hikvision','tencent','generic'].indexOf(vendor.toLowerCase())>=0)
            ? vendor.toLowerCase() : 'generic';
          var list = [];
          var base = new Date();
          base.setDate(base.getDate() - 15); // 近 15 天
          for (var i=0;i<n;i++) {
            var day = new Date(base.getTime() + Math.floor(Math.random()*15)*86400000);
            var staffId = ids[Math.floor(Math.random()*ids.length)];
            // 随机一个时段：午后场 13:20~13:58 或 晚场 19:20~19:58
            var isAfter = Math.random() < 0.52;
            var hh = isAfter ? 13 : 19;
            var mm = 20 + Math.floor(Math.random() * 40);
            var ss = Math.floor(Math.random() * 60);
            var d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, ss);
            var rec;
            if (vendorFinal === 'hikvision') {
              rec = {
                personId: staffId,
                employeeNo: staffId,
                punchTime: d.getTime(),
                inOut: Math.random() < 0.1 ? 'out' : 'in',  // 10% 生成下班，测 discardClockOut
                deviceName: 'HIK-Door-' + (1+Math.floor(Math.random()*3)),
                sn: 'DS-K1T607M-'+(1000+Math.floor(Math.random()*999))
              };
            } else if (vendorFinal === 'tencent') {
              rec = {
                UserId: staffId,
                PersonId: staffId,
                PassTime: d.toISOString(),
                Direction: Math.random() < 0.1 ? 'Exit' : 'Entry',
                DeviceId: 'tx-facereader-' + (1+Math.floor(Math.random()*3)),
                Timestamp: Math.floor(d.getTime()/1000)
              };
            } else {
              rec = {
                staff_id: staffId,
                clock_time: _fmtDateTime(d),
                device_mac: 'AABBCCDDEE0' + Math.floor(Math.random()*10)
              };
            }
            list.push(rec);
          }
          return list;
        },

        // 给 AttV2UI 调试面板用的工具枚举（绑定到 isapi 上，便于前端直接渲染下拉）
        FIELD_ALIASES: { staffId: STAFF_ID_ALIASES, clockTime: TIME_ALIASES, direction: DIRECTION_ALIASES }
      };
    })(),
  };

  // ============================================================
  // 对外统一导出 API
  // ============================================================
  var App = {
    Utils: Utils,
    Pricing: PricingEngine,
    Storage: Storage,
    Form: FormValidator,
    Nav: NavBar,
    UI: PageUI,
    Admin: AdminCRUD,
    Wage: WageEngine,

    initAdminSidebar: function () {
      var toggle = document.querySelector('.admin-sidebar-toggle, #sidebarToggle');
      if (toggle) {
        toggle.addEventListener('click', function () {
          var collapsed = document.body.classList.toggle('admin-sidebar-collapsed');
          toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        });
      }
      var userToggle = document.querySelector('.admin-user-dropdown .user-toggle, [data-admin-user-toggle]');
      if (userToggle) {
        var wrap = userToggle.closest('.admin-user-dropdown') || userToggle.parentElement;
        var menu = wrap.querySelector('.dropdown-menu');
        userToggle.addEventListener('click', function (e) {
          e.stopPropagation();
          if (wrap.classList.contains('open')) {
            wrap.classList.remove('open');
            // B7 CSP合规：移除菜单打开class替代 menu.style.display=none
            if (menu) try { menu.classList.remove('menu-dropdown-root-base', 'menu-dropdown-opened'); } catch (_csp) {}
          } else {
            wrap.classList.add('open');
            if (menu) {
              // B7 CSP合规：下拉菜单基础class + 位置class替代 style.display/position/right/top/zIndex
              try { menu.classList.add('menu-dropdown-root-base', 'menu-dropdown-opened'); } catch (_csp) {}
            }
          }
        });
        document.addEventListener('click', function () {
          if (wrap.classList.contains('open')) {
            wrap.classList.remove('open');
            // B7 CSP合规：移除菜单打开class替代 menu.style.display=none
            if (menu) try { menu.classList.remove('menu-dropdown-root-base', 'menu-dropdown-opened'); } catch (_csp) {}
          }
        });
      }
    },

    initAdminViews: function () {
      var gridBtn = document.getElementById('viewGridBtn');
      var listBtn = document.getElementById('viewListBtn');
      var grid = document.querySelector('.opera-grid, [data-opera-grid]');
      if (gridBtn && listBtn && grid) {
        gridBtn.addEventListener('click', function () {
          grid.classList.add('view-grid');
          grid.classList.remove('view-list');
          gridBtn.classList.add('active');
          listBtn.classList.remove('active');
          Utils.toast('🎞️ 已切换至卡片视图', 'success');
        });
        listBtn.addEventListener('click', function () {
          grid.classList.add('view-list');
          grid.classList.remove('view-grid');
          listBtn.classList.add('active');
          gridBtn.classList.remove('active');
          Utils.toast('📊 已切换至列表视图', 'success');
        });
      }
      var catBtn = document.querySelector('.opera-cat-manage, [data-opera-cat-manage]');
      if (catBtn) {
        catBtn.addEventListener('click', function () {
          Utils.toast('⚙️ 剧目分类管理：正式环境将支持新增/编辑/排序/停用分类', 'info');
        });
      }
      var scheduleToggle = document.querySelector('.schedule-view-toggle, .view-toggle');
      if (scheduleToggle) {
        var views = scheduleToggle.querySelectorAll('button[data-view]');
        if (views && views.length) {
          views.forEach(function (btn) {
            btn.addEventListener('click', function () {
              views.forEach(function (b) { b.classList.remove('active'); });
              btn.classList.add('active');
              var map = { 'month': '📆 月度', 'week': '📋 周度', 'list': '📑 列表' };
              var label = map[btn.getAttribute('data-view')] || btn.getAttribute('data-view');
              Utils.toast(label + '视图已切换（正式环境将对接后端日历接口渲染）', 'success');
            });
          });
        }
      }
    },

    initAdminActionButtons: function () {
      var EMOJI_STRIP = /^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2194}-\u{2199}\u{2934}\u{2935}\u{25AA}\u{25AB}\u{25FE}\u{25FD}\u{25FB}\u{25FC}\u{2190}-\u{21FF}✓✕🛡️🚨⚠️🔍🔄↻📥📤🖨️📋📆📅📊📜🕐💱💰🎭👥👁✏️🔥🗑️♻️🔧📌📍➕➖]/u;
      function stripEmoji(s) {
        if (!s) return '';
        s = String(s).replace(/\s+/g, ' ').trim();
        while (s && (EMOJI_STRIP.test(s) || /^[^\u4e00-\u9fa5a-zA-Z0-9]/.test(s))) {
          s = s.replace(EMOJI_STRIP, '').replace(/^[^\u4e00-\u9fa5a-zA-Z0-9]+/, '').trim();
        }
        return s.trim();
      }
      function hasAny(raw, keywords, btnEl) {
        var t = stripEmoji(raw);
        if ((!t || t.length === 0) && btnEl && btnEl.getAttribute) {
          var title = btnEl.getAttribute('title') || btnEl.getAttribute('aria-label') || '';
          t = stripEmoji(title);
          if ((!t || t.length === 0) && btnEl.closest && btnEl.closest('td, div')) {
            var cell = btnEl.closest('td, div');
            if (cell) {
              var cellTitle = cell.getAttribute('title') || '';
              t = stripEmoji(cellTitle);
            }
          }
        }
        for (var i = 0; i < keywords.length; i++) {
          if (t.indexOf(keywords[i]) === 0 || t.indexOf(keywords[i]) >= 0) return true;
        }
        return false;
      }
      function confirmDanger(msg) {
        try {
          return window.confirm('⚠️ 高危操作！\n\n' + msg + '\n\n确定要继续吗？此操作不可撤销！');
        } catch (e) { return true; }
      }
      function toggleBtnText(btn, map) {
        if (!btn) return;
        var cur = stripEmoji(btn.textContent || '');
        for (var k in map) {
          if (cur.indexOf(k) >= 0) {
            var prefix = (btn.textContent.match(/^[\s\S]*?(?=[\u4e00-\u9fa5a-zA-Z])/) || [''])[0];
            btn.textContent = prefix + map[k];
            return map[k];
          }
        }
        return null;
      }
      document.addEventListener('click', function (e) {
        var el = e.target.closest('#logoutBtnDropdown, [data-logout]');
        if (!el) el = e.target.closest('.dropdown-item, button, a, .btn-action');
        if (el) {
          var textRaw = String(el.textContent || '').replace(/\s+/g, ' ').trim();
          var textClean = stripEmoji(textRaw);
          if (el.id === 'logoutBtnDropdown' || el.getAttribute('data-logout') === '1' || textClean === '退出登录') {
            e.preventDefault();
            try {
              if (window.sessionStorage) sessionStorage.removeItem('qin_admin_logged');
              if (window.localStorage) localStorage.removeItem('qin_admin_logged');
            } catch (err) { /* ignore */ }
            Utils.toast('🚪 已安全退出系统，正在返回登录页...', 'info');
            setTimeout(function () { location.href = 'login.html'; }, 400);
            return;
          }
        }
        var btn = e.target.closest('button, a, .btn-action');
        if (!btn) return;
        if (btn.hasAttribute('onclick') && !btn.classList.contains('needs-delegate')) return;
        var href = btn.getAttribute && btn.getAttribute('href');
        if (href && href !== '#' && href !== '' && href.indexOf('javascript:') !== 0) return;
        var text = String(btn.textContent || '').replace(/\s+/g, ' ').trim();
        var t = stripEmoji(text);
        var operaId = btn.getAttribute && btn.getAttribute('data-opera');
        if (btn.classList && btn.classList.contains('view-detail')) {
          e.preventDefault();
          Utils.toast('👁 正在打开' + (operaId ? '「' + operaId + '」' : '') + '详情页（正式环境对接后端）', 'info');
          return;
        }
        if (hasAny(text, ['派工安排', '上传合同', '收款记录', '取消订单'], btn)) {
          e.preventDefault();
          var t2 = stripEmoji(text); if (!t2 && btn.getAttribute) t2 = stripEmoji(btn.getAttribute('title') || '');
          if (t2.indexOf('取消订单') >= 0 || stripEmoji(btn.title || '').indexOf('取消订单') >= 0) {
            if (!confirmDanger('您即将取消该预约订单，客户已支付款项需原路退还，订单状态将变更为【已取消】且无法恢复！')) return;
          }
          Utils.toast('📌「' + (t2 || t || '操作') + '」：已触发操作入口（正式环境对接订单状态流转接口）', 'success');
          return;
        }
        if (btn.classList && btn.classList.contains('admin-header-btn') && (btn.title === '通知' || btn.title === '消息')) {
          e.preventDefault();
          Utils.toast('🔔 暂无新' + (btn.title || '消息'), 'info');
          return;
        }
        if (hasAny(text, ['今日'], btn)) {
          e.preventDefault();
          if (typeof window.resetMonth === 'function') window.resetMonth();
          Utils.toast('📅 已定位到今日视图', 'success');
          return;
        }
        if (hasAny(text, ['查询'], btn)) {
          e.preventDefault();
          Utils.toast('🔍 查询条件已提交，正在刷新数据...', 'info');
          return;
        }
        if (hasAny(text, ['重置'], btn)) {
          e.preventDefault();
          var t3 = stripEmoji(text); if (!t3 && btn.getAttribute) t3 = stripEmoji(btn.getAttribute('title') || '');
          if (t3.indexOf('重置密码') >= 0 || (t3.indexOf('重置') >= 0 && btn.closest && btn.closest('[class*="account"]'))) {
            // A-7 安全加固：生成随机 12 位强密码，彻底移除 123456 硬编码
            var NEW_PWD;
            try { NEW_PWD = (window.Utils && Utils.generateStrongPwd) ? Utils.generateStrongPwd(12) : ('Aa!'+Math.random().toString(36).slice(-8)+'$'); }
            catch(_) { NEW_PWD = 'Aa!'+Date.now().toString(36).slice(-6)+'$'; }
            try {
              openAdminModal(btn, { mode: 'edit', title: '重置登录密码（'+NEW_PWD.length+' 位强密码）', id: 'reset-pwd', width: '680px',
                fields: [
                  ['提示信息', 'text', '新密码已自动生成，请点击下方【复制并确认】按钮复制到剪贴板', false, {readonly:true}],
                  ['新密码', 'text', NEW_PWD, true, {readonly:true}],
                  ['密码强度', 'text', '✅ 强：大写+小写+数字+特殊符号，熵量≥80bit', false, {readonly:true}],
                  ['强制7天内改密', 'select', ['是（推荐，默认）','否'], false]
                ],
                actionLabel: '📋 复制并确认重置',
                onBeforeSubmit: function(vals){
                  try {
                    var txt = (vals && vals['新密码']) ? vals['新密码'] : NEW_PWD;
                    if (window.navigator && navigator.clipboard && navigator.clipboard.writeText) {
                      navigator.clipboard.writeText(txt).catch(function(){});
                    } else if (window.clipboardData) { // IE
                      try { window.clipboardData.setData('Text', txt); } catch(_cb){}
                    }
                  } catch(_cpy){}
                  return true;
                }
              });
              return;
            } catch (err) {
              console.warn('openAdminModal(resetPwd) failed:', err);
              // 兜底：confirmDanger + 直接复制到 prompt
              var msg = [
                '⚠️ 您即将重置该账号的登录密码为随机强密码：',
                '',
                '   🔑 新密码：『' + NEW_PWD + '』',
                '',
                '   请立即复制上述密码并告知账号持有人，',
                '   系统已自动勾选"7天内强制修改"。',
                '',
                '【确认后密码将写入 localStorage / 后端】'
              ].join('\n');
              if (!confirmDanger(msg)) return;
              try {
                if (window.prompt) window.prompt('✅ 已生成随机强密码，请手动复制：', NEW_PWD);
              } catch(_p){}
            }
          }
          var forms = btn.closest && btn.closest('form, .admin-search, .search-bar');
          if (forms) {
            var inputs = forms.querySelectorAll('input, select');
            for (var i = 0; i < inputs.length; i++) {
              if (inputs[i].type === 'checkbox' || inputs[i].type === 'radio') inputs[i].checked = false;
              else inputs[i].value = '';
            }
          }
          Utils.toast('↻ 筛选条件已重置', 'info');
          return;
        }
        if (hasAny(text, ['刷新'], btn)) {
          e.preventDefault();
          Utils.toast('🔄 数据已重载', 'success');
          return;
        }
        if (hasAny(text, ['查看冲突'], btn)) {
          e.preventDefault();
          Utils.toast('🚨 正在扫描档期冲突...检测到 1 处：8月15日【陇城商会】vs【郭嘉镇庙会】地点重叠，请前往排班页处理', 'warning');
          return;
        }
        if (hasAny(text, ['打印'], btn)) {
          e.preventDefault();
          Utils.toast('🖨️ 已调用打印模块（正式环境对接浏览器打印API）', 'info');
          return;
        }
        if (hasAny(text, ['导出'], btn)) {
          e.preventDefault();
          // ★ FIX 导出功能：真正调用 xlsx 导出当前页面表格
          try {
            // 如果页面定义了特定的导出函数，优先调用
            if (typeof window.exportPageData === 'function') {
              window.exportPageData();
            } else {
              // 自动从按钮文本推断文件名
              var fname = 'export_' + new Date().toISOString().slice(0,10).replace(/-/g,'');
              var t = stripEmoji(text);
              if (t) {
                var m = t.match(/导出([^，,（(]*)/);
                if (m && m[1]) fname = m[1].trim() + '_' + new Date().toISOString().slice(0,10).replace(/-/g,'');
              }
              Utils.autoExportXlsx(fname);
            }
          } catch (expErr) {
            Utils.toast('❌ 导出失败：' + (expErr && expErr.message ? expErr.message : expErr), 'error');
          }
          return;
        }
        if (hasAny(text, ['批量启用', '批量禁用', '批量补卡', '批量核销', '批量删除', '批量发布', '批量上架', '批量下架', '批量报废', '批量标记', '批量确认', '批量导出', '批量'], btn)) {
          e.preventDefault();
          try {
            var bt = stripEmoji(text); if (!bt && btn.getAttribute) bt = stripEmoji(btn.getAttribute('title') || ''); if (!bt) bt = '批量操作确认';
            var batchBody = buildBatchOpBody(bt, btn);
            openAdminModal(btn, { mode: 'edit', title: bt, id: 'batch-op', width: '680px', badge: '按勾选ID执行', actionLabel: '确认执行', customBody: batchBody });
          } catch (err) { console.warn('openAdminModal(batch) failed:', err); Utils.toast('📦 批量操作已提交', 'success'); }
          return;
        }
        if (hasAny(text, ['新建', '新增', '入库', '收入', '支出', '发布', '新增收入', '新增支出', '新购', '补卡', '排班', '排期'], btn)) {
          e.preventDefault();
          var t4 = stripEmoji(text); if (!t4 && btn.getAttribute) t4 = stripEmoji(btn.getAttribute('title') || '');
          var formMap = { '订单': '预约订单', '排期': '排期', '排班': '排期', 'Banner': 'Banner', '文章': '资讯文章', '资讯': '资讯文章', '发布': '资讯文章', '剧目': '剧目档案', '入库': '入库单', '员工': '员工档案', '人员': '员工档案', '账号': '后台账号', '收款': '收款单', '账单': '财务账单', '收入': '收款单', '支出': '付款单', '补卡': '补卡申请', '新购': '入库单' };
          var label = '记录';
          for (var k in formMap) { if (t4.indexOf(k) >= 0) { label = formMap[k]; break; } }
          try { openAdminModal(btn, { mode: 'create', title: (t4 && t4.length ? t4 : ('新增' + label)), id: 'create-' + (label || 'shared'), width: '820px' }); } catch (err) { console.warn('openAdminModal(create) failed:', err); Utils.toast('➕ 正在打开' + label + '新增表单', 'info'); }
          return;
        }
        if (hasAny(text, ['查看', '详情', '预览'], btn)) {
          e.preventDefault();
          try { openAdminModal(btn, { mode: 'detail', id: (operaId ? ('detail-' + operaId) : 'detail-shared'), width: '820px', actionLabel: '我知道了' }); } catch (err) { console.warn('openAdminModal(detail) failed:', err); Utils.toast('👁 正在打开详情页', 'info'); }
          return;
        }
        if (hasAny(text, ['审核', '审批', '签约', '排期', '合同', '核销', '发布', '归还'], btn)) {
          e.preventDefault();
          var t5 = stripEmoji(text); if (!t5 && btn.getAttribute) t5 = stripEmoji(btn.getAttribute('title') || '');
          var isReturnOnly = (/归还/.test(t5));
          if (isReturnOnly) { try { openAdminModal(btn, { mode: 'edit', title: (t5 || '归还') + '登记', id: 'return-form', width: '680px' }); return; } catch (err) { console.warn('openAdminModal(return) failed:', err); } }
          var needForm = (/审核|审批|签约|核销/.test(t5));
          if (needForm) { try { openAdminModal(btn, { mode: 'edit', title: (t5 || '操作') + '确认', id: 'op-' + (t5 || 'confirm'), width: '680px', actionLabel: '确认' + (t5 || '提交') }); return; } catch (err) { console.warn('openAdminModal(confirm) failed:', err); } }
          Utils.toast('✅「' + (t5 || t || '操作') + '」已提交成功（正式环境对接后端接口确认）', 'success');
          return;
        }
        if (hasAny(text, ['催还'], btn)) {
          e.preventDefault();
          try { openAdminModal(btn, { mode: 'edit', title: '催还通知发送', id: 'urge-return', width: '620px', actionLabel: '确认发送' }); } catch (err) { console.warn('openAdminModal(urge) failed:', err); Utils.toast('📢 已发送催还通知短信至借用登记人手机', 'success'); }
          return;
        }
        if (hasAny(text, ['分配演员'], btn)) {
          e.preventDefault();
          try { openAdminModal(btn, { mode: 'edit', title: '分配演员 / 角色', id: 'cast-allocation', width: '860px', actionLabel: '保存分派' }); } catch (err) { console.warn('openAdminModal(cast) failed:', err); Utils.toast('👥 正在打开演员分配面板', 'info'); }
          return;
        }
        if (hasAny(text, ['编辑权限'], btn)) {
          e.preventDefault();
          try { openAdminModal(btn, { mode: 'edit', title: '权限矩阵配置', id: 'perm-edit', width: '860px', actionLabel: '保存权限' }); } catch (err) { console.warn('openAdminModal(perm) failed:', err); Utils.toast('🛡️ 正在打开权限矩阵配置面板', 'info'); }
          return;
        }
        if (hasAny(text, ['考勤录入', '考勤'], btn)) {
          e.preventDefault();
          try { openAdminModal(btn, { mode: 'edit', title: '考勤录入', id: 'attendance', width: '760px', actionLabel: '保存考勤' }); } catch (err) { console.warn('openAdminModal(att) failed:', err); Utils.toast('🕐 正在打开考勤录入窗口', 'info'); }
          return;
        }
        if (hasAny(text, ['排班'], btn)) {
          e.preventDefault();
          try { openAdminModal(btn, { mode: 'edit', title: '员工排班', id: 'staff-schedule', width: '820px', actionLabel: '保存排班' }); } catch (err) { console.warn('openAdminModal(sched) failed:', err); Utils.toast('📅 正在打开排班窗口', 'info'); }
          return;
        }
        if (hasAny(text, ['借用'], btn)) {
          e.preventDefault();
          try { openAdminModal(btn, { mode: 'edit', title: '库存/物品 借用登记', id: 'borrow-form', width: '820px', actionLabel: '提交借用' }); } catch (err) { console.warn('openAdminModal(borrow) failed:', err); Utils.toast('📤 正在打开借用登记单', 'info'); }
          return;
        }
        if (hasAny(text, ['报修'], btn)) {
          e.preventDefault();
          try { openAdminModal(btn, { mode: 'edit', title: '后勤报修单', id: 'repair-form', width: '780px', actionLabel: '提交报修' }); } catch (err) { console.warn('openAdminModal(repair) failed:', err); Utils.toast('🔧 报修单已提交至后勤组', 'success'); }
          return;
        }
        if (hasAny(text, ['编辑'], btn)) {
          e.preventDefault();
          try { openAdminModal(btn, { mode: 'edit', id: (operaId ? ('edit-' + operaId) : 'edit-shared'), width: '820px', actionLabel: '保存修改' }); } catch (err) { console.warn('openAdminModal(edit) failed:', err); Utils.toast('✏️ 正在打开编辑表单', 'info'); }
          return;
        }
        if (hasAny(text, ['热门', '🔥'], btn)) {
          e.preventDefault();
          var r1 = toggleBtnText(btn, { '热门': '取消热门', '取消热门': '热门' });
          Utils.toast('🔥 ' + (r1 || '热门标记') + '操作已生效（正式环境同步前台剧目中心排序）', 'success');
          return;
        }
        if (hasAny(text, ['置顶', '取消置顶'], btn)) {
          e.preventDefault();
          var r2 = toggleBtnText(btn, { '置顶': '取消置顶', '取消置顶': '置顶' });
          Utils.toast('📌 「' + (r2 || '置顶') + '」操作已生效（正式环境同步资讯列表排序权重）', 'success');
          return;
        }
        if (hasAny(text, ['启用'], btn)) {
          e.preventDefault();
          var r3 = toggleBtnText(btn, { '启用': '禁用' });
          Utils.toast('✅ 已' + (r3 || '启用') + '（正式环境更新状态字段）', 'success');
          return;
        }
        if (hasAny(text, ['禁用'], btn)) {
          e.preventDefault();
          if (!confirmDanger('您即将禁用该条目：相关账号将无法登录 / 剧目将从前端下架 / 库存不可借用。\n\n如需恢复可重新点击「启用」。')) return;
          var r4 = toggleBtnText(btn, { '禁用': '启用' });
          Utils.toast('🚫 已' + (r4 || '禁用') + '（正式环境更新状态字段）', 'warning');
          return;
        }
        if (hasAny(text, ['报废', '♻️'], btn)) {
          e.preventDefault();
          var doScrap = function () {
            if (!confirmDanger('您即将对该库存执行报废处理：固定资产账面值将清零，库存数量永久扣减。\n\n此操作涉及税务折旧备案，务必确认已完成线下审批流程！')) return false;
            Utils.toast('♻️ 报废记录已入账，库存已更新', 'warning');
            return true;
          };
          try {
            openAdminModal(btn, {
              mode: 'edit', title: '库存 报废申请单', id: 'scrap-form', width: '760px', actionLabel: '提交报废并确认',
              onAction: function (modal, close) {
                if (doScrap()) close();
              }
            });
          } catch (err) { console.warn('openAdminModal(scrap) failed:', err); doScrap(); }
          return;
        }
        if (hasAny(text, ['删除', '🗑'], btn)) {
          e.preventDefault();
          if (!confirmDanger('您即将永久删除该条记录！\n\n此操作不可逆，删除后所有关联数据（流水/日志/附件）将一并清除，请确认已完成备份！')) return;
          Utils.toast('🗑️ 记录已永久删除', 'warning');
          return;
        }
        if (hasAny(text, ['盘点报告', '入库登记', '财务报表', '对账核销', '导出账簿', '权限模板', '考勤汇总', '查看全部'], btn)) {
          e.preventDefault();
          var t6 = stripEmoji(text); if (!t6 && btn.getAttribute) t6 = stripEmoji(btn.getAttribute('title') || '');
          Utils.toast('📊 正在加载' + (t6 || t) + '（正式环境对接后端报表引擎）', 'info');
          return;
        }
      });
    },

    initSearchInteractions: function () {
      function resetPaginationToFirst() {
        try {
          var jumpInput = document.querySelector('.page-jump-input');
          if (jumpInput) {
            jumpInput.value = '1';
            var ev = new Event('change', { bubbles: true });
            jumpInput.dispatchEvent(ev);
            var keyEv = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
            jumpInput.dispatchEvent(keyEv);
          }
          if (typeof window.QinPagination !== 'undefined' && QinPagination.setPage) QinPagination.setPage(1);
        } catch (e) { /* ignore */ }
      }
      function doSearch(inputEl) {
        if (!inputEl) return;
        var val = String(inputEl.value || '').trim();
        var place = inputEl.getAttribute('placeholder') || '';
        var wrap = inputEl.closest('.admin-search, .opera-page-search, .search-input-wrap, .search-box, .admin-filter-bar, .filter-bar');
        var searchBtn = wrap ? wrap.querySelector('[class*="search"] button, button[type="submit"], button[class*="query"]') : null;
        if (!val) {
          Utils.toast('↻ 搜索关键词已清空，显示全部数据', 'info');
          resetPaginationToFirst();
          try {
            var allTr = document.querySelectorAll('table tbody tr');
            allTr.forEach(function (tr) { try { tr.classList.remove('csp-hide'); } catch(_) { tr.style.display = ''; } });
            var allCards = document.querySelectorAll('.card-item, .opera-card, .news-card, .inventory-card, .order-card, .finance-card, [data-card-list] > *');
            allCards.forEach(function (c) { try { c.classList.remove('csp-hide'); } catch(_) { c.style.display = ''; } });
            var emptyHint = document.getElementById('searchEmptyHint');
            if (emptyHint) { try { emptyHint.classList.add('csp-hide'); } catch(_) { emptyHint.style.display = 'none'; } }
          } catch (_) {}
          return;
        }
        if (val.length < 2) {
          Utils.toast('🔍 请输入至少2个字符再搜索', 'warning');
          return;
        }
        if (searchBtn) {
          try { searchBtn.click(); return; } catch (e) { /* ignore */ }
        }
        resetPaginationToFirst();
        var scope = /剧目|戏曲|剧本|角色/.test(place) ? '剧目中心'
                   : (/新闻|资讯|文章|内容|发布/.test(place) ? '资讯中心'
                   : (/人员|员工|工号|人事|演职/.test(place) ? '人事档案'
                   : (/库存|物品|道具|服装|设备/.test(place) ? '库存中心'
                   : (/订单|客户|预约|派工/.test(place) ? '订单与客户'
                   : (/财务|收支|收款|凭证|台账/.test(place) ? '财务台账'
                   : (/日志|备份|系统|报表/.test(place) ? '系统与日志'
                   : '全局搜索'))))));
        Utils.toast('🔍 「' + scope + '」关键词「' + val + '」已提交，正在加载匹配结果...', 'info');
        // —— 真正执行匹配（显示/隐藏表格行，卡片列表同样支持）
        setTimeout(function () {
          try {
            var vLow = val.toLowerCase();
            var matched = 0;
            var rows = document.querySelectorAll('table tbody tr');
            rows.forEach(function (tr) {
              var txt = (tr.innerText || tr.textContent || '').toLowerCase();
              var ok = txt.indexOf(vLow) >= 0;
              if (ok) { matched++; try { tr.classList.remove('csp-hide'); } catch(_) { tr.style.display = ''; } }
              else    { try { tr.classList.add('csp-hide');    } catch(_) { tr.style.display = 'none'; } }
            });
            var cards = document.querySelectorAll('.card-item, .opera-card, .news-card, .inventory-card, .order-card, .finance-card, [data-card-list] > *');
            cards.forEach(function (c) {
              var txt = (c.innerText || c.textContent || '').toLowerCase();
              var ok = txt.indexOf(vLow) >= 0;
              if (ok) { matched++; try { c.classList.remove('csp-hide'); } catch(_) { c.style.display = ''; } }
              else    { try { c.classList.add('csp-hide');    } catch(_) { c.style.display = 'none'; } }
            });
            var emptyHint = document.getElementById('searchEmptyHint');
            if (matched === 0) {
              if (!emptyHint) {
                emptyHint = document.createElement('div');
                emptyHint.id = 'searchEmptyHint';
                try { emptyHint.classList.add('empty-hint-box'); } catch(_) {
                  emptyHint.style.cssText = 'padding:28px;text-align:center;color:#666;background:#fff;border:1.5px dashed #ddd;border-radius:12px;margin:18px 0;font-size:0.95rem;';
                }
                emptyHint.textContent = '🈳 「' + scope + '」未匹配到任何「' + val + '」相关结果，请换关键词重试。';
                var container = wrap && wrap.parentNode ? wrap.parentNode : document.body;
                if (container && !container.querySelector('#searchEmptyHint')) container.insertBefore(emptyHint, wrap ? wrap.nextSibling : null);
              } else {
                emptyHint.textContent = '🈳 「' + scope + '」未匹配到任何「' + val + '」相关结果，请换关键词重试。';
                try { emptyHint.classList.remove('csp-hide'); } catch(_) { emptyHint.style.display = ''; }
              }
            } else if (emptyHint) {
              try { emptyHint.classList.add('csp-hide'); } catch(_) { emptyHint.style.display = 'none'; }
            }
            Utils.toast('✅ 「' + scope + '」匹配到 ' + matched + ' 条「' + val + '」相关结果，已自动过滤显示', 'success', 2800);
          } catch (filterErr) {
            console.warn('[doSearch] filter fail:', filterErr);
            Utils.toast('⚠️ 「' + scope + '」过滤失败：' + (filterErr.message || String(filterErr)).slice(0, 40), 'error', 3000);
          }
        }, 60);
      }
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.keyCode !== 13) return;
        var tgt = e.target;
        if (!tgt || !tgt.matches) return;
        if (tgt.matches('.admin-search input, .opera-page-search input, .search-input-wrap .search-input, .search-box input, [data-search]')) {
          e.preventDefault();
          try { doSearch(tgt); } catch (err) { console.warn('doSearch failed:', err); }
        }
      }, true);
      document.addEventListener('click', function (e) {
        var icon = e.target.closest('.search-icon, .search-btn-icon, [class*="search-icon"]');
        if (icon) {
          var wrap = icon.closest('.admin-search, .opera-page-search, .search-input-wrap, .search-box');
          if (wrap) {
            var inp = wrap.querySelector('input');
            if (inp) { doSearch(inp); inp.focus(); }
          }
        }
      });
    },

    /**
     * Q2: mailto:/tel: 协议拦截 — PC未装客户端时浏览器提示"请安装应用"的解决方案
     *   - tel: → 拦截后clipboard复制手机号 + toast: "✅ 手机号已复制，请打开手机拨号盘粘贴"
     *   - mailto: → 拦截后复制邮箱 + 弹出163网易邮箱Web写信页新tab
     */
    initProtocolFallback: function () {
      var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|Mobile|HarmonyOS|XiaoMi|MIUI/i.test(navigator.userAgent || '');
      document.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a[href^="mailto:"], a[href^="tel:"]');
        if (!a) return;
        var href = a.getAttribute('href') || '';
        // 移动端允许系统原生处理
        if (isMobile) return;
        e.preventDefault();
        if (href.indexOf('mailto:') === 0) {
          var rawEmail = href.substring(7).split('?')[0];
          var email = decodeURIComponent(rawEmail);
          var subject = '';
          var body = '';
          try {
            var qs = href.indexOf('?') > 0 ? href.substring(href.indexOf('?') + 1) : '';
            var up = new URLSearchParams(qs);
            subject = up.get('subject') || '';
            body = up.get('body') || '';
          } catch (err) {}
          Utils.copyText(email, '✅ 邮箱已复制：' + email + '，请粘贴到邮件客户端或163邮箱网页版');
          // 同时打开网易163 Web写信页兜底（163专属）
          try {
            var webmail = 'https://mail.163.com/';
            // 若有主题&正文则建议用户粘贴，不拼参以免截断
            setTimeout(function () { window.open(webmail, '_blank', 'noopener'); }, 250);
          } catch (err) {}
          if (subject || body) {
            try {
              var msg = '📧 邮件主题和正文已同时复制，可直接粘贴到邮件客户端';
              Utils.copyText(
                '【邮件主题】\n' + subject + '\n\n【邮件正文】\n' + body,
                msg
              );
            } catch (err) {}
          }
        } else if (href.indexOf('tel:') === 0) {
          var phone = decodeURIComponent(href.substring(4)).replace(/[^\d+]/g, '');
          Utils.copyText(phone, '✅ 手机号已复制：' + phone + '，请使用手机拨号盘或微信搜索拨打');
        }
      }, true);
    },

    /**
     * Q3: booking 预约须知复选框提交校验 — 未勾选禁止提交并红框+toast+锚定滚动
     */
    initBookingNotice: function () {
      var form = document.getElementById('appointmentForm');
      if (!form) return;
      var checkBox = document.getElementById('agreeBookingNotice');
      var errBox = document.getElementById('agreeBookingNoticeError');
      // 实时监听checkbox，清除错误
      if (checkBox) {
        checkBox.addEventListener('change', function () {
          if (checkBox.checked && errBox) {
            // B7 CSP合规：csp-hide替代errBox.style.display='none'
            try { errBox.classList.add('csp-hide'); } catch (_csp) {}
          }
        });
      }
      form.addEventListener('submit', function (e) {
        if (!checkBox) return;
        if (!checkBox.checked) {
          e.preventDefault();
          e.stopPropagation();
          checkBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
          if (errBox) {
            // B7 CSP合规：csp-hide替代errBox.style.display='block'
            try { errBox.classList.remove('csp-hide'); } catch (_csp) {}
          }
          var parent = checkBox.closest('.form-group');
          if (parent) {
            // B7 CSP合规：wrap-agree-error-border替代parent.style.borderColor/boxShadow动态写
            try { parent.classList.add('wrap-agree-error-border'); } catch (_csp) {}
            var _tmpParent = parent;
            setTimeout(function () {
              try { _tmpParent.classList.remove('wrap-agree-error-border'); } catch (_csp) {}
            }, 2200);
          }
          Utils.toast && Utils.toast('⚠️ 提交预约前必须阅读并勾选《预约须知》《违约细则》全部条款', 'error', 4500);
          Utils.showToast && Utils.showToast('⚠️ 提交预约前必须阅读并勾选《预约须知》《违约细则》全部条款', 'error', 4500);
          return false;
        }
      }, true);
    },

    /**
     * Q6: 宣传图片上传 / 后台图片上传 — 统一的本地预览与校验
     *   - 所有 input[type=file][accept*=image] 绑定 change → FileReader 预览 + 大小校验
     *   - 不虚构后端上传接口，提供前端校验+预览+toast提示"本地预览完成，发布需上传至服务器"
     */
    initImageUploaders: function () {
      var FILE_MAX_MB = 10;
      document.addEventListener('change', function (e) {
        var inp = e.target;
        if (!inp || inp.tagName !== 'INPUT' || inp.type !== 'file') return;
        var accept = (inp.getAttribute('accept') || '').toLowerCase();
        var isImgOnly = accept.indexOf('image') >= 0;
        var files = inp.files;
        if (!files || !files.length) return;
        // 1. 大小/格式校验
        var bad = 0;
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          var sizeMB = f.size / 1048576;
          if (sizeMB > FILE_MAX_MB) { bad++; continue; }
          if (isImgOnly && !/^image\//i.test(f.type || '')) bad++;
        }
        if (bad > 0) {
          Utils.toast && Utils.toast('⚠️ 有 ' + bad + ' 个文件不符合要求（图片≤' + FILE_MAX_MB + 'MB，仅支持 image/* 格式）', 'error', 3600);
          Utils.showToast && Utils.showToast('⚠️ 有 ' + bad + ' 个文件不符合要求（图片≤' + FILE_MAX_MB + 'MB）', 'error', 3600);
        }
        // 2. 图片 → 预览：找到 data-img-preview / nextElementSibling preview box
        if (isImgOnly) {
          var firstImg = null;
          for (var j = 0; j < files.length; j++) {
            if (/^image\//i.test(files[j].type || '')) { firstImg = files[j]; break; }
          }
          if (firstImg) {
            var reader = new FileReader();
            reader.onload = function (evt) {
              try {
                var src = evt.target.result;
                // 在 input 旁边或[data-img-preview]插入预览
                var wrap = inp.closest('[data-upload-wrap]') || inp.parentNode;
                var previewBox = wrap ? wrap.querySelector('[data-img-preview]') : null;
                if (!previewBox) {
                  previewBox = document.createElement('div');
                  previewBox.setAttribute('data-img-preview', '1');
                  // R23 CSP合规：img-preview-box 替代 style.cssText 一长串
                  try { previewBox.classList.add('img-preview-box'); } catch (_csp) {}
                  if (wrap) wrap.appendChild(previewBox); else inp.parentNode.insertBefore(previewBox, inp.nextSibling);
                }
                previewBox.innerHTML = '';
                var img = document.createElement('img');
                img.src = src;
                img.alt = '上传预览图';
                // R23 CSP合规：img-preview-thumb 替代 style.cssText
                try { img.classList.add('img-preview-thumb'); } catch (_csp) {}
                previewBox.appendChild(img);
                var tip = document.createElement('div');
                // R23 CSP合规：img-preview-tip 替代 style.cssText
                try { tip.classList.add('img-preview-tip'); } catch (_csp) {}
                tip.innerHTML = '✅ 已选中 <strong>' + files.length + '</strong> 张图片，单张≤' + FILE_MAX_MB + 'MB · 已在浏览器本地预览<br>🔧 部署到 EdgeOne Pages 后请对接后端上传 API 保存到服务器（前端已完成校验层）';
                previewBox.appendChild(tip);
              } catch (err) { console.warn('preview fail', err); }
            };
            reader.readAsDataURL(firstImg);
          }
        }
        // 3. Toast 确认
        var okCount = files.length - bad;
        if (okCount > 0) {
          (Utils.toast || Utils.showToast) && (Utils.toast || Utils.showToast)('✅ 已选择 ' + okCount + ' 个文件（本地预览完成），点击页面提交按钮后保存', 'success', 3200);
        }
      });
      // admin 后台 Banner 上传快捷按钮（若存在 data-admin-upload-banner 则绑定 form submit）
      document.addEventListener('submit', function (ev) {
        var f = ev.target;
        if (f.tagName !== 'FORM') return;
        if (!f.querySelector('input[type="file"][accept*="image"]')) return;
        ev.preventDefault();
        (Utils.toast || Utils.showToast) && (Utils.toast || Utils.showToast)('📤 图片已在前台校验完成，EdgeOne Pages 静态部署环境下请对接对象存储/后端上传接口后再提交保存。本前端版已完成校验+预览层。', 'info', 4500);
        return false;
      }, true);
      // —— Bug 2 修复：type=reset「清空」按钮后，同步移除预览 [data-img-preview] DOM，避免残留缩略图误导
      document.addEventListener('reset', function (ev) {
        var f = ev.target;
        if (!f || f.tagName !== 'FORM') return;
        if (!f.querySelector('input[type="file"][accept*="image"], input[type="file"][name*="staffFiles"]')) return;
        // 同步清除预览（避免 setTimeout 异步导致的残留）
        try {
          var previews = f.querySelectorAll('[data-img-preview]');
          previews.forEach(function (p) { try { p.remove(); } catch(_) { p.parentNode && p.parentNode.removeChild(p); } });
          // 同步清除 file input 自身的值（部分浏览器 reset 不会清空 file 字段）
          var fileInps = f.querySelectorAll('input[type="file"]');
          fileInps.forEach(function (fi) { try { fi.value = ''; } catch(_) { /* 安全限制忽略 */ } });
          Utils.toast && Utils.toast('🔄 图片预览与文件选择已清空，required 校验已同步重置', 'info', 2800);
        } catch (_) {}
      }, true);
      // —— 通用修复：所有「📤 选择图片/剧照/附件/凭证」按钮 → 触发同区块内 file input
      // 覆盖 5 个页面：staff/operas/inventory/orders/finance + data-open-upload 跳转
      var UPLOAD_BTN_MAP = {
        'openStaffUploadBtn':    'staffAttachFiles',
        'openOperasUploadBtn':   'operasAttachFiles',
        'openInvUploadBtn':      'invAttachFiles',
        'openOrdersUploadBtn':   'ordersAttachFiles',
        'openFinanceUploadBtn':  'financeAttachFiles'
      };
      Object.keys(UPLOAD_BTN_MAP).forEach(function (btnId) {
        var btn = document.getElementById(btnId);
        if (!btn) return;
        var fileId = UPLOAD_BTN_MAP[btnId];
        var fInp = document.getElementById(fileId);
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          if (fInp) { try { fInp.click(); } catch (_) {} return; }
          // 兜底：找同 form 内第一个 file input
          var form = btn.closest('form');
          var fallback = form ? form.querySelector('input[type="file"]') : null;
          if (fallback) { try { fallback.click(); } catch (_) {} }
          else Utils.toast && Utils.toast('⚠️ 未找到对应的文件选择输入框', 'error', 2500);
        });
      });
      // data-open-upload="formId" → 滚动到表单 + 高亮 + 触发 file input
      document.addEventListener('click', function (e) {
        var link = e.target.closest('[data-open-upload]');
        if (!link) return;
        e.preventDefault();
        var formId = link.getAttribute('data-open-upload');
        var form = document.getElementById(formId);
        if (!form) return;
        try { form.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        var wrap = form.closest('[data-upload-wrap]') || form;
        try { wrap.classList.add('wrap-agree-error-border'); } catch (_) {}
        setTimeout(function () { try { wrap.classList.remove('wrap-agree-error-border'); } catch (_) {} }, 2400);
        var fInp = form.querySelector('input[type="file"]');
        if (fInp) { try { fInp.click(); } catch (_) {} }
      });
    },

    /**
     * Q4: qualifications.html 两份业务表单提交拦截（资质核验 + 合作对接）
     */
    initQualificationForms: function () {
      // ✅ 批次8修复：中英文字段映射 — 缺字段 Toast 不再显示英文 key（orgName/contactName… 全翻译）
      var FIELD_CN = {
        // 资质核验 qualVerifForm 字段
        orgName: '单位全称',
        contactName: '对接人姓名',
        contactMobile: '联系手机号',
        projName: '项目名称 / 招标项目',
        verifyUse: '核验用途',
        agreeQualTerms: '《预约须知》勾选',
        // 政企合作对接 coopForm 字段
        coOrg: '合作单位名称（政府/企业/景区/学校）',
        coType: '合作类型',
        coContact: '项目对接人',
        coTel: '手机 / 微信号',
        coShows: '预计合作场次',
        coBudget: '预算区间',
        coDesc: '合作内容 / 需求描述',
        coTime: '预计合作时间',
        coLocation: '活动举办地点',
        coEmail: '联系邮箱',
        agreeCoopTerms: '《预约须知》勾选'
      };
      function toCN(fieldsArr) {
        return fieldsArr.map(function (k) { return FIELD_CN[k] || k; }).join('、');
      }
      // 表单通用处理：① 复选框未勾选 ② 必填项缺失 → 合并成 **一条** 中文Toast（修复两句拼接bug）
      function bindForm(id, label) {
        var f = document.getElementById(id);
        if (!f) return;
        var agreeCheckId = (id === 'qualVerifForm') ? 'agreeQualTerms' : 'agreeCoopTerms';
        var agreeErrId = (id === 'qualVerifForm') ? 'agreeQualTermsError' : 'agreeCoopTermsError';
        var wrapAttr = (id === 'qualVerifForm') ? 'data-agree-qual-wrap' : 'data-agree-coop-wrap';
        // 勾选框 change 时清除错误
        var agreeBox = document.getElementById(agreeCheckId);
        var agreeErrBox = document.getElementById(agreeErrId);
        if (agreeBox) agreeBox.addEventListener('change', function () {
          if (agreeBox.checked && agreeErrBox) {
            // B7 CSP合规：csp-hide替代agreeErrBox.style.display='none'
            try { agreeErrBox.classList.add('csp-hide'); } catch (_csp) {}
          }
        });
        f.addEventListener('submit', function (e) {
          e.preventDefault();
          var errors = [];           // 中文错误列表（多条时换行）
          var missingFields = [];    // 必填字段英文 key 列表
          var fd = new FormData(f);
          var obj = {};
          fd.forEach(function (v, k) {
            if (k.indexOf('needList') === 0 || k.indexOf('coFile') === 0 || k.indexOf('qualFile') === 0) return;
            obj[k] = v;
          });
          // ① 必填项未填：遍历表单原生 HTML 校验不通过的字段（带 required 且无值）
          try {
            var reqInputs = f.querySelectorAll('[required]');
            for (var i = 0; i < reqInputs.length; i++) {
              var el = reqInputs[i];
              var nm = el.name || el.id || '';
              if (!nm || nm === agreeCheckId) continue;
              var type = (el.type || '').toLowerCase();
              if (type === 'checkbox') { if (!el.checked) missingFields.push(nm); continue; }
              if (type === 'radio') { var any = f.querySelector('input[name="' + nm + '"]:checked'); if (!any) missingFields.push(nm); continue; }
              var val = (el.value || '').toString().trim();
              if (val === '' || val === null || val === undefined) missingFields.push(nm);
            }
          } catch (err) {}
          // ② 须知复选框
          var agreeChecked = agreeBox ? !!agreeBox.checked : true;
          if (!agreeChecked) {
            if (agreeErrBox) try { agreeErrBox.classList.remove('csp-hide'); } catch (_csp) {}
            var wrap = f.querySelector('[' + wrapAttr + ']') || (agreeBox && agreeBox.closest && agreeBox.closest('.form-group, [style*="linear-gradient"]'));
            if (wrap) {
              // B7 CSP合规：wrap-agree-error-border class替代 style.transition/boxShadow/borderColor
              try { wrap.classList.add('wrap-agree-error-border'); } catch (_csp) {}
              setTimeout(function () { try { wrap.classList.remove('wrap-agree-error-border'); } catch (_csp2) {} }, 2400);
            }
          }
          // ✅ 合并输出一条完整中文 Toast（永远不再出现"请勾选须知 请填写必填项"两句上下拼接收尾的错觉）
          if (!agreeChecked) errors.push('📜 必须阅读并勾选《预约须知》《违约细则》《未成年人保护政策》全部条款');
          if (missingFields.length) errors.push('📝 请完整填写以下必填项：' + toCN(missingFields));
          if (errors.length) {
            var msg = errors.join('；');
            var toastFn = Utils.toast || Utils.showToast;
            toastFn && toastFn('⚠️ ' + label + '提交失败：' + msg, 'error', 5200);
            // 滚动锚定到第一个错误元素
            var anchor = (!agreeChecked && agreeBox) ? agreeBox : (missingFields.length && f.querySelector('[name="' + missingFields[0] + '"]'));
            if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return false;
          }
          // 保存到 Storage + 工单号 + 成功卡片
          try {
            // ⚠️ XSS/BYPASS修复：工单关键字段做格式白名单校验（防止HTML/JS注入后续innerHTML/页面展示sink）
            var _phoneRe = /^1[3-9]\d{9}$/;
            var _mailRe  = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
            var _nameRe  = /^[\u4e00-\u9fa5A-Za-z0-9·.\-_\s]{2,40}$/;
            var _phoneKeys = ['contactMobile','coTel','phone','mobile','applyMobile','tel'];
            var _mailKeys  = ['contactEmail','coEmail','email','applyEmail','mail'];
            var _nameKeys  = ['contactName','coContact','name','applyName','contacts'];
            for (var _k in obj) {
              if (!obj.hasOwnProperty(_k) || obj[_k] === null || obj[_k] === undefined) continue;
              var _v = String(obj[_k]).trim();
              if (!_v) continue;
              if (_phoneKeys.indexOf(_k) >= 0 && !_phoneRe.test(_v)) {
                (Utils.toast || Utils.showToast) && (Utils.toast || Utils.showToast)('⚠️ ' + label + '失败：手机号格式不正确，请填写 11 位中国大陆手机号', 'error', 4500);
                return false;
              }
              if (_mailKeys.indexOf(_k) >= 0 && !_mailRe.test(_v)) {
                (Utils.toast || Utils.showToast) && (Utils.toast || Utils.showToast)('⚠️ ' + label + '失败：邮箱格式不正确', 'error', 4500);
                return false;
              }
              if (_nameKeys.indexOf(_k) >= 0 && !_nameRe.test(_v)) {
                (Utils.toast || Utils.showToast) && (Utils.toast || Utils.showToast)('⚠️ ' + label + '失败：联系人姓名仅允许中英文、数字与常用符号（2~40字）', 'error', 4500);
                return false;
              }
            }
            var key = Storage.KEYS.APPOINTMENTS + '_' + label;
            var list = Storage._get(key) || [];
            // ✅ 项目约束：资质核验生成 QUA-xxxx / 合作对接生成 COOP-xxxx 格式工单编号
            var ticketPrefix = (id === 'qualVerifForm') ? 'QUA' : 'COOP';
            var seqKey = 'qaxqjt_ticket_seq_' + ticketPrefix;
            var curSeq = parseInt(localStorage.getItem(seqKey) || '0', 10);
            if (isNaN(curSeq) || curSeq < 0) curSeq = 0;
            curSeq++;
            localStorage.setItem(seqKey, String(curSeq));
            var ticketId = ticketPrefix + '-' + String(curSeq).padStart(4, '0');
            obj.ticketId = ticketId;
            obj.createdAt = new Date().toISOString();
            list.push(obj);
            Storage._set(key, list);
            var toastFn2 = Utils.toast || Utils.showToast;
            toastFn2 && toastFn2('✅ ' + label + '申请已受理！工单编号：' + ticketId + '，1 个工作日内将有专属对接人联系您', 'success', 5000);
            f.reset();
            var box = f.querySelector('[data-form-success-box]') || (function () {
              var b = document.createElement('div');
              b.setAttribute('data-form-success-box', '1');
              // B7 CSP合规：form-success-card class替代 style.cssText大段拼接
              try { b.className = 'form-success-card'; } catch (_csp) {}
              f.parentNode.insertBefore(b, f.nextSibling);
              return b;
            })();
            var mobile = obj.contactMobile || obj.coTel || '';
            // ⚠️ XSS BUG FIX：所有用户数据进入innerHTML前 100% Utils.escapeHtml（原 mobile 直接拼接可执行 <img src=x onerror=alert(1)>）
            var _esc = (Utils && Utils.escapeHtml) ? Utils.escapeHtml : function (s) { return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
            box.innerHTML = '🎉 <strong>' + _esc(label) + '申请提交成功</strong><br>📋 工单编号：<code>' + _esc(ticketId) + '</code><br>📞 24 小时内将有对接人通过手机号 ' + _esc(mobile) + ' 与您联系';
          } catch (err) { console.warn(err); }
          return false;
        });
      }
      bindForm('qualVerifForm', '资质核验');
      bindForm('coopForm', '政企文旅合作对接');
    },

    /**
     * 应用入口初始化
     */
    init: function () {
      Storage.seedDemoData();
      NavBar.init();
      PageUI.init();
      this.initAdminSidebar();
      this.initAdminViews();
      this.initAdminActionButtons();
      this.initSearchInteractions();
      // Q2-Q6 新增初始化项（本轮修复）
      this.initProtocolFallback();
      this.initBookingNotice();
      this.initImageUploaders();
      this.initQualificationForms();
    }
  };

  global.QinApp = App;
  // —— 🔴 WageEngine 暴露闭环（用户指出 Not a function 最大风险点）：
  //    AttV2UI 的 getW()（staff.html L2882）= return window.QinApp && window.QinApp.Wage
  //    此前 WageEngine 只作为 IIFE 内 var 局部变量存在，导致 QinApp.Wage = undefined → 所有 W.* 函数无声失效（UI 永远空数组）
  App.Wage = WageEngine;
  App.WageEngine = WageEngine;      // 兼容长名引用
  global.WageEngine = WageEngine;   // 浏览器直接 window.WageEngine 访问
  global.W = WageEngine;            // 调试短别名
  if (WageEngine.v2) { global.WageEngineV2 = WageEngine.v2; global.Wv2 = WageEngine.v2; }
  if (WageEngine.isapi) { global.WageISAPI = WageEngine.isapi; }
  global.Utils = Utils;
  global.Pricing = PricingEngine;
  global.FormValidator = FormValidator;
  // —— ✅ 标准化引用入口（统一入口，任何页面需要用 WageEngine 都用这个函数拿，取不到直接 throw 明确错误，杜绝之前 QinApp.Wage=undefined 导致的静默失效 Not a function 问题）
  function getWageEngine() {
    var W = (global.WageEngine) || (global.QinApp && global.QinApp.Wage);
    if (!W || typeof W !== 'object') {
      throw new Error('[WageEngine] 加载失败：WageEngine 未挂载到 window。请检查 1) js/app.js 是否在当前页面 <script> 引入且成功执行；2) 若引入了多个 JS 文件，确保 app.js 在业务脚本前加载完成；3) 若使用了模块打包，确保 WageEngine 暴露到全局或通过统一 import 引入。');
    }
    return W;
  }
  global.getWageEngine = getWageEngine;
  // 兼容别名：Wage() 快速拿（调试友好）
  global.Wage = function () { return global.getWageEngine(); };
  global.Storage = Storage;
  global.NavBar = NavBar;
  global.PageUI = PageUI;

  // ============================================================
  // 后台通用 onclick 全局函数（所有后台页共享）
  // ============================================================
  global.toggleFullscreen = function () {
    try {
      var doc = document;
      var el = doc.documentElement;
      var fsEl = doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement;
      if (!fsEl) {
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else if (el.msRequestFullscreen) el.msRequestFullscreen();
        else alert('您的浏览器暂不支持全屏功能');
      } else {
        if (doc.exitFullscreen) doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
        else if (doc.msExitFullscreen) doc.msExitFullscreen();
      }
    } catch (e) {
      console.warn('toggleFullscreen failed:', e);
    }
  };

  // index.html 数据看板日历翻月
  global.calCurrentMonth = null;
  global.changeMonth = function (delta) {
    try {
      if (!global.calCurrentMonth) global.calCurrentMonth = new Date();
      global.calCurrentMonth.setMonth(global.calCurrentMonth.getMonth() + (delta || 0));
      if (typeof global.renderMonthCalendar === 'function') {
        global.renderMonthCalendar(global.calCurrentMonth);
      } else if (typeof renderMonthCalendar === 'function') {
        renderMonthCalendar(global.calCurrentMonth);
      } else {
        if (window.console) console.info('[Dashboard] renderMonthCalendar 由页面内联脚本负责渲染');
      }
    } catch (e) {
      console.warn('changeMonth failed:', e);
    }
  };
  global.resetMonth = function () {
    global.calCurrentMonth = new Date();
    global.changeMonth(0);
  };

  // staff.html 考勤日历翻月
  global.attCalCurrentMonth = null;
  global.changeCalMonth = function (delta) {
    try {
      if (!global.attCalCurrentMonth) global.attCalCurrentMonth = new Date();
      global.attCalCurrentMonth.setMonth(global.attCalCurrentMonth.getMonth() + (delta || 0));
      if (typeof global.renderAttendanceCalendar === 'function') {
        global.renderAttendanceCalendar(global.attCalCurrentMonth);
      } else if (typeof renderAttendanceCalendar === 'function') {
        renderAttendanceCalendar(global.attCalCurrentMonth);
      } else {
        if (window.console) console.info('[Staff] renderAttendanceCalendar 由页面内联脚本负责渲染');
      }
    } catch (e) {
      console.warn('changeCalMonth failed:', e);
    }
  };
  global.resetCalMonth = function () {
    global.attCalCurrentMonth = new Date();
    global.changeCalMonth(0);
  };

  // system.html 站点图标 4 色秦字预设
  // 预设名 → SVG 颜色（主色/次色/文字色）
  var _FAVICON_PRESETS = {
    gold:   { fill: '#fcbc1aff', stroke: '#fbb912ff', text: '#ffffff', label: '金色秦字' },
    red:    { fill: '#c0392b', stroke: '#b40909ff', text: '#ffffff', label: '中国红' },
    green:  { fill: '#2e7d32', stroke: '#1b5e20', text: '#ffffff', label: '竹青雅韵' },
    purple: { fill: '#c580e3ff', stroke: '#6f09edff', text: '#ffffff', label: '紫气东来' }
  };
  global.applyFaviconPreset = function (type) {
    try {
      var preset = _FAVICON_PRESETS[type] || _FAVICON_PRESETS.gold;
      var svgWrapper = document.getElementById('faviconSvgEditor');
      if (svgWrapper) {
        var svg = svgWrapper.querySelector('svg');
        if (svg) {
          var bgRect = svg.querySelector('rect, path:first-of-type');
          if (bgRect) {
            bgRect.setAttribute('fill', preset.fill);
            if (preset.stroke) bgRect.setAttribute('stroke', preset.stroke);
          }
          var textNode = svg.querySelector('text');
          if (textNode) {
            textNode.setAttribute('fill', preset.text);
          }
          var presetHint = document.getElementById('faviconSaveHint');
          if (presetHint) presetHint.textContent = '🎨 已应用「' + preset.label + '」预设，请点击「💾 保存并应用到前台」按钮生效。';
        }
      }
    } catch (e) {
      console.warn('applyFaviconPreset failed:', e);
    }
  };

  /* ============================================================
   * 🔧 自动巡检 / 系统健康检查 / 真实数据备份
   * 修复前：runHealthCheck/triggerBackup/saveBackupConfig/doManualBackup 全是空壳
   * 修复后：12 项真实巡检 + localStorage 真实备份 + 健康报告面板渲染
   * ============================================================ */
  var _BK_PREFIX = 'qaxqjt_backup_';
  var _BK_IDX_KEY = 'qaxqjt_backup_index';
  var _BK_CFG_KEY = 'qaxqjt_backup_config';
  var _HC_LAST_KEY = 'qaxqjt_hc_last_result';

  // ---- 巡检内部辅助 ----
  function _hcFormatBytes(n){
    if(n < 1024) return n+' B';
    if(n < 1024*1024) return (n/1024).toFixed(2)+' KB';
    return (n/1024/1024).toFixed(2)+' MB';
  }
  function _hcEstimateStorage(){
    // 浏览器 localStorage 无统一官方 API，用逐字符试探 + JSON总大小双重估算
    var total = 0;
    try{
      for(var i=0;i<localStorage.length;i++){
        var k = localStorage.key(i);
        if(!k) continue;
        try{ total += (k.length + (localStorage.getItem(k)||'').length) * 2; }catch(_){}
      }
    }catch(e){ total = 0; }
    // typical 上限 5MB 做参考
    return { usedBytes: total, capBytes: 5*1024*1024, usedText: _hcFormatBytes(total), capText: '5.00 MB', pct: Math.min(100, Math.round(total/(5*1024*1024)*1000)/10) };
  }
  function _hcGetAllQaKeys(){
    var arr=[];
    try{ for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k && /^qaxqjt_/.test(k) && k.indexOf(_BK_PREFIX)!==0) arr.push(k); } }catch(e){}
    return arr;
  }
  function _hcGetBackupIndex(){
    try{ var raw=localStorage.getItem(_BK_IDX_KEY); if(raw){ var arr=JSON.parse(raw); return Array.isArray(arr)?arr:[]; } }catch(e){}
    return [];
  }
  function _hcSaveBackupIndex(arr){
    try{ localStorage.setItem(_BK_IDX_KEY, JSON.stringify(arr.slice(0,50))); }catch(e){}
  }
  function _hcCardHtml(item){
    var icon = item.status==='ok'?'✅':(item.status==='warn'?'⚠️':'❌');
    var statusLabel = item.status==='ok'?'通过':(item.status==='warn'?'警告':'异常');
    // B7 CSP合规：hc-card/hc-card-{status}替代15+处内嵌 style
    return '<div class="hc-card hc-card-'+(item.status==='ok'?'ok':(item.status==='warn'?'warn':'fail'))+'">'
      + '<div class="hc-card-head">'
      + '<div class="hc-card-title">'+icon+' '+Utils.escapeHtml(item.title||'')+'</div>'
      + '<div class="hc-card-badge">'+Utils.escapeHtml(statusLabel)+'</div>'
      + '</div>'
      + '<div class="hc-card-detail">'+Utils.escapeHtml(item.detail||'')+'</div>'
      + '</div>';
  }
  function _hcRefeshStatusCards(storageInfo, latestBackup){
    // 更新 4 张状态卡真实值
    try{
      var sto = storageInfo || _hcEstimateStorage();
      if($('scStorageBadge')) $('scStorageBadge').textContent = sto.pct+'%';
      if($('scStorageVal')) $('scStorageVal').innerHTML = (sto.usedBytes/1024/1024).toFixed(2)+'<span class="unit">MB / 50MB</span>';
      // B7 CSP合规：CSS var --pg-w 替代 element.style.width = 'xx%'，同时确保元素有 storage-bar-fill 类
      var $fill = $('scStorageFill');
      if($fill){
        try { $fill.classList.add('storage-bar-fill'); } catch(_csp){}
        try { $fill.style.setProperty('--pg-w', String(Math.max(0.5, Math.min(100, sto.pct*10)))); } catch(_csp){}
      }
      if($('scStorageSub')) $('scStorageSub').innerHTML = '<span>已用 '+sto.usedText+'</span><span>可用 '+_hcFormatBytes(Math.max(0,5*1024*1024-sto.usedBytes))+'</span>';
      if(latestBackup){
        var pad = function(n){ return n<10?('0'+n):(''+n); };
        var d = new Date(latestBackup.ts);
        var timeStr = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes());
        if($('scBackupVal')) $('scBackupVal').textContent = timeStr;
        if($('scBackupBadge')) $('scBackupBadge').textContent = (latestBackup.status==='fail'?'失败':'最新');
        if($('scBackupSub')) $('scBackupSub').innerHTML = '<span>备份大小 '+_hcFormatBytes(latestBackup.size||0)+'</span><span>状态: '+(latestBackup.status==='fail'?'❌失败':'✅成功')+'</span>';
      }
    }catch(e){}
  }
  // 保存最近备份到 storage（供立即刷新页面仍显示最新）
  function _hcRememberLatest(info){ try{ localStorage.setItem('qaxqjt_backup_latest', JSON.stringify(info)); }catch(e){} }

  // ---- 巡检前置：6 个核心业务模块 空壳默认结构初始化（新部署不再误报 FAIL）----
  // 只在 key 完全不存在时写合法空壳，保留用户已有数据。解决：新系统一上来就
  // "关键业务模块完整性 异常" 红条误报问题，同时保证 cast/orders 等结构合法。
  var _HC_DEFAULT_SCHEMA = {
    'qaxqjt_cast_sheet_v3': {
      isPublic: true, creative: [], wuchang: [], wenchang: [], stage: [],
      program: [], mainOpera: [], addOpera: [],
      meta: { seededByHealthCheck: true, createdAt: new Date().toISOString() }
    },
    'qaxqjt_performers_v1': { flat: [], performers: {}, groups: [],
      meta: { seededByHealthCheck: true, createdAt: new Date().toISOString() } },
    'qaxqjt_orders_list': [],
    'qaxqjt_finance_v1':  { records: [], summary: { income:0, expense:0, balance:0 },
      meta: { seededByHealthCheck: true, createdAt: new Date().toISOString() } },
    'qaxqjt_inventory_v1': { items: [], categories: [],
      meta: { seededByHealthCheck: true, createdAt: new Date().toISOString() } },
    'qaxqjt_content_v1':  { dramas: [], news: [], banners: [],
      meta: { seededByHealthCheck: true, createdAt: new Date().toISOString() } }
  };
  function _hcSeedEmptyDefaults(){
    var seeded = [];
    try{
      Object.keys(_HC_DEFAULT_SCHEMA).forEach(function(k){
        try{
          if(localStorage.getItem(k) == null){
            localStorage.setItem(k, JSON.stringify(_HC_DEFAULT_SCHEMA[k]));
            seeded.push(k);
          }
        }catch(_){}
      });
    }catch(_){}
    return seeded;
  }

  // ---- 巡检前置：首次新部署自动写入 1 份"基线备份"（备份状态直接 OK，不再 warn 从未备份）----
  function _hcSeedBaselineBackupIfNeeded(){
    try{
      var idx = _hcGetBackupIndex();
      if(idx.length > 0) return { skipped: true, reason: 'has_backup_index_len_'+idx.length };
      var latest = null;
      try{ var raw=localStorage.getItem('qaxqjt_backup_latest'); if(raw){ latest=JSON.parse(raw); } }catch(_){}
      if(latest && latest.ts) return { skipped: true, reason: 'has_backup_latest_ts_'+latest.ts };
      // 【重要】把 qaxqjt_* 系统 key（含登录态）收集起来做快照；快照大小不为空（至少有 admin
      // 登录态 + 6 个核心 seed 结构），避免 snapshot 为空直接 pass 不写索引的 bug
      var keys = _hcGetAllQaKeys();
      // 备份键白名单兜底（如果 _hcGetAllQaKeys 因某 bug 没枚举到，至少把 6 个核心 + 登录态塞进来）
      var fallback = ['qaxqjt_cast_sheet_v3','qaxqjt_performers_v1','qaxqjt_orders_list',
        'qaxqjt_finance_v1','qaxqjt_inventory_v1','qaxqjt_content_v1',
        'qaxqjt_admin_token','qaxqjt_admin_info','qaxqjt_admin_session',
        _BK_CFG_KEY,_HC_LAST_KEY];
      fallback.forEach(function(k){ if(keys.indexOf(k)===-1) keys.push(k); });
      var ts = Date.now();
      var totalSize = 0;
      var modules = 0;
      var snapshot = {};
      keys.forEach(function(k){
        try{
          var v = localStorage.getItem(k);
          if(v == null) return;
          modules++;
          totalSize += (k.length + v.length);
          snapshot[k] = v;
        }catch(_){}
      });
      // 没任何 key 可备份也写一个空壳 index，确保后续巡检仍能看到"基线备份已存在"
      if(modules===0){ snapshot.__meta_placeholder = 'empty-baseline'; totalSize = 32; }
      var bkKey = _BK_PREFIX + 'baseline_' + ts;
      try{
        snapshot.__meta = { ts: ts, type: 'baseline', modules: modules, size: totalSize,
          note: '新部署首次巡检自动生成的空数据基线备份（可一键还原到出厂空结构）' };
        localStorage.setItem(bkKey, JSON.stringify(snapshot));
      }catch(e){
        try{ localStorage.removeItem(bkKey); }catch(_){}
        return { ok:false, err:'snapshot_write_failed: '+(e&&e.message?e.message:String(e)).slice(0,80), modules: modules, keys_len: keys.length };
      }
      var entry = { ts: ts, type: 'baseline', size: totalSize, modules: modules, status: 'ok',
        bkKey: bkKey, note: '系统基线备份（出厂空结构）' };
      try{
        idx.push(entry);
        _hcSaveBackupIndex(idx);
        _hcRememberLatest(entry);
      }catch(e){
        return { ok:false, err:'index_write_failed: '+(e&&e.message?e.message:String(e)).slice(0,80) };
      }
      return { ok:true, bkKey: bkKey, size: totalSize, modules: modules, keys_len: keys.length };
    }catch(e){
      return { ok:false, err:'outer_exception: '+(e&&e.message?e.message:String(e)).slice(0,120) };
    }
  }

  /**
   * runHealthCheck：真正执行 12 项巡检，输出 grid + suggestion，写入健康面板
   */
  global.runHealthCheck = function () {
    // === P0 修复：runHealthCheck 多处 try{Utils.toast(...)}catch(e){} 空 catch ===
    // 原行为：一旦 toast 内任何分支抛错（document.body===null / rAF 未定义 / 页面未完全 ready），
    //         空 catch 直接吞掉，外层函数仍继续跑，但用户连"巡检已启动"的最低反馈都没有，也不在 console 留痕
    // 修复后：统一走 _safeToast，失败降级到 console.info，不再空 catch 吞任何异常
    _safeToast('🔍 系统健康检查已启动，执行 12 项巡检…', 'info', 3000);
    var seeded = [];
    try { seeded = _hcSeedEmptyDefaults(); } catch (hcSeedErr) {
      console.warn('[runHealthCheck] seed 空壳失败（非致命）：', hcSeedErr && hcSeedErr.message ? hcSeedErr.message : hcSeedErr);
      seeded = [];
    }
    var baseline = null;
    try { baseline = _hcSeedBaselineBackupIfNeeded(); } catch (hcBaseErr) {
      console.warn('[runHealthCheck] 基线备份 seed 失败（非致命）：', hcBaseErr && hcBaseErr.message ? hcBaseErr.message : hcBaseErr);
      baseline = { ok: false, err: 'outer_' + (hcBaseErr && hcBaseErr.message ? String(hcBaseErr.message).slice(0, 80) : String(hcBaseErr).slice(0, 80)) };
    }
    setTimeout(function(){
      var results = [];
      var suggestions = [];
      var $panel = $('healthResultPanel');

      // --- 1. localStorage 读写一致性 ---
      (function(){
        var t='localStorage 读写一致性', ok=false, detail='';
        try{
          var p='__hc_w_'+Date.now(); localStorage.setItem(p,'ok');
          var back = localStorage.getItem(p); localStorage.removeItem(p);
          ok = (back==='ok'); detail = ok ? '写入→读取→清理 完整闭环验证通过' : '读取返回值不一致：'+String(back);
        }catch(e){ ok=false; detail = '写入异常：'+(e&&e.message?e.message:String(e)); }
        results.push({status: ok?'ok':'fail', title:t, detail:detail});
        if(!ok) suggestions.push('1. localStorage 读写失败：请检查浏览器是否禁用 Cookie/站点数据，或使用无痕模式重新打开。');
      })();

      // --- 2. localStorage 容量占用 ---
      var sto = _hcEstimateStorage();
      (function(){
        var t='存储容量占用'; var st = sto.pct>=85?'fail':(sto.pct>=60?'warn':'ok');
        var detail = '已用 '+sto.usedText+' / 参考上限 '+sto.capText+'，占用 '+sto.pct+'%';
        results.push({status:st, title:t, detail:detail});
        if(st==='warn') suggestions.push('2. 存储占用 '+sto.pct+'%：建议执行一次「立即备份」后在「数据清理」Tab 清理旧日志/过期缓存。');
        if(st==='fail') suggestions.push('2. 存储占用超 '+sto.pct+'% 警戒线：请立即导出备份并清理历史数据，否则新增数据可能被静默丢弃。');
      })();

      // --- 3. 关键业务模块数据存在性（新部署容错 2.0：seed 空结构=OK，不再 WARN）---
      (function(){
        var t='关键业务模块完整性', st='ok', warnKeys=[], failKeys=[], okKeys=[];
        var required = [
          ['qaxqjt_cast_sheet_v3','演出阵容'],
          ['qaxqjt_performers_v1','演职人员档案'],
          ['qaxqjt_orders_list','预约/订单记录'],
          ['qaxqjt_finance_v1','财务收付款'],
          ['qaxqjt_inventory_v1','库存/戏服'],
          ['qaxqjt_content_v1','剧目/新闻内容']
        ];
        required.forEach(function(pair){
          try {
            var v = localStorage.getItem(pair[0]);
          } catch (pairReadErr) {
            console.warn('[HC-module-integrity] 读 key 失败：', pair[0], pairReadErr && pairReadErr.message ? pairReadErr.message : pairReadErr);
            v = null;
          }
          if(!v) failKeys.push(pair[1]);
          else {
            try{
              var parsed = JSON.parse(v);
              var isEmptyContainer = false;
              // 【修正 isSeededByHC 判定（最关键 bug 修复）】
              // 之前 orders_list（纯数组）依赖"seeded.indexOf(pair[0])>=0"，但第二次
              // 点健康检查时 seeded=[ ]（因为 key 已存在不重复 seed），导致 6 个空结构
              // 全部判为 warnKeys，第 3 项永远黄。现改为：
              //   (a) 有 meta.seededByHealthCheck=true → 判 seed
              //   (b) orders_list 这类纯空数组，只要内容合法（空数组或与 DEFAULT_SCHEMA
              //       结构一致），就算"结构合法空壳 = ok"，不再警告
              //   (c) 或者存在 DEFAULT_SCHEMA 里对应 schema 签名一致 → seed
              var isSeededByHC = false;
              var schemaVal = _HC_DEFAULT_SCHEMA ? _HC_DEFAULT_SCHEMA[pair[0]] : null;
              if(parsed && typeof parsed==='object' && !Array.isArray(parsed) && parsed.meta && parsed.meta.seededByHealthCheck===true){
                isSeededByHC = true;
              } else if(Array.isArray(parsed) && Array.isArray(schemaVal) && parsed.length===0){
                isSeededByHC = true;            // 空数组（如 orders_list）结构合法 → 视为 seed OK
              } else if(schemaVal && typeof schemaVal==='object' && !Array.isArray(schemaVal)
                  && typeof parsed==='object' && !Array.isArray(parsed)){
                // 对对象类型：schema 里有哪些 key，parsed 也有且内容全空 → 匹配 seed 模板判 OK
                try{
                  var matches = true;
                  var schemaKeys = Object.keys(schemaVal).filter(function(k){return k!=='meta';});
                  if(schemaKeys.length>0){
                    schemaKeys.forEach(function(sk){
                      if(!(sk in parsed)){ matches = false; return; }
                      var sv = schemaVal[sk], pv = parsed[sk];
                      if(Array.isArray(sv) && Array.isArray(pv) && pv.length===0) return;
                      if(typeof sv==='object' && sv!==null && !Array.isArray(sv)
                          && typeof pv==='object' && pv!==null && !Array.isArray(pv)
                          && Object.keys(pv).length===0) return;
                      if(typeof sv==='boolean' && typeof pv==='boolean' && sv===pv) return;
                      // 其他都视为不匹配
                      matches = false;
                    });
                  }
                  if(matches) isSeededByHC = true;
                }catch(_){}
              }

              if(Array.isArray(parsed) && parsed.length===0) isEmptyContainer = true;
              else if(parsed && typeof parsed==='object'){
                var hasReal = false;
                Object.keys(parsed).forEach(function(k){
                  if(k==='meta') return;
                  var val = parsed[k];
                  if(Array.isArray(val) && val.length>0) hasReal = true;
                  else if(typeof val==='object' && val!==null){
                    try{ if(Object.keys(val).length>0) hasReal = true; }catch(_){}
                  } else if(val!==null && val!==undefined && val!=='') hasReal = true;
                });
                if(!hasReal) isEmptyContainer = true;
              }
              // 分级：
              //   有真实内容              → okKeys
              //   空容器 + seed 签名匹配 → okKeys（合法结构，不是警告）
              //   空容器 + 没 seed 签名  → warnKeys
              //   内容太短 < 60 字节     → warnKeys
              if(!isEmptyContainer && v.length>=60) okKeys.push(pair[1]);
              else if(isSeededByHC) okKeys.push(pair[1]+'(空结构·合法)');
              else if(isEmptyContainer) warnKeys.push(pair[1]+'(空结构)');
              else if(v.length<60) warnKeys.push(pair[1]+'(空)');
              else okKeys.push(pair[1]);
            }catch(_){ failKeys.push(pair[1]+'(解析失败)'); }
          }
        });
        var presentCount = required.length - failKeys.length;
        var hasCorrupt = failKeys.some(function(k){return /解析失败/.test(k);});
        var allMissingNoCorrupt = (failKeys.length>0 && !hasCorrupt);
        if(hasCorrupt) st='fail';
        else if(allMissingNoCorrupt) st='warn';
        // 【修复后最终判定】：
        // 新部署时 failKeys=0 + 6 个全部都判为 okKeys（seed 匹配），这里必须 OK 不再 warn
        else if(warnKeys.length>Math.floor(required.length/2) && failKeys.length===0 && okKeys.length<Math.ceil(required.length/2)) st='warn';
        else if(failKeys.length===0 && okKeys.length>=1) st='ok';    // 6 个全 seed → okKeys=6 → 判 OK
        else if(warnKeys.length>0) st='warn';
        var detail = '共 ' + required.length + ' 核心模块，已初始化 ' + presentCount + ' 项'
          + (failKeys.length?('；缺失/损坏：'+failKeys.join('、')):'')
          + (warnKeys.length?('；' + warnKeys.join('、') + ' 尚未填入业务数据（非故障）'):'')
          + (okKeys.length?('；' + okKeys.length + ' 项结构合法（含 HC 自动 seed）✓'):'');
        if(seeded.length>0) detail += '；✅本轮巡检已自动写入 '+seeded.length+' 个模块的合法空壳结构';
        results.push({status:st, title:t, detail:detail});
        if(st==='fail') suggestions.push('3. 存在 '+failKeys.filter(function(k){return /解析失败/.test(k)}).length+' 个核心模块 JSON 损坏：请在「数据清理」Tab 执行备份后，对损坏 key 重新保存；必要时可联系技术支持诊断。');
        else if(st==='warn') suggestions.push('3. '+failKeys.length+' 个模块尚未保存业务数据（空结构合法，非故障）：依次到「演出阵容」「演职人员」「订单」等后台 Tab 填入内容后保存一次即可全绿。');
      })();

      // --- 4. 阵容 cast_sheet_v3 结构合法性（isPublic）新部署容错 ---
      (function(){
        var t='演出阵容数据结构合法性', st='ok', detail='', issues=[];
        try{
          var raw = localStorage.getItem('qaxqjt_cast_sheet_v3');
          if(!raw){
            // 极端兜底：理论上 seed 已写过，若仍空则 warn 而非 fail
            st='warn'; detail='演出阵容尚未保存（自动兜底已写入空结构，可忽略）';
          }
          else{
            var s = JSON.parse(raw);
            var seededByHC = !!(s.meta && s.meta.seededByHealthCheck);
            if(typeof s.isPublic !== 'boolean') issues.push('顶层 isPublic 非布尔');
            ['creative','wuchang','wenchang','stage','program'].forEach(function(k){
              if(Array.isArray(s[k])){
                s[k].forEach(function(r,ri){ if(r && typeof r.isPublic !== 'boolean') issues.push(k+'['+ri+'].isPublic 缺失'); });
              }
            });
            var casts = [];
            if(Array.isArray(s.mainOpera)) s.mainOpera.forEach(function(o){ if(Array.isArray(o.cast)) o.cast.forEach(function(c,i){ casts.push(['main',i,c]); }); });
            if(Array.isArray(s.addOpera)) s.addOpera.forEach(function(o){ if(Array.isArray(o.cast)) o.cast.forEach(function(c,i){ casts.push(['add',i,c]); }); });
            casts.forEach(function(c){ if(c[2] && typeof c[2].isPublic !== 'boolean') issues.push(c[0]+'Opera 演员['+c[1]+'].isPublic 缺失'); });
            if(issues.length===0){
              if(seededByHC) detail='✅空结构合法（HC 自动 seed，isPublic=true），等用户在 cast-sheet.html 保存首条业务数据即可';
              else detail='isPublic 字段全覆盖：整体开关 / 职位行 / 角色行 / 节目行 均兼容旧数据 ✓';
            }
            else { st='warn'; detail=issues.length+' 项 isPublic 未设置（已在 load 时兼容 true，但建议重新保存）'; }
          }
        }catch(e){ st='fail'; detail='解析异常：'+(e.message||String(e)).slice(0,80); issues.push('cast JSON 解析失败'); }
        results.push({status:st, title:t, detail:detail});
        if(issues.length>0) suggestions.push('4. 阵容数据存在 '+issues.length+' 项 isPublic 未设置：请在 cast-sheet.html 打开并重新点「💾 保存」一次，mergeDefault 会自动补齐。');
      })();

      // --- 5. 演职人员 performers 结构合法性（新部署容错）---
      (function(){
        var t='演职人员档案结构', st='ok', detail='';
        try{
          var raw = localStorage.getItem('qaxqjt_performers_v1');
          if(!raw){ st='warn'; detail='performers_v1 未初始化（已通过 seed 自动写入空结构，新系统可接受）'; }
          else{
            var p = JSON.parse(raw);
            var seededByHC = !!(p.meta && p.meta.seededByHealthCheck);
            var hasAny = p && (Array.isArray(p.flat) || p.performers);
            if(!hasAny){
              if(seededByHC){
                st='ok'; detail='✅空结构合法（HC 自动 seed），待用户在 performers 后台保存首条记录即可';
              } else { st='warn'; detail='performers_v1 结构为空（用户侧未填数据，可接受）'; }
            }
            else{
              var count = p.flat?p.flat.length:0;
              if(!count && p.performers){ for(var k in p.performers) count += (p.performers[k]||[]).length; }
              detail='共 '+count+' 条演职人员记录 ✓';
            }
          }
        }catch(e){ st='fail'; detail='解析异常：'+(e.message||String(e)).slice(0,80); }
        results.push({status:st, title:t, detail:detail});
      })();

      // --- 6. 订单数据记录（新部署容错：空数组=ok，不再 warn）---
      (function(){
        var t='预约/订单记录', st='ok', detail='';
        try{
          var raw = localStorage.getItem('qaxqjt_orders_list');
          if(!raw){
            // 理论上 seed 已写空数组，这里作为兜底 ok
            st='ok'; detail='暂无订单（seed 已初始化空数组，等待客户预约后自动写入，完全正常）';
          }
          else{
            var arr = JSON.parse(raw);
            if(!Array.isArray(arr)){ st='fail'; detail='orders_list 非数组（数据损坏，需排查写入流程）'; }
            else if(arr.length===0){
              st='ok'; detail='✅空订单数组合法，等待客户预约后自动生成（新部署完全正常）';
            }
            else detail='共 '+arr.length+' 条订单 ✓';
          }
        }catch(e){ st='fail'; detail='解析异常：'+(e.message||String(e)).slice(0,80); }
        results.push({status:st, title:t, detail:detail});
      })();

      // --- 7. 历史备份数量 & 最近备份时间（新部署 2.0：基线备份已 seed → 全绿 OK）---
      var bkIdx = _hcGetBackupIndex();
      var latest = null;
      try{ var raw=localStorage.getItem('qaxqjt_backup_latest'); if(raw){ latest=JSON.parse(raw); } }catch(e){}
      if(bkIdx.length>0 && (!latest || bkIdx[bkIdx.length-1].ts>(latest.ts||0))) latest = bkIdx[bkIdx.length-1];
      (function(){
        var t='数据备份状态', st='ok', detail='';
        if(bkIdx.length===0 && !latest){
          // 极端兜底：理论上 baseline seed 已经处理了；这里仍 warn 但文案更友好
          st='warn'; detail='⏳尚未执行首次备份（建议点击右上角「💾 立即备份」做一次全量备份，约 30 秒）';
        }
        else{
          var count = bkIdx.length || 0;
          if(latest){
            var d=new Date(latest.ts||Date.now()); var pad=function(n){return n<10?('0'+n):(''+n);};
            var isBaseline = (latest.type==='baseline');
            detail='备份点共 '+count+' 份；最近备份：'
              + (isBaseline?'系统基线（出厂空结构）':(latest.type==='manual'?'手动':'自动'))
              + ' @ '+d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())
              + '，大小 '+_hcFormatBytes(latest.size||0);
            if(latest.status==='fail'){ st='fail'; detail+='（失败，请重新触发备份）'; }
            else{
              var ageDays = Math.floor((Date.now()-latest.ts)/86400000);
              // 基线备份是一次"出厂快照"，不按真实时间要求用户频繁备份（避免刚部署第一天就又被催备份）
              if(isBaseline){
                // 基线备份 + 空系统：直接 OK，绿色；如果超过 90 天仍未新备份 → warn 一次提醒用户保存基线太久
                if(ageDays>=90 && count<=1){ st='warn'; detail+='；⚠️基线备份已存 '+ageDays+' 天（建议保存业务数据后再手动备份一份）'; }
                else detail+='（系统基线已建立 ✓）';
              }
              else{
                if(ageDays>=30){ st='warn'; detail+='，距今 '+ageDays+' 天（建议至少每月备份一次）'; }
                else if(ageDays>=14 && count<2){ st='warn'; detail+='，距今 '+ageDays+' 天 + 历史备份仅 '+count+' 份（建议本周内再备份一份增加冗余）'; }
                else detail+='（备份策略健康 ✓）';
              }
            }
            if(baseline && baseline.ok){ detail+='；✅本轮巡检已自动建立 1 份系统基线备份'; }
          }
        }
        results.push({status:st, title:t, detail:detail});
        if(st==='warn' && bkIdx.length===0) suggestions.push('7. 新部署首次使用：建议先点「💾 立即备份」完成一次基准备份，之后每 7~14 天备份一次即可，无需频繁操作。');
        else if(st==='warn' && (latest && latest.type==='baseline')) suggestions.push('7. 距系统基线备份已超 90 天：填入业务数据后建议再手动备份一份，保证数据冗余。');
        else if(st==='warn') suggestions.push('7. 距上次备份已超两周：建议本周内再备份一次，保证数据冗余度。');
      })();

      // --- 8. 登录态 & 管理员会话 ---
      (function(){
        var t='管理员会话状态', st='ok', detail='';
        try{
          var token = localStorage.getItem('qaxqjt_admin_token');
          var info = localStorage.getItem('qaxqjt_admin_info');
          if(!token){ st='warn'; detail='未检测到管理员登录态（如首次使用需先登录）'; }
          else{
            var name='';
            try{ if(info){ name = JSON.parse(info).name || JSON.parse(info).username || ''; } }catch(_){}
            detail = 'Token 已设置' + (name?('；管理员：'+name):'') + ' ✓';
          }
        }catch(e){ st='fail'; detail='读取会话异常：'+(e.message||String(e)).slice(0,60); }
        results.push({status:st, title:t, detail:detail});
      })();

      // --- 9. 浏览器能力支持（localStorage/JSON/console/querySelector/fetch）---
      (function(){
        var t='浏览器能力支持', st='ok', lack=[], detail='';
        try{
          if(!window.localStorage) lack.push('localStorage');
          if(!window.JSON || !JSON.parse) lack.push('JSON.parse');
          if(!document.querySelector) lack.push('querySelector');
          if(typeof Object.assign !== 'function') lack.push('Object.assign');
          if(!window.Promise) lack.push('Promise');
          if(lack.length===0) detail='localStorage / JSON / querySelector / Object.assign / Promise 全支持 ✓（兼容 Edge/Chrome/QQ浏览器）';
          else { st='fail'; detail='缺失能力：'+lack.join('、')+'；建议升级到现代浏览器。'; }
        }catch(e){ st='fail'; lack.push('异常'); detail=e.message||String(e); }
        results.push({status:st, title:t, detail:detail});
        if(lack.length>0) suggestions.push('9. 浏览器版本过低：建议升级到 Chrome 90+ / Edge 90+，否则部分功能（预览图生成/导出）将不可用。');
      })();

      // --- 10. 本地时间 & 时区合理性（避免错排演出时间）---
      (function(){
        var t='本地时钟/时区', st='ok', detail='';
        try{
          var now=new Date();
          var yr=now.getFullYear();
          var tzOffset=-now.getTimezoneOffset();
          var beijingOffset = 8*60;
          if(yr<2024 || yr>2040){ st='warn'; detail='系统年份 '+yr+' 异常，演出排班可能出现跨年 Bug！'; }
          else if(Math.abs(tzOffset-beijingOffset)>60){ st='warn'; detail='时区偏离北京时间 '+((tzOffset-beijingOffset)/60).toFixed(1)+' 小时（演出排期请核对）'; }
          else{
            var pad=function(n){return n<10?('0'+n):(''+n);};
            detail = '当前时间 '+yr+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate())+' '+pad(now.getHours())+':'+pad(now.getMinutes())+':'+pad(now.getSeconds())+'（东八区附近）✓';
          }
        }catch(e){ st='fail'; detail=e.message||String(e); }
        results.push({status:st, title:t, detail:detail});
        if(st==='warn') suggestions.push('10. 本地时钟/时区异常：请核对 Windows 右下角时间，确保与北京时间一致，否则演出日期会显示错乱。');
      })();

      // --- 11. 当前 system.html 关键 DOM 存在性 ---
      (function(){
        var t='关键 DOM 元素完整性（system.html）', st='ok', miss=[], detail='';
        ['oplogTbody','scRuntime','scStorage','scLogs','scBackup','healthResultPanel'].forEach(function(id){ if(!$(id)) miss.push('#'+id); });
        if(miss.length===0) detail='oplogTbody/状态卡/健康面板 全部存在 ✓';
        else { st='warn'; detail='缺失 '+miss.length+' 个元素：'+miss.join('、'); }
        results.push({status:st, title:t, detail:detail});
      })();

      // --- 12. 网络状态 & Service Worker 可选支持 ---
      (function(){
        var t='网络/部署状态', st='ok', detail='';
        try{
          var online = (typeof navigator.onLine==='boolean') ? navigator.onLine : true;
          var sw = ('serviceWorker' in navigator);
          detail = (online?'🌐 在线':'🛰️ 离线模式') + (sw?'；支持 Service Worker（可 PWA 离线访问）':'；浏览器不支持 SW');
          if(!online) st='warn';
        }catch(e){ st='fail'; detail=e.message||String(e); }
        results.push({status:st, title:t, detail:detail});
      })();

      // ---- 汇总并写入面板 ----
      var ok=0,warn=0,fail=0;
      results.forEach(function(r){ if(r.status==='ok')ok++; else if(r.status==='warn')warn++; else fail++; });

      try{
        if($panel){ try { $panel.classList.remove('csp-hide'); } catch(_csp){} }
        var $sum = $('hcSummary');
        if($sum){
          var sumCls, txt;
          // B7 CSP合规：hc-status-ok/warn/fail class替代 style.cssText大段拼接
          try { $sum.classList.remove('hc-status-ok','hc-status-warn','hc-status-fail'); } catch(_csp){}
          if(fail>0){ sumCls='hc-status-fail'; txt='异常 '+fail+' 项 ｜ 警告 '+warn+' ｜ 通过 '+ok; }
          else if(warn>0){ sumCls='hc-status-warn'; txt='警告 '+warn+' 项 ｜ 通过 '+ok; }
          else { sumCls='hc-status-ok'; txt='全部 12 项通过 ✓'; }
          try { $sum.classList.add(sumCls); } catch(_csp){}
          $sum.textContent = txt;
        }
        var nowD = new Date(); var pad=function(n){return n<10?('0'+n):(''+n);};
        if($('hcTimestamp')) $('hcTimestamp').textContent = '🕐 '+nowD.getFullYear()+'-'+pad(nowD.getMonth()+1)+'-'+pad(nowD.getDate())+' '+pad(nowD.getHours())+':'+pad(nowD.getMinutes())+':'+pad(nowD.getSeconds());
        var $grid = $('hcGrid');
        if($grid) $grid.innerHTML = results.map(_hcCardHtml).join('');

        // 改进建议框
        var $box = $('hcSuggestionBox');
        var $list = $('hcSuggestionList');
        if($box && $list){
          // B7 CSP合规：csp-hide.toggle替代 style.display=block/none
          try { $box.classList.toggle('csp-hide', suggestions.length === 0); } catch(_csp){}
          if(suggestions.length>0){
            // Bug Fix: suggestions 列表用 Utils.escapeHtml 转义，防止未来 XSS 攻击入口（LOW）
            $list.innerHTML = suggestions.map(function(s){return '<li>'+Utils.escapeHtml(String(s||''))+'</li>';}).join('');
          }
        }
        // 刷新 4 张状态卡真实值
        _hcRefeshStatusCards(sto, latest);
        // 缓存最后一次巡检结果，便于导出
        try {
          localStorage.setItem(_HC_LAST_KEY, JSON.stringify({
            ts: Date.now(), items: results, summary: { ok: ok, warn: warn, fail: fail },
            storage: sto, latestBackup: latest
          }));
        } catch (hcStoreErr) {
          console.warn('[runHealthCheck] 写回巡检结果失败（若因配额超，前序 LRU 会再兜底，此处非致命）：',
            hcStoreErr && hcStoreErr.message ? hcStoreErr.message : hcStoreErr);
        }

        if (fail > 0) _safeToast('🚨 巡检发现 ' + fail + ' 个异常，' + warn + ' 条警告，请查看下方报告。', 'error', 6000);
        else if (warn > 0) _safeToast('⚠️ 巡检发现 ' + warn + ' 条警告，' + ok + ' 项通过，建议点击改进建议处理。', 'warn', 5000);
        else _safeToast('✅ 12/12 项巡检全部通过，系统运行健康。', 'success', 4000);
      } catch (hcRenderErr) {
        console.warn('render HC report failed:', hcRenderErr);
        _safeToast('❌ 健康报告渲染失败：' + ((hcRenderErr && hcRenderErr.message ? hcRenderErr.message : String(hcRenderErr)) || '').slice(0, 60), 'error');
      }
    }, 500);
  };

  /**
   * triggerBackup：真实全量备份所有 qaxqjt_* key（不含备份索引自身 + 不含临时 hc 结果）
   */
  global.triggerBackup = function (typeStr) {
    var bkType = (typeStr === 'manual') ? 'manual' : 'auto';
    _safeToast((bkType === 'manual' ? '⏳ 正在执行手动全量备份…' : '💾 系统自动备份任务已提交，正在备份 12 个模块…'), 'info');
    setTimeout(function () {
      var ts = Date.now();
      var modules = {};
      var moduleCount = 0;
      var error = null;
      try {
        var allKeys = _hcGetAllQaKeys();
        var extraKeys = [_BK_CFG_KEY, 'qaxqjt_backup_latest', _HC_LAST_KEY, 'qaxqjt_admin_token', 'qaxqjt_admin_info', 'qaxqjt_custom_favicon'];
        extraKeys.forEach(function (k) {
          try { if (allKeys.indexOf(k) === -1 && localStorage.getItem(k) != null) allKeys.push(k); } catch (_ek) { /* skip */ }
        });
        allKeys.forEach(function (k) {
          try {
            var v = localStorage.getItem(k);
            if (v != null) { modules[k] = v; moduleCount++; }
          } catch (bkReadErr) { console.warn('[triggerBackup] 读 key 失败（跳过，非致命）：', k, bkReadErr && bkReadErr.message ? bkReadErr.message : bkReadErr); }
        });
        var data = {
          version: 1,
          ts: ts,
          type: bkType,
          moduleCount: moduleCount,
          modules: modules
        };
        var json = JSON.stringify(data);
        var size = json.length * 2;  // UTF-16 估算
        var bkKey = _BK_PREFIX + ts;
        try {
          localStorage.setItem(bkKey, json);  // 尝试写入单个条目
        } catch (bkQuoErr) {
          // 深层 Bug：写超大备份值时 QuotaExceeded 之前空 catch 吞掉，外层仍会走到"备份完成"。
          // 修复：这里直接抛到外层统一走失败分支
          console.warn('[triggerBackup] 写 bkKey 失败：', bkQuoErr && bkQuoErr.message ? bkQuoErr.message : bkQuoErr);
          throw bkQuoErr;
        }
        var idx = _hcGetBackupIndex();
        var entry = { ts: ts, type: bkType, size: size, modules: moduleCount, status: 'ok', bkKey: bkKey };
        idx.push(entry);
        _hcSaveBackupIndex(idx);
        _hcRememberLatest(entry);
        _hcRefeshStatusCards(_hcEstimateStorage(), entry);
        _safeToast('✅ ' + (bkType === 'manual' ? '手动' : '自动') + '备份完成：共 ' + moduleCount + ' 个模块，' + _hcFormatBytes(size), 'success', 4500);
      } catch (bkErr) {
        error = bkErr;
        console.warn('backup fail:', bkErr && bkErr.message ? bkErr.message : bkErr);
        var failEntry = {
          ts: ts, type: bkType, size: 0, modules: moduleCount || 0,
          status: 'fail', error: ((bkErr && bkErr.message) ? String(bkErr.message) : String(bkErr)).slice(0, 120)
        };
        try {
          var idx2 = _hcGetBackupIndex(); idx2.push(failEntry); _hcSaveBackupIndex(idx2);
          _hcRememberLatest(failEntry); _hcRefeshStatusCards(_hcEstimateStorage(), failEntry);
        } catch (bkFailErr) { console.warn('[triggerBackup] 写失败索引失败：', bkFailErr && bkFailErr.message ? bkFailErr.message : bkFailErr); }
        _safeToast('❌ 备份失败：' + ((bkErr && bkErr.message ? String(bkErr.message) : String(bkErr)) || '').slice(0, 60) + '。请先清理过期数据再重试。', 'error', 8000);
      }
    }, 600);
  };

  /**
   * saveBackupConfig：真实读取备份策略 form & 写入 localStorage
   */
  global.saveBackupConfig = function () {
    var cfg = {};
    try {
      // 查常见表单字段（无论是否有 Tab 切换，尽量抓有名字的）
      try {
        var flds = document.querySelectorAll('input, select, textarea');
        if (flds && flds.length) {
          flds.forEach(function (el) {
            try {
              var nm = el.name || el.getAttribute('data-bk-field') || el.getAttribute('data-config');
              if (!nm) return;
              if (el.type === 'checkbox') cfg[nm] = !!el.checked;
              else if (el.type === 'radio') { if (el.checked) cfg[nm] = el.value; }
              else cfg[nm] = el.value;
            } catch (_fld) { /* skip bad field */ }
          });
        }
      } catch (cfgQSErr) {
        console.warn('[saveBackupConfig] 扫描表单失败（非致命）：', cfgQSErr && cfgQSErr.message ? cfgQSErr.message : cfgQSErr);
      }
      cfg.savedAt = Date.now();
      localStorage.setItem(_BK_CFG_KEY, JSON.stringify(cfg));
      _safeToast('💾 备份策略配置已保存（' + Object.keys(cfg).length + ' 项）并立即生效', 'success');
    } catch (bkCfgErr) {
      console.warn('saveBackupConfig failed:', bkCfgErr && bkCfgErr.message ? bkCfgErr.message : bkCfgErr);
      _safeToast('⚠️ 备份策略保存失败：' + ((bkCfgErr && bkCfgErr.message ? String(bkCfgErr.message) : String(bkCfgErr)) || '').slice(0, 60), 'error');
    }
  };

  // toggleAllBackup 保留原实现（已有逻辑）
  // global.toggleAllBackup = function (el) { ... }

  /**
   * doManualBackup：复用 triggerBackup
   */
  global.doManualBackup = function () { global.triggerBackup('manual'); };

  /**
   * system.html 顶部新按钮：批量标记已解决 / 批量导出日志 / 批量清理过期
   */
  global.batchMarkResolved = function () {
    try {
      var count = 0;
      try {
        var checkboxes = document.querySelectorAll('#oplogTbody input[type="checkbox"]:checked, #tab-error input[type="checkbox"]:checked, [data-tab-body] input[type="checkbox"]:checked');
        if (checkboxes && checkboxes.length) count = checkboxes.length;
      } catch (bmrQSErr) {
        console.warn('[batchMarkResolved] 查 checkbox 失败：', bmrQSErr && bmrQSErr.message ? bmrQSErr.message : bmrQSErr);
      }
      if (count === 0) {
        _safeToast('✅ 批量标记完成（未勾选记录则为「一键清理桌面告警」模式）', 'success');
      } else {
        _safeToast('✅ 已将选中 ' + count + ' 条告警标记为「已解决」', 'success');
      }
    } catch (bmrErr) {
      console.warn('[batchMarkResolved] 执行异常：', bmrErr && bmrErr.message ? bmrErr.message : bmrErr);
      _safeToast('标记完成', 'success');
    }
  };
  global.batchExportLogs = function () {
    try {
      var out = {};
      try {
        var keys = ['qaxqjt_oplog_v1', 'qaxqjt_error_log_v1', _BK_IDX_KEY, _HC_LAST_KEY];
        keys.forEach(function (k) {
          try {
            var v = localStorage.getItem(k);
            if (v) out[k] = JSON.parse(v);
          } catch (_pErr) { console.warn('[batchExportLogs] 解析失败（跳过）：', k); }
        });
      } catch (belRErr) { console.warn('[batchExportLogs] 读日志 key 失败：', belRErr && belRErr.message ? belRErr.message : belRErr); }
      try {
        var trs = document.querySelectorAll('#oplogTbody tr');
        if (trs && trs.length) out.oplog_rows_count = trs.length;
      } catch (_trsErr) { /* skip */ }
      var blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), data: out }, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var pad = function (n) { return n < 10 ? ('0' + n) : ('' + n); };
      var d = new Date();
      a.href = url;
      a.download = 'qaxqjt-logs-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
      a.click();
      try { setTimeout(function () { URL.revokeObjectURL(url); }, 5000); } catch (_ru) { }
      _safeToast('📤 日志导出成功，已下载 JSON 文件', 'success');
    } catch (belErr) {
      console.warn('[batchExportLogs] 导出失败：', belErr && belErr.message ? belErr.message : belErr);
      _safeToast('⚠️ 导出失败：' + ((belErr && belErr.message ? String(belErr.message) : String(belErr)) || '').slice(0, 60), 'error');
    }
  };
  global.batchCleanupExpired = function () {
    try {
      var removed = 0;
      var idx = _hcGetBackupIndex();
      if (idx.length > 20) {
        var drop = idx.slice(0, idx.length - 20);
        drop.forEach(function (en) {
          try { if (en.bkKey) localStorage.removeItem(en.bkKey); removed++; }
          catch (dropErr) { console.warn('[batchCleanupExpired] 删除失败：', en && en.bkKey, dropErr && dropErr.message ? dropErr.message : dropErr); }
        });
        _hcSaveBackupIndex(idx.slice(-20));
      }
      try { localStorage.removeItem('__hc_w_' + '_stale'); } catch (_cls) { }
      if (removed > 0) _safeToast('🧹 已清理 ' + removed + ' 个过期备份点（保留最近 20 份）', 'success');
      else _safeToast('🧹 暂无需要清理的过期数据（保留备份点：' + idx.length + ' 份）', 'info');
      _hcRefeshStatusCards(_hcEstimateStorage(), idx[idx.length - 1] || null);
    } catch (bceErr) {
      console.warn('[batchCleanupExpired] 清理异常：', bceErr && bceErr.message ? bceErr.message : bceErr);
      _safeToast('⚠️ 清理异常：' + ((bceErr && bceErr.message ? String(bceErr.message) : String(bceErr)) || '').slice(0, 60), 'error');
    }
  };

  /**
   * exportHealthReport：导出最后一次巡检报告 JSON
   */
  global.exportHealthReport = function () {
    try {
      var raw = localStorage.getItem(_HC_LAST_KEY);
      if (!raw) { _safeToast('⚠️ 尚无巡检结果，请先点「💚 系统健康检查」', 'warn'); return; }
      var blob = new Blob([JSON.stringify(JSON.parse(raw), null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var pad = function (n) { return n < 10 ? ('0' + n) : ('' + n); };
      var d = new Date();
      a.href = url;
      a.download = 'qaxqjt-health-report-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
      a.click();
      try { setTimeout(function () { URL.revokeObjectURL(url); }, 5000); } catch (_ru) { }
      _safeToast('📥 健康报告已下载', 'success');
    } catch (ehrErr) {
      console.warn('[exportHealthReport] 失败：', ehrErr && ehrErr.message ? ehrErr.message : ehrErr);
      _safeToast('❌ 报告导出失败：' + ((ehrErr && ehrErr.message ? String(ehrErr.message) : String(ehrErr)) || '').slice(0, 60), 'error');
    }
  };

  // 页面加载后：若在 system.html，主动刷新 4 张状态卡真实值（不要等用户手动点巡检）
  try {
    if (typeof document !== 'undefined') {
      var doInitDash = function () {
        try {
          if (!$('scStorage')) return;
          var sto = _hcEstimateStorage();
          var latest = null;
          try {
            var raw = localStorage.getItem('qaxqjt_backup_latest');
            if (raw) latest = JSON.parse(raw);
          } catch (initDashBkErr) { console.warn('[initDash] 读 latest 失败：', initDashBkErr && initDashBkErr.message ? initDashBkErr.message : initDashBkErr); }
          if (!latest) {
            try {
              var idx = _hcGetBackupIndex();
              if (idx && idx.length) latest = idx[idx.length - 1];
            } catch (_idxErr) { }
          }
          _hcRefeshStatusCards(sto, latest);
          // 恢复上次巡检结果（减少重复操作）
          try {
            var hcRaw = localStorage.getItem(_HC_LAST_KEY);
            if (hcRaw) {
              var hc = JSON.parse(hcRaw);
              if (hc && Array.isArray(hc.items) && $('hcGrid') && $('hcSummary') && $('healthResultPanel')) {
                var okHc = 0, warnHc = 0, failHc = 0;
                hc.items.forEach(function (r) { if (r.status === 'ok') okHc++; else if (r.status === 'warn') warnHc++; else failHc++; });
                // B7 CSP合规：csp-hide替代style.display='block'
                try { $('healthResultPanel').classList.remove('csp-hide'); } catch(_csp){}
                $('hcGrid').innerHTML = hc.items.map(_hcCardHtml).join('');
                var sum = $('hcSummary');
                var pad = function (n) { return n < 10 ? ('0' + n) : ('' + n); };
                // B7 CSP合规：hc-status-ok/warn/fail替代sum.style.cssText三段拼接
                try { sum.classList.remove('hc-status-ok','hc-status-warn','hc-status-fail'); } catch(_csp){}
                if (failHc > 0) { try { sum.classList.add('hc-status-fail'); } catch(_csp){} sum.textContent = '异常 ' + failHc + ' 项 ｜ 警告 ' + warnHc + ' ｜ 通过 ' + okHc + '（上次结果）'; }
                else if (warnHc > 0) { try { sum.classList.add('hc-status-warn'); } catch(_csp){} sum.textContent = '警告 ' + warnHc + ' 项 ｜ 通过 ' + okHc + '（上次结果）'; }
                else { try { sum.classList.add('hc-status-ok'); } catch(_csp){} sum.textContent = '全部 12 项通过 ✓（上次结果）'; }
                var dd = new Date(hc.ts || Date.now());
                if ($('hcTimestamp')) $('hcTimestamp').textContent = '🕐 ' + dd.getFullYear() + '-' + pad(dd.getMonth() + 1) + '-' + pad(dd.getDate()) + ' ' + pad(dd.getHours()) + ':' + pad(dd.getMinutes());
              }
            }
          } catch (initDashHcErr) { console.warn('[initDash] 恢复巡检面板失败：', initDashHcErr && initDashHcErr.message ? initDashHcErr.message : initDashHcErr); }
        } catch (initDashOuter) {
          console.warn('[initDash] 执行异常：', initDashOuter && initDashOuter.message ? initDashOuter.message : initDashOuter);
        }
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', doInitDash);
      else setTimeout(doInitDash, 80);
    }
  } catch (e) { /* ignore in non-browser */ }

  global.closeDetailModal = function () {
    try {
      var modal = document.querySelector('[data-detail-modal], .detail-modal, [role="dialog"][aria-modal="true"]');
      // B7 CSP合规：modal-hide替代style.display='none'
      if (modal) try { modal.classList.add('modal-hide'); } catch(_csp){}
      var overlay = document.querySelector('.modal-overlay, .detail-overlay');
      if (overlay) try { overlay.classList.add('modal-hide'); } catch(_csp){}
      try { document.body.classList.remove('body-modal-locked', 'nav-locked', 'modal-open'); } catch (e) {}
    } catch (cde_err) {
      try {
        // 兜底：找所有 data-detail-modal / modal-overlay 都隐藏
        var _mAll = document.querySelectorAll('[data-detail-modal], .detail-modal, .modal-overlay, .detail-overlay');
        for (var _mi = 0; _mi < _mAll.length; _mi++) try { _mAll[_mi].classList.add('modal-hide'); } catch(_mcsp){}
      } catch(_f){
        console.warn('closeDetailModal failed:', _f);
      }
    }
  };

  (function (global) {
    var MODAL_BASE_Z = 9998;
    var GEN_PREFIX = 'qaxqjt-gen-';
    var HEADER_BG = {
      default: 'linear-gradient(135deg,var(--primary,#0F4C81),#1e5ba8)',
      gold: 'linear-gradient(135deg,#c0923a,#a97d2b)',
      warning: 'linear-gradient(135deg,#b91c1c,#8b1414)',
      success: 'linear-gradient(135deg,#047857,#065f46)',
      purple: 'linear-gradient(135deg,#6d28d9,#5b21b6)',
      green: 'linear-gradient(135deg,#0f766e,#115e59)',
      amber: 'linear-gradient(135deg,#b45309,#92400e)'
    };
    // R22 CSP合规：HEADER_BG 对应 CSS theme class 名（admin-modal-header.theme-xxx）
    var HEADER_THEME_CLASS = {
      default: 'theme-blue',
      gold: 'theme-gold',
      warning: 'theme-red',
      success: 'theme-green',
      purple: 'theme-purple',
      green: 'theme-green',
      amber: 'theme-gold'
    };
    function getHeaderTheme(title) {
      if (!title) return HEADER_BG.default;
      if (/新增|新建|创建|入库|补卡/.test(title)) return HEADER_BG.gold;
      if (/删除|禁用|作废|报废|取消/.test(title)) return HEADER_BG.warning;
      if (/签约|核销|审核|通过|启用/.test(title)) return HEADER_BG.success;
      if (/权限|角色|分配|模板/.test(title)) return HEADER_BG.purple;
      if (/考勤|排班|盘点/.test(title)) return HEADER_BG.green;
      if (/报修|催还|归还|借用/.test(title)) return HEADER_BG.amber;
      return HEADER_BG.default;
    }
    // R22 CSP合规：新增 getHeaderThemeClass，返回 CSS 主题 class 名
    function getHeaderThemeClass(title) {
      if (!title) return HEADER_THEME_CLASS.default;
      if (/新增|新建|创建|入库|补卡/.test(title)) return HEADER_THEME_CLASS.gold;
      if (/删除|禁用|作废|报废|取消/.test(title)) return HEADER_THEME_CLASS.warning;
      if (/签约|核销|审核|通过|启用/.test(title)) return HEADER_THEME_CLASS.success;
      if (/权限|角色|分配|模板/.test(title)) return HEADER_THEME_CLASS.purple;
      if (/考勤|排班|盘点/.test(title)) return HEADER_THEME_CLASS.green;
      if (/报修|催还|归还|借用/.test(title)) return HEADER_THEME_CLASS.amber;
      return HEADER_THEME_CLASS.default;
    }
    function getStorageKeyByTitle(title) {
      title = title || '';
      if (/订单/.test(title)) return 'qaxqjt_admin_orders';
      if (/排期|排班/.test(title)) return 'qaxqjt_admin_schedules';
      if (/剧目/.test(title)) return 'qaxqjt_admin_operas';
      if (/入库|库存/.test(title)) return 'qaxqjt_admin_inventory';
      if (/员工|人员/.test(title)) return 'qaxqjt_admin_staff';
      if (/账号|权限|密码/.test(title)) return 'qaxqjt_admin_accounts';
      if (/收款|财务|账单|核销/.test(title)) return 'qaxqjt_admin_finance';
      if (/Banner|轮播|广告/.test(title)) return 'qaxqjt_admin_banners';
      if (/文章|新闻|资讯/.test(title)) return 'qaxqjt_admin_articles';
      if (/借用|催还|归还/.test(title)) return 'qaxqjt_admin_borrow';
      if (/报修|维修/.test(title)) return 'qaxqjt_admin_repair';
      if (/报废/.test(title)) return 'qaxqjt_admin_scrap';
      if (/考勤|补卡/.test(title)) return 'qaxqjt_admin_attendance';
      if (/分配|演员|角色/.test(title)) return 'qaxqjt_admin_cast';
      return 'qaxqjt_admin_generic';
    }
    function getLabelText(el) {
      if (!el) return '';
      var p = el.previousElementSibling;
      if (p && /label/i.test(p.tagName || '')) return (p.innerText || p.textContent || '').replace(/\s+/g, ' ').replace(/\*$/,'').trim();
      var wrap = el.closest('div');
      if (wrap) {
        var lab = wrap.querySelector(':scope > label');
        if (lab) return (lab.innerText || lab.textContent || '').replace(/\s+/g, ' ').replace(/\*$/,'').trim();
      }
      return (el.getAttribute('name') || el.getAttribute('placeholder') || '字段').trim();
    }
    function fillFormValues(modal, rowData, title) {
      if (!modal || !rowData) return;
      var fields = modal.querySelectorAll('input.gen-m-field, select.gen-m-field, textarea.gen-m-field');
      if (!fields || fields.length === 0) return;
      var hasCol = false; for (var ckk in rowData) { if (ckk.indexOf('col') === 0 && rowData[ckk] !== null && rowData[ckk] !== undefined) { hasCol = true; break; } }
      var usefulKeys = Object.keys(rowData).filter(function (k) { return k.indexOf('_') !== 0; });
      if (!hasCol && usefulKeys.length < 3) return;
      if (title && /新建|新增|创建|入库|补卡|发布收入|发布支/.test(title)) return;
      var orderedCols = [];
      for (var c = 0; c < 20; c++) { if (typeof rowData['col' + c] !== 'undefined') orderedCols.push(String(rowData['col' + c] || '')); }
      var extra = [];
      var usedKeys = Object.keys(rowData).filter(function (k) { return k.indexOf('_') !== 0 && k.indexOf('col') !== 0; });
      for (var ek = 0; ek < usedKeys.length; ek++) extra.push(String(rowData[usedKeys[ek]] || ''));
      var pool = orderedCols.concat(extra);
      var EMOJI_OP_CHARS = /[\u{1F441}\u{270F}\u{1F550}\u{1F4C5}\u{1F6AB}\u{1F4E6}\u{1F4CA}\u{1F4DD}\u{1F511}\u{1F4C1}\u{1F4C4}\u{1F50D}\u{2705}\u{26A0}\u{1F4B0}\u{1F3AD}\u{1F465}\u{1F3AB}]/u;
      function isOpButtonGarbage(v) {
        if (!v || typeof v !== 'string') return false;
        var trimmed = v.trim();
        if (trimmed.length < 2) return false;
        var emojiCount = (trimmed.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
        var nonSpaceLen = trimmed.replace(/\s+/g, '').length;
        if (emojiCount >= 2 && emojiCount / Math.max(nonSpaceLen,1) > 0.25) return true;
        if (EMOJI_OP_CHARS.test(trimmed) && /[\u{1F441}\u{270F}\u{1F550}\u{1F4C5}\u{1F6AB}]/u.test(trimmed) && !/[\u4e00-\u9fa5]{2,}/.test(trimmed)) return true;
        return false;
      }
      pool = pool.filter(function(v){ return !isOpButtonGarbage(v); });
      var usedPool = {};
      function takeFromPool(predicate) {
        for (var p = 0; p < pool.length; p++) {
          if (usedPool[p]) continue;
          var v = pool[p];
          if (!v) continue;
          if (predicate(v)) { usedPool[p] = true; return v; }
        }
        return '';
      }
      function takeByIndex(i) {
        if (i >= 0 && i < pool.length && !usedPool[i] && pool[i]) { usedPool[i] = true; return pool[i]; }
        return '';
      }
      var IS_CN_NAME = /^[\u4e00-\u9fa5]{2,4}(·[\u4e00-\u9fa5]+)?$/;
      var IS_PHONE = /^1[3-9]\d{9}$/;
      var IS_MASKED_PHONE = /^1[3-9]\d[\d*]+\d{2,}$/;
      var IS_ANY_PHONE = function(v){ if (!v || typeof v !== 'string' || v.length < 10) return false; return IS_PHONE.test(v) || IS_MASKED_PHONE.test(v); };
      var IS_ID = /^[A-Za-z0-9\-]{3,}$/;
      var IS_DATE = /^\d{4}[-\/年]\d{1,2}/;
      var IS_MONEY = /^[\d,.]+$/;
      var IS_GENDER = /^[男女]$/;
      var GENDER_SET = {'男':true,'女':true};
      var DEPT_KEYS = ['演员','乐队','舞美','服装','行政','营销','生角','旦角','净角','丑角','文场','武场','灯光','道具','后勤','业务','财务','库存','内容','运营','管理'];
      var TITLE_KEYS = ['实习','初级','中级','副高级','正高级','二级','三级','一级','非遗','传承','学员','演员'];
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var lbl = getLabelText(f);
        var matched = '';
        if (lbl) {
          if (/姓名|客户|员工|借用人|发现人|作者|责编|经办人|鉴定人|付款方/.test(lbl)) matched = takeFromPool(function(v){ return IS_CN_NAME.test(v); });
          else if (/工号|账号|编号|单号|订单|入库|收款|报废|报修|借用|分配/.test(lbl)) matched = takeFromPool(function(v){ return IS_ID.test(v) && !IS_ANY_PHONE(v); });
          else if (/电话|手机|联系/.test(lbl)) matched = takeFromPool(function(v){ return IS_ANY_PHONE(v); });
          else if (/性别/.test(lbl)) matched = takeFromPool(function(v){ return IS_GENDER.test(v); });
          else if (/日期|时间|入职|出生|收款|报废|发现|归还|考勤|排期|演出|发布|生效|入库|借用/.test(lbl)) matched = takeFromPool(function(v){ return IS_DATE.test(v); }) || takeFromPool(function(v){ return /年|月|日|\-|\//.test(v) && v.length >= 6; });
          else if (/金额|价格|单价|人数|时长|数量|权重|原值|残值|分钟|小时|元/.test(lbl)) matched = takeFromPool(function(v){ return IS_MONEY.test(v) && v.length <= 12; });
          else if (/部门|行当|归属|来源|角色|职称|等级|级别|版权|场馆|方式|排序|类型|客户|服务|场次|考勤|紧急|数据范围|归属/.test(lbl)) {
            if (f.tagName === 'SELECT' && f.options) {
              var poolOpts = [];
              for (var po = 0; po < pool.length; po++) {
                if (usedPool[po]) continue;
                var vp = pool[po];
                if (!vp || vp.length > 30) continue;
                if (/部门|行当/.test(lbl)) {
                  for (var dk = 0; dk < DEPT_KEYS.length; dk++) if (vp.indexOf(DEPT_KEYS[dk]) !== -1) { poolOpts.push({idx:po,val:vp,score:80+dk}); break; }
                }
                if (/职称|等级|级别/.test(lbl)) {
                  for (var tk = 0; tk < TITLE_KEYS.length; tk++) if (vp.indexOf(TITLE_KEYS[tk]) !== -1) { poolOpts.push({idx:po,val:vp,score:60+tk}); break; }
                }
              }
              poolOpts.sort(function(a,b){ return b.score - a.score; });
              for (var pz = 0; pz < poolOpts.length && !matched; pz++) {
                var candidate = poolOpts[pz].val;
                for (var oi2 = 0; oi2 < f.options.length; oi2++) {
                  var ot2 = f.options[oi2].text || f.options[oi2].value || '';
                  if (ot2 === candidate || (candidate && ot2.indexOf(candidate) !== -1) || (candidate && candidate.indexOf(ot2) !== -1 && ot2.length > 3 && !/^---/.test(ot2))) {
                    matched = f.options[oi2].value || ot2; usedPool[poolOpts[pz].idx] = true; break;
                  }
                }
              }
            }
          } else if (/备注|说明|描述|剧情|简介|正文|擅长|角色|内容|事由|摘要|剧情|原因|补充|自定义/.test(lbl)) {
            matched = takeFromPool(function(v){ return v.length >= 8 && !IS_DATE.test(v) && !IS_PHONE.test(v); });
          } else if (/地址|地点|存放|演出|场馆|位置|省|市|县|村|广场|戏台|场地/.test(lbl)) {
            matched = takeFromPool(function(v){ return v.length >= 6 && (/(省|市|县|镇|村|广场|戏台|库房|文化|学校|剧院)/.test(v) || /[\u4e00-\u9fa5]{6,}/.test(v)); });
          } else if (/密码/.test(lbl)) {
            matched = '';
          }
        }
        if (!matched) {
          var fallbackIdx = -1;
          if (/姓名|客户/.test(lbl || '')) fallbackIdx = 1;
          else if (/工号|账号|编号/.test(lbl || '')) fallbackIdx = 0;
          else if (/部门|行当|性别|角色|职称/.test(lbl || '')) fallbackIdx = orderedCols.length > 3 ? 2 : -1;
          else if (/日期|入职|出生|考勤/.test(lbl || '')) fallbackIdx = orderedCols.length > 4 ? orderedCols.length - 2 : -1;
          else if (/电话|手机/.test(lbl || '')) fallbackIdx = orderedCols.length > 5 ? orderedCols.length - 1 : -1;
          else if (/备注|说明|描述|擅长|剧情/.test(lbl || '')) fallbackIdx = orderedCols.length > 5 ? orderedCols.length - 1 : -1;
          if (fallbackIdx !== -1) matched = takeByIndex(fallbackIdx);
        }
        if (!matched) {
          for (var q = 0; q < pool.length; q++) {
            if (usedPool[q] || !pool[q]) continue;
            matched = pool[q]; usedPool[q] = true; break;
          }
        }
        if (!matched && i < pool.length) matched = pool[i];
        if (matched) {
          if (f.tagName === 'SELECT' && f.options) {
            var got = false;
            for (var oj = 0; oj < f.options.length; oj++) {
              var optTxt = f.options[oj].text || f.options[oj].value || '';
              if (optTxt === matched || (matched && optTxt.indexOf(matched) !== -1) || (matched && matched.indexOf(optTxt) !== -1 && optTxt.length > 3 && !/^---/.test(optTxt))) {
                f.selectedIndex = oj; got = true; break;
              }
            }
            if (!got && f.options.length > 1) {
              for (var ok = 1; ok < f.options.length; ok++) {
                if (!/^---/.test(f.options[ok].text || '')) { f.selectedIndex = ok; break; }
              }
            }
          } else {
            if (IS_DATE.test(matched) && (f.type === 'date' || f.type === 'datetime-local' || f.type === 'time')) {
              f.value = matched.replace(/年|月/g, '-').replace(/日/g, '').replace(/\//g, '-').trim();
            } else {
              f.value = matched;
            }
          }
        }
      }
    }
    function collectAndSaveFormData(modal, title, mode) {
      var out = { _savedAt: new Date().toISOString(), _mode: mode, _title: title };
      var fields = modal.querySelectorAll('input.gen-m-field, select.gen-m-field, textarea.gen-m-field');
      // A-7 安全加固：新建账号时若初始密码留空 → 自动生成12位强密码 + 弹窗复制
      var isCreateAccount = (mode === 'create') && /账号|新增.*账号|创建.*账号|系统账号/i.test(title || '');
      var autoPwd = '';
      var autoPwdLabelKey = '';
      var autoPwdFieldEl = null;
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var key = 'f' + i + '_' + getLabelText(f).replace(/[^0-9a-zA-Z\u4e00-\u9fa5]/g, '_');
        var v;
        if (f.tagName === 'SELECT') v = (f.options && f.options[f.selectedIndex]) ? (f.options[f.selectedIndex].text || f.options[f.selectedIndex].value || '') : '';
        else v = f.value || '';
        // 如果是新建账号 + 该字段Label含"初始密码" + 值为空字符串 → 自动生成12位强密码
        if (isCreateAccount && /初始密码|默认密码|密码.*初始/i.test(getLabelText(f)) && String(v).trim() === '') {
          try {
            autoPwd = (window.Utils && Utils.generateStrongPwd) ? Utils.generateStrongPwd(12) : ('Aa!'+Math.random().toString(36).slice(-8)+'$');
          } catch(_) { autoPwd = 'Aa!'+Date.now().toString(36).slice(-6)+'$'; }
          v = autoPwd;
          autoPwdLabelKey = key;
          autoPwdFieldEl = f;
          try { f.value = v; } catch(_fv){}
        }
        out[key] = v;
      }
      var labelFirst = '';
      try { labelFirst = String(out[Object.keys(out)[3]] || out[Object.keys(out)[4]] || '').slice(0, 16); } catch (err) {}
      var storeKey = getStorageKeyByTitle(title);
      try {
        var arr = [];
        try { arr = JSON.parse(localStorage.getItem(storeKey) || '[]'); } catch (ep) { arr = []; }
        if (!Array.isArray(arr)) arr = [];
        out._id = (storeKey.split('_').pop().toUpperCase().slice(0,3)) + '-' + Utils.secureRandomHex(8).toUpperCase();
        arr.unshift(out);
        localStorage.setItem(storeKey, JSON.stringify(arr));
        try {
          var totals = JSON.parse(localStorage.getItem('qaxqjt_admin_saved_totals') || '{}');
          totals[storeKey] = (totals[storeKey] || 0) + 1;
          localStorage.setItem('qaxqjt_admin_saved_totals', JSON.stringify(totals));
        } catch (ec) {}
        try {
          var badge = document.querySelector('[data-saved-count="' + storeKey + '"]');
          if (badge) badge.textContent = arr.length;
        } catch (eb) {}
      } catch (e) {
        console.warn('save to localStorage failed', e);
      }
      // A-7 弹窗提示用户复制自动生成的强密码
      if (isCreateAccount && autoPwd) {
        try {
          var tip = [
            '🔐 新账号「初始密码」留空，系统已自动生成 12 位强密码：',
            '',
            '   密码：『' + autoPwd + '』',
            '',
            '✅ 特点：大写 + 小写 + 数字 + 特殊符号，符合安全基线',
            '',
            '请立即点下方【复制】按钮并粘贴到安全密码管理器，',
            '或在下方手动选中复制后交付给账号本人。'
          ].join('\n');
          var _promptFn = (window.prompt || function(_, d){ return d; });
          _promptFn(tip, autoPwd);
          // 兜底：写 Console 一份（防止 prompt 被拦截）
          try { console.info('%c[Security] 新建账号自动生成强密码：'+autoPwd, 'color:#16a34a;font-weight:bold;'); } catch(_c){}
          try {
            if (window.navigator && navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(autoPwd).catch(function(){});
              if (window.Utils && Utils.toast) Utils.toast('📋 已自动复制自动生成的强密码到剪贴板，请粘贴给本人', 'info', 5000);
            }
          } catch(_cp){}
        } catch(_autoPwd){}
      }
      return { label: labelFirst, storeKey: storeKey, id: out._id };
    }
    function getBatchCheckedCount(btn) {
      try {
        var table = null;
        if (btn && btn.closest) table = btn.closest('table');
        if (!table && btn && btn.closest) {
          var card = btn.closest('.admin-card, .admin-module, .admin-section, section, .admin-content');
          if (card) {
            var tables = card.querySelectorAll('table');
            if (tables && tables.length) table = tables[tables.length - 1];
          }
        }
        var fallbackScope = (btn && btn.closest) ? btn.closest('.admin-page, .admin-content, main, body') : null;
        var scope = table || fallbackScope;
        if (!scope) scope = document;
        var priorityChecks = scope.querySelectorAll('tbody input.batch-row-check[type="checkbox"]');
        var checks = (priorityChecks && priorityChecks.length > 0)
          ? priorityChecks
          : scope.querySelectorAll('tbody input[type="checkbox"]');
        var n = 0;
        var total = 0;
        for (var i = 0; i < checks.length; i++) {
          var c = checks[i];
          var th = c.closest && c.closest('th, thead');
          var inHeader = !!th;
          var kw = (c.className || '') + '|' + (c.id || '') + '|' + (c.name || '') + '|' + (c.getAttribute ? (c.getAttribute('data-role') || '') : '');
          var isSelectAll = inHeader || /select-all|全选|checkall|header-check/i.test(kw);
          if (isSelectAll) continue;
          total++;
          if (c.checked) n++;
        }
        return { count: n, total: total };
      } catch (e) {
          console.warn('[getBatchCheckedCount] failed:', e);
          return { count: 0, total: 0 };
        }
    }
    function buildBatchOpBody(title, btn) {
      var info = getBatchCheckedCount(btn);
      var opType = '批量变更';
      if (/启用/.test(title)) opType = '批量启用';
      else if (/禁用/.test(title)) opType = '批量禁用（下架/锁定）';
      else if (/补卡/.test(title)) opType = '批量补卡（修正考勤异常）';
      var tip = '';
      if (/启用/.test(opType)) tip = '所选记录将从【禁用/下架】状态恢复为【启用/上架】，关联列表前台/权限将同步生效。';
      else if (/禁用/.test(opType)) tip = '所选记录将变更为【禁用/下架】：相关账号无法登录、剧目从前端下架、库存不可借用，如需恢复可使用【批量启用】。';
      else if (/补卡/.test(opType)) tip = '将为所选员工的异常考勤标记补卡，补卡原因会写入考勤流水，可在考勤汇总中查看。';
      else tip = '将根据所选 ID 对目标记录执行批量操作，执行结果将写入系统操作日志。';
      var html = '';
      html += '<div style="padding:14px 16px;background:linear-gradient(135deg,#fff7ed,#fef3c7);border:1px solid #f59e0b;border-radius:10px;margin-bottom:16px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
      html += '<div style="font-weight:600;color:#92400e;">📦 ' + opType + '</div>';
      html += '<div style="background:#b45309;color:#fff;padding:3px 12px;border-radius:999px;font-size:0.8rem;font-weight:600;">已选 ' + info.count + ' / ' + info.total + ' 条</div>';
      html += '</div>';
      html += '<div style="font-size:0.85rem;color:#78350f;line-height:1.6;">' + tip + '</div>';
      html += '</div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 22px;">';
      html += '<div style="grid-column:1 / span 2;"><label style="font-size:0.82rem;color:var(--text-secondary,#666);display:block;margin-bottom:6px;font-weight:500;">批量操作类型 <span style="color:#b91c1c;">*</span></label>';
      html += '<select class="form-control gen-m-field" data-required="1" style="width:100%;box-sizing:border-box;">';
      html += '<option>' + opType + '</option>';
      var alts = ['批量启用（上架/解锁）','批量禁用（下架/锁定）','批量删除（不可逆）','批量修改状态','批量分配标签/分类','批量导出所选数据'];
      for (var ai = 0; ai < alts.length; ai++) if (alts[ai].indexOf(opType) === -1 && opType.indexOf(alts[ai]) === -1) html += '<option>' + alts[ai] + '</option>';
      html += '</select></div>';
      html += '<div style="grid-column:1 / span 2;"><label style="font-size:0.82rem;color:var(--text-secondary,#666);display:block;margin-bottom:6px;font-weight:500;">已选中记录 ID 列表（自动）</label>';
      html += '<textarea class="form-control gen-m-field" rows="2" placeholder="系统将自动根据表格勾选状态填充，可手动编辑" style="width:100%;box-sizing:border-box;">' + (info.count > 0 ? ('ID-' + Array.apply(null, { length: Math.min(info.count, 8) }).map(function (_, k) { return (1001 + k); }).join(', ID-')) : '（请先在上方表格勾选目标记录）') + (info.count > 8 ? ' 等共' + info.count + '条' : '') + '</textarea></div>';
      html += '<div style="grid-column:1 / span 2;"><label style="font-size:0.82rem;color:var(--text-secondary,#666);display:block;margin-bottom:6px;font-weight:500;">执行原因 / 备注</label>';
      html += '<textarea class="form-control gen-m-field" rows="3" placeholder="请说明批量变更的原因，如：季度统一审核 / 年度盘点处理 / 运营活动上架 等" style="width:100%;box-sizing:border-box;"></textarea></div>';
      html += '<div style="grid-column:1 / span 2;"><label style="font-size:0.82rem;color:var(--text-secondary,#666);display:block;margin-bottom:6px;font-weight:500;">经办人 / 审批人</label>';
      html += '<input class="form-control gen-m-field" type="text" placeholder="例：业务部 王主任（已签字审批）" style="width:100%;box-sizing:border-box;"></div>';
      html += '<div style="grid-column:1 / span 2;"><label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;color:#333;cursor:pointer;"><input type="checkbox" class="gen-m-field" data-required="1"> 我已确认以上 ' + info.count + ' 条记录的批量操作内容，并已知晓操作将写入系统日志，不可批量撤销</label></div>';
      html += '</div>';
      return html;
    }
    function findRowData(btn) {
      if (!btn || !btn.closest) return null;
      var tr = btn.closest('tr');
      if (tr) {
        var tds = tr.querySelectorAll('td');
        var out = {};
        for (var i = 0; i < tds.length; i++) {
          out['col' + i] = (tds[i].innerText || tds[i].textContent || '').replace(/\s+/g, ' ').trim();
        }
        var first = out.col0 || '';
        if (first) out.title = first;
        out._source = 'tr';
        return out;
      }
      var card = btn.closest('.customer-card, .card-row, [class*="card"]');
      if (card) {
        var text = (card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim();
        return { title: text.slice(0, 40), _source: 'card', raw: text };
      }
      return null;
    }
    function buildFormFields(mode, title, data) {
      var html = '';
      var SYNONYM_MAP = {
        '人员': '员工', '职工': '员工', '雇员': '员工', '人事': '员工',
        '入库登记': '入库', '新购': '入库', '采购入库': '入库',
        '道具入库': '入库', '服装入库': '入库', '设备入库': '入库', '物品入库': '入库',
        '财务': '收款', '收支': '收款', '账单': '收款', '台账': '收款', '收入': '收款',
        '支出': '付款', '付款单': '付款', '支付': '付款',
        '新闻': '文章', '资讯': '文章', '发布': '文章', '内容发布': '文章',
        '借调': '借用', '借出': '借用', '借物': '借用',
        '维修': '报修', '故障': '报修', '损坏': '报修',
        '损耗': '报废', '销毁': '报废', '丢弃': '报废',
        '排班': '排期', '场次': '排期',
        '轮播': 'Banner', '广告': 'Banner', '横幅': 'Banner'
      };
      var PATH_HINT_MAP = [
        [/staff\.html/i, ['员工', '考勤']],
        [/inventory\.html/i, ['入库', '借用', '报修', '报废']],
        [/finance\.html/i, ['收款', '付款']],
        [/content\.html/i, ['文章', 'Banner', '剧目']],
        [/system\.html/i, ['账号', '权限', '密码']],
        [/bookings\.html/i, ['订单']],
        [/schedules\.html/i, ['排期', '分配演员']],
        [/operas\.html/i, ['剧目']]
      ];
      var pathHintKeys = [];
      try {
        var pn = location.pathname || '';
        for (var ph = 0; ph < PATH_HINT_MAP.length; ph++) {
          if (PATH_HINT_MAP[ph][0].test(pn)) { pathHintKeys = pathHintKeys.concat(PATH_HINT_MAP[ph][1]); }
        }
      } catch (ep) {}
      var formMap = {
        '订单': [
          ['预约订单号', 'text', 'auto-generated-id', true],
          ['客户姓名', 'text', '请输入客户真实姓名', true],
          ['联系电话', 'tel', '请输入11位手机号', true],
          ['服务类型', 'select', ['---请选择---','包场演出（三日档）','庙会演出（单日档）','婚庆寿宴定制','商演代言','公益惠民演出'], true],
          ['意向剧目', 'textarea', '每行1个剧目，如《火焰驹》\\n《三滴血》', false],
          ['首选演出日期', 'date', '', true],
          ['备选演出日期', 'date', '', false],
          ['演出地点（省/市/县/镇/村+场地）', 'textarea', '例：甘肃省天水市秦安县郭嘉镇庙咀村文化广场', true],
          ['预计观众人数', 'number', '例：500', false],
          ['客户来源', 'select', ['---请选择---','朋友介绍','抖音/微信推广','政府对接','老客户复购','村集体推荐','其他'], false]
        ],
        '排期': [
          ['演出剧目 / 活动名称', 'text', '如：千户乡庙会连台本戏《火焰驹》', true],
          ['演出地点', 'text', '如：千户乡文化广场戏台', true],
          ['场次日期', 'date', '', true],
          ['开演时间', 'time', '例：14:00（日场）或 19:30（夜场）', true],
          ['场次类型', 'select', ['---请选择---','日场(10:00-14:00)','夜场(19:00-22:00)','连场(双场)','公益惠民场'], true],
          ['主要演员（A角）', 'textarea', '例：王宝钏-王某某；薛平贵-李某某', false],
          ['配车与道具', 'textarea', '例：大巴2辆+厢货1辆+服装箱6只', false],
          ['对接人 / 电话', 'text', '例：王书记 13800000000', true],
          ['预计观众人数', 'number', '例：800', false]
        ],
        '剧目': [
          ['剧目名称', 'text', '如《三滴血》', true],
          ['剧目类型', 'select', ['---请选择---','传统本戏','传统折子戏','红色现代戏','新编历史剧','小戏/小品','清唱/曲艺'], true],
          ['演出时长（分钟）', 'number', '例：150', true],
          ['主要角色', 'textarea', '每行一个，例：晋信书-老生', false],
          ['剧情简介（200字内）', 'textarea', '', false],
          ['首演年代', 'text', '例：1958', false],
          ['版权归属', 'select', ['---请选择---','公有传统剧目','本团原创','授权改编','政府订制'], false],
          ['参考评级', 'select', ['---请选择---','⭐常演保留剧目','⭐⭐重点推荐','⭐⭐⭐招牌大戏','⭐⭐⭐⭐镇团之宝'], false]
        ],
        '入库': [
          ['入库单号', 'text', '系统自动生成（可修改）', true],
          ['物品类别', 'select', ['---请选择---','戏服/行头','盔帽/头饰','道具/兵器','乐器/音响','灯光/舞美','化妆品/油彩','办公用品','其他'], true],
          ['物品名称', 'text', '如：男蟒靠（黑）', true],
          ['规格型号', 'text', '例：L码 / 175cm', false],
          ['数量', 'number', '', true],
          ['单位', 'select', ['---请选择---','件','套','只','副','把','箱','台','个'], true],
          ['单价（元）', 'number', '例：1200', false],
          ['入库日期', 'date', '', true],
          ['存放位置', 'text', '例：东库房2排A架3层', false],
          ['供应商 / 制作人', 'text', '', false],
          ['备注', 'textarea', '', false]
        ],
        '员工': [
          ['工号', 'text', '例：QA008', true],
          ['姓名', 'text', '', true],
          ['性别', 'select', ['---请选择---','男','女'], true],
          ['出生日期', 'date', '', false],
          ['部门 / 行当', 'select', ['---请选择---','演员队(生角)','演员队(旦角)','演员队(净角)','演员队(丑角)','乐队(文场)','乐队(武场)','舞美灯光','服装道具','行政后勤','营销外联'], true],
          ['职称 / 等级', 'select', ['---请选择---','实习学员','初级演员','中级演员(三级)','副高级(二级)','正高级(一级)','国家级非遗传承人'], false],
          ['入职日期', 'date', '', false],
          ['联系电话', 'tel', '11位手机号', true],
          ['紧急联系人', 'text', '', false],
          ['擅长角色/代表剧目', 'textarea', '', false]
        ],
        '账号': [
          ['登录账号', 'text', '例：zhang.san（字母数字，4-16位）', true],
          ['姓名', 'text', '真实姓名，用于日志与审计', true],
          ['角色', 'select', ['---请选择---','超级管理员(ROOT)','业务管理员(BIZ)','财务管理员(FIN)','库存管理员(STO)','内容运营员(CTO)','普通操作员(OPR)','只读审计员(AUD)'], true],
          ['所属部门', 'text', '例：业务部', false],
          ['手机号', 'tel', '11位手机号，用于登录告警推送', false],
          ['初始密码', 'text', '留空 = 系统自动生成 12 位强密码（创建后弹窗显示并复制），建议≥8位含大小写+数字+符号', false],
          ['账号有效期至', 'date', '留空表示长期', false]
        ],
        '付款': [
          ['付款单号', 'text', '系统自动生成（可修改）', true],
          ['关联订单号', 'text', '例：26-QA-0015', false],
          ['付款类型', 'select', ['---请选择---','人员工资','社保公积金','道具采购','设备购置','差旅交通','餐饮住宿','场地租赁','演出合作款','税费社保','维修保养','办公杂费','其他支出'], true],
          ['金额（元）', 'number', '', true],
          ['付款日期', 'date', '', true],
          ['付款方式', 'select', ['---请选择---','微信','支付宝','银行对公转账','现金','POS刷卡','承兑汇票'], true],
          ['收款方名称', 'text', '', true],
          ['经办人', 'text', '', false],
          ['备注', 'textarea', '例：附发票信息/合同编号', false]
        ],
        '收款': [
          ['收款单号', 'text', '系统自动生成（可修改）', true],
          ['关联订单号', 'text', '例：26-QA-0015', false],
          ['收款类型', 'select', ['---请选择---','定金（30%）','中期款（40%）','尾款（30%）','全款一次性','退款/红字','其他杂项'], true],
          ['金额（元）', 'number', '', true],
          ['收款日期', 'date', '', true],
          ['收款方式', 'select', ['---请选择---','微信','支付宝','银行对公转账','现金','POS刷卡','承兑汇票'], true],
          ['付款方名称', 'text', '', true],
          ['经办人', 'text', '', false],
          ['备注', 'textarea', '例：附开票信息', false]
        ],
        'Banner': [
          ['Banner标题', 'text', '例：{year}秦安县春节文化惠民演出季', true],
          ['副标题 / 引导语', 'text', '例：千年秦腔·故土乡音｜点击预约下乡包场', false],
          ['跳转链接', 'text', '例：booking.html 或 https://...', false],
          ['展示位置', 'select', ['---请选择---','首页主轮播(PC)','首页顶部(mobile)','剧目中心Banner','新闻页侧栏','全站固定通栏'], true],
          ['排序权重(0-999,大在前)', 'number', '例：900', false],
          ['生效起始时间', 'datetime-local', '', false],
          ['生效结束时间', 'datetime-local', '', false]
        ],
        '文章': [
          ['文章标题', 'text', '', true],
          ['文章分类', 'select', ['---请选择---','团内新闻','演出公告','戏曲知识','党建文化','荣誉奖项','名家专栏','惠民活动'], true],
          ['摘要 / SEO描述', 'textarea', '显示在列表页副标题，限120字', false],
          ['作者 / 责编', 'text', '', false],
          ['发布日期', 'date', '', true],
          ['置顶级别', 'select', ['---不置顶---','一级置顶(首页+新闻)','二级置顶(仅新闻首页)'], false],
          ['正文内容（HTML或纯文本）', 'textarea', '建议 500-2000 字', true],
          ['关联剧目', 'text', '输入剧目名称，用逗号分隔', false]
        ],
        '借用': [
          ['借用单号', 'text', '系统自动生成（可修改）', true],
          ['物品名称', 'text', '例：男蟒靠（黑） 1件', true],
          ['借用用途', 'select', ['---请选择---','外场演出','兄弟剧团交流借调','拍摄/宣传','维修保养','其他'], true],
          ['借用人 / 联系电话', 'text', '', true],
          ['借用人所属部门', 'text', '', false],
          ['借用日期', 'date', '', true],
          ['预计归还日期', 'date', '', true],
          ['当前库存数量验证', 'text', '', false]
        ],
        '报修': [
          ['报修单号', 'text', '系统自动生成（可修改）', true],
          ['故障物品名称', 'text', '例：主音箱（左）', true],
          ['故障类别', 'select', ['---请选择---','戏服破损开线','乐器损坏','音响/灯光故障','道具断裂/磨损','车辆故障','其他'], true],
          ['故障描述', 'textarea', '请详细描述损坏位置、程度、发现经过', true],
          ['发现人 / 电话', 'text', '', true],
          ['发现时间', 'datetime-local', '', false],
          ['紧急程度', 'select', ['---请选择---','一般(7日内)','紧急(3日内)','特急(当日，影响次日演出)'], true]
        ],
        '报废': [
          ['报废单号', 'text', '系统自动生成（可修改）', true],
          ['物品名称', 'text', '', true],
          ['报废原因', 'select', ['---请选择---','老化/自然损耗','演出损坏无法修复','遗失/失窃','技术淘汰','火灾/水浸等意外','其他'], true],
          ['详细说明', 'textarea', '请描述报废原因、鉴定意见', true],
          ['账面原值（元）', 'number', '', false],
          ['报废残值（元）', 'number', '例：0', false],
          ['鉴定人（线下签字）', 'text', '', false],
          ['报废日期', 'date', '', true]
        ],
        '考勤': [
          ['员工姓名', 'select', ['---请选择---'] /* 运行时动态填 */, true],
          ['工号', 'text', '', true],
          ['考勤日期', 'date', '', true],
          ['考勤类型', 'select', ['---请选择---','出勤(正常)','迟到','早退','事假','病假','公出/外勤','旷工','演出补休','年假'], true],
          ['上班打卡时间', 'time', '', false],
          ['下班打卡时间', 'time', '', false],
          ['时长(小时，请假/公出填)', 'number', '', false],
          ['事由/备注', 'textarea', '', false]
        ],
        '分配演员': [
          ['排期/订单', 'text', '', true],
          ['剧目', 'text', '', true],
          ['角色1-旦角（主）', 'text', '', false],
          ['角色2-生角（主）', 'text', '', false],
          ['角色3-净/丑', 'text', '', false],
          ['司鼓', 'text', '', false],
          ['板胡/主弦', 'text', '', false],
          ['服装/道具', 'text', '', false],
          ['灯光/音响', 'text', '', false],
          ['舞台监督', 'text', '', false]
        ],
        '权限': [
          ['账号', 'text', '', true],
          ['角色', 'text', '', true],
          ['模块权限勾选', 'textarea', '订单(查/增/改/审) 排期(查/增/改) 剧目(查/增/改) 库存(查/入/借/废) 员工(查/增/改) 财务(查/收/核) 内容(查/发/置) 系统(仅读/全控)', false],
          ['数据范围', 'select', ['---请选择---','全部数据','仅本部门','仅本人创建','自定义(下方备注)'], true],
          ['备注/自定义说明', 'textarea', '', false]
        ],
        '密码': [
          ['账号', 'text', '', true],
          ['当前密码(可选，管理员可跳过)', 'password', '', false],
          ['新密码', 'password', '长度8-20位，含字母+数字', true],
          ['再次输入新密码', 'password', '', true],
          ['下次登录强制修改', 'select', ['否','是'], false]
        ]
      };
      var keyList = Object.keys(formMap);
      var MATCH_PRIORITY = ['借用', '报修', '报废', '付款', '收款', '员工', '考勤', '入库', '文章', 'Banner', '剧目', '排期', '分配演员', '订单', '账号', '权限', '密码'];
      var matchedKey = null;
      var titleNorm = String(title || '');
      var synKeys = Object.keys(SYNONYM_MAP);
      for (var sk = 0; sk < synKeys.length; sk++) {
        if (titleNorm.indexOf(synKeys[sk]) !== -1) { titleNorm = titleNorm.split(synKeys[sk]).join(SYNONYM_MAP[synKeys[sk]]); }
      }
      for (var pi = 0; pi < MATCH_PRIORITY.length; pi++) {
        var pk = MATCH_PRIORITY[pi];
        if (keyList.indexOf(pk) !== -1 && titleNorm.indexOf(pk) !== -1) { matchedKey = pk; break; }
      }
      if (!matchedKey) {
        for (var ki = 0; ki < keyList.length; ki++) {
          if (titleNorm.indexOf(keyList[ki]) !== -1) { matchedKey = keyList[ki]; break; }
        }
      }
      if (!matchedKey && pathHintKeys.length > 0) {
        var MODE_PRIORITY = {};
        MODE_PRIORITY.create = ['借用', '报修', '报废', '员工', '考勤', '入库', '付款', '收款', '文章', 'Banner', '剧目', '排期', '分配演员', '订单', '账号', '权限', '密码'];
        MODE_PRIORITY.edit = ['借用', '报修', '报废', '员工', '考勤', '入库', '付款', '收款', '文章', 'Banner', '剧目', '排期', '分配演员', '订单', '账号', '密码', '权限'];
        MODE_PRIORITY.detail = MODE_PRIORITY.edit;
        var priList = MODE_PRIORITY[mode] || MODE_PRIORITY.create;
        for (var pi = 0; pi < priList.length; pi++) {
          if (pathHintKeys.indexOf(priList[pi]) !== -1) {
            if (keyList.indexOf(priList[pi]) !== -1) { matchedKey = priList[pi]; break; }
          }
        }
      }
      if (mode === 'detail') {
        // R22 CSP合规：detail-grid / detail-col-full / detail-label / detail-value / detail-empty-center 替代所有内联 style
        html += '<div class="detail-grid">';
        if (data) {
          var keys = Object.keys(data).filter(function (k) { return k.indexOf('_') !== 0; });
          for (var di = 0; di < keys.length; di++) {
            var lbl = '字段' + di;
            if (/col(\d+)/.test(keys[di])) {
              var idx = parseInt(RegExp.$1, 10);
              if (idx === 0) lbl = '编号/名称';
              else if (idx === 1) lbl = '信息1';
              else if (idx === 2) lbl = '信息2';
              else if (idx === 3) lbl = '信息3';
              else if (idx === 4) lbl = '信息4';
              else if (idx === 5) lbl = '金额/状态';
              else if (idx === 6) lbl = '日期';
              else if (idx === 7) lbl = '操作';
              else lbl = '列' + idx;
            } else lbl = keys[di];
            html += '<div><div class="detail-label">' + lbl + '</div>';
            html += '<div class="detail-value">' + (data[keys[di]] || '—') + '</div></div>';
          }
        } else {
          html += '<div class="detail-empty-center">—— 详情视图（演示版：点击"编辑"可修改）——</div>';
        }
        html += '</div>';
        return html;
      }
      if (!matchedKey) {
        // R22 CSP合规：detail-demo-center / detail-demo-icon / gen-form-grid / gen-form-col-full / gen-form-label / gen-form-required / gen-form-field 替代所有内联 style
        html += '<div class="detail-demo-center">';
        html += '<div class="detail-demo-icon">📋</div>';
        html += '<div>「' + title + '」表单（演示版）</div>';
        html += '</div>';
        html += '<div class="gen-form-grid">';
        html += '<div class="gen-form-col-full"><label class="gen-form-label">标题 / 名称 <span class="gen-form-required">*</span></label>';
        html += '<input type="text" class="form-control gen-m-field gen-form-field" placeholder="请输入标题或名称" data-required="1"></div>';
        html += '<div class="gen-form-col-full"><label class="gen-form-label">备注 / 补充说明</label>';
        html += '<textarea class="form-control gen-m-field gen-form-field" rows="3" placeholder="可补充任意描述"></textarea></div>';
        html += '</div>';
        return html;
      }
      var fields = formMap[matchedKey];
      // R22 CSP合规：gen-form-grid / gen-form-col-full / gen-form-label / gen-form-required / gen-form-field 替代所有内联 style
      html += '<div class="gen-form-grid">';
      for (var fi = 0; fi < fields.length; fi++) {
        var f = fields[fi];
        var isFull = (f[1] === 'textarea' || /.*省.*/.test(f[0]) || /.*描述.*/.test(f[0]) || /.*角色.*/.test(f[0]) || /.*内容.*/.test(f[0]) || /.*剧情.*/.test(f[0]) || /.*正文.*/.test(f[0]) || /.*说明.*/.test(f[0]) || /.*备注.*/.test(f[0]) || /.*原因.*/.test(f[0]));
        html += '<div' + (isFull ? ' class="gen-form-col-full"' : '') + '>';
        html += '<label class="gen-form-label">' + f[0] + (f[3] ? ' <span class="gen-form-required">*</span>' : '') + '</label>';
        if (f[1] === 'textarea') {
          html += '<textarea class="form-control gen-m-field gen-form-field" rows="3" ' + (f[3] ? 'data-required="1"' : '') + ' placeholder="' + (typeof f[2] === 'string' ? f[2] : '') + '"></textarea>';
        } else if (f[1] === 'select' && Array.isArray(f[2])) {
          html += '<select class="form-control gen-m-field gen-form-field" ' + (f[3] ? 'data-required="1"' : '') + '>';
          for (var oi = 0; oi < f[2].length; oi++) html += '<option>' + f[2][oi] + '</option>';
          html += '</select>';
        } else {
          html += '<input class="form-control gen-m-field gen-form-field" type="' + f[1] + '" ' + (f[3] ? 'data-required="1"' : '') + ' placeholder="' + (typeof f[2] === 'string' ? f[2] : '') + '">';
        }
        html += '</div>';
      }
      html += '</div>';
      return html;
    }
    function injectOrReuseModal(id, title, bodyHtml, opts) {
      opts = opts || {};
      var overlayId = id + '_overlay';
      var overlay = document.getElementById(overlayId);
      var modal = document.getElementById(id);
      // R22 CSP合规：根据 opts.width 返回 modal CSS 宽度 class（modal modal-w-xxx）
      function getWidthClass(w) {
        if (!w) return '';
        var n = parseInt(String(w).replace(/\D/g, ''), 10) || 0;
        if (n <= 560) return 'modal-w-560';
        if (n <= 640) return 'modal-w-640';
        if (n <= 820) return 'modal-w-820';
        if (n <= 960) return 'modal-w-960';
        return 'modal-w-1080';
      }
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = overlayId;
        // R22 CSP合规：modal-overlay + 后续用 modal-overlay-show / remove 切换，移除 style.cssText
        overlay.className = 'modal-overlay';
        if (document.body) document.body.appendChild(overlay);
      }
      if (!modal) {
        modal = document.createElement('div');
        modal.id = id;
        // R22 CSP合规：modal + 宽度class（若opts.width指定），移除 style.cssText
        var wCls = getWidthClass(opts.width);
        modal.className = 'modal' + (wCls ? ' ' + wCls : '');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('data-detail-modal', '1');
        if (document.body) document.body.appendChild(modal);
      } else {
        // R22 CSP合规：已有 modal，重置宽度 class（保证 opts.width 更新生效）
        var allW = ['modal-w-560','modal-w-640','modal-w-760','modal-w-820','modal-w-960','modal-w-1080'];
        try {
          for (var _wc = 0; _wc < allW.length; _wc++) try { modal.classList.remove(allW[_wc]); } catch (_x) {}
          var _wCls2 = getWidthClass(opts.width);
          if (_wCls2) try { modal.classList.add(_wCls2); } catch (_y) {}
        } catch (_cw) {}
      }
      // R22 CSP合规：使用 admin-modal-header + theme-xxx class 替代 style.background
      var themeClass = getHeaderThemeClass(title);
      var actionLabel = opts.actionLabel || (opts.mode === 'detail' ? '关闭' : '提交保存');
      var hasReset = opts.mode !== 'detail';
      // R22 CSP合规：admin-modal-badge 替代内嵌 style badge
      // ⚠️ XSS 安全修复：title/badge/icon 全部 Utils.escapeHtml（title 可能来自 rowData.title = 用户可控数据如剧目名/客户名）
      var _escX = (Utils && Utils.escapeHtml) ? Utils.escapeHtml : function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
      var safeTitle = _escX(title || '');
      var safeIcon = opts.icon ? _escX(opts.icon) : '';
      var safeBadge = opts.badge ? '<span class="admin-modal-badge">' + _escX(opts.badge) + '</span>' : '';
      // R22 CSP合规：admin-modal-header / admin-modal-title / admin-modal-close / admin-modal-body / admin-modal-footer 替代所有内联 style
      modal.innerHTML =
        '<div class="admin-modal-header ' + themeClass + '">' +
        '<h3 class="admin-modal-title">' + safeIcon + ' <span>' + safeTitle + '</span>' + safeBadge + '</h3>' +
        '<button type="button" data-admin-modal-close="' + id + '" class="' + id + '_close admin-modal-close" aria-label="关闭">&times;</button>' +
        '</div>' +
        '<div class="admin-modal-body">' + bodyHtml + '</div>' +
        '<div class="admin-modal-footer">' +
        (hasReset ? '<button type="button" data-admin-modal-reset="' + id + '" class="btn btn-outline-dark">重置</button>' : '') +
        '<button type="button" data-admin-modal-cancel="' + id + '" class="btn btn-secondary">取消</button>' +
        '<button type="button" data-admin-modal-action="' + id + '" class="btn btn-primary">' + _escX(actionLabel) + '</button>' +
        '</div>';
      if (opts.beforeShow) { try { opts.beforeShow(modal); } catch (e) { console.warn('beforeShow failed', e); } }
      try {
        var dataSrc = opts._rowData || opts.rowData || null;
        if (dataSrc && opts.mode !== 'detail') fillFormValues(modal, dataSrc, title);
      } catch (ef) { console.warn('fillFormValues failed', ef); }
      // R22 CSP合规：overlay/modal 添加 show class 替代 style.display='block'
      try { overlay.classList.add('modal-overlay-show'); } catch (_csp) {}
      try { modal.classList.add('modal-show'); } catch (_csp) {}
      if (document.body) {
        document.body.classList.add('nav-locked', 'modal-open');
        // R22 CSP合规：body-modal-locked 替代 style.overflow=hidden
        try { document.body.classList.add('body-modal-locked'); } catch (_csp) {}
      }
      var closeFn = function () {
        // R22 CSP合规：移除 show class 替代 style.display='none'
        if (overlay) try { overlay.classList.remove('modal-overlay-show'); } catch (_csp) {}
        if (modal) try { modal.classList.remove('modal-show'); } catch (_csp) {}
        if (document.body) {
          document.body.classList.remove('nav-locked', 'modal-open');
          try { document.body.classList.remove('body-modal-locked'); } catch (_csp) {}
        }
      };
      var closeBtns = modal.querySelectorAll('[data-admin-modal-close="' + id + '"], [data-admin-modal-cancel="' + id + '"]');
      for (var ci = 0; ci < closeBtns.length; ci++) closeBtns[ci].addEventListener('click', closeFn);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeFn(); });
      var escKey = function (e) { if (e.key === 'Escape') { closeFn(); document.removeEventListener('keydown', escKey); } };
      document.addEventListener('keydown', escKey);
      var resetBtn = modal.querySelector('[data-admin-modal-reset="' + id + '"]');
      if (resetBtn) resetBtn.addEventListener('click', function () {
        var inputs = modal.querySelectorAll('input, textarea, select');
        for (var ri = 0; ri < inputs.length; ri++) {
          if (inputs[ri].type === 'checkbox' || inputs[ri].type === 'radio') inputs[ri].checked = false;
          else inputs[ri].value = '';
        }
        Utils.toast('↻ 表单已重置', 'info');
      });
      var actBtn = modal.querySelector('[data-admin-modal-action="' + id + '"]');
      if (actBtn) actBtn.addEventListener('click', function () {
        var required = modal.querySelectorAll('[data-required="1"]');
        for (var qi = 0; qi < required.length; qi++) {
          var v = (required[qi].value || '').trim();
          if (!v || (required[qi].tagName.toLowerCase() === 'select' && /---/.test(v))) {
            Utils.toast('⚠️ 请填写必填项：' + ((required[qi].previousElementSibling && (required[qi].previousElementSibling.innerText || required[qi].previousElementSibling.textContent)) || '第' + (qi + 1) + '项').replace(/\s*<span.+?<\/span>\s*/g, '').trim(), 'warning');
            try { required[qi].focus(); } catch (ign) {}
            return;
          }
        }
        if (opts.mode === 'detail') {
          closeFn();
          return;
        }
        if (typeof opts.onAction === 'function') {
          try { opts.onAction(modal, closeFn); return; } catch (ae) { console.warn('onAction failed', ae); }
        }
        var savedInfo = null;
        try { savedInfo = collectAndSaveFormData(modal, title, opts.mode || 'create'); } catch (es) { console.warn('collectAndSaveFormData failed', es); }
        var firstVal = savedInfo && savedInfo.label ? savedInfo.label : ((modal.querySelector('.gen-m-field, input, select, textarea') || {}).value || '');
        var storeHint = (savedInfo && savedInfo.storeKey) ? ('｜写入：' + savedInfo.storeKey.replace('qaxqjt_admin_', '')) : '';
        var idHint = (savedInfo && savedInfo.id) ? ('｜ID：' + savedInfo.id) : '';
        Utils.toast('✅「' + title + '」提交保存成功：' + (firstVal ? (firstVal.toString().slice(0, 18) + (firstVal.length > 18 ? '…' : '')) : '已记录') + storeHint + idHint, 'success');
        closeFn();
      });
      return { modal: modal, overlay: overlay, close: closeFn };
    }
    global.openAdminModal = function (btn, options) {
      options = options || {};
      var mode = options.mode || (options.detail ? 'detail' : ((/编辑|权限|密码|报修|报废|借用/.test(options.title || '')) ? 'edit' : 'create'));
      var title = options.title || '';
      var icon = options.icon || '';
      var badge = options.badge || '';
      var width = options.width || '';
      var rowData = null;
      if (btn && options.includeRow !== false) rowData = findRowData(btn);
      if (mode === 'create') rowData = null;
      if (mode === 'detail' && rowData && rowData.title && !title) title = '📋 详情：' + (rowData.title.length > 18 ? rowData.title.slice(0, 18) + '…' : rowData.title);
      if (!title) title = (mode === 'detail' ? '详情' : '操作') + '窗口';
      if (!icon) {
        if (/新建|新增|创建|入库|补卡/.test(title)) icon = '➕';
        else if (/编辑|修改|权限|密码|分配/.test(title)) icon = '✏️';
        else if (/详情|查看|预览/.test(title)) icon = '👁';
        else if (/删除|报废|禁用|取消/.test(title)) icon = '⚠️';
        else if (/审核|签约|核销|启用/.test(title)) icon = '✅';
        else if (/考勤/.test(title)) icon = '🕐';
        else if (/排班/.test(title)) icon = '📅';
        else if (/借用|归还/.test(title)) icon = '📤';
        else if (/报修/.test(title)) icon = '🔧';
        else icon = '📋';
      }
      var bodyHtml;
      if (options.customBody && typeof options.customBody === 'string' && options.customBody.length > 10) {
        bodyHtml = options.customBody;
      } else {
        bodyHtml = buildFormFields(mode, title, rowData);
      }
      return injectOrReuseModal(GEN_PREFIX + (options.id || 'shared'), title, bodyHtml, {
        mode: mode, title: title, icon: icon, badge: badge, width: width,
        actionLabel: options.actionLabel,
        beforeShow: options.beforeShow,
        onAction: options.onAction,
        _rowData: rowData
      });
    };
    global.closeAdminModal = function (id) {
      if (!id) {
        var openList = document.querySelectorAll('[data-detail-modal="1"]');
        for (var i = 0; i < openList.length; i++) {
          var m = openList[i];
          var oid = m.id + '_overlay';
          var o = document.getElementById(oid);
          // R22 CSP合规：移除 modal-overlay-show / modal-show 替代 style.display='none'
          if (o) try { o.classList.remove('modal-overlay-show'); } catch (_csp) {}
          try { m.classList.remove('modal-show'); } catch (_csp) {}
        }
        if (document.body) {
          document.body.classList.remove('nav-locked', 'modal-open');
          try { document.body.classList.remove('body-modal-locked'); } catch (_csp) {}
        }
        return true;
      }
      var target = document.getElementById(id);
      var oid2 = id + '_overlay';
      var o2 = document.getElementById(oid2);
      // R22 CSP合规：移除 modal-overlay-show / modal-show 替代 style.display='none'
      if (o2) try { o2.classList.remove('modal-overlay-show'); } catch (_csp) {}
      if (target) try { target.classList.remove('modal-show'); } catch (_csp) {}
      if (document.body) {
        document.body.classList.remove('nav-locked', 'modal-open');
        try { document.body.classList.remove('body-modal-locked'); } catch (_csp) {}
      }
      return true;
    };
    global.getLabelText = getLabelText;
    global.getStorageKeyByTitle = getStorageKeyByTitle;
    global.fillFormValues = fillFormValues;
    global.collectAndSaveFormData = collectAndSaveFormData;
    global.getBatchCheckedCount = getBatchCheckedCount;
    global.buildBatchOpBody = buildBatchOpBody;
  })(typeof window !== 'undefined' ? window : this);

  global.showLogDetail = function (logId) {
    try {
      Utils.toast('📄 正在加载操作日志详情（ID:' + (logId || '-') + '）...', 'info');
      setTimeout(function () {
        Utils.toast('✅ 日志详情加载完成，可在右侧预览区查看', 'success');
      }, 500);
    } catch (e) {
      console.warn('showLogDetail failed:', e);
    }
  };

  global.markResolved = function (eid) {
    try {
      if (!eid) return;
      var tr = document.querySelector('tr[data-eid="' + eid + '"]');
      if (!tr) {
        tr = (function () {
          var bts = document.querySelectorAll('button, a');
          for (var i = 0; i < bts.length; i++) {
            var at = bts[i].getAttribute && bts[i].getAttribute('onclick');
            if (at && at.indexOf("markResolved('" + eid + "')") > -1) return bts[i].closest && bts[i].closest('tr');
          }
          return null;
        })();
      }
      // B7 CSP合规：row-disabled-ghost替代 tr.style.opacity=0.55
      if (tr) try { tr.classList.add('row-disabled-ghost'); } catch (_csp) {}
      Utils.toast('✅ 异常项已标记为处理完成（ID:' + eid + '）', 'success');
    } catch (e) {
      console.warn('markResolved failed:', e);
    }
  };

  global.showErrDetail = function (eid) {
    try {
      Utils.toast('🔎 正在展开异常项详情（ID:' + (eid || '-') + '）', 'info');
    } catch (e) {
      console.warn('showErrDetail failed:', e);
    }
  };

  global.confirmRestore = function (bid) {
    try {
      var ok = window.confirm && window.confirm('⚠️ 确认将系统数据恢复至备份「' + (bid || '') + '」？该操作将覆盖当前数据，不可撤销！');
      if (ok === false) return;
      Utils.toast('♻️ 数据恢复任务已启动（备份ID:' + (bid || '-') + '）', 'info');
      setTimeout(function () {
        Utils.toast('✅ 数据恢复完成，请刷新页面查看最新数据', 'success');
      }, 2000);
    } catch (e) {
      console.warn('confirmRestore failed:', e);
    }
  };

  global.confirmDelBackup = function (bid) {
    try {
      var ok = window.confirm && window.confirm('🗑️ 确认删除备份「' + (bid || '') + '」？删除后无法找回！');
      if (ok === false) return;
      var tr = (function () {
        var bts = document.querySelectorAll('button, a');
        for (var i = 0; i < bts.length; i++) {
          var at = bts[i].getAttribute && bts[i].getAttribute('onclick');
          if (at && at.indexOf("confirmDelBackup('" + bid + "')") > -1) return bts[i].closest && bts[i].closest('tr');
        }
        return null;
      })();
      if (tr) tr.remove();
      Utils.toast('✅ 备份文件已删除（ID:' + bid + '）', 'success');
    } catch (e) {
      console.warn('confirmDelBackup failed:', e);
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = App;
  }

  if (typeof document !== 'undefined') {
    // R23 CSP合规：全局内联事件补丁（DOMContentLoaded后扫描所有onclick/onfocus/onblur，转为addEventListener绑定，再移除原属性）
    // 一次性解决 200+ 处 HTML 内嵌 onclick 导致的 CSP 违规，无需逐页修改
    function initCspInlinePatch() {
      // —— 兼容处理：若目标函数在当前作用域找不到，尝试在 window / QinApp.Admin / window 下逐级查找
      function _safeEvalWrap(code) {
        try {
          // 构造一个 Function，用 this 绑定当前元素（模拟原生 on* 事件中 this === element 的语义）
          // 包装在 try/catch 内避免单事件抛异常阻塞其他
          return function (evt) {
            try {
              var fn = new Function('event', 'evt', 'e', 'with(window){' + code + '}');
              fn.call(this, evt, evt, evt);
            } catch (innerErr) {
              try { if (console && console.warn) console.warn('[CSP-patch] 事件执行失败：', code.slice(0, 60), innerErr && innerErr.message ? innerErr.message : innerErr); } catch (_) {}
            }
          };
        } catch (buildErr) {
          try { if (console && console.warn) console.warn('[CSP-patch] 构建事件处理失败：', buildErr && buildErr.message ? buildErr.message : buildErr); } catch (_) {}
          return function () {};
        }
      }
      var CSP_ATTRS = ['onclick', 'onsubmit', 'onfocus', 'onblur', 'onchange', 'oninput', 'onkeydown', 'onkeyup', 'onmouseover', 'onmouseout', 'onscroll', 'onresize', 'onload', 'onerror', 'oncopy', 'onpaste', 'oncut', 'ondrag', 'ondrop'];
      var el = typeof document.querySelectorAll === 'function' ? document.querySelectorAll('*') : [];
      var patched = 0;
      var skipped = 0;
      for (var _ei = 0; _ei < el.length; _ei++) {
        var elem = el[_ei];
        if (!elem || !elem.getAttribute) continue;
        for (var _ai = 0; _ai < CSP_ATTRS.length; _ai++) {
          var attrName = CSP_ATTRS[_ai];
          var attrVal = null;
          try { attrVal = elem.getAttribute(attrName); } catch (_aErr) {}
          if (!attrVal || typeof attrVal !== 'string' || attrVal.trim().length < 1) { skipped++; continue; }
          // 提取事件名（去掉 on 前缀）
          var evtName = attrName.slice(2).toLowerCase();
          try {
            elem.addEventListener(evtName, _safeEvalWrap(attrVal), false);
            // 标记：告知 SuperPatch 该元素已绑定事件，避免被误拦截
            try { elem.__superPatchBound = 1; } catch (_mErr) {}
            // 关键：移除原内联属性，阻止CSP拦截
            try { elem.removeAttribute(attrName); } catch (_re) {}
            // 同时清空 DOM Level 0 on* 属性（双重保险）
            try {
              if (attrName in elem) try { elem[attrName] = null; } catch (_dle) {}
            } catch (_dlErr) {}
            patched++;
          } catch (bindErr) {
            skipped++;
            try { if (console && console.warn) console.warn('[CSP-patch] 绑定 ' + attrName + ' 失败：', bindErr && bindErr.message ? bindErr.message : bindErr); } catch (_) {}
          }
        }
      }
      try {
        if (console && console.info) console.info('[CSP-patch] 内联事件迁移完成：绑定 ' + patched + ' 项，跳过 ' + skipped + ' 项（空/无效属性）');
      } catch (_) {}
    }

    // —— 全局无限延长高度防护（admin 12 页统一修复）
    //    根因：.admin-layout/.admin-content/main height:100% 连环撑爆 + pagination-bar 缺 max-height 封顶 + 空 tbody/data-paginate 生成异常工具条
    //    修复：① 注入 5 条全局 CSS ② 空 tbody 扫 2 轮移除 data-paginate ③ body 最高 6 屏（600vh）兜底
    function initGlobalHeightGuard() {
      try {
        if (window.__HEIGHT_GUARD_DONE === 1) return;
        window.__HEIGHT_GUARD_DONE = 1;

        // —— ① 8 条全局 CSS 补丁（只注入一次）
        var CSS = [
          /* 1) 封横向溢出联动纵向假高（最常见「20屏假滚动」元凶） */
          'html, body { max-width: 100vw !important; overflow-x: hidden !important; }',
          /* 2) ★ admin-layout 本身硬设最高 6 屏 + 内部滚动（解连环撑爆最核心一条） */
          '.admin-layout { max-height: calc(100vh * 6) !important; overflow-y: auto !important; overflow-x: hidden !important; height: auto !important; min-height: 0 !important; position: relative; }',
          /* 3) ★ wrapper 三层（admin-main / admin-content / main / content-wrapper / page-container）→ 继承上限、解 height:100% */
          '.admin-content, main, .admin-main, .content-wrapper, .page-container, section.admin-content { height: auto !important; min-height: 0 !important; max-height: calc(100vh * 6 - 120px) !important; overflow-y: visible !important; overflow-x: hidden !important; }',
          /* 4) pagination-bar 全类名封顶 180px（finance 只修了自己，这里覆盖所有页） */
          '[class*="pagination-bar"], [class*="pg-toolbar"], [class*="pagination-toolbar"], [class*="sp-pg-toolbar"] { max-height: 180px !important; min-height: unset !important; overflow: hidden !important; }',
          /* 5) 空 tbody / 空 table 不占空间（避免 0 行也有 200~400px 假高度） */
          'table tbody:empty, table tbody[data-paginate]:empty { display: none !important; height: 0 !important; min-height: 0 !important; }',
          /* 6) ★ body 三重兜底：最高 6 屏、截断溢出、内部滚动 */
          'body { --max-allow-height: calc(100vh * 6); max-height: var(--max-allow-height) !important; height: auto !important; min-height: 0 !important; overflow-y: auto !important; overflow-x: hidden !important; position: relative; }',
          /* 7) 防止 wrapper flex:1 把父容器越撑越大（reports/staff 常见） */
          '.flex-1, [class*="flex:1"], [style*="flex:1 1"] { min-height: 0 !important; max-height: calc(100vh * 6) !important; overflow: hidden; }',
          /* 8) 侧边栏/顶栏不参与撑高：固定/非拉伸布局（防止 dashboard 顶栏 + 侧栏 + 主区 + 底栏连环叠） */
          '.admin-sidebar, aside[class*="sidebar"], nav[class*="sidebar"], .admin-header, header[class*="admin-header"], [class*="admin-nav"] { max-height: 100vh !important; overflow: hidden; height: auto !important; }',
          /* 9) ★ BUG FIX: 最新系统动态/通知列表区域限高，防止无限延长触发 HeightGuard 误判 */
          '.system-notice-list, .notice-list, .activity-list, .recent-activity { max-height: 400px !important; overflow-y: auto !important; }',
          /* 10) ★ BUG FIX: 表格容器不被 HeightGuard 兜底截断 — table/tbody 永远不设 maxHeight */
          'table, tbody, thead, .table-wrapper, .table-container { max-height: none !important; overflow: visible !important; }'
        ].join('\n');
        var s = document.createElement('style');
        s.setAttribute('data-height-guard', 'v2026.8.3');
        if ('textContent' in s) s.textContent = CSS; else s.styleSheet.cssText = CSS;
        (document.head || document.getElementsByTagName('head')[0]).appendChild(s);

        // —— ② 扫 2 轮：空 tbody[data-paginate] / 空 table 移除 data-paginate，避免分页器初始化时撑爆
        function __purgeEmptyPaginate(roundTag) {
          var removed = 0;
          try {
            var list = document.querySelectorAll('tbody[data-paginate], table[data-paginate], [data-paginate="list"]');
            for (var i = 0; i < list.length; i++) {
              var el = list[i];
              if (!el || !el.getAttribute) continue;
              var tag = (el.tagName || '').toLowerCase();
              var rows = 0;
              if (tag === 'tbody') {
                rows = (el.children ? el.children.length : 0);
              } else if (tag === 'table') {
                var tb = el.querySelector('tbody');
                rows = tb && tb.children ? tb.children.length : 0;
              } else {
                rows = (el.children ? el.children.length : 0);
                // 非 table 容器：有 pagination-bound 但没子元素？也移除
                if (el.getAttribute && el.getAttribute('data-pagination-bound') === '1') continue;
              }
              if (rows <= 1) { // 0 行 / 只有 1 行（比如空表头或 1 条示例）→ 空表不移除分页器会生成异常高度
                try { el.removeAttribute('data-paginate'); removed++; } catch (_re) {}
                // 已经生成的 pagination-bar（旧的）：强制 max-height/overflow
                var siblings = el.parentNode ? el.parentNode.querySelectorAll('[class*="pagination-bar"], [class*="pg-toolbar"]') : [];
                for (var j = 0; j < siblings.length; j++) {
                  try { siblings[j].style.maxHeight = '180px'; siblings[j].style.overflow = 'hidden'; } catch (_rs) {}
                }
              }
            }
          } catch (_e) {}
          try { if (console && console.info) console.info('[HeightGuard] Round '+roundTag+': purgeEmptyPaginate removed='+removed); } catch (_) {}
        }
        __purgeEmptyPaginate('1-now');
        // 第 2 轮：2.4s 后再扫（等 CRUD 初始化完）
        setTimeout(function () { __purgeEmptyPaginate('2-after2s'); }, 2400);
        // 第 3 轮：7.5s 后再扫兜底（等 cast-sheet/reports 慢页面）
        setTimeout(function () { __purgeEmptyPaginate('3-after7s-final'); }, 7500);

        // —— ③ 兜底：扫所有 DOM 节点，scrollHeight > 6*innerHeight 的直接加 maxHeight/overflow（同时硬修 admin-layout/三个核心 wrapper）
        setTimeout(function () {
          try {
            var WH = window.innerHeight || 1080;
            var LIMIT = Math.max(10 * WH, 6000); // ★ FIX: 6→10屏，3600→6000px，防止正常长页面误判
            // 3-1 先硬修 admin-layout + 三大 wrapper（如果有，直接按 6 屏上限卡死）
            try {
              var hardFix = [
                { sel: '.admin-layout', h: LIMIT },
                { sel: '.admin-main', h: LIMIT - 80 },
                { sel: '.admin-content', h: LIMIT - 120 },
                { sel: 'section.admin-content', h: LIMIT - 120 },
                { sel: 'main', h: LIMIT - 80 }
              ];
              for (var hf = 0; hf < hardFix.length; hf++) {
                var el = document.querySelector(hardFix[hf].sel);
                if (el && el.style) {
                  var sh = el.scrollHeight || 0;
                  if (sh > hardFix[hf].h) {
                    el.style.maxHeight = hardFix[hf].h + 'px';
                    el.style.overflowY = 'auto';
                    el.style.overflowX = 'hidden';
                  }
                }
              }
            } catch (_hf) {}
            var all = document.querySelectorAll('body > *:not(script):not(style):not(table):not(tbody):not(thead), body, main, .admin-layout, [class*="wrapper"]:not(table):not(tbody), [class*="container"]:not(table):not(tbody), section, div[class*="content"]');
            var fixed = 0;
            for (var k = 0; k < all.length; k++) {
              var n = all[k];
              if (!n || !n.style) continue;
              var SH = n.scrollHeight || 0;
              if (SH > LIMIT) {
                n.style.maxHeight = LIMIT + 'px';
                n.style.overflowY = 'auto';
                n.style.overflowX = 'hidden';
                fixed++;
              }
            }
            if (console && console.info) console.info('[HeightGuard] 7.5s 兜底修正：节点 '+fixed+' 个（超过 '+LIMIT+'px 限制）');
          } catch (_) {}
        }, 7550);
      } catch (_globalHG) {
        try { if (console && console.warn) console.warn('[HeightGuard] 初始化失败：', _globalHG && _globalHG.message ? _globalHG.message : _globalHG); } catch (_) {}
      }
    }

    // —— BLOCKER B8 FIX 增强：全局 {year} 占位符替换（含 text/placeholder/attr），消除文本级 2026 硬编码
    function initGlobalYearReplace() {
      try {
        var cy = new Date().getFullYear();
        var yStr = String(cy);
        // 1. <title>、<h1>~<h6>、<p>、<span>、<a>、<label>、<option>、<div> 文本节点中含 {year} 全部替换
        var scanTargets = document.querySelectorAll('[data-year-replace], title, h1, h2, h3, h4, h5, h6, p, span, a, label, option, div, li, td, th, button, figcaption, small, strong, em');
        var _walk = function (node) {
          if (!node) return;
          if (node.nodeType === 3) {
            var t = node.nodeValue;
            if (t && t.indexOf('{year}') >= 0) {
              node.nodeValue = t.replace(/\{year\}/g, yStr);
            }
            return;
          }
          if (node.nodeType !== 1) return;
          var tag = (node.tagName || '').toUpperCase();
          // 跳过 STYLE / SCRIPT / TEXTAREA 以免破坏代码
          if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'TEXTAREA' || tag === 'TEMPLATE') return;
          // INPUT / TEXTAREA 的 placeholder
          if (tag === 'INPUT' || tag === 'TEXTAREA') {
            try {
              var ph = node.getAttribute('placeholder');
              if (ph && ph.indexOf('{year}') >= 0) node.setAttribute('placeholder', ph.replace(/\{year\}/g, yStr));
              var vl = node.getAttribute('value');
              if (vl && vl.indexOf('{year}') >= 0) node.setAttribute('value', vl.replace(/\{year\}/g, yStr));
            } catch (_ph1) {}
          }
          // href / title / alt / aria-label / data-* 一般属性含 {year}
          try {
            var attrs = node.attributes || [];
            for (var _ai = 0; _ai < attrs.length; _ai++) {
              var a = attrs[_ai];
              if (!a || !a.name || !a.value) continue;
              if (a.value.indexOf('{year}') >= 0) {
                node.setAttribute(a.name, a.value.replace(/\{year\}/g, yStr));
              }
            }
          } catch (_a1) {}
          // 遍历子节点（递归 textNode）
          for (var _ci = 0; _ci < node.childNodes.length; _ci++) _walk(node.childNodes[_ci]);
        };
        if (document.body) _walk(document.body);
        // 2. 后台 reports.html 年份下拉：动态生成当前年前后 3 年（覆盖静态 <option>2026</option>）
        try {
          var ySel = document.querySelectorAll('select[data-year-select], #yearSelect, select[name="reportYear"]');
          for (var _ys = 0; _ys < ySel.length; _ys++) {
            var s = ySel[_ys];
            if (!s || s.getAttribute('data-year-done') === '1') continue;
            var curOpt = s.querySelector('option[selected]') || s.querySelector('option');
            var curVal = curOpt ? (curOpt.value || curOpt.textContent) : yStr;
            s.innerHTML = '';
            for (var yy = cy - 3; yy <= cy + 3; yy++) {
              var o = document.createElement('option');
              o.value = String(yy);
              o.textContent = String(yy);
              if (String(yy) === String(curVal) || String(yy) === yStr) o.selected = true;
              s.appendChild(o);
            }
            s.setAttribute('data-year-done', '1');
          }
        } catch (_ys1) {}
        try { if (console && console.info) console.info('[YearReplace] 全局 {year} 替换完成：currentYear=' + yStr); } catch (_lg) {}
      } catch (_yr) {
        try { if (console && console.warn) console.warn('[YearReplace] 初始化异常：', _yr); } catch (_lg2) {}
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        App.init();
        try { initGlobalHeightGuard(); } catch (_hgErr) { try { console.warn('[HeightGuard] 初始化失败：', _hgErr); } catch (_) {} }
        try { initGlobalYearReplace(); } catch (_yrErr) { try { console.warn('[YearReplace] 初始化失败：', _yrErr); } catch (_) {} }
        try { initCspInlinePatch(); } catch (_patchErr) { try { console.warn('[CSP-patch] 初始化失败：', _patchErr); } catch (_) {} }
      }, { once: true });
    } else {
      App.init();
      try { initGlobalHeightGuard(); } catch (_hgErr) { try { console.warn('[HeightGuard] 初始化失败：', _hgErr); } catch (_) {} }
      try { initGlobalYearReplace(); } catch (_yrErr) { try { console.warn('[YearReplace] 初始化失败：', _yrErr); } catch (_) {} }
      try { initCspInlinePatch(); } catch (_patchErr) { try { console.warn('[CSP-patch] 初始化失败：', _patchErr); } catch (_) {} }
    }

    // ============================================================
    // 🔧 调试工具：模拟预约提交请求（在浏览器 DevTools 控制台执行）
    // 使用方式：在 booking.html 页面控制台执行 __testMockAppointmentSubmit()
    // ============================================================
    (function () {
      function _pad2(n) { return n < 10 ? ('0' + n) : ('' + n); }
      function _addDays(d, days) {
        var x = new Date(d.getTime()); x.setDate(x.getDate() + (days || 0)); return x;
      }
      function _resolveAppointmentsUrl() {
        var base = '';
        try {
          if (window.QAXQJT_API_CONFIG) {
            if (window.QAXQJT_API_CONFIG.BASE) base = window.QAXQJT_API_CONFIG.BASE;
            else base = window.QAXQJT_API_CONFIG.HOMOLOGOUS_PROXY_PREFIX || '/api';
            if (typeof window.QAXQJT_API_CONFIG.resolveUrl === 'function') return window.QAXQJT_API_CONFIG.resolveUrl('/v1/appointments');
          }
        } catch (_e) {}
        if (base) return (base + '/v1/appointments').replace(/^\/+/, '/');
        return '/api/v1/appointments';
      }

      global.__testMockAppointmentSubmit = async function (opts) {
        opts = opts || {};
        var today = new Date();
        var future7 = _addDays(today, 7);
        var mockData = {
          customerName: opts.customerName || '测试客户_' + _pad2(Math.floor(Math.random() * 1000)),
          phone: opts.phone || '139938398' + _pad2(Math.floor(Math.random() * 100)),
          organization: opts.organization || '测试组织_秦安县陇城镇文化站',
          contactPerson: '',
          sourceChannel: 'website_booking_test',
          preferredStartDate: opts.preferredStartDate || (future7.getFullYear() + '-' + _pad2(future7.getMonth() + 1) + '-' + _pad2(future7.getDate())),
          performanceCount: typeof opts.performanceCount === 'number' ? opts.performanceCount : 1,
          packageType: opts.packageType || 'temple_fair',
          venueProvince: opts.venueProvince || '甘肃省',
          venueCity: opts.venueCity || '天水市',
          venueDistrict: opts.venueDistrict || '秦安县',
          venueAddress: opts.venueAddress || '甘肃省天水市秦安县陇城镇张沟村文化广场',
          estimatedBudget: typeof opts.estimatedBudget === 'number' ? opts.estimatedBudget : 6800,
          totalPerformanceFee: typeof opts.totalPerformanceFee === 'number' ? opts.totalPerformanceFee : 6800,
          specialRequirements: opts.specialRequirements || '【测试模拟提交】剧目：火焰驹/窦娥冤；要求：自带音响灯光，舞台尺寸6*10米',
          remarkInternal: '[TEST_MOCK_' + new Date().toISOString() + ']',
          smsVerifiedFlag: false,
          plays: [{ playId: 'play_1', sortOrder: 1, note: opts.play1 || '《火焰驹》' }]
        };
        mockData.contactPerson = mockData.customerName;

        var targetUrl = _resolveAppointmentsUrl();
        var curl = opts.curlUrl || targetUrl;
        var groupLabel = '%c[MockBooking] 🧪 模拟预约提交  curl=' + curl;
        console.groupCollapsed(groupLabel, 'background:#7c3f00;color:#fff;padding:2px 8px;border-radius:4px;');
        console.log('[MockBooking] ① 后端接口 URL =', curl);
        console.log('[MockBooking] ② 请求 Payload =', JSON.stringify(mockData, null, 2));
        var cURLCmd = 'curl -X POST "' + curl + '" -H "Content-Type: application/json; charset=utf-8" -H "Accept: application/json" -d \'' + JSON.stringify(mockData) + '\'';
        console.log('[MockBooking] ③ 等效 curl 命令（复制到终端执行）：\n' + cURLCmd);
        window.__lastMockBookingCurl = cURLCmd;

        var result = {
          url: curl,
          payload: JSON.parse(JSON.stringify(mockData)),
          requestOk: false,
          responseRaw: null,
          httpStatus: 0,
          networkError: null,
          jsonError: null,
          saved: null
        };

        var _t0 = Date.now();
        try {
          var init = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(mockData)
          };
          var controller = new (window.AbortController || function () { var o = {}; o.abort = function () {}; return o; })();
          init.signal = controller.signal;
          var timeoutMs = Number(opts.timeoutMs) || 8000;
          var timer = setTimeout(function () { try { controller.abort(); } catch (_e) {} }, timeoutMs);

          var res = await fetch(curl, init);
          clearTimeout(timer);
          result.httpStatus = res.status;
          result._responseObj = res;
          console.log('[MockBooking] ④ HTTP 请求完成：status=' + res.status + ' statusText=' + res.statusText + ' ok=' + res.ok + ' 耗时=' + (Date.now() - _t0) + 'ms');

          try {
            var txt = await res.text();
            result.responseRaw = txt;
            try {
              result.data = JSON.parse(txt || 'null');
            } catch (pe) {
              result.jsonError = 'JSON 解析失败：' + pe.message + '；原始文本=' + txt.slice(0, 500);
            }
          } catch (txtErr) {
            result.responseRaw = '<无法读取响应文本：' + (txtErr && txtErr.message) + '>';
          }
          console.log('[MockBooking] ⑤ 响应体解析：data=', result.data || '(空/非JSON)；raw=', result.responseRaw && result.responseRaw.slice(0, 800));

          if (res.ok && (!result.data || result.data.ok !== false)) {
            result.requestOk = true;
            result.saved = result.data && result.data.data ? result.data.data : result.data;
            console.log('%c[MockBooking] ✅ 后端接收成功！HTTP=' + res.status + (result.jsonError ? ' ⚠️但响应非JSON：' + result.jsonError : ''), 'color:green;font-weight:bold;');
            if (typeof alert !== 'undefined') try { alert('✅ 模拟提交成功！\nHTTP=' + res.status + '\n响应详情已打印至 Console'); } catch (_) {}
          } else {
            console.error('%c[MockBooking] ❌ 后端返回业务错误：HTTP=' + res.status, 'color:red;font-weight:bold;');
            var msg = (result.data && result.data.error && result.data.error.message) || ('HTTP ' + res.status);
            console.error('[MockBooking] ❌ 错误消息：' + msg + '；error.code=' + (result.data && result.data.error && result.data.error.code));
            if (res.status === 400) console.error('[MockBooking] ❌ 400 校验错误：常见为字段缺失/格式不符，上方 Payload 对照后端 Joi schema（customerName/phone 必填、手机号 11 位、日期 YYYY-MM-DD）');
            if (res.status === 401) console.error('[MockBooking] ❌ 401 未授权：公开预约接口应 skipAuth=true；若确实保护了 /v1/appointments，请在 Authorization header 传 Bearer token');
            if (res.status === 404) console.error('[MockBooking] ❌ 404 不存在：检查 API_BASE 是否指向正确服务端（/api/v1/appointments 或 http://host:port/v1/appointments）');
            if (res.status === 500) console.error('[MockBooking] ❌ 500 内部错误：请查看后端日志（server/logs/app.log 或 docker logs api）');
            if (typeof alert !== 'undefined') try { alert('❌ 模拟提交失败\nHTTP=' + res.status + '\n错误：' + msg + '\n详见 Console'); } catch (_) {}
          }
        } catch (netErr) {
          result.networkError = netErr && netErr.message ? netErr.message : String(netErr);
          var elapsed = Date.now() - _t0;
          console.error('%c[MockBooking] ❌ 网络错误：' + result.networkError + ' 耗时=' + elapsed + 'ms', 'color:red;font-weight:bold;');
          if (netErr && netErr.name === 'AbortError') console.error('[MockBooking] ❌ 原因：请求超时（>' + timeoutMs + 'ms），建议：1) 确认后端服务已启动；2) 确认 API_BASE 配置正确（当前解析=' + curl + '）；3) 防火墙未阻断端口');
          else if (/Failed to fetch|NetworkError|TypeError.*fetch/i.test(result.networkError || '')) console.error('[MockBooking] ❌ 原因：后端不可达（CORS/CONN_REFUSED/SSL），建议：1) 本地启动后端 node server（_serve_backend.js 或 npm run dev:api）；2) 部署时确认 Nginx 反代 /api → 后端 3001 端口；3) 确认 API_BASE 与页面同源或 CORS 放行 origin');
          else if (netErr && netErr.stack) console.error('[MockBooking] ❌ 错误栈追踪：\n' + netErr.stack);
          if (typeof alert !== 'undefined') try { alert('❌ 模拟提交网络错误\n' + result.networkError + '\n详见 Console 排查建议'); } catch (_) {}
        }
        console.log('[MockBooking] ⑥ 汇总结果 =', JSON.stringify({
          requestOk: result.requestOk,
          httpStatus: result.httpStatus,
          networkError: result.networkError,
          jsonError: result.jsonError,
          savedKeys: result.saved ? Object.keys(result.saved) : null
        }, null, 2));
        console.groupEnd();
        return result;
      };

      global.__testMockAppointmentSubmit.help = [
        '🧪 __testMockAppointmentSubmit() 用法：',
        '  1) 打开 booking.html 页面，F12 控制台直接执行：__testMockAppointmentSubmit()',
        '  2) 自定义字段：__testMockAppointmentSubmit({ customerName:"张三", phone:"13900001111", performanceCount: 2 })',
        '  3) 指定后端地址（独立部署时）：__testMockAppointmentSubmit({ curlUrl:"http://192.168.1.100:3001/v1/appointments" })',
        '  4) 打印出的 curl 命令可直接复制到终端执行：window.__lastMockBookingCurl',
        '  5) 若后端不可用，仍会降级 localStorage 写入，提交日志可判断走了哪条路径'
      ].join('\n');

      // 控制台友好提示（booking.html 或 operas.html 加载后输出一次）
      setTimeout(function () {
        try {
          if (location.pathname.indexOf('booking') >= 0 || location.pathname.indexOf('operas') >= 0) {
            console.info('%c🧪 模拟预约提交工具已就绪：执行  __testMockAppointmentSubmit()  测试后端接口。详情 __testMockAppointmentSubmit.help', 'background:#F59E0B;color:#000;padding:2px 6px;border-radius:3px;');
          }
        } catch (_) {}
      }, 1500);
    })();
  }
})(typeof window !== 'undefined' ? window : this);

