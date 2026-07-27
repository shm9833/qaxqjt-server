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
        state.currentPage++; self._refresh(state);
      } else if (num) {
        state.currentPage = parseInt(num, 10); self._refresh(state);
      }
    });

    var jump = bar.querySelector('[data-page-jump]');
    jump.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var v = parseInt(jump.value, 10);
        if (v && v >= 1) {
          state.currentPage = v; self._refresh(state);
        }
      }
    });

    return bar;
  };

  QinPagination.prototype._bindSearch = function (state) {
    var scope = state.container.closest('main, section, .admin-content, body') || document;
    var input = scope.querySelector('input[data-search], .search-input, .admin-search input[type="text"], .filter-bar .search-box input, .admin-filter-bar input[placeholder*="搜索"]');
    if (!input) {
      try {
        var candidates = document.querySelectorAll('input[type="text"], input[type="search"]');
        for (var i = 0; i < candidates.length; i++) {
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
    var btns = scope.querySelectorAll('.category-btn, .category-tab, .tab-item[data-tab], [data-tab-btn], .staff-tab, .inv-tab');
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
    var filtered = all.filter(function (el) {
      if (keyword && !elementMatchesKeyword(el, keyword)) return false;
      if (state.categoryKey && state.categoryKey !== 'all') {
        var disp = el.style.display;
        if (disp === 'none' && !keyword) return false;
        var catAttr = el.getAttribute('data-category') || el.getAttribute('data-tab-panel');
        if (catAttr && catAttr !== state.categoryKey && state.categoryKey !== 'all') {
          return false;
        }
      } else {
        if (el.style.display === 'none' && !keyword) {
          var catAttr2 = el.getAttribute('data-category') || el.getAttribute('data-tab-panel');
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
      var inVisible = visible.indexOf(el) >= 0;
      var inPageRange = false;
      if (inVisible) {
        var vi = visible.indexOf(el);
        inPageRange = (vi >= startIdx && vi < endIdx);
      }
      if (!inVisible) {
        el.setAttribute('data-pagination-hidden', '1');
        el.style.display = 'none';
      } else if (!inPageRange) {
        el.setAttribute('data-pagination-hidden', '1');
        el.style.display = 'none';
      } else {
        el.removeAttribute('data-pagination-hidden');
        if (el._paginationOrigDisplay !== undefined) {
          el.style.display = el._paginationOrigDisplay;
        } else {
          if (el.tagName.toLowerCase() === 'tr') {
            el.style.display = '';
          } else {
            el.style.display = '';
          }
        }
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
          all[j].style.display = '';
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
