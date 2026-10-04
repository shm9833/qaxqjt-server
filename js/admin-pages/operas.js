/* operas.js — 从 admin/operas.html 抽取的内联脚本（第 3/3 段，保持原执行位置） */

/* ===== operas.html inline block (run 3, #1/9) ===== */
(function() {
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
    })();
    document.querySelectorAll('.category-tab').forEach(function(tab) {
      if (!tab.classList.contains('opera-cat-manage')) {
        tab.addEventListener('click', function() {
          document.querySelectorAll('.category-tab').forEach(function(t) { t.classList.remove('active'); });
          tab.classList.add('active');
        });
      }
    });

    var viewGridBtn = document.getElementById('viewGridBtn');
    var viewListBtn = document.getElementById('viewListBtn');
    var gridView = document.getElementById('operaGridView');
    var listView = document.getElementById('operaListView');
    if (viewGridBtn) {
      viewGridBtn.addEventListener('click', function() {
        viewGridBtn.classList.add('active');
        viewListBtn.classList.remove('active');
        try { if (gridView) gridView.classList.remove('csp-hide'); } catch(_){}
        try { if (listView) listView.classList.add('csp-hide'); } catch(_){}
      });
    }
    if (viewListBtn) {
      viewListBtn.addEventListener('click', function() {
        viewListBtn.classList.add('active');
        viewGridBtn.classList.remove('active');
        try { if (gridView) gridView.classList.add('csp-hide'); } catch(_){}
        try { if (listView) listView.classList.remove('csp-hide'); } catch(_){}
      });
    }

    var modal = document.getElementById('operaDetailModal');
    var modalClose = document.getElementById('modalCloseBtn');
    document.querySelectorAll('.view-detail').forEach(function(btn) {
      btn.addEventListener('click', function() {
        modal.classList.add('active');
        try { document.body.classList.add('body-modal-locked'); } catch(_e1){}
      });
    });
    if (modalClose) {
      modalClose.__ub = 1; /* v20260929fix：标记 __ub，跳过 SuperPatch 3/6 对关闭按钮的拦截 */
      modalClose.addEventListener('click', function() {
        modal.classList.remove('active');
        try { modal.style.setProperty('display','none','important'); } catch(_e1x){} /* v20260929fix：清除 viewDetail 设置的 inline flex!important */
        try { document.body.classList.remove('body-modal-locked'); } catch(_e2){}
      }, true); /* v20260929fix：capture 阶段执行，抢在 fixRefreshBug 的 stopPropagation 之前（现代 Chrome 中 target 捕获监听器 stopProp 会跳过同按钮全部冒泡监听） */
    }
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) {
          modal.classList.remove('active');
          try { modal.style.setProperty('display','none','important'); } catch(_e3x){} /* v20260929fix */
          try { document.body.classList.remove('body-modal-locked'); } catch(_e3){}
        }
      });
    }
    /* ---------- CRITICAL 修复：退出登录按钮（侧边栏） + 7 类 legacy key 彻底清理 ---------- */
    function __doOperasLogout() {
      if (!window.confirm('确定要退出登录吗？')) return;
      var LK = 'qaxqjt_admin_session';
      var BLK = 'qaxqjt_logout_blacklist';
      var LS_KEYS = ['qaxqjt_admin_session','admin_session','qaxqjt_admin_sess_v2','admin_sess_v2','qaxqjt_admin_remember','qaxqjt_admin_token','qaxqjt_admin_info','qaxqjt_admin_permissions','qaxqjt_auth_permissions_v1'];
      try {
        var curSessId = null;
        try {
          var curRaw = localStorage.getItem(LK);
          if (curRaw) { var curSess = JSON.parse(curRaw); if (curSess && curSess.id) curSessId = curSess.id; }
        } catch (_eSess) {}
        if (curSessId) {
          var blackList = [];
          try {
            var rawBlk = localStorage.getItem(BLK);
            if (rawBlk) blackList = JSON.parse(rawBlk) || [];
          } catch (_eBlk) {}
          blackList.push({ id: curSessId, ts: Date.now() });
          if (blackList.length > 100) blackList = blackList.slice(-100);
          try { localStorage.setItem(BLK, JSON.stringify(blackList)); } catch (_eWrite) {}
        }
      } catch (_blkOuter) {}
      try { localStorage.removeItem(LK); } catch(_e1){}
      for (var _ii = 0; _ii < LS_KEYS.length; _ii++) {
        try { if (LS_KEYS[_ii] !== LK) localStorage.removeItem(LS_KEYS[_ii]); } catch(_e2){}
      }
      if (window.QinApp && window.QinApp.Admin && typeof window.QinApp.Admin.logout === 'function') {
        try { window.QinApp.Admin.logout(); } catch(_e3){}
      }
      try { window.location.replace('login.html'); } catch(_eLoc) { window.location.href = 'login.html'; }
    }
    function __bindOperasLogoutBtn() {
      var sb = document.getElementById('logoutBtnSidebar');
      if (sb) sb.addEventListener('click', function(e){ e.preventDefault && e.preventDefault(); __doOperasLogout(); }, true);
    }
    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', __bindOperasLogoutBtn);
      } else {
        __bindOperasLogoutBtn();
      }
    } catch(_bindErr){}

    // =============================================================================
    // 🔧 E3 FIX：剧目资源管理 全按钮自动化事件绑定 + 去抖
    // =============================================================================

/* ===== operas.html inline block (run 3, #2/9) ===== */
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
      /* P1修复:假成功已移除 —— DBF 死按钮兜底不再伪造「保存成功/已删除/已核销/导出完成/签约成功/派工成功」
         等提示，也不再模拟删行/弹确认框。能走到这里的均为未接线死按钮（真实按钮已被上方
         __btnHasBound/__bindDone 检查放行），统一弹 warning「该功能暂未接入后端」并 preventDefault
         防原生提交刷新，同时 console.warn 记录接线缺口。 */
      var isSave = (txt.indexOf('保存')>=0 || txt.indexOf('提交')>=0 || txt.indexOf('确认')>=0);
      var isEdit = (txt.indexOf('编辑')>=0);
      var isDel  = (txt.indexOf('删除')>=0 && txt.length <= 10);
      var isView = (txt.indexOf('查看')>=0 || (txt==='👁') || (txt.indexOf('👁')>=0 && txt.length<=6) || txt.indexOf('详情')>=0 || txt.indexOf('预览')>=0);
      var isVerify = (txt.indexOf('核销')>=0);
      var isExport = (txt.indexOf('导出')>=0);
      var isAdd = (txt.indexOf('新增')>=0);
      var doneKey = 'e2_'+(isSave?'s':isEdit?'e':isDel?'d':isView?'v':isVerify?'y':isExport?'x':isAdd?'a':'k')+'_'+(trKey||Math.random().toString(36).slice(2,6));
      function __pDeadTip(branch){
        __pLog('DBF', branch+'_unwired', Object.assign({},__pEvt,{row:trKey, branch:branch}));
        try { e.preventDefault(); } catch(_p1){}
        console.warn('[P1] 未接线按钮:', txt||branch, trKey?('（行：'+trKey+'）'):'');
        __T('⚠️ 该功能暂未接入后端','warning');
        btn.__ctE2Done = 1;
      }
      if(isSave){
    __pEvt.branch='save';
    var __pLk = __L(doneKey,900);
    if(!__pLk) { try { e.stopPropagation(); } catch(_a){} return; }
        __pDeadTip('save'); try { e.stopPropagation(); } catch(_b){} return;
      }
      if(isEdit){
        if(!__L(doneKey,700)) return;
        __pDeadTip('edit'); return;
      }
      if(isDel){
        if(!__L(doneKey,850)) { try { e.stopPropagation(); } catch(_a){} return; }
        __pDeadTip('delete'); try { e.stopPropagation(); } catch(_b){} return;
      }
      if(isView){
        if(!__L(doneKey,500)) return;
        __pDeadTip('view'); return;
      }
      if(isVerify){
        if(!__L(doneKey,900)) return;
        __pDeadTip('verify'); return;
      }
      if(isExport){
        if(!__L(doneKey,1200)) return;
        __pDeadTip('export'); return;
      }
      if(isAdd){
        if(!__L(doneKey,900)) return;
        __pDeadTip('add'); return;
      }
      // ---- 新增：审核/审批/驳回/通过 ----
      var isAudit = txt.indexOf('审核')>=0 || txt.indexOf('审批')>=0 || txt.indexOf('驳回')>=0 || txt.indexOf('通过')>=0;
      if(isAudit){
        if(!__L(doneKey,850)){ try{e.stopPropagation();}catch(_a){} return; }
        __pDeadTip('audit'); try{e.stopPropagation();}catch(_b){} return;
      }
      // ---- 新增：签约/签订 ----
      var isSign = txt.indexOf('签约')>=0 || txt.indexOf('签订')>=0 || (txt.indexOf('签')>=0 && txt.indexOf('约')>=0);
      if(isSign){
        if(!__L(doneKey,900)){ try{e.stopPropagation();}catch(_a){} return; }
        __pDeadTip('sign'); try{e.stopPropagation();}catch(_b){} return;
      }
      // ---- 新增：合同/生成合同 ----
      var isContract = txt.indexOf('合同')>=0 && !isSign;
      if(isContract){
        if(!__L(doneKey,1000)) return;
        __pDeadTip('contract'); return;
      }
      // ---- 新增：排期/排班/安排档期 ----
      var isScheduleBtn = txt.indexOf('排期')>=0 || txt.indexOf('排班')>=0 || (txt.indexOf('安排')>=0 && (txt.length<=8 || txt.indexOf('档期')>=0));
      if(isScheduleBtn){
        if(!__L(doneKey,800)) return;
        __pDeadTip('schedule'); return;
      }
      // ---- 新增：取消/处理/确认接单 ----
      var isCancelOrHandle = txt.indexOf('取消')>=0 || txt.indexOf('处理')>=0 || txt.indexOf('确认接单')>=0 || txt.indexOf('派工')>=0;
      if(isCancelOrHandle && !isDel && !isSave){
        if(!__L(doneKey,800)){ try{e.stopPropagation();}catch(_a){} return; }
        __pDeadTip('status'); try{e.stopPropagation();}catch(_b){} return;
      }

    }, true);
    console.info('[DeadButtonFallback 已加载：×兜底 + 保存/编辑/删除/查看/核销/导出/新增 死按钮兜底委托]');
    try{ window.__T = __T; window.__L = __L; }catch(_){}
  })();
  
} /* end of 防重复注入保护 if */

