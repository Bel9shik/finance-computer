import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function worker(missing = false) {
  const scope = "https://test.invalid/finances/";
  const handlers = new Map<string, (event: any) => void>();
  const stores = new Map<string, Map<string, Response>>();
  let claimed = false;
  const key = (value: string | Request) => {
    const url = new URL(typeof value === "string" ? value : value.url);
    url.search = "";
    return url.href;
  };
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name)!;
      return {
        async addAll(urls: string[]) {
          if (missing) throw Error("Missing worker asset");
          for (const url of urls) entries.set(url, new Response(url));
        },
        async match(request: string | Request) {
          return entries.get(key(request))?.clone();
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  const source = readFileSync(new URL("../pwa/sw.js", import.meta.url), "utf8")
    .replace("__VERSION__", '"new"')
    .replace(
      "__FILES__",
      JSON.stringify([
        "index.html",
        "assets/import.worker.js",
        "assets/pdf.worker.mjs",
      ]),
    );
  runInNewContext(source, {
    URL,
    caches,
    fetch: async () => {
      throw Error("Offline");
    },
    self: {
      registration: { scope },
      clients: {
        async claim() {
          claimed = true;
        },
      },
      skipWaiting() {
        throw Error("Must not replace a running version");
      },
      addEventListener(name: string, handler: (event: any) => void) {
        handlers.set(name, handler);
      },
    },
  });
  const lifecycle = async (type: string) => {
    let work: Promise<unknown> | undefined;
    handlers.get(type)!({
      waitUntil(promise: Promise<unknown>) {
        work = promise;
      },
    });
    await work;
  };
  const fetchRequest = (path: string, mode = "same-origin", method = "GET") => {
    let result: Promise<Response> | undefined;
    handlers.get("fetch")!({
      request: { url: new URL(path, scope).href, mode, method },
      respondWith(promise: Promise<Response>) {
        result = promise;
      },
    });
    return result;
  };
  return {
    lifecycle,
    fetchRequest,
    caches,
    stores,
    claimed: () => claimed,
    scope,
  };
}

test("offline launch and both parser workers are served from the completed cache", async () => {
  const w = worker();
  await w.lifecycle("install");
  assert.equal(
    await (await w.fetchRequest("./?source=icon", "navigate"))!.text(),
    w.scope + "index.html",
  );
  for (const file of ["assets/import.worker.js", "assets/pdf.worker.mjs"])
    assert.equal(await (await w.fetchRequest(file))!.text(), w.scope + file);
  await assert.rejects(w.fetchRequest("not-cached.js")!, /Offline/);
  assert.equal(w.fetchRequest("https://other.invalid/file"), undefined);
  assert.equal(w.fetchRequest("../other-app/index.html"), undefined);
  assert.equal(w.fetchRequest("data", "same-origin", "POST"), undefined);
});

test("updates remove only this installation's old code cache", async () => {
  const w = worker();
  await w.caches.open("finance-pwa-/finances/-old");
  await w.caches.open("finance-pwa-/other-app/-old");
  await w.caches.open("unrelated-cache");
  await w.lifecycle("install");
  assert(w.stores.has("finance-pwa-/finances/-old"));
  await w.lifecycle("activate");
  assert.deepEqual(
    [...w.stores.keys()].sort(),
    [
      "finance-pwa-/finances/-new",
      "finance-pwa-/other-app/-old",
      "unrelated-cache",
    ].sort(),
  );
  assert(w.claimed());
});

test("an incomplete download rejects service worker installation", async () => {
  const w = worker(true);
  await assert.rejects(w.lifecycle("install"), /Missing worker asset/);
  assert.equal(w.claimed(), false);
});
