import { useEffect, useRef, useState } from 'react';

// Small dependency-free SVG charts for the analytics page. Single series per chart (the
// title names it, so there is no legend box), thin columns with a rounded data end and a
// square base, hairline gridlines, a hover/focus tooltip per column, and a table view.

const PLOT = { top: 10, right: 8, bottom: 26, left: 34 };
const HEIGHT = 200;
const MAX_BAR = 24;

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Rounded maximum and tick values for whole-number counts (at most ~4 steps). */
export function niceScale(max) {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough));
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { max: top, ticks };
}

/** Column path: square at the baseline, 4px rounded corners at the data end. */
function columnPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Column chart for a count per time bucket.
 * `points`: [{ key, label (short axis label), title (full label), value }].
 */
export function ColumnChart({ title, points, color, yMax, valueLabel, summary, emptyText }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const scale = niceScale(yMax ?? Math.max(...points.map((p) => p.value), 0));

  const innerW = Math.max(0, width - PLOT.left - PLOT.right);
  const innerH = HEIGHT - PLOT.top - PLOT.bottom;
  const band = points.length ? innerW / points.length : 0;
  const barW = Math.max(2, Math.min(MAX_BAR, band - 2)); // 2px surface gap between neighbours
  const y = (v) => PLOT.top + innerH - (v / scale.max) * innerH;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 64))));
  const activePoint = active === null ? null : points[active];

  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      {total === 0 ? (
        <p className="chart-empty muted">{emptyText}</p>
      ) : (
        <div className="chart-plot" ref={ref}>
          {width > 0 && (
            <svg width={width} height={HEIGHT} role="img" aria-label={summary}>
              {scale.ticks.map((t) => (
                <g key={t}>
                  <line x1={PLOT.left} x2={width - PLOT.right} y1={y(t)} y2={y(t)} className="chart-grid" />
                  <text x={PLOT.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="chart-tick">
                    {t}
                  </text>
                </g>
              ))}
              {points.map((p, i) => {
                const x = PLOT.left + i * band;
                const h = (p.value / scale.max) * innerH;
                return (
                  <g
                    key={p.key}
                    tabIndex={0}
                    className="chart-column"
                    aria-label={`${p.title}: ${p.value} ${valueLabel}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  >
                    <rect x={x} y={PLOT.top} width={band} height={innerH} fill="transparent" />
                    {p.value > 0 && (
                      <path
                        d={columnPath(x + (band - barW) / 2, y(p.value), barW, h)}
                        fill={color}
                        opacity={active === null || active === i ? 1 : 0.55}
                      />
                    )}
                    {i % labelEvery === 0 && (
                      <text x={x + band / 2} y={HEIGHT - 8} textAnchor="middle" className="chart-tick">
                        {p.label}
                      </text>
                    )}
                  </g>
                );
              })}
              <line x1={PLOT.left} x2={width - PLOT.right} y1={y(0)} y2={y(0)} className="chart-axis" />
            </svg>
          )}
          {activePoint && (
            <div
              className="chart-tooltip"
              style={{ left: Math.min(Math.max(PLOT.left + (active + 0.5) * band, 60), width - 60), top: y(activePoint.value) - 8 }}
              role="status"
            >
              <strong>{activePoint.value}</strong> <span className="muted">{valueLabel}</span>
              <div className="muted small">{activePoint.title}</div>
            </div>
          )}
        </div>
      )}
      <details className="chart-table">
        <summary>Show data table</summary>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col" className="num">
                  {valueLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key}>
                  <td>{p.title}</td>
                  <td className="num">{p.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Horizontal bars for a breakdown: label, bar (share of the largest), count and percent. */
export function BarList({ title, items, total, caption }) {
  const max = Math.max(...items.map((i) => i.count), 0);
  return (
    <div className="bar-list">
      <h3 className="chart-title">{title}</h3>
      <table className="bar-table">
        <caption className="sr-only">{caption}</caption>
        <tbody>
          {items.map((item) => (
            <tr key={item.value}>
              <th scope="row">{item.value}</th>
              <td className="bar-cell" aria-hidden="true">
                {item.count > 0 && <span className="bar-fill" style={{ width: `${(item.count / max) * 100}%` }} />}
              </td>
              <td className="num">
                {item.count}
                <span className="muted small"> {total > 0 ? `· ${item.percent}%` : ''}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