/* ===== operas.html inline block (run 3, #3/9) ===== */
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
        /* P1修复:假成功已移除 —— 必填/格式校验为真实助手（保留），但校验通过后原「✅ 提交成功」
           为假提交分支：该表单无真实提交实现时不再伪造成功、不再自动关弹窗，
           保留 preventDefault（上方已执行，防原生提交刷新），改为 warning 提示未接入。 */
        console.warn('[P1] 未接线表单:', form.id||form.name||'(anonymous)');
        __toastH9('⚠️ 该功能暂未接入后端','warning');
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
        // v20260929fix：若按钮已有 __bindBtn 自定义绑定（__ub=1），跳过 SuperPatch 兜底，
        // 让按钮自己的 capture handler 处理（避免 stopPropagation 阻断 operas addOperaCloseBtn 等）
        var _btnEl = el.closest ? el.closest('button, a, [role=button]') : null;
        if (_btnEl && _btnEl.__ub) return;
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
    function __bindBtn(id, fn){ var el=document.getElementById(id); if(el&&!el.__ub){ el.__ub=1; try{ el.__superPatchBound=1; }catch(_){} el.addEventListener("click", fn, true); } }
    /* P1修复:假成功已移除 —— 头部「选择剧照」原为一次性临时 input（选择结果无处落地），
       改为打开表单内真实文件选择器 #operasAttachFiles，让选择结果进入下方真实上传流程 */
    __bindBtn('openOperasUploadBtn', function(){ var inp=document.getElementById("operasAttachFiles"); if(inp&&typeof inp.click==="function"){ inp.click(); } else { __T("⚠️ 未找到图片选择控件","error"); } });

    /* P1修复:假成功已移除 —— 剧目海报/剧照上传接通真实接口（原表单提交落入 SuperPatch 1/6 假提交分支，弹「✅ 提交成功」）：
       POST /v1/upload（单文件，multipart 字段 file）/ POST /v1/upload/multi（多文件，字段 file+files），
       返回 data:{url,...}；成功后若已选关联剧目，则 PATCH /v1/plays/{id} 写入 posterUrl
       （对照 server/src/controllers/plays.js 的 b.posterUrl）；未选剧目时保存到 window.__operasLastPosterUrl。 */
    (function(){
      var form = document.getElementById('operasAttachForm');
      var fileInput = document.getElementById('operasAttachFiles');
      if(!form || form.__realUploadWired) return;
      form.__realUploadWired = 1;
      function T(m,t){ try{ window.__T(m,t); }catch(_){ try{ window.QinApp&&QinApp.Utils&&QinApp.Utils.toast(m,t||'info',3000); }catch(_2){} } }
      var __uploading = false;
      function doUpload(){
        if(__uploading) return;
        try{
          var files = fileInput && fileInput.files ? fileInput.files : null;
          if(!files || !files.length){ T('⚠️ 请先选择要上传的剧照/海报','error'); return; }
          var okFiles = [];
          for(var i=0;i<files.length;i++){
            var f = files[i];
            if(!/^image\/(jpeg|png|webp)$/i.test(f.type||'')){ T('⚠️ 仅支持 JPG/PNG/WebP：'+f.name,'error'); return; }
            if(f.size > 10*1024*1024){ T('⚠️ 文件超过10MB：'+f.name,'error'); return; }
            okFiles.push(f);
          }
          __uploading = true;
          var fd = new FormData();
          okFiles.forEach(function(f){ fd.append('file', f); });
          if(okFiles.length > 1){ okFiles.forEach(function(f){ fd.append('files', f); }); }
          var path = okFiles.length > 1 ? (QAXQJT_PATHS.UPLOAD_MULTI || '/v1/upload/multi') : (QAXQJT_PATHS.UPLOAD || '/v1/upload');
          T('📤 正在上传 '+okFiles.length+' 张图片…','info');
          window.QAXQJT_API.post(path, fd).then(function(data){
            var urls = [];
            if(data && Array.isArray(data.files)){ data.files.forEach(function(d){ if(d&&d.url) urls.push(d.url); }); }
            else if(Array.isArray(data)){ data.forEach(function(d){ if(d&&d.url) urls.push(d.url); }); }
            else if(data && data.url){ urls.push(data.url); }
            if(!urls.length){ T('❌ 上传响应未返回 url','error'); return; }
            var sel = document.getElementById('operasAttachPlaySelect');
            var playId = sel ? (sel.value||'').trim() : '';
            if(playId){
              var playLabel = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : playId;
              window.QAXQJT_API.patch((QAXQJT_PATHS.PLAYS_BY_ID || function (i) { return '/v1/plays/' + i; })(encodeURIComponent(playId)), { posterUrl: urls[0] }).then(function(){
                window.__operasLastPosterUrl = urls[0];
                T('✅ 已上传 '+urls.length+' 张图片，封面已更新到《'+playLabel.replace(/^《|》$/g,'')+'》','success');
                try { if(window.__operasApi && window.__operasApi.load) window.__operasApi.load(); } catch(_rl){}
              }).catch(function(err){
                console.warn('[P1 upload] posterUrl 更新失败', err);
                T('❌ 图片已上传但封面更新失败：'+((err&&err.message)||err),'error');
              });
            } else {
              window.__operasLastPosterUrl = urls[0];
              console.info('[P1 upload] 已上传 URL：', urls.join(', '), '（未选关联剧目，可重新上传时选择）');
              T('✅ 已上传 '+urls.length+' 张图片（未选关联剧目，URL 已暂存）','success');
            }
          }).catch(function(err){
            console.warn('[P1 upload] 失败', err);
            T('❌ 上传失败：'+((err&&err.message)||err),'error');
          }).finally(function(){ __uploading = false; });
        }catch(_e){ __uploading = false; console.warn('[P1 upload err]', _e); T('❌ 上传失败：'+((_e&&_e.message)||_e),'error'); }
      }
      // window 捕获阶段先于 SuperPatch 1/6 的 document 捕获 submit 拦截，抢先把本表单导向真实上传
      window.addEventListener('submit', function(ev){
        if(ev.target !== form) return;
        try{ ev.preventDefault(); ev.stopPropagation(); try{ ev.stopImmediatePropagation(); }catch(_si){} }catch(_){}
        doUpload();
      }, true);
      // 「刷新bug+弹窗修复20260825」会把 submit 按钮改为 type=button（不触发 submit 事件），
      // 故同时在 window 捕获阶段接表单内按钮点击（排除 reset），双保险且互不重复（__uploading 防重入）
      window.addEventListener('click', function(ev){
        var b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if(!b || !form.contains(b)) return;
        if((b.getAttribute('type')||'').toLowerCase() === 'reset') return;
        try{ ev.preventDefault(); ev.stopPropagation(); }catch(_){}
        doUpload();
      }, true);
    })();

    // 新增剧目：打开模态框
    function __openAddOperaModal(){
      var m = document.getElementById('addOperaModal');
      if(m){
        m.classList.remove('modal-overlay-hide','csp-hide','s-modal-hide');
        m.style.setProperty('display','flex','important');
        var nameInput=document.getElementById('addOperaName');
        if(nameInput){ setTimeout(function(){nameInput.focus();},100); }
      }
    }
    window.__openAddOperaModal = __openAddOperaModal;
    function __closeAddOperaModal(){
      var m = document.getElementById('addOperaModal');
      if(m){
        m.classList.add('modal-overlay-hide');
        m.style.setProperty('display','none','important');
      }
    }
    __bindBtn('spNewOperaBtn', __openAddOperaModal);
    __bindBtn('addOperaCloseBtn', __closeAddOperaModal);
    __bindBtn('addOperaCancelBtn', __closeAddOperaModal);

    // 提交新增剧目：交给 __operasApi 处理（POST /v1/plays + PATCH is_hot）
    __bindBtn('addOperaSubmitBtn', function(){ __operasApi && __operasApi.submitCreate && __operasApi.submitCreate(); });

    __bindBtn('spBatchHotBtn', function(){ __operasApi && __operasApi.batchHot && __operasApi.batchHot(); });
    __bindBtn('spExportOperasBtn', function(){ __operasApi && __operasApi.exportCsv && __operasApi.exportCsv(); });
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
        /* P1修复:假成功已移除 —— SuperPatch 6/6 死按钮兜底不再伪造「操作成功/已执行/已触发导出/
           审核处理完成」等提示，也不再弹 confirm 假确认。能走到这里的均为未接线死按钮
           （真实按钮已被 _hasAction/__superPatchBound 检查放行），统一弹 warning
           「该功能暂未接入后端」并 console.warn 记录接线缺口。preventDefault/stopPropagation 保留。 */
        __pLog('SP','fallback_unwired', {branch:tt, txt:txt, row:trKey});
        console.warn('[P1] 未接线按钮:', txt||tt, trKey?('（行：'+trKey+'）'):'');
        __toastH9('⚠️ 该功能暂未接入后端','warning');
        return false;
      }catch(e6){ console.warn('[SuperPatch 6/6 click err]',e6); }
    }, true);
    console.info('[SuperPatch 6/6] 已激活 ✓');
  }catch(e){ console.warn('[SuperPatch 6/6 init err]',e); }

  console.info('['+PATCH_ID+'] 6合1超级补丁全部加载完毕 ✓');
})();

} /* end of 防重复注入保护 if */

