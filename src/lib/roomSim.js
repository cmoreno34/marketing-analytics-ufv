/* A whole live price room with a virtual class, run in the browser.
 *
 * The same room engine the real rooms use (roomEngine.js) on the in-memory
 * database (memoryDb.js): one host session — the lecturer's page — and one
 * session per virtual student, each climbing the ladder and answering. So the
 * simulator shows exactly what a class would get: the grids the rules build,
 * when the waves move and why.
 *
 * Each virtual student has a willingness to pay drawn from a log-normal
 * distribution (median and spread chosen on the page) and buys when the price
 * is at or below it — except a share of "noisy" answers, given at random, as
 * students who do not read the offer. Because the true demand is known, the
 * page can compare what the room finds with the truth: the true optimum and
 * the true elasticity at each price. */
import { memoryStore } from "./memoryDb.js";
import { createRoom, studentSession, hostSession, readRoom, viewOf, ladderOf } from "./roomEngine.js";
import { wtpOptimum, frequencies, scaleLevels, niceStep } from "./wtp.js";
import { fitElasticity } from "./elasticity.js";

/* Standard normal: density, distribution (Abramowitz–Stegun 7.1.26) and a
 * deterministic set of quantiles, so a class of n has the exact spread. */
const phi = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
function Phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
function zq(u) {                                         // inverse normal (Acklam's rational approximation, short form)
  const t = Math.sqrt(-2 * Math.log(u < 0.5 ? u : 1 - u));
  const x = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t ** 3);
  return u < 0.5 ? -x : x;
}

/* The true demand of the virtual class: share that buys at p, its elasticity
 * there, and the profit-maximising price. */
export function truth({ median, spread, noise, cost }) {
  const share = (p) => (1 - noise) * (1 - Phi(Math.log(p / median) / spread)) + noise / 2;
  const eps = (p) => {
    const z = Math.log(p / median) / spread;
    return -((1 - noise) * phi(z) / spread) / share(p);
  };
  let best = 0, opt = cost;
  for (let p = Math.max(cost, median * 0.1); p < median * 5; p *= 1.002) {
    const v = (p - cost) * share(p);
    if (v > best) { best = v; opt = p; }
  }
  return { share, eps, opt };
}

let seedN = 0;
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/* Runs the room. `onProgress(text)` is told what is happening.
 * Returns { waves: [...], truth, cfg }. */
