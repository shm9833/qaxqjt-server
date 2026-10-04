/* tests/server-controllers.unit.spec.js — server/src/controllers 控制器单元测试
 *
 * 用法：node tests/server-controllers.unit.spec.js
 * 依赖：测试自身零依赖（Node 内置 assert/path）；全程不连数据库/网络。
 *
 * 覆盖控制器（按业务价值挑选 5 个）：
 *   auth.js          登录（锁定/限流/反枚举/签发 token 对/会话落库/cookie）、
 *                    refresh 会话白名单轮换、logout 精确删会话、扫码登录状态机防重放、me 权限聚合
 *   orders.js        金额勾稽（负数/超上限/优惠>总额/已付>应付/明细汇总/浮点舍入）、
 *                    状态机流转、删除白名单+级联、收款联动 syncOrderPayments 触发条件、客户手机号复用
 *   appointments.js  必填/套餐枚举、匿名公开预约自动转 draft 订单并回链、后台建单不转订单、
 *                    packageType 推断、状态机、converted 禁删、转单失败隔离
 *   finance.js       制单强制 draft（M-15）、1 万复核阈值、借贷至少一项、
 *                    状态机 draft→checked 单向、制单/复核同人禁令、复核角色只读补丁、
 *                    已对账禁改禁删、月度汇总分桶/分类/净利/毛利率
 *   cast-sheets.js   scheduleId 必填、crew 整体写入/替换、confirmed 自动补确认人/时间、级联删除
 * 追加覆盖（8 个）：
 *   wages.js         考勤扣罚纯函数（迟到20元/次、超30分钟扣半日、旷工1天扣两日）、工资条取价优先级
 *                    （显式 baseWage > 协议天工资×出勤 > 职级标准×出勤）、4 项细分扣款编码、
 *                    generate 无底薪批量核算（全勤奖迟到3次取消/扣罚封顶不扣成负数/跳过零出勤无协议人员）、
 *                    幂等重建（同月 draft 先删后建、confirmed/posted 拒绝重算）、批次状态机
 *   performers.js    PF 工号自动分配（含软删记录占号）、P2002 并发重试、自助入职身份证查重/退回重提、
 *                    审核通过分配工号、软删、花名册→draft 批次工资条同步（新建+增量重算+批次汇总回写）
 *   attendance.js    事假月度上限（≤2次/≤2天，特批放行）、考勤/请假审批、approvedBy 优先级（显式>登录用户>null）
 *   schedules.js     date/orderId 必填、venue 拆分/类型回填 remark、completedDate 自动置 completed、月度统计
 *   inventory.js     出入库事务联动、原子条件扣减防超发（CONFLICT）、borrow/return 借用状态联动、
 *                    数量调整必须填原因并自动登记台账、删除级联记录
 *   plays.js         title 必填、is_hot→isHot 字段映射、删除级联 playCast
 *   roles.js         角色下有账号禁删（CONFLICT）、批量赋权过滤无效 permissionId
 *   customers.js     默认类型/联系人回填、主联系人唯一互斥（显式优先否则首条兜底）、有订单/预约关联走软删、无关联硬删级联
 *
 * 桩策略：
 *   1) 进程入口先注入 process.env（test/JWT 密钥/BCRYPT_ROUNDS=8），再 require utils/prisma 拿单例；
 *   2) prisma 上被触及的模型方法全部替换为内存数组桩（db.*），where 支持等值/gte/lt/lte/contains 最小匹配；
 *   3) 外部副作用服务在「require 控制器之前」替换其 module.exports 属性（控制器顶层解构会捕获替换后的值）：
 *      services/audit-service.audit、services/order-payment-sync.syncOrderPayments；
 *   4) ctx 为轻量假 Koa ctx（state.user/request.body/query/params/ip/get/cookies.set）；
 *   5) JWT/bcrypt 走真实 utils/crypto（BCRYPT_ROUNDS=8 加速）；console.warn/error 收集并静音，结束恢复。
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/qaxqjt_unit';
process.env.JWT_ACCESS_SECRET = 'unit_test_access_secret_0123456789';
process.env.JWT_REFRESH_SECRET = 'unit_test_refresh_secret_0123456789';
process.env.BCRYPT_ROUNDS = '8';

const assert = require('assert');
const path = require('path');

const SRC = path.join(__dirname, '..', 'server', 'src');

/* ---------- 静音噪音（登录失败/联动失败路径的 warn/error），结束恢复 ---------- */
let warns = [];
let errors = [];
const origWarn = console.warn;
const origError = console.error;
console.warn = (...args) => { warns.push(args.join(' ')); };
console.error = (...args) => { errors.push(args.join(' ')); };

/* ---------- Prisma 单例 + 内存桩 ---------- */
const prisma = require(path.join(SRC, 'utils', 'prisma'));

const db = {
  loginAttempts: [],
  accounts: [],
  sessions: [],
  customers: [],
  orders: [],
  orderItems: [],
  ledgers: [],
  appointments: [],
  appointmentPlays: [],
  appointmentAudits: [],
  castSheets: [],
  castCrew: [],
  schedules: [],
  performers: [],
  wageItems: [],
  wageBatches: [],
  wageRules: [],
  attendance: [],
  leaveApplications: [],
  plays: [],
  playCasts: [],
  inventoryItems: [],
  inventoryRecords: [],
  roles: [],
  rolePermissions: [],
  permissions: [],
  userRoles: [],
  customerContacts: [],
  customerTags: []
};

function matchWhere(row, where) {
  for (const k of Object.keys(where || {})) {
    const c = where[k];
    if (c && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c)) {
      if ('not' in c) { if (row[k] === c.not) return false; continue; }
      if ('in' in c) { if (!Array.isArray(c.in) || c.in.indexOf(row[k]) < 0) return false; continue; }
      if ('gte' in c || 'lt' in c || 'lte' in c) {
        if (row[k] == null) return false;
        const num = typeof row[k] === 'number' && typeof (c.gte !== undefined ? c.gte : (c.lt !== undefined ? c.lt : c.lte)) === 'number';
        const rv = num ? row[k] : new Date(row[k]).getTime();
        if ('gte' in c && rv < (num ? c.gte : new Date(c.gte).getTime())) return false;
        if ('lt' in c && rv >= (num ? c.lt : new Date(c.lt).getTime())) return false;
        if ('lte' in c && rv > (num ? c.lte : new Date(c.lte).getTime())) return false;
        continue;
      }
      if ('contains' in c && String(row[k] == null ? '' : row[k]).indexOf(c.contains) < 0) return false;
    } else if (row[k] !== c) return false;
  }
  return true;
}
const findRow = (rows, where) => rows.find(r => matchWhere(r, where)) || null;
// findUnique 一律返回浅拷贝，模拟 Prisma「每次查询返回新对象」语义，
// 避免控制器内 `old` 引用被后续 update 的 Object.assign 污染（fromStatus 等审计字段依赖此隔离）
const findRowCopy = (rows, where) => {
  const r = findRow(rows, where);
  return r ? Object.assign({}, r) : null;
};
const delRows = (rows, where) => {
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (matchWhere(rows[i], where)) { rows.splice(i, 1); n++; }
  }
  return { count: n };
};
const p2025 = () => Object.assign(new Error('record missing'), { code: 'P2025' });
// 支持 Prisma 原子增量写法 { increment: n } / { decrement: n }（库存/批次汇总联动依赖）
const applyData = (row, data) => {
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      if ('increment' in v) { row[k] = (Number(row[k]) || 0) + Number(v.increment); continue; }
      if ('decrement' in v) { row[k] = (Number(row[k]) || 0) - Number(v.decrement); continue; }
    }
    row[k] = v;
  }
  return row;
};

prisma.loginAttempt = {
  findMany: async ({ where, take } = {}) => db.loginAttempts.filter(r => matchWhere(r, where)).slice(0, take || 20),
  create: async ({ data }) => { db.loginAttempts.push(data); return data; }
};
prisma.accountsV2 = {
  findUnique: async ({ where } = {}) => findRowCopy(db.accounts, where),
  update: async ({ where, data }) => {
    const row = findRow(db.accounts, { id: where.id });
    if (!row) throw Object.assign(new Error('record missing'), { code: 'P2025' });
    Object.assign(row, data);
    return row;
  }
};
prisma.adminSession = {
  findUnique: async ({ where } = {}) => findRow(db.sessions, where),
  create: async ({ data }) => { db.sessions.push(data); return data; },
  deleteMany: async ({ where } = {}) => delRows(db.sessions, where)
};
prisma.customersV1 = {
  findFirst: async ({ where } = {}) => findRow(db.customers, where),
  findUnique: async ({ where } = {}) => findRowCopy(db.customers, { id: where.id }),
  findMany: async ({ where } = {}) => db.customers.filter(r => matchWhere(r, where)),
  count: async ({ where } = {}) => db.customers.filter(r => matchWhere(r, where)).length,
  create: async ({ data }) => { db.customers.push(data); return data; },
  update: async ({ where, data }) => {
    const row = findRow(db.customers, { id: where.id });
    if (!row) throw p2025();
    Object.assign(row, data);
    return row;
  },
  delete: async ({ where } = {}) => {
    const row = findRow(db.customers, { id: where.id });
    if (!row) throw p2025();
    delRows(db.customers, { id: where.id });
    return row;
  }
};
prisma.order = {
  create: async ({ data }) => { db.orders.push(data); return data; },
  findUnique: async ({ where } = {}) => findRowCopy(db.orders, { id: where.id }),
  update: async ({ where, data }) => {
    const row = findRow(db.orders, { id: where.id });
    if (!row) throw Object.assign(new Error('record missing'), { code: 'P2025' });
    Object.assign(row, data);
    return row;
  },
  delete: async ({ where } = {}) => {
    const row = findRow(db.orders, { id: where.id });
    delRows(db.orders, { id: where.id });
    return row;
  },
  findMany: async ({ where } = {}) => db.orders.filter(r => matchWhere(r, where)),
  count: async ({ where } = {}) => db.orders.filter(r => matchWhere(r, where)).length
};
prisma.orderItem = {
  createMany: async ({ data }) => { db.orderItems.push(...data); return { count: data.length }; },
  deleteMany: async ({ where } = {}) => delRows(db.orderItems, where)
};
prisma.orderRefund = { deleteMany: async () => ({ count: 0 }) };
prisma.finPaymentV1 = { deleteMany: async () => ({ count: 0 }) };
prisma.finLedgerV1 = {
  create: async ({ data }) => { db.ledgers.push(data); return data; },
  findUnique: async ({ where } = {}) => findRowCopy(db.ledgers, { id: where.id }),
  update: async ({ where, data }) => {
    const row = findRow(db.ledgers, { id: where.id });
    if (!row) throw Object.assign(new Error('record missing'), { code: 'P2025' });
    Object.assign(row, data);
    return row;
  },
  delete: async ({ where } = {}) => {
    const row = findRow(db.ledgers, { id: where.id });
    delRows(db.ledgers, { id: where.id });
    return row;
  },
  findMany: async ({ where } = {}) => db.ledgers.filter(r => matchWhere(r, where))
};
prisma.appointment = {
  create: async ({ data }) => { db.appointments.push(data); return data; },
  count: async ({ where } = {}) => db.appointments.filter(r => matchWhere(r, where)).length,
  findUnique: async ({ where } = {}) => findRowCopy(db.appointments, { id: where.id }),
  update: async ({ where, data }) => {
    const row = findRow(db.appointments, { id: where.id });
    if (!row) throw Object.assign(new Error('record missing'), { code: 'P2025' });
    Object.assign(row, data);
    return row;
  },
  delete: async ({ where } = {}) => {
    const row = findRow(db.appointments, { id: where.id });
    delRows(db.appointments, { id: where.id });
    return row;
  }
};
prisma.appointmentPlay = {
  createMany: async ({ data }) => { db.appointmentPlays.push(...data); return { count: data.length }; },
  deleteMany: async ({ where } = {}) => delRows(db.appointmentPlays, where)
};
prisma.appointmentAudit = {
  create: async ({ data }) => { db.appointmentAudits.push(data); return data; },
  deleteMany: async ({ where } = {}) => delRows(db.appointmentAudits, where)
};
prisma.castSheetsV1 = {
  create: async ({ data }) => { db.castSheets.push(data); return data; },
  findUnique: async ({ where } = {}) => {
    const row = findRow(db.castSheets, { id: where.id });
    if (!row) return null;
    const crew = db.castCrew.filter(c => c.castSheetId === row.id).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    return Object.assign({}, row, { crew });
  },
  update: async ({ where, data }) => {
    const row = findRow(db.castSheets, { id: where.id });
    if (!row) throw Object.assign(new Error('record missing'), { code: 'P2025' });
    Object.assign(row, data);
    return row;
  },
  delete: async ({ where } = {}) => {
    const row = findRow(db.castSheets, { id: where.id });
    delRows(db.castSheets, { id: where.id });
    return row;
  }
};
prisma.castSheetCrew = {
  createMany: async ({ data }) => { db.castCrew.push(...data); return { count: data.length }; },
  deleteMany: async ({ where } = {}) => delRows(db.castCrew, where)
};
prisma.auditLog = { create: async ({ data }) => data };
prisma.scheduleV2 = {
  create: async ({ data }) => { db.schedules.push(data); return data; },
  findUnique: async ({ where } = {}) => findRowCopy(db.schedules, { id: where.id }),
  update: async ({ where, data }) => {
    const row = findRow(db.schedules, { id: where.id });
    if (!row) throw p2025();
    Object.assign(row, data);
    return row;
  },
  delete: async ({ where } = {}) => {
    const row = findRow(db.schedules, { id: where.id });
    if (!row) throw p2025();
    delRows(db.schedules, { id: where.id });
    return row;
  },
  deleteMany: async ({ where } = {}) => delRows(db.schedules, where),
  findMany: async ({ where } = {}) => db.schedules.filter(r => matchWhere(r, where)),
  count: async ({ where } = {}) => db.schedules.filter(r => matchWhere(r, where)).length
};
prisma.performersDbV1 = {
  create: async ({ data }) => { db.performers.push(data); return data; },
  findUnique: async ({ where } = {}) => findRowCopy(db.performers, { id: where.id }),
  findFirst: async ({ where } = {}) => findRow(db.performers, where),
  findMany: async ({ where } = {}) => db.performers.filter(r => matchWhere(r, where)),
  count: async ({ where } = {}) => db.performers.filter(r => matchWhere(r, where)).length,
  update: async ({ where, data }) => {
    const row = findRow(db.performers, { id: where.id });
    if (!row) throw p2025();
    Object.assign(row, data);
    return row;
  },
  updateMany: async ({ where, data }) => {
    // count 必须在修改前计算：Prisma 返回的是"命中行数"，而非修改后仍满足 where 的行数
    const matched = db.performers.filter(r => matchWhere(r, where));
    matched.forEach(r => Object.assign(r, data));
    return { count: matched.length };
  }
};
prisma.wageItemsV1 = {
  create: async ({ data }) => { db.wageItems.push(data); return data; },
  findUnique: async ({ where, include } = {}) => {
    const row = findRowCopy(db.wageItems, { id: where.id });
    if (row && include && include.batch) row.batch = findRowCopy(db.wageBatches, { id: row.batchId }) || null;
    return row;
  },
  findFirst: async ({ where } = {}) => findRow(db.wageItems, where),
  findMany: async ({ where } = {}) => db.wageItems.filter(r => matchWhere(r, where)),
  deleteMany: async ({ where } = {}) => delRows(db.wageItems, where),
  delete: async ({ where } = {}) => {
    const row = findRow(db.wageItems, { id: where.id });
    if (!row) throw p2025();
    delRows(db.wageItems, { id: where.id });
    return row;
  },
  update: async ({ where, data }) => {
    const row = findRow(db.wageItems, { id: where.id });
    if (!row) throw p2025();
    Object.assign(row, data);
    return row;
  },
  count: async ({ where } = {}) => db.wageItems.filter(r => matchWhere(r, where)).length
};
prisma.wageBatchesV1 = {
  create: async ({ data }) => { db.wageBatches.push(data); return data; },
  findUnique: async ({ where } = {}) => findRowCopy(db.wageBatches, { id: where.id }),
  findMany: async ({ where } = {}) => db.wageBatches.filter(r => matchWhere(r, where)),
  deleteMany: async ({ where } = {}) => delRows(db.wageBatches, where),
  update: async ({ where, data }) => {
    const row = findRow(db.wageBatches, { id: where.id });
    if (!row) throw p2025();
    applyData(row, data);
    return row;
  },
  updateMany: async ({ where, data }) => {
    const matched = db.wageBatches.filter(r => matchWhere(r, where));
    matched.forEach(r => applyData(r, data));
    return { count: matched.length };
  },
  count: async ({ where } = {}) => db.wageBatches.filter(r => matchWhere(r, where)).length
};
prisma.wageRulesV1 = {
  findUnique: async ({ where } = {}) => findRowCopy(db.wageRules, { rankGrade: where.rankGrade }),
  findFirst: async ({ where } = {}) => findRow(db.wageRules, where),
  findMany: async ({ where } = {}) => db.wageRules.filter(r => matchWhere(r, where)),
  count: async ({ where } = {}) => db.wageRules.filter(r => matchWhere(r, where)).length,
  create: async ({ data }) => { db.wageRules.push(data); return data; }
};
prisma.attendanceV1 = {
  create: async ({ data }) => { db.attendance.push(data); return data; },
  findUnique: async ({ where } = {}) => findRowCopy(db.attendance, { id: where.id }),
  findMany: async ({ where } = {}) => db.attendance.filter(r => matchWhere(r, where)),
  update: async ({ where, data }) => {
    const row = findRow(db.attendance, { id: where.id });
    if (!row) throw p2025();
    Object.assign(row, data);
    return row;
  },
  delete: async ({ where } = {}) => {
    const row = findRow(db.attendance, { id: where.id });
    if (!row) throw p2025();
    delRows(db.attendance, { id: where.id });
    return row;
  },
  count: async ({ where } = {}) => db.attendance.filter(r => matchWhere(r, where)).length,
  groupBy: async ({ by, where, _count } = {}) => {
    const groups = {};
    db.attendance.filter(r => matchWhere(r, where)).forEach(r => {
      const key = by.map(b => r[b]).join('|');
      if (!groups[key]) groups[key] = { ...by.reduce((o, b) => { o[b] = r[b]; return o; }, {}), _count: 0 };
      groups[key]._count++;
    });
    return Object.values(groups);
  }
};
prisma.leaveApplication = {
  create: async ({ data }) => { db.leaveApplications.push(data); return data; },
  findUnique: async ({ where } = {}) => findRowCopy(db.leaveApplications, { id: where.id }),
  findMany: async ({ where } = {}) => db.leaveApplications.filter(r => matchWhere(r, where)),
  update: async ({ where, data }) => {
    const row = findRow(db.leaveApplications, { id: where.id });
    if (!row) throw p2025();
    Object.assign(row, data);
    return row;
  },
  count: async ({ where } = {}) => db.leaveApplications.filter(r => matchWhere(r, where)).length
};
prisma.play = {
  create: async ({ data }) => { db.plays.push(data); return data; },
  findUnique: async ({ where } = {}) => findRowCopy(db.plays, { id: where.id }),
  findMany: async ({ where } = {}) => db.plays.filter(r => matchWhere(r, where)),
  count: async ({ where } = {}) => db.plays.filter(r => matchWhere(r, where)).length,
  update: async ({ where, data }) => {
    const row = findRow(db.plays, { id: where.id });
    if (!row) throw p2025();
    Object.assign(row, data);
    return row;
  },
  delete: async ({ where } = {}) => {
    const row = findRow(db.plays, { id: where.id });
    if (!row) throw p2025();
    delRows(db.plays, { id: where.id });
    return row;
  }
};
prisma.playCast = {
  deleteMany: async ({ where } = {}) => delRows(db.playCasts, where)
};
prisma.inventoryItem = {
  create: async ({ data }) => { db.inventoryItems.push(data); return data; },
  findUnique: async ({ where } = {}) => findRowCopy(db.inventoryItems, { id: where.id }),
  update: async ({ where, data }) => {
    const row = findRow(db.inventoryItems, { id: where.id });
    if (!row) throw p2025();
    Object.assign(row, data);
    return row;
  },
  updateMany: async ({ where, data }) => {
    // count 必须在 decrement/increment 前计算，否则修改后 quantity 不再满足 gte 条件会误判为 0（库存防超发依赖此值）
    const matched = db.inventoryItems.filter(r => matchWhere(r, where));
    matched.forEach(r => applyData(r, data));
    return { count: matched.length };
  },
  delete: async ({ where } = {}) => {
    const row = findRow(db.inventoryItems, { id: where.id });
    if (!row) throw p2025();
    delRows(db.inventoryItems, { id: where.id });
    return row;
  },
  count: async ({ where } = {}) => db.inventoryItems.filter(r => matchWhere(r, where)).length
};
prisma.inventoryRecord = {
  create: async ({ data }) => { db.inventoryRecords.push(data); return data; },
  findMany: async ({ where } = {}) => db.inventoryRecords.filter(r => matchWhere(r, where)),
  deleteMany: async ({ where } = {}) => delRows(db.inventoryRecords, where),
  count: async ({ where } = {}) => db.inventoryRecords.filter(r => matchWhere(r, where)).length
};
prisma.role = {
  create: async ({ data }) => { db.roles.push(data); return data; },
  findMany: async ({ where } = {}) => db.roles.filter(r => matchWhere(r, where)),
  count: async ({ where } = {}) => db.roles.filter(r => matchWhere(r, where)).length,
  findUnique: async ({ where } = {}) => findRowCopy(db.roles, { id: where.id }),
  update: async ({ where, data }) => {
    const row = findRow(db.roles, { id: where.id });
    if (!row) throw p2025();
    Object.assign(row, data);
    return row;
  },
  delete: async ({ where } = {}) => {
    const row = findRow(db.roles, { id: where.id });
    if (!row) throw p2025();
    delRows(db.roles, { id: where.id });
    return row;
  }
};
prisma.rolePermission = {
  createMany: async ({ data }) => { db.rolePermissions.push(...data); return { count: data.length }; },
  deleteMany: async ({ where } = {}) => delRows(db.rolePermissions, where)
};
prisma.permission = {
  findMany: async ({ where } = {}) => db.permissions.filter(r => matchWhere(r, where)),
  count: async ({ where } = {}) => db.permissions.filter(r => matchWhere(r, where)).length
};
prisma.userRole = {
  count: async ({ where } = {}) => db.userRoles.filter(r => matchWhere(r, where)).length
};
prisma.customerContact = {
  createMany: async ({ data }) => { db.customerContacts.push(...data); return { count: data.length }; },
  deleteMany: async ({ where } = {}) => delRows(db.customerContacts, where)
};
prisma.customerTag = {
  createMany: async ({ data }) => { db.customerTags.push(...data); return { count: data.length }; },
  deleteMany: async ({ where } = {}) => delRows(db.customerTags, where)
};
prisma.$transaction = async fn => fn(prisma);

