# 凭证作废 & backfill 自动化验证报告

> 运行批次 `20261029031244` · 2026-10-29T03:12:44.099Z · 耗时 10.0s · 临时库 `file:C:/Users/hp/AppData/Local/Temp/qaxqjt-verify-20261029031244.db`（已销毁）

## 一、结果汇总

| 指标 | 值 |
|---|---|
| 验证项总数 | 96 |
| 通过 | 96 |
| 失败 | **0** |
| 通过率 | 100.0% |

## 二、分组明细

### B-backfill（58/58）

| # | 验证项 | 预期 | 实际 | 判定 | 备注 |
|---|---|---|---|---|---|
| 1 | B1.1 diff>0 触发补差（synced=1） | true | true | ✅ | r={"synced":1,"target":1000,"net":0,"diff":1000} |
| 2 | B1.2 收款流水已落库 | true | true | ✅ |  |
| 3 | B1.3 台账凭证已落库 | true | true | ✅ |  |
| 4 | B1.4 payNo 格式 PAY+12位时间戳+6位 | true | true | ✅ | PAY202610291112ERWOOL |
| 5 | B1.5 voucherNo 格式 LSR+12位时间戳+4位 | true | true | ✅ | LSR202610291112SCPP |
| 6 | B1.6 流水↔凭证 voucherNo 一致 | LSR202610291112SCPP | LSR202610291112SCPP | ✅ |  |
| 7 | B1.7 payType=in | in | in | ✅ |  |
| 8 | B1.8 流水金额=diff | 1000 | 1000 | ✅ |  |
| 9 | B1.9 流水 status=confirmed | confirmed | confirmed | ✅ |  |
| 10 | B1.10 payChannel 默认 transfer | transfer | transfer | ✅ |  |
| 11 | B1.11 payerName=客户名 | 验证客户1 | 验证客户1 | ✅ |  |
| 12 | B1.12 凭证 voucherType=receipt | receipt | receipt | ✅ |  |
| 13 | B1.13 凭证 category=演出收入 | 演出收入 | 演出收入 | ✅ |  |
| 14 | B1.14 summary 精确格式 | 订单收款（VERIFY-20261029031244-1） - 验证客户1 | 订单收款（VERIFY-20261029031244-1） - 验证客户1 | ✅ |  |
| 15 | B1.15 creditAmount=diff（收入=贷） | 1000 | 1000 | ✅ |  |
| 16 | B1.16 debitAmount=0 | 0 | 0 | ✅ |  |
| 17 | B1.17 cashFlowType=in | in | in | ✅ |  |
| 18 | B1.18 cashFlowAmount=diff | 1000 | 1000 | ✅ |  |
| 19 | B1.19 凭证 status=draft（M-15 自动凭证强制草稿） | draft | draft | ✅ |  |
| 20 | B1.20 isReconciled=false | false | false | ✅ |  |
| 21 | B1.21 orderId 关联正确 | ordvfy00000001 | ordvfy00000001 | ✅ |  |
| 22 | B1.22 makerAccountId=actor | verify_maker | verify_maker | ✅ |  |
| 23 | B1.23 <10000 免双复核 | false | false | ✅ |  |
| 24 | B1.24 remark 含收款流水号 | true | true | ✅ | 由订单收款自动生成，收款流水号 PAY202610291112ERWOOL |
| 25 | B1.25 voucherDate≈now（±2min） | true | true | ✅ | 2026-10-29T03:12:53.534Z |
| 26 | B1.26 ts BigInt 毫秒窗（±2min） | true | true | ✅ | 1793243573541 |
| 27 | B1.27 voucherNo 时间戳=UTC+8(voucherDate) | 202610291112 | 202610291112 | ✅ |  |
| 28 | B1.28 payDate≈voucherDate（±5s） | true | true | ✅ |  |
| 29 | B1.29 madeAt 已记录 | true | true | ✅ |  |
| 30 | B2.1 重跑零操作（synced=0, diff=0） | true | true | ✅ | {"synced":0,"diff":0} |
| 31 | B2.2 流水数不变 | 1 | 1 | ✅ |  |
| 32 | B2.3 凭证数不变 | 1 | 1 | ✅ |  |
| 33 | B3.1 增量 diff=500 仅补差 | true | true | ✅ | {"synced":1,"diff":500,"net":1000} |
| 34 | B3.2 凭证总数=2（1000+500 两张） | 2 | 2 | ✅ |  |
| 35 | B3.3 新凭证 credit=500 | 500 | 500 | ✅ |  |
| 36 | B3.4 流水净额=1500 | 1500 | 1500 | ✅ |  |
| 37 | B4.1 0.99 补差精确（round2） | true | true | ✅ | diff=0.99 |
| 38 | B4.2 精度收敛幂等（重跑 diff=0） | true | true | ✅ | diff=0 |
| 39 | B5.1 diff<0 不自动冲销（synced=0） | true | true | ✅ | {"synced":0,"diff":-700.99,"net":1500.99} |
| 40 | B5.2 流水数不变（历史保留） | 3 | 3 | ✅ |  |
| 41 | B5.3 凭证数不变（须人工红冲） | 3 | 3 | ✅ |  |
| 42 | B6.1 paidAmount=0 → target=0，diff<0 不冲销 | true | true | ✅ | {"synced":0,"target":0,"diff":-600} |
| 43 | B6.2 历史凭证保留 | 1 | 1 | ✅ |  |
| 44 | B6.3 orders 控制器触发守卫存在（paidAmount<=0 跳过） | true | true | ✅ |  |
| 45 | B7.1 大额补差 synced=1 | true | true | ✅ | diff=12000 |
| 46 | B7.2 ≥10000 doubleCheckRequired=true | true | true | ✅ |  |
| 47 | B8.1 out 冲减参与净额（diff=400） | true | true | ✅ | {"net":800,"diff":400} |
| 48 | B8.2 新凭证 credit=400 | 400 | 400 | ✅ |  |
| 49 | B9.1 故障注入后异常上抛（失败隔离由调用方负责） | INJECTED_FAULT_LEDGER | INJECTED_FAULT_LEDGER | ✅ |  |
| 50 | B9.2 回滚：流水零残留（无半成品） | 0 | 0 | ✅ |  |
| 51 | B9.3 回滚：凭证零残留 | 0 | 0 | ✅ |  |
| 52 | B9.4 解除故障后重跑成功 | true | true | ✅ | {"synced":1,"diff":2000} |
| 53 | B10.1 全部凭证 voucherNo 时间戳=UTC+8(voucherDate) | 0 | 0 | ✅ | [] |
| 54 | B10.2 全部凭证时间窗内（±2min） | 0 | 0 | ✅ | [] |
| 55 | B11 orders/core.js 接入 syncOrderPayments | true | true | ✅ |  |
| 56 | B11 orders/independent.js 接入 syncOrderPayments | true | true | ✅ |  |
| 57 | B11 orders/helpers.js 接入 syncOrderPayments | true | true | ✅ |  |
| 58 | B11 orders/core.js 联动审计 AUTO_LEDGER_FROM_ORDER | true | true | ✅ |  |

