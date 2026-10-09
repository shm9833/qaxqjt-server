'use strict';

/**
 * src/middleware/serve-uploads.js —— 本地文件静态服务中间件
 * 挂载 /uploads/* → server/uploads/ 本地磁盘
 * 用于本地存储模式（无 COS/S3）
 */
const path = require('path');
const fs = require('fs');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.pdf', '.doc', '.docx', '.xls', '.xlsx'];

// 扩展名 → MIME 映射（与 ALLOWED_EXT 对应，确保浏览器正确渲染）
const MIME_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

module.exports = function serveUploads(opts) {
  opts = opts || {};
  const prefix = opts.prefix || '/uploads';

  return async (ctx, next) => {
    if (!ctx.path.startsWith(prefix)) return next();

    const rel = decodeURIComponent(ctx.path.slice(prefix.length));
    const safe = path.normalize(rel).replace(/^(\.\.\/?)+/g, '');
    const absPath = path.join(UPLOAD_ROOT, safe);

    // 安全校验：必须在 UPLOAD_ROOT 内部
    if (!absPath.startsWith(path.resolve(UPLOAD_ROOT))) {
      ctx.status = 403;
      ctx.body = { ok: false, error: 'FORBIDDEN', message: '非法路径' };
      return;
    }
    if (!fs.existsSync(absPath)) {
      ctx.status = 404;
      ctx.body = { ok: false, error: 'NOT_FOUND', message: '文件不存在' };
      return;
    }
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      ctx.status = 403;
      ctx.body = { ok: false, error: 'FORBIDDEN', message: '目录不可访问' };
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      ctx.status = 403;
      ctx.body = { ok: false, error: 'FORBIDDEN', message: '不允许的文件类型' };
      return;
    }

    ctx.set('Content-Length', stat.size);
    ctx.set('Content-Type', MIME_MAP[ext] || 'application/octet-stream');
    ctx.set('X-Content-Type-Options', 'nosniff');
    ctx.set('Cache-Control', 'public, max-age=86400');
    ctx.body = fs.createReadStream(absPath);
  };
};
