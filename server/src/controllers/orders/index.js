/* orders/index.js — 聚合导出（保持原有接口） */
const helpers = require('./helpers');
const independent = require('./independent');
const core = require('./core');

module.exports = {
  list: independent.list,
  stats: independent.stats,
  create: core.create,
  detail: independent.detail,
  update: core.update,
  remove: core.remove,
  transition: core.transition,
  registerPayment: core.registerPayment,
  STATUS_FLOW: helpers.STATUS_FLOW,
};
