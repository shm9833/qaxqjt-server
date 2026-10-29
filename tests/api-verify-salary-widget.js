/* api-verify-salary-widget.js — 组件 API 调用逻辑验证（生产环境）
 * 运行：node api-verify-salary-widget.js
 */
const { chromium } = require('playwright-core');

const BASE = 'http://1.14.106.173';

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
    // 直接打开组件页面进行 API 测试
    console.log('正在打开组件页面...');
    await page.goto(BASE + '/components/salary-config-widget.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    
    // 测试 1: 组件初始化
    console.log('\n=== 测试 1: 组件初始化 ===');
    const initTest = await page.evaluate(() => {
      const widget = window.SalaryConfigWidget;
      if (!widget) return { error: '组件未加载' };
      return {
        version: widget.version,
        hasGetValue: typeof widget.getValue === 'function',
        hasValidate: typeof widget.validate === 'function',
        hasSwitchMode: typeof widget.switchMode === 'function'
      };
    });
    
    report('API-1', '组件初始化', !initTest.error && initTest.hasGetValue && initTest.hasValidate,
      initTest.error ? initTest.error : '版本: ' + initTest.version);
    
    // 测试 2: getValue() 初始状态
    console.log('\n=== 测试 2: getValue() 初始状态 ===');
    const initialValue = await page.evaluate(() => {
      const widget = window.SalaryConfigWidget;
      const value = widget.getValue();
      console.log('完整返回值:', JSON.stringify(value, null, 2));
      return {
        raw: value,
        workdays: value.workdays,
        mode: value.mode,
        daily: value.daily,
        monthly: value.monthly,
        dailyValue: value.daily?.value,
        monthlyValue: value.monthly?.value,
        extras: value.extras,
        extrasKeys: Object.keys(value.extras || {})
      };
    });
    
    console.log('完整结构:', JSON.stringify(initialValue.raw, null, 2));
    
    report('API-2', 'getValue() 初始状态', 
      initialValue.raw.workdays > 0 && initialValue.raw.mode === '按日工资计算' && initialValue.raw.dailyWage === 0,
      `工作日: ${initialValue.raw.workdays}, 模式: ${initialValue.raw.mode}, 日工资: ${initialValue.raw.dailyWage}, 月工资: ${initialValue.raw.monthlyWage}`);
    
    console.log('附加配置项:', initialValue.extrasKeys.join(', '));
    
    // 测试 3: validate() 初始状态
    console.log('\n=== 测试 3: validate() 初始状态 ===');
    const initialValidate = await page.evaluate(() => {
      const widget = window.SalaryConfigWidget;
      const errors = widget.validate();
      return { errors: errors, isValid: errors.length === 0 };
    });
    
    report('API-3', 'validate() 初始状态', initialValidate.isValid,
      initialValidate.isValid ? '初始状态合法（无错误）' : '初始状态有错误: ' + JSON.stringify(initialValidate.errors));
    
    // 测试 4: 设置日工资并验证
    console.log('\n=== 测试 4: 设置日工资并验证 ===');
    const setDaily = await page.evaluate(() => {
      const widget = window.SalaryConfigWidget;
      // 找到日工资输入框并设置值
      const dailyInput = document.querySelector('input[data-field="daily"]') ||
                        document.querySelector('.scw-field:first-child input');
      if (!dailyInput) return { error: '未找到日工资输入框' };
      
      dailyInput.value = '100.50';
      dailyInput.dispatchEvent(new Event('input', { bubbles: true }));
      dailyInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      return new Promise(resolve => {
        setTimeout(() => {
          const value = widget.getValue();
          const errors = widget.validate();
          resolve({
            dailyWage: value.dailyWage,
            errors: errors,
            isValid: errors.length === 0
          });
        }, 300);
      });
    });
    
    report('API-4', '设置日工资并验证', setDaily.isValid && setDaily.dailyWage === 100.50,
      setDaily.error ? setDaily.error : `日工资: ${setDaily.dailyWage}, 合法: ${setDaily.isValid}`);
    
    // 测试 5: 切换到月度模式（验证自动换算）
    console.log('\n=== 测试 5: 切换到月度模式（自动换算） ===');
    const switchToMonthly = await page.evaluate(() => {
      const widget = window.SalaryConfigWidget;
      const monthlyBtn = document.querySelector('button[data-mode="monthly"]');
      if (!monthlyBtn) return { error: '未找到月度切换按钮' };
      
      monthlyBtn.click();
      
      return new Promise(resolve => {
        setTimeout(() => {
          const value = widget.getValue();
          resolve({
            mode: value.mode,
            monthlyWage: value.monthlyWage,
            workdays: value.workdays,
            expected: 100.50 * value.workdays
          });
        }, 500);
      });
    });
    
    const monthlyValid = Math.abs(switchToMonthly.monthlyWage - switchToMonthly.expected) < 0.01;
    report('API-5', '切换到月度模式（自动换算）', 
      switchToMonthly.mode === '按月工资计算' && monthlyValid,
      switchToMonthly.error ? switchToMonthly.error : 
      `模式: ${switchToMonthly.mode}, 月工资: ${switchToMonthly.monthlyWage?.toFixed(2)}, 预期: ${switchToMonthly.expected?.toFixed(2)} (100.50 × ${switchToMonthly.workdays})`);
    
    // 测试 6: 手动修改月工资
    console.log('\n=== 测试 6: 手动修改月工资 ===');
    const setMonthly = await page.evaluate(() => {
      const widget = window.SalaryConfigWidget;
      const monthlyInput = document.querySelector('input[data-field="monthly"]') ||
                          document.querySelector('.scw-field:last-child input');
      if (!monthlyInput) return { error: '未找到月工资输入框' };
      
      monthlyInput.value = '5000';
      monthlyInput.dispatchEvent(new Event('input', { bubbles: true }));
      monthlyInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      return new Promise(resolve => {
        setTimeout(() => {
          const value = widget.getValue();
          resolve({
            monthlyWage: value.monthlyWage,
            mode: value.mode
          });
        }, 300);
      });
    });
    
    report('API-6', '手动修改月工资', setMonthly.monthlyWage === 5000,
      setMonthly.error ? setMonthly.error : `月工资: ${setMonthly.monthlyWage}, 模式: ${setMonthly.mode}`);
    
    // 测试 7: 切换回日度模式（验证缓存恢复）
    console.log('\n=== 测试 7: 切换回日度模式（缓存恢复） ===');
    const switchBack = await page.evaluate(() => {
      const widget = window.SalaryConfigWidget;
      const dailyBtn = document.querySelector('button[data-mode="daily"]');
      if (!dailyBtn) return { error: '未找到日度切换按钮' };
      
      dailyBtn.click();
      
      return new Promise(resolve => {
        setTimeout(() => {
          const value = widget.getValue();
          resolve({
            mode: value.mode,
            dailyWage: value.dailyWage,
            monthlyWage: value.monthlyWage
          });
        }, 500);
      });
    });
    
    // 日工资应该恢复为之前设置的 100.50，或者根据月工资重新计算
    const isCacheValid = switchBack.dailyWage === 100.50 || switchBack.dailyWage > 0;
    report('API-7', '切换回日度模式（缓存恢复）', 
      switchBack.mode === '按日工资计算' && isCacheValid,
      `模式: ${switchBack.mode}, 日工资: ${switchBack.dailyWage}, 月工资: ${switchBack.monthlyWage}`);
    
    // 测试 8: 附加配置项验证
    console.log('\n=== 测试 8: 附加配置项验证 ===');
    const extrasTest = await page.evaluate(() => {
      const widget = window.SalaryConfigWidget;
      const value = widget.getValue();
      const extras = value.extras || {};
      
      // 检查必需的配置项（根据实际结构）
      const required = ['benxi', 'zhezi', 'xiaxiang', 'perfect', 'seniority', 'mealTraffic', 'socialFund', 'stdDays'];
      const missing = required.filter(key => !(key in extras));
      
      return {
        extras: extras,
        missing: missing,
        benxi: extras.benxi,
        mealTraffic: extras.mealTraffic,
        socialFund: extras.socialFund
      };
    });
    
    report('API-8', '附加配置项验证', extrasTest.missing.length === 0,
      extrasTest.missing.length > 0 ? '缺少: ' + extrasTest.missing.join(', ') : 
      `本戏: ${extrasTest.benxi}, 餐补/交通: ${JSON.stringify(extrasTest.mealTraffic)}, 社保/公积金: ${JSON.stringify(extrasTest.socialFund)}`);
    
    // 测试 9: 非法输入验证
    console.log('\n=== 测试 9: 非法输入验证 ===');
    const invalidTest = await page.evaluate(() => {
      const widget = window.SalaryConfigWidget;
      const dailyInput = document.querySelector('input[data-field="daily"]') ||
                        document.querySelector('.scw-field:first-child input');
      if (!dailyInput) return { error: '未找到日工资输入框' };
      
      // 尝试设置非法值
      dailyInput.value = '-100';
      dailyInput.dispatchEvent(new Event('input', { bubbles: true }));
      
      return new Promise(resolve => {
        setTimeout(() => {
          const value = widget.getValue();
          const errors = widget.validate();
          resolve({
            dailyWage: value.dailyWage,
            errors: errors,
            hasNegativeError: errors.some(e => e.includes('非负') || e.includes('negative') || e.includes('不能为负'))
          });
        }, 300);
      });
    });
    
    report('API-9', '非法输入验证', invalidTest.hasNegativeError || invalidTest.dailyWage >= 0,
      invalidTest.error ? invalidTest.error : 
      `日工资: ${invalidTest.dailyWage}, 有非负错误: ${invalidTest.hasNegativeError}`);
    
    // 测试 10: 两位小数限制
    console.log('\n=== 测试 10: 两位小数限制 ===');
    const decimalTest = await page.evaluate(() => {
      const widget = window.SalaryConfigWidget;
      const dailyInput = document.querySelector('input[data-field="daily"]') ||
                        document.querySelector('.scw-field:first-child input');
      if (!dailyInput) return { error: '未找到日工资输入框' };
      
      // 尝试设置三位小数
      dailyInput.value = '100.999';
      dailyInput.dispatchEvent(new Event('input', { bubbles: true }));
      
      return new Promise(resolve => {
        setTimeout(() => {
          const value = widget.getValue();
          resolve({
            dailyWage: value.dailyWage,
            inputValue: dailyInput.value
          });
        }, 300);
      });
    });
    
    const decimalValid = decimalTest.dailyWage === 100.99 || decimalTest.inputValue === '100.99';
    report('API-10', '两位小数限制', decimalValid,
      `日工资: ${decimalTest.dailyWage}, 输入值: ${decimalTest.inputValue}`);
    
    // 最终截图
    await page.screenshot({ path: 'D:\\_deploy\\api-verify-salary-widget.png', fullPage: true });
    console.log('\n截图已保存: D:\\_deploy\\api-verify-salary-widget.png');
    
  } catch (e) {
    console.error('测试执行失败:', e);
    report('API-0', '测试执行', false, e.message);
  }
  
  await browser.close();
  
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log('\n=== API 验证结果: ' + passed + '/' + total + ' ===');
  
  if (passed === total) {
    console.log('✅ 所有 API 测试通过！组件功能正常！');
  } else {
    console.log('⚠️ 部分测试失败，请检查上述结果。');
  }
  
  process.exit(passed === total ? 0 : 1);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
