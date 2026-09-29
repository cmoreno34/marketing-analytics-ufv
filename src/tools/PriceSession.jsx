/* Live price room — the lecturer's page (module 8).
 *
 *   1 Create the scenario: a product, a base price, how far prices vary around
 *     it, and optionally a situation (it is raining / it is not).
 *   2 Open the room: the class joins with the QR code.
 *   3 The room forms groups (5 students by default). Each group gets one price
 *     and one situation; each student answers “I would buy it” or not, then
 *     moves to a new group with another price, for several rounds.
 *   4 Each full group is one point: its share of yes answers is the demand at
 *     that price. The log-log line and the elasticity update as groups close.
 *
 * The room lives on the course server (worker/src/room.ts); the key that
 * controls it is kept in this browser. */
import { useState, useEffect, useMemo, useRef } from "react";
import QRCode from "qrcode";
import { C, inp } from "../theme.js";
import { Section, Callout, Stat, Table, Field, Chip, Spinner } from "../components/UI.jsx";
import { LogLogChart, groupsFromFit } from "../components/ElasticityCharts.jsx";
import { priceGrid, fitElasticity } from "../lib/elasticity.js";
import { createRoom, connectRoom, groupRows, myRooms, saveRoom, forgetRoom } from "../lib/room.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const TEMPLATES = {
  umbrella: {
    label: "Umbrella + rain",
    product: "Folding umbrella", description: "Compact, fits in a bag, sold at the kiosk by the metro exit.",
    currency: "€", base: 8, rangePct: 50, levels: 7, groupSize: 5, rounds: 5,
    situation: { name: "weather", question: "As you come out of the metro,", levels: "it is raining, it is not raining" },
  },
  coffee: {
    label: "Coffee + time of day",
    product: "Coffee to go (regular latte)", description: "From the kiosk at the university entrance, ready in two minutes.",
    currency: "€", base: 2.5, rangePct: 40, levels: 7, groupSize: 5, rounds: 5,
    situation: { name: "moment", question: "It is", levels: "8:30 before your first class, 17:00 after your last class" },
  },
  concert: {
    label: "Concert ticket (no situation)",
    product: "Ticket for a well-known band's concert in Madrid", description: "Standing, general admission, in six weeks.",
    currency: "€", base: 60, rangePct: 50, levels: 7, groupSize: 5, rounds: 4, situation: null,
  },
  blank: {
    label: "Blank — your own",
    product: "", description: "", currency: "€", base: 10, rangePct: 40, levels: 7, groupSize: 5, rounds: 5, situation: null,
  },
};

