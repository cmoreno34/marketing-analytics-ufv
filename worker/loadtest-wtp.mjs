/* Load test for a two-phase room: 50 students give their maximum price for
 * each situation (phase 1), the lecturer starts the prices around the WTP
 * optimum of each situation (phase 2), and the students climb the price
 * ladder, answering as their stated WTP says (with a little noise).
 *
 *   node loadtest-wtp.mjs [baseUrl] [students]
 *   node loadtest-wtp.mjs http://127.0.0.1:8787 50
 *
 * Halfway through phase 2 the lecturer starts a second wave, centred where the
 * measured elasticity points (src/lib/dynamic.js), as the room page does.
 *
 * Checks: every WTP answer is stored; no offer is made during phase 1; phase 2
 * is centred on the WTP optimum, on round prices, and starts with the phase-1
 * base (stated groups at every price); within a wave each student's offers go
 * situation by situation in the order written, and from the lowest price to
 * the highest; every offer is on the grid of its wave; every student finishes. */
import { wtpOptimum, frequencies, scaleLevels, centredGrid } from "../src/lib/wtp.js";
import { groupRows, roomSpec } from "../src/lib/room.js";
import { fitElasticity } from "../src/lib/elasticity.js";
import { suggestCentre } from "../src/lib/dynamic.js";

const BASE = process.argv[2] || "http://127.0.0.1:8787";
const N = Number(process.argv[3] || 50);
const WS = BASE.replace(/^http/, "ws");
const scale = scaleLevels(2, 16, 1);
const LEVELS = ["it is raining", "it is not raining"];
const cfg = {
  product: "Folding umbrella", description: "load test", currency: "€", base: 8, rangePct: 30, levels: 7, groupSize: 5, rounds: 14, order: "ladder",
  mode: "wtp", wtpScale: scale, cost: 3,
  situations: [{ name: "weather", question: "As you come out of the metro,", levels: LEVELS }],
};
const created = await (await fetch(`${BASE}/room/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: cfg }) })).json();
if (!created.code) { console.error("create failed", created); process.exit(1); }
const { code, hostKey } = created;
console.log(`room ${code}: ${N} students, WTP phase then a ladder of ${created.config.rounds} offers each (±${cfg.rangePct}%, ${cfg.levels} prices)`);

const host = new WebSocket(`${WS}/room/${code}/ws?role=host&key=${hostKey}`);
let hostState = null;
host.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "state") hostState = m; else if (m.t === "count") hostState = { ...hostState, ...m }; };
await new Promise((r) => (host.onopen = r));

const normal = () => Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
const snap = (v) => scale.reduce((b, p) => (Math.abs(p - v) < Math.abs(b - v) ? p : b), scale[0]);
const problems = [];
let phase1Offers = 0;
let centres = null, wave = 1;
const grids = {};                         // wave → situation → grid
const addGrid = (w, cs) => { grids[w] = Object.fromEntries(Object.entries(cs).map(([k, v]) => [k, centredGrid(v, cfg.rangePct, cfg.levels)])); };

function student(i) {
  const dry = 7 * Math.exp(0.35 * normal());
  const wtp = { "it is raining": snap(dry * 1.5), "it is not raining": snap(dry) };
  const seq = [];                         // [wave, situation index, price] of every offer
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/room/${code}/ws?role=student&rid=wtp${i}x${Math.random().toString(36).slice(2, 8)}`);
    let done = 0;
    const timeout = setTimeout(() => reject(new Error(`student ${i} stuck at ${done}`)), 240000);
    const finish = () => { clearTimeout(timeout); ws.close(); resolve(seq); };
    ws.onmessage = async (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "hello") {
        await new Promise((r) => setTimeout(r, Math.random() * 2000));
        ws.send(JSON.stringify({ t: "wtp", answers: wtp }));
        ws.send(JSON.stringify({ t: "next" }));          // must not get an offer in phase 1
      } else if (m.t === "offer") {
        if (!centres) { phase1Offers++; return; }
        const w = m.wave;
        if (!grids[w]?.[m.levels[0]]?.includes(m.price)) problems.push(`offer ${m.price} (${m.levels.join("|")}) not on the grid of wave ${w}`);
        seq.push([w, LEVELS.indexOf(m.levels[0]), m.price]);
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 400));
        const mine = wtp[m.levels[0]] * Math.exp(0.08 * normal());
        ws.send(JSON.stringify({ t: "answer", group: m.group, buy: mine >= m.price }));
      } else if (m.t === "phase" && m.phase === "prices") ws.send(JSON.stringify({ t: "next" }));
      else if (m.t === "ok") {
        done = m.me.done;
        if (done >= m.me.rounds) finish(); else ws.send(JSON.stringify({ t: "next" }));
      } else if (m.t === "finished") finish();
      else if (m.t === "wait") setTimeout(() => ws.send(JSON.stringify({ t: "next" })), 400);
      else if (m.t === "error") { if (centres) setTimeout(() => ws.send(JSON.stringify({ t: "next" })), 200); else problems.push(m.error); }
    };
  });
}

const t0 = performance.now();
const all = Array.from({ length: N }, (_, i) => student(i));
while (!(hostState?.wtpAnswers >= N)) await new Promise((r) => setTimeout(r, 200));
const d1 = await (await fetch(`${BASE}/room/${code}/data`)).json();
centres = {};
const optimum = {};
for (const lv of LEVELS) {
  const o = wtpOptimum(scale, frequencies(d1.wtp[lv], scale), { vcu: cfg.cost });
  optimum[lv] = o.optPrice;
  centres[lv] = Math.round(o.optPrice * 100) / 100;
}
addGrid(1, centres);
host.send(JSON.stringify({ t: "start-prices", centres }));
console.log(`phase 1: ${d1.wtpAnswers} WTP answers in ${((performance.now() - t0) / 1000).toFixed(1)}s; offers during phase 1: ${phase1Offers}`);

