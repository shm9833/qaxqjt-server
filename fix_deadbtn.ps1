# PowerShell Script: Fix SuperPatch 6/6 & H9Fix 8/9 stopImmediatePropagation abuse
# Process 12 admin/*.html files

$ErrorActionPreference = "Stop"
$baseDir = "d:\全套最终整合交付（秦安县秦剧团云端预约系统·14文档+架构终审全汇总·可直接EdgeOne Pages部署）\qaxqjt\admin"
$files = @("index.html","orders.html","operas.html","schedule.html","cast-sheet.html","content.html","finance.html","staff.html","system.html","accounts.html","inventory.html","reports.html")

# ====== 增强版 __btnHasBound 函数（作为字符串注入点） ======
$newBtnHasBound = @"
function __btnHasBound(btn){
  if(!btn) return false;
  var oc = btn.getAttribute && btn.getAttribute('onclick');
  var da = btn.getAttribute && btn.getAttribute('data-action');
  var hr = btn.getAttribute && btn.getAttribute('href');
  if(oc && oc.length > 3) return true;
  if(da && da.length > 0) return true;
  if(hr && hr !== '#' && hr !== 'javascript:;' && hr !== 'javascript:void(0);' && hr !== 'javascript:void(0)' && hr !== '') return true;
  var p = btn.parentElement, lvl = 0;
  while(p && lvl < 4){
    try {
      var pOc = p.getAttribute && p.getAttribute('onclick');
      var pDa = p.getAttribute && p.getAttribute('data-action');
      if((pOc && pOc.length > 3) || (pDa && pDa.length > 0)) return true;
    }catch(_){}
    p = p.parentElement; lvl++;
  }
  var txt = (btn.textContent||'').trim();
  if(txt.length > 0 && txt.length <= 10){
    var bizKeys = /详情|预览|安排|查看|编辑|更多|操作|打印|下载|上传|新增|确认接单|退款|派工/i;
    if(bizKeys.test(txt)) return true;
  }
  return false;
}
"@

# ====== 修改1：为H9Fix 8/9 注入增强版 __btnHasBound + 替换初始检查 ======
function Fix-H9FixBtnCheck($content) {
    # 检查是否已注入过
    if ($content -match 'function __btnHasBound\(btn\)\{') { return $content, $false }

    $modified = $false

    # ===== 模式A: H9Fix 8/9 标准初始检查块 =====
    $oldH9Check1 = @'
      try{
        if(btn.getAttribute && btn.getAttribute('onclick') && btn.getAttribute('onclick').length>3) return;
        if(btn.getAttribute && btn.getAttribute('data-action')) return;
        if(btn.__bindDone || btn.__h9Done) return;
        var tp = (btn.getAttribute && btn.getAttribute('type')||'').toLowerCase();
        if(tp==='submit') return;
      }catch(_a){}
'@
    $newH9Check1 = @"
      try{
        $($newBtnHasBound -replace "`r`n","`n`n        ")
        if(__btnHasBound(btn)) return;
        if(btn.__bindDone || btn.__h9Done) return;
        var tp = (btn.getAttribute && btn.getAttribute('type')||'').toLowerCase();
        if(tp==='submit') return;
      }catch(_a){}
"@

    if ($content.Contains($oldH9Check1)) {
        $content = $content.Replace($oldH9Check1, $newH9Check1)
        $modified = $true
    }

    # ===== 模式B: finance/index/inventory/reports 的 DeadButtonFallback 初始检查块 =====
    $oldH9Check2 = @'
      try{
        if(btn.getAttribute && btn.getAttribute('onclick') && btn.getAttribute('onclick').length>3) return;
        if(btn.getAttribute && btn.getAttribute('data-action')) return;
        if(btn.__bindDone || btn.__ctE2Done) return;
      }catch(_a){}
'@
    $newH9Check2 = @"
      try{
        $($newBtnHasBound -replace "`r`n","`n`n        ")
        if(__btnHasBound(btn)) return;
        if(btn.__bindDone || btn.__ctE2Done) return;
      }catch(_a){}
"@
    if ($content.Contains($oldH9Check2)) {
        $content = $content.Replace($oldH9Check2, $newH9Check2)
        $modified = $true
    }

    return $content, $modified
}

