/* Load test for crossed situations and for growing a room's sample:
 * 50 students answer 3 rounds in a room with two situations (one numeric);
 * the lecturer pauses, adds 2 rounds and reopens; every student carries on
 * to 5 rounds.
 *
 *   node loadtest-grow.mjs [baseUrl] [students]
 *   node loadtest-grow.mjs http://127.0.0.1:8787 50
 *
 * Checks: every offer carries one level per situation; nobody gets the same
 * price + situations twice while fresh ones remain; finished students resume
 * after the added rounds only once the room reopens; the room reports when it
 * expires. */
const BASE = process.argv[2] || "http://127.0.0.1:8787";
const N = Number(process.argv[3] || 50);
const WS = BASE.replace(/^http/, "ws");
const cfg = {
  product: "Taxi ride home", description: "load test", currency: "€", base: 18, rangePct: 50, levels: 7, groupSize: 5, rounds: 3,
  situations: [
    { name: "weather", question: "Outside", levels: ["it is raining", "it is dry"] },
    { name: "temp", question: "It is", levels: ["5 °C", "15 °C", "25 °C"], numeric: true },
  ],
};
const created = await (await fetch(`${BASE}/room/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: cfg }) })).json();
if (!created.code) { console.error("create failed", created); process.exit(1); }
const { code, hostKey } = created;
console.log(`room ${code}: ${N} students, 3 rounds, then +2 after a pause; situations ${created.config.situations.map((s) => s.name).join(" × ")}`);

const host = new WebSocket(`${WS}/room/${code}/ws?role=host&key=${hostKey}`);
await new Promise((r) => (host.onopen = r));
const problems = [];
let pausedOffers = 0, paused = false;

function student(i, target) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/room/${code}/ws?role=student&rid=grow${i}`);
    const seen = new Set();
    let done = 0;
    const next = () => ws.send(JSON.stringify({ t: "next" }));
    const st = { ws, reached: (n) => new Promise((r) => { st.wait = { n, r }; if (done >= n) r(); }) };
    const timeout = setTimeout(() => reject(new Error(`student ${i} stuck after ${done}`)), 180000);
    ws.onmessage = async (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "hello") next();
      else if (m.t === "offer") {
        if (paused) pausedOffers++;
        if (!Array.isArray(m.levels) || m.levels.length !== 2) problems.push(`offer without two levels: ${JSON.stringify(m)}`);
        const key = `${m.price}|${m.levels.join("|")}`;
        if (seen.has(key)) problems.push(`repeat for ${i}: ${key}`);
        seen.add(key);
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 800));
        ws.send(JSON.stringify({ t: "answer", group: m.group, buy: Math.random() < 18 / m.price / 2 }));
      } else if (m.t === "ok") {
        done = m.me.done;
        if (st.wait && done >= st.wait.n) st.wait.r();
        if (done < m.me.rounds) next();
        if (done >= target) { clearTimeout(timeout); resolve(st); }
      } else if (m.t === "rounds") next();                 // the lecturer added rounds
      else if (m.t === "open" && m.open) next();           // reopened after a pause
      else if (m.t === "wait") setTimeout(next, 400);
      else if (m.t === "error") setTimeout(next, 200);
    };
    st.done = () => done;
  });
}

const t0 = performance.now();
// Phase 1: everybody answers 3 rounds; sockets stay open.
const studs = [];
const phase1 = Array.from({ length: N }, (_, i) => {
  const p = student(i, 5);
  return p;
});
// Wait until 3 rounds are in for everybody, watching the room's counter.
for (;;) {
  const d = await (await fetch(`${BASE}/room/${code}/data`)).json();
  if (d.answers >= N * 3) break;
  await new Promise((r) => setTimeout(r, 300));
}
console.log(`phase 1: ${N * 3} answers in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

// Pause, add two rounds while paused: nobody may get an offer.
paused = true;
host.send(JSON.stringify({ t: "close" }));
await new Promise((r) => setTimeout(r, 300));
host.send(JSON.stringify({ t: "rounds", add: 2 }));
await new Promise((r) => setTimeout(r, 1500));
const offersWhilePaused = pausedOffers;
paused = false;
host.send(JSON.stringify({ t: "open" }));

const results = await Promise.allSettled(phase1);
const d = await (await fetch(`${BASE}/room/${code}/data`)).json();
host.send(JSON.stringify({ t: "finish" }));
await new Promise((r) => setTimeout(r, 500));
const d2 = await (await fetch(`${BASE}/room/${code}/data`)).json();
for (const r of results) if (r.status === "fulfilled") r.value.ws.close();
host.close();

const failed = results.filter((r) => r.status === "rejected");
const closed = d2.groups.filter((g) => g.closed);
const days = (d2.expires - Date.now()) / 86400000;
console.log(`finished: ${N - failed.length}/${N} students reached 5 rounds in ${((performance.now() - t0) / 1000).toFixed(1)}s ${failed.map((f) => f.reason.message).join("; ")}`);
console.log(`answers: ${d2.answers} (expected ${N * 5}) · rounds in the room: ${d2.cfg.rounds} · closed groups: ${closed.length}`);
console.log(`offers sent while paused: ${offersWhilePaused} (expected 0)`);
console.log(`every group has two levels: ${closed.every((g) => g.levels?.length === 2)} · room expires in ${days.toFixed(1)} days`);
console.log(`problems: ${problems.length}${problems.length ? ` — ${problems.slice(0, 3).join("; ")}` : ""}`);
const cells = {};
for (const g of closed) cells[g.levels[0]] = (cells[g.levels[0]] || 0) + 1;
console.log("groups per weather:", cells);
process.exit(failed.length || problems.length || offersWhilePaused || d2.answers !== N * 5 ? 1 : 0);
