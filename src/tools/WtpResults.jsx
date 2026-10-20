/* WTP results of a live price room — for the lecturer's own screen, not the
 * projector: it shows the prices the class will be offered.
 *
 *   #/price-wtp?room=ABCDE
 *
 * For each situation: the answers on the scale, the demand and profit curves
 * and the optimal price, computed exactly as the WTP Price Optimizer does
 * (src/lib/wtp.js), with the lines to paste into that tool to check it, and
 * the path the price has followed since: the WTP optimum, then each wave the
 * elasticity moved it to.
 */
import { useEffect, useMemo, useState } from "react";
import { C } from "../theme.js";
import { Section, Callout, Stat, Table } from "../components/UI.jsx";
import { SituationCard } from "../components/Situation.jsx";
import { roomData, situationsOf, combosOf, comboKey, isRoomCode } from "../lib/room.js";
import { wtpOptimum, frequencies } from "../lib/wtp.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const OPTIMIZER = "https://cmoreno34.github.io/wtp-pricing-optimizer/";
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");

export default function WtpResults() {
  const code = useMemo(() => (new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("room") || "").toUpperCase(), []);
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!isRoomCode(code)) { setErr("Open this page from the room's “WTP results” link."); return; }
    let stop = false;
    const load = () => roomData(code).then((x) => { if (!stop) { setD(x); setErr(""); } }).catch((e) => !stop && setErr(e.message));
    load();
    const t = setInterval(load, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [code]);

  const cfg = d?.cfg;
  const sits = situationsOf(cfg);
  const scale = cfg?.wtpScale || [];
  const cost = cfg?.cost || 0;
  const cur = cfg?.currency || "€";

  if (err) return <Page><Callout tone="bad">{err}</Callout></Page>;
  if (!d) return <Page><p style={{ color: C.mut }}>Loading room {code}…</p></Page>;
  if (cfg.mode !== "wtp") return <Page><Callout tone="info">Room {code} started at a price the lecturer chose: it has no willingness-to-pay phase.</Callout></Page>;

  const all = Object.values(d.wtp || {}).flat();
  const combos = combosOf(cfg);
  return (
    <Page>
      <h1 style={{ fontSize: 23, margin: "6px 0 4px", fontWeight: 600 }}>Room {code} — willingness to pay</h1>
      <p style={{ color: C.mut, fontSize: 12.5, lineHeight: 1.6, margin: "0 0 14px", maxWidth: 780 }}>
        {cfg.product}. For your own screen: these are the prices phase 2 is built around. Unit cost {f2(cost)} {cur}.
        {d.phase === "wtp" ? " Phase 1 is still open — the numbers update as students answer." : " Phase 2 has started: the WTP optimum was its first centre; the path shows where the elasticity has moved it since."}
        {" "}Same calculation as the <a href={OPTIMIZER} target="_blank" rel="noreferrer" style={{ color: C.acc }}>WTP Price Optimizer</a> (PCHIP demand, 100 price points between the lowest and highest level).
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Stat label="students who answered" value={d.wtpAnswers ?? 0} />
        <Stat label="phase" value={d.phase === "wtp" ? "1 · WTP" : "2 · prices"} tone={d.phase === "wtp" ? undefined : "good"} />
      </div>

      {combos.map((c) => {
        const k = comboKey(c);
        const vals = d.wtp?.[k] || [];
        const fq = frequencies(vals.length ? vals : all, scale);
        const o = wtpOptimum(scale, fq, { vcu: cost });
        const used = cfg.centres?.[k];
        const path = (cfg.path || cfg.waves || []).map((w) => w.centres[k]);
        return (
          <Section key={k || "all"} title={c.length ? c.join(" · ") : "All students"}>
            <div style={{ maxWidth: 520 }}><SituationCard situations={sits} levels={c} size="small" /></div>
            {!vals.length && <Callout tone="warn">Nobody has answered for this situation yet{all.length ? ": the curve uses every answer" : ""}.</Callout>}
            {o && (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                  <Stat label="answers" value={vals.length} />
                  <Stat label="optimal price (WTP)" value={`${f2(o.optPrice)} ${cur}`} tone="good" hint={`${Math.round(o.optShare * 100)}% would buy at it`} />
                  {used != null && <Stat label={`centre now · wave ${cfg.wave ?? 1}`} value={`${f2(used)} ${cur}`} hint={`offers ${f2(cfg.grids?.[k]?.[0])}–${f2(cfg.grids?.[k]?.at(-1))}`} />}
                </div>
                {path.length > 1 && (
                  <p style={{ fontSize: 12.5, margin: "0 0 10px" }}>
                    <span style={{ color: C.mut }}>Price path: </span>
                    {path.map((v, i) => <span key={i}>{i ? " → " : ""}<strong>{f2(v)}</strong></span>)} {cur}
                    <span style={{ color: C.mut }}> (WTP optimum, then each wave the elasticity moved it to)</span>
                  </p>
                )}
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
                  <Curve title="demand: share who would buy" xs={o.xs} ys={o.ys.map((y) => y / 100)} pts={scale.map((p, i) => [p, o.dem[i] / 100])} mark={o.optPrice} fmt={(v) => `${Math.round(v * 100)}%`} />
                  <Curve title={`profit per 100 people: (P − ${f2(cost)}) · demand`} xs={o.xs} ys={o.pr} mark={o.optPrice} fmt={(v) => v.toFixed(0)} />
                </div>
                <div style={{ marginTop: 10, fontSize: 11.5, color: C.mut, lineHeight: 1.7 }}>
                  To check it in the <a href={OPTIMIZER} target="_blank" rel="noreferrer" style={{ color: C.acc }}>WTP Price Optimizer</a>, paste:
                  <Copy label="Price Levels" text={scale.join(",")} />
                  <Copy label="All Market Answers" text={fq.join(",")} />
                  <Copy label="VCu" text={String(cost)} />
                  <span> and leave FC at 0 (fixed cost and market size never move the optimum).</span>
                </div>
              </>
            )}
          </Section>
        );
      })}

      <Section title="Every answer on the scale">
        <Table head={["price", ...combos.map((c) => c.join(" · ") || "answers")]}
          rows={scale.map((p, i) => [`${f2(p)} ${cur}`, ...combos.map((c) => frequencies(d.wtp?.[comboKey(c)] || [], scale)[i])])} maxHeight={360} />
      </Section>
    </Page>
  );
}

