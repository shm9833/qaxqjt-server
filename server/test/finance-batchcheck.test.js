'use strict';

/**
 * 前端批量核销 batchCheck() 单元测试（js/admin-pages/finance.js v20261007c+）
 * 策略：从真实前端源码抽取 batchCheck 函数体，vm 沙箱注入假 DOM 与依赖缝
 *       （_tbody / T / confirm / API.patch / QAXQJT_PATHS / load），
 *       确保测试对象 = 线上实际运行代码，不改生产文件。
 * 覆盖：空勾选/全非草稿/取消确认/混合勾选跳过计数/全成功/部分失败(M-15 语义透传)/
 *       全失败/tbody 缺失/PATCH URL 回退/confirm 文案不含 M-15 互斥提示（admin 可自审）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.resolve(__dirname, '../../js/admin-pages/finance.js');

/** 按花括号配平从源码中抽取 batchCheck 函数定义 */
function extractBatchCheck() {
  const src = fs.readFileSync(SRC, 'utf8');
  const mark = 'async function batchCheck(){';
  const start = src.indexOf(mark);
  assert.notStrictEqual(start, -1, 'batchCheck 未在 finance.js 中找到');
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.ok(end > start, 'batchCheck 函数体抽取失败（花括号未配平）');
  return src.slice(start, end);
}

const BATCH_SRC = extractBatchCheck();

/** 构造一行假台账记录（tr）：id + 状态列文本 */
function mkRow(id, statusText) {
  return {
    getAttribute: k => (k === 'data-id' ? id : null),
    querySelector: sel => (sel === 'td:nth-child(10)' ? { textContent: statusText } : null)
  };
}

/** 构造测试环境：返回 { fn, calls }；fn 为注入缝后的真实 batchCheck */
function makeEnv(opts = {}) {
  const { rows = [], patchImpl = null, tbodyPresent = true, withPathHelper = true, loadImpl = null, tbodyImpl = null } = opts;
  // confirmResult 不能用解构默认值：显式传 undefined（falsy 取消场景）必须保留
  const confirmResult = Object.prototype.hasOwnProperty.call(opts, 'confirmResult') ? opts.confirmResult : true;
  const calls = { patch: [], toasts: [], confirms: [], load: 0 };
  const boxes = rows.map(r => ({ closest: sel => (sel === 'tr' ? r : null) }));
  const tbody = { querySelectorAll: sel => (sel === 'input.batch-row-check:checked' ? boxes : []) };
  const sandbox = {
    _tbody: () => { if (tbodyImpl) return tbodyImpl(); return tbodyPresent ? tbody : null; },
    T: (msg, type, dur) => calls.toasts.push({ msg: String(msg), type, dur }),
    confirm: msg => { calls.confirms.push(String(msg)); return confirmResult; },
    API: {
      patch: async (url, body) => {
        calls.patch.push({ url: String(url), body });
        if (patchImpl) return patchImpl(url, body);
        return {};
      }
    },
    QAXQJT_PATHS: withPathHelper ? { FIN_LEDGER_BY_ID: id => '/v1/fin/ledger/' + id } : {},
    load: async () => { calls.load++; if (loadImpl) return loadImpl(); }
  };
  const fn = vm.runInNewContext(BATCH_SRC + '\nbatchCheck;', sandbox);
  assert.strictEqual(typeof fn, 'function');
  return { fn, calls };
}

test('batchCheck: tbody 不存在 → 静默返回（无提示/无请求/不刷新）', async () => {
  const { fn, calls } = makeEnv({ tbodyPresent: false });
  await fn();
  assert.strictEqual(calls.toasts.length, 0);
  assert.strictEqual(calls.patch.length, 0);
  assert.strictEqual(calls.load, 0);
});

test('batchCheck: 未勾选任何凭证 → warning「请先勾选」，不发请求', async () => {
  const { fn, calls } = makeEnv({ rows: [] });
  await fn();
  assert.strictEqual(calls.toasts.length, 1);
  assert.strictEqual(calls.toasts[0].type, 'warning');
  assert.match(calls.toasts[0].msg, /请先勾选/);
  assert.strictEqual(calls.patch.length, 0);
  assert.strictEqual(calls.confirms.length, 0);
  assert.strictEqual(calls.load, 0);
});

