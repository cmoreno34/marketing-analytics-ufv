/* Live price session — the lecturer's page (module 8).
 *
 * Set a product and a starting price, project the code, and the class answers
 * yes or no on their phones to prices around it (#/join). The pooled answers
 * open straight in the Elasticity Lab, refreshing while the class answers.
 *
 * No server: the session is an ntfy.sh topic (see src/lib/live.js), the same
 * way projective-live works. This browser keeps its own copy of every answer
 * it sees, so the data outlives ntfy's twelve-hour memory. */

import { useState, useEffect, useMemo } from "react";
import QRCode from "qrcode";
import { C, inp } from "../theme.js";
import { Section, Callout, Stat, Table, Field, Chip, Spinner } from "../components/UI.jsx";
import { priceGrid } from "../lib/elasticity.js";
import {
  makeConfig, newCode, publish, encodeConfig, loadSession, mergeWithCache,
  hostSessions, saveHostSession, forgetHostSession,
} from "../lib/live.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const PRESETS = {
  coffee: {
    product: "Coffee to go (regular latte)", description: "From the kiosk at the university entrance, ready in two minutes.",
    currency: "€", start: 2.5, rangePct: 40, levels: 7, offersEach: 7,
    factors: [{ name: "weather", kind: "scenario", question: "Imagine it is", levels: "a cold rainy morning, a warm sunny morning" }],
  },
  cinema: {
    product: "Cinema ticket, Friday evening", description: "A new release, standard screen, booked online.",
    currency: "€", start: 9, rangePct: 45, levels: 7, offersEach: 7,
    factors: [{ name: "profile", kind: "profile", question: "Which describes you best?", levels: "student, working" }],
  },
  blank: {
    product: "", description: "", currency: "€", start: 10, rangePct: 30, levels: 7, offersEach: 7, factors: [],
  },
};


