import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as M from "../src/core/model";
import { decodeLedger, settingsOf } from "../src/core/codec";
import { applySettings } from "../src/core/settings";

const [currentPath, referencePath, ...flags] = process.argv.slice(2);
if (!currentPath || !referencePath)
  throw Error("Укажи текущую базу и копию с ручным разбором");
const sources = [currentPath, referencePath].map((p) => readFileSync(p));
const [current, reference] = sources.map((s) =>
  decodeLedger(s.toString("utf8")),
);
const key = (o: M.Operation) =>
  JSON.stringify([
    o.date,
    o.bank,
    o.account,
    o.details,
    String(o.amount),
    o.currency,
  ]);
const index = new Map<string, M.Operation[]>();
for (const o of reference.operations)
  index.set(key(o), [...(index.get(key(o)) ?? []), o]);
const counts = (ops: M.Operation[]) => {
  const result = new Map<string, number>();
  for (const o of ops) result.set(key(o), (result.get(key(o)) ?? 0) + 1);
  return result;
};
assert.deepEqual(
  counts(current.operations),
  counts(reference.operations),
  "Наборы исходных операций различаются",
);
for (const ops of index.values())
  assert(
    ops.every((o) => o.category === ops[0].category && o.kind === ops[0].kind),
    "Неоднозначный ручной разбор одинаковых операций",
  );
const expected = (o: M.Operation) => index.get(key(o))![0];
const label = (o: M.Operation) =>
  M.groupLabel(o.details)
    .replace(/№\s*[\d/.-]+/gu, "№ [номер]")
    .replace(/\+?\d[\d ()-]{7,}\d/g, "[номер]");
function score(l: M.Ledger) {
  let categoryMatches = 0,
    kindMatches = 0,
    bothMatch = 0,
    classifiedAndMatching = 0;
  for (const o of l.operations) {
    const ref = expected(o);
    categoryMatches += Number(o.category === ref.category);
    kindMatches += Number(o.kind === ref.kind);
    bothMatch += Number(o.category === ref.category && o.kind === ref.kind);
    classifiedAndMatching += Number(
      !M.needsReview(o) && o.category === ref.category && o.kind === ref.kind,
    );
  }
  return {
    operations: l.operations.length,
    categoryMatches,
    kindMatches,
    bothMatch,
    classifiedAndMatching,
    categoryDifferences: l.operations.length - categoryMatches,
    kindDifferences: l.operations.length - kindMatches,
    uncategorized: l.operations.filter((o) => o.category === M.uncategorized)
      .length,
    needsReview: l.operations.filter(M.needsReview).length,
    savingsOperations: l.operations.filter((o) => o.kind === M.K.savings)
      .length,
  };
}
function differences(l: M.Ledger) {
  const groups = new Map<
    string,
    {
      count: number;
      description: string;
      currentCategory: string;
      expectedCategory: string;
      currentKind: string;
      expectedKind: string;
    }
  >();
  for (const o of l.operations) {
    const ref = expected(o);
    if (o.category === ref.category && o.kind === ref.kind) continue;
    const k = JSON.stringify([
      M.groupKey(o.details, o.amount < 0n),
      o.category,
      ref.category,
      o.kind,
      ref.kind,
    ]);
    const group = groups.get(k) ?? {
      count: 0,
      description: label(o),
      currentCategory: o.category,
      expectedCategory: ref.category,
      currentKind: o.kind,
      expectedKind: ref.kind,
    };
    group.count++;
    groups.set(k, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
const report: Record<string, unknown> = {
  rawFactsMatch: true,
  current: score(current),
  reference: score(reference),
  currentPresets: current.descriptionRules?.length ?? 0,
  referencePresets: reference.descriptionRules?.length ?? 0,
  mccOperations: current.operations.filter((o) => o.mcc).length,
  biggestDifferences: differences(current).slice(0, 25),
};
if (flags.includes("--general-rules")) {
  const next = M.automaticPreview(current).next;
  const withoutPhoneSettings = structuredClone(current);
  withoutPhoneSettings.transferOwners = {};
  withoutPhoneSettings.phoneNames = {};
  withoutPhoneSettings.otherPhonesArePeople = false;
  M.applyAutomaticClassification(withoutPhoneSettings);
  report.generalRules = score(next);
  report.generalRulesWithoutPhoneSettings = score(withoutPhoneSettings);
  report.remainingAfterGeneralRules = differences(next);
  report.generalRuleReasons = Object.fromEntries(
    [
      ...new Set(
        next.operations.map((o) => o.categoryReason ?? "Другие правила"),
      ),
    ].map((reason) => [
      reason,
      next.operations.filter(
        (o) => (o.categoryReason ?? "Другие правила") === reason,
      ).length,
    ]),
  );
}
if (flags.includes("--simulate-settings")) {
  const settings = settingsOf(reference),
    empty = settingsOf(M.emptyLedger());
  const apply = (s: M.Settings) => {
    const l = structuredClone(current);
    applySettings(l, s);
    return l;
  };
  const presets = apply({
    ...empty,
    descriptionRules: settings.descriptionRules,
  });
  const phones = apply({
    ...empty,
    transferOwners: settings.transferOwners,
    phoneNames: settings.phoneNames,
    otherPhonesArePeople: settings.otherPhonesArePeople,
  });
  const all = apply(settings);
  const generalized = structuredClone(all);
  M.applyAutomaticClassification(generalized);
  const manual = structuredClone(all);
  for (const o of manual.operations) {
    const refs = index.get(key(o))!,
      ref = refs[0];
    if (refs.some((r) => r.manualCategory)) {
      o.category = ref.category;
      o.manualCategory = true;
    }
    if (refs.some((r) => r.manualKind)) {
      o.kind = ref.kind;
      o.manualKind = true;
    }
  }
  M.reclassify(manual);
  report.simulations = {
    builtinAuto: score(M.automaticPreview(current).next),
    presetsOnly: score(presets),
    phonesOnly: score(phones),
    allSettings: score(all),
    generalizedPresets: score(generalized),
    settingsAndManualChoices: score(manual),
  };
  report.remainingAfterSettings = differences(all);
  report.remainingAfterManualChoices = differences(manual);
  assert.equal(
    score(manual).bothMatch,
    reference.operations.length,
    "Не все различия объясняются настройками и ручными исправлениями",
  );
}
const hash = (s: Uint8Array) => createHash("sha256").update(s).digest("hex");
[currentPath, referencePath].forEach((p, i) =>
  assert.equal(
    hash(readFileSync(p)),
    hash(sources[i]),
    "Исходная база изменилась во время сравнения",
  ),
);
report.sourceFilesUnchanged = true;
console.log(JSON.stringify(report, null, 2));
if (
  flags.includes("--require-match") &&
  score(current).bothMatch !== current.operations.length
)
  process.exitCode = 1;
