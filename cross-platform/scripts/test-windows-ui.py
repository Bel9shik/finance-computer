"""Exercise an installed app in a disposable Windows 10/11 desktop (no user data).

Requires the test-only websocket-client wheel alongside this script. The guest
has no network adapter; CDP attaches only to this application's local WebView2.
"""
import base64
import ctypes as C
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "websocket.whl"))
import websocket

DATABASE = Path(os.environ["APPDATA"]) / "local.financecomputer.multiplatform/ledger.json"
user = C.WinDLL("user32", use_last_error=True)
user.GetClassNameW.argtypes = [W.HWND, W.LPWSTR, C.c_int]
user.GetWindowThreadProcessId.argtypes = [W.HWND, C.POINTER(W.DWORD)]
user.IsWindowVisible.argtypes = [W.HWND]
user.SetForegroundWindow.argtypes = [W.HWND]
callback_type = C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
user.EnumWindows.argtypes = [callback_type, W.LPARAM]


class Keyboard(C.Structure):
    _fields_ = [("vk", W.WORD), ("scan", W.WORD), ("flags", W.DWORD),
                ("time", W.DWORD), ("extra", C.c_size_t)]


class InputData(C.Union):
    _fields_ = [("keyboard", Keyboard), ("padding", C.c_byte * 32)]


class Input(C.Structure):
    _fields_ = [("type", W.DWORD), ("data", InputData)]


user.SendInput.argtypes = [W.UINT, C.POINTER(Input), C.c_int]
assert C.sizeof(Input) == 40, "This runner requires x64 Python"


def key(vk=0, scan=0, flags=0):
    event = Input(1, InputData(keyboard=Keyboard(vk, scan, flags, 0, 0)))
    assert user.SendInput(1, C.byref(event), C.sizeof(event)) == 1


def chord(modifier, letter):
    key(modifier)
    key(letter)
    key(letter, flags=2)
    key(modifier, flags=2)


def enter_path(path):
    chord(0x12, ord("N"))  # File name in the native English Windows dialog.
    time.sleep(.3)
    chord(0x11, ord("A"))
    data = str(path).encode("utf-16-le")
    for index in range(0, len(data), 2):
        value = int.from_bytes(data[index:index + 2], "little")
        key(scan=value, flags=4)
        key(scan=value, flags=6)
    key(0x0D)
    key(0x0D, flags=2)


