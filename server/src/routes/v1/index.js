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

module.exports = v1;
