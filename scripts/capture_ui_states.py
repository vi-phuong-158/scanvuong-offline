import os, sys, time, subprocess, http.server, threading

ROOT = os.path.abspath('.')
SCREENSHOT_DIR = os.path.join(ROOT, 'docs', 'screenshots')
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
edge_path = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
browser_bin = chrome_path if os.path.exists(chrome_path) else edge_path

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

server = http.server.HTTPServer(('127.0.0.1', 8775), Handler)
t = threading.Thread(target=server.serve_forever)
t.daemon = True
t.start()

def snap(name, w, h, path='index.html'):
    out_file = os.path.join(SCREENSHOT_DIR, f'{name}.png')
    cmd = [
        browser_bin,
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--force-device-scale-factor=1',
        f'--window-size={w},{h}',
        f'--screenshot={out_file}',
        f'http://127.0.0.1:8775/{path}'
    ]
    subprocess.run(cmd, check=True)
    if os.path.exists(out_file):
        print(f'[OK] Saved {name} ({os.path.getsize(out_file)} bytes)')

print('Capturing screenshots...')
snap('01_mode_select_mobile_390x844', 390, 844)
snap('02_mode_select_mobile_360x800', 360, 800)
snap('03_mode_select_mobile_412x915', 412, 915)
snap('04_mode_select_mobile_430x932', 430, 932)
snap('05_mode_select_tablet_768x1024', 768, 1024)
snap('06_mode_select_desktop_1280x800', 1280, 800)
snap('07_mode_select_landscape_844x390', 844, 390)

server.shutdown()
print('Done!')