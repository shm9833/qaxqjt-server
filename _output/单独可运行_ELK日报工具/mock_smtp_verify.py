"""daily_mailer.py 6 大 Mock SMTP 失败场景验证脚本（Python3.14 兼容，纯内存 unittest.mock）
用法：cd elk && py -3 mock_smtp_verify.py （0<退出码=失败场景数）
"""
import os, sys, subprocess, json, tempfile, shutil, re, io

HERE = os.path.abspath(os.path.dirname(__file__))
SCRIPT = os.path.join(HERE, 'daily_mailer.py')
PY = sys.executable

# 共用的最小配置：ES 随便填（--test-smtp不会用到ES），SMTP 配成 fake 的
BASE_CFG = {
  'es': {'host':'http://none','index':'*','user':'','password':''},
  'smtp': {'server':'127.0.0.1','port':1,'use_ssl':False,'starttls':False,'sender_name':'MockBot','sender_email':'bot@mock.dev','password':'mock_pw_force_login'},
  'recipients': ['ok@mock.dev','bad-user@mock.dev'],
  'subject_prefix':'[TEST]','log_dir':'./logs','output_dir':'./reports'
}

# 场景定义：(mock_scenario, expected_exit_code, required_keywords_in_output, min_attempts, max_retries_in_log)
SCENARIOS = [
  (
    'auth_fail', 4,
    ['[TASK_BEGIN_EX] smtp_retry=3x@0s mock_smtp=auth_fail','[SMTP_MOCK_MODE_BEGIN] scenario=auth_fail',
     '[TEST_SMTP_RETRY_SLEEP attempt=1/3]',
     '[TEST_SMTP_RETRY_SLEEP attempt=2/3]','[TEST_SMTP_LOOP_RESULT] FAIL attempts_used=3/3',
     '[FINAL_STATUS] exit_code=4','FAIL(4)'],
    3, 2  # min attempts=3, retry sleep logs=2
  ),
  (
    'conn_fail', 4,
    ['[SMTP_MOCK_MODE_BEGIN] scenario=conn_fail','模拟 127.0.0.1:25 端口无监听',
     '[TEST_SMTP_RETRY_SLEEP attempt=1/3]','[TEST_SMTP_RETRY_SLEEP attempt=2/3]',
     '[TEST_SMTP_LOOP_RESULT] FAIL attempts_used=3/3','[FINAL_STATUS] exit_code=4','FAIL(4)'],
    3, 2
  ),
  (
    'rcpt_fail', 4,
    ['[SMTP_MOCK_MODE_BEGIN] scenario=rcpt_fail','[TEST_SMTP_ATTEMPT attempt=1/3] FAIL phase=sendmail reason=收件人被拒',
     '[TEST_SMTP_RETRY_SLEEP attempt=1/3]','[TEST_SMTP_RETRY_SLEEP attempt=2/3]',
     '[TEST_SMTP_LOOP_RESULT] FAIL attempts_used=3/3','[FINAL_STATUS] exit_code=4','FAIL(4)'],
    3, 2
  ),
  (
    'partial_refuse', 0,
    ['[SMTP_MOCK_MODE_BEGIN] scenario=partial_refuse',
     '[EMAIL_SEND_RESULT] PARTIAL_OK phase=test-smtp total=2 ok=1 refused=1',
     '[TEST_SMTP_LOOP_RESULT] OK attempts_used=1/3','[FINAL_STATUS] exit_code=0 status=OK'],
    1, 0  # 只需要1次，0次重试sleep
  ),
  (
    'send_then_succ_3rd', 0,
    ['[SMTP_MOCK_MODE_BEGIN] scenario=send_then_succ_3rd',
     '[TEST_SMTP_RETRY_SLEEP attempt=1/3]','[TEST_SMTP_RETRY_SLEEP attempt=2/3]',
     '[TEST_SMTP_ATTEMPT attempt=3/3] phase=sendmail OK',
     '[TEST_SMTP_LOOP_RESULT] OK attempts_used=3/3','[FINAL_STATUS] exit_code=0 status=OK',
     '[SMTP_MOCK_MODE_END] scenario=send_then_succ_3rd total_smtp_instances=3'],
    3, 2
  ),
  (
    'send_all_fail_3x', 4,
    ['[SMTP_MOCK_MODE_BEGIN] scenario=send_all_fail_3x',
     '[TEST_SMTP_RETRY_SLEEP attempt=1/3]','[TEST_SMTP_RETRY_SLEEP attempt=2/3]',
     '[TEST_SMTP_LOOP_RESULT] FAIL attempts_used=3/3','[FINAL_STATUS] exit_code=4','FAIL(4)',
     '[SMTP_MOCK_MODE_END] scenario=send_all_fail_3x total_smtp_instances=3'],
    3, 2
  ),
]


