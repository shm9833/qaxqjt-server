/* ==========================================================================
 * js/real-public.js —— 前台公共页真实数据渲染层（v20260922）
 * ----------------------------------------------------------------------------
 * 数据来源：后端公开只读接口（/v1 下各 public 端点，无鉴权）
 *   - /v1/stats/public           首页真实统计
 *   - /v1/plays/public           在册剧目（剧目中心 / 首页精选 / 预约页意向剧目）
 *   - /v1/contents/public        已发布新闻动态
 *   - /v1/cast-sheets/public     已发布演出阵容
 * 原则：接口失败时保留页面静态兜底；接口成功但无数据时显示空态，绝不展示假数据。
 * ========================================================================== */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function api() { return global.QAXQJT_API || null; }

  function get(path, query) {
    var A = api();
    if (!A || typeof A.get !== 'function') return Promise.reject(new Error('no-api'));
    return A.get(path, { query: query || {}, showErrorToast: false, timeoutMs: 12000 });
  }

  // 剧目海报：优先用缩略图（images JSON 中 type=posterThumb 项），否则用 posterUrl，否则文生图兜底
  function posterUrl(p) {
    if (p && p.images) {
      try {
        var arr = typeof p.images === 'string' ? JSON.parse(p.images) : p.images;
        if (Array.isArray(arr)) {
          for (var i = 0; i < arr.length; i++) {
            if (arr[i] && arr[i].type === 'posterThumb' && arr[i].url) return arr[i].url;
          }
        }
      } catch (_) {}
    }
    if (p && p.posterUrl) return p.posterUrl;
    return posterFallback(p);
  }

  // 海报加载失败（如历史演示图片文件已清理）→ 按剧名生成兜底，避免公开页裂图
  function posterFallback(p) {
    var title = (p && p.title) || '秦腔剧目';
    var prompt = '秦腔传统戏曲《' + title + '》舞台演出剧照，演员身着华丽戏服、戏曲脸谱，中国古戏台，红色宫灯，专业舞台灯光，写实摄影风格，高清';
    return 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=' +
      encodeURIComponent(prompt) + '&image_size=landscape_4_3';
  }
  function playImg(p, title) {
    return '<img src="' + esc(posterUrl(p)) + '" alt="' + title + '" loading="lazy" onerror="this.onerror=null;this.src=\'' + posterFallback(p) + '\'">';
  }

  function playDesc(p) {
    var s = String((p && (p.synopsis || p.castSummary)) || '').replace(/\s+/g, ' ').trim();
    if (s && s !== '待定') return s;
    var g = p && p.genre ? p.genre : '传统剧目';
    return '秦安县秦剧团文化演出有限公司常演' + g + '，适配庙会、惠民下乡、节庆庆典等演出场景，欢迎预约。';
  }

  function fmtDate(d) {
    if (!d) return '';
    try {
      var dt = new Date(d);
      if (isNaN(dt.getTime())) return '';
      var pad = function (n) { return String(n).padStart(2, '0'); };
      return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
    } catch (_) { return ''; }
  }

  /* ---------------- 首页 / 通用：真实统计 ---------------- */
  function renderStats() {
    var holders = document.querySelectorAll('[data-stat]');
    if (!holders.length) return;
    get('/v1/stats/public').then(function (s) {
      if (!s) return;
      holders.forEach(function (el) {
        var key = el.getAttribute('data-stat');
        var v = s[key];
        if (typeof v === 'number') el.textContent = String(v);
      });
    }).catch(function () { /* 保留占位符 "--" */ });
  }

  /* ---------------- 首页：经典剧目精选（取前 6 + 更多卡） ---------------- */
  function renderHomePlays() {
    var grid = document.querySelector('[data-real-home-plays]');
    if (!grid) return;
    get('/v1/plays/public', { pageSize: 6 }).then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) return; // 无数据时保留静态兜底
      var html = rows.slice(0, 6).map(function (p) {
        var title = esc(p.title);
        var link = 'cast-public.html?opera=' + encodeURIComponent(p.title);
        return '<a href="' + link + '" class="repertoire-card" style="text-decoration:none;color:inherit;display:block;">' +
          '<div class="repertoire-image">' +
            playImg(p, title) +
          '</div>' +
          '<div class="repertoire-info">' +
            '<h4>《' + title + '》</h4>' +
            '<p>' + esc(playDesc(p)) + '</p>' +
            '<p style="margin-top:10px;"><span style="display:inline-block;padding:6px 14px;border-radius:999px;background:linear-gradient(135deg,#7f1d1d,#b91c1c);color:#fffbeb;font-size:0.82rem;font-weight:600;">🎭 查看本剧演出阵容 →</span></p>' +
          '</div>' +
        '</a>';
      }).join('');
      html += '<a href="operas.html" class="repertoire-card" style="text-decoration:none;color:inherit;display:block;">' +
        '<div class="repertoire-image">' +
          '<img src="img/opera_%E6%9B%B4%E5%A4%9A.svg" alt="更多经典剧目" onerror="this.src=\'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 800 450%22><rect width=%22800%22 height=%22450%22 fill=%22%23fdf2e9%22/><text x=%22400%22 y=%22225%22 text-anchor=%22middle%22 font-size=%2248%22 fill=%22%237f1d1d%22 font-family=%22KaiTi,serif%22>📜 更多剧目</text></svg>\'">' +
        '</div>' +
        '<div class="repertoire-info">' +
          '<h4>更多经典剧目</h4>' +
          '<p>剧团在册多部传统本戏、折子戏与历史名剧，详见剧目中心完整列表</p>' +
          '<p style="margin-top:10px;"><span style="display:inline-block;padding:6px 14px;border-radius:999px;background:linear-gradient(135deg,#7f1d1d,#b91c1c);color:#fffbeb;font-size:0.82rem;font-weight:600;">🎭 查看完整剧目单 →</span></p>' +
        '</div>' +
      '</a>';
      grid.innerHTML = html;
    }).catch(function () { /* 保留静态卡片 */ });
  }

  /* ---------------- 首页：新闻动态（0 条 → 空态卡） ---------------- */
  function renderHomeNews() {
    var grid = document.querySelector('[data-real-home-news]');
    if (!grid) return;
    get('/v1/contents/public', { page: 1, pageSize: 4 }).then(function (resp) {
      var rows = Array.isArray(resp) ? resp : (resp && (resp.items || resp.list || resp.rows)) || [];
      if (!rows.length) {
        grid.innerHTML = '<div class="service-card" style="grid-column:1/-1;text-align:center;padding:40px 24px;">' +
          '<div class="service-icon">📭</div>' +
          '<h4>暂无最新动态</h4>' +
          '<p>剧团近期资讯正在整理发布，敬请关注。演出预约可直接致电 <a href="tel:13993839833" style="color:#0f4c81;font-weight:700;">139-9383-9833</a></p>' +
        '</div>';
        return;
      }
      grid.innerHTML = rows.slice(0, 4).map(function (r, i) {
        var d = fmtDate(r.publishDate || r.createdAt);
        var summary = String(r.summary || (r.contentBody || '')).slice(0, 110);
        return '<a href="news.html" class="service-card" data-home-idx="' + i + '" style="text-decoration:none;color:inherit;display:block;position:relative;cursor:pointer;">' +
          '<div style="position:absolute;top:16px;right:16px;padding:4px 12px;border-radius:999px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-size:0.78rem;font-weight:600;">📰 ' + esc(d) + '</div>' +
          '<div class="service-icon">📰</div>' +
          '<h4>' + esc(r.title || '剧团动态') + '</h4>' +
          '<p>' + esc(summary) + '</p>' +
        '</a>';
      }).join('');
      // 存行数据供首页详情弹窗使用（js/news-detail.js）
      global.__homeNewsRows = rows.slice(0, 4);
    }).catch(function () { /* 保留静态兜底 */ });
  }

  /* ---------------- 剧目中心：真实剧目 + 分类/搜索/分页 ---------------- */
  function renderOperasPage() {
    var grid = document.querySelector('[data-real-operas]');
    if (!grid) return;

    function showMsg(icon, title, html) {
      grid.innerHTML = '<div class="category-empty" style="grid-column:1 / -1;">' +
        '<div class="empty-icon">' + icon + '</div>' +
        '<h3 style="color:var(--gold-dark,#92400e);margin-bottom:10px;">' + title + '</h3>' +
        '<p>' + html + '</p>' +
      '</div>';
    }

    get('/v1/plays/public', { pageSize: 200 }).then(function (rows) {
      rows = (Array.isArray(rows) ? rows : []).filter(function (p) { return p && p.title; });
      if (!rows.length) {
        showMsg('📭', '暂无在册剧目', '剧目信息正在整理中，欢迎致电 <a href="tel:13993839833" style="color:var(--primary,#b91c1c);font-weight:600;">13993839833</a> 咨询演出剧目单。');
        return;
      }

      // 1) 渲染卡片（data-category 使用真实 genre）
      grid.innerHTML = rows.map(function (p) {
        var cat = p.genre || '其他';
        var title = esc(p.title);
        var dur = p.durationMinutes ? ('⏱ 时长：' + esc(p.durationMinutes) + ' 分钟') : '⏱ 经典保留剧目';
        var booking = 'booking.html?play=' + encodeURIComponent(p.title);
        return '<div class="opera-card" data-category="' + esc(cat) + '" data-tab-panel="' + esc(cat) + '" data-search-text="' + esc(p.title + ' ' + cat + ' ' + playDesc(p)) + '">' +
          '<div class="opera-card-image">' +
            '<span class="opera-card-category">' + esc(cat) + '</span>' +
            playImg(p, title) +
          '</div>' +
          '<div class="opera-card-body">' +
            '<h3>《' + title + '》</h3>' +
            '<div class="opera-card-meta">' +
              '<span class="opera-meta-item"><span class="meta-icon">⏱</span>' + dur.replace('⏱ ', '') + '</span>' +
              '<span class="opera-meta-item"><span class="meta-icon">🎭</span>' + esc(p.author && p.author !== '传统' ? p.author : cat) + '</span>' +
            '</div>' +
            '<span class="opera-scene-tag">🏮 适配：庙会 / 惠民 / 节庆</span>' +
            '<p class="opera-card-desc">' + esc(playDesc(p)) + '</p>' +
            '<div class="opera-card-footer">' +
              '<a href="' + booking + '" class="btn btn-primary">📅 预约此剧</a>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      // 2) 重建分类按钮（按真实 genre 聚合）
      var navInner = document.querySelector('[data-real-opera-tabs]');
      var searchWrap = navInner ? navInner.querySelector('.search-input-wrap') : null;
      var genres = [];
      rows.forEach(function (p) {
        var g = p.genre || '其他';
        if (genres.indexOf(g) < 0) genres.push(g);
      });
      if (navInner) {
        navInner.innerHTML = '<button class="category-btn active" data-tab-btn="all" type="button">全部剧目</button>' +
          genres.map(function (g) {
            return '<button class="category-btn" data-tab-btn="' + esc(g) + '" type="button">' + esc(g) + '</button>';
          }).join('');
        if (searchWrap) navInner.appendChild(searchWrap);
      }

      // 3) 找分页实例（卡片容器对应的那一个）
      var pgState = null;
      try {
        var insts = (global.QinPagination && global.QinPagination._raw && global.QinPagination._raw._instances) || [];
        for (var i = 0; i < insts.length; i++) {
          if (insts[i].container === grid) { pgState = insts[i]; break; }
        }
      } catch (_) {}
      function pgRefresh() {
        if (pgState && global.QinPagination && typeof global.QinPagination.refresh === 'function') {
          try { global.QinPagination.refresh(); } catch (_) {}
        }
        toggleEmptyTip();
      }
      function resetPage() { if (pgState) pgState.currentPage = 1; }

      // 4) 空结果提示
      var tip = null;
      function toggleEmptyTip() {
        var anyVisible = grid.querySelectorAll('.opera-card:not(.pg-hidden)').length > 0;
        if (!tip) {
          tip = document.createElement('div');
          tip.className = 'category-empty';
          tip.style.gridColumn = '1 / -1';
          tip.innerHTML = '<div class="empty-icon">🔍</div><h3 style="color:var(--gold-dark,#92400e);margin-bottom:10px;">未找到匹配剧目</h3><p>换个关键词或分类试试，也可致电 <a href="tel:13993839833" style="color:var(--primary,#b91c1c);font-weight:600;">13993839833</a> 咨询定制。</p>';
          grid.parentNode.insertBefore(tip, grid.nextSibling);
        }
        tip.style.display = anyVisible ? 'none' : '';
      }

      // 5) 绑定新分类按钮（事件委托）
      if (navInner) {
        navInner.addEventListener('click', function (e) {
          var btn = e.target && e.target.closest ? e.target.closest('[data-tab-btn]') : null;
          if (!btn) return;
          var key = btn.getAttribute('data-tab-btn') || 'all';
          navInner.querySelectorAll('[data-tab-btn]').forEach(function (b) { b.classList.toggle('active', b === btn); });
          if (pgState) { pgState.categoryKey = key === 'all' ? 'all' : key; resetPage(); }
          pgRefresh();
          var sec = document.querySelector('.operas-section');
          if (sec) global.scrollTo({ top: sec.offsetTop - 100, behavior: 'smooth' });
        });
      }

      // 6) 替换搜索框（断开旧监听），重新绑定到分页状态
      var oldInput = document.querySelector('[data-search-opera]');
      if (oldInput) {
        var fresh = oldInput.cloneNode(false);
        oldInput.parentNode.replaceChild(fresh, oldInput);
        var applyKw = function () {
          if (pgState) {
            pgState.searchKeyword = (fresh.value || '').trim();
            pgState.currentPage = 1;
          }
          pgRefresh();
        };
        var t = null;
        fresh.addEventListener('input', function () { if (t) clearTimeout(t); t = setTimeout(applyKw, 200); });
        fresh.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); applyKw(); } });
        var sicon = document.querySelector('.category-nav-inner .search-icon');
        if (sicon) sicon.addEventListener('click', applyKw);
      }

      if (pgState) { pgState.categoryKey = 'all'; pgState.currentPage = 1; }
      pgRefresh();
    }).catch(function () {
      showMsg('📡', '剧目信息暂时无法加载', '请检查网络后刷新页面，或直接致电 <a href="tel:13993839833" style="color:var(--primary,#b91c1c);font-weight:600;">13993839833</a> 咨询。');
    });
  }

  /* ---------------- 预约页：意向剧目复选框（真实 20 部） ---------------- */
  function renderBookingPlays() {
    var wrap = document.querySelector('[data-real-booking-plays]');
    if (!wrap) return;
    get('/v1/plays/public', { pageSize: 200 }).then(function (rows) {
      rows = (Array.isArray(rows) ? rows : []).filter(function (p) { return p && p.title; });
      if (!rows.length) return;
      // 记录 URL 预选剧目（app.js 初始化可能先勾选过静态框）
      var prefill = '';
      try { prefill = (new URLSearchParams(global.location.search).get('play') || '').replace(/[《》\s]/g, ''); } catch (_) {}
      wrap.innerHTML = rows.map(function (p) {
        var t = esc(p.title);
        return '<label class="form-check"><input type="checkbox" name="selectedPlays" value="《' + t + '》" data-play-name="' + t + '"><span>《' + t + '》</span></label>';
      }).join('');
      if (prefill) {
        wrap.querySelectorAll('[data-play-name]').forEach(function (cb) {
          if ((cb.getAttribute('data-play-name') || '').replace(/[《》\s]/g, '') === prefill) cb.checked = true;
        });
      }
    }).catch(function () { /* 保留静态复选框 */ });
  }

  /* ---------------- 新闻页侧栏：热门动态 + 演出预告（真实数据，0 条保留占位） ---------------- */
  function renderNewsSidebars() {
    var hotBox = document.querySelector('[data-real-hot-news]');
    var schBox = document.querySelector('[data-real-schedules]');
    if (hotBox) {
      get('/v1/contents/public', { pageSize: 5, type: 'news' }).then(function (rows) {
        rows = Array.isArray(rows) ? rows : (rows && (rows.items || rows.list || rows.rows)) || [];
        if (!rows.length) return; // 保留“暂无最新动态”占位
        hotBox.innerHTML = rows.slice(0, 5).map(function (r, i) {
          var d = fmtDate(r.publishedAt || r.createdAt || r.updatedAt || '');
          return '<li class="hot-news-item"><a href="news.html" class="hot-news-link">'
            + '<span class="hot-news-rank">' + (i + 1) + '</span><div>'
            + '<span class="hot-news-text">' + esc(r.title || '') + '</span>'
            + (d ? '<span class="hot-news-date">' + d + '</span>' : '')
            + '</div></a></li>';
        }).join('');
      }).catch(function () { /* 保留占位 */ });
    }
    if (schBox) {
      get('/v1/schedules/public', { pageSize: 5 }).then(function (rows) {
        rows = Array.isArray(rows) ? rows : [];
        if (!rows.length) return; // 保留“暂无演出排期”占位
        schBox.innerHTML = rows.slice(0, 5).map(function (r) {
          var dateTxt = esc(r.date || '') + (r.dateEnd ? ' ~ ' + esc(String(r.dateEnd).slice(5)) : '');
          var venue = r.venueAddress || r.venue || '';
          return '<li class="showcase-item"><span class="showcase-date">' + dateTxt + '</span>'
            + '<div class="showcase-title">' + esc(r.playTitle || '秦腔演出') + '</div>'
            + (venue ? '<div class="showcase-place">📍 ' + esc(venue) + '</div>' : '')
            + '</li>';
        }).join('');
      }).catch(function () { /* 保留占位 */ });
    }
  }

  function boot() {
    try { renderStats(); } catch (e) {}
    try { renderHomePlays(); } catch (e) {}
    try { renderHomeNews(); } catch (e) {}
    try { renderOperasPage(); } catch (e) {}
    try { renderBookingPlays(); } catch (e) {}
    try { renderNewsSidebars(); } catch (e) {}
  }

  global.QinRealPublic = { renderStats: renderStats, renderHomePlays: renderHomePlays, renderHomeNews: renderHomeNews, renderOperasPage: renderOperasPage, renderBookingPlays: renderBookingPlays, renderNewsSidebars: renderNewsSidebars, get: get, posterUrl: posterUrl, fmtDate: fmtDate, esc: esc };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
