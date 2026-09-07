/**
 * roster-cast.js — 派工/排期人员选择器：从真实花名册(/v1/performers)按行当动态分组（v20260906g）
 *
 * 背景：orders 派工弹窗、schedule 排期派工/新增排期三处原为写死的演示人员名单。
 *       生产空白态要求不再内置假人员——改由本助手拉取真实在册演职人员，
 *       按行当关键字（primaryRole）与队别（employmentType）自动分组渲染；
 *       花名册为空或后端不可达时显示空态，录入真实人员后自动出现。
 *
 * 用法：window.__ROSTER_CAST__.render(box, {
 *   groups: [{k:'ls', n:'老生'}, ...],      // 可选，覆盖展示顺序与名称（k 须用内置键）
 *   cls: 'dispatch-group-card',             // 可选，分组卡 class
 *   head: function(name, count) -> html,    // 可选，自定义分组头
 *   row: function(g, idx, p) -> html,       // 可选，自定义人员行
 *   emptyHtml: '...',                       // 可选，空态内容
 *   done: function(rendered) {}             // 渲染完成回调（绑定事件用）
 * });
 */
(function () {
  'use strict';
  if (window.__ROSTER_CAST__) return;

  var GROUPS = [
    { k: 'ls',    n: '老生', kw: ['老生'] },
    { k: 'xs',    n: '须生', kw: ['须生'] },
    { k: 'xiaos', n: '小生', kw: ['小生', '武生'] },
    { k: 'qy',    n: '青衣', kw: ['青衣'] },
    { k: 'hd',    n: '花旦', kw: ['花旦', '彩旦', '武旦'] },
    { k: 'ld',    n: '老旦', kw: ['老旦'] },
    { k: 'hl',    n: '花脸', kw: ['花脸', '净角', '铜锤', '架子花'] },
    { k: 'cj',    n: '丑角', kw: ['丑'] },
    { k: 'lt',    n: '龙套', kw: ['龙套'] },
    { k: 'bd',    n: '乐队', kw: ['乐队', '司鼓', '板胡', '京胡', '二胡', '扬琴', '三弦', '笙', '唢呐', '笛', '琵琶', '中阮', '大提琴', '打击', '琴师', '操琴'] },
    { k: 'wm',    n: '舞美', kw: ['舞美', '灯光', '音响', '服装', '道具', '舞台', '监督', '字幕', '化妆'] }
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function matchK(p) {
    var s = String((p && p.primaryRole) || '').trim();
    if (s) {
      for (var i = 0; i < GROUPS.length; i++) {
        var kws = GROUPS[i].kw;
        for (var j = 0; j < kws.length; j++) {
          if (s.indexOf(kws[j]) >= 0) return GROUPS[i].k;
        }
      }
    }
    var dept = String((p && (p.employmentType || p.dept)) || '');
    if (dept.indexOf('乐队') >= 0) return 'bd';
    if (dept.indexOf('舞美') >= 0 || dept.indexOf('舞台') >= 0 || dept.indexOf('服装') >= 0) return 'wm';
    return 'qt';
  }

  var _promise = null;
  function loadRows() {
    if (_promise) return _promise;
    _promise = new Promise(function (resolve) {
      var n = 0;
      (function wait() {
        var api = window.QAXQJT_API;
        if (api && typeof api.get === 'function') { resolve(api); return; }
        if (n++ < 40) setTimeout(wait, 300); else resolve(null);
      })();
    }).then(function (api) {
      if (!api) return [];
      return api.get('/v1/performers', {
        query: { page: 1, pageSize: 500 },
        showErrorToast: false,
        timeoutMs: 8000,
        fallbackRead: function () { return null; }
      }).then(function (res) {
        var rows = Array.isArray(res) ? res : (res && res.items) || [];
        return rows.filter(function (p) {
          return p && p.name && String(p.status || 'active') !== 'inactive';
        });
      });
    }).catch(function () { return []; });
    return _promise;
  }

  var EMPTY_HTML = '<div style="grid-column:1/-1;text-align:center;padding:40px 18px;color:var(--text-light,#94a3b8);font-size:.92rem;line-height:1.9;">'
    + '暂无在册演职人员，请先到「演职人员管理」录入真实花名册<br>'
    + '<span style="font-size:.8rem;">录入后此处按行当自动生成分配名单</span></div>';

  window.__ROSTER_CAST__ = {
    esc: esc,
    matchK: matchK,
    load: loadRows,
    EMPTY_HTML: EMPTY_HTML,
    render: function (box, opts) {
      opts = opts || {};
      if (!box) return Promise.resolve();
      box.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:28px;color:var(--text-light,#94a3b8);font-size:.85rem;">正在读取在册演职人员…</div>';
      return loadRows().then(function (rows) {
        if (!rows.length) {
          box.innerHTML = opts.emptyHtml || EMPTY_HTML;
          if (opts.done) opts.done([]);
          return;
        }
        var byK = {};
        rows.forEach(function (p) {
          var k = matchK(p);
          (byK[k] = byK[k] || []).push(p);
        });
        box.innerHTML = '';
        var groups = (opts.groups || GROUPS).slice();
        if (byK.qt && byK.qt.length) groups.push({ k: 'qt', n: '其他/未标注行当' });
        var rendered = [];
        groups.forEach(function (g) {
          var ppl = byK[g.k] || [];
          if (!ppl.length) return;
          var label = g.n || g.k;
          rendered.push({ k: g.k, n: label, ppl: ppl });
          var card = document.createElement('div');
          if (opts.cls) card.className = opts.cls;
          card.innerHTML = (opts.head ? opts.head(label, ppl.length) : '')
            + ppl.map(function (p, idx) { return opts.row ? opts.row(g, idx, p) : ''; }).join('');
          box.appendChild(card);
        });
        if (opts.done) opts.done(rendered);
      });
    }
  };
})();
