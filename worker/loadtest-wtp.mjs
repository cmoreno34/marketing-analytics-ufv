/* Load test for a two-phase room: 50 students give their maximum price for
 * each situation (phase 1), the lecturer starts the prices around the WTP
 * optimum of each situation (phase 2), and the students answer the offers as
 * their stated WTP says (with a little noise).
 *
 *   node loadtest-wtp.mjs [baseUrl] [students]
 *   node loadtest-wtp.mjs http://127.0.0.1:8787 50
 *
 * Checks: every WTP answer is stored; no offer is made during phase 1; every
 * offer of phase 2 is within ±range% of its situation's centre; every student
 * finishes; and the elasticity measured in phase 2 against the one the WTP
 * optimum implies (Lerner). */
import { wtpOptimum, frequencies, scaleLevels, lernerElasticity } from "../src/lib/wtp.js";
import { groupRows, roomSpec } from "../src/lib/room.js";
import { fitElasticity, statedElasticity } from "../src/lib/elasticity.js";

const BASE = process.argv[2] || "http://127.0.0.1:8787";
const N = Number(process.argv[3] || 50);
const WS = BASE.replace(/^http/, "ws");
const scale = scaleLevels(2, 16, 1);
const cfg = {
  product: "Folding umbrella", description: "load test", currency: "€", base: 8, rangePct: 15, levels: 7, groupSize: 5, rounds: 6,
  mode: "wtp", wtpScale: scale, cost: 3,
  situations: [{ name: "weather", question: "As you come out of the metro,", levels: ["it is raining", "it is not raining"] }],
};
const created = await (await fetch(`${BASE}/room/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: cfg }) })).json();
if (!created.code) { console.error("create failed", created); process.exit(1); }
const { code, hostKey } = created;
console.log(`room ${code}: ${N} students, WTP phase then ${cfg.rounds} rounds at ±${cfg.rangePct}%`);

const host = new WebSocket(`${WS}/room/${code}/ws?role=host&key=${hostKey}`);
let hostState = null;
host.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "state") hostState = m; else if (m.t === "count") hostState = { ...hostState, ...m }; };
await new Promise((r) => (host.onopen = r));

const normal = () => Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
const snap = (v) => scale.reduce((b, p) => (Math.abs(p - v) < Math.abs(b - v) ? p : b), scale[0]);
const problems = [];
let phase1Offers = 0;
let centres = null;

function student(i) {
  const dry = 7 * Math.exp(0.35 * normal());
  const wtp = { "it is raining": snap(dry * 1.5), "it is not raining": snap(dry) };
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/room/${code}/ws?role=student&rid=wtp${i}`);
    let done = 0;
    const timeout = setTimeout(() => reject(new Error(`student ${i} stuck at ${done}`)), 180000);
    ws.onmessage = async (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "hello") {
        await new Promise((r) => setTimeout(r, Math.random() * 2000));
        ws.send(JSON.stringify({ t: "wtp", answers: wtp }));
        ws.send(JSON.stringify({ t: "next" }));          // must not get an offer in phase 1
      } else if (m.t === "offer") {
        if (!centres) { phase1Offers++; return; }
        const c = centres[m.levels.join("|")];
        if (Math.abs(m.price / c - 1) > cfg.rangePct / 100 + 0.002) problems.push(`offer ${m.price} far from centre ${c}`);
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 600));
        const mine = wtp[m.levels[0]] * Math.exp(0.08 * normal());
        ws.send(JSON.stringify({ t: "answer", group: m.group, buy: mine >= m.price }));
      } else if (m.t === "phase" && m.phase === "prices") ws.send(JSON.stringify({ t: "next" }));
      else if (m.t === "ok") {
        done = m.me.done;
        if (done >= m.me.rounds) { clearTimeout(timeout); ws.close(); resolve(done); } else ws.send(JSON.stringify({ t: "next" }));
      } else if (m.t === "wait") setTimeout(() => ws.send(JSON.stringify({ t: "next" })), 400);
      else if (m.t === "error") { if (centres) setTimeout(() => ws.send(JSON.stringify({ t: "next" })), 200); else problems.push(m.error); }
    };
  });
}

const t0 = performance.now();
const all = Array.from({ length: N }, (_, i) => student(i));
while (!(hostState?.wtpAnswers >= N)) await new Promise((r) => setTimeout(r, 200));
const d1 = await (await fetch(`${BASE}/room/${code}/data`)).json();
centres = {};
for (const lv of cfg.situations[0].levels) {
  const o = wtpOptimum(scale, frequencies(d1.wtp[lv], scale), { vcu: cfg.cost });
  centres[lv] = Math.round(o.optPrice * 100) / 100;
}
console.log(`phase 1: ${d1.wtpAnswers} WTP answers in ${((performance.now() - t0) / 1000).toFixed(1)}s; offers during phase 1: ${phase1Offers}; centres`, centres);
host.send(JSON.stringify({ t: "start-prices", centres }));
const res = await Promise.allSettled(all);
host.send(JSON.stringify({ t: "finish" }));
await new Promise((r) => setTimeout(r, 600));
const d = await (await fetch(`${BASE}/room/${code}/data`)).json();
host.close();

const failed = res.filter((r) => r.status === "rejected");
console.log(`phase 2: ${N - failed.length}/${N} students finished in ${((performance.now() - t0) / 1000).toFixed(1)}s; answers ${d.answers} (expected ${N * cfg.rounds}); grids`, d.cfg.grids);
const rows = groupRows(d.groups, d.cfg);
const f = fitElasticity(rows, roomSpec(d.cfg, rows));
for (const s of f.bySegment) {
  const L = lernerElasticity(centres[s.level], cfg.cost);
  const st = statedElasticity(d1.wtp[s.level], d.cfg.grids[s.level]);
  console.log(`  ${s.level}: revealed ε ${s.eps.toFixed(2)} [${s.lo.toFixed(2)}, ${s.hi.toFixed(2)}] · stated (WTP answers at the same prices) ${st.toFixed(2)} → ${s.lo <= st && st <= s.hi ? "agree" : "differ"} · Lerner at the optimum ${L.toFixed(2)}`);
}
console.log(`problems: ${problems.length}${problems.length ? " — " + problems.slice(0, 3).join("; ") : ""}`);
process.exit(failed.length || problems.length || phase1Offers ? 1 : 0);