### V-状态机（20/20）

| # | 验证项 | 预期 | 实际 | 判定 | 备注 |
|---|---|---|---|---|---|
| 59 | V1.1 PATCH status=void → VALIDATION_ERROR（后端无作废流转） | VALIDATION_ERROR | VALIDATION_ERROR | ✅ |  |
| 60 | V1.2 拒绝文案指向合法集合 draft/checked | true | true | ✅ | status 仅允许 draft / checked |
| 61 | V1.3 未落库 | undefined | undefined | ✅ |  |
| 62 | V2 已复核不可撤回为草稿 | CONFLICT | CONFLICT | ✅ |  |
| 63 | V3.1 复核放行 status=200 | 200 | 200 | ✅ |  |
| 64 | V3.2 checkerAccountId=复核人 | acc_super | acc_super | ✅ |  |
| 65 | V3.3 checkedAt 已记录 | true | true | ✅ |  |
| 66 | V4 已对账凭证不允许修改 | CONFLICT | CONFLICT | ✅ |  |
| 67 | V5 草稿凭证可删除（204） | 204 | 204 | ✅ |  |
| 68 | V6.1 已复核凭证删除被拒 | CONFLICT | CONFLICT | ✅ |  |
| 69 | V6.2 错误文案=「仅草稿状态凭证可删除，已复核凭证须走作废流程」 | true | true | ✅ | 仅草稿状态凭证可删除，已复核凭证须走作废流程 |
| 70 | V7 已对账凭证不允许删除 | CONFLICT | CONFLICT | ✅ |  |
| 71 | V8.1 删除不存在凭证 → NOT_FOUND | NOT_FOUND | NOT_FOUND | ✅ |  |
| 72 | V8.2 修改不存在凭证 → NOT_FOUND | NOT_FOUND | NOT_FOUND | ✅ |  |
| 73 | V9 复核账号夹带业务字段被拒 | FORBIDDEN | FORBIDDEN | ✅ |  |
| 74 | V10 create 强制 status=draft（M-15 制单≠复核） | draft | draft | ✅ |  |
| 75 | V11.1 已复核回填凭证在调减后保留（不自动冲销） | true | true | ✅ | status=checked diff=-1200.99 |
| 76 | V11.2 checked 凭证删除仍会被状态机拒绝（语义一致性） | CONFLICT | CONFLICT | ✅ |  |
| 77 | V12.1 过期草稿仍可正常复核（无时效拦截） | 200 | 200 | ✅ |  |
| 78 | V12.2 过期已复核凭证删除同样被拒（系统无「过期可删」分支） | CONFLICT | CONFLICT | ✅ |  |

