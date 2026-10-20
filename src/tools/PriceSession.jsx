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
 * Two phases (the default): before the prices, every student says the most
 * they would pay in each situation, on a scale. The page turns those answers
 * into an optimal price per situation with the WTP Price Optimizer's own
 * calculation (src/lib/wtp.js) and the price phase offers small steps (±5–15%)
 * around it — the elasticity is measured where the pricing decision is. The
 * WTP results go to a second page for the lecturer's own screen
 * (#/price-wtp?room=CODE), so the projector never shows the prices.
 *
 * The offers climb a ladder: each student goes through the situations in the
 * order written (raining, then not raining) and, in each, through every price
 * from the lowest to the highest, in round steps a student notices. When
 * phase 2 starts, the room adds the phase-1 base: the class's stated WTP
 * played at those same prices, marked "stated", so the curve has its shape
 * around the WTP optimum from the first minute and the real answers are read
 * against it. A switch shows the fit with or without it.
 *
 * Automatic waves: the grids follow fixed rules (src/lib/priceRules.js —
 * steps a buyer notices, ±20–50%, ends where about 90% and 10% would buy, the
 * optimum inside, nothing at or below cost) and, once the class has climbed
 * the ladder, the room starts the next wave on its own around the price the
 * answers point to — the lecturer decides nothing during the class. A seed of
 * synthetic points (the phase-1 WTP, or a small prior in one-phase rooms)
 * keeps the curve near reality while real answers are few.
 *
 * The room lives in the course's Firebase database (src/lib/roomEngine.js);
 * this browser is the host and runs the automatic waves, so keep it open. */
import { useState, useEffect, useMemo, useRef } from "react";
import QRCode from "qrcode";
import { C, inp } from "../theme.js";
import { Section, Callout, Stat, Table, Field, Chip, Spinner } from "../components/UI.jsx";
import { LogLogChart, groupsFromFit } from "../components/ElasticityCharts.jsx";
import { ElasticityWarnings } from "../components/ElasticityWarnings.jsx";
import { fitElasticity } from "../lib/elasticity.js";
import { createRoom, connectRoom, groupRows, roomSpec, situationsOf, leadingNumber, myRooms, saveRoom, forgetRoom, combosOf, comboKey } from "../lib/room.js";
import { wtpOptimum, scaleLevels, frequencies } from "../lib/wtp.js";
import { ruleGrid, clampBounds, RULES } from "../lib/priceRules.js";

/* The grid the room will use: the variation asked for, held to the rules. */
const previewGrid = (centre, rangePct, levels, cost) =>
  centre > 0 ? ruleGrid({ centre, ...clampBounds(centre, centre * (1 - rangePct / 100), centre * (1 + rangePct / 100)), levels, cost }) : [];

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const MAX_SITUATIONS = 3;
const MAX_CELLS = 60;                    // the server's limit on price × situation combinations
const MAX_WTP_COMBOS = 6;               // maximum prices one student gives in the WTP phase
// How far the offers go around the centre, and how many prices. Every option
// climbs in steps of about 10% — less is hard to notice on a phone — rounded
// to a price a buyer reads at a glance (src/lib/wtp.js centredGrid). With 50
// students ±15% left the elasticity very uncertain; ±30% halves the interval;
// beyond ±40% the curve bends.
const VARIATIONS = [[20, 5], [30, 7], [40, 9]];

/* Ready-made scenarios. Each has the situation that moves its demand and says
 * what the class should see, so the lecturer knows what to point at. */
const TEMPLATES = {
  umbrella: {
    label: "Umbrella + rain",
    product: "Folding umbrella", description: "Compact, fits in a bag, sold at the kiosk by the metro exit.",
    currency: "€", base: 8, rangePct: 30, levels: 7, groupSize: 5, rounds: 6, autoWaves: 3,
    mode: "wtp", wtp: { from: 2, to: 16, step: 1 }, cost: 3,
    situations: [{ name: "weather", question: "As you come out of the metro,", levels: "it is raining, it is not raining" }],
    expect: "Raining: more people buy at every price and the line is flatter (less elastic) — they need it now. Not raining: few buy, and only when it is cheap.",
  },
  coffee: {
    label: "Coffee + time of day",
    product: "Coffee to go (regular latte)", description: "From the kiosk at the university entrance, ready in two minutes.",
    currency: "€", base: 2.5, rangePct: 30, levels: 7, groupSize: 5, rounds: 6, autoWaves: 3,
    mode: "wtp", wtp: { from: 1, to: 4.5, step: 0.25 }, cost: 0.6,
    situations: [{ name: "moment", question: "It is", levels: "8:30 before your first class, 17:00 after your last class" }],
    expect: "Before class the coffee is a habit and a need: higher demand, less elastic. After class it is easy to skip, so a price rise loses more buyers.",
  },
  charger: {
    label: "Power bank + battery",
    product: "Portable phone charger (power bank)", description: "Sold at a kiosk in the train station. Charges a phone twice.",
    currency: "€", base: 15, rangePct: 30, levels: 7, groupSize: 5, rounds: 6, autoWaves: 3,
    mode: "wtp", wtp: { from: 5, to: 40, step: 2.5 }, cost: 6,
    situations: [{ name: "battery", question: "Your phone battery is at", levels: "5% and you need it for three more hours, 80%" }],
    expect: "Urgency: with 5% battery the line is high and flat — the clearest case of inelastic demand. At 80% hardly anyone pays a high price.",
  },
  cinema: {
    label: "Cinema + occasion",
    product: "Cinema ticket for a new release", description: "Standard seat, standard screen, in a cinema near you.",
    currency: "€", base: 9, rangePct: 30, levels: 7, groupSize: 5, rounds: 6, autoWaves: 3,
    mode: "wtp", wtp: { from: 3, to: 16, step: 1 }, cost: 2.5,
    situations: [{ name: "occasion", question: "You would go", levels: "on Friday night with friends, on a Tuesday afternoon alone" }],
    expect: "The plan with friends is worth more and is less price-sensitive; the quiet Tuesday is why cinemas sell cheap weekday tickets (price discrimination by time).",
  },
  concert: {
    label: "Concert + scarcity",
    product: "Ticket for a well-known band's concert in Madrid", description: "Standing, general admission, in six weeks.",
    currency: "€", base: 60, rangePct: 30, levels: 7, groupSize: 5, rounds: 6, autoWaves: 3,
    mode: "wtp", wtp: { from: 20, to: 160, step: 10 }, cost: 20,
    situations: [{ name: "tickets", question: "The website says", levels: "only a few tickets are left, plenty of tickets are available" }],
    expect: "Scarcity makes people accept higher prices. Ask the class whether the fans changed, or only the message on the website.",
  },
  water: {
    label: "Water + temperature (numeric)",
    product: "Bottle of water (50 cl)", description: "From a stand at an open-air event in the city centre.",
    currency: "€", base: 1.5, rangePct: 30, levels: 7, groupSize: 5, rounds: 6, autoWaves: 3,
    mode: "wtp", wtp: { from: 0.5, to: 4, step: 0.25 }, cost: 0.25,
    situations: [{ name: "temperature", question: "The temperature outside is", levels: "15 °C, 25 °C, 35 °C", numeric: true }],
    expect: "Temperature is a number, not a category: the Lab estimates one price elasticity plus a temperature elasticity — how much more people buy when it is 1% hotter, at the same price.",
  },
  taxi: {
    label: "Taxi + rain × time (two situations)",
    product: "Taxi ride home (about 15 minutes)", description: "You are leaving a friend's place across town.",
    currency: "€", base: 18, rangePct: 30, levels: 7, groupSize: 5, rounds: 6, autoWaves: 3,
    mode: "wtp", wtp: { from: 8, to: 40, step: 2 }, cost: 8,
    situations: [
      { name: "weather", question: "Outside", levels: "it is raining, it is dry" },
      { name: "time", question: "It is", levels: "2:00 at night and the metro is closed, 19:00 and the metro is running" },
    ],
    expect: "Two situations crossed: the lines are drawn by weather, and the time of night enters as a shift in demand. With no metro at 2:00 the alternative disappears — watch how much that moves demand compared with the rain.",
  },
  blank: {
    label: "Blank — your own",
    product: "", description: "", currency: "€", base: 10, rangePct: 30, levels: 7, groupSize: 5, rounds: 6, autoWaves: 3,
    mode: "wtp", wtp: { from: 1, to: 20, step: 1 }, cost: 0,
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
  const [picked, setPicked] = useState(false);     // the form shows once a case is chosen
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rooms, setRooms] = useState(myRooms);
  const [active, setActive] = useState(null);     // nothing opens until the lecturer creates or picks a room
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
  const grid = useMemo(() => previewGrid(Number(form.base) || 0, Number(form.rangePct) || 30, Number(form.levels) || 7, Number(form.cost) || 0), [form]);
  const scale = useMemo(() => scaleLevels(form.wtp?.from, form.wtp?.to, form.wtp?.step), [form.wtp]);
  const setWtp = (k, v) => set("wtp", { ...(form.wtp || {}), [k]: v });
  const wtpMode = form.mode === "wtp";
  const room = rooms.find((r) => r.code === active);

  // How many points the class will produce, and how many each line gets: on
  // the ladder every student answers every price in every situation.
  const live = sits.filter((x) => splitLevels(x.levels).length >= 2);
  const cells = live.reduce((n, x) => n * splitLevels(x.levels).length, grid.length);
  const pts = Math.floor((50 * cells) / (Number(form.groupSize) || 5));
  const firstCat = live.find((x) => !x.numeric);
  const lines = firstCat ? splitLevels(firstCat.levels).length : 1;
  const badNumeric = live.filter((x) => x.numeric && splitLevels(x.levels).some((l) => !Number.isFinite(leadingNumber(l))));
  const combos = live.reduce((n, x) => n * splitLevels(x.levels).length, 1);
  const badScale = wtpMode && (scale.length < 3 || scale.length > 40);
  const tooManyCombos = wtpMode && combos > MAX_WTP_COMBOS;

  const create = async () => {
    setBusy(true); setErr("");
    try {
      const config = {
        product: form.product, description: form.description, currency: form.currency,
        base: wtpMode ? scale[Math.floor(scale.length / 2)] : Number(form.base), rangePct: Number(form.rangePct), levels: Number(form.levels),
        groupSize: Number(form.groupSize), rounds: cells, order: "ladder", autoWaves: Number(form.autoWaves) || 3,
        mode: wtpMode ? "wtp" : "price", cost: Number(form.cost) || 0, ...(wtpMode ? { wtpScale: scale } : {}),
        situations: live.map((x) => ({ name: x.name, question: x.question, levels: splitLevels(x.levels), ...(x.numeric ? { numeric: true } : {}) })),
      };
      const r = await createRoom(config);
      setRooms(saveRoom({ code: r.code, hostKey: r.hostKey, product: r.config.product, created: Date.now() }));
      setActive(r.code);
      setPicked(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
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
          <li><strong>Create the scenario</strong> below: the product, its unit cost and the <strong>situations</strong> that change demand (raining / not raining), one demand line per situation.</li>
          <li><strong>Open the room</strong> and project the QR code. Students join on their phones.</li>
          <li><strong>Phase 1 · willingness to pay</strong> (recommended): each student says the most they would pay in each situation. The room computes the optimal price for each situation — the WTP Price Optimizer's calculation, shown on a second page for your screen only — and you start phase 2. You can also skip it and start at a price you choose.</li>
          <li><strong>Phase 2 · prices, as a ladder</strong>: around that optimum the room sets a few <strong>round prices</strong>, by fixed rules (below). Each student goes through the situations in order — the first one first (raining), then the next (not raining) — and in each one through the prices <strong>from the lowest to the highest</strong>, answering “I would buy it” or not: going up, each finds where the price passes what they would pay. Students at the same step form <strong>groups</strong> of {form.groupSize || 5}.</li>
          <li>Each full group is <strong>one point</strong>: its share of yes answers is the demand at that price. From the start the curve also has the <strong>phase-1 base</strong> — what the class said in phase 1, played at the same prices — so the first real answers already sit on a sensible curve; a switch shows the fit with or without it. The log-log line and the <strong>elasticity</strong> update live.</li>
          <li><strong>Automatic waves</strong>: when the class has climbed the whole ladder, the room moves the prices to where the answers point and starts a new ladder for everybody — {form.autoWaves || 3} waves in all. You decide nothing during the class.</li>
          <li><strong>Need more data?</strong> New students join with the same QR and climb the whole ladder; pause and reopen later or another day.</li>
        </ol>
        <details style={{ maxWidth: 760, margin: "-12px 0 24px", fontSize: 12.5, color: C.mut, lineHeight: 1.7 }}>
          <summary style={{ cursor: "pointer", color: C.txt }}>The rules every price grid follows, automatically</summary>
          <ol style={{ paddingLeft: 20, margin: "6px 0 0" }}>
            <li><strong style={{ color: C.txt }}>Steps a buyer notices</strong>: at least {RULES.minStepPct}% of the highest price (the just-noticeable difference). Smaller steps get the same answer at different prices and push the elasticity towards 0.</li>
            <li><strong style={{ color: C.txt }}>Range between ±{RULES.minRangePct}% and ±{RULES.maxRangePct}%</strong> of the centre. Narrower: the slope is too uncertain. Wider: the elasticity is no longer constant and the log-log line bends.</li>
            <li><strong style={{ color: C.txt }}>Ends where about 90% and 10% would buy</strong>: a price where everybody (or nobody) buys tells nothing about the slope. First from the phase-1 WTP (its 10th and 90th percentiles), then from the fitted curve; a wave where all bought at the top, or nobody at the bottom, moves the whole grid that way.</li>
            <li><strong style={{ color: C.txt }}>The optimum inside the grid</strong>, and an elasticity below −1 there; if demand is inelastic the prices go up.</li>
            <li><strong style={{ color: C.txt }}>Nothing at or below the unit cost.</strong></li>
            <li><strong style={{ color: C.txt }}>At least {RULES.minLevels} prices</strong>, rounded to prices a buyer reads at a glance.</li>
            <li><strong style={{ color: C.txt }}>A synthetic seed</strong> keeps the curve near reality while real answers are few: the class's phase-1 WTP played at every price offered (one-phase rooms: a small prior through the starting price, 2 groups per price). Real answers soon outweigh it; a switch shows the fit without it.</li>
          </ol>
        </details>

        {!room && rooms.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "0 0 14px" }}>
            <span style={{ fontSize: 12, color: C.mut }}>Continue an earlier room (to show its QR and curve again, or add rounds):</span>
            {rooms.map((r) => <Chip key={r.code} onClick={() => setActive(r.code)}>{r.code} · {r.product}</Chip>)}
          </div>
        )}
        {room && <Room key={room.code} room={room} onClose={() => setActive(null)}
          onForget={() => { setRooms(forgetRoom(room.code)); setActive(null); }} />}

        <Section title={room ? "Create another scenario" : "1 · Create the scenario"}
          note="Start from a ready-made case — each one comes with the situation that changes its demand and what the class should see — or from a blank one.">
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
            {Object.entries(TEMPLATES).map(([k, t]) => <Chip key={k} active={picked && form.label === t.label} onClick={() => { setForm(t); setPicked(true); }}>{t.label}</Chip>)}
          </div>
          {!picked && (
            <Callout tone="info" title="Choose a case to start">
              Click one of the cases above (or <em>Blank — your own</em>): its settings appear below and you can change any of them.
              Nothing is created until you press <strong>Open the room</strong>.
            </Callout>
          )}
          {picked && <>
          {form.expect && <Callout tone="info" title="What the class should see">{form.expect}</Callout>}

          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", marginBottom: 14 }}>
            {[["wtp", "Two phases: willingness to pay first (recommended)",
              "Phase 1: each student gives the most they would pay in each situation. The room computes the optimal price per situation (WTP Price Optimizer). Phase 2: offers around it, so the elasticity is measured where the decision is."],
              ["price", "One phase: start at a price I choose",
              "No WTP question: the offers go straight to prices around the one you type."]].map(([m, t, d]) => (
              <button key={m} onClick={() => set("mode", m)} style={{
                textAlign: "left", cursor: "pointer", borderRadius: 8, padding: "9px 12px", color: C.txt,
                background: form.mode === m ? `${C.acc}22` : C.surf, border: `1px solid ${form.mode === m ? C.acc : C.bord}`,
              }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{form.mode === m ? "● " : "○ "}{t}</div>
                <div style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.5, marginTop: 3 }}>{d}</div>
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <Field label="product" hint="What students are asked to buy."><input value={form.product} onChange={(e) => set("product", e.target.value)} style={inp} /></Field>
            <Field label="unit cost" hint="What one unit costs you. The WTP optimum and the Lab's optimal price use it."><input value={form.cost} onChange={(e) => set("cost", e.target.value)} style={inp} inputMode="decimal" /></Field>
            {wtpMode ? (
              <Field label="WTP scale: lowest · highest · step" hint={`The prices a student can pick as their maximum: ${scale.length} prices.`}>
                <div style={{ display: "flex", gap: 5 }}>
                  {["from", "to", "step"].map((k) => <input key={k} value={form.wtp?.[k] ?? ""} onChange={(e) => setWtp(k, e.target.value)} style={{ ...inp, minWidth: 0 }} inputMode="decimal" />)}
                </div>
              </Field>
            ) : (
              <Field label="starting price" hint="The centre of the prices offered."><input value={form.base} onChange={(e) => set("base", e.target.value)} style={inp} inputMode="decimal" /></Field>
            )}
            <Field label="variation (starting point)" hint="The rules then hold it within ±20–50%, steps of 5% or more, above cost — and the ends follow where the class would buy.">
              <select value={`${form.rangePct}|${form.levels}`} onChange={(e) => { const [r, l] = e.target.value.split("|").map(Number); setForm((f) => ({ ...f, rangePct: r, levels: l })); }} style={inp}>
                {!VARIATIONS.some(([r, l]) => r === Number(form.rangePct) && l === Number(form.levels)) && <option value={`${form.rangePct}|${form.levels}`}>±{form.rangePct}% · {form.levels} prices</option>}
                {VARIATIONS.map(([r, l]) => <option key={r} value={`${r}|${l}`}>±{r}% · {l} prices, steps of {Math.round((2 * r) / (l - 1))}%{r === 30 ? " (recommended)" : ""}</option>)}
              </select>
            </Field>
            <Field label="students per group" hint="Each group gives one point: its share of yes. 5 is enough in class."><input value={form.groupSize} onChange={(e) => set("groupSize", e.target.value)} style={inp} inputMode="numeric" /></Field>
            <Field label="offers per student" hint="The ladder: every price in every situation, lowest first.">
              <div style={{ ...inp, color: C.mut }}>{cells} = {grid.length} prices{combos > 1 ? ` × ${combos} situations` : ""}</div>
            </Field>
            <Field label="automatic waves" hint="How many ladders each student climbs; the prices move by the rules between them.">
              <select value={form.autoWaves || 3} onChange={(e) => set("autoWaves", Number(e.target.value))} style={inp}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}{n === 3 ? " (recommended)" : ""}</option>)}
              </select>
            </Field>
            <Field label="currency"><input value={form.currency} onChange={(e) => set("currency", e.target.value)} style={inp} maxLength={4} /></Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="description students see" hint="Enough context to decide: where, when, what it is."><input value={form.description} onChange={(e) => set("description", e.target.value)} style={inp} /></Field>
          </div>
          <p style={{ fontSize: 12, color: C.mut, margin: "10px 0 0", fontFamily: MONO, lineHeight: 1.6 }}>
            {wtpMode
              ? <>WTP scale: {scale.length > 16 ? `${scale.slice(0, 6).join(" · ")} … ${scale.slice(-3).join(" · ")}` : scale.join(" · ")} {form.currency}<br />
                prices offered in phase 2: round steps around each situation's WTP optimum, ends where about 90% and 10% of the class said they would buy — if the optimum were {f2(scale[Math.floor(scale.length / 2)])}: {previewGrid(scale[Math.floor(scale.length / 2)] || 0, Number(form.rangePct) || 30, Number(form.levels) || 7, Number(form.cost) || 0).map(f2).join(" · ")}</>
              : <>prices offered: {grid.map(f2).join(" · ")} {form.currency}</>}
          </p>
          {badScale && <Callout tone="warn">The WTP scale needs between 3 and 40 prices: check lowest, highest and step.</Callout>}
          {tooManyCombos && <Callout tone="warn">In the WTP phase each student gives one maximum price per combination of situations: {combos} is too many (at most {MAX_WTP_COMBOS}). Use fewer situations or levels.</Callout>}

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
            <button onClick={create} disabled={busy || cells > MAX_CELLS || badNumeric.length > 0 || badScale || tooManyCombos} style={primary}>{busy ? "Opening…" : "Open the room"}</button>
            <span style={{ fontSize: 12, color: C.mut, lineHeight: 1.6 }}>
              With 50 students × {cells} offers ÷ {form.groupSize || 5} per group ≈ <strong>{pts}</strong> points on the curve
              {lines > 1 && <> — about <strong>{Math.floor(pts / lines)}</strong> per line</>}
              {live.length > 0 && <> · {cells} price × situation combinations</>}.
              {pts / lines < 12 && <span style={{ color: C.warn }}> Few points per line: use smaller groups, or reopen the room later with more students.</span>}
            </span>
          </div>
          {cells > MAX_CELLS && <Callout tone="warn">{cells} combinations of price and situation is too many for one class (at most {MAX_CELLS}). Use fewer prices or fewer levels.</Callout>}
          {badNumeric.length > 0 && <Callout tone="warn">Every level of a numeric situation must start with a number ({badNumeric.map((x) => x.name).join(", ")}).</Callout>}
          {busy && <Spinner label="Opening the room…" />}
          {err && <Callout tone="bad" title="Could not open the room">{err}</Callout>}
          </>}
        </Section>

        {room && rooms.length > 1 && (
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

function Room({ room, onForget, onClose }) {
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
        else if (m.t === "phase") setState((s) => s && { ...s, phase: m.phase, cfg: m.cfg });
        else if (m.t === "cfg") setState((s) => s && { ...s, cfg: m.cfg });
        else if (m.t === "group") setState((s) => s && { ...s, ...m, groups: [...s.groups.filter((g) => g.id !== m.group.id), m.group] });
        else if (m.error) setErr(m.error);
      },
    });
    conn.current = c;
    return () => c.close();
  }, [room.code, room.hostKey]);

  const sits = situationsOf(state?.cfg);
  // The phase-1 base (stated WTP at the phase-2 prices) is in the fit unless switched off.
  const [withStated, setWithStated] = useState(true);
  const stated = (state?.groups || []).filter((g) => g.synthetic).length;
  const groups = useMemo(() => (state?.groups || []).filter((g) => withStated || !g.synthetic), [state, withStated]);
  const closed = groups.filter((g) => g.closed && !g.synthetic).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  const ladder = state?.cfg.order === "ladder";
  const fit = useMemo(() => {
    if (!state) return null;
    const rows = groupRows(groups, state.cfg);
    if (rows.length < 3) return null;
    try {
      const spec = roomSpec(state.cfg, rows);
      const f = fitElasticity(rows, spec);
      return { f, spec, groups: groupsFromFit(f, true) };
    } catch { return null; }
  }, [state, groups]);

  const cur = state?.cfg.currency || "";
  const open = state?.open;
  const inWtp = state?.phase === "wtp";
  const wtpUrl = `${window.location.origin}${window.location.pathname}#/price-wtp?room=${room.code}`;

  /* Phase 2 starts around the WTP optimum of each situation combination: the
   * WTP Price Optimizer's calculation on the answers given so far, with the
   * room's unit cost. A combination nobody answered uses all the answers. */
  const startPrices = () => {
    const cfg = state.cfg, scale = cfg.wtpScale || [];
    const all = Object.values(state.wtp || {}).flat();
    const centres = {};
    for (const c of combosOf(cfg)) {
      const vals = state.wtp?.[comboKey(c)]?.length ? state.wtp[comboKey(c)] : all;
      const o = wtpOptimum(scale, frequencies(vals, scale), { vcu: cfg.cost || 0 });
      centres[comboKey(c)] = o ? Math.round(o.optPrice * 100) / 100 : cfg.base;
    }
    if (confirm("Close the willingness-to-pay phase and start the prices? Students who have not answered will go straight to the prices.")) conn.current?.send({ t: "start-prices", centres });
  };
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
            <Stat label={ladder ? "offers each (ladder)" : "rounds each"} value={state?.cfg.rounds ?? "—"} />
          </div>
          {state?.cfg.mode === "wtp" && (
            <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 8, border: `1px solid ${inWtp ? C.acc : C.bord}`, background: inWtp ? `${C.acc}14` : C.surf }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{inWtp ? "Phase 1 · willingness to pay" : "Phase 2 · prices around the WTP optimum"}</div>
              <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.6, marginTop: 3 }}>
                {inWtp
                  ? <><strong style={{ color: C.txt }}>{state.wtpAnswers ?? 0}</strong> of {state.students ?? 0} students have given their maximum prices. When most have answered, start phase 2: the room centres the offers on the optimal price of each situation.</>
                  : <>Offers sit within ±{state.cfg.rangePct}% of each situation's WTP optimum{ladder ? ", climbing from the lowest price to the highest, one situation after the other" : ""}.
                    {stated > 0 && <> The curve starts from the <strong style={{ color: C.txt }}>phase-1 base</strong>: {stated} groups of what the class said, at these prices.</>}</>}
                {" "}<a href={wtpUrl} target="_blank" rel="noreferrer" style={{ color: C.acc }}>WTP results ↗</a> <span>(open it on your own screen, not the projector: it shows the prices)</span>
              </div>
              {inWtp && <button onClick={startPrices} disabled={!(state.wtpAnswers >= 3)} style={{ ...primary, marginTop: 8 }}>Start phase 2 — prices around the WTP optimum</button>}
            </div>
          )}
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <button onClick={() => conn.current?.send({ t: open ? "close" : "open" })} style={open ? ghost : primary}>{open ? "Pause the room" : "Reopen the room"}</button>
            <a href={`#/elasticity?room=${room.code}`} style={{ ...primary, textDecoration: "none" }}>Analyse in the Elasticity Lab →</a>
          </div>

          <div style={{ marginTop: 14, padding: 11, border: `1px solid ${C.bord}`, borderRadius: 8, background: C.surf }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Grow the sample</div>
            <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, margin: "0 0 8px" }}>
              {ladder
                ? <>Pause when you want to discuss the curve; reopen later in this class, another day or with another class group: new students
                  join with the same QR code and climb the whole ladder. To ask everybody again, start a new wave below — each student gets a new
                  ladder around the new price.</>
                : <>Pause when you want to discuss the curve; when you want more answers — later in this class, another day or with another class
                  group — add rounds and reopen. Students who had finished get new offers; new students join with the same QR code.</>}
              {" "}Every group adds to the same curve.{state?.expires ? ` The room is kept until ${new Date(state.expires).toLocaleDateString()} (each reopening extends it 60 days).` : ""}
            </p>
            <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
              {!ladder && <>
                <input value={add} onChange={(e) => setAdd(e.target.value)} inputMode="numeric" style={{ ...inp, width: 56 }} />
                <button onClick={() => { const n = Math.round(Number(add)); if (n >= 1) conn.current?.send({ t: "rounds", add: n }); }} style={ghost}>+ rounds for everybody</button>
              </>}
              <button onClick={() => { if (confirm("Pause the room and count the groups that did not fill (with at least 2 answers)? You can reopen it afterwards.")) conn.current?.send({ t: "finish" }); }} style={ghost}>Pause and count incomplete groups</button>
              <button onClick={onClose} style={ghost} title="The room keeps running and keeps its answers; open it again from the list at the top">Close this panel</button>
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
        {stated > 0 && (
          <label style={{ fontSize: 12, color: C.mut, display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}
            title="The class's phase-1 WTP answers played at the phase-2 prices: yes where the stated maximum reaches the price">
            <input type="checkbox" checked={withStated} onChange={(e) => setWithStated(e.target.checked)} />
            include the synthetic seed ({stated} groups: {state?.cfg.mode === "wtp" ? "what the class said in phase 1, at these prices" : "a small prior through the starting price"}) — switch it off to see the real answers alone
          </label>
        )}
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
            <ElasticityWarnings segments={fit.f.bySegment} aroundOptimum={state.cfg.mode === "wtp"} />
            {state.phase === "prices" && <AutoWaves state={state} send={(m) => conn.current?.send(m)} />}
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
          <p style={{ fontSize: 11.5, color: C.mut }}>* nobody bought: plotted at half an acceptance so the logarithm exists.
            {stated > 0 && ` The ${stated} groups of the phase-1 base are not listed here; the Lab shows them with source = stated.`}</p>
        </div>
      )}
    </Section>
  );
}

