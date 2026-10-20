/* An in-memory stand-in for the realtime database, for the room tests and
 * the simulator on the room guide page (price-room-guide).
 *
 * One shared tree; every call waits a random 0–6 ms first, so fifty simulated
 * phones interleave their reads and writes the way real ones do. A transaction
 * reads, applies and writes in one step after its wait — atomic, as Firebase's
 * are once their optimistic retries settle. Listeners are told about every
 * change at or below the path they watch. */
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const parts = (p) => p.split("/").filter(Boolean);

export function memoryStore() {
  const tree = {};
  const listeners = new Set();
  const read = (path) => parts(path).reduce((n, k) => (n == null ? null : n[k] ?? null), tree);
  const write = (path, value) => {
    const ks = parts(path);
    let n = tree;
    for (const k of ks.slice(0, -1)) n = n[k] ??= {};
    if (value === null || value === undefined) delete n[ks[ks.length - 1]];
    else n[ks[ks.length - 1]] = clone(value);
  };
  const notify = (changed) => {
    for (const l of listeners) {
      if (changed.startsWith(l.path) || l.path.startsWith(changed)) setTimeout(() => l.cb(clone(read(l.path))), 0);
    }
  };
  const wait = () => new Promise((r) => setTimeout(r, Math.random() * 6));
  let clock = 1_000_000;
  const client = (uid) => ({
    uid,
    now: () => clock++,
    get: async (p) => { await wait(); return clone(read(p)); },
    set: async (p, v) => { await wait(); write(p, v); notify(p); },
    update: async (p, vals) => { await wait(); for (const [k, v] of Object.entries(vals)) write(`${p}/${k}`, v); notify(p); },
    txn: async (p, fn) => {
      await wait();
      const next = fn(clone(read(p)));
      if (next === undefined) return { committed: false, value: clone(read(p)) };
      write(p, next); notify(p);
      return { committed: true, value: clone(next) };
    },
    listen: (p, cb) => {
      const l = { path: p, cb };
      listeners.add(l);
      setTimeout(() => cb(clone(read(p))), 0);
      return () => listeners.delete(l);
    },
    presence: (p) => { write(p, true); notify(p); },
    onConnection: (f) => { f(true); return () => {}; },
  });
  return { client, tree };
}
