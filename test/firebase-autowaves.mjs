/* The automatic waves against the real Firebase project: a one-phase room,
 * N phones whose willingness to pay sits around twice the starting price, and
 * the host page's session moving the prices by the rules.
 *
 *   node test/firebase-autowaves.mjs 15
 */
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, get, set, update, runTransaction, onValue } from "firebase/database";
import { FIREBASE_CONFIG } from "../src/lib/firebaseConfig.js";
import { createRoom, studentSession, hostSession, readRoom } from "../src/lib/roomEngine.js";

const N = Number(process.argv[2] || 15);
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
const { code, config } = await createRoom(host, { product: "Folding umbrella (auto-wave test)", currency: "€", base: 8, rangePct: 30, levels: 7, groupSize: 5, cost: 3, autoWaves: 2, situations: [] });
console.log(`room ${code}: wave 1 grid ${config.grid.join(" · ")}`);
const h = hostSession(host, code, () => {}, { idleMs: 5000 });
await h.ready;
const phones = await Promise.all(Array.from({ length: N }, (_, i) => client(`p${i}`)));
let wave2 = null;
await Promise.all(phones.map((db, i) => new Promise((resolve, reject) => {
  const wtp = 16 * Math.exp(0.35 * Math.cos((2 * Math.PI * i) / N));
  let wave = 1;
  const timer = setTimeout(() => reject(new Error("stuck")), 240000);
  const s = studentSession(db, code, (m) => {
    if (m.t === "hello" || m.t === "ok") s.send({ t: "next" });
    else if (m.t === "rounds") { wave = 2; s.send({ t: "next" }); }
    else if (m.t === "offer") setTimeout(() => s.send({ t: "answer", group: m.group, buy: wtp >= m.price }), 200 + Math.random() * 600);
    else if (m.t === "finished" && wave === 2) { clearTimeout(timer); resolve(); }
    else if (m.t === "wait" || m.t === "error") setTimeout(() => s.send({ t: "next" }), 300);
  });
})));
const room = await readRoom(host, code);
const cfg = JSON.parse(room.meta.cfg);
wave2 = cfg.grids[""];
console.log(`wave ${cfg.wave}: centre ${cfg.centres[""]}, grid ${wave2.join(" · ")}`);
console.log(`why: ${cfg.path.at(-1).reasons[""]}`);
console.log(`seed groups: ${Object.keys(room.stated).length} at prices ${[...new Set(Object.values(room.stated).map((g) => g.price))].sort((a, b) => a - b).join(" · ")}`);
h.close();
process.exit(0);
