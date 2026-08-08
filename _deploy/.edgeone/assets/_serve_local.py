#!/usr/bin/env python3
import os, sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = r"d:\全套最终整合交付（秦安县秦剧团云端预约系统·14文档+架构终审全汇总·可直接EdgeOne Pages部署）\qaxqjt"
PORT = 18089

os.chdir(ROOT)

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[http %s] %s\n" % (self.address_string(), fmt % args))

if __name__ == "__main__":
    httpd = HTTPServer(("127.0.0.1", PORT), Handler)
    sys.stdout.write("SERVING http://127.0.0.1:%d root=%s\n" % (PORT, ROOT))
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()
