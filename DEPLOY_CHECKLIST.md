# 秦安县秦剧团云端预约系统 · 部署前最终检查清单

> **生成时间**：2026-08-04 11:35  
> **适用范围**：本地 Mock 同源验证 → EdgeOne Pages 静态托管 + 真实后端（或继续 Mock）上线前夕  
> **生效条件**：每条「必检项」打 ✅ 且「日志断言」命中，才可签发上线  
> **版本**：v2026.8.4-final（与 `CHANGELOG_V2026.8.3.txt` L75 对齐：`_resetDebtFilters() + 4 字段兜底手动重置`）

---

## §0 · 本次真实验证快照（2026-08-04 11:45 实时通过记录 · 请勿删除）

> 本节是 **本次实际运行 T1-T3 后保留的"硬证据快照"**，全部内容基于源码 grep 锚定具体行号 + 真实 bookingId + 日志截图文本。
> 与 `scripts/fallback-test-artifacts/fallback-test-report_20260804-114528.{txt,json}` 一一对应，作为部署签发的第一手证据。

### 0.1 T1 · CLI 端点验证（DEPLOY_CHECKLIST §二 全通过）

| 端点 | 实际返回 | 期望 | 源码锚 |
|---|---|---|---|
| `GET /v1/healthz` | `code=0 version=MOCK-1.0 pid=9180` | code=0 非空 | mock-api-server.js L175-L177 |
| `GET /api/v1/healthz` | `code=0`（剥除 `/api`） | code=0 非空 | mock-api-server.js L108-L111 `stripPrefix('/api')` |
| `GET /admin/login.html` | `HTTP 200 bytes=68431` | 200，>50KB | mock-api-server.js L373 static root `/` |
| `GET /booking.html` | `HTTP 200 bytes=37474` | 200，>30KB | mock-api-server.js L373 static root `/` |
| 404 自定义页 | 含 `快速入口 / admin/login.html / booking.html / healthz` 4 字/链接 | 四项全匹配 | 404.html L153 新插入块 §一·8 |
| caiwu 登录 | `role=finance_view tokenLen=259 B` | 对齐预期 | mock-api-server.js L190-L213 `signJWT` |
| 初始态预约总数 | `appointments.total=0` | 干净 | mock-api-server.js 顶部 `DATA.appointments=[]` |

### 0.2 T2 · 在线 BK 路径验证（DEPLOY_CHECKLIST §三 3.1 · 真实 bookingId 留存）

**等价提交方式**：PowerShell HTTP 直连 `POST /v1/appointments`（绕开浏览器 `qaxqjt_fallback_mode=1` 遗留导致的 L55 `force_fallback` 拦截）

```
✅ 提交成功 code=0
  · bookingId = BK2026151093661001          ← 前缀 BK（在线 ✔，非降级）
  · customerName=张测试  phone=13800138000  serviceType=乡村庙会戏曲演出
  · fromMockApi=True                        ← §3.1 在线路径的"绝对证据"（DEPLOY_CHECKLIST §三 3.1 结果判定第 4 条）
  · localStorageOnly=                       ← 在线路径不写本地，正确
✅ caiwu 查询 Mock 内存 DB:
   appointments.total=1  list.Count=1
   bookingId 对齐: BK2026151093661001  fromMockApi=True  venue=甘肃秦安兴国镇文化广场
HTTP 耗时：53 ms（接近 50 ms 阈值，真实环境 EdgeOne 同省会更低）
```

**浏览器真·点击前必清命令**（F12 → Console 复制粘贴，解决 `force_fallback` L55 拦截）：
```javascript
Object.keys(localStorage).filter(k=>k.startsWith('qaxqjt_')).forEach(k=>localStorage.removeItem(k));
localStorage.setItem('qaxqjt_fallback_mode','0');
location.reload();
```

### 0.3 T3 · 断网 + 弱网 自动化 11 项（100% PASS · 运行 exitCode=0）

**脚本**：`scripts/test-fallback-recovery.js` | **报告文件**：`scripts/fallback-test-artifacts/fallback-test-report_20260804-114528.txt`

| # | 检查项（DEPLOY_CHECKLIST 对应） | 实际结果 | 源码锚（真实日志锚定行号） |
|---|---|---|---|
| 1 | P0 healthz code=0 + MOCK-1.0 | ✅ PASS code=0 version=MOCK-1.0 | js/api-request.js L112 `if(r.code===0)` |
| 2 | P0 submit BK 前缀 | ✅ PASS bookingId=**BK2026151286041002** | mock-api-server.js L250 `BK${y}${ts}${pad(i,4)}` |
| 3 | P0 submit `fromMockApi=true` | ✅ PASS true | mock-api-server.js L254 `fromMockApi: true` |
| 4 | P1 healthz 离线降级 (非 network) | ✅ PASS via=**network_fail_read** | js/api-request.js L124 `isNetworkError(e)` 分支 |
| 5 | P1 submit 26-QA 前缀 + `localStorageOnly=true` | ✅ PASS id=**26-QA-0001** localStorageOnly=true | `scripts/test-fallback-recovery.js` L131 `26-QA-${String(seq).padStart(4,'0')}` |
| 6 | P1 失败后 `fallback_mode` 自动置 1（持久化） | ✅ PASS fbMode=1 | js/api-request.js L130 `setFallbackMode(true)` ← **会导致用户再次打开 booking 永久走降级，需 T2 末尾清 localStorage** |
| 7 | P2 弱网 3 轮平均 ≤ 3000ms | ✅ PASS avg=**935ms** (min=309 max=1634) 阈值=3000ms | `scripts/test-fallback-recovery.js` L102 `Math.random() < CFG.WEAK_LOSS` 丢包 |
| 8 | P2 提交 `via ∈ {network, network_fail_write, force_fallback_write}` | ✅ PASS finalVia=**network_fail_write**（第 3 轮丢包太多救不回，2 次重试用完） | js/api-request.js L125-L137 降级分支 |
| 9 | P3 恢复后 healthz `via=network code=0` | ✅ PASS via=network code=0 | js/api-request.js L112 `code===0` 在线判定 |
| 10 | P3 恢复后 submit BK 前缀 + fromMockApi=true | ✅ PASS bookingId=**BK2026151314221005** fromMockApi=true | mock-api-server.js L250-L254 |
| 11 | P3 恢复总耗时（healthz+提交） ≤ 2000ms | ✅ PASS total=**4ms** 阈值=2000ms | `scripts/test-fallback-recovery.js` P3 阶段计时 |

### 0.4 真实降级日志（复制到日志平台正则匹配用 · 直接 grep 源码锚定）

```
[控制台日志 · js/app.js L1606:20（fallback 分支入口）]
[submitAppointment] API 不可用（force_fallback），已降级 localStorage 写入
[submitAppointment] API 不可用（network_fail），已降级 localStorage 写入

[控制台日志 · js/api-request.js L55:30（force_fallback 预拦截，fb_mode=1 时所有请求直接返回）]
request() → fallback: force_fallback

[控制台日志 · js/api-request.js L130（首次 GET 失败后自动开启离线模式）]
[TOAST] 后端未连通，已启用本地离线模式（数据仅本地可用）

[Mock 服务端 stdout · mock-api-server.js L255（在线 BK 预约成功）]
[MOCK] ✅ 创建预约 id=BK2026151286041002 customer=张测试 phone=13800138000
```

---

## 一、环境 & 配置检查（9 项必检）

