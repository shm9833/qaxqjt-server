'use strict';

/**
 * src/utils/troupe-config-schema.js
 * 组团模板库 / W1-W7 工资等级「云端配置」的纯函数校验与归一化（无任何 IO，可独立单元测试）。
 *
 * 设计原则：
 *  - 写入（PUT）：结构非法直接报错；单条内容问题走「消毒」策略（裁剪/补默认），绝不让坏数据落库
 *  - 读取（GET）：永远返回形状稳定的数据，损坏/缺字段不炸页面（与前端 troupe-cloud-store.js 同口径）
 */

const GRADE_KEYS = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'];
const CATS = ['actor', 'band', 'front', 'costume', 'electric'];
const DEFAULT_GRADES = {
  W1: { name: '实习', daily: 80 },
  W2: { name: '替补', daily: 120 },
  W3: { name: 'C角', daily: 180 },
  W4: { name: 'B角', daily: 280 },
  W5: { name: 'A角', daily: 400 },
  W6: { name: '主B', daily: 600 },
  W7: { name: '主A角', daily: 800 }
};
const LIMITS = {
  gradesJson: 8000,        // 7 档等级 JSON 上限（字节）
  templatesJson: 200000,   // 模板库整包 JSON 上限（字节，约 50 份×36 人，留足余量）
  templates: 50,
  personsPerTemplate: 120,
  nameLen: 40,
  tplNameLen: 40,
  roleLen: 30,
  idLen: 40,
  dailyMax: 100000,
  daysMin: 1,
  daysMax: 60
};

function _str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function _num(v, min, max, def) {
  const n = Number(v);
  if (!isFinite(n)) return def;
  let r = Math.round(n * 100) / 100;
  if (r < min) r = min;
  if (r > max) r = max;
  return r;
}

function _iso(v) {
  const s = String(v == null ? '' : v);
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/**
 * 严格校验工资等级（写入用）：7 档必须齐全、名称非空、日薪为 ≥0 数字
 * @returns {{ok:boolean,errors:string[],value:object|null}}
 */
function validateGrades(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['grades 必须是对象'], value: null };
  }
  const errors = [];
  const value = {};
  GRADE_KEYS.forEach(k => {
    const g = raw[k];
    if (!g || typeof g !== 'object') { errors.push(k + ' 缺失或格式错误'); return; }
    const name = _str(g.name, LIMITS.nameLen);
    if (!name) { errors.push(k + ' 名称不能为空'); return; }
    const d = Number(g.daily);
    if (!isFinite(d) || d < 0) { errors.push(k + ' 日薪必须为 ≥0 的数字'); return; }
    value[k] = { name, daily: _num(d, 0, LIMITS.dailyMax, 0) };
  });
  return { ok: errors.length === 0, errors, value: errors.length === 0 ? value : null };
}

/**
 * 归一化工资等级（读取用）：缺档补默认、越界裁剪、类型错误回默认，保证 7 档齐全
 * @returns {object|null} raw 完全不是对象时返回 null（调用方自行决定回退本地默认）
 */
function normalizeGrades(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  GRADE_KEYS.forEach(k => {
    const g = raw[k] && typeof raw[k] === 'object' ? raw[k] : {};
    const name = _str(g.name, LIMITS.nameLen) || DEFAULT_GRADES[k].name;
    out[k] = { name, daily: _num(g.daily, 0, LIMITS.dailyMax, DEFAULT_GRADES[k].daily) };
  });
  return out;
}

function _validId(v) {
  const s = _str(v, LIMITS.idLen);
  return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : '';
}

/**
 * 消毒模板库（读/写共用）：非数组→null；逐条裁剪人数/字段长度，非法枚举补默认，丢弃非对象条目
 * @returns {Array|null}
 */
function sanitizeTemplates(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  raw.slice(0, LIMITS.templates).forEach((t, idx) => {
    if (!t || typeof t !== 'object') return;
    const dataRaw = Array.isArray(t.data) ? t.data : [];
    const data = [];
    dataRaw.slice(0, LIMITS.personsPerTemplate).forEach(p => {
      if (!p || typeof p !== 'object') return;
      const cat = CATS.indexOf(p.cat) >= 0 ? p.cat : 'front';
      const grade = GRADE_KEYS.indexOf(p.grade) >= 0 ? p.grade : 'W1';
      data.push({
        cat,
        name: _str(p.name, LIMITS.nameLen),
        role: _str(p.role, LIMITS.roleLen),
        grade,
        daily: _num(p.daily, 0, LIMITS.dailyMax, 0)
      });
    });
    out.push({
      id: _validId(t.id) || ('tp_' + Date.now().toString(36) + '_' + idx),
      name: _str(t.name, LIMITS.tplNameLen) || ('未命名模板' + (idx + 1)),
      days: _num(t.days, LIMITS.daysMin, LIMITS.daysMax, 3),
      savedAt: _iso(t.savedAt),
      data
    });
  });
  return out;
}

/** 整包 JSON 大小守卫 */
function checkJsonSize(obj, max, label) {
  const len = Buffer.byteLength(JSON.stringify(obj), 'utf8');
  if (len > max) {
    const e = new Error((label || '数据') + '超出大小限制（' + max + ' 字节，当前 ' + len + '）');
    e.code = 'PAYLOAD_TOO_LARGE';
    throw e;
  }
  return len;
}

module.exports = {
  GRADE_KEYS,
  CATS,
  DEFAULT_GRADES,
  LIMITS,
  validateGrades,
  normalizeGrades,
  sanitizeTemplates,
  checkJsonSize
};
