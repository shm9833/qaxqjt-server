/* js/real-action-guard.js —— 真实业务按钮护航（v20260922）
 *
 * 背景：各 admin 页内联的 SuperPatch 6/6 与 DeadButtonFallback 都在 document【捕获阶段】
 * 监听 click，凡是非模态框内、无 onclick/href、且未打 __superPatchBound 标记的按钮，
 * 一律 preventDefault + stopPropagation 并弹"演示模式"toast（👁查看/ℹ️详情编辑/📤导出）。
 * 真实业务行按钮（orders/operas/schedule/content 等动态渲染的 <button data-act>）由
 * tbody【冒泡】委托处理，事件在到达 tbody 之前就被 document 捕获兜底劫持。
 *
 * 本脚本统一在按钮【渲染入库后、用户点击前】用 MutationObserver 预打早退标记，
 * 让 document 捕获阶段的两个兜底都"识别为已绑定真实行为"而放行，事件正常到达
 * 各页面既有的 tbody 委托。标记全部幂等，不改变任何业务逻辑。
 *
 * 早退标记契约（与各页内联兜底一致，勿随意改名）：
 *   __superPatchBound = 1  → SuperPatch 6/6 _hasAction() 与 DBF __btnHasBound() 均认
 *   __ts3Done = 1          → DBF 全局早退
 *   __bindDone / __ctE2Done = 1 → DBF 去重早退
 *   __deadBtnChecked = 1   → _hasAction 兜底
 */
(function () {
  'use strict';
  if (window.__realActionGuard) return;
  window.__realActionGuard = true;

  // [data-real-bound]：已真实接线的静态工具栏按钮（导出/打印等，无 data-act）的显式契约
  var SEL = 'button[data-act], a[data-act], [role="button"][data-act], [data-real-bound]';
  var FLAGS = ['__superPatchBound', '__ts3Done', '__bindDone', '__ctE2Done', '__deadBtnChecked'];

  function markOne(el) {
    if (!el || el.nodeType !== 1) return;
    for (var i = 0; i < FLAGS.length; i++) {
      try { if (!el[FLAGS[i]]) el[FLAGS[i]] = 1; } catch (_) {}
    }
  }

  // 主动扫描指定根（默认整个 document），供渲染后立即同步调用
  function scan(root) {
    try {
      var scope = root || document;
      var list = scope.querySelectorAll ? scope.querySelectorAll(SEL) : [];
      for (var i = 0; i < list.length; i++) markOne(list[i]);
      // root 自身可能就是按钮
      if (scope.matches && scope.matches(SEL)) markOne(scope);
    } catch (_) {}
  }
  window.__guardRealActions = scan;

  function start() {
    scan(document);
    if (typeof MutationObserver === 'undefined') {
      // 无 MO 的极端环境：定时兜底
      setTimeout(scan, 300); setTimeout(scan, 900); setTimeout(scan, 1800);
      return;
    }
    var mo = new MutationObserver(function (mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var added = mutations[m].addedNodes;
        for (var k = 0; k < added.length; k++) {
          var node = added[k];
          if (node.nodeType !== 1) continue;
          markOne(node);
          if (node.querySelectorAll) {
            var inner = node.querySelectorAll(SEL);
            for (var j = 0; j < inner.length; j++) markOne(inner[j]);
          }
        }
      }
    });
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
    // 兜底：覆盖 observer 启动前已渲染、或非标准插入的节点
    setTimeout(scan, 300); setTimeout(scan, 900); setTimeout(scan, 1800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
