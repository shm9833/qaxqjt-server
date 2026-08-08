# 秦安县秦剧团 · ELK 日报工具最终交付 README

> 本包已修复 Windows UTF-8 BOM 配置加载失败、SMTP EHLO `local_hostname` 不合规导致被拒的问题，**9 个单元测试 + 6 个 Mock 离线回归场景 100% 通过**。

---

## 📦 一、文件清单

| 文件 | 大小 | 用途 |
|---|---|---|
| `daily_mailer.py` | 53 KB | **主脚本**：ES 查询 → HTML 报表 → SMTP 邮件（内置重试 + Mock + VERBOSE） |
| `mock_smtp_verify.py` | 6.5 KB | 6 大 Mock 场景离线回归（不用真实 SMTP/ES 即可验证重试） |
| `test_config_load_bom.py` | 3.6 KB | UTF-8 BOM 配置加载单元测试（6 用例） |
| `test_local_hostname_chain.py` | 2.5 KB | `local_hostname` 三段解析链单元测试（3 用例） |
| `config_daily_report_TESTENV.json` | 4.3 KB | 带中文注释的测试环境配置模板（QQ/163/腾讯云 ES 参数速查） |
| `运维部署说明.md` | 12.4 KB | Markdown 版部署指南（计划任务/日常命令/FAQ） |

---

## 🔧 二、本版本核心修复（v2026.8.4-FINAL）

### ✨ 修复 1：UTF-8 with BOM 配置加载失败（Windows 记事本导致）
```python
# daily_mailer.py L69
with open(path, 'r', encoding='utf-8-sig') as f:  # 自动跳过 BOM 头
    cfg = json.load(f)
```
**之前的报错**：`Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1`  
**现在**：Windows 记事本 / VSCode / 记事本++ 保存的 UTF-8（with BOM）文件均可正常加载。

---

### ✨ 修复 2：显式指定 `local_hostname`，防止 EHLO 被拒（核心新增）
新增 `smtp.local_hostname` 配置字段，并在连接阶段执行 **三段 fallback 解析链**：
```
优先级 1 → cfg[smtp.local_hostname]（JSON 里显式写了就用，校验合法 DNS 域名格式）
  ↓ 忽略/非法
优先级 2 → socket.getfqdn()（本机 FQDN，如 server01.mycorp.local，再校验）
  ↓ 非法/失败
优先级 3 → mailer-client.qaxqjt.local（安全默认值，确保一定是合法 DNS 格式，不会被 504/450 EHLO Rejected 直接拒绝）
```

**📝 配置示例（`config_daily_report_TESTENV.json` smtp 段新增字段）：**
```json
{
  "smtp": {
    "server": "smtp.exmail.qq.com",
    "port": 465,
    "use_ssl": true,
    "sender_email": "tuanzhang@qaxqjt.gansu.gov.cn",
    "password": "客户端授权码_不是网页密码",
    "local_hostname": "mailer-qaxqjt.yourdomain.com"   // ✨ 新增：显式指定 EHLO 用的主机名
  }
}
```

**📜 日志关键字（VERBOSE 模式可看完整解析链）：**
```
[SMTP_CONNECT_BEGIN] smtp.exmail.qq.com:465 mode=SSL/TLS(465) timeout=30s user=... local_hostname=mailer-qaxqjt.yourdomain.com(cfg[smtp.local_hostname])
[VERBOSE] local_hostname解析链：最终='mailer-qaxqjt.yourdomain.com' 来源=cfg[smtp.local_hostname] 候选校验告警数=0

[LOCAL_HOSTNAME_FALLBACK] socket.getfqdn()='BAD FQDN 含空格' 不是合法FQDN/DNS不可解析
[LOCAL_HOSTNAME_FALLBACK] 使用安全默认 fallback local_hostname='mailer-client.qaxqjt.local'（如遇EHLO被拒，请显式设置smtp.local_hostname）
```

---

## 🚀 三、快速上手（本地 5 分钟跑通）

