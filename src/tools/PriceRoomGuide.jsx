/* How the live price room works — the lecturer's guide (module 8).
 *
 * What happens in a room, who runs the automatic waves (the lecturer's page),
 * the rules every price grid follows, a simulator that runs a whole room with
 * a virtual class on the real room engine (src/lib/roomSim.js) and compares
 * what the room finds with the true demand, and the conditions for using it
 * with a real class. */
import { useState } from "react";
import { C, inp } from "../theme.js";
import { Section, Callout, Stat, Table, Field, Chip, Spinner } from "../components/UI.jsx";
import { PriceRulesList } from "../components/PriceRules.jsx";
import { simulateRoom } from "../lib/roomSim.js";
import { optimalPrice } from "../lib/elasticity.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");

const PRESETS = {
  above: { label: "The class values it more than the start", mode: "price", base: 8, cost: 3, median: 14, spread: 0.4, noise: 0.1, students: 50, autoWaves: 3, extraWave: true,
    what: "Start at 8 €, but the class's median willingness to pay is 14 €: the grid should climb wave after wave." },
  below: { label: "The class values it less", mode: "price", base: 8, cost: 2, median: 5, spread: 0.4, noise: 0.1, students: 50, autoWaves: 3, extraWave: true,
    what: "Start at 8 €, median 5 €: at the top of the first grid nobody buys, so the grid comes down." },
  wtp: { label: "Two phases (WTP first)", mode: "wtp", base: 8, cost: 3, median: 12, spread: 0.4, noise: 0.1, students: 50, autoWaves: 3, extraWave: true,
    what: "The recommended set-up: phase 1 puts the first grid near the optimum, so the waves only fine-tune." },
  small: { label: "A small class", mode: "wtp", base: 8, cost: 3, median: 12, spread: 0.4, noise: 0.15, students: 15, autoWaves: 2, extraWave: true,
    what: "15 students, 15% careless answers: few points per price — see how wide the elasticity's interval gets." },
};

