/* attendance.js — 从 admin/attendance.html 抽取的内联脚本（第 3/3 段，保持原执行位置） */

/* ===== attendance.html inline block (run 3, #1/4) ===== */
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
    try{ window.__T = __T; window.__L = __L; }catch(_){}
  })();
  
} /* end of 防重复注入保护 if */

/* ========== 🖥️ 全屏切换函数 ========== */
window.toggleFullscreen = function() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen && document.exitFullscreen();
  }
};

/* ===== attendance.html inline block (run 3, #2/4) ===== */
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
    /* v20260926 停用：原 SuperPatch 4/6 伪造分页栏（条数写死 100、翻页不切数据，
       且 MutationObserver 会把分页栏无限自嵌套）。工资条等列表真实分页统一由 /js/pagination.js 的 QinPagination 渲染 */
    (function(){
      try{
        document.querySelectorAll('.sp-pg-toolbar-20260730').forEach(function(b){ try{ b.remove(); }catch(_){} });
        document.querySelectorAll('div.pagination').forEach(function(d){
          if(!d.querySelector('.pagination-bar')){ try{ d.remove(); }catch(_){} }
        });
        if(window.QinPagination && QinPagination.refresh){ setTimeout(function(){ try{ QinPagination.refresh(); }catch(_){} }, 60); }
      }catch(_){}
    })();
    throw new Error('SP4/6 disabled v20260926: real pagination via QinPagination');
    // eslint-disable-next-line no-unreachable
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

  // ====== 无底薪工资（新版 v20260921：进页面/切月自动拉取 · 一键核算幂等覆盖 · 成功后以服务器数据重拉渲染） ======
  window.__lastWageItems = [];
  // ====== v20261003 P3-10 部门筛选接入：filterDept 此前无 JS 引用（摆设）；按花名册 employmentType 过滤工资表 ======
  window.__lastWageItemsRaw = [];
  var __perfDeptMap = null; // performerId -> employmentType（部门）；null=尚未加载
  async function __ensureDeptMap(){
    if(__perfDeptMap) return;
    var API = window.QAXQJT_API;
    if(!API || typeof API.get !== 'function'){ __perfDeptMap = {}; return; }
    try{
      var prows = await API.get((QAXQJT_PATHS.PERFORMERS || '/v1/performers')+'?pageSize=500');
      if(!Array.isArray(prows)) prows = (prows && prows.data) || [];
      __perfDeptMap = {};
      prows.forEach(function(p){ if(p && p.id) __perfDeptMap[p.id] = p.employmentType || ''; });
    }catch(e){ __perfDeptMap = {}; console.warn('[dept map] load failed', e); }
  }
  function __applyDeptFilter(items){
    var sel = document.getElementById('filterDept');
    var dept = sel ? sel.value : '';
    if(!dept || !__perfDeptMap) return items || [];
    return (items || []).filter(function(w){ return (__perfDeptMap[w.performerId] || '') === dept; });
  }
  function __fmtYuan(n){ return '¥' + (Number(n)||0).toLocaleString('zh-CN',{minimumFractionDigits:0,maximumFractionDigits:2}); }
  function __renderWageRows(items){
    window.__lastWageItems = items || [];
    var tbody = document.getElementById('wageTbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(!items || !items.length){
      tbody.innerHTML = '<tr><td colspan="19" style="text-align:center;padding:40px;color:var(--text-light);">暂无工资数据，点击「🧮 核算当月工资」生成</td></tr>';
      document.getElementById('wageCount').textContent = '0';
      ['tfCount','tfAttDays','tfNights','tfBase','tfFull','tfNightSub','tfLeave','tfAbsent','tfLate','tfEarly','tfSocial','tfTax','tfGross','tfNet'].forEach(function(id){ var el=document.getElementById(id); if(el) el.textContent = id==='tfCount'?'—':'¥0'; });
      return;
    }
    var sum={count:items.length,att:0,nights:0,base:0,full:0,night:0,leave:0,absent:0,late:0,early:0,social:0,tax:0,gross:0,net:0};
    var MODE_BADGE={monthly:['按月','#6d28d9','#ede9fe'],daily_prorated:['折算','#b45309','#fef3c7'],daily_pure:['日结','#0369a1','#e0f2fe']};
    items.forEach(function(w,i){
      sum.att += Number(w.attDays)||0;
      sum.nights += Number(w.nights)||0;
      sum.base += Number(w.baseSalary)||0;
      sum.full += Number(w.fullBonus)||0;
      sum.night += Number(w.nightSubsidy)||0;
      sum.leave += Number(w.leaveDeduction)||0;
      sum.absent += Number(w.absentDeduction)||0;
      sum.late += Number(w.lateDeduction)||0;
      sum.early += Number(w.earlyDeduction)||0;
      sum.social += Number(w.socialSecurity)||0;
      sum.tax += Number(w.tax)||0;
      sum.gross += Number(w.grossPay)||0;
      sum.net += Number(w.netPay)||0;
      var mb = MODE_BADGE[w.settleMode] || MODE_BADGE.daily_pure;
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="checkbox-cell no-print"><input type="checkbox" class="wage-row-cb" data-id="'+(w.id||'')+'" /></td>'+
        '<td>'+(i+1)+'</td>'+
        '<td><strong>'+(w.name||'')+'</strong><div style="font-size:0.75rem;color:var(--text-light);">'+(w.staffNo||'')+'</div></td>'+
        '<td>'+(w.rankGrade||'')+'</td>'+
        '<td><span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:.75rem;font-weight:600;color:'+mb[1]+';background:'+mb[2]+';white-space:nowrap;" title="结算模式">'+mb[0]+'</span></td>'+
        '<td class="num">'+(Number(w.attDays)||0)+'</td>'+
        '<td class="num">'+(Number(w.nights)||0)+'</td>'+
        '<td class="num">'+__fmtYuan(w.baseSalary)+'</td>'+
        '<td class="num add">'+__fmtYuan(w.fullBonus)+'</td>'+
        '<td class="num add">'+__fmtYuan(w.nightSubsidy)+'</td>'+
        '<td class="num deduct">'+__fmtYuan(w.leaveDeduction)+'</td>'+
        '<td class="num deduct">'+__fmtYuan(w.absentDeduction)+'</td>'+
        '<td class="num deduct">'+__fmtYuan(w.lateDeduction)+'</td>'+
        '<td class="num deduct">'+__fmtYuan(w.earlyDeduction)+'</td>'+
        '<td class="num deduct">'+__fmtYuan(w.socialSecurity)+'</td>'+
        '<td class="num deduct">'+__fmtYuan(w.tax)+'</td>'+
        '<td class="num">'+__fmtYuan(w.grossPay)+'</td>'+
        '<td class="num total-net"><strong>'+__fmtYuan(w.netPay)+'</strong></td>'+
        '<td class="no-print"><button class="btn btn-outline btn-sm" data-wdetail2="'+(w.id||'')+'">👁 明细</button></td>';
      tbody.appendChild(tr);
    });
    document.getElementById('wageCount').textContent = sum.count;
    var map={tfCount:sum.count,tfAttDays:sum.att,tfNights:sum.nights,tfBase:sum.base,tfFull:sum.full,tfNightSub:sum.night,tfLeave:sum.leave,tfAbsent:sum.absent,tfLate:sum.late,tfEarly:sum.early,tfSocial:sum.social,tfTax:sum.tax,tfGross:sum.gross,tfNet:sum.net};
    Object.keys(map).forEach(function(k){ var el=document.getElementById(k); if(el){ el.textContent = (k==='tfCount'||k==='tfAttDays'||k==='tfNights') ? map[k] : __fmtYuan(map[k]); } });
  }

  // ====== 新版一键核算天工资：__wageNs（load 进页面/切月拉 DB · generate 幂等覆盖后重拉） ======
  window.__wageNs = (function(){
    var loading = false, generating = false;
    function currentMonth(){
      var monthEl = document.getElementById('filterMonth');
      return (monthEl && monthEl.value) || new Date().toISOString().slice(0,7);
    }
    function setBadge(n){ var b=document.getElementById('tabWageBadge'); if(b) b.textContent = String(n); }

    // 从服务器重拉当月工资明细——页面唯一渲染数据源，保证与 DB 一致
    async function load(month){
      if(loading) return;
      month = month || currentMonth();
      loading = true;
      var API = window.QAXQJT_API;
      if(!API || typeof API.get !== 'function'){ loading = false; return; }
      try {
        var rows = await API.get((QAXQJT_PATHS.WAGES || '/v1/wages')+'?month=' + encodeURIComponent(month) + '&pageSize=500');
        if(!Array.isArray(rows)) rows = (rows && rows.data) || [];
        window.__lastWageItemsRaw = rows;
        await __ensureDeptMap(); // P3-10：部门筛选需要人员→部门映射
        var filtered = __applyDeptFilter(rows);
        __renderWageRows(filtered);
        setBadge(filtered.length);
      } catch(e){
        console.warn('[wage] load failed', e);
        __T('⚠️ 工资数据加载失败：' + ((e && e.message) || e),'error',4000);
      } finally { loading = false; }
    }

    // 一键核算：后端同月 draft 自动覆盖、confirmed/posted 拒绝；成功后必须 await load 重拉
    async function generate(){
      if(generating){ __T('⏳ 正在核算中，请勿重复点击','info',2500); return; }
      var month = currentMonth();
      var API = window.QAXQJT_API;
      if(!API || typeof API.post !== 'function'){ __T('⚠️ 接口未就绪','error'); return; }
      var btn = document.getElementById('attBtnCalcAll');
      var oldHtml = btn ? btn.innerHTML : '';
      generating = true;
      if(btn){ btn.disabled = true; btn.innerHTML = '⏳ 核算中...'; }
      try {
        // 结算模式 + 薪资参数随核算一并提交（v20261002 按天结算功能）；后端缺省按 daily_pure 旧口径
        var settleCfg = {}; try{ settleCfg = JSON.parse(localStorage.getItem('qaxqjt_settle_modes_v1')||'{}')||{}; }catch(_e){}
        var wageParams = {}; try{ wageParams = JSON.parse(localStorage.getItem('qaxqjt_wage_params_v1')||'{}')||{}; }catch(_e){}
        var body = {
          month: month,
          defaultMode: settleCfg.defaultMode || 'daily_pure',
          settleModes: settleCfg.overrides || {},
          monthlyParams: wageParams
        };
        var MODE_NAMES = {daily_pure:'按天·纯日结',daily_prorated:'按天·月薪折算',monthly:'按月结算'};
        var ovCount = Object.keys(body.settleModes).length;
        __T('🧮 正在核算 '+month+'（默认：'+(MODE_NAMES[body.defaultMode]||'按天·纯日结')+(ovCount?'，'+ovCount+' 人单独设置模式':'')+'）...','info',3000);
        var data = await API.post((QAXQJT_PATHS.WAGES_GENERATE || '/v1/wages/generate'), body);
        data = data || {};
        var s = data.summary || {};
        var cnt = s.totalPerformers || (data.items ? data.items.length : 0);
        var net = s.totalNetPay || 0;
        var replaced = data.replaced || [];
        var tip = replaced.length
          ? '🔁 '+month+' 已重新核算：覆盖草稿批次 '+replaced.map(function(r){return r.batchNo;}).join('、')+'，共 '+cnt+' 人，实发合计 '+__fmtYuan(net)
          : '✅ '+month+' 工资已生成：批次 '+((data.batch && data.batch.batchNo)||'')+'，共 '+cnt+' 人，实发合计 '+__fmtYuan(net);
        __T(tip,'success',6000);
        await load(month); // 成功后以服务器数据重拉，不直接用响应体渲染
      } catch(e){
        var msg = (e && e.message) ? e.message : String(e);
        __T('❌ 核算失败：'+msg,'error',7000);
      } finally {
        generating = false;
        if(btn){ btn.disabled = false; btn.innerHTML = oldHtml; }
      }
    }

    // 列出当月工资批次（用于确认/过账前定位批次）
    async function listBatches(month){
      month = month || currentMonth();
      var API = window.QAXQJT_API;
      if(!API) return [];
      try {
        var rows = await API.get((QAXQJT_PATHS.WAGE_BATCHES || '/v1/wage-batches')+'?month=' + encodeURIComponent(month) + '&pageSize=100');
        if(!Array.isArray(rows)) rows = (rows && rows.data) || [];
        return rows;
      } catch(e){ return []; }
    }

    // 确认批次：将 draft 批次状态推进为 confirmed（不可再被 generate 覆盖）
    async function confirmBatch(month){
      month = month || currentMonth();
      var API = window.QAXQJT_API;
      if(!API){ __T('⚠️ 接口未就绪','error'); return; }
      var batches = await listBatches(month);
      var draft = batches.filter(function(b){ return b.status === 'draft'; });
      if(!draft.length){ __T('⚠️ '+month+' 无草稿批次可确认（请先核算）','info'); return; }
      if(!confirm('确认将 '+month+' 的 '+draft.length+' 个草稿批次标记为「已确认」？\n确认后不可再被「核算」覆盖。')) return;
      var ok = 0, fail = 0;
      for(var i=0;i<draft.length;i++){
        try {
          await API.post((QAXQJT_PATHS.WAGE_BATCH_CONFIRM || function (i) { return '/v1/wage-batches/' + i + '/confirm'; })(draft[i].id), {});
          ok++;
        } catch(e){ fail++; }
      }
      __T((fail ? '⚠️ 部分确认失败' : '✅ 已确认')+'：成功 '+ok+' 个'+(fail?',失败 '+fail+' 个':''), fail?'error':'success',5000);
      await load(month);
    }

    // 过账批次：将 confirmed 批次过账（生成财务台账凭证，终态不可改）
    async function postBatch(month){
      month = month || currentMonth();
      var API = window.QAXQJT_API;
      if(!API){ __T('⚠️ 接口未就绪','error'); return; }
      var batches = await listBatches(month);
      var confirmed = batches.filter(function(b){ return b.status === 'confirmed'; });
      if(!confirmed.length){ __T('⚠️ '+month+' 无已确认批次可过账（请先「确认批次」）','info'); return; }
      if(!confirm('确认过账 '+month+' 的 '+confirmed.length+' 个批次？\n过账后将生成财务台账凭证，不可撤销。')) return;
      var ok = 0, fail = 0;
      for(var i=0;i<confirmed.length;i++){
        try {
          await API.post((QAXQJT_PATHS.WAGE_BATCH_POST || function (i) { return '/v1/wage-batches/' + i + '/post'; })(confirmed[i].id), {});
          ok++;
        } catch(e){ fail++; }
      }
      __T((fail ? '⚠️ 部分过账失败' : '✅ 已过账')+'：成功 '+ok+' 个'+(fail?',失败 '+fail+' 个':''), fail?'error':'success',6000);
      await load(month);
    }

    return { load: load, generate: generate, currentMonth: currentMonth, confirmBatch: confirmBatch, postBatch: postBatch, listBatches: listBatches };
  })();

  // ====== 考勤记录管理（v20261002b：批量录入 / 批量改类型 / 批量删除，走 /v1/attendance 真实接口） ======
  window.__attRecNs = (function(){
    var ATT_TYPES=[
      ['full','全天班'],['night','夜班'],['double','双班'],['half','半天班'],['rest','公休'],
      ['late','迟到(30分钟内)'],['late_over','迟到超30分钟'],['early','早退(30分钟内)'],['early_over','早退超30分钟'],['absent','旷工'],
      ['leave','请假(其他·无上限)'],['PL','事假(每月≤2次/2天)'],['SL','病假'],['AL','年假'],['ML','婚假'],['BL','丧假'],
      ['outing','外出'],['study','学习'],['business','出差'],['injury','工伤']
    ];
    var TYPE_NAMES={}; ATT_TYPES.forEach(function(t){ TYPE_NAMES[t[0]]=t[1]; });
    var _rows=[], _loading=false;
    function el(id){ return document.getElementById(id); }
    function API(){ return window.QAXQJT_API; }
    function currentMonth(){ var m=el('filterMonth'); return (m&&m.value)||new Date().toISOString().slice(0,7); }
    function setHint(msg,isErr){ var h=el('attRecHint'); if(h){ h.textContent=msg||''; h.style.color=isErr?'#dc3545':'var(--text-light)'; } }
    // 防全局捕获期拦截器（DBF/SuperPatch）接管：绑定即打全量标记（同 settleModeSaveBtn 模式）
    function bind(id,fn){
      var b=el(id); if(!b||b.__attRecBound) return;
      b.__attRecBound=1; b.__bindDone=1; b.__superPatchBound=1; b.__ts3Done=1; b.__deadBtnChecked=1;
      b.addEventListener('click',function(e){ e.preventDefault(); try{ fn(); }catch(err){ console.warn('[attRec]',err); } },true);
    }
    function updateSelCount(){
      var n=document.querySelectorAll('#attRecTbody .attRecCk:checked').length;
      ['attRecSelCount','attRecSelCount2'].forEach(function(id){ var s=el(id); if(s) s.textContent=String(n); });
    }
    function render(){
      var tbody=el('attRecTbody'); if(!tbody) return;
      var cnt=el('attRecCount'); if(cnt) cnt.textContent=String(_rows.length);
      updateSelCount();
      var all=el('attRecAll'); if(all) all.checked=false;
      if(!_rows.length){
        tbody.innerHTML='<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-light);">当月暂无考勤记录（可通过下方批量录入或 CSV 导入生成）</td></tr>';
        return;
      }
      tbody.innerHTML='';
      _rows.forEach(function(r){
        var tr=document.createElement('tr');
        tr.innerHTML=
          '<td><input type="checkbox" class="attRecCk" data-id="'+(r.id||'')+'" /></td>'+
          '<td>'+(r.date||'')+'</td>'+
          '<td><strong>'+((r.staffName||'')+'').replace(/</g,'&lt;')+'</strong></td>'+
          '<td>'+(r.typeText||TYPE_NAMES[r.type]||r.type||'')+'</td>'+
          '<td>'+((r.remark||'')+'').replace(/</g,'&lt;')+'</td>';
        tbody.appendChild(tr);
      });
    }
    function selectedIds(){
      var ids=[];
      document.querySelectorAll('#attRecTbody .attRecCk').forEach(function(c){ if(c.checked) ids.push(c.getAttribute('data-id')); });
      return ids;
    }
    async function load(month){
      month=month||currentMonth();
      var api=API(); var tbody=el('attRecTbody');
      if(!api||typeof api.get!=='function'){ if(tbody) tbody.innerHTML='<tr><td colspan="5" style="text-align:center;padding:24px;color:#dc3545;">接口未就绪，请刷新重试</td></tr>'; return; }
      if(_loading) return; _loading=true;
      var ml=el('attRecMonthLabel'); if(ml) ml.textContent=month;
      try{
        var rows=await api.get((QAXQJT_PATHS.ATTENDANCE || '/v1/attendance')+'?month='+encodeURIComponent(month)+'&pageSize=500');
        if(!Array.isArray(rows)) rows=(rows&&rows.data)||[];
        _rows=rows; render();
        setHint('共 '+rows.length+' 条记录；勾选后可批量修改类型或删除（批量删除仅超级管理员可用）');
      }catch(e){
        if(tbody) tbody.innerHTML='<tr><td colspan="5" style="text-align:center;padding:24px;color:#dc3545;">考勤记录载入失败：'+(((e&&e.message)||e)+'').replace(/</g,'&lt;')+'</td></tr>';
      }finally{ _loading=false; }
    }
    // 批量改类型：逐条 PATCH /v1/attendance/:id
    async function batchType(){
      var ids=selectedIds();
      var ntEl=el('attRecNewType'); var nt=ntEl?ntEl.value:'';
      if(!ids.length){ __T('⚠️ 请先勾选要修改的考勤记录','warning'); return; }
      if(!nt){ __T('⚠️ 请先选择目标考勤类型','warning'); return; }
      if(!confirm('将选中的 '+ids.length+' 条考勤记录类型改为「'+(TYPE_NAMES[nt]||nt)+'」？')) return;
      var api=API(); if(!api){ __T('⚠️ 接口未就绪','error'); return; }
      var ok=0,fail=0,lastErr='';
      for(var i=0;i<ids.length;i++){
        try{ await api.patch((QAXQJT_PATHS.ATTENDANCE_BY_ID || function (i) { return '/v1/attendance/' + i; })(ids[i]),{ type:nt }); ok++; }
        catch(e){ fail++; lastErr=(e&&e.message)||String(e); }
      }
      __T((fail?('⚠️ 部分修改失败（'+fail+' 条）'):'✅ 批量修改完成')+'：成功 '+ok+' 条'+(lastErr?('；最后错误：'+lastErr):''),fail?'error':'success',6000);
      await load();
    }
    // 批量删除：逐条 DELETE /v1/attendance/:id（后端仅 super_admin）
    async function batchDel(){
      var ids=selectedIds();
      if(!ids.length){ __T('⚠️ 请先勾选要删除的考勤记录','warning'); return; }
      if(!confirm('确认删除选中的 '+ids.length+' 条考勤记录？此操作不可撤销！')) return;
      var api=API(); if(!api){ __T('⚠️ 接口未就绪','error'); return; }
      var ok=0,fail=0,lastErr='';
      for(var i=0;i<ids.length;i++){
        try{ await api.del((QAXQJT_PATHS.ATTENDANCE_BY_ID || function (i) { return '/v1/attendance/' + i; })(ids[i])); ok++; }
        catch(e){ fail++; lastErr=(e&&e.message)||String(e); }
      }
      __T((fail?('⚠️ 部分删除失败（'+fail+' 条）'):'🗑️ 批量删除完成')+'：成功 '+ok+' 条'+(fail&&lastErr?('；'+lastErr):''),fail?'error':'success',6000);
      await load();
    }
    // 按人员+日期范围批量录入：逐日 POST /v1/attendance（跳过已有记录可选）
    async function batchAdd(){
      var api=API();
      if(!api||typeof api.post!=='function'){ __T('⚠️ 接口未就绪','error'); return; }
      var sEl=el('baStaff'); var sid=sEl?sEl.value:''; var sname=(sEl&&sEl.selectedOptions[0])?sEl.selectedOptions[0].textContent:'';
      var from=el('baDateFrom')?el('baDateFrom').value:''; var to=el('baDateTo')?el('baDateTo').value:'';
      var tEl=el('baType'); var type=tEl?tEl.value:'';
      var skipExist=el('baSkipExist')?el('baSkipExist').checked:true;
      if(!sid||!sname){ __T('⚠️ 请选择员工','warning'); return; }
      if(!from||!to){ __T('⚠️ 请选择开始/结束日期','warning'); return; }
      if(to<from){ __T('⚠️ 结束日期不能早于开始日期','warning'); return; }
      if(!type){ __T('⚠️ 请选择考勤类型','warning'); return; }
      var fd=new Date(from+'T00:00:00'), td=new Date(to+'T00:00:00');
      var days=Math.round((td-fd)/86400000)+1;
      if(!(days>0)||days>62){ __T('⚠️ 日期范围无效或过长（最长 62 天），请分段录入','warning'); return; }
      var exist={};
      if(skipExist){
        try{
          var months={}; months[from.substring(0,7)]=1; months[to.substring(0,7)]=1;
          for(var mk in months){
            if(!months.hasOwnProperty(mk)) continue;
            var er=await api.get((QAXQJT_PATHS.ATTENDANCE || '/v1/attendance')+'?staffId='+encodeURIComponent(sid)+'&month='+encodeURIComponent(mk)+'&pageSize=500');
            if(!Array.isArray(er)) er=(er&&er.data)||[];
            er.forEach(function(r){ if(r&&r.date) exist[r.date]=1; });
          }
        }catch(_e){}
      }
      if(!confirm('将为 '+sname+' 在 '+from+' ~ '+to+' 逐日录入「'+(TYPE_NAMES[type]||type)+'」共 '+days+' 天'+(skipExist?'（自动跳过已有记录）':'')+'，确认？')) return;
      var ok=0,skip=0,fail=0,lastErr='';
      for(var d=new Date(fd); d<=td; d.setDate(d.getDate()+1)){
        var ds=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        if(skipExist&&exist[ds]){ skip++; continue; }
        try{
          await api.post((QAXQJT_PATHS.ATTENDANCE || '/v1/attendance'),{ staffId:sid, staffName:sname, month:ds.substring(0,7), date:ds, type:type, approveStatus:'approved' });
          ok++;
        }catch(e){ fail++; lastErr=(e&&e.message)||String(e); }
      }
      __T('📅 批量录入完成：成功 '+ok+' 条'+(skip?('，跳过已有 '+skip+' 条'):'')+(fail?('，失败 '+fail+' 条'+(lastErr?('（'+lastErr+'）'):'')):''),fail?'error':'success',7000);
      await load();
    }
    async function loadStaff(){
      var api=API(); var sel=el('baStaff');
      if(!api||!sel) return;
      try{
        var rows=await api.get((QAXQJT_PATHS.PERFORMERS || '/v1/performers')+'?pageSize=500');
        if(!Array.isArray(rows)) rows=(rows&&rows.data)||[];
        rows=(rows||[]).filter(function(p){ return p&&p.status!=='deleted'; });
        rows.sort(function(a,b){ return String(a.staffNo||'').localeCompare(String(b.staffNo||''),'zh-CN')||String(a.name||'').localeCompare(String(b.name||''),'zh-CN'); });
        sel.innerHTML='<option value="">— 请选择员工 —</option>'+rows.map(function(p){
          return '<option value="'+(p.id||'')+'">'+((p.staffNo?p.staffNo+' ':'')+(p.name||'')).replace(/</g,'&lt;')+'</option>';
        }).join('');
      }catch(e){ sel.innerHTML='<option value="">人员载入失败，请点「↻ 刷新」重试</option>'; }
    }
    function init(){
      var opts=ATT_TYPES.map(function(t){ return '<option value="'+t[0]+'">'+t[1]+'</option>'; }).join('');
      var nt=el('attRecNewType'); if(nt) nt.innerHTML='<option value="">— 选择类型 —</option>'+opts;
      var bt=el('baType'); if(bt) bt.innerHTML=opts;
      bind('attRecReloadBtn',function(){ load(); });
      bind('attRecTypeBtn',function(){ batchType(); });
      bind('attRecDelBtn',function(){ batchDel(); });
      bind('baAddBtn',function(){ batchAdd(); });
      var all=el('attRecAll');
      if(all&&!all.__attRecBound){
        all.__attRecBound=1;
        all.addEventListener('change',function(){
          document.querySelectorAll('#attRecTbody .attRecCk').forEach(function(c){ c.checked=all.checked; });
          updateSelCount();
        });
      }
      var tbody=el('attRecTbody');
      if(tbody&&!tbody.__attRecBound){
        tbody.__attRecBound=1;
        tbody.addEventListener('change',function(e){
          if(e.target&&e.target.classList&&e.target.classList.contains('attRecCk')) updateSelCount();
        });
      }
      loadStaff();
      load();
    }
    return { load: load, init: init };
  })();
  try{ window.__attRecNs.init(); }catch(_e){ console.warn('[attRec init err]',_e); }

  // ====== 薪资参数 / 扣款规则引擎 / 打印历史：真实持久化实现（替代原 toast 占位绑定） ======
  (function(){
    var LS_PARAMS='qaxqjt_wage_params_v1';
    var LS_RULES='qaxqjt_deduct_rules_v1';
    var LS_HIST='qaxqjt_print_history_v1';
    var HIST_MAX=200;

    function readJSON(k,def){ try{ var v=localStorage.getItem(k); return v?JSON.parse(v):def; }catch(e){ return def; } }
    function writeJSON(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(e){ return false; } }
    function bindClick(id,fn){ var el=document.getElementById(id); if(el&&!el.__wxrBound){ el.__wxrBound=1; el.addEventListener('click',fn,false); } }
    function currentAdminName(){
      try{
        var s=JSON.parse(localStorage.getItem('qaxqjt_admin_session')||'null');
        if(s) return s.realName||s.name||s.username||s.account||s.loginName||'管理员';
      }catch(e){}
      return '管理员';
    }

    /* ================= 1. 薪资参数 ================= */
    var DEFAULT_PARAMS={ base:3800, fullBonus:200, nightSub:80, social:420, shouldWork:26,
      taxThreshold:5000, lateDeduct:30, earlyDeduct:30, absentMult:2, lateProgressive:1,
      // v20261002b 核算项开关（自定义结算选项）：true=启用 / false=停用，随核算提交后端生效
      enBase:true, enFullBonus:true, enNightSub:true, enLateDeduct:true, enEarlyDeduct:true,
      enAbsentDeduct:true, enLeaveDeduct:true, enSocial:true, enTax:true };
    var PARAM_FIELDS=[
      ['base','paramBase'],['fullBonus','paramFullBonus'],['nightSub','paramNightSub'],
      ['social','paramSocial'],['shouldWork','paramShouldWork'],['taxThreshold','paramTaxThreshold'],
      ['lateDeduct','paramLateDeduct'],['earlyDeduct','paramEarlyDeduct'],
      ['absentMult','paramAbsentMult'],['lateProgressive','paramLateProgressive']
    ];
    var TOGGLE_FIELDS=[ ['enBase','tgBase'],['enFullBonus','tgFullBonus'],['enNightSub','tgNightSub'],['enLateDeduct','tgLateDeduct'],
      ['enEarlyDeduct','tgEarlyDeduct'],['enAbsentDeduct','tgAbsentDeduct'],['enLeaveDeduct','tgLeaveDeduct'],
      ['enSocial','tgSocial'],['enTax','tgTax'] ];
    function getParams(){ var p=readJSON(LS_PARAMS,null); return Object.assign({},DEFAULT_PARAMS,p||{}); }
    function fillParams(p){
      PARAM_FIELDS.forEach(function(f){ var el=document.getElementById(f[1]); if(el) el.value=p[f[0]]; });
      TOGGLE_FIELDS.forEach(function(f){ var el=document.getElementById(f[1]); if(el) el.checked=p[f[0]]!==false; });
    }
    function initParams(){
      fillParams(getParams());
      bindClick('paramSaveBtn',function(){
        var p={};
        PARAM_FIELDS.forEach(function(f){
          var el=document.getElementById(f[1]);
          var v=el?parseFloat(el.value):NaN;
          if(!isFinite(v)||v<0) v=DEFAULT_PARAMS[f[0]];
          p[f[0]]=v;
        });
        TOGGLE_FIELDS.forEach(function(f){ var el=document.getElementById(f[1]); p[f[0]]=!!(el&&el.checked); });
        writeJSON(LS_PARAMS,p); fillParams(p);
        __T('💾 薪资参数与核算项开关已保存到本地（下次核算自动采用）','success');
      });
      bindClick('paramResetBtn',function(){
        var p=Object.assign({},DEFAULT_PARAMS);
        writeJSON(LS_PARAMS,p); fillParams(p);
        __T('↺ 已恢复默认薪资参数','info');
      });
    }

    /* ================= 1b. 按天结算·人员模式设置（v20261002） ================= */
    var LS_SETTLE='qaxqjt_settle_modes_v1';
    var SETTLE_MODES=[['daily_pure','按天·纯日结'],['daily_prorated','按天·月薪折算'],['monthly','按月结算']];
    var SETTLE_MODE_NAMES={daily_pure:'按天·纯日结',daily_prorated:'按天·月薪折算',monthly:'按月结算'};
    function getSettleCfg(){
      var c=readJSON(LS_SETTLE,null);
      if(!c||typeof c!=='object'||Array.isArray(c)) c={};
      if(SETTLE_MODES.every(function(m){return m[0]!==c.defaultMode;})) c.defaultMode='daily_pure';
      if(!c.overrides||typeof c.overrides!=='object'||Array.isArray(c.overrides)) c.overrides={};
      return c;
    }
    function setSettleHint(msg,isErr){
      var el=document.getElementById('settleModeHint');
      if(el){ el.textContent=msg||''; el.style.color=isErr?'#dc3545':'var(--text-light)'; }
    }
    function renderSettleRows(list){
      var tbody=document.getElementById('settleModeTbody');
      if(!tbody) return;
      var cfg=getSettleCfg();
      if(!list.length){
        tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-light);">花名册暂无在职人员</td></tr>';
        return;
      }
      tbody.innerHTML='';
      list.forEach(function(p,i){
        var ov=cfg.overrides[p.id]||'';
        var opts='<option value="">跟随默认</option>'+SETTLE_MODES.map(function(m){
          return '<option value="'+m[0]+'"'+(ov===m[0]?' selected':'')+'>'+m[1]+'</option>';
        }).join('');
        var tr=document.createElement('tr');
        tr.innerHTML=
          '<td>'+(i+1)+'</td>'+
          '<td><strong>'+(p.name||'')+'</strong></td>'+
          '<td>'+(p.staffNo||'—')+'</td>'+
          '<td>'+(p.rankGrade||'—')+'</td>'+
          '<td class="num">'+(Number(p.dailyRate)>0?__fmtYuan(p.dailyRate)+'/天':'—')+'</td>'+
          '<td><select class="form-control settle-mode-sel" data-pid="'+(p.id||'')+'" style="min-width:170px;">'+opts+'</select></td>';
        tbody.appendChild(tr);
      });
      setSettleHint('共 '+list.length+' 名在职人员；未单独设置者跟随全员默认（'+(SETTLE_MODE_NAMES[cfg.defaultMode]||'')+'）');
    }
    async function loadSettlePerformers(){
      var tbody=document.getElementById('settleModeTbody');
      var API=window.QAXQJT_API;
      if(!API||typeof API.get!=='function'){
        if(tbody) tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:24px;color:#dc3545;">接口未就绪，请点「↻ 重新载入人员」重试</td></tr>';
        return;
      }
      try{
        var rows=await API.get((QAXQJT_PATHS.PERFORMERS || '/v1/performers')+'?pageSize=500');
        if(!Array.isArray(rows)) rows=(rows&&rows.data)||[];
        rows=rows.filter(function(p){ return p && p.status!=='deleted'; });
        rows.sort(function(a,b){
          return String(a.staffNo||'').localeCompare(String(b.staffNo||''),'zh-CN')||String(a.name||'').localeCompare(String(b.name||''),'zh-CN');
        });
        renderSettleRows(rows);
      }catch(e){
        if(tbody) tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:24px;color:#dc3545;">人员载入失败：'+((e&&e.message)||e)+'</td></tr>';
      }
    }
    function initSettleModes(){
      var defSel=document.getElementById('settleDefaultMode');
      if(defSel) defSel.value=getSettleCfg().defaultMode;
      // 静态自定义按钮：补齐标记，防止全局捕获期拦截器接管
      ['settleModeSaveBtn','settleModeReloadBtn'].forEach(function(id){
        var el=document.getElementById(id);
        if(el){ el.__bindDone=1; el.__superPatchBound=1; el.__ts3Done=1; el.__deadBtnChecked=1; }
      });
      bindClick('settleModeSaveBtn',function(){
        var sel=document.getElementById('settleDefaultMode');
        var cfg={ defaultMode:(sel&&sel.value)||'daily_pure', overrides:{} };
        document.querySelectorAll('#settleModeTbody .settle-mode-sel').forEach(function(s){
          var pid=s.getAttribute('data-pid');
          if(pid&&s.value) cfg.overrides[pid]=s.value;
        });
        if(SETTLE_MODES.every(function(m){return m[0]!==cfg.defaultMode;})) cfg.defaultMode='daily_pure';
        writeJSON(LS_SETTLE,cfg);
        var ovCount=Object.keys(cfg.overrides).length;
        __T('💾 结算模式已保存（默认：'+(SETTLE_MODE_NAMES[cfg.defaultMode]||cfg.defaultMode)+(ovCount?'，'+ovCount+' 人单独设置':'')+'），下次核算生效','success',4000);
        setSettleHint('已保存 '+new Date().toLocaleTimeString('zh-CN',{hour12:false})+'；点击「🧮 核算当月工资」时自动采用');
      });
      bindClick('settleModeReloadBtn',function(){ loadSettlePerformers(); });
      loadSettlePerformers();
    }

    /* ================= 2. 扣款规则引擎 ================= */
    var COND_TYPES=[
      ['lateMin','迟到分钟'],['earlyMin','早退分钟'],['lateCnt','迟到次数'],['earlyCnt','早退次数'],
      ['absent','旷工天数'],['leave','事假天数'],['sick','病假天数'],['nights','夜场次数'],
      ['attDays','出勤天数'],['acc','事故次数']
    ];
    var ACTION_TYPES=[
      ['deductFixed','扣固定元'],['deductDaily','扣×日均底薪'],['deductPercent','扣%月薪'],
      ['addFixed','加固定元'],['addDaily','加×日均底薪']
    ];
    var SCOPES=[['all','全部人员'],['actor','演员'],['stage','舞美'],['admin','行政']];
    // 计次类指标：未勾“仅一次”时按出现次数累加
    var COUNT_METRICS={ lateCnt:1, earlyCnt:1, absent:1, leave:1, sick:1, nights:1, acc:1 };

    function defaultRules(){
      return [
        {priority:100,name:'全勤奖励',enabled:1,condType:'attDays',condMin:26,condMax:'',actionType:'addFixed',actionValue:200,once:1,scope:'all',dept:'',note:'出勤≥应出勤即奖'},
        {priority:90,name:'夜场补贴',enabled:1,condType:'nights',condMin:1,condMax:'',actionType:'addFixed',actionValue:80,once:0,scope:'all',dept:'',note:'每场80元'},
        {priority:80,name:'迟到扣款',enabled:1,condType:'lateCnt',condMin:1,condMax:'',actionType:'deductFixed',actionValue:30,once:0,scope:'all',dept:'',note:'每次30元'},
        {priority:70,name:'早退扣款',enabled:1,condType:'earlyCnt',condMin:1,condMax:'',actionType:'deductFixed',actionValue:30,once:0,scope:'all',dept:'',note:'每次30元'},
        {priority:60,name:'旷工扣款',enabled:1,condType:'absent',condMin:1,condMax:'',actionType:'deductDaily',actionValue:2,once:0,scope:'all',dept:'',note:'日均底薪×2/天'},
        {priority:50,name:'事假扣款',enabled:1,condType:'leave',condMin:1,condMax:'',actionType:'deductDaily',actionValue:1,once:0,scope:'all',dept:'',note:'日均底薪×1/天'},
        {priority:40,name:'病假扣款',enabled:1,condType:'sick',condMin:1,condMax:'',actionType:'deductDaily',actionValue:0.5,once:0,scope:'all',dept:'',note:'日均底薪×0.5/天'},
        {priority:30,name:'事故扣款',enabled:1,condType:'acc',condMin:1,condMax:'',actionType:'deductFixed',actionValue:200,once:0,scope:'all',dept:'',note:'每次200元'},
        {priority:20,name:'长时迟到加扣',enabled:1,condType:'lateMin',condMin:30,condMax:'',actionType:'deductFixed',actionValue:50,once:1,scope:'all',dept:'',note:'单月迟到累计≥30分钟'},
        {priority:10,name:'高频夜场激励',enabled:1,condType:'nights',condMin:10,condMax:'',actionType:'addFixed',actionValue:100,once:1,scope:'all',dept:'',note:'月夜场≥10场加100'}
      ];
    }
    function getRules(){ var r=readJSON(LS_RULES,null); return Array.isArray(r)&&r.length?r:defaultRules(); }

    function makeSelect(options,value){
      var sel=document.createElement('select');
      sel.className='form-control'; sel.style.cssText='padding:4px 6px;font-size:.8rem;min-width:0;';
      options.forEach(function(o){ var op=document.createElement('option'); op.value=o[0]; op.textContent=o[1]; if(String(o[0])===String(value)) op.selected=true; sel.appendChild(op); });
      return sel;
    }
    function makeInput(value,isNum){
      var inp=document.createElement('input');
      inp.type=isNum?'number':'text'; inp.className='form-control';
      inp.style.cssText='padding:4px 6px;font-size:.8rem;min-width:0;';
      inp.value=(value==null?'':value);
      return inp;
    }
    function appendCell(tr,el){ var td=document.createElement('td'); td.appendChild(el); tr.appendChild(td); return td; }

    function renderRules(rules){
      var tbody=document.getElementById('rulesTbody');
      if(!tbody) return;
      tbody.innerHTML='';
      rules.forEach(function(r){
        var tr=document.createElement('tr');
        appendCell(tr,makeInput(r.priority,true));
        appendCell(tr,makeInput(r.name,false));
        var en=document.createElement('input'); en.type='checkbox'; en.checked=String(r.enabled)==='1'; appendCell(tr,en);
        appendCell(tr,makeSelect(COND_TYPES,r.condType));
        appendCell(tr,makeInput(r.condMin,true));
        appendCell(tr,makeInput(r.condMax,true));
        appendCell(tr,makeSelect(ACTION_TYPES,r.actionType));
        appendCell(tr,makeInput(r.actionValue,true));
        var once=document.createElement('input'); once.type='checkbox'; once.checked=String(r.once)==='1'; appendCell(tr,once);
        appendCell(tr,makeSelect(SCOPES,r.scope));
        appendCell(tr,makeInput(r.dept,false));
        appendCell(tr,makeInput(r.note,false));
        var del=document.createElement('button'); del.className='btn btn-danger btn-sm'; del.textContent='🗑 删除';
        del.addEventListener('click',function(){ if(tr.parentNode) tr.parentNode.removeChild(tr); });
        appendCell(tr,del);
        tbody.appendChild(tr);
      });
    }
    function readRulesFromDom(){
      var tbody=document.getElementById('rulesTbody');
      var rows=[];
      tbody.querySelectorAll('tr').forEach(function(tr){
        var els=tr.querySelectorAll('input,select');
        // 顺序：priority,name,enabled,condType,min,max,actionType,value,once,scope,dept,note
        rows.push({
          priority:parseFloat(els[0].value)||0,
          name:els[1].value,
          enabled:els[2].checked?1:0,
          condType:els[3].value,
          condMin:els[4].value===''?'':parseFloat(els[4].value),
          condMax:els[5].value===''?'':parseFloat(els[5].value),
          actionType:els[6].value,
          actionValue:parseFloat(els[7].value)||0,
          once:els[8].checked?1:0,
          scope:els[9].value,
          dept:els[10].value,
          note:els[11].value
        });
      });
      rows.sort(function(a,b){ return b.priority-a.priority; });
      return rows;
    }

    // 引擎模拟（供测试面板，不改任何实际数据）
    function evalRules(rules,ctx){
      var daily=ctx.base/Math.max(1,ctx.swd);
      var lines=[]; var totalAdd=0,totalDeduct=0;
      rules.filter(function(r){ return String(r.enabled)==='1'; }).forEach(function(r){
        var metric=Number(ctx[r.condType])||0;
        var lo=r.condMin===''?-Infinity:Number(r.condMin);
        var hi=r.condMax===''?Infinity:Number(r.condMax);
        if(metric<lo||metric>hi) return;
        var hits=String(r.once)==='1'?1:(COUNT_METRICS[r.condType]?metric:1);
        var amt=0;
        if(r.actionType==='deductFixed'||r.actionType==='addFixed') amt=Number(r.actionValue)*hits;
        else if(r.actionType==='deductDaily'||r.actionType==='addDaily') amt=daily*Number(r.actionValue)*hits;
        else if(r.actionType==='deductPercent') amt=ctx.base*Number(r.actionValue)/100*hits;
        var isAdd=r.actionType.indexOf('add')===0;
        if(isAdd) totalAdd+=amt; else totalDeduct+=amt;
        lines.push((isAdd?'  [加]':'  [扣]')+'['+r.priority+'] '+r.name+'：指标='+metric+'，命中×'+hits+' → '+(isAdd?'+':'-')+'¥'+amt.toFixed(2));
      });
      return {lines:lines,add:totalAdd,deduct:totalDeduct};
    }

    function initRules(){
      renderRules(getRules());
      bindClick('ruleResetBtn',function(){
        if(!confirm('恢复为行业默认 10 条规则？当前未保存的修改将丢失。')) return;
        var r=defaultRules(); writeJSON(LS_RULES,r); renderRules(r);
        __T('↺ 已恢复行业默认 10 条规则','info');
      });
      bindClick('ruleAddBtn',function(){
        var rows=readRulesFromDom();
        var r={priority:(rows.length?rows[rows.length-1].priority:10)-10,name:'新规则',enabled:1,
          condType:'lateCnt',condMin:1,condMax:'',actionType:'deductFixed',actionValue:30,once:0,scope:'all',dept:'',note:''};
        rows.push(r); renderRules(rows);
        __T('➕ 已新增规则（编辑后请点「保存全部规则」）','info');
      });
      bindClick('ruleSaveBtn',function(){
        var rows=readRulesFromDom();
        if(writeJSON(LS_RULES,rows)){ renderRules(rows); __T('💾 全部规则已保存（共 '+rows.length+' 条）','success'); }
        else __T('❌ 保存失败：本地存储不可用','error');
      });
      bindClick('ruleTestBtn',function(){
        var p=document.getElementById('rulesTestPanel');
        if(p) p.style.display=(p.style.display==='none'?'block':'none');
      });
      bindClick('ruleRunTestBtn',function(){
        var ctx={
          lateMin:parseFloat(document.getElementById('rtLateMin').value)||0,
          lateCnt:parseFloat(document.getElementById('rtLateCnt').value)||0,
          earlyMin:parseFloat(document.getElementById('rtEarlyMin').value)||0,
          earlyCnt:parseFloat(document.getElementById('rtEarlyCnt').value)||0,
          absent:parseFloat(document.getElementById('rtAbsent').value)||0,
          leave:parseFloat(document.getElementById('rtLeave').value)||0,
          sick:parseFloat(document.getElementById('rtSick').value)||0,
          nights:parseFloat(document.getElementById('rtNights').value)||0,
          attDays:parseFloat(document.getElementById('rtAtt').value)||0,
          swd:parseFloat(document.getElementById('rtSwd').value)||26,
          acc:parseFloat(document.getElementById('rtAcc').value)||0,
          base:parseFloat(document.getElementById('rtBase').value)||0
        };
        var res=evalRules(readRulesFromDom(),ctx);
        var out='日均底薪 = ¥'+(ctx.base/Math.max(1,ctx.swd)).toFixed(2)+' / 天\n'+
          '命中规则 '+res.lines.length+' 条：\n'+(res.lines.join('\n')||'（无命中）')+
          '\n——————————————————\n加项合计 +¥'+res.add.toFixed(2)+
          '\n扣项合计 -¥'+res.deduct.toFixed(2)+
          '\n净影响 '+(res.add-res.deduct>=0?'+':'')+'¥'+(res.add-res.deduct).toFixed(2);
        var pre=document.getElementById('rulesTestResult');
        if(pre) pre.textContent=out;
      });
    }

    /* ================= 3. 打印历史 ================= */
    function getHistory(){ var h=readJSON(LS_HIST,[]); return Array.isArray(h)?h:[]; }
    function renderHistory(){
      var tbody=document.getElementById('historyTbody');
      var cnt=document.getElementById('historyCount');
      var h=getHistory();
      if(cnt) cnt.textContent=String(h.length);
      if(!tbody) return;
      tbody.innerHTML='';
      if(!h.length){
        tbody.innerHTML='<tr><td colspan="8" style="text-align:center;padding:60px 20px;color:var(--text-light);">暂无打印记录，点击「打印工资条」后会记录在此</td></tr>';
        return;
      }
      h.forEach(function(rec,i){
        var tr=document.createElement('tr');
        [h.length-i,new Date(rec.time).toLocaleString('zh-CN'),rec.month,rec.type,String(rec.count),rec.printer,
         (rec.ids||[]).slice(0,5).join('、')+((rec.ids&&rec.ids.length>5)?' 等':'')].forEach(function(v){
          var td=document.createElement('td'); td.textContent=v; tr.appendChild(td);
        });
        var td=document.createElement('td');
        var del=document.createElement('button'); del.className='btn btn-danger btn-sm'; del.textContent='🗑 删除';
        del.addEventListener('click',function(){
          writeJSON(LS_HIST,getHistory().filter(function(x){ return x.id!==rec.id; }));
          renderHistory();
        });
        td.appendChild(del); tr.appendChild(td);
        tbody.appendChild(tr);
      });
    }
    function addHistory(type,count,ids){
      var h=getHistory();
      h.unshift({ id:'prt_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
        time:new Date().toISOString(),
        month:(window.__wageNs&&window.__wageNs.currentMonth())||new Date().toISOString().slice(0,7),
        type:type, count:count, printer:currentAdminName(), ids:(ids||[]).slice(0,20) });
      while(h.length>HIST_MAX) h.pop();
      writeJSON(LS_HIST,h);
      renderHistory();
    }
    function initHistory(){
      renderHistory();
      bindClick('historyClearBtn',function(){
        if(!getHistory().length){ __T('⚠️ 暂无历史可清空','info'); return; }
        if(!confirm('确认清空全部打印历史？此操作不可恢复。')) return;
        writeJSON(LS_HIST,[]); renderHistory();
        __T('🗑️ 打印历史已清空','success');
      });
      // 打印按钮：移除原内联 onclick，统一“校验 → 记录历史 → 打印”
      ['attBtnBatchPrint','attBtnPrintSelected'].forEach(function(id){
        var el=document.getElementById(id);
        if(el) el.removeAttribute('onclick');
      });
      bindClick('attBtnBatchPrint',function(){
        var items=window.__lastWageItems||[];
        if(!items.length){ __T('⚠️ 请先核算当月工资再打印','warning'); return; }
        addHistory('批量打印',items.length,items.map(function(w){ return w.wageNo||w.id||''; }));
        window.print();
      });
      bindClick('attBtnPrintSelected',function(){
        var cbs=document.querySelectorAll('.wage-row-cb:checked');
        if(!cbs.length){ __T('⚠️ 请先勾选要打印的工资条','warning'); return; }
        var ids=[].map.call(cbs,function(c){ return c.getAttribute('data-id'); });
        addHistory('打印已选',cbs.length,ids);
        window.print();
      });
    }

    function init(){
      try{ initParams(); }catch(e){ console.warn('[wxr params init]',e); }
      try{ initSettleModes(); }catch(e){ console.warn('[wxr settle modes init]',e); }
      try{ initRules(); }catch(e){ console.warn('[wxr rules init]',e); }
      try{ initHistory(); }catch(e){ console.warn('[wxr history init]',e); }
    }
    // 本脚本位于页面末尾，引用元素均已解析；同时保留 DOMContentLoaded 兜底
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
    else init();
  })();

  // 初始化月份为当前月 + 首次进入自动加载已有工资
  try{
    var mEl=document.getElementById('filterMonth');
    if(mEl&&!mEl.value) mEl.value=new Date().toISOString().slice(0,7);
  }catch(_e){}
  try{ window.__wageNs.load(); }catch(_e){}

  // 5 个内部 Tab 切换（原页面只有样式无切换逻辑）；切回工资条列表时按当前月份重拉
  try{
    var __TAB_PANE = { wage:'tabWage', upload:'tabUpload', params:'tabParams', rules:'tabRules', history:'tabHistory' };
    document.querySelectorAll('#attTabs .att-tab').forEach(function(tab){
      if(tab.__wageTabBound) return;
      tab.__wageTabBound = 1;
      tab.addEventListener('click', function(){
        var key = tab.getAttribute('data-tab');
        document.querySelectorAll('#attTabs .att-tab').forEach(function(x){ x.classList.toggle('active', x===tab); });
        Object.keys(__TAB_PANE).forEach(function(k){
          var pane = document.getElementById(__TAB_PANE[k]);
          if(pane) pane.classList.toggle('active', k===key);
        });
        if(key==='wage'){ try{ window.__wageNs.load(); }catch(_){} }
        if(key==='upload'){ if(window.__attRecNs){ try{ window.__attRecNs.load(); }catch(_){} } }
      }, true);
    });
    // 月份切换 → 立即重拉该月工资
    var __fMonth = document.getElementById('filterMonth');
    if(__fMonth && !__fMonth.__wageMonthBound){
      __fMonth.__wageMonthBound = 1;
      __fMonth.addEventListener('change', function(){
        window.__wageNs.load(__fMonth.value);
        if(window.__attRecNs){ try{ window.__attRecNs.load(__fMonth.value); }catch(_){} }
      }, true);
    }
    // P3-10：部门筛选下拉 change → 仅前端过滤已加载的工资条，避免重拉后端
    var __fDept = document.getElementById('filterDept');
    if(__fDept && !__fDept.__wageDeptBound){
      __fDept.__wageDeptBound = 1;
      __fDept.addEventListener('change', function(){
        var items = window.__lastWageItemsRaw || [];
        var filtered = __applyDeptFilter(items);
        __renderWageRows(filtered);
        var b = document.getElementById('tabWageBadge'); if(b) b.textContent = String(filtered.length);
      }, true);
    }
  }catch(_tabErr){ console.warn('[wage] tab bind err', _tabErr); }

  // 考勤功能按钮绑定
  try{
    function __attBind(id, fn){ var el=document.getElementById(id); if(el&&!el.__attBound){ el.__attBound=1; el.addEventListener('click', fn, true); } }
    __attBind('attBtnSelectAll', function(){
      var cbs=document.querySelectorAll('.admin-table tbody input[type="checkbox"], #chkAllHeader');
      var allChecked=[].every.call(cbs,function(c){return c.checked;});
      cbs.forEach(function(c){ c.checked=!allChecked; });
      __T((!allChecked?'☑️ 已全选本页':'☐ 已取消全选'), 'success');
    });
    __attBind('attBtnFilterReset', function(){
      document.querySelectorAll('.admin-filter-bar select, .admin-filter-bar input[type="text"], .admin-filter-bar input[type="date"]').forEach(function(el){ el.value=''; });
      __T('↺ 已重置筛选条件', 'info');
    });
    __attBind('attBtnDemoCsv', function(){
      var csv='工号,姓名,日期,状态,工时,备注\nPF001,张三,2026-10-01,出勤,8,\nPF002,李四,2026-10-01,事假,0,家中有事\nPF001,张三,2026-10-02,夜班,8,\n';
      var blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
      var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='考勤示例.csv'; a.click();
      __T('📥 示例 CSV 已下载', 'success');
    });
    __attBind('attBtnUploadCsv', function(){
      if(window.__attImportNs && window.__attImportNs.open) window.__attImportNs.open();
    });
    __attBind('attBtnCalcAll', function(){ window.__wageNs.generate(); });
    __attBind('attBtnBatchConfirm', function(){ window.__wageNs.confirmBatch(); });
    __attBind('attBtnBatchPost', function(){ window.__wageNs.postBatch(); });
    __attBind('attBtnExportCsv', function(){
      var items = window.__lastWageItems || [];
      if(!items.length){ __T('⚠️ 请先核算当月工资再导出','warning'); return; }
      var header = ['工号','姓名','职级','出勤天数','夜场数','底薪','全勤奖','夜场补','事假扣','旷工扣','迟到扣','早退扣','社保','个税','应发','实发'];
      var lines = [header.join(',')];
      items.forEach(function(w){
        lines.push([w.staffNo,w.name,w.rankGrade,w.attDays,w.nights,w.baseSalary,w.fullBonus,w.nightSubsidy,w.leaveDeduction,w.absentDeduction,w.lateDeduction,w.earlyDeduction,w.socialSecurity,w.tax,w.grossPay,w.netPay].map(function(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';}).join(','));
      });
      var blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
      var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='工资表_'+new Date().toISOString().slice(0,7)+'.csv'; a.click();
      __T('📊 工资表 CSV 已导出（'+items.length+' 条）','success');
    });
    /* P1修复:假成功已移除 —— 后端无「推送财务台账/财务待发」端点（wage-batches/:id/post 需批次ID，
       已由上方 attBtnBatchPost → __wageNs.postBatch 真实承接），此处改为诚实提示 */
    __attBind('attBtnFinanceAll', function(){ console.warn('[P1] 未接线按钮: 整月工资推送财务台账'); __T('该功能暂未接入后端','warning'); });
    __attBind('attBtnFinanceSel', function(){
      var sel=document.querySelectorAll('.admin-table tbody input[type="checkbox"]:checked').length;
      if(!sel){ __T('⚠️ 请先勾选要推送的记录','warning'); return; }
      console.warn('[P1] 未接线按钮: 选中记录推送财务待发（'+sel+' 条）'); __T('该功能暂未接入后端','warning');
    });
    // v20261004a：考勤批量导入已真实接入 POST /v1/attendance/import（原 P1 诚实下线解除，实现见下方 __attImportNs 模块）
    __attBind('previewCancelBtn', function(){ if(window.__attImportNs&&window.__attImportNs.clear) window.__attImportNs.clear(); });
    __attBind('previewConfirmBtn', function(){ if(window.__attImportNs&&window.__attImportNs.submit) window.__attImportNs.submit(); });
    __attBind('manualAddBtn', function(){ console.warn('[P1] 未接线按钮: 人工补录考勤'); __T('该功能暂未接入后端','warning'); });
    // 导入按钮补齐全量防拦截标记（既有契约：__bindDone/__superPatchBound/__ts3Done/__deadBtnChecked）
    ['attBtnUploadCsv','previewCancelBtn','previewConfirmBtn'].forEach(function(id){
      var b=document.getElementById(id);
      if(b){ b.__bindDone=1; b.__superPatchBound=1; b.__ts3Done=1; b.__deadBtnChecked=1; }
    });
    // 注：薪资参数 / 扣款规则引擎 / 打印历史相关按钮已由上方真实持久化模块绑定，此处不再占位
  }catch(_e){ console.warn('[att-bind err]',_e); }

  // ====== 考勤批量导入（v20261004a：真实接入 POST /v1/attendance/import）======
  // 流程：打开弹窗（粘贴 CSV/制表符 或 选择 .csv）→ 解析预览前 20 条 → 确认导入 → toast 真实结果并刷新列表
  window.__attImportNs = (function(){
    var TYPE_ALIAS = { '出勤':'full','全天班':'full','全天':'full','正常':'full','夜班':'night','双班':'double','半天班':'half','半天':'half','公休':'rest','休息':'rest','雨休':'rainout','事假':'PL','病假':'SL','丧假':'BL','婚假':'ML','年假':'AL','迟到':'late','迟到超30分钟':'late_over','早退':'early','早退超30分钟':'early_over','旷工':'absent','缺勤':'absent','请假':'leave','外出':'outing','学习':'study','出差':'business','工伤':'injury' };
    var TYPE_NAMES = { full:'全天班', night:'夜班', double:'双班', half:'半天班', rest:'公休', SL:'病假', PL:'事假', BL:'丧假', ML:'婚假', AL:'年假', absent:'旷工', rainout:'雨休', leave:'请假', late:'迟到', late_over:'迟到超30分钟', early:'早退', early_over:'早退超30分钟', outing:'外出', study:'学习', business:'出差', injury:'工伤' };
    var HEAD = {
      no: ['工号','编号','工牌','演员编号','工牌号'],
      name: ['姓名','名字'],
      date: ['日期','考勤日期'],
      status: ['状态','考勤状态','类型','考勤类型','请假类型'],
      hours: ['工时','小时','工作时长'],
      remark: ['备注','说明']
    };
    var _parsed = [];
    var _submitting = false;
    function el(id){ return document.getElementById(id); }
    function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    // 引号感知的 CSV/制表符分列
    function splitLine(line, delim){
      var out=[], cur='', q=false;
      for(var i=0;i<line.length;i++){
        var ch=line.charAt(i);
        if(q){
          if(ch==='"'){ if(line.charAt(i+1)==='"'){ cur+='"'; i++; } else q=false; }
          else cur+=ch;
        }else if(ch==='"'){ q=true; }
        else if(ch===delim){ out.push(cur); cur=''; }
        else cur+=ch;
      }
      out.push(cur);
      return out.map(function(s){ return s.trim(); });
    }
    // 表头模糊匹配：前 3 行内找到「日期 + (工号|姓名|状态)」即认定表头行
    function detectMap(cells){
      var m={};
      Object.keys(HEAD).forEach(function(k){
        for(var i=0;i<cells.length;i++){
          for(var j=0;j<HEAD[k].length;j++){
            if(cells[i].indexOf(HEAD[k][j])>=0){ if(m[k]===undefined) m[k]=i; break; }
          }
          if(m[k]!==undefined) break;
        }
      });
      return (m.date!==undefined && (m.no!==undefined || m.name!==undefined || m.status!==undefined)) ? m : null;
    }
    function parseText(text){
      var lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(function(l){ return l.trim().length; });
      if(!lines.length) return [];
      var delim = lines[0].indexOf('\t')>=0 ? '\t' : ',';
      var headerIdx=-1, map=null;
      for(var h=0; h<Math.min(lines.length,3); h++){
        var dm=detectMap(splitLine(lines[h], delim));
        if(dm){ headerIdx=h; map=dm; break; }
      }
      if(!map){ map={ no:0, name:1, date:2, status:3, hours:4, remark:5 }; headerIdx=-1; } // 无表头按列序兜底：工号,姓名,日期,状态,工时,备注
      var items=[];
      for(var i=headerIdx+1; i<lines.length; i++){
        var c=splitLine(lines[i], delim);
        var g=function(k){ return map[k]!==undefined && c[map[k]]!==undefined ? String(c[map[k]]).trim() : ''; };
        var no=g('no'), name=g('name'), date=g('date'), st=g('status'), hs=g('hours'), rk=g('remark');
        if(!no && !name && !date) continue; // 空行
        var t = TYPE_ALIAS[st] || st;
        var ok=true, why='';
        if(!no && !name){ ok=false; why='缺工号/姓名'; }
        else if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ ok=false; why='日期需 YYYY-MM-DD'; }
        else if(!t){ ok=false; why='缺状态'; }
        else if(!TYPE_NAMES[t]){ ok=false; why='未知状态: '+st; }
        var hours='';
        if(hs!==''){ var n=Number(hs); if(!isFinite(n)||n<0||n>24){ ok=false; why='工时非法(0-24): '+hs; } else hours=n; }
        var it={ workDate: date, status: t, remark: rk, hours: hours, __ok: ok, __why: why, __no: no, __name: name, __typeText: TYPE_NAMES[t]||st };
        if(no) it.performerNo=no;
        if(name) it.performerName=name;
        items.push(it);
      }
      return items;
    }
    function modalBody(){
      return '<div class="param-item"><label>① 粘贴 CSV / 制表符文本（首行为表头；也可直接粘贴数据行，按 工号,姓名,日期,状态,工时,备注 列序解析）</label>'+
        '<textarea id="attImportPaste" class="form-control" rows="7" placeholder="工号,姓名,日期,状态,工时,备注&#10;PF001,张三,2026-10-01,出勤,8,&#10;PF002,李四,2026-10-01,事假,0,家中有事"></textarea></div>'+
        '<div class="param-item" style="margin-top:10px;"><label>② 或选择 .csv 文件（读取后自动填入上方文本框）</label>'+
        '<input type="file" id="attImportFile" accept=".csv,text/csv" class="form-control" /></div>'+
        '<div style="margin-top:8px;font-size:.78rem;color:var(--text-light);">表头模糊匹配列：工号/编号、姓名、日期、状态、工时、备注；日期 YYYY-MM-DD；状态可用中文（出勤/夜班/公休/事假/病假/迟到/早退/旷工/请假…）或编码（full/PL/SL/late…）。单次上限 500 条；同人同日已有记录自动跳过（不覆盖）。</div>';
    }
    function bindFileInput(){
      var f=el('attImportFile');
      if(!f||f.__attImportBound) return;
      f.__attImportBound=1;
      f.addEventListener('change', function(){
        var file=f.files&&f.files[0];
        if(!file) return;
        var fr=new FileReader();
        fr.onload=function(){
          var ta=el('attImportPaste');
          if(ta) ta.value=String(fr.result||'').replace(/^\uFEFF/,'');
          __T('📄 已读取 '+file.name+'，点击「解析预览」继续','info');
        };
        fr.onerror=function(){ __T('❌ 文件读取失败','error'); };
        fr.readAsText(file,'utf-8');
      });
    }
    function open(){
      var U=window.QinApp&&window.QinApp.Utils;
      if(!U||typeof U.injectOrReuseModal!=='function'){ __T('⚠️ 页面弹窗组件未就绪，请刷新重试','error'); return; }
      U.injectOrReuseModal({
        id: 'attImport',
        title: '考勤批量导入',
        icon: '📥',
        width: 880,
        showConfirm: true, confirmText: '🔍 解析预览',
        showCancel: true, cancelText: '关闭',
        body: modalBody(),
        onConfirm: function(){
          var ta=el('attImportPaste');
          var items=parseText(ta?ta.value:'');
          if(!items.length){ __T('⚠️ 未解析到有效数据行（请检查表头/分隔符）','warning'); return false; }
          renderPreview(items);
          return true; // 解析成功后关闭弹窗，进入预览
        },
        onCancel: function(){}
      });
      bindFileInput();
    }
    function renderPreview(items){
      _parsed=items;
      var card=el('previewCard'), tbody=el('previewTbody');
      if(!card||!tbody){ __T('⚠️ 预览区缺失，请刷新页面','error'); return; }
      var cnt=el('previewCount'), mon=el('previewMonth');
      if(cnt) cnt.textContent=String(items.length);
      var months={};
      items.forEach(function(it){ if(/^\d{4}-\d{2}/.test(it.workDate||'')) months[(it.workDate||'').substring(0,7)]=1; });
      if(mon) mon.textContent=Object.keys(months).sort().join(', ')||'—';
      tbody.innerHTML='';
      items.slice(0,20).forEach(function(it,i){
        var tr=document.createElement('tr');
        tr.innerHTML=
          '<td>'+(i+1)+'</td>'+
          '<td>'+esc(it.__no)+'</td>'+
          '<td>'+esc(it.__name)+'</td>'+
          '<td>'+esc(it.workDate)+'</td>'+
          '<td>'+esc(it.__typeText)+'</td>'+
          '<td class="num">'+(it.hours===''?'—':esc(it.hours))+'</td>'+
          '<td>'+esc(it.remark||'')+'</td>'+
          '<td>'+(it.__ok?'<span style="color:#198754;font-weight:600;">✓</span>':'<span style="color:#dc3545;">✗ '+esc(it.__why)+'</span>')+'</td>';
        tbody.appendChild(tr);
      });
      card.style.display='';
      var bad=items.filter(function(it){ return !it.__ok; }).length;
      __T(bad ? ('⚠️ 解析完成：共 '+items.length+' 条，其中 '+bad+' 条有问题（导入时将计入失败）') : ('✅ 解析完成：共 '+items.length+' 条，点击「确认导入入库」提交'), bad ? 'warning' : 'success', 6000);
      try{ card.scrollIntoView({ behavior:'smooth', block:'nearest' }); }catch(_){}
    }
    function clearAll(){
      _parsed=[];
      var card=el('previewCard'), tbody=el('previewTbody'), ta=el('attImportPaste');
      if(tbody) tbody.innerHTML='';
      if(card) card.style.display='none';
      var cnt=el('previewCount'); if(cnt) cnt.textContent='0';
      var mon=el('previewMonth'); if(mon) mon.textContent='—';
      if(ta) ta.value='';
    }
    async function submit(){
      if(_submitting) return;
      if(!_parsed.length){ __T('⚠️ 请先解析预览 CSV 数据','warning'); return; }
      var api=window.QAXQJT_API;
      if(!api||typeof api.post!=='function'){ __T('⚠️ 接口未就绪','error'); return; }
      if(_parsed.length>500){ __T('⚠️ 单次最多导入 500 条（当前 '+_parsed.length+' 条），请分批提交','warning'); return; }
      var items=_parsed.map(function(it){
        var o={ workDate: it.workDate, status: it.status };
        if(it.performerNo) o.performerNo=it.performerNo;
        if(it.performerName) o.performerName=it.performerName;
        if(it.hours!==''&&it.hours!==undefined) o.hours=it.hours;
        if(it.remark) o.remark=it.remark;
        return o;
      });
      var btn=el('previewConfirmBtn');
      _submitting=true;
      if(btn){ btn.disabled=true; btn.textContent='⏳ 导入中…'; }
      try{
        var res=await api.post((QAXQJT_PATHS.ATTENDANCE_IMPORT || '/v1/attendance/import'),{ items: items });
        var r=(res&&res.data)?res.data:(res||{});
        var created=r.created||0, skipped=r.skipped||0;
        var failed=Array.isArray(r.failed)?r.failed:[];
        __T('📥 导入完成：成功 '+created+' 条，跳过 '+skipped+' 条，失败 '+failed.length+' 条', failed.length?'warning':'success', 7000);
        failed.forEach(function(f){ console.warn('[attImport] 失败 #'+(f.index!==undefined?f.index:'?')+': '+(f.reason||'')); });
        if(skipped) console.info('[attImport] 跳过 '+skipped+' 条（同人同日已有记录）');
        clearAll();
        if(window.__attRecNs&&typeof window.__attRecNs.load==='function'){ try{ window.__attRecNs.load(); }catch(_e){} }
      }catch(e){
        __T('❌ 导入失败：'+((e&&e.message)||e), 'error', 6000);
      }finally{
        _submitting=false;
        if(btn){ btn.disabled=false; btn.textContent='💾 确认导入入库'; }
      }
    }
    return { open: open, submit: submit, clear: clearAll };
  })();
  // 上传区点击 = 打开导入面板（补防拦截标记）
  (function(){
    var zone=document.getElementById('uploadZone');
    if(zone&&!zone.__attImportBound){
      zone.__attImportBound=1; zone.__bindDone=1; zone.__superPatchBound=1; zone.__ts3Done=1; zone.__deadBtnChecked=1;
      zone.addEventListener('click', function(e){ e.preventDefault(); if(window.__attImportNs) window.__attImportNs.open(); });
    }
  })();

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

/* ===== attendance.html inline block (run 3, #3/4) ===== */
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

/* ===== attendance.html inline block (run 3, #4/4) ===== */
/* 按钮防拦截：为有id的可点击元素预设 __superPatchBound，避免 SuperPatch 首次点击拦截 */
(function(){
  function __markBound(){
    var els=document.querySelectorAll('button[id], a[id], [data-action][id], .btn[id], .btn-action[id]');
    for(var i=0;i<els.length;i++){ var el=els[i]; if(!el.__superPatchBound){ el.__superPatchBound=1; } }
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',__markBound); }
  else { __markBound(); setTimeout(__markBound,500); }
})();
