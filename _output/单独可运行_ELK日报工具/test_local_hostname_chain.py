"""快速验证 _smtp_connect 中 local_hostname 的三段解析链（cfg→socket.getfqdn→fallback）"""
import os, sys, json, tempfile, unittest, copy
HERE = os.path.abspath(os.path.dirname(__file__))
sys.path.insert(0, HERE)
import daily_mailer as dm


VALID_SMTP = {'server':'smtp.example.com','port':465,'use_ssl':True,'starttls':False,
              'sender_email':'bot@ex.com','password':'x'}


class MemLogger:
    def __init__(self): self.lines=[]
    def log(self, lvl, msg): self.lines.append( (lvl, msg) )
    def filter(self, kw): return [m for _,m in self.lines if kw in m]


class TestLocalHostname(unittest.TestCase):

    def test_cfg_合法值_直接采用(self):
        cfg = copy.deepcopy(VALID_SMTP)
        cfg['local_hostname'] = 'mailer.mycorp.com'
        ml = MemLogger()
        import unittest.mock as _mock
        with _mock.patch('daily_mailer.smtplib.SMTP_SSL', side_effect=ConnectionRefusedError('mock stop')):
            try:
                dm._smtp_connect(cfg, ml, verbose=True)
            except RuntimeError:
                pass
        begin = ml.filter('SMTP_CONNECT_BEGIN')
        self.assertTrue(any('mailer.mycorp.com' in m and 'cfg[smtp.local_hostname]' in m for m in begin), f'实际日志={begin}')

    def test_cfg_非法值_被忽略(self):
        cfg = copy.deepcopy(VALID_SMTP)
        cfg['local_hostname'] = 'localhost'  # 非法：在禁止名单
        ml = MemLogger()
        import unittest.mock as _mock
        with _mock.patch('daily_mailer.smtplib.SMTP_SSL', side_effect=ConnectionRefusedError('mock stop')):
            try:
                dm._smtp_connect(cfg, ml, verbose=True)
            except RuntimeError:
                pass
        self.assertTrue(ml.filter('LOCAL_HOSTNAME_FALLBACK'))
        self.assertTrue(any('不符合DNS域名格式，已忽略' in m for _,m in ml.lines), f'WARN={ml.filter("LOCAL_HOSTNAME_FALLBACK")}')

    def test_getfqdn_无法解析_fallback到默认值(self):
        cfg = copy.deepcopy(VALID_SMTP)  # 不传 cfg.local_hostname
        ml = MemLogger()
        import unittest.mock as _mock
        def bad_fqdn():
            return 'BAD FQDN 含空格和中文'  # 正则校验会拒
        with _mock.patch('daily_mailer.socket.getfqdn', bad_fqdn):
            with _mock.patch('daily_mailer.smtplib.SMTP_SSL', side_effect=ConnectionRefusedError('mock stop')):
                try:
                    dm._smtp_connect(cfg, ml, verbose=True)
                except RuntimeError:
                    pass
        begin = ml.filter('SMTP_CONNECT_BEGIN')
        self.assertTrue(any('mailer-client.qaxqjt.local' in m for m in begin), f'最终未fallback到默认值。begin={begin}')
        self.assertTrue(any('fallback默认值' in m for m in begin))


if __name__ == '__main__':
    unittest.main(verbosity=2)
