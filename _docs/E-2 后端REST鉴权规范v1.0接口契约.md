# 秦安县秦剧团云端预约系统 · 后端 REST 鉴权规范 v1.0

> **文档版本**：v1.0 · 2026-08-03  
> **前端对接位置**：`admin/login.html` → `var __BACKEND_AUTH_URL = '__________'`（约第 1090 行）  
> **密码哈希算法**：必须 `bcrypt(cost>=12)` 或 `argon2id(m=64MB,t=3,p=1)`，**禁止 md5/sha1/sha256 裸哈希**  
> **Session 存储**：必须 `HttpOnly + Secure + SameSite=Lax` Cookie，**禁止 localStorage 存 Session 生产环境**

---

## 一、对接总览（后端工程化 8 步）

```
① 登录页 填写 username/password/captcha/remember
   ↓ POST /v1/admin/login  (HTTPS, CSRF 双 Cookie)
② 后端 bcrypt 校验 → 签发 Session（HttpOnly Cookie）+ Access Token（短JWT 5min, 放 header X-Auth-Token）
   ↓ 200 OK  Set-Cookie: sid=sess_xxx; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7200
              X-CSRF-Token: csrf_xxx（放响应头，前端存到 Cookie 非 HttpOnly 或 内存）
③ 前端 14 个 admin/*.html 每次请求自动带：Cookie (sid) + X-CSRF-Token + X-Auth-Token
   ↓
④ 后端每 API 校验 4 层：① Session(Cookie) 有效 ② CSRF 匹配 ③ Token 未过期 ④ 权限 RBAC
   ↓
⑤ 业务接口（orders/finance/staff/attendance/...）返回 {ok:true, data:..., paging:...}
⑥ 前端 2 小时 TTL 临近 → POST /v1/admin/refresh-session → 续签
⑦ 点击登出 → POST /v1/admin/logout → 后端把 Session 入黑名单（Redis 2小时 TTL）+ 清 Cookie
⑧ 安全日志：所有 4xx/5xx 登审计日志（IP / UA / 账号 / 接口 / 参数摘要）
```

---

## 二、Base URL & 鉴权头

| 项目 | 约定值 |
|---|---|
| Base URL 示例（生产） | `https://api.qin-an-troupe.gov.cn/v1` |
| Base URL 示例（测试） | `https://api-test.qin-an-troupe.gov.cn/v1` |
| 前端配置位置 | login.html 第 1090 行 `__BACKEND_AUTH_URL` = 填 Base URL + `/admin/login` 完整路径 |
| 字符编码 | 全部 UTF-8；application/json; charset=utf-8 |
| 传输 | **强制 HTTPS（TLS 1.2+）**，HTTP 拒绝服务并 301 升级 |
| 跨域（如前后端不同域） | CORS `Access-Control-Allow-Credentials: true` + 明确 Allow-Origin，禁止 `*` |

### 每次请求必须带的 4 个要素

```
① Cookie: sid=sess_{32hex}  （HttpOnly，浏览器自动带）
② X-CSRF-Token: csrf_{32hex} （前端从 Cookie: csrftoken 读）
③ X-Auth-Token: eyJhbGciOi... （短 JWT，5 min，内存或 SessionStorage 存，不要 persist）
④ Authorization: Bearer {access_token} （可选，和 ③ 二选一，看后端实现）
```

### 统一响应结构（所有 API 必须遵循）

```json
{
  "ok": true,                          // bool：请求是否成功
  "code": 0,                           // int：业务码 0=OK，非 0=错误
  "message": "ok",                     // string：中文提示
  "data": { /* object / array */ },    // 业务数据
  "paging": {                          // 列表类接口才存在
    "page": 1,
    "pageSize": 20,
    "total": 128,
    "pageCount": 7
  },
  "serverTs": 1754223300123,           // ms，帮助前端校时
  "traceId": "tr_20260803_L3kZpQa7mN"  // 排障用，每次请求唯一
}
```