export default function PriceRoomGuide() {
  const [p, setP] = useState(PRESETS.above);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [res, setRes] = useState(null);
  const [runs, setRuns] = useState(0);
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const num = (k) => Number(p[k]);

  const run = async () => {
    setBusy(true); setRes(null); setMsg("Creating the room…");
    try {
      const r = await simulateRoom({
        mode: p.mode, base: num("base"), cost: num("cost"), median: num("median"), spread: num("spread"), noise: num("noise"),
        students: Math.round(num("students")), autoWaves: Math.round(num("autoWaves")), extraWave: !!p.extraWave, seed: runs + 1, onProgress: setMsg,
      });
      setRes(r); setRuns((n) => n + 1);
    } catch (e) { setMsg(`Could not run: ${e.message}`); }
    setBusy(false);
  };
  const bad = !(num("cost") >= 0 && num("median") > num("cost") && num("spread") > 0.05 && num("spread") <= 1.5 && num("noise") >= 0 && num("noise") <= 0.5
    && num("students") >= 6 && num("students") <= 120 && num("base") > 0);

  const last = res?.waves[res.waves.length - 1];
  const lastP = last?.fit ? optimalPrice(last.fit.eps, num("cost")) : null;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 1060, margin: "0 auto", padding: "34px 22px 90px" }}>
        <a href="#/price-session" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← Live price room</a>
        <h1 style={{ fontSize: 25, margin: "12px 0 7px", fontWeight: 600 }}>How the live price room works</h1>
        <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.7, maxWidth: 760, margin: "0 0 22px" }}>
          What happens in a room, who moves the prices, the rules they follow, a simulator that runs a whole room with a virtual class —
          and what a real class needs for it to work.
        </p>

        <Section title="1 · What happens in a room">
          <ol style={{ fontSize: 13, lineHeight: 1.75, margin: 0, paddingLeft: 20 }}>
            <li><strong>Phase 1 · willingness to pay</strong> (recommended): each student taps the most they would pay. The room computes the optimal price (the WTP Price Optimizer's calculation) and builds the first grid around it.</li>
            <li><strong>Phase 2 · the ladder</strong>: each student answers “I would buy it” or not to every price of the grid, lowest first. Students at the same step form groups of 5; each full group is <strong>one point</strong>: its share of yes is the demand at that price.</li>
            <li><strong>The curve</strong>: the points give the log-log line; its slope is the elasticity.</li>
            <li><strong>Automatic waves</strong>: when the class has climbed the ladder, the room moves the grid to where the answers point and everybody climbs a new ladder. Usually 3 waves.</li>
            <li><strong>One more round around the best price</strong> (a button after the last wave): a final ladder centred on the price the waves found. Its elasticity is measured where the decision is — the range where the constant-elasticity formula holds. On the room page, tick <em>only the last wave</em> to fit it alone.</li>
          </ol>
        </Section>

        <Section title="2 · Who moves the prices: your page">
          <p style={{ fontSize: 13, lineHeight: 1.75, margin: 0 }}>
            There is no server of our own. The answers go to a shared database (Firebase), and <strong>the room page on your computer</strong> —
            the one with the QR code — is what watches the answers, decides when a wave is over and writes the next grid. You do not press
            anything between waves; you only <strong>keep that tab open</strong> while the class answers (minimised or behind the projector
            window is fine; the laptop must not go to sleep).
          </p>
          <ul style={{ fontSize: 12.5, lineHeight: 1.75, color: C.mut, margin: "8px 0 0", paddingLeft: 20 }}>
            <li>If you close it, the students keep answering the current wave — nothing is lost — but the next wave does not start. Open the room again (it is in “Continue an earlier room”) and it carries on by itself.</li>
            <li>Open each room on <strong>one</strong> computer only: two open host pages could both start a wave.</li>
            <li>The phones only need the QR code; they never need to be reopened between waves.</li>
          </ul>
        </Section>

        <Section title="3 · The rules every price grid follows">
          <div style={{ fontSize: 12.5, color: C.mut }}><PriceRulesList /></div>
        </Section>

        <Section title="4 · Try it with a virtual class"
          note="The simulator runs the real room engine — the same code as a live room — with virtual students instead of phones. Each one has a willingness to pay drawn from a log-normal distribution and buys when the price is at or below it; a share of answers is given at random, like students who do not read the offer. Because the true demand is known, you can see how close the room gets to the truth.">
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
            {Object.entries(PRESETS).map(([k, x]) => <Chip key={k} active={p.label === x.label} onClick={() => { setP(x); setRes(null); }}>{x.label}</Chip>)}
          </div>
          {p.what && <Callout tone="info">{p.what}</Callout>}
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
            <Field label="room" hint="Two phases: WTP first. One phase: the grid starts at the starting price.">
              <select value={p.mode} onChange={(e) => set("mode", e.target.value)} style={inp}>
                <option value="wtp">two phases (WTP first)</option><option value="price">one phase (starting price)</option>
              </select>
            </Field>
            {p.mode === "price" && <Field label="starting price" hint="Your first guess."><input value={p.base} onChange={(e) => set("base", e.target.value)} style={inp} inputMode="decimal" /></Field>}
            <Field label="unit cost"><input value={p.cost} onChange={(e) => set("cost", e.target.value)} style={inp} inputMode="decimal" /></Field>
            <Field label="students"><input value={p.students} onChange={(e) => set("students", e.target.value)} style={inp} inputMode="numeric" /></Field>
            <Field label="true median WTP" hint="Half the class would pay this or more."><input value={p.median} onChange={(e) => set("median", e.target.value)} style={inp} inputMode="decimal" /></Field>
            <Field label="spread of WTP" hint="Log-normal σ: 0.2 a homogeneous class, 0.6 a very mixed one."><input value={p.spread} onChange={(e) => set("spread", e.target.value)} style={inp} inputMode="decimal" /></Field>
            <Field label="careless answers" hint="Share answered at random (0.1 = 10%)."><input value={p.noise} onChange={(e) => set("noise", e.target.value)} style={inp} inputMode="decimal" /></Field>
            <Field label="automatic waves">
              <select value={p.autoWaves} onChange={(e) => set("autoWaves", Number(e.target.value))} style={inp}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </Field>
            <Field label="final round" hint="One more round around the best price.">
              <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", paddingTop: 7 }}>
                <input type="checkbox" checked={!!p.extraWave} onChange={(e) => set("extraWave", e.target.checked)} /> add it
              </label>
            </Field>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
            <button onClick={run} disabled={busy || bad} style={primary}>{busy ? "Running…" : res ? "Run again (new class)" : "Run the room"}</button>
            {busy && <Spinner label={msg} />}
            {bad && <span style={{ fontSize: 12, color: C.warn }}>Check the values: the median above the cost, a spread between 0.05 and 1.5, careless answers up to 0.5, 6–120 students.</span>}
          </div>

          {res && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                <Stat label="true optimum" value={`${f2(res.truth.opt)} €`} hint="maximum (P − c) × share of the virtual class" />
                <Stat label="where the room ended" value={`${f2(last.centre)} €`} hint={`${Math.round((last.centre / res.truth.opt - 1) * 100)}% from the true optimum`}
                  tone={Math.abs(last.centre / res.truth.opt - 1) <= 0.12 ? "good" : "warn"} />
                <Stat label={`elasticity · wave ${last.wave}`} value={f2(last.fit?.eps)} hint={last.fit ? `95% CI ${f2(last.fit.lo)} to ${f2(last.fit.hi)}` : "too few groups"} />
                <Stat label="true elasticity there" value={f2(last.trueEps)} hint={`at ${f2(last.centre)} €`} />
                <Stat label="P* from that elasticity" value={lastP ? `${f2(lastP)} €` : "—"} hint={lastP ? "c·ε/(1+ε), last wave only" : "needs ε < −1"} />
              </div>
              <PathChart waves={res.waves} opt={res.truth.opt} />
              <Table head={["wave", "prices offered", "centre", "groups", "share buying at each price", "elasticity (95% CI)", "true ε at centre"]}
                rows={res.waves.map((w) => [
                  `${w.wave}${w.extra ? " · final" : ""}`, w.grid.map(f2).join(" · "), f2(w.centre), w.groups,
                  w.acc.map((a) => `${Math.round(a.share * 100)}%`).join(" · "),
                  w.fit ? `${f2(w.fit.eps)} [${f2(w.fit.lo)}, ${f2(w.fit.hi)}]` : "—", f2(w.trueEps),
                ])} />
              <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.65, marginTop: 10 }}>
                <strong style={{ color: C.txt }}>Why each centre</strong> (decided from the wave before it):
                {res.waves.map((w) => <div key={w.wave}><strong style={{ color: C.txt }}>{w.extra ? "Final round" : `Wave ${w.wave}`} · {f2(w.centre)} €:</strong> {w.reason}.</div>)}
              </div>
              <p style={{ fontSize: 12, color: C.mut, lineHeight: 1.65 }}>
                Each wave's elasticity uses its own real groups only (no seed). Compare the first wave — measured far from the optimum — with the
                final round: the closer the grid is to the optimum, the closer the measured elasticity is to the one that matters for the decision.
                Run it again: a new class gives a different path — that variation is what a real class has too.
              </p>
            </div>
          )}
        </Section>

        <Section title="5 · Conditions for a real class">
          <Table head={["", "what it needs", "why"]}
            rows={[
              ["Your page", "The room page open on one computer for the whole activity, the laptop not asleep.", "It runs the waves (section 2)."],
              ["Students", "15 or more; 30–60 is ideal. Groups of 5 (3 with fewer than 20 students).", "Each price needs 3+ closed groups per wave for the line; with 50 students it gets about 10."],
              ["Phones", "Any phone with a browser, on mobile data or campus Wi-Fi. No app, no login.", "Each student is an anonymous id; nothing personal is stored."],
              ["Capacity", "Up to about 95 phones at once in one room.", "The free Firebase plan allows 100 simultaneous connections."],
              ["Time", "About 3 minutes for phase 1 and 3–4 minutes per wave (7 prices × 1 situation); 3 waves + final round ≈ 15–20 minutes. Each situation level adds a ladder.", "Each answer takes a student a few seconds; the wave ends when all have climbed."],
              ["The scenario", "A realistic unit cost; a WTP scale from well below to well above what anyone would pay; one situation with two levels at most.", "The cost sets the optimum; a short scale caps the answers; every extra level divides the points."],
              ["Latecomers", "They join with the same QR and climb the current wave.", "Their answers count in that wave."],
              ["Slow class", "“Move to wave N now” if time is short.", "Otherwise it waits for 80% and 45 seconds of quiet."],
              ["The decision", "After the waves, “One more round around the best price”, then read the elasticity of that round alone.", "The constant-elasticity formula only holds close to where ε was measured."],
              ["Next case", "“Same case, new room” to repeat it with another group; “New case” to start a different one.", "Each room keeps its own answers for 60 days."],
            ]} />
        </Section>
      </div>
    </div>
  );
}