/* ===== operas.html inline block (run 3, #4/9) ===== */
(function(){
  if (window.__refreshBugFix20260825) return;
  window.__refreshBugFix20260825 = true;

  // 注入CSS：使用 modal-overlay-hide 类隐藏弹窗（兼容 app.js 的 :not(.modal-overlay-hide) 规则）
  var style = document.createElement('style');
  style.textContent = '.modal-overlay.modal-overlay-hide,.modal-overlay.csp-hide{display:none!important}';
  document.head.appendChild(style);

  function fixRefreshBug(){
    // 1. 阻止所有 form 的默认提交行为
    var forms = document.querySelectorAll('form');
    for (var i=0;i<forms.length;i++){
      var f = forms[i];
      if (f.getAttribute('data-refresh-fixed')) continue;
      f.setAttribute('data-refresh-fixed','1');
      f.setAttribute('action','javascript:void(0)');
      f.addEventListener('submit', function(e){ e.preventDefault(); e.stopPropagation(); return false; }, true);
    }
    // 2. 将所有 type=submit 的按钮改为 type=button，防止触发表单提交
    var btns = document.querySelectorAll('button[type="submit"], button:not([type])');
    for (var j=0;j<btns.length;j++){
      var b = btns[j];
      if (b.getAttribute('data-type-fixed')) continue;
      b.setAttribute('data-type-fixed','1');
      b.setAttribute('type','button');
    }
    // 3. 默认隐藏所有 modal-overlay（app.js 的 :not(.modal-overlay-hide) 规则导致默认显示）
    var overlays = document.querySelectorAll('.modal-overlay');
    for (var m=0;m<overlays.length;m++){
      var ov = overlays[m];
      if (ov.getAttribute('data-init-hidden')) continue;
      ov.setAttribute('data-init-hidden','1');
      ov.classList.add('modal-overlay-hide');
    }
    // 4. 绑定查看按钮（.view-detail）—— 打开弹窗
    var viewBtns = document.querySelectorAll('.view-detail');
    for (var v=0;v<viewBtns.length;v++){
      var vb = viewBtns[v];
      if (vb.getAttribute('data-view-fixed')) continue;
      vb.setAttribute('data-view-fixed','1');
      vb.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        var modal = document.getElementById('operaDetailModal');
        if (modal){
          modal.classList.remove('modal-overlay-hide','csp-hide','s-modal-hide');
          modal.classList.add('active');
          try { modal.style.setProperty('display','flex','important'); } catch(_e){} /* v20260929fix：与 viewDetail 打开方式对齐，保证 inline flex 被关闭路径正确清除 */
        }
      }, true);
    }
    // 5. 绑定关闭按钮（×/关闭/取消）—— 关闭弹窗
    var closeBtns = document.querySelectorAll('button');
    for (var k=0;k<closeBtns.length;k++){
      var btn = closeBtns[k];
      if (btn.getAttribute('data-close-fixed')) continue;
      var txt = (btn.textContent||'').trim();
      if (txt==='×' || txt==='✕' || txt==='关闭' || txt==='取消' || txt==='Close') {
        btn.setAttribute('data-close-fixed','1');
        btn.addEventListener('click', function(e){
          e.preventDefault();
          e.stopPropagation();
          var target = e.currentTarget;
          var node = target;
          for (var n=0;n<8;n++){
            if (!node) break;
            if (node.classList && (node.classList.contains('modal-overlay') || node.classList.contains('modal'))){
              node.classList.add('modal-overlay-hide');
              node.classList.remove('active');
            }
            node = node.parentElement;
          }
        }, true);
      }
    }
    // 6. 点击 overlay 背景关闭弹窗
    for (var p=0;p<overlays.length;p++){
      var ov2 = overlays[p];
      if (ov2.getAttribute('data-overlay-fixed')) continue;
      ov2.setAttribute('data-overlay-fixed','1');
      ov2.addEventListener('click', function(e){
        if (e.target !== e.currentTarget) return;
        e.currentTarget.classList.add('modal-overlay-hide');
        e.currentTarget.classList.remove('active');
      }, true);
    }
    console.log('[刷新bug+弹窗修复20260825] 已修复');
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', fixRefreshBug);
  } else {
    fixRefreshBug();
  }
  setTimeout(fixRefreshBug, 1000);
  setTimeout(fixRefreshBug, 3000);
})();

/* ===== operas.html inline block (run 3, #5/9) ===== */
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

