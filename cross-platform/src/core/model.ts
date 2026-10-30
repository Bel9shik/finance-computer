import {
  bankCategoryName,
  extractMCC,
  mccDefaults,
  merchantCategory,
  normalizedMerchant,
} from "./categories";
export { mccDefaults } from "./categories";
export const kinds = [
  "Расход",
  "Доход",
  "Возврат",
  "Между своими счетами",
  "Откладывание на счета",
  "Нужно разобрать",
  "Не учитывать",
  "Ожидает подтверждения",
  "Перевод другому человеку",
  "Перевод от другого человека",
] as const;
export type Kind = (typeof kinds)[number];
export const K = {
  expense: kinds[0],
  income: kinds[1],
  refund: kinds[2],
  transfer: kinds[3],
  savings: kinds[4],
  review: kinds[5],
  excluded: kinds[6],
  pending: kinds[7],
  outgoing: kinds[8],
  incoming: kinds[9],
};
export interface Classification {
  category: string;
  kind: Kind;
  transferReason?: string;
}
export interface Operation extends Classification {
  id: string;
  date: string;
  bank: string;
  account: string;
  details: string;
  amount: bigint;
  currency: string;
  source: string;
  sourceRow: string;
  possibleDuplicate: boolean;
  bankID: string;
  manualKind?: boolean;
  manualCategory?: boolean;
  ruleBase?: Classification;
  phoneRuleBase?: Classification;
  mcc?: string;
  bankCategory?: string;
  autoCategoryBase?: string;
  categoryReason?: string;
}
export interface Rule {
  id: string;
  description: string;
  debit: boolean;
  category: string;
  kind: Kind;
  alternateDescriptions?: string[];
  matchMerchant?: boolean;
  ignoreMCC?: boolean;
}
export interface ImportRecord {
  id: string;
  filename: string;
  digest: string;
  importedAt: number;
  count: number;
  warnings: string[];
}
export interface Ledger {
  version: 1 | 2;
  operations: Operation[];
  imports: ImportRecord[];
  descriptionRules?: Rule[];
  transferOwners?: Record<string, boolean>;
  phoneNames?: Record<string, string>;
  otherPhonesArePeople?: boolean;
  classificationVersion?: number;
  mccCategories?: Record<string, string>;
  categoryRules?: Record<string, string>;
}
export type Settings = Required<
  Pick<
    Ledger,
    | "descriptionRules"
    | "transferOwners"
    | "phoneNames"
    | "otherPhonesArePeople"
    | "mccCategories"
    | "categoryRules"
  >
>;
export interface Parsed {
  operations: Operation[];
  warnings: string[];
}
export const emptyLedger = (): Ledger => ({
  version: 1,
  operations: [],
  imports: [],
  classificationVersion: 3,
});
export const uuid = () => crypto.randomUUID().toUpperCase();
export const normalize = (s: string) =>
  s.toLowerCase().replace(/ё/g, "е").replace(/\s+/gu, " ").trim();
export const abs = (n: bigint) => (n < 0n ? -n : n);
export const expenseAmount = (o: Operation) =>
  o.kind === K.expense
    ? abs(o.amount)
    : ([K.outgoing, K.review] as Kind[]).includes(o.kind) && o.amount < 0n
      ? -o.amount
      : 0n;
export const incomeAmount = (o: Operation) =>
  ([K.income, K.incoming, K.refund] as Kind[]).includes(o.kind) && o.amount > 0n
    ? o.amount
    : 0n;
export const savingsAmount = (o: Operation) =>
  o.kind === K.savings && o.amount < 0n ? -o.amount : 0n;
export const needsReview = (o: Operation) =>
  o.kind !== K.excluded &&
  (o.kind === K.review ||
    o.possibleDuplicate ||
    (o.category === "Без категории" &&
      o.kind !== K.transfer &&
      o.kind !== K.savings));
export const categories = [
  "Продукты",
  "Кафе и рестораны",
  "Транспорт",
  "Жильё и ЖКХ",
  "Здоровье",
  "Красота и уход",
  "Покупки",
  "Развлечения",
  "Связь и подписки",
  "Оплата Codex",
  "Путешествия",
  "Образование",
  "Комиссии",
  "Возвраты",
  "Другое",
  "Без категории",
];
export const allCategories = (l: Ledger) =>
  [
    ...new Set(
      [
        ...categories,
        ...l.operations.map((o) => o.category),
        ...(l.descriptionRules ?? []).map((r) => r.category),
        ...Object.values(l.mccCategories ?? {}),
        ...Object.keys(l.categoryRules ?? {}),
      ].map((name) => categoryName(l, name)),
    ),
  ].filter((s) => s.trim());
