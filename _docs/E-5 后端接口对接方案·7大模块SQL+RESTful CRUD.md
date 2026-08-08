# 秦安县秦剧团云端预约系统 · 后端接口对接方案 v1.0
> **文档版本**：v1.0 · 2026-08-03
> **适用版本**：qaxqjt V2026.8.3
> **配套文档**：E-1 数据字典.md（字段权威来源）、E-2 后端REST鉴权规范v1.0.md（鉴权+错误码+通用响应结构）
> **数据库**：MySQL 8.0+ / PostgreSQL 13+ 双兼容
> **字符集**：MySQL 用 `utf8mb4` / PostgreSQL 用 `UTF8`
> **存储引擎**：MySQL 统一 `InnoDB`，外键 + 索引 + 软删除

---

## 0. 通用约定

### 0.1 通用响应结构（所有API严格遵循）
详见 E-2 §二，简要：
```json
{
  "ok": true, "code": 0, "message": "ok",
  "data": { /* 业务数据 */ },
  "paging": { "page":1, "pageSize":20, "total":128, "pageCount":7 },
  "serverTs": 1754223300123, "traceId": "tr_xxx"
}
```

### 0.2 通用分页参数（所有列表接口）
| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `page` | int | 1 | 页码，≥1 |
| `pageSize` | int | 20 | 每页条数，1-100 |
| `keyword` | string | — | 模糊搜索（按各模块搜索字段） |
| `sortBy` | string | createdAt | 排序字段（白名单校验） |
| `sortOrder` | enum | desc | asc / desc |
| `filters` | JSON string | — | `{"status":"paid","dateFrom":"2026-08-01","dateTo":"2026-08-31"}` |

### 0.3 通用字段（所有业务表）
```sql
id           VARCHAR(32)  PRIMARY KEY,  -- {前缀}_{32位随机}
created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
created_by   VARCHAR(32),  -- 操作人 accounts_v2.id
updated_by   VARCHAR(32),
status       VARCHAR(20)  NOT NULL DEFAULT 'active',  -- 软删除 = 'deleted'
_ts          BIGINT       NOT NULL  -- 精确排序，= UNIX_MS(created_at)
```
> PostgreSQL 自改：`DATETIME` → `TIMESTAMP`，`ON UPDATE CURRENT_TIMESTAMP` 用触发器实现。

### 0.4 接口前缀与鉴权
```
Base URL: {BACKEND_BASE}/v1/admin
所有请求必须携带 E-2 §一 规定的 4 要素：
  Cookie(sid) + X-CSRF-Token + X-Auth-Token
所有写接口（POST/PUT/DELETE）需记录审计日志 log_admin_action
```

### 0.5 7 大模块对应关系
| # | 模块 | 主要表 | 前端页面 | 权限前缀 |
|---|---|---|---|---|
| 1 | 预约 | appointments | orders.html Tab1 | appointments:* |
| 2 | 客户 | customers_v1 | orders.html Tab2 | customers:* |
| 3 | 订单 | orders + fin_payments_v1 | orders.html Tab3 + finance.html | orders:* / finance:write |
| 4 | 档期 | schedules_v2 + cast_sheets_v1 | schedule.html + cast-sheet.html | schedules:* / cast:* |
| 5 | 考勤 | staff_roster_v1 + attendance_v1 + wages_v1 | staff.html + attendance.html | staff:* / attendance:* |
| 6 | 财务 | fin_ledger_v1 + fin_invoices_v1 + fin_recons_v1 | finance.html | finance:* |
| 7 | 权限 | accounts_v2 + admin_session + settings | accounts.html + system.html | accounts:* / system:* |

---

## 一、模块 1：预约（Appointments）

### 1.1 DDL
```sql
-- MySQL 8.0+
CREATE TABLE appointments (
  id                VARCHAR(32)   PRIMARY KEY,
  customer_name     VARCHAR(100)  NOT NULL,
  phone             VARCHAR(20)   NOT NULL,
  organization      VARCHAR(200),
  shows             INT           NOT NULL DEFAULT 1 CHECK (shows >= 1),
  selected_plays    JSON,                    -- [playId1, playId2]
  preferred_start_date  DATE,
  venue             VARCHAR(300),
  remarks           TEXT,
  status            VARCHAR(20)   NOT NULL DEFAULT 'pending',
    -- pending待审核 / approved已转订单 / rejected已拒绝 / deleted
  reject_reason     VARCHAR(500),
  linked_order_id   VARCHAR(32),             -- → orders.id
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by        VARCHAR(32),
  updated_by        VARCHAR(32),
  _ts               BIGINT        NOT NULL,
  INDEX idx_phone (phone),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  INDEX idx_preferred_date (preferred_start_date),
  CONSTRAINT fk_appt_order FOREIGN KEY (linked_order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 1.2 RESTful API
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/appointments` | appointments:read | 分页列表（keyword搜索customer_name/phone/organization） |
| `GET` | `/appointments/:id` | appointments:read | 单条详情 |
| `POST` | `/appointments` | appointments:write | 新建预约（后台手工建档，或前台booking.html走无鉴权公开接口见§八） |
| `PUT` | `/appointments/:id` | appointments:write | 修改预约信息 |
| `POST` | `/appointments/:id/approve` | appointments:approve | 审核通过 → 自动创建一条 orders + customers_v1（幂等：已approved返回409），返回 {orderId, customerId} |
| `POST` | `/appointments/:id/reject` | appointments:approve | 审核拒绝，必填 body: `{rejectReason}` |
| `DELETE` | `/appointments/:id` | appointments:write | 软删除 status=deleted（仅pending/rejected允许） |

