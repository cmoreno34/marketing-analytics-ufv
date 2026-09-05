/* Canvas charts.
 *
 * House rules, applied throughout: one y-axis per chart (WCSS and silhouette
 * are two charts, never two scales on one), recessive grid, 2px data lines,
 * cluster identity carried by colour AND number AND shape, and a hover
 * readout on anything with individual marks. */

import { useRef, useEffect, useState, useCallback } from "react";
import { C, CLUSTER_COLORS, NOISE_COLOR, clusterStyle } from "../theme.js";

const FONT = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
const GRID = "rgba(255,255,255,.05)";

/* Snapshots, by capture id, taken as each chart draws rather than at export
 * time. A worksheet shows one step at a time, so by the time the student
 * reaches the report every earlier chart has been unmounted — reading the live
 * canvas then would return nothing and the report would come out with no
 * figures at all. Keeping the PNG means a chart the student has seen is in the
 * report even though it is no longer on screen. */
const SNAPSHOTS = new Map();

export const snapshot = (id) => SNAPSHOTS.get(id) ?? null;
export const hasSnapshot = (id) => SNAPSHOTS.has(id);
export const clearSnapshots = () => SNAPSHOTS.clear();

/* Handles the device-pixel-ratio dance and gives `draw` a CSS-pixel
 * coordinate system, so nothing downstream has to think about retina. */
export function Chart({ height = 260, draw, hitTest, tooltip, style, captureId }) {
  const ref = useRef(null);
  const boxRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [size, setSize] = useState({ w: 600, h: height });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.max(240, Math.floor(e.contentRect.width));
      setSize((s) => (s.w === w ? s : { w, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    cv.style.width = `${size.w}px`;
    cv.style.height = `${size.h}px`;
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The report renders on white, so paint the card colour in rather than
    // exporting a transparent PNG that would come out invisible.
    ctx.fillStyle = C.card;
    ctx.fillRect(0, 0, size.w, size.h);
    draw(ctx, size.w, size.h, hover);
    // Keep the clean version: a snapshot taken while the mouse is over the
    // chart would bake a highlighted point into the report.
    if (captureId && !hover) {
      try { SNAPSHOTS.set(captureId, cv.toDataURL("image/png")); } catch { /* tainted canvas */ }
    }
  }, [draw, size, hover, captureId]);

  const onMove = useCallback((e) => {
    if (!hitTest) return;
    const r = ref.current.getBoundingClientRect();
    setHover(hitTest(e.clientX - r.left, e.clientY - r.top, size.w, size.h));
  }, [hitTest, size]);

  return (
    <div ref={boxRef} style={{ position: "relative", width: "100%", ...style }}>
      <canvas
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: "block", cursor: hitTest ? "crosshair" : "default" }}
      />
      {hover && tooltip && (
        <div style={{
          position: "absolute", left: Math.min(hover.px + 12, size.w - 190), top: Math.max(4, hover.py - 10),
          background: "#0d0f14ee", border: `1px solid ${C.bord}`, borderRadius: 6,
          padding: "7px 9px", font: FONT, color: C.txt, pointerEvents: "none",
          maxWidth: 190, lineHeight: 1.5, zIndex: 5,
        }}>{tooltip(hover)}</div>
      )}
    </div>
  );
}

function axes(ctx, w, h, pad, { xLabel, yLabel, xTicks, yTicks }) {
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (const t of yTicks) {
    ctx.beginPath();
    ctx.moveTo(pad.l, t.y);
    ctx.lineTo(w - pad.r, t.y);
    ctx.stroke();
  }
  ctx.fillStyle = C.mut;
  ctx.font = FONT;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const t of yTicks) ctx.fillText(t.label, pad.l - 7, t.y);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const t of xTicks) ctx.fillText(t.label, t.x, h - pad.b + 7);
  if (xLabel) {
    ctx.fillStyle = C.mut;
    ctx.fillText(xLabel, (pad.l + w - pad.r) / 2, h - 13);
  }
  if (yLabel) {
    ctx.save();
    ctx.translate(12, (pad.t + h - pad.b) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }
}

const niceTicks = (lo, hi, n = 4) => {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 0.01; v += step) out.push(v);
  return out;
};

const fmt = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
};

