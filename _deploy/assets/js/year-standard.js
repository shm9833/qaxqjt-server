/**
 * year-standard.js - 标准完整版年份渲染模块
 * 2026全年统一标准版本
 *
 * 功能特性：
 * - 实现 {year} 动态年份自动渲染（标准完整版）
 * - 优先级：服务端标准年份 > 客户端本地年份兜底
 * - DOMContentLoaded 时执行
 * - 全局正则 /{year}/g 批量替换
 * - 包含日志记录和容错机制
 *
 * 用法：在 HTML 中需要动态年份的位置使用 {year} 占位符
 * 例：<span>版权所有 © {year} 秦安县秦剧团</span>
 */

(function (global) {
  'use strict';

  /**
   * 模块配置
   */
  var CONFIG = {
    PLACEHOLDER: '{year}',
    REGEX: /\{year\}/g,
    SERVER_YEAR_KEY: 'SERVER_STANDARD_YEAR',
    FALLBACK_YEAR: 2026,
    LOG_PREFIX: '[YearStandard]',
    STORAGE_KEY: 'qaxqjt_standard_year_cache',
    CACHE_TTL: 3600000
  };

  /**
   * 日志记录器
   */
  var Logger = {
    info: function (msg) {
      if (console && typeof console.info === 'function') {
        console.info(CONFIG.LOG_PREFIX + '[INFO] ' + msg);
      }
    },
    warn: function (msg) {
      if (console && typeof console.warn === 'function') {
        console.warn(CONFIG.LOG_PREFIX + '[WARN] ' + msg);
      }
    },
    error: function (msg, err) {
      if (console && typeof console.error === 'function') {
        console.error(CONFIG.LOG_PREFIX + '[ERROR] ' + msg, err || '');
      }
    }
  };

  /**
   * 年份解析器
   */
  var YearResolver = {
    /**
     * 从 window 全局变量获取服务端标准年份
     * @returns {number|null}
     */
    getServerGlobalYear: function () {
      try {
        if (global[CONFIG.SERVER_YEAR_KEY]) {
          var year = parseInt(global[CONFIG.SERVER_YEAR_KEY], 10);
          if (!isNaN(year) && year >= 2020 && year <= 2100) {
            Logger.info('从全局变量获取到服务端标准年份: ' + year);
            return year;
          }
        }
        return null;
      } catch (e) {
        Logger.error('读取全局变量年份失败', e);
        return null;
      }
    },

    /**
     * 从 meta 标签获取服务端标准年份
     * @returns {number|null}
     */
    getServerMetaYear: function () {
      try {
        var meta = document.querySelector('meta[name="standard-year"]');
        if (meta && meta.getAttribute('content')) {
          var year = parseInt(meta.getAttribute('content'), 10);
          if (!isNaN(year) && year >= 2020 && year <= 2100) {
            Logger.info('从 meta 标签获取到服务端标准年份: ' + year);
            return year;
          }
        }
        return null;
      } catch (e) {
        Logger.error('读取 meta 标签年份失败', e);
        return null;
      }
    },

    /**
     * 从 localStorage 缓存读取年份
     * @returns {number|null}
     */
    getCachedYear: function () {
      try {
        if (typeof localStorage !== 'undefined') {
          var raw = localStorage.getItem(CONFIG.STORAGE_KEY);
          if (raw) {
            var data = JSON.parse(raw);
            if (data && data.year && data.timestamp) {
              var now = Date.now();
              if (now - data.timestamp < CONFIG.CACHE_TTL) {
                Logger.info('从缓存读取到标准年份: ' + data.year);
                return data.year;
              }
            }
          }
        }
        return null;
      } catch (e) {
        Logger.warn('读取年份缓存失败', e);
        return null;
      }
    },

    /**
     * 写入年份缓存
     * @param {number} year
     */
    setCachedYear: function (year) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(
            CONFIG.STORAGE_KEY,
            JSON.stringify({
              year: year,
              timestamp: Date.now()
            })
          );
        }
      } catch (e) {
        Logger.warn('写入年份缓存失败', e);
      }
    },

    /**
     * 获取客户端本地年份兜底
     * @returns {number}
     */
    getLocalFallbackYear: function () {
      try {
        var now = new Date();
        var year = now.getFullYear();
        if (!isNaN(year) && year >= 2020 && year <= 2100) {
          Logger.info('使用客户端本地年份兜底: ' + year);
          return year;
        }
      } catch (e) {
        Logger.error('获取本地年份失败', e);
      }
      Logger.warn('使用硬编码兜底年份: ' + CONFIG.FALLBACK_YEAR);
      return CONFIG.FALLBACK_YEAR;
    },

    /**
     * 按优先级解析最终标准年份
     * 优先级：服务端全局变量 > 服务端meta标签 > 缓存 > 客户端本地年份 > 硬编码兜底
     * @returns {number}
     */
    resolveStandardYear: function () {
      Logger.info('开始解析标准年份...');

      var year = null;

      year = this.getServerGlobalYear();
      if (year) {
        this.setCachedYear(year);
        return year;
      }

      year = this.getServerMetaYear();
      if (year) {
        this.setCachedYear(year);
        return year;
      }

      year = this.getCachedYear();
      if (year) {
        return year;
      }

      year = this.getLocalFallbackYear();
      this.setCachedYear(year);
      return year;
    }
  };

  /**
   * 渲染引擎
   */
  var Renderer = {
    /**
     * 统计替换次数
     */
    replaceCount: 0,

    /**
     * 替换文本节点中的 {year} 占位符
     * @param {Text} node
     * @param {string} yearStr
     */
    replaceInTextNode: function (node, yearStr) {
      if (node.nodeValue && node.nodeValue.indexOf(CONFIG.PLACEHOLDER) !== -1) {
        var newValue = node.nodeValue.replace(CONFIG.REGEX, yearStr);
        if (newValue !== node.nodeValue) {
          node.nodeValue = newValue;
          this.replaceCount++;
        }
      }
    },

    /**
     * 替换元素属性中的 {year} 占位符
     * @param {Element} element
     * @param {string} yearStr
     */
    replaceInAttributes: function (element, yearStr) {
      try {
        var attrs = element.attributes;
        if (!attrs) return;

        for (var i = 0; i < attrs.length; i++) {
          var attr = attrs[i];
          if (attr.value && attr.value.indexOf(CONFIG.PLACEHOLDER) !== -1) {
            var newValue = attr.value.replace(CONFIG.REGEX, yearStr);
            if (newValue !== attr.value) {
              element.setAttribute(attr.name, newValue);
              this.replaceCount++;
            }
          }
        }
      } catch (e) {
        Logger.error('替换属性中的占位符失败', e);
      }
    },

    /**
     * 递归遍历 DOM 树进行替换
     * @param {Node} node
     * @param {string} yearStr
     */
    traverseAndReplace: function (node, yearStr) {
      if (!node) return;

      try {
        if (node.nodeType === Node.TEXT_NODE) {
          this.replaceInTextNode(node, yearStr);
          return;
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
          var tagName = node.tagName ? node.tagName.toLowerCase() : '';

          if (tagName === 'script' || tagName === 'style' || tagName === 'template') {
            return;
          }

          this.replaceInAttributes(node, yearStr);

          var child = node.firstChild;
          while (child) {
            var nextSibling = child.nextSibling;
            this.traverseAndReplace(child, yearStr);
            child = nextSibling;
          }
        }
      } catch (e) {
        Logger.error('DOM遍历替换时发生异常', e);
      }
    },

    /**
     * 执行完整渲染流程
     */
    render: function () {
      var startTime = Date.now();
      this.replaceCount = 0;

      try {
        Logger.info('开始执行年份渲染...');

        var standardYear = YearResolver.resolveStandardYear();
        var yearStr = String(standardYear);

        Logger.info('最终使用标准年份: ' + yearStr);

        this.traverseAndReplace(document.documentElement, yearStr);

        var duration = Date.now() - startTime;
        Logger.info(
          '年份渲染完成，共替换 ' + this.replaceCount + ' 处占位符，耗时 ' + duration + 'ms'
        );

        return {
          success: true,
          year: standardYear,
          replaceCount: this.replaceCount,
          duration: duration
        };
      } catch (e) {
        Logger.error('年份渲染发生致命错误', e);
        return {
          success: false,
          error: e.message,
          replaceCount: this.replaceCount
        };
      }
    }
  };

  /**
   * 对外暴露 API
   */
  var YearStandard = {
    CONFIG: CONFIG,
    render: function () {
      return Renderer.render();
    },
    getCurrentYear: function () {
      return YearResolver.resolveStandardYear();
    },
    refresh: function () {
      return Renderer.render();
    }
  };

  /**
   * DOMContentLoaded 时自动执行
   */
  function autoInit() {
    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          Logger.info('DOMContentLoaded 触发，自动执行年份渲染');
          YearStandard.render();
        }, { once: true });
      } else {
        Logger.info('DOM 已就绪，立即执行年份渲染');
        YearStandard.render();
      }
    } catch (e) {
      Logger.error('自动初始化失败', e);
    }
  }

  global.YearStandard = YearStandard;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = YearStandard;
  }

  autoInit();

})(typeof window !== 'undefined' ? window : this);
