# ==============================================================================
# 秦安县秦剧团云端预约系统 · Node.js 18 LTS Dockerfile
# 对应文档：F-1 §一 推荐栈 Node.js 18 + Express + MySQL 8
# M-8 PM2 进程守护集群模式
# ==============================================================================
FROM node:18-alpine3.19 AS deps
LABEL maintainer="秦安县秦剧团云端运维 <ops@yourdomain.cn>"
LABEL version="V2026.8.3"
LABEL description="Qin'an County Qin Opera Troupe Cloud Booking System Backend"

# -- M-14 安全：非 root 用户运行 --
RUN addgroup -g 1001 -S appuser \
 && adduser  -u 1001 -S appuser -G appuser

# -- 依赖包：curl(健康检查) / tini(僵尸进程收割) / tzdata(时区) --
RUN apk add --no-cache curl tini tzdata \
 && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone

WORKDIR /app

# -- 依赖分层缓存：先装 package.json 依赖 --
COPY package*.json ./

# M-4 文件上传 / M-11 备份运行时目录（启动前创建）
RUN mkdir -p /app/.tmp-upload /app/local-backup /app/logs \
 && chown -R appuser:appuser /app \
 && npm install --omit=dev --no-audit --no-fund --ignore-scripts

# ==============================================================================
# 构建层（若用 TS 可 npm run build，此处原生 JS 直接 COPY 源码）
# ==============================================================================
FROM node:18-alpine3.19 AS runtime
RUN apk add --no-cache curl tini tzdata \
 && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone \
 && addgroup -g 1001 -S appuser \
 && adduser  -u 1001 -S appuser -G appuser

WORKDIR /app

# M-8 PM2 全局安装（进程守护集群模式）
RUN npm install -g pm2@5.3.1 --no-audit --no-fund

# -- 拷贝 deps 层的 node_modules --
COPY --from=deps --chown=appuser:appuser /app/node_modules ./node_modules

# -- 应用源码 --
COPY --chown=appuser:appuser server.js ./
COPY --chown=appuser:appuser src/ ./src/
COPY --chown=appuser:appuser ecosystem.config.js ./
COPY --chown=appuser:appuser scripts/ ./scripts/

# -- 运行时目录权限 --
RUN mkdir -p /app/.tmp-upload /app/local-backup /app/logs \
 && chown -R appuser:appuser /app

USER appuser
ENV TZ=Asia/Shanghai \
    NODE_ENV=production \
    PORT=3001 \
    PM2_HOME=/app/.pm2

# M-12 TraceId + 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/v1/healthz || exit 1

EXPOSE 3001

# M-8 PM2 集群启动（pm2-runtime 前台模式，符合 Docker）
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pm2-runtime", "start", "ecosystem.config.js", "--env", "production"]
