/* Charts for the Elasticity Lab.
 *
 * Same house rules as Charts.jsx: one y-axis per chart, recessive grid, 2px
 * lines, segment identity carried by colour AND marker shape AND the legend.
 * The log-log chart is the one the module is about — the straight line whose
 * slope is the elasticity — so it can label its axes either in logs (what the
 * regression sees) or in euros and units on log scales (what a manager reads).
 * Same picture, two vocabularies. */

import { useCallback } from "react";
import { C, clusterStyle } from "../theme.js";
import { Chart, fmt, axes, niceTicks, marker, FONT } from "./Charts.jsx";
import { predictLnQ } from "../lib/elasticity.js";

/* One group per level of the category that has its own elasticity (or one
 * group for everything): the observed points and the fitted line. `offers`
 * marks data built from yes/no answers, whose points carry their counts. */
export function groupsFromFit(fit, offers = false) {
  const { spec } = fit;
  return fit.bySegment.map((s) => {
    const sub = s.level == null ? fit.rows : fit.rows.filter((r) => String(r[spec.segment]) === s.level);
    return {
      label: s.level == null ? "all" : `${spec.segment} = ${s.level}`,
      eps: s.eps,
      points: sub.map((r) => ({
        p: Number(r[spec.price]), q: Number(r[spec.qty]),
        ...(offers ? { n: r.offers, accepts: r.accepts, zeroFixed: r.zeroFixed } : {}),
      })),
      line: { lnQ: (p) => predictLnQ(fit, s.level, p), pMin: s.minPrice, pMax: s.maxPrice },
    };
  });
}

const PAD = { l: 60, r: 18, t: 16, b: 42 };

function frame(xs, ys, w, h, padFrac = 0.06) {
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (!(x1 > x0)) { x0 -= 0.5; x1 += 0.5; }
  if (!(y1 > y0)) { y0 -= 0.5; y1 += 0.5; }
  const mx = (x1 - x0) * padFrac, my = (y1 - y0) * padFrac;
  x0 -= mx; x1 += mx; y0 -= my; y1 += my;
  return {
    x0, x1, y0, y1,
    tx: (v) => PAD.l + ((v - x0) / (x1 - x0)) * (w - PAD.l - PAD.r),
    ty: (v) => h - PAD.b - ((v - y0) / (y1 - y0)) * (h - PAD.t - PAD.b),
  };
}

/* Ticks for a log axis labelled in original units: nice values in euros,
 * placed at their logarithm. */
const logTicks = (lo, hi) => niceTicks(Math.exp(lo), Math.exp(hi), 4).filter((v) => v > 0).map((v) => ({ v: Math.log(v), label: fmt(v) }));
const linTicks = (lo, hi) => niceTicks(lo, hi, 4).map((v) => ({ v, label: fmt(v) }));

export function SegmentLegend({ groups }) {
  if (groups.length < 2) return null;
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", font: FONT, color: C.mut, marginTop: 6 }}>
      {groups.map((g, i) => {
        const st = clusterStyle(i);
        return (
          <span key={g.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{
              width: 10, height: 10, background: st.color, display: "inline-block",
              borderRadius: st.shape === "circle" ? "50%" : st.shape === "square" ? 2 : 0,
              clipPath: st.shape === "triangle" ? "polygon(50% 0,100% 100%,0 100%)" : undefined,
            }} />
            <span style={{ color: C.txt }}>{g.label}</span>
            {g.eps != null && <span>ε = {g.eps.toFixed(2)}</span>}
          </span>
        );
      })}
    </div>
  );
}

