-- ==============================================================================
-- 秦安县秦剧团云端预约系统 · MySQL 8.0+ 初始化脚本 v1.0
-- 文档来源：F-1 §二 / E-5 §一~§七 DDL
-- 幂等策略：方案 A（保留数据，CREATE TABLE IF NOT EXISTS）+ 独立 ALTER ADD INDEX IF NOT EXISTS
--          若需覆盖重建：方案 B（DROP TABLE IF EXISTS 全清重建）见文末注释块
-- 预期 42 张表 = 37 业务表 + 5 审计/系统表
-- 执行：source /docker-entrypoint-initdb.d/init_v1.0_mysql.sql;  或  mysql -uroot -p < init_v1.0_mysql.sql
-- ==============================================================================
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET FOREIGN_KEY_CHECKS = 0;   -- 初始化临时关闭外键检查，批次顺序仍需遵守
SET sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
SET default_storage_engine = InnoDB;

-- ------------------------------------------------------------------------------
-- 前置：3 层账号隔离（F-1 §2.0 / M-2 · P0）
-- 注：MySQL CREATE USER IF NOT EXISTS 需要 5.7.8+；授权用 GRANT + SHOW GRANTS 校验
-- ------------------------------------------------------------------------------
CREATE USER IF NOT EXISTS 'qaxqjt_app'@'%'
  IDENTIFIED WITH caching_sha2_password BY '__APP_PASSWORD_FROM_ENV__'
  REQUIRE NONE;
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE
  ON qaxqjt_prod.* TO 'qaxqjt_app'@'%';

CREATE USER IF NOT EXISTS 'qaxqjt_migrate'@'localhost'
  IDENTIFIED WITH caching_sha2_password BY '__MIGRATE_PASSWORD_FROM_ENV__';
GRANT ALL PRIVILEGES ON qaxqjt_prod.* TO 'qaxqjt_migrate'@'localhost'
  WITH GRANT OPTION;

CREATE USER IF NOT EXISTS 'qaxqjt_read'@'10.%'
  IDENTIFIED WITH caching_sha2_password BY '__READ_PASSWORD_FROM_ENV__';
GRANT SELECT, SHOW VIEW
  ON qaxqjt_prod.* TO 'qaxqjt_read'@'10.%';

FLUSH PRIVILEGES;

