"""Local static server for ScanVuong. Standard library only, no dependencies."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
import sys
import webbrowser

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)

PORTS = [8765, 8766, 8767, 8768]


class ScanVuongHandler(SimpleHTTPRequestHandler):
    # Older Python releases do not know these types; the PWA needs them right.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.webmanifest': 'application/manifest+json',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.json': 'application/json',
        '.css': 'text/css',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
    }

    def end_headers(self):
        # Always revalidate locally so edits and service-worker updates show up.
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def serve():
    for port in PORTS:
        try:
            httpd = ThreadingHTTPServer(('127.0.0.1', port), ScanVuongHandler)
        except OSError:
            continue
        url = f'http://127.0.0.1:{port}'
        print(f'ScanVuong dang chay tai: {url}')
        print('Nhan Ctrl+C de dung ung dung.')
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nDa dung ScanVuong.')
        finally:
            httpd.server_close()
        return
    print(f'Khong mo duoc cong nao trong {PORTS}. Hay dong ung dung dang chiem cong roi thu lai.')
    sys.exit(1)


if __name__ == '__main__':
    serve()
