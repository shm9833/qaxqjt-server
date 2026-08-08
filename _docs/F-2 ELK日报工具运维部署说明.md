# 秦安县秦剧团 · Admin Perf P99 日报 · 运维部署说明

> 📘 **目标**：让一台 Windows 机器 **每天凌晨 2:00** 自动从 ELK 拉取性能数据、生成 P99 报表，并把 **HTML 报表 + CSV 附件** 以邮件形式发给相关人员。

---

## 📦 文件清单（本 zip 解压后全部可见）

| 序号 | 文件名 | 说明 |
|:---:|---|---|
| 1 | `daily_mailer.py` | 日报主脚本（拉 ES → 生成 HTML → 发邮件，带结构化异常日志+排错建议） |
| 2 | `elk_p99_report.py` | ES 查询聚合 + HTML 渲染模块（daily_mailer.py 依赖，勿单独删除） |
| 3 | `config_daily_report_TESTENV.json` | ✅ **推荐用这个模板**：测试环境配置模板（中文注释 + ES/SMTP 服务商速查表） |
| 4 | `config_daily_report.example.json` | 最简配置示例（无注释，熟悉后可直接用） |
| 5 | `run_daily_mailer_wrapper.bat` | 调度 Wrapper（由计划任务调用）：**防重复运行 + 失败30分钟重试3次 + 完整日志** |
| 6 | `install_daily_report_WINDOWS.bat` | **一键安装计划任务** → `右键 → 以管理员身份运行` |
| 7 | `uninstall_daily_report_WINDOWS.bat` | 一键卸载计划任务 → `右键 → 以管理员身份运行` |
| 8 | `install_daily_report_cron_LINUX.sh` | Linux cron 安装脚本（可选，线上服务器用） |
| 9 | `install_daily_report_macos.sh` | macOS launchd 安装脚本（可选） |
| 10 | `logstash_pipeline_qaxqjt_perf.conf` | Logstash 管道：Nginx Access Log → Elasticsearch（配置 ELK 时用） |
| 11 | `kibana_dashboard_qaxqjt_perf.ndjson` | Kibana 仪表盘模板（可直接导入 Kibana，可视化 P99/P95 等） |
| 12 | `qaxqjt_p99_daily_XXXXXXXX.html` | 本次 dry-run 生成的**示例测试报告**（参考用，看看长啥样） |
| 13 | `运维部署说明.md` / `.txt` | 本文件（Markdown版放入项目Wiki，txt 版随 zip 发运维） |

---

## 🚀 部署步骤（5 步搞定，预计 10 分钟）

### 第 1 步 · 解压 + 安装 Python 3（没装的话）

- 解压本 zip 到一个**固定目录**（路径不要有空格最好），建议路径：
  ```
  C:\QAXQJT\ELK_Daily_Report\
  ```
- 安装 Python 3.10+：<https://www.python.org/downloads/windows/>
- ⚠️ **安装时必须勾选最顶部的 "Add Python to PATH"**（否则 CMD 里找不到 `py` 命令）
- **验证安装成功**：打开一个**新的 CMD 窗口**（必须新的！），执行：
  ```cmd
  py --version
  ```
  能看到 `Python 3.x.x` 就说明 OK。

---

### 第 2 步 · 填写配置文件（最关键的一步！）

1. 复制模板文件并改名：
   ```
   config_daily_report_TESTENV.json  →  config_daily_report.json
   ```
2. 编辑 `config_daily_report.json`，把下面 **10 个必填字段** 填成真实值：