/* ---------- 外部副作用服务桩（必须先于控制器 require，顶层解构捕获替换值） ---------- */
let auditCalls = [];
const auditSvc = require(path.join(SRC, 'services', 'audit-service'));
auditSvc.audit = async rec => { auditCalls.push(rec); return { ok: true }; };

let syncCalls = [];
let syncImpl = async () => ({ synced: 0, target: 0, net: 0, diff: 0 });
const orderPaySync = require(path.join(SRC, 'services', 'order-payment-sync'));
orderPaySync.syncOrderPayments = (order, opts) => {
  syncCalls.push({ order, opts });
  return syncImpl(order, opts);
};

/* ---------- 真实工具 + 被测控制器 ---------- */
const cryptoUtil = require(path.join(SRC, 'utils', 'crypto'));
const { BusinessError } = require(path.join(SRC, 'middleware', 'error-handler'));

const authCtl = require(path.join(SRC, 'controllers', 'auth'));
const ordersCtl = require(path.join(SRC, 'controllers', 'orders'));
const apptCtl = require(path.join(SRC, 'controllers', 'appointments'));
const finCtl = require(path.join(SRC, 'controllers', 'finance'));
const castCtl = require(path.join(SRC, 'controllers', 'cast-sheets'));
const wagesCtl = require(path.join(SRC, 'controllers', 'wages'));
const performersCtl = require(path.join(SRC, 'controllers', 'performers'));
const attCtl = require(path.join(SRC, 'controllers', 'attendance'));
const schedCtl = require(path.join(SRC, 'controllers', 'schedules'));
const invCtl = require(path.join(SRC, 'controllers', 'inventory'));
const playsCtl = require(path.join(SRC, 'controllers', 'plays'));
const rolesCtl = require(path.join(SRC, 'controllers', 'roles'));
const customersCtl = require(path.join(SRC, 'controllers', 'customers'));

/* ---------- 测试基建 ---------- */
const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓ ' + name); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}

const ADMIN = { sub: 'acc_1', username: 'admin', role: 'super_admin', realName: '管理员' };
const makeCtx = (over = {}) => {
  const ctx = {
    status: 200,
    body: undefined,
    state: { user: ADMIN },
    request: { body: {}, query: {}, headers: {}, hostname: 'localhost' },
    query: {},
    params: {},
    ip: '10.0.0.1',
    protocol: 'http',
    get: h => (String(h).toLowerCase() === 'user-agent' ? 'unit-test-agent' : ''),
    _cookies: []
  };
  ctx.cookies = { set: (...a) => ctx._cookies.push(a) };
  if (over.state !== undefined) ctx.state = over.state;
  if (over.body !== undefined) ctx.request.body = over.body;
  if (over.query !== undefined) { ctx.query = over.query; ctx.request.query = over.query; }
  if (over.params !== undefined) ctx.params = over.params;
  if (over.ip !== undefined) ctx.ip = over.ip;
  if (over.hostname !== undefined) ctx.request.hostname = over.hostname;
  if (over.protocol !== undefined) ctx.protocol = over.protocol;
  return ctx;
};

const resetState = () => {
  Object.keys(db).forEach(k => { db[k].length = 0; });
  auditCalls = [];
  syncCalls = [];
  syncImpl = async () => ({ synced: 0, target: 0, net: 0, diff: 0 });
  warns = [];
  errors = [];
};
const mkRule = (over = {}) => Object.assign({
  rankGrade: '一级演员', baseDailyStandard: 200, nightShowBonus: 50,
  transportAllowance: 15, mealAllowance: 10, fullAttendanceBonus: 300,
  holidayMultiplier: 1, chiefRoleAllowance: 0, supportingRoleBase: 0,
  ensembleBase: 0, crewBandBase: 0, techDancerBase: 0, performanceBonusRate: 0,
  status: 'active', effectiveFromDate: new Date('2020-01-01'), effectiveToDate: null
}, over);

const mkAccount = (over = {}) => Object.assign({
  id: 'acc_1',
  username: 'admin',
  status: 'active',
  passwordHash: '',
  role: 'super_admin',
  realName: '管理员',
  failedLoginCount: 0,
  lockedUntil: null,
  forcePwdChange: false,
  avatarUrl: null,
  phone: null,
  email: null,
  userRoles: [{ role: { name: 'super_admin' } }]
}, over);

