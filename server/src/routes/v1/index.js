'use strict';

/**
 * src/routes/v1/index.js —— 聚合 v1 路由
 * 契约：E-5 后端接口对接方案 · 7 大模块 RESTful CRUD
 */
const Router = require('@koa/router');
const { Joi, validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const authCtrl = require('../../controllers/auth');
const accountsCtrl = require('../../controllers/accounts');
const rolesCtrl = require('../../controllers/roles');
const auditCtrl = require('../../controllers/audit');
const customersCtrl = require('../../controllers/customers');
const appointmentsCtrl = require('../../controllers/appointments');

/* ====== 演职人员 performers 路由注册（v1）====== */
const performersCtrl = require('../../controllers/performers');

const v1 = new Router({ prefix: '/v1' });

// ========== 健康检查（无鉴权，Docker HEALTHCHECK 使用）==========
v1.get('/healthz', async ctx => {
  ctx.status = 200;
  ctx.body = {
    ok: true,
    service: 'qaxqjt-api',
    version: process.env.APP_VERSION || 'V2026.8.3',
    env: process.env.NODE_ENV,
    ts: Date.now()
  };
});

// ========== auth ==========
v1.post(
  '/auth/login',
  validate({
    body: Joi.object({
      username: Joi.string().trim().min(3).max(64).required(),
      password: Joi.string().min(6).max(128).required(),
      captcha: Joi.string().allow('').optional()
    })
  }),
  authCtrl.login
);
v1.post(
  '/auth/refresh',
  validate({ body: Joi.object({ refreshToken: Joi.string().required() }) }),
  authCtrl.refresh
);
v1.post('/auth/logout', authCtrl.logout);
v1.get('/auth/me', authCtrl.me);

// ========== 扫码登录 ==========
v1.post('/auth/qrcode/create', authCtrl.qrcodeCreate);
v1.get('/auth/qrcode/status/:token', authCtrl.qrcodeStatus);
v1.post(
  '/auth/qrcode/confirm',
  validate({
    body: Joi.object({
      token: Joi.string().required(),
      username: Joi.string().trim().min(3).max(64).required(),
      password: Joi.string().min(6).max(128).required()
    })
  }),
  authCtrl.qrcodeConfirm
);

// ========== accounts（IAM）==========
v1.get(
  '/accounts',
  validate({ paginate: true, query: Joi.object({ role: Joi.string().optional(), status: Joi.string().optional() }) }),
  requireRole(['super_admin', 'ops', 'director']),
  accountsCtrl.list
);
v1.post(
  '/accounts',
  validate({
    body: Joi.object({
      username: Joi.string().min(3).max(64).required(),
      password: Joi.string().min(8).max(128).required(),
      realName: Joi.string().min(2).max(50).required(),
      role: Joi.string().max(32).default('staff'),
      phone: Joi.string().allow('').optional(),
      email: Joi.string().email().allow('').optional(),
      status: Joi.string().default('active'),
      forcePwdChange: Joi.boolean().default(true)
    })
  }),
  requireRole('super_admin'),
  accountsCtrl.create
);
v1.get('/accounts/:id', requireRole(['super_admin', 'ops', 'director']), accountsCtrl.detail);
v1.patch(
  '/accounts/:id',
  validate({
    body: Joi.object({
      realName: Joi.string().optional(),
      role: Joi.string().optional(),
      phone: Joi.string().allow('').optional(),
      email: Joi.string().email().allow('').optional(),
      password: Joi.string().min(8).max(128).optional(),
      status: Joi.string().optional(),
      forcePwdChange: Joi.boolean().optional()
    }).min(1)
  }),
  requireRole('super_admin'),
  accountsCtrl.update
);
v1.delete('/accounts/:id', requireRole('super_admin'), accountsCtrl.remove);
v1.post(
  '/accounts/:id/reset-password',
  validate({ body: Joi.object({ password: Joi.string().min(8).max(128).required() }) }),
  requireRole('super_admin'),
  accountsCtrl.resetPwd
);
v1.patch(
  '/accounts/me/password',
  validate({
    body: Joi.object({
      oldPassword: Joi.string().min(6).max(128).required(),
      newPassword: Joi.string().min(8).max(128).required()
    })
  }),
  accountsCtrl.changeMyPwd
);

// ========== roles ==========
v1.get('/roles', validate({ paginate: true }), requireRole(['super_admin', 'director']), rolesCtrl.listRoles);
v1.post(
  '/roles',
  validate({
    body: Joi.object({
      name: Joi.string().min(2).max(64).required(),
      description: Joi.string().allow('').optional(),
      level: Joi.number().integer().default(100),
      status: Joi.string().default('active')
    })
  }),
  requireRole('super_admin'),
  rolesCtrl.createRole
);
v1.patch(
  '/roles/:id',
  validate({
    body: Joi.object({
      name: Joi.string().optional(),
      description: Joi.string().allow('').optional(),
      level: Joi.number().integer().optional(),
      status: Joi.string().optional()
    }).min(1)
  }),
  requireRole('super_admin'),
  rolesCtrl.updateRole
);
v1.delete('/roles/:id', requireRole('super_admin'), rolesCtrl.removeRole);
v1.put(
  '/roles/:id/permissions',
  validate({ body: Joi.object({ permissionIds: Joi.array().items(Joi.string()).default([]) }) }),
  requireRole('super_admin'),
  rolesCtrl.assignPermissions
);

v1.get(
  '/permissions',
  validate({ paginate: true, query: Joi.object({ module: Joi.string().optional() }) }),
  requireRole(['super_admin', 'director']),
  rolesCtrl.listPermissions
);

// ========== audit logs ==========
v1.get(
  '/audit-logs',
  validate({
    paginate: true,
    query: Joi.object({
      module: Joi.string().optional(),
      action: Joi.string().optional(),
      accountId: Joi.string().optional(),
      username: Joi.string().optional(),
      from: Joi.string().optional(),
      to: Joi.string().optional()
    })
  }),
  requireRole(['super_admin', 'director']),
  auditCtrl.listAuditLogs
);

// ========== customers ==========
v1.get(
  '/customers',
  validate({
    paginate: true,
    query: Joi.object({
      customerType: Joi.string().optional(),
      level: Joi.string().optional(),
      status: Joi.string().optional()
    })
  }),
  requireRole(['super_admin', 'ops', 'director', 'finance_view']),
  customersCtrl.list
);
v1.post(
  '/customers',
  validate({
    body: Joi.object({
      customerType: Joi.string().valid('personal', 'organization').default('personal'),
      customerName: Joi.string().min(2).max(100).required(),
      organization: Joi.string().allow('').optional(),
      contactPerson: Joi.string().optional(),
      phone: Joi.string().min(7).max(20).required(),
      backupPhone: Joi.string().allow('').optional(),
      email: Joi.string().email().allow('').optional(),
      region: Joi.string().allow('').optional(),
      address: Joi.string().allow('').optional(),
      sourceChannel: Joi.string().optional(),
      level: Joi.string().optional(),
      creditLevel: Joi.string().optional(),
      remark: Joi.string().allow('').optional(),
      tags: Joi.array().items(Joi.string()).optional(),
      contacts: Joi.array()
        .items(
          Joi.object({
            name: Joi.string().required(),
            phone: Joi.string().required(),
            position: Joi.string().optional(),
            isPrimary: Joi.boolean().optional()
          })
        )
        .optional(),
      firstContactDate: Joi.string().optional(),
      status: Joi.string().default('active')
    })
  }),
  requireRole(['super_admin', 'ops']),
  customersCtrl.create
);
v1.get('/customers/:id', requireRole(['super_admin', 'ops', 'director', 'finance_view']), customersCtrl.detail);
v1.patch(
  '/customers/:id',
  validate({
    body: Joi.object({
      customerType: Joi.string().optional(),
      customerName: Joi.string().optional(),
      organization: Joi.string().allow('').optional(),
      contactPerson: Joi.string().optional(),
      phone: Joi.string().optional(),
      backupPhone: Joi.string().allow('').optional(),
      email: Joi.string().email().allow('').optional(),
      region: Joi.string().allow('').optional(),
      address: Joi.string().allow('').optional(),
      sourceChannel: Joi.string().optional(),
      level: Joi.string().optional(),
      creditLevel: Joi.string().optional(),
      remark: Joi.string().allow('').optional(),
      status: Joi.string().optional(),
      firstContactDate: Joi.string().optional()
    }).min(1)
  }),
  requireRole(['super_admin', 'ops']),
  customersCtrl.update
);
v1.delete('/customers/:id', requireRole('super_admin'), customersCtrl.remove);

// ========== appointments（公开页可匿名创建，其余操作需要权限）==========
v1.get(
  '/appointments',
  validate({
    paginate: true,
    query: Joi.object({
      status: Joi.string().optional(),
      packageType: Joi.string().optional(),
      source: Joi.string().optional(),
      customerId: Joi.string().optional(),
      fromDate: Joi.string().optional(),
      toDate: Joi.string().optional()
    })
  }),
  requireRole(['super_admin', 'ops', 'director', 'finance_view']),
  appointmentsCtrl.list
);
v1.get(
  '/appointments/stats',
  requireRole(['super_admin', 'ops', 'director', 'finance_view']),
  appointmentsCtrl.stats
);
v1.post(
  '/appointments',
  validate({
    body: Joi.object({
      customerName: Joi.string().min(2).max(100).required(),
      customerType: Joi.string().optional(),
      organization: Joi.string().allow('').optional(),
      contactPerson: Joi.string().optional(),
      phone: Joi.string().min(7).max(20).required(),
      backupPhone: Joi.string().allow('').optional(),
      email: Joi.string().email().allow('').optional(),
      region: Joi.string().allow('').optional(),
      address: Joi.string().allow('').optional(),
      sourceChannel: Joi.string().optional(),
      preferredStartDate: Joi.string().required(),
      preferredEndDate: Joi.string().allow('').optional(),
      performanceCount: Joi.number().integer().min(1).max(180).required(),
      packageType: Joi.string().valid('temple_fair', 'cultural_tourism', 'campus_tour', 'custom').optional(),
      venueProvince: Joi.string().allow('').optional(),
      venueCity: Joi.string().allow('').optional(),
      venueDistrict: Joi.string().allow('').optional(),
      venueAddress: Joi.string().allow('').optional(),
      estimatedBudget: Joi.number().precision(2).optional(),
      totalPerformanceFee: Joi.number().precision(2).optional(),
      depositAmount: Joi.number().precision(2).optional(),
      paymentTerms: Joi.string().allow('').optional(),
      specialRequirements: Joi.string().allow('').optional(),
      remarkInternal: Joi.string().allow('').optional(),
      smsVerifiedFlag: Joi.boolean().default(false),
      plays: Joi.array()
        .items(
          Joi.object({
            playId: Joi.string().required(),
            sortOrder: Joi.number().integer().optional(),
            performanceDate: Joi.string().optional(),
            performanceTime: Joi.string().optional(),
            note: Joi.string().allow('').optional()
          })
        )
        .optional()
    })
  }),
  appointmentsCtrl.create
);
v1.get(
  '/appointments/:id',
  requireRole(['super_admin', 'ops', 'director', 'finance_view']),
  appointmentsCtrl.detail
);
v1.patch(
  '/appointments/:id',
  validate({
    body: Joi.object({
      customerName: Joi.string().optional(),
      organization: Joi.string().allow('').optional(),
      phone: Joi.string().optional(),
      contactPerson: Joi.string().optional(),
      preferredStartDate: Joi.string().optional(),
      preferredEndDate: Joi.string().allow('').optional(),
      performanceCount: Joi.number().integer().optional(),
      packageType: Joi.string().valid('temple_fair', 'cultural_tourism', 'campus_tour', 'custom').optional(),
      venueProvince: Joi.string().optional(),
      venueCity: Joi.string().optional(),
      venueDistrict: Joi.string().optional(),
      venueAddress: Joi.string().optional(),
      estimatedBudget: Joi.number().precision(2).allow(null).optional(),
      totalPerformanceFee: Joi.number().precision(2).allow(null).optional(),
      depositAmount: Joi.number().precision(2).allow(null).optional(),
      paymentTerms: Joi.string().optional(),
      specialRequirements: Joi.string().allow('').optional(),
      remarkInternal: Joi.string().allow('').optional(),
      assignedAccountId: Joi.string().allow('').optional(),
      smsVerifiedFlag: Joi.boolean().optional(),
      sourceChannel: Joi.string().optional(),
      status: Joi.string().valid('pending', 'confirmed', 'rejected', 'cancelled', 'converted').optional(),
      rejectReason: Joi.string().allow('').optional(),
      convertedOrderId: Joi.string().allow('').optional(),
      plays: Joi.array()
        .items(
          Joi.object({
            playId: Joi.string().required(),
            sortOrder: Joi.number().integer().optional(),
            performanceDate: Joi.string().optional(),
            performanceTime: Joi.string().optional(),
            note: Joi.string().allow('').optional()
          })
        )
        .optional()
    }).min(1)
  }),
  requireRole(['super_admin', 'ops', 'director']),
  appointmentsCtrl.update
);
v1.delete(
  '/appointments/:id',
  requireRole(['super_admin', 'ops']),
  appointmentsCtrl.remove
);
v1.post(
  '/appointments/:id/transition',
  validate({
    body: Joi.object({
      to: Joi.string().valid('confirmed', 'rejected', 'cancelled', 'converted', 'pending').required(),
      reason: Joi.string().allow('').optional()
    })
  }),
  requireRole(['super_admin', 'ops', 'director']),
  appointmentsCtrl.transition
);
v1.get(
  '/appointments/:id/audit-logs',
  requireRole(['super_admin', 'ops', 'director']),
  appointmentsCtrl.listAudits
);
v1.get(
  '/appointments/:id/plays',
  requireRole(['super_admin', 'ops', 'director', 'finance_view']),
  appointmentsCtrl.listPlays
);
v1.put(
  '/appointments/:id/plays',
  requireRole(['super_admin', 'ops']),
  appointmentsCtrl.setPlays
);

// ========== performers（演职人员花名册）==========
v1.get(
  '/performers',
  validate(
    {
      paginate: true,
      query: Joi.object({
        keyword: Joi.string().allow('').max(100).optional(),
        status: Joi.string().max(32).optional(),
        gender: Joi.string().max(16).optional(),
        primaryRole: Joi.string().max(64).optional(),
        rankGrade: Joi.string().max(64).optional(),
        employmentType: Joi.string().max(32).optional(),
        department: Joi.string().max(32).optional(),
        dept: Joi.string().max(32).optional(),
        role: Joi.string().max(64).optional(),
        scope: Joi.string().max(16).optional()
      })
    },
    { stripUnknown: false }
  ),
  requireRole(['super_admin', 'ops', 'director']),
  performersCtrl.list
);
v1.post(
  '/performers',
  validate({
    body: Joi.object({
      staffNo: Joi.string().trim().max(32).optional(),
      name: Joi.string().trim().min(2).max(50).required(),
      gender: Joi.string().valid('男', '女', 'other').allow('').optional(),
      birthDate: Joi.string().allow('').optional(),
      phone: Joi.string().allow('').optional(),
      idCardNo: Joi.string().allow('').optional(),
      rankGrade: Joi.string().allow('').optional(),
      primaryRole: Joi.string().allow('').optional(),
      hireDate: Joi.string().allow('').optional(),
      employmentType: Joi.string().allow('').optional(),
      bankAccount: Joi.string().allow('').optional(),
      bankName: Joi.string().allow('').optional(),
      socialSecurityNo: Joi.string().allow('').optional(),
      status: Joi.string().default('active'),
      remark: Joi.string().allow('').optional(),
      avatarUrl: Joi.string().allow('').optional()
    })
  }),
  requireRole(['super_admin', 'ops']),
  performersCtrl.create
);
v1.get('/performers/:id', requireRole(['super_admin', 'ops', 'director']), performersCtrl.detail);
v1.patch(
  '/performers/:id',
  validate({
    body: Joi.object({
      staffNo: Joi.string().trim().max(32).optional(),
      name: Joi.string().trim().min(2).max(50).optional(),
      gender: Joi.string().valid('男', '女', 'other').allow('').optional(),
      birthDate: Joi.string().allow('').optional(),
      phone: Joi.string().allow('').optional(),
      idCardNo: Joi.string().allow('').optional(),
      rankGrade: Joi.string().allow('').optional(),
      primaryRole: Joi.string().allow('').optional(),
      hireDate: Joi.string().allow('').optional(),
      employmentType: Joi.string().allow('').optional(),
      bankAccount: Joi.string().allow('').optional(),
      bankName: Joi.string().allow('').optional(),
      socialSecurityNo: Joi.string().allow('').optional(),
      status: Joi.string().optional(),
      remark: Joi.string().allow('').optional(),
      avatarUrl: Joi.string().allow('').optional()
    }).min(1)
  }),
  requireRole(['super_admin', 'ops']),
  performersCtrl.update
);
v1.delete('/performers/:id', requireRole('super_admin'), performersCtrl.remove);
/* ====== END 演职人员路由 ====== */

/* ====== 订单 orders 路由注册（v1）====== */
const ordersCtrl = require('../../controllers/orders');

v1.get(
  '/orders',
  validate({
    paginate: true,
    query: Joi.object({
      keyword: Joi.string().allow('').max(100).optional(),
      status: Joi.string().max(32).optional(),
      orderType: Joi.string().max(32).optional(),
      customerId: Joi.string().max(64).optional(),
      fromDate: Joi.string().optional(),
      toDate: Joi.string().optional()
    })
  }),
  requireRole(['super_admin', 'ops', 'director', 'finance_view']),
  ordersCtrl.list
);
v1.get('/orders/stats', requireRole(['super_admin', 'ops', 'director', 'finance_view']), ordersCtrl.stats);
v1.post(
  '/orders',
  validate({
    body: Joi.object({
      customerName: Joi.string().min(2).max(100).required(),
      phone: Joi.string().min(7).max(20).required(),
      organization: Joi.string().allow('').optional(),
      orderType: Joi.string().max(32).optional(),
      appointmentId: Joi.string().max(64).allow('').optional(),
      orderDate: Joi.string().optional(),
      totalAmount: Joi.number().precision(2).optional(),
      discountAmount: Joi.number().precision(2).optional(),
      finalAmount: Joi.number().precision(2).optional(),
      depositAmount: Joi.number().precision(2).optional(),
      paidAmount: Joi.number().precision(2).optional(),
      invoiceTitle: Joi.string().allow('').optional(),
      taxNo: Joi.string().allow('').optional(),
      contractNo: Joi.string().allow('').optional(),
      contractUrl: Joi.string().allow('').optional(),
      salesmanName: Joi.string().allow('').optional(),
      performanceStartDate: Joi.string().allow('').optional(),
      performanceEndDate: Joi.string().allow('').optional(),
      performanceCount: Joi.number().integer().min(0).max(365).optional(),
      venueFullAddress: Joi.string().allow('').optional(),
      specialRequirements: Joi.string().allow('').optional(),
      internalRemark: Joi.string().allow('').optional(),
      items: Joi.array()
        .items(
          Joi.object({
            itemType: Joi.string().max(32).optional(),
            playId: Joi.string().allow('').optional(),
            itemName: Joi.string().max(100).optional(),
            quantity: Joi.number().integer().min(1).optional(),
            unitPrice: Joi.number().precision(2).optional(),
            subtotal: Joi.number().precision(2).optional(),
            performanceDate: Joi.string().optional(),
            remark: Joi.string().allow('').optional()
          })
        )
        .optional()
    })
  }),
  requireRole(['super_admin', 'ops']),
  ordersCtrl.create
);
v1.get('/orders/:id', requireRole(['super_admin', 'ops', 'director', 'finance_view']), ordersCtrl.detail);
v1.patch(
  '/orders/:id',
  validate({
    body: Joi.object({
      customerName: Joi.string().min(2).max(100).optional(),
      phone: Joi.string().min(7).max(20).optional(),
      organization: Joi.string().allow('').optional(),
      orderType: Joi.string().max(32).optional(),
      orderDate: Joi.string().optional(),
      totalAmount: Joi.number().precision(2).optional(),
      discountAmount: Joi.number().precision(2).optional(),
      finalAmount: Joi.number().precision(2).optional(),
      depositAmount: Joi.number().precision(2).optional(),
      paidAmount: Joi.number().precision(2).optional(),
      invoiceTitle: Joi.string().allow('').optional(),
      taxNo: Joi.string().allow('').optional(),
      contractNo: Joi.string().allow('').optional(),
      contractUrl: Joi.string().allow('').optional(),
      salesmanName: Joi.string().allow('').optional(),
      performanceStartDate: Joi.string().allow('').optional(),
      performanceEndDate: Joi.string().allow('').optional(),
      performanceCount: Joi.number().integer().min(0).max(365).optional(),
      venueFullAddress: Joi.string().allow('').optional(),
      specialRequirements: Joi.string().allow('').optional(),
      internalRemark: Joi.string().allow('').optional(),
      cancellationReason: Joi.string().allow('').optional(),
      status: Joi.string()
        .valid('draft', 'confirmed', 'partial_paid', 'paid', 'performance', 'completed', 'cancelled', 'refunded')
        .optional(),
      items: Joi.array()
        .items(
          Joi.object({
            itemType: Joi.string().max(32).optional(),
            playId: Joi.string().allow('').optional(),
            itemName: Joi.string().max(100).optional(),
            quantity: Joi.number().integer().min(1).optional(),
            unitPrice: Joi.number().precision(2).optional(),
            subtotal: Joi.number().precision(2).optional(),
            performanceDate: Joi.string().optional(),
            remark: Joi.string().allow('').optional()
          })
        )
        .optional()
    }).min(1)
  }),
  requireRole(['super_admin', 'ops', 'director']),
  ordersCtrl.update
);
v1.delete('/orders/:id', requireRole('super_admin'), ordersCtrl.remove);
v1.post(
  '/orders/:id/transition',
  validate({
    body: Joi.object({
      to: Joi.string()
        .valid('draft', 'confirmed', 'partial_paid', 'paid', 'performance', 'completed', 'cancelled', 'refunded')
        .required(),
      reason: Joi.string().allow('').optional()
    })
  }),
  requireRole(['super_admin', 'ops', 'director']),
  ordersCtrl.transition
);
/* ====== END 订单路由 ====== */

/* ====== 财务台账 fin 路由注册（v1）====== */
const financeCtrl = require('../../controllers/finance');

const FIN_READ_ROLES = ['super_admin', 'director', 'finance_view', 'finance_admin', 'finance_checker', 'finance_maker', 'finance_cashier'];
const FIN_WRITE_ROLES = ['super_admin', 'finance_admin', 'finance_maker'];

v1.get(
  '/fin/ledger',
  validate({
    paginate: true,
    query: Joi.object({
      keyword: Joi.string().allow('').max(100).optional(),
      voucherType: Joi.string().max(32).optional(),
      voucherCategory: Joi.string().max(32).optional(),
      status: Joi.string().max(32).optional(),
      orderId: Joi.string().max(64).optional(),
      fromDate: Joi.string().optional(),
      toDate: Joi.string().optional()
    })
  }),
  requireRole(FIN_READ_ROLES),
  financeCtrl.list
);
v1.get('/fin/summary', requireRole(FIN_READ_ROLES), financeCtrl.summary);
v1.post(
  '/fin/ledger',
  validate({
    body: Joi.object({
      voucherNo: Joi.string().max(64).allow('').optional(),
      voucherDate: Joi.string().optional(),
      voucherType: Joi.string().valid('receipt', 'payment', 'transfer', 'adjustment').optional(),
      voucherCategory: Joi.string().max(32).allow('').optional(),
      summary: Joi.string().min(2).max(200).required(),
      orderId: Joi.string().max(64).allow('').optional(),
      relatedBatchId: Joi.string().max(64).allow('').optional(),
      debitAmount: Joi.number().precision(2).min(0).optional(),
      creditAmount: Joi.number().precision(2).min(0).optional(),
      balanceAmount: Joi.number().precision(2).optional(),
      offsetAccount: Joi.string().max(100).allow('').optional(),
      cashFlowType: Joi.string().max(32).allow('').optional(),
      cashFlowAmount: Joi.number().precision(2).optional(),
      status: Joi.string().max(32).optional(),
      doubleCheckRequired: Joi.boolean().optional(),
      remark: Joi.string().allow('').optional()
    })
  }),
  requireRole(FIN_WRITE_ROLES),
  financeCtrl.create
);
v1.get('/fin/ledger/:id', requireRole(FIN_READ_ROLES), financeCtrl.detail);
v1.patch(
  '/fin/ledger/:id',
  validate({
    body: Joi.object({
      voucherDate: Joi.string().optional(),
      voucherType: Joi.string().valid('receipt', 'payment', 'transfer', 'adjustment').optional(),
      voucherCategory: Joi.string().max(32).allow('').optional(),
      summary: Joi.string().min(2).max(200).optional(),
      orderId: Joi.string().max(64).allow('').optional(),
      debitAmount: Joi.number().precision(2).min(0).optional(),
      creditAmount: Joi.number().precision(2).min(0).optional(),
      balanceAmount: Joi.number().precision(2).optional(),
      offsetAccount: Joi.string().max(100).allow('').optional(),
      cashFlowType: Joi.string().max(32).allow('').optional(),
      cashFlowAmount: Joi.number().precision(2).optional(),
      status: Joi.string().max(32).optional(),
      remark: Joi.string().allow('').optional()
    }).min(1)
  }),
  requireRole(FIN_WRITE_ROLES),
  financeCtrl.update
);
v1.delete('/fin/ledger/:id', requireRole(['super_admin', 'finance_admin']), financeCtrl.remove);
/* ====== END 财务路由 ====== */

/* ====== 库存 inventory 路由注册（v1）====== */
const inventoryCtrl = require('../../controllers/inventory');

v1.get(
  '/inventory/items',
  validate({
    paginate: true,
    query: Joi.object({
      keyword: Joi.string().allow('').max(100).optional(),
      category: Joi.string().max(32).optional(),
      status: Joi.string().max(32).optional()
    })
  }),
  requireRole(['super_admin', 'ops', 'director']),
  inventoryCtrl.listItems
);
v1.post(
  '/inventory/items',
  validate({
    body: Joi.object({
      sku: Joi.string().max(64).allow('').optional(),
      name: Joi.string().min(1).max(100).required(),
      category: Joi.string().max(32).allow('').optional(),
      specModel: Joi.string().max(100).allow('').optional(),
      quantity: Joi.number().integer().min(0).optional(),
      safetyStock: Joi.number().integer().min(0).optional(),
      unit: Joi.string().max(32).allow('').optional(),
      unitPrice: Joi.number().precision(2).min(0).optional(),
      location: Joi.string().max(100).allow('').optional(),
      status: Joi.string().max(32).optional(),
      borrower: Joi.string().max(64).allow('').optional(),
      expectedReturnDate: Joi.string().allow('').optional(),
      lastCheckDate: Joi.string().allow('').optional(),
      imageUrl: Joi.string().allow('').optional(),
      remark: Joi.string().allow('').optional()
    })
  }),
  requireRole(['super_admin', 'ops']),
  inventoryCtrl.createItem
);
v1.get('/inventory/items/:id', requireRole(['super_admin', 'ops', 'director']), inventoryCtrl.detailItem);
v1.patch(
  '/inventory/items/:id',
  validate({
    body: Joi.object({
      sku: Joi.string().max(64).allow('').optional(),
      name: Joi.string().min(1).max(100).optional(),
      category: Joi.string().max(32).allow('').optional(),
      specModel: Joi.string().max(100).allow('').optional(),
      quantity: Joi.number().integer().min(0).optional(),
      safetyStock: Joi.number().integer().min(0).optional(),
      unit: Joi.string().max(32).allow('').optional(),
      unitPrice: Joi.number().precision(2).min(0).optional(),
      location: Joi.string().max(100).allow('').optional(),
      status: Joi.string().max(32).optional(),
      borrower: Joi.string().max(64).allow('').optional(),
      expectedReturnDate: Joi.string().allow('').optional(),
      lastCheckDate: Joi.string().allow('').optional(),
      imageUrl: Joi.string().allow('').optional(),
      remark: Joi.string().allow('').optional()
    }).min(1)
  }),
  requireRole(['super_admin', 'ops']),
  inventoryCtrl.updateItem
);
v1.delete('/inventory/items/:id', requireRole('super_admin'), inventoryCtrl.removeItem);
v1.get(
  '/inventory/records',
  validate({
    paginate: true,
    query: Joi.object({
      itemId: Joi.string().max(64).optional(),
      opType: Joi.string().max(32).optional(),
      fromDate: Joi.string().optional(),
      toDate: Joi.string().optional()
    })
  }),
  requireRole(['super_admin', 'ops', 'director']),
  inventoryCtrl.listRecords
);
v1.post(
  '/inventory/records',
  validate({
    body: Joi.object({
      itemId: Joi.string().max(64).required(),
      opType: Joi.string().valid('in', 'out', 'borrow', 'return', 'loss').required(),
      quantity: Joi.number().integer().min(1).required(),
      opDate: Joi.string().optional(),
      relatedScheduleId: Joi.string().max(64).allow('').optional(),
      operator: Joi.string().max(64).allow('').optional(),
      borrower: Joi.string().max(64).allow('').optional(),
      expectedReturnDate: Joi.string().allow('').optional(),
      playTitle: Joi.string().max(100).allow('').optional(),
      usage: Joi.string().max(200).allow('').optional(),
      remark: Joi.string().max(200).allow('').optional()
    })
  }),
  requireRole(['super_admin', 'ops']),
  inventoryCtrl.createRecord
);
/* ====== END 库存路由 ====== */

/* ====== 剧目 plays 路由注册（v1）====== */
const playsCtrl = require('../../controllers/plays');
v1.get(
  '/plays',
  validate({ paginate: true, query: Joi.object({ keyword: Joi.string().optional(), genre: Joi.string().optional(), status: Joi.string().optional() }) }),
  requireRole(['super_admin', 'ops', 'director', 'finance_view']),
  playsCtrl.list
);
v1.post(
  '/plays',
  validate({
    body: Joi.object({
      title: Joi.string().min(1).max(200).required(),
      playCode: Joi.string().allow('').optional(),
      subtitle: Joi.string().allow('').optional(),
      genre: Joi.string().allow('').optional(),
      durationMinutes: Joi.number().integer().optional(),
      author: Joi.string().allow('').optional(),
      posterUrl: Joi.string().allow('').optional(),
      synopsis: Joi.string().allow('').optional(),
      castSummary: Joi.string().allow('').optional(),
      difficultyLevel: Joi.string().allow('').optional(),
      status: Joi.string().default('active')
    })
  }),
  requireRole(['super_admin', 'ops', 'director']),
  playsCtrl.create
);
v1.get('/plays/:id', requireRole(['super_admin', 'ops', 'director', 'finance_view']), playsCtrl.detail);
v1.patch(
  '/plays/:id',
  requireRole(['super_admin', 'ops', 'director']),
  playsCtrl.update
);
v1.delete('/plays/:id', requireRole(['super_admin']), playsCtrl.remove);

/* ====== 剧目分类 play-categories 路由注册（v20260919 移植）====== */
const playCatCtrl = require('../../controllers/play-categories');
v1.get(
  '/play-categories',
  requireRole(['super_admin', 'ops', 'director', 'finance_view']),
  playCatCtrl.list
);
v1.post(
  '/play-categories',
  validate({
    body: Joi.object({
      name: Joi.string().min(1).max(30).required(),
      sortOrder: Joi.number().integer().positive().optional(),
      status: Joi.string().valid('active', 'disabled').optional(),
      note: Joi.string().allow('').max(200).optional()
    })
  }),
  requireRole(['super_admin', 'ops', 'director']),
  playCatCtrl.create
);
v1.patch(
  '/play-categories/:id',
  validate({
    body: Joi.object({
      name: Joi.string().min(1).max(30).optional(),
      sortOrder: Joi.number().integer().positive().optional(),
      status: Joi.string().valid('active', 'disabled').optional(),
      note: Joi.string().allow('').max(200).optional()
    })
  }),
  requireRole(['super_admin', 'ops', 'director']),
  playCatCtrl.update
);
v1.delete('/play-categories/:id', requireRole(['super_admin']), playCatCtrl.remove);

/* ====== 内容管理 content 路由注册（v1）====== */
const contentCtrl = require('../../controllers/content');
v1.get(
  '/contents',
  validate({ paginate: true, query: Joi.object({ keyword: Joi.string().optional(), type: Joi.string().optional(), publishStatus: Joi.string().optional() }) }),
  requireRole(['super_admin', 'ops', 'director', 'finance_view']),
  contentCtrl.list
);
v1.post(
  '/contents',
  validate({
    body: Joi.object({
      type: Joi.string().valid('news', 'article', 'notice', 'gallery', 'video', 'banner').required(),
      title: Joi.string().min(1).max(200).required(),
      subtitle: Joi.string().allow('').optional(),
      coverImage: Joi.string().allow('').optional(),
      contentBody: Joi.string().allow('').optional(),
      summary: Joi.string().allow('').optional(),
      publishStatus: Joi.string().default('draft'),
      publishDate: Joi.string().optional(),
      authorName: Joi.string().allow('').optional(),
      sortWeight: Joi.number().integer().optional(),
      tagsJson: Joi.string().allow('').optional(),
      extraJson: Joi.string().allow('').optional()
    })
  }),
  requireRole(['super_admin', 'ops']),
  contentCtrl.create
);
v1.get('/contents/:id', requireRole(['super_admin', 'ops', 'director', 'finance_view']), contentCtrl.detail);
v1.patch(
  '/contents/:id',
  requireRole(['super_admin', 'ops']),
  contentCtrl.update
);
v1.delete('/contents/:id', requireRole('super_admin'), contentCtrl.remove);

/* ====== 排期 schedules 路由注册（v1）====== */
const schedCtrl = require('../../controllers/schedules');
v1.get(
  '/schedules',
  validate({ paginate: true, query: Joi.object({
    keyword: Joi.string().optional(),
    status: Joi.string().optional(),
    year: Joi.number().integer().optional(),
    month: Joi.number().integer().optional(),
    dateFrom: Joi.string().optional(),
    dateTo: Joi.string().optional()
  }).unknown(true) }),
  requireRole(['super_admin', 'ops', 'director', 'finance_view']),
  schedCtrl.list
);
v1.post(
  '/schedules',
  requireRole(['super_admin', 'ops', 'director']),
  schedCtrl.create
);
v1.get('/schedules/stats', requireRole(['super_admin', 'ops', 'director', 'finance_view']), schedCtrl.stats);
v1.get('/schedules/:id', requireRole(['super_admin', 'ops', 'director', 'finance_view']), schedCtrl.detail);
v1.patch(
  '/schedules/:id',
  requireRole(['super_admin', 'ops', 'director']),
  schedCtrl.update
);
v1.delete('/schedules/:id', requireRole('super_admin'), schedCtrl.remove);

/* ====== 考勤 attendance 路由注册（v1）====== */
const attCtrl = require('../../controllers/attendance');
v1.get(
  '/attendance',
  validate({ paginate: true, query: Joi.object({ keyword: Joi.string().optional(), staffId: Joi.string().optional(), month: Joi.string().optional(), type: Joi.string().optional() }).unknown(true) }),
  requireRole(['super_admin', 'ops', 'director', 'finance_view']),
  attCtrl.list
);
v1.get('/attendance/stats', requireRole(['super_admin', 'ops', 'director', 'finance_view']), attCtrl.stats);
// 请假申请（v20260919：必须在 /attendance/:id 之前注册，否则 leaves 被 :id 参数路由吞掉返回 404）
v1.get(
  '/attendance/leaves',
  validate({ paginate: true, query: Joi.object({ keyword: Joi.string().optional(), staffId: Joi.string().optional(), status: Joi.string().optional() }).unknown(true) }),
  requireRole(['super_admin', 'ops', 'director', 'finance_view']),
  attCtrl.leaveList
);
v1.post(
  '/attendance/leaves',
  requireRole(['super_admin', 'ops', 'director']),
  attCtrl.leaveCreate
);
v1.patch(
  '/attendance/leaves/:id/approve',
  requireRole(['super_admin', 'ops', 'director']),
  attCtrl.leaveApprove
);
v1.get('/attendance/:id', requireRole(['super_admin', 'ops', 'director', 'finance_view']), attCtrl.detail);
v1.post(
  '/attendance',
  requireRole(['super_admin', 'ops', 'director']),
  attCtrl.create
);
v1.patch(
  '/attendance/:id',
  requireRole(['super_admin', 'ops', 'director']),
  attCtrl.update
);
v1.delete('/attendance/:id', requireRole(['super_admin']), attCtrl.remove);

/* ====== 工资 wages 路由注册（v20260908h：无底薪工资条）====== */
const wagesCtrl = require('../../controllers/wages');
v1.get(
  '/wages',
  validate({ paginate: true, query: Joi.object({ keyword: Joi.string().optional(), month: Joi.string().optional(), batchId: Joi.string().optional(), performerId: Joi.string().optional(), staffNo: Joi.string().optional() }).unknown(true) }),
  requireRole(['super_admin', 'ops', 'director', 'finance_view']),
  wagesCtrl.list
);
v1.get('/wages/:id', requireRole(['super_admin', 'ops', 'director', 'finance_view']), wagesCtrl.detail);
v1.post('/wages', requireRole(['super_admin', 'ops', 'director']), wagesCtrl.create);
v1.patch('/wages/:id', requireRole(['super_admin', 'ops', 'director']), wagesCtrl.update);
v1.delete('/wages/:id', requireRole('super_admin'), wagesCtrl.remove);
v1.get('/wage-batches', requireRole(['super_admin', 'ops', 'director', 'finance_view']), wagesCtrl.batchList);
v1.post('/wage-batches', requireRole(['super_admin', 'ops', 'director']), wagesCtrl.batchCreate);
v1.post('/wage-batches/:id/confirm', requireRole(['super_admin', 'ops', 'director']), wagesCtrl.batchConfirm);
v1.post('/wage-batches/:id/post', requireRole(['super_admin', 'ops', 'director']), wagesCtrl.batchPost);
v1.get('/wage-rules', requireRole(['super_admin', 'ops', 'director', 'finance_view']), wagesCtrl.rulesList);
v1.get('/wage-rules/:rankGrade', requireRole(['super_admin', 'ops', 'director', 'finance_view']), wagesCtrl.rulesDetail);

/* ====== 演员表 cast-sheets 路由注册（v1）====== */
const castSheetsCtrl = require('../../controllers/cast-sheets');
v1.get(
  '/cast-sheets',
  validate({
    paginate: true,
    query: Joi.object({
      scheduleId: Joi.string().optional(),
      playId: Joi.string().optional(),
      status: Joi.string().optional()
    }).unknown(true)
  }),
  requireRole(['super_admin', 'ops', 'director']),
  castSheetsCtrl.list
);
v1.get('/cast-sheets/:id', requireRole(['super_admin', 'ops', 'director']), castSheetsCtrl.detail);
v1.post('/cast-sheets', requireRole(['super_admin', 'ops', 'director']), castSheetsCtrl.create);
v1.patch('/cast-sheets/:id', requireRole(['super_admin', 'ops', 'director']), castSheetsCtrl.update);
v1.delete('/cast-sheets/:id', requireRole(['super_admin']), castSheetsCtrl.remove);

/* ====== 系统设置 system-settings 路由注册（v1）====== */
const settCtrl = require('../../controllers/system-settings');
v1.get(
  '/system/settings',
  validate({ paginate: true, query: Joi.object({ keyword: Joi.string().optional(), group: Joi.string().optional() }).unknown(true) }),
  requireRole(['super_admin', 'ops']),
  settCtrl.list
);
v1.get('/system/info', requireRole(['super_admin', 'ops']), settCtrl.systemInfo);
v1.get('/system/settings/key/:key', requireRole(['super_admin', 'ops', 'director', 'finance_view']), settCtrl.getByKey);
v1.get('/system/settings/:id', requireRole(['super_admin', 'ops']), settCtrl.detail);
v1.post(
  '/system/settings',
  requireRole(['super_admin']),
  settCtrl.create
);
v1.patch(
  '/system/settings/:id',
  requireRole(['super_admin']),
  settCtrl.update
);
v1.post(
  '/system/settings/batch',
  requireRole(['super_admin']),
  settCtrl.batchUpdate
);
v1.delete('/system/settings/:id', requireRole('super_admin'), settCtrl.remove);

module.exports = v1;
