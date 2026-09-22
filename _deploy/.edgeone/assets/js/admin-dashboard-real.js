/*!
 * admin-dashboard-real.js · 20260922
 * admin/index.html 仪表盘真实数据层：
 * 统计卡 + 欢迎栏待办数 + 近期预约订单表，全部来自后端真实接口。
 * 无数据时显示 0 / 空状态，绝不使用演示数字。
 */
(function () {
  'use strict';

  function unwrap(d) {
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.items)) return d.items;
    if (d && Array.isArray(d.list)) return d.list;
    if (d && Array.isArray(d.rows)) return d.rows;
    return [];
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function api() { return window.QAXQJT_API || null; }
  function ym(d) {
    var t = d ? new Date(d) : new Date();
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0');
  }
  function ymd(d) {
    var t = d ? new Date(d) : null;
    if (!t || isNaN(t.getTime())) return '';
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  }
  function money(n) { return '¥' + Number(n || 0).toLocaleString('zh-CN'); }

  function setCard(titleKw, value, subHtml) {
    var cards = document.querySelectorAll('.stats-grid .stat-card');
    for (var i = 0; i < cards.length; i++) {
      var t = cards[i].querySelector('.stat-card-title');
      if (t && t.textContent.indexOf(titleKw) >= 0) {
        var v = cards[i].querySelector('.stat-card-value');
        if (v && v.firstChild) v.firstChild.textContent = value;
        var trend = cards[i].querySelector('.stat-card-trend');
        if (trend) trend.innerHTML = '<span>●</span><span>实时</span>';
        if (subHtml !== undefined) {
          var sub = cards[i].querySelector('.stat-card-sub');
          if (sub) sub.innerHTML = subHtml;
        }
        return;
      }
    }
  }

  var STATUS_BADGE = {
    draft: ['badge-secondary', '草稿'],
    confirmed: ['badge-info', '已确认'],
    partial_paid: ['badge-warning', '部分付款'],
    paid: ['badge-success', '已付款'],
    performance: ['badge-warning', '演出中'],
    completed: ['badge-success', '已完成'],
    cancelled: ['badge-danger', '已取消'],
    refunded: ['badge-danger', '已退款']
  };

  function renderRecentOrders(rows) {
    var heads = document.querySelectorAll('.admin-card-header h3');
    var cardBody = null;
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].textContent.indexOf('近期预约订单') >= 0) {
        cardBody = heads[i].closest('.admin-card');
        break;
      }
    }
    if (!cardBody) return;
    var tbody = cardBody.querySelector('tbody[data-paginate="list"]') || cardBody.querySelector('tbody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#94a3b8;">📭 暂无预约订单（可在订单管理中创建第一条）</td></tr>';
      return;
    }
    tbody.innerHTML = rows.slice(0, 10).map(function (o) {
      var oid = esc(o.id || o.orderNo || '');
      var st = STATUS_BADGE[o.status] || ['badge-secondary', esc(o.status || '草稿')];
      var date = o.performanceStartDate ? ymd(o.performanceStartDate) : '—';
      var play = esc(o.playTitles || o.orderType || '演出');
      var cnt = o.performanceCount || 1;
      return '<tr>'
        + '<td style="font-weight:600;color:var(--primary-dark);font-family:monospace;">' + oid + '</td>'
        + '<td>' + esc(o.customerName || o.organization || '—') + '</td>'
        + '<td>' + esc(o.phone || '—') + '</td>'
        + '<td>' + play + ' ' + cnt + '场</td>'
        + '<td>' + date + '</td>'
        + '<td style="font-weight:600;color:var(--primary);">' + money(o.finalAmount || o.totalAmount || 0) + '</td>'
        + '<td><span class="badge ' + st[0] + '">' + st[1] + '</span></td>'
        + '<td><div class="admin-table-actions"><a class="btn btn-sm btn-secondary" href="orders.html">详情</a></div></td>'
        + '</tr>';
    }).join('');
  }

  function isActor(role) {
    return /老生|红生|小生|武生|青衣|正旦|花旦|闺门|武旦|老旦|彩旦|花脸|铜锤|架子|净|丑/.test(String(role || ''));
  }
  function isBand(role) {
    return /鼓|梆|锣|铙|钹|镲|胡|琴|扬琴|琵琶|三弦|筝|笛|唢呐|笙|提琴|贝司/.test(String(role || ''));
  }

  function init() {
    var A = api();
    if (!A) return;
    var nowY = new Date().getFullYear();
    var thisMonth = ym();

    // 先清掉静态演示数字，避免数据返回前展示假数据
    ['年度演出场次', '本月预约订单', '待确认档期', '当月营收', '在演职人员', '库存预警'].forEach(function (k) {
      setCard(k, '—', '<span>正在加载真实数据…</span>');
    });
    var heads = document.querySelectorAll('.admin-card-header h3');
    for (var h = 0; h < heads.length; h++) {
      if (heads[h].textContent.indexOf('近期预约订单') >= 0) {
        var tb = heads[h].closest('.admin-card').querySelector('tbody');
        if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#94a3b8;">正在加载真实订单…</td></tr>';
        break;
      }
    }

    Promise.all([
      A.get('/v1/orders', { query: { page: 1, pageSize: 200 } }).catch(function () { return []; }),
      A.get('/v1/schedules', { query: { page: 1, pageSize: 200 } }).catch(function () { return []; }),
      A.get('/v1/performers', { query: { page: 1, pageSize: 500 } }).catch(function () { return []; }),
      A.get('/v1/inventory', { query: { page: 1, pageSize: 500 } }).catch(function () { return []; })
    ]).then(function (res) {
      var orders = unwrap(res[0]);
      var schedules = unwrap(res[1]);
      var performers = unwrap(res[2]);
      var inventory = unwrap(res[3]);

      // 订单
      var monthOrders = orders.filter(function (o) {
        var d = o.createdAt ? String(o.createdAt).slice(0, 7) : '';
        return d === thisMonth;
      });
      var pendingOrders = orders.filter(function (o) { return ['draft'].indexOf(o.status) >= 0; }).length;
      var monthRevenue = monthOrders.reduce(function (s, o) {
        return s + Number(o.finalAmount != null ? o.finalAmount : (o.totalAmount || 0));
      }, 0);

      // 排期
      var yearShows = schedules.filter(function (s) {
        var d = s.date || (s.scheduleDateStart ? ymd(s.scheduleDateStart) : '');
        return String(d).indexOf(nowY + '-') === 0 && ['scheduled', 'confirmed', 'completed', 'performance'].indexOf(s.status) >= 0;
      }).length;
      var pendingSchedules = schedules.filter(function (s) { return s.status === 'scheduled'; }).length;

      // 演职人员
      var actors = performers.filter(function (p) { return isActor(p.primaryRole || p.roleCategory); }).length;
      var bands = performers.filter(function (p) { return isBand(p.primaryRole || p.roleCategory); }).length;
      var logistics = Math.max(performers.length - actors - bands, 0);

      // 库存预警
      var lowStock = inventory.filter(function (it) {
        var qty = Number(it.quantity);
        var safe = Number(it.safetyStock || 0);
        return (!isNaN(qty) && safe > 0 && qty <= safe) || /low|warn|out|short/i.test(it.status || '');
      });

      setCard('年度演出场次', yearShows, '<span>本年已公布排期</span>');
      setCard('本月预约订单', monthOrders.length, '<span>本月新增 ' + monthOrders.length + ' 单</span>');
      setCard('待确认档期', pendingSchedules, '<span>待确认排期总数</span>');
      setCard('当月营收', money(monthRevenue), '<span>本月订单金额合计</span>');
      setCard('在演职人员', performers.length,
        '<span>演员 ' + actors + ' 人</span><span class="divider"></span><span>乐队/后勤 ' + (bands + logistics) + ' 人</span>');
      setCard('库存预警', lowStock.length,
        lowStock.length ? '<span>' + esc(lowStock.slice(0, 2).map(function (x) { return x.name; }).join('、')) + '</span>'
                       : '<span>库存充足</span>');

      // 欢迎栏待办
      var tip = document.querySelector('.welcome-banner .tip');
      if (tip) {
        tip.innerHTML = '今日有 <strong style="color:var(--gold)">' + pendingSchedules + '</strong> 个待确认档期 · <strong style="color:var(--gold)">' + pendingOrders + '</strong> 条新预约订单等待处理';
      }

      renderRecentOrders(orders);

      // 日历：真实排期（M-D -> 当天场次）
      var schedMap = {};
      schedules.forEach(function (s) {
        var m = String(s.date || '').match(/^\d{4}-(\d{2})-(\d{2})/);
        if (m) {
          var key = Number(m[1]) + '-' + Number(m[2]);
          schedMap[key] = (schedMap[key] || 0) + 1;
        }
      });
      window.__realSchedMap = schedMap;
      try { if (typeof window.resetMonth === 'function') window.resetMonth(); } catch (_) {}

      // 最新系统动态：由真实订单/排期/库存生成
      renderNotices(orders, pendingSchedules, lowStock);

      // 剧目演出频次（近6个月真实排期）
      renderBarChart(schedules);

      try { if (window.QinPagination && typeof QinPagination.init === 'function') QinPagination.init(); } catch (_) {}
    });
  }

  function noticeHtml(icon, cls, title, desc, time) {
    return '<div class="notice-item"><div class="notice-icon ' + cls + '">' + icon + '</div>'
      + '<div class="notice-content"><div class="notice-title">' + esc(title) + '</div>'
      + (desc ? '<div class="notice-desc">' + esc(desc) + '</div>' : '')
      + '</div>' + (time ? '<div class="notice-time">' + esc(time) + '</div>' : '') + '</div>';
  }
  function agoText(d) {
    var t = d ? new Date(d).getTime() : NaN;
    if (isNaN(t)) return '';
    var h = Math.max(0, Math.round((Date.now() - t) / 3600000));
    if (h < 1) return '刚刚';
    if (h < 24) return h + '小时前';
    return Math.round(h / 24) + '天前';
  }

  function renderNotices(orders, pendingSchedules, lowStock) {
    var box = document.querySelector('.system-notice-list');
    if (!box) return;
    var html = '';
    var drafts = orders.filter(function (o) { return o.status === 'draft'; }).slice(0, 3);
    drafts.forEach(function (o) {
      html += noticeHtml('📋', 'info', '新预约订单',
        (o.customerName || '客户') + ' 提交预约（' + (o.performanceCount || 1) + '场），请及时审核',
        agoText(o.createdAt));
    });
    if (pendingSchedules > 0) {
      html += noticeHtml('📅', 'warning', '待确认档期', '当前有 ' + pendingSchedules + ' 个排期待确认，请前往排班页处理', '');
    }
    lowStock.slice(0, 3).forEach(function (it) {
      html += noticeHtml('⚠️', 'warning', '库存预警', (it.name || '物品') + ' 当前库存 ' + it.quantity + '，安全库存 ' + (it.safetyStock || 0), '');
    });
    if (!html) {
      html = '<div class="notice-item" style="grid-column:1/-1;"><div class="notice-icon info">✅</div>'
        + '<div class="notice-content"><div class="notice-title">暂无待处理动态</div>'
        + '<div class="notice-desc">新订单、排期与库存提醒将在此实时展示</div></div></div>';
    }
    box.innerHTML = html;
  }

  var BAR_COLORS = ['', 'gold', 'teal', 'green', 'purple', 'warning'];
  function renderBarChart(schedules) {
    var chart = document.querySelector('.bar-chart');
    var totalEl = document.getElementById('dashBarFooterTotal');
    if (!chart) return;
    var since = Date.now() - 183 * 86400000;
    var counts = {};
    var total = 0;
    schedules.forEach(function (s) {
      if (s.status === 'cancelled') return;
      var t = s.date ? new Date(s.date).getTime() : NaN;
      if (isNaN(t) || t < since) return;
      var name = s.playTitle || '未关联剧目';
      counts[name] = (counts[name] || 0) + 1;
      total++;
    });
    var top = Object.keys(counts).map(function (k) { return { name: k, count: counts[k] }; })
      .sort(function (a, b) { return b.count - a.count; }).slice(0, 6);
    if (!top.length) {
      chart.innerHTML = '<div style="text-align:center;padding:30px 0;color:#94a3b8;">近6个月暂无真实排期数据</div>';
      if (totalEl) totalEl.textContent = '累计演出场次：0 · 覆盖剧目：0';
      return;
    }
    var max = top[0].count;
    chart.innerHTML = top.map(function (x, i) {
      var pct = Math.max(8, Math.round(x.count / max * 100));
      var cls = BAR_COLORS[i] || '';
      return '<div class="bar-chart-item"><div class="bar-chart-label">《' + esc(x.name) + '》</div>'
        + '<div class="bar-chart-track"><div class="bar-chart-fill ' + cls + '" style="width:' + pct + '%;">'
        + '<span class="bar-chart-value">' + x.count + '场</span></div></div>'
        + '<div class="bar-chart-count">' + x.count + '场</div></div>';
    }).join('');
    if (totalEl) totalEl.textContent = '累计演出场次：' + total + ' · 覆盖剧目：' + Object.keys(counts).length;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
