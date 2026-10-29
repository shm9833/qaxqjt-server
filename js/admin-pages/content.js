/* content.js — 从 admin/content.html 抽取的内联脚本（第 2/2 段，保持原执行位置） */

/* ===== content.html inline block (run 2, #1/7) ===== */
(function() {
      'use strict';

      var ADMIN_STORAGE_KEY = 'qaxqjt_admin_session';
      var LOGOUT_BLACKLIST_KEY = 'qaxqjt_logout_blacklist';
      // BLOCKER B8 FIX：退出登录时，一并清理历史遗留/辅助登录态 keys（v2/token/remember/permissions/info 等），防残留鉴权绕过
      var __ADMIN_LEGACY_KEYS = ['qaxqjt_admin_session','admin_session','qaxqjt_admin_sess_v2','admin_sess_v2','qaxqjt_admin_remember','qaxqjt_admin_token','qaxqjt_admin_info','qaxqjt_admin_permissions','qaxqjt_auth_permissions_v1'];
      function __clearAdminLegacyKeys(excludeKey) { for (var __k=0; __k<__ADMIN_LEGACY_KEYS.length; __k++) { var __kk=__ADMIN_LEGACY_KEYS[__k]; if (excludeKey && __kk===excludeKey) continue; try { localStorage.removeItem(__kk); } catch(_){} } }

      function __isBlacklistedSess(sessId) {
        if (!sessId) return false;
        try {
          var raw = localStorage.getItem(LOGOUT_BLACKLIST_KEY);
          if (!raw) return false;
          var list = JSON.parse(raw) || [];
          for (var bi = 0; bi < list.length; bi++) {
            if (list[bi].id === sessId) return true;
          }
        } catch (_) {}
        return false;
      }

      function __pruneBlacklist() {
        try {
          var raw = localStorage.getItem(LOGOUT_BLACKLIST_KEY);
          if (!raw) return;
          var list = JSON.parse(raw) || [];
          var cutoff = Date.now() - 24 * 60 * 60 * 1000;
          var newList = list.filter(function (x) { return (x.ts || 0) > cutoff; });
          if (newList.length !== list.length) localStorage.setItem(LOGOUT_BLACKLIST_KEY, JSON.stringify(newList));
        } catch (_) {}
      }

      function checkAuth() {
        var session = null;
        try {
          var raw = localStorage.getItem(ADMIN_STORAGE_KEY);
          if (raw) session = JSON.parse(raw);
        } catch (e) { session = null; }
        if (!session) {
          try { localStorage.removeItem(ADMIN_STORAGE_KEY); } catch (_) {}
          window.location.replace('login.html');
          return null;
        }
        if (session.expiresAt && Date.now() > parseInt(session.expiresAt, 10)) {
          try { localStorage.removeItem(ADMIN_STORAGE_KEY); } catch (_) {}
          __pruneBlacklist();
          window.location.replace('login.html');
          return null;
        }
        if (__isBlacklistedSess(session.id)) {
          try { localStorage.removeItem(ADMIN_STORAGE_KEY); } catch (_) {}
          window.location.replace('login.html');
          return null;
        }
        return session;
      }

      try {
        window.addEventListener('storage', function (evt) {
          if (!evt) return;
          if (evt.key === ADMIN_STORAGE_KEY && !evt.newValue) {
            try { window.location.replace('login.html'); } catch (_) {}
          }
          if (evt.key === LOGOUT_BLACKLIST_KEY) {
            try {
              var cur = localStorage.getItem(ADMIN_STORAGE_KEY);
              if (cur) {
                var curSess = JSON.parse(cur);
                if (__isBlacklistedSess(curSess && curSess.id)) window.location.replace('login.html');
              }
            } catch (_) {}
          }
        }, false);
      } catch (_evt) {}

      // —— 角色级别映射（与后端 ROLE_LEVEL 对齐，前端 admin→super_admin, finance→finance_admin）——
      var __ROLE_LEVEL = { super_admin:999, admin:999, ops:800, director:700, finance_checker:600, finance_cashier:520, finance_maker:550, finance_view:510, finance_admin:500, finance:500, staff:100 };
      function __getRoleLevel(role) {
        if (!role) return 0;
        return __ROLE_LEVEL[role] || 0;
      }
      // —— 基于角色过滤侧边栏菜单（隐藏无权限菜单项）——
      function __applyRoleMenuFilter(session) {
        if (!session) return;
        var userLevel = __getRoleLevel(session.role);
        var items = document.querySelectorAll('.admin-sidebar-menu .admin-menu-item[data-role-level]');
        items.forEach(function(item) {
          var need = parseInt(item.getAttribute('data-role-level'), 10) || 0;
          if (userLevel < need) {
            item.style.display = 'none';
          }
        });
      }

      var currentSession = checkAuth();
      __applyRoleMenuFilter(currentSession);
      // —— 页面级权限拦截：直接访问 URL 时检查角色，不足则跳首页 ——
      (function() {
        if (!currentSession) return;
        var userLvl = __getRoleLevel(currentSession.role);
        if (userLvl < 800) {
          location.replace('index.html');
        }
      })();

      var tabItems = document.querySelectorAll('.tab-item');
      var tabContents = document.querySelectorAll('.tab-content');
      tabItems.forEach(function(item) {
        item.addEventListener('click', function() {
          var tab = this.getAttribute('data-tab');
          tabItems.forEach(function(i) { i.classList.remove('active'); });
          tabContents.forEach(function(c) { c.classList.remove('active'); });
          this.classList.add('active');
          var target = document.getElementById('tab-' + tab);
          if (target) target.classList.add('active');
        });
      });

      var sidebar = document.getElementById('adminSidebar');
      var overlay = document.getElementById('sidebarOverlay');
      var toggle = document.getElementById('sidebarToggle');
      function openMobileSidebar() {
        sidebar.classList.add('mobile-open');
        overlay.classList.add('active');
      }
      function closeMobileSidebar() {
        sidebar.classList.remove('mobile-open');
        overlay.classList.remove('active');
      }
      if (toggle) {
        toggle.addEventListener('click', function() {
          if (sidebar.classList.contains('mobile-open')) {
            closeMobileSidebar();
          } else {
            openMobileSidebar();
          }
        });
      }
      if (overlay) {
        overlay.addEventListener('click', closeMobileSidebar);
      }

      window.toggleFullscreen = function() {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen && document.exitFullscreen();
        }
      };

      function logout() {
        if (window.confirm('确定要退出登录吗？')) {
          try {
            var curSessId = (currentSession && currentSession.id) ? currentSession.id : null;
            if (curSessId) {
              var blackList = [];
              try {
                var raw = localStorage.getItem(LOGOUT_BLACKLIST_KEY);
                if (raw) blackList = JSON.parse(raw) || [];
              } catch (_) {}
              blackList.push({ id: curSessId, ts: Date.now() });
              if (blackList.length > 100) blackList = blackList.slice(-100);
              try { localStorage.setItem(LOGOUT_BLACKLIST_KEY, JSON.stringify(blackList)); } catch (_) {}
            }
          } catch (_blk) {}
          localStorage.removeItem(ADMIN_STORAGE_KEY);
          __clearAdminLegacyKeys(ADMIN_STORAGE_KEY);
          if (window.QinApp && window.QinApp.Admin) {
            try { window.QinApp.Admin.logout(); } catch (_a) {}
          }
          try { window.location.replace('login.html'); } catch (_loc) { window.location.href = 'login.html'; }
        }
      }
      var logoutBtn = document.getElementById('logoutBtnSidebar');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
      }

      // =============================================================================
      // 🔧 E1 FIX：官网内容管理 全按钮自动化事件绑定 + 去抖
      // =============================================================================

    })();

