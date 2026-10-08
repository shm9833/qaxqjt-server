/* performers/index.js — 聚合导出（保持原有接口） */
const independent = require('./independent');
const core = require('./core');

module.exports = {
  list: independent.list,
  create: core.create,
  detail: independent.detail,
  update: independent.update,
  remove: core.remove,
  stats: independent.stats,
  selfRegister: core.selfRegister,
  selfRegisterQrInfo: core.selfRegisterQrInfo,
  selfRegisterStatus: core.selfRegisterStatus,
  review: core.review,
};
