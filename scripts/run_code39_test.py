import http.server
import socketserver
import threading
import subprocess
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

test_report = None
report_event = threading.Event()

class TestHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        global test_report
        if self.path == '/report':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            test_report = json.loads(body)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            report_event.set()
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass

PORT = 8094
httpd = socketserver.TCPServer(('', PORT), TestHandler)
t = threading.Thread(target=httpd.serve_forever, daemon=True)
t.start()

chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
cmd = [
    chrome_path,
    '--headless=new',
    '--disable-gpu',
    f'http://127.0.0.1:{PORT}/scripts/test_browser_scan_final.html'
]
proc = subprocess.Popen(cmd)

reported = report_event.wait(timeout=12)

proc.terminate()
try:
    proc.wait(timeout=2)
except Exception:
    proc.kill()

httpd.shutdown()

if reported and test_report:
    print('OUTPUT:\n', test_report.get('output'))
else:
    print('TIMEOUT: No report received')
