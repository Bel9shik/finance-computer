import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/core/model";
import {
  decodeLedger,
  decodeSettings,
  encodeLedger,
  encodeSettings,
  settingsOf,
} from "../src/core/codec";
import { applySettings, mergeSettings } from "../src/core/settings";
import { LedgerStore, type Storage } from "../src/io/platform";

const rule = (patch: Partial<M.Rule> = {}): M.Rule => ({
  id: M.uuid(),
  description: "Оплата в CAFE",
  debit: true,
  category: "Кафе",
  kind: M.K.expense,
  ...patch,
});
const operation = (patch: Partial<M.Operation> = {}): M.Operation => ({
  id: M.uuid(),
  date: "2026-10-01",
  bank: "Test",
  account: "0001",
  details: "Оплата в CAFE",
  amount: -100n,
  currency: "RUB",
  category: "Без категории",
  kind: M.K.expense,
  source: "statement.pdf",
  sourceRow: "1",
  possibleDuplicate: false,
  bankID: "",
  ...patch,
});
const configured = (): M.Ledger => ({
  ...M.emptyLedger(),
  operations: [operation()],
  imports: [
    {
      id: M.uuid(),
      filename: "private.pdf",
      digest: "private-hash",
      importedAt: 123,
      count: 1,
      warnings: [],
    },
  ],
  descriptionRules: [rule({ alternateDescriptions: ["Оплата в KAFE"] })],
  phoneNames: { "phone|79991111111": "Анна" },
  transferOwners: {
    "phone|79992222222": true,
    "phone|79991111111": false,
    "account|Test|0002": true,
  },
  otherPhonesArePeople: true,
});

test("settings roundtrip transfers rules, aliases and people without statements or individual corrections", () => {
  const l = configured();
  l.operations[0].manualKind = true;
  Object.assign(l.descriptionRules![0], { unexpected: "must not be exported" });
  const source = encodeSettings(l),
    raw = JSON.parse(source);
  assert.deepEqual(
    Object.keys(raw).sort(),
    [
      "format",
      "version",
      "descriptionRules",
      "phoneNames",
      "transferOwners",
      "otherPhonesArePeople",
      "mccCategories",
      "categoryRules",
    ].sort(),
  );
  assert(
    !source.includes("private.pdf") &&
      !source.includes("private-hash") &&
      !source.includes("manualKind") &&
      !source.includes("unexpected"),
  );
  assert.deepEqual(decodeSettings(source), settingsOf(l));
  assert.deepEqual(decodeSettings(encodeLedger(l)), settingsOf(l));
  const target = M.emptyLedger();
  applySettings(target, decodeSettings(source));
  assert.deepEqual(settingsOf(target), settingsOf(l));
  assert.equal(target.operations.length, 0);
  assert.equal(target.imports.length, 0);
  assert.throws(() => decodeLedger(source));
});

test("settings reject malformed versions, rule types, duplicate IDs, invalid numbers and unsafe JSON", () => {
  const good = JSON.parse(encodeSettings(configured()));
  const invalid = [
    { ...good, version: 4 },
    { ...good, format: "other" },
    { ...good, phoneNames: null },
    { ...good, transferOwners: [] },
    { ...good, otherPhonesArePeople: "yes" },
    {
      ...good,
      descriptionRules: [good.descriptionRules[0], good.descriptionRules[0]],
    },
    {
      ...good,
      descriptionRules: [{ ...good.descriptionRules[0], kind: "unknown" }],
    },
    {
      ...good,
      descriptionRules: [{ ...good.descriptionRules[0], kind: M.K.pending }],
    },
    {
      ...good,
      descriptionRules: [{ ...good.descriptionRules[0], description: " " }],
    },
    {
      ...good,
      descriptionRules: [
        { ...good.descriptionRules[0], alternateDescriptions: [1] },
      ],
    },
    { ...good, phoneNames: { "phone|123": "Анна" } },
    { ...good, phoneNames: { "phone|79991111111": " " } },
    { ...good, transferOwners: { "phone|79991111111": "true" } },
    { ...good, transferOwners: { "other|unknown": true } },
  ];
  for (const data of invalid)
    assert.throws(() => decodeSettings(JSON.stringify(data)));
  for (const source of [
    "{}",
    '{"__proto__":{}}',
    '{"constructor":{}}',
    '{"version":1,"version":1}',
  ])
    assert.throws(() => decodeSettings(source));
  const badBackup = configured();
  badBackup.operations[0].date = "2026-13-01";
  assert.throws(() => decodeSettings(encodeLedger(badBackup)));
});