def run_scenario(scenario, cfg_dir):
    cfg_path = os.path.join(cfg_dir, f'cfg_{scenario}.json')
    scenario_log_dir = os.path.join(cfg_dir, f'logs_{scenario}')
    scenario_report_dir = os.path.join(cfg_dir, f'reports_{scenario}')
    os.makedirs(scenario_log_dir, exist_ok=True)
    os.makedirs(scenario_report_dir, exist_ok=True)
    cfg = dict(BASE_CFG)
    cfg['log_dir'] = scenario_log_dir
    cfg['output_dir'] = scenario_report_dir
    with open(cfg_path, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    env = dict(os.environ)
    env['PYTHONIOENCODING'] = 'utf-8'
    cmd = [PY, SCRIPT, '--test-smtp', '--config', cfg_path,
           '--mock-smtp', scenario,
           '--smtp-retry-count', '3',
           '--smtp-retry-interval-sec', '0',
           '--verbose']
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore', env=env, cwd=HERE)
    out = (r.stdout or '') + '\n' + (r.stderr or '')
    latest_log = ''
    if os.path.isdir(scenario_log_dir):
        logs = sorted([os.path.join(scenario_log_dir, x) for x in os.listdir(scenario_log_dir) if x.endswith('.log')], key=os.path.getmtime, reverse=True)
        if logs:
            try:
                with open(logs[0], encoding='utf-8', errors='ignore') as f:
                    latest_log = f.read()
            except Exception:
                pass
    combined = out + '\n---LOG---\n' + latest_log
    return r.returncode, combined, len(latest_log)


def main():
    total_fail = 0
    with tempfile.TemporaryDirectory(prefix='qaxqjt_mock_') as td:
        for (scenario, exp_code, req_kw, min_att, min_retries) in SCENARIOS:
            print(f'\n\n{"="*70}')
            print(f'🚀 SCENARIO: {scenario}  (expected exit={exp_code})')
            print(f'{"="*70}')
            code, out, log_bytes = run_scenario(scenario, td)
            # 基本退出码
            status = '✅ PASS' if code == exp_code else f'❌ FAIL (exit={code}  expect={exp_code})'
            print(f'① 退出码：{status}')
            if code != exp_code:
                total_fail += 1
            # 关键字命中
            hit_kw = 0
            for kw in req_kw:
                hit = kw in out
                if hit: hit_kw += 1
                print(('  ✅' if hit else '  ❌') + f' 关键字 {kw[:70]}' + ('…' if len(kw) > 70 else '') + f' → {"命中" if hit else "未命中"}')
            if hit_kw != len(req_kw):
                total_fail += 1
            # 重试次数统计
            n_attempt = len(re.findall(r'\[TEST_SMTP_ATTEMPT attempt=(\d+)', out))
            n_retries = len(re.findall(r'\[TEST_SMTP_RETRY_SLEEP attempt=(\d+)', out))
            print(f'③ 尝试次数：attempt_logged={n_attempt}（min={min_att}） retry_sleep={n_retries}（min={min_retries}）')
            if n_attempt < min_att or n_retries < min_retries:
                total_fail += 1
                print('  ❌ 重试次数不足')
            else:
                print('  ✅ 重试次数符合预期')
            print(f'（总日志大小：{len(out)} 字符 + logger 日志 {log_bytes} B）')
            # 失败时打印尾部 30 行
            if code != exp_code or hit_kw != len(req_kw):
                print('  ---------- 输出最后 30 行 ----------')
                lines = out.splitlines()
                for line in lines[-30:]:
                    print('   ', line)
    print(f'\n\n🏁 验证完成：总失败计数 = {total_fail}（0 = 全部通过）')
    sys.exit(total_fail)


if __name__ == '__main__':
    main()