**错误响应示例**（HTTP 4xx/5xx 但仍返回 JSON，前端 Toast 直接用 message）：

```json
{
  "ok": false,
  "code": 1002,
  "message": "密码错误，剩余尝试次数：2（今日累计：5）",
  "data": null,
  "serverTs": 1754223300123,
  "traceId": "tr_20260803_failed_xyz"
}
```

### 统一错误码表（对接必须返回这些 code，前端已有对应中文 Toast 文案）

| code | HTTP 状态 | 中文含义 | 前端行为 |
|---|---|---|---|
| 0 | 200 | 成功 | — |
| 1001 | 400 | 参数校验失败（返回 data.errors 详细列字段） | 高亮对应字段 |
| 1002 | 401 | 用户名或密码错误 | Toast 提示 + 刷新验证码 |
| 1003 | 401 | 验证码错误 | Toast 提示 + 刷新验证码 |
| 1004 | 423 | 账号已被管理员停用 | Toast 提示 + 跳回登录 |
| 1005 | 429 | 登录失败次数过多，账号锁定 30 分钟（返回 data.unlockAt） | 倒计时提示 |
| 1006 | 401 | Session 已过期或不存在 | 前端清本地 + 跳 login.html |
| 1007 | 403 | CSRF Token 无效或过期 | 刷新页面重新获取 |
| 1008 | 403 | 无此接口权限（返回 data.needPermissions） | Toast + 403 页 |
| 1009 | 401 | Token 签名不合法或已过期 | 自动走续签 |
| 1099 | 451 | 检测到撞库/爆破攻击，已封禁 IP（返回 data.banUntil） | 跳验证码人工解封页 |
| 2001 | 409 | 财务凭证号已存在（幂等冲突） | 前端提示「已登记请勿重复提交」 |
| 2002 | 409 | 考勤日期重复（同 staffId+date 两条） | 前端跳转到已存在那条记录 |
| 5000 | 500 | 服务器内部错误（请把 traceId 发给运维） | Toast + 上报 Sentry |

---

## 三、鉴权核心接口（6 个）

> 所有接口前缀：`{BASE_URL}/v1/admin/...`

---

### 1. 获取 CSRF Token（打开登录页第一请求，无鉴权）

```
GET /v1/admin/csrf
Cookie: 无
Header: 无

Response 200:
Set-Cookie: csrftoken=csrf_{32hex}; Secure; SameSite=Lax; Path=/; Max-Age=7200  ← 非 HttpOnly（前端可读）
Set-Cookie: pre_session=pre_{32hex}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7200  ← 占位，防 CSRF 前置
X-CSRF-Token: csrf_{32hex}  ← 响应头也返回一份，方便无 Cookie 环境拿
Body:
{
  "ok":true, "code":0, "message":"ok",
  "data":{
    "csrfToken":"csrf_xxx",
    "captchaImageDataUrl":"data:image/svg+xml;utf8,...",   ← 登录页首屏验证码（SVG 绘制，无图片 CDN）
    "captchaId":"cap_xxx",                                 ← 绑定本次验证码
    "passwordPolicy":{                                     ← 前端密码输入框实时校验提示
      "minLength":8,
      "requireUppercase":true,
      "requireLowercase":true,
      "requireNumber":true,
      "requireSymbol":true,
      "bannedList":["admin123","12345678","qazwsxedc"]
    }
  },
  "serverTs":..., "traceId":...
}
```

---

### 2. 管理员登录（最核心，对接前端 login.html 1090 占位）

