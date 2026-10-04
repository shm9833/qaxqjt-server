/**
 * admin-blank.js — 生产空白态守卫（v20260906g）
 *
 * 用途：后台部分页面（仪表盘/排班/派工单/剧目库/内容/报表/账号日志等）历史遗留大量
 *      写死在 HTML 或 JS 数组里的演示数据。后端已清空、真实业务数据待录入期间，
 *      本守卫按各页声明的配置，在演示数据容器处渲染「暂无数据」空态，并把统计数字归零。
 *
 * 机制：
 *  - 各页通过 window.__ADMIN_BLANK_CFG__ 声明规则（title/sel/zeroStats 等）；
 *  - 守卫在 0.4s/1.2s/2.5s/4.5s/7s 多次执行（覆盖页面自身晚渲染），
 *    并在每次点击（tab 切换/筛选）后 300ms 再执行一次；
 *  - 真实 API 接线（orders/finance/inventory/staff 花名册等）的表不在规则目标内，不受影响。
 */
(function () {
  'use strict';
  if (window.__ADMIN_BLANK_GUARD__) return;
  window.__ADMIN_BLANK_GUARD__ = true;

  var EMPTY_COLOR = 'var(--text-light,#94a3b8)';
  function _esc(s) { return String(s == null ? '' : s); }

  function emptyRowHtml(cols, msg) {
    return '<tr class="admin-blank-row"><td colspan="' + (cols || 12)
      + '" style="text-align:center;padding:34px 18px;color:' + EMPTY_COLOR
      + ';font-size:0.92rem;line-height:1.8;">' + _esc(msg) + '</td></tr>';
  }
  function emptyBoxHtml(msg) {
    return '<div class="admin-blank-box" style="text-align:center;padding:48px 20px;color:'
      + EMPTY_COLOR + ';font-size:0.92rem;line-height:1.9;width:100%;">' + _esc(msg) + '</div>';
  }

  function cardsByTitle(re) {
    var out = [];
    var cards = document.querySelectorAll('.admin-card');
    for (var i = 0; i < cards.length; i++) {
      var h = cards[i].querySelector('.admin-card-header h3, .admin-card-header h2, h3, h2');
      if (h && re.test(h.textContent || '')) out.push(cards[i]);
    }
    return out;
  }

  function blankCard(card, rule) {
    if (!card) return;
    var msg = rule.msg || '暂无数据，真实业务数据录入后自动展示';
    if (rule.tbody) {
      var tb = card.querySelectorAll('tbody');
      for (var i = 0; i < tb.length; i++) {
        // 空态守卫：页面自身重渲染后仍按规则重置（重复执行幂等）
        tb[i].innerHTML = emptyRowHtml(rule.cols || 12, rule.tbody);
      }
      // 卡片内的静态假分页（共 N 条 / 假页码）隐藏
      card.querySelectorAll('div.pagination, .pagination-bar-static').forEach(function (p) {
        if (!p.classList.contains('pagination-bar')) p.style.setProperty('display', 'none', 'important');
      });
    } else if (rule.body) {
      var body = card.querySelector('.admin-card-body');
      if (body) body.innerHTML = emptyBoxHtml(rule.body);
    }
  }

  function blankSelector(rule) {
    var els = document.querySelectorAll(rule.sel);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (rule.tbody === true || rule.as === 'tbody') {
        el.innerHTML = emptyRowHtml(rule.cols || 12, rule.msg || '暂无数据');
      } else {
        el.innerHTML = emptyBoxHtml(rule.msg || '暂无数据，真实业务数据录入后自动展示');
      }
    }
  }

  function zeroStats(scopeSel) {
    var scope = scopeSel ? document.querySelectorAll(scopeSel) : [document];
    scope.forEach(function (root) {
      if (!root) return;
      var cards = root.querySelectorAll ? root.querySelectorAll('.stat-card, .stats-grid > div, .stat-tile, .kpi-card') : [];
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        if (c.__adminBlankZeroed) continue;
        var v = c.querySelector('.stat-card-value, .stat-value, .stat-number, .kpi-value, .value');
        if (v) {
          var unit = v.querySelector('span, small');
          v.textContent = '0';
          if (unit) v.appendChild(unit);
          c.__adminBlankZeroed = true;
        }
        var sub = c.querySelector('.stat-card-sub, .stat-sub');
        if (sub && sub.textContent.indexOf('暂无') < 0) sub.innerHTML = '<span style="color:' + EMPTY_COLOR + ';">暂无数据</span>';
        var trend = c.querySelector('.stat-card-trend, .stat-trend');
        if (trend) trend.style.setProperty('visibility', 'hidden');
      }
    });
  }

  function runOnce() {
    var cfg = window.__ADMIN_BLANK_CFG__ || [];
    try {
      for (var i = 0; i < cfg.length; i++) {
        var rule = cfg[i];
        try {
          if (rule.title) {
            cardsByTitle(rule.title).forEach(function (card) {
              blankCard(card, rule);
            });
          }
          if (rule.sel) blankSelector(rule);
          if (rule.zeroStats) zeroStats(rule.zeroStats === true ? null : rule.zeroStats);
          if (typeof rule.fn === 'function') rule.fn({ emptyRowHtml: emptyRowHtml, emptyBoxHtml: emptyBoxHtml, cardsByTitle: cardsByTitle });
        } catch (e) { /* 单条规则失败不影响其它 */ }
      }
    } catch (_) {}
  }

  var delays = [400, 1200, 2500, 4500, 7000, 10000, 15000, 25000];
  delays.forEach(function (d) { setTimeout(runOnce, d); });
  // tab 切换 / 筛选点击后，页面自身 JS 可能重渲染 → 延迟再清
  document.addEventListener('click', function () { setTimeout(runOnce, 250); setTimeout(runOnce, 700); }, true);

  window.__ADMIN_BLANK_RUN__ = runOnce;
})();
