'use strict';

const http = require('http');

function getDynamicPassword() {
  const now = new Date();
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
  const suffix = now.getFullYear().toString() + pad2(now.getMonth()+1) + pad2(now.getDate()) + pad2(now.getHours());
  return 'Qaxqjt@' + suffix + '!';
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, raw: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const dynPwd = getDynamicPassword();
  console.log('🔑 当前小时动态密码:', dynPwd);
  console.log('');

  const tests = [
    { name: '路径 /api/v1/auth/login + 动态密码', path: '/api/v1/auth/login', body: { username: 'admin', password: dynPwd } },
    { name: '路径 /v1/auth/login + 动态密码',     path: '/v1/auth/login',      body: { username: 'admin', password: dynPwd } },
    { name: '路径 /api/v1/auth/login + 固定密码', path: '/api/v1/auth/login', body: { username: 'admin', password: 'ChangeMe123!' } },
    { name: '路径 /v1/auth/login + 固定密码',     path: '/v1/auth/login',      body: { username: 'admin', password: 'ChangeMe123!' } },
    { name: '路径 /api/v1/auth/login + 错误密码', path: '/api/v1/auth/login', body: { username: 'admin', password: 'WrongPassword' } },
  ];

  for (const t of tests) {
    try {
      const r = await post(t.path, t.body);
      const hasToken = r.data && r.data && r.data.data && r.data.data.accessToken;
      const ok = r.data && (r.data.ok === true) && (r.status === 200);
      console.log(`${ok ? '✅' : '❌'} ${t.name}`);
      console.log(`   HTTP ${r.status}  data.ok=${r.data && r.data.ok}  msg=${r.data && r.data.msg}`);
      if (hasToken) console.log(`   accessToken 已返回 (长度=${r.data.data.accessToken.length})`);
      if (!ok) console.log(`   响应体: ${JSON.stringify(r.data).slice(0, 200)}`);
    } catch (e) {
      console.log(`💥 ${t.name} 异常: ${e.message}`);
    }
    console.log('');
  }

  // 测试健康检查
  const healthz = await new Promise(resolve => {
    http.get('http://127.0.0.1:3001/v1/healthz', (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', e => resolve({ error: e.message }));
  });
  console.log('🩺 /v1/healthz:', healthz.status === 200 ? '✅ 正常' : '❌ 失败', healthz.status, healthz.body ? healthz.body.slice(0, 100) : '');
})();