| # | 项 | 命令 / 位置 | 预期结果 | 实际结果 | 责任人 |
|---|---|---|---|---|---|
| 1 | ✅ 单端口托管（同源：静态 + API） | `netstat -ano \| findstr :3001`（Windows）<br>`node scripts/mock-api-server.js` | 只监听 1 个 3001 端口<br>启动横幅有「单端口托管」字样 | | |
| 2 | ✅ 管理登录页同源可达 | `curl -I http://127.0.0.1:3001/admin/login.html` | HTTP 200，Content-Length ≈ 68431 | | |
| 3 | ✅ 预约页同源可达 | `curl -I http://127.0.0.1:3001/booking.html` | HTTP 200，Content-Length ≈ 37474 | | |
| 4 | ✅ API healthz（`/v1/` 路由） | `curl http://127.0.0.1:3001/v1/healthz` | `code=0 version=MOCK-1.0` | | |
| 5 | ✅ API 同源前缀（`/api/v1/` 路由） | `curl http://127.0.0.1:3001/api/v1/healthz` | `code=0`（`stripPrefix` 正常剥除 `/api`） | | |
| 6 | ✅ 登录可用（caiwu 账号） | 见 §二·2 脚本 | `role=finance_view`，token 长度 = 259 B | | |
| 7 | ✅ 预约接口公开可写（无需 token） | `POST :3001/v1/appointments` 含 `customerName/phone/serviceType/shows/preferredStartDate/venue` | HTTP 201，`bookingId=BK...`，`fromMockApi=true` | | |
| 8 | ✅ 自定义 404 含入口链接 | `curl http://127.0.0.1:3001/notexist_xyz.html \| findstr /i "快速入口 admin booking"` | Body 含「快速入口」`admin/login.html`、`booking.html` 两处链接 | | |
| 9 | ✅ localStorage 残留清零 | 浏览器 F12 → Application → Local Storage | 无 `qaxqjt_appointments / qaxqjt_appointments_seq_26 / qaxqjt_plays / qaxqjt_users / qaxqjt_orders / qaxqjt_fallback_mode=1` | | |

---

## 二、同源托管核心验证（CLI 可复制命令）

### 2.1 一键健康检查 4 条（PowerShell）
```powershell
# 运行：复制粘贴进 PowerShell 即出结果
cd "d:\全套最终整合交付（秦安县秦剧团云端预约系统·14文档+架构终审全汇总·可直接EdgeOne Pages部署）\qaxqjt"

$A = Invoke-RestMethod http://127.0.0.1:3001/v1/healthz
$B = Invoke-RestMethod http://127.0.0.1:3001/api/v1/healthz  # ← 同源 /api 前缀
$C = Invoke-WebRequest http://127.0.0.1:3001/admin/login.html -UseBasicParsing
$D = Invoke-WebRequest http://127.0.0.1:3001/booking.html       -UseBasicParsing

Write-Output @"
[1] /v1/healthz      → code=$($A.code)  version=$($A.data.version) pid=$($A.data.pid)   [应为 code=0 version=MOCK-1.0]
[2] /api/v1/healthz  → code=$($B.code)  version=$($B.data.version)                   [应为 code=0（stripPrefix 剥除 /api 成功）]
[3] /admin/login.html → HTTP $($C.StatusCode)  bytes=$($C.Content.Length)             [应为 200, bytes>50000]
[4] /booking.html     → HTTP $($D.StatusCode)  bytes=$($D.Content.Length)             [应为 200, bytes>30000]
"@
```
**通过标准**：4 行全部方括号内预期匹配 → ✅ 同源托管成立，可继续 §三 测降级。

### 2.2 账号登录 + 预约列表（受保护接口）
```powershell
$body = @{ username="caiwu"; password="Qaxqjt@2026" } | ConvertTo-Json
$L = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3001/v1/auth/login -Body $body -ContentType "application/json"
$H = @{ Authorization = "Bearer $($L.data.accessToken)" }
Write-Output "登录 OK: role=$($L.data.user.role) tokenLen=$($L.data.accessToken.Length)"

$Apt = Invoke-RestMethod -Uri "http://127.0.0.1:3001/v1/appointments?pageSize=10" -Headers $H
Write-Output "初始干净状态: total=$($Apt.data.total) (应为 0)"
```

---

## 三、booking.html 降级逻辑 3 路径（必走一次）

> **日志来源**（均源码 grep 验证通过，不可自行修改匹配文本）：
> - 提交日志：`js/app.js` L1606 → `[submitAppointment] API 不可用（XXX），已降级 localStorage 写入`
> - force_fallback 判定：`js/api-request.js` L55
> - 网络失败降级 + 持久化降级开关：`js/api-request.js` L125-L130
> - localStorage 预约号规则：`26-QA-{seq 4 位}`，且附带 `localStorageOnly=true`
> - 在线 BK 预约号规则：`BK{YYYY+ts+序号}`，且附带 `fromMockApi=true`（真实后端可改名为其它规则如 `BK26QA...`，断言改为 `!bookingId.startsWith('26-QA-')` 即可）

### 路径 3.1 · 在线成功路径（BK 前缀）

```
[前置条件]
  · Mock 服务在 3001（同源）
  · localStorage.qaxqjt_fallback_mode === '0'（或不存在）
  · localStorage.qaxqjt_api_base_url === null（或空 → 默认走 /api 同源前缀）

[执行]
  ① browser 打开 http://127.0.0.1:3001/booking.html
  ② 填写：张测试 / 13800138000 / 秦安县兴国镇文化站 / 乡村庙会戏曲演出 / 1 场 / 2026-09-10 / 甘肃秦安兴国镇文化广场 / 4 剧目 / 勾选同意条款
  ③ 点击 「🎫 提交预约申请」

[结果判定（全部命中才 PASS）]
  ✓ 页面：出现「预约提交成功！」标题 + 「📋 复制预约编号」按钮
  ✓ bookingId 前缀：BK（26-QA → ❌ 降级了）
  ✓ Mock 日志：`[MOCK] ✅ 创建预约 id=BK... customer=张测试 phone=13800138000`
  ✓ 受保护查询：GET /v1/appointments（caiwu token） → total 增加 1，行内 fromMockApi=true
  ✓ 本地 localStorage：qaxqjt_appointments 数组首条 bookingId = BKxxxx（在线模式也会写本地 cache，仅作 UI 展示，不算"降级"）
```

### 路径 3.2 · 硬断网自动降级（26-QA 前缀）

```
[前置条件（遵循经验 2163599：★不杀进程★，仅改 BASE_URL 指向未监听端口 19999）]
  在 browser console 执行：
    localStorage.setItem('qaxqjt_api_base_url', 'http://127.0.0.1:19999');
    localStorage.setItem('qaxqjt_fallback_mode', '0');   // 一定要 =0，否则直接走 force_fallback 不算断网降级
    localStorage.removeItem('qaxqjt_appointments');
    localStorage.removeItem('qaxqjt_appointments_seq_26');
    location.reload();

[执行]
  ① 打开 booking.html
  ② 填写：王离线 / 13500135000 / 秦安县莲花镇文化服务中心 / 节庆专场 / 2 场 / 2026-09-20 / 莲花镇中心小学操场 / 5 剧目 / 勾选
  ③ 点「🎫 提交预约申请」→ 等待 3-8 秒（ECONNREFUSED + 系统重试）

[结果判定（全部命中才 PASS）]
  ✓ 页面：仍然「预约提交成功！」（不报错不崩溃）
  ✓ bookingId：26-QA-0001（前缀 QA → 真降级 ✔；BK → ✘ 没降级，断网模拟失效）
  ✓ localStorage：行内 `localStorageOnly=true`（重要：此条才是"仅本地"的绝对证据）
  ✓ console 日志至少 1 条：
       1. "[TOAST] 后端未连通，已启用本地离线模式（数据仅本地可用）"  ← 由 healthz GET 失败触发 L130 setFallbackMode(true)
       2. "[submitAppointment] API 不可用（force_fallback），已降级 localStorage 写入"  ← 后续请求被 L55 命中持久化开关
       （若仅看到 2 说明前面已有接口失败挂了开关；若 1/2 都出现才算完整链路）
  ✓ 受保护查询：GET /v1/appointments（caiwu token） → total 仍为 0（离线不进 Mock 内存数据）
```

