# ==============================================================================
# 秦安县秦剧团云端预约系统 · 后端 Dockerfile（Koyeb 免费套餐专用）
# 部署目标：Koyeb Free Tier（Docker 容器 + 持久化存储 SQLite）
# ==============================================================================
FROM node:18-alpine3.19 AS deps
WORKDIR /app

# 装全部依赖（含 prisma CLI），用于生成 Prisma Client
COPY package*.json ./
RUN npm install --no-audit --no-fund

# 生成 Prisma Client（提前生成，运行时无需再次生成）
COPY prisma/ ./prisma/
RUN npx prisma generate

# ==============================================================================
# 运行时
# ==============================================================================
FROM node:18-alpine3.19 AS runtime
WORKDIR /app

# 时区 + 全局安装 prisma CLI（运行时 db push 需要）
RUN apk add --no-cache tzdata curl \
 && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone \
 && npm install -g prisma@5.19.1 --no-audit --no-fund

# 拷贝依赖（含已生成的 Prisma Client）
COPY --from=deps /app/node_modules ./node_modules

# 拷贝源码
COPY src/ ./src/
COPY prisma/ ./prisma/
COPY ecosystem.config.js ./
COPY start-prod.sh ./

# 持久化数据目录（SQLite 数据库放这里）
RUN mkdir -p /app/data /app/logs /app/.tmp-upload

# 给启动脚本执行权限
RUN chmod +x start-prod.sh

# 环境变量
ENV TZ=Asia/Shanghai \
    NODE_ENV=production \
    PORT=3001 \
    DATABASE_URL="file:/app/data/prod.db" \
    JWT_ACCESS_SECRET="qaxqjt-jwt-access-secret-change-in-prod-2026" \
    JWT_REFRESH_SECRET="qaxqjt-jwt-refresh-secret-change-in-prod-2026" \
    CORS_ORIGINS="*" \
    LOG_LEVEL="warn"

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f -s http://127.0.0.1:3001/v1/healthz || exit 1

EXPOSE 3001

# 启动（start-prod.sh 会处理 prisma generate + db push + seed + 启动）
ENTRYPOINT ["sh", "./start-prod.sh"]
