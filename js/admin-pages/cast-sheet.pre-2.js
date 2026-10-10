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

/* ===== cast-sheet.html inline block (run 2, #3/8) ===== */
(function(){
  var LS_KEY = 'qaxqjt_cast_sheet_v3';
  var LS_PERFORMERS = 'qaxqjt_performers_v1';
  var $ = function(id){ return document.getElementById(id); };

  // 20260922 真实化：不再内置任何假演职人员；名单由 /v1/performers 同步
  var DEFAULT_PERFORMERS = {};
  // 行当口径（20261003 修订）：生行/丑行/净行/旦行 + 二架/角子/后勤，共 23 个角色岗；武场/文场单列
  var PERFORMER_CATS = ['文须生','武须生','小生','丑角','大花脸','二花脸','正旦','小旦','彩旦','二架旦','门官','家院','龙套','校尉','刀斧手','丫鬟','彩女','长随官','帽箱','电工','前场','剧务','衣箱','武场','文场'];
  function _bucketOf(role){
    var s = String(role||'');
    var rules = [
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
    for(var i=0;i<rules.length;i++){ if(rules[i][1].test(s)) return rules[i][0]; }
    return '前场';
  }
  function getFlatPerformers(){
    var list = [];
    Object.keys(DEFAULT_PERFORMERS).forEach(function(cat){
      DEFAULT_PERFORMERS[cat].forEach(function(p){
        list.push({name:p.name, skill:p.skill||'', note:p.note||'', category:cat});
      });
    });
    var seen = {}; var out = [];
    list.forEach(function(p){ var k = p.name+'|'+p.category; if(!seen[k]){ out.push(p); seen[k]=true; } });
    return out;
  }
  function initPerformersDB(){
    // 清除旧版本内置假数据缓存（_version<2）
    try{
      var raw0 = localStorage.getItem(LS_PERFORMERS);
      if(raw0){ var old = JSON.parse(raw0); if(!old || old._version !== 2){ localStorage.removeItem(LS_PERFORMERS); } }
    }catch(e){ try{ localStorage.removeItem(LS_PERFORMERS); }catch(_){} }
    syncPerformersFromApi();
  }
  function syncPerformersFromApi(){
    if(!(window.QAXQJT_API && QAXQJT_API.get)) return Promise.resolve();
    return QAXQJT_API.get('/v1/performers', { query:{ pageSize:500 } }).then(function(d){
      var items = Array.isArray(d) ? d : ((d && d.items) || []);
      var groups = {}; var flat = [];
      items.forEach(function(p){
        var name = p.name || p.performerName || '';
        if(!name) return;
        var role = p.primaryRole || p.roleCategory || p.role || '';
        var cat = _bucketOf(role);
        if(!groups[cat]) groups[cat] = [];
        groups[cat].push({ name:name, skill:role, note:'' });
        flat.push({ id:p.id||'', name:name, skill:role, note:'', category:cat });
      });
      try{ localStorage.setItem(LS_PERFORMERS, JSON.stringify({ _seededAt:new Date().toISOString(), _version:2, performers:groups, flat:flat })); }catch(e){}
      if(typeof renderPerformersDatalist === 'function'){ try{ renderPerformersDatalist(); }catch(e){} }
    }).catch(function(){ /* 未登录/无网络时保持空态，绝不造假数据 */ });
  }
  function loadPerformers(){
    try{
      var raw = localStorage.getItem(LS_PERFORMERS);
      if(raw){ var o = JSON.parse(raw); if(o && o._version === 2) return o; }
    }catch(e){}
    return { performers:{}, flat:[] };
  }

  var OPERA_CHARACTER_LIBRARY = [];
  var _realOperasCache = null;
  // 真实剧目库：/v1/plays/public（无需登录），结果缓存在 localStorage 供同步的 loadOperaLibrary 合并
  function syncRealOperas(){
    if(!(window.QAXQJT_API && QAXQJT_API.get)) return Promise.resolve();
    return QAXQJT_API.get('/v1/plays/public', { query:{ pageSize:200 }, showErrorToast:false, timeoutMs:12000 }).then(function(d){
      var items = Array.isArray(d) ? d : ((d && d.items) || []);
      var arr = items.map(function(p){
        var title = p.title || '';
        return { id:'real_'+(p.id||''), name:/《/.test(title)?title:('《'+title+'》'), category:p.genre||'传统本戏', duration:p.durationMinutes||'', synopsis:p.synopsis||'', playId:p.id||'', cast:[] };
      });
      _realOperasCache = arr;
      try{ localStorage.setItem('qaxqjt_real_plays_v1', JSON.stringify({ _version:1, ts:Date.now(), items:arr })); }catch(e){}
    }).catch(function(){ _realOperasCache = _realOperasCache || []; });
  }
  function _loadCachedRealOperas(){
    if(_realOperasCache) return _realOperasCache;
    try{ var raw = localStorage.getItem('qaxqjt_real_plays_v1'); if(raw){ var o = JSON.parse(raw); if(o && Array.isArray(o.items)){ _realOperasCache = o.items; return o.items; } } }catch(e){}
    return [];
  }

  function loadOperaLibrary(){
    var all = [].concat(_loadCachedRealOperas(), OPERA_CHARACTER_LIBRARY);
    try{
      var raw1 = localStorage.getItem('qaxqjt_plays');
      if(raw1){
        var arr1 = JSON.parse(raw1);
        if(Array.isArray(arr1)){
          arr1.forEach(function(p){
            var cat = p.category || '传统本戏';
            var dur = parseInt((p.duration||'').replace(/[^0-9]/g,''),10) || 90;
            var exist = all.some(function(x){ return x.name === p.name; });
            if(!exist){
              all.push({
                id: 'play_'+ (p.id || 'x'+Math.random().toString(36).slice(2,7)),
                name: p.name, category: cat, duration: dur, synopsis: p.synopsis || '',
                firstEra:'', copyright:'公有传统', rating:'⭐常演保留剧目',
                cast: p.characters ? p.characters.map(function(c){ return {role:c.name||c, type:c.type||guessTypeByName(c), actorA:'', actorB:'', actorC:'', note:''}; }) : defaultCastMini(2)
              });
            }
          });
        }
      }
    }catch(e){}
    try{
      var raw2 = localStorage.getItem('qaxqjt_admin_operas');
      if(raw2){
        var arr2 = JSON.parse(raw2);
        if(Array.isArray(arr2)){
          arr2.forEach(function(p){
            var nm = p['f0_剧目名称']; if(!nm) return;
            nm = /《/.test(nm) ? nm : ('《'+nm+'》');
            var cat = p['f1_剧目类型'] || '传统本戏';
            var dur = parseInt((p['f2_演出时长_分钟_']||'').replace(/[^0-9]/g,''),10) || 90;
            var exist = all.some(function(x){ return x.name === nm; });
            if(!exist){
              var chars = (p['f3_主要角色']||'').split(/[,，、\n]/).filter(function(x){return x.trim();});
              all.push({
                id: (p._id || 'adm_'+Math.random().toString(36).slice(2,7)),
                name:nm, category:cat, duration:dur, synopsis: p['f4_剧情简介_200字内_']||'',
                firstEra: p['f5_首演年代']||'', copyright: p['f6_版权归属']||'公有传统', rating: p['f7_参考评级']||'⭐常演保留剧目',
                cast: chars.length ? chars.map(function(c){ return {role:c.trim(), type:guessTypeByName(c.trim()), actorA:'', actorB:'', actorC:'', note:''}; }) : defaultCastMini(2)
              });
            }
          });
        }
      }
    }catch(e){}
    return all;
  }
  function guessTypeByName(name){
    // 新行当口径（20261002）：判定顺序
    // 1) 角子/二架显式角色名（龙套/校尉/刀斧手/门官/家院/丫鬟/彩女）
    // 2) 彩旦（婆/媒/奶最先分流）→ 3) 小旦 → 4) 正旦（女性通类）
    // 5) 大花脸 → 6) 二花脸 → 7) 武须生 → 8) 文须生 → 9) 丑角 → 10) 小生
    if(/刀斧手|刽子/.test(name)) return '刀斧手';
    if(/校尉|锦衣/.test(name)) return '校尉';
    if(/门官/.test(name)) return '门官';
    if(/家院|老管家|老仆/.test(name)) return '家院';
    if(/丫鬟|丫环|使女/.test(name)) return '丫鬟';
    if(/彩女|宫娥/.test(name)) return '彩女';
    if(/长随官|长随/.test(name)) return '长随官';
    if(/龙套|青袍|文堂/.test(name)) return '龙套';
    if(/帽箱|盔箱|盔头|盔|戏帽|帽倌/.test(name)) return '帽箱';
    if(/衣箱|箱倌/.test(name)) return '衣箱';
    if(/电工|灯光|音响/.test(name)) return '电工';
    if(/剧务|舞台监督|场记|催场/.test(name)) return '剧务';
    if(/前场|前台|检票|引导/.test(name)) return '前场';
    if(/媒婆|媒人|媒|奶妈|奶娘|老妈|妈|巫婆|稳婆|婆子|鸨/.test(name)) return '彩旦';
    if(/二架旦|二路旦/.test(name)) return '二架旦';
    if(/小旦|花旦|闺门|武旦|刀马旦/.test(name)) return '小旦';
    if(/大花脸|大净|铜锤|包公|包拯|徐延昭|尉迟恭|尉迟/.test(name)) return '大花脸';
    if(/二花脸|架子花|花脸|武净|净|张飞|李逵|曹操|屠岸贾/.test(name)) return '二花脸';
    if(/丑/.test(name)) return '丑角';
    if(/武须生|靠把|红生|关羽|关公|云长|赵匡胤|武生/.test(name)) return '武须生';
    if(/文须生|须生|老生/.test(name)) return '文须生';
    // 女性角色通类（“婆/媒/奶”已在上方分流；姐/姑/妹/巧/娇/玲多为年轻女角，归小旦）
    if(/姐|姑|妹|巧|娇|玲/.test(name)) return '小旦';
    if(/娘|母|太|氏|嫂|妻|妃|娥|莲|兰|英|梅|桂|春|玉|香|凤|云|青|娟|燕|钏|钗/.test(name)) return '正旦';
    if(/公|翁|伯|父亲|爹|老爷|丞|杨|千岁$|大人$/.test(name) && name.length<=4) return '文须生';
    if(/驴|保|淘气|公道|官|差|役|贼|骗/.test(name)) return '丑角';
    if(/小生|郎|朋|鹏|天|文|武|周|秦|唐|小|俞|傅|岳|张|李|王/.test(name) && name.length<=3) return '小生';
    return '龙套';
  }

  var DEFAULT_CREATIVE = [
    {pos:'出品人', name:'', note:''},
    {pos:'总策划', name:'', note:''},
    {pos:'监 制', name:'', note:''},
    {pos:'艺术总监 ★', name:'', note:''},
    {pos:'编 剧', name:'', note:''},
    {pos:'总导演', name:'', note:''},
    {pos:'副导演 / 场记', name:'', note:''},
    {pos:'唱腔设计', name:'', note:'秦腔传统板式：慢板/二六板/垫板/滚白/带板'},
    {pos:'作曲 / 配器', name:'', note:''},
    {pos:'指 挥（如适用）', name:'', note:''},
    {pos:'舞美设计', name:'', note:''},
    {pos:'灯光设计', name:'', note:''},
    {pos:'服装设计', name:'', note:'秦腔传统蟒袍/靠/褶子/帔'},
    {pos:'化妆造型设计', name:'', note:'花脸勾脸/旦角大头/生角巾帽'},
    {pos:'道具设计', name:'', note:''},
    {pos:'字 幕 设 计', name:'', note:''},
    {pos:'舞台监督', name:'', note:''},
    {pos:'剧务主任', name:'', note:''},
    {pos:'宣 传', name:'', note:''},
    {pos:'统 筹', name:'', note:''}
  ];
  var DEFAULT_WUCHANG = [
    {pos:'司鼓 / 板鼓指挥 ★★', name:'', note:'秦腔"鼓令"，演出最高节奏指挥'},
    {pos:'梆 子 ★', name:'', note:'秦腔灵魂节奏乐器，240bpm以上快节奏核心'},
    {pos:'大 锣', name:'', note:''},
    {pos:'铙 钹', name:'', note:''},
    {pos:'小 锣', name:'', note:''},
    {pos:'马 锣 / 狗娃子', name:'', note:''},
    {pos:'堂 鼓', name:'', note:''},
    {pos:'战 鼓', name:'', note:''},
    {pos:'铰 子', name:'', note:''},
    {pos:'水 镲', name:'', note:''}
  ];
  var DEFAULT_WENCHANG = [
    {pos:'板 胡（主奏）★★', name:'', note:'秦腔第一主奏乐器，全程托腔保调'},
    {pos:'二 胡（Ⅰ）', name:'', note:''},
    {pos:'二 胡（Ⅱ）', name:'', note:''},
    {pos:'高 胡', name:'', note:''},
    {pos:'扬 琴', name:'', note:''},
    {pos:'琵 琶', name:'', note:''},
    {pos:'三 弦', name:'', note:'秦腔文场传统弹拨'},
    {pos:'古 筝', name:'', note:''},
    {pos:'竹 笛', name:'', note:''},
    {pos:'唢 呐 / 海笛', name:'', note:'曲牌：《永寿庵》《小开门》'},
    {pos:'笙', name:'', note:''},
    {pos:'大提琴', name:'', note:'（低音支撑）'},
    {pos:'低音提琴 / 电子琴', name:'', note:''}
  ];
  var DEFAULT_STAGE = [
    {pos:'舞台监督 ★★', name:'', note:'演出过程最高指挥官（后台+前台）'},
    {pos:'剧 务 主 任', name:'', note:''},
    {pos:'催 场 / 场记', name:'', note:''},
    {pos:'灯 光 师', name:'', note:''},
    {pos:'灯 光 助 理', name:'', note:''},
    {pos:'音 响 师', name:'', note:'（无线麦管理+合唱混音）'},
    {pos:'话 筒 / 耳麦管理', name:'', note:''},
    {pos:'服 装 管 理', name:'', note:'（蟒/靠/褶/帔 穿脱顺序）'},
    {pos:'跟 包 服 装', name:'', note:''},
    {pos:'盔 箱 ★（秦腔特色岗）', name:'', note:'王帽/纱帽/扎巾/额子/凤冠/驸马套…佩戴+保管'},
    {pos:'化 妆 师（旦角大头）', name:'', note:''},
    {pos:'勾 脸 师（花脸）', name:'', note:''},
    {pos:'道 具 管 理', name:'', note:'扇/帕/马鞭/令旗/刀剑/书信/印信…'},
    {pos:'布 景 / 装 台 队 长', name:'', note:'下乡演出搭台+拆卸'},
    {pos:'字 幕 播 放', name:'', note:'同步伴奏逐句显示字幕'}
  ];
    var DEFAULT_PROGRAM = [
    {cat:'开场锣鼓', name:'', duration:8, actors:'武场乐队', note:''},
    {cat:'加演折子戏', name:'', duration:'', actors:'', note:''},
    {cat:'幕间休息', name:'', duration:10, actors:'', note:''},
    {cat:'主场大本戏', name:'', duration:'', actors:'详见主场演员表', note:''},
    {cat:'谢幕加唱/返场', name:'', duration:'', actors:'全体主演+乐队', note:''}
  ];
  var DEFAULT_CATEGORIES_FOR_PROG = ['开场锣鼓','加演折子戏','幕间休息','主场大本戏（上本）','主场大本戏（下本）','谢幕加唱/返场'];
  var CAST_GROUPS = [
    {key:'生行', roles:['文须生','武须生','小生'], name:'🎼 生行（文须生/武须生/小生）', hint:'男性正面角色，不勾脸'},
    {key:'丑行', roles:['丑角'], name:'😜 丑行（丑角）', hint:'勾豆腐块，滑稽机趣'},
    {key:'净行', roles:['大花脸','二花脸'], name:'🎭 净行（大花脸/二花脸）', hint:'勾脸男性，声洪工架'},
    {key:'旦行', roles:['正旦','小旦','彩旦','二架旦'], name:'💎 旦行（正旦/小旦/彩旦/二架旦）', hint:'女性角色'},
    {key:'二架', roles:['门官','家院'], name:'👔 二架（门官/家院）', hint:'二路里子配角'},
    {key:'角子', roles:['龙套','校尉','刀斧手','丫鬟','彩女','长随官'], name:'🎪 角子（龙套/校尉/刀斧手/丫鬟/彩女/长随官）', hint:'零碎底包角色'}
  ];

  function defaultCastMini(n){
    var arr=[]; for(var i=0;i<(n||2);i++){
      var tp=(i===0?'正旦':'小生');
      var grp='';
      var _g=CAST_GROUPS.find(function(g){return g.roles.indexOf(tp)>=0;}); if(_g) grp=_g.name;
      arr.push({role:'', type:tp, actorA:'', actorB:'', actorC:'', group:grp, note:'', isPublic:true});
    }
    return arr;
  }
  var TYPE_OPTIONS = ['文须生','武须生','小生','丑角','大花脸','二花脸','正旦','小旦','彩旦','二架旦','门官','家院','龙套','校尉','刀斧手','丫鬟','彩女','长随官','电工','前场','剧务','衣箱','（反串/其他）'];
  // 行当下拉：旧存档值（老生/青衣/花脸等）不在新选项时，保留为临时选中项，不丢数据
  function _typeOptionsHtml(cur, esc){
    var extra = (cur && TYPE_OPTIONS.indexOf(cur)<0) ? '<option selected>'+esc(cur)+'</option>' : '';
    return extra + TYPE_OPTIONS.map(function(o){return '<option'+(o===cur?' selected':'')+'>'+esc(o)+'</option>';}).join('');
  }
  var SIMPLE_META = {
    creative: { bodyId:'bodyCreative', cols:['pos','name','note'], placeholders:['例：编剧/总导演/唱腔设计…','填写姓名','分工说明/擅长曲目…'], newRow:function(){ return {pos:'',name:'',note:'',isPublic:true}; }, editables:{pos:'text',name:'text',note:'textarea'} },
    wuchang:  { bodyId:'bodyWuchang',  cols:['pos','name','note'], placeholders:['例：司鼓/梆子/大锣/铙钹…','填写演奏员姓名','常用曲牌/分工…'], newRow:function(){ return {pos:'',name:'',note:'',isPublic:true}; }, editables:{pos:'text',name:'text',note:'textarea'}, datalist:'datalist-wuchang' },
    wenchang: { bodyId:'bodyWenchang', cols:['pos','name','note'], placeholders:['例：板胡/二胡/扬琴/琵琶/三弦…','填写演奏员姓名','擅长曲目/声部…'], newRow:function(){ return {pos:'',name:'',note:'',isPublic:true}; }, editables:{pos:'text',name:'text',note:'textarea'}, datalist:'datalist-wenchang' },
    stage:    { bodyId:'bodyStage',    cols:['pos','name','note'], placeholders:['例：舞台监督/帽箱/化妆/道具…','填写负责人姓名','具体分工…'], newRow:function(){ return {pos:'',name:'',note:'',isPublic:true}; }, editables:{pos:'text',name:'text',note:'textarea'}, datalist:'datalist-stage' },
    program:  { bodyId:'bodyProgram',  cols:['cat','name','duration','actors','note'], placeholders:['分类','节目名称/章节','例：8','主演名/角色名','详细说明…'], newRow:function(){ return {cat:'加演折子戏',name:'',duration:'',actors:'',note:'',isPublic:true}; }, editables:{cat:'select',name:'text',duration:'number',actors:'text',note:'textarea'} }
  };

  var state;

  function defaultState(){
    return {
      isPublic: true,
      header:{title:'', host:'', organizer:'', coorganizer:'', sponsor:'', date:'', time:'', venue:'', notice:''},
      creative: JSON.parse(JSON.stringify(DEFAULT_CREATIVE)),
      mainOpera: [{
        opera:'', duration:'', type:'传统本戏', rating:'', intro:'',
        cast: [
          {role:'', type:'小生', actorA:'', actorB:'', actorC:'', group:(CAST_GROUPS.find(function(g){return g.roles.indexOf('小生')>=0;})||{}).name||'', note:'', isPublic:true}
        ]
      }],
      addOpera: [],
      wuchang: JSON.parse(JSON.stringify(DEFAULT_WUCHANG)),
      wenchang: JSON.parse(JSON.stringify(DEFAULT_WENCHANG)),
      stage: JSON.parse(JSON.stringify(DEFAULT_STAGE)),
      program: JSON.parse(JSON.stringify(DEFAULT_PROGRAM))
    };
  }
  function mergeDefault(saved){
    var d = defaultState();
    if(!saved) return d;
    // isPublic 兼容：旧数据未设置时默认为 true（避免之前创建的阵容突然全部隐藏）
    d.isPublic = (saved && typeof saved.isPublic === 'boolean') ? saved.isPublic : true;
    ['creative','wuchang','wenchang','stage','program'].forEach(function(k){
      if(Array.isArray(saved[k]) && saved[k].length>0) {
        d[k] = saved[k].map(function(r){
          // 旧数据行兼容：未设置isPublic时默认为 true
          if(typeof r.isPublic !== 'boolean') r.isPublic = true;
          return r;
        });
      }
    });
    if(saved.header) d.header = Object.assign({}, d.header, saved.header||{});
    ['mainOpera','addOpera'].forEach(function(k){
      if(Array.isArray(saved[k]) && saved[k].length>0){
        d[k] = saved[k].map(function(op){
          var mappedCast = (Array.isArray(op.cast) && op.cast.length>0) ? op.cast.map(function(c){
            // 旧演员行兼容：未设置isPublic时默认为 true
            if(typeof c.isPublic !== 'boolean') c.isPublic = true;
            return c;
          }) : defaultCastMini(2);
          return {
            opera:op.opera||'', duration:op.duration||'', type:op.type||'传统本戏', rating:op.rating||'⭐常演保留剧目',
            intro:op.intro||'',
            cast: mappedCast
          };
        });
      }
    });
    return d;
  }

  /* ==================== 剧库Picker相关（X1新增） ==================== */
  var pickCtx = { targetKey: 'mainOpera', selectedOperaId: null, library: [] };
  function openOperaPicker(key){
    pickCtx.targetKey = key;
    pickCtx.selectedOperaId = null;
    pickCtx.library = loadOperaLibrary();
    $('opPickTarget').textContent = (key==='mainOpera') ? '主场本戏' : '加演折戏';
    $('opSearch').value = '';
    $('opCatFilter').value = '';
    renderOperaPicker();
    window.__revealLayer($('opOverlay')).classList.add('show');
    window.__revealLayer($('opModal')).classList.add('show');
    // 20260922 打开时从后端拉取真实剧目库并刷新列表
    syncRealOperas().then(function(){
      pickCtx.library = loadOperaLibrary();
      renderOperaPicker();
    });
  }
  function closeOperaPicker(){
    $('opOverlay').classList.remove('show');
    $('opModal').classList.remove('show');
  }
  function catClass(cat){
    if(/本戏$/.test(cat)) return 't-benxi';
    if(/折子戏$/.test(cat)) return 't-zhezi';
    if(/红色/.test(cat)) return 't-hongse';
    if(/新编/.test(cat)) return 't-xinbian';
    return 't-benxi';
  }
  function renderOperaPicker(){
    var kw = ($('opSearch').value||'').trim();
    var cf = $('opCatFilter').value||'';
    var lib = pickCtx.library.filter(function(o){
      if(cf && o.category !== cf) return false;
      if(kw){
        var s = (o.name||'')+(o.synopsis||'')+(o.cast||[]).map(function(x){return x.role+x.type+x.actorA+x.actorB;}).join('');
        if(s.indexOf(kw)===-1) return false;
      }
      return true;
    });
    if(lib.length===0){
      $('opGrid').innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;">未找到匹配剧目<br><small>请尝试其他关键词，或直接在【剧目资源管理】里新增</small></div>';
      return;
    }
    $('opGrid').innerHTML = lib.map(function(o){
      var sel = (pickCtx.selectedOperaId===o.id) ? 'selected':'';
      var castPreview = (o.cast||[]).slice(0,5).map(function(c){ return '<b>'+c.role+'</b>('+c.type+')'; }).join('，') + ((o.cast||[]).length>5 ? '，…共'+o.cast.length+'角色':'');
      return '<div class="op-card '+sel+'" data-opid="'+o.id+'">' +
        '<div class="opc-name">'+o.name+'</div>' +
        '<div class="opc-tags"><span class="t '+catClass(o.category)+'">'+o.category+'</span><span class="t t-benxi">'+(o.rating||'⭐常演')+'</span></div>' +
        '<div class="opc-meta"><b>⏱ '+(o.duration||'?')+'</b>分钟 · 共 '+(o.cast||[]).length+' 个行当角色</div>' +
        '<div class="opc-cast-preview"><div class="cast-mini">'+castPreview+'</div></div>' +
      '</div>';
    }).join('');
  }
  function confirmOperaPick(){
    if(!pickCtx.selectedOperaId){
      alert('请先在剧库列表中点击选择一部剧目！');
      return;
    }
    var op = pickCtx.library.find(function(x){ return x.id === pickCtx.selectedOperaId; });
    if(!op) return;
    var perf = loadPerformers();
    var newCast = (op.cast||[]).map(function(c){
      var type = c.type || guessTypeByName(c.role||'');
      var pool = (perf.performers && perf.performers[type]) || [];
      var groupObj = CAST_GROUPS.find(function(g){return g.roles.indexOf(type)>=0;});
      return {
        role: c.role, type: type,
        actorA: c.actorA || (pool[0]?pool[0].name:''),
        actorB: c.actorB || (pool[1]?pool[1].name:''),
        actorC: c.actorC || (pool[2]?pool[2].name:''),
        group: (groupObj?groupObj.name : ''),
        note: c.note || ''
      };
    });
    if(newCast.length<2) newCast = newCast.concat(defaultCastMini(2));
    var newOpera = {
      opera: op.name, duration: op.duration||'', type: op.category, rating: op.rating||'⭐常演',
      intro: op.synopsis||'', playId: op.playId||'',
      cast: newCast
    };
    state[pickCtx.targetKey].push(newOpera);
    renderOperaBlock(pickCtx.targetKey, pickCtx.targetKey==='mainOpera'?'blkMainOpera':'blkAddOpera');
    closeOperaPicker();
    appendToProgramIfNotExist(op.category==='传统折子戏' ? '加演折子戏' : (pickCtx.targetKey==='mainOpera' ? '主场大本戏（上本）' : '加演折子戏'), op.name, op.duration||30);
    if(typeof toast !== 'undefined') toast('✅ 已加入剧目：'+op.name+'，请在下方逐行填写角色与 A/B/C 角演员','success',3500);
    else alert('✅ 已加入：'+op.name+'，请填写角色与演员');
  }
  function appendToProgramIfNotExist(cat, name, dur){
    var p = state.program.find(function(x){ return x.name && x.name.indexOf(name.replace(/[《》]/g,'')) !== -1; });
    if(p) return;
    state.program.push({cat:cat||'加演折子戏', name: name, duration: dur, actors:'详见'+(cat==='加演折子戏'?'加演':'主场')+'演员表', note:''});
    renderProgram();
  }

  /* ---------- 渲染 ---------- */
  function renderPublicStatus(){
    var bar = $('publicStatusBar');
    if(!bar) return;
    var isPub = state.isPublic === true;
    // FIX_X1：R20.1 CSP合规 → 用 public-ok / public-draft 类替代 style.background/border 写操作
    bar.classList.remove('public-ok','public-draft');
    bar.classList.add(isPub ? 'public-ok' : 'public-draft');
    // FIX_X1：cp相对路径→固定 cast-public.html（基于admin/目录，直接 ../cast-public.html 即可）
    var cp = '../cast-public.html';
    if(isPub){
      bar.innerHTML = '<div class="pubstatus-icon">✅</div>'
        + '<div class="pubstatus-body"><b>阵容已公开 · 观众扫码可看</b><br>'
        + '<span>前台链接：<a href="'+cp+'" target="_blank" rel="noopener noreferrer">cast-public.html</a>（取消勾选后观众将无法看到）</span></div>';
    } else {
      bar.innerHTML = '<div class="pubstatus-icon">🚫</div>'
        + '<div class="pubstatus-body"><b>草稿状态 · 观众无法看到</b><br>'
        + '<span>此阵容仅后台可见；勾选上方"公开"开关后，观众才能扫码查看到电子阵容。如需预览请 <a href="'+cp+'?preview=1" target="_blank" rel="noopener noreferrer">点击管理员预览 →</a></span></div>';
    }
  }
  function renderHeader(){
    var h = state.header;
    $('inp-title').value = h.title||'';
    $('inp-host').value = h.host||'';
    $('inp-organizer').value = h.organizer||'';
    $('inp-coorganizer').value = h.coorganizer||'';
    $('inp-sponsor').value = h.sponsor||'';
    $('inp-date').value = h.date||'';
    $('inp-time').value = h.time||'';
    $('inp-venue').value = h.venue||'';
    $('inp-notice').value = h.notice||'';
    var pub = $('inp-isPublic');
    if(pub) pub.checked = state.isPublic !== false;
    renderPublicStatus();
  }
  function bindHeaderInput(id, key){
    var el=$(id); if(!el) return;
    el.addEventListener('input',function(e){ state.header[key] = el.value; }, true);
    el.addEventListener('change',function(e){ state.header[key] = el.value; }, true);
  }
  function bindPublicCheckbox(){
    var el = $('inp-isPublic'); if(!el) return;
    var handler = function(){
      state.isPublic = !!el.checked;
      renderPublicStatus();
      try{ saveState(true); }catch(e){}
    };
    el.addEventListener('change', handler, true);
    el.addEventListener('click', handler, true);
  }
  function renderSimpleBlock(key){
    var meta = SIMPLE_META[key];
    if(!meta) return;
    var body=$(meta.bodyId); if(!body) return;
    var rows = state[key];
    var html = '';
    // R20.1 HIGH：统一HTML转义函数（双重兜底）
    function _hx_v(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _hx_t(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    rows.forEach(function(r,i){
      html += '<tr>';
      html += '<td class="seq">'+(i+1)+'</td>';
      meta.cols.forEach(function(col, ci){
        if(col==='cat' && key==='program'){
          html += '<td><select data-key="'+key+'" data-i="'+i+'" data-col="cat">'+
            DEFAULT_CATEGORIES_FOR_PROG.map(function(c){ return '<option value="'+_hx_v(c)+'"'+(r.cat===c?' selected':'')+'>'+_hx_t(c)+'</option>'; }).join('') + '</select></td>';
        } else {
          var tag = meta.editables[col]==='textarea' ? 'textarea' : (meta.editables[col]==='select'?'select':'input');
          var dl = (col==='name' && meta.datalist) ? ' list="'+meta.datalist+'"' : ((col==='name' && (key==='creative')) ? ' list="datalist-performers-all"' : ((col==='pos' && key==='creative') ? ' list="datalist-creative-pos"' : ''));
          var typeAttr = (tag==='input' && col==='duration') ? ' type="number"' : (tag==='input' ? ' type="text"' : '');
          if(tag==='input'){
            var valRaw = r[col];
            var valStr = (valRaw===null||valRaw===undefined)?'':String(valRaw);
            html += '<td><input'+typeAttr+' placeholder="'+_hx_v(meta.placeholders[ci]||'')+'" data-key="'+key+'" data-i="'+i+'" data-col="'+col+'" value="'+_hx_v(valStr)+'"'+dl+'></td>';
          } else if(tag==='select'){
            html += '<td><select data-key="'+key+'" data-i="'+i+'" data-col="'+col+'"><option value="">--</option>'+_typeOptionsHtml(r[col], _hx_t)+'</select></td>';
          } else {
            // textarea：完整转义，防 </textarea> 闭合注入
            html += '<td><textarea placeholder="'+_hx_v(meta.placeholders[ci]||'')+'" data-key="'+key+'" data-i="'+i+'" data-col="'+col+'" rows="2">'+_hx_t(r[col]||'')+'</textarea></td>';
          }
        }
      });
      html += '<td class="cast-col-center"><input type="checkbox" class="cast-cb-public" data-key="'+key+'" data-i="'+i+'" data-col="isPublic"'+(r.isPublic!==false?' checked':'')+' title="勾选=公开页观众可见，取消=仅内部可见"></td>';
      html += '<td><button class="btn-del-row" data-del="'+key+'" data-i="'+i+'" type="button">✕</button></td>';
      html += '</tr>';
    });
    body.innerHTML = html;
  }
  function renderProgram(){ renderSimpleBlock('program'); }

  function renderOperaBlock(key, blockId){
    var blk = $(blockId); if(!blk) return;
    var list = state[key];
    var html = '';
    // R20.1 HIGH：统一 HTML 转义（attr用_hx_v含"，text用_hx_t不含"）
    function _hx_v(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _hx_t(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    var TYPE_LIST = ['传统本戏','传统折子戏','红色现代戏','新编历史剧','小戏/小品','清唱/曲艺'];
    var RATE_LIST = ['⭐常演保留剧目','⭐⭐重点推荐','⭐⭐⭐招牌大戏','⭐⭐⭐⭐镇团之宝'];
    // ===== 2026-08-02 按场勾选打印：读取已保存的勾选记忆（key+oidx），避免重渲染时勾选丢失 =====
    var PS_KEY = '__ps_sel_cache__';
    if(!window[PS_KEY]){ window[PS_KEY] = {}; }
    var selCache = window[PS_KEY];
    list.forEach(function(oper, oidx){
      var addClass = (key==='addOpera') ? ' add-op':'';
      var tabsHtml = '';
      if((oper.cast||[]).length>0){
        tabsHtml = '<div class="cast-tabs no-print">'+(oper.cast.map(function(c,ci){ return '<span class="tab'+(ci===0?' active':'')+'" data-tabci="'+ci+'">'+_hx_t(c.role||('角色'+(ci+1)))+'</span>'; }).join(''))+'</div>';
      }
      var cacheKey = key+'_'+oidx;
      var checkedStr = selCache[cacheKey] ? ' checked' : '';
      html += '<div class="cast-opera-card'+addClass+'" data-ps-opera-key="'+key+'" data-ps-opera-idx="'+oidx+'">' +
        '<div class="oper-head">' +
          // ===== 2026-08-02 按场勾选打印：剧目级打印复选框 =====
          '<label class="op-print-check no-print"><input type="checkbox" data-ps-cb-opera="1" data-ps-opera-key="'+key+'" data-ps-opera-idx="'+oidx+'"'+checkedStr+'>🖨 打印此剧</label>' +
          '<div class="oh-title"><input type="text" data-okey="'+key+'" data-oi="'+oidx+'" data-ofield="opera" value="'+_hx_v(oper.opera||'')+'"></div>' +
          '<div class="oh-meta">' +
            '<span class="chip">分类：<select data-okey="'+key+'" data-oi="'+oidx+'" data-ofield="type">' +
              TYPE_LIST.map(function(t){return '<option'+(t===oper.type?' selected':'')+'>'+_hx_t(t)+'</option>';}).join('') +
            '</select></span>' +
            '<span class="chip">⏱ 时长：<input type="number" class="cast-input-duration" data-okey="'+key+'" data-oi="'+oidx+'" data-ofield="duration" value="'+_hx_v(oper.duration||'')+'"> 分钟</span>' +
            '<span class="chip">评级：<select data-okey="'+key+'" data-oi="'+oidx+'" data-ofield="rating">' +
              RATE_LIST.map(function(t){return '<option'+(t===oper.rating?' selected':'')+'>'+_hx_t(t)+'</option>';}).join('') +
            '</select></span>' +
          '</div>' +
          '<div class="oh-actions no-print">' +
            '<button class="btn-op-csv" type="button" data-opera-csv="'+key+'" data-i="'+oidx+'">📊 单场CSV</button>' +
            '<button class="btn-op-cardprint" type="button" data-opera-cardprint="'+key+'" data-i="'+oidx+'">🎴 A4卡打印</button>' +
            '<button class="btn-op-cast" type="button" data-pick-cast="'+key+'" data-i="'+oidx+'">⚡ 批量选角…</button>' +
            '<button class="btn-op-del" type="button" data-opera-del="'+key+'" data-i="'+oidx+'">✕ 删除本剧</button>' +
          '</div>' +
        '</div>' +
        '<div class="oper-intro-row"><label>📖 剧情简介（200字内）：</label><textarea data-okey="'+key+'" data-oi="'+oidx+'" data-ofield="intro" rows="3" placeholder="例：明代秦腔经典传统本戏…">'+_hx_t(oper.intro||'')+'</textarea></div>' +
        tabsHtml +
        '<table class="cast-table cast-table-mt">' +
          '<thead><tr><th style="width:38px;">#</th><th style="width:130px;">角色名</th><th style="width:110px;">行当</th><th style="width:130px;"><b style="color:#b91c1c;">A 角 ★</b>（主演）</th><th style="width:130px;">B 角（替补）</th><th style="width:130px;">C 角（实习/学员）</th><th style="width:160px;">分组/行当</th><th>剧情说明 / 备注</th><th style="width:58px;" title="勾选=观众可见，取消=内部保密">公开</th><th style="width:54px;">操作</th></tr></thead>' +
          '<tbody>' +
          (oper.cast||[]).map(function(c,ci){
            var typeSel = '<select data-okey="'+key+'" data-oi="'+oidx+'" data-oci="'+ci+'" data-cfield="type">'+_typeOptionsHtml(c.type, _hx_t)+'</select>';
            var grpSel = '<select data-okey="'+key+'" data-oi="'+oidx+'" data-oci="'+ci+'" data-cfield="group"><option value="">（不分组）</option>'+CAST_GROUPS.map(function(g){return '<option value="'+_hx_v(g.name)+'"'+(g.name===c.group?' selected':'')+'>'+_hx_t(g.name)+'</option>';}).join('')+'</select>';
            return '<tr class="cast-row" data-oci-tr="'+ci+'">'+
              '<td class="seq">'+(ci+1)+'</td>' +
              '<td class="oper-name"><input type="text" value="'+_hx_v(c.role||'')+'" data-okey="'+key+'" data-oi="'+oidx+'" data-oci="'+ci+'" data-cfield="role" placeholder="例：周仁"></td>' +
              '<td>'+typeSel+'</td>' +
              '<td><input type="text" list="datalist-performers-all" value="'+_hx_v(c.actorA||'')+'" data-okey="'+key+'" data-oi="'+oidx+'" data-oci="'+ci+'" data-cfield="actorA" class="actor-input" placeholder="A主演"></td>' +
              '<td><input type="text" list="datalist-performers-all" value="'+_hx_v(c.actorB||'')+'" data-okey="'+key+'" data-oi="'+oidx+'" data-oci="'+ci+'" data-cfield="actorB" placeholder="B替补"></td>' +
              '<td><input type="text" list="datalist-performers-all" value="'+_hx_v(c.actorC||'')+'" data-okey="'+key+'" data-oi="'+oidx+'" data-oci="'+ci+'" data-cfield="actorC" placeholder="C实习"></td>' +
              '<td>'+grpSel+'</td>' +
              '<td><input type="text" value="'+_hx_v(c.note||'')+'" data-okey="'+key+'" data-oi="'+oidx+'" data-oci="'+ci+'" data-cfield="note" placeholder="该角色核心唱段/重点折子"></td>' +
              '<td class="cast-col-center"><input type="checkbox" class="cast-cb-public" data-okey="'+key+'" data-oi="'+oidx+'" data-oci="'+ci+'" data-cfield="isPublic"'+(c.isPublic!==false?' checked':'')+' title="勾选=公开页观众可见此角色，取消=仅内部可见"></td>' +
              '<td><button class="btn-del-row" type="button" data-del-role="'+key+'" data-oi="'+oidx+'" data-ci="'+ci+'">✕</button></td>' +
            '</tr>';
          }).join('') +
          '</tbody>' +
        '</table>' +
        '<div class="cast-add-role-wrap no-print">' +
          '<button class="btn-add-cast" type="button" data-add-role="'+key+'" data-i="'+oidx+'">＋ 追加角色行</button>' +
        '</div>' +
        /* ===== 2026-08-03 A② 签字盖章栏（团长/导演/剧务/盖章） ===== */
        '<div class="opera-sign-bar" aria-label="签字盖章区">' +
          '<div class="sb-title">✅ 演出确认签字栏（本表为A4单场阵容卡，一式三份：剧团存档/导演组/剧场方各执一份）</div>' +
          '<div class="sb-grid">' +
            '<div class="sb-cell"><div class="sb-label">🎩 团长签字</div><span class="sb-line"></span><div class="sb-hint">（审定人）</div></div>' +
            '<div class="sb-cell"><div class="sb-label">🎬 导演签字</div><span class="sb-line"></span><div class="sb-hint">（艺术总监/执行导演）</div></div>' +
            '<div class="sb-cell"><div class="sb-label">🎪 剧务签字</div><span class="sb-line"></span><div class="sb-hint">（舞台监督/催场）</div></div>' +
            '<div class="sb-cell stamp"><div class="sb-label">🔖 剧团盖章</div><div class="sb-stamp-box">秦安县秦剧团文化演出有限公司<br>（公章处）</div><div class="sb-hint">盖骑缝章有效</div></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    });
    blk.innerHTML = html;
    // ===== 2026-08-02 按场勾选打印：重渲染后恢复板块的视觉高亮 =====
    if(typeof refreshPrintSelectionVisual === 'function'){ setTimeout(refreshPrintSelectionVisual, 10); }
  }
  function renderAll(){
    renderHeader();
    renderSimpleBlock('creative');
    renderSimpleBlock('wuchang');
    renderSimpleBlock('wenchang');
    renderSimpleBlock('stage');
    renderProgram();
    renderOperaBlock('mainOpera','blkMainOpera');
    renderOperaBlock('addOpera','blkAddOpera');
  }

  /* ---------- X2: 演职人员 datalist 渲染 ---------- */
  function renderPerformersDatalist(){
    var perf = loadPerformers();
    var flat = perf.flat || getFlatPerformers();
    var all = $('datalist-performers-all');
    var wuchang = $('datalist-wuchang');
    var wenchang = $('datalist-wenchang');
    var stage = $('datalist-stage');
    function build(list){
      var html = '';
      var seen = {};
      list.forEach(function(p){
        if(!p || !p.name) return;
        if(seen[p.name]) return;
        seen[p.name]=true;
        html += '<option value="'+p.name.replace(/"/g,'&quot;')+'">'+p.name+' · '+p.category+' · '+ (p.skill||'')+'</option>';
      });
      return html;
    }
    if(all) all.innerHTML = build(flat);
    if(wuchang) wuchang.innerHTML = build(flat.filter(function(p){ return p.category==='武场'; }));
    if(wenchang) wenchang.innerHTML = build(flat.filter(function(p){ return p.category==='文场'; }));
    if(stage) stage.innerHTML = build(flat.filter(function(p){ return ['电工','前场','剧务','衣箱','帽箱'].indexOf(p.category)>=0; }));
  }

  function bindSimpleBlockInputs(){
    document.querySelectorAll('.cast-table').forEach(function(tbl){
      tbl.addEventListener('input', function(e){
        var t = e.target;
        var k = t.getAttribute && t.getAttribute('data-key');
        var i = t.getAttribute && t.getAttribute('data-i');
        var col = t.getAttribute && t.getAttribute('data-col');
        if(k && i!=null && col && SIMPLE_META[k]){
          if(col==='isPublic' && t.type==='checkbox'){
            state[k][parseInt(i,10)][col] = t.checked;
          } else {
            state[k][parseInt(i,10)][col] = t.value;
          }
        }
      }, true);
      tbl.addEventListener('change', function(e){
        var t = e.target;
        var k = t.getAttribute && t.getAttribute('data-key');
        var i = t.getAttribute && t.getAttribute('data-i');
        var col = t.getAttribute && t.getAttribute('data-col');
        if(k && i!=null && col && SIMPLE_META[k]){
          if(col==='isPublic' && t.type==='checkbox'){
            state[k][parseInt(i,10)][col] = t.checked;
          } else {
            state[k][parseInt(i,10)][col] = t.value;
          }
        }
      }, true);
    });
  }
  function bindOperaInputs(){
    ['blkMainOpera','blkAddOpera'].forEach(function(bid){
      var blk = $(bid); if(!blk) return;
      blk.addEventListener('input', function(e){
        var t = e.target;
        var okey = t.getAttribute && t.getAttribute('data-okey');
        if(!okey) return;
        var oi = parseInt(t.getAttribute('data-oi')||'0',10);
        var ofield = t.getAttribute('data-ofield');
        var oci = t.getAttribute('data-oci');
        var cfield = t.getAttribute('data-cfield');
        if(ofield){ state[okey][oi][ofield] = t.value; }
        else if(oci!=null && cfield){
          if(cfield==='isPublic' && t.type==='checkbox'){
            state[okey][oi].cast[parseInt(oci,10)][cfield] = t.checked;
          } else {
            state[okey][oi].cast[parseInt(oci,10)][cfield] = t.value;
          }
        }
      }, true);
      blk.addEventListener('change', function(e){
        var t = e.target;
        var okey = t.getAttribute && t.getAttribute('data-okey');
        if(!okey) return;
        var oi = parseInt(t.getAttribute('data-oi')||'0',10);
        var ofield = t.getAttribute('data-ofield');
        var oci = t.getAttribute('data-oci');
        var cfield = t.getAttribute('data-cfield');
        if(ofield){ state[okey][oi][ofield] = t.value; }
        else if(oci!=null && cfield){
          if(cfield==='isPublic' && t.type==='checkbox'){
            state[okey][oi].cast[parseInt(oci,10)][cfield] = t.checked;
          } else {
            state[okey][oi].cast[parseInt(oci,10)][cfield] = t.value;
          }
        }
        if((ofield==='opera' || ofield==='duration')){
          updateProgramByOpera(okey, oi);
        }
      }, true);
    });
  }
  function updateProgramByOpera(key, oi){
    var op = state[key][oi]; if(!op || !op.opera) return;
    var cat = (key==='addOpera' || /折子戏$/.test(op.type)) ? '加演折子戏' : '主场大本戏（上本）';
    var idx = state.program.findIndex(function(x){ return x.name && x.name.indexOf(op.opera.replace(/[《》]/g,'').slice(0,4)) !== -1; });
    if(idx>=0){ state.program[idx].name = op.opera + '（' + cat + '）'; state.program[idx].duration = op.duration||''; renderProgram(); }
  }

  /* ---------- 批量选角 Picker ---------- */
  var pickContext = null;
  var cpChecked = {};
  function buildCastPickerBody(){
    var perf = loadPerformers();
    var groups = CAST_GROUPS.map(function(g){
      var people = [];
      g.roles.forEach(function(r){
        (perf.performers[r]||[]).forEach(function(p){ people.push({p:p, roleKey:r}); });
      });
      var arr = people.map(function(x){
        var p = x.p;
        var checked = cpChecked[p.name] ? ' checked' : '';
        var sel = cpChecked[p.name] ? ' cp-selected' : '';
        return '<label class="cp-item'+sel+'" data-cpi="'+p.name+'">' +
          '<input type="checkbox" data-cpn="'+p.name+'"'+checked+'>' +
          '<span>'+p.name+'</span>' +
          '<span class="cpi-type">'+(p.skill||x.roleKey)+'</span>' +
        '</label>';
      }).join('');
      return '<div class="cp-cat"><h4>'+g.name+' <em>'+people.length+'人</em></h4><div class="cp-cat-grid">'+arr+'</div></div>';
    }).join('');
    return groups;
  }
  function openCastPicker(key, oidx){
    pickContext = {key: key, idx: oidx};
    cpChecked = {};
    var op = state[key][oidx];
    (op.cast||[]).forEach(function(c){
      if(c.actorA) cpChecked[c.actorA]=true;
      if(c.actorB) cpChecked[c.actorB]=true;
      if(c.actorC) cpChecked[c.actorC]=true;
    });
    $('cpTitle').textContent = '选择《'+(op.opera||op.name||'未命名剧目')+'》演员阵容（勾选后自动按行当匹配角色）';
    $('cpBody').innerHTML = buildCastPickerBody();
    window.__revealLayer($('cpOverlay')).classList.add('show');
    window.__revealLayer($('cpModal')).classList.add('show');
    bindCastPickerClicks();
  }
  function bindCastPickerClicks(){
    $('cpBody').querySelectorAll('.cp-item').forEach(function(it){
      it.addEventListener('click',function(e){
        var cb = it.querySelector('input[type=checkbox]');
        if(e.target !== cb){ cb.checked = !cb.checked; }
        var nm = cb.getAttribute('data-cpn');
        cpChecked[nm] = cb.checked;
        it.classList.toggle('cp-selected', cb.checked);
      }, true);
    });
  }
  function closeCastPicker(){
    $('cpOverlay').classList.remove('show');
    $('cpModal').classList.remove('show');
    pickContext = null;
  }
  function applyCommonCast(){
    var perf = loadPerformers();
    CAST_GROUPS.forEach(function(g){
      g.roles.forEach(function(r){
        (perf.performers[r]||[]).slice(0,2).forEach(function(p){ cpChecked[p.name]=true; });
      });
    });
    $('cpBody').innerHTML = buildCastPickerBody();
    bindCastPickerClicks();
    if(typeof toast !== 'undefined') toast('⚡ 已一键勾选剧团常用班底（每个行当前2名）','success',2600);
    else alert('⚡ 已勾选常用班底');
  }
  function confirmCastSelection(){
    if(!pickContext){ closeCastPicker(); return; }
    var key = pickContext.key;
    var idx = pickContext.idx;
    var op = state[key][idx];
    var perf = loadPerformers();
    var chosenNames = Object.keys(cpChecked).filter(function(n){ return cpChecked[n]; });
    var perfByType = {};
    chosenNames.forEach(function(nm){
      var found = null;
      var cat = null;
      for(var k in perf.performers){
        var hit = perf.performers[k].find(function(p){ return p.name === nm; });
        if(hit){ found = hit; cat = k; break; }
      }
      if(!cat) cat = '龙套';
      if(!perfByType[cat]) perfByType[cat] = [];
      perfByType[cat].push(nm);
    });
    // 按行当做左分配
    (op.cast||[]).forEach(function(c){
      var pool = perfByType[c.type] || [];
      if(pool.length>0 && !c.actorA) c.actorA = pool.shift();
      if(pool.length>0 && !c.actorB) c.actorB = pool.shift();
      if(pool.length>0 && !c.actorC) c.actorC = pool.shift();
    });
    // 剩余未分配的，追加到cast
    var allAssigned = {};
    (op.cast||[]).forEach(function(c){
      if(c.actorA) allAssigned[c.actorA]=true;
      if(c.actorB) allAssigned[c.actorB]=true;
      if(c.actorC) allAssigned[c.actorC]=true;
    });
    chosenNames.forEach(function(nm){
      if(!allAssigned[nm]){
        var cat = '龙套';
        for(var k in perf.performers){ if(perf.performers[k].find(function(p){return p.name===nm;})){ cat=k; break; } }
        op.cast.push({role:nm+'（待分配角色）', type:cat, actorA:nm, actorB:'', actorC:'', group:'', note:'勾选后自动追加，请手动改角色名', isPublic:true});
      }
    });
    renderOperaBlock(key, key==='mainOpera'?'blkMainOpera':'blkAddOpera');
    closeCastPicker();
    if(typeof toast !== 'undefined') toast('✅ 已为《'+op.opera+'》分配：'+chosenNames.length+' 位演员','success',3000);
    else alert('✅ 已分配 '+chosenNames.length+' 位演员');
  }

  /* ---------- 2026-08-03 A② 单场剧目CSV导出（独立文件 · 含签字栏说明） ---------- */
  function exportSingleOperaCSV(key, oidx){
    var op = state[key] && state[key][oidx]; if(!op){ if(typeof toast!=='undefined')toast('⚠️ 剧目不存在','warning'); return; }
    if(typeof window.__OP_LOCKS!=='undefined'){ if(window.__OP_LOCKS['op_csv_'+key+'_'+oidx]){ if(typeof toast!=='undefined')toast('⏳ 正在导出，请稍候…','warning'); return; } window.__OP_LOCKS['op_csv_'+key+'_'+oidx]=Date.now(); setTimeout(function(){try{delete window.__OP_LOCKS['op_csv_'+key+'_'+oidx];}catch(_){}},1500); }
    try{
      var h = state.header || {};
      var csvTitle = (key==='mainOpera'?'主场本戏':'加演折戏') + '·第'+(oidx+1)+'部 - 《'+(op.opera||'未命名剧目')+'》';
      var ls=[]; var eesc=function(s){ s=(s==null?'':String(s)); if(/[",\r\n]/.test(s)) return '"'+s.replace(/"/g,'""')+'"'; return s; };
      ls.push(['秦安县秦剧团文化演出有限公司 · 单场演出报名表 / 阵容卡（CSV）'].map(eesc).join(','));
      ls.push(['剧目信息',csvTitle,'导出时间',new Date().toLocaleString('zh-CN')].map(eesc).join(','));
      ls.push([]);
      ls.push(['演出标题',h.title||'','主办',h.host||'','承办',h.organizer||''].map(eesc).join(','));
      ls.push(['演出日期',h.date||'','开演时间',h.time||'','演出地点',h.venue||''].map(eesc).join(','));
      ls.push(['剧目名称',op.opera||'','分类',op.type||'','时长(分钟)',op.duration||'','评级',op.rating||''].map(eesc).join(','));
      ls.push(['剧情简介',(op.intro||'').replace(/\r?\n/g,' ')].map(eesc).join(','));
      ls.push([]);
      ls.push(['## 演员角色明细表（A4阵容卡对应）'].map(eesc).join(','));
      ls.push(['序号','角色名','行当','A角(主演)','B角(替补)','C角(实习)','分组/行当','剧情说明/备注'].map(eesc).join(','));
      (op.cast||[]).forEach(function(c,ci){
        ls.push([ci+1,c.role||'',c.type||'',c.actorA||'',c.actorB||'',c.actorC||'',c.group||'',(c.note||'').replace(/\r?\n/g,' ')].map(eesc).join(','));
      });
      ls.push([]);
      ls.push(['## 签字盖章确认栏（本表一式三份：剧团存档/导演组/剧场方）'].map(eesc).join(','));
      ls.push(['团长签字（审定人）','____________','导演签字（艺术总监）','____________','剧务签字（舞台监督）','____________','剧团盖章处','⬜ 已盖章（骑缝章有效）'].map(eesc).join(','));
      ls.push([]);
      ls.push(['--- 本CSV采用UTF-8 BOM编码，Excel/WPS直接打开可正常显示中文 ---'].map(eesc).join(','));
      var csvStr = '\uFEFF' + ls.join('\n');
      var blob = new Blob([csvStr], {type:'text/csv;charset=utf-8;'});
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var safeName = (op.opera||('剧目'+(oidx+1))).replace(/[《》\\/:*?"<>|\s]/g,'').slice(0,28);
      var fname = '秦安秦剧团-单场阵容卡-'+(h.date||new Date().toISOString().slice(0,10))+'-第'+(oidx+1)+'部-'+safeName+'.csv';
      a.href = url; a.download = fname; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(_){} }, 600);
      if(typeof toast!=='undefined') toast('📤 已导出单场CSV：'+fname,'success',3500);
    }catch(er){ console.warn('[exportSingleOperaCSV err]',er); if(typeof toast!=='undefined')toast('❌ 导出失败：'+(er.message||er),'error'); }
  }

  /* ---------- 2026-08-03 A② 单场A4横版卡式打印（进入卡模式→打印→退出） ---------- */
  function printSingleOperaCard(key, oidx){
    var op = state[key] && state[key][oidx]; if(!op){ if(typeof toast!=='undefined')toast('⚠️ 剧目不存在','warning'); return; }
    if(typeof window.__OP_LOCKS!=='undefined'){ if(window.__OP_LOCKS['op_card_'+key+'_'+oidx]){ if(typeof toast!=='undefined')toast('⏳ 正在调出打印面板…','warning'); return; } window.__OP_LOCKS['op_card_'+key+'_'+oidx]=Date.now(); setTimeout(function(){try{delete window.__OP_LOCKS['op_card_'+key+'_'+oidx];}catch(_){}},2500); }
    try{
      // ① 找到对应的卡片DOM，加标记 __card_active__；② 给body加 __card_print_mode__；③ 切到预览模式（输入框变文本）；④ 打印；⑤ 还原
      var cards = document.querySelectorAll('.cast-opera-card[data-ps-opera-key="'+key+'"][data-ps-opera-idx="'+oidx+'"]');
      var card = cards && cards[0];
      if(!card){ if(typeof toast!=='undefined')toast('⚠️ 未找到剧目卡节点，请刷新页面重试','warning'); return; }
      var prevMode = document.body.getAttribute('data-mode') || 'edit';
      // 切预览模式（让输入框变文本利于打印）
      if(prevMode!=='preview'){ try{ setMode('preview'); }catch(_){} }
      try{ if(document.getElementById('printDate')) document.getElementById('printDate').textContent = new Date().toLocaleString('zh-CN'); }catch(_){}
      card.classList.add('__card_active__');
      document.body.classList.add('__card_print_mode__');
      // 滚动到卡片
      try{ card.scrollIntoView({behavior:'instant' in Element.prototype?'auto':'smooth', block:'start'}); }catch(_){}
      var cardName = (op.opera||('剧目'+(oidx+1)));
      if(typeof toast!=='undefined') toast('🎴 已进入《'+cardName+'》A4横版卡式打印模式…','info',1800);
      setTimeout(function(){
        try{ window.print(); }catch(_e){ try{ document.execCommand('print'); }catch(__e){ if(typeof toast!=='undefined')toast('⚠️ 打印调用失败，请用Ctrl+P/Cmd+P手动触发','warning'); } }
        setTimeout(function(){
          // 退出卡模式，还原显示
          try{ card.classList.remove('__card_active__'); }catch(_){}
          try{ document.body.classList.remove('__card_print_mode__'); }catch(_){}
          if(prevMode!=='preview'){ try{ setMode(prevMode); }catch(_){} }
          if(typeof toast!=='undefined') toast('✅ 已退出卡式打印模式，返回'+(prevMode==='preview'?'预览':'编辑')+'界面','info',2200);
        }, 1200);
      }, 900);
    }catch(err){ console.warn('[printSingleOperaCard err]',err); try{ document.body.classList.remove('__card_print_mode__'); }catch(_){} if(typeof toast!=='undefined')toast('❌ 调出打印面板失败：'+(err.message||err),'error'); }
  }

  /* ---------- 简单板块 + 主/加演剧目的 "追加…行" 通用按钮 ---------- */
  function bindAddButtons(){
    document.querySelectorAll('button[data-add]').forEach(function(btn){
      btn.addEventListener('click',function(e){
        e.preventDefault();
        e.stopPropagation && e.stopPropagation();
        e.stopImmediatePropagation && e.stopImmediatePropagation();
        var key = btn.getAttribute('data-add');
        if(SIMPLE_META[key]){
          state[key].push(SIMPLE_META[key].newRow());
          renderSimpleBlock(key);
        } else if(key==='mainOpera' || key==='addOpera'){
          // 改为从剧库Picker选择
          openOperaPicker(key);
        }
        scrollFlash(btn, key);
      },true);
    });
  }
  /* ---------- 自定义确认弹窗（替代原生 confirm，防 SuperPatch 拦截） ---------- */
  function __showConfirm(msg, onOk){
    var ov=document.getElementById('__cfOverlay');
    if(!ov){
      ov=document.createElement('div');
      ov.id='__cfOverlay';
      ov.style.cssText='display:none;position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,0.55);align-items:center;justify-content:center;transform:none!important;top:0!important;left:0!important;right:0!important;bottom:0!important;';
      ov.innerHTML='<div style="background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.3);width:min(420px,92vw);overflow:hidden;">'+
        '<div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;"><h3 style="margin:0;font-size:1.05rem;font-weight:700;color:#8b0000;">⚠️ 操作确认</h3></div>'+
        '<div id="__cfMsg" style="padding:20px 24px;font-size:0.95rem;color:#334155;line-height:1.6;"></div>'+
        '<div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;gap:10px;justify-content:flex-end;">'+
        '<button id="__cfCancel" type="button" style="padding:8px 18px;border:1.5px solid #cbd5e1;background:#fff;color:#475569;border-radius:8px;cursor:pointer;font-weight:600;">取消</button>'+
        '<button id="__cfOk" type="button" style="padding:8px 20px;border:none;background:linear-gradient(135deg,#8b0000,#6b0000);color:#fff;border-radius:8px;cursor:pointer;font-weight:700;">确定</button>'+
        '</div></div>';
      document.body.appendChild(ov);
    }
    document.getElementById('__cfMsg').textContent=msg;
    window.__revealLayer(ov);
    ov.style.display='flex';
    document.body.classList.add('body-modal-locked');
    var okBtn=document.getElementById('__cfOk'), caBtn=document.getElementById('__cfCancel');
    var done=false;
    function close(){ if(done)return; done=true; ov.style.display='none'; document.body.classList.remove('body-modal-locked'); }
    okBtn.onclick=function(){ close(); if(typeof onOk==='function') onOk(); };
    caBtn.onclick=function(){ close(); };
    ov.onclick=function(e){ if(e.target===ov) close(); };
  }

  function bindDeleteButtons(){
    Object.keys(SIMPLE_META).forEach(function(key){
      var body=$(SIMPLE_META[key].bodyId); if(!body) return;
      body.addEventListener('click',function(e){
        var t=e.target, del=t.getAttribute && t.getAttribute('data-del'), i=t.getAttribute && t.getAttribute('data-i');
        if(del===key && i!=null){
          e.preventDefault();
          e.stopPropagation && e.stopPropagation();
          e.stopImmediatePropagation && e.stopImmediatePropagation();
          var idx=parseInt(i,10);
          __showConfirm('确认删除 '+key+' 第 '+(idx+1)+' 行？', function(){
            state[key].splice(idx,1);
            renderSimpleBlock(key);
          });
          return;
        }
      },true);
    });
    // 加演/主 删除本剧
    ['blkMainOpera','blkAddOpera'].forEach(function(bid){
      var blk=$(bid); if(!blk) return;
      blk.addEventListener('click',function(e){
        var t=e.target;
        var oc=t.getAttribute && t.getAttribute('data-opera-csv');
        var opr=t.getAttribute && t.getAttribute('data-opera-cardprint');
        var od=t.getAttribute && t.getAttribute('data-opera-del');
        var di=t.getAttribute && t.getAttribute('data-del-role');
        var ar=t.getAttribute && t.getAttribute('data-add-role');
        var pc=t.getAttribute && t.getAttribute('data-pick-cast');
        if(oc){
          e.preventDefault(); e.stopPropagation && e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation();
          var oiCsv=parseInt(t.getAttribute('data-i')||'0',10);
          exportSingleOperaCSV(oc, oiCsv);
        } else if(opr){
          e.preventDefault(); e.stopPropagation && e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation();
          var oiPr=parseInt(t.getAttribute('data-i')||'0',10);
          printSingleOperaCard(opr, oiPr);
        } else if(od){
          e.preventDefault(); e.stopPropagation && e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation();
          var oi=parseInt(t.getAttribute('data-i')||'0',10);
          var nm=state[od][oi] && (state[od][oi].opera||state[od][oi].name);
          var delOd=od, delOi=oi, delBid=bid;
          __showConfirm('确认删除本剧：'+(nm||'未命名')+'？', function(){
            state[delOd].splice(delOi,1);
            renderOperaBlock(delOd, delBid==='blkMainOpera'?'blkMainOpera':'blkAddOpera');
          });
          return;
        } else if(di){
          e.preventDefault(); e.stopPropagation && e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation();
          var oi2=parseInt(t.getAttribute('data-oi')||'0',10);
          var ci2=parseInt(t.getAttribute('data-ci')||'0',10);
          var delDi=di, delOi2=oi2, delCi2=ci2, delBid2=bid;
          __showConfirm('确认删除该角色行？', function(){
            state[delDi][delOi2].cast.splice(delCi2,1);
            renderOperaBlock(delDi, delBid2);
          });
          return;
        } else if(ar){
          e.preventDefault(); e.stopPropagation && e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation();
          var oi3=parseInt(t.getAttribute('data-i')||'0',10);
          state[ar][oi3].cast = state[ar][oi3].cast || [];
          state[ar][oi3].cast.push({role:'', type:'小生', actorA:'', actorB:'', actorC:'', group:'', note:'', isPublic:true});
          renderOperaBlock(ar, bid);
        } else if(pc){
          e.preventDefault(); e.stopPropagation && e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation();
          var oi4=parseInt(t.getAttribute('data-i')||'0',10);
          openCastPicker(pc, oi4);
        }
      },true);
    });
  }
  function scrollFlash(btn, key){
    try{
      var p = btn.closest('.section-block');
      if(p){ p.style.transition='box-shadow .3s'; p.style.boxShadow='0 0 0 4px rgba(251,191,36,.35)'; setTimeout(function(){p.style.boxShadow='';},600); }
    }catch(e){}
  }
  /* ---------- 保存/读取/重置 ---------- */
  function saveState(silent){
    try{
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      if(!silent){
        if(typeof toast !== 'undefined') toast('💾 已保存到本地（下次打开自动读取）','success',2600);
        else alert('✅ 已保存成功！');
      }
    }catch(e){ alert('保存失败：'+e.message);}
  }
  function loadState(){
    try{
      var raw=localStorage.getItem(LS_KEY);
      if(!raw){ alert('还没有保存过的数据，将使用默认模板'); return false; }
      state = mergeDefault(JSON.parse(raw));
      renderAll();
      if(typeof toast !== 'undefined') toast('📂 已读取上次保存的数据','success',2600);
      else alert('✅ 读取成功！');
      return true;
    }catch(e){ alert('读取失败：'+e.message); return false;}
  }
  function resetState(){
    __showConfirm('⚠ 这将清空所有内容（仅保留空白模板，确认？）', function(){
    var blank = defaultState();
    blank.header = {title:'', host:'', organizer:'', coorganizer:'', sponsor:'', date:'', time:'', venue:'', notice:''};
    blank.creative = [{pos:'出品人',name:'',note:''},{pos:'艺术总监 ★',name:'',note:''},{pos:'总导演',name:'',note:''}];
    blank.mainOpera = []; blank.addOpera = [];
    blank.wuchang = []; blank.wenchang = []; blank.stage = []; blank.program = [];
    state = blank;
    renderAll();
    if(typeof toast !== 'undefined') toast('🧹 已重置为空白','success',2200);
    });
  }
  function setMode(m){
    document.body.setAttribute('data-mode', m);
    if(m==='preview' && typeof toast !== 'undefined') toast('👁 已切换到预览模式（再次点击按钮返回编辑）','info',3000);
    if(m==='edit' && typeof toast !== 'undefined') toast('✏ 已返回编辑模式','info',2000);
  }
  /* ---------- 导出 CSV ---------- */
  function esc(s){ return '"' + ((s==null)?'':String(s).replace(/"/g,'""')) + '"'; }
  function exportCSV(){
    var lines = [];
    lines.push(['秦安县秦剧团文化演出有限公司 · 演出演员表（CSV导出）'].map(esc).join(','));
    lines.push(['导出时间', new Date().toLocaleString('zh-CN')].map(esc).join(','));
    lines.push('');
    var h = state.header;
    lines.push('【演出封面信息】');
    lines.push(['演出标题',h.title,'主办',h.host,'承办',h.organizer].map(esc).join(','));
    lines.push(['演出日期',h.date,'开演时间',h.time,'演出地点',h.venue].map(esc).join(','));
    lines.push(['协办',h.coorganizer,'赞助',h.sponsor].map(esc).join(','));
    lines.push(['温馨提示',h.notice].map(esc).join(','));
    lines.push(''); lines.push('=== 主创与艺术指导 ===');
    lines.push(['#','职位','姓名','备注'].map(esc).join(','));
    state.creative.forEach(function(r,i){ lines.push([i+1,r.pos,r.name,r.note].map(esc).join(',')); });
    lines.push('');
    function dumpOpera(title, list){
      list.forEach(function(op, oix){
        lines.push('=== '+title+' · 第'+(oix+1)+'部：'+(op.opera||'')+' ===');
        lines.push(['分类',op.type,'时长(分)',op.duration,'评级',op.rating].map(esc).join(','));
        lines.push(['剧情简介',op.intro].map(esc).join(','));
        lines.push(['#','角色','行当','A角(主演)','B角(替补)','C角(实习)','分组/行当','备注说明'].map(esc).join(','));
        (op.cast||[]).forEach(function(c,ci){
          lines.push([ci+1,c.role,c.type,c.actorA,c.actorB,c.actorC,c.group,c.note].map(esc).join(','));
        });
        lines.push('');
      });
    }
    dumpOpera('主场演出剧目（大本戏）', state.mainOpera);
    dumpOpera('加演演出剧目（折子戏/清唱）', state.addOpera);
    lines.push('=== 秦腔打击乐 · 武场乐队 ===');
    lines.push(['#','岗位/乐器','演奏员','备注'].map(esc).join(','));
    state.wuchang.forEach(function(r,i){ lines.push([i+1,r.pos,r.name,r.note].map(esc).join(',')); });
    lines.push('');
    lines.push('=== 秦腔管弦乐 · 文场乐队 ===');
    lines.push(['#','岗位/乐器','演奏员','备注'].map(esc).join(','));
    state.wenchang.forEach(function(r,i){ lines.push([i+1,r.pos,r.name,r.note].map(esc).join(',')); });
    lines.push('');
    lines.push('=== 舞台技术保障与后勤 ===');
    lines.push(['#','岗位/职责','负责人','备注'].map(esc).join(','));
    state.stage.forEach(function(r,i){ lines.push([i+1,r.pos,r.name,r.note].map(esc).join(',')); });
    lines.push('');
    lines.push('=== 演出节目单（按上台顺序） ===');
    lines.push(['#','分类','节目名称/章节','时长(分)','参演人员/负责人','备注说明'].map(esc).join(','));
    state.program.forEach(function(r,i){ lines.push([i+1,r.cat,r.name,r.duration,r.actors,r.note].map(esc).join(',')); });
    lines.push('');
    lines.push('--- 本CSV使用UTF-8 BOM编码，Excel直接打开可正确显示中文 ---');
    var csv = '\uFEFF' + lines.join('\n');
    var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var fn = '秦安县秦剧团文化演出有限公司-演员表-'+(h.date||new Date().toISOString().slice(0,10))+'-'+(h.title||'未命名').replace(/[《》\\/:*?"<>|]/g,'')+'.csv';
    a.href = url; a.download = fn;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(e){} }, 500);
    if(typeof toast !== 'undefined') toast('📤 已导出CSV：'+fn,'success',3200);
  }
  /* ---------- 20260928 整表导出XLSX / 按勾选板块导出XLSX（多Sheet+列宽+数字格式） ---------- */
  function __xlsxReady(){ return !!(window.XLSX && window.XLSX.utils && window.XLSX.writeFile); }
  function __sheetFromAoa(aoa, widths, numCols){
    var ws = window.XLSX.utils.aoa_to_sheet(aoa);
    if(widths && widths.length) ws['!cols'] = widths.map(function(w){ return { wch: w }; });
    if(numCols && numCols.length){
      for(var r=0;r<aoa.length;r++){
        for(var nc=0;nc<numCols.length;nc++){
          var c = numCols[nc];
          var cell = ws[window.XLSX.utils.encode_cell({r:r,c:c})];
          if(cell && typeof cell.v === 'number'){ cell.z = '#,##0'; }
        }
      }
    }
    return ws;
  }
  function __operaSheet(title, list){
    var aoa = [[title+' · 共'+(list||[]).length+'部']];
    (list||[]).forEach(function(op){
      aoa.push(['剧目', (op.opera||'未命名'), '分类', op.type||'', '时长(分)', op.duration||'', '评级', op.rating||'']);
      if(op.intro) aoa.push(['剧情简介', op.intro]);
      aoa.push(['#','角色','行当','A角(主演)','B角(替补)','C角(实习)','分组/行当','备注说明']);
      (op.cast||[]).forEach(function(c, ci){ aoa.push([ci+1, c.role||'', c.type||'', c.actorA||'', c.actorB||'', c.actorC||'', c.group||'', c.note||'']); });
      aoa.push([]);
    });
    return __sheetFromAoa(aoa, [5,16,10,12,12,12,12,26]);
  }
  function __simpleSheet(list, c1){
    var aoa = [['#', c1, '姓名/演奏员', '备注']];
    (list||[]).forEach(function(r,i){ aoa.push([i+1, r.pos||'', r.name||'', r.note||'']); });
    return __sheetFromAoa(aoa, [5,20,14,34]);
  }
  function buildAllWorkbook(){
    var wb = window.XLSX.utils.book_new();
    var h = state.header || {};
    var info = [
      ['秦安县秦剧团文化演出有限公司 · 演出演员表'],
      ['导出时间', new Date().toLocaleString('zh-CN')],
      [],
      ['演出标题', h.title||''], ['主办单位', h.host||''], ['承办单位', h.organizer||''],
      ['协办单位', h.coorganizer||''], ['赞助单位', h.sponsor||''],
      ['演出日期', h.date||''], ['开演时间', h.time||''], ['演出地点', h.venue||''],
      ['温馨提示', h.notice||'']
    ];
    window.XLSX.utils.book_append_sheet(wb, __sheetFromAoa(info, [14,42]), '演出信息');
    var cr = [['#','职位','姓名','备注 / 分工说明']];
    (state.creative||[]).forEach(function(r,i){ cr.push([i+1, r.pos||'', r.name||'', r.note||'']); });
    window.XLSX.utils.book_append_sheet(wb, __sheetFromAoa(cr, [5,18,12,34]), '主创团队');
    if((state.mainOpera||[]).length) window.XLSX.utils.book_append_sheet(wb, __operaSheet('主场演出剧目（大本戏）', state.mainOpera), '主场剧目');
    if((state.addOpera||[]).length) window.XLSX.utils.book_append_sheet(wb, __operaSheet('加演剧目（折子戏/清唱）', state.addOpera), '加演剧目');
    window.XLSX.utils.book_append_sheet(wb, __simpleSheet(state.wuchang,'岗位/乐器'), '武场乐队');
    window.XLSX.utils.book_append_sheet(wb, __simpleSheet(state.wenchang,'岗位/乐器'), '文场乐队');
    window.XLSX.utils.book_append_sheet(wb, __simpleSheet(state.stage,'岗位/职责'), '舞台保障');
    var pg = [['#','分类','节目名称/章节','时长(分)','参演人员/负责人','备注说明']];
    (state.program||[]).forEach(function(r,i){ pg.push([i+1, r.cat||'', r.name||'', r.duration||'', r.actors||'', r.note||'']); });
    window.XLSX.utils.book_append_sheet(wb, __sheetFromAoa(pg, [5,12,30,10,22,26]), '节目单');
    try{
      if(typeof window.__csWageBudgetAoa === 'function'){
        var wAoa = window.__csWageBudgetAoa();
        if(wAoa) window.XLSX.utils.book_append_sheet(wb, __sheetFromAoa(wAoa, [5,12,10,14,8,10,7,12], [5,6,7]), '工资预算');
      }
    }catch(_e){}
    return wb;
  }
  async function exportAllXlsx(){
    try { await window.__castEnsureXlsx(); } catch(_){
      if(typeof exportCSV === 'function'){ if(typeof toast !== 'undefined') toast('⚠️ Excel 组件加载失败，已改为导出 CSV','warning',2500); exportCSV(); }
      return;
    }
    if(typeof toast !== 'undefined') toast('📊 准备 Excel 组件...','info',1200);
    var wb = buildAllWorkbook();
    var h = state.header || {};
    var fn = '秦安县秦剧团文化演出有限公司-演出演员表-'+(h.date||new Date().toISOString().slice(0,10))+'-'+String(h.title||'未命名').replace(/[《》\\/:*?"<>|]/g,'').slice(0,20)+'.xlsx';
    window.XLSX.writeFile(wb, fn);
    if(typeof toast !== 'undefined') toast('📊 已导出全表 XLSX（'+wb.SheetNames.length+'个Sheet）：'+fn,'success',3400);
  }
  async function exportSelectedXlsx(){
    var cbs = document.querySelectorAll('input[type="checkbox"][data-ps-cb-sec]');
    var checked = [];
    for(var i=0;i<cbs.length;i++){ if(cbs[i].checked) checked.push(cbs[i].getAttribute('data-ps-cb-sec')); }
    if(!checked.length){ if(typeof toast !== 'undefined') toast('⚠️ 请先勾选要导出的板块','warning',2000); return; }
    try { await window.__castEnsureXlsx(); } catch(_){
      if(typeof exportCSV === 'function'){ if(typeof toast !== 'undefined') toast('⚠️ Excel 组件加载失败，已改为导出整表 CSV','warning',2500); exportCSV(); }
      return;
    }
    if(typeof toast !== 'undefined') toast('📊 准备 Excel 组件...','info',1200);
    var wb = window.XLSX.utils.book_new();
    var SEC = {
      creative: function(){ var aoa=[['#','职位','姓名','备注 / 分工说明']]; (state.creative||[]).forEach(function(r,i){aoa.push([i+1,r.pos||'',r.name||'',r.note||'']);}); return ['主创团队', __sheetFromAoa(aoa,[5,18,12,34])]; },
      mainOpera: function(){ return ['主场剧目', __operaSheet('主场演出剧目（大本戏）', state.mainOpera||[])]; },
      addOpera: function(){ return ['加演剧目', __operaSheet('加演剧目（折子戏/清唱）', state.addOpera||[])]; },
      stage: function(){ return ['舞台保障', __simpleSheet(state.stage,'岗位/职责')]; },
      wuchang: function(){ return ['武场乐队', __simpleSheet(state.wuchang,'岗位/乐器')]; },
      wenchang: function(){ return ['文场乐队', __simpleSheet(state.wenchang,'岗位/乐器')]; },
      program: function(){ var aoa=[['#','分类','节目名称/章节','时长(分)','参演人员/负责人','备注说明']]; (state.program||[]).forEach(function(r,i){aoa.push([i+1,r.cat||'',r.name||'',r.duration||'',r.actors||'',r.note||'']);}); return ['节目单', __sheetFromAoa(aoa,[5,12,30,10,22,26])]; }
    };
    var added = 0;
    for(var k=0;k<checked.length;k++){
      var f = SEC[checked[k]]; if(!f) continue;
      var pair = f();
      try{ window.XLSX.utils.book_append_sheet(wb, pair[1], pair[0]); added++; }catch(_e){}
    }
    if(!added){ if(typeof toast !== 'undefined') toast('⚠️ 勾选的板块暂无可导出内容','warning',2000); return; }
    var h2 = state.header || {};
    var fn2 = '秦安县秦剧团文化演出有限公司-演员表勾选板块-'+(h2.date||new Date().toISOString().slice(0,10))+'.xlsx';
    window.XLSX.writeFile(wb, fn2);
    if(typeof toast !== 'undefined') toast('📊 已导出 '+added+' 个板块：'+fn2,'success',3200);
  }
  window.__csExportAllXlsx = exportAllXlsx;
  window.__csExportSelectedXlsx = exportSelectedXlsx;
  /* ---------- 手机折叠 ---------- */
  function bindFoldBtns(){
    document.querySelectorAll('.mobile-fold-btn').forEach(function(b){
      b.addEventListener('click',function(e){
        e.preventDefault(); e.stopPropagation && e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation();
        var id = b.getAttribute && b.getAttribute('data-fold');
        var sec = b.closest('.section-block');
        if(sec){ sec.classList.toggle('folded'); }
      },true);
    });
  }
  /* ---------- 剧库Picker点击选择 ---------- */
  function bindOperaPickerClicks(){
    $('opGrid').addEventListener('click',function(e){
      var card = e.target.closest && e.target.closest('.op-card');
      if(!card) return;
      var id = card.getAttribute('data-opid');
      pickCtx.selectedOperaId = id;
      renderOperaPicker();
    },true);
    $('opSearch').addEventListener('input',function(){ renderOperaPicker(); },true);
    $('opSearch').addEventListener('keydown',function(e){ if(e.key==='Enter'){ renderOperaPicker(); } },true);
    $('opCatFilter').addEventListener('change',function(){ renderOperaPicker(); },true);
    $('opClose').addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); closeOperaPicker(); },true);
    $('opBtnCancel').addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); closeOperaPicker(); },true);
    $('opOverlay').addEventListener('click',function(e){ if(e.target===$('opOverlay')) closeOperaPicker(); },true);
    $('opBtnConfirm').addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); confirmOperaPick(); },true);
  }
  function bindCastPickerClicks(){
    $('cpClose').addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); closeCastPicker(); },true);
    $('cpOverlay').addEventListener('click',function(e){ if(e.target===$('cpOverlay')) closeCastPicker(); },true);
    $('cpOk').addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); confirmCastSelection(); },true);
    $('cpClear').addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      cpChecked={}; $('cpBody').innerHTML=buildCastPickerBody(); bindCastPickerClicks();
    },true);
    $('cpCommon').addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); applyCommonCast(); },true);
  }
  function bindTopButtons(){
    function on(id, fn){ var el=$(id); if(!el) return; el.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation && e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation(); fn(); },true); }
    on('btnReset', resetState);
    on('btnSyncRoster', function(){
      if(!(window.QAXQJT_API && QAXQJT_API.get)){ toast('⚠️ API 未就绪，无法同步','warning'); return; }
      toast('⏳ 正在从花名册同步演职人员...','info',2000);
      syncPerformersFromApi().then(function(){
        var perf = loadPerformers();
        var n = (perf.flat||[]).length;
        toast('✅ 已同步 '+n+' 名演职人员到姓名补全列表','success',3000);
      });
    });
    on('btnSave', function(){ saveState(false); });
    on('btnLoad', loadState);
    on('btnPreview', function(){ setMode('preview'); window.scrollTo({top:0,behavior:'smooth'}); });
    on('btnEdit', function(){ setMode('edit'); });
    // 2026-08-02 改为由 CastPrintBySelectionModuleV20260802 统一接管（整页打印 + 按勾选打印双模式，避免重复触发 window.print）
    on('btnPrint', function(){ /* noop: 由 PrintBySelectionModule 监听捕获阶段统一处理 */ });
    on('btnExport', exportCSV);
    on('mFabSave', function(){ saveState(false); });
    on('mFabPreview', function(){ setMode('preview'); window.scrollTo({top:0,behavior:'smooth'}); });
    on('mFabExport', exportCSV);
  }
  /* ---------- 初始化 ---------- */
  function init(){
    try{
      initPerformersDB();
    }catch(e){}
    try{ syncRealOperas(); }catch(e){}
    var raw = null;
    try{ raw = localStorage.getItem(LS_KEY); }catch(e){}
    state = mergeDefault(raw?JSON.parse(raw):null);
    // 20260922 暴露最小钩子给真实后端同步脚本（读取/替换当前编辑态）
    window.__castSheetHook = {
      getState:function(){ return state; },
      applyState:function(s){ state = mergeDefault(s); renderAll(); renderPerformersDatalist(); },
      saveLocal:function(){ try{ saveState(false); }catch(e){} },
      loadPerformers:loadPerformers
    };
    renderAll();
    renderPerformersDatalist();
    bindHeaderInput('inp-title','title');
    bindHeaderInput('inp-host','host');
    bindHeaderInput('inp-organizer','organizer');
    bindHeaderInput('inp-coorganizer','coorganizer');
    bindHeaderInput('inp-sponsor','sponsor');
    bindHeaderInput('inp-date','date');
    bindHeaderInput('inp-time','time');
    bindHeaderInput('inp-venue','venue');
    bindHeaderInput('inp-notice','notice');
    bindPublicCheckbox();
    bindSimpleBlockInputs();
    bindOperaInputs();
    bindAddButtons();
    bindDeleteButtons();
    bindFoldBtns();
    bindOperaPickerClicks();
    bindCastPickerClicks();
    bindTopButtons();
    document.body.setAttribute('data-mode','edit');
    // 自动保存（每60秒）
    setInterval(function(){ try{ saveState(true); }catch(e){} }, 60000);
    if(typeof toast !== 'undefined') toast('✅ 演员表V3加载完成 · 8大板块 · 剧库联动 · 演职库双对接 · 自动每60秒保存','success',3800);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  /* ---------- CRITICAL 修复：退出登录按钮（侧边栏 + 顶栏） + 7 类 legacy key 彻底清理 ---------- */
  function __doCastSheetLogout() {
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
  function __bindCastLogoutBtns() {
    var sb = $('logoutBtnSidebar'); if (sb) sb.addEventListener('click', function(e){ e.preventDefault && e.preventDefault(); __doCastSheetLogout(); }, true);
    var lk = $('logoutLink2'); if (lk) lk.addEventListener('click', function(e){ e.preventDefault && e.preventDefault(); __doCastSheetLogout(); }, true);
  }
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', __bindCastLogoutBtns);
    } else {
      __bindCastLogoutBtns();
    }
  } catch(_bindErr){}

})();

