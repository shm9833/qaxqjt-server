'use strict';
/**
 * prisma/cleanup-demo-execute.js —— 真正执行 DELETE：清除演示用 PlayCategory seed
 *
 * 安全规则：
 *   - 仅删 pcat_seed_* 前缀（系统初始化 seed），不删任何手动录入的分类
 *   - PROTECTED_CATEGORIES 白名单内的系统必需分类永不删除（这些是 operas 页分类 tab 的字典，删了会导致分类管理弹窗为空）
 *   - 删除前打印白名单跳过项 + 关联剧目警告
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 系统必需的默认剧目分类（与 seed-play-categories.js 的 defaults 保持一致）
// 这些是 operas 页面分类 tab 的字典数据，删除会导致分类管理弹窗与 tab 消失
const PROTECTED_CATEGORIES = ['传统本戏', '经典折子戏', '红色现代戏', '新编历史剧'];

async function main() {
  // 先 SELECT 确认范围
  const allSeed = await prisma.playCategory.findMany({
    where: { OR: [{ id: { startsWith: 'pcat_seed_' } }, { note: '系统初始化' }] }
  });

  // 拆分：受保护的系统必需分类 vs 可删的演示分类
  const protectedRows = allSeed.filter(c => PROTECTED_CATEGORIES.indexOf(c.name) >= 0);
  const targets = allSeed.filter(c => PROTECTED_CATEGORIES.indexOf(c.name) < 0);

  console.log('[cleanup] seed 分类总计: ' + allSeed.length + ' 行');
  if (protectedRows.length) {
    console.log('[cleanup] 🛡️  白名单跳过（系统必需，不删除）: ' + protectedRows.length + ' 行');
    protectedRows.forEach(c => console.log('    KEEP ' + c.id + ' | ' + c.name + ' | sortOrder=' + c.sortOrder));
  }
  console.log('[cleanup] 待删除 PlayCategory: ' + targets.length + ' 行');
  targets.forEach(c => console.log('    DEL  ' + c.id + ' | ' + c.name));

  if (!targets.length) {
    console.log('[cleanup] 无可删数据（剩余 seed 均在白名单内），退出');
    return;
  }

  // 检查是否有关联的 Play（genre 引用）
  const usedGenres = await prisma.play.findMany({
    where: { genre: { in: targets.map(c => c.name) } },
    select: { id: true, title: true, genre: true }
  });
  if (usedGenres.length) {
    console.log('[cleanup] ⚠️ 警告：以下剧目 genre 引用了待删分类，删后剧目 genre 字段不变但分类 tab 会消失:');
    usedGenres.forEach(p => console.log('    - ' + p.id + ' | ' + p.title + ' | genre=' + p.genre));
  }

  // 执行删除
  const del = await prisma.playCategory.deleteMany({
    where: { id: { in: targets.map(c => c.id) } }
  });
  console.log('[cleanup] 已删除 ' + del.count + ' 行 PlayCategory（白名单 ' + protectedRows.length + ' 行已保留）');

  const remain = await prisma.playCategory.count();
  console.log('[cleanup] PlayCategory 剩余: ' + remain + ' 行');
}

main()
  .catch(e => { console.error('[cleanup] FAILED:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