export async function simulateRoom({
  base = 8, cost = 3, students = 50, median = 12, spread = 0.4, noise = 0.1, groupSize = 5,
  rangePct = 30, levels = 7, autoWaves = 3, extraWave = true, mode = "price", seed = 1, onProgress = () => {},
}) {
  const rand = mulberry(seed * 7919 + ++seedN);
  const store = memoryStore();
  const host = store.client("lecturer");
  const T = truth({ median, spread, noise, cost });
  // Exact quantiles of the log-normal, shuffled: the class has the spread asked for.
  const wtp = Array.from({ length: students }, (_, i) => median * Math.exp(spread * zq((i + 0.5) / students)));
  for (let i = wtp.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [wtp[i], wtp[j]] = [wtp[j], wtp[i]]; }

  // Phase-1 scale for a two-phase room: from a fifth to two and a half times the median.
  const step = niceStep(median / 8);
  const scale = scaleLevels(Math.max(step, Math.floor(median * 0.2 / step) * step), Math.ceil(median * 2.5 / step) * step, step);
  const { code } = await createRoom(host, {
    product: "Simulated product", currency: "€", base: mode === "wtp" ? scale[Math.floor(scale.length / 2)] : base, rangePct, levels, groupSize,
    cost, autoWaves, mode, ...(mode === "wtp" ? { wtpScale: scale } : {}), situations: [],
  });
  const h = hostSession(host, code, () => {}, { throttleMs: 20, idleMs: 300 });
  await h.ready;
  onProgress(mode === "wtp" ? "Phase 1: the class gives its maximum prices…" : "Wave 1: the class climbs the ladder…");

  const phones = wtp.map((v, i) => {
    const s = studentSession(store.client(`student${i}`), code, (m) => {
      if (m.t === "hello") {
        if (m.phase === "wtp") {
          const pick = scale.filter((p) => p <= v).pop() ?? scale[0];
          s.send({ t: "wtp", answers: { "": pick } });
        } else s.send({ t: "next" });
      } else if (m.t === "phase" && m.phase === "prices") s.send({ t: "next" });
      else if (m.t === "rounds" || m.t === "ok") s.send({ t: "next" });
      else if (m.t === "offer") {
        const buy = rand() < noise ? rand() < 0.5 : v >= m.price;
        setTimeout(() => s.send({ t: "answer", group: m.group, buy }), rand() * 8);
      } else if (m.t === "wait" || m.t === "error") setTimeout(() => s.send({ t: "next" }), 5);
    });
    return s;
  });

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    if (mode === "wtp") {
      for (let t = 0; t < 400; t++) { const r = await readRoom(host, code); if (Object.keys(r.wtp ?? {}).length >= students) break; await pause(20); }
      const r = await readRoom(host, code);
      const vals = Object.values(r.wtp ?? {}).map((a) => JSON.parse(a)[0]);
      const o = wtpOptimum(scale, frequencies(vals, scale), { vcu: cost });
      h.send({ t: "start-prices", centres: { "": Math.round(o.optPrice * 100) / 100 } });
      onProgress("Phase 2, wave 1: the class climbs the ladder around the WTP optimum…");
    }
    const target = autoWaves + (extraWave ? 1 : 0);
    let extraSent = false, lastWave = 1;
    for (let t = 0; t < 6000; t++) {
      const r = await readRoom(host, code);
      const cfg = JSON.parse(r.meta.cfg);
      const wave = cfg.wave ?? 1;
      if (wave !== lastWave) { lastWave = wave; onProgress(`Wave ${wave}: the room moved the prices — the class climbs the new ladder…`); }
      const L = ladderOf(cfg).length;
      const done = Object.values(r.students ?? {}).filter((st) => Object.keys(st.done?.[`w${wave}`] ?? {}).length >= L).length;
      if (r.meta.phase === "prices" && done >= students && wave >= Math.min(target, autoWaves)) {
        if (wave < target && !extraSent) { extraSent = true; h.send({ t: "next-wave" }); }
        else if (wave >= target) break;
      }
      await pause(25);
    }
    h.send({ t: "finish" });
    await pause(150);
  } finally {
    h.close();
    for (const p of phones) p.close();
  }

  const room = await readRoom(host, code);
  const v = viewOf(room);
  const cfg = v.cfg;
  const path = cfg.path ?? [];
  const waves = path.map((w) => {
    const grid = gridOfWave(v, w.wave);
    const real = v.groups.filter((g) => !g.synthetic && g.wave === w.wave && g.closed);
    const rows = real.map((g) => ({ price: g.price, share: (g.yes || 0.5) / g.n }));
    let fit = null;
    try { if (rows.length >= 3 && new Set(rows.map((r) => r.price)).size >= 2) fit = fitElasticity(rows, { price: "price", qty: "share" }).bySegment[0]; } catch { fit = null; }
    const prices = [...new Set(real.map((g) => g.price))].sort((a, b) => a - b);
    const acc = prices.map((p) => { const gs = real.filter((g) => g.price === p); return { price: p, share: gs.reduce((a, g) => a + g.yes, 0) / gs.reduce((a, g) => a + g.n, 0), groups: gs.length }; });
    const centre = w.centres[""];
    return { wave: w.wave, from: w.from, centre, reason: w.reasons?.[""] ?? (w.from === "wtp" ? "WTP optimum" : "starting price"), grid: grid.length ? grid : prices,
      acc, groups: real.length, fit, trueEps: T.eps(centre), extra: extraWave && w.wave === autoWaves + 1 };
  });
  return { waves, truth: T, cfg, students };
}

/* The prices a wave offered, read from its groups. */
function gridOfWave(v, wave) {
  return [...new Set(v.groups.filter((g) => g.wave === wave && !g.synthetic).map((g) => g.price))].sort((a, b) => a - b);
}
