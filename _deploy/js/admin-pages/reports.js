/* reports.js — 从 admin/reports.html 抽取的内联脚本（第 3/3 段，保持原执行位置） */

/* ===== reports.html inline block (run 3, #1/8) ===== */
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
        if (userLvl < 700) {
          location.replace('index.html');
        }
      })();

      function initUserInfo() {
        if (!currentSession) return;
        var name = currentSession.name || '管理员';
        var role = currentSession.roleName || '管理员';
        var username = currentSession.username || 'a';
        var initial = name.charAt(0) || username.charAt(0).toUpperCase();
        var avatar = document.getElementById('userAvatar');
        if (avatar) avatar.textContent = initial;
        var nameEl = document.getElementById('userName');
        if (nameEl) nameEl.textContent = name;
        var roleEl = document.getElementById('userRole');
        if (roleEl) roleEl.textContent = role;
        var dhName = document.getElementById('dhName');
        if (dhName) dhName.textContent = name;
      }
      initUserInfo();

      var userDropdown = document.getElementById('userDropdown');
      var userToggle = document.getElementById('userToggle');
      function closeUserDropdown() {
        if (userDropdown) userDropdown.classList.remove('open');
      }
      if (userToggle) {
        userToggle.addEventListener('click', function(e) {
          e.stopPropagation();
          userDropdown.classList.toggle('open');
        });
      }
      document.addEventListener('click', function(e) {
        if (userDropdown && !userDropdown.contains(e.target)) closeUserDropdown();
      });

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
      var logoutBtn1 = document.getElementById('logoutBtnSidebar');
      var logoutBtn2 = document.getElementById('logoutBtnDropdown');
      if (logoutBtn1) logoutBtn1.addEventListener('click', logout);
      if (logoutBtn2) logoutBtn2.addEventListener('click', logout);

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
          sidebar.classList.contains('mobile-open') ? closeMobileSidebar() : openMobileSidebar();
        });
      }
      if (overlay) overlay.addEventListener('click', closeMobileSidebar);

      window.toggleFullscreen = function() {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen && document.exitFullscreen();
        }
      };

      var genTime = document.getElementById('reportGenTime');
      if (genTime) {
        var now = new Date();
        var pad = function(n) { return n < 10 ? '0' + n : n; };
        var yearMatch = document.title.match(/(\d{4})/) || [];
        var displayYear = yearMatch[1] || now.getFullYear();
        var t = displayYear + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) + ' ' +
                pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
        genTime.textContent = t;
      }

      function animateBars() {
        var bars = document.querySelectorAll('.district-bar-fill, .opera-rank-fill, .monthly-bar');
        bars.forEach(function(bar, index) {
          var finalW = bar.style.width;
          var finalH = bar.style.height;
          if (finalW) { bar.style.width = '0%'; }
          if (finalH) { bar.style.height = '0%'; }
          setTimeout(function() {
            if (finalW) bar.style.width = finalW;
            if (finalH) bar.style.height = finalH;
          }, 60 + index * 50);
        });
      }
      if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function(entries) {
          entries.forEach(function(entry) {
            if (entry.isIntersecting) { animateBars(); observer.disconnect(); }
          });
        }, { threshold: 0.1 });
        var firstCard = document.querySelector('.kpi-grid');
        if (firstCard) observer.observe(firstCard);
      } else {
        setTimeout(animateBars, 500);
      }

      // =============================================================================
      // 🔧 D3 FIX：报表分析 全按钮自动化事件绑定 + 去抖（刷新/导出/打印）
      // =============================================================================

    })();

  // =============================================================================
  // 🔧 E3 FIX：数据报表 全按钮自动化事件绑定 + 去抖锁
  // =============================================================================