test("merging compares rule identities and all normalized aliases, preserves unrelated settings and is repeatable", () => {
  const local = configured();
  const stable = local.descriptionRules![0];
  const untouched = rule({ description: "Оплата в BOOKS", category: "Книги" });
  local.descriptionRules!.push(untouched);
  const incoming = settingsOf(configured());
  const merged = rule({
    description: "Оплата в CAFE_NEW",
    alternateDescriptions: ["Оплата в kafe"],
    category: "Еда",
  });
  const incomingPayment = rule({
    description: "Оплата в METRO",
    category: "Транспорт",
  });
  // Same description in the opposite direction remains a separate rule.
  const refund = rule({
    description: stable.description,
    debit: false,
    kind: M.K.refund,
  });
  incoming.descriptionRules = [merged, incomingPayment, refund];
  incoming.phoneNames = {
    "phone|79991111111": "Аня",
    "phone|79993333333": "Борис",
  };
  incoming.transferOwners = {
    "phone|79992222222": false,
    "phone|79994444444": true,
  };
  incoming.otherPhonesArePeople = false;
  const kept = mergeSettings(local, incoming);
  assert.deepEqual(kept.overlaps, {
    rules: 1,
    names: 1,
    owners: 1,
    mcc: 0,
    categories: 0,
  });
  assert.deepEqual(
    kept.settings.descriptionRules.map((r) => r.id),
    [stable.id, untouched.id, incomingPayment.id, refund.id],
  );
  assert.equal(kept.settings.phoneNames["phone|79991111111"], "Анна");
  assert.equal(kept.settings.phoneNames["phone|79993333333"], "Борис");
  assert.equal(kept.settings.transferOwners["phone|79992222222"], true);
  assert.equal(kept.settings.otherPhonesArePeople, true);
  const replaced = mergeSettings(local, incoming, true);
  assert.deepEqual(
    replaced.settings.descriptionRules.map((r) => r.id),
    [merged.id, incomingPayment.id, refund.id, untouched.id],
  );
  assert.equal(replaced.settings.phoneNames["phone|79991111111"], "Аня");
  assert.equal(replaced.settings.transferOwners["phone|79992222222"], false);
  assert.equal(replaced.settings.otherPhonesArePeople, false);
  for (const preferFile of [false, true]) {
    const target = structuredClone(local);
    applySettings(target, incoming, preferFile);
    const once = encodeLedger(target);
    applySettings(target, incoming, preferFile);
    assert.equal(encodeLedger(target), once);
  }
  const renamed = {
    ...stable,
    description: "Оплата в RENAMED",
    alternateDescriptions: [],
  };
  assert.equal(
    mergeSettings(
      local,
      { ...incoming, descriptionRules: [renamed] },
      true,
    ).settings.descriptionRules.filter((r) => r.id === stable.id).length,
    1,
  );
  assert.equal(local.descriptionRules![0].description, "Оплата в CAFE");
});

test("applying settings reclassifies existing and future operations once without replacing history or manual choices", () => {
  const l = M.emptyLedger();
  l.operations = [
    operation(),
    operation({
      manualCategory: true,
      manualKind: true,
      category: "Подарки",
      kind: M.K.excluded,
    }),
    operation({
      details: "Внешний перевод по номеру телефона +79992222222",
      kind: M.K.review,
    }),
  ];
  l.imports = configured().imports;
  const ids = l.operations.map((o) => o.id),
    imports = structuredClone(l.imports);
  const incoming = settingsOf(configured());
  applySettings(l, incoming);
  assert.deepEqual(
    l.operations.map((o) => o.id),
    ids,
  );
  assert(l.operations.every((o) => o.amount === -100n));
  assert.deepEqual(l.imports, imports);
  assert.equal(l.operations[0].category, "Кафе");
  assert.equal(l.operations[1].category, "Подарки");
  assert.equal(l.operations[1].kind, M.K.excluded);
  assert.equal(l.operations[2].kind, M.K.transfer);
  M.append(
    l,
    { operations: [operation({ details: "Оплата в KAFE" })], warnings: [] },
    "new.pdf",
    "new-hash",
  );
  assert.equal(l.operations.at(-1)!.category, "Кафе");
  incoming.transferOwners["phone|79992222222"] = false;
  assert.equal(
    mergeSettings(M.emptyLedger(), incoming).settings.otherPhonesArePeople,
    false,
  );
});

test("settings import requires a successful backup and save before replacing in-memory state", async () => {
  const initial = configured();
  let disk = encodeLedger(initial),
    fail = true,
    backedUp = false;
  const storage: Storage = {
    load: async () => disk,
    save: async (source, backup) => {
      assert.equal(backup, true);
      if (fail) throw Error("backup unavailable");
      backedUp = backup;
      disk = source;
    },
  };
  const store = new LedgerStore(storage);
  await store.load();
  const before = encodeLedger(store.ledger),
    diskBefore = disk;
  const incoming = settingsOf(configured());
  incoming.phoneNames["phone|79991111111"] = "Новое имя";
  await assert.rejects(
    store.change((l) => applySettings(l, incoming, true), true),
  );
  assert.equal(encodeLedger(store.ledger), before);
  assert.equal(disk, diskBefore);
  fail = false;
  await store.change((l) => applySettings(l, incoming, true), true);
  assert(backedUp);
  assert.equal(
    decodeLedger(disk).phoneNames!["phone|79991111111"],
    "Новое имя",
  );
  assert.deepEqual(
    store.ledger.operations.map((o) => o.id),
    initial.operations.map((o) => o.id),
  );
});
