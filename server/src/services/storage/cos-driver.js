'use strict';

/**
 * src/services/storage/cos-driver.js —— 腾讯云 COS 对象存储驱动
 *
 * 启用方式（.env）：
 *   STORAGE_DRIVER=cos
 *   COS_SECRET_ID=xxx
 *   COS_SECRET_KEY=xxx
 *   COS_BUCKET=xxx-1250000000          （BucketName-APPID）
 *   COS_REGION=ap-guangzhou
 *   COS_KEY_PREFIX=uploads             （可选，对象 key 前缀，默认 uploads）
 *   COS_CDN_DOMAIN=https://cdn.xxx.com （可选，配置后返回的 url 走 CDN/自定义域名）
 *
 * 依赖：cos-nodejs-sdk-v5（仅在 STORAGE_DRIVER=cos 首次上传时懒加载，
 *       未安装会抛 CONFIG_ERROR，local 模式完全不需要该依赖）
 *
 * save 入参同 local-driver；remove 接受完整 URL 或对象 key。
 */
const fs = require('fs');
const path = require('path');
const { BusinessError } = require('../../middleware/error-handler');

function _config() {
  const c = {
    secretId: process.env.COS_SECRET_ID,
    secretKey: process.env.COS_SECRET_KEY,
    bucket: process.env.COS_BUCKET,
    region: process.env.COS_REGION,
    keyPrefix: (process.env.COS_KEY_PREFIX || 'uploads').replace(/^\/+|\/+$/g, ''),
    cdnDomain: (process.env.COS_CDN_DOMAIN || '').replace(/\/+$/, '')
  };
  const missing = ['secretId', 'secretKey', 'bucket', 'region'].filter(k => !c[k]);
  if (missing.length) {
    const envNames = { secretId: 'COS_SECRET_ID', secretKey: 'COS_SECRET_KEY', bucket: 'COS_BUCKET', region: 'COS_REGION' };
    throw new BusinessError('CONFIG_ERROR', 'COS 配置缺失：' + missing.map(k => envNames[k]).join(' / '));
  }
  return c;
}

let _client = null;
function _getClient() {
  if (_client) return _client;
  let COS;
  try {
    // 懒加载：local 模式不要求安装该包
    // eslint-disable-next-line global-require
    COS = require('cos-nodejs-sdk-v5');
  } catch (e) {
    throw new BusinessError('CONFIG_ERROR', '未安装 cos-nodejs-sdk-v5，请在服务端执行 npm i cos-nodejs-sdk-v5，或将 STORAGE_DRIVER 设为 local');
  }
  const c = _config();
  _client = new COS({ SecretId: c.secretId, SecretKey: c.secretKey });
  return _client;
}

function _promisify(client, method, params) {
  return new Promise((resolve, reject) => {
    client[method](params, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

const cosDriver = {
  name: 'cos',

  async save({ tmpPath, relKey, size, mimetype, originalName, filename }) {
    const cfg = _config();
    const client = _getClient();
    const key = (cfg.keyPrefix ? cfg.keyPrefix + '/' : '') + relKey.split(path.sep).join('/');

    await _promisify(client, 'putObject', {
      Bucket: cfg.bucket,
      Region: cfg.region,
      Key: key,
      Body: fs.createReadStream(tmpPath),
      ContentLength: size,
      ContentType: mimetype
    });
    // 清理临时文件
    try { fs.unlinkSync(tmpPath); } catch (_) { /* noop */ }

    const base = cfg.cdnDomain || ('https://' + cfg.bucket + '.cos.' + cfg.region + '.myqcloud.com');
    return {
      driver: 'cos',
      key,
      url: base + '/' + key,
      filename,
      size,
      mimeType: mimetype,
      originalName
    };
  },

  async remove(urlOrKey) {
    const cfg = _config();
    const client = _getClient();
    let key = String(urlOrKey || '');

    // 完整 URL → 取 pathname 并剥掉前缀
    try {
      const u = new URL(urlOrKey);
      key = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    } catch (_) { /* 已是 key */ }
    // 剥掉 COS_KEY_PREFIX 之外的 host 前缀（若传的是 myqcloud URL，pathname 已含 prefix）
    if (cfg.keyPrefix && key === cfg.keyPrefix) {
      throw new BusinessError('VALIDATION_ERROR', '不能删除整个前缀目录');
    }

    const res = await _promisify(client, 'deleteObject', {
      Bucket: cfg.bucket,
      Region: cfg.region,
      Key: key
    });
    return { driver: 'cos', deleted: true, key, raw: res && res.statusCode };
  }
};

module.exports = cosDriver;
