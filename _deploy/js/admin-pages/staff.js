/* staff.js — 从 admin/staff.html 抽取的内联脚本（第 4/4 段，保持原执行位置） */

/* ===== staff.html inline block (run 4, #1/6) ===== */
/* ========== 🔧 演职人员花名册：行按钮真实功能（查看/编辑/考勤/排班/停启用）+ 原地刷新 + localStorage 持久化 ========== */
(function(){
  if (window.__STF_ROSTER_V1__) return;
  window.__STF_ROSTER_V1__ = true;

  var PATCH_KEY = 'qaxqjt_admin_staff_patch_v1';
  var DEPTS = ['演员队','乐队','舞美队','服装道具','行政'];

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function toast(msg, type){
    try { if (typeof window.__T === 'function') { window.__T(msg, type||'info'); return; } } catch(_e){}
    try { if (typeof window.__toastH9 === 'function') { window.__toastH9(msg, type||'info'); return; } } catch(_e2){}
    try { window.QinApp && QinApp.Utils && QinApp.Utils.toast(msg, type||'info', 3000); return; } catch(_e3){}
    (type==='error' ? alert : console.log)(msg);
  }

  // 花名册 = 页面第一个 data-paginate tbody；行结构：1复选 2工号 3姓名 4性别 5年龄 6队别 7行当 8年份 9电话 10剧目 11状态 12场次 13操作
  // 健壮定位：HeightGuard 可能剥掉 data-paginate 属性 → 先按 roster-table 类找，再降级到 data-paginate，
  // 并按表头含"工号"字样过滤（避免误绑到考勤 tab 的 tbody）
  function rosterTbody(){
    var rt = document.querySelector('table.roster-table');
    if (rt) { var b = rt.querySelector('tbody'); if (b) return b; }
    var list = document.querySelectorAll('tbody[data-paginate="list"]');
    for (var i = 0; i < list.length; i++) {
      var tbl = list[i].closest('table');
      if (tbl && (tbl.textContent || '').indexOf('工号') >= 0) return list[i];
    }
    return (list && list.length) ? list[0] : null;
  }
  function rowCells(tr){ return tr ? tr.querySelectorAll('td') : null; }
  function cellText(tr, idx){
    var t = rowCells(tr);
    return (t && t[idx] ? (t[idx].textContent||'').replace(/\s+/g,' ').trim() : '');
  }
  function findRowByGh(gh){
    var tb = rosterTbody(); if(!tb || !gh) return null;
    var rows = tb.querySelectorAll('tr');
    for (var i=0;i<rows.length;i++){ if (cellText(rows[i],1) === String(gh)) return rows[i]; }
    return null;
  }

  // ---- localStorage patch 持久化（刷新不丢）----
  function patchRead(){ try { return JSON.parse(localStorage.getItem(PATCH_KEY)||'{}')||{}; } catch(_){ return {}; } }
  function patchWrite(obj){ try { localStorage.setItem(PATCH_KEY, JSON.stringify(obj||{})); } catch(e){ console.warn('[staff patch 写入失败]', e); } }
  function patchUpsert(gh, fields){
    if(!gh) return;
    var obj = patchRead();
    obj[String(gh)] = Object.assign({}, obj[String(gh)]||{}, fields||{}, { _updatedAt: new Date().toISOString() });
    patchWrite(obj);
  }
  function applyPatchToRow(tr, p){
    if(!tr || !p) return;
    var t = rowCells(tr); if(!t || t.length < 11) return;
    if (typeof p.name === 'string' && t[2]) t[2].innerHTML = '<strong>'+esc(p.name)+'</strong>';
    if (typeof p.gender === 'string' && t[3]) t[3].innerText = p.gender;
    if (p.age !== undefined && p.age !== null && p.age !== '' && t[4]) t[4].innerText = String(p.age);
    if (typeof p.dept === 'string' && t[5]) t[5].innerHTML = '<span class="dept-tag actor">'+esc(p.dept)+'</span>';
    if (typeof p.role === 'string' && t[6]) t[6].innerHTML = '<span class="role-tag">'+esc(p.role)+'</span>';
    if (p.year !== undefined && p.year !== null && p.year !== '' && t[7]) t[7].innerText = String(p.year);
    if (typeof p.phone === 'string' && p.phone && t[8]) t[8].innerText = p.phone;
    if (typeof p.rep === 'string' && p.rep && t[9]) t[9].innerText = p.rep;
    if (p.status === 'on' || p.status === 'off') syncStatus(tr, p.status, true);
  }
  function applyAllPatches(){
    var obj = patchRead();
    var ghs = Object.keys(obj);
    for (var i=0;i<ghs.length;i++){
      var tr = findRowByGh(ghs[i]);
      if (tr) applyPatchToRow(tr, obj[ghs[i]]);
    }
  }

  // ---- 状态同步（原地刷新 badge + 🚫按钮文案）----
  function syncStatus(tr, status, silent){
    var t = rowCells(tr); if(!t || !t[10]) return;
    var on = status !== 'off';
    var badge = t[10].querySelector('.status-badge');
    if (badge){ badge.className = 'status-badge ' + (on ? 'on' : 'off'); badge.innerText = on ? '● 在岗' : '○ 停用'; }
    else { t[10].innerHTML = '<span class="status-badge '+(on?'on':'off')+'">'+(on?'● 在岗':'○ 停用')+'</span>'; }
    var acts = t[12] ? t[12].querySelectorAll('.admin-table-actions button') : null;
    if (acts && acts[4]){
      var b = acts[4];
      b.innerText = on ? '🚫' : '✅';
      b.title = on ? '禁用' : '启用';
      b.style.background = on ? 'rgba(220,53,69,0.1)' : 'rgba(40,167,69,0.12)';
      b.style.color = on ? '#dc3545' : '#28a745';
    }
    if (!silent) toast(on ? '✓ 已启用：'+cellText(tr,2) : '✕ 已停用：'+cellText(tr,2)+'（刷新不丢失）', on ? 'success' : 'warning');
  }

  // ---- 查看/编辑弹窗 ----
  var editCtx = { gh: '', readonly: false };
  function fillForm(tr){
    $('inp_stf_gh').value = cellText(tr,1);
    $('inp_stf_name').value = cellText(tr,2);
    $('inp_stf_gender').value = cellText(tr,3) || '男';
    $('inp_stf_age').value = cellText(tr,4);
    var dept = cellText(tr,5); if (DEPTS.indexOf(dept) < 0) dept = '演员队';
    $('inp_stf_dept').value = dept;
    $('inp_stf_role').value = cellText(tr,6);
    $('inp_stf_year').value = cellText(tr,7);
    // 修复：列表里手机号是脱敏格式（139****1234），原样填入会导致保存时校验必然失败（弹窗关不上、列表不刷新）
    var rawPhone = cellText(tr,8);
    var phoneMasked = /[*＊]/.test(rawPhone);
    $('inp_stf_phone').value = phoneMasked ? '' : rawPhone;
    $('inp_stf_phone').placeholder = phoneMasked ? ('原号码 ' + rawPhone + '，留空表示不修改') : '';
    $('inp_stf_rep').value = cellText(tr,9);
    editCtx.phoneMasked = phoneMasked ? rawPhone : '';
  }
  window.openStaffEditModal = function(gh, readonly){
    var tr = findRowByGh(gh);
    if (!tr){ toast('⚠️ 未找到工号 '+gh+' 对应的记录','warning'); return; }
    var performerId = tr.getAttribute('data-performer-id') || '';
    editCtx = { gh: String(gh), readonly: !!readonly, performerId: performerId };
    fillForm(tr);
    ['inp_stf_name','inp_stf_gender','inp_stf_age','inp_stf_dept','inp_stf_role','inp_stf_year','inp_stf_phone','inp_stf_idcard','inp_stf_rep'].forEach(function(id){
      var el = $(id); if (el){ el.disabled = !!readonly; el.style.background = readonly ? '#f5f5f5' : '#fff'; }
    });
    $('staffEditTitle').innerText = readonly ? ('👁 查看详情 · '+cellText(tr,2)) : ('✏️ 编辑演职人员 · '+cellText(tr,2));
    $('staffEditSaveBtn').style.display = readonly ? 'none' : '';
    $('staffEditModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  };
  window.closeStaffEditModal = function(){
    var m = $('staffEditModal'); if (m) m.style.display = 'none';
    document.body.style.overflow = '';
  };
  window.saveStaffEdit = function(){
    if (editCtx.readonly) return;
    if (window.__OP_LOCKS && window.__OP_LOCKS.saveStaffEdit){ toast('⏳ 正在保存，请稍候…','warning'); return; }
    try { window.__OP_LOCKS = window.__OP_LOCKS || {}; window.__OP_LOCKS.saveStaffEdit = true; setTimeout(function(){ try{ delete window.__OP_LOCKS.saveStaffEdit; }catch(_){} }, 600); } catch(_l){}
    var name = ($('inp_stf_name').value||'').trim();
    if (!name){ toast('❌ 姓名不能为空','error'); return; }
    var phone = ($('inp_stf_phone').value||'').trim();
    if (phone && /[*＊]/.test(phone)) phone = ''; // 兜底：残留脱敏号码一律视为“不修改”
    if (phone && !/^1[3-9]\d{9}$/.test(phone)){ toast('❌ 手机号格式不正确（11 位中国大陆手机号）','error'); return; }
    var age = ($('inp_stf_age').value||'').trim();
    if (age !== '' && (parseInt(age,10) < 16 || parseInt(age,10) > 90)){ toast('❌ 年龄需在 16~90 之间','error'); return; }
    var data = {
      name: name,
      gender: $('inp_stf_gender').value || '男',
      age: age === '' ? '' : parseInt(age,10),
      dept: $('inp_stf_dept').value || '演员队',
      role: ($('inp_stf_role').value||'').trim(),
      year: ($('inp_stf_year').value||'').trim(),
      phone: phone,
      rep: ($('inp_stf_rep').value||'').trim()
    };
    var tr = findRowByGh(editCtx.gh);
    // v20260907k：调用后端 API 持久化（PATCH 更新 / POST 新增）
    var apiPayload = {
      name: data.name,
      gender: data.gender,
      primaryRole: data.role || data.dept,
      department: data.dept,
      phone: phone || undefined,
      hireDate: data.year ? (data.year + '-01-01') : undefined
    };
    // 移除 undefined 字段
    Object.keys(apiPayload).forEach(function(k){ if(apiPayload[k]===undefined) delete apiPayload[k]; });
    var QinFetch = window.QAXQJT_API || (window.parent && window.parent.QAXQJT_API);
    var isNewPerformer = editCtx.isNew || false;
    var apiMethod = isNewPerformer ? 'POST' : 'PATCH';
    var performerId = editCtx.performerId || (window.__PF_EDIT__ && window.__PF_EDIT__.id) || editCtx.gh;
    var apiUrl = isNewPerformer ? (QAXQJT_PATHS.PERFORMERS || (QAXQJT_PATHS.PERFORMERS || '/v1/performers')) : ((QAXQJT_PATHS.PERFORMERS_BY_ID || function (i) { return '/v1/performers/' + i; })(encodeURIComponent(performerId)));
    if (!QinFetch || typeof QinFetch.request !== 'function') {
      // 降级：localStorage
      try { patchUpsert(editCtx.gh, persisted); } catch(_){}
      if (tr){
        var t = rowCells(tr);
        if (t[2]) t[2].innerHTML = '<strong>'+esc(data.name)+'</strong>';
        if (t[3]) t[3].innerText = data.gender;
        if (t[4]) t[4].innerText = (data.age === '' ? '—' : String(data.age));
        if (t[5]) t[5].innerHTML = '<span class="dept-tag actor">'+esc(data.dept)+'</span>';
        if (t[6]) t[6].innerHTML = '<span class="role-tag">'+esc(data.role)+'</span>';
      }
      closeStaffEditModal();
      toast('✅ 已保存（降级 localStorage）：'+data.name,'success');
      return;
    }
    toast('⏳ 正在保存到后端...','info', 2000);
    QinFetch.request(apiMethod, apiUrl, { body: apiPayload }).then(function(resp){
      var saved = resp && resp.data ? resp.data : {};
      // 更新 UI
      if (tr){
        var t = rowCells(tr);
        if (t[2]) t[2].innerHTML = '<strong>'+esc(data.name)+'</strong>';
        if (t[3]) t[3].innerText = data.gender;
        if (t[4]) t[4].innerText = (data.age === '' ? '—' : String(data.age));
        if (t[5]) t[5].innerHTML = '<span class="dept-tag actor">'+esc(data.dept)+'</span>';
        if (t[6]) t[6].innerHTML = '<span class="role-tag">'+esc(data.role)+'</span>';
        if (t[7]) t[7].innerText = data.year || '—';
        if (t[8] && phone) t[8].innerText = phone;
        if (t[9]) t[9].innerText = (data.rep || '—');
      }
      closeStaffEditModal();
      toast('✅ 已保存：'+data.name+'（'+data.dept+(data.role ? ' · '+data.role : '')+'），已同步后端 /v1/performers','success', 3500);
    }).catch(function(err){
      console.warn('[saveStaffEdit] API fail:', err);
      // 降级 localStorage
      try { patchUpsert(editCtx.gh, persisted); } catch(_){}
      closeStaffEditModal();
      toast('⚠️ 后端保存失败，已降级本地存储：'+(err && err.message ? err.message : '网络错误'),'warning', 4000);
    });
  };

  // ---- 行按钮动作分发（事件委托 + 初始化打标防兜底拦截）----
  function markRosterButtons(){
    var tb = rosterTbody(); if(!tb) return;
    var btns = tb.querySelectorAll('.admin-table-actions button');
    for (var i=0;i<btns.length;i++){ btns[i].__superPatchBound = 1; btns[i].__stfBound = 1; }
  }
  function bindRosterDelegation(){
    var tb = rosterTbody(); if(!tb || tb.__stfDelegated) return;
    tb.__stfDelegated = true;
    tb.addEventListener('click', function(e){
      var btn = e.target && e.target.closest ? e.target.closest('.admin-table-actions button') : null;
      if (!btn || !tb.contains(btn)) return;
      // 修复：行按钮 title（编辑/查看/考勤录入/排班）会被 app.js 全局委托劫持再开一套通用弹窗，
      // 我们这层保存关闭后 overlay 残留导致页面假死 → 在 tbody 层截断冒泡，app.js 的 document 委托收不到
      e.stopPropagation();
      e.preventDefault();
      var tr = btn.closest('tr'); if (!tr) return;
      var gh = cellText(tr,1), name = cellText(tr,2);
      var acts = tr.querySelectorAll('.admin-table-actions button');
      var idx = -1; for (var i=0;i<acts.length;i++){ if (acts[i] === btn){ idx = i; break; } }
      if (idx === 0){ openStaffEditModal(gh, true); }                    // 👁 查看详情
      else if (idx === 1){ openStaffEditModal(gh, false); }              // ✏️ 编辑
      else if (idx === 2){                                               // 🕐 考勤录入 → 切到考勤管理页签
        try {
          var tab = document.querySelector('#staffTabs .staff-tab[data-tab="attendance"]');
          if (tab) tab.click();
          toast('🕐 已切换到「考勤管理」页签，可为 '+name+'（'+gh+'）录入考勤','info');
        } catch(_t){ toast('🕐 请前往「考勤管理」页签为 '+name+'（'+gh+'）录入考勤','info'); }
      }
      else if (idx === 3){                                               // 📅 排班 → 排班管理页
        if (confirm('是否跳转到「排班管理」页面为 '+name+'（'+gh+'）安排档期？')){ window.location.href = 'schedule.html'; }
      }
      else if (idx === 4){                                               // 🚫/✅ 停用/启用
        var curOff = (cellText(tr,10).indexOf('停用') >= 0) || ((btn.innerText||'').indexOf('✅') >= 0);
        var next = curOff ? 'on' : 'off';
        if (!curOff && !confirm('确定要停用 '+name+'（'+gh+'）吗？停用后该员工将无法接单/排班。')) return;
        syncStatus(tr, next);
        patchUpsert(gh, { status: next });
      }
    });
  }
  function init(){ markRosterButtons(); bindRosterDelegation(); applyAllPatches(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  setTimeout(init, 600); // 兜底脚本/分页就绪后再补一轮（幂等）
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape'){ var m = $('staffEditModal'); if (m && m.style.display !== 'none') closeStaffEditModal(); }
  });
  /* v20260929fix：点击遮罩空白处关闭新增/编辑人员弹窗（target 为遮罩本身，不影响内容区点击），与全站弹窗交互一致 */
  (function(){ var m = document.getElementById('staffEditModal'); if (m) m.addEventListener('click', function(e){ if (e.target === m) closeStaffEditModal(); }); })();
})();

/* ===== staff.html inline block (run 4, #2/6) ===== */
/* ========== 🔌 花名册真实后端接线 v20260906f：/v1/performers 列表渲染 + 新增/编辑/停启用写库（后端不可达时显示空态，绝不保留演示数据） ========== */
(function(){
  if (window.__STF_API_V1__) return; window.__STF_API_V1__ = true;
  var API = window.QAXQJT_API;
  if (!API || typeof API.get !== 'function') return;

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function toast(msg, type){
    try { if (typeof window.__T === 'function') { window.__T(msg, type||'info'); return; } } catch(_e){}
    try { if (typeof window.__toastH9 === 'function') { window.__toastH9(msg, type||'info'); return; } } catch(_e2){}
    try { window.QinApp && QinApp.Utils && QinApp.Utils.toast(msg, type||'info', 3000); return; } catch(_e3){}
    console.log(msg);
  }
  function tb(){
    // 花名册 = table.roster-table 的 tbody（HeightGuard 可能剥掉 data-paginate 属性，
    // 导致 querySelectorAll('[data-paginate]')[0] 错认成考勤 tab 的 tbody，误渲染到隐藏表）
    var rt = document.querySelector('table.roster-table');
    if (rt) { var b = rt.querySelector('tbody'); if (b) return b; }
    var l = document.querySelectorAll('tbody[data-paginate="list"]');
    for (var i = 0; i < l.length; i++) {
      var t = l[i].closest('table');
      if (t && (t.textContent || '').indexOf('工号') >= 0) return l[i];
    }
    return l && l.length ? l[0] : null;
  }
  var MAP = {}; window.__PF_MAP__ = MAP;
  window.__PF_EDIT__ = null;

  function maskPhone(p){ if(!p) return '—'; if(String(p).length<7) return esc(p); return esc(String(p).slice(0,3)+'****'+String(p).slice(-4)); }
  function ageOf(b){ if(!b) return '—'; try{ var d=new Date(b); if(isNaN(d.getTime())) return '—'; var n=new Date(); var a=n.getFullYear()-d.getFullYear(); var m=n.getMonth()-d.getMonth(); if(m<0||(m===0&&n.getDate()<d.getDate())) a--; return (a>10&&a<90)?String(a):'—'; }catch(_){ return '—'; } }
  function yearOf(d){ if(!d) return '—'; var m=String(d).match(/(19|20)\d{2}/); return m?m[0]:'—'; }
  function isOn(p){ return p.status!=='inactive' && p.status!=='disabled' && p.status!=='off' && p.status!=='离职'; }
  function deptHtml(emp){
    if(!emp) return '—';
    var cls = /乐队/.test(emp) ? 'music' : (/舞美/.test(emp) ? 'stage' : (/服装|道具/.test(emp) ? 'prop' : 'actor'));
    return '<span class="dept-tag '+cls+'">'+esc(emp)+'</span>';
  }
  function rowHtml(p){
    var on = isOn(p);
    var dis = (p.status==='disabled');
    var gh = p.staffNo || ('PF'+String(p.id||'').slice(0,6));
    return '<tr data-performer-id="'+esc(p.id)+'" data-staff-no="'+esc(gh)+'">'
      +'<td style="text-align:center;vertical-align:middle;"><input type="checkbox" class="batch-row-check" style="width:17px;height:17px;cursor:pointer;accent-color:var(--primary,#0F4C81);" /></td>'
      +'<td><strong style="color:var(--primary);">'+esc(gh)+'</strong></td>'
      +'<td><strong>'+esc(p.name)+'</strong></td>'
      +'<td>'+esc(p.gender||'—')+'</td>'
      +'<td>'+ageOf(p.birthDate)+'</td>'
      +'<td>'+deptHtml(p.employmentType)+'</td>'
      +'<td>'+(p.primaryRole?'<span class="role-tag" title="登记值：'+esc(p.primaryRole)+'">'+esc(window.QaxRoles?window.QaxRoles.stdRole(p.primaryRole):p.primaryRole)+'</span>':'—')+'</td>'
      +'<td>'+yearOf(p.hireDate)+'</td>'
      +'<td>'+maskPhone(p.phone)+'</td>'
      +'<td style="max-width:180px;">'+esc(p.remark||'—')+'</td>'
      +'<td><span class="status-badge '+(dis?'disabled':(on?'on':'off'))+'">'+(dis?'⊘ 已禁用':(on?'● 在岗':'○ 停用'))+'</span></td>'
      +'<td style="color:var(--primary);font-weight:700;">—</td>'
      +'<td><div class="admin-table-actions">'
      +'<button class="btn btn-secondary btn-sm" title="查看详情">👁</button>'
      +'<button class="btn btn-primary btn-sm" title="编辑">✏️</button>'
      +'<button class="btn btn-gold btn-sm" title="考勤录入">🕐</button>'
      +'<button class="btn btn-outline-dark btn-sm" style="color:#17a2b8;border-color:#17a2b8;padding:6px 10px;" title="排班">📅</button>'
      +'<button class="btn btn-sm" style="background:rgba(220,53,69,0.1);color:#dc3545;padding:6px 10px;" title="'+(on?'禁用（禁用后才可删除）':'启用')+'">'+(on?'🚫':'✅')+'</button>'
      +'<button class="btn btn-sm" style="background:'+(dis?'rgba(220,53,69,0.85);color:#fff;':'rgba(220,53,69,0.05);color:#d9b3b8;')+'padding:6px 10px;" title="'+(dis?'删除该人员（软删除，记录审计日志）':'删除（需先将该人员禁用）')+'">🗑</button>'
      +'</div></td></tr>';
  }
  function render(rows){
    var t = tb(); if(!t) return;
    var list = rows || [];
    t.innerHTML = list.length
      ? list.map(rowHtml).join('')
      : '<tr><td colspan="20" style="text-align:center;padding:36px 20px;color:var(--text-light,#999);font-size:0.92rem;">暂无演职人员数据，点击右上角「➕ 新增人员」录入真实花名册</td></tr>';
    t.querySelectorAll('button').forEach(function(b){ b.__superPatchBound=1; b.__stfBound=1; });
    try { if(!t.getAttribute('data-paginate')) t.setAttribute('data-paginate','list'); if(!t.getAttribute('data-page-size')) t.setAttribute('data-page-size','10'); }catch(_){}
    // 数据填入后强制（重新）绑分页：如果 tbody 没绑过（HeightGuard 在 t=0 剥属性时跑过 pagination.js 找不到容器），
    // 调 QinPagination.init() 触发 initAll 重新扫描（_initOne 会检查 data-pagination-bound 防重复）
    try {
      if (window.QinPagination) {
        if (t.getAttribute('data-pagination-bound') !== '1') { QinPagination.init(); }
        else if (QinPagination.refresh) { QinPagination.refresh(); }
      }
    }catch(_){}
  }
  /* 暴露给筛选补丁复用（v20260908m）*/
  window.__STF_RENDER__ = render;
  window.__STF_ROW_HTML__ = rowHtml;
  function load(){
    return API.get((QAXQJT_PATHS.PERFORMERS || '/v1/performers'), { query:{page:1,pageSize:500}, showErrorToast:false, timeoutMs:8000, fallbackRead:function(){return null;} })
      .then(function(res){
        var rows = Array.isArray(res) ? res : (res && res.items) || [];
        MAP = {}; window.__PF_MAP__ = MAP;
        rows.forEach(function(p){ if(p.staffNo) MAP[p.staffNo]=p; });
        window.__PF_ROWS__ = rows;
        render(rows);
        bindToggle();
        var badge = document.getElementById('rosterBadge');
        if (badge) badge.textContent = rows.length;
        console.info('[staffApi] 已渲染真实演职人员 '+rows.length+' 条');
        // 同步刷新薪酬模块人员数和估算
        if (typeof window.__refreshWageStaff === 'function') window.__refreshWageStaff();
        }).catch(function(){ try { render([]); } catch(_){} var b0=document.getElementById('rosterBadge'); if(b0) b0.textContent='0'; });
  }
  window.__STF_LOAD__ = load;

  /* ---- 加载统计卡片真实数据 ---- */
  function setText(id, val){ var el=document.getElementById(id); if(el) el.textContent = val; }
  function loadStats(){
    return API.get((QAXQJT_PATHS.PERFORMERS_STATS || '/v1/performers/stats'), { showErrorToast:false, timeoutMs:8000, fallbackRead:function(){return null;} })
      .then(function(res){
        var d = res || {};
        var db = d.deptBreakdown || {};
        var ma = d.monthlyAttendance || {};
        var yp = d.yearlyPerformances || {};
        var eb = d.exceptionBreakdown || {};
        setText('statYear', d.year || new Date().getFullYear());
        setText('statTotalActive', d.totalActive != null ? d.totalActive : 0);
        setText('statActor', db.actor || 0);
        setText('statMusic', db.music || 0);
        setText('statStage', db.stage || 0);
        setText('statAttRate', d.monthlyAttendanceRate != null ? d.monthlyAttendanceRate : 0);
        setText('statPresent', ma.present || 0);
        setText('statAttTotal', (ma.absent||0)+(ma.late||0)+(ma.leave||0));
        setText('statPerfTotal', yp.total != null ? yp.total.toLocaleString() : 0);
        setText('statBenxi', yp.benxi || 0);
        setText('statZhezi', yp.zhezi || 0);
        setText('statExcTotal', d.pendingExceptions != null ? d.pendingExceptions : 0);
        setText('statLate', eb.late || 0);
        setText('statAbsent', eb.absent || 0);
        var ab = document.getElementById('attBadge');
        if (ab) ab.textContent = d.pendingExceptions != null ? d.pendingExceptions : 0;
        console.info('[staffStats] 统计数据已加载', d);
      })
      .catch(function(){
        // 接口失败时全部归零，不展示虚假数字
        setText('statTotalActive', 0);
        setText('statAttRate', 0);
        setText('statPerfTotal', 0);
        setText('statExcTotal', 0);
      });
  }

  /* ---- 编辑弹窗：包装原函数，记录 API 上下文并回填完整手机号 ---- */
  var _origOpen = window.openStaffEditModal;
  window.openStaffEditModal = function(gh, readonly){
    window.__PF_EDIT__ = { mode:'edit', staffNo:String(gh), readonly:!!readonly, id:(MAP[gh]||{}).id||null };
    if (_origOpen) _origOpen(gh, readonly);
    try {
      var p = MAP[gh];
      if (p){
        if (p.phone && $('inp_stf_phone')){ $('inp_stf_phone').value = p.phone; $('inp_stf_phone').placeholder=''; }
        if (p.idCardNo && $('inp_stf_idcard')) $('inp_stf_idcard').value = p.idCardNo;
        if (p.staffNo && $('inp_stf_gh')) $('inp_stf_gh').value = p.staffNo;
        if ($('inp_stf_rank')) $('inp_stf_rank').value = p.rankGrade || '';
        if ($('inp_stf_rate')) $('inp_stf_rate').value = (p.dailyRate != null && p.dailyRate !== '') ? p.dailyRate : '';
        if ($('inp_stf_transport')) $('inp_stf_transport').value = p.transportType || '';
      }
    }catch(_){}
  };

  /* ---- 新增人员：接「➕ 新增人员」演示按钮 ---- */
  function openNew(){
    window.__PF_EDIT__ = { mode:'new' };
    ['inp_stf_gh','inp_stf_name','inp_stf_age','inp_stf_role','inp_stf_year','inp_stf_phone','inp_stf_idcard','inp_stf_rep','inp_stf_rank','inp_stf_rate','inp_stf_transport'].forEach(function(id){ var el=$(id); if(el) el.value=''; });
    if ($('inp_stf_gender')) $('inp_stf_gender').value='男';
    if ($('inp_stf_dept')) $('inp_stf_dept').value='演员队';
    if ($('staffEditTitle')) $('staffEditTitle').innerText='➕ 新增演职人员';
    if ($('staffEditSaveBtn')) $('staffEditSaveBtn').style.display='';
    ['inp_stf_name','inp_stf_gender','inp_stf_age','inp_stf_dept','inp_stf_role','inp_stf_year','inp_stf_phone','inp_stf_idcard','inp_stf_rep','inp_stf_rank','inp_stf_rate','inp_stf_transport'].forEach(function(id){ var el=$(id); if(el){ el.disabled=false; el.style.background='#fff'; } });
    if ($('inp_stf_gh')) $('inp_stf_gh').value='（保存后自动生成）';
    if ($('staffEditModal')) $('staffEditModal').style.display='flex';
    document.body.style.overflow='hidden';
  }
  window.openNewStaff = openNew;
  document.addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('.admin-page-actions button') : null;
    if (btn && (btn.textContent||'').indexOf('新增人员')>=0){ e.preventDefault(); e.stopPropagation(); openNew(); }
  }, true);

  /* ---- 保存：新增 POST / 编辑 PATCH ---- */
  var _origSave = window.saveStaffEdit;
  window.saveStaffEdit = function(){
    var ed = window.__PF_EDIT__;
    var name = ($('inp_stf_name').value||'').trim();
    if(!name){ toast('❌ 姓名不能为空','error'); return; }
    var phone = ($('inp_stf_phone').value||'').trim();
    if(phone && /[*＊]/.test(phone)) phone='';
    if(phone && !/^1[3-9]\d{9}$/.test(phone)){ toast('❌ 手机号格式不正确（11 位中国大陆手机号）','error'); return; }
    var idCard = ($('inp_stf_idcard')?$('inp_stf_idcard').value:'').trim().toUpperCase();
    if(idCard && !/^\d{17}[\dX]$/.test(idCard)){ toast('❌ 身份证号格式不正确（应为18位）','error'); return; }
    var age = ($('inp_stf_age').value||'').trim();
    if(age!=='' && (parseInt(age,10)<16||parseInt(age,10)>90)){ toast('❌ 年龄需在 16~90 之间','error'); return; }
    var year = ($('inp_stf_year').value||'').trim();
    var body = {
      name: name,
      gender: $('inp_stf_gender').value || '男',
      primaryRole: ($('inp_stf_role').value||'').trim(),
      employmentType: $('inp_stf_dept').value || '演员队',
      rankGrade: $('inp_stf_rank') ? ($('inp_stf_rank').value||'') : '',
      dailyRate: $('inp_stf_rate') ? ($('inp_stf_rate').value==='' ? '' : Number($('inp_stf_rate').value)) : '',
      transportType: $('inp_stf_transport') ? ($('inp_stf_transport').value||'') : '',
      remark: ($('inp_stf_rep').value||'').trim()
    };
    if (phone) body.phone = phone;
    if (idCard) body.idCardNo = idCard;
    if (age !== '') body.birthDate = (new Date().getFullYear()-parseInt(age,10))+'-01-01';
    if (year && /^\d{4}$/.test(year)) body.hireDate = year+'-06-01';
    var done = function(d){ try{ window.closeStaffEditModal && window.closeStaffEditModal(); }catch(_){} var sn=d&&(d.staffNo||(d.data&&d.data.staffNo)); toast('✅ 已保存：'+name+(sn?('（工号 '+sn+'）'):''),'success'); load(); loadStats(); };
    var fail = function(err){ toast('❌ 保存失败：'+((err&&err.message)||'网络/服务异常'),'error'); };
    if (ed && ed.mode==='new'){
      // 工号由后端统一分配（全表含停用记录取号，避免与已占用/已删除号冲突）
      API.post((QAXQJT_PATHS.PERFORMERS || (QAXQJT_PATHS.PERFORMERS || '/v1/performers')), body, { showErrorToast:false }).then(done).catch(fail);
    } else if (ed && ed.id){
      API.patch((QAXQJT_PATHS.PERFORMERS_BY_ID || function (i) { return '/v1/performers/' + i; })(ed.id), body, { showErrorToast:false }).then(done).catch(fail);
    } else if (_origSave){
      _origSave();
    }
  };

  /* ---- 禁用/启用 + 删除：捕获阶段接管 API 行（旧本地逻辑处理不到 API 行） ---- */
  function bindToggle(){
    var t = tb(); if(!t || t.__pfCapBound) return; t.__pfCapBound = true;
    t.addEventListener('click', function(e){
      var btn = e.target && e.target.closest ? e.target.closest('.admin-table-actions button') : null;
      if(!btn || !t.contains(btn)) return;
      var tr = btn.closest('tr'); if(!tr) return;
      var acts = tr.querySelectorAll('.admin-table-actions button');
      var idx=-1; for(var i=0;i<acts.length;i++){ if(acts[i]===btn){idx=i;break;} }
      if(idx!==4 && idx!==5) return;
      var p = MAP[tr.getAttribute('data-staff-no')];
      if(!p || !p.id) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      var base = (QAXQJT_PATHS.PERFORMERS_BY_ID || function (i) { return '/v1/performers/' + i; })(p.id);
      /* 删除（仅已禁用；二次确认；软删除+审计） */
      if(idx===5){
        if(p.status!=='disabled'){ toast('⚠️ 仅「已禁用」状态的人员可删除，请先点击 🚫 禁用','warning'); return; }
        if(!confirm('⚠️ 删除二次确认\n\n确定要删除 '+p.name+'（工号 '+(p.staffNo||'—')+'）吗？\n删除后将从花名册列表移除（软删除，操作将记录审计日志）。\n\n点击「确定」执行删除。')) return;
        API.del(base, { showErrorToast:false })
          .then(function(){ toast('🗑 已删除：'+p.name,'success'); load(); loadStats(); })
          .catch(function(err){ toast('❌ 删除失败：'+((err&&err.message)||'网络/服务异常'),'error'); });
        return;
      }
      /* 禁用/启用 */
      var on = isOn(p);
      if(on && !confirm('确定要禁用 '+p.name+'（'+(p.staffNo||'')+'）吗？\n禁用后该员工将无法接单/排班；仅禁用状态的人员可执行删除。')) return;
      API.post(base + (on?'/disable':'/enable'), {}, { showErrorToast:false })
        .then(function(){ toast(on?('⊘ 已禁用：'+p.name):('✓ 已启用：'+p.name), on?'warning':'success'); load(); loadStats(); })
        .catch(function(err){ toast('❌ 操作失败：'+((err&&err.message)||'网络/服务异常'),'error'); });
    }, true);
  }

  function init(){ load().then(bindToggle).catch(function(){}); bindToggle(); loadStats(); }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(init,900); });
  else setTimeout(init,900);
  setTimeout(init,2200);
})();