### 1.3 公开预约接口（无鉴权，前台 booking.html）
| 方法 | 路径 | 限流 | 说明 |
|---|---|---|---|
| `POST` | `/public/appointments` | 同IP 5分钟≤20次 | 前台客户自助提交，status默认pending；需图形验证码或行为验证码防垃圾提交 |
| `GET` | `/public/appointments/query?phone=&ticketNo=` | — | 前台客户查询预约状态 |

---

## 二、模块 2：客户（Customers）

### 2.1 DDL
```sql
CREATE TABLE customers_v1 (
  id             VARCHAR(32)   PRIMARY KEY,
  name           VARCHAR(100)  NOT NULL,
  phone          VARCHAR(20)   NOT NULL,
  organization   VARCHAR(200),
  address        VARCHAR(500),
  total_orders   INT           NOT NULL DEFAULT 0,
  total_amount   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  unpaid_total   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tags           JSON,                      -- ["老客户","重点村"]
  remarks        TEXT,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by     VARCHAR(32),
  updated_by     VARCHAR(32),
  status         VARCHAR(20)   NOT NULL DEFAULT 'active',
  _ts            BIGINT        NOT NULL,
  UNIQUE KEY uk_phone (phone),
  INDEX idx_name (name),
  INDEX idx_unpaid (unpaid_total DESC),
  INDEX idx_total_amt (total_amount DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.2 RESTful API
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/customers` | customers:read | 分页列表（keyword搜索name/phone/organization） |
| `GET` | `/customers/:id` | customers:read | 详情 + 关联订单简要（最近5笔）+ 未收欠款汇总 |
| `GET` | `/customers/:id/orders` | customers:read + orders:read | 该客户所有订单（分页） |
| `POST` | `/customers` | customers:write | 新建客户 |
| `PUT` | `/customers/:id` | customers:write | 修改客户信息 |
| `DELETE` | `/customers/:id` | customers:write | 软删除（仅 total_orders=0 允许；有订单报错） |
| `POST` | `/customers/merge` | customers:write | 客户合并：`{targetId, sourceIds[]}`，sourceIds→targetId（重单处理） |

---

## 三、模块 3：订单（Orders + Payments）