```
POST /v1/admin/login
Content-Type: application/json
Header:
  X-CSRF-Token: csrf_xxx  ← 从 /csrf 拿到
Cookie:
  csrftoken=csrf_xxx      ← 浏览器自动
  pre_session=pre_xxx     ← 浏览器自动

Request Body:
{
  "username": "admin",
  "password": "U2FsdGVkX1+...",        // ⚠️ 推荐：前端用后端公钥 RSA-OAEP 加密后传输，避免 HTTPS 被降级（见附录A）
  "passwordEncrypted": true,           // true = 已用 RSA 加密，后端私钥解；false = 纯 HTTPS 明文（不推荐）
  "captcha": "A7K2",                   // 用户输入，大写
  "captchaId": "cap_xxx",              // 从 /csrf 拿
  "remember": true,                    // 勾选"记住用户名"，决定 Session TTL
  "clientFingerprint": "fp_{sha256前16}", // 浏览器 UA+屏幕+时区+字体+canvas 指纹，防多账号登录绕过IP封禁
  "fromPage": "login.html"
}

Response:
200 OK → 登录成功
Set-Cookie: sid=sess_{32hex}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7200  ← 正式 Session
Set-Cookie: csrftoken=csrf_{NEW}; Secure; SameSite=Lax; Path=/; Max-Age=7200          ← 登录后刷新 CSRF（防会话固定攻击）
Set-Cookie: pre_session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT                      ← 清掉占位 pre

Body:
{
  "ok":true,"code":0,"message":"登录成功",
  "data":{
    "session":{
      "id":"sess_xxx",                 // 前端仅调试看，真实鉴权用 Cookie sid
      "username":"admin",
      "name":"系统管理员",
      "role":"admin",
      "roleName":"超级管理员",
      "loginAt":"2026-08-03T11:30:12.000Z",
      "expiresAt":1754234112000        // ms
    },
    "accessToken":"eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9....",   // ES256 短 JWT，5min，放 X-Auth-Token
    "accessTokenExpiresAt":1754223612000,
    "permissions":[                    // 前端细粒度按钮级权限，按角色+权限双控显示
      "dashboard:read",
      "orders:read","orders:write","orders:approve",
      "finance:read","finance:write","finance:review","finance:void",
      "staff:read","staff:write",
      "attendance:read","attendance:write","attendance:pushFinance","attendance:printPayslip",
      "inventory:read","inventory:write","inventory:stocktake",
      "cast:read","cast:write","cast:print",
      "content:read","content:write","content:publish",
      "accounts:read","accounts:write","accounts:resetPassword",
      "system:backup","system:restore","system:viewLog",
      "reports:read","reports:export"
    ],
    "forceChangePassword":false        // true = 首次登录/重置密码后强制改密，前端跳改密页
  },
  "serverTs":...,"traceId":...
}

401 失败（密码错）：
Body: {
  "ok":false,"code":1002,
  "message":"密码错误，账号剩余尝试次数：2，今日累计失败：5（满10次锁定30分钟）",
  "data":{
    "failedRemaining":2,
    "failedToday":5,
    "lockThreshold":10,
    "nextCaptcha":{
      "captchaId":"cap_new",
      "captchaImageDataUrl":"data:image/svg..."
    }
  }
}

429 锁定（满10次）：
Body: {
  "ok":false,"code":1005,
  "message":"账号已锁定，请 29 分 48 秒后再试，或联系超级管理员解锁",
  "data":{"unlockAt":1754226000000}
}
```

**对接 checklist（安全必填，不满足=上线被拒）：**

| # | 要求 | 后端如何实现 |
|---|---|---|
| S1 | 密码哈希 `bcrypt cost>=12` 或 `argon2id` | 禁止任何前端 hash，**哈希只能发生在后端** |
| S2 | 密码比对用 `hash_equals` 常量时间函数 | 防时序攻击（PHP hash_equals / Java MessageDigest.isEqual / Go subtle.ConstantTimeCompare） |
| S3 | 同一账号 5 分钟失败 ≥ 5 → 图片验证码 | 已达阈值登录请求必须带新 captchaId |
| S4 | 同一账号 24h 失败 ≥ 10 → 账号锁定 30 分钟 | Redis `SET qaxqjt:lock:{username} 1 EX 1800 NX` |
| S5 | 同 IP 5 分钟 100 次登录请求 → IP 封禁 1h | WAF / Nginx limit_req / 云防护层实现 |
| S6 | 登录成功立即刷新 CSRF Token + 废弃 pre_session | 防会话固定攻击（用户→攻击者） |
| S7 | 返回权限数组（不是只返回 role） | 前端按钮级显示控制，避免越权点进去才报错 |
| S8 | 记录登录成功/失败审计日志（IP/UA/账号/经纬度） | 存数据库 log_admin_login，保留 ≥ 6 个月 |

