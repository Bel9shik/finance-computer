import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emptyLedger } from "../src/core/model";
import { decodeLedger, decodeSettings } from "../src/core/codec";
import {
  exportBackup,
  exportSettings,
  filenameFor,
  importBackup,
  pickStatements,
  readStatement,
} from "../src/io/platform";

Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
Object.defineProperty(globalThis, "isTauri", { value: true, configurable: true });
afterEach(clearMocks);

test("file picker names preserve Unicode and decode file URLs exactly once", async () => {
  for (const [path, name] of [
    [
      "file:///private/documents/%D0%92%D1%8B%D0%BF%D0%B8%D1%81%D0%BA%D0%B0%20100%25.xlsx",
      "Выписка 100%.xlsx",
    ],
    ["file:///private/test%2520.pdf", "test%20.pdf"],
    ["file:///private/test%23%3F.pdf", "test#?.pdf"],
    ["/tmp/Выписка 100%.pdf", "Выписка 100%.pdf"],
    ["C:\\Users\\Test\\statement.xlsx", "statement.xlsx"],
    ["content://documents/document/primary%3ADownload%2Ftest.pdf", "test.pdf"],
  ])
    assert.equal(await filenameFor(path), name);
});

test("iOS file URLs reach filesystem APIs unchanged; size limits prevent reads", async () => {
  const path =
    "file:///private/%D0%92%D1%8B%D0%BF%D0%B8%D1%81%D0%BA%D0%B0.xlsx";
  let size = 4;
  let reads = 0;
  mockIPC((cmd, args) => {
    if (cmd === "plugin:dialog|open") return [path];
    assert.equal((args as { path: string }).path, path);
    if (cmd === "plugin:fs|stat") return { size };
    assert.equal(cmd, "plugin:fs|read_file");
    reads++;
    return [1, 2, 3, 4];
  });
  assert.deepEqual(await pickStatements(), [path]);
  assert.deepEqual(await readStatement(path), new Uint8Array([1, 2, 3, 4]));
  size = 25 * 1024 * 1024 + 1;
  await assert.rejects(readStatement(path), /25 МБ/);
  assert.equal(reads, 1);
});

test("cancelled file dialogs cause no reads or writes", async () => {
  mockIPC((cmd) => {
    assert.match(cmd, /^plugin:dialog\|(open|save)$/);
    return null;
  });
  assert.deepEqual(await pickStatements(), []);
  assert.equal(await importBackup(), undefined);
  assert.equal(await exportBackup(emptyLedger()), undefined);
  assert.equal(await exportSettings(emptyLedger()), false);
});

test("backup import rejects oversized, unreadable and invalid UTF-8 files", async () => {
  let size = 256 * 1024 * 1024 + 1;
  let fail = false;
  let reads = 0;
  mockIPC((cmd) => {
    if (cmd === "plugin:dialog|open") return "file:///private/backup.json";
    if (cmd === "plugin:fs|stat") return { size };
    assert.equal(cmd, "plugin:fs|read_file");
    reads++;
    if (fail) throw Error("Access denied");
    return [0xff];
  });
  await assert.rejects(importBackup(), /256 МБ/);
  assert.equal(reads, 0);
  size = 1;
  await assert.rejects(importBackup(), /encoded data/);
  fail = true;
  await assert.rejects(importBackup(), /Access denied/);
});

test("exports write decodable data and propagate write failures", async () => {
  const writes: string[] = [];
  let fail = false;
  mockIPC((cmd, args) => {
    if (cmd === "plugin:dialog|save") return "file:///private/backup.json";
    assert.equal(cmd, "plugin:fs|write_file");
    if (fail) throw Error("Disk full");
    writes.push(new TextDecoder().decode(args as Uint8Array));
  });
  await exportBackup(emptyLedger());
  assert.equal(await exportSettings(emptyLedger()), true);
  assert.deepEqual(decodeLedger(writes[0]).operations, []);
  assert.deepEqual(decodeSettings(writes[1]).phoneNames, {});
  fail = true;
  await assert.rejects(exportBackup(emptyLedger()), /Disk full/);
  await assert.rejects(exportSettings(emptyLedger()), /Disk full/);
});
