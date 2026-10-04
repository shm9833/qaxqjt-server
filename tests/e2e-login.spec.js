/* tests/e2e-login.spec.js — 秦安县秦剧团后台 E2E 登录与页面访问测试
 *
 * 用法：
 *   node tests/e2e-login.spec.js                       # 跑默认 nginx 环境
 *   node tests/e2e-login.spec.js --base https://x.edgeone.cool?eo_token=...&eo_time=...
 *   node tests/e2e-login.spec.js --headless            # 无界面模式
 *   node tests/e2e-login.spec.js --user admin --pwd '<管理员密码>'
 *
 * 依赖：playwright-core + 已安装的 chromium-1234（ms-playwright 缓存）
 *
 * 验证项：
 *   1. 登录页加载（含验证码）
 *   2. 真实表单登录（admin + --pwd 传入密码 + 自动填验证码）
 *   3. 跳转离开 login.html
 *   4. localStorage 写入 qaxqjt_admin_session
 *   5. 6 个 admin 页面均能加载（content/accounts/finance/inventory/system/cast-sheet）
 *   6. 每页含真实 API 接线标记（__contentApi/loadAccountsFromApi/__finApi/__invApi/__sysApi/saveState）
 *      且核心函数/命名空间在运行时或源码中存在；每页无致命 console 错误（仅警告级允许）
 *   7. cast-sheet.html 的 saveState/loadState 函数存在
 *   8. cast-sheets API GET /v1/cast-sheets 在登录态下返回 200
 */

const { chromium } = require('playwright-core');
const assert = require('assert');

// 已安装的 chromium-1234 路径（不依赖 playwright 下载）
const CHROMIUM_EXE = 'C:\\Users\\hp\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';

// 默认参数
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return def;
}
const BASE_URL = arg('base', 'http://1.14.106.173');
const HEADLESS = argv.includes('--headless');
const ADMIN_USER = arg('user', 'admin');
const ADMIN_PWD = arg('pwd', process.env.QAXQJT_ADMIN_PWD || '');

