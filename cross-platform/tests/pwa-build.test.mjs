import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { relative, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

test("PWA package caches every shipped asset and works under a hosting subdirectory", async () => {
  const root = new URL("../dist-pwa/", import.meta.url);
  const scope = "https://test.invalid/my-finances/";
  const manifest = JSON.parse(
    await readFile(new URL("manifest.webmanifest", root), "utf8"),
  );
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /manifest.webmanifest/);
  assert(!/(?:src|href)="\//.test(html));
  let install;
  let files;
  runInNewContext(await readFile(new URL("sw.js", root), "utf8"), {
    URL,
    self: {
      registration: { scope },
      addEventListener: (name, fn) => {
        if (name === "install") install = fn;
      },
    },
    caches: {
      open: async () => ({
        addAll: async (urls) => {
          files = urls;
        },
      }),
    },
  });
  let complete;
  install({
    waitUntil: (promise) => {
      complete = promise;
    },
  });
  await complete;
  const expected = (
    await readdir(root, { recursive: true, withFileTypes: true })
  )
    .filter((entry) => entry.isFile() && entry.name !== "sw.js")
    .map((entry) =>
      relative(fileURLToPath(root), join(entry.parentPath, entry.name))
        .split(sep)
        .join("/"),
    );
  assert.deepEqual(
    Array.from(files).sort(),
    expected.map((path) => new URL(path, scope).href).sort(),
  );
  assert(files.some((path) => /import\.worker-/.test(path)));
  assert(files.some((path) => /pdf\.worker/.test(path)));
  assert(
    expected.every(
      (path) => !/\.map$|ledger|fixture|\.test\.|\.swift$|\.rs$/.test(path),
    ),
  );
  for (const { src, sizes } of manifest.icons) {
    const png = await readFile(new URL(src, root));
    assert.equal(png.readUInt32BE(16), Number(sizes.split("x")[0]));
    assert.equal(png.readUInt32BE(20), Number(sizes.split("x")[1]));
  }
});
