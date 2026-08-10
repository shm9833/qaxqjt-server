#!/usr/bin/env bash
#==============================================================================
# 秦安县秦剧团云端预约系统 - Linux 服务器一键环境安装
#
# 使用方法：
#   1. SSH 登录服务器
#   2. 上传此脚本到服务器：scp deploy/setup-server.sh ubuntu@IP:~/
#   3. 执行：chmod +x setup-server.sh && ./setup-server.sh
#
# 适用系统：Ubuntu 22.04 LTS / 20.04 LTS
#==============================================================================
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }

#---------- 1. 系统更新 ----------
info "1/6 系统更新..."
sudo apt update && sudo apt upgrade -y

#---------- 2. 安装 Node.js 18 ----------
info "2/6 安装 Node.js 18..."
if command -v node &>/dev/null && [[ "$(node -v)" == v18.* ]]; then
  info "  Node.js 18 已安装: $(node -v)"
else
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt install -y nodejs
  info "  Node.js 安装完成: $(node -v)"
fi

#---------- 3. 安装 PM2 ----------
info "3/6 安装 PM2..."
if command -v pm2 &>/dev/null; then
  info "  PM2 已安装: $(pm2 -v)"
else
  sudo npm install -g pm2
  info "  PM2 安装完成: $(pm2 -v)"
fi

#---------- 4. 安装 Nginx ----------
info "4/6 安装 Nginx..."
if command -v nginx &>/dev/null; then
  info "  Nginx 已安装: $(nginx -v 2>&1)"
else
  sudo apt install -y nginx
  info "  Nginx 安装完成: $(nginx -v 2>&1)"
fi

#---------- 5. 创建项目目录 ----------
info "5/6 创建项目目录..."
mkdir -p /home/ubuntu/qaxqjt-server
mkdir -p /home/ubuntu/logs

#---------- 6. 防火墙放行端口 ----------
info "6/6 配置防火墙..."
sudo ufw allow 22/tcp    >/dev/null 2>&1 || true
sudo ufw allow 80/tcp    >/dev/null 2>&1 || true
sudo ufw allow 443/tcp   >/dev/null 2>&1 || true
sudo ufw allow 3001/tcp  >/dev/null 2>&1 || true
warn "  如 ufw 未启用，可忽略防火墙提示"

#---------- 验证 ----------
echo ""
echo "========================================"
echo "  环境安装完成！版本信息："
echo "========================================"
echo "  Node.js : $(node -v)"
echo "  npm     : $(npm -v)"
echo "  PM2     : $(pm2 -v)"
echo "  Nginx   : $(nginx -v 2>&1)"
echo "========================================"
echo ""
echo "下一步：在 Windows 上执行 upload-to-server.ps1 上传后端代码"
echo ""
