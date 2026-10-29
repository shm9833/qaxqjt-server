/* run-browser-test.js — 自动化运行浏览器验证页面的所有测试 */
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
  // 启动临时 HTTP 服务器
  console.log('启动临时 HTTP 服务器...');
  const serverProcess = spawn('node', ['simple-server.js'], { 
    cwd: __dirname,
    stdio: 'pipe'
  });
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const browser = await chromium.launch({ 
    executablePath: 'c:\\Users\\hp\\AppData\\Local\\ms-playwright\\chromium-1187\\chrome-win\\chrome.exe', 
    headless: true, 
    args: ['--no-sandbox'] 
  });
  
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  
  // 打开测试页面
  const testPageUrl = 'http://localhost:8888/tests/salary-widget-browser-test.html';
  console.log('打开测试页面:', testPageUrl);
  
  await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  
  console.log('等待组件加载...');
  await page.waitForFunction(() => {
    const iframe = document.getElementById('componentFrame');
    return iframe && iframe.contentWindow && iframe.contentWindow.SalaryConfigWidget;
  }, { timeout: 10000 });
  
  console.log('组件已加载，开始运行全部测试...\n');
  
  // 检查页面是否有 JavaScript 错误
  const jsErrors = await page.evaluate(() => {
    return {
      hasJQuery: typeof jQuery !== 'undefined',
      hasErrors: window.errors || [],
      testFunctions: {
        runAllTests: typeof runAllTests,
        runTest: typeof runTest,
        testInit: typeof testInit
      }
    };
  });
  console.log('JavaScript 状态:', JSON.stringify(jsErrors, null, 2));
  
  // 手动触发测试
  console.log('手动触发测试...');
  await page.evaluate(() => {
    try {
      runAllTests();
      return 'success';
    } catch (e) {
      return 'error: ' + e.message;
    }
  });
  
  // 等待测试完成 - 轮询检测
  console.log('等待测试完成...');
  const startTime = Date.now();
  const maxWait = 60000; // 最多等待60秒
  
  while (Date.now() - startTime < maxWait) {
    await page.waitForTimeout(2000);
    
    const progress = await page.evaluate(() => {
      const passCount = document.querySelectorAll('.test-status.pass').length;
      const failCount = document.querySelectorAll('.test-status.fail').length;
      const runningCount = document.querySelectorAll('.test-status.running').length;
      return { passCount, failCount, runningCount, total: passCount + failCount + runningCount };
    });
    
    console.log(`进度: ${progress.passCount} 通过, ${progress.failCount} 失败, ${progress.runningCount} 运行中`);
    
    if (progress.total === 11 && progress.runningCount === 0) {
      console.log('所有测试已完成！\n');
      break;
    }
  }
  
  // 获取测试结果
  const results = await page.evaluate(() => {
    const items = document.querySelectorAll('.test-item');
    const results = [];
    items.forEach(item => {
      const id = item.getAttribute('data-test-id');
      const title = item.querySelector('.test-title')?.textContent.trim();
      const status = item.querySelector('.test-status');
      const detail = item.querySelector('.test-detail');
      
      let statusText = 'unknown';
      let detailText = '';
      
      if (status.classList.contains('pass')) {
        statusText = 'PASS';
        detailText = detail.textContent.trim();
      } else if (status.classList.contains('fail')) {
        statusText = 'FAIL';
        detailText = detail.textContent.trim();
      } else if (status.classList.contains('running')) {
        statusText = 'RUNNING';
      } else {
        statusText = 'PENDING';
      }
      
      results.push({ id, title, status: statusText, detail: detailText });
    });
    
    const stats = {
      total: document.getElementById('statTotal')?.textContent,
      pass: document.getElementById('statPass')?.textContent,
      fail: document.getElementById('statFail')?.textContent,
      rate: document.getElementById('statRate')?.textContent
    };
    
    return { results, stats };
  });
  
  // 输出结果
  console.log('='.repeat(60));
  console.log('测试结果汇总');
  console.log('='.repeat(60));
  console.log(`总测试数: ${results.stats.total}`);
  console.log(`通过: ${results.stats.pass}`);
  console.log(`失败: ${results.stats.fail}`);
  console.log(`通过率: ${results.stats.rate}`);
  console.log('='.repeat(60));
  console.log('');
  
  results.results.forEach(r => {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏳';
    console.log(`${icon} ${r.id} ${r.title}`);
    if (r.detail && r.status !== 'PASS') {
      console.log(`   详情: ${r.detail.substring(0, 150)}`);
    }
  });
  
  console.log('');
  
  // 截图
  await page.screenshot({ path: 'D:\\_deploy\\browser-test-result.png', fullPage: true });
  console.log('截图已保存: D:\\_deploy\\browser-test-result.png');
  
  await browser.close();
  serverProcess.kill();
  
  const passCount = results.results.filter(r => r.status === 'PASS').length;
  const failCount = results.results.filter(r => r.status === 'FAIL').length;
  
  if (failCount === 0 && passCount === results.results.length) {
    console.log('✅ 所有测试通过！');
    process.exit(0);
  } else {
    console.log(`⚠️ 测试完成: ${passCount} 通过, ${failCount} 失败`);
    process.exit(1);
  }
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
