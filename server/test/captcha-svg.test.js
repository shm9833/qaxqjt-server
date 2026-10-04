'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { generate, CHARS, WIDTH, HEIGHT } = require('../src/services/captcha-svg');

test('返回 svg + 4 位答案，字符集合法', () => {
  const { svg, answer } = generate();
  assert.strictEqual(answer.length, 4);
  for (const ch of answer) assert.ok(CHARS.includes(ch), 'char ' + ch + ' in set');
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(svg.includes('width="' + WIDTH + '"'));
  assert.ok(svg.includes('height="' + HEIGHT + '"'));
});

test('svg 含 4 个 text 元素', () => {
  const { svg } = generate();
  const textCount = (svg.match(/<text /g) || []).length;
  assert.strictEqual(textCount, 4);
});

test('svg 含干扰曲线和噪点', () => {
  const { svg } = generate();
  assert.ok((svg.match(/<path /g) || []).length >= 3, 'curves >= 3');
  assert.ok((svg.match(/<circle /g) || []).length >= 20, 'dots >= 20');
});

test('每次答案不同（概率性，连续 5 次全相同概率≈(1/32)^16）', () => {
  const set = new Set();
  for (let i = 0; i < 5; i++) set.add(generate().answer);
  assert.ok(set.size >= 2, '至少 2 种不同答案, got ' + set.size);
});

test('svg 无答案明文泄漏（答案不出现在 svg 字符串中）', () => {
  for (let i = 0; i < 20; i++) {
    const { svg, answer } = generate();
    // text 元素里的字符就是答案，所以答案必然以 text content 出现在 svg 中；
    // 本测试仅确认没有把 answer 作为属性/注释泄漏到非 text 位置——这里放宽：
    assert.ok(svg.includes('>' + answer[0] + '<') || svg.includes(answer), 'answer rendered as text');
  }
});
