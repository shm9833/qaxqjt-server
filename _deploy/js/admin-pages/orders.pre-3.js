/* orders.pre-3.js — 从 admin/orders.html 抽取的内联脚本（第 3/4 段，保持原执行位置） */

/* ===== orders.html inline block (run 3, #1/1) ===== */
'use strict';
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
      // —— 页面级权限拦截：直接访问 URL 时检查角色，不足则跳首页 ——
      (function() {
        if (!currentSession) return;
        var userLvl = __getRoleLevel(currentSession.role);
        if (userLvl < 800) {
          location.replace('index.html');
        }
      })();
    })();
    (function() {
      var tabs = document.querySelectorAll('.tab-item');
      if (tabs && tabs.forEach) {
        tabs.forEach(function(tab) {
          tab.addEventListener('click', function() {
            document.querySelectorAll('.tab-item').forEach(function(t) { t.classList.remove('active'); });
            document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
            tab.classList.add('active');
            var key = tab.dataset && tab.dataset.tab;
            if (key) {
              var target = document.getElementById('tab-' + key);
              if (target) target.classList.add('active');
            }
          });
        });
      }

      var viewCardBtn = document.getElementById('viewCardBtn');
      var viewTableBtn = document.getElementById('viewTableBtn');
      var cardsView = document.getElementById('customerCardsView');
      var tableView = document.getElementById('customerTableView');
      if (viewCardBtn) {
        viewCardBtn.addEventListener('click', function() {
          viewCardBtn.classList.add('active');
          if (viewTableBtn) viewTableBtn.classList.remove('active');
          try { if (cardsView) cardsView.classList.remove('csp-hide'); } catch(_){}
          try { if (tableView) tableView.classList.add('csp-hide'); } catch(_){}
        });
      }
      if (viewTableBtn) {
        viewTableBtn.addEventListener('click', function() {
          viewTableBtn.classList.add('active');
          if (viewCardBtn) viewCardBtn.classList.remove('active');
          try { if (cardsView) cardsView.classList.add('csp-hide'); } catch(_){}
          try { if (tableView) tableView.classList.remove('csp-hide'); } catch(_){}
        });
      }

      var orderModal = document.getElementById('orderDetailModal');
      var orderModalOverlay = document.getElementById('orderDetailOverlay');
      var orderModalClose = document.getElementById('orderDetailClose');
      var orderModalCancel = document.getElementById('orderDetailCancel');
      function openOrderModal(btn) {
        if (!orderModal || !orderModalOverlay) return;
        var row = btn.closest('tr') || btn.closest('.customer-card');
        var orderNo = '—', customer = '—', phone = '—', amount = '—', status = '—', date = '—';
        if (row) {
          var noEl = row.querySelector('td:first-child strong, [data-order-no]');
          var custEl = row.querySelector('td:nth-child(2), [data-customer]');
          var phoneEl = row.querySelector('td:nth-child(3), [data-phone]');
          var amountEl = row.querySelector('td:nth-child(6) strong, [data-amount]');
          var statusEl = row.querySelector('.badge, [data-status]');
          var dateEl = row.querySelector('td:nth-child(7), [data-date]');
          if (noEl) orderNo = noEl.textContent.trim();
          if (custEl) customer = custEl.textContent.trim();
          if (phoneEl) phone = phoneEl.textContent.trim();
          if (amountEl) amount = amountEl.textContent.trim();
          if (statusEl) status = statusEl.textContent.trim();
          if (dateEl) date = dateEl.textContent.trim();
        }
        var fill = function(id, text) { var el = document.getElementById(id); if (el) el.textContent = text || '—'; };
        fill('modalOrderNo', orderNo);
        fill('modalCustomer', customer);
        fill('modalPhone', phone);
        fill('modalAmount', amount);
        fill('modalStatus', status);
        fill('modalDate', date);
        orderModalOverlay.classList.add('active');
        orderModal.classList.add('active');
        try { orderModalOverlay.classList.remove('csp-hide','modal-overlay-hide'); orderModalOverlay.style.display=''; } catch(_){}
        try { orderModal.classList.remove('csp-hide','modal-wrap-hide'); orderModal.style.display=''; } catch(_){}
      }
      function closeOrderModal() {
        try { if (orderModalOverlay) { orderModalOverlay.classList.remove('active'); orderModalOverlay.classList.add('csp-hide','modal-overlay-hide'); orderModalOverlay.style.display='none'; } } catch(_){}
        try { if (orderModal) { orderModal.classList.remove('active'); orderModal.classList.add('csp-hide','modal-wrap-hide'); orderModal.style.display='none'; } } catch(_){}
      }
      document.addEventListener('click', function(e) {
        var t = e.target;
        while (t && t !== document) {
          if (t.classList && t.classList.contains('order-detail-btn')) { openOrderModal(t); return; }
          t = t.parentNode;
        }
      });
      if (orderModalClose) orderModalClose.addEventListener('click', closeOrderModal);
      if (orderModalCancel) orderModalCancel.addEventListener('click', closeOrderModal);
      if (orderModalOverlay) orderModalOverlay.addEventListener('click', function(e) { if (e.target === orderModalOverlay) closeOrderModal(); });
      document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeOrderModal(); });
    })();
