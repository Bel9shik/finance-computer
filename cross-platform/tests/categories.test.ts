import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/core/model";
import {
  decodeLedger,
  encodeLedger,
  decodeSettings,
  encodeSettings,
} from "../src/core/codec";
import { applySettings, mergeSettings } from "../src/core/settings";
import { LedgerStore, type Storage } from "../src/io/platform";

const card = (mcc: string) =>
  `Операция по карте: 1234******5678, дата создания транзакции: 01-10-2026, место совершения операции: RU/Test/SHOP, MCC: ${mcc}`;
const operation = (patch: Partial<M.Operation> = {}): M.Operation => ({
  id: M.uuid(),
  date: "2026-10-01",
  bank: "Test",
  account: "0001",
  details: card("5411"),
  amount: -100n,
  currency: "RUB",
  category: M.uncategorized,
  kind: M.K.expense,
  source: "fixture",
  sourceRow: "1",
  bankID: "",
  possibleDuplicate: false,
  ...patch,
});
const configured = () => {
  const l = M.emptyLedger();
  l.operations = [
    operation(),
    operation({ manualCategory: true, category: "Продукты" }),
    operation({ kind: M.K.income, category: "Продукты", amount: 500n }),
  ];
  l.descriptionRules = [
    {
      id: M.uuid(),
      description: card("5411"),
      debit: true,
      category: "Продукты",
      kind: M.K.expense,
      matchMerchant: true,
    },
  ];
  l.mccCategories = { "5411": "Продукты" };
  M.reclassify(l);
  return l;
};

test("category creation, rename, deletion and reload preserve amounts, types and rule baselines", () => {
  let l = configured();
  const identity = l.operations.map(({ id, kind, amount, date }) => ({
    id,
    kind,
    amount,
    date,
  }));
  M.addCategory(l, "Подарки");
  assert(M.allCategories(M.reset(l)).includes("Подарки"));
  assert.throws(() => M.addCategory(l, " подарки "));
  assert.throws(() => M.addCategory(l, " "));
  M.renameCategory(l, "Продукты", "Еда");
  assert(l.operations.every((o) => o.category === "Еда"));
  assert.equal(l.descriptionRules![0].category, "Еда");
  assert.equal(l.mccCategories!["5411"], "Еда");
  assert.equal(l.operations[0].autoCategoryBase, M.uncategorized);
  assert.equal(l.operations[0].ruleBase!.category, "Еда");
  assert(!M.allCategories(l).includes("Продукты"));
  M.reclassify(l);
  assert(l.operations.every((o) => o.category === "Еда"));
  M.deleteCategory(l, "Еда");
  assert(l.operations.every((o) => o.category === M.uncategorized));
  assert.equal(l.descriptionRules![0].category, M.uncategorized);
  assert.equal(l.mccCategories!["5411"], M.uncategorized);
  assert(!M.allCategories(l).includes("Еда"));
  assert(!M.allCategories(l).includes("Продукты"));
  l = M.migrate(decodeLedger(encodeLedger(l)));
  const saved = encodeLedger(l);
  M.reclassify(l);
  assert.equal(encodeLedger(l), saved);
  assert(l.operations.every((o) => o.category === M.uncategorized));
  assert.deepEqual(
    l.operations.map(({ id, kind, amount, date }) => ({
      id,
      kind,
      amount,
      date,
    })),
    identity,
  );
  assert.throws(() => M.deleteCategory(l, M.uncategorized));
  assert.throws(() => M.renameCategory(l, M.uncategorized, "Другое имя"));
  assert.throws(() => M.renameCategory(l, "Подарки", M.uncategorized));
  assert(M.allCategories(l).includes(M.uncategorized));
});

test("deleted defaults stay deleted for future imports, settings transfer and preset removal", () => {
  const l = configured();
  M.deleteCategory(l, "Продукты");
  const target = M.emptyLedger();
  applySettings(target, decodeSettings(encodeSettings(l)));
  M.append(
    target,
    {
      operations: [
        operation({ category: "Продукты" }),
        operation({
          details: "Other shop",
          mcc: "5411",
          bankCategory: "Супермаркеты",
        }),
      ],
      warnings: [],
    },
    "new.xlsx",
    "new-digest",
  );
  assert(target.operations.every((o) => o.category === M.uncategorized));
  target.descriptionRules = [];
  M.setMCCCategory(target, "5411", "");
  assert(target.operations.every((o) => o.category === M.uncategorized));
  M.editOperation(target, target.operations[0].id, { category: "Продукты" });
  assert.equal(target.operations[0].category, M.uncategorized);
  M.applyAutomaticClassification(target);
  assert.equal(target.version, 2);
  assert(!M.allCategories(M.reset(target)).includes("Продукты"));
  M.addCategory(target, "Продукты");
  assert(M.allCategories(target).includes("Продукты"));
});