### 3.1 DDL
```sql
CREATE TABLE orders (
  id                    VARCHAR(32)   PRIMARY KEY,
  order_no              VARCHAR(32)   NOT NULL,
  customer_id           VARCHAR(32)   NOT NULL,
  appointment_id        VARCHAR(32),
  total_shows           INT           NOT NULL DEFAULT 1,
  total_amount          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_rate              DECIMAL(5,4)  NOT NULL DEFAULT 0.06,
  start_date            DATE          NOT NULL,
  end_date              DATE          NOT NULL,
  venues                JSON          NOT NULL,
  play_list             JSON          NOT NULL,
  performers_cost_budget DECIMAL(12,2),
  other_cost_budget     DECIMAL(12,2),
  receivable_plan       JSON          NOT NULL,   -- [{date,amount,remark}]
  received_amount       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  unpaid_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status                VARCHAR(20)   NOT NULL DEFAULT 'unpaid',
    -- unpaid未付清 / partial部分收款 / paid已结清 / cancelled取消 / deleted
  contract_url          VARCHAR(500),
  operator_id           VARCHAR(32),
  operator_name         VARCHAR(50),
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by            VARCHAR(32),
  updated_by            VARCHAR(32),
  _ts                   BIGINT        NOT NULL,
  UNIQUE KEY uk_order_no (order_no),
  INDEX idx_customer (customer_id),
  INDEX idx_status (status),
  INDEX idx_start_date (start_date),
  INDEX idx_unpaid (status, unpaid_amount DESC),
  CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES customers_v1(id),
  CONSTRAINT fk_order_appt FOREIGN KEY (appointment_id) REFERENCES appointments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fin_payments_v1 (
  id                VARCHAR(32)   PRIMARY KEY,
  order_id          VARCHAR(32)   NOT NULL,
  order_no          VARCHAR(32)   NOT NULL,
  customer_id       VARCHAR(32)   NOT NULL,
  customer_name     VARCHAR(100)  NOT NULL,
  payment_date      DATE          NOT NULL,
  amount            DECIMAL(12,2) NOT NULL,
  payment_method    VARCHAR(20)   NOT NULL,
  receipt_type      VARCHAR(20)   NOT NULL,
    -- 定金 / 中期款 / 尾款 / 加场款 / 赔偿款
  operator_id       VARCHAR(32),
  operator_name     VARCHAR(50),
  related_ledger_id VARCHAR(32),  -- → fin_ledger_v1.id
  remark            VARCHAR(500),
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by        VARCHAR(32),
  updated_by        VARCHAR(32),
  status            VARCHAR(20)   NOT NULL DEFAULT 'active',
  _ts               BIGINT        NOT NULL,
  INDEX idx_order (order_id),
  INDEX idx_payment_date (payment_date),
  CONSTRAINT fk_pay_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 3.2 订单 RESTful API
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/orders` | orders:read | 分页；filters支持 status/dateFrom/dateTo/customerId/unpaidGt(仅未收>N) |
| `GET` | `/orders/:id` | orders:read | 详情 + 已收款列表 + 档期列表 + cast_sheet列表 |
| `POST` | `/orders` | orders:write | 手建订单（非预约转正）；自动生成 order_no；同步更新 customers 冗余字段 |
| `PUT` | `/orders/:id` | orders:write | 修改订单（paid/cancelled 状态禁止修改；需要锁机制） |
| `POST` | `/orders/:id/cancel` | orders:approve | 取消订单（已收款需先退款；幂等）；body: `{reason}` |
| `DELETE` | `/orders/:id` | orders:write | 软删除（仅 unpaid+无关联payment允许） |
| `POST` | `/orders/:id/receivable-plan` | orders:write | 重新生成收款计划（未收款前允许） |
| `GET` | `/orders/debts` | orders:read + finance:read | 未收欠款列表（unpaid_amount>0，按客户+金额排序，等同finance.html Tab4） |
| `GET` | `/orders/export` | orders:read + reports:export | 导出 Excel（全条件同 GET /orders） |

### 3.3 收款 RESTful API（走 fin_payments_v1，双写 fin_ledger_v1）
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `POST` | `/orders/:id/payments` | finance:write | **登记收款：** ①写 fin_payments_v1；②写 fin_ledger_v1（type=income, source=演出收款）；③原子更新 orders.received_amount + unpaid_amount；④更新 customers 冗余；全部事务内完成，失败全回滚。必填 body: `{paymentDate,amount,paymentMethod,receiptType,remark?,reviewerUserId}`（双人复核） |
| `GET` | `/payments` | finance:read | 收款流水（分页，filters: orderId/customerId/dateFrom~To） |
| `DELETE` | `/payments/:id` | finance:void | **冲正收款：** ①写一条负数 fin_ledger_v1（relatedVoidId互挂）；②删除/作废 payment；③回滚 orders.received_amount；事务保证 |

---

## 四、模块 4：档期（Schedules + Cast Sheets）

### 4.1 DDL
```sql
CREATE TABLE schedules_v2 (
  id                     VARCHAR(32)   PRIMARY KEY,
  date                   DATE          NOT NULL,
  time                   VARCHAR(10)   NOT NULL,
  venue                  VARCHAR(300)  NOT NULL,
  order_id               VARCHAR(32)   NOT NULL,
  play_id                VARCHAR(32)   NOT NULL,
  play_name              VARCHAR(100),
  cast_sheet_id          VARCHAR(32),
  troupe_template_id     VARCHAR(32),
  attendance_template_status VARCHAR(20),  -- ready/in_progress/done
  remarks                TEXT,
  operator               VARCHAR(50),
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by             VARCHAR(32),
  updated_by             VARCHAR(32),
  status                 VARCHAR(20)   NOT NULL DEFAULT 'active',
  _ts                    BIGINT        NOT NULL,
  INDEX idx_date (date),
  INDEX idx_order (order_id),
  INDEX idx_play (play_id),
  INDEX idx_cast_sheet (cast_sheet_id),
  CONSTRAINT fk_sch_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cast_sheets_v1 (
  id                VARCHAR(32)   PRIMARY KEY,
  name              VARCHAR(150)  NOT NULL,
  date              DATE          NOT NULL,
  venue             VARCHAR(300)  NOT NULL,
  from_template_id  VARCHAR(32),
  play_id           VARCHAR(32)   NOT NULL,
  crew              JSON          NOT NULL,
  total_crew        INT           NOT NULL DEFAULT 0,
  total_wage_budget DECIMAL(12,2),
  remark            TEXT,
  is_active         TINYINT(1)    NOT NULL DEFAULT 0,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by        VARCHAR(32),
  updated_by        VARCHAR(32),
  status            VARCHAR(20)   NOT NULL DEFAULT 'active',
  _ts               BIGINT        NOT NULL,
  INDEX idx_date (date),
  INDEX idx_play (play_id),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 其他表：performers_db_v1 / troupe_templates_v1 / plays
-- 参考 E-1 §三 自行补充 DDL，结构同上
```

