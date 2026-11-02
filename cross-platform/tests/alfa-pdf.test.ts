import test from "node:test";
import assert from "node:assert/strict";
import { parsePDFPages, type PDFText } from "../src/io/parsers";
import { append, emptyLedger, K } from "../src/core/model";

const t = (str: string, x: number, y: number, width = 40): PDFText => ({
  str,
  x,
  y,
  width,
  height: 8,
});
const header = (y: number) => [
  t("Дата проводки", 27, y),
  t("Код операции", 96, y),
  t("Описание", 188, y),
  t("Сумма", 540, y),
  t("в валюте счета", 511, y - 9),
];
const footer = (page: number) => [
  t("И.И. Примеров", 388, 123),
  t("Уполномоченное лицо", 371, 112),
  t("(подпись сотрудника АО «АЛЬФА-БАНК»)", 52, 102),
  t("Страница", 507, 21),
  t(String(page), 545, 21),
  t("из", 552, 21),
  t("2", 562, 21),
];
const row = (
  code: string,
  description: string[],
  amount: string,
  y: number,
) => [
  t("05.10.2026", 27, y),
  t(code, 96, y),
  t(amount, 515, y),
  ...description.map((s, i) => t(s, 188, y - i * 9)),
];
const statement = (): PDFText[][] => [
  [
    t("Выписка по счету", 28, 706),
    t("Номер счета", 37, 670),
    t("00000000000000000001", 147, 670),
    t("Валюта счета", 37, 648),
    t("RUR", 147, 648),
    t("Клиент", 37, 601),
    t("Примеров Иван Иванович", 147, 601),
    t("За период с 01.10.2026 по 31.10.2026", 312, 675),
    t("Входящий остаток", 312, 662),
    t("0,00 RUR", 530, 662),
    t("Поступления", 316, 645),
    t("100,00 RUR", 515, 645),
    t("Расходы", 316, 628),
    t("45,00 RUR", 515, 628),
    t("Исходящий остаток", 312, 611),
    t("55,00 RUR", 515, 611),
    t("Операции по счету", 28, 488),
    ...header(466),
    ...row(
      "C123456",
      ["Перевод через Систему быстрых платежей от +70000000001.", "Без НДС."],
      "100,00 RUR",
      444,
    ),
    ...row(
      "CRD_FIRST",
      [
        "Операция по карте: 000000++++++0001, на сумму: 1.00 USD, дата совершения",
        "операции: 03.10.26, место совершения операции:",
        "12345678\\RU\\CITY\\EXAMPLE SHOP (AP-0001) MCC5411",
      ],
      "-20,00 RUR",
      410,
    ),
    ...footer(1),
  ],
  [
    ...header(727),
    ...row(
      "CRD_SECOND",
      [
        "Операция по карте: 000000++++++0001, на сумму: 20.00 RUR, дата совершения",
        "операции: 04.10.26, место совершения операции:",
        "87654321\\RU\\CITY\\EXAMPLE SHOP (AP-0002) MCC5411",
      ],
      "-20,00 RUR",
      705,
    ),
    ...row(
      "OP_SAVINGS",
      [
        "Перечисление средств в рамках услуги «Копилка для сдачи» со счета",
        "00000000000000000001 на счет 00000000000000000002",
      ],
      "-5,00 RUR",
      660,
    ),
    ...footer(2),
  ],
];

test("Alfa PDF reads all pages, original card dates, account amounts, MCC and bank IDs", () => {
  const parsed = parsePDFPages(
    statement().map((p) => [...p].reverse()),
    "alfa.pdf",
  );
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.operations.length, 4);
  assert.deepEqual(
    parsed.operations.map((o) => o.amount),
    [10000n, -2000n, -2000n, -500n],
  );
  assert.deepEqual(
    parsed.operations.map((o) => o.date),
    ["2026-10-05", "2026-10-03", "2026-10-04", "2026-10-05"],
  );
  assert.ok(
    parsed.operations.every(
      (o) =>
        o.bank === "Альфа‑Банк" &&
        o.account === "00000000000000000001" &&
        o.currency === "RUB",
    ),
  );
  assert.equal(parsed.operations[0].kind, K.review);
  assert.equal(parsed.operations[1].category, "Продукты");
  assert.equal(parsed.operations[1].mcc, "5411");
  assert.equal(parsed.operations[1].bankCategory, undefined);
  assert.match(parsed.operations[1].details, /1.00 USD/);
  assert.match(parsed.operations[1].sourceRow, /2026-10-05/);
  assert.equal(parsed.operations[3].kind, K.savings);
  const ledger = emptyLedger();
  append(ledger, parsed, "alfa.pdf", "digest");
  append(
    ledger,
    parsePDFPages(statement(), "overlap.pdf"),
    "overlap.pdf",
    "other-digest",
  );
  assert.equal(ledger.operations.length, 4);
});

test("Alfa PDF tolerates split amount, account and page-number text items", () => {
  const pages = statement();
  pages[0] = pages[0].filter(
    (i) => i.str !== "00000000000000000001" && !(i.x === 515 && i.y === 410),
  );
  pages[0].push(
    t("0000000000", 147, 670),
    t("0000000001", 193, 670),
    t("-20,00", 515, 410),
    t("RUR", 545, 410),
  );
  assert.equal(parsePDFPages(pages, "split.pdf").operations.length, 4);
});