test('batchCheck: 勾选全部为非草稿 → warning「均非草稿」，不弹确认框', async () => {
  const { fn, calls } = makeEnv({ rows: [mkRow('led_a', '已复核'), mkRow('led_b', '已复核')] });
  await fn();
  assert.strictEqual(calls.toasts.length, 1);
  assert.match(calls.toasts[0].msg, /均非草稿状态/);
  assert.strictEqual(calls.confirms.length, 0);
  assert.strictEqual(calls.patch.length, 0);
  assert.strictEqual(calls.load, 0);
});

test('batchCheck: 用户在确认框取消 → 不发任何 PATCH，不刷新列表', async () => {
  const { fn, calls } = makeEnv({ rows: [mkRow('led_1', '草稿')], confirmResult: false });
  await fn();
  assert.strictEqual(calls.confirms.length, 1);
  assert.strictEqual(calls.patch.length, 0);
  assert.strictEqual(calls.toasts.length, 0);
  assert.strictEqual(calls.load, 0);
});

test('batchCheck: 混合勾选 → confirm 文案含草稿数与跳过数', async () => {
  const { fn, calls } = makeEnv({
    rows: [mkRow('led_1', '草稿'), mkRow('led_2', '已复核'), mkRow('led_3', '草稿')],
    confirmResult: false
  });
  await fn();
  assert.strictEqual(calls.confirms.length, 1);
  assert.match(calls.confirms[0], /确认核销 2 笔草稿凭证/);
  assert.match(calls.confirms[0], /将跳过 1 笔非草稿凭证/);
});

test('batchCheck: confirm 文案不再含 M-15 制单复核互斥提示（admin 可自审，v20261007d）', async () => {
  const { fn, calls } = makeEnv({ rows: [mkRow('led_1', '草稿')], confirmResult: false });
  await fn();
  assert.ok(!/制单人与复核人不可为同一人/.test(calls.confirms[0]), 'confirm 文案不应再出现 M-15 互斥提示');
});

test('batchCheck: 全部草稿且确认 → 逐条 PATCH checked，成功提示并刷新', async () => {
  const { fn, calls } = makeEnv({ rows: [mkRow('led_1', '草稿'), mkRow('led_2', '草稿')] });
  await fn();
  assert.strictEqual(calls.patch.length, 2);
  assert.deepStrictEqual(calls.patch.map(p => p.url), ['/v1/fin/ledger/led_1', '/v1/fin/ledger/led_2']);
  calls.patch.forEach(p => assert.strictEqual(p.body.status, 'checked'));
  assert.strictEqual(calls.toasts.length, 1);
  assert.strictEqual(calls.toasts[0].type, 'success');
  assert.match(calls.toasts[0].msg, /已核销 2 笔凭证/);
  assert.strictEqual(calls.load, 1);
});

test('batchCheck: 部分失败（M-15 403 语义）→ warning 透传后端 message 且仍刷新', async () => {
  const { fn, calls } = makeEnv({
    rows: [mkRow('led_ok', '草稿'), mkRow('led_bad', '草稿')],
    patchImpl: url => {
      if (String(url).includes('led_bad')) {
        const e = new Error('制单人与复核人不可为同一人（M-15 双角色）');
        e.status = 403;
        throw e;
      }
    }
  });
  await fn();
  assert.strictEqual(calls.patch.length, 2);
  assert.strictEqual(calls.toasts.length, 1);
  assert.strictEqual(calls.toasts[0].type, 'warning');
  assert.match(calls.toasts[0].msg, /已核销 1 笔，1 笔失败/);
  assert.match(calls.toasts[0].msg, /M-15/);
  assert.strictEqual(calls.load, 1);
});

test('batchCheck: 全部失败 → error 提示且不吞错误消息，仍刷新列表', async () => {
  const { fn, calls } = makeEnv({
    rows: [mkRow('led_x', '草稿')],
    patchImpl: () => { throw new Error('Network Error'); }
  });
  await fn();
  assert.strictEqual(calls.toasts.length, 1);
  assert.strictEqual(calls.toasts[0].type, 'error');
  assert.match(calls.toasts[0].msg, /核销失败：Error|Network Error/);
  assert.strictEqual(calls.load, 1);
});

test('batchCheck: QAXQJT_PATHS.FIN_LEDGER_BY_ID 缺失 → 回退拼接 /v1/fin/ledger/:id', async () => {
  const { fn, calls } = makeEnv({ rows: [mkRow('led_fb', '草稿')], withPathHelper: false });
  await fn();
  assert.strictEqual(calls.patch.length, 1);
  assert.strictEqual(calls.patch[0].url, '/v1/fin/ledger/led_fb');
});

