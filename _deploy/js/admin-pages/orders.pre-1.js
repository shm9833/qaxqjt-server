/* orders.pre-1.js — 从 admin/orders.html 抽取的内联脚本（第 1/4 段，保持原执行位置） */

/* ===== orders.html inline block (run 1, #1/2) ===== */
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

/* ===== orders.html inline block (run 1, #2/2) ===== */
window.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('button[data-act],[data-real-bound]');if(!b)return;if(!b.__superPatchBound)b.__superPatchBound=1;if(!b.__ts3Done)b.__ts3Done=1;if(!b.__bindDone)b.__bindDone=1;if(!b.__ctE2Done)b.__ctE2Done=1;if(!b.__deadBtnChecked)b.__deadBtnChecked=1;},true);
