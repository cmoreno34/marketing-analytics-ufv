/* Charts for the recommender labs: learning curves over iterations and
 * horizontal bars (a user's profile, a ranking). Same house rules as
 * Charts.jsx: one y-axis per chart, recessive grid, 2px lines, a hover
 * readout, and a legend in words so colour is never the only channel. */

import { useCallback } from "react";
import { C } from "../theme.js";
import { Chart, axes, niceTicks, fmt, FONT } from "./Charts.jsx";

const PAD = { l: 58, r: 16, t: 14, b: 36 };

/* series: [{ key, label, color, dash }] over rows of `data` keyed by xKey. */
export function Curves({ data, series, xKey = "iter", xLabel = "iteration", yLabel, height = 220, captureId, logY = false }) {
  const live = series.filter((s) => data.some((d) => Number.isFinite(d[s.key])));
  const draw = useCallback((ctx, w, h, hover) => {
    if (!data.length || !live.length) return;
    const tf = (v) => (logY ? Math.log10(Math.max(v, 1e-12)) : v);
    const xs = data.map((d) => d[xKey]);
    const ys = data.flatMap((d) => live.map((s) => d[s.key])).filter(Number.isFinite).map(tf);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (y1 === y0) { y1 += 1; y0 -= 1; }
    const py = (y1 - y0) * 0.08;
    y0 -= py; y1 += py;
    if (!logY && y0 < 0 && Math.min(...ys) >= 0) y0 = 0;
    const tx = (v) => PAD.l + ((v - x0) / (x1 - x0 || 1)) * (w - PAD.l - PAD.r);
    const ty = (v) => h - PAD.b - ((tf(v) - y0) / (y1 - y0)) * (h - PAD.t - PAD.b);
    const yt = logY
      ? niceTicks(y0, y1).map((e) => ({ y: h - PAD.b - ((e - y0) / (y1 - y0)) * (h - PAD.t - PAD.b), label: fmt(10 ** e) }))
      : niceTicks(y0, y1).map((v) => ({ y: ty(v), label: fmt(v) }));
    axes(ctx, w, h, PAD, {
      xLabel, yLabel, yTicks: yt,
      xTicks: niceTicks(x0, x1, 5).map((v) => ({ x: tx(v), label: Number.isInteger(v) ? String(v) : fmt(v) })),
    });
    for (const s of live) {
      ctx.beginPath();
      let started = false;
      data.forEach((d) => {
        if (!Number.isFinite(d[s.key])) return;
        const X = tx(d[xKey]), Y = ty(d[s.key]);
        if (started) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); started = true; }
      });
      ctx.setLineDash(s.dash ? [5, 4] : []);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (hover) {
      ctx.strokeStyle = "rgba(255,255,255,.18)";
      ctx.beginPath();
      ctx.moveTo(tx(hover[xKey]), PAD.t);
      ctx.lineTo(tx(hover[xKey]), h - PAD.b);
      ctx.stroke();
    }
  }, [data, live, xKey, xLabel, yLabel, logY]);

  const hitTest = useCallback((mx, my, w) => {
    if (!data.length) return null;
    const xs = data.map((d) => d[xKey]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const xv = x0 + ((mx - PAD.l) / (w - PAD.l - PAD.r)) * (x1 - x0);
    const d = data.reduce((b, r) => (Math.abs(r[xKey] - xv) < Math.abs(b[xKey] - xv) ? r : b), data[0]);
    return { ...d, px: mx, py: my };
  }, [data, xKey]);

  return (
    <div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", font: FONT, color: C.mut, marginBottom: 4 }}>
        {live.map((s) => (
          <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 18, height: 0, borderTop: `2px ${s.dash ? "dashed" : "solid"} ${s.color}` }} />{s.label}
          </span>
        ))}
      </div>
      <Chart height={height} draw={draw} hitTest={hitTest} captureId={captureId}
        tooltip={(hv) => <>{xLabel} {hv[xKey]}{live.map((s) => <div key={s.key}>{s.label}: {Number.isFinite(hv[s.key]) ? hv[s.key].toFixed(4) : "—"}</div>)}</>} />
    </div>
  );
}

/* Horizontal bars, signed values allowed (a profile can dislike a genre). */
export function HBars({ items, height, captureId, format = (v) => v.toFixed(3) }) {
  const H = height ?? 26 + items.length * 26;
  const draw = useCallback((ctx, w, h) => {
    if (!items.length) return;
    const left = 150, right = 60;
    const vals = items.map((d) => d.value);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const span = hi - lo || 1;
    const tx = (v) => left + ((v - lo) / span) * (w - left - right);
    ctx.font = FONT;
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.beginPath();
    ctx.moveTo(tx(0), 6);
    ctx.lineTo(tx(0), h - 6);
    ctx.stroke();
    items.forEach((d, i) => {
      const y = 12 + i * 26;
      ctx.fillStyle = d.color ?? (d.value >= 0 ? C.acc : C.bad);
      const a = tx(Math.min(0, d.value)), b = tx(Math.max(0, d.value));
      ctx.fillRect(a, y, Math.max(1, b - a), 16);
      ctx.fillStyle = C.txt;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(d.label.length > 22 ? d.label.slice(0, 21) + "…" : d.label, left - 8, y + 8);
      // Negative values are labelled on the other side of the zero line, so
      // the label never runs into the category name on the left.
      ctx.textAlign = "left";
      ctx.fillStyle = C.mut;
      ctx.fillText(format(d.value), (d.value >= 0 ? b : tx(0)) + 5, y + 8);
    });
  }, [items, format]);
  return <Chart height={H} draw={draw} captureId={captureId} />;
}