export default function PriceSession() {
  const [form, setForm] = useState(PRESETS.coffee);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mine, setMine] = useState(hostSessions);
  const [active, setActive] = useState(() => hostSessions()[0]?.code ?? null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setFactor = (i, k, v) => setForm((f) => ({ ...f, factors: f.factors.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const grid = useMemo(() => priceGrid(Number(form.start) || 0, Number(form.rangePct) || 0, Math.max(2, Number(form.levels) || 2)), [form]);

  const create = async () => {
    setBusy(true);
    setErr("");
    try {
      const config = makeConfig(form);
      if (typeof config === "string") throw new Error(config);
      const code = newCode();
      await publish(code, { t: "cfg", cfg: config });
      setMine(saveHostSession({ code, product: config.product, config, created: Date.now(), responses: [], open: true }));
      setActive(code);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const session = mine.find((m) => m.code === active);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "34px 22px 90px" }}>
        <a href="#/elasticity" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← Elasticity Lab</a>
        <h1 style={{ fontSize: 25, margin: "12px 0 7px", fontWeight: 600 }}>Live price session</h1>
        <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.7, maxWidth: 680, margin: "0 0 24px" }}>
          The class becomes the market. Each student is offered your product at prices a little above and below the
          starting price, in random order, and answers yes or no. Every answer lands in one pool; the share who say yes
          at each price is the demand curve, and its slope in logs is the elasticity.
        </p>

        {session && <Live key={session.code} session={session} onForget={() => {
          const next = forgetHostSession(session.code);
          setMine(next); setActive(next[0]?.code ?? null);
        }} />}

        <Section title={session ? "Start another session" : "1 · Set up the session"}
          right={<div style={{ display: "flex", gap: 5 }}>
            <Chip onClick={() => setForm(PRESETS.coffee)}>coffee + weather</Chip>
            <Chip onClick={() => setForm(PRESETS.cinema)}>cinema + profile</Chip>
            <Chip onClick={() => setForm(PRESETS.blank)}>blank</Chip>
          </div>}>
          <div style={{ display: "grid", gap: 11, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
            <Field label="product"><input value={form.product} onChange={(e) => set("product", e.target.value)} style={inp} /></Field>
            <Field label="currency"><input value={form.currency} onChange={(e) => set("currency", e.target.value)} style={inp} maxLength={4} /></Field>
            <Field label="starting price"><input value={form.start} onChange={(e) => set("start", e.target.value)} style={inp} inputMode="decimal" /></Field>
            <Field label="range ± %" hint="how far above and below the start"><input value={form.rangePct} onChange={(e) => set("rangePct", e.target.value)} style={inp} inputMode="decimal" /></Field>
            <Field label="price levels"><input value={form.levels} onChange={(e) => set("levels", e.target.value)} style={inp} inputMode="numeric" /></Field>
            <Field label="offers per student"><input value={form.offersEach} onChange={(e) => set("offersEach", e.target.value)} style={inp} inputMode="numeric" /></Field>
          </div>
          <div style={{ marginTop: 11 }}>
            <Field label="description the students see"><input value={form.description} onChange={(e) => set("description", e.target.value)} style={inp} /></Field>
          </div>
          <p style={{ fontSize: 12, color: C.mut, margin: "11px 0 0", fontFamily: MONO }}>
            prices offered: {grid.map((p) => `${p}`).join(" · ")} {form.currency}
          </p>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
              categories — each gets its own elasticity in the lab (up to 3)
            </div>
            {form.factors.map((f, i) => (
              <div key={i} style={{ display: "grid", gap: 8, gridTemplateColumns: "120px 150px 1fr 1.3fr 30px", marginBottom: 7, alignItems: "end" }}>
                <Field label="name"><input value={f.name} onChange={(e) => setFactor(i, "name", e.target.value.replace(/\s+/g, "_"))} style={inp} /></Field>
                <Field label="type">
                  <select value={f.kind} onChange={(e) => setFactor(i, "kind", e.target.value)} style={inp}>
                    <option value="scenario">situation (random per offer)</option>
                    <option value="profile">about the student (asked once)</option>
                  </select>
                </Field>
                <Field label={f.kind === "profile" ? "question" : "lead-in"}><input value={f.question} onChange={(e) => setFactor(i, "question", e.target.value)} style={inp} /></Field>
                <Field label="levels, comma-separated"><input value={f.levels} onChange={(e) => setFactor(i, "levels", e.target.value)} style={inp} /></Field>
                <button onClick={() => set("factors", form.factors.filter((_, j) => j !== i))} style={{ ...ghost, padding: "6px 8px" }}>×</button>
              </div>
            ))}
            {form.factors.length < 3 && (
              <button onClick={() => set("factors", [...form.factors, { name: `factor${form.factors.length + 1}`, kind: "scenario", question: "", levels: "" }])} style={ghost}>
                + add a category
              </button>
            )}
            <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, margin: "8px 0 0", maxWidth: 720 }}>
              A <strong>situation</strong> is drawn at random for every offer (“imagine it is a rainy morning”), so each
              student answers under several of them — a within-person comparison. A <strong>profile</strong> is asked once
              and splits the class into groups.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
            <button onClick={create} disabled={busy} style={primary}>{busy ? "Creating…" : "Create session"}</button>
            <span style={{ fontSize: 11.5, color: C.mut, maxWidth: 560, lineHeight: 1.55 }}>
              Answers travel through ntfy.sh, a public message service with no account — the same one the projective
              techniques tool uses. They are anonymous, and this browser keeps a copy of all of them.
            </span>
          </div>
          {busy && <Spinner label="Opening the session…" />}
          {err && <Callout tone="bad" title="Could not create the session">{err}</Callout>}
        </Section>

        {mine.length > 1 && (
          <Section title="Your earlier sessions on this device">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {mine.map((m) => <Chip key={m.code} active={m.code === active} onClick={() => setActive(m.code)}>{m.code} · {m.product}</Chip>)}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Live({ session, onForget }) {
  const [info, setInfo] = useState({ config: session.config, open: session.open ?? true, n: session.responses?.length ?? 0, people: 0 });
  const [cells, setCells] = useState([]);
  const [qr, setQr] = useState("");
  const [err, setErr] = useState("");
  const joinUrl = `${window.location.origin}${window.location.pathname}#/join?c=${session.code}&s=${encodeConfig(session.config)}`;
  const shortUrl = `${window.location.origin}${window.location.pathname}#/join?c=${session.code}`;

  useEffect(() => {
    // The QR carries only the code, so it stays scannable from the back of a
    // room; the phone reads the settings from the topic.
    QRCode.toDataURL(shortUrl, { margin: 1, width: 300, errorCorrectionLevel: "M", color: { dark: "#0d0f14", light: "#ffffff" } })
      .then(setQr).catch(() => setQr(""));
  }, [shortUrl]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const d = mergeWithCache(session.code, await loadSession(session.code));
        if (!alive || !d.config) return;
        setInfo({ config: d.config, open: d.open, n: d.responses.length, people: new Set(d.responses.map((r) => r.respondent)).size, fromCache: d.fromCache });
        const by = new Map(d.config.grid.map((p) => [p, { p, n: 0, yes: 0 }]));
        for (const r of d.responses) { const c = by.get(r.price); if (c) { c.n++; c.yes += r.accept; } }
        setCells([...by.values()]);
        setErr("");
      } catch (e) { if (alive) setErr(e.message); }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [session.code]);

  const toggle = async () => {
    try {
      await publish(session.code, { t: "ctrl", open: !info.open });
      setInfo((i) => ({ ...i, open: !i.open }));
    } catch (e) { setErr(e.message); }
  };

  const yes = cells.reduce((s, c) => s + c.yes, 0);
  return (
    <Section title={`Session ${session.code} — ${session.product}`}
      right={<span style={{ fontSize: 12, color: info.open ? C.good : C.mut }}>{info.open ? "● taking answers" : "closed"}</span>}>
      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", alignItems: "start" }}>
        <div style={{ textAlign: "center" }}>
          {qr && <img src={qr} alt="QR code to join" style={{ width: "100%", maxWidth: 280, borderRadius: 8, background: "#fff" }} />}
          <div style={{ fontFamily: MONO, fontSize: 36, letterSpacing: 6, fontWeight: 700, marginTop: 8 }}>{session.code}</div>
          <div style={{ fontSize: 11.5, color: C.mut, wordBreak: "break-all", marginTop: 4 }}>{shortUrl}</div>
        </div>
        <div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <Stat label="students" value={info.people} />
            <Stat label="answers" value={info.n} />
            <Stat label="yes overall" value={info.n ? `${((yes / info.n) * 100).toFixed(0)}%` : "—"} />
          </div>
          <Table head={["price", "offers", "yes", "share yes"]}
            rows={cells.map((c) => [`${c.p} ${info.config?.currency ?? ""}`, c.n, c.yes, c.n ? `${((c.yes / c.n) * 100).toFixed(0)}%` : "—"])} maxHeight={300} />
          <p style={{ fontSize: 11.5, color: C.mut, margin: "8px 0 0", lineHeight: 1.55 }}>
            Each student’s answers arrive together when they finish their offers.
            {info.fromCache && " The message service has forgotten this session; these are the answers this browser saved."}
          </p>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 12 }}>
            <a href={`#/elasticity?session=${session.code}&live=1`} style={{ ...primary, textDecoration: "none" }}>Analyse in the Elasticity Lab →</a>
            <button onClick={toggle} style={ghost}>{info.open ? "Close the session" : "Reopen"}</button>
            <button onClick={() => navigator.clipboard?.writeText(joinUrl)} style={ghost}>Copy join link</button>
            <button onClick={onForget} style={{ ...ghost, color: C.mut }}>Forget on this device</button>
          </div>
          {err && <Callout tone="bad">{err}</Callout>}
        </div>
      </div>
    </Section>
  );
}

const primary = { background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6, padding: "8px 15px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "inline-block" };
const ghost = { background: C.card, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6, padding: "7px 13px", fontSize: 12.5, cursor: "pointer" };
