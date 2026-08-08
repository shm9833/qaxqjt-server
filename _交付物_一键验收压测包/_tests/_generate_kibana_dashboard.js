/**
 * 生成 Kibana Saved Objects (NDJSON)：Index Pattern + 5 Viz + 1 Dashboard
 * 用法：
 *   node _generate_kibana_dashboard.js
 *   → 输出到 elk/kibana_dashboard_qaxqjt_perf.ndjson
 * 导入 Kibana：
 *   浏览器登录 Kibana → Stack Management → Saved Objects → Import
 *   选择上面生成的 .ndjson 文件即可
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'elk');
const OUT = path.join(OUT_DIR, 'kibana_dashboard_qaxqjt_perf.ndjson');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const IDX_PAT_ID    = 'qaxqjt-admin-perf-index-pattern';
const IDX_PAT_TITLE = 'qaxqjt-admin-perf-*';

// ---------- 辅助：kibana saved object 通用包装 ----------
function so(type, id, attributes, refs=[]) {
  return {
    type, id, attributes,
    references: refs,
    migrationVersion: type==='index-pattern'
      ? {'index-pattern':'7.17.0'}
      : type==='visualization'
        ? {'visualization':'7.17.0'}
        : type==='dashboard'
          ? {'dashboard':'7.17.0'} : undefined,
    updated_at: new Date().toISOString(),
    coreMigrationVersion: '8.0.0'
  };
}
function refIndex(id) { return {name:'kibanaSavedObjectMeta.searchSourceJSON.index', type:'index-pattern', id}; }
function refIndexViz(id) { return {name:'index-pattern:'+id, type:'index-pattern', id}; }

// ---------- 1) Index Pattern ----------
const indexPattern = so('index-pattern', IDX_PAT_ID, {
  title: IDX_PAT_TITLE,
  timeFieldName: '@timestamp',
  fields: JSON.stringify([
    {name:'@timestamp', type:'date', esTypes:['date'], aggregatable:true, searchable:true},
    {name:'service',    type:'string', esTypes:['keyword'], aggregatable:true, searchable:true},
    {name:'trace_id',   type:'string', esTypes:['keyword'], aggregatable:true, searchable:true},
    {name:'module',     type:'string', esTypes:['keyword'], aggregatable:true, searchable:true},
    {name:'event',      type:'string', esTypes:['keyword'], aggregatable:true, searchable:true},
    {name:'branch',     type:'string', esTypes:['keyword'], aggregatable:true, searchable:true},
    {name:'btn_text',   type:'string', esTypes:['keyword','text'], aggregatable:true, searchable:true},
    {name:'bound',      type:'boolean',esTypes:['boolean'], aggregatable:true, searchable:true},
    {name:'lock_wait_ms',type:'number',esTypes:['long'],   aggregatable:true, searchable:true},
    {name:'duration_ms',type:'number', esTypes:['long'],   aggregatable:true, searchable:true, count:1},
    {name:'page_url',   type:'string', esTypes:['keyword'], aggregatable:true, searchable:true},
    {name:'user_agent', type:'string', esTypes:['keyword'], aggregatable:true, searchable:true}
  ]),
  fieldFormatMap: JSON.stringify({
    duration_ms:  {id:'number', params:{pattern:'0,0.[00]'}},
    lock_wait_ms: {id:'number', params:{pattern:'0,0.[00]'}}
  }),
  sourceFilters: '[]',
  typeMeta: '{}'
});

// ---------- 2-a) Viz: P95/P99 latency line ----------
// (Lens 或 Agg vis。Agg vis 在 7/8 全兼容。)
const vizP95Id = 'qaxqjt-viz-p95p99-line';
const vizP95 = so('visualization', vizP95Id, {
  title: 'QAX-QJT · 延迟 P50 / P95 / P99（按分钟）',
  visState: JSON.stringify({
    title: '延迟 P50/P95/P99',
    type: 'line',
    aggs: [
      {id:'1', enabled:true, type:'count', schema:'metric', params:{}},
      {id:'2', enabled:true, type:'percentiles', schema:'metric', params:{field:'duration_ms', percents:[50,95,99]}},
      {id:'3', enabled:true, type:'date_histogram', schema:'segment', params:{field:'@timestamp', interval:'m', min_doc_count:0, extended_bounds:{min:'now-1h',max:'now'}}}
    ],
    params: {
      addLegend:true, addTimeMarker:true, addTooltip:true,
      legendPosition:'right',
      seriesParams:[
        {show:true, type:'line', mode:'normal', data:{'id':'2','label':'Percentiles duration_ms'},
          valueAxis:'ValueAxis-1', drawLinesBetweenPoints:true, showCircles:true, interpolate:'cardinal'}
      ],
      categoryAxes:[{id:'CategoryAxis-1',type:'category',position:'bottom',show:true,
        scale:{type:'linear'},labels:{show:true,truncate:100}}],
      valueAxes:[{id:'ValueAxis-1',name:'LeftAxis-1',type:'value',position:'left',show:true,
        scale:{type:'linear',mode:'normal'},labels:{show:true,rotate:0,filter:false},title:{text:'duration_ms'}}]
    }
  }),
  uiStateJSON: '{}',
  description: '按钮兜底 Perf 延迟分布',
  savedSearchId: null,
  version: 1,
  kibanaSavedObjectMeta: { searchSourceJSON: JSON.stringify({index:IDX_PAT_ID, query:{language:'kuery', query:''}, filter:[]}) }
}, [refIndex(IDX_PAT_ID), refIndexViz(IDX_PAT_ID)]);

// ---------- 2-b) Viz: RPS per branch stacked col ----------
const vizRpsId = 'qaxqjt-viz-branch-rps';
const vizRps = so('visualization', vizRpsId, {
  title: 'QAX-QJT · 各分支点击量（堆叠柱状图）',
  visState: JSON.stringify({
    title: '按业务分支的点击量',
    type: 'histogram',
    aggs: [
      {id:'1', enabled:true, type:'count', schema:'metric', params:{}},
      {id:'2', enabled:true, type:'date_histogram', schema:'segment', params:{field:'@timestamp', interval:'1m', min_doc_count:0}},
      {id:'3', enabled:true, type:'terms', schema:'group', params:{field:'branch', size:15, orderBy:'1', order:'desc', otherBucket:true, missingBucket:false}}
    ],
    params: {
      addLegend:true, addTooltip:true,
      legendPosition:'right',
      seriesParams:[{show:true, type:'bar', mode:'stacked',
        data:{id:'1', label:'Count'}, valueAxis:'ValueAxis-1'}],
      categoryAxes:[{id:'CategoryAxis-1',type:'category',position:'bottom',show:true,
        labels:{show:true, rotate:0}}],
      valueAxes:[{id:'ValueAxis-1',name:'LeftAxis-1',type:'value',position:'left',show:true,
        scale:{type:'linear'},labels:{show:true},title:{text:'点击次数'}}]
    }
  }),
  uiStateJSON: '{}',
  description: '12 业务分支的请求量',
  savedSearchId: null,
  version: 1,
  kibanaSavedObjectMeta: { searchSourceJSON: JSON.stringify({index:IDX_PAT_ID, query:{language:'kuery', query:''}, filter:[]}) }
}, [refIndex(IDX_PAT_ID), refIndexViz(IDX_PAT_ID)]);

// ---------- 2-c) Viz: fallback占比饼图（bound=true vs false，或 module:DBF/SP） ----------
const vizPieId = 'qaxqjt-viz-bound-pie';
const vizPie = so('visualization', vizPieId, {
  title: 'QAX-QJT · 真实绑定 vs 兜底占比（bound=true: 真实绑定 / bound=false: 兜底命中）',
  visState: JSON.stringify({
    title: '兜底占比',
    type: 'pie',
    aggs: [
      {id:'1', enabled:true, type:'count', schema:'metric', params:{}},
      {id:'2', enabled:true, type:'terms', schema:'segment', params:{field:'bound', size:5, orderBy:'1', order:'desc', otherBucket:false}},
      {id:'3', enabled:true, type:'terms', schema:'split', params:{field:'module', size:5, orderBy:'1', order:'desc', row:false}}
    ],
    params: { addTooltip:true, addLegend:true, legendPosition:'right', isDonut:true, labels:{show:true, values:true, last_level:true, truncate:100} }
  }),
  uiStateJSON: '{}',
  description: '兜底命中比例',
  savedSearchId: null,
  version: 1,
  kibanaSavedObjectMeta: { searchSourceJSON: JSON.stringify({index:IDX_PAT_ID, query:{language:'kuery', query:''}, filter:[]}) }
}, [refIndex(IDX_PAT_ID), refIndexViz(IDX_PAT_ID)]);

// ---------- 2-d) Viz: Top N 慢请求 table ----------
const vizTblId = 'qaxqjt-viz-topn-slow';
const vizTbl = so('visualization', vizTblId, {
  title: 'QAX-QJT · Top 20 最慢请求（按 duration_ms 倒序）',
  visState: JSON.stringify({
    title: 'Top N 慢请求',
    type: 'table',
    aggs: [
      {id:'1', enabled:true, type:'max', schema:'metric', params:{field:'duration_ms', customLabel:'max_duration_ms'}},
      {id:'2', enabled:true, type:'terms', schema:'bucket', params:{field:'trace_id',  size:20, orderBy:'1', order:'desc', customLabel:'trace_id'}},
      {id:'3', enabled:true, type:'terms', schema:'bucket', params:{field:'branch',    size:1,  orderBy:'1', order:'desc', customLabel:'branch'}},
      {id:'4', enabled:true, type:'terms', schema:'bucket', params:{field:'btn_text',  size:1,  orderBy:'1', order:'desc', customLabel:'btn_text'}},
      {id:'5', enabled:true, type:'terms', schema:'bucket', params:{field:'page_url',  size:1,  orderBy:'1', order:'desc', customLabel:'page_url'}},
      {id:'6', enabled:true, type:'terms', schema:'bucket', params:{field:'module',    size:1,  orderBy:'1', order:'desc', customLabel:'module'}}
    ],
    params: {
      perPage: 20, showPartialRows: false, showMetricsAtAllLevels: true,
      sort: { columnIndex: null, direction: null },
      showTotal: false, totalFunc: 'sum',
      dimensions: {
        buckets: [{accessor:1,label:'trace_id'},{accessor:2,label:'branch'},{accessor:3,label:'btn_text'},{accessor:4,label:'page_url'},{accessor:5,label:'module'}],
        metrics: [{accessor:0,label:'max_duration_ms'}]
      }
    }
  }),
  uiStateJSON: '{}',
  description: '排查慢分支',
  savedSearchId: null,
  version: 1,
  kibanaSavedObjectMeta: { searchSourceJSON: JSON.stringify({index:IDX_PAT_ID, query:{language:'kuery', query:''}, filter:[]}) }
}, [refIndex(IDX_PAT_ID), refIndexViz(IDX_PAT_ID)]);

// ---------- 2-e) Viz: Metrics (Total Clicks / Fallback Count / P99) ----------
const vizMetId = 'qaxqjt-viz-metrics';
const vizMet = so('visualization', vizMetId, {
  title: 'QAX-QJT · 总览关键指标（点击量 · 兜底次数 · P99延迟）',
  visState: JSON.stringify({
    title: '关键指标',
    type: 'metric',
    aggs: [
      {id:'1', enabled:true, type:'count', schema:'metric', params:{customLabel:'总点击数'}},
      {id:'2', enabled:true, type:'count', schema:'metric', params:{customLabel:'兜底命中(DBF+SP)', filter:{query:'module:DBF OR module:SP'}}},
      {id:'3', enabled:true, type:'percentiles', schema:'metric', params:{field:'duration_ms', percents:[99], customLabel:'P99 duration_ms'}},
      {id:'4', enabled:true, type:'value_count', schema:'metric', params:{field:'trace_id', customLabel:'去重链路数'}}
    ],
    params: {
      addTooltip: true, addLegend: false, type: 'metric',
      metric: { percentageMode:false, useRanges:false, colorSchema:'Green to Red', metricColorMode:'Labels', colorsRange:[{from:0,to:100000}], labels:{show:true} },
      dimensions: {
        metrics: [
          {accessor:0,label:'总点击数',format:{id:'number',params:{pattern:'0,0'}}},
          {accessor:1,label:'兜底命中(DBF+SP)',format:{id:'number',params:{pattern:'0,0'}}},
          {accessor:2,label:'P99 duration_ms',format:{id:'number',params:{pattern:'0,0.0'}}},
          {accessor:3,label:'去重链路数',format:{id:'number',params:{pattern:'0,0'}}}
        ],
        buckets: []
      }
    }
  }),
  uiStateJSON: '{}',
  description: '',
  savedSearchId: null,
  version: 1,
  kibanaSavedObjectMeta: { searchSourceJSON: JSON.stringify({index:IDX_PAT_ID, query:{language:'kuery', query:''}, filter:[]}) }
}, [refIndex(IDX_PAT_ID), refIndexViz(IDX_PAT_ID)]);

// ---------- 3) Dashboard: 2x3 grid ----------
const dashId = 'qaxqjt-dashboard-perf-overview';
const dashboard = so('dashboard', dashId, {
  title: '🎭 秦安县秦剧团 · Admin 按钮兜底 Perf 总览（QAX-QJT v20260804）',
  description: '对应通用复制模板 v20260804-2 输出的 JSON Perf 日志，需 Filebeat/Logstash 写入到索引 qaxqjt-admin-perf-*',
  version: 1,
  kibanaSavedObjectMeta: { searchSourceJSON: JSON.stringify({filter:[], query:{language:'kuery',query:''}}) },
  panelsJSON: JSON.stringify([
    {id:vizMetId, type:'visualization', panelIndex:'1', embeddableConfig:{}, gridData:{x:0,y:0,w:48,h:8,i:'panel-1'}, version:'7.17.0'},
    {id:vizP95Id, type:'visualization', panelIndex:'2', embeddableConfig:{}, gridData:{x:0,y:8,w:24,h:15,i:'panel-2'}, version:'7.17.0'},
    {id:vizRpsId, type:'visualization', panelIndex:'3', embeddableConfig:{}, gridData:{x:24,y:8,w:24,h:15,i:'panel-3'}, version:'7.17.0'},
    {id:vizPieId, type:'visualization', panelIndex:'4', embeddableConfig:{}, gridData:{x:0,y:23,w:16,h:15,i:'panel-4'}, version:'7.17.0'},
    {id:vizTblId, type:'visualization', panelIndex:'5', embeddableConfig:{}, gridData:{x:16,y:23,w:32,h:15,i:'panel-5'}, version:'7.17.0'}
  ]),
  timeRestore: true,
  timeTo: 'now',
  timeFrom: 'now-24h',
  optionsJSON: JSON.stringify({ darkTheme:false, hidePanelTitles:false, useMargins:true, syncCursor:true, syncColors:true }),
  tags: ['qaxqjt','admin','perf','deadbutton-fallback']
}, [
  {name:'panel_0', type:'visualization', id:vizMetId},
  {name:'panel_1', type:'visualization', id:vizP95Id},
  {name:'panel_2', type:'visualization', id:vizRpsId},
  {name:'panel_3', type:'visualization', id:vizPieId},
  {name:'panel_4', type:'visualization', id:vizTblId}
]);

// ---------- 写出 NDJSON（每行一个对象） ----------
const objs = [indexPattern, vizP95, vizRps, vizPie, vizTbl, vizMet, dashboard];
const lines = objs.map(o => JSON.stringify(o));
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf-8');
console.log('✅ 已生成 Kibana Dashboard 配置:', OUT);
console.log('   · 文件行数（Saved Objects 数）:', objs.length);
console.log('   · 文件大小 (KB):', (fs.statSync(OUT).size / 1024).toFixed(1));
console.log('');
console.log('【导入步骤】');
console.log('  1. 登录 Kibana → 进入 ☰ → Stack Management → Saved Objects');
console.log('  2. 右上角 Import → 选择文件：', path.relative(process.cwd(), OUT));
console.log('  3. 点击 Import（若提示已存在 → 选 Automatically overwrite conflicts）');
console.log('  4. 打开 Dashboard：搜索 "秦安县秦剧团 · Admin 按钮兜底 Perf 总览"');
console.log('');
console.log('【Logstash pipeline 参考配置】（写到 elk/logstash_pipeline_qaxqjt_perf.conf 也给你一份）');

// ---------- 附赠：Logstash pipeline 配置示例 ----------
const logstashConf = `# =====================================================
#  Logstash Pipeline：采集 秦安县秦剧团 Admin 按钮兜底 Perf 日志
#  日志格式：NDJSON（一行一条 JSON） → 文件放在 /var/log/qaxqjt/*.log
#  使用：logstash -f logstash_pipeline_qaxqjt_perf.conf
# =====================================================
input {
  # 方式一：从本地日志文件采集（推荐 Filebeat → Logstash）
  file {
    path => "/var/log/qaxqjt/admin-perf-*.log"
    codec => json_lines { charset => "UTF-8" }
    start_position => "beginning"
    sincedb_path => "/var/lib/logstash/sincedb_qaxqjt"
    type => "qaxqjt-admin-perf"
  }
  # 方式二：直接接收 Filebeat 5044 端口上报（推荐生产）
  beats {
    port => 5044
    include_codec_tag => false
    ssl => false
  }
}

filter {
  # 再次确认 JSON 解析（双重保险）
  if [type] == "qaxqjt-admin-perf" or ([fields][service] == "qaxqjt-admin") {
    if ![service] { json { source => "message" skip_on_invalid_json => true } }

    # 把 duration_ms / lock_wait_ms 转成 long（避免 ES 动态映射成 text）
    mutate {
      convert => {
        "duration_ms"  => "integer"
        "lock_wait_ms" => "integer"
      }
      add_field => { "[@metadata][target_index]" => "qaxqjt-admin-perf-%{+YYYY.MM.dd}" }
      remove_field => ["@version", "path", "host", "message", "type"]
    }

    # GeoIP（可选）：如果 page_url 里带客户端 IP，可以在这里做 Geo 补充
    # geoip { source => "[user_agent]" target => "[geoip]" }
  }
}

output {
  if [@metadata][target_index] =~ /^qaxqjt-admin-perf/ {
    elasticsearch {
      hosts  => ["http://elasticsearch:9200"]
      index  => "%{[@metadata][target_index]}"
      action => "index"
    }
    # 调试：把合法 JSON 再打印一份到 stdout（可关掉）
    # stdout { codec => rubydebug { metadata => true } }
  }
}
`;
fs.writeFileSync(path.join(OUT_DIR, 'logstash_pipeline_qaxqjt_perf.conf'), logstashConf, 'utf-8');
console.log('   + 已生成 Logstash pipeline 配置示例:', path.join(OUT_DIR, 'logstash_pipeline_qaxqjt_perf.conf'));
