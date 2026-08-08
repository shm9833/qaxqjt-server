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
