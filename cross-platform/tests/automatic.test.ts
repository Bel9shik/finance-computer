import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/core/model";
import { extractMCC, normalizedMerchant } from "../src/core/categories";
import {
  decodeLedger,
  encodeLedger,
  decodeSettings,
  encodeSettings,
} from "../src/core/codec";
import { applySettings } from "../src/core/settings";

const op = (patch: Partial<M.Operation> = {}): M.Operation => ({
  id: M.uuid(),
  date: "2026-10-01",
  bank: "Test",
  account: "0001",
  amount: -100n,
  currency: "RUB",
  category: "Без категории",
  kind: M.K.expense,
  details: "Оплата в SHOP Test RUS",
  source: "fixture",
  sourceRow: "1",
  bankID: "",
  possibleDuplicate: false,
  ...patch,
});
const card = (merchant = "SHOP", mcc = "5641") =>
  `Операция по карте: 1234******5678, дата создания транзакции: 01-10-2026, место совершения операции: RU/Test/${merchant}, MCC: ${mcc}`;
const rule = (patch: Partial<M.Rule> = {}): M.Rule => ({
  id: M.uuid(),
  description: "Оплата в SHOP Test RUS",
  debit: true,
  category: "Одежда",
  kind: M.K.expense,
  ...patch,
});

test("MCC extraction requires an explicit unambiguous code; merchant identifiers keep services and digits", () => {
  assert.equal(extractMCC("MCC: 5641"), "5641");
  assert.equal(extractMCC("МСС 5814"), "5814");
  for (const s of ["YANDEX*5411*LAVKA", "MCC: 54111", "MCC: 5411 MCC: 5814"])
    assert.equal(extractMCC(s), undefined);
  assert.equal(
    normalizedMerchant("SOFT-HARD City RUS"),
    normalizedMerchant("RU/Other/SOFT HARD"),
  );
  assert.notEqual(normalizedMerchant("SHOP 1"), normalizedMerchant("SHOP 2"));
  assert.notEqual(
    normalizedMerchant("YANDEX*4121*TAXI"),
    normalizedMerchant("YANDEX*5411*LAVKA"),
  );
});

test("MCC defaults, bank categories, custom mappings and presets have reversible precedence", () => {
  const l = M.emptyLedger();
  l.operations = [
    op({ details: card() }),
    op({ details: card("OTHER"), bankCategory: "Кафе и рестораны" }),
    op({ details: card("THIRD"), manualCategory: true, category: "Подарок" }),
  ];
  M.reclassify(l);
  assert.deepEqual(
    l.operations.map((o) => o.category),
    ["Покупки", "Кафе и рестораны", "Подарок"],
  );
  assert.equal(l.operations[0].mcc, "5641");
  M.setMCCCategory(l, "5641", "Детское");
  assert.deepEqual(
    l.operations.map((o) => o.category),
    ["Детское", "Детское", "Подарок"],
  );
  M.setRule(
    l,
    rule({ description: card(), category: "Магазин", matchMerchant: true }),
  );
  assert.equal(l.operations[0].category, "Магазин");
  assert.equal(M.categoryExplanation(l, l.operations[0]), "Пресет продавца");
  M.setMCCCategory(l, "5641", "");
  assert.equal(l.operations[0].category, "Магазин");
  l.descriptionRules = [];
  M.reclassify(l);
  assert.equal(l.operations[0].category, "Покупки");
  const once = encodeLedger(l);
  M.reclassify(l);
  assert.equal(encodeLedger(l), once);
});

test("general categories never change transfers, pending, excluded, savings, income or a manual type", () => {
  const l = M.emptyLedger();
  const kinds = [
    M.K.transfer,
    M.K.savings,
    M.K.pending,
    M.K.excluded,
    M.K.income,
    M.K.incoming,
    M.K.outgoing,
  ];
  l.operations = kinds.map((kind) =>
    op({ details: card(), kind, manualKind: true, category: "Моя" }),
  );
  l.operations.push(
    op({ details: card(), kind: M.K.refund, amount: 100n, manualKind: true }),
  );
  M.reclassify(l);
  assert.deepEqual(
    l.operations.slice(0, -1).map((o) => o.category),
    kinds.map(() => "Моя"),
  );
  assert.deepEqual(
    l.operations.slice(0, -1).map((o) => o.kind),
    kinds,
  );
  assert.equal(l.operations.at(-1)!.kind, M.K.refund);
  assert.equal(l.operations.at(-1)!.category, "Покупки");
});

