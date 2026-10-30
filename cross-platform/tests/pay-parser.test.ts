import test from "node:test";
import assert from "node:assert/strict";
import { parsePDFPages, type PDFText } from "../src/io/parsers";
import {
  append,
  emptyLedger,
  K,
  merchantKey,
  suggest,
} from "../src/core/model";

const t = (str: string, x: number, y: number, width = 60): PDFText => ({
  str,
  x,
  y,
  width,
  height: 8,
});
const header = [
  t("Описание операции", 20, 600),
  t("Дата и время", 210, 600),
  t("операции", 224, 590),
  t("Дата", 312, 600),
  t("обработки", 290, 590),
  t("Карта", 358, 600),
  t("Сумма в валюте", 415, 600),
  t("операции", 439, 590),
  t("Сумма в валюте", 510, 600),
  t("ЭСП", 554, 590),
];
const row = (
  description: string[],
  amount: string,
  y: number,
  original = amount,
) => [
  ...description.map((s, i) => t(s, 20, y - 12 * i)),
  t("01.09.2026", 211, y),
  t("в 14:19", 235, y - 10),
  t("02.09.2026", 281, y),
  t("*1234", 354, y),
  t(original, 415, y),
  t(amount, 510, y),
];
const balance = (label: string, value: string, y: number) => [
  t(label, 20, y),
  t(value, 510, y),
];
const metadata = (bankAccount = false) => [
  t("Выписка по договору", 20, 810),
  t("АО «Яндекс Банк»", 20, 790),
  t("Был заключён договор", 20, 780),
  t("Данные клиента в соседней колонке", 440, 780),
  t(`№ ${bankAccount ? "К" : "Э"}00000000000000001 от 01.05.2026`, 20, 770),
  t(bankAccount ? "«Банковский счёт»" : "«Счёт ЭДС»", 20, 750),
  ...(bankAccount
    ? [t("В рамках Договора открыт счёт 00000000000000000001", 20, 720)]
    : []),
  ...balance("Входящий остаток на 01.09.2026", "0,00 ₽", 650),
];
const totals = (income: string, expense: string, closing: string) => [
  ...balance("Исходящий остаток за 01.09.2026", closing, 200),
  ...balance("Всего расходных операций", expense, 170),
  ...balance("Всего приходных операций", income, 140),
];
const statement = (): PDFText[][] => [
  [t("Файл содержит две выписки", 20, 700)],
  [
    ...metadata(),
    ...header,
    ...row(
      [
        "Входящий перевод СБП, Тестовый отправитель,",
        "+7 999 000-00-01, Другой Банк",
      ],
      "+110,00 ₽",
      550,
    ),
    ...row(
      ["Оплата товаров и услуг", "YANDEX*4121*TAXI"],
      "–50,00 ₽",
      490,
      "–1,00 $",
    ),
    t("Продолжение на следующей странице", 220, 63),
    t("Страница 1 из 2", 510, 33),
  ],
  [
    ...header,
    ...row(["Оплата товаров и услуг YANDEX*4121*TAXI"], "–50,00 ₽", 550),
    ...row(
      ["Перенос денежных средств с ЭДС", "на банковский счёт"],
      "–10,00 ₽",
      490,
    ),
    ...totals("+110,00 ₽", "–110,00 ₽", "0,00 ₽"),
    t("Страница 2 из 2", 510, 33),
  ],
  [
    ...metadata(true),
    ...header.map((i) => ({ ...i, str: i.str === "ЭСП" ? "Договора" : i.str })),
    ...row(
      ["Перенос денежных средств с ЭДС", "на банковский счёт"],
      "+10,00 ₽",
      550,
    ),
    ...totals("+10,00 ₽", "0,00 ₽", "10,00 ₽"),
    t("Страница 1 из 1", 510, 33),
  ],
];

test("Pay PDF dispatch imports both wallet and account, reconciles separately and preserves rows", () => {
  // Extraction order is not reading order: balances may arrive after the table.
  const r = parsePDFPages(
    statement().map((p) => [...p].reverse()),
    "pay.pdf",
  );
  assert.equal(r.operations.length, 5);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(
    r.operations.map((o) => o.amount),
    [11000n, -5000n, -5000n, -1000n, 1000n],
  );
  assert.equal(r.operations[0].bank, "Яндекс Банк");
  assert.equal(r.operations[0].account, "Э00000000000000001");
  assert.equal(r.operations[4].account, "00000000000000000001");
  assert.equal(r.operations[1].date, "2026-09-01");
  assert.equal(r.operations[1].currency, "RUB");
  assert.equal(
    r.operations[1].details,
    "Оплата товаров и услуг YANDEX*4121*TAXI",
  );
  assert.equal(r.operations[1].category, "Транспорт");
  assert.equal(r.operations[1].mcc, undefined);
  assert.ok(r.operations[0].details.includes("+7 999 000-00-01"));
  assert.equal(r.operations[3].kind, K.transfer);
  assert.equal(r.operations[4].kind, K.transfer);
  const l = emptyLedger();
  append(l, r, "pay.pdf", "test-digest");
  assert.equal(l.operations.length, 5); // Equal purchases are not bank duplicates.
});

test("Pay also accepts a single bank-account statement without a cover", () => {
  const r = parsePDFPages([statement()[3]], "account.pdf");
  assert.equal(r.operations.length, 1);
  assert.equal(r.operations[0].amount, 1000n);
});

test("Pay rejects missing, repeated and unordered pages or sections", () => {
  const pages = statement();
  for (const broken of [
    pages.slice(0, -1),
    [pages[0], pages[1], pages[3]],
    [pages[0], pages[1], pages[1], pages[2], pages[3]],
    [pages[0], pages[2], pages[1], pages[3]],
  ])
    assert.throws(() => parsePDFPages(broken, "broken.pdf"));
});

test("Pay refuses mismatched totals, missing controls, currencies, balances and undated amounts", () => {
  for (const mutate of [
    (p: PDFText[][]) => {
      p[2] = p[2].map((i) => ({
        ...i,
        str: i.str === "–110,00 ₽" ? "–111,00 ₽" : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[3] = p[3].filter((i) => i.y !== 170);
    },
    (p: PDFText[][]) => {
      p[3] = p[3].map((i) => ({
        ...i,
        str: i.y === 550 && i.x === 510 ? "+10,00 $" : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[3] = p[3].map((i) => ({
        ...i,
        str: i.y === 200 && i.x === 510 ? "11,00 ₽" : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[1] = p[1].filter((i) => !(i.y === 550 && i.x === 211));
    },
    (p: PDFText[][]) => {
      p[1] = p[1].filter((i) => i.str !== "Описание операции");
    },
  ]) {
    const pages = statement();
    mutate(pages);
    assert.throws(() => parsePDFPages(pages, "broken.pdf"));
  }
});

test("Pay descriptions reuse merchant rules and identify only explicit own transfers and refunds", () => {
  assert.equal(
    merchantKey("Оплата товаров и услуг MARIYA-RA", true),
    merchantKey("Оплата в MARIYA-RA Novosibirsk RUS", true),
  );
  for (const amount of [-100n, 100n])
    assert.equal(
      suggest("Перевод между счетами одного клиента", amount).kind,
      K.transfer,
    );
  assert.equal(
    suggest("Возврат средств СБП QR (Сервисы)", 100n).kind,
    K.refund,
  );
  assert.equal(
    suggest("Входящий перевод СБП, Другой человек", 100n).kind,
    K.review,
  );
  assert.notEqual(
    suggest("Оплата товаров и услуг Перевод себе", -100n).kind,
    K.transfer,
  );
});
