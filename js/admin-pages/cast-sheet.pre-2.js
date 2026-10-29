/* cast-sheet.pre-2.js — 从 admin/cast-sheet.html 抽取的内联脚本（第 2/3 段，保持原执行位置） */

/* ===== cast-sheet.html inline block (run 2, #1/8) ===== */
(function(){
  var XLSX_CDNS = [
    '../js/xlsx.min.js',                                                                // ①本地（随部署包同步）
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',                  // ②jsdelivr
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',             // ③cdnjs 备用
    'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js'                              // ④unpkg 备用
  ];
  var _promise = null;
  function _ready(){ return !!(window.XLSX && window.XLSX.utils && window.XLSX.writeFile); }
  window.__castEnsureXlsx = function(){
    if (_ready()) return Promise.resolve(window.XLSX);          // 已载（含 app.js __qaEnsureXlsx 或他处）直接复用
    if (_promise) return _promise;                              // 并发去重
    _promise = new Promise(function(resolve, reject){
      var done = false, idx = 0;
      function next(){
        if (done || idx >= XLSX_CDNS.length){ reject(new Error('xlsx all paths failed')); return; }
        var s = document.createElement('script');
        s.src = XLSX_CDNS[idx++];
        s.onload = function(){
          if (_ready()){
            done = true;
            window.__XLSX_LOADED_FROM__ = s.src;
            if(typeof console!=='undefined') try{ console.info('[xlsx 0.18.5] loaded from: '+s.src); }catch(_){}
            resolve(window.XLSX);
          } else { next(); }
        };
        s.onerror = function(){ next(); };
        document.head.appendChild(s);
      }
      next();
    });
    _promise.catch(function(){ _promise = null; });            // 失败清缓存，允许下次重试
    return _promise;
  };
})();

/* ===== cast-sheet.html inline block (run 2, #2/8) ===== */
// === P0 修复：演出演员表（cast-sheet.html）缺少鉴权 ===
  // 原代码完全无鉴权，用户可直接在地址栏输入 /admin/cast-sheet.html 绕过登录页
  // 修复：在页面任何脚本初始化前，同步读 qaxqjt_admin_session，空或解析失败 → 跳登录页
  (function () {
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

/* ===== cast-sheet.html inline block (run 2, #8/8) ===== */
/* ========== 🔽 下拉菜单 Click 切换（兼容移动端） ========== */
(function(){
  if(window.__DD_CLICK_INJECTED__) return;
  window.__DD_CLICK_INJECTED__ = true;
  document.addEventListener('click', function(e){
    var btn = e.target.closest ? e.target.closest('.action-dropdown-btn') : null;
    var menu = e.target.closest ? e.target.closest('.action-dropdown-menu') : null;
    document.querySelectorAll('.action-dropdown-menu').forEach(function(m){
      if(m !== menu) m.style.display = 'none';
    });
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
