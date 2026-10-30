import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

const root = new URL("../", import.meta.url);
const output = new URL("dist-pwa/", root);
for (const name of [
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
])
  await cp(new URL(`pwa/${name}`, root), new URL(name, output));
const files = (await readdir(output, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name !== "sw.js")
  .map((entry) =>
    relative(fileURLToPath(output), join(entry.parentPath, entry.name))
      .split(sep)
      .join("/"),
  )
  .sort();
const hash = createHash("sha256");
const template = await readFile(new URL("pwa/sw.js", root), "utf8");
hash.update(template);
for (const file of files) {
  hash.update(file);
  hash.update(await readFile(new URL(file, output)));
}
const version = hash.digest("hex").slice(0, 20);
await writeFile(
  new URL("sw.js", output),
  template
    .replace("__VERSION__", JSON.stringify(version))
    .replace("__FILES__", JSON.stringify(files)),
);
console.log(`PWA: ${files.length} offline resources, version ${version}`);
