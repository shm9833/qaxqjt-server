/*!
 * real-performers.js · 20261003
 * 真实演职人员统一加载层（admin 派工/排期/阵容页共用）
 * 数据源：GET /v1/performers（在册真实人员）；本地缓存 qaxqjt_performers_v1
 * 行当口径（20261003 修订）：6 大行 23 角色 + 武场/文场，与 cast-sheet.html _bucketOf 完全一致
 * 不内置任何假名单：无数据/未登录时所有分组为空。
 */
(function () {
  'use strict';
  if (window.QinRealPerformers) return;

  // 25 分类（23 角色 + 武场 + 文场）
  var ROLE_RULES = [
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
    for (var i = 0; i < ROLE_RULES.length; i++) { if (ROLE_RULES[i][1].test(s)) return ROLE_RULES[i][0]; }
    return '前场';
  }
  var GROUP_OF = {
    '文须生':'sheng', '武须生':'sheng', '小生':'sheng',
    '丑角':'chou',
    '大花脸':'jing', '二花脸':'jing',
    '正旦':'dan', '小旦':'dan', '彩旦':'dan', '二架旦':'dan',
    '门官':'erjia', '家院':'erjia',
    '龙套':'juezi', '校尉':'juezi', '刀斧手':'juezi', '丫鬟':'juezi', '彩女':'juezi', '长随官':'juezi',
    '帽箱':'houqin', '电工':'houqin', '前场':'houqin', '衣箱':'houqin', '剧务':'houqin',
    '武场':'wuchang', '文场':'wenchang'
  };
  var KEYS = ['sheng','chou','jing','dan','erjia','juezi','wuchang','wenchang','houqin'];
  function emptyGroups() {
    var g = {};
    KEYS.forEach(function (k) { g[k] = []; });
    return g;
  }

  var groups = emptyGroups();

  function bucket(role) {
    return GROUP_OF[stdRole(role)] || 'houqin';
  }

  function assign(items) {
    groups = emptyGroups();
    var seen = {};
    items.forEach(function (p) {
      var name = p.name || p.performerName || '';
      if (!name || seen[name]) return;
      seen[name] = 1;
      var role = p.primaryRole || p.roleCategory || p.role || '';
      var std = stdRole(role);
      groups[bucket(role)].push({ name: name, role: role, stdRole: std });
    });
    return groups;
  }

  // 先读缓存（cast-sheet 等页面也写同一缓存，schema 兼容）
  try {
    var raw = localStorage.getItem('qaxqjt_performers_v1');
    if (raw) {
      var cached = JSON.parse(raw);
      if (cached && cached._version === 2 && Array.isArray(cached.flat)) {
        assign(cached.flat.map(function (x) { return { name: x.name, primaryRole: x.skill }; }));
      }
    }
  } catch (e) {}

  var ready = Promise.resolve();
  if (window.QAXQJT_API && QAXQJT_API.get) {
    ready = QAXQJT_API.get('/v1/performers', { query: { pageSize: 500 } }).then(function (d) {
      var items = Array.isArray(d) ? d : ((d && d.items) || []);
      assign(items);
      try {
        // 同步写 cast-sheet 兼容缓存（25 分类：23 角色 + 武场/文场）
        writeCompatibleCache(items);
      } catch (e) {}
    }).catch(function () { /* 保持空态，绝不造假数据 */ });
  }

  // cast-sheet.html 兼容：25 分类（与该页 _bucketOf 完全一致，兜底"前场"）
  function canonicalBucket(role) {
    return stdRole(role);
  }
  function writeCompatibleCache(items) {
    var performersGroups = {};
    var flat = items.map(function (p) {
      var name = p.name || p.performerName || '';
      var role = p.primaryRole || p.roleCategory || p.role || '';
      var cat = canonicalBucket(role);
      if (!performersGroups[cat]) performersGroups[cat] = [];
      performersGroups[cat].push({ name: name, skill: role, note: '' });
      return { id: p.id || '', name: name, skill: role, note: '', category: cat };
    });
    localStorage.setItem('qaxqjt_performers_v1', JSON.stringify({ _seededAt: new Date().toISOString(), _version: 2, performers: performersGroups, flat: flat }));
  }
  window.QinRealPerformers = {
    ready: ready,
    stdRole: stdRole,
    groupKey: bucket,
    get groups() { return groups; }
  };
})();
