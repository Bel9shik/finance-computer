import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import assert from "node:assert/strict";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { decodeLedger, parseJSON, encodeLedger } from "../src/core/codec";
import * as M from "../src/core/model";
import { parsePDFPages, parseAlfa, type PDFText } from "../src/io/parsers";
for (const path of process.argv.slice(2)) {
  const raw = await readFile(path),
    filename = basename(path);
  const oracle = parseJSON(
    execFileSync(resolve("../build/swift-oracle"), [path], {
      maxBuffer: 256 * 1024 * 1024,
      encoding: "utf8",
    }),
  );
  let l: M.Ledger;
  if (path.endsWith(".json")) l = M.migrate(decodeLedger(raw.toString("utf8")));
  else if (path.endsWith(".xlsx"))
    l = {
      ...M.emptyLedger(),
      operations: parseAlfa(new Uint8Array(raw), filename).operations,
    };
  else {
    const doc = await getDocument({
      data: new Uint8Array(raw),
      useSystemFonts: false,
      disableFontFace: true,
    }).promise;
    const pages: PDFText[][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const t = await (await doc.getPage(i)).getTextContent();
      pages.push(
        t.items.flatMap((x) =>
          "str" in x
            ? [
                {
                  str: x.str,
                  x: x.transform[4],
                  y: x.transform[5],
                  width: x.width,
                  height: x.height,
                },
              ]
            : [],
        ),
      );
    }
    await doc.destroy();
    l = {
      ...M.emptyLedger(),
      operations: parsePDFPages(pages, filename).operations,
    };
  }
  l = decodeLedger(encodeLedger(l));
  const expected = decodeLedger(encodeLedger(oracle.ledger));
  assert.equal(
    l.operations.length,
    expected.operations.length,
    "operation count",
  );
  const fields = (o: M.Operation) => {
    const { id, sourceRow, ...rest } = o;
    return rest;
  };
  // Only record number and field names on mismatch: financial descriptions stay local and out of logs.
  let mismatches = 0;
  const keys = new Set<string>();
  for (let i = 0; i < l.operations.length; i++) {
    const a = fields(l.operations[i]),
      b = fields(expected.operations[i]);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      try {
        assert.deepEqual(
          structuredClone((a as any)[k]),
          structuredClone((b as any)[k]),
        );
      } catch {
        mismatches++;
        keys.add(k);
      }
    }
    const o = l.operations[i],
      suggest = M.suggest(o.details, o.amount);
    const derived = {
      group: M.groupKey(o.details, o.amount < 0n),
      party: M.transferParty(o)?.id ?? "",
      source: M.incomeSource(o, l.phoneNames),
      expenses: String(M.expenseAmount(o)),
      income: String(M.incomeAmount(o)),
      savings: String(M.savingsAmount(o)),
      review: M.needsReview(o),
      suggestKind: suggest.kind,
      suggestCategory: suggest.category,
    };
    for (const k of Object.keys(derived)) {
      try {
        assert.deepEqual((derived as any)[k], oracle.derived[i][k]);
      } catch {
        mismatches++;
        keys.add("derived." + k);
      }
    }
  }
  if (path.endsWith(".json"))
    for (const k of [
      "descriptionRules",
      "phoneNames",
      "transferOwners",
      "otherPhonesArePeople",
    ] as const) {
      try {
        assert.deepEqual(structuredClone(l[k]), structuredClone(expected[k]));
      } catch {
        mismatches++;
        keys.add(k);
      }
    }
  console.log(
    JSON.stringify({
      format: path.split(".").at(-1),
      operations: l.operations.length,
      mismatches,
      fields: [...keys],
    }),
  );
  assert.equal(mismatches, 0, "Swift and TypeScript must match");
}
