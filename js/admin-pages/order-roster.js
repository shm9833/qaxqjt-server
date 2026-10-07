/* order-roster.js —— 洛门演出订单花名册 + 批量考勤（orders.html 第 5 段，v20261008a）
 * 能力：订单级人员明细 CRUD、Excel/CSV 导入（SheetJS 前端解析）、模板下载、批量考勤、
 *      自定义角色字典；与后端 /v1/order-roster/* 对接。
 * 纯 ES5 语法，无构建依赖。 */
(function () {
  'use strict';
  if (typeof document === 'undefined' || !document.getElementById('tab-roster')) return;

  var P = (window.QAXQJT_PATHS && window.QAXQJT_PATHS.ORDER_ROSTER) || '/v1/order-roster';
  var URL_ORDERS = (window.QAXQJT_PATHS && window.QAXQJT_PATHS.ORDERS) || '/v1/orders';
  var API = window.QAXQJT_API;

  var PERF_TEXT = { unconfirmed: '未确认', confirmed: '已确认', cancelled: '已取消', completed: '已完成' };
  var ATT_TEXT = { present: '出勤', absent: '缺勤', late: '迟到', early: '早退', leave: '请假', rest: '公休' };
  var ATT_BADGE = { present: 'badge-success', absent: 'badge-danger', late: 'badge-warning', early: 'badge-warning', leave: 'badge-info', rest: 'badge-secondary' };
  var DEFAULT_ROLES = ['主演', '配角', '龙套', '主持', '乐队', '舞美', '灯光', '音响', '服装', '道具', '化妆', '剧务', '后勤'];

  var state = { orderId: '', orders: [], roles: DEFAULT_ROLES.slice(), rows: [], editingId: null };

  function $(id) { return document.getElementById(id); }
  function hx(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') { try { window.showToast(msg, type || 'info'); return; } catch (_) {} }
    window.alert(msg);
  }
  function todayStr() { return new Date().toISOString().slice(0, 10); }

  /* ===== 前端预校验（与后端 validators 同规则，即时反馈；最终以后端为准）===== */
  function validName(v) { return /^[一-龥A-Za-z·．.・\s]{2,50}$/.test(String(v || '').trim()); }
  function validMobile(v) { return /^1[3-9]\d{9}$/.test(String(v || '').trim()); }
  function validIdCard(v) {
    var s = String(v || '').trim().toUpperCase();
    if (!/^\d{17}[\dX]$/.test(s)) return false;
    var y = +s.substring(6, 10), m = +s.substring(10, 12), d = +s.substring(12, 14);
    if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
    var w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    var c = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
    var sum = 0;
    for (var i = 0; i < 17; i++) sum += (+s[i]) * w[i];
    return c[sum % 11] === s[17];
  }

  /* ===== SheetJS 懒加载 ===== */
  var xlsxPromise = null;
  function ensureXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '../js/xlsx.min.js';
      s.onload = function () { window.XLSX ? resolve(window.XLSX) : reject(new Error('xlsx 加载失败')); };
      s.onerror = function () { reject(new Error('xlsx.min.js 加载失败，请检查网络后重试')); };
      document.head.appendChild(s);
      setTimeout(function () { if (!window.XLSX) reject(new Error('xlsx 加载超时')); }, 12000);
    });
    return xlsxPromise;
  }

  /* ===== 订单下拉 ===== */
  function loadOrders() {
    return API.get(URL_ORDERS, { query: { page: 1, pageSize: 500 }, showErrorToast: false }).then(function (resp) {
      var rows = Array.isArray(resp) ? resp : (resp && (resp.items || resp.list || resp.rows)) || [];
      state.orders = rows;
      var sel = $('rosOrderSelect');
      var prev = state.orderId;
      sel.innerHTML = '<option value="">— 请先选择订单 —</option>' + rows.map(function (o) {
        var label = String(o.orderNo || o.id || '') + '｜' + String(o.customerName || o.organization || '未命名客户')
          + (o.performanceStartDate ? '｜' + String(o.performanceStartDate).slice(0, 10) : '');
        return '<option value="' + hx(o.id) + '">' + hx(label) + '</option>';
      }).join('');
      if (prev && rows.some(function (o) { return o.id === prev; })) sel.value = prev;
    }).catch(function () { /* 静默：未选订单时无意义报错 */ });
  }

  /* ===== 角色字典 ===== */
  function loadRoles(selectValue) {
    return API.get(P + '/roles').then(function (d) {
      state.roles = (d && d.roles) || DEFAULT_ROLES.slice();
      renderRoleOptions(selectValue);
    }).catch(function () { renderRoleOptions(selectValue); });
  }
  function roleOptionsHtml(sel) {
    var extra = (sel && state.roles.indexOf(sel) < 0) ? ['<option value="' + hx(sel) + '">' + hx(sel) + '</option>'] : [];
    return extra.concat(state.roles.map(function (r) {
      return '<option value="' + hx(r) + '"' + (r === sel ? ' selected' : '') + '>' + hx(r) + '</option>';
    })).join('');
  }
  function renderRoleOptions(sel) {
    var s = $('rosFRole');
    if (s) s.innerHTML = roleOptionsHtml(sel);
  }

  /* ===== 花名册列表 + 统计 ===== */
  function currentQuery() {
    return {
      orderId: state.orderId,
      page: 1,
      pageSize: 500,
      keyword: ($('rosFilterKeyword').value || '').trim(),
      performStatus: $('rosFilterPerf').value,
      attendanceStatus: $('rosFilterAtt').value
    };
  }

  function loadRoster() {
    if (!state.orderId) return Promise.resolve();
    var tb = $('rosTbody');
    tb.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:24px;color:#94a3b8;">正在加载花名册…</td></tr>';
    return Promise.all([
      API.get(P, { query: currentQuery() }),
      API.get(P + '/stats', { query: { orderId: state.orderId } }).catch(function () { return null; })
    ]).then(function (rs) {
      var resp = rs[0];
      state.rows = Array.isArray(resp) ? resp : (resp && (resp.items || resp.list || resp.rows)) || [];
      renderStats(rs[1]);
      renderRows();
    }).catch(function () {
      tb.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:24px;color:#f87171;">加载失败，请稍后重试</td></tr>';
    });
  }

  function renderStats(s) {
    var box = $('rosStats');
    if (!s) { box.style.display = 'none'; return; }
    box.style.display = 'flex';
    var pb = s.performBreakdown || {};
    $('rosStatTotal').textContent = s.total || 0;
    $('rosStatConfirmed').textContent = pb.confirmed || 0;
    $('rosStatUnconfirmed').textContent = pb.unconfirmed || 0;
    $('rosStatCancelled').textContent = pb.cancelled || 0;
    $('rosStatCompleted').textContent = pb.completed || 0;
    $('rosStatUnattended').textContent = s.unAttended || 0;
  }

  function perfSelect(cur) {
    return '<select class="ros-perf-sel" data-ros-field="performStatus" data-ros-id="{ID}">'
      + Object.keys(PERF_TEXT).map(function (k) {
        return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + PERF_TEXT[k] + '</option>';
      }).join('') + '</select>';
  }
  function attBadge(v) {
    if (!v) return '<span class="badge badge-secondary">未考勤</span>';
    var cls = ATT_BADGE[v] || 'badge-secondary';
    return '<span class="badge ' + cls + '">' + (ATT_TEXT[v] || v) + '</span>';
  }

  function renderRows() {
    var tb = $('rosTbody');
    if (!state.rows.length) {
      tb.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:30px;color:#94a3b8;">该订单暂无花名册人员，点「➕ 新增人员」或「📥 Excel 导入」开始</td></tr>';
      return;
    }
    tb.innerHTML = state.rows.map(function (r, i) {
      var roleSel = '<select class="ros-role-sel" data-ros-field="roleName" data-ros-id="' + hx(r.id) + '">' + roleOptionsHtml(r.roleName) + '</select>';
      var pSel = perfSelect(r.performStatus).replace('{ID}', hx(r.id));
      return '<tr data-ros-id="' + hx(r.id) + '">'
        + '<td><input type="checkbox" class="ros-row-cb" value="' + hx(r.id) + '"></td>'
        + '<td>' + (i + 1) + '</td>'
        + '<td>' + hx(r.name) + '</td>'
        + '<td style="font-family:monospace;white-space:nowrap;">' + hx(r.idCardNo) + '</td>'
        + '<td>' + hx(r.phone) + '</td>'
        + '<td>' + roleSel + '</td>'
        + '<td>' + pSel + '</td>'
        + '<td>' + attBadge(r.attendanceStatus) + '</td>'
        + '<td>' + hx(r.attendanceDate || '—') + '</td>'
        + '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + hx(r.remark || '') + '">' + hx(r.remark || '—') + '</td>'
        + '<td><button class="btn btn-secondary btn-sm" data-ros-edit="' + hx(r.id) + '" type="button">编辑</button></td>'
        + '</tr>';
    }).join('');
  }

  /* ===== 弹窗：新增 / 编辑 ===== */
  function openModal(id) {
    state.editingId = id || null;
    var row = id ? state.rows.filter(function (r) { return r.id === id; })[0] : null;
    $('rosModalTitle').textContent = row ? '编辑花名册人员' : '新增花名册人员';
    $('rosFName').value = row ? row.name : '';
    $('rosFPhone').value = row ? row.phone : '';
    $('rosFIdCard').value = row ? row.idCardNo : '';
    $('rosFPerf').value = row ? (row.performStatus || 'unconfirmed') : 'unconfirmed';
    $('rosFAtt').value = row ? (row.attendanceStatus || '') : '';
    $('rosFAttDate').value = row ? (row.attendanceDate || '') : '';
    $('rosFRemark').value = row ? (row.remark || '') : '';
    renderRoleOptions(row ? row.roleName : state.roles[0]);
    $('rosFIdCard').disabled = !!row; // 身份证为业务键，编辑时锁定，避免误改唯一键
    $('rosFDelete').style.display = row ? 'inline-block' : 'none';
    $('rosModalOverlay').style.display = 'flex';
  }
  function closeModal() { $('rosModalOverlay').style.display = 'none'; state.editingId = null; }

  function collectModal() {
    var v = {
      name: ($('rosFName').value || '').trim(),
      phone: ($('rosFPhone').value || '').trim(),
      idCardNo: ($('rosFIdCard').value || '').trim().toUpperCase(),
      roleName: $('rosFRole').value,
      performStatus: $('rosFPerf').value,
      attendanceStatus: $('rosFAtt').value || null,
      attendanceDate: $('rosFAttDate').value || '',
      remark: ($('rosFRemark').value || '').trim()
    };
    if (!validName(v.name)) { toast('姓名须为 2-50 个汉字/字母字符', 'error'); return null; }
    if (!validIdCard(v.idCardNo)) { toast('身份证号格式非法：需 18 位且校验码正确（GB 11643）', 'error'); return null; }
    if (!validMobile(v.phone)) { toast('联系方式须为 11 位有效手机号', 'error'); return null; }
    if (!v.roleName) { toast('请选择角色分配（可自定义）', 'error'); return null; }
    if (!v.attendanceStatus) v.attendanceStatus = null;
    if (!v.attendanceDate) v.attendanceDate = '';
    return v;
  }

  function saveModal() {
    var v = collectModal();
    if (!v) return;
    var btn = $('rosFSave');
    btn.disabled = true;
    var done = function () { btn.disabled = false; closeModal(); loadRoster(); };
    var fail = function () { btn.disabled = false; };
    if (state.editingId) {
      // 编辑不传身份证（业务键锁定）
      var payload = { name: v.name, phone: v.phone, roleName: v.roleName, performStatus: v.performStatus };
      payload.attendanceStatus = v.attendanceStatus;
      payload.attendanceDate = v.attendanceDate;
      payload.remark = v.remark;
      API.patch(P + '/' + encodeURIComponent(state.editingId), payload).then(function () {
        toast('✅ 已保存', 'success'); done();
      }).catch(fail);
    } else {
      v.orderId = state.orderId;
      API.post(P, v).then(function () { toast('✅ 已新增', 'success'); done(); }).catch(fail);
    }
  }

  function deleteRow() {
    if (!state.editingId) return;
    if (!window.confirm('确认删除该花名册人员？删除后不可恢复。')) return;
    API.del(P + '/' + encodeURIComponent(state.editingId)).then(function () {
      toast('🗑 已删除', 'success'); closeModal(); loadRoster();
    }).catch(function () {});
  }

  function addCustomRole() {
    var name = window.prompt('输入新角色名称（1-30 字，如：板胡）');
    if (name == null) return;
    name = name.trim();
    if (!name || name.length > 30) { toast('角色名称必填（1-30 字符）', 'error'); return; }
    API.post(P + '/roles', { name: name }).then(function (d) {
      state.roles = (d && d.roles) || state.roles;
      renderRoleOptions(name);
      toast('✅ 角色「' + name + '」已加入字典', 'success');
    }).catch(function () {});
  }

  /* ===== 行内快捷修改（角色/参演状态）===== */
  function onTableChange(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var field = t.getAttribute('data-ros-field');
    var id = t.getAttribute('data-ros-id');
    if (!field || !id) return;
    var body = {};
    body[field] = t.value;
    API.patch(P + '/' + encodeURIComponent(id), body).then(function () {
      toast('✅ 已更新', 'success');
      var row = state.rows.filter(function (r) { return r.id === id; })[0];
      if (row) row[field] = t.value;
      if (field === 'performStatus') API.get(P + '/stats', { query: { orderId: state.orderId } }).then(renderStats).catch(function () {});
    }).catch(function () { loadRoster(); });
  }

  /* ===== Excel / CSV 导入 ===== */
  function pickImportFile() {
    if (!state.orderId) { toast('请先选择订单', 'warning'); return; }
    $('rosImportFile').value = '';
    $('rosImportFile').click();
  }

  function normalizeSheetRows(rows) {
    // Date 单元格（cellDates）→ YYYY-MM-DD；数字去尾零；其余原样（后端做表头/别名归一）
    return rows.map(function (row) {
      var out = {};
      Object.keys(row).forEach(function (k) {
        var v = row[k];
        if (v instanceof Date && !isNaN(v.getTime())) {
          v = v.toISOString().slice(0, 10);
        } else if (typeof v === 'number' && isFinite(v)) {
          v = String(v);
        } else if (v != null) {
          v = String(v).trim();
        }
        out[k] = v == null ? '' : v;
      });
      return out;
    });
  }

  function onImportFileChange(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast('文件过大（>15MB），请拆分后导入', 'error'); return; }
    ensureXlsx().then(function (XLSX) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        var data = new Uint8Array(ev.target.result);
        var wb;
        try { wb = XLSX.read(data, { type: 'array', cellDates: true }); }
        catch (err) { toast('文件解析失败：' + (err.message || err), 'error'); return; }
        var ws = wb.Sheets[wb.SheetNames[0]];
        var raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
        var items = normalizeSheetRows(raw);
        if (!items.length) { toast('未从首个工作表解析到任何数据行', 'warning'); return; }
        if (items.length > 500) { toast('单批最多 500 行（当前 ' + items.length + ' 行），请拆分', 'error'); return; }
        toast('📥 正在导入 ' + items.length + ' 行…', 'info');
        API.post(P + '/import', { orderId: state.orderId, items: items }).then(function (d) {
          showImportResult(d);
          loadRoster();
        }).catch(function () {});
      };
      reader.readAsArrayBuffer(file);
    }).catch(function (err) { toast(err.message || 'Excel 组件加载失败', 'error'); });
  }

  function showImportResult(d) {
    if (!d) return;
    if (!d.failedCount) {
      toast('✅ 导入完成：新建 ' + d.created + ' 人，更新 ' + d.updated + ' 人', 'success');
      $('rosFailedPanel').style.display = 'none';
      return;
    }
    toast('⚠️ 导入完成：新建 ' + d.created + ' / 更新 ' + d.updated + ' / 失败 ' + d.failedCount + ' 行', 'warning');
    $('rosFailedTbody').innerHTML = d.failed.map(function (f) {
      return '<tr><td>第 ' + (f.index + 2) + ' 行</td><td>' + hx(f.name || '—') + '</td><td>' + hx(f.reason) + '</td></tr>';
    }).join('');
    $('rosFailedPanel').style.display = 'block';
  }

  /* ===== 模板下载 ===== */
  function downloadTemplate() {
    ensureXlsx().then(function (XLSX) {
      var aoa = [
        ['姓名', '身份证号', '联系方式', '角色分配', '参演状态', '考勤状态', '考勤日期', '备注'],
        ['张三', '110101199003078830', '13993839833', '主演', '已确认', '出勤', todayStr(), '示例行，导入前请删除'],
        ['李四', '620522199508124568', '18800002222', '乐队', '未确认', '', '', '角色/状态支持中文'],
        ['', '', '', '', '', '', '', ''],
        ['说明', '参演状态：已确认/未确认/已取消/已完成；考勤状态：出勤/缺勤/迟到/早退/请假/公休', '', '', '', '', '', '']
      ];
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 30 }];
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '花名册');
      XLSX.writeFile(wb, '洛门演出花名册导入模板_' + todayStr() + '.xlsx');
    }).catch(function (err) { toast(err.message || 'Excel 组件加载失败', 'error'); });
  }

  /* ===== 批量考勤 ===== */
  function batchAttendance(status) {
    if (!state.orderId) { toast('请先选择订单', 'warning'); return; }
    var ids = Array.prototype.slice.call(document.querySelectorAll('.ros-row-cb:checked')).map(function (cb) { return cb.value; });
    var scope = ids.length ? '已勾选 ' + ids.length + ' 人' : '当前订单全部人员';
    if (!window.confirm('确认将「' + scope + '」的考勤状态更新为「' + ATT_TEXT[status] + '」？')) return;
    var body = { attendanceStatus: status };
    var dt = ($('rosBatchDate').value || '').trim();
    if (dt) body.attendanceDate = dt;
    if (ids.length) { body.orderId = state.orderId; body.ids = ids; } else { body.orderId = state.orderId; }
    API.post(P + '/batch-attendance', body).then(function (d) {
      toast('✅ 已更新 ' + (d.updated || 0) + ' 人考勤为「' + ATT_TEXT[status] + '」', 'success');
      Array.prototype.forEach.call(document.querySelectorAll('.ros-row-cb'), function (cb) { cb.checked = false; });
      $('rosCheckAll').checked = false;
      loadRoster();
    }).catch(function () {});
  }

  /* ===== 事件绑定 ===== */
  function bind() {
    $('rosOrderSelect').addEventListener('change', function () {
      state.orderId = this.value;
      var on = !!state.orderId;
      $('rosAddBtn').disabled = !on;
      $('rosImportBtn').disabled = !on;
      $('rosFailedPanel').style.display = 'none';
      if (on) loadRoster(); else { state.rows = []; renderRows(); $('rosStats').style.display = 'none'; }
    });
    $('rosQueryBtn').addEventListener('click', loadRoster);
    $('rosFilterKeyword').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadRoster(); });
    $('rosFilterPerf').addEventListener('change', loadRoster);
    $('rosFilterAtt').addEventListener('change', loadRoster);

    $('rosAddBtn').addEventListener('click', function () { loadRoles().then(function () { openModal(null); }); });
    $('rosImportBtn').addEventListener('click', pickImportFile);
    $('rosImportFile').addEventListener('change', onImportFileChange);
    $('rosTplBtn').addEventListener('click', downloadTemplate);

    Array.prototype.forEach.call(document.querySelectorAll('[data-ros-batch]'), function (b) {
      b.addEventListener('click', function () { batchAttendance(b.getAttribute('data-ros-batch')); });
    });
    $('rosCheckAll').addEventListener('change', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.ros-row-cb'), function (cb) { cb.checked = $('rosCheckAll').checked; });
    });
    $('rosTbody').addEventListener('change', onTableChange);
    $('rosTbody').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-ros-edit]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-ros-edit');
      loadRoles().then(function () { openModal(id); });
    });

    $('rosFSave').addEventListener('click', saveModal);
    $('rosFCancel').addEventListener('click', closeModal);
    $('rosFDelete').addEventListener('click', deleteRow);
    $('rosFRoleAdd').addEventListener('click', addCustomRole);
    $('rosModalOverlay').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('rosModalOverlay').style.display === 'flex') closeModal();
    });
  }

  function init() {
    if (!API) { console.warn('[order-roster] QAXQJT_API 未就绪'); return; }
    bind();
    $('rosBatchDate').value = todayStr();
    loadOrders();
    loadRoles();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
