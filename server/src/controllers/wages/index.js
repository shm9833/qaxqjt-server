/* wages/index.js — 聚合导出（保持原有接口） */
const helpers = require('./helpers');
const independent = require('./independent');
const core = require('./core');

module.exports = {
  list: independent.list,
  detail: independent.detail,
  create: core.create,
  update: core.update,
  review: core.review,
  remove: core.remove,
  generate: core.generate,
  batchList: independent.batchList,
  batchCreate: core.batchCreate,
  batchConfirm: core.batchConfirm,
  batchPost: core.batchPost,
  batchUnpost: core.batchUnpost,
  rulesList: independent.rulesList,
  rulesDetail: independent.rulesDetail,
  toApi: helpers.toApi,
  computeAttendancePenalty: helpers.computeAttendancePenalty,
  _calcWageItem: helpers._calcWageItem,
  _punchLateStatsByStaff: helpers._punchLateStatsByStaff,
  _travelExpenseByStaffMonth: helpers._travelExpenseByStaffMonth,
  _parseBatchPeriod: helpers._parseBatchPeriod,
  WAGE_DEDUCT_RULES: helpers.WAGE_DEDUCT_RULES,
};
