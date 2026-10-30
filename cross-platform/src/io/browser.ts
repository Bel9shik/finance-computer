import type { Storage } from "./platform";

function transaction<T>(
  mode: IDBTransactionMode,
  work: (
    store: IDBObjectStore,
    result: (value: T) => void,
    fail: (error: Error) => void,
  ) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("finance-computer", 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore("ledger");
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(Error("Закрой другие окна приложения и открой его снова"));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      const tx = db.transaction("ledger", mode);
      let value: T;
      let failure: Error | undefined;
      tx.oncomplete = () => {
        db.close();
        resolve(value);
      };
      tx.onabort = () => {
        db.close();
        reject(failure ?? tx.error ?? Error("Сохранение прервано"));
      };
      try {
        work(
          tx.objectStore("ledger"),
          (result) => {
            value = result;
          },
          (error) => {
            failure = error;
            tx.abort();
          },
        );
      } catch (error) {
        failure = error instanceof Error ? error : Error(String(error));
        tx.abort();
      }
    };
  });
}

function read(key: string): Promise<string | null> {
  return transaction("readonly", (store, result) => {
    const request = store.get(key);
    request.onsuccess = () => result(request.result ?? null);
  });
}

export function createBrowserStorage(): Storage {
  let loaded: string | null | undefined;
  return {
    async load() {
      loaded = await read("current");
      return loaded;
    },
    async save(data, backup) {
      if (new Blob([data]).size > 256 * 1024 * 1024)
        throw Error("База больше 256 МБ");
      await transaction<void>("readwrite", (store, result, fail) => {
        const request = store.get("current");
        request.onsuccess = () => {
          try {
            const current = request.result ?? null;
            if (current !== loaded) {
              fail(
                Error(
                  "База изменилась в другом окне. Открой приложение заново перед изменениями",
                ),
              );
              return;
            }
            // The previous copy and the replacement commit together, including quota failures.
            if (backup && current !== null) store.put(current, "backup");
            store.put(data, "current");
            result();
          } catch (error) {
            fail(error instanceof Error ? error : Error(String(error)));
          }
        };
      });
      loaded = data;
    },
  };
}

export const readBrowserBackup = () => read("backup");

export function pickBrowserFiles(
  accept: string,
  multiple = false,
): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.hidden = true;
    const finish = () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", finish, { once: true });
    input.addEventListener("cancel", finish, { once: true });
    document.body.append(input);
    try {
      input.click();
    } catch (error) {
      input.remove();
      reject(error);
    }
  });
}

export async function saveBrowserFile(
  name: string,
  text: string,
): Promise<boolean> {
  const file = new File([text], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        return false;
      throw error;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return true;
}
