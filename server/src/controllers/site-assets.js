'use strict';

/**
 * src/controllers/site-assets.js —— 站点图片位投放管理
 * 复用 Setting 表：group='site_assets'，key=点位标识（如 site.home.about_img），value=图片URL（空串=恢复默认）
 * 公开接口仅返回非空投放值，前端无投放时保留页面默认图。
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const { idByCtx, nowMs } = require('../config');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');

const GROUP = 'site_assets';
const KEY_RE = /^site\.[a-z0-9_.-]{1,80}$/i;

// 公开接口（无鉴权）：返回 { key: url } 映射（仅已投放的非空值）
const publicMap = async ctx => {
  const rows = await prisma.setting.findMany({
    where: { group: GROUP, isPublic: true },
    select: { key: true, value: true, updatedAt: true }
  });
  const map = {};
  let latest = 0;
  rows.forEach(r => {
    if (r.value) map[r.key] = r.value;
    const t = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
    if (t > latest) latest = t;
  });
  return success(ctx, { map, updatedAt: latest });
};

// 管理列表：site_assets 组全部记录（含空值=已恢复默认的）
const list = async ctx => {
  const rows = await prisma.setting.findMany({
    where: { group: GROUP },
    orderBy: { key: 'asc' }
  });
  return success(ctx, rows.map(r => ({
    key: r.key,
    value: r.value || '',
    description: r.description || '',
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : '',
    updatedBy: r.updatedBy || ''
  })));
};

// 投放/更新：PUT /v1/site-assets/:key  body { value, description }
// value 为空串表示恢复默认（保留记录便于审计）
const upsert = async ctx => {
  const key = String(ctx.params.key || '').trim();
  if (!KEY_RE.test(key)) throw new BusinessError('VALIDATION_ERROR', 'key 格式不合法（须以 site. 开头）');
  const b = ctx.request.body || {};
  if (b.value === undefined) throw new BusinessError('VALIDATION_ERROR', 'value 必填（空串=恢复默认）');
  const value = String(b.value || '').trim();
  // site.text.* 为纯文本配置位（如客服微信号/公众号名），其余 key 仍要求图片 URL
  const isTextKey = key.indexOf('site.text.') === 0;
  if (isTextKey) {
    if (value.length > 200) throw new BusinessError('VALIDATION_ERROR', '文本值不能超过 200 字');
  } else if (value && !/^(https?:\/\/|\/|data:image\/)/i.test(value)) {
    throw new BusinessError('VALIDATION_ERROR', 'value 必须是图片 URL');
  }
  const username = ctx.state.user ? ctx.state.user.username : null;
  const row = await prisma.setting.upsert({
    where: { key },
    create: {
      id: idByCtx('sett', 12, nanoid),
      key,
      value,
      group: GROUP,
      description: b.description || null,
      isPublic: true,
      updatedBy: username,
      ts: nowMs()
    },
    update: {
      value,
      description: b.description || undefined,
      isPublic: true,
      updatedBy: username
    }
  });
  try { await audit({ ctx, module: 'setting', action: 'SITE_ASSET_UPSERT', targetId: row.id, detail: { key, hasValue: !!value } }); } catch (_) {}
  return success(ctx, { key: row.key, value: row.value, updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : '' });
};

module.exports = { publicMap, list, upsert };
