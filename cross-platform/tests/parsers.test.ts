import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import {
  parseAlfa,
  spreadsheetSheets,
  parsePDFPages,
  reconcile,
  type PDFText,
} from "../src/io/parsers";
import { K } from "../src/core/model";
import { emptyLedger, append } from "../src/core/model";
import { decodeLedger, encodeLedger } from "../src/core/codec";
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL("../../build/fixtures/" + name, import.meta.url)),
  );
test("XLSX parser reconciles bank totals and excludes pending purchases", () => {
  const r = parseAlfa(fixture("valid.xlsx"), "test.xlsx");
  assert.equal(r.operations.length, 3);
  assert.deepEqual(
    r.operations.map((o) => o.amount),
    [-12550n, 100000n, -1000n],
  );
  assert.equal(r.operations[2].kind, K.pending);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.operations[0].category, "Продукты");
});
test("XLSX keeps bank category and MCC as independent facts and rejects conflicting codes", () => {
  const bytes = (mcc = "5641", description = "Операция по карте: SHOP") => {
    const rows = [
      ["Альфа-Банк"],
      ["Номер счета", "0001"],
      ["Валюта счета", "RUB"],
      ["Дата операции", "Сумма в валюте счета", "Описание", "Категория", "MCC"],
      ["01.10.2026", "-100.00", description, "Прочие операции", mcc],
    ];
    const xml = `<worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${c}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
    return zipSync({ "xl/worksheets/sheet1.xml": strToU8(xml) });
  };
  const parsed = parseAlfa(bytes(), "test.xlsx");
  assert.equal(parsed.operations[0].mcc, "5641");
  assert.equal(parsed.operations[0].bankCategory, "Прочие операции");
  const ledger = emptyLedger();
  append(ledger, parsed, "test.xlsx", "digest");
  const saved = decodeLedger(encodeLedger(ledger)).operations[0];
  assert.equal(saved.category, "Покупки");
  assert.equal(saved.bankCategory, "Прочие операции");
  assert.equal(saved.mcc, "5641");
  assert.throws(() => parseAlfa(bytes("56411"), "invalid.xlsx"));
  assert.throws(() =>
    parseAlfa(
      bytes("5641", "Операция по карте: SHOP MCC: 5411"),
      "conflict.xlsx",
    ),
  );
});
for (const f of [
  "bad-total.xlsx",
  "bad-status.xlsx",
  "bad-money.xlsx",
  "bad-xml.xlsx",
])
  test("reject entire malformed statement " + f, () =>
    assert.throws(() => parseAlfa(fixture(f), f)),
  );
test("ZIP reader rejects truncation, bad CRC, and unsafe XML", () => {
  const data = fixture("valid.xlsx");
  assert.throws(() => spreadsheetSheets(data.slice(0, -1)));
  const xml = "<worksheet><sheetData/></worksheet>",
    zip = zipSync({ "xl/worksheets/sheet1.xml": strToU8(xml) }, { level: 0 });
  const bad = zip.slice();
  const index = new TextDecoder().decode(bad).indexOf("sheetData");
  bad[index] = 120;
  assert.throws(() => spreadsheetSheets(bad));
  assert.throws(() =>
    spreadsheetSheets(
      zipSync({
        "xl/worksheets/sheet1.xml": strToU8(
          '<!DOCTYPE x [<!ENTITY a "x">]><worksheet/>',
        ),
      }),
    ),
  );
});
const t = (str: string, x: number, y: number): PDFText => ({
  str,
  x,
  y,
  width: 10,
  height: 9,
});
const page = [
  t("ТБанк Справка о движении средств", 10, 810),
  t("Номер лицевого счета: 12345678901234567890", 10, 790),
  t("Дата и время", 10, 700),
  t("Сумма операции", 100, 700),
  t("Описание", 200, 700),
  t("Номер", 400, 700),
  t("01.10.2026", 10, 660),
  t("-10.00 ₽", 100, 660),
  t("Оплата в CAFE", 200, 660),
];
const summary = [
  t("Пополнения: 0.00 ₽", 10, 600),
  t("Расходы: 10.00 ₽", 10, 580),
  t("С уважением", 10, 560),
];
test("PDF accepts final totals-only page, but refuses a missing table on other pages", () => {
  const parsed = parsePDFPages([page, summary], "test.pdf");
  assert.equal(parsed.operations.length, 1);
  assert.equal(parsed.operations[0].amount, -1000n);
  assert.equal(parsed.operations[0].details, "Оплата в CAFE");
  assert.equal(parsed.warnings.length, 0);
  assert.throws(() => parsePDFPages([page, summary, page], "test.pdf"));
  assert.throws(() =>
    parsePDFPages(
      [
        page,
        summary.map((x) => ({ ...x, str: x.str.replace("10.00", "20.00") })),
      ],
      "test.pdf",
    ),
  );
  assert.throws(() => parsePDFPages([summary], "scan.pdf"));
});
test("reconciliation never mixes currencies", () => {
  const parsed = parsePDFPages([page, summary], "test.pdf");
  assert.deepEqual(reconcile(parsed.operations, 0n, 1000n, "RUB"), []);
  assert.throws(() => reconcile(parsed.operations, 0n, 1000n, "USD"));
});
test("PDF text extraction can split metadata at spaces and punctuation", () => {
  const fragmented = [
    ...page.filter((x) => !x.str.startsWith("Номер лицевого")),
    t("Номер", 10, 790),
    t("лицевого", 50, 790),
    t("счета", 110, 790),
    t(": 12345678901234567890", 160, 790),
  ];
  const totals = summary.map((x) => ({ ...x, str: x.str.replace(":", " :") }));
  assert.equal(
    parsePDFPages([fragmented, totals], "fragmented.pdf").operations.length,
    1,
  );
});
