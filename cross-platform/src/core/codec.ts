import JSONBig from "json-bigint";
import {
  kinds,
  operationDate,
  validateAmounts,
  categorySettings,
  uncategorized,
  type Ledger,
  type Operation,
  type Classification,
  type Settings,
} from "./model";
const json = JSONBig({
  useNativeBigInt: false,
  strict: true,
  protoAction: "error",
  constructorAction: "error",
});
// Swift timestamps have long fractional parts; only money must remain an exact integer.
export const parseJSON = (source: string): any =>
  json.parse(source, (key, value) => {
    if (
      value &&
      typeof value.isInteger === "function" &&
      typeof value.toFixed === "function"
    ) {
      if (value.isInteger()) return BigInt(value.toFixed(0));
      if (key === "importedAt") return value.toNumber();
    }
    return value;
  });
export const encodeLedger = (ledger: Ledger): string => json.stringify(ledger);
function object(v: unknown): asserts v is Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Повреждённая структура базы");
}
function text(v: unknown): asserts v is string {
  if (typeof v !== "string" || v.length > 1000000)
    throw Error("Некорректное текстовое поле базы");
}
function classification(
  v: unknown,
): asserts v is Classification & Record<string, any> {
  object(v);
  text(v.category);
  if (!kinds.includes(v.kind)) throw Error("Неизвестный тип операции");
  if (v.transferReason != null) text(v.transferReason);
}
export function decodeLedger(source: string): Ledger {
  if (source.length > 256 * 1024 * 1024) throw Error("База больше 256 МБ");
  const l = parseJSON(source);
  object(l);
  if (l.format === "finance-computer-settings")
    throw Error(
      "Это файл настроек. Открой раздел «Импорт» и выбери «Импортировать настройки».",
    );
  if (
    ![1, 2].includes(l.version) ||
    !Array.isArray(l.operations) ||
    !Array.isArray(l.imports)
  )
    throw Error("Неизвестная версия или структура базы");
  const ids = new Set<string>();
  for (const o of l.operations) {
    classification(o);
    const row = o as Operation;
    for (const key of [
      "id",
      "date",
      "bank",
      "account",
      "details",
      "currency",
      "source",
      "sourceRow",
    ] as const)
      text(row[key]);
    if (ids.has(row.id)) throw Error("Повтор идентификатора операции");
    ids.add(row.id);
    operationDate(row.date);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !/^[A-Z]{3}$/.test(row.currency)
    )
      throw Error("Некорректные дата или валюта");
    const a = row.amount as unknown;
    if (typeof a === "bigint") row.amount = a;
    else if (typeof a === "number" && Number.isSafeInteger(a))
      row.amount = BigInt(a);
    else throw Error("Неточная или некорректная сумма");
    row.bankID ??= "";
    text(row.bankID);
    row.possibleDuplicate ??= false;
    for (const k of [
      "possibleDuplicate",
      "manualCategory",
      "manualKind",
    ] as const)
      if (row[k] != null && typeof row[k] !== "boolean")
        throw Error("Некорректный признак операции");
    for (const k of ["ruleBase", "phoneRuleBase"] as const)
      if (row[k] != null) classification(row[k]);
    for (const k of [
      "mcc",
      "bankCategory",
      "autoCategoryBase",
      "categoryReason",
    ] as const)
      if (row[k] != null) text(row[k]);
    if (row.mcc != null && !/^\d{4}$/.test(row.mcc))
      throw Error("Некорректный MCC операции");
  }
  validateAmounts(l.operations);
  if (
    l.classificationVersion != null &&
    ![1, 2, 3].includes(l.classificationVersion)
  )
    throw Error("Неизвестная версия правил");
  validateSettings(l);
  for (const i of l.imports) {
    object(i);
    for (const key of ["id", "filename", "digest"]) text(i[key]);
    if (
      typeof i.importedAt !== "number" ||
      !Number.isFinite(i.importedAt) ||
      !Number.isInteger(i.count) ||
      i.count < 0 ||
      !Array.isArray(i.warnings)
    )
      throw Error("Некорректная история импорта");
    i.warnings.forEach(text);
  }
  return l as unknown as Ledger;
}

