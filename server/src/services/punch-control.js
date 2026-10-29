'use strict';

/**
 * services/punch-control.js —— 全团打卡总控（v20261017 新规）
 *
 * 存 Setting 表 key='troupe_punch_control'（group='attendance'，isPublic=true）。
 * 管理端三按钮：🏖️全团休假 / ⏸️暂停打卡 / ▶️恢复开放（收假）。
 *
 * 值结构：
 *   { ranges:[{kind:'vacation'|'pause', start:'YYYY-MM-DD', end:'YYYY-MM-DD'|null,
 *              reason, by, at}], updatedBy, updatedAt }
 *   - end=null 表示进行中；存在进行中区间时 mode=该区间 kind，否则 'open'
 *   - 恢复（收假）时 end=昨天（东八区），使恢复当日即可打卡且计薪
 *
 * 生效面：
 *   - perf-ops-window.computeWindow 集成：mode!=='open' 时强制 opsOpen=false
 *     （员工打卡与工资确认两处现有 opsOpen 闸口同时封闭，全局通用）
 *   - wages/helpers._attendanceByStaff：区间内的考勤记录统一跳过（不计工资）
 */
const prisma = require('../utils/prisma');
const { BusinessError } = require('../middleware/error-handler');

const SETTING_KEY = 'troupe_punch_control';
const KINDS = ['vacation', 'pause'];
const KIND_TEXT = { vacation: '全团休假', pause: '暂停打卡' };

// 东八区 YYYY-MM-DD
function cnYMD(ms) { return new Date(ms + 8 * 3600e3).toISOString().substring(0, 10); }
// 'YYYY-MM-DD' → 该日 UTC 零点毫秒（与 attendanceV1.attendanceDate 口径一致）
function ymdToMs(ymd) { return Date.parse(ymd + 'T00:00:00.000Z'); }
const _YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeRange(r) {
  if (!r || typeof r !== 'object') return null;
  if (KINDS.indexOf(r.kind) < 0) return null;
  if (typeof r.start !== 'string' || !_YMD_RE.test(r.start) || !isFinite(ymdToMs(r.start))) return null;
  const end = (r.end === null || r.end === undefined || r.end === '') ? null : String(r.end);
  if (end !== null && (!_YMD_RE.test(end) || !isFinite(ymdToMs(end)))) return null;
  if (end !== null && ymdToMs(end) < ymdToMs(r.start)) return null;
  return {
    kind: r.kind,
    start: r.start,
    end,
    reason: typeof r.reason === 'string' ? r.reason.slice(0, 100) : '',
    by: typeof r.by === 'string' ? r.by : null,
    at: isFinite(Number(r.at)) ? Number(r.at) : Date.now()
  };
}

function sanitizeState(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const ranges = Array.isArray(src.ranges) ? src.ranges.map(sanitizeRange).filter(Boolean) : [];
  return {
    ranges,
    updatedBy: typeof src.updatedBy === 'string' ? src.updatedBy : null,
    updatedAt: isFinite(Number(src.updatedAt)) ? Number(src.updatedAt) : null
  };
}

async function _read() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    return sanitizeState(row ? JSON.parse(row.value) : null);
  } catch (_) {
    return sanitizeState(null);
  }
}

async function _write(state, username) {
  state.updatedBy = username || null;
  state.updatedAt = Date.now();
  const value = JSON.stringify(state);
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: {
      id: 'sett_troupe_punch_control',
      key: SETTING_KEY,
      value,
      group: 'attendance',
      description: '全团打卡总控（休假/暂停区间；开放闸口与工资核算共用）',
      isPublic: true,
      updatedBy: username || null,
      ts: Date.now()
    },
    update: { value, updatedBy: username || null }
  });
  return state;
}

// 当前状态：mode=open|vacation|pause，current=进行中的区间（无则 null）
async function getState() {
  const s = await _read();
  const current = s.ranges.find(r => r.end === null) || null;
  return { mode: current ? current.kind : 'open', current, ranges: s.ranges, updatedBy: s.updatedBy, updatedAt: s.updatedAt };
}

// 开始休假/暂停（已有进行中区间时拒绝）
async function startRange(kind, reason, username) {
  if (KINDS.indexOf(kind) < 0) {
    throw new BusinessError('VALIDATION_ERROR', 'kind 必须为 vacation（休假）或 pause（暂停）');
  }
  const s = await _read();
  if (s.ranges.some(r => r.end === null)) {
    throw new BusinessError('CONFLICT', '当前已有进行中的休假/暂停，请先「恢复开放」再发起新操作');
  }
  const range = {
    kind,
    start: cnYMD(Date.now()),
    end: null,
    reason: typeof reason === 'string' ? reason.slice(0, 100) : '',
    by: username || null,
    at: Date.now()
  };
  s.ranges.push(range);
  await _write(s, username);
  return range;
}

// 恢复开放（收假）：end=昨天（东八区），恢复当日即可打卡且计薪
async function closeCurrent(username) {
  const s = await _read();
  const cur = s.ranges.find(r => r.end === null);
  if (!cur) {
    throw new BusinessError('CONFLICT', '当前没有进行中的休假/暂停');
  }
  cur.end = cnYMD(Date.now() - 24 * 3600e3);
  if (ymdToMs(cur.end) < ymdToMs(cur.start)) cur.end = cur.start; // 当天开始当天恢复：区间即为当天
  await _write(s, username);
  return cur;
}

// 工资核算用：某日是否落在任一休假/暂停区间内（入参：UTC 零点毫秒 或 'YYYY-MM-DD'）
function isDateExcludedIn(state, msOrYmd) {
  const ms = typeof msOrYmd === 'string' ? ymdToMs(msOrYmd) : Number(msOrYmd);
  if (!isFinite(ms)) return false;
  for (const r of (state && state.ranges) || []) {
    const a = ymdToMs(r.start);
    const b = r.end === null ? Infinity : ymdToMs(r.end);
    if (ms >= a && ms <= b) return true;
  }
  return false;
}

module.exports = {
  SETTING_KEY,
  KINDS,
  KIND_TEXT,
  getState,
  startRange,
  closeCurrent,
  isDateExcludedIn,
  cnYMD
};
