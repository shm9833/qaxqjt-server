/* ==========================================================================
 * js/troupe-cloud-store.js —— cast-sheet 组团配置云端存储层
 * ----------------------------------------------------------------------------
 * 数据对象：
 *   工资等级 wageGrades：{ W1..W7: { name, daily } }
 *   模板库   templates ：[{ id, name, days, savedAt, data:[{cat,name,role,grade,daily}] }]，上限 50
 *
 * 策略（真实接口为主路径，本地缓存为降级，绝不造假数据）：
 *   1. 同步读写永远先走内存+localStorage 缓存（页面零阻塞、离线可用）
 *   2. bootstrap() 网络优先 + stale-while-revalidate（TTL 60s，后台静默刷新）
 *   3. 云端为单一事实来源；首次发现云端为空而本机有旧数据 → 自动一次性迁移上云
 *      云端有数据而本机存在云端没有的模板 → 合并补传一次（多设备并行不丢模板）
 *   4. 写操作乐观更新缓存后异步 PUT；失败置 dirty 标志并友好提示，
 *      下次 bootstrap 成功 / 页面重新可见时自动补推
 *   5. 所有进出数据经纯函数 normalize/sanitize，损坏 JSON 与非法字段不炸页面
 *
 * 纯内核（normalize/sanitize/merge/meta）在 Node 下可直接 require 用于单元测试；
 * 浏览器部分用 createStore({storage, api, report}) 依赖注入，可注入假依赖做集成级单测。
 * ========================================================================== */