/* ── Line chart over k: used for both the elbow (WCSS) and the validation
 * indices. Deliberately one metric per instance. ── */
export function LineOverK({ data, xKey = "k", yKey, selected, onSelect, label, yLabel, invertGood, height = 200, captureId }) {
  const draw = useCallback((ctx, w, h) => {
    if (!data.length) return;
    const pad = { l: 58, r: 16, t: 14, b: 34 };
    const xs = data.map((d) => d[xKey]);
    const ys = data.map((d) => d[yKey]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (y1 === y0) { y1 += 1; y0 -= 1; }
    const padY = (y1 - y0) * 0.12;
    y0 -= padY; y1 += padY;
    const tx = (v) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
    const ty = (v) => h - pad.b - ((v - y0) / (y1 - y0)) * (h - pad.t - pad.b);

    axes(ctx, w, h, pad, {
      xLabel: "number of clusters (k)", yLabel,
      yTicks: niceTicks(y0, y1).map((v) => ({ y: ty(v), label: fmt(v) })),
      xTicks: xs.map((v) => ({ x: tx(v), label: String(v) })),
    });

    // Area under the curve, very low alpha — shape without weight.
    ctx.beginPath();
    ctx.moveTo(tx(xs[0]), h - pad.b);
    data.forEach((d) => ctx.lineTo(tx(d[xKey]), ty(d[yKey])));
    ctx.lineTo(tx(xs[xs.length - 1]), h - pad.b);
    ctx.closePath();
    ctx.fillStyle = "rgba(108,143,255,.07)";
    ctx.fill();

    ctx.beginPath();
    data.forEach((d, i) => (i ? ctx.lineTo(tx(d[xKey]), ty(d[yKey])) : ctx.moveTo(tx(d[xKey]), ty(d[yKey]))));
    ctx.strokeStyle = C.acc;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (selected != null) {
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(108,143,255,.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx(selected), pad.t);
      ctx.lineTo(tx(selected), h - pad.b);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Mark the best k on validation charts, so the recommendation is visible
    // on the chart and not only in prose.
    if (invertGood !== undefined) {
      const bestIdx = ys.reduce((b, v, i) => (invertGood ? v < ys[b] : v > ys[b]) ? i : b, 0);
      const bx = tx(xs[bestIdx]), by = ty(ys[bestIdx]);
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, Math.PI * 2);
      ctx.strokeStyle = C.good;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = C.good;
      ctx.font = FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("best", bx, by - 13);
    }

    data.forEach((d) => {
      const sel = d[xKey] === selected;
      ctx.beginPath();
      ctx.arc(tx(d[xKey]), ty(d[yKey]), sel ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = sel ? "#fff" : C.acc;
      ctx.fill();
      if (sel) { ctx.strokeStyle = C.acc; ctx.lineWidth = 2; ctx.stroke(); }
    });
  }, [data, xKey, yKey, selected, yLabel, invertGood]);

  const hitTest = useCallback((mx, my, w, h) => {
    if (!data.length) return null;
    const pad = { l: 58, r: 16, t: 14, b: 34 };
    const xs = data.map((d) => d[xKey]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const idx = Math.round(((mx - pad.l) / (w - pad.l - pad.r)) * (x1 - x0) + x0) - x0;
    const d = data[Math.max(0, Math.min(data.length - 1, idx))];
    return d ? { ...d, px: mx, py: my } : null;
  }, [data, xKey]);

  return (
    <div>
      {label && <div style={{ font: FONT, color: C.mut, marginBottom: 4 }}>{label}</div>}
      <Chart
        height={height}
        draw={draw}
        captureId={captureId}
        hitTest={hitTest}
        tooltip={(hv) => <>k = {hv[xKey]}<br />{yLabel} = {fmt(hv[yKey])}{onSelect ? <><br /><span style={{ color: C.mut }}>click to use</span></> : null}</>}
      />
      {onSelect && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
          {data.map((d) => (
            <button key={d[xKey]} onClick={() => onSelect(d[xKey])}
              style={{
                background: d[xKey] === selected ? C.acc : C.card, color: d[xKey] === selected ? "#0d0f14" : C.mut,
                border: `1px solid ${d[xKey] === selected ? C.acc : C.bord}`, borderRadius: 4,
                padding: "3px 9px", font: FONT, cursor: "pointer",
              }}>k={d[xKey]}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function marker(ctx, x, y, r, shape) {
  ctx.beginPath();
  if (shape === "square") ctx.rect(x - r, y - r, r * 2, r * 2);
  else if (shape === "triangle") {
    ctx.moveTo(x, y - r * 1.15);
    ctx.lineTo(x + r, y + r * 0.8);
    ctx.lineTo(x - r, y + r * 0.8);
    ctx.closePath();
  } else ctx.arc(x, y, r, 0, Math.PI * 2);
}

/* ── Scatter with centroids ── */
export function Scatter({ points, labels, centroids, xLabel, yLabel, rowNames, height = 340, captureId }) {
  const draw = useCallback((ctx, w, h) => {
    if (!points.length) return;
    const pad = { l: 58, r: 18, t: 16, b: 40 };
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const mx = (x1 - x0) * 0.06 || 1, my = (y1 - y0) * 0.06 || 1;
    const tx = (v) => pad.l + ((v - x0 + mx) / (x1 - x0 + 2 * mx)) * (w - pad.l - pad.r);
    const ty = (v) => h - pad.b - ((v - y0 + my) / (y1 - y0 + 2 * my)) * (h - pad.t - pad.b);

    axes(ctx, w, h, pad, {
      xLabel, yLabel,
      yTicks: niceTicks(y0 - my, y1 + my).map((v) => ({ y: ty(v), label: fmt(v) })),
      xTicks: niceTicks(x0 - mx, x1 + mx).map((v) => ({ x: tx(v), label: fmt(v) })),
    });

    points.forEach((p, i) => {
      const l = labels[i];
      const st = l < 0 ? { color: NOISE_COLOR, shape: "circle" } : clusterStyle(l);
      // 2px surface ring so overlapping points stay countable.
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.card;
      marker(ctx, tx(p[0]), ty(p[1]), l < 0 ? 3 : 4.5, st.shape);
      ctx.stroke();
      ctx.fillStyle = st.color + (l < 0 ? "88" : "cc");
      ctx.fill();
    });

    (centroids ?? []).forEach((c, i) => {
      const st = clusterStyle(i);
      const cx = tx(c[0]), cy = ty(c[1]);
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.fillStyle = "#0d0f14";
      ctx.fill();
      ctx.strokeStyle = st.color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // The number is the point: identity never rests on colour alone.
      ctx.fillStyle = st.color;
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), cx, cy + 0.5);
    });
  }, [points, labels, centroids, xLabel, yLabel]);

  const hitTest = useCallback((mxp, myp, w, h) => {
    if (!points.length) return null;
    const pad = { l: 58, r: 18, t: 16, b: 40 };
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const mx = (x1 - x0) * 0.06 || 1, my = (y1 - y0) * 0.06 || 1;
    const tx = (v) => pad.l + ((v - x0 + mx) / (x1 - x0 + 2 * mx)) * (w - pad.l - pad.r);
    const ty = (v) => h - pad.b - ((v - y0 + my) / (y1 - y0 + 2 * my)) * (h - pad.t - pad.b);
    let best = null, bd = 144;
    points.forEach((p, i) => {
      const d = (tx(p[0]) - mxp) ** 2 + (ty(p[1]) - myp) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best === null ? null : { i: best, px: mxp, py: myp };
  }, [points]);

  return (
    <Chart height={height} draw={draw} captureId={captureId} hitTest={hitTest} tooltip={(hv) => (
      <>
        {rowNames?.[hv.i] && <><strong>{rowNames[hv.i]}</strong><br /></>}
        {labels[hv.i] < 0 ? <span style={{ color: C.warn }}>noise / outlier</span> : `cluster ${labels[hv.i] + 1}`}<br />
        <span style={{ color: C.mut }}>{xLabel}</span> {fmt(points[hv.i][0])}<br />
        <span style={{ color: C.mut }}>{yLabel}</span> {fmt(points[hv.i][1])}
      </>
    )} />
  );
}

/* ── Dendrogram ── */
export function Dendrogram({ layout, n, cutHeight, labels, leafNames, height = 340, captureId }) {
  const draw = useCallback((ctx, w, h) => {
    const { links, order, maxH } = layout;
    if (!links.length) return;
    const showNames = leafNames && n <= 60;
    const pad = { l: 54, r: 14, t: 16, b: showNames ? 86 : 30 };
    const tx = (i) => pad.l + ((i + 0.5) / order.length) * (w - pad.l - pad.r);
    const ty = (v) => h - pad.b - (v / (maxH * 1.05)) * (h - pad.t - pad.b);

    ctx.strokeStyle = GRID;
    const ticks = niceTicks(0, maxH * 1.05);
    ticks.forEach((v) => { ctx.beginPath(); ctx.moveTo(pad.l, ty(v)); ctx.lineTo(w - pad.r, ty(v)); ctx.stroke(); });
    ctx.fillStyle = C.mut;
    ctx.font = FONT;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ticks.forEach((v) => ctx.fillText(fmt(v), pad.l - 6, ty(v)));
    ctx.save();
    ctx.translate(12, (pad.t + h - pad.b) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("merge distance", 0, 0);
    ctx.restore();

    /* Colour a branch by cluster once it sits entirely below the cut, which is
     * what makes the dendrogram and the scatter tell the same story. */
    const clusterOf = (node) => {
      if (node < n) return labels ? labels[node] : -1;
      const row = links[node - n];
      const a = clusterOf(row.left), b = clusterOf(row.right);
      return a === b ? a : -1;
    };

    links.forEach((L) => {
      const cl = cutHeight != null && L.h <= cutHeight ? clusterOf(L.left) : -1;
      const col = cl >= 0 ? clusterStyle(cl).color : "#6a7089";
      ctx.strokeStyle = col;
      ctx.lineWidth = cl >= 0 ? 1.8 : 1.2;
      ctx.beginPath();
      ctx.moveTo(tx(L.xa), ty(L.ha));
      ctx.lineTo(tx(L.xa), ty(L.h));
      ctx.lineTo(tx(L.xb), ty(L.h));
      ctx.lineTo(tx(L.xb), ty(L.hb));
      ctx.stroke();
    });

    if (cutHeight != null) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = C.warn;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pad.l, ty(cutHeight));
      ctx.lineTo(w - pad.r, ty(cutHeight));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.warn;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`cut at ${fmt(cutHeight)}`, pad.l + 4, ty(cutHeight) - 3);
    }

    if (showNames) {
      ctx.save();
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      order.forEach((leaf, i) => {
        const cl = labels ? labels[leaf] : -1;
        ctx.fillStyle = cl >= 0 ? clusterStyle(cl).color : C.mut;
        ctx.save();
        ctx.translate(tx(i), h - pad.b + 6);
        ctx.rotate(-Math.PI / 2.6);
        ctx.fillText(String(leafNames[leaf]).slice(0, 16), 0, 0);
        ctx.restore();
      });
      ctx.restore();
    }
  }, [layout, n, cutHeight, labels, leafNames]);

  return <Chart height={height} draw={draw} captureId={captureId} />;
}

/* ── Silhouette plot: per-point scores, sorted within cluster. The classic
 * diagnostic — a cluster with a short, ragged block is a weak cluster. ── */
export function SilhouettePlot({ perPoint, labels, k, mean, height = 300, captureId }) {
  const draw = useCallback((ctx, w, h) => {
    const groups = Array.from({ length: k }, (_, c) =>
      perPoint.map((s, i) => ({ s, i })).filter((d) => labels[d.i] === c).sort((a, b) => b.s - a.s)
    );
    const total = groups.reduce((n, g) => n + g.length, 0);
    if (!total) return;
    const pad = { l: 62, r: 16, t: 12, b: 34 };
    const gap = 9;
    const rows = total + (k - 1) * 2;
    const rowH = (h - pad.t - pad.b - gap * (k - 1)) / Math.max(1, total);
    const lo = Math.min(0, ...perPoint), hi = Math.max(0.001, ...perPoint);
    const tx = (v) => pad.l + ((v - Math.min(lo, 0)) / (hi - Math.min(lo, 0))) * (w - pad.l - pad.r);

    ctx.strokeStyle = GRID;
    const ticks = niceTicks(Math.min(lo, 0), hi, 5);
    ticks.forEach((v) => { ctx.beginPath(); ctx.moveTo(tx(v), pad.t); ctx.lineTo(tx(v), h - pad.b); ctx.stroke(); });
    ctx.fillStyle = C.mut;
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ticks.forEach((v) => ctx.fillText(v.toFixed(1), tx(v), h - pad.b + 6));
    ctx.fillText("silhouette score", (pad.l + w - pad.r) / 2, h - 14);

    let y = pad.t;
    groups.forEach((g, c) => {
      const st = clusterStyle(c);
      const top = y;
      g.forEach((d) => {
        ctx.fillStyle = st.color + "cc";
        const x = tx(Math.min(0, d.s)), x2 = tx(Math.max(0, d.s));
        ctx.fillRect(x, y, Math.max(0.6, x2 - x), Math.max(0.7, rowH - 0.35));
        y += rowH;
      });
      ctx.fillStyle = st.color;
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(String(c + 1), pad.l - 8, (top + y) / 2);
      ctx.font = FONT;
      ctx.fillStyle = C.mut;
      ctx.fillText(`n=${g.length}`, pad.l - 22, (top + y) / 2);
      y += gap;
    });

    if (mean != null) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = C.warn;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tx(mean), pad.t);
      ctx.lineTo(tx(mean), h - pad.b);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.warn;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`mean ${mean.toFixed(3)}`, tx(mean) + 4, pad.t + 1);
    }
    // A negative score means the point sits closer to another cluster.
    if (Math.min(lo, 0) < 0) {
      ctx.strokeStyle = "rgba(255,255,255,.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx(0), pad.t);
      ctx.lineTo(tx(0), h - pad.b);
      ctx.stroke();
    }
  }, [perPoint, labels, k, mean]);

  return <Chart height={height} draw={draw} captureId={captureId} />;
}

/* ── k-distance curve for choosing DBSCAN's eps ── */
export function KDistance({ values, eps, height = 210, captureId }) {
  const draw = useCallback((ctx, w, h) => {
    if (!values.length) return;
    const pad = { l: 58, r: 16, t: 14, b: 36 };
    const hi = Math.max(...values), lo = Math.min(...values);
    const tx = (i) => pad.l + (i / (values.length - 1 || 1)) * (w - pad.l - pad.r);
    const ty = (v) => h - pad.b - ((v - lo) / (hi - lo || 1)) * (h - pad.t - pad.b);

    axes(ctx, w, h, pad, {
      xLabel: "points, sorted by distance to their k-th neighbour", yLabel: "distance",
      yTicks: niceTicks(lo, hi).map((v) => ({ y: ty(v), label: fmt(v) })),
      xTicks: [],
    });

    ctx.beginPath();
    values.forEach((v, i) => (i ? ctx.lineTo(tx(i), ty(v)) : ctx.moveTo(tx(i), ty(v))));
    ctx.strokeStyle = C.acc;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (eps != null && eps >= lo && eps <= hi) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = C.warn;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pad.l, ty(eps));
      ctx.lineTo(w - pad.r, ty(eps));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.warn;
      ctx.font = FONT;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`eps = ${eps}`, pad.l + 5, ty(eps) - 3);
    }
  }, [values, eps]);

  return <Chart height={height} draw={draw} captureId={captureId} />;
}

/* Legend. Always rendered for two or more clusters, always carrying the
 * number, so the mapping survives a black-and-white printout. */
export function Legend({ k, sizes, noise }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", font: FONT, color: C.mut }}>
      {Array.from({ length: k }, (_, i) => {
        const st = clusterStyle(i);
        return (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{
              width: 10, height: 10, background: st.color, display: "inline-block",
              borderRadius: st.shape === "circle" ? "50%" : st.shape === "square" ? 2 : 0,
              clipPath: st.shape === "triangle" ? "polygon(50% 0,100% 100%,0 100%)" : undefined,
            }} />
            <span style={{ color: C.txt }}>cluster {i + 1}</span>
            {sizes && <span>n={sizes[i]}</span>}
          </span>
        );
      })}
      {noise > 0 && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, background: NOISE_COLOR, borderRadius: "50%", display: "inline-block" }} />
          <span style={{ color: C.txt }}>noise</span><span>n={noise}</span>
        </span>
      )}
    </div>
  );
}

export { fmt };
