/* staff.pre-3.js — 从 admin/staff.html 抽取的内联脚本（第 3/4 段，保持原执行位置） */

/* ===== staff.html inline block (run 3, #1/8) ===== */
/* 行当口径（20261003 修订）：花名册/工资/考勤共用归一函数，
     与 cast-sheet.html _bucketOf、orders 派工单、schedule 排期完全一致：
     6 大行 23 角色 + 武场/文场（共 25 分类，含后勤大类）。旧行当值读取时自动归一，数据库原文保留。 */
  (function () {
    if (window.QaxRoles) return;
    var RULES = [
      ['武场', /武场|司鼓|板鼓|梆子|大锣|小锣|马锣|铙|钹|镲|堂鼓|战鼓|木鱼|打击|鼓师|武二手|鼓/],
      ['文场', /文场|板胡|二胡|高胡|椰胡|扬琴|琵琶|三弦|古筝|竹笛|梅管|唢呐|海笛|笙|大提琴|贝司|提琴|电子琴|文二手|琴/],
      ['帽箱', /帽箱|盔箱|盔头|盔|戏帽|帽倌|王帽|纱帽|扎巾|额子|凤冠|驸马套/],
      ['衣箱', /衣箱|箱倌|行头|服装|跟包|化妆|大头|勾脸|脸谱|道具/],
      ['电工', /电工|灯光|音响|话筒|耳麦|麦|配电|设备/],
      ['剧务', /剧务|舞台监督|监督|催场|场记|字幕|装台|布景|拆台/],
      ['前场', /前场|前台|检票|引导|后勤/],
      ['大花脸', /大花脸|大净|铜锤|包公|包拯|徐延昭|尉迟恭/],
      ['二花脸', /二花脸|架子花|武花|副净|武净|花脸|净|张飞|李逵|曹操/],
      ['丑角', /丑/],
      ['武须生', /武须生|靠把|红生|武老生|武生|关羽|关公|赵匡胤/],
      ['文须生', /须生|老生|安工|衰派/],
      ['小生', /小生/],
      ['正旦', /正旦|青衣|老旦/],
      ['小旦', /小旦|花旦|闺门旦|武旦|刀马旦/],
      ['彩旦', /彩旦|丑婆|丑旦/],
      ['二架旦', /二架旦|二路旦|二架女/],
      ['门官', /门官|二架男/],
      ['家院', /家院|老管家|老仆/],
      ['校尉', /校尉/],
      ['刀斧手', /刀斧手|刽子手/],
      ['丫鬟', /丫鬟|丫环|使女/],
      ['彩女', /彩女|宫娥/],
      ['长随官', /长随官|长随/],
      ['龙套', /龙套|青袍|文堂|流行/]
    ];
    function stdRole(role) {
      var s = String(role || '');
      for (var i = 0; i < RULES.length; i++) { if (RULES[i][1].test(s)) return RULES[i][0]; }
      return '前场';
    }
    var BIG = {
      '文须生':'生行', '武须生':'生行', '小生':'生行',
      '丑角':'丑行',
      '大花脸':'净行', '二花脸':'净行',
      '正旦':'旦行', '小旦':'旦行', '彩旦':'旦行', '二架旦':'旦行',
      '门官':'二架', '家院':'二架',
      '龙套':'角子', '校尉':'角子', '刀斧手':'角子', '丫鬟':'角子', '彩女':'角子', '长随官':'角子',
      '帽箱':'后勤', '电工':'后勤', '前场':'后勤', '衣箱':'后勤', '剧务':'后勤',
      '武场':'武场', '文场':'文场'
    };
    // 新行当 → 既有工资矩阵档（工资矩阵本次不改，自动归并）
    var WAGE_MAP = {
      '文须生':'须生', '武须生':'老生', '小生':'小生', '丑角':'丑角',
      '大花脸':'花脸', '二花脸':'花脸',
      '正旦':'青衣', '小旦':'花旦', '彩旦':'花旦', '二架旦':'花旦',
      '门官':'龙套', '家院':'龙套', '龙套':'龙套', '校尉':'龙套', '刀斧手':'龙套', '丫鬟':'龙套', '彩女':'龙套', '长随官':'龙套',
      '电工':'灯光', '前场':'道具', '剧务':'道具', '衣箱':'服装', '帽箱':'服装'
    };
    var LEGACY_WAGE = ['青衣','老生','须生','花脸','小生','老旦','花旦','丑角','龙套','板胡','司鼓','二胡','板胡伴奏','扬琴','笛子','唢呐','打击乐','灯光','音响','服装','道具','化妆','布景'];
    function wageKey(role) {
      var raw = String(role || '').trim();
      if (LEGACY_WAGE.indexOf(raw) >= 0) return raw;
      var std = stdRole(raw);
      if (WAGE_MAP[std]) return WAGE_MAP[std];
      if (std === '武场') return '打击乐';
      if (std === '文场') return '板胡伴奏';
      return '其他';
    }
    window.QaxRoles = {
      stdRole: stdRole,
      bigName: function (role) { return BIG[stdRole(role)] || ''; },
      wageKey: wageKey
    };
  })();

