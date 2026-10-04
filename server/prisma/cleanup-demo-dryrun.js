'use strict';
/**
 * prisma/cleanup-demo-dryrun.js —— 只读 SELECT，列出生产 DB 演示数据规模
 * 不执行任何 DELETE。让用户审核后再跑 cleanup-demo-execute.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== 演示数据 dry-run 统计 ===\n');

  // 1. 工资条演示数据（seed-wages.js）
  const wages = await prisma.wageItemsV1.findMany({
    where: { id: { startsWith: 'witem_202608_' } },
    select: { id: true, performerName: true, staffNo: true, rankGrade: true, netPay: true }
  });
  console.log('[1] WageItemsV1 (演示): ' + wages.length + ' 条');
  wages.slice(0, 8).forEach(w => console.log('    ' + w.id + ' | ' + w.performerName + ' | ' + w.rankGrade + ' | net=' + w.netPay));

  const wb = await prisma.wageBatchesV1.findMany({
    where: { OR: [{ id: 'wbatch_202608_demo' }, { batchNo: 'WB-202608-001' }] }
  });
  console.log('    WageBatchesV1 (演示): ' + wb.length + ' 条 (' + wb.map(b => b.batchNo).join(',') + ')\n');

  // 2. 剧目分类 seed
  // 系统必需的默认分类（operas 页分类 tab 字典），cleanup 时受白名单保护不删除
  const PROTECTED_CATEGORIES = ['传统本戏', '经典折子戏', '红色现代戏', '新编历史剧'];
  const cats = await prisma.playCategory.findMany({
    where: { OR: [{ id: { startsWith: 'pcat_seed_' } }, { note: '系统初始化' }] }
  });
  console.log('[2] PlayCategory (seed): ' + cats.length + ' 条');
  cats.forEach(c => {
    const tag = PROTECTED_CATEGORIES.indexOf(c.name) >= 0 ? '🛡️PROTECTED' : '可删';
    console.log('    [' + tag + '] ' + c.id + ' | ' + c.name + ' | sortOrder=' + c.sortOrder);
  });
  const allCats = await prisma.playCategory.count();
  console.log('    PlayCategory 全表总数: ' + allCats + '\n');

  // 3. 演职人员演示数据
  const performers = await prisma.performersDbV1.findMany({
    select: { id: true, staffNo: true, name: true, rankGrade: true, status: true },
    take: 50,
    orderBy: { staffNo: 'asc' }
  });
  const perfTotal = await prisma.performersDbV1.count();
  console.log('[3] PerformersDbV1: ' + perfTotal + ' 行（显示前 ' + Math.min(performers.length, 50) + ' 行）');
  performers.slice(0, 12).forEach(p => console.log('    ' + (p.staffNo || '(无工号)') + ' | ' + p.name + ' | ' + (p.rankGrade || '-') + ' | ' + p.status));

  // 4. 其他演示数据（plays/appointments/orders 等）
  const plays = await prisma.play.count();
  const appts = await prisma.appointment.count().catch(() => -1);
  const accts = await prisma.accountsV2.count();
  const nonAdminAccts = await prisma.accountsV2.count({ where: { id: { not: 'acc_superadmin_001' } } });
  console.log('\n[4] 其他表统计:');
  console.log('    Play: ' + plays + ' 行');
  console.log('    Appointment: ' + appts + ' 行');
  console.log('    AccountsV2: ' + accts + ' 行（含 1 个 super admin，' + nonAdminAccts + ' 个非 admin）');

  console.log('\n=== dry-run 结束 ===');
}

main()
  .catch(e => { console.error('dry-run FAILED:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
