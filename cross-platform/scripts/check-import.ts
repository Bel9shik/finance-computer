import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parsePDFPages, parseAlfa, type PDFText } from "../src/io/parsers";
import { encodeLedger } from "../src/core/codec";
for (const path of process.argv.slice(2)) {
  const data = new Uint8Array(await readFile(path)),
    filename = basename(path);
  let result;
  if (path.endsWith(".xlsx")) result = parseAlfa(data, filename);
  else {
    const doc = await getDocument({
      data,
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
    result = parsePDFPages(pages, filename);
  }
  console.log(
    JSON.stringify({
      extension: path.split(".").at(-1),
      count: result.operations.length,
      income: String(
        result.operations
          .filter((o) => o.amount > 0n)
          .reduce((s, o) => s + o.amount, 0n),
      ),
      expense: String(
        result.operations
          .filter((o) => o.amount < 0n)
          .reduce((s, o) => s - o.amount, 0n),
      ),
      warnings: result.warnings.length,
    }),
  );
  if (process.env.FINANCE_COMPARE_OUTPUT) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      process.env.FINANCE_COMPARE_OUTPUT,
      encodeLedger({ version: 1, operations: result.operations, imports: [] }),
    );
  }
}