export default function PriceSession() {
  const [form, setForm] = useState(TEMPLATES.umbrella);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rooms, setRooms] = useState(myRooms);
  const [active, setActive] = useState(() => myRooms()[0]?.code ?? null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setSit = (k, v) => setForm((f) => ({ ...f, situation: { ...(f.situation || { name: "situation", question: "", levels: "" }), [k]: v } }));
  const grid = useMemo(() => priceGrid(Number(form.base) || 0, Number(form.rangePct) || 0, Math.max(3, Number(form.levels) || 3)), [form]);
  const room = rooms.find((r) => r.code === active);

  const create = async () => {
    setBusy(true); setErr("");
    try {
      const config = {
        ...form, base: Number(form.base), rangePct: Number(form.rangePct), levels: Number(form.levels),
        groupSize: Number(form.groupSize), rounds: Number(form.rounds),
        situation: form.situation ? { ...form.situation, levels: String(form.situation.levels).split(",").map((s) => s.trim()).filter(Boolean) } : null,
      };
      const r = await createRoom(config);
      setRooms(saveRoom({ code: r.code, hostKey: r.hostKey, product: r.config.product, created: Date.now() }));
      setActive(r.code);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 1060, margin: "0 auto", padding: "34px 22px 90px" }}>
        <a href="#/elasticity" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← Elasticity Lab</a>
        <h1 style={{ fontSize: 25, margin: "12px 0 7px", fontWeight: 600 }}>Live price room</h1>
        <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.7, maxWidth: 720, margin: "0 0 10px" }}>
          The class becomes the market, and the demand curve is built in front of them.
        </p>
        <ol style={{ color: C.txt, fontSize: 13, lineHeight: 1.75, maxWidth: 760, margin: "0 0 24px", paddingLeft: 20 }}>
          <li><strong>Create the scenario</strong> below: the product, its base price and how far prices vary around it — and, if you want two demand curves, a situation (raining / not raining).</li>
          <li><strong>Open the room</strong> and project the QR code. Students join on their phones.</li>
          <li>The room puts students in <strong>groups</strong> ({form.groupSize || 5} by default). Each group is offered <strong>one price</strong> (and one situation); each student answers “I would buy it” or not, then joins a new group with another price, for several rounds.</li>
          <li>Each full group is <strong>one point</strong>: its share of yes answers is the demand at that price. The log-log line and the <strong>elasticity</strong> update live, one line per situation.</li>
        </ol>

        {room && <Room key={room.code} room={room} onForget={() => { const n = forgetRoom(room.code); setRooms(n); setActive(n[0]?.code ?? null); }} />}

        <Section title={room ? "Create another scenario" : "1 · Create the scenario"}
          right={<div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{Object.entries(TEMPLATES).map(([k, t]) => <Chip key={k} onClick={() => setForm(t)}>{t.label}</Chip>)}</div>}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <Field label="product" hint="What students are asked to buy."><input value={form.product} onChange={(e) => set("product", e.target.value)} style={inp} /></Field>
            <Field label="base price" hint="The centre of the prices offered."><input value={form.base} onChange={(e) => set("base", e.target.value)} style={inp} inputMode="decimal" /></Field>
            <Field label="variation ± %" hint="How far below and above the base price offers go."><input value={form.rangePct} onChange={(e) => set("rangePct", e.target.value)} style={inp} inputMode="decimal" /></Field>
            <Field label="number of prices" hint="Evenly spaced across the range."><input value={form.levels} onChange={(e) => set("levels", e.target.value)} style={inp} inputMode="numeric" /></Field>
            <Field label="students per group" hint="Each group gives one point: its share of yes. 5 is enough in class."><input value={form.groupSize} onChange={(e) => set("groupSize", e.target.value)} style={inp} inputMode="numeric" /></Field>
            <Field label="rounds per student" hint="How many offers each student answers, each at a new price."><input value={form.rounds} onChange={(e) => set("rounds", e.target.value)} style={inp} inputMode="numeric" /></Field>
            <Field label="currency"><input value={form.currency} onChange={(e) => set("currency", e.target.value)} style={inp} maxLength={4} /></Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="description students see" hint="Enough context to decide: where, when, what it is."><input value={form.description} onChange={(e) => set("description", e.target.value)} style={inp} /></Field>
          </div>
          <p style={{ fontSize: 12, color: C.mut, margin: "10px 0 0", fontFamily: MONO }}>prices offered: {grid.join(" · ")} {form.currency}</p>

          <div style={{ marginTop: 16, padding: 12, border: `1px solid ${C.bord}`, borderRadius: 8, background: C.surf }}>
            <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={!!form.situation} onChange={(e) => set("situation", e.target.checked ? { name: "situation", question: "Imagine that", levels: "" } : null)} />
              <strong>A situation that changes demand</strong> — a categorical variable, one demand curve per level
            </label>
            {form.situation && (
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "140px 1fr 1.4fr", marginTop: 10 }}>
                <Field label="name"><input value={form.situation.name} onChange={(e) => setSit("name", e.target.value.replace(/\s+/g, "_"))} style={inp} /></Field>
                <Field label="lead-in" hint="Shown before the level: “As you come out of the metro, it is raining.”"><input value={form.situation.question} onChange={(e) => setSit("question", e.target.value)} style={inp} /></Field>
                <Field label="levels, comma-separated" hint="Each group gets one level; each level gets its own line and elasticity."><input value={form.situation.levels} onChange={(e) => setSit("levels", e.target.value)} style={inp} /></Field>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
            <button onClick={create} disabled={busy} style={primary}>{busy ? "Opening…" : "Open the room"}</button>
            <span style={{ fontSize: 12, color: C.mut }}>
              With 50 students × {form.rounds || 5} rounds ÷ {form.groupSize || 5} per group ≈ <strong>{Math.floor((50 * (Number(form.rounds) || 5)) / (Number(form.groupSize) || 5))}</strong> points on the curve.
            </span>
          </div>
          {busy && <Spinner label="Opening the room…" />}
          {err && <Callout tone="bad" title="Could not open the room">{err}</Callout>}
        </Section>

        {rooms.length > 1 && (
          <Section title="Your earlier rooms on this device">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {rooms.map((r) => <Chip key={r.code} active={r.code === active} onClick={() => setActive(r.code)}>{r.code} · {r.product}</Chip>)}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Room({ room, onForget }) {
  const [state, setState] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [qr, setQr] = useState("");
  const [err, setErr] = useState("");
  const conn = useRef(null);
  const joinUrl = `${window.location.origin}${window.location.pathname}#/join?c=${room.code}`;

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 300, errorCorrectionLevel: "M", color: { dark: "#0d0f14", light: "#ffffff" } }).then(setQr).catch(() => {});
  }, [joinUrl]);

  useEffect(() => {
    const c = connectRoom(room.code, { role: "host", key: room.hostKey }, {
      onStatus: setStatus,
      onMessage: (m) => {
        if (m.t === "state") setState(m);
        else if (m.t === "count") setState((s) => s && { ...s, ...m });
        else if (m.t === "open") setState((s) => s && { ...s, open: m.open });
        else if (m.t === "group") setState((s) => s && { ...s, ...m, groups: [...s.groups.filter((g) => g.id !== m.group.id), m.group] });
        else if (m.error) setErr(m.error);
      },
    });
    conn.current = c;
    return () => c.close();
  }, [room.code, room.hostKey]);

  const sit = state?.cfg.situation?.name || null;
  const closed = (state?.groups || []).filter((g) => g.closed).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  const fit = useMemo(() => {
    if (!state) return null;
    const rows = groupRows(state.groups, sit);
    if (rows.length < 3) return null;
    try {
      const f = fitElasticity(rows, { price: "price", qty: "share", segment: sit && new Set(rows.map((r) => r[sit])).size > 1 ? sit : null });
      return { f, groups: groupsFromFit(f, true) };
    } catch { return null; }
  }, [state, sit]);

  const cur = state?.cfg.currency || "";
  return (
    <Section title={`Room ${room.code} — ${room.product}`}
      right={<span style={{ fontSize: 12, color: status !== "connected" ? C.warn : state?.open ? C.good : C.mut }}>
        {status !== "connected" ? `● ${status}…` : state?.open ? "● open — taking answers" : "● closed"}</span>}>
      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", alignItems: "start" }}>
        <div style={{ textAlign: "center" }}>
          {qr && <img src={qr} alt="QR code to join" style={{ width: "100%", maxWidth: 260, borderRadius: 8, background: "#fff" }} />}
          <div style={{ fontFamily: MONO, fontSize: 38, letterSpacing: 7, fontWeight: 700, marginTop: 8 }}>{room.code}</div>
          <div style={{ fontSize: 11.5, color: C.mut, wordBreak: "break-all", marginTop: 4 }}>{joinUrl}</div>
        </div>
        <div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <Stat label="connected now" value={state?.connected ?? "—"} />
            <Stat label="answers" value={state?.answers ?? "—"} />
            <Stat label="groups closed" value={state?.closedGroups ?? "—"} hint={state ? `${state.openGroups} filling` : ""} tone="good" />
          </div>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <button onClick={() => conn.current?.send({ t: state?.open ? "close" : "open" })} style={ghost}>{state?.open ? "Pause the room" : "Reopen"}</button>
            <button onClick={() => { if (confirm("Close the room and count the groups that did not fill (with at least 2 answers)?")) conn.current?.send({ t: "finish" }); }} style={ghost}>Finish and include incomplete groups</button>
            <a href={`#/elasticity?room=${room.code}`} style={{ ...primary, textDecoration: "none" }}>Analyse in the Elasticity Lab →</a>
            <button onClick={onForget} style={{ ...ghost, color: C.mut }}>Forget on this device</button>
          </div>
          {err && <Callout tone="bad">{err}</Callout>}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <strong style={{ fontSize: 13 }}>The class demand, in logs</strong>
        <span style={{ fontSize: 12, color: C.mut, marginLeft: 8 }}>each point is a closed group; its slope is the elasticity</span>
        {!fit && <p style={{ fontSize: 12.5, color: C.mut }}>The line appears when three groups have closed{sit ? " (and one line per situation when each has enough groups)" : ""}.</p>}
        {fit && (
          <>
            <LogLogChart groups={fit.groups} priceLabel="price" qtyLabel="share of the group who would buy" height={320} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              {fit.f.bySegment.map((s) => (
                <Stat key={s.level ?? "all"} label={s.level == null ? "elasticity" : `elasticity · ${s.level}`} value={s.eps.toFixed(2)}
                  hint={`95% CI ${s.lo.toFixed(2)} to ${s.hi.toFixed(2)} · ${s.n} groups`} tone={s.eps < -1 ? undefined : "warn"} />
              ))}
              {fit.f.slopeTest && <Stat label="do the situations differ?" value={fit.f.slopeTest.p < 0.05 ? "yes" : "not yet"}
                hint={`F test p = ${fit.f.slopeTest.p < 0.001 ? "< 0.001" : fit.f.slopeTest.p.toFixed(3)}`} tone={fit.f.slopeTest.p < 0.05 ? "good" : "warn"} />}
            </div>
          </>
        )}
      </div>

      {closed.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <strong style={{ fontSize: 13 }}>Closed groups, newest first</strong>
          <Table head={["group", "price", ...(sit ? [sit] : []), "answers", "would buy", "demand (share)"]} maxHeight={260}
            rows={closed.map((g) => [`G${g.id}`, `${g.price} ${cur}`, ...(sit ? [g.level] : []), g.n, g.yes, `${Math.round((g.yes / g.n) * 100)}%${g.yes === 0 ? " *" : ""}`])} />
          <p style={{ fontSize: 11.5, color: C.mut }}>* nobody bought: plotted at half an acceptance so the logarithm exists.</p>
        </div>
      )}
    </Section>
  );
}

const primary = { background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6, padding: "8px 15px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "inline-block" };
const ghost = { background: C.card, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6, padding: "7px 13px", fontSize: 12.5, cursor: "pointer" };
