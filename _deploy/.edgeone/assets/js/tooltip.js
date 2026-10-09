/**
 * js/tooltip.js —— 全站统一悬停提示（Tooltip）组件 v20261010a
 * 自包含：自带样式注入，无需改 CSS；事件委托，兼容动态渲染内容。
 *
 * 行为：
 *  - 提示来源优先级：data-tip > title（title 会被转移到 data-tip，抑制浏览器原生提示）
 *  - 桌面端：悬停 350ms 后显示，移开/点击/滚动立即隐藏
 *  - 移动端：长按 500ms 显示，松手/滑动/点别处隐藏；不拦截正常点按
 *  - 位置：默认元素上方居中，空间不足自动翻转到下方，水平方向钳制在视口内
 *  - 跳过 [data-no-tip]；空提示不显示
 */
(function () {
  'use strict';
  if (window.__QAX_TIP_V1__) return;
  window.__QAX_TIP_V1__ = true;

  var SHOW_DELAY = 350;      // 桌面悬停延迟
  var LONG_PRESS = 500;      // 移动端长按时长
  var GAP = 8;               // 与目标元素间距
  var EDGE = 8;              // 距视口边缘最小距离

  /* ---------- 样式注入 ---------- */
  var css = ''
    + '.qax-tip{position:fixed;z-index:2147483000;max-width:260px;padding:7px 12px;'
    + 'background:rgba(40,24,12,.94);color:#fdf8ee;font-size:12px;line-height:1.55;'
    + 'border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25);pointer-events:none;'
    + 'opacity:0;transform:translateY(3px);transition:opacity .15s ease,transform .15s ease;'
    + 'word-break:break-word;text-align:center;font-family:"Microsoft YaHei","PingFang SC",sans-serif;}'
    + '.qax-tip.show{opacity:1;transform:translateY(0);}'
    + '.qax-tip::after{content:"";position:absolute;left:50%;margin-left:-5px;border:5px solid transparent;}'
    + '.qax-tip.below::after{top:-10px;border-bottom-color:rgba(40,24,12,.94);}'
    + '.qax-tip.above::after{bottom:-10px;border-top-color:rgba(40,24,12,.94);}';

  function injectStyle() {
    if (document.getElementById('qax-tip-style')) return;
    var st = document.createElement('style');
    st.id = 'qax-tip-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- 提示元素 ---------- */
  var tipEl = null;
  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'qax-tip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
    return tipEl;
  }

  /* ---------- title -> data-tip 转移（抑制原生提示） ---------- */
  function migrate(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.hasAttribute('data-no-tip')) { el.removeAttribute('title'); return; }
    var t = el.getAttribute('title');
    if (t && !el.getAttribute('data-tip')) el.setAttribute('data-tip', t);
    if (t) el.removeAttribute('title');
  }
  function migrateAll(root) {
    var list = root.querySelectorAll('[title]');
    for (var i = 0; i < list.length; i++) migrate(list[i]);
  }

  /* ---------- 查找触发元素 ---------- */
  /* 显式提示源 + 可交互元素（自动派生提示文字） */
  var SELECTOR = '[data-tip],[title],button,a[href],[onclick],[role="button"],.btn,.page-btn,.tab-btn,.admin-menu-item,input,select,textarea';
  function findTrigger(target) {
    var el = target;
    while (el && el !== document.body) {
      if (el.nodeType === 1 && el.matches && el.matches(SELECTOR)) return el;
      el = el.parentElement;
    }
    return null;
  }

  /* 无 title/data-tip 时，从元素自身内容派生提示文字 */
  var SYM_MAP = { '×': '关闭', '✕': '关闭', '↻': '刷新', '↺': '重置', '⟳': '刷新', '‹': '上一页', '›': '下一页', '▼': '展开 / 收起', '▶': '展开', '👁': '查看详情', '✏️': '编辑', '🗑': '删除', '🗑️': '删除' };
  function autoText(el) {
    var t = (el.getAttribute('aria-label') || '').replace(/^\s+|\s+$/g, '');
    if (t) return t;
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      t = (el.getAttribute('placeholder') || el.value || '').replace(/^\s+|\s+$/g, '');
      return t.length > 40 ? '' : t;
    }
    if (tag === 'SELECT') return '';
    t = (el.textContent || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!t || t.length > 30) return '';
    if (SYM_MAP[t]) return SYM_MAP[t];
    if (el.classList && el.classList.contains('page-btn') && /^\d+$/.test(t)) return '第 ' + t + ' 页';
    /* 纯符号/纯表情（无中英数字）无描述意义，不显示 */
    if (!/[0-9A-Za-z一-龥]/.test(t)) return '';
    return t;
  }

  function tipText(el) {
    if (!el) return '';
    if (el.hasAttribute('data-no-tip')) return '';
    var t = el.getAttribute('data-tip') || el.getAttribute('title') || '';
    t = String(t).replace(/^\s+|\s+$/g, '');
    if (t) return t;
    return autoText(el);
  }

  /* ---------- 定位 ---------- */
  function place(el) {
    var tip = ensureTip();
    var r = el.getBoundingClientRect();
    tip.style.visibility = 'hidden';
    tip.classList.add('show');
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.visibility = '';

    var left = r.left + r.width / 2 - tw / 2;
    if (left < EDGE) left = EDGE;
    if (left + tw > window.innerWidth - EDGE) left = window.innerWidth - EDGE - tw;

    var top = r.top - th - GAP, cls = 'above';
    if (top < EDGE) { top = r.bottom + GAP; cls = 'below'; }
    if (top + th > window.innerHeight - EDGE) {
      /* 上下都不够时选空间大的一侧 */
      if (r.top > window.innerHeight - r.bottom) { top = Math.max(EDGE, r.top - th - GAP); cls = 'above'; }
      else { top = Math.min(window.innerHeight - EDGE - th, r.bottom + GAP); cls = 'below'; }
    }
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
    tip.classList.remove('above', 'below');
    tip.classList.add(cls);
  }

  var showTimer = null, hideTarget = null, touchTimer = null;

  function show(el) {
    var text = tipText(el);
    if (!text) return;
    migrate(el);
    var tip = ensureTip();
    if (hideTarget === el && tip.classList.contains('show')) { place(el); return; }
    tip.textContent = text;
    place(el);
    hideTarget = el;
  }
  function hide() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
    if (tipEl) tipEl.classList.remove('show');
    hideTarget = null;
  }
  function scheduleShow(el, delay) {
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(function () { show(el); }, delay);
  }

  /* ---------- 事件绑定（委托） ---------- */
  function onMouseOver(e) {
    var el = findTrigger(e.target);
    if (!el) { return; }
    migrate(el);
    if (!tipText(el)) return;
    if (el === hideTarget) return; // 同一元素内移动不重置
    scheduleShow(el, SHOW_DELAY);
  }
  function onMouseOut(e) {
    var el = findTrigger(e.target);
    if (!el) return;
    var to = e.relatedTarget;
    if (to && el.contains(to)) return; // 子元素间移动不算离开
    hide();
  }

  function onTouchStart(e) {
    var el = findTrigger(e.target);
    if (!el) return;
    migrate(el);
    if (!tipText(el)) return;
    if (touchTimer) clearTimeout(touchTimer);
    touchTimer = setTimeout(function () { show(el); }, LONG_PRESS);
  }
  function onTouchEnd() {
    if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
    setTimeout(hide, 1200); // 长按看一眼后自动消失
  }

  function boot() {
    injectStyle();
    migrateAll(document);
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('mousedown', hide, true);
    document.addEventListener('wheel', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', hide, { passive: true });
    document.addEventListener('touchmove', function () {
      if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
    }, { passive: true });

    /* 动态内容：新增节点的 title 及时转移 */
    if (window.MutationObserver) {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'attributes' && m.attributeName === 'title') { migrate(m.target); continue; }
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType !== 1) continue;
            migrate(n);
            migrateAll(n);
          }
        }
      });
      mo.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['title']
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
