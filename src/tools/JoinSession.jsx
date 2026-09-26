/* Live price session — the student's page (#/join?c=CODE). Built for a phone.
 *
 * Each student sees the lecturer's product at a handful of prices from the
 * session grid, in random order, and answers yes or no to each. The answers
 * are sent together, in one message, when the last offer is answered — one
 * message per student is what keeps a whole class on one university IP under
 * ntfy's rate limit. Progress is kept in this browser, so a reload or a locked
 * screen resumes where it left off. Nothing personal is asked or sent. */

import { useState, useEffect, useMemo } from "react";
import { C } from "../theme.js";
import { Callout, Spinner } from "../components/UI.jsx";
import { offerSequence } from "../lib/elasticity.js";
import { isCode, decodeConfig, loadSession, publish } from "../lib/live.js";

const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: progress not kept */ } };

export default function JoinSession() {
  const params = useMemo(() => new URLSearchParams(window.location.hash.split("?")[1] ?? ""), []);
  const initial = (params.get("c") || "").toUpperCase();
  const [code, setCode] = useState(initial);
  const [typed, setTyped] = useState(initial);
  const [cfg, setCfg] = useState(() => (params.get("s") ? decodeConfig(params.get("s")) : null));
  const [open, setOpen] = useState(true);
  const [err, setErr] = useState("");
  const [state, setState] = useState(null); // { rid, offers: [{ price, cats }], answers: [], sent }
  const [sending, setSending] = useState(false);

  // Settings come in the QR link; typed-in codes read them from the topic.
  useEffect(() => {
    if (!isCode(code)) return;
    setErr("");
    setState(load(`join:${code}`));
    loadSession(code).then((d) => {
      if (d.config) setCfg((c) => c ?? d.config);
      else if (!cfg) setErr("There is no session with that code. Check it with your lecturer.");
      setOpen(d.open);
    }).catch((e) => { if (!cfg) setErr(e.message); });
  }, [code]);

  const profileFactors = cfg?.factors.filter((f) => f.kind === "profile") ?? [];
  const scenarioFactors = cfg?.factors.filter((f) => f.kind === "scenario") ?? [];

  const start = (profile) => {
    const rng = Math.random;
    const offers = offerSequence(cfg.grid, cfg.offersEach, rng).map((price) => ({
      price,
      cats: { ...profile, ...Object.fromEntries(scenarioFactors.map((f) => [f.name, f.levels[Math.floor(rng() * f.levels.length)]])) },
    }));
    const s = { rid: `s${Date.now().toString(36)}${Math.floor(rng() * 1e6).toString(36)}`, offers, answers: [], sent: false };
    setState(s);
    save(`join:${code}`, s);
  };

  const send = async (s) => {
    setSending(true);
    setErr("");
    try {
      await publish(code, { t: "ans", rid: s.rid, a: s.offers.map((o, i) => ({ p: o.price, y: s.answers[i] ? 1 : 0, c: o.cats })) });
      const done = { ...s, sent: true };
      setState(done);
      save(`join:${code}`, done);
    } catch (e) {
      setErr(e.message);
    }
    setSending(false);
  };

  const answer = (yes) => {
    const s = { ...state, answers: [...state.answers, yes] };
    setState(s);
    save(`join:${code}`, s);
    if (s.answers.length >= s.offers.length) send(s);
  };

  const wrap = (children) => (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "28px 18px 60px" }}>
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: C.acc, letterSpacing: "2px", marginBottom: 14 }}>
          MARKETING ANALYTICS · PRICE SESSION {code && `· ${code}`}
        </div>
        {children}
        {err && <Callout tone="bad">{err}</Callout>}
      </div>
    </div>
  );

  if (!cfg) {
    return wrap(
      <>
        <h1 style={{ fontSize: 22, margin: "0 0 14px" }}>Join the session</h1>
        <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} maxLength={6} placeholder="CODE"
          style={{ width: "100%", fontSize: 30, letterSpacing: 8, textAlign: "center", padding: 12, borderRadius: 8,
            border: `1px solid ${C.bord}`, background: C.card, color: C.txt, fontFamily: "ui-monospace, monospace" }} />
        <button onClick={() => setCode(typed.trim())} style={{ ...big(C.acc), marginTop: 12 }}>Join</button>
        {isCode(code) && !err && <div style={{ marginTop: 14 }}><Spinner label="Looking for the session…" /></div>}
      </>
    );
  }

  const header = (
    <div style={{ marginBottom: 18 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>{cfg.product}</h1>
      {cfg.description && <p style={{ color: C.mut, fontSize: 14, lineHeight: 1.55, margin: 0 }}>{cfg.description}</p>}
    </div>
  );

  if (!state) {
    if (!open) return wrap(<>{header}<Callout tone="warn">This session is closed.</Callout></>);
    return wrap(
      <>
        {header}
        <p style={{ fontSize: 14, lineHeight: 1.6 }}>
          You will be offered this product {cfg.offersEach} times at different prices. Answer each one on its own, as
          you really would — forget the previous price. There are no right answers; the class curve is only as good as
          your honesty.
        </p>
        <ProfileForm factors={profileFactors} onDone={start} />
      </>
    );
  }

  if (state.answers.length >= state.offers.length) {
    return wrap(
      <>
        {header}
        <div style={{ background: C.card, border: `1px solid ${state.sent ? C.good : C.warn}55`, borderRadius: 10, padding: 20, textAlign: "center" }}>
          {state.sent ? (
            <>
              <div style={{ fontSize: 34 }}>✓</div>
              <div style={{ fontSize: 17, fontWeight: 600, margin: "6px 0" }}>Your {state.offers.length} answers are in</div>
              <div style={{ color: C.mut, fontSize: 13.5, lineHeight: 1.6 }}>Look at the screen: they are now part of the class demand curve.</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>{sending ? "Sending your answers…" : "Your answers have not been sent yet"}</div>
              {sending ? <Spinner label="A whole class is sending at once — this can take a few seconds." />
                : <button onClick={() => send(state)} style={big(C.acc)}>Send my answers</button>}
            </>
          )}
        </div>
      </>
    );
  }

  const o = state.offers[state.answers.length];
  return wrap(
    <>
      {header}
      <div style={{ fontSize: 12, color: C.mut, marginBottom: 8, fontFamily: "ui-monospace, monospace" }}>
        offer {state.answers.length + 1} of {state.offers.length}
      </div>
      <div style={{ height: 4, background: C.bord, borderRadius: 2, marginBottom: 18 }}>
        <div style={{ height: 4, width: `${(state.answers.length / state.offers.length) * 100}%`, background: C.acc, borderRadius: 2 }} />
      </div>
      {scenarioFactors.map((f) => (
        <div key={f.name} style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "11px 14px", marginBottom: 10, fontSize: 15 }}>
          {f.question ? `${f.question} ` : ""}<strong>{o.cats[f.name]}</strong>.
        </div>
      ))}
      <div style={{ textAlign: "center", margin: "22px 0" }}>
        <div style={{ color: C.mut, fontSize: 14 }}>Would you buy it at</div>
        <div style={{ fontSize: 54, fontWeight: 700, fontVariantNumeric: "tabular-nums", margin: "4px 0" }}>
          {o.price.toFixed(2)} <span style={{ fontSize: 30 }}>{cfg.currency}</span>
        </div>
      </div>
      {!open && <Callout tone="warn">The lecturer has closed the session.</Callout>}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
        <button disabled={!open} onClick={() => answer(false)} style={big(C.bad)}>No</button>
        <button disabled={!open} onClick={() => answer(true)} style={big(C.good)}>Yes, I’d buy</button>
      </div>
    </>
  );
}

function ProfileForm({ factors, onDone }) {
  const [vals, setVals] = useState({});
  const ready = factors.every((f) => vals[f.name]);
  return (
    <div>
      {factors.map((f) => (
        <div key={f.name} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 15, marginBottom: 8 }}>{f.question || f.name}</div>
          <div style={{ display: "grid", gap: 8 }}>
            {f.levels.map((l) => (
              <button key={l} onClick={() => setVals((v) => ({ ...v, [f.name]: l }))}
                style={{ ...big(vals[f.name] === l ? C.acc : C.card), color: vals[f.name] === l ? "#0d0f14" : C.txt, border: `1px solid ${C.bord}` }}>{l}</button>
            ))}
          </div>
        </div>
      ))}
      <button disabled={!ready} onClick={() => onDone(vals)} style={{ ...big(C.acc), opacity: ready ? 1 : 0.4, marginTop: 6 }}>Start</button>
    </div>
  );
}

const big = (bg) => ({
  width: "100%", padding: "16px 12px", fontSize: 17, fontWeight: 600, borderRadius: 10, border: "none",
  background: bg, color: "#0d0f14", cursor: "pointer",
});
