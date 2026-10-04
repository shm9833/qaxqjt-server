/* schedule-inline-extract.js — 从 schedule.html 抽出 9 块内联 script (v20260930c)
 * 抽出目的：减少首屏 HTML 体积，启用 HTTP 缓存
 * 各块顺序与原 HTML 一致；保留原 IIFE / 防重复注入保护，合并后安全
 * 早期守卫（行 9-25）+ superPatch click handler（行 26）保留 inline，未抽出
 * 生成时间：2026-09-30T08:26:40.391Z
 */

/* ===== [1/10] 原 schedule.html 行 1201-1927  ===== */

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
      // —— 页面级权限拦截：staff(100) 起可只读查看档期；写操作（新增/确认/取消/删除）需 >=700（ops/director/admin）——
      // 注意：本块在 IIFE 内，必须显式挂 window 供行渲染脚本块（L3547+）读取
      window.__schedUserLvl = currentSession ? __getRoleLevel(currentSession.role) : 0;
      window.__schedCanWrite = window.__schedUserLvl >= 700;
      window.__schedCanDelete = window.__schedUserLvl >= 999;
      var __schedUserLvl = window.__schedUserLvl, __schedCanWrite = window.__schedCanWrite, __schedCanDelete = window.__schedCanDelete;
      (function() {
        if (!currentSession) return;
        if (__schedUserLvl < 100) {
          location.replace('index.html');
          return;
        }
        // 只读账号：隐藏新增按钮（行内写按钮在渲染时按 __schedCanWrite/__schedCanDelete 控制）
        if (!__schedCanWrite) {
          document.addEventListener('DOMContentLoaded', function() {
            var btn = document.getElementById('addScheduleBtn');
            if (btn) btn.style.display = 'none';
          });
        }
      })();
      // TS2 FIX：视图真实渲染 + 季度卡片联动 + 🚨查看冲突滚动高亮
      var __toastS2 = function(msg,type){ try{ if(window.QinApp&&QinApp.Utils&&QinApp.Utils.toast){QinApp.Utils.toast(msg,type||'info',3000);return;} }catch(_e){} try{(type==='error'?alert:console.log)('[schedule] '+msg);}catch(_f){} };
      var __acqS2 = function(key,ttl){ if(window.__OP_LOCKS&&window.__OP_LOCKS[key])return false; try{ if(!window.__OP_LOCKS)window.__OP_LOCKS={}; window.__OP_LOCKS[key]=true; setTimeout(function(){try{delete window.__OP_LOCKS[key];}catch(_){}},ttl||600);}catch(_lk){} return true; };
      // 动态渲染日历：根据年月生成日历格子 + 更新标题
      function __renderCalendar(year, month){
        try{
          var titleEl = document.getElementById('calendarTitleText');
          if(titleEl) titleEl.textContent = year+'年 '+month+'月 演出排期日历';
          var tbody = document.querySelector('#monthContainer .calendar-table tbody');
          if(!tbody) return;
          year = parseInt(year,10) || new Date().getFullYear();
          month = parseInt(month,10) || 1;
          if(month<1) month=1; if(month>12) month=12;
          var firstDay = new Date(year, month-1, 1).getDay();
          var daysInMonth = new Date(year, month, 0).getDate();
          var prevMonthDays = new Date(year, month-1, 0).getDate();
          var today = new Date();
          var isCurMonth = (year===today.getFullYear() && month===today.getMonth()+1);
          // 读取排期数据，按日期分组
          var schedByDay = {};
          try{
            var schedList = JSON.parse(localStorage.getItem('qaxqjt_schedules_v2') || '[]');
            schedList.forEach(function(s){
              if(s && s.date){
                var d = String(s.date);
                if(!schedByDay[d]) schedByDay[d] = [];
                schedByDay[d].push(s);
              }
            });
          }catch(_){}
          function _pad(n){ return n<10 ? '0'+n : ''+n; }
          function _hx(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
          function _typeClass(t){
            if(!t) return '';
            var tt = String(t);
            if(tt.indexOf('庙会')>=0) return 'type-miaohui';
            if(tt.indexOf('惠民')>=0) return 'type-huimin';
            if(tt.indexOf('节庆')>=0) return 'type-jieqing';
            if(tt.indexOf('商演')>=0 || tt.indexOf('企业')>=0) return 'type-shangyan';
            return '';
          }
          var html = '';
          var dayCount = 1, nextMonthDay = 1;
          for(var row=0; row<6; row++){
            html += '<tr>';
            for(var col=0; col<7; col++){
              var cellIndex = row*7+col;
              var dayNum, isEmpty=false, cellYear=year, cellMonth=month;
              if(cellIndex < firstDay){
                dayNum = prevMonthDays - firstDay + 1 + cellIndex; isEmpty=true;
                cellMonth = month-1; if(cellMonth<1){ cellMonth=12; cellYear=year-1; }
              }
              else if(dayCount > daysInMonth){
                dayNum = nextMonthDay++; isEmpty=true;
                cellMonth = month+1; if(cellMonth>12){ cellMonth=1; cellYear=year+1; }
              }
              else { dayNum = dayCount++; }
              var isToday = (!isEmpty && isCurMonth && dayNum===today.getDate());
              html += '<td><div class="calendar-day'+(isEmpty?' empty':'')+(isToday?' today':'')+'">';
              html += '<div class="day-number">'+dayNum+'</div>';
              html += '<div class="day-events">';
              if(!isEmpty){
                var dateStr = cellYear+'-'+_pad(cellMonth)+'-'+_pad(dayNum);
                var evts = schedByDay[dateStr] || [];
                evts.slice(0,3).forEach(function(s){
                  var tc = _typeClass(s.type);
                  html += '<div class="mini-event '+tc+'" title="'+_hx((s.title||'')+' · '+(s.venue||''))+'">'+_hx(s.title||s.plays||'')+'</div>';
                });
                if(evts.length>3){
                  html += '<div class="mini-event" style="opacity:.7;font-size:.65rem;">+'+(evts.length-3)+'</div>';
                }
              }
              html += '</div>';
              html += '</div></td>';
            }
            html += '</tr>';
          }
          tbody.innerHTML = html;
        }catch(_e){}
      }
      // 视图切换显示/隐藏（CSP友好：用CSS class控制，不用直接改style.display — 但由于三容器都在calendar-wrapper外层同级，直接用style.display切换更简单，且未插值）
      function __switchView(viewName){
        var m = document.getElementById('monthContainer');
        var w = document.getElementById('weekContainer');
        var l = document.getElementById('listContainer');
        function __show(el){ if(el){ el.style.display='block'; } }
        function __hide(el){ if(el){ el.style.display='none'; } }
        if(viewName==='week'){ __hide(m); __show(w); __hide(l); __toastS2('📋 已切换至「周视图」排期日历','info'); }
        else if(viewName==='list'){ __hide(m); __hide(w); __show(l); __toastS2('📑 已切换至「列表视图」全量排期清单','info'); }
        else { __show(m); __hide(w); __hide(l); __toastS2('📆 已切换至「月度视图」排期日历','info'); }
      }
      var viewBtns = document.querySelectorAll('.view-toggle button');
      viewBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
          if(!__acqS2('sch_view_'+(btn.getAttribute('data-view')||''),400)) return;
          viewBtns.forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          var v = btn.getAttribute('data-view') || 'month';
          __switchView(v);
        });
      });
      // 周视图导航
      var __weekOffset = 0;
      function __renderWeek(offset){
        try{
          __weekOffset = offset || 0;
          var today = new Date();
          var base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          var dayOfWeek = base.getDay(); if(dayOfWeek===0) dayOfWeek=7;
          var monday = new Date(base); monday.setDate(base.getDate() - dayOfWeek + 1 + __weekOffset*7);
          var titleEl = document.getElementById('weekTitleText');
          if(titleEl){
            var m = monday.getMonth()+1, d = monday.getDate();
            var sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
            titleEl.textContent = monday.getFullYear()+'年 '+m+'月 第'+Math.ceil((d+new Date(monday.getFullYear(),monday.getMonth(),1).getDay())/7)+'周 排期一览（'+m+'/'+d+' - '+(sunday.getMonth()+1)+'/'+sunday.getDate()+'）';
          }
          var dayNames = ['周一','周二','周三','周四','周五','周六','周日'];
          var cells = document.querySelectorAll('#weekDayHeaders > div');
          if(cells && cells.length >= 7){
            for(var i=0;i<7;i++){
              var dt = new Date(monday); dt.setDate(monday.getDate()+i);
              var isToday = (dt.getFullYear()===today.getFullYear() && dt.getMonth()===today.getMonth() && dt.getDate()===today.getDate());
              if(cells[i]){
                cells[i].textContent = dayNames[i]+' '+(dt.getMonth()+1)+'/'+dt.getDate()+(isToday?' ⭐':'');
                cells[i].style.background = isToday ? 'rgba(124,58,237,0.1)' : '';
                cells[i].style.color = isToday ? '#7c3aed' : '';
              }
            }
          }
        }catch(_e){}
      }
      var wPrev = $('weekNavPrev'), wToday = $('weekNavToday'), wNext = $('weekNavNext');
      if(wPrev&&!wPrev.__s2b){ wPrev.__s2b=1; wPrev.addEventListener('click',function(){ __renderWeek(__weekOffset-1); __toastS2('📋 已切换至上一周','info',1200); }); }
      if(wToday&&!wToday.__s2b){ wToday.__s2b=1; wToday.addEventListener('click',function(){ __renderWeek(0); __toastS2('📋 已回到本周','success',1200); }); }
      if(wNext&&!wNext.__s2b){ wNext.__s2b=1; wNext.addEventListener('click',function(){ __renderWeek(__weekOffset+1); __toastS2('📋 已切换至下一周','info',1200); }); }
      // 导出/打印按钮（真实 API：导出 CSV 走 __schedApi.exportCsv()）
      var spExp = $('spExportScheduleBtn'), spPrn = $('spPrintScheduleBtn');
      if(spExp&&!spExp.__s2b){ spExp.__s2b=1; spExp.__superPatchBound=1; spExp.__ts3Done=1; spExp.addEventListener('click',function(){ try { window.__schedApi && window.__schedApi.exportCsv && window.__schedApi.exportCsv(); } catch(e){ __toastS2('⚠️ 导出失败：'+(e&&e.message?e.message:e),'warning',2500); } }, true); }
      if(spPrn&&!spPrn.__s2b){ spPrn.__s2b=1; spPrn.__superPatchBound=1; spPrn.__ts3Done=1; spPrn.addEventListener('click',function(){ __toastS2('🖨️ 正在准备打印排期月历...','info',1000); setTimeout(function(){ try{ window.print(); }catch(_e){ __toastS2('⚠️ 打印调用失败，请用 Ctrl+P 手动打印','warning',2500); } },400); }, true); }
      // 季度卡片点击联动：更新年月筛选下拉 + 切月视图 + toast
      document.querySelectorAll('.history-link-card').forEach(function(card){
        card.style.cursor='pointer';
        card.addEventListener('click', function(){
          if(!__acqS2('sch_qcard',400)) return;
          var desc = (card.querySelector('.desc')||{}).textContent || '';
          var label = (card.querySelector('.label')||{}).textContent || '';
          var ySel = document.querySelector('.admin-filter-bar select');
          var mSel = ySel ? ySel.parentElement.parentElement.querySelectorAll('select')[1] : null;
          function __setMonth(m1,m2){
            try{
              var curYear = ySel ? (parseInt(ySel.value,10)||new Date().getFullYear()) : new Date().getFullYear();
              if(mSel){ mSel.value = String(m1); }
              __renderCalendar(curYear, m1);
              __toastS2('📅 已定位季度：'+label+'（默认展示 '+m1+'月，可切换至 '+m2+'月）','success');
            }catch(_e){ __toastS2('📅 已切换：'+label+' - '+desc,'info'); }
          }
          // 先切到月度视图
          __switchView('month');
          viewBtns.forEach(function(b){ b.classList.remove('active'); if(b.getAttribute('data-view')==='month')b.classList.add('active'); });
          if(desc.indexOf('Q1')>=0 || desc.indexOf('1-3月')>=0){ __setMonth(1,'2-3'); }
          else if(desc.indexOf('Q2')>=0 || desc.indexOf('4-6月')>=0){ __setMonth(4,'5-6'); }
          else if(desc.indexOf('往年')>=0 || desc.indexOf('2024')>=0 || desc.indexOf('以前')>=0){
            if(ySel){ ySel.value = '2024'; }
            __renderCalendar(2024, 1);
            __toastS2('📅 已切换至 2024 年度档案（默认展示 1月）','success');
          }
          else if(desc.indexOf('年度')>=0 || desc.indexOf('12个月')>=0){ __toastS2('📅 已切换：'+label+' '+desc+'（月度视图默认展示当前月）','success'); }
          else { __toastS2('📅 已切换：'+label+' '+desc,'info'); }
        });
      });
      // 年份/月份 select change 联动日历渲染
      (function(){
        var filterBar = document.querySelector('.admin-filter-bar');
        if(!filterBar) return;
        var sels = filterBar.querySelectorAll('select');
        var ySel2 = sels[0], mSel2 = sels[1];
        function __onYMChange(){
          var y = ySel2 ? (parseInt(ySel2.value,10)||new Date().getFullYear()) : new Date().getFullYear();
          var m = mSel2 ? (parseInt(mSel2.value,10)||1) : 1;
          __renderCalendar(y, m);
        }
        if(ySel2) ySel2.addEventListener('change', __onYMChange);
        if(mSel2) mSel2.addEventListener('change', __onYMChange);
        // 日历导航按钮
        var navToday = document.getElementById('calNavToday');
        var navPrevM = document.getElementById('calNavPrevMonth');
        var navNextM = document.getElementById('calNavNextMonth');
        var navPrevY = document.getElementById('calNavPrevYear');
        var navNextY = document.getElementById('calNavNextYear');
        function __getYM(){
          var y = ySel2 ? (parseInt(ySel2.value,10)||new Date().getFullYear()) : new Date().getFullYear();
          var m = mSel2 ? (parseInt(mSel2.value,10)||1) : 1;
          return {y:y, m:m};
        }
        function __setYM(y,m){
          if(ySel2){ ySel2.value = String(y); }
          if(mSel2){ mSel2.value = String(m); }
          __renderCalendar(y, m);
        }
        if(navToday) navToday.addEventListener('click', function(){
          var t = new Date(); __setYM(t.getFullYear(), t.getMonth()+1);
          __toastS2('📅 已定位到今日 '+t.getFullYear()+'年'+(t.getMonth()+1)+'月','success');
        });
        if(navPrevM) navPrevM.addEventListener('click', function(){
          var ym = __getYM(); var m = ym.m-1, y = ym.y;
          if(m<1){ m=12; y--; } __setYM(y, m);
        });
        if(navNextM) navNextM.addEventListener('click', function(){
          var ym = __getYM(); var m = ym.m+1, y = ym.y;
          if(m>12){ m=1; y++; } __setYM(y, m);
        });
        if(navPrevY) navPrevY.addEventListener('click', function(){
          var ym = __getYM(); __setYM(ym.y-1, ym.m);
        });
        if(navNextY) navNextY.addEventListener('click', function(){
          var ym = __getYM(); __setYM(ym.y+1, ym.m);
        });
        // 初始化：渲染当前选中的年月
        var initYM = __getYM(); __renderCalendar(initYM.y, initYM.m);
      })();
      // 列表视图：紧凑/详情模式切换 + 立即处理冲突
      (function(){
        var denseBtn = document.getElementById('listDenseBtn');
        var detailBtn = document.getElementById('listDetailBtn');
        // 【Fix-20260929 L1】真实卡片由 admin-schedule-real.js 动态渲染到 #listCardsReal，
        // 初始化时静态 querySelectorAll 取到的集合永远为空；改为容器 class 切换（点击时实时生效）
        var realCardBox = document.getElementById('listCardsReal');
        function __setListMode(mode){
          if(realCardBox){
            try{ realCardBox.classList.toggle('list-mode-dense', mode==='dense'); }catch(_){}
          }
          if(denseBtn) denseBtn.classList.toggle('active', mode==='dense');
          if(detailBtn) detailBtn.classList.toggle('active', mode==='detail');
          __toastS2(mode==='dense'?'📋 已切换至紧凑模式':'⊞ 已切换至详情模式','info');
        }
        if(denseBtn) denseBtn.addEventListener('click', function(){ __setListMode('dense'); });
        if(detailBtn) detailBtn.addEventListener('click', function(){ __setListMode('detail'); });
        // 立即处理冲突链接
        document.querySelectorAll('#listContainer .action-link').forEach(function(link){
          if((link.textContent||'').indexOf('立即处理')>=0){
            link.style.cursor='pointer';
            link.addEventListener('click', function(e){
              e.preventDefault();
              if(!__acqS2('sch_handle_conflict',500)) return;
              __toastS2('🚨 正在打开冲突处理面板（正式环境对接人员调度接口）','warning');
              try{
                if(window.openAdminModal){
                  openAdminModal(link, { mode:'edit', title:'档期冲突处理', id:'conflict-handle', width:'720px', actionLabel:'确认调整' });
                }
              }catch(_){}
            });
          }
        });
      })();
      // 🚨 查看冲突按钮：切列表视图 → 滚动到 conflictAnchor0715 → 高亮闪烁
      var conflictBtns = document.querySelectorAll('.schedule-alert .btn, .schedule-alert button');
      conflictBtns.forEach(function(btn){
        if((btn.textContent||'').indexOf('查看冲突')>=0 || (btn.textContent||'').indexOf('冲突')>=0){
          btn.addEventListener('click', function(e){
            if(!__acqS2('sch_conflict',500)) return;
            // 切到列表视图
            __switchView('list');
            viewBtns.forEach(function(b){ b.classList.remove('active'); if(b.getAttribute('data-view')==='list')b.classList.add('active'); });
            // 滚动高亮
            setTimeout(function(){
              var anchor = document.getElementById('conflictAnchor0715');
              if(anchor){
                try{ anchor.scrollIntoView({behavior:'smooth', block:'center'}); }catch(_){ try{ anchor.scrollIntoView(); }catch(_a){} }
                try{ anchor.style.transition='box-shadow .3s'; anchor.style.boxShadow='0 0 0 6px rgba(220,53,69,0.25)'; }catch(_s){}
                var flashes=0;
                var fh = setInterval(function(){
                  try{
                    if(flashes%2===0){ anchor.style.background='rgba(220,53,69,0.15)'; }
                    else{ anchor.style.background=''; }
                    flashes++;
                    if(flashes>=5){ clearInterval(fh); try{ anchor.style.background=''; anchor.style.boxShadow=''; }catch(_r){} }
                  }catch(_f){ clearInterval(fh); }
                },350);
              }
              __toastS2('🚨 已跳转至 7月15日 档期冲突明细 · 请立即处理','warning');
            },200);
          });
        }
      });

      // 【Fix-20260929 L2】mini-event 点击改为 document 级一次性事件委托：
      // 月历每次翻月（__renderCalendar innerHTML 重建）、周视图 renderWeekGrid 重渲染后，
      // 原先逐个绑定的监听器都会随旧节点销毁而丢失。月历/周视图共用 .mini-event 类。
      if (!window.__miniEventDelegBound) {
        window.__miniEventDelegBound = true;
        document.addEventListener('click', function(e){
          var ev = e.target && e.target.closest ? e.target.closest('.mini-event') : null;
          if (!ev) return;
          // "+N" 溢出提示条不可点击
          if ((ev.textContent || '').charAt(0) === '+' && !ev.getAttribute('title')) return;
          if (window.QinApp && window.QinApp.Utils) {
            window.QinApp.Utils.toast('查看档期详情：' + (ev.getAttribute('title') || ev.textContent), 'info');
          }
        });
      }

      var todayBtn = document.querySelector('.calendar-nav button:nth-child(3)');
      if (todayBtn) {
        todayBtn.addEventListener('click', function() {
          if (window.QinApp && window.QinApp.Utils) {
            window.QinApp.Utils.toast('已定位到今日：{year}年7月15日', 'success');
          }
        });
      }

      var addBtn = document.getElementById('addScheduleBtn');
      var addModal = document.getElementById('addScheduleModal');
      var addOverlay = document.getElementById('addScheduleOverlay');
      var addClose = document.getElementById('addScheduleClose');
      var addCancel = document.getElementById('addScheduleCancel');
      var addSubmit = document.getElementById('addScheduleSubmit');
      /* B7：弹窗显隐改为纯 classList 控制（配合 .modal-overlay-hide/.modal-wrap-hide CSS，CSP style-src-elem 严格模式不再 JS 写 style.display） */
      function openAddModal() {
        var m = document.getElementById('addScheduleModal');
        var o = document.getElementById('addScheduleOverlay');
        if (!m || !o) return;
        try { o.classList.remove('modal-overlay-hide'); } catch(_){}
        try { m.classList.remove('modal-wrap-hide'); } catch(_){}
        o.classList.add('active');
        m.classList.add('active');
        // 延迟绑定按钮（元素在脚本块之后定义，IIFE 执行时尚不存在）
        var sb = document.getElementById('addScheduleSubmit');
        if (sb && !sb.__s2b) { sb.__s2b = 1; sb.addEventListener('click', submitAddSchedule); }
        var cb = document.getElementById('addScheduleClose');
        if (cb && !cb.__s2b) { cb.__s2b = 1; cb.addEventListener('click', closeAddModal); }
        var cnb = document.getElementById('addScheduleCancel');
        if (cnb && !cnb.__s2b) { cnb.__s2b = 1; cnb.addEventListener('click', closeAddModal); }
        if (o && !o.__s2b) { o.__s2b = 1; o.addEventListener('click', function(e) { if (e.target === o) closeAddModal(); }); }
      }
      function closeAddModal() {
        var o = document.getElementById('addScheduleOverlay');
        var m = document.getElementById('addScheduleModal');
        if (o) { try { o.classList.remove('active'); } catch(_){} try { o.classList.add('modal-overlay-hide'); } catch(_){} }
        if (m) { try { m.classList.remove('active'); } catch(_){} try { m.classList.add('modal-wrap-hide'); } catch(_){} }
      }
      if (addBtn) addBtn.addEventListener('click', openAddModal);
      if (addClose) addClose.addEventListener('click', closeAddModal);
      if (addCancel) addCancel.addEventListener('click', closeAddModal);
      if (addOverlay) addOverlay.addEventListener('click', function(e) { if (e.target === addOverlay) closeAddModal(); });
      async function submitAddSchedule() {
        var titleEl = document.getElementById('schedTitle') || {};
        var title = (titleEl.value || '').trim();
        var dateEl = document.getElementById('schedDate') || {};
        var timeEl = document.getElementById('schedTime') || {};
        var venueEl = document.getElementById('schedVenue') || {};
        var typeEl = document.getElementById('schedType') || {};
        var leaderEl = document.getElementById('schedLeader') || {};
        if (!title) { alert('请填写演出剧目/活动名称'); if (titleEl && titleEl.focus) try { titleEl.focus(); } catch(_) {} return; }
        var schedDate = dateEl.value ? String(dateEl.value).trim() : '';
        var schedTime = timeEl.value ? String(timeEl.value).trim() : '19:30';
        var venue = venueEl.value ? String(venueEl.value).trim() : '';
        var sType = typeEl && typeEl.options ? (typeEl.options[typeEl.selectedIndex] ? typeEl.options[typeEl.selectedIndex].text : '') : (typeEl.value || '');
        var leader = leaderEl.value ? String(leaderEl.value).trim() : '';
        // 扫派工 cast
        var castList = [];
        try {
          // 【Fix-20260929 L4】真实复选框由派工区按 name="schedCast[<行当>][]" 渲染、
          // value=人员姓名，备注输入框带 data-cast-note="<行当>|<序号>"；
          // 旧选择器（data-cast-name / .dp-cb）与真实 DOM 完全不匹配，castList 永远为空
          document.querySelectorAll('#schedCastBox input[type="checkbox"][name^="schedCast["]:checked').forEach(function (cb) {
            var nm = (cb.value || '').trim();
            if (!nm) return;
            var m = String(cb.name || '').match(/^schedCast\[([^\]]+)\]\[\]$/);
            var k = m ? m[1] : '';
            var idx = String(cb.id || '').split('_').pop();
            var role = '';
            if (k) {
              var note = document.querySelector('#schedCastBox input[data-cast-note="' + k + '|' + idx + '"]');
              if (note) role = (note.value || '').trim();
            }
            castList.push({ name: nm, role: role, group: k });
          });
        } catch (_) {}
        // 扫剧目/车辆/服装/备注
        var remark = '';
        try {
          var txts = document.querySelectorAll('#addScheduleModal textarea, #addScheduleModal input[type="text"][data-sched-desc], #addScheduleModal input[data-sched-desc]');
          var parts = [];
          txts.forEach(function(t){ if (t && t.value && String(t.value).trim()) parts.push(String(t.value).trim()); });
          if (parts.length) remark = parts.join(' / ');
        } catch (_) {}
        try {
          var QinApp = window.QinApp || (window.parent && window.parent.QinApp);
          var Storage = QinApp && QinApp.Storage ? QinApp.Storage : null;
          var Utils = QinApp && QinApp.Utils ? QinApp.Utils : null;
          var ts = Date.now();
          var yearPart = schedDate ? schedDate.replace(/-/g,'').slice(0,8) : String(ts);
          var schedId = 'SCH-' + yearPart + '-' + String(1000 + Math.floor(Math.random() * 8999));
          var weekMap = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
          var weekStr = '';
          try { if (schedDate) { var d = new Date(String(schedDate)); if (!isNaN(d.getTime())) weekStr = weekMap[d.getDay()]; } } catch (_) {}
          var entry = {
            id: schedId,
            title: title,
            date: schedDate,
            time: schedTime,
            week: weekStr,
            venue: venue,
            type: sType,
            leader: leader,
            cast: castList,
            castCount: castList.length,
            plays: title,
            shows: 1,
            status: 'draft',
            statusText: '待排演',
            remark: remark,
            createdAt: ts,
            createdBy: (QinApp && QinApp.Admin && QinApp.Admin.currentUser) ? (QinApp.Admin.currentUser.name || QinApp.Admin.currentUser.username || '') : ''
          };
          var saved = null;
          // ====== 真实 API：POST /v1/schedules（v20260921a）======
          // 字段映射：date(必)/orderId(必,散客占位)/title/venue/type/time/remark/status
          // 备份：schedule.html.bak-schedulefix-20260921
          try {
            var apiBody = {
              date: schedDate || new Date().toISOString().slice(0,10),
              orderId: 'walk-in-' + Date.now().toString(36), // 散客占位 ID（per controller 注释）
              title: title,
              venue: venue,
              type: sType,
              time: schedTime,
              remark: (leader ? '负责人:' + leader + ' ' : '') + (remark || ''),
              status: 'draft'
            };
            var resp = await QAXQJT_API.post('/v1/schedules', apiBody);
            if (resp && resp.id) {
              saved = {
                __viaApi: true,
                id: resp.id,
                title: resp.playTitle || title,
                date: schedDate,
                week: weekStr,
                venue: venue,
                type: sType,
                leader: leader,
                cast: castList,
                castCount: castList.length,
                plays: title,
                shows: 1,
                status: 'draft',
                statusText: '待排演',
                remark: remark,
                createdAt: ts,
                createdBy: ''
              };
              console.info('[schedule] API create OK id=' + resp.id);
            }
          } catch(apiErr) {
            console.warn('[schedule] API create failed, fallback to localStorage:', apiErr);
          }
          // ====== Fallback：API 失败时回退到 localStorage ======
          if (!saved) {
            try {
              var list = [];
              try { list = JSON.parse(localStorage.getItem('qaxqjt_schedules_v2') || '[]'); } catch (_) { list = []; }
              entry._updatedAt = Date.now();
              list.unshift(entry);
              localStorage.setItem('qaxqjt_schedules_v2', JSON.stringify(list));
              saved = entry;
            } catch (bk) { console.warn('schedule write fallback failed:', bk); }
          }
          // 【Fix-20260929 L4】API 创建成功后不再手工插入"临时假行"
          // （旧假行的 编辑/打印/取消 按钮无 data-act，行委托派工/取消全部失灵，
          // 且月历/周视图/列表卡片也不会出现新排期）；改为真实重载三路数据。
          if (saved && saved.__viaApi) {
            try {
              if (window.__schedApi && typeof window.__schedApi.load === 'function') {
                Promise.resolve(window.__schedApi.load()).catch(function(e){ console.warn('[schedule] reload table fail:', e); });
              }
            } catch(_rl1) {}
            try {
              if (typeof window.__schedRealReload === 'function') {
                Promise.resolve(window.__schedRealReload()).catch(function(e){ console.warn('[schedule] reload real views fail:', e); });
              }
            } catch(_rl2) {}
          } else {
            // 离线 localStorage 回退路径：保留乐观插入（此时后端不可达），
            // 取消按钮补 data-act，恢复后下次真实加载即被服务端数据替换
            var tb = document.getElementById('scheduleListTbody');
            if (tb && saved) {
              try {
                // FIX_X3 R20.1 HIGH：统一 Utils.escapeHtml（兜底replace），white-space:nowrap → ws-nowrap CSS 类，font-size/color → sched-cast-sub 类，font-weight → sched-title-bold 类，min-width+display:flex → sched-actions 类
                function _hx(s){ return (Utils && Utils.escapeHtml) ? Utils.escapeHtml(s==null?'':s) : String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
                var tr = document.createElement('tr');
                tr.setAttribute('data-sched-id', saved.id || schedId);
                tr.innerHTML = '<td><strong class="sched-tag-bold">' + _hx(saved.id || schedId) + '</strong></td>' +
                  '<td>' + _hx(saved.date || '-') + '</td>' +
                  '<td>' + _hx(saved.week || '-') + '</td>' +
                  '<td>秦安县秦剧团</td>' +
                  '<td>' + _hx(saved.venue || '') + '</td>' +
                  '<td><span class="op-type-badge op-type-edit ws-nowrap">' + _hx(saved.type || '') + '</span></td>' +
                  '<td class="sched-title-bold">' + _hx(saved.plays || title) + '</td>' +
                  '<td>' + _hx(String(saved.shows || 1)) + ' 场</td>' +
                  '<td>' + _hx(saved.leader || '') + ' <span class="sched-cast-sub">（派' + _hx(String(saved.castCount || 0)) + '人）</span></td>' +
                  '<td><span class="status-tag status-pending ws-nowrap">📋 待排演</span></td>' +
                  '<td class="sched-actions-wrap"><div class="sched-actions">' +
                    '<button class="btn-action btn-action-sm btn-action-gold" data-act="dispatch" title="查看派工">👥 派工</button>' +
                    '<button class="btn-action btn-action-sm btn-action-outline" title="编辑">✏️ 编辑</button>' +
                    '<button class="btn-action btn-action-sm btn-action-outline" title="打印派工单">🖨️ 打印</button>' +
                    '<button class="btn-action btn-action-sm btn-action-danger" data-act="cancel" title="取消排期">⛔ 取消</button>' +
                  '</div></td>';
                if (tb.firstChild) tb.insertBefore(tr, tb.firstChild);
                else tb.appendChild(tr);
              } catch (uiErr) { console.warn('schedule UI insert fail:', uiErr); }
            }
          }
          if (Utils) {
            if (saved && saved.__viaApi) {
              // 【Fix-20260929 L4】后端 schedules 接口不接收 cast（演职归属 cast-sheets 演员表模块），
              // 不能提示"派工 N 人已保存"；勾选了人员时明确告知录入口，避免静默丢失
              Utils.toast('✅ 排期已创建：' + title + ' · 档期ID ' + (saved.id || schedId), 'success', 5000);
              if (castList.length) {
                Utils.toast('⚠️ 已勾选 ' + castList.length + ' 名演职人员；派工名单需在「演员表」模块按该排期录入，弹窗内勾选不随排期保存', 'warning', 6000);
              }
            } else {
              Utils.toast('✅ 排期已持久化保存：' + title + ' · 档期ID ' + (saved && saved.id ? saved.id : schedId) + ' · 派工 ' + (saved && saved.castCount ? saved.castCount : 0) + ' 人（刷新页面仍存在）', 'success', 5000);
            }
          } else {
            alert('✅ 排期创建成功：' + title + '（已真实写入浏览器本地存储）');
          }
        } catch (outerErr) {
          console.error('[schedule.submit] outer catch:', outerErr);
          try { (window.QinApp && QinApp.Utils) ? QinApp.Utils.toast('⚠️ 排期保存异常：' + (outerErr && outerErr.message ? outerErr.message : ''), 'error') : alert('保存失败'); } catch(_) {}
        }
        // 保存成功后自动切换到列表视图，让用户立即看到新排期
        try {
          __switchView('list');
          document.querySelectorAll('.view-toggle button').forEach(function(b){
            b.classList.remove('active');
            if (b.getAttribute('data-view') === 'list') b.classList.add('active');
          });
          // 同步更新月视图日历，切回月视图时新排期可见
          try {
            var ySel = document.querySelector('.admin-filter-bar select');
            var mSel = ySel ? ySel.parentElement.parentElement.querySelectorAll('select')[1] : null;
            var y = ySel ? (parseInt(ySel.value,10)||new Date().getFullYear()) : new Date().getFullYear();
            var m = mSel ? (parseInt(mSel.value,10)||1) : 1;
            __renderCalendar(y, m);
          } catch(_) {}
        } catch (_) {}
        closeAddModal();
      }
      document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeAddModal(); });
      /* ---------- CRITICAL 修复：退出登录按钮（侧边栏 + 头像下拉） + 7 类 legacy key 彻底清理 ---------- */
      function __doScheduleLogout() {
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
      function __bindScheduleLogoutBtns() {
        var sb = document.getElementById('logoutBtnSidebar');
        if (sb) sb.addEventListener('click', function(e){ e.preventDefault && e.preventDefault(); __doScheduleLogout(); }, true);
        var dd = document.getElementById('logoutBtnDropdown');
        if (dd) dd.addEventListener('click', function(e){ e.preventDefault && e.preventDefault(); __doScheduleLogout(); }, true);
      }
      try {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', __bindScheduleLogoutBtns);
        } else {
          __bindScheduleLogoutBtns();
        }
      } catch(_bindErr){}
      // 🔧 B7c FIX：补上 schedule.html 自己的 window.toggleFullscreen（590 行 HTML onclick 调用，之前无定义）
      if (!window.toggleFullscreen) {
        window.toggleFullscreen = function() {
          if (!document.fullscreenElement) { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); }
          else { document.exitFullscreen && document.exitFullscreen(); }
        };
      }

      // =============================================================================
      // 🔧 D3 FIX：排期/档期 全按钮自动化事件绑定 + 去抖
      // =============================================================================

      // 暴露日历渲染/视图切换函数，供后续 script 块（查询/今日/重置按钮）调用
      try { window.__renderCalendar = __renderCalendar; window.__switchView = __switchView; } catch(_) {}

    })();
  

