/* simple-server.js — 临时 HTTP 服务器用于测试 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8888;
const BASE_DIR = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

const server = http.createServer((req, res) => {
  let filePath = path.join(BASE_DIR, req.url === '/' ? 'tests/salary-widget-browser-test.html' : req.url);
  
  // 安全检查：防止目录遍历
  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'text/plain';
  
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File not found: ' + req.url);
      } else {
        res.writeHead(500);
        res.end('Server error: ' + err.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`临时测试服务器已启动: http://localhost:${PORT}`);
  console.log(`测试页面: http://localhost:${PORT}/tests/salary-widget-browser-test.html`);
  console.log('按 Ctrl+C 停止服务器');
});
