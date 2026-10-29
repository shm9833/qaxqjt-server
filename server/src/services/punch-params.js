'use strict';

/**
 * services/punch-params.js —— 打卡/考勤规则参数（v20261012 打卡新规）
 *
 * 参数存 Setting 表 key='punch_params'（group='attendance'，isPublic=true），
 * 管理端可改（PUT /v1/attendance/punch-params），员工端只读展示打卡窗口。
 *
 * 默认口径（2026-10-12 团里新规）：
 *  - 日场窗口 13:30–14:00，基准 13:30；晚场窗口 19:30–20:00，基准 19:30
 *  - 迟到 1 元/分钟，单场封顶 30 元；迟到 ≥30 分钟本场失效（该场不计薪）
 *  - 不发任何奖励（rewardEnabled=false）
 *  - 事故分级按天：一级 10 元 · 二级 30 元 · 三级 50 元；代打卡查实按三级
 *  - 装台/卸台日：不计薪资、不计迟到、不计奖励
 */
const prisma = require('../utils/prisma');

const SETTING_KEY = 'punch_params';

const DEFAULT_PUNCH_PARAMS = {
  dayWindowStart: '13:30',      // 日场打卡窗口开始
  dayWindowEnd: '14:00',        // 日场打卡窗口结束
  dayBaseline: '13:30',         // 日场迟到基准
  nightWindowStart: '19:30',    // 晚场打卡窗口开始
  nightWindowEnd: '20:00',      // 晚场打卡窗口结束
  nightBaseline: '19:30',       // 晚场迟到基准
  lateFinePerMin: 1,            // 迟到罚款 元/分钟
  lateFineCap: 30,              // 单场迟到罚款上限 元
  lateInvalidMinutes: 30,       // 迟到满该分钟数本场失效
  rewardEnabled: false,         // 奖励开关（false=不发任何奖励）
  accidentLevel1Fine: 10,       // 事故一级 元/天
  accidentLevel2Fine: 30,       // 事故二级 元/天
  accidentLevel3Fine: 50,       // 事故三级 元/天
  proxyPunchLevel: 3,           // 代打卡查实按的事故级别（默认三级）
  stageDayNoPay: true           // 装台/卸台日不计薪不计迟到不计奖励
};

// 考勤/打卡类型中文映射（shared：self-service 员工端展示与 attendance 管理端共用，避免两处漂移）
const ATT_TYPE_TEXT = {
  full: '全天班', night: '夜班', double: '双班', half: '半天班',
  rest: '公休', SL: '病假', PL: '事假(限2次/2天)', BL: '丧假', ML: '婚假',
  AL: '年假', absent: '旷工', rainout: '雨休', leave: '请假(其他)',
  late: '迟到(30分钟内)', late_over: '迟到超30分钟',
  early: '早退(30分钟内)', early_over: '早退超30分钟',
  outing: '外出', study: '学习', business: '出差', injury: '工伤',
  // v20261012 打卡新规类型
  stage_in: '装台日(不计薪不计迟到)',
  stage_out: '卸台日(不计薪不计迟到)',
  accident_l1: '事故一级(扣10元/天)',
  accident_l2: '事故二级(扣30元/天)',
  accident_l3: '事故三级(扣50元/天·代打卡查实按此级)'
};

// 装台/卸台考勤类型（当日打卡不计迟到不计罚款不计薪）
const STAGE_TYPES = ['stage_in', 'stage_out'];

const _HM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const _num = (v, dflt) => { const n = Number(v); return isFinite(n) && n >= 0 ? n : dflt; };
const _hm = (v, dflt) => (typeof v === 'string' && _HM_RE.test(v.trim())) ? v.trim() : dflt;