/* ===== staff.html inline block (run 3, #2/8) ===== */
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
      function initUserInfo() {
        if (!currentSession) return;
        var name = currentSession.name || '管理员';
        var role = currentSession.roleName || '管理员';
        var username = currentSession.username || 'a';
        var initial = name.charAt(0) || username.charAt(0).toUpperCase();
        var avatar = document.getElementById('userAvatar');
        if (avatar) avatar.textContent = initial;
        var nameEl = document.getElementById('userName'); if (nameEl) nameEl.textContent = name;
        var roleEl = document.getElementById('userRole'); if (roleEl) roleEl.textContent = role;
        var dhName = document.getElementById('dhName'); if (dhName) dhName.textContent = name;
      }
      initUserInfo();
      var userDropdown = document.getElementById('userDropdown');
      var userToggle = document.getElementById('userToggle');
      var dropdownMenu = document.getElementById('dropdownMenu');
      function closeUserDropdown() { if (userDropdown) userDropdown.classList.remove('open'); }
      if (userToggle) {
        userToggle.addEventListener('click', function(e) { e.stopPropagation(); userDropdown.classList.toggle('open'); });
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
      function openMobileSidebar() { sidebar.classList.add('mobile-open'); overlay.classList.add('active'); }
      function closeMobileSidebar() { sidebar.classList.remove('mobile-open'); overlay.classList.remove('active'); }
      if (toggle) {
        toggle.addEventListener('click', function() {
          if (sidebar.classList.contains('mobile-open')) closeMobileSidebar(); else openMobileSidebar();
        });
      }
      if (overlay) overlay.addEventListener('click', closeMobileSidebar);
      window.toggleFullscreen = function() {
        if (!document.fullscreenElement) { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); }
        else { document.exitFullscreen && document.exitFullscreen(); }
      };

      var tabs = document.querySelectorAll('#staffTabs .staff-tab');
      tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
          tabs.forEach(function(t) { t.classList.remove('active'); });
          tab.classList.add('active');
          var key = tab.getAttribute('data-tab');
          document.querySelectorAll('.staff-tab-content').forEach(function(c) { c.classList.remove('active'); });
          var target = document.getElementById('tab-' + key);
          if (target) target.classList.add('active');
          if (key === 'stats') animateStaffBars();
        });
      });

      function animateStaffBars() {
        var bars = document.querySelectorAll('.staff-bar-fill');
        bars.forEach(function(bar, index) {
          var finalWidth = bar.style.width;
          bar.style.width = '0%';
          setTimeout(function() { bar.style.width = finalWidth; }, 80 + index * 100);
        });
      }

      var _now0 = new Date();
      var viewYear = _now0.getFullYear();
      var viewMonth = _now0.getMonth();
      var attMonthCache = []; // 当月真实考勤记录（/v1/attendance）

      function pad2m(n){ return String(n).padStart(2,'0'); }
      function monthKey(){ return viewYear + '-' + pad2m(viewMonth + 1); }

      // 考勤类型 → 日历点样式
      function dotClassOf(type){
        if (type === 'absent') return 'absent';
        if (['SL','PL','BL','ML','AL','leave','outing','study','business','injury','rest','rainout'].indexOf(type) >= 0) return 'leave';
        return 'ok'; // full/night/double/half
      }
      function hhmm(iso){
        if (!iso) return '';
        var t = new Date(iso); if (isNaN(t.getTime())) return '';
        return pad2m(t.getHours()) + ':' + pad2m(t.getMinutes());
      }

      // 初始化年/月下拉
      (function initMonthSelectors(){
        var ys = document.getElementById('attendanceYear');
        var ms = document.getElementById('attendanceMonth');
        if (ys) {
          var cy = new Date().getFullYear();
          for (var y = cy + 1; y >= cy - 3; y--) {
            var op = document.createElement('option');
            op.value = String(y); op.textContent = y + '年';
            if (y === viewYear) op.selected = true;
            ys.appendChild(op);
          }
          ys.addEventListener('change', function(){ viewYear = parseInt(this.value, 10); loadAttendance(); });
        }
        if (ms) {
          for (var m = 0; m < 12; m++) {
            var o = document.createElement('option');
            o.value = String(m); o.textContent = (m + 1) + '月';
            if (m === viewMonth) o.selected = true;
            ms.appendChild(o);
          }
          ms.addEventListener('change', function(){ viewMonth = parseInt(this.value, 10); loadAttendance(); });
        }
        var stf = document.getElementById('attendanceStaff');
        if (stf) stf.addEventListener('change', function(){ loadAttendance(); });
      })();

      // 从真实花名册填充人员下拉
      function fillAttendanceStaff(rows){
        var sel = document.getElementById('attendanceStaff');
        if (!sel) return;
        var cur = sel.value;
        sel.innerHTML = '<option value="">全部人员</option>';
        (rows || []).forEach(function(p){
          var op = document.createElement('option');
          op.value = p.id; op.textContent = (p.staffNo ? p.staffNo + ' ' : '') + p.name;
          sel.appendChild(op);
        });
        sel.value = cur || '';
      }

      window.changeCalMonth = function(d) {
        viewMonth += d;
        if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        syncMonthSelectors();
        loadAttendance();
      };
      window.resetCalMonth = function() {
        var t = new Date();
        viewYear = t.getFullYear(); viewMonth = t.getMonth();
        syncMonthSelectors();
        loadAttendance();
      };
      function syncMonthSelectors(){
        var ys = document.getElementById('attendanceYear');
        var ms = document.getElementById('attendanceMonth');
        if (ys) {
          if (!Array.from(ys.options).some(function(o){ return o.value === String(viewYear); })) {
            var op = document.createElement('option');
            op.value = String(viewYear); op.textContent = viewYear + '年';
            ys.appendChild(op);
          }
          ys.value = String(viewYear);
        }
        if (ms) ms.value = String(viewMonth);
      }

      // 拉取真实考勤（日历 + 异常卡 + 明细表）
      function loadAttendance(){
        var API = window.QAXQJT_API;
        if (!API) { console.warn('[attendance] QAXQJT_API 未就绪'); return Promise.resolve(); }
        var mk = monthKey();
        var stfSel = document.getElementById('attendanceStaff');
        var staffId = stfSel ? stfSel.value : '';
        var query = { month: mk, page: 1, pageSize: 500 };
        if (staffId) query.staffId = staffId;
        var p1 = API.get((QAXQJT_PATHS.ATTENDANCE || '/v1/attendance'), { query: query, showErrorToast: false, timeoutMs: 8000, fallbackRead: function(){ return null; } })
          .then(function(res){
            attMonthCache = Array.isArray(res) ? res : (res && res.items) || [];
          }).catch(function(){ attMonthCache = []; });
        var p2 = API.get((QAXQJT_PATHS.ATTENDANCE_STATS || '/v1/attendance/stats'), { query: { month: mk }, showErrorToast: false, timeoutMs: 8000, fallbackRead: function(){ return null; } })
          .then(function(res){ renderAttStats(res || {}); })
          .catch(function(){ renderAttStats({}); });
        p1.then(function(){ renderAttCal(); renderAttList(); renderAttWarnings(); });
        return Promise.all([p1, p2]);
      }
      window.__ATT_LOAD__ = loadAttendance;

      function renderAttCal() {
        var grid = document.getElementById('attendanceCalGrid');
        if (!grid) return;
        var title = document.getElementById('attCalTitle');
        if (title) title.textContent = '📆 ' + viewYear + '年' + (viewMonth + 1) + '月考勤日历';
        grid.innerHTML = '';
        var wds = ['日','一','二','三','四','五','六'];
        wds.forEach(function(d, idx) {
          var el = document.createElement('div');
          el.className = 'cal-weekday' + (idx === 0 || idx === 6 ? ' we' : '');
          el.textContent = d;
          grid.appendChild(el);
        });
        // 按"日"聚合真实记录：同一天取最严重状态（absent>leave>ok）
        var byDay = {};
        attMonthCache.forEach(function(r){
          var dstr = r.date || '';
          var dayPart = parseInt(dstr.substring(8, 10), 10);
          if (!dayPart) return;
          var cls = dotClassOf(r.type);
          var rank = { absent: 3, leave: 2, ok: 1 };
          if (!byDay[dayPart] || rank[cls] > rank[byDay[dayPart].cls]) {
            byDay[dayPart] = { cls: cls, count: (byDay[dayPart] ? byDay[dayPart].count + 1 : 1) };
          } else {
            byDay[dayPart].count++;
          }
        });
        var firstDay = new Date(viewYear, viewMonth, 1).getDay();
        var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        var today = new Date();
        var isCurrent = (today.getFullYear() === viewYear && today.getMonth() === viewMonth);
        for (var i = 0; i < firstDay; i++) {
          var empty = document.createElement('div');
          empty.className = 'cal-day empty';
          grid.appendChild(empty);
        }
        for (var day = 1; day <= daysInMonth; day++) {
          var cell = document.createElement('div');
          cell.className = 'cal-day';
          var numEl = document.createElement('div');
          numEl.className = 'd-num';
          numEl.textContent = day;
          cell.appendChild(numEl);
          if (isCurrent && day === today.getDate()) cell.classList.add('today');
          var stEl = document.createElement('div');
          stEl.className = 'd-status';
          var info = byDay[day];
          if (info) {
            var dot = document.createElement('div');
            dot.className = 'd-dot ' + info.cls;
            stEl.appendChild(dot);
            cell.title = viewYear + '-' + pad2m(viewMonth + 1) + '-' + pad2m(day) + ' 考勤记录：' + info.count + '条';
          }
          cell.appendChild(stEl);
          grid.appendChild(cell);
        }
      }

      function renderAttStats(d){
        var tb = d.typeBreakdown || {};
        var leaveTypes = ['SL','PL','BL','ML','AL','leave','outing','study','business','injury'];
        var leaveCount = 0;
        leaveTypes.forEach(function(t){ leaveCount += (tb[t] || 0); });
        function setT(id, v){ var el = document.getElementById(id); if (el) el.textContent = v; }
        setT('attStatLate', 0);   // V1 考勤表无迟到类型（迟到在 V2 考勤机数据中统计）
        setT('attStatEarly', 0);  // 同上
        setT('attStatAbsent', tb.absent || 0);
        setT('attStatLeave', leaveCount);
        setT('attStatPending', d.pendingLeaves || 0);
      }

      var ATT_TYPE_TEXT = {
        full:'全天班', night:'夜班', double:'双班', half:'半天班', rest:'公休',
        SL:'病假', PL:'事假', BL:'丧假', ML:'婚假', AL:'年假', absent:'旷工',
        late:'迟到(30分钟内)', late_over:'迟到超30分钟',
        rainout:'雨休', leave:'请假', outing:'外出', study:'学习', business:'出差', injury:'工伤'
      };
      function renderAttList(){
        var tb = document.getElementById('attendanceListTbody');
        if (!tb) return;
        if (!attMonthCache.length) {
          tb.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--text-light,#999);">该月暂无真实考勤记录（考勤机打卡/补卡后自动显示）</td></tr>';
          return;
        }
        var html = '';
        attMonthCache.slice(0, 200).forEach(function(r){
          var typeText = ATT_TYPE_TEXT[r.type] || r.type || '';
          var typeColor = r.type === 'absent' ? '#dc3545' : (['SL','PL','BL','ML','AL','leave'].indexOf(r.type) >= 0 ? '#fd7e14' : '#198754');
          html += '<tr>'
            + '<td>' + (r.date || '') + '</td>'
            + '<td>' + (r.staffName || '—') + '</td>'
            + '<td>' + typeText + '</td>'
            + '<td style="font-family:Consolas,monospace;">' + (hhmm(r.checkInTime) || '—') + '</td>'
            + '<td style="font-family:Consolas,monospace;">' + (hhmm(r.checkOutTime) || '—') + '</td>'
            + '<td>' + (r.workHours ? Number(r.workHours) + 'h' : '—') + '</td>'
            + '<td><span style="color:' + typeColor + ';font-weight:600;">' + typeText + '</span></td>'
            + '<td>' + (r.remark || '—') + '</td>'
            + '<td style="color:var(--text-light,#999);font-size:0.8rem;">' + (r.approveStatus === 'approved' ? '已核准' : (r.approveStatus || '—')) + '</td>'
            + '</tr>';
        });
        tb.innerHTML = html;
      }

      // ============================================================
      // 手工登记考勤弹窗（含"团长特批"超限事假通道）
      // ============================================================
      var ATT_ENTRY_TYPES = [
        ['full','全天班'],['night','夜班'],['double','双班'],['half','半天班'],['rest','公休'],
        ['late','迟到(30分钟内)'],['late_over','迟到超30分钟'],['absent','旷工'],
        ['PL','事假'],['SL','病假'],['BL','丧假'],['ML','婚假'],['AL','年假'],
        ['leave','请假'],['outing','外出'],['study','学习'],['business','出差'],['injury','工伤'],['rainout','雨休']
      ];
      var __attEntryModal = null;
      function buildAttEntryModal(){
        if (__attEntryModal) return __attEntryModal;
        var root = document.createElement('div');
        root.id = 'attEntryModalRoot';
        root.style.cssText = 'display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.45);align-items:flex-start;justify-content:center;padding-top:8vh;';
        var typeOpts = ATT_ENTRY_TYPES.map(function(t){ return '<option value="'+t[0]+'">'+t[1]+'</option>'; }).join('');
        root.innerHTML =
          '<div style="background:#fff;border-radius:12px;width:480px;max-width:92vw;max-height:84vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,0.25);">'
          + '<div style="padding:16px 20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">'
          +   '<h3 style="margin:0;font-size:1.05rem;">✍️ 手工登记考勤</h3>'
          +   '<button type="button" id="attEntryClose" style="border:none;background:none;font-size:1.3rem;cursor:pointer;color:#999;line-height:1;">×</button>'
          + '</div>'
          + '<div style="padding:20px;">'
          +   '<div style="margin-bottom:12px;"><label style="display:block;font-size:0.85rem;margin-bottom:4px;color:#555;">人员 <span style="color:#dc3545;">*</span></label>'
          +     '<select id="attEntryStaff" class="form-control" style="width:100%;padding:8px 10px;border:1.5px solid #e0e0e0;border-radius:8px;"></select></div>'
          +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">'
          +     '<div><label style="display:block;font-size:0.85rem;margin-bottom:4px;color:#555;">日期 <span style="color:#dc3545;">*</span></label>'
          +       '<input type="date" id="attEntryDate" class="form-control" style="width:100%;padding:8px 10px;border:1.5px solid #e0e0e0;border-radius:8px;"></div>'
          +     '<div><label style="display:block;font-size:0.85rem;margin-bottom:4px;color:#555;">类型 <span style="color:#dc3545;">*</span></label>'
          +       '<select id="attEntryType" class="form-control" style="width:100%;padding:8px 10px;border:1.5px solid #e0e0e0;border-radius:8px;">'+typeOpts+'</select></div>'
          +   '</div>'
          +   '<div style="margin-bottom:12px;"><label style="display:block;font-size:0.85rem;margin-bottom:4px;color:#555;">备注</label>'
          +     '<input type="text" id="attEntryRemark" maxlength="100" placeholder="选填，如：迟到原因/特批说明" class="form-control" style="width:100%;padding:8px 10px;border:1.5px solid #e0e0e0;border-radius:8px;"></div>'
          +   '<div id="attEntrySpecialRow" style="display:none;margin-bottom:12px;padding:10px 12px;border-radius:8px;background:rgba(220,53,69,0.07);border:1px solid rgba(220,53,69,0.25);">'
          +     '<label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:0.85rem;color:#a02c22;">'
          +       '<input type="checkbox" id="attEntrySpecial" style="margin-top:3px;">'
          +       '<span><strong>团长特批（超限事假）</strong><br><span style="color:#888;font-size:0.8rem;">该员工本月事假已达/将超 2 次（2 天）上限，仅在取得团长批准后勾选此项放行</span></span>'
          +     '</label></div>'
          +   '<div id="attEntryErr" style="display:none;margin-bottom:12px;padding:8px 12px;border-radius:8px;background:rgba(220,53,69,0.08);border:1px solid rgba(220,53,69,0.3);color:#a02c22;font-size:0.83rem;"></div>'
          +   '<div style="display:flex;justify-content:flex-end;gap:10px;">'
          +     '<button type="button" id="attEntryCancel" class="btn btn-secondary btn-sm">取消</button>'
          +     '<button type="button" id="attEntrySave" class="btn btn-primary btn-sm">💾 保存登记</button>'
          +   '</div>'
          + '</div></div>';
        document.body.appendChild(root);
        __attEntryModal = root;
        // 防 DBF/SuperPatch 劫持：所有按钮打标
        root.querySelectorAll('button').forEach(function(b){
          b.__superPatchBound = 1; b.__ts3Done = 1; b.__bindDone = 1; b.__deadBtnChecked = 1;
          b.setAttribute('data-att-real','1');
        });
        root.querySelector('#attEntryClose').addEventListener('click', closeAttEntryModal);
        root.querySelector('#attEntryCancel').addEventListener('click', closeAttEntryModal);
        root.addEventListener('click', function(e){ if (e.target === root) closeAttEntryModal(); });
        root.querySelector('#attEntryType').addEventListener('change', function(){
          document.getElementById('attEntrySpecialRow').style.display = (this.value === 'PL') ? 'block' : 'none';
        });
        root.querySelector('#attEntrySave').addEventListener('click', submitAttEntry);
        return root;
      }
      function openAttEntryModal(){
        var root = buildAttEntryModal();
        // 人员下拉与花名册同步
        var sel = root.querySelector('#attEntryStaff');
        sel.innerHTML = '';
        (window.__PF_ROWS__ || []).forEach(function(p){
          var op = document.createElement('option');
          op.value = p.id; op.textContent = (p.staffNo ? p.staffNo + ' ' : '') + p.name;
          op.setAttribute('data-name', p.name || '');
          sel.appendChild(op);
        });
        var stfSel = document.getElementById('attendanceStaff');
        if (stfSel && stfSel.value) sel.value = stfSel.value;
        // 默认日期=今天（跟随当前查看月份时取该月当天或1号）
        var d = new Date();
        if (viewYear !== d.getFullYear() || viewMonth !== d.getMonth()) {
          d = new Date(viewYear, viewMonth, Math.min(new Date(viewYear, viewMonth+1, 0).getDate(), d.getDate()));
        }
        root.querySelector('#attEntryDate').value = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        root.querySelector('#attEntryType').value = 'full';
        root.querySelector('#attEntryRemark').value = '';
        root.querySelector('#attEntrySpecial').checked = false;
        root.querySelector('#attEntrySpecialRow').style.display = 'none';
        root.querySelector('#attEntryErr').style.display = 'none';
        root.style.display = 'flex';
      }
      function closeAttEntryModal(){ if (__attEntryModal) __attEntryModal.style.display = 'none'; }
      async function submitAttEntry(){
        var API = window.QAXQJT_API;
        if (!API) { toast('❌ API 未就绪','error'); return; }
        var staffSel = document.getElementById('attEntryStaff');
        var staffId = staffSel.value;
        var staffName = staffSel.selectedOptions && staffSel.selectedOptions[0] ? staffSel.selectedOptions[0].getAttribute('data-name') : '';
        var date = document.getElementById('attEntryDate').value;
        var type = document.getElementById('attEntryType').value;
        var remark = document.getElementById('attEntryRemark').value.trim();
        var overLimitApproved = document.getElementById('attEntrySpecial').checked;
        var errBox = document.getElementById('attEntryErr');
        function showErr(msg){ errBox.textContent = msg; errBox.style.display = 'block'; }
        errBox.style.display = 'none';
        if (!staffId) { showErr('请选择人员'); return; }
        if (!date) { showErr('请选择日期'); return; }
        var body = { staffId: staffId, staffName: staffName || '', date: date, month: date.substring(0,7), type: type, remark: remark };
        if (type === 'PL' && overLimitApproved) body.overLimitApproved = true;
        var btn = document.getElementById('attEntrySave');
        btn.disabled = true;
        try {
          await API.post((QAXQJT_PATHS.ATTENDANCE || '/v1/attendance'), { body: body, timeoutMs: 10000 });
          toast('✅ 考勤登记成功','success');
          closeAttEntryModal();
          await loadAttendance();
        } catch (e) {
          var msg = (e && (e.message || e.error)) || '登记失败';
          if (String(msg).indexOf('上限') >= 0 && !overLimitApproved) {
            showErr('⚠️ ' + msg + '。如确有特殊情况，请勾选下方"团长特批"后重新保存。');
            document.getElementById('attEntrySpecialRow').style.display = 'block';
          } else {
            showErr('❌ ' + msg);
          }
        } finally {
          btn.disabled = false;
        }
      }

      // ============================================================
      // 考勤预警（条例第二条：事假月限/迟到3次/旷工当月2天·全年3次解聘）
      // ============================================================
      function _attWarnCard(level, title, detail){
        var bg = level === 'red' ? 'rgba(220,53,69,0.08)' : (level === 'orange' ? 'rgba(253,126,20,0.08)' : 'rgba(255,193,7,0.10)');
        var bd = level === 'red' ? 'rgba(220,53,69,0.4)' : (level === 'orange' ? 'rgba(253,126,20,0.4)' : 'rgba(255,193,7,0.45)');
        var ic = level === 'red' ? '🚫' : (level === 'orange' ? '⚠️' : '🔔');
        return '<div style="padding:12px 14px;border-radius:8px;background:'+bg+';border:1px solid '+bd+';margin-bottom:8px;">'
          + '<div style="font-weight:700;font-size:0.9rem;color:'+(level==='red'?'#a02c22':'#8a4b00')+';">'+ic+' '+title+'</div>'
          + (detail ? '<div style="font-size:0.82rem;color:#666;margin-top:3px;line-height:1.6;">'+detail+'</div>' : '')
          + '</div>';
      }
      function _countByType(rows, types){
        var n = 0;
        rows.forEach(function(r){ if (types.indexOf(r.type) >= 0) n++; });
        return n;
      }

      // 全员视图：单人聚合卡（一人一张，卡内列出全部触发项，可点击下钻）
      function _attStaffWarnCard(staffId, name, level, lines){
        var cfg = level === 'red'
          ? { bg:'rgba(220,53,69,0.08)', bd:'rgba(220,53,69,0.4)', tc:'#a02c22', ic:'🚫' }
          : level === 'orange'
          ? { bg:'rgba(253,126,20,0.08)', bd:'rgba(253,126,20,0.4)', tc:'#8a4b00', ic:'⚠️' }
          : { bg:'rgba(255,193,7,0.10)', bd:'rgba(255,193,7,0.45)', tc:'#7a5c00', ic:'🔔' };
        var lis = lines.map(function(t){ return '<li style="margin:2px 0;line-height:1.55;">' + t + '</li>'; }).join('');
        return '<div class="att-staff-warn-card" data-staff-id="' + (staffId||'') + '" data-staff-name="' + (name||'').replace(/"/g,'&quot;') + '"'
          + ' style="padding:11px 14px;border-radius:8px;background:' + cfg.bg + ';border:1px solid ' + cfg.bd + ';margin-bottom:8px;cursor:pointer;transition:box-shadow .15s;" '
          + 'onmouseenter="this.style.boxShadow=\'0 2px 8px rgba(0,0,0,0.12)\'" onmouseleave="this.style.boxShadow=\'none\'">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'
          +   '<div style="font-weight:700;font-size:0.9rem;color:' + cfg.tc + ';">' + cfg.ic + ' ' + name + '</div>'
          +   '<div style="font-size:0.75rem;color:#999;white-space:nowrap;">点击查看明细 ›</div>'
          + '</div>'
          + '<ul style="margin:5px 0 0 18px;padding:0;font-size:0.82rem;color:#555;list-style:disc;">' + lis + '</ul>'
          + '</div>';
      }
      // 全员视图：汇总头部（含"按严重程度/按部门分组"视图切换）
      function _attOverviewHead(stats){
        function chip(label, n, color){
          return '<div style="display:flex;flex-direction:column;align-items:center;min-width:78px;padding:6px 10px;border-radius:8px;background:rgba(0,0,0,0.03);">'
            + '<div style="font-size:1.15rem;font-weight:700;color:' + color + ';line-height:1.2;">' + n + '</div>'
            + '<div style="font-size:0.74rem;color:#888;margin-top:2px;">' + label + '</div></div>';
        }
        var mode = stats.mode || 'level';
        function segBtn(m, label){
          var on = mode === m;
          return '<span role="button" data-att-warn-mode="' + m + '" class="att-warn-mode-btn"'
            + ' style="display:inline-block;padding:5px 14px;font-size:0.8rem;border:1px solid ' + (on ? '#7a3e00' : '#d8c3a5') + ';border-radius:16px;cursor:pointer;user-select:none;'
            + 'background:' + (on ? '#7a3e00' : '#fff') + ';color:' + (on ? '#fff' : '#7a3e00') + ';font-weight:' + (on ? '600' : '400') + ';">' + label + '</span>';
        }
        return '<div style="padding:14px 16px;border-radius:10px;background:linear-gradient(90deg,#fff7ed,#fff);border:1px solid #f0d9b8;margin-bottom:12px;">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">'
          +   '<div style="font-weight:700;font-size:0.95rem;color:#7a3e00;">📊 ' + stats.monthLabel + ' 全员考勤预警总览</div>'
          +   '<div style="display:flex;gap:6px;align-items:center;">'
          +     '<span role="button" data-att-warn-export="1" class="att-warn-export-btn" title="导出当前全员预警名单为带格式的 Excel（.xlsx，按部门分组合并、红/黄预警底色）"'
          +     ' style="display:inline-block;padding:5px 12px;font-size:0.8rem;border:1px solid #198754;border-radius:16px;cursor:pointer;user-select:none;background:#198754;color:#fff;">📊 导出 Excel</span>'
          +     segBtn('level', '按严重程度') + segBtn('dept', '按部门分组') + '</div>'
          + '</div>'
          + '<div style="display:flex;flex-wrap:wrap;gap:10px;">'
          +   chip('在册人数', stats.totalRoster, '#333')
          +   chip('本月有记录', stats.peopleWithRecords, '#198754')
          +   chip('迟到/早退(人次)', stats.totLate, '#fd7e14')
          +   chip('事假(人次)', stats.totPL, '#fd7e14')
          +   chip('旷工(人次)', stats.totAbsent, '#dc3545')
          +   chip('解聘风险(人)', stats.redCount, '#dc3545')
          +   chip('需关注(人)', stats.orangeCount + stats.yellowCount, '#fd7e14')
          + '</div></div>';
      }

      // 全员视图：按严重程度分组列表（原逻辑）
      function _attWarnListByLevel(people, counts){
        var out = [];
        if (counts.red) {
          out.push('<div style="font-size:0.82rem;font-weight:700;color:#a02c22;margin:4px 0 6px;">🚫 解聘风险 / 严重违规（' + counts.red + '人）</div>');
          people.filter(function(p){ return p.level === 'red'; }).forEach(function(p){ out.push(_attStaffWarnCard(p.id, p.name, 'red', p.lines)); });
        }
        if (counts.orange) {
          out.push('<div style="font-size:0.82rem;font-weight:700;color:#8a4b00;margin:8px 0 6px;">⚠️ 临近解聘红线（' + counts.orange + '人）</div>');
          people.filter(function(p){ return p.level === 'orange'; }).forEach(function(p){ out.push(_attStaffWarnCard(p.id, p.name, 'orange', p.lines)); });
        }
        if (counts.yellow) {
          out.push('<div style="font-size:0.82rem;font-weight:700;color:#7a5c00;margin:8px 0 6px;">🔔 临近预警阈值（' + counts.yellow + '人）</div>');
          people.filter(function(p){ return p.level === 'yellow'; }).forEach(function(p){ out.push(_attStaffWarnCard(p.id, p.name, 'yellow', p.lines)); });
        }
        return out.join('');
      }

      // 全员视图：按部门分组列表
      function _attWarnListByDept(people, rosterById){
        var rank = { red: 0, orange: 1, yellow: 2 };
        var DEPT_ORDER = ['演员队','乐队','舞美队','行政','未分组','未在册/已离职'];
        var deptColor = function(d){
          if (/乐队/.test(d)) return { tag: '#17a2b8', bg: 'rgba(23,162,184,0.10)' };
          if (/舞美/.test(d)) return { tag: '#7c3aed', bg: 'rgba(124,58,237,0.10)' };
          if (/行政/.test(d)) return { tag: '#0d6efd', bg: 'rgba(13,110,253,0.09)' };
          if (/未在册|离职|未分组/.test(d)) return { tag: '#888', bg: 'rgba(0,0,0,0.04)' };
          return { tag: '#8a1a1a', bg: 'rgba(139,0,0,0.08)' };
        };
        function badge(n, color, label){
          if (!n) return '';
          return '<span style="display:inline-block;min-width:18px;text-align:center;padding:1px 7px;border-radius:10px;font-size:0.72rem;font-weight:700;color:#fff;background:' + color + ';margin-left:4px;">' + (label ? label + ' ' : '') + n + '</span>';
        }
        // 花名册各部门在册总数
        var deptTotal = {};
        Object.keys(rosterById).forEach(function(id){
          var d = rosterById[id].dept;
          deptTotal[d] = (deptTotal[d] || 0) + 1;
        });
        // 预警人员按部门归组
        var byDept = {};
        people.forEach(function(p){
          var d = p.dept || '未分组';
          (byDept[d] = byDept[d] || []).push(p);
        });
        var depts = Object.keys(byDept);
        // 排序：有红色的部门在前，其次固定部门顺序
        depts.sort(function(a, b){
          var wa = byDept[a].some(function(p){ return p.level === 'red'; }) ? 0 : 1;
          var wb = byDept[b].some(function(p){ return p.level === 'red'; }) ? 0 : 1;
          if (wa !== wb) return wa - wb;
          var ia = DEPT_ORDER.indexOf(a), ib = DEPT_ORDER.indexOf(b);
          if (ia < 0) ia = 99; if (ib < 0) ib = 99;
          if (ia !== ib) return ia - ib;
          return String(a).localeCompare(String(b), 'zh-Hans-CN');
        });
        var out = [];
        depts.forEach(function(d, idx){
          var list = byDept[d];
          list.sort(function(a, b){
            if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level];
            return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
          });
          var rc = list.filter(function(p){ return p.level === 'red'; }).length;
          var oc = list.filter(function(p){ return p.level === 'orange'; }).length;
          var yc = list.filter(function(p){ return p.level === 'yellow'; }).length;
          var c = deptColor(d);
          var total = deptTotal[d] || 0;
          var collapsed = rc ? false : true; // 有红色的默认展开，其余折叠
          out.push(
            '<div class="att-dept-sec" style="border:1px solid #eee;border-radius:10px;margin-bottom:10px;overflow:hidden;">'
            + '<div class="att-dept-head" data-dept-idx="' + idx + '" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:' + c.bg + ';cursor:pointer;user-select:none;">'
            +   '<span class="att-dept-arrow" style="display:inline-block;width:12px;color:#666;transition:transform .15s;' + (collapsed ? '' : 'transform:rotate(90deg);') + '">▶</span>'
            +   '<span style="font-weight:700;font-size:0.9rem;color:' + c.tag + ';">' + d + '</span>'
            +   '<span style="font-size:0.76rem;color:#999;">在册 ' + total + ' 人 · 预警 ' + list.length + ' 人</span>'
            +   '<span style="margin-left:auto;">' + badge(rc, '#dc3545', '解聘') + badge(oc, '#fd7e14', '临线') + badge(yc, '#d9a300', '提醒') + '</span>'
            + '</div>'
            + '<div class="att-dept-body" style="padding:10px 12px;' + (collapsed ? 'display:none;' : '') + '">'
            +   list.map(function(p){ return _attStaffWarnCard(p.id, p.name, p.level, p.lines); }).join('')
            + '</div></div>'
          );
        });
        // 无预警部门绿色提示
        var cleanDepts = DEPT_ORDER.filter(function(d){ return deptTotal[d] && !byDept[d]; });
        if (cleanDepts.length) {
          out.push('<div style="padding:10px 14px;border-radius:8px;background:rgba(40,167,69,0.06);border:1px solid rgba(40,167,69,0.2);font-size:0.82rem;color:#1e7a34;line-height:1.8;">'
            + '✅ 考勤正常部门：' + cleanDepts.map(function(d){ return d + '（' + deptTotal[d] + '人）'; }).join('、') + '</div>');
        }
        return out.join('');
      }
      async function renderAttWarnings(){
        var panel = document.getElementById('attWarnPanel');
        if (!panel) return;
        var stfSel = document.getElementById('attendanceStaff');
        var staffId = stfSel ? stfSel.value : '';
        var staffName = (stfSel && stfSel.selectedOptions && stfSel.selectedOptions[0]) ? stfSel.selectedOptions[0].textContent : '';
        var cards = [];
        var lateN = _countByType(attMonthCache, ['late','late_over']);
        var plN = _countByType(attMonthCache, ['PL']);
        var absentMonthN = _countByType(attMonthCache, ['absent']);

        if (staffId) {
          // —— 单人视图：当月细项预警 ——
          if (absentMonthN >= 2) {
            cards.push(_attWarnCard('red', '已达解聘标准：当月累计旷工 ' + absentMonthN + ' 天',
              '《员工管理条例》第二条：当月累计旷工2天，剧团有权予以解聘，已安排的演出补贴不予发放。请立即核实并启动处理流程。'));
          } else if (absentMonthN === 1) {
            cards.push(_attWarnCard('orange', '当月已有旷工 ' + absentMonthN + ' 天',
              '旷工1天扣两日工资并通报批评；当月累计达2天将触发解聘条款，请重点关注。'));
          }
          if (lateN >= 3) {
            cards.push(_attWarnCard('red', '当月迟到/早退 ' + lateN + ' 次：已取消全勤奖',
              '迟到30分钟内每次罚款20元、超30分钟按旷工半天扣半日工资；当月迟到累计满3次取消全勤奖。'));
          } else if (lateN === 2) {
            cards.push(_attWarnCard('yellow', '当月迟到/早退已 ' + lateN + ' 次',
              '再出现1次迟到（满3次）将取消当月全勤奖。'));
          }
          if (plN >= 2) {
            cards.push(_attWarnCard('red', '本月事假已用 ' + plN + ' 次/2 次（上限）',
              '每月事假不超过2次且累计不超过2天；再次事假必须报团长特批（登记时勾选"团长特批"）。'));
          } else if (plN === 1) {
            cards.push(_attWarnCard('yellow', '本月事假已用 1 次',
              '本月事假剩余额度：1 次（且累计不超过2天）。'));
          }
          // —— 全年旷工累计（一次拉全该员工考勤，前端按年统计） ——
          try {
            var API = window.QAXQJT_API;
            if (API) {
              var year = new Date().getFullYear();
              var res = await API.get((QAXQJT_PATHS.ATTENDANCE || '/v1/attendance'), { query: { staffId: staffId, page: 1, pageSize: 500 }, showErrorToast: false, timeoutMs: 8000, fallbackRead: function(){ return null; } });
              var all = Array.isArray(res) ? res : (res && res.items) || [];
              var yearAbsent = all.filter(function(r){ return r.type === 'absent' && String(r.date || '').indexOf(String(year)) === 0; }).length;
              if (yearAbsent >= 3) {
                cards.push(_attWarnCard('red', '已达解聘标准：' + year + ' 年累计旷工 ' + yearAbsent + ' 次',
                  '《员工管理条例》第二条：全年累计旷工3次以上，剧团有权予以解聘。'));
              } else if (yearAbsent >= 1) {
                cards.push(_attWarnCard('orange', year + ' 年累计旷工 ' + yearAbsent + ' 次',
                  '全年累计达3次将触发解聘条款。'));
              }
            }
          } catch (_) {}
          if (!cards.length) {
            cards.push('<div style="padding:10px 14px;border-radius:8px;background:rgba(40,167,69,0.07);border:1px solid rgba(40,167,69,0.25);font-size:0.85rem;color:#1e7a34;">✅ ' + staffName + ' 本月暂无考勤预警（事假0/2、迟到0、旷工0）</div>');
          }
        } else {
          // —— 全员视图：全年旷工 + 当月记录按人聚合，一人一卡，按严重度排序 ——
          var API = window.QAXQJT_API;
          var year = new Date().getFullYear();
          // 全年旷工记录（只拉 absent 类型、不限月份，数据量小）
          var yearAbsentMap = {};
          try {
            if (API) {
              var resY = await API.get((QAXQJT_PATHS.ATTENDANCE || '/v1/attendance'), { query: { type: 'absent', page: 1, pageSize: 500 }, showErrorToast: false, timeoutMs: 8000, fallbackRead: function(){ return null; } });
              var allY = Array.isArray(resY) ? resY : (resY && resY.items) || [];
              allY.forEach(function(r){
                if (String(r.date || '').indexOf(String(year)) === 0) {
                  var kk = r.staffId || r.staffName || '?';
                  var cur = yearAbsentMap[kk] || { count: 0, id: r.staffId || '', name: r.staffName || '' };
                  cur.count++;
                  if (!cur.name && r.staffName) cur.name = r.staffName;
                  if (!cur.id && r.staffId) cur.id = r.staffId;
                  yearAbsentMap[kk] = cur;
                }
              });
            }
          } catch (_) {}

          // 当月按人聚合
          var byStaff = {};
          var peopleKeys = {};
          var totLate = 0, totPL = 0, totAbsent = 0;
          attMonthCache.forEach(function(r){
            var k = r.staffId || r.staffName || '?';
            peopleKeys[k] = 1;
            var m = byStaff[k] || { id: r.staffId || '', name: r.staffName || '未知', absent: 0, late: 0, pl: 0 };
            if (r.type === 'absent') { m.absent++; totAbsent++; }
            if (r.type === 'late' || r.type === 'late_over') { m.late++; totLate++; }
            if (r.type === 'PL') { m.pl++; totPL++; }
            byStaff[k] = m;
          });

          // 花名册 id → {name, dept, staffNo}，用于部门归属（employmentType 为空归"未分组"）
          var rosterById = {};
          (window.__PF_ROWS__ || []).forEach(function(p){
            rosterById[p.id] = { name: p.name || '', dept: (p.employmentType || '').trim() || '未分组', staffNo: p.staffNo || ('PF'+String(p.id||'').slice(0,6)) };
          });

          // 计算每人的触发项与最高级别（合并全年旷工 key）
          var people = [];
          var mergeKeys = {};
          Object.keys(byStaff).forEach(function(k){ mergeKeys[k] = 1; });
          Object.keys(yearAbsentMap).forEach(function(k){ mergeKeys[k] = 1; });
          Object.keys(mergeKeys).forEach(function(k){
            var yInfo = yearAbsentMap[k] || null;
            var m = byStaff[k] || { id: (yInfo && yInfo.id) || '', name: (yInfo && yInfo.name) || (k === '?' ? '未知' : k), absent: 0, late: 0, pl: 0 };
            var yAbsent = yInfo ? yInfo.count : 0;
            var lines = [];
            var level = null;
            // 红色：解聘/取消全勤
            if (m.absent >= 2) { level = 'red'; lines.push('<strong style="color:#a02c22;">当月旷工 ' + m.absent + ' 天，已达解聘标准</strong>（当月累计2天可解聘，演出补贴不发）'); }
            if (yAbsent >= 3) { level = 'red'; lines.push('<strong style="color:#a02c22;">' + year + ' 年累计旷工 ' + yAbsent + ' 次，已达解聘标准</strong>（全年累计3次可解聘）'); }
            if (m.late >= 3) { level = level || 'red'; lines.push('当月迟到/早退 ' + m.late + ' 次，<strong style="color:#a02c22;">已取消全勤奖</strong>（每次罚款20元）'); }
            if (m.pl >= 2) { level = level || 'red'; lines.push('本月事假 ' + m.pl + ' 次，<strong style="color:#a02c22;">已达2次上限</strong>，再请须团长特批'); }
            // 橙色：临近解聘
            if (m.absent === 1) { if (!level) level = 'orange'; lines.push('当月旷工 1 天（扣两日工资并通报；再 1 天触发解聘）'); }
            if (yAbsent >= 1 && yAbsent < 3) { if (!level) level = 'orange'; lines.push(year + ' 年累计旷工 ' + yAbsent + ' 次（全年达3次触发解聘）'); }
            // 黄色：临近阈值
            if (m.late === 2) { if (!level) level = 'yellow'; lines.push('当月迟到/早退 2 次（再 1 次取消全勤奖）'); }
            if (m.pl === 1) { if (!level) level = 'yellow'; lines.push('本月事假 1 次（每月上限2次/2天）'); }
            if (level) people.push({ id: m.id, name: m.name, staffNo: (m.id && rosterById[m.id]) ? rosterById[m.id].staffNo : (m.staffNo || ''), level: level, lines: lines, absent: m.absent, late: m.late, pl: m.pl, yAbsent: yAbsent, dept: (m.id && rosterById[m.id]) ? rosterById[m.id].dept : '未在册/已离职' });
          });

          // 排序：red > orange > yellow；同级按 当月旷工→全年旷工→迟到→事假→姓名
          var rank = { red: 0, orange: 1, yellow: 2 };
          people.sort(function(a, b){
            if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level];
            if (b.absent !== a.absent) return b.absent - a.absent;
            if (b.yAbsent !== a.yAbsent) return b.yAbsent - a.yAbsent;
            if (b.late !== a.late) return b.late - a.late;
            if (b.pl !== a.pl) return b.pl - a.pl;
            return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
          });

          var redCount = people.filter(function(p){ return p.level === 'red'; }).length;
          var orangeCount = people.filter(function(p){ return p.level === 'orange'; }).length;
          var yellowCount = people.filter(function(p){ return p.level === 'yellow'; }).length;
          var monthLabel = viewYear + '年' + (viewMonth + 1) + '月';

          var counts = { red: redCount, orange: orangeCount, yellow: yellowCount };
          if (window.__attWarnMode !== 'dept') window.__attWarnMode = 'level';
          var headStats = {
            monthLabel: monthLabel,
            totalRoster: (window.__PF_ROWS__ || []).length,
            peopleWithRecords: Object.keys(peopleKeys).length,
            totLate: totLate, totPL: totPL, totAbsent: totAbsent,
            redCount: redCount, orangeCount: orangeCount, yellowCount: yellowCount
          };
          // 缓存供视图切换/折叠时免请求重渲染
          window.__attWarnData = { people: people, rosterById: rosterById, counts: counts, head: headStats };

          cards.push(_attOverviewHead(Object.assign({}, headStats, { mode: window.__attWarnMode })));

          if (people.length) {
            cards.push(window.__attWarnMode === 'dept'
              ? _attWarnListByDept(people, rosterById)
              : _attWarnListByLevel(people, counts));
          } else {
            cards.push('<div style="padding:12px 14px;border-radius:8px;background:rgba(40,167,69,0.07);border:1px solid rgba(40,167,69,0.25);font-size:0.88rem;color:#1e7a34;">✅ 全员考勤正常：本月无人触发迟到/事假/旷工预警，全年无旷工记录</div>');
          }
        }
        panel.innerHTML = cards.join('');
        panel.style.display = 'block';
        bindAttWarnDrill();
      }

      // 全员视图：切换"按严重程度/按部门分组"（用缓存数据免请求重绘）
      function rerenderAttWarnFromCache(){
        var panel = document.getElementById('attWarnPanel');
        var d = window.__attWarnData;
        if (!panel || !d) return;
        var html = _attOverviewHead(Object.assign({}, d.head, { mode: window.__attWarnMode }));
        if (d.people.length) {
          html += window.__attWarnMode === 'dept'
            ? _attWarnListByDept(d.people, d.rosterById)
            : _attWarnListByLevel(d.people, d.counts);
        } else {
          html += '<div style="padding:12px 14px;border-radius:8px;background:rgba(40,167,69,0.07);border:1px solid rgba(40,167,69,0.25);font-size:0.88rem;color:#1e7a34;">✅ 全员考勤正常：本月无人触发迟到/事假/旷工预警，全年无旷工记录</div>';
        }
        panel.innerHTML = html;
        panel.style.display = 'block';
      }

      // 全员视图：导出预警名单（按部门分组 CSV）
      function exportAttWarnCsv(){
        var d = window.__attWarnData;
        if (!d) { toast('⚠️ 预警数据尚未加载，请稍后再试','warning'); return; }
        var people = d.people || [];
        if (!people.length) { toast('✅ 本月全员考勤正常，暂无预警名单可导出','info', 3000); return; }
        var DEPT_ORDER = ['演员队','乐队','舞美队','行政','未分组','未在册/已离职'];
        var levelLabel = { red: '解聘风险/严重违规', orange: '临近解聘红线', yellow: '临近预警阈值' };
        var rank = { red: 0, orange: 1, yellow: 2 };
        var deptTotal = {};
        Object.keys(d.rosterById).forEach(function(id){
          var dep = d.rosterById[id].dept;
          deptTotal[dep] = (deptTotal[dep] || 0) + 1;
        });
        var byDept = {};
        people.forEach(function(p){ (byDept[p.dept || '未分组'] = byDept[p.dept || '未分组'] || []).push(p); });
        var depts = Object.keys(byDept).sort(function(a, b){
          var wa = byDept[a].some(function(p){ return p.level === 'red'; }) ? 0 : 1;
          var wb = byDept[b].some(function(p){ return p.level === 'red'; }) ? 0 : 1;
          if (wa !== wb) return wa - wb;
          var ia = DEPT_ORDER.indexOf(a), ib = DEPT_ORDER.indexOf(b);
          if (ia < 0) ia = 99; if (ib < 0) ib = 99;
          return ia !== ib ? ia - ib : String(a).localeCompare(String(b), 'zh-Hans-CN');
        });
        var h = d.head;
        var now = new Date();
        var pad = function(n){ return String(n).padStart(2, '0'); };
        var nowStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
        var out = [];
        out.push(['秦安县秦剧团 考勤预警名单（按部门分组）']);
        out.push(['统计月份', h.monthLabel, '导出时间', nowStr]);
        out.push(['概览', '在册人数 ' + h.totalRoster + '；本月有记录 ' + h.peopleWithRecords + '；迟到/早退 ' + h.totLate + ' 人次；事假 ' + h.totPL + ' 人次；旷工 ' + h.totAbsent + ' 人次；解聘风险 ' + h.redCount + ' 人；需关注 ' + (h.orangeCount + h.yellowCount) + ' 人']);
        out.push(['依据', '《员工管理条例》第二条：迟到30分钟内罚款20元/次；超30分钟按旷工半天；事假每月≤2次且≤2天（团长特批除外）；当月旷工2天或全年3次可解聘']);
        out.push([]);
        out.push(['部门','工号','姓名','预警级别','当月旷工(天)','全年旷工(次)','迟到/早退(次)','事假(次)','预警事由']);
        var nExported = 0;
        depts.forEach(function(dep){
          var list = byDept[dep].slice().sort(function(a, b){
            if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level];
            return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
          });
          list.forEach(function(p){
            var reason = (p.lines || []).map(function(s){ return String(s).replace(/<[^>]+>/g, ''); }).join('；');
            out.push([dep, p.staffNo || '', p.name || '', levelLabel[p.level] || p.level, p.absent || 0, p.yAbsent || 0, p.late || 0, p.pl || 0, reason]);
            nExported++;
          });
          var rc = list.filter(function(p){ return p.level === 'red'; }).length;
          var oc = list.filter(function(p){ return p.level === 'orange'; }).length;
          var yc = list.filter(function(p){ return p.level === 'yellow'; }).length;
          out.push(['【' + dep + ' 小计】', '在册 ' + (deptTotal[dep] || 0) + ' 人', '预警 ' + list.length + ' 人（解聘 ' + rc + ' / 临线 ' + oc + ' / 提醒 ' + yc + '）']);
        });
        var cleanDepts = DEPT_ORDER.filter(function(dep){ return deptTotal[dep] && !byDept[dep]; });
        if (cleanDepts.length) {
          out.push([]);
          out.push(['考勤正常部门', cleanDepts.map(function(dep){ return dep + '（' + deptTotal[dep] + '人）'; }).join('、')]);
        }
        var mm = viewYear + pad(viewMonth + 1);
        var fname = '考勤预警名单_按部门_' + mm + '.csv';
        if (typeof downloadCsv === 'function') {
          downloadCsv(fname, out);
        } else {
          var bom = '﻿';
          var csv = bom + out.map(function(r){ return r.map(function(c){
            c = (c === null || c === undefined) ? '' : String(c);
            return /[",\r\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
          }).join(','); }).join('\r\n');
          var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = fname; document.body.appendChild(a); a.click();
          setTimeout(function(){ try { document.body.removeChild(a); } catch(_){} try { URL.revokeObjectURL(url); } catch(_){} }, 200);
        }
        toast('📥 已导出 ' + nExported + ' 名预警人员（' + depts.length + ' 个部门）到 ' + fname, 'success', 4000);
      }

      // 全员视图：导出带格式 Excel（xlsx-js-style：部门分组合并单元格 + 红/黄预警底色）
      function exportAttWarnXlsx(){
        if (typeof XLSX === 'undefined' || !XLSX.utils || typeof XLSX.write !== 'function') {
          toast('⚠️ Excel 组件未加载，已改用 CSV 导出','warning', 3500);
          exportAttWarnCsv();
          return;
        }
        var d = window.__attWarnData;
        if (!d) { toast('⚠️ 预警数据尚未加载，请稍后再试','warning'); return; }
        var people = d.people || [];
        if (!people.length) { toast('✅ 本月全员考勤正常，暂无预警名单可导出','info', 3000); return; }
        var DEPT_ORDER = ['演员队','乐队','舞美队','行政','未分组','未在册/已离职'];
        var levelLabel = { red: '解聘风险/严重违规', orange: '临近解聘红线', yellow: '临近预警阈值' };
        var rank = { red: 0, orange: 1, yellow: 2 };
        var deptTotal = {};
        Object.keys(d.rosterById).forEach(function(id){
          var dep = d.rosterById[id].dept;
          deptTotal[dep] = (deptTotal[dep] || 0) + 1;
        });
        var byDept = {};
        people.forEach(function(p){ (byDept[p.dept || '未分组'] = byDept[p.dept || '未分组'] || []).push(p); });
        var depts = Object.keys(byDept).sort(function(a, b){
          var wa = byDept[a].some(function(p){ return p.level === 'red'; }) ? 0 : 1;
          var wb_ = byDept[b].some(function(p){ return p.level === 'red'; }) ? 0 : 1;
          if (wa !== wb_) return wa - wb_;
          var ia = DEPT_ORDER.indexOf(a), ib = DEPT_ORDER.indexOf(b);
          if (ia < 0) ia = 99; if (ib < 0) ib = 99;
          return ia !== ib ? ia - ib : String(a).localeCompare(String(b), 'zh-Hans-CN');
        });

        // —— 样式常量（xlsx-js-style） ——
        var thin = { top:{style:'thin',color:{rgb:'FFBFBFBF'}}, bottom:{style:'thin',color:{rgb:'FFBFBFBF'}}, left:{style:'thin',color:{rgb:'FFBFBFBF'}}, right:{style:'thin',color:{rgb:'FFBFBFBF'}} };
        var S_TITLE = { font:{bold:true,sz:15,color:{rgb:'FFFFFFFF'}}, fill:{fgColor:{rgb:'FF7A3E00'}}, alignment:{horizontal:'center',vertical:'center'}, border:thin };
        var S_LABEL = { font:{bold:true,sz:10,color:{rgb:'FF7A3E00'}}, fill:{fgColor:{rgb:'FFF3E9DA'}}, alignment:{horizontal:'center',vertical:'center'}, border:thin };
        var S_META  = { font:{sz:10,color:{rgb:'FF333333'}}, alignment:{horizontal:'left',vertical:'center',wrapText:true}, border:thin };
        var S_HEAD  = { font:{bold:true,sz:10,color:{rgb:'FFFFFFFF'}}, fill:{fgColor:{rgb:'FF8B1A1A'}}, alignment:{horizontal:'center',vertical:'center',wrapText:true}, border:thin };
        var LV = {
          red:    { cell:{ font:{sz:10,color:{rgb:'FF9C0006'}}, fill:{fgColor:{rgb:'FFFFC7CE'}}, alignment:{vertical:'center',wrapText:true}, border:thin },
                    bold:{ font:{bold:true,sz:10,color:{rgb:'FF9C0006'}}, fill:{fgColor:{rgb:'FFFFC7CE'}}, alignment:{horizontal:'center',vertical:'center',wrapText:true}, border:thin } },
          orange: { cell:{ font:{sz:10,color:{rgb:'FF8A4B00'}}, fill:{fgColor:{rgb:'FFFCE4D6'}}, alignment:{vertical:'center',wrapText:true}, border:thin },
                    bold:{ font:{bold:true,sz:10,color:{rgb:'FF8A4B00'}}, fill:{fgColor:{rgb:'FFFCE4D6'}}, alignment:{horizontal:'center',vertical:'center',wrapText:true}, border:thin } },
          yellow: { cell:{ font:{sz:10,color:{rgb:'FF7A5C00'}}, fill:{fgColor:{rgb:'FFFFF2CC'}}, alignment:{vertical:'center',wrapText:true}, border:thin },
                    bold:{ font:{bold:true,sz:10,color:{rgb:'FF7A5C00'}}, fill:{fgColor:{rgb:'FFFFF2CC'}}, alignment:{horizontal:'center',vertical:'center',wrapText:true}, border:thin } }
        };
        var S_CENTER = { font:{sz:10}, alignment:{horizontal:'center',vertical:'center'}, border:thin };
        var S_SUBTOT = { font:{bold:true,sz:10,color:{rgb:'FF333333'}}, fill:{fgColor:{rgb:'FFEFEFEF'}}, alignment:{horizontal:'left',vertical:'center'}, border:thin };
        var S_CLEAN = { font:{bold:true,sz:10,color:{rgb:'FF1E7A34'}}, fill:{fgColor:{rgb:'FFE2EFDA'}}, alignment:{vertical:'center',wrapText:true}, border:thin };

        var pad = function(n){ return String(n).padStart(2, '0'); };
        var now = new Date();
        var nowStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
        var h = d.head;

        var aoa = [];
        var merges = [];
        var rowStyles = []; // 每行 9 列样式
        var NCOL = 9;
        function blankRow(){ var r = new Array(NCOL).fill(''); aoa.push(r); rowStyles.push(new Array(NCOL).fill(null)); return aoa.length - 1; }
        function styledRow(vals, styles){ aoa.push(vals); rowStyles.push(styles); return aoa.length - 1; }
        function mergeRange(sr, sc, er, ec){ merges.push({ s:{r:sr,c:sc}, e:{r:er,c:ec} }); }

        // 第1行：标题
        var r = styledRow(['秦安县秦剧团 考勤预警名单（按部门分组）','','','','','','','',''], new Array(NCOL).fill(S_TITLE));
        mergeRange(r, 0, r, 8);
        // 第2行：统计月份 / 导出时间
        r = styledRow(['统计月份', h.monthLabel, '', '导出时间', nowStr, '', '', '', ''],
                      [S_LABEL,S_META,S_META,S_LABEL,S_META,S_META,S_META,S_META,S_META]);
        mergeRange(r, 1, r, 2); mergeRange(r, 4, r, 8);
        // 第3行：概览
        var overview = '在册人数 ' + h.totalRoster + '；本月有记录 ' + h.peopleWithRecords + '；迟到/早退 ' + h.totLate + ' 人次；事假 ' + h.totPL + ' 人次；旷工 ' + h.totAbsent + ' 人次；解聘风险 ' + h.redCount + ' 人；需关注 ' + (h.orangeCount + h.yellowCount) + ' 人';
        r = styledRow(['概览', overview, '', '', '', '', '', '', ''],
                      [S_LABEL,S_META,S_META,S_META,S_META,S_META,S_META,S_META,S_META]);
        mergeRange(r, 1, r, 8);
        // 第4行：依据
        r = styledRow(['依据', '《员工管理条例》第二条：迟到30分钟内罚款20元/次；超30分钟按旷工半天；事假每月≤2次且≤2天（团长特批除外）；当月旷工2天或全年3次可解聘', '', '', '', '', '', '', ''],
                      [S_LABEL,S_META,S_META,S_META,S_META,S_META,S_META,S_META,S_META]);
        mergeRange(r, 1, r, 8);
        blankRow();
        // 表头
        r = styledRow(['部门','工号','姓名','预警级别','当月旷工(天)','全年旷工(次)','迟到/早退(次)','事假(次)','预警事由'], new Array(NCOL).fill(S_HEAD));

        var nExported = 0;
        depts.forEach(function(dep){
          var list = byDept[dep].slice().sort(function(a, b){
            if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level];
            return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
          });
          list.forEach(function(p){
            var reason = (p.lines || []).map(function(s){ return String(s).replace(/<[^>]+>/g, ''); }).join('；');
            var st = LV[p.level] || LV.yellow;
            var vals = [dep, p.staffNo || '', p.name || '', levelLabel[p.level] || p.level, p.absent || 0, p.yAbsent || 0, p.late || 0, p.pl || 0, reason];
            var stys = [st.cell, S_CENTER, st.cell, st.bold, S_CENTER, S_CENTER, S_CENTER, S_CENTER, st.cell];
            styledRow(vals, stys);
            nExported++;
          });
          var rc = list.filter(function(p){ return p.level === 'red'; }).length;
          var oc = list.filter(function(p){ return p.level === 'orange'; }).length;
          var yc = list.filter(function(p){ return p.level === 'yellow'; }).length;
          r = styledRow(['【' + dep + ' 小计】', '在册 ' + (deptTotal[dep] || 0) + ' 人', '', '预警 ' + list.length + ' 人', '解聘 ' + rc, '临线 ' + oc, '提醒 ' + yc, '', ''],
                        new Array(NCOL).fill(S_SUBTOT));
          mergeRange(r, 1, r, 2);
        });
        var cleanDepts = DEPT_ORDER.filter(function(dep){ return deptTotal[dep] && !byDept[dep]; });
        if (cleanDepts.length) {
          blankRow();
          r = styledRow(['考勤正常部门', cleanDepts.map(function(dep){ return dep + '（' + deptTotal[dep] + '人）'; }).join('、'), '', '', '', '', '', '', ''],
                        [S_CLEAN, S_CLEAN, S_CLEAN, S_CLEAN, S_CLEAN, S_CLEAN, S_CLEAN, S_CLEAN, S_CLEAN]);
          mergeRange(r, 1, r, 8);
        }

        // 生成工作表
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!merges'] = merges;
        ws['!cols'] = [{wch:12},{wch:12},{wch:10},{wch:18},{wch:12},{wch:12},{wch:12},{wch:10},{wch:72}];
        ws['!rows'] = [{hpt:30}];
        // 应用样式（aoa_to_sheet 后逐格赋值 s）
        var addrRE = /^[A-Z]+\d+$/;
        Object.keys(ws).forEach(function(addr){
          if (!addrRE.test(addr)) return;
          var col = XLSX.utils.decode_cell(addr); // {r,c}
          var st = rowStyles[col.r] && rowStyles[col.r][col.c];
          if (st) ws[addr].s = st;
        });
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '考勤预警名单');

        var mm = viewYear + pad(viewMonth + 1);
        var fname = '考勤预警名单_按部门_' + mm + '.xlsx';
        try {
          if (typeof XLSX.writeFile === 'function') {
            XLSX.writeFile(wb, fname, { cellStyles: true });
          } else {
            var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
            var blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = fname; document.body.appendChild(a); a.click();
            setTimeout(function(){ try { document.body.removeChild(a); } catch(_){} try { URL.revokeObjectURL(url); } catch(_){} }, 200);
          }
          toast('📊 已导出 Excel：' + nExported + ' 名预警人员（' + depts.length + ' 个部门）→ ' + fname, 'success', 4500);
        } catch (e) {
          toast('❌ Excel 生成失败，改用 CSV：' + (e && e.message ? e.message : '未知'), 'warning', 4000);
          exportAttWarnCsv();
        }
      }

      // 全员视图：点击人员预警卡 → 下钻到该人员单人视图
      function bindAttWarnDrill(){
        var panel = document.getElementById('attWarnPanel');
        if (!panel || panel.__attDrillBound) return;
        panel.__attDrillBound = 1;
        panel.addEventListener('click', function(e){
          // 0) 导出预警名单 Excel（按部门分组 .xlsx，库未加载时自动回退 CSV）
          if (e.target.closest('.att-warn-export-btn')) {
            try { exportAttWarnXlsx(); } catch (err) { toast('❌ 导出失败：' + (err && err.message ? err.message : '未知'), 'error'); }
            return;
          }
          // 1) 视图切换：按严重程度 / 按部门分组
          var modeEl = e.target.closest('.att-warn-mode-btn');
          if (modeEl) {
            var m = modeEl.getAttribute('data-att-warn-mode');
            if (m && m !== window.__attWarnMode) {
              window.__attWarnMode = m;
              rerenderAttWarnFromCache();
            }
            return;
          }
          // 2) 部门分区折叠/展开
          var deptHead = e.target.closest('.att-dept-head');
          if (deptHead) {
            var sec = deptHead.closest('.att-dept-sec');
            if (sec) {
              var body = sec.querySelector('.att-dept-body');
              var arrow = sec.querySelector('.att-dept-arrow');
              var hide = !body || body.style.display !== 'none';
              if (body) body.style.display = hide ? 'none' : 'block';
              if (arrow) arrow.style.transform = hide ? '' : 'rotate(90deg)';
            }
            return;
          }
          // 3) 人员预警卡 → 下钻单人视图
          var card = e.target.closest('.att-staff-warn-card');
          if (!card) return;
          var stfSel = document.getElementById('attendanceStaff');
          if (!stfSel) return;
          var id = card.getAttribute('data-staff-id') || '';
          var name = card.getAttribute('data-staff-name') || '';
          var matched = false;
          if (id) {
            for (var i = 0; i < stfSel.options.length; i++) {
              if (stfSel.options[i].value === id) { stfSel.selectedIndex = i; matched = true; break; }
            }
          }
          if (!matched && name) {
            for (var j = 0; j < stfSel.options.length; j++) {
              if (stfSel.options[j].textContent.indexOf(name) >= 0) { stfSel.selectedIndex = j; matched = true; break; }
            }
          }
          if (matched) {
            try { stfSel.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) { try { loadAttendance(); } catch (_) {} }
            try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
            toast('已切换到「' + name + '」的单人考勤预警', 'info', 2500);
          } else {
            toast('该人员不在当前花名册下拉中，可能已离职', 'warning', 3000);
          }
        });
      }

      function bindAttEntryUI(){
        var btn = document.getElementById('btnAttManualEntry');
        if (btn && !btn.__attEntryBound) {
          btn.__attEntryBound = 1;
          btn.__superPatchBound = 1; btn.__ts3Done = 1; btn.__bindDone = 1; btn.__deadBtnChecked = 1;
          btn.setAttribute('data-att-real','1');
          btn.addEventListener('click', function(e){ e.stopPropagation(); openAttEntryModal(); }, true);
        }
        var exp = document.getElementById('btnAttExport');
        if (exp && !exp.__attExpBound) {
          exp.__attExpBound = 1;
          exp.__superPatchBound = 1; exp.__ts3Done = 1; exp.__bindDone = 1; exp.__deadBtnChecked = 1;
          exp.setAttribute('data-att-real','1');
          exp.addEventListener('click', function(e){ e.stopPropagation(); exportAttendanceStats(); }, true);
        }
      }

      // 初始加载（花名册就绪后填充人员下拉）
      function initAttendanceV1(){
        var rows = window.__PF_ROWS__ || [];
        if (rows.length) fillAttendanceStaff(rows);
        bindAttEntryUI();
        loadAttendance();
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(initAttendanceV1, 1200); });
      else setTimeout(initAttendanceV1, 1200);
      // 花名册 load() 完成后也刷新一次下拉
      var _pfWait = setInterval(function(){
        if (window.__PF_ROWS__ && window.__PF_ROWS__.length) {
          fillAttendanceStaff(window.__PF_ROWS__);
          clearInterval(_pfWait);
        }
      }, 800);
      setTimeout(function(){ clearInterval(_pfWait); }, 15000);
      setTimeout(animateStaffBars, 600);

      // ============================================================
      // 工资条模块初始化（Wage UI Init）
      // ============================================================
      var WageUI = (function () {
        var W = window.QinApp && window.QinApp.Wage;
        var U = window.QinApp && window.QinApp.Utils;
        var $ = function (id) { return document.getElementById(id); };
        var fmt = function (cents) {
          if (U && U.fromCents) return '¥' + U.fromCents(cents);
          return '¥' + (cents / 100).toFixed(2);
        };
        var pad = function (s, n, c) { s = String(s); while (s.length < n) s = (c || '0') + s; return s; };

        // 工资模块人员来源：真实花名册（staff API 接线写入 window.__PF_ROWS__）。
        // 无在册人员时返回空数组（不再内置 GH001-032 演示人员，避免生成假工资条）。
        function getWageStaffList() {
          var rows = window.__PF_ROWS__ || [];
          var list = [];
          for (var i = 0; i < rows.length; i++) {
            var p = rows[i];
            if (!p || !p.name) continue;
            var hy = null;
            if (p.hireDate) { var t = new Date(p.hireDate); if (!isNaN(t.getTime())) hy = t.getFullYear(); }
            list.push({
              id: p.staffNo || ('PF' + (p.id || (i + 1))),
              performerId: p.id || '',
              name: p.name,
              // 新行当自动归并到既有工资矩阵档（矩阵结构不改），旧矩阵行当值原样保留
              roleCategory: (window.QaxRoles ? window.QaxRoles.wageKey(p.primaryRole || '') : (p.primaryRole || '')),
              level: p.rankGrade || '',
              // 本人协议天工资（元）：扫码入职/编辑录入；工资引擎优先按它核算，无则回退职级日工资矩阵
              dailyWage: (p.dailyRate != null && p.dailyRate !== '') ? Number(p.dailyRate) : 0,
              transportType: p.transportType || '',
              dept: p.employmentType || '',
              hireYear: hy,
              status: p.status === 'inactive' ? 'off' : 'on',
              index: list.length
            });
          }
          return list;
        }

        // ====== 后端数据适配器（工资条全链路接后端） ======
        function _backendToFrontend(w) {
          if (!w) return null;
          var isPersisted = !!w.id && w.batchId !== undefined;
          var breakdown = { leave: 0, absent: 0, late: 0, early: 0, lateTimes: 0, absentDays: 0 };
          try {
            var note = w.otherDeductionNote || '';
            if (note) { var p = JSON.parse(note); if (p && typeof p === 'object') {
              breakdown.leave = Number(p.leave) || 0; breakdown.absent = Number(p.absent) || 0;
              breakdown.late = Number(p.late) || 0; breakdown.early = Number(p.early) || 0;
              breakdown.lateTimes = Number(p.lateTimes) || 0; breakdown.absentDays = Number(p.absentDays) || 0;
            }}
          } catch (_) {}
          var toCents = function (v) { return Math.round((Number(v) || 0) * 100); };
          var attDays = Number(isPersisted ? w.attDays : w.attendanceDays) || 0;
          var baseSalary = toCents(isPersisted ? w.baseSalary : w.baseWage);
          var dailyRate = (attDays > 0 && baseSalary > 0) ? Math.round(baseSalary / attDays) / 100 : (Number(w.dailyRate) || 0);
          return {
            id: w.id || ('PREVIEW-' + (w.performerId || 'x') + '-' + Date.now()),
            staffId: w.performerId || '', staffName: isPersisted ? (w.name || '') : (w.performerName || ''),
            roleCategory: w.rankGrade || '', level: w.rankGrade || '', dailyWage: dailyRate,
            month: w.month || '', status: (w.payslipPublished || w.status === 'paid') ? 'paid' : 'unpaid',
            paidAt: w.payslipPublishedAt || w.paidAt || null, createdAt: w.createdAt || Date.now(),
            updatedAt: w.updatedAt || Date.now(), remark: w.remark || '',
            summary: { workDays: attDays, lateDays: breakdown.lateTimes, absentFullDays: breakdown.absentDays,
                       performBenxi: 0, performZhezi: 0, performXiaxiang: 0, performOther: 0 },
            items: {
              baseSalary: baseSalary, performanceAllowance: toCents(isPersisted ? w.performanceBonus : 0),
              perfectBonus: toCents(isPersisted ? w.fullBonus : w.fullAttendanceBonus),
              seniorityAllowance: 0, mealAllowance: toCents(w.mealAllowance || 0),
              trafficAllowance: toCents(w.transportAllowance || 0), extraBonus: 0,
              grossPay: toCents(w.grossPay), socialInsurance: toCents(isPersisted ? w.socialSecurity : 0),
              housingFund: toCents(isPersisted ? w.housingFund : 0),
              attendanceDeduction: toCents(breakdown.late + breakdown.early + breakdown.absent + breakdown.leave),
              extraDeduction: 0, totalDeduction: toCents(w.totalDeduction), netPay: toCents(w.netPay)
            },
            dailyDetails: []
          };
        }
        // 后端工资条列表缓存（减少重复请求）
        var __wageBackendCache = null;
        var __wageBackendCacheTs = 0;
        var __wageBackendCacheKey = '';
        async function _fetchWages(query) {
          var API = window.QAXQJT_API;
          if (!API || !API.get) return [];
          var cacheKey = JSON.stringify(query || {});
          if (__wageBackendCache && __wageBackendCacheKey === cacheKey && (Date.now() - __wageBackendCacheTs) < 8000) {
            return __wageBackendCache;
          }
          try {
            var res = await API.get((QAXQJT_PATHS.WAGES || '/v1/wages'), {
              query: Object.assign({ page: 1, pageSize: 500 }, query || {}),
              showErrorToast: false, timeoutMs: 10000, fallbackRead: function () { return null; }
            });
            var list = Array.isArray(res) ? res : (res && res.items) || [];
            var adapted = list.map(_backendToFrontend).filter(function (x) { return !!x; });
            __wageBackendCache = adapted;
            __wageBackendCacheTs = Date.now();
            __wageBackendCacheKey = cacheKey;
            return adapted;
          } catch (e) {
            console.warn('[WageUI] 拉取后端工资条失败', e.message);
            return [];
          }
        }
        function _clearWageCache() { __wageBackendCache = null; __wageBackendCacheTs = 0; }

        // 行当分组到三类（演员/乐队/舞美）的列名映射
        var ACTOR_ROLES = ['青衣','老生','须生','花脸','小生','老旦','花旦','丑角','龙套'];
        var MUSIC_ROLES = ['板胡','司鼓','二胡','板胡伴奏','扬琴','笛子','唢呐','打击乐'];
        var STAGE_ROLES = ['灯光','音响','服装','道具','化妆','布景'];
        function catGroup(role) {
          if (ACTOR_ROLES.indexOf(role) >= 0) return 'actor';
          if (MUSIC_ROLES.indexOf(role) >= 0) return 'music';
          if (STAGE_ROLES.indexOf(role) >= 0) return 'stage';
          return 'actor';
        }

        // ====== 子Tab切换 ======
        function initSubTabs() {
          document.querySelectorAll('.wage-sub-tab').forEach(function (btn) {
            btn.addEventListener('click', function () {
              document.querySelectorAll('.wage-sub-tab').forEach(function (b) { b.classList.remove('active'); });
              btn.classList.add('active');
              var k = btn.getAttribute('data-wtab');
              document.querySelectorAll('.wage-sub-panel').forEach(function (p) { p.classList.remove('active'); });
              var t = $('wtab-' + k);
              if (t) t.classList.add('active');
              if (k === 'generate') refreshGenTable();
              if (k === 'history') refreshHistTable();
              if (k === 'rules') renderRulesTable();
            });
          });
        }

        // ====== 规则表渲染（3组矩阵） ======
        function renderRulesTable() {
          if (!W) return;
          var R = W.getDefaultRules();
          // 版本徽章
          var vb = $('wageRuleVersionBadge');
          if (vb) vb.textContent = (R.version || 'v') + (R.updatedAt ? (' · ' + new Date(R.updatedAt).toLocaleDateString('zh-CN')) : ' · 默认');
          // 顶栏统计卡（id, 显示文本）——保存规则/服务端同步后随 renderRulesTable 一并刷新
          var yuan = function (cents) { return '¥' + ((cents || 0) / 100); };
          var fills = [
            ['wstatBenxi', yuan(R.performanceAllowance.benxi)],
            ['wstatZhezi', yuan(R.performanceAllowance.zhezi)],
            ['wstatXiaxiang', yuan(R.performanceAllowance.xiaxiang)],
            ['wstatPerfect', yuan(R.perfectAttendanceBonus)],
            ['wstatSeniority', yuan(R.seniorityPerYear)],
            ['wstatMeal', yuan(R.dailySubsidy.meal) + '/' + yuan(R.dailySubsidy.traffic)],
            ['wstatSocial', (R.deductions.socialInsurance || '—') + '/' + (R.deductions.housingFund || '—')],
            ['wstatStdDay', String(R.standardWorkDays != null ? R.standardWorkDays : 21.75)]
          ];
          fills.forEach(function (f) {
            var el = $(f[0]);
            if (el) el.textContent = f[1];
          });
          // actor rows
          var actorBody = $('wrule-actor-body');
          if (actorBody) {
            actorBody.innerHTML = '';
            ACTOR_ROLES.forEach(function (role) {
              var map = R.baseDailyWage[role] || {};
              var cols = ['一级演员','二级演员','三级演员','优秀青年','学员'];
              var tr = document.createElement('tr');
              tr.innerHTML = '<td style="font-weight:700;color:var(--primary-dark);background:rgba(15,76,129,0.04);">' + role + '</td>'
                + cols.map(function (lv) {
                    var v = map[lv]; if (typeof v !== 'number') v = ''; else v = (v/100).toFixed(0);
                    return '<td><input type="number" min="0" step="10" data-wrule="actor" data-role="' + role + '" data-level="' + lv + '" value="' + (v||'') + '" placeholder="0"/></td>';
                  }).join('');
              actorBody.appendChild(tr);
            });
          }
          // music rows（4级列：一级演奏员/二级/三级/其他/学员）
          var musicBody = $('wrule-music-body');
          if (musicBody) {
            musicBody.innerHTML = '';
            MUSIC_ROLES.forEach(function (role) {
              var map = R.baseDailyWage[role] || {};
              var cols = ['一级演奏员','二级演奏员','三级演奏员','队长','学员'];
              // 个别行当做特殊列名显示（如板胡→首席，司鼓→队长）
              var showCols = cols.slice();
              if (role === '板胡') showCols[3] = '首席';
              if (role === '司鼓') showCols[3] = '队长';
              if (role !== '板胡' && role !== '司鼓') showCols[3] = '演奏员';
              var tr = document.createElement('tr');
              tr.innerHTML = '<td style="font-weight:700;color:#17a2b8;background:rgba(23,162,184,0.04);">' + role + '</td>'
                + cols.map(function (lv, i) {
                    var mapKey = lv;
                    if (role === '板胡' && i === 3) mapKey = '首席';
                    if (role === '司鼓' && i === 3) mapKey = '队长';
                    if (role !== '板胡' && role !== '司鼓' && i === 3) mapKey = '演奏员';
                    var v = map[mapKey]; if (typeof v !== 'number') v = ''; else v = (v/100).toFixed(0);
                    return '<td><input type="number" min="0" step="10" data-wrule="music" data-role="' + role + '" data-level="' + mapKey + '" value="' + (v||'') + '" placeholder="0" title="' + showCols[i] + '"/></td>';
                  }).join('');
              musicBody.appendChild(tr);
            });
          }
          // stage rows
          var stageBody = $('wrule-stage-body');
          if (stageBody) {
            stageBody.innerHTML = '';
            STAGE_ROLES.forEach(function (role) {
              var map = R.baseDailyWage[role] || {};
              var cols = ['高级舞美','舞美师','舞美员','技术员','学员'];
              var tr = document.createElement('tr');
              tr.innerHTML = '<td style="font-weight:700;color:#7c3aed;background:rgba(124,58,237,0.04);">' + role + '</td>'
                + cols.map(function (lv) {
                    var v = map[lv]; if (typeof v !== 'number') v = ''; else v = (v/100).toFixed(0);
                    return '<td><input type="number" min="0" step="10" data-wrule="stage" data-role="' + role + '" data-level="' + lv + '" value="' + (v||'') + '" placeholder="0"/></td>';
                  }).join('');
              stageBody.appendChild(tr);
            });
          }
          // 全局参数输入填充
          var globalFill = [
            ['wPaBenxi', R.performanceAllowance.benxi/100],
            ['wPaZhezi', R.performanceAllowance.zhezi/100],
            ['wPaXiaxiang', R.performanceAllowance.xiaxiang/100],
            ['wPaFestival', (R.performanceAllowance.festival||0)/100],
            ['wPerfect', (R.perfectAttendanceBonus||0)/100],
            ['wBaseDaily', (R.baseDailyStandard||0)/100],
            ['wSeniority', (R.seniorityPerYear||0)/100],
            ['wMeal', (R.dailySubsidy.meal||0)/100],
            ['wTraffic', (R.dailySubsidy.traffic||0)/100],
            ['wLate1', (R.deductions.lateUnder30min||0)/100],
            ['wLate2', typeof R.deductions.lateOver30min === 'string' ? R.deductions.lateOver30min : (((R.deductions.lateOver30min||0)/100) + '')],
            ['wAbsent', (R.deductions.absentFine||0)/100],
            ['wAbsentFull', R.deductions.absentFullDay || '200%']
          ];
          globalFill.forEach(function (p) {
            var el = $(p[0]); if (el) el.value = p[1];
          });
        }

        function collectRulesFromUI() {
          if (!W) return null;
          var R = W.getDefaultRules();
          // 矩阵
          document.querySelectorAll('input[data-wrule]').forEach(function (inp) {
            var role = inp.getAttribute('data-role');
            var lv = inp.getAttribute('data-level');
            var val = parseFloat(inp.value);
            if (!isNaN(val) && isFinite(val) && val >= 0) {
              if (!R.baseDailyWage[role]) R.baseDailyWage[role] = {};
              R.baseDailyWage[role][lv] = Math.round(val * 100);
            }
          });
          // 全局参数
          document.querySelectorAll('.wage-global-input').forEach(function (inp) {
            var k = inp.getAttribute('data-wkey');
            if (!k) return;
            var parts = k.split('.');
            var obj = R;
            for (var i = 0; i < parts.length - 1; i++) {
              if (!obj[parts[i]]) obj[parts[i]] = {};
              obj = obj[parts[i]];
            }
            var last = parts[parts.length - 1];
            var raw = inp.value;
            if (typeof raw === 'string' && /%$/.test(raw)) {
              obj[last] = raw; // 百分比字符串
            } else {
              var n = parseFloat(raw);
              if (!isNaN(n) && isFinite(n) && n >= 0) obj[last] = Math.round(n * 100);
            }
          });
          return R;
        }

        function bindRuleActions() {
          var s1 = $('saveWageRulesBtn'); if (s1) s1.addEventListener('click', function () {
            var r = collectRulesFromUI(); if (!r) return;
            if (W.saveRules(r)) renderRulesTable();
          });
          var s2 = $('resetWageRulesBtn'); if (s2) s2.addEventListener('click', function () {
            if (!window.confirm('⚠️ 确认恢复系统默认日工资规则？当前所有修改将丢失！')) return;
            if (W.resetRules()) renderRulesTable();
          });
          var s3 = $('exportWageRulesBtn'); if (s3) s3.addEventListener('click', function () {
            if (!W) return;
            var R = W.getDefaultRules();
            var blob = new Blob([JSON.stringify(R, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = 'wage-rules-' + (new Date().toISOString().slice(0,10)) + '.json';
            a.click(); URL.revokeObjectURL(url);
            U && U.toast && U.toast('📥 规则已导出为JSON文件', 'success');
          });
        }

        // ====== 当月生成 ======
        function bindGenActions() {
          var monthEl = $('wageGenMonth');
          var now = new Date();
          var defaultMonth = now.getFullYear() + '-' + pad(String(now.getMonth()+1), 2);
          if (monthEl) {
            monthEl.value = defaultMonth;
            monthEl.addEventListener('change', updateGenEstimate);
          }
          updateGenEstimate();
          // 暴露刷新函数，供花名册更新后同步薪酬模块
          window.__refreshWageStaff = function(){ try { updateGenEstimate(); } catch(_){} };
          var pb = $('wageGenPreviewBtn'); if (pb) pb.addEventListener('click', function () { runGen(true); });
          var rb = $('wageGenRunBtn'); if (rb) rb.addEventListener('click', function () { runGen(false); });
          var db = $('wageGenDelMonthBtn'); if (db) db.addEventListener('click', async function () {
            var m = (monthEl && monthEl.value);
            if (!m) { U && U.toast && U.toast('⚠️ 请先选择月份', 'warning'); return; }
            if (!window.confirm('🗑️ 确认删除月份【' + m + '】的全部工资条？该操作不可撤销！')) return;
            var API = window.QAXQJT_API;
            if (!API || !API.get || !API.del) { U && U.toast && U.toast('❌ 后端 API 未就绪', 'error'); return; }
            try {
              var list = await _fetchWages({ month: m });
              if (!list.length) { U && U.toast && U.toast('ℹ️ 该月暂无工资条', 'info'); return; }
              var okCnt = 0, failCnt = 0;
              for (var i = 0; i < list.length; i++) {
                try {
                  await API.del((QAXQJT_PATHS.WAGES_BY_ID || function (id) { return '/v1/wages/' + id; })(list[i].id), { showErrorToast: false });
                  okCnt++;
                } catch (e) { failCnt++; console.warn('[WageUI] 删除失败 ' + list[i].id, e.message); }
              }
              U && U.toast && U.toast('✅ 已删除 ' + okCnt + ' 条工资条' + (failCnt ? '，失败 ' + failCnt + ' 条' : ''), failCnt ? 'warning' : 'success');
              _clearWageCache();
              await refreshGenTable(); await refreshHistTable(); updateHistStats(); updateBadgeCount();
            } catch (e) {
              U && U.toast && U.toast('❌ 删除失败：' + (e.message || e), 'error');
            }
          });
        }

        async function updateGenEstimate() {
          var monthEl = $('wageGenMonth');
          var m = (monthEl && monthEl.value) || '';
          var ml = $('wageGenMonthLabel'); if (ml) ml.textContent = m || '—';
          var sc = $('wageGenStaffCount'); if (sc) sc.textContent = getWageStaffList().length;
          // 已有提示（走后端）
          var hint = $('wageGenExistHint');
          if (hint && m) {
            var list = await _fetchWages({ month: m });
            hint.textContent = list.length > 0 ? ('已生成 ' + list.length + ' 条') : '尚未生成';
          }
        }

        async function runGen(previewOnly) {
          var API = window.QAXQJT_API;
          if (!API || !API.post) { U && U.toast && U.toast('❌ 后端 API 未就绪', 'error'); return; }
          var m = $('wageGenMonth') && $('wageGenMonth').value;
          if (!m) { U && U.toast && U.toast('⚠️ 请先选择结算月份', 'warning'); return; }
          var staff = getWageStaffList();
          if (!staff.length) { U && U.toast && U.toast('⚠️ 花名册暂无在册人员，请先在「花名册」录入演职人员后再生成工资条', 'warning'); return; }

          // v20261005：全链路接后端，前端不再本地计算，直接调用后端 generate 接口（自带幂等重建）
          var remark = ($('wageGenRemark') && $('wageGenRemark').value) || '';
          var genBody = { month: m, dryRun: previewOnly, defaultMode: 'daily_pure' };
          var genRes;
          try {
            genRes = await API.post((QAXQJT_PATHS.WAGES_GENERATE || '/v1/wages/generate'), genBody, { showErrorToast: false, timeoutMs: 30000 });
          } catch (e) {
            var errMsg = (e && e.message) || '生成失败';
            U && U.toast && U.toast('❌ ' + errMsg, 'error', 4500);
            return;
          }
          var items = (genRes && genRes.items) || [];
          if (previewOnly) {
            // 预览：渲染但不保存
            renderPayslipRows(items.map(_backendToFrontend), $('wageGenTbody'), true);
            var lbl = $('wageGenCountLabel');
            if (lbl) lbl.textContent = '（预览·' + items.length + ' 条，未保存）';
            U && U.toast && U.toast('🔍 预览完成，共 ' + items.length + ' 条（尚未保存到后端）', 'info');
          } else {
            // 正式生成：后端已自动建批次+明细，前端只需刷新列表
            var batchInfo = genRes && genRes.batch;
            U && U.toast && U.toast('✅ 工资批次 ' + (batchInfo && batchInfo.batchNo || '') + ' 已生成，共 ' + items.length + ' 条', 'success');
            _clearWageCache();
            await refreshGenTable();
            await refreshHistTable();
            updateHistStats();
            updateBadgeCount();
          }
        }

        async function refreshGenTable() {
          var m = $('wageGenMonth') && $('wageGenMonth').value;
          var list = m ? await _fetchWages({ month: m }) : [];
          renderPayslipRows(list, $('wageGenTbody'), false);
          var lbl = $('wageGenCountLabel');
          if (lbl) lbl.textContent = m ? ('（' + m + ' · 共 ' + list.length + ' 条）') : '（空）';
          var hint = $('wageGenExistHint');
          if (hint) hint.textContent = list.length > 0 ? ('已生成 ' + list.length + ' 条') : '尚未生成';
        }

        function renderPayslipRows(list, tbody, isPreview) {
          if (!tbody) return;
          if (!list || !list.length) {
            tbody.innerHTML = '<tr><td colspan="14" style="padding:50px 20px;color:var(--text-light);font-size:0.9rem;">'
              + (isPreview ? '🈳 预览结果为空' : '🈳 尚无数据。选择月份后，点击「预览核算」可查看预估，点击「生成当月工资条」即可批量创建工资单。')
              + '</td></tr>';
            return;
          }
          tbody.innerHTML = '';
          for (var i = 0; i < list.length; i++) {
            var w = list[i];
            var it = w.items || {};
            var su = w.summary || {};
            var tr = document.createElement('tr');
            var statusColor = w.status === 'paid' ? '#28a745' : '#ff9800';
            var statusText = w.status === 'paid' ? '✓ 已发放' : '⏳ 待发放';
            var _rateNum = Number(w.dailyWage) || 0;
            var _rateCell = _rateNum > 0
              ? '<div title="本人协议天工资（扫码入职/花名册约定）" style="font-weight:800;color:var(--primary-dark);">¥' + _rateNum + '<small style="font-weight:500;color:var(--text-light);">/天</small></div><small style="color:var(--text-light);font-size:0.72rem;">×' + (su.workDays||0) + '天</small>'
              : '<small title="未约定协议天工资，按行当×职级标准矩阵计酬" style="color:var(--text-light);font-size:0.74rem;">按职级<br/>矩阵</small>';
            tr.innerHTML =
              '<td style="font-family:Consolas,monospace;font-weight:700;color:var(--primary-dark);font-size:0.8rem;">' + (w.id||'') + '</td>'
              + '<td style="font-weight:600;">' + _escX(w.staffName||'') + '</td>'
              + '<td><span class="role-tag">' + _escX(w.roleCategory||'') + '</span><br/><small style="color:var(--text-light);font-size:0.75rem;">' + _escX(w.level||'') + '</small></td>'
              + '<td><strong style="color:var(--primary);">' + (su.workDays||0) + '</strong><br/><small style="color:var(--text-light);font-size:0.72rem;">晚' + (su.lateDays||0) + ' 旷' + (su.absentFullDays||0) + '</small></td>'
              + '<td style="font-size:0.78rem;line-height:1.5;">本' + (su.performBenxi||0) + '/折' + (su.performZhezi||0) + '<br/>乡' + (su.performXiaxiang||0) + '/其' + (su.performOther||0) + '</td>'
              + '<td class="amt-right">' + _rateCell + '</td>'
              + '<td class="amt-right">' + fmt(it.baseSalary||0) + '</td>'
              + '<td class="amt-right" style="color:#28a745;">+' + fmt(it.performanceAllowance||0) + '</td>'
              + '<td class="amt-right" style="font-size:0.78rem;line-height:1.4;">勤+' + fmt(it.perfectBonus||0) + '<br/>龄+' + fmt(it.seniorityAllowance||0) + ' 餐交+' + fmt((it.mealAllowance||0)+(it.trafficAllowance||0)) + '</td>'
              + '<td class="amt-right" style="color:#1e6fb5;font-weight:800;">' + fmt(it.grossPay||0) + '</td>'
              + '<td class="amt-right" style="color:#dc3545;font-size:0.78rem;line-height:1.4;">社' + fmt(it.socialInsurance||0) + '<br/>公' + fmt(it.housingFund||0) + ' 考-' + fmt(it.attendanceDeduction||0) + '</td>'
              + '<td class="amt-right" style="font-size:1.05rem;color:#B8860B;font-weight:900;font-family:Georgia,serif;">' + fmt(it.netPay||0) + '</td>'
              + '<td><span style="display:inline-block;padding:4px 10px;border-radius:12px;background:rgba(' + (w.status==='paid'?'40,167,69':'255,152,0') + ',0.12);color:' + statusColor + ';font-size:0.78rem;font-weight:600;">' + statusText + '</span></td>'
              + '<td style="white-space:nowrap;">'
                + '<button class="btn btn-secondary btn-sm" data-wdetail="' + (w.id||'') + '" title="查看明细">👁 明细</button> '
                + (isPreview ? '' : '<button class="btn btn-gold btn-sm" data-wpaid="' + (w.id||'') + '" title="标记已发/未发">' + (w.status === 'paid' ? '↩️ 撤发' : '💸 发放') + '</button> ')
                + (isPreview ? '' : '<button class="btn btn-sm" data-wdel="' + (w.id||'') + '" title="删除该条" style="padding:6px 10px;background:rgba(220,53,69,0.1);color:#dc3545;">🗑️</button>')
              + '</td>';
            tbody.appendChild(tr);
          }
          // 绑定行操作
          if (!isPreview) {
            tbody.querySelectorAll('button[data-wdetail]').forEach(function (b) {
              b.addEventListener('click', function () { showDetail(b.getAttribute('data-wdetail')); });
            });
            tbody.querySelectorAll('button[data-wpaid]').forEach(function (b) {
              b.addEventListener('click', async function () {
                var id = b.getAttribute('data-wpaid');
                var API = window.QAXQJT_API;
                if (!API || !API.patch) return;
                try {
                  await API.patch((QAXQJT_PATHS.WAGES_BY_ID || function (i) { return '/v1/wages/' + i; })(id), { payslipPublished: true }, { showErrorToast: false });
                  U && U.toast && U.toast('✅ 已标记为已发放', 'success');
                } catch (e) {
                  U && U.toast && U.toast('❌ 标记失败：' + ((e && e.message) || ''), 'error');
                }
                _clearWageCache(); await refreshGenTable(); await refreshHistTable(); updateHistStats(); updateBadgeCount();
              });
            });
            tbody.querySelectorAll('button[data-wdel]').forEach(function (b) {
              b.addEventListener('click', async function () {
                if (!window.confirm('🗑️ 确认删除该工资条？')) return;
                var id = b.getAttribute('data-wdel');
                var API = window.QAXQJT_API;
                if (!API || !API.del) return;
                try {
                  await API.del((QAXQJT_PATHS.WAGES_BY_ID || function (i) { return '/v1/wages/' + i; })(id), { showErrorToast: false });
                  U && U.toast && U.toast('✅ 已删除', 'success');
                } catch (e) {
                  U && U.toast && U.toast('❌ 删除失败：' + ((e && e.message) || ''), 'error');
                }
                _clearWageCache(); await refreshGenTable(); await refreshHistTable(); updateHistStats(); updateBadgeCount();
              });
            });
          }
        }

        // ====== 工资条明细弹窗 ======
        async function showDetail(id) {
          if (!id) return;
          var API = window.QAXQJT_API;
          var w = null;
          if (API && API.get) {
            try {
              var res = await API.get((QAXQJT_PATHS.WAGES_BY_ID || function (i) { return '/v1/wages/' + i; })(id), { showErrorToast: false, timeoutMs: 10000 });
              if (res) w = _backendToFrontend(res);
            } catch (e) { console.warn('[WageUI] 拉取明细失败', e.message); }
          }
          if (!w) { U && U.toast && U.toast('⚠️ 未找到该工资条明细', 'warning'); return; }
          var it = w.items || {};
          var su = w.summary || {};
          var staff = null;
          var _msl = getWageStaffList();
          for (var i = 0; i < _msl.length; i++) { if (_msl[i].id === w.staffId || _msl[i].name === w.staffName) { staff = _msl[i]; break; } }
          var staffLine = staff ? ('工号 ' + staff.id + ' · ' + staff.dept + ' · ' + (staff.hireYear + '入职')) : '';
          var html =
            '<div class="payslip-detail-modal" onclick="event.stopPropagation()">'
            + '<div class="payslip-detail-header">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">'
            + '<div><div style="font-size:1.3rem;font-weight:800;margin-bottom:4px;">🧾 秦安县秦剧团文化演出有限公司</div><div style="font-size:0.9rem;opacity:0.85;">员工工资条 · 结算月份：' + (w.month||'') + '</div></div>'
            + '<div style="text-align:right;"><div style="display:inline-block;padding:6px 16px;border-radius:20px;background:rgba(255,215,0,0.18);color:#FFD700;font-weight:700;">' + (w.id||'') + '</div><div style="margin-top:6px;font-size:0.8rem;opacity:0.8;">' + (w.status === 'paid' ? '✓ 已发放 · ' + (w.paidAt ? new Date(w.paidAt).toLocaleString('zh-CN') : '') : '⏳ 待发放') + '</div></div>'
            + '</div><hr style="border-color:rgba(255,255,255,0.25);margin:14px 0 10px 0;"/>'
            + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;font-size:0.88rem;">'
            + '<div>👤 姓名：<strong style="font-size:1rem;">' + _escX(w.staffName||'') + '</strong></div>'
            + '<div>🎭 行当·职级：<strong>' + _escX(w.roleCategory||'') + ' · ' + _escX(w.level||'') + '</strong></div>'
            + '<div>🏢 ' + staffLine + '</div>'
            + '<div>📊 出勤汇总：<strong>' + (su.workDays||0) + '</strong> 天 · 本戏' + (su.performBenxi||0) + ' 场</div>'
            + '<div>💴 协议天工资：' + ((Number(w.dailyWage)||0) > 0
                ? ('<strong style="color:var(--primary-dark);">¥' + Number(w.dailyWage) + ' /天</strong>（×' + (su.workDays||0) + '天，扫码入职/花名册约定优先）')
                : '<strong style="color:var(--text-light);">未约定</strong>（按行当×职级标准矩阵计酬）') + '</div>'
            + '</div></div>'
            + '<div class="payslip-detail-body">'
            + '<div class="payslip-grid">'
              + itemCard('income', ((Number(w.dailyWage)||0) > 0
                  ? ('💰 基本日薪×出勤（协议 ¥' + Number(w.dailyWage) + '/天 × ' + (su.workDays||0) + '天）')
                  : '💰 基本日薪×出勤（按职级标准矩阵）'), it.baseSalary)
              + itemCard('income', '🎬 演出场次补助', it.performanceAllowance)
              + itemCard('income', '🏆 全勤奖', it.perfectBonus)
              + itemCard('income', '🎖️ 工龄补贴（' + ((staff && staff.hireYear) ? (new Date().getFullYear() - staff.hireYear) : 0) + '年）', it.seniorityAllowance)
              + itemCard('income', '🍱 餐补 + 交通补', (it.mealAllowance||0) + (it.trafficAllowance||0))
              + itemCard('income', '🎁 其他奖金/补助', it.extraBonus || 0)
              + itemCard('deduct', '🏥 社保个人（养老+医疗+失业）', it.socialInsurance)
              + itemCard('deduct', '🏠 公积金个人', it.housingFund)
              + itemCard('deduct', '⚠️ 考勤相关扣款', it.attendanceDeduction || 0)
              + itemCard('deduct', '📝 其他扣款', it.extraDeduction || 0)
              + '<div class="payslip-item income total"><div class="pl">📌 应发合计（所有收入项）</div><div class="pv">' + fmt(it.grossPay || 0) + '</div></div>'
              + '<div class="payslip-item deduct total"><div class="pl">📌 扣款合计（社保+公积+考勤+其他）</div><div class="pv">-' + fmt(it.totalDeduction || 0) + '</div></div>'
              + '<div class="payslip-item total" style="background:linear-gradient(135deg,#B8860B,#DAA520)!important;"><div class="pl" style="color:rgba(255,255,255,0.9)!important;font-size:0.95rem;">💵 本月实发工资（Gross − 总扣款）</div><div class="pv" style="font-size:1.9rem!important;">' + fmt(it.netPay || 0) + '</div></div>'
            + '</div>'
            + '<div style="margin-top:20px;padding:14px 16px;background:rgba(15,76,129,0.04);border:1px dashed rgba(15,76,129,0.2);border-radius:10px;">'
            + '<div style="font-weight:700;margin-bottom:8px;color:var(--primary-dark);">📅 当月考勤明细（含演出）</div>'
            + (renderDailyMini(w))
            + '</div>'
            + (w.remark ? '<div style="margin-top:14px;padding:10px 14px;background:rgba(201,169,98,0.08);border-radius:8px;font-size:0.85rem;">📝 备注：' + _escX(w.remark) + '</div>' : '')
            + '<div style="margin-top:22px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">'
            + '<div style="font-size:0.8rem;color:var(--text-light);">生成时间：' + (w.createdAt ? new Date(w.createdAt).toLocaleString('zh-CN') : '-') + ' · 系统计算，仅供参考</div>'
            + '<div style="display:flex;gap:8px;">'
            + '<button class="btn btn-outline-dark btn-sm" onclick="window._wageExportPayslip(\'' + (w.id||'') + '\')">📥 导出PDF</button>'
            + (w.status !== 'paid' ? '<button class="btn btn-gold btn-sm" onclick="window._wageMarkPaid(\'' + (w.id||'') + '\');document.querySelector(\'.modal-overlay-hide\').classList.remove(\'modal-wrap-hide\',\'modal-overlay-hide\');window._closePayslipModal();">💸 确认发放</button>'
              : '<button class="btn btn-outline-dark btn-sm" onclick="window._wageMarkPaid(\'' + (w.id||'') + '\');window._closePayslipModal();">↩️ 取消发放标记</button>')
            + '</div></div></div></div>';
          showWageModal(html);
        }
        function itemCard(cls, label, cents) {
          return '<div class="payslip-item ' + (cls||'') + '"><div class="pl">' + label + '</div><div class="pv">' + ((cls==='deduct'?'-':'') + fmt(cents||0)) + '</div></div>';
        }
        function renderDailyMini(w) {
          var arr = w.dailyDetails || []; if (!arr.length) return '<div style="color:var(--text-light);font-size:0.82rem;">无明细</div>';
          var s = '<div style="display:flex;flex-wrap:wrap;gap:5px;max-height:180px;overflow-y:auto;padding:6px;">';
          for (var i = 0; i < arr.length; i++) {
            var d = arr[i];
            var bg = '#fff', col = 'var(--text-dark)';
            if (d.status === 'late') { bg = '#fff3cd'; col = '#856404'; }
            else if (d.status === 'absent') { bg = '#f8d7da'; col = '#721c24'; }
            else if (d.status === 'leave_sick') { bg = '#d1ecf1'; col = '#0c5460'; }
            else if (d.status === 'leave_personal') { bg = '#e2e3e5'; col = '#383d41'; }
            else if (d.status === 'off') continue;
            else if (d.performance) { bg = '#d4edda'; col = '#155724'; }
            s += '<div title="' + (d.date||'') + ' 状态:' + d.status + ' 演出补助:' + (d.performance/100) + '元 净:' + (d.net/100) + '元" style="min-width:60px;padding:5px 7px;background:' + bg + ';color:' + col + ';border-radius:6px;font-size:0.72rem;font-weight:600;text-align:center;">' + String(d.date||'').slice(8) + '<br/><small style="font-weight:500;">¥' + (d.net/100).toFixed(0) + (d.performance ? (' · ' + (d.performance/100) + '演') : '') + '</small></div>';
          }
          s += '</div>'; return s;
        }

        function showWageModal(innerHtml) {
          // 复用 injectOrReuseModal，或直接造一个
          if (window.QinApp && window.QinApp.UI && typeof window.QinApp.UI.injectOrReuseModal === 'function') {
            var Q = window.QinApp.UI.injectOrReuseModal({
              id: 'wage_detail_modal',
              title: '🧾 工资条明细',
              body: innerHtml,
              width: 860,
              showConfirm: false,
              showCancel: false
            });
            window._closePayslipModal = function () {
              try { var o = document.getElementById('modal-overlay-wage_detail_modal') || document.querySelector('.modal-overlay-hide:last-of-type'); if (o) o.classList.add('modal-wrap-hide','modal-overlay-hide'); } catch(_){}
              try { var m = document.getElementById('modal-wrap-wage_detail_modal') || document.querySelector('.modal.modal-wrap-hide:last-of-type'); if (m) m.classList.add('modal-wrap-hide'); } catch(_){}
            };
            return Q;
          } else {
            // 兜底：alert 基本信息
            alert('（当前环境无 Modal 组件）\n\n工资条明细功能已就绪。');
          }
        }

        window._wageMarkPaid = async function (id) {
          // 🔧 R9 FIX：防抖锁（按工资单id防止快速双击2次toggle发放→取消发放）
          var lockKey = 'wm_' + String(id || 'x');
          if (window.__OP_LOCKS && window.__OP_LOCKS[lockKey]) { try { U && U.toast && U.toast('⏳ 处理中，请稍候…', 'warning'); } catch(_){} return; }
          try { if (!window.__OP_LOCKS) window.__OP_LOCKS = {}; window.__OP_LOCKS[lockKey] = true; setTimeout(function(){try{delete window.__OP_LOCKS[lockKey];}catch(_){}}, 700); } catch(_lk){}
          var API = window.QAXQJT_API;
          if (!API || !API.patch) return;
          try {
            await API.patch((QAXQJT_PATHS.WAGES_BY_ID || function (i) { return '/v1/wages/' + i; })(id), { payslipPublished: true }, { showErrorToast: false });
            U && U.toast && U.toast('✅ 已标记为已发放', 'success');
          } catch (e) {
            U && U.toast && U.toast('❌ 标记失败：' + ((e && e.message) || ''), 'error');
          }
          _clearWageCache(); await refreshGenTable(); await refreshHistTable(); updateHistStats(); updateBadgeCount();
        };
        window._wageExportPayslip = async function (id) {
          var API = window.QAXQJT_API;
          var w = null;
          if (API && API.get) {
            try {
              var res = await API.get((QAXQJT_PATHS.WAGES_BY_ID || function (i) { return '/v1/wages/' + i; })(id), { showErrorToast: false, timeoutMs: 10000 });
              if (res) w = _backendToFrontend(res);
            } catch (e) { console.warn('[WageUI] 导出明细拉取失败', e.message); }
          }
          if (!w) { U && U.toast && U.toast('⚠️ 未找到该工资条', 'warning'); return; }
          var csv = '项目,金额(元)\n';
          var names = {'baseSalary':'基本日薪×出勤','performanceAllowance':'演出补助','perfectBonus':'全勤奖','seniorityAllowance':'工龄补贴','mealAllowance':'餐补','trafficAllowance':'交通补','extraBonus':'其他奖金','grossPay':'应发合计','socialInsurance':'社保个人','housingFund':'公积金个人','attendanceDeduction':'考勤扣款','extraDeduction':'其他扣款','totalDeduction':'扣款合计','netPay':'实发工资'};
          var it = w.items || {};
          Object.keys(names).forEach(function (k) { if (typeof it[k] === 'number') csv += names[k] + ',' + (it[k]/100).toFixed(2) + '\n'; });
          var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = 'Payslip-' + (w.id||'') + '.csv'; a.click(); URL.revokeObjectURL(url);
          U && U.toast && U.toast('📥 已导出 CSV（可用 Excel/WPS 打开并打印）', 'success');
        };

        // ====== 历史Tab ======
        function bindHistActions() {
          var sb = $('wageHistSearchBtn'); if (sb) sb.addEventListener('click', refreshHistTable);
          var kw = $('wageHistKw'); if (kw) kw.addEventListener('keydown', function (e) { if (e.key === 'Enter') refreshHistTable(); });
          var ex = $('wageHistExportBtn'); if (ex) ex.addEventListener('click', exportHistAll);
        }
        async function refreshHistMonths() {
          var sel = $('wageHistMonth'); if (!sel) return;
          var curr = sel.value;
          var list = await _fetchWages({});
          var set = {};
          for (var i = 0; i < list.length; i++) if (list[i].month) set[list[i].month] = true;
          var arr = Object.keys(set).sort().reverse();
          sel.innerHTML = '<option value="">全部月份</option>' + arr.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
          if (curr) sel.value = curr;
        }
        async function refreshHistTable() {
          await refreshHistMonths();
          var m = $('wageHistMonth') && $('wageHistMonth').value;
          var st = $('wageHistStatus') && $('wageHistStatus').value;
          var kw = (($('wageHistKw') && $('wageHistKw').value) || '').trim();
          var list = await _fetchWages({});
          if (m) list = list.filter(function (w) { return w.month === m; });
          if (st) list = list.filter(function (w) { return w.status === st; });
          if (kw) {
            list = list.filter(function (w) {
              return ((w.staffName||'').indexOf(kw)>=0) || ((w.staffId||'').indexOf(kw)>=0) || ((w.id||'').indexOf(kw)>=0);
            });
          }
          list.sort(function (a, b) { return (b.month||'').localeCompare(a.month||'') || ((b.createdAt||0)-(a.createdAt||0)); });
          var tbody = $('wageHistTbody');
          if (!tbody) return;
          if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="10" style="padding:50px 20px;color:var(--text-light);font-size:0.9rem;">🈳 筛选结果为空</td></tr>';
            return;
          }
          tbody.innerHTML = '';
          for (var i = 0; i < list.length; i++) {
            var w = list[i];
            var it = w.items || {};
            var sc = w.status === 'paid' ? '#28a745' : '#ff9800';
            var st_ = w.status === 'paid' ? '✓ 已发放' : '⏳ 待发放';
            var tr = document.createElement('tr');
            tr.innerHTML =
              '<td style="font-weight:700;color:var(--primary-dark);">' + (w.month||'') + '</td>'
              + '<td style="font-family:Consolas,monospace;font-weight:700;color:var(--primary-dark);font-size:0.78rem;">' + (w.id||'') + '</td>'
              + '<td style="font-weight:600;">' + _escX(w.staffName||'') + '</td>'
              + '<td><span class="role-tag">' + _escX(w.roleCategory||'') + '</span><br/><small style="color:var(--text-light);font-size:0.72rem;">' + _escX(w.level||'') + '</small></td>'
              + '<td class="amt-right" style="color:#1e6fb5;">' + fmt(it.grossPay||0) + '</td>'
              + '<td class="amt-right" style="color:#dc3545;">-' + fmt(it.totalDeduction||0) + '</td>'
              + '<td class="amt-right" style="font-weight:900;font-size:1.02rem;color:#B8860B;font-family:Georgia,serif;">' + fmt(it.netPay||0) + '</td>'
              + '<td><span style="display:inline-block;padding:3px 10px;border-radius:10px;background:rgba(' + (w.status==='paid'?'40,167,69':'255,152,0') + ',0.12);color:' + sc + ';font-size:0.75rem;font-weight:600;">' + st_ + '</span></td>'
              + '<td style="font-size:0.78rem;color:var(--text-light);">' + (w.paidAt ? new Date(w.paidAt).toLocaleString('zh-CN').slice(5) : '—') + '</td>'
              + '<td style="white-space:nowrap;">'
                + '<button class="btn btn-secondary btn-sm" data-hdetail="' + (w.id||'') + '">👁 明细</button> '
                + '<button class="btn btn-gold btn-sm" data-hpaid="' + (w.id||'') + '">' + (w.status === 'paid' ? '↩️ 撤发' : '💸 发放') + '</button> '
                + '<button class="btn btn-sm" data-hdel="' + (w.id||'') + '" title="删除" style="padding:6px 10px;background:rgba(220,53,69,0.1);color:#dc3545;">🗑️</button>'
              + '</td>';
            tbody.appendChild(tr);
          }
          tbody.querySelectorAll('button[data-hdetail]').forEach(function (b) {
            b.addEventListener('click', function () { showDetail(b.getAttribute('data-hdetail')); });
          });
          tbody.querySelectorAll('button[data-hpaid]').forEach(function (b) {
            b.addEventListener('click', async function () {
              var id = b.getAttribute('data-hpaid');
              var API = window.QAXQJT_API;
              if (!API || !API.patch) return;
              try {
                await API.patch((QAXQJT_PATHS.WAGES_BY_ID || function (i) { return '/v1/wages/' + i; })(id), { payslipPublished: true }, { showErrorToast: false });
                U && U.toast && U.toast('✅ 已标记为已发放', 'success');
              } catch (e) {
                U && U.toast && U.toast('❌ 标记失败：' + ((e && e.message) || ''), 'error');
              }
              _clearWageCache(); await refreshGenTable(); await refreshHistTable(); updateHistStats(); updateBadgeCount();
            });
          });
          tbody.querySelectorAll('button[data-hdel]').forEach(function (b) {
            b.addEventListener('click', async function () {
              if (!window.confirm('🗑️ 确认删除该工资条？')) return;
              var id = b.getAttribute('data-hdel');
              var API = window.QAXQJT_API;
              if (!API || !API.del) return;
              try {
                await API.del((QAXQJT_PATHS.WAGES_BY_ID || function (i) { return '/v1/wages/' + i; })(id), { showErrorToast: false });
                U && U.toast && U.toast('✅ 已删除', 'success');
              } catch (e) {
                U && U.toast && U.toast('❌ 删除失败：' + ((e && e.message) || ''), 'error');
              }
              _clearWageCache(); await refreshGenTable(); await refreshHistTable(); updateHistStats(); updateBadgeCount();
            });
          });
        }
        async function updateHistStats() {
          var list = await _fetchWages({});
          var paid = 0, unpaid = 0, net = 0, perf = 0;
          for (var i = 0; i < list.length; i++) {
            var w = list[i];
            if (w.status === 'paid') paid++; else unpaid++;
            net += (w.items && w.items.netPay) || 0;
            perf += (w.items && w.items.performanceAllowance) || 0;
          }
          var c1 = $('wageHistTotalCount'); if (c1) c1.textContent = list.length;
          var c2 = $('wageHistTotalNet'); if (c2) c2.textContent = '¥' + (net/100).toLocaleString('zh-CN', {maximumFractionDigits:0});
          var c3 = $('wageHistPaidLabel'); if (c3) c3.textContent = paid + ' / ' + unpaid;
          var c4 = $('wageHistPerform'); if (c4) c4.textContent = '¥' + (perf/100).toLocaleString('zh-CN', {maximumFractionDigits:0});
          updateBadgeCount();
        }
        async function updateBadgeCount() {
          var list = await _fetchWages({});
          var b = $('wageTabBadge'); if (b) b.textContent = list.length;
        }
        async function exportHistAll() {
          var list = await _fetchWages({});
          if (!list.length) { U && U.toast && U.toast('⚠️ 暂无数据可导出', 'warning'); return; }
          var headers = ['月份','编号','姓名','工号','行当','职级','出勤天数','本戏场数','折子场数','下乡场数','应发合计','演出补助','全勤奖','工龄补贴','餐补+交通','社保个人','公积金个人','考勤扣款','扣款合计','实发工资','发放状态','发放时间','生成时间'];
          var rows = [headers.join(',')];
          list.forEach(function (w) {
            var it = w.items || {}, su = w.summary || {};
            rows.push([
              w.month||'', w.id||'', _csv(w.staffName||''), _csv(w.staffId||''), _csv(w.roleCategory||''), _csv(w.level||''),
              su.workDays||0, su.performBenxi||0, su.performZhezi||0, su.performXiaxiang||0,
              (it.grossPay||0)/100, (it.performanceAllowance||0)/100, (it.perfectBonus||0)/100, (it.seniorityAllowance||0)/100, ((it.mealAllowance||0)+(it.trafficAllowance||0))/100,
              (it.socialInsurance||0)/100, (it.housingFund||0)/100, (it.attendanceDeduction||0)/100, (it.totalDeduction||0)/100, (it.netPay||0)/100,
              w.status === 'paid' ? '已发放' : '待发放',
              w.paidAt ? new Date(w.paidAt).toLocaleString('zh-CN') : '',
              w.createdAt ? new Date(w.createdAt).toLocaleString('zh-CN') : ''
            ].join(','));
          });
          var blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = 'WageHistory-' + (new Date().toISOString().slice(0,10)) + '.csv';
          a.click(); URL.revokeObjectURL(url);
          U && U.toast && U.toast('📥 已导出 ' + list.length + ' 条工资历史', 'success');
        }
        function _csv(s) { s = String(s||'').replace(/"/g,'""'); return /[",\n]/.test(s) ? ('"' + s + '"') : s; }
        function _escX(s) {
          if (U && typeof U.escapeHtml === 'function') return U.escapeHtml(s == null ? '' : String(s));
          return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
        }

        return {
          init: function wageUiInitStep() {
            // 🔴 BUG 修复：闭包变量 W/U 仅在 IIFE 定义时捕获一次。若 app.js（L4360才export window.QinApp）
            // 加载稍慢导致 W/U 为 null，则重试时必须重新从 window.QinApp 拉取赋值，否则永远死循环null
            if (!W && window.QinApp && window.QinApp.Wage) W = window.QinApp.Wage;
            if (!U && window.QinApp && window.QinApp.Utils) U = window.QinApp.Utils;
            if (typeof W !== 'object' || !W || typeof U !== 'object' || !U) {
              console.warn('[WageUI] QinApp.Wage/Utils 尚未注入（app.js 加载顺序问题），150ms 后重试');
              setTimeout(function () { wageUiInitStep.call(null); }, 150);
              return;
            }
            initSubTabs();
            renderRulesTable();
            bindRuleActions();
            bindGenActions();
            bindHistActions();
            refreshGenTable();
            refreshHistTable();
            updateHistStats();
            updateBadgeCount();
            // 从服务器同步已保存的工资规则；服务端版本较新时用服务器规则刷新界面
            if (typeof W.syncRulesFromServer === 'function') {
              W.syncRulesFromServer().then(function (res) {
                if (res && res.updated) {
                  renderRulesTable();
                  refreshGenTable();
                  refreshHistTable();
                  updateHistStats();
                  console.info('[WageUI] 服务器工资规则已应用到当前页面');
                }
              }).catch(function () {});
            }
          }
        };
      })();
      WageUI.init();
    })();

