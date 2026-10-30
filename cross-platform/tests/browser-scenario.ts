import {
  createBrowserStorage,
  readBrowserBackup,
  pickBrowserFiles,
  saveBrowserFile,
} from "../src/io/browser";
import {
  LedgerStore,
  filenameFor,
  readStatement,
  importBackup,
  exportBackup,
} from "../src/io/platform";
import {
  decodeLedger,
  encodeLedger,
  decodeSettings,
  encodeSettings,
} from "../src/core/codec";
import { emptyLedger } from "../src/core/model";

const host = window as typeof window & {
  testFile: Uint8Array<ArrayBuffer>;
  testPDF: Uint8Array<ArrayBuffer>;
  webkit: {
    messageHandlers: { testResult: { postMessage(value: unknown): void } };
  };
};
let checks = 0;
const check = (condition: unknown, name: string) => {
  if (!condition) throw Error(name);
  checks++;
};
const rejected = async (work: Promise<unknown>, pattern: RegExp) => {
  try {
    await work;
  } catch (error) {
    check(pattern.test(String(error)), String(error));
    return;
  }
  throw Error("Expected rejection: " + pattern);
};
const wait = async (condition: () => unknown, name: string) => {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error("Timeout: " + name);
};
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((node) =>
    node.textContent?.trim().endsWith(text),
  )!;
const report = (error?: unknown) =>
  host.webkit.messageHandlers.testResult.postMessage({
    ok: !error,
    checks,
    error: error ? String(error) : undefined,
    width: innerWidth,
  });
window.addEventListener("error", (event) => report(event.message));
window.addEventListener("unhandledrejection", (event) => report(event.reason));