// Phase 2 starts from the WTP optimum, on round prices, with the phase-1 base.
await new Promise((r) => setTimeout(r, 300));
const d2 = await (await fetch(`${BASE}/room/${code}/data`)).json();
for (const lv of LEVELS) {
  const g = d2.cfg.grids[lv];
  const stated = d2.groups.filter((x) => x.synthetic && x.levels[0] === lv);
  console.log(`  ${lv}: WTP optimum ${optimum[lv].toFixed(2)} → phase-2 prices ${g.join(" · ")}; phase-1 base: ${stated.length} groups, ${stated.reduce((a, x) => a + x.n, 0)} stated answers`);
  if (JSON.stringify(g) !== JSON.stringify(grids[1][lv])) problems.push(`${lv}: room grid ${g} ≠ ${grids[1][lv]}`);
  if (Math.abs(g[3] - optimum[lv]) > (g[1] - g[0]) / 2 + 1e-9) problems.push(`${lv}: grid centre ${g[3]} far from the WTP optimum ${optimum[lv]}`);
  // One set of groups of the room's size per price; a last group of one joins the one before.
  const teams = N % cfg.groupSize === 1 ? Math.floor(N / cfg.groupSize) : Math.ceil(N / cfg.groupSize);
  if (stated.length !== g.length * teams) problems.push(`${lv}: ${stated.length} stated groups, expected ${g.length * teams}`);
  if (new Set(stated.map((x) => x.price)).size !== g.length) problems.push(`${lv}: stated groups not at every price`);
}
const fitOf = (groups, w) => {
  const rows = groupRows(groups, d2.cfg);
  return fitElasticity(rows, roomSpec(d2.cfg, rows)).bySegment.map((s) => `${s.level}: ε ${s.eps.toFixed(2)} [${s.lo.toFixed(2)}, ${s.hi.toFixed(2)}]`).join(" · ");
};
console.log(`  the curve before any real answer (phase-1 base alone): ${fitOf(d2.groups)}`);

// Halfway: wave 2, centred where the elasticity measured so far points.
while (!((await (await fetch(`${BASE}/room/${code}/data`)).json()).answers >= (N * created.config.rounds) / 2)) await new Promise((r) => setTimeout(r, 300));
const dh = await (await fetch(`${BASE}/room/${code}/data`)).json();
const next = {};
for (const lv of LEVELS) {
  const pts = dh.groups.filter((g) => g.closed && g.levels[0] === lv).map((g) => ({ price: g.price, share: (g.yes || 0.5) / g.n, wave: g.wave }));
  const sgg = suggestCentre({ rows: pts, centre: centres[lv], prices: dh.cfg.grids[lv], cost: cfg.cost, wave: 1 });
  next[lv] = sgg.price;
  console.log(`  wave 2 · ${lv}: ${pts.length} points (with the base), ε ${sgg.fit ? sgg.fit.eps.toFixed(2) : "—"} → ${centres[lv]} → ${sgg.price} (${sgg.reason})`);
}
addGrid(2, next);
wave = 2;
host.send(JSON.stringify({ t: "recentre", centres: next }));
const res = await Promise.allSettled(all);
host.send(JSON.stringify({ t: "finish" }));
await new Promise((r) => setTimeout(r, 600));
const d = await (await fetch(`${BASE}/room/${code}/data`)).json();
host.close();

// The ladder: within a wave, situation by situation, prices going up.
let unordered = 0;
for (const r of res) if (r.status === "fulfilled") {
  const seq = r.value;
  for (let i = 1; i < seq.length; i++) {
    const [w0, s0, p0] = seq[i - 1], [w1, s1, p1] = seq[i];
    if (w1 === w0 && (s1 < s0 || (s1 === s0 && p1 <= p0))) unordered++;
  }
}
if (unordered) problems.push(`${unordered} offers out of ladder order`);
const realN = d.groups.filter((g) => !g.synthetic).reduce((a, g) => a + g.n, 0);
if (d.answers !== realN) problems.push(`answers ${d.answers} ≠ the real groups' ${realN}: the phase-1 base is being counted`);
const ex = res.find((r) => r.status === "fulfilled" && r.value.length >= 14)?.value;
if (ex) console.log(`  one student's offers: ${ex.map(([w, s, p]) => `${w}${s ? "d" : "r"}${p}`).join(" ")}  (wave, r = raining / d = dry, price)`);

const failed = res.filter((r) => r.status === "rejected");
console.log(`phase 2: ${N - failed.length}/${N} students finished in ${((performance.now() - t0) / 1000).toFixed(1)}s; real answers ${d.answers}; stated groups ${d.statedGroups}; wave ${d.cfg.wave}; real groups per wave`,
  d.groups.filter((g) => !g.synthetic).reduce((a, g) => ({ ...a, [g.wave]: (a[g.wave] || 0) + 1 }), {}));
console.log("  price path", d.cfg.waves.map((w) => w.centres));
console.log(`  ε, real answers only:      ${fitOf(d.groups.filter((g) => !g.synthetic))}`);
console.log(`  ε, with the phase-1 base:  ${fitOf(d.groups)}`);
console.log(`problems: ${problems.length}${problems.length ? " — " + problems.slice(0, 5).join("; ") : ""}`);
process.exit(failed.length || problems.length || phase1Offers ? 1 : 0);