export const uncategorized = "Без категории";
export function categoryName(
  l: Pick<Ledger, "categoryRules">,
  name: string,
): string {
  const seen = new Set<string>();
  while (Object.hasOwn(l.categoryRules ?? {}, name)) {
    const next = l.categoryRules![name];
    if (next === name) break;
    if (seen.has(name))
      throw Error("Категории ссылаются друг на друга по кругу");
    seen.add(name);
    name = next;
  }
  return name;
}
export function categorySettings(l: Pick<Ledger, "categoryRules">) {
  const result: Record<string, string> = {};
  for (const name of Object.keys(l.categoryRules ?? {})) {
    const target = categoryName(l, name);
    result[name] = target;
    result[target] = target;
  }
  return result;
}
function normalizeCategories(l: Ledger) {
  for (const o of l.operations) {
    o.category = categoryName(l, o.category);
    if (o.ruleBase) o.ruleBase.category = categoryName(l, o.ruleBase.category);
    if (o.phoneRuleBase)
      o.phoneRuleBase.category = categoryName(l, o.phoneRuleBase.category);
    if (o.autoCategoryBase !== undefined)
      o.autoCategoryBase = categoryName(l, o.autoCategoryBase);
  }
  for (const r of l.descriptionRules ?? [])
    r.category = categoryName(l, r.category);
  for (const code of Object.keys(l.mccCategories ?? {}))
    l.mccCategories![code] = categoryName(l, l.mccCategories![code]);
}
function availableCategoryName(l: Ledger, name: string, previous?: string) {
  name = name.trim();
  if (!name) throw Error("Введи название категории");
  if (
    allCategories(l).some(
      (c) => c !== previous && normalize(c) === normalize(name),
    )
  )
    throw Error("Категория с таким названием уже есть");
  return name;
}
export function addCategory(l: Ledger, name: string) {
  name = availableCategoryName(l, name);
  l.categoryRules = { ...categorySettings(l), [name]: name };
  l.version = 2;
}
export function renameCategory(l: Ledger, previous: string, name: string) {
  if (previous === uncategorized)
    throw Error("«Без категории» нельзя переименовать");
  name = availableCategoryName(l, name, previous);
  replaceCategory(l, previous, name);
}
export function deleteCategory(l: Ledger, name: string) {
  if (name === uncategorized) throw Error("«Без категории» нельзя удалить");
  for (const o of l.operations)
    if (categoryName(l, o.category) === name) o.manualCategory = true;
  replaceCategory(l, name, uncategorized);
}
function replaceCategory(l: Ledger, previous: string, name: string) {
  if (!allCategories(l).includes(previous)) throw Error("Категория не найдена");
  const rules = categorySettings(l);
  for (const key of Object.keys(rules))
    if (rules[key] === previous) rules[key] = name;
  l.categoryRules = { ...rules, [previous]: name, [name]: name };
  l.version = 2;
  normalizeCategories(l);
}
export function money(raw: string): bigint {
  let s = raw
    .trim()
    .replace(/[−–]/g, "-")
    .replace(/RUB|RUR|руб\.?|₽|USD|EUR|\$|€/gi, "")
    .replace(/\s/g, "");
  if (s.startsWith("(") && s.endsWith(")")) s = "-" + s.slice(1, -1);
  if (s.includes(",") && s.includes("."))
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replaceAll(".", "")
        : s.replaceAll(",", "");
  s = s.replace(",", ".");
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(s))
    throw Error("Не удалось разобрать сумму: " + raw);
  const [whole, fraction = ""] = s.replace(/^[+-]/, "").split(".");
  const value =
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) *
    (s.startsWith("-") ? -1n : 1n);
  if (abs(value) > 100000000000000n) throw Error("Слишком большая сумма");
  return value;
}
export function formatMoney(n: bigint, currency = "RUB"): string {
  const whole = (abs(n) / 100n).toLocaleString("ru-RU"),
    fraction = String(abs(n) % 100n).padStart(2, "0");
  return `${n < 0n ? "-" : ""}${whole},${fraction} ${currency === "RUB" ? "₽" : currency}`;
}
export function operationDate(raw: string): string {
  let y: string, m: string, d: string;
  let match = raw
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?: \d{2}:\d{2}(?::\d{2})?)?$/);
  if (match) [, y, m, d] = match;
  else {
    match = raw
      .trim()
      .match(/^(\d{2})[./](\d{2})[./](\d{4})(?: \d{2}:\d{2}(?::\d{2})?)?$/);
    if (!match) throw Error("Не удалось разобрать дату: " + raw);
    [, d, m, y] = match;
  }
  const date = `${y}-${m}-${d}`,
    parsed = new Date(date + "T00:00:00Z");
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    throw Error("Некорректная дата: " + raw);
  return date;
}
export function validateAmounts(ops: Operation[]) {
  if (ops.length > 200000) throw Error("В базе больше 200 000 операций");
  let total = 0n;
  for (const o of ops) {
    if (typeof o.amount !== "bigint" || o.amount === -9223372036854775808n)
      throw Error("Недопустимая сумма");
    total += abs(o.amount);
    if (total > 9223372036854775807n)
      throw Error("Слишком большая суммарная величина операций");
  }
}
export const normalizedPhone = (s: string): string | undefined => {
  s = s.trim();
  if (!/^\+?[78][0-9 ()-]*$/.test(s)) return;
  const n = s.replace(/\D/g, "");
  if (n.length === 11) return "7" + n.slice(1);
};
export const accountKey = (bank: string, account: string) =>
  `account|${bank}|${account}`;
export interface Party {
  id: string;
  label: string;
}
export function transferParty(o: Operation): Party | undefined {
  const t = normalize(o.details);
  if (
    t.includes("c2b") ||
    t.includes("операция по карте") ||
    t.startsWith("оплата в ") ||
    !["перевод", "перечислен", "пополнение"].some((s) => t.includes(s))
  )
    return;
  const from = t.match(/(?:со|с) счета\s*(\d{20})(?!\d)/)?.[1],
    to = t.match(/на счет\s*(\d{20})(?!\d)/)?.[1];
  if (from && to) {
    if ((o.amount < 0n ? from : to) !== o.account) return;
    const other = o.amount < 0n ? to : from;
    return {
      id: accountKey(o.bank, other),
      label: `${o.bank} · счёт ${other}`,
    };
  }
  const marker =
    o.amount < 0n
      ? "(?:по номеру телефона|на)\\s*"
      : "(?:по номеру телефона|от)\\s*";
  const number = t.match(
    new RegExp(
      marker +
        "(\\+?[78][\\s(-]*\\d{3}[\\s)-]*\\d{3}[\\s-]*\\d{2}[\\s-]*\\d{2})(?![\\d*])",
    ),
  )?.[1];
  const phone = number && normalizedPhone(number);
  if (phone) return { id: "phone|" + phone, label: "Телефон +" + phone };
}
export const ownPhoneIDs = (l: Ledger) =>
  Object.entries(l.transferOwners ?? {})
    .filter(
      ([k, v]) => v && k.startsWith("phone|") && normalizedPhone(k.slice(6)),
    )
    .map(([k]) => k)
    .sort();
