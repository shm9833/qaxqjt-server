-- ================================================================
-- 秦安县秦剧团 在籍人员脏数据清理脚本
-- 数据源: performers_db_v1 @ 1.14.106.173
-- 生成时间: 2026-10-16
-- 核查依据: staff-audit-report.md
-- ================================================================
-- 说明:
--   本脚本分三段:
--     段1: 物理删除 5 条审核过期脏数据（无编号、无入职日期、无类型、姓名重复）
--     段2: 物理删除 25 条测试数据（角子系列、打卡验证测试员、QA-P- 前缀）
--     段3: 状态修正 7 条非测试 deleted 记录（改为 reviewStatus='expired'，保持状态一致）
--   执行前请先备份: cp prisma/prod.db prisma/prod.db.bak-<date>
--   建议在事务中执行，可先 SELECT 预览影响行数再 COMMIT
-- ================================================================

-- ----------------------------------------------------------------
-- 预览模式（先跑 SELECT 确认影响范围，再决定是否执行 DELETE/UPDATE）
-- ----------------------------------------------------------------

-- 预览段1: 审核过期脏数据（5 条）
SELECT id, staff_no, name, status, review_status, created_at
FROM performers_db_v1
WHERE review_status = 'expired' AND staff_no IS NULL;

-- 预览段2: 测试数据（26 条）
SELECT id, staff_no, name, status, review_status
FROM performers_db_v1
WHERE status = 'deleted' AND review_status = 'approved'
  AND (
    staff_no IN ('PF007','PF008','PF009','PF010','PF011','PF012')           -- 角子1-6
    OR staff_no IN ('PF035','PF036','PF039','PF040')                        -- 打卡验证测试员
    OR staff_no = 'PF083'                                                    -- 测试打卡验证A
    OR staff_no IN ('QA-P-004','QA-P-005','QA-P-006','QA-P-007','QA-P-008',
                    'QA-P-009','QA-P-010','QA-P-011','QA-P-012','QA-P-013',
                    'QA-P-014','QA-P-015','QA-P-017','QA-P-018')              -- QA 测试数据
  );

-- 预览段3: 非测试 deleted 记录（7 条）
SELECT id, staff_no, name, status, review_status, hire_date
FROM performers_db_v1
WHERE status = 'deleted' AND review_status = 'approved'
  AND staff_no IN ('PF003','PF004','PF005','PF006','PF014','PF015','PF016');

-- ================================================================
-- 正式执行段（请取消注释后执行，或逐段执行）
-- ================================================================

BEGIN TRANSACTION;

-- 段1: 物理删除 5 条审核过期脏数据
DELETE FROM performers_db_v1
WHERE review_status = 'expired' AND staff_no IS NULL;

-- 段2: 物理删除 26 条测试数据
DELETE FROM performers_db_v1
WHERE status = 'deleted' AND review_status = 'approved'
  AND (
    staff_no IN ('PF007','PF008','PF009','PF010','PF011','PF012')
    OR staff_no IN ('PF035','PF036','PF039','PF040')
    OR staff_no = 'PF083'
    OR staff_no IN ('QA-P-004','QA-P-005','QA-P-006','QA-P-007','QA-P-008',
                    'QA-P-009','QA-P-010','QA-P-011','QA-P-012','QA-P-013',
                    'QA-P-014','QA-P-015','QA-P-017','QA-P-018')
  );

-- 段3: 状态修正 7 条非测试 deleted 记录（reviewStatus 从 approved 改为 expired，保持状态一致）
UPDATE performers_db_v1
SET review_status = 'expired', updated_at = CURRENT_TIMESTAMP
WHERE status = 'deleted' AND review_status = 'approved'
  AND staff_no IN ('PF003','PF004','PF005','PF006','PF014','PF015','PF016');

-- 确认无误后提交
COMMIT;

-- 如需回滚，请执行: ROLLBACK;

-- ================================================================
-- 执行后验证
-- ================================================================

-- 验证总人数（应从 67 降至 36）
SELECT COUNT(*) AS total_after_cleanup FROM performers_db_v1;

-- 验证有效在册人数（应保持 30）
SELECT COUNT(*) AS active_count FROM performers_db_v1
WHERE status = 'active' AND review_status = 'approved';

-- 验证待核实离职人数（7 条 reviewStatus 改为 expired）
SELECT COUNT(*) AS expired_count FROM performers_db_v1
WHERE status = 'deleted' AND review_status = 'expired';

-- 验证测试数据已清除（应为 0）
SELECT COUNT(*) AS test_data_remaining FROM performers_db_v1
WHERE staff_no LIKE 'QA-P-%' OR staff_no IN ('PF007','PF008','PF009','PF010','PF011','PF012',
                                               'PF035','PF036','PF039','PF040','PF083');
