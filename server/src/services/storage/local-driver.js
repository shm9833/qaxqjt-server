'use strict';

/**
 * src/services/storage/local-driver.js —— 本地磁盘存储驱动
 *
 * 文件落地：<server>/uploads/<yyyy>/<mm>/<hash>-<uid><ext>
 * 访问 URL：/uploads/<yyyy>/<mm>/<filename>（由 middleware/serve-uploads.js 提供静态服务）
 *
 * 约定 save 入参（由 storage/index.js 统一组装并校验）：
 *   { tmpPath, originalName, size, mimetype, filename, relKey }
 * 返回：{ driver:'local', key, url, size, mimeType, originalName }
 */
const path = require('path');
const fs = require('fs');
const { BusinessError } = require('../../middleware/error-handler');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', '..', 'uploads');
const URL_PREFIX = '/uploads/';

function _ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 把外部传入的 key 安全化：禁止路径穿越，只允许 yyyy/mm/name 形态 */
function _safeKey(key) {
  const cleaned = path.normalize(String(key || '')).replace(/^(\.\.(\/|\\|$))+/g, '').replace(/^([a-zA-Z]:)?[\\/]+/, '');
  const resolved = path.resolve(UPLOAD_ROOT, cleaned);
  if (resolved !== path.resolve(UPLOAD_ROOT) && !resolved.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
    throw new BusinessError('FORBIDDEN', '非法的文件路径');
  }
  return cleaned;
}

const localDriver = {
  name: 'local',
  urlPrefix: URL_PREFIX,

  async save({ tmpPath, relKey, size, mimetype, originalName, filename }) {
    if (!tmpPath || !fs.existsSync(tmpPath)) {
      throw new BusinessError('VALIDATION_ERROR', '临时文件不存在，上传失败');
    }
    const absPath = path.join(UPLOAD_ROOT, relKey);
    _ensureDir(path.dirname(absPath));
    fs.copyFileSync(tmpPath, absPath);
    // 清理 formidable 临时文件（失败不影响主流程）
    try { fs.unlinkSync(tmpPath); } catch (_) { /* noop */ }

    return {
      driver: 'local',
      key: relKey.split(path.sep).join('/'),
      url: URL_PREFIX + relKey.split(path.sep).join('/'),
      filename,
      size,
      mimeType: mimetype,
      originalName
    };
  },

  /** 按 key（相对 uploads 根）或 /uploads/... URL 删除 */
  async remove(urlOrKey) {
    let key = String(urlOrKey || '');
    if (key.startsWith(URL_PREFIX)) key = key.slice(URL_PREFIX.length);
    // 兼容带域名的绝对地址
    try { key = decodeURIComponent(new URL(urlOrKey).pathname); } catch (_) { /* 相对路径忽略 */ }
    if (key.startsWith(URL_PREFIX)) key = key.slice(URL_PREFIX.length);

    const safe = _safeKey(key);
    const absPath = path.join(UPLOAD_ROOT, safe);
    if (!fs.existsSync(absPath)) {
      return { driver: 'local', deleted: false, reason: 'not_found', key: safe.split(path.sep).join('/') };
    }
    fs.unlinkSync(absPath);
    return { driver: 'local', deleted: true, key: safe.split(path.sep).join('/') };
  }
};

module.exports = localDriver;