### 4.2 档期 RESTful API
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/schedules` | schedules:read | 日历/列表：`?view=calendar|list&month=2026-08` 或 dateFrom~To |
| `GET` | `/schedules/:id` | schedules:read | 详情 + 关联 cast_sheet（如有） |
| `POST` | `/schedules` | schedules:write | 新建档期（order内自动补齐play_list/venues，也可手工单条加） |
| `PUT` | `/schedules/:id` | schedules:write | 修改档期 |
| `DELETE` | `/schedules/:id` | schedules:write | 删除（若已关联考勤或已出cast_sheet_attendance 已done则禁止） |
| `POST` | `/orders/:id/generate-schedules` | schedules:write | 根据 orders.play_list 批量生成档期（一键排期，返回 scheduleIds） |

### 4.3 演员表 RESTful API
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/cast-sheets` | cast:read | 分页（filters: playId/dateFrom/To/scheduleId） |
| `GET` | `/cast-sheets/:id` | cast:read | 详情（crew完整结构） |
| `POST` | `/cast-sheets` | cast:write | 新建；可传 `{fromTemplateId}` 一键套用组团模板 |
| `PUT` | `/cast-sheets/:id` | cast:write | 修改 crew / 换角 / 日工资议价 |
| `POST` | `/cast-sheets/:id/set-active` | cast:write | 设为当前编辑（is_active=1；其他同用户→0） |
| `GET` | `/cast-sheets/:id/print` | cast:print | **后端可选**：生成 A4 PDF Blob 返回（等价于前端 window.print） |
| `GET` | `/performers-db` | cast:read | 演职人员行当库（分页，filters: crewCategory/rank/status） |
| `POST` | `/performers-db` | cast:write | 新增演职人员 |
| `PUT` | `/performers-db/:id` | cast:write | 修改 |
| `GET` | `/troupe-templates` | cast:read | 组团模板列表 |
| `POST` | `/troupe-templates` | cast:write | 保存新模板 |
| `POST` | `/troupe-templates/:id/apply` | cast:write | 套用模板到 cast_sheet，返回新 cast_sheet_id |

---

## 五、模块 5：考勤（Staff + Attendance + Wages）

