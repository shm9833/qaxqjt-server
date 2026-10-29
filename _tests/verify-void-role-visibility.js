/* ============================================================
 * 四角色作废按钮可见性验证 —— 生产 http://1.14.106.173/admin/finance.html
 * 方法：API 真实登录 admin 获取 token；为 4 个角色各建 context，
 *       addInitScript 同时注入三键（修复上轮 401 踢回 login 的根因）：
 *         qaxqjt_admin_session  (role 按用例替换)
 *         qaxqjt_access_token   (真实 Bearer，API 层鉴权用)
 *         qaxqjt_current_user   (与真实登录结构一致)
 * 预期：super_admin / finance_admin → voidBtns === checkedRows(=2)
 *       ops / finance_maker → voidBtns === 0 且 checkedRows > 0（证明非空表假阴性）
 * ============================================================ */
'use strict';
const http = require('http');
const { chromium } = require('playwright-core');

const HOST = '1.14.106.173';
const FIN_URL = 'http://' + HOST + '/admin/finance.html';
const CHROMIUM_EXE = 'c:\\Users\\hp\\AppData\\Local\\ms-playwright\\chromium-1187\\chrome-win\\chrome.exe';
const USERNAME = 'admin';
const PASSWORD = process.env.QAXQJT_ADMIN_PASS || (() => { console.error('缺少环境变量 QAXQJT_ADMIN_PASS（后台管理员密码）'); process.exit(1); })();

const CASES = [
  { role: 'super_admin',   expectBtn: true  },
  { role: 'finance_admin', expectBtn: true  },
  { role: 'ops',           expectBtn: false },
  { role: 'finance_maker', expectBtn: false }
];

function apiLogin() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ username: USERNAME, password: PASSWORD });
    const req = http.request({
      host: HOST, port: 80, path: '/api/v1/auth/login', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'qaxqjt-void-role-verify/1.0'
      },
      timeout: 15000
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(raw);
          if (res.statusCode === 200 && j && j.data && j.data.accessToken) return resolve(j.data);
          reject(new Error('HTTP ' + res.statusCode + ' ' + raw.slice(0, 300)));
        } catch (e) { reject(new Error('parse fail: ' + raw.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout 15s')); });
    req.write(body);
    req.end();
  });
}

async function testRole(browser, realUser, token, refreshToken, c) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const session = {
    id: 'verify-void-' + c.role + '-' + Date.now(),
    username: realUser.username || USERNAME,
    name: realUser.realName || realUser.name || realUser.username || USERNAME,
    role: c.role,
    roleName: c.role,
    loginAt: Date.now(),
    expiresAt: Date.now() + 2 * 3600 * 1000,
    fromApi: true,
    forcePwdChange: false
  };
  const userObj = Object.assign({}, realUser, { role: c.role });
  await ctx.addInitScript(function (arg) {
    try {
      localStorage.setItem('qaxqjt_admin_session', JSON.stringify(arg.session));
      localStorage.setItem('qaxqjt_access_token', arg.token);
      if (arg.refreshToken) localStorage.setItem('qaxqjt_refresh_token', arg.refreshToken);
      localStorage.setItem('qaxqjt_current_user', JSON.stringify(arg.user));
    } catch (e) { /* noop */ }
  }, { session: session, token: token, refreshToken: refreshToken, user: userObj });

  const page = await ctx.newPage();
  const result = {
    role: c.role, expectBtn: c.expectBtn,
    voidBtns: -1, checkedRows: 0, totalRows: 0, voucherIds: [],
    url: '', redirected: false, error: null
  };
  try {
    await page.goto(FIN_URL, { waitUntil: 'commit', timeout: 60000 });
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(1000);
      const u = page.url();
      if (u.indexOf('finance.html') < 0) { result.redirected = true; result.url = u; break; }
      try {
        const stat = await page.evaluate(function () {
          const tbody = document.getElementById('finLedgerTbody')
            || (document.querySelectorAll('.table-wrapper tbody')[0]);
          if (!tbody) return null;
          const rows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-id]'));
          return {
            totalRows: rows.length,
            voucherIds: rows.map(function (tr) {
              const el = tr.querySelector('.stat-voucher-id');
              return el ? el.textContent.trim() : '';
            }),
            checkedRows: rows.filter(function (tr) {
              return !!tr.querySelector('.status-badge.checked');
            }).length,
            voidBtns: tbody.querySelectorAll('.__fin-void').length
          };
        });
        if (stat && stat.totalRows > 0) {
          Object.assign(result, stat, { url: u });
          break;
        }
        if (i === 24) { result.url = u; result.error = 'NO_ROWS_TIMEOUT'; }
      } catch (e) { /* execution context destroyed during navigation — retry */ }
    }
  } catch (e) {
    result.error = 'GOTO: ' + (e.message || e);
  }
  await ctx.close();
  return result;
}

(async () => {
  let data;
  try {
    data = await apiLogin();
  } catch (e) {
    console.error('FATAL apiLogin: ' + e.message);
    process.exit(2);
  }
  const token = data.accessToken;
  const refreshToken = data.refreshToken || '';
  const realUser = data.user || {};
  console.log('login ok: user=' + (realUser.username || USERNAME)
    + ' role=' + (realUser.role || '?')
    + ' token=' + String(token).slice(0, 12) + '...');

  const browser = await chromium.launch({ executablePath: CHROMIUM_EXE, headless: true });
  const results = [];
  for (const c of CASES) {
    const r = await testRole(browser, realUser, token, refreshToken, c);
    results.push(r);
    console.log('[' + r.role + '] done: voidBtns=' + r.voidBtns
      + ' checkedRows=' + r.checkedRows + ' totalRows=' + r.totalRows
      + (r.redirected ? ' REDIRECTED->' + r.url : '')
      + (r.error ? ' ERR=' + r.error : ''));
  }
  await browser.close();

  console.log('\n===== RESULT =====');
  let pass = 0;
  for (const r of results) {
    const ok = r.expectBtn
      ? (r.voidBtns > 0 && r.voidBtns === r.checkedRows)
      : (r.voidBtns === 0 && r.checkedRows > 0);
    if (ok) pass++;
    console.log('[' + r.role + '] expectBtn=' + r.expectBtn
      + ' → voidBtns=' + r.voidBtns
      + ' | checkedRows=' + r.checkedRows
      + ' | vouchers=' + JSON.stringify(r.voucherIds)
      + ' | ' + (r.redirected ? 'REDIRECTED ' + r.url : (r.error || 'ok'))
      + ' | ' + (ok ? 'PASS' : 'FAIL'));
  }
  console.log('\nTOTAL: ' + pass + '/' + results.length + ' PASS');
  process.exit(pass === results.length ? 0 : 1);
})();