test('batchCheck: 勾选行无 data-id → 该行被忽略', async () => {
  const { fn, calls } = makeEnv({ rows: [mkRow(null, '草稿'), mkRow('led_1', '草稿')] });
  await fn();
  assert.strictEqual(calls.patch.length, 1);
  assert.strictEqual(calls.patch[0].url, '/v1/fin/ledger/led_1');
});

// ==================== 边界用例 ====================

test('边界: 状态列含空白换行 → trim 后仍能识别草稿', async () => {
  const { fn, calls } = makeEnv({ rows: [mkRow('led_ws', '  \n 草稿 \t')] });
  await fn();
  assert.strictEqual(calls.patch.length, 1);
  assert.strictEqual(calls.patch[0].url, '/v1/fin/ledger/led_ws');
});

test('边界: 状态列不含"草稿"二字（如"复核中"）→ 视为非草稿跳过', async () => {
  const { fn, calls } = makeEnv({ rows: [mkRow('led_p', '复核中')], confirmResult: true });
  await fn();
  assert.strictEqual(calls.patch.length, 0);
  assert.match(calls.toasts[0].msg, /均非草稿/);
});

test('边界: 勾选行缺少状态列 td → statusTxt 为空，按非草稿跳过', async () => {
  const badRow = {
    getAttribute: k => (k === 'data-id' ? 'led_notd' : null),
    querySelector: () => null
  };
  const { fn, calls } = makeEnv({ rows: [badRow, mkRow('led_ok', '草稿')] });
  await fn();
  assert.strictEqual(calls.patch.length, 1);
  assert.strictEqual(calls.patch[0].url, '/v1/fin/ledger/led_ok');
  assert.match(calls.confirms[0], /将跳过 1 笔非草稿凭证/);
});

test('边界: 单个草稿成功 → toast 计数正确（1 笔）', async () => {
  const { fn, calls } = makeEnv({ rows: [mkRow('led_one', '草稿')] });
  await fn();
  assert.strictEqual(calls.patch.length, 1);
  assert.match(calls.toasts[0].msg, /已核销 1 笔凭证/);
});

test('边界: 大批量 20 笔草稿全部成功 → 20 次 PATCH + 计数正确', async () => {
  const rows = [];
  for (let i = 1; i <= 20; i++) rows.push(mkRow('led_b' + i, '草稿'));
  const { fn, calls } = makeEnv({ rows });
  await fn();
  assert.strictEqual(calls.patch.length, 20);
  assert.match(calls.toasts[0].msg, /已核销 20 笔凭证/);
});

test('边界: PATCH 顺序与勾选顺序一致（逐条串行）', async () => {
  const { fn, calls } = makeEnv({ rows: [mkRow('led_c', '草稿'), mkRow('led_a', '草稿'), mkRow('led_b', '草稿')] });
  await fn();
  assert.deepStrictEqual(calls.patch.map(p => p.url), ['/v1/fin/ledger/led_c', '/v1/fin/ledger/led_a', '/v1/fin/ledger/led_b']);
});

test('边界: API.patch 抛非 Error 对象（字符串/null）→ lastErr 兜底为"未知错误"', async () => {
  const { fn, calls } = makeEnv({
    rows: [mkRow('led_s', '草稿'), mkRow('led_n', '草稿')],
    patchImpl: url => {
      if (String(url).includes('led_s')) throw 'string_error';
      throw null;
    }
  });
  await fn();
  assert.strictEqual(calls.toasts.length, 1);
  assert.strictEqual(calls.toasts[0].type, 'error');
  // string 'string_error' 不是 Error，(e.message||e) → 'string_error'；null → '未知错误'（最后一个）
  assert.match(calls.toasts[0].msg, /未知错误/);
});

test('边界: confirm 期间无任何异常 → confirm 只弹一次', async () => {
  const { fn, calls } = makeEnv({ rows: [mkRow('led_1', '草稿'), mkRow('led_2', '草稿')] });
  await fn();
  assert.strictEqual(calls.confirms.length, 1);
});

test('边界: load() 抛异常 → 已核销 toast 已提示，异常向上传播不吞', async () => {
  const { fn, calls } = makeEnv({
    rows: [mkRow('led_1', '草稿')],
    loadImpl: () => { throw new Error('reload failed'); }
  });
  await assert.rejects(fn, /reload failed/);
  assert.strictEqual(calls.patch.length, 1);
  assert.match(calls.toasts[0].msg, /已核销 1 笔凭证/);
  assert.strictEqual(calls.load, 1);
});

