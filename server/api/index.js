'use strict';

/**
 * api/index.js —— Vercel Serverless 入口
 * 复用 src/app.js（Koa 实例，不监听端口），交给 Vercel Node Runtime 托管
 */
const app = require('../src/app');

module.exports = app.callback();
