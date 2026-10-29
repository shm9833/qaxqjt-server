/* wage-rules-date-node-verify.js — 2026-07-30 默认标准日期节点更新机制验证（6 用例）
 * 运行：node tests/wage-rules-date-node-verify.js
 * 依赖：playwright-core（chromium-1187 本地执行档）；目标环境可用环境变量 WR_BASE 覆盖
 * 用例：T1 无存档默认自洽 / T2 生效日后 legacy 对账迁移 / T3 生效日前不迁移 /
 *       T4 已对账存档显式值保留+差异统计 / T5 保存规则记录标准血缘 / T6 恢复默认写回完整标准
 */
const { chromium } = require('playwright-core');
const BASE = process.env.WR_BASE || 'http://1.14.106.173';
const RESULTS = [];
function report(id, name, pass, detail) {
  RESULTS.push({ id, name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + id + ' ' + name + (detail ? ' | ' + detail : ''));
}

const LEGACY_RULES = {
  version: 'custom_1753833600000', updatedAt: 1753833600000,
  baseDailyWage: { '青衣': { '一级演员': 99900 } },
  performanceAllowance: { benxi: 99999 }
};

async function freshPage(browser, testNow) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (testNow) await ctx.addInitScript(`window.__WAGE_TEST_NOW = '${testNow}';`);
  const page = await ctx.newPage();
  const lr = await page.request.post(BASE + '/v1/auth/login', { data: { username: 'admin', password: '***REMOVED***', captcha: '', captchaId: '' } });
  const tok = (await lr.json()).data.accessToken;
  await page.goto(BASE + '/admin/login.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ at }) => {
    localStorage.setItem('qaxqjt_access_token', at);
    localStorage.setItem('qaxqjt_current_user', JSON.stringify({ username: 'admin', role: 'super_admin' }));
    localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ id: 's_wrdn', username: 'admin', role: 'super_admin', expiresAt: Date.now() + 7200000, fromApi: true, token: at }));
  }, { at: tok });
  return { ctx, page };
}
async function openWageRules(page) {
  await page.goto(BASE + '/admin/staff.html?v=wrdn', { waitUntil: 'domcontentloaded' });
  try { await page.waitForFunction(() => (window.__PF_ROWS__ || []).length > 0, { timeout: 20000 }); } catch (_) {}
  await page.click('.staff-tab[data-tab="wage"]');
  await page.waitForTimeout(900);
  await page.click('.wage-subtab[data-wtab="rules"]').catch(async () => {
    const t = await page.$('#wtab-rules'); if (t) await t.click();
  });
  await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'c:\\Users\\hp\\AppData\\Local\\ms-playwright\\chromium-1187\\chrome-win\\chrome.exe', headless: true, args: ['--no-sandbox'] });

  /* T1 无存档 → 默认标准自洽（徽章 + 完整性） */
  {
    const { ctx, page } = await freshPage(browser);
    await page.evaluate(() => localStorage.removeItem('qaxqjt_wage_rules_v1'));
    await openWageRules(page);
    const r = await page.evaluate(() => {
      const chk = window.WageEngine ? WageEngine.verifyRulesIntegrity() : { ok: false, issues: ['no engine'] };
      return {
        badge: (document.getElementById('wageRuleVersionBadge') || {}).textContent || '',
        ok: chk.ok, issues: chk.issues, dv: chk.defaultsVersion, eff: chk.effectiveDate,
        benxi: WageEngine.getDefaultRules().performanceAllowance.benxi
      };
    });
    report('T1', '无存档→默认标准自洽', r.badge.indexOf('v20260730 · 标准生效 2026-07-30') >= 0 && r.ok && r.dv === '20260730' && r.eff === '2026-07-30' && r.benxi === 12000,
      'badge="' + r.badge + '" ok=' + r.ok + ' issues=' + JSON.stringify(r.issues));
    await ctx.close();
  }

  /* T2 日期节点后：legacy 存档自动对账迁移（缺失键继承/显式值保留/写回元数据） */
  {
    const { ctx, page } = await freshPage(browser);
    await page.evaluate((lg) => localStorage.setItem('qaxqjt_wage_rules_v1', JSON.stringify(lg)), LEGACY_RULES);
    await openWageRules(page);
    const r = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('qaxqjt_wage_rules_v1'));
      const chk = WageEngine.verifyRulesIntegrity();
      return {
        dv: s.defaultsVersion, from: s.migratedFrom, migratedAt: !!s.migratedAt, eff: s.effectiveDate,
        benxiKept: s.performanceAllowance.benxi, mealFilled: s.dailySubsidy ? s.dailySubsidy.meal : null,
        qy1Kept: s.baseDailyWage['青衣']['一级演员'], qy2Filled: s.baseDailyWage['青衣']['二级演员'],
        ok: chk.ok, badge: (document.getElementById('wageRuleVersionBadge') || {}).textContent || ''
      };
    });
    report('T2', '生效日后legacy存档对账迁移', r.dv === '20260730' && r.from === 'legacy' && r.migratedAt && r.eff === '2026-07-30'
      && r.benxiKept === 99999 && r.mealFilled === 3000 && r.qy1Kept === 99900 && r.qy2Filled === 68000 && r.ok,
      JSON.stringify(r));
    await ctx.close();
  }

  /* T3 日期节点前：不触发迁移（行为冻结） */
  {
    const { ctx, page } = await freshPage(browser, '2026-06-01T00:00:00');
    await page.evaluate((lg) => localStorage.setItem('qaxqjt_wage_rules_v1', JSON.stringify(lg)), LEGACY_RULES);
    await openWageRules(page);
    const r = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('qaxqjt_wage_rules_v1'));
      const chk = WageEngine.verifyRulesIntegrity();
      return { dv: s.defaultsVersion === undefined, noMigrated: !s.migratedAt, mealMissing: !s.dailySubsidy, chkNotOk: !chk.ok, unReconciled: (chk.issues || []).some(i => i.indexOf('未对账') >= 0) };
    });
    report('T3', '生效日前不触发迁移', r.dv && r.noMigrated && r.mealMissing && r.chkNotOk && r.unReconciled, JSON.stringify(r));
    await ctx.close();
  }

  /* T4 已对账存档：显式自定义值保留 + 差异统计（校验不误报、不重写） */
  {
    const { ctx, page } = await freshPage(browser);
    const full = await page.evaluate(() => {
      const base = WageEngine.getDefaultRules(); // 无存档 → 完整默认标准（含 defaultsVersion）
      base.dailySubsidy.meal = 0; // 管理员显式清零餐补
      localStorage.setItem('qaxqjt_wage_rules_v1', JSON.stringify(base));
      return true;
    });
    await openWageRules(page);
    const r = await page.evaluate(() => {
      const s0 = JSON.stringify(localStorage.getItem('qaxqjt_wage_rules_v1'));
      const chk = WageEngine.verifyRulesIntegrity();
      const s1 = JSON.stringify(localStorage.getItem('qaxqjt_wage_rules_v1'));
      const cur = JSON.parse(localStorage.getItem('qaxqjt_wage_rules_v1') || 'null') || {};
      return { ok: chk.ok, deviations: chk.deviations, unchanged: s0 === s1, mealZero: cur.dailySubsidy && cur.dailySubsidy.meal === 0 };
    });
    report('T4', '已对账存档显式值保留+差异统计', r.ok && r.deviations >= 1 && r.unchanged && r.mealZero, JSON.stringify(r));
    await ctx.close();
  }

  /* T5 saveRules 打标 defaultsVersion/effectiveDate */
  {
    const { ctx, page } = await freshPage(browser);
    await page.evaluate(() => localStorage.removeItem('qaxqjt_wage_rules_v1'));
    await openWageRules(page);
    await page.evaluate(() => { const i = document.querySelector('input[data-wrule]'); i.value = '777'; });
    await page.click('#saveWageRulesBtn');
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('qaxqjt_wage_rules_v1'));
      return { dv: s.defaultsVersion, eff: s.effectiveDate, custom: String(s.version).indexOf('custom_') === 0, qy1: s.baseDailyWage['青衣']['一级演员'] };
    });
    report('T5', '保存规则记录标准版本血缘', r.dv === '20260730' && r.eff === '2026-07-30' && r.custom && r.qy1 === 77700, JSON.stringify(r));
    await ctx.close();
  }

  /* T6 恢复默认 → 完整标准含生效日 */
  {
    const { ctx, page } = await freshPage(browser);
    page.once('dialog', d => d.accept());
    await page.evaluate((lg) => localStorage.setItem('qaxqjt_wage_rules_v1', JSON.stringify(lg)), LEGACY_RULES);
    await openWageRules(page);
    const resetBtn = await page.$('#resetWageRulesBtn');
    if (resetBtn) { await resetBtn.click(); } else {
      const b = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(x => /恢复默认/.test(x.textContent)));
      if (b && b.asElement()) await b.asElement().click();
    }
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('qaxqjt_wage_rules_v1'));
      const chk = WageEngine.verifyRulesIntegrity();
      return { ver: s.version === '20260730', eff: s.effectiveDate === '2026-07-30', benxi: s.performanceAllowance.benxi === 12000, qy1: s.baseDailyWage['青衣']['一级演员'] === 88000, ok: chk.ok };
    });
    report('T6', '恢复默认写回完整标准', r.ver && r.eff && r.benxi && r.qy1 && r.ok, JSON.stringify(r));
    await ctx.close();
  }

  await browser.close();
  const passed = RESULTS.filter(r => r.pass).length;
  console.log('=== ' + passed + '/' + RESULTS.length + ' ===');
  process.exit(passed === RESULTS.length ? 0 : 2);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