### W-作废端点（18/18）

| # | 验证项 | 预期 | 实际 | 判定 | 备注 |
|---|---|---|---|---|---|
| 79 | W1 缺作废原因 → VALIDATION_ERROR | VALIDATION_ERROR | VALIDATION_ERROR | ✅ |  |
| 80 | W2 作废原因不足 2 字（trim 后）→ VALIDATION_ERROR | VALIDATION_ERROR | VALIDATION_ERROR | ✅ |  |
| 81 | W3 凭证不存在 → NOT_FOUND | NOT_FOUND | NOT_FOUND | ✅ |  |
| 82 | W4 草稿凭证作废被拒（提示直接删除） | CONFLICT | CONFLICT | ✅ |  |
| 83 | W5 已作废凭证重复作废 → CONFLICT | CONFLICT | CONFLICT | ✅ |  |
| 84 | W6 已对账凭证作废被拒 | CONFLICT | CONFLICT | ✅ |  |
| 85 | W7.1 作废成功 status=200 | 200 | 200 | ✅ |  |
| 86 | W7.2 status 落 void 终态 | void | void | ✅ |  |
| 87 | W7.3 voidReason trim 后落库 | 测试作废原因 | 测试作废原因 | ✅ |  |
| 88 | W7.4 voidedBy=操作人 | acc_super | acc_super | ✅ |  |
| 89 | W7.5 voidedAt 已记录 | true | true | ✅ |  |
| 90 | W8 已作废凭证不允许修改 | CONFLICT | CONFLICT | ✅ |  |
| 91 | W9 已作废凭证不可删除（审计痕迹保留） | CONFLICT | CONFLICT | ✅ |  |
| 92 | W10 summary 查询排除 status=void | true | true | ✅ | {"voucherDate":{"gte":"2026-09-30T16:00:00.000Z"},"status":{"not":"void"}} |
| 93 | W11 通用 PATCH status=void 仍被状态机白名单拒绝 | VALIDATION_ERROR | VALIDATION_ERROR | ✅ |  |
| 94 | W12.1 真实库 void status 持久化 | void | void | ✅ |  |
| 95 | W12.2 真实库 voidReason/voidedBy 持久化 | 真实库验证\|verify | 真实库验证\|verify | ✅ |  |
| 96 | W12.3 真实库 voidedAt 时间戳 | true | true | ✅ |  |

