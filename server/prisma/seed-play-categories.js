'use strict';

/**
 * prisma/seed-play-categories.js —— 剧目分类初始数据（v20260909b，20260919 移植到 Vercel/Neon 渠道）
 * 在 server 目录下执行：node -r dotenv/config prisma/seed-play-categories.js
 * 幂等：已存在的同名分类跳过；同时把库中已有剧目用到的 genre 补建为分类。
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const defaults = ['传统本戏', '经典折子戏', '红色现代戏', '新编历史剧'];
  const genres = await prisma.play.findMany({ select: { genre: true }, distinct: ['genre'] });
  genres.forEach(g => {
    if (g.genre && defaults.indexOf(g.genre) < 0) defaults.push(g.genre);
  });

  let order = 0;
  for (const name of defaults) {
    order += 1;
    const ex = await prisma.playCategory.findUnique({ where: { name } });
    if (ex) {
      order = Math.max(order, ex.sortOrder);
      console.log('exists :', name, '(sortOrder=' + ex.sortOrder + ')');
      continue;
    }
    await prisma.playCategory.create({
      data: {
        id: 'pcat_seed_' + Date.now().toString(36) + '_' + order,
        name,
        sortOrder: order,
        status: 'active',
        note: '系统初始化',
        ts: BigInt(Date.now())
      }
    });
    console.log('seeded :', name, '(sortOrder=' + order + ')');
  }
  const total = await prisma.playCategory.count();
  console.log('play_categories total =', total);
  await prisma.$disconnect();
})().catch(err => { console.error(err); process.exit(1); });
