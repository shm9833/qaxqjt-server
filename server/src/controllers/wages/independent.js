/* wages/independent.js — 无交叉依赖的 handlers（自 wages.js 拆分） */
'use strict';

/**
 * src/controllers/wages.js —— 工资条管理 CRUD
 * 数据表：WageItemsV1 + WageBatchesV1 + WageRulesV1（prisma schema 已定义）
 *
 * 无底薪工资：baseWage = WageRulesV1.baseDailyStandard × attendanceDays
 * 4 项细分扣款编码到 otherDeduction + otherDeductionNote JSON：{"leave":50,"absent":100,"late":10,"early":0}
 *
 * GET    /v1/wages              列表（分页+keyword+month+batchId+performerId+staffNo）
 * GET    /v1/wages/:id          详情（含 batch 关联）
 * POST   /v1/wages              新建（自动计算 baseWage 如未显式传入）
 * PATCH  /v1/wages/:id          修改
 * DELETE /v1/wages/:id          删除
 * GET    /v1/wage-batches       批次列表
 * POST   /v1/wage-batches       新建批次
 * POST   /v1/wage-batches/:id/confirm  批次确认
 * POST   /v1/wage-batches/:id/post     批次过账（单事务生成支出台账分录 + 状态流转）
 * GET    /v1/wage-rules        规则列表
 * GET    /v1/wage-rules/:rankGrade  规则详情
 */
const { nanoid } = require('nanoid');
const prisma = require('../../utils/prisma');
const { success, created, noContent, parsePage, pagedSuccess } = require('../../utils/response');
const { idByCtx, nowMs } = require('../../config');
const { BusinessError } = require('../../middleware/error-handler');
const { audit } = require('../../services/audit-service');
const { toApi, _batchToApi, _ruleToApi } = require('./helpers');

const list = async ctx => {
  const { skip, take, page, pageSize } = parsePage(ctx.query);
  const where = {};
  if (ctx.query.batchId) where.batchId = ctx.query.batchId;
  if (ctx.query.performerId) where.performerId = ctx.query.performerId;
  if (ctx.query.staffNo) where.staffNo = ctx.query.staffNo;
  const kw = (ctx.query.keyword || '').trim();
  if (kw) where.performerName = { contains: kw };
  if (ctx.query.month) {
    const batches = await prisma.wageBatchesV1.findMany({
      where: { wageMonth: ctx.query.month },
      select: { id: true }
    });
    where.batchId = { in: batches.map(b => b.id) };
  }
  const [rows, total] = await Promise.all([
    prisma.wageItemsV1.findMany({
      where, skip, take,
      orderBy: { createdAt: 'desc' },
      include: { batch: true }
    }),
    prisma.wageItemsV1.count({ where })
  ]);
  return pagedSuccess(ctx, rows.map(r => toApi(r, r.batch)), total, page, pageSize);
};


const detail = async ctx => {
  const row = await prisma.wageItemsV1.findUnique({
    where: { id: ctx.params.id },
    include: { batch: true }
  });
  if (!row) throw new BusinessError('NOT_FOUND', '工资条不存在');
  return success(ctx, toApi(row, row.batch));
};


const batchList = async ctx => {
  const { skip, take, page, pageSize } = parsePage(ctx.query);
  const where = {};
  if (ctx.query.month) where.wageMonth = ctx.query.month;
  if (ctx.query.status) where.status = ctx.query.status;
  const [rows, total] = await Promise.all([
    prisma.wageBatchesV1.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.wageBatchesV1.count({ where })
  ]);
  return pagedSuccess(ctx, rows.map(_batchToApi), total, page, pageSize);
};


const rulesList = async ctx => {
  const { skip, take, page, pageSize } = parsePage(ctx.query);
  const where = {};
  if (ctx.query.status) where.status = ctx.query.status;
  const [rows, total] = await Promise.all([
    prisma.wageRulesV1.findMany({ where, skip, take, orderBy: { rankGrade: 'asc' } }),
    prisma.wageRulesV1.count({ where })
  ]);
  return pagedSuccess(ctx, rows.map(_ruleToApi), total, page, pageSize);
};


const rulesDetail = async ctx => {
  const row = await prisma.wageRulesV1.findUnique({ where: { rankGrade: ctx.params.rankGrade } });
  if (!row) throw new BusinessError('NOT_FOUND', '工资规则不存在');
  return success(ctx, _ruleToApi(row));
};


module.exports = {
  list,
  detail,
  batchList,
  rulesList,
  rulesDetail,
};