/* ===== content.html inline block (run 2, #2/7) ===== */
/* ========== 🔒 防重复注入保护：多次粘贴时，第二份自动跳过 ========== */
if (window.__DBF_V20260804_INJECTED__ !== true) {
  window.__DBF_V20260804_INJECTED__ = true;

/* ========== 📊 JSON 性能日志（默认关闭，开启后输出NDJSON便于ELK采集） ========== */
function __pEna(){try{return window.localStorage&&localStorage.getItem('__ENABLE_PERF_LOG__')==='true'}catch(e){return false}}
function __pFmt(){try{return(window.localStorage&&localStorage.getItem('__PERF_FORMAT__')||'json').toLowerCase()}catch(e){return'json'}}
function __pTid(){if(!window.__pCur){window.__pCur='tr_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5)}return window.__pCur}
function __pUA(){try{return navigator.userAgent||''}catch(e){return''}}
function __pURL(){try{return location.href||''}catch(e){return''}}
function __pLog(module,event,extra){
  if(!__pEna())return;
  try{
    var now=new Date();
    var duration_ms = (window.__pT0 ? (Date.now()-window.__pT0) : 0);
    var payload = {
      '@timestamp': now.toISOString(),
      'level': 'INFO',
      'service': 'qaxqjt-admin',
      'trace_id': __pTid(),
      'span_id': 'sp_'+now.getTime().toString(36),
      'module': module,            // 'DBF' 或 'SP'
      'event': event,              // 'save_click' / 'audit_pass' 等
      'branch': (extra && extra.branch) ? extra.branch : null,
      'btn_text': (extra && extra.txt) ? extra.txt : null,
      'bound':    (extra && typeof extra.bound==='boolean') ? extra.bound : null,
      'lock_wait_ms': (extra && typeof extra.lockWait==='number') ? extra.lockWait : 0,
      'duration_ms': duration_ms,
      'page_url': __pURL(),
      'user_agent': __pUA(),
      'extra': extra || {}
    };
    // 删除已经提出来的重复字段，避免冗余
    if(payload.extra){
      ['branch','txt','bound','lockWait'].forEach(function(k){if(payload.extra[k]!==undefined)delete payload.extra[k]});
    }
    // 输出 NDJSON（一行一条），便于 Filebeat / Logstash 直接采集
    console.log(JSON.stringify(payload));
  }catch(_){}
}
var __pT0=0;


  (function(){
    function __T(msg,type){ try{ window.QinApp&&QinApp.Utils&&QinApp.Utils.toast(msg,type||'info',3000); }catch(_e){ try{(type==='error'?alert:console.log)('[deadhook] '+msg);}catch(_f){} } }
    function __L(key,ttl){
      if(window.__OP_LOCKS&&window.__OP_LOCKS[key]) return false;
      try{ if(!window.__OP_LOCKS)window.__OP_LOCKS={}; window.__OP_LOCKS[key]=true; setTimeout(function(){try{delete window.__OP_LOCKS[key];}catch(_){}},ttl||600); }catch(_){}
      return true;
    }
    // 只在 capture 阶段处理，便于在页面原有 handlers 之前运行：若按钮已存在 onclick / 已绑过事件，直接跳过
    document.addEventListener('click', function(e){
    __pT0 = Date.now();
    var __pEvt = {target: e.target && e.target.tagName, btn: null, txt: null, branch: null, bound: null, lockWait: 0};
    window.__pCur = 'tr_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    var t = e.target;
      if(!t) return;
      // 向上找最近的按钮元素/可点击锚点 - 扩大匹配范围，包含a标签和所有含btn/action类的元素
      var btn = (t.tagName||'').toLowerCase() === 'button' ? t :
                (t.closest ? t.closest('button, a, [role="button"], .btn, .btn-action, .btn-sm, .action-link, [data-action]') : null);
      if(!btn) return;
      // 跳过已有 onclick / 正常href跳转 / 已在脚本中手动绑定过（__bindDone=1 或 __ctE2Done=1）的按钮
      // 注意：data-action仅作为标识，不代表已绑定事件；父元素检查仅对onclick生效
      try{
  function __btnHasBound(btn){
    if(!btn) return false;
    if(btn.__superPatchBound) return true;
    var oc = btn.getAttribute && btn.getAttribute('onclick');
    var hr = btn.getAttribute && btn.getAttribute('href');
    if(oc && oc.length > 3) return true;
    // 仅当href不是占位符且不是javascript伪协议时才算有效跳转
    if(hr && hr !== '#' && hr !== 'javascript:;' && hr !== 'javascript:void(0);' && hr !== 'javascript:void(0)' && hr !== '' && hr.indexOf('javascript:') !== 0) return true;
    var p = btn.parentElement, lvl = 0;
    while(p && lvl < 4){
      try {
        var pOc = p.getAttribute && p.getAttribute('onclick');
        // 父级onclick长度>3才算有效绑定
        if(pOc && pOc.length > 3) return true;
      }catch(_){}
      p = p.parentElement; lvl++;
    }
    // 移除：匹配业务关键词=已绑定的错误逻辑。这些恰恰是需要兜底的按钮！
    return false;
  }
  var __pBnd = __btnHasBound(btn);
    __pEvt.bound = __pBnd;
    __pLog('DBF','hasBound_result', {bound:__pBnd, check_ms:Date.now()-__pT0});
    if(__pBnd) return;
    var __pDrp = (btn.__bindDone || btn.__ctE2Done);
    if(__pDrp){__pLog('DBF','dedup_skip', {reason: btn.__bindDone?'bindDone':'ctE2Done'}); return;}
}catch(_a){}
      var txt = (btn.textContent||'').replace(/\s+/g,' ').trim();
      // 放宽文本长度限制：从20字符放宽到50字符，覆盖"确认订单""取消订单""派工安排"等复合文本
      __pEvt.txt = txt;
    __pLog('DBF','txt_resolved', {txt:txt, len:txt.length});
    if(!txt || txt.length > 50) return;
      var tr = btn.closest ? btn.closest('tr') : null;
      var trKey = '';
      if(tr){ var ftd = tr.querySelector('td, th'); if(ftd) trKey = (ftd.textContent||'').replace(/\s+/g,' ').trim().slice(0,20); }
      // 各按钮分发行文
      var isSave = (txt.indexOf('保存')>=0 || txt.indexOf('提交')>=0 || txt.indexOf('确认')>=0);
      var isEdit = (txt.indexOf('编辑')>=0);
      var isDel  = (txt.indexOf('删除')>=0 && txt.length <= 10);
      var isView = (txt.indexOf('查看')>=0 || (txt==='👁') || (txt.indexOf('👁')>=0 && txt.length<=6) || txt.indexOf('详情')>=0 || txt.indexOf('预览')>=0);
      var isVerify = (txt.indexOf('核销')>=0);
      var isExport = (txt.indexOf('导出')>=0);
      var isAdd = (txt.indexOf('新增')>=0);
      var doneKey = 'e2_'+(isSave?'s':isEdit?'e':isDel?'d':isView?'v':isVerify?'y':isExport?'x':isAdd?'a':'k')+'_'+(trKey||Math.random().toString(36).slice(2,6));
      if(isSave){
    __pEvt.branch='save';
    var __pLk = __L(doneKey,900);
    if(!__pLk) { __T('⏳ 保存提交中，请稍候…','warning'); try { e.stopPropagation(); } catch(_a){} return; }
    __pLog('DBF','save_submit', Object.assign({},__pEvt,{row:trKey, lock:__pLk, toast:'success'}));
        /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __T('该功能暂未接入后端','warning');
        try { e.preventDefault(); e.stopImmediatePropagation(); } catch(_b){} return;
      }
      if(isEdit){
        if(!__L(doneKey,700)) return;
        __pLog('DBF','edit_open', Object.assign({},__pEvt,{row:trKey, branch:'edit'}));
        /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __T('该功能暂未接入后端','warning');
        try { e.preventDefault(); e.stopImmediatePropagation(); } catch(_b){} return;
      }
      if(isDel){
        if(!__L(doneKey,850)) { __T('⏳ 删除处理中…','warning'); try { e.stopPropagation(); } catch(_a){} return; }
        __pLog('DBF','delete_confirm', Object.assign({},__pEvt,{row:trKey, branch:'delete'}));
        /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __T('该功能暂未接入后端','warning');
        try { e.preventDefault(); e.stopImmediatePropagation(); } catch(_b){} return;
      }
      if(isView){
        if(!__L(doneKey,500)) return;
        __pLog('DBF','view_detail', Object.assign({},__pEvt,{row:trKey, branch:'view'}));
        /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __T('该功能暂未接入后端','warning');
        try { e.preventDefault(); e.stopImmediatePropagation(); } catch(_b){} return;
      }
      if(isVerify){
        if(!__L(doneKey,900)) { __T('⏳ 核销处理中…','warning'); return; }
        __pLog('DBF','verify_confirm', Object.assign({},__pEvt,{row:trKey, branch:'verify'}));
        /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __T('该功能暂未接入后端','warning');
        try { e.preventDefault(); e.stopImmediatePropagation(); } catch(_b){} return;
      }
      if(isExport){
        if(!__L(doneKey,1200)) { __T('⏳ 正在导出，请稍候…','warning'); return; }
        __pLog('DBF','export_start', Object.assign({},__pEvt,{row:trKey, branch:'export'}));
        /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __T('该功能暂未接入后端','warning');
        try { e.preventDefault(); e.stopImmediatePropagation(); } catch(_b){} return;
      }
      if(isAdd){
        if(!__L(doneKey,900)) return;
        __pLog('DBF','add_new', Object.assign({},__pEvt,{branch:'add'}));
        /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __T('该功能暂未接入后端','warning');
        try { e.preventDefault(); e.stopImmediatePropagation(); } catch(_b){} return;
      }
      // ---- 新增：审核/审批/驳回/通过 ----
      var isAudit = txt.indexOf('审核')>=0 || txt.indexOf('审批')>=0 || txt.indexOf('驳回')>=0 || txt.indexOf('通过')>=0;
      if(isAudit){
        if(!__L(doneKey,850)){ __T('⏳ 审核处理中…','warning'); try{e.stopPropagation();}catch(_a){} return; }
        var act = (txt.indexOf('驳回')>=0)?'驳回':(txt.indexOf('通过')>=0?'通过':'审核');
        __pLog('DBF','audit_result', Object.assign({},__pEvt,{row:trKey, branch:'audit', action:act}));
        /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __T('该功能暂未接入后端','warning');
        try { e.preventDefault(); e.stopImmediatePropagation(); } catch(_b){} return;
      }
      // ---- 新增：签约/签订 ----
      var isSign = txt.indexOf('签约')>=0 || txt.indexOf('签订')>=0 || (txt.indexOf('签')>=0 && txt.indexOf('约')>=0);
      if(isSign){
        if(!__L(doneKey,900)){ __T('⏳ 签约流程处理中…','warning'); try{e.stopPropagation();}catch(_a){} return; }
        __pLog('DBF','sign_confirm', Object.assign({},__pEvt,{row:trKey, branch:'sign'}));
        /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __T('该功能暂未接入后端','warning');
        try { e.preventDefault(); e.stopImmediatePropagation(); } catch(_b){} return;
      }
      // ---- 新增：合同/生成合同 ----
      var isContract = txt.indexOf('合同')>=0 && !isSign;
      if(isContract){
        if(!__L(doneKey,1000)){ __T('⏳ 正在准备合同文档…','warning'); return; }
        __pLog('DBF','contract_ready', Object.assign({},__pEvt,{row:trKey, branch:'contract'}));
        /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __T('该功能暂未接入后端','warning');
        try { e.preventDefault(); e.stopImmediatePropagation(); } catch(_b){} return;
      }
      // ---- 新增：排期/排班/安排档期 ----
      var isScheduleBtn = txt.indexOf('排期')>=0 || txt.indexOf('排班')>=0 || (txt.indexOf('安排')>=0 && (txt.length<=8 || txt.indexOf('档期')>=0));
      if(isScheduleBtn){
        if(!__L(doneKey,800)){ __T('⏳ 正在打开排期面板…','warning'); return; }
        __pLog('DBF','schedule_open', Object.assign({},__pEvt,{row:trKey, branch:'schedule'}));
        /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __T('该功能暂未接入后端','warning');
        try { e.preventDefault(); e.stopImmediatePropagation(); } catch(_b){} return;
      }
      // ---- 新增：取消/处理/确认接单 ----
      var isCancelOrHandle = txt.indexOf('取消')>=0 || txt.indexOf('处理')>=0 || txt.indexOf('确认接单')>=0 || txt.indexOf('派工')>=0;
      if(isCancelOrHandle && !isDel && !isSave){
        if(!__L(doneKey,800)){ __T('⏳ 处理中…','warning'); try{e.stopPropagation();}catch(_a){} return; }
        var chBranch = txt.indexOf('取消')>=0?'cancel':(txt.indexOf('确认接单')>=0?'accept':(txt.indexOf('派工')>=0?'dispatch':'handle'));
        __pLog('DBF','status_change', Object.assign({},__pEvt,{row:trKey, branch:chBranch}));
        /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __T('该功能暂未接入后端','warning');
        try { e.preventDefault(); e.stopImmediatePropagation(); } catch(_b){} return;
      }

    }, true);
    console.info('[DeadButtonFallback 已加载：×兜底 + 保存/编辑/删除/查看/核销/导出/新增 死按钮兜底委托]');
  })();
  
} /* end of 防重复注入保护 if */

/* ===== content.html inline block (run 2, #3/7) ===== */
/* ========== 🔒 防重复注入保护：多次粘贴时，第二份自动跳过 ========== */
if (window.__SP_V20260804_INJECTED__ !== true) {
  window.__SP_V20260804_INJECTED__ = true;

/* ========== 📊 JSON 性能日志（默认关闭，开启后输出NDJSON便于ELK采集） ========== */
function __pEna(){try{return window.localStorage&&localStorage.getItem('__ENABLE_PERF_LOG__')==='true'}catch(e){return false}}
function __pFmt(){try{return(window.localStorage&&localStorage.getItem('__PERF_FORMAT__')||'json').toLowerCase()}catch(e){return'json'}}
function __pTid(){if(!window.__pCur){window.__pCur='tr_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5)}return window.__pCur}
function __pUA(){try{return navigator.userAgent||''}catch(e){return''}}
function __pURL(){try{return location.href||''}catch(e){return''}}
var __spT0=0;
var __spEvt={};
function __pLog(module,event,extra){
  if(!__pEna())return;
  try{
    var now=new Date();
    var duration_ms = (__spT0 ? (Date.now()-__spT0) : 0);
    var payload = {
      '@timestamp': now.toISOString(),
      'level': 'INFO',
      'service': 'qaxqjt-admin',
      'trace_id': __pTid(),
      'span_id': 'sp_'+now.getTime().toString(36),
      'module': module,
      'event': event,
      'branch': (extra && extra.branch) ? extra.branch : null,
      'btn_text': (extra && extra.txt) ? extra.txt : null,
      'btn_selector': (extra && extra.btn) ? extra.btn : null,
      'bound': (extra && typeof extra.bound==='boolean') ? extra.bound : null,
      'lock_wait_ms': (extra && typeof extra.lockWait==='number') ? extra.lockWait : 0,
      'duration_ms': duration_ms,
      'page_url': __pURL(),
      'user_agent': __pUA(),
      'extra': extra || {}
    };
    if(payload.extra){
      ['branch','txt','bound','lockWait','btn'].forEach(function(k){if(payload.extra[k]!==undefined)delete payload.extra[k]});
    }
    console.log(JSON.stringify(payload));
  }catch(_){}
}


(function(){
  'use strict';
  var PATCH_ID = 'adminSuperPatchV20260730';

  function _genId(prefix){
    var d = new Date();
    var pad = function(n){ return n<10?'0'+n:''+n; };
    var ymd = d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate());
    var hms = pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds());
    var rnd = Math.floor(Math.random()*90+10);
    return prefix + ymd + hms + rnd;
  }

  function _pad2(n){ return n<10?'0'+n:''+n; }

  if(!window.__toastH9){
    window.__toastH9 = function(msg, type){
      try{
        if(window.QinApp && QinApp.Utils && typeof QinApp.Utils.toast==='function'){
          QinApp.Utils.toast(msg, type||'info');
          return;
        }
        var ts = document.querySelector('.toast-stack');
        if(!ts){
          ts = document.createElement('div');
          ts.className = 'toast-stack';
          ts.setAttribute('aria-live','polite');
          ts.style.cssText='position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
          document.body.appendChild(ts);
        }
        var el = document.createElement('div');
        var bg = 'linear-gradient(135deg,#475569,#334155)';
        if(type==='success') bg='linear-gradient(135deg,#16a34a,#15803d)';
        if(type==='error') bg='linear-gradient(135deg,#dc2626,#b91c1c)';
        if(type==='warning') bg='linear-gradient(135deg,#f59e0b,#d97706)';
        if(type==='info') bg='linear-gradient(135deg,#0284c7,#0369a1)';
        el.style.cssText='background:'+bg+';color:#fff;padding:10px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,0.18);font-size:0.85rem;max-width:360px;pointer-events:auto;animation:toastInH9 .25s ease;';
        el.textContent = msg;
        ts.appendChild(el);
        var st = document.createElement('style');
        if(!document.getElementById('_toastH9Anim')){
          st.id='_toastH9Anim';
          st.textContent='@keyframes toastInH9{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:translateY(0);}}';
          document.head.appendChild(st);
        }
        setTimeout(function(){ el.style.transition='opacity .3s,transform .3s'; el.style.opacity='0'; el.style.transform='translateY(-8px)'; setTimeout(function(){ el.remove(); },320); }, 2600);
      }catch(e){ console.warn('[toastH9]',e); }
    };
  }

  if(!window.__acqH9){
    window.__acqH9 = function(btn, txtType){
      var lockKey = '__acqLock_'+(btn&&btn.dataset?btn.dataset.acqKey:'global');
      var now = Date.now();
      var last = parseInt(btn&&btn.dataset?btn.dataset.__acqLast:'0',10)||0;
      var expire = 400;
      if(txtType==='save'||txtType==='submit'||txtType==='confirm') expire=900;
      if(txtType==='delete'||txtType==='cancel'||txtType==='disable') expire=1200;
      if(now-last<expire){ return false; }
      if(btn&&btn.dataset){ btn.dataset.__acqLast = now; }
      return true;
    };
  }

  try{
    console.info('[SuperPatch 1/6] FORM SUBMIT/RESET 防刷新 + 必填校验 初始化...');
    document.addEventListener('submit', function(e){
      try{
        var form = e.target;
        if(!form||form.tagName!=='FORM') return;
        e.preventDefault();
        e.stopPropagation();
        var fields = form.querySelectorAll('input,select,textarea');
        var ok = true;
        var firstErr = null;
        fields.forEach(function(f){
          if(f.disabled||f.type==='file'||f.type==='hidden'||f.type==='button'||f.type==='submit'||f.type==='reset') return;
          var isRequired = f.hasAttribute('required')||(f.classList&&f.classList.contains('required'));
          var lbl = '';
          var labelEl = form.querySelector('label[for="'+f.id+'"]')||f.closest('label');
          if(labelEl) lbl = labelEl.textContent.trim();
          if(!lbl){
            var ph = f.getAttribute('placeholder')||'';
            if(ph&&ph.slice(-1)==='*'){ isRequired=true; lbl=ph.slice(0,-1).trim(); }
          }
          if(labelEl&&labelEl.textContent.indexOf('*')>=0){ isRequired=true; lbl=labelEl.textContent.replace(/\*/g,'').trim(); }
          if(!lbl){
            var nm = f.getAttribute('name')||f.id||'';
            lbl = '「'+nm+'」';
          }
          var val = (f.value||'').trim();
          f.classList.remove('input-error');
          if(isRequired&&!val){
            f.classList.add('input-error');
            f.style.borderColor='#dc2626'; f.style.boxShadow='0 0 0 3px rgba(220,38,38,0.1)';
            __toastH9('⚠️ 请完整填写'+lbl+'后再提交','error');
            ok=false; if(!firstErr) firstErr=f;
            return;
          }
          if(val){
            var t = f.type||'';
            var n = (f.getAttribute('name')||'').toLowerCase();
            var telReg = /^1[3-9]\d{9}$/;
            var mailReg = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;
            var dateReg = /^\d{4}-\d{2}-\d{2}$/;
            if(t==='tel'||n.indexOf('phone')>=0||n.indexOf('mobile')>=0){
              if(!telReg.test(val)){ f.classList.add('input-error'); f.style.borderColor='#dc2626'; __toastH9('⚠️ '+lbl+'格式不正确（11位手机号）','error'); ok=false; if(!firstErr)firstErr=f; return; }
            }
            if(t==='email'||n.indexOf('mail')>=0){
              if(!mailReg.test(val)){ f.classList.add('input-error'); f.style.borderColor='#dc2626'; __toastH9('⚠️ '+lbl+'邮箱格式不正确','error'); ok=false; if(!firstErr)firstErr=f; return; }
            }
            if(n.indexOf('amount')>=0||n.indexOf('price')>=0||n.indexOf('money')>=0){
              var nv = Number(val);
              if(isNaN(nv)||nv<0){ f.classList.add('input-error'); f.style.borderColor='#dc2626'; __toastH9('⚠️ '+lbl+'金额必须≥0','error'); ok=false; if(!firstErr)firstErr=f; return; }
            }
            if(t==='number'){
              var nv2 = +val;
              if(!Number.isInteger(nv2)||nv2<0){ f.classList.add('input-error'); f.style.borderColor='#dc2626'; __toastH9('⚠️ '+lbl+'必须是非负整数','error'); ok=false; if(!firstErr)firstErr=f; return; }
            }
            if(t==='date'){
              if(!dateReg.test(val)){ f.classList.add('input-error'); f.style.borderColor='#dc2626'; __toastH9('⚠️ '+lbl+'日期格式应为YYYY-MM-DD','error'); ok=false; if(!firstErr)firstErr=f; return; }
            }
          }
        });
        if(firstErr){ try{ firstErr.focus(); }catch(_){} }
        if(!ok) return false;
        /* P1修复:假成功已移除（保留 preventDefault 防原生提交刷新，必填校验仍生效） */
        console.warn('[P1] 未接线表单提交:', (form && (form.id||form.name)) || 'form');
        __toastH9('该功能暂未接入后端','warning');
        return false;
      }catch(e1){ console.warn('[SuperPatch 1/6 submit err]',e1); return false; }
    }, true);

    document.addEventListener('reset', function(e){
      try{
        var form = e.target;
        if(!form||form.tagName!=='FORM') return;
        e.preventDefault();
        e.stopPropagation();
        form.querySelectorAll('input,select,textarea').forEach(function(f){
          if(f.type==='file'){ try{f.value='';}catch(_){} }
          else if(f.type==='checkbox'||f.type==='radio'){ f.checked=false; }
          else{ f.value=''; }
          f.classList.remove('input-error');
          try{ f.style.borderColor=''; f.style.boxShadow=''; }catch(_){}
        });
        __toastH9('🔄 已重置','info');
        return false;
      }catch(e2){ console.warn('[SuperPatch 1/6 reset err]',e2); return false; }
    }, true);

    var cssErr = document.createElement('style');
    cssErr.textContent = '.input-error{border-color:#dc2626 !important;box-shadow:0 0 0 3px rgba(220,38,38,0.12) !important;transition:all .2s;}';
    document.head.appendChild(cssErr);
    console.info('[SuperPatch 1/6] 已激活 ✓');
  }catch(e){ console.warn('[SuperPatch 1/6 init err]',e); }

  try{
    console.info('[SuperPatch 2/6] 编号自动生成（只读、不可手改）初始化...');
    var idRules = [
      {keys:['订单编号','orderNo','orderId'], prefix:'QAX'},
      {keys:['收款编号','收款单','receiptId'], prefix:'SK'},
      {keys:['票据编号','凭证编号','voucherId'], prefix:'PZ'},
      {keys:['工资条编号','wageId'], prefix:'GZ'},
      {keys:['派工编号','dispatchId'], prefix:'PG'},
      {keys:['档期编号','scheduleId'], prefix:'DQ'},
      {keys:['合同编号','HT','contractId'], prefix:'HT'}
    ];
    function _matchIdRule(inp){
      var hay = [inp.id||'', inp.name||'', inp.getAttribute('aria-label')||'', inp.getAttribute('placeholder')||''];
      try{
        var lbl = document.querySelector('label[for="'+inp.id+'"]');
        if(lbl) hay.push(lbl.textContent||'');
        var par = inp.closest('[class*="form-group"],[class*="form-item"],td,th,div');
        if(par) hay.push(par.textContent||'');
      }catch(_){}
      var s = hay.join(' ');
      for(var i=0;i<idRules.length;i++){
        var r = idRules[i];
        for(var j=0;j<r.keys.length;j++){
          if(s.indexOf(r.keys[j])>=0) return r;
        }
      }
      return null;
    }
    function _fillIds(scope){
      try{
        var inputs = (scope||document).querySelectorAll('input[type=text],input:not([type])');
        inputs.forEach(function(inp){
          if(inp.readOnly||inp.disabled) return;
          var rule = _matchIdRule(inp);
          if(!rule) return;
          if((inp.value||'').trim()!=='') return;
          inp.value = _genId(rule.prefix);
          inp.setAttribute('readonly','readonly');
          inp.style.cursor='not-allowed';
          inp.style.background='#f8fafc';
        });
      }catch(e){ console.warn('[SuperPatch 2/6 fillIds err]',e); }
    }
    function _refreshIdsOnNew(scope){
      try{
        var inputs = (scope||document).querySelectorAll('input[readonly]');
        inputs.forEach(function(inp){
          var rule = _matchIdRule(inp);
          if(!rule) return;
          inp.value = _genId(rule.prefix);
        });
      }catch(e){ console.warn('[SuperPatch 2/6 refreshIds err]',e); }
    }
    document.addEventListener('DOMContentLoaded', function(){ _fillIds(); }, {once:true});
    if(document.readyState==='complete'||document.readyState==='interactive'){ _fillIds(); }
    else{ setTimeout(_fillIds, 50); }
    if(typeof MutationObserver!=='undefined'){
      var mo = new MutationObserver(function(muts){
        muts.forEach(function(m){
          if(m.addedNodes&&m.addedNodes.length){
            m.addedNodes.forEach(function(n){
              if(n.nodeType===1) _fillIds(n);
            });
          }
        });
      });
      mo.observe(document.body, {childList:true, subtree:true});
    }
    document.addEventListener('click', function(e){
      try{
        var btn = e.target.closest('button,a,[role=button]');
        if(!btn) return;
    __spT0 = Date.now();
    __spEvt={target: (btn.tagName||'?') + '.' + (btn.className||'').slice(0,40), txt: (btn.textContent||'').trim()};
    __pLog('SP','click_match', {btn:__spEvt.target, txt:__spEvt.txt, ms:Date.now()-__spT0});
    var txt = (btn.textContent||'').trim().toLowerCase();
        var html = (btn.innerHTML||'').toLowerCase();
        var idCls = (btn.id||'').toLowerCase()+' '+(btn.className||'').toLowerCase();
        if(txt.indexOf('新建')>=0||txt.indexOf('➕')>=0||txt.indexOf('+new')>=0||html.indexOf('➕')>=0||idCls.indexOf('btnadd')>=0||idCls.indexOf('-new')>=0||idCls.indexOf('new')>=0){
          setTimeout(function(){ _refreshIdsOnNew(); }, 80);
        }
      }catch(_){}
    }, true);
    console.info('[SuperPatch 2/6] 已激活 ✓');
  }catch(e){ console.warn('[SuperPatch 2/6 init err]',e); }

  try{
    console.info('[SuperPatch 3/6] 取消/关闭/我知道了/× 关弹窗不刷新 初始化...');
    var closeTexts = ['取消','关闭','我知道了','我明白了','知道了','确定取消'];
    var closeChs = ['×','✕','✖','✘','❌','⨯'];
    document.addEventListener('click', function(e){
      try{
        var el = e.target;
        // 内容管理：编辑弹窗/预览弹窗自带完整事件处理（保存草稿/发布/预览/关闭），跳过全局关闭拦截
        if(el && el.closest && el.closest('#contentPreviewModal,#contentNewsModal')) return;
        // 已由业务模块绑定的按钮（__superPatchBound/__deadBtnChecked/__bindDone）跳过全局关闭拦截，避免「取消修改」等被误吞
        var _boundBtn = el && el.closest ? el.closest('button,a,[role=button],[data-action]') : null;
        if(_boundBtn && (_boundBtn.__superPatchBound || _boundBtn.__deadBtnChecked || _boundBtn.__bindDone)) return;
        var txt = (el.textContent||'').trim();
        if(!txt&&el.closest){ txt = (el.closest('button,a,[role=button],span,div')||{}).textContent||''; txt=txt.trim(); }
        var isClose = false;
        if(closeChs.indexOf(txt)>=0) isClose=true;
        for(var i=0;i<closeTexts.length;i++){
          if(txt===closeTexts[i]||(txt.length<=12&&txt.indexOf(closeTexts[i])>=0)){ isClose=true; break; }
        }
        if(!isClose) return;
        e.preventDefault();
        e.stopPropagation();
        var handled=false;
        try{ if(typeof window.__closeAnyModal==='function'){ window.__closeAnyModal(); handled=true; } }catch(_){}
        if(!handled){
          var sels = [
            'div[class*="modal-"]','div[class*="Modal"]','div[class*="overlay"]',
            'div[id*="Modal"]','div[id*="modal"]','div[class*="popup"]','div[class*="Popup"]',
            'div[class*="dialog"]','div[class*="Dialog"]'
          ];
          sels.forEach(function(sel){
            try{
              var arr = document.querySelectorAll(sel);
              arr.forEach(function(n){
                if(n&&n.style){
                  n.style.display='none';
                  try{ n.classList.add('csp-hide'); }catch(_){}
                }
              });
            }catch(_){}
          });
        }
        __toastH9('↩️ 已关闭弹窗','info');
      }catch(e3){ console.warn('[SuperPatch 3/6 click err]',e3); }
    }, true);
    console.info('[SuperPatch 3/6] 已激活 ✓');
  }catch(e){ console.warn('[SuperPatch 3/6 init err]',e); }

  try{
    console.info('[SuperPatch 4/6] 分页器标准化 (pagination.js结构) 初始化...');
    var pgStateMap = new WeakMap();
    function _isPgContainer(el){
      try{
        if(!el || el.nodeType!==1) return false;
        if(el.closest && el.closest('.sp-pg-toolbar-20260730,.pagination-toolbar')) return false;
        var tag = (el.tagName||'').toUpperCase();
        if(tag==='HTML'||tag==='BODY'||tag==='MAIN'||tag==='SECTION'||tag==='ARTICLE') return false;
        var c = (el.className||'')+'|'+(el.id||'')+'|'+(el.getAttribute&&el.getAttribute('data-paginate')||'')+'|'+(el.getAttribute&&el.getAttribute('data-pg')||'');
        if(c.search(/pagination|pager|pagebar|pageBar|paginate|page-number-item|pagerbar|pagebar/i)<0) return false;
        var exclude = /admin[-_]?main|admin[-_]?content|main[-_]?content|stats[-_]?grid|list[-_]?grid|card[-_]?grid|table[-_]?wrap|table[-_]?container|data[-_]?wrap|content[-_]?wrap|page[-_]?content|admin[-_]?wrap|app[-_]?main/i;
        if(exclude.test(c)) return false;
        if(el.querySelector('[data-pg]')||el.querySelector('.page-number-item')||el.querySelector('button[data-pg]')) return true;
        return true;
      }catch(_){ return false; }
    }
    function _ensurePgState(container){
      if(!pgStateMap.has(container)){
        var total = 100;
        var tbody = document.querySelector('tbody[data-paginate=list]');
        if(tbody){
          var sz = parseInt(tbody.getAttribute('data-page-size')||'10',10);
          var rows = tbody.querySelectorAll('tr:not([style*=none]):not(.csp-hide)').length;
          total = Math.max(100, rows*sz);
        }
        var size = 10;
        var existing = container.querySelector('select[data-pg=size]');
        if(existing){ try{ size = parseInt(existing.value||'10',10)||10; }catch(_){} }
        pgStateMap.set(container, {total:total, pages:Math.ceil(total/size), current:1, size:size});
      }
      return pgStateMap.get(container);
    }
    function _buildPg(container){
      try{
        if(container.hasAttribute('data-pg-built')||container.querySelector('.sp-pg-toolbar-20260730')) return; container.setAttribute('data-pg-built','1');
        if(container.classList && (container.classList.contains('sp-pg-toolbar-20260730')||container.classList.contains('pagination-toolbar'))) return;
        var oldToolbar = container.querySelector('.pagination-toolbar');
        if(oldToolbar){ try { oldToolbar.remove(); } catch(_r1){} }
        var st = _ensurePgState(container);
        var children = container.children, nonPg = 0, i;
        for(i=0;i<children.length;i++){
          var c = children[i]; if(!c) continue;
          var cn = (c.className||'').toString(); var id = (c.id||'').toString(); var tag = (c.tagName||'').toString().toUpperCase();
          if(tag==='BUTTON'||tag==='SELECT'||tag==='SPAN'||tag==='INPUT') continue;
          if(cn.indexOf('pagination')>=0 || cn.indexOf('pager')>=0 || cn.indexOf('pagebar')>=0 || cn.indexOf('page-')>=0 || id.indexOf('page')>=0) continue;
          nonPg++;
        }
        if(nonPg===0){ try { container.innerHTML = ''; } catch(_eIn){} }
        var wrap = document.createElement('div');
        wrap.className = 'pagination-toolbar sp-pg-toolbar-20260730';
        wrap.setAttribute('data-pg-built','1');
        wrap.style.cssText='display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 4px;';
        wrap.innerHTML = ''+
          '<button class="btn btn-sm" data-pg="first">首页</button>'+
          '<button class="btn btn-sm" data-pg="prev">上一页</button>'+
          '<div class="page-number-wrap" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;"></div>'+
          '<button class="btn btn-sm" data-pg="next">下一页</button>'+
          '<button class="btn btn-sm" data-pg="last">末页</button>'+
          '<span style="margin-left:6px;">跳 <input type="number" data-pg="jump" min="1" style="width:60px;padding:4px 6px;border:1.5px solid var(--border-light,#cbd5e1);border-radius:6px;"> 页</span>'+
          '<select data-pg="size" style="padding:4px 8px;border:1.5px solid var(--border-light,#cbd5e1);border-radius:6px;">'+
            '<option value="10">10条/页</option><option value="20">20条/页</option><option value="50">50条/页</option><option value="100">100条/页</option>'+
          '</select>'+
          '<span data-pg="info" style="margin-left:auto;color:var(--text-light,#64748b);">共 0 条 / 第 1 页</span>';
        container.appendChild(wrap);
        wrap.querySelectorAll('button').forEach(function(b){ b.style.borderRadius='999px'; });
        var sel = wrap.querySelector('select[data-pg=size]'); if(sel&&st.size!=10){ sel.value=String(st.size); }
        _updatePgUI(container);
        wrap.addEventListener('click', function(ev){
          try{
            var t = ev.target.closest('[data-pg]');
            if(!t) return;
            var act = t.getAttribute('data-pg');
            var s = _ensurePgState(container);
            if(act==='first') s.current=1;
            else if(act==='prev') s.current=Math.max(1,s.current-1);
            else if(act==='next') s.current=Math.min(s.pages,s.current+1);
            else if(act==='last') s.current=s.pages;
            else return;
            _updatePgUI(container);
          }catch(_){}
        });
        var jp = wrap.querySelector('input[data-pg=jump]');
        if(jp){
          jp.addEventListener('change', function(){
            try{
              var s = _ensurePgState(container);
              var v = parseInt(jp.value||'1',10);
              if(isNaN(v)||v<1) v=1;
              if(v>s.pages) v=s.pages;
              s.current=v; jp.value=v;
              _updatePgUI(container);
            }catch(_){}
          });
          jp.addEventListener('keydown', function(ev){
            if(ev.key==='Enter'){ ev.preventDefault(); jp.dispatchEvent(new Event('change')); }
          });
        }
        var sz = wrap.querySelector('select[data-pg=size]');
        if(sz){
          sz.addEventListener('change', function(){
            try{
              var s = _ensurePgState(container);
              s.size = parseInt(sz.value||'10',10)||10;
              s.pages = Math.ceil(s.total/s.size);
              s.current = 1;
              _updatePgUI(container);
            }catch(_){}
          });
        }
      }catch(e){ console.warn('[SuperPatch 4/6 buildPg err]',e); }
    }
    function _updatePgUI(container){
      try{
        var wrap = container.querySelector('.sp-pg-toolbar-20260730') || container.querySelector('.pagination-toolbar');
        if(!wrap) return;
        var s = _ensurePgState(container);
        var pnWrap = wrap.querySelector('.page-number-wrap');
        var info = wrap.querySelector('[data-pg=info]');
        if(!pnWrap && !info){ return; }
        if(pnWrap){
          pnWrap.innerHTML='';
          var maxBtns = 7;
          var cur = s.current, totalPages=s.pages;
          var start = Math.max(1, cur - Math.floor(maxBtns/2));
          var end = Math.min(totalPages, start+maxBtns-1);
          start = Math.max(1, end-maxBtns+1);
          for(var p=start;p<=end;p++){
            var bb = document.createElement('button');
            bb.className='btn btn-sm';
            bb.setAttribute('data-pg','num');
            bb.style.borderRadius='999px';
            if(p===cur){ bb.style.background='linear-gradient(135deg,var(--primary,#0F4C81),var(--primary-dark,#0a3a63))'; bb.style.color='#fff'; bb.style.borderColor='var(--gold,#D4AF37)'; }
            bb.textContent = String(p);
            (function(pg){ bb.addEventListener('click', function(){ var st=_ensurePgState(container); st.current=pg; _updatePgUI(container); }); })(p);
            pnWrap.appendChild(bb);
          }
        }
        var info = wrap.querySelector('[data-pg=info]');
        if(info){ info.textContent = '共 '+s.total+' 条 / 第 '+s.current+' 页 / 共 '+s.pages+' 页'; }
        var firstB = wrap.querySelector('[data-pg=first]'), prevB=wrap.querySelector('[data-pg=prev]'), nxtB=wrap.querySelector('[data-pg=next]'), lastB=wrap.querySelector('[data-pg=last]');
        var atFirst = s.current<=1, atLast=s.current>=s.pages;
        [firstB,prevB].forEach(function(b){ if(b){ b.disabled=atFirst; b.style.opacity=atFirst?'0.45':'1'; b.style.cursor=atFirst?'not-allowed':'pointer'; } });
        [nxtB,lastB].forEach(function(b){ if(b){ b.disabled=atLast; b.style.opacity=atLast?'0.45':'1'; b.style.cursor=atLast?'not-allowed':'pointer'; } });
      }catch(e){ console.warn('[SuperPatch 4/6 updateUI err]',e); }
    }
    function _scanPagination(){
      try{
        var all = document.querySelectorAll('div,nav,section,span');
        all.forEach(function(el){ if(el.hasAttribute('data-pg-built')) return; if(_isPgContainer(el)) _buildPg(el); });
        var sty = document.createElement('style');
        if(!document.getElementById('_pgPatchCSS20260730')){
          sty.id='_pgPatchCSS20260730';
          sty.textContent='.pagination-toolbar button{border-radius:999px !important;}';
          document.head.appendChild(sty);
        }
      }catch(e){ console.warn('[SuperPatch 4/6 scan err]',e); }
    }
    document.addEventListener('DOMContentLoaded', _scanPagination, {once:true});
    if(document.readyState==='complete'||document.readyState==='interactive'){ _scanPagination(); }
    else{ setTimeout(_scanPagination, 100); }
    if(typeof MutationObserver!=='undefined'){
      var mo2 = new MutationObserver(function(){ clearTimeout(window.__pgTimer); window.__pgTimer=setTimeout(_scanPagination, 200); });
      mo2.observe(document.body, {childList:true, subtree:true});
    }
    console.info('[SuperPatch 4/6] 已激活 ✓');
  }catch(e){ console.warn('[SuperPatch 4/6 init err]',e); }

  try{
    console.info('[SuperPatch 5/6] 左侧栏 9 大主菜单 + 当前页高亮 初始化...');
    var main9 = [
      {title:'首页', href:'index.html', icon:'🏠'},
      {title:'订单预约与客户管理', href:'orders.html', icon:'📋'},
      {title:'剧目管理中心', href:'operas.html', icon:'🎭'},
      {title:'演出档期排班', href:'schedule.html', icon:'📅'},
      {title:'演员阵容与派工', href:'cast-sheet.html', icon:'👥'},
      {title:'内容与资讯管理', href:'content.html', icon:'📰'},
      {title:'财务与收款管理', href:'finance.html', icon:'💰'},
      {title:'员工与人事档案', href:'staff.html', icon:'👤'},
      {title:'系统设置', href:'system.html', icon:'⚙️'}
    ];
    function _getSidebarParent(){
      return document.getElementById('adminSidebar')||document.querySelector('.admin-sidebar')||document.querySelector('.admin-sidebar-wrap')||document.querySelector('.admin-sidebar-menu-wrap')||document.querySelector('nav .admin-menu-item, nav .admin-sidebar-menu, nav')||document.querySelector('nav');
    }
    function _getMenuContainer(){
      return document.querySelector('.admin-sidebar-menu')||document.querySelector('#adminSidebar nav')||document.querySelector('#adminSidebar');
    }
    function _standardizeMenu(){
      try{
        var sidebar = _getSidebarParent();
        if(!sidebar) return;
        var deployLinks = sidebar.querySelectorAll('a[href*="../deploy.html"],a[href*="deploy.html"]');
        deployLinks.forEach(function(a){ try{ a.classList.add('csp-hide'); }catch(_){} });
        var menuBox = _getMenuContainer();
        if(!menuBox) return;
        var existing = {};
        menuBox.querySelectorAll('a.admin-menu-item,a[href$=".html"]').forEach(function(a){
          var h = (a.getAttribute('href')||'').split('/').pop().toLowerCase();
          if(h) existing[h]=a;
        });
        var firstGroup = menuBox.querySelector('.admin-menu-group');
        var insertTarget = firstGroup||menuBox;
        var logoutAnchor = null;
        try{
          var tmp = sidebar.querySelector('#logoutBtnSidebar, a[href*="logout"], a:contains(退出)');
          if(tmp){
            logoutAnchor = tmp;
            while(logoutAnchor&&logoutAnchor.parentNode!==menuBox) logoutAnchor = logoutAnchor.parentNode;
          }
        }catch(_){ logoutAnchor=null; }
        var lastInGroup = insertTarget.lastElementChild;
        main9.forEach(function(m){
          var href = m.href.toLowerCase();
          if(existing[href]) return;
          var a = document.createElement('a');
          a.href = m.href;
          a.className = 'admin-menu-item';
          a.innerHTML = '<span class="menu-icon">'+m.icon+'</span><span>'+m.title+'</span>';
          if(logoutAnchor&&logoutAnchor.parentNode===insertTarget){
            insertTarget.insertBefore(a, logoutAnchor);
          }else if(lastInGroup){
            insertTarget.insertBefore(a, lastInGroup.nextSibling||null);
          }else{
            insertTarget.appendChild(a);
          }
        });
        var curPage = (location.pathname||'').split('/').pop().toLowerCase();
        if(!curPage){ try{ curPage = (location.href||'').split('/').pop().split('?')[0].toLowerCase(); }catch(_){} }
        menuBox.querySelectorAll('a.admin-menu-item,a[href$=".html"]').forEach(function(a){
          var href = (a.getAttribute('href')||'').split('/').pop().toLowerCase();
          a.classList.remove('active');
          try{ a.style.background=''; a.style.color=''; a.style.border=''; a.style.borderRadius=''; a.style.margin=''; }catch(_){}
          if(href===curPage){
            a.classList.add('active');
            try{
              var cs = getComputedStyle(a);
              var hasActiveStyle = (cs.backgroundImage&&cs.backgroundImage.indexOf('gradient')>=0)||(cs.color&&cs.color!=='');
              if(!hasActiveStyle||cs.background==='rgba(0,0,0,0)'){
                a.style.background='linear-gradient(135deg, rgba(212,175,55,0.25), rgba(139,0,0,0.18))';
                a.style.color='#fef3c7';
                a.style.border='1px solid rgba(212,175,55,0.45)';
                a.style.borderRadius='8px';
                a.style.margin='2px 0';
              }
            }catch(_){}
          }
        });
      }catch(e){ console.warn('[SuperPatch 5/6 standardize err]',e); }
    }
    document.addEventListener('DOMContentLoaded', _standardizeMenu, {once:true});
    if(document.readyState==='complete'||document.readyState==='interactive'){ _standardizeMenu(); }
    else{ setTimeout(_standardizeMenu, 50); }
    console.info('[SuperPatch 5/6] 已激活 ✓');
  }catch(e){ console.warn('[SuperPatch 5/6 init err]',e); }

  try{
    console.info('[SuperPatch 6/6] 死按钮兜底 + toast通道 初始化...');
    function _hasAction(btn){
      if(!btn) return false;
      // 仅onclick算真正绑定；data-action只是业务标识，不算；href需为真实跳转链接
      var oc = btn.getAttribute('onclick');
      var hr = btn.getAttribute('href');
      if(oc && oc.length > 3) return true;
      if(hr && hr !== '#' && hr !== '' && hr.indexOf('javascript:') !== 0) return true;
      if(btn.__deadBtnChecked) return true;
      if(btn.__superPatchBound) return true;
      return false;
    }
    function _txtMatch(txt, list){
      for(var i=0;i<list.length;i++){ if(txt.indexOf(list[i])>=0) return true; }
      return false;
    }
    document.addEventListener('click', function(e){
      try{
        // 修复：选择器扩大，包含a标签和[data-action]标识元素
        var btn = e.target.closest('button, a, [role=button], .btn, .btn-action, .btn-sm, [data-action]');
        if(!btn) return;
                // 修复：模态框内的确认/取消/关闭按钮跳过 SuperPatch，让事件传播到模态框 closeIt()
        if(btn.closest && btn.closest('.generic-modal-root, .modal-overlay-root, [role="dialog"], #contentPreviewModal, #contentNewsModal')) return;
        if(btn.hasAttribute && (btn.hasAttribute('data-modal-act') || btn.hasAttribute('data-modal-close'))) return;
        if(_hasAction(btn)) return;
        if(btn.__superPatchBound) return;
        /* P1修复:假成功已移除（不再一次性打标，重复点击仍给出诚实提示） */
        var txt = (btn.textContent||'').trim();
        var tt = 'other';
        // 修复：扩充业务分支，覆盖派工/审核/通过/驳回/签约/排期/确认接单等
        if(_txtMatch(txt,['保存','提交','确认','通过','签约','签订','确认接单','核销'])) tt='save';
        else if(_txtMatch(txt,['删除','作废','禁用','取消','驳回'])) tt='delete';
        else if(_txtMatch(txt,['编辑','查看','详情','预览'])) tt='view';
        else if(_txtMatch(txt,['导出','打印'])) tt='export';
        else if(_txtMatch(txt,['排期','排班','安排','派工','调度'])) tt='schedule';
        else if(_txtMatch(txt,['审核','审批'])) tt='audit';
        else if(_txtMatch(txt,['合同'])) tt='contract';
        else if(_txtMatch(txt,['新增','新建','添加'])) tt='add';
        if(!__acqH9(btn, tt)) return;
        e.preventDefault();
        e.stopPropagation();
        var tr = btn.closest ? btn.closest('tr') : null;
        var trKey = '';
        if(tr){ var ftd = tr.querySelector('td, th'); if(ftd) trKey = (ftd.textContent||'').replace(/\s+/g,' ').trim().slice(0,20); }
        __spT0 = Date.now();
        if(tt==='save'){
          __pLog('SP','fallback_save', {branch:tt, txt:txt, row:trKey});
          /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='delete'){
          __pLog('SP','fallback_delete', {branch:tt, txt:txt, row:trKey});
          /* P1修复:假成功已移除 */ console.warn('[P1] 未接线按钮:', txt); __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='view'){
          __pLog('SP','fallback_view', {branch:tt, txt:txt, row:trKey});
          /* P1修复:假成功已移除 */ __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='export'){
          __pLog('SP','fallback_export', {branch:tt, txt:txt, row:trKey});
          /* P1修复:假成功已移除 */ __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='schedule'){
          __pLog('SP','fallback_schedule', {branch:tt, txt:txt, row:trKey});
          /* P1修复:假成功已移除 */ __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='audit'){
          __pLog('SP','fallback_audit', {branch:tt, txt:txt, row:trKey});
          /* P1修复:假成功已移除 */ __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='contract'){
          __pLog('SP','fallback_contract', {branch:tt, txt:txt, row:trKey});
          /* P1修复:假成功已移除 */ __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='add'){
          __pLog('SP','fallback_add', {branch:tt, txt:txt, row:trKey});
          /* P1修复:假成功已移除 */ __toastH9('该功能暂未接入后端','warning');
        }else{
          __pLog('SP','fallback_other', {branch:tt, txt:txt, row:trKey});
          /* P1修复:假成功已移除 */ __toastH9('该功能暂未接入后端','warning');
        }
        return false;
      }catch(e6){ console.warn('[SuperPatch 6/6 click err]',e6); }
    }, true);
    console.info('[SuperPatch 6/6] 已激活 ✓');
  }catch(e){ console.warn('[SuperPatch 6/6 init err]',e); }

  console.info('['+PATCH_ID+'] 6合1超级补丁全部加载完毕 ✓');
})();

} /* end of 防重复注入保护 if */

/* ===== content.html inline block (run 2, #4/7) ===== */
/* ========== 🔽 下拉菜单 Click 切换（兼容移动端） ========== */
(function(){
  if(window.__DD_CLICK_INJECTED__) return;
  window.__DD_CLICK_INJECTED__ = true;
  document.addEventListener('click', function(e){
    var btn = e.target.closest ? e.target.closest('.action-dropdown-btn') : null;
    var menu = e.target.closest ? e.target.closest('.action-dropdown-menu') : null;
    // 关闭所有下拉菜单
    document.querySelectorAll('.action-dropdown-menu').forEach(function(m){
      if(m !== menu) m.style.display = 'none';
    });
    // 切换当前下拉菜单
    if(btn){
      var dd = btn.closest('.action-dropdown');
      if(dd){
        var m = dd.querySelector('.action-dropdown-menu');
        if(m){
          e.preventDefault();
          e.stopPropagation();
          m.style.display = (m.style.display === 'block') ? 'none' : 'block';
        }
      }
    }
  });
})();

/* ===== content.html inline block (run 2, #5/7) ===== */
/* ========== 🔒 通用 __closeAnyModal：关闭所有弹窗/遮罩 ========== */
(function(){
  if(window.__closeAnyModal) return;
  window.__closeAnyModal = function(){
    try{
      var overlays = document.querySelectorAll('.modal-overlay, [id$="Overlay"], [id$="overlay"], .overlay, [class*="modal-overlay"], .modal-overlay-root, [data-overlay]');
      overlays.forEach(function(o){
        try{ o.classList.remove('active','show','modal-overlay-show'); o.classList.add('s-overlay-hide','modal-overlay-hide','csp-hide'); }catch(_){ try{ o.style.display='none'; }catch(_a){} }
      });
      var modals = document.querySelectorAll('.modal, [id$="Modal"], [id$="modal"], [class*="modal-wrap"], .modal-wrap, .generic-modal-root, [data-modal], [role="dialog"]');
      modals.forEach(function(m){
        try{ m.classList.remove('active','show','modal-show'); m.classList.add('s-modal-hide','modal-wrap-hide','csp-hide'); }catch(_){ try{ m.style.display='none'; }catch(_a){} }
      });
    try{ document.body.classList.remove('body-modal-locked','modal-open','nav-locked'); }catch(_b){}
    }catch(err){ console.warn('[__closeAnyModal] err:', err); }
  };
  // ESC 键关闭弹窗
  document.addEventListener('keydown', function(e){
    if(e.key==='Escape'){
      var fns = ['closeAddModal','closeEditModal','closeDispatchModal','closeOrderViewModal','closeDeleteConfirm'];
      for(var i=0;i<fns.length;i++){ try{ if(typeof window[fns[i]]==='function') window[fns[i]](); }catch(_){} }
      window.__closeAnyModal();
    }
  });
})();

/* ===== content.html inline block (run 2, #6/7) ===== */
/* 按钮防拦截：为有id的可点击元素预设 __superPatchBound，避免 SuperPatch 首次点击拦截 */
(function(){
  function __markBound(){
    var els=document.querySelectorAll('button[id], a[id], [data-action][id], .btn[id], .btn-action[id]');
    for(var i=0;i<els.length;i++){ var el=els[i]; if(!el.__superPatchBound){ el.__superPatchBound=1; } }
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',__markBound); }
  else { __markBound(); setTimeout(__markBound,500); }
})();

/* ===== content.html inline block (run 2, #7/7) ===== */
/* ========================================================
 * content.html 新闻资讯 tab 按钮真实化（接 /v1/contents API）
 * 命名空间 __contentApi 避免与全局事件委托冲突
 * 创建：2026-09-21
 * 备份：content.html.bak-contentfix-20260921
 * ======================================================== */
(function(){
  'use strict';
  if (window.__contentApi) return;
  var API = window.QAXQJT_API;

  function _toast(msg, type){ try { if (typeof __T === 'function') return __T(msg, type||'info'); } catch(_){} try { console.log('[contentApi]', type, msg); } catch(_){} }
  function _escape(s){ if (s === null || s === undefined) return ''; return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function _val(id){ var el = document.getElementById(id); return el ? (el.value || '').trim() : ''; }
  function _setVal(id, v){ var el = document.getElementById(id); if (el) el.value = v || ''; }
  function _showModal(id, show){ var el = document.getElementById(id); if (el) el.style.display = show ? 'flex' : 'none'; }

  window.__contentApi = {
    state: { items: [], filter: { type: '', publishStatus: '', keyword: '' }, editingId: null, loaded: false, gallery: [] },

    load: async function(){
      try {
        var q = { page: 1, pageSize: 50 };
        if (this.state.filter.type) q.type = this.state.filter.type;
        if (this.state.filter.publishStatus) q.publishStatus = this.state.filter.publishStatus;
        if (this.state.filter.keyword) q.keyword = this.state.filter.keyword;
        var resp = await API.get('/v1/contents', { query: q });
        var rows = Array.isArray(resp) ? resp : (resp && (resp.items || resp.list || resp.rows)) || [];
        this.state.items = rows;
        this._render(rows);
        this.state.loaded = true;
      } catch(e) {
        console.warn('[__contentApi.load] 失败', e);
        _toast('⚠️ 加载文章列表失败：' + (e && e.message ? e.message : e), 'error');
        var tb = document.getElementById('contentNewsTbody');
        if (tb) tb.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:#dc2626;">❌ 加载失败：' + _escape(e && e.message ? e.message : String(e)) + '</td></tr>';
      }
    },

    _render: function(rows){
      var tb = document.getElementById('contentNewsTbody');
      if (!tb) return;
      var cnt = document.getElementById('contentNewsCount');
      if (cnt) cnt.textContent = '共 ' + rows.length + ' 篇';
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:#94a3b8;">📭 暂无文章，点击「➕ 新增文章」开始创建</td></tr>';
        return;
      }
      var self = this;
      var html = rows.map(function(r){
        var id = String(r.id || '');
        var cover = r.coverImage ? '<img src="' + _escape(r.coverImage) + '" style="width:48px;height:32px;object-fit:cover;border-radius:4px;" onerror="this.style.display=\'none\'" />' : '📭';
        var type = r.type || 'news';
        // 优先从 tagsJson 解码中文分类
        try {
          if (r.tagsJson) {
            var tj = typeof r.tagsJson === 'string' ? JSON.parse(r.tagsJson) : r.tagsJson;
            if (tj && tj.category) type = tj.category;
          }
        } catch(_) {}
        var title = _escape(r.title || '');
        var summary = _escape(r.summary || (r.contentBody || '').slice(0, 60));
        var author = _escape(r.authorName || '—');
        var pubDate = r.publishDate ? String(r.publishDate).slice(0, 10) : '—';
        var status = r.publishStatus || 'draft';
        var statusBadge = status === 'published' ? '<span class="badge badge-success">已发布</span>' : '<span class="badge badge-secondary">草稿</span>';
        return '<tr data-row-id="' + _escape(id) + '">' +
          '<td style="text-align:center;vertical-align:middle;"><input type="checkbox" class="batch-row-check" data-id="' + _escape(id) + '" style="width:17px;height:17px;cursor:pointer;accent-color:var(--primary,#0F4C81);" /></td>' +
          '<td style="font-family:monospace;font-weight:600;">' + _escape(id) + '</td>' +
          '<td>' + cover + '</td>' +
          '<td style="font-weight:600;">' + title + '</td>' +
          '<td><span class="badge badge-primary">' + _escape(type) + '</span></td>' +
          '<td><div class="news-summary-text">' + summary + '</div></td>' +
          '<td>' + author + '</td>' +
          '<td>' + pubDate + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td><div class="admin-table-actions">' +
            '<button class="btn btn-primary btn-sm" data-act="edit" data-id="' + _escape(id) + '">✏️</button>' +
            '<button class="btn btn-danger btn-sm" data-act="del" data-id="' + _escape(id) + '">🗑</button>' +
          '</div></td>' +
        '</tr>';
      }).join('');
      tb.innerHTML = html;
    },

    openAdd: function(){
      this.state.editingId = null;
      _setVal('contentNewsId', '');
      _setVal('contentNewsTitle', '');
      _setVal('contentNewsSubtitle', '');
      _setVal('contentNewsType', '剧团动态');
      _setVal('contentNewsAuthor', '');
      _setVal('contentNewsCover', '');
      var _hint = document.getElementById('contentNewsCoverHint');
      if (_hint) _hint.style.display = 'none';
      var _pv = document.getElementById('contentNewsCoverPreviewWrap');
      if (_pv) _pv.style.display = 'none';
      this.state.gallery = [];
      this.renderGallery();
      _setVal('contentNewsSummary', '');
      _setVal('contentNewsBody', '');
      _setVal('contentNewsPubDate', new Date().toISOString().slice(0,10));
      _setVal('contentNewsSort', '0');
      _setVal('contentNewsStatus', 'draft');
      var titleEl = document.getElementById('contentNewsModalTitle');
      if (titleEl) titleEl.textContent = '➕ 新增文章';
      _showModal('contentNewsModal', true);
    },

    openEdit: async function(id){
      try {
        var r = await API.get('/v1/contents/' + id);
        if (!r) throw new Error('文章不存在');
        this.state.editingId = id;
        _setVal('contentNewsId', id);
        _setVal('contentNewsTitle', r.title || '');
        _setVal('contentNewsSubtitle', r.subtitle || '');
        _setVal('contentNewsType', r.type || '剧团动态');
        // 优先用 tagsJson 中的中文分类回填下拉
        try {
          if (r.tagsJson) {
            var tj = typeof r.tagsJson === 'string' ? JSON.parse(r.tagsJson) : r.tagsJson;
            if (tj && tj.category) _setVal('contentNewsType', tj.category);
          }
        } catch(_) {}
        _setVal('contentNewsAuthor', r.authorName || '');
        _setVal('contentNewsCover', r.coverImage || '');
        var _hint2 = document.getElementById('contentNewsCoverHint');
        if (_hint2) _hint2.style.display = 'none';
        // 程序赋值不触发 input 事件，手动刷新封面预览
        var _ci = document.getElementById('contentNewsCover');
        if (_ci) { try { _ci.dispatchEvent(new Event('input')); } catch(_e){} }
        _setVal('contentNewsSummary', '');
        _setVal('contentNewsBody', r.contentBody || '');
        _setVal('contentNewsPubDate', r.publishDate ? String(r.publishDate).slice(0,10) : '');
        _setVal('contentNewsSort', String(r.sortWeight || 0));
        _setVal('contentNewsStatus', r.publishStatus || 'draft');
        // 回填图集（extraJson.gallery）
        var gallery = [];
        try {
          if (r.extraJson) {
            var ej = typeof r.extraJson === 'string' ? JSON.parse(r.extraJson) : r.extraJson;
            if (ej && Array.isArray(ej.gallery)) gallery = ej.gallery.filter(function(x){ return typeof x === 'string' && x; });
          }
        } catch(_) {}
        this.state.gallery = gallery;
        this.renderGallery();
        var titleEl = document.getElementById('contentNewsModalTitle');
        if (titleEl) titleEl.textContent = '✏️ 编辑文章：' + (r.title || id);
        _showModal('contentNewsModal', true);
      } catch(e) {
        _toast('⚠️ 加载文章详情失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    // ===== 图集：渲染缩略图 / 批量上传 / 删除（与 DELETE /v1/upload 联动）=====
    renderGallery: function(){
      var box = document.getElementById('contentGalleryList');
      if (!box) return;
      var list = Array.isArray(this.state.gallery) ? this.state.gallery : [];
      if (!list.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
      box.style.display = 'flex';
      box.innerHTML = list.map(function(u, i){
        return '<div data-gallery-item="' + i + '" style="position:relative;width:110px;height:110px;">' +
          '<img src="' + _escape(u) + '" alt="图集' + (i+1) + '" style="width:110px;height:110px;object-fit:cover;border-radius:10px;border:1px solid #e2e8f0;display:block;" onerror="this.style.opacity=0.3" />' +
          '<button type="button" data-gallery-del="' + i + '" title="删除该图片（同时删除服务器文件）" ' +
            'style="position:absolute;top:-8px;right:-8px;width:24px;height:24px;border-radius:50%;border:none;background:#dc2626;color:#fff;font-size:13px;line-height:1;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.3);padding:0;">✕</button>' +
          '<span style="position:absolute;left:4px;bottom:4px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;border-radius:6px;padding:0 6px;">' + (i+1) + '</span>' +
        '</div>';
      }).join('');
      // 动态 ✕ 按钮打防劫持标记，绕过 DBF / SuperPatch 6/6 全局 capture 拦截
      var delBtns = box.querySelectorAll('button[data-gallery-del]');
      for (var dbi = 0; dbi < delBtns.length; dbi++) {
        delBtns[dbi].__superPatchBound = 1;
        delBtns[dbi].__ts3Done = 1;
        delBtns[dbi].__bindDone = 1;
      }
    },

    addGalleryFiles: async function(fileList){
      var self = this;
      var files = Array.prototype.slice.call(fileList || []);
      if (!files.length) return;
      var allowExts = ['jpg','jpeg','png','gif','webp','svg'];
      var valid = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var ext = (f.name.split('.').pop() || '').toLowerCase();
        if (allowExts.indexOf(ext) < 0) { _toast('⚠️ 已跳过不支持的文件：' + f.name, 'warn'); continue; }
        if (f.size > 50 * 1024 * 1024) { _toast('⚠️ 已跳过超过 50MB 的文件：' + f.name, 'warn'); continue; }
        valid.push(f);
      }
      var cur = Array.isArray(self.state.gallery) ? self.state.gallery.length : 0;
      if (cur + valid.length > 9) {
        _toast('⚠️ 图集最多 9 张，当前已有 ' + cur + ' 张，本次仅取前 ' + (9 - cur) + ' 张', 'warn');
        valid = valid.slice(0, 9 - cur);
      }
      if (!valid.length) return;

      var hint = document.getElementById('contentGalleryHint');
      if (hint) { hint.textContent = '⏳ 正在批量上传 ' + valid.length + ' 张...'; hint.style.color = '#1d4ed8'; }
      try {
        var fd = new FormData();
        valid.forEach(function(f){ fd.append('files', f, f.name); });
        var res = await API.post('/v1/upload/multi', fd, { timeoutMs: 120000 });
        var saved = (res && res.files) || [];
        if (saved.length) {
          self.state.gallery = (Array.isArray(self.state.gallery) ? self.state.gallery : []).concat(saved.map(function(x){ return x.url; }));
          self.renderGallery();
        }
        if (res && res.failed && res.failed.length) {
          _toast('⚠️ ' + res.failed.length + ' 张上传失败：' + res.failed.map(function(x){ return x.reason; }).join('；'), 'warn');
        }
        if (hint) { hint.textContent = saved.length ? ('✅ 已上传 ' + saved.length + ' 张，共 ' + self.state.gallery.length + ' 张') : '❌ 全部上传失败'; hint.style.color = saved.length ? '#15803d' : '#b91c1c'; }
      } catch (e) {
        if (hint) { hint.textContent = '❌ 批量上传失败：' + (e && e.message ? e.message : e); hint.style.color = '#b91c1c'; }
      }
    },

    removeGallery: async function(index){
      var self = this;
      var list = Array.isArray(self.state.gallery) ? self.state.gallery : [];
      var url = list[index];
      if (!url) return;
      if (!window.confirm('确定删除这张图片吗？将同时删除服务器上的文件，且不可恢复。')) return;
      try {
        // DELETE 用 query 传 url，Edge Function/网关对 query 透传最稳
        await API.del('/v1/upload', { query: { url: url }, timeoutMs: 30000 });
        list.splice(index, 1);
        self.state.gallery = list;
        self.renderGallery();
        _toast('🗑️ 图片已删除', 'success');
      } catch (e) {
        // 服务器删除失败则保留缩略图，避免出现“界面没了但文件还在”的孤儿
        _toast('❌ 删除失败：' + (e && e.message ? e.message : e) + '（图片保留）', 'error');
      }
    },

    // 从表单收集文章数据；forceStatus 可强制 draft/published（保存草稿/保存并发布）
    _collect: function(forceStatus){
      var title = _val('contentNewsTitle');
      var category = _val('contentNewsType');
      if (!title) { _toast('⚠️ 标题必填', 'error'); return null; }
      if (!category) { _toast('⚠️ 分类必填', 'error'); return null; }
      return {
        type: 'news',
        title: title,
        subtitle: _val('contentNewsSubtitle'),
        coverImage: _val('contentNewsCover'),
        contentBody: _val('contentNewsBody'),
        summary: _val('contentNewsSummary'),
        authorName: _val('contentNewsAuthor'),
        publishDate: _val('contentNewsPubDate') || undefined,
        sortWeight: Number(_val('contentNewsSort') || 0),
        publishStatus: forceStatus || _val('contentNewsStatus') || 'draft',
        tagsJson: JSON.stringify({ category: category }),
        extraJson: JSON.stringify({ gallery: Array.isArray(this.state.gallery) ? this.state.gallery : [] })
      };
    },

    // 按官网文章样式渲染预览（纯本地渲染，不保存、不请求）
    preview: function(){
      var body = this._collect();
      if (!body) return;
      // 同步状态下拉，方便用户直观看到
      _setVal('contentNewsStatus', body.publishStatus);
      var box = document.getElementById('contentPreviewBody');
      if (!box) return;
      var cat = body.tagsJson ? (function(){ try { return JSON.parse(body.tagsJson).category || ''; } catch(_) { return ''; } })() : '';
      var dateStr = body.publishDate ? String(body.publishDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
      var statusTag = body.publishStatus === 'published'
        ? '<span style="background:#dcfce7;color:#166534;border:1px solid #86efac;">已发布</span>'
        : '<span style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;">草稿（仅预览，前台不可见）</span>';
      // 正文：允许受信任的 HTML（管理员输入），非 HTML 时按段落转换
      var html = body.contentBody
        ? (/^\s*</.test(body.contentBody) ? body.contentBody : body.contentBody.split(/\r?\n+/).filter(Boolean).map(function(p){ return '<p>' + p.replace(/</g,'&lt;') + '</p>'; }).join(''))
        : '<p style="color:#9ca3af;">（暂无正文）</p>';
      box.innerHTML =
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">' +
          '<span style="background:linear-gradient(135deg,#8b0000,#b91c1c);color:#fff;border-radius:999px;padding:3px 12px;font-size:13px;">' + _escape(cat || '剧团动态') + '</span>' +
          statusTag +
        '</div>' +
        '<h1 style="font-size:26px;line-height:1.4;margin:0 0 10px;color:#111827;">' + _escape(body.title) + '</h1>' +
        (body.subtitle ? '<p style="font-size:15px;color:#6b7280;margin:0 0 14px;">' + _escape(body.subtitle) + '</p>' : '') +
        '<div style="display:flex;gap:14px;align-items:center;color:#9ca3af;font-size:13px;border-bottom:1px solid #f0f0f0;padding-bottom:14px;margin-bottom:20px;flex-wrap:wrap;">' +
          '<span>✍️ ' + _escape(body.authorName || '秦安县秦剧团文化演出有限公司') + '</span>' +
          '<span>📅 ' + _escape(dateStr) + '</span>' +
        '</div>' +
        (body.coverImage ? '<img src="' + _escape(body.coverImage) + '" alt="封面" style="width:100%;border-radius:12px;margin-bottom:20px;display:block;" onerror="this.style.display=\'none\'" />' : '') +
        (function(){
          var g = [];
          try { var ej = JSON.parse(body.extraJson || '{}'); if (Array.isArray(ej.gallery)) g = ej.gallery; } catch(_) {}
          if (!g.length) return '';
          return '<div style="margin-bottom:20px;"><div style="font-size:14px;color:#6b7280;margin-bottom:8px;">🖼️ 图集（' + g.length + '）</div><div style="display:flex;gap:10px;flex-wrap:wrap;">' +
            g.map(function(u){ return '<img src="' + _escape(u) + '" alt="图集" style="width:150px;height:100px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb;" onerror="this.style.display=\'none\'" />'; }).join('') +
            '</div></div>';
        })() +
        (body.summary ? '<div style="background:#fef9e7;border-left:4px solid #d4af37;padding:12px 14px;border-radius:6px;color:#5b4a1a;font-size:14px;line-height:1.8;margin-bottom:20px;">' + _escape(body.summary) + '</div>' : '') +
        '<div class="content-preview-html" style="font-size:16px;line-height:1.9;color:#374151;">' + html + '</div>';
      var m = document.getElementById('contentPreviewModal');
      m.style.display = 'block';
      m.scrollTop = 0;
    },

    submit: async function(forceStatus){
      var id = _val('contentNewsId');
      var body = this._collect(forceStatus);
      if (!body) return;
      var isPublish = body.publishStatus === 'published';
      try {
        if (id) {
          await API.patch('/v1/contents/' + id, body);
          _toast(isPublish ? '🚀 文章已更新并发布' : '💾 文章草稿已保存', 'success');
        } else {
          await API.post('/v1/contents', body);
          _toast(isPublish ? '🚀 文章已创建并发布' : '💾 文章草稿已创建', 'success');
        }
        _showModal('contentNewsModal', false);
        await this.load();
      } catch(err) {
        _toast('⚠️ 保存失败：' + (err && err.message ? err.message : err), 'error');
      }
    },

    remove: async function(id){
      if (!id) return;
      if (!confirm('确认删除文章 ' + id + '？此操作不可恢复。')) return;
      try {
        await API.del('/v1/contents/' + id);
        _toast('🗑 已删除', 'success');
        await this.load();
      } catch(e) {
        _toast('⚠️ 删除失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    bind: function(){
      var self = this;
      // 标记所有 content-news 相关按钮，绕过 DeadButtonFallback / SuperPatch 死按钮兜底
      function _markBound(el){ if (el) { el.__superPatchBound = 1; el.__ts3Done = 1; } }
      ['contentNewsAddBtn','contentNewsSearchBtn','contentNewsResetBtn','contentNewsSelectAll',
       'contentNewsDraftBtn','contentNewsPublishBtn','contentNewsPreviewBtn','contentNewsCancelBtn',
       'contentPreviewCloseBtn','contentNewsCoverUploadBtn','contentGalleryAddBtn'].forEach(function(id){
        _markBound(document.getElementById(id));
      });

      // 新增按钮
      var addBtn = document.getElementById('contentNewsAddBtn');
      if (addBtn) addBtn.addEventListener('click', function(ev){ ev.stopPropagation(); self.openAdd(); });
      // 查询/重置按钮
      var searchBtn = document.getElementById('contentNewsSearchBtn');
      if (searchBtn) searchBtn.addEventListener('click', function(ev){
        ev.stopPropagation();
        self.state.filter.type = _val('contentNewsFilterType');
        self.state.filter.publishStatus = _val('contentNewsFilterStatus');
        self.state.filter.keyword = _val('contentNewsFilterKw');
        self.load();
      });
      var resetBtn = document.getElementById('contentNewsResetBtn');
      if (resetBtn) resetBtn.addEventListener('click', function(ev){
        ev.stopPropagation();
        _setVal('contentNewsFilterType', '');
        _setVal('contentNewsFilterStatus', '');
        _setVal('contentNewsFilterKw', '');
        self.state.filter = { type: '', publishStatus: '', keyword: '' };
        self.load();
      });
      // 表格行编辑/删除（事件委托，useCapture + stopPropagation 防止 document 级兜底拦截）
      var tb = document.getElementById('contentNewsTbody');
      if (tb) tb.addEventListener('click', function(ev){
        var btn = ev.target.closest('button[data-act]');
        if (!btn) return;
        ev.stopPropagation();
        ev.preventDefault();
        btn.__superPatchBound = 1;
        var act = btn.getAttribute('data-act');
        var id = btn.getAttribute('data-id');
        if (act === 'edit') self.openEdit(id);
        else if (act === 'del') self.remove(id);
      }, true);
      // 全选
      var selAll = document.getElementById('contentNewsSelectAll');
      if (selAll) selAll.addEventListener('change', function(){
        var cbs = document.querySelectorAll('#contentNewsTbody input[type=checkbox].batch-row-check');
        for (var i = 0; i < cbs.length; i++) cbs[i].checked = selAll.checked;
      });
      // 保存草稿 / 保存并发布 / 预览（capture 阶段绑定，防 SuperPatch 劫持）
      var draftBtn = document.getElementById('contentNewsDraftBtn');
      if (draftBtn) draftBtn.addEventListener('click', function(ev){
        ev.preventDefault(); ev.stopPropagation(); self.submit('draft');
      }, true);
      var publishBtn = document.getElementById('contentNewsPublishBtn');
      if (publishBtn) publishBtn.addEventListener('click', function(ev){
        ev.preventDefault(); ev.stopPropagation(); self.submit('published');
      }, true);
      var previewBtn = document.getElementById('contentNewsPreviewBtn');
      if (previewBtn) previewBtn.addEventListener('click', function(ev){
        ev.preventDefault(); ev.stopPropagation(); self.preview();
      }, true);
      var previewCloseBtn = document.getElementById('contentPreviewCloseBtn');
      if (previewCloseBtn) previewCloseBtn.addEventListener('click', function(ev){
        ev.stopPropagation();
        var m = document.getElementById('contentPreviewModal');
        if (m) m.style.display = 'none';
      }, true);
      var previewModal = document.getElementById('contentPreviewModal');
      if (previewModal) previewModal.addEventListener('click', function(e){
        if (e.target === previewModal) previewModal.style.display = 'none';
      });
      // 取消按钮
      var cancelBtn = document.getElementById('contentNewsCancelBtn');
      if (cancelBtn) cancelBtn.addEventListener('click', function(ev){ ev.stopPropagation(); _showModal('contentNewsModal', false); });
      // 模态框背景点击关闭
      var modal = document.getElementById('contentNewsModal');
      if (modal) modal.addEventListener('click', function(e){ if (e.target === modal) _showModal('contentNewsModal', false); });

      // ===== 封面图上传（v20260927：对接 POST /v1/upload，multipart → 自动回填 URL）=====
      var coverInput = document.getElementById('contentNewsCover');
      var coverHint = document.getElementById('contentNewsCoverHint');
      var coverPreviewWrap = document.getElementById('contentNewsCoverPreviewWrap');
      var coverPreviewImg = document.getElementById('contentNewsCoverPreview');

      function _coverHint(text, color) {
        if (!coverHint) return;
        coverHint.textContent = text;
        coverHint.style.color = color || '#64748b';
        coverHint.style.display = text ? 'block' : 'none';
      }
      function _refreshCoverPreview() {
        var url = (coverInput && coverInput.value || '').trim();
        if (coverPreviewWrap && coverPreviewImg) {
          if (url) {
            coverPreviewImg.src = url;
            coverPreviewWrap.style.display = 'block';
            coverPreviewImg.onerror = function(){ coverPreviewWrap.style.display = 'none'; };
          } else {
            coverPreviewWrap.style.display = 'none';
            coverPreviewImg.src = '';
          }
        }
      }
      if (coverInput) coverInput.addEventListener('change', _refreshCoverPreview);
      if (coverInput) coverInput.addEventListener('input', _refreshCoverPreview);

      var coverUploadBtn = document.getElementById('contentNewsCoverUploadBtn');
      var coverFileInput = document.getElementById('contentNewsCoverFile');
      if (coverUploadBtn && coverFileInput) {
        coverUploadBtn.addEventListener('click', function(ev){
          ev.preventDefault(); ev.stopPropagation();
          coverFileInput.value = '';
          coverFileInput.click();
        }, true);
        coverFileInput.addEventListener('change', async function(){
          var f = coverFileInput.files && coverFileInput.files[0];
          if (!f) return;
          var allowExts = ['jpg','jpeg','png','gif','webp','svg'];
          var ext = (f.name.split('.').pop() || '').toLowerCase();
          if (allowExts.indexOf(ext) < 0) { _coverHint('❌ 不支持的文件类型 .' + ext + '，仅允许 ' + allowExts.join('/'), '#b91c1c'); return; }
          if (f.size > 50 * 1024 * 1024) { _coverHint('❌ 文件超过 50MB 限制', '#b91c1c'); return; }
          _coverHint('⏳ 正在上传 ' + f.name + '（' + Math.round(f.size/1024) + 'KB）...', '#1d4ed8');
          try {
            var fd = new FormData();
            fd.append('file', f, f.name);
            var url = await API.post('/v1/upload', fd, { timeoutMs: 60000 });
            if (url && url.url) {
              coverInput.value = url.url;
              _refreshCoverPreview();
              _coverHint('✅ 上传成功：' + url.originalName + ' → ' + url.url, '#15803d');
            } else {
              _coverHint('❌ 上传返回异常：' + JSON.stringify(url).slice(0, 120), '#b91c1c');
            }
          } catch (e) {
            _coverHint('❌ 上传失败：' + (e && e.message ? e.message : e), '#b91c1c');
          }
        });
      }

      // ===== 图集多图选择器：多选批量上传 + 缩略图 ✕ 删除联动 =====
      var galleryAddBtn = document.getElementById('contentGalleryAddBtn');
      var galleryFile = document.getElementById('contentGalleryFile');
      var galleryList = document.getElementById('contentGalleryList');
      if (galleryAddBtn && galleryFile) {
        galleryAddBtn.addEventListener('click', function(ev){
          ev.preventDefault(); ev.stopPropagation();
          galleryFile.value = '';
          galleryFile.click();
        }, true);
        galleryFile.addEventListener('change', function(){
          var fl = galleryFile.files;
          if (fl && fl.length) self.addGalleryFiles(fl);
          galleryFile.value = '';
        });
      }
      // 缩略图删除按钮：事件委托（按钮随 renderGallery 动态重建）
      if (galleryList) {
        galleryList.addEventListener('click', function(ev){
          var delBtn = ev.target && ev.target.closest ? ev.target.closest('[data-gallery-del]') : null;
          if (!delBtn) return;
          ev.preventDefault(); ev.stopPropagation();
          var idx = parseInt(delBtn.getAttribute('data-gallery-del'), 10);
          if (!isNaN(idx)) self.removeGallery(idx);
        }, true);
      }

      // MutationObserver：动态行按钮自动打标记，防 DBF 兜底
      if (tb && typeof MutationObserver !== 'undefined') {
        var mo = new MutationObserver(function(){
          var btns = tb.querySelectorAll('button[data-act]');
          for (var i = 0; i < btns.length; i++) { btns[i].__superPatchBound = 1; btns[i].__ts3Done = 1; }
        });
        mo.observe(tb, { childList: true, subtree: true });
      }
    }
  };

  // 初始化：当切换到 news tab 时加载数据
  function _initOnTabSwitch(){
    var tabItems = document.querySelectorAll('.tab-item[data-tab]');
    for (var i = 0; i < tabItems.length; i++) {
      tabItems[i].addEventListener('click', function(){
        var tab = this.getAttribute('data-tab');
        if (tab === 'news' && window.__contentApi && !window.__contentApi.state.loaded) {
          setTimeout(function(){ window.__contentApi.load(); }, 100);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      window.__contentApi.bind();
      _initOnTabSwitch();
      // 若页面初始激活 tab 为 news，直接加载
      var activeNews = document.querySelector('.tab-content.active#tab-news');
      if (activeNews) window.__contentApi.load();
    });
  } else {
    window.__contentApi.bind();
    _initOnTabSwitch();
    var activeNews = document.querySelector('.tab-content.active#tab-news');
    if (activeNews) window.__contentApi.load();
  }
})();

/* ========================================================
 * content.html 剧目展示 tab 真实化（接 /v1/plays + /v1/upload API）
 * 命名空间 __contentPlays；行按钮用 data-act 委托 + MutationObserver 打标豁免 DBF
 * 创建：2026-10-14（修复：tbody 无 id 导致 admin-content-real.js 静默 return、
 *       新增/编辑/查看/删除/上传按钮全部被死按钮兜底拦截）
 * ======================================================== */
(function(){
  'use strict';
  if (window.__contentPlays) return;
  var API = window.QAXQJT_API;

  function _toast(msg, type){
    try { if (window.QinApp && QinApp.Utils && QinApp.Utils.toast) return QinApp.Utils.toast(msg, type || 'info', 3200); } catch(_){}
    try { console.log('[contentPlays]', type, msg); } catch(_){}
  }
  function _escape(s){ if (s === null || s === undefined) return ''; return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function _val(id){ var el = document.getElementById(id); return el ? (el.value || '').trim() : ''; }
  function _setVal(id, v){ var el = document.getElementById(id); if (el) el.value = (v === null || v === undefined) ? '' : v; }
  function _showModal(id, show){ var el = document.getElementById(id); if (el) el.style.display = show ? 'flex' : 'none'; }
  function _mark(btn){
    if (!btn) return;
    btn.__superPatchBound = 1; btn.__ts3Done = 1; btn.__bindDone = 1; btn.__deadBtnChecked = 1; btn.__playBound = 1;
  }
  function _byIdPath(id){ return (window.QAXQJT_PATHS && QAXQJT_PATHS.PLAYS_BY_ID) ? QAXQJT_PATHS.PLAYS_BY_ID(encodeURIComponent(id)) : ('/v1/plays/' + encodeURIComponent(id)); }
  function _listPath(){ return (window.QAXQJT_PATHS && QAXQJT_PATHS.PLAYS) || '/v1/plays'; }

  window.__contentPlays = {
    state: { items: [], editingId: null, loaded: false },

    load: async function(){
      var tb = document.getElementById('contentPlayTbody');
      try {
        var resp = await API.get(_listPath(), { query: { page: 1, pageSize: 200 } });
        var rows = Array.isArray(resp) ? resp : (resp && (resp.items || resp.list || resp.rows)) || [];
        this.state.items = rows;
        this._render(rows);
        this.state.loaded = true;
      } catch(e) {
        console.warn('[__contentPlays.load] 失败', e);
        _toast('⚠️ 加载剧目列表失败：' + (e && e.message ? e.message : e), 'error');
        if (tb) tb.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:24px;color:#dc2626;">❌ 加载失败：' + _escape(e && e.message ? e.message : String(e)) + '</td></tr>';
        var badge0 = document.getElementById('playMgmtBadge');
        if (badge0) badge0.textContent = '❌ 剧目加载失败';
      }
    },

    _render: function(rows){
      var tb = document.getElementById('contentPlayTbody');
      if (!tb) return;
      var badge = document.getElementById('playMgmtBadge');
      if (badge) badge.textContent = '✅ 已加载真实剧目 ' + rows.length + ' 部';
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:24px;color:#94a3b8;">📭 暂无剧目，点击「➕ 新增剧目」或用上方海报上传表单创建</td></tr>';
        return;
      }
      tb.innerHTML = rows.map(function(p){
        var id = String(p.id || '');
        var code = _escape(p.playCode || id);
        var title = String(p.title || '');
        var titleShow = _escape(title);
        var firstChar = _escape(title.replace(/[《》\s]/g, '').charAt(0) || '剧');
        var poster = p.posterUrl
          ? '<img src="' + _escape(p.posterUrl) + '" alt="" style="width:52px;height:38px;object-fit:cover;border-radius:6px;" onerror="this.style.display=\'none\'" />'
          : '<div class="poster-preview">' + firstChar + '</div>';
        var genre = _escape(p.genre || '未分类');
        var active = (p.status || 'active') === 'active';
        var showBadge = active ? '<span class="badge badge-success">● 展示</span>' : '<span class="badge badge-secondary">● 隐藏</span>';
        var hot = !!(p.isHot || p.is_hot);
        var hotShow = hot ? '<span class="hot-tag">🔥 热门</span>' : '—';
        var tags = '—';
        if (p.subtitle) {
          tags = '<div class="adapt-tags">' + String(p.subtitle).split(/[\/、,，\s]+/).filter(Boolean).slice(0, 3).map(function(t){ return '<span class="adapt-tag">' + _escape(t) + '</span>'; }).join('') + '</div>';
        }
        var upd = (p.updatedAt || p.createdAt) ? String(p.updatedAt || p.createdAt).slice(0, 10) : '—';
        return '<tr data-row-id="' + _escape(id) + '">' +
          '<td style="text-align:center;vertical-align:middle;"><input type="checkbox" class="batch-row-check" data-id="' + _escape(id) + '" style="width:17px;height:17px;cursor:pointer;accent-color:var(--primary,#0F4C81);" /></td>' +
          '<td style="font-family:monospace;font-weight:600;color:var(--primary-dark);">' + code + '</td>' +
          '<td>' + poster + '</td>' +
          '<td style="font-weight:600;color:var(--primary-dark);font-family:\'KaiTi\',\'STKaiti\',serif;font-size:1rem;">' + titleShow + '</td>' +
          '<td><span class="badge badge-danger">' + genre + '</span></td>' +
          '<td>' + showBadge + '</td>' +
          '<td>—</td>' +
          '<td>' + hotShow + '</td>' +
          '<td>' + tags + '</td>' +
          '<td>' + upd + '</td>' +
          '<td><div class="admin-table-actions">' +
            '<button class="btn btn-secondary btn-sm" data-act="view" data-id="' + _escape(id) + '" title="查看详情">👁</button>' +
            '<button class="btn btn-primary btn-sm" data-act="edit" data-id="' + _escape(id) + '" title="编辑剧目">✏️</button>' +
            '<button class="btn btn-outline-dark btn-sm" data-act="del" data-id="' + _escape(id) + '" title="删除剧目">🗑</button>' +
          '</div></td>' +
        '</tr>';
      }).join('');
    },

    openAdd: function(){
      this.state.editingId = null;
      var t = document.getElementById('contentPlayModalTitle'); if (t) t.textContent = '➕ 新增剧目';
      _setVal('contentPlayTitle', ''); _setVal('contentPlayGenre', '传统本戏');
      _setVal('contentPlayDuration', ''); _setVal('contentPlayAuthor', '');
      _setVal('contentPlayStatus', 'active'); _setVal('contentPlayPosterUrl', '');
      _setVal('contentPlaySynopsis', '');
      var hot = document.getElementById('contentPlayHot'); if (hot) hot.checked = false;
      _showModal('contentPlayModal', true);
    },

    openEdit: function(id){
      var p = null;
      for (var i = 0; i < this.state.items.length; i++) { if (String(this.state.items[i].id) === String(id)) { p = this.state.items[i]; break; } }
      if (!p) { _toast('⚠️ 未找到该剧目，请刷新列表', 'error'); return; }
      this.state.editingId = String(id);
      var t = document.getElementById('contentPlayModalTitle'); if (t) t.textContent = '✏️ 编辑剧目（' + (p.playCode || id) + '）';
      _setVal('contentPlayTitle', p.title || '');
      _setVal('contentPlayGenre', p.genre || '传统本戏');
      _setVal('contentPlayDuration', p.durationMinutes || '');
      _setVal('contentPlayAuthor', p.author || '');
      _setVal('contentPlayStatus', p.status || 'active');
      _setVal('contentPlayPosterUrl', p.posterUrl || '');
      _setVal('contentPlaySynopsis', p.synopsis || '');
      var hot = document.getElementById('contentPlayHot'); if (hot) hot.checked = !!(p.isHot || p.is_hot);
      _showModal('contentPlayModal', true);
    },

    save: async function(){
      var title = _val('contentPlayTitle');
      if (!title) { _toast('⚠️ 剧目名称必填', 'error'); return; }
      var dur = parseInt(_val('contentPlayDuration'), 10);
      // 注意：POST /v1/plays 有 Joi 严格校验（string().allow('') 不接受 null），空值键必须省略
      var body = { title: title, status: _val('contentPlayStatus') || 'active' };
      var genre = _val('contentPlayGenre'); if (genre) body.genre = genre;
      if (!isNaN(dur)) body.durationMinutes = dur;
      var author = _val('contentPlayAuthor'); if (author) body.author = author;
      var poster = _val('contentPlayPosterUrl'); if (poster) body.posterUrl = poster;
      var syn = _val('contentPlaySynopsis'); if (syn) body.synopsis = syn;
      var hot = !!(document.getElementById('contentPlayHot') || {}).checked;
      var editId = this.state.editingId;
      try {
        if (editId) {
          body.is_hot = hot; // update 控制器支持 is_hot
          await API.patch(_byIdPath(editId), body);
          _toast('✅ 剧目《' + title + '》已更新', 'success');
        } else {
          var created = await API.post(_listPath(), body);
          var newId = created && (created.id || created.playCode);
          if (hot && newId) { try { await API.patch(_byIdPath(newId), { is_hot: true }); } catch(_h){} }
          _toast('✅ 剧目《' + title + '》已创建' + (newId ? '（ID: ' + newId + '）' : ''), 'success');
        }
        _showModal('contentPlayModal', false);
        this.state.editingId = null;
        await this.load();
      } catch(e) {
        console.warn('[__contentPlays.save] 失败', e);
        _toast('❌ 保存失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    view: async function(id){
      var body = document.getElementById('contentPlayDetailBody');
      if (!body) return;
      body.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:20px;">⏳ 加载中…</div>';
      _showModal('contentPlayDetailModal', true);
      try {
        var p = await API.get(_byIdPath(id));
        var hot = !!(p.isHot || p.is_hot);
        var active = (p.status || 'active') === 'active';
        var poster = p.posterUrl ? '<div style="text-align:center;margin-bottom:16px;"><img src="' + _escape(p.posterUrl) + '" alt="海报" style="max-width:100%;max-height:220px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.15);" onerror="this.parentElement.style.display=\'none\'" /></div>' : '';
        function row(k, v){ return '<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px dashed #f1f5f9;font-size:0.92rem;"><span style="min-width:84px;color:#64748b;font-weight:600;">' + k + '</span><span style="flex:1;color:#1f2937;">' + v + '</span></div>'; }
        body.innerHTML = poster +
          '<div style="font-size:1.15rem;font-weight:700;color:#8b0000;font-family:\'KaiTi\',\'STKaiti\',serif;margin-bottom:12px;">' + _escape(p.title || '') + (hot ? ' <span class="hot-tag">🔥 热门</span>' : '') + '</div>' +
          row('剧目ID', _escape(p.playCode || p.id || id)) +
          row('分类', _escape(p.genre || '—')) +
          row('时长', (p.durationMinutes ? p.durationMinutes + ' 分钟' : '—')) +
          row('编剧/作者', _escape(p.author || '—')) +
          row('状态', active ? '✅ 上架（官网可见）' : '⏸ 下架（官网隐藏）') +
          row('适配场景', _escape(p.subtitle || '—')) +
          row('主要演员', _escape(p.castSummary || '—')) +
          row('难度等级', _escape(p.difficultyLevel || '—')) +
          row('更新时间', _escape(String(p.updatedAt || p.createdAt || '').slice(0, 19).replace('T', ' ') || '—')) +
          (p.synopsis ? '<div style="margin-top:12px;padding:12px;background:#f8fafc;border-radius:8px;font-size:0.9rem;line-height:1.7;color:#374151;"><strong>剧情简介：</strong>' + _escape(p.synopsis) + '</div>' : '');
      } catch(e) {
        body.innerHTML = '<div style="color:#dc2626;padding:12px;">❌ 加载详情失败：' + _escape(e && e.message ? e.message : String(e)) + '</div>';
      }
    },

    remove: async function(id){
      var p = null;
      for (var i = 0; i < this.state.items.length; i++) { if (String(this.state.items[i].id) === String(id)) { p = this.state.items[i]; break; } }
      var name = p ? (p.title || id) : id;
      if (!confirm('确认删除剧目《' + name + '》？此操作不可恢复。')) return;
      try {
        await API.del(_byIdPath(id));
        _toast('✅ 剧目《' + name + '》已删除', 'success');
        await this.load();
      } catch(e) {
        console.warn('[__contentPlays.remove] 失败', e);
        _toast('❌ 删除失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    // 📤 海报上传表单：校验 → POST /v1/upload → POST /v1/plays（含海报）
    _uploadCreate: async function(){
      var form = document.getElementById('adminOperaUploadForm');
      if (!form) return;
      var name = (form.operaName && form.operaName.value || '').trim();
      var cat = (form.operaCategory && form.operaCategory.value || '').trim();
      var dur = parseInt((form.operaDuration && form.operaDuration.value) || '', 10);
      var file = form.operaImg && form.operaImg.files && form.operaImg.files[0];
      if (!name) { _toast('⚠️ 请填写剧目名称', 'error'); return; }
      if (!cat) { _toast('⚠️ 请选择剧目分类', 'error'); return; }
      if (!file) { _toast('⚠️ 请选择剧目海报图片', 'error'); return; }
      var allowExts = ['jpg','jpeg','png','gif','webp','svg'];
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      if (allowExts.indexOf(ext) < 0) { _toast('❌ 不支持的文件类型 .' + ext, 'error'); return; }
      if (file.size > 10 * 1024 * 1024) { _toast('❌ 海报超过 10MB 限制', 'error'); return; }
      try {
        _toast('⏳ 正在上传海报 ' + file.name + '…', 'info');
        var fd = new FormData();
        fd.append('file', file, file.name);
        var up = await API.post('/v1/upload', fd, { timeoutMs: 60000 });
        var url = up && up.url;
        if (!url) { _toast('❌ 上传返回异常：' + JSON.stringify(up).slice(0, 100), 'error'); return; }
        var body = { title: name, genre: cat, status: 'active', posterUrl: url };
        if (!isNaN(dur)) body.durationMinutes = dur;
        var created = await API.post(_listPath(), body);
        var newId = created && (created.id || created.playCode);
        _toast('✅ 剧目《' + name + '》已随海报创建' + (newId ? '（ID: ' + newId + '）' : ''), 'success');
        try { form.reset(); } catch(_r){} // 触发 app.js reset 监听清除本地预览
        if (this.state.loaded) await this.load();
      } catch(e) {
        console.warn('[__contentPlays._uploadCreate] 失败', e);
        _toast('❌ 提交失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    bind: function(){
      var self = this;
      // 静态按钮：显式打五标记（id 标记器也会补，但双保险）
      ['contentPlayAddBtn','contentPlaySaveBtn','contentPlayCancelBtn','contentPlayModalCloseX',
       'contentPlayDetailCloseBtn','contentPlayDetailCloseX',
       'adminOperaUploadSubmit','adminOperaUploadReset'].forEach(function(id){ _mark(document.getElementById(id)); });

      var addBtn = document.getElementById('contentPlayAddBtn');
      if (addBtn) addBtn.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); self.openAdd(); }, true);

      var saveBtn = document.getElementById('contentPlaySaveBtn');
      if (saveBtn) saveBtn.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); self.save(); }, true);

      var closeFns = ['contentPlayCancelBtn','contentPlayModalCloseX'];
      closeFns.forEach(function(id){
        var b = document.getElementById(id);
        if (b) b.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); _showModal('contentPlayModal', false); }, true);
      });
      ['contentPlayDetailCloseBtn','contentPlayDetailCloseX'].forEach(function(id){
        var b = document.getElementById(id);
        if (b) b.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); _showModal('contentPlayDetailModal', false); }, true);
      });

      // 海报上传提交：按钮点击期 preventDefault → 不触发 form submit（避开 app.js 静态站兜底拦截）
      var upBtn = document.getElementById('adminOperaUploadSubmit');
      if (upBtn) upBtn.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); self._uploadCreate(); }, true);

      // 行按钮：tbody 捕获期委托（与新闻模块同模式）
      var tb = document.getElementById('contentPlayTbody');
      if (tb) {
        tb.addEventListener('click', function(ev){
          var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-act]') : null;
          if (!btn) return;
          ev.preventDefault(); ev.stopPropagation();
          var act = btn.getAttribute('data-act');
          var id = btn.getAttribute('data-id');
          if (act === 'view') self.view(id);
          else if (act === 'edit') self.openEdit(id);
          else if (act === 'del') self.remove(id);
        }, true);
        // 动态行按钮自动打标记，防 DBF 兜底（innerHTML 重建后 __xxx 标记丢失）
        if (typeof MutationObserver !== 'undefined') {
          var mo = new MutationObserver(function(){
            var btns = tb.querySelectorAll('button[data-act]');
            for (var i = 0; i < btns.length; i++) _mark(btns[i]);
          });
          mo.observe(tb, { childList: true, subtree: true });
        }
      }
    }
  };

  function _initPlaysOnTabSwitch(){
    var tabItems = document.querySelectorAll('.tab-item[data-tab]');
    for (var i = 0; i < tabItems.length; i++) {
      tabItems[i].addEventListener('click', function(){
        var tab = this.getAttribute('data-tab');
        if (tab === 'operas' && window.__contentPlays && !window.__contentPlays.state.loaded) {
          setTimeout(function(){ window.__contentPlays.load(); }, 100);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      window.__contentPlays.bind();
      _initPlaysOnTabSwitch();
      var activeOperas = document.querySelector('.tab-content.active#tab-operas');
      if (activeOperas) window.__contentPlays.load();
    });
  } else {
    window.__contentPlays.bind();
    _initPlaysOnTabSwitch();
    var activeOperas = document.querySelector('.tab-content.active#tab-operas');
    if (activeOperas) window.__contentPlays.load();
  }
})();

/* ==========================================================================
 * content.html ✏️ 页面文案可视化区块编辑（__contentTextBlocks）
 * 复用 Setting 表 group=site_assets，key = data-site-text-block 属性值，
 * PUT /v1/site-assets/:key {value} 持久化（value 为空串 = 恢复默认）。
 * 6 个区块全部接线：编辑（textarea 内联）/ 保存 / 还原默认 / 保存全部。
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__contentTextBlocks) return;
  var API = window.QAXQJT_API;
  var Q = window.QinApp && window.QinApp.Utils;
  function _toast(m, t) { try { (Q && Q.toast) ? Q.toast(m, t) : console.log('[toast]', m); } catch (e) { console.log('[toast]', m); } }
  function _listPath() { return (window.QAXQJT_PATHS && window.QAXQJT_PATHS.SITE_ASSETS) || '/v1/site-assets'; }
  function _byKey(key) { return (window.QAXQJT_PATHS && window.QAXQJT_PATHS.SITE_ASSETS_BY_KEY && window.QAXQJT_PATHS.SITE_ASSETS_BY_KEY(encodeURIComponent(key))) || ('/v1/site-assets/' + encodeURIComponent(key)); }
  function _mark(btn) {
    if (!btn) return;
    btn.__superPatchBound = 1; btn.__ts3Done = 1; btn.__bindDone = 1; btn.__deadBtnChecked = 1; btn.__textBlockBound = 1;
  }
  function _sel(section, sel) { return section.querySelector(sel); }

  var state = { loaded: false, blocks: {} }; // key -> {section, preview, defaultHtml, editing, editBtn, saveBtn}

  window.__contentTextBlocks = {
    state: state,
    load: function () {
      var self = this;
      var sections = document.querySelectorAll('#tab-text .content-block-section[data-site-text-block]');
      var map = {};
      sections.forEach(function (sec) {
        var key = sec.getAttribute('data-site-text-block');
        var preview = _sel(sec, '.block-preview');
        if (!state.blocks[key]) {
          var actions = _sel(sec, '.block-actions');
          var btns = actions ? actions.querySelectorAll('button') : [];
          state.blocks[key] = {
            section: sec, preview: preview,
            defaultHtml: preview ? preview.innerHTML : '',
            editing: false,
            editBtn: btns[0], saveBtn: btns[1]
          };
        } else {
          // 已存在则刷新 defaultHtml 取当前显示（可能是上次保存的覆盖值，保留为默认快照不合适；
          // 但 defaultHtml 仅用于「还原默认」，应始终是页面原始静态值——首次绑定已存，这里不动）
        }
      });
      try {
        API.get(_listPath()).then(function (rows) {
          var arr = rows && (rows.data || rows.items || rows.list || rows) || [];
          if (Array.isArray(arr)) {
            arr.forEach(function (r) { if (r && r.key && r.value) map[r.key] = r.value; });
          }
          sections.forEach(function (sec) {
            var key = sec.getAttribute('data-site-text-block');
            var b = state.blocks[key]; if (!b || !b.preview) return;
            var v = map[key];
            if (v) b.preview.innerHTML = v;
          });
          state.loaded = true;
          _toast('✅ 已加载页面文案覆盖值（' + Object.keys(map).length + ' 项）', 'success');
        }).catch(function (e) {
          console.warn('[__contentTextBlocks.load] 失败', e);
          _toast('⚠️ 文案配置加载失败，使用默认文案', 'error');
          state.loaded = true;
        });
      } catch (e) {
        console.warn('[__contentTextBlocks.load] 异常', e);
        state.loaded = true;
      }
    },

    _enterEdit: function (key) {
      var b = state.blocks[key]; if (!b || !b.preview) return;
      var cur = b.preview.innerHTML;
      b._editOrig = cur;
      var ta = document.createElement('textarea');
      ta.value = cur;
      ta.style.cssText = 'width:100%;min-height:120px;padding:10px 12px;border:1.5px solid #d97706;border-radius:8px;font-family:inherit;font-size:0.9rem;line-height:1.6;resize:vertical;';
      b.preview.innerHTML = '';
      b.preview.appendChild(ta);
      b.editing = true;
      if (b.editBtn) b.editBtn.textContent = '↩ 取消';
      setTimeout(function () { ta.focus(); }, 50);
    },

    _exitEdit: function (key, keep) {
      var b = state.blocks[key]; if (!b || !b.preview) return;
      if (keep) {
        var ta = b.preview.querySelector('textarea');
        if (ta) b.preview.innerHTML = ta.value;
      } else {
        b.preview.innerHTML = b._editOrig || b.defaultHtml;
      }
      b.editing = false;
      if (b.editBtn) b.editBtn.textContent = '✏️ 编辑';
    },

    save: function (key) {
      var self = this, b = state.blocks[key];
      if (!b || !b.preview) return;
      if (!b.editing) { _toast('ℹ️ 请先点击「编辑」再保存', 'info'); return; }
      var ta = b.preview.querySelector('textarea');
      if (!ta) return;
      var val = ta.value;
      try {
        API.put(_byKey(key), { value: val }).then(function () {
          b.preview.innerHTML = val;
          b.editing = false;
          if (b.editBtn) b.editBtn.textContent = '✏️ 编辑';
          _toast('✅ 区块已保存', 'success');
        }).catch(function (e) {
          console.warn('[__contentTextBlocks.save] 失败', e);
          _toast('❌ 保存失败：' + (e && e.message ? e.message : e), 'error');
        });
      } catch (e) {
        _toast('❌ 保存失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    saveAll: function () {
      var self = this, keys = Object.keys(state.blocks);
      var dirty = keys.filter(function (k) { return state.blocks[k].editing; });
      if (!dirty.length) { _toast('ℹ️ 没有待保存的修改（请先编辑某个区块）', 'info'); return; }
      var done = 0, fail = 0;
      dirty.forEach(function (k) {
        var b = state.blocks[k];
        var ta = b.preview.querySelector('textarea');
        if (!ta) { done++; return; }
        var val = ta.value;
        API.put(_byKey(k), { value: val }).then(function () {
          b.preview.innerHTML = val; b.editing = false;
          if (b.editBtn) b.editBtn.textContent = '✏️ 编辑';
          done++; if (done + fail === dirty.length) _allDone();
        }).catch(function (e) {
          fail++; console.warn('[saveAll] ' + k, e);
          if (done + fail === dirty.length) _allDone();
        });
      });
      function _allDone() { _toast('✅ 已保存 ' + done + ' 项' + (fail ? '，失败 ' + fail + ' 项' : ''), fail ? 'error' : 'success'); }
    },

    restoreAll: function () {
      var self = this;
      if (!confirm('确认将全部 6 个文案区块恢复为系统默认值？此操作不可撤销。')) return;
      var keys = Object.keys(state.blocks);
      var done = 0, fail = 0;
      keys.forEach(function (k) {
        API.put(_byKey(k), { value: '' }).then(function () { done++; if (done + fail === keys.length) _done(); })
          .catch(function (e) { fail++; console.warn('[restoreAll] ' + k, e); if (done + fail === keys.length) _done(); });
      });
      function _done() {
        keys.forEach(function (k) {
          var b = state.blocks[k];
          if (b && b.preview) { b.preview.innerHTML = b.defaultHtml; b.editing = false; if (b.editBtn) b.editBtn.textContent = '✏️ 编辑'; }
        });
        _toast('✅ 已恢复默认文案（' + done + ' 项）' + (fail ? '，失败 ' + fail + ' 项' : ''), fail ? 'error' : 'success');
      }
    },

    bind: function () {
      var self = this;
      var sections = document.querySelectorAll('#tab-text .content-block-section[data-site-text-block]');
      sections.forEach(function (sec) {
        var key = sec.getAttribute('data-site-text-block');
        var actions = _sel(sec, '.block-actions');
        if (!actions) return;
        var btns = actions.querySelectorAll('button');
        var editBtn = btns[0], saveBtn = btns[1];
        _mark(editBtn); _mark(saveBtn);
        if (!state.blocks[key]) state.blocks[key] = { section: sec, preview: _sel(sec, '.block-preview'), defaultHtml: '', editing: false, editBtn: editBtn, saveBtn: saveBtn };
        else { state.blocks[key].editBtn = editBtn; state.blocks[key].saveBtn = saveBtn; }
        if (editBtn) editBtn.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          if (state.blocks[key].editing) self._exitEdit(key, false); else self._enterEdit(key);
        }, true);
        if (saveBtn) saveBtn.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation(); self.save(key);
        }, true);
      });
      ['contentTextRestoreAll', 'contentTextSaveAll'].forEach(function (id) { _mark(document.getElementById(id)); });
      var restore = document.getElementById('contentTextRestoreAll');
      if (restore) restore.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); self.restoreAll(); }, true);
      var saveAll = document.getElementById('contentTextSaveAll');
      if (saveAll) saveAll.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); self.saveAll(); }, true);
    }
  };

  function _initTextOnTabSwitch() {
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('.tab-item[data-tab="text"]');
      if (t && window.__contentTextBlocks && !window.__contentTextBlocks.state.loaded) {
        setTimeout(function () { window.__contentTextBlocks.load(); }, 100);
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      window.__contentTextBlocks.bind();
      _initTextOnTabSwitch();
      var active = document.querySelector('.tab-content.active#tab-text');
      if (active) window.__contentTextBlocks.load();
    });
  } else {
    window.__contentTextBlocks.bind();
    _initTextOnTabSwitch();
    var active = document.querySelector('.tab-content.active#tab-text');
    if (active) window.__contentTextBlocks.load();
  }
})();

/* ==========================================================================
 * content.html 🖼️ 横幅管理（__contentBanners）
 * 横幅以 content 表 type='banner' 存储，复用 /v1/contents CRUD。
 * 上传走 /v1/upload（FormData file），返回 url 写入 coverImage，
 * position/link 存 extraJson。列表 GET /v1/contents?type=banner。
 * 3 个死按钮全部接线：提交横幅 / 清空重选 / ➕ 新增横幅。
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__contentBanners) return;
  var API = window.QAXQJT_API;
  var Q = window.QinApp && window.QinApp.Utils;
  function _toast(m, t) { try { (Q && Q.toast) ? Q.toast(m, t) : console.log('[toast]', m); } catch (e) { console.log('[toast]', m); } }
  function _mark(btn) { if (!btn) return; btn.__superPatchBound = 1; btn.__ts3Done = 1; btn.__bindDone = 1; btn.__deadBtnChecked = 1; btn.__bannerBound = 1; }
  function _escape(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function _posLabel(v) {
    var m = { 'home-1': '🏠 首页 #1 主视觉', 'home-2': '🏠 首页 #2 惠民下乡', 'home-3': '🏠 首页 #3 活动专场', 'home-4': '🏠 首页 #4 剧目推荐', 'inner-news': '📰 内页·新闻', 'inner-operas': '🎭 内页·剧目', 'inner-booking': '🎫 内页·预约' };
    return m[v] || v || '—';
  }
  function _parseExtra(r) {
    if (!r) return {};
    var s = r.extraJson || r.extra_json;
    if (!s) return {};
    try { return JSON.parse(s); } catch (e) { return {}; }
  }

  var state = { loaded: false, items: [] };
  window.__contentBanners = {
    state: state,

    load: function () {
      var self = this;
      try {
        API.get('/v1/contents', { query: { type: 'banner', page: 1, pageSize: 200 } }).then(function (resp) {
          var rows = Array.isArray(resp) ? resp : (resp && (resp.items || resp.list || resp.rows)) || [];
          state.items = rows;
          self._render(rows);
          var badge = document.getElementById('bannerCountBadge');
          if (badge) badge.textContent = '✅ 已加载横幅 ' + rows.length + ' 条';
          state.loaded = true;
        }).catch(function (e) {
          console.warn('[__contentBanners.load] 失败', e);
          _toast('⚠️ 加载横幅列表失败：' + (e && e.message ? e.message : e), 'error');
          var list = document.querySelector('.banner-list');
          if (list) list.innerHTML = '<div style="grid-column:1/-1;padding:40px 16px;text-align:center;color:#dc2626;">❌ 加载失败：' + _escape(e && e.message ? e.message : String(e)) + '</div>';
          state.loaded = true;
        });
      } catch (e) {
        console.warn('[__contentBanners.load] 异常', e);
        state.loaded = true;
      }
    },

    _render: function (rows) {
      var list = document.querySelector('.banner-list');
      if (!list) return;
      if (!rows.length) {
        list.innerHTML = '<div style="grid-column:1/-1;padding:40px 16px;text-align:center;color:var(--text-light,#888);">📭 暂无横幅配置，点击右上角「➕ 新增横幅」创建</div>';
        return;
      }
      var self = this;
      list.innerHTML = rows.map(function (r) {
        var id = String(r.id || '');
        var cover = r.coverImage || '';
        var extra = _parseExtra(r);
        var pos = extra.position || '';
        var link = extra.link || '';
        var statusBadge = r.publishStatus === 'published'
          ? '<span style="display:inline-block;padding:2px 10px;border-radius:12px;background:#dcfce7;color:#166534;font-size:0.78rem;">● 已发布</span>'
          : '<span style="display:inline-block;padding:2px 10px;border-radius:12px;background:#fef3c7;color:#92400e;font-size:0.78rem;">○ 草稿</span>';
        var img = cover ? '<img src="' + _escape(cover) + '" alt="banner" style="width:100%;height:140px;object-fit:cover;border-radius:8px;display:block;" onerror="this.style.display=\'none\';this.parentNode.querySelector(\'.no-img\').style.display=\'flex\'" />' : '';
        return '<div style="border:1.5px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff;display:flex;flex-direction:column;">' +
          '<div style="position:relative;background:#f3f4f6;">' +
          img +
          '<div class="no-img" style="display:' + (cover ? 'none' : 'flex') + ';align-items:center;justify-content:center;height:140px;color:#9ca3af;font-size:1.2rem;">🖼️ 无图</div>' +
          '<div style="position:absolute;top:8px;left:8px;">' + statusBadge + '</div>' +
          '</div>' +
          '<div style="padding:12px 14px;flex:1;display:flex;flex-direction:column;gap:6px;">' +
          '<div style="font-weight:700;color:#1f2937;font-size:0.95rem;line-height:1.4;">' + _escape(r.title) + '</div>' +
          '<div style="font-size:0.82rem;color:#6b7280;">📍 ' + _posLabel(pos) + '</div>' +
          (link ? '<div style="font-size:0.78rem;color:#2563eb;word-break:break-all;">🔗 ' + _escape(link) + '</div>' : '') +
          '<div style="margin-top:auto;display:flex;gap:6px;padding-top:8px;">' +
          '<button data-act="up" data-id="' + id + '" class="btn btn-secondary btn-sm" style="flex:1;padding:5px;">↑</button>' +
          '<button data-act="down" data-id="' + id + '" class="btn btn-secondary btn-sm" style="flex:1;padding:5px;">↓</button>' +
          '<button data-act="del" data-id="' + id + '" class="btn btn-outline btn-sm" style="flex:1;padding:5px;color:#dc2626;">🗑</button>' +
          '</div>' +
          '</div>' +
          '</div>';
      }).join('');
    },

    uploadCreate: function () {
      var self = this;
      var form = document.getElementById('adminBannerUploadForm');
      if (!form) return;
      var name = form.bannerName.value.trim();
      var pos = form.bannerPosition.value;
      var link = form.bannerLink.value.trim();
      var file = form.bannerImg.files && form.bannerImg.files[0];
      if (!name) { _toast('⚠️ 请填写横幅名称', 'error'); return; }
      if (!pos) { _toast('⚠️ 请选择投放位置', 'error'); return; }
      if (!file) { _toast('⚠️ 请选择横幅图片', 'error'); return; }
      var extOk = /\.(jpe?g|png|webp)$/i.test(file.name);
      if (!extOk) { _toast('⚠️ 仅支持 JPG/PNG/WebP 格式', 'error'); return; }
      if (file.size > 10 * 1024 * 1024) { _toast('⚠️ 图片大小不能超过 10MB', 'error'); return; }
      try {
        var fd = new FormData();
        fd.append('file', file);
        API.post('/v1/upload', fd, { timeoutMs: 60000 }).then(function (up) {
          var url = (up && (up.url || up.data && up.data.url)) || '';
          if (!url) throw new Error('上传响应缺少 url');
          var extra = JSON.stringify({ position: pos, link: link });
          return API.post('/v1/contents', {
            type: 'banner', title: name, coverImage: url, publishStatus: 'published', extraJson: extra
          });
        }).then(function () {
          _toast('✅ 横幅已创建并发布', 'success');
          form.reset();
          if (state.loaded) self.load();
        }).catch(function (e) {
          console.warn('[__contentBanners.uploadCreate] 失败', e);
          _toast('❌ 创建失败：' + (e && e.message ? e.message : e), 'error');
        });
      } catch (e) {
        _toast('❌ 创建失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    remove: function (id) {
      var self = this;
      var r = state.items.find(function (x) { return String(x.id) === String(id); });
      if (!confirm('确认删除横幅「' + (r ? r.title : id) + '」？此操作不可恢复。')) return;
      API.del('/v1/contents/' + encodeURIComponent(id)).then(function () {
        _toast('🗑 已删除', 'success');
        self.load();
      }).catch(function (e) {
        _toast('❌ 删除失败：' + (e && e.message ? e.message : e), 'error');
      });
    },

    move: function (id, dir) {
      var self = this;
      var idx = state.items.findIndex(function (x) { return String(x.id) === String(id); });
      if (idx < 0) return;
      var cur = state.items[idx];
      var target = dir > 0 ? state.items[idx + 1] : state.items[idx - 1];
      if (!target) return;
      var curW = cur.sortWeight != null ? cur.sortWeight : idx;
      var tgtW = target.sortWeight != null ? target.sortWeight : (idx + (dir > 0 ? 1 : -1));
      API.patch('/v1/contents/' + encodeURIComponent(id), { sortWeight: tgtW }).then(function () {
        return API.patch('/v1/contents/' + encodeURIComponent(target.id), { sortWeight: curW });
      }).then(function () {
        self.load();
      }).catch(function (e) {
        _toast('❌ 排序失败：' + (e && e.message ? e.message : e), 'error');
      });
    },

    bind: function () {
      var self = this;
      var submitBtn = document.getElementById('adminBannerUploadSubmit');
      var resetBtn = document.getElementById('adminBannerUploadReset');
      var addBtn = document.getElementById('contentBannerAddBtn');
      var form = document.getElementById('adminBannerUploadForm');
      _mark(submitBtn); _mark(resetBtn); _mark(addBtn);
      if (submitBtn) submitBtn.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation(); self.uploadCreate();
      }, true);
      if (form) form.addEventListener('submit', function (ev) { ev.preventDefault(); }, true);
      if (addBtn) addBtn.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        if (form) { form.scrollIntoView({ behavior: 'smooth', block: 'start' }); form.bannerName && form.bannerName.focus(); }
      }, true);
      // 行按钮委托
      var list = document.querySelector('.banner-list');
      if (list) {
        list.addEventListener('click', function (ev) {
          var btn = ev.target.closest('button[data-act]');
          if (!btn) return;
          ev.preventDefault(); ev.stopPropagation();
          var act = btn.getAttribute('data-act'), id = btn.getAttribute('data-id');
          if (act === 'del') self.remove(id);
          else if (act === 'up') self.move(id, -1);
          else if (act === 'down') self.move(id, 1);
        }, true);
        // tbody 重建后给行按钮打标（横幅用 .banner-list，不是 tbody）
        var mo = new MutationObserver(function () {
          list.querySelectorAll('button[data-act]').forEach(function (b) { _mark(b); });
        });
        mo.observe(list, { childList: true, subtree: true });
      }
    }
  };

  function _initBannerOnTabSwitch() {
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('.tab-item[data-tab="banner"]');
      if (t && window.__contentBanners && !window.__contentBanners.state.loaded) {
        setTimeout(function () { window.__contentBanners.load(); }, 100);
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      window.__contentBanners.bind();
      _initBannerOnTabSwitch();
      var active = document.querySelector('.tab-content.active#tab-banner');
      if (active) window.__contentBanners.load();
    });
  } else {
    window.__contentBanners.bind();
    _initBannerOnTabSwitch();
    var active = document.querySelector('.tab-content.active#tab-banner');
    if (active) window.__contentBanners.load();
  }
})();

/* ==========================================================================
 * content.html 📞 联系信息全局配置（__contentContact）
 * 12 个字段存 Setting 表 group=site_assets，key = data-contact-key 属性值。
 * PUT /v1/site-assets/:key {value} 持久化（value 为空串 = 恢复默认）。
 * 3 个死按钮全部接线：取消修改 / 测试配置预览 / 保存配置并更新。
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__contentContact) return;
  var API = window.QAXQJT_API;
  var Q = window.QinApp && window.QinApp.Utils;
  function _toast(m, t) { try { (Q && Q.toast) ? Q.toast(m, t) : console.log('[toast]', m); } catch (e) { console.log('[toast]', m); } }
  function _mark(btn) { if (!btn) return; btn.__superPatchBound = 1; btn.__ts3Done = 1; btn.__bindDone = 1; btn.__deadBtnChecked = 1; btn.__contactBound = 1; if (!btn.getAttribute('onclick')) btn.setAttribute('onclick', 'return false'); }
  function _byKey(key) { return (window.QAXQJT_PATHS && window.QAXQJT_PATHS.SITE_ASSETS_BY_KEY && window.QAXQJT_PATHS.SITE_ASSETS_BY_KEY(encodeURIComponent(key))) || ('/v1/site-assets/' + encodeURIComponent(key)); }
  function _listPath() { return (window.QAXQJT_PATHS && window.QAXQJT_PATHS.SITE_ASSETS) || '/v1/site-assets'; }

  var KEYS = ['site.contact.phone', 'site.contact.wechat', 'site.contact.address', 'site.contact.service_area',
    'site.contact.work_hours', 'site.contact.booking_hours', 'site.contact.map_embed',
    'site.contact.icp', 'site.contact.police_record', 'site.contact.copyright_owner', 'site.contact.email', 'site.contact.social'];
  var LABELS = {
    'site.contact.phone': '剧团联系电话', 'site.contact.wechat': '官方微信号', 'site.contact.address': '办公地址',
    'site.contact.service_area': '演出服务范围', 'site.contact.work_hours': '日常工作时间', 'site.contact.booking_hours': '演出预约服务时间',
    'site.contact.map_embed': '地图嵌入代码', 'site.contact.icp': 'ICP备案号', 'site.contact.police_record': '公安备案号',
    'site.contact.copyright_owner': '版权/运营主体', 'site.contact.email': '电子邮箱', 'site.contact.social': '官方抖音/快手号'
  };

  var state = { loaded: false, snapshot: {} };
  window.__contentContact = {
    state: state,

    load: function () {
      var self = this;
      try {
        API.get(_listPath()).then(function (rows) {
          var arr = rows && (rows.data || rows.items || rows.list || rows) || [];
          var map = {};
          if (Array.isArray(arr)) arr.forEach(function (r) { if (r && r.key) map[r.key] = r.value; });
          KEYS.forEach(function (k) {
            var el = document.querySelector('[data-contact-key="' + k + '"]');
            if (!el) return;
            if (map[k] != null && map[k] !== '') el.value = map[k];
            state.snapshot[k] = el.value;
          });
          state.loaded = true;
          _toast('✅ 已加载联系信息配置', 'success');
        }).catch(function (e) {
          console.warn('[__contentContact.load] 失败', e);
          _toast('⚠️ 联系信息加载失败，使用默认值', 'error');
          KEYS.forEach(function (k) { var el = document.querySelector('[data-contact-key="' + k + '"]'); if (el) state.snapshot[k] = el.value; });
          state.loaded = true;
        });
      } catch (e) {
        console.warn('[__contentContact.load] 异常', e);
        state.loaded = true;
      }
    },

    _collect: function () {
      var data = {};
      KEYS.forEach(function (k) { var el = document.querySelector('[data-contact-key="' + k + '"]'); if (el) data[k] = el.value; });
      return data;
    },

    save: function () {
      var self = this;
      var data = self._collect();
      // 必填校验
      if (!data['site.contact.phone'] || !data['site.contact.phone'].trim()) { _toast('⚠️ 请填写剧团联系电话', 'error'); return; }
      if (!data['site.contact.address'] || !data['site.contact.address'].trim()) { _toast('⚠️ 请填写剧团办公地址', 'error'); return; }
      var done = 0, fail = 0;
      KEYS.forEach(function (k) {
        var val = data[k] == null ? '' : data[k];
        API.put(_byKey(k), { value: val }).then(function () {
          state.snapshot[k] = val;
          done++;
          if (done + fail === KEYS.length) _finish();
        }).catch(function (e) {
          fail++; console.warn('[__contentContact.save] ' + k, e);
          if (done + fail === KEYS.length) _finish();
        });
      });
      function _finish() {
        _toast('✅ 已保存 ' + done + ' 项' + (fail ? '，失败 ' + fail + ' 项' : '') + '，全站同步生效', fail ? 'error' : 'success');
      }
    },

    cancel: function () {
      KEYS.forEach(function (k) {
        var el = document.querySelector('[data-contact-key="' + k + '"]');
        if (el && state.snapshot[k] != null) el.value = state.snapshot[k];
      });
      _toast('↺ 已还原为上次保存的配置', 'info');
    },

    preview: function () {
      var data = this._collect();
      var year = String(new Date().getFullYear());
      var sub = function (s) { return String(s == null ? '' : s).replace(/\{year\}/g, year); };
      var html = '<div style="max-width:560px;margin:0 auto;font-family:inherit;line-height:1.9;color:#374151;">' +
        '<h3 style="text-align:center;color:#7c2d12;margin-bottom:18px;">📞 联系信息预览</h3>' +
        '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:18px 20px;">' +
        '<p><strong>联系电话：</strong>' + sub(data['site.contact.phone']) + '</p>' +
        '<p><strong>官方微信：</strong>' + sub(data['site.contact.wechat']) + '</p>' +
        '<p><strong>办公地址：</strong>' + sub(data['site.contact.address']) + '</p>' +
        '<p><strong>服务范围：</strong></p><pre style="white-space:pre-wrap;margin:4px 0 12px;">' + sub(data['site.contact.service_area']) + '</pre>' +
        '<p><strong>日常工作时间：</strong>' + sub(data['site.contact.work_hours']) + '</p>' +
        '<p><strong>预约服务时间：</strong>' + sub(data['site.contact.booking_hours']) + '</p>' +
        '<p><strong>ICP备案号：</strong>' + sub(data['site.contact.icp']) + '</p>' +
        '<p><strong>公安备案号：</strong>' + sub(data['site.contact.police_record']) + '</p>' +
        '<p><strong>版权主体：</strong>' + sub(data['site.contact.copyright_owner']) + '</p>' +
        '<p><strong>电子邮箱：</strong>' + sub(data['site.contact.email']) + '</p>' +
        '<p><strong>抖音/快手：</strong>' + sub(data['site.contact.social']) + '</p>' +
        '</div>' +
        '<p style="margin-top:14px;font-size:0.82rem;color:#6b7280;">💡 此为当前表单输入的即时预览，点击「保存配置并更新」后全站生效。</p>' +
        '</div>';
      var m = document.getElementById('contentContactPreviewModal');
      if (!m) {
        m = document.createElement('div');
        m.id = 'contentContactPreviewModal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
        m.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:640px;width:100%;max-height:90vh;overflow:auto;padding:24px 26px;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
          '<button id="contentContactPreviewClose" style="position:absolute;top:12px;right:14px;background:none;border:none;font-size:1.4rem;cursor:pointer;color:#6b7280;">✕</button>' +
          '<div id="contentContactPreviewBody"></div></div>';
        document.body.appendChild(m);
        m.addEventListener('click', function (e) { if (e.target === m) m.style.display = 'none'; });
      }
      document.getElementById('contentContactPreviewBody').innerHTML = html;
      m.style.display = 'flex';
      var closeBtn = document.getElementById('contentContactPreviewClose');
      if (closeBtn) closeBtn.onclick = function () { m.style.display = 'none'; };
    },

    bind: function () {
      var self = this;
      var saveBtn = document.getElementById('contentContactSave');
      var cancelBtn = document.getElementById('contentContactCancel');
      var previewBtn = document.getElementById('contentContactPreview');
      _mark(saveBtn); _mark(cancelBtn); _mark(previewBtn);
      if (saveBtn) saveBtn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); self.save(); }, true);
      if (cancelBtn) cancelBtn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); self.cancel(); }, true);
      if (previewBtn) previewBtn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); self.preview(); }, true);
    }
  };

  function _initContactOnTabSwitch() {
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('.tab-item[data-tab="contact"]');
      if (t && window.__contentContact && !window.__contentContact.state.loaded) {
        setTimeout(function () { window.__contentContact.load(); }, 100);
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      window.__contentContact.bind();
      _initContactOnTabSwitch();
      var active = document.querySelector('.tab-content.active#tab-contact');
      if (active) window.__contentContact.load();
    });
  } else {
    window.__contentContact.bind();
    _initContactOnTabSwitch();
    var active = document.querySelector('.tab-content.active#tab-contact');
    if (active) window.__contentContact.load();
  }
})();