### 5.1 DDL（核心3张）
```sql
CREATE TABLE staff_roster_v1 (
  id                       VARCHAR(32)   PRIMARY KEY,
  name                     VARCHAR(50)   NOT NULL,
  id_card_no               VARCHAR(32),  -- 前端脱敏展示，后端全量加密存
  phone                    VARCHAR(20),
  crew_category            VARCHAR(10)   NOT NULL,
  profession               VARCHAR(50),
  rank_grade               VARCHAR(5)    NOT NULL,  -- A+ / A / B / C
  base_day_wage            DECIMAL(10,2) NOT NULL,
  night_subsidy            DECIMAL(10,2) NOT NULL DEFAULT 15,
  full_attendance_bonus    DECIMAL(10,2) NOT NULL DEFAULT 300,
  social_deduction_per_month DECIMAL(10,2),
  hire_date                DATE,
  emergency_contact        JSON,
  status                   VARCHAR(10)   NOT NULL DEFAULT '在职',
  bank_card_no             VARCHAR(32),
  remarks                  TEXT,
  created_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by               VARCHAR(32),
  updated_by               VARCHAR(32),
  _ts                      BIGINT        NOT NULL,
  INDEX idx_name (name),
  INDEX idx_crew (crew_category),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attendance_v1 (
  id                    VARCHAR(32)   PRIMARY KEY,
  staff_id              VARCHAR(32)   NOT NULL,
  date                  DATE          NOT NULL,
  schedule_id           VARCHAR(32),
  cast_sheet_id         VARCHAR(32),
  manual_tag            VARCHAR(10),
  attendance_type       VARCHAR(10)   NOT NULL,
  late_minutes          INT           NOT NULL DEFAULT 0,
  leave_early_minutes   INT           NOT NULL DEFAULT 0,
  work_shifts_count     INT           NOT NULL DEFAULT 1,
  night_show            TINYINT(1)    NOT NULL DEFAULT 0,
  special_reward        DECIMAL(10,2) NOT NULL DEFAULT 0,
  accident_fine         DECIMAL(10,2) NOT NULL DEFAULT 0,
  manual_adjustment     DECIMAL(10,2) NOT NULL DEFAULT 0,
  daily_wage_base       DECIMAL(10,2) NOT NULL,
  daily_subtotal        DECIMAL(10,2) NOT NULL,
  remark                VARCHAR(500),
  operator_id           VARCHAR(32),
  operator_name         VARCHAR(50),
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by            VARCHAR(32),
  updated_by            VARCHAR(32),
  _ts                   BIGINT        NOT NULL,
  UNIQUE KEY uk_staff_date (staff_id, date),
  INDEX idx_date (date),
  INDEX idx_schedule (schedule_id),
  CONSTRAINT fk_att_staff FOREIGN KEY (staff_id) REFERENCES staff_roster_v1(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wages_v1 (
  id                         VARCHAR(32)   PRIMARY KEY,
  staff_id                   VARCHAR(32)   NOT NULL,
  staff_name                 VARCHAR(50)   NOT NULL,
  month                      VARCHAR(7)    NOT NULL,  -- YYYY-MM
  total_work_days            INT           NOT NULL,
  total_shifts_count         INT           NOT NULL,
  base_total                 DECIMAL(12,2) NOT NULL,
  night_subsidy_total        DECIMAL(12,2) NOT NULL,
  special_reward_total       DECIMAL(12,2) NOT NULL,
  late_fine_total            DECIMAL(12,2) NOT NULL,
  absent_fine_total          DECIMAL(12,2) NOT NULL,
  accident_fine_total        DECIMAL(12,2) NOT NULL,
  manual_adjustment_total    DECIMAL(12,2) NOT NULL,
  full_attendance_bonus      DECIMAL(12,2) NOT NULL,
  social_deduction           DECIMAL(12,2) NOT NULL,
  gross_pay                  DECIMAL(12,2) NOT NULL,
  tax_deduction              DECIMAL(12,2) NOT NULL,
  net_pay                    DECIMAL(12,2) NOT NULL,
  status                     VARCHAR(20)   NOT NULL DEFAULT 'draft',
  finance_ledger_id          VARCHAR(32),
  paid_at                    DATETIME,
  payslip_printed_at         DATETIME,
  operator_id                VARCHAR(32),
  operator_name              VARCHAR(50),
  push_finance_at            DATETIME,
  created_at                 DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by                 VARCHAR(32),
  updated_by                 VARCHAR(32),
  _ts                        BIGINT        NOT NULL,
  UNIQUE KEY uk_staff_month (staff_id, month),
  INDEX idx_month (month),
  INDEX idx_status (status),
  CONSTRAINT fk_wag_staff FOREIGN KEY (staff_id) REFERENCES staff_roster_v1(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 5.2 花名册 RESTful API
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/staff-roster` | staff:read | 分页（keyword搜索name/phone；filters: crewCategory/rank/status） |
| `GET` | `/staff-roster/:id` | staff:read | 详情 + 最近3个月出勤统计 |
| `POST` | `/staff-roster` | staff:write | 新增 |
| `PUT` | `/staff-roster/:id` | staff:write | 修改 |
| `POST` | `/staff-roster/import` | staff:write | CSV批量导入（后端PapaParse替代，返回 success+fail+详情） |
| `DELETE` | `/staff-roster/:id` | staff:write | 离职/软删除（有考勤历史 → status=离职，不真删） |

### 5.3 考勤 RESTful API
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/attendance` | attendance:read | 按 staff + date 分页，或 `?staffId=&month=YYYY-MM` 单员工月视图 |
| `POST` | `/attendance` | attendance:write | 单条录入（防重复：同staffId+date已存在 → 409 code2002） |
| `PUT` | `/attendance/:id` | attendance:write | 修改（写入 att_audit_v2 审计 before/after JSON；任何字段变动必填留痕） |
| `POST` | `/attendance/batch-month` | attendance:write | 按月批量初始化：`{month, crewCategory?}` → 对在职员工该月每天生成一条 attendance_type=公休（供快速改） |
| `POST` | `/attendance/batch-tag` | attendance:write | 批量设装台/卸台：`{staffIds, date, tag}` |
| `POST` | `/attendance/reward` | attendance:write | 特殊奖励：`{staffId, date, reward, operator}` → 同步写 att_reward_tags_v2 + 更新 attendance_v1.special_reward |
| `POST` | `/attendance/accident` | attendance:write | 事故登记：`{staffId, date, level, fine, desc}` → 写 att_accidents_v2 + attendance_v1.accident_fine |
| `POST` | `/attendance/isapi-sync` | attendance:write | ISAPI门禁打卡同步：`{vendor, startTs, endTs}` |

### 5.4 工资 RESTful API
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/wages` | attendance:read | 按月列表：`?month=2026-08`（含每条工资合计净额） |
| `GET` | `/wages/:id` | attendance:read | 单条工资条详情（用于预览/打印） |
| `POST` | `/wages/calculate-month` | attendance:write | **按月结算**：输入 `{month, rules:{wageRuleIds by staffId}}` → 调用公式计算全部 staff 该月工资，返回 draft 列表（不入库） |
| `POST` | `/wages/save-month` | attendance:approve | 确认保存：写入/更新 wages_v1（status=draft），幂等可重复生成 |
| `POST` | `/wages/:id/approve` | attendance:approve | 单条批准 status=approved |
| `POST` | `/wages/push-finance` | attendance:pushFinance | **批量推送财务**：`{month, wageIds, reviewerUserId}` → ① wages 全部 status=push_finance；②生成 1 条 fin_ledger_v1（type=expense, source=工资发放，sum net_pay），③ finance_ledger_id 互写；事务 |
| `GET` | `/wages/:id/payslip.pdf` | attendance:printPayslip | 后端生成 A5 工资密封条 PDF（可选） |
| `POST` | `/wages/:id/printed` | attendance:printPayslip | 标记已打印（写入 payslip_printed_at + 审计 att_audit_v2 action=print_payslip） |

