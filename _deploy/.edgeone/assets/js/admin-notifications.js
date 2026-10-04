/* ==========================================================================
 * js/admin-notifications.js —— 后台头部「🔔 通知 / ✉️ 消息」真实面板（v20260928a）
 * ----------------------------------------------------------------------------
 * 🔔 通知：聚合真实业务待办（无权限/失败的来源自动隐藏，不报错）
 *   1. 待审核预约申请  GET /v1/appointments/stats          → orders.html
 *   2. 待审核演职人员  GET /v1/performers?status=pending   → staff.html
 *   3. 待确认档期      GET /v1/schedules                   → schedule.html
 *   4. 库存预警        GET /v1/inventory/items             → inventory.html
 *   5. 未收欠款订单    GET /v1/orders                      → orders.html
 * ✉️ 消息：已发布官网公告 GET /v1/contents/public?type=notice → 前台新闻页
 * 设计：按钮 capture 阶段接管 + 全套防劫持标记；面板内全部为真实 href 链接。
 * ========================================================================== */
(function (global) {
  'use strict';
  if (global.__QAXNotif) return;
  global.__QAXNotif = { version: '20260928b' };

  var CACHE_TTL = 60 * 1000; // 60 秒内存缓存
  var cache = { todo: { t: 0, items: null, count: 0 }, msg: { t: 0, items: null } };
  var openPanel = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function markBtn(b) {
    b.__superPatchBound = 1; b.__ts3Done = 1; b.__bindDone = 1; b.__ctE2Done = 1; b.__deadBtnChecked = 1;
    return b;
  }

  function rowsOf(d) {
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.items)) return d.items;
    if (d && Array.isArray(d.rows)) return d.rows;
    if (d && Array.isArray(d.data)) return d.data;
    return [];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtMoney(n) { return '¥' + (Math.round(Number(n || 0) * 100) / 100).toLocaleString('zh-CN'); }
  function ymd(d) { return d ? String(d).slice(0, 10) : ''; }
  function ago(d) {
    var t = d ? new Date(d).getTime() : NaN;
    if (isNaN(t)) return '';
    var h = Math.max(0, Math.round((Date.now() - t) / 3600000));
    if (h < 1) return '刚刚';
    if (h < 24) return h + '小时前';
    return Math.round(h / 24) + '天前';
  }

  function apiGet(path, query) {
    var A = global.QAXQJT_API;
    if (!A) return Promise.reject(new Error('no-api'));
    return A.get(path, { query: query || {}, showErrorToast: false, timeoutMs: 12000 });
  }

  /* ---------------- 🔔 业务待办聚合 ---------------- */
  function loadTodos(force) {
    if (!force && cache.todo.items && (Date.now() - cache.todo.t) < CACHE_TTL) {
      return Promise.resolve(cache.todo);
    }
    var tasks = [
      // 1. 待审核预约（stats 含 pendingCount）
      apiGet('/v1/appointments/stats').then(function (s) {
        var n = Number(s && (s.pendingCount != null ? s.pendingCount : (s.byStatus && s.byStatus.pending))) || 0;
        return n > 0 ? {
          icon: '📋', level: 'warn', href: 'orders.html',
          title: '待审核预约申请', desc: n + ' 条客户预约等待审核处理'
        } : null;
      }).catch(function () { return null; }),

      // 2. 待审核演职人员（自助登记 status=pending）
      apiGet('/v1/performers', { status: 'pending', page: 1, pageSize: 200 }).then(function (d) {
        var n = rowsOf(d).length;
        return n > 0 ? {
          icon: '👨‍🎤', level: 'warn', href: 'staff.html',
          title: '待审核演职人员', desc: n + ' 名人员自助登记，等待审核入库'
        } : null;
      }).catch(function () { return null; }),

      // 3. 待确认档期
      apiGet('/v1/schedules', { page: 1, pageSize: 500 }).then(function (d) {
        var n = rowsOf(d).filter(function (s) { return s.status === 'scheduled'; }).length;
        return n > 0 ? {
          icon: '📅', level: 'warn', href: 'schedule.html',
          title: '待确认演出档期', desc: n + ' 个排期状态为「待确认」'
        } : null;
      }).catch(function () { return null; }),

      // 4. 库存预警
      apiGet('/v1/inventory/items', { page: 1, pageSize: 500 }).then(function (d) {
        var low = rowsOf(d).filter(function (it) {
          var q = Number(it.quantity), safe = Number(it.safetyStock || 0);
          return !isNaN(q) && safe > 0 && q <= safe;
        });
        var names = low.slice(0, 2).map(function (x) { return x.name; }).join('、');
        return low.length > 0 ? {
          icon: '⚠️', level: 'danger', href: 'inventory.html',
          title: '库存预警 ' + low.length + ' 项',
          desc: names + (low.length > 2 ? ' 等' : '') + ' 已达安全库存线'
        } : null;
      }).catch(function () { return null; }),

      // 5. 未收欠款（非取消订单 finalAmount - paidAmount > 0.01）
      apiGet('/v1/orders', { page: 1, pageSize: 500 }).then(function (d) {
        var unpaid = rowsOf(d).filter(function (o) {
          if (['cancelled', 'canceled', 'void'].indexOf(o.status) >= 0) return false;
          var bal = Number(o.finalAmount || 0) - Number(o.paidAmount || 0);
          return bal > 0.01;
        });
        var sum = unpaid.reduce(function (s, o) { return s + (Number(o.finalAmount || 0) - Number(o.paidAmount || 0)); }, 0);
        return unpaid.length > 0 ? {
          icon: '💰', level: 'danger', href: 'orders.html',
          title: '未收欠款 ' + unpaid.length + ' 单',
          desc: '合计待收 ' + fmtMoney(sum)
        } : null;
      }).catch(function () { return null; })
    ];

    return Promise.all(tasks).then(function (arr) {
      var items = arr.filter(Boolean);
      var r = { t: Date.now(), items: items, count: items.length };
      cache.todo = r;
      return r;
    });
  }

  /* ---------------- ✉️ 官网公告消息 ---------------- */
  function loadMsgs(force) {
    if (!force && cache.msg.items && (Date.now() - cache.msg.t) < CACHE_TTL) {
      return Promise.resolve(cache.msg);
    }
    return apiGet('/v1/contents/public', { type: 'notice', page: 1, pageSize: 10 })
      .then(function (d) {
        var items = rowsOf(d).slice(0, 10).map(function (c) {
          return {
            icon: '📢',
            href: '../news.html',
            title: c.title || '（无标题公告）',
            desc: c.summary ? String(c.summary).slice(0, 40) : (c.publishDate ? ymd(c.publishDate) : ''),
            time: ago(c.publishDate || c.updatedAt || c.createdAt),
            blank: true
          };
        });
        var r = { t: Date.now(), items: items };
        cache.msg = r;
        return r;
      })
      .catch(function () { return { t: Date.now(), items: [] }; });
  }

  /* ---------------- 面板 UI ---------------- */
  var CSS_ID = '__qntf-style';
  function injectCss() {
    if (document.getElementById(CSS_ID)) return;
    var css = '' +
      '.qntf-panel{position:fixed;z-index:10000;width:330px;max-width:calc(100vw - 16px);background:#fff;border:1px solid #e5e7eb;border-radius:14px;' +
      'box-shadow:0 16px 44px rgba(15,23,42,.22);overflow:hidden;font-size:13px;color:#1f2937;animation:qntf-in .12s ease-out;}' +
      '@keyframes qntf-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}' +
      '.qntf-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:linear-gradient(135deg,#0F4C81,#16619e);color:#fff;}' +
      '.qntf-head .t{font-weight:700;font-size:.92rem}.qntf-head .r{display:flex;gap:8px;align-items:center}' +
      '.qntf-head button{background:rgba(255,255,255,.16);border:none;color:#fff;border-radius:6px;padding:3px 8px;font-size:.72rem;cursor:pointer;line-height:1.4;}' +
      '.qntf-list{max-height:min(60vh,420px);overflow-y:auto;padding:6px;}' +
      '.qntf-item{display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:10px;text-decoration:none;color:inherit;transition:background .15s;}' +
      '.qntf-item:hover{background:#f3f7fb}.qntf-item .ic{font-size:1.05rem;line-height:1.3;flex-shrink:0}' +
      '.qntf-item .bd{min-width:0;flex:1}.qntf-item .ti{font-weight:600;font-size:.85rem;color:#163b5c;line-height:1.35}' +
      '.qntf-item .ds{font-size:.75rem;color:#6b7280;margin-top:2px;line-height:1.4;word-break:break-all}' +
      '.qntf-item .tm{font-size:.68rem;color:#9ca3af;white-space:nowrap;margin-top:2px}' +
      '.qntf-item .ar{color:#c0c7d0;font-size:.8rem;align-self:center;flex-shrink:0}' +
      '.qntf-item .bdg{display:inline-block;margin-left:6px;font-size:.62rem;font-weight:700;padding:1px 6px;border-radius:999px;vertical-align:1px}' +
      '.qntf-item .bdg.warn{background:#fef3c7;color:#b45309}.qntf-item .bdg.danger{background:#fee2e2;color:#b91c1c}' +
      '.qntf-empty{padding:34px 18px;text-align:center;color:#9ca3af;line-height:1.7}' +
      '.qntf-empty .big{font-size:1.7rem;display:block;margin-bottom:6px}' +
      '.qntf-foot{padding:9px 14px;border-top:1px solid #f0f2f5;text-align:center}' +
      '.qntf-foot a{color:#0F4C81;font-size:.78rem;text-decoration:none;font-weight:600}' +
      '.qntf-dot{display:inline-block;min-width:15px;height:15px;line-height:15px;padding:0 4px;border-radius:999px;' +
      'background:#dc2626;color:#fff;font-size:.62rem;font-weight:700;text-align:center;vertical-align:top;margin-left:-7px;margin-top:-3px;}';
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  function position(panel, btn) {
    var r = btn.getBoundingClientRect();
    panel.style.visibility = 'hidden';
    panel.style.display = 'block';
    var w = panel.offsetWidth;
    var left = Math.min(Math.max(8, r.right - w), Math.max(8, global.innerWidth - w - 10));
    var top = r.bottom + 10;
    if (top + panel.offsetHeight > global.innerHeight - 8) top = Math.max(8, r.top - panel.offsetHeight - 10);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.visibility = '';
  }

  function itemHtml(it) {
    var bdg = it.level ? '<span class="bdg ' + (it.level === 'danger' ? 'danger' : 'warn') + '">' +
      (it.level === 'danger' ? '紧急' : '待办') + '</span>' : '';
    return '<a class="qntf-item" href="' + esc(it.href) + '"' + (it.blank ? ' target="_blank" rel="noopener"' : '') + '>' +
      '<span class="ic">' + it.icon + '</span>' +
      '<span class="bd"><span class="ti">' + esc(it.title) + bdg + '</span>' +
      (it.desc ? '<span class="ds">' + esc(it.desc) + '</span>' : '') + '</span>' +
      (it.time ? '<span class="tm">' + esc(it.time) + '</span>' : '<span class="ar">›</span>') +
      '</a>';
  }

  function close() {
    if (!openPanel) return;
    if (openPanel.el && openPanel.el.parentNode) openPanel.el.parentNode.removeChild(openPanel.el);
    openPanel = null;
  }

  function open(btn, kind) {
    if (openPanel) { close(); return; } // 再点同一按钮=关闭
    injectCss();
    var isTodo = kind === 'todo';
    var panel = document.createElement('div');
    panel.className = 'qntf-panel';
    panel.innerHTML =
      '<div class="qntf-head"><span class="t">' + (isTodo ? '🔔 业务待办通知' : '✉️ 系统公告消息') + '</span>' +
      '<span class="r"><button type="button" data-qntf="refresh" class="qntf-real">🔄 刷新</button></span></div>' +
      '<div class="qntf-list"><div class="qntf-empty">正在加载…</div></div>' +
      (isTodo ? '<div class="qntf-foot"><a href="index.html">前往数据看板查看汇总</a></div>'
        : '<div class="qntf-foot"><a href="../news.html" target="_blank" rel="noopener">在官网查看全部公告 ↗</a></div>');
    document.body.appendChild(panel);
    position(panel, btn);
    openPanel = { el: panel, kind: kind, btn: btn };

    panel.addEventListener('click', function (ev) {
      var rb = ev.target.closest && ev.target.closest('[data-qntf="refresh"]');
      if (rb) { ev.preventDefault(); ev.stopPropagation(); render(true); }
    }, true);

    function render(force) {
      var box = $('.qntf-list', panel);
      box.innerHTML = '<div class="qntf-empty">正在加载…</div>';
      var job = isTodo ? loadTodos(force) : loadMsgs(force);
      job.then(function (r) {
        if (openPanel && openPanel.el !== panel) return; // 已切换/关闭
        var items = r.items || [];
        if (!items.length) {
          box.innerHTML = isTodo
            ? '<div class="qntf-empty"><span class="big">✅</span>暂无待处理通知<br>所有业务流转正常</div>'
            : '<div class="qntf-empty"><span class="big">📭</span>暂无公告消息</div>';
          return;
        }
        box.innerHTML = items.map(itemHtml).join('');
      }).catch(function () {
        box.innerHTML = '<div class="qntf-empty">加载失败，请稍后重试</div>';
      });
    }
    render(false);
  }

  /* ---------------- 按钮绑定 ---------------- */
  function setBadge(btn, count) {
    var dot = btn.querySelector('.notify-dot');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'notify-dot';
      btn.appendChild(dot);
    }
    if (count > 0) {
      dot.textContent = count > 99 ? '99+' : String(count);
      dot.style.cssText = 'display:inline-block;min-width:15px;height:15px;line-height:15px;padding:0 4px;' +
        'border-radius:999px;background:#dc2626;color:#fff;font-size:.62rem;font-weight:700;text-align:center;' +
        'vertical-align:top;margin-left:-8px;margin-top:-4px;';
    } else {
      dot.style.display = 'none';
    }
  }

  function bind() {
    var btns = $all('button.admin-header-btn').filter(function (b) {
      return b.title === '通知' || b.title === '消息';
    });
    btns.forEach(function (b) {
      if (b.__qntfBound) return;
      b.__qntfBound = 1;
      markBtn(b);
      var kind = b.title === '通知' ? 'todo' : 'msg';
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        open(b, kind);
      }, true);
    });

    // 点外部 / Esc 关闭
    document.addEventListener('click', function (ev) {
      if (!openPanel) return;
      if (openPanel.el.contains(ev.target) || openPanel.btn.contains(ev.target)) return;
      close();
    }, false);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') close();
    }, true);
    global.addEventListener('resize', function () { if (openPanel) position(openPanel.el, openPanel.btn); }, true);

    // 静默预加载待办 → 更新红点
    setTimeout(function () {
      loadTodos(false).then(function (r) {
        var bell = $all('button.admin-header-btn').filter(function (b) { return b.title === '通知'; })[0];
        if (bell) setBadge(bell, r.count);
      }).catch(function () {});
    }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  global.__QAXNotif.refreshTodos = function () {
    return loadTodos(true).then(function (r) {
      var bell = $all('button.admin-header-btn').filter(function (b) { return b.title === '通知'; })[0];
      if (bell) setBadge(bell, r.count);
      return r;
    });
  };
})(window);
