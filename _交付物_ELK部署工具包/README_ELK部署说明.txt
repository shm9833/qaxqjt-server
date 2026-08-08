═══════════════════════════════════════════════════════════════════════════
  秦安县秦剧团云端预约系统 · Admin 按钮兜底 Perf 监控
  ELK 部署工具包  使用说明（给运维/测试工程师）
═══════════════════════════════════════════════════════════════════════════

本工具包包含：
  ├── kibana_dashboard_qaxqjt_perf.ndjson     Kibana 一键导入配置（1 Index Pattern + 5 Viz + 1 Dashboard）
  ├── logstash_pipeline_qaxqjt_perf.conf      Logstash Pipeline 配置（采集 → 过滤 → 写入 ES）
  └── README_ELK部署说明.txt                  本文件

═══════════════════════════════════════════════════════════════════════════

【步骤 1 / 3 · 建立 ES 索引模板（一次性）】
--------------------------------------------------------
  在 Kibana DevTools 或 curl 执行以下 PUT，建好动态映射模板，
  确保 duration_ms / lock_wait_ms 是 integer 而不是被动态映射成 text：

  ---------------------------------------------------------------------
  PUT _index_template/qaxqjt-admin-perf
  {
    "index_patterns": ["qaxqjt-admin-perf-*"],
    "priority": 500,
    "template": {
      "settings": {
        "number_of_shards":   1,
        "number_of_replicas": 0,
        "refresh_interval":   "1s"
      },
      "mappings": {
        "properties": {
          "@timestamp":   { "type": "date" },
          "level":        { "type": "keyword" },
          "service":      { "type": "keyword" },
          "trace_id":     { "type": "keyword" },
          "span_id":      { "type": "keyword" },
          "module":       { "type": "keyword" },
          "event":        { "type": "keyword" },
          "branch":       { "type": "keyword" },
          "btn_text":     { "type": "keyword" },
          "btn_selector": { "type": "keyword" },
          "bound":        { "type": "boolean" },
          "lock_wait_ms": { "type": "integer" },
          "duration_ms":  { "type": "integer" },
          "page_url":     { "type": "keyword" },
          "user_agent":   { "type": "keyword" },
          "extra":        { "type": "object", "enabled": false }
        }
      }
    }
  }
  ---------------------------------------------------------------------

【步骤 2 / 3 · 配置 Logstash / Filebeat 采集】
--------------------------------------------------------
  方式 A（Logstash 独立采集）：
    1. 把浏览器控制台输出的 JSON 日志（F12 右键 → Save as... / 或用 Filebeat 读 .har）
       保存到 /var/log/qaxqjt/admin-perf-*.log （每行一个 JSON 对象，NDJSON）
    2. 把本包中的 logstash_pipeline_qaxqjt_perf.conf 拷贝到：
         /etc/logstash/conf.d/qaxqjt-admin-perf.conf
    3. 启动 Logstash：
         logstash -f /etc/logstash/conf.d/qaxqjt-admin-perf.conf
       或 systemctl restart logstash

  方式 B（Filebeat → Logstash 推荐生产）：
    1. 浏览器端用 Filebeat（或自己写的采集 Agent）把 NDJSON 推到 5044 端口
    2. Logstash 用 beats input 接 conf 里已经写好的 5044 端口段，自动应用同样的 filter

【步骤 3 / 3 · 导入 Kibana Dashboard】
--------------------------------------------------------
  1. 登录 Kibana → 左侧菜单 ☰ → Stack Management → Saved Objects
  2. 右上角：Import → 选择文件 kibana_dashboard_qaxqjt_perf.ndjson
  3. 如果提示 "Conflicts detected"：勾选 "Automatically overwrite conflicts" → Import
  4. 导入成功后：
     - 左侧菜单 ☰ → Dashboard
     - 搜索「🎭 秦安县秦剧团 · Admin 按钮兜底 Perf 总览」
     - 建议设置时间范围为 "Last 24 hours" 或 "Last 1 hour" 即可看到图表

【可选：用 Python 脚本生成离线 P99 报表】
--------------------------------------------------------
  在部署工具包附带的 elk_p99_report.py （可独立运行）：
     pip install requests    # 仅需 requests 库
     # 配置方式：
     export ES_HOST="http://es:9200"            # 或 Windows set ES_HOST=...
     export ES_USER="elastic"
     export ES_PASS="changeme"
     python3 elk_p99_report.py
  → 输出同目录下 qaxqjt_p99_report_YYYYMMDD_HHMMSS.html ，双击即可浏览器打开

【FAQ】
--------------------------------------------------------
Q: 索引 qaxqjt-admin-perf-YYYY.MM.DD 不自动生成？
A: 检查 Logstash output 的 elasticsearch hosts 是否能 ping 通；
   检查 filter 段是否加错 mutate 导致 @metadata.target_index 为空。

Q: Dashboard 里只显示"No results"？
A: ①把 Kibana 时间范围从"Last 15 minutes"调大到"Last 24 hours"；
   ②确认索引里真的有数据（DevTools: GET qaxqjt-admin-perf-*/_search?size=1 看 hits）。

Q: duration_ms / P99/P95 显示不正常？
A: DevTools 查看 mapping：GET qaxqjt-admin-perf-*/_mapping，确保 duration_ms 是 integer。
   若是 text → 删除当前日期索引，按步骤1重新建 index template 后再写入。

═══════════════════════════════════════════════════════════════════════════
技术对接：
  · Dashboard 版本：兼容 Kibana 7.17 / 8.x（已在 7.17 schema 导出）
  · Logstash pipeline 版本：Logstash 7.x / 8.x 通用
═══════════════════════════════════════════════════════════════════════════