/* Automatic waves: what the rules did and why. Nothing to decide; one button
 * moves to the next wave now, for when the class is short of time. */
function AutoWaves({ state, send }) {
  const cfg = state.cfg;
  const wave = cfg.wave ?? 1, total = cfg.autoWaves ?? 1, auto = cfg.auto !== false;
  const path = cfg.path || cfg.waves || [];
  const combos = combosOf(cfg);
  return (
    <div style={{ marginTop: 16, padding: 12, border: `1px solid ${C.bord}`, borderRadius: 8, background: C.surf }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Automatic prices · wave {wave} of {total}</div>
      <p style={{ fontSize: 12, color: C.mut, lineHeight: 1.6, margin: "4px 0 10px" }}>
        {wave < total && auto
          ? <>When everybody who started this wave has climbed the whole ladder (or 80% have and nobody has answered for 45 seconds), the room
            moves each situation's prices to where the answers point — Lerner's rule on the local elasticity, the ends where about 90% and 10% would buy —
            and every student gets a new ladder. Keep this page open: it runs the waves.</>
          : <>This is the last wave: the prices stay where they are. New students can still join and climb it.</>}
      </p>
      <Table head={["situation", "prices now", "why"]}
        rows={combos.map((c) => {
          const k = comboKey(c), last = path[path.length - 1];
          return [c.length ? c.join(" · ") : "all", `${(cfg.grids?.[k] ?? cfg.grid).map(f2).join(" · ")} ${cfg.currency}`,
            <span style={{ fontSize: 11.5 }}>{last?.reasons?.[k] || (last?.from === "wtp" ? "WTP optimum" : "starting price")}</span>];
        })} />
      {wave < total && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 9 }}>
          <button onClick={() => send({ t: "next-wave" })} style={ghost}>Move to wave {wave + 1} now</button>
          <span style={{ fontSize: 11.5, color: C.mut }}>Only if the class is short of time: the room does it by itself otherwise.</span>
        </div>
      )}
      {path.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 5 }}>price path (centre of each wave)</div>
          <Table head={["wave", "from", ...combos.map((c) => c.join(" · ") || "centre")]}
            rows={path.map((w) => [w.wave, w.from === "wtp" ? "WTP optimum" : w.from === "rules" || w.from === "elasticity" ? "the rules" : "lecturer", ...combos.map((c) => `${f2(w.centres[comboKey(c)])} ${cfg.currency}`)])} />
        </div>
      )}
    </div>
  );
}

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const primary = { background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6, padding: "8px 15px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "inline-block" };
const ghost = { background: C.card, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6, padding: "7px 13px", fontSize: 12.5, cursor: "pointer" };