test("preview generalizes agreeing merchant presets across banks without changing the source or manual exceptions", () => {
  const l = { ...M.emptyLedger(), classificationVersion: 1 };
  l.operations = [
    op(),
    op({ details: card() }),
    op({
      details: card(),
      manualCategory: true,
      manualKind: true,
      category: "Подарки",
      kind: M.K.excluded,
    }),
  ];
  l.descriptionRules = [
    rule(),
    rule({ description: "Оплата в SHOP Other RUS" }),
  ];
  M.reclassify(l);
  const before = encodeLedger(l);
  const preview = M.automaticPreview(l);
  assert.equal(encodeLedger(l), before);
  assert.equal(preview.rulesAfter, 1);
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.next.operations[1].category, "Одежда");
  assert.equal(preview.next.operations[2].category, "Подарки");
  assert.equal(preview.next.operations[2].kind, M.K.excluded);
  const next = preview.next;
  assert.equal(M.descriptionGroups(next).length, 1);
  const saved = encodeLedger(next);
  M.applyAutomaticClassification(next);
  assert.equal(encodeLedger(next), saved);
  assert.deepEqual(
    structuredClone(decodeLedger(saved).descriptionRules),
    next.descriptionRules,
  );
  M.append(
    next,
    {
      operations: [op({ details: "Оплата в SHOP Newcity RUS" })],
      warnings: [],
    },
    "new",
    "new",
  );
  assert.equal(next.operations.at(-1)!.category, "Одежда");
});

test("conflicting, opted-out and incompatible MCC merchant rules never broaden silently", () => {
  const l = M.emptyLedger();
  l.descriptionRules = [
    rule({ category: "Еда" }),
    rule({ description: "Оплата в SHOP Other RUS", category: "Подарки" }),
    rule({ description: "Оплата в PRIVATE Test RUS", matchMerchant: false }),
  ];
  l.operations = [
    op({ details: "Оплата в SHOP Newcity RUS" }),
    op({ details: "Оплата в PRIVATE Newcity RUS" }),
  ];
  M.applyAutomaticClassification(l);
  assert(l.operations.every((o) => o.category === "Без категории"));
  assert(!l.descriptionRules!.some((r) => r.matchMerchant));
  l.descriptionRules = [
    rule({ description: card("METRO", "5411"), matchMerchant: true }),
  ];
  l.operations = [op({ details: card("METRO", "4131") })];
  M.reclassify(l);
  assert.equal(l.operations[0].category, "Транспорт");
  assert.equal(M.matchingRule(l, l.operations[0]), undefined);
  l.descriptionRules[0].alternateDescriptions = ["Оплата в METRO Test RUS"];
  M.reclassify(l);
  assert.equal(l.operations[0].category, "Транспорт");
  assert.equal(M.matchingRule(l, l.operations[0]), undefined);
});

test("explicit replacement of manual exceptions reaches new descriptions of a merchant", () => {
  const l = M.emptyLedger();
  l.operations = [
    op({
      details: "Оплата в SHOP Other RUS",
      manualKind: true,
      manualCategory: true,
      category: "Подарки",
      kind: M.K.excluded,
    }),
  ];
  M.setRule(l, rule({ matchMerchant: true }), true);
  assert.equal(l.operations[0].category, "Одежда");
  assert.equal(l.operations[0].kind, M.K.expense);
});

test("new settings roundtrip MCC and merchant rules; old files remain readable; malformed metadata is rejected", () => {
  const l = M.emptyLedger();
  l.descriptionRules = [rule({ matchMerchant: true })];
  l.mccCategories = { "5641": "Одежда" };
  const settings = decodeSettings(encodeSettings(l));
  const target = { ...M.emptyLedger(), classificationVersion: 1 };
  applySettings(target, settings);
  assert.deepEqual(target.mccCategories, l.mccCategories);
  assert(target.descriptionRules![0].matchMerchant);
  assert.equal(target.classificationVersion, 2);
  const old = JSON.parse(encodeSettings(l));
  old.version = 1;
  delete old.mccCategories;
  delete old.descriptionRules[0].matchMerchant;
  assert.deepEqual(decodeSettings(JSON.stringify(old)).mccCategories, {});
  for (const mccCategories of [
    { "12345": "Еда" },
    { "5411": " " },
    { "5411": 1 },
    [],
  ]) {
    assert.throws(() =>
      decodeSettings(JSON.stringify({ ...old, version: 2, mccCategories })),
    );
  }
  assert.throws(() =>
    decodeLedger(encodeLedger({ ...l, operations: [op({ mcc: "invalid" })] })),
  );
  assert.deepEqual(M.reset(l).mccCategories, l.mccCategories);
});
