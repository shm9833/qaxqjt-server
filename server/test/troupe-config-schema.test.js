'use strict';

/**
 * 单元测试：组团配置云端持久化的后端纯函数校验/归一化口径
 * 运行：node --test server/test/
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  GRADE_KEYS, CATS, DEFAULT_GRADES, LIMITS,
  validateGrades, normalizeGrades, sanitizeTemplates, checkJsonSize
} = require('../src/utils/troupe-config-schema');

function validGrades(over) {
  const g = {};
  GRADE_KEYS.forEach(k => { g[k] = { name: DEFAULT_GRADES[k].name, daily: DEFAULT_GRADES[k].daily }; });
  return Object.assign(g, over || {});
}

/* ============================== validateGrades（写入严格校验） ============================== */

test('validateGrades: 合法 7 档通过并回传规整值', () => {
  const r = validateGrades(validGrades());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(Object.keys(r.value).length, 7);
  assert.equal(r.value.W7.daily, 800);
});

test('validateGrades: 非对象 / 数组 / null 一律拒绝', () => {
  assert.equal(validateGrades(null).ok, false);
  assert.equal(validateGrades(undefined).ok, false);
  assert.equal(validateGrades('x').ok, false);
  assert.equal(validateGrades([]).ok, false);
  assert.equal(validateGrades(42).ok, false);
});

test('validateGrades: 缺档 / 名称空 / 日薪非法 均报错且 value 为 null', () => {
  const g1 = validGrades(); delete g1.W4;
  const r1 = validateGrades(g1);
  assert.equal(r1.ok, false);
  assert.match(r1.errors.join('|'), /W4/);
  assert.equal(r1.value, null);

  const g2 = validGrades(); g2.W2 = { name: '  ', daily: 100 };
  assert.equal(validateGrades(g2).ok, false);

  const g3 = validGrades(); g3.W3 = { name: 'C角', daily: -5 };
  assert.equal(validateGrades(g3).ok, false);

  const g4 = validGrades(); g4.W5 = { name: 'A角', daily: 'abc' };
  assert.equal(validateGrades(g4).ok, false);
});

test('validateGrades: 数字字符串可接受，越界日薪裁剪到上限', () => {
  const g = validGrades(); g.W1 = { name: '实习', daily: '90' };
  const r1 = validateGrades(g);
  assert.equal(r1.ok, true);
  assert.equal(r1.value.W1.daily, 90);

  const g2 = validGrades(); g2.W7 = { name: '主A角', daily: 99999999 };
  assert.equal(validateGrades(g2).value.W7.daily, LIMITS.dailyMax);
});

test('validateGrades: 名称超长裁剪到 40 字', () => {
  const g = validGrades(); g.W1 = { name: '甲'.repeat(60), daily: 10 };
  const r = validateGrades(g);
  assert.equal(r.ok, true);
  assert.equal(r.value.W1.name.length, 40);
});

/* ============================== normalizeGrades（读取兜底） ============================== */

test('normalizeGrades: 非对象返回 null', () => {
  assert.equal(normalizeGrades(null), null);
  assert.equal(normalizeGrades([]), null);
  assert.equal(normalizeGrades(123), null);
});

test('normalizeGrades: 缺档补默认、坏字段回默认，永远 7 档齐全', () => {
  const n = normalizeGrades({ W1: { name: '自定义', daily: 1 }, W3: null, W5: { name: '', daily: 'x' } });
  assert.equal(Object.keys(n).length, 7);
  assert.equal(n.W1.name, '自定义');
  assert.equal(n.W1.daily, 1);
  assert.equal(n.W3.name, DEFAULT_GRADES.W3.name);
  assert.equal(n.W5.daily, DEFAULT_GRADES.W5.daily);
});

/* ============================== sanitizeTemplates（模板库消毒） ============================== */

test('sanitizeTemplates: 非数组返回 null', () => {
  assert.equal(sanitizeTemplates(null), null);
  assert.equal(sanitizeTemplates({}), null);
  assert.equal(sanitizeTemplates('x'), null);
});

test('sanitizeTemplates: 空数组原样、非法条目丢弃、字段缺省补齐', () => {
  const out = sanitizeTemplates([null, 42, { name: '庙会', data: [{ cat: 'bad', grade: 'X9', name: '张三', role: '主演', daily: 300 }] }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, '庙会');
  assert.equal(out[0].days, 3);                 // 缺 days → 默认 3
  assert.equal(out[0].data[0].cat, 'front');    // 非法 cat → front
  assert.equal(out[0].data[0].grade, 'W1');     // 非法 grade → W1
  assert.ok(/^[A-Za-z0-9_-]{1,40}$/.test(out[0].id));
  assert.ok(!Number.isNaN(new Date(out[0].savedAt).getTime()));
});

test('sanitizeTemplates: 模板数封顶 50、单模板人员封顶 120', () => {
  const many = Array.from({ length: 55 }, (_, i) => ({ id: 'tp_' + i, name: 't' + i, data: [] }));
  const out = sanitizeTemplates(many);
  assert.equal(out.length, 50);

  const persons = Array.from({ length: 200 }, (_, i) => ({ cat: 'actor', name: 'p' + i, grade: 'W2', daily: 10 }));
  const one = sanitizeTemplates([{ id: 'tp_x', name: '大模板', data: persons }]);
  assert.equal(one[0].data.length, 120);
});

test('sanitizeTemplates: days 越界裁剪、非法 id 重新生成、非法 savedAt 归一为 epoch', () => {
  const out = sanitizeTemplates([{ id: '!!!', name: 'x', days: 999, savedAt: 'not-a-date', data: [] }]);
  assert.equal(out[0].days, 60);
  assert.notEqual(out[0].id, '!!!');
  assert.equal(out[0].savedAt, new Date(0).toISOString());

  const out2 = sanitizeTemplates([{ id: 'ok-id_1', name: 'x', days: 0, data: [] }]);
  assert.equal(out2[0].id, 'ok-id_1');
  assert.equal(out2[0].days, 1);
});

test('sanitizeTemplates: 合法枚举全部保留', () => {
  const data = CATS.map((cat, i) => ({ cat, name: 'n' + i, role: 'r', grade: GRADE_KEYS[i], daily: i * 10 }));
  const out = sanitizeTemplates([{ id: 'tp_ok', name: '全类别', days: 5, data }]);
  assert.equal(out[0].data.length, CATS.length);
  assert.deepEqual(out[0].data.map(p => p.cat), CATS);
});

/* ============================== checkJsonSize（大小守卫） ============================== */

test('checkJsonSize: 未超限返回字节数', () => {
  const len = checkJsonSize({ a: 1 }, LIMITS.gradesJson, 'grades');
  assert.ok(len > 0);
  assert.ok(len <= LIMITS.gradesJson);
});

test('checkJsonSize: 超限抛 PAYLOAD_TOO_LARGE', () => {
  const big = { s: 'x'.repeat(LIMITS.templatesJson) };
  assert.throws(() => checkJsonSize(big, LIMITS.templatesJson, 'templates'), e => e.code === 'PAYLOAD_TOO_LARGE');
});
