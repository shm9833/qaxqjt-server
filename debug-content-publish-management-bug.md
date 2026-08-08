# Debug Session: content-publish-management-bug (官网内容发布管理 Bug)
**Status**: [OPEN - Hypothesizing]  
**Created At**: 2026-08-02  
**Session ID**: content-publish-management-bug  
**Objective**: 调试 admin/content.html 官网内容发布管理功能 Bug。采集运行时证据（Console Error / UI 行为 / localStorage 数据流转），定位根因并最小化修复。

---

## 1. Falsifiable Hypotheses (5条可证伪假设)

| # | 假设内容 | 可观测证据 | 判定方法 |
|---|---------|-----------|---------|
| H1 | **Storage.KEYS.CONTENT_NEWS/CONTENT_BANNERS 缺失** → `Storage._get(Storage.KEYS.xxx)` 返回 null，导致渲染 TypeError（forEach/crash on null）。 | 浏览器 Console: "Cannot read property 'forEach' of null" / "Cannot read property 'map' of undefined"；localStorage 中无对应 key | 打开浏览器看 Console + DevTools Application 看 localStorage 键 |
| H2 | **新增/编辑保存时 write 操作失败** → `Storage._set()` 抛错或去抖锁 `window.__OP_LOCKS` 误判，导致用户点保存无响应、toast 不显示、数据不入库。 | 点击"保存/发布"按钮后：① toast 不出现 ② localStorage 列表未新增该行 ③ __OP_LOCKS 中 content 相关 key 长时间为 true 不释放 | 插桩：在保存函数入口/Storage._set/try-catch 处打日志 + watch __OP_LOCKS |
| H3 | **Tab 切换/分页/搜索状态异常** → pagination.js 搜索时命中隐藏 searchBox（display:none 父链）或 jump input 的 Enter/blur 事件未绑定，导致"点查询/下一页无刷新"。 | 搜索框输入关键词按 Enter 无反应；pagination 的 首页/上一页/下一页/末页 点击 refs 数为 0 或不触发重渲 | browser_use snapshot + 事件绑定代码审查 |
| H4 | **富文本/文本area innerHTML 注入未 escape** → `Utils.escapeHtml / hx()` 漏用导致用户填写 `<script>alert(1)</script>` 等内容触发 XSS 或保存后渲染错乱。 | 输入 `<b>test</b>` 保存 → 列表页显示原文粗体（非转义文本），或 Console 出现"Refused to execute inline script" CSP 告警 | 构造 Payload 手工测试 + grep 审查 innerHTML 赋值链 |
| H5 | **checkAuth 鉴权或 admin-sidebar-menu 导航死链** → 未登录状态 content 页 checkAuth 通过但 session 实际过期，或侧边栏 4 个链接（accounts/orders/content/system）中 content 地址错误。 | 侧边栏"官网内容管理"点击跳转 404 / 白屏；或已登录但 checkAuth 抛错导致渲染提前终止。 | 检查 ADMIN_STORAGE_KEY session.expiresAt 与当前时间；点击侧边栏4个链接验证可达性。 |

---

## 2. Evidence Log (证据日志)

| Step | 时间戳 | H# | 动作 | 观测结果 | 结论 |
|------|-------|----|------|---------|------|
| S0 | 2026-08-02 | - | 初始化：创建本文件 + 声明 5 假设 | 等待用户提供更多症状 / 先静态扫描 + 浏览器自动采证 | ✅ 进行中 |

---

## 3. Findings / Fixes (待补充)