# ====== 修改2：SuperPatch 6/6 初始检查替换 + stopImmediatePropagation降级 ======
function Fix-SuperPatch($content) {
    $modified = $false

    # ===== SuperPatch 6/6 初始检查替换 =====
    $oldSpCheck = @'
        try{
          var oc = btn.getAttribute && btn.getAttribute('onclick');
          if(oc && oc.length > 3) return;
          var da = btn.getAttribute && btn.getAttribute('data-action');
          if(da) return;
          var hr = btn.getAttribute && btn.getAttribute('href');
          if(hr && hr !== '' && hr !== '#' && hr !== 'javascript:;' && hr !== 'javascript:void(0)') return;
          if(btn.__spDeadDone) return;
          var tp = btn.getAttribute && (btn.getAttribute('type')||'').toLowerCase();
          if(tp === 'submit') return;
        }catch(_ck){}
'@

    $newSpCheck = @"
        try{
          $($newBtnHasBound -replace "`r`n","`n`n          ")
          if(__btnHasBound(btn)) return;
          if(btn.__spDeadDone) return;
          var tp = btn.getAttribute && (btn.getAttribute('type')||'').toLowerCase();
          if(tp === 'submit') return;
        }catch(_ck){}
"@

    if ($content.Contains($oldSpCheck)) {
        $content = $content.Replace($oldSpCheck, $newSpCheck)
        $modified = $true
    }

    # ===== SuperPatch 6/6 stopImmediatePropagation 降级 =====
    $spOld1 = 'try{
            if(e.stopImmediatePropagation) e.stopImmediatePropagation();
            e.preventDefault();
          }catch(_ep){}'
    $spNew1 = 'try{ if(btn && !__btnHasBound(btn) && e.stopPropagation) e.stopPropagation(); e.preventDefault(); }catch(_ep){}'
    if ($content.Contains($spOld1)) {
        $content = $content.Replace($spOld1, $spNew1)
        $modified = $true
    }

    # 单行形式 SuperPatch: if(e.stopImmediatePropagation) e.stopImmediatePropagation(); e.preventDefault();
    $spOld2 = 'if(e.stopImmediatePropagation) e.stopImmediatePropagation(); e.preventDefault();'
    $spNew2 = 'if(btn && !__btnHasBound(btn) && e.stopPropagation) e.stopPropagation(); e.preventDefault();'
    if ($content.Contains($spOld2)) {
        $content = $content.Replace($spOld2, $spNew2)
        $modified = $true
    }

    return $content, $modified
}

# ====== 修改3：H9Fix 8/9 & DeadButtonFallback stopImmediatePropagation 降级 ======
function Fix-H9StopImmediate($content) {
    $modified = $false

    # ===== H9Fix 8/9 单行保存: e.stopImmediatePropagation() =====
    # Pattern 1: 带_t8/_toast8警告的保存提交中 + stopImmediatePropagation
    $patterns = @(
        # H9Fix 8/9 style: _t8 or _toast8
        @{ Old = "_t8('⏳ 保存提交中，请稍候…','warning'); e.stopImmediatePropagation(); return;"; New = "_t8('⏳ 保存提交中，请稍候…','warning'); try { e.stopPropagation(); } catch(_a){} return;" },
        @{ Old = "_toast8('⏳ 保存提交中，请稍候…','warning'); e.stopImmediatePropagation(); return;"; New = "_toast8('⏳ 保存提交中，请稍候…','warning'); try { e.stopPropagation(); } catch(_a){} return;" },
        @{ Old = "_t8('⏳ 保存提交中，请稍候…','warning'); e.stopImmediatePropagation(); return; }"; New = "_t8('⏳ 保存提交中，请稍候…','warning'); try { e.stopPropagation(); } catch(_a){} return; }" },
        @{ Old = "_toast8('⏳ 保存提交中，请稍候…','warning'); e.stopImmediatePropagation(); return; }"; New = "_toast8('⏳ 保存提交中，请稍候…','warning'); try { e.stopPropagation(); } catch(_a){} return; }" },
        # btn.__h9Done=1; e.stopImmediatePropagation(); return;
        @{ Old = "btn.__h9Done=1; e.stopImmediatePropagation(); return;"; New = "btn.__h9Done=1; try { e.stopPropagation(); } catch(_b){} return;" },
        @{ Old = "btn.__h9Done=1; e.stopImmediatePropagation(); return; }"; New = "btn.__h9Done=1; try { e.stopPropagation(); } catch(_b){} return; }" },
        # 删除警告
        @{ Old = "_t8('⏳ 删除处理中…','warning'); e.stopImmediatePropagation(); return;"; New = "_t8('⏳ 删除处理中…','warning'); try { e.stopPropagation(); } catch(_a){} return;" },
        @{ Old = "_toast8('⏳ 删除处理中…','warning'); e.stopImmediatePropagation(); return;"; New = "_toast8('⏳ 删除处理中…','warning'); try { e.stopPropagation(); } catch(_a){} return;" },
        # DeadButtonFallback style (finance/index/etc): __T / __L / __ctE2Done
        @{ Old = "__T('⏳ 保存提交中，请稍候…','warning'); e.stopImmediatePropagation(); return;"; New = "__T('⏳ 保存提交中，请稍候…','warning'); try { e.stopPropagation(); } catch(_a){} return;" },
        @{ Old = "btn.__ctE2Done = 1; e.stopImmediatePropagation(); return;"; New = "btn.__ctE2Done = 1; try { e.stopPropagation(); } catch(_b){} return;" },
        @{ Old = "__T('⏳ 删除处理中…','warning'); e.stopImmediatePropagation(); return;"; New = "__T('⏳ 删除处理中…','warning'); try { e.stopPropagation(); } catch(_a){} return;" }
    )

    foreach ($p in $patterns) {
        if ($content.Contains($p.Old)) {
            $content = $content.Replace($p.Old, $p.New)
            $modified = $true
        }
    }

    return $content, $modified
}

