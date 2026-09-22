/*!
 * real-performers.js · 20260922
 * 真实演职人员统一加载层（admin 派工/排期/阵容页共用）
 * 数据源：GET /v1/performers（在册真实人员）；本地缓存 qaxqjt_performers_v1
 * 不内置任何假名单：无数据/未登录时所有分组为空。
 */
(function () {
  'use strict';
  if (window.QinRealPerformers) return;

  var KEYS = ['laosheng', 'xusheng', 'xiaosheng', 'qingyi', 'huadan', 'laodan', 'hualian', 'choujue', 'longtao', 'band', 'stage'];
  function emptyGroups() {
    var g = {};
    KEYS.forEach(function (k) { g[k] = []; });
    return g;
  }

  var groups = emptyGroups();

  function bucket(role) {
    var s = String(role || '');
    if (/司鼓|板鼓|梆子|大锣|小锣|马锣|铙|钹|镲|堂鼓|战鼓|木鱼|打击|鼓|板胡|二胡|高胡|椰胡|扬琴|琵琶|三弦|古筝|竹笛|梅管|唢呐|海笛|笙|大提琴|贝司|提琴|电子琴|琴/.test(s)) return 'band';
    if (/舞台监督|监督|剧务|催场|场记|灯光|音响|话筒|耳麦|麦|服装|跟包|盔箱|化妆|大头|勾脸|脸谱|道具|装台|布景|拆台|字幕|电工|后勤|设备|配电/.test(s)) return 'stage';
    if (/龙套/.test(s)) return 'longtao';
    if (/红生|老生|须生/.test(s)) return 'laosheng';
    if (/小生|武生/.test(s)) return 'xiaosheng';
    if (/青衣|正旦/.test(s)) return 'qingyi';
    if (/花旦|闺门旦|武旦/.test(s)) return 'huadan';
    if (/老旦/.test(s)) return 'laodan';
    if (/花脸|铜锤|架子花|净/.test(s)) return 'hualian';
    if (/彩旦|丑婆|丑/.test(s)) return 'choujue';
    return 'stage';
  }

  function assign(items) {
    groups = emptyGroups();
    var seen = {};
    items.forEach(function (p) {
      var name = p.name || p.performerName || '';
      if (!name || seen[name]) return;
      seen[name] = 1;
      var role = p.primaryRole || p.roleCategory || p.role || '';
      groups[bucket(role)].push({ name: name, role: role });
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
        // 同步写 cast-sheet 兼容缓存（canonical 13 分类）
        writeCompatibleCache(items);
      } catch (e) {}
    }).catch(function () { /* 保持空态，绝不造假数据 */ });
  }

  // cast-sheet.html 兼容：canonical 13 分类（与该页 _bucketOf 保持一致）
  function canonicalBucket(role) {
    var s = String(role || '');
    var rules = [
      ['武场', /司鼓|板鼓|梆子|大锣|小锣|马锣|铙|钹|镲|堂鼓|战鼓|木鱼|打击|鼓/],
      ['文场', /板胡|二胡|高胡|椰胡|扬琴|琵琶|三弦|古筝|竹笛|梅管|唢呐|海笛|笙|大提琴|贝司|提琴|电子琴|琴/],
      ['舞台', /舞台监督|监督|剧务|催场|场记|灯光|音响|话筒|耳麦|麦|服装|跟包|盔箱|化妆|大头|勾脸|脸谱|道具|装台|布景|拆台|字幕|电工|后勤/],
      ['红生', /红生/], ['老生', /老生/], ['小生', /小生/], ['武生', /武生/],
      ['青衣', /青衣|正旦/], ['花旦', /花旦|闺门旦|武旦/], ['老旦', /老旦/],
      ['彩旦', /彩旦|丑婆/], ['花脸', /花脸|铜锤|架子花|净/], ['丑行', /丑/]
    ];
    for (var i = 0; i < rules.length; i++) { if (rules[i][1].test(s)) return rules[i][0]; }
    return '舞台';
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
    get groups() { return groups; }
  };
})();
