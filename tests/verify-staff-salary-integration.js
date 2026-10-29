/* verify-staff-salary-integration.js — 人员管理页灵活薪资组件集成静态验证 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const FILE = 'file:///' + path.resolve(__dirname, '..', 'admin', 'staff.html').replace(/\\/g, '/');
const COMPONENT = 'file:///' + path.resolve(__dirname, '..', 'components', 'salary-config-widget.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'c:\\Users\\hp\\AppData\\Local\\ms-playwright\\chromium-1187\\chrome-win\\chrome.exe',
    headless: true, args: ['--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // 静态断言：staff.html 包含 iframe 与同步按钮
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'admin', 'staff.html'), 'utf8');
  const checks = [
    ['iframe 存在', html.includes('id="salaryConfigFrame"') && html.includes('salary-config-widget.html')],
    ['同步按钮存在', html.includes('id="syncSalaryWidgetBtn"')],
    ['同步脚本存在', html.includes('syncSalaryWidgetBtn') && html.includes('SalaryConfigWidget.getValue')],
    ['社保输入框存在', html.includes('id="wSocial"') && html.includes('data-wkey="socialInsuranceRate"')],
    ['公积金输入框存在', html.includes('id="wFund"') && html.includes('data-wkey="housingFundRate"')],
  ];
  checks.forEach(([name, ok]) => console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name));

  // 动态验证：加载 staff.html，检查 iframe 是否成功加载组件
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  // 检查 iframe 是否存在（即使其他 JS 报错，iframe 标签本身应该渲染）
  const iframe = await page.$('#salaryConfigFrame');
  const iframeOk = !!iframe;
  console.log((iframeOk ? 'PASS' : 'FAIL') + ' | iframe 元素存在于 DOM');

  // 检查 iframe src 是否正确
  const src = iframe ? await iframe.getAttribute('src') : null;
  const srcOk = src && src.indexOf('salary-config-widget.html') >= 0;
  console.log((srcOk ? 'PASS' : 'FAIL') + ' | iframe src=' + src);

  // 检查同步按钮是否存在
  const btn = await page.$('#syncSalaryWidgetBtn');
  const btnOk = !!btn;
  console.log((btnOk ? 'PASS' : 'FAIL') + ' | 同步按钮存在于 DOM');

  // 检查新增输入框是否存在
  const wSocial = await page.$('#wSocial');
  const wFund = await page.$('#wFund');
  console.log(((wSocial && wFund) ? 'PASS' : 'FAIL') + ' | wSocial/wFund 输入框存在');

  // 加载组件页确认可独立运行
  await page.goto(COMPONENT, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const api = await page.evaluate(() => typeof window.SalaryConfigWidget);
  console.log((api === 'object' ? 'PASS' : 'FAIL') + ' | 组件独立运行 API 正常');

  await browser.close();
  const passCount = checks.filter(c => c[1]).length + (iframeOk && srcOk && btnOk && wSocial && wFund && api === 'object' ? 6 : 0);
  console.log('=== ' + passCount + '/' + (checks.length + 6) + ' ===');
  process.exit(passCount === checks.length + 6 ? 0 : 1);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
