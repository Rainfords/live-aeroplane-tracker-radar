#!/usr/bin/env python3
"""
Local dev server: serves static files + proxies /api/opensky → opensky-network.org
Run with: python3 server.py
"""
import http.server
import urllib.request
import urllib.parse
import json
import os

PORT = 8090
OPENSKY_BASE = 'https://opensky-network.org/api/states/all'


class RadarHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/opensky'):
            self._proxy_opensky()
        else:
            super().do_GET()

    def _proxy_opensky(self):
        parsed = urllib.parse.urlparse(self.path)
        target = OPENSKY_BASE
        if parsed.query:
            target += f'?{parsed.query}'

        try:
            req = urllib.request.Request(
                target,
                headers={'User-Agent': 'radar-local-proxy/1.0'}
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
            print(f'[proxy] OpenSky → {len(data)} bytes')

        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
            print(f'[proxy] OpenSky error: {e}')

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
            print(f'[proxy] Error: {e}')

    def log_message(self, fmt, *args):
        if not self.path.startswith('/api/'):
            super().log_message(fmt, *args)


os.chdir(os.path.dirname(os.path.abspath(__file__)))
print(f'Radar server → http://localhost:{PORT}')
http.server.HTTPServer(('', PORT), RadarHandler).serve_forever()
