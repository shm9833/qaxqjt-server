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

test('字符以 path 矢量轮廓渲染（无 text 元素，防程序化提取）', () => {
  const { svg } = generate();
  // 安全强化后不再使用 <text>（2026 captcha 加固）：字符 = 4 条描边 path + 3 条干扰曲线
  assert.strictEqual((svg.match(/<text[\s>]/g) || []).length, 0);
  assert.ok((svg.match(/<path /g) || []).length >= 7, 'char paths(4) + noise curves(3) >= 7');
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
    // 加固实现：字符为 path 轮廓，完整答案与单字符 text 内容均不得出现
    assert.ok(!svg.includes(answer), 'answer must not appear verbatim in svg');
    assert.ok(!svg.includes('<text'), 'no <text> element allowed');
    for (const ch of answer) {
      assert.ok(!svg.includes('>' + ch + '<'), 'char ' + ch + ' must not be text content');
    }
  }
});
