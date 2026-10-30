import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/core/model";
import { decodeLedger, encodeLedger } from "../src/core/codec";
import { LedgerStore, type Storage } from "../src/io/platform";
const op = (patch: Partial<M.Operation> = {}): M.Operation => ({
  id: M.uuid(),
  date: "2026-10-01",
  bank: "Test",
  account: "0001",
  details: "Магазин",
  amount: -1000n,
  currency: "RUB",
  category: "Продукты",
  kind: M.K.expense,
  source: "test",
  sourceRow: "1",
  possibleDuplicate: false,
  bankID: "",
  ...patch,
});
const ledger = (...operations: M.Operation[]): M.Ledger => ({
  ...M.emptyLedger(),
  operations,
});

test("money stays exact, including amounts beyond JavaScript number precision", () => {
  for (const [s, n] of [
    ["1 234,56 ₽", 123456n],
    ["(10,01)", -1001n],
    ["−0.01", -1n],
    ["1,234.56", 123456n],
    ["1.234,56", 123456n],
    ["0", 0n],
  ] as const)
    assert.equal(M.money(s), n);
  for (const s of ["1.001", "NaN", "1e3", "∞", "1000000000001", "12-3"])
    assert.throws(() => M.money(s));
  const l = ledger(op({ amount: 9007199254740993n }));
  assert.equal(
    decodeLedger(encodeLedger(l)).operations[0].amount,
    9007199254740993n,
  );
  l.imports.push({
    id: M.uuid(),
    filename: "test",
    digest: "hash",
    importedAt: 814369992.95282495,
    count: 1,
    warnings: [],
  });
  assert.equal(
    decodeLedger(encodeLedger(l)).imports[0].importedAt,
    l.imports[0].importedAt,
  );
  assert.throws(() =>
    decodeLedger(
      encodeLedger(ledger(op())).replace("-1000", "100.00000000000000001"),
    ),
  );
  assert.equal(
    M.formatMoney(9007199254740993n).replace(/\s/g, ""),
    "90071992547409,93₽",
  );
  assert.throws(() =>
    M.validateAmounts([op({ amount: -9223372036854775808n })]),
  );
  assert.throws(() =>
    M.validateAmounts([
      op({ amount: 9223372036854775807n }),
      op({ amount: 1n }),
    ]),
  );
});
test("dates and backup boundaries reject invalid input", () => {
  assert.equal(M.operationDate("29.02.2024"), "2024-02-29");
  for (const s of ["29.02.2025", "2026-13-01", "2026-02-30"])
    assert.throws(() => M.operationDate(s));
  for (const source of [
    "{}",
    '{"version":3,"operations":[],"imports":[]}',
    '{"__proto__":{}}',
    '{"version":1,"version":1}',
    '{"constructor":{}}',
  ])
    assert.throws(() => decodeLedger(source));
  const good = encodeLedger(ledger(op()));
  for (const [a, b] of [
    ["-1000", "0.1"],
    ["2026-10-01", "2026-02-30"],
    ['"RUB"', '"?"'],
    ['"Расход"', '"Новый тип"'],
  ])
    assert.throws(() => decodeLedger(good.replace(a, b)));
  const o = op();
  assert.throws(() => decodeLedger(encodeLedger(ledger(o, o))));
});
test("financial types, refunds, savings and review have separate totals", () => {
  const operations = [
    op({ amount: -10000n }),
    op({ amount: 2500n, kind: M.K.refund }),
    op({ amount: -90000n, kind: M.K.savings }),
    op({ amount: 90000n, kind: M.K.savings }),
    op({ amount: -2000n, kind: M.K.review, category: "Без категории" }),
    op({ amount: 100000n, kind: M.K.income }),
    ...([M.K.excluded, M.K.pending, M.K.transfer] as M.Kind[]).map((kind) =>
      op({ kind, amount: -999n }),
    ),
  ];
  assert.deepEqual(M.cashFlow(operations, true), [
    { period: "2026-10", expenses: 12000n, income: 102500n, savings: 90000n },
  ]);
  assert.deepEqual(M.cashFlow(operations, true, "Нет расходов"), [
    { period: "2026-10", expenses: 0n, income: 102500n, savings: 90000n },
  ]);
  for (const m of ["expenses", "income", "savings"] as const)
    assert.equal(
      M.breakdown(operations, m).reduce((s, g) => s + g.amount, 0n),
      operations.reduce((s, o) => s + M.amountOf(o, m), 0n),
    );
  assert.equal(
    M.needsReview(
      op({
        kind: M.K.excluded,
        category: "Без категории",
        possibleDuplicate: true,
      }),
    ),
    false,
  );
  assert.equal(
    M.needsReview(op({ kind: M.K.savings, category: "Без категории" })),
    false,
  );
  assert.equal(
    M.needsReview(op({ kind: M.K.transfer, possibleDuplicate: true })),
    true,
  );
});
test("description grouping removes variable metadata without guessing different merchants", () => {
  const a =
    "Операция по карте: 123456******7890, дата создания транзакции: 10-10-2026, место совершения операции: RU/Test/METRO, MCC: 4131";
  assert.equal(
    M.groupKey(a, true),
    M.groupKey(a.replace("10-10", "11-10").replace("7890", "7891"), true),
  );
  assert.equal(
    M.groupKey("Оплата в VILKA-LOZKA Novosibirsk RUS", true),
    M.groupKey("Оплата в vilka_lozka Novosibirsk RUS", true),
  );
  assert(
    M.similarNames(
      "Оплата в Vilka Lozhka Novosibirsk RUS",
      "Оплата в VILKA-LOZKA Novosibirsk RUS",
    ),
  );
  assert(
    !M.similarNames(
      "Оплата в SHOP 1 Novosibirsk RUS",
      "Оплата в SHOP 2 Novosibirsk RUS",
    ),
  );
  assert.notEqual(M.groupKey(a, true), M.groupKey(a, false));
  assert.equal(
    M.groupKey('Пополнение. Зарплата. ООО "КОМПАНИЯ"', false),
    M.groupKey("Пополнение. ООО «КОМПАНИЯ». Зарплата", false),
  );
  const sbp =
    "Категория: Перевод по СБП.Перевод C1234 через Систему быстрых платежей от +79991111111. Без НДС.";
  assert.equal(
    M.groupKey(sbp, false),
    M.groupKey(sbp.replace("C1234", "С5678"), false),
  );
  assert.notEqual(
    M.groupKey(sbp, false),
    M.groupKey(sbp.replace("1111111", "2222222"), false),
  );
});
test("preset edits and deletion preserve individual exceptions and original classification", () => {
  const l = ledger(op(), op());
  const r: M.Rule = {
    id: M.uuid(),
    description: "Магазин",
    debit: true,
    category: "Кафе",
    kind: M.K.expense,
  };
  M.setRule(l, r);
  assert(l.operations.every((o) => o.category === "Кафе"));
  M.editOperation(l, l.operations[0].id, {
    category: "Подарки",
    kind: M.K.excluded,
  });
  M.setRule(l, { ...r, category: "Покупки" });
  assert.equal(l.operations[0].category, "Подарки");
  assert.equal(l.operations[0].kind, M.K.excluded);
  assert.equal(l.operations[1].category, "Покупки");
  l.descriptionRules = [];
  M.reclassify(l);
  assert.equal(l.operations[0].category, "Подарки");
  assert.equal(l.operations[1].category, "Продукты");
  M.setRule(l, r, true);
  assert(
    l.operations.every((o) => o.category === "Кафе" && o.kind === M.K.expense),
  );
  M.reclassify(l);
  assert(l.operations.every((o) => o.category === "Кафе"));
});
test("explicit group merge retains aliases and catches conflicts", () => {
  const l = ledger(
    op({ details: "Оплата в Coffee One" }),
    op({ details: "Оплата в Kofe One" }),
  );
  const groups = M.descriptionGroups(l);
  M.mergeGroups(l, groups[1].id, groups[0].id);
  assert.equal(M.descriptionGroups(l).length, 1);
  assert.equal(l.descriptionRules?.length, 1);
  const r = l.descriptionRules![0];
  assert.equal(M.matchingRule(l, l.operations[1])?.id, r.id);
  assert.throws(() => M.setRule(l, { ...r, id: M.uuid() }));
});
test("own phone rule is reversible and manual types win", () => {
  const send = (phone: string, patch: Partial<M.Operation> = {}) =>
    op({
      details: "Внешний перевод по номеру телефона " + phone,
      category: "Без категории",
      kind: M.K.review,
      ...patch,
    });
  const l = ledger(
    send("+79991111111"),
    send("+79992222222"),
    send("+79993333333", { kind: M.K.savings, manualKind: true }),
    send("999***1111"),
  );
  M.setOwnPhone(l, "8 (999) 111-11-11");
  assert.deepEqual(
    l.operations.map((o) => o.kind),
    [M.K.transfer, M.K.outgoing, M.K.savings, M.K.review],
  );
  l.otherPhonesArePeople = false;
  M.reclassify(l);
  assert.equal(l.operations[1].kind, M.K.review);
  assert.equal(l.operations[0].kind, M.K.transfer);
  M.setOwner(l, "phone|79991111111", undefined);
  assert.equal(l.operations[0].kind, M.K.review);
  assert.throws(() => M.setOwnPhone(l, "1111"));
});
test("people combine named phones, keep actual recipient, and exclude HOLD and ignored transfers", () => {
  const a = op({ details: "Внешний перевод по номеру телефона +79991111111" }),
    b = op({ details: "Внешний перевод по номеру телефона +79992222222" }),
    unknown = op({
      details: "Внешний перевод по номеру телефона +79993333333",
    });
  const l = ledger(
    a,
    b,
    unknown,
    op({ ...a, id: M.uuid(), kind: M.K.pending }),
    op({ ...a, id: M.uuid(), kind: M.K.excluded }),
  );
  M.setName(l, "phone|79991111111", "Анна");
  M.setName(l, "phone|79992222222", " анна ");
  assert.deepEqual(
    M.contacts(l).map((c) => c.id),
    ["name|анна", "phone|79993333333"],
  );
  assert.equal(M.contacts(l)[0].phoneIDs.length, 2);
  assert.equal(M.recipient(l, b), "Кому: анна · +79992222222");
  assert.equal(
    M.transferIndex(l.operations).get("phone|79991111111")?.length,
    1,
  );
  assert.equal(
    M.incomeSource(
      op({
        details: "Перевод с договора 12345",
        amount: 100n,
        kind: M.K.income,
        category: "Доходы",
      }),
    ),
    "Переводы с договоров",
  );
  assert.equal(
    M.incomeSource(
      op({ details: "Кэшбэк за покупки у партнеров", category: "Доходы" }),
    ),
    "Кэшбэк",
  );
});
test("imports reject changed bank IDs and repeated files; ambiguous repeats stay reviewable", () => {
  const l = ledger();
  M.append(
    l,
    { operations: [op({ bankID: "123" })], warnings: [] },
    "a",
    "hash1",
  );
  M.append(
    l,
    { operations: [op({ bankID: "123" })], warnings: [] },
    "b",
    "hash2",
  );
  assert.equal(l.operations.length, 1);
  assert.throws(() =>
    M.append(l, { operations: [], warnings: [] }, "b", "hash2"),
  );
  assert.throws(() =>
    M.append(
      l,
      { operations: [op({ bankID: "123", amount: -500n })], warnings: [] },
      "c",
      "hash3",
    ),
  );
  assert.equal(l.imports.length, 2);
  M.append(l, { operations: [op()], warnings: [] }, "c", "hash3");
  assert.equal(l.operations[1].possibleDuplicate, true);
  M.setOwnPhone(l, "79991111111");
  M.setName(l, "phone|79992222222", "Друг");
  M.setRule(l, {
    id: M.uuid(),
    description: "Магазин",
    debit: true,
    kind: M.K.expense,
    category: "Еда",
  });
  const clean = M.reset(l);
  assert.equal(clean.operations.length, 0);
  assert.equal(clean.descriptionRules?.length, 1);
  assert.deepEqual(clean.phoneNames, l.phoneNames);
  assert.deepEqual(M.ownPhoneIDs(clean), M.ownPhoneIDs(l));
});
test("failed saves and invalid replacement leave the current ledger intact", async () => {
  let fail = false,
    saved: string | null = null,
    backups = 0;
  const storage: Storage = {
    load: async () => saved,
    save: async (s, b) => {
      if (fail) throw Error("disk full");
      saved = s;
      backups += Number(b);
    },
  };
  const store = new LedgerStore(storage);
  await store.load();
  await store.change((l) => l.operations.push(op()));
  const old = encodeLedger(store.ledger),
    disk = saved;
  fail = true;
  await assert.rejects(store.change((l) => (l.operations = [])));
  assert.equal(encodeLedger(store.ledger), old);
  assert.equal(saved, disk);
  assert.equal(store.busy, false);
  fail = false;
  await assert.rejects(store.replace("{}"));
  assert.equal(saved, disk);
  await store.replace(encodeLedger(M.emptyLedger()));
  assert.equal(backups, 1);
  assert.equal(store.ledger.operations.length, 0);
  saved = "broken";
  const corrupt = new LedgerStore(storage);
  await corrupt.load();
  assert.equal(corrupt.readOnly, true);
  await assert.rejects(corrupt.change((l) => (l.operations = [])));
  assert.equal(saved, "broken");
  fail = true;
  await assert.rejects(corrupt.replace(encodeLedger(M.emptyLedger())));
  assert.equal(saved, "broken");
  assert.equal(corrupt.readOnly, true);
  fail = false;
  await corrupt.replace(encodeLedger(M.emptyLedger()));
  assert.equal(backups, 2);
  assert.equal(corrupt.readOnly, false);
});
