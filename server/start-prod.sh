#!/bin/sh
set -e

echo "============================================"
echo " 秦安县秦剧团云端预约系统 · 启动脚本"
echo " 环境: $NODE_ENV | 端口: $PORT"
echo "============================================"

# 1. 生成 Prisma Client
echo "[1/4] 生成 Prisma Client..."
npx prisma generate

# 2. 数据库表结构同步（prisma db push）
echo "[2/4] 同步数据库表结构..."
npx prisma db push --skip-generate

# 3. 如果数据库为空，执行种子数据
echo "[3/4] 检查并初始化种子数据..."
if [ ! -f /app/data/prod.db ] || [ ! -s /app/data/prod.db ]; then
    echo "  数据库为空，执行种子数据..."
    node -r dotenv/config prisma/seed.js
    echo "  种子数据初始化完成"
else
    echo "  数据库已存在，跳过种子数据"
fi

# 4. 启动服务
echo "[4/4] 启动 API 服务..."
exec node -r dotenv/config src/server.js
