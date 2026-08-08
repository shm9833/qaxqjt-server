/**
 * PM2 集群模式启动配置（M-8 进程守护）
 * 对应 .env 的 PM2_* 变量，从 process.env 读取
 */
module.exports = {
  apps: [
    {
      name: "qaxqjt-api",
      script: "./server.js",
      cwd: "/app",
      // 实例数：max = CPU 核数（对应 PM2_INSTANCES=max）
      instances: process.env.PM2_INSTANCES || "max",
      exec_mode: process.env.PM2_EXEC_MODE || "cluster",
      env_production: {
        NODE_ENV: "production",
        PORT: process.env.APP_PORT || 3001,
      },
      // M-8：崩溃自动拉起 + 内存超阈值重启
      max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || "1024M",
      min_uptime: process.env.PM2_MIN_UPTIME || "10s",
      restart_delay: parseInt(process.env.PM2_RESTART_DELAY) || 5000,
      listen_timeout: 15000,
      kill_timeout: 15000,
      autorestart: true,
      // M-6 Sentry / 日志：PM2 → JSON 结构化日志
      error_file: process.env.PM2_LOG_DIR
        ? `${process.env.PM2_LOG_DIR}/pm2-error.log`
        : "./logs/pm2-error.log",
      out_file: process.env.PM2_LOG_DIR
        ? `${process.env.PM2_LOG_DIR}/pm2-out.log`
        : "./logs/pm2-out.log",
      log_date_format:
        process.env.PM2_LOG_DATE_FORMAT || "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      log_type: "json",
      // 传 traceId 字段给子进程
      env: {
        TRACE_ENABLE: process.env.TRACE_ENABLE || "true",
      },
    },
  ],
};
