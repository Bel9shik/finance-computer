"""Test an installed Windows/Linux release with synthetic data in a disposable OS."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


def fixture():
    operations = []
    for number, date, amount, category, kind in [
        (1, "2026-09-01", -12550, "Кафе", "Расход"),
        (2, "2026-10-02", -25000, "Продукты", "Расход"),
        (3, "2026-10-03", 100000, "Доходы", "Доход"),
        (4, "2026-10-04", -10000, "Переводы", "Откладывание на счета"),
        (5, "2026-10-05", 500, "Продукты", "Возврат"),
    ]:
        operations.append(dict(
            id=f"finance-sandbox-{number}", date=date, amount=amount,
            category=category, kind=kind, bank="Sandbox Bank", account="0001",
            details=f"Synthetic operation {number}", currency="RUB", source="fixture",
            sourceRow=str(number), bankID="", possibleDuplicate=False,
        ))
    return dict(version=1, classificationVersion=1, operations=operations, imports=[])


class Probe(BaseHTTPRequestHandler):
    requests = 0
    paths = []

    def do_GET(self):
        Probe.requests += 1
        Probe.paths.append(self.path)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Unexpected network request")

    def log_message(self, *args):
        pass


def main():
    if sys.platform == "win32":
        data_root = Path(os.environ["APPDATA"])
    elif sys.platform == "linux":
        data_root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    else:
        raise RuntimeError("Use test-macos-startup.sh for the existing Mac database")
    database = data_root / "local.financecomputer.multiplatform" / "ledger.json"
    if database.exists():
        raise RuntimeError("Refusing to overwrite an existing ledger; use a fresh sandbox user")
    database.parent.mkdir(parents=True, exist_ok=True)
    source = json.dumps(fixture(), ensure_ascii=False).encode("utf-8")
    database.write_bytes(source)
    digest = hashlib.sha256(source).digest()
    try:
        with HTTPServer(("127.0.0.1", 43127), Probe) as server:
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                for attempt in range(2):
                    result = subprocess.run(
                        [str(Path(sys.argv[1]).resolve()), "--check-startup"],
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                        encoding="utf-8", errors="replace", timeout=120,
                    )
                    print(result.stdout, end="")
                    assert result.returncode == 0, f"App exited with {result.returncode}"
                    assert "STARTUP CHECK PASS:" in result.stdout, "No native startup verdict"
                    assert "SANDBOX UI PASS:" in result.stdout, "Synthetic dataset was not exercised"
                    assert hashlib.sha256(database.read_bytes()).digest() == digest, "Ledger changed"
                    print(f"Launch {attempt + 1}: synthetic data preserved")
            finally:
                server.shutdown()
        assert Probe.requests == 0, f"Unexpected network requests: {Probe.paths}"
        print("PASS: installed app, charts, filters, sorting, restart, read-only data, offline probes")
    finally:
        if database.exists() and hashlib.sha256(database.read_bytes()).digest() == digest:
            database.unlink()


if __name__ == "__main__":
    main()
