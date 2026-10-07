/* Answer key for quiz M8 (Elasticity Lab practice), computed with the Lab's
 * own code and the same steps the page takes: the same default settings, the
 * same seed (42), the same experiments, the same "try this" rows.
 *
 *   node test/quiz_m8_key.mjs  > key.json
 */
import {
  fitElasticity, optimalPrice, aggregateOffers, simulateSales, simulateOffers, repeatSales,
  COLAB_PAIRS, COLAB_RAIN,
} from "../src/lib/elasticity.js";

const SEED = 42;
const r = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const seg = (f) => Object.fromEntries(f.bySegment.map((s) => [s.level ?? "all", { eps: r(s.eps, 3), lo: r(s.lo, 3), hi: r(s.hi, 3), n: s.n }]));
const out = {};

/* ── A. Colab: 14 days ── */
const colab = COLAB_PAIRS.map(([price, units], i) => ({ day: i + 1, price, units }));
const A = (rows) => fitElasticity(rows, { price: "price", qty: "units", segment: null, shifters: [], nums: [] });
const a0 = A(colab), s0 = a0.bySegment[0];
out.A = {
  eps: r(s0.eps, 3), lo: r(s0.lo, 3), hi: r(s0.hi, 3), r2: r(a0.model.r2, 3),
  pstar18: r(optimalPrice(s0.eps, 1.8), 3), pstar20: r(optimalPrice(s0.eps, 2.0), 3),
};
const twoDays = A([...colab, { day: 15, price: 2.2, units: 79 }, { day: 16, price: 2.95, units: 28 }]).bySegment[0];
out.A.twoDays = { eps: r(twoDays.eps, 3), lo: r(twoDays.lo, 3), hi: r(twoDays.hi, 3), width: r(twoDays.hi - twoDays.lo, 3) };
const odd = A([...colab, { day: 15, price: 2.6, units: 70 }]).bySegment[0];
out.A.odd = { eps: r(odd.eps, 3), lo: r(odd.lo, 3), hi: r(odd.hi, 3), width: r(odd.hi - odd.lo, 3), pstar18: r(optimalPrice(odd.eps, 1.8), 3) };
out.A.width0 = r(s0.hi - s0.lo, 3);

/* ── B. Colab: 14 days + rain ── */
const rain = COLAB_PAIRS.map(([price, units], i) => ({ day: i + 1, price, units, weather: COLAB_RAIN[i] ? "rain" : "no rain" }));
const B = (rows, nums = []) => fitElasticity(rows, { price: "price", qty: "units", segment: "weather", shifters: [], nums });
const b0 = B(rain);
out.B = {
  seg: seg(b0), slopeP: r(b0.slopeTest.p, 3), levelP: r(b0.levelTest.p, 3),
  separate: b0.separate.map((s) => [s.level, r(s.eps, 3)]),
  pstar: Object.fromEntries(b0.bySegment.map((s) => [s.level, r(optimalPrice(s.eps, 1.8), 3)])),
};
const bRain = B([...rain, { day: 15, price: 2.85, units: 36, weather: "rain" }, { day: 16, price: 2.95, units: 33, weather: "rain" }, { day: 17, price: 3.05, units: 31, weather: "rain" }]);
out.B.rainyDays = { seg: seg(bRain), slopeP: r(bRain.slopeTest.p, 4), pstarRain: r(optimalPrice(bRain.bySegment.find((s) => s.level === "rain").eps, 1.8), 3) };
const bDay = B(rain, [{ col: "day", log: false }]);
out.B.day = { seg: seg(bDay), pDay: r(bDay.model.p[bDay.names.indexOf("day")], 3) };

