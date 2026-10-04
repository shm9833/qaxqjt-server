'use strict';

/**
 * src/services/storage/index.js —— 文件存储门面（local / cos 双驱动）
 *
 * 驱动选择：环境变量 STORAGE_DRIVER = local（默认） | cos
 *   - local：落盘 server/uploads/，由 /uploads/* 静态中间件提供访问
 *   - cos  ：腾讯云对象存储，需配置 COS_* 环境变量并安装 cos-nodejs-sdk-v5
 *
 * 业务层（controllers/upload.js）只依赖本模块，不直接接触驱动实现。
 */
const path = require('path');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const { BusinessError } = require('../../middleware/error-handler');
const localDriver = require('./local-driver');
const cosDriver = require('./cos-driver');

/** 允许的扩展名（扩展名 → 默认 MIME） */
const ALLOWED = {
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

const MAX_SIZE = 50 * 1024 * 1024; // 50MB（与 app.js koa-body 上限一致）

function getDriverName() {
  return String(process.env.STORAGE_DRIVER || 'local').toLowerCase();
}

function getDriver() {
  const name = getDriverName();
  if (name === 'cos') return cosDriver;
  if (name === 'local') return localDriver;
  throw new BusinessError('CONFIG_ERROR', '不支持的 STORAGE_DRIVER：' + name + '（仅支持 local / cos）');
}

function extOf(filename) {
  return path.extname(filename || '').toLowerCase();
}

function safeOriginalName(name) {
  // 去路径穿越与控制字符，只保留 basename
  return path.basename(String(name || '')).replace(/[\x00-\x1f<>:"|?*]/g, '_');
}

/** 统一校验 formidable 解析出的文件对象 */
function validateFile(f) {
  if (!f) throw new BusinessError('VALIDATION_ERROR', '未收到文件');
  const originalName = safeOriginalName(f.originalFilename || f.newFilename || 'unknown');
  const ext = extOf(originalName);
  if (!ALLOWED[ext]) {
    throw new BusinessError('VALIDATION_ERROR', '不支持的文件类型：' + (ext || '(无扩展名)') + '，允许：' + Object.keys(ALLOWED).join(' '));
  }
  const size = Number(f.size) || 0;
  if (size <= 0) throw new BusinessError('VALIDATION_ERROR', '文件大小为 0，可能上传失败');
  if (size > MAX_SIZE) throw new BusinessError('VALIDATION_ERROR', '文件大小超过 50MB 限制');
  return { originalName, ext, size, mimetype: f.mimetype || ALLOWED[ext], tmpPath: f.filepath };
}

/** 生成相对 key：yyyy/mm/<md5hash>-<nanoid6><ext> */
function buildRelKey(originalName, ext) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const hash = crypto.createHash('md5').update(originalName + Date.now() + Math.random()).digest('hex').slice(0, 12);
  const uid = nanoid(6);
  return { relKey: path.join(yyyy, mm, hash + '-' + uid + ext), filename: hash + '-' + uid + ext };
}

/** 保存单个 formidable 文件对象，返回统一文件元数据 */
async function saveFormFile(f) {
  const v = validateFile(f);
  const { relKey, filename } = buildRelKey(v.originalName, v.ext);
  return getDriver().save({
    tmpPath: v.tmpPath,
    relKey,
    size: v.size,
    mimetype: v.mimetype,
    originalName: v.originalName,
    filename
  });
}

/** 按 URL 或 key 删除文件（local/cos 自动分发） */
async function remove(urlOrKey) {
  if (!urlOrKey || typeof urlOrKey !== 'string') {
    throw new BusinessError('VALIDATION_ERROR', '缺少待删除文件 url');
  }
  return getDriver().remove(urlOrKey);
}

module.exports = {
  ALLOWED,
  MAX_SIZE,
  getDriverName,
  extOf,
  safeOriginalName,
  validateFile,
  saveFormFile,
  remove
};
