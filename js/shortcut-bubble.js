/**
 * 动画小气泡快捷方式创建组件
 * 点击气泡即可创建桌面快捷方式，无需复杂操作
 */
(function(global) {
    'use strict';

    // 检查是否已创建
    var STORAGE_KEY = 'qaxqjt_shortcut_created';
    var STORAGE_CLOSED_KEY = 'qaxqjt_shortcut_closed';

    function isMarked() {
        try {
            return localStorage.getItem(STORAGE_KEY) === '1' || 
                   localStorage.getItem(STORAGE_CLOSED_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    function setMark(key) {
        try {
            localStorage.setItem(key, '1');
        } catch (e) {}
    }

    // 创建气泡 DOM
    function createBubble() {
        var bubble = document.createElement('div');
        bubble.id = 'shortcutBubble';
        bubble.innerHTML = `
            <style>
                #shortcutBubble {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    width: 60px;
                    height: 60px;
                    background: linear-gradient(135deg, rgba(24, 144, 255, 0.8) 0%, rgba(9, 109, 217, 0.8) 100%);
                    border-radius: 50%;
                    cursor: pointer;
                    box-shadow: 0 4px 12px rgba(24, 144, 255, 0.3);
                    z-index: 9999;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.3s ease;
                    animation: float 3s ease-in-out infinite;
                    opacity: 0.8;
                    backdrop-filter: blur(10px);
                    border: 1px solid rgba(255, 255, 255, 0.2);
                }
                
                #shortcutBubble:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 20px rgba(24, 144, 255, 0.5);
                    opacity: 1;
                    background: linear-gradient(135deg, rgba(24, 144, 255, 0.9) 0%, rgba(9, 109, 217, 0.9) 100%);
                }
                
                #shortcutBubble:active {
                    transform: scale(0.9);
                    animation: clickFeedback 0.3s ease;
                }
                
                /* 涟漪扩散效果 */
                #shortcutBubble::after {
                    content: '';
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    width: 0;
                    height: 0;
                    border-radius: 50%;
                    background: rgba(255, 255, 255, 0.6);
                    transform: translate(-50%, -50%);
                    opacity: 0;
                    pointer-events: none;
                }
                
                #shortcutBubble.ripple::after {
                    animation: rippleEffect 0.6s ease-out;
                }
                
                @keyframes rippleEffect {
                    0% {
                        width: 0;
                        height: 0;
                        opacity: 1;
                    }
                    100% {
                        width: 200px;
                        height: 200px;
                        opacity: 0;
                    }
                }
                
                #shortcutBubble .bubble-icon {
                    font-size: 24px;
                    color: white;
                }
                
                #shortcutBubble .bubble-tooltip {
                    position: absolute;
                    bottom: 70px;
                    right: 0;
                    background: rgba(0, 0, 0, 0.8);
                    color: white;
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 12px;
                    white-space: nowrap;
                    opacity: 0;
                    transform: translateY(10px);
                    transition: all 0.3s ease;
                    pointer-events: none;
                }
                
                #shortcutBubble:hover .bubble-tooltip {
                    opacity: 1;
                    transform: translateY(0);
                }
                
                @keyframes float {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-10px); }
                }
                
                @keyframes clickFeedback {
                    0% { transform: scale(0.9); box-shadow: 0 4px 12px rgba(24, 144, 255, 0.3); }
                    50% { transform: scale(1.05); box-shadow: 0 8px 25px rgba(24, 144, 255, 0.6); }
                    100% { transform: scale(1); box-shadow: 0 4px 12px rgba(24, 144, 255, 0.3); }
                }
                
                @keyframes pulse {
                    0% { box-shadow: 0 0 0 0 rgba(24, 144, 255, 0.7); }
                    70% { box-shadow: 0 0 0 10px rgba(24, 144, 255, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(24, 144, 255, 0); }
                }
                
                #shortcutBubble.pulse {
                    animation: float 3s ease-in-out infinite, pulse 2s infinite;
                }
            </style>
            <div class="bubble-icon">📱</div>
            <div class="bubble-tooltip">点击创建桌面快捷方式</div>
        `;
        
        return bubble;
    }

    // 创建快捷方式
    function createShortcut() {
        // 检测浏览器类型
        var userAgent = navigator.userAgent;
        var browserName = 'Unknown';
        
        if (userAgent.indexOf('Chrome') > -1 && userAgent.indexOf('Edg') === -1) {
            browserName = 'Chrome';
        } else if (userAgent.indexOf('Edg') > -1) {
            browserName = 'Edge';
        } else if (userAgent.indexOf('Firefox') > -1) {
            browserName = 'Firefox';
        } else if (userAgent.indexOf('Safari') > -1 && userAgent.indexOf('Chrome') === -1) {
            browserName = 'Safari';
        }

        // 根据浏览器类型提供不同的创建方式
        switch (browserName) {
            case 'Chrome':
                // Chrome: 使用 manifest 或提示用户手动创建
                showChromeInstructions();
                break;
            case 'Edge':
                // Edge: 使用应用安装 API
                installAsApp();
                break;
            case 'Firefox':
                // Firefox: 使用添加到主屏幕
                addToHomeScreen();
                break;
            case 'Safari':
                // Safari: 使用添加到主屏幕
                addToHomeScreen();
                break;
            default:
                // 其他浏览器: 显示通用说明
                showGenericInstructions();
        }

        // 标记为已创建
        setMark(STORAGE_KEY);
        
        // 埋点统计
        if (typeof window.QAXQJT_ANALYTICS !== 'undefined') {
            window.QAXQJT_ANALYTICS.track('shortcut_bubble_click', {
                browser: browserName,
                action: 'create'
            });
        }

        // 隐藏气泡
        hideBubble();
    }

    // Chrome 浏览器说明
    function showChromeInstructions() {
        showModal(`
            <div style="text-align: center; padding: 20px;">
                <div style="font-size: 48px; margin-bottom: 20px;">📱</div>
                <h3 style="color: #1890ff; margin-bottom: 16px;">Chrome 浏览器</h3>
                <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
                    请点击右上角 <strong>⋮</strong> 菜单 → <strong>更多工具</strong> → <strong>创建快捷方式</strong>
                </p>
                <button onclick="this.parentElement.parentElement.parentElement.remove()" 
                        style="background: #1890ff; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer;">
                    我知道了
                </button>
            </div>
        `);
    }

    // Edge 浏览器安装为应用
    function installAsApp() {
        // 使用 Web App Manifest API
        if ('serviceWorker' in navigator) {
            // 检查是否已有 manifest
            var manifestLink = document.querySelector('link[rel="manifest"]');
            if (!manifestLink) {
                // 动态创建 manifest
                var manifest = {
                    name: '秦安县秦剧团官网',
                    short_name: '秦剧团',
                    start_url: 'https://qaxqjt.cn',
                    display: 'standalone',
                    background_color: '#0F4C81',
                    theme_color: '#C9A962',
                    icons: [{
                        src: 'data:image/svg+xml;base64,' + btoa(`
                            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="50" cy="50" r="48" fill="#0F4C81" stroke="#C9A962" stroke-width="2"/>
                                <text x="50" y="55" font-family="serif" font-size="40" font-weight="bold" text-anchor="middle" fill="#C9A962">秦</text>
                            </svg>
                        `),
                        sizes: '100x100',
                        type: 'image/svg+xml'
                    }]
                };
                
                var blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
                var manifestURL = URL.createObjectURL(blob);
                
                var link = document.createElement('link');
                link.rel = 'manifest';
                link.href = manifestURL;
                document.head.appendChild(link);
            }
        }
        
        // 显示安装提示
        if (window.deferredPrompt) {
            window.deferredPrompt.prompt();
            window.deferredPrompt.userChoice.then(function(choiceResult) {
                if (choiceResult.outcome === 'accepted') {
                    showModal(`
                        <div style="text-align: center; padding: 20px;">
                            <div style="font-size: 48px; margin-bottom: 20px;">✅</div>
                            <h3 style="color: #52c41a; margin-bottom: 16px;">安装成功！</h3>
                            <p style="color: #666;">应用已添加到您的应用列表</p>
                        </div>
                    `);
                } else {
                    showModal(`
                        <div style="text-align: center; padding: 20px;">
                            <div style="font-size: 48px; margin-bottom: 20px;">ℹ️</div>
                            <h3 style="color: #1890ff; margin-bottom: 16px;">安装已取消</h3>
                            <p style="color: #666;">您可以稍后通过浏览器菜单安装</p>
                        </div>
                    `);
                }
                window.deferredPrompt = null;
            });
        } else {
            showChromeInstructions(); // 降级到 Chrome 说明
        }
    }

    // Firefox/Safari 添加到主屏幕
    function addToHomeScreen() {
        showModal(`
            <div style="text-align: center; padding: 20px;">
                <div style="font-size: 48px; margin-bottom: 20px;">📱</div>
                <h3 style="color: #1890ff; margin-bottom: 16px;">添加到主屏幕</h3>
                <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
                    请点击浏览器菜单 → <strong>添加到主屏幕</strong><br>
                    或拖拽网址到桌面
                </p>
                <button onclick="this.parentElement.parentElement.parentElement.remove()" 
                        style="background: #1890ff; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer;">
                    我知道了
                </button>
            </div>
        `);
    }

    // 通用说明
    function showGenericInstructions() {
        showModal(`
            <div style="text-align: center; padding: 20px;">
                <div style="font-size: 48px; margin-bottom: 20px;">🌐</div>
                <h3 style="color: #1890ff; margin-bottom: 16px;">创建快捷方式</h3>
                <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
                    请使用浏览器菜单中的<br><strong>创建快捷方式</strong>或<strong>添加到主屏幕</strong>功能
                </p>
                <button onclick="this.parentElement.parentElement.parentElement.remove()" 
                        style="background: #1890ff; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer;">
                    我知道了
                </button>
            </div>
        `);
    }

    // 显示模态框
    function showModal(content) {
        var modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.3s ease;
        `;
        
        modal.innerHTML = `
            <div style="background: white; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); max-width: 400px; margin: 20px;">
                ${content}
            </div>
        `;
        
        // 点击背景关闭
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        document.body.appendChild(modal);
    }

    // 隐藏气泡
    function hideBubble() {
        var bubble = document.getElementById('shortcutBubble');
        if (bubble) {
            bubble.style.animation = 'fadeOut 0.3s ease';
            setTimeout(function() {
                bubble.remove();
            }, 300);
        }
    }

    // 初始化
    function init() {
        if (isMarked()) return;
        if (document.getElementById('shortcutBubble')) return;

        // 延迟显示气泡
        setTimeout(function() {
            var bubble = createBubble();
            document.body.appendChild(bubble);
            
            // 点击事件
            bubble.addEventListener('click', function() {
                // 触发涟漪效果
                bubble.classList.add('ripple');
                
                // 延迟移除涟漪类，让动画完成
                setTimeout(function() {
                    bubble.classList.remove('ripple');
                }, 600);
                
                // 执行创建快捷方式
                createShortcut();
            });
            
            // 3秒后开始脉冲动画吸引注意
            setTimeout(function() {
                bubble.classList.add('pulse');
            }, 3000);
            
            // 埋点统计
            if (typeof window.QAXQJT_ANALYTICS !== 'undefined') {
                window.QAXQJT_ANALYTICS.track('shortcut_bubble_show', {
                    browser: navigator.userAgent.indexOf('Chrome') > -1 ? 'Chrome' : 
                            navigator.userAgent.indexOf('Edg') > -1 ? 'Edge' : 
                            navigator.userAgent.indexOf('Firefox') > -1 ? 'Firefox' : 
                            navigator.userAgent.indexOf('Safari') > -1 ? 'Safari' : 'Other'
                });
            }
        }, 1500);
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window);
