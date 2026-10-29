/**
 * 前端埋点统计模块
 * 收集用户行为事件，支持本地缓存 + 后端上报
 */
(function(global) {
    'use strict';

    var STORAGE_KEY = 'qaxqjt_analytics_queue';
    var SESSION_ID = 's_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    var MAX_QUEUE_SIZE = 100;

    // 基础环境信息
    function getEnv() {
        return {
            ua: navigator.userAgent,
            platform: navigator.platform,
            screen: screen.width + 'x' + screen.height,
            language: navigator.language,
            referrer: document.referrer || '',
            url: location.href,
            sessionId: SESSION_ID
        };
    }

    // 读取队列
    function getQueue() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    // 保存队列
    function saveQueue(queue) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_SIZE)));
        } catch (e) {
            // 存储失败静默处理
        }
    }

    // 记录事件
    function track(eventName, properties) {
        var event = {
            event: eventName,
            properties: properties || {},
            env: getEnv(),
            timestamp: Date.now()
        };

        var queue = getQueue();
        queue.push(event);
        saveQueue(queue);

        // 尝试立即上报（如果后端可用）
        flush();

        // 控制台调试（生产环境可移除）
        if (typeof console !== 'undefined' && console.debug) {
            console.debug('[Analytics]', eventName, properties);
        }
    }

    // 上报队列到后端
    function flush() {
        var queue = getQueue();
        if (queue.length === 0) return;

        // 检查是否有后端 API 可用
        var apiBase = global.QAXQJT_API_CONFIG && global.QAXQJT_API_CONFIG.BASE || '';
        var endpoint = apiBase + '/v1/analytics/events';

        var payload = {
            events: queue,
            deviceId: getDeviceId()
        };

        // 使用 sendBeacon（页面关闭时也能发送）
        if (navigator.sendBeacon) {
            try {
                var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
                var sent = navigator.sendBeacon(endpoint, blob);
                if (sent) {
                    saveQueue([]);
                    return;
                }
            } catch (e) {
                // sendBeacon 失败，降级到 fetch
            }
        }

        // 降级到 fetch
        if (typeof fetch !== 'undefined') {
            fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true
            }).then(function(res) {
                if (res.ok) saveQueue([]);
            }).catch(function() {
                // 上报失败，保留在队列中下次再试
            });
        }
    }

    // 生成设备标识
    function getDeviceId() {
        var key = 'qaxqjt_device_id';
        try {
            var id = localStorage.getItem(key);
            if (!id) {
                id = 'd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                localStorage.setItem(key, id);
            }
            return id;
        } catch (e) {
            return 'unknown';
        }
    }

    // 页面卸载时强制上报
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', function() {
            flush();
        });
        window.addEventListener('pagehide', function() {
            flush();
        });
    }

    // 暴露全局接口
    global.QAXQJT_ANALYTICS = {
        track: track,
        flush: flush,
        getQueue: getQueue
    };
})(typeof window !== 'undefined' ? window : this);
