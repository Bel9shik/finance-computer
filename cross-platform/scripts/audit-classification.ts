import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { decodeLedger, encodeLedger } from "../src/core/codec";
import * as M from "../src/core/model";

const path = process.argv[2];
if (!path) throw Error("Укажи путь к ledger.json или резервной копии");
const source = readFileSync(path);
const hash = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const ledger = M.migrate(decodeLedger(source.toString("utf8")));
const before = encodeLedger(ledger);
const started = performance.now();
const preview = M.automaticPreview(ledger);
const elapsedMs = performance.now() - started;
assert.equal(encodeLedger(ledger), before, "Preview changed the source ledger");
assert.equal(hash(readFileSync(path)), hash(source), "Source file changed");
assert.equal(preview.next.operations.length, ledger.operations.length);
for (let i = 0; i < ledger.operations.length; i++) {
  const a = ledger.operations[i],
    b = preview.next.operations[i];
  for (const key of [
    "id",
    "date",
    "details",
    "bank",
    "account",
    "amount",
    "currency",
    "possibleDuplicate",
    "manualCategory",
    "manualKind",
  ] as const)
    assert.equal(a[key], b[key], key);
  if (a.manualCategory) assert.equal(a.category, b.category);
  if (a.manualKind) assert.equal(a.kind, b.kind);
}
const oldRules = new Map(ledger.descriptionRules?.map((r) => [r.id, r]));
const merged = (preview.next.descriptionRules ?? [])
  .filter(
    (r) =>
      (r.alternateDescriptions?.length ?? 0) >
      (oldRules.get(r.id)?.alternateDescriptions?.length ?? 0),
  )
  .map((r) => ({
    description: M.groupLabel(r.description),
    category: r.category,
    addedVariants: (r.alternateDescriptions ?? [])
      .filter((d) => !oldRules.get(r.id)?.alternateDescriptions?.includes(d))
      .map(M.groupLabel),
  }));
console.log(
  JSON.stringify(
    {
      operations: ledger.operations.length,
      excludedWithoutCategory: ledger.operations.filter(
        (o) => o.kind === M.K.excluded && o.category === "Без категории",
      ).length,
      reviewBefore: preview.reviewBefore,
      reviewAfter: preview.reviewAfter,
      changedOperations: preview.changes.length,
      rulesBefore: preview.rulesBefore,
      rulesAfter: preview.rulesAfter,
      generalizedMerchantRules: preview.merchantRules,
      mccOperations: preview.mccOperations,
      preservedManualCategories: ledger.operations.filter(
        (o) => o.manualCategory,
      ).length,
      preservedManualKinds: ledger.operations.filter((o) => o.manualKind)
        .length,
      elapsedMs: Math.round(elapsedMs * 10) / 10,
      sourceUnchanged: true,
      merged,
    },
    null,
    2,
  ),
);
