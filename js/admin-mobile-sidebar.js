/* ==========================================================================
 * js/admin-mobile-sidebar.js —— 后台手机端侧边栏抽屉（v20260926m）
 * ----------------------------------------------------------------------------
 * 统一绑定 .admin-sidebar-toggle / .topbar-toggle / #sidebarToggle：
 *   - 打开：#adminSidebar 加 mobile-open，#sidebarOverlay 加 active（缺失自动创建）
 *   - 关闭：点遮罩 / ESC / 点菜单链接后 / 窗口拉宽到 >900px
 *   - 切换按钮立即打防劫持标记（__superPatchBound/__deadBtnChecked），
 *     防止被各页「按钮兜底」document 捕获监听吞掉首次点击
 * 幂等：window.__adminMobileSidebarBound，每页只绑定一次
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__adminMobileSidebarBound) return;
  window.__adminMobileSidebarBound = true;

  function markBtn(b) {
    if (!b) return;
    try {
      b.__superPatchBound = 1;
      b.__deadBtnChecked = 1;
      b.__ts3Done = 1;
      b.__bindDone = 1;
      b.__ctE2Done = 1;
      b.setAttribute('data-real-bound', '1');
    } catch (_) {}
  }

  function init() {
    var sidebar = document.getElementById('adminSidebar') || document.querySelector('.admin-sidebar');
    if (!sidebar) return;
    var toggle = document.querySelector('.admin-sidebar-toggle, .topbar-toggle, #sidebarToggle');

    var overlay = document.getElementById('sidebarOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sidebarOverlay';
      overlay.className = 'admin-sidebar-overlay';
      var host = document.querySelector('.admin-layout') || document.body;
      host.insertBefore(overlay, host.firstChild);
    }

    function isOpen() { return sidebar.classList.contains('mobile-open'); }
    function open() {
      sidebar.classList.add('mobile-open');
      overlay.classList.add('active');
      document.body.classList.add('m-nav-open');
    }
    function close() {
      sidebar.classList.remove('mobile-open');
      overlay.classList.remove('active');
      document.body.classList.remove('m-nav-open');
    }

    markBtn(toggle);
    if (toggle) {
      toggle.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (isOpen()) close(); else open();
      });
    }
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) close();
    });
    // 点击菜单链接后自动收起（同页锚点场景）；真实跳转页面随导航卸载无影响
    var links = sidebar.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function () { if (isOpen()) close(); });
    }
    // 旋转/拉宽到桌面尺寸时复位，避免 mobile-open 残留
    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (window.innerWidth > 900 && isOpen()) close(); }, 150);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