---

### 3. 续签 Session（每 90 分钟前端自动调用一次）

```
POST /v1/admin/refresh-session
Header: X-CSRF-Token + X-Auth-Token
Cookie: sid=...（有效）

Response 200:
Set-Cookie: sid=sess_NEW; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7200   ← 刷新 TTL
Set-Cookie: csrftoken=csrf_NEW; Secure; SameSite=Lax; Path=/; Max-Age=7200        ← 旋转 CSRF
Body: 返回新 accessToken（data.accessToken），同登录结构

401 code 1006 → Session 已过期 → 前端强制跳 login.html（清本地）
```

---

### 4. 当前账号信息（Admin 14 页首屏调用，用于显示右上角用户名+角色）

```
GET /v1/admin/me
Header: X-CSRF-Token + X-Auth-Token
Cookie: sid=...

Response:
data = { username, name, role, roleName, permissions[], lastLoginAt, avatarUrl? }
等价于登录返回 data.session + permissions 合并
```

---

### 5. 登出（前端右上角「退出登录」按钮触发）

```
POST /v1/admin/logout
Header: X-CSRF-Token + X-Auth-Token
Cookie: sid=...

Response 200:
Set-Cookie: sid=; Expires=1970-01-01
Set-Cookie: csrftoken=; Expires=1970-01-01
Body: {"ok":true,"code":0,"message":"已安全退出"}

后端同时做 3 件事：
① Redis `SADD qaxqjt:logout_blacklist sess_xxx EX 7200`（黑名单防复用）
② 数据库 UPDATE admin_sessions SET status='revoked' WHERE id='sess_xxx'（持久化）
③ 写审计日志 log_admin_logout
```

---

### 6. 找回用户名 / 找回密码（login.html 两个链接）

> 推荐：短信验证码 + 管理员登记手机号，**不要邮箱**（剧团环境常用手机号）

#### 6.1 发送短信验证码（找回密码步骤 1）

```
POST /v1/admin/forgot/send-sms
No-auth（未登录）
Header: X-CSRF-Token（仍需要，防短信轰炸）
Request Body: {"phone":"13909380001","scene":"forgot_password"}
Response: {"ok":true,"data":{"sceneToken":"sct_xxx","expiresAt":1754223660000}}  ← sceneToken 绑定本次发送，下一步校验
后端限制：同手机号 60s 1 次，同 IP 20 条/天，超量返回 429 code 1005
```

#### 6.2 校验验证码 + 设置新密码（找回密码步骤 2）

```
POST /v1/admin/forgot/reset
No-auth
Header: X-CSRF-Token
Body: {"phone":"139...","sceneToken":"sct_xxx","smsCode":"123456","newPassword":"NewPass@123","confirmPassword":"NewPass@123"}
Response: {"ok":true,"code":0,"message":"密码重置成功，请使用新密码登录","data":{"goLoginIn":3}}  ← 前端 3 秒后跳 login
密码重置成功后：该账号所有历史 Session 全部入黑名单（防劫持者继续在线）
```

---

## 四、业务接口对接（按模块分，前端 14 页 CRUD → 后端 14 组接口）

> 规则：所有列表接口统一 `page / pageSize / keyword / filters`，所有写操作统一 `X-CSRF + X-Auth + Cookie` + 审计日志。**前端直接用数据字典 E-1.md 字段名作为请求/响应字段名**，省去二次转换。