/* ── C. Simulate sales ── */
const DEFAULT_SALES = {
  product: "Coffee to go", n: 60, pMin: 2.1, pMax: 3.3, pRef: 2.5, qRef: 50, noise: 0.12, useSegment: true,
  segment: { name: "weather", levels: [{ name: "dry", eps: -2.6, shift: 1, share: 60 }, { name: "rain", eps: -1.9, shift: 0.85, share: 40 }] },
  nums: [{ name: "temperature", min: 8, max: 30, eff: -0.3 }], shifters: [],
};
const SEG = (dry, rainE) => ({ name: "weather", levels: [{ name: "dry", eps: dry, shift: 1, share: 50 }, { name: "rain", eps: rainE, shift: 1, share: 50 }] });
const salesSim = (cfg) => ({ ...cfg, eps: cfg.segment.levels[0]?.eps ?? -2, segment: cfg.useSegment ? cfg.segment : null });
const runSales = (cfg, seed = SEED) => {
  const rows = simulateSales(salesSim(cfg), seed);
  const spec = { price: "price", qty: "units", segment: cfg.useSegment ? cfg.segment.name : null, shifters: [], nums: cfg.nums.map((x) => ({ col: x.name, log: true })) };
  return fitElasticity(rows, spec);
};
const EXP = {
  colab: { n: 14, pMin: 2.4, pMax: 2.73, pRef: 2.5, qRef: 50, noise: 0.1, useSegment: false, nums: [], segment: SEG(-2.5, -1.5) },
  days300: { n: 300, pMin: 2.4, pMax: 2.73, pRef: 2.5, qRef: 50, noise: 0.1, useSegment: false, nums: [], segment: SEG(-2.5, -1.5) },
  far: { n: 14, pMin: 1.8, pMax: 3.5, pRef: 2.5, qRef: 50, noise: 0.1, useSegment: false, nums: [], segment: SEG(-2.5, -1.5) },
  rainDry: { n: 30, pMin: 2.1, pMax: 3.3, pRef: 2.5, qRef: 50, noise: 0.2, useSegment: true, nums: [], segment: SEG(-2.5, -1.5) },
  inelastic: { n: 60, pMin: 2.1, pMax: 3.3, pRef: 2.5, qRef: 50, noise: 0.12, useSegment: false, nums: [], segment: SEG(-0.6, -0.4) },
};
const c0 = runSales(DEFAULT_SALES);
out.C = { default: seg(c0) };
for (const [k, v] of Object.entries(EXP)) {
  const cfg = { ...DEFAULT_SALES, ...v };
  const f = runSales(cfg);
  out.C[k] = { seg: seg(f), ...(f.slopeTest ? { slopeP: r(f.slopeTest.p, 4) } : {}), widths: f.bySegment.map((s) => r(s.hi - s.lo, 3)),
    pstar15: f.bySegment.map((s) => optimalPrice(s.eps, 1.5)).map((v2) => (v2 == null ? null : r(v2, 3))) };
}
// The rain-vs-dry experiment with 300 days, and repeated 200 times (seed 42 → 42001).
const rd300 = runSales({ ...DEFAULT_SALES, ...EXP.rainDry, n: 300 });
out.C.rainDry300 = { seg: seg(rd300), slopeP: rd300.slopeTest.p, widths: rd300.bySegment.map((s) => r(s.hi - s.lo, 3)) };
const rep30 = repeatSales(salesSim({ ...DEFAULT_SALES, ...EXP.rainDry }), 200, SEED * 1000 + 1);
const rep300 = repeatSales(salesSim({ ...DEFAULT_SALES, ...EXP.rainDry, n: 300 }), 200, SEED * 1000 + 1);
const repSum = (rp) => ({ detected: rp.detected, covered: Object.fromEntries(Object.entries(rp.levels).map(([k, o]) => [k, o.covered])),
  mean: Object.fromEntries(Object.entries(rp.levels).map(([k, o]) => [k, r(o.est.reduce((a, b) => a + b, 0) / o.est.length, 3)])) });
out.C.repeat30 = repSum(rep30);
out.C.repeat300 = repSum(rep300);

/* ── D. Simulate a class ── */
const DEFAULT_OFFERS = {
  product: "Cinema ticket", respondents: 60, start: 8, rangePct: 35, levels: 7, offersEach: 7, groupSize: 5, sigma: 0.3, wtp: 8, useSegment: true,
  segment: { name: "profile", levels: [{ name: "student", wtp: 6.5, share: 55 }, { name: "working", wtp: 9.5, share: 45 }] },
};
const runOffers = (cfg, seed = SEED) => {
  const rows = simulateOffers({ ...cfg, segment: cfg.useSegment ? cfg.segment : null }, seed);
  const segName = cfg.useSegment ? cfg.segment.name : null;
  const cats = segName ? [segName] : [];
  const cells = aggregateOffers(rows, { price: "price", accept: "accept", cats: Number(cfg.groupSize) > 1 ? [...cats, "group"] : cats });
  const f = fitElasticity(cells.map((c) => ({ ...c })), { price: "price", qty: "share", segment: segName, shifters: [], nums: [] });
  return { f, answers: rows.length, cells: cells.length, zero: cells.filter((c) => c.zeroFixed).length };
};
const OEXP = {
  live: { respondents: 50, start: 8, rangePct: 50, levels: 7, offersEach: 5, groupSize: 5, sigma: 0.35, wtp: 8, useSegment: false },
  narrow: { respondents: 50, start: 8, rangePct: 10, levels: 7, offersEach: 5, groupSize: 5, sigma: 0.35, wtp: 8, useSegment: false },
  wide: { respondents: 50, start: 8, rangePct: 85, levels: 7, offersEach: 5, groupSize: 5, sigma: 0.35, wtp: 8, useSegment: false },
  agree: { respondents: 50, start: 8, rangePct: 40, levels: 7, offersEach: 5, groupSize: 5, sigma: 0.1, wtp: 8, useSegment: false },
  high: { respondents: 50, start: 14, rangePct: 40, levels: 7, offersEach: 5, groupSize: 5, sigma: 0.35, wtp: 8, useSegment: false },
  two: { respondents: 60, start: 8, rangePct: 35, levels: 7, offersEach: 7, groupSize: 5, sigma: 0.3, wtp: 8, useSegment: true },
};
const d0 = runOffers(DEFAULT_OFFERS);
out.D = { default: { answers: d0.answers, groups: d0.cells, zero: d0.zero, seg: seg(d0.f) } };
for (const [k, v] of Object.entries(OEXP)) {
  const o = runOffers({ ...DEFAULT_OFFERS, ...v });
  out.D[k] = { answers: o.answers, groups: o.cells, zero: o.zero, seg: seg(o.f), widths: o.f.bySegment.map((s) => r(s.hi - s.lo, 3)),
    pstar3: o.f.bySegment.map((s) => optimalPrice(s.eps, 3)).map((x) => (x == null ? null : r(x, 3))), ...(o.f.slopeTest ? { slopeP: r(o.f.slopeTest.p, 4) } : {}) };
}
console.log(JSON.stringify(out, null, 1));
