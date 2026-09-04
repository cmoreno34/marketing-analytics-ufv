import { C, card, clusterStyle } from "../theme.js";
import { fmt } from "./Charts.jsx";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export function Section({ title, note, right, children, style }) {
  return (
    <section style={{ ...card, marginBottom: 16, ...style }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: note ? 4 : 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 14, margin: 0, fontWeight: 600, color: C.txt }}>{title}</h2>
        <div style={{ marginLeft: "auto" }}>{right}</div>
      </div>
      {note && <p style={{ fontSize: 12, color: C.mut, lineHeight: 1.6, margin: "0 0 13px" }}>{note}</p>}
      {children}
    </section>
  );
}

export function Callout({ tone = "info", title, children }) {
  const col = tone === "warn" ? C.warn : tone === "bad" ? C.bad : tone === "good" ? C.good : C.acc;
  return (
    <div style={{
      background: `${col}12`, border: `1px solid ${col}44`, borderLeft: `3px solid ${col}`,
      borderRadius: 6, padding: "10px 13px", margin: "10px 0", fontSize: 12.5, lineHeight: 1.65, color: C.txt,
    }}>
      {title && <strong style={{ color: col, display: "block", marginBottom: 3 }}>{title}</strong>}
      {children}
    </div>
  );
}

export function Stat({ label, value, hint, tone }) {
  const col = tone === "good" ? C.good : tone === "warn" ? C.warn : tone === "bad" ? C.bad : C.txt;
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 7, padding: "10px 13px", minWidth: 108 }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: col, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {hint && <div style={{ fontSize: 10.5, color: C.mut, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export function Table({ head, rows, firstColStyle, maxHeight = 460 }) {
  return (
    <div style={{ overflowX: "auto", overflowY: rows.length > 16 ? "auto" : "visible", maxHeight, border: `1px solid ${C.bord}`, borderRadius: 7 }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} style={{
                position: "sticky", top: 0, zIndex: 1, background: C.surf, textAlign: i ? "right" : "left",
                padding: "8px 11px", color: C.mut, fontFamily: MONO, fontSize: 10, fontWeight: 500,
                textTransform: "uppercase", letterSpacing: ".7px", borderBottom: `1px solid ${C.bord}`, whiteSpace: "nowrap",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: i ? `1px solid ${C.bord}55` : "none" }}>
              {r.map((cell, j) => (
                <td key={j} style={{
                  padding: "7px 11px", textAlign: j ? "right" : "left", color: j ? C.txt : C.txt,
                  whiteSpace: "nowrap", ...(j === 0 ? firstColStyle : null),
                }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* The centroid table — the artefact the whole module is really about. Numeric
 * columns are cluster means in ORIGINAL units (not z-scores): "income 24,300"
 * can be read by a marketer, "-0.83" cannot. */
export function CentroidTable({ centroids, numCols, catCols, sizes, total, silhouettePerCluster }) {
  const head = ["segment", "n", "share", ...numCols, ...catCols];
  if (silhouettePerCluster) head.push("silhouette");
  const rows = centroids.map((c, i) => {
    const r = [
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span style={{
          width: 9, height: 9, background: clusterStyle(i).color, display: "inline-block",
          borderRadius: clusterStyle(i).shape === "circle" ? "50%" : 2,
        }} />
        <strong>Segment {i + 1}</strong>
      </span>,
      sizes[i],
      `${((sizes[i] / total) * 100).toFixed(1)}%`,
      ...numCols.map((k) => fmt(c[k])),
      ...catCols.map((k) => String(c[k])),
    ];
    if (silhouettePerCluster) {
      const s = silhouettePerCluster[i];
      r.push(<span style={{ color: s < 0.25 ? C.bad : s < 0.5 ? C.warn : C.good }}>{s.toFixed(3)}</span>);
    }
    return r;
  });
  return <Table head={head} rows={rows} />;
}

export function Field({ label, hint, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", display: "block", marginBottom: 5 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 10.5, color: C.mut, display: "block", marginTop: 4, lineHeight: 1.5 }}>{hint}</span>}
    </label>
  );
}

export function Chip({ active, onClick, children, title, disabled }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      style={{
        background: active ? C.acc : C.surf, color: active ? "#0d0f14" : disabled ? C.mut : C.txt,
        border: `1px solid ${active ? C.acc : C.bord}`, borderRadius: 5, padding: "5px 10px",
        fontSize: 11.5, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "system-ui",
        opacity: disabled ? 0.45 : 1, fontWeight: active ? 600 : 400,
      }}>{children}</button>
  );
}

export function Spinner({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, color: C.mut, fontSize: 12 }}>
      <span style={{
        width: 13, height: 13, border: `2px solid ${C.bord}`, borderTopColor: C.acc,
        borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite",
      }} />
      {label}
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}
