/* system-ops-window.js v20261014c — 系统设置页「演职操作开放时限」配置卡片
 * 对接 GET/PUT /v1/system/perf-ops-window（PUT 仅 super_admin/ops；GET 含 director 只读）
 * 生产契约：GET data = { params, registerOpen, opsOpen, nextOpenDate, runs }（窗口状态平铺，无 window 嵌套）
 *          PUT data = 纯 params（保存成功后本脚本自动重新 GET 刷新状态条） */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(msg, type) {
    try { if (typeof window.showToast === 'function') { window.showToast(msg, type || 'info'); return; } } catch (e) {}
    alert(msg);
  }
  function fmt(dt) { if (!dt) return '—'; var d = new Date(dt); return isNaN(d.getTime()) ? String(dt) : d.toLocaleString('zh-CN', { hour12: false }); }
  function dataOf(r) { return (r && r.data) || r || {}; }
  function api() { return window.QAXQJT_API; }

  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function badge(open, label) {
    return '<span style="display:inline-flex;align-items:center;gap:6px;">' + label +
      (open ? '<span class="status-badge ok">● 开放中</span>' : '<span class="status-badge warn">○ 已关闭</span>') + '</span>';
  }

  /* GET 响应（params + 平铺窗口字段）→ 统一结构；PUT 响应（纯 params）→ window 为 null */
  function normalize(d) {
    if (d && d.params) {
      return {
        params: d.params,
        window: {
          registerOpen: !!d.registerOpen,
          opsOpen: !!d.opsOpen,
          nextOpenAt: d.nextOpenDate || null,
          scheduleCount: d.runs || 0
        }
      };
    }
    return { params: d || {}, window: null };
  }

  function renderStatus(w) {
    var el = $('powStatus');
    if (!el) return;
    el.innerHTML =
      badge(w.registerOpen, '入职登记通道') +
      badge(w.opsOpen, '演职打卡通道') +
      '<span style="color:var(--text-light);">演出排期段：' + (w.scheduleCount || 0) + ' 段</span>' +
      (!w.registerOpen && w.nextOpenAt ? '<span style="color:var(--gold-dark);">下次开放：' + esc(w.nextOpenAt) + '</span>' : '');
  }

  function renderParams(p) {
    if ($('powEnabled')) $('powEnabled').checked = !!p.enabled;
    if ($('powOpenDays')) $('powOpenDays').value = p.openDaysBefore;
    if ($('powOpsDays')) $('powOpsDays').value = p.opsOpenDaysBefore;
    if ($('powCloseHours')) $('powCloseHours').value = p.closeHoursAfter;
    if ($('powMeta')) $('powMeta').textContent = p.updatedAt ? ('最后修改：' + fmt(p.updatedAt) + (p.updatedBy ? ' · 操作人：' + p.updatedBy : '')) : '';
  }

  function renderAll(d) {
    var n = normalize(d);
    renderParams(n.params);
    if (n.window) renderStatus(n.window);
  }

  async function load() {
    var st = $('powStatus');
    try {
      var r = await api().get('/v1/system/perf-ops-window', { showErrorToast: false });
      renderAll(dataOf(r));
    } catch (e) {
      if (st) st.innerHTML = '<span style="color:var(--primary);">⚠️ 状态加载失败' + (e && e.status === 403 ? '：当前账号无权查看该配置' : '，请稍后刷新重试') + '</span>';
    }
  }

  async function save(body, okMsg) {
    try {
      var r = await api().put('/v1/system/perf-ops-window', body);
      renderParams(dataOf(r));
      toast(okMsg || '✅ 开放时限参数已保存，立即生效', 'success');
      load();
    } catch (e) {
      toast('❌ 保存失败：' + ((e && e.message) || '仅超级管理员/团长可修改'), 'error');
      load();
    }
  }

  function init() {
    if (!$('powCard')) return;
    load();
    $('powRefreshBtn').addEventListener('click', load);
    $('powSaveBtn').addEventListener('click', function () {
      save({
        enabled: $('powEnabled').checked,
        openDaysBefore: clampInt($('powOpenDays').value, 0, 90, 10),
        opsOpenDaysBefore: clampInt($('powOpsDays').value, 0, 30, 0),
        closeHoursAfter: clampInt($('powCloseHours').value, 1, 720, 24)
      });
    });
    $('powOpenAllBtn').addEventListener('click', function () {
      if (!confirm('确认临时常开？\n\n开启后：入职登记与演职打卡不再受演出排期限制（全部人员可操作）。\n人员补录完成后，请及时点「🔒 恢复自动开闭」。')) return;
      save({ enabled: false }, '✅ 已临时常开（补录完成后请恢复自动开闭）');
    });
    $('powAutoBtn').addEventListener('click', function () {
      save({ enabled: true }, '✅ 已恢复按演出排期自动开闭');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
