#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
======================================================================
  秦安县秦剧团云端预约系统 · Admin 按钮兜底 Perf 监控
  P99 延迟 HTML 报表生成脚本
======================================================================
  功能：
    1. 从 Elasticsearch 查询最近 N 小时（默认 1h，可配置）的
       P50 / P95 / P99 duration_ms 延迟（按分钟分桶）
    2. 同时输出：总点击量、兜底占比、Top10 最慢分支、各分支 P99 对比
    3. 生成一份独立 HTML 报表（含 ECharts 图表，无需服务器，双击即可查看）

  环境要求：
    Python 3.7+
      pip install requests    # 仅需 requests；如果无 requests 会自动回退到 urllib

  配置方式（优先级：命令行 > 环境变量 > 默认值）：
    环境变量：
      ES_HOST        例如 http://127.0.0.1:9200   （默认 http://localhost:9200）
      ES_INDEX       例如 qaxqjt-admin-perf-*      （默认 qaxqjt-admin-perf-*）
      ES_USER        basic auth 用户名（可选）
      ES_PASS        basic auth 密码（可选）
      ES_HOURS       查询最近多少小时（默认 1）
    命令行：
      python elk_p99_report.py  --host http://es:9200 \
                                 --index 'qaxqjt-admin-perf-*' \
                                 --user elastic --pass changeme \
                                 --hours 24  \
                                 --out ./p99_report.html

  输出：
    ./qaxqjt_p99_report_YYYYMMDD_HHMMSS.html   （默认目录）
======================================================================
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import html
import json
import os
import sys
import urllib.parse
import urllib.request
import ssl
from typing import Any, Dict, List, Optional, Tuple

# -------------------- 网络请求：优先 requests，降级 urllib --------------------
try:
    import requests  # type: ignore
    HAVE_REQUESTS = True
except Exception:  # pragma: no cover - 降级路径
    HAVE_REQUESTS = False


def _req(method: str, url: str, *, body: Optional[Dict[str, Any]] = None,
         headers: Optional[Dict[str, str]] = None,
         user: Optional[str] = None, password: Optional[str] = None,
         timeout: int = 30) -> Tuple[int, Dict[str, Any]]:
    hdrs = {"Content-Type": "application/json", "Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    if user and password:
        token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
        hdrs["Authorization"] = f"Basic {token}"

    if HAVE_REQUESTS:
        resp = requests.request(method, url, json=body, headers=hdrs,
                                timeout=timeout, verify=False)
        try:
            data = resp.json()
        except Exception:
            data = {"raw": resp.text}
        return resp.status_code, data
    else:  # pragma: no cover - 无 requests 的降级路径
        data_bytes = json.dumps(body).encode("utf-8") if body else None
        req = urllib.request.Request(url, data=data_bytes, headers=hdrs, method=method)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                raw = resp.read().decode("utf-8", "ignore")
                try:
                    return resp.status, json.loads(raw)
                except Exception:
                    return resp.status, {"raw": raw}
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "ignore")
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, {"raw": raw}


# -------------------- 参数解析 --------------------
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="QAX-QJT Admin Perf P99 报表生成器")
    p.add_argument("--host",   default=os.environ.get("ES_HOST",    "http://localhost:9200"),
                   help="Elasticsearch host (ES_HOST env)")
    p.add_argument("--index",  default=os.environ.get("ES_INDEX",   "qaxqjt-admin-perf-*"),
                   help="索引名，支持通配 (ES_INDEX env)")
    p.add_argument("--user",   default=os.environ.get("ES_USER",    None), help="Basic auth 用户名 (ES_USER)")
    p.add_argument("--pass",   default=os.environ.get("ES_PASS",    None), dest="pwd", help="Basic auth 密码 (ES_PASS)")
    p.add_argument("--hours",  type=int, default=int(os.environ.get("ES_HOURS", "1")),
                   help="查询最近 N 小时 (ES_HOURS，默认 1)")
    p.add_argument("--bucket", type=str, default="1m",
                   help="时间桶大小（默认 1m=每分钟1个点；可选 30s/5m/15m/1h）")
    p.add_argument("--out",    default=None, help="输出 HTML 路径（默认自动命名到当前目录）")
    p.add_argument("--no-verify", action="store_true", help="关闭 SSL 证书校验（默认关闭）")
    return p.parse_args()


