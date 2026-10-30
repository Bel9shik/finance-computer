import { useMemo, useState } from "react";
import * as M from "../core/model";
import { extractMCC } from "../core/categories";

export function AutomaticRules({
  ledger,
  change,
  disabled,
  close,
}: {
  ledger: M.Ledger;
  change: (edit: (l: M.Ledger) => void, backup?: boolean) => Promise<void>;
  disabled: boolean;
  close: () => void;
}) {
  const [draft, setDraft] = useState({ ...ledger.mccCategories });
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(50);
  const [query, setQuery] = useState("");
  const [codeLimit, setCodeLimit] = useState(30);
  const preview = useMemo(
    () => M.automaticPreview({ ...ledger, mccCategories: draft }),
    [ledger, draft],
  );
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const o of ledger.operations) {
      const c = o.mcc ?? extractMCC(o.details);
      if (c) result.set(c, (result.get(c) ?? 0) + 1);
    }
    return result;
  }, [ledger]);
  const defaultCategory = (c: string) =>
    M.mccDefaults[c] && M.categoryName(ledger, M.mccDefaults[c]);
  const codes = [
    ...new Set([
      ...counts.keys(),
      ...Object.keys(draft),
      ...Object.keys(M.mccDefaults),
    ]),
  ]
    .filter((c) =>
      M.normalize(`${c} ${draft[c] ?? defaultCategory(c) ?? ""}`).includes(
        M.normalize(query),
      ),
    )
    .sort(
      (a, b) =>
        Number(Object.hasOwn(draft, b)) - Number(Object.hasOwn(draft, a)) ||
        (counts.get(b) ?? 0) - (counts.get(a) ?? 0) ||
        a.localeCompare(b),
    );
  const generalized =
    preview.next.descriptionRules?.filter((r) => r.matchMerchant) ?? [];
  const merged = generalized.filter(
    (r) =>
      (r.alternateDescriptions?.length ?? 0) >
      (ledger.descriptionRules?.find((old) => old.id === r.id)
        ?.alternateDescriptions?.length ?? 0),
  );
  return (
    <div className="editor automatic-rules">
      <p>
        Общие правила распознают накопления, доходы, возвраты и услуги
        продавцов. Для покупок: твой пресет → твоё правило MCC → категория банка
        → MCC → описание. Индивидуальные исправления сохраняются. По одному
        номеру договора нельзя определить владельца — такие переводы остаются на
        разборе.
      </p>
      <div className="notice">
        <p>
          На разбор:{" "}
          <strong>
            {preview.reviewBefore} → {preview.reviewAfter}
          </strong>
          . Изменятся категория или тип у {preview.changes.length} операций.
        </p>
        <p>
          Пресетов:{" "}
          <strong>
            {preview.rulesBefore} → {preview.rulesAfter}
          </strong>
          . По продавцу: {preview.merchantRules}.
        </p>
        <p>
          MCC найден у {preview.mccOperations} из {ledger.operations.length}{" "}
          операций.
        </p>
      </div>
      <h3>Правила по MCC</h3>
      <p className="muted small">
        Встроенный справочник работает автоматически. Здесь можно изменить
        категорию любого четырёхзначного кода. «Без категории» оставляет такие
        покупки для ручного разбора. Изменённое правило действует на
        существующие и будущие операции с этим MCC. Сначала проверь изменения
        ниже, затем примени их.
      </p>
      <div className="toolbar">
        <label>
          MCC
          <input
            value={code}
            inputMode="numeric"
            maxLength={4}
            onChange={(e) => setCode(e.target.value)}
            placeholder="5814"
          />
        </label>
        <label>
          Категория
          <input
            list="automatic-categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>
        <button
          disabled={disabled || !/^\d{4}$/.test(code) || !category.trim()}
          onClick={() => {
            setDraft({
              ...draft,
              [code]: M.categoryName(ledger, category.trim()),
            });
            setCode("");
            setCategory("");
          }}
        >
          Добавить в просмотр
        </button>
      </div>
      <datalist id="automatic-categories">
        {M.allCategories(ledger).map((c) => (
          <option key={c}>{c}</option>
        ))}
      </datalist>
      {/^\d{4}$/.test(code) && (
        <p className="muted small">
          По умолчанию: {defaultCategory(code) ?? "Не определено"}
        </p>
      )}
      <label>
        Найти правило MCC или категорию
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCodeLimit(30);
          }}
          placeholder="Например, 5814 или Транспорт"
        />
      </label>
      {codes.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>MCC</th>
                <th>Операций</th>
                <th>Категория</th>
                <th>Правило</th>
              </tr>
            </thead>
            <tbody>
              {codes.slice(0, codeLimit).map((c) => (
                <tr key={c}>
                  <td>{c}</td>
                  <td>{counts.get(c) ?? 0}</td>
                  <td>{draft[c] ?? defaultCategory(c) ?? "Не определено"}</td>
                  <td>
                    <button
                      onClick={() => {
                        setCode(c);
                        setCategory(draft[c] ?? defaultCategory(c) ?? "");
                      }}
                    >
                      Изменить
                    </button>
                    {draft[c] && (
                      <button
                        onClick={() => {
                          const next = { ...draft };
                          delete next[c];
                          setDraft(next);
                        }}
                      >
                        По умолчанию
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {codes.length === 0 && (
        <p className="muted">
          Правил не найдено. Новый код можно добавить выше.
        </p>
      )}
      {codes.length > codeLimit && (
        <button onClick={() => setCodeLimit((n) => n + 30)}>
          Показать ещё правила MCC ({codes.length - codeLimit})
        </button>
      )}
      {merged.length > 0 && (
        <details open>
          <summary>Будут объединены группы ({merged.length})</summary>
          {merged.map((r) => (
            <div className="group-row" key={r.id}>
              <div>
                <strong>{M.groupLabel(r.description)}</strong>
                <p>
                  {r.category} · {r.kind}
                </p>
                <ul>
                  {r.alternateDescriptions?.map((d) => (
                    <li key={d}>{M.groupLabel(d)}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </details>
      )}
      <details>
        <summary>Пресеты продавцов ({generalized.length})</summary>
        <p className="muted small">
          Различия в регистре, пробелах, разделителях и месте покупки не создают
          новый пресет. Цифры и названия сервисов сохраняются. Противоречащие
          друг другу правила автоматически не объединяются.
        </p>
        {generalized.slice(0, limit).map((r) => (
          <div className="group-row" key={r.id}>
            <strong>{M.groupLabel(r.description)}</strong>
            <span>
              {r.category} · {r.kind}
            </span>
            <small>
              {(r.alternateDescriptions?.length ?? 0) + 1} вариантов описания
            </small>
          </div>
        ))}
        {generalized.length > limit && (
          <button onClick={() => setLimit((n) => n + 50)}>
            Показать ещё пресеты
          </button>
        )}
      </details>
      <h3>Изменения операций</h3>
      {!preview.changes.length ? (
        <p className="muted">
          Категории и типы существующих операций не изменятся. Общие пресеты
          будут действовать и при следующих импортах.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Описание</th>
                <th>Было</th>
                <th>Станет</th>
                <th>Причина</th>
              </tr>
            </thead>
            <tbody>
              {preview.changes.slice(0, limit).map(({ before, after }) => (
                <tr key={after.id}>
                  <td>{after.date}</td>
                  <td>{after.details}</td>
                  <td>
                    {before.category} · {before.kind}
                  </td>
                  <td>
                    {after.category} · {after.kind}
                  </td>
                  <td>{M.categoryExplanation(preview.next, after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.changes.length > limit && (
            <button onClick={() => setLimit((n) => n + 50)}>
              Показать ещё изменения
            </button>
          )}
        </div>
      )}
      <p className="muted small">
        До применения база не меняется. Перед сохранением приложение создаст
        резервную копию. Новые правила входят в экспорт настроек.
      </p>
      <button
        className="primary"
        disabled={disabled}
        onClick={() =>
          void change((l) => {
            l.mccCategories = { ...draft };
            M.applyAutomaticClassification(l);
          }, true)
            .then(close)
            .catch(() => {})
        }
      >
        Применить авторазбор
      </button>
    </div>
  );
}