export function namedInternalTransfer(
  details: string,
  owner: string,
  amount: bigint,
): Kind | undefined {
  const recipient = normalize(details).match(
    /внутрибанковский перевод между счетами,\s*(.+?)\.\s*со счета/,
  )?.[1];
  if (!owner || !recipient) return;
  const parts = (s: string) =>
      normalize(s)
        .split(/[^\p{L}]+/u)
        .filter(Boolean),
    a = parts(owner),
    b = parts(recipient);
  if (a.length !== 3 || b.length !== 3) return;
  if (a.join("|") === b.join("|")) return K.transfer;
  if (a[0] !== b[0] || a[1][0] !== b[1][0] || a[2][0] !== b[2][0])
    return amount < 0n ? K.outgoing : K.incoming;
}
export function cardPurchase(s: string) {
  const m = s
    .replace(/\s+/g, " ")
    .trim()
    .match(
      /^Операция по карте:\s*[0-9*Xx• -]+,\s*дата создания транзакции:\s*[0-9]{2}[-.][0-9]{2}[-.][0-9]{4},\s*место совершения операции:\s*(.+),\s*MCC:\s*([0-9]{4})\.?$/i,
    );
  return m ? { merchant: m[1].trim(), mcc: m[2] } : undefined;
}
export function sbpIdentity(s: string) {
  const m = normalize(s).match(
    /^(?:категория:\s*перевод по сбп\.\s*)?перевод (?:[cс][0-9]+ )?через систему быстрых платежей (от|на) (\+?[78][0-9 ()-]+)\.?\s*(?:без ндс\.?)?$/,
  );
  if (!m) return;
  const phone = normalizedPhone(m[2]);
  if (phone) return { party: m[1], phone };
}
export function salaryEmployer(s: string) {
  const t = normalize(s);
  for (const p of [
    /^пополнение\s*\.\s*зарплата\s*\.\s*(.+?)\s*\.?$/,
    /^пополнение\s*\.\s*(.+?)\s*\.\s*зарплата\s*\.?$/,
  ]) {
    const m = t.match(p);
    if (m) {
      const n = normalize(
        m[1].replace(/["«»“”„]/g, " ").replace(/\s*\.\s*/g, "."),
      );
      if (/\p{L}/u.test(n)) return n;
    }
  }
}
export function purchaseIdentity(s: string) {
  const c = cardPurchase(s),
    norm = (s: string) => normalize(s.replace(/[\p{Pd}_]+/gu, " "));
  if (c) return { name: norm(c.merchant), format: "card|" + c.mcc };
  const t = normalize(s);
  const purchase = t.match(/^оплата (?:в|товаров и услуг)\s+(.+)/u);
  if (purchase) return { name: norm(purchase[1]), format: "purchase" };
}
const keyCache = new Map<string, string>();
export function groupKey(s: string, debit: boolean): string {
  const prefix = debit ? "debit|" : "credit|",
    cache = prefix + s;
  const hit = keyCache.get(cache);
  if (hit) return hit;
  const salary = salaryEmployer(s),
    purchase = purchaseIdentity(s),
    sbp = sbpIdentity(s);
  const key =
    prefix +
    (salary
      ? "salary|" + salary
      : purchase
        ? purchase.format + "|" + purchase.name
        : sbp
          ? "sbp|" + sbp.party + "|" + sbp.phone
          : "text|" + normalize(s));
  if (keyCache.size >= 12000) keyCache.clear();
  keyCache.set(cache, key);
  return key;
}
export function groupLabel(s: string) {
  const salary = salaryEmployer(s),
    card = cardPurchase(s),
    sbp = sbpIdentity(s);
  return salary
    ? "Зарплата · " + salary.toUpperCase()
    : card
      ? card.merchant + " · MCC " + card.mcc
      : sbp
        ? "СБП · " + sbp.party + " +" + sbp.phone
        : s;
}
export const ruleKey = (r: Rule) => groupKey(r.description, r.debit);
export const ruleKeys = (r: Rule) =>
  new Set(
    [r.description, ...(r.alternateDescriptions ?? [])].flatMap((d) => [
      groupKey(d, r.debit),
      ...(r.matchMerchant && merchantKey(d, r.debit)
        ? [merchantKey(d, r.debit)!]
        : []),
    ]),
  );
export function merchantKey(
  details: string,
  debit: boolean,
): string | undefined {
  const purchase = purchaseIdentity(details);
  const name = purchase && normalizedMerchant(purchase.name);
  return name ? `${debit ? "debit" : "credit"}|merchant|${name}` : undefined;
}
function indexRules(rules: Rule[]) {
  const index = new Map<string, Rule[]>();
  for (const r of rules)
    for (const key of ruleKeys(r))
      index.set(key, [...(index.get(key) ?? []), r]);
  return index;
}
function indexedRule(
  index: Map<string, Rule[]>,
  o: Operation,
): Rule | undefined {
  const exact = index.get(groupKey(o.details, o.amount < 0n)) ?? [];
  if (exact.length) return resolveRule(exact, o);
  const key = merchantKey(o.details, o.amount < 0n);
  if (!key) return;
  const mcc = o.mcc ?? extractMCC(o.details);
  const candidates = (index.get(key) ?? []).filter((r) => {
    const descriptions = [
      r.description,
      ...(r.alternateDescriptions ?? []),
    ].filter((d) => merchantKey(d, r.debit) === key);
    const codes = descriptions.map(extractMCC).filter(Boolean);
    return (
      descriptions.length > 0 &&
      (r.ignoreMCC || !mcc || !codes.length || codes.includes(mcc))
    );
  });
  return resolveRule(candidates, o);
}
export function resolveRule(
  candidates: Rule[],
  o: Operation,
): Rule | undefined {
  const first = candidates[0];
  if (!first) return;
  if (
    candidates.every(
      (r) => r.category === first.category && r.kind === first.kind,
    )
  )
    return first;
  return candidates.find((r) =>
    [r.description, ...(r.alternateDescriptions ?? [])].some(
      (d) => normalize(d) === normalize(o.details),
    ),
  );
}
export const matchingRule = (l: Ledger, o: Operation) =>
  indexedRule(indexRules(l.descriptionRules ?? []), o);
export function similarNames(a: string, b: string) {
  const l = purchaseIdentity(a),
    r = purchaseIdentity(b);
  if (
    !l ||
    !r ||
    l.format !== r.format ||
    l.name === r.name ||
    l.name.replace(/\D/g, "") !== r.name.replace(/\D/g, "")
  )
    return false;
  const x = [...l.name],
    y = [...r.name],
    limit = Math.min(2, Math.floor(Math.min(x.length, y.length) / 8));
  if (
    !limit ||
    Math.max(x.length, y.length) > 200 ||
    Math.abs(x.length - y.length) > limit
  )
    return false;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 0; i < x.length; i++) {
    const row = [i + 1];
    for (let j = 0; j < y.length; j++)
      row.push(
        Math.min(
          row[j] + 1,
          prev[j + 1] + 1,
          prev[j] + (x[i] === y[j] ? 0 : 1),
        ),
      );
    if (Math.min(...row) > limit) return false;
    prev = row;
  }
  return prev[y.length] <= limit;
}
// Strong purpose phrases can identify a cash flow without knowing the recipient.
function purposeSuggestion(
  details: string,
  amount: bigint,
): Classification | undefined {
  const t = normalize(details);
  if (
    /^(?:оплата в|оплата услуг|оплата товаров и услуг|покупка в|операция по карте)/u.test(
      t,
    )
  )
    return;
  if (/(?:другому человеку|другого клиента|чужой счет)/u.test(t)) return;
  if (
    amount > 0n &&
    /(?:зарплата|заработная плата|к[эе]шб[эе]к|(?:начисление|выплата|зачисление) процентов|проценты (?:на остаток|по вкладу|по счету))/u.test(
      t,
    )
  )
    return { kind: K.income, category: "Доходы" };
  const savings =
    /(?:инвесткопилк|копилк[аи] для сдачи|накопительн[а-я]* счет|брокерск[а-я]* счет|вклад(?:у|а|ом|е)?(?:\s|$|[.,№])|депозит)/u.test(
      t,
    );
  if (
    amount < 0n &&
    (/сберегательный взнос/u.test(t) ||
      /^(?:kopilka|копилка)\s+karta-vklad(?:[ .]|$)/u.test(t) ||
      (savings && /(?:пополнени|взнос|перевод (?:на|для))/u.test(t)))
  )
    return { kind: K.savings, category: "Переводы" };
  if (
    amount > 0n &&
    ((savings && /(?:вывод|снятие|закрытие|возврат|перевод с )/u.test(t)) ||
      /^(?:sberbank onl@in )?vklad-karta(?:[ .]|$)/u.test(t))
  )
    return { kind: K.transfer, category: "Переводы" };
  if (
    /(?:между своими|между собственными|между счетами одного клиента|на свой счет|перевод себе|перенос денежных средств с эдс на банковский счет)/u.test(
      t,
    )
  )
    return { kind: K.transfer, category: "Переводы" };
  if (
    amount > 0n &&
    /(?:возврат покупки|возврат средств (?:за|по оплате|сбп qr)|отмена покупки|возврат оплаты|отмена операции оплаты)/u.test(
      t,
    )
  )
    return { kind: K.refund, category: "Возвраты" };
  if (
    amount < 0n &&
    /^(?:комиссия|плата за обслуживание (?:карты|счета))/u.test(t)
  )
    return { kind: K.expense, category: "Комиссии" };
}
export function suggest(
  details: string,
  amount: bigint,
  bankCategory = "",
): Classification {
  const purpose = purposeSuggestion(details, amount);
  if (purpose && purpose.kind !== K.refund && purpose.kind !== K.expense)
    return purpose;
  const t = normalize(details);
  if (
    !purpose &&
    !/(?:c2b|операция по карте)/u.test(t) &&
    !t.startsWith("оплата в ") &&
    /(?:перевод|снятие наличных|пополнение|погашение кредит|сберегательный взнос|возврат долга)/u.test(
      t,
    )
  )
    return { kind: K.review, category: "Без категории" };
  if (!purpose && amount >= 0n)
    return { kind: K.review, category: "Без категории" };
  const mcc = extractMCC(details);
  return {
    kind: purpose?.kind ?? K.expense,
    category:
      bankCategoryName(bankCategory) ||
      (mcc && mccDefaults[mcc]) ||
      merchantCategory(details) ||
      purpose?.category ||
      "Без категории",
  };
}
export function reclassify(l: Ledger): void {
  normalizeCategories(l);
  classifyOperations(l);
  normalizeCategories(l);
}
function classifyOperations(l: Ledger): void {
  for (const o of l.operations) {
    const b = o.phoneRuleBase;
    if (!b) continue;
    if (!o.manualCategory) o.category = b.category;
    if (!o.manualKind) {
      o.kind = b.kind;
      o.transferReason = b.transferReason;
    }
    delete o.phoneRuleBase;
  }
  const previous = new Map(
    l.operations.filter((o) => o.ruleBase).map((o) => [o.id, o.ruleBase!]),
  );
  for (const o of l.operations) {
    const b = o.ruleBase;
    if (!b) continue;
    if (!o.manualCategory) o.category = b.category;
    if (!o.manualKind) {
      o.kind = b.kind;
      o.transferReason = b.transferReason;
    }
    delete o.ruleBase;
  }
  for (const o of l.operations) {
    if (o.autoCategoryBase !== undefined && !o.manualCategory)
      o.category = o.autoCategoryBase;
    delete o.autoCategoryBase;
    delete o.categoryReason;
    if ((l.classificationVersion ?? 1) < 2) continue;
    const originalCategory = o.category;
    if ((l.classificationVersion ?? 1) >= 3 && o.kind !== K.pending) {
      const purpose = purposeSuggestion(o.details, o.amount);
      if (purpose && !o.manualKind) {
        o.kind = purpose.kind;
        delete o.transferReason;
      }
      if (!o.manualCategory) {
        const merchant =
          (o.kind === K.expense || o.kind === K.refund) &&
          merchantCategory(o.details);
        const category =
          merchant || (purpose?.kind === o.kind && purpose.category);
        if (category) {
          o.autoCategoryBase = originalCategory;
          o.category = category;
          o.categoryReason = merchant
            ? "Услуга или продавец в описании"
            : "Назначение операции в описании";
        }
      }
    }
    o.mcc ??= extractMCC(o.details);
    if (
      o.manualCategory ||
      (o.kind !== K.expense && o.kind !== K.refund) ||
      o.amount === 0n
    )
      continue;
    const custom = o.mcc && l.mccCategories?.[o.mcc];
    const bank = bankCategoryName(o.bankCategory);
    const category = custom || bank || (o.mcc && mccDefaults[o.mcc]);
    if (!category) continue;
    o.autoCategoryBase = originalCategory;
    o.category = category;
    o.categoryReason = custom
      ? `Твоё правило MCC ${o.mcc}`
      : bank
        ? `Категория банка: ${o.bankCategory}`
        : `MCC ${o.mcc}`;
  }
  const accounts = new Set(
    l.operations.map((o) => accountKey(o.bank, o.account)),
  );
  for (const o of l.operations) {
    if (o.manualKind || !(o.kind === K.review || o.transferReason)) continue;
    let kind: Kind = K.review,
      reason: string | undefined;
    const party = transferParty(o);
    if (party && l.transferOwners?.[party.id] !== undefined) {
      const own = l.transferOwners[party.id];
      kind = own ? K.transfer : o.amount < 0n ? K.outgoing : K.incoming;
      reason = own
        ? "Ты отметил эти реквизиты как свои"
        : "Ты отметил эти реквизиты как чужие";
    } else if (party && accounts.has(party.id)) {
      kind = K.transfer;
      reason = "Оба счёта встречаются в твоих выписках";
    } else if (normalize(o.details).includes("перевод другому клиенту")) {
      kind = o.amount < 0n ? K.outgoing : K.incoming;
      reason = "Банк указал перевод другому клиенту";
    }
    o.kind = kind;
    o.transferReason = reason;
    if (
      !o.manualCategory &&
      ["Без категории", "Переводы", "Переводы людям"].includes(o.category)
    )
      o.category =
        kind === K.review
          ? "Без категории"
          : kind === K.transfer
            ? "Переводы"
            : "Переводы людям";
  }
  const index = indexRules(l.descriptionRules ?? []);
  for (const o of l.operations) {
    if (o.kind === K.pending) continue;
    const r = indexedRule(index, o);
    if (!r) continue;
    const b = previous.get(o.id);
    o.ruleBase = {
      category: o.manualCategory ? (b?.category ?? o.category) : o.category,
      kind: o.manualKind ? (b?.kind ?? o.kind) : o.kind,
      transferReason: o.manualKind
        ? (b?.transferReason ?? o.transferReason)
        : o.transferReason,
    };
    if (!o.manualCategory) o.category = r.category;
    if (!o.manualKind) {
      o.kind = r.kind;
      delete o.transferReason;
    }
  }
  if (!l.otherPhonesArePeople || !ownPhoneIDs(l).length) return;
  for (const o of l.operations) {
    if (
      o.manualKind ||
      !(
        [
          K.review,
          K.transfer,
          K.outgoing,
          K.incoming,
          K.expense,
          K.income,
        ] as Kind[]
      ).includes(o.kind)
    )
      continue;
    const p = transferParty(o);
    if (!p?.id.startsWith("phone|")) continue;
    o.phoneRuleBase = {
      category: o.category,
      kind: o.kind,
      transferReason: o.transferReason,
    };
    const own = l.transferOwners?.[p.id] === true;
    o.kind = own ? K.transfer : o.amount < 0n ? K.outgoing : K.incoming;
    o.transferReason = own
      ? "Номер указан как твой"
      : "Включено правило: остальные номера принадлежат другим людям";
    if (
      !o.manualCategory &&
      [
        "Без категории",
        "Переводы",
        "Переводы людям",
        "Переводы от людей",
        "Доходы",
      ].includes(o.category)
    )
      o.category = own
        ? "Переводы"
        : o.amount < 0n
          ? "Переводы людям"
          : "Переводы от людей";
  }
}
export function migrate(l: Ledger) {
  if (l.classificationVersion === undefined) {
    for (const o of l.operations)
      if (o.category && o.category !== "Без категории") o.manualCategory = true;
    l.classificationVersion = 1;
  }
  const groups = new Map<string, Rule[]>();
  for (const r of l.descriptionRules ?? []) {
    const key = ruleKey(r);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const seen = new Set<string>();
  l.descriptionRules = (l.descriptionRules ?? []).flatMap((r) => {
    const key = ruleKey(r),
      same = groups.get(key)!;
    if (
      !same.every(
        (s) =>
          s.category === r.category &&
          s.kind === r.kind &&
          Boolean(s.ignoreMCC) === Boolean(r.ignoreMCC),
      )
    )
      return [r];
    if (seen.has(key)) return [];
    seen.add(key);
    const alternatives = [
      ...new Set(same.flatMap((s) => s.alternateDescriptions ?? [])),
    ].sort();
    return [
      {
        ...r,
        ...(alternatives.length ? { alternateDescriptions: alternatives } : {}),
      },
    ];
  });
  reclassify(l);
  return l;
}
export function applyAutomaticClassification(l: Ledger) {
  const rules = l.descriptionRules ?? [];
  const merchants = new Map<string, Rule[]>();
  const keys = (r: Rule) => [
    ...new Set(
      [r.description, ...(r.alternateDescriptions ?? [])]
        .map((d) => merchantKey(d, r.debit))
        .filter((k): k is string => Boolean(k)),
    ),
  ];
  for (const r of rules)
    for (const k of keys(r)) merchants.set(k, [...(merchants.get(k) ?? []), r]);
  for (const r of rules) {
    if (
      r.matchMerchant === false ||
      (r.kind !== K.expense && r.kind !== K.refund)
    )
      continue;
    const descriptions = [r.description, ...(r.alternateDescriptions ?? [])];
    if (!descriptions.every((d) => merchantKey(d, r.debit))) continue;
    if (
      keys(r).every((k) =>
        merchants
          .get(k)!
          .every(
            (other) => other.category === r.category && other.kind === r.kind,
          ),
      )
    )
      r.matchMerchant = true;
  }
  // Merge only connected, agreeing merchant presets; keep every original description as an alias.
  const parent = new Map(rules.map((r) => [r.id, r.id]));
  const root = (id: string): string => {
    while (parent.get(id) !== id) id = parent.get(id)!;
    return id;
  };
  for (const members of merchants.values()) {
    if (
      !members.every(
        (r) =>
          r.matchMerchant &&
          Boolean(r.ignoreMCC) === Boolean(members[0].ignoreMCC) &&
          r.category === members[0].category &&
          r.kind === members[0].kind,
      )
    )
      continue;
    for (const r of members.slice(1))
      parent.set(root(r.id), root(members[0].id));
  }
  const merged = new Map<string, Rule>();
  for (const r of rules) {
    const id = root(r.id),
      previous = merged.get(id);
    if (previous)
      previous.alternateDescriptions = [
        ...new Set([
          ...(previous.alternateDescriptions ?? []),
          r.description,
          ...(r.alternateDescriptions ?? []),
        ]),
      ].filter((d) => d !== previous.description);
    else merged.set(id, r);
  }
  l.descriptionRules = [...merged.values()];
  l.classificationVersion = Math.max(l.classificationVersion ?? 1, 3);
  reclassify(l);
}
export function automaticPreview(l: Ledger) {
  const next = structuredClone(l);
  applyAutomaticClassification(next);
  const before = new Map(l.operations.map((o) => [o.id, o]));
  const changes = next.operations
    .filter((o) => {
      const old = before.get(o.id)!;
      return old.category !== o.category || old.kind !== o.kind;
    })
    .map((o) => ({ before: before.get(o.id)!, after: o }));
  return {
    next,
    changes,
    reviewBefore: l.operations.filter(needsReview).length,
    reviewAfter: next.operations.filter(needsReview).length,
    rulesBefore: l.descriptionRules?.length ?? 0,
    rulesAfter: next.descriptionRules?.length ?? 0,
    merchantRules:
      next.descriptionRules?.filter((r) => r.matchMerchant).length ?? 0,
    mccOperations: next.operations.filter((o) => o.mcc).length,
  };
}
export function categoryExplanation(l: Ledger, o: Operation): string {
  if (o.manualCategory) return "Твоё исправление этой операции";
  const rule = matchingRule(l, o);
  if (rule && o.category === rule.category)
    return rule.matchMerchant ? "Пресет продавца" : "Пресет описания";
  return (
    o.categoryReason ??
    (o.category === "Без категории"
      ? "Недостаточно данных для категории"
      : "Распознано при импорте")
  );
}
export function setMCCCategory(l: Ledger, code: string, category: string) {
  if (!/^\d{4}$/.test(code)) throw Error("MCC должен содержать четыре цифры");
  l.mccCategories ??= {};
  if (category.trim()) l.mccCategories[code] = category.trim();
  else delete l.mccCategories[code];
  l.classificationVersion = Math.max(l.classificationVersion ?? 1, 2);
  reclassify(l);
}
export function setRule(l: Ledger, proposed: Rule, replaceManual = false) {
  const r = structuredClone(proposed);
  r.description = r.description.trim();
  r.category = r.category.trim();
  if (!r.description || !r.category || r.kind === K.pending)
    throw Error("Заполни описание и категорию; ожидание задаётся банком");
  let rules = l.descriptionRules ?? [];
  const key = ruleKey(r),
    same = rules.filter((s) => ruleKey(s) === key),
    conflict = same.length > 1 && same.some((s) => s.id === r.id);
  const seen = new Set([key]);
  r.alternateDescriptions = [
    ...(r.alternateDescriptions ?? []),
    ...(conflict ? same.flatMap((s) => s.alternateDescriptions ?? []) : []),
  ]
    .map((s) => s.trim())
    .filter((s) => {
      const k = groupKey(s, r.debit);
      if (!s || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const keys = ruleKeys(r);
  if (
    rules.some(
      (s) =>
        s.id !== r.id &&
        !(conflict && ruleKey(s) === key) &&
        [...ruleKeys(s)].some((k) => keys.has(k)),
    )
  )
    throw Error("Для одного из описаний уже есть правило. Объедини группы.");
  if (conflict)
    rules = rules.filter((s) => ruleKey(s) !== key || s.id === r.id);
  l.descriptionRules = rules.some((s) => s.id === r.id)
    ? rules.map((s) => (s.id === r.id ? r : s))
    : [...rules, r];
  if (r.ignoreMCC !== undefined) l.version = 2;
  if (replaceManual) {
    const index = indexRules([r]);
    for (const o of l.operations)
      if (o.kind !== K.pending && indexedRule(index, o)) {
        o.manualCategory = false;
        o.manualKind = false;
      }
  }
  reclassify(l);
}
export interface DescriptionGroup {
  id: string;
  description: string;
  debit: boolean;
  operations: Operation[];
}
export function descriptionGroups(l: Ledger): DescriptionGroup[] {
  const index = indexRules(l.descriptionRules ?? []);
  const groups = new Map<string, DescriptionGroup>();
  for (const o of l.operations) {
    const key = groupKey(o.details, o.amount < 0n),
      rule = indexedRule(index, o),
      id = rule ? ruleKey(rule) : key;
    let g = groups.get(id);
    if (!g) {
      g = { id, description: o.details, debit: o.amount < 0n, operations: [] };
      groups.set(id, g);
    }
    g.operations.push(o);
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.operations.length - a.operations.length || a.id.localeCompare(b.id),
  );
}
export function preset(l: Ledger, g: DescriptionGroup): Rule {
  return (
    l.descriptionRules?.find((r) => ruleKey(r) === g.id) ?? {
      id: uuid(),
      description: g.description,
      debit: g.debit,
      category: g.operations[0].category,
      matchMerchant: Boolean(merchantKey(g.description, g.debit)),
      kind:
        g.operations[0].kind === K.pending
          ? g.debit
            ? K.expense
            : K.income
          : g.operations[0].kind,
    }
  );
}
export function mergeGroups(l: Ledger, source: string, target: string) {
  const groups = descriptionGroups(l),
    s = groups.find((g) => g.id === source),
    t = groups.find((g) => g.id === target);
  if (!s || !t || s.id === t.id || s.debit !== t.debit)
    throw Error("Выбери две группы одного направления");
  const rules = l.descriptionRules ?? [],
    replaced = rules.filter((r) => [source, target].includes(ruleKey(r))),
    r = structuredClone(preset(l, t));
  r.alternateDescriptions = [
    ...replaced.flatMap((r) => [
      r.description,
      ...(r.alternateDescriptions ?? []),
    ]),
    s.description,
    t.description,
  ];
  l.descriptionRules = rules.filter(
    (r) => ![source, target].includes(ruleKey(r)),
  );
  setRule(l, r);
}
export function editOperation(
  l: Ledger,
  id: string,
  changes: Partial<Operation>,
) {
  const o = l.operations.find((o) => o.id === id);
  if (!o) throw Error("Операция не найдена");
  if (changes.category !== undefined) {
    const c = categoryName(l, changes.category.trim() || uncategorized);
    if (c !== o.category) {
      o.category = c;
      o.manualCategory = true;
    }
  }
  if (changes.kind !== undefined && changes.kind !== o.kind) {
    o.kind = changes.kind;
    o.manualKind = true;
    delete o.transferReason;
  }
  if (changes.possibleDuplicate !== undefined)
    o.possibleDuplicate = changes.possibleDuplicate;
}
export function setOwner(l: Ledger, id: string, own: boolean | undefined) {
  l.transferOwners ??= {};
  if (own === undefined) delete l.transferOwners[id];
  else l.transferOwners[id] = own;
  if (!ownPhoneIDs(l).length) l.otherPhonesArePeople = false;
  reclassify(l);
}
export function setOwnPhone(l: Ledger, s: string) {
  const phone = normalizedPhone(s);
  if (!phone) throw Error("Введи полный номер из 11 цифр, начиная с +7 или 8");
  l.transferOwners ??= {};
  l.transferOwners["phone|" + phone] = true;
  l.otherPhonesArePeople = true;
  reclassify(l);
}
export function setName(l: Ledger, id: string, name: string) {
  if (!id.startsWith("phone|") || normalizedPhone(id.slice(6)) !== id.slice(6))
    throw Error("Имя можно назначить только полному номеру");
  l.phoneNames ??= {};
  name = name.replace(/\s+/g, " ").trim();
  if (name) l.phoneNames[id] = name;
  else delete l.phoneNames[id];
}
export const fingerprint = (o: Operation) =>
  [
    o.bank,
    o.account,
    o.date,
    String(o.amount),
    o.currency,
    o.details.toLowerCase(),
  ].join("\u001f");
export function append(
  l: Ledger,
  result: Parsed,
  filename: string,
  digest: string,
) {
  if (l.imports.some((i) => i.digest === digest))
    throw Error("Этот файл уже загружен: " + filename);
  const old = new Set(l.operations.map(fingerprint)),
    ids = new Map<string, Operation>();
  const key = (o: Operation) => [o.bank, o.account, o.bankID].join("|");
  for (const o of l.operations)
    if (o.bankID && !ids.has(key(o))) ids.set(key(o), o);
  const added: Operation[] = [];
  let duplicates = 0;
  for (const o of result.operations) {
    const prev = o.bankID && ids.get(key(o));
    if (prev) {
      if (
        prev.amount !== o.amount ||
        prev.currency !== o.currency ||
        prev.date !== o.date
      )
        throw Error("Операция с тем же банковским кодом изменилась");
      duplicates++;
    } else {
      added.push({ ...o, possibleDuplicate: old.has(fingerprint(o)) });
      if (o.bankID) ids.set(key(o), o);
    }
  }
  validateAmounts([...l.operations, ...added]);
  l.operations.push(...added);
  reclassify(l);
  l.imports.push({
    id: uuid(),
    filename,
    digest,
    importedAt: Date.now() / 1000 - 978307200,
    count: added.length,
    warnings: [
      ...result.warnings,
      ...(duplicates
        ? [
            `Уже были загружены по банковскому коду: ${duplicates}. Повторно не добавлены.`,
          ]
        : []),
    ],
  });
}
export function reset(l: Ledger): Ledger {
  return {
    ...emptyLedger(),
    version: l.version,
    descriptionRules: l.descriptionRules,
    mccCategories: l.mccCategories,
    categoryRules: l.categoryRules,
    classificationVersion: l.classificationVersion,
    phoneNames: l.phoneNames,
    otherPhonesArePeople: l.otherPhonesArePeople,
    transferOwners: Object.fromEntries(ownPhoneIDs(l).map((id) => [id, true])),
  };
}
export interface Contact {
  id: string;
  name: string;
  phoneIDs: string[];
}
export function contacts(l: Ledger): Contact[] {
  const phones = new Set(
    [
      ...l.operations.flatMap((o) => {
        const p = transferParty(o);
        return p ? [p.id] : [];
      }),
      ...Object.keys(l.phoneNames ?? {}),
      ...ownPhoneIDs(l),
    ].filter((id) => id.startsWith("phone|") && normalizedPhone(id.slice(6))),
  );
  const groups = new Map<string, string[]>();
  for (const p of phones) {
    const name = normalize(l.phoneNames?.[p] ?? ""),
      id = name ? "name|" + name : p;
    const group = groups.get(id) ?? [];
    group.push(p);
    groups.set(id, group);
  }
  return [...groups.entries()]
    .map(([id, phoneIDs]) => {
      phoneIDs.sort();
      return {
        id,
        phoneIDs,
        name: l.phoneNames?.[phoneIDs[0]] || "+" + phoneIDs[0].slice(6),
      };
    })
    .sort(
      (a, b) =>
        Number(b.id.startsWith("name|")) - Number(a.id.startsWith("name|")) ||
        a.name.localeCompare(b.name, "ru", { numeric: true }),
    );
}
export function transferIndex(ops: Operation[]) {
  const result = new Map<string, Operation[]>();
  for (const o of ops) {
    if ([K.pending, K.excluded].includes(o.kind as any) || o.amount === 0n)
      continue;
    const p = transferParty(o);
    if (p?.id.startsWith("phone|")) {
      const group = result.get(p.id) ?? [];
      group.push(o);
      result.set(p.id, group);
    }
  }
  return result;
}
export function ownerRows(l: Ledger) {
  const accounts = new Set(
      l.operations.map((o) => accountKey(o.bank, o.account)),
    ),
    rows = new Map<string, Party & { count: number; hasStatement: boolean }>();
  for (const o of l.operations) {
    const p = transferParty(o);
    if (p) {
      const row = rows.get(p.id) ?? {
        ...p,
        count: 0,
        hasStatement: accounts.has(p.id),
      };
      row.count++;
      rows.set(p.id, row);
    }
  }
  for (const id of [...ownPhoneIDs(l), ...Object.keys(l.phoneNames ?? {})])
    if (!rows.has(id))
      rows.set(id, {
        id,
        label: "Телефон +" + id.slice(6),
        count: 0,
        hasStatement: false,
      });
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
}
export function recipient(l: Ledger, o: Operation) {
  const p = o.amount < 0n && transferParty(o),
    name = p && l.phoneNames?.[p.id];
  return p && name ? `Кому: ${name.trim()} · +${p.id.slice(6)}` : undefined;
}
export function incomeSource(o: Operation, names: Record<string, string> = {}) {
  const p = o.amount > 0n ? transferParty(o) : undefined;
  if (p?.id?.startsWith("phone|") && names[p.id]?.trim())
    return "Переводы · " + names[p.id].trim();
  if (sbpIdentity(o.details)) return groupLabel(o.details);
  if (
    !["Доходы", "Переводы", "Переводы людям", "Без категории", ""].includes(
      o.category,
    )
  )
    return o.category;
  const t = normalize(o.details);
  if (/^перевод (?:с|со) договора\s+№?\s*\d+\.?$/.test(t))
    return "Переводы с договоров";
  if (/^(?:начисление\s+)?к[еэ]шб[еэ]к(?:а)?(?:\s|[.:]|$)/.test(t))
    return "Кэшбэк";
  return groupLabel(o.details);
}
export type Measure = "expenses" | "income" | "savings";
export const amountOf = (o: Operation, m: Measure) =>
  m === "expenses"
    ? expenseAmount(o)
    : m === "income"
      ? incomeAmount(o)
      : savingsAmount(o);
export interface Group {
  label: string;
  amount: bigint;
}
export function breakdown(
  ops: Operation[],
  measure: Measure,
  names: Record<string, string> = {},
): Group[] {
  const sums = new Map<string, Group>();
  for (const o of ops) {
    const amount = amountOf(o, measure);
    if (amount === 0n) continue;
    const label = measure === "income" ? incomeSource(o, names) : o.category,
      key = measure === "income" ? normalize(label) : label;
    const row = sums.get(key) ?? { label, amount: 0n };
    row.amount += amount;
    sums.set(key, row);
  }
  return [...sums.values()].sort((a, b) =>
    a.amount === b.amount
      ? a.label.localeCompare(b.label)
      : a.amount > b.amount
        ? -1
        : 1,
  );
}
export function cashFlow(ops: Operation[], byMonth = false, category = "") {
  const periods = new Map<
    string,
    { period: string; expenses: bigint; income: bigint; savings: bigint }
  >();
  for (const o of ops) {
    if (
      !byMonth &&
      expenseAmount(o) === 0n &&
      incomeAmount(o) === 0n &&
      savingsAmount(o) === 0n
    )
      continue;
    const p = byMonth ? o.date.slice(0, 7) : o.date,
      row = periods.get(p) ?? {
        period: p,
        expenses: 0n,
        income: 0n,
        savings: 0n,
      };
    row.expenses +=
      !category || o.category === category ? expenseAmount(o) : 0n;
    row.income += incomeAmount(o);
    row.savings += savingsAmount(o);
    periods.set(p, row);
  }
  return [...periods.values()].sort((a, b) => a.period.localeCompare(b.period));
}
export const merchantName = (o: Operation) => {
  const tail = o.details.split(/место совершения операции:/i)[1];
  return tail
    ? tail.split(", MCC:")[0].trim()
    : o.details.startsWith("Оплата в ")
      ? o.details.slice(9)
      : o.details;
};