/* ===== cast-sheet.html inline block (run 2, #4/8) ===== */
(function __adminCommonPatchV20260730(){
    var __toastC = function(msg,type){
      try{ if(window.QinApp&&QinApp.Utils&&QinApp.Utils.toast){QinApp.Utils.toast(msg,type||'info',3000);return;} }catch(_e){}
      try{ (type==='error'?alert:console.log)('[adminCommon] '+msg); }catch(_f){}
    };
    // 1) 全局写操作防重入锁（与 schedule.html 同源：window.__OP_LOCKS）
    window.__acqCommon = function(key,ttl){
      if(window.__OP_LOCKS&&window.__OP_LOCKS[key]) return false;
      try{
        if(!window.__OP_LOCKS) window.__OP_LOCKS = {};
        window.__OP_LOCKS[key] = true;
        setTimeout(function(){try{delete window.__OP_LOCKS[key];}catch(_){}}, ttl||650);
      }catch(_lk){}
      return true;
    };
    // 2) 通用 __closeAnyModal：仅关闭“当前处于打开状态”的弹层
    //    修复 csp-hide 毒化：旧逻辑给所有弹层（含未打开的）加 csp-hide(display:none!important)
    //    且打开弹层时从不移除，导致剧库/选角/组团等弹窗关闭一次后永久打不开。
    function __layerIsOpen(el){
      if(!el || el.nodeType!==1) return false;
      var cls = el.classList;
      if(cls && (cls.contains('show')||cls.contains('active')||cls.contains('modal-show')||cls.contains('modal-overlay-show'))) return true;
      var d = el.style && el.style.display;
      return (d==='flex'||d==='block'||d==='grid');
    }
    // 打开弹层前统一调用：剥离所有隐藏类与内联 none（不改变随后的 add('show')/display='flex'）
    window.__revealLayer = function(el){
      if(!el) return el;
      try{
        el.classList.remove('csp-hide','s-overlay-hide','s-modal-hide','modal-overlay-hide','modal-wrap-hide');
        if(el.style && el.style.display==='none') el.style.display='';
      }catch(_){}
      return el;
    };
    window.__closeAnyModal = function(){
      try{
        var sels = ['.modal-overlay','[id$="Overlay"]','[id$="overlay"]','.overlay','[class*="modal-overlay"]','.modal-overlay-root','[data-overlay]',
                    '.modal','[id$="Modal"]','[id$="modal"]','[class*="modal-wrap"]','.modal-wrap','.generic-modal-root','[data-modal]','[role="dialog"]'];
        var seen = [];
        sels.forEach(function(sel){
          var arr;
          try{ arr = document.querySelectorAll(sel); }catch(_){ return; }
          arr.forEach(function(el){
            if(seen.indexOf(el)>=0) return;
            seen.push(el);
            // 只关当前确实打开的层：未打开的弹层一个类都不许动，避免连带毒化
            if(!__layerIsOpen(el)) return;
            try{
              el.classList.remove('show','active','modal-show','modal-overlay-show');
              el.classList.remove('csp-hide','s-overlay-hide','s-modal-hide','modal-overlay-hide','modal-wrap-hide');
              var d = el.style && el.style.display;
              if(d==='flex'||d==='block'||d==='grid'){ el.style.display='none'; }
            }catch(_){ try{ el.style.display='none'; }catch(_a){} }
          });
        });
      try{ document.body.classList.remove('body-modal-locked','modal-open','nav-locked'); }catch(_b){}
      }catch(err){ console.warn('[__closeAnyModal] err:', err); }
    };
    // 3) ESC 键 → 关所有弹窗 + 触发页面级 closeAddModal/closeEditModal/closeDispatchModal 若存在
    try{
      document.addEventListener('keydown', function(e){
        if(e.key==='Escape'){
          var fns = ['closeAddModal','closeEditModal','closeDispatchModal','closeOrderViewModal','closeDeleteConfirm'];
          for(var i=0;i<fns.length;i++){ try{ if(typeof window[fns[i]]==='function') window[fns[i]](); }catch(_){} }
          window.__closeAnyModal();
        }
      }, true);
    }catch(_escErr){}
    // 4) 查询栏 ↻重置 按钮：真正把同级 select/input 清空回默认
    function __resetFilterBar(root){
      if(!root) root = document.querySelector('.admin-filter-bar, [class*="filter-bar"]');
      if(!root) return 0;
      var sels = root.querySelectorAll('select');
      var inputs = root.querySelectorAll('input[type=text],input:not([type]),input[type=search],input[type=date],input[type=number]');
      var n = 0;
      try{
        sels.forEach(function(s){ try{ s.selectedIndex = 0; }catch(_){} n++; });
        inputs.forEach(function(inp){ try{ inp.value=''; inp.checked=false; }catch(_){} n++; });
      }catch(_r){}
      return n;
    }
    // 5) 绑定「重置」按钮 + 空 a[href=#] 阻止跳转 + 侧边栏菜单 href=# 死链兜底
    function __bindButtonsOnce(){
      try{
        var rbtns = document.querySelectorAll('button, .btn, a.btn, a.action-link');
        rbtns.forEach(function(b){
          if(b.__sBound) return;
          var txt = (b.textContent||'').replace(/\s+/g,' ').trim();
          if(txt.indexOf('重置')>=0 && txt.indexOf('今日')<0 && txt.indexOf('密码')<0){
            b.addEventListener('click', function(){
              if(!window.__acqCommon('c_reset_'+Math.random().toString(36).slice(2,6),450)) return;
              var n = __resetFilterBar();
              __toastC('↺ 查询条件已重置（'+n+' 项恢复默认）','success');
            }, true);
            b.__sBound = 1;
          }
          if(txt.indexOf('取消')>=0 || txt.indexOf('关闭')>=0){
            b.addEventListener('click', function(ev){
              // 若按钮本身已有 onclick 事件（非 # href），交给原始 onclick；仅兜底关弹窗
              try{ if(ev && ev.stopPropagation) ev.stopPropagation(); }catch(_s){}
              setTimeout(function(){ window.__closeAnyModal(); }, 220);
            }, true);
          }
        });
        // 所有 a[href="#"] → preventDefault 避免跳到页面顶部
        var hs = document.querySelectorAll('a[href="#"]');
        hs.forEach(function(a){
          if(a.__sBound2) return;
          a.addEventListener('click', function(ev){
            var ex = (a.getAttribute('onclick')||'') + (a.getAttribute('data-toggle')||'');
            if(ex.length < 2 && !a.classList.contains('action-link')){
              // 没有 onclick 也非 action-link → 死链，提示并阻止跳
              if(ev && ev.preventDefault) ev.preventDefault();
              __toastC('⚠️ 该链接暂未绑定功能（href="#")','warning');
              return false;
            }
          }, true);
          a.__sBound2 = 1;
        });
        // 6) 侧边栏 admin-sidebar-menu 菜单项链接正确性兜底
        try{
          var menuMap = [
            {kw:'账号权限管理', target:'accounts.html'},
            {kw:'订单预约管理', target:'orders.html'},
            {kw:'官网内容管理', target:'content.html'},
            {kw:'系统日志备份', target:'system.html'},
            {kw:'数据大屏', target:'index.html'},
            {kw:'员工人事', target:'staff.html'},
            {kw:'演出剧目', target:'operas.html'},
            {kw:'演出排期', target:'schedule.html'},
            {kw:'阵容管理', target:'cast-sheet.html'},
            {kw:'道具库存', target:'inventory.html'},
            {kw:'薪酬财务', target:'finance.html'},
            {kw:'考勤报表', target:'reports.html'}
          ];
          var lis = document.querySelectorAll('.admin-sidebar-menu li, .sidebar-nav li, .menu-nav li, .sider-list li');
          lis.forEach(function(li){
            var t = (li.textContent||'').replace(/\s+/g,' ').trim();
            var a = li.querySelector('a');
            if(!a || !t) return;
            for(var j=0;j<menuMap.length;j++){
              if(t.indexOf(menuMap[j].kw)>=0 && a.getAttribute('href') !== menuMap[j].target){
                try{ a.setAttribute('href', menuMap[j].target); a.removeAttribute('onclick'); a.__sBound=1; }catch(_s){}
                break;
              }
            }
          });
        }catch(_mErr){}
      }catch(_bErr){ console.warn('[bindButtonsOnce err]:', _bErr); }
    }
    if(document.readyState==='complete' || document.readyState==='interactive'){ setTimeout(__bindButtonsOnce, 150); }
    else document.addEventListener('DOMContentLoaded', function(){ setTimeout(__bindButtonsOnce, 150); });
    console.info('[adminCommonPatchV20260730 已应用：去抖锁 + __closeAnyModal + 重置真重置 + ESC关弹窗 + 侧边栏死链修复 + 页码圆角CSS]');
  })();