(async () => {
  console.log('server-controllers.unit.spec — 13 个控制器（auth/orders/appointments/finance/cast-sheets + wages/performers/attendance/schedules/inventory/plays/roles/customers）\n');

  const PW = 'QinOpera@Unit1';
  const PW_HASH = await cryptoUtil.hashPassword(PW);

  /* ==================== auth.login ==================== */
  await t('auth.login 成功：签发 access+refresh 对、会话落库（tokenHash=后16位）、失败计数清零、审计与 cookie', async () => {
    resetState();
    db.accounts.push(mkAccount({ passwordHash: PW_HASH, failedLoginCount: 2 }));
    const ctx = makeCtx({ body: { username: 'admin', password: PW }, hostname: 'admin.qaxqjt.local' });
    await authCtl.login(ctx);
    assert.strictEqual(ctx.status, 200);
    assert.strictEqual(ctx.body.ok, true);
    const d = ctx.body.data;
    assert.strictEqual(d.tokenType, 'Bearer');
    assert.strictEqual(d.expiresInMin, 30);
    assert.strictEqual(cryptoUtil.verifyAccess(d.accessToken).sub, 'acc_1');
    assert.strictEqual(cryptoUtil.verifyRefresh(d.refreshToken).sub, 'acc_1');
    assert.deepStrictEqual(d.user.roles, ['super_admin']);
    assert.strictEqual(d.user.forcePwdChange, false);
    // 会话白名单落库
    assert.strictEqual(db.sessions.length, 1);
    assert.strictEqual(db.sessions[0].tokenHash, d.refreshToken.slice(-16));
    assert.strictEqual(db.sessions[0].accountId, 'acc_1');
    assert.strictEqual(db.sessions[0].userAgent, 'unit-test-agent');
    assert.ok(db.sessions[0].expiresAt > new Date());
    // 失败计数/锁定清零
    assert.strictEqual(db.accounts[0].failedLoginCount, 0);
    assert.strictEqual(db.accounts[0].lockedUntil, null);
    assert.ok(db.accounts[0].lastLoginAt instanceof Date);
    // 成功尝试记录 + 审计
    assert.ok(db.loginAttempts.some(a => a.successFlag === true));
    assert.ok(auditCalls.some(a => a.module === 'auth' && a.action === 'LOGIN_SUCCESS' && a.targetId === 'acc_1'));
    // 非 localhost 下同源 cookie 下发
    assert.strictEqual(ctx._cookies.length, 1);
    assert.strictEqual(ctx._cookies[0][0], 'x_a_t');
    assert.strictEqual(ctx._cookies[0][1], d.accessToken);
    assert.strictEqual(ctx._cookies[0][2].httpOnly, true);
    assert.strictEqual(ctx._cookies[0][2].secure, false); // http 协议
  });

  await t('auth.login 反枚举：用户不存在与密码错误同为 UNAUTHORIZED +「用户名或密码错误」前缀', async () => {
    resetState();
    db.accounts.push(mkAccount({ passwordHash: PW_HASH }));
    const c1 = makeCtx({ body: { username: 'ghost', password: PW } });
    await assert.rejects(() => authCtl.login(c1), e => e instanceof BusinessError && e.key === 'UNAUTHORIZED' && e.message.indexOf('用户名或密码错误') === 0);
    const c2 = makeCtx({ body: { username: 'admin', password: 'wrong' } });
    await assert.rejects(() => authCtl.login(c2), e => e.key === 'UNAUTHORIZED' && e.message.indexOf('用户名或密码错误') === 0);
    assert.ok(db.loginAttempts.some(a => a.failReason === 'USER_NOT_FOUND'));
    assert.ok(db.loginAttempts.some(a => a.failReason === 'BAD_PASSWORD'));
    assert.ok(auditCalls.some(a => a.action === 'LOGIN_FAIL_USER'));
    assert.ok(auditCalls.some(a => a.action === 'LOGIN_FAIL_PASSWORD'));
  });

  await t('auth.login 失败计数：第 1 次提示剩余 4 次；第 5 次锁定 30 分钟', async () => {
    resetState();
    db.accounts.push(mkAccount({ passwordHash: PW_HASH }));
    const c1 = makeCtx({ body: { username: 'admin', password: 'bad' } });
    await assert.rejects(() => authCtl.login(c1), e => e.key === 'UNAUTHORIZED' && e.message.indexOf('剩余 4 次') >= 0);
    assert.strictEqual(db.accounts[0].failedLoginCount, 1);
    assert.strictEqual(db.accounts[0].lockedUntil, null);
    db.accounts[0].failedLoginCount = 4;
    const c2 = makeCtx({ body: { username: 'admin', password: 'bad' } });
    await assert.rejects(() => authCtl.login(c2), e => e.key === 'UNAUTHORIZED' && e.message.indexOf('剩余 0 次') >= 0);
    assert.strictEqual(db.accounts[0].failedLoginCount, 5);
    assert.ok(db.accounts[0].lockedUntil instanceof Date);
    assert.ok(db.accounts[0].lockedUntil.getTime() > Date.now() + 29 * 60 * 1000);
  });

  await t('auth.login 锁定账号：密码正确也 FORBIDDEN（锁定判断先于密码校验）', async () => {
    resetState();
    db.accounts.push(mkAccount({ passwordHash: PW_HASH, lockedUntil: new Date(Date.now() + 600000) }));
    const ctx = makeCtx({ body: { username: 'admin', password: PW } });
    await assert.rejects(() => authCtl.login(ctx), e => e.key === 'FORBIDDEN' && e.message.indexOf('账号已锁定') >= 0);
    assert.strictEqual(db.sessions.length, 0);
  });

  await t('auth.login 停用账号：按用户不存在同一文案拒绝，不泄露账号状态', async () => {
    resetState();
    db.accounts.push(mkAccount({ passwordHash: PW_HASH, status: 'disabled' }));
    const ctx = makeCtx({ body: { username: 'admin', password: PW } });
    await assert.rejects(() => authCtl.login(ctx), e => e.key === 'UNAUTHORIZED' && e.message === '用户名或密码错误');
  });

  await t('auth.login IP 限流：5 分钟内同 IP 失败≥10 次 → RATE_LIMITED，且不查账号', async () => {
    resetState();
    for (let i = 0; i < 10; i++) {
      db.loginAttempts.push({ ipAddress: '9.9.9.9', successFlag: false, attemptedAt: new Date() });
    }
    db.accounts.push(mkAccount({ passwordHash: PW_HASH }));
    const ctx = makeCtx({ body: { username: 'admin', password: PW }, ip: '9.9.9.9' });
    await assert.rejects(() => authCtl.login(ctx), e => e.key === 'RATE_LIMITED');
    assert.strictEqual(db.sessions.length, 0);
    // 换 IP 不受限
    const ctx2 = makeCtx({ body: { username: 'admin', password: PW }, ip: '8.8.8.8' });
    await authCtl.login(ctx2);
    assert.strictEqual(ctx2.body.ok, true);
  });

  /* ==================== auth.refresh / logout ==================== */
  await t('auth.refresh：缺 refreshToken → VALIDATION_ERROR；垃圾 token → UNAUTHORIZED', async () => {
    resetState();
    await assert.rejects(() => authCtl.refresh(makeCtx({ body: {} })), e => e.key === 'VALIDATION_ERROR');
    await assert.rejects(() => authCtl.refresh(makeCtx({ body: { refreshToken: 'garbage.token.x' } })),
      e => e.key === 'UNAUTHORIZED' && e.message.indexOf('refresh_token 已失效') >= 0);
  });

  await t('auth.refresh 会话白名单：无会话/会话过期/会话属他人 → 一律 UNAUTHORIZED（登出后旧 refresh 立即失效）', async () => {
    resetState();
    db.accounts.push(mkAccount({ passwordHash: PW_HASH }));
    const rt = cryptoUtil.signRefresh({ sub: 'acc_1' });
    // 无会话
    await assert.rejects(() => authCtl.refresh(makeCtx({ body: { refreshToken: rt } })),
      e => e.key === 'UNAUTHORIZED' && e.message.indexOf('登录会话已失效') >= 0);
    // 会话过期
    db.sessions.push({ tokenHash: rt.slice(-16), accountId: 'acc_1', expiresAt: new Date(Date.now() - 1000) });
    await assert.rejects(() => authCtl.refresh(makeCtx({ body: { refreshToken: rt } })), e => e.key === 'UNAUTHORIZED');
    // 会话属他人
    db.sessions[0].expiresAt = new Date(Date.now() + 86400000);
    db.sessions[0].accountId = 'acc_other';
    await assert.rejects(() => authCtl.refresh(makeCtx({ body: { refreshToken: rt } })), e => e.key === 'UNAUTHORIZED');
  });

  await t('auth.refresh 成功：签发新 accessToken，claims 以库内账号为准（角色变更即时生效）', async () => {
    resetState();
    db.accounts.push(mkAccount({ passwordHash: PW_HASH, role: 'finance_maker' }));
    const rt = cryptoUtil.signRefresh({ sub: 'acc_1' });
    db.sessions.push({ tokenHash: rt.slice(-16), accountId: 'acc_1', expiresAt: new Date(Date.now() + 86400000) });
    const ctx = makeCtx({ body: { refreshToken: rt } });
    await authCtl.refresh(ctx);
    assert.strictEqual(ctx.body.ok, true);
    const p = cryptoUtil.verifyAccess(ctx.body.data.accessToken);
    assert.strictEqual(p.sub, 'acc_1');
    assert.strictEqual(p.role, 'finance_maker');
    assert.strictEqual(ctx.body.data.expiresInMin, 30);
  });

  await t('auth.logout：带 refreshToken 精确删本人会话 + 审计 + 清 cookie；不带也成功（本地丢弃）', async () => {
    resetState();
    const rt = cryptoUtil.signRefresh({ sub: 'acc_1' });
    db.sessions.push({ tokenHash: rt.slice(-16), accountId: 'acc_1', expiresAt: new Date(Date.now() + 86400000) });
    db.sessions.push({ tokenHash: 'other_token_hash', accountId: 'acc_2', expiresAt: new Date(Date.now() + 86400000) });
    const ctx = makeCtx({ body: { refreshToken: rt } });
    await authCtl.logout(ctx);
    assert.strictEqual(ctx.body.ok, true);
    assert.strictEqual(db.sessions.length, 1); // 仅删本人该条
    assert.strictEqual(db.sessions[0].accountId, 'acc_2');
    assert.ok(auditCalls.some(a => a.action === 'LOGOUT' && a.targetId === 'acc_1'));
    assert.deepStrictEqual(ctx._cookies[0], ['x_a_t', null]);
    // 不带 refreshToken：不删会话仍成功
    resetState();
    db.sessions.push({ tokenHash: 'x'.repeat(16), accountId: 'acc_1', expiresAt: new Date(Date.now() + 86400000) });
    const ctx2 = makeCtx({ body: {} });
    await authCtl.logout(ctx2);
    assert.strictEqual(ctx2.body.ok, true);
    assert.strictEqual(db.sessions.length, 1);
  });

  /* ==================== auth.qrcode ==================== */
  await t('auth.qrcode：create→pending→confirm→confirmed 发 token；status 取走即删防重放；重复 confirm → FORBIDDEN', async () => {
    resetState();
    db.accounts.push(mkAccount({ passwordHash: PW_HASH }));
    const c1 = makeCtx();
    await authCtl.qrcodeCreate(c1);
    const token = c1.body.data.token;
    assert.ok(typeof token === 'string' && token.length > 10);
    const s1 = makeCtx({ params: { token } });
    await authCtl.qrcodeStatus(s1);
    assert.strictEqual(s1.body.data.status, 'pending');
    // 错误密码：UNAUTHORIZED 且状态仍 pending
    await assert.rejects(
      () => authCtl.qrcodeConfirm(makeCtx({ body: { token, username: 'admin', password: 'bad' } })),
      e => e.key === 'UNAUTHORIZED'
    );
    const s2 = makeCtx({ params: { token } });
    await authCtl.qrcodeStatus(s2);
    assert.strictEqual(s2.body.data.status, 'pending');
    // 正确密码：确认成功
    const c2 = makeCtx({ body: { token, username: 'admin', password: PW } });
    await authCtl.qrcodeConfirm(c2);
    assert.strictEqual(c2.body.ok, true);
    assert.ok(auditCalls.some(a => a.action === 'LOGIN_QRCODE'));
    // 已确认未取走：再次 confirm 拒绝
    await assert.rejects(
      () => authCtl.qrcodeConfirm(makeCtx({ body: { token, username: 'admin', password: PW } })),
      e => e.key === 'FORBIDDEN' && e.message.indexOf('已被使用') >= 0
    );
    // status 取走凭证
    const s3 = makeCtx({ params: { token } });
    await authCtl.qrcodeStatus(s3);
    assert.strictEqual(s3.body.data.status, 'confirmed');
    assert.ok(s3.body.data.accessToken && s3.body.data.refreshToken);
    assert.strictEqual(s3.body.data.user.username, 'admin');
    // 取走后立即清理：再查 = expired，再 confirm = NOT_FOUND
    const s4 = makeCtx({ params: { token } });
    await authCtl.qrcodeStatus(s4);
    assert.strictEqual(s4.body.data.status, 'expired');
    await assert.rejects(
      () => authCtl.qrcodeConfirm(makeCtx({ body: { token, username: 'admin', password: PW } })),
      e => e.key === 'NOT_FOUND'
    );
    // 未知 token
    const s5 = makeCtx({ params: { token: 'no_such_token' } });
    await authCtl.qrcodeStatus(s5);
    assert.strictEqual(s5.body.data.status, 'expired');
    // 缺字段
    await assert.rejects(() => authCtl.qrcodeConfirm(makeCtx({ body: { token: 'x' } })), e => e.key === 'VALIDATION_ERROR');
  });

  await t('auth.me：角色/权限树聚合去重；未登录 → UNAUTHORIZED；账号不存在 → NOT_FOUND', async () => {
    resetState();
    db.accounts.push(mkAccount({
      userRoles: [
        { role: { id: 'r1', name: '财务', level: 10, rolePermissions: [{ permission: { code: 'fin:view' } }, { permission: { code: 'fin:edit' } }] } },
        { role: { id: 'r2', name: '出纳', level: 5, rolePermissions: [{ permission: { code: 'fin:view' } }] } }
      ]
    }));
    const ctx = makeCtx();
    await authCtl.me(ctx);
    assert.strictEqual(ctx.body.ok, true);
    assert.strictEqual(ctx.body.data.username, 'admin');
    assert.strictEqual(ctx.body.data.roles.length, 2);
    assert.deepStrictEqual(ctx.body.data.permissions.sort(), ['fin:edit', 'fin:view']);
    await assert.rejects(() => authCtl.me(makeCtx({ state: {} })), e => e.key === 'UNAUTHORIZED');
    await assert.rejects(() => authCtl.me(makeCtx({ state: { user: { sub: 'ghost' } } })), e => e.key === 'NOT_FOUND');
  });

  /* ==================== orders：金额勾稽 ==================== */
  await t('orders.create 必填：缺 customerName/phone → VALIDATION_ERROR', async () => {
    resetState();
    await assert.rejects(() => ordersCtl.create(makeCtx({ body: { customerName: '张三' } })), e => e.key === 'VALIDATION_ERROR');
    await assert.rejects(() => ordersCtl.create(makeCtx({ body: { phone: '138' } })), e => e.key === 'VALIDATION_ERROR');
  });

  await t('orders.create 金额防线：负数 / 非数字 / 超 1 亿上限 → VALIDATION_ERROR', async () => {
    resetState();
    const base = { customerName: '张三', phone: '13800000000' };
    await assert.rejects(() => ordersCtl.create(makeCtx({ body: { ...base, totalAmount: -1 } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('不能为负数') >= 0);
    await assert.rejects(() => ordersCtl.create(makeCtx({ body: { ...base, totalAmount: 'abc' } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('必须是数字') >= 0);
    await assert.rejects(() => ordersCtl.create(makeCtx({ body: { ...base, totalAmount: 100000001 } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('超出允许上限') >= 0);
    assert.strictEqual(db.orders.length, 0); // 全部在写库前拦截
  });

  await t('orders.create 勾稽：优惠>总额、应付>总额、已付>应付、定金>应付 → 逐一拒绝', async () => {
    resetState();
    const base = { customerName: '张三', phone: '13800000000', totalAmount: 1000 };
    await assert.rejects(() => ordersCtl.create(makeCtx({ body: { ...base, discountAmount: 1000.01 } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('优惠金额') >= 0);
    await assert.rejects(() => ordersCtl.create(makeCtx({ body: { ...base, finalAmount: 1001 } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('应付金额') >= 0);
    await assert.rejects(() => ordersCtl.create(makeCtx({ body: { ...base, paidAmount: 1000.01 } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('已付金额') >= 0);
    await assert.rejects(() => ordersCtl.create(makeCtx({ body: { ...base, depositAmount: 1001 } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('定金') >= 0);
    // 边界：discount == total 允许，应付自动归 0
    const ctx = makeCtx({ body: { ...base, discountAmount: 1000 } });
    await ordersCtl.create(ctx);
    assert.strictEqual(ctx.status, 201);
    assert.strictEqual(db.orders[0].finalAmount, 0);
  });

  await t('orders.create 明细汇总：无 totalAmount 时以明细小计合计为总额；小计缺省=数量×单价；负数小计拒绝', async () => {
    resetState();
    const ctx = makeCtx({
      body: {
        customerName: '李四', phone: '139',
        items: [{ quantity: 2, unitPrice: 150 }, { quantity: 1, unitPrice: 50, subtotal: 60 }]
      }
    });
    await ordersCtl.create(ctx);
    assert.strictEqual(ctx.status, 201);
    assert.strictEqual(db.orders[0].totalAmount, 360);
    assert.strictEqual(db.orders[0].finalAmount, 360);
    assert.strictEqual(db.orderItems.length, 2);
    assert.strictEqual(db.orderItems[0].subtotal, 300);
    assert.strictEqual(db.orderItems[1].subtotal, 60);
    assert.ok(/^ord_/.test(db.orders[0].id));
    await assert.rejects(
      () => ordersCtl.create(makeCtx({ body: { customerName: 'x', phone: '1', items: [{ quantity: 1, unitPrice: -5 }] } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('明细单价不能为负数') >= 0
    );
  });

  await t('orders.create 浮点：0.1+0.2 经 round2=0.3 落库', async () => {
    resetState();
    const ctx = makeCtx({ body: { customerName: '王五', phone: '137', totalAmount: 0.1 + 0.2 } });
    await ordersCtl.create(ctx);
    assert.strictEqual(db.orders[0].totalAmount, 0.3);
    assert.strictEqual(db.orders[0].finalAmount, 0.3);
  });

  await t('orders.create 收款联动：paidAmount>0 触发 syncOrderPayments（actor=当前账号），成功联动落 AUTO_LEDGER 审计', async () => {
    resetState();
    syncImpl = async (order, opts) => ({
      synced: 1, target: order.paidAmount, net: 0, diff: order.paidAmount,
      payment: { payNo: 'PAY_X' }, ledger: { id: 'led_x', voucherNo: 'LSR_X' }
    });
    const ctx = makeCtx({ body: { customerName: '赵六', phone: '136', totalAmount: 800, paidAmount: 500 } });
    await ordersCtl.create(ctx);
    assert.strictEqual(ctx.status, 201);
    assert.strictEqual(syncCalls.length, 1);
    assert.strictEqual(syncCalls[0].order.id, db.orders[0].id);
    assert.strictEqual(syncCalls[0].order.paidAmount, 500);
    assert.strictEqual(syncCalls[0].opts.actor, 'acc_1');
    assert.ok(auditCalls.some(a => a.module === 'finance' && a.action === 'AUTO_LEDGER_FROM_ORDER' && a.targetId === 'led_x'));
    assert.ok(auditCalls.some(a => a.module === 'order' && a.action === 'ORDER_CREATE'));
  });

  await t('orders.create 客户复用：同 phone 命中老客户不新建；未命中自动建档', async () => {
    resetState();
    db.customers.push({ id: 'cus_1', customerName: '老客户', phone: '135', status: 'active' });
    const ctx = makeCtx({ body: { customerName: '老客户', phone: '135', totalAmount: 100 } });
    await ordersCtl.create(ctx);
    assert.strictEqual(db.customers.length, 1); // 未新建
    assert.strictEqual(db.orders[0].customerId, 'cus_1');
    const ctx2 = makeCtx({ body: { customerName: '新客', phone: '134', organization: '某村委会', totalAmount: 100 } });
    await ordersCtl.create(ctx2);
    assert.strictEqual(db.customers.length, 2);
    assert.strictEqual(db.customers[1].customerType, 'organization'); // 有组织名 → organization
    assert.strictEqual(db.customers[1].createdBy, 'acc_1');
  });

  /* ==================== orders：状态机 / 更新 / 删除 ==================== */
  const mkOrder = (over = {}) => Object.assign({
    id: 'ord_1', orderNo: 'ORD001', status: 'draft',
    totalAmount: 1000, discountAmount: 0, finalAmount: 1000, depositAmount: 0, paidAmount: 0,
    performanceStartDate: null, performanceEndDate: null, customerName: '张三'
  }, over);

  await t('orders.update 状态机：draft→paid 非法（UNPROCESSABLE）；draft→confirmed 合法；同状态不校验', async () => {
    resetState();
    db.orders.push(mkOrder());
    await assert.rejects(() => ordersCtl.update(makeCtx({ params: { id: 'ord_1' }, body: { status: 'paid' } })),
      e => e.key === 'UNPROCESSABLE' && e.message.indexOf('非法状态流转') >= 0);
    const ctx = makeCtx({ params: { id: 'ord_1' }, body: { status: 'confirmed' } });
    await ordersCtl.update(ctx);
    assert.strictEqual(ctx.body.data.status, 'confirmed');
    assert.strictEqual(db.orders[0].status, 'confirmed');
    // 同状态重复 PATCH 不触发流转校验
    const ctx2 = makeCtx({ params: { id: 'ord_1' }, body: { status: 'confirmed', internalRemark: 'r' } });
    await ordersCtl.update(ctx2);
    assert.strictEqual(ctx2.body.ok, true);
    // 不存在的订单
    await assert.rejects(() => ordersCtl.update(makeCtx({ params: { id: 'nope' }, body: {} })), e => e.key === 'NOT_FOUND');
  });

  await t('orders.update 取消落 cancelledDate/cancelledBy；联动仅金额变更时触发', async () => {
    resetState();
    db.orders.push(mkOrder());
    const ctx = makeCtx({ params: { id: 'ord_1' }, body: { status: 'cancelled', cancellationReason: '客户改期' } });
    await ordersCtl.update(ctx);
    assert.ok(db.orders[0].cancelledDate instanceof Date);
    assert.strictEqual(db.orders[0].cancelledBy, '管理员');
    assert.strictEqual(syncCalls.length, 0); // 纯状态变更不触发收款联动
    // 金额变更触发
    db.orders[0].status = 'confirmed';
    const ctx2 = makeCtx({ params: { id: 'ord_1' }, body: { paidAmount: 300 } });
    await ordersCtl.update(ctx2);
    assert.strictEqual(syncCalls.length, 1);
    assert.strictEqual(syncCalls[0].order.paidAmount, 300);
  });

  await t('orders.update 与存量合并勾稽：只给 discount 时按库内 total/final 校验', async () => {
    resetState();
    db.orders.push(mkOrder({ totalAmount: 500, finalAmount: 500 }));
    // discount 600 > total 500 → 拒绝（base 合并后勾稽）
    await assert.rejects(() => ordersCtl.update(makeCtx({ params: { id: 'ord_1' }, body: { discountAmount: 600 } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('优惠金额(600)') >= 0);
    // paid 200 ≤ final 500 → 通过
    const ctx = makeCtx({ params: { id: 'ord_1' }, body: { paidAmount: 200 } });
    await ordersCtl.update(ctx);
    assert.strictEqual(db.orders[0].paidAmount, 200);
    assert.strictEqual(db.orders[0].totalAmount, 500);
  });

  await t('orders.transition：缺 to → VALIDATION_ERROR；cancelled 终态不可再流转；paid→refunded 合法', async () => {
    resetState();
    db.orders.push(mkOrder({ status: 'cancelled' }));
    await assert.rejects(() => ordersCtl.transition(makeCtx({ params: { id: 'ord_1' }, body: {} })), e => e.key === 'VALIDATION_ERROR');
    await assert.rejects(() => ordersCtl.transition(makeCtx({ params: { id: 'ord_1' }, body: { to: 'confirmed' } })),
      e => e.key === 'UNPROCESSABLE');
    db.orders[0].status = 'paid';
    const ctx = makeCtx({ params: { id: 'ord_1' }, body: { to: 'refunded', reason: '客户退单' } });
    await ordersCtl.transition(ctx);
    assert.strictEqual(db.orders[0].status, 'refunded');
    assert.ok(auditCalls.some(a => a.action === 'ORDER_TRANSITION' && a.detail.to === 'refunded'));
  });

  await t('orders.remove：仅 draft/cancelled 可删；confirmed → CONFLICT；删除级联子资源后 204', async () => {
    resetState();
    db.orders.push(mkOrder({ status: 'confirmed' }));
    await assert.rejects(() => ordersCtl.remove(makeCtx({ params: { id: 'ord_1' } })),
      e => e.key === 'CONFLICT' && e.message.indexOf('仅草稿/已取消') >= 0);
    db.orders[0].status = 'draft';
    db.orderItems.push({ id: 'it1', orderId: 'ord_1' });
    const ctx = makeCtx({ params: { id: 'ord_1' } });
    await ordersCtl.remove(ctx);
    assert.strictEqual(ctx.status, 204);
    assert.strictEqual(ctx.body, undefined);
    assert.strictEqual(db.orders.length, 0);
    assert.strictEqual(db.orderItems.length, 0); // 级联
    assert.ok(auditCalls.some(a => a.action === 'ORDER_DELETE'));
  });

  /* ==================== appointments ==================== */
  const mkApptBody = (over = {}) => Object.assign({
    customerName: '刘先生', phone: '13811112222',
    preferredStartDate: '2026-10-01', performanceCount: 2
  }, over);

  await t('appointments.create 必填与套餐枚举：缺项 → VALIDATION_ERROR；非法 packageType → VALIDATION_ERROR', async () => {
    resetState();
    await assert.rejects(() => apptCtl.create(makeCtx({ body: { customerName: 'x' } })), e => e.key === 'VALIDATION_ERROR');
    await assert.rejects(() => apptCtl.create(makeCtx({ body: mkApptBody({ packageType: 'moon_fair' }) })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('packageType') >= 0);
    assert.strictEqual(db.appointments.length, 0);
  });

  await t('appointments.create 匿名公开：pending+website 建档，自动转 draft 订单并回链 convertedOrderId', async () => {
    resetState();
    const ctx = makeCtx({
      state: {}, // 匿名
      body: mkApptBody({
        packageType: 'temple_fair', performanceCount: 3, totalPerformanceFee: 50000,
        venueProvince: '甘肃省', venueCity: '天水市', venueDistrict: '秦安县', venueAddress: '某村戏台',
        plays: [{ playId: 'play_1', sortOrder: 1 }]
      })
    });
    await apptCtl.create(ctx);
    assert.strictEqual(ctx.status, 201);
    const appt = db.appointments[0];
    assert.strictEqual(appt.status, 'pending');
    assert.strictEqual(appt.source, 'website');
    assert.strictEqual(appt.createdBy, 'public_booking');
    assert.strictEqual(db.customers[0].sourceChannel, 'website');
    // 自动订单
    assert.strictEqual(db.orders.length, 1);
    assert.strictEqual(db.orders[0].status, 'draft');
    assert.strictEqual(db.orders[0].appointmentId, appt.id);
    assert.strictEqual(db.orders[0].totalAmount, 50000);
    assert.strictEqual(db.orders[0].finalAmount, 50000);
    assert.strictEqual(db.orders[0].venueFullAddress, '甘肃省天水市秦安县某村戏台');
    assert.strictEqual(db.orders[0].createdBy, 'public_booking');
    // 回链 + 剧目同步为订单明细
    assert.strictEqual(appt.convertedOrderId, db.orders[0].id);
    assert.ok(appt.conversionToOrderDate instanceof Date);
    assert.strictEqual(db.orderItems.length, 1);
    assert.strictEqual(db.orderItems[0].orderId, db.orders[0].id);
    assert.ok(auditCalls.some(a => a.action === 'APPOINTMENT_CREATE_PUBLIC'));
    assert.ok(auditCalls.some(a => a.action === 'APPOINTMENT_AUTO_CONVERT_ORDER'));
  });

  await t('appointments.create 失败隔离：自动转订单抛错不影响预约主流程（仍 201，仅 error 日志）', async () => {
    resetState();
    const origCreate = prisma.order.create;
    prisma.order.create = async () => { throw new Error('order table down'); };
    try {
      const ctx = makeCtx({ state: {}, body: mkApptBody() });
      await apptCtl.create(ctx);
      assert.strictEqual(ctx.status, 201);
      assert.strictEqual(db.appointments.length, 1);
      assert.strictEqual(db.appointments[0].convertedOrderId, undefined);
      assert.ok(errors.some(x => x.indexOf('auto-convert-order failed') >= 0));
    } finally {
      prisma.order.create = origCreate;
    }
  });

  await t('appointments.create 后台建单：不自动转订单；packageType 按场景推断（3场→庙会/1场→文旅/学校→校园）', async () => {
    resetState();
    const ctx = makeCtx({ body: mkApptBody({ performanceCount: 3 }) }); // 有 state.user → 后台
    await apptCtl.create(ctx);
    assert.strictEqual(db.orders.length, 0); // 后台不自动转
    assert.strictEqual(db.appointments[0].packageType, 'temple_fair');
    assert.strictEqual(db.appointments[0].source, 'manual');
    const ctx2 = makeCtx({ body: mkApptBody({ performanceCount: 1, phone: '13811113333' }) });
    await apptCtl.create(ctx2);
    assert.strictEqual(db.appointments[1].packageType, 'cultural_tourism');
    const ctx3 = makeCtx({ body: mkApptBody({ performanceCount: 2, phone: '13811114444', sourceChannel: 'school' }) });
    await apptCtl.create(ctx3);
    assert.strictEqual(db.appointments[2].packageType, 'campus_tour');
    assert.ok(auditCalls.every(a => a.action !== 'APPOINTMENT_CREATE_PUBLIC')); // 后台动作不带 _PUBLIC
  });

  await t('appointments.transition 状态机：pending→confirmed 合法落审计；confirmed→rejected 非法；converted 终态；缺 to → VALIDATION_ERROR', async () => {
    resetState();
    db.appointments.push({ id: 'ap_1', status: 'pending', appointmentNo: 'APT1' });
    await assert.rejects(() => apptCtl.transition(makeCtx({ params: { id: 'ap_1' }, body: {} })), e => e.key === 'VALIDATION_ERROR');
    const ctx = makeCtx({ params: { id: 'ap_1' }, body: { to: 'confirmed' } });
    await apptCtl.transition(ctx);
    assert.strictEqual(db.appointments[0].status, 'confirmed');
    assert.strictEqual(db.appointmentAudits.length, 1);
    assert.strictEqual(db.appointmentAudits[0].actionType, 'STATUS_CHANGE');
    assert.strictEqual(db.appointmentAudits[0].fromStatus, 'pending');
    assert.strictEqual(db.appointmentAudits[0].toStatus, 'confirmed');
    assert.strictEqual(db.appointmentAudits[0].operatorAccountId, 'acc_1');
    // confirmed 不允许直接 rejected（流程表无此项）
    await assert.rejects(() => apptCtl.transition(makeCtx({ params: { id: 'ap_1' }, body: { to: 'rejected' } })),
      e => e.key === 'UNPROCESSABLE' && e.message.indexOf('非法状态流转') >= 0);
    // converted 终态
    db.appointments[0].status = 'converted';
    await assert.rejects(() => apptCtl.transition(makeCtx({ params: { id: 'ap_1' }, body: { to: 'pending' } })),
      e => e.key === 'UNPROCESSABLE');
  });

  await t('appointments.remove：converted 禁删（CONFLICT）；pending 删除级联剧目+审计后 204', async () => {
    resetState();
    db.appointments.push({ id: 'ap_1', status: 'converted' });
    await assert.rejects(() => apptCtl.remove(makeCtx({ params: { id: 'ap_1' } })),
      e => e.key === 'CONFLICT' && e.message.indexOf('已转订单') >= 0);
    db.appointments[0].status = 'pending';
    db.appointmentPlays.push({ appointmentId: 'ap_1', playId: 'p1' });
    db.appointmentAudits.push({ id: 'au1', appointmentId: 'ap_1' });
    const ctx = makeCtx({ params: { id: 'ap_1' } });
    await apptCtl.remove(ctx);
    assert.strictEqual(ctx.status, 204);
    assert.strictEqual(db.appointments.length, 0);
    assert.strictEqual(db.appointmentPlays.length, 0);
    assert.strictEqual(db.appointmentAudits.length, 0);
    await assert.rejects(() => apptCtl.remove(makeCtx({ params: { id: 'ap_1' } })), e => e.key === 'NOT_FOUND');
  });

  /* ==================== finance ==================== */
  await t('finance.create：缺 summary / 借贷均≤0 → VALIDATION_ERROR', async () => {
    resetState();
    await assert.rejects(() => finCtl.create(makeCtx({ body: { creditAmount: 100 } })), e => e.key === 'VALIDATION_ERROR');
    await assert.rejects(() => finCtl.create(makeCtx({ body: { summary: 'x', creditAmount: 0, debitAmount: 0 } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('至少一项大于 0') >= 0);
    assert.strictEqual(db.ledgers.length, 0);
  });

  await t('finance.create 安全：制单强制 draft（body.status=checked 被忽略）；≥1 万自动需复核；类型按借/贷推导', async () => {
    resetState();
    const ctx = makeCtx({ body: { summary: '大额演出收入', creditAmount: 10000, status: 'checked', voucherType: 'payment' } });
    await finCtl.create(ctx);
    assert.strictEqual(ctx.status, 201);
    const row = db.ledgers[0];
    assert.strictEqual(row.status, 'draft'); // M-15：复核状态不可由制单入口落入
    assert.strictEqual(row.voucherType, 'payment'); // 显式传入优先
    assert.strictEqual(row.doubleCheckRequired, true); // 边界等值触发
    assert.strictEqual(row.makerAccountId, 'acc_1');
    // 默认类型推导 + 阈值之下
    const ctx2 = makeCtx({ body: { summary: '收入', creditAmount: 9999.99 } });
    await finCtl.create(ctx2);
    assert.strictEqual(db.ledgers[1].voucherType, 'receipt');
    assert.strictEqual(db.ledgers[1].doubleCheckRequired, false);
    const ctx3 = makeCtx({ body: { summary: '支出', debitAmount: 50 } });
    await finCtl.create(ctx3);
    assert.strictEqual(db.ledgers[2].voucherType, 'payment');
    // 显式关闭复核标记
    const ctx4 = makeCtx({ body: { summary: '大额但豁免', creditAmount: 50000, doubleCheckRequired: false } });
    await finCtl.create(ctx4);
    assert.strictEqual(db.ledgers[3].doubleCheckRequired, false);
  });

  await t('finance.update 状态机：仅 draft→checked 单向；checked→draft 拒绝；非法状态值拒绝；非草稿提交复核拒绝', async () => {
    resetState();
    db.ledgers.push({ id: 'led_1', status: 'draft', isReconciled: false, makerAccountId: 'acc_maker', creditAmount: 100 });
    // 非法状态值
    await assert.rejects(() => finCtl.update(makeCtx({ params: { id: 'led_1' }, body: { status: 'posted' } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('draft / checked') >= 0);
    // 正常提交复核（复核人与制单人不同）
    const ctx = makeCtx({
      params: { id: 'led_1' }, body: { status: 'checked' },
      state: { user: { sub: 'acc_checker', username: 'checker', role: 'super_admin' } }
    });
    await finCtl.update(ctx);
    assert.strictEqual(db.ledgers[0].status, 'checked');
    assert.strictEqual(db.ledgers[0].checkerAccountId, 'acc_checker');
    assert.ok(db.ledgers[0].checkedAt instanceof Date);
    // checked → draft 拒绝
    await assert.rejects(() => finCtl.update(makeCtx({ params: { id: 'led_1' }, body: { status: 'draft' } })),
      e => e.key === 'CONFLICT' && e.message.indexOf('不可撤回') >= 0);
    // 非草稿再次提交复核拒绝
    await assert.rejects(() => finCtl.update(makeCtx({
      params: { id: 'led_1' }, body: { status: 'checked' },
      state: { user: { sub: 'acc_other', role: 'super_admin' } }
    })), e => e.key === 'CONFLICT' && e.message.indexOf('仅草稿状态') >= 0);
  });

  await t('finance.update M-15 同人禁令：制单人自己提交复核 → FORBIDDEN', async () => {
    resetState();
    db.ledgers.push({ id: 'led_1', status: 'draft', isReconciled: false, makerAccountId: 'acc_maker', creditAmount: 100 });
    const ctx = makeCtx({
      params: { id: 'led_1' }, body: { status: 'checked' },
      state: { user: { sub: 'acc_maker', username: 'maker', role: 'super_admin' } }
    });
    await assert.rejects(() => finCtl.update(ctx),
      e => e.key === 'FORBIDDEN' && e.message.indexOf('制单人与复核人不可为同一人') >= 0);
    assert.strictEqual(db.ledgers[0].status, 'draft');
  });

  await t('finance.update 复核角色只读：finance_checker 携带 status 以外字段 → FORBIDDEN；纯 {status:checked} 放行', async () => {
    resetState();
    db.ledgers.push({ id: 'led_1', status: 'draft', isReconciled: false, makerAccountId: 'acc_maker', creditAmount: 100, summary: '旧摘要' });
    const checker = { user: { sub: 'acc_checker', username: 'checker', role: 'finance_checker' } };
    await assert.rejects(
      () => finCtl.update(makeCtx({ params: { id: 'led_1' }, body: { status: 'checked', summary: '篡改' }, state: checker })),
      e => e.key === 'FORBIDDEN' && e.message.indexOf('复核账号仅可提交复核') >= 0
    );
    assert.strictEqual(db.ledgers[0].summary, '旧摘要'); // 未被改
    const ctx = makeCtx({ params: { id: 'led_1' }, body: { status: 'checked' }, state: checker });
    await finCtl.update(ctx);
    assert.strictEqual(db.ledgers[0].status, 'checked');
    assert.strictEqual(db.ledgers[0].checkerAccountId, 'acc_checker');
  });

  await t('finance.update/remove 对账锁：isReconciled 凭证禁改禁删；checked 凭证禁删', async () => {
    resetState();
    db.ledgers.push({ id: 'led_1', status: 'draft', isReconciled: true, makerAccountId: 'm', creditAmount: 1 });
    await assert.rejects(() => finCtl.update(makeCtx({ params: { id: 'led_1' }, body: { summary: 'x' } })),
      e => e.key === 'CONFLICT' && e.message.indexOf('已对账') >= 0);
    await assert.rejects(() => finCtl.remove(makeCtx({ params: { id: 'led_1' } })),
      e => e.key === 'CONFLICT' && e.message.indexOf('已对账') >= 0);
    db.ledgers[0].isReconciled = false;
    db.ledgers[0].status = 'checked';
    await assert.rejects(() => finCtl.remove(makeCtx({ params: { id: 'led_1' } })),
      e => e.key === 'CONFLICT' && e.message.indexOf('仅草稿') >= 0);
    db.ledgers[0].status = 'draft';
    const ctx = makeCtx({ params: { id: 'led_1' } });
    await finCtl.remove(ctx);
    assert.strictEqual(ctx.status, 204);
    assert.strictEqual(db.ledgers.length, 0);
    await assert.rejects(() => finCtl.remove(makeCtx({ params: { id: 'led_1' } })), e => e.key === 'NOT_FOUND');
  });

  await t('finance.summary：月度分桶（收入/支出/四分类/净利/毛利率/订单数）；范围外数据排除；months 钳制 1..24', async () => {
    resetState();
    const now = new Date();
    const cur = new Date(now.getFullYear(), now.getMonth(), 10);
    const curKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    db.ledgers.push(
      { voucherDate: cur, voucherCategory: '演出收入', creditAmount: 1000, debitAmount: 0 },
      { voucherDate: cur, voucherCategory: '人员成本', creditAmount: 0, debitAmount: 200 },
      { voucherDate: cur, voucherCategory: '差旅杂费', creditAmount: 0, debitAmount: 50 },
      { voucherDate: cur, voucherCategory: '道具设备', creditAmount: 0, debitAmount: 30 },
      { voucherDate: cur, voucherCategory: null, creditAmount: 0, debitAmount: 20 },
      { voucherDate: new Date(now.getFullYear() - 2, 0, 15), voucherCategory: '演出收入', creditAmount: 9999, debitAmount: 0 }
    );
    db.orders.push(
      { orderDate: cur }, { orderDate: cur }, { orderDate: new Date(now.getFullYear() - 2, 0, 15) }
    );
    const ctx = makeCtx({ query: { months: '3' } });
    await finCtl.summary(ctx);
    const rows = ctx.body.data;
    assert.strictEqual(rows.length, 3);
    const curRow = rows.find(r => r.month === curKey);
    assert.ok(curRow);
    assert.strictEqual(curRow.totalIncome, 1000);
    assert.strictEqual(curRow.totalExpense, 300);
    assert.strictEqual(curRow.staffCost, 200);
    assert.strictEqual(curRow.travelCost, 50);
    assert.strictEqual(curRow.propCost, 30);
    assert.strictEqual(curRow.otherCost, 20);
    assert.strictEqual(curRow.netProfit, 700);
    assert.strictEqual(curRow.margin, 70);
    assert.strictEqual(curRow.orderCount, 2); // 两年前的订单不计
    // months 钳制上限 24
    const ctx2 = makeCtx({ query: { months: '99' } });
    await finCtl.summary(ctx2);
    assert.strictEqual(ctx2.body.data.length, 24);
  });

  /* ==================== cast-sheets ==================== */
  await t('cast-sheets.create：缺 scheduleId → VALIDATION_ERROR；含 crew 整体写入（默认 category=龙套/sortOrder=下标）', async () => {
    resetState();
    await assert.rejects(() => castCtl.create(makeCtx({ body: {} })), e => e.key === 'VALIDATION_ERROR');
    const ctx = makeCtx({
      body: {
        scheduleId: 'sch_1', playTitle: '火焰驹', performanceDate: '2026-10-01',
        crew: [{ performerName: '王演员', roleName: '李彦贵' }, { performerName: '李乐师', category: '乐队', sortOrder: 5, wageAmount: 300 }]
      }
    });
    await castCtl.create(ctx);
    assert.strictEqual(ctx.status, 201);
    // nanoid 字母表含 -/_（toUpperCase 不剥除），故后缀允许这两字符
    assert.ok(/^CS\d{10}[0-9A-Z_-]{4}$/.test(db.castSheets[0].sheetNo), db.castSheets[0].sheetNo);
    assert.strictEqual(db.castSheets[0].status, 'draft');
    assert.strictEqual(db.castSheets[0].createdBy, 'acc_1');
    assert.strictEqual(db.castCrew.length, 2);
    assert.strictEqual(db.castCrew[0].category, '龙套'); // 默认
    assert.strictEqual(db.castCrew[0].sortOrder, 0);     // 下标
    assert.strictEqual(db.castCrew[1].category, '乐队');
    // 响应走 toApi 映射
    const d = ctx.body.data;
    assert.strictEqual(d.statusText, '草稿');
    assert.strictEqual(d.crew.length, 2);
    assert.strictEqual(d.crew[0].performerName, '王演员');
    assert.strictEqual(d.performanceDate, '2026-10-01');
    assert.ok(auditCalls.some(a => a.action === 'CAST_SHEET_CREATE' && a.detail.crewCount === 2));
  });

  await t('cast-sheets.update：置 confirmed 自动补 confirmedAt/confirmedBy；crew 数组给出时整体替换、不给时保留', async () => {
    resetState();
    db.castSheets.push({ id: 'cs_1', sheetNo: 'CS001', status: 'draft', confirmedAt: null });
    db.castCrew.push({ id: 'cr_1', castSheetId: 'cs_1', performerName: '旧演员', sortOrder: 0 });
    const ctx = makeCtx({
      params: { id: 'cs_1' },
      body: { status: 'confirmed', crew: [{ performerName: '新演员', category: '主演' }] }
    });
    await castCtl.update(ctx);
    assert.strictEqual(db.castSheets[0].status, 'confirmed');
    assert.ok(db.castSheets[0].confirmedAt instanceof Date);
    assert.strictEqual(db.castSheets[0].confirmedBy, 'acc_1');
    assert.strictEqual(db.castCrew.length, 1);
    assert.strictEqual(db.castCrew[0].performerName, '新演员');
    assert.strictEqual(ctx.body.data.statusText, '已确认');
    // 不带 crew 字段：crew 原样保留
    const ctx2 = makeCtx({ params: { id: 'cs_1' }, body: { crewNote: '备注' } });
    await castCtl.update(ctx2);
    assert.strictEqual(db.castCrew.length, 1);
    assert.strictEqual(db.castSheets[0].crewNote, '备注');
    await assert.rejects(() => castCtl.update(makeCtx({ params: { id: 'nope' }, body: {} })), e => e.key === 'NOT_FOUND');
  });

  await t('cast-sheets.remove：级联删 crew 后删 sheet → 204；不存在 → NOT_FOUND', async () => {
    resetState();
    db.castSheets.push({ id: 'cs_1', sheetNo: 'CS001', status: 'draft' });
    db.castCrew.push({ id: 'cr_1', castSheetId: 'cs_1' }, { id: 'cr_2', castSheetId: 'cs_1' });
    const ctx = makeCtx({ params: { id: 'cs_1' } });
    await castCtl.remove(ctx);
    assert.strictEqual(ctx.status, 204);
    assert.strictEqual(db.castSheets.length, 0);
    assert.strictEqual(db.castCrew.length, 0);
    assert.ok(auditCalls.some(a => a.action === 'CAST_SHEET_DELETE' && a.detail.sheetNo === 'CS001'));
    await assert.rejects(() => castCtl.remove(makeCtx({ params: { id: 'cs_1' } })), e => e.key === 'NOT_FOUND');
  });

  /* ==================== wages：考勤扣罚纯函数 ==================== */
  await t('wages.computeAttendancePenalty：迟到20元/次、迟到超30分钟扣半日工资、旷工1天扣两日', async () => {
    resetState();
    const p = wagesCtl.computeAttendancePenalty({ late: 2, lateOver: 1, absent: 1 }, 200);
    assert.strictEqual(p.lateFine, 40);          // 2 × 20
    assert.strictEqual(p.lateOverFine, 100);     // 1 × 200 × 0.5
    assert.strictEqual(p.absentFine, 400);       // 1 × 200 × 2
    assert.strictEqual(p.total, 540);
    assert.strictEqual(wagesCtl.WAGE_DEDUCT_RULES.LATE_FINE_PER_TIME, 20);
    assert.strictEqual(wagesCtl.WAGE_DEDUCT_RULES.ABSENT_DEDUCT_DAYS, 2);
    // 零出勤零扣罚
    const z = wagesCtl.computeAttendancePenalty(null, 200);
    assert.strictEqual(z.total, 0);
  });

  /* ==================== wages：工资条 create 取价优先级 ==================== */
  await t('wages.create：batchId/performerName 必填；baseWage 取价优先级（显式 > 协议天工资×出勤 > 职级标准）；细分扣款编码', async () => {
    resetState();
    db.performers.push({ id: 'pf_1', name: '王演员', staffNo: 'PF001', rankGrade: '一级演员', dailyRate: 300, status: 'active' });
    db.wageRules.push(mkRule()); // 一级演员 200/天
    await assert.rejects(() => wagesCtl.create(makeCtx({ body: {} })), e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('batchId') >= 0);
    await assert.rejects(() => wagesCtl.create(makeCtx({ body: { batchId: 'wb_1' } })), e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('performerName') >= 0);
    // 1) 协议天工资 300 × 10 出勤
    const c1 = makeCtx({ body: { batchId: 'wb_1', performerId: 'pf_1', attDays: 10 } });
    await wagesCtl.create(c1);
    assert.strictEqual(db.wageItems[0].baseWage, 3000);
    assert.strictEqual(db.wageItems[0].performerName, '王演员'); // 由花名册回填
    assert.strictEqual(db.wageItems[0].staffNo, 'PF001');
    // 2) 显式 baseWage 优先于协议价
    const c2 = makeCtx({ body: { batchId: 'wb_1', performerId: 'pf_1', attDays: 10, baseWage: 999 } });
    await wagesCtl.create(c2);
    assert.strictEqual(db.wageItems[1].baseWage, 999);
    // 3) 无协议天工资 → 职级标准 200 × 5
    db.performers[0].dailyRate = null;
    const c3 = makeCtx({ body: { batchId: 'wb_1', performerId: 'pf_1', attDays: 5 } });
    await wagesCtl.create(c3);
    assert.strictEqual(db.wageItems[2].baseWage, 1000);
    // 4) 细分扣款编码进 otherDeduction + JSON 备注
    const c4 = makeCtx({ body: { batchId: 'wb_1', performerName: '李演员', attDays: 3, baseWage: 600, leaveDeduction: 100, absentDeduction: 400, lateDeduction: 20, earlyDeduction: 20 } });
    await wagesCtl.create(c4);
    assert.strictEqual(db.wageItems[3].otherDeduction, 540);
    assert.deepStrictEqual(JSON.parse(db.wageItems[3].otherDeductionNote), { leave: 100, absent: 400, late: 20, early: 20 });
  });

  await t('wages.update/remove 过账保护：confirmed/posted 批次的明细冻结，draft 批次可改可删', async () => {
    resetState();
    db.wageBatches.push({ id: 'wb_c', status: 'confirmed' }, { id: 'wb_p', status: 'posted' }, { id: 'wb_d', status: 'draft' });
    db.wageItems.push(
      { id: 'wi_c', batchId: 'wb_c', performerName: 'A' },
      { id: 'wi_p', batchId: 'wb_p', performerName: 'B' },
      { id: 'wi_d', batchId: 'wb_d', performerName: 'C' }
    );
    await assert.rejects(() => wagesCtl.update(makeCtx({ params: { id: 'wi_c' }, body: { baseWage: 1 } })),
      e => e.key === 'UNPROCESSABLE' && e.message.indexOf('已确认') >= 0);
    await assert.rejects(() => wagesCtl.remove(makeCtx({ params: { id: 'wi_p' } })),
      e => e.key === 'UNPROCESSABLE' && e.message.indexOf('已过账发放') >= 0);
    await assert.rejects(() => wagesCtl.update(makeCtx({ params: { id: 'nope' }, body: {} })), e => e.key === 'NOT_FOUND');
    // draft 批次可改可删
    const ctx = makeCtx({ params: { id: 'wi_d' }, body: { baseWage: 500 } });
    await wagesCtl.update(ctx);
    assert.strictEqual(db.wageItems.find(x => x.id === 'wi_d').baseWage, 500);
    const ctx2 = makeCtx({ params: { id: 'wi_d' } });
    await wagesCtl.remove(ctx2);
    assert.strictEqual(ctx2.status, 204);
    assert.strictEqual(db.wageItems.length, 2);
  });

  /* ==================== wages：generate 批量核算 ==================== */
  await t('wages.generate：无底薪核算=协议天工资×工天（half 0.5）；全勤奖迟到≥3次取消；扣罚不超应发；跳过零出勤无协议人员', async () => {
    resetState();
    db.performers.push(
      { id: 'pf_a', name: '甲', staffNo: 'PF001', rankGrade: '一级演员', dailyRate: 300, status: 'active' },
      { id: 'pf_b', name: '乙', staffNo: 'PF002', rankGrade: '一级演员', dailyRate: null, status: 'active' },
      { id: 'pf_c', name: '丙', staffNo: 'PF003', rankGrade: null, dailyRate: null, status: 'active' }, // 无出勤无协议 → 跳过
      { id: 'pf_d', name: '丁', staffNo: 'PF004', rankGrade: '一级演员', dailyRate: 100, status: 'deleted' } // 软删 → 排除
    );
    db.wageRules.push(mkRule()); // 一级演员 200/天，夜场50，交通15/天，餐补10/天，全勤300
    // 甲：20 full + 2 night → 22 工天，2 夜场；无异常 → 全勤
    for (let i = 0; i < 20; i++) db.attendance.push({ staffId: 'pf_a', attendanceMonth: '2026-08', attendanceType: 'full' });
    db.attendance.push({ staffId: 'pf_a', attendanceMonth: '2026-08', attendanceType: 'night' }, { staffId: 'pf_a', attendanceMonth: '2026-08', attendanceType: 'night' });
    // 乙：10 full + 3 late → 10 工天；迟到 3 次 → 取消全勤；扣罚 60
    for (let i = 0; i < 10; i++) db.attendance.push({ staffId: 'pf_b', attendanceMonth: '2026-08', attendanceType: 'full' });
    for (let i = 0; i < 3; i++) db.attendance.push({ staffId: 'pf_b', attendanceMonth: '2026-08', attendanceType: 'late' });
    // 半班折算：甲再加 2 个 half → +1 工天 = 23
    db.attendance.push({ staffId: 'pf_a', attendanceMonth: '2026-08', attendanceType: 'half' }, { staffId: 'pf_a', attendanceMonth: '2026-08', attendanceType: 'half' });

    const ctx = makeCtx({ body: { month: '2026-08', dryRun: true } });
    await wagesCtl.generate(ctx);
    const d = ctx.body.data;
    assert.strictEqual(d.dryRun, true);
    assert.strictEqual(d.totalPerformers, 2); // 丙跳过、丁排除
    const ia = d.items.find(x => x.performerId === 'pf_a');
    const ib = d.items.find(x => x.performerId === 'pf_b');
    assert.strictEqual(ia.attendanceDays, 23);
    assert.strictEqual(ia.baseWage, 6900);            // 300 × 23
    assert.strictEqual(ia.nightShowBonus, 100);       // 50 × 2
    assert.strictEqual(ia.fullAttendanceBonus, 300);  // 全勤
    assert.strictEqual(ia.transportAllowance, 345);   // 15 × 23
    assert.strictEqual(ia.mealAllowance, 230);        // 10 × 23
    assert.strictEqual(ia.grossPay, 7875);
    assert.strictEqual(ia.totalDeduction, 0);
    assert.strictEqual(ia.netPay, 7875);
    assert.strictEqual(ib.attendanceDays, 10);
    assert.strictEqual(ib.baseWage, 2000);            // 职级 200 × 10
    assert.strictEqual(ib.fullAttendanceBonus, 0);    // 迟到 3 次取消全勤
    assert.strictEqual(ib.totalDeduction, 60);        // 3 × 20
    assert.strictEqual(ib.netPay, 2000 + 150 + 100 - 60); // gross 2250 − 60 = 2190
    // 汇总
    assert.strictEqual(d.totalBaseWage, 8900);
    assert.strictEqual(d.totalDeduction, 60);
    assert.strictEqual(d.totalNetPay, 7875 + 2190);
  });

  await t('wages.generate 幂等重建：同月 draft 批次先删后建；confirmed/posted 批次拒绝重算（CONFLICT）；空名册 UNPROCESSABLE', async () => {
    resetState();
    await assert.rejects(() => wagesCtl.generate(makeCtx({ body: {} })), e => e.key === 'VALIDATION_ERROR');
    await assert.rejects(() => wagesCtl.generate(makeCtx({ body: { month: '2026-08' } })),
      e => e.key === 'UNPROCESSABLE' && e.message.indexOf('花名册无在册人员') >= 0);
    db.performers.push({ id: 'pf_a', name: '甲', rankGrade: null, dailyRate: 100, status: 'active' });
    db.attendance.push({ staffId: 'pf_a', attendanceMonth: '2026-08', attendanceType: 'full' });
    // 第一次：生成 draft 批次
    const c1 = makeCtx({ body: { month: '2026-08' } });
    await wagesCtl.generate(c1);
    assert.strictEqual(c1.status, 201);
    assert.strictEqual(db.wageBatches.length, 1);
    assert.strictEqual(db.wageBatches[0].status, 'draft');
    assert.strictEqual(db.wageBatches[0].totalNetPay, 100); // 100×1 天
    assert.strictEqual(db.wageItems.length, 1);
    // 第二次同月重算：旧 draft 删除重建，不产生重复
    db.attendance.push({ staffId: 'pf_a', attendanceMonth: '2026-08', attendanceType: 'full' }); // 改为 2 天
    const c2 = makeCtx({ body: { month: '2026-08' } });
    await wagesCtl.generate(c2);
    assert.strictEqual(db.wageBatches.length, 1);
    assert.strictEqual(db.wageItems.length, 1);
    assert.strictEqual(db.wageBatches[0].totalNetPay, 200);
    assert.strictEqual(c2.body.data.replaced.length, 1); // 记录被替换批次
    // confirmed 批次锁定
    db.wageBatches[0].status = 'confirmed';
    await assert.rejects(() => wagesCtl.generate(makeCtx({ body: { month: '2026-08' } })),
      e => e.key === 'CONFLICT' && e.message.indexOf('已确认') >= 0);
    db.wageBatches[0].status = 'posted';
    await assert.rejects(() => wagesCtl.generate(makeCtx({ body: { month: '2026-08' } })),
      e => e.key === 'CONFLICT' && e.message.indexOf('已过账发放') >= 0);
  });

  await t('wages 批次状态机：confirm 仅 draft、post 仅 confirmed；过账落 postedToLedger/postedAt', async () => {
    resetState();
    db.wageBatches.push({ id: 'wb_1', batchNo: 'WB-1', status: 'draft' });
    await assert.rejects(() => wagesCtl.batchPost(makeCtx({ params: { id: 'wb_1' } })),
      e => e.key === 'UNPROCESSABLE' && e.message.indexOf('confirmed') >= 0);
    const c1 = makeCtx({ params: { id: 'wb_1' } });
    await wagesCtl.batchConfirm(c1);
    assert.strictEqual(db.wageBatches[0].status, 'confirmed');
    assert.strictEqual(db.wageBatches[0].confirmedBy, 'admin');
    assert.ok(db.wageBatches[0].confirmedAt instanceof Date);
    // 重复确认拒绝
    await assert.rejects(() => wagesCtl.batchConfirm(makeCtx({ params: { id: 'wb_1' } })), e => e.key === 'UNPROCESSABLE');
    const c2 = makeCtx({ params: { id: 'wb_1' } });
    await wagesCtl.batchPost(c2);
    assert.strictEqual(db.wageBatches[0].status, 'posted');
    assert.strictEqual(db.wageBatches[0].postedToLedger, true);
    assert.ok(db.wageBatches[0].postedAt instanceof Date);
    await assert.rejects(() => wagesCtl.batchConfirm(makeCtx({ params: { id: 'nope' } })), e => e.key === 'NOT_FOUND');
  });

  /* ==================== performers ==================== */
  await t('performers.create 工号分配：取全表 PF 最大序号+1（含软删占号，QA- 历史号不计）；手工工号直接使用', async () => {
    resetState();
    db.performers.push(
      { id: 'p1', staffNo: 'PF003', status: 'active' },
      { id: 'p2', staffNo: 'QA-P-0001', status: 'active' }, // 历史批次不计入 PF 序列
      { id: 'p3', staffNo: 'PF010', status: 'deleted' }      // 软删仍占号
    );
    const ctx = makeCtx({ body: { name: '新演员', dailyRate: 200 } });
    await performersCtl.create(ctx);
    assert.strictEqual(ctx.status, 201);
    assert.strictEqual(db.performers[3].staffNo, 'PF011'); // max(3,10)+1
    assert.strictEqual(db.performers[3].dailyRate, 200);
    // 手工工号
    const ctx2 = makeCtx({ body: { name: '老演员', staffNo: 'PF100' } });
    await performersCtl.create(ctx2);
    assert.strictEqual(db.performers[4].staffNo, 'PF100');
    // dailyRate 非法值归一
    const ctx3 = makeCtx({ body: { name: '测试员', dailyRate: 'abc' } });
    await performersCtl.create(ctx3);
    assert.strictEqual(db.performers[5].dailyRate, null);
  });

  await t('performers.create P2002 重试：自动工号并发冲突时重新取号（最多3次），手工工号不重试', async () => {
    resetState();
    const origCreate = prisma.performersDbV1.create;
    let calls = 0;
    prisma.performersDbV1.create = async ({ data }) => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
      return origCreate({ data });
    };
    try {
      const ctx = makeCtx({ body: { name: '并发演员' } });
      await performersCtl.create(ctx);
      assert.strictEqual(ctx.status, 201);
      assert.strictEqual(calls, 3); // 第3次成功
      assert.strictEqual(db.performers[0].staffNo, 'PF001');
    } finally {
      prisma.performersDbV1.create = origCreate;
    }
    // 手工工号遇 P2002 直接抛（不重试）
    resetState();
    calls = 0;
    prisma.performersDbV1.create = async () => { calls++; throw Object.assign(new Error('unique'), { code: 'P2002' }); };
    try {
      await assert.rejects(() => performersCtl.create(makeCtx({ body: { name: 'x', staffNo: 'PF001' } })), e => e.code === 'P2002');
      assert.strictEqual(calls, 1);
    } finally {
      prisma.performersDbV1.create = origCreate;
    }
  });

  await t('performers.selfRegister：条例确认/姓名/身份证格式校验；在职或审核中重复登记 → CONFLICT', async () => {
    resetState();
    const IDCARD = '11010119900101123X';
    await assert.rejects(() => performersCtl.selfRegister(makeCtx({ state: {}, body: { name: '张三', idCardNo: IDCARD } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('员工管理条例') >= 0);
    await assert.rejects(() => performersCtl.selfRegister(makeCtx({ state: {}, body: { regulationsConfirmed: true, name: '张', idCardNo: IDCARD } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('姓名') >= 0);
    await assert.rejects(() => performersCtl.selfRegister(makeCtx({ state: {}, body: { regulationsConfirmed: true, name: '张三', idCardNo: '123' } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('18位') >= 0);
    // 首次登记成功 → pending
    const ctx = makeCtx({ state: {}, body: { regulationsConfirmed: true, name: '张三', idCardNo: IDCARD, dailyRate: 260 } });
    await performersCtl.selfRegister(ctx);
    assert.strictEqual(ctx.status, 201);
    assert.strictEqual(db.performers[0].status, 'pending');
    assert.strictEqual(db.performers[0].reviewStatus, 'pending');
    assert.strictEqual(db.performers[0].staffNo, null); // 审核通过才分配工号
    assert.strictEqual(db.performers[0].dailyRate, 260);
    assert.strictEqual(db.performers[0].agreedSalary, '协议天工资 260 元/天');
    // 审核中重复提交 → CONFLICT
    db.performers[0].status = 'pending';
    await assert.rejects(() => performersCtl.selfRegister(makeCtx({ state: {}, body: { regulationsConfirmed: true, name: '张三', idCardNo: IDCARD } })),
      e => e.key === 'CONFLICT' && e.message.indexOf('审核中') >= 0);
    // 在职重复提交 → CONFLICT
    db.performers[0].status = 'active';
    await assert.rejects(() => performersCtl.selfRegister(makeCtx({ state: {}, body: { regulationsConfirmed: true, name: '张三', idCardNo: IDCARD } })),
      e => e.key === 'CONFLICT' && e.message.indexOf('已在职') >= 0);
  });

  await t('performers.selfRegister 退回重提：rejected 记录原地更新回 pending，不新增行', async () => {
    resetState();
    db.performers.push({ id: 'pf_r', name: '李四', idCardNo: '11010119900101123X', status: 'pending', reviewStatus: 'rejected', reviewFeedback: '资料不全' });
    const ctx = makeCtx({ state: {}, body: { regulationsConfirmed: true, name: '李四', idCardNo: '11010119900101123X', phone: '139' } });
    await performersCtl.selfRegister(ctx);
    assert.strictEqual(ctx.status, 201);
    assert.strictEqual(db.performers.length, 1); // 原地更新
    assert.strictEqual(db.performers[0].reviewStatus, 'pending');
    assert.strictEqual(db.performers[0].reviewFeedback, null);
    assert.strictEqual(db.performers[0].phone, '139');
    assert.strictEqual(ctx.body.data.resubmit, true);
    assert.ok(auditCalls.some(a => a.action === 'PERFORMER_SELF_REGISTER' && a.detail.resubmit === true));
  });

  await t('performers.review：approve 自动分配工号+落薪酬并同步工资条；reject 落反馈；非法 action → VALIDATION_ERROR', async () => {
    resetState();
    db.performers.push({ id: 'pf_1', name: '待审', status: 'pending', reviewStatus: 'pending', staffNo: null, rankGrade: null, dailyRate: null });
    await assert.rejects(() => performersCtl.review(makeCtx({ params: { id: 'pf_1' }, body: { action: 'maybe' } })), e => e.key === 'VALIDATION_ERROR');
    await assert.rejects(() => performersCtl.review(makeCtx({ params: { id: 'nope' }, body: { action: 'approve' } })), e => e.key === 'NOT_FOUND');
    const ctx = makeCtx({ params: { id: 'pf_1' }, body: { action: 'approve', dailyRate: 280, rankGrade: '二级演员' } });
    await performersCtl.review(ctx);
    assert.strictEqual(db.performers[0].status, 'active');
    assert.strictEqual(db.performers[0].reviewStatus, 'approved');
    assert.strictEqual(db.performers[0].staffNo, 'PF001'); // 自动分配
    assert.strictEqual(db.performers[0].dailyRate, 280);
    assert.strictEqual(db.performers[0].rankGrade, '二级演员');
    // reject
    db.performers.push({ id: 'pf_2', name: '待审2', status: 'pending', reviewStatus: 'pending' });
    const ctx2 = makeCtx({ params: { id: 'pf_2' }, body: { action: 'reject', feedback: '照片不清晰' } });
    await performersCtl.review(ctx2);
    assert.strictEqual(db.performers[1].reviewStatus, 'rejected');
    assert.strictEqual(db.performers[1].reviewFeedback, '照片不清晰');
  });

  await t('performers 软删 + 同步：remove 置 status=deleted；改名同步到 draft 批次工资条；dailyRate 变化按差值重算并回写批次汇总', async () => {
    resetState();
    db.performers.push({ id: 'pf_1', name: '王演员', staffNo: 'PF001', rankGrade: '一级演员', dailyRate: 200, status: 'active' });
    db.wageBatches.push({ id: 'wb_1', wageMonth: '2026-08', status: 'draft', totalPerformers: 1, totalBaseWage: 2000, totalAllowance: 0, totalBonus: 0, totalDeduction: 0, totalNetPay: 2000 });
    db.wageItems.push({ id: 'wi_1', batchId: 'wb_1', performerId: 'pf_1', performerName: '王演员', staffNo: 'PF001', rankGrade: '一级演员', attendanceDays: 10, baseWage: 2000, grossPay: 2000, totalDeduction: 0, netPay: 2000, otherDeductionNote: '{"leave":0,"absent":0,"late":0,"lateOver":0}' });
    // 改名 + 涨薪 200→250
    const ctx = makeCtx({ params: { id: 'pf_1' }, body: { name: '王名角', dailyRate: 250 } });
    await performersCtl.update(ctx);
    const item = db.wageItems[0];
    assert.strictEqual(item.performerName, '王名角');        // 字段同步
    assert.strictEqual(item.baseWage, 2500);                  // 250 × 10 重算
    assert.strictEqual(item.netPay, 2500);
    const batch = db.wageBatches[0];
    assert.strictEqual(batch.totalBaseWage, 2500);            // +500 增量
    assert.strictEqual(batch.totalNetPay, 2500);
    // 软删
    const ctx2 = makeCtx({ params: { id: 'pf_1' } });
    await performersCtl.remove(ctx2);
    assert.strictEqual(db.performers[0].status, 'deleted');
    assert.strictEqual(ctx2.body.data.status, 'deleted');
  });

  await t('performers 同步新建：新入职人员自动写入当月 draft 批次工资条（无考勤且无 dailyRate 则跳过）', async () => {
    resetState();
    db.wageBatches.push({ id: 'wb_1', wageMonth: '2026-08', status: 'draft', totalPerformers: 0, totalBaseWage: 0, totalAllowance: 0, totalBonus: 0, totalDeduction: 0, totalNetPay: 0 });
    db.wageRules.push(mkRule());
    // 甲：有考勤 10 天，无协议 → 职级 200 × 10
    for (let i = 0; i < 10; i++) db.attendance.push({ staffId: 'pf_new_a', attendanceMonth: '2026-08', attendanceType: 'full' });
    const ctx = makeCtx({ body: { id: 'pf_new_a', name: '新甲', rankGrade: '一级演员' } });
    await performersCtl.create(ctx);
    assert.strictEqual(db.wageItems.length, 1);
    assert.strictEqual(db.wageItems[0].baseWage, 2000);
    assert.strictEqual(db.wageItems[0].netPay, 2000 + 150 + 100 + 300); // +交通150+餐补100+全勤300
    assert.strictEqual(db.wageBatches[0].totalPerformers, 1);
    assert.strictEqual(db.wageBatches[0].totalNetPay, 2550);
    // 乙：无考勤且无协议 → 跳过不建
    const ctx2 = makeCtx({ body: { id: 'pf_new_b', name: '新乙' } });
    await performersCtl.create(ctx2);
    assert.strictEqual(db.wageItems.filter(x => x.performerId === 'pf_new_b').length, 0);
    assert.strictEqual(db.wageBatches[0].totalPerformers, 1);
  });

  /* ==================== attendance ==================== */
  await t('attendance.create：事假月度上限（>2次拒绝、特批放行、编辑自身不计）；月份从 date 推导；typeText 映射', async () => {
    resetState();
    db.attendance.push(
      { id: 'a1', staffId: 's1', attendanceMonth: '2026-08', attendanceType: 'PL' },
      { id: 'a2', staffId: 's1', attendanceMonth: '2026-08', attendanceType: 'PL' }
    );
    // 第 3 次事假拒绝
    await assert.rejects(
      () => attCtl.create(makeCtx({ body: { staffId: 's1', staffName: '张三', type: 'PL', date: '2026-08-20' } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('事假已达上限') >= 0
    );
    // 编辑既有事假记录（b.id=自身）不计入次数（此刻 s1 仍只有 a1/a2 两条）
    const ctx2 = makeCtx({ body: { id: 'a1', staffId: 's1', staffName: '张三', type: 'PL', date: '2026-08-05' } });
    await attCtl.create(ctx2);
    assert.strictEqual(ctx2.status, 201);
    // 特批放行（此时 s1 已有 3 条 PL，overLimitApproved=true 跳过校验）
    const ctx = makeCtx({ body: { staffId: 's1', staffName: '张三', type: 'PL', date: '2026-08-20', overLimitApproved: true } });
    await attCtl.create(ctx);
    assert.strictEqual(ctx.status, 201);
    const specRow = db.attendance[db.attendance.length - 1];
    assert.strictEqual(specRow.attendanceMonth, '2026-08'); // 从 date 推导
    assert.strictEqual(ctx.body.data.typeText, '事假');
    // 普通出勤不受限
    const ctx3 = makeCtx({ body: { staffId: 's1', staffName: '张三', type: 'full', date: '2026-08-21' } });
    await attCtl.create(ctx3);
    assert.strictEqual(ctx3.body.data.typeText, '全天班');
    // 缺必填
    await assert.rejects(() => attCtl.create(makeCtx({ body: { staffName: 'x' } })), e => e.key === 'VALIDATION_ERROR');
  });

  await t('attendance.create approvedBy：显式传入优先；缺省取登录用户名；匿名且未传 → null', async () => {
    resetState();
    // 登录态 + 显式 approvedBy：以显式值为准（团长特批代录场景）
    const ctx = makeCtx({ body: { staffId: 's1', staffName: '张三', type: 'full', approvedBy: '张团长' } });
    await attCtl.create(ctx);
    assert.strictEqual(db.attendance[0].approvedBy, '张团长');
    // 匿名 + 显式 approvedBy：同样保留
    const ctx2 = makeCtx({ state: {}, body: { staffId: 's1', staffName: '张三', type: 'full', approvedBy: '张团长' } });
    await attCtl.create(ctx2);
    assert.strictEqual(db.attendance[1].approvedBy, '张团长');
    // 登录态未传：取当前登录用户名
    const ctx3 = makeCtx({ body: { staffId: 's1', staffName: '张三', type: 'full' } });
    await attCtl.create(ctx3);
    assert.strictEqual(db.attendance[2].approvedBy, 'admin');
    // 匿名未传：null
    const ctx4 = makeCtx({ state: {}, body: { staffId: 's1', staffName: '张三', type: 'full' } });
    await attCtl.create(ctx4);
    assert.strictEqual(db.attendance[3].approvedBy, null);
  });

  await t('attendance.update：改为事假同样校验月度上限（原记录已不计）；普通字段可改；不存在 → NOT_FOUND', async () => {
    resetState();
    db.attendance.push(
      { id: 'a1', staffId: 's1', attendanceMonth: '2026-08', attendanceType: 'PL' },
      { id: 'a2', staffId: 's1', attendanceMonth: '2026-08', attendanceType: 'PL' },
      { id: 'a3', staffId: 's1', attendanceMonth: '2026-08', attendanceType: 'full', workHours: 8 }
    );
    // full → PL：当月已有 2 次 → 拒绝
    await assert.rejects(() => attCtl.update(makeCtx({ params: { id: 'a3' }, body: { type: 'PL' } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('事假已达上限') >= 0);
    // PL → PL：不触发校验（类型未变）
    const ctx = makeCtx({ params: { id: 'a1' }, body: { type: 'PL', remark: '调整个日期' } });
    await attCtl.update(ctx);
    assert.strictEqual(ctx.body.ok, true);
    // full → full + 工时修改
    const ctx2 = makeCtx({ params: { id: 'a3' }, body: { workHours: 4, remark: '半天' } });
    await attCtl.update(ctx2);
    assert.strictEqual(db.attendance[2].workHours, 4);
    await assert.rejects(() => attCtl.update(makeCtx({ params: { id: 'nope' }, body: {} })), e => e.key === 'NOT_FOUND');
  });

  await t('attendance.leaveCreate：事假累计>2次或>2天拒绝（pending+approved 都计入）；特批放行；落 pending', async () => {
    resetState();
    db.leaveApplications.push(
      { id: 'l1', staffId: 's1', leaveType: 'PL', approveStatus: 'approved', dateFrom: new Date(Date.UTC(2026, 7, 3)), totalDays: 1 },
      { id: 'l2', staffId: 's1', leaveType: 'PL', approveStatus: 'pending', dateFrom: new Date(Date.UTC(2026, 7, 10)), totalDays: 1 }
    );
    // 第 3 次 → 超次数
    await assert.rejects(
      () => attCtl.leaveCreate(makeCtx({ body: { staffId: 's1', staffName: '张三', leaveType: 'PL', reason: '家事', dateFrom: '2026-08-20', totalDays: 0.5 } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('事假已达上限') >= 0
    );
    // 清掉一条后余 1 条(1天)，新申请 1.5 天 → 1+1.5=2.5天 > 2天 → 超天数拒绝
    db.leaveApplications.splice(1, 1);
    await assert.rejects(
      () => attCtl.leaveCreate(makeCtx({ body: { staffId: 's1', staffName: '张三', leaveType: 'PL', reason: '家事', dateFrom: '2026-08-20', totalDays: 1.5 } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('2.5天') >= 0
    );
    // 特批放行 → pending
    const ctx = makeCtx({ body: { staffId: 's1', staffName: '张三', leaveType: 'PL', reason: '重病', dateFrom: '2026-08-20', totalDays: 1.5, specialApproval: true } });
    await attCtl.leaveCreate(ctx);
    assert.strictEqual(ctx.status, 201);
    assert.strictEqual(db.leaveApplications[1].approveStatus, 'pending');
    // 病假不受事假上限约束
    const ctx2 = makeCtx({ body: { staffId: 's1', staffName: '张三', leaveType: 'SL', reason: '感冒', dateFrom: '2026-08-21', totalDays: 1 } });
    await attCtl.leaveCreate(ctx2);
    assert.strictEqual(ctx2.status, 201);
    // 缺必填
    await assert.rejects(() => attCtl.leaveCreate(makeCtx({ body: { staffId: 's1' } })), e => e.key === 'VALIDATION_ERROR');
  });

  await t('attendance.leaveApprove：落审批人/时间；reject 带原因；不存在 → NOT_FOUND', async () => {
    resetState();
    db.leaveApplications.push({ id: 'l1', staffId: 's1', staffName: '张三', leaveType: 'PL', approveStatus: 'pending', totalDays: 1, dateFrom: new Date() });
    const ctx = makeCtx({ params: { id: 'l1' }, body: { status: 'approved' } });
    await attCtl.leaveApprove(ctx);
    assert.strictEqual(db.leaveApplications[0].approveStatus, 'approved');
    assert.strictEqual(db.leaveApplications[0].approverName, 'admin');
    assert.strictEqual(db.leaveApplications[0].approverId, 'acc_1');
    assert.ok(db.leaveApplications[0].approvedAt instanceof Date);
    db.leaveApplications.push({ id: 'l2', staffId: 's2', staffName: '李四', leaveType: 'AL', approveStatus: 'pending', totalDays: 2, dateFrom: new Date() });
    const ctx2 = makeCtx({ params: { id: 'l2' }, body: { status: 'rejected', rejectReason: '演出旺季' } });
    await attCtl.leaveApprove(ctx2);
    assert.strictEqual(db.leaveApplications[1].approveStatus, 'rejected');
    assert.strictEqual(db.leaveApplications[1].rejectReason, '演出旺季');
    await assert.rejects(() => attCtl.leaveApprove(makeCtx({ params: { id: 'nope' }, body: {} })), e => e.key === 'NOT_FOUND');
  });

  /* ==================== schedules ==================== */
  await t('schedules.create：date/orderId 必填；venue 拆分/类型入 remark；默认 19:30、场次 +3h；toApi 字段映射', async () => {
    resetState();
    await assert.rejects(() => schedCtl.create(makeCtx({ body: {} })), e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('date') >= 0);
    await assert.rejects(() => schedCtl.create(makeCtx({ body: { date: '2026-10-05' } })), e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('orderId') >= 0);
    const ctx = makeCtx({ body: { date: '2026-10-05', orderId: 'ord_1', title: '火焰驹', type: '本戏', venue: '秦安县 · 文化广场', feeAmount: 8000, audienceSize: 500 } });
    await schedCtl.create(ctx);
    assert.strictEqual(ctx.status, 201);
    const row = db.schedules[0];
    assert.ok(/^SCH-/.test(row.scheduleNo));
    assert.strictEqual(row.status, 'draft');
    assert.strictEqual(row.venueDistrict, '秦安县');
    assert.strictEqual(row.venueAddress, '文化广场');
    assert.strictEqual(row.remark, '类型:本戏');
    assert.strictEqual(row.createdBy, 'admin');
    assert.strictEqual(row.performanceTime, null); // 未传 time
    // toApi 映射
    const d = ctx.body.data;
    assert.strictEqual(d.date, '2026-10-05');
    assert.strictEqual(d.time, '');
    assert.strictEqual(d.type, '本戏');
    assert.strictEqual(d.venue, '秦安县 · 文化广场');
    assert.strictEqual(d.statusText, '待确认');
    assert.strictEqual(d.feeAmount, 8000);
    assert.ok(typeof d.week === 'string' && d.week.length === 3);
    // 默认散客省份/城市
    assert.strictEqual(d.venueProvince, '甘肃省');
    assert.strictEqual(d.venueCity, '天水市');
  });

  await t('schedules.update：completedDate 自动置 completed+考勤状态；部分字段补丁；不存在 → NOT_FOUND', async () => {
    resetState();
    db.schedules.push({ id: 'sch_1', scheduleNo: 'SCH-1', status: 'confirmed', scheduleDateStart: new Date('2026-10-05T19:30:00'), performanceTime: '19:30', venueDistrict: '秦安县', venueAddress: '某村' });
    const ctx = makeCtx({ params: { id: 'sch_1' }, body: { completedDate: '2026-10-05', actualAttendance: 480, feeAmount: 8000 } });
    await schedCtl.update(ctx);
    assert.strictEqual(db.schedules[0].status, 'completed');
    assert.strictEqual(db.schedules[0].attendanceStatus, '已完成');
    assert.ok(db.schedules[0].completedDate instanceof Date);
    assert.strictEqual(db.schedules[0].actualAttendance, 480);
    assert.strictEqual(ctx.body.data.statusText, '已完成');
    // 仅改备注不触发状态变化
    const ctx2 = makeCtx({ params: { id: 'sch_1' }, body: { remark: '观众反响热烈' } });
    await schedCtl.update(ctx2);
    assert.strictEqual(db.schedules[0].status, 'completed'); // 保持
    assert.strictEqual(db.schedules[0].remark, '观众反响热烈');
    await assert.rejects(() => schedCtl.update(makeCtx({ params: { id: 'nope' }, body: {} })), e => e.key === 'NOT_FOUND');
  });

  await t('schedules.stats：按月聚合状态计数/费用/观众；范围外数据排除', async () => {
    resetState();
    db.schedules.push(
      { scheduleDateStart: new Date(2026, 7, 5), status: 'completed', feeAmount: 8000, audienceSize: 500, actualAttendance: 480 },
      { scheduleDateStart: new Date(2026, 7, 12), status: 'confirmed', feeAmount: 6000, audienceSize: 300 },
      { scheduleDateStart: new Date(2026, 7, 20), status: 'cancelled', feeAmount: 0 },
      { scheduleDateStart: new Date(2026, 6, 30), status: 'completed', feeAmount: 9999 } // 7月，排除
    );
    const ctx = makeCtx({ query: { year: '2026', month: '8' } });
    await schedCtl.stats(ctx);
    const d = ctx.body.data;
    assert.strictEqual(d.total, 3);
    assert.strictEqual(d.completed, 1);
    assert.strictEqual(d.confirmed, 1);
    assert.strictEqual(d.cancelled, 1);
    assert.strictEqual(d.totalFee, 14000);
    assert.strictEqual(d.totalAudience, 800);
    assert.strictEqual(d.totalAttendance, 480);
  });

  /* ==================== inventory ==================== */
  await t('inventory.createRecord 校验：缺字段/非法 opType/quantity≤0/物品不存在', async () => {
    resetState();
    await assert.rejects(() => invCtl.createRecord(makeCtx({ body: {} })), e => e.key === 'VALIDATION_ERROR');
    await assert.rejects(() => invCtl.createRecord(makeCtx({ body: { itemId: 'x', opType: 'fly', quantity: 1 } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('opType') >= 0);
    await assert.rejects(() => invCtl.createRecord(makeCtx({ body: { itemId: 'x', opType: 'out', quantity: 0 } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('大于 0') >= 0);
    await assert.rejects(() => invCtl.createRecord(makeCtx({ body: { itemId: 'nope', opType: 'out', quantity: 1 } })), e => e.key === 'NOT_FOUND');
  });

  await t('inventory.createRecord 事务联动：in/out 增减数量；borrow 置借用状态；return 复位；原子扣减库存不足 → CONFLICT 且数量不变', async () => {
    resetState();
    db.inventoryItems.push({ id: 'it_1', name: '蟒袍', quantity: 5, status: 'in_stock', borrower: null, expectedReturnDate: null });
    // 出库 3
    const c1 = makeCtx({ body: { itemId: 'it_1', opType: 'out', quantity: 3 } });
    await invCtl.createRecord(c1);
    assert.strictEqual(c1.status, 201);
    assert.strictEqual(db.inventoryItems[0].quantity, 2);
    assert.strictEqual(db.inventoryRecords[0].opType, 'out');
    assert.strictEqual(db.inventoryRecords[0].operator, '管理员'); // realName 优先
    // 出库 5 > 库存 2 → CONFLICT，数量不变、无新记录
    await assert.rejects(() => invCtl.createRecord(makeCtx({ body: { itemId: 'it_1', opType: 'out', quantity: 5 } })),
      e => e.key === 'CONFLICT' && e.message.indexOf('库存不足') >= 0);
    assert.strictEqual(db.inventoryItems[0].quantity, 2);
    assert.strictEqual(db.inventoryRecords.length, 1);
    // 借出 → borrowed + borrower
    const c2 = makeCtx({ body: { itemId: 'it_1', opType: 'borrow', quantity: 1, borrower: '服装组', expectedReturnDate: '2026-10-01' } });
    await invCtl.createRecord(c2);
    assert.strictEqual(db.inventoryItems[0].quantity, 1);
    assert.strictEqual(db.inventoryItems[0].status, 'borrowed');
    assert.strictEqual(db.inventoryItems[0].borrower, '服装组');
    // 归还 → in_stock + 清空借用人
    const c3 = makeCtx({ body: { itemId: 'it_1', opType: 'return', quantity: 1 } });
    await invCtl.createRecord(c3);
    assert.strictEqual(db.inventoryItems[0].quantity, 2);
    assert.strictEqual(db.inventoryItems[0].status, 'in_stock');
    assert.strictEqual(db.inventoryItems[0].borrower, null);
    // 报损 → 扣减
    const c4 = makeCtx({ body: { itemId: 'it_1', opType: 'loss', quantity: 2, remark: '破损' } });
    await invCtl.createRecord(c4);
    assert.strictEqual(db.inventoryItems[0].quantity, 0);
    assert.strictEqual(db.inventoryRecords.length, 4);
  });

  await t('inventory.updateItem 数量调整：必须填原因+非负整数；自动登记 in/out 台账；delta=0 不产生记录；纯字段修改走普通补丁', async () => {
    resetState();
    db.inventoryItems.push({ id: 'it_1', name: '靠旗', quantity: 10, status: 'in_stock', location: '仓库A' });
    await assert.rejects(() => invCtl.updateItem(makeCtx({ params: { id: 'it_1' }, body: { quantity: 2.5, adjustReason: 'x' } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('非负整数') >= 0);
    await assert.rejects(() => invCtl.updateItem(makeCtx({ params: { id: 'it_1' }, body: { quantity: 5 } })),
      e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('调整原因') >= 0);
    // delta=0：无需原因，不产生台账
    const c0 = makeCtx({ params: { id: 'it_1' }, body: { quantity: 10 } });
    await invCtl.updateItem(c0);
    assert.strictEqual(db.inventoryRecords.length, 0);
    // 下调 10→3：出账 7
    const c1 = makeCtx({ params: { id: 'it_1' }, body: { quantity: 3, adjustReason: '演出损耗' } });
    await invCtl.updateItem(c1);
    assert.strictEqual(db.inventoryItems[0].quantity, 3);
    assert.strictEqual(db.inventoryRecords.length, 1);
    assert.strictEqual(db.inventoryRecords[0].opType, 'out');
    assert.strictEqual(db.inventoryRecords[0].quantity, 7);
    assert.strictEqual(db.inventoryRecords[0].remark, '库存调整：演出损耗');
    // 上调 3→13：入账 10
    const c2 = makeCtx({ params: { id: 'it_1' }, body: { quantity: 13, adjustReason: '采购入库' } });
    await invCtl.updateItem(c2);
    assert.strictEqual(db.inventoryItems[0].quantity, 13);
    assert.strictEqual(db.inventoryRecords[1].opType, 'in');
    assert.strictEqual(db.inventoryRecords[1].quantity, 10);
    // 纯字段修改
    const c3 = makeCtx({ params: { id: 'it_1' }, body: { location: '仓库B' } });
    await invCtl.updateItem(c3);
    assert.strictEqual(db.inventoryItems[0].location, '仓库B');
    assert.strictEqual(db.inventoryRecords.length, 2);
    await assert.rejects(() => invCtl.updateItem(makeCtx({ params: { id: 'nope' }, body: {} })), e => e.key === 'NOT_FOUND');
  });

  await t('inventory.removeItem：级联删除该物品全部台账记录 → 204', async () => {
    resetState();
    db.inventoryItems.push({ id: 'it_1', name: '马鞭', quantity: 1 });
    db.inventoryRecords.push({ id: 'r1', itemId: 'it_1' }, { id: 'r2', itemId: 'it_1' }, { id: 'r3', itemId: 'other' });
    const ctx = makeCtx({ params: { id: 'it_1' } });
    await invCtl.removeItem(ctx);
    assert.strictEqual(ctx.status, 204);
    assert.strictEqual(db.inventoryItems.length, 0);
    assert.strictEqual(db.inventoryRecords.length, 1); // 仅删本物品
    await assert.rejects(() => invCtl.removeItem(makeCtx({ params: { id: 'it_1' } })), e => e.key === 'NOT_FOUND');
  });

  /* ==================== plays ==================== */
  await t('plays.create/update/remove：title 必填；is_hot→isHot 映射且未知字段不进补丁；删除级联 playCast', async () => {
    resetState();
    await assert.rejects(() => playsCtl.create(makeCtx({ body: {} })), e => e.key === 'VALIDATION_ERROR' && e.message.indexOf('title') >= 0);
    const ctx = makeCtx({ body: { title: '火焰驹', genre: '本戏', durationMinutes: '150' } });
    await playsCtl.create(ctx);
    assert.strictEqual(ctx.status, 201);
    assert.strictEqual(db.plays[0].status, 'active');
    assert.strictEqual(db.plays[0].createdBy, 'acc_1');
    assert.strictEqual(db.plays[0].durationMinutes, 150); // 数字归一
    // update：is_hot 映射 isHot
    const ctx2 = makeCtx({ params: { id: db.plays[0].id }, body: { is_hot: true, hackerField: 'x', title: '火焰驹（复排）' } });
    await playsCtl.update(ctx2);
    assert.strictEqual(db.plays[0].isHot, true);
    assert.strictEqual(db.plays[0].title, '火焰驹（复排）');
    assert.strictEqual(db.plays[0].hackerField, undefined);
    await assert.rejects(() => playsCtl.update(makeCtx({ params: { id: 'nope' }, body: {} })), e => e.key === 'NOT_FOUND');
    // remove 级联
    db.playCasts.push({ id: 'pc1', playId: db.plays[0].id }, { id: 'pc2', playId: 'other' });
    const ctx3 = makeCtx({ params: { id: db.plays[0].id } });
    await playsCtl.remove(ctx3);
    assert.strictEqual(db.plays.length, 0);
    assert.strictEqual(db.playCasts.length, 1);
    assert.strictEqual(ctx3.body.data.id, ctx.body.data.id);
    await assert.rejects(() => playsCtl.remove(makeCtx({ params: { id: 'nope' } })), e => e.key === 'NOT_FOUND');
  });

  /* ==================== roles ==================== */
  await t('roles：createRole 默认值；removeRole 角色下有账号 → CONFLICT，空角色级联删权限映射；assignPermissions 过滤无效权限', async () => {
    resetState();
    const ctx = makeCtx({ body: { name: '财务主管' } });
    await rolesCtl.createRole(ctx);
    assert.strictEqual(ctx.status, 201);
    assert.strictEqual(db.roles[0].level, 100);
    assert.strictEqual(db.roles[0].status, 'active');
    // 有账号引用 → 禁删
    db.userRoles.push({ accountId: 'acc_9', roleId: db.roles[0].id });
    await assert.rejects(() => rolesCtl.removeRole(makeCtx({ params: { id: db.roles[0].id } })),
      e => e.key === 'CONFLICT' && e.message.indexOf('仍有账号') >= 0);
    db.userRoles.length = 0;
    // 赋权：无效 permissionId 被过滤
    db.permissions.push({ id: 'p1', code: 'fin:view' }, { id: 'p2', code: 'fin:edit' });
    db.rolePermissions.push({ roleId: db.roles[0].id, permissionId: 'p0' }); // 旧映射待清除
    const ctx2 = makeCtx({ params: { id: db.roles[0].id }, body: { permissionIds: ['p1', 'p2', 'px_ghost'] } });
    await rolesCtl.assignPermissions(ctx2);
    assert.strictEqual(db.rolePermissions.length, 2); // p0 已删，px_ghost 未写入
    assert.ok(db.rolePermissions.every(rp => rp.permissionId === 'p1' || rp.permissionId === 'p2'));
    assert.strictEqual(ctx2.body.data.id, db.roles[0].id);
    // 空角色可删
    const ctx3 = makeCtx({ params: { id: db.roles[0].id } });
    await rolesCtl.removeRole(ctx3);
    assert.strictEqual(db.roles.length, 0);
    assert.strictEqual(db.rolePermissions.length, 0); // 级联
  });

  /* ==================== customers ==================== */
  await t('customers.create：默认 personal/联系人回填本人；主联系人唯一（显式优先，否则首条兜底）；contacts+tags 子表写入', async () => {
    resetState();
    const ctx = makeCtx({
      body: {
        customerName: '刘总', phone: '139',
        contacts: [{ name: '助理A', phone: '1' }, { name: '助理B', phone: '2', isPrimary: true }],
        tags: ['VIP', '庙会']
      }
    });
    await customersCtl.create(ctx);
    assert.strictEqual(ctx.status, 201);
    assert.strictEqual(db.customers[0].customerType, 'personal');
    assert.strictEqual(db.customers[0].contactPerson, '刘总'); // 默认回填
    assert.strictEqual(db.customers[0].createdBy, 'acc_1');
    assert.strictEqual(db.customerContacts.length, 2);
    // 第二条显式 isPrimary → 唯一主联系人，首条让位
    assert.strictEqual(db.customerContacts[0].isPrimary, false);
    assert.strictEqual(db.customerContacts[1].isPrimary, true);
    assert.strictEqual(db.customerTags.length, 2);
    // 全部未显式指定 → 首条兜底为主，其余 false
    const ctx2 = makeCtx({
      body: {
        customerName: '马总', phone: '138',
        contacts: [{ name: '联系人一', phone: 'a' }, { name: '联系人二', phone: 'b' }, { name: '联系人三', phone: 'c' }]
      }
    });
    await customersCtl.create(ctx2);
    const rows = db.customerContacts.slice(2);
    assert.deepStrictEqual(rows.map(r => r.isPrimary), [true, false, false]);
    // 多条显式 isPrimary → 第一个显式项生效，其余互斥为 false
    const ctx3 = makeCtx({
      body: {
        customerName: '杨总', phone: '137',
        contacts: [{ name: '一', phone: '1', isPrimary: true }, { name: '二', phone: '2', isPrimary: true }]
      }
    });
    await customersCtl.create(ctx3);
    assert.deepStrictEqual(db.customerContacts.slice(5).map(r => r.isPrimary), [true, false]);
  });

  await t('customers.remove：有订单/预约关联 → 软删保留数据；无关联 → 硬删并级联 tags/contacts', async () => {
    resetState();
    db.customers.push({ id: 'c1', customerName: '有订单' }, { id: 'c2', customerName: '无关联' });
    db.orders.push({ id: 'o1', customerId: 'c1' });
    db.customerTags.push({ customerId: 'c2', tag: 'x' });
    db.customerContacts.push({ customerId: 'c2', name: 'y' });
    // 有订单 → 软删
    const ctx = makeCtx({ params: { id: 'c1' } });
    await customersCtl.remove(ctx);
    assert.strictEqual(db.customers[0].status, 'deleted');
    assert.strictEqual(ctx.body.data.status, 'deleted');
    assert.ok(auditCalls.some(a => a.action === 'CUSTOMER_SOFT_DELETE'));
    // 有预约同样软删
    db.appointments.push({ id: 'ap_x', customerId: 'c2b' });
    db.customers.push({ id: 'c2b', customerName: '有预约' });
    const ctx2 = makeCtx({ params: { id: 'c2b' } });
    await customersCtl.remove(ctx2);
    assert.strictEqual(db.customers.find(c => c.id === 'c2b').status, 'deleted');
    // 无关联 → 硬删 + 级联
    const ctx3 = makeCtx({ params: { id: 'c2' } });
    await customersCtl.remove(ctx3);
    assert.strictEqual(ctx3.body.data.deleted, true);
    assert.strictEqual(db.customers.find(c => c.id === 'c2'), undefined);
    assert.strictEqual(db.customerTags.length, 0);
    assert.strictEqual(db.customerContacts.length, 0);
  });

  /* ==================== 汇总 ==================== */
  console.warn = origWarn;
  console.error = origError;
  const failed = results.filter(r => !r.ok);
  console.log('\n========================================');
  console.log('总计 ' + results.length + ' 项：✓ ' + (results.length - failed.length) + ' 通过，✗ ' + failed.length + ' 失败');
  if (failed.length) {
    failed.forEach(r => { console.error('\n[FAIL] ' + r.name); console.error(r.err && r.err.stack || r.err); });
    process.exit(1);
  }
  console.log('全部通过');
  process.exit(0);
})().catch(e => { console.warn = origWarn; console.error = origError; console.error(e); process.exit(1); });

