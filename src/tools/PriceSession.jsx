/* Live price room — the lecturer's page (module 8).
 *
 *   1 Create the scenario: a product, a base price, how far prices vary around
 *     it, and up to three situations that change demand (it is raining / it is
 *     not; 8:30 / 17:00; 15 °C / 25 °C / 35 °C). Situations are crossed: each
 *     group gets one level of each.
 *   2 Open the room: the class joins with the QR code.
 *   3 The room forms groups (5 students by default). Each group gets one price
 *     and one situation; each student answers “I would buy it” or not, then
 *     moves to a new group with another price, for several rounds.
 *   4 Each full group is one point: its share of yes answers is the demand at
 *     that price. The log-log line and the elasticity update as groups close.
 *   5 To grow the sample: pause, add rounds, reopen — later in the class, on
 *     another day or with another class group.
 *
 * The room lives on the course server (worker/src/room.ts); the key that
 * controls it is kept in this browser. */
import { useState, useEffect, useMemo, useRef } from "react";
import QRCode from "qrcode";
import { C, inp } from "../theme.js";
import { Section, Callout, Stat, Table, Field, Chip, Spinner } from "../components/UI.jsx";
import { LogLogChart, groupsFromFit } from "../components/ElasticityCharts.jsx";
import { priceGrid, fitElasticity } from "../lib/elasticity.js";
import { createRoom, connectRoom, groupRows, roomSpec, situationsOf, leadingNumber, myRooms, saveRoom, forgetRoom } from "../lib/room.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const MAX_SITUATIONS = 3;
const MAX_CELLS = 60;                    // the server's limit on price × situation combinations

/* Ready-made scenarios. Each has the situation that moves its demand and says
 * what the class should see, so the lecturer knows what to point at. */
const TEMPLATES = {
  umbrella: {
    label: "Umbrella + rain",
    product: "Folding umbrella", description: "Compact, fits in a bag, sold at the kiosk by the metro exit.",
    currency: "€", base: 8, rangePct: 50, levels: 7, groupSize: 5, rounds: 5,
    situations: [{ name: "weather", question: "As you come out of the metro,", levels: "it is raining, it is not raining" }],
    expect: "Raining: more people buy at every price and the line is flatter (less elastic) — they need it now. Not raining: few buy, and only when it is cheap.",
  },
  coffee: {
    label: "Coffee + time of day",
    product: "Coffee to go (regular latte)", description: "From the kiosk at the university entrance, ready in two minutes.",
    currency: "€", base: 2.5, rangePct: 40, levels: 7, groupSize: 5, rounds: 5,
    situations: [{ name: "moment", question: "It is", levels: "8:30 before your first class, 17:00 after your last class" }],
    expect: "Before class the coffee is a habit and a need: higher demand, less elastic. After class it is easy to skip, so a price rise loses more buyers.",
  },
  charger: {
    label: "Power bank + battery",
    product: "Portable phone charger (power bank)", description: "Sold at a kiosk in the train station. Charges a phone twice.",
    currency: "€", base: 15, rangePct: 50, levels: 7, groupSize: 5, rounds: 5,
    situations: [{ name: "battery", question: "Your phone battery is at", levels: "5% and you need it for three more hours, 80%" }],
    expect: "Urgency: with 5% battery the line is high and flat — the clearest case of inelastic demand. At 80% hardly anyone pays a high price.",
  },
  cinema: {
    label: "Cinema + occasion",
    product: "Cinema ticket for a new release", description: "Standard seat, standard screen, in a cinema near you.",
    currency: "€", base: 9, rangePct: 50, levels: 7, groupSize: 5, rounds: 5,
    situations: [{ name: "occasion", question: "You would go", levels: "on Friday night with friends, on a Tuesday afternoon alone" }],
    expect: "The plan with friends is worth more and is less price-sensitive; the quiet Tuesday is why cinemas sell cheap weekday tickets (price discrimination by time).",
  },
  concert: {
    label: "Concert + scarcity",
    product: "Ticket for a well-known band's concert in Madrid", description: "Standing, general admission, in six weeks.",
    currency: "€", base: 60, rangePct: 50, levels: 7, groupSize: 5, rounds: 4,
    situations: [{ name: "tickets", question: "The website says", levels: "only a few tickets are left, plenty of tickets are available" }],
    expect: "Scarcity makes people accept higher prices. Ask the class whether the fans changed, or only the message on the website.",
  },
  water: {
    label: "Water + temperature (numeric)",
    product: "Bottle of water (50 cl)", description: "From a stand at an open-air event in the city centre.",
    currency: "€", base: 1.5, rangePct: 60, levels: 6, groupSize: 5, rounds: 5,
    situations: [{ name: "temperature", question: "The temperature outside is", levels: "15 °C, 25 °C, 35 °C", numeric: true }],
    expect: "Temperature is a number, not a category: the Lab estimates one price elasticity plus a temperature elasticity — how much more people buy when it is 1% hotter, at the same price.",
  },
  taxi: {
    label: "Taxi + rain × time (two situations)",
    product: "Taxi ride home (about 15 minutes)", description: "You are leaving a friend's place across town.",
    currency: "€", base: 18, rangePct: 50, levels: 6, groupSize: 5, rounds: 6,
    situations: [
      { name: "weather", question: "Outside", levels: "it is raining, it is dry" },
      { name: "time", question: "It is", levels: "2:00 at night and the metro is closed, 19:00 and the metro is running" },
    ],
    expect: "Two situations crossed: the lines are drawn by weather, and the time of night enters as a shift in demand. With no metro at 2:00 the alternative disappears — watch how much that moves demand compared with the rain.",
  },
  blank: {
    label: "Blank — your own",
    product: "", description: "", currency: "€", base: 10, rangePct: 40, levels: 7, groupSize: 5, rounds: 5,
    situations: [{ name: "situation", question: "Imagine that", levels: "" }],
    expect: "",
  },
};

