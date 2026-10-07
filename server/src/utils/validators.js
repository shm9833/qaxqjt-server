'use strict';

/**
 * src/utils/validators.js —— 通用业务字段校验（无第三方依赖，可被控制器/测试复用）
 * 覆盖：姓名（2-50 字符）、身份证号（GB 11643-1999 18 位 + 校验码）、手机号（11 位）
 */

const NAME_RE = /^[\u4e00-\u9fa5A-Za-z·．.・\s]{2,50}$/;

/**
 * 姓名：2-50 字符；允许汉字、英文字母、间隔号（·）、中点与空格
 * @param {string} v
 * @returns {boolean}
 */
function isValidName(v) {
  return typeof v === 'string' && NAME_RE.test(v.trim()) && v.trim().length >= 2 && v.trim().length <= 50;
}

/**
 * 大陆手机号：1 开头，第二位 3-9，共 11 位数字
 * @param {string} v
 * @returns {boolean}
 */
function isValidMobile(v) {
  return typeof v === 'string' && /^1[3-9]\d{9}$/.test(v.trim());
}

// GB 11643-1999 校验码：前 17 位加权因子
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
// 模 11 结果 → 第 18 位校验码
const ID_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

/**
 * 身份证号：18 位；前 17 位数字 + 末位数字/X；出生日期合法；末位校验码正确
 * @param {string} v
 * @returns {boolean}
 */
function isValidIdCard(v) {
  if (typeof v !== 'string') {
    return false;
  }
  const s = v.trim().toUpperCase();
  if (!/^\d{17}[\dX]$/.test(s)) {
    return false;
  }
  // 出生日期段（第 7-14 位，YYYYMMDD）必须是真实日期
  const y = Number(s.substring(6, 10));
  const m = Number(s.substring(10, 12));
  const d = Number(s.substring(12, 14));
  if (y < 1900 || y > new Date().getFullYear() || m < 1 || m > 12 || d < 1 || d > 31) {
    return false;
  }
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return false;
  }
  // 校验码（ISO 7064:1983 MOD 11-2）
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    sum += Number(s[i]) * ID_WEIGHTS[i];
  }
  return ID_CHECK_CODES[sum % 11] === s[17];
}

/** 归一化身份证号：去空格、末位 x → X */
function normalizeIdCard(v) {
  return typeof v === 'string' ? v.trim().toUpperCase() : v;
}

module.exports = {
  NAME_RE,
  ID_WEIGHTS,
  ID_CHECK_CODES,
  isValidName,
  isValidMobile,
  isValidIdCard,
  normalizeIdCard
};