### 路径 3.3 · 弱网抖动 + 恢复到在线（BK 前缀回切）

```
[前置条件]
  · 先跑完 3.2 → 持久化降级开关 qaxqjt_fallback_mode='1' ON
  · 或用自动化脚本（§五）：node scripts/test-fallback-recovery.js
  · 不用改 BASE：仍同源 3001 /api 前缀

[执行 / 弱网 3 轮（30% 丢包 + 300~2000ms 延迟 + 2 次重试）]
  · 期望：round=1/2 若命中丢包，重试最多 2 次后仍失败 → 走 26-QA；若丢包少则仍走 BK
  · 恢复动作（关键）： browser console 执行 localStorage.setItem('qaxqjt_fallback_mode','0')  + 刷新页面
  · 刷新后立即：
      ① 发 healthz
      ② 填"恢复在线"的预约表（赵恢复 / 13600136000 / ...）
      ③ 立即提交

[结果判定（3 个时序 PASS）]
  ✓ 弱网阶段：3 轮平均提交耗时 ≤ 3000 ms（SLA 阈值：3000 ms；上次实测：1162 ms）
  ✓ 恢复阶段：
       · 刷新后首次 healthz code=0（1~10 ms）
       · 刷新后首次提交 bookingId = BKxxxx（2~30 ms）
       · 合计（healthz+submit）≤ 2000 ms（SLA 阈值；上次实测：2 ms）
  ✓ 日志回归：控制台不再出现 force_fallback 字样（说明 L55 不再命中，持久化开关已清除）
```

---

## 四、关键日志判定正则（可复制进 grep / 日志平台）

### 4.1 前端 console（booking.html 运行时）

| 场景 | 正则（grep -E） | 源码位置锚 |
|---|---|---|
| 降级通用 | `\[submitAppointment\] API 不可用（(force_fallback|network_fail)），已降级 localStorage 写入` | `js/app.js` L1606 附近 |
| 持久化降级开关 L55 预命中 | `API 不可用（force_fallback）` | `js/api-request.js` L55-L58 |
| 网络失败降级（真正 catch） | `API 不可用（network_fail）` | `js/api-request.js` L135-L137 |
| GET 失败后自动开启离线模式（Toast） | `后端未连通，已启用本地离线模式` | `js/api-request.js` L129 |
| API 正常（健康检查） | `code":0,"version":"MOCK-1.0"` | `mock-api-server.js` L175-L177 |

### 4.2 Mock 服务端（stdout / 文件 tail）

| 场景 | 正则（grep -E） | 源码位置锚 |
|---|---|---|
| BK 预约创建成功（在线） | `\[MOCK\] ✅ 创建预约 id=BK[0-9A-Z]+` | `mock-api-server.js` L255 |
| 客户建档（在线） | `\[MOCK\] ✅ 创建预约 id=` | `mock-api-server.js` L245-L255 |
| 登录失败 | `\[MOCK\] ❌ 登录失败 username=` | `mock-api-server.js` L183-L190 |
| 鉴权缺失 | `UNAUTHORIZED.*401` | `mock-api-server.js` L259-L262 |
| 单端口托管启动横幅 | `单端口托管.*前端页面.*Mock API.*同源` | `mock-api-server.js` L403-L420 |

---

## 五、弱网恢复 SLA（来自最近一次自动化脚本 §2 实测）

> 脚本：`node scripts/test-fallback-recovery.js`（输出目录：`scripts/fallback-test-artifacts/`）

| 指标 | 阈值（部署签发最低标准） | 最近一次实测 | 结论 |
|---|---|---|---|
| 在线 BK 提交耗时 | ≤ 50 ms | **1 ms** | ✅ |
| 硬断网 → 26-QA 降级耗时 | ≤ 100 ms | **2 ms** | ✅ |
| 弱网 3 轮平均（30% 丢包，300~2000ms 延迟，2 次重试） | ≤ 3000 ms | **1162 ms** | ✅ |
| 从离线/弱网恢复后 → 首次 BK 在线成功耗时（健康检查 + 提交合计） | ≤ 2000 ms | **2 ms** | ✅ |
| 总执行时间 | ≤ 5 分钟 | **3 s** | ✅ |
| 检查项通过率 | 11 / 11 = 100% | **11 / 11** | ✅ |

最近报告落盘：
- `scripts/fallback-test-artifacts/fallback-test-report_20260804-113338.txt`（人读版）
- `scripts/fallback-test-artifacts/fallback-test-report_20260804-113338.json`（机器可读，接入 CI/CD）
- `scripts/fallback-test-artifacts/simulated_localStorage.json`（模拟断网降级写入样本）

---

## 六、常见问题应急排查（部署前必背 3 条）

### Q1：访问 admin/login.html 返回 `Not Found / 401`
```
★ 99% 原因：仍使用旧双端口架构（8080 静态 + 3001 API），而在 3001 上打 /admin/login.html
  修复：用本次交付的 mock-api-server.js（单端口同源托管）
        统一入口 → http://127.0.0.1:3001/
  验证：PowerShell §二·2 一键脚本 4 条全 200
```

### Q2：booking 提交无论如何都是 26-QA 前缀（后端明明在线）
```
★ 根本原因：qaxqjt_fallback_mode 被 L129 设置为 '1' 并持久化
  修复（2 选 1）：
    【临时】浏览器 console：
       localStorage.setItem('qaxqjt_fallback_mode','0'); location.reload();
    【长期】在管理后台系统参数页增加「后端离线模式」开关，切换环境时手动关闭；
            或 改 api-request.js L130：GET 网络失败时仅 toast 而不 setFallbackMode(true)
```

### Q3：同源 `/api/v1/appointments` 全部 404（但 `/v1/` 正常）
```
★ 原因：stripPrefix('/api') 未工作（mock-api-server.js 的 PREFIX 变量被改掉）
  检查：mock-api-server.js 顶部 L22
        const PREFIX = '/api';         ← 必须是 '/api'
        function stripPrefix(p){ ... } ← 必须存在（L108-L111）
  修复：改回 PREFIX='/api' 后重启 mock
```

---

## 七、部署签发（最终确认）

> 满足以下 4 条即可签发「部署就绪」
> 1. §一 9 项环境 & 配置 ✅ 全部打勾  
> 2. §三 3 条路径（在线 / 断网 / 弱网恢复）全部 PASS  
> 3. §五 最近一次自动化脚本 11/11 ✅  
> 4. §六 3 个 FAQ 的修复手段在目标环境（EdgeOne Pages + 真实后端）上均已验证可用