/* ===== staff.html inline block (run 3, #3/8) ===== */
(function () {
    var SESSION_STORAGE_KEY = 'qaxqjt_attv2_ui_state_v1';
    function $(id) { return document.getElementById(id); }
    function fmtCents(c) {
      if (typeof c !== 'number' || isNaN(c)) return '—';
      var sign = c < 0 ? '-' : '';
      var a = Math.abs(c);
      return sign + '¥' + (a/100).toFixed(2).replace(/\.00$/, '').replace(/(\d)(?=(\d{3})+\b)/g, '$1,');
    }
    // —— ✅ 标准化 WageEngine 引用：统一走 getWageEngine()，拿不到直接 throw 明确报错（杜绝 QinApp.Wage=undefined 导致的静默失效 Not a function 问题）
    function getW() {
      if (typeof window.getWageEngine === 'function') {
        return window.getWageEngine(); // ✅ 新标准化入口
      }
      // 回退兼容（老部署无 getWageEngine 函数时走老路径）
      return (window.WageEngine) || (window.QinApp && window.QinApp.Wage);
    }
    function getStorage() { return window.Storage; }
    function currentUser() {
      try {
        var s = JSON.parse(sessionStorage.getItem('qaxqjt_admin_session_v2') || '{}');
        return s && s.username ? s.username : '管理员';
      } catch(e){ return '管理员'; }
    }
    function pad2(n) { return n < 10 ? '0'+n : String(n); }
    function fmtTS(ts) {
      if (!ts) return '';
      var d = new Date(ts);
      return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    }
    function hashStr(s) {
      s = String(s||'');
      var h = 0;
      for (var i=0; i<s.length; i++) { h = ((h<<5)-h + s.charCodeAt(i)); h |= 0; }
      return Math.abs(h);
    }
    function deterministicClocksFor(staff, dateStr) {
      var S = getStorage();
      var key = staff.id + '_' + dateStr;
      try {
        var all = (S && S._get && S.KEYS && S.KEYS.ATTENDANCE_CLOCKS_V2) ? (S._get(S.KEYS.ATTENDANCE_CLOCKS_V2) || {}) : {};
        if (Array.isArray(all[key]) && all[key].length) return all[key].slice();
      } catch(e) {}
      // 无真实打卡（考勤机 ISAPI / 手工录入）时返回空，不再伪随机造假
      return [];
    }
    function staffNameById(id) {
      try {
        var remote = window.__ATT_V2_STAFF__ || [];
        for (var r = 0; r < remote.length; r++) if (remote[r].id === id) return remote[r].name || id;
        var S = getStorage();
        var list = (S && S.Staff && S.Staff.list) ? S.Staff.list() : [];
        for (var i=0; i<list.length; i++) if (list[i].id === id) return list[i].name || id;
      } catch(e) {}
      return id;
    }
    // —— 安全的 prompt/confirm 封装（CSP/受限浏览器不支持 window.prompt/confirm 时，自动使用默认值，不抛异常）
    function _safePrompt(msg, def) {
      try {
        if (typeof window.prompt !== 'function') throw new Error('prompt() is not supported');
        var r = window.prompt(msg, (def === undefined ? '' : def));
        return (r === null || typeof r === 'string') ? r : (def === undefined ? '' : def);
      } catch (e) {
        try { console.warn('[AttV2UI] prompt fallback:', e.message || String(e), '默认值=', def); } catch(_) {}
        var fallback = (def === undefined ? '' : def);
        try {
          if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast('🔔 当前环境不支持 prompt 弹窗，已自动使用默认值（' + (fallback || '空') + '）', 'info', 2600);
          else if (typeof QinApp !== 'undefined' && QinApp.Utils && QinApp.Utils.toast) QinApp.Utils.toast('🔔 当前环境不支持 prompt 弹窗，已自动使用默认值', 'info', 2600);
          else if (typeof toast === 'function') toast('🔔 当前环境不支持 prompt 弹窗，已自动使用默认值', 'info', 2600);
        } catch(_) {}
        return fallback;
      }
    }
    function _safeConfirm(msg) {
      try {
        if (typeof window.confirm !== 'function') throw new Error('confirm() is not supported');
        return !!window.confirm(msg);
      } catch (e) {
        try { console.warn('[AttV2UI] confirm fallback:', e.message || String(e)); } catch(_) {}
        // 高危操作默认 false，避免静默误删
        var isDanger = /高危|删除|撤销|清空|覆盖|不可撤销|恢复|确定要/.test(String(msg||''));
        try {
          var m = isDanger ? '⚠️ 环境不支持确认弹窗，已自动取消本次高危操作（如需执行，请换浏览器或联系技术）' : '🔔 环境不支持确认弹窗，已自动使用默认值';
          if (typeof Utils !== 'undefined' && Utils.toast) Utils.toast(m, isDanger?'error':'info', 3000);
          else if (typeof QinApp !== 'undefined' && QinApp.Utils && QinApp.Utils.toast) QinApp.Utils.toast(m, isDanger?'error':'info', 3000);
        } catch(_) {}
        return isDanger ? false : true;
      }
    }
    // 真实演职人员 → V2 岗位八分类
      function roleToCategory(role, dept) {
        var r = String(role || ''), d = String(dept || '');
        if (/导演|编剧/.test(r)) return '编剧/导演';
        if (/乐队/.test(r)) return '乐队';
        if (/龙套|宫女|青袍|彩女/.test(r)) return '龙套';
        // 20261003 新行当口径（6 大行 23 角色 + 武场/文场）归一到考勤既有 8 类
        var std = window.QaxRoles ? window.QaxRoles.stdRole(r) : '';
        var map = {
          '文须生':'生角','武须生':'生角','小生':'生角','门官':'生角','家院':'生角',
          '正旦':'旦角','小旦':'旦角','彩旦':'旦角','二架旦':'旦角',
          '大花脸':'净角','二花脸':'净角',
          '丑角':'丑角',
          '武场':'乐队','文场':'乐队',
          '龙套':'龙套','校尉':'龙套','刀斧手':'龙套','丫鬟':'龙套','彩女':'龙套','长随官':'龙套',
          '帽箱':'后勤','电工':'后勤','前场':'后勤','衣箱':'后勤','剧务':'后勤'
        };
        if (map[std]) return map[std];
        if (/乐队/.test(d)) return '乐队';
        if (/舞美|后勤/.test(d)) return '后勤';
        return /演员/.test(d) ? '生角' : '后勤';
      }
      function mapPerformerToV2(p) {
        return {
          id: p.id,
          name: p.name,
          roleCategory: roleToCategory(p.primaryRole, p.employmentType),
          level: p.rankGrade || '',
          workNo: p.staffNo || '',
          phone: p.phone || '',
          status: p.status === 'inactive' ? 'off' : 'on'
        };
      }
      var AttV2UI = {
        state: { date: '', roleCategory: '', keyword: '', selectedIds: [] },
      init: function () {
        var self = this;
        var today = new Date();
        var y = today.getFullYear();
        var m = pad2(today.getMonth()+1);
        var d = pad2(today.getDate());
        this.state.date = y + '-' + m + '-' + d;
        try {
          var saved = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || '{}');
          if (saved && saved.date) this.state.date = saved.date;
          if (saved && saved.roleCategory) this.state.roleCategory = saved.roleCategory;
        } catch(e) {}
        if ($('attv2Date')) $('attv2Date').value = this.state.date;
        if ($('attv2RoleCategory')) $('attv2RoleCategory').value = this.state.roleCategory || '';
        if ($('attv2Date')) $('attv2Date').addEventListener('change', function () { self.state.date = this.value; self.saveState(); self.render(); });
        if ($('attv2RoleCategory')) $('attv2RoleCategory').addEventListener('change', function () { self.state.roleCategory = this.value; self.saveState(); self.render(); });
        if ($('attv2Keyword')) $('attv2Keyword').addEventListener('input', function (e) { self.state.keyword = e.target.value || ''; clearTimeout(self._kwT); self._kwT = setTimeout(function(){self.render();},180); });
        setTimeout(function () { self.render(); }, 220);
        this.loadRemoteStaff();
      },
      saveState: function () {
        try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ date: this.state.date, roleCategory: this.state.roleCategory })); } catch(e) {}
      },
      getFilteredStaff: function () {
        var arr = window.__ATT_V2_STAFF__ || [];
        var key = (this.state.keyword || '').trim();
        var rc = this.state.roleCategory || '';
        var out = [];
        for (var j=0; j<arr.length; j++) {
          var s = arr[j] || {};
          if (s.status === 'off') continue;
          if (rc && String(s.roleCategory||'').indexOf(rc) < 0) continue;
          if (key) {
            var hay = (s.name||'') + ' ' + (s.id||'') + ' ' + (s.phone||'') + ' ' + (s.workNo||'');
            if (hay.toLowerCase().indexOf(key.toLowerCase()) < 0) continue;
          }
          out.push(s);
        }
        return out;
      },
      // 从真实花名册 API 加载人员（无在册人员时缓存为空数组，表格显示空态）
      loadRemoteStaff: function () {
        var self = this;
        var API = window.QAXQJT_API;
        var apply = function (rows) {
          window.__ATT_V2_STAFF__ = (rows || [])
            .filter(function (p) { return p && p.name; })
            .map(mapPerformerToV2);
          self.render();
        };
        if (window.__PF_ROWS__ && window.__PF_ROWS__.length) { apply(window.__PF_ROWS__); return Promise.resolve(); }
        if (!API) { apply([]); return Promise.resolve(); }
        return API.get((QAXQJT_PATHS.PERFORMERS || '/v1/performers'), { query: { page: 1, pageSize: 500 }, showErrorToast: false, timeoutMs: 8000, fallbackRead: function () { return null; } })
          .then(function (res) {
            var rows = Array.isArray(res) ? res : (res && res.items) || [];
            window.__PF_ROWS__ = rows;
            apply(rows);
          })
          .catch(function () { apply([]); });
      },
      render: function () {
        var W = getW();
        if (!W) { setTimeout(function(){AttV2UI.render();},150); return; }
        var self = this;
        var date = this.state.date || (function(){var d=new Date();return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());})();
        var tbody = $('attv2Tbody');
        var auditBody = $('attv2AuditTbody');
        var accBody = $('attv2AccidentTbody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:32px;color:#aaa;">正在加载…</td></tr>';
        setTimeout(function () {
          try { self._doRender(W, date, tbody, auditBody, accBody); }
          catch (err) {
            console.error('[AttV2UI] render error:', err);
            if (tbody) tbody.innerHTML = '<tr><td colspan="15" style="text-align:center;color:#c0392b;padding:28px;">渲染异常：' + (err && err.message || String(err)) + '</td></tr>';
          }
        }, 10);
      },
      _doRender: function (W, date, tbody, auditBody, accBody) {
        var self = this;
        var staffList = this.getFilteredStaff();
        var rowsHtml = '';
        var summary = { total: staffList.length, zhuangtai: 0, fullSession: 0, halfSession: 0, zeroSession: 0, totalBase: 0, totalNet: 0, totalReward: 0, totalLateFine: 0, totalAccident: 0 };
        var selectedMap = {};
        for (var k=0;k<this.state.selectedIds.length;k++) selectedMap[this.state.selectedIds[k]] = true;
        for (var i=0;i<staffList.length;i++) {
          var st = staffList[i];
          var clocks = deterministicClocksFor(st, date);
          var wd = W.calcDailyWageV2(st, date, clocks);
          if (wd.manualTag === '装台' || wd.manualTag === '卸台') summary.zhuangtai++;
          if (wd.sessionCount === 2) summary.fullSession++;
          else if (wd.sessionCount === 1) summary.halfSession++;
          else summary.zeroSession++;
          summary.totalBase += wd.basePay || 0;
          summary.totalNet += wd.net || 0;
          summary.totalReward += wd.rewardCents || 0;
          summary.totalLateFine += wd.lateFineCents || 0;
          summary.totalAccident += wd.accidentFineCents || 0;
          var sel = selectedMap[st.id] ? ' checked' : '';
          var pmCell = wd.afternoonClock || '';
          var ntCell = wd.nightClock || '';
          var ratioHtml = wd.salaryRatio === -1 ? '<span class="badge" style="background:#6c757d;color:#fff;">装/卸</span>'
                        : (wd.salaryRatio >= 1 ? '<span style="color:#0e8c4e;font-weight:600;">100%</span>'
                           : (wd.salaryRatio > 0 ? '<span style="color:#fd7e14;font-weight:600;">50%</span>' : '<span style="color:#aaa;">0%</span>'));
          var tagColors = { '常规': '#17a2b8', '装台': '#fd7e14', '卸台': '#dc3912', '': '#6c757d' };
          var tagBg = tagColors[wd.manualTag] || '#6c757d';
          var netCell = wd.salaryRatio === -1
              ? '<span style="color:#888;font-style:italic;">不计</span>'
              : '<b style="color:#b45309;">' + fmtCents(wd.net) + '</b>';
          var rewardCell = (wd.rewardCents || 0) > 0
            ? '<span class="badge" style="background:#fff3cd;color:#856404;">⭐ ' + fmtCents(wd.rewardCents) + '</span>' : '<span style="color:#aaa;">—</span>';
          var lateCell = (wd.lateFineCents || 0) > 0
            ? '<span class="badge" style="background:#fde2e1;color:#c0392b;">⏱ '+fmtCents(wd.lateFineCents)+'</span>' : '<span style="color:#aaa;">—</span>';
          var accCell = (wd.accidentFineCents || 0) > 0
            ? '<span class="badge" style="background:#f8d7da;color:#842029;">⚠ '+fmtCents(wd.accidentFineCents)+'</span>' : '<span style="color:#aaa;">—</span>';
          var pmBadge = wd.afternoonValid
            ? (wd.afternoonLateMin > 0 ? '<span style="color:#dc3545;">迟'+wd.afternoonLateMin+'分</span>' : '<span style="color:#198754;">✓</span>')
            : (pmCell ? '<span style="color:#aaa;">无效/缺</span>' : '<span style="color:#aaa;">未打</span>');
          var ntBadge = wd.nightValid
            ? (wd.nightLateMin > 0 ? '<span style="color:#dc3545;">迟'+wd.nightLateMin+'分</span>' : '<span style="color:#198754;">✓</span>')
            : (ntCell ? '<span style="color:#aaa;">无效/缺</span>' : '<span style="color:#aaa;">未打</span>');
          var staffNo = st.workNo || st.employeeNo || st.id;
          var rk = st.roleCategory || '—'; var lv = st.level || '—';
          var selOpt = (wd.manualTag==='常规'||!wd.manualTag) ? ' selected' : '';
          var ztOpt = wd.manualTag==='装台' ? ' selected' : '';
          var xtOpt = wd.manualTag==='卸台' ? ' selected' : '';
          rowsHtml += '<tr data-staff-id="' + (st.id||'') + '">'
            + '<td style="text-align:center;"><input type="checkbox" class="attv2-cb" value="'+(st.id||'')+'"'+sel+' onchange="AttV2UI._onRowCheck(this)" /></td>'
            + '<td style="font-weight:600;color:#222;">' + (st.name||'未知') + '</td>'
            + '<td style="color:#555;">' + staffNo + '</td>'
            + '<td><span class="badge" style="background:#e7f1ff;color:#1257a8;">'+rk+'</span> <span style="margin-left:4px;color:#666;">'+lv+'</span></td>'
            + '<td style="font-family:Consolas,monospace;font-size:0.82rem;">' + (pmCell || '—') + '<div style="font-size:0.72rem;margin-top:2px;">'+pmBadge+'</div></td>'
            + '<td style="font-family:Consolas,monospace;font-size:0.82rem;">' + (ntCell || '—') + '<div style="font-size:0.72rem;margin-top:2px;">'+ntBadge+'</div></td>'
            + '<td style="text-align:center;font-weight:600;color:'+ (wd.sessionCount===2?'#0e8c4e':(wd.sessionCount===1?'#fd7e14':'#aaa')) +';">' + wd.sessionCount + ' 场</td>'
            + '<td style="text-align:center;">'+ratioHtml+'</td>'
            + '<td style="text-align:center;">' + (wd.salaryRatio===-1 ? '<span style="color:#aaa;">—</span>' : fmtCents(wd.basePay||0)) + '</td>'
            + '<td style="text-align:center;"><span class="badge" style="background:'+tagBg+';color:#fff;padding:4px 8px;">' + (wd.manualTag || '常规') + '</span></td>'
            + '<td style="text-align:center;">'+rewardCell+'</td>'
            + '<td style="text-align:center;">'+lateCell+'</td>'
            + '<td style="text-align:center;">'+accCell+'</td>'
            + '<td style="text-align:center;">' + netCell + '</td>'
            + '<td><div style="display:flex;gap:4px;flex-wrap:wrap;">'
              + '<select class="form-control form-control-sm" style="width:auto;padding:2px 6px;font-size:0.76rem;" onchange="AttV2UI._quickTag(\''+(st.id||'')+'\',this.value)">'
              + '<option value="常规"'+selOpt+'>常规</option>'
              + '<option value="装台"'+ztOpt+'>装台</option>'
              + '<option value="卸台"'+xtOpt+'>卸台</option>'
              + '</select>'
              + '<button class="btn btn-gold btn-xs" onclick="AttV2UI._quickReward(\''+(st.id||'')+'\')" title="标记表现突出">⭐奖励</button>'
              + '<button class="btn btn-xs" style="background:#f8d7da;color:#842029;" onclick="AttV2UI._quickAcc(\''+(st.id||'')+'\')" title="快速登记">⚠事故</button>'
              + '</div></td>'
            + '</tr>';
        }
        tbody.innerHTML = rowsHtml || '<tr><td colspan="15" style="text-align:center;padding:28px;color:#aaa;">暂无在册人员，请先在「人员花名册」录入真实演职人员</td></tr>';
        if ($('attv2SummaryTag')) {
          $('attv2SummaryTag').innerHTML = date + ' · 共'+summary.total+'人｜装/卸'+summary.zhuangtai+'人｜2场'+summary.fullSession+'｜1场'+summary.halfSession+'｜0场'+summary.zeroSession
            + '｜基础合计：<b style="color:#0e8c4e;">'+fmtCents(summary.totalBase)+'</b>'
            + '｜奖励：<b style="color:#856404;">'+fmtCents(summary.totalReward)+'</b>'
            + '｜迟到罚金：<b style="color:#c0392b;">'+fmtCents(summary.totalLateFine)+'</b>'
            + '｜事故罚金：<b style="color:#842029;">'+fmtCents(summary.totalAccident)+'</b>'
            + '｜当日实发合计：<b style="color:#b45309;font-size:1rem;">'+fmtCents(summary.totalNet)+'</b>';
        }
        this._updateSelectedCount();
        var audit = (W.getAuditLogs && W.getAuditLogs()) || [];
        var ah = '';
        for (var a = Math.max(0, audit.length - 500); a < audit.length; a++) {
          var it = audit[a] || {};
          var objStr = '';
          // 日期嵌在 before/after 对象内（如 {date,tag}），提取显示
          var _audDate = it.date || (it.before && it.before.date) || (it.after && it.after.date) || '';
          if (it.staffIds && it.staffIds.length) {
            var names = [];
            for (var ai=0; ai<it.staffIds.length && ai<5; ai++) names.push(staffNameById(it.staffIds[ai]));
            objStr = _audDate + ' · ' + names.join(',') + (it.staffIds.length > 5 ? ' 等'+it.staffIds.length+'人' : '');
          } else objStr = _audDate + ' · ' + (it.targetName||it.staffId||'');
          function _fmtAuditVal(v) {
            if (v == null) return '—';
            if (typeof v === 'string' || typeof v === 'number') return String(v);
            if (typeof v === 'object') {
              if (v.tag) return v.tag;
              if (v.reward != null) return '奖励¥' + (Number(v.reward)/100).toFixed(2);
              if (v.level != null) return '事故' + ({1:'一级',2:'二级',3:'三级'}[v.level]||v.level) + ' ¥' + (Number(v.fine||0)/100).toFixed(2) + (v.desc ? '（'+v.desc+'）' : '');
              if (v.sampleBefore) return '批量改前';
              if (v.sampleAfter) return '批量改后';
              try { return JSON.stringify(v); } catch(_) { return String(v); }
            }
            return String(v);
          }
          var chg = _fmtAuditVal(it.before) + ' → ' + _fmtAuditVal(it.after);
          // 备注：审计存储字段为 extra（可能含 reason/remark/operator 等）
          var _audRemark = '';
          if (it.remark) _audRemark = String(it.remark);
          else if (it.extra) {
            if (typeof it.extra === 'string') _audRemark = it.extra;
            else if (it.extra.reason) _audRemark = it.extra.reason;
            else if (it.extra.remark) _audRemark = it.extra.remark;
            else if (it.extra.operator) _audRemark = '操作人:'+it.extra.operator;
          }
          ah += '<tr><td style="white-space:nowrap;color:#555;">' + fmtTS(it.ts) + '</td><td>' + (it.operator||'') + '</td><td style="word-break:break-all;">' + objStr + '</td><td><b>'+(it.action||'')+'</b> '+chg+'</td><td style="color:#666;">' + _audRemark + '</td></tr>';
        }
        if (auditBody) { auditBody.innerHTML = ah || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#aaa;">暂无操作日志</td></tr>'; }
        if ($('attv2AuditCount')) $('attv2AuditCount').textContent = String(audit.length);
        var acc = (W.getAccidentFines && W.getAccidentFines(date)) || [];
        var accHtml = '';
        var lvText = { 1: '一级', 2: '二级', 3: '三级' };
        for (var b=0; b<acc.length; b++) {
          var ac = acc[b] || {};
          accHtml += '<tr><td>' + staffNameById(ac.staffId) + '</td>'
            + '<td><span class="badge" style="background:'+(ac.level==3?'#842029':(ac.level==2?'#b45309':'#fd7e14'))+';color:#fff;">' + (lvText[ac.level]||'—') + '</span></td>'
            + '<td>' + fmtCents(ac.fine||0) + '</td>'
            + '<td style="font-size:0.8rem;color:#666;">' + (ac.desc||'') + '</td>'
            + '<td style="color:#888;font-size:0.78rem;">' + (ac.ts ? fmtTS(ac.ts).slice(5) : '') + '</td></tr>';
        }
        if (accBody) accBody.innerHTML = accHtml || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#aaa;">当日暂无事故登记</td></tr>';
        // 每次重渲染都刷新 ISAPI 同步状态（面板信息）
        if (this.isapiRefreshStatus) { try { this.isapiRefreshStatus(); } catch(_e){} }
      },
      _onRowCheck: function (cb) {
        var id = cb && cb.value;
        if (!id) return;
        if (cb.checked) {
          if (this.state.selectedIds.indexOf(id) < 0) this.state.selectedIds.push(id);
        } else {
          this.state.selectedIds = this.state.selectedIds.filter(function(x){return x!==id;});
        }
        if ($('attv2CheckAll')) {
          var boxes = document.querySelectorAll('input.attv2-cb');
          var allChecked = true;
          for (var i=0;i<boxes.length;i++) { if (!boxes[i].checked) { allChecked=false; break; } }
          $('attv2CheckAll').checked = allChecked;
        }
        this._updateSelectedCount();
      },
      _updateSelectedCount: function () {
        if ($('attv2SelectedTag')) {
          var n = this.state.selectedIds.length;
          $('attv2SelectedTag').textContent = n > 0 ? ('已选 ' + n + ' 人') : '';
        }
      },
      toggleAll: function (cb) {
        var on = cb && cb.checked;
        var boxes = document.querySelectorAll('input.attv2-cb');
        var ids = [];
        for (var i=0;i<boxes.length;i++) {
          boxes[i].checked = !!on;
          if (on) ids.push(boxes[i].value);
        }
        this.state.selectedIds = on ? ids : [];
        this._updateSelectedCount();
      },
      _getSelected: function () {
        var ids = this.state.selectedIds && this.state.selectedIds.length ? this.state.selectedIds.slice() : [];
        return ids;
      },
      _requireSelected: function (tip) {
        var ids = this._getSelected();
        if (!ids.length) { alert('请先在表格上方勾选需要' + (tip||'操作') + '的人员'); return null; }
        return ids;
      },
      batchTag: function () {
        var W = getW(); if (!W) return;
        // 🔧 R9 FIX：批量操作防抖
        if (window.__OP_LOCKS && window.__OP_LOCKS.attV2_batchTag) { alert('⏳ 批量标记处理中，请稍候…'); return; }
        try { if (!window.__OP_LOCKS) window.__OP_LOCKS = {}; window.__OP_LOCKS.attV2_batchTag = true; setTimeout(function(){try{delete window.__OP_LOCKS.attV2_batchTag;}catch(_){}}, 900); } catch(_lk){}
        var ids = this._requireSelected('批量标记');
        if (!ids) return;
        var tag = $('attv2BatchTagType') ? $('attv2BatchTagType').value : '常规';
        var op = currentUser();
        var remark = _safePrompt('批量标记备注（可选）：', '');
        var ok = W.batchSetManualTag(ids, this.state.date, tag, { operator: op, remark: (remark===null ? '' : remark) });
        if (ok === false) { alert('标记失败：装台/卸台日存在奖励或事故，请先撤销对应奖励/事故后再操作'); }
        else alert('批量标记成功（' + tag + '），共 ' + ids.length + ' 人');
        this.render();
      },
      batchReward: function () {
        var W = getW(); if (!W) return;
        // 🔧 R9 FIX：批量奖励防抖（防快速连点2次重复发奖金）
        if (window.__OP_LOCKS && window.__OP_LOCKS.attV2_batchReward) { alert('⏳ 批量奖励处理中，请稍候…'); return; }
        try { if (!window.__OP_LOCKS) window.__OP_LOCKS = {}; window.__OP_LOCKS.attV2_batchReward = true; setTimeout(function(){try{delete window.__OP_LOCKS.attV2_batchReward;}catch(_){}}, 900); } catch(_lk){}
        var ids = this._requireSelected('批量奖励');
        if (!ids) return;
        var remark = _safePrompt('批量表现突出奖励备注（5元/人·天，可留空）：', '批量评定：表现突出');
        var op = currentUser();
        var okN = 0, failN = 0;
        for (var i=0; i<ids.length; i++) {
          var rr = W.setDayRewardTag(ids[i], this.state.date, true, { operator: op, remark: (remark===null?'':remark) });
          if (rr) okN++; else failN++;
        }
        alert('批量奖励完成：成功 ' + okN + ' 人' + (failN>0?('，失败 '+failN+' 人（装台/卸台日不允许奖励或已有奖励或系统异常）'):''));
        this.render();
      },
      batchAccident: function () {
        var W = getW(); if (!W) return;
        // 🔧 R9 FIX：批量事故防抖（防快速连点2次重复登记事故扣工资）
        if (window.__OP_LOCKS && window.__OP_LOCKS.attV2_batchAcc) { alert('⏳ 批量事故登记处理中，请稍候…'); return; }
        try { if (!window.__OP_LOCKS) window.__OP_LOCKS = {}; window.__OP_LOCKS.attV2_batchAcc = true; setTimeout(function(){try{delete window.__OP_LOCKS.attV2_batchAcc;}catch(_){}}, 900); } catch(_lk){}
        var ids = this._requireSelected('批量事故登记');
        if (!ids) return;
        var lvStr = $('attv2AccLevel') ? $('attv2AccLevel').value : '1';
        var lv = parseInt(lvStr, 10) || 1;
        var desc = _safePrompt('事故描述（必填）：', '演出失误记录');
        if (desc === null) return;
        if (!String(desc||'').trim()) { alert('请填写事故描述'); return; }
        var op = currentUser();
        for (var i=0; i<ids.length; i++) {
          W.addAccidentFine(ids[i], this.state.date, lv, String(desc||''), op);
        }
        alert('已批量登记 ' + ids.length + ' 条 ' + ({1:'一级',2:'二级',3:'三级'}[lv]) + ' 事故');
        this.render();
      },
      _quickTag: function (staffId, tag) {
        var W = getW(); if (!W || !staffId) return;
        var op = currentUser();
        var ok = W.setAdminManualTag(staffId, this.state.date, tag, { operator: op, remark: '快速标记' });
        if (ok === false) alert('标记失败：该员工当日存在奖励/事故记录，先撤销奖励/事故后再切换到装/卸');
        this.render();
      },
      _quickReward: function (staffId) {
        var W = getW(); if (!W || !staffId) return;
        var op = currentUser();
        var cur = W.getDayRewardTag(staffId, this.state.date);
        if (cur && cur.reward) {
          if (_safeConfirm(staffNameById(staffId)+' 当日已登记过表现突出，是否撤销？')) {
            W.setDayRewardTag(staffId, this.state.date, false, { operator: op, remark: '撤销表现突出' });
          }
        } else {
          var r = _safePrompt('表现突出奖励（5元/天）备注：', '排练/演出表现突出');
          if (r === null) return;
          var ok = W.setDayRewardTag(staffId, this.state.date, true, { operator: op, remark: r });
          if (!ok) alert('奖励登记失败：该员工当日被标记为装台/卸台，不参与评优');
        }
        this.render();
      },
      _quickAcc: function (staffId) {
        var W = getW(); if (!W || !staffId) return;
        var lvStr = _safePrompt('事故级别 1/2/3（一级=10 二级=30 三级=50）：', '1');
        if (lvStr === null) return;
        var lv = parseInt(lvStr, 10);
        if (!lv || lv < 1 || lv > 3) lv = 1;
        var desc = _safePrompt('事故描述：', '');
        if (desc === null) return;
        var op = currentUser();
        W.addAccidentFine(staffId, this.state.date, lv, String(desc||''), op);
        alert('已登记 ' + staffNameById(staffId) + ' ' + ({1:'一级',2:'二级',3:'三级'}[lv]) + ' 事故');
        this.render();
      },
      clearAudit: function () {
        if (!_safeConfirm('确认清空全部操作日志？（仅清空审计日志，不影响实际标记/奖罚数据）')) return;
        var W = getW(); if (W && W.clearAuditLogs) W.clearAuditLogs();
        this.render();
      },
      exportCsv: function () {
        var W = getW(); if (!W) return;
        var date = this.state.date;
        var list = this.getFilteredStaff();
        var rows = [['日期','姓名','工号','岗位','等级','日场打卡时间','晚场打卡时间','有效场次','薪资比例','当日基本工资','奖励金额','迟到罚款','事故罚款','当日小计','管理员标记类型','备注']];
        function _c(v){ if (v==null||v===undefined) return ''; var s=String(v).replace(/"/g,'""'); return /[",\n]/.test(s)?('"'+s+'"'):s;}
        function yuan(c) { return c===null||c===undefined||c===-1 ? '' : (Number(c)/100).toFixed(2); }
        for (var i=0; i<list.length; i++) {
          var st = list[i];
          var clocks = deterministicClocksFor(st, date);
          var wd = W.calcDailyWageV2(st, date, clocks);
          var ratioStr = wd.salaryRatio === -1 ? '不计' : ((wd.salaryRatio*100).toFixed(0)+'%');
          rows.push([
            date, _c(st.name||''), _c(st.workNo||st.id||''), _c(st.roleCategory||''), _c(st.level||''),
            _c(wd.afternoonClock||''), _c(wd.nightClock||''), String(wd.sessionCount||0), ratioStr,
            wd.salaryRatio === -1 ? '' : yuan(wd.basePay||0),
            yuan(wd.rewardCents||0), yuan(wd.lateFineCents||0), yuan(wd.accidentFineCents||0),
            wd.salaryRatio === -1 ? '不计' : yuan(wd.net||0),
            _c(wd.manualTag||'常规'), ''
          ]);
        }
        var csv = '\uFEFF' + rows.map(function(r){return r.join(',');}).join('\r\n');
        var blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'V2考勤报表_' + date + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function(){ try { URL.revokeObjectURL(a.href); } catch(e){} }, 2000);
      },

      // ---- ISAPI 对接调试面板 4 个方法 ----
      isapiRefreshStatus: function () {
        var W = getW(); if (!W || !W.isapi) return;
        try {
          var s = W.isapi.syncStatus();
          var hint = $('isapiStatusHint');
          var badge = $('isapiVendorBadge');
          var info = $('isapiSyncInfo');
          if (hint) { hint.textContent = s.lastSyncAt ? '已同步 ✓' : '未导入数据'; }
          if (badge) {
            var map = {hikvision:'海康 ISAPI', tencent:'腾讯云人脸', generic:'通用脚本'};
            badge.textContent = s.vendor ? '厂商：' + (map[s.vendor] || s.vendor) : '';
          }
          if (info) {
            var when = s.lastSyncAt ? new Date(s.lastSyncAt) : null;
            var whenStr = when ? (when.getFullYear()+'-'+String(when.getMonth()+1).padStart(2,'0')+'-'+String(when.getDate()).padStart(2,'0')+' '+String(when.getHours()).padStart(2,'0')+':'+String(when.getMinutes()).padStart(2,'0')+':'+String(when.getSeconds()).padStart(2,'0')) : '-';
            info.innerHTML = '⏱ 最近同步：<b style="color:#0f172a;">' + whenStr + '</b> &nbsp;｜ 累计写入打卡：<b style="color:#0f172a;">' + (s.totalIngested||0) + ' 条</b>';
          }
        } catch (e) { if (window.console && console.warn) console.warn('[isapi] refreshStatus fail:', e); }
      },
      isapiImport: function () {
        var W = getW(); if (!W || !W.isapi) { alert('WageEngine v2 未加载'); return; }
        var ta = $('isapiRawJson');
        if (!ta || !ta.value.trim()) { alert('请先粘贴 JSON 数组到文本框'); return; }
        var arr;
        try {
          var raw = ta.value.trim();
          if (raw.charAt(0) !== '[') raw = '[' + raw.replace(/;*$/,'') + ']';
          arr = (new Function('return (' + raw + ');'))();
          if (!Array.isArray(arr)) throw new Error('解析结果不是数组');
        } catch (e) { alert('JSON 格式错误：' + e.message); return; }
        var vendor = ($('isapiVendor') || {}).value || 'generic';
        var dayShift = Number(($('isapiDayShift') || {}).value); if (isNaN(dayShift)) dayShift = 4;
        var discardOut = Number(($('isapiDiscardOut') || {}).value) !== 0;
        var self = this;
        try {
          var r = W.isapi.ingestClockRecords(arr, {vendor: vendor, dayShiftHours: dayShift, discardClockOut: discardOut, operator: 'admin_ui'});
          var el = $('isapiLastResult');
          if (el) {
            el.innerHTML = '✅ 导入完成：新增 <b style="color:#0a0;">' + r.ingested + '</b> 条（重复:'+r.skipped.dup+'，下班丢弃:'+r.skipped.clockOut+'，无效时间:'+r.skipped.invalidTime+'，无效人员:'+r.skipped.invalidStaff+'），覆盖 ' + r.distinctStaffDays + ' 个[员工×日]';
          }
          this.isapiRefreshStatus();
          setTimeout(function(){self.render();}, 120);
        } catch (e) { alert('导入失败：' + e.message); }
      },
      isapiMock: function (n) {
        var W = getW(); if (!W || !W.isapi) { alert('WageEngine v2 未加载'); return; }
        // 🔧 R9 FIX：模拟生成防抖（防快速连点2次100条重复生成→200条脏数据）
        if (window.__OP_LOCKS && window.__OP_LOCKS.attV2_isapiMock) { alert('⏳ 打卡模拟生成中，请稍候…'); return; }
        try { if (!window.__OP_LOCKS) window.__OP_LOCKS = {}; window.__OP_LOCKS.attV2_isapiMock = true; setTimeout(function(){try{delete window.__OP_LOCKS.attV2_isapiMock;}catch(_){}}, 1200); } catch(_lk){}
        if (!_safeConfirm('⚠️ 将生成 ' + (n||50) + ' 条【模拟】打卡记录用于设备调试，并非真实考勤。确定继续吗？（正式考勤请用考勤机导入）')) return;
        var staffIds = (this.getFilteredStaff && this.getFilteredStaff().slice(0, 16).map(function(s){return s.id||s.workNo;})) || null;
        var vendor = ($('isapiVendor') || {}).value || 'generic';
        var dayShift = Number(($('isapiDayShift') || {}).value); if (isNaN(dayShift)) dayShift = 4;
        var discardOut = Number(($('isapiDiscardOut') || {}).value) !== 0;
        var arr = W.isapi.mockRawRecords(n || 50, vendor, staffIds);
        var self = this;
        try {
          var r = W.isapi.ingestClockRecords(arr, {vendor: vendor, dayShiftHours: dayShift, discardClockOut: discardOut, operator: 'admin_ui_mock'});
          var el = $('isapiLastResult');
          if (el) {
            el.innerHTML = '🎲 模拟 ' + (n||50) + ' 条完成：新增 <b style="color:#0a0;">' + r.ingested + '</b> 条（丢弃下班:'+r.skipped.clockOut+'，去重:'+r.skipped.dup+'），覆盖 ' + r.distinctStaffDays + ' 个[员工×日]';
          }
          this.isapiRefreshStatus();
          setTimeout(function(){self.render();}, 120);
        } catch (e) { alert('模拟失败：' + e.message); }
      },
      isapiClear: function () {
        var W = getW(); if (!W || !W.isapi) { alert('WageEngine v2 未加载'); return; }
        // 🔧 R9 FIX：清空打卡防抖（防快速连点2次confirm弹窗→确认后被误清空第二次）
        if (window.__OP_LOCKS && window.__OP_LOCKS.attV2_isapiClear) { alert('⏳ 清空处理中，请稍候…'); return; }
        try { if (!window.__OP_LOCKS) window.__OP_LOCKS = {}; window.__OP_LOCKS.attV2_isapiClear = true; setTimeout(function(){try{delete window.__OP_LOCKS.attV2_isapiClear;}catch(_){}}, 1000); } catch(_lk){}
        if (!confirm('确认清空所有 ISAPI 导入的打卡记录？（只清 CLOCKS_V2，不影响奖罚/装台标记/审计日志）')) return;
        try {
          var n = W.isapi.clearClocks();
          var el = $('isapiLastResult');
          if (el) { el.innerHTML = '🗑 已清空打卡：删除 ' + n + ' 个[员工×日] 组合'; }
          this.isapiRefreshStatus();
          var self = this; setTimeout(function(){self.render();}, 120);
        } catch (e) { alert('清空失败：' + e.message); }
      }
    };
    window.AttV2UI = AttV2UI;
    if (document.readyState === 'complete' || document.readyState === 'interactive') { setTimeout(function(){AttV2UI.init();}, 0); }
    else document.addEventListener('DOMContentLoaded', function () { AttV2UI.init(); });
  })();
  // =============================================================================
  // 🔧 E3 FIX：staff.html（演职人员管理）全按钮绑定 + 去抖锁
  //   修复用户反馈的"按钮不起作用 / 已禁用弹窗不关闭"
  // =============================================================================

