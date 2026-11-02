import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/core/model";
import { merchantCategory } from "../src/core/categories";

const pdf = (merchant = "EXAMPLE SHOP", mcc = "5411") =>
  `Операция по карте: 000000++++++0001, на сумму: 10.00 RUR, дата совершения операции: 03.10.26, место совершения операции: 12345678\\RU\\CITY\\${merchant} (AP-0001) MCC${mcc}`;
const xlsx = (merchant = "EXAMPLE SHOP", mcc = "5411", city = "CITY") =>
  `Операция по карте: 000000******0001, дата создания транзакции: 03-10-2026, место совершения операции: RU/${city}/${merchant}, MCC: ${mcc}`;
const operation = (details: string): M.Operation => ({
  id: "synthetic-alfa-purchase",
  date: "2026-10-03",
  bank: "Альфа-Банк",
  account: "0001",
  details,
  amount: -1000n,
  currency: "RUB",
  category: "Без категории",
  kind: M.K.expense,
  source: "synthetic.pdf",
  sourceRow: "1",
  bankID: "",
  possibleDuplicate: false,
});

test("Alfa PDF and XLSX expose the same merchant and separate MCC", () => {
  const expected = { merchant: "RU/CITY/EXAMPLE SHOP", mcc: "5411" };
  assert.deepEqual(M.cardPurchase(pdf()), expected);
  assert.deepEqual(M.cardPurchase(xlsx()), expected);
  assert.equal(M.groupKey(pdf(), true), M.groupKey(xlsx(), true));
  assert.equal(M.groupLabel(pdf()), "RU/CITY/EXAMPLE SHOP · MCC 5411");
});

test("Alfa PDF grouping ignores only card, amount, date and terminal references", () => {
  const changed = pdf()
    .replace("000000++++++0001", "999999++++++9999")
    .replace("10.00 RUR", "1234.50 RUB")
    .replace("03.10.26", "21.11.26")
    .replace("12345678", "87654321")
    .replace("AP-0001", "AP-9999");
  assert.deepEqual(M.cardPurchase(changed), M.cardPurchase(pdf()));
  assert.equal(M.groupKey(changed, true), M.groupKey(pdf(), true));
  assert.equal(M.merchantKey(changed, true), M.merchantKey(pdf(), true));
  assert.notEqual(M.groupKey(changed, true), M.groupKey(changed, false));
});

test("Alfa PDF merchant normalization preserves shop and service digits", () => {
  for (const [a, b] of [
    ["SHOP1", "SHOP2"],
    ["YANDEX*4121*TAXI", "YANDEX*5411*LAVKA"],
  ]) {
    assert.equal(M.cardPurchase(pdf(a))?.merchant, `RU/CITY/${a}`);
    assert.notEqual(M.groupKey(pdf(a), true), M.groupKey(pdf(b), true));
    assert.notEqual(M.merchantKey(pdf(a), true), M.merchantKey(pdf(b), true));
  }
});

test("Alfa PDF groups and merchant presets retain their MCC boundary", () => {
  assert.notEqual(
    M.groupKey(pdf(), true),
    M.groupKey(pdf("EXAMPLE SHOP", "5814"), true),
  );
  const ledger = M.emptyLedger();
  ledger.descriptionRules = [
    {
      id: "synthetic-alfa-rule",
      description: xlsx("EXAMPLE SHOP", "5411", "OTHER"),
      debit: true,
      category: "Мой магазин",
      kind: M.K.expense,
      matchMerchant: true,
    },
  ];
  assert.equal(
    M.matchingRule(ledger, operation(pdf("EXAMPLE SHOP", "5814"))),
    undefined,
  );
});

test("merchant presets match Alfa PDF and XLSX in both directions across cities", () => {
  for (const [description, details] of [
    [xlsx("EXAMPLE SHOP", "5411", "OTHER"), pdf()],
    [pdf(), xlsx("EXAMPLE SHOP", "5411", "OTHER")],
  ]) {
    const ledger = M.emptyLedger();
    const rule: M.Rule = {
      id: "synthetic-alfa-rule",
      description,
      debit: true,
      category: "Мой магазин",
      kind: M.K.expense,
      matchMerchant: false,
    };
    ledger.descriptionRules = [rule];
    assert.equal(M.matchingRule(ledger, operation(details)), undefined);
    rule.matchMerchant = true;
    assert.equal(M.matchingRule(ledger, operation(details)), rule);
  }
});

test("Alfa card grouping requires the explicit purchase template and MCC", () => {
  for (const description of [
    pdf().replace("Операция по карте:", "Перевод по карте:"),
    pdf().replace(" MCC5411", ""),
    pdf().replace("MCC5411", "MCC54111"),
    `Перевод другому человеку. ${pdf()}`,
  ]) {
    assert.equal(M.cardPurchase(description), undefined);
    assert.equal(M.merchantKey(description, true), undefined);
  }
});

test("Alfa PDF merchant hints exclude the city and keep the shop", () => {
  const unknown = pdf("EXAMPLE SHOP", "3990").replace("\\CITY\\", "\\LENTA\\");
  assert.equal(merchantCategory(unknown), undefined);
  assert.equal(
    merchantCategory(xlsx("EXAMPLE SHOP", "3990", "LENTA")),
    undefined,
  );
  assert.equal(merchantCategory(pdf("PYATEROCHKA", "3990")), "Продукты");
});

test("Alfa savings remittances never reclassify a fee for a remittance as savings", () => {
  assert.equal(
    M.suggest(
      "Перечисление средств в рамках услуги «Копилка для сдачи» со счета 0001 на счет 0002",
      -1000n,
    ).kind,
    M.K.savings,
  );
  assert.deepEqual(
    M.suggest("Комиссия за перечисление средств на брокерский счет", -1000n),
    { kind: M.K.expense, category: "Комиссии" },
  );
});
