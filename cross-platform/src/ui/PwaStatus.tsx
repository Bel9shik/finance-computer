import { useEffect, useState } from "react";

export function PwaStatus() {
  const [status, setStatus] = useState("Подготавливаю работу без интернета…");
  useEffect(() => {
    let active = true;
    const update = (text: string) => {
      if (active) setStatus(text);
    };
    const failed = () =>
      update(
        "Офлайн-режим пока не готов. Подключись к интернету и открой приложение снова.",
      );
    void (async () => {
      if (import.meta.env.MODE !== "pwa") {
        update("Проверочная версия. Для установки используй сборку PWA.");
        return;
      }
      if (!window.isSecureContext || !("serviceWorker" in navigator)) {
        update(
          "Для офлайн-установки открой HTTPS-ссылку на приложение в Safari. Открытый с диска HTML не подходит.",
        );
        return;
      }
      const registration = await navigator.serviceWorker.register(
        new URL("sw.js", document.baseURI),
        { scope: "./" },
      );
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "redundant" && !registration.active) failed();
      });
      await navigator.serviceWorker.ready;
      update("Готово к работе без интернета");
      await navigator.storage?.persist?.().catch(() => false);
    })().catch(failed);
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="notice pwa-status">
      <p role="status">{status}</p>
      <details>
        <summary>Установить на iPhone</summary>
        <p>
          Открой эту страницу в Safari → «Поделиться» → «На экран Домой» →
          «Добавить». Если есть переключатель «Открывать как веб-приложение»,
          включи его. Открой новую иконку с интернетом и дождись готовности
          офлайн-режима. Подпись Apple и еженедельная переустановка не нужны.
        </p>
      </details>
      <p className="small">
        Данные хранятся только на этом устройстве. Сохраняй копию в «Файлы»:
        очистка данных сайта или удаление веб-приложения может удалить базу.
      </p>
    </section>
  );
}