test("Alfa cross-format bank codes preserve an existing purchase and edits across a one-day date difference", () => {
  const parsed = parsePDFPages(statement(), "alfa.pdf");
  const old = {
    ...parsed.operations[1],
    date: "2026-10-04",
    source: "alfa.xlsx",
    category: "Моя категория",
    manualCategory: true,
  };
  const ledger = emptyLedger();
  ledger.operations = [old];
  append(ledger, parsed, "alfa.pdf", "digest");
  assert.equal(ledger.operations.length, 4);
  assert.equal(ledger.operations[0], old);
  assert.equal(old.category, "Моя категория");
  assert.equal(old.date, "2026-10-04");
  assert.match(ledger.imports[0].warnings.join(" "), /Дата покупки отличается/);
  for (const changed of [
    { amount: old.amount - 1n },
    { currency: "USD" },
    { date: "2026-10-06" },
    { source: "other.pdf" },
    { bank: "Другой банк" },
  ]) {
    const l = emptyLedger();
    const prior = { ...old, ...changed };
    const incoming = { ...parsed.operations[1], bank: prior.bank };
    l.operations = [prior];
    assert.throws(() =>
      append(l, { operations: [incoming], warnings: [] }, "alfa.pdf", "bad"),
    );
    assert.deepEqual(l.operations, [prior]);
    assert.equal(l.imports.length, 0);
  }
});

test("Alfa PDF rejects missing, duplicated, reordered and unnumbered pages", () => {
  const pages = statement();
  for (const bad of [
    [pages[0]],
    [pages[1]],
    [pages[1], pages[0]],
    [pages[0], pages[0]],
    [pages[0], pages[1].filter((i) => i.y !== 21)],
  ])
    assert.throws(() => parsePDFPages(bad, "broken.pdf"));
});

test("Alfa PDF resolves short years near the posting year without hiding future dates", () => {
  const pages = statement().map((p) =>
    p.map((i) => ({
      ...i,
      str: i.str
        .replaceAll("2026", "2000")
        .replace("03.10.26", "31.12.99")
        .replace("04.10.26", "04.10.00"),
    })),
  );
  assert.equal(
    parsePDFPages(pages, "century.pdf").operations[1].date,
    "1999-12-31",
  );
  const future = statement().map((p) =>
    p.map((i) => ({ ...i, str: i.str.replace("03.10.26", "03.10.27") })),
  );
  assert.throws(
    () => parsePDFPages(future, "future.pdf"),
    /позже даты проводки/,
  );
});

test("Alfa PDF never mistakes the last description line for a missing signer name", () => {
  const pages = statement();
  pages[1] = pages[1].filter((i) => i.str !== "И.И. Примеров");
  pages[1].push(t("Хвост описания операции", 188, 123));
  assert.throws(
    () => parsePDFPages(pages, "missing-signer.pdf"),
    /конец таблицы/,
  );
});

test("Alfa PDF refuses malformed rows, omitted columns, wrong totals and currencies", () => {
  for (const mutate of [
    (p: PDFText[][]) => {
      p[0] = p[0].filter((i) => !(i.x === 27 && i.y === 410));
    },
    (p: PDFText[][]) => {
      p[0] = p[0].filter((i) => i.str !== "CRD_FIRST");
    },
    (p: PDFText[][]) => {
      p[0] = p[0].filter((i) => !(i.x === 515 && i.y === 410));
    },
    (p: PDFText[][]) => {
      p[1] = p[1].filter((i) => i.str !== "Описание");
    },
    (p: PDFText[][]) => {
      p[0] = p[0].map((i) => ({
        ...i,
        str: i.str === "Расходы" ? "Другой итог" : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[0] = p[0].map((i) => ({
        ...i,
        str: i.y === 628 && i.x === 515 ? "44,00 RUR" : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[0] = p[0].map((i) => ({
        ...i,
        str: i.y === 611 && i.x === 515 ? "54,00 RUR" : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[1] = p[1].map((i) => ({
        ...i,
        str: i.y === 705 && i.x === 515 ? "-20,00 USD" : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[1] = p[1].map((i) => ({
        ...i,
        str: i.str === "CRD_SECOND" ? "CRD_FIRST" : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[0] = p[0].map((i) => ({
        ...i,
        str: i.y === 410 && i.x === 27 ? "32.10.2026" : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[0] = p[0].map((i) => ({
        ...i,
        str: i.str.includes("операции: 03.10.26")
          ? i.str.replace("03.10.26", "06.10.26")
          : i.str,
      }));
    },
    (p: PDFText[][]) => {
      p[0] = p[0].map((i) => ({
        ...i,
        str: i.str.includes("операции: 03.10.26")
          ? i.str.replace("03.10.26", "31.02.26")
          : i.str,
      }));
    },
  ]) {
    const pages = statement();
    mutate(pages);
    assert.throws(() => parsePDFPages(pages, "broken.pdf"));
  }
});
