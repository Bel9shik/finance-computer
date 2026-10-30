import { inflateSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { extractMCC } from "../core/categories";
import {
  abs,
  K,
  money,
  normalize,
  operationDate,
  suggest,
  namedInternalTransfer,
  uuid,
  validateAmounts,
  type Parsed,
  type Operation,
} from "../core/model";
export function currencyCode(raw: string) {
  const v = raw.trim().toUpperCase();
  if (["RUR", "RUB", "₽", "РУБ."].includes(v)) return "RUB";
  if (v === "$") return "USD";
  if (v === "€") return "EUR";
  if (/^[A-Z]{3}$/.test(v)) return v;
  throw Error("Не удалось определить валюту");
}
export function reconcile(
  ops: Operation[],
  income: bigint | undefined,
  expense: bigint | undefined,
  currency: string,
  pending = false,
) {
  validateAmounts(ops);
  const items = ops.filter(
    (o) => (pending || o.kind !== K.pending) && o.currency === currency,
  );
  const sum = (positive: boolean) =>
    items
      .filter((o) => (positive ? o.amount > 0n : o.amount < 0n))
      .reduce((s, o) => s + abs(o.amount), 0n);
  if (income !== undefined && sum(true) !== income)
    throw Error("Сумма поступлений не сошлась с итогом банка. Импорт отменён");
  if (expense !== undefined && sum(false) !== expense)
    throw Error("Сумма списаний не сошлась с итогом банка. Импорт отменён");
  return income === undefined || expense === undefined
    ? [
        "Нет обоих контрольных итогов банка. Полноту импорта нужно проверить вручную.",
      ]
    : [];
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function spreadsheetSheets(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.length),
    decoder = new TextDecoder("utf-8", { fatal: true });
  const n = (p: number, len = 4) => {
    if (p < 0 || p + len > data.length) throw Error("Повреждённый ZIP");
    return len === 2 ? view.getUint16(p, true) : view.getUint32(p, true);
  };
  let end = -1;
  for (let p = data.length - 22; p >= Math.max(0, data.length - 65557); p--)
    if (n(p) === 0x06054b50 && p + 22 + n(p + 20, 2) === data.length) {
      end = p;
      break;
    }
  if (end < 0 || n(end + 4, 2) || n(end + 6, 2) || n(end + 10, 2) >= 4096)
    throw Error("Повреждённый или неподдерживаемый XLSX");
  const entries = new Map<
    string,
    {
      size: number;
      compressed: number;
      offset: number;
      method: number;
      crc: number;
    }
  >();
  let cursor = n(end + 16),
    total = 0;
  for (let i = 0; i < n(end + 10, 2); i++) {
    if (n(cursor) !== 0x02014b50) throw Error("Повреждённый каталог XLSX");
    const flags = n(cursor + 8, 2),
      method = n(cursor + 10, 2),
      compressed = n(cursor + 20),
      size = n(cursor + 24),
      length = n(cursor + 28, 2),
      extra = n(cursor + 30, 2),
      comment = n(cursor + 32, 2);
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      size > 64 * 1024 * 1024 ||
      cursor + 46 + length + extra + comment > data.length
    )
      throw Error("Неподдерживаемый или слишком большой XLSX");
    total += size;
    if (total > 128 * 1024 * 1024)
      throw Error("Распакованный XLSX превышает 128 МБ");
    const name = decoder.decode(
      data.subarray(cursor + 46, cursor + 46 + length),
    );
    if (entries.has(name)) throw Error("Повторная запись в XLSX");
    entries.set(name, {
      size,
      compressed,
      offset: n(cursor + 42),
      method,
      crc: n(cursor + 16),
    });
    cursor += 46 + length + extra + comment;
  }
  const read = (path: string) => {
    const e = entries.get(path);
    if (!e || n(e.offset) !== 0x04034b50)
      throw Error("Повреждённая запись XLSX");
    const start = e.offset + 30 + n(e.offset + 26, 2) + n(e.offset + 28, 2);
    if (start + e.compressed > data.length) throw Error("Обрезанный XLSX");
    const input = data.subarray(start, start + e.compressed);
    const output =
      e.method === 0
        ? input
        : inflateSync(input, { out: new Uint8Array(e.size) });
    if (output.length !== e.size || crc32(output) !== e.crc)
      throw Error("Не совпадает контрольная сумма XLSX");
    const xml = decoder.decode(output);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw Error("XML с DTD не поддерживается");
    if (XMLValidator.validate(xml) !== true) throw Error("Повреждённый XML");
    return xml;
  };
  const parse = (path: string) =>
    new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@",
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: false,
    }).parse(read(path));
  const array = (v: any): any[] =>
    v == null ? [] : Array.isArray(v) ? v : [v];
  const text = (v: any): string =>
    typeof v === "string"
      ? v
      : typeof v === "number"
        ? String(v)
        : v && typeof v === "object"
          ? text(v["#text"] ?? v.t ?? "")
          : "";
  const shared = entries.has("xl/sharedStrings.xml")
    ? array(parse("xl/sharedStrings.xml").sst?.si).map((si) =>
        si.t !== undefined
          ? text(si.t)
          : array(si.r)
              .map((r) => text(r.t))
              .join(""),
      )
    : [];
  if (
    entries.has("xl/workbook.xml") &&
    /date1904\s*=\s*["'](?:1|true)["']/.test(read("xl/workbook.xml"))
  )
    throw Error("Календарь Excel 1904 пока не поддерживается");
  const names = [...entries.keys()]
    .filter(
      (n) =>
        n.startsWith("xl/worksheets/") &&
        n.endsWith(".xml") &&
        !n.includes("/_rels/"),
    )
    .sort();
  if (!names.length) throw Error("В XLSX нет листов");
  return names.map((name) => {
    const raw = array(parse(name).worksheet?.sheetData?.row);
    if (raw.length > 100000) throw Error("На листе больше 100 000 строк");
    const rows = raw.map((row, i) => {
      const cells: string[] = [];
      for (const c of array(row.c)) {
        let column = 0;
        for (const ch of String(c["@r"] ?? "A").toUpperCase()) {
          if (!/[A-Z]/.test(ch)) break;
          column = column * 26 + ch.charCodeAt(0) - 64;
        }
        column = Math.max(0, column - 1);
        if (column >= 1024) throw Error("На листе больше 1024 столбцов");
        let value = text(c.v);
        if (c["@t"] === "s") {
          const index = Number(value);
          if (!Number.isInteger(index) || index < 0 || index >= shared.length)
            throw Error("Некорректная ссылка на текст XLSX");
          value = shared[index];
        } else if (c["@t"] === "inlineStr")
          value =
            c.is?.t !== undefined
              ? text(c.is.t)
              : array(c.is?.r)
                  .map((r) => text(r.t))
                  .join("");
        cells[column] = value;
      }
      return {
        number: Number(row["@r"] ?? i + 1),
        cells: Array.from({ length: cells.length }, (_, j) => cells[j] ?? ""),
      };
    });
    return { name, rows };
  });
}
export function parseAlfa(data: Uint8Array, filename: string): Parsed {
  const result: Parsed = { operations: [], warnings: [] };
  for (const { name, rows } of spreadsheetSheets(data)) {
    const h = rows.findIndex((r) =>
      r.cells.some((c) => normalize(c) === "дата операции"),
    );
    if (h < 0) continue;
    const all = normalize(rows.flatMap((r) => r.cells).join(" "));
    if (!all.includes("альфа-банк") && !all.includes("альфа банк"))
      throw Error("XLSX не распознан как выписка Альфа‑Банка");
    const headers = rows[h].cells.map(normalize),
      col = (s: string) => headers.indexOf(s),
      dateCol = col("дата операции"),
      amountCol = col("сумма в валюте счета"),
      descCol = col("описание");
    if ([dateCol, amountCol, descCol].some((i) => i < 0))
      throw Error("Неизвестные столбцы XLSX");
    const meta = (s: string) => {
      for (const r of rows.slice(0, h)) {
        const i = r.cells.findIndex((c) => normalize(c) === s);
        if (i >= 0) return r.cells.slice(i + 1).find((c) => c.trim());
      }
    };
    const rawCurrency = meta("валюта счета"),
      account = meta("номер счета");
    if (!rawCurrency || !account)
      throw Error("Не найдены номер и валюта счёта");
    const currency = currencyCode(rawCurrency),
      owner = normalize(meta("клиент") ?? "");
    const ops: Operation[] = [];
    for (const row of rows.slice(h + 1)) {
      const cell = (i: number) => (row.cells[i] ?? "").trim(),
        rawDate = cell(dateCol),
        rawAmount = cell(amountCol);
      if (normalize(rawDate) === "дата операции") continue;
      if (!rawAmount && !/^\d{2}\.\d{2}\.\d{4}/.test(rawDate)) continue;
      const location = `${name}, строка ${row.number}`;
      try {
        const serial = Number(rawDate);
        const date =
            rawDate && serial >= 1 && serial <= 100000
              ? new Date(-2209161600000 + Math.floor(serial) * 86400000)
                  .toISOString()
                  .slice(0, 10)
              : operationDate(rawDate),
          amount = money(rawAmount),
          details = cell(descCol);
        if (!details) throw Error("Пустое описание");
        let { kind, category } = suggest(
          details,
          amount,
          cell(col("категория")),
        );
        const rawMCC = cell(
          headers.findIndex((h) =>
            ["mcc", "мсс", "mcc-код", "мсс-код"].includes(h),
          ),
        );
        if (rawMCC && !/^\d{4}$/.test(rawMCC)) throw Error("Некорректный MCC");
        const mcc = rawMCC || extractMCC(details);
        if (rawMCC && extractMCC(details) && rawMCC !== extractMCC(details))
          throw Error("MCC в столбце и описании различается");
        const internal = namedInternalTransfer(details, owner, amount);
        if (internal) {
          kind = internal;
          category = kind === K.transfer ? "Переводы" : "Переводы людям";
        }
        const status = normalize(cell(col("статус")));
        if (
          cell(col("дата проводки")).toUpperCase() === "HOLD" ||
          status.includes("обработ") ||
          status.includes("неподтвержден")
        )
          kind = K.pending;
        else if (
          status &&
          !["выполнен", "исполнен", "проведен", "выполнена"].includes(status)
        )
          throw Error("Неизвестный статус операции");
        ops.push({
          id: uuid(),
          date,
          bank: "Альфа‑Банк",
          account,
          details,
          mcc,
          bankCategory: cell(col("категория")) || undefined,
          amount,
          currency,
          category,
          kind,
          source: filename,
          sourceRow: location,
          bankID: cell(col("код")),
          possibleDuplicate: false,
        });
      } catch (e) {
        throw Error(
          `${location}: ${e instanceof Error ? e.message : e}. Файл не импортирован.`,
        );
      }
    }
    if (!ops.length) throw Error("В XLSX нет операций");
    result.warnings.push(
      ...reconcile(
        ops,
        meta("поступления") !== undefined
          ? money(meta("поступления")!)
          : undefined,
        meta("расходы") !== undefined ? money(meta("расходы")!) : undefined,
        currency,
        true,
      ),
    );
    const pending = ops.filter((o) => o.kind === K.pending);
    if (pending.length) {
      if (
        meta("неподтвержденные операции") !== undefined &&
        money(meta("неподтвержденные операции")!) !==
          pending.reduce((s, o) => s + abs(o.amount), 0n)
      )
        throw Error("Не сошлась сумма неподтверждённых операций");
      result.warnings.push(
        `Ожидают подтверждения: ${pending.length} операций. Они не включены в расходы.`,
      );
    }
    result.operations.push(...ops);
  }
  if (!result.operations.length)
    throw Error("Не найдена таблица операций Альфа‑Банка");
  return result;
}
export interface PDFText {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export function parsePDFPages(pages: PDFText[][], filename: string): Parsed {
  if (pages.length > 200) throw Error("PDF содержит больше 200 страниц");
  const full = pages
      .flat()
      .map((i) => i.str)
      .join(" "),
    norm = normalize(full);
  if (!norm)
    throw Error("В PDF нет текста. Сканированные PDF не поддерживаются");
  if (
    norm.includes("сбербанк") &&
    norm.includes("выписка по счету дебетовой карты")
  )
    return parseSberPDF(pages, filename);
  if (norm.includes("яндекс банк") && norm.includes("выписка по договору"))
    return parsePayPDF(pages, filename);
  if (
    norm.includes("справка о движении средств") &&
    (norm.includes("тбанк") || norm.includes("тинькофф"))
  )
    return parseTBankPDF(pages, filename, full);
  throw Error(
    "Формат PDF не распознан. Поддерживаются текстовые выписки Т‑Банка, Пэя и Сбербанка",
  );
}
const pdfText = (items: PDFText[]) =>
  items
    .map((i) => i.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
function pdfLines(items: PDFText[]) {
  const lines: PDFText[][] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    let line = lines.find((l) => Math.abs(l[0].y - item.y) < 2);
    if (!line) {
      line = [];
      lines.push(line);
    }
    line.push(item);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}
function parseSberPDF(pages: PDFText[][], filename: string): Parsed {
  const result: Parsed = { operations: [], warnings: [] };
  const first = pages[0].filter((i) => i.str.trim());
  const label = (pattern: RegExp) => {
    const found = first.filter((i) => pattern.test(i.str.trim()));
    if (found.length !== 1)
      throw Error("Не найдены однозначные реквизиты или итоги Сбербанка");
    return found[0];
  };
  const summaryX = label(/^Пополнение$/iu).x;
  const right = (item: PDFText, limit = Infinity) =>
    pdfText(
      first
        .filter(
          (i) =>
            Math.abs(i.y - item.y) < 2 &&
            i.x >= item.x + item.width - 1 &&
            i.x < limit,
        )
        .sort((a, b) => a.x - b.x),
    );
  const account = right(label(/^Номер сч[её]та$/iu), summaryX).replace(
    /\s/g,
    "",
  );
  if (!/^\d{20}$/.test(account)) throw Error("Не найден номер счёта Сбербанка");
  const rawCurrency = right(label(/^Валюта$/iu), summaryX);
  const currency = currencyCode(
    (
      { "российский рубль": "RUB", "доллар сша": "USD", евро: "EUR" } as Record<
        string,
        string
      >
    )[normalize(rawCurrency)] ?? rawCurrency,
  );
  const income = money(right(label(/^Пополнение$/iu)));
  const expense = money(right(label(/^Списание$/iu)));
  const balanceLabels = first
    .filter((i) => /^Остаток на \d{2}\.\d{2}\.\d{4}$/iu.test(i.str.trim()))
    .sort((a, b) => b.y - a.y);
  if (balanceLabels.length !== 2 || income < 0n || expense < 0n)
    throw Error("Не найдены остатки или неверны знаки итогов Сбербанка");
  const opening = money(right(balanceLabels[0])),
    closing = money(right(balanceLabels[1]));
  const balances: bigint[] = [];
  for (let p = 0; p < pages.length; p++) {
    const context = `Страница ${p + 1}`;
    try {
      const items = pages[p].filter((i) => i.str.trim()),
        lines = pdfLines(items);
      const numbering = items.filter((i) =>
        /^Страница \d+ из \d+$/u.test(i.str.trim()),
      );
      if (numbering.length > 1 || (p > 0 && numbering.length !== 1))
        throw Error("Не найдена нумерация страниц Сбербанка");
      if (numbering.length) {
        const m = numbering[0].str.match(/Страница (\d+) из (\d+)/u)!;
        if (Number(m[1]) !== p + 1 || Number(m[2]) !== pages.length)
          throw Error("В выписке пропущена или повторена страница");
      }
      const continuing = items.find(
        (i) => i.str.trim() === "Продолжение на следующей странице",
      );
      const ending = items.find(
        (i) => i.str.trim() === "Дата формирования документа",
      );
      if (p < pages.length - 1 ? !continuing || ending : !ending || continuing)
        throw Error("Отсутствует продолжение или конец выписки Сбербанка");
      const header = lines.find((l) =>
        l.some((i) => /^ДАТА ОПЕРАЦИИ/iu.test(i.str)),
      );
      if (!header) throw Error("Не найден заголовок таблицы Сбербанка");
      const column = (pattern: RegExp) => {
        const item = header.find((i) => pattern.test(i.str.trim()));
        if (!item) throw Error("Не распознаны столбцы Сбербанка");
        return item.x;
      };
      const dateX = column(/^ДАТА ОПЕРАЦИИ/iu),
        descriptionX = column(/^КАТЕГОРИЯ$/iu);
      const amountX = column(/^СУММА В ВАЛЮТЕ СЧ[ЕЁ]ТА$/iu),
        balanceX = column(/^ОСТАТОК СРЕДСТВ$/iu);
      if (!(
        dateX < descriptionX &&
        descriptionX < amountX &&
        amountX < balanceX
      ))
        throw Error("Неизвестное расположение столбцов Сбербанка");
      const bottom = (continuing ?? ending)!.y;
      const body = lines.filter(
        (l) => l[0].y < header[0].y - 30 && l[0].y > bottom,
      );
      const left = (l: PDFText[]) =>
        l.filter((i) => i.x >= dateX - 1 && i.x < descriptionX - 1);
      const dateItems = (l: PDFText[]) =>
        l.filter(
          (i) =>
            Math.abs(i.x - dateX) < 2 &&
            /^\d{2}\.\d{2}\.\d{4}$/.test(i.str.trim()),
        );
      const starts = body.filter((l) =>
        left(l).some((i) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(i.str.trim())),
      );
      if (
        !starts.length ||
        body.filter((l) => dateItems(l).length).length !== starts.length * 2
      )
        throw Error("Не у каждой операции найдены обе даты");
      const accountAmountLines = body.filter(
        (l) =>
          l.some((i) => i.x >= amountX && i.x < balanceX) &&
          l.some((i) => i.x >= balanceX),
      );
      if (accountAmountLines.length !== starts.length)
        throw Error("Не у каждой суммы найдена дата операции");
      for (let i = 0; i < starts.length; i++) {
        const start = starts[i];
        const dates = dateItems(start);
        if (dates.length !== 1) throw Error("Не найдена дата операции");
        const row = body.filter(
          (l) =>
            l[0].y <= start[0].y + 2 &&
            l[0].y > (starts[i + 1]?.[0].y ?? bottom) + 2,
        );
        const processing = row.filter(
          (l) => l !== start && dateItems(l).length,
        );
        if (processing.length !== 1)
          throw Error("Не найдена дата обработки операции");
        const processingDate = operationDate(
          dateItems(processing[0])[0].str.trim(),
        );
        const code = left(processing[0]).filter((t) =>
          /^\d{6}$/.test(t.str.trim()),
        );
        if (code.length !== 1)
          throw Error("Не найден код авторизации операции");
        const rawAmount = pdfText(
          start.filter((t) => t.x >= amountX && t.x < balanceX),
        );
        // Sber prints debits without a minus; a leading '+' identifies a receipt.
        const amount = rawAmount.startsWith("+")
          ? money(rawAmount)
          : -abs(money(rawAmount));
        const balance = money(pdfText(start.filter((t) => t.x >= balanceX)));
        const bankCategory = pdfText(
          start.filter((t) => t.x >= descriptionX && t.x < amountX),
        );
        const details = pdfText(
          row
            .filter((l) => l !== start)
            .flatMap((l) =>
              l.filter((t) => t.x >= descriptionX && t.x < amountX),
            ),
        );
        if (!bankCategory || !details)
          throw Error("Пустая категория или описание операции");
        let classification = suggest(details, amount, bankCategory);
        if (
          /^перевод(?:\s|$)/u.test(normalize(bankCategory)) &&
          classification.kind === K.expense
        )
          classification = { kind: K.review, category: "Без категории" };
        result.operations.push({
          id: uuid(),
          date: operationDate(dates[0].str.trim()),
          bank: "Сбербанк",
          account,
          details,
          bankCategory,
          mcc: extractMCC(details),
          amount,
          currency,
          ...classification,
          source: filename,
          sourceRow: `${context}, операция ${i + 1}; обработка ${processingDate}, код ${code[0].str}`,
          bankID: "",
          possibleDuplicate: false,
        });
        balances.push(balance);
      }
    } catch (e) {
      throw Error(
        `${context}: ${e instanceof Error ? e.message : e}. Файл не импортирован.`,
      );
    }
  }
  reconcile(result.operations, income, expense, currency, true);
  if (opening + income - expense !== closing)
    throw Error("Остатки Сбербанка не сошлись с итогами");
  let expected = closing;
  for (let i = 0; i < balances.length; i++) {
    if (balances[i] !== expected)
      throw Error("Не сошёлся промежуточный остаток Сбербанка. Импорт отменён");
    expected -= result.operations[i].amount;
  }
  if (expected !== opening)
    throw Error("Не сошёлся входящий остаток Сбербанка");
  return result;
}
function parsePayPDF(pages: PDFText[][], filename: string): Parsed {
  const result: Parsed = { operations: [], warnings: [] };
  let section:
    | {
        account: string;
        opening: bigint;
        currency: string;
        page: number;
        pages: number;
        operations: Operation[];
      }
    | undefined;
  let completed = 0,
    expectedSections: number | undefined;
  const amountCell = (raw: string) => {
    const code = raw.match(/(?:₽|RUB|RUR|USD|EUR|\$|€)\s*$/i)?.[0];
    if (!code) throw Error("Не определена валюта суммы");
    return { amount: money(raw), currency: currencyCode(code) };
  };
  for (let p = 0; p < pages.length; p++) {
    const context = `Страница ${p + 1}`;
    try {
      const items = pages[p].filter((i) => i.str.trim()),
        lines = pdfLines(items);
      const full = lines.map(pdfText).join(" ");
      const header = lines.find((l) =>
        /^Описание операции(?:\s|$)/u.test(pdfText(l)),
      );
      if (!header) {
        if (p === 0 && /Файл содержит две выписки/iu.test(full)) {
          expectedSections = 2;
          continue;
        }
        throw Error("Не найден заголовок таблицы Пэя");
      }
      const numbering = full.match(/Страница\s+(\d+)\s+из\s+(\d+)/iu);
      if (!numbering) throw Error("Не найдена нумерация страниц выписки");
      const page = Number(numbering[1]),
        count = Number(numbering[2]);
      if (!page || page > count || count > 200)
        throw Error("Некорректная нумерация страниц выписки");
      const control = (label: RegExp) => {
        const found = lines.filter((l) => label.test(pdfText(l)));
        if (found.length !== 1)
          throw Error("Не найдены однозначные контрольные итоги банка");
        return amountCell(pdfText(found[0]).replace(label, ""));
      };
      if (page === 1) {
        if (section) throw Error("Отсутствует конец предыдущей выписки");
        const metadata = lines
          .filter((l) => l[0].y > header[0].y)
          .map(pdfText)
          .join(" ");
        const contract = metadata.match(
          /№\s*([\p{L}]?\d{8,})\s+от\s+\d{2}\.\d{2}\.\d{4}/iu,
        )?.[1];
        const accounts = [...new Set(metadata.match(/\b\d{20}\b/g))];
        const wallet = /Сч[её]т ЭДС/iu.test(metadata);
        if (!contract || (!wallet && accounts.length !== 1))
          throw Error("Не найден договор или номер счёта Пэя");
        const opening = control(
          /^Входящий остаток на \d{2}\.\d{2}\.\d{4}\s*/iu,
        );
        section = {
          account: wallet ? contract : accounts[0],
          opening: opening.amount,
          currency: opening.currency,
          page: 0,
          pages: count,
          operations: [],
        };
      }
      if (!section || section.page + 1 !== page || section.pages !== count)
        throw Error("В выписке пропущена или повторена страница");
      section.page = page;
      const dateHeader = header.find((i) => i.str.trim() === "Дата и время");
      const sums = header.filter((i) => i.str.trim() === "Сумма в валюте");
      if (
        !dateHeader ||
        sums.length !== 2 ||
        dateHeader.x >= sums[0].x ||
        sums[0].x >= sums[1].x
      )
        throw Error("Не распознаны столбцы Пэя");
      // The last column is the account amount; the purchase may be in another currency.
      const amountX = (sums[0].x + sums[0].width + sums[1].x) / 2;
      const footer = lines.filter((l) =>
        /^(?:Исходящий остаток за|Всего (?:расходных|приходных) операций|Продолжение на следующей странице|Страница \d+ из)/iu.test(
          pdfText(l),
        ),
      );
      const bottom = Math.max(
        ...footer.map((l) => l[0].y + Math.max(...l.map((i) => i.height))),
      );
      const body = lines.filter(
        (l) => l[0].y < header[0].y - 25 && l[0].y > bottom,
      );
      const starts = body.filter((l) =>
        l.some(
          (i) =>
            /^\d{2}\.\d{2}\.\d{4}$/.test(i.str.trim()) &&
            Math.abs(i.x - dateHeader.x) < 4,
        ),
      );
      if (
        body.filter((l) => l.some((i) => i.x >= amountX)).length !==
        starts.length
      )
        throw Error("Не у каждой суммы найдена дата операции");
      for (let i = 0; i < starts.length; i++) {
        const line = starts[i],
          y = line[0].y;
        const date = line.find(
          (t) =>
            Math.abs(t.x - dateHeader.x) < 4 &&
            /^\d{2}\.\d{2}\.\d{4}$/.test(t.str.trim()),
        )!;
        const value = amountCell(pdfText(line.filter((t) => t.x >= amountX)));
        if (value.currency !== section.currency)
          throw Error("Валюты операции и счёта различаются");
        const details = pdfText(
          body
            .filter(
              (l) =>
                l[0].y <= y + 2 &&
                l[0].y > (starts[i + 1]?.[0].y ?? bottom) + 2,
            )
            .flatMap((l) => l.filter((t) => t.x < dateHeader.x - 4)),
        );
        if (!details) throw Error("Пустое описание операции");
        section.operations.push({
          id: uuid(),
          date: operationDate(date.str.trim()),
          bank: "Яндекс Банк",
          account: section.account,
          details,
          mcc: extractMCC(details),
          ...value,
          ...suggest(details, value.amount),
          source: filename,
          sourceRow: `${context}, операция ${i + 1}`,
          bankID: "",
          possibleDuplicate: false,
        });
      }
      if (page === count) {
        const income = control(/^Всего приходных операций\s*/iu);
        const expense = control(/^Всего расходных операций\s*/iu);
        const closing = control(
          /^Исходящий остаток за \d{2}\.\d{2}\.\d{4}\s*/iu,
        );
        const currency = section.currency;
        if ([income, expense, closing].some((v) => v.currency !== currency))
          throw Error("Разные валюты контрольных итогов");
        if (income.amount < 0n || expense.amount > 0n)
          throw Error("Неверные знаки контрольных итогов");
        reconcile(
          section.operations,
          income.amount,
          abs(expense.amount),
          section.currency,
          true,
        );
        if (section.opening + income.amount + expense.amount !== closing.amount)
          throw Error("Остаток на счёте не сошёлся с итогами банка");
        result.operations.push(...section.operations);
        section = undefined;
        completed++;
      } else if (
        lines.some((l) =>
          /^Всего (?:приходных|расходных) операций/iu.test(pdfText(l)),
        )
      )
        throw Error("Итоги обнаружены до последней страницы выписки");
    } catch (e) {
      throw Error(
        `${context}: ${e instanceof Error ? e.message : e}. Файл не импортирован.`,
      );
    }
  }
  if (
    section ||
    (expectedSections !== undefined && completed !== expectedSections)
  )
    throw Error("В PDF отсутствует часть выписки Пэя. Файл не импортирован.");
  if (!result.operations.length) throw Error("В PDF не найдены операции");
  return result;
}
function parseTBankPDF(
  pages: PDFText[][],
  filename: string,
  full: string,
): Parsed {
  const account = full.match(
    /Номер\s+лицевого\s+сч[её]та\s*:\s*(\d{20})/i,
  )?.[1];
  if (!account) throw Error("Не найден номер счёта в PDF");
  const result: Parsed = { operations: [], warnings: [] };
  let income: bigint | undefined,
    expense: bigint | undefined,
    control: string | undefined;
  for (let p = 0; p < pages.length; p++) {
    const items = pages[p].filter((i) => i.str.trim()),
      context = `Страница ${p + 1}`;
    const lines = pdfLines(items),
      text = pdfText;
    const totals = lines.filter((l) =>
      /^(Пополнения|Расходы)\s*:/i.test(text(l)),
    );
    for (const line of totals) {
      const value = text(line).replace(/^(Пополнения|Расходы)\s*:\s*/i, ""),
        code = value.match(/₽|RUB|RUR|USD|EUR|\$|€/i)?.[0];
      if (!code) throw Error("Не определена валюта итогов PDF");
      const c = currencyCode(code);
      if (control && control !== c) throw Error("Разные валюты итогов PDF");
      control = c;
      if (/^пополнения\s*:/i.test(text(line))) income = money(value);
      else expense = money(value);
    }
    const header = lines.find((l) => /Дата и время/i.test(text(l)));
    if (!header) {
      const summary = normalize(items.map((i) => i.str).join(" "));
      if (
        p === pages.length - 1 &&
        result.operations.length &&
        totals.length === 2 &&
        income !== undefined &&
        expense !== undefined &&
        summary.includes("с уважением") &&
        !/\b\d{2}\.\d{2}\.\d{4}\b/.test(summary)
      )
        continue;
      throw Error(`${context}: не найден заголовок таблицы`);
    }
    const headerText = text(header),
      headerY = header[0].y;
    function column(pattern: RegExp) {
      for (let i = 0; i < header!.length; i++)
        if (
          pattern.test(
            header!
              .slice(i)
              .map((x) => x.str)
              .join(" "),
          )
        )
          return header![i].x;
      throw Error(`${context}: не распознаны столбцы PDF`);
    }
    const dateX = column(/^Дата и время/i),
      amountX = column(/^Сумма операции/i),
      descriptionX = column(/^Описание/i),
      cardX = column(/^Номер/i);
    if (
      !(dateX < amountX && amountX < descriptionX && descriptionX < cardX) ||
      !headerText
    )
      throw Error("Неизвестное расположение столбцов PDF");
    const starts = items
      .filter(
        (i) =>
          /^\d{2}\.\d{2}\.\d{4}$/.test(i.str.trim()) &&
          Math.abs(i.x - dateX) < 4 &&
          i.y < headerY,
      )
      .sort((a, b) => b.y - a.y);
    const footer = lines
      .filter((l) => normalize(text(l)).includes("универсальная лицензия"))
      .map((l) => l[0].y + Math.max(...l.map((i) => i.height)) + 2);
    const bottom = totals.length
      ? Math.max(
          ...totals.map(
            (l) => l[0].y + Math.max(...l.map((i) => i.height)) + 1,
          ),
        )
      : footer.length
        ? Math.max(...footer)
        : 65;
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i],
        lower =
          i + 1 < starts.length
            ? starts[i + 1].y + starts[i + 1].height
            : bottom,
        top = start.y + start.height + 1;
      if (top <= lower) throw Error("Не определены границы строки PDF");
      const columnText = (x: number, right: number) =>
        text(
          items
            .filter(
              (t) =>
                t.y < top &&
                t.y >= lower - 0.1 &&
                t.x >= x - 1 &&
                t.x < right - 1,
            )
            .sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x)),
        );
      const location = `${context}, операция ${i + 1}`;
      try {
        const date = operationDate(start.str.trim()),
          raw = columnText(amountX, descriptionX),
          code = raw.match(/₽|RUB|RUR|USD|EUR|\$|€/i)?.[0];
        if (!code) throw Error("Не найдена валюта операции");
        const currency = currencyCode(code),
          amount = money(raw),
          details = columnText(descriptionX, cardX);
        if (!details) throw Error("Пустое описание");
        result.operations.push({
          id: uuid(),
          date,
          bank: "Т‑Банк",
          account,
          details,
          mcc: extractMCC(details),
          amount,
          currency,
          ...suggest(details, amount),
          source: filename,
          sourceRow: location,
          bankID: "",
          possibleDuplicate: false,
        });
      } catch (e) {
        throw Error(
          `${location}: ${e instanceof Error ? e.message : e}. Файл не импортирован.`,
        );
      }
    }
  }
  if (!result.operations.length) throw Error("В PDF не найдены операции");
  if (control) {
    if (result.operations.some((o) => o.currency !== control))
      throw Error("Валюта операций отличается от валюты итогов");
    result.warnings.push(
      ...reconcile(result.operations, income, expense, control),
    );
  } else
    result.warnings.push(
      "Не найдены контрольные суммы банка. Проверь полноту импорта вручную.",
    );
  return result;
}