test("category renames follow phone rules and keep individually assigned types", () => {
  const l = M.emptyLedger();
  l.operations = [
    operation({
      details: "Внешний перевод по номеру телефона +79992222222",
      kind: M.K.review,
    }),
  ];
  M.setOwnPhone(l, "+79991111111");
  l.otherPhonesArePeople = true;
  M.reclassify(l);
  assert.equal(l.operations[0].category, "Переводы людям");
  M.renameCategory(l, "Переводы людям", "Друзьям");
  M.reclassify(l);
  assert.equal(l.operations[0].category, "Друзьям");
  M.deleteCategory(l, "Друзьям");
  M.reclassify(l);
  assert.equal(l.operations[0].category, M.uncategorized);
  assert.equal(l.operations[0].kind, M.K.outgoing);
});

test("category settings merge honors selected source without cyclic renames; validates imported edits", () => {
  const local = M.emptyLedger();
  M.addCategory(local, "A");
  M.renameCategory(local, "A", "B");
  const remote = M.emptyLedger();
  M.addCategory(remote, "B");
  M.renameCategory(remote, "B", "A");
  const incoming = decodeSettings(encodeSettings(remote));
  for (const prefer of [false, true]) {
    const merged = mergeSettings(local, incoming, prefer).settings;
    assert.equal(M.categoryName(merged, "A"), prefer ? "A" : "B");
    assert.equal(M.categoryName(merged, "B"), prefer ? "A" : "B");
    assert.deepEqual(
      mergeSettings({ ...local, ...merged }, incoming, prefer).settings,
      merged,
    );
  }
  const raw = JSON.parse(encodeSettings(local));
  for (const categoryRules of [
    { A: "B", B: "A" },
    { "Без категории": "Удалено" },
    { "": "Пусто" },
    { A: 5 },
    [],
  ])
    assert.throws(() =>
      decodeSettings(JSON.stringify({ ...raw, categoryRules })),
    );
  assert.throws(() =>
    decodeSettings(
      JSON.stringify({
        ...raw,
        descriptionRules: [
          {
            id: "x",
            description: "shop",
            debit: true,
            kind: M.K.expense,
            category: "A",
            ignoreMCC: "yes",
          },
        ],
      }),
    ),
  );
  delete raw.categoryRules;
  raw.version = 1;
  assert.deepEqual(decodeSettings(JSON.stringify(raw)).categoryRules, {});
});

test("merchant may explicitly keep its category after an MCC change; manual choices still win", () => {
  const l = configured();
  l.operations.push(
    operation({ details: card("5814") }),
    operation({
      details: card("5814"),
      category: "Моя категория",
      manualCategory: true,
    }),
  );
  M.reclassify(l);
  assert.equal(l.operations[3].category, "Кафе и рестораны");
  M.setRule(l, { ...l.descriptionRules![0], ignoreMCC: true });
  assert.equal(l.operations[3].category, "Продукты");
  assert.equal(l.operations[4].category, "Моя категория");
  const imported = decodeSettings(encodeSettings(l));
  assert.equal(imported.descriptionRules[0].ignoreMCC, true);
  M.setRule(l, { ...l.descriptionRules![0], ignoreMCC: false });
  assert.equal(l.operations[3].category, "Кафе и рестораны");
  assert.equal(l.operations[4].category, "Моя категория");
});

test("failed category save leaves the database and in-memory operations untouched", async () => {
  const original = encodeLedger(configured());
  let disk = original,
    fail = true;
  const storage: Storage = {
    load: async () => disk,
    save: async (value, backup) => {
      assert.equal(backup, true);
      if (fail) throw Error("No space");
      disk = value;
    },
  };
  const store = new LedgerStore(storage);
  await store.load();
  const before = encodeLedger(store.ledger);
  await assert.rejects(
    store.change((l) => M.deleteCategory(l, "Продукты"), true),
  );
  assert.equal(disk, original);
  assert.equal(encodeLedger(store.ledger), before);
  fail = false;
  await store.change((l) => M.deleteCategory(l, "Продукты"), true);
  assert(
    decodeLedger(disk).operations.every((o) => o.category === M.uncategorized),
  );
});