| 配置字段 | 说明 / 示例 |
|---|---|
| `es.host` | ES 地址（带协议 + 端口）：`http://192.168.1.100:9200` 或腾讯云 ES 的 `https://es-cn-xxx.public.tencentelasticsearch.com:9200` |
| `es.index` | 索引匹配模式：`qaxqjt-admin-perf-*` 或 `nginx-*` |
| `es.user` | ES 用户名（开了 X-Pack 安全就填 `elastic`） |
| `es.password` | ES 密码 |
| `smtp.server` | 发件 SMTP 服务器：见下方速查表（QQ 企业邮 `smtp.exmail.qq.com`） |
| `smtp.port` | **推荐填 `465`（SSL 加密，最稳）** |
| `smtp.username` | 完整发件邮箱：`report@yourcompany.com` |
| `smtp.password` | ⚠️ **客户端授权码 / 应用专用密码**！不是网页登录密码（QQ/163 必须用授权码） |
| `smtp.sender_email` | 同上，填完整发件邮箱地址 |
| `recipients` | 收件人数组：`["zhangsan@your.com","lisi@your.com"]` |

> 💡 **常见 SMTP 服务商参数速查表**（模板里也内置了）：
> | 邮箱类型 | SMTP 服务器 | 端口 | 加密模式 |
> |---|---|---|---|
> | QQ 企业邮 (exmail.qq.com) | `smtp.exmail.qq.com` | 465 | SSL ✅（推荐） |
> | QQ 个人邮 (qq.com) | `smtp.qq.com` | 465 | SSL |
> | 163 / 126 邮箱 | `smtp.163.com` | 465 | SSL |
> | 阿里企业邮 | `smtp.qiye.aliyun.com` | 465 | SSL |
> | Gmail | `smtp.gmail.com` | 465 | SSL（需应用专用密码） |
> | Outlook / Office365 | `smtp.office365.com` | 587 | STARTTLS |

---

### 第 3 步 · 手动验证 2 条命令（必须先跑！不然定时任务也会失败）

打开 CMD，cd 到解压目录，依次跑：

#### ✅ 验证 1 · dry-run（拉 ES 生成报表，**不发邮件**）
```cmd
C:
cd C:\QAXQJT\ELK_Daily_Report\
py daily_mailer.py --dry-run --config config_daily_report.json
```
> 成功标识：最后一行打印 `[FINAL_STATUS] exit_code=0 status=OK`，且 `reports/` 目录下生成了一个新的 HTML 文件。

#### ✅ 验证 2 · test-smtp（发一封测试连通邮件）
```cmd
py daily_mailer.py --test-smtp --config config_daily_report.json
```
> 成功标识：`recipients` 里填的所有人都收到一封标题为 `[测试SMTP连通性] YYYY-MM-DD HH:MM:SS` 的邮件。

> ⚠️ **两条命令必须都 PASS 再继续下一步**。如果失败了，直接看 `logs/` 目录下的日志（见"日常维护 → 查日志"章节）。

---

### 第 4 步 · 一键安装 Windows 计划任务

1. 找到文件：`install_daily_report_WINDOWS.bat`
2. **右键 → 以管理员身份运行**（一定要管理员！创建计划任务需要系统权限）
3. 脚本会自动完成以下流程：
   ```
   [0/5] 基础环境检查（Python/配置文件/脚本文件）
   [1/5] dry-run 快速校验
   [2/5] 清理旧同名任务（如果有）
   [3/5] 创建计划任务：每天 02:00 运行 + 失败重试 + 唤醒 + 防并发
   [4/5] 立即手动触发一次（验证调度能正常拉起）
   [5/5] 打印任务状态
   ```
4. 看到最后绿色的 "✅ 安装成功" 就搞定了！
5. 计划任务信息（记住任务名，后续日常维护要用）：
   | 参数 | 值 |
   |---|---|
   | 任务名 | `QAXQJT_Perf_P99_Daily` |
   | 触发时间 | **每天凌晨 02:00** |
   | 失败重试 | 最多 3 次，每次间隔 30 分钟（任务计划 + Wrapper **双重保障**） |
   | 唤醒策略 | 唤醒计算机运行此任务 |
   | 多实例策略 | 忽略新实例（防止 2:00 上一次没跑完又拉一次） |
   | 执行时长限制 | 2 小时（防脚本卡死） |

---

### 第 5 步 · 验收

等 1~2 分钟（刚手动触发了一次，启动需要时间），然后依次检查 3 件事：