// 测试结果汇总
const results = [];
function record(name, pass, evidence) {
  results.push({ name, pass, evidence });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${evidence ? ' — ' + evidence : ''}`);
}

async function main() {
  console.log('=== 秦安县秦剧团后台 E2E 登录测试 ===');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Headless: ${HEADLESS}`);
  console.log(`Chromium: ${CHROMIUM_EXE}`);
  console.log('');

  if (require('fs').existsSync && !require('fs').existsSync(CHROMIUM_EXE)) {
    console.error('chromium-1234 未找到，请先安装 Playwright 浏览器');
    process.exit(2);
  }

  const browser = await chromium.launch({
    executablePath: CHROMIUM_EXE,
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true
  });

  // 收集 console 错误
  const consoleErrors = [];
  const pageErrors = [];
  let currentPage = null;

  async function attachConsole(p) {
    p.on('console', (msg) => {
      if (msg.type() === 'error') {
        const t = msg.text();
        // 忽略已知无害错误
        if (t.includes('xlsx.min.js') || t.includes('Failed to load resource') || t.includes('net::ERR_ABORTED')) return;
        consoleErrors.push({ url: p.url(), text: t });
      }
    });
    p.on('pageerror', (err) => {
      pageErrors.push({ url: p.url(), text: err.message });
    });
    currentPage = p;
  }

  try {
    // ===== 1. 打开登录页 =====
    const page = await context.newPage();
    await attachConsole(page);
    console.log('[1] 打开登录页:', BASE_URL + '/admin/login.html');
    await page.goto(BASE_URL + '/admin/login.html', { waitUntil: 'networkidle', timeout: 30000 });

    const title = await page.title();
    record('登录页 title 含"秦安县秦剧团"', title.includes('秦安县秦剧团') || title.includes('登录'), `title="${title}"`);

    // ===== 2. 验证表单元素存在 =====
    const unameOk = await page.locator('#admin-username').count();
    const pwdOk = await page.locator('#admin-password').count();
    const capOk = await page.locator('#admin-captcha').count();
    const btnOk = await page.locator('#loginBtn').count();
    record('登录表单元素齐全', unameOk > 0 && pwdOk > 0 && capOk > 0 && btnOk > 0,
      `username=${unameOk} password=${pwdOk} captcha=${capOk} btn=${btnOk}`);

    // ===== 3. 读取验证码 =====
    // login.html 把验证码存到 window.currentCaptcha
    const captcha = await page.evaluate(() => String(window.currentCaptcha || ''));
    record('读取前端验证码', captcha.length === 4, `captcha="${captcha}"`);

    // ===== 4. 填表单并登录 =====
    console.log(`[4] 填写表单: user=${ADMIN_USER} captcha=${captcha}`);
    await page.fill('#admin-username', ADMIN_USER);
    await page.fill('#admin-password', ADMIN_PWD);
    await page.fill('#admin-captcha', captcha);

    // 等待跳转（点击登录后应跳转到 index.html 或其他 admin 页）
    const navPromise = page.waitForURL((url) => !url.toString().includes('login.html'), { timeout: 15000 })
      .catch(() => null);
    await page.click('#loginBtn');
    await navPromise;
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const curUrl = page.url();
    const leftLogin = !curUrl.includes('login.html');
    record('登录成功并跳转离开 login.html', leftLogin, `当前 URL=${curUrl}`);

    // ===== 5. 检查 localStorage session =====
    const session = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('qaxqjt_admin_session');
        if (!raw) return { has: false };
        const s = JSON.parse(raw);
        return {
          has: true,
          id: s.id || null,
          expiresAt: s.expiresAt || null,
          hasToken: !!s.accessToken,
          forcePwdChange: !!s.forcePwdChange
        };
      } catch (e) { return { has: false, err: e.message }; }
    });
    record('localStorage.qaxqjt_admin_session 已写入',
      session.has && session.id,
      `id=${session.id} expiresAt=${session.expiresAt} hasToken=${session.hasToken}`);

    // ===== 6. 依次访问 6 个 admin 页面 =====
    // 每页标记 = 真实 API 接线的命名空间/核心函数标识（v20260921 后页面重构为命名空间模式）
    const pages = [
      { name: 'content.html',    marker: '__contentApi',       fnTest: ['__contentApi', '__contentApi.load'] },
      { name: 'accounts.html',   marker: 'loadAccountsFromApi', fnTest: ['loadAccountsFromApi', 'saveUser'] },
      { name: 'finance.html',    marker: '__finApi',           fnTest: ['__finApi'] },
      { name: 'inventory.html',  marker: '__invApi',           fnTest: ['__invApi'] },
      { name: 'system.html',     marker: '__sysApi',           fnTest: ['__sysApi'] },
      { name: 'cast-sheet.html', marker: 'saveState',          fnTest: ['saveState', 'loadState'] }
    ];

    for (const p of pages) {
      const url = `${BASE_URL}/admin/${p.name}`;
      console.log(`[6] 访问 ${p.name}`);
      const beforeErrCount = consoleErrors.length;
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);

      // 检查是否被踢回登录页
      const finalUrl = page.url();
      const stillOnPage = !finalUrl.includes('login.html');
      record(`${p.name} 加载成功`, stillOnPage, `URL=${finalUrl}`);

      if (stillOnPage) {
        // 检查页面真实接线标记（head/body 全文档范围，兼容脚本位于 <head> 的页面）
        const docHas = await page.evaluate((m) => document.documentElement.outerHTML.includes(m), p.marker);
        record(`${p.name} 包含 ${p.marker} 标记`, docHas, docHas ? 'YES' : 'NO');

        // 检查函数/命名空间：
        //   1) 运行时按点号路径寻址（如 __contentApi.load），函数或对象命名空间均算存在；
        //   2) 兜底匹配源码：function NAME( 声明 或 window.NAME = 赋值（IIFE 内部定义也算）。
        if (p.fnTest.length > 0) {
          const fns = await page.evaluate((names) => {
            const r = {};
            const html = document.documentElement.outerHTML;
            names.forEach(n => {
              let visible = false;
              try {
                let cur = window;
                n.split('.').forEach(seg => { cur = cur == null ? undefined : cur[seg]; });
                visible = (typeof cur === 'function') || (cur !== null && typeof cur === 'object');
              } catch(_) {}
              if (!visible) {
                const esc = n.replace(/[.$]/g, m => '\\' + m);
                visible = new RegExp('function\\s+' + esc + '\\s*\\(').test(html)
                       || new RegExp('window\\.' + esc + '\\s*=').test(html);
              }
              r[n] = visible;
            });
            return r;
          }, p.fnTest);
          const allFn = Object.values(fns).every(Boolean);
          record(`${p.name} 函数齐全 (${p.fnTest.join(',')})`, allFn, JSON.stringify(fns));
        }

        // 检查新增的 console 错误
        const newErrs = consoleErrors.slice(beforeErrCount).filter(e => e.url.includes(p.name));
        record(`${p.name} 无致命 console 错误`, newErrs.length === 0,
          newErrs.length === 0 ? 'OK' : JSON.stringify(newErrs));
      }
    }

    // ===== 7. cast-sheet.html API 测试 =====
    console.log('[7] 切回 cast-sheet.html 做 API 测试');
    await page.goto(`${BASE_URL}/admin/cast-sheet.html`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const apiResult = await page.evaluate(async () => {
      try {
        // access token 优先从独立 storage key 读取，fallback 到 session.token
        let token = localStorage.getItem('qaxqjt_access_token');
        if (!token) {
          const sess = JSON.parse(localStorage.getItem('qaxqjt_admin_session') || '{}');
          token = sess.token || sess.accessToken;
        }
        if (!token) return { err: 'no token in storage' };
        const r = await fetch('/v1/cast-sheets?page=1&pageSize=5', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const j = await r.json();
        return {
          status: r.status,
          ok: j.ok,
          total: j.meta ? j.meta.total : null,
          dataLen: j.data ? j.data.length : 0,
          hasApiObj: typeof window.QAXQJT_API === 'object',
          tokenLen: token.length
        };
      } catch (e) { return { err: e.message }; }
    });
    record('cast-sheets API GET 200', apiResult.status === 200, JSON.stringify(apiResult));

    // ===== 8. 汇总 =====
    console.log('');
    console.log('=== 测试汇总 ===');
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    console.log(`PASS: ${passed}  FAIL: ${failed}  TOTAL: ${results.length}`);
    if (pageErrors.length > 0) {
      console.log('页面 JS 异常:');
      pageErrors.forEach(e => console.log('  ' + e.url + ': ' + e.text));
    }

    await browser.close();
    process.exit(failed === 0 ? 0 : 1);
  } catch (e) {
    console.error('FATAL:', e.stack || e.message);
    try { await browser.close(); } catch (_) {}
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('Unhandled:', e.stack || e.message);
  process.exit(2);
});