| 模块页 | 前缀（/v1/admin/...） | 必要权限前缀 | 说明 |
|---|---|---|---|
| 数据看板 index.html | `/dashboard*` | dashboard:read | `/summary`(顶6卡)、`/trend?range=30d`(图表)、`/todo-alerts`(预警) |
| 订单预约 orders.html | `/orders*` + `/appointments*` + `/customers*` | orders:* / customers:* | CRUD + 审核转正 + 收款登记 + 导出Excel |
| 剧目 operas.html | `/plays*` | content:* | CRUD + 附件上传(谱/录像) |
| 排期 schedule.html | `/schedules*` | orders:read | 日历 + 按周/月列表 |
| 演员表 cast-sheet.html | `/cast-sheets*` + `/troupe-templates*` + `/performers-db*` | cast:* | 多场切换 + A4 单场打印（后端可生成PDF返回 Blob） |
| 演职人员 staff.html | `/staff-roster*` + `/accounts*` | staff:* / accounts:* | 花名册 + 账号权限 + 角色（账号权限独立于花名册） |
| 考勤 attendance.html | `/attendance*` + `/wages*` + `/wage-rules*` + `/attendance/isapi-sync*` | attendance:* | CSV 上传解析（后端可替代原生 PapaParse 更可靠） + 月工资批量推送财务 + 打印工资条 |
| 库存 inventory.html | `/equipment*` + `/borrow-logs*` + `/stocktakes*` + `/inv-alerts*` | inventory:* | CRUD + 借用登记/归还 + 盘点 + 导出Excel |
| 财务 finance.html | `/fin-ledger*` + `/fin-invoices*` + `/fin-recons*` + `/fin-payments*` | finance:* | **全部写操作必须双人复核** + 作废凭证保留流 |
| 内容 content.html | `/content*` | content:* | 栏目/文章/轮播，定时发布 + 私密访问 |
| 统计报表 reports.html | `/reports*` | reports:* + finance:read 等 | 导出 PDF/Excel 汇总报表 |
| 账号权限 accounts.html | `/accounts*`（和上面区分：=管理员账号，不是花名册） | accounts:* | 创建账号 + 重置密码必须走 6.1-6.2 短信流程，禁止前端传明文新密码 |
| 系统备份 system.html | `/system/backup*` + `/system/log*` | system:* | 备份下载=后端加密 zip(AES-256) + 只有系统管理员能下载；日志=读 log_admin_* 审计表 |

### 业务接口对接示例：财务登记一笔收入（对应前端 finance.html addLedgerEntry）

```
POST /v1/admin/fin-ledger
权限: finance:write + 双人复核（制单人!= 审核人，后端校验 2 个不同 userId）
Header: X-CSRF-Token + X-Auth-Token
Cookie: sid=...

Request Body = 数据字典 "fin_ledger_v1" 字段（省略 id/voucherNo/createdAt，后端生成）：
{
  "date":"2026-08-03",
  "source":"演出收款",
  "type":"income",
  "category":"尾款",
  "amount":38000,
  "orderId":"ord_bx92ks8zm1qp",
  "customerId":"cust_abc",
  "counterparty":"兴国镇文化站",
  "paymentMethod":"银行转账",
  "bankAccountId":"bank_001",
  "remark":"8/3-8/7 兴国镇 5 场 尾款",
  "attachment":"data:application/pdf;base64,...(回单扫描件)",
  "reviewerUserId":"usr_002"   // 审核人 ID，后端检查 reviewerUserId !== req.auth.userId
}

Response 200:
{
  "ok":true,"code":0,"message":"已登记，等待审核人 {reviewerName} 最终确认",
  "data":{
    "id":"fin_L3kZpQa7mN",
    "voucherNo":"20260803_SR_01",
    "status":"pending_review",
    "reviewUrl":"https://admin..../finance.html?view=fin_L3kZpQa7mN"
  }
}
```

---

## 五、文件上传规范（合同/回单/发票扫描件/考勤照片）