function validateSettings(l: Record<string, any>) {
  if (l.categoryRules != null) {
    object(l.categoryRules);
    for (const [name, target] of Object.entries(l.categoryRules)) {
      text(target);
      if (
        !name.trim() ||
        name !== name.trim() ||
        !target.trim() ||
        target !== target.trim() ||
        (name === uncategorized && target !== uncategorized)
      )
        throw Error("Некорректное правило категории");
    }
    categorySettings(l);
  }
  if (l.mccCategories != null) {
    object(l.mccCategories);
    for (const [code, category] of Object.entries(l.mccCategories)) {
      text(category);
      if (!/^\d{4}$/.test(code) || !category.trim())
        throw Error("Некорректное правило MCC");
    }
  }
  if (
    l.otherPhonesArePeople != null &&
    typeof l.otherPhonesArePeople !== "boolean"
  )
    throw Error("Некорректная настройка телефонов");
  for (const key of ["phoneNames", "transferOwners"] as const)
    if (l[key] != null) {
      object(l[key]);
      for (const [id, value] of Object.entries(l[key])) {
        text(id);
        if (key === "phoneNames") text(value);
        else if (typeof value !== "boolean")
          throw Error("Некорректное правило реквизитов");
      }
    }
  if (l.descriptionRules != null) {
    if (!Array.isArray(l.descriptionRules)) throw Error("Некорректный пресет");
    const ruleIDs = new Set();
    for (const r of l.descriptionRules) {
      classification(r);
      text(r.id);
      text(r.description);
      if (r.matchMerchant != null && typeof r.matchMerchant !== "boolean")
        throw Error("Некорректное правило продавца");
      if (r.ignoreMCC != null && typeof r.ignoreMCC !== "boolean")
        throw Error("Некорректная настройка MCC продавца");
      if (ruleIDs.has(r.id) || typeof r.debit !== "boolean")
        throw Error("Некорректное правило");
      ruleIDs.add(r.id);
      if (r.alternateDescriptions != null) {
        if (!Array.isArray(r.alternateDescriptions))
          throw Error("Некорректные варианты группы");
        r.alternateDescriptions.forEach(text);
      }
    }
  }
}

export function settingsOf(l: Pick<Ledger, keyof Settings>): Settings {
  return {
    descriptionRules: (l.descriptionRules ?? []).map((r) => ({
      id: r.id,
      description: r.description,
      debit: r.debit,
      category: r.category,
      kind: r.kind,
      ...(r.matchMerchant !== undefined
        ? { matchMerchant: r.matchMerchant }
        : {}),
      ...(r.ignoreMCC !== undefined ? { ignoreMCC: r.ignoreMCC } : {}),
      ...(r.alternateDescriptions
        ? { alternateDescriptions: [...r.alternateDescriptions] }
        : {}),
    })),
    phoneNames: { ...l.phoneNames },
    transferOwners: { ...l.transferOwners },
    otherPhonesArePeople: l.otherPhonesArePeople ?? false,
    mccCategories: { ...l.mccCategories },
    categoryRules: categorySettings(l),
  };
}
export function encodeSettings(l: Ledger): string {
  return json.stringify(
    { format: "finance-computer-settings", version: 3, ...settingsOf(l) },
    null,
    2,
  );
}
export function decodeSettings(source: string): Settings {
  if (source.length > 256 * 1024 * 1024) throw Error("Файл больше 256 МБ");
  const data = parseJSON(source);
  object(data);
  let settings: Settings;
  if (data.format === "finance-computer-settings") {
    if (![1, 2, 3].includes(data.version))
      throw Error("Неизвестная версия настроек");
    if (
      !Array.isArray(data.descriptionRules) ||
      typeof data.otherPhonesArePeople !== "boolean"
    )
      throw Error("Неполный файл настроек");
    object(data.phoneNames);
    object(data.transferOwners);
    validateSettings(data);
    settings = settingsOf(data);
  } else if (
    data.format === undefined &&
    [1, 2].includes(data.version) &&
    Array.isArray(data.operations)
  ) {
    settings = settingsOf(decodeLedger(source));
  } else
    throw Error("Выбери файл настроек или полную резервную копию приложения");
  for (const r of settings.descriptionRules) {
    if (
      !r.id.trim() ||
      !r.description.trim() ||
      !r.category.trim() ||
      r.kind === "Ожидает подтверждения"
    )
      throw Error("В пресете есть незаполненное или недопустимое правило");
  }
  for (const [id, name] of Object.entries(settings.phoneNames))
    if (!/^phone\|7\d{10}$/.test(id) || !name.trim())
      throw Error("Некорректное имя или номер телефона");
  for (const id of Object.keys(settings.transferOwners))
    if (!/^phone\|7\d{10}$/.test(id) && !/^account\|[^|]+\|[^|]+$/.test(id))
      throw Error("Некорректные реквизиты в настройках");
  return settings;
}