1. ✅ **调度层面**：打开 `logs/scheduler.log`，最后一行有：
   ```
   [YYYY-MM-DD HH:MM:SS] [RUNNER] 第 1 次运行 SUCCESS
   ```
2. ✅ **脚本层面**：打开 `logs/daily_mailer_YYYYMMDD.log`，最后一行有：
   ```
   [YYYY-MM-DD HH:MM:SS] [FINAL_STATUS] exit_code=0 status=OK summary=日报发送成功 ...
   ```
3. ✅ **邮件层面**：收件人邮箱里收到当天标题为 `【测试环境 / 生产环境】秦剧团 Admin 性能 P99 日报 · YYYY-MM-DD` 的邮件，带 **HTML 报表附件 + CSV 附件**。

🎉 3 件事全中 → **验收通过！** 🎉

---

## 🛠 日常维护（运维常用命令）

### 📋 计划任务操作（CMD 里直接敲）

| 操作 | 命令 |
|---|---|
| 查看任务详情 | `schtasks /Query /TN "QAXQJT_Perf_P99_Daily" /V /FO LIST` |
| **立即手动执行**（临时补跑一天的） | `schtasks /Run /TN "QAXQJT_Perf_P99_Daily"` |
| 强制结束正在运行的任务 | `schtasks /End /TN "QAXQJT_Perf_P99_Daily"` |
| 卸载计划任务 | 右键管理员运行 `uninstall_daily_report_WINDOWS.bat` |

### 🔍 查日志（99% 的问题看这 3 个文件就够了）

| 你想查什么 | 命令（CMD） | 看关键字 |
|---|---|---|
| 某天日报最终发成功了吗？ | `findstr /C:"[FINAL_STATUS]" "logs\daily_mailer_20260804.log"` | `exit_code=0` 就成功了 |
| 所有调度记录（哪天跑了/哪天失败/重试了几次） | `type logs\scheduler.log` | `[RUNNER] SUCCESS / FAIL` |
| 某天完整的脚本输出（stdout + stderr 全量） | `type "logs\task_runner_20260804.log"` | 看报错 stack trace |

> ⚡ **极速排错口诀**：先看 `scheduler.log` 有没有记录（任务调没调起来？）→ 再看 `daily_mailer_YYYYMMDD.log` 的 `[FINAL_STATUS]` 和 `[ES_QUERY_RESULT] / [EMAIL_SEND_RESULT]` 关键字（定位是 ES 还是 SMTP 问题）→ 最后看 `task_runner_YYYYMMDD.log` 全量输出查上下文。

---

## ❓ FAQ · 常见问题排查

### Q1: dry-run 报错 `ES 查询失败 / getaddrinfo failed`（网络不通）
> 检查：部署机器能否 `ping` 通 ES 的 host？防火墙（包括系统防火墙+云安全组）有没有放通 **9200** 端口？能否 `telnet ES_HOST 9200`？

### Q2: `SMTPAuthenticationError 535 登录失败`
> ⚠️ 99% 的原因是：**你填的是网页登录密码，而不是"客户端授权码/应用专用密码"！**
>
> 解决：QQ/163 邮箱登录网页版后台 → 找到"SMTP 服务/客户端授权码"→ 开启服务 → 获取一串 16 位左右的授权码 → 粘贴到 `smtp.password` 字段。

### Q3: 凌晨 2 点没人收邮件，但手动执行就正常
> 两种可能性排查：
> 1. **电脑关机/睡眠了**：虽然脚本开启了"WakeToRun 唤醒运行"，但 BIOS 里也要开启"允许定时器唤醒/唤醒计算机"（Windows 电源设置里也检查一下"睡眠 → 允许唤醒定时器"）
> 2. **任务确实没触发 / 触发了但失败**：打开 `logs/scheduler.log`，看 2:00 左右有没有 `[RUNNER]` 记录
>    - 没有记录 → 任务没触发（检查计划任务是否启用、账户密码是否过期）
>    - 有记录但是 `FAIL` → 按上面"查日志"章节继续定位 ES/SMTP 配置问题

