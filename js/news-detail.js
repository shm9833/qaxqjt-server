/* ==========================================================================
 * js/news-detail.js —— 新闻详情弹窗 + 图集灯箱（共享模块 v20260927b）
 * --------------------------------------------------------------------------
 * 使用方：index.html（首页新闻卡）、news.html（新闻列表卡）
 * 依赖：无（自带 _escape/_formatDate；QAXQJT_API 仅用于页面侧取数，模块只负责渲染）
 * 暴露：window.QAXNewsDetail = { open(row, opts) }
 *   row  ：/v1/contents/public 的一行（title/contentBody/coverImage/extraJson/tagsJson/...）
 *   opts ：{ footer: '页脚文案' } 可选
 * ========================================================================== */
(function (global) {
  'use strict';

  function _escape(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function _fmtDate(d) {
    if (!d) return null;
    try {
      var dt = new Date(d);
      if (isNaN(dt.getTime())) return null;
      return {
        y: dt.getFullYear(),
        m: String(dt.getMonth() + 1).padStart(2, '0'),
        d: String(dt.getDate()).padStart(2, '0')
      };
    } catch (_) { return null; }
  }

  function _parseGallery(row) {
    var gal = [];
    try {
      var ej = row.extraJson ? (typeof row.extraJson === 'string' ? JSON.parse(row.extraJson) : row.extraJson) : null;
      if (ej && Array.isArray(ej.gallery)) {
        gal = ej.gallery.filter(function (u) { return typeof u === 'string' && u; });
      }
    } catch (_) {}
    return gal;
  }

  /* ---------------- 详情弹窗 ---------------- */
  function _ensureModal() {
    var m = document.getElementById('newsDetailOverlay');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'newsDetailOverlay';
    m.className = 'modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:3000;background:rgba(15,23,42,.62);padding:30px 16px;overflow-y:auto;';
    m.innerHTML =
      '<div id="newsDetailPanel" style="background:#fff;max-width:780px;width:100%;margin:0 auto;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.35);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 22px;background:linear-gradient(135deg,#0f4c81,#0a3a63);color:#fff;">' +
          '<h3 id="newsDetailTitle" style="margin:0;font-size:1.1rem;font-weight:700;padding-right:16px;line-height:1.4;"></h3>' +
          '<button type="button" id="newsDetailCloseBtn" aria-label="关闭" style="flex-shrink:0;width:34px;height:34px;border-radius:50%;border:none;background:rgba(255,255,255,.16);color:#fff;font-size:16px;cursor:pointer;">✕</button>' +
        '</div>' +
        '<div id="newsDetailBody" style="padding:22px 26px 30px;max-height:calc(92vh - 80px);overflow-y:auto;"></div>' +
      '</div>';
    document.body.appendChild(m);
    // 关闭：× / 遮罩空白处 / ESC
    m.querySelector('#newsDetailCloseBtn').addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation(); close();
    });
    m.addEventListener('click', function (ev) { if (ev.target === m) close(); });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      var lb = document.getElementById('newsLightbox');
      if (lb && lb.style.display === 'block') return; // 灯箱层优先：由灯箱自己的 ESC 处理器关闭
      if (m.style.display === 'block') close();
    });
    // 图集点击 → 灯箱（body 复用，只绑一次）
    m.querySelector('#newsDetailBody').addEventListener('click', function (ev) {
      var img = ev.target && ev.target.closest ? ev.target.closest('img[data-lb-idx]') : null;
      if (!img) return;
      ev.preventDefault(); ev.stopPropagation();
      _lbIdx = parseInt(img.getAttribute('data-lb-idx'), 10) || 0;
      _lbShow();
    });
    return m;
  }

  function close() {
    var m = document.getElementById('newsDetailOverlay');
    if (!m) return;
    m.style.display = 'none';
    _closeLightbox(); // 弹窗关则灯箱一并关
    try { document.body.style.overflow = ''; } catch (_) {}
  }

  /* ---------------- 图集灯箱 ---------------- */
  var _lbUrls = [];
  var _lbIdx = 0;

  function _ensureLightbox() {
    var lb = document.getElementById('newsLightbox');
    if (lb) return lb;
    lb = document.createElement('div');
    lb.id = 'newsLightbox';
    lb.style.cssText = 'display:none;position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.88);';
    lb.innerHTML =
      '<img id="newsLightboxImg" src="" alt="灯箱预览" style="position:absolute;inset:0;margin:auto;max-width:92vw;max-height:88vh;object-fit:contain;box-shadow:0 10px 50px rgba(0,0,0,.6);" />' +
      '<button type="button" data-lb="close" aria-label="关闭" style="position:absolute;top:18px;right:22px;width:42px;height:42px;border-radius:50%;border:none;background:rgba(255,255,255,.14);color:#fff;font-size:18px;cursor:pointer;">✕</button>' +
      '<button type="button" data-lb="prev" aria-label="上一张" style="position:absolute;left:18px;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;border:none;background:rgba(255,255,255,.14);color:#fff;font-size:20px;cursor:pointer;">‹</button>' +
      '<button type="button" data-lb="next" aria-label="下一张" style="position:absolute;right:18px;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;border:none;background:rgba(255,255,255,.14);color:#fff;font-size:20px;cursor:pointer;">›</button>' +
      '<div id="newsLightboxCounter" style="position:absolute;bottom:20px;left:0;right:0;text-align:center;color:#e5e7eb;font-size:0.85rem;letter-spacing:2px;"></div>';
    document.body.appendChild(lb);
    lb.addEventListener('click', function (ev) {
      var act = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-lb') : null;
      if (act === 'close' || ev.target === lb) { _closeLightbox(); return; }
      if (act === 'prev') { _lbNav(-1); return; }
      if (act === 'next') { _lbNav(1); return; }
    });
    document.addEventListener('keydown', function (ev) {
      if (lb.style.display !== 'block') return;
      if (ev.key === 'ArrowLeft') _lbNav(-1);
      else if (ev.key === 'ArrowRight') _lbNav(1);
      else if (ev.key === 'Escape') _closeLightbox();
    });
    return lb;
  }

  function _lbShow() {
    var lb = _ensureLightbox();
    lb.querySelector('#newsLightboxImg').src = _lbUrls[_lbIdx];
    lb.querySelector('#newsLightboxCounter').textContent = (_lbIdx + 1) + ' / ' + _lbUrls.length;
    var many = _lbUrls.length > 1;
    lb.querySelector('[data-lb="prev"]').style.display = many ? '' : 'none';
    lb.querySelector('[data-lb="next"]').style.display = many ? '' : 'none';
    lb.style.display = 'block';
  }

  function _lbNav(delta) {
    if (!_lbUrls.length) return;
    _lbIdx = (_lbIdx + delta + _lbUrls.length) % _lbUrls.length;
    _lbShow();
  }

  function _closeLightbox() {
    var lb = document.getElementById('newsLightbox');
    if (!lb) return;
    lb.style.display = 'none';
    lb.querySelector('#newsLightboxImg').src = '';
  }

  /* ---------------- 打开详情 ---------------- */
  function open(row, opts) {
    if (!row) return;
    opts = opts || {};
    var m = _ensureModal();
    m.querySelector('#newsDetailTitle').textContent = row.title || '剧团动态';
    var body = m.querySelector('#newsDetailBody');
    var dt = _fmtDate(row.publishDate || row.createdAt);
    var meta = [];
    if (dt) meta.push('📅 ' + dt.y + '-' + dt.m + '-' + dt.d);
    var rawCat = '';
    try {
      var tj = row.tagsJson ? (typeof row.tagsJson === 'string' ? JSON.parse(row.tagsJson) : row.tagsJson) : null;
      if (tj && tj.category) rawCat = tj.category;
    } catch (_) {}
    if (rawCat) meta.push('🏷️ ' + _escape(rawCat));
    meta.push('👤 ' + _escape(row.authorName || '秦剧团'));
    var gal = _parseGallery(row);
    _lbUrls = gal; // 灯箱数据源

    var html = '<div style="display:flex;flex-wrap:wrap;gap:14px;font-size:0.85rem;color:#64748b;margin-bottom:18px;">' +
      meta.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>';
    if (row.coverImage) {
      html += '<img src="' + _escape(row.coverImage) + '" alt="封面" style="width:100%;max-height:360px;object-fit:cover;border-radius:12px;display:block;margin-bottom:20px;" onerror="this.style.display=\'none\'" />';
    }
    if (gal.length) {
      html += '<div style="margin-bottom:20px;"><div style="font-weight:700;color:#0f4c81;margin-bottom:10px;">🖼️ 活动图集（' + gal.length + ' 张）</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
        gal.map(function (u, i) {
          return '<img src="' + _escape(u) + '" alt="图集" data-lb-idx="' + i + '" loading="lazy" ' +
            'style="width:100%;max-width:240px;height:160px;object-fit:cover;border-radius:10px;border:1px solid #e5e7eb;cursor:zoom-in;transition:transform .15s;" ' +
            'onmouseover="this.style.transform=\'scale(1.03)\'" onmouseout="this.style.transform=\'\'" ' +
            'onerror="this.style.display=\'none\'" />';
        }).join('') +
        '</div></div>';
    }
    var paragraphs = String(row.contentBody || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (paragraphs.length) {
      html += '<div style="line-height:1.9;color:#1f2937;font-size:0.95rem;">' +
        paragraphs.map(function (p) { return '<p style="margin:0 0 14px;text-indent:2em;">' + _escape(p) + '</p>'; }).join('') + '</div>';
    }
    html += '<div style="margin-top:26px;padding-top:14px;border-top:1px dashed #e5e7eb;font-size:0.8rem;color:#9ca3af;text-align:center;">' +
      _escape(opts.footer || ('秦安县秦剧团文化演出有限公司 · ' + (dt ? dt.y : ''))) + '</div>';

    body.innerHTML = html;
    body.scrollTop = 0;

    m.className = 'modal'; // 重置页面全局×兜底可能加上的 *-hide 隐藏类（均带 !important）
    m.style.display = 'block';
    try { document.body.style.overflow = 'hidden'; } catch (_) {}
  }

  global.QAXNewsDetail = { open: open, close: close };
})(window);
