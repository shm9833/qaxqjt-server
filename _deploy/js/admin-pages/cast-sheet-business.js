/* ===== cast-sheet.html inline block (run 2, #7/8) ===== */
(function(){
  'use strict';
  function $(id){ return document.getElementById(id); }
  function toast(msg,type,ms){
    var t=document.createElement('div');
    t.style.cssText='position:fixed;top:20px;right:20px;z-index:99999;padding:12px 24px;border-radius:8px;color:#fff;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);background:'+(type==='error'?'#dc3545':type==='success'?'#28a745':type==='warning'?'#ffc107':'#17a2b8');
    t.textContent=msg;
    document.body.appendChild(t);
    setTimeout(function(){ t.remove(); },ms||3000);
  }
  var LS_KEY='qaxqjt_cast_sheet_v3';
  var LS_SHEETS='qaxqjt_cast_sheets_v1';
  var LS_TROUPE='qaxqjt_troupe_template_v1';
  function getSheets(){ try{ var r=localStorage.getItem(LS_SHEETS); return r?JSON.parse(r):[]; }catch(_){ return []; } }
  function saveSheets(a){ try{ localStorage.setItem(LS_SHEETS,JSON.stringify(a)); }catch(_){} }
  function getCurId(){ try{ return localStorage.getItem('qaxqjt_cast_current_sheet')||'default'; }catch(_){ return 'default'; } }
  function setCurId(id){ try{ localStorage.setItem('qaxqjt_cast_current_sheet',id); }catch(_){} }
  function refreshSheetSelect(){
    var sel=$('csSheetSelect'); if(!sel) return;
    var sheets=getSheets(); var curId=getCurId();
    sel.innerHTML='';
    if(sheets.length===0){ sel.innerHTML='<option value="default">默认存档</option>'; var info=$('csSheetInfo'); if(info) info.textContent='默认存档'; return; }
    for(var i=0;i<sheets.length;i++){ var o=document.createElement('option'); o.value=sheets[i].id; o.textContent=sheets[i].name||('存档'+(i+1)); if(sheets[i].id===curId) o.selected=true; sel.appendChild(o); }
    var info2=$('csSheetInfo'); if(info2){ var cur=sheets.filter(function(s){return s.id===curId;})[0]; info2.textContent=cur?('当前：'+cur.name):'默认存档'; }
  }
  function newSheet(){
    var name=prompt('请输入新演出名称：','新建演出'+(getSheets().length+1)); if(!name) return;
    var id='sheet_'+Date.now(); var sheets=getSheets(); sheets.push({id:id,name:name,ts:Date.now()}); saveSheets(sheets); setCurId(id);
    try{ localStorage.removeItem(LS_KEY); }catch(_){}
    refreshSheetSelect(); toast('✅ 已创建：'+name+'，请编辑后点击保存','success',3000); setTimeout(function(){ location.reload(); },1000);
  }
  function saveAsSheet(){
    var name=prompt('另存为新存档，请输入名称：','存档副本'+(getSheets().length+1)); if(!name) return;
    var id='sheet_'+Date.now(); var sheets=getSheets(); var curData=null; try{ curData=localStorage.getItem(LS_KEY); }catch(_){}
    sheets.push({id:id,name:name,ts:Date.now(),data:curData}); saveSheets(sheets); setCurId(id); refreshSheetSelect(); toast('✅ 已另存为：'+name,'success',3000);
  }
  function deleteSheet(){
    if(!__castCan('manage')){ __castDeny('删除存档'); return; }
    var curId=getCurId(); var sheets=getSheets(); var cur=sheets.filter(function(s){return s.id===curId;})[0];
    if(!cur){ toast('⚠️ 默认存档不可删除','warning',2000); return; }
    var delName=cur.name;
    __showConfirm('确定删除存档「'+delName+'」？此操作不可撤销！', function(){
      try{ _verSnapshot('删除存档前备份：'+delName, true); }catch(_){}
      sheets=getSheets().filter(function(s){return s.id!==curId;}); saveSheets(sheets); setCurId('default'); refreshSheetSelect();
      toast('🗑️ 已删除：'+delName,'success',2000); setTimeout(function(){ location.reload(); },1000);
    });
  }
  function switchSheet(id){
    setCurId(id); var sheets=getSheets(); var cur=sheets.filter(function(s){return s.id===id;})[0];
    if(cur&&cur.data){ try{ localStorage.setItem(LS_KEY,cur.data); }catch(_){} }
    toast('📁 已切换到：'+(cur?cur.name:'默认存档'),'info',2000); setTimeout(function(){ location.reload(); },800);
  }
  var WAGE_GRADES={W1:{name:'实习',daily:80},W2:{name:'替补',daily:120},W3:{name:'C角',daily:180},W4:{name:'B角',daily:280},W5:{name:'A角',daily:400},W6:{name:'主B',daily:600},W7:{name:'主A角',daily:800}};
  // 20261017fix2：loadPerformers 定义在 cast-sheet-performers.js 的 IIFE 内，
  // 抽离为独立文件后不再是全局函数；统一经 __castSheetHook 获取（初始化时挂载）。
  function _loadPerformersSafe(){
    try{ if (typeof loadPerformers === 'function') return loadPerformers(); }catch(e){}
    try{ if (window.__castSheetHook && typeof window.__castSheetHook.loadPerformers === 'function') return window.__castSheetHook.loadPerformers(); }catch(e){}
    return null;
  }
  // 20260922 组团样板的人选只能来自真实演职库（/v1/performers 同步缓存）；人数不足时姓名留空，由用户手工指派
  function _realNamePool(){
    var groups={actor:[],band:[],front:[],costume:[],electric:[]};
    try{
      var p=_loadPerformersSafe(); var flat=(p&&p.flat)||[];
      flat.forEach(function(x){
        var role=x.skill||''; var cb=x.category;
        if(['文须生','武须生','小生','正旦','小旦','彩旦','二架旦','大花脸','二花脸','丑角','门官','家院','龙套','校尉','刀斧手','丫鬟','彩女'].indexOf(cb)>=0) groups.actor.push(x.name);
        else if(cb==='武场'||cb==='文场') groups.band.push(x.name);
        else if(cb==='电工'||/灯|音响|话筒|耳麦|麦|配电|电工|设备/.test(role)) groups.electric.push(x.name);
        else if(cb==='衣箱'||/衣箱|服装|盔|跟包|化妆|妆|勾脸|道具/.test(role)) groups.costume.push(x.name);
        else groups.front.push(x.name);
      });
    }catch(e){}
    return groups;
  }
  // v20261017fix：日薪优先取本人协议日工资（演职库 dailyRate，入职登记时本人填写）；
  // 无名空位或未设置协议工资者才回退等级默认日薪。页面会话内缓存，每次生成组团时重建。
  var __rateMap = null;
  function _rateByNameMap(){
    var map = {};
    try{
      var p = _loadPerformersSafe(); var flat = (p && p.flat) || [];
      flat.forEach(function(x){ var r = Number(x.dailyRate); if (x.name && r > 0) map[x.name] = r; });
    }catch(e){}
    __rateMap = map;
    return map;
  }
  function _dailyOf(map, name, grade){
    var r = (name && map) ? map[name] : null;
    return (r && r > 0) ? r : WAGE_GRADES[grade].daily;
  }
  // v20261017d 口径修订（用户需求）：有名但未填协议工资者 → 日薪按 0 计并标 needCheck（⚠请核对）；
  // 无名空位才回退等级默认日薪占位。核对修正后可在天工资商议单一键写回花名册。
  function _slot(cat,name,role,grade,rates){
    name = name||''; var map = rates||__rateMap||_rateByNameMap();
    var r = (name&&map) ? map[name] : null;
    var s = {cat:cat,name:name,role:role,grade:grade,daily:(r&&r>0)?r:(name?0:WAGE_GRADES[grade].daily)};
    if(name&&!(r&&r>0)) s.needCheck=1;
    return s;
  }
  function _mkSlot(cat,name,role,grade,rates,pid){ var s=_slot(cat,name,role,grade,rates); if(pid) s.pid=pid; return s; }
  // v20261017d：带 id/skill/dailyRate 的分组人选池（自定义组团"岗位对齐+日薪对齐"用）
  function _realNamePoolEx(){
    var groups={actor:[],band:[],front:[],costume:[],electric:[]};
    try{
      var p=_loadPerformersSafe(); var flat=(p&&p.flat)||[];
      flat.forEach(function(x){
        var role=x.skill||''; var cb=x.category;
        var obj={id:x.id||'',name:x.name,skill:role,dailyRate:Number(x.dailyRate)||0};
        if(['文须生','武须生','小生','正旦','小旦','彩旦','二架旦','大花脸','二花脸','丑角','门官','家院','龙套','校尉','刀斧手','丫鬟','彩女'].indexOf(cb)>=0) groups.actor.push(obj);
        else if(cb==='武场'||cb==='文场') groups.band.push(obj);
        else if(cb==='电工'||/灯|音响|话筒|耳麦|麦|配电|电工|设备/.test(role)) groups.electric.push(obj);
        else if(cb==='衣箱'||/衣箱|服装|盔|跟包|化妆|妆|勾脸|道具/.test(role)) groups.costume.push(obj);
        else groups.front.push(obj);
      });
    }catch(e){}
    return groups;
  }
  function generate36Template(){
    var template=[];
    var pool=_realNamePool();
    var rates=_rateByNameMap();
    var actorSlots=[['文须生','W5'],['文须生','W4'],['小生','W5'],['小生','W3'],['正旦','W6'],['正旦','W4'],['小旦','W5'],['小旦','W3'],['大花脸','W6'],['二花脸','W4'],['丑角','W4'],['武须生','W5'],['二架旦','W4'],['彩旦','W3'],['武须生','W5'],['丑角','W3'],['二花脸','W4'],['门官','W3']];
    actorSlots.forEach(function(s,i){ template.push(_slot('actor', pool.actor[i], s[0], s[1], rates)); });
    var bandSlots=[['板胡','W6'],['二胡','W4'],['竹笛','W4'],['三弦','W3'],['司鼓','W6'],['大锣','W3'],['铙钹','W3'],['梆子','W2']];
    bandSlots.forEach(function(s,i){ template.push(_slot('band', pool.band[i], s[0], s[1], rates)); });
    var frontSlots=[['前场','W5'],['前场','W2'],['前场','W2'],['前场','W1']];
    frontSlots.forEach(function(s,i){ template.push(_slot('front', pool.front[i], s[0], s[1], rates)); });
    var costumeSlots=[['衣箱','W4'],['衣箱','W3'],['衣箱','W3']];
    costumeSlots.forEach(function(s,i){ template.push(_slot('costume', pool.costume[i], s[0], s[1], rates)); });
    var electricSlots=[['电工','W4'],['电工','W4'],['电工','W2']];
    electricSlots.forEach(function(s,i){ template.push(_slot('electric', pool.electric[i], s[0], s[1], rates)); });
    return template;
  }
  function updateTroupeStats(template){
    var total=$('tp-total'); var actor=$('tp-actor'); var band=$('tp-band'); var front=$('tp-front'); var costume=$('tp-costume'); var electric=$('tp-electric'); var status=$('tp-status'); var dayWage=$('tp-wage-day');
    var ac=0,bc=0,fc=0,cc=0,ec=0,totalWage=0;
    for(var i=0;i<template.length;i++){ var p=template[i]; totalWage+=p.daily||0; if(p.cat==='actor')ac++; else if(p.cat==='band')bc++; else if(p.cat==='front')fc++; else if(p.cat==='costume')cc++; else if(p.cat==='electric')ec++; }
    if(total){total.querySelector('em').textContent=template.length;}
    if(actor){actor.querySelector('em').textContent=ac;}
    if(band){band.querySelector('em').textContent=bc;}
    if(front){front.querySelector('em').textContent=fc;}
    if(costume){costume.querySelector('em').textContent=cc;}
    if(electric){electric.querySelector('em').textContent=ec;}
    if(status){var em=status.querySelector('em'); if(template.length>=30){em.textContent='✅达标';em.style.color='#16a34a';}else{em.textContent='⚠️不足30人';em.style.color='#dc3545';}}
    if(dayWage){dayWage.querySelector('em').textContent='¥'+totalWage.toLocaleString('zh-CN');}
    var days=parseInt($('tpDays')?$('tpDays').value:3)||3;
    var totalEl=$('tp-wage-total'); if(totalEl){totalEl.querySelector('em').textContent='¥'+(totalWage*days).toLocaleString('zh-CN');}
  }
  function syncToCast(){
    var template=getCurrentTemplate(); if(!template||template.length===0){ toast('⚠️ 请先生成或载入组团模板','warning',2000); return; }
    try{ localStorage.setItem(LS_TROUPE,JSON.stringify(template)); }catch(_){}
    var cnt=fillBlocksFromTemplate(template);
    toast('🧩 已同步'+template.length+'人到演员表（角色'+cnt.actors+' / 文场'+cnt.wenchang+' / 武场'+cnt.wuchang+' / 舞台保障'+cnt.stage+'）','success',3000);
  }
  function getCurrentTemplate(){ try{ var raw=localStorage.getItem(LS_TROUPE); return raw?JSON.parse(raw):null; }catch(_){ return null; } }
  function _hx(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _fillBlock(bodyId, rows, key){
    var body=$(bodyId); if(!body) return;
    var html='';
    rows.forEach(function(r,i){
      html += '<tr><td class="seq">'+(i+1)+'</td>'
        + '<td><input type="text" data-key="'+key+'" data-i="'+i+'" data-col="pos" value="'+_hx(r.pos)+'"></td>'
        + '<td><input type="text" data-key="'+key+'" data-i="'+i+'" data-col="name" value="'+_hx(r.name)+'"></td>'
        + '<td><textarea data-key="'+key+'" data-i="'+i+'" data-col="note" rows="2">'+_hx(r.note)+'</textarea></td>'
        + '<td class="cast-col-center"><input type="checkbox" class="cast-cb-public" data-key="'+key+'" data-i="'+i+'" data-col="isPublic" checked></td>'
        + '<td><button class="btn-del-row" data-del="'+key+'" data-i="'+i+'" type="button">✕</button></td></tr>';
    });
    body.innerHTML = html;
  }
  function fillBlocksFromTemplate(template){
    var actors=[], wenchang=[], wuchang=[], stage=[];
    template.forEach(function(p){
      var row={pos:p.role, name:p.name, note:(p.grade?WAGE_GRADES[p.grade].name:'')+' / ¥'+(p.daily||0)+'/天'};
      if(p.cat==='actor') actors.push(row);
      else if(p.cat==='band'){
        if(/板胡|二胡|高胡|椰胡|扬琴|琵琶|三弦|古筝|竹笛|笛子|梅管|唢呐|海笛|笙|大提琴|贝司|提琴|电子琴|琴/.test(p.role)) wenchang.push(row);
        else wuchang.push(row);
      }
      else stage.push(row);
    });
    _fillBlock('bodyCreative', actors, 'creative');
    _fillBlock('bodyWenchang', wenchang, 'wenchang');
    _fillBlock('bodyWuchang', wuchang, 'wuchang');
    _fillBlock('bodyStage', stage, 'stage');
    return {actors:actors.length, wenchang:wenchang.length, wuchang:wuchang.length, stage:stage.length};
  }
  function seed36(){
    var template=generate36Template();
    try{ localStorage.setItem(LS_TROUPE,JSON.stringify(template)); }catch(_){}
    updateTroupeStats(template);
    var cnt=fillBlocksFromTemplate(template);
    var blank=template.filter(function(p){return !p.name;}).length;
    toast('✨ 已按标配岗位生成样板（演员'+cnt.actors+'+乐队'+(cnt.wenchang+cnt.wuchang)+'+舞台'+cnt.stage+'），人选取自真实演职库'+(blank?'，其中'+blank+'个岗位暂无合适人员，请手工填写真实姓名':''),'success',4200);
  }
  // ===== 自定义组团 =====
  var CG_ROLES={
    actor:['文须生','武须生','小生','正旦','小旦','彩旦','二架旦','大花脸','二花脸','丑角','门官','家院','龙套','校尉','刀斧手','丫鬟','彩女'],
    band:['板胡','二胡','笛子','三弦','琵琶','扬琴','大提琴','司鼓','锣','铙钹','梆子','大锣'],
    front:['前场','舞台监督','前台','字幕','检票','引导','催场'],
    costume:['衣箱','服装师','化妆师','帽箱','盔箱','道具师'],
    electric:['电工','灯光师','音响师','配电','设备']
  };
  // 20260922 原内置假名表 CG_NAMES 已删除，人选统一走真实演职库
  function openCustomGroupModal(){
    var modal=$('customGroupModal'); if(!modal) return;
    // v20261017d：总人数=花名册人数 —— 打开时按花名册各队实有人数预填（可改）
    try{
      var pe=_realNamePoolEx();
      var pre={cgActor:pe.actor.length,cgBand:pe.band.length,cgFront:pe.front.length,cgCostume:pe.costume.length,cgElectric:pe.electric.length};
      for(var k in pre){ var el=$(k); if(el) el.value=pre[k]; }
      var note=$('cgRosterNote');
      if(!note){
        note=document.createElement('div'); note.id='cgRosterNote';
        note.style.cssText='margin-bottom:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:8px 12px;font-size:0.8rem;color:#14532d;';
        var grid=modal.querySelector('div[style*="grid-template-columns"]');
        if(grid&&grid.parentNode) grid.parentNode.insertBefore(note,grid);
        else { var box=modal.querySelector('.modal-overlay-root'); if(box) box.appendChild(note); }
      }
      note.innerHTML='📋 花名册共 <b>'+(pe.actor.length+pe.band.length+pe.front.length+pe.costume.length+pe.electric.length)+'</b> 人：演员'+pe.actor.length+' / 乐队'+pe.band.length+' / 前场'+pe.front.length+' / 服装化妆'+pe.costume.length+' / 电工'+pe.electric.length+'（已按花名册人数预填，可调整）';
    }catch(_){}
    window.__revealLayer(modal);
    modal.style.display='flex';
    document.body.classList.add('body-modal-locked');
    bindCustomGroupModal();
    updateCustomGroupPreview();
  }
  function closeCustomGroupModal(){
    var modal=$('customGroupModal'); if(!modal) return;
    modal.style.display='none';
    document.body.classList.remove('body-modal-locked');
  }
  function updateCustomGroupPreview(){
    var a=parseInt($('cgActor').value)||0, b=parseInt($('cgBand').value)||0;
    var f=parseInt($('cgFront').value)||0, c=parseInt($('cgCostume').value)||0, e=parseInt($('cgElectric').value)||0;
    var total=a+b+f+c+e;
    $('cgTotal').textContent=total;
    // v20261017d：预估工资按花名册协议日工资均值（无数据组回退经验值）；实际以每人协议日工资为准
    var pe=null; try{ pe=_realNamePoolEx(); }catch(_){}
    function avgRate(arr){ if(!arr||!arr.length) return null; var s=0,n=0; arr.forEach(function(p){ var r=Number(p.dailyRate); if(r>0){ s+=r; n++; } }); return n? s/n : null; }
    var fb={actor:280,band:220,front:120,costume:200,electric:240};
    var wage=0;
    [['actor',a],['band',b],['front',f],['costume',c],['electric',e]].forEach(function(it){
      var av=pe?avgRate(pe[it[0]]):null;
      wage+=it[1]*(av||fb[it[0]]);
    });
    $('cgWage').textContent='¥'+Math.round(wage).toLocaleString('zh-CN');
  }
  function bindCustomGroupModal(){
    var ids=['cgActor','cgBand','cgFront','cgCostume','cgElectric'];
    ids.forEach(function(id){
      var el=$(id); if(el&&!el.__cgBound){ el.__cgBound=1; el.addEventListener('input',updateCustomGroupPreview); }
    });
    var closeBtn=$('cgCloseBtn'), cancelBtn=$('cgCancelBtn'), genBtn=$('cgGenBtn');
    if(closeBtn&&!closeBtn.__cgBound){ closeBtn.__cgBound=1; closeBtn.addEventListener('click',closeCustomGroupModal); }
    if(cancelBtn&&!cancelBtn.__cgBound){ cancelBtn.__cgBound=1; cancelBtn.addEventListener('click',closeCustomGroupModal); }
    if(genBtn&&!genBtn.__cgBound){ genBtn.__cgBound=1; genBtn.addEventListener('click',generateCustomTemplate); }
    /* v20260929fix：点击遮罩空白处关闭自定义组团弹窗（target 为根遮罩本身，不影响内容区点击），与全站弹窗交互一致 */
    var cgModal=$('customGroupModal');
    if(cgModal&&!cgModal.__cgBackdropBound){ cgModal.__cgBackdropBound=1; cgModal.addEventListener('click', function(e){ if(e.target===cgModal) closeCustomGroupModal(); }); }
  }
  function generateCustomTemplate(){
    var a=parseInt($('cgActor').value)||0, b=parseInt($('cgBand').value)||0;
    var f=parseInt($('cgFront').value)||0, c=parseInt($('cgCostume').value)||0, e=parseInt($('cgElectric').value)||0;
    var days=parseInt($('cgDays').value)||3;
    var total=a+b+f+c+e;
    if(total<=0){ toast('⚠️ 请至少填写一个组的人数','warning',2000); return; }
    var template=[];
    function pickGrade(idx,count){
      var grades=['W7','W6','W5','W4','W3','W2','W1'];
      var ratio=[0.05,0.1,0.15,0.25,0.2,0.15,0.1];
      var acc=0, gi=0;
      for(var g=0;g<grades.length;g++){ acc+=ratio[g]; if(idx<Math.ceil(count*acc)){ gi=g; break; } }
      return grades[gi];
    }
  // 20260922 自定义组团不再内置假名；姓名从真实演职库按组取用，不足留空
  // v20261017d：岗位对齐 —— 每人岗位取其花名册行当(skill)，日薪取其协议日工资(未填按0并标needCheck)；带pid供商议单写回
  function buildGroup(cat,count,poolEx){
    var roles=CG_ROLES[cat]||[]; var ppl=(poolEx&&poolEx[cat])||[];
    var rates=_rateByNameMap();
    for(var i=0;i<count;i++){
      var p=ppl[i]||null;
      if(p){ template.push(_mkSlot(cat,p.name,(p.skill||roles[i%roles.length]),pickGrade(i,count),rates,p.id)); }
      else { var g=pickGrade(i,count); template.push({cat:cat,name:'',role:roles[i%roles.length],grade:g,daily:WAGE_GRADES[g].daily}); }
    }
  }
    var _poolEx=_realNamePoolEx();
    buildGroup('actor',a,_poolEx); buildGroup('band',b,_poolEx); buildGroup('front',f,_poolEx); buildGroup('costume',c,_poolEx); buildGroup('electric',e,_poolEx);
    try{ localStorage.setItem(LS_TROUPE,JSON.stringify(template)); }catch(_){}
    updateTroupeStats(template);
    var tpDays=$('tpDays'); if(tpDays){ tpDays.value=days; }
    fillBlocksFromTemplate(template);
    closeCustomGroupModal();
    toast('🛠 已生成'+total+'人自定义组团样板（演员'+a+'+乐队'+b+'+前场'+f+'+服装'+c+'+电工'+e+'），岗位与日薪已对齐花名册，可点「天工资商议单」核对','success',3800);
  }
  function loadTemplate(){
    var saved=getCurrentTemplate();
    if(saved&&saved.length>0){
      updateTroupeStats(saved);
      var cnt=fillBlocksFromTemplate(saved);
      toast('📋 已载入模板：'+saved.length+'人（角色'+cnt.actors+' / 文场'+cnt.wenchang+' / 武场'+cnt.wuchang+' / 舞台保障'+cnt.stage+'）','success',2500);
    }else{
      var lib=getTplLib();
      if(lib.length&&lib[0].data&&lib[0].data.length){
        try{ localStorage.setItem(LS_TROUPE, JSON.stringify(lib[0].data)); }catch(_){}
        updateTroupeStats(lib[0].data);
        fillBlocksFromTemplate(lib[0].data);
        var td=$('tpDays'); if(td&&lib[0].days) td.value=lib[0].days;
        toast('📋 已载入最近保存的模板「'+lib[0].name+'」（'+lib[0].data.length+'人）；更多模板请点「⚙️ 组团模板管理」','success',3400);
      }else{
        toast('⚠️ 无保存的模板，请先点击「一键生成36人标配」','warning',3000);
      }
    }
  }
  /* v20261017d 商议单内嵌交互脚本（在弹出新窗口中执行）：
     请假天数不计工资、空日薪按0并提示核对、实时合计、核对修正后一键写回花名册 */
  var WS_JS = [
    'function q(s){return document.querySelector(s);}',
    'function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}',
    'function calcRow(tr){',
    '  var rate=parseFloat(tr.querySelector(".wsRate").value)||0;',
    '  var days=parseFloat(tr.querySelector(".wsDays").value)||0;',
    '  var leave=parseFloat(tr.querySelector(".wsLeave").value)||0;',
    '  var pay=Math.max(0,days-leave);',
    '  var sub=Math.round(rate*pay*100)/100;',
    '  tr.querySelector(".wsPay").textContent=pay;',
    '  tr.querySelector(".wsSub").textContent=sub;',
    '  return sub;',
    '}',
    'function updateWarn(){',
    '  var bad=[];',
    '  qa("#wsTable tbody tr").forEach(function(tr){',
    '    var nm=(tr.cells[1].textContent||"").trim();',
    '    if(!nm||nm==="（空位）") return;',
    '    var r=parseFloat(tr.querySelector(".wsRate").value)||0;',
    '    if(r<=0) bad.push(nm);',
    '  });',
    '  var w=q("#wsWarn");',
    '  if(bad.length){ w.style.display="block"; w.innerHTML="⚠️ 以下 <b>"+bad.length+"</b> 人未填写协议日工资，暂按 <b>0元</b> 计算，请核对填写真实工资后再打印：<b>"+bad.join("、")+"</b>"; }',
    '  else { w.style.display="none"; w.innerHTML=""; }',
    '}',
    'function recalcAll(){',
    '  var t=0;',
    '  qa("#wsTable tbody tr").forEach(function(tr){ t+=calcRow(tr); });',
    '  q("#wsTotal").textContent=Math.round(t*100)/100;',
    '  updateWarn();',
    '}',
    'function buildPrintView(){',
    '  var h="<h1>秦安县秦剧团文化演出有限公司 · 天工资商议单</h1><p>生成日期："+new Date().toLocaleDateString("zh-CN")+"</p><table><tr><th>序号</th><th>姓名</th><th>组别</th><th>行当/岗位</th><th>工资等级</th><th>日薪(元)</th><th>演出天数</th><th>请假(天)</th><th>计薪天数</th><th>小计(元)</th></tr>";',
    '  qa("#wsTable tbody tr").forEach(function(tr){',
    '    h+="<tr><td>"+tr.cells[0].textContent+"</td><td>"+tr.cells[1].textContent+"</td><td>"+tr.cells[2].textContent+"</td><td>"+tr.cells[3].textContent+"</td><td>"+tr.cells[4].textContent+"</td><td>"+tr.querySelector(".wsRate").value+"</td><td>"+tr.querySelector(".wsDays").value+"</td><td>"+tr.querySelector(".wsLeave").value+"</td><td>"+tr.querySelector(".wsPay").textContent+"</td><td>"+tr.querySelector(".wsSub").textContent+"</td></tr>";',
    '  });',
    '  h+="<tr class=\\"total\\"><td colspan=\\"9\\">合计</td><td>"+q("#wsTotal").textContent+"</td></tr></table>";',
    '  q("#wsPrint").innerHTML=h;',
    '}',
    'function updateOpenerCache(pid,rate){',
    '  try{',
    '    var op=window.opener; if(!op||!op.localStorage) return;',
    '    var raw=op.localStorage.getItem("qaxqjt_performers_v1"); if(!raw) return;',
    '    var o=JSON.parse(raw);',
    '    (o.flat||[]).forEach(function(x){ if(x.id===pid) x.dailyRate=rate; });',
    '    op.localStorage.setItem("qaxqjt_performers_v1",JSON.stringify(o));',
    '  }catch(_){}',
    '}',
    'function doWriteback(){',
    '  var changed=[];',
    '  qa("#wsTable tbody tr").forEach(function(tr){',
    '    var pid=tr.getAttribute("data-pid"); if(!pid) return;',
    '    var r=parseFloat(tr.querySelector(".wsRate").value)||0;',
    '    var r0=parseFloat(tr.getAttribute("data-rate0"))||0;',
    '    if(r>0&&r!==r0) changed.push({pid:pid,rate:r});',
    '  });',
    '  var msgEl=q("#wsSaveMsg");',
    '  if(!changed.length){ msgEl.style.color="#b45309"; msgEl.textContent="没有需要写回的修改（各行日薪与花名册一致）"; return; }',
    '  var btn=q("#wsSaveBtn"); btn.disabled=true; msgEl.style.color="#059669"; msgEl.textContent="写回中…0/"+changed.length;',
    '  var ok=0,fail=0,done=0;',
    '  var chain=Promise.resolve();',
    '  changed.forEach(function(it){',
    '    chain=chain.then(function(){',
    '      return fetch(APIBASE+"/api/v1/performers/"+it.pid,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+TOKEN},body:JSON.stringify({dailyRate:it.rate})})',
    '      .then(function(res){ if(res.ok){ ok++; updateOpenerCache(it.pid,it.rate); } else { fail++; } done++; msgEl.textContent="写回中…"+done+"/"+changed.length; });',
    '    });',
    '  });',
    '  chain.then(function(){',
    '    if(fail){ msgEl.style.color="#b45309"; msgEl.textContent="⚠️ 已写回"+ok+"人，失败"+fail+"人（权限不足或网络异常）"; btn.disabled=false; }',
    '    else { msgEl.textContent="✅ 已将"+ok+"人核对后的协议日薪写回花名册"; }',
    '  }).catch(function(){ msgEl.style.color="#b45309"; msgEl.textContent="写回异常，请重试"; btn.disabled=false; });',
    '}',
    'q("#wsDaysAll").addEventListener("input",function(){ var v=this.value; qa(".wsDays").forEach(function(el){ el.value=v; }); recalcAll(); });',
    'q("#wsTable").addEventListener("input",function(e){ if(e.target&&(e.target.classList.contains("wsRate")||e.target.classList.contains("wsDays")||e.target.classList.contains("wsLeave"))) recalcAll(); });',
    'q("#wsPrintBtn").addEventListener("click",function(){ buildPrintView(); setTimeout(function(){ window.print(); },60); });',
    '(function(){ var sb=q("#wsSaveBtn"); if(sb&&!sb.disabled) sb.addEventListener("click",doWriteback); })();',
    'recalcAll();'
  ].join('\n');
  function printWageSheet(e){
    if(e){ try{ e.preventDefault(); e.stopPropagation(); }catch(_){} }
    var template=getCurrentTemplate(); if(!template||template.length===0){ toast('⚠️ 请先生成组团模板','warning',2000); return; }
    var days=parseInt($('tpDays')?$('tpDays').value:3)||3;
    var win=window.open('','_blank');
    if(!win){ toast('⚠️ 浏览器拦截了新窗口，请允许弹窗后重试','warning',2800); return; }
    var TOKEN='';
    try{ TOKEN=(window.QAXQJT_API&&window.QAXQJT_API.getAccessToken)?(window.QAXQJT_API.getAccessToken()||''):(localStorage.getItem('qaxqjt_access_token')||''); }catch(_){ try{ TOKEN=localStorage.getItem('qaxqjt_access_token')||''; }catch(__){} }
    var APIBASE=location.origin||'';
    var catName={actor:'演员组',band:'乐队组',front:'前场',costume:'服装化妆',electric:'电工'};
    var rows='';
    for(var i=0;i<template.length;i++){
      var p=template[i];
      var rate=Number(p.daily)||0;
      var nc=!!p.needCheck;
      var nameCell=p.name?_hx(p.name):'<span style="color:#94a3b8;">（空位）</span>';
      rows+='<tr'+(nc?' style="background:#fff7ed;"':'')+' data-pid="'+_hx(p.pid||'')+'" data-rate0="'+rate+'">'
        +'<td>'+(i+1)+'</td><td>'+nameCell+'</td>'
        +'<td>'+_hx(catName[p.cat]||p.cat||'')+'</td><td>'+_hx(p.role||'')+'</td>'
        +'<td>'+_hx(WAGE_GRADES[p.grade]?WAGE_GRADES[p.grade].name:p.grade)+'</td>'
        +'<td><input class="wsRate" type="number" min="0" step="0.01" value="'+rate+'" style="width:80px;'+(nc?'border:2px solid #f97316;color:#c2410c;font-weight:700;':'')+'">'+(nc?'<div style="color:#ea580c;font-size:11px;font-weight:700;">⚠请核对</div>':'')+'</td>'
        +'<td><input class="wsDays" type="number" min="0" step="0.5" value="'+days+'" style="width:64px;"></td>'
        +'<td><input class="wsLeave" type="number" min="0" step="0.5" value="0" style="width:64px;"></td>'
        +'<td class="wsPay">0</td><td class="wsSub">0</td></tr>';
    }
    var html='<html><head><meta charset="utf-8"><title>天工资商议单</title><style>'
      +'body{font-family:SimSun,Arial;margin:14px;}table{border-collapse:collapse;width:100%}th,td{border:1px solid #333;padding:5px 8px;font-size:13px;text-align:center}th{background:#f0f7ff}'
      +'h1{text-align:center;font-size:20px;}.total{font-weight:bold;color:#dc3545}'
      +'#wsBar{margin-bottom:10px;padding:10px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:14px;}'
      +'#wsWarn{margin-bottom:10px;padding:10px 12px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;font-size:14px;color:#9a3412;display:none;}'
      +'button{padding:6px 14px;border:none;border-radius:6px;cursor:pointer;font-weight:700;margin-right:8px;}'
      +'#wsPrintBtn{background:#0f4c81;color:#fff;}#wsSaveBtn{background:#059669;color:#fff;}#wsSaveBtn:disabled{background:#9ca3af;cursor:not-allowed;}'
      +'input[type=number]{padding:3px 5px;border:1px solid #cbd5e1;border-radius:4px;}'
      +'@media print{#wsBar,#wsWarn,#wsTable{display:none!important}#wsPrint{display:block!important}}'
      +'</style></head><body>';
    html+='<div id="wsBar">🎬 演出天数：<input id="wsDaysAll" type="number" min="1" step="0.5" value="'+days+'" style="width:70px;">（统一设置各行演出天数） '
      +'<button id="wsPrintBtn" type="button">🖨 打印商议单</button>'
      +'<button id="wsSaveBtn" type="button"'+(TOKEN?'':' disabled')+' title="'+(TOKEN?'将核对修正后的协议日薪写回花名册':'未获取登录令牌，无法写回')+'">💾 核对后的日薪写回花名册</button> '
      +'<span id="wsSaveMsg" style="font-weight:700;"></span>'
      +'<div style="color:#64748b;font-size:12px;margin-top:6px;">📌 日薪取每人协议日工资；未填者为0并标⚠请核对；请假天数不计工资；小计=日薪×(演出天数−请假天数)</div></div>';
    html+='<div id="wsWarn"></div>';
    html+='<table id="wsTable"><thead><tr><th>序号</th><th>姓名</th><th>组别</th><th>行当/岗位</th><th>工资等级</th><th>日薪(元)</th><th>演出天数</th><th>请假(天)</th><th>计薪天数</th><th>小计(元)</th></tr></thead><tbody>'+rows+'</tbody>'
      +'<tfoot><tr class="total"><td colspan="9">合计</td><td id="wsTotal">0</td></tr></tfoot></table>';
    html+='<div id="wsPrint" style="display:none;"></div>';
    html+='<scr'+'ipt>var TOKEN='+JSON.stringify(TOKEN||'')+';var APIBASE='+JSON.stringify(APIBASE||'')+';\n'+WS_JS+'<\/scr'+'ipt></body></html>';
    win.document.write(html); win.document.close();
  }
  /* ==================== 20260928 工具栏按钮真实化 ==================== */
  function markSafe(b){ b.__superPatchBound=1; b.__ts3Done=1; b.__bindDone=1; b.__ctE2Done=1; b.__deadBtnChecked=1; return b; }
  /* ---- 工资等级持久化（W1-W7 可编辑） ---- */
  var WG_LS='qaxqjt_wage_grades_v1';
  // 云端存储单例（脚本在页面底部加载，函数调用时再取，避免加载顺序问题）
  function _tc(){ try{ return (window.TroupeCloudStore&&window.TroupeCloudStore.getStore)?window.TroupeCloudStore.getStore():null; }catch(_){ return null; } }
  function _applyGradesObj(o){
    if(!o) return false; var hit=false;
    for(var k in WAGE_GRADES){ if(o[k]&&o[k].name){ WAGE_GRADES[k].name=String(o[k].name); WAGE_GRADES[k].daily=Number(o[k].daily)||0; hit=true; } }
    return hit;
  }
  function loadWageGrades(){
    var tc=_tc();
    if(tc){ if(_applyGradesObj(tc.getGrades())) return; }
    try{
      var raw=localStorage.getItem(WG_LS); if(!raw) return;
      var o=JSON.parse(raw);
      _applyGradesObj(o);
    }catch(_){}
  }
  function saveWageGrades(){
    try{ localStorage.setItem(WG_LS, JSON.stringify(WAGE_GRADES)); }catch(_){}
    var tc=_tc(); if(tc) tc.saveGrades(JSON.parse(JSON.stringify(WAGE_GRADES)));
  }
  loadWageGrades();
  /* ---- 组团模板库（另存/管理/载入/重命名/删除；云端为主、本机缓存兜底） ---- */
  var TPL_LIB_KEY='troupe_templates_v1';
  function getTplLib(){
    var tc=_tc();
    if(tc){ var a=tc.getTemplates(); if(Array.isArray(a)) return a; }
    try{ var x=JSON.parse(localStorage.getItem(TPL_LIB_KEY)||'[]'); return Array.isArray(x)?x:[]; }catch(_){ return []; }
  }
  function setTplLib(a){
    try{ localStorage.setItem(TPL_LIB_KEY, JSON.stringify(a)); }catch(_){}
    var tc=_tc(); if(tc) tc.saveTemplates(a);
  }
  function _tplDays(){ return parseInt(($('tpDays')&&$('tpDays').value))||3; }
  function _stamp(){ var d=new Date(); function p2(n){ return (n<10?'0':'')+n; } return ''+d.getFullYear()+p2(d.getMonth()+1)+p2(d.getDate()); }
  function _fmtTime(iso){ try{ var dt=new Date(iso); return isNaN(dt.getTime())?'':(dt.toLocaleDateString('zh-CN')+' '+dt.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})); }catch(_){ return ''; } }
  function tplSaveAs(){
    var tpl=getCurrentTemplate();
    if(!tpl||tpl.length===0){ toast('⚠️ 当前没有组团数据，请先「一键生成标配样板」或「自定义组团」','warning',2800); return; }
    var n=prompt('请输入模板名称：','组团模板_'+_stamp());
    if(n===null) return;
    n=String(n).trim();
    if(!n){ toast('⚠️ 模板名称不能为空','warning',2000); return; }
    var lib=getTplLib();
    lib.unshift({ id:'tp_'+Date.now().toString(36), name:n, data:tpl, days:_tplDays(), savedAt:new Date().toISOString() });
    if(lib.length>50) lib.length=50;
    setTplLib(lib);
    toast('💾 已另存为组团模板「'+n+'」（'+tpl.length+'人×'+_tplDays()+'天）','success',3000);
  }
  function tplManage(){
    var m=$('tplManageModal'); if(!m){ buildTplManageModal(); m=$('tplManageModal'); }
    renderTplManageList();
    window.__revealLayer(m);
    m.style.display='flex'; document.body.classList.add('body-modal-locked');
  }
  function tplManageClose(){
    var m=$('tplManageModal'); if(m) m.style.display='none';
    document.body.classList.remove('body-modal-locked');
  }
  function buildTplManageModal(){
    var d=document.createElement('div');
    d.id='tplManageModal';
    d.style.cssText='display:none;position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,0.55);align-items:flex-start;justify-content:center;padding-top:8vh;overflow-y:auto;transform:none!important;';
    d.innerHTML='<div style="background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3);width:min(680px,94vw);max-height:84vh;overflow-y:auto;">'
      +'<div style="padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;"><h3 style="margin:0;font-size:1.1rem;font-weight:700;color:#0f4c81;">📋 组团模板管理</h3><button type="button" id="tplMgClose" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#64748b;">✕</button></div>'
      +'<div style="padding:14px 22px 20px;"><div id="tplMgList"></div></div></div>';
    document.body.appendChild(d);
    var x=$('tplMgClose'); if(x&&!x.__tplMg){ x.__tplMg=1; markSafe(x); x.addEventListener('click',tplManageClose,true); }
    d.addEventListener('click',function(e){ if(e.target===d) tplManageClose(); });
  }
  function renderTplManageList(){
    var lib=getTplLib(); var box=$('tplMgList'); if(!box) return;
    if(!lib.length){ box.innerHTML='<div style="text-align:center;color:#94a3b8;padding:34px 0;font-size:.9rem;">暂无保存的组团模板。<br>先在上方生成样板，再点「💾 另存为组团模板」。</div>'; return; }
    var h='<table style="width:100%;border-collapse:collapse;font-size:.86rem;"><thead><tr>'
      +'<th style="text-align:left;padding:8px 6px;border-bottom:2px solid #e2e8f0;">模板名称</th>'
      +'<th style="padding:8px 6px;border-bottom:2px solid #e2e8f0;">人数</th>'
      +'<th style="padding:8px 6px;border-bottom:2px solid #e2e8f0;">天数</th>'
      +'<th style="padding:8px 6px;border-bottom:2px solid #e2e8f0;">保存时间</th>'
      +'<th style="padding:8px 6px;border-bottom:2px solid #e2e8f0;width:210px;">操作</th></tr></thead><tbody>';
    lib.forEach(function(t){
      h+='<tr data-tpl-id="'+_hx(t.id||'')+'" style="border-bottom:1px solid #f1f5f9;">'
        +'<td style="padding:8px 6px;font-weight:600;color:#334155;">'+_hx(t.name||'未命名')+'</td>'
        +'<td style="padding:8px 6px;text-align:center;">'+((t.data&&t.data.length)||0)+'</td>'
        +'<td style="padding:8px 6px;text-align:center;">'+(t.days||3)+'</td>'
        +'<td style="padding:8px 6px;color:#64748b;font-size:.8rem;">'+_fmtTime(t.savedAt)+'</td>'
        +'<td style="padding:8px 6px;text-align:center;white-space:nowrap;">'
        +'<button type="button" class="tplmg-act" data-tact="load" style="padding:5px 12px;margin:0 2px;border:1px solid #0284c7;background:#fff;color:#0284c7;border-radius:7px;cursor:pointer;font-size:.8rem;">📥 载入</button>'
        +'<button type="button" class="tplmg-act" data-tact="rename" style="padding:5px 12px;margin:0 2px;border:1px solid #d97706;background:#fff;color:#d97706;border-radius:7px;cursor:pointer;font-size:.8rem;">✏ 重命名</button>'
        +'<button type="button" class="tplmg-act" data-tact="del" style="padding:5px 12px;margin:0 2px;border:1px solid #dc2626;background:#fff;color:#dc2626;border-radius:7px;cursor:pointer;font-size:.8rem;">🗑 删除</button>'
        +'</td></tr>';
    });
    h+='</tbody></table>';
    box.innerHTML=h;
    var acts=box.querySelectorAll('.tplmg-act');
    for(var i=0;i<acts.length;i++){ var b=acts[i]; markSafe(b); b.addEventListener('click',onTplManageAct,true); }
  }
  function onTplManageAct(e){
    var btn=e.currentTarget||e.target;
    var tr=btn.closest&&btn.closest('tr[data-tpl-id]'); if(!tr) return;
    var id=tr.getAttribute('data-tpl-id');
    var act=btn.getAttribute('data-tact');
    var lib=getTplLib(); var idx=-1;
    for(var i=0;i<lib.length;i++){ if(lib[i].id===id){ idx=i; break; } }
    if(idx<0){ toast('⚠️ 模板不存在或已被删除','warning',2000); renderTplManageList(); return; }
    var t=lib[idx];
    if(act==='load'){
      try{ localStorage.setItem(LS_TROUPE, JSON.stringify(t.data)); }catch(_){}
      updateTroupeStats(t.data); fillBlocksFromTemplate(t.data);
      var td=$('tpDays'); if(td&&t.days) td.value=t.days;
      tplManageClose();
      toast('📥 已载入模板「'+t.name+'」（'+((t.data&&t.data.length)||0)+'人）','success',2800);
    } else if(act==='rename'){
      var n=prompt('重命名模板：', t.name||''); if(n===null) return; n=String(n).trim();
      if(!n){ toast('⚠️ 名称不能为空','warning',1800); return; }
      t.name=n; setTplLib(lib); renderTplManageList(); toast('✏ 已重命名为「'+n+'」','success',1800);
    } else if(act==='del'){
      if(btn.getAttribute('data-armed')!=='1'){
        btn.setAttribute('data-armed','1'); btn.textContent='确认删除？';
        setTimeout(function(){ try{ btn.removeAttribute('data-armed'); btn.textContent='🗑 删除'; }catch(_){} },3000);
        return;
      }
      lib.splice(idx,1); setTplLib(lib); renderTplManageList();
      toast('🗑 已删除模板「'+t.name+'」','success',2000);
    }
  }
  /* ---- 工资等级编辑（W1-W7） ---- */
  function wgEdit(){
    var m=$('wgEditModal'); if(!m){ buildWgEditModal(); m=$('wgEditModal'); }
    renderWgEditRows();
    window.__revealLayer(m);
    m.style.display='flex'; document.body.classList.add('body-modal-locked');
  }
  function wgEditClose(){ var m=$('wgEditModal'); if(m) m.style.display='none'; document.body.classList.remove('body-modal-locked'); }
  function buildWgEditModal(){
    var d=document.createElement('div');
    d.id='wgEditModal';
    d.style.cssText='display:none;position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,0.55);align-items:flex-start;justify-content:center;padding-top:8vh;overflow-y:auto;transform:none!important;';
    d.innerHTML='<div style="background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3);width:min(560px,94vw);max-height:84vh;overflow-y:auto;">'
      +'<div style="padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;"><h3 style="margin:0;font-size:1.1rem;font-weight:700;color:#0f4c81;">💰 工资等级设置（W1-W7）</h3><button type="button" id="wgEdClose" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#64748b;">✕</button></div>'
      +'<div style="padding:12px 22px 6px;font-size:.82rem;color:#64748b;">保存后：新等级用于「一键生成标配样板 / 自定义组团」，并同步刷新当前模板中同等级人员的日薪。</div>'
      +'<div style="padding:8px 22px 4px;"><table style="width:100%;border-collapse:collapse;font-size:.88rem;"><thead><tr><th style="text-align:left;padding:8px 6px;border-bottom:2px solid #e2e8f0;">等级</th><th style="text-align:left;padding:8px 6px;border-bottom:2px solid #e2e8f0;">名称</th><th style="padding:8px 6px;border-bottom:2px solid #e2e8f0;">日薪(元/天)</th></tr></thead><tbody id="wgEdRows"></tbody></table></div>'
      +'<div style="padding:14px 22px 20px;display:flex;gap:10px;justify-content:flex-end;"><button type="button" id="wgEdCancel" style="padding:9px 20px;border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:9px;cursor:pointer;">取消</button><button type="button" id="wgEdSave" style="padding:9px 24px;border:none;background:#0f4c81;color:#fff;border-radius:9px;cursor:pointer;font-weight:700;">💾 保存</button></div></div>';
    document.body.appendChild(d);
    ['wgEdClose','wgEdCancel'].forEach(function(id){ var b=$(id); if(b&&!b.__wgEd){ b.__wgEd=1; markSafe(b); b.addEventListener('click',wgEditClose,true); } });
    var sv=$('wgEdSave'); if(sv&&!sv.__wgEd){ sv.__wgEd=1; markSafe(sv); sv.addEventListener('click',wgEditSave,true); }
    d.addEventListener('click',function(e){ if(e.target===d) wgEditClose(); });
  }
  function renderWgEditRows(){
    var box=$('wgEdRows'); if(!box) return;
    var h='';
    for(var k in WAGE_GRADES){
      var g=WAGE_GRADES[k];
      h+='<tr><td style="padding:7px 6px;font-weight:700;color:#0f4c81;">'+k+'</td>'
        +'<td style="padding:7px 6px;"><input id="wged-name-'+k+'" value="'+_hx(g.name)+'" style="width:100%;padding:7px 10px;border:1.5px solid #cbd5e1;border-radius:7px;box-sizing:border-box;"></td>'
        +'<td style="padding:7px 6px;text-align:right;"><input id="wged-daily-'+k+'" type="number" min="0" value="'+(g.daily||0)+'" style="width:120px;padding:7px 10px;border:1.5px solid #cbd5e1;border-radius:7px;text-align:right;box-sizing:border-box;"></td></tr>';
    }
    box.innerHTML=h;
  }
  function wgEditSave(){
    var vals=[];
    for(var k in WAGE_GRADES){
      var nEl=$('wged-name-'+k), dEl=$('wged-daily-'+k); if(!nEl||!dEl) return;
      var n=String(nEl.value).trim(); var dv=Number(dEl.value);
      if(!n){ toast('⚠️ '+k+' 名称不能为空','warning',2000); return; }
      if(isNaN(dv)||dv<0){ toast('⚠️ '+k+' 日薪必须为 ≥0 的数字','warning',2000); return; }
      vals.push([k,n,dv]);
    }
    vals.forEach(function(v){ WAGE_GRADES[v[0]].name=v[1]; WAGE_GRADES[v[0]].daily=v[2]; });
    saveWageGrades();
    var tpl=getCurrentTemplate(); var hit=0;
    if(tpl&&tpl.length){
      // v20261017fix：有本人协议日工资的人员不被等级默认值覆盖
      var rates=_rateByNameMap();
      tpl.forEach(function(p){ var g=WAGE_GRADES[p.grade]; var pr=(p.name&&rates)?rates[p.name]:null; if(g&&!(pr>0)&&p.daily!==g.daily){ p.daily=g.daily; hit++; } });
      if(hit){ try{ localStorage.setItem(LS_TROUPE,JSON.stringify(tpl)); }catch(_){ } updateTroupeStats(tpl); }
    }
    wgEditClose();
    toast('💾 已保存工资等级'+(hit?('，同步更新当前模板 '+hit+' 人日薪'):'（新样板将按新标准生成）'),'success',3000);
  }
  /* ---- 预算评估导出 CSV / XLSX ---- */
  var CAT_NAMES={actor:'演员组',band:'乐队组',front:'前场',costume:'服装化妆',electric:'电工'};
  function wageBudgetData(silent){
    var tpl=getCurrentTemplate();
    if(!tpl||tpl.length===0){ if(!silent) toast('⚠️ 请先生成或载入组团模板（当前无组团数据）','warning',2800); return null; }
    var days=_tplDays();
    var rows=[], total=0, catSum={}, catCnt={};
    for(var i=0;i<tpl.length;i++){
      var p=tpl[i]; var sub=(p.daily||0)*days; total+=sub;
      catSum[p.cat]=(catSum[p.cat]||0)+sub; catCnt[p.cat]=(catCnt[p.cat]||0)+1;
      rows.push([i+1, p.name||'（待定）', CAT_NAMES[p.cat]||p.cat, p.role||'', (WAGE_GRADES[p.grade]?WAGE_GRADES[p.grade].name:p.grade)||'', p.daily||0, days, sub]);
    }
    var catRows=[];
    ['actor','band','front','costume','electric'].forEach(function(c){
      if(catCnt[c]) catRows.push([CAT_NAMES[c], catCnt[c], Math.round(catSum[c]/(days||1)), catSum[c]]);
    });
    return {tpl:tpl, days:days, rows:rows, catRows:catRows, total:total};
  }
  function _dlBlob(blob, fn){
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url; a.download=fn;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(_){} },500);
  }
  window.__csWageBudgetAoa=function(){
    var d=wageBudgetData(true); if(!d) return null;
    var aoa=[['#','姓名','组别','行当/岗位','等级','日薪(元)','天数','小计(元)']];
    d.rows.forEach(function(r){ aoa.push(r); });
    aoa.push(['合计', d.tpl.length+'人','','','','','', d.total]);
    return aoa;
  };
  function wageCsv(){
    var d=wageBudgetData(); if(!d) return;
    var esc=function(s){ return '"'+String(s==null?'':s).replace(/"/g,'""')+'"'; };
    var L=[];
    L.push(['秦安县秦剧团文化演出有限公司 · 工资预算评估表（组团 '+d.tpl.length+'人 × '+d.days+'天）'].map(esc).join(','));
    L.push(['导出时间', new Date().toLocaleString('zh-CN')].map(esc).join(','));
    L.push('');
    L.push(['#','姓名','组别','行当/岗位','等级','日薪(元)','天数','小计(元)'].map(esc).join(','));
    d.rows.forEach(function(r){ L.push(r.map(esc).join(',')); });
    L.push(['合计', d.tpl.length+'人','','','','','', d.total].map(esc).join(','));
    L.push('');
    L.push('=== 分组汇总 ===');
    L.push(['组别','人数','日均工资(元/天)',d.days+'天合计(元)'].map(esc).join(','));
    d.catRows.forEach(function(r){ L.push(r.map(esc).join(',')); });
    L.push('');
    L.push(['预算总额（'+d.tpl.length+'人×'+d.days+'天）', d.total].map(esc).join(','));
    var fn='工资预算评估_'+_stamp()+'.csv';
    _dlBlob(new Blob(['\uFEFF'+L.join('\n')], {type:'text/csv;charset=utf-8;'}), fn);
    toast('📊 已导出：'+fn+'（总额 ¥'+d.total.toLocaleString('zh-CN')+'）','success',3200);
  }
  async function wageXlsx(){
    var d=wageBudgetData(); if(!d) return;
    try { await window.__castEnsureXlsx(); } catch(_){ wageCsv(); return; }
    if(typeof toast !== 'undefined') toast('📘 准备 Excel 组件...','info',1200);
    var X=window.XLSX;
    var wb=X.utils.book_new();
    var aoa=[['秦安县秦剧团文化演出有限公司 · 工资预算评估表'],['组团人数', d.tpl.length+'人','演出天数', d.days+'天','预算总额(元)', d.total],[]];
    aoa.push(['#','姓名','组别','行当/岗位','等级','日薪(元)','天数','小计(元)']);
    d.rows.forEach(function(r){ aoa.push(r); });
    aoa.push(['合计', d.tpl.length+'人','','','','','', d.total]);
    var ws=X.utils.aoa_to_sheet(aoa);
    ws['!cols']=[{wch:5},{wch:12},{wch:10},{wch:14},{wch:8},{wch:10},{wch:7},{wch:12}];
    for(var r=5;r<=aoa.length;r++){ ['F','H'].forEach(function(col){ var c=ws[col+r]; if(c&&typeof c.v==='number') c.z='#,##0'; }); }
    X.utils.book_append_sheet(wb, ws, '工资明细');
    var ws2=X.utils.aoa_to_sheet([['组别','人数','日均工资(元/天)',d.days+'天合计(元)']].concat(d.catRows));
    ws2['!cols']=[{wch:12},{wch:8},{wch:16},{wch:16}];
    X.utils.book_append_sheet(wb, ws2, '分组汇总');
    var fn='工资预算评估_'+_stamp()+'.xlsx';
    X.writeFile(wb, fn);
    toast('📘 已导出：'+fn+'（总额 ¥'+d.total.toLocaleString('zh-CN')+'）','success',3200);
  }
  /* ---- 转财务待发工资（后端制单入口强制 status=draft，复核走财务台账） ----
   * 失败策略：错误原因细分提示；可重试错误（网络/超时/限流/5xx）最多重试 3 次，
   * 不可重试错误（登录过期/无权限/数据校验/冲突重复/接口缺失）直接给定向指引；
   * 重试耗尽后锁定本次操作（防 tight-loop 与重复制单），刷新页面可重新计数。 */
  var W2F_MAX_RETRY=3;
  var _w2fBusy=false;
  var _w2fChain=false;   // 是否处于一次「失败链」中（成功或不可重试错误后复位）
  var _w2fAttempts=0;    // 当前失败链累计提交次数（含首次）
  var _w2fLocked=false;  // 重试上限耗尽，刷新前禁止再次提交
  var _w2fBtnDef='📒 转财务待发工资';
  var _w2fTitleDef='';
  var W2F_LAST_KEY='qaxqjt_wage2fin_last';
  function _w2fRetryBtn(show,left){
    var rb=$('tpBtnWage2FinRetry');
    if(!rb) return;
    rb.style.display=show?'':'none';
    if(show) rb.textContent='🔄 重试'+(typeof left==='number'?('（剩'+left+'次）'):'');
  }
  /* 失败原因细分：依据 err.status/code/name/message 归类
   * @returns {{kind:string,retryable:boolean,short:string,title:string,toast:string}} */
  function _w2fClassify(err){
    var st=err&&err.status, code=String((err&&err.code)||''), name=String((err&&err.name)||'');
    var msg=String((err&&err.message)||'未知错误').slice(0,200);
    var blob=(msg+' '+code).toLowerCase();
    if(!st||name==='AbortError'||/failed to fetch|networkerror|network|timeout|timed out|abort|econn|socket|load failed/i.test(blob)){
      return { kind:'network', retryable:true, short:'网络异常/超时',
        title:'网络异常或请求超时：'+msg+'（超时情况下凭证可能已在财务端生成，请先到「财务台账」核对，避免重复制单）',
        toast:'🌐 网络异常或请求超时（'+msg+'）。请检查网络后点「🔄 重试」；若可能已制单，请先到「财务台账」核对，避免重复。' };
    }
    if(st===401||/unauthorized|token_expired|invalid_token/i.test(blob))
      return { kind:'auth', retryable:false, short:'登录已过期',
        title:'登录已过期：'+msg,
        toast:'🔐 登录状态已过期，请刷新页面重新登录后再提交（直接重试无效）。' };
    if(st===403||/forbidden/i.test(blob))
      return { kind:'forbidden', retryable:false, short:'无转财务权限',
        title:'无转财务权限：'+msg,
        toast:'⛔ 当前账号没有「转财务制单」权限，请联系管理员授权后再操作（重试无效）。' };
    if(st===400||st===422||/validation|invalid|bad_?request/i.test(blob))
      return { kind:'validation', retryable:false, short:'数据校验未通过',
        title:'提交数据被后端拒绝：'+msg,
        toast:'📝 提交数据未通过校验：'+msg+'。请调整工资表（金额/人员/天数）后重新点击转财务，原参数直接重试无意义。' };
    if(st===409||/conflict|duplicate|already exists/i.test(blob))
      return { kind:'conflict', retryable:false, short:'凭证可能已存在',
        title:'冲突/重复提交：'+msg,
        toast:'⚠️ 后端提示可能已存在相同凭证（'+msg+'）。请先到「财务台账」核对，确认未制单后再重新提交，避免重复。' };
    if(st===404||/not_?found/i.test(blob))
      return { kind:'missing', retryable:false, short:'接口不存在',
        title:'转财务接口不存在：'+msg,
        toast:'🔧 转财务接口不存在或尚未部署（'+msg+'），请联系系统管理员处理（重试无效）。' };
    if(st===429||/rate|too many/i.test(blob))
      return { kind:'rate', retryable:true, short:'操作过于频繁',
        title:'请求被限流：'+msg,
        toast:'⏳ 操作过于频繁被限流（'+msg+'），请等待约 30 秒后再点「🔄 重试」。' };
    if(st===408)
      return { kind:'network', retryable:true, short:'请求超时',
        title:'请求超时：'+msg,
        toast:'⏱ 请求超时（'+msg+'），请检查网络后重试；必要时先到「财务台账」核对是否已制单。' };
    if(st&&st>=500)
      return { kind:'server', retryable:true, short:'服务端故障',
        title:'财务服务端暂时故障：HTTP '+st+' '+msg,
        toast:'🖥 财务服务暂时故障（HTTP '+st+'：'+msg+'），可点「🔄 重试」；若多次失败请先用「预算评估导出」备用并联系管理员。' };
    return { kind:'unknown', retryable:true, short:'未知错误',
      title:'未知错误：'+(st?('HTTP '+st+' '):'')+msg,
      toast:'⚠️ 转财务遇到未知错误（'+(st?('HTTP '+st+'：'):'')+msg+'），可点「🔄 重试」，仍失败请联系管理员。' };
  }
  function _w2fResetChain(){ _w2fChain=false; _w2fAttempts=0; _w2fLocked=false; }
  function _w2fBtnReset(btn){
    setTimeout(function(){
      if(btn&&!_w2fLocked){ btn.textContent=_w2fBtnDef; btn.disabled=false; btn.style.opacity=''; if(!_w2fChain) btn.title=_w2fTitleDef||''; }
      _w2fBusy=false;
    },4200);
  }
  function wageToFin(){
    var d=wageBudgetData(); if(!d) return;
    var btn=$('tpBtnWage2Fin');
    if(!(window.QAXQJT_API&&QAXQJT_API.post)){ toast('⚠️ API 组件未就绪，无法转财务','error',2600); return; }
    if(_w2fBusy){ toast('⏳ 正在转财务，请稍候…','warning',1500); return; }
    if(_w2fLocked){
      toast('⛔ 已连续提交失败、重试达上限（'+W2F_MAX_RETRY+' 次），为避免重复制单已停止重试。请先到「财务台账」核对是否已制单，或用「预算评估导出」备用；刷新页面后可重新提交，持续失败请联系管理员。','error',5600);
      return;
    }
    try{
      var last=JSON.parse(localStorage.getItem(W2F_LAST_KEY)||'null');
      if(!_w2fChain&&last&&last.day===new Date().toISOString().slice(0,10)&&last.no){ toast('ℹ️ 今日已生成过草稿凭证 '+last.no+'，本次将再新增一张','info',2800); }
    }catch(_){}
    if(!_w2fChain) _w2fAttempts=0;
    _w2fAttempts++;
    var isRetry=_w2fAttempts>1;
    _w2fBusy=true;
    _w2fRetryBtn(false);
    if(btn){ btn.disabled=true; btn.style.opacity='0.6'; btn.textContent=isRetry?('🔄 重试中…（'+(_w2fAttempts-1)+'/'+W2F_MAX_RETRY+'）'):'⏳ 转财务中…'; }
    var dayTotal=0; d.tpl.forEach(function(p){ dayTotal+=(p.daily||0); });
    QAXQJT_API.post('/v1/fin/ledger', {
      summary:'演出天工资预算（组团'+d.tpl.length+'人×'+d.days+'天）',
      voucherType:'payment',
      voucherCategory:'工资',
      debitAmount: d.total,
      status:'draft',
      remark:'预算评估转入待发工资：全员日薪合计 ¥'+dayTotal.toLocaleString('zh-CN')+'/天；明细见演出演员表-组团工资表（'+_stamp()+'）'
    }, { showErrorToast:false }).then(function(row){
      _w2fResetChain();
      var no=(row&&row.voucherNo)||'';
      try{ localStorage.setItem(W2F_LAST_KEY, JSON.stringify({ day:new Date().toISOString().slice(0,10), no:no, amount:d.total, at:new Date().toISOString() })); }catch(_){}
      if(btn){ btn.textContent='✅ 已转财务'; btn.title='最近凭证：'+(no||'（未返回凭证号）')+' · ¥'+d.total.toLocaleString('zh-CN')+'（草稿，待财务复核）'; }
      toast('📒 已生成财务待发工资草稿'+(no?('（凭证号 '+no+'）'):'')+'，请到「财务台账」复核','success',3600);
      _w2fBtnReset(btn);
    },function(err){
      var c=_w2fClassify(err);
      _w2fBusy=false;
      if(btn){ btn.disabled=false; btn.style.opacity=''; btn.title=c.title; }
      if(!c.retryable){
        // 不可重试错误：不显示重试按钮，结束失败链（用户修正数据/重新登录后的提交视为新链）
        _w2fChain=false;
        _w2fRetryBtn(false);
        if(btn) btn.textContent='❌ '+c.short;
        toast(c.toast,'error',5400);
        setTimeout(function(){ if(btn){ btn.textContent=_w2fBtnDef; } },4200);
        return;
      }
      // 可重试错误：累计失败链提交次数，未到上限显示剩余重试次数
      _w2fChain=true;
      var left=W2F_MAX_RETRY-(_w2fAttempts-1);
      if(left>0){
        if(btn) btn.textContent='⚠️ 转财务失败·点此重试（剩'+left+'次）';
        _w2fRetryBtn(true,left);
        toast(c.toast+'（第'+_w2fAttempts+'次提交失败，还可重试 '+left+' 次）','error',5000);
      }else{
        _w2fLocked=true; _w2fChain=false;
        _w2fRetryBtn(false);
        if(btn){ btn.textContent='❌ 转财务失败（重试已达上限'+W2F_MAX_RETRY+'次）'; btn.title=c.title+'｜已连续提交 '+_w2fAttempts+' 次均失败。'; }
        toast(c.toast+' ⛔ 已达重试上限（'+W2F_MAX_RETRY+' 次），为避免重复制单已停止。请先到「财务台账」核对或用「预算评估导出」备用，刷新页面后可再试，持续失败请联系管理员。','error',6500);
      }
    });
  }
  // 暴露分类器供自动化测试（页面业务无其他用途）
  try{ window.__w2fClassify=_w2fClassify; window.__W2F_MAX_RETRY=function(){ return W2F_MAX_RETRY; }; }catch(_){}
  // 页面载入：保存按钮默认 title；把上次转财务的凭证号恢复到按钮 title（状态持久提示）
  (function(){
    try{
      var b0=$('tpBtnWage2Fin');
      if(b0) _w2fTitleDef=b0.title||'';
      var last=JSON.parse(localStorage.getItem(W2F_LAST_KEY)||'null');
      if(last&&last.no&&b0) b0.title='最近转财务：'+last.no+' · ¥'+Number(last.amount||0).toLocaleString('zh-CN')+'（'+_fmtTime(last.at)+'，草稿待复核）';
    }catch(_){}
  })();
  /* =====================================================================
     20261016 新增三大功能：① 角色关联库  ② 权限控制  ③ 版本历史管理
     原则：最小必要改动 · 全部本地存储持久化 · 不改后端 · 复用既有弹窗与绑定规范
     ===================================================================== */
  /* ---------- ① 权限控制（基于 qaxqjt_admin_session 角色等级） ---------- */
  var __CAST_ROLE_LEVEL = { super_admin:999, admin:999, ops:800, director:700, finance_checker:600, finance_cashier:520, finance_maker:550, finance_view:510, finance_admin:500, finance:500, staff:100 };
  function __castSession(){ try{ var raw=localStorage.getItem('qaxqjt_admin_session'); return raw?JSON.parse(raw):null; }catch(_){ return null; } }
  function __castLevel(){ var s=__castSession(); if(!s) return 0; return __CAST_ROLE_LEVEL[s.role]||0; }
  function __castUserName(){ var s=__castSession(); return (s&&(s.name||s.username||s.realName||s.account))||'未知用户'; }
  function __castCan(perm){
    var lv=__castLevel();
    if(perm==='manage') return lv>=999;   // 破坏性/管理类：删除存档、重置空白、批量导入、版本回滚、清空历史
    if(perm==='edit')   return lv>=800;   // 内容编辑（页面级已要求 ≥800）
    return lv>=100;                        // view 只读
  }
  function __castDeny(what){ toast('🔒 当前角色无「'+what+'」权限，请联系超级管理员','error',2800); }
  var __CAST_MANAGE_BTN_IDS = ['csBtnDelete','btnReset','btnImportXlsx'];
  function __castApplyPerm(){
    var canManage=__castCan('manage'); var canEdit=__castCan('edit');
    __CAST_MANAGE_BTN_IDS.forEach(function(id){
      var b=$(id); if(!b) return;
      if(!canManage){
        b.disabled=true; b.style.opacity='.45'; b.style.cursor='not-allowed'; b.setAttribute('data-perm-blocked','1');
        b.title=(b.title?b.title+' · ':'')+'需超级管理员(999)权限';
      } else {
        b.disabled=false; b.style.opacity=''; b.style.cursor=''; b.removeAttribute('data-perm-blocked');
      }
    });
    var bar=$('castSheetManagerBar');
    if(bar && !$('castPermBadge')){
      var lvl=__castLevel(); var s=__castSession();
      var label = lvl>=999?'管理员 · 全部权限': lvl>=800?'运营 · 可编辑(无破坏性操作)': lvl>=100?'只读 · 仅查看':'未登录';
      var span=document.createElement('span');
      span.id='castPermBadge';
      span.style.cssText='font-size:.76rem;padding:3px 10px;border-radius:20px;background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;white-space:nowrap;';
      span.title='当前登录角色：'+((s&&s.role)||'anonymous')+'（权限等级 '+lvl+'）';
      span.textContent='🛡️ '+((s&&s.role)||'anonymous')+' · '+label;
      bar.appendChild(span);
    }
    if(!canEdit){ document.body.setAttribute('data-cast-readonly','1'); }
  }

  /* ---------- ② 角色关联库（角色→行当 映射 + 角色→常用演员 关联） ---------- */
  var RL_TYPE_KEY='qaxqjt_cast_role_type_lib_v1';
  var RL_ACTOR_KEY='qaxqjt_cast_role_actor_lib_v1';
  function _rlGet(k){ try{ var r=localStorage.getItem(k); return r?JSON.parse(r):{}; }catch(_){ return {}; } }
  function _rlSet(k,o){ try{ localStorage.setItem(k,JSON.stringify(o||{})); }catch(_){} }
  function _rlTypeOptions(){
    var h=window.__castSheetHook;
    return (h&&h.typeOptions)||['文须生','武须生','小生','丑角','大花脸','二花脸','正旦','小旦','彩旦','二架旦','门官','家院','龙套','校尉','刀斧手','丫鬟','彩女','长随官','电工','前场','剧务','衣箱'];
  }
  function _rlCollect(){
    var tBody=$('rlTypeBody'), aBody=$('rlActorBody');
    // 20261016 加固：某张表不存在时（弹窗未构建/未渲染）保留已存库，禁止把已有映射覆盖为空
    if(!tBody && !aBody){ return { types:_rlGet(RL_TYPE_KEY), actors:_rlGet(RL_ACTOR_KEY) }; }
    var types = tBody ? {} : _rlGet(RL_TYPE_KEY);
    var actors = aBody ? {} : _rlGet(RL_ACTOR_KEY);
    if(tBody){ tBody.querySelectorAll('tr[data-row="1"]').forEach(function(tr){
      var rn=((tr.querySelector('input[data-f="role"]')||{}).value||'').trim();
      var tp=(tr.querySelector('select[data-f="type"]')||{}).value||'';
      if(rn) types[rn]=tp;
    }); }
    if(aBody){ aBody.querySelectorAll('tr[data-row="1"]').forEach(function(tr){
      var rn2=((tr.querySelector('input[data-f="role"]')||{}).value||'').trim();
      var ac=((tr.querySelector('input[data-f="actors"]')||{}).value||'').trim();
      if(rn2) actors[rn2]=ac;
    }); }
    _rlSet(RL_TYPE_KEY,types); _rlSet(RL_ACTOR_KEY,actors);
    return { types:types, actors:actors };
  }
  function roleLinkOpen(){
    if(!__castCan('edit')){ __castDeny('角色关联'); return; }
    var m=$('roleLinkModal'); if(!m){ buildRoleLinkModal(); m=$('roleLinkModal'); }
    renderRoleLinkTables();
    window.__revealLayer(m); m.style.display='flex'; document.body.classList.add('body-modal-locked');
  }
  function roleLinkClose(){ var m=$('roleLinkModal'); if(m) m.style.display='none'; document.body.classList.remove('body-modal-locked'); }
  function buildRoleLinkModal(){
    var d=document.createElement('div');
    d.id='roleLinkModal';
    d.style.cssText='display:none;position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,0.55);align-items:flex-start;justify-content:center;padding-top:6vh;overflow-y:auto;transform:none!important;';
    d.innerHTML='<div style="background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3);width:min(880px,96vw);max-height:88vh;overflow-y:auto;">'
      +'<div style="padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;"><h3 style="margin:0;font-size:1.1rem;font-weight:700;color:#0f4c81;">🔗 角色关联库</h3><button type="button" id="rlClose" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#64748b;">✕</button></div>'
      +'<div style="padding:12px 22px 4px;font-size:.82rem;color:#64748b;line-height:1.6;">「角色 → 行当」用于给同名角色自动带入行当；「角色 → 常用演员」用于一键填充 A/B/C 角（多位演员用「、」或「,」分隔）。点「⚡ 应用到当前演出」把映射写入当前演员表所有剧目。</div>'
      +'<div style="padding:8px 22px 6px;display:flex;gap:16px;flex-wrap:wrap;">'
      +'<div style="flex:1 1 340px;min-width:290px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;"><h4 style="margin:0;font-size:.95rem;color:#1e3a8a;">🎭 角色 → 行当</h4><button type="button" id="rlTypeAdd" style="padding:4px 10px;border:1px solid #0284c7;background:#fff;color:#0284c7;border-radius:7px;cursor:pointer;font-size:.78rem;">＋ 新增</button></div><div id="rlTypeBox"></div></div>'
      +'<div style="flex:1 1 340px;min-width:290px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;"><h4 style="margin:0;font-size:.95rem;color:#1e3a8a;">🧑‍🎤 角色 → 常用演员</h4><button type="button" id="rlActorAdd" style="padding:4px 10px;border:1px solid #0284c7;background:#fff;color:#0284c7;border-radius:7px;cursor:pointer;font-size:.78rem;">＋ 新增</button></div><div id="rlActorBox"></div></div>'
      +'</div>'
      +'<div id="rlMsg" style="padding:0 22px 6px;font-size:.8rem;color:#0f766e;min-height:18px;"></div>'
      +'<div style="padding:14px 22px 20px;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">'
      +'<button type="button" id="rlExtract" style="padding:9px 16px;border:1px solid #7c3aed;background:#fff;color:#7c3aed;border-radius:9px;cursor:pointer;font-weight:600;">📋 从当前演出提取角色</button>'
      +'<button type="button" id="rlApply" style="padding:9px 20px;border:none;background:#0f4c81;color:#fff;border-radius:9px;cursor:pointer;font-weight:700;">⚡ 应用到当前演出</button>'
      +'<button type="button" id="rlDone" style="padding:9px 20px;border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:9px;cursor:pointer;">完成</button>'
      +'</div></div>';
    document.body.appendChild(d);
    ['rlClose','rlDone'].forEach(function(id){ var b=$(id); if(b){ markSafe(b); b.addEventListener('click',roleLinkClose,true); } });
    var ta=$('rlTypeAdd'); if(ta){ markSafe(ta); ta.addEventListener('click',function(){ roleLinkAddRow('type'); },true); }
    var aa=$('rlActorAdd'); if(aa){ markSafe(aa); aa.addEventListener('click',function(){ roleLinkAddRow('actor'); },true); }
    var ex=$('rlExtract'); if(ex){ markSafe(ex); ex.addEventListener('click',roleLinkExtract,true); }
    var ap=$('rlApply'); if(ap){ markSafe(ap); ap.addEventListener('click',function(){ roleLinkApplyToShow(); roleLinkClose(); },true); }
    d.addEventListener('change',function(ev){ if(ev.target&&ev.target.getAttribute&&ev.target.getAttribute('data-f')){ _rlCollect(); } });
    d.addEventListener('click',function(e){ if(e.target===d) roleLinkClose(); });
  }
  function _rlDelRow(kind, rn){
    var lib=_rlGet(kind==='type'?RL_TYPE_KEY:RL_ACTOR_KEY); if(rn) delete lib[rn];
    _rlSet(kind==='type'?RL_TYPE_KEY:RL_ACTOR_KEY, lib);
    renderRoleLinkTables();
  }
  function renderRoleLinkTables(){
    var types=_rlGet(RL_TYPE_KEY), actors=_rlGet(RL_ACTOR_KEY);
    var tOpts=_rlTypeOptions();
    function typeOpts(cur){ var extra=(cur&&tOpts.indexOf(cur)<0)?'<option selected>'+_hx(cur)+'</option>':''; return extra+tOpts.map(function(o){ return '<option'+(o===cur?' selected':'')+'>'+_hx(o)+'</option>'; }).join(''); }
    var T=Object.keys(types), A=Object.keys(actors);
    var tbox=$('rlTypeBox'), abox=$('rlActorBox'); if(!tbox||!abox) return;
    var ipt='width:100%;padding:5px 7px;border:1px solid #cbd5e1;border-radius:6px;';
    var delBtn='border:1px solid #fca5a5;background:#fff;color:#b91c1c;border-radius:6px;cursor:pointer;padding:3px 8px;';
    var thT='<thead><tr><th style="text-align:left;padding:6px;border-bottom:2px solid #e2e8f0;">角色名</th><th style="padding:6px;border-bottom:2px solid #e2e8f0;">行当</th><th style="width:46px;border-bottom:2px solid #e2e8f0;"></th></tr></thead>';
    var tRows=T.length?T.map(function(rn){ return '<tr data-row="1"><td style="padding:4px 2px;"><input data-f="role" value="'+_hx(rn)+'" style="'+ipt+'"></td>'
      +'<td style="padding:4px 2px;"><select data-f="type" style="'+ipt+'">'+typeOpts(types[rn])+'</select></td>'
      +'<td style="padding:4px 2px;text-align:center;"><button type="button" class="rl-del" data-kind="type" data-rn="'+_hx(rn)+'" style="'+delBtn+'">✕</button></td></tr>'; }).join('')
      :'<tr><td colspan="3" style="padding:16px 6px;text-align:center;color:#94a3b8;">暂无映射</td></tr>';
    var thA='<thead><tr><th style="text-align:left;padding:6px;border-bottom:2px solid #e2e8f0;">角色名</th><th style="padding:6px;border-bottom:2px solid #e2e8f0;">常用演员（A/B/C 顺序）</th><th style="width:46px;border-bottom:2px solid #e2e8f0;"></th></tr></thead>';
    var aRows=A.length?A.map(function(rn){ return '<tr data-row="1"><td style="padding:4px 2px;width:34%;"><input data-f="role" value="'+_hx(rn)+'" style="'+ipt+'"></td>'
      +'<td style="padding:4px 2px;"><input data-f="actors" list="datalist-performers-all" value="'+_hx(actors[rn])+'" placeholder="如：张三、李四" style="'+ipt+'"></td>'
      +'<td style="padding:4px 2px;text-align:center;width:46px;"><button type="button" class="rl-del" data-kind="actor" data-rn="'+_hx(rn)+'" style="'+delBtn+'">✕</button></td></tr>'; }).join('')
      :'<tr><td colspan="3" style="padding:16px 6px;text-align:center;color:#94a3b8;">暂无关联</td></tr>';
    tbox.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:.84rem;">'+thT+'<tbody id="rlTypeBody">'+tRows+'</tbody></table>';
    abox.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:.84rem;">'+thA+'<tbody id="rlActorBody">'+aRows+'</tbody></table>';
    var dels=document.querySelectorAll('#roleLinkModal .rl-del');
    for(var i=0;i<dels.length;i++){ var b=dels[i]; markSafe(b); b.addEventListener('click',function(e){
      var btn=e.currentTarget||e.target; _rlCollect();
      _rlDelRow(btn.getAttribute('data-kind'), btn.getAttribute('data-rn'));
    },true); }
  }
  function roleLinkAddRow(kind){
    _rlCollect();
    var body=$(kind==='type'?'rlTypeBody':'rlActorBody'); if(!body) return;
    var ipt='width:100%;padding:5px 7px;border:1px solid #cbd5e1;border-radius:6px;';
    var delBtn='border:1px solid #fca5a5;background:#fff;color:#b91c1c;border-radius:6px;cursor:pointer;padding:3px 8px;';
    var tr=document.createElement('tr'); tr.setAttribute('data-row','1');
    if(kind==='type'){
      var tOpts=_rlTypeOptions();
      tr.innerHTML='<td style="padding:4px 2px;"><input data-f="role" placeholder="角色名" style="'+ipt+'"></td>'
        +'<td style="padding:4px 2px;"><select data-f="type" style="'+ipt+'">'+tOpts.map(function(o){ return '<option>'+_hx(o)+'</option>'; }).join('')+'</select></td>'
        +'<td style="padding:4px 2px;text-align:center;"><button type="button" class="rl-del" data-kind="type" style="'+delBtn+'">✕</button></td>';
    } else {
      tr.innerHTML='<td style="padding:4px 2px;width:34%;"><input data-f="role" placeholder="角色名" style="'+ipt+'"></td>'
        +'<td style="padding:4px 2px;"><input data-f="actors" list="datalist-performers-all" placeholder="如：张三、李四" style="'+ipt+'"></td>'
        +'<td style="padding:4px 2px;text-align:center;width:46px;"><button type="button" class="rl-del" data-kind="actor" style="'+delBtn+'">✕</button></td>';
    }
    var empty=body.querySelector('td[colspan]'); if(empty) body.innerHTML='';
    body.appendChild(tr);
    var nb=tr.querySelector('.rl-del');
    if(nb){ markSafe(nb); nb.addEventListener('click',function(){ _rlCollect(); var rn=(tr.querySelector('input[data-f="role"]')||{}).value||''; _rlDelRow(nb.getAttribute('data-kind'), String(rn).trim()); },true); }
    var inp=tr.querySelector('input[data-f="role"]'); if(inp) try{ inp.focus(); }catch(_){}
  }
  function roleLinkExtract(){
    var hook=window.__castSheetHook; if(!hook||!hook.getState){ toast('⚠️ 页面内核未就绪，请刷新重试','error',2400); return; }
    var st=hook.getState(); var types=_rlGet(RL_TYPE_KEY), actors=_rlGet(RL_ACTOR_KEY);
    var addedT=0, addedA=0, seen={};
    ['mainOpera','addOpera'].forEach(function(k){
      (st[k]||[]).forEach(function(op){ (op.cast||[]).forEach(function(c){
        var rn=(c.role||'').trim(); if(!rn||seen[rn]) return; seen[rn]=1;
        if(typeof types[rn]==='undefined'){ types[rn]=c.type||''; addedT++; }
        if(typeof actors[rn]==='undefined'){ actors[rn]=[c.actorA,c.actorB,c.actorC].filter(Boolean).join('、'); addedA++; }
      }); });
    });
    _rlSet(RL_TYPE_KEY,types); _rlSet(RL_ACTOR_KEY,actors);
    renderRoleLinkTables();
    var total=Object.keys(seen).length;
    var msg=$('rlMsg'); if(msg) msg.textContent='✅ 已扫描 '+total+' 个角色（新增行当映射 '+addedT+' 条、演员关联 '+addedA+' 条），请按需微调后点「⚡ 应用到当前演出」。';
    toast('📋 已从当前演出提取 '+total+' 个角色','success',2800);
  }
  function roleLinkApplyToShow(){
    var lib=_rlCollect(); var types=lib.types, actors=lib.actors;
    var hook=window.__castSheetHook; if(!hook||!hook.getState){ toast('⚠️ 页面内核未就绪，请刷新重试','error',2400); return; }
    var st=hook.getState(); var hitType=0, hitActor=0;
    ['mainOpera','addOpera'].forEach(function(k){
      (st[k]||[]).forEach(function(op){ (op.cast||[]).forEach(function(c){
        var rn=(c.role||'').trim(); if(!rn) return;
        // 20261016 与演员填充同语义：仅补空缺，不覆盖已手工填写的行当，避免"应用映射"造成数据丢失
        if(types[rn] && !c.type){ c.type=types[rn]; hitType++; }
        var list=String(actors[rn]||'').split(/[、,，;；\/\s]+/).filter(Boolean);
        if(list.length){
          if(!c.actorA&&list[0]){ c.actorA=list[0]; hitActor++; }
          if(!c.actorB&&list[1]){ c.actorB=list[1]; }
          if(!c.actorC&&list[2]){ c.actorC=list[2]; }
        }
      }); });
    });
    if(hook.render) hook.render();
    toast('⚡ 已应用角色关联：行当匹配 '+hitType+' 处 · 演员填充 '+hitActor+' 人','success',3200);
  }

  /* ---------- ③ 版本历史管理 ---------- */
  var VER_KEY='qaxqjt_cast_versions_v1';
  var VER_MAX=30;
  function _verAll(){ try{ var r=localStorage.getItem(VER_KEY); return r?JSON.parse(r):[]; }catch(_){ return []; } }
  function _verSet(a){ try{ localStorage.setItem(VER_KEY,JSON.stringify(a||[])); }catch(_){} }
  function _verId(){ return 'v_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7); }
  function _verSnapshot(note, silent){
    var hook=window.__castSheetHook; if(!hook||!hook.getState) return null;
    var st=hook.getState(); if(!st) return null;
    var json; try{ json=JSON.stringify(st); }catch(_){ return null; }
    if(json.length>400000){ if(!silent) toast('⚠️ 当前数据过大，已跳过版本记录','warning',2500); return null; }
    var list=_verAll();
    // 同一秒内重复保存去重（避免连点产生重复版本）
    if(list.length && list[0].size===json.length && Math.abs(new Date(list[0].at).getTime()-Date.now())<1500) return list[0];
    var rec={ id:_verId(), at:new Date().toISOString(), author:__castUserName(), sheet:(st.header&&st.header.title)||'未命名演出', note:note||'', size:json.length, data:JSON.parse(json) };
    list.unshift(rec); if(list.length>VER_MAX) list.length=VER_MAX;
    _verSet(list);
    if(!silent) toast('📸 已记录版本（'+Math.max(1,Math.round(json.length/1024))+'KB）· '+rec.sheet,'success',2400);
    return rec;
  }
  function versionSummary(d){
    if(!d) return '';
    function n(k){ return (d[k]||[]).length; }
    var castCnt=0; ['mainOpera','addOpera'].forEach(function(k){ (d[k]||[]).forEach(function(op){ castCnt+=(op.cast||[]).length; }); });
    return '演出标题：'+((d.header&&d.header.title)||'（未填）')+'　｜　主创 '+n('creative')+' 人　｜　主场剧目 '+n('mainOpera')+' 部　｜　加演 '+n('addOpera')+' 部　｜　角色行合计 '+castCnt+' 行　｜　武场 '+n('wuchang')+'　｜　文场 '+n('wenchang')+'　｜　舞台保障 '+n('stage')+'　｜　节目单 '+n('program')+' 条';
  }
  function versionsOpen(){
    if(!__castCan('view')){ __castDeny('版本历史'); return; }
    var m=$('versionsModal'); if(!m){ buildVersionsModal(); m=$('versionsModal'); }
    renderVersionsList();
    window.__revealLayer(m); m.style.display='flex'; document.body.classList.add('body-modal-locked');
  }
  function versionsClose(){ var m=$('versionsModal'); if(m) m.style.display='none'; document.body.classList.remove('body-modal-locked'); }
  function buildVersionsModal(){
    var d=document.createElement('div');
    d.id='versionsModal';
    d.style.cssText='display:none;position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,0.55);align-items:flex-start;justify-content:center;padding-top:8vh;overflow-y:auto;transform:none!important;';
    d.innerHTML='<div style="background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3);width:min(900px,96vw);max-height:86vh;overflow-y:auto;">'
      +'<div style="padding:18px 22px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;"><h3 style="margin:0;font-size:1.1rem;font-weight:700;color:#0f4c81;">🕘 演员表版本历史</h3><div style="display:flex;gap:8px;align-items:center;"><button type="button" id="verRecord" style="padding:6px 12px;border:1px solid #0284c7;background:#fff;color:#0284c7;border-radius:8px;cursor:pointer;font-size:.8rem;">📸 记录当前版本</button><button type="button" id="verClear" style="padding:6px 12px;border:1px solid #fca5a5;background:#fff;color:#b91c1c;border-radius:8px;cursor:pointer;font-size:.8rem;">🗑 清空历史</button><button type="button" id="verClose" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#64748b;">✕</button></div></div>'
      +'<div style="padding:10px 22px 0;font-size:.8rem;color:#64748b;">每次点「💾 保存本地」会自动记录一个版本，最多保留 '+VER_MAX+' 个；回滚前会自动备份当前版本，可再次回滚恢复。</div>'
      +'<div style="padding:12px 22px 20px;"><div id="verList"></div></div></div>';
    document.body.appendChild(d);
    var rc=$('verClose'); if(rc){ markSafe(rc); rc.addEventListener('click',versionsClose,true); }
    var rr=$('verRecord'); if(rr){ markSafe(rr); rr.addEventListener('click',function(){
      var n=prompt('本次版本说明（可留空）：',''); if(n===null) return;
      _verSnapshot(String(n).trim()||'手动记录', false); renderVersionsList();
    },true); }
    var cc=$('verClear'); if(cc){ markSafe(cc); cc.addEventListener('click',function(){
      if(!__castCan('manage')){ __castDeny('清空版本历史'); return; }
      if(!window.confirm('确定清空全部版本历史？此操作不可撤销。')) return;
      _verSet([]); renderVersionsList(); toast('🗑 已清空版本历史','success',2000);
    },true); }
    d.addEventListener('click',function(e){ if(e.target===d) versionsClose(); });
  }
  function renderVersionsList(){
    var box=$('verList'); if(!box) return;
    var list=_verAll();
    if(!list.length){ box.innerHTML='<div style="text-align:center;color:#94a3b8;padding:36px 0;font-size:.9rem;">暂无历史版本。<br>点「💾 保存本地」会自动记录，或点上方「📸 记录当前版本」手动记录。</div>'; return; }
    var h='<table style="width:100%;border-collapse:collapse;font-size:.84rem;"><thead><tr>'
      +'<th style="text-align:left;padding:8px 6px;border-bottom:2px solid #e2e8f0;">记录时间</th>'
      +'<th style="text-align:left;padding:8px 6px;border-bottom:2px solid #e2e8f0;">演出名称</th>'
      +'<th style="padding:8px 6px;border-bottom:2px solid #e2e8f0;">记录人</th>'
      +'<th style="padding:8px 6px;border-bottom:2px solid #e2e8f0;">说明</th>'
      +'<th style="padding:8px 6px;border-bottom:2px solid #e2e8f0;">大小</th>'
      +'<th style="padding:8px 6px;border-bottom:2px solid #e2e8f0;width:230px;">操作</th></tr></thead><tbody>';
    list.forEach(function(v){
      h+='<tr data-ver-id="'+_hx(v.id)+'" style="border-bottom:1px solid #f1f5f9;">'
        +'<td style="padding:8px 6px;color:#334155;white-space:nowrap;">'+_hx(_fmtTime(v.at))+'</td>'
        +'<td style="padding:8px 6px;font-weight:600;color:#334155;">'+_hx(v.sheet||'未命名')+'</td>'
        +'<td style="padding:8px 6px;color:#64748b;font-size:.8rem;">'+_hx(v.author||'')+'</td>'
        +'<td style="padding:8px 6px;color:#64748b;font-size:.8rem;">'+_hx(v.note||'—')+'</td>'
        +'<td style="padding:8px 6px;color:#64748b;font-size:.8rem;text-align:center;">'+Math.max(1,Math.round((v.size||0)/1024))+'KB</td>'
        +'<td style="padding:8px 6px;text-align:center;white-space:nowrap;">'
        +'<button type="button" class="ver-act" data-vact="preview" style="padding:5px 10px;margin:0 2px;border:1px solid #0284c7;background:#fff;color:#0284c7;border-radius:7px;cursor:pointer;font-size:.78rem;">👁 摘要</button>'
        +'<button type="button" class="ver-act" data-vact="rollback" style="padding:5px 10px;margin:0 2px;border:1px solid #d97706;background:#fff;color:#d97706;border-radius:7px;cursor:pointer;font-size:.78rem;">↩ 回滚</button>'
        +'<button type="button" class="ver-act" data-vact="del" style="padding:5px 10px;margin:0 2px;border:1px solid #dc2626;background:#fff;color:#dc2626;border-radius:7px;cursor:pointer;font-size:.78rem;">🗑 删除</button>'
        +'</td></tr>';
    });
    h+='</tbody></table><div id="verPreview" style="margin-top:10px;font-size:.82rem;color:#0f766e;line-height:1.6;"></div>';
    box.innerHTML=h;
    var acts=box.querySelectorAll('.ver-act');
    for(var i=0;i<acts.length;i++){ var b=acts[i]; markSafe(b); b.addEventListener('click',onVersionAct,true); }
  }
  function onVersionAct(e){
    var btn=e.currentTarget||e.target;
    var tr=btn.closest&&btn.closest('tr[data-ver-id]'); if(!tr) return;
    var id=tr.getAttribute('data-ver-id'), act=btn.getAttribute('data-vact');
    var list=_verAll(), rec=null;
    for(var i=0;i<list.length;i++){ if(list[i].id===id) rec=list[i]; }
    if(!rec){ toast('⚠️ 版本不存在或已被删除','warning',2000); renderVersionsList(); return; }
    if(act==='preview'){
      var pv=$('verPreview'); if(pv) pv.textContent='【'+_fmtTime(rec.at)+' · '+rec.author+'】'+versionSummary(rec.data);
    } else if(act==='rollback'){
      if(!__castCan('manage')){ __castDeny('版本回滚'); return; }
      if(!window.confirm('确定回滚到「'+_fmtTime(rec.at)+'」版本？当前数据会先自动备份。')) return;
      try{ _verSnapshot('回滚前自动备份', true); }catch(_){}
      var hook=window.__castSheetHook;
      if(!hook||!hook.applyState){ toast('⚠️ 页面内核未就绪，无法回滚','error',2400); return; }
      hook.applyState(rec.data);
      try{ if(hook.persist) hook.persist(); }catch(_){}
      toast('↩ 已回滚到「'+_fmtTime(rec.at)+'」并自动备份回滚前数据','success',3200);
      renderVersionsList();
    } else if(act==='del'){
      if(!__castCan('manage')){ __castDeny('删除版本'); return; }
      _verSet(list.filter(function(v){ return v.id!==id; }));
      renderVersionsList(); toast('🗑 已删除该版本','success',1800);
    }
  }
  // 自动化测试钩子（页面业务无其他用途）
  try{
    window.__castPerm = { level:__castLevel, can:__castCan, apply:__castApplyPerm, user:__castUserName };
    window.__castRoleHook = { open:roleLinkOpen, apply:roleLinkApplyToShow, extract:roleLinkExtract, typeLib:function(){ return _rlGet(RL_TYPE_KEY); }, actorLib:function(){ return _rlGet(RL_ACTOR_KEY); } };
    window.__castVerHook = { snapshot:_verSnapshot, list:_verAll, summary:versionSummary, clear:function(){ _verSet([]); } };
  }catch(_hookErr){}

  function bindAll(){
    var btnNew=$('csBtnNew'); var btnSaveAs=$('csBtnSaveAs'); var btnDelete=$('csBtnDelete'); var selSheet=$('csSheetSelect');
    if(btnNew&&!btnNew.__csBound){ btnNew.__csBound=1; btnNew.__superPatchBound=1; btnNew.addEventListener('click',newSheet,true); }
    if(btnSaveAs&&!btnSaveAs.__csBound){ btnSaveAs.__csBound=1; btnSaveAs.__superPatchBound=1; btnSaveAs.addEventListener('click',saveAsSheet,true); }
    if(btnDelete&&!btnDelete.__csBound){ btnDelete.__csBound=1; btnDelete.__superPatchBound=1; btnDelete.addEventListener('click',deleteSheet,true); }
    if(selSheet&&!selSheet.__csBound){ selSheet.__csBound=1; selSheet.addEventListener('change',function(){ switchSheet(this.value); }); }
    var btnSeed=$('tpBtnSeed'); var btnLoad=$('tpBtnLoad'); var btnSync=$('tpBtnSync2Cast'); var btnWagePrint=$('tpBtnWagePrint'); var btnWage2Fin=$('tpBtnWage2Fin'); var btnCustom=$('tpBtnCustom');
    if(btnSeed&&!btnSeed.__csBound){ btnSeed.__csBound=1; btnSeed.__superPatchBound=1; btnSeed.addEventListener('click',seed36,true); }
    if(btnCustom&&!btnCustom.__csBound){ btnCustom.__csBound=1; btnCustom.__superPatchBound=1; btnCustom.addEventListener('click',openCustomGroupModal,true); }
    if(btnLoad&&!btnLoad.__csBound){ btnLoad.__csBound=1; btnLoad.__superPatchBound=1; btnLoad.addEventListener('click',loadTemplate,true); }
    if(btnSync&&!btnSync.__csBound){ btnSync.__csBound=1; btnSync.__superPatchBound=1; btnSync.addEventListener('click',syncToCast,true); }
    if(btnWagePrint&&!btnWagePrint.__csBound){ btnWagePrint.__csBound=1; btnWagePrint.__superPatchBound=1; btnWagePrint.addEventListener('click',printWageSheet,true); }
    if(btnWage2Fin&&!btnWage2Fin.__csBound){ btnWage2Fin.__csBound=1; btnWage2Fin.__superPatchBound=1; btnWage2Fin.addEventListener('click',wageToFin,true); }
    var btnW2fRetry=$('tpBtnWage2FinRetry');
    if(btnW2fRetry&&!btnW2fRetry.__csBound){ btnW2fRetry.__csBound=1; btnW2fRetry.__superPatchBound=1; btnW2fRetry.addEventListener('click',function(){ wageToFin(); },true); }
    var daysInput=$('tpDays'); if(daysInput&&!daysInput.__csBound){ daysInput.__csBound=1; daysInput.addEventListener('input',function(){ var tpl=getCurrentTemplate(); if(tpl) updateTroupeStats(tpl); }); }
    // 打印范围选择按钮
    var psSelAll=$('psSelectAll'); var psClrAll=$('psClearAll'); var psOperaOnly=$('psSelectOperaOnly');
    var psPrint=$('btnPrintSelected')||$('btnPrintSelected2'); var psXlsx=$('btnXlsxSelected');
    function __getPsCbs(){ return document.querySelectorAll('input[type="checkbox"][data-ps-cb-sec]'); }
    if(psSelAll&&!psSelAll.__csBound){ psSelAll.__csBound=1; psSelAll.__superPatchBound=1; psSelAll.addEventListener('click',function(){ __getPsCbs().forEach(function(c){ c.checked=true; }); toast('☑️ 已全选所有打印板块','success',1500); },true); }
    if(psClrAll&&!psClrAll.__csBound){ psClrAll.__csBound=1; psClrAll.__superPatchBound=1; psClrAll.addEventListener('click',function(){ __getPsCbs().forEach(function(c){ c.checked=false; }); toast('❌ 已清空所有勾选','info',1500); },true); }
    if(psOperaOnly&&!psOperaOnly.__csBound){ psOperaOnly.__csBound=1; psOperaOnly.__superPatchBound=1; psOperaOnly.addEventListener('click',function(){ __getPsCbs().forEach(function(c){ c.checked=(c.getAttribute('data-ps-cb-sec')==='mainOpera'||c.getAttribute('data-ps-cb-sec')==='addOpera'); }); toast('🎭 已仅选场次剧目板块','success',1500); },true); }
    if(psPrint&&!psPrint.__csBound){ psPrint.__csBound=1; psPrint.__superPatchBound=1; psPrint.addEventListener('click',function(e){ try{ e.preventDefault(); e.stopPropagation(); }catch(_){} var cbs=__getPsCbs(); var checked=[].filter.call(cbs,function(c){return c.checked;}); if(checked.length===0){ toast('⚠️ 请先勾选要打印的板块','warning',2000); return; } toast('🖨 正在打印 '+checked.length+' 个勾选板块...','info',1500); setTimeout(function(){ try{ window.print(); }catch(_e){ toast('⚠️ 打印调用失败，请用 Ctrl+P 手动打印','warning',2500); } },400); },true); }
    if(psXlsx&&!psXlsx.__csBound){ psXlsx.__csBound=1; psXlsx.__superPatchBound=1; psXlsx.addEventListener('click',function(e){ try{ e.preventDefault(); e.stopPropagation(); }catch(_){} var cbs=__getPsCbs(); var checked=[].filter.call(cbs,function(c){return c.checked;}); if(checked.length===0){ toast('⚠️ 请先勾选要导出的板块','warning',2000); return; } if(typeof window.__csExportSelectedXlsx==='function'){ window.__csExportSelectedXlsx(); } else { toast('⚠️ 导出组件未就绪，请刷新页面重试','error',2500); } },true); }
    // 工资表操作按钮（20260928 全部真实化）
    var tpWgCsv=$('tpBtnWageCsv'), tpWgXlsx=$('tpBtnWageXlsx'), tpSaveAs=$('tpBtnSaveAs'), tpManage=$('tpBtnManage'), tpWgEdit=$('tpBtnWgEdit'), btnXlsxAll=$('btnXlsxAll');
    if(tpWgCsv&&!tpWgCsv.__csBound){ tpWgCsv.__csBound=1; tpWgCsv.__superPatchBound=1; tpWgCsv.addEventListener('click',wageCsv,true); }
    if(tpWgXlsx&&!tpWgXlsx.__csBound){ tpWgXlsx.__csBound=1; tpWgXlsx.__superPatchBound=1; tpWgXlsx.addEventListener('click',wageXlsx,true); }
    if(tpSaveAs&&!tpSaveAs.__csBound){ tpSaveAs.__csBound=1; tpSaveAs.__superPatchBound=1; tpSaveAs.addEventListener('click',tplSaveAs,true); }
    if(tpManage&&!tpManage.__csBound){ tpManage.__csBound=1; tpManage.__superPatchBound=1; tpManage.addEventListener('click',tplManage,true); }
    if(tpWgEdit&&!tpWgEdit.__csBound){ tpWgEdit.__csBound=1; tpWgEdit.__superPatchBound=1; tpWgEdit.addEventListener('click',wgEdit,true); }
    if(btnXlsxAll&&!btnXlsxAll.__csBound){ btnXlsxAll.__csBound=1; btnXlsxAll.__superPatchBound=1; btnXlsxAll.addEventListener('click',function(e){ try{ e.preventDefault(); e.stopPropagation(); }catch(_){} if(typeof window.__csExportAllXlsx==='function'){ window.__csExportAllXlsx(); } else { toast('⚠️ 导出组件未就绪，请刷新页面重试','error',2500); } },true); }
    var btnImport = $('btnImportXlsx'), fileInput = $('castImportFile');
    if(btnImport&&!btnImport.__csBound){
      btnImport.__csBound=1; btnImport.__superPatchBound=1;
      btnImport.addEventListener('click',function(e){
        try{ e.preventDefault(); e.stopPropagation(); }catch(_){}
        if(fileInput){ fileInput.value=''; fileInput.click(); }
        else toast('⚠️ 导入组件未就绪，请刷新页面重试','error',2500);
      },true);
    }
    if(fileInput&&!fileInput.__csBound){
      fileInput.__csBound=1;
      fileInput.addEventListener('change',function(){
        var f = fileInput.files && fileInput.files[0];
        if(!f) return;
        if(!__castCan('manage')){ __castDeny('批量导入'); fileInput.value=''; return; }
        if(!/\.(xlsx|xls|csv)$/i.test(f.name)){ toast('⚠️ 仅支持 .xlsx / .xls / .csv 文件','warning',2500); return; }
        if(typeof window.__csImportFromXlsx==='function'){ window.__csImportFromXlsx(f); }
        else toast('⚠️ 导入组件未就绪，请刷新页面重试','error',2500);
      },true);
    }
    // 20261016 新增：角色关联 / 版本历史 按钮 · 权限应用 · 保存自动记版本
    var btnRoleLink=$('btnRoleLink'), btnVersions=$('btnVersions');
    if(btnRoleLink&&!btnRoleLink.__csBound){ btnRoleLink.__csBound=1; btnRoleLink.__superPatchBound=1; btnRoleLink.addEventListener('click',function(e){ try{ e.preventDefault(); e.stopPropagation(); }catch(_){} roleLinkOpen(); },true); }
    if(btnVersions&&!btnVersions.__csBound){ btnVersions.__csBound=1; btnVersions.__superPatchBound=1; btnVersions.addEventListener('click',function(e){ try{ e.preventDefault(); e.stopPropagation(); }catch(_){} versionsOpen(); },true); }
    var bSaveVer=$('btnSave');
    if(bSaveVer&&!bSaveVer.__verBound){ bSaveVer.__verBound=1; bSaveVer.addEventListener('click',function(){ try{ _verSnapshot('手动保存', true); }catch(_){} },true); }
    __castApplyPerm();
    refreshSheetSelect(); var saved=getCurrentTemplate(); if(saved&&saved.length>0){ updateTroupeStats(saved); }
    console.log('[cast-sheet-fix] buttons bound, template:', saved?saved.length+'人':'none');
  }
  /* ---- 云端配置启动：拉取云端模板库/工资等级，应用到当前页面状态 ---- */
  function _troupeCloudBoot(){
    var tc=_tc(); if(!tc) return;
    tc.bootstrap({
      report:{
        info:function(m){ toast(m,'info',3400); },
        warn:function(m){ toast('☁️ '+m,'warning',3200); },
        error:function(m){ toast(m,'error',4000); }
      },
      onApply:function(arg){
        // 应用云端工资等级到页面全局，并同步当前组团模板同档人员日薪（多设备口径一致）
        var changed=_applyGradesObj(arg.grades);
        var hit=0; var tpl=getCurrentTemplate();
        if(tpl&&tpl.length){
          tpl.forEach(function(p){ var g=WAGE_GRADES[p.grade]; if(g&&p.daily!==g.daily){ p.daily=g.daily; hit++; } });
          if(hit){ try{ localStorage.setItem(LS_TROUPE,JSON.stringify(tpl)); }catch(_){} updateTroupeStats(tpl); }
        }
        if(changed||hit){ /* 等级或日薪有更新 */ }
        // 弹窗若开着则用云端数据重绘
        var wm=$('wgEditModal'); if(wm&&wm.style.display==='flex') renderWgEditRows();
        var mm=$('tplManageModal'); if(mm&&mm.style.display==='flex') renderTplManageList();
      }
    });
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',function(){ setTimeout(function(){ bindAll(); _troupeCloudBoot(); },300); }); } else { setTimeout(function(){ bindAll(); _troupeCloudBoot(); },300); }
})();