test('边界: 重复连续调用 → 每次独立处理（无共享状态泄漏）', async () => {
  const { fn, calls } = makeEnv({ rows: [mkRow('led_r', '草稿')] });
  await fn();
  await fn();
  assert.strictEqual(calls.patch.length, 2);
  assert.strictEqual(calls.confirms.length, 2);
  assert.strictEqual(calls.load, 2);
  assert.strictEqual(calls.toasts.length, 2);
});

// ==================== 异常兜底用例 ====================

test('兜底: 勾选框 closest("tr") 为 null（孤立 checkbox）→ 该行被忽略', async () => {
  // 构造：一个 closest 返回 null 的孤立 checkbox + 一个正常行
  const calls = { patch: [], toasts: [], confirms: [], load: 0 };
  const boxes = [
    { closest: () => null },
    { closest: sel => (sel === 'tr' ? mkRow('led_ok', '草稿') : null) }
  ];
  const tbody = { querySelectorAll: () => boxes };
  const sandbox = {
    _tbody: () => tbody,
    T: (m, t) => calls.toasts.push({ msg: String(m), type: t }),
    confirm: () => true,
    API: { patch: async url => { calls.patch.push(String(url)); return {}; } },
    QAXQJT_PATHS: { FIN_LEDGER_BY_ID: id => '/v1/fin/ledger/' + id },
    load: async () => { calls.load++; }
  };
  const fn = vm.runInNewContext(BATCH_SRC + '\nbatchCheck;', sandbox);
  await fn();
  assert.strictEqual(calls.patch.length, 1);
  assert.strictEqual(calls.patch[0], '/v1/fin/ledger/led_ok');
});

test('兜底: 首笔 PATCH 失败不短路，后续草稿仍继续核销', async () => {
  const { fn, calls } = makeEnv({
    rows: [mkRow('led_bad', '草稿'), mkRow('led_ok', '草稿')],
    patchImpl: url => {
      if (String(url).includes('led_bad')) throw new Error('HTTP 409 仅草稿可提交复核');
    }
  });
  await fn();
  assert.strictEqual(calls.patch.length, 2, '失败后必须继续处理后续凭证');
  assert.strictEqual(calls.patch[1].url, '/v1/fin/ledger/led_ok');
  assert.strictEqual(calls.toasts[0].type, 'warning');
  assert.match(calls.toasts[0].msg, /已核销 1 笔，1 笔失败/);
});

test('兜底: patch 抛带 message 的非 Error 对象字面量 → message 透传', async () => {
  const { fn, calls } = makeEnv({
    rows: [mkRow('led_o', '草稿')],
    patchImpl: () => { throw { message: 'HTTP 409 CONFLICT: 仅草稿状态凭证可提交复核' }; }
  });
  await fn();
  assert.strictEqual(calls.toasts[0].type, 'error');
  assert.match(calls.toasts[0].msg, /HTTP 409 CONFLICT/);
});

test('兜底: patch 抛空 message 的 Error → String(e) 兜底为 "Error"', async () => {
  const { fn, calls } = makeEnv({
    rows: [mkRow('led_e', '草稿')],
    patchImpl: () => { throw new Error(''); }
  });
  await fn();
  assert.strictEqual(calls.toasts[0].type, 'error');
  assert.match(calls.toasts[0].msg, /核销失败：Error/);
});

test('兜底: confirm 返回 falsy 非 false（undefined）→ 同样视为取消', async () => {
  const { fn, calls } = makeEnv({ rows: [mkRow('led_1', '草稿')], confirmResult: undefined });
  await fn();
  assert.strictEqual(calls.confirms.length, 1);
  assert.strictEqual(calls.patch.length, 0);
  assert.strictEqual(calls.load, 0);
});

test('兜底: _tbody() 自身抛异常（DOM 已卸载）→ 向上传播不吞，无副作用', async () => {
  const { fn, calls } = makeEnv({
    tbodyImpl: () => { throw new Error('dom gone'); }
  });
  await assert.rejects(fn, /dom gone/);
  assert.strictEqual(calls.toasts.length, 0);
  assert.strictEqual(calls.patch.length, 0);
  assert.strictEqual(calls.load, 0);
});
