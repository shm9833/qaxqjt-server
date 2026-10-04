'use strict';

/**
 * prisma/backfill-order-payment-ledger.js
 * 历史订单收款 → 财务台账收入凭证 回填（幂等，可重复执行）
 *
 * 用法（在 C:\qaxqjt-server 下）：
 *   预览：node -r dotenv/config prisma/backfill-order-payment-ledger.js --dry-run
 *   执行：node -r dotenv/config prisma/backfill-order-payment-ledger.js
 *
 * 幂等性：syncOrderPayments 以订单已有收付款流水净额为基准补差，
 *         已回填过的订单 diff=0 零操作；重复执行安全。
 */
const prisma = require('../src/utils/prisma');
const { syncOrderPayments } = require('../src/services/order-payment-sync');

const dryRun = process.argv.includes('--dry-run');

(async () => {
  console.log('=== 订单收款→财务凭证回填 ' + (dryRun ? '[DRY-RUN]' : '[EXECUTE]') + ' ===');

  // 只处理有已收金额的订单，分页拉取（pageSize 500 为后端上限）
  const take = 500;
  let skip = 0;
  const orders = [];
  for (;;) {
    const batch = await prisma.order.findMany({
      where: { paidAmount: { gt: 0 } },
      orderBy: { orderDate: 'asc' },
      skip,
      take
    });
    orders.push(...batch);
    if (batch.length < take) break;
    skip += take;
  }
  console.log('paidAmount>0 的订单数：' + orders.length);

  let created = 0;
  let skipped = 0;
  let totalAmount = 0;
  const details = [];

  for (const o of orders) {
    const target = Number(o.paidAmount || 0);
    if (dryRun) {
      // dry-run：本地按同一口径计算净额，仅预览
      const pays = await prisma.finPaymentV1.findMany({ where: { orderId: o.id } });
      let net = 0;
      for (const p of pays) net += (p.payType === 'out' ? -1 : 1) * (Number(p.amount) || 0);
      const diff = Math.round((target - net + Number.EPSILON) * 100) / 100;
      if (diff > 0.001) {
        created++;
        totalAmount += diff;
        details.push({ orderNo: o.orderNo, customer: o.customerName, target, net: Math.round(net * 100) / 100, willAdd: diff });
      } else {
        skipped++;
      }
    } else {
      const r = await syncOrderPayments(o, { actor: 'backfill' });
      if (r.synced === 1) {
        created++;
        totalAmount += r.diff;
        details.push({
          orderNo: o.orderNo,
          customer: o.customerName,
          add: r.diff,
          payNo: r.payment.payNo,
          voucherNo: r.ledger.voucherNo
        });
        console.log('  [OK] ' + o.orderNo + ' +' + r.diff + ' 凭证 ' + r.ledger.voucherNo);
      } else {
        skipped++;
      }
    }
  }

  console.log('--- 结果 ---');
  console.log('将补/已补凭证订单：' + created + '，跳过（已平账）：' + skipped + '，合计金额：' + totalAmount.toFixed(2));
  if (dryRun && details.length) {
    console.log('明细预览：');
    for (const d of details) console.log('  ' + JSON.stringify(d));
  }
  console.log(dryRun ? 'DRY-RUN 完成（未写入）。确认无误后去掉 --dry-run 正式执行。' : '回填完成。');
})()
  .catch(e => {
    console.error('回填失败：', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch (_) {}
  });
