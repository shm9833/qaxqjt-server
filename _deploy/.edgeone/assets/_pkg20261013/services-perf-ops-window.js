'use strict';

/**
 * services/perf-ops-window.js —— 演出入职登记 / 演职人员操作开放时限（v20261013 新规）
 *
 * 规则（默认参数，可在 Setting key='perf_ops_window' 调整）：
 *  - 入职登记通道：演出日期前 openDaysBefore(默认10) 天自动开放，
 *    至演出结束后 closeHoursAfter(默认24) 小时关闭；
 *  - 演职人员操作（打卡/工资确认等）：演出正式开始（演出日 00:00，可用 opsOpenDaysBefore 提前）开放，
 *    演出结束后 closeHoursAfter 小时自动关闭；
 *  - 连续多场演出（下一场开始 ≤ 当前段关闭点）自动续接，无需手动干预；
 *  - 关闭后下次演出临近按同一规则自动重开；
 *  - 库内无任何演出排期时不启用限制（fail-open），避免误锁。
 *
 * 演出来源：ScheduleV2（订单排期，dateStart..dateEnd）∪ CastSheetsV1（演出单，performanceDate），
 * 排除已取消状态。
 */
const prisma = require('../utils/prisma');

const SETTING_KEY = 'perf_ops_window';

const DEFAULT_PARAMS = {
  enabled: true,        // 总开关：false 时所有通道常开
  openDaysBefore: 10,   // 入职登记：演出前几天开放
  opsOpenDaysBefore: 0, // 演职操作：演出前几天开放（0=演出当天00:00；装台打卡可设为1~2）
  closeHoursAfter: 24   // 演出结束后多少小时关闭
};

const _int = (v, dflt, min, max) => {
  const n = Number(v);
  return isFinite(n) && n >= min && n <= max ? Math.floor(n) : dflt;
};

function sanitizeParams(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    enabled: src.enabled === undefined ? DEFAULT_PARAMS.enabled : !!src.enabled,
    openDaysBefore: _int(src.openDaysBefore, DEFAULT_PARAMS.openDaysBefore, 0, 90),
    opsOpenDaysBefore: _int(src.opsOpenDaysBefore, DEFAULT_PARAMS.opsOpenDaysBefore, 0, 30),
    closeHoursAfter: _int(src.closeHoursAfter, DEFAULT_PARAMS.closeHoursAfter, 1, 24 * 30)
  };
}

async function getParams() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    return sanitizeParams(row ? JSON.parse(row.value) : null);
  } catch (_) {
    return Object.assign({}, DEFAULT_PARAMS);
  }
}

async function saveParams(raw, username) {
  const p = sanitizeParams(raw);
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: {
      id: 'sett_perf_ops_window',
      key: SETTING_KEY,
      value: JSON.stringify(p),
      group: 'schedule',
      description: '演出入职/演职操作开放时限（前10天开放登记·演出开始开放操作·结束后24小时关闭·连场自动续接）',
      isPublic: true,
      updatedBy: username || null,
      ts: Date.now()
    },
    update: { value: JSON.stringify(p), updatedBy: username || null }
  });
  return p;
}

// 东八区日界
function cnDayStart(ms) {
  const t = new Date(ms + 8 * 3600e3);
  t.setUTCHours(0, 0, 0, 0);
  return t.getTime() - 8 * 3600e3;
}
function cnDayEnd(ms) { return cnDayStart(ms) + 24 * 3600e3 - 1; }
function cnYMD(ms) { return new Date(ms + 8 * 3600e3).toISOString().substring(0, 10); }

async function computeWindow(nowInput) {
  const now = nowInput || Date.now();
  const P = await getParams();
  const base = { enabled: P.enabled, params: P, runs: 0 };
  if (!P.enabled) {
    return Object.assign(base, { registerOpen: true, opsOpen: true, message: '', nextOpenDate: null });
  }
  // 汇总演出日期段
  let segs = [];
  try {
    const [schedules, castSheets] = await Promise.all([
      prisma.scheduleV2.findMany({
        where: { status: { notIn: ['cancelled', 'canceled'] } },
        select: { scheduleDateStart: true, scheduleDateEnd: true }
      }),
      prisma.castSheetsV1.findMany({
        where: { status: { notIn: ['cancelled', 'canceled'] } },
        select: { performanceDate: true }
      })
    ]);
    for (const r of schedules) {
      if (!r.scheduleDateStart) continue;
      segs.push({
        start: cnDayStart(new Date(r.scheduleDateStart).getTime()),
        end: cnDayEnd(new Date(r.scheduleDateEnd || r.scheduleDateStart).getTime())
      });
    }
    for (const c of castSheets) {
      if (!c.performanceDate) continue;
      const d = new Date(c.performanceDate).getTime();
      segs.push({ start: cnDayStart(d), end: cnDayEnd(d) });
    }
  } catch (_) {
    segs = [];
  }
  // 无排期数据：不启用限制
  if (!segs.length) {
    return Object.assign(base, { registerOpen: true, opsOpen: true, message: '', nextOpenDate: null, note: 'no_schedules' });
  }
  segs.sort((a, b) => a.start - b.start);
  // 合并连续演出段：下一场开始 ≤ 当前段结束+关闭时长 → 自动续接
  const closeMs = P.closeHoursAfter * 3600e3;
  const runs = [];
  for (const s of segs) {
    const last = runs[runs.length - 1];
    if (last && s.start <= last.end + closeMs + 1) {
      if (s.end > last.end) last.end = s.end;
    } else {
      runs.push({ start: s.start, end: s.end });
    }
  }
  const regOpenMs = P.openDaysBefore * 24 * 3600e3;
  const opsOpenMs = P.opsOpenDaysBefore * 24 * 3600e3;
  let registerOpen = false;
  let opsOpen = false;
  let nextOpen = null;
  for (const run of runs) {
    const regFrom = run.start - regOpenMs;
    const opsFrom = run.start - opsOpenMs;
    const runClose = run.end + closeMs;
    if (now >= regFrom && now <= runClose) registerOpen = true;
    if (now >= opsFrom && now <= runClose) opsOpen = true;
    if (nextOpen === null && regFrom > now) nextOpen = regFrom;
  }
  return Object.assign(base, {
    registerOpen,
    opsOpen,
    runs: runs.length,
    nextOpenDate: nextOpen === null ? null : cnYMD(nextOpen),
    message: registerOpen ? '' : `入职登记通道暂未开放（演出前${P.openDaysBefore}天自动开放，演出结束后${P.closeHoursAfter}小时关闭）`
  });
}

module.exports = {
  SETTING_KEY,
  DEFAULT_PARAMS,
  sanitizeParams,
  getParams,
  saveParams,
  computeWindow
};
