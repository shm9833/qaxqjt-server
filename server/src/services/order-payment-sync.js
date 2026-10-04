'use strict';

/**
 * src/services/order-payment-sync.js
 * 订单收款 → 收付款流水（fin_payments_v1）+ 财务台账收入凭证（fin_ledger_v1）自动联动
 *
 * 触发点：orders 控制器 create / update（paidAmount 落库后）
 * 模型（增量对账，天然幂等）：
 *   target = 订单累计已收 paidAmount
 *   net    = Σ(payType='in') - Σ(payType='out') 该订单已有收付款流水净额
 *   diff   = target - net
 *   diff > 0  → 补一笔收款流水(in) + 一张台账收入凭证(receipt/draft)，同一事务原子提交
 *   diff = 0  → 零操作（重复 PATCH / 回填重跑均安全）
 *   diff < 0  → 仅告警不自动冲销（已生成的财务凭证须由财务侧人工红冲/退款，禁止自动删改）
 *
 * 硬约束：
 *  - 台账凭证 status 一律落 'draft'，复核只能走 finance 专用接口
 *  - 失败隔离：调用方须 try/catch，联动失败不得回滚/阻断订单主流程
 */
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { idByCtx, nowMs } = require('../config');

const EPS = 0.001;
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const _stamp = () => {
  // v20261003 P3-10：固定按东八区，不依赖服务器时区
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes())
  );
};

/**
 * 按订单已收金额对账，缺多少补多少（只补差，不冲销）。
 * @param {object} order 订单行（至少含 id/orderNo/customerName/paidAmount）
 * @param {object} [opts]
 * @param {string} [opts.actor] 操作人账号 id（制单人/创建人）
 * @returns {Promise<{synced:number, target:number, net:number, diff:number, payment?:object, ledger?:object}>}
 */
const syncOrderPayments = async (order, opts = {}) => {
  if (!order || !order.id) return { synced: 0, target: 0, net: 0, diff: 0 };
  const actor = opts.actor || 'system';

  const target = round2(Math.max(0, Number(order.paidAmount) || 0));
  const pays = await prisma.finPaymentV1.findMany({ where: { orderId: order.id } });
  let net = 0;
  for (const p of pays) {
    net += (p.payType === 'out' ? -1 : 1) * (Number(p.amount) || 0);
  }
  net = round2(net);
  const diff = round2(target - net);

  if (Math.abs(diff) <= EPS) return { synced: 0, target, net, diff: 0 };
  if (diff < 0) {
    // paidAmount 被调减且小于已入账流水净额：不自动冲销历史凭证
    console.warn(
      '[order-payment-sync] order %s paidAmount(%s) < payment net(%s)，历史收款凭证保留，需财务人工红冲',
      order.orderNo || order.id,
      target,
      net
    );
    return { synced: 0, target, net, diff };
  }

  const now = new Date();
  const stamp = _stamp();
  const payNo = 'PAY' + stamp + nanoid(6).toUpperCase().replace(/[^0-9A-Z]/g, '0');
  const voucherNo = 'LSR' + stamp + nanoid(4).toUpperCase().replace(/[^0-9A-Z]/g, '0');
  const customerName = order.customerName || '';
  const summary = '订单收款（' + order.orderNo + '）' + (customerName ? ' - ' + customerName : '');

  // 流水与凭证同事务原子提交，杜绝半成品（有流水无凭证 / 有凭证无流水）
  const { payment, ledger } = await prisma.$transaction(async tx => {
    const payment = await tx.finPaymentV1.create({
      data: {
        id: idByCtx('pay', 12, nanoid),
        orderId: order.id,
        payNo,
        payDate: now,
        payChannel: 'transfer', // 订单 PATCH 无单笔渠道信息，默认转账，可在财务侧订正
        payType: 'in',
        amount: diff,
        currency: 'CNY',
        payerName: customerName || null,
        voucherNo,
        status: 'confirmed',
        remark: '订单收款自动联动（' + order.orderNo + '）',
        createdBy: actor,
        ts: BigInt(nowMs())
      }
    });
    const ledger = await tx.finLedgerV1.create({
      data: {
        id: idByCtx('ledger', 12, nanoid),
        voucherNo,
        voucherDate: now,
        voucherType: 'receipt',
        voucherCategory: '演出收入',
        summary,
        orderId: order.id,
        relatedBatchId: null,
        debitAmount: 0,
        creditAmount: diff,
        balanceAmount: 0,
        offsetAccount: null,
        cashFlowType: 'in',
        cashFlowAmount: diff,
        status: 'draft', // M-15：自动凭证同样落草稿，复核走财务专用接口
        makerAccountId: actor === 'system' ? null : actor,
        madeAt: now,
        doubleCheckRequired: diff >= 10000,
        isReconciled: false,
        remark: '由订单收款自动生成，收款流水号 ' + payNo,
        createdBy: actor,
        ts: BigInt(nowMs())
      }
    });
    return { payment, ledger };
  });

  return { synced: 1, target, net, diff, payment, ledger };
};

module.exports = { syncOrderPayments };