function Page({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 1060, margin: "0 auto", padding: "28px 22px 80px" }}>
        <a href="#/price-session" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← Live price room</a>
        {children}
      </div>
    </div>
  );
}

function Copy({ label, text }) {
  const [ok, setOk] = useState(false);
  return (
    <span style={{ display: "inline-flex", gap: 5, alignItems: "center", margin: "0 6px" }}>
      <strong style={{ color: C.txt }}>{label}</strong>
      <code style={{ fontFamily: MONO, fontSize: 11, background: C.surf, padding: "2px 6px", borderRadius: 4, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block", verticalAlign: "middle" }}>{text}</code>
      <button onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}
        style={{ background: "none", border: `1px solid ${C.bord}`, color: C.acc, borderRadius: 4, fontSize: 10.5, cursor: "pointer", padding: "1px 6px" }}>{ok ? "copied" : "copy"}</button>
    </span>
  );
}

/* A small line chart with the optimum marked. */
function Curve({ title, xs, ys, pts = [], mark, fmt }) {
  const W = 460, H = 200, L = 46, R = 12, T = 12, B = 30;
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const all = [...ys, ...pts.map((p) => p[1])];
  const y0 = Math.min(0, ...all), y1 = Math.max(...all) || 1;
  const X = (v) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => x0 + t * (x1 - x0));
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 4 }}>{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", background: C.surf, borderRadius: 7 }} role="img" aria-label={title}>
        {[y0, (y0 + y1) / 2, y1].map((v) => (
          <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke={C.bord} /><text x={L - 5} y={Y(v) + 3} fill={C.mut} fontSize={9.5} textAnchor="end">{fmt(v)}</text></g>
        ))}
        {ticks.map((v) => <text key={v} x={X(v)} y={H - 10} fill={C.mut} fontSize={9.5} textAnchor="middle">{v.toFixed(2)}</text>)}
        <polyline fill="none" stroke={C.acc} strokeWidth={2} points={xs.map((x, i) => `${X(x)},${Y(ys[i])}`).join(" ")} />
        {pts.map(([x, y]) => <circle key={x} cx={X(x)} cy={Y(y)} r={2.6} fill={C.txt} />)}
        <line x1={X(mark)} x2={X(mark)} y1={T} y2={H - B} stroke={C.good} strokeDasharray="4 3" strokeWidth={1.5} />
        <text x={X(mark) + 4} y={T + 10} fill={C.good} fontSize={10}>P* {mark.toFixed(2)}</text>
      </svg>
    </div>
  );
}