| 项目 | 约定 |
|---|---|
| 上传接口 | `POST /v1/admin/upload`（multipart/form-data，字段名 `file`） |
| 最大大小 | 单文件 ≤ 20 MB；批量 ≤ 100 MB |
| 允许类型 | `.pdf` `.jpg` `.jpeg` `.png` `.xlsx` `.xls` `.csv` `.doc` `.docx` |
| 禁止类型 | `.exe` `.js` `.html` `.svg`（SVG 有 xss 风险） `.bat` `.php` `.sh` |
| 鉴权 | 同样要 X-CSRF-Token + X-Auth-Token + Cookie |
| 返回 | `{"ok":true, "data":{"url":"https://cdn.../2026/08/xxyyzz.pdf","objectKey":"2026/08/xxyyzz.pdf","size":384929,"sha256":"...","contentType":"application/pdf"}}` |
| 存储 | 腾讯云 COS / 阿里云 OSS，SSE-S3 服务端加密，Bucket 私有权限，访问走预签名 URL（有效期 7 天） |
| 病毒扫描 | 上传完成后后端调用 ClamAV / COS 内容审核，扫描失败自动删除 + 返回错误 |

---

## 六、速率限制（WAF 层 / Nginx / 后端 Redis 三层实现）

| 场景 | 限流规则 | 超出处理 |
|---|---|---|
| 登录接口 `/admin/login` | 同 IP 5 分钟 ≤ 100 次 / 同账号 5 分钟 ≤ 20 次 | 返回 429 code 1005，提示锁定时间 |
| 短信接口 `/forgot/send-sms` | 同手机号 60s ≤ 1 次 / 同 IP 24h ≤ 20 次 | 429 |
| 导出接口 `/reports/export*` `/fin-ledger/export*` | 同用户 1 分钟 ≤ 3 次 | 提示「请稍后再试」 |
| 全局业务写接口（POST/PUT/DELETE） | 同用户 1 秒 ≤ 5 次 | 排队或返回 429 |
| 全局读接口（GET） | 同 IP 1 分钟 ≤ 6000 次 | WAF 直接挡 |

---

## 七、审计日志 & 安全事件上报

### 7.1 必记日志（任何一条不得少）

| 日志表 | 触发场景 | 记录字段 |
|---|---|---|
| `log_admin_login` | 登录成功 / 失败 / 锁定 | time, username, ip, ua, geolocation, result, failReason, traceId |
| `log_admin_logout` | 登出成功 / Session 过期自动下线 | time, username, ip, sessId, reason |
| `log_admin_action` | 所有写接口（POST/PUT/DELETE）成功执行 | time, userId, username, role, interface, method, paramsBase64Truncated, resultCode, affectedId, ip, ua, traceId |
| `log_admin_data_access` | 敏感数据批量导出 / 大日期范围查询（>3 个月财务） | time, userId, interface, queryRange, exportCount, purpose(前端填) |
| `log_sec_event` | 触发安全事件（暴破/锁定/越权/CSRF 失配/文件上传拦截…） | time, eventType, level(warn/danger/critical), detail, ip, ua, blocked(boolean) |

### 7.2 安全事件告警（对接企业微信/钉钉机器人 webhook）

| 事件类型 | 告警级别 | 立即推送条件 |
|---|---|---|
| 暴破检测 | 严重 | 单账号 24h ≥ 15 次失败 或 单 IP 1h ≥ 500 次请求 |
| 越权尝试 | 严重 | code 1008 1 小时 ≥ 10 次（同一个人反复点无权限功能） |
| 数据导出异常 | 严重 | 1 天 ≥ 3 次导出财务全部流水（>1000 条） |
| 管理员密码修改 | 警告 | 任何 accounts:resetPassword 成功 |
| 凭证作废 | 警告 | 财务作废凭证（void fin_ledger）每次 |
| 系统备份下载 | 严重 | system.html backup zip 每次下载（只有 admin 角色能下，仍必须每次推送到运维群） |

---

