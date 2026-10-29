/* diagnose-widget-visibility.js — 诊断组件在用户界面中的可见性 */
const { chromium } = require('playwright-core');

const BASE = 'http://1.14.106.173';

(async () => {
  const browser = await chromium.launch({ 
    executablePath: 'c:\\Users\\hp\\AppData\\Local\\ms-playwright\\chromium-1187\\chrome-win\\chrome.exe', 
    headless: true, 
    args: ['--no-sandbox'] 
  });
  
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  
  try {
    // 登录
    console.log('正在登录...');
    const lr = await page.request.post(BASE + '/v1/auth/login', { 
      data: { username: 'admin', password: process.env.QAXQJT_ADMIN_PASS || '', captcha: '', captchaId: '' }
    });
    const loginRes = await lr.json();
    const token = loginRes.data?.accessToken;
    
    await page.goto(BASE + '/admin/login.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ at }) => {
      localStorage.setItem('qaxqjt_access_token', at);
      localStorage.setItem('qaxqjt_current_user', JSON.stringify({ username: 'admin', role: 'super_admin' }));
      localStorage.setItem('qaxqjt_admin_session', JSON.stringify({ 
        id: 's_diag', username: 'admin', role: 'super_admin', 
        expiresAt: Date.now() + 7200000, fromApi: true, token: at 
      }));
    }, { at: token });
    
    // 访问人员管理页面
    console.log('正在访问人员管理页面...');
    await page.goto(BASE + '/admin/staff.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    
    // 切换到工资条 Tab
    console.log('正在切换到工资条 Tab...');
    await page.click('.staff-tab[data-tab="wage"]');
    await page.waitForTimeout(1500);
    
    // 切换到默认日工资规则
    console.log('正在切换到默认日工资规则...');
    await page.click('[data-wtab="rules"]');
    await page.waitForTimeout(1500);
    
    // 诊断检查
    console.log('\n=== 诊断检查 ===');
    
    const diagnosis = await page.evaluate(() => {
      const result = {
        // 1. 检查元素是否存在
        elements: {
          salaryConfigFrame: !!document.getElementById('salaryConfigFrame'),
          syncSalaryWidgetBtn: !!document.getElementById('syncSalaryWidgetBtn'),
          wSocial: !!document.getElementById('wSocial'),
          wFund: !!document.getElementById('wFund')
        },
        
        // 2. 检查元素可见性
        visibility: {},
        
        // 3. 检查父容器
        containers: {},
        
        // 4. 检查样式
        styles: {},
        
        // 5. 检查文本内容
        textContent: {
          hasFlexibleSalaryTitle: document.body.textContent.includes('灵活薪资配置')
        }
      };
      
      // 检查每个元素的可见性
      ['salaryConfigFrame', 'syncSalaryWidgetBtn', 'wSocial', 'wFund'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          result.visibility[id] = {
            inViewport: rect.top >= 0 && rect.top < window.innerHeight,
            visible: style.display !== 'none' && style.visibility !== 'hidden',
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity
          };
        }
      });
      
      // 检查父容器
      const frame = document.getElementById('salaryConfigFrame');
      if (frame) {
        let parent = frame.parentElement;
        const parents = [];
        while (parent && parents.length < 5) {
          parents.push({
            tag: parent.tagName,
            id: parent.id,
            class: parent.className,
            display: window.getComputedStyle(parent).display,
            visible: window.getComputedStyle(parent).visibility
          });
          parent = parent.parentElement;
        }
        result.containers.salaryConfigFrameParents = parents;
      }
      
      // 检查包含"灵活薪资配置"的元素
      const allElements = document.querySelectorAll('*');
      for (let el of allElements) {
        if (el.textContent && el.textContent.includes('灵活薪资配置') && el.children.length === 0) {
          result.containers.flexibleSalaryTextElement = {
            tag: el.tagName,
            id: el.id,
            class: el.className,
            display: window.getComputedStyle(el).display,
            visibility: window.getComputedStyle(el).visibility
          };
          break;
        }
      }
      
      return result;
    });
    
    // 输出诊断结果
    console.log('\n1. 元素存在性:');
    for (let [id, exists] of Object.entries(diagnosis.elements)) {
      console.log(`   ${id}: ${exists ? '✅ 存在' : '❌ 不存在'}`);
    }
    
    console.log('\n2. 元素可见性:');
    for (let [id, vis] of Object.entries(diagnosis.visibility)) {
      console.log(`   ${id}:`);
      console.log(`      在视口中: ${vis.inViewport ? '✅' : '❌'}`);
      console.log(`      CSS 可见: ${vis.visible ? '✅' : '❌'}`);
      console.log(`      位置: top=${vis.rect.top}, height=${vis.rect.height}`);
      console.log(`      display: ${vis.display}, visibility: ${vis.visibility}`);
    }
    
    console.log('\n3. 包含"灵活薪资配置"的元素:');
    if (diagnosis.containers.flexibleSalaryTextElement) {
      const el = diagnosis.containers.flexibleSalaryTextElement;
      console.log(`   标签: ${el.tag}`);
      console.log(`   ID: ${el.id || '(无)'}`);
      console.log(`   class: ${el.class}`);
      console.log(`   display: ${el.display}`);
      console.log(`   visibility: ${el.visibility}`);
    } else {
      console.log('   未找到');
    }
    
    console.log('\n4. iframe 父容器链:');
    if (diagnosis.containers.salaryConfigFrameParents) {
      diagnosis.containers.salaryConfigFrameParents.forEach((p, i) => {
        console.log(`   ${i+1}. ${p.tag}${p.id ? '#' + p.id : ''} (display: ${p.display})`);
      });
    }
    
    // 截图
    await page.screenshot({ path: 'D:\\_deploy\\widget-visibility-diagnosis.png', fullPage: true });
    console.log('\n截图已保存: D:\\_deploy\\widget-visibility-diagnosis.png');
    
    // 检查是否需要滚动
    const needsScroll = await page.evaluate(() => {
      const frame = document.getElementById('salaryConfigFrame');
      if (!frame) return { needsScroll: false, reason: 'element not found' };
      
      const rect = frame.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      
      return {
        needsScroll: rect.top > windowHeight,
        elementTop: rect.top,
        windowHeight: windowHeight,
        scrollY: window.scrollY,
        pageHeight: document.body.scrollHeight
      };
    });
    
    console.log('\n5. 滚动检查:');
    console.log(`   需要滚动: ${needsScroll.needsScroll ? '是' : '否'}`);
    console.log(`   元素位置: ${needsScroll.elementTop}px`);
    console.log(`   视口高度: ${needsScroll.windowHeight}px`);
    console.log(`   当前滚动: ${needsScroll.scrollY}px`);
    console.log(`   页面总高: ${needsScroll.pageHeight}px`);
    
    if (needsScroll.needsScroll) {
      console.log('\n⚠️ 组件在视口下方，需要滚动才能看到！');
    }
    
  } catch (e) {
    console.error('诊断失败:', e.message);
  }
  
  await browser.close();
})();
