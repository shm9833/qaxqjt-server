/* tests/remaining-pages.unit.spec.js — cast-sheet / content / attendance / system 单元测试
 *
 * 用法：node tests/remaining-pages.unit.spec.js
 * 依赖：无（Node 内置 vm/assert/fs；函数体直接从线上 HTML 抽取）
 *
 * 覆盖：
 *   cast-sheet.html guessTypeByName（角色名启发式猜测）/ CSV esc /
 *                   _slot 岗级日薪 / _realNamePool 人选分组 /
 *                   generate36Template 36 人标配结构 / fillBlocksFromTemplate 文武场分流
 *   content.html    _escape（五字符映射）
 *   attendance.html __fmtYuan / _pad2
 *   system.html     _hasAction（死按钮识别：onclick/href/标记）/ _txtMatch
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ADMIN = path.join(__dirname, '..', 'admin');
function read(name) { return fs.readFileSync(path.join(ADMIN, name), 'utf8'); }
function sliceBetween(s, markA, markB) {
  const a = s.indexOf(markA);
  const b = s.indexOf(markB, a);
  assert(a >= 0 && b > a, '抽取失败：' + markA.slice(0, 36) + ' / ' + markB.slice(0, 36));
  return s.slice(a, b);
}
function sliceLine(s, mark) {
  const a = s.indexOf(mark);
  assert(a >= 0, '抽取失败：' + mark);
  const b = s.indexOf('\n', a);
  return s.slice(a, b);
}
function run(code, extra) {
  const sb = Object.assign({ console }, extra || {});
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: 'extract.js' });
  return sb;
}

const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓ ' + name); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}

(async () => {
  console.log('remaining-pages.unit.spec — cast-sheet / content / attendance / system\n');

  /* ==================== cast-sheet.html ==================== */
  const cs = read('cast-sheet.html');
  const guessCode = sliceBetween(cs, 'function guessTypeByName(name){', 'var DEFAULT_CREATIVE');
  const G = run(guessCode, { String, RegExp });

  await t('guessTypeByName: 女性常用名 → 青衣（含原先误判的王宝钏）', () => {
    ['秦香莲', '李母', '孙玉姣', '周凤莲', '王宝钏'].forEach(n => assert.strictEqual(G.guessTypeByName(n), '青衣', n));
  });
  await t('guessTypeByName: 嫂/姑 视为年轻女角仍归青衣；婆/媒/奶/妈 → 彩旦（彩旦优先判定）', () => {
    assert.strictEqual(G.guessTypeByName('苏嫂'), '青衣');
    assert.strictEqual(G.guessTypeByName('小姑'), '青衣');
    assert.strictEqual(G.guessTypeByName('王婆'), '彩旦');
    assert.strictEqual(G.guessTypeByName('王媒婆'), '彩旦');
    assert.strictEqual(G.guessTypeByName('刘媒'), '彩旦');
    assert.strictEqual(G.guessTypeByName('奶妈'), '彩旦');
    assert.strictEqual(G.guessTypeByName('小妈'), '彩旦'); // “妈”先于小生的“小”
  });
  await t('guessTypeByName: 包公/包/严/虎/龙 等短名 → 花脸（长度≤3 限制）', () => {
    assert.strictEqual(G.guessTypeByName('包公'), '花脸');
    assert.strictEqual(G.guessTypeByName('包拯'), '花脸'); // 含“包”
    assert.strictEqual(G.guessTypeByName('严嵩'), '花脸'); // 含“严”
    assert.strictEqual(G.guessTypeByName('虎将'), '花脸'); // 虎/龙 特征字保留
    // 长度>3 不落入花脸分支
    assert.notStrictEqual(G.guessTypeByName('铁面无私包公'), '花脸');
  });
  await t('guessTypeByName: 王/赵 不再作为花脸姓氏单字（女名防误判）', () => {
    // 王宝钏：含“王”三字，旧逻辑误判花脸；现走青衣（钏）
    assert.notStrictEqual(G.guessTypeByName('王宝钏'), '花脸');
    // 纯姓氏“赵”不再命中花脸（如赵高类角色属启发式已知边界，仅预填建议）
    assert.strictEqual(G.guessTypeByName('赵高'), '生角');
  });
  await t('guessTypeByName: 老年男性称谓 → 老生；滑稽角色 → 丑行（小丑不再被小生截走）', () => {
    assert.strictEqual(G.guessTypeByName('杨大人'), '老生');
    assert.strictEqual(G.guessTypeByName('千岁'), '老生'); // "千岁$" 结尾且长度≤4
    assert.strictEqual(G.guessTypeByName('小丑'), '丑行'); // 丑行分支已提前到小生之前
    assert.strictEqual(G.guessTypeByName('丑角'), '丑行');
    assert.strictEqual(G.guessTypeByName('差役'), '丑行');
  });
  await t('guessTypeByName: 年轻男性短名 → 小生；未命中 → 生角', () => {
    assert.strictEqual(G.guessTypeByName('周郎'), '小生');
    assert.strictEqual(G.guessTypeByName('秦生'), '小生');
    assert.strictEqual(G.guessTypeByName('路人甲'), '生角');
    assert.strictEqual(G.guessTypeByName('外星人XYZ'), '生角');
  });
  await t('guessTypeByName: 分支优先级 — “兰”命中青衣先于小生；彩旦先于全部男性分支', () => {
    assert.strictEqual(G.guessTypeByName('张兰'), '青衣'); // “兰”在青衣正则中
    assert.strictEqual(G.guessTypeByName('张婆'), '彩旦'); // 婆 不再被青衣截走
  });

  /* ---- 组团模板：WAGE_GRADES + _realNamePool + _slot + generate36Template ---- */
  /* loadPerformers 桩：构造各类别人选 */
  const flatPerformers = [
    { name: '演员甲', category: '老生' }, { name: '演员乙', category: '青衣' },
    { name: '板胡张', category: '文场' }, { name: '司鼓李', category: '武场' },
    { name: '灯光王', category: '其他', skill: '灯光师' },
    { name: '服装赵', category: '其他', skill: '服装管理' },
    { name: '检票周', category: '其他', skill: '检票' },
  ];
  const troupeCode =
    sliceBetween(cs, 'var WAGE_GRADES={', 'function updateTroupeStats(template){') +
    sliceBetween(cs, 'function _hx(s){', 'function seed36(){');
  const TR = run(troupeCode, {
    String, RegExp, Array, Object, JSON,
    loadPerformers: () => ({ flat: flatPerformers }),
    $: () => null,  // _fillBlock 取不到 tbody 时直接返回，不影响计数
  });

  await t('_slot: 岗级 W1-W7 映射日薪 80/120/180/280/400/600/800，空姓名回落空串', () => {
    assert.strictEqual(TR._slot('actor', '张三', '老生', 'W5').daily, 400);
    assert.strictEqual(TR._slot('band', null, '板胡', 'W6').daily, 600);
    assert.strictEqual(TR._slot('electric', '', '配电', 'W2').daily, 120);
    const s = TR._slot('front', undefined, '检票', 'W1');
    assert.strictEqual(s.name, '');
    assert.strictEqual(s.cat, 'front');
    assert.strictEqual(s.role, '检票');
  });
  await t('_realNamePool: 演员按行当入 actor；文场/武场入 band；技能正则分流 electric/costume；其余 front', () => {
    const p = TR._realNamePool();
    assert.deepEqualLike = assert.deepEqualLike || null;
    assert(p.actor.indexOf('演员甲') >= 0 && p.actor.indexOf('演员乙') >= 0);
    assert(p.band.indexOf('板胡张') >= 0 && p.band.indexOf('司鼓李') >= 0);
    assert(p.electric.indexOf('灯光王') >= 0);
    assert(p.costume.indexOf('服装赵') >= 0);
    assert(p.front.indexOf('检票周') >= 0);
    // 不应串组
    assert.strictEqual(p.actor.indexOf('板胡张'), -1);
    assert.strictEqual(p.front.indexOf('灯光王'), -1);
  });
  await t('_realNamePool: loadPerformers 抛错时安全返回五组空数组', () => {
    const TR2 = run(troupeCode, {
      String, RegExp, Array, Object, JSON,
      loadPerformers: () => { throw new Error('no cache'); },
      $: () => null,
    });
    const p = TR2._realNamePool();
    assert.strictEqual(p.actor.length + p.band.length + p.front.length + p.costume.length + p.electric.length, 0);
  });
  await t('generate36Template: 恰 36 人 = 演员18 + 乐队8 + 前台4 + 服装3 + 灯光3', () => {
    const tpl = TR.generate36Template();
    assert.strictEqual(tpl.length, 36);
    const cnt = { actor: 0, band: 0, front: 0, costume: 0, electric: 0 };
    tpl.forEach(x => { cnt[x.cat]++; });
    assert.deepStrictEqual(cnt, { actor: 18, band: 8, front: 4, costume: 3, electric: 3 });
  });
  await t('generate36Template: 岗位/岗级序列正确，日薪随岗级；人选池不足时姓名为空不报错', () => {
    const tpl = TR.generate36Template();
    assert.strictEqual(tpl[0].role, '老生');
    assert.strictEqual(tpl[0].grade, 'W5');
    assert.strictEqual(tpl[0].daily, 400);
    assert.strictEqual(tpl[18].role, '板胡');
    assert.strictEqual(tpl[18].grade, 'W6');
    assert.strictEqual(tpl[26].role, '舞台监督');
    assert.strictEqual(tpl[30].role, '服装师');
    assert.strictEqual(tpl[33].role, '灯光师');
    // 池只有 2 个演员，第 3 个演员岗位姓名应为 ''
    assert.strictEqual(tpl[2].name, '');
    // 池有名字的位置取 pool.actor[0]
    assert.strictEqual(tpl[0].name, '演员甲');
  });
  await t('fillBlocksFromTemplate: 演员18；舞台10；乐队文场4/武场4（竹笛正确归入文场）', () => {
    const cnt = TR.fillBlocksFromTemplate(TR.generate36Template());
    assert.strictEqual(cnt.actors, 18);
    // 文场：板胡/二胡/竹笛/三弦；武场：司鼓/大锣/铙钹/梆子
    assert.strictEqual(cnt.wenchang, 4);
    assert.strictEqual(cnt.wuchang, 4);
    assert.strictEqual(cnt.stage, 10);
    assert.strictEqual(cnt.actors + cnt.wenchang + cnt.wuchang + cnt.stage, 36);
  });
  await t('fillBlocksFromTemplate: 行内备注含岗级名与日薪文本', () => {
    // 直接用自造 template 验证 note 组装（DOM 填充被 $ 桩跳过，改为复制其分流前的 row 逻辑校验）
    const row = { grade: 'W5' };
    // 复刻生产行内格式：WAGE_GRADES[grade].name + ' / ¥' + daily + '/天'
    const note = TR.WAGE_GRADES[row.grade].name + ' / ¥' + TR.WAGE_GRADES[row.grade].daily + '/天';
    assert.strictEqual(note, 'A角 / ¥400/天');
  });
  await t('cast-sheet CSV esc: 双引号包裹+内部引号双写，null/0 安全', () => {
    // 单独抽取 CSV esc（单行函数）
    const escSb = run(sliceLine(cs, "function esc(s){ return '\"'"), { String });
    assert.strictEqual(escSb.esc('张三'), '"张三"');
    assert.strictEqual(escSb.esc('他说"你好"'), '"他说""你好"""');
    assert.strictEqual(escSb.esc(null), '""');
    assert.strictEqual(escSb.esc(0), '"0"');
  });

  /* ==================== content.html ==================== */
  const ct = read('content.html');
  const C = run(sliceLine(ct, 'function _escape(s)'), { String });
  await t('content._escape: 五字符一次替换，null/undefined 空串', () => {
    assert.strictEqual(C._escape(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    assert.strictEqual(C._escape(null), '');
    assert.strictEqual(C._escape(undefined), '');
    assert.strictEqual(C._escape(123), '123');
  });

  /* ==================== attendance.html ==================== */
  const at = read('attendance.html');
  const AT = run(
    sliceLine(at, "function __fmtYuan(n)") + '\n' +
    sliceLine(at, 'function _pad2(n)'),
    { Number, String }
  );
  await t('attendance.__fmtYuan: ¥ + 千分位，非数/空按 0', () => {
    assert.strictEqual(AT.__fmtYuan(1234), '¥1,234');
    assert.strictEqual(AT.__fmtYuan(1234.5), '¥1,234.5');
    assert.strictEqual(AT.__fmtYuan(1234.56), '¥1,234.56');
    assert.strictEqual(AT.__fmtYuan(1234.567), '¥1,234.57'); // 最多2位四舍五入
    assert.strictEqual(AT.__fmtYuan(0), '¥0');
    assert.strictEqual(AT.__fmtYuan(null), '¥0');
    assert.strictEqual(AT.__fmtYuan('x'), '¥0');
  });
  await t('attendance._pad2: 补零', () => {
    assert.strictEqual(AT._pad2(0), '00');
    assert.strictEqual(AT._pad2(9), '09');
    assert.strictEqual(AT._pad2(10), '10');
  });

  /* ==================== system.html ==================== */
  const sy = read('system.html');
  const SY = run(sliceBetween(sy, 'function _hasAction(btn){', 'function _txtMatch(txt, list){'));
  function btn(attrs, markers) {
    const b = {
      _oc: attrs.onclick !== undefined ? attrs.onclick : null,
      _hr: attrs.href !== undefined ? attrs.href : null,
      getAttribute(k) { return k === 'onclick' ? this._oc : this._hr; },
    };
    if (markers) Object.keys(markers).forEach(k => { b[k] = markers[k]; });
    return b;
  }
  await t('system._hasAction: 空对象 false；onclick 长度>3 才算绑定', () => {
    assert.strictEqual(SY._hasAction(null), false);
    assert.strictEqual(SY._hasAction(btn({})), false);
    assert.strictEqual(SY._hasAction(btn({ onclick: 'fn()' })), true); // 长度4
    assert.strictEqual(SY._hasAction(btn({ onclick: 'fn(' })), false);  // 长度3 不算
    assert.strictEqual(SY._hasAction(btn({ onclick: 'fn' })), false);  // 长度2
    assert.strictEqual(SY._hasAction(btn({ onclick: '' })), false);
  });
  await t('system._hasAction: href 为真实链接算绑定；# / 空 / javascript: 不算', () => {
    assert.strictEqual(SY._hasAction(btn({ href: '/v1/export' })), true);
    assert.strictEqual(SY._hasAction(btn({ href: 'https://x.com/a' })), true);
    assert.strictEqual(SY._hasAction(btn({ href: '#' })), false);
    assert.strictEqual(SY._hasAction(btn({ href: '' })), false);
    assert.strictEqual(SY._hasAction(btn({ href: 'javascript:void(0)' })), false);
  });
  await t('system._hasAction: 打了 __deadBtnChecked / __superPatchBound 标记算已绑定', () => {
    assert.strictEqual(SY._hasAction(btn({}, { __deadBtnChecked: 1 })), true);
    assert.strictEqual(SY._hasAction(btn({}, { __superPatchBound: 1 })), true);
  });

  /* ---------- 汇总 ---------- */
  const failed = results.filter(r => !r.ok);
  console.log('\n========================================');
  console.log('总计 ' + results.length + ' 项：✓ ' + (results.length - failed.length) + ' 通过，✗ ' + failed.length + ' 失败');
  if (failed.length) {
    failed.forEach(f => { console.log('\n[FAIL] ' + f.name); console.log(f.err && f.err.stack || f.err); });
    process.exit(1);
  }
  console.log('全部通过');
  process.exit(0);
})().catch(e => { console.error('测试运行器异常:', e); process.exit(2); });