# ====== 记录行号（基于修改前后的差异分析，简化版：按关键词统计位置） ======
function Get-ModificationLineNumbers($content) {
    $lines = $content -split "`r?`n"
    $result = @{
        Mod1_H9Check = @();
        Mod2_SuperPatch = @();
        Mod3_H9Stop = @();
    }
    for ($i = 0; $i -lt $lines.Length; $i++) {
        $ln = $i + 1
        $line = $lines[$i]
        # 修改1：包含 __btnHasBound 函数定义的第一行
        if ($line -match 'function\s+__btnHasBound\(btn\)') {
            if ($result.Mod1_H9Check.Count -lt 2) { $result.Mod1_H9Check += $ln }
        }
        # 修改2：包含降级后的 stopPropagation (SuperPatch)
        if ($line -match '__btnHasBound\(btn\) \&\& e\.stopPropagation' -or $line -match 'if\(btn \&\& !__btnHasBound\(btn\) \&\& e\.stopPropagation\)') {
            if ($result.Mod2_SuperPatch.Count -lt 4) { $result.Mod2_SuperPatch += $ln }
        }
        # 修改3：try { e.stopPropagation() } catch (H9Fix)
        if ($line -match 'try\s*\{\s*e\.stopPropagation\(\)\s*\}\s*catch\(_[ab]\)\{\}') {
            if ($result.Mod3_H9Stop.Count -lt 4) { $result.Mod3_H9Stop += $ln }
        }
    }
    return $result
}

# ====== 主循环处理12个文件 ======
$results = @{}
foreach ($f in $files) {
    $filePath = Join-Path $baseDir $f
    if (-not (Test-Path $filePath)) {
        Write-Host "[SKIP] $f not found" -ForegroundColor Yellow
        continue
    }

    Write-Host "`n[PROCESSING] $f" -ForegroundColor Cyan
    $rawContent = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)
    $content = $rawContent
    $totalMod = $false

    # 修改1
    $content, $m1 = Fix-H9FixBtnCheck $content
    if ($m1) { Write-Host "  [OK] Mod1: H9Fix BtnCheck / __btnHasBound injected" -ForegroundColor Green; $totalMod = $true }
    else { Write-Host "  [SKIP] Mod1: No match or already applied" -ForegroundColor Gray }

    # 修改2
    $content, $m2 = Fix-SuperPatch $content
    if ($m2) { Write-Host "  [OK] Mod2: SuperPatch stopImmediatePropagation downgraded" -ForegroundColor Green; $totalMod = $true }
    else { Write-Host "  [SKIP] Mod2: No match or already applied" -ForegroundColor Gray }

    # 修改3
    $content, $m3 = Fix-H9StopImmediate $content
    if ($m3) { Write-Host "  [OK] Mod3: H9Fix/DeadFallback stopImmediatePropagation downgraded" -ForegroundColor Green; $totalMod = $true }
    else { Write-Host "  [SKIP] Mod3: No match or already applied" -ForegroundColor Gray }

    if ($totalMod) {
        [System.IO.File]::WriteAllText($filePath, $content, [System.Text.Encoding]::UTF8)
        Write-Host "  [SAVED] $f written to disk" -ForegroundColor DarkGreen
    } else {
        Write-Host "  [NOCHANGE] No modifications applied" -ForegroundColor DarkGray
    }

    $ln = Get-ModificationLineNumbers $content
    $results[$f] = $ln
}

# ====== 输出结果汇总 ======
Write-Host "`n`n================================================" -ForegroundColor White
Write-Host "  12 FILES MODIFICATION SUMMARY (Line Numbers)"  -ForegroundColor White
Write-Host "================================================`n" -ForegroundColor White

foreach ($f in $files) {
    if (-not $results.ContainsKey($f)) { continue }
    $r = $results[$f]
    Write-Host "$f" -ForegroundColor Cyan
    Write-Host "  Mod1 (__btnHasBound injected):   Lines $($r.Mod1_H9Check -join ', ')" -ForegroundColor Yellow
    Write-Host "  Mod2 (SuperPatch stopPropag.):   Lines $($r.Mod2_SuperPatch -join ', ')" -ForegroundColor Yellow
    Write-Host "  Mod3 (H9Fix stopPropag.):        Lines $($r.Mod3_H9Stop -join ', ')" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "`n[DONE] Script finished. Now deploy & GetDiagnostics." -ForegroundColor Green
