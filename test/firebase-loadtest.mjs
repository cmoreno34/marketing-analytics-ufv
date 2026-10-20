/* Load test against the real Firebase project: N phones, each its own anonymous
 * user, climb the ladder of a fresh room at the same time.
 *
 *   node test/firebase-loadtest.mjs 50
 *
 * Uses src/lib/firebaseConfig.js (or VITE_FIREBASE_CONFIG). Prints how many
 * finished, the group sizes, and the time from asking for an offer to getting
 * it. The room it creates stays in the database; delete it from the console if
 * you want it gone. */
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, get, set, update, runTransaction, onValue } from "firebase/database";
import { FIREBASE_CONFIG } from "../src/lib/firebaseConfig.js";
import { createRoom, studentSession, hostSession, readRoom, viewOf, ladderOf } from "../src/lib/roomEngine.js";

const N = Number(process.argv[2] || 50);

async function client(name) {
  const app = initializeApp(FIREBASE_CONFIG, name);
  const user = (await signInAnonymously(getAuth(app))).user;
  const db = getDatabase(app);
  return {
    uid: user.uid, now: () => Date.now(),
    get: async (p) => (await get(ref(db, p))).val(),
    set: (p, v) => set(ref(db, p), v),
    update: (p, v) => update(ref(db, p), v),
    txn: async (p, fn) => { const r = await runTransaction(ref(db, p), fn, { applyLocally: false }); return { committed: r.committed, value: r.snapshot.val() }; },
    listen: (p, cb) => onValue(ref(db, p), (s) => cb(s.val())),
    presence: (p) => set(ref(db, p), true),
    onConnection: (f) => { f(true); return () => {}; },
  };
}

const host = await client("host");
const { code } = await createRoom(host, {
  product: "Folding umbrella (load test)", currency: "€", base: 8, rangePct: 30, levels: 5, groupSize: 5,
  situations: [{ name: "weather", question: "It is", levels: ["raining", "not raining"] }],
});
let closedLive = 0;
const h = hostSession(host, code, (m) => { if (m.t === "state") closedLive = m.closedGroups; });
await h.ready;
console.log(`room ${code}: ${N} phones, groups of 5`);

const lat = [];
const phones = await Promise.all(Array.from({ length: N }, (_, i) => client(`p${i}`)));
const t0 = Date.now();
const results = await Promise.allSettled(phones.map((db) => new Promise((resolve, reject) => {
  let asked = 0;
  const timer = setTimeout(() => reject(new Error("stuck")), 180000);
  const s = studentSession(db, code, (m) => {
    if (m.t === "hello" || m.t === "ok") { asked = Date.now(); s.send({ t: "next" }); }
    else if (m.t === "offer") {
      lat.push(Date.now() - asked);
      const max = 8 * (m.level === "raining" ? 1.3 : 0.85) * (0.8 + Math.random() * 0.4);
      setTimeout(() => s.send({ t: "answer", group: m.group, buy: max >= m.price }), 300 + Math.random() * 1200);
    } else if (m.t === "finished") { clearTimeout(timer); resolve(); }
    else if (m.t === "wait" || m.t === "error") setTimeout(() => s.send({ t: "next" }), 300);
  });
})));
const secs = ((Date.now() - t0) / 1000).toFixed(1);
await new Promise((r) => setTimeout(r, 1500));
const v = viewOf(await readRoom(host, code));
const real = v.groups.filter((g) => !g.synthetic);
lat.sort((a, b) => a - b);
const q = (p) => lat[Math.floor(p * (lat.length - 1))];
console.log(`finished: ${results.filter((r) => r.status === "fulfilled").length}/${N} in ${secs}s`);
console.log(`answers: ${v.answers} (expected ${N * ladderOf(v.cfg).length}) · groups: ${real.length}, sizes ${[...new Set(real.map((g) => g.n))].join(",")} · seen live by the lecturer: ${closedLive}`);
console.log(`offer time ms: median ${q(0.5)}, p95 ${q(0.95)}, max ${q(1)}`);
process.exit(0);