## 八、前端对接代码（改 login.html 1087-1113 占位）

在登录页 `_callBackendAuth` 真实接入时，把下面代码替换到原来的 `return null` 行即可：

```javascript
// admin/login.html → function _callBackendAuth(username, password, captcha) 内部
// 真实生产版本（替换掉 return null 那行）：
var csrf = null;
try {
  var m = (document.cookie || '').match(/(?:^|;\s*)csrftoken=([^;]+)/);
  if (m) csrf = decodeURIComponent(m[1]);
} catch(_){}
var headers = {
  'Content-Type': 'application/json',
  'Accept': 'application/json'
};
if (csrf) headers['X-CSRF-Token'] = csrf;
try {
  return fetch(__BACKEND_AUTH_URL, {
    method: 'POST',
    credentials: 'include',   // ✅ 关键：带 Cookie (sid + csrftoken)
    headers: headers,
    body: JSON.stringify({
      username: username,
      password: password,       // 或者附录A 用 RSA 加密后 passwordEncrypted=true
      passwordEncrypted: false, // 配合上面
      captcha: captcha,
      captchaId: (window.__captchaId || ''),
      remember: !!(document.getElementById('rememberMe') && document.getElementById('rememberMe').checked)
    })
  }).then(function(r){
    return r.json().then(function(j){
      if (j && j.ok && j.data && j.data.session) {
        // 保存 accessToken 到内存（不要 localStorage，页面刷新重走 Session）
        try { window.__accessToken = j.data.accessToken || ''; } catch(_){}
        try { window.__permissions = j.data.permissions || []; } catch(_){}
        return { session: j.data.session };
      }
      // 失败：用后端返回的 message 做 Toast
      var msg = (j && j.message) ? j.message : ('后端登录失败，' + (j && j.code ? '错误码=' + j.code : ''));
      try {
        if (window.QinApp && window.QinApp.Utils) window.QinApp.Utils.toast(msg, 'error', 5000);
        else alert(msg);
      } catch(_){}
      // 刷新验证码（后端失败响应里返回了 nextCaptcha 就用那个）
      try {
        if (j && j.data && j.data.nextCaptcha && j.data.nextCaptcha.captchaImageDataUrl) {
          var t = document.getElementById('captchaText'); if(t) t.textContent = j.data.nextCaptcha.captchaId;
          var d = document.getElementById('captchaDisplay');
          if(d) d.innerHTML = '<img src="'+j.data.nextCaptcha.captchaImageDataUrl+'" style="height:100%"/>';
          window.__captchaId = j.data.nextCaptcha.captchaId;
        } else if (typeof refreshCaptcha === 'function') {
          refreshCaptcha();
        }
      } catch(_){}
      return { _blocked: true };   // 让 loginUser 外层 return null（登录失败）
    });
  } catch(err) {
    try {
      if (window.QinApp && window.QinApp.Utils) window.QinApp.Utils.toast('网络异常，无法连接后端：' + (err && err.message ? err.message : ''), 'error', 8000);
      else alert('网络异常，无法连接后端：' + (err && err.message ? err.message : ''));
    } catch(_){}
    return { _blocked: true };
  }
}
```

### 前端 14 页统一请求拦截（建议加到 app.js `Admin` 模块顶部）：