function sanitizeParams(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const p = Object.assign({}, DEFAULT_PUNCH_PARAMS);
  p.dayWindowStart = _hm(src.dayWindowStart, p.dayWindowStart);
  p.dayWindowEnd = _hm(src.dayWindowEnd, p.dayWindowEnd);
  p.dayBaseline = _hm(src.dayBaseline, p.dayBaseline);
  p.nightWindowStart = _hm(src.nightWindowStart, p.nightWindowStart);
  p.nightWindowEnd = _hm(src.nightWindowEnd, p.nightWindowEnd);
  p.nightBaseline = _hm(src.nightBaseline, p.nightBaseline);
  p.lateFinePerMin = _num(src.lateFinePerMin, p.lateFinePerMin);
  p.lateFineCap = _num(src.lateFineCap, p.lateFineCap);
  p.lateInvalidMinutes = _num(src.lateInvalidMinutes, p.lateInvalidMinutes);
  p.rewardEnabled = src.rewardEnabled === undefined ? p.rewardEnabled : !!src.rewardEnabled;
  p.accidentLevel1Fine = _num(src.accidentLevel1Fine, p.accidentLevel1Fine);
  p.accidentLevel2Fine = _num(src.accidentLevel2Fine, p.accidentLevel2Fine);
  p.accidentLevel3Fine = _num(src.accidentLevel3Fine, p.accidentLevel3Fine);
  p.proxyPunchLevel = [1, 2, 3].indexOf(Number(src.proxyPunchLevel)) >= 0 ? Number(src.proxyPunchLevel) : p.proxyPunchLevel;
  p.stageDayNoPay = src.stageDayNoPay === undefined ? p.stageDayNoPay : !!src.stageDayNoPay;
  return p;
}

async function getPunchParams() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    return sanitizeParams(row ? JSON.parse(row.value) : null);
  } catch (_) {
    return Object.assign({}, DEFAULT_PUNCH_PARAMS);
  }
}

async function savePunchParams(raw, username) {
  const p = sanitizeParams(raw);
  const value = JSON.stringify(p);
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: {
      id: 'sett_punch_params',
      key: SETTING_KEY,
      value,
      group: 'attendance',
      description: '打卡/考勤规则参数（日场晚场窗口/迟到罚款/事故分级/装台卸台）',
      isPublic: true,
      updatedBy: username || null,
      ts: Date.now()
    },
    update: {
      value,
      updatedBy: username || null
    }
  });
  return p;
}

// 'HH:MM' → 当日分钟数
function hmToMin(hm) {
  const m = String(hm || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

// 东八区当前分钟数
function cnMinutesNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// 按分钟数判定场次：就近基准（day/night），分界点为两基准中点
function sessionForMinutes(mins, P) {
  const day = hmToMin(P.dayBaseline);
  const night = hmToMin(P.nightBaseline);
  return Math.abs(mins - day) <= Math.abs(mins - night) ? 'day' : 'night';
}

// 计算迟到结果：迟到分钟数、罚款（1元/分封顶）、是否本场失效、状态
function computeLateResult(mins, session, P) {
  const baseline = session === 'night' ? hmToMin(P.nightBaseline) : hmToMin(P.dayBaseline);
  const lateMinutes = Math.max(0, mins - baseline);
  const invalid = lateMinutes >= Number(P.lateInvalidMinutes);
  const fine = Math.min(Math.round(lateMinutes * Number(P.lateFinePerMin) * 100) / 100, Number(P.lateFineCap));
  return {
    lateMinutes,
    invalid,
    fine,
    status: invalid ? 'late_invalid' : (lateMinutes > 0 ? 'late' : 'normal')
  };
}

// 由 UTC punchTime 推东八区分钟数
function cnMinutesFromUtcDate(d) {
  const t = new Date((d instanceof Date ? d.getTime() : Number(d)) + 8 * 3600 * 1000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

module.exports = {
  SETTING_KEY,
  DEFAULT_PUNCH_PARAMS,
  ATT_TYPE_TEXT,
  STAGE_TYPES,
  sanitizeParams,
  getPunchParams,
  savePunchParams,
  hmToMin,
  cnMinutesNow,
  cnMinutesFromUtcDate,
  sessionForMinutes,
  computeLateResult
};