async function rawWrite(value: string | null) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("finance-computer", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("ledger", "readwrite");
      if (value === null) tx.objectStore("ledger").clear();
      else tx.objectStore("ledger").put(value, "current");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

void (async () => {
  await wait(() => button("Добавить выписки"), "app startup");
  const previousChecks = sessionStorage.getItem("finance-test-reload");
  if (previousChecks) {
    checks = Number(previousChecks);
    sessionStorage.removeItem("finance-test-reload");
    const restored = new LedgerStore();
    await restored.load();
    check(
      restored.ledger.operations.length === 4,
      "actual page reload preserves transactions",
    );
    check(
      restored.ledger.phoneNames?.["phone|79991111111"] === "Тест",
      "actual page reload preserves settings",
    );
    button("Импорт").click();
    await wait(
      () => document.querySelectorAll(".import-record").length === 2,
      "reloaded UI reads persisted history",
    );
    check(!button("Добавить выписки").disabled, "reloaded app is writable");
    report();
    return;
  }
  check(
    !button("Добавить выписки").disabled,
    "browser can import without Tauri",
  );
  const first = new LedgerStore();
  await first.load();
  check(!first.readOnly, "IndexedDB opens");
  await first.change((ledger) => {
    ledger.phoneNames = { "phone|79991111111": "Анна" };
  });
  const stale = new LedgerStore();
  await stale.load();
  check(
    stale.ledger.phoneNames?.["phone|79991111111"] === "Анна",
    "new store sees committed data",
  );
  const before = encodeLedger(first.ledger);
  await first.change((ledger) => {
    ledger.phoneNames!["phone|79991111111"] = "Аня";
  }, true);
  check(
    (await readBrowserBackup()) === before,
    "previous copy saved atomically",
  );
  await rejected(
    stale.change((ledger) => {
      ledger.phoneNames = {};
    }),
    /другом окне/,
  );
  check(
    decodeLedger((await createBrowserStorage().load())!).phoneNames?.[
      "phone|79991111111"
    ] === "Аня",
    "stale window cannot overwrite changes",
  );
  const current = encodeLedger(first.ledger);
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
    if (key === "current")
      throw new DOMException("Test disk full", "QuotaExceededError");
    return put.call(this, value, key);
  };
  try {
    await rejected(
      first.change((ledger) => {
        ledger.phoneNames = {};
      }, true),
      /disk full/,
    );
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  check(
    (await createBrowserStorage().load()) === current,
    "quota failure preserves persisted ledger",
  );
  check(
    (await readBrowserBackup()) === before,
    "quota failure rolls back backup too",
  );
  check(
    encodeLedger(first.ledger) === current && !first.busy,
    "quota failure preserves UI state and unlocks store",
  );
  await rawWrite("broken");
  const corrupt = new LedgerStore();
  await corrupt.load();
  check(corrupt.readOnly, "corrupt ledger becomes read-only");
  await rejected(
    corrupt.change(() => {}),
    /недоступна/,
  );
  await corrupt.replace(before);
  check(
    !corrupt.readOnly &&
      (await createBrowserStorage().load()) === encodeLedger(corrupt.ledger),
    "valid backup recovers corrupt database",
  );
  check((await readBrowserBackup()) === "broken", "corrupt original retained");
  await rawWrite(null);

  let selection: File[] = [];
  let picks = 0;
  const inputClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type !== "file") return inputClick.call(this);
    picks++;
    const transfer = new DataTransfer();
    for (const file of selection) transfer.items.add(file);
    this.files = transfer.files;
    queueMicrotask(() =>
      this.dispatchEvent(new Event(selection.length ? "change" : "cancel")),
    );
  };
  const shared: File[] = [];
  let shareFailure: DOMException | null = null;
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: () => true,
  });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async ({ files }: ShareData) => {
      if (shareFailure) throw shareFailure;
      shared.push(...files!);
    },
  });
  window.confirm = () => true;
  check(
    (await pickBrowserFiles(".json")).length === 0,
    "cancel returns no files",
  );
  check(
    !document.querySelector('input[type="file"]'),
    "picker cleaned up after cancellation",
  );
  check(
    (await importBackup()) === undefined,
    "cancelled restore leaves data alone",
  );
  selection = [new File([new Uint8Array([255])], "bad.json")];
  await rejected(importBackup(), /TypeError/);
  const oversized = new File(["tiny"], "big.pdf");
  Object.defineProperty(oversized, "size", { value: 256 * 1024 * 1024 + 1 });
  await rejected(readStatement(oversized), /25 МБ/);
  selection = [oversized];
  await rejected(importBackup(), /256 МБ/);
  shareFailure = new DOMException("Cancelled", "AbortError");
  check(
    (await saveBrowserFile("test.json", "{}")) === false,
    "share cancellation does not report success",
  );
  shareFailure = new DOMException("No access", "NotAllowedError");
  await rejected(saveBrowserFile("test.json", "{}"), /No access/);
  shareFailure = null;
  await exportBackup(emptyLedger());
  check(
    decodeLedger(await shared.pop()!.text()).operations.length === 0,
    "backup share keeps valid JSON",
  );
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: () => false,
  });
  const anchorClick = HTMLAnchorElement.prototype.click;
  let download = "";
  HTMLAnchorElement.prototype.click = function () {
    download = this.download;
    check(this.href.startsWith("blob:"), "download uses local blob");
  };
  try {
    check(
      await saveBrowserFile("download.json", "{}"),
      "download fallback available",
    );
  } finally {
    HTMLAnchorElement.prototype.click = anchorClick;
  }
  check(download === "download.json", "download preserves filename");
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: () => true,
  });

  selection = [new File([host.testFile], "Выписка Альфа.xlsx")];
  check(
    (await filenameFor(selection[0])) === "Выписка Альфа.xlsx",
    "File names stay readable",
  );
  button("Добавить выписки").click();
  await wait(() => document.querySelector("dialog[open]"), "XLSX import");
  let ledger = decodeLedger((await createBrowserStorage().load())!);
  check(
    ledger.operations.length === 3 &&
      ledger.imports[0].filename === selection[0].name,
    "real browser adapter imports XLSX via Worker into IndexedDB",
  );
  button("Готово").click();
  await wait(() => !document.querySelector("dialog[open]"), "close import");
  button("Добавить выписки").click();
  await wait(() => document.querySelector("dialog[open]"), "duplicate result");
  check(
    decodeLedger((await createBrowserStorage().load())!).operations.length ===
      3,
    "repeat import preserves operation count",
  );
  button("Готово").click();
  await wait(() => !document.querySelector("dialog[open]"), "close duplicate");
  selection = [new File([host.testPDF], "Т-Банк.pdf")];
  button("Добавить выписки").click();
  await wait(() => document.querySelector("dialog[open]"), "PDF import");
  ledger = decodeLedger((await createBrowserStorage().load())!);
  check(
    ledger.operations.length === 4 &&
      ledger.operations.at(-1)!.amount === -92500n,
    "PDF imports through real browser adapter with exact card amount",
  );
  button("Готово").click();
  await wait(() => !document.querySelector("dialog[open]"), "close PDF");
  button("Сохранить копию").click();
  await wait(() => shared.length === 1, "export current ledger");
  const exported = shared.pop()!;
  check(
    decodeLedger(await exported.text()).operations.length === 4,
    "UI exports complete database",
  );
  const pickCount = picks;
  button("Начать заново").click();
  await wait(() => document.querySelector("dialog[open]"), "reset result");
  check(
    decodeLedger((await createBrowserStorage().load())!).operations.length ===
      0,
    "reset commits empty database",
  );
  check(
    decodeLedger((await readBrowserBackup())!).operations.length === 4,
    "reset keeps recoverable database",
  );
  check(
    picks === pickCount,
    "reset does not open picker after user gesture has expired",
  );
  button("Готово").click();
  await wait(() => !document.querySelector("dialog[open]"), "close reset");
  button("Импорт").click();
  await wait(
    () => button("Восстановить автоматическую копию"),
    "restore action",
  );
  button("Восстановить автоматическую копию").click();
  await wait(
    () => !button("Восстановить автоматическую копию").disabled,
    "restore finishes",
  );
  // The click first reads IndexedDB; wait for the restored import records to render.
  await wait(
    () => document.querySelectorAll(".import-record").length === 2,
    "restored history",
  );
  check(
    decodeLedger((await createBrowserStorage().load())!).operations.length ===
      4,
    "automatic copy is restorable from UI",
  );
  check(
    decodeLedger((await readBrowserBackup())!).operations.length === 0,
    "restore preserves the replaced state",
  );
  check(
    document.documentElement.scrollWidth <= innerWidth + 2,
    "browser UI fits phone width",
  );
  const reopened = new LedgerStore();
  await reopened.load();
  check(
    reopened.ledger.operations.length === 4,
    "reopened storage retains imported data",
  );
  const settings = emptyLedger();
  settings.phoneNames = { "phone|79991111111": "Тест" };
  selection = [
    new File([encodeSettings(settings)], "settings.json", {
      type: "application/json",
    }),
  ];
  button("Импортировать настройки").click();
  await wait(
    () => document.querySelector(".settings-summary"),
    "settings preview",
  );
  button("Отмена").click();
  await wait(() => !document.querySelector("dialog[open]"), "cancel settings");
  check(
    !decodeLedger((await createBrowserStorage().load())!).phoneNames?.[
      "phone|79991111111"
    ],
    "cancelled settings do not change IndexedDB",
  );
  button("Импортировать настройки").click();
  await wait(
    () => document.querySelector(".settings-summary"),
    "settings preview again",
  );
  button("Применить настройки").click();
  await wait(() => !document.querySelector("dialog[open]"), "settings applied");
  const updated = decodeLedger((await createBrowserStorage().load())!);
  check(
    updated.phoneNames?.["phone|79991111111"] === "Тест" &&
      updated.operations.length === 4,
    "settings commit without replacing transactions",
  );
  button("Экспортировать настройки").click();
  await wait(
    () => shared.length === 1 && document.querySelector("dialog[open]"),
    "settings shared",
  );
  check(
    decodeSettings(await shared.pop()!.text()).phoneNames[
      "phone|79991111111"
    ] === "Тест",
    "browser settings export roundtrips",
  );
  HTMLInputElement.prototype.click = inputClick;
  sessionStorage.setItem("finance-test-reload", String(checks));
  location.reload();
})().catch(report);
