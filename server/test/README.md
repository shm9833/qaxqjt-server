# server/test 测试套件说明

Node 内置 test runner，无额外测试框架依赖。

## 运行方式

以下示例均为 Windows PowerShell 环境（项目开发机实际使用环境）。

### 1. 全量运行（推荐，验证无回归）

```powershell
cd server
npm test
```

`package.json` 中 `test` 脚本即 `node --test --test-force-exit`；`--test-force-exit` 用于桩注入模式下强制结束残留句柄（supertest keep-alive 等），防止进程挂起。

### 2. 运行单个测试文件

```powershell
node --test --test-force-exit test/orders-payments.test.js
```

### 3. 运行多个指定文件

```powershell
node --test --test-force-exit test/orders-integration.test.js test/orders-payments.test.js
```

### 4. 只运行文件名匹配的用例（按名称过滤）

```powershell
node --test --test-force-exit --test-name-pattern="收款" test/orders-payments.test.js
node --test --test-force-exit --test-name-pattern="401" test/orders-integration.test.js
```

### 5. 输出过滤：只看结果摘要 / 失败详情

```powershell
# 只看摘要行（tests / pass / fail）
npm test 2>&1 | Select-String -Pattern '^ℹ (tests|pass|fail)'

# 定位失败用例：看失败标记与断言上下文
npm test 2>&1 | Select-String -Pattern '✖|not ok|message:|expected|actual' -Context 0,3
```

### 6. 预期输出样例

```text
ℹ tests 292
ℹ pass 292
ℹ fail 0
```

退出码：全过为 `0`；任何失败非 `0`（CI/脚本可据此判断）。全量运行约 1~2 分钟。

> 注意：测试全部走内存桩，不连数据库、不写盘，可随时安全运行；桩注入发生在 `require('../src/app')` 之前，因此不要在单文件中混用「真实 prisma + 桩」两种模式。


## 通用模式

- **集成测试**（`*-integration.test.js`）：supertest + `app.callback()` 走完整 HTTP 栈（鉴权中间件→路由 Joi 校验→控制器），数据库不落盘——用 `require.cache[require.resolve('../utils/prisma')]` 注入内存桩，JWT 用 `jsonwebtoken` 手签（issuer/audience 与 config 一致）。
- **桩注入顺序**：先写环境变量 stub → 注入 prisma 桩 / audit-service 桩 → `require('../src/app')`。桩对象用 `captured` 记录调用参数、`_xxxResult` 变量供用例覆盖返回值。
- **事务桩**：交互式事务用 `$transaction: async fn => fn(txStub)`，tx 内各方法的调用参数单独记录（见 orders-payments.test.js 的 `txPaymentCreate` / `txLedgerCreate` / `txOrderUpdate`）。
- **源码动态提取法**（customers-null-payload.test.js）：用正则锚点 + 括号平衡从路由/前端源码中提取 schema 与构造段后执行，杜绝测试副本与源码漂移。注意文件为 CRLF，锚点用正则而非 `indexOf`；链式调用（如 `.min(1)`）须提取完整 `validate(...)` 调用。

## 测试文件索引

| 文件 | 类型 | 覆盖 |
| --- | --- | --- |
| orders-payments.test.js | 集成 | 订单收款登记：鉴权、Joi、404/409、状态机（partial_paid/paid/draft 路径）、事务三写入断言 |
| orders-integration.test.js | 集成 | 订单 CRUD：分页、create 勾稽校验、transition 状态机、remove 资金证据链保护 |
| customers-integration.test.js | 集成 | 客户档案 CRUD |
| customers-null-payload.test.js | 单元 | 客户保存 null payload 修复回归（前端构造段 + Joi schema 源码提取） |
| auth-integration.test.js | 集成 | 登录/刷新/登出、验证码 |
| captcha-svg.test.js | 单元 | SVG 验证码 |
| schedules-integration.test.js / schedules-controller.test.js | 集成/单元 | 排期 |
| performers-integration.test.js | 集成 | 演职人员花名册、self-register、review |
| performers-cleanup.test.js | 单元 | 离职清理 |
| order-roster.test.js | 单元 | 演出花名册 |
| finance-m15.test.js / finance-batchcheck.test.js | 单元 | 财务台账/批量复核 |
| voucher-void-integration.test.js | 集成 | 凭证红冲作废 |
| cast-sheet-ops-integration.test.js | 集成 | 演出单操作 |
| travel-expenses.test.js | 单元 | 差旅路费归集与工资条集成 |
| wage-order-breakdown.test.js | 单元 | 工资条订单溯源（v20261026 orderBreakdown）：`_orderBreakdownByStaff` 考勤→排期→订单聚合（多单归属/夜场计数/无排期兜底桶「非演出考勤」/非计薪类型剔除/punchControl 暂停区间排除/range 区间过滤）、`toApi` JSON 解析容错、`generate` 写入 baseShare=日薪×该单出勤天、`detail` 接口暴露数组 |
| accounts-list.test.js | 单元 | 账号列表 |
| troupe-cloud-store.test.js / troupe-config-schema.test.js | 单元 | 剧团云配置 |
| security-config.test.js | 单元 | 安全配置 |
| system-init.test.js | 集成 | 系统初始化 |

## 修复记录

### 2026-10-26：订单收款集成测试新增 + 两处预存欠账修复（全量 292/292）

1. **新增 [orders-payments.test.js](./orders-payments.test.js)（17 用例）**
   覆盖 `POST /v1/orders/:id/payments` 全链路：
   - 鉴权：无 token 401、staff 403、finance_cashier 放行
   - Joi：amount 缺失/0/负数/非法 payChannel → 400
   - 业务前置：404、cancelled/refunded 409、超付 409（断言提示文案且零写入）
   - 成功路径：confirmed 部分收→`partial_paid`、收齐→`paid`、draft 一次收齐→路径经 confirmed 写终态 `paid`、performing 不改 status、默认渠道回退 transfer
   - 事务断言：流水 PAY 单号/payType='in'/渠道/币种；台账 LSR 单号/receipt/演出收入/creditAmount/**≥10000 触发 doubleCheckRequired**/与流水凭证号一致；订单回写 paidAmount+status

2. **修复 performers-integration.test.js（2 用例）**
   成功用例 payload 未跟上 v20261013 必填新规（idCardNo/phone/dailyRate/transportType）被 Joi 拒成 400。按路由 schema 补齐字段，32/32 全绿。详见文件头修复记录。

3. **修复 travel-expenses.test.js（桩）**
   控制器新增同人同月查重（`travelExpenseV1.findFirst`）后桩未同步，create 用例 TypeError 500。桩补 findFirst（teRows 命中 pending/active 视为重复），详见文件头修复记录。

### 2026-10-26（早前）：客户保存 null payload 修复回归

新增 customers-null-payload.test.js（10 用例），见上文索引。
