/* Live price room — the student's page (#/join?c=CODE). Built for a phone.
 *
 * The room places the student in a group, shows the group's price (and
 * situation), takes the answer, and moves the student to a new group with
 * another price — for the number of rounds the lecturer set. The respondent id
 * is random and kept in this browser, so a reload or a locked screen resumes
 * the same place. Nothing personal is asked or sent. */
import { useState, useEffect, useRef, useMemo } from "react";
import { C } from "../theme.js";
import { Callout, Spinner } from "../components/UI.jsx";
import { connectRoom, isRoomCode, situationsOf } from "../lib/room.js";

const ridFor = (code) => {
  const k = `room:${code}:rid`;
  try {
    let r = localStorage.getItem(k);
    if (!r) { r = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; localStorage.setItem(k, r); }
    return r;
  } catch { return `s${Math.random().toString(36).slice(2, 12)}`; }
};

export default function JoinSession() {
  const initial = useMemo(() => (new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("c") || "").toUpperCase(), []);
  const [code, setCode] = useState(isRoomCode(initial) ? initial : "");
  const [typed, setTyped] = useState(initial);
  const [cfg, setCfg] = useState(null);
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState("idle");
  const [phase, setPhase] = useState("intro");     // intro | offer | sending | waiting | done | closed
  const [offer, setOffer] = useState(null);
  const [me, setMe] = useState(null);
  const [err, setErr] = useState("");
  const conn = useRef(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (!code) return;
    const c = connectRoom(code, { role: "student", rid: ridFor(code) }, {
      onStatus: (s) => {
        setStatus(s);
        // Back after a drop in the middle of a round: ask again; the room
        // returns the same group if the seat is still ours.
        if (s === "connected" && ["offer", "sending", "waiting"].includes(phaseRef.current)) setTimeout(() => c.send({ t: "next" }), 200);
      },
      onMessage: (m) => {
        if (m.t === "hello") {
          setCfg(m.cfg); setOpen(m.open); setMe(m.me);
          if (m.me.done >= m.cfg.rounds) setPhase("done");
          else if (m.me.done > 0) { setPhase("waiting"); c.send({ t: "next" }); }
        } else if (m.t === "offer") { setOffer(m); setPhase("offer"); setErr(""); }
        else if (m.t === "ok") {
          setMe(m.me);
          if (m.me.done >= m.me.rounds) setPhase("done");
          else { setPhase("waiting"); setTimeout(() => c.send({ t: "next" }), 700); }
        } else if (m.t === "finished") { setMe(m.me); setPhase("done"); }
        else if (m.t === "wait") setTimeout(() => c.send({ t: "next" }), 1500);
        else if (m.t === "closed" || (m.t === "open" && !m.open)) { setOpen(false); if (phaseRef.current !== "done") setPhase("closed"); }
        else if (m.t === "rounds") {
          // The lecturer added rounds: a student who had finished carries on.
          setCfg((x) => x && { ...x, rounds: m.rounds });
          setMe((x) => x && { ...x, rounds: m.rounds });
          if (phaseRef.current === "done") { setPhase("waiting"); c.send({ t: "next" }); }
        }
        else if (m.t === "open" && m.open) { setOpen(true); if (phaseRef.current === "closed") { setPhase("waiting"); c.send({ t: "next" }); } }
        else if (m.t === "error") { setErr(m.error); setPhase("waiting"); setTimeout(() => c.send({ t: "next" }), 500); }
      },
    });
    conn.current = c;
    return () => c.close();
  }, [code]);

  const start = () => { setPhase("waiting"); conn.current?.send({ t: "next" }); };
  const answer = (buy) => { setPhase("sending"); if (!conn.current?.send({ t: "answer", group: offer.group, buy })) setErr("No connection — reconnecting, then answer again."); };

  const wrap = (children) => (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "26px 18px 60px" }}>
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: C.acc, letterSpacing: "2px", marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
          <span>PRICE ROOM {code && `· ${code}`}</span>
          {code && <span style={{ color: status === "connected" ? C.good : C.warn }}>● {status === "connected" ? "online" : status}</span>}
        </div>
        {children}
        {err && <Callout tone="warn">{err}</Callout>}
      </div>
    </div>
  );

  if (!code) {
    return wrap(<>
      <h1 style={{ fontSize: 22, margin: "0 0 14px" }}>Join the room</h1>
      <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} maxLength={5} placeholder="CODE"
        style={{ width: "100%", fontSize: 30, letterSpacing: 8, textAlign: "center", padding: 12, borderRadius: 8, border: `1px solid ${C.bord}`, background: C.card, color: C.txt, fontFamily: "ui-monospace, monospace" }} />
      <button onClick={() => isRoomCode(typed) && setCode(typed.trim())} style={{ ...big(C.acc), marginTop: 12 }}>Join</button>
    </>);
  }
  if (!cfg) return wrap(status === "refused" ? <Callout tone="bad">This room does not exist or is full.</Callout> : <Spinner label="Connecting to the room…" />);

  const header = (
    <div style={{ marginBottom: 16 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>{cfg.product}</h1>
      {cfg.description && <p style={{ color: C.mut, fontSize: 14, lineHeight: 1.55, margin: 0 }}>{cfg.description}</p>}
    </div>
  );
  const progress = me && (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: C.mut, fontFamily: "ui-monospace, monospace", marginBottom: 6 }}>round {Math.min(me.done + 1, cfg.rounds)} of {cfg.rounds}</div>
      <div style={{ height: 4, background: C.bord, borderRadius: 2 }}><div style={{ height: 4, width: `${(me.done / cfg.rounds) * 100}%`, background: C.acc, borderRadius: 2 }} /></div>
    </div>
  );

  if (phase === "intro") return wrap(<>
    {header}
    <p style={{ fontSize: 14, lineHeight: 1.6 }}>
      You will be offered this product {cfg.rounds} times, each time at a different price{situationsOf(cfg).length ? " and sometimes in a different situation" : ""}.
      Each time you are part of a group of {cfg.groupSize}: the share of your group who would buy is the demand at that price.
      Answer each offer on its own, as you really would — forget the previous price.
    </p>
    {!open ? <Callout tone="warn">The room is paused. Wait for your lecturer.</Callout> : <button onClick={start} style={big(C.acc)}>Start</button>}
  </>);

  if (phase === "done") return wrap(<>
    {header}
    <div style={{ background: C.card, border: `1px solid ${C.good}55`, borderRadius: 10, padding: 20, textAlign: "center" }}>
      <div style={{ fontSize: 34 }}>✓</div>
      <div style={{ fontSize: 17, fontWeight: 600, margin: "6px 0" }}>Your {cfg.rounds} answers are in</div>
      <div style={{ color: C.mut, fontSize: 13.5, lineHeight: 1.6 }}>Look at the screen: each group that closes is a new point on the class demand curve.</div>
    </div>
  </>);

  if (phase === "closed") return wrap(<>{header}{progress}<Callout tone="warn">The room is paused. Stay on this page — it continues when your lecturer reopens it.</Callout></>);

  if (phase !== "offer" || !offer) return wrap(<>{header}{progress}<Spinner label={phase === "sending" ? "Sending…" : "Finding your next group…"} /></>);

  return wrap(<>
    {header}
    {progress}
    {situationsOf(cfg).length > 0 && offer.level && (
      <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "12px 14px", marginBottom: 10, fontSize: 15.5, lineHeight: 1.55 }}>
        {situationsOf(cfg).map((x, i) => {
          const lv = (offer.levels ?? [offer.level])[i];
          return lv ? <div key={x.name}>{x.question ? `${x.question} ` : ""}<strong>{lv}</strong>.</div> : null;
        })}
      </div>
    )}
    <div style={{ textAlign: "center", margin: "22px 0" }}>
      <div style={{ color: C.mut, fontSize: 14 }}>Would you buy it at</div>
      <div style={{ fontSize: 56, fontWeight: 700, fontVariantNumeric: "tabular-nums", margin: "4px 0" }}>{offer.price.toFixed(2)} <span style={{ fontSize: 30 }}>{cfg.currency}</span></div>
      <div style={{ color: C.mut, fontSize: 12 }}>group G{offer.group}</div>
    </div>
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
      <button onClick={() => answer(false)} style={big(C.bad)}>No</button>
      <button onClick={() => answer(true)} style={big(C.good)}>Yes, I’d buy</button>
    </div>
  </>);
}

const big = (bg) => ({ width: "100%", padding: "17px 12px", fontSize: 17, fontWeight: 600, borderRadius: 10, border: "none", background: bg, color: "#0d0f14", cursor: "pointer" });