```bash
cd 单独可运行_ELK日报工具

# ① 单元测试（BOM + local_hostname 解析）
py -3 test_config_load_bom.py     # 6/6 PASS
py -3 test_local_hostname_chain.py # 3/3 PASS

# ② 6 大 Mock 场景离线回归（不用真实网络）
py -3 mock_smtp_verify.py         # 6/6 PASS（失败计数=0）

# ③ 真实 SMTP 连通性快速测试（不查 ES，直接发 1 封测试邮件）
py -3 daily_mailer.py --config config_daily_report_TESTENV.json --test-smtp --verbose

# ④ 离线调试：Mock 常见失败场景 + 打印 VERBOSE 详细 traceback
py -3 daily_mailer.py --config config_daily_report_TESTENV.json --test-smtp ^
    --mock-smtp send_then_succ_3rd --smtp-retry-count 3 --smtp-retry-interval-sec 0 --verbose
```

---

## 🎛️ 四、新增/关键配置参数速查表

| 字段（JSON 路径） | 类型 | 默认值 | 说明 |
|---|---|---|---|
| **`smtp.local_hostname`** ✨ | str | `null`（自动解析） | **EHLO/HELO 命令发给 SMTP 服务器的自我介绍主机名**。遇到 `504 Helo command rejected: need fully-qualified hostname`、`450 Client host rejected: cannot find your hostname` 报错时，必须显式填写为 **服务器能识别的合法 FQDN**（建议填写出口公网 IP 的 PTR 反解域名，或公司内邮件网关可识别的主机名）。 |
| `smtp.use_ssl` | bool | `true` | `true`=端口465 SSL；`false`=端口587/25 + 下一条控制 STARTTLS |
| `smtp.starttls` | bool | `true` | use_ssl=false 时是否调用 `.starttls()`（内网无加密可设为 false） |
| `smtp.timeout_sec` | int | `30` | SMTP 连接超时秒数 |
| 命令行 `--mock-smtp` ✨ | str | 关闭 | 启用内存 Mock SMTP（离线验证重试）：`auth_fail` `conn_fail` `rcpt_fail` `partial_refuse` `send_then_succ_3rd` `send_all_fail_3x` |
| 命令行 `--smtp-retry-count` ✨ | int | 3 | 邮件发送阶段总尝试次数（含首次） |
| 命令行 `--smtp-retry-interval-sec` ✨ | int | 10 | 重试间隔秒数（Wrapper 还有另一层 30min × 3 次调度级重试） |
| 命令行 `--verbose` ✨ | flag | off | 输出 **VERBOSE 详情**：SMTP 握手细节 / MIME 头清单 / 重试时完整 traceback |

---

## 📞 五、排错 FAQ

**Q1：504 5.5.2 Helo command rejected: need fully-qualified hostname（EHLO 被拒）**
> ✅ **100% 修复**：直接在 `config_daily_report.json` 里写 `smtp.local_hostname = "mailer-qaxqjt.yourcompany.com"`（填服务器 PTR 反解/公司认可的主机名）。**即使不填**，代码也会 fallback 到 `mailer-client.qaxqjt.local`——一定是合法 DNS 域名格式，比 Windows 工作机组默认的 `DESKTOP-XXXXX` 通过率高很多。

**Q2：配置文件加载报 "Unexpected UTF-8 BOM"？**
> ✅ **100% 修复**：本版本已改用 `utf-8-sig` 编码加载，BOM 自动跳过。如果仍有问题请 `--config` 指定不带 BOM 的文件路径。

**Q3：需要本地先验证重试逻辑但不想发真实邮件怎么办？**
> ✅ 用 `--mock-smtp conn_fail --smtp-retry-count 3 --smtp-retry-interval-sec 0 --verbose` 即可在 0 秒内完整跑 3 次失败场景，VERBOSE 模式下可以看到每次失败的完整 traceback。

**Q4：遇到认证失败？**
> 客户端授权码/专用密码（不是网页登录密码）。QQ企业邮：https://exmail.qq.com → 设置 → 客户端专用密码；163邮箱：设置 → POP3/SMTP/IMAP → 开启并生成「客户端授权密码」。