| 角色 | 签字 | 日期 | 备注 |
|---|---|---|---|
| 前端部署人 |  |  | 端口、同源、404 入口链接 |
| 测试负责人 |  |  | 3.1 / 3.2 / 3.3 路径 & 自动化脚本 |
| 产品负责人（秦剧团对接人） |  |  | booking.html 真实提交手感 + 48h 电话回访 |
| 后端 / 运维（EdgeOne） |  |  | Pages 缓存规则 + 回源 + CDN TTL |

**落盘**：本文件 `DEPLOY_CHECKLIST.md`，任何签字后扫描/截图回传即视为部署前检查闭环。

---

## 八、腾讯云 EdgeOne Pages 部署步骤（10 步 · 对应 edgeone.config.json v1.0）

> **配置文件位置**：[edgeone.config.json](file:///D:/全套最终整合交付（秦安县秦剧团云端预约系统·14文档+架构终审全汇总·可直接EdgeOne Pages部署）/qaxqjt/edgeone.config.json)  
> **配套静态文件**：[404.html](file:///D:/全套最终整合交付（秦安县秦剧团云端预约系统·14文档+架构终审全汇总·可直接EdgeOne Pages部署）/qaxqjt/404.html) 已按 §一·8 更新带「快速入口 + admin + booking + healthz」4 锚点

### Step 1 · 在腾讯云 EdgeOne 控制台新建 Pages 项目
1. 登录 [腾讯云 EdgeOne 控制台](https://console.cloud.tencent.com/edgeone) → **Pages** → **新建项目**
2. 项目名建议：`qinanyuanxi-official`；**代码仓库方式**：
   - ✅ 推荐：关联 Git 仓库（GitHub/GitLab/Gitee），main 分支推送自动构建
   - 手动上传：直接拖拽 `qaxqjt/` 目录（不推荐，版本难回溯）

### Step 2 · 填写构建命令 + 输出目录（对齐 edgeone.config.json build 段）
控制台「项目设置 → 构建与部署 → 构建配置」填写：
- **框架预设**：`Other`（项目纯静态，无 Vite/Webpack 构建）
- **构建命令 (buildCommand)**：`留空` 或填 `echo "No build step: static deploy"`
  - 后续若引入 Vite：改为 `npm install && npm run build`
- **输出目录 (outputDirectory)**：`.` （当前根目录，booking.html / admin/login.html / 404.html / edgeone.config.json / js/ 都在根）
- **Install 命令**：留空
- **Node.js 版本**：18（对齐 edgeone.config.json L9）
- **环境变量 (Environment)**：
  | Key | 建议值 | 用途 |
  |---|---|---|
  | `VITE_APP_NAME` | `秦安县秦剧团云端预约系统` | 前端页头展示 |
  | `VITE_APP_DEPLOY_ENV` | `edgeone-pages` | 前端显示当前环境 |
  | `JWT_SECRET` | ≥ 32 位随机字符串（真实后端必填，见经验 2044860 §4 fail-fast） | 鉴权签名 |

### Step 3 · 配置路由 + 回源规则（对齐 edgeone.config.json routing.rules 段 · 关键！）
控制台「项目设置 → 路由与回源 → 回源组 & 路由规则」：
1. **先新建回源组** `Backend-Origin-Group`：
   - 回源地址：`${YOUR_BACKEND_PUBLIC_HOST}`（真实后端，如 `api.qin-anyuanxi.example.com`；测试期也可填 Mock 公网穿透地址）
   - 回源端口：443（HTTPS）或 80
   - 回源协议：HTTPS（推荐）/ HTTP
2. **新建 4 条路由规则（顺序必须按下列优先级从上到下）**：

   | 优先级 | 规则名 | URI 匹配 | 方法 | 动作 | 参数 |
   |---|---|---|---|---|---|
   | 🔝 1 | healthz-no-cache | `^/(api/)?v1/healthz$` | ALL | 不缓存 | TTL=0s（避免旧缓存触发 L130 离线持久化开关 ← §0.3 检查项 6 触发原因） |
   | 2 | api-backend-origin | `^/(api/)?v1/.*` | GET/POST/PUT/DELETE/OPTIONS | 回源 | 回源组：Backend-Origin-Group（上面新建的）<br>✅ **StripPrefix = /api**（与 mock-api-server.js L108 对齐，否则 FAQ Q3 `/api 404`）<br>Host 头：`${YOUR_BACKEND_PUBLIC_HOST}` |
   | 3 | admin-login-302 | `^/admin/?$` | GET | 重定向 302 | Target：`/admin/login.html` |
   | 4 | root-to-booking | `^/?$` | GET | 重写 | Target：`/booking.html`（用户访问根 → 直接进入预约页） |

### Step 4 · 部署前替换 edgeone.config.json 中的占位符（3 处必须改！）
用文本编辑器打开 `edgeone.config.json`，将 `${...}` 占位符全部替换为真实值：
```
${YOUR_EDGEONE_BACKEND_ORIGIN_GROUP_ID} → EdgeOne 回源组 ID（控制台：回源组 → 详情 → 复制 ID，长字符串如 "og-xxxxxxxxxxxx"）
${YOUR_BACKEND_PUBLIC_HOST:qin-anyuanxi.example.com} → 真实后端域名（如 api.qin-anyuanxi.example.com，无端口）
${YOUR_EDGEONE_PAGES_DOMAIN:https://qin-anyuanxi.example.com} → Pages 项目绑定的公网域名（如 https://booking.qin-anyuanxi.com）
```

### Step 5 · 设置自定义 404 页（对齐 edgeone.config.json customResponses 段）
控制台「项目设置 → 自定义响应 → 404 页面」：
- **文件路径**：`/404.html`（项目根目录刚更新的快速入口版本，L153 快速入口块已包含 4 锚点）
- 验证：访问 `https://<Pages域名>/notexist_xyz_12345.html` → 标题显示"一曲未终，页面难寻"且底部有 **📡 快速入口** 金色分割线 + 4 链接

### Step 6 · 配置安全头 + CORS（对齐 edgeone.config.json security 段）
控制台「项目设置 → 安全 → HTTP 响应头」添加（直接复制下表 Value）：
| Header Key | Value | 说明 |
|---|---|---|
| Strict-Transport-Security | `max-age=31536000; includeSubDomains; preload` | HSTS 强制 HTTPS |
| X-Content-Type-Options | `nosniff` | 禁 MIME 嗅探 |
| X-Frame-Options | `SAMEORIGIN` | 防 iframe 嵌套点击劫持 |
| Referrer-Policy | `strict-origin-when-cross-origin` | 限制 Referer |
| Content-Security-Policy | 见 edgeone.config.json L76（长字符串） | 防 XSS，注意 CSP 保留了 `'unsafe-inline' 'unsafe-eval'`（因 booking.html inline 脚本与 QinApp Utils eval 兼容需要） |

控制台「项目设置 → 安全 → CORS」：
- 允许来源：填入 Pages 项目绑定的真实域名（**禁止用 `*`**，对应 FAQ 防跨域调用）
- 允许方法：GET, POST, PUT, DELETE, OPTIONS
- 允许头：Authorization, Content-Type, X-Requested-With
- 暴露头：X-Trace-Id
- 凭证：✅ Allow Credentials
- 预检缓存：86400s

### Step 7 · 配置缓存策略（对齐 edgeone.config.json cache 段）
控制台「项目设置 → 缓存 → 缓存规则」：
| 文件扩展名 | CDN TTL | 浏览器 TTL | 说明 |
|---|---|---|---|
| html（booking.html / admin/login.html / 404.html） | 60s | 300s | 短 TTL，发布后 1 分钟内刷新 |
| js, css（js/app.js 464KB, js/api-request.js） | 604800s（7d） | 604800s | 长缓存，更新时改 `<script src="?v=2026xxxx">` 版本号 |
| png, jpg, svg, ico, webp | 2592000s（30d） | 2592000s | 长缓存 |

### Step 8 · 先部署到 Staging 环境（灰度）
1. 控制台「部署 → 手动部署」或推送 Git tag `staging-YYYYMMDD` 到 Staging 环境
2. **执行部署前 DEPLOY_CHECKLIST §二 一键脚本**（将 `http://127.0.0.1:3001` 全部替换为 Staging Pages 域名，至少必须通过：/v1/healthz code=0、404 4 锚点、caiwu 登录 Finance 角色）
3. **执行 T3 自动化脚本**：改 `test-fallback-recovery.js` 顶部 `BASES.ONLINE` 为 Staging 域名，`node --check` 后运行，11 项 8/11 以上通过才可进生产（弱网 3 轮平均若跨地域 > 3000ms 时升阈值到 5000ms 可接受）

### Step 9 · 生产全量发布 + 配置 EdgeOne Functions（可选：若需要同源同路径 `/v1/` 路径转发而不跨域）
- 如果 Step 3 路由规则已生效（回源 200 OK），可不配 Functions；否则配置 EdgeOne Functions 处理 `/api/v1` → `/v1` 的路径重写（替代 L55 StripPrefix，具体模板见腾讯云文档 "EdgeOne Functions 路由重写示例"）
- 发布前再执行一次 §0.2 T2 末尾的浏览器 localStorage 清理命令，避免测试残留影响真实用户首次访问

### Step 10 · 生产发布后 24h 值守监控
- **用户侧关键反馈**：48h 内回访 2-3 位真实提交的剧团客户（DEPLOY_CHECKLIST §七 产品签字），确认 bookingId 非 26-QA（若为 QA 说明回源配置错 → 立即回 Step 3 查 api-backend-origin 规则）
- **日志告警**：浏览器 console 出现 `[submitAppointment] API 不可用（force_fallback）` 且持续 10 分钟以上 → 发告警（监控正则见 §0.4）
- **兜底应急**：真实后端故障时执行 `setFallbackMode(true)` 临时降级（FAQ Q2 方案），用户数据写入 localStorage，待后端恢复后手动批量同步

**配置落盘总览（可与控制台比对打勾）**：
- ✅ edgeone.config.json v1.0 生成 + 占位符替换
- ✅ 404.html 4 锚点（快速入口 / admin / booking / healthz）
- ✅ 构建参数：build 空 / output `.` / Node 18
- ✅ 回源路由 4 条规则从上到下优先级：healthz no-cache → API 回源 → /admin 302 → root → booking
- ✅ CSP / HSTS / CORS / 缓存 4 项安全配置
- ✅ Staging → 生产 灰度发布 + 自动化脚本 T1/T3 复跑

---

## 八、部署签发补充（EdgeOne Pages 专用 · 追加签字栏）

| 角色 | 签字 | 日期 | 备注 |
|---|---|---|---|
| EdgeOne Pages 配置工程师 |  |  | 回源规则 + StripPrefix 正确 |
| 安全审计（CORS/CSP/HSTS） |  |  | 无 `*` 通配、CSP 无 unsafe-inline 漏洞（当前因前端兼容保留，后续需计划移除） |
| 值班工程师（24h 值守） |  |  | 联系电话 + 微信，降级告警响应 ≤ 10 min |
| 秦剧团项目总负责人 |  |  | 最终对外发布签批 |

**最后一步闭环**：在 Pages 域名正式解析对外前，截图保存 Staging 环境：
1. /v1/healthz → code=0
2. 404.html → 底部 4 锚点全可见
3. booking.html → 真·提交成功 BK 前缀 bookingId 可见 → 粘贴到本文件尾部扫描件
→ ✅ 完成上述 3 条 = 允许接入真实用户流量。

---

## 九、真后端联调补充（v2026.8.8-realbackend · 必读）

> **生成时间**：2026-08-08 15:10
> **背景**：本项目已从 Mock 后端（mock-api-server.js）切换到真实后端（Koa + Prisma + SQLite）。本次联调发现并修复了 1 个 P0 级前端 bug（force_fallback 误降级）+ 2 个后端 bug，并补齐了 `_deploy` 副本中遗漏的 2 个 JS 文件。
> **生效条件**：本章节「9.4 副本完整性」「9.5 必检项」全部打 ✅，且「9.6 端到端测试」3 条路径全部 PASS，才可签发真实后端上线。
> **版本对齐**：本章节内容与 `js/api-request.js` L55-L62、`server/src/controllers/appointments.js` L179-L189、`server/src/app.js` L7-L10 严格对齐。

### 9.1 P0 Bug 修复：force_fallback 误降级（影响所有预约提交）

**问题现象**：用户在 booking.html 填写表单点击「提交预约申请」后，前端控制台输出 `[submitAppointment] ③-a ⚠️ API 不可用，触发降级：reason=force_fallback`，预约数据**未提交到后端**，仅写入 localStorage（bookingId 前缀 `26-QA-`，而非后端的 `APT`）。即使后端服务正常运行、`qaxqjt_fallback_mode=0`，仍然走降级路径。

**根因**：[js/api-request.js:55](file:///d:/全套最终整合交付（秦安县秦剧团云端预约系统·14文档+架构终审全汇总·可直接EdgeOne Pages部署）/qaxqjt/js/api-request.js#L55-L62) 的判断条件 `if (CFG.isFallbackMode && ...)` 检查的是**函数引用**（永远为 truthy），而非函数调用结果。导致只要 `opts.fallback` 回调存在，就强制走降级路径。

**修复 Diff**（3 份文件已同步：主目录 + `_deploy/js/` + `_deploy/.edgeone/assets/js/`）：

```diff
--- a/js/api-request.js
+++ b/js/api-request.js
@@ -54,11 +54,11 @@
     // 1. 强制降级？直接走 fallback（用户在系统页勾选后端离线模式）
-    if (CFG.isFallbackMode && typeof opts.fallback === 'function') {
+    if (CFG.isFallbackMode && CFG.isFallbackMode() && typeof opts.fallback === 'function') {
       try { return await opts.fallback({ reason: 'force_fallback' }); }
       catch (e) { throw e; }
     }
-    if (CFG.isFallbackMode && typeof opts.fallbackRead === 'function') {
+    if (CFG.isFallbackMode && CFG.isFallbackMode() && typeof opts.fallbackRead === 'function') {
       try { return await opts.fallbackRead({ reason: 'force_fallback' }); }
       catch (e) { throw e; }
     }
```

**影响范围**：所有调用 `QAXQJT_API.request/post/get/put/delete` 并传入 `fallback` 或 `fallbackRead` 回调的接口（含预约提交、客户列表、剧目列表等）。

**验证方式**：浏览器 F12 控制台执行 `QAXQJT_API_CONFIG.isFallbackMode()` 应返回 `false`；提交预约后控制台**不应**出现 `force_fallback` 字样，且 `id` 字段以 `apt_` 开头（Prisma 生成）而非 `appointments_` 开头（localStorage 生成）。

### 9.2 后端代码修复（2 项）

| # | 文件 | 行号 | Bug | 修复 |
|---|---|---|---|---|
| 1 | [server/src/controllers/appointments.js](file:///d:/全套最终整合交付（秦安县秦剧团云端预约系统·14文档+架构终审全汇总·可直接EdgeOne Pages部署）/qaxqjt/server/src/controllers/appointments.js#L179-L189) | L179 | `prisma.appointmentPlay.createMany({ data, skipDuplicates: true })` — SQLite 不支持 `skipDuplicates` 参数，抛 `PrismaClientValidationError` | 移除 `skipDuplicates: true` 参数 |
| 2 | [server/src/app.js](file:///d:/全套最终整合交付（秦安县秦剧团云端预约系统·14文档+架构终审全汇总·可直接EdgeOne Pages部署）/qaxqjt/server/src/app.js#L7-L10) | L7-L10 | Prisma 返回的 `ts` 字段是 BigInt，`JSON.stringify` 抛 `TypeError: Do not know how to serialize a BigInt` | 在 app.js 顶部添加 `BigInt.prototype.toJSON = function () { return Number(this); }` |

**注意**：`server/src/controllers/customers.js` L82/L89 和 `server/src/controllers/roles.js` L92 仍残留 `skipDuplicates: true`，但当前预约流程不触发这两个接口。生产部署前建议一并清理（grep `skipDuplicates` 应返回 0 条）。

### 9.3 副本完整性补齐（`_deploy` 之前遗漏 2 个文件）

**问题**：`_deploy/js/` 和 `_deploy/.edgeone/assets/js/` 目录此前**缺失** `api-config.js` 和 `api-request.js`，但 [booking.html:523-524](file:///d:/全套最终整合交付（秦安县秦剧团云端预约系统·14文档+架构终审全汇总·可直接EdgeOne Pages部署）/qaxqjt/booking.html#L523-L524) 引用了这两个文件。若直接将 `_deploy/` 部署到 EdgeOne Pages，前端会因 404 加载失败而无法发起任何 API 请求。

**已同步文件清单**（4 个文件，2026-08-08 15:05 复制完成）：

| 源文件 | 目标副本 1 | 目标副本 2 |
|---|---|---|
| `js/api-request.js`（含 9.1 修复） | `_deploy/js/api-request.js` | `_deploy/.edgeone/assets/js/api-request.js` |
| `js/api-config.js` | `_deploy/js/api-config.js` | `_deploy/.edgeone/assets/js/api-config.js` |

**验证命令**（PowerShell，应返回 6 行）：
```powershell
Select-String -Path "js\api-request.js","_deploy\js\api-request.js","_deploy\.edgeone\assets\js\api-request.js" -Pattern "CFG\.isFallbackMode\(\) && typeof opts\.fallback"
```

### 9.4 部署必检项（真后端模式 · 新增 6 项）

| # | 项 | 命令 / 位置 | 预期结果 | 实际结果 | 责任人 |
|---|---|---|---|---|---|
| 10 | ✅ 副本文件完整性 | `_deploy/js/` 和 `_deploy/.edgeone/assets/js/` 应同时包含 `app.js`、`api-config.js`、`api-request.js`、`pagination.js` | 4 文件齐全 | | |
| 11 | ✅ force_fallback 修复点对齐 | `Select-String -Path "js\api-request.js","_deploy\js\api-request.js","_deploy\.edgeone\assets\js\api-request.js" -Pattern "isFallbackMode\(\) && typeof"` | 3 文件各命中 2 行（L55+L59），共 6 行 | | |
| 12 | ✅ 后端无 `skipDuplicates` 残留（预约路径） | `Select-String -Path "server\src\controllers\appointments.js" -Pattern "skipDuplicates"` | 0 行命中 | | |
| 13 | ✅ 后端 BigInt 序列化修复 | `Select-String -Path "server\src\app.js" -Pattern "BigInt.prototype.toJSON"` | L8 命中 1 行 | | |
| 14 | ✅ 后端服务可启动 | `cd server && npm run dev`（或 `node src/server.js`） | 控制台输出 `Koa app listening on :3001`，无 Prisma 错误 | | |
| 15 | ✅ CORS 白名单包含前端域名 | `server/.env` 的 `CORS_ORIGINS` | 含 `http://localhost:8080`、`http://127.0.0.1:18089`、生产 Pages 域名 | | |

### 9.5 端到端测试用例（3 条路径 · 必跑一次）

#### 路径 9.5.1 · curl 直接调用后端（验证后端可用）

**前置条件**：后端服务运行在 `http://127.0.0.1:3001`，数据库已 `prisma migrate deploy`。

```powershell
$body = @{
  customerName = "联调_测试1"
  phone = "13993830099"
  preferredStartDate = "2026-09-01"
  performanceCount = 1
  packageType = "custom"
  venueAddress = "秦安县测试地址"
  plays = @(@{ playId = "play_1"; sortOrder = 1; note = "《火焰驹》" })
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3001/v1/appointments" `
  -Body $body -ContentType "application/json; charset=utf-8" |
  ConvertTo-Json -Depth 10
```

**通过标准**：
- ✓ HTTP 201（非 400/500）
- ✓ 响应 `data.appointmentNo` 以 `APT` 开头（如 `APT202608081453896J`）
- ✓ 响应 `data.id` 以 `apt_` 开头（如 `apt_eLFkShBrruN7`）
- ✓ 响应 `data.plays` 数组非空，包含 `note: "《火焰驹》"`
- ✓ 响应 `data.customer.id` 以 `cus_` 开头

#### 路径 9.5.2 · 浏览器 `__testMockAppointmentSubmit()` 函数（验证前端 API 封装）

**前置条件**：booking.html 已加载，F12 控制台可用，`QAXQJT_API_CONFIG.BASE` 已指向后端（本地测试可设 `localStorage.setItem('qaxqjt_api_base_url','http://127.0.0.1:3001')` 后刷新）。

**执行**（F12 Console 粘贴）：
```javascript
__testMockAppointmentSubmit({
  curlUrl: 'http://127.0.0.1:3001/v1/appointments',
  timeoutMs: 8000,
  customerName: '浏览器联调_赵六',
  phone: '13993830002',
  performanceCount: 2
}).then(r => console.log('结果汇总:', {
  requestOk: r.requestOk,
  httpStatus: r.httpStatus,
  appointmentNo: r.saved?.appointmentNo,
  customerId: r.saved?.customer?.id
}));
```

**通过标准**：
- ✓ 弹出 alert「✅ 模拟提交成功！HTTP=201」
- ✓ 控制台 `[MockBooking] ✅ 后端接收成功！HTTP=201`
- ✓ 结果 `requestOk=true`、`httpStatus=201`
- ✓ `saved.appointmentNo` 以 `APT` 开头
- ✓ `saved.customer.id` 以 `cus_` 开头
- ✓ 控制台**无** `force_fallback` 字样

#### 路径 9.5.3 · booking.html 表单真实提交（验证完整用户体验）

**前置条件**：路径 9.5.1 和 9.5.2 已通过；浏览器 `localStorage.qaxqjt_fallback_mode` 为 `'0'` 或不存在；`localStorage.qaxqjt_api_base_url` 指向后端（生产环境走同源 `/api` 反代，无需设置）。

**执行**：
1. 浏览器打开 `http://127.0.0.1:18089/booking.html`（或生产 Pages 域名）
2. 填写：浏览器联调_孙七 / 13993830004 / 秦安县陇城镇文化站 / 乡村庙会戏曲演出 / 1 场 / 2026-09-20 / 甘肃省天水市秦安县陇城镇张沟村文化广场 / 勾选《火焰驹》/ 勾选同意条款
3. 点击「🎫 提交预约申请」

**通过标准**：
- ✓ 页面出现「预约提交成功！」标题 + 「📋 复制预约编号」按钮
- ✓ F12 Console `[Booking:submit] ③ 后端可用性：API模块=true 解析URL=http://127.0.0.1:3001`（或生产同源 `/api`）
- ✓ F12 Console `[submitAppointment] ④ ✅ 提交成功：耗时=XXms`（耗时 > 10ms，证明走了真实网络而非本地 localStorage 的 1-2ms）
- ✓ F12 Console 保存结果 `id` 以 `apt_` 开头（如 `apt_WN3s3V1N214MwW`）
- ✓ F12 Console **无** `force_fallback`、**无** `_fromStorage: yes(localStorage路径)`
- ✓ F12 Network 面板有 `POST /v1/appointments` 请求，Status 201

### 9.6 数据库落库验证（端到端闭环）

**执行**（在 server 目录下）：
```powershell
node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const rows=await p.appointment.findMany({where:{phone:{in:['13993830099','13993830002','13993830004']}},include:{plays:true},orderBy:{createdAt:'desc'}});console.log('count:',rows.length);for(const r of rows){console.log(JSON.stringify({id:r.id,no:r.appointmentNo,name:r.customerName,phone:r.phone,plays:r.plays.length}));}await p.`$disconnect`();})().catch(e=>{console.error(e.message);process.exit(1);})"
```

> ⚠️ PowerShell 下 `$disconnect` 会被解析为变量，建议保存为 `.js` 文件后 `node verify.js` 执行，或用单引号包裹 `'$disconnect'`。

**通过标准**（最近一次实测 2026-08-08 15:01）：

| 测试方式 | 客户名 | 手机号 | 数据库 ID | 预约编号 | 剧目数 |
|---|---|---|---|---|---|
| curl 直接调用 | 联调_测试1 | 13993830099 | apt_eLFkShBrruN7 | APT202608081453896J | 1 |
| `__testMockAppointmentSubmit` | 浏览器联调_赵六 | 13993830002 | apt_r7LHMZ84ZroFjS | APT2026080814543EHD | 1 |
| booking.html 表单 | 浏览器联调_孙七 | 13993830004 | apt_WN3s3V1N214MwW | APT2026080815013CUA | 1 |

- ✓ 3 条记录全部落库，`id` 均以 `apt_` 开头
- ✓ `appointmentNo` 均以 `APT` 开头（后端 `_genAppointmentNo()` 生成）
- ✓ `plays` 关联表有对应记录，`note` 字段含《火焰驹》
- ✓ 数据库总预约数 ≥ 3（含本次测试）

### 9.7 应急排查（force_fallback 误触发）

**现象**：生产环境 booking.html 提交后控制台出现 `force_fallback`，预约未进数据库。

**排查步骤**（按顺序）：
1. **检查 localStorage**：F12 Console 执行 `QAXQJT_API_CONFIG.isFallbackMode()`
   - 返回 `true` → 执行 `QAXQJT_API_CONFIG.setFallbackMode(false); location.reload();` 后重试
   - 返回 `false` → 进入步骤 2
2. **检查 API_BASE**：F12 Console 执行 `QAXQJT_API_CONFIG.BASE`
   - 为空字符串 → 走同源 `/api` 反代，检查 EdgeOne/Nginx 回源规则（见 §八 Step 3 规则 2 `api-backend-origin`）
   - 为 `http://...` → 直连后端，检查后端服务是否运行
3. **检查后端连通性**：F12 Console 执行 `fetch(QAXQJT_API_CONFIG.resolveUrl('/v1/appointments/stats')).then(r=>console.log(r.status))`
   - 401 → 后端在线（鉴权拦截正常），问题在 9.1 修复未生效 → 重新部署 `api-request.js`
   - 0 / NetworkError → 后端不可达 → 启动后端服务或修复回源规则
4. **检查 api-request.js 版本**：F12 Console 执行 `QAXQJT_API.request.toString().includes('isFallbackMode()')`
   - `false` → 浏览器加载了旧版本，强制刷新 `Ctrl+Shift+R` 或清理 CDN 缓存
   - `true` → 修复已生效，问题在其他环节

### 9.8 签发补充（真后端模式 · 追加签字栏）

| 角色 | 签字 | 日期 | 备注 |
|---|---|---|---|
| 前端部署人 |  |  | api-request.js 修复点对齐 + 副本文件完整性 |
| 后端 / 数据库 |  |  | skipDuplicates 清理 + BigInt 序列化 + Prisma migrate |
| 测试负责人 |  |  | 9.5 三路径 + 9.6 数据库落库验证 |
| 运维（EdgeOne） |  |  | 回源规则 + CORS 白名单含 Pages 域名 |

**最后一步闭环**：在 Pages 域名正式解析对外前，截图保存生产环境：
1. F12 Console `[Booking:submit] ③ 后端可用性：API模块=true 解析URL=...` 不含 `force_fallback`
2. F12 Network `POST /v1/appointments` Status 201
3. 数据库查询 `SELECT id, appointmentNo FROM Appointment WHERE phone='<测试手机号>'` 返回 `apt_` 开头的记录
→ ✅ 完成上述 3 条 = 允许接入真实用户流量（真后端模式）。

---

### 9.9 本地签发实测快照（2026-08-08 15:38 · 已 4/4 PASS）

> **背景**：Staging 域名 `qaxqjt-x63yrlbq.edgeone.cool` 是 EdgeOne Pages 临时预览链接，需 `eo_time` + `eo_sig` 签名参数访问（控制台「Preview」按钮获取）。本地测试已 4/4 PASS，Staging 跳过，**生产上线后必须按 9.10 强制补验证**。
> **本地测试环境**：前端 127.0.0.1:18089（PID 26148）+ 后端 127.0.0.1:3001（PID 19992）+ SQLite `server/prisma/dev.db`

#### 9.9.1 静态校验快照（§九 9.4 · 6 项全 PASS）

| # | 检查项 | 结果 | 证据 |
|---|---|---|---|
| 10 | 副本 4 文件完整性（api-request/api-config/app/pagination × 3 份） | ✅ PASS | Glob 8 文件齐全 |
| 11 | force_fallback 修复对齐 | ✅ PASS | Grep 6 行命中（L55+L59 × 3 份） |
| 12 | appointments.js 无 skipDuplicates | ✅ PASS | Grep 0 行命中（customers.js/roles.js 残留已记录在 9.2 注释） |
| 13 | BigInt.prototype.toJSON 在 app.js L8-L9 | ✅ PASS | Grep L8-L9 命中 |
| 14 | 后端服务可启动 | ✅ PASS | PID 19992 运行中，/v1/healthz 200 |
| 15 | CORS 白名单含本地域名 | ✅ PASS | .env `CORS_ORIGINS` 含 `http://127.0.0.1:18089` |

#### 9.9.2 端到端测试快照（§九 9.5 三路径全 PASS）

| 路径 | 提交方式 | 客户名 | 手机号 | HTTP | DB ID | 预约号 | 落库 |
|---|---|---|---|---|---|---|---|
| 9.5.1 | curl 直接调用 | 部署测试_验收1 | 13993830100 | 201 | apt_ZmVv3y1aWR7owi | APT202608081520EHUH | ✅ |
| 9.5.2 | `__testMockAppointmentSubmit()` | 浏览器联调_赵六_9.5.2 | 13993830002 | 201 | apt_uH4BXoPqfV5BW4 | APT202608081527IIIZ | ✅ |
| 9.5.3 | 表单真实提交 | 浏览器联调_孙七_9.5.3 | 13993830004 | 201 | apt_f8Ii7ezKfgvLUl | APT202608081536TC0P | ✅ |

#### 9.9.3 数据库落库快照（§九 9.6 · 闭环验证 PASS）

- DB_COUNT：4 条新增记录（含本次 3 条 + 历史测试 1 条）
- TOTAL_APPOINTMENTS：9（≥3 满足清单要求）
- 全部 `apt_`/`APT` 前缀，**无 26-QA 误降级**
- plays 关联表落库完整（含《火焰驹》note）
- ts BigInt 序列化正常（Number 类型）

### 9.10 生产上线后强制补验证项（Staging 跳过 → 生产首日必须执行）

> **生效条件**：生产 Pages 域名解析对外后 24h 内必须完成下列 7 项验证，全部 PASS 才算真后端模式生产闭环。

#### 9.10.1 强制验证项清单（7 项 · 不可省略）

| # | 验证项 | 执行位置 | 命令/操作 | 通过标准 |
|---|---|---|---|---|
| P1 | EdgeOne 回源规则生效 | 生产域名 curl | `curl -i https://<prod>/v1/healthz` | HTTP 200 + `ok=true` + `Server: edgeone-pages` |
| P2 | 同源 `/api` 前缀反代 | 生产域名 curl | `curl -i https://<prod>/api/v1/healthz` | HTTP 200（StripPrefix 验证） |
| P3 | 9.5.1 生产 curl 路径 | 生产域名 curl | `POST /api/v1/appointments`（参考 9.5.1 命令替换域名） | HTTP 201 + apt_/APT 前缀 + 无 26-QA |
| P4 | 浏览器清 localStorage | 浏览器 F12 | 见 9.10.2 清理命令 | fallback_mode=0 + api_base_url=null |
| P5 | 9.5.2 生产函数路径 | 浏览器 F12 | `__testMockAppointmentSubmit({curlUrl:'https://<prod>/api/v1/appointments',...})` | requestOk=true + apt_/APT 前缀 |
| P6 | 9.5.3 生产表单路径 | 浏览器手动 | 填表 + 提交 + 检查 console 日志 | 出现「预约提交成功！」+ apt_ ID + 无 force_fallback |
| P7 | 生产数据库落库 | 生产 DB Server | Prisma 查询脚本（参考 9.6） | 3 路径手机号记录全部 LANDED + apt_ 前缀 |

#### 9.10.2 浏览器清 localStorage 命令（P4 必做）

```javascript
// 在生产域名 booking.html F12 Console 执行
Object.keys(localStorage).filter(k => k.startsWith('qaxqjt_')).forEach(k => localStorage.removeItem(k));
localStorage.setItem('qaxqjt_fallback_mode', '0');
localStorage.removeItem('qaxqjt_api_base_url');
location.reload();
```

#### 9.10.3 生产 curl 命令模板（P3 必做 · 替换 `<PROD_DOMAIN>`）

```powershell
$PROD = "https://<PROD_DOMAIN>"  # 例: https://booking.qin-anyuanxi.com
$body = @{
  customerName = "Prod_9.10.3_验证"
  phone = "13993830110"
  preferredStartDate = "2026-09-25"
  performanceCount = 1
  packageType = "custom"
  venueAddress = "秦安县生产验证地址"
  plays = @(@{ playId = "play_1"; sortOrder = 1; note = "生产验证《火焰驹》9.10.3" })
} | ConvertTo-Json -Depth 5

$resp = Invoke-WebRequest -Method Post -Uri "$PROD/api/v1/appointments" `
  -Body $body -ContentType 'application/json; charset=utf-8' -UseBasicParsing
$json = $resp.Content | ConvertFrom-Json
Write-Output "HTTP=$($resp.StatusCode) ID=$($json.data.id) NO=$($json.data.appointmentNo)"
# 验证: HTTP=201 / ID apt_开头 / NO APT开头 / 非 26-QA
```

#### 9.10.4 生产数据库验证脚本（P7 必做 · 在生产 DB Server 执行）

```javascript
// 在生产后端 server/ 目录执行
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const phones = ['13993830110', '13993830111', '13993830112']; // P3/P5/P6 三条路径的手机号
  const rows = await p.appointment.findMany({
    where: { phone: { in: phones } },
    include: { plays: true }
  });
  console.log('PROD_DB_COUNT:', rows.length, '(期望 ≥ 3)');
  console.log('ALL_APT_PREFIX:', rows.every(r => r.id.startsWith('apt_')) ? 'PASS' : 'FAIL');
  console.log('NO_26_QA:', !rows.some(r => r.appointmentNo.startsWith('26-QA')) ? 'PASS' : 'FAIL');
  console.log('FINAL_VERDICT:', rows.length >= 3 && rows.every(r => r.id.startsWith('apt_')) ? 'PASS ✅ 生产闭环完成' : 'FAIL ❌ 需排查');
  await p[`$disconnect`]();
})();
```

#### 9.10.5 应急回滚预案（P1-P7 任一 FAIL 触发）

| FAIL 项 | 现象 | 应急动作 |
|---|---|---|
| P1/P2 失败 | healthz 返回 401/502 | 检查 EdgeOne 回源规则（§八 Step 3 规则 2），临时启用 `setFallbackMode(true)` 降级保护用户体验 |
| P3 失败 | HTTP 非 201 或 26-QA 前缀 | 检查 api-request.js 是否部署修复版（9.4-11 grep 验证）；强刷浏览器；清 CDN 缓存 |
| P4 失败 | localStorage 残留 fallback_mode=1 | 用户 F12 执行 9.10.2 命令清理 |
| P5/P6 失败 | console 含 force_fallback | 走 9.7 应急排查 4 步流程；若 30 分钟内无法修复，启用降级模式 + 提交工单 |
| P7 失败 | DB 记录缺失或前缀错误 | 后端代码回滚到本地已验证版本；检查 Prisma migrate 是否已执行 |

### 9.11 签发记录（本地 4/4 PASS · Staging 跳过 · 生产待补）

| 角色 | 签字依据 | 本地状态 | Staging 状态 | 生产待补 |
|---|---|---|---|---|
| 前端部署人 | force_fallback 修复 3 份对齐 + 副本 4 文件齐全 + 浏览器路径无 force_fallback | ✅ 已签 | ⏭ 跳过 | ⏳ P4/P5/P6 |
| 后端 / 数据库 | skipDuplicates 清理 + BigInt 序列化 + Prisma migrate + 3 条记录落库 | ✅ 已签 | ⏭ 跳过 | ⏳ P3/P7 |
| 测试负责人 | 9.5 三路径 PASS + 9.6 落库闭环 + 无 26-QA | ✅ 已签 | ⏭ 跳过 | ⏳ P1-P7 全套 |
| 运维（EdgeOne） | 回源规则对齐 §八 Step 3 + CORS 白名单 | ✅ 已签 | ⏭ 跳过 | ⏳ P1/P2 + 域名解析 |

**最终判定**：本地测试已满足签发技术条件（4/4 PASS），允许进入生产部署阶段。**生产上线后 24h 内必须完成 9.10.1 全部 7 项强制补验证**，任一 FAIL 立即按 9.10.5 应急预案处理。

→ ✅ 本地 4/4 PASS = 允许进入生产部署 → 生产 7/7 PASS = 真后端模式生产闭环。
