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

  /* ---------- 数据拉取 + localStorage 同步 ---------- */
  function refresh() {
    if (!API || typeof API.get !== 'function') return Promise.resolve([]);
    return API.get('/v1/schedules', { query: { page: 1, pageSize: 500 } })
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

  /* ---------- 月度提示 + 冲突预警 ---------- */
  function renderAlerts(y, m) {
    // 信息条：当月真实场次
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
    // 冲突条：同日 ≥2 场
    var byDate = {};
    ROWS.forEach(function (r) {
      if (r.status === 'cancelled' || r.status === 'canceled') return;
      (byDate[r.date] = byDate[r.date] || []).push(r);
    });
    var conflicts = Object.keys(byDate).filter(function (d) { return byDate[d].length >= 2; }).sort();
    var exist = document.getElementById('schedConflictAlert');
    if (exist) exist.parentNode.removeChild(exist);
    if (conflicts.length && info && info.parentNode) {
      var div = document.createElement('div');
      div.className = 'schedule-alert danger';
      div.id = 'schedConflictAlert';
      var names = conflicts.slice(0, 5).map(function (d) {
        return d + '（' + byDate[d].map(function (r) { return r.title; }).join(' / ') + '）';
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
    var rows = ROWS.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).filter(function (r) {
      if (r.date.slice(0, 4) !== String(ym.y)) return false;
      if (ym.m && r.date.slice(5, 7) !== pad(ym.m)) return false;
      if (typeKw && (r.type.indexOf(typeKw) < 0)) return false;
      if (statusKw && r.status !== statusKw) return false;
      return true;
    });
    var colorMap = {
      miaohui: '#8B0000', huimin: '#28a745', jieqing: '#D4AF37', shangyan: '#17a2b8', other: '#6b7280'
    };
    if (!rows.length) {
      box.innerHTML = '<div style="padding:30px 12px;text-align:center;color:var(--text-light,#888);">📭 当前筛选条件下暂无真实排期</div>';
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
    // 查询栏按钮：查询/重置/今日后重拉真实数据并刷新列表卡
    document.querySelectorAll('.admin-filter-bar .btn, .admin-filter-bar button').forEach(function (b) {
      if (b.__schedRealBound2) return;
      var txt = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt.indexOf('查询') >= 0 || txt.indexOf('重置') >= 0 || txt.indexOf('今日') >= 0) {
        b.__schedRealBound2 = true;
        b.addEventListener('click', function () {
          setTimeout(function () { renderListCards(); var ym = selectedYM(); renderAlerts(ym.y, ym.m); }, 120);
        }, true);
      }
    });
  }

  function boot() {
    installHooks();
    refresh();
    // 内联脚本可能在稍后才挂载 __renderCalendar，再补一次包装
    setTimeout(installHooks, 300);
    setTimeout(installHooks, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
