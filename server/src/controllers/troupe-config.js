'use strict';

/**
 * src/controllers/troupe-config.js —— 组团模板库 & W1-W7 工资等级 云端持久化
 * GET   /v1/troupe-config                    一次取回两类配置（多设备共享）
 * PUT   /v1/troupe-config/wage-grades        覆盖写工资等级（严格校验）
 * PUT   /v1/troupe-config/templates          覆盖写模板库（消毒+裁剪，最多50份）
 *
 * 复用 Setting 表（与 site-assets / 工资商议单存档同模式）：
 *   group='troupe_config'
 *   key=troupe.wage_grades.v1 / troupe.templates.v1，value 为 JSON 字符串
 * 不新增表、不动 prisma schema。
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');
const {
  LIMITS,
  validateGrades,
  normalizeGrades,
  sanitizeTemplates,
  checkJsonSize
} = require('../utils/troupe-config-schema');

const GROUP = 'troupe_config';
const KEY_GRADES = 'troupe.wage_grades.v1';
const KEY_TEMPLATES = 'troupe.templates.v1';

async function _readJson(key) {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row || !row.value) return { value: null, updatedAt: null };
  try {
    return { value: JSON.parse(row.value), updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null };
  } catch (e) {
    // 落库内容损坏：不当作 500，返回 null 让前端走本地缓存/默认
    return { value: null, updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null, parseError: true };
  }
}

async function _writeJson(key, obj, maxLen, username, auditAction, auditDetail, ctx) {
  checkJsonSize(obj, maxLen, key);
  const value = JSON.stringify(obj);
  const data = {
    value,
    group: GROUP,
    description: 'cast-sheet 组团配置（云端共享）',
    isPublic: false,
    updatedBy: username,
    ts: nowMs()
  };
  const row = await prisma.setting.upsert({
    where: { key },
    create: Object.assign({ id: idByCtx('sett', 12, nanoid), key }, data),
    update: data
  });
  try {
    await audit({ ctx: ctx || null, module: 'setting', action: auditAction, targetId: row.id, detail: auditDetail });
  } catch (_) {}
  return row;
}

// GET /v1/troupe-config
const getAll = async ctx => {
  const [g, t] = await Promise.all([_readJson(KEY_GRADES), _readJson(KEY_TEMPLATES)]);
  return success(ctx, {
    wageGrades: normalizeGrades(g.value),
    templates: sanitizeTemplates(t.value) || [],
    updatedAt: { wageGrades: g.updatedAt, templates: t.updatedAt }
  });
};

// PUT /v1/troupe-config/wage-grades  body { grades: {W1..W7:{name,daily}} }
const putGrades = async ctx => {
  const b = ctx.request.body || {};
  const chk = validateGrades(b.grades);
  if (!chk.ok) throw new BusinessError('VALIDATION_ERROR', '工资等级校验失败：' + chk.errors.join('；'));
  const username = ctx.state.user ? ctx.state.user.username : null;
  await _writeJson(KEY_GRADES, chk.value, LIMITS.gradesJson, username, 'TROUPE_GRADES_SAVE', { keys: Object.keys(chk.value) }, ctx);
  return success(ctx, { wageGrades: chk.value });
};

// PUT /v1/troupe-config/templates  body { templates: [...] }
const putTemplates = async ctx => {
  const b = ctx.request.body || {};
  const list = sanitizeTemplates(b.templates);
  if (!list) throw new BusinessError('VALIDATION_ERROR', 'templates 必须是数组');
  const username = ctx.state.user ? ctx.state.user.username : null;
  await _writeJson(KEY_TEMPLATES, list, LIMITS.templatesJson, username, 'TROUPE_TEMPLATES_SAVE', { count: list.length }, ctx);
  return success(ctx, { templates: list, count: list.length });
};

module.exports = { getAll, putGrades, putTemplates };
