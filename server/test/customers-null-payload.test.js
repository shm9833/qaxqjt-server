/* customers-null-payload.test.js —— 回归测试：客户保存 null → Joi 400 生产 bug（20261026 修复）
 *
 * 根因：前端 saveCustomer 曾把空 level/organization/remark 发成 null，
 *       而路由 Joi schema 仅 allow('')，导致客户新增/编辑生产必 400。
 * 修复：orders.js 空值改发 ''/省略字段（orders.js L1923-1932，注释 v20261026fix）。
 *
 * 本测试不复制 schema/构造逻辑，而是从源码动态提取后用真实 Joi 执行：
 *   1) server/src/routes/v1/index.js 中 POST/PATCH /customers 的 body schema
 *   2) js/admin-pages/orders.js 中 saveCustomer 的 body 构造段（含 delete body.level）
 * 源码回退（再发 null）时用例会红，防止复发。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Joi = require('joi');

const SERVER_ROOT = path.join(__dirname, '..');
const ROUTES_SRC = path.join(SERVER_ROOT, 'src', 'routes', 'v1', 'index.js');
const ORDERS_JS = path.join(SERVER_ROOT, '..', 'js', 'admin-pages', 'orders.js');

/* —— 源码提取工具 —— */
function balancedFrom(src, openIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh) { depth--; if (depth === 0) return src.slice(openIdx, i + 1); }
  }
  throw new Error('unbalanced ' + openCh + ' from ' + openIdx);
}

/** 从 index.js 提取该路由的完整 validate({...}) 调用并执行（保留 .min(1) 等链式修饰），返回 body schema */
function extractCustomerBodySchema(anchorRe, anchorName) {
  const src = fs.readFileSync(ROUTES_SRC, 'utf8');
  const m = src.match(anchorRe);
  assert.ok(m, 'route anchor not found in routes/v1/index.js: ' + anchorName);
  const vStart = src.indexOf('validate(', m.index);
  assert.ok(vStart >= 0, 'validate( not found after anchor: ' + anchorName);
  const expr = balancedFrom(src, vStart, '(', ')');
  return new Function('Joi', 'validate', 'return ' + expr)(Joi, (opts) => opts.body);
}

/** 从 orders.js 提取 saveCustomer 的 body 构造段（var body = {...}; ... delete body.level;） */
function extractSaveCustomerBodyBuilder() {
  const src = fs.readFileSync(ORDERS_JS, 'utf8');
  const fn = src.indexOf('saveCustomer: async function(){');
  assert.ok(fn >= 0, 'saveCustomer not found in orders.js');
  const start = src.indexOf('var body = {', fn);
  const endMark = 'delete body.level;';
  const end = src.indexOf(endMark, start);
  assert.ok(start >= 0 && end > start, 'saveCustomer body block (var body{...}..delete body.level) not found');
  return src.slice(start, end + endMark.length);
}

/* —— 被测单元（每例重建，避免共享状态） —— */
function buildSaveCustomerBody(values) {
  const code = extractSaveCustomerBodyBuilder() + '\nreturn body;';
  const stubDoc = { getElementById: (id) => ({ value: values[id] !== undefined ? values[id] : '' }) };
  return new Function('document', code)(stubDoc);
}
const postSchema = () => extractCustomerBodySchema(/v1\.post\(\s*'\/customers',/, 'POST /customers');
const patchSchema = () => extractCustomerBodySchema(/v1\.patch\(\s*'\/customers\/:id',/, 'PATCH /customers/:id');

/* —— 前端构造段（修复后行为） —— */
test('saveCustomer 构造段存在且含 v20261026fix 注释锚点', () => {
  const src = fs.readFileSync(ORDERS_JS, 'utf8');
  assert.ok(src.includes('v20261026fix'), '修复注释丢失，可能已回退');
});

test('全空输入：body 无 level 键、无任何 null 值、customerType 兜底 personal', () => {
  const body = buildSaveCustomerBody({});
  assert.deepStrictEqual(
    Object.keys(body).sort(),
    ['customerName', 'customerType', 'organization', 'phone', 'remark'],
    'level 应被删除，不得残留'
  );
  for (const [k, v] of Object.entries(body)) assert.notStrictEqual(v, null, '字段 ' + k + ' 不得为 null');
  assert.strictEqual(body.customerType, 'personal');
  assert.strictEqual(body.organization, '');
  assert.strictEqual(body.remark, '');
});

test('有值输入：字段映射正确（level 保留、organization/remark trim）', () => {
  const body = buildSaveCustomerBody({
    custEditName: '  王小测 ', custEditPhone: '13900001026', custEditType: 'organization',
    custEditLevel: 'VIP', custEditOrganization: '  某某剧团 ', custEditRemark: ' 备注 '
  });
  assert.strictEqual(body.customerName, '王小测');
  assert.strictEqual(body.phone, '13900001026');
  assert.strictEqual(body.customerType, 'organization');
  assert.strictEqual(body.level, 'VIP');
  assert.strictEqual(body.organization, '某某剧团');
  assert.strictEqual(body.remark, '备注');
});

/* —— 后端校验契约（与生产 Joi 一致） —— */
test('POST /customers：修复后新增 payload（空组织/备注、无 level）通过校验', () => {
  const body = buildSaveCustomerBody({ custEditName: 'E2E客户新增测试', custEditPhone: '19900003026' });
  const r = postSchema().validate(body);
  assert.ifError(r.error);
});

test('POST /customers：旧版 null payload 被拒绝（锁死 bug 根因，防止复发/误放宽）', () => {
  const legacy = {
    customerName: '测试客户', phone: '19900001026', customerType: 'personal',
    level: null, organization: null, remark: null
  };
  const r = postSchema().validate(legacy);
  assert.ok(r.error, 'level/organization/remark=null 应校验失败（Joi 仅 allow(\'\')）');
});

test('POST /customers：正常值 payload 通过校验', () => {
  const r = postSchema().validate({
    customerName: '某某剧团', phone: '09321234567', customerType: 'organization',
    level: 'VIP', organization: '某某剧团', remark: '长期合作'
  });
  assert.ifError(r.error);
});

test('PATCH /customers/:id：修复后编辑 payload（空 remark、无 level）通过校验', () => {
  const body = buildSaveCustomerBody({ custEditName: 'E2E收款链路测试', custEditPhone: '19900001026', custEditRemark: 'E2E编辑OK1026' });
  const r = patchSchema().validate(body);
  assert.ifError(r.error);
});

test('PATCH /customers/:id：null 字段被拒绝', () => {
  const r = patchSchema().validate({ remark: null, level: null });
  assert.ok(r.error, 'PATCH 空值=null 同样会 400，必须发 \'\'/省略');
});

test('PATCH /customers/:id：空对象被 min(1) 拒绝', () => {
  const r = patchSchema().validate({});
  assert.ok(r.error, 'min(1) 应拒绝空更新');
});

test('PATCH /customers/:id：全空表单构造的 body 仍至少含可更新字段（不会被 min(1) 拦截）', () => {
  const body = buildSaveCustomerBody({ custEditName: '张三', custEditPhone: '13800000000' });
  const r = patchSchema().validate(body);
  assert.ifError(r.error);
});