```javascript
// ================ 后端统一请求拦截器 ================
Admin.request = function(path, opts){
  opts = opts || {};
  var BASE = __BACKEND_AUTH_BASE || 'https://api..../v1'; // 另外定义
  var url = BASE + path;
  var headers = Object.assign({'Content-Type':'application/json','Accept':'application/json'}, opts.headers||{});
  // 自动带 CSRF
  try {
    var m = (document.cookie || '').match(/(?:^|;\s*)csrftoken=([^;]+)/);
    if (m) headers['X-CSRF-Token'] = decodeURIComponent(m[1]);
  } catch(_){}
  // 自动带 AccessToken
  try { if (window.__accessToken) headers['X-Auth-Token'] = window.__accessToken; } catch(_){}
  return fetch(url, {
    method: opts.method || 'GET',
    credentials: 'include',
    headers: headers,
    body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined
  }).then(function(r){
    // 401 = Session 过期 → 统一跳 login
    if (r.status === 401) {
      try { localStorage.removeItem(ADMIN_STORAGE_KEY); } catch(_){}
      try { window.location.replace('login.html'); } catch(_){ window.location.href='login.html'; }
      return Promise.reject(new Error('Session 已过期'));
    }
    return r.json().then(function(j){
      if (j && j.ok) return j;
      // 后端错误直接抛，上层 catch 用 j.message Toast
      var err = new Error(j && j.message || '请求失败');
      err.resp = j;
      throw err;
    });
  });
};

// 使用示例（代替直接 Storage.getItem/setItem → 改为后端调用）：
// Admin.request('/orders?page=1&pageSize=20&status=pending').then(j=>{ renderOrders(j.data); });
```

---

## 附录 A：密码 RSA-OAEP 前端加密（推荐，防 HTTPS 降级 + Fiddler 中间人明文密码）

1. 后端生成 RSA-2048 密钥对（每 24h 轮换一次，存 Redis）
   ```
   公钥文件：/v1/admin/public-key.pem（无鉴权，登录页首屏 GET）
   私钥：Redis qaxqjt:rsa:priv + 24h TTL，仅后端用（加密机/HSM更好）
   ```
2. 前端 login.html 打开首屏：`GET /v1/admin/public-key.pem` → 拿到 PEM → `SubtleCrypto.importKey(spki,...)`
3. 用户点「登录」时：`SubtleCrypto.encrypt({name:"RSA-OAEP", hash:"SHA-256"}, pubKey, utf8(password))` → Base64
4. 请求 body 里 `password = Base64密文` + `passwordEncrypted = true`
5. 后端：私钥解 → bcrypt 校验 → 和之前一样返回 Session

**注意：前端加密 = 锦上添花，不是替代 bcrypt + HTTPS。bcrypt 后端哈希 + 常量时间比对仍然必须做。**

---

## 附录 B：对接完成验收用例（必跑）

| 用例 ID | 输入 | 期望 |
|---|---|---|
| AU-01 | 正确 admin 账号 + 正确密码 + 正确验证码 | HTTP 200，返回 Session sid Cookie + accessToken + permissions 数组 18 项 |
| AU-02 | 密码错误 5 次（5分钟内） | 第 6 次开始返回要求必须带新 captchaId，前端自动刷新 SVG 验证码 |
| AU-03 | 密码错误 10 次（24 小时内） | 返回 429 code 1005，账号锁定 30 分钟，同一浏览器即使改密码也被锁 |
| AU-04 | 修改 Cookie 里 sid 为随机值 | 所有 API 返回 401 code 1006，前端跳登录页 |
| AU-05 | 请求不带 X-CSRF-Token | 所有写操作返回 403 code 1007，前端提示「刷新页面」 |
| AU-06 | 登出后立刻用同一 sid 再请求 | 命中黑名单，返回 401 code 1006 |
| AU-07 | 财务岗（role=finance）调账号重置密码接口 | 403 code 1008（无 accounts:resetPassword 权限） |
| AU-08 | 同指纹 fp_xx 换 3 个账号各输错 5 次 | 触发撞库检测（code 1099），IP 封禁 |
| AU-09 | 上传 1 个 exe 改后缀名为 pdf | 后端内容识别扫描拦截，不上传 COS |
| AU-10 | 月度关账后修改上月财务凭证（权限控制） | 禁止写入，返回「该月已关账，如需修改请联系管理员取消关账」 |

---

**文档结束**。后端工程师拿到这份文档即可独立完成 鉴权 + 业务接口 全部实现，前端只需要改 login.html 1090 一行 + 加上面 Admin.request 拦截器 ≈ 30 分钟对接完成。
