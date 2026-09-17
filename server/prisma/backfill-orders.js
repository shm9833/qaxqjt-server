'use strict';

/**
 * prisma/backfill-orders.js —— 历史预约回填订单
 *
 * 背景：早期公开预约只写 Appointment 表，未生成 Order，导致后台 /v1/orders 列表看不到。
 *      appointments.js create() 已修复（公开提交会同步落 Order）。
 *      本脚本把已存在但缺 Order 的历史 Appointment 补一条 Order(draft) 并回链。
 *
 * 幂等：每条 Appointment 仅生成一条 Order（通过 convertedOrderId 与 Order.appointmentId 双向校验）。
 *
 * 用法：
 *   cd <server 根目录>
 *   node -r dotenv/config prisma/backfill-orders.js            # 实跑
 *   node -r dotenv/config prisma/backfill-orders.js --dry-run   # 仅统计不写
 */
const { PrismaClient } = require('@prisma/client');
const { nanoid } = require('nanoid');

const prisma = new PrismaClient();
const isDryRun = process.argv.includes('--dry-run');

const idPrefixes = {
  customer: 'cus',
  order: 'ord',
  orderItem: 'oit'
};
const idByCtx = (prefix, size = 12) => {
  const p = idPrefixes[prefix] || prefix;
  const tail = nanoid(size).replace(/-|_/g, '');
  return `${p}_${tail}`;
};
const nowMs = () => Date.now();

const _genOrderNo = () => {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    'ORD' +
    String(d.getFullYear()).slice(2) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    nanoid(4).toUpperCase()
  );
};

async function main() {
  // 1. 找出所有未转单的预约（convertedOrderId 为空，且 Order 表里也没有对应 appointmentId）
  const allAppts = await prisma.appointment.findMany({
    orderBy: { createdAt: 'asc' },
    include: { plays: true, customer: true }
  });
  console.log(`[backfill] 历史预约总数：${allAppts.length}`);

  // 已有 Order 的 appointmentId 集合（避免对已转单的重复生成）
  const existingOrderApptIds = new Set(
    (await prisma.order.findMany({
      where: { appointmentId: { not: null } },
      select: { appointmentId: true }
    })).map(o => o.appointmentId)
  );

  const todo = allAppts.filter(a =>
    !a.convertedOrderId && !existingOrderApptIds.has(a.id)
  );
  console.log(`[backfill] 待回填：${todo.length} 条${isDryRun ? '（dry-run，不写库）' : ''}`);

  if (isDryRun) {
    todo.forEach(a => {
      console.log(`  · ${a.appointmentNo} | ${a.customerName} | ${a.phone} | 演出 ${a.performanceCount} 场 | ${a.preferredStartDate && a.preferredStartDate.toISOString()}`);
    });
    return;
  }

  let ok = 0, fail = 0;
  for (const a of todo) {
    try {
      const orderId = idByCtx('order');
      const orderNo = _genOrderNo();
      const venueFull = [a.venueProvince, a.venueCity, a.venueDistrict, a.venueAddress]
        .filter(Boolean).join('');
      const amount = a.totalPerformanceFee != null
        ? Number(a.totalPerformanceFee)
        : (a.estimatedBudget != null ? Number(a.estimatedBudget) : 0);

      // 客户缺失则跳过（数据异常）
      if (!a.customerId) {
        console.warn(`  ! ${a.appointmentNo} 缺 customerId，跳过`);
        fail++;
        continue;
      }

      await prisma.order.create({
        data: {
          id: orderId,
          orderNo: orderNo,
          orderType: 'performance',
          status: 'draft',
          customerId: a.customerId,
          customerName: a.customerName,
          organization: a.organization || (a.customer && a.customer.organization) || null,
          phone: a.phone,
          appointmentId: a.id,
          orderDate: new Date(a.createdAt || Date.now()),
          totalAmount: amount,
          finalAmount: amount,
          depositAmount: a.depositAmount != null ? Number(a.depositAmount) : 0,
          performanceStartDate: a.preferredStartDate ? new Date(a.preferredStartDate) : null,
          performanceEndDate: a.preferredEndDate ? new Date(a.preferredEndDate) : null,
          performanceCount: Number(a.performanceCount) || null,
          venueFullAddress: venueFull || null,
          specialRequirements: a.specialRequirements || null,
          internalRemark: a.remarkInternal || null,
          createdBy: 'backfill_orders',
          ts: BigInt(nowMs())
        }
      });

      // 同步剧目 → 订单明细
      if (a.plays && a.plays.length) {
        await prisma.orderItem.createMany({
          data: a.plays.map(p => ({
            id: idByCtx('orderItem'),
            orderId,
            itemType: 'performance',
            playId: p.playId ? String(p.playId) : null,
            itemName: '演出服务',
            quantity: Number(p.sortOrder) || 1,
            unitPrice: 0,
            subtotal: 0,
            performanceDate: p.performanceDate ? new Date(p.performanceDate) : null,
            remark: p.note || null,
            ts: BigInt(nowMs())
          }))
        });
      }

      // 回链 appointment.convertedOrderId
      await prisma.appointment.update({
        where: { id: a.id },
        data: {
          convertedOrderId: orderId,
          conversionToOrderDate: new Date(),
          updatedAt: new Date(),
          ts: BigInt(nowMs())
        }
      });

      ok++;
      console.log(`  ✓ ${a.appointmentNo} → ${orderNo}`);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${a.appointmentNo} 失败：${e && e.message}`);
    }
  }

  console.log(`[backfill] 完成：成功 ${ok} 条，失败 ${fail} 条`);
}

main()
  .catch(e => { console.error('[backfill] 异常：', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
