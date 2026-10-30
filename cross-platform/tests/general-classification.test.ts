import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/core/model";
import { decodeLedger, encodeLedger } from "../src/core/codec";

const operation = (details: string, amount = -100n): M.Operation => ({
  id: M.uuid(),
  date: "2026-01-01",
  bank: "Test",
  account: "001",
  details,
  amount,
  currency: "RUB",
  source: "test",
  sourceRow: "1",
  bankID: "",
  possibleDuplicate: false,
  category: "Без категории",
  kind: M.K.review,
});

test("saving contributions, withdrawals and interest are different cash flows", () => {
  for (const description of [
    "Перевод для пополнения счета Инвесткопилка",
    "Пополнение Инвесткопилки",
    "Сберегательный взнос по договору № 999",
    "Перевод на накопительный счет",
    "Пополнение вклада № 123",
    "Взнос на брокерский счет",
    "Пополнение копилки для сдачи",
  ])
    assert.equal(M.suggest(description, -100n).kind, M.K.savings, description);
  for (const description of [
    "Вывод средств с брокерского счета",
    "Возврат вклада № 999",
    "Закрытие накопительного счета",
    "Перевод с накопительного счета",
  ])
    assert.equal(M.suggest(description, 100n).kind, M.K.transfer, description);
  assert.equal(
    M.suggest("Начисление процентов по вкладу", 100n).kind,
    M.K.income,
  );
  assert.equal(
    M.suggest("Оплата в Kopilka Cafe Kazan RUS", -100n).kind,
    M.K.expense,
  );
  assert.equal(M.suggest("Перевод на договор 123456", -100n).kind, M.K.review);
  assert.equal(
    M.suggest("Возврат долга по телефону +79990000001", 100n).kind,
    M.K.review,
  );
});

test("merchant services generalize across banks, cities, separators and terminal numbers", () => {
  const examples: [string, string][] = [
    ["YANDEX*4121*GO", "Транспорт"],
    ["Яндекс Такси", "Транспорт"],
    ["YANDEX*9999*LAVKA", "Продукты"],
    ["YANDEX*5814*EDA", "Кафе и рестораны"],
    ["YANDEX SCOOTERS", "Транспорт"],
    ["DELIMOBIL", "Транспорт"],
    ["WHOOSH100", "Транспорт"],
    ["TPP_METRO", "Транспорт"],
    ["MARIYA RA", "Продукты"],
    ["БЫСТРОНОМ", "Продукты"],
    ["VILKA-LOZKA", "Кафе и рестораны"],
    ["Vilka Lozhka", "Кафе и рестораны"],
    ["APTEKA 123", "Здоровье"],
    ["KLINIKA TEST", "Здоровье"],
    ["Coffee House", "Кафе и рестораны"],
    ["Fresh Burgers", "Кафе и рестораны"],
    ["Городские Парковки", "Транспорт"],
    ["Dodo Pizza", "Кафе и рестораны"],
    ["Магнит", "Продукты"],
    ["RZD Passaghiram", "Транспорт"],
  ];
  for (const [merchant, category] of examples) {
    for (const details of [
      `Оплата в ${merchant} Kazan RUS`,
      `Операция по карте: 0000****0000, место совершения операции: RU/Perm/${merchant}, MCC: 9999`,
    ])
      assert.equal(M.suggest(details, -100n).category, category, details);
  }
  for (const name of [
    "METRO",
    "YANDEX",
    "YANDEX MARKET",
    "SMART MARKET",
    "IP TEST",
    "TAXIDERMY",
    "KAFEIN",
    "CAFE PHARMACY",
  ])
    assert.equal(
      M.suggest(`Оплата в ${name} Kazan RUS`, -100n).category,
      M.uncategorized,
      name,
    );
  assert.equal(
    M.suggest("Оплата в KAFEIN COSMETICS Kazan RUS", -100n).category,
    "Красота и уход",
  );
  assert.equal(M.suggest("Перевод человеку: на такси", -100n).kind, M.K.review);
});

test("refunds are receipts; payment metadata outranks the merchant name", () => {
  const refund = M.suggest("Отмена операции оплаты DELIMOBIL Perm RUS", 100n);
  assert.equal(refund.kind, M.K.refund);
  assert.equal(refund.category, "Транспорт");
  assert.equal(M.incomeAmount({ ...operation("", 100n), ...refund }), 100n);
  assert.equal(M.expenseAmount({ ...operation("", 100n), ...refund }), 0n);
  assert.equal(
    M.suggest("Возврат средств по оплате UNKNOWN Kazan RUS", 100n).kind,
    M.K.refund,
  );
  assert.equal(
    M.suggest("Оплата услуг mBank.t2", -100n).category,
    "Связь и подписки",
  );
  assert.equal(M.suggest("Возврат оплаты", 100n).category, "Возвраты");
  assert.equal(
    M.suggest("Оплата в CAFE Kazan RUS, MCC: 5411", -100n).category,
    "Продукты",
  );
  assert.equal(
    M.suggest("Оплата в CAFE Kazan RUS, MCC: 5411", -100n, "Аптеки").category,
    "Здоровье",
  );
});

test("upgrade is previewed, persisted and idempotent; presets and individual choices survive", () => {
  const l = { ...M.emptyLedger(), classificationVersion: 2 };
  const savings = operation("Пополнение Инвесткопилки");
  savings.kind = M.K.transfer;
  const cafe = operation("Оплата в CAFE Kazan RUS");
  cafe.kind = M.K.expense;
  const manual = {
    ...operation("Пополнение Инвесткопилки"),
    kind: M.K.excluded,
    category: "Подарок",
    manualKind: true,
    manualCategory: true,
  };
  const pending = { ...operation("Пополнение вклада"), kind: M.K.pending };
  l.operations = [savings, cafe, manual, pending];
  const before = encodeLedger(l);
  const preview = M.automaticPreview(l);
  assert.equal(encodeLedger(l), before);
  assert.equal(preview.next.classificationVersion, 3);
  assert.equal(preview.next.operations[0].kind, M.K.savings);
  assert.equal(preview.next.operations[1].category, "Кафе и рестораны");
  assert.equal(preview.next.operations[2].kind, M.K.excluded);
  assert.equal(preview.next.operations[2].category, "Подарок");
  assert.equal(preview.next.operations[3].kind, M.K.pending);
  const next = preview.next;
  M.setRule(next, {
    id: M.uuid(),
    description: savings.details,
    debit: true,
    category: "Моя",
    kind: M.K.excluded,
  });
  assert.equal(next.operations[0].kind, M.K.excluded);
  next.descriptionRules = [];
  M.reclassify(next);
  assert.equal(next.operations[0].kind, M.K.savings);
  M.deleteCategory(next, "Кафе и рестораны");
  M.reclassify(next);
  assert.equal(next.operations[1].category, M.uncategorized);
  const encoded = encodeLedger(next);
  M.reclassify(next);
  assert.equal(encodeLedger(next), encoded);
  assert.equal(encodeLedger(decodeLedger(encoded)), encoded);
});
