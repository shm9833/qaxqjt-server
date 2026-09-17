// 检查 dev.db 表结构与数据量（验证 db push 是否作用于正确文件）
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  console.log('accounts:', await p.accountsV2.count());
  console.log('orders:', await p.order.count());
  console.log('invItems:', await p.inventoryItem.count());
  console.log('ledger:', await p.finLedgerV1.count());
  // 验证新字段存在：查询应不抛错
  const one = await p.inventoryItem.findFirst();
  console.log('invItem sample fields ok, sample:', one ? one.name : '(empty table)');
  const agg = await p.order.aggregate({ _sum: { finalAmount: true } });
  console.log('order sum ok:', Number(agg._sum.finalAmount || 0));
})()
  .catch(e => { console.error('ERR:', e.message); process.exit(1); })
  .finally(() => p.$disconnect());
