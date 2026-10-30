#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app="${1:-$PWD/src-tauri/target/release/bundle/macos/Мои финансы.app}"
log_dir="$(mktemp -d "${TMPDIR:-/tmp}/finance-startup.XXXXXX")"
trap 'rm -rf "$log_dir"' EXIT
codesign --verify --deep --strict "$app"
# Launch the signed bundle through Launch Services, as Finder does. No browser.
python3 - "$app" "$log_dir" <<'PY'
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import subprocess, sys, threading

class Probe(BaseHTTPRequestHandler):
    requests = 0
    def do_GET(self):
        Probe.requests += 1
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        self.wfile.write(b'<h1>Unexpected network request</h1>')
    def log_message(self, *args): pass

# A real loopback responder distinguishes blocked requests from connection errors.
with HTTPServer(('127.0.0.1', 43127), Probe) as server:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    logs = Path(sys.argv[2])
    try:
        subprocess.run(['open', '-n', '-W', '--stdout', str(logs/'stdout'),
                        '--stderr', str(logs/'stderr'), sys.argv[1], '--args',
                        '--check-startup'], check=True, timeout=40)
    finally:
        server.shutdown()
    output = ''.join(p.read_text() for p in (logs/'stdout', logs/'stderr') if p.exists())
    print(output, end='')
    print('Loopback requests received:', Probe.requests)
    assert 'STARTUP CHECK PASS:' in output and Probe.requests == 0, 'Startup/offline check failed'
PY
