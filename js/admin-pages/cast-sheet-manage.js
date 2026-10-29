/*!
 * cast-sheet-manage.js · 20261016
 * admin/cast-sheet.html 的「已发布阵容管理」面板：
 *  - 列表：展示全部（未软删）阵容，可按权限对每条执行 编辑 / 暂停·恢复公开 / 删除
 *  - 修改：载入编辑器后「保存为草稿」或「重新发布」（复用 cast-sheet-real.js）
 *  - 删除：二次确认 → 关联校验（后端 409）→ 软删除 → toast → 刷新
 *  - 公开切换：一键暂停（status→draft）/ 恢复（status→confirmed），操作后实时刷新
 *  - 权限：仅 super_admin/admin 或阵容创建者可见可操作（后端二次兜底 403）
 *  - 交互：按钮加载态防重复提交，结果以 toast 反馈，操作完成后自动刷新列表
 */
(function () {
  'use strict';

  var ADMIN_ROLES = ['super_admin', 'admin'];
  var PUBLIC_STATUS = ['confirmed', 'locked'];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function unwrap(d) {
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.items)) return d.items;
    if (d && Array.isArray(d.list)) return d.list;
    return [];
  }
  function api() { return window.QAXQJT_API || null; }

  /* ---------- toast（优先全局 showToast，缺省本地兜底） ---------- */
  function toast(msg, type) {
    type = type || 'info';
    if (typeof window.showToast === 'function') {
      try { window.showToast(msg, type); return; } catch (_) { /* fallthrough */ }
    }
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;padding:12px 24px;border-radius:8px;color:#fff;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);background:' +
      (type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : type === 'warning' ? '#ffc107' : '#17a2b8');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3000);
  }

  function msg(t, cls) {
    var m = $('cmMsg');
    if (!m) return;
    m.textContent = t || '';
    m.style.color = cls === 'err' ? '#b91c1c' : cls === 'ok' ? '#15803d' : '#9a3412';
  }

  /* ---------- 身份 / 权限 ---------- */
  function session() { try { var r = localStorage.getItem('qaxqjt_admin_session'); return r ? JSON.parse(r) : null; } catch (_) { return null; } }
  function currentUser() { try { var r = localStorage.getItem('qaxqjt_current_user'); return r ? JSON.parse(r) : null; } catch (_) { return null; } }
  function roleName() { var s = session(); return (s && s.role) || ''; }
  function isAdmin() { return ADMIN_ROLES.indexOf(roleName()) >= 0; }
  // 可代表本机身份的 id 集合（后端 createdBy = ctx.state.user.sub || username）
  function myIds() {
    var s = session() || {}, u = currentUser() || {}, ids = [];
    [s.username, u.id, u.sub, u.accountId, u.account_id, u.username, u.account].forEach(function (v) {
      if (v && ids.indexOf(v) < 0) ids.push(v);
    });
    return ids;
  }
  function canOperate(sheet) {
    if (isAdmin()) return true;
    var ids = myIds(), owner = sheet && sheet.createdBy;
    return !!(owner && ids.indexOf(owner) >= 0);
  }
  function isPublic(sheet) { return PUBLIC_STATUS.indexOf(sheet && sheet.status) >= 0; }

  /* ---------- 按钮加载态 ---------- */
  function lockBtn(btn, busyLabel) {
    if (!btn) return;
    btn.__origText = btn.textContent;
    btn.disabled = true;
    btn.style.opacity = '.6';
    btn.style.cursor = 'not-allowed';
    if (busyLabel) btn.textContent = busyLabel;
  }
  function unlockBtn(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.cursor = 'pointer';
    if (btn.__origText != null) { btn.textContent = btn.__origText; btn.__origText = null; }
  }

  /* ---------- 数据缓存 ---------- */
  var SHEETS = [];
  function byId(id) { for (var i = 0; i < SHEETS.length; i++) { if (SHEETS[i].id === id) return SHEETS[i]; } return null; }

  /* ---------- 列表渲染 ---------- */
  function renderList() {
    var tb = $('cmTbody');
    if (!tb) return Promise.resolve();
    var A = api();
    if (!A) {
      tb.innerHTML = '<tr><td colspan="6" style="padding:10px;color:#b91c1c;">接口模块未就绪，请通过正式环境登录管理员账号。</td></tr>';
      setBadge('未登录');
      return Promise.resolve();
    }
    msg('正在加载阵容列表…');
    return A.get('/v1/cast-sheets', { query: { page: 1, pageSize: 100 }, showErrorToast: false }).then(function (d) {
      SHEETS = unwrap(d);
      if (!SHEETS.length) {
        tb.innerHTML = '<tr><td colspan="6" style="padding:10px;color:#9a3412;">暂无已发布阵容。可先在编辑器填写后「保存并发布到官网」。</td></tr>';
      } else {
        tb.innerHTML = SHEETS.map(renderRow).join('');
      }
      setBadge(roleName() + ' · 共 ' + SHEETS.length + ' 条 · ' + (isAdmin() ? '管理员（可操作全部）' : '仅可操作本人创建'));
      msg('列表已更新（' + new Date().toLocaleTimeString() + '）', 'ok');
      updateCurBar();
    }).catch(function (e) {
      tb.innerHTML = '<tr><td colspan="6" style="padding:10px;color:#b91c1c;">列表加载失败：' + esc((e && e.message) || '无权限或网络异常') + '</td></tr>';
      setBadge('加载失败');
      msg('列表加载失败：' + ((e && e.message) || '无权限或网络异常'), 'err');
    });
  }

  function renderRow(s) {
    var pub = isPublic(s);
    var can = canOperate(s);
    var dis = can ? '' : ' disabled title="仅阵容创建者或管理员可操作"';
    var opStyle = can ? '' : 'opacity:.45;cursor:not-allowed;';
    var pubTag = pub
      ? '<span style="color:#15803d;font-weight:700;">✅ 已公开</span>'
      : '<span style="color:#b45309;">⏸ 未公开</span>';
    return '' +
      '<tr style="border-top:1px solid #ffedd5;">' +
      '<td style="padding:6px 8px;white-space:nowrap;">' + esc(s.sheetNo || '-') + '</td>' +
      '<td style="padding:6px 8px;">' + esc(s.playTitle || '（未命名）') + '</td>' +
      '<td style="padding:6px 8px;white-space:nowrap;">' + esc(s.performanceDate || '-') + '</td>' +
      '<td style="padding:6px 8px;white-space:nowrap;">' + esc(s.statusText || s.status || '-') + '</td>' +
      '<td style="padding:6px 8px;white-space:nowrap;">' + pubTag + '</td>' +
      '<td style="padding:6px 8px;text-align:right;white-space:nowrap;">' +
      '<button type="button" data-cm="edit" data-id="' + esc(s.id) + '" style="' + opStyle + 'padding:3px 10px;border:1px solid #0369a1;background:#fff;color:#0369a1;border-radius:6px;cursor:pointer;margin-right:4px;"' + dis + '>✏ 编辑</button>' +
      '<button type="button" data-cm="toggle" data-id="' + esc(s.id) + '" style="' + opStyle + 'padding:3px 10px;border:1px solid #ea580c;background:#fff;color:#ea580c;border-radius:6px;cursor:pointer;margin-right:4px;"' + dis + '>' + (pub ? '⏸ 暂停公开' : '▶ 恢复公开') + '</button>' +
      '<button type="button" data-cm="del" data-id="' + esc(s.id) + '" style="' + opStyle + 'padding:3px 10px;border:1px solid #b91c1c;background:#fff;color:#b91c1c;border-radius:6px;cursor:pointer;"' + dis + '>🗑 删除</button>' +
      '</td></tr>';
  }

  function setBadge(txt) { var b = $('cmBadge'); if (b) b.textContent = txt; }

  /* ---------- 当前阵容操作条 ---------- */
  function updateCurBar() {
    var id = curSheetId();
    var s = byId(id);
    var name = $('cmCurName');
    if (name) name.textContent = s ? ((s.sheetNo || '') + ' ' + (s.playTitle || '') + ' [' + (s.statusText || '') + ']') : (id ? id : '（未选择）');
    var tg = $('cmToggle');
    if (tg) tg.textContent = (s && isPublic(s)) ? '⏸ 暂停公开' : '▶ 恢复公开';
    var can = s ? canOperate(s) : true;
    ['cmSaveDraft', 'cmToggle', 'cmDelete'].forEach(function (bid) {
      var b = $(bid);
      if (!b) return;
      if (!s) { b.disabled = true; b.style.opacity = '.5'; b.style.cursor = 'not-allowed'; return; }
      if (!can) { b.disabled = true; b.style.opacity = '.45'; b.style.cursor = 'not-allowed'; b.title = '仅阵容创建者或管理员可操作'; return; }
      b.disabled = false; b.style.opacity = ''; b.style.cursor = 'pointer'; b.removeAttribute('title');
    });
  }
  function curSheetId() {
    if (window.__castSheetReal && typeof window.__castSheetReal.getSheetId === 'function') {
      var v = window.__castSheetReal.getSheetId();
      if (v) return v;
    }
    var sel = $('rsSheet');
    return (sel && sel.value) || '';
  }

  /* ---------- 操作：公开切换 ---------- */
  function toggleVisibility(id, btn) {
    var s = byId(id);
    if (!s) { toast('未找到该阵容，请刷新列表', 'error'); return Promise.resolve(); }
    if (!canOperate(s)) { toast('🔒 仅阵容创建者或管理员可执行此操作', 'error'); return Promise.resolve(); }
    var A = api();
    if (!A) { toast('接口模块未就绪', 'error'); return Promise.resolve(); }
    var target = !isPublic(s); // 目标公开状态
    lockBtn(btn, '处理中…');
    msg(target ? '正在恢复公开…' : '正在暂停公开…');
    return A.post('/v1/cast-sheets/' + encodeURIComponent(id) + '/visibility', { public: target }, { showErrorToast: false }).then(function () {
      toast(target ? '✅ 已恢复公开，观众端可查看' : '✅ 已暂停公开，观众端不再展示', 'success');
      msg(target ? '已恢复公开' : '已暂停公开', 'ok');
      return refreshAll();
    }).catch(function (e) {
      var code = e && e.code ? e.code : '';
      if (code === 'FORBIDDEN' || (e && e.status === 403)) toast('🔒 无权限：仅阵容创建者或管理员可操作', 'error');
      else toast('操作失败：' + ((e && e.message) || '请稍后重试'), 'error');
      msg('操作失败：' + ((e && e.message) || '未知错误'), 'err');
    }).then(function () { unlockBtn(btn); });
  }

  /* ---------- 操作：删除（二次确认 + 关联校验） ---------- */
  function deleteSheet(id, btn) {
    var s = byId(id);
    if (!s) { toast('未找到该阵容，请刷新列表', 'error'); return Promise.resolve(); }
    if (!canOperate(s)) { toast('🔒 仅阵容创建者或管理员可执行此操作', 'error'); return Promise.resolve(); }
    var A = api();
    if (!A) { toast('接口模块未就绪', 'error'); return Promise.resolve(); }
    var ok = window.confirm(
      '⚠️ 二次确认：确定删除该阵容吗？\n\n' +
      '编号：' + (s.sheetNo || '-') + '\n剧目：' + (s.playTitle || '（未命名）') + '\n演出日期：' + (s.performanceDate || '-') + '\n\n' +
      '删除后将从所有列表与官网移除（数据将软删除，可审计追溯）。'
    );
    if (!ok) return Promise.resolve();
    lockBtn(btn, '删除中…');
    msg('正在删除…');
    return A.del('/v1/cast-sheets/' + encodeURIComponent(id), { showErrorToast: false }).then(function () {
      toast('✅ 已删除该阵容', 'success');
      msg('已删除', 'ok');
      return refreshAll();
    }).catch(function (e) {
      var code = e && e.code ? e.code : '';
      if (code === 'CONFLICT' || (e && e.status === 409)) toast('🚫 该阵容已被排期关联，请先解除关联后再删除', 'warning');
      else if (code === 'FORBIDDEN' || (e && e.status === 403)) toast('🔒 无权限：仅阵容创建者或管理员可操作', 'error');
      else toast('删除失败：' + ((e && e.message) || '请稍后重试'), 'error');
      msg('删除失败：' + ((e && e.message) || '未知错误'), 'err');
    }).then(function () { unlockBtn(btn); });
  }

  /* ---------- 操作：编辑（载入编辑器） ---------- */
  function editSheet(id, btn) {
    var s = byId(id);
    if (!s) { toast('未找到该阵容，请刷新列表', 'error'); return Promise.resolve(); }
    if (!canOperate(s)) { toast('🔒 仅阵容创建者或管理员可执行此操作', 'error'); return Promise.resolve(); }
    if (!(window.__castSheetReal && typeof window.__castSheetReal.loadById === 'function')) {
      toast('编辑器未就绪，请刷新页面后重试', 'error');
      return Promise.resolve();
    }
    lockBtn(btn, '载入中…');
    msg('正在载入到编辑器…');
    return window.__castSheetReal.loadById(id).then(function () {
      toast('已载入编辑器，可修改后「保存为草稿」或「重新发布」', 'success');
      msg('已载入编辑器', 'ok');
      var panel = $('realSyncBar');
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      updateCurBar();
    }).catch(function (e) {
      toast('载入失败：' + ((e && e.message) || '请稍后重试'), 'error');
    }).then(function () { unlockBtn(btn); });
  }

  /* ---------- 当前阵容：保存为草稿 / 切换 / 删除 ---------- */
  function curSaveDraft(btn) {
    if (!(window.__castSheetReal && typeof window.__castSheetReal.saveAsDraft === 'function')) { toast('编辑器未就绪', 'error'); return; }
    lockBtn(btn, '保存中…');
    Promise.resolve(window.__castSheetReal.saveAsDraft()).then(function () {
      toast('✅ 已保存为草稿（未公开到官网）', 'success');
      return refreshAll();
    }).catch(function (e) { toast('保存草稿失败：' + ((e && e.message) || '请检查必填项'), 'error'); })
      .then(function () { unlockBtn(btn); });
  }
  function curToggle(btn) {
    var id = curSheetId();
    if (!id) { toast('请先选择或载入一条阵容', 'warning'); return; }
    toggleVisibility(id, btn);
  }
  function curDelete(btn) {
    var id = curSheetId();
    if (!id) { toast('请先选择或载入一条阵容', 'warning'); return; }
    deleteSheet(id, btn);
  }

  /* ---------- 全量刷新 ---------- */
  function refreshAll() {
    var p = renderList();
    if (window.__castSheetReal && typeof window.__castSheetReal.refreshList === 'function') {
      return Promise.resolve(window.__castSheetReal.refreshList()).then(function () { return p; });
    }
    return p;
  }

  /* ---------- init ---------- */
  function init() {
    var panel = $('castManagePanel');
    if (!panel) return;

    if (!window.QAXQJT_API) {
      msg('未检测到接口模块，已发布阵容管理不可用（请在正式部署环境登录后使用）', 'err');
      setBadge('接口未就绪');
      return;
    }

    // 表格行操作（事件委托）
    var tb = $('cmTbody');
    if (tb) {
      tb.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-cm]') : null;
        if (!btn || btn.disabled) return;
        var act = btn.getAttribute('data-cm');
        var id = btn.getAttribute('data-id');
        if (act === 'edit') editSheet(id, btn);
        else if (act === 'toggle') toggleVisibility(id, btn);
        else if (act === 'del') deleteSheet(id, btn);
      });
    }

    var rf = $('cmRefresh');
    if (rf) rf.addEventListener('click', function () { lockBtn(rf, '刷新中…'); refreshAll().then(function () { unlockBtn(rf); }); });

    var sd = $('cmSaveDraft');
    if (sd) sd.addEventListener('click', function () { curSaveDraft(sd); });
    var tg = $('cmToggle');
    if (tg) tg.addEventListener('click', function () { curToggle(tg); });
    var dl = $('cmDelete');
    if (dl) dl.addEventListener('click', function () { curDelete(dl); });

    // 顶部「线上阵容」下拉变化 → 同步当前操作条
    var sel = $('rsSheet');
    if (sel) sel.addEventListener('change', function () { updateCurBar(); });

    renderList();
    // 编辑器/下拉可能稍后初始化完成，延迟再对齐一次当前操作条
    setTimeout(updateCurBar, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* 暴露给测试与联调 */
  window.__castSheetManage = {
    renderList: renderList,
    refreshAll: refreshAll,
    toggleVisibility: toggleVisibility,
    deleteSheet: deleteSheet,
    editSheet: editSheet,
    canOperate: canOperate,
    isAdmin: isAdmin,
    isPublic: isPublic,
    _rows: function () { return SHEETS; }
  };
})();