/* The centre of each wave against the true optimum, with the prices offered. */
function PathChart({ waves, opt }) {
  const W = 640, H = 220, pad = { l: 44, r: 16, t: 14, b: 30 };
  const all = waves.flatMap((w) => w.grid).concat(opt);
  const lo = Math.min(...all) * 0.9, hi = Math.max(...all) * 1.05;
  const x = (i) => pad.l + (waves.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (waves.length - 1));
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block", margin: "4px 0 12px" }}>
      {ticks.map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={C.bord} /><text x={pad.l - 6} y={y(t) + 4} fill={C.mut} fontSize="10" textAnchor="end">{t.toFixed(1)}</text></g>)}
      <line x1={pad.l} x2={W - pad.r} y1={y(opt)} y2={y(opt)} stroke={C.good} strokeDasharray="5 4" />
      <text x={W - pad.r} y={y(opt) - 5} fill={C.good} fontSize="10.5" textAnchor="end">true optimum {opt.toFixed(2)}</text>
      {waves.map((w, i) => w.grid.map((g) => <circle key={`${i}-${g}`} cx={x(i)} cy={y(g)} r="3" fill={C.mut} />))}
      <polyline points={waves.map((w, i) => `${x(i)},${y(w.centre)}`).join(" ")} fill="none" stroke={C.acc} strokeWidth="2" />
      {waves.map((w, i) => <g key={i}><circle cx={x(i)} cy={y(w.centre)} r="5" fill={C.acc} />
        <text x={x(i)} y={H - 10} fill={C.mut} fontSize="10.5" textAnchor="middle">{w.extra ? "final" : `wave ${w.wave}`}</text></g>)}
    </svg>
  );
}

const primary = { background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6, padding: "8px 15px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
