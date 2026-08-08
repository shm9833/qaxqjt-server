# 批次9修复：批量为6个后台页面注入上传模块
# 第一部分：reports.html + schedule.html

$ErrorActionPreference = "Stop"
$root = "d:\全套最终整合交付（秦安县秦剧团云端预约系统·14文档+架构终审全汇总·可直接EdgeOne Pages部署\qaxqjt\admin"

Write-Host "===== Part 1: reports.html =====" -ForegroundColor Cyan

# ---------- 1. reports.html ----------
$file = Join-Path $root "reports.html"
$content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

$marker = '<div class="table-section-title">天水文旅节庆演出专项统计'
if ($content.Contains($marker)) {
    $block = @"

        <!-- 批次9修复：统计报表附件上传 -->
        <div class="admin-card" style="margin:0 0 22px 0;border:2px solid #8b5cf6;background:linear-gradient(135deg,#faf5ff,#ede9fe);box-shadow:none;" data-upload-wrap="1">
          <div class="admin-card-header" style="padding-top:16px;">
            <h3 style="color:#581c87;">📊 统计报表资料上传（前端校验+预览层）</h3>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <span class="badge" style="font-size:0.78rem;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;">月度报表·季度分析·年度总结·审计附件</span>
              <button class="btn btn-sm" type="button" id="openReportsUploadBtn" style="padding:6px 14px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;">📤 选择报表</button>
            </div>
          </div>
          <div class="admin-card-body" style="padding-top:6px;">
            <form id="reportsAttachForm" autocomplete="off" novalidate>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
                <div>
                  <label style="display:block;font-weight:700;color:#581c87;margin-bottom:6px;">报表周期类型</label>
                  <select name="reportPeriod" style="width:100%;padding:10px 14px;border:1.5px solid #8b5cf6;border-radius:10px;background:#fff;">
                    <option value="monthly">📅 月度统计报表</option>
                    <option value="quarterly">📊 季度经营分析报告</option>
                    <option value="yearly">📈 年度工作总结报表</option>
                    <option value="audit">🔍 文旅审计专项附件</option>
                    <option value="special">🎯 节庆演出专项统计</option>
                  </select>
                </div>
                <div>
                  <label style="display:block;font-weight:700;color:#581c87;margin-bottom:6px;">报表所属周期</label>
                  <select name="reportMonth" style="width:100%;padding:10px 14px;border:1.5px solid #8b5cf6;border-radius:10px;background:#fff;">
                    <option value="{year}-07">{year}年7月</option>
                    <option value="{year}-06">{year}年6月</option>
                    <option value="{year}-Q2">{year}年第二季度</option>
                    <option value="{year}-H1">{year}年上半年</option>
                    <option value="2025-full">2025年度全年</option>
                  </select>
                </div>
                <div style="grid-column:1 / -1;">
                  <label style="display:block;font-weight:700;color:#581c87;margin-bottom:6px;">报表文件 *（≤10MB/个，支持Excel/PDF/Word/图片）</label>
                  <input type="file" name="reportsFiles" id="reportsAttachFiles" accept=".xls,.xlsx,.pdf,.doc,.docx,image/*" multiple required style="width:100%;padding:10px;border:2px dashed #8b5cf6;border-radius:12px;background:#fff;cursor:pointer;">
                </div>
              </div>
              <div style="margin-top:16px;display:flex;gap:14px;flex-wrap:wrap;align-items:center;">
                <button type="submit" class="btn" style="background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;">✅ 提交报表附件</button>
                <button type="reset" class="btn btn-outline">🔄 清空</button>
                <small style="color:#6d28d9;">💡 上传后自动生成缩略图预览，Excel/PDF显示图标；正式发布对接COS/后端接口。</small>
              </div>
            </form>
          </div>
        </div>

"@
    $newContent = $content.Replace($marker, $block + $marker)
    [System.IO.File]::WriteAllText($file, $newContent, [System.Text.Encoding]::UTF8)
    Write-Host "✅ reports.html: OK" -ForegroundColor Green
} else {
    Write-Host "❌ reports.html: marker not found" -ForegroundColor Red
}

Write-Host ""
Write-Host "===== Part 1 done =====" -ForegroundColor Cyan