/* ===== [2/10] 原 schedule.html 行 1982-2066  ===== */

        (function(){
          // 20260922 真实化：候选人员来自 /v1/performers（QinRealPerformers），不内置任何假名
          // 行当口径（20261003 修订）：6 大行 + 后勤 + 武场/文场，与 cast-sheet / 派工单完全一致
          var CAST_GROUPS = [
            { k:'sheng',    n:'生行（文须生·武须生·小生）' },
            { k:'chou',     n:'丑行（丑角）' },
            { k:'jing',     n:'净行（大花脸·二花脸）' },
            { k:'dan',      n:'旦行（正旦·小旦·彩旦·二架旦）' },
            { k:'erjia',    n:'二架（门官·家院）' },
            { k:'juezi',    n:'角子（龙套·校尉·刀斧手·丫鬟·彩女·长随官）' },
            { k:'houqin',   n:'后勤（帽箱·电工·前场·衣箱·剧务）' },
            { k:'wuchang',  n:'武场（司鼓·梆子·打击乐）' },
            { k:'wenchang', n:'文场（板胡·二胡·扬琴等）' }
          ];
          var box = document.getElementById('schedCastBox');
          function _schedPpl(k){ var g = window.QinRealPerformers && QinRealPerformers.groups; return (g && g[k]) || []; }
          function _schedH(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
          function renderSchedCast(){
            if (!box) return;
            box.innerHTML = '';
            CAST_GROUPS.forEach(function(grp){
              var ppl = _schedPpl(grp.k);
              var card = document.createElement('div');
              try { card.classList.add('cast-card-base'); } catch(_cssErr) {
                try { card.style.cssText = 'border:1.5px solid #cbd5e1;border-radius:12px;background:#fff;padding:12px 14px;transition:all .2s;'; } catch(__) {}
              }
              card.onmouseover = function(){ try { card.classList.add('cast-card-hover'); } catch(_) {} };
              card.onmouseout  = function(){ try { card.classList.remove('cast-card-hover'); } catch(_) {} };
              var head = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px dashed #cbd5e1;">'
                + '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#0f4c81,#1e6091);color:#fff;font-size:.78rem;font-weight:700;">'+ppl.length+'</span>'
                + '<strong style="color:#0f4c81;">'+_schedH(grp.n)+'</strong>'
                + '<span style="margin-left:auto;font-size:.72rem;color:#94a3b8;">可多选，每人独立备注角色</span>'
                + '</div>';
              var items = ppl.map(function(p,idx){
                var safeId = 'sc_'+grp.k+'_'+idx;
                // 演员6行显示标准角色（文须生等）；武场/文场保留原始乐器工种（司鼓/板胡等）
                var dispRole = (grp.k==='wuchang'||grp.k==='wenchang') ? (p.role||'') : (p.stdRole||p.role||'');
                var label = dispRole ? (_schedH(p.name)+'<small style="color:#94a3b8;margin-left:6px;">'+_schedH(dispRole)+'</small>') : _schedH(p.name);
                return '<div style="display:grid;grid-template-columns:22px 1fr 1.1fr;gap:8px;align-items:center;padding:5px 0;">'
                  + '<input type="checkbox" id="'+safeId+'" name="schedCast['+grp.k+'][]" value="'+_schedH(p.name)+'" style="width:18px;height:18px;cursor:pointer;accent-color:#0f4c81;">'
                  + '<label for="'+safeId+'" style="font-size:.86rem;color:#1e293b;cursor:pointer;margin:0;line-height:1.5;">'+label+'</label>'
                  + '<input type="text" class="sched-cast-note" placeholder="饰演/备注（如：艾千/黄桂英/前场）" data-cast-note="'+grp.k+'|'+idx+'" style="padding:4px 8px;font-size:.8rem;border:1px solid #cbd5e1;border-radius:8px;outline:none;">'
                  + '</div>';
              }).join('');
              if (!ppl.length) items = '<div style="padding:6px 2px;color:#94a3b8;font-size:.82rem;">暂无该工种在册人员</div>';
              card.innerHTML = head + items;
              box.appendChild(card);
            });
            try {
              var all = document.querySelectorAll('#schedCastBox input.sched-cast-note, #schedCastBox input[data-cast-note]');
              for (var si = 0; si < all.length; si++) {
                (function(inp){
                  inp.addEventListener('focus', function(){ try { inp.classList.add('cast-note-focused'); } catch(_){} }, true);
                  inp.addEventListener('blur', function(){
                    try {
                      if (!inp.value) { inp.classList.remove('cast-note-focused','cast-note-filled'); }
                      else { inp.classList.add('cast-note-filled'); inp.classList.remove('cast-note-focused'); }
                    } catch(_){}
                  }, true);
                })(all[si]);
              }
            } catch(_bindErr){}
            document.querySelectorAll('[data-sched-cast-all]').forEach(function(b){b.onclick=function(){
              // 【20261002 行当同步】常用上场演员 = 演员 6 大行（不含武场/文场）
              var COMMON_KEYS = ['sheng','chou','jing','dan','erjia','juezi'];
              COMMON_KEYS.forEach(function(k){
                document.querySelectorAll('#schedCastBox input[type="checkbox"][name="schedCast['+k+'][]"]').forEach(function(cb){
                  cb.checked = true;
                });
              });
            };});
            document.querySelectorAll('[data-sched-cast-clear]').forEach(function(b){b.onclick=function(){
              document.querySelectorAll('#schedCastBox input[type=checkbox]').forEach(function(cb){cb.checked=false;});
              document.querySelectorAll('#schedCastBox input[data-cast-note], #schedCastBox input.sched-cast-note').forEach(function(i){
                try { i.value=''; i.classList.remove('cast-note-focused','cast-note-filled'); } catch(_){}
              });
            };});
          }
          renderSchedCast();
          if (window.QinRealPerformers && QinRealPerformers.ready) { QinRealPerformers.ready.then(function(){ renderSchedCast(); }); }
        })();
        

/* ===== [3/10] 原 schedule.html 行 2079-2083  ===== */

  // =============================================================================
  // 🔧 E3 FIX：排期日历 全按钮自动化事件绑定 + 去抖锁
  // =============================================================================
  

/* ===== [4/10] 原 schedule.html 行 2088-2673  ===== */

  (function __scheduleFinalPatch_TS3_TS4_TS5() {
    var __toast = function(msg,type){
      try{ if(window.QinApp&&QinApp.Utils&&QinApp.Utils.toast){QinApp.Utils.toast(msg,type||'info',3200);return;} }catch(_e){}
      try{ (type==='error'?alert:console.log)('[schedule-final] '+msg); }catch(_f){}
    };
    var __acq = function(key,ttl){
      if(window.__OP_LOCKS&&window.__OP_LOCKS[key]) return false;
      try{
        if(!window.__OP_LOCKS) window.__OP_LOCKS = {};
        window.__OP_LOCKS[key] = true;
        setTimeout(function(){try{delete window.__OP_LOCKS[key];}catch(_){}}, ttl||700);
      }catch(_lk){}
      return true;
    };
    var __closeAnyModal = function(){
      // TS5：通用关闭所有残留弹窗（防止"未绑定订单无法关闭"）
      try {
        var overlays = document.querySelectorAll('.modal-overlay, [id*="Overlay"], [id*="overlay"], .overlay, [class*="modal-overlay"]');
        overlays.forEach(function(o){
          try{ o.classList.remove('active'); o.classList.add('modal-overlay-hide'); }catch(_){ try{ o.style.display='none'; }catch(_a){} }
        });
        var modals = document.querySelectorAll('.modal, [id*="Modal"], [id*="modal"], [class*="modal-wrap"], .modal-wrap, .generic-modal-root, [role="dialog"]');
        modals.forEach(function(m){
          try{ m.classList.remove('active'); m.classList.add('modal-wrap-hide'); }catch(_){ try{ m.style.display='none'; }catch(_a){} }
        });
        // 清理任何 inline style 的 display:block 残留
        var leftover = document.querySelectorAll('[style*="z-index:9999"], [style*="z-index: 9999"], [style*="position:fixed"]');
        leftover.forEach(function(el){
          var st = (el.getAttribute('style')||'').toLowerCase();
          if (st.indexOf('position')>=0 && (st.indexOf('fixed')>=0 || st.indexOf('z-index')>=0) && el.id && (el.id.indexOf('verlay')>=0 || el.id.indexOf('odal')>=0 || el.id.indexOf('ispatch')>=0)) {
            try{ el.style.display='none'; }catch(_){}
          }
        });
      } catch (err) { console.warn('[closeAnyModal] err:', err); }
    };
    // 暴露到全局（行内"创建排期"后会调用）
    window.__closeAnyScheduleModal = __closeAnyModal;
    // ESC 全局关闭派工/新增弹窗
    try {
      document.addEventListener('keydown', function(e){
        if (e.key==='Escape') {
          try { if (typeof closeAddModal === 'function') closeAddModal(); }catch(_){}
          __closeAnyModal();
          try { if (window.__closeDispatchModal) window.__closeDispatchModal(); }catch(_){}
        }
      }, true);
    } catch(_escErr){}

    // =========================================================================
    //  TS3 FIX：查询重置真重置 + 素材上传 form novalidate + submit 防刷新
    // =========================================================================
    function __resetFilterBar(){
      var bar = document.querySelector('.admin-filter-bar');
      if (!bar) return 0;
      var sels = bar.querySelectorAll('select');
      var inputs = bar.querySelectorAll('input[type=text],input:not([type])');
      var resetCount = 0;
      try {
        // 第1个 select：年份 → 回到 {year}（第一项）
        if (sels && sels.length > 0) {
          if (sels[0].options && sels[0].options.length > 0) sels[0].selectedIndex = 0;
          resetCount++;
        }
        // 第2个 select：月份 → 7月（默认展示）
        if (sels && sels.length > 1) {
          try {
            for (var mi=0; mi<sels[1].options.length; mi++){
              if (String(sels[1].options[mi].value)==='7' || sels[1].options[mi].text.indexOf('7月')>=0){
                sels[1].selectedIndex = mi; break;
              }
            }
          }catch(_m){ sels[1].selectedIndex = 6; } // 7月=index6（1月=0）
          resetCount++;
        }
        // 第3个 select：演出类型 → 全部（value==""）
        if (sels && sels.length > 2) { sels[2].value=''; resetCount++; }
        // 第4个 select：排期状态 → 全部（value==""）
        if (sels && sels.length > 3) { sels[3].value=''; resetCount++; }
        inputs.forEach(function(inp){ try{ inp.value=''; }catch(_i){} });
      } catch (err) { console.warn('[resetFilterBar] err:', err); }
      return resetCount;
    }

    // 绑定查询栏的「重置」按钮
    try {
      var filterBtns = document.querySelectorAll('.admin-filter-bar .btn, .admin-filter-bar button');
      filterBtns.forEach(function(b){
        if (b.__ts3Done) return;
        var txt = (b.textContent||'').replace(/\s+/g,' ').trim();
        // 标记已绑定，防止 SuperPatch 拦截
        try { b.__superPatchBound = 1; } catch(_) {}
        if (txt.indexOf('重置')>=0 && txt.indexOf('今日')<0) {
          b.addEventListener('click', function(){
            if(!__acq('sch_fReset', 500)) return;
            var n = __resetFilterBar();
            // 重置后重新渲染日历到当前年月
            try {
              var sels0 = document.querySelectorAll('.admin-filter-bar select');
              var y0 = sels0[0] ? (parseInt(sels0[0].value,10)||new Date().getFullYear()) : new Date().getFullYear();
              var m0 = sels0[1] ? (parseInt(sels0[1].value,10)||1) : 1;
              if (window.__renderCalendar) window.__renderCalendar(y0, m0);
            } catch(_){}
            __toast('↺ 查询条件已重置（'+n+' 项恢复默认）','success');
          }, true);
          b.__ts3Done = 1;
        } else if (txt.indexOf('今日')>=0) {
          b.addEventListener('click', function(){
            if(!__acq('sch_fToday', 350)) return;
            var sels = document.querySelectorAll('.admin-filter-bar select');
            var now = new Date();
            var curY = now.getFullYear(), curM = now.getMonth()+1;
            if (sels && sels.length>=2) {
              try {
                for (var yi=0; yi<sels[0].options.length; yi++){
                  if (String(sels[0].options[yi].value)===String(curY)){ sels[0].selectedIndex = yi; break; }
                }
              }catch(_y){}
              try {
                for (var mj=0; mj<sels[1].options.length; mj++){
                  if (String(sels[1].options[mj].value)===String(curM)){ sels[1].selectedIndex = mj; break; }
                }
              }catch(_m){}
            }
            if (window.__renderCalendar) window.__renderCalendar(curY, curM);
            __toast('📅 已回到「今日」（'+curY+'年'+curM+'月）','success');
          }, true);
          b.__ts3Done = 1;
        } else if (txt.indexOf('查询')>=0) {
          b.addEventListener('click', function(){
            if(!__acq('sch_fSearch', 400)) return;
            var sels = document.querySelectorAll('.admin-filter-bar select');
            var y = sels[0] ? (parseInt(sels[0].value,10)||new Date().getFullYear()) : new Date().getFullYear();
            var m = sels[1] ? (parseInt(sels[1].value,10)||1) : 1;
            var type = sels[2] ? (sels[2].value||'') : '';
            var status = sels[3] ? (sels[3].value||'') : '';
            // 年月 → 重新渲染日历
            if (window.__renderCalendar) window.__renderCalendar(y, m);
            // 更新列表标题
            var lt = document.getElementById('listTitleText');
            if (lt) lt.textContent = y+'年 '+m+'月 全量排期清单（按日期升序）';
            // 提示筛选条件
            var parts = [];
            parts.push(y+'年'+m+'月');
            if (type) {
              var typeText = sels[2] && sels[2].options[sels[2].selectedIndex] ? sels[2].options[sels[2].selectedIndex].text : type;
              parts.push('类型:'+typeText);
            }
            if (status) {
              var statusText = sels[3] && sels[3].options[sels[3].selectedIndex] ? sels[3].options[sels[3].selectedIndex].text : status;
              parts.push('状态:'+statusText);
            }
            __toast('🔍 查询条件已生效：'+parts.join(' / '),'success');
          }, true);
          b.__ts3Done = 1;
        }
      });
    } catch (_fErr) { console.warn('[filterBtn bind err]:', _fErr); }

    // TS3：素材上传 form 添加 novalidate（防止原生校验气泡打断自定义校验） + submit preventDefault
    try {
      var upForm = document.getElementById('scheduleAttachForm');
      if (upForm) {
        // 【Fix-20260929】声明本表单自带提交校验（空文件/10MB/预览层），SuperPatch 1/6 识别放行
        try { upForm.__spOwnSubmit = 1; upForm.setAttribute('data-sp-own-submit','1'); }catch(_om){}
        try { upForm.setAttribute('novalidate','novalidate'); }catch(_n){}
        upForm.addEventListener('submit', function(ev){
          if (ev && ev.preventDefault) ev.preventDefault();
          if (ev && ev.stopPropagation) ev.stopPropagation();
          if(!__acq('sch_upload', 1000)) { __toast('⏳ 素材上传处理中，请稍候…','warning'); return false; }
          var fInput = document.getElementById('scheduleAttachFiles');
          var files = fInput ? (fInput.files || []) : [];
          if (files.length === 0) { __toast('⚠️ 请先选择需要上传的素材文件','warning'); return false; }
          var tooBig = [];
          for (var fi=0; fi<files.length; fi++){
            if (files[fi] && files[fi].size > 10*1024*1024) tooBig.push(files[fi].name || ('文件'+(fi+1)));
          }
          if (tooBig.length>0) { __toast('❌ 以下文件超过 10MB 限制：'+tooBig.join('、'),'error'); return false; }
          __toast('✅ 素材已提交：'+files.length+' 个文件（前端校验通过，等待真实后端上传接口）','success');
          try { upForm.reset(); }catch(_r){}
          return false;
        }, true);
      }
    } catch (_upErr) { console.warn('[upload form patch err]:', _upErr); }

    // TS3：新增排期 form 的「取消」按钮 —— 绑定关闭弹窗
    try {
      var addCancelBtn = document.getElementById('addScheduleCancel');
      if (addCancelBtn && !addCancelBtn.__ts3Done) {
        addCancelBtn.addEventListener('click', function(){
          if(!__acq('sch_addCancel', 400)) return;
          try { if (typeof closeAddModal === 'function') closeAddModal(); }catch(_c){}
          __closeAnyModal();
          __toast('🛑 已取消新增排期（未保存）','info');
        }, true);
        addCancelBtn.__ts3Done = 1;
      }
    } catch (_acErr) {}
    // TS3：新增排期 form 的重置（清空输入框 + 派工checkbox + 备注）
    try {
      var schedResetBtns = document.querySelectorAll('#addScheduleModal button[type="reset"], #scheduleAttachForm button[type="reset"]');
      schedResetBtns.forEach(function(rb){
        if (rb.__ts3Done) return;
        rb.addEventListener('click', function(ev){
          var form = rb.closest && rb.closest('form');
          if (form) {
            // 给点时间让 form.reset 执行，再额外清空派工
            setTimeout(function(){
              try {
                var cbs = document.querySelectorAll('#addScheduleModal input[type=checkbox]');
                cbs.forEach(function(c){ c.checked=false; });
                var notes = document.querySelectorAll('#addScheduleModal input.sched-cast-note, #addScheduleModal input[data-cast-note], #addScheduleModal textarea');
                notes.forEach(function(n){ try{ n.value=''; n.classList.remove('cast-note-filled','cast-note-focused'); }catch(_n){} });
                __toast('↺ 表单已重置为空白','info');
              }catch(_rs){}
            }, 60);
          }
        }, true);
        rb.__ts3Done = 1;
      });
    } catch (_rbErr) {}

    // =========================================================================
    //  TS4 FIX：演出剧目列链接点击 → 打开新增排期弹窗并预填剧目 + 档期ID
    // =========================================================================
    try {
      var operaLinks = document.querySelectorAll('a.sched-opera-link');
      operaLinks.forEach(function(a){
        if (a.__ts4Done) return;
        a.addEventListener('click', function(ev){
          if (ev && ev.preventDefault) ev.preventDefault();
          if(!__acq('sch_opera_'+(a.getAttribute('data-sid')||'x'), 500)) return;
          var opera = a.getAttribute('data-opera') || (a.textContent||'').replace(/[《》]/g,'');
          var sid = a.getAttribute('data-sid') || '';
          __toast('🎭 查看剧目「'+opera+'」排期详情：'+sid,'info');
          // 打开新增排期弹窗，预填剧目名（便于复制/对比）
          try {
            var stEl = document.getElementById('schedTitle');
            if (stEl && typeof openAddModal === 'function') {
              openAddModal();
              stEl.value = opera + '（参考档期ID：'+sid+'）';
              try{ stEl.focus(); }catch(_f){}
            }
          }catch(_op){}
          return false;
        }, true);
        a.__ts4Done = 1;
      });
    } catch (_opErr) { console.warn('[opera link bind err]:', _opErr); }

    // =========================================================================
    //  TS5 FIX：订单派工·演职人员分配（独立派工弹窗 + 关闭按钮 + 未绑定订单提示）
    // =========================================================================
    // 1) 构造独立的派工弹窗 DOM（如果不存在）
    try {
      if (!document.getElementById('dispatchOverlay')) {
        var dOv = document.createElement('div');
        dOv.id = 'dispatchOverlay';
        dOv.className = 'modal-overlay modal-overlay-hide';
        dOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9998;';
        document.body.appendChild(dOv);
      }
      if (!document.getElementById('dispatchModal')) {
        var dMd = document.createElement('div');
        dMd.id = 'dispatchModal';
        dMd.className = 'modal modal-wrap-hide';
        dMd.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg-card,#fff);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,0.22);width:94%;max-width:820px;z-index:9999;padding:0;max-height:92vh;overflow:hidden;';
        dMd.innerHTML = '<div style="padding:16px 22px;border-bottom:1.5px solid var(--border-light,#e5d9c0);display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,#0F4C81,#1E6FB5);color:#fff;">'
          + '<h3 style="margin:0;font-size:1.05rem;font-weight:600;display:flex;align-items:center;gap:8px;">🎭 <span id="dispatchModalTitle">订单派工·演职人员分配</span></h3>'
          + '<button id="dispatchCloseBtn" type="button" style="background:transparent;border:none;color:#fff;font-size:1.5rem;cursor:pointer;padding:0 8px;line-height:1;">×</button>'
          + '</div>'
          + '<div style="padding:22px 26px;overflow-y:auto;max-height:calc(92vh - 140px);">'
          +   '<div id="dispatchOrderHint" style="margin-bottom:16px;padding:12px 16px;border-radius:10px;background:linear-gradient(135deg,#fff7ed,#fef3c7);border:1.5px solid #f59e0b;color:#92400e;font-size:0.9rem;">'
          +     '<strong>⚠️ 未绑定订单：</strong>当前派工尚未关联正式订单号。请先在「订单预约管理」完成下单，或点击下方「继续临时派工」创建未审核派工草稿。'
          +   '</div>'
          +   '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-bottom:18px;">'
          +     '<div><label style="font-size:0.82rem;color:#475569;font-weight:600;margin-bottom:5px;display:block;">📋 关联订单号</label><input id="dispatchOrderId" type="text" class="form-control" placeholder="如：{year}-QA-00715 · 来自订单预约管理" readonly style="background:#f8fafc;cursor:not-allowed;"></div>'
          +     '<div><label style="font-size:0.82rem;color:#475569;font-weight:600;margin-bottom:5px;display:block;">🏷️ 演出剧目</label><input id="dispatchOpera" type="text" class="form-control" placeholder="未绑定订单，请先在列表中选择档期"></div>'
          +     '<div><label style="font-size:0.82rem;color:#475569;font-weight:600;margin-bottom:5px;display:block;">📅 演出日期</label><input id="dispatchDate" type="date" class="form-control"></div>'
          +     '<div><label style="font-size:0.82rem;color:#475569;font-weight:600;margin-bottom:5px;display:block;">📍 演出地点</label><input id="dispatchVenue" type="text" class="form-control" placeholder="如：陇城镇文化广场"></div>'
          +   '</div>'
          +   '<div style="border:1.5px solid #cbd5e1;border-radius:12px;padding:14px 18px;margin-bottom:18px;background:linear-gradient(135deg,#f8fafc,#eff6ff);">'
          +     '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">'
          +       '<h4 style="margin:0;color:#0f4c81;font-size:0.98rem;font-weight:700;">👥 演职人员勾选（按行当分组，每人独立备注）</h4>'
          +       '<div style="display:flex;gap:8px;">'
          +         '<button type="button" class="btn btn-sm" id="dispatchAllSelect" style="padding:5px 12px;background:#fff;border:1.5px solid #0f4c81;color:#0f4c81;">⚡ 全选主演</button>'
          +         '<button type="button" class="btn btn-sm" id="dispatchAllClear" style="padding:5px 12px;background:#fff;border:1.5px solid #dc2626;color:#dc2626;">🧹 清空</button>'
          +       '</div>'
          +     '</div>'
          +     '<div id="dispatchCastArea" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;"></div>'
          +   '</div>'
          +   '<div style="margin-bottom:18px;">'
          +     '<label style="font-size:0.82rem;color:#475569;font-weight:600;margin-bottom:5px;display:block;">📝 派工备注（交通/服装/道具/特殊要求）</label>'
          +     '<textarea id="dispatchRemark" rows="3" class="form-control" placeholder="如：7月15日上午8:30剧团集合出发，携带《三滴血》全部戏服道具……"></textarea>'
          +   '</div>'
          + '</div>'
          + '<div style="padding:14px 26px;border-top:1.5px solid var(--border-light,#e5d9c0);display:flex;justify-content:flex-end;gap:12px;flex-wrap:wrap;background:var(--bg-light,#faf7f0);">'
          +   '<button type="button" class="btn btn-secondary" id="dispatchCancelBtn">✕ 取消（关闭）</button>'
          +   '<button type="button" class="btn btn-outline-dark" id="dispatchTempBtn">📝 继续临时派工</button>'
          +   '<button type="button" class="btn btn-primary" id="dispatchSaveBtn">✓ 保存派工分配</button>'
          + '</div>';
        document.body.appendChild(dMd);
      }
    } catch (_dDomErr) { console.warn('[dispatchModal build err]:', _dDomErr); }

    // 派工弹窗人员卡片渲染
    function __renderDispatchCast(){
      var area = document.getElementById('dispatchCastArea');
      if (!area || area.children.length > 0) return;
      // 演职库异步返回后，若弹窗仍开着则重渲染一次
      if (!window.__rpSchedDispatchBound) {
        window.__rpSchedDispatchBound = 1;
        if (window.QinRealPerformers && QinRealPerformers.ready) {
          QinRealPerformers.ready.then(function () {
            var a = document.getElementById('dispatchCastArea');
            var m = document.getElementById('dispatchModal');
            if (a && m && /active/.test(m.className)) { a.innerHTML = ''; __renderDispatchCast(); }
          });
        }
      }
      // 20260922 真实化：候选人员来自 /v1/performers（QinRealPerformers），不内置假名
      var _rp = window.QinRealPerformers && QinRealPerformers.groups;
      function _rpGrp(key, label){
        var arr = (_rp && _rp[key]) || [];
        // 演员6行显示标准角色；武场/文场保留原始乐器工种
        var isBand = (key==='wuchang'||key==='wenchang');
        return { k: key, n: label, p: arr.map(function(x){
          var r = isBand ? (x.role||'') : (x.stdRole||x.role||'');
          return r ? (x.name + '（' + r + '）') : x.name;
        }) };
      }
      var CAST = [
        _rpGrp('sheng','生行（文须生·武须生·小生）'),
        _rpGrp('chou','丑行（丑角）'),
        _rpGrp('jing','净行（大花脸·二花脸）'),
        _rpGrp('dan','旦行（正旦·小旦·彩旦·二架旦）'),
        _rpGrp('erjia','二架（门官·家院）'),
        _rpGrp('juezi','角子（龙套·校尉·刀斧手·丫鬟·彩女·长随官）'),
        _rpGrp('houqin','后勤（帽箱·电工·前场·衣箱·剧务）'),
        _rpGrp('wuchang','武场（司鼓·梆子·打击乐）'),
        _rpGrp('wenchang','文场（板胡·二胡·扬琴等）')
      ];
      try {
        CAST.forEach(function(grp, gi){
          var card = document.createElement('div');
          try { card.classList.add('cast-card-base'); }catch(_){ card.style.cssText='border:1.5px solid #cbd5e1;border-radius:12px;background:#fff;padding:10px 12px;transition:all .2s;'; }
          card.onmouseover = function(){try{card.classList.add('cast-card-hover');}catch(_){}};
          card.onmouseout  = function(){try{card.classList.remove('cast-card-hover');}catch(_){}};
          var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px dashed #cbd5e1;">'
            + '<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#0f4c81,#1e6091);color:#fff;font-size:.74rem;font-weight:700;">'+grp.p.length+'</span>'
            + '<strong style="color:#0f4c81;font-size:0.9rem;">'+grp.n+'</strong></div>';
          grp.p.forEach(function(nm, pi){
            var sid2 = 'dp_'+gi+'_'+pi;
            html += '<div style="display:grid;grid-template-columns:22px 1fr 1.1fr;gap:6px;align-items:center;padding:3px 0;">'
              + '<input type="checkbox" id="'+sid2+'" value="'+nm.replace(/（/g,'(').replace(/）/g,')')+'" style="width:18px;height:18px;cursor:pointer;accent-color:#0f4c81;">'
              + '<label for="'+sid2+'" style="font-size:.84rem;color:#1e293b;cursor:pointer;margin:0;line-height:1.4;">'+nm+'</label>'
              + '<input type="text" class="dp-note" placeholder="备注/饰演" data-dp-note="'+grp.k+'|'+pi+'" style="padding:3px 7px;font-size:.78rem;border:1px solid #cbd5e1;border-radius:7px;outline:none;">'
              + '</div>';
          });
          card.innerHTML = html;
          area.appendChild(card);
        });
        // CSP合规：note focus/blur classList 切换
        var notes = area.querySelectorAll('input.dp-note, input[data-dp-note]');
        notes.forEach(function(inp){
          inp.addEventListener('focus', function(){try{inp.classList.add('cast-note-focused');}catch(_){}}, true);
          inp.addEventListener('blur', function(){
            try{
              if (!inp.value) inp.classList.remove('cast-note-focused','cast-note-filled');
              else { inp.classList.add('cast-note-filled'); inp.classList.remove('cast-note-focused'); }
            }catch(_){}
          }, true);
        });
      } catch (_rc) { console.warn('[renderDispatchCast err]:', _rc); }
    }

    // 派工弹窗 open / close
    function openDispatchModal(opts){
      opts = opts || {};
      if(!__acq('sch_dp_open', 400)) return;
      var ov = document.getElementById('dispatchOverlay');
      var md = document.getElementById('dispatchModal');
      if (!ov || !md) { alert('派工弹窗未初始化，请刷新页面'); return; }
      __renderDispatchCast();
      // 预填字段（若来自"未绑定订单"，则提示条保持显示）
      try {
        var orderHint = document.getElementById('dispatchOrderHint');
        var title2 = document.getElementById('dispatchModalTitle');
        var oId = document.getElementById('dispatchOrderId');
        var opEl = document.getElementById('dispatchOpera');
        var dEl = document.getElementById('dispatchDate');
        var vEl = document.getElementById('dispatchVenue');
        if (opts.orderId) {
          oId.value = opts.orderId;
          if (orderHint) orderHint.style.display = 'none';
          if (title2) title2.textContent = '订单派工·演职人员分配（订单 '+opts.orderId+'）';
        } else {
          oId.value = '';
          if (orderHint) orderHint.style.display = 'block';
          if (title2) title2.textContent = '订单派工·演职人员分配（未绑定订单）';
        }
        if (opts.opera && opEl) opEl.value = opts.opera;
        if (opts.date && dEl)  dEl.value = opts.date;
        if (opts.venue && vEl) vEl.value = opts.venue;
      }catch(_pref){}
      try {
        // 完整清除所有隐藏态：除自有 wrap-hide 外，全局兜底关闭逻辑还会加
        // s-modal-hide/s-overlay-hide/csp-hide（display:none !important），
        // 不清除会导致关闭后再次打开时弹窗视觉仍隐藏、点击穿透到下层页面。
        ov.classList.remove('modal-overlay-hide','s-overlay-hide','csp-hide');
        md.classList.remove('modal-wrap-hide','s-modal-hide','csp-hide');
        try { ov.style.display = ''; md.style.display = ''; } catch(_idsp){}
        ov.classList.add('active');
        md.classList.add('active','dispatch-modal-highlight');
      }catch(_s){}
      __toast('🎭 派工弹窗已打开'+(opts.orderId?' · 订单：'+opts.orderId:' · ⚠️ 未绑定订单'), opts.orderId?'info':'warning');
    }
    function closeDispatchModal(){
      var ov = document.getElementById('dispatchOverlay');
      var md = document.getElementById('dispatchModal');
      try { if(ov){ov.classList.remove('active'); ov.classList.add('modal-overlay-hide');} }catch(_){}
      try { if(md){md.classList.remove('active','dispatch-modal-highlight'); md.classList.add('modal-wrap-hide');} }catch(_){}
      __toast('🚪 派工弹窗已关闭','info');
    }
    window.__closeDispatchModal = closeDispatchModal;
    window.__openDispatchModal = openDispatchModal;

    // 绑定派工弹窗内部按钮（一次性）
    function __bindDispatchOnce(){
      try {
        var close1 = document.getElementById('dispatchCloseBtn');
        var close2 = document.getElementById('dispatchCancelBtn');
        var save   = document.getElementById('dispatchSaveBtn');
        var temp   = document.getElementById('dispatchTempBtn');
        var allSel = document.getElementById('dispatchAllSelect');
        var allClr = document.getElementById('dispatchAllClear');
        var dOv2   = document.getElementById('dispatchOverlay');
        if (close1 && !close1.__dpDone) { close1.onclick = function(){ closeDispatchModal(); }; close1.__dpDone=1; }
        if (close2 && !close2.__dpDone) { close2.addEventListener('click', function(){ closeDispatchModal(); }, true); close2.__dpDone=1; }
        if (dOv2 && !dOv2.__dpDone) {
          dOv2.addEventListener('click', function(e){ if(e.target===dOv2){ closeDispatchModal(); } }, true);
          dOv2.__dpDone=1;
        }
        if (allSel && !allSel.__dpDone) {
          allSel.addEventListener('click', function(){
            try {
              var area = document.getElementById('dispatchCastArea');
              if (area) area.querySelectorAll('input[type=checkbox][id*="dp_0_"], input[type=checkbox][id*="dp_1_"], input[type=checkbox][id*="dp_3_"], input[type=checkbox][id*="dp_6_"], input[type=checkbox][id*="dp_8_"]').forEach(function(cb){cb.checked=true;});
              __toast('⚡ 已选中主演行当（老生/须生/青衣/花脸/龙套）','success');
            }catch(_){}
          }, true);
          allSel.__dpDone=1;
        }
        if (allClr && !allClr.__dpDone) {
          allClr.addEventListener('click', function(){
            try {
              var area = document.getElementById('dispatchCastArea');
              if (area) {
                area.querySelectorAll('input[type=checkbox]').forEach(function(cb){cb.checked=false;});
                area.querySelectorAll('input[data-dp-note], input.dp-note').forEach(function(i){try{i.value='';i.classList.remove('cast-note-focused','cast-note-filled');}catch(_){}});
              }
              __toast('🧹 派工选择已清空','info');
            }catch(_){}
          }, true);
          allClr.__dpDone=1;
        }
        if (temp && !temp.__dpDone) {
          temp.addEventListener('click', function(){
            if(!__acq('sch_dp_temp', 600)) return;
            try {
              var hint = document.getElementById('dispatchOrderHint');
              if (hint) {
                hint.style.background = 'linear-gradient(135deg,#ecfdf5,#d1fae5)';
                hint.style.borderColor = '#10b981';
                hint.style.color = '#065f46';
                hint.innerHTML = '<strong>✅ 已进入「临时派工」模式：</strong>派工草稿将保存至本地，稍后可在订单预约管理中选择「关联已有派工」。';
              }
            }catch(_h){}
            __toast('📝 已切换为临时派工模式（可编辑剧目/日期/地点）','success');
            try {
              var oi = document.getElementById('dispatchOrderId');
              if (oi) oi.readOnly = false;
            }catch(_r){}
          }, true);
          temp.__dpDone=1;
        }
        if (save && !save.__dpDone) {
          save.addEventListener('click', function(){
            if(!__acq('sch_dp_save', 1000)) { __toast('⏳ 派工保存中，请稍候…','warning'); return; }
            // 校验：至少选1人
            try {
              var cbs = document.querySelectorAll('#dispatchCastArea input[type=checkbox]:checked');
              var op = (document.getElementById('dispatchOpera')||{}).value || '';
              var dt = (document.getElementById('dispatchDate')||{}).value || '';
              if (!op || !dt) { __toast('⚠️ 请填写：演出剧目 + 演出日期（派工至少需要1人）','warning'); return; }
              if (cbs.length < 4) { __toast('⚠️ 派工人员不足：至少勾选 4 名演职人员（当前 '+cbs.length+' 人）','warning'); return; }
              // 未绑定订单 → 警告后继续
              var oId2 = (document.getElementById('dispatchOrderId')||{}).value || '';
              var names = [];
              cbs.forEach(function(c){ var v = c.value || ''; if (v) names.push(v); });
              var payload = {
                id: 'DISP-'+(new Date().getTime().toString(36))+Math.random().toString(36).slice(2,6).toUpperCase(),
                orderId: oId2 || '(未绑定订单·草稿)',
                opera: op, date: dt,
                venue: (document.getElementById('dispatchVenue')||{}).value || '',
                remark: (document.getElementById('dispatchRemark')||{}).value || '',
                castCount: names.length,
                cast: names,
                savedAt: new Date().toISOString()
              };
              try {
                var list = [];
                try { list = JSON.parse(localStorage.getItem('qaxqjt_dispatch_v2')||'[]'); }catch(_p){ list = []; }
                list.unshift(payload);
                if (list.length > 500) list = list.slice(0, 500);
                localStorage.setItem('qaxqjt_dispatch_v2', JSON.stringify(list));
              }catch(_w){}
              __toast('✅ 派工保存成功：'+(oId2?'订单 '+oId2:'临时草稿')+' · 剧目《'+op+'》 · '+names.length+' 人'+(oId2?'':'（⚠️ 未绑定订单）'), 'success');
              setTimeout(closeDispatchModal, 500);
            } catch (svErr) { console.warn('[dispatch save err]:', svErr); __toast('❌ 派工保存失败：'+(svErr&&svErr.message?svErr.message:''),'error'); }
          }, true);
          save.__dpDone=1;
        }
      } catch (_bdErr) { console.warn('[bindDispatchOnce err]:', _bdErr); }
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') { setTimeout(__bindDispatchOnce, 120); }
    else document.addEventListener('DOMContentLoaded', function(){ setTimeout(__bindDispatchOnce, 120); });

    // 绑定所有「派工」按钮（列表 tbody 行中的 👥派工） → 打开派工弹窗（根据是否有订单号）
    function __bindAllDispatchButtons(){
      try {
        // 扫描：表格行内 .btn-action / button / a 中含"派工"字样
        var cand = document.querySelectorAll('button, a.action-link, .btn-action, [title*="派工"]');
        cand.forEach(function(el){
          if (el.__dpBound) return;
          var txt = ((el.textContent||'')+' '+(el.title||'')).replace(/\s+/g,' ');
          if (txt.indexOf('派工') < 0) return;
          el.addEventListener('click', function(ev){
            if (ev && ev.preventDefault) ev.preventDefault();
            if(!__acq('sch_dp_trigger_'+Math.random().toString(36).slice(2,6), 500)) return;
            // 找最近的 tr，读取剧目/日期/订单号
            var tr = el.closest && el.closest('tr');
            var opts = {};
            try {
              if (tr) {
                var tds = tr.querySelectorAll('td');
                if (tds && tds.length >= 7) {
                  // td[0] 档期ID / td[1] 日期 / td[6] 剧目 / td[4] 地点
                  var sid3 = (tds[0] ? tds[0].textContent : '').replace(/\s+/g,'').trim();
                  var dateStr = (tds[1] ? tds[1].textContent : '').trim() || '';
                  var operaTxt = (tds[6] ? tds[6].textContent : '').replace(/[《》]/g,'').trim() || '';
                  var venueTxt = (tds[4] ? tds[4].textContent : '').trim() || '';
                  // 未绑定订单的判定：档期ID是否为正式订单号
                  opts.date = dateStr;
                  opts.opera = operaTxt;
                  opts.venue = venueTxt;
                  // 档期ID前缀 SCH- → 未绑定真实订单
                  if (sid3.indexOf('SCH-')===0) {
                    opts.orderId = ''; // 未绑定订单 → 弹窗顶部警告
                  } else if (sid3) {
                    opts.orderId = sid3; // 假设正式订单ID
                  }
                }
              }
            }catch(_rd){}
            openDispatchModal(opts);
            return false;
          }, true);
          el.__dpBound = 1;
        });
      } catch (_bAllD) { console.warn('[bindAllDispatchButtons err]:', _bAllD); }
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') { setTimeout(__bindAllDispatchButtons, 180); }
    else document.addEventListener('DOMContentLoaded', function(){ setTimeout(__bindAllDispatchButtons, 180); });

    // 也给新增排期 submit 后的 closeAddModal 加上兜底：关闭后仍然保留 __closeAnyModal 通用
    try {
      var _origCloseAdd = (typeof closeAddModal === 'function') ? closeAddModal : null;
      if (_origCloseAdd) {
        window.closeAddModal = function(){
          try { _origCloseAdd(); }catch(_){}
          __closeAnyModal();
        };
      }
    }catch(_wr){}

    console.info('[schedule.html TS3/TS4/TS5 Final Patch 应用完成：查询重置/表单防刷新/剧目链接/派工弹窗+关闭]');
  })();
  

/* ===== [5/10] 原 schedule.html 行 2676-2885  ===== */

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
        /* P1修复:假成功已移除 */
        __T('⚠️ 该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; try { e.stopPropagation(); } catch(_b){} return;
      }
      if(isEdit){
        if(!__L(doneKey,700)) return;
        __pLog('DBF','edit_open', Object.assign({},__pEvt,{row:trKey, branch:'edit'}));
        /* P1修复:假成功已移除 */ __T('⚠️ 该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      if(isDel){
        if(!__L(doneKey,850)) { __T('⏳ 删除处理中…','warning'); try { e.stopPropagation(); } catch(_a){} return; }
        /* P1修复:假成功已移除（假确认框与假删行已移除） */
        __pLog('DBF','delete_confirm', Object.assign({},__pEvt,{row:trKey, branch:'delete'}));
        __T('⚠️ 该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; try { e.stopPropagation(); } catch(_b){} return;
      }
      if(isView){
        if(!__L(doneKey,500)) return;
        __pLog('DBF','view_detail', Object.assign({},__pEvt,{row:trKey, branch:'view'}));
        /* P1修复:假成功已移除 */ __T('⚠️ 该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      if(isVerify){
        if(!__L(doneKey,900)) { __T('⏳ 核销处理中…','warning'); return; }
        __pLog('DBF','verify_confirm', Object.assign({},__pEvt,{row:trKey, branch:'verify'}));
        /* P1修复:假成功已移除 */ __T('⚠️ 该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      if(isExport){
        if(!__L(doneKey,1200)) { __T('⏳ 正在导出，请稍候…','warning'); return; }
        __pLog('DBF','export_start', Object.assign({},__pEvt,{row:trKey, branch:'export'}));
        /* P1修复:假成功已移除 */ __T('⚠️ 该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      if(isAdd){
        if(!__L(doneKey,900)) return;
        __pLog('DBF','add_new', Object.assign({},__pEvt,{branch:'add'}));
        /* P1修复:假成功已移除 */ __T('⚠️ 该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      // ---- 新增：审核/审批/驳回/通过 ----
      var isAudit = txt.indexOf('审核')>=0 || txt.indexOf('审批')>=0 || txt.indexOf('驳回')>=0 || txt.indexOf('通过')>=0;
      if(isAudit){
        if(!__L(doneKey,850)){ __T('⏳ 审核处理中…','warning'); try{e.stopPropagation();}catch(_a){} return; }
        var act = (txt.indexOf('驳回')>=0)?'驳回':(txt.indexOf('通过')>=0?'通过':'审核');
        /* P1修复:假成功已移除（假确认框已移除） */
        __pLog('DBF','audit_result', Object.assign({},__pEvt,{row:trKey, branch:'audit', action:act}));
        __T('⚠️ 该功能暂未接入后端','warning');
        btn.__ctE2Done=1; try{e.stopPropagation();}catch(_b){} return;
      }
      // ---- 新增：签约/签订 ----
      var isSign = txt.indexOf('签约')>=0 || txt.indexOf('签订')>=0 || (txt.indexOf('签')>=0 && txt.indexOf('约')>=0);
      if(isSign){
        if(!__L(doneKey,900)){ __T('⏳ 签约流程处理中…','warning'); try{e.stopPropagation();}catch(_a){} return; }
        /* P1修复:假成功已移除（假确认框已移除） */
        __pLog('DBF','sign_confirm', Object.assign({},__pEvt,{row:trKey, branch:'sign'}));
        __T('⚠️ 该功能暂未接入后端','warning');
        btn.__ctE2Done=1; try{e.stopPropagation();}catch(_b){} return;
      }
      // ---- 新增：合同/生成合同 ----
      var isContract = txt.indexOf('合同')>=0 && !isSign;
      if(isContract){
        if(!__L(doneKey,1000)){ __T('⏳ 正在准备合同文档…','warning'); return; }
        __pLog('DBF','contract_ready', Object.assign({},__pEvt,{row:trKey, branch:'contract'}));
        /* P1修复:假成功已移除 */ __T('⚠️ 该功能暂未接入后端','warning');
        btn.__ctE2Done=1; return;
      }
      // ---- 新增：排期/排班/安排档期 ----
      var isScheduleBtn = txt.indexOf('排期')>=0 || txt.indexOf('排班')>=0 || (txt.indexOf('安排')>=0 && (txt.length<=8 || txt.indexOf('档期')>=0));
      if(isScheduleBtn){
        if(!__L(doneKey,800)){ __T('⏳ 正在打开排期面板…','warning'); return; }
        __pLog('DBF','schedule_open', Object.assign({},__pEvt,{row:trKey, branch:'schedule'}));
        /* P1修复:假成功已移除 */ __T('⚠️ 该功能暂未接入后端','warning');
        btn.__ctE2Done=1; return;
      }
      // ---- 新增：取消/处理/确认接单 ----
      var isCancelOrHandle = txt.indexOf('取消')>=0 || txt.indexOf('处理')>=0 || txt.indexOf('确认接单')>=0 || txt.indexOf('派工')>=0;
      if(isCancelOrHandle && !isDel && !isSave){
        if(!__L(doneKey,800)){ __T('⏳ 处理中…','warning'); try{e.stopPropagation();}catch(_a){} return; }
        /* P1修复:假成功已移除（假确认框已移除） */
        var chBranch = txt.indexOf('取消')>=0?'cancel':(txt.indexOf('确认接单')>=0?'accept':(txt.indexOf('派工')>=0?'dispatch':'handle'));
        __pLog('DBF','status_change', Object.assign({},__pEvt,{row:trKey, branch:chBranch}));
        __T('⚠️ 该功能暂未接入后端','warning');
        btn.__ctE2Done=1; try{e.stopPropagation();}catch(_b){} return;
      }

    }, true);
    console.info('[DeadButtonFallback 已加载：×兜底 + 保存/编辑/删除/查看/核销/导出/新增 死按钮兜底委托]');
    try{ window.__T = __T; window.__L = __L; }catch(_){}
  })();
  
} /* end of 防重复注入保护 if */

/* ===== [6/10] 原 schedule.html 行 2887-3631 attrs=id="adminSuperPatchV20260730" ===== */

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
        // 【Fix-20260929】表单自带提交处理器（如素材上传 scheduleAttachForm：空文件/10MB
        // 校验+预览）时直接放行，不再抢跑拦截——否则自定义校验永不可达，空文件也误报"提交成功"。
        if(form.__spOwnSubmit || form.hasAttribute('data-sp-own-submit')) return;
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
        /* P1修复:假成功已移除 */
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
        // 【Fix-20260929】真实业务按钮豁免：行内 data-act 按钮（如"⛔ 取消"排期）、工具栏
        // data-real-bound 按钮、弹窗自带 data-modal-close 按钮与 __ub 显式豁免标记，
        // 一律放行给自身处理器，不再被本兜底拦截（此前"取消排期/详情✕关闭"点击失效）。
        try{
          if(el.__ub) return;
          if(el.closest && el.closest('[data-act],[data-real-bound],[data-modal-close]')) return;
        }catch(_sp3Ex){}
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
    // 【Fix-20260929 M3】分页数据源：仅真实排期表 #scheduleListTbody（回退第一个 data-paginate=list）
    function _pgTargetTbody(){
      var tb = document.getElementById('scheduleListTbody');
      if (tb) return tb;
      var all = document.querySelectorAll('tbody[data-paginate=list]');
      return all.length ? all[0] : null;
    }
    // 真实数据行：带 data-sched-id 的行（排除"加载中/暂无数据"占位 colspan 行）
    function _pgDataRows(tb){
      if(!tb) return [];
      return Array.prototype.slice.call(tb.querySelectorAll('tr[data-sched-id]'));
    }
    // 翻页联动：按当前页切片显示真实数据行；数据不足一页时占位行自然保留
    function _applyPgSlice(container){
      try{
        var s = _ensurePgState(container);
        var tb = _pgTargetTbody();
        if(!tb) return;
        var rows = _pgDataRows(tb);
        if(!rows.length) return;
        var start = (s.current-1)*s.size, end = start+s.size;
        rows.forEach(function(tr,i){
          tr.style.display = (i>=start && i<end) ? '' : 'none';
        });
      }catch(_){}
    }
    function _ensurePgState(container){
      var st = pgStateMap.get(container);
      if(!st){ st = {total:0, pages:1, current:1, size:10}; pgStateMap.set(container, st); }
      // 每页条数以工具栏下拉为准（工具栏构建前默认10）
      var sizeSel = container.querySelector('select[data-pg=size]');
      if(sizeSel){ var sv = parseInt(sizeSel.value||'10',10); if(sv>0) st.size = sv; }
      // 总数实时取自真实排期表行数（不再写死100，也不再拿月历网格行数推算）
      var rows = _pgDataRows(_pgTargetTbody());
      st.total = rows.length;
      st.pages = Math.max(1, Math.ceil(st.total/st.size));
      if(st.current > st.pages) st.current = st.pages;
      if(st.current < 1) st.current = 1;
      return st;
    }
    // 【Fix-20260929 M3】若同一卡片内 pagination.js 已挂载真实分页栏（.pagination-bar，
    // 真实条数 + pg-hidden 切片 + 数据重载自动刷新），SP4 不再叠加自己的工具栏，避免双分页器互相打架
    function _pgRealBarExists(container){
      try{
        var scope = (container.closest && container.closest('.schedule-card,.admin-card,.card,main')) || document;
        return !!scope.querySelector('.pagination-bar');
      }catch(_){ return false; }
    }
    function _buildPg(container){
      try{
        if(container.hasAttribute('data-pg-built')||container.querySelector('.sp-pg-toolbar-20260730')) return; container.setAttribute('data-pg-built','1');
        if(container.classList && (container.classList.contains('sp-pg-toolbar-20260730')||container.classList.contains('pagination-toolbar'))) return;
        if(_pgRealBarExists(container)){
          // 静态分页占位（写死的"共15条/1·2页"）也一并隐藏，避免假数据残留
          try { container.style.display = 'none'; } catch(_h){}
          return;
        }
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
        // 【Fix-20260929 M3】页码/每页条数变化时联动真实表格行显隐
        _applyPgSlice(container);
      }catch(e){ console.warn('[SuperPatch 4/6 updateUI err]',e); }
    }
    function _scanPagination(){
      try{
        var all = document.querySelectorAll('div,nav,section,span');
        all.forEach(function(el){ if(el.hasAttribute('data-pg-built')) return; if(_isPgContainer(el)) _buildPg(el); });
        // 【Fix-20260929 M3】表格数据重载（tr 被替换）后刷新已建工具栏：
        // _buildPg 对已存在的工具栏会早退，这里显式重算总数/页数并重新切片；
        // 若真实分页栏（pagination.js）在本工具栏构建后才挂载，则拆除 SP4 工具栏让位
        document.querySelectorAll('.sp-pg-toolbar-20260730').forEach(function(wrap){
          var c = wrap.parentElement;
          try{
            if(c && _pgRealBarExists(c)){
              try{ wrap.remove(); }catch(_){}
              try{ c.style.display='none'; }catch(_){}
              try{ pgStateMap.delete(c); }catch(_){}
              return;
            }
            _updatePgUI(c);
          }catch(_){}
        });
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
    __bindBtn('openScheduleUploadBtn', function(){ var inp=document.createElement("input"); inp.type="file"; inp.accept=".xls,.xlsx,.csv"; inp.onchange=function(){ __T("📤 已选择："+(inp.files[0]?inp.files[0].name:"")+"（排期文件）","info"); }; inp.click(); });
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
        // 【Fix-20260929 L3】真实处理器（addEventListener / 动态 onclick）已绑定的按钮不拦截，
        // 避免首次点击被 SuperPatch 吞掉（_hasAction 仅识别静态 onclick 字符串）
        if(btn.hasAttribute && btn.hasAttribute('data-real-bound')) return;
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
        /* P1修复:假成功已移除（原各分支假成功/演示话术统一改为诚实提示） */
        __pLog('SP','fallback_'+tt, {branch:tt, txt:txt, row:trKey});
        __toastH9('⚠️ 该功能暂未接入后端','warning');
        return false;
      }catch(e6){ console.warn('[SuperPatch 6/6 click err]',e6); }
    }, true);
    console.info('[SuperPatch 6/6] 已激活 ✓');
  }catch(e){ console.warn('[SuperPatch 6/6 init err]',e); }

  console.info('['+PATCH_ID+'] 6合1超级补丁全部加载完毕 ✓');
})();

} /* end of 防重复注入保护 if */

