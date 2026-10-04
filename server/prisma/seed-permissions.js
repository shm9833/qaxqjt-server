'use strict';
/**
 * prisma/seed-permissions.js —— 权限字典种子（幂等 upsert）
 *
 * 背景：生产库 permissions 表为空，导致：
 *   1. GET /v1/permissions 返回空数组，前端角色权限弹窗无字典可渲染；
 *   2. PUT /v1/roles/:id/permissions 会先用 permission.findMany 校验 id 列表，
 *      空表导致所有提交被静默丢弃（valid.length = 0）。
 *
 * 本脚本：
 *   1. 按 12 个内置权限点 upsert 权限字典（与前端 accounts.html __ALL_PERMS 对齐）；
 *   2. 将全量权限授予「超级管理员」角色（role_super，描述为"全权限"）；
 *   3. 重复执行安全（upsert / createMany skipDuplicates）。
 *
 * 用法：node prisma/seed-permissions.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 与 admin/accounts.html 中 __ALL_PERMS 保持一致的权限点定义
const PERMISSIONS = [
  { id: 'perm_accounts_manage',   code: 'accounts.manage',   name: '账号权限管理', module: 'iam' },
  { id: 'perm_finance_manage',    code: 'finance.manage',    name: '财务收支管理', module: 'finance' },
  { id: 'perm_schedule_manage',   code: 'schedule.manage',   name: '档期排期管理', module: 'schedule' },
  { id: 'perm_orders_audit',      code: 'orders.audit',      name: '预约单审核确认', module: 'orders' },
  { id: 'perm_operas_manage',     code: 'operas.manage',     name: '剧目曲目维护', module: 'operas' },
  { id: 'perm_staff_manage',      code: 'staff.manage',      name: '人员档案管理', module: 'staff' },
  { id: 'perm_attendance_manage', code: 'attendance.manage', name: '考勤薪资管理', module: 'attendance' },
  { id: 'perm_reports_view',      code: 'reports.view',      name: '统计报表查看', module: 'reports' },
  { id: 'perm_inventory_manage',  code: 'inventory.manage',  name: '道具设备管理', module: 'inventory' },
  { id: 'perm_content_manage',    code: 'content.manage',    name: '内容图文维护', module: 'content' },
  { id: 'perm_system_config',     code: 'system.config',     name: '系统配置管理', module: 'system' },
  { id: 'perm_logs_audit',        code: 'logs.audit',        name: '操作日志审计', module: 'logs' }
];

async function main() {
  const now = BigInt(Date.now());
  let upserted = 0;
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { name: p.name, module: p.module },
      create: { id: p.id, code: p.code, name: p.name, module: p.module, status: 'active', ts: now }
    });
    upserted++;
  }
  console.log('[seed-permissions] 权限字典 upsert 完成:', upserted, '条');

  // 超级管理员授予全量权限（幂等：先清后建）
  const superRole = await prisma.role.findUnique({ where: { id: 'role_super' } });
  if (superRole) {
    await prisma.rolePermission.deleteMany({ where: { roleId: superRole.id } });
    await prisma.rolePermission.createMany({
      data: PERMISSIONS.map(p => ({ roleId: superRole.id, permissionId: p.id, ts: now }))
    });
    console.log('[seed-permissions] 已为「' + superRole.name + '」授予全量', PERMISSIONS.length, '项权限');
  } else {
    console.warn('[seed-permissions] 未找到 role_super 角色，跳过超管授权');
  }
}

main()
  .catch(e => { console.error('[seed-permissions] 失败:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