---

## 六、模块 6：财务（Finance）

### 6.1 DDL（核心3张 + 对账）
```sql
CREATE TABLE fin_ledger_v1 (
  id                 VARCHAR(32)   PRIMARY KEY,
  voucher_no         VARCHAR(32)   NOT NULL,
  date               DATE          NOT NULL,
  source             VARCHAR(30)   NOT NULL,
  type               VARCHAR(10)   NOT NULL,  -- income / expense
  category           VARCHAR(30)   NOT NULL,
  amount             DECIMAL(12,2) NOT NULL,
  order_id           VARCHAR(32),
  customer_id        VARCHAR(32),
  wage_ids           JSON,
  stocktake_id       VARCHAR(32),
  borrower_log_id    VARCHAR(32),
  counterparty       VARCHAR(100)  NOT NULL,
  payment_method     VARCHAR(20)   NOT NULL,
  bank_account_id    VARCHAR(32),
  invoice_id         VARCHAR(32),
  remark             VARCHAR(500),
  operator_id        VARCHAR(32),
  operator_name      VARCHAR(50),
  reviewer_name      VARCHAR(50)   NOT NULL,
  attachment         TEXT,
  status             VARCHAR(20)   NOT NULL DEFAULT 'draft',
  void_reason        VARCHAR(500),
  voided_by          VARCHAR(32),
  voided_at          DATETIME,
  related_void_id    VARCHAR(32),
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  _ts                BIGINT        NOT NULL,
  UNIQUE KEY uk_voucher (voucher_no),
  INDEX idx_date (date),
  INDEX idx_type_status (type, status),
  INDEX idx_source (source),
  INDEX idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fin_invoices_v1 (
  id                  VARCHAR(32)   PRIMARY KEY,
  invoice_no          VARCHAR(50)   NOT NULL,
  invoice_code        VARCHAR(50)   NOT NULL,
  invoice_date        DATE          NOT NULL,
  type                VARCHAR(10)   NOT NULL,
  amount              DECIMAL(12,2) NOT NULL,
  tax_amount          DECIMAL(12,2),
  total_with_tax      DECIMAL(12,2) NOT NULL,
  buyer_name          VARCHAR(200)  NOT NULL,
  buyer_tax_id        VARCHAR(50)   NOT NULL,
  seller_name         VARCHAR(200)  NOT NULL,
  seller_tax_id       VARCHAR(50)   NOT NULL,
  related_ledger_id   VARCHAR(32)   NOT NULL,
  related_order_id    VARCHAR(32),
  status              VARCHAR(10)   NOT NULL DEFAULT '正常',
  red_linked_invoice_id VARCHAR(32),
  file_url            VARCHAR(500),
  operator            VARCHAR(50),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  _ts                 BIGINT        NOT NULL,
  UNIQUE KEY uk_inv (invoice_code, invoice_no),
  INDEX idx_date (invoice_date),
  INDEX idx_ledger (related_ledger_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fin_recons_v1 (
  id                    VARCHAR(32)   PRIMARY KEY,
  month                 VARCHAR(7)    NOT NULL,
  bank_account          JSON          NOT NULL,
  book_income_total     DECIMAL(12,2) NOT NULL,
  book_expense_total    DECIMAL(12,2) NOT NULL,
  book_balance          DECIMAL(12,2) NOT NULL,
  bank_statement_income_total  DECIMAL(12,2) NOT NULL,
  bank_statement_expense_total DECIMAL(12,2) NOT NULL,
  bank_statement_balance        DECIMAL(12,2) NOT NULL,
  diff_income           DECIMAL(12,2) NOT NULL,
  diff_expense          DECIMAL(12,2) NOT NULL,
  diff_balance          DECIMAL(12,2) NOT NULL,
  diff_rate             DECIMAL(5,4)  NOT NULL,
  matched_count         INT           NOT NULL,
  unmatched_count       INT           NOT NULL,
  statement_rows        JSON,
  remark                VARCHAR(1000),
  recon_status          VARCHAR(20)   NOT NULL DEFAULT '草稿',
  operator              VARCHAR(50),
  reviewer              VARCHAR(50),
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  _ts                   BIGINT        NOT NULL,
  UNIQUE KEY uk_month_account (month, bank_account->>"$.accountNo"),
  INDEX idx_month (month),
  INDEX idx_status (recon_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 6.2 财务流水 RESTful API（核心，双人复核）
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/fin-ledger` | finance:read | 分页；filters: type/source/status/dateFrom/To/counterparty/orderId |
| `GET` | `/fin-ledger/:id` | finance:read | 详情（含附件、关联单据链接） |
| `POST` | `/fin-ledger` | finance:write | **新增凭证**：必须 body.reviewerUserId != 当前登录者（后端校验），校验通过后 status=draft → reviewerName=xxx，等待审核人点确认 |
| `POST` | `/fin-ledger/:id/review` | finance:review | **审核通过**：status=reviewed；审核人必须 != 制单人（后端校验） |
| `POST` | `/fin-ledger/:id/void` | finance:void | **作废凭证**：① 不物理删；② status=void + 填 voidReason + voidedBy + voidedAt；③ 生成一条负数金额冲销凭证 status=void，两者 relatedVoidId 互挂；④ 写审计日志 |
| `GET` | `/fin-ledger/export` | reports:export | 导流水 Excel（条件同上） |
| `GET` | `/fin-ledger/month-summary` | finance:read | 月度收支汇总：`?month=2026-08` → 按 source + category 分组的 sum |

