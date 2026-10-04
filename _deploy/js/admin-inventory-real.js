/* ============================================================
 * admin-inventory-real.js  v20260929
 * 库存预警 + 借用归还流水：真实 /v1/inventory 接线
 * 原静态预警卡/流水演示行已在 HTML 中清空，本脚本负责真实渲染。
 * ============================================================ */
(function () {
  'use strict';
  if (window.__invReal) return;
  window.__invReal = true;
  var API = window.QAXQJT_API;
  if (!API || typeof API.get !== 'function') return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtDate(d) {
    if (!d) return '—';
    var s = String(d);
    var m = s.match(/(19|20)\d{2}-\d{2}-\d{2}/);
    return m ? m[0] : s.slice(0, 10);
  }
  function unwrap(resp) {
    return Array.isArray(resp) ? resp : (resp && (resp.items || resp.list || resp.rows)) || [];
  }
  function setText(id, txt) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(txt);
  }

  var ALL_RECORDS = [];
  var FILTER = 'all';

  function recStatus(r) {
    var st = String(r.status || r.state || '').toLowerCase();
    if (st === 'returned' || r.opType === 'return' || r.returnedAt || r.actualReturnDate) return 'returned';
    if (st === 'overdue') return 'overdue';
    var due = r.expectedReturnDate || r.dueDate;
    if (due) {
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var d = new Date(String(due).slice(0, 10) + 'T00:00:00');
      if (!isNaN(d.getTime()) && d.getTime() < today.getTime()) return 'overdue';
    }
    return 'borrowing';
  }
  function itemName(r) {
    if (r.itemName) return r.itemName;
    if (r.item && r.item.name) return r.item.name;
    return r.itemId || r.item_id || '—';
  }
  function statusBadge(st) {
    if (st === 'returned') return '<span class="flow-badge returned">✅ 已归还</span>';
    if (st === 'overdue') return '<span class="flow-badge overdue">⏰ 已逾期</span>';
    return '<span class="flow-badge borrowing">📤 借用中</span>';
  }

  function renderRecords() {
    var tb = document.getElementById('invRecordsTbody');
    if (!tb) return;
    var rows = ALL_RECORDS.filter(function (r) {
      return FILTER === 'all' ? true : recStatus(r) === FILTER;
    });
    var cnt = { all: ALL_RECORDS.length, borrowing: 0, returned: 0, overdue: 0 };
    ALL_RECORDS.forEach(function (r) { cnt[recStatus(r)]++; });
    setText('flCntAll', cnt.all);
    setText('flCntBorrowing', cnt.borrowing);
    setText('flCntReturned', cnt.returned);
    setText('flCntOverdue', cnt.overdue);

    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-light,#999);">暂无借用归还流水记录</td></tr>';
    } else {
      tb.innerHTML = rows.map(function (r, i) {
        var st = recStatus(r);
        var borrower = esc(r.borrowerName || r.borrower || (r.operator || '—'));
        var date = fmtDate(r.operateDate || r.createdAt || r.borrowDate);
        var due = fmtDate(r.expectedReturnDate || r.dueDate);
        var back = st === 'returned' ? fmtDate(r.returnedAt || r.actualReturnDate || r.returnDate) : '—';
        var usage = esc(r.usage || r.purpose || '—');
        var play = esc(r.playTitle || r.performanceName || '—');
        var action = st === 'returned'
          ? '<span style="color:var(--text-light,#999);">已完结</span>'
          : '<button class="btn btn-outline-dark btn-sm" style="color:#28a745;border-color:#28a745;padding:6px 12px;" data-ret="' + esc(r.id || '') + '">归还</button>';
        return '<tr>' +
          '<td style="font-weight:600;">' + (i + 1) + '</td>' +
          '<td><div><strong>' + esc(itemName(r)) + '</strong>' +
            (r.sku ? '<div style="font-size:0.75rem;color:var(--text-light,#999);">' + esc(r.sku) + '</div>' : '') +
            (r.quantity ? ' ×' + esc(r.quantity) : '') + '</div></td>' +
          '<td>' + borrower + '</td>' +
          '<td>' + date + '</td>' +
          '<td>' + usage + '</td>' +
          '<td>' + play + '</td>' +
          '<td style="font-weight:600;">' + (st === 'returned' ? '—' : due) + '</td>' +
          '<td>' + back + '</td>' +
          '<td>' + statusBadge(st) + '</td>' +
          '<td><div class="admin-table-actions">' +
            '<button class="btn btn-secondary btn-sm" data-view="' + esc(r.id || '') + '">详情</button>' +
            action +
          '</div></td>' +
        '</tr>';
      }).join('');
    }
    try { if (window.QinPagination && QinPagination.init) QinPagination.init(); } catch (_) {}
  }

  function bindFilters() {
    document.querySelectorAll('.flow-status-filter .fs-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.flow-status-filter .fs-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        FILTER = btn.getAttribute('data-flow') || 'all';
        renderRecords();
      });
    });
    var tb = document.getElementById('invRecordsTbody');
    if (tb) {
      tb.addEventListener('click', function (e) {
        var ret = e.target && e.target.getAttribute && e.target.getAttribute('data-ret');
        if (ret && window.QAXQJT_API) {
          QAXQJT_API.post('/v1/inventory/records', { itemId: ret, opType: 'return', quantity: 1 })
            .then(function () { loadAll(); })
            .catch(function (err) { try { console.warn('[invReal] return', err); } catch (_) {} });
        }
      });
    }
  }

  function renderWarnings(items) {
    var box = document.getElementById('invWarnGrid');
    var low = items.filter(function (it) {
      return it.safetyStock != null && Number(it.quantity) <= Number(it.safetyStock);
    });
    var repair = items.filter(function (it) { return String(it.status || '') === 'repair'; });
    setText('invStatRepair', repair.length);
    var warn = document.getElementById('invWarnCount');
    if (warn) warn.textContent = low.length + repair.length + ' 项预警待处理';
    if (!box) return;
    var cards = [];
    low.forEach(function (it) {
      var gap = Number(it.safetyStock) - Number(it.quantity || 0);
      var unit = it.unit || '件';
      cards.push(
        '<div class="warning-card">' +
          '<div class="wc-title"><div>' +
            '<div class="wc-name">' + esc(it.name) + '</div>' +
            '<div class="wc-code">' + esc(it.sku || '—') + ' · ' + esc(it.category || '库存物品') + '</div>' +
          '</div></div>' +
          '<div class="wc-info">' +
            '<div class="wc-info-item">当前库存：<strong>' + esc(it.quantity || 0) + ' ' + unit + '</strong></div>' +
            '<div class="wc-info-item">安全库存：<strong>' + esc(it.safetyStock) + ' ' + unit + '</strong></div>' +
            '<div class="wc-info-item">缺额：<strong>-' + gap + ' ' + unit + '</strong></div>' +
          '</div>' +
          '<span class="wc-reason">⚠ 库存低于安全阈值</span>' +
          '<div class="wc-action"><button class="wc-btn" data-restock="' + esc(it.id || '') + '">📦 立即补货</button></div>' +
        '</div>'
      );
    });
    repair.forEach(function (it) {
      cards.push(
        '<div class="warning-card damage">' +
          '<div class="wc-title"><div>' +
            '<div class="wc-name">' + esc(it.name) + '</div>' +
            '<div class="wc-code">' + esc(it.sku || '—') + ' · ' + esc(it.category || '库存物品') + '</div>' +
          '</div></div>' +
          '<div class="wc-info"><div class="wc-info-item">状态：<strong>维修中</strong></div></div>' +
          '<span class="wc-reason">🔧 已标记维修，完成后请更新状态</span>' +
          '<div class="wc-action"><button class="wc-btn" data-repair="' + esc(it.id || '') + '">🔧 维修记录</button></div>' +
        '</div>'
      );
    });
    box.innerHTML = cards.length
      ? cards.join('')
      : '<div style="grid-column:1/-1;padding:36px 12px;text-align:center;color:var(--text-light,#888);">✅ 库存充足，暂无预警事项</div>';
    // 绑定立即补货 / 维修记录按钮（用 onclick + __superPatchBound 避免 SuperPatch 拦截）
    box.querySelectorAll('[data-restock]').forEach(function (btn) {
      btn.__superPatchBound = 1; btn.__ts3Done = 1;
      btn.onclick = function () {
        var id = btn.getAttribute('data-restock');
        if (window.__invApi && typeof window.__invApi.openRestock === 'function') {
          window.__invApi.openRestock(id);
        } else {
          try { console.warn('[invReal] __invApi.openRestock 未暴露'); } catch (_) {}
        }
      };
    });
    box.querySelectorAll('[data-repair]').forEach(function (btn) {
      btn.__superPatchBound = 1; btn.__ts3Done = 1;
      btn.onclick = function () {
        var id = btn.getAttribute('data-repair');
        if (window.__invApi && typeof window.__invApi.openEdit === 'function') {
          window.__invApi.openEdit(id);
        }
      };
    });
  }

  function loadAll() {
    API.get('/v1/inventory/items', { query: { page: 1, pageSize: 200 } })
      .then(function (resp) { renderWarnings(unwrap(resp)); })
      .catch(function () {
        var box = document.getElementById('invWarnGrid');
        if (box) box.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-light,#888);">预警数据加载失败</div>';
      });
    API.get('/v1/inventory/records', { query: { page: 1, pageSize: 200 } })
      .then(function (resp) {
        ALL_RECORDS = unwrap(resp);
        var el = document.getElementById('invStatBorrow');
        if (el) el.innerHTML = ALL_RECORDS.length + '<span style="font-size:0.95rem;margin-left:4px;color:var(--text-light);">次</span>';
        renderRecords();
      })
      .catch(function () {
        var tb = document.getElementById('invRecordsTbody');
        if (tb) tb.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-light,#999);">流水数据加载失败</td></tr>';
      });
  }

  function init() {
    bindFilters();
    loadAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