/* Situations that move demand for almost any product: pick one and adapt the
 * wording to the product. */
const SITUATIONS = [
  { label: "Weather", name: "weather", question: "Right now", levels: "it is raining, it is sunny", why: "Need depends on conditions the buyer does not control." },
  { label: "Urgency", name: "urgency", question: "You need it", levels: "right now, some time this month", why: "When it cannot wait there is no time to compare prices: demand is less elastic." },
  { label: "Who pays", name: "payer", question: "It is paid", levels: "from your own pocket, by your company", why: "People spending someone else's money are much less price-sensitive (business travel)." },
  { label: "Company", name: "company", question: "You are", levels: "with friends, alone", why: "A social occasion is worth more, and nobody wants to look cheap in front of friends." },
  { label: "Place", name: "place", question: "You are", levels: "at the airport, in your neighbourhood", why: "No alternative nearby means a captive buyer: higher demand, lower elasticity." },
  { label: "A cheaper rival", name: "rival", question: "You have just seen", levels: "the same product 20% cheaper next door, no other offer", why: "A visible substitute makes demand far more elastic." },
  { label: "Moment", name: "moment", question: "It is", levels: "a Saturday night, a Tuesday morning", why: "The time of day or week changes what the product is worth." },
  { label: "Temperature (numeric)", name: "temperature", question: "The temperature outside is", levels: "10 °C, 20 °C, 30 °C", numeric: true, why: "A number, not a category: the Lab measures how demand changes per 1% of temperature." },
  { label: "Income (numeric)", name: "income", question: "Your monthly budget for leisure is", levels: "100 €, 300 €, 600 €", numeric: true, why: "Income elasticity: how much more people buy when they have more to spend, at the same price." },
];