/* ===== cast-sheet.html inline block (run 2, #5/8) ===== */
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
    __pLog('DBF','save_submit', Object.assign({},__pEvt,{row:trKey, lock:__pLk}));
        /* P1修复:假成功已移除（不再伪造保存成功、不再假关弹窗） */
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; try { e.stopPropagation(); } catch(_b){} return;
      }
      if(isEdit){
        if(!__L(doneKey,700)) return;
        __pLog('DBF','edit_open', Object.assign({},__pEvt,{row:trKey, branch:'edit'}));
        /* P1修复:假成功已移除（演示文案不再展示） */ __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      if(isDel){
        if(!__L(doneKey,850)) { __T('⏳ 删除处理中…','warning'); try { e.stopPropagation(); } catch(_a){} return; }
        /* P1修复:假成功已移除（不再伪造删行与确认框） */
        __pLog('DBF','delete_confirm', Object.assign({},__pEvt,{row:trKey, branch:'delete'}));
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; try { e.stopPropagation(); } catch(_b){} return;
      }
      if(isView){
        if(!__L(doneKey,500)) return;
        __pLog('DBF','view_detail', Object.assign({},__pEvt,{row:trKey, branch:'view'}));
        /* P1修复:假成功已移除（演示文案不再展示） */ __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      if(isVerify){
        if(!__L(doneKey,900)) { __T('⏳ 核销处理中…','warning'); return; }
        __pLog('DBF','verify_confirm', Object.assign({},__pEvt,{row:trKey, branch:'verify'}));
        /* P1修复:假成功已移除 */ __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      if(isExport){
        if(!__L(doneKey,1200)) { __T('⏳ 正在导出，请稍候…','warning'); return; }
        __pLog('DBF','export_start', Object.assign({},__pEvt,{row:trKey, branch:'export'}));
        /* P1修复:假成功已移除 */ __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      if(isAdd){
        if(!__L(doneKey,900)) return;
        __pLog('DBF','add_new', Object.assign({},__pEvt,{branch:'add'}));
        /* P1修复:假成功已移除 */ __T('该功能暂未接入后端','warning');
        btn.__ctE2Done = 1; return;
      }
      // ---- 新增：审核/审批/驳回/通过 ----
      var isAudit = txt.indexOf('审核')>=0 || txt.indexOf('审批')>=0 || txt.indexOf('驳回')>=0 || txt.indexOf('通过')>=0;
      if(isAudit){
        if(!__L(doneKey,850)){ __T('⏳ 审核处理中…','warning'); try{e.stopPropagation();}catch(_a){} return; }
        /* P1修复:假成功已移除（不再伪造审核结果与确认框） */
        __pLog('DBF','audit_result', Object.assign({},__pEvt,{row:trKey, branch:'audit'}));
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done=1; try{e.stopPropagation();}catch(_b){} return;
      }
      // ---- 新增：签约/签订 ----
      var isSign = txt.indexOf('签约')>=0 || txt.indexOf('签订')>=0 || (txt.indexOf('签')>=0 && txt.indexOf('约')>=0);
      if(isSign){
        if(!__L(doneKey,900)){ __T('⏳ 签约流程处理中…','warning'); try{e.stopPropagation();}catch(_a){} return; }
        /* P1修复:假成功已移除（不再伪造签约与确认框） */
        __pLog('DBF','sign_confirm', Object.assign({},__pEvt,{row:trKey, branch:'sign'}));
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done=1; try{e.stopPropagation();}catch(_b){} return;
      }
      // ---- 新增：合同/生成合同 ----
      var isContract = txt.indexOf('合同')>=0 && !isSign;
      if(isContract){
        if(!__L(doneKey,1000)){ __T('⏳ 正在准备合同文档…','warning'); return; }
        __pLog('DBF','contract_ready', Object.assign({},__pEvt,{row:trKey, branch:'contract'}));
        /* P1修复:假成功已移除 */ __T('该功能暂未接入后端','warning');
        btn.__ctE2Done=1; return;
      }
      // ---- 新增：排期/排班/安排档期 ----
      var isScheduleBtn = txt.indexOf('排期')>=0 || txt.indexOf('排班')>=0 || (txt.indexOf('安排')>=0 && (txt.length<=8 || txt.indexOf('档期')>=0));
      if(isScheduleBtn){
        if(!__L(doneKey,800)){ __T('⏳ 正在打开排期面板…','warning'); return; }
        __pLog('DBF','schedule_open', Object.assign({},__pEvt,{row:trKey, branch:'schedule'}));
        /* P1修复:假成功已移除 */ __T('该功能暂未接入后端','warning');
        btn.__ctE2Done=1; return;
      }
      // ---- 新增：取消/处理/确认接单 ----
      var isCancelOrHandle = txt.indexOf('取消')>=0 || txt.indexOf('处理')>=0 || txt.indexOf('确认接单')>=0 || txt.indexOf('派工')>=0;
      if(isCancelOrHandle && !isDel && !isSave){
        if(!__L(doneKey,800)){ __T('⏳ 处理中…','warning'); try{e.stopPropagation();}catch(_a){} return; }
        /* P1修复:假成功已移除（不再伪造状态变更与确认框） */
        __pLog('DBF','status_change', Object.assign({},__pEvt,{row:trKey}));
        __T('该功能暂未接入后端','warning');
        btn.__ctE2Done=1; try{e.stopPropagation();}catch(_b){} return;
      }

    }, true);
    console.info('[DeadButtonFallback 已加载：死按钮兜底委托（P1修复：未接入功能仅提示，不伪造成功）]');
  })();
  
} /* end of 防重复注入保护 if */