/* ===== reports.html inline block (run 3, #2/8) ===== */
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
    /* P1修复:假成功已移除 — 死按钮保存未接入后端，仅提示不再伪装成功 */
    if(!__pLk) { __T('该功能暂未接入后端','warning'); try { e.stopPropagation(); } catch(_a){} return; }
    __pLog('DBF','save_submit', Object.assign({},__pEvt,{row:trKey, lock:__pLk, toast:'warning'}));
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; try { e.stopPropagation(); } catch(_b){} return;
      }
      if(isEdit){
        if(!__L(doneKey,700)) return;
        __pLog('DBF','edit_open', Object.assign({},__pEvt,{row:trKey, branch:'edit'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      if(isDel){
        if(!__L(doneKey,850)) { __T('该功能暂未接入后端','warning'); try { e.stopPropagation(); } catch(_a){} return; }
        /* P1修复:假成功已移除（不再伪造确认框与表格行删除） */
        __pLog('DBF','delete_confirm', Object.assign({},__pEvt,{row:trKey, branch:'delete'}));
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; try { e.stopPropagation(); } catch(_b){} return;
      }
      if(isView){
        if(!__L(doneKey,500)) return;
        __pLog('DBF','view_detail', Object.assign({},__pEvt,{row:trKey, branch:'view'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      if(isVerify){
        if(!__L(doneKey,900)) { __T('该功能暂未接入后端','warning'); return; }
        __pLog('DBF','verify_confirm', Object.assign({},__pEvt,{row:trKey, branch:'verify'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      if(isExport){
        if(!__L(doneKey,1200)) { __T('该功能暂未接入后端','warning'); return; }
        __pLog('DBF','export_start', Object.assign({},__pEvt,{row:trKey, branch:'export'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      if(isAdd){
        if(!__L(doneKey,900)) return;
        __pLog('DBF','add_new', Object.assign({},__pEvt,{branch:'add'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      // ---- 新增：审核/审批/驳回/通过 ----
      var isAudit = txt.indexOf('审核')>=0 || txt.indexOf('审批')>=0 || txt.indexOf('驳回')>=0 || txt.indexOf('通过')>=0;
      if(isAudit){
        if(!__L(doneKey,850)){ __T('该功能暂未接入后端','warning'); try{e.stopPropagation();}catch(_a){} return; }
        var act = (txt.indexOf('驳回')>=0)?'驳回':(txt.indexOf('通过')>=0?'通过':'审核');
        /* P1修复:假成功已移除（不再伪造审核确认与结果） */
        __pLog('DBF','audit_result', Object.assign({},__pEvt,{row:trKey, branch:'audit', action:act}));
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done=1; try{e.stopPropagation();}catch(_b){} return;
      }
      // ---- 新增：签约/签订 ----
      var isSign = txt.indexOf('签约')>=0 || txt.indexOf('签订')>=0 || (txt.indexOf('签')>=0 && txt.indexOf('约')>=0);
      if(isSign){
        if(!__L(doneKey,900)){ __T('该功能暂未接入后端','warning'); try{e.stopPropagation();}catch(_a){} return; }
        /* P1修复:假成功已移除（不再伪造签约确认） */
        __pLog('DBF','sign_confirm', Object.assign({},__pEvt,{row:trKey, branch:'sign'}));
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done=1; try{e.stopPropagation();}catch(_b){} return;
      }
      // ---- 新增：合同/生成合同 ----
      var isContract = txt.indexOf('合同')>=0 && !isSign;
      if(isContract){
        if(!__L(doneKey,1000)){ __T('该功能暂未接入后端','warning'); return; }
        __pLog('DBF','contract_ready', Object.assign({},__pEvt,{row:trKey, branch:'contract'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done=1; return;
      }
      // ---- 新增：排期/排班/安排档期 ----
      var isScheduleBtn = txt.indexOf('排期')>=0 || txt.indexOf('排班')>=0 || (txt.indexOf('安排')>=0 && (txt.length<=8 || txt.indexOf('档期')>=0));
      if(isScheduleBtn){
        if(!__L(doneKey,800)){ __T('该功能暂未接入后端','warning'); return; }
        __pLog('DBF','schedule_open', Object.assign({},__pEvt,{row:trKey, branch:'schedule'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done=1; return;
      }
      // ---- 新增：取消/处理/确认接单 ----
      var isCancelOrHandle = txt.indexOf('取消')>=0 || txt.indexOf('处理')>=0 || txt.indexOf('确认接单')>=0 || txt.indexOf('派工')>=0;
      if(isCancelOrHandle && !isDel && !isSave){
        if(!__L(doneKey,800)){ __T('该功能暂未接入后端','warning'); try{e.stopPropagation();}catch(_a){} return; }
        var chBranch = txt.indexOf('取消')>=0?'cancel':(txt.indexOf('确认接单')>=0?'accept':(txt.indexOf('派工')>=0?'dispatch':'handle'));
        /* P1修复:假成功已移除（不再伪造取消/接单/派工结果） */
        __pLog('DBF','status_change', Object.assign({},__pEvt,{row:trKey, branch:chBranch}));
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done=1; try{e.stopPropagation();}catch(_b){} return;
      }

    }, true);
    console.info('[DeadButtonFallback 已加载：×兜底 + 保存/编辑/删除/查看/核销/导出/新增 死按钮兜底委托]');
    try{ window.__T = __T; window.__L = __L; }catch(_){}
  })();
  
} /* end of 防重复注入保护 if */

/* ===== reports.html inline block (run 3, #3/8) ===== */
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
        /* P1修复:假成功已移除 — 已绑定真实提交处理的表单（__realSubmit）直接放行 */
        if(form.__realSubmit) return;
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
        /* P1修复:假成功已移除 — 校验通过但表单未接线后端，不再伪装提交成功、不再自动关弹窗 */
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

  
  // 功能按钮绑定（上传/新建/导出）
  try{
    function __bindBtn(id, fn){ var el=document.getElementById(id); if(el&&!el.__ub){ el.__ub=1; el.addEventListener("click", fn, true); } }
    /* P1修复:假成功已移除 — "选择报表"改为打开下方真实上传表单的文件选择器，不再假提示已选择 */
    __bindBtn('openReportsUploadBtn', function(){ var real=document.getElementById('reportsAttachFiles'); if(real){ real.click(); return; } var inp=document.createElement("input"); inp.type="file"; inp.accept=".pdf,.xls,.xlsx,.jpg,.png"; inp.onchange=function(){ console.warn('[P1] 未接线按钮: 动态报表文件选择（真实上传表单缺失）'); }; inp.click(); });
  }catch(_e){ console.warn("[upload-bind err]",_e); }

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
        if(btn.closest && btn.closest('.generic-modal-root, .modal-overlay-root, [role="dialog"]')) return;
        if(btn.hasAttribute && (btn.hasAttribute('data-modal-act') || btn.hasAttribute('data-modal-close'))) return;
        if(_hasAction(btn)) return;
        if(btn.__superPatchBound) return;
        btn.__superPatchBound = 1;
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
        /* P1修复:假成功已移除 — 死按钮兜底不再伪装操作成功，统一提示未接入后端 */
        if(tt==='save'){
          __pLog('SP','fallback_save', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='delete'){
          __pLog('SP','fallback_delete', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='view'){
          __pLog('SP','fallback_view', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='export'){
          __pLog('SP','fallback_export', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='schedule'){
          __pLog('SP','fallback_schedule', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='audit'){
          __pLog('SP','fallback_audit', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='contract'){
          __pLog('SP','fallback_contract', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
        }else if(tt==='add'){
          __pLog('SP','fallback_add', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
        }else{
          __pLog('SP','fallback_other', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
        }
        return false;
      }catch(e6){ console.warn('[SuperPatch 6/6 click err]',e6); }
    }, true);
    console.info('[SuperPatch 6/6] 已激活 ✓');
  }catch(e){ console.warn('[SuperPatch 6/6 init err]',e); }

  console.info('['+PATCH_ID+'] 6合1超级补丁全部加载完毕 ✓');
})();

} /* end of 防重复注入保护 if */

/* ===== reports.html inline block (run 3, #4/8) ===== */
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

/* ===== reports.html inline block (run 3, #5/8) ===== */
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

/* ===== reports.html inline block (run 3, #6/8) ===== */
/* 按钮防拦截：为有id的可点击元素预设 __superPatchBound，避免 SuperPatch 首次点击拦截 */
(function(){
  function __markBound(){
    var els=document.querySelectorAll('button[id], a[id], [data-action][id], .btn[id], .btn-action[id]');
    for(var i=0;i<els.length;i++){ var el=els[i]; if(!el.__superPatchBound){ el.__superPatchBound=1; } }
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',__markBound); }
  else { __markBound(); setTimeout(__markBound,500); }
})();

/* ===== reports.html inline block (run 3, #7/8) ===== */
/* ===== __reportsApi: 报表数据从后端加载并刷新 KPI ===== */
window.__reportsApi = (function(){
  var API = window.QAXQJT_API;
  var T = function(m,t){ try{ window.QinApp&&QinApp.Utils&&QinApp.Utils.toast(m,t||'info',3000); }catch(_){} };

  function _setKpi(idx, value, unit){
    var cards = document.querySelectorAll('.kpi-card');
    if(!cards[idx]) return;
    var v = cards[idx].querySelector('.kpi-value');
    if(v){ v.innerHTML = value + '<span class="unit">'+(unit||'')+'</span>'; }
  }

  async function load(){
    try{
      var yearSel = document.getElementById('yearSelect');
      var year = (yearSel && yearSel.value) ? yearSel.value : new Date().getFullYear();
      // 修复 P0：区县分布/月度场次/剧目排行渲染函数定义后从未被调用，三大图区永久“正在加载”
      // renderScheduleStats 内部自带空态与 catch，独立并行刷新，不阻塞 KPI 卡片
      renderScheduleStats(year).catch(function(e){ console.warn('[__reportsApi.renderScheduleStats]',e); });
      var s = await API.get((QAXQJT_PATHS.ORDERS_STATS || '/v1/orders/stats'), { query:{ year:year } }).catch(function(){ return null; });
      var f = await API.get((QAXQJT_PATHS.FIN_SUMMARY || '/v1/fin/summary'), { query:{ year:year } }).catch(function(){ return null; });
      // 本月排期概览：/v1/schedules/stats（year + month）
      var now = new Date();
      var sch = await API.get((QAXQJT_PATHS.SCHEDULES_STATS || '/v1/schedules/stats'), { query:{ year:now.getFullYear(), month:now.getMonth()+1 } }).catch(function(){ return null; });
      var schedBox = document.getElementById('schedStatsBox');
      var schedMonth = document.getElementById('schedStatsMonth');
      if(schedMonth) schedMonth.textContent = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
      if(sch && schedBox){
        var rows = [
          {k:'总排期',v:sch.total||0,c:'#333'},
          {k:'已定稿',v:sch.confirmed||0,c:'#27ae60'},
          {k:'待排',v:sch.scheduled||0,c:'#f39c12'},
          {k:'草稿',v:sch.draft||0,c:'#95a5a6'},
          {k:'已完成',v:sch.completed||0,c:'#2980b9'},
          {k:'已取消',v:sch.cancelled||0,c:'#e74c3c'},
          {k:'冲突',v:sch.conflict||0,c:'#8e44ad'}
        ];
        schedBox.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:12px;">'+
          rows.map(function(r){
            return '<div style="flex:1;min-width:110px;background:#fafafa;border:1px solid var(--border-light);border-radius:10px;padding:12px 14px;text-align:center;">'+
              '<div style="font-size:.78rem;color:var(--text-light);">'+r.k+'</div>'+
              '<div style="font-size:1.5rem;font-weight:700;color:'+r.c+';margin-top:4px;">'+r.v+'</div></div>';
          }).join('')+
          '</div>'+
          '<div style="margin-top:12px;display:flex;gap:24px;flex-wrap:wrap;font-size:.85rem;color:#555;">'+
            '<span>💴 演出费合计：<strong style="color:#8b0000;">¥'+(sch.totalFee||0).toLocaleString()+'</strong></span>'+
            '<span>👥 预计观众：<strong>'+(sch.totalAudience||0)+'</strong> 人次</span>'+
            '<span>✅ 实际到场：<strong>'+(sch.totalAttendance||0)+'</strong> 人次</span>'+
          '</div>';
      } else if(schedBox){ schedBox.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">本月暂无排期统计</div>'; }

      if(s){
        _setKpi(0, s.totalShows||s.total||0, '场');
        _setKpi(1, s.totalAudience? (s.totalAudience/10000).toFixed(1):'0', '万人次');
        _setKpi(2, s.totalVillages||s.villages||0, '个');
        _setKpi(3, s.culturalCoop||0, '场');
        _setKpi(4, s.campusShows||0, '场');
        _setKpi(5, s.liveShows||0, '场');
      }
      if(f){
        _setKpi(6, f.totalIncome? (f.totalIncome/10000).toFixed(1):'0', '万');
      }
      T('📊 报表数据已刷新','success');
    }catch(e){ console.warn('[__reportsApi.load]',e); }
  }

  /* ===== 20260922 真实化：区县分布/月度场次由 /v1/schedules 真实排期生成 ===== */
  function _rows(d){ return Array.isArray(d)?d:((d&&d.items)||[]); }
  async function renderScheduleStats(year){
    var all=_rows(await API.get((QAXQJT_PATHS.SCHEDULES || '/v1/schedules'),{query:{page:1,pageSize:500}}).catch(function(){return [];}));
    var rows=all.filter(function(s){ return String(s.date||"").indexOf(year+"-")===0 && ["scheduled","confirmed","performance","completed"].indexOf(s.status)>=0; });
    // KPI0：年度演出总场次（真实排期计数）
    _setKpi(0, rows.length, "场");
    // 区县分布
    var box=document.getElementById("repDistrictBars");
    if(box){
      var dist={}; rows.forEach(function(s){ var d=s.venueDistrict||s.venueCity||"未填写区县"; dist[d]=(dist[d]||0)+1; });
      var arr=Object.keys(dist).map(function(k){return {name:k,n:dist[k]};}).sort(function(a,b){return b.n-a.n;});
      if(!arr.length){ box.innerHTML='<div style="padding:30px 10px;text-align:center;color:var(--text-light);">'+year+'年暂无真实排期</div>'; }
      else {
        var max=arr[0].n, total=rows.length, colors=["#8B0000","#A52A2A","#B22222","#C0392B","#CD5C5C","#E07070","#E88888"];
        box.innerHTML=arr.map(function(x,i){
          var pct=Math.max(4,Math.round(x.n/max*100)), share=(Math.round(x.n/total*1000)/10).toFixed(1);
          var c=colors[Math.min(i,colors.length-1)];
          return '<div class="district-bar-item"><div class="district-bar-label"><span class="district-name">'+x.name+'</span><span class="district-stats"><strong>'+x.n+' 场</strong>占 '+share+'%</span></div><div class="district-bar-track"><div class="district-bar-fill" style="width:'+pct+'%;background:'+c+';"><span>'+x.n+'场</span></div></div></div>';
        }).join("");
      }
    }
    // 月度场次柱
    var cols=document.getElementById("repMonthlyCols");
    if(cols){
      var m=new Array(12).fill(0); rows.forEach(function(s){ var mm=Number(String(s.date).slice(5,7)); if(mm>=1&&mm<=12) m[mm-1]++; });
      var mx=Math.max.apply(null,m.concat([1]));
      cols.innerHTML=m.map(function(n,i){
        var pct=n?Math.max(6,Math.round(n/mx*100)):2;
        return '<div class="monthly-col"><div class="monthly-bar" style="height:'+pct+'%;" title="'+(i+1)+'月：'+n+'场（真实排期）"></div><div class="monthly-label">'+(i+1)+'月</div></div>';
      }).join("");
    }
    var line=document.getElementById("repAudienceLine"); if(line) line.setAttribute("points","");
    _renderDonutAndRank(rows, year);
  }
  function _renderDonutAndRank(rows, year){
    var num=document.getElementById("repDonutNum"); if(num) num.textContent=rows.length;
    var box=document.getElementById("repRankList"); if(!box) return;
    var cnt={}; rows.forEach(function(s){ var n=(s.playTitle||"").trim(); if(n) cnt[n]=(cnt[n]||0)+1; });
    var arr=Object.keys(cnt).map(function(k){return {name:k,n:cnt[k]};}).sort(function(a,b){return b.n-a.n;}).slice(0,10);
    if(!arr.length){ box.innerHTML='<div style="grid-column:1/-1;padding:30px 10px;text-align:center;color:var(--text-light);">'+year+'年暂无真实排期，无法生成剧目排行</div>'; return; }
    var mx=arr[0].n;
    var cls=["top1","top2","top3"];
    box.innerHTML=arr.map(function(x,i){
      var pct=Math.max(6,Math.round(x.n/mx*100));
      return '<div class="opera-rank-item"><div class="opera-rank-no '+(cls[i]||"")+'">'+(i+1)+'</div><div class="opera-rank-name">《'+x.name+'》</div><div class="opera-rank-track"><div class="opera-rank-fill" style="width:'+pct+'%;"><span>'+x.n+'场</span></div></div><div class="opera-rank-count">'+x.n+' 场</div></div>';
    }).join("");
  }
  function bind(){
    var yearSel = document.getElementById('yearSelect');
    if(yearSel){ yearSel.__superPatchBound=1; yearSel.addEventListener('change', function(){ load(); }); }
    var btns = document.querySelectorAll('.admin-page-actions .btn, .btn-outline-dark, .btn-secondary');
    btns.forEach(function(b){
      if(!b) return;
      var txt = (b.textContent||'').trim();
      if(txt.indexOf('刷新')>=0 || txt.indexOf('查询')>=0){ b.__superPatchBound=1; b.onclick=function(){ load(); }; }
    });
  }

  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',function(){ bind(); load(); }); }
  else { bind(); load(); }

  return { load:load, renderScheduleStats:renderScheduleStats };
})();

/* ===== P1修复:统计报表附件上传接通真实后端 POST /v1/upload（multipart 字段 file，返回 data:{url,filename,originalName,...}） ===== */
(function(){
  var form = document.getElementById('reportsAttachForm');
  if(!form || form.__realUploadWired) return;
  form.__realUploadWired = 1;
  form.__realSubmit = 1; /* 告知 SuperPatch 1/6 放行真实提交 */
  var API = window.QAXQJT_API;
  var T = function(m,t){ try{ window.QinApp&&QinApp.Utils&&QinApp.Utils.toast(m,t||'info',3000); }catch(_){} };
  var box = document.createElement('div');
  box.id = 'reportsUploadResult';
  box.style.cssText = 'margin-top:10px;font-size:.85rem;color:#374151;word-break:break-all;';
  form.appendChild(box);

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    var fileInput = document.getElementById('reportsAttachFiles');
    var files = (fileInput && fileInput.files) ? Array.prototype.slice.call(fileInput.files) : [];
    if(!files.length){ T('请先选择要上传的报表文件','warning'); return; }
    var period = (form.querySelector('[name="reportPeriod"]')||{}).value || '';
    var month = (form.querySelector('[name="reportMonth"]')||{}).value || '';
    var okList = [], failList = [];
    for(var i=0;i<files.length;i++){
      var f = files[i];
      if(f.size > 10*1024*1024){ failList.push({name:f.name, reason:'超过10MB'}); continue; }
      try{
        var fd = new FormData();
        fd.append('file', f);
        var d = await API.post((QAXQJT_PATHS.UPLOAD || '/v1/upload'), fd);
        okList.push(d || {});
      }catch(err){
        failList.push({ name:f.name, reason:(err&&err.message)||('HTTP错误') });
      }
    }
    var html = '';
    if(okList.length){
      html += '<div style="color:#15803d;font-weight:700;">✅ 已上传 '+okList.length+'/'+files.length+' 个文件（周期：'+period+' '+month+'）</div>'+
        okList.map(function(u){ return '<div style="margin-top:4px;">📎 <a href="'+u.url+'" target="_blank" rel="noopener">'+(u.originalName||u.filename||u.url)+'</a></div>'; }).join('');
    }
    if(failList.length){
      html += '<div style="color:#b91c1c;margin-top:'+(okList.length?'6px':'0')+';">⚠️ 失败 '+failList.length+' 个：'+failList.map(function(x){ return x.name+'（'+x.reason+'）'; }).join('、')+'</div>';
    }
    box.innerHTML = html;
    if(okList.length && !failList.length){
      T('✅ 报表附件已上传 '+okList.length+' 个','success');
      try{ fileInput.value=''; }catch(_e2){}
    }else if(okList.length){
      T('部分文件上传成功，详见下方链接列表','warning');
    }else{
      T('上传失败：'+((failList[0]&&failList[0].reason)||'请检查登录与网络'),'error');
    }
  });
})();

/* ===== reports.html inline block (run 3, #8/8) ===== */
/* ===== v20261002c 真实统计与报表：员工日薪实时统计 + 人员安全删除（权限+二次确认+审计追溯） ===== */
window.__dailyWageReport = (function(){
  var API = window.QAXQJT_API;
  var T = function(m,t){ try{ window.QinApp&&QinApp.Utils&&QinApp.Utils.toast(m,t||'info',3000); }catch(_){} };
  var $ = function(id){ return document.getElementById(id); };
  var _state = { rows: [], groupBy: 'date', month: '', meta: null };
  var ADMIN_KEY = 'qaxqjt_admin_session';

  function _sess(){ try{ return JSON.parse(localStorage.getItem(ADMIN_KEY)||'null'); }catch(_){ return null; } }
  function _rows(d){ return Array.isArray(d)?d:((d&&d.items)||[]); }

  var COLS = {
    date:      [ {k:'date',t:'日期'},{k:'headcount',t:'出勤人数'},{k:'workDays',t:'出勤天'},{k:'gross',t:'日薪合计(元)'} ],
    performer: [ {k:'name',t:'姓名'},{k:'staffNo',t:'工号'},{k:'primaryRole',t:'行当'},{k:'employmentType',t:'用工'},{k:'rankGrade',t:'职级'},{k:'dailyRate',t:'日薪(元/天)'},{k:'workDays',t:'出勤天'},{k:'gross',t:'应发'},{k:'deduction',t:'扣罚'},{k:'net',t:'实发'} ],
    empType:   [ {k:'key',t:'用工类型'},{k:'headcount',t:'人数'},{k:'workDays',t:'出勤天'},{k:'gross',t:'应发'},{k:'deduction',t:'扣罚'},{k:'net',t:'实发'} ],
    rank:      [ {k:'key',t:'职级'},{k:'headcount',t:'人数'},{k:'workDays',t:'出勤天'},{k:'gross',t:'应发'},{k:'deduction',t:'扣罚'},{k:'net',t:'实发'} ]
  };
  var TITLES = { date:'按日期', performer:'按人员', empType:'按用工类型', rank:'按职级' };
  var MONEY = { gross:1, deduction:1, net:1, dailyRate:1 };

  function _bind(id, fn){
    var b = $(id); if(!b) return;
    b.__superPatchBound=1; b.__deadBtnChecked=1; b.__ts3Done=1; b.__bindDone=1;
    b.addEventListener('click', function(e){ e.preventDefault(); fn(); });
  }
  function _fmt(v){ return (v===0?'0':((v===''||v===null||v===undefined)?'—':v)); }

  function render(){
    var box = $('dwTableBox'); if(!box) return;
    var rows = _state.rows||[];
    if(!rows.length){
      box.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">该条件下暂无日薪统计（当月无考勤记录或无匹配人员）</div>';
      return;
    }
    var cols = COLS[_state.groupBy]||COLS.date;
    var th = cols.map(function(c){ return '<th style="padding:10px 12px;white-space:nowrap;text-align:left;">'+c.t+'</th>'; }).join('');
    var trs = rows.map(function(r,i){
      var tds = cols.map(function(c){
        var v = r[c.k];
        if(MONEY[c.k]) v = (Number(v)||0).toFixed(2);
        var bold = (c.k==='date'||c.k==='name'||c.k==='key')?'font-weight:600;':'';
        return '<td style="padding:10px 12px;white-space:nowrap;'+bold+'">'+_fmt(v)+'</td>';
      }).join('');
      return '<tr style="background:'+(i%2?'#fafaf9':'#fff')+';">'+tds+'</tr>';
    }).join('');
    box.innerHTML = '<div style="overflow:auto;max-height:480px;border:1px solid var(--border-light);border-radius:12px;">'+
      '<table style="width:100%;border-collapse:collapse;font-size:.88rem;min-width:640px;">'+
      '<thead><tr style="background:linear-gradient(135deg,#78350f,#b45309);color:#fff;position:sticky;top:0;">'+th+'</tr></thead>'+
      '<tbody>'+trs+'</tbody></table></div>'+
      '<div style="margin-top:6px;font-size:.78rem;color:#999;">共 '+rows.length+' 行 · '+TITLES[_state.groupBy]+'维度</div>';
  }

  function renderKpi(t){
    t = t||{};
    var set = function(id,v){ var el=$(id); if(el) el.textContent=v; };
    set('dwKpiHead', (t.headcount||0)+' 人');
    set('dwKpiDays', (t.workDays||0)+' 天');
    set('dwKpiGross', '¥'+(Number(t.gross)||0).toFixed(2));
    set('dwKpiDeduct', '-¥'+(Number(t.deduction)||0).toFixed(2));
    set('dwKpiNet', '¥'+(Number(t.net)||0).toFixed(2));
  }

  async function load(){
    var m = $('dwMonth'); var month = m?m.value:'';
    if(!/^\d{4}-\d{2}$/.test(month)){ T('请先选择统计月份','warn'); return; }
    var q = { month: month, groupBy: ($('dwGroup')||{}).value||'date' };
    if(($('dwEmpType')||{}).value) q.empType = $('dwEmpType').value;
    if(($('dwRank')||{}).value) q.rank = $('dwRank').value;
    if(($('dwKeyword')||{}).value.trim()) q.keyword = $('dwKeyword').value.trim();
    if(/^(0[1-9]|[12]\d|3[01])$/.test(($('dwDay')||{}).value.trim())) q.day = $('dwDay').value.trim();
    var box = $('dwTableBox');
    if(box) box.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">正在实时统计…</div>';
    try{
      var d = await API.get('/v1/reports/daily-wage', { query: q });
      _state.rows = d.rows||[]; _state.groupBy = d.groupBy||q.groupBy; _state.month = month; _state.meta = d;
      render(); renderKpi(d.totals);
      var gen = $('dwGenAt');
      if(gen) gen.textContent = '生成时间：'+new Date(d.generatedAt).toLocaleString('zh-CN')+'（实时现算）';
      var note = $('dwNote');
      if(note&&d.note) note.textContent = '口径说明：'+d.note;
      T('📊 日薪统计已刷新','success');
    }catch(e){
      if(box) box.innerHTML = '<div style="padding:24px;text-align:center;color:#c00;">统计加载失败：'+((e&&e.message)||e)+'</div>';
    }
  }

  function exportCsv(){
    var rows = _state.rows||[];
    if(!rows.length){ T('暂无可导出的统计数据','warn'); return; }
    var cols = COLS[_state.groupBy]||COLS.date;
    var esc = function(v){ v=(v===null||v===undefined)?'':String(v); return '"'+v.replace(/"/g,'""')+'"'; };
    var lines = [cols.map(function(c){ return esc(c.t); }).join(',')];
    rows.forEach(function(r){
      lines.push(cols.map(function(c){
        return esc(MONEY[c.k]?(Number(r[c.k])||0).toFixed(2):r[c.k]);
      }).join(','));
    });
    var t = (_state.meta&&_state.meta.totals)||{};
    var tot = _state.groupBy==='date'
      ? ['合计', t.headcount||0, t.workDays||0, (Number(t.gross)||0).toFixed(2)]
      : ['合计', t.headcount||0, t.workDays||0, (Number(t.gross)||0).toFixed(2), (Number(t.deduction)||0).toFixed(2), (Number(t.net)||0).toFixed(2)];
    lines.push(tot.map(esc).join(','));
    var blob = new Blob(['\ufeff'+lines.join('\r\n')], { type:'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '日薪统计_'+_state.month+'_'+TITLES[_state.groupBy]+'.csv';
    document.body.appendChild(a); a.click();
    try{ document.body.removeChild(a); URL.revokeObjectURL(a.href); }catch(_e){}
    T('📤 CSV 已导出','success');
  }

  /* ---- 人员删除（仅 super_admin/admin 可见，后端再次鉴权 super_admin） ---- */
  var _pdTarget = { id:'', name:'' };
  function openConfirm(id, name){
    _pdTarget = { id:id, name:name };
    var info = $('pdConfirmInfo'); if(info) info.innerHTML = '<b>'+name+'</b>（ID: '+id+'）';
    var nm = $('pdConfirmName'); if(nm) nm.textContent = name;
    var ip = $('pdConfirmInput'); if(ip) ip.value = '';
    var btn = $('pdConfirmBtn'); if(btn) btn.disabled = true;
    var mask = $('pdConfirmMask'); if(mask) mask.style.display = 'flex';
  }
  function closeConfirm(){
    var mask = $('pdConfirmMask'); if(mask) mask.style.display = 'none';
    _pdTarget = { id:'', name:'' };
  }
  async function doDelete(){
    if(!_pdTarget.id) return;
    try{
      await API.del((QAXQJT_PATHS.PERFORMERS_BY_ID || function (i) { return '/v1/performers/' + i; })(_pdTarget.id));
      T('🗑️ 已删除并记录审计：'+_pdTarget.name,'success');
      closeConfirm(); pdSearch(); loadDelAudit(); load();
    }catch(e){ /* 错误 toast 由 api-request 统一弹出 */ }
  }
  async function pdSearch(){
    var box = $('pdListBox'); if(!box) return;
    var kw = ($('pdKeyword')||{}).value.trim();
    if(!kw){ box.innerHTML = '<span style="color:#999;">请输入姓名/工号等关键字</span>'; return; }
    box.innerHTML = '<span style="color:#999;">搜索中…</span>';
    try{
      var d = await API.get((QAXQJT_PATHS.PERFORMERS || '/v1/performers'), { query:{ keyword:kw, page:1, pageSize:20 } });
      var rows = _rows(d);
      if(!rows.length){ box.innerHTML = '<span style="color:#999;">未找到匹配的在册人员</span>'; return; }
      box.innerHTML = rows.map(function(p){
        var rate = (p.dailyRate!=null && Number(p.dailyRate)>0) ? ('¥'+Number(p.dailyRate)+'/天') : '按职级标准';
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--border-light);border-radius:10px;padding:10px 12px;">'+
          '<div style="font-size:.88rem;min-width:0;"><b>'+p.name+'</b> <span style="color:#888;">'+(p.staffNo||'')+'</span>'+
          ' <span style="color:#666;">'+(p.primaryRole||'')+'</span> <span style="color:#b45309;font-weight:600;">'+rate+'</span></div>'+
          '<button type="button" class="btn btn-sm" data-pddel="'+p.id+'" data-pdname="'+p.name+'" style="background:#8b0000;color:#fff;border:none;flex-shrink:0;">删除</button></div>';
      }).join('');
      box.querySelectorAll('[data-pddel]').forEach(function(b){
        b.__superPatchBound=1; b.__deadBtnChecked=1; b.__ts3Done=1; b.__bindDone=1;
        b.addEventListener('click', function(){ openConfirm(b.getAttribute('data-pddel'), b.getAttribute('data-pdname')); });
      });
    }catch(e){ box.innerHTML = '<span style="color:#c00;">搜索失败：'+((e&&e.message)||e)+'</span>'; }
  }
  async function loadDelAudit(){
    var box = $('delAuditBox'); if(!box) return;
    box.innerHTML = '<span style="color:#999;">正在加载删除记录…</span>';
    try{
      var d = await API.get((QAXQJT_PATHS.AUDIT_LOGS || '/v1/audit-logs'), { query:{ module:'performers', action:'PERFORMER_SOFT_DELETE', page:1, pageSize:20 } });
      var rows = _rows(d);
      if(!rows.length){ box.innerHTML = '<span style="color:#999;">暂无删除记录</span>'; return; }
      box.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow:auto;">'+rows.map(function(a){
        var det = {}; try{ det = a.detailJson?JSON.parse(a.detailJson):{}; }catch(_e){}
        return '<div style="border:1px solid var(--border-light);border-radius:10px;padding:10px 12px;font-size:.85rem;">'+
          '<div><b>'+(det.name||a.targetId||'—')+'</b>'+(det.staffNo?('（'+det.staffNo+'）'):'')+
          ' 被 <b style="color:#8b0000;">'+(a.username||'—')+'</b> 删除</div>'+
          '<div style="color:#888;margin-top:3px;">'+new Date(a.actionTs).toLocaleString('zh-CN')+
          (det.primaryRole?(' · 行当：'+det.primaryRole):'')+
          (det.employmentType?(' · 用工：'+det.employmentType):'')+
          (det.dailyRate!=null?(' · 日薪 ¥'+det.dailyRate):'')+'</div></div>';
      }).join('')+'</div>';
    }catch(e){ box.innerHTML = '<span style="color:#c00;">删除记录加载失败：'+((e&&e.message)||e)+'</span>'; }
  }

  function _initRole(){
    var s = _sess(); var role = s&&s.role;
    // v20261003 P3-7：人员删除卡收窄为仅 super_admin 可见（admin 角色此前有入口但后端 GET /performers 403、DELETE 仅 super_admin）
    var canDelete = (role==='super_admin');
    var canAudit = canDelete || role==='admin' || role==='director';
    var row = $('personMgmtRow');
    if(row && (canDelete||canAudit)) row.style.display = '';
    if(!canDelete){ var c=$('personDeleteCard'); if(c) c.style.display='none'; }
    if(!canAudit){ var a=$('delAuditCard'); if(a) a.style.display='none'; }
  }

  function init(){
    _initRole();
    var m = $('dwMonth');
    if(m && !m.value){ var n=new Date(); m.value = n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0'); }
    _bind('dwQueryBtn', load);
    _bind('dwExportBtn', exportCsv);
    _bind('dwPrintBtn', function(){ try{ window.print(); }catch(_e){} });
    _bind('pdSearchBtn', pdSearch);
    _bind('pdCancelBtn', closeConfirm);
    _bind('pdConfirmBtn', doDelete);
    // 兼容 SuperPatch 3/6：它在 capture 阶段拦截含「取消」的点击并调用 __closeAnyModal；
    // 注册本钩子确保删除确认弹窗能被正确关闭（否则取消按钮/遮罩点击都无法关闭）
    try { window.__closeAnyModal = function(){ try { closeConfirm(); } catch (_e) {} }; } catch (_e) {}
    var g = $('dwGroup'); if(g) g.addEventListener('change', load);
    var ci = $('pdConfirmInput');
    if(ci) ci.addEventListener('input', function(){
      var btn = $('pdConfirmBtn'); var nm = $('pdConfirmName');
      if(btn&&nm) btn.disabled = (ci.value !== nm.textContent);
    });
    var mask = $('pdConfirmMask');
    if(mask) mask.addEventListener('click', function(e){ if(e.target===mask) closeConfirm(); });
    if($('delAuditCard') && $('delAuditCard').style.display!=='none') loadDelAudit();
    load();
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', init); }
  else { init(); }

  return { load: load, reload: load, exportCsv: exportCsv };
})();