/* ===== staff.html inline block (run 3, #4/8) ===== */
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
      // 修复：模态框内的按钮跳过 DBF 兜底，让事件传播到模态框真实 handler（保存/取消/关闭）
      try{
        if(btn.closest && (btn.closest('.modal-mask, .generic-modal-root, .modal-overlay-root, [role="dialog"]') || btn.closest('[id$="Modal"], [id$="modal"]'))) return;
        if(btn.hasAttribute && (btn.hasAttribute('data-modal-act') || btn.hasAttribute('data-modal-close'))) return;
      }catch(_mskip){}
      // 跳过已有 onclick / 正常href跳转 / 已在脚本中手动绑定过（__bindDone=1 或 __ctE2Done=1）的按钮
      // 注意：data-action仅作为标识，不代表已绑定事件；父元素检查仅对onclick生效
      try{
  function __btnHasBound(btn){
    if(!btn) return false;
    if(btn.__superPatchBound) return true;
    if(typeof btn.onclick === 'function') return true; // 修复：JS property 绑定的 onclick 也算已绑定，禁止 DBF 兜底拦截（曾导致行按钮第一次点击被吞）
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
        __T('该功能暂未接入后端','warning'); console.warn('[P1] 未接线按钮:', txt||'保存');
        btn.__ctE2Done = 1; try { e.stopPropagation(); } catch(_b){} return;
      }
      if(isEdit){
        if(!__L(doneKey,700)) return;
        __pLog('DBF','edit_open', Object.assign({},__pEvt,{row:trKey, branch:'edit'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning'); console.warn('[P1] 未接线按钮:', txt||'编辑');
        btn.__ctE2Done = 1; return;
      }
      if(isDel){
        if(!__L(doneKey,850)) { __T('⏳ 删除处理中…','warning'); try { e.stopPropagation(); } catch(_a){} return; }
        __pLog('DBF','delete_confirm', Object.assign({},__pEvt,{row:trKey, branch:'delete'}));
        /* P1修复:假成功已移除（假confirm与假删除DOM行一并移除） */
        __T('该功能暂未接入后端','warning'); console.warn('[P1] 未接线按钮:', txt||'删除');
        btn.__ctE2Done = 1; try { e.stopPropagation(); } catch(_b){} return;
      }
      if(isView){
        if(!__L(doneKey,500)) return;
        __pLog('DBF','view_detail', Object.assign({},__pEvt,{row:trKey, branch:'view'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning'); console.warn('[P1] 未接线按钮:', txt||'查看');
        btn.__ctE2Done = 1; return;
      }
      if(isVerify){
        if(!__L(doneKey,900)) { __T('⏳ 核销处理中…','warning'); return; }
        __pLog('DBF','verify_confirm', Object.assign({},__pEvt,{row:trKey, branch:'verify'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning'); console.warn('[P1] 未接线按钮:', txt||'核销');
        btn.__ctE2Done = 1; return;
      }
      if(isExport){
        if(!__L(doneKey,1200)) { __T('⏳ 正在导出，请稍候…','warning'); return; }
        __pLog('DBF','export_start', Object.assign({},__pEvt,{row:trKey, branch:'export'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning'); console.warn('[P1] 未接线按钮:', txt||'导出');
        btn.__ctE2Done = 1; return;
      }
      if(isAdd){
        if(!__L(doneKey,900)) return;
        __pLog('DBF','add_new', Object.assign({},__pEvt,{branch:'add'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning'); console.warn('[P1] 未接线按钮:', txt||'新增');
        btn.__ctE2Done = 1; return;
      }
      // ---- 新增：审核/审批/驳回/通过 ----
      var isAudit = txt.indexOf('审核')>=0 || txt.indexOf('审批')>=0 || txt.indexOf('驳回')>=0 || txt.indexOf('通过')>=0;
      if(isAudit){
        if(!__L(doneKey,850)){ __T('⏳ 审核处理中…','warning'); try{e.stopPropagation();}catch(_a){} return; }
        var act = (txt.indexOf('驳回')>=0)?'驳回':(txt.indexOf('通过')>=0?'通过':'审核');
        __pLog('DBF','audit_result', Object.assign({},__pEvt,{row:trKey, branch:'audit', action:act}));
        /* P1修复:假成功已移除（假confirm一并移除） */
        __T('该功能暂未接入后端','warning'); console.warn('[P1] 未接线按钮:', txt||'审核');
        btn.__ctE2Done=1; try{e.stopPropagation();}catch(_b){} return;
      }
      // ---- 新增：签约/签订 ----
      var isSign = txt.indexOf('签约')>=0 || txt.indexOf('签订')>=0 || (txt.indexOf('签')>=0 && txt.indexOf('约')>=0);
      if(isSign){
        if(!__L(doneKey,900)){ __T('⏳ 签约流程处理中…','warning'); try{e.stopPropagation();}catch(_a){} return; }
        __pLog('DBF','sign_confirm', Object.assign({},__pEvt,{row:trKey, branch:'sign'}));
        /* P1修复:假成功已移除（假confirm一并移除） */
        __T('该功能暂未接入后端','warning'); console.warn('[P1] 未接线按钮:', txt||'签约');
        btn.__ctE2Done=1; try{e.stopPropagation();}catch(_b){} return;
      }
      // ---- 新增：合同/生成合同 ----
      var isContract = txt.indexOf('合同')>=0 && !isSign;
      if(isContract){
        if(!__L(doneKey,1000)){ __T('⏳ 正在准备合同文档…','warning'); return; }
        __pLog('DBF','contract_ready', Object.assign({},__pEvt,{row:trKey, branch:'contract'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning'); console.warn('[P1] 未接线按钮:', txt||'合同');
        btn.__ctE2Done=1; return;
      }
      // ---- 新增：排期/排班/安排档期 ----
      var isScheduleBtn = txt.indexOf('排期')>=0 || txt.indexOf('排班')>=0 || (txt.indexOf('安排')>=0 && (txt.length<=8 || txt.indexOf('档期')>=0));
      if(isScheduleBtn){
        if(!__L(doneKey,800)){ __T('⏳ 正在打开排期面板…','warning'); return; }
        __pLog('DBF','schedule_open', Object.assign({},__pEvt,{row:trKey, branch:'schedule'}));
        /* P1修复:假成功已移除 */
        __T('该功能暂未接入后端','warning'); console.warn('[P1] 未接线按钮:', txt||'排期');
        btn.__ctE2Done=1; return;
      }
      // ---- 新增：取消/处理/确认接单 ----
      var isCancelOrHandle = txt.indexOf('取消')>=0 || txt.indexOf('处理')>=0 || txt.indexOf('确认接单')>=0 || txt.indexOf('派工')>=0;
      if(isCancelOrHandle && !isDel && !isSave){
        if(!__L(doneKey,800)){ __T('⏳ 处理中…','warning'); try{e.stopPropagation();}catch(_a){} return; }
        var chBranch = txt.indexOf('取消')>=0?'cancel':(txt.indexOf('确认接单')>=0?'accept':(txt.indexOf('派工')>=0?'dispatch':'handle'));
        __pLog('DBF','status_change', Object.assign({},__pEvt,{row:trKey, branch:chBranch}));
        /* P1修复:假成功已移除（假confirm一并移除） */
        __T('该功能暂未接入后端','warning'); console.warn('[P1] 未接线按钮:', txt||'处理');
        btn.__ctE2Done=1; try{e.stopPropagation();}catch(_b){} return;
      }

    }, true);
    console.info('[DeadButtonFallback 已加载：×兜底 + 保存/编辑/删除/查看/核销/导出/新增 死按钮兜底委托]');
    try{ window.__T = __T; window.__L = __L; }catch(_){}
  })();
  
} /* end of 防重复注入保护 if */

/* ===== staff.html inline block (run 3, #5/8) ===== */
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
        /* P1修复:假成功已移除 —— 档案附件上传表单已接真实上传（见下方上传接线块），跳过本兜底拦截 */
        if(form.id === 'staffAttachForm') return;
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
        /* P1修复:假成功已移除 —— 校验通过但该表单无真实提交实现，仅如实提示 */
        __toastH9('该功能暂未接入后端','warning');
        console.warn('[P1] 未接线表单:', form.id || form.name || '未命名表单');
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
        // 修复：已有真实绑定（inline onclick attribute / JS property）的关闭按钮直接放行，交给原 handler 干净地关弹窗
        try{
          var cb = el.closest ? el.closest('button, a, [role="button"]') : null;
          if (cb && (typeof cb.onclick === 'function' || ((cb.getAttribute && cb.getAttribute('onclick')) || '').length > 3)) return;
        }catch(_c3s){}
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
        // 修复：pagination.js 已提供真分页（含真实翻页逻辑）时，本补丁的假分页工具栏绝不注入——
        // 曾把 .pagination-bar 当作待标准化容器：innerHTML='' 清空真控件后塞入只改计数器不切行的假分页 → “点页码表格不动”
        if (window.QinPagination) return;
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
    function __bindBtn(id, fn){ var el=document.getElementById(id); if(el&&!el.__ub){ el.__ub=1; el.__superPatchBound=1; el.__deadBtnChecked=1; el.addEventListener("click", fn, true); } }
    /* P1修复:假成功已移除 —— 「选择档案」改为打开真实档案表单的文件选择框（不再假弹"已选择"） */
    __bindBtn('openStaffUploadBtn', function(){
      var inp = document.getElementById('staffAttachFiles');
      var wrap = inp && inp.closest ? inp.closest('[data-upload-wrap]') : null;
      if (wrap && wrap.scrollIntoView) { try{ wrap.scrollIntoView({behavior:'smooth', block:'center'}); }catch(_sc){} }
      if (inp) inp.click();
      else console.warn('[P1] 未找到 staffAttachFiles 输入框');
    });
    /* P1上传接线 v20261004：档案附件表单接入真实上传 POST /v1/upload（multipart 字段 file）
       与 /v1/upload/multi（多文件字段 files），证件照成功后 PATCH /v1/performers/:id 写入 avatarUrl
       （schema: performers_db_v1.avatar_url，performers.js 更新白名单含 avatarUrl）。失败弹真实错误。 */
    var __stfForm = document.getElementById('staffAttachForm');
    if (__stfForm && !__stfForm.__realUploadBound) {
      __stfForm.__realUploadBound = 1;
      var __fbtns = __stfForm.querySelectorAll('button');
      for (var __fbi=0; __fbi<__fbtns.length; __fbi++){ __fbtns[__fbi].__superPatchBound=1; __fbtns[__fbi].__deadBtnChecked=1; __fbtns[__fbi].__bindDone=1; }
      __stfForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        var API = window.QAXQJT_API;
        var fileInput = document.getElementById('staffAttachFiles');
        var staffSel = __stfForm.querySelector('select[name="staffId"]');
        var typeSel = __stfForm.querySelector('select[name="staffDocType"]');
        var files = (fileInput && fileInput.files) ? Array.prototype.slice.call(fileInput.files) : [];
        var toast = function(msg, type){ if (typeof __toastH9 === 'function') { __toastH9(msg, type||'info'); } else if (typeof window.__T === 'function') { window.__T(msg, type||'info'); } else { console.log('[upload]', msg); } };
        if (!API || typeof API.post !== 'function') { toast('上传服务不可用：API 未就绪','error'); return false; }
        if (!staffSel || !staffSel.value) { toast('请先选择关联人员','error'); if (staffSel) staffSel.focus(); return false; }
        if (!files.length) { toast('请先选择要上传的附件文件','error'); if (fileInput) fileInput.focus(); return false; }
        for (var __fi=0; __fi<files.length; __fi++){ if (files[__fi].size > 10*1024*1024) { toast('文件超过10MB限制：'+files[__fi].name,'error'); return false; } }
        var docType = typeSel ? typeSel.value : 'id_photo';
        var isPhoto = (docType === 'id_photo');
        toast('⏳ 正在上传 '+files.length+' 个附件…','info');
        var upPromise;
        if (files.length === 1) {
          var fd = new FormData(); fd.append('file', files[0]);
          upPromise = API.post((QAXQJT_PATHS.UPLOAD || '/v1/upload'), fd, { showErrorToast:false }).then(function(d){ return [d]; });
        } else {
          var fdm = new FormData();
          for (var __mi=0; __mi<files.length; __mi++){ fdm.append('files', files[__mi]); }
          upPromise = API.post((QAXQJT_PATHS.UPLOAD_MULTI || '/v1/upload/multi'), fdm, { showErrorToast:false }).then(function(d){
            return (d && d.files) ? d.files : (Array.isArray(d) ? d : [d]);
          });
        }
        upPromise.then(function(list){
          var first = (list && list[0]) || {};
          if (isPhoto && first.url && staffSel.value) {
            return API.patch((QAXQJT_PATHS.PERFORMERS_BY_ID || function (i) { return '/v1/performers/' + i; })(encodeURIComponent(staffSel.value)), { avatarUrl: first.url }, { showErrorToast:false }).then(function(){
              toast('✅ 证件照已上传并写入人员档案（avatarUrl）','success');
              fileInput.value = '';
            }).catch(function(err){
              console.warn('[staffAttachForm] 写回 avatarUrl 失败:', err);
              toast('文件已上传（'+(first.url||'')+'），但写回人员档案失败：'+(err && err.message ? err.message : '网络错误'),'warning');
              fileInput.value = '';
            });
          }
          toast('✅ 已上传 '+list.length+' 个附件到服务器'+(first.url ? '：'+first.url : ''),'success');
          fileInput.value = '';
        }).catch(function(err){
          console.warn('[staffAttachForm] upload fail:', err);
          toast('❌ 上传失败：'+(err && err.message ? err.message : '网络错误'),'error');
        });
        return false;
      });
      // 填充「关联人员」下拉（真实 /v1/performers 数据，含 staffNo·姓名）
      var __fillStaffOpts = function(){
        var A = window.QAXQJT_API;
        var sel = __stfForm.querySelector('select[name="staffId"]');
        if (!A || typeof A.get !== 'function' || !sel) return;
        A.get((QAXQJT_PATHS.PERFORMERS || '/v1/performers'), { query:{page:1,pageSize:500}, showErrorToast:false, fallbackRead:function(){ return null; } }).then(function(res){
          var rows = Array.isArray(res) ? res : (res && res.items) || [];
          if (!rows.length) return;
          var cur = sel.value;
          var html = '<option value="">请选择要补充档案的演职人员</option>';
          for (var __ri=0; __ri<rows.length; __ri++){
            var p = rows[__ri];
            var v = String(p.id==null?'':p.id).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
            var label = String((p.staffNo || p.id) + ' · ' + (p.name || '')).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            html += '<option value="' + v + '">' + label + '</option>';
          }
          sel.innerHTML = html;
          if (cur) sel.value = cur;
        }).catch(function(e){ console.warn('[staffAttachForm] 人员列表加载失败', e); });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __fillStaffOpts);
      else __fillStaffOpts();
    }
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
      if(typeof btn.onclick === 'function') return true; // 修复：JS property 绑定的 onclick 也算已绑定，禁止 SuperPatch 兜底拦截（曾导致行按钮第一次点击被吞）
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
        // 修复：分页条按钮由 pagination.js 自管，禁止 SuperPatch 兜底拦截
        if(btn.closest && btn.closest('.pagination-bar, .pagination')) return;
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
        /* P1修复:假成功已移除 —— 兜底命中的均为未接线按钮，统一如实提示 */
        if(tt==='save'){
          __pLog('SP','fallback_save', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
          console.warn('[P1] 未接线按钮:', txt||'保存');
        }else if(tt==='delete'){
          __pLog('SP','fallback_delete', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
          console.warn('[P1] 未接线按钮:', txt||'删除');
        }else if(tt==='view'){
          __pLog('SP','fallback_view', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
          console.warn('[P1] 未接线按钮:', txt||'查看');
        }else if(tt==='export'){
          __pLog('SP','fallback_export', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
          console.warn('[P1] 未接线按钮:', txt||'导出');
        }else if(tt==='schedule'){
          __pLog('SP','fallback_schedule', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
          console.warn('[P1] 未接线按钮:', txt||'排期');
        }else if(tt==='audit'){
          __pLog('SP','fallback_audit', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
          console.warn('[P1] 未接线按钮:', txt||'审核');
        }else if(tt==='contract'){
          __pLog('SP','fallback_contract', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
          console.warn('[P1] 未接线按钮:', txt||'合同');
        }else if(tt==='add'){
          __pLog('SP','fallback_add', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
          console.warn('[P1] 未接线按钮:', txt||'新增');
        }else{
          __pLog('SP','fallback_other', {branch:tt, txt:txt, row:trKey});
          __toastH9('该功能暂未接入后端','warning');
          console.warn('[P1] 未接线按钮:', txt);
        }
        return false;
      }catch(e6){ console.warn('[SuperPatch 6/6 click err]',e6); }
    }, true);
    console.info('[SuperPatch 6/6] 已激活 ✓');
  }catch(e){ console.warn('[SuperPatch 6/6 init err]',e); }

  console.info('['+PATCH_ID+'] 6合1超级补丁全部加载完毕 ✓');
})();

} /* end of 防重复注入保护 if */

/* ===== staff.html inline block (run 3, #6/8) ===== */
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

/* ===== staff.html inline block (run 3, #7/8) ===== */
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

/* ===== staff.html inline block (run 3, #8/8) ===== */
/* 按钮防拦截 v20260907j：为真实功能按钮预设 __superPatchBound，避免 DBF/SuperPatch 6/6 演示 toast 在 capture 阶段 stopPropagation 拦停真实弹窗（含无 id 按钮、动态重绘行 MutationObserver 补标） */
(function(){
  if(window.__BTN_GUARD_V2__) return; window.__BTN_GUARD_V2__=1;
  var SEL = 'button, a.btn, .btn, .btn-action, [role="button"], [data-action]';
  function __markBound(){
    try{
      var els=document.querySelectorAll(SEL);
      for(var i=0;i<els.length;i++){ var el=els[i]; try{ if(!el.__superPatchBound){ el.__superPatchBound=1; } }catch(_){} }
    }catch(_){}
  }
  function __boot(){
    __markBound();
    try{
      if(window.MutationObserver){
        var mo=new MutationObserver(function(){ try{ __markBound(); }catch(_){} });
        mo.observe(document.documentElement,{childList:true,subtree:true});
      }
    }catch(_){}
    setTimeout(__markBound,400); setTimeout(__markBound,1200); setTimeout(__markBound,3000);
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',__boot); }
  else { __boot(); }
})();
