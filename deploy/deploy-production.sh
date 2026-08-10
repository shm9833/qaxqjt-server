#!/usr/bin/env bash
#==============================================================================
# 秦安县秦剧团云端预约系统 - 生产部署一键脚本
#
# 使用方法（在服务器上执行）：
#   chmod +x deploy-production.sh
#   ./deploy-production.sh
#
# 前提：已执行 setup-server.sh 安装好 Node.js + PM2 + Nginx
#        已从 Windows 执行 upload-to-server.ps1 上传代码
#==============================================================================
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

APP_DIR="/home/ubuntu/qaxqjt-server"
LOG_DIR="/home/ubuntu/logs"

#---------- 前置检查 ----------
info "前置检查..."
if [ ! -d "$APP_DIR" ]; then
  error "目录不存在: $APP_DIR"
  echo "请先在 Windows 上执行 upload-to-server.ps1 上传代码"
  exit 1
fi
if ! command -v node &>/dev/null; then
  error "Node.js 未安装，请先执行 setup-server.sh"
  exit 1
fi
if ! command -v pm2 &>/dev/null; then
  error "PM2 未安装，请先执行 setup-server.sh"
  exit 1
fi
info "  Node.js $(node -v) | PM2 $(pm2 -v)"

cd "$APP_DIR"

#---------- 1. 安装依赖 ----------
info "1/7 安装 npm 依赖..."
npm install --omit=dev
info "  依赖安装完成"

#---------- 2. 生成 Prisma Client ----------
info "2/7 生成 Prisma Client..."
npm run prisma:generate
info "  Prisma Client 生成完成"

#---------- 3. 数据库初始化 ----------
info "3/7 初始化数据库..."
# SQLite 模式：直接 db push 创建表结构
npm run prisma:db:push 2>/dev/null || true
# 种子数据（首次部署才需要，重复执行会跳过已有数据）
info "  执行种子数据..."
npm run db:seed 2>/dev/null || warn "  种子数据已存在或跳过（正常）"
info "  数据库初始化完成"

#---------- 4. 生成生产密钥 ----------
info "4/7 检查 JWT 密钥..."
if [ -f ".env" ]; then
  # 检查是否还是默认密钥
  if grep -q "your-super-secret-jwt-access-key" .env 2>/dev/null; then
    warn "  检测到默认 JWT 密钥，正在生成随机密钥..."
    JWT_ACCESS=$(openssl rand -hex 32)
    JWT_REFRESH=$(openssl rand -hex 32)
    sed -i "s|JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=${JWT_ACCESS}|g" .env
    sed -i "s|JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=${JWT_REFRESH}|g" .env
    info "  JWT 密钥已更新为随机值"
  else
    info "  JWT 密钥已配置，跳过"
  fi
else
  error "  .env 文件不存在！"
  exit 1
fi

#---------- 5. PM2 启动 ----------
info "5/7 PM2 启动后端服务..."
# 创建日志目录
mkdir -p "$LOG_DIR"
# 停止旧进程（如有）
pm2 delete qaxqjt-api 2>/dev/null || true
# 启动新进程
pm2 start ecosystem.config.js --env production
pm2 save
info "  PM2 启动完成"

# 设置开机自启
info "  设置开机自启..."
PM2_STARTUP=$(pm2 startup 2>&1 | grep "sudo" | head -1)
if [ -n "$PM2_STARTUP" ]; then
  eval "$PM2_STARTUP" 2>/dev/null || warn "  开机自启需手动执行: $PM2_STARTUP"
  info "  开机自启已配置"
else
  warn "  开机自启需手动配置: pm2 startup"
fi

#---------- 6. 配置 Nginx ----------
info "6/7 配置 Nginx 反向代理..."
NGINX_CONF="/home/ubuntu/nginx-qaxqjt.conf"
if [ -f "$NGINX_CONF" ]; then
  sudo cp "$NGINX_CONF" /etc/nginx/sites-available/qaxqjt
  sudo ln -sf /etc/nginx/sites-available/qaxqjt /etc/nginx/sites-enabled/qaxqjt
  sudo rm -f /etc/nginx/sites-enabled/default
  if sudo nginx -t 2>&1; then
    sudo systemctl restart nginx
    sudo systemctl enable nginx
    info "  Nginx 配置完成并已重启"
  else
    warn "  Nginx 配置测试失败，请检查 /etc/nginx/sites-available/qaxqjt"
  fi
else
  warn "  nginx-qaxqjt.conf 不存在，跳过 Nginx 配置"
fi

#---------- 7. 验证 ----------
info "7/7 验证服务..."
sleep 2

echo ""
echo "---------- 验证结果 ----------"

# 本机直连后端
if curl -sf http://127.0.0.1:3001/v1/healthz | grep -q '"ok"'; then
  info "  [PASS] 后端直连 (3001): healthz OK"
else
  error "  [FAIL] 后端直连 (3001): healthz 无响应"
fi

# Nginx 代理
if curl -sf http://127.0.0.1/api/v1/healthz | grep -q '"ok"'; then
  info "  [PASS] Nginx 代理 (80/api): healthz OK"
else
  warn "  [FAIL] Nginx 代理 (80/api): 可能 Nginx 未配置成功"
fi

# PM2 状态
PM2_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; apps=json.load(sys.stdin); print('online' if any(a['name']=='qaxqjt-api' and a['pm2_env']['status']=='online' for a in apps) else 'offline')" 2>/dev/null || echo "unknown")
if [ "$PM2_STATUS" = "online" ]; then
  info "  [PASS] PM2 进程状态: online"
else
  error "  [FAIL] PM2 进程状态: $PM2_STATUS"
fi

# 公网IP
PUBLIC_IP=$(curl -sf http://ifconfig.me 2>/dev/null || echo "unknown")
if [ "$PUBLIC_IP" != "unknown" ]; then
  if curl -sf "http://${PUBLIC_IP}/api/v1/healthz" | grep -q '"ok"' 2>/dev/null; then
    info "  [PASS] 公网访问 (http://${PUBLIC_IP}/api/v1/healthz): OK"
  else
    warn "  [WARN] 公网访问失败，检查安全组是否放行 80 端口"
  fi
fi

echo "------------------------------"
echo ""
echo "========================================"
echo "  部署完成！"
echo "========================================"
echo "  后端API : http://${PUBLIC_IP}/api/v1/healthz"
echo "  PM2管理 : pm2 status / pm2 logs qaxqjt-api"
echo "  项目目录: $APP_DIR"
echo ""
echo "  下一步："
echo "  1. 上传 _deploy/ 到 EdgeOne Pages"
echo "  2. EdgeOne 回源规则：/api/* → http://${PUBLIC_IP}:80, StripPrefix=/api"
echo "  3. 获取 Pages 域名后，更新 .env CORS_ORIGINS"
echo "  4. pm2 restart qaxqjt-api"
echo "========================================"
echo ""