# -------------------- ES 查询构造 --------------------
def build_query(hours: int, bucket: str) -> Dict[str, Any]:
    return {
        "size": 0,
        "query": {
            "bool": {
                "filter": [
                    {"range": {"@timestamp": {"gte": f"now-{hours}h", "lte": "now"}}},
                    {"exists": {"field": "duration_ms"}}
                ]
            }
        },
        "aggs": {
            # 全量总体延迟分布
            "overall_percentiles": {"percentiles": {"field": "duration_ms", "percents": [50, 90, 95, 99]}},
            "overall_count":       {"value_count": {"field": "trace_id"}},
            # 按时间分桶（分钟级）+ 每桶 P99
            "per_minute": {
                "date_histogram": {"field": "@timestamp", "fixed_interval": bucket,
                                   "min_doc_count": 0, "extended_bounds": {"min": f"now-{hours}h", "max": "now"}},
                "aggs": {
                    "p50": {"percentiles": {"field": "duration_ms", "percents": [50]}},
                    "p95": {"percentiles": {"field": "duration_ms", "percents": [95]}},
                    "p99": {"percentiles": {"field": "duration_ms", "percents": [99]}},
                    "cnt": {"value_count": {"field": "trace_id"}}
                }
            },
            # 按 module（DBF/SP）分桶 P99
            "by_module": {
                "terms": {"field": "module", "size": 10},
                "aggs": {"p99": {"percentiles": {"field": "duration_ms", "percents": [99]}}}
            },
            # 按 branch 分桶 P99（取 Top10 最慢）
            "by_branch": {
                "terms": {"field": "branch", "size": 20},
                "aggs": {
                    "p99": {"percentiles": {"field": "duration_ms", "percents": [99]}},
                    "cnt": {"value_count": {"field": "trace_id"}},
                    "sort_latency": {"bucket_sort": {"sort": [{"p99": {"order": "desc"}}], "size": 10}}
                }
            },
            # bound=true vs bound=false（真实绑定 vs 兜底命中）计数
            "by_bound": {
                "terms": {"field": "bound", "size": 5},
                "aggs": {"cnt": {"value_count": {"field": "trace_id"}}}
            }
        }
    }


# -------------------- 结果抽取 --------------------
def _pct_val(bucket: Dict[str, Any], key: str, pct: str) -> Optional[float]:
    """从 percentiles 聚合结果里取某个分位值，兼容两种格式"""
    p = bucket.get(key, {}).get("values", {})
    if not p:
        return None
    # ES percentiles 有时返回 {50.0: x, 99.0: y} 有时返回字符串键
    for k, v in p.items():
        if str(k) == str(pct):
            return round(float(v), 2) if v is not None else None
    return None


def extract(result: Dict[str, Any]) -> Dict[str, Any]:
    aggs = result.get("aggregations", {})

    overall_pct = aggs.get("overall_percentiles", {}).get("values", {})
    def ov(p: str) -> Optional[float]:
        for k, v in overall_pct.items():
            if str(k) == str(p):
                return round(float(v), 2) if v is not None else None
        return None

    # 每分钟分桶
    per_min: List[Dict[str, Any]] = []
    for b in aggs.get("per_minute", {}).get("buckets", []):
        per_min.append({
            "ts":  b.get("key_as_string") or b.get("key"),
            "ms":  b.get("key"),
            "cnt": b.get("cnt", {}).get("value", 0),
            "p50": _pct_val(b, "p50", "50.0"),
            "p95": _pct_val(b, "p95", "95.0"),
            "p99": _pct_val(b, "p99", "99.0"),
        })

    # 按 module（DBF/SP）
    by_module: List[Dict[str, Any]] = []
    for b in aggs.get("by_module", {}).get("buckets", []):
        by_module.append({
            "module": b.get("key"),
            "count":  b.get("doc_count"),
            "p99":    _pct_val(b, "p99", "99.0")
        })

    # 按 branch Top10 最慢
    by_branch: List[Dict[str, Any]] = []
    for b in aggs.get("by_branch", {}).get("buckets", []):
        by_branch.append({
            "branch": b.get("key") or "(未标识)",
            "count":  b.get("cnt", {}).get("value", b.get("doc_count")),
            "p99":    _pct_val(b, "p99", "99.0") or 0
        })
    by_branch.sort(key=lambda x: x["p99"], reverse=True)

    # bound=true / false
    by_bound = {}
    for b in aggs.get("by_bound", {}).get("buckets", []):
        k = "兜底命中(bound=false)" if b.get("key") in (False, "false", 0) else "真实绑定(bound=true)"
        by_bound[k] = b.get("cnt", {}).get("value", b.get("doc_count"))

    total_count = aggs.get("overall_count", {}).get("value", 0)

    return {
        "total_count":   total_count,
        "overall_p50":   ov("50.0"),
        "overall_p90":   ov("90.0"),
        "overall_p95":   ov("95.0"),
        "overall_p99":   ov("99.0"),
        "per_minute":    per_min,
        "by_module":     by_module,
        "by_branch":     by_branch,
        "by_bound":      by_bound,
    }


