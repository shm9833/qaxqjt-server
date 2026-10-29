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
        // v20261017fix：缓存本人协议日工资，供组团模板/天工资商议单日薪优先取用
        var dr = (p.dailyRate != null && Number(p.dailyRate) > 0) ? Number(p.dailyRate) : null;
        groups[cat].push({ name:name, skill:role, note:'', dailyRate:dr });
        flat.push({ id:p.id||'', name:name, skill:role, note:'', category:cat, dailyRate:dr });
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
  // 20261016 修复：自定义确认弹窗原仅在本闭包内可见，business.js 等其他 IIFE 调用会 ReferenceError，挂到 window 复用
  try{ window.__showConfirm = __showConfirm; }catch(_eSC){}

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

  /* ==================== 批量导入 XLSX ==================== */
  /* 与 exportAllXlsx 输出格式对称：解析多 Sheet 还原 state */
  function _cellStr(c){ if(c==null||c===undefined) return ''; if(typeof c==='number') return String(c); return String(c); }
  function _sheetToAoa(ws){
    try { return window.XLSX.utils.sheet_to_json(ws, {header:1, defval:''}); }
    catch(_){ return []; }
  }
  function _parseHeaderSheet(aoa){
    var h = state.header || {};
    var map = {
      '演出标题':'title', '主办单位':'host', '承办单位':'organizer',
      '协办单位':'coorganizer', '赞助单位':'sponsor',
      '演出日期':'date', '开演时间':'time', '演出地点':'venue', '温馨提示':'notice'
    };
    for(var i=0;i<aoa.length;i++){
      var k = _cellStr(aoa[i][0]).trim();
      if(map[k]){ h[map[k]] = _cellStr(aoa[i][1]); }
    }
    return h;
  }
  function _parseSimpleSheet(aoa, key){
    var rows = [];
    var start = -1;
    for(var i=0;i<aoa.length;i++){
      var first = _cellStr(aoa[i][0]).trim();
      if(first==='#' || first==='序号'){ start = i+1; break; }
    }
    if(start < 0) return rows;
    for(var j=start;j<aoa.length;j++){
      var r = aoa[j]; if(!r || (!_cellStr(r[1]) && !_cellStr(r[2]))) continue;
      rows.push({ pos:_cellStr(r[1]).trim(), name:_cellStr(r[2]).trim(), note:_cellStr(r[3]).trim(), isPublic:true });
    }
    return rows;
  }
  function _parseOperaSheet(aoa){
    var ops = [];
    var i = 0;
    while(i < aoa.length){
      var r = aoa[i];
      if(_cellStr(r[0]).trim()==='剧目'){
        var op = { opera:_cellStr(r[1]).trim(), type:_cellStr(r[3]).trim()||'传统本戏',
          duration:_cellStr(r[5]).trim(), rating:_cellStr(r[7]).trim()||'⭐常演保留剧目', intro:'', cast:[] };
        /* 下一行可能是剧情简介 */
        var nr = aoa[i+1];
        if(nr && _cellStr(nr[0]).trim()==='剧情简介'){ op.intro = _cellStr(nr[1]).trim(); i++; }
        /* 跳过表头行：# / 角色 / 行当 / A角 / B角 / C角 / 分组 / 备注 */
        var hr = aoa[i+1];
        if(hr && (_cellStr(hr[0]).trim()==='#' || _cellStr(hr[1]).trim()==='角色')){ i++; }
        /* 读取 cast 行直到遇到空行或下一个剧目 */
        i++;
        while(i < aoa.length){
          var cr = aoa[i];
          var c0 = _cellStr(cr[0]).trim();
          if(c0==='剧目') break;           /* 下一个剧目开始 */
          if(!_cellStr(cr[1]) && !_cellStr(cr[2])){ i++; continue; }  /* 空行跳过 */
          op.cast.push({
            role:_cellStr(cr[1]).trim(), type:_cellStr(cr[2]).trim()||'小生',
            actorA:_cellStr(cr[3]).trim(), actorB:_cellStr(cr[4]).trim(),
            actorC:_cellStr(cr[5]).trim(), group:_cellStr(cr[6]).trim(),
            note:_cellStr(cr[7]).trim(), isPublic:true
          });
          i++;
        }
        if(op.opera || op.cast.length) ops.push(op);
      } else {
        i++;
      }
    }
    return ops;
  }
  function _parseProgramSheet(aoa){
    var rows = [];
    var start = -1;
    for(var i=0;i<aoa.length;i++){
      if(_cellStr(aoa[i][0]).trim()==='#'){ start = i+1; break; }
    }
    if(start < 0) return rows;
    for(var j=start;j<aoa.length;j++){
      var r = aoa[j];
      if(!r || (!_cellStr(r[1]) && !_cellStr(r[2]))) continue;
      rows.push({ cat:_cellStr(r[1]).trim(), name:_cellStr(r[2]).trim(),
        duration:_cellStr(r[3]).trim(), actors:_cellStr(r[4]).trim(),
        note:_cellStr(r[5]).trim(), isPublic:true });
    }
    return rows;
  }

  async function importFromXlsx(file){
    try { await window.__castEnsureXlsx(); }
    catch(_){ if(typeof toast!=='undefined')toast('⚠️ Excel 组件加载失败，无法导入','error',2500); return; }
    try{
      var wb = await new Promise(function(res,rej){
        var rd = new FileReader();
        rd.onload = function(e){ try{ res(window.XLSX.read(e.target.result, {type:'array'})); }catch(err){ rej(err); } };
        rd.onerror = function(){ rej(new Error('文件读取失败')); };
        rd.readAsArrayBuffer(file);
      });
      var sheets = wb.Sheets, names = wb.SheetNames;
      var summary = {};
      /* 演出信息 */
      if(sheets['演出信息']){ state.header = _parseHeaderSheet(_sheetToAoa(sheets['演出信息'])); summary.演出信息='✓'; }
      /* 主创团队 */
      if(sheets['主创团队']){ state.creative = _parseSimpleSheet(_sheetToAoa(sheets['主创团队']), 'creative'); summary.主创团队 = state.creative.length+'条'; }
      /* 主场剧目 */
      if(sheets['主场剧目']){ state.mainOpera = _parseOperaSheet(_sheetToAoa(sheets['主场剧目'])); summary.主场剧目 = state.mainOpera.length+'部'; }
      /* 加演剧目 */
      if(sheets['加演剧目']){ state.addOpera = _parseOperaSheet(_sheetToAoa(sheets['加演剧目'])); summary.加演剧目 = state.addOpera.length+'部'; }
      /* 武场 / 文场 / 舞台保障 */
      if(sheets['武场乐队']){ state.wuchang = _parseSimpleSheet(_sheetToAoa(sheets['武场乐队']), 'wuchang'); summary.武场乐队 = state.wuchang.length+'条'; }
      if(sheets['文场乐队']){ state.wenchang = _parseSimpleSheet(_sheetToAoa(sheets['文场乐队']), 'wenchang'); summary.文场乐队 = state.wenchang.length+'条'; }
      if(sheets['舞台保障']){ state.stage = _parseSimpleSheet(_sheetToAoa(sheets['舞台保障']), 'stage'); summary.舞台保障 = state.stage.length+'条'; }
      /* 节目单 */
      if(sheets['节目单']){ state.program = _parseProgramSheet(_sheetToAoa(sheets['节目单'])); summary.节目单 = state.program.length+'条'; }

      renderAll();
      var parts = Object.keys(summary).map(function(k){ return k+':'+summary[k]; });
      if(typeof toast!=='undefined') toast('📥 导入成功：' + parts.join(' | '), 'success', 4000);
    }catch(e){
      console.error('[import]', e);
      if(typeof toast!=='undefined') toast('❌ 导入失败：' + (e.message||'文件格式不正确'), 'error', 3500);
    }
  }
  window.__csImportFromXlsx = importFromXlsx;

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
      loadPerformers:loadPerformers,
      // 20261016 新增：角色关联库 / 版本历史管理 所需接口
      render:function(){ renderAll(); renderPerformersDatalist(); },
      persist:function(){ try{ saveState(true); }catch(e){} },
      guessType:guessTypeByName,
      typeOptions:TYPE_OPTIONS,
      castGroups:CAST_GROUPS
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

