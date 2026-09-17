/**
 * prisma/seed-wages.js —— 幂等录入真实工资条数据（无底薪，按场次/出勤计算）
 * 用法：node -r dotenv/config prisma/seed-wages.js
 *
 * 数据规模：5 个 performer × 1 个月（2026-08）× 1 个工资批次 × 5 条工资明细
 * 幂等：upsert（by batchNo + performerId + batchId）
 */
const { PrismaClient } = require('@prisma/client');
const { nanoid } = require('nanoid');

const prisma = new PrismaClient();
const now = Date.now();

async function main() {
  console.log('[seed-wages] 开始录入工资条数据（幂等）...');

  // 1. 确认 WageRulesV1 有规则
  const rules = await prisma.wageRulesV1.findMany();
  console.log('[seed-wages] 工资规则数: ' + rules.length);
  if (!rules.length) {
    console.error('[seed-wages] FATAL: WageRulesV1 表为空，请先执行 prisma/seed.js');
    process.exit(1);
  }
  const ruleMap = {};
  rules.forEach(r => { ruleMap[r.rankGrade] = r; });

  // 2. 取 5 个 active 演职人员
  const performers = await prisma.performersDbV1.findMany({
    where: { status: 'active' },
    take: 5,
    orderBy: { staffNo: 'asc' }
  });
  console.log('[seed-wages] 演职人员数: ' + performers.length);
  if (!performers.length) {
    console.error('[seed-wages] FATAL: PerformersDbV1 表无 active 人员，请先执行 prisma/seed.js');
    process.exit(1);
  }

  // 3. upsert 工资批次（2026-08）
  const batchNo = 'WB-202608-001';
  const wageMonth = '2026-08';
  const batchId = 'wbatch_202608_demo';
  const batch = await prisma.wageBatchesV1.upsert({
    where: { batchNo: batchNo },
    create: {
      id: batchId,
      batchNo: batchNo,
      wageMonth: wageMonth,
      status: 'confirmed',
      performanceCount: 4,
      totalPerformers: performers.length,
      totalBaseWage: 0,
      totalAllowance: 0,
      totalBonus: 0,
      totalDeduction: 0,
      totalNetPay: 0,
      confirmedBy: 'sys_seed',
      confirmedAt: new Date(),
      postedToLedger: false,
      createdBy: 'sys_seed',
      ts: BigInt(now)
    },
    update: { status: 'confirmed', confirmedBy: 'sys_seed', confirmedAt: new Date(), ts: BigInt(now) }
  });
  console.log('[seed-wages] 工资批次: ' + batch.batchNo + ' (id=' + batch.id + ')');

  // 4. 按演职人员 upsert 工资明细
  let totalBase = 0, totalAllow = 0, totalBonus = 0, totalDeduct = 0, totalNet = 0;
  for (let i = 0; i < performers.length; i++) {
    const p = performers[i];
    const rule = ruleMap[p.rankGrade] || ruleMap['C'] || rules[0];
    if (!rule) { console.warn('[seed-wages] 跳过 ' + p.name + '：无对应工资规则'); continue; }

    // 真实数据：2026-08 月，每人 22 个出勤日（含 4 个夜场）
    const attDays = 22;
    const nights = 4;
    const baseWage = Number(rule.baseDailyStandard) * attDays; // 无底薪：日薪 × 出勤天
    const nightSubsidy = Number(rule.nightShowBonus) * nights; // 夜场补贴
    const transportAllowance = Number(rule.transportAllowance) * attDays;
    const mealAllowance = Number(rule.mealAllowance) * attDays;
    const fullBonus = Number(rule.fullAttendanceBonus); // 全勤奖
    const performanceBonus = Math.round(baseWage * Number(rule.performanceBonusRate)); // 演出奖金
    // 扣款
    const socialInsurance = Math.round(baseWage * 0.08); // 社保 8%
    const housingFund = Math.round(baseWage * 0.05); // 公积金 5%
    const tax = Math.round(Math.max(0, (baseWage + fullBonus + performanceBonus - 5000) * 0.03)); // 个税（起征点 5000，3%）
    // 4 项细分扣款（事假/旷工/迟到/早退）—— 全勤时均为 0
    const breakdown = { leave: 0, absent: 0, late: 0, early: 0 };
    const otherDeduction = 0;
    const otherDeductionNote = JSON.stringify(breakdown);

    const grossPay = baseWage + nightSubsidy + transportAllowance + mealAllowance + fullBonus + performanceBonus;
    const totalDeduction = socialInsurance + housingFund + tax + otherDeduction;
    const netPay = grossPay - totalDeduction;

    // 把 nightCount 编码到 otherAllowanceNote（JSON），wages.js toApi 会解码
    const otherAllowanceNote = JSON.stringify({ nightCount: nights });

    totalBase += baseWage;
    totalAllow += nightSubsidy + transportAllowance + mealAllowance;
    totalBonus += fullBonus + performanceBonus;
    totalDeduct += totalDeduction;
    totalNet += netPay;

    const itemId = 'witem_202608_' + (p.staffNo || ('p' + i)).replace(/[^a-zA-Z0-9]/g, '');

    await prisma.wageItemsV1.upsert({
      where: { id: itemId },
      create: {
        id: itemId,
        batchId: batch.id,
        performerId: p.id,
        performerName: p.name,
        staffNo: p.staffNo,
        rankGrade: p.rankGrade,
        attendanceDays: attDays,
        baseWage: baseWage,
        chiefRoleTotal: 0,
        supportingRoleTotal: 0,
        nightShowBonus: nightSubsidy,
        holidayBonus: 0,
        transportAllowance: transportAllowance,
        mealAllowance: mealAllowance,
        fullAttendanceBonus: fullBonus,
        performanceBonus: performanceBonus,
        otherAllowance: 0,
        otherAllowanceNote: otherAllowanceNote,
        socialInsuranceDeduct: socialInsurance,
        housingFundDeduct: housingFund,
        taxDeduct: tax,
        otherDeduction: otherDeduction,
        otherDeductionNote: otherDeductionNote,
        grossPay: grossPay,
        totalDeduction: totalDeduction,
        netPay: netPay,
        payslipPublished: true,
        payslipPublishedAt: new Date(),
        remark: '2026-08 月工资（无底薪，按日薪×出勤天+夜场补+全勤奖+演出奖金）',
        ts: BigInt(now)
      },
      update: {
        batchId: batch.id,
        performerId: p.id,
        performerName: p.name,
        staffNo: p.staffNo,
        rankGrade: p.rankGrade,
        attendanceDays: attDays,
        baseWage: baseWage,
        nightShowBonus: nightSubsidy,
        transportAllowance: transportAllowance,
        mealAllowance: mealAllowance,
        fullAttendanceBonus: fullBonus,
        performanceBonus: performanceBonus,
        socialInsuranceDeduct: socialInsurance,
        housingFundDeduct: housingFund,
        taxDeduct: tax,
        grossPay: grossPay,
        totalDeduction: totalDeduction,
        netPay: netPay,
        payslipPublished: true,
        otherAllowanceNote: otherAllowanceNote,
        remark: '2026-08 月工资（无底薪，按日薪×出勤天+夜场补+全勤奖+演出奖金）',
        ts: BigInt(now)
      }
    });
    console.log('[seed-wages] upsert ' + p.name + ' (' + p.rankGrade + '): baseWage=' + baseWage + ' netPay=' + netPay);
  }

  // 5. 回写批次汇总
  await prisma.wageBatchesV1.update({
    where: { id: batch.id },
    data: {
      totalBaseWage: totalBase,
      totalAllowance: totalAllow,
      totalBonus: totalBonus,
      totalDeduction: totalDeduct,
      totalNetPay: totalNet,
      ts: BigInt(now)
    }
  });
  console.log('[seed-wages] 批次汇总: base=' + totalBase + ' allow=' + totalAllow + ' bonus=' + totalBonus + ' deduct=' + totalDeduct + ' net=' + totalNet);
  console.log('[seed-wages] 录入完成（共 ' + performers.length + ' 人）');
}

main().then(() => prisma.$disconnect()).catch(e => {
  console.error('[seed-wages] FATAL:', e);
  prisma.$disconnect();
  process.exit(1);
});
