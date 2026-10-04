'use strict';

/**
 * src/controllers/system-settings.js —— 系统设置 CRUD
 * 数据表：Setting（prisma schema 已定义）
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success, created, pageMeta, noContent } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');
const securityConfig = require('../services/security-config');

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    group: row.group || '',
    description: row.description || '',
    isPublic: row.isPublic || false,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : '',
    updatedBy: row.updatedBy || ''
  };
}

const list = async ctx => {
  const { skip, take, page, pageSize } = pageMeta(ctx.query.page, ctx.query.pageSize, 0);
  const where = {};
  if (ctx.query.group) where.group = ctx.query.group;
  if (ctx.query.keyword) {
    where.OR = [
      { key: { contains: ctx.query.keyword } },
      { description: { contains: ctx.query.keyword } }
    ];
  }
  // 非超管只能看公开配置
  const role = ctx.state.user && ctx.state.user.role;
  if (role !== 'super_admin' && role !== 'ops') {
    where.isPublic = true;
  }
  const [rows, total] = await Promise.all([
    prisma.setting.findMany({ where, skip, take, orderBy: { group: 'asc' } }),
    prisma.setting.count({ where })
  ]);
  return success(ctx, rows.map(toApi), { ...pageMeta(page, pageSize, total), total });
};

const detail = async ctx => {
  const row = await prisma.setting.findUnique({ where: { id: ctx.params.id } });
  if (!row) throw new BusinessError('NOT_FOUND', '配置项不存在');
  return success(ctx, toApi(row));
};

const getByKey = async ctx => {
  const row = await prisma.setting.findUnique({ where: { key: ctx.params.key } });
  if (!row) throw new BusinessError('NOT_FOUND', '配置项不存在');
  // 非公开配置需要权限
  const role = ctx.state.user && ctx.state.user.role;
  if (!row.isPublic && role !== 'super_admin' && role !== 'ops') {
    throw new BusinessError('FORBIDDEN', '无权访问该配置');
  }
  return success(ctx, toApi(row));
};

const create = async ctx => {
  const b = ctx.request.body;
  if (!b.key) throw new BusinessError('VALIDATION_ERROR', 'key 必填');
  if (!b.value) throw new BusinessError('VALIDATION_ERROR', 'value 必填');
  // 检查 key 唯一
  const exists = await prisma.setting.findUnique({ where: { key: b.key } });
  if (exists) throw new BusinessError('DUPLICATE_KEY', '配置项 key 已存在');
  const data = {
    id: b.id || idByCtx('sett', 12, nanoid),
    key: b.key,
    value: String(b.value),
    group: b.group || 'general',
    description: b.description || null,
    isPublic: b.isPublic || false,
    updatedBy: ctx.state.user ? ctx.state.user.username : null,
    ts: nowMs()
  };
  const row = await prisma.setting.create({ data });
  if (row.key === securityConfig.KEY_CAPTCHA) securityConfig.reloadCaptchaEnabled().catch(() => {});
  try { await audit({ ctx, module: 'setting', action: 'SETTING_CREATE', targetId: row.id, detail: { key: row.key, group: row.group } }); } catch (_) {}
  return created(ctx, toApi(row));
};

const update = async ctx => {
  const b = ctx.request.body;
  const exists = await prisma.setting.findUnique({ where: { id: ctx.params.id } });
  if (!exists) throw new BusinessError('NOT_FOUND', '配置项不存在');
  const data = {};
  if (b.value !== undefined) data.value = String(b.value);
  if (b.group !== undefined) data.group = b.group;
  if (b.description !== undefined) data.description = b.description;
  if (b.isPublic !== undefined) data.isPublic = b.isPublic;
  data.updatedBy = ctx.state.user ? ctx.state.user.username : null;
  const row = await prisma.setting.update({ where: { id: ctx.params.id }, data });
  if (row.key === securityConfig.KEY_CAPTCHA) securityConfig.reloadCaptchaEnabled().catch(() => {});
  try { await audit({ ctx, module: 'setting', action: 'SETTING_UPDATE', targetId: row.id, detail: { key: row.key, fields: Object.keys(data).filter(k => k !== 'ts' && k !== 'updatedBy') } }); } catch (_) {}
  return success(ctx, toApi(row));
};

const remove = async ctx => {
  const row = await prisma.setting.delete({ where: { id: ctx.params.id } });
  try { await audit({ ctx, module: 'setting', action: 'SETTING_DELETE', targetId: ctx.params.id, detail: { key: row.key } }); } catch (_) {}
  return noContent(ctx);
};

// 批量更新（用于系统设置页面一次保存多个配置项）
const batchUpdate = async ctx => {
  const b = ctx.request.body;
  if (!Array.isArray(b.items)) throw new BusinessError('VALIDATION_ERROR', 'items 必须是数组');
  const username = ctx.state.user ? ctx.state.user.username : null;
  const validItems = b.items.filter(item => item.key && item.value !== undefined);
  // P0 性能修复：批量 upsert 包裹进单事务——原子提交（任一失败整体回滚，不留半截配置），并减少 N 次事务往返
  const rows = await prisma.$transaction(validItems.map(item => prisma.setting.upsert({
    where: { key: item.key },
    create: {
      id: idByCtx('sett', 12, nanoid),
      key: item.key,
      value: String(item.value),
      group: item.group || 'general',
      description: item.description || null,
      isPublic: item.isPublic || false,
      updatedBy: username,
      ts: nowMs()
    },
    update: {
      value: String(item.value),
      group: item.group || undefined,
      description: item.description || undefined,
      isPublic: item.isPublic || undefined,
      updatedBy: username
    }
  })));
  const results = rows.map(toApi);
  if (results.some(r => r.key === securityConfig.KEY_CAPTCHA)) securityConfig.reloadCaptchaEnabled().catch(() => {});
  try { await audit({ ctx, module: 'setting', action: 'SETTING_BATCH_UPDATE', targetId: 'batch', detail: { count: results.length, keys: results.map(r => r.key) } }); } catch (_) {}
  return success(ctx, results);
};

// 系统信息（用于系统设置首页概览）
const systemInfo = async ctx => {
  const totalSettings = await prisma.setting.count();
  const publicSettings = await prisma.setting.count({ where: { isPublic: true } });
  const groups = await prisma.setting.groupBy({ by: ['group'], _count: true });
  const groupMap = {};
  groups.forEach(function (g) { groupMap[g.group || 'general'] = g._count; });
  return success(ctx, {
    totalSettings: totalSettings,
    publicSettings: publicSettings,
    groups: groupMap,
    serverTime: new Date().toISOString()
  });
};

module.exports = {
  list,
  detail,
  getByKey,
  create,
  update,
  remove,
  batchUpdate,
  systemInfo,
  toApi
};