/* ===== cast-sheet.html inline block (run 2, #6/8) ===== */
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
        /* P1修复:假成功已移除：本页无真实后端表单提交实现，仅提示；保留 preventDefault 防原生刷新 */
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
                  try{ n.classList.remove('csp-hide'); }catch(_){}
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
        if (window.QinPagination) return; // 真分页器已接管，跳过假分页注入（orders/finance 同款修复范式）
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
      if(typeof btn.onclick === 'function') return true; // 修复：JS property 绑定的 onclick 也算已绑定，禁止 SuperPatch 兜底拦截（曾导致行按钮第一次点击被吞）
      if(btn.__deadBtnChecked) return true;
      if(btn.__superPatchBound) return true;
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
        if(btn.closest && btn.closest('.pagination-bar, .pagination')) return; // 分页条按钮放行（orders/finance 同款修复）
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
        /* P1修复:假成功已移除：死按钮兜底不再伪造成功/演示反馈，统一提示未接入 */
        __pLog('SP','fallback_'+tt, {branch:tt, txt:txt, row:trKey});
        __toastH9('该功能暂未接入后端','warning');
        return false;
      }catch(e6){ console.warn('[SuperPatch 6/6 click err]',e6); }
    }, true);
    console.info('[SuperPatch 6/6] 已激活 ✓');
  }catch(e){ console.warn('[SuperPatch 6/6 init err]',e); }

  console.info('['+PATCH_ID+'] 6合1超级补丁全部加载完毕 ✓');
})();

} /* end of 防重复注入保护 if */

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
    var curId=getCurId(); var sheets=getSheets(); var cur=sheets.filter(function(s){return s.id===curId;})[0];
    if(!cur){ toast('⚠️ 默认存档不可删除','warning',2000); return; }
    var delName=cur.name;
    __showConfirm('确定删除存档「'+delName+'」？此操作不可撤销！', function(){
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
  // 20260922 组团样板的人选只能来自真实演职库（/v1/performers 同步缓存）；人数不足时姓名留空，由用户手工指派
  function _realNamePool(){
    var groups={actor:[],band:[],front:[],costume:[],electric:[]};
    try{
      var p=loadPerformers(); var flat=(p&&p.flat)||[];
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
  function _slot(cat,name,role,grade){ return {cat:cat,name:name||'',role:role,grade:grade,daily:WAGE_GRADES[grade].daily}; }
  function generate36Template(){
    var template=[];
    var pool=_realNamePool();
    var actorSlots=[['文须生','W5'],['文须生','W4'],['小生','W5'],['小生','W3'],['正旦','W6'],['正旦','W4'],['小旦','W5'],['小旦','W3'],['大花脸','W6'],['二花脸','W4'],['丑角','W4'],['武须生','W5'],['二架旦','W4'],['彩旦','W3'],['武须生','W5'],['丑角','W3'],['二花脸','W4'],['门官','W3']];
    actorSlots.forEach(function(s,i){ template.push(_slot('actor', pool.actor[i], s[0], s[1])); });
    var bandSlots=[['板胡','W6'],['二胡','W4'],['竹笛','W4'],['三弦','W3'],['司鼓','W6'],['大锣','W3'],['铙钹','W3'],['梆子','W2']];
    bandSlots.forEach(function(s,i){ template.push(_slot('band', pool.band[i], s[0], s[1])); });
    var frontSlots=[['前场','W5'],['前场','W2'],['前场','W2'],['前场','W1']];
    frontSlots.forEach(function(s,i){ template.push(_slot('front', pool.front[i], s[0], s[1])); });
    var costumeSlots=[['衣箱','W4'],['衣箱','W3'],['衣箱','W3']];
    costumeSlots.forEach(function(s,i){ template.push(_slot('costume', pool.costume[i], s[0], s[1])); });
    var electricSlots=[['电工','W4'],['电工','W4'],['电工','W2']];
    electricSlots.forEach(function(s,i){ template.push(_slot('electric', pool.electric[i], s[0], s[1])); });
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
    var wage=0;
    wage+=a*280; wage+=b*220; wage+=f*120; wage+=c*200; wage+=e*240;
    $('cgWage').textContent='¥'+wage.toLocaleString('zh-CN');
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
  function buildGroup(cat,count,pool){
    var roles=CG_ROLES[cat]||[]; var names=(pool&&pool[cat])||[];
    for(var i=0;i<count;i++){
      var role=roles[i%roles.length];
      var name=names[i]||'';
      var grade=pickGrade(i,count);
      template.push({cat:cat,name:name,role:role,grade:grade,daily:WAGE_GRADES[grade].daily});
    }
  }
    var _pool=_realNamePool();
    buildGroup('actor',a,_pool); buildGroup('band',b,_pool); buildGroup('front',f,_pool); buildGroup('costume',c,_pool); buildGroup('electric',e,_pool);
    try{ localStorage.setItem(LS_TROUPE,JSON.stringify(template)); }catch(_){}
    updateTroupeStats(template);
    var tpDays=$('tpDays'); if(tpDays){ tpDays.value=days; }
    fillBlocksFromTemplate(template);
    closeCustomGroupModal();
    toast('🛠 已生成'+total+'人自定义组团样板（演员'+a+'+乐队'+b+'+前场'+f+'+服装'+c+'+电工'+e+'），已填入各板块表格','success',3500);
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
  function printWageSheet(e){
    if(e){ try{ e.preventDefault(); e.stopPropagation(); }catch(_){} }
    var template=getCurrentTemplate(); if(!template||template.length===0){ toast('⚠️ 请先生成组团模板','warning',2000); return; }
    var days=parseInt($('tpDays')?$('tpDays').value:3)||3;
    var win=window.open('','_blank');
    var html='<html><head><title>天工资商议单</title><style>body{font-family:SimSun,Arial}table{border-collapse:collapse;width:100%}th,td{border:1px solid #333;padding:6px 10px}th{background:#f0f7ff}h1{text-align:center}.total{font-weight:bold;color:#dc3545}</style></head><body>';
    html+='<h1>秦安县秦剧团文化演出有限公司 · 天工资商议单</h1>';
    html+='<p>演出天数：'+days+'天 | 生成日期：'+new Date().toLocaleDateString('zh-CN')+'</p>';
    html+='<table><tr><th>序号</th><th>姓名</th><th>组别</th><th>行当/岗位</th><th>工资等级</th><th>日薪(元)</th><th>'+days+'天合计(元)</th></tr>';
    var total=0;
    for(var i=0;i<template.length;i++){ var p=template[i]; var sub=(p.daily||0)*days; total+=sub; var catName={actor:'演员组',band:'乐队组',front:'前场',costume:'服装化妆',electric:'电工'}[p.cat]||p.cat; html+='<tr><td>'+(i+1)+'</td><td>'+p.name+'</td><td>'+catName+'</td><td>'+p.role+'</td><td>'+(WAGE_GRADES[p.grade]?WAGE_GRADES[p.grade].name:p.grade)+'</td><td>'+p.daily+'</td><td>'+sub+'</td></tr>'; }
    html+='<tr class="total"><td colspan="6">合计</td><td>'+total+'</td></tr>';
    html+='</table><scr'+'ipt>/* 按钮防拦截：为有id的可点击元素预设 __superPatchBound，避免 SuperPatch 首次点击拦截 */\n(function(){\n  function __markBound(){\n    var els=document.querySelectorAll("button[id], a[id], [data-action][id], .btn[id], .btn-action[id]");\n    for(var i=0;i<els.length;i++){ var el=els[i]; if(!el.__superPatchBound){ el.__superPatchBound=1; } }\n  }\n  if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded",__markBound); }\n  else { __markBound(); setTimeout(__markBound,500); }\n})();<\/scr'+'ipt>\n</body></html>';
    win.document.write(html); win.document.close(); setTimeout(function(){ win.print(); },500);
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
      tpl.forEach(function(p){ var g=WAGE_GRADES[p.grade]; if(g&&p.daily!==g.daily){ p.daily=g.daily; hit++; } });
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
