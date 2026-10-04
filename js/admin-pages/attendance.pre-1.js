/* attendance.pre-1.js — 从 admin/attendance.html 抽取的内联脚本（第 1/3 段，保持原执行位置） */

/* ===== attendance.html inline block (run 1, #1/2) ===== */
try{(function(){
    var K1="qaxqjt_admin_session", K2="qaxqjt_logout_blacklist", L="login.html";
    var p=String(location.pathname||"").split("/").pop().toLowerCase();
    if(p==="login.html"||p==="recover.html") return;
    var now=Date.now(), raw=null, s=null, bad=1;
    try{ raw=localStorage.getItem(K1); if(raw) s=JSON.parse(raw); }catch(_){}
    if(s && s.id && (!s.expiresAt || now < parseInt(s.expiresAt,10))){
      bad=0;
      try{ var bl=JSON.parse(localStorage.getItem(K2)||"[]"); for(var i=0;i<bl.length;i++){ if(bl[i] && bl[i].id===s.id){ bad=1; break; } } }catch(_){}
    }
    if(bad){
      ["qaxqjt_admin_session","admin_session","qaxqjt_admin_sess_v2","admin_sess_v2","qaxqjt_admin_remember","qaxqjt_admin_token","qaxqjt_admin_info","qaxqjt_admin_permissions","qaxqjt_auth_permissions_v1"].forEach(function(k){ try{ localStorage.removeItem(k); }catch(_){} });
      var u=location.href, i=u.lastIndexOf("/");
      var base= (i>=0)? u.substring(0,i+1) : "./";
      location.replace(base + L);
    }
  })();}catch(E){ try{ location.replace("login.html"); }catch(_){} }

/* ===== attendance.html inline block (run 1, #2/2) ===== */
(function() {
  var __ROLE_LEVEL = { super_admin:999, admin:999, ops:800, director:700, finance_checker:600, finance_cashier:520, finance_maker:550, finance_view:510, finance_admin:500, finance:500, staff:100 };
  function __getRoleLevel(role) { if (!role) return 0; return __ROLE_LEVEL[role] || 0; }
  function __applyRoleMenuFilter(session) {
    if (!session) return;
    var userLevel = __getRoleLevel(session.role);
    var items = document.querySelectorAll('.admin-sidebar-menu .admin-menu-item[data-role-level]');
    items.forEach(function(item) {
      var need = parseInt(item.getAttribute('data-role-level'), 10) || 0;
      if (userLevel < need) item.style.display = 'none';
    });
  }
  document.addEventListener('DOMContentLoaded', function() {
    try {
      var raw = localStorage.getItem('qaxqjt_admin_session');
      var sess = raw ? JSON.parse(raw) : null;
      __applyRoleMenuFilter(sess);
      // —— 页面级权限拦截：直接访问 URL 时检查角色，不足则跳首页 ——
      (function() {
        if (!sess) return;
        var userLvl = __getRoleLevel(sess.role);
        if (userLvl < 700) {
          location.replace('index.html');
        }
      })();
    } catch(e) {}
  });
})();
