import { useEffect, useId, useRef, useState } from "react";
import { formatMoney, type Group } from "../core/model";
const colors = [
  "#c82ede",
  "#008aff",
  "#00b9db",
  "#ff8d20",
  "#ff2d55",
  "#2cc653",
  "#6454ff",
  "#00c2af",
  "#ff3b40",
  "#ad8360",
  "#00bccc",
  "#ffcc00",
];
export function Pie({
  groups,
  currency,
  onSelect,
}: {
  groups: Group[];
  currency: string;
  onSelect: (label: string) => void;
}) {
  const total = groups.reduce(
    (s, g) => s + (g.amount > 0n ? g.amount : 0n),
    0n,
  );
  let offset = 0;
  return (
    <div className="pie-layout">
      {total > 0n ? (
        <svg viewBox="0 0 320 280" aria-label="Доли по категориям">
          {groups.map((g, i) => {
            if (g.amount <= 0n) return null;
            const part = Number(g.amount) / Number(total);
            const start = offset * 2 * Math.PI - Math.PI / 2;
            offset += part;
            const end = offset * 2 * Math.PI - Math.PI / 2;
            const middle = (start + end) / 2;
            const full = g.amount === total;
            const label = part.toLocaleString("ru-RU", {
              style: "percent",
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            });
            const labelX = full ? 160 : 160 + 92 * Math.cos(middle);
            const labelY = full ? 140 : 140 + 92 * Math.sin(middle);
            const labelWidth = label.length * 7 + 10;
            return (
              <g
                key={g.label}
                className="pie-slice"
                fill={colors[i % colors.length]}
                role="button"
                tabIndex={0}
                aria-label={`${g.label}: ${formatMoney(g.amount, currency)}, ${label}`}
                onClick={() => onSelect(g.label)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(g.label);
                  }
                }}
              >
                <title>
                  {g.label}: {formatMoney(g.amount, currency)}
                </title>
                {full ? (
                  <circle cx="160" cy="140" r="138" />
                ) : (
                  <path
                    d={`M160 140 L${160 + 138 * Math.cos(start)} ${140 + 138 * Math.sin(start)} A138 138 0 ${part > 0.5 ? 1 : 0} 1 ${160 + 138 * Math.cos(end)} ${140 + 138 * Math.sin(end)} Z`}
                    stroke="var(--card)"
                    strokeWidth="2"
                  />
                )}
                {part >= 0.05 && (
                  <g className="pie-percentage" pointerEvents="none">
                    <rect
                      x={labelX - labelWidth / 2}
                      y={labelY - 10}
                      width={labelWidth}
                      height="20"
                      rx="4"
                      fill="#ffffffe6"
                    />
                    <text
                      x={labelX}
                      y={labelY + 4}
                      textAnchor="middle"
                      fill="#111"
                      fontSize="13"
                      fontWeight="600"
                    >
                      {label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      ) : (
        <p className="pie-empty muted">Нет операций за этот период</p>
      )}
      <div className="legend">
        {groups.map((g, i) => (
          <button
            className="legend-row"
            key={g.label}
            onClick={() => onSelect(g.label)}
          >
            <span
              className="dot"
              style={{ background: colors[i % colors.length] }}
            />
            <span>{g.label}</span>
            <strong>{formatMoney(g.amount, currency)}</strong>
            <span className="muted">
              {total > 0n && g.amount > 0n
                ? (Number(g.amount) / Number(total)).toLocaleString("ru-RU", {
                    style: "percent",
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })
                : "—"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
export function LineChart({
  points,
  currency,
  monthly,
  color = "#008aff",
  onSelect,
}: {
  points: Group[];
  currency: string;
  monthly: boolean;
  color?: string;
  onSelect: (period: string) => void;
}) {
  const titleId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(680);
  const hasPoints = points.length > 0;
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setAvailableWidth(entry.contentRect.width),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [hasPoints]);
  if (!hasPoints)
    return <p className="muted">Нет операций за выбранный период</p>;
  const width = Math.max(680, availableWidth, points.length * 125),
    height = 260,
    max = Math.max(...points.map((p) => Number(p.amount)), 1),
    x = (i: number) =>
      65 +
      (points.length === 1
        ? (width - 115) / 2
        : (i * (width - 115)) / (points.length - 1)),
    y = (n: bigint) => 205 - (Number(n) / max) * 150;
  return (
    <>
      <div className="chart-scroll" ref={container}>
        <svg width={width} height={height} role="img" aria-labelledby={titleId}>
          <title id={titleId}>
            Суммы по {monthly ? "месяцам" : "дням"}, {currency}
          </title>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line
                x1="60"
                x2={width - 20}
                y1={205 - i * 37.5}
                y2={205 - i * 37.5}
                stroke="var(--line)"
              />
              <text
                x="52"
                y={209 - i * 37.5}
                textAnchor="end"
                fill="var(--muted)"
                fontSize="10"
              >
                {Math.round((max * i) / 400).toLocaleString("ru-RU")}
              </text>
            </g>
          ))}
          <polyline
            points={points.map((p, i) => `${x(i)},${y(p.amount)}`).join(" ")}
            fill="none"
            stroke={color}
            strokeWidth="3"
          />
          {points.map((p, i) => (
            <g key={p.label} onClick={() => onSelect(p.label)}>
              <rect
                x={x(i) - 25}
                y="15"
                width="50"
                height="225"
                fill="transparent"
              />
              <rect
                x={x(i) - 4}
                y={y(p.amount) - 4}
                width="8"
                height="8"
                transform={`rotate(45 ${x(i)} ${y(p.amount)})`}
                fill={color}
              />
              <text
                x={x(i)}
                y={y(p.amount) - 14}
                textAnchor="middle"
                fill="var(--ink)"
                fontSize="11"
              >
                {formatMoney(p.amount, currency)}
              </text>
              <text
                x={x(i)}
                y="235"
                textAnchor="middle"
                fill="var(--muted)"
                fontSize="11"
              >
                {monthly
                  ? p.label.slice(5) + "." + p.label.slice(0, 4)
                  : p.label.slice(8) + "." + p.label.slice(5, 7)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="muted small">
        Нажми точку, чтобы открыть операции. Длинный график прокручивается по
        горизонтали.
      </p>
      <select
        aria-label="Открыть период графика"
        value=""
        onChange={(e) => {
          if (e.target.value) onSelect(e.target.value);
        }}
      >
        <option value="">Открыть {monthly ? "месяц" : "день"}…</option>
        {points.map((p) => (
          <option key={p.label}>{p.label}</option>
        ))}
      </select>
    </>
  );
}