/* ===== operas.html inline block (run 3, #6/9) ===== */
/* ========== 🔒 通用 __closeAnyModal：关闭所有弹窗/遮罩 ========== */
(function(){
  if(window.__closeAnyModal) return;
  window.__closeAnyModal = function(){
    try{
      var overlays = document.querySelectorAll('.modal-overlay, [id$="Overlay"], [id$="overlay"], .overlay, [class*="modal-overlay"], .modal-overlay-root, [data-overlay]');
      overlays.forEach(function(o){
        try{ o.classList.remove('active','show','modal-overlay-show'); o.classList.add('s-overlay-hide','modal-overlay-hide','csp-hide'); try{ o.style.setProperty('display','none','important'); }catch(_c){} }catch(_){ try{ o.style.display='none'; }catch(_a){} } /* v20260929fix：清除 inline flex!important，保证 Escape/兜底能关掉 viewDetail 详情弹窗 */
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

/* ===== operas.html inline block (run 3, #7/9) ===== */
/* 按钮防拦截：为有id的可点击元素预设 __superPatchBound，避免 SuperPatch 首次点击拦截 */
(function(){
  function __markBound(){
    var els=document.querySelectorAll('button[id], a[id], [data-action][id], .btn[id], .btn-action[id]');
    for(var i=0;i<els.length;i++){ var el=els[i]; if(!el.__superPatchBound){ el.__superPatchBound=1; } }
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',__markBound); }
  else { __markBound(); setTimeout(__markBound,500); }
})();

/* ===== operas.html inline block (run 3, #8/9) ===== */
/* ========== 🎭 剧目资源管理：真实 API 接线（v20260921a）==========
 * 替换原 demo 模式（localStorage + 静态行）为后端 RESTful API 调用
 * API：QAXQJT_API（js/api-request.js 已加载）
 * 端点：/v1/plays + /v1/play-categories + 行级 PATCH/DELETE
 * 备份：operas.html.bak-operasfix-20260921
 * ======================================================== */
(function(){
  'use strict';
  if (window.__operasApi) return;
  window.__operasApi = {
    state: { plays: [], filter: { genre: '', keyword: '' }, editingId: null, loaded: false, categories: [] },
    _toast: function(msg, type){ try { if (typeof __T === 'function') return __T(msg, type||'info'); } catch(_){} try { console.log('[operasApi]', type, msg); } catch(_){} },
    _escape: function(s){ if (s === null || s === undefined) return ''; return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); },

    load: async function(){
      try {
        var q = { page: 1, pageSize: 200 };
        if (this.state.filter.genre) q.genre = this.state.filter.genre;
        if (this.state.filter.keyword) q.keyword = this.state.filter.keyword;
        var resp = await QAXQJT_API.get((QAXQJT_PATHS.PLAYS || '/v1/plays'), { query: q });
        var rows = Array.isArray(resp) ? resp : (resp && (resp.items || resp.list || resp.rows)) || [];
        this.state.plays = rows;
        this._renderTable(rows);
        this._renderGrid(rows);
        this._renderCategoryCounts(rows);
        this.state.loaded = true;
        try { if (window.QinPagination && typeof QinPagination.init === 'function') QinPagination.init(); } catch(_){}
      } catch(e) {
        console.warn('[__operasApi.load] 失败', e);
        this._toast('⚠️ 加载剧目列表失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    _renderTable: function(rows){
      var tbody = document.getElementById('operasMainTbody') || document.querySelector('#operaListView tbody[data-paginate="list"]');
      if (!tbody) { console.warn('[operasApi] tbody not found'); return; }
      tbody.innerHTML = '';
      var self = this;
      var idx = 0;
      rows.forEach(function(p){
        if (p.status === 'deleted') return;
        idx++;
        var playId = String(p.id || p.playCode || '');
        var genre = p.genre || '传统本戏';
        var badgeClass = 'badge-gold';
        if (genre.indexOf('现代') >= 0) badgeClass = 'badge-success';
        else if (genre.indexOf('折子') >= 0) badgeClass = 'badge-info';
        else if (genre.indexOf('创编') >= 0) badgeClass = 'badge-warning';
        var hot = !!(p.is_hot || p.isHot);
        var hotText = hot ? '<span style="color:#ff4757;">🔥 是</span>' : '否';
        var duration = (p.durationMinutes || p.duration || 0) + '分钟';
        var scene = self._escape(p.subtitle || p.scene || '—');
        var cast = self._escape(p.castSummary || p.cast || '—');
        var createdAt = p.createdAt ? String(p.createdAt).slice(0,10) : '—';
        var tr = document.createElement('tr');
        tr.setAttribute('data-play-id', playId);
        tr.setAttribute('data-is-hot', hot ? '1' : '0');
        tr.innerHTML =
          '<td><strong style="color:var(--primary);">' + self._escape(playId) + '</strong></td>' +
          '<td><strong>《' + self._escape(p.title || p.name || '') + '》</strong></td>' +
          '<td><span class="badge ' + badgeClass + '">' + self._escape(genre) + '</span></td>' +
          '<td>' + duration + '</td>' +
          '<td>' + scene + '</td>' +
          '<td>' + cast + '</td>' +
          '<td>—</td>' +
          '<td style="color:var(--primary);font-weight:600;">—</td>' +
          '<td><strong style="color:var(--gold-dark);">—</strong></td>' +
          '<td>' + hotText + '</td>' +
          '<td>' + createdAt + '</td>' +
          '<td><div class="admin-table-actions" data-play-row="' + playId + '">' +
            '<button class="btn btn-secondary btn-sm" data-act="view" title="查看详情">👁</button>' +
            '<button class="btn btn-primary btn-sm" data-act="edit" title="编辑">✏️</button>' +
            '<button class="btn btn-gold btn-sm" data-act="hot" title="切换热门">🔥</button>' +
            '<button class="btn btn-outline-dark btn-sm" style="color:var(--primary);border-color:var(--primary);padding:6px 10px;" data-act="cast" title="演员表">👥</button>' +
            '<button class="btn btn-sm" style="background:rgba(220,53,69,0.1);color:#dc3545;padding:6px 10px;" data-act="del" title="删除">🗑️</button>' +
          '</div></td>';
        tbody.appendChild(tr);
      });
      try {
        var tbtns = tbody.querySelectorAll('button[data-act]');
        for (var tb = 0; tb < tbtns.length; tb++) { var tb1 = tbtns[tb]; if(!tb1.__superPatchBound)tb1.__superPatchBound=1; if(!tb1.__ts3Done)tb1.__ts3Done=1; if(!tb1.__bindDone)tb1.__bindDone=1; if(!tb1.__ctE2Done)tb1.__ctE2Done=1; if(!tb1.__deadBtnChecked)tb1.__deadBtnChecked=1; }
      } catch(_){}
      if (window.__guardRealActions) { try { window.__guardRealActions(tbody); } catch(_){} }
      if (!idx) {
        tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:30px;color:#999;">暂无剧目数据（可在「新增剧目」中创建第一条）</td></tr>';
      }
    },

    _renderGrid: function(rows){
      var grid = document.getElementById('operasMainGrid') || document.querySelector('#operaGridView .opera-grid');
      if (!grid) { console.warn('[operasApi] grid not found'); return; }
      grid.innerHTML = '';
      var self = this;
      rows.forEach(function(p){
        if (p.status === 'deleted') return;
        var playId = String(p.id || p.playCode || '');
        var genre = p.genre || '传统本戏';
        var color1 = '#fdecea', color2 = '#922b21';
        if (genre.indexOf('现代') >= 0){ color1='#eef7ee'; color2='#1e8449'; }
        else if (genre.indexOf('折子') >= 0){ color1='#eef2f7'; color2='#2874a6'; }
        else if (genre.indexOf('创编') >= 0){ color1='#fef9e7'; color2='#b7950b'; }
        var title = self._escape(p.title || p.name || '');
        var duration = (p.durationMinutes || p.duration || 0) + '分钟';
        var cast = self._escape(p.castSummary || p.cast || '待定');
        var scene = self._escape(p.subtitle || p.scene || '庙会/商演/惠民');
        var hot = !!(p.is_hot || p.isHot);
        var svgSrc = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 288"><defs><linearGradient id="bg'+playId+'" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="'+color1+'"/><stop offset="100%" stop-color="'+color2+'"/></linearGradient></defs><rect width="512" height="288" fill="url(#bg'+playId+')"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-size="48" font-family="STXingkai,KaiTi,serif" font-weight="700">'+title+'</text></svg>'
        );
        var card = document.createElement('div');
        card.className = 'opera-card';
        card.setAttribute('data-play-id', playId);
        card.innerHTML =
          '<div class="opera-poster">' +
            '<img src="' + svgSrc + '" alt="' + title + '">' +
            '<div class="category-label">' + self._escape(genre) + '</div>' +
            (hot ? '<div class="hot-badge">🔥 热门</div>' : '') +
          '</div>' +
          '<div class="opera-body">' +
            '<div class="opera-title-row"><h3 class="opera-title">《' + title + '》</h3></div>' +
            '<div class="opera-meta">' +
              '<span><span class="meta-icon">⏱️</span>' + duration + '</span>' +
              '<span><span class="meta-icon">👤</span>主演：' + cast + '</span>' +
            '</div>' +
            '<div class="scene-tags"><span class="scene-tag">' + scene + '</span></div>' +
            '<div class="opera-stats">' +
              '<span class="stat-label">今年演出</span>' +
              '<span class="stat-num">— 场</span>' +
            '</div>' +
            '<div class="opera-actions">' +
              '<button class="btn btn-secondary btn-sm" data-act="view">👁 查看</button>' +
              '<button class="btn btn-primary btn-sm" data-act="edit">✏️ 编辑</button>' +
              '<button class="btn btn-gold btn-sm" data-act="hot">🔥 热门</button>' +
            '</div>' +
          '</div>';
        grid.appendChild(card);
      });
      try {
        var gbtns = grid.querySelectorAll('button[data-act]');
        for (var gb = 0; gb < gbtns.length; gb++) { var gb1 = gbtns[gb]; if(!gb1.__superPatchBound)gb1.__superPatchBound=1; if(!gb1.__ts3Done)gb1.__ts3Done=1; if(!gb1.__bindDone)gb1.__bindDone=1; if(!gb1.__ctE2Done)gb1.__ctE2Done=1; if(!gb1.__deadBtnChecked)gb1.__deadBtnChecked=1; }
      } catch(_){}
      if (window.__guardRealActions) { try { window.__guardRealActions(grid); } catch(_){} }
    },

    _renderCategoryCounts: function(rows){
      var tabs = document.querySelectorAll('.category-tab:not(.opera-cat-manage)');
      if (!tabs || !tabs.length) return;
      var totalCount = 0;
      rows.forEach(function(p){ if (p.status !== 'deleted') totalCount++; });
      var totalTab = Array.from(tabs).find(function(t){ return t.getAttribute('data-cat') === 'all'; });
      if (totalTab) {
        totalTab.textContent = '全部剧目 (' + totalCount + ')';
      }
    },

    /* P2修复:分类管理接通 /v1/play-categories（列表GET/新增POST/改名·排序·停启用PATCH/删除DELETE） */
    _pcListPath: function(){
      try { var P = window.QAXQJT_API_CONFIG && window.QAXQJT_API_CONFIG.PATHS; if (P && P.PLAY_CATEGORIES) return P.PLAY_CATEGORIES; } catch(_){}
      return '/v1/play-categories';
    },
    _pcByIdPath: function(id){
      try { var P = window.QAXQJT_API_CONFIG && window.QAXQJT_API_CONFIG.PATHS; if (P && P.PLAY_CATEGORIES_BY_ID) return P.PLAY_CATEGORIES_BY_ID(id); } catch(_){}
      return '/v1/play-categories/' + encodeURIComponent(id);
    },
    _fetchCategories: async function(){
      var resp = await QAXQJT_API.get(this._pcListPath());
      var rows = Array.isArray(resp) ? resp : (resp && (resp.items || resp.list || resp.rows)) || [];
      this.state.categories = rows;
      return rows;
    },

    openCatManage: function(){
      var m = document.getElementById('catManageModal');
      if (m) {
        m.classList.remove('modal-overlay-hide','csp-hide','s-modal-hide');
        m.style.setProperty('display','flex','important');
      }
      this.loadCatList();
      this.syncCategorySources();
    },

    closeCatManage: function(){
      var m = document.getElementById('catManageModal');
      if (m) { m.classList.add('modal-overlay-hide'); m.style.setProperty('display','none','important'); }
    },

    loadCatList: async function(){
      var tbody = document.getElementById('catManageTbody');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#999;">正在加载分类…</td></tr>';
      try {
        var rows = await this._fetchCategories();
        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#999;">暂无分类，请在上方新增</td></tr>';
          return;
        }
        var self = this;
        tbody.innerHTML = '';
        rows.forEach(function(c){
          var st = String(c.status || 'active');
          var dis = st === 'disabled';
          var tr = document.createElement('tr');
          tr.setAttribute('data-cat-id', String(c.id || ''));
          tr.innerHTML =
            '<td><strong>' + self._escape(c.name) + '</strong></td>' +
            '<td>' + self._escape(c.sortOrder) + '</td>' +
            '<td>' + (dis ? '<span class="badge" style="background:#ececec;color:#888;">已停用</span>' : '<span class="badge badge-success">启用中</span>') + '</td>' +
            '<td>' + self._escape(c.playCount || 0) + '</td>' +
            '<td><div class="admin-table-actions">' +
              '<button class="btn btn-primary btn-sm" type="button" data-cat-act="rename" title="重命名（其下剧目同步迁移）">✏️</button>' +
              '<button class="btn btn-secondary btn-sm" type="button" data-cat-act="sort" title="修改排序">🔢</button>' +
              '<button class="btn btn-outline-dark btn-sm" type="button" data-cat-act="toggle" title="' + (dis ? '启用' : '停用') + '">' + (dis ? '▶️' : '⏸') + '</button>' +
              '<button class="btn btn-sm" type="button" style="background:rgba(220,53,69,0.1);color:#dc3545;padding:6px 10px;" data-cat-act="del" title="删除">🗑️</button>' +
            '</div></td>';
          tbody.appendChild(tr);
        });
      } catch(e) {
        console.warn('[loadCatList] 失败', e);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#dc3545;">加载失败：' + this._escape(e && e.message ? e.message : e) + '</td></tr>';
      }
    },

    _syncFormSelect: function(){
      var sel = document.getElementById('addOperaCategory');
      if (!sel) return;
      var cats = this.state.categories || [];
      if (!cats.length) return;
      /* P2修复:剧目分类下拉由写死 option 改为 GET /v1/play-categories */
      var act = cats.filter(function(c){ return String(c.status || 'active') !== 'disabled'; });
      var use = act.length ? act : cats;
      var cur = sel.value;
      var self = this;
      sel.innerHTML = use.map(function(c){ var n = self._escape(c.name); return '<option value="' + n + '">' + n + '</option>'; }).join('');
      var has = Array.prototype.some.call(sel.options, function(o){ return o.value === cur; });
      if (cur && has) sel.value = cur;
    },

    _syncCatTabs: function(){
      var cats = this.state.categories || [];
      var act = cats.filter(function(c){ return String(c.status || 'active') !== 'disabled'; });
      if (!act.length) return; /* 拉取失败或为空时保留默认写死 tab 兜底 */
      var bar = document.querySelector('.category-tabs');
      if (!bar) return;
      var allTab = bar.querySelector('.category-tab[data-cat="all"]');
      var manageBtn = bar.querySelector('.opera-cat-manage');
      if (!allTab) return;
      /* P2修复:筛选 tab 由写死改为按真实分类重建（除「全部」与管理按钮外） */
      Array.from(bar.querySelectorAll('.category-tab')).forEach(function(t){
        if (t !== allTab) { try { t.remove(); } catch(_){ if (t.parentNode) t.parentNode.removeChild(t); } }
      });
      var self = this;
      act.forEach(function(c){
        var d = document.createElement('div');
        d.className = 'category-tab';
        d.setAttribute('data-genre', c.name);
        d.textContent = c.name + ' (' + (c.playCount || 0) + ')';
        d.addEventListener('click', function(){
          Array.from(bar.querySelectorAll('.category-tab')).forEach(function(t){ t.classList.remove('active'); });
          d.classList.add('active');
          self.state.filter.genre = c.name;
          self.load();
        });
        if (self.state.filter.genre === c.name) d.classList.add('active');
        bar.insertBefore(d, manageBtn || null);
      });
      if (!self.state.filter.genre) allTab.classList.add('active');
    },

    syncCategorySources: async function(){
      try { await this._fetchCategories(); } catch(e) { console.warn('[syncCategorySources] 拉取分类失败', e); return; }
      this._syncCatTabs();
      this._syncFormSelect();
    },

    catCreate: async function(){
      var nameEl = document.getElementById('catNewName');
      var sortEl = document.getElementById('catNewSort');
      var name = nameEl ? (nameEl.value || '').trim() : '';
      if (!name) { this._toast('⚠️ 请输入分类名称', 'error'); return; }
      if (name.length > 30) { this._toast('⚠️ 分类名称最长 30 字', 'error'); return; }
      var body = { name: name };
      var sv = parseInt((sortEl && sortEl.value) || '', 10);
      if (Number.isInteger(sv) && sv > 0) body.sortOrder = sv;
      try {
        await QAXQJT_API.post(this._pcListPath(), body);
        this._toast('✅ 分类「' + name + '」已新增', 'success');
        if (nameEl) nameEl.value = '';
        if (sortEl) sortEl.value = '';
        await this._afterCatChange();
      } catch(e) {
        console.warn('[catCreate] 失败', e);
        this._toast('⚠️ 新增分类失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    _bindCatActions: function(){
      if (this._catActBound) return;
      var tbody = document.getElementById('catManageTbody');
      if (!tbody) return;
      this._catActBound = true;
      var self = this;
      tbody.addEventListener('click', async function(e){
        var btn = e.target.closest && e.target.closest('button[data-cat-act]');
        if (!btn) return;
        var tr = btn.closest('tr');
        var id = tr ? (tr.getAttribute('data-cat-id') || '') : '';
        if (!id) return;
        var act = btn.getAttribute('data-cat-act');
        try { e.stopImmediatePropagation(); e.stopPropagation(); } catch(_){}
        var cat = (self.state.categories || []).filter(function(c){ return String(c.id) === id; })[0] || {};
        try {
          if (act === 'rename') {
            var nn = (prompt('修改分类名称（其下剧目将同步迁移）：', cat.name || '') || '').trim();
            if (!nn || nn === cat.name) return;
            if (nn.length > 30) { self._toast('⚠️ 分类名称最长 30 字', 'error'); return; }
            await QAXQJT_API.patch(self._pcByIdPath(id), { name: nn });
            self._toast('✅ 已重命名为「' + nn + '」', 'success');
          } else if (act === 'sort') {
            var ns = parseInt(prompt('修改排序（正整数，数字越小越靠前）：', (cat.sortOrder || 1) + ''), 10);
            if (!Number.isInteger(ns) || ns <= 0) { self._toast('⚠️ 请输入正整数排序', 'error'); return; }
            await QAXQJT_API.patch(self._pcByIdPath(id), { sortOrder: ns });
            self._toast('✅ 排序已更新为 ' + ns, 'success');
          } else if (act === 'toggle') {
            var to = String(cat.status || 'active') === 'disabled' ? 'active' : 'disabled';
            await QAXQJT_API.patch(self._pcByIdPath(id), { status: to });
            self._toast(to === 'disabled' ? '⏸ 分类「' + (cat.name || '') + '」已停用' : '▶️ 分类「' + (cat.name || '') + '」已启用', 'success');
          } else if (act === 'del') {
            var cnt = cat.playCount || 0;
            var msg = cnt > 0
              ? '分类「' + (cat.name || id) + '」下还有 ' + cnt + ' 个剧目，删除会被拒绝（可先重命名迁移或停用）。\n\n仍要尝试删除吗？'
              : '确认删除分类「' + (cat.name || id) + '」？\n此操作不可撤销。';
            if (!confirm(msg)) return;
            await QAXQJT_API.del(self._pcByIdPath(id));
            self._toast('✅ 分类「' + (cat.name || id) + '」已删除', 'success');
          } else { return; }
          await self._afterCatChange();
        } catch(err) {
          console.warn('[catManage] ' + act + ' 失败', err);
          self._toast('⚠️ 操作失败：' + (err && err.message ? err.message : err), 'error');
        }
      }, true);
    },

    _afterCatChange: async function(){
      await this.loadCatList();
      await this.syncCategorySources();
      try { await this.load(); } catch(_){}
    },

    submitCreate: async function(){
      var nameInput = document.getElementById('addOperaName');
      if (!nameInput) { this._toast('⚠️ 表单未就绪', 'error'); return; }
      var name = (nameInput.value || '').trim();
      if (!name) { this._toast('⚠️ 请输入剧目名称', 'error'); return; }
      var category = (document.getElementById('addOperaCategory') || {}).value || '传统本戏';
      var duration = parseInt((document.getElementById('addOperaDuration') || {}).value, 10) || 120;
      var scene = ((document.getElementById('addOperaScene') || {}).value || '').trim();
      var cast = ((document.getElementById('addOperaCast') || {}).value || '').trim();
      var cost = parseInt((document.getElementById('addOperaCost') || {}).value, 10) || 0;
      var price = parseInt((document.getElementById('addOperaPrice') || {}).value, 10) || 0;

      var body = {
        title: name,
        genre: category,
        durationMinutes: duration,
        subtitle: scene,
        castSummary: cast
      };
      var editId = this.state.editingId;
      try {
        if (editId) {
          await QAXQJT_API.patch((QAXQJT_PATHS.PLAYS_BY_ID || function (i) { return '/v1/plays/' + i; })(encodeURIComponent(editId)), body);
          this._toast('✅ 剧目《' + name + '》已更新', 'success');
        } else {
          var created = await QAXQJT_API.post((QAXQJT_PATHS.PLAYS || '/v1/plays'), body);
          var newId = created && (created.id || created.playCode);
          if (newId) {
            try {
              var key = 'qaxqjt_operas_pricing_v1';
              var pricing = {};
              try { pricing = JSON.parse(localStorage.getItem(key) || '{}'); } catch(_){}
              pricing[newId] = { cost: cost, price: price, updatedAt: new Date().toISOString() };
              localStorage.setItem(key, JSON.stringify(pricing));
            } catch(_){}
          }
          this._toast('✅ 剧目《' + name + '》已创建' + (newId ? '（ID: ' + newId + '）' : ''), 'success');
        }
        try { __closeAddOperaModal(); } catch(_){}
        try {
          document.getElementById('addOperaName').value = '';
          document.getElementById('addOperaDuration').value = '120';
          document.getElementById('addOperaScene').value = '';
          document.getElementById('addOperaCast').value = '';
          document.getElementById('addOperaCost').value = '6000';
          document.getElementById('addOperaPrice').value = '5000';
        } catch(_){}
        this.state.editingId = null;
        await this.load();
      } catch(e) {
        console.warn('[__operasApi.submitCreate] 失败', e);
        this._toast('⚠️ 提交剧目失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    batchHot: async function(){
      var ids = [];
      try {
        var checked = document.querySelectorAll('#operaListView input.admin-table-checkbox:checked');
        if (checked && checked.length) {
          checked.forEach(function(cb){
            var tr = cb.closest('tr');
            if (tr) { var id = tr.getAttribute('data-play-id'); if (id) ids.push(id); }
          });
        }
      } catch(_){}
      if (!ids.length) {
        try {
          var trs = document.querySelectorAll('#operaListView tbody tr[data-play-id]');
          trs.forEach(function(tr){ var id = tr.getAttribute('data-play-id'); if (id) ids.push(id); });
        } catch(_){}
      }
      if (!ids.length) { this._toast('⚠️ 没有可设置热门的剧目（请先加载剧目列表）', 'warning'); return; }
      if (!confirm('确认为以下 ' + ids.length + ' 个剧目批量设置热门？\n（已设热门的会保持热门状态）')) return;
      var okCnt = 0, failCnt = 0;
      for (var i = 0; i < ids.length; i++) {
        try {
          await QAXQJT_API.patch((QAXQJT_PATHS.PLAYS_BY_ID || function (i) { return '/v1/plays/' + i; })(encodeURIComponent(ids[i])), { is_hot: true });
          okCnt++;
        } catch(e) { failCnt++; console.warn('[batchHot] id=' + ids[i], e); }
      }
      this._toast('✅ 已设置 ' + okCnt + ' 个剧目为热门' + (failCnt ? '；' + failCnt + ' 个失败' : ''), 'success');
      await this.load();
    },

    exportCsv: async function(){
      try {
        this._toast('📊 正在拉取剧目列表…', 'info');
        var resp = await QAXQJT_API.get((QAXQJT_PATHS.PLAYS || '/v1/plays'), { query: { page: 1, pageSize: 500 } });
        var rows = Array.isArray(resp) ? resp : (resp && (resp.items || resp.list || resp.rows)) || [];
        if (!rows.length) { this._toast('⚠️ 没有可导出的剧目', 'warning'); return; }
        var csv = ['剧目ID,剧目名称,分类,时长(分钟),适配场景,主要演员,热门,创建时间'];
        rows.forEach(function(p){
          if (p.status === 'deleted') return;
          var cells = [
            String(p.id || p.playCode || ''),
            String(p.title || p.name || ''),
            String(p.genre || ''),
            String(p.durationMinutes || p.duration || ''),
            String(p.subtitle || p.scene || ''),
            String(p.castSummary || p.cast || ''),
            (p.is_hot || p.isHot) ? '是' : '否',
            p.createdAt ? String(p.createdAt).slice(0,19) : ''
          ];
          csv.push(cells.map(function(c){ c = String(c).replace(/"/g, '""'); return /[",\n]/.test(c) ? '"' + c + '"' : c; }).join(','));
        });
        var blob = new Blob(['\ufeff' + csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        var today = new Date().toISOString().slice(0,10);
        a.download = 'qaxqjt-operas-' + today + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(function(){ try { URL.revokeObjectURL(url); a.remove(); } catch(_){} }, 100);
        this._toast('✅ 已导出 ' + rows.length + ' 条剧目', 'success');
      } catch(e) {
        console.warn('[__operasApi.exportCsv] 失败', e);
        this._toast('⚠️ 导出失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    toggleHot: async function(id, current){
      if (!id) return;
      try {
        await QAXQJT_API.patch((QAXQJT_PATHS.PLAYS_BY_ID || function (i) { return '/v1/plays/' + i; })(encodeURIComponent(id)), { is_hot: !current });
        this._toast(current ? '✅ 已取消热门' : '✅ 已设置为热门', 'success');
        await this.load();
      } catch(e) {
        console.warn('[toggleHot] id=' + id, e);
        this._toast('⚠️ 切换热门失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    deletePlay: async function(id, title){
      if (!id) return;
      if (!confirm('确认删除剧目《' + (title || id) + '》？\n此操作不可撤销。')) return;
      try {
        await QAXQJT_API.del((QAXQJT_PATHS.PLAYS_BY_ID || function (i) { return '/v1/plays/' + i; })(encodeURIComponent(id)));
        this._toast('✅ 剧目《' + (title || id) + '》已删除', 'success');
        await this.load();
      } catch(e) {
        console.warn('[deletePlay] id=' + id, e);
        this._toast('⚠️ 删除失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    viewDetail: async function(id){
      if (!id) return;
      var modal = document.getElementById('operaDetailModal');
      if (!modal) { this._toast('⚠️ 详情弹窗未就绪', 'error'); return; }
      try {
        var p = await QAXQJT_API.get((QAXQJT_PATHS.PLAYS_BY_ID || function (i) { return '/v1/plays/' + i; })(encodeURIComponent(id)));
        if (!p) { this._toast('⚠️ 未找到该剧目', 'warning'); return; }
        var headerH3 = modal.querySelector('.modal-header h3');
        if (headerH3) headerH3.textContent = '🎭 剧目详情：' + (p.title || p.name || id);
        var grid = modal.querySelector('.detail-basic-grid');
        if (grid) {
          grid.innerHTML =
            '<div class="detail-basic-item"><span class="label">剧目ID：</span><span>' + this._escape(p.id || p.playCode || id) + '</span></div>' +
            '<div class="detail-basic-item"><span class="label">剧目名称：</span><span>《' + this._escape(p.title || p.name || '') + '》</span></div>' +
            '<div class="detail-basic-item"><span class="label">分类：</span><span>' + this._escape(p.genre || '—') + '</span></div>' +
            '<div class="detail-basic-item"><span class="label">时长：</span><span>' + (p.durationMinutes || p.duration || 0) + ' 分钟</span></div>' +
            '<div class="detail-basic-item"><span class="label">主演：</span><span>' + this._escape(p.castSummary || p.cast || '—') + '</span></div>' +
            '<div class="detail-basic-item"><span class="label">编剧/作者：</span><span>' + this._escape(p.author || '—') + '</span></div>' +
            '<div class="detail-basic-item"><span class="label">适配场景：</span><span>' + this._escape(p.subtitle || p.scene || '—') + '</span></div>' +
            '<div class="detail-basic-item"><span class="label">难度等级：</span><span>' + this._escape(p.difficultyLevel || '—') + '</span></div>' +
            '<div class="detail-basic-item"><span class="label">热门：</span><span>' + ((p.is_hot || p.isHot) ? '🔥 是' : '否') + '</span></div>' +
            '<div class="detail-basic-item"><span class="label">状态：</span><span>' + this._escape(p.status || 'active') + '</span></div>' +
            '<div class="detail-basic-item"><span class="label">创建时间：</span><span>' + (p.createdAt ? String(p.createdAt).slice(0,19) : '—') + '</span></div>' +
            '<div class="detail-basic-item"><span class="label">更新时间：</span><span>' + (p.updatedAt ? String(p.updatedAt).slice(0,19) : '—') + '</span></div>';
        }
        var sections = modal.querySelectorAll('.detail-section');
        if (sections.length >= 2) {
          var synSec = sections[1];
          var existing = synSec.querySelector('p.synopsis-text');
          if (existing) { existing.textContent = p.synopsis || '暂无剧情简介'; }
          else {
            var synP = document.createElement('p');
            synP.className = 'synopsis-text';
            synP.textContent = p.synopsis || '暂无剧情简介';
            synSec.appendChild(synP);
          }
        }
        // v20260926 修复：初始化 fixRefreshBug 给所有 overlay 打了 modal-overlay-hide（display:none!important），
        // 打开详情时必须先移除，否则 active 也无法显示（与 __openAddOperaModal 写法一致）
        try { modal.classList.remove('modal-overlay-hide','csp-hide','s-modal-hide'); } catch(_){}
        modal.classList.add('active');
        modal.style.setProperty('display','flex','important');
        try { document.body.classList.add('body-modal-locked'); } catch(_){}
      } catch(e) {
        console.warn('[viewDetail] id=' + id, e);
        this._toast('⚠️ 加载详情失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    editPlay: function(id, rowData){
      if (!id) return;
      this.state.editingId = id;
      try {
        document.getElementById('addOperaName').value = rowData.title || rowData.name || '';
        document.getElementById('addOperaCategory').value = rowData.genre || '传统本戏';
        document.getElementById('addOperaDuration').value = rowData.durationMinutes || rowData.duration || 120;
        document.getElementById('addOperaScene').value = rowData.subtitle || rowData.scene || '';
        document.getElementById('addOperaCast').value = rowData.castSummary || rowData.cast || '';
        document.getElementById('addOperaCost').value = '0';
        document.getElementById('addOperaPrice').value = '0';
        try {
          var pricing = JSON.parse(localStorage.getItem('qaxqjt_operas_pricing_v1') || '{}');
          if (pricing[id]) {
            document.getElementById('addOperaCost').value = pricing[id].cost || 0;
            document.getElementById('addOperaPrice').value = pricing[id].price || 0;
          }
        } catch(_){}
        var h3 = document.querySelector('#addOperaModal .modal-header h3');
        if (h3) h3.textContent = '✏️ 编辑剧目：' + (rowData.title || rowData.name || id);
        var submitBtn = document.getElementById('addOperaSubmitBtn');
        if (submitBtn) submitBtn.textContent = '✓ 保存修改';
      } catch(e) { console.warn('[editPlay] err', e); }
      try { window.__openAddOperaModal(); } catch(e){
        var m = document.getElementById('addOperaModal');
        if (m) { try { m.classList.remove('modal-overlay-hide','csp-hide','s-modal-hide'); m.style.setProperty('display','flex','important'); } catch(_e){ m.style.display = 'flex'; } }
      }
    },

    openCast: function(id){
      if (!id) return;
      location.href = 'cast-sheet.html?playId=' + encodeURIComponent(id);
    },

    _bindRowDelegation: function(){
      var self = this;
      if (this._rowDelegBound) return;
      this._rowDelegBound = true;
      var tbody = document.getElementById('operasMainTbody') || document.querySelector('#operaListView tbody[data-paginate="list"]');
      if (tbody) {
        tbody.addEventListener('click', function(e){
          var btn = e.target.closest('button[data-act]');
          if (!btn) return;
          var tr = btn.closest('tr');
          var id = tr ? tr.getAttribute('data-play-id') : '';
          if (!id) return;
          var act = btn.getAttribute('data-act');
          try { e.stopImmediatePropagation(); e.stopPropagation(); } catch(_){}
          var titleEl = tr.querySelector('td:nth-child(2) strong');
          var title = titleEl ? titleEl.textContent : id;
          var hot = tr.getAttribute('data-is-hot') === '1';
          if (act === 'view') { self.viewDetail(id); }
          else if (act === 'edit') { self._editByLoad(id, title); }
          else if (act === 'hot') { self.toggleHot(id, hot); }
          else if (act === 'cast') { self.openCast(id); }
          else if (act === 'del') { self.deletePlay(id, title); }
        }, true);
      }
      var grid = document.getElementById('operasMainGrid') || document.querySelector('#operaGridView .opera-grid');
      if (grid) {
        grid.addEventListener('click', function(e){
          var btn = e.target.closest('button[data-act]');
          if (!btn) return;
          var card = btn.closest('[data-play-id]');
          var id = card ? card.getAttribute('data-play-id') : '';
          if (!id) return;
          var act = btn.getAttribute('data-act');
          try { e.stopImmediatePropagation(); e.stopPropagation(); } catch(_){}
          var titleEl = card.querySelector('.opera-title');
          var title = titleEl ? titleEl.textContent : id;
          var hot = !!(card.querySelector('.hot-badge'));
          if (act === 'view') { self.viewDetail(id); }
          else if (act === 'edit') { self._editByLoad(id, title); }
          else if (act === 'hot') { self.toggleHot(id, hot); }
          else if (act === 'cast') { self.openCast(id); }
          else if (act === 'del') { self.deletePlay(id, title); }
        }, true);
      }
    },

    _editByLoad: async function(id, titleHint){
      try {
        var p = await QAXQJT_API.get((QAXQJT_PATHS.PLAYS_BY_ID || function (i) { return '/v1/plays/' + i; })(encodeURIComponent(id)));
        if (!p) { this._toast('⚠️ 未找到剧目', 'warning'); return; }
        this.editPlay(id, p);
      } catch(e) {
        console.warn('[_editByLoad] id=' + id, e);
        this.editPlay(id, { title: titleHint, id: id });
      }
    },

    _resetModalToAdd: function(){
      this.state.editingId = null;
      try {
        var h3 = document.querySelector('#addOperaModal .modal-header h3');
        if (h3) h3.textContent = '➕ 新增剧目';
        var submitBtn = document.getElementById('addOperaSubmitBtn');
        if (submitBtn) submitBtn.textContent = '✓ 创建剧目';
        document.getElementById('addOperaName').value = '';
        document.getElementById('addOperaDuration').value = '120';
        document.getElementById('addOperaScene').value = '';
        document.getElementById('addOperaCast').value = '';
        document.getElementById('addOperaCost').value = '6000';
        document.getElementById('addOperaPrice').value = '5000';
      } catch(_){}
    }
  };

  // spNewOperaBtn 点击前清空 editingId（capture 阶段，在 __bindBtn 之前）
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('#spNewOperaBtn');
    if (btn) { try { window.__operasApi._resetModalToAdd(); } catch(_){} }
  }, true);

  // 分类 tab + 搜索 + 初始加载
  function _bootStrap(){
    var api = window.__operasApi;
    if (!api) return;
    /* P2修复:分类管理按钮/弹窗绑定（.__superPatchBound 标记避免死按钮兜底拦截） */
    var catBtn = document.querySelector('.opera-cat-manage');
    if (catBtn) {
      catBtn.addEventListener('click', function(){ api.openCatManage(); }, true);
      try { catBtn.__superPatchBound = 1; catBtn.__deadBtnChecked = 1; } catch(_){}
    }
    var catClose1 = document.getElementById('catManageCloseBtn');
    if (catClose1) {
      catClose1.__ub = 1;
      catClose1.__superPatchBound = 1;
      catClose1.addEventListener('click', function(){ api.closeCatManage(); }, true);
    }
    var catClose2 = document.getElementById('catManageCancelBtn');
    if (catClose2) {
      catClose2.__ub = 1;
      catClose2.__superPatchBound = 1;
      catClose2.addEventListener('click', function(){ api.closeCatManage(); }, true);
    }
    var catModalEl = document.getElementById('catManageModal');
    if (catModalEl) {
      catModalEl.addEventListener('click', function(e){
        if (e.target === catModalEl) api.closeCatManage();
      });
    }
    var catAddBtn = document.getElementById('catAddBtn');
    if (catAddBtn) {
      catAddBtn.__superPatchBound = 1;
      catAddBtn.addEventListener('click', function(){ api.catCreate(); }, true);
    }
    var catNewName = document.getElementById('catNewName');
    if (catNewName) {
      catNewName.addEventListener('keydown', function(e){
        if (e.key === 'Enter') { try { e.preventDefault(); } catch(_){} api.catCreate(); }
      });
    }
    api._bindCatActions();
    api.syncCategorySources();
    var CAT_TO_GENRE = { 'all':'', 'traditional':'传统本戏', 'excerpt':'传统折子戏', 'folk':'民俗专场', 'modern':'现代戏' };
    document.querySelectorAll('.category-tab:not(.opera-cat-manage)').forEach(function(tab){
      tab.addEventListener('click', function(){
        var cat = tab.getAttribute('data-cat') || 'all';
        api.state.filter.genre = CAT_TO_GENRE[cat] || '';
        api.load();
      });
    });
    var searchInput = document.querySelector('[data-search]');
    if (searchInput) {
      var _timer = null;
      searchInput.addEventListener('input', function(){
        if (_timer) clearTimeout(_timer);
        _timer = setTimeout(function(){
          api.state.filter.keyword = (searchInput.value || '').trim();
          api.load();
        }, 300);
      });
    }
    api._bindRowDelegation();
    api.load();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootStrap);
  } else {
    setTimeout(_bootStrap, 200);
  }
})();

/* ===== operas.html inline block (run 3, #9/9) ===== */
(function(){
  function fillSel(){
    var sel=document.getElementById("operasAttachPlaySelect"); if(!sel||!window.QAXQJT_API) return;
    QAXQJT_API.get((QAXQJT_PATHS.PLAYS || '/v1/plays'),{query:{page:1,pageSize:500}}).then(function(resp){
      var rows=Array.isArray(resp)?resp:(resp&&(resp.items||resp.list||resp.rows))||[];
      /* P1修复:假成功已移除 —— 选项 value 由剧目标题改为真实剧目ID，
         供「上传剧照」成功后 PATCH /v1/plays/{id} 写入 posterUrl（对照 plays.js 的 b.posterUrl） */
      var html='<option value="">请选择关联剧目</option>';
      rows.forEach(function(p){ var pid=String(p.id||p.playCode||""); html+='<option value="'+pid+'">《'+(p.title||"")+'》- '+(p.genre||"未分类")+'</option>'; });
      sel.innerHTML=html;
    }).catch(function(){});
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",fillSel); else fillSel();
})();
