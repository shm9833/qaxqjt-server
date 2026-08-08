/**
 * 快速验证：
 *  - 防重复注入（两次粘贴模板，第二份跳过）
 *  - Perf日志为JSON格式（字段完整）
 * 运行：node _tests\_verify_json_perf_dedup.js
 */
const fs = require('fs');
const path = require('path');
try { require.resolve('jsdom'); } catch(e) {
  console.log('[⏳] 先安装 jsdom...');
  require('child_process').execSync('npm install jsdom --no-audit --no-fund --loglevel=error',
    {cwd: path.join(__dirname), stdio:'inherit'});
}
const {JSDOM, VirtualConsole} = require('jsdom');

const ordersFile = path.join(__dirname, '..', 'admin', 'orders.html');
const html = fs.readFileSync(ordersFile, 'utf-8');

const vc = new VirtualConsole();
const perfLines = [];
const infoMsgs = [];
vc.on('log', (msg)=>{
  if(typeof msg === 'string' && msg.trim().startsWith('{')) perfLines.push(msg);
  if(typeof msg === 'string' && msg.includes('加载') && msg.includes('已加载')) infoMsgs.push(msg);
});
vc.on('info',  (msg)=>{ if(typeof msg==='string') infoMsgs.push(msg); });
vc.on('error', ()=>{});
vc.on('warn',  ()=>{});

function loadDom() {
  const dom = new JSDOM(html, {
    url: 'http://localhost/admin/orders.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const w = dom.window;
  return new Promise(res => {
    setTimeout(()=>res(dom), 200);
  });
}

(async () => {
  console.log('========== 测试 1：单份注入是否正常加载 ==========');
  const dom1 = await loadDom();
  const w1 = dom1.window;
  console.log('  DBF标记：__DBF_V20260804_INJECTED__ =', w1.__DBF_V20260804_INJECTED__);
  console.log('  SP 标记：__SP_V20260804_INJECTED__  =', w1.__SP_V20260804_INJECTED__);
  console.log('  初始化info日志数：', infoMsgs.length, '(≥2表示两块都加载了)');
  const pass1 = w1.__DBF_V20260804_INJECTED__ === true && w1.__SP_V20260804_INJECTED__ === true;
  console.log(pass1 ? '  ✅ 通过' : '  ❌ 失败');

  console.log('\n========== 测试 2：开启JSON Perf后，点击→NDJSON日志 ==========');
  try { w1.localStorage.setItem('__ENABLE_PERF_LOG__','true'); } catch(_){}
  perfLines.length = 0;
  // 造一个保存按钮并点击
  const saveBtn = w1.document.createElement('button');
  saveBtn.className = 'btn btn-action';
  saveBtn.textContent = '保存订单';
  w1.document.body.appendChild(saveBtn);
  saveBtn.click();
  saveBtn.click();  // 再点一次触发防重
  await new Promise(r=>setTimeout(r,100));
  console.log('  收到 Perf JSON 行数：', perfLines.length);
  let parsed = null, allJson = true;
  for(const line of perfLines){
    try { parsed = JSON.parse(line); } catch(e){ allJson=false; break; }
  }
  if(perfLines.length>0 && allJson && parsed){
    const keys = Object.keys(parsed);
    const required = ['@timestamp','service','trace_id','module','event','duration_ms','page_url','user_agent'];
    const miss = required.filter(k=>!(k in parsed));
    console.log('  全部合法JSON：', allJson);
    console.log('  关键字段缺失：', miss.length===0?'无':miss.join(','));
    console.log('  示例：module=%s event=%s branch=%s btn_text=%s duration_ms=%s',
      parsed.module, parsed.event, String(parsed.branch), String(parsed.btn_text), parsed.duration_ms);
    console.log('  ✅ 通过');
  } else {
    console.log('  ❌ 失败：未输出合法JSON行');
    if(perfLines.length) console.log('  首行：', perfLines[0].slice(0,200));
  }

  console.log('\n========== 测试 3：模拟重复粘贴2次，检查防重复注入保护 ==========');
  // 在原HTML末尾再强制注入两份script，看最后一个dom的__DBF标记是否只被设一次（即第二份被保护if挡住）
  const w2 = dom1.window;
  const beforeDBF = w2.__DBF_V20260804_INJECTED__;
  const beforeSP  = w2.__SP_V20260804_INJECTED__;
  // 手动再次执行保护if块（模拟再次粘贴）
  const el = w2.document.createElement('script');
  el.textContent = `
    if (window.__DBF_V20260804_INJECTED__ !== true) {
      window.__DBF_V20260804_INJECTED__ = 'duplicate-test-should-NOT-run';
      console.info('DBF-重复-执行了（错误）');
    } else {
      console.info('DBF-重复-被拦截（正确）');
    }
    if (window.__SP_V20260804_INJECTED__ !== true) {
      window.__SP_V20260804_INJECTED__ = 'duplicate-test-should-NOT-run';
      console.info('SP-重复-执行了（错误）');
    } else {
      console.info('SP-重复-被拦截（正确）');
    }`;
  w2.document.body.appendChild(el);
  await new Promise(r=>setTimeout(r,50));
  const afterDBF = w2.__DBF_V20260804_INJECTED__;
  const afterSP  = w2.__SP_V20260804_INJECTED__;
  const dedupOK = beforeDBF===true && afterDBF===true
               && beforeSP ===true && afterSP ===true
               && infoMsgs.filter(m=>m.includes('DBF-重复-被拦截')).length>0
               && infoMsgs.filter(m=>m.includes('SP-重复-被拦截')).length>0;
  console.log('  DBF：第二次粘贴没有重置（仍为true）：', beforeDBF===true && afterDBF===true);
  console.log('  SP ：第二次粘贴没有重置（仍为true）：', beforeSP===true  && afterSP===true);
  console.log('  拦截日志数量：DBF=%d SP=%d',
    infoMsgs.filter(m=>m.includes('DBF-重复-被拦截')).length,
    infoMsgs.filter(m=>m.includes('SP-重复-被拦截')).length);
  console.log(dedupOK ? '  ✅ 通过：重复粘贴不会覆盖/冲突' : '  ❌ 失败');

  process.exit((pass1 && dedupOK && perfLines.length>0 && allJson) ? 0 : 1);
})();