## 三、backfill 覆盖矩阵

| 分支 | 用例 | 结论 |
|---|---|---|
| diff>0 补差（首笔回填） | B1.* | 已验证 |
| diff=0 幂等零操作 | B2.* B4.2 | 已验证 |
| diff>0 增量补差（多张凭证累积） | B3.* B8.* | 已验证 |
| diff<0 调减不冲销（部分使用/退回场景） | B5.* V11.1 | 已验证 |
| paidAmount=0 边界（target 归零 + 控制器触发守卫） | B6.* | 已验证 |
| ≥10000 双复核标记 | B7.2 | 已验证 |
| out 流水冲减净额 | B8.1 | 已验证 |
| 事务原子性（同事务回滚，无半成品） | B9.* | 已验证（故障注入） |
| 时间戳正确性（ts/voucherDate/UTC+8 编号戳/payDate/madeAt） | B1.25-B1.29 B10.* | 已验证 |
| 触发点接线（orders core/independent/helpers + 审计） | B11.* | 已验证 |

## 四、状态机覆盖矩阵

| 规则 | 用例 | 结论 |
|---|---|---|
| PATCH status 仅允许 draft/checked（void 被拒） | V1.* | 已验证 |
| checked 不可撤回 draft | V2 | 已验证 |
| draft→checked 单向复核 + M-15 豁免 | V3.* V9 V10 | 已验证 |
| isReconciled 禁改禁删 | V4 V7 | 已验证 |
| 删除仅限 draft（checked/reconciled 拒绝） | V5 V6.* | 已验证 |
| NOT_FOUND 容错 | V8.* | 已验证 |
| 无时效豁免（过期凭证同规则） | V12.* | 已验证 |
| 作废端点全分支（reason 校验/NOT_FOUND/草稿拒绝/重复作废/对账拒绝/成功四字段/终态不可改不可删/summary 排除/通用 PATCH 防绕过） | W1-W11 | 已验证 |
| schema void 字段真实库往返（迁移生效） | W12.* | 已验证 |

## 五、发现的问题（GAP）

### GAP-1：凭证「作废」端点已实现（v20261016），待部署生产

- **证据**：W1-W12 全分支验证通过：PATCH /v1/fin/ledger/:id/void（super_admin/finance_admin；reason 必填 2-200 字；checked→void 终态；草稿/已对账/重复作废均拒绝；已作废不可改不可删；通用 PATCH 无法写 void；summary 排除 void）；schema 新增 void_reason/voided_at/voided_by 三列（真实库往返验证）
- **影响**：待生产部署（db push 增量加列 + PM2 重启）后，线上 LED202609090230ILIR 等已复核凭证即可合法作废
- **建议**：走 qaxqjt-remote-deploy 后端部署流程（§2.4 六步脚本）；随后在前端财务页补「作废」按钮闭环 GAP-2

### GAP-2：前端缺「作废」操作入口（后端状态已可产出）

- **证据**：后端已产出 status=void（前端 _FIN_VST.void=已作废 徽章可正常显示），但 js/admin-pages/finance.js 凭证行尚未提供作废按钮 + reason 弹窗
- **影响**：部署后管理员暂需通过 API 直调触发作废（低危，临时方案）
- **建议**：前端凭证行对 checked 状态加「作废」按钮：PATCH /v1/fin/ledger/:id/void + 二次确认 + reason 输入

## 六、结论

backfill（order-payment-sync）全部 10 个分支、凭证状态机全部规则（含**本次新增作废端点全分支 W1-W12**）验证通过；回填完整性/字段准确性/数据一致性/时间戳正确性均符合实现承诺（增量对账、只补差、不冲销、同事务原子提交、编号时间戳=UTC+8）。GAP-1 作废流程已在本地实现并验证（PATCH /v1/fin/ledger/:id/void），**待生产部署**（db push 增量加列 + PM2 重启）后线上已复核凭证即可合法作废。