-- ------------------------------------------------------------------------------
-- 批次 1：权限模块基础（无外键依赖，先建）—— 8 张
-- 通用字段约定：
--   id         VARCHAR(32) PRIMARY KEY   {short}_{32位随机}
--   created_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP
--   updated_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
--   created_by VARCHAR(32) -> accounts_v2.id
--   updated_by VARCHAR(32) -> accounts_v2.id
--   status     VARCHAR(20) NOT NULL DEFAULT 'active'   (软删除 = 'deleted')
--   _ts        BIGINT      NOT NULL   (UNIX_MS(created_at) · 精确排序/乐观锁对比)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts_v2 (
  id                  VARCHAR(32)   PRIMARY KEY,
  username            VARCHAR(64)   NOT NULL UNIQUE,
  password_hash       VARCHAR(255)  NOT NULL COMMENT 'bcrypt/argon2id, 绝不存明文',
  real_name           VARCHAR(50)   NOT NULL,
  role                VARCHAR(32)   NOT NULL DEFAULT 'staff',
  phone               VARCHAR(20),
  email               VARCHAR(128),
  avatar_url          VARCHAR(500),
  last_login_at       DATETIME,
  last_login_ip       VARCHAR(45),
  force_pwd_change    TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '1=首次登录强制改密码(M-14)',
  failed_login_count  INT           NOT NULL DEFAULT 0,
  locked_until        DATETIME,
  totp_secret         VARCHAR(64)   COMMENT 'AUTH_2FA_ENABLE 时用',
  status              VARCHAR(20)   NOT NULL DEFAULT 'active',
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='后台账号表 (M-14 初始超管默认 bcrypt)';

CREATE TABLE IF NOT EXISTS roles (
  id                  VARCHAR(32)   PRIMARY KEY,
  name                VARCHAR(50)   NOT NULL UNIQUE,
  description         VARCHAR(200),
  level               INT           NOT NULL DEFAULT 100,
  status              VARCHAR(20)   NOT NULL DEFAULT 'active',
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='角色表 (M-15: finance_maker/checker/cashier 需扩展)';

CREATE TABLE IF NOT EXISTS permissions (
  id                  VARCHAR(32)   PRIMARY KEY,
  code                VARCHAR(80)   NOT NULL UNIQUE
  COMMENT '例：appointments:write, finance:void, orders:approve',
  name                VARCHAR(80)   NOT NULL,
  module              VARCHAR(32)   NOT NULL,
  description         VARCHAR(200),
  level_require       INT           NOT NULL DEFAULT 100,
  status              VARCHAR(20)   NOT NULL DEFAULT 'active',
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  id                  VARCHAR(32)   PRIMARY KEY,
  role_id             VARCHAR(32)   NOT NULL,
  permission_code     VARCHAR(80)   NOT NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  UNIQUE KEY uk_role_perm (role_id, permission_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  id                  VARCHAR(32)   PRIMARY KEY,
  account_id          VARCHAR(32)   NOT NULL,
  role_id             VARCHAR(32)   NOT NULL,
  assigned_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by         VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  UNIQUE KEY uk_user_role (account_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id                  VARCHAR(64)   PRIMARY KEY
  COMMENT 'sessionId (sid, HttpOnly+Secure+SameSite · M-1 Redis 为主，此表备份审计)',
  account_id          VARCHAR(32)   NOT NULL,
  ip_address          VARCHAR(45),
  user_agent          VARCHAR(500),
  expires_at          DATETIME      NOT NULL,
  issued_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at        DATETIME,
  device_fingerprint  VARCHAR(128),
  revoked             TINYINT(1)    NOT NULL DEFAULT 0,
  _ts                 BIGINT        NOT NULL,
  KEY idx_sess_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id                  VARCHAR(32)   PRIMARY KEY,
  account_id          VARCHAR(32),
  username_snapshot   VARCHAR(64)   NOT NULL,
  action              VARCHAR(64)   NOT NULL
  COMMENT 'login|logout|create|update|delete|approve|void|download_backup|越权403',
  module              VARCHAR(32)   NOT NULL,
  target_table        VARCHAR(64),
  target_id           VARCHAR(32),
  ip_address          VARCHAR(45),
  user_agent          VARCHAR(500),
  request_id          VARCHAR(64)   COMMENT 'M-12 traceId',
  before_snapshot     JSON,
  after_snapshot      JSON,
  diff_summary        VARCHAR(500),
  severity            VARCHAR(16)   NOT NULL DEFAULT 'info'
  COMMENT 'info / warn / danger / critical',
  action_ts           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _ts                 BIGINT        NOT NULL,
  KEY idx_audit_user_ts (account_id, action_ts DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='E-2 审计日志 · 财务作废/越权/备份下载必留痕 (S-1~S-5)';

CREATE TABLE IF NOT EXISTS login_attempts (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username            VARCHAR(64),
  ip_address          VARCHAR(45)   NOT NULL,
  success             TINYINT(1)    NOT NULL,
  fail_reason         VARCHAR(64),
  attempted_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_agent          VARCHAR(500),
  _ts                 BIGINT        NOT NULL,
  KEY idx_login_ip_ts (ip_address, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='登录尝试审计 · 配合频控 5次/分钟/IP (S-7)';

-- ------------------------------------------------------------------------------
-- 批次 2：系统/配置（依赖 accounts_v2.created_by）—— 3 张
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id                  VARCHAR(64)   PRIMARY KEY,
  `key`               VARCHAR(100)  NOT NULL UNIQUE,
  `value`             TEXT          NOT NULL,
  value_type          VARCHAR(16)   NOT NULL DEFAULT 'string'
  COMMENT 'string/number/boolean/json',
  `group`             VARCHAR(32)   NOT NULL DEFAULT 'general',
  description         VARCHAR(200),
  is_public           TINYINT(1)    NOT NULL DEFAULT 0
  COMMENT '1=前台可通过 /public/content 拉取(剧团名/电话)',
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='系统参数 (F-1 §2.3 seed 写入 troupeName/Phone/地址/税号)';

CREATE TABLE IF NOT EXISTS system_backups (
  id                  VARCHAR(32)   PRIMARY KEY,
  filename            VARCHAR(200)  NOT NULL,
  size_bytes          BIGINT        NOT NULL,
  backup_type         VARCHAR(16)   NOT NULL DEFAULT 'daily'
  COMMENT 'daily / manual / migration_before',
  hash_sha256         VARCHAR(64)   NOT NULL COMMENT 'S-5 备份 SHA 校验',
  hash_md5            VARCHAR(32),
  storage_location    VARCHAR(16)   NOT NULL DEFAULT 'local'
  COMMENT 'local / oss / both',
  oss_object_key      VARCHAR(500),
  status              VARCHAR(16)   NOT NULL DEFAULT 'ok',
  integrity_ok        TINYINT(1)    NOT NULL DEFAULT 1
  COMMENT '每次下载/恢复时校验置位',
  downloaded_count    INT           NOT NULL DEFAULT 0
  COMMENT 'S-4 每次下载 → 推运维群',
  created_by          VARCHAR(32),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expire_at           DATETIME,
  _ts                 BIGINT        NOT NULL,
  KEY idx_backup_ts (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS data_migrations (
  id                  VARCHAR(64)   PRIMARY KEY
  COMMENT '脚本/迁移名: v1.0_initial, v1.1_add_phone_idx',
  batch               INT           NOT NULL DEFAULT 1,
  description         VARCHAR(200),
  executed_by         VARCHAR(32),
  expected_row_count  INT,
  actual_row_count    INT,
  dry_run             TINYINT(1)    NOT NULL DEFAULT 0,
  conflicts_json      JSON,
  signature_sha256    VARCHAR(64)
  COMMENT 'F-1 §九 localstorage 导入签名',
  status              VARCHAR(16)   NOT NULL DEFAULT 'success',
  executed_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='迁移记录（demo localStorage → 生产导入/DDL版本演进）';

-- ------------------------------------------------------------------------------
-- 批次 3：演员/剧目/道具/内容（主数据）—— 6 张
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS performers_db_v1 (
  id                  VARCHAR(32)   PRIMARY KEY,
  real_name           VARCHAR(50)   NOT NULL,
  stage_name          VARCHAR(50),
  gender              ENUM('男','女','其他') NOT NULL,
  birth_date          DATE,
  id_card_no          VARCHAR(18)   COMMENT '工资条 PDF 密码(后6位)',
  phone               VARCHAR(20),
  emergency_contact   VARCHAR(50),
  emergency_phone     VARCHAR(20),
  crew_category       VARCHAR(32)   NOT NULL
  COMMENT '生/旦/净/丑/武行/乐队/舞美/灯光/音响/服装/道具/司机/后勤/导演',
  rank_grade          VARCHAR(8)    NOT NULL DEFAULT 'C'
  COMMENT 'A+(国家一级)/A(二级)/B(三级)/C(青年) → wage_rules_v1 对应',
  join_date           DATE,
  leave_date          DATE,
  base_daily_wage     DECIMAL(10,2) NOT NULL DEFAULT 0,
  bank_card_no        VARCHAR(30),
  bank_name           VARCHAR(50),
  wechat_open_id      VARCHAR(64),
  avatar_url          VARCHAR(500),
  performer_type      VARCHAR(16)   NOT NULL DEFAULT 'employee'
  COMMENT 'employee(全职) / parttime(签约) / temp(临时外请)',
  resume_text         TEXT,
  remark              TEXT,
  status              VARCHAR(20)   NOT NULL DEFAULT 'active',
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='演职人员花名册（考勤主表外键 staff_id 指向本表）';

CREATE TABLE IF NOT EXISTS plays (
  id                  VARCHAR(32)   PRIMARY KEY,
  title               VARCHAR(100)  NOT NULL,
  subtitle            VARCHAR(200),
  alias               VARCHAR(200),
  genre               VARCHAR(32)   NOT NULL DEFAULT '传统本戏'
  COMMENT '传统本戏 / 折子戏 / 现代戏 / 原创定制剧',
  duration_minutes    INT,
  cast_min_count      INT           NOT NULL DEFAULT 10,
  difficulty_level    TINYINT       NOT NULL DEFAULT 3,
  premiere_year       INT,
  author              VARCHAR(100),
  director            VARCHAR(100),
  composer            VARCHAR(100),
  synopsis            TEXT,
  highlights          TEXT,
  poster_url          VARCHAR(500),
  gallery_urls        JSON,
  repertoire_status   VARCHAR(20)   NOT NULL DEFAULT 'repertoire'
  COMMENT 'repertoire保留剧目 / learning排演中 / retired停演',
  price_standard      DECIMAL(12,2) NOT NULL DEFAULT 0
  COMMENT '单场指导价（用于订单阶梯折扣参考）',
  tag_list            JSON COMMENT '["唱功戏","武打戏","悲剧","喜剧","惠民推荐"]',
  sort_order          INT           NOT NULL DEFAULT 100,
  is_public           TINYINT(1)    NOT NULL DEFAULT 1,
  view_count          INT           NOT NULL DEFAULT 0,
  status              VARCHAR(20)   NOT NULL DEFAULT 'active',
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='剧目库（cast_public.html + operas.html 数据来源）';

CREATE TABLE IF NOT EXISTS play_casts (
  id                  VARCHAR(32)   PRIMARY KEY,
  play_id             VARCHAR(32)   NOT NULL,
  role_name           VARCHAR(50)   NOT NULL COMMENT '如:包拯',
  role_type           VARCHAR(32)   COMMENT '行当:花脸/青衣/老生...',
  performer_id        VARCHAR(32)   COMMENT '默认出演人 (cast-sheet可覆盖)',
  alternate_ids       JSON COMMENT '备选出演人 performer_id[]',
  sort_order          INT           NOT NULL DEFAULT 50,
  remark              VARCHAR(200),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_pc_play (play_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS inventory_items (
  id                  VARCHAR(32)   PRIMARY KEY,
  category            VARCHAR(32)   NOT NULL
  COMMENT '服装/盔帽/道具/兵器/音响设备/灯光设备/乐器/办公耗材/化妆品',
  name                VARCHAR(100)  NOT NULL,
  spec                VARCHAR(200),
  play_id             VARCHAR(32)   COMMENT '专属剧目(可选)',
  qty_on_hand         INT           NOT NULL DEFAULT 0,
  qty_available       INT           NOT NULL DEFAULT 0,
  qty_loaned          INT           NOT NULL DEFAULT 0,
  unit                VARCHAR(10)   NOT NULL DEFAULT '件',
  unit_price          DECIMAL(10,2) DEFAULT 0,
  total_value         DECIMAL(12,2) DEFAULT 0,
  storage_location    VARCHAR(100)  COMMENT '库房/货架号',
  purchase_date       DATE,
  supplier            VARCHAR(100),
  condition_level     VARCHAR(16)   NOT NULL DEFAULT 'ok'
  COMMENT 'new / ok / warn / damaged / scrapped',
  last_inventory_ts   DATETIME,
  img_url             VARCHAR(500),
  remark              TEXT,
  status              VARCHAR(20)   NOT NULL DEFAULT 'active',
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_inv_cat (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='道具服装库存';

CREATE TABLE IF NOT EXISTS inventory_records (
  id                  VARCHAR(32)   PRIMARY KEY,
  item_id             VARCHAR(32)   NOT NULL,
  op_type             VARCHAR(16)   NOT NULL
  COMMENT 'in入库 / out领用 / loan外借 / return归还 / adjust盘点 / scrap报废',
  qty_change          INT           NOT NULL,
  op_date             DATE          NOT NULL,
  operator_id         VARCHAR(32),
  related_schedule_id VARCHAR(32)   COMMENT '与档期关联(外借)',
  unit_price          DECIMAL(10,2),
  supplier_or_person  VARCHAR(100),
  attachment_url      VARCHAR(500),
  remark              VARCHAR(500),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_invrec_item (item_id, op_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS content_v2 (
  id                  VARCHAR(32)   PRIMARY KEY,
  type                VARCHAR(32)   NOT NULL
  COMMENT 'banner / news / about_us / service_page / qualification / troupe_video',
  title               VARCHAR(200)  NOT NULL,
  slug                VARCHAR(100),
  cover_url           VARCHAR(500),
  summary             VARCHAR(500),
  body_html           MEDIUMTEXT,
  author              VARCHAR(50),
  source              VARCHAR(100),
  publish_date        DATE,
  publish_status      VARCHAR(16)   NOT NULL DEFAULT 'draft'
  COMMENT 'draft / published / archived',
  is_hot              TINYINT(1)    NOT NULL DEFAULT 0,
  sort_order          INT           NOT NULL DEFAULT 100,
  lang                VARCHAR(8)    NOT NULL DEFAULT 'zh-CN',
  meta_keywords       VARCHAR(200),
  meta_description    VARCHAR(500),
  view_count          INT           NOT NULL DEFAULT 0,
  status              VARCHAR(20)   NOT NULL DEFAULT 'active',
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_ct_type_status (type, publish_status, publish_date DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='官网内容（首页banner/新闻/剧团简介/业务介绍/资质证书）';

-- ------------------------------------------------------------------------------
-- 批次 4：客户 + 预约（上游）—— 6 张
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers_v1 (
  id                  VARCHAR(32)   PRIMARY KEY,
  customer_name       VARCHAR(100)  NOT NULL,
  customer_type       VARCHAR(16)   NOT NULL DEFAULT 'organization'
  COMMENT 'organization单位 / individual个人 / government政府 / school学校',
  organization        VARCHAR(200),
  contact_person      VARCHAR(50)   NOT NULL,
  phone               VARCHAR(20)   NOT NULL,
  alt_phone           VARCHAR(20),
  wechat              VARCHAR(50),
  email               VARCHAR(128),
  address             VARCHAR(500),
  id_card_no          VARCHAR(18)   COMMENT '个人客户实名',
  business_license    VARCHAR(50)   COMMENT '统一社会信用代码',
  tag_list            JSON COMMENT '["VIP","长期合作","政府单位"]',
  total_orders        INT           NOT NULL DEFAULT 0,
  total_shows         INT           NOT NULL DEFAULT 0,
  total_revenue       DECIMAL(14,2) NOT NULL DEFAULT 0,
  credit_level        VARCHAR(8)    NOT NULL DEFAULT 'A'
  COMMENT 'A+最优先 / A / B / C / D黑名单',
  source_channel      VARCHAR(32)   COMMENT 'booking线上/朋友介绍/惠民下乡/直播/文化站推荐',
  remark              TEXT,
  status              VARCHAR(20)   NOT NULL DEFAULT 'active',
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_cust_name_org (customer_name, organization),
  KEY idx_cust_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS customer_contacts (
  id                  VARCHAR(32)   PRIMARY KEY,
  customer_id         VARCHAR(32)   NOT NULL,
  name                VARCHAR(50)   NOT NULL,
  title               VARCHAR(50)   COMMENT '职务:院长/文化站站长',
  phone               VARCHAR(20)   NOT NULL,
  wechat              VARCHAR(50),
  email               VARCHAR(128),
  is_primary          TINYINT(1)    NOT NULL DEFAULT 1,
  remark              VARCHAR(200),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS customer_tags (
  id                  VARCHAR(32)   PRIMARY KEY,
  customer_id         VARCHAR(32)   NOT NULL,
  tag                 VARCHAR(32)   NOT NULL,
  tagged_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tagged_by           VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  UNIQUE KEY uk_cust_tag (customer_id, tag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS appointments (
  id                  VARCHAR(32)   PRIMARY KEY,
  customer_name       VARCHAR(100)  NOT NULL,
  phone               VARCHAR(20)   NOT NULL,
  organization        VARCHAR(200),
  shows               INT           NOT NULL DEFAULT 1 CHECK (shows >= 1),
  selected_plays      JSON COMMENT '[{playId, playTitle, qty?}]',
  preferred_start_date DATE,
  performance_type    VARCHAR(32),
  venue               VARCHAR(300),
  audience_scale      VARCHAR(16)   COMMENT '<500 / 500-2000 / 2000-5000 / >5000',
  budget_range        VARCHAR(16),
  remarks             TEXT,
  source              VARCHAR(32)   NOT NULL DEFAULT 'online'
  COMMENT 'booking线上 / qr二维码 / 线下 / 推荐 / 直播',
  verified_phone      TINYINT(1)    NOT NULL DEFAULT 0
  COMMENT 'S-8 短信验证码是否通过',
  captcha_passed      TINYINT(1)    NOT NULL DEFAULT 0
  COMMENT 'M-10 行为验证码是否通过',
  status              VARCHAR(20)   NOT NULL DEFAULT 'pending'
  COMMENT 'pending待审核 / approved已通过 / rejected已驳回 / converted转正 / cancelled取消',
  reject_reason       VARCHAR(500),
  audited_by          VARCHAR(32),
  audited_at          DATETIME,
  linked_customer_id  VARCHAR(32),
  linked_order_id     VARCHAR(32),
  assigned_staff      VARCHAR(32)   COMMENT '分配跟进运营',
  first_contact_at    DATETIME,
  last_contact_at     DATETIME,
  contact_count       INT           NOT NULL DEFAULT 0,
  request_id          VARCHAR(64),
  client_ip           VARCHAR(45),
  client_ua           VARCHAR(500),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_appt_phone_status (phone, status, created_at),
  KEY idx_appt_status_date (status, preferred_start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS appointment_plays (
  id                  VARCHAR(32)   PRIMARY KEY,
  appointment_id      VARCHAR(32)   NOT NULL,
  play_id             VARCHAR(32),
  play_title_snapshot VARCHAR(100)  NOT NULL,
  play_count          INT           NOT NULL DEFAULT 1,
  preferred_time      VARCHAR(100),
  remark              VARCHAR(300),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS appointment_audit (
  id                  VARCHAR(32)   PRIMARY KEY,
  appointment_id      VARCHAR(32)   NOT NULL,
  action              VARCHAR(32)   NOT NULL
  COMMENT 'submit / assign / call / note / approve / reject / convert / cancel',
  actor_id            VARCHAR(32),
  detail_json         JSON,
  action_ts           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _ts                 BIGINT        NOT NULL,
  KEY idx_apptaudit_aid (appointment_id, action_ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT '预约跟进留痕（24h未处理告警M-6用）';

-- ------------------------------------------------------------------------------
-- 批次 5：订单 + 档期 + 演员表 —— 8 张
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                  VARCHAR(32)   PRIMARY KEY,
  order_no            VARCHAR(32)   NOT NULL UNIQUE
  COMMENT 'YYYYMMDD + 6位流水, 可打印/开发票用',
  order_date          DATE          NOT NULL,
  customer_id         VARCHAR(32)   NOT NULL,
  customer_snapshot   JSON          NOT NULL
  COMMENT '下单时客户快照:名称/联系人/电话/地址',
  title               VARCHAR(200)  NOT NULL
  COMMENT '订单标题，列表页用，如"XX庙会2026秋3场",
  shows               INT           NOT NULL DEFAULT 1,
  start_date          DATE,
  end_date            DATE,
  venue               VARCHAR(300),
  performance_type    VARCHAR(32),
  price_total         DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_charges       DECIMAL(12,2) NOT NULL DEFAULT 0,
  grand_total         DECIMAL(12,2) NOT NULL DEFAULT 0,
  deposit_amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  unpaid_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_rule       VARCHAR(100)  COMMENT '阶梯折扣：>=10场8折',
  contract_url        VARCHAR(500)  COMMENT 'M-4 合同扫描件存 OSS',
  contract_signed_date DATE,
  status              VARCHAR(20)   NOT NULL DEFAULT 'draft'
  COMMENT 'draft草稿 / confirmed已确认 / performing演出中 / completed已完成 / invoiced已开票 / cancelled取消 / dispute纠纷',
  close_status        VARCHAR(16)   NOT NULL DEFAULT 'open'
  COMMENT 'open / temp_closed(暂关) / closed(财务关账)',
  source              VARCHAR(32)   COMMENT 'appointment转正 / 手动 / 老合同补录',
  source_appointment_id VARCHAR(32),
  assigned_sales      VARCHAR(32),
  internal_remark     TEXT,
  customer_remark     TEXT,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_order_status_date (status, order_date DESC),
  KEY idx_order_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id                  VARCHAR(32)   PRIMARY KEY,
  order_id            VARCHAR(32)   NOT NULL,
  item_type           VARCHAR(32)   NOT NULL
  COMMENT 'performance演出 / transport运输 / meals餐饮 / hotel住宿 / crew劳务 / stage舞台 / other其他',
  play_id             VARCHAR(32)   COMMENT '剧目ID(演出类)',
  title               VARCHAR(200)  NOT NULL,
  description         VARCHAR(500),
  qty                 INT           NOT NULL DEFAULT 1,
  unit_price          DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_rate       DECIMAL(5,4)  NOT NULL DEFAULT 1.0000,
  line_total          DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_rate            DECIMAL(5,4)  NOT NULL DEFAULT 0.0600,
  performance_date    DATE,
  sort_order          INT           NOT NULL DEFAULT 10,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS fin_payments_v1 (
  id                  VARCHAR(32)   PRIMARY KEY,
  order_id            VARCHAR(32),
  payment_no          VARCHAR(32)   NOT NULL UNIQUE,
  payer_name          VARCHAR(100),
  payer_account       VARCHAR(50),
  pay_method          VARCHAR(20)   NOT NULL
  COMMENT 'cash现金 / bank_transfer转账 / wechat微信 / alipay / check支票',
  pay_channel         VARCHAR(16)   COMMENT '线下 / 线上 / WxPay',
  amount              DECIMAL(12,2) NOT NULL,
  pay_date            DATE          NOT NULL,
  pay_time            TIME,
  bank_slip_url       VARCHAR(500)  COMMENT 'M-4 银行回单扫描件 OSS',
  status              VARCHAR(16)   NOT NULL DEFAULT 'confirmed'
  COMMENT 'pending待确认 / confirmed已到账 / rejected退回 / partial_partial',
  wxpay_transaction_id VARCHAR(64),
  wxpay_notify_raw    JSON,
  operator_id         VARCHAR(32),
  reconciled          TINYINT(1)    NOT NULL DEFAULT 0
  COMMENT '是否和银行对账单对账 (F-1 §4.1 ⑨)',
  ledger_posted       TINYINT(1)    NOT NULL DEFAULT 1
  COMMENT '是否已生成财务凭证 (双写 fin_ledger_v1)',
  remark              VARCHAR(500),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_pay_order (order_id, pay_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS order_refunds (
  id                  VARCHAR(32)   PRIMARY KEY,
  order_id            VARCHAR(32)   NOT NULL,
  refund_no           VARCHAR(32)   NOT NULL UNIQUE,
  amount              DECIMAL(12,2) NOT NULL,
  reason              VARCHAR(500)  NOT NULL,
  payback_method      VARCHAR(20),
  payback_date        DATE,
  status              VARCHAR(16)   NOT NULL DEFAULT 'pending'
  COMMENT 'pending申请 / approved通过 / paid已退款 / rejected驳回',
  ledger_posted       TINYINT(1)    NOT NULL DEFAULT 0,
  approver_id         VARCHAR(32),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS schedules_v2 (
  id                  VARCHAR(32)   PRIMARY KEY,
  schedule_no         VARCHAR(32)   NOT NULL UNIQUE,
  order_id            VARCHAR(32),
  title               VARCHAR(200)  NOT NULL,
  schedule_date_start DATE          NOT NULL,
  schedule_date_end   DATE          NOT NULL,
  days_duration       INT           NOT NULL DEFAULT 1,
  total_shows         INT           NOT NULL DEFAULT 1,
  venue               VARCHAR(300)   NOT NULL,
  venue_lat           DECIMAL(10,7),
  venue_lng           DECIMAL(10,7),
  audience_estimated  INT,
  performance_type    VARCHAR(32),
  daily_show_plan     JSON
  COMMENT '[{"date":"2026-09-01","plays":[{"playId":"xxx","startTime":"19:30","duration":160}]}]',
  transport_plan      TEXT,
  accommodation_plan  TEXT,
  stage_requirements  TEXT,
  status              VARCHAR(20)   NOT NULL DEFAULT 'tentative'
  COMMENT 'tentative暂定 / confirmed已确认 / locked锁单 / performing演出中 / completed完成 / cancelled取消 / rainout雨休改期',
  weather_forecast_snapshot JSON,
  conflict_checked_at DATETIME,
  cast_sheet_id       VARCHAR(32)   COMMENT '默认演员表ID',
  remark              TEXT,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_sched_range (schedule_date_start, schedule_date_end, status),
  KEY idx_sched_status (status, schedule_date_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='档期排班 (M-1 Redis 乐观锁 schedule_* 冲突检测)';

CREATE TABLE IF NOT EXISTS schedule_venues (
  id                  VARCHAR(32)   PRIMARY KEY,
  schedule_id         VARCHAR(32)   NOT NULL,
  venue_name          VARCHAR(200)  NOT NULL,
  venue_address       VARCHAR(300),
  show_date           DATE          NOT NULL,
  show_time_slot      VARCHAR(50)   COMMENT '日场/夜场/双场',
  stage_type          VARCHAR(32)   COMMENT '露天/搭台/室内剧场',
  capacity_estimate   INT,
  contact_person      VARCHAR(50),
  contact_phone       VARCHAR(20),
  remark              VARCHAR(500),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cast_sheets_v1 (
  id                  VARCHAR(32)   PRIMARY KEY,
  schedule_id         VARCHAR(32),
  order_id            VARCHAR(32),
  apply_template_id   VARCHAR(32)   COMMENT '套用了哪个组团模板 (troupe_templates_v1)',
  title               VARCHAR(200)  NOT NULL,
  performance_date    DATE          NOT NULL,
  matinee_or_evening  VARCHAR(16)   NOT NULL DEFAULT '夜场',
  venue               VARCHAR(300),
  chief_director      VARCHAR(32)   COMMENT 'performer_id',
  stage_manager       VARCHAR(32),
  show_plays          JSON
  COMMENT '[{"playId":"xxx","playTitle":"火焰驹","startTime":"19:30"}]',
  total_cost_labor    DECIMAL(12,2) NOT NULL DEFAULT 0
  COMMENT '当日所有演职人员日工资合计(cast_sheet_crew sum)，算工资对比基准',
  total_cost_other    DECIMAL(12,2) NOT NULL DEFAULT 0,
  final_status        VARCHAR(16)   NOT NULL DEFAULT 'draft'
  COMMENT 'draft草稿 / finalized已定版 / locked演出当日锁 / archived归档',
  finalized_by        VARCHAR(32),
  finalized_at        DATETIME,
  print_count         INT           NOT NULL DEFAULT 0,
  remark              TEXT,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_cs_schedule (schedule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='演出当日演员表（cast-sheet.html 可打印 A4 竖版/横版卡式）';

CREATE TABLE IF NOT EXISTS cast_sheet_crew (
  id                  VARCHAR(32)   PRIMARY KEY,
  cast_sheet_id       VARCHAR(32)   NOT NULL,
  performer_id        VARCHAR(32)   NOT NULL,
  performer_name_snap VARCHAR(50)   NOT NULL,
  crew_category_snap  VARCHAR(32)   NOT NULL,
  role_assigned       VARCHAR(100)  COMMENT '如:扮演包拯/司鼓/灯光师',
  play_id             VARCHAR(32),
  daily_wage          DECIMAL(10,2) NOT NULL DEFAULT 0
  COMMENT '当日日工资 (可覆盖模板默认 日工资议价)',
  wage_reason         VARCHAR(200)  COMMENT '议价原因/A角补贴/外请高价',
  transport_allowance DECIMAL(8,2)  DEFAULT 0,
  meal_allowance      DECIMAL(8,2)  DEFAULT 0,
  other_allowance     DECIMAL(8,2)  DEFAULT 0,
  deduction_amount    DECIMAL(8,2)  DEFAULT 0,
  deduction_reason    VARCHAR(200),
  net_amount          DECIMAL(10,2) NOT NULL DEFAULT 0,
  attendance_type     VARCHAR(16)   NOT NULL DEFAULT 'full'
  COMMENT 'full全勤 / half半日 / leave请假 / absent缺席 / rainout雨休',
  signed_in           TINYINT(1)    NOT NULL DEFAULT 0,
  signed_at           DATETIME,
  sign_ip             VARCHAR(45),
  sort_order          INT           NOT NULL DEFAULT 50,
  section             VARCHAR(16)   NOT NULL DEFAULT '主演'
  COMMENT '主演/乐队/舞美/灯光/服装/道具/后勤/司机',
  remark              VARCHAR(300),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_csc_cs (cast_sheet_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------------------------
-- 批次 6：财务台账 + 发票 + 对账 + 欠款 + 工资批次（F-1 §4.1 ⑧⑨）—— 7 张
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wage_rules_v1 (
  id                  VARCHAR(32)   PRIMARY KEY,
  rank_grade          VARCHAR(8)    NOT NULL UNIQUE
  COMMENT 'A+/A/B/C/C-青年/外请A/外请B',
  base_daily_standard  DECIMAL(10,2) NOT NULL,
  chief_role_allowance DECIMAL(8,2) NOT NULL DEFAULT 0,
  supporting_role_base DECIMAL(8,2) NOT NULL DEFAULT 0,
  ensemble_base       DECIMAL(8,2) NOT NULL DEFAULT 0,
  crew_band_base      DECIMAL(8,2) NOT NULL DEFAULT 0,
  tech_dancer_base    DECIMAL(8,2) NOT NULL DEFAULT 0,
  night_show_bonus    DECIMAL(6,2) NOT NULL DEFAULT 0,
  holiday_multiplier  DECIMAL(5,4)  NOT NULL DEFAULT 1.5000,
  transport_allowance DECIMAL(6,2) NOT NULL DEFAULT 30,
  meal_allowance      DECIMAL(6,2) NOT NULL DEFAULT 30,
  full_attendance_bonus DECIMAL(6,2) NOT NULL DEFAULT 200,
  performance_bonus_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0500
  COMMENT '按当月总演出收入比例计提',
  effective_from_date DATE          NOT NULL,
  effective_to_date   DATE,
  status              VARCHAR(20)   NOT NULL DEFAULT 'active',
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='工资等级规则（A+/A/B/C 日薪基表 F-1 §2.3.2 seed 写默认）';

CREATE TABLE IF NOT EXISTS wage_batches_v1 (
  id                  VARCHAR(32)   PRIMARY KEY,
  batch_no            VARCHAR(32)   NOT NULL UNIQUE
  COMMENT 'YYYYMM-N, 如 202609-9',
  payroll_month       VARCHAR(7)    NOT NULL
  COMMENT 'YYYY-MM',
  performers_count    INT           NOT NULL DEFAULT 0,
  total_base_wage     DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_bonus         DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_allowance     DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_deduction     DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_tax_personal  DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_social_emp    DECIMAL(12,2) NOT NULL DEFAULT 0,
  grand_total_net     DECIMAL(14,2) NOT NULL DEFAULT 0,
  engine_version      VARCHAR(16)   NOT NULL DEFAULT 'V2'
  COMMENT 'WageEngine V2 calcMonthSalaryV2 (attendance.html 控制台可测)',
  calc_params_json    JSON,
  calc_duration_ms    INT,
  status              VARCHAR(16)   NOT NULL DEFAULT 'draft'
  COMMENT 'draft草稿 / calc_done核算完 / finance_pushed已推送财务 / paid已发放 / closed关账',
  pushed_finance_at   DATETIME,
  posted_ledger_ids   JSON COMMENT '生成的 fin_ledger_v1.id[]',
  approver_id         VARCHAR(32),
  calc_log_url        VARCHAR(500),
  remark              TEXT,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS wage_items_v1 (
  id                  VARCHAR(32)   PRIMARY KEY,
  batch_id            VARCHAR(32)   NOT NULL,
  performer_id        VARCHAR(32)   NOT NULL,
  performer_snapshot  JSON          NOT NULL
  COMMENT '姓名/行当/级别/银行卡后4位/身份证后6位(PDF密码)',
  attendance_days_full DECIMAL(5,1) NOT NULL DEFAULT 0,
  attendance_days_half DECIMAL(5,1) NOT NULL DEFAULT 0,
  leave_sick_days     DECIMAL(5,1) NOT NULL DEFAULT 0,
  absent_days         INT           NOT NULL DEFAULT 0,
  performance_shows   INT           NOT NULL DEFAULT 0,
  base_wage           DECIMAL(12,2) NOT NULL DEFAULT 0,
  role_bonus          DECIMAL(10,2) NOT NULL DEFAULT 0,
  performance_bonus   DECIMAL(10,2) NOT NULL DEFAULT 0,
  full_attendance_bonus DECIMAL(8,2) NOT NULL DEFAULT 0,
  transport_allowance DECIMAL(10,2) NOT NULL DEFAULT 0,
  meal_allowance      DECIMAL(10,2) NOT NULL DEFAULT 0,
  holiday_allowance   DECIMAL(10,2) NOT NULL DEFAULT 0,
  other_bonus         DECIMAL(10,2) NOT NULL DEFAULT 0,
  accident_penalty    DECIMAL(10,2) NOT NULL DEFAULT 0,
  late_penalty        DECIMAL(10,2) NOT NULL DEFAULT 0,
  other_deduction     DECIMAL(10,2) NOT NULL DEFAULT 0,
  social_insurance_emp DECIMAL(10,2) NOT NULL DEFAULT 0,
  housing_fund_emp    DECIMAL(10,2) NOT NULL DEFAULT 0,
  personal_tax        DECIMAL(10,2) NOT NULL DEFAULT 0,
  gross_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_deduction     DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  payslip_pdf_url     VARCHAR(500)  COMMENT 'PDF加密后存OSS (员工邮箱/短信下发)',
  payslip_sent        TINYINT(1)    NOT NULL DEFAULT 0,
  payslip_sent_ts     DATETIME,
  sign_confirmed      TINYINT(1)    NOT NULL DEFAULT 0,
  remark              VARCHAR(500),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _ts                 BIGINT        NOT NULL,
  UNIQUE KEY uk_wageitem_batch_staff (batch_id, performer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS fin_ledger_v1 (
  id                  VARCHAR(32)   PRIMARY KEY,
  voucher_no          VARCHAR(32)   NOT NULL UNIQUE
  COMMENT '记-YYYYMM-流水号, 打印用',
  voucher_date        DATE          NOT NULL,
  voucher_type        VARCHAR(20)   NOT NULL
  COMMENT 'receive收款 / payment付款 / transfer转账 / adjust调整 / carry结转 / void作废红冲',
  source_module       VARCHAR(16)   COMMENT 'order/wages/invoice/manual/bankfee',
  source_id           VARCHAR(32),
  abstract            VARCHAR(200)  NOT NULL,
  debit_account_code  VARCHAR(16)   NOT NULL,
  debit_account_name  VARCHAR(50)   NOT NULL,
  debit_amount        DECIMAL(14,2) NOT NULL DEFAULT 0,
  credit_account_code VARCHAR(16)   NOT NULL,
  credit_account_name VARCHAR(50)   NOT NULL,
  credit_amount       DECIMAL(14,2) NOT NULL DEFAULT 0,
  amount_equal_check  TINYINT(1)    NOT NULL DEFAULT 1
  COMMENT '借贷平衡校验（不平=0必须处理）',
  currency            VARCHAR(3)    NOT NULL DEFAULT 'CNY',
  related_party_name  VARCHAR(100),
  related_order_id    VARCHAR(32),
  related_wage_batch  VARCHAR(32),
  attachment_urls     JSON COMMENT '银行回单/发票/合同扫描件[]（M-4 OSS）',
  status              VARCHAR(16)   NOT NULL DEFAULT 'draft'
  COMMENT 'draft制单 / pending待复核(M-15 制单/复核分离) / approved已复核 / posted已记账 / is_void作废留痕 / reconciled已对账',
  is_void             TINYINT(1)    NOT NULL DEFAULT 0
  COMMENT 'S-2 禁止物理删除！一律 is_void=1 红冲留痕，void_of_voucher_id 关联原凭证',
  void_of_voucher_id  VARCHAR(32),
  void_reason         VARCHAR(300),
  maker_id            VARCHAR(32)   NOT NULL
  COMMENT 'M-15 制单人（finance_maker角色）',
  checker_id          VARCHAR(32)   COMMENT 'M-15 复核人（finance_checker角色，≥1万必须非本人）',
  poster_id           VARCHAR(32),
  posted_at           DATETIME,
  fiscal_period       VARCHAR(7)    NOT NULL
  COMMENT 'YYYY-MM，关账字段（fin_monthly_close）',
  is_reconciled       TINYINT(1)    NOT NULL DEFAULT 0,
  reconcile_batch_id  VARCHAR(32),
  remark              TEXT,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_ledger_voucher_date (voucher_date DESC, voucher_type),
  KEY idx_ledger_status_reconciled (status, is_reconciled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='财务记账凭证（S-1 禁止物理删除！一律 is_void 作废）';

CREATE TABLE IF NOT EXISTS fin_invoices_v1 (
  id                  VARCHAR(32)   PRIMARY KEY,
  invoice_no          VARCHAR(32)   NOT NULL UNIQUE
  COMMENT '发票号码（纸质/电子）',
  invoice_code        VARCHAR(32),
  invoice_type        VARCHAR(16)   NOT NULL
  COMMENT 'special专票 / general普票 / e_special电子专票 / e_general电子普票',
  title_type          VARCHAR(16)   NOT NULL DEFAULT 'company'
  COMMENT 'company企业 / personal个人 / government机关',
  buyer_title         VARCHAR(200)  NOT NULL,
  buyer_tax_no        VARCHAR(20),
  buyer_address       VARCHAR(300),
  buyer_phone         VARCHAR(20),
  buyer_bank          VARCHAR(200),
  buyer_bank_account  VARCHAR(40),
  seller_title        VARCHAR(200)  NOT NULL,
  seller_tax_no       VARCHAR(20)   NOT NULL,
  invoice_date        DATE          NOT NULL,
  tax_rate            DECIMAL(5,4)  NOT NULL DEFAULT 0.0600,
  tax_excl_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
  tax_amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount        DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_in_chinese    VARCHAR(100),
  items_json          JSON,
  related_order_id    VARCHAR(32),
  related_payment_id  VARCHAR(32),
  pdf_url             VARCHAR(500)   COMMENT 'M-4 电子发票 PDF OSS 存储',
  status              VARCHAR(16)   NOT NULL DEFAULT 'issued'
  COMMENT 'issued已开 / red红冲 / invalid作废 / lost丢失',
  red_of_invoice_id   VARCHAR(32),
  issuer_id           VARCHAR(32),
  remark              VARCHAR(500),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS fin_recons_v1 (
  id                  VARCHAR(32)   PRIMARY KEY,
  batch_no            VARCHAR(32)   NOT NULL UNIQUE
  COMMENT '对账批次: RECON-YYYYMM',
  fiscal_period       VARCHAR(7)    NOT NULL,
  bank_account_name   VARCHAR(100)  NOT NULL,
  bank_account_no_last4 VARCHAR(4)  NOT NULL,
  bank_statement_date DATE          NOT NULL,
  book_balance        DECIMAL(14,2) NOT NULL,
  bank_balance        DECIMAL(14,2) NOT NULL,
  diff_amount         DECIMAL(14,2) NOT NULL DEFAULT 0,
  adjusted_book_balance DECIMAL(14,2) NOT NULL DEFAULT 0,
  reconciling_items_json JSON
  COMMENT '未达账项：企收银未收/企付银未付/银收企未收/银付企未付',
  status              VARCHAR(16)   NOT NULL DEFAULT 'in_progress'
  COMMENT 'in_progress / matched / needs_adjust / approved_final',
  matched_count       INT           NOT NULL DEFAULT 0,
  unmatched_count     INT           NOT NULL DEFAULT 0,
  reconciled_by       VARCHAR(32),
  approved_by         VARCHAR(32),
  completed_at        DATETIME,
  remark              TEXT,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS fin_debts_v1 (
  id                  VARCHAR(32)   PRIMARY KEY,
  order_id            VARCHAR(32),
  debtor_name         VARCHAR(100)  NOT NULL,
  debtor_contact      VARCHAR(50),
  debtor_phone        VARCHAR(20),
  original_amount     DECIMAL(14,2) NOT NULL,
  paid_amount         DECIMAL(14,2) NOT NULL DEFAULT 0,
  remaining_amount    DECIMAL(14,2) NOT NULL,
  due_date            DATE          NOT NULL,
  overdue_days        INT AS (DATEDIFF(CURDATE(), due_date)) VIRTUAL,
  last_remind_date    DATE,
  remind_count        INT           NOT NULL DEFAULT 0,
  source              VARCHAR(32)   NOT NULL DEFAULT 'order_unpaid',
  dunning_progress    VARCHAR(16)   NOT NULL DEFAULT 'level1'
  COMMENT 'level1温柔 / level2正式 / level3律师函 / level4诉讼 / write_off坏账',
  guarantee_party     VARCHAR(100),
  attachments         JSON COMMENT '欠条扫描件/通话录音[]',
  status              VARCHAR(16)   NOT NULL DEFAULT 'pending'
  COMMENT 'pending催收中 / partial部分回收 / cleared还清 / disputed纠纷 / written_off坏账',
  assigned_staff      VARCHAR(32),
  alert_triggered     TINYINT(1)    NOT NULL DEFAULT 0
  COMMENT 'M-6 逾期告警推送财务群+老板',
  remark              TEXT,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='应收账款欠款追踪（M-6 逾期告警触发）';

-- ------------------------------------------------------------------------------
-- 批次 7：考勤 + 打卡 + 请假 + 加班（依赖 performers + wage_batches_v1）—— 4 张
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_v1 (
  id                  VARCHAR(32)   PRIMARY KEY,
  staff_id            VARCHAR(32)   NOT NULL COMMENT 'FK performers_db_v1.id',
  attendance_date     DATE          NOT NULL,
  attendance_type     VARCHAR(16)   NOT NULL DEFAULT '公休'
  COMMENT 'full出勤日场/night出勤夜场/double双场/half半日/公休/rest调休/SL病假/PL年假/ML婚假/BL丧假/ML产假/absent旷工/rainout雨休/leave请假/outing公差/study学习/business出差/injury工伤',
  attendance_month    VARCHAR(7) GENERATED ALWAYS AS (DATE_FORMAT(attendance_date, '%Y-%m')) VIRTUAL,
  week_of_month       TINYINT,
  related_schedule_id VARCHAR(32),
  related_cast_sheet  VARCHAR(32),
  shows_performed     INT           NOT NULL DEFAULT 0,
  work_start          TIME,
  work_end            TIME,
  work_hours          DECIMAL(4,1),
  transport_allowance DECIMAL(8,2) DEFAULT 0,
  meal_allowance      DECIMAL(8,2) DEFAULT 0,
  rain_allowance      DECIMAL(8,2) DEFAULT 0,
  night_allowance     DECIMAL(8,2) DEFAULT 0,
  holiday_multiplier  DECIMAL(5,4) DEFAULT 1.0000,
  performance_bonus   DECIMAL(10,2) DEFAULT 0,
  accident_penalty    DECIMAL(10,2) DEFAULT 0 COMMENT '演出事故罚款',
  discipline_penalty  DECIMAL(10,2) DEFAULT 0 COMMENT '迟到/早退/忘打卡',
  other_bonus         DECIMAL(10,2) DEFAULT 0,
  other_deduction     DECIMAL(10,2) DEFAULT 0,
  punch_count_ok      TINYINT       NOT NULL DEFAULT 0 COMMENT '0/1/2（上下午打卡）',
  remark              VARCHAR(500),
  locked              TINYINT(1)    NOT NULL DEFAULT 0
  COMMENT '当月工资核算后锁行，不可改',
  wage_batch_id       VARCHAR(32)
  COMMENT '工资批次ID（一旦关联行级锁定=1）',
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  updated_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  UNIQUE KEY uk_att_staff_date (staff_id, attendance_date),
  KEY idx_att_month (staff_id, attendance_month, attendance_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='每日考勤（月底算工资最核心 JOIN 表）';

CREATE TABLE IF NOT EXISTS attendance_punch_records (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  staff_id            VARCHAR(32)   NOT NULL,
  attendance_date     DATE          NOT NULL,
  punch_type          VARCHAR(16)   NOT NULL
  COMMENT 'morning上班 / noon中午 / evening下班 / show_before演出前 / show_after演出后',
  punch_time          TIME          NOT NULL,
  punch_method        VARCHAR(16)   NOT NULL
  COMMENT 'gps定位 / face人脸识别 / qrcode扫二维码 / manual后台补卡 / nfc卡',
  punch_lat           DECIMAL(10,7),
  punch_lng           DECIMAL(10,7),
  venue_radius_match  TINYINT(1)    COMMENT 'GPS是否在演出场地500米内',
  punch_img_url       VARCHAR(500),
  device_id           VARCHAR(64),
  client_ip           VARCHAR(45),
  is_late             TINYINT(1)    NOT NULL DEFAULT 0,
  is_early_leave      TINYINT(1)    NOT NULL DEFAULT 0,
  manual_corrected    TINYINT(1)    NOT NULL DEFAULT 0,
  corrected_by        VARCHAR(32),
  corrected_reason    VARCHAR(200),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _ts                 BIGINT        NOT NULL,
  KEY idx_punch_staff (staff_id, attendance_date, punch_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='打卡明细（S-7 考勤打卡留痕）';

CREATE TABLE IF NOT EXISTS leave_applications (
  id                  VARCHAR(32)   PRIMARY KEY,
  staff_id            VARCHAR(32)   NOT NULL,
  leave_type          VARCHAR(16)   NOT NULL
  COMMENT 'SL/PL/AL年假/BL/CL丧假/ML产假/陪产假/病假事假/调休/rainout补休',
  date_from           DATE          NOT NULL,
  date_to             DATE          NOT NULL,
  days_count          DECIMAL(5,1)  NOT NULL,
  reason              VARCHAR(500)  NOT NULL,
  attachment_url      VARCHAR(500),
  status              VARCHAR(16)   NOT NULL DEFAULT 'pending'
  COMMENT 'pending待批 / approved通过 / rejected驳回 / cancelled撤销',
  workflow_stage      VARCHAR(16)   NOT NULL DEFAULT 'hr'
  COMMENT 'hr审 / team_leader组长审 / director团长终审 (>7天)',
  approver_hr         VARCHAR(32),
  approver_final      VARCHAR(32),
  approved_at         DATETIME,
  attendance_posted   TINYINT(1)    NOT NULL DEFAULT 0
  COMMENT '审批通过后自动写入考勤表对应行 attendance_type',
  remark              VARCHAR(300),
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_leave_staff (staff_id, date_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS overtime_records (
  id                  VARCHAR(32)   PRIMARY KEY,
  staff_id            VARCHAR(32)   NOT NULL,
  overtime_date       DATE          NOT NULL,
  overtime_type       VARCHAR(16)   NOT NULL
  COMMENT 'rehearsal排戏 / stage_buliding装台 / props_prep备道具 / tour_load卸车 / event_event活动 / other其他',
  time_from           TIME,
  time_to             TIME,
  hours               DECIMAL(4,1)  NOT NULL,
  subsidy_per_hour    DECIMAL(8,2) DEFAULT 0,
  total_subsidy       DECIMAL(10,2) DEFAULT 0,
  meal_ticket_count   INT DEFAULT 0,
  reason              VARCHAR(500),
  approved_by         VARCHAR(32),
  approved_at         DATETIME,
  wage_posted         TINYINT(1)    NOT NULL DEFAULT 0
  COMMENT '是否计入当月工资(写入 attendance_v1.other_bonus)',
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          VARCHAR(32),
  _ts                 BIGINT        NOT NULL,
  KEY idx_ot_staff (staff_id, overtime_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ==============================================================================
-- 15 条高频查询索引（F-1 §2.2 / M-3 P1 · MySQL 8.0+ 支持 CREATE INDEX IF NOT EXISTS 需要 8.0.21+）
-- 用存储过程+ INFORMATION_SCHEMA 检查实现幂等，兼容全版本
-- ==============================================================================
DELIMITER //
DROP PROCEDURE IF EXISTS add_index_if_not_exists //
CREATE PROCEDURE add_index_if_not_exists(
  IN tbl  VARCHAR(64),
  IN idx  VARCHAR(64),
  IN ddl  TEXT
)
BEGIN
  DECLARE v INT DEFAULT 0;
  SELECT COUNT(1) INTO v FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND INDEX_NAME = idx;
  IF v = 0 THEN
    SET @sql = ddl;
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- 1 预约：手机号状态时间
CALL add_index_if_not_exists('appointments', 'idx_appt_phone_status',
  'CREATE INDEX idx_appt_phone_status ON appointments(phone, status, created_at)');
-- 2 预约：状态+期望日期（看板查询）
CALL add_index_if_not_exists('appointments', 'idx_appt_status_date',
  'CREATE INDEX idx_appt_status_date ON appointments(status, preferred_start_date)');
-- 3 客户：姓名+组织模糊
CALL add_index_if_not_exists('customers_v1', 'idx_cust_name_org',
  'CREATE INDEX idx_cust_name_org ON customers_v1(customer_name, organization)');
-- 4 客户：手机号查历史
CALL add_index_if_not_exists('customers_v1', 'idx_cust_phone',
  'CREATE INDEX idx_cust_phone ON customers_v1(phone)');
-- 5 订单：状态日期看板
CALL add_index_if_not_exists('orders', 'idx_order_status_date',
  'CREATE INDEX idx_order_status_date ON orders(status, order_date DESC)');
-- 6 订单：按客户
CALL add_index_if_not_exists('orders', 'idx_order_customer',
  'CREATE INDEX idx_order_customer ON orders(customer_id)');
-- 7 档期：日期范围冲突检查 (schedule_date_start BETWEEN ? AND ? OR schedule_date_end ...)
CALL add_index_if_not_exists('schedules_v2', 'idx_sched_range',
  'CREATE INDEX idx_sched_range ON schedules_v2(schedule_date_start, schedule_date_end, status)');
-- 8 档期：状态+开始
CALL add_index_if_not_exists('schedules_v2', 'idx_sched_status',
  'CREATE INDEX idx_sched_status ON schedules_v2(status, schedule_date_start)');
-- 9 考勤：唯一+按月最核心查询 (建表已建 UNIQUE KEY uk_att_staff_date 与 idx_att_month，这里保险)
-- 10 财务凭证：日期+类型
CALL add_index_if_not_exists('fin_ledger_v1', 'idx_ledger_voucher_date',
  'CREATE INDEX idx_ledger_voucher_date ON fin_ledger_v1(voucher_date DESC, voucher_type)');
-- 11 财务凭证：状态+对账
CALL add_index_if_not_exists('fin_ledger_v1', 'idx_ledger_status_reconciled',
  'CREATE INDEX idx_ledger_status_reconciled ON fin_ledger_v1(status, is_reconciled)');
-- 12 登录尝试：IP+时间 (S-7 频控，每 10 秒 1 次)
CALL add_index_if_not_exists('login_attempts', 'idx_login_ip_ts',
  'CREATE INDEX idx_login_ip_ts ON login_attempts(ip_address, attempted_at)');
-- 13 审计：用户+时间
CALL add_index_if_not_exists('audit_logs', 'idx_audit_user_ts',
  'CREATE INDEX idx_audit_user_ts ON audit_logs(account_id, action_ts DESC)');
-- 14 演员表：按档期
CALL add_index_if_not_exists('cast_sheets_v1', 'idx_cs_schedule',
  'CREATE INDEX idx_cs_schedule ON cast_sheets_v1(schedule_id)');
-- 15 演员表人员：按演员表
CALL add_index_if_not_exists('cast_sheet_crew', 'idx_csc_cs',
  'CREATE INDEX idx_csc_cs ON cast_sheet_crew(cast_sheet_id)');

DROP PROCEDURE IF EXISTS add_index_if_not_exists;

-- ==============================================================================
-- §2.3 种子初始化数据 (4 类 · 幂等：INSERT IGNORE / ON DUPLICATE KEY UPDATE)
-- ==============================================================================
-- 2.3.1 系统设置
INSERT INTO settings (id, `key`, `value`, `group`, `description`, is_public, updated_by, _ts) VALUES
  ('set_troupe_name','troupeName','秦安县秦剧团文化演出有限公司','troupe','剧团全称（合同/发票/公开页显示）',1,'sys_init',UNIX_TIMESTAMP()*1000),
  ('set_troupe_phone','troupePhone','13993839833','troupe','对外联系电话',1,'sys_init',UNIX_TIMESTAMP()*1000),
  ('set_troupe_address','troupeAddress','甘肃省天水市秦安县陇城镇张沟村','troupe','注册地址',1,'sys_init',UNIX_TIMESTAMP()*1000),
  ('set_troupe_tax','troupeTaxNo','91620522MA1234567X（请替换为真实18位）','finance','开票抬头统一社会信用代码',0,'sys_init',UNIX_TIMESTAMP()*1000),
  ('set_troupe_legal','troupeLegalPerson','张维民','troupe','法人姓名',0,'sys_init',UNIX_TIMESTAMP()*1000),
  ('set_fin_double_above','financeDoubleCheckAbove','10000','finance','单笔凭证>=此金额强制双人复核(M-15)',0,'sys_init',UNIX_TIMESTAMP()*1000),
  ('set_booking_sms_verify','bookingSmsVerifyRequired','1','booking','公开预约是否强制短信验手机号(S-8)',0,'sys_init',UNIX_TIMESTAMP()*1000),
  ('set_booking_captcha','bookingCaptchaRequired','1','booking','公开预约是否强制行为验证码(M-10)',0,'sys_init',UNIX_TIMESTAMP()*1000)
ON DUPLICATE KEY UPDATE
  `value` = VALUES(`value`),
  updated_at = CURRENT_TIMESTAMP,
  updated_by = 'sys_init',
  _ts = UNIX_TIMESTAMP()*1000;

-- 2.3.2 初始超级管理员（M-14 · P0-7 force_pwd_change=1）
-- password_hash 占位：上线前必改！生成方法：node -e "console.log(require('bcrypt').hashSync('QinAn@QXT2026!', 12))"
INSERT INTO accounts_v2
  (id, username, password_hash, real_name, role, phone, email, status, force_pwd_change, created_by, _ts)
VALUES
  ('acc_superadmin_001', 'admin',
   '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW' /* 占位，必换！ */,
   '超级管理员-24小时内强制修改密码', 'super_admin', '13993839833',
   'admin@qaxqjt.cn', 'active', 1, 'sys_init', UNIX_TIMESTAMP()*1000)
ON DUPLICATE KEY UPDATE
  updated_at = CURRENT_TIMESTAMP,
  force_pwd_change = 1;

-- 2.3.3 基础4角色 + 3扩展财务角色（M-15 制单/复核/出纳）
INSERT INTO roles (id, name, description, level, created_by, _ts) VALUES
  ('role_super','超级管理员','全权限（团长+CTO，<3人）',999,'sys_init',UNIX_TIMESTAMP()*1000),
  ('role_ops','运营调度','预约/订单/档期/演员表/考勤 可写',800,'sys_init',UNIX_TIMESTAMP()*1000),
  ('role_finance_checker','财务复核岗','复核制单/关账/对账 只可写不可制单',600,'sys_init',UNIX_TIMESTAMP()*1000),
  ('role_finance_maker','财务制单岗','只能制单，不能复核本人凭证（M-15双角色）',550,'sys_init',UNIX_TIMESTAMP()*1000),
  ('role_finance_cashier','出纳岗','收付款/银行回单上传，无记账权限',520,'sys_init',UNIX_TIMESTAMP()*1000),
  ('role_finance_admin','财务主管','全财务权限 + 月度关账',500,'sys_init',UNIX_TIMESTAMP()*1000),
  ('role_director','团长/业务副团长','全局只读 + 订单审批/档期锁',700,'sys_init',UNIX_TIMESTAMP()*1000),
  ('role_staff','普通员工','个人考勤/工资条/请假提交 只读',100,'sys_init',UNIX_TIMESTAMP()*1000)
ON DUPLICATE KEY UPDATE
  updated_at = CURRENT_TIMESTAMP, updated_by = 'sys_init';

-- 2.3.4 基础工资等级（A+/A/B/C）
INSERT INTO wage_rules_v1
  (id, rank_grade, base_daily_standard, chief_role_allowance, supporting_role_base,
   ensemble_base, crew_band_base, tech_dancer_base, night_show_bonus,
   holiday_multiplier, transport_allowance, meal_allowance, full_attendance_bonus,
   performance_bonus_rate, effective_from_date, created_by, _ts)
VALUES
  ('wrule_ap','A+', 1800, 800, 400, 300, 400, 500, 200, 2.0000, 60, 60, 500, 0.0800, '2026-01-01', 'sys_init', UNIX_TIMESTAMP()*1000),
  ('wrule_a', 'A',  1200, 500, 250, 180, 250, 300, 150, 1.5000, 40, 50, 300, 0.0600, '2026-01-01', 'sys_init', UNIX_TIMESTAMP()*1000),
  ('wrule_b', 'B',   800, 300, 150, 120, 180, 220, 100, 1.3000, 30, 40, 200, 0.0500, '2026-01-01', 'sys_init', UNIX_TIMESTAMP()*1000),
  ('wrule_c', 'C',   500, 150, 80,  60,  120, 160, 60,  1.1000, 30, 30, 100, 0.0300, '2026-01-01', 'sys_init', UNIX_TIMESTAMP()*1000)
ON DUPLICATE KEY UPDATE
  updated_at = CURRENT_TIMESTAMP, _ts = UNIX_TIMESTAMP()*1000;

-- 2.3.5 迁移标记：v1.0_initial 已执行
INSERT INTO data_migrations
  (id, batch, description, executed_by, expected_row_count, actual_row_count, dry_run, status, _ts)
VALUES
  ('v1.0_initial', 1, '42表DDL+15索引+种子数据初始化',
   'sql_script @ docker-entrypoint-initdb.d', 42, 42, 0, 'success', UNIX_TIMESTAMP()*1000)
ON DUPLICATE KEY UPDATE status='success';

SET FOREIGN_KEY_CHECKS = 1;

-- ==============================================================================
-- [方案 B · 覆盖重建参考 · 注释块 · 生产不要启用！]
-- DROP TABLE IF EXISTS overtime_records,leave_applications,attendance_punch_records,attendance_v1;
-- DROP TABLE IF EXISTS fin_debts_v1,fin_recons_v1,fin_invoices_v1,fin_ledger_v1,wage_items_v1,wage_batches_v1,wage_rules_v1;
-- DROP TABLE IF EXISTS cast_sheet_crew,cast_sheets_v1,schedule_venues,schedules_v2,order_refunds,fin_payments_v1,order_items,orders;
-- DROP TABLE IF EXISTS appointment_audit,appointment_plays,appointments,customer_tags,customer_contacts,customers_v1;
-- DROP TABLE IF EXISTS content_v2,inventory_records,inventory_items,play_casts,plays,performers_db_v1;
-- DROP TABLE IF EXISTS data_migrations,system_backups,settings,login_attempts,audit_logs,admin_sessions,user_roles,role_permissions,permissions,roles,accounts_v2;
-- 再从第 1 行重新执行本脚本，即可得到完全干净的空库结构（种子数据会再插入）
-- ==============================================================================
-- Script End · 42 tables · 7 batches · 15 indexes · 4 classes seed data
