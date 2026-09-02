'use strict';

/**
 * prisma/seed.js —— 幂等种子数据（与 init_v1.0_mysql.sql 种子一致）
 * npm run db:seed  或  prisma db seed
 * 作用：在空库中插入 settings / admin / roles / wage_rules 等最小必需数据
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');

const prisma = new PrismaClient();
const now = Date.now();

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;

const settings = [
  ['set_troupe_name', 'troupeName', '秦安县秦剧团文化演出有限公司', 'troupe', '剧团全称（合同/发票/公开页显示）', true],
  ['set_troupe_phone', 'troupePhone', '13993839833', 'troupe', '对外联系电话', true],
  ['set_troupe_address', 'troupeAddress', '甘肃省天水市秦安县陇城镇张沟村', 'troupe', '注册地址', true],
  ['set_troupe_tax', 'troupeTaxNo', '91620522MA1234567X（请替换为真实18位）', 'finance', '开票抬头统一社会信用代码', false],
  ['set_troupe_legal', 'troupeLegalPerson', '张维民', 'troupe', '法人姓名', false],
  ['set_fin_double_above', 'financeDoubleCheckAbove', '10000', 'finance', '单笔凭证>=此金额强制双人复核(M-15)', false],
  ['set_booking_sms_verify', 'bookingSmsVerifyRequired', '1', 'booking', '公开预约是否强制短信验手机号(S-8)', false],
  ['set_booking_captcha', 'bookingCaptchaRequired', '1', 'booking', '公开预约是否强制行为验证码(M-10)', false]
];

const roles = [
  ['role_super', '超级管理员', '全权限（团长+CTO，<3人）', 999],
  ['role_ops', '运营调度', '预约/订单/档期/演员表/考勤 可写', 800],
  ['role_director', '团长/业务副团长', '全局只读 + 订单审批/档期锁', 700],
  ['role_finance_admin', '财务主管', '全财务权限 + 月度关账', 500],
  ['role_finance_checker', '财务复核岗', '复核制单/关账/对账 只可写不可制单', 600],
  ['role_finance_maker', '财务制单岗', '只能制单，不能复核本人凭证（M-15双角色）', 550],
  ['role_finance_cashier', '出纳岗', '收付款/银行回单上传，无记账权限', 520],
  ['role_finance_view', '财务只读', '只读财务报表/凭证', 510],
  ['role_staff', '普通员工', '个人考勤/工资条/请假提交 只读', 100]
];

const wageRules = [
  ['wrule_ap', 'A+', 1800, 800, 400, 300, 400, 500, 200, '2.0000', 60, 60, 500, '0.0800'],
  ['wrule_a', 'A', 1200, 500, 250, 180, 250, 300, 150, '1.5000', 40, 50, 300, '0.0600'],
  ['wrule_b', 'B', 800, 300, 150, 120, 180, 220, 100, '1.3000', 30, 40, 200, '0.0500'],
  ['wrule_c', 'C', 500, 150, 80, 60, 120, 160, 60, '1.1000', 30, 30, 100, '0.0300']
];

async function main() {
  console.log('[seed] 开始执行种子数据（幂等）...');

  // 1. settings
  for (const [id, key, value, group, description, isPublic] of settings) {
    await prisma.setting.upsert({
      where: { id },
      create: {
        id,
        key,
        value,
        group,
        description,
        isPublic,
        updatedBy: 'sys_init',
        ts: BigInt(now)
      },
      update: { value, updatedBy: 'sys_init', ts: BigInt(now) }
    });
  }
  console.log(`[seed] settings: ${settings.length} 条`);

  // 2. roles
  for (const [id, name, description, level] of roles) {
    await prisma.role.upsert({
      where: { id },
      create: { id, name, description, level, createdBy: 'sys_init', ts: BigInt(now) },
      update: { description, level, ts: BigInt(now) }
    });
  }
  console.log(`[seed] roles: ${roles.length} 条`);

  // 3. super admin（占位 bcrypt hash："admin123456"）
  const hash = await bcrypt.hash('admin123456', BCRYPT_ROUNDS);
  await prisma.accountsV2.upsert({
    where: { id: 'acc_superadmin_001' },
    create: {
      id: 'acc_superadmin_001',
      username: 'admin',
      passwordHash: hash,
      realName: '超级管理员-首次登录强制改密码',
      role: 'super_admin',
      phone: '13993839833',
      email: 'admin@qaxqjt.cn',
      forcePwdChange: true,
      status: 'active',
      createdBy: 'sys_init',
      ts: BigInt(now)
    },
    update: { forcePwdChange: true, ts: BigInt(now) }
  });
  await prisma.userRole.upsert({
    where: { accountId_roleId: { accountId: 'acc_superadmin_001', roleId: 'role_super' } },
    create: { accountId: 'acc_superadmin_001', roleId: 'role_super', assignedBy: 'sys_init', ts: BigInt(now) },
    update: {}
  });
  console.log('[seed] 初始管理员 admin / admin123456（请登录后立即修改）');

  // 4. wage rules
  for (const [
    id,
    grade,
    base,
    chief,
    sup,
    ens,
    crew,
    tech,
    night,
    mult,
    trans,
    meal,
    fullBonus,
    bonusRate
  ] of wageRules) {
    await prisma.wageRulesV1.upsert({
      where: { id },
      create: {
        id,
        rankGrade: grade,
        baseDailyStandard: base,
        chiefRoleAllowance: chief,
        supportingRoleBase: sup,
        ensembleBase: ens,
        crewBandBase: crew,
        techDancerBase: tech,
        nightShowBonus: night,
        holidayMultiplier: mult,
        transportAllowance: trans,
        mealAllowance: meal,
        fullAttendanceBonus: fullBonus,
        performanceBonusRate: bonusRate,
        effectiveFromDate: new Date('2026-01-01'),
        createdBy: 'sys_init',
        ts: BigInt(now)
      },
      update: { ts: BigInt(now) }
    });
  }
  console.log(`[seed] wage rules: ${wageRules.length} 条`);

  // 5. data_migrations 标记
  await prisma.dataMigration.upsert({
    where: { id: 'v1.0_seed' },
    create: {
      id: 'v1.0_seed',
      batch: 1,
      description: 'Prisma seed 幂等种子初始化',
      executedBy: 'prisma db seed',
      expectedRowCount: 22,
      actualRowCount: 22,
      dryRun: false,
      status: 'success',
      ts: BigInt(now)
    },
    update: { status: 'success', ts: BigInt(now) }
  });

  console.log('[seed] 完成');
}

main()
  .catch(e => {
    console.error('[seed] FAILED:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