def wait(predicate, name, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(.3)
    raise AssertionError("Timeout: " + name)


def ledger():
    try:
        return json.loads(DATABASE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"operations": []}


class App:
    def __init__(self, binary):
        env = dict(os.environ, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222")
        self.process = subprocess.Popen([binary], env=env)
        self.socket = None
        self.counter = 0
        def target():
            try:
                with urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=2) as response:
                    targets = json.load(response)
                return next((t for t in targets if t["type"] == "page" and "tauri.localhost" in t["url"]), None)
            except (OSError, ValueError):
                return None
        found = wait(target, "local WebView2 debugger")
        self.socket = websocket.create_connection(found["webSocketDebuggerUrl"], timeout=180, suppress_origin=True)
        self.until("document.querySelector('nav')?.querySelectorAll('button').length === 5", "main UI")

    def command(self, method, params=None):
        self.counter += 1
        self.socket.send(json.dumps(dict(id=self.counter, method=method, params=params or {})))
        while True:
            response = json.loads(self.socket.recv())
            if response.get("id") == self.counter:
                if "error" in response:
                    raise AssertionError(response["error"])
                return response["result"]

    def js(self, expression):
        result = self.command("Runtime.evaluate", dict(expression=expression, returnByValue=True, awaitPromise=True))
        if "exceptionDetails" in result:
            raise AssertionError(result["exceptionDetails"])
        return result.get("result", {}).get("value")

    def until(self, expression, name):
        return wait(lambda: self.js(expression), name)

    def click(self, label, selector="document"):
        self.js(f"(() => {{ const b = [...{selector}.querySelectorAll('button')].find(b=>b.textContent.trim().endsWith({json.dumps(label)})); if(!b) throw Error('Missing button'); b.click(); }})()")

    def file_dialog(self, path):
        def find():
            found = []
            @callback_type
            def visitor(hwnd, _):
                pid = W.DWORD()
                user.GetWindowThreadProcessId(hwnd, C.byref(pid))
                cls = C.create_unicode_buffer(128)
                user.GetClassNameW(hwnd, cls, len(cls))
                if pid.value == self.process.pid and user.IsWindowVisible(hwnd) and cls.value == "#32770":
                    found.append(hwnd)
                return True
            user.EnumWindows(visitor, 0)
            return found[0] if found else None
        window = wait(find, "native file dialog")
        user.SetForegroundWindow(window)
        time.sleep(.3)
        enter_path(path)
        wait(lambda: not find(), "native file dialog closed")

    def screenshot(self, name):
        result = self.command("Page.captureScreenshot", {"format": "png"})
        (ROOT / name).write_bytes(base64.b64decode(result["data"]))

    def stop(self):
        if self.socket:
            self.socket.close()
        self.process.terminate()
        self.process.wait(timeout=30)


def main():
    assert sys.platform == "win32"
    assert not DATABASE.exists(), "Refusing to use an existing financial database"
    app = App(str(Path(sys.argv[1]).resolve()))
    exports = tempfile.TemporaryDirectory(prefix="finance-ui-")
    try:
        for filename, count in [("valid.xlsx", 3), ("finance-test.pdf", 4), ("valid.xlsx", 4)]:
            app.click("Добавить выписки")
            app.file_dialog(ROOT / filename)
            app.until("!!document.querySelector('dialog[open]')", "import result")
            message = app.js("document.querySelector('dialog[open]').textContent")
            assert len(ledger()["operations"]) == count, message
            app.click("Готово", "document.querySelector('dialog[open]')")
            app.until("!document.querySelector('dialog[open]')", "closed import result")
            print("PASS: native file picker + worker import", filename, count, flush=True)
        assert any(o["amount"] == -92500 for o in ledger()["operations"]), "PDF card amount"
        before = DATABASE.read_bytes()
        app.click("Добавить выписки")
        app.file_dialog(ROOT / "bad-total.xlsx")
        app.until("!!document.querySelector('dialog[open]')", "invalid XLSX result")
        assert DATABASE.read_bytes() == before, "Invalid statement modified the ledger"
        app.click("Готово", "document.querySelector('dialog[open]')")
        print("PASS: malformed statement rejected without data loss", flush=True)
        app.click("Операции", "document.querySelector('nav')")
        app.until("document.querySelectorAll('tbody tr').length === 4", "operations table")
        app.js("document.querySelector('.operation-open').click()")
        app.until("!!document.querySelector('dialog[open] select')", "operation editor")
        app.js("(() => { const s=document.querySelector('dialog[open] select'); s.value='Не учитывать'; s.dispatchEvent(new Event('change',{bubbles:true})); })()")
        wait(lambda: any(o.get("manualKind") and o["kind"] == "Не учитывать" for o in ledger()["operations"]), "autosave on disk")
        app.click("Готово", "document.querySelector('dialog[open]')")
        print("PASS: individual edit autosaved to the native database", flush=True)
        settings = dict(format="finance-computer-settings", version=1, descriptionRules=[dict(
            id="sandbox-rule", description="Оплата в CAFE", debit=True, category="Кофе", kind="Расход")],
            phoneNames={"phone|79991111111": "Анна"}, transferOwners={"phone|79992222222": True}, otherPhonesArePeople=True)
        (ROOT / "settings-in.json").write_text(json.dumps(settings, ensure_ascii=False), encoding="utf-8")
        app.click("Импорт", "document.querySelector('nav')")
        app.click("Импортировать настройки")
        app.file_dialog(ROOT / "settings-in.json")
        app.until("!!document.querySelector('.settings-summary')", "settings preview")
        app.click("Применить настройки")
        wait(lambda: ledger().get("phoneNames", {}).get("phone|79991111111") == "Анна", "settings stored")
        app.until("!document.querySelector('dialog[open]')", "settings dialog closed")
        assert any(o.get("manualKind") and o["kind"] == "Не учитывать" for o in ledger()["operations"])
        app.click("Экспортировать настройки")
        export_path = Path(exports.name) / "settings-out.json"
        app.file_dialog(export_path)
        wait(export_path.exists, "settings file exported")
        exported = json.loads(export_path.read_text(encoding="utf-8"))
        assert exported["phoneNames"] == settings["phoneNames"] and "operations" not in exported
        app.until("!!document.querySelector('dialog[open]')", "export confirmation")
        app.click("Готово", "document.querySelector('dialog[open]')")
        app.click("Сохранить копию")
        backup = Path(exports.name) / "backup.json"
        app.file_dialog(backup)
        wait(backup.exists, "backup exported")
        saved = ledger()
        assert json.loads(backup.read_text(encoding="utf-8")) == saved
        print("PASS: settings import/export, names, manual override and full backup", flush=True)
        app.stop()
        app = App(str(Path(sys.argv[1]).resolve()))
        assert ledger() == saved
        app.click("Операции", "document.querySelector('nav')")
        app.until("document.querySelectorAll('tbody tr').length === 4", "saved operations after restart")
        app.click("Обзор", "document.querySelector('nav')")
        app.until("!!document.querySelector('.pie-layout')", "saved charts after restart")
        app.screenshot("windows-overview.png")
        print("PASS: restart preserves imported operations, edits, presets and names", flush=True)
        print("WINDOWS INTERACTIVE PASS", flush=True)
    except BaseException:
        try:
            app.screenshot("windows-failure.png")
            print(app.js("document.body.innerText"), flush=True)
        except Exception:
            pass
        raise
    finally:
        app.stop()
        exports.cleanup()


if __name__ == "__main__":
    main()
