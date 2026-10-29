# debug-travel-pending-empty.md

## 症状
- 现象：后台路费审核列表为空（员工管理 → 工资条 → 🚌路费登记弹窗的「⏳ 全部待审核（跨人员）」视图）
- 期望：员工提交的待审核报销应出现在列表中
- 环境：生产 1.14.106.173（PM2 qaxqjt-api，root=C:\qaxqjt-server）；前端 v=20261024d（wr1024 部署后）

## 假设（可证伪）
- H1 数据为空：DB 无 status=pending 记录（上次 travel-pending-list-missing 根因；无新提交或已审完）
- H2 提交未落库：员工端 POST /v1/travel-expenses/mine 失败（DB 无对应新记录）
- H3 API 过滤回归：服务器 travel-expenses.js 缺 `where.status = status`（badge1024 特征）
- H4 前端渲染：服务器 staff.pre-3.js 缺「全部待审核（跨人员）」特征（trvreview1024）
- H5 列表对象错位：用户所指并非路费审核列表

## 证据
（探针 1：d:\wpe1024-diag.js → D:\wpe1024-diag.txt；探针 2：d:\wpe1024-listprobe.js → D:\wpe1024-listprobe.txt；均只读）
- E1（探针1）DB status 分组：`active:1 | pending:4` → **H1 排除**（数据存在）
- E2（探针1）最近记录：4 笔 pending 均 2026-10-24 当天提交（北京时间 08:48-09:20）——马卫东 ¥100、陈敏 ¥88、陈玲玲 ¥89、王亚军 ¥59；另有孙回民 ¥100 active（10-17）→ **H2 排除**（提交已落库）
- E3（探针1）服务器 travel-expenses.js 特征：`statusFilter=true mine=true` → 控制器过滤代码在位
- E4（探针1）服务器前端特征：staff.pre-3.js `crossPending=true genRange=true`；staff.html `ver=20261024d badge=true` → **H4 部署层排除**
- P1（探针2）直调服务器 list 控制器（mock ctx）：`status=pending` → `total=4 listLen=4`，dataKeys=list,total,page,pageSize，四条记录姓名/金额/状态齐全 → **H3 运行时排除**
- P2（探针2）对照组无 status：`allTotal=5`（4 pending + 1 active 孙回民）→ 过滤真实生效，非全量兜底
- P3（探针2）路由文件：`routeFound=true routeStatusEnum=true routePaginate=true` → 路由层 status 枚举声明齐全
- P4（探针2）HTTP 127.0.0.1:3001 未鉴权探测：401 `{"ok":false,"code":"UNAUTHORIZED"}` → 路由存活、鉴权正常
- 前端解析链核对（本地 L838/L970 vs api-request.js L101 vs response.js）：
  - 后端 list L100 返回 `{ ok, data:{ list, total, page, pageSize } }`
  - API.get 返回 `data.data` = `{list, total,...}`
  - 跨人员视图 L838 `dp.list` ✓；角标 L970 `d.total` ✓ → **解析形状完全匹配，渲染逻辑无误**

## 第二轮证据（账号权限 + 公网链路，探针 d:\wpa1024-roles.js + 公网 curl）
- R1 账号表（AccountsV2）：仅 `admin role=super_admin status=active` 可用（审核名单内 ✓）；另两账号 rbacstaff0929(director)/patrol_musli8to(staff) 均 status=deleted → **权限假设排除**
- R2 活跃会话 15 条全部属于 admin；最近登录 2026-10-23T23:38 UTC（北京 07:38，IP 27.224.92.122）
- R3 24h 内仅 admin 两次成功登录 → **用户浏览器当前就是 admin/super_admin**
- R4 审计：4 笔 TE_SELF_SUBMIT 在北京 08:48-09:20 提交（**晚于用户上次登录 07:38**）
- 公网 CDN（Cloudflare）：staff.html 引用 `?v=20261024d`（新），`no-store` + `cf-cache-status: DYNAMIC` 不缓存 HTML；staff.pre-3.js?v=20261024d 内容含跨人员代码（269KB，边缘 HIT 但 URL 带新版本号无碍）→ **CDN/浏览器缓存旧版假设基本排除**
- 公网 API 链路：`https://qaxqjt.cn/api/v1/travel-expenses?status=pending` 与 `/v1/...` 均返回 401 JSON（`_ver=V2026.8.3`）→ CDN→源站→Nginx 反代→node:3001 全通
- api-config.js 基址解析：HTML 未注入 `__QAXQJT_API_BASE__`，默认同源 `/api` 反代；用户今早登录成功本身即证明其浏览器 API 链路可达本服务器

