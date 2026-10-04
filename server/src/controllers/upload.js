'use strict';

/**
 * src/controllers/upload.js —— 通用文件上传接口（存储层 local/cos 双驱动）
 *
 * POST   /v1/upload        单文件（multipart 字段名 file）
 * POST   /v1/upload/multi  多文件（multipart 字段名 file 或 files，可重复/多值）
 * DELETE /v1/upload        删除文件（body/query: { url }，仅允许删除本系统上传前缀）
 *
 * 鉴权：super_admin / ops / director（路由层控制）
 * 返回：{ ok:true, data:{ url, filename, size, mimeType, originalName, driver, key } }
 *
 * 存储驱动由 STORAGE_DRIVER 环境变量决定，见 services/storage/index.js
 */
const { success } = require('../utils/response');
const { BusinessError } = require('../middleware/error-handler');
const { audit } = require('../services/audit-service');
const storage = require('../services/storage');

// 单文件上传
const upload = async ctx => {
  const raw = ctx.request.files && ctx.request.files.file;
  if (raw === undefined || raw === null) throw new BusinessError('VALIDATION_ERROR', '未收到文件字段 file');
  const f = Array.isArray(raw) ? raw[0] : raw; // multiples:true 时单字段也可能是数组

  const data = await storage.saveFormFile(f);

  await audit({
    ctx,
    module: 'upload',
    action: 'FILE_UPLOAD',
    targetId: data.filename,
    detail: { driver: data.driver, originalName: data.originalName, size: data.size, mimeType: data.mimeType, url: data.url }
  });

  return success(ctx, data);
};

// 多文件上传（最多 9 个，每个 ≤ 50MB 由存储层校验）
const MAX_MULTI = 9;
const uploadMulti = async ctx => {
  const filesHolder = ctx.request.files || {};
  let list = [];
  // 同时兼容字段名 file 与 files，且每个字段可能是单对象或数组
  ['file', 'files'].forEach(k => {
    const v = filesHolder[k];
    if (v === undefined || v === null) return;
    list = list.concat(Array.isArray(v) ? v : [v]);
  });
  if (!list.length) throw new BusinessError('VALIDATION_ERROR', '未收到文件（字段名用 file 或 files，可多值）');
  if (list.length > MAX_MULTI) throw new BusinessError('VALIDATION_ERROR', '单次最多上传 ' + MAX_MULTI + ' 个文件，当前 ' + list.length + ' 个');

  const saved = [];
  // 逐个保存：某一个失败不影响已成功的，但把失败原因汇总返回
  const failed = [];
  for (const f of list) {
    try {
      // eslint-disable-next-line no-await-in-loop
      saved.push(await storage.saveFormFile(f));
    } catch (e) {
      failed.push({ name: f && (f.originalFilename || f.newFilename), reason: e.message });
    }
  }

  await audit({
    ctx,
    module: 'upload',
    action: 'FILE_UPLOAD_MULTI',
    targetId: saved.map(s => s.filename).join(','),
    detail: { count: saved.length, failed, urls: saved.map(s => s.url) }
  });

  return success(ctx, {
    files: saved,
    count: saved.length,
    failed
  });
};

// 删除文件（仅允许删除本系统 /uploads/ 前缀或 COS keyPrefix 内对象）
const remove = async ctx => {
  const url = (ctx.request.body && ctx.request.body.url) || ctx.query.url;
  if (!url) throw new BusinessError('VALIDATION_ERROR', '缺少 url 参数');

  // 安全护栏：只允许删除本系统产生的相对/绝对路径，拒绝外部域名与敏感路径
  const u = String(url);
  const localOk = u.startsWith('/uploads/');
  const driver = storage.getDriverName();
  const cosOk = driver === 'cos' && /^https?:\/\/.+/i.test(u);
  if (!localOk && !cosOk) {
    throw new BusinessError('FORBIDDEN', '仅允许删除本系统上传的文件（/uploads/ 前缀）');
  }
  if (/\.\.[\\/]/.test(u)) throw new BusinessError('FORBIDDEN', '非法路径');

  const data = await storage.remove(u);

  await audit({
    ctx,
    module: 'upload',
    action: 'FILE_DELETE',
    targetId: data.key || u,
    detail: { driver: data.driver, url: u, deleted: data.deleted }
  });

  return success(ctx, data);
};

module.exports = { upload, uploadMulti, remove };