### Q4: 生成的报表里 P99/P50 全是 0，样本量是 0
> 99% 的原因是 `es.index` 写错了，或者那个索引里**没有 trace_id/latency_ms 等字段**（即数据格式不符合要求）。
>
> 先去 Kibana Dev Tools 查一下索引里有没有数据：
> ```json
> GET qaxqjt-admin-perf-*/_search?size=1
> { "query": { "match_all": {} } }
> ```

### Q5: 想改触发时间（比如改成每天凌晨 3:00）
1. 打开 `install_daily_report_WINDOWS.bat`
2. 搜索关键字 `02:00`（2 处：PowerShell `$startTime='02:00'` + schtasks `/ST 02:00`），全部改成目标时间（如 `03:00`）
3. 保存后**再次右键管理员运行这个 bat**（会自动覆盖同名旧任务）

---

## 📋 日志关键字速查表（直接 findstr / grep 搜这些即可秒定位）

| 关键字 | 含义 | 严重级别 |
|---|---|---|
| `[FINAL_STATUS]` | ✅ daily_mailer **最终成败**（`exit_code=0 status=OK` 成功 / `status=FAIL(xx)` 失败 + 失败摘要） | 必看！ |
| `[TASK_BEGIN]` | daily_mailer 启动（会打印 pid/dry_run/test_smtp/hours 等参数） | INFO |
| `[ES_QUERY_BEGIN]` / `[ES_QUERY_RESULT]` | **ES 查询阶段**：连接 / 查询 / 聚合提取成功失败，失败了会带 `排错建议=xxx` | 失败 ERROR |
| `[SMTP_CONNECT_BEGIN]` / `[SMTP_CONNECT_RESULT]` | **SMTP 连接阶段**：握手 / SSL / 认证成功失败，失败了带 `排错建议=xxx` | 失败 ERROR |
| `[EMAIL_BUILD_RESULT]` | MIME 邮件构建（附件是否存在 / 中文文件名编码） | 失败 ERROR |
| `[EMAIL_SEND_RESULT]` | **邮件发送阶段**：发件人/收件人被拒 / 附件超限 / 被判定垃圾邮件 | 失败 ERROR |
| `[test-smtp FAIL]` / `[PHASE_SEND_EMAIL FAIL]` | test-smtp / 正式发送失败的 stack trace 汇总 | ERROR |
| `[CLEANUP_OLD SOFT_FAIL]` | 清理 30 天前旧报表失败（不影响主流程，可忽略） | WARN |
| `[RUNNER] SUCCESS / FAIL` | **scheduler 层面**每次运行的一行摘要（wrapper 打出来的，带重试次数） | 日常巡检 |
| `[UNEXPECTED_EXCEPTION]` | ⚠️ 未预见异常（不是 ES/SMTP 常规错误，需要研发介入排查） | 告警 |

---

## 📞 排错流程图（快速判断问题属于哪一环节）

```
没收到邮件
   │
   ├─► 查 scheduler.log 有没有 [RUNNER]？
   │      ├─ 没有 → ❌ 计划任务没调起来 → 检查任务计划是否启用/机器是否开机/BIOS唤醒
   │      └─ 有 → 往下
   │
   ├─► 查 daily_mailer_YYYYMMDD.log 的 [FINAL_STATUS] exit_code=？
   │      ├─ 0 (OK) → ✅ 脚本发成功了，去垃圾箱/订阅文件夹找邮件
   │      ├─ 3 (报表生成失败) → ❌ ES 侧问题 → 看 [ES_QUERY_RESULT] FAIL 里的 排错建议=
   │      ├─ 4 (邮件发送失败) → ❌ SMTP 侧问题 → 看 [SMTP_CONNECT_RESULT] / [EMAIL_SEND_RESULT] FAIL 的 排错建议=
   │      └─ 其他 → 查 [UNEXPECTED_EXCEPTION] → 需要研发介入
   │
   └─► 还看不懂？把 3 个日志文件（scheduler.log / daily_mailer_当天.log / task_runner_当天.log）打包发研发即可 ✅
```
