/* The live rooms without a server: 50 phones at once against a shared database.
 *
 * Runs the room engine (src/lib/roomEngine.js) on an in-memory database whose
 * every call waits a random few milliseconds, so the phones' reads and writes
 * interleave. Checks what the Cloudflare Worker guaranteed: every student
 * climbs the whole ladder, every group has exactly the group size, nobody
 * answers the same step twice, the WTP phase builds its base, a new wave starts
 * a new ladder, and "finish" closes the groups left short. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryStore } from "./memoryDb.js";
import { createRoom, studentSession, hostSession, viewOf, readRoom, ladderOf } from "../src/lib/roomEngine.js";

const SCENARIO = {
  product: "Folding umbrella", currency: "€", base: 8, rangePct: 30, levels: 5, groupSize: 5,
  situations: [{ name: "weather", question: "It is", levels: ["raining", "not raining"] }],
};

/* A phone that climbs until it is told it has finished. */
function phone(db, code, { wtp = null, stopAfter = Infinity } = {}) {
  const seen = [];
  let done = false, answered = 0, resolve;
  const finished = new Promise((r) => (resolve = r));
  const s = studentSession(db, code, (m) => {
    if (m.t === "hello") { if (wtp && m.phase === "wtp") s.send({ t: "wtp", answers: wtp }); else s.send({ t: "next" }); }
    else if (m.t === "phase" && m.phase === "prices") s.send({ t: "next" });
    else if (m.t === "offer") {
      seen.push(`${m.wave}|${m.price}|${m.level}`);
      if (answered >= stopAfter) { resolve(); return; }      // walks away holding the seat
      const max = 8 * (m.level === "raining" ? 1.3 : 0.85) * (0.8 + Math.random() * 0.4);
      setTimeout(() => s.send({ t: "answer", group: m.group, buy: max >= m.price }), Math.random() * 10);
    } else if (m.t === "ok") { answered++; s.send({ t: "next" }); }
    else if (m.t === "finished") { done = true; resolve(); }
    else if (m.t === "rounds") s.send({ t: "next" });
    else if (m.t === "wait" || m.t === "error") setTimeout(() => s.send({ t: "next" }), 5);
  });
  return { s, seen, finished, isDone: () => done, answered: () => answered };
}

test("50 phones climb the ladder at once: full groups, no repeats, every answer counted", { timeout: 60000 }, async () => {
  const store = memoryStore();
  const host = store.client("host");
  const { code } = await createRoom(host, SCENARIO);
  const states = [];
  const h = hostSession(host, code, (m) => m.t === "state" && states.push(m), { throttleMs: 20 });
  await h.ready;
  const phones = Array.from({ length: 50 }, (_, i) => phone(store.client(`u${i}`), code));
  await Promise.all(phones.map((p) => p.finished));
  const room = await readRoom(host, code);
  const v = viewOf(room);
  const L = ladderOf(v.cfg).length;
  assert.equal(L, 10);
  assert.ok(phones.every((p) => p.isDone()), "every phone finished");
  assert.equal(v.answers, 50 * L, "every answer counted");
  const real = v.groups.filter((g) => !g.synthetic);
  assert.equal(real.length, 50 * L / 5);
  assert.ok(real.every((g) => g.n === 5 && g.closed), `group sizes: ${[...new Set(real.map((g) => g.n))]}`);
  for (const p of phones) assert.equal(new Set(p.seen).size, p.seen.length, "no student answers a step twice");
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(states.length > 0 && states.at(-1).closedGroups === 100, "the lecturer's screen sees every group");
  h.close();
});

test("WTP phase: answers, then the prices start with the phase-1 base", { timeout: 60000 }, async () => {
  const store = memoryStore();
  const host = store.client("host");
  const { code, config } = await createRoom(host, { ...SCENARIO, mode: "wtp", cost: 3, wtpScale: [4, 5, 6, 7, 8, 9, 10, 11, 12] });
  const h = hostSession(host, code, () => {}, { throttleMs: 10 });
  await h.ready;
  const phones = Array.from({ length: 20 }, (_, i) => phone(store.client(`w${i}`), code, { wtp: { raining: 9 + (i % 3), "not raining": 6 + (i % 3) } }));
  await new Promise((r) => setTimeout(r, 300));
  let room = await readRoom(host, code);
  assert.equal(Object.keys(room.wtp).length, 20, "every phone's maximum price is stored");
  assert.equal(room.meta.phase, "wtp");
  h.send({ t: "start-prices", centres: { raining: 9, "not raining": 6 } });
  await Promise.all(phones.map((p) => p.finished));
  room = await readRoom(host, code);
  const v = viewOf(room);
  const stated = v.groups.filter((g) => g.synthetic);
  assert.equal(stated.length, 2 * 5 * 4, "2 situations × 5 prices × 4 teams of 5");
  assert.equal(v.answers, 20 * 10, "stated answers are not counted as answers");
  assert.equal(v.cfg.wave, 1);
  assert.ok(v.cfg.grids.raining.includes(9), "the grid is centred on the WTP price");
  h.close();
  void config;
});

test("a new wave gives everybody a new ladder; finish closes the groups left short", { timeout: 60000 }, async () => {
  const store = memoryStore();
  const host = store.client("host");
  const { code } = await createRoom(host, { ...SCENARIO, situations: [] });
  const h = hostSession(host, code, () => {}, { throttleMs: 10 });
  await h.ready;
  const phones = Array.from({ length: 12 }, (_, i) => phone(store.client(`r${i}`), code));
  await Promise.all(phones.map((p) => p.finished));
  h.send({ t: "recentre", centres: { "": 10 } });
  await new Promise((r) => setTimeout(r, 50));
  // Two students walk away halfway through the second wave.
  const again = Array.from({ length: 12 }, (_, i) => phone(store.client(`r${i}`), code, { stopAfter: i < 2 ? 2 : Infinity }));
  await Promise.all(again.map((p) => p.finished));
  let v = viewOf(await readRoom(host, code));
  assert.equal(v.cfg.wave, 2);
  const w2 = v.groups.filter((g) => g.wave === 2);
  assert.ok(w2.some((g) => !g.closed), "groups are short because two students left");
  h.send({ t: "finish" });
  await new Promise((r) => setTimeout(r, 80));
  v = viewOf(await readRoom(host, code));
  assert.equal(v.open, false);
  assert.ok(v.groups.filter((g) => g.n >= 2).every((g) => g.closed), "finish closes every group with two answers or more");
  h.close();
});