const splitLevels = (v) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export default function PriceSession() {
  const [form, setForm] = useState(TEMPLATES.umbrella);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rooms, setRooms] = useState(myRooms);
  const [active, setActive] = useState(() => myRooms()[0]?.code ?? null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const sits = form.situations;
  const setSit = (i, k, v) => set("situations", sits.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const removeSit = (i) => set("situations", sits.filter((_, j) => j !== i));
  // A suggestion replaces a situation with the same name, else fills an empty one, else is added.
  const applySuggestion = (x) => {
    const s = { name: x.name, question: x.question, levels: x.levels, ...(x.numeric ? { numeric: true } : {}) };
    const same = sits.findIndex((y) => y.name === x.name);
    const empty = sits.findIndex((y) => !splitLevels(y.levels).length);
    if (same >= 0) set("situations", sits.map((y, j) => (j === same ? s : y)));
    else if (empty >= 0) set("situations", sits.map((y, j) => (j === empty ? s : y)));
    else if (sits.length < MAX_SITUATIONS) set("situations", [...sits, s]);
  };
  const grid = useMemo(() => priceGrid(Number(form.base) || 0, Number(form.rangePct) || 0, Math.max(3, Number(form.levels) || 3)), [form]);
  const room = rooms.find((r) => r.code === active);

  // How many points the class will produce, and how many each line gets.
  const live = sits.filter((x) => splitLevels(x.levels).length >= 2);
  const pts = Math.floor((50 * (Number(form.rounds) || 5)) / (Number(form.groupSize) || 5));
  const cells = live.reduce((n, x) => n * splitLevels(x.levels).length, grid.length);
  const firstCat = live.find((x) => !x.numeric);
  const lines = firstCat ? splitLevels(firstCat.levels).length : 1;
  const badNumeric = live.filter((x) => x.numeric && splitLevels(x.levels).some((l) => !Number.isFinite(leadingNumber(l))));

  const create = async () => {
    setBusy(true); setErr("");
    try {
      const config = {
        product: form.product, description: form.description, currency: form.currency,
        base: Number(form.base), rangePct: Number(form.rangePct), levels: Number(form.levels),
        groupSize: Number(form.groupSize), rounds: Number(form.rounds),
        situations: live.map((x) => ({ name: x.name, question: x.question, levels: splitLevels(x.levels), ...(x.numeric ? { numeric: true } : {}) })),
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
          <li><strong>Create the scenario</strong> below: the product, its base price and how far prices vary around it — and the <strong>situations</strong> that change demand (raining / not raining), one demand line per situation.</li>
          <li><strong>Open the room</strong> and project the QR code. Students join on their phones.</li>
          <li>The room puts students in <strong>groups</strong> ({form.groupSize || 5} by default). Each group is offered <strong>one price</strong> (and one situation); each student answers “I would buy it” or not, then joins a new group with another price, for several rounds.</li>
          <li>Each full group is <strong>one point</strong>: its share of yes answers is the demand at that price. The log-log line and the <strong>elasticity</strong> update live.</li>
          <li><strong>Need more data?</strong> Pause the room, add rounds and reopen it — later in the class, another day, or with another class group. The answers add up.</li>
        </ol>

        {room && <Room key={room.code} room={room} onForget={() => { const n = forgetRoom(room.code); setRooms(n); setActive(n[0]?.code ?? null); }} />}

        <Section title={room ? "Create another scenario" : "1 · Create the scenario"}
          note="Start from a ready-made case — each one comes with the situation that changes its demand and what the class should see — or from a blank one.">
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
            {Object.entries(TEMPLATES).map(([k, t]) => <Chip key={k} active={form.label === t.label} onClick={() => setForm(t)}>{t.label}</Chip>)}
          </div>
          {form.expect && <Callout tone="info" title="What the class should see">{form.expect}</Callout>}

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <Field label="product" hint="What students are asked to buy."><input value={form.product} onChange={(e) => set("product", e.target.value)} style={inp} /></Field>
            <Field label="base price" hint="The centre of the prices offered."><input value={form.base} onChange={(e) => set("base", e.target.value)} style={inp} inputMode="decimal" /></Field>
            <Field label="variation ± %" hint="How far below and above the base price offers go."><input value={form.rangePct} onChange={(e) => set("rangePct", e.target.value)} style={inp} inputMode="decimal" /></Field>
            <Field label="number of prices" hint="Evenly spaced across the range."><input value={form.levels} onChange={(e) => set("levels", e.target.value)} style={inp} inputMode="numeric" /></Field>
            <Field label="students per group" hint="Each group gives one point: its share of yes. 5 is enough in class."><input value={form.groupSize} onChange={(e) => set("groupSize", e.target.value)} style={inp} inputMode="numeric" /></Field>
            <Field label="rounds per student" hint="How many offers each student answers, each at a new price. You can add more later."><input value={form.rounds} onChange={(e) => set("rounds", e.target.value)} style={inp} inputMode="numeric" /></Field>
            <Field label="currency"><input value={form.currency} onChange={(e) => set("currency", e.target.value)} style={inp} maxLength={4} /></Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="description students see" hint="Enough context to decide: where, when, what it is."><input value={form.description} onChange={(e) => set("description", e.target.value)} style={inp} /></Field>
          </div>
          <p style={{ fontSize: 12, color: C.mut, margin: "10px 0 0", fontFamily: MONO }}>prices offered: {grid.join(" · ")} {form.currency}</p>

          <div style={{ marginTop: 16, padding: 12, border: `1px solid ${C.bord}`, borderRadius: 8, background: C.surf }}>
            <strong style={{ fontSize: 13 }}>Situations that change demand</strong>
            <p style={{ fontSize: 12, color: C.mut, lineHeight: 1.6, margin: "4px 0 10px" }}>
              The same product in different circumstances. Each group is told one level of each situation, and the Lab draws one demand
              line per level of the first one: comparing the slopes shows when the same buyers are more or less price-sensitive — the reason
              to charge different prices at different moments. Add up to three; they are crossed (rain × time of day). Tick
              <em> numeric</em> when the levels are numbers (15 °C, 25 °C, 35 °C): the Lab then uses the number, not one line per level.
            </p>
            {sits.map((x, i) => (
              <div key={i} style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(110px,0.8fr) minmax(150px,1.2fr) minmax(200px,2fr) auto", alignItems: "end", marginBottom: 9 }}>
                <Field label={`${i + 1} · name`} hint="One word: the column name."><input value={x.name} onChange={(e) => setSit(i, "name", e.target.value.replace(/\s+/g, "_"))} style={inp} /></Field>
                <Field label="lead-in" hint="Shown before the level."><input value={x.question} onChange={(e) => setSit(i, "question", e.target.value)} style={inp} /></Field>
                <Field label="levels, comma-separated" hint={x.numeric ? "Each must start with a number." : "Two levels are best with one class."}>
                  <input value={x.levels} onChange={(e) => setSit(i, "levels", e.target.value)} style={inp} />
                </Field>
                <div style={{ display: "flex", gap: 6, alignItems: "center", paddingBottom: 18 }}>
                  <label style={{ fontSize: 11.5, color: C.mut, display: "flex", gap: 4, alignItems: "center" }} title="The levels are numbers: the Lab uses them as a numeric variable">
                    <input type="checkbox" checked={!!x.numeric} onChange={(e) => setSit(i, "numeric", e.target.checked)} />numeric
                  </label>
                  <button onClick={() => removeSit(i)} title="remove this situation" style={{ ...ghost, padding: "4px 8px" }}>×</button>
                </div>
              </div>
            ))}
            {sits.length < MAX_SITUATIONS && (
              <button onClick={() => set("situations", [...sits, { name: `situation${sits.length + 1}`, question: "Imagine that", levels: "" }])} style={{ ...ghost, fontSize: 11.5 }}>+ add a situation</button>
            )}
            {sits.length === 0 && <span style={{ fontSize: 12, color: C.mut, marginLeft: 8 }}>No situation: one demand line for everybody.</span>}

            <div style={{ marginTop: 12 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 6 }}>suggestions — they work with almost any product; adapt the wording</div>
              <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))" }}>
                {SITUATIONS.map((x) => {
                  const on = sits.some((y) => y.name === x.name && y.levels === x.levels);
                  return (
                    <button key={x.name} onClick={() => applySuggestion(x)} style={{
                      textAlign: "left", cursor: "pointer", borderRadius: 7, padding: "7px 10px", color: C.txt,
                      background: on ? `${C.acc}22` : C.card, border: `1px solid ${on ? C.acc : C.bord}`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{x.label}</div>
                      <div style={{ fontSize: 11, color: C.mut, lineHeight: 1.45, marginTop: 2 }}>{x.question} <em>{x.levels.replace(",", " /")}</em></div>
                      <div style={{ fontSize: 11, color: C.mut, lineHeight: 1.45, marginTop: 2 }}>{x.why}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
            <button onClick={create} disabled={busy || cells > MAX_CELLS || badNumeric.length > 0} style={primary}>{busy ? "Opening…" : "Open the room"}</button>
            <span style={{ fontSize: 12, color: C.mut, lineHeight: 1.6 }}>
              With 50 students × {form.rounds || 5} rounds ÷ {form.groupSize || 5} per group ≈ <strong>{pts}</strong> points on the curve
              {lines > 1 && <> — about <strong>{Math.floor(pts / lines)}</strong> per line</>}
              {live.length > 0 && <> · {cells} price × situation combinations</>}.
              {pts / lines < 12 && <span style={{ color: C.warn }}> Few points per line: add a round, use fewer levels, or reopen the room later to add more.</span>}
            </span>
          </div>
          {cells > MAX_CELLS && <Callout tone="warn">{cells} combinations of price and situation is too many for one class (at most {MAX_CELLS}). Use fewer prices or fewer levels.</Callout>}
          {badNumeric.length > 0 && <Callout tone="warn">Every level of a numeric situation must start with a number ({badNumeric.map((x) => x.name).join(", ")}).</Callout>}
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
  const [add, setAdd] = useState(2);
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
        else if (m.t === "open") setState((s) => s && { ...s, open: m.open, ...(m.expires ? { expires: m.expires } : {}) });
        else if (m.t === "rounds") setState((s) => s && { ...s, cfg: { ...s.cfg, rounds: m.rounds } });
        else if (m.t === "group") setState((s) => s && { ...s, ...m, groups: [...s.groups.filter((g) => g.id !== m.group.id), m.group] });
        else if (m.error) setErr(m.error);
      },
    });
    conn.current = c;
    return () => c.close();
  }, [room.code, room.hostKey]);

  const sits = situationsOf(state?.cfg);
  const closed = (state?.groups || []).filter((g) => g.closed).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  const fit = useMemo(() => {
    if (!state) return null;
    const rows = groupRows(state.groups, state.cfg);
    if (rows.length < 3) return null;
    try {
      const spec = roomSpec(state.cfg, rows);
      const f = fitElasticity(rows, spec);
      return { f, spec, groups: groupsFromFit(f, true) };
    } catch { return null; }
  }, [state]);

  const cur = state?.cfg.currency || "";
  const open = state?.open;
  return (
    <Section title={`Room ${room.code} — ${room.product}`}
      right={<span style={{ fontSize: 12, color: status !== "connected" ? C.warn : open ? C.good : C.mut }}>
        {status !== "connected" ? `● ${status}…` : open ? "● open — taking answers" : "● paused"}</span>}>
      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", alignItems: "start" }}>
        <div style={{ textAlign: "center" }}>
          {qr && <img src={qr} alt="QR code to join" style={{ width: "100%", maxWidth: 260, borderRadius: 8, background: "#fff" }} />}
          <div style={{ fontFamily: MONO, fontSize: 38, letterSpacing: 7, fontWeight: 700, marginTop: 8 }}>{room.code}</div>
          <div style={{ fontSize: 11.5, color: C.mut, wordBreak: "break-all", marginTop: 4 }}>{joinUrl}</div>
        </div>
        <div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <Stat label="connected now" value={state?.connected ?? "—"} />
            <Stat label="students so far" value={state?.students ?? "—"} />
            <Stat label="answers" value={state?.answers ?? "—"} />
            <Stat label="groups closed" value={state?.closedGroups ?? "—"} hint={state ? `${state.openGroups} filling` : ""} tone="good" />
            <Stat label="rounds each" value={state?.cfg.rounds ?? "—"} />
          </div>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <button onClick={() => conn.current?.send({ t: open ? "close" : "open" })} style={open ? ghost : primary}>{open ? "Pause the room" : "Reopen the room"}</button>
            <a href={`#/elasticity?room=${room.code}`} style={{ ...primary, textDecoration: "none" }}>Analyse in the Elasticity Lab →</a>
          </div>

          <div style={{ marginTop: 14, padding: 11, border: `1px solid ${C.bord}`, borderRadius: 8, background: C.surf }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Grow the sample</div>
            <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, margin: "0 0 8px" }}>
              Pause when you want to discuss the curve; when you want more answers — later in this class, another day or with another class
              group — add rounds and reopen. Students who had finished get new offers; new students join with the same QR code. Every
              group adds to the same curve.{state?.expires ? ` The room is kept until ${new Date(state.expires).toLocaleDateString()} (each reopening extends it 60 days).` : ""}
            </p>
            <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
              <input value={add} onChange={(e) => setAdd(e.target.value)} inputMode="numeric" style={{ ...inp, width: 56 }} />
              <button onClick={() => { const n = Math.round(Number(add)); if (n >= 1) conn.current?.send({ t: "rounds", add: n }); }} style={ghost}>+ rounds for everybody</button>
              <button onClick={() => { if (confirm("Pause the room and count the groups that did not fill (with at least 2 answers)? You can reopen it afterwards.")) conn.current?.send({ t: "finish" }); }} style={ghost}>Pause and count incomplete groups</button>
              <button onClick={onForget} style={{ ...ghost, color: C.mut }}>Forget on this device</button>
            </div>
          </div>
          {err && <Callout tone="bad">{err}</Callout>}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <strong style={{ fontSize: 13 }}>The class demand, in logs</strong>
        <span style={{ fontSize: 12, color: C.mut, marginLeft: 8 }}>
          each point is a closed group; the slope of each line is the elasticity
          {fit?.spec.segment ? ` — one line per ${fit.spec.segment}` : ""}
          {fit?.spec.shifters.length ? `; ${fit.spec.shifters.join(", ")} shifts demand` : ""}
          {fit?.spec.nums.length ? `; ${fit.spec.nums.map((n) => n.col).join(", ")} enters as a number` : ""}
        </span>
        {!fit && <p style={{ fontSize: 12.5, color: C.mut }}>The line appears when three groups have closed{sits.length ? " (and one line per situation when each has enough groups)" : ""}.</p>}
        {fit && (
          <>
            <LogLogChart groups={fit.groups} priceLabel="price" qtyLabel="share of the group who would buy" height={320} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              {fit.f.bySegment.map((s) => (
                <Stat key={s.level ?? "all"} label={s.level == null ? "elasticity" : `elasticity · ${s.level}`} value={s.eps.toFixed(2)}
                  hint={`95% CI ${s.lo.toFixed(2)} to ${s.hi.toFixed(2)} · ${s.n} groups`} tone={s.eps < -1 ? undefined : "warn"} />
              ))}
              {fit.f.slopeTest && <Stat label={`do the ${fit.spec.segment} lines differ?`} value={fit.f.slopeTest.p < 0.05 ? "yes" : "not yet"}
                hint={`F test p = ${fit.f.slopeTest.p < 0.001 ? "< 0.001" : fit.f.slopeTest.p.toFixed(3)}`} tone={fit.f.slopeTest.p < 0.05 ? "good" : "warn"} />}
              {fit.f.names.map((n, j) => (j < 2 || n.includes(" × ") || (fit.spec.segment && n.startsWith(`${fit.spec.segment}=`))) ? null : (
                <Stat key={n} label={n.startsWith("ln(") ? `${n.slice(3, -1)} elasticity` : n}
                  value={n.startsWith("ln(") ? fit.f.model.beta[j].toFixed(2) : `${((Math.exp(fit.f.model.beta[j]) - 1) * 100).toFixed(0)}%`}
                  hint={`${n.startsWith("ln(") ? "+1% → this % in demand" : "demand vs. the reference level"} · p ${fit.f.model.p[j] < 0.001 ? "< 0.001" : fit.f.model.p[j].toFixed(3)}`}
                  tone={fit.f.model.p[j] < 0.05 ? "good" : undefined} />
              ))}
            </div>
          </>
        )}
      </div>

      {closed.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <strong style={{ fontSize: 13 }}>Closed groups, newest first</strong>
          <Table head={["group", "price", ...sits.map((x) => x.name), "answers", "would buy", "demand (share)"]} maxHeight={260}
            rows={closed.map((g) => {
              const lv = g.levels ?? (g.level != null ? [g.level] : []);
              return [`G${g.id}`, `${g.price} ${cur}`, ...sits.map((_, i) => lv[i] ?? ""), g.n, g.yes, `${Math.round((g.yes / g.n) * 100)}%${g.yes === 0 ? " *" : ""}`];
            })} />
          <p style={{ fontSize: 11.5, color: C.mut }}>* nobody bought: plotted at half an acceptance so the logarithm exists.</p>
        </div>
      )}
    </Section>
  );
}

const primary = { background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6, padding: "8px 15px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "inline-block" };
const ghost = { background: C.card, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6, padding: "7px 13px", fontSize: 12.5, cursor: "pointer" };