### 6.3 发票 / 对账 RESTful API
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/fin-invoices` | finance:read | 发票列表 |
| `POST` | `/fin-invoices` | finance:write | 登记发票（关联 fin_ledger_v1） |
| `POST` | `/fin-invoices/:id/red` | finance:void | 红冲：生成负数发票 + 互挂 redLinkedInvoiceId |
| `GET` | `/fin-recons` | finance:read | 对账列表（按月） |
| `POST` | `/fin-recons` | finance:write | 创建对账（自动算差额，容差 ≤0.5% → recon_status=通过，否则差异待说明） |
| `POST` | `/fin-recons/:id/review` | finance:review | 财务总监复审（recon_status 通过 → 需总监） |

---

## 七、模块 7：权限（Accounts + Sessions）

### 7.1 DDL
```sql
CREATE TABLE accounts_v2 (
  id               VARCHAR(32)   PRIMARY KEY,
  username         VARCHAR(50)   NOT NULL,
  password_hash    VARCHAR(255)  NOT NULL,  -- bcrypt/argon2id
  name             VARCHAR(50)   NOT NULL,
  role             VARCHAR(20)   NOT NULL,  -- admin / finance / staff
  permissions      JSON          NOT NULL,
  phone            VARCHAR(20),
  status           VARCHAR(20)   NOT NULL DEFAULT 'active',
  last_login_at    DATETIME,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  _ts              BIGINT        NOT NULL,
  UNIQUE KEY uk_username (username),
  INDEX idx_role_status (role, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_sessions (
  id          VARCHAR(64)  PRIMARY KEY,  -- sess_{32hex}
  username    VARCHAR(50)  NOT NULL,
  name        VARCHAR(50)  NOT NULL,
  role        VARCHAR(20)  NOT NULL,
  role_name   VARCHAR(50)  NOT NULL,
  login_at    DATETIME     NOT NULL,
  expires_at  BIGINT       NOT NULL,     -- UNIX_MS
  status      VARCHAR(20)  NOT NULL DEFAULT 'active',  -- active / revoked
  ip          VARCHAR(50),
  user_agent  VARCHAR(500),
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_username (username),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 审计日志 5 张表（E-2 §七）
CREATE TABLE log_admin_login    (...);  -- 参照 E-2 §7.1
CREATE TABLE log_admin_logout   (...);
CREATE TABLE log_admin_action   (...);
CREATE TABLE log_admin_data_access (...);
CREATE TABLE log_sec_event      (...);
```

### 7.2 账号权限 RESTful API
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/accounts` | accounts:read | 账号列表（分页，filters: role/status） |
| `GET` | `/accounts/:id` | accounts:read | 账号详情（不含 passwordHash） |
| `POST` | `/accounts` | accounts:write | 新建账号：body 必传 `{username,password,name,role,permissions[],phone?}`；password 后端直接 bcrypt 存储 |
| `PUT` | `/accounts/:id` | accounts:write | 修改 name/role/permissions/phone/status（**不可改 password**） |
| `POST` | `/accounts/:id/reset-password` | accounts:resetPassword | **重置密码流程**：走短信 6.1-6.2（E-2），禁止前端传明文新密码；本接口返回 `{sceneToken, sendSms:true}`，然后走 `/v1/admin/forgot/reset` 流程，但需要已登录身份 |
| `POST` | `/accounts/:id/disable` | accounts:write | 停用（status=disabled）；所有该账号 session 立即黑名单 |
| `POST` | `/accounts/:id/enable` | accounts:write | 启用 |
| `DELETE` | `/accounts/:id` | accounts:write | 软删除（仅 status=disabled 允许；admin 角色不可删，至少保留 1 个） |
| `GET` | `/system/backup-list` | system:viewLog | 备份索引列表（backups_v2） |
| `POST` | `/system/backup` | system:backup | 触发全量备份 → 生成 AES-256 加密 zip，返回下载 URL（仅 admin 角色） |
| `POST` | `/system/restore` | system:restore | 从备份恢复（**高危**：admin + 手机验证码） |
| `GET` | `/system/logs/:logType` | system:viewLog | 读审计日志 log_admin_{login/logout/action/data_access/sec_event}，分页 + filters |

---

## 八、前台公开 API（可选）

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/public/settings` | 返回系统配置（troupeName/contactPhone/address/printHeaderImg），无鉴权 |
| `GET` | `/public/plays?status=active` | 剧目列表（前台 operas.html 展示） |
| `GET` | `/public/schedules?month=` | 当月已出档期（供 cast-public.html 对外阵容公示） |
| `GET` | `/public/cast-sheets/:id` | 单场阵容公开版（仅 crew 姓名/角色，不含日工资） |
| `GET` | `/public/content?type=banner|news|about_us|...` | 前台 content_v2 已发布数据 |
| `POST` | `/public/appointments` | 见 §1.3，公开预约提交（行为验证码 + 短信验手机号） |
| `POST` | `/public/quals` | 资质核验工单（前台 about.html） |
| `POST` | `/public/coops` | 合作对接工单 |

---

## 九、对接迁移 Checklist（生产上线必跑）

```
□ 1. 数据库 DDL 全量执行（MySQL / PostgreSQL 二选一）
   □ 1.1 核心 37 张表 + 5 张审计表
   □ 1.2 唯一键 / 外键 / 普通索引全部生效（EXPLAIN 验证）
   □ 1.3 写入初始化数据：
       - settings（秦安县秦剧团 troupeName）
       - accounts_v2 1 条 super admin（bcrypt 初始密码→首次登录强制改）
       - performers_db_v1 初始 30+ 行当（根据实际剧团人）
       - troupe_templates_v1 1-3 条默认组团模板
       - plays（根据实际保留剧目）
       - wage_rules_v1 默认规则（A+/A/B/C）
□ 2. 鉴权链路
   □ 2.1 /csrf + /login + /me + /refresh-session + /logout 五接口联调通过
   □ 2.2 AU-01 ~ AU-10（E-2 附录B）10 条验收用例全部通过
   □ 2.3 HttpOnly + Secure + SameSite + CSRF 四层全部生效
   □ 2.4 登录审计 log_admin_login 每笔正确写入
□ 3. 7 大模块 CRUD + 业务流转
   □ 3.1 预约 → 审核转正 → 生成订单 + 客户
   □ 3.2 订单 → 一键排期 → 生成档期 + 生成演员表
   □ 3.3 演员表 → 套用模板 → 日工资议价 → 保存
   □ 3.4 考勤按月录入 → 奖励/事故 → 自动算工资
   □ 3.5 工资推送财务 → 生成支出凭证
   □ 3.6 订单登记收款 → 双写 payment + ledger + 更新订单未收
   □ 3.7 财务凭证双人复核 → 对账 → 月关账
□ 4. 前端对接改动
   □ 4.1 login.html 1090 行替换真实 __BACKEND_AUTH_URL
   □ 4.2 app.js 加入 Admin.request 统一拦截器（E-2 §八）
   □ 4.3 所有 Storage.getItem/setItem 改为 Admin.request('/xxx')
       （localStorage 仅保留 admin_session 内存 sessionId 过渡）
□ 5. 安全 & 审计
   □ 5.1 财务作废凭证全部留痕，不物理删
   □ 5.2 越权 403 → 触发告警机器人
   □ 5.3 系统备份下载 → 每次推送运维群
□ 6. 数据迁移（若 localStorage demo → 生产）
   □ 6.1 启动 migrateV1toV2（app.js）通过 SHA-256 备份校验
   □ 6.2 导出 demo localStorage JSON → 后端批量接口 /import/from-localstorage 入库
   □ 6.3 全表 count(*) 校验一致
```

---

**文档结束**。后端工程师可按本文档 §一~§七 SQL+接口 独立实现，配合 E-1/E-2 完成全部对接。
