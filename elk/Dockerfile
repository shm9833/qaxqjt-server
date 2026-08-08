# ==================================================================
#   秦安县秦剧团 · Admin Perf P99 日报
#   Dockerfile · 生产镜像（K8s CronJob 调度用）
# ==================================================================
#   构建侧（CI 提交）：修改本文件后提交到代码仓库 → 触发 CI 产出新镜像
#   部署侧（CD 引用）：更新 K8s YAML 里的 image tag/digest
# ==================================================================
# 基础镜像：Debian bookworm + Python 3.11 slim（体积小，安全漏洞面小）
ARG PY_VER=3.11-slim-bookworm
FROM python:${PY_VER}

LABEL maintainer="秦安县秦剧团云端预约系统运维 <ops@qaxqjt.local>"
LABEL description="QAXQJT Admin Perf P99 Daily Report Mailer - CronJob Image"

# ---------- 0. shell pipefail（强制依赖安装失败直接中断构建，不静默）----------
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# ---------- 1. 时区固定为 Asia/Shanghai（避免容器默认 UTC 导致日报提前/延后8h）----------
ENV TZ=Asia/Shanghai \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN set -eux; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        tzdata \
        curl \
    ; \
    ln -sf /usr/share/zoneinfo/${TZ} /etc/localtime; \
    echo "${TZ}" > /etc/timezone; \
    dpkg-reconfigure --frontend noninteractive tzdata 2>&1 | tail -3; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*;

# ---------- 2. 非 root 用户运行（安全最佳实践：避免容器以 root 写入宿主机卷）----------
RUN set -eux; \
    groupadd --system --gid 1001 qaxqjt; \
    useradd --system --uid 1001 --gid qaxqjt --create-home --home-dir /app qaxqjt;

WORKDIR /app

# ---------- 3. 复制脚本（先装依赖，再复制源码；利用 Docker layer cache）----------
# 注：daily_mailer.py 仅使用 Python 标准库，无 requirements 需求，故跳过 pip install
# 如果后续新增第三方依赖（如 elasticsearch-py / requests-toolbelt 等），取消下面两行注释：
# COPY requirements.txt ./
# RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=qaxqjt:qaxqjt daily_mailer.py        ./
COPY --chown=qaxqjt:qaxqjt elk_p99_report.py      ./

# ---------- 4. 构建时关键断言（防止构建步骤静默失败产出残缺镜像）----------
#    · 两个脚本文件必须可读
#    · Python 能成功 import（无语法错误、无 ImportError）
#    · daily_mailer.py --help 能正常输出（argparse 初始化正确）
RUN set -eux; \
    test -r daily_mailer.py; \
    test -r elk_p99_report.py; \
    python -c "import sys; sys.path.insert(0, '/app'); import daily_mailer, elk_p99_report; print('[BUILD_ASSERT] module import OK: daily_mailer + elk_p99_report')"; \
    python daily_mailer.py --help > /dev/null; \
    python daily_mailer.py --gen-example > /tmp/config_example.json; \
    test -s /tmp/config_example.json; \
    echo "[BUILD_ASSERT] daily_mailer.py --gen-example output size: $(wc -c < /tmp/config_example.json) bytes";

# ---------- 5. 运行期持久化目录（K8s 会把 PVC / emptyDir 挂过来）----------
#    挂载点：
#      /data/config   → 存放 config_daily_report.json（通常由 ConfigMap/Secret 挂载）
#      /data/reports  → 输出 HTML 报表（挂 PVC 长期保存，或 emptyDir 仅本次）
#      /data/logs     → 输出结构化日志（挂 PVC 或由容器日志采集器直接拿 stdout）
RUN set -eux; \
    mkdir -p /data/config /data/reports /data/logs; \
    chown -R qaxqjt:qaxqjt /data /app;

USER qaxqjt

# 默认入口：daily_mailer.py，默认用 --config /data/config/config_daily_report.json
# 运行期可覆盖：docker run ...  python daily_mailer.py --dry-run / --test-smtp / --mock-es 等
ENTRYPOINT ["python", "daily_mailer.py"]
CMD ["--config", "/data/config/config_daily_report.json"]
