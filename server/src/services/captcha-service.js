'use strict';

/**
 * src/services/captcha-service.js —— 图形验证码 challenge 生命周期
 *   issue(ip)   → { id, svg }  答案 sha256 入库，2 分钟过期，一次性
 *   verify(id, input) → boolean  校验成功后置 consumedAt（一次性）
 *   cleanupExpired()  → 删过期行，启动 + 懒清理调用
 */
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const prisma = require('../utils/prisma');
const { generate } = require('./captcha-svg');

const TTL_MS = 2 * 60 * 1000; // 2 分钟

const sha256 = s => crypto.createHash('sha256').update(String(s || '')).digest('hex');

async function issue(ip) {
  const { svg, answer } = generate();
  const now = new Date();
  const row = await prisma.captchaChallenge.create({
    data: {
      id: nanoid(16),
      answerHash: sha256(answer),
      ipAddress: ip || null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + TTL_MS),
      ts: BigInt(Date.now())
    },
    select: { id: true }
  });
  return { id: row.id, svg };
}

/**
 * 校验验证码。
 * 返回 { ok: true } 或 { ok: false, code }。
 * code: 'MISSING' | 'NOT_FOUND' | 'EXPIRED' | 'CONSUMED' | 'WRONG'
 * 校验通过或失败都把 challenge 标记为 consumed（一次性，防重放）。
 */
async function verify(id, input) {
  if (!id || !input) return { ok: false, code: 'MISSING' };
  const row = await prisma.captchaChallenge.findUnique({ where: { id } });
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (row.consumedAt) return { ok: false, code: 'CONSUMED' };
  if (row.expiresAt < new Date()) {
    await prisma.captchaChallenge.update({ where: { id }, data: { consumedAt: new Date() } });
    return { ok: false, code: 'EXPIRED' };
  }
  const expected = row.answerHash;
  const got = sha256(String(input).toUpperCase());
  // 无论对错，标记已消费（防暴力枚举同一 challenge）
  await prisma.captchaChallenge.update({ where: { id }, data: { consumedAt: new Date() } });
  if (got !== expected) return { ok: false, code: 'WRONG' };
  return { ok: true };
}

async function cleanupExpired() {
  const r = await prisma.captchaChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return r.count;
}

module.exports = { issue, verify, cleanupExpired, TTL_MS };
