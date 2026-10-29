/**
 * 快捷方式创建引导组件
 * 首次访问时提示用户创建桌面快捷方式，完成后持久化标记不再提示
 */
(function() {
    'use strict';

    var STORAGE_KEY = 'qaxqjt_shortcut_created';
    var STORAGE_CLOSED_KEY = 'qaxqjt_shortcut_closed';
    var PROMPT_DELAY = 1500; // 页面加载后延迟显示，避免影响首屏渲染

    // 检测是否已标记完成或关闭
    function isMarked() {
        try {
            return localStorage.getItem(STORAGE_KEY) === 'true' ||
                   localStorage.getItem(STORAGE_CLOSED_KEY) === 'true';
        } catch (e) {
            return false;
        }
    }

    // 设置标记
    function setMark(key) {
        try {
            localStorage.setItem(key, 'true');
        } catch (e) {
            // localStorage 不可用时静默失败
        }
    }

    // 检测浏览器类型
    function getBrowser() {
        var ua = navigator.userAgent;
        if (ua.indexOf('Edg') > -1) return 'edge';
        if (ua.indexOf('Chrome') > -1) return 'chrome';
        if (ua.indexOf('Safari') > -1) return 'safari';
        if (ua.indexOf('Firefox') > -1) return 'firefox';
        return 'other';
    }

    // 获取浏览器对应的操作步骤
    function getSteps(browser) {
        var steps = {
            chrome: [
                '点击浏览器右上角「⋮」菜单',
                '选择「更多工具」→「创建快捷方式」',
                '勾选「作为窗口打开」',
                '点击「创建」按钮'
            ],
            edge: [
                '点击浏览器右上角「⋯」菜单',
                '选择「应用」→「将此站点作为应用安装」',
                '确认应用名称',
                '点击「安装」按钮'
            ],
            safari: [
                '点击菜单栏「文件」',
                '选择「添加到主屏幕」',
                '确认名称后点击「添加」'
            ],
            firefox: [
                '点击地址栏左侧「⋮」图标',
                '选择「将本站添加到桌面」'
            ],
            other: [
                '请查看浏览器菜单中的「创建快捷方式」或「添加到桌面」选项'
            ]
        };
        return steps[browser] || steps.other;
    }

    // 创建提示弹窗 DOM
    function createPromptDOM() {
        var browser = getBrowser();
        var steps = getSteps(browser);
        var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        var overlay = document.createElement('div');
        overlay.id = 'shortcutPromptOverlay';
        overlay.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
            'background:rgba(0,0,0,0.5)', 'z-index:99999', 'display:flex',
            'align-items:center', 'justify-content:center', 'opacity:0',
            'transition:opacity 0.3s ease'
        ].join(';');

        var modal = document.createElement('div');
        modal.style.cssText = [
            'background:#fff', 'border-radius:12px', 'padding:24px',
            'max-width:400px', 'width:90%', 'box-shadow:0 8px 32px rgba(0,0,0,0.2)',
            'transform:scale(0.9)', 'transition:transform 0.3s ease'
        ].join(';');

        var stepsHtml = steps.map(function(s, i) {
            return '<div style="display:flex;align-items:center;margin:10px 0;font-size:14px;color:#555">' +
                '<span style="background:#722F37;color:#fff;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;margin-right:10px;flex-shrink:0">' + (i+1) + '</span>' +
                '<span>' + s + '</span>' +
                '</div>';
        }).join('');

        modal.innerHTML = [
            '<div style="text-align:center;margin-bottom:20px">',
            '  <div style="font-size:48px;margin-bottom:8px">📱</div>',
            '  <h3 style="margin:0;font-size:18px;color:#333">添加到桌面，一键直达</h3>',
            '  <p style="margin:8px 0 0;font-size:13px;color:#888">创建快捷方式后，无需打开浏览器输入网址</p>',
            '</div>',
            '<div style="background:#f8f9fa;border-radius:8px;padding:16px;margin-bottom:20px">',
            '  <div style="font-size:12px;color:#722F37;font-weight:bold;margin-bottom:8px">操作步骤（' + (isMobile ? '手机' : '电脑') + '）：</div>',
            stepsHtml,
            '</div>',
            '<div style="display:flex;gap:10px">',
            '  <button id="shortcutCreateBtn" style="flex:1;padding:12px;background:#722F37;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;font-weight:bold">我已创建</button>',
            '  <button id="shortcutCloseBtn" style="flex:1;padding:12px;background:#f0f0f0;color:#666;border:none;border-radius:6px;font-size:14px;cursor:pointer">暂不提示</button>',
            '</div>'
        ].join('');

        overlay.appendChild(modal);
        return overlay;
    }

    // 埋点统计
    function trackEvent(eventName, props) {
        if (typeof window.QAXQJT_ANALYTICS !== 'undefined') {
            window.QAXQJT_ANALYTICS.track(eventName, props);
        }
    }

    // 显示弹窗
    function showPrompt() {
        if (isMarked()) return;
        if (document.getElementById('shortcutPromptOverlay')) return;

        var overlay = createPromptDOM();
        document.body.appendChild(overlay);

        // 埋点：弹窗展示
        trackEvent('shortcut_prompt_show', {
            browser: getBrowser(),
            isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        });

        // 动画显示
        setTimeout(function() {
            overlay.style.opacity = '1';
            overlay.firstChild.style.transform = 'scale(1)';
        }, 50);

        // 绑定事件
        document.getElementById('shortcutCreateBtn').addEventListener('click', function() {
            // 埋点：确认创建
            trackEvent('shortcut_prompt_confirm', { browser: getBrowser() });
            setMark(STORAGE_KEY);
            closePrompt(overlay);
        });

        document.getElementById('shortcutCloseBtn').addEventListener('click', function() {
            // 埋点：暂不提示
            trackEvent('shortcut_prompt_dismiss', { browser: getBrowser() });
            setMark(STORAGE_CLOSED_KEY);
            closePrompt(overlay);
        });

        // 点击遮罩层关闭（不标记，下次还会提示）
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                // 埋点：遮罩关闭
                trackEvent('shortcut_prompt_close_overlay', { browser: getBrowser() });
                closePrompt(overlay);
            }
        });
    }

    // 关闭弹窗
    function closePrompt(overlay) {
        overlay.style.opacity = '0';
        overlay.firstChild.style.transform = 'scale(0.9)';
        setTimeout(function() {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 300);
    }

    // 页面加载完成后延迟显示
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(showPrompt, PROMPT_DELAY);
        });
    } else {
        setTimeout(showPrompt, PROMPT_DELAY);
    }
})();