# -------------------- HTML 报表生成 --------------------
HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>🎭 秦安县秦剧团 · Admin 按钮兜底 Perf P99 报表</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
<style>
  * { box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
         background:#f1f5f9; color:#0f172a; margin:0; padding:24px; }
  h1 { margin:0 0 6px; font-size:22px; color:#0a3a63; }
  .sub { color:#64748b; margin-bottom:22px; font-size:13px; }
  .card { background:#fff; border-radius:14px; padding:18px 20px; box-shadow:0 2px 8px rgba(15,23,42,.06);
          margin-bottom:18px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; margin-bottom:18px; }
  .kpi { background:#fff; border-radius:14px; padding:16px; box-shadow:0 2px 8px rgba(15,23,42,.06);
          border-left:4px solid #0F4C81; }
  .kpi .v { font-size:30px; font-weight:700; color:#0a3a63; margin:6px 0 2px; }
  .kpi.p99 { border-left-color:#dc2626; } .kpi.p99 .v { color:#b91c1c; }
  .kpi.p95 { border-left-color:#f59e0b; } .kpi.p95 .v { color:#b45309; }
  .kpi.p50 { border-left-color:#16a34a; } .kpi.p50 .v { color:#15803d; }
  .kpi.tot { border-left-color:#6366f1; } .kpi.tot .v { color:#4338ca; }
  .kpi .l { color:#64748b; font-size:13px; } .kpi .r { color:#94a3b8; font-size:12px; margin-top:4px; }
  .row { display:grid; gap:18px; }
  .row.c2 { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  @media (max-width: 900px){ .row.c2{grid-template-columns:1fr;} }
  h2 { font-size:15px; margin:0 0 10px; color:#334155; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { padding:9px 10px; border-bottom:1px solid #e2e8f0; text-align:left; }
  th { background:#f8fafc; color:#475569; } td.num { text-align:right; font-variant-numeric:tabular-nums; }
  tr.slow td { color:#b91c1c; }
  .tag { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; }
  .tag.ok   { background:#dcfce7; color:#166534; }
  .tag.warn { background:#fef3c7; color:#92400e; }
  .tag.err  { background:#fee2e2; color:#991b1b; }
  .chart { width:100%; height:320px; }
  .footer { color:#94a3b8; font-size:12px; text-align:center; margin-top:22px; }
</style>
</head>
<body>
  <h1>🎭 秦安县秦剧团云端预约系统 · Admin 按钮兜底 Perf P99 报表</h1>
  <div class="sub">
    报表时间：{{GEN_AT}} · 查询范围：最近 {{HOURS}} 小时 · 分桶：{{BUCKET}} · 索引：<code>{{INDEX}}</code> ·
    ES：<code>{{HOST}}</code>
    &nbsp; → 总体评价：<span id="badgePlaceholder"></span>
  </div>

  <!-- KPI Cards -->
  <div class="kpis">
    <div class="kpi tot"><div class="l">总点击 span 数（样本量）</div>
      <div class="v" id="kpiTotal">-</div><div class="r">value_count(trace_id)</div></div>
    <div class="kpi p50"><div class="l">整体 P50 延迟 (ms)</div>
      <div class="v" id="kpiP50">-</div><div class="r">50% 用户请求 ≤ 该值</div></div>
    <div class="kpi p95"><div class="l">整体 P95 延迟 (ms)</div>
      <div class="v" id="kpiP95">-</div><div class="r">95% 用户请求 ≤ 该值</div></div>
    <div class="kpi p99"><div class="l">整体 P99 延迟 (ms)</div>
      <div class="v" id="kpiP99">-</div><div class="r">99% 用户请求 ≤ 该值</div></div>
  </div>

  <!-- 分桶延迟趋势 -->
  <div class="card">
    <h2>📈 延迟趋势（P50 / P95 / P99 每分钟分桶）</h2>
    <div id="chartLine" class="chart"></div>
  </div>

  <div class="row c2">
    <!-- 分桶吞吐 + 分支 P99 柱 -->
    <div class="card">
      <h2>📊 各业务分支 P99 延迟对比（Top 10 最慢）</h2>
      <div id="chartBranch" class="chart"></div>
    </div>
    <div class="card">
      <h2>🍩 真实绑定 vs 兜底命中占比</h2>
      <div id="chartPie" class="chart"></div>
    </div>
  </div>

  <!-- Top10 最慢分支表格 -->
  <div class="card">
    <h2>🔍 最慢分支明细（按 P99 倒序）</h2>
    <table>
      <thead><tr><th>#</th><th>branch</th><th class="num">点击次数</th>
        <th class="num">P99 (ms)</th><th>评级</th></tr></thead>
      <tbody id="branchTbody"></tbody>
    </table>
  </div>

  <!-- 原始 JSON -->
  <details style="margin-top:18px"><summary style="cursor:pointer;color:#64748b;font-size:13px">
    查看本次 ES 查询原始聚合数据（调试用）</summary>
    <pre id="rawJson" style="background:#fff;padding:14px;border-radius:10px;
          font-size:12px;overflow-x:auto;max-height:420px"></pre>
  </details>

  <div class="footer">
    生成脚本：elk_p99_report.py · 对应通用模板 v20260804-2（JSON Perf + 防重复注入）
  </div>

<script>
/* ---------- 注入数据 ---------- */
const DATA = __DATA_JSON__;
document.getElementById('rawJson').textContent = JSON.stringify(DATA, null, 2);

/* KPI */
function fmt(v, suffix=''){ return (v===null||v===undefined) ? '-' : (Math.round(v*100)/100 + suffix); }
document.getElementById('kpiTotal').textContent = DATA.total_count.toLocaleString();
document.getElementById('kpiP50').textContent   = fmt(DATA.overall_p50);
document.getElementById('kpiP95').textContent   = fmt(DATA.overall_p95);
document.getElementById('kpiP99').textContent   = fmt(DATA.overall_p99);
const p99 = DATA.overall_p99 ?? 0;
const badge = document.getElementById('badgePlaceholder');
if (DATA.total_count === 0) {
  badge.outerHTML = '<span class="tag warn">⚠️ 无样本（请确认 ES 有写入数据）</span>';
} else if (p99 <= 50) {
  badge.outerHTML = '<span class="tag ok">✅ 优秀（P99 ≤ 50ms）</span>';
} else if (p99 <= 200) {
  badge.outerHTML = '<span class="tag warn">⚠️ 一般（P99 ≤ 200ms）</span>';
} else {
  badge.outerHTML = '<span class="tag err">❌ 告警（P99 > 200ms，建议排查慢分支）</span>';
}

/* 分桶折线图 */
(function(){
  const buckets = DATA.per_minute || [];
  const xs = buckets.map(b => (b.ts || '').replace('T',' ').slice(0,16));
  const opt = {
    tooltip:{trigger:'axis'}, legend:{data:['P50','P95','P99','点击次数(RPS)']},
    grid:{left:50,right:60,top:40,bottom:50},
    xAxis:{type:'category',data:xs,axisLabel:{rotate:30}},
    yAxis:[
      {type:'value', name:'延迟 (ms)', position:'left'},
      {type:'value', name:'点击次数', position:'right'}
    ],
    series:[
      {name:'P50', type:'line', smooth:true, data:buckets.map(b=>b.p50),
       itemStyle:{color:'#16a34a'}, areaStyle:{opacity:0.08}},
      {name:'P95', type:'line', smooth:true, data:buckets.map(b=>b.p95),
       itemStyle:{color:'#f59e0b'}},
      {name:'P99', type:'line', smooth:true, data:buckets.map(b=>b.p99),
       itemStyle:{color:'#dc2626'}, lineStyle:{width:3}},
      {name:'点击次数(RPS)', type:'bar', yAxisIndex:1, data:buckets.map(b=>b.cnt),
       itemStyle:{color:'rgba(99,102,241,0.35)', borderRadius:[6,6,0,0]}}
    ]
  };
  echarts.init(document.getElementById('chartLine')).setOption(opt);
})();

/* 分支 P99 柱 */
(function(){
  const rows = DATA.by_branch || [];
  const opt = {
    tooltip:{trigger:'axis', axisPointer:{type:'shadow'}},
    grid:{left:120,right:30,top:30,bottom:40},
    xAxis:{type:'value', name:'P99 (ms)'},
    yAxis:{type:'category', data:rows.map(r=>r.branch).reverse(), inverse:false},
    series:[{
      type:'bar', label:{show:true, position:'right', formatter:'{c} ms'},
      data: rows.slice().reverse().map(r => ({
        value: r.p99,
        itemStyle:{color: r.p99>=200?'#dc2626': r.p99>=50?'#f59e0b':'#16a34a',
                   borderRadius:[0,8,8,0]}
      }))
    }]
  };
  echarts.init(document.getElementById('chartBranch')).setOption(opt);
})();

/* 真实绑定 vs 兜底饼图 */
(function(){
  const m = DATA.by_bound || {};
  const arr = Object.entries(m).map(([k,v])=>({name:k, value:v}));
  const opt = {
    tooltip:{trigger:'item', formatter:'{b}: {c} ({d}%)'},
    legend:{bottom:0},
    color:['#6366f1','#f59e0b'],
    series:[{type:'pie', radius:['45%','72%'], center:['50%','46%'],
      label:{formatter:'{b}\\n{d}%', fontSize:12},
      data: arr.length ? arr : [{name:'无数据',value:1}]}]
  };
  echarts.init(document.getElementById('chartPie')).setOption(opt);
})();

/* 最慢分支表格 */
(function(){
  const tb = document.getElementById('branchTbody');
  const rows = DATA.by_branch || [];
  if (!rows.length){ tb.innerHTML = '<tr><td colspan=5 style="color:#94a3b8">无数据</td></tr>'; return; }
  tb.innerHTML = rows.map((r,i)=>{
    const cls = r.p99>=200?'slow':'';
    const tag = r.p99>=200 ? '<span class="tag err">慢</span>'
             : r.p99>=50  ? '<span class="tag warn">中</span>'
             :              '<span class="tag ok">快</span>';
    return `<tr class="${cls}"><td>${i+1}</td><td><code>${htmlEscape(r.branch)}</code></td>
      <td class="num">${r.count.toLocaleString()}</td>
      <td class="num"><b>${fmt(r.p99)}</b></td><td>${tag}</td></tr>`;
  }).join('');
  function htmlEscape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
})();
</script>
</body>
</html>
"""


def render_html(data: Dict[str, Any], args: argparse.Namespace) -> str:
    gen_at = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    data_json = json.dumps(data, ensure_ascii=False)
    out = (HTML_TEMPLATE
           .replace("__DATA_JSON__", data_json)
           .replace("{{GEN_AT}}",  gen_at)
           .replace("{{HOURS}}",   str(args.hours))
           .replace("{{BUCKET}}",  args.bucket)
           .replace("{{INDEX}}",   html.escape(args.index))
           .replace("{{HOST}}",    html.escape(args.host)))
    return out


# -------------------- 主流程 --------------------
def main() -> int:
    args = parse_args()
    if args.no_verify and HAVE_REQUESTS:
        import urllib3  # type: ignore
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)  # type: ignore

    url = f"{args.host.rstrip('/')}/{urllib.parse.quote(args.index, safe='*')}/_search"
    body = build_query(args.hours, args.bucket)

    print(f"[ℹ️] ES_HOST  = {args.host}")
    print(f"[ℹ️] ES_INDEX = {args.index}")
    print(f"[ℹ️] 最近 {args.hours} 小时 · 分桶 {args.bucket}")
    code, result = _req("POST", url, body=body, user=args.user, password=args.pwd)
    if code >= 400:
        print(f"[❌] ES 查询失败 HTTP {code}：", json.dumps(result, ensure_ascii=False)[:500])
        return 2

    data = extract(result)
    print(f"[✅] 查询命中样本：{data['total_count']} 条")
    print(f"     P50/P90/P95/P99 = {data['overall_p50']}/{data['overall_p90']}/{data['overall_p95']}/{data['overall_p99']} ms")
    print(f"     分桶数量：{len(data['per_minute'])}")

    out_path = args.out
    if not out_path:
        ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = os.path.join(os.getcwd(), f"qaxqjt_p99_report_{ts}.html")
    html_text = render_html(data, args)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html_text)
    print(f"[✅] HTML 报表已生成：{out_path}")
    print(f"     直接用浏览器双击打开即可，无需任何服务器。")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n[中断] 用户取消")
        sys.exit(130)
