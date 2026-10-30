import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile, stat } from "@tauri-apps/plugin-fs";
import { decodeLedger, encodeLedger, encodeSettings } from "../core/codec";
import { emptyLedger, migrate, type Ledger, type Parsed } from "../core/model";
import {
  createBrowserStorage,
  pickBrowserFiles,
  saveBrowserFile,
} from "./browser";
export interface Storage {
  load(): Promise<string | null>;
  save(data: string, backup: boolean): Promise<void>;
}
export const nativeStorage: Storage = {
  load: () => invoke("load_ledger"),
  save: (data, backup) => invoke("save_ledger", { data, backup }),
};
export class LedgerStore {
  ledger = emptyLedger();
  readOnly = false;
  busy = false;
  error = "";
  constructor(
    private storage: Storage = isTauri()
      ? nativeStorage
      : createBrowserStorage(),
  ) {}
  async load() {
    try {
      const source = await this.storage.load();
      this.ledger =
        source === null ? emptyLedger() : migrate(decodeLedger(source));
    } catch (e) {
      this.readOnly = true;
      this.error =
        "Не удалось прочитать базу. Изменения отключены: " + String(e);
    }
  }
  async change(edit: (l: Ledger) => void, backup = false) {
    if (this.readOnly || this.busy)
      throw Error("База недоступна для изменения");
    this.busy = true;
    try {
      const next = structuredClone(this.ledger);
      edit(next);
      const text = encodeLedger(next);
      decodeLedger(text);
      await this.storage.save(text, backup);
      this.ledger = next;
    } finally {
      this.busy = false;
    }
  }
  async replace(source: string) {
    const next = migrate(decodeLedger(source));
    if (this.busy) throw Error("Дождись завершения сохранения");
    this.busy = true;
    try {
      await this.storage.save(encodeLedger(next), true);
      this.ledger = next;
      this.readOnly = false;
      this.error = "";
    } finally {
      this.busy = false;
    }
  }
}
export const inNativeApp = () => isTauri();
export async function pickStatements() {
  if (!isTauri()) return pickBrowserFiles(".pdf,.xlsx", true);
  const paths = await open({
    multiple: true,
    filters: [{ name: "Банковские выписки", extensions: ["pdf", "xlsx"] }],
  });
  return paths === null ? [] : Array.isArray(paths) ? paths : [paths];
}
export async function readStatement(path: string | File) {
  if (typeof path !== "string") {
    if (path.size > 25 * 1024 * 1024)
      throw Error("Максимальный размер файла — 25 МБ");
    return new Uint8Array(await path.arrayBuffer());
  }
  const info = await stat(path);
  if (info.size > 25 * 1024 * 1024)
    throw Error("Максимальный размер файла — 25 МБ");
  return readFile(path);
}
export function parseInWorker(
  bytes: Uint8Array,
  filename: string,
): Promise<{ result: Parsed; digest: string }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./import.worker.ts", import.meta.url), {
      type: "module",
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error("Разбор занял больше 2 минут. Файл не импортирован"));
    }, 120000);
    const done = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = ({ data }) => {
      // PDF.js can emit a worker handshake before the financial result is ready.
      if (data?.type !== "finance-import") return;
      done();
      if (data.error) reject(Error(data.error));
      else resolve(data);
    };
    worker.onerror = (e) => {
      done();
      reject(Error(e.message || "Не удалось разобрать файл"));
    };
    worker.postMessage({ bytes, filename }, [bytes.buffer]);
  });
}
export async function filenameFor(path: string | File) {
  if (typeof path !== "string") return path.name;
  if (path.startsWith("file://"))
    return decodeURIComponent(
      new URL(path).pathname.split("/").at(-1) ?? "Выписка",
    );
  if (path.startsWith("content://")) {
    const decoded = decodeURIComponent(path.split("/").at(-1) ?? "Выписка");
    return decoded.split(/[\\/]/).at(-1) ?? "Выписка";
  }
  return path.split(/[\\/]/).at(-1) ?? path;
}
export async function exportBackup(l: Ledger) {
  if (!isTauri()) return saveBrowserFile("finances.json", encodeLedger(l));
  const path = await save({
    defaultPath: "finances.json",
    filters: [{ name: "Резервная копия", extensions: ["json"] }],
  });
  if (path) await writeFile(path, new TextEncoder().encode(encodeLedger(l)));
}
export async function exportSettings(l: Ledger) {
  if (!isTauri())
    return saveBrowserFile("finance-settings.json", encodeSettings(l));
  const path = await save({
    defaultPath: "finance-settings.json",
    filters: [{ name: "Пресеты и номера", extensions: ["json"] }],
  });
  if (!path) return false;
  await writeFile(path, new TextEncoder().encode(encodeSettings(l)));
  return true;
}
export async function importBackup(name = "Резервная копия") {
  if (!isTauri()) {
    const [file] = await pickBrowserFiles(".json");
    if (!file) return;
    if (file.size > 256 * 1024 * 1024) throw Error("База больше 256 МБ");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  }
  const path = await open({
    multiple: false,
    filters: [{ name, extensions: ["json"] }],
  });
  if (!path || Array.isArray(path)) return;
  const info = await stat(path);
  if (info.size > 256 * 1024 * 1024) throw Error("База больше 256 МБ");
  return new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
}
export const ask = (message: string) =>
  isTauri()
    ? confirm(message, {
        title: "Мои финансы",
        kind: "warning",
        okLabel: "Продолжить",
        cancelLabel: "Отмена",
      })
    : Promise.resolve(window.confirm(message));
