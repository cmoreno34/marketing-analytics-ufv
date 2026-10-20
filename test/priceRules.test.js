/* The price-grid rules and the automatic waves.
 *
 * Every grid the rooms can produce obeys the rules of src/lib/priceRules.js;
 * a class whose real willingness to pay sits far above the starting price
 * pulls the grid up wave after wave without the lecturer touching anything;
 * and a one-phase room starts with its prior seed. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleGrid, clampBounds, wtpBounds, planNext, RULES } from "../src/lib/priceRules.js";
import { memoryStore } from "./memoryDb.js";
import { createRoom, studentSession, hostSession, viewOf, readRoom } from "../src/lib/roomEngine.js";

function obeys(g, centre, cost) {
  const step = g[1] - g[0], top = g[g.length - 1];
  assert.ok(g.length >= RULES.minLevels, `at least 5 prices: ${g}`);
  assert.ok(step / top >= RULES.minStepPct / 100 - 1e-9, `steps of 5% or more: ${g}`);
  assert.ok(g[0] > cost, `above cost ${cost}: ${g}`);
  assert.ok(g[0] <= centre && centre <= top, `centre ${centre} inside ${g}`);
  assert.ok((centre - g[0]) / centre <= 0.55 && (top - centre) / centre <= 0.55, `no wider than ±50%: ${g}`);
  assert.ok((centre - g[0]) / centre >= 0.15 && (top - centre) / centre >= 0.15, `no narrower than ±20%: ${g}`);
}

test("every grid obeys the rules, whatever the lecturer asks", () => {
  for (const [c, cost] of [[8, 3], [2.5, 0.6], [15, 6], [9, 2.5], [60, 20], [1.5, 0.25], [18, 8], [10, 0], [0.4, 0], [1234, 500]])
    for (const pct of [5, 10, 30, 60, 90]) for (const levels of [3, 5, 7, 9, 15]) {
      const g = ruleGrid({ centre: c, ...clampBounds(c, c * (1 - pct / 100), c * (1 + pct / 100)), levels, cost });
      obeys(g, c, cost);
    }
});

test("a centre at or below cost is pushed up so the lowest price clears the cost", () => {
  const g = ruleGrid({ centre: 3.2, lo: 2, hi: 4, levels: 7, cost: 3 });
  assert.ok(g[0] > 3, `${g}`);
});

test("the WTP ends are its 10th and 90th percentiles", () => {
  const b = wtpBounds(Array.from({ length: 101 }, (_, i) => 5 + i / 10));
  assert.ok(Math.abs(b.lo - 6) < 1e-9 && Math.abs(b.hi - 14) < 1e-9);
});

test("a wave where everybody bought at the top moves the grid up; nobody at the bottom moves it down", () => {
  const grid = [6, 7, 8, 9, 10];
  const all = grid.flatMap((p) => [1, 2, 3].map(() => ({ price: p, share: 1, wave: 1 })));
  const up = planNext({ rows: all, centre: 8, grid, cost: 3, wave: 1, levels: 5 });
  assert.ok(up.centre >= 10 && up.grid[0] >= 6, `${up.centre} ${up.grid} — ${up.reason}`);
  const none = grid.flatMap((p) => [1, 2, 3].map(() => ({ price: p, share: 0.05, wave: 1 })));
  const down = planNext({ rows: none, centre: 8, grid, cost: 3, wave: 1, levels: 5 });
  assert.ok(down.centre <= 6, `${down.centre} — ${down.reason}`);
  obeys(down.grid, down.centre, 3);
});

/* A phone that climbs every wave until the room has no more. */
function climber(db, code, wtp) {
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const s = studentSession(db, code, (m) => {
    if (m.t === "hello" || m.t === "rounds") s.send({ t: "next" });
    else if (m.t === "offer") setTimeout(() => s.send({ t: "answer", group: m.group, buy: wtp >= m.price }), Math.random() * 6);
    else if (m.t === "ok") s.send({ t: "next" });
    else if (m.t === "wait" || m.t === "error") setTimeout(() => s.send({ t: "next" }), 5);
    else if (m.t === "finished") resolve();
  });
  return { s, done };
}

test("automatic waves: a class that values the product far above the start pulls the prices up", { timeout: 90000 }, async () => {
  const store = memoryStore();
  const host = store.client("host");
  const { code } = await createRoom(host, {
    product: "Folding umbrella", currency: "€", base: 8, rangePct: 30, levels: 7, groupSize: 5, cost: 3, autoWaves: 3, situations: [],
  });
  let room = await readRoom(host, code);
  assert.ok(Object.values(room.stated).every((g) => g.prior), "a one-phase room starts with its prior seed");
  const h = hostSession(host, code, () => {}, { throttleMs: 10, idleMs: 200 });
  await h.ready;
  // Their willingness to pay: lognormal around 16 — twice the starting price.
  const wtp = (i) => 16 * Math.exp(0.35 * Math.sqrt(-2 * Math.log((i + 0.5) / 50)) * Math.cos(2 * Math.PI * ((i * 7) % 50) / 50));
  const waveDone = async (w) => {
    for (let t = 0; t < 400; t++) {
      room = await readRoom(host, code);
      const cfg = JSON.parse(room.meta.cfg);
      if ((cfg.wave ?? 1) >= w) return cfg;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`wave ${w} never started`);
  };
  const phones = Array.from({ length: 50 }, (_, i) => climber(store.client(`a${i}`), code, wtp(i)));
  const c2 = await waveDone(2);
  const c3 = await waveDone(3);
  await Promise.all(phones.map((p) => p.done));
  await new Promise((r) => setTimeout(r, 300));
  const v = viewOf(await readRoom(host, code));
  assert.equal(v.cfg.wave, 3, "no wave beyond the three set");
  const centres = v.cfg.path.map((w) => w.centres[""]);
  assert.ok(centres[1] > centres[0] && centres[2] > centres[0], `the price climbs: ${centres}`);
  for (const cfg of [c2, c3]) obeys(cfg.grids[""], cfg.centres[""], 3);
  assert.ok(v.cfg.path.slice(1).every((w) => w.from === "rules" && w.reasons[""]), "each wave says why");
  // The seed covers the new prices too.
  const seededPrices = new Set(v.groups.filter((g) => g.synthetic).map((g) => g.price));
  assert.ok(v.cfg.grids[""].every((p) => seededPrices.has(p)), "every price has its seed");
  h.close();
  for (const p of phones) p.s.close();
});
