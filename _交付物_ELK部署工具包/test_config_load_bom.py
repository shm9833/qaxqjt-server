"""daily_mailer.py load_config 单元测试（内置 unittest，零额外依赖）
验证点：
  ① UTF-8 无 BOM 正常读取（回归基线）
  ② UTF-8 with BOM 正常读取（本次修复：utf-8-sig）
  ③ 缺少必填字段抛错（es.index / smtp.server 等）
  ④ 非法 JSON 语法抛错
  ⑤ 文件不存在抛 FileNotFoundError
运行：cd elk && py -3 test_config_load_bom.py
"""
import os
import sys
import json
import tempfile
import unittest
import copy
HERE = os.path.abspath(os.path.dirname(__file__))
sys.path.insert(0, HERE)
import daily_mailer as dm  # noqa: E402  (必须先 sys.path.insert 再 import)


VALID_CFG_DICT = {
    'es': {'host': 'http://es.example:9200', 'index': 'logs-*', 'user': '', 'password': ''},
    'smtp': {'server': 'smtp.example.com', 'port': 465, 'use_ssl': True, 'starttls': False,
             'sender_name': '测试', 'sender_email': 'bot@example.com', 'password': 'pw'},
    'recipients': ['a@example.com', 'b@example.com'],
    'subject_prefix': '[TEST]', 'log_dir': './logs', 'output_dir': './reports'
}


def _write_bytes(path: str, content_bytes: bytes) -> None:
    with open(path, 'wb') as f:
        f.write(content_bytes)


class TestLoadConfig(unittest.TestCase):

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp(prefix='dm_cfg_test_')

    def tearDown(self):
        import shutil
        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def _cfg_path(self, name: str) -> str:
        return os.path.join(self._tmpdir, name)

    # -------------- ①  UTF-8 无 BOM --------------
    def test_utf8_no_bom_ok(self):
        p = self._cfg_path('cfg_utf8_nobom.json')
        _write_bytes(p, json.dumps(VALID_CFG_DICT, ensure_ascii=False).encode('utf-8'))
        cfg = dm.load_config(p)
        self.assertEqual(cfg['es']['index'], 'logs-*')
        self.assertEqual(cfg['smtp']['sender_email'], 'bot@example.com')
        self.assertEqual(len(cfg['recipients']), 2)

    # -------------- ②  UTF-8 with BOM（重点修复点）--------------
    def test_utf8_with_bom_ok(self):
        p = self._cfg_path('cfg_utf8_bom.json')
        utf8_bom = b'\xef\xbb\xbf' + json.dumps(VALID_CFG_DICT, ensure_ascii=False).encode('utf-8')
        self.assertTrue(utf8_bom.startswith(b'\xef\xbb\xbf'))
        _write_bytes(p, utf8_bom)
        cfg = dm.load_config(p)
        self.assertEqual(cfg['es']['index'], 'logs-*')
        self.assertEqual(cfg['smtp']['sender_email'], 'bot@example.com')
        self.assertEqual(cfg['subject_prefix'], '[TEST]')

    # -------------- ③ 缺少必填字段 --------------
    def test_missing_es_index(self):
        bad = copy.deepcopy(VALID_CFG_DICT)
        del bad['es']['index']
        p = self._cfg_path('cfg_missing_es_index.json')
        _write_bytes(p, json.dumps(bad, ensure_ascii=False).encode('utf-8'))
        with self.assertRaises(ValueError):
            dm.load_config(p)

    def test_missing_smtp_server(self):
        bad = copy.deepcopy(VALID_CFG_DICT)
        del bad['smtp']['server']
        p = self._cfg_path('cfg_missing_smtp_server.json')
        _write_bytes(p, json.dumps(bad, ensure_ascii=False).encode('utf-8'))
        with self.assertRaises(ValueError):
            dm.load_config(p)

    # -------------- ④ 非法 JSON 语法 --------------
    def test_invalid_json(self):
        p = self._cfg_path('cfg_broken.json')
        _write_bytes(p, b'{ this is not: [valid json }')
        with self.assertRaises(json.JSONDecodeError):
            dm.load_config(p)

    # -------------- ⑤ 文件不存在 --------------
    def test_file_not_found(self):
        with self.assertRaises(FileNotFoundError):
            dm.load_config(os.path.join(self._tmpdir, 'notexist.json'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
