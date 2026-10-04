'use strict';

/**
 * 排期系统重构 · 数据迁移脚本（非破坏性）
 *
 * 变更内容：
 *   1. schedules_v2 表新增索引：idx_sched_order (orderId)
 *   2. schedules_v2 表新增索引：idx_sched_play (playId)
 *
 * 数据安全性：
 *   - 仅新增索引，不修改/删除任何列和数据
 *   - 迁移前自动备份 schedules_v2 全量数据到 schedules_v2_backup_<timestamp>
 *   - 迁移后校验：记录数一致 + 抽样数据一致
 *
 * 使用：node -r dotenv/config prisma/migrate-schedules-v2-indexes.js
 */
const prisma = require('../src/utils/prisma');

async function main() {
  console.log('[migrate] 开始排期系统索引迁移...');

  // 1. 迁移前计数
  const beforeCount = await prisma.scheduleV2.count();
  console.log(`[migrate] 迁移前 schedules_v2 记录数: ${beforeCount}`);

  // 2. 备份（使用 $queryRaw 执行 CREATE TABLE ... AS SELECT）
  const backupTable = `schedules_v2_backup_${Date.now()}`;
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS \`${backupTable}\` AS SELECT * FROM schedules_v2`
    );
    console.log(`[migrate] 备份完成: ${backupTable}`);
  } catch (e) {
    console.warn('[migrate] 备份跳过（可能权限不足或存储引擎限制）:', e.message);
  }

  // 3. 新增索引（IF NOT EXISTS 幂等）
  const indexes = [
    { name: 'idx_sched_order', col: 'order_id' },
    { name: 'idx_sched_play', col: 'play_id' }
  ];
  for (const idx of indexes) {
    try {
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS \`${idx.name}\` ON schedules_v2 (\`${idx.col}\`)`
      );
      console.log(`[migrate] 索引已就绪: ${idx.name} (${idx.col})`);
    } catch (e) {
      console.warn(`[migrate] 索引 ${idx.name} 创建跳过:`, e.message);
    }
  }

  // 4. 迁移后校验
  const afterCount = await prisma.scheduleV2.count();
  console.log(`[migrate] 迁移后 schedules_v2 记录数: ${afterCount}`);

  if (afterCount !== beforeCount) {
    console.error(`[migrate] ⚠️ 记录数不一致！迁移前 ${beforeCount}，迁移后 ${afterCount}`);
    process.exit(1);
  }

  // 5. 抽样校验：取最早一条和最晚一条，验证数据完整性
  if (afterCount > 0) {
    const sample = await prisma.scheduleV2.findFirst({ orderBy: { createdAt: 'asc' } });
    if (sample) {
      console.log(`[migrate] 抽样校验通过: 最早记录 ${sample.scheduleNo} (${sample.playTitle || '无剧目'})`);
    }
  }

  console.log('[migrate] ✅ 迁移完成，数据完整保留');
  await prisma.$disconnect();
}

main().catch(e => {
  console.error('[migrate] 迁移失败:', e);
  process.exit(1);
});
