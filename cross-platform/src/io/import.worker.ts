import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerURL from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { parseAlfa, parsePDFPages, type PDFText } from "./parsers";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
GlobalWorkerOptions.workerSrc = workerURL;
self.onmessage = async ({
  data,
}: {
  data: { bytes: Uint8Array; filename: string };
}) => {
  try {
    const { bytes, filename } = data;
    if (bytes.length > 25 * 1024 * 1024)
      throw Error("Максимальный размер файла — 25 МБ");
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
      ),
    )
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    let result;
    if (/\.xlsx$/i.test(filename)) result = parseAlfa(bytes, filename);
    else if (/\.pdf$/i.test(filename)) {
      const document = await getDocument({
        data: bytes,
        useSystemFonts: false,
        disableFontFace: true,
        useWorkerFetch: false,
      }).promise;
      try {
        if (document.numPages > 200)
          throw Error("PDF содержит больше 200 страниц");
        const pages: PDFText[][] = [];
        for (let i = 1; i <= document.numPages; i++) {
          const page = await document.getPage(i);
          // WKWebView lacks ReadableStream's async iterator on supported macOS versions.
          const reader = (
            page.streamTextContent() as ReadableStream<TextContent>
          ).getReader();
          const items: PDFText[] = [];
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              items.push(
                ...value.items.flatMap((item) =>
                  "str" in item
                    ? [
                        {
                          str: item.str,
                          x: item.transform[4],
                          y: item.transform[5],
                          width: item.width,
                          height: item.height,
                        },
                      ]
                    : [],
                ),
              );
            }
          } finally {
            reader.releaseLock();
          }
          pages.push(items);
          page.cleanup();
        }
        result = parsePDFPages(pages, filename);
      } finally {
        await document.destroy();
      }
    } else
      throw Error(
        "Поддерживаются PDF Т‑Банка, Пэя и Сбербанка, XLSX Альфа‑Банка",
      );
    self.postMessage({ type: "finance-import", result, digest });
  } catch (e) {
    self.postMessage({
      type: "finance-import",
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