/* ===== staff.html inline block (run 4, #3/6) ===== */
/* ========== 🔌 演职人员真实功能补丁 v20260908m：搜索/筛选+导出花名册+批量启停+考勤统计导出 ========= */
(function(){
  if (window.__STF_FILTER_V1__) return; window.__STF_FILTER_V1__ = true;

  function $(id){ return document.getElementById(id); }
  function toast(msg, type){
    try { if (typeof window.__T === 'function') { window.__T(msg, type||'info'); return; } } catch(_e){}
    try { if (typeof window.__toastH9 === 'function') { window.__toastH9(msg, type||'info'); return; } } catch(_e2){}
    try { window.QinApp && QinApp.Utils && QinApp.Utils.toast(msg, type||'info', 3000); return; } catch(_e3){}
    console.log(msg);
  }

  /* 工具：CSV 字段转义 */
  function csvCell(v){
    var s = String(v==null?'':v);
    if (/[",\r\n]/.test(s)) s = '"'+s.replace(/"/g,'""')+'"';
    return s;
  }
  function downloadCsv(filename, rows){
    try {
      var bom = '\uFEFF';
      var csv = bom + rows.map(function(r){ return r.map(csvCell).join(','); }).join('\r\n');
      var blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function(){ try{ document.body.removeChild(a); }catch(_){} try{ URL.revokeObjectURL(url); }catch(_){} }, 200);
    } catch(e){
      toast('❌ CSV 生成失败：'+(e && e.message ? e.message : '未知错误'),'error');
    }
  }

  /* 读取花名册 tbody（与 STF_API_V1__ 一致）*/
  function tb(){
    var rt = document.querySelector('table.roster-table');
    if (rt) { var b = rt.querySelector('tbody'); if (b) return b; }
    var l = document.querySelectorAll('tbody[data-paginate="list"]');
    for (var i = 0; i < l.length; i++) {
      var t = l[i].closest('table');
      if (t && (t.textContent || '').indexOf('工号') >= 0) return l[i];
    }
    return l && l.length ? l[0] : null;
  }

  /* —— 客户端筛选：依据 __PF_ROWS__ —— */
  function applyRosterFilter(){
    var rows = window.__PF_ROWS__ || [];
    var dept = $('stfFilterDept') ? ($('stfFilterDept').value||'').trim() : '';
    var role = $('stfFilterRole') ? ($('stfFilterRole').value||'').trim() : '';
    var stat = $('stfFilterStatus') ? ($('stfFilterStatus').value||'').trim() : '';
    var kw = $('stfFilterKw') ? ($('stfFilterKw').value||'').trim().toLowerCase() : '';
    var filtered = rows.filter(function(p){
      if (dept && (p.employmentType||'') !== dept) return false;
      // 按标准 22 岗归一比较，旧登记值（如“须生/老生/青衣”）也能被新岗位筛中
      if (role && (window.QaxRoles ? window.QaxRoles.stdRole(p.primaryRole) : (p.primaryRole||'')) !== role) return false;
      if (stat){
        var pStat = p.status || 'active';
        if (stat === 'active' && (pStat==='inactive' || pStat==='disabled' || pStat==='离职')) return false;
        if (stat === 'inactive' && pStat !== 'inactive' && pStat !== 'disabled' && pStat !== '离职') return false;
        if (stat === 'disabled' && pStat !== 'disabled') return false;
      }
      if (kw){
        var stdR = window.QaxRoles ? window.QaxRoles.stdRole(p.primaryRole) : '';
        var hay = [p.staffNo, p.name, p.phone, p.primaryRole, stdR, p.employmentType, p.remark]
          .map(function(x){ return String(x==null?'':x).toLowerCase(); }).join(' ');
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
    /* 复用 STF_API_V1__ 的 render（如果可用），否则自行渲染 */
    if (typeof window.__STF_RENDER__ === 'function') {
      window.__STF_RENDER__(filtered);
    } else {
      var t = tb(); if (!t) return;
      t.innerHTML = filtered.length
        ? filtered.map(window.__PF_ROW_HTML__ || defaultRowHtml).join('')
        : '<tr><td colspan="13" style="text-align:center;padding:36px 20px;color:var(--text-light,#999);">⚠️ 筛选结果为空（共 '+rows.length+' 条，匹配 0 条），请调整筛选条件</td></tr>';
      try { window.QinPagination && QinPagination.refresh && QinPagination.refresh(); }catch(_){}
    }
    window.__PF_FILTERED__ = filtered;
    try { console.info('[staffFilter] 筛选 '+filtered.length+'/'+rows.length+' 条'); }catch(_){}
  }

  function defaultRowHtml(p){
    /* 与 STF_API_V1__ rowHtml 一致的简版兜底 */
    var on = (p.status !== 'inactive' && p.status !== 'disabled' && p.status !== '离职');
    var gh = p.staffNo || ('PF'+String(p.id||'').slice(0,6));
    return '<tr data-performer-id="'+(p.id||'')+'" data-staff-no="'+gh+'">'
      +'<td style="text-align:center;vertical-align:middle;"><input type="checkbox" class="batch-row-check" /></td>'
      +'<td><strong>'+gh+'</strong></td>'
      +'<td><strong>'+(p.name||'—')+'</strong></td>'
      +'<td>'+(p.gender||'—')+'</td>'
      +'<td>—</td>'
      +'<td>'+(p.employmentType||'—')+'</td>'
      +'<td>'+(p.primaryRole ? (window.QaxRoles?window.QaxRoles.stdRole(p.primaryRole):p.primaryRole) : '—')+'</td>'
      +'<td>—</td>'
      +'<td>'+(p.phone||'—')+'</td>'
      +'<td>'+(p.remark||'—')+'</td>'
      +'<td><span class="status-badge '+(on?'on':'off')+'">'+(on?'● 在岗':'○ 停用')+'</span></td>'
      +'<td>—</td>'
      +'<td>—</td></tr>';
  }

  /* —— 导出花名册 CSV —— */
  function exportRosterCsv(){
    var rows = window.__PF_FILTERED__ || window.__PF_ROWS__ || [];
    if (!rows.length){ toast('⚠️ 暂无演职人员数据可导出','warning'); return; }
    var head = ['工号','姓名','性别','年龄','部门','岗位行当','入职年份','联系电话','擅长剧目','状态','备注'];
    var out = [head];
    rows.forEach(function(p){
      var on = (p.status !== 'inactive' && p.status !== 'disabled' && p.status !== '离职');
      out.push([
        p.staffNo || ('PF'+String(p.id||'').slice(0,6)),
        p.name || '',
        p.gender || '',
        p.birthDate ? (new Date().getFullYear() - new Date(p.birthDate).getFullYear()) : '',
        p.employmentType || '',
        (p.primaryRole ? (window.QaxRoles?window.QaxRoles.stdRole(p.primaryRole):p.primaryRole) : ''),
        (p.hireDate && String(p.hireDate).match(/(19|20)\d{2}/)) ? String(p.hireDate).match(/(19|20)\d{2}/)[0] : '',
        p.phone || '',
        p.remark || '',
        p.status === 'disabled' ? '已禁用' : (on ? '在岗' : '停用'),
        p.remark || ''
      ]);
    });
    var ts = new Date();
    var fname = '演职人员花名册_'+ts.getFullYear()+(ts.getMonth()+1+'').padStart(2,'0')+(ts.getDate()+'').padStart(2,'0')+'.csv';
    downloadCsv(fname, out);
    toast('📥 已导出 '+rows.length+' 条演职人员到 '+fname,'success');
  }

  /* —— 批量启停：POST /v1/performers/:id/(disable|enable)（仅当前页可见行，跳过分页/筛选隐藏行） —— */
  function batchToggle(enable){
    var t = tb(); if (!t){ toast('❌ 找不到花名册表','error'); return; }
    var checks = t.querySelectorAll('tr:not(.pg-hidden) input[type=checkbox].batch-row-check:checked');
    if (!checks.length){ toast('⚠️ 请先勾选要'+(enable?'启用':'禁用')+'的人员行','warning'); return; }
    var ids = [];
    var byStaffNo = window.__PF_MAP__ || {};
    checks.forEach(function(cb){
      var tr = cb.closest('tr'); if (!tr) return;
      var sn = tr.getAttribute('data-staff-no');
      var p = byStaffNo[sn];
      if (p && p.id) ids.push({ id: p.id, name: p.name, staffNo: sn });
    });
    if (!ids.length){ toast('⚠️ 选中行未匹配到后端记录（请刷新页面后重试）','warning'); return; }
    if (!confirm('确认'+(enable?'启用':'禁用')+' '+ids.length+' 名演职人员？'+(enable?'':'禁用后才可执行删除操作。')+'此操作将同步到后端。')) return;
    var API = window.QAXQJT_API;
    if (!API || typeof API.post !== 'function'){ toast('❌ API 接口不可用','error'); return; }
    toast('⏳ 正在批量'+(enable?'启用':'禁用')+' '+ids.length+' 人...','info');
    var ok = 0, fail = 0, done = 0, total = ids.length;
    ids.forEach(function(it){
      API.post(((QAXQJT_PATHS.PERFORMERS_BY_ID || function (i) { return '/v1/performers/' + i; })(it.id)) + (enable ? '/enable' : '/disable'), {}, { showErrorToast: false })
        .then(function(){ ok++; })
        .catch(function(){ fail++; })
        .then(function(){
          done++;
          if (done === total){
            if (fail === 0) toast('✅ 已'+(enable?'启用':'禁用')+' '+ok+' 人'+(fail?'，'+fail+'人失败':''),'success');
            else toast('⚠️ 批量操作完成：成功 '+ok+' / 失败 '+fail,'warning');
            /* 触发重载 */
            try { window.__STF_LOAD__ && window.__STF_LOAD__(); }catch(_){}
            try { if (typeof window.__STF_API_V1__ !== 'undefined' && window.__STF_LOAD__) window.__STF_LOAD__(); }catch(_){}
          }
        });
    });
  }

  /* —— 清理已禁用人员：POST /v1/performers/cleanup-disabled（仅超管；分页批量软删，带审计） —— */
  function cleanupDisabled(){
    var rows = window.__PF_ROWS__ || [];
    var disabledRows = rows.filter(function(p){ return p.status === 'disabled'; });
    if (!disabledRows.length){ toast('ℹ️ 当前没有「已禁用」状态的演职人员，无需清理','info'); return; }
    if (!confirm('⚠️ 清理二次确认\n\n将批量删除全部「已禁用」状态的演职人员（当前列表内 '+disabledRows.length+' 人，按每批 50 人分页清理）。\n删除为软删除，操作人/时间/人员信息将记录审计日志。\n\n点击「确定」开始清理。')) return;
    if (!confirm('⚠️ 最终确认\n\n此操作不可在页面上直接撤销（仅可通过审计日志追溯）。\n确认继续清理 '+disabledRows.length+' 名已禁用人员？')) return;
    var API = window.QAXQJT_API;
    if (!API || typeof API.post !== 'function'){ toast('❌ API 接口不可用','error'); return; }
    toast('⏳ 正在清理已禁用人员...','info');
    var totalCleaned = 0, rounds = 0, maxRounds = 20;
    (function loop(){
      API.post('/v1/performers/cleanup-disabled', { pageSize: 50 }, { showErrorToast: false })
        .then(function(res){
          var d = (res && res.data) || res || {};
          totalCleaned += (d.cleaned || 0);
          rounds++;
          var remaining = (typeof d.remaining === 'number') ? d.remaining : 0;
          if (remaining > 0 && (d.cleaned || 0) > 0 && rounds < maxRounds){ loop(); return; }
          toast('🧹 清理完成：共删除 '+totalCleaned+' 名已禁用人员'+(remaining>0?('（剩余 '+remaining+' 人，可再次点击继续清理）'):''),'success');
          try { window.__STF_LOAD__ && window.__STF_LOAD__(); }catch(_){}
        })
        .catch(function(err){ toast('❌ 清理失败：'+((err&&err.message)||'网络/服务异常'),'error'); });
    })();
  }

  /* —— 批量补卡：跳转到考勤 tab 并提示（仅当前页可见行） —— */
  function batchMakeup(){
    var t = tb(); if (!t){ toast('❌ 找不到花名册表','error'); return; }
    var checks = t.querySelectorAll('tr:not(.pg-hidden) input[type=checkbox].batch-row-check:checked');
    if (!checks.length){ toast('⚠️ 请先勾选要补卡的人员行','warning'); return; }
    var names = [];
    checks.forEach(function(cb){ var tr = cb.closest('tr'); if (tr) { var td = tr.querySelector('td:nth-child(3)'); if (td) names.push(td.textContent.trim()); } });
    /* 切到考勤 tab */
    var tabBtn = document.querySelector('[data-tab="attendance"], [onclick*="attendance"], a[href="#tab-attendance"]');
    if (tabBtn) { try { tabBtn.click(); }catch(_){} }
    var tabPanel = $('tab-attendance'); if (tabPanel) { try { document.querySelectorAll('.staff-tab-content').forEach(function(p){ p.classList.remove('active'); }); tabPanel.classList.add('active'); }catch(_){} }
    toast('📅 已切到考勤录入 tab，可对勾选的 '+names.length+' 人补卡：'+names.slice(0,5).join('、')+(names.length>5?' 等':''),'info', 4000);
  }

  /* —— 考勤统计导出：CSV 兜底（基于本月花名册状态估算） —— */
  function exportAttendanceStats(){
    var rows = window.__PF_ROWS__ || [];
    if (!rows.length){ toast('⚠️ 暂无演职人员数据可导出','warning'); return; }
    var now = new Date();
    var monthStr = now.getFullYear()+'-'+(now.getMonth()+1+'').padStart(2,'0');
    var head = ['工号','姓名','部门','岗位行当','月份','应出勤(天)','实际出勤(天)','迟到(次)','早退(次)','请假(天)','状态'];
    var out = [head];
    rows.forEach(function(p){
      var on = (p.status !== 'inactive' && p.status !== 'disabled' && p.status !== '离职');
      out.push([
        p.staffNo || ('PF'+String(p.id||'').slice(0,6)),
        p.name || '',
        p.employmentType || '',
        (p.primaryRole ? (window.QaxRoles?window.QaxRoles.stdRole(p.primaryRole):p.primaryRole) : ''),
        monthStr,
        '22',
        on ? '22' : '0',
        '0','0','0',
        p.status === 'disabled' ? '已禁用' : (on ? '在岗' : '停用')
      ]);
    });
    var fname = '考勤统计_'+monthStr+'.csv';
    downloadCsv(fname, out);
    toast('📥 已导出 '+rows.length+' 人考勤统计到 '+fname+'（基础版，详细考勤请配合考勤打卡数据）','success', 4000);
  }

  /* —— 绑定筛选事件 —— */
  function bindFilters(){
    ['stfFilterDept','stfFilterRole','stfFilterStatus','stfFilterKw'].forEach(function(id){
      var el = $(id); if (!el || el.__stfFilterBound) return;
      el.__stfFilterBound = 1;
      el.addEventListener('input', applyRosterFilter);
      el.addEventListener('change', applyRosterFilter);
    });
  }

  /* —— 绑定页面顶部按钮 + 标记防 DBF 拦截 —— */
  function bindPageHeaderButtons(){
    var map = {
      'btnStaffExportRoster': exportRosterCsv,
      'btnStaffBatchEnable': function(){ batchToggle(true); },
      'btnStaffBatchDisable': function(){ batchToggle(false); },
      'btnStaffBatchMakeup': batchMakeup,
      'btnStaffExportAttendance': exportAttendanceStats,
      'btnStaffCleanupDisabled': cleanupDisabled
    };
    Object.keys(map).forEach(function(id){
      var btn = $(id); if (!btn || btn.__stfHeaderBound) return;
      btn.__stfHeaderBound = 1;
      btn.__superPatchBound = 1;
      btn.__ts3Done = 1;
      btn.setAttribute('data-stf-real','1');
      btn.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        try { map[id](); }catch(err){ toast('❌ 操作异常：'+(err && err.message ? err.message : '未知'),'error'); }
      }, true);
    });
    /* 「新增人员」按钮也打标，避免被 DBF 接管显示"演示模式"toast */
    var addBtn = $('btnStaffAddNew');
    if (addBtn && !addBtn.__stfHeaderBound){
      addBtn.__stfHeaderBound = 1;
      addBtn.__superPatchBound = 1;
      addBtn.__ts3Done = 1;
    }
  }

  /* —— 钩入 STF_API_V1__ 的 load/render，让筛选结果走我们的渲染 —— */
  function hookApiPatch(){
    if (window.__STF_API_HOOKED__) return; window.__STF_API_HOOKED__ = 1;
    /* 暴露 render 给 applyRosterFilter 复用 */
    try {
      /* 等 STF_API_V1__ 注入完 window.__PF_ROWS__ 后自动跑一次筛选 */
      var origLoad = window.__STF_LOAD__;
      if (origLoad){
        window.__STF_LOAD__ = function(){
          return origLoad.apply(this, arguments).then(function(){
            try { applyRosterFilter(); }catch(_){}
          });
        };
      }
    }catch(_){}
  }

  function init(){
    bindFilters();
    bindPageHeaderButtons();
    hookApiPatch();
    /* 数据已加载的话立即应用一次筛选 */
    if (window.__PF_ROWS__ && window.__PF_ROWS__.length){
      try { applyRosterFilter(); }catch(_){}
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(init, 1100); });
  else setTimeout(init, 1100);
  setTimeout(init, 2500);
  setTimeout(init, 5000);
})();

/* ===== staff.html inline block (run 4, #4/6) ===== */
(function(){
  var API = window.QAXQJT_API;
  var panel, list, countBadge;

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function toast(msg, type){
    try { window.__T && window.__T(msg, type||'info'); return; } catch(_){}
    try { window.__toastH9 && window.__toastH9(msg, type||'info'); return; } catch(_){}
    try { window.QinApp && QinApp.Utils && QinApp.Utils.toast(msg, type||'info', 3000); return; } catch(_){}
    alert(msg);
  }

  function renderPending(rows){
    if(!panel) return;
    if(!rows || !rows.length){
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    countBadge.textContent = rows.length;
    var html = '';
    rows.forEach(function(p){
      html += '<div style="background:#fff;border:1px solid #e8d5b7;border-radius:8px;padding:12px;margin-bottom:10px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">';
      html += '<div>';
      html += '<strong style="font-size:15px;color:#8b0000;">' + esc(p.name) + '</strong>';
      if(p.gender) html += ' <span style="color:#666;font-size:13px;">(' + esc(p.gender) + ')</span>';
      if(p.primaryRole) html += ' <span style="background:#f0e0c0;padding:1px 8px;border-radius:10px;font-size:12px;color:#8a6d3b;">' + esc(window.QaxRoles?window.QaxRoles.stdRole(p.primaryRole):p.primaryRole) + '</span>';
      html += '</div>';
      if(p.reviewStatus === 'rejected' && p.reviewFeedback){
        html += '<span style="background:#ffebee;color:#c62828;padding:2px 8px;border-radius:6px;font-size:12px;">被退回</span>';
      }
      html += '</div>';
      var info = [];
      if(p.idCardNo) info.push('🆔 ' + esc(p.idCardNo));
      if(p.phone) info.push('📱 ' + esc(p.phone));
      if(p.dailyRate != null && p.dailyRate !== '') info.push('💰 协议天工资 ¥' + esc(p.dailyRate) + '/天');
      else if(p.agreedSalary) info.push('💰 ' + esc(p.agreedSalary));
      if(p.transportType) info.push('🚌 路费' + esc(p.transportType));
      if(info.length) html += '<div style="font-size:13px;color:#555;margin-top:6px;">' + info.join('　') + '</div>';
      if(p.remark) html += '<div style="font-size:12px;color:#888;margin-top:4px;">备注：' + esc(p.remark) + '</div>';
      if(p.reviewFeedback) html += '<div style="font-size:12px;color:#c62828;margin-top:6px;background:#ffebee;padding:6px 8px;border-radius:4px;">退回原因：' + esc(p.reviewFeedback) + '</div>';
      html += '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;">';
      html += '<button data-act="approve" onclick="approvePending(\'' + p.id + '\');event.stopImmediatePropagation();" style="background:#2e7d32;color:#fff;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;">✅ 审核通过</button>';
      html += '<button data-act="reject" onclick="rejectPending(\'' + p.id + '\');event.stopImmediatePropagation();" style="background:#c62828;color:#fff;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;">❌ 退回重填</button>';
      html += '</div>';
      html += '</div>';
    });
    list.innerHTML = html;
    // 标记按钮防止 SuperPatch/DBF 拦截
    var btns = list.querySelectorAll('button[data-act]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].__superPatchBound = 1;
      btns[i].__ts3Done = 1;
      btns[i].__bindDone = 1;
      btns[i].__ctE2Done = 1;
      btns[i].__deadBtnChecked = 1;
    }
  }

  function loadPending(){
    if(!API) return;
    API.get((QAXQJT_PATHS.PERFORMERS || '/v1/performers'), { query: { page:1, pageSize:500, status:'pending' }, showErrorToast:false, timeoutMs:8000 })
      .then(function(res){
        // 兼容多种返回结构：直接数组 / {data:[]} / {items:[]} / {data:{items:[]}}
        var rows = [];
        if (Array.isArray(res)) rows = res;
        else if (Array.isArray(res && res.data)) rows = res.data;
        else if (Array.isArray(res && res.items)) rows = res.items;
        else if (res && res.data && Array.isArray(res.data.items)) rows = res.data.items;
        renderPending(rows);
      })
      .catch(function(){ renderPending([]); });
  }

  // 自定义确认/输入模态框（替代原生 confirm/prompt，避免被浏览器拦截）
  function __showModal(title, html, onOk, onCancel){
    var mask = document.createElement('div');
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99999;display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;padding:24px;min-width:320px;max-width:90vw;box-shadow:0 10px 40px rgba(0,0,0,0.2);';
    box.innerHTML = '<h3 style="margin:0 0 14px;font-size:16px;color:#8b0000;">' + title + '</h3>' + html;
    mask.appendChild(box);
    document.body.appendChild(mask);
    var okBtn = box.querySelector('[data-modal-ok]');
    var cancelBtn = box.querySelector('[data-modal-cancel]');
    var input = box.querySelector('[data-modal-input]');
    function close(){ try{ document.body.removeChild(mask); }catch(_){} }
    if(okBtn) okBtn.addEventListener('click', function(){ if(onOk) onOk(input ? input.value : null); close(); });
    if(cancelBtn) cancelBtn.addEventListener('click', function(){ if(onCancel) onCancel(); close(); });
    if(input) setTimeout(function(){ input.focus(); input.select(); }, 50);
  }

  window.approvePending = function(id){
    __showModal('确认审核通过 · 入职薪酬设定',
      '<p style="color:#555;margin:0 0 14px;line-height:1.6;">审核通过后，系统将自动分配工号并正式入职。请设定薪酬标准：</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;color:#333;">💰 协议日工资（元/天）</label><input id="approveRate" type="number" min="0" step="1" placeholder="如：200" style="width:100%;padding:8px 10px;border:1.5px solid var(--gold,#c89b3c);border-radius:6px;box-sizing:border-box;"></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;color:#333;">🎖 职级</label><select id="approveRank" style="width:100%;padding:8px 10px;border:1.5px solid #ddd;border-radius:6px;box-sizing:border-box;"><option value="">未定级</option><option value="一级">一级</option><option value="二级">二级</option><option value="三级">三级</option><option value="四级">四级</option><option value="五级">五级</option><option value="学徒">学徒</option></select></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;color:#333;">🚌 路费方式</label><select id="approveTransport" style="width:100%;padding:8px 10px;border:1.5px solid #ddd;border-radius:6px;box-sizing:border-box;"><option value="">未约定</option><option value="单趟">单趟</option><option value="双趟">双趟</option></select></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;color:#333;">📋 工号（留空自动分配）</label><input id="approveStaffNo" type="text" placeholder="自动分配" style="width:100%;padding:8px 10px;border:1.5px solid #ddd;border-radius:6px;box-sizing:border-box;"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
      '<button data-modal-cancel style="padding:8px 20px;border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer;">取消</button>' +
      '<button data-modal-ok style="padding:8px 20px;background:#2e7d32;color:#fff;border:none;border-radius:6px;cursor:pointer;">✅ 确认通过</button>' +
      '</div>',
      function(){
        var rate = document.getElementById('approveRate');
        var rank = document.getElementById('approveRank');
        var transport = document.getElementById('approveTransport');
        var sno = document.getElementById('approveStaffNo');
        var payload = { action:'approve' };
        if (rate && rate.value) payload.dailyRate = Number(rate.value);
        if (rank && rank.value) payload.rankGrade = rank.value;
        if (transport && transport.value) payload.transportType = transport.value;
        if (sno && sno.value.trim()) payload.staffNo = sno.value.trim();
        API.patch((QAXQJT_PATHS.PERFORMERS_REVIEW || function (i) { return '/v1/performers/' + i + '/review'; })(id), payload)
          .then(function(r){
            var sn = r && (r.staffNo || (r.data && r.data.staffNo));
            var rateStr = payload.dailyRate ? ('，日工资 ¥' + payload.dailyRate) : '';
            toast('审核通过，已入职' + (sn ? ('，工号 ' + sn) : '') + rateStr, 'success');
            loadPending();
            if(typeof loadStaffRoster === 'function') loadStaffRoster();
            else if(typeof __STF_LOAD__ === 'function') __STF_LOAD__();
            else location.reload();
          })
          .catch(function(e){ toast('操作失败：' + (e&&e.message||''), 'error'); });
      });
  };

  window.rejectPending = function(id){
    __showModal('退回重填',
      '<p style="color:#555;margin:0 0 10px;">请输入退回原因（将告知本人重新填写）：</p>' +
      '<input data-modal-input type="text" value="资料不完整，请补充后重新提交" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;margin-bottom:18px;" />' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
      '<button data-modal-cancel style="padding:8px 20px;border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer;">取消</button>' +
      '<button data-modal-ok style="padding:8px 20px;background:#c62828;color:#fff;border:none;border-radius:6px;cursor:pointer;">确认退回</button>' +
      '</div>',
      function(fb){
        if(fb === null || fb === '') return;
        API.patch((QAXQJT_PATHS.PERFORMERS_REVIEW || function (i) { return '/v1/performers/' + i + '/review'; })(id), { action:'reject', feedback: fb })
          .then(function(){
            toast('已退回，等待本人重新填写', 'success');
            loadPending();
          })
          .catch(function(e){ toast('操作失败：' + (e&&e.message||''), 'error'); });
      });
  };

  function init(){
    panel = document.getElementById('pendingReviewPanel');
    list = document.getElementById('pendingReviewList');
    countBadge = document.getElementById('pendingCount');
    if(panel) loadPending();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ===== staff.html inline block (run 4, #5/6) ===== */
// ===== 新演员入职登记二维码 =====
  (function () {
    'use strict';

    function getOnboardUrl() {
      // 以当前站点 origin 为基准，指向公开入职登记页
      var origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
      return origin + '/admin/self-register.html';
    }

    window.__showOnboardQr = function () {
      var modal = document.getElementById('onboardQrModal');
      var canvasWrap = document.getElementById('onboardQrCanvas');
      var urlBox = document.getElementById('onboardQrUrl');
      if (!modal || !canvasWrap) return;

      var url = getOnboardUrl();
      urlBox.textContent = url;
      canvasWrap.innerHTML = '';

      var canvas = document.createElement('canvas');
      canvasWrap.appendChild(canvas);

      if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
        window.QRCode.toCanvas(canvas, url, { width: 240, margin: 2, color: { dark: '#8b0000', light: '#ffffff' } }, function (err) {
          if (err) {
            canvasWrap.innerHTML = '<div style="color:#d32f2f;padding:20px;">二维码生成失败：' + err.message + '</div>';
          }
        });
      } else {
        canvasWrap.innerHTML = '<div style="color:#d32f2f;padding:20px;">二维码库未加载，请刷新页面重试</div>';
      }

      modal.style.display = 'flex';
    };

    window.__copyOnboardUrl = function () {
      var url = getOnboardUrl();
      var ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        var btn = event.target;
        var old = btn.textContent;
        btn.textContent = '✅ 已复制';
        setTimeout(function () { btn.textContent = old; }, 1500);
      } catch (e) {
        prompt('请手动复制以下链接：', url);
      }
      document.body.removeChild(ta);
    };

    // 点击遮罩关闭
    document.addEventListener('click', function (e) {
      var modal = document.getElementById('onboardQrModal');
      if (modal && modal.style.display === 'flex' && e.target === modal) {
        modal.style.display = 'none';
      }
    });
  })();

/* ===== staff.html inline block (run 4, #6/6) ===== */
(function () {
  'use strict';
  var API = window.QAXQJT_API;
  var CFG = window.QAXQJT_API_CONFIG || {};
  var PATHS = CFG.PATHS || {};
  var LEAVE_TYPES = { PL: '事假', SL: '病假', AL: '年假', OL: '调休', BL: '婚假', ML: '产假', RL: '丧假', OL2: '其他' };
  var STATE_MAP = { pending: '待审批', approved: '已批准', rejected: '已驳回' };
  var state = { page: 1, pageSize: 15, status: '', keyword: '', list: [], total: 0 };

  function $(id) { return document.getElementById(id); }
  function toast(msg, t) { if (window.showToast) window.showToast(msg, t || 'success'); else alert(msg); }

  function leavePath() { return PATHS.ATTENDANCE_LEAVES || '/v1/attendance/leaves'; }
  function leaveApprovePath(id) {
    return (PATHS.ATTENDANCE_LEAVES_APPROVE && PATHS.ATTENDANCE_LEAVES_APPROVE(id)) || ('/v1/attendance/leaves/' + id + '/approve');
  }

  async function loadLeaves() {
    var tbody = $('leaveTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#999;">加载中…</td></tr>';
    try {
      var q = { page: state.page, pageSize: state.pageSize };
      if (state.status) q.status = state.status;
      if (state.keyword) q.keyword = state.keyword;
      var rows = await API.get(leavePath(), { query: q });
      var list = Array.isArray(rows) ? rows : (rows && rows.items) || [];
      var meta = (rows && rows.meta) || {};
      state.list = list;
      state.total = meta.total || list.length;
      renderLeaves(list);
      renderPager();
      var badge = $('leaveTabBadge');
      if (badge) badge.textContent = String(meta.total || list.length);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#d9534f;">加载失败：' + (e.message || e) + '</td></tr>';
    }
  }

  function renderLeaves(list) {
    var tbody = $('leaveTbody');
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#999;">暂无请假记录</td></tr>'; return; }
    tbody.innerHTML = list.map(function (r) {
      var st = r.approveStatus || r.status || 'pending';
      var stCls = st === 'approved' ? 'success' : (st === 'rejected' ? 'danger' : 'warning');
      var acts = '';
      if (st === 'pending') {
        acts = '<button class="btn btn-success btn-xs" data-act="approve" data-id="' + r.id + '">批准</button> ' +
               '<button class="btn btn-danger btn-xs" data-act="reject" data-id="' + r.id + '">驳回</button>';
      } else {
        acts = '<span style="color:#999;font-size:.8rem;">—</span>';
      }
      return '<tr>' +
        '<td>' + (r.staffName || '') + (r.staffId ? '<br><span style="color:#999;font-size:.75rem;">' + r.staffId + '</span>' : '') + '</td>' +
        '<td>' + (LEAVE_TYPES[r.leaveType] || r.leaveType || '') + '</td>' +
        '<td>' + (r.dateFrom || '').slice(0, 10) + ' ~ ' + (r.dateTo || '').slice(0, 10) + '</td>' +
        '<td>' + (r.totalDays != null ? r.totalDays : (r.totalHours != null ? r.totalHours + 'h' : '1')) + '</td>' +
        '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (r.reason || '') + '">' + (r.reason || '') + '</td>' +
        '<td><span class="status-badge ' + stCls + '">' + (STATE_MAP[st] || st) + '</span>' + (r.rejectReason ? '<br><span style="color:#d9534f;font-size:.72rem;">' + r.rejectReason + '</span>' : '') + '</td>' +
        '<td>' + (r.approverName || '—') + '</td>' +
        '<td>' + acts + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderPager() {
    var pg = $('leavePager');
    if (!pg) return;
    var pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    var html = '<span style="margin-right:10px;color:#888;font-size:.82rem;">共 ' + state.total + ' 条</span>';
    html += '<button class="btn btn-sm" ' + (state.page <= 1 ? 'disabled' : '') + ' data-lp="' + (state.page - 1) + '">上一页</button> ';
    html += '<span style="margin:0 8px;">' + state.page + ' / ' + pages + '</span>';
    html += '<button class="btn btn-sm" ' + (state.page >= pages ? 'disabled' : '') + ' data-lp="' + (state.page + 1) + '">下一页</button>';
    pg.innerHTML = html;
  }

  async function approve(id, status, reason) {
    try {
      var body = { status: status };
      if (reason) body.rejectReason = reason;
      await API.patch(leaveApprovePath(id), body);
      toast(status === 'approved' ? '已批准' : '已驳回', 'success');
      loadLeaves();
    } catch (e) { toast('操作失败：' + (e.message || e), 'error'); }
  }

  function openCreateModal() {
    var html = '<div id="leaveModal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;">' +
      '<div style="background:#fff;border-radius:14px;padding:24px;max-width:520px;width:90%;max-height:90vh;overflow-y:auto;">' +
      '<h3 style="margin:0 0 16px;color:var(--primary-dark);">➕ 新建请假申请</h3>' +
      '<div class="form-group"><label>员工姓名 *</label><input id="lfName" class="form-control" placeholder="请输入员工姓名"></div>' +
      '<div class="form-group"><label>员工ID *</label><input id="lfStaffId" class="form-control" placeholder="员工工号/ID"></div>' +
      '<div class="form-group"><label>请假类型 *</label><select id="lfType" class="form-control">' +
      Object.keys(LEAVE_TYPES).map(function (k) { return '<option value="' + k + '">' + LEAVE_TYPES[k] + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="form-row"><div class="form-group"><label>开始日期 *</label><input id="lfFrom" type="date" class="form-control"></div>' +
      '<div class="form-group"><label>结束日期 *</label><input id="lfTo" type="date" class="form-control"></div></div>' +
      '<div class="form-group"><label>天数 *</label><input id="lfDays" type="number" min="0.5" step="0.5" value="1" class="form-control"></div>' +
      '<div class="form-group"><label>事由 *</label><textarea id="lfReason" class="form-control" rows="3" placeholder="请说明请假事由"></textarea></div>' +
      (Object.keys(LEAVE_TYPES).length > 0 ? '<label style="display:flex;align-items:center;gap:6px;margin:8px 0;"><input type="checkbox" id="lfSpecial"> 超限特批（事假超每月2次/2天需勾选）</label>' : '') +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">' +
      '<button class="btn btn-secondary" id="lfCancel">取消</button>' +
      '<button class="btn btn-primary" id="lfSubmit">提交</button></div></div></div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    $('lfCancel').onclick = function () { document.body.removeChild(wrap); };
    $('lfSubmit').onclick = async function () {
      var body = {
        staffName: $('lfName').value.trim(),
        staffId: $('lfStaffId').value.trim(),
        leaveType: $('lfType').value,
        dateFrom: $('lfFrom').value,
        dateTo: $('lfTo').value,
        totalDays: Number($('lfDays').value) || 1,
        reason: $('lfReason').value.trim(),
        specialApproval: $('lfSpecial') ? $('lfSpecial').checked : false
      };
      if (!body.staffName || !body.staffId || !body.reason || !body.dateFrom || !body.dateTo) { toast('请填写必填项', 'error'); return; }
      try {
        await API.post(leavePath(), body);
        toast('请假申请已提交', 'success');
        document.body.removeChild(wrap);
        loadLeaves();
      } catch (e) { toast('提交失败：' + (e.message || e), 'error'); }
    };
  }

  function bind() {
    var tab = document.querySelector('.staff-tab[data-tab="leave"]');
    if (tab) tab.addEventListener('click', loadLeaves);
    var btnSearch = $('btnLeaveSearch');
    if (btnSearch) btnSearch.onclick = function () { state.page = 1; state.status = $('leaveFilterStatus').value; state.keyword = $('leaveFilterKw').value.trim(); loadLeaves(); };
    var btnReset = $('btnLeaveReset');
    if (btnReset) btnReset.onclick = function () { $('leaveFilterStatus').value = ''; $('leaveFilterKw').value = ''; state.page = 1; state.status = ''; state.keyword = ''; loadLeaves(); };
    var btnCreate = $('btnLeaveCreate');
    if (btnCreate) btnCreate.onclick = openCreateModal;
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var act = btn.getAttribute('data-act');
      if (act === 'approve') approve(id, 'approved');
      else if (act === 'reject') {
        var reason = prompt('请输入驳回原因：');
        if (reason !== null) approve(id, 'rejected', reason);
      }
    });
    document.addEventListener('click', function (e) {
      var lp = e.target.getAttribute && e.target.getAttribute('data-lp');
      if (lp) { state.page = Number(lp); loadLeaves(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
