/**
 * PM2 进程管理配置（server/ecosystem.config.js）
 * 生产部署：pm2 start ecosystem.config.js --env production
 * 与仓库根 ecosystem.config.js 分工：根目录=全栈编排，这里=Node.js API 单服务
 */
module.exports = {
  apps: [
    {
      name: 'qaxqjt-api',
      script: './src/server.js',
      node_args: '-r dotenv/config',
      cwd: __dirname,
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
        PORT: 3001
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        LOG_LEVEL: 'warn'
      },
      error_file: '../logs/pm2-api-error.log',
      out_file: '../logs/pm2-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      min_uptime: '60s',
      max_restarts: 20,
      kill_timeout: 10000,
      listen_timeout: 30000,
      wait_ready: false
    }
  ]
};