## 结论
**服务端、代码、公网链路、账号权限全部 100% 正常**（admin/super_admin 有审核权，其浏览器 API 链路今早已证明可达本服务器，弹窗同款请求直调返回 4 条）。按概率排序：
1. **查看时间早于提交**（很可能）：用户上次登录北京 07:38，4 笔提交在 08:48-09:20——若在 08:48 前看过列表，当时为空是正常的；现在重开即应有 4 笔
2. **页面未刷新**：若 admin 页签从部署（09:29）前一直开着，内存里还是旧 JS → 刷新页面后重开「🚌路费登记」弹窗，默认「⏳ 全部待审核（跨人员）」应显示 4 笔，🚌 角标应显示 **4**
3. **查看位置/视图不对**（H5 部分成立）：需确认看的是员工管理 → 工资条 tab → 🚌路费登记弹窗的默认跨人员视图，而非选了具体人员+月份的过滤视图（选人后只显示该人当月记录）
- 已彻底排除：权限（admin/super_admin 在审核名单内）、CDN/浏览器缓存（HTML no-store + 新版本号）、公网 API 链路（双路径 401 JSON 存活）、H1/H2/H3/H4
- 若刷新后弹窗仍显示「当前无待审核报销」：F12 → Network 抓 `/v1/travel-expenses?status=pending` 的响应体（total 值）反馈排查

## 第三轮证据（用户实测报错 + 根因定位，探针 wpb1024-logs/auth/auth2，均只读已清理）
- 用户实测报错文案 =「**待审核记录加载失败，请重试**」→ 这是新 JS 跨人员视图 catch 分支（L864）的文案，证明用户已是新版前端；且该文案≠空态文案（「当前无待审核报销」）
- PM2 日志取证：out.log 尾 1652 行零 travel-expenses 记录、零 4xx/5xx（服务器无请求级日志），error.log 最新错误停留 10-12 → 日志路无答案
- 完整路由链认证测试（wpb1024-auth2，手动 .env 注入 + 显式 issuer/audience 签 admin JWT）：`GET /v1/travel-expenses?status=pending` → **200 且返回待审核列表**（含王爱琴/柏乖秀等新提交）；wage-batches 200 → **服务器端彻底排除，失败发生在客户端**
- refresh 实现（auth.js L159-177）：refresh token 走 `admin_sessions` 表白名单（tokenHash=尾16字符），DB 持久化 → PM2 重启不失效，该假设排除

## 根因（已修复）
**staff.pre-3.js 的 IIFE（L78 起）内没有 `esc` 函数定义**（全项目也无任何 `window.esc` 全局挂载；staff.js 的 3 处 esc 均在各自 IIFE 内部不可跨文件访问）。而 v20261024c 新增的跨人员待审核视图在渲染**每一行**时无条件调用 `esc(r.performerName)`（L843）与 `esc(r.scheduleTitle...)`（L845）→ API 拉取成功后渲染第一行即抛 `ReferenceError: esc is not defined` → 被外层 catch 吞掉 → 显示「待审核记录加载失败」。**表象是"列表空"，实际是"渲染崩溃"**；单人视图 L890 的 esc 仅在极少数状态才调用，故历史上未暴露。该视图今天首次被真实用户使用。

## 修复与部署（tag fe1024e）
- [js/admin-pages/staff.pre-3.js](js/admin-pages/staff.pre-3.js)：IIFE 顶部补本地 `function esc(s){...}`（fix-20261024e 注释）
- [admin/staff.html](admin/staff.html)：版本号 `v=20261024d → v=20261024e` 破缓存
- 部署（前端热部署 skill 全流程）：备份 ×2（.bak-fe1024e）→ marker DONE files=2 → 双端特征验证（1.14.106.173 直连：escFix/escDef/crossPending/verE 全 True、无 tsclient 污染；EdgeOne dpai2qs25l71 签名 URL：同全 True）→ _deploy 快照 4 处同步 → marker 两轮清理完毕
- 用户侧操作：**普通刷新页面即可**（HTML no-store + JS URL 已带新版本号），重开「🚌路费登记」弹窗 → 跨人员视图应显示全部待审核记录（现 ≥6 笔）
