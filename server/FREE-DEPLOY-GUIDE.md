# 秦安县秦剧团云端预约系统 · 免费部署指南

> 无需信用卡 · 永久免费 · 前端 Vercel + 后端 Koyeb

## 架构概览

```
用户浏览器
    │
    ▼
Vercel (前端静态托管，免费，自带 HTTPS)
    │  /api/* 代理
    ▼
Koyeb (后端 Node.js + SQLite，免费套餐)
```

## 第一部分：部署后端到 Koyeb

### 1. 注册 Koyeb

- 访问 https://app.koyeb.com
- 用 GitHub 账号登录（免费，无需信用卡）

### 2. 创建 Service

1. 点击 **"Create Service"**
2. 选择 **"GitHub"** 作为部署源
3. 连接 GitHub 仓库：`shm9833/qaxqjt-server`
4. 分支：`main`
5. 构建方式：**Docker**
6. Dockerfile 路径：`server/Dockerfile`
7. 构建上下文：`server/`

### 3. 配置服务

- **Service name**: `qaxqjt-api`
- **Instance type**: Free (免费)
- **Regions**: 选离中国近的（如 Tokyo/Singapore）
- **Ports**: 3001 (HTTP)

### 4. 环境变量

在 Koyeb 控制台添加以下环境变量：

| Key | Value | 说明 |
|-----|-------|------|
| `NODE_ENV` | `production` | 生产模式 |
| `PORT` | `3001` | 端口 |
| `DATABASE_URL` | `file:/app/data/prod.db` | SQLite 路径 |
| `JWT_ACCESS_SECRET` | 随机 64 位字符串 | JWT 密钥（重要！） |
| `JWT_REFRESH_SECRET` | 另一个随机 64 位字符串 | JWT 刷新密钥 |
| `CORS_ORIGINS` | `*` | 允许所有来源（后续可改为 Vercel 域名） |
| `LOG_LEVEL` | `warn` | 日志级别 |

### 5. 持久化存储（SQLite 数据库）

1. 在 Service 设置中找到 **"Volumes"**
2. 添加 Volume：
   - Name: `qaxqjt-data`
   - Mount path: `/app/data`
   - Size: `1GB`

### 6. 部署

点击 **"Deploy"**，等待 3-5 分钟构建完成。

### 7. 获取后端 URL

部署成功后，Koyeb 会分配一个域名，类似：
```
https://qaxqjt-api-xxxxx.koyeb.app
```

**记下这个 URL**，后续配置 Vercel 需要用。

### 8. 验证后端

访问：
```
https://你的-koyeb-域名/v1/healthz
```

应返回：
```json
{"ok":true,"service":"qaxqjt-api","version":"V2026.8.3",...}
```

---

## 第二部分：部署前端到 Vercel

### 1. 注册 Vercel

- 访问 https://vercel.com
- 用 GitHub 账号登录（免费，无需信用卡）

### 2. 导入项目

1. 点击 **"Add New"** → **"Project"**
2. 选择 GitHub 仓库：`shm9833/qaxqjt-server`
3. 点击 **"Import"**

### 3. 配置项目

- **Project Name**: `qaxqjt`
- **Framework Preset**: `Other`
- **Root Directory**: `_deploy`
- **Build Command**: 留空
- **Output Directory**: `./`
- **Install Command**: 留空

### 4. 配置环境变量

在 Vercel 项目设置中添加：

| Key | Value |
|-----|-------|
| `API_BACKEND_URL` | 你的 Koyeb 后端 URL（如 `https://qaxqjt-api-xxxxx.koyeb.app`） |

### 5. 部署

点击 **"Deploy"**，等待 1-2 分钟。

### 6. 获取前端 URL

部署成功后，Vercel 会分配一个域名，类似：
```
https://qaxqjt-xxxxx.vercel.app
```

---

## 第三部分：连接前后端

### 1. 更新 Vercel 配置中的后端 URL

编辑本地文件 `_deploy/vercel.json`，将两处 `YOUR_BACKEND_PUBLIC_HOST` 替换为你的 Koyeb 域名：

```json
{
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "https://你的-koyeb-域名/$1"
    },
    {
      "source": "/v1/:path*",
      "destination": "https://你的-koyeb-域名/v1/:path*"
    }
  ]
}
```

### 2. 提交并推送

```bash
git add _deploy/vercel.json
git commit -m "deploy: configure Vercel to proxy to Koyeb backend"
git push origin main
```

Vercel 会自动重新部署。

### 3. 更新 Koyeb CORS（可选但推荐）

在 Koyeb 环境变量中，将 `CORS_ORIGINS` 改为你的 Vercel 域名：
```
https://qaxqjt-xxxxx.vercel.app
```

---

## 第四部分：验证

### 1. 前端首页

访问 `https://你的-vercel-域名/`，应看到秦剧团首页。

### 2. 同源代理测试

访问 `https://你的-vercel-域名/api/v1/healthz`，应返回：
```json
{"ok":true,"service":"qaxqjt-api","version":"V2026.8.3",...}
```

### 3. 后台登录

访问 `https://你的-vercel-域名/admin/login.html`：
- 账号：`admin`
- 密码：`admin123456`

登录成功后跳转到仪表板。

---

## 常见问题

### Q: Koyeb 免费套餐有什么限制？
A: 1 个免费 Service，512MB 内存，每月有限额度。适合小型应用。

### Q: SQLite 数据会丢失吗？
A: 只要配置了 Volume（/app/data），数据会持久化保存。

### Q: 国内访问速度如何？
A: Vercel 全球 CDN，国内访问尚可。Koyeb 选 Tokyo/Singapore 节点，延迟较低。

### Q: 如何绑定自定义域名 qaxqjt.cn？
A: 
- Vercel: 项目设置 → Domains → 添加 qaxqjt.cn → 按提示配置 DNS CNAME
- Koyeb: 项目设置 → Custom Domains → 添加 api.qaxqjt.cn → 配置 DNS CNAME

### Q: JWT 密钥怎么生成？
A: 用以下命令生成随机字符串：
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
或在 https://passwordsgenerator.net 生成 64 位随机字符串。
