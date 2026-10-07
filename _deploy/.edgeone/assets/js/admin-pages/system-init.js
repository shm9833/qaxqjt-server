/* system-init.js —— 系统初始化向导（system.html，v20261008a）
 * 对接 /v1/system/init/status|run|log（仅 super_admin）：
 * 环境检测（配置/依赖/端口/数据库）→ 进度条 + 步骤日志 → 初始化审计日志查看 */
(function () {
  'use strict';
  if (typeof document === 'undefined' || !document.getElementById('siwCard')) return;

  var BASE = '/v1/system/init';
  var API = window.QAXQJT_API;
  var STEP_ICON = { pass: '✅', fail: '❌', skip: '⏭️', running: '⏳', pending: '⬜' };

  function $(id) { return document.getElementById(id); }
  function hx(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') { try { window.showToast(msg, type || 'info'); return; } catch (_) {} }
    window.alert(msg);
  }

  /* ===== 环境检测结果渲染 ===== */
  function renderStatus(data) {
    if (!data) return;
    var badge = $('siwInitBadge');
    if (data.initialized) {
      badge.className = 'siw-badge is-on';
      badge.textContent = '已初始化' + (data.marker && data.marker.initializedAt ? '（' + String(data.marker.initializedAt).slice(0, 19).replace('T', ' ') + '）' : '');
    } else {
      badge.className = 'siw-badge is-off';
      badge.textContent = '未初始化';
    }
    var rep = data.checks || {};
    var list = rep.checks || [];
    if (!list.length) { $('siwChecks').innerHTML = '<div style="color:#94a3b8;font-size:.85rem;">暂无检测数据</div>'; return; }
    $('siwChecks').innerHTML = list.map(function (c) {
      var st = c.status === 'pass' ? 'is-pass' : c.status === 'warn' ? 'is-warn' : 'is-fail';
      var icon = c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌';
      return '<div class="siw-check ' + st + '"><span class="dot"></span><div><b>' + icon + ' ' + hx(c.label) + '</b><br><span>' + hx(c.detail || '') + '</span></div></div>';
    }).join('');
  }

  function runCheck() {
    $('siwChecks').innerHTML = '<div style="color:#94a3b8;font-size:.85rem;padding:10px 0;">正在检测运行环境…</div>';
    return API.get(BASE + '/status').then(renderStatus).catch(function () {
      $('siwChecks').innerHTML = '<div style="color:#f87171;font-size:.85rem;">检测失败：可能无权限或后端不可用（仅超级管理员可访问）</div>';
    });
  }

  /* ===== 初始化执行渲染 ===== */
  function renderSteps(report, progressEvents) {
    var wrap = $('siwProgressWrap');
    var txt = $('siwStepText');
    wrap.style.display = 'block';
    txt.style.display = 'block';
    var steps = (report && report.steps) || [];
    var maxPct = 0;
    (progressEvents || []).forEach(function (p) { if (p.percent > maxPct) maxPct = p.percent; });
    var failed = steps.some(function (s) { return s.status === 'fail'; });
    var pct = failed ? maxPct : (report && report.status === 'success' ? 100 : maxPct || 0);
    $('siwProgress').style.width = pct + '%';

    $('siwSteps').innerHTML = steps.map(function (s) {
      var cls = 'is-' + s.status;
      return '<div class="siw-step ' + cls + '"><b>' + (STEP_ICON[s.status] || '⬜') + ' ' + hx(s.name) + '（' + s.percent + '%）</b>'
        + '<small>' + hx(s.message || '') + (s.durationMs ? ' · ' + s.durationMs + 'ms' : '') + '</small></div>';
    }).join('');

    if (report && report.status === 'success') {
      txt.style.color = '#166534';
      txt.textContent = '✅ 初始化全部完成（' + (report.finishedAt || '') + '），审计日志：' + (report.logFile || '');
      toast('✅ 系统初始化完成', 'success');
      runCheck();
    } else {
      var fs = steps.filter(function (s) { return s.status === 'fail'; })[0];
      txt.style.color = '#b91c1c';
      txt.textContent = '❌ 初始化未完成' + (fs ? '（失败步骤：' + fs.name + '）' : '') + '，请查看下方日志修复后重试';
      toast('❌ 初始化未完成', 'error');
    }
  }

  function runInit() {
    if (!$('siwConfirm').checked) { toast('请先勾选「我已确认并备份数据」', 'warning'); return; }
    if (!window.confirm('确认立即执行系统初始化？\n\n· 同步数据库表结构（幂等）\n· 重载初始种子（管理员/字典/权限）\n执行期间请勿关闭页面。')) return;
    var btn = $('siwRunBtn');
    btn.disabled = true;
    $('siwProgressWrap').style.display = 'block';
    $('siwStepText').style.display = 'block';
    $('siwStepText').style.color = '#4338ca';
    $('siwStepText').textContent = '⏳ 正在执行初始化（约 10-60 秒），请勿关闭页面…';
    $('siwProgress').style.width = '8%';
    $('siwSteps').innerHTML = '';
    API.post(BASE + '/run', { confirm: true }).then(function (d) {
      renderSteps(d.report, d.progress);
      return loadLog(true);
    }).catch(function () {
      $('siwStepText').style.color = '#b91c1c';
      $('siwStepText').textContent = '❌ 初始化请求失败，请检查网络或权限后重试';
    }).finally(function () { btn.disabled = false; });
  }

  /* ===== 日志 ===== */
  function loadLog(showAfterLoad) {
    return API.get(BASE + '/log', { showErrorToast: false }).then(function (d) {
      var pre = $('siwLog');
      if (d && d.content) {
        pre.textContent = '── ' + d.file + ' ──\n' + d.content;
        pre.style.display = 'block';
        if (showAfterLoad) pre.scrollTop = pre.scrollHeight;
      } else if (showAfterLoad) {
        toast('暂无初始化日志', 'info');
      }
    }).catch(function () {});
  }

  function bind() {
    $('siwCheckBtn').addEventListener('click', runCheck);
    $('siwRunBtn').addEventListener('click', runInit);
    $('siwLogBtn').addEventListener('click', function () {
      var pre = $('siwLog');
      if (pre.style.display === 'block') { pre.style.display = 'none'; return; }
      loadLog(true);
    });
    $('siwConfirm').addEventListener('change', function () { $('siwRunBtn').disabled = !this.checked; });
  }

  function init() {
    if (!API) { console.warn('[system-init] QAXQJT_API 未就绪'); return; }
    bind();
    runCheck();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