(function (root, factory) {
  var core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  if (root) root.TroupeCloudStore = core;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /* ============================== 纯内核（无 DOM/IO） ============================== */

  var GRADE_KEYS = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'];
  var CATS = ['actor', 'band', 'front', 'costume', 'electric'];
  var DEFAULT_GRADES = {
    W1: { name: '实习', daily: 80 }, W2: { name: '替补', daily: 120 },
    W3: { name: 'C角', daily: 180 }, W4: { name: 'B角', daily: 280 },
    W5: { name: 'A角', daily: 400 }, W6: { name: '主B', daily: 600 },
    W7: { name: '主A角', daily: 800 }
  };
  var LIMITS = {
    templates: 50, personsPerTemplate: 120, nameLen: 40, roleLen: 30,
    idLen: 40, dailyMax: 100000, daysMin: 1, daysMax: 60, ttlMs: 60000, putDebounceMs: 700
  };
  var LS_GRADES = 'qaxqjt_wage_grades_v1';
  var LS_TEMPLATES = 'troupe_templates_v1';
  var LS_META = 'qaxqjt_troupe_cloud_meta_v1';

  function _str(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
  function _num(v, min, max, def) {
    var n = Number(v);
    if (!isFinite(n)) return def;
    var r = Math.round(n * 100) / 100;
    if (r < min) r = min;
    if (r > max) r = max;
    return r;
  }
  function _iso(v) {
    var d = new Date(String(v == null ? '' : v));
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  function _validId(v) {
    var s = _str(v, LIMITS.idLen);
    return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : '';
  }

  /** 安全 JSON.parse，失败回退 def */
  function safeParse(raw, def) {
    if (!raw) return def;
    try { return JSON.parse(raw); } catch (e) { return def; }
  }

  /** 归一化工资等级：缺档补默认、越界裁剪；非对象返回 null */
  function normalizeGrades(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var out = {};
    GRADE_KEYS.forEach(function (k) {
      var g = raw[k] && typeof raw[k] === 'object' ? raw[k] : {};
      out[k] = {
        name: _str(g.name, LIMITS.nameLen) || DEFAULT_GRADES[k].name,
        daily: _num(g.daily, 0, LIMITS.dailyMax, DEFAULT_GRADES[k].daily)
      };
    });
    return out;
  }

  /** 消毒模板库：非数组→null；逐条裁剪，非法枚举补默认，丢弃非对象条目 */
  function sanitizeTemplates(raw) {
    if (!Array.isArray(raw)) return null;
    var out = [];
    raw.slice(0, LIMITS.templates).forEach(function (t, idx) {
      if (!t || typeof t !== 'object') return;
      var dataRaw = Array.isArray(t.data) ? t.data : [];
      var data = [];
      dataRaw.slice(0, LIMITS.personsPerTemplate).forEach(function (p) {
        if (!p || typeof p !== 'object') return;
        data.push({
          cat: CATS.indexOf(p.cat) >= 0 ? p.cat : 'front',
          name: _str(p.name, LIMITS.nameLen),
          role: _str(p.role, LIMITS.roleLen),
          grade: GRADE_KEYS.indexOf(p.grade) >= 0 ? p.grade : 'W1',
          daily: _num(p.daily, 0, LIMITS.dailyMax, 0)
        });
      });
      out.push({
        id: _validId(t.id) || ('tp_' + Date.now().toString(36) + '_' + idx + Math.floor(Math.random() * 1e4)),
        name: _str(t.name, LIMITS.nameLen) || ('未命名模板' + (idx + 1)),
        days: _num(t.days, LIMITS.daysMin, LIMITS.daysMax, 3),
        savedAt: _iso(t.savedAt),
        data: data
      });
    });
    return out;
  }

  /**
   * 云端为主合并本机模板：云端顺序优先；本机独有的模板（按 id）追加在后；总数封顶 50
   * @returns {{list:Array, appended:number}}
   */
  function mergeTemplates(cloud, local) {
    var list = sanitizeTemplates(cloud) || [];
    var have = {};
    list.forEach(function (t) { have[t.id] = true; });
    var appended = 0;
    (sanitizeTemplates(local) || []).forEach(function (t) {
      if (list.length >= LIMITS.templates) return;
      if (!have[t.id]) { list.push(t); have[t.id] = true; appended++; }
    });
    return { list: list, appended: appended };
  }

  /* ============================== 可注入 store ============================== */

  /**
   * @param {object} deps
   *   storage: { getItem, setItem }（必填）
   *   api    : { request(method, path, opts) -> Promise }（可选，浏览器默认取 window.QAXQJT_API）
   *   report : { info, warn, error }（可选，默认 console）
   *   now    : () -> number（可选）
   */
  function createStore(deps) {
    deps = deps || {};
    var storage = deps.storage;
    var now = deps.now || function () { return Date.now(); };
    var report = deps.report || {
      info: function (m) { if (typeof console !== 'undefined') console.info('[troupe-cfg]', m); },
      warn: function (m) { if (typeof console !== 'undefined') console.warn('[troupe-cfg]', m); },
      error: function (m) { if (typeof console !== 'undefined') console.error('[troupe-cfg]', m); }
    };
    // 页面可在 bootstrap({report}) 中替换为友好 toast 上报器（写失败提示走它）
    function setReport(r) { if (r && typeof r.error === 'function') report = r; }

    var mem = {
      grades: null,        // 归一化后的内存缓存
      templates: null,
      fetchedAt: 0,         // 最近一次成功 GET 的时间
      inflight: null,       // bootstrap 去重
      putInflight: 0,
      dirty: { grades: false, templates: false },
      migrated: false,
      tplPutTimer: null
    };

    function _lsGet(k) { try { return storage.getItem(k); } catch (e) { return null; } }
    function _lsSet(k, v) { try { storage.setItem(k, v); } catch (e) {} }
    function _readMeta() {
      var m = safeParse(_lsGet(LS_META), {});
      mem.migrated = !!(m && m.migrated);
      return m && typeof m === 'object' ? m : {};
    }
    function _writeMeta(patch) {
      var m = safeParse(_lsGet(LS_META), {});
      if (!m || typeof m !== 'object') m = {};
      Object.keys(patch).forEach(function (k) { m[k] = patch[k]; });
      _lsSet(LS_META, JSON.stringify(m));
    }
    function _api() {
      if (deps.api) return deps.api;
      if (typeof window !== 'undefined' && window.QAXQJT_API && typeof window.QAXQJT_API.request === 'function') {
        return { request: function (method, path, opts) { return window.QAXQJT_API.request(method, path, opts); } };
      }
      return null;
    }

    /** 启动时把本机缓存同步进内存（页面立即有数据，不依赖网络） */
    function _hydrateFromCache() {
      if (mem.grades === null) {
        var g = normalizeGrades(safeParse(_lsGet(LS_GRADES), null));
        if (g) mem.grades = g;
      }
      if (mem.templates === null) {
        var t = sanitizeTemplates(safeParse(_lsGet(LS_TEMPLATES), null));
        mem.templates = t || [];
      }
      _readMeta();
    }

    function getGrades() { _hydrateFromCache(); return mem.grades; }
    function getTemplates() { _hydrateFromCache(); return mem.templates || []; }
    function isDirty() { return !!(mem.dirty.grades || mem.dirty.templates); }
    function hasFreshCache() { return mem.fetchedAt && (now() - mem.fetchedAt) < LIMITS.ttlMs; }

    function _persistGrades(g) {
      mem.grades = g;
      _lsSet(LS_GRADES, JSON.stringify(g));
    }
    function _persistTemplates(list) {
      var t = sanitizeTemplates(list) || [];
      mem.templates = t;
      _lsSet(LS_TEMPLATES, JSON.stringify(t));
    }

    function _putGrades() {
      var api = _api();
      if (!api || !mem.grades) return Promise.resolve(false);
      return api.request('PUT', '/v1/troupe-config/wage-grades', {
        body: { grades: mem.grades }, timeoutMs: 10000, showErrorToast: false
      }).then(function () {
        mem.dirty.grades = false;
        return true;
      }).catch(function (err) {
        mem.dirty.grades = true;
        report.error('⚠️ 工资等级云端保存失败：' + ((err && err.message) || '网络异常') + '，已暂存本机，联网后自动同步');
        return false;
      });
    }

    function _putTemplates() {
      var api = _api();
      if (!api) return Promise.resolve(false);
      mem.putInflight++;
      var seq = mem.putInflight;
      return api.request('PUT', '/v1/troupe-config/templates', {
        body: { templates: mem.templates || [] }, timeoutMs: 12000, showErrorToast: false
      }).then(function () {
        if (seq === mem.putInflight) mem.dirty.templates = false; // 只清最新一次结果
        return true;
      }).catch(function (err) {
        mem.dirty.templates = true;
        report.error('⚠️ 组团模板云端保存失败：' + ((err && err.message) || '网络异常') + '，已暂存本机，联网后自动同步');
        return false;
      });
    }

    /** 工资等级保存（立即 PUT），先乐观写本机缓存 */
    function saveGrades(grades) {
      var g = normalizeGrades(grades);
      if (!g) return;
      _persistGrades(g);
      _putGrades();
    }

    /** 模板库整包保存（乐观写本机 + 去抖 PUT，合并连续的另存/重命名/删除） */
    function saveTemplates(list) {
      _persistTemplates(list);
      mem.dirty.templates = true;
      if (typeof deps.clearTimeout === 'function' && mem.tplPutTimer) deps.clearTimeout(mem.tplPutTimer);
      var setT = deps.setTimeout || (typeof setTimeout !== 'undefined' ? setTimeout : null);
      if (!setT) { _putTemplates(); return; }
      mem.tplPutTimer = setT(function () { mem.tplPutTimer = null; _putTemplates(); }, LIMITS.putDebounceMs);
    }

    /** 网络恢复后补推本机未落云的改动 */
    function flushDirty() {
      var jobs = [];
      if (mem.dirty.grades && mem.grades) jobs.push(_putGrades());
      if (mem.dirty.templates) jobs.push(_putTemplates());
      return jobs.length ? Promise.all(jobs) : Promise.resolve([]);
    }

    /**
     * 拉取云端配置（网络优先 + SWR）。hooks:
     *   onApply({grades, templates, migrated, appended}) 云端数据应用后回调（可刷新 UI）
     *   onError(err) 网络失败且无可用云端数据
     * 立即读取本机缓存（getGrades/getTemplates 已有），页面无需 await。
     */
    function bootstrap(hooks) {
      hooks = hooks || {};
      if (hooks.report) setReport(hooks.report);
      _hydrateFromCache();
      var api = _api();
      if (!api) {
        // API 未就绪（离线模式等）：保持本机数据，不报错打扰
        if (hooks.onError) hooks.onError(new Error('API_UNAVAILABLE'));
        return Promise.resolve({ source: 'cache', grades: mem.grades, templates: mem.templates || [] });
      }
      if (mem.inflight) return mem.inflight;

      mem.inflight = api.request('GET', '/v1/troupe-config', { timeoutMs: 10000, showErrorToast: false })
        .then(async function (d) {
          mem.fetchedAt = now();
          var cloudGrades = normalizeGrades(d && d.wageGrades);
          var cloudTpl = sanitizeTemplates(d && d.templates) || [];
          var info = { migrated: false, appended: 0, tplMigrated: false, gradesMigrated: false };
          // 「本机已与云端对齐」判定：只有对齐成功后才置 migrated，
          // 此后云端为唯一事实来源（含删除），旧缓存不再合并复活任何数据
          var gradesAligned = false;
          var tplAligned = false;

          /* ---- 工资等级：云端权威；云端空 + 本机有旧数据 + 未对齐 → 上云（成功才标记） ---- */
          if (cloudGrades) {
            _persistGrades(cloudGrades);
            gradesAligned = true;
          } else if (mem.grades && !mem.migrated) {
            info.gradesMigrated = await _putGrades();
            gradesAligned = info.gradesMigrated;
          } else {
            gradesAligned = true; // 云端空且本机也无自定义数据（用内置默认），无需迁移
          }

          /* ---- 模板库 ----
           * 云端非空：首次对齐时把本机独有模板合并补传一次；已对齐则云端权威（删除生效）
           * 云端空 + 本机有 + 未对齐：整包迁移
           * 云端空 + 本机空：对齐完成
           */
          if (cloudTpl.length > 0) {
            if (!mem.migrated) {
              var merged = mergeTemplates(cloudTpl, mem.templates || []);
              _persistTemplates(merged.list);
              info.appended = merged.appended;
              tplAligned = merged.appended > 0 ? (await _putTemplates()) : true;
            } else {
              _persistTemplates(cloudTpl);
              tplAligned = true;
            }
          } else if ((mem.templates || []).length > 0 && !mem.migrated) {
            info.tplMigrated = await _putTemplates();
            tplAligned = info.tplMigrated;
          } else {
            _persistTemplates(cloudTpl);
            tplAligned = true;
          }

          if (!mem.migrated && gradesAligned && tplAligned) {
            info.migrated = true;
            mem.migrated = true;
            _writeMeta({ migrated: true, migratedAt: new Date().toISOString() });
            if (info.gradesMigrated || info.tplMigrated) {
              report.info('☁️ 已将本机组团配置（工资等级/模板）同步到云端，多设备共享');
            }
          }
          _writeMeta({ gradesTs: cloudGrades ? (d.updatedAt && d.updatedAt.wageGrades) || null : null });

          if (hooks.onApply) hooks.onApply({ grades: mem.grades, templates: mem.templates || [], info: info });

          // 联网成功后补推本机未落云改动
          return flushDirty().then(function () {
            return { source: 'cloud', grades: mem.grades, templates: mem.templates || [], info: info };
          });
        })
        .catch(function (err) {
          if (hooks.onError) hooks.onError(err);
          else report.warn('☁️ 云端组团配置获取失败，使用本机缓存：' + ((err && err.message) || '网络异常'));
          return { source: 'cache', grades: mem.grades, templates: mem.templates || [], error: err };
        })
        .then(function (res) { mem.inflight = null; return res; });

      return mem.inflight;
    }

    /** 供单测/排障查看内部状态（只读快照） */
    function _debugState() {
      return JSON.parse(JSON.stringify({
        hasGrades: !!mem.grades, tplCount: (mem.templates || []).length,
        fetchedAt: mem.fetchedAt, dirty: mem.dirty, migrated: mem.migrated
      }));
    }

    return {
      LS_KEYS: { grades: LS_GRADES, templates: LS_TEMPLATES, meta: LS_META },
      LIMITS: LIMITS,
      bootstrap: bootstrap,
      flushDirty: flushDirty,
      saveGrades: saveGrades,
      saveTemplates: saveTemplates,
      getGrades: getGrades,
      getTemplates: getTemplates,
      isDirty: isDirty,
      hasFreshCache: hasFreshCache,
      _debugState: _debugState
    };
  }

  /* ============================== 浏览器默认单例 ============================== */
  var _singleton = null;
  function getStore() {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    if (!_singleton) {
      _singleton = createStore({ storage: window.localStorage });
      // 页面重新可见且有未落云改动 → 自动补推
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible' && _singleton.isDirty()) _singleton.flushDirty();
        });
      }
    }
    return _singleton;
  }

  return {
    GRADE_KEYS: GRADE_KEYS,
    CATS: CATS,
    DEFAULT_GRADES: DEFAULT_GRADES,
    LIMITS: LIMITS,
    LS_KEYS: { grades: LS_GRADES, templates: LS_TEMPLATES, meta: LS_META },
    safeParse: safeParse,
    normalizeGrades: normalizeGrades,
    sanitizeTemplates: sanitizeTemplates,
    mergeTemplates: mergeTemplates,
    createStore: createStore,
    getStore: getStore
  };
});
