import test from "node:test";
import assert from "node:assert/strict";
import { parsePDFPages, type PDFText } from "../src/io/parsers";
import { append, emptyLedger, K } from "../src/core/model";

const t = (str: string, x: number, y: number, width = 35): PDFText => ({
  str,
  x,
  y,
  width,
  height: 8,
});
const header = [
  t("ДАТА ОПЕРАЦИИ (МСК)", 45, 600),
  t("Дата обработки", 45, 585),
  t("и код авторизации", 45, 575),
  t("КАТЕГОРИЯ", 152, 600),
  t("Описание операции", 152, 585),
  t("СУММА В ВАЛЮТЕ СЧЁТА", 370, 600),
  t("Сумма в валюте", 405, 585),
  t("ОСТАТОК СРЕДСТВ", 490, 600),
];
const row = (
  category: string,
  description: string[],
  amount: string,
  balance: string,
  y: number,
  date = "29.10.2026",
  processed = date,
) => [
  t(date, 45, y),
  t("15:43", 102, y),
  t(category, 152, y),
  t(amount, 420, y),
  t(balance, 530, y),
  t(processed, 45, y - 11),
  t("123456", 102, y - 11),
  ...description.map((s, i) => t(s, 152, y - 11 * (i + 1))),
];
const statement = (): PDFText[][] => [
  [
    t("СберБанк Онлайн", 45, 810),
    t("Выписка по счёту дебетовой карты", 45, 780),
    t("Номер счёта", 57, 730),
    t("00000 000 0 0000 0000001", 195, 730),
    t("Валюта", 57, 715),
    t("Российский рубль", 195, 715),
    t("Остаток на 23.10.2026", 349, 755),
    t("100,00", 520, 755),
    t("Пополнение", 349, 740),
    t("200,00", 520, 740),
    t("Списание", 349, 725),
    t("100,00", 520, 725),
    t("Остаток на 29.10.2026", 349, 710),
    t("200,00", 520, 710),
    ...header,
    ...row(
      "Рестораны и кафе",
      ["CAFE. Операция по карте ****0001"],
      "10,00",
      "200,00",
      550,
    ),
    ...row(
      "Оплата по QR–коду СБП",
      ["Аптека. Операция по карте ****0001"],
      "40,00",
      "210,00",
      500,
    ),
    ...row(
      "Прочие операции",
      ["SBERBANK ONL@IN VKLAD-KARTA. Операция по карте", "****0001"],
      "+200,00",
      "250,00",
      450,
    ),
    t("Продолжение на следующей странице", 235, 100),
  ],
  [
    t("Выписка по счёту дебетовой карты", 45, 810),
    t("Страница 2 из 2", 505, 810),
    ...header,
    ...row(
      "Прочие операции",
      ["KOPILKA KARTA-VKLAD. Операция по карте ****0001"],
      "30,00",
      "50,00",
      550,
      "24.10.2026",
    ),
    ...row(
      "Супермаркеты",
      ["SHOP. Операция по карте", "****0001"],
      "20,00",
      "80,00",
      500,
      "22.10.2026",
      "23.10.2026",
    ),
    t("Дата формирования документа", 45, 300),
    t("29.10.2026", 190, 300),
    t("ПАО Сбербанк. Генеральная лицензия", 45, 200),
    t(
      "В выписке отображаются только обработанные в заданном периоде операции.",
      45,
      180,
    ),
  ],
];

test("Sber reads unsigned debits, account amounts, bank categories and original operation dates", () => {
  const parsed = parsePDFPages(
    statement().map((p) => [...p].reverse()),
    "sber.pdf",
  );
  assert.equal(parsed.operations.length, 5);
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(
    parsed.operations.map((o) => o.amount),
    [-1000n, -4000n, 20000n, -3000n, -2000n],
  );
  assert.ok(
    parsed.operations.every(
      (o) =>
        o.bank === "Сбербанк" &&
        o.account === "00000000000000000001" &&
        o.currency === "RUB",
    ),
  );
  assert.equal(parsed.operations[0].bankCategory, "Рестораны и кафе");
  assert.equal(parsed.operations[0].category, "Кафе и рестораны");
  assert.equal(parsed.operations[1].category, "Здоровье");
  assert.equal(parsed.operations[2].kind, K.transfer);
  assert.equal(
    parsed.operations[2].details,
    "SBERBANK ONL@IN VKLAD-KARTA. Операция по карте ****0001",
  );
  assert.equal(parsed.operations[3].kind, K.savings);
  assert.equal(parsed.operations[4].date, "2026-10-22");
  assert.equal(parsed.operations[4].category, "Продукты");
  const l = emptyLedger();
  append(l, parsed, "sber.pdf", "digest");
  assert.equal(l.operations.length, 5); // The six-digit authorization code is not a unique bank ID.
  assert.ok(parsed.operations.every((o) => !o.bankID && !o.mcc));
});

test("Sber uses only the account amount, not a foreign original-currency subline", () => {
  const pages = statement();
  pages[0].push(t("1,00 USD", 420, 539));
  assert.equal(
    parsePDFPages(pages, "foreign.pdf").operations[0].amount,
    -1000n,
  );
});

test("Sber treats an unspecified SBP recipient as needing review", () => {
  const pages = statement();
  pages[0] = pages[0].map((i) => ({
    ...i,
    str: i.str === "Рестораны и кафе" ? "Перевод СБП" : i.str,
  }));
  const op = parsePDFPages(pages, "transfer.pdf").operations[0];
  assert.equal(op.kind, K.review);
  assert.equal(op.bankCategory, "Перевод СБП");
});

test("Sber rejects missing, reordered, duplicated and unfinished pages", () => {
  const pages = statement();
  for (const bad of [
    [pages[0]],
    [pages[1]],
    [pages[1], pages[0]],
    [pages[0], pages[0], pages[1]],
    [pages[0], pages[1].filter((i) => i.str !== "Дата формирования документа")],
  ])
    assert.throws(() => parsePDFPages(bad, "broken.pdf"));
});

test("Sber checks every running balance, totals, metadata and row date independently", () => {
  for (const mutate of [
    (p: PDFText[][]) => {
      p[0] = p[0].map((i) => ({
        ...i,
        str: i.x === 530 && i.y === 500 ? "211,00" : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[0] = p[0].filter((i) => i.str !== "Пополнение");
    },
    (p: PDFText[][]) => {
      p[0] = p[0].map((i) => ({
        ...i,
        str: i.x === 520 && i.y === 725 ? "101,00" : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[0] = p[0].map((i) => ({
        ...i,
        str: i.x === 520 && i.y === 755 ? "101,00" : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[0] = p[0].filter((i) => !(i.x === 45 && i.y === 550));
    },
    (p: PDFText[][]) => {
      p[0] = p[0].filter((i) => !(i.x === 45 && i.y === 539));
    },
    (p: PDFText[][]) => {
      p[0] = p[0].map((i) => ({
        ...i,
        str: i.str === "Российский рубль" ? "Неизвестная валюта" : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[0] = p[0].map((i) => ({
        ...i,
        str: i.str.startsWith("00000") ? "00001" : i.str,
      }));
    },
  ]) {
    const pages = statement();
    mutate(pages);
    assert.throws(() => parsePDFPages(pages, "broken.pdf"));
  }
});