/* groups: [{ label, points: [{ p, q, n? }], line: { lnQ: (p) => number, pMin, pMax } }] */
export function LogLogChart({ groups, units = false, priceLabel = "price", qtyLabel = "quantity", height = 360, captureId }) {
  const draw = useCallback((ctx, w, h, hover) => {
    const all = groups.flatMap((g) => g.points);
    if (!all.length) return;
    const xs = all.map((d) => Math.log(d.p)), ys = all.map((d) => Math.log(d.q));
    const f = frame(xs, ys, w, h, 0.08);
    axes(ctx, w, h, PAD, {
      xLabel: units ? `${priceLabel} (log scale)` : `ln(${priceLabel})`,
      yLabel: units ? `${qtyLabel} (log scale)` : `ln(${qtyLabel})`,
      xTicks: (units ? logTicks(f.x0, f.x1) : linTicks(f.x0, f.x1)).map((t) => ({ x: f.tx(t.v), label: t.label })),
      yTicks: (units ? logTicks(f.y0, f.y1) : linTicks(f.y0, f.y1)).map((t) => ({ y: f.ty(t.v), label: t.label })),
    });

    groups.forEach((g, gi) => {
      const st = clusterStyle(gi);
      if (g.line) {
        const a = Math.log(g.line.pMin), b = Math.log(g.line.pMax);
        ctx.beginPath();
        ctx.moveTo(f.tx(a), f.ty(g.line.lnQ(g.line.pMin)));
        ctx.lineTo(f.tx(b), f.ty(g.line.lnQ(g.line.pMax)));
        ctx.strokeStyle = st.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      g.points.forEach((d) => {
        const r = d.n ? Math.min(8, 3 + Math.sqrt(d.n) * 0.7) : 4.2;
        ctx.lineWidth = 2;
        ctx.strokeStyle = C.card;
        marker(ctx, f.tx(Math.log(d.p)), f.ty(Math.log(d.q)), r, st.shape);
        ctx.stroke();
        ctx.fillStyle = st.color + (d.zeroFixed ? "55" : "cc");
        ctx.fill();
      });
    });

    if (hover) {
      ctx.beginPath();
      ctx.arc(f.tx(Math.log(hover.d.p)), f.ty(Math.log(hover.d.q)), 9, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }, [groups, units, priceLabel, qtyLabel]);

  const hitTest = useCallback((mx, my, w, h) => {
    const all = groups.flatMap((g, gi) => g.points.map((d) => ({ d, gi })));
    if (!all.length) return null;
    const f = frame(all.map((a) => Math.log(a.d.p)), all.map((a) => Math.log(a.d.q)), w, h, 0.08);
    let best = null, bd = 150;
    for (const a of all) {
      const dd = (f.tx(Math.log(a.d.p)) - mx) ** 2 + (f.ty(Math.log(a.d.q)) - my) ** 2;
      if (dd < bd) { bd = dd; best = a; }
    }
    return best && { ...best, px: mx, py: my };
  }, [groups]);

  return (
    <div>
      <Chart height={height} draw={draw} hitTest={hitTest} captureId={captureId} tooltip={(hv) => (
        <>
          {groups.length > 1 && <><strong>{groups[hv.gi].label}</strong><br /></>}
          <span style={{ color: C.mut }}>{priceLabel}</span> {fmt(hv.d.p)}<br />
          <span style={{ color: C.mut }}>{qtyLabel}</span> {hv.d.n ? `${(hv.d.q * 100).toFixed(1)}% (${hv.d.accepts}/${hv.d.n})` : fmt(hv.d.q)}<br />
          <span style={{ color: C.mut }}>ln p, ln q</span> {Math.log(hv.d.p).toFixed(3)}, {Math.log(hv.d.q).toFixed(3)}
          {hv.d.zeroFixed && <><br /><span style={{ color: C.warn }}>nobody accepted — plotted at ½ acceptance</span></>}
        </>
      )} />
      <SegmentLegend groups={groups} />
    </div>
  );
}

/* The fitted constant-elasticity curves back in euros and units, with the
 * observed prices shaded: outside the band the curve is an extrapolation. */
export function DemandChart({ groups, priceLabel = "price", qtyLabel = "quantity", height = 280, captureId }) {
  const draw = useCallback((ctx, w, h) => {
    if (!groups.length) return;
    const pts = groups.flatMap((g) => g.points);
    const pMin = Math.min(...groups.map((g) => g.line.pMin)), pMax = Math.max(...groups.map((g) => g.line.pMax));
    const lo = pMin * 0.8, hi = pMax * 1.2;
    const curves = groups.map((g) => Array.from({ length: 80 }, (_, i) => {
      const p = lo + ((hi - lo) * i) / 79;
      return [p, Math.exp(g.line.lnQ(p))];
    }));
    const ys = [...pts.map((d) => d.q), ...curves.flat().map((c) => c[1])];
    const f = frame([lo, hi], [0, Math.max(...ys)], w, h, 0.02);
    axes(ctx, w, h, PAD, {
      xLabel: priceLabel, yLabel: qtyLabel,
      xTicks: linTicks(f.x0, f.x1).map((t) => ({ x: f.tx(t.v), label: t.label })),
      yTicks: linTicks(Math.max(0, f.y0), f.y1).map((t) => ({ y: f.ty(t.v), label: t.label })),
    });
    ctx.fillStyle = "rgba(108,143,255,.06)";
    ctx.fillRect(f.tx(pMin), PAD.t, f.tx(pMax) - f.tx(pMin), h - PAD.t - PAD.b);
    ctx.fillStyle = C.mut;
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("observed prices", (f.tx(pMin) + f.tx(pMax)) / 2, PAD.t + 2);
    groups.forEach((g, gi) => {
      const st = clusterStyle(gi);
      ctx.beginPath();
      curves[gi].forEach(([p, q], i) => (i ? ctx.lineTo(f.tx(p), f.ty(q)) : ctx.moveTo(f.tx(p), f.ty(q))));
      ctx.strokeStyle = st.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      g.points.forEach((d) => {
        marker(ctx, f.tx(d.p), f.ty(d.q), 3.5, st.shape);
        ctx.fillStyle = st.color + "99";
        ctx.fill();
      });
    });
  }, [groups, priceLabel, qtyLabel]);
  return <><Chart height={height} draw={draw} captureId={captureId} /><SegmentLegend groups={groups} /></>;
}

/* curves: [{ label, pts: [[p, profit]], opt }]; observed: [pMin, pMax] */
export function ProfitChart({ curves, observed, cost, current, height = 280, captureId, currency = "€", yLabel = "profit" }) {
  const draw = useCallback((ctx, w, h, hover) => {
    if (!curves.length) return;
    const xs = curves.flatMap((c) => c.pts.map((p) => p[0]));
    const ys = curves.flatMap((c) => c.pts.map((p) => p[1]));
    const f = frame(xs, [0, ...ys], w, h, 0.03);
    axes(ctx, w, h, PAD, {
      xLabel: `price (${currency})`, yLabel,
      xTicks: linTicks(f.x0, f.x1).map((t) => ({ x: f.tx(t.v), label: t.label })),
      yTicks: linTicks(f.y0, f.y1).map((t) => ({ y: f.ty(t.v), label: t.label })),
    });
    if (observed) {
      ctx.fillStyle = "rgba(108,143,255,.06)";
      ctx.fillRect(f.tx(observed[0]), PAD.t, f.tx(observed[1]) - f.tx(observed[0]), h - PAD.t - PAD.b);
    }
    const vline = (x, col, label, dash) => {
      ctx.setLineDash(dash ? [4, 4] : []);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(f.tx(x), PAD.t);
      ctx.lineTo(f.tx(x), h - PAD.b);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      ctx.font = FONT;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(label, f.tx(x) + 4, PAD.t + 14);
    };
    if (cost > 0 && cost >= f.x0) vline(cost, C.bad, "unit cost", true);
    if (current > 0 && current >= f.x0 && current <= f.x1) vline(current, C.mut, "current", true);
    curves.forEach((c, ci) => {
      const st = clusterStyle(ci);
      ctx.beginPath();
      c.pts.forEach(([p, y], i) => (i ? ctx.lineTo(f.tx(p), f.ty(y)) : ctx.moveTo(f.tx(p), f.ty(y))));
      ctx.strokeStyle = st.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (c.opt != null && c.opt >= f.x0 && c.opt <= f.x1) {
        const best = c.pts.reduce((b, p) => (Math.abs(p[0] - c.opt) < Math.abs(b[0] - c.opt) ? p : b), c.pts[0]);
        marker(ctx, f.tx(c.opt), f.ty(best[1]), 6, st.shape);
        ctx.fillStyle = st.color;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = C.txt;
        ctx.font = FONT;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(`P* ${fmt(c.opt)}`, f.tx(c.opt), f.ty(best[1]) - 9);
      }
    });
    if (hover) vline(hover.p, C.txt, "", false);
  }, [curves, observed, cost, current, currency, yLabel]);

  const hitTest = useCallback((mx, my, w, h) => {
    if (!curves.length) return null;
    const xs = curves.flatMap((c) => c.pts.map((p) => p[0]));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), m = (x1 - x0) * 0.03;
    const p = (x0 - m) + ((mx - PAD.l) / (w - PAD.l - PAD.r)) * (x1 - x0 + 2 * m);
    if (p < x0 || p > x1) return null;
    return {
      p, px: mx, py: my,
      vals: curves.map((c) => c.pts.reduce((b, q) => (Math.abs(q[0] - p) < Math.abs(b[0] - p) ? q : b), c.pts[0])[1]),
    };
  }, [curves]);

  return (
    <div>
      <Chart height={height} draw={draw} hitTest={hitTest} captureId={captureId} tooltip={(hv) => (
        <>
          price {fmt(hv.p)} {currency}
          {curves.map((c, i) => <div key={c.label}><span style={{ color: clusterStyle(i).color }}>{c.label}</span> {fmt(hv.vals[i])}</div>)}
        </>
      )} />
      <SegmentLegend groups={curves} />
    </div>
  );
}
