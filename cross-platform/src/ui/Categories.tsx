import { useMemo, useState } from "react";
import * as M from "../core/model";
import { ask } from "../io/platform";

export function Categories({
  ledger,
  change,
  disabled,
}: {
  ledger: M.Ledger;
  change: (edit: (l: M.Ledger) => void, backup?: boolean) => Promise<void>;
  disabled: boolean;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [replacement, setReplacement] = useState("");
  const [error, setError] = useState("");
  const categories = M.allCategories(ledger).sort((a, b) =>
    a === M.uncategorized
      ? 1
      : b === M.uncategorized
        ? -1
        : a.localeCompare(b, "ru"),
  );
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const o of ledger.operations)
      result.set(o.category, (result.get(o.category) ?? 0) + 1);
    return result;
  }, [ledger]);
  const save = async (edit: (l: M.Ledger) => void, done: () => void) => {
    setError("");
    try {
      await change(edit, true);
      done();
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div className="editor automatic-rules">
      <p>
        Переименование обновит операции, пресеты и правила MCC. При удалении
        операции получат «Без категории»; суммы и типы сохранятся.
      </p>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void save(
            (l) => M.addCategory(l, name),
            () => setName(""),
          );
        }}
      >
        <label>
          Новая категория
          <input
            value={name}
            disabled={disabled}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button disabled={disabled || !name.trim()}>Добавить категорию</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {categories.map((c) => (
        <div className="group-row" key={c}>
          {editing === c ? (
            <form
              className="toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                void save(
                  (l) => M.renameCategory(l, c, replacement),
                  () => setEditing(null),
                );
              }}
            >
              <label>
                Название категории
                <input
                  autoFocus
                  value={replacement}
                  disabled={disabled}
                  onChange={(e) => setReplacement(e.target.value)}
                />
              </label>
              <button disabled={disabled || !replacement.trim()}>
                Переименовать
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setEditing(null)}
              >
                Отмена
              </button>
            </form>
          ) : (
            <>
              <div>
                <strong>{c}</strong>
                <p className="muted small">Операций: {counts.get(c) ?? 0}</p>
              </div>
              {c === M.uncategorized ? (
                <span className="muted small">Обязательная категория</span>
              ) : (
                <div className="toolbar">
                  <button
                    disabled={disabled}
                    aria-label={`Переименовать категорию ${c}`}
                    onClick={() => {
                      setEditing(c);
                      setReplacement(c);
                    }}
                  >
                    Изменить
                  </button>
                  <button
                    disabled={disabled}
                    aria-label={`Удалить категорию ${c}`}
                    onClick={() => {
                      void ask(
                        `Удалить категорию «${c}»? Операций, которые получат «Без категории»: ${counts.get(c) ?? 0}. Связанные пресеты и правила MCC тоже получат «Без категории». Перед изменением будет создана резервная копия.`,
                      )
                        .then((ok) =>
                          ok
                            ? save(
                                (l) => M.deleteCategory(l, c),
                                () => {},
                              )
                            : undefined,
                        )
                        .catch((e) => setError(String(e)));
                    }}
                  >
                    Удалить
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ))}
      <p className="muted small">
        Категории сохраняются после «Начать заново» и входят в экспорт настроек.
      </p>
    </div>
  );
}
