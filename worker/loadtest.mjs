/* Load test for the live price rooms: N students answer R rounds each, all at
 * the same time, against a running Worker (local `wrangler dev` or deployed).
 *
 *   node loadtest.mjs [baseUrl] [students] [rounds]
 *   node loadtest.mjs http://127.0.0.1:8787 50 5
 *   node loadtest.mjs http://127.0.0.1:8787 30 4 ABCDE     (join an existing room, no host checks)
 *
 * Checks: every student finishes every round; every closed group has exactly
 * groupSize answers; no student is offered the same price+situation twice while
 * unused ones remain; and reports the round-trip time of each offer. */
const BASE = process.argv[2] || "http://127.0.0.1:8787";
const N = Number(process.argv[3] || 50);
let R = Number(process.argv[4] || 5);
const WS = BASE.replace(/^http/, "ws");

const cfg = { product: "Folding umbrella", description: "load test", currency: "€", base: 8, rangePct: 50, levels: 7,
  groupSize: 5, rounds: R, situation: { name: "weather", question: "It is", levels: ["raining", "not raining"] } };

const JOIN = process.argv[5];
const created = JOIN ? { code: JOIN } : await (await fetch(`${BASE}/room/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: cfg }) })).json();
if (!created.code) { console.error("create failed", created); process.exit(1); }
const { code, hostKey } = created;
if (JOIN) {
  // Join someone else's room: answer as N students and stop; the room's own
  // settings decide group size and rounds.
  const info = await (await fetch(`${BASE}/room/${code}/data`)).json();
  Object.assign(cfg, info.cfg);
  R = cfg.rounds;
}
console.log(`room ${code}: ${N} students × ${R} rounds, groups of ${cfg.groupSize}`);

// The lecturer's screen, counting closed groups as they are pushed.
let pushed = 0;
const host = JOIN ? null : new WebSocket(`${WS}/room/${code}/ws?role=host&key=${hostKey}`);
if (host) {
  host.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "group") pushed++; };
  await new Promise((r) => (host.onopen = r));
}

const latencies = [], repeats = [];
function student(i) {
  return new Promise((resolve, reject) => {
    const wtp = 8 * Math.exp(0.35 * (Math.random() * 2 - 1) * 1.7);
    const ws = new WebSocket(`${WS}/room/${code}/ws?role=student&rid=load${i}`);
    const seen = new Set();
    let sent = 0, done = 0;
    const next = () => { sent = performance.now(); ws.send(JSON.stringify({ t: "next" })); };
    const timeout = setTimeout(() => reject(new Error(`student ${i} stuck after ${done} rounds`)), 120000);
    ws.onmessage = async (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "hello") next();
      else if (m.t === "offer") {
        latencies.push(performance.now() - sent);
        const key = `${m.price}|${m.level}`;
        if (seen.has(key)) repeats.push(key);
        seen.add(key);
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 1500));     // thinking time
        const willing = wtp * (/rain(?!.*not)|raining$/.test(m.level || "") && !/not/.test(m.level || "") ? 1.5 : 0.8) * (cfg.base / 8);
        ws.send(JSON.stringify({ t: "answer", group: m.group, buy: willing >= m.price }));
      } else if (m.t === "ok") {
        done = m.me.done;
        if (done >= R) { clearTimeout(timeout); ws.close(); resolve(done); } else next();
      } else if (m.t === "wait") setTimeout(next, 500);
      else if (m.t === "error") setTimeout(next, 200);
    };
    ws.onerror = () => reject(new Error(`socket error for student ${i}`));
  });
}

const t0 = performance.now();
const results = await Promise.allSettled(Array.from({ length: N }, (_, i) => student(i)));
const secs = ((performance.now() - t0) / 1000).toFixed(1);
if (host) host.send(JSON.stringify({ t: "finish" }));
await new Promise((r) => setTimeout(r, 800));
const data = await (await fetch(`${BASE}/room/${code}/data`)).json();
host?.close();

const failed = results.filter((r) => r.status === "rejected");
const closed = data.groups.filter((g) => g.closed);
const bad = closed.filter((g) => g.n !== cfg.groupSize);
latencies.sort((a, b) => a - b);
const q = (p) => latencies[Math.floor(p * (latencies.length - 1))].toFixed(0);
console.log(`finished: ${N - failed.length}/${N} students in ${secs}s  ${failed.map((f) => f.reason.message).join("; ")}`);
console.log(`answers: ${data.answers} (expected ${N * R}) · closed groups: ${closed.length} (full ${closed.length - bad.length}, partial after finish ${bad.length}) · pushed to host live: ${pushed}`);
console.log(`offer round-trip ms: median ${q(0.5)}, p95 ${q(0.95)}, max ${q(1)}`);
console.log(`repeated price+situation for a student: ${repeats.length}`);
const cells = {};
for (const g of closed) cells[`${g.level}`] = (cells[`${g.level}`] || 0) + 1;
console.log("groups per situation:", cells);
process.exit(failed.length ? 1 : 0);
