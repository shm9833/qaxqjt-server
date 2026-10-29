/* browser-verify-salary-widget.js — 浏览器验证灵活薪资配置组件（生产环境）
 * 运行：node browser-verify-salary-widget.js
 */
const { chromium } = require('playwright-core');

const BASE = 'http://1.14.106.173';
const USER = 'admin';
const PASS = process.env.QAXQJT_ADMIN_PASS || (() => { console.error('缺少环境变量 QAXQJT_ADMIN_PASS（后台管理员密码）'); process.exit(1); })();

async function main() {
  const browser = await chromium.launch({ 
    executablePath: 'c:\\Users\\hp\\AppData\\Local\\ms-playwright\\chromium-1187\\chrome-win\\chrome.exe', 
    headless: true, 
    args: ['--no-sandbox'] 
  });
  
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  
  const results = [];
  function report(id, name, pass, detail) {
    results.push({ id, name, pass, detail });
    console.log((pass ? '✅ PASS' : '❌ FAIL') + ' | ' + id + ' ' + name + (detail ? ' | ' + detail : ''));
  }

  try {
    // 1. 登录获取 token
    console.log('正在登录...');
    const lr = await page.request.post(BASE + '/v1/auth/login', { 
      data: { username: USER, password: PASS, captcha: '', captchaId: '' } 
    });
    const loginRes = await lr.json();
    const token = loginRes.data?.accessToken;
    report('A', '登录获取 Token', !!token, token ? 'Token 获取成功' : '登录失败: ' + JSON.stringify(loginRes));
    
    // 2. 注入会话
    await page.goto(BASE + '/admin/login.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ at }) => {
      localStorage.setItem('qaxqjt_access_token', at);
      localStorage.setItem('qaxqjt_current_user', JSON.stringify({ username: 'admin', role: 'super_admin' }));
      localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ 
        id: 's_verify', username: 'admin', role: 'super_admin', 
        expiresAt: Date.now() + 7200000, fromApi: true, token: at 
      }));
    }, { at: token });
    
    // 3. 访问人员管理页面
    console.log('正在访问人员管理页面...');
    await page.goto(BASE + '/admin/staff.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    
    // 4. 切换到工资条 Tab
    console.log('正在切换到工资条 Tab...');
    await page.click('.staff-tab[data-tab="wage"]');
    await page.waitForTimeout(1000);
    
    // 5. 切换到默认日工资规则子 Tab
    console.log('正在查找子 Tab...');
    
    // 先打印所有可用的子 Tab
    const availableTabs = await page.evaluate(() => {
      const tabs = document.querySelectorAll('.wage-subtab, [data-wtab], button[onclick*="rules"]');
      return Array.from(tabs).map(t => ({
        class: t.className,
        dataWtab: t.getAttribute('data-wtab'),
        text: t.textContent.trim(),
        id: t.id
      }));
    });
    console.log('可用的子 Tab:', JSON.stringify(availableTabs, null, 2));
    
    // 尝试多种选择器
    let clicked = false;
    const selectors = [
      '.wage-subtab[data-wtab="rules"]',
      '[data-wtab="rules"]',
      '#wtab-rules',
      'button:has-text("默认日工资规则")',
      'button:has-text("规则")'
    ];
    
    for (const sel of selectors) {
      try {
        await page.click(sel, { timeout: 5000 });
        console.log('成功点击选择器:', sel);
        clicked = true;
        break;
      } catch (e) {
        console.log('选择器失败:', sel);
      }
    }
    
    if (!clicked) {
      // 尝试直接执行脚本切换
      await page.evaluate(() => {
        const tab = document.querySelector('[data-wtab="rules"]') || 
                   document.getElementById('wtab-rules') ||
                   Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('规则'));
        if (tab) tab.click();
      });
    }
    
    await page.waitForTimeout(1500);
    
    // 6. 检查组件 iframe
    const iframeExists = await page.evaluate(() => {
      const iframe = document.getElementById('salaryConfigFrame');
      return iframe ? true : false;
    });
    report('B', '薪资配置组件 iframe 存在', iframeExists, iframeExists ? 'iframe 已找到' : 'iframe 未找到');
    
    // 7. 检查同步按钮
    const syncBtnExists = await page.evaluate(() => {
      const btn = document.getElementById('syncSalaryWidgetBtn');
      return btn ? true : false;
    });
    report('C', '同步按钮存在', syncBtnExists, syncBtnExists ? '按钮已找到' : '按钮未找到');
    
    // 8. 检查新增输入框
    const newInputs = await page.evaluate(() => {
      const social = document.getElementById('wSocial');
      const fund = document.getElementById('wFund');
      return { social: !!social, fund: !!fund };
    });
    report('D', '社保/公积金输入框存在', newInputs.social && newInputs.fund, 
      '社保:' + (newInputs.social ? '✓' : '✗') + ' 公积金:' + (newInputs.fund ? '✓' : '✗'));
    
    // 9. 等待 iframe 加载并检查组件 API
    console.log('正在检查组件 API...');
    await page.waitForTimeout(2000);
    
    const widgetApi = await page.evaluate(() => {
      try {
        const iframe = document.getElementById('salaryConfigFrame');
        if (!iframe || !iframe.contentWindow) return { error: 'iframe 未加载' };
        const widget = iframe.contentWindow.SalaryConfigWidget;
        if (!widget) return { error: '组件未初始化' };
        return {
          version: widget.version,
          hasGetValue: typeof widget.getValue === 'function',
          hasValidate: typeof widget.validate === 'function'
        };
      } catch (e) {
        return { error: e.message };
      }
    });
    
    report('E', '组件 API 可用', widgetApi.hasGetValue && widgetApi.hasValidate, 
      widgetApi.error ? widgetApi.error : '版本: ' + widgetApi.version);
    
    // 10. 测试组件功能
    if (widgetApi.hasGetValue) {
      console.log('正在测试组件功能...');
      const widgetTest = await page.evaluate(() => {
        try {
          const iframe = document.getElementById('salaryConfigFrame');
          const widget = iframe.contentWindow.SalaryConfigWidget;
          const value = widget.getValue();
          const errors = widget.validate();
          return {
            workdays: value.workdays,
            mode: value.mode,
            daily: value.daily,
            monthly: value.monthly,
            extrasCount: Object.keys(value.extras || {}).length,
            hasErrors: errors.length > 0
          };
        } catch (e) {
          return { error: e.message };
        }
      });
      
      report('F', '组件功能正常', !widgetTest.error && widgetTest.workdays > 0,
        widgetTest.error ? widgetTest.error : 
        '工作日: ' + widgetTest.workdays + ', 模式: ' + widgetTest.mode + ', 日工资: ' + widgetTest.daily);
      
      // 11. 测试模式切换（直接打开组件页面）
      console.log('正在测试模式切换...');
      const widgetPage = await ctx.newPage();
      await widgetPage.goto(BASE + '/components/salary-config-widget.html', { waitUntil: 'domcontentloaded' });
      await widgetPage.waitForTimeout(1500);
      
      const switchTest = await widgetPage.evaluate(() => {
        try {
          const widget = window.SalaryConfigWidget;
          if (!widget) return { error: '组件未加载' };
          
          // 初始状态
          const initial = widget.getValue();
          
          // 查找并点击月度切换按钮（button 元素，非 radio input）
          const monthlyBtn = document.querySelector('button[data-mode="monthly"]');
          if (!monthlyBtn) return { error: '未找到月度切换按钮' };
          
          monthlyBtn.click();
          
          return new Promise(resolve => {
            setTimeout(() => {
              const afterSwitch = widget.getValue();
              resolve({
                success: true,
                initialMode: initial.mode,
                newMode: afterSwitch.mode,
                buttonsFound: document.querySelectorAll('.scw-toggle button').length
              });
            }, 600);
          });
        } catch (e) {
          return { error: e.message };
        }
      });
      
      await widgetPage.close();
      
      report('G', '模式切换功能', switchTest.success && (switchTest.newMode === 'monthly' || switchTest.newMode === '按月工资计算'),
        switchTest.error ? switchTest.error : 
        '初始: ' + switchTest.initialMode + ' → 切换后: ' + switchTest.newMode + ' (找到 ' + switchTest.buttonsFound + ' 个切换按钮)');
    }
    
    // 12. 截图保存证据
    await page.screenshot({ path: 'D:\\_deploy\\salary-widget-verify.png', fullPage: false });
    console.log('截图已保存: D:\\_deploy\\salary-widget-verify.png');
    
  } catch (e) {
    console.error('测试执行失败:', e.message);
    report('H', '测试执行', false, e.message);
  }
  
  await browser.close();
  
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log('\n=== 验证结果: ' + passed + '/' + total + ' ===');
  
  if (passed === total) {
    console.log('✅ 所有验证通过！组件部署成功！');
  } else {
    console.log('⚠️ 部分验证失败，请检查上述结果。');
  }
  
  process.exit(passed === total ? 0 : 1);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