/* ===== [7/10] 原 schedule.html 行 3635-3661  ===== */

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

/* ===== [8/10] 原 schedule.html 行 3663-3689  ===== */

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

/* ===== [9/10] 原 schedule.html 行 3690-3698  ===== */
/* 按钮防拦截：为有id的可点击元素预设 __superPatchBound，避免 SuperPatch 首次点击拦截 */
(function(){
  function __markBound(){
    var els=document.querySelectorAll('button[id], a[id], [data-action][id], .btn[id], .btn-action[id]');
    for(var i=0;i<els.length;i++){ var el=els[i]; if(!el.__superPatchBound){ el.__superPatchBound=1; } }
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',__markBound); }
  else { __markBound(); setTimeout(__markBound,500); }
})();

/* ===== [10/10] 原 schedule.html 行 3700-4043  ===== */

/* ========== 📅 排期管理：真实 API 接线（v20260921a）==========
 * 替换静态 demo 行为：load() 渲染列表 tbody，exportCsv() 拉取全量下载，
 * 行级事件委托处理查看/编辑/删除/状态切换。
 * API：QAXQJT_API（js/api-request.js 已加载）
 * 端点：/v1/schedules（GET 列表 / GET/:id / PATCH/:id / DELETE/:id）
 * 备份：schedule.html.bak-schedulefix-20260921
 * 注：submitAddSchedule() 已在原函数中改为 async + POST /v1/schedules
 * ======================================================== */
(function(){
  'use strict';
  if (window.__schedApi) return;
  window.__schedApi = {
    state: { list: [], filter: { keyword: '', status: '', year: '', month: '' }, loaded: false },

    _toast: function(msg, type){ try { if (typeof __toastS2 === 'function') return __toastS2(msg, type||'info', 2500); } catch(_){} try { if (typeof __T === 'function') return __T(msg, type||'info'); } catch(_){} try { console.log('[schedApi]', type, msg); } catch(_){} },
    _escape: function(s){ if (s === null || s === undefined) return ''; return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); },

    load: async function(){
      var tbody = document.getElementById('scheduleListTbody');
      if (!tbody) { console.warn('[schedApi] #scheduleListTbody not found'); return; }
      try {
        var q = { page: 1, pageSize: 200 };
        if (this.state.filter.keyword) q.keyword = this.state.filter.keyword;
        if (this.state.filter.status) q.status = this.state.filter.status;
        if (this.state.filter.year) q.year = parseInt(this.state.filter.year, 10);
        if (this.state.filter.month) q.month = parseInt(this.state.filter.month, 10);
        var resp = await QAXQJT_API.get('/v1/schedules', { query: q });
        var rows = Array.isArray(resp) ? resp : (resp && (resp.items || resp.list || resp.rows)) || [];
        this.state.list = rows;
        this._renderTbody(rows);
        this.state.loaded = true;
        try { if (window.QinPagination && typeof QinPagination.init === 'function') QinPagination.init(); } catch(_){}
      } catch(e) {
        console.warn('[__schedApi.load] 失败', e);
        this._toast('⚠️ 加载排期列表失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    _renderTbody: function(rows){
      var tbody = document.getElementById('scheduleListTbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      var self = this;
      var idx = 0;
      rows.forEach(function(s){
        idx++;
        var sid = String(s.id || s.scheduleNo || '');
        var showNo = String(s.scheduleNo || s.id || '');
        var dateStr = s.scheduleDateStart ? String(s.scheduleDateStart).slice(0,10) : (s.date || '—');
        var weekStr = '';
        try { var d = new Date(dateStr); if (!isNaN(d.getTime())) { weekStr = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getDay()]; } } catch(_){}
        var playTitle = s.playTitle || s.title || s.plays || '—';
        var venue = s.venueAddress || s.venueDistrict || s.venue || '—';
        var type = s.type || (s.remark && s.remark.indexOf('类型:')>=0 ? s.remark.split('类型:')[1].split('\n')[0] : '') || '—';
        var leader = '';
        if (s.remark && s.remark.indexOf('负责人:')>=0) {
          try { leader = s.remark.split('负责人:')[1].split(' ')[0].trim(); } catch(_){}
        }
        var status = s.status || 'draft';
        var statusBadge = self._statusBadge(status);
        var tr = document.createElement('tr');
        tr.setAttribute('data-sched-id', sid);
        tr.setAttribute('data-status', status);
        tr.innerHTML =
          '<td><strong class="sched-tag-bold">' + self._escape(showNo) + '</strong></td>' +
          '<td>' + self._escape(dateStr) + '</td>' +
          '<td>' + self._escape(weekStr || '—') + '</td>' +
          '<td>秦安县秦剧团</td>' +
          '<td>' + self._escape(venue) + '</td>' +
          '<td><span class="op-type-badge op-type-edit ws-nowrap">' + self._escape(type) + '</span></td>' +
          '<td class="sched-title-bold">' + self._escape(playTitle) + '</td>' +
          '<td>— 场</td>' +
          '<td>' + self._escape(leader || '—') + '</td>' +
          '<td><span class="status-tag ' + statusBadge.cls + ' ws-nowrap">' + statusBadge.text + '</span></td>' +
          '<td class="sched-actions-wrap"><div class="sched-actions" data-sched-row="' + sid + '">' +
            '<button class="btn-action btn-action-sm btn-action-gold" data-act="dispatch" title="查看派工">👥 派工</button>' +
            '<button class="btn-action btn-action-sm btn-action-gold" data-act="view" title="查看详情">👁️ 查看</button>' +
            (window.__schedCanWrite ? '<button class="btn-action btn-action-sm btn-action-outline" data-act="confirm" title="确认排期">✅ 确认</button>' : '') +
            (window.__schedCanWrite ? '<button class="btn-action btn-action-sm btn-action-outline" data-act="cancel" title="取消排期">⛔ 取消</button>' : '') +
            (window.__schedCanDelete ? '<button class="btn-action btn-action-sm btn-action-danger" data-act="del" title="删除排期">🗑️ 删除</button>' : '') +
          '</div></td>';
        tbody.appendChild(tr);
      });
      // 主动给行内按钮打早退标记，不依赖外部 guard
      try {
        var btns = tbody.querySelectorAll('button[data-act]');
        for (var bi = 0; bi < btns.length; bi++) {
          var b = btns[bi];
          if (!b.__superPatchBound) b.__superPatchBound = 1;
          if (!b.__ts3Done) b.__ts3Done = 1;
          if (!b.__bindDone) b.__bindDone = 1;
          if (!b.__ctE2Done) b.__ctE2Done = 1;
          if (!b.__deadBtnChecked) b.__deadBtnChecked = 1;
        }
      } catch(_){}
      if (window.__guardRealActions) { try { window.__guardRealActions(tbody); } catch(_){} }
      if (!idx) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:30px;color:#999;">暂无排期数据（可在「新增排期」中创建第一条）</td></tr>';
      }
    },

    _statusBadge: function(status){
      var map = {
        'draft':   { cls: 'status-pending',  text: '📋 待排演' },
        'scheduled': { cls: 'status-pending', text: '⏳ 待确认' },
        'confirmed': { cls: 'status-confirmed', text: '✓ 已确认' },
        'cancelled': { cls: 'status-cancelled', text: '✕ 已取消' },
        'completed': { cls: 'status-completed', text: '✓ 已完成' },
        'in_progress': { cls: 'status-confirmed', text: '🎬 进行中' }
      };
      return map[status] || { cls: 'status-pending', text: status };
    },

    exportCsv: async function(){
      try {
        this._toast('📊 正在拉取排期列表…', 'info');
        var resp = await QAXQJT_API.get('/v1/schedules', { query: { page: 1, pageSize: 500 } });
        var rows = Array.isArray(resp) ? resp : (resp && (resp.items || resp.list || resp.rows)) || [];
        if (!rows.length) { this._toast('⚠️ 没有可导出的排期', 'warning'); return; }
        var csv = ['档期ID,日期,星期,演出单位,地点,演出类型,甲方名称,场次,负责人,状态,创建时间'];
        var self = this;
        rows.forEach(function(s){
          var sid = String(s.scheduleNo || s.id || '');
          var dateStr = s.scheduleDateStart ? String(s.scheduleDateStart).slice(0,10) : (s.date || '');
          var weekStr = '';
          try { var d = new Date(dateStr); if (!isNaN(d.getTime())) weekStr = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getDay()]; } catch(_){}
          var playTitle = s.playTitle || s.title || s.plays || '';
          var venue = s.venueAddress || s.venueDistrict || s.venue || '';
          var type = s.type || (s.remark && s.remark.indexOf('类型:')>=0 ? s.remark.split('类型:')[1].split('\n')[0] : '') || '';
          var leader = '';
          if (s.remark && s.remark.indexOf('负责人:')>=0) {
            try { leader = s.remark.split('负责人:')[1].split(' ')[0].trim(); } catch(_){}
          }
          var status = s.status || 'draft';
          var statusText = (self._statusBadge(status) || {}).text || status;
          var createdAt = s.createdAt ? String(s.createdAt).slice(0,19) : '';
          var cells = [sid, dateStr, weekStr, '秦安县秦剧团', venue, type, playTitle, '1', leader, statusText, createdAt];
          csv.push(cells.map(function(c){ c = String(c).replace(/"/g, '""'); return /[",\n]/.test(c) ? '"' + c + '"' : c; }).join(','));
        });
        var blob = new Blob(['\ufeff' + csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        var today = new Date().toISOString().slice(0,10);
        a.download = 'qaxqjt-schedules-' + today + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(function(){ try { URL.revokeObjectURL(url); a.remove(); } catch(_){} }, 100);
        this._toast('✅ 已导出 ' + rows.length + ' 条排期', 'success');
      } catch(e) {
        console.warn('[__schedApi.exportCsv] 失败', e);
        this._toast('⚠️ 导出失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    _ensureDetailModal: function(){
      var existing = document.getElementById('scheduleDetailModal');
      if (existing) return existing;
      try {
        var ov = document.createElement('div');
        ov.id = 'scheduleDetailOverlay';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:none;align-items:center;justify-content:center;';
        var box = document.createElement('div');
        box.id = 'scheduleDetailModal';
        box.style.cssText = 'position:relative;background:var(--bg-card,#fff);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,0.2);width:94%;max-width:640px;max-height:92vh;overflow-y:auto;';
        box.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border,#eee);">' +
            '<h3 style="margin:0;font-size:1.08rem;font-weight:600;">📅 档期详情</h3>' +
            '<button type="button" id="scheduleDetailClose" class="btn btn-sm btn-secondary">✕ 关闭</button>' +
          '</div>' +
          '<div id="scheduleDetailBody" style="padding:20px;"></div>';
        ov.appendChild(box);
        document.body.appendChild(ov);
        function hide(){ ov.style.display = 'none'; }
        ov.addEventListener('click', function(e){ if (e.target === ov) hide(); });
        var _dClose = box.querySelector('#scheduleDetailClose');
        // 【Fix-20260929】打豁免标记：SP3/6 按"✕/关闭"文本拦截 document 捕获点击会吞掉
        // 本按钮的 hide()，SP6/6 死按钮兜底亦会拦截；标记后两层兜底均识别放行。
        try { _dClose.__ub = 1; _dClose.__superPatchBound = 1; _dClose.__deadBtnChecked = 1; _dClose.setAttribute('data-modal-close','1'); } catch(_dm){ }
        _dClose.addEventListener('click', hide);
        document.addEventListener('keydown', function(e){ if (e.key === 'Escape') hide(); });
        return box;
      } catch(_e){ return null; }
    },

    viewDetail: async function(id){
      if (!id) return;
      try {
        // 【Fix-20260929 L6】静默详情请求：404（排期刚被删除）由本函数按"已删除"语义友好处理，
        // 不再先弹全局红色"排期不存在"错误 toast 再抛二次提示
        var s = await QAXQJT_API.get('/v1/schedules/' + encodeURIComponent(id), { showErrorToast: false });
        if (!s) { this._toast('⚠️ 未找到该排期', 'warning'); return; }
        var dateStart = s.scheduleDateStart ? String(s.scheduleDateStart).slice(0,16).replace('T',' ') : (s.date || '—');
        var dateEnd = s.scheduleDateEnd ? String(s.scheduleDateEnd).slice(0,10) : '';
        var playTitle = s.playTitle || s.title || s.plays || '—';
        var venue = s.venueAddress || s.venueDistrict || s.venue || '—';
        var type = s.type || (s.remark && s.remark.indexOf('类型:')>=0 ? s.remark.split('类型:')[1].split('\n')[0] : '') || '—';
        var leader = '';
        if (s.remark && s.remark.indexOf('负责人:')>=0) { try { leader = s.remark.split('负责人:')[1].split(' ')[0].trim(); } catch(_){} }
        var box = this._ensureDetailModal();
        if (!box) {
          alert([
            '档期ID：' + (s.scheduleNo || s.id || id),
            '甲方名称：' + playTitle,
            '日期：' + dateStart,
            '地点：' + venue,
            '状态：' + (s.status || 'draft'),
            '备注：' + (s.remark || '—')
          ].join('\n'));
          return;
        }
        var esc = this._escape;
        var badge = this._statusBadge(s.status || 'draft');
        var rows = [
          ['档期编号', s.scheduleNo || s.id || id, false],
          ['甲方名称', playTitle, false],
          ['开始时间', dateStart, false],
          ['结束时间', dateEnd || '—', false],
          ['演出团队', s.performTeam || '秦安县秦剧团', false],
          ['演出地点', venue, false],
          ['演出类型', type, false],
          ['负责人', leader || '—', false],
          ['当前状态', '<span class="status-tag ' + badge.cls + '">' + badge.text + '</span>', true],
          ['备注', s.remark || '—', false]
        ];
        var html = '<div style="display:grid;grid-template-columns:88px 1fr;gap:10px 14px;font-size:0.95rem;align-items:start;">';
        for (var i = 0; i < rows.length; i++) {
          var label = rows[i][0], val = rows[i][1], isHtml = rows[i][2];
          html += '<div style="color:#888;">' + esc(label) + '</div>' +
                  '<div style="color:#222;word-break:break-word;">' + (isHtml ? val : esc(val)) + '</div>';
        }
        html += '</div>';
        box.querySelector('#scheduleDetailBody').innerHTML = html;
        document.getElementById('scheduleDetailOverlay').style.display = 'flex';
      } catch(e) {
        console.warn('[viewDetail] id=' + id, e);
        // 【Fix-20260929 L6】404 = 排期已被删除（常见于删除后残留点击/旧弹窗）：
        // 关闭可能残留的详情弹窗、刷新列表清掉失效行，仅给一条温和提示，不再报"加载详情失败"
        if (e && (e.status === 404 || e.code === 'NOT_FOUND')) {
          try {
            var ov = document.getElementById('scheduleDetailOverlay');
            if (ov) ov.style.display = 'none';
          } catch(_) {}
          this._toast('ℹ️ 该排期已被删除，列表已刷新', 'info');
          try { if (typeof this.load === 'function') Promise.resolve(this.load()).catch(function(){}); } catch(_) {}
          try { if (typeof window.__schedRealReload === 'function') window.__schedRealReload(); } catch(_) {}
          return;
        }
        this._toast('⚠️ 加载详情失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    setStatus: async function(id, newStatus){
      if (!id) return;
      var verb = (newStatus === 'confirmed') ? '确认' : (newStatus === 'cancelled' ? '取消' : '更新');
      if (!confirm('确认' + verb + '该排期？')) return;
      try {
        await QAXQJT_API.patch('/v1/schedules/' + encodeURIComponent(id), { status: newStatus });
        this._toast('✅ 排期已' + verb, 'success');
        await this.load();
        // 【Fix-20260929 L4/L6】同步列表卡片/月历/周视图状态，避免只刷表格造成视图间不一致
        try { if (typeof window.__schedRealReload === 'function') window.__schedRealReload(); } catch(_) {}
      } catch(e) {
        console.warn('[setStatus] id=' + id, e);
        this._toast('⚠️ ' + verb + '失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    deleteSchedule: async function(id){
      if (!id) return;
      if (!confirm('确认删除排期 ' + id + '？\n此操作不可撤销。')) return;
      try {
        await QAXQJT_API.del('/v1/schedules/' + encodeURIComponent(id));
        this._toast('✅ 排期已删除', 'success');
        await this.load();
        try { if (typeof window.__schedRealReload === 'function') window.__schedRealReload(); } catch(_) {}
      } catch(e) {
        console.warn('[deleteSchedule] id=' + id, e);
        this._toast('⚠️ 删除失败：' + (e && e.message ? e.message : e), 'error');
      }
    },

    _bindRowDelegation: function(){
      var self = this;
      if (this._rowDelegBound) return;
      this._rowDelegBound = true;
      var tbody = document.getElementById('scheduleListTbody');
      if (tbody) {
        tbody.addEventListener('click', function(e){
          var btn = e.target.closest('button[data-act]');
          if (!btn) return;
          var tr = btn.closest('tr');
          var id = tr ? tr.getAttribute('data-sched-id') : '';
          if (!id) return;
          var act = btn.getAttribute('data-act');
          try { e.stopImmediatePropagation(); e.stopPropagation(); } catch(_){}
          if (act === 'view') { self.viewDetail(id); }
          else if (act === 'dispatch') {
            // 打开派工弹窗：优先用内存中的排期记录预填订单号/剧目/日期/地点，回退读表格列
            var sRow = null;
            try {
              for (var li = 0; li < self.state.list.length; li++) {
                if (String(self.state.list[li].id || self.state.list[li].scheduleNo || '') === id) { sRow = self.state.list[li]; break; }
              }
            } catch(_sf) {}
            var dOpts = {};
            if (sRow) {
              dOpts.orderId = sRow.orderId || '';
              dOpts.opera = sRow.playTitle || sRow.title || sRow.plays || '';
              dOpts.date = sRow.scheduleDateStart ? String(sRow.scheduleDateStart).slice(0,10) : (sRow.date || '');
              dOpts.venue = sRow.venueAddress || sRow.venueDistrict || sRow.venue || '';
            } else if (tr) {
              var tds = tr.querySelectorAll('td');
              if (tds.length >= 7) {
                dOpts.date = (tds[1] ? tds[1].textContent : '').trim();
                dOpts.opera = (tds[6] ? tds[6].textContent : '').replace(/[《》]/g,'').trim();
                dOpts.venue = (tds[4] ? tds[4].textContent : '').trim();
              }
            }
            if (typeof window.__openDispatchModal === 'function') window.__openDispatchModal(dOpts);
            else self._toast('⚠️ 派工弹窗未初始化，请刷新页面', 'error');
          }
          else if (act === 'confirm') { self.setStatus(id, 'confirmed'); }
          else if (act === 'cancel') { self.setStatus(id, 'cancelled'); }
          else if (act === 'del') { self.deleteSchedule(id); }
        }, true);
      }
    }
  };

  function _bootStrap(){
    var api = window.__schedApi;
    if (!api) return;
    api._bindRowDelegation();
    api.load();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootStrap);
  } else {
    setTimeout(_bootStrap, 200);
  }
})();
