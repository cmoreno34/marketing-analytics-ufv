/* The rules the price grid of a live room obeys, applied automatically — the
 * lecturer never has to judge a range in the middle of a class.
 *
 *   1 Every step is one a buyer notices: at least 5% of the highest price
 *     (Weber's just-noticeable difference). Smaller steps get the same answer
 *     at different prices and push the elasticity towards 0.
 *   2 The range is between ±20% and ±50% of the centre. Narrower and the slope
 *     is measured with a huge interval (its precision grows with the spread of
 *     ln P); wider and the constant elasticity — a local approximation — no
 *     longer holds and the log-log line bends.
 *   3 The ends of the grid are where roughly 90% and 10% of the class would
 *     still buy. A price where everybody (or nobody) buys carries no
 *     information about the slope. Before any answer the ends come from the
 *     phase-1 WTP (its 10th and 90th percentiles); after a wave, from the
 *     fitted curve, and a wave that hit an all-yes or all-no end moves the
 *     grid that way.
 *   4 The price the elasticity points to lies inside the grid, and the
 *     elasticity there is below −1 (else there is no optimum and the price
 *     must go up).
 *   5 The lowest price is above the unit cost: below it no price is viable.
 *   6 At least 5 prices, so the line has points to fit along the range.
 *
 * A seed of synthetic points keeps the curve close to reality while the real
 * answers are few: in a two-phase room the class's own phase-1 WTP played at
 * the prices offered (it is extended to every new price a wave introduces);
 * in a one-phase room a small prior — a constant-elasticity curve through the
 * starting price at half acceptance, with the elasticity that makes that price
 * optimal (Lerner). It is two groups per price against about ten real ones, so
 * the answers soon outweigh it. */
import { niceStep } from "./wtp.js";
import { suggestCentre } from "./dynamic.js";
import { optimalPrice } from "./elasticity.js";

export const RULES = {
  minLevels: 5, maxLevels: 9,
  minRangePct: 20, maxRangePct: 50,
  minStepPct: 5,
  accHigh: 0.9, accLow: 0.1,
  costMargin: 1.05,
  priorGroups: 2,
};

const r2 = (v) => Math.round(v * 100) / 100;

/* The ends asked for, held within ±20–50% of the centre (rule 2). */
export function clampBounds(centre, lo, hi) {
  const { minRangePct: a, maxRangePct: b } = RULES;
  const L = Number.isFinite(lo) ? lo : centre * 0.7, H = Number.isFinite(hi) ? hi : centre * 1.3;
  return {
    lo: Math.min(centre * (1 - a / 100), Math.max(centre * (1 - b / 100), L)),
    hi: Math.max(centre * (1 + a / 100), Math.min(centre * (1 + b / 100), H)),
  };
}

/* The grid: round prices in equal steps from about `lo` to about `hi`, obeying
 * every rule. Tries 5–9 prices and the round steps (1, 2, 5 × 10^k) near the
 * one asked for, and keeps the one whose ends are closest to those asked,
 * preferring the number of prices the lecturer chose. */
export function ruleGrid({ centre, lo, hi, levels = 7, cost = 0, maxLevels = RULES.maxLevels }) {
  let c = centre;
  ({ lo, hi } = clampBounds(c, lo, hi));
  const floor = cost > 0 ? cost * RULES.costMargin : 0;
  if (lo < floor) {                                    // rule 5: nothing at or below cost
    lo = floor;
    c = Math.max(c, lo / (1 - RULES.minRangePct / 100));
    hi = Math.max(hi, c * (1 + RULES.minRangePct / 100));
  }
  const want = Math.min(Math.max(RULES.minLevels, Math.round(levels) || 7), Math.max(RULES.minLevels, maxLevels));
  let best = null;
  for (let L = RULES.minLevels; L <= Math.max(RULES.minLevels, maxLevels); L++) {
    const raw = (hi - lo) / (L - 1), base = niceStep(raw);
    for (const step of [base / 2.5, base / 2, base, base * 2, base * 2.5].map((s) => niceStep(s))) {
      const unit = Number.isInteger(Math.round(step * 1e4) / 2 / 100) ? step / 2 : step;
      let start = Math.round(((lo + hi) / 2 - (step * (L - 1)) / 2) / unit) * unit;
      while (start <= floor + 1e-9 || start <= 0) start += unit;
      const g = Array.from({ length: L }, (_, i) => r2(start + i * step));
      const top = g[L - 1];
      let bad = 0;
      if (step / top < RULES.minStepPct / 100 - 1e-9) bad += 10;                  // rule 1
      if (c < g[0] || c > top) bad += 10;                                          // rule 4
      const down = (c - g[0]) / c, up = (top - c) / c;                             // rule 2, with rounding slack
      if (down < 0.15 || up < 0.15 || down > 0.55 || up > 0.55) bad += 5;
      const half = Math.abs(start / step - Math.round(start / step)) > 1e-6;          // 6.50 · 7.50 reads worse than 6 · 7
      const score = bad + (half ? 0.15 : 0) + Math.abs(Math.log(g[0] / lo)) + Math.abs(Math.log(top / hi)) + 0.03 * Math.abs(L - want);
      if (!best || score < best.score) best = { score, grid: g };
    }
  }
  return best.grid;
}

/* Quantile of a list (linear interpolation). */
export function quantile(values, q) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const i = (v.length - 1) * q, j = Math.floor(i);
  return v[j] + (v[Math.min(j + 1, v.length - 1)] - v[j]) * (i - j);
}

/* Rule 3 from the phase-1 answers: the lowest price is the one 90% of the
 * class said they would pay, the highest the one 10% would. */
export const wtpBounds = (values) => ({ lo: quantile(values, 1 - RULES.accHigh), hi: quantile(values, 1 - RULES.accLow) });

/* The prior seed of a one-phase room: the elasticity that makes the starting
 * price optimal (ε = P/(c − P)), kept between −5 and −1.5; −2 without a cost. */
export function priorElasticity(price, cost) {
  const e = cost > 0 && price > cost ? price / (cost - price) : -2;
  return Math.min(-1.5, Math.max(-5, e));
}
export function priorGroups({ grid, centre, cost, size, rand = Math.random }) {
  const eps = priorElasticity(centre, cost), out = [];
  for (const p of grid) for (let k = 0; k < RULES.priorGroups; k++) {
    const share = Math.min(0.97, Math.max(0.03, 0.5 * (p / centre) ** eps));
    out.push({ price: p, answers: Array.from({ length: size }, () => (rand() < share ? 1 : 0)) });
  }
  return out;
}

/* The price where the fitted line ln s = a + ε ln P gives a share s. */
function priceAt(fit, s) {
  return fit && fit.eps < -0.2 ? Math.exp((Math.log(s) - fit.intercept) / fit.eps) : NaN;
}
function lineFit(rows) {
  const pts = rows.filter((r) => r.price > 0 && r.share > 0);
  if (pts.length < 3 || new Set(pts.map((r) => r.price)).size < 2) return null;
  const x = pts.map((r) => Math.log(r.price)), y = pts.map((r) => Math.log(r.share));
  const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length;
  let sxx = 0, sxy = 0;
  x.forEach((xi, i) => { sxx += (xi - mx) ** 2; sxy += (xi - mx) * (y[i] - my); });
  if (!(sxx > 0)) return null;
  const eps = sxy / sxx;
  return { eps, intercept: my - eps * mx };
}

/* The next wave for one situation, from the groups so far (real and seed):
 * where to centre it, its grid and why. `rows` are { price, share, wave,
 * synthetic }; `grid` and `centre` the wave that just ended. */
export function planNext({ rows, centre, grid, cost, wave, levels, maxLevels }) {
  const s = suggestCentre({ rows, centre, prices: grid, cost, wave });
  const lo = Math.min(...grid), hi = Math.max(...grid);
  const real = rows.filter((r) => !r.synthetic && (r.wave ?? 1) === wave);
  const accAt = (p) => { const at = real.filter((r) => r.price === p); return at.length ? at.reduce((a, r) => a + r.share, 0) / at.length : NaN; };
  const accLo = accAt(lo), accHi = accAt(hi);
  let next = s.price, why = s.reason;
  if (accLo < RULES.accLow) { next = lo; why = `only ${Math.round(accLo * 100)}% bought even at the lowest price: the whole grid moves down`; }
  else if (accHi > RULES.accHigh) { next = hi; why = `${Math.round(accHi * 100)}% still bought at the highest price: the whole grid moves up`; }
  else if (s.fit && s.fit.lo > -1) { next = hi; why = `demand is inelastic here (ε ${s.fit.eps.toFixed(2)}, its whole interval above −1): there is no optimum below, the prices go up`; }
  else if (s.fit && s.fit.eps < -1 && cost > 0) {
    const p = optimalPrice(s.fit.eps, cost);
    if (p != null && (p < lo || p > hi)) why += " (rule: the optimum must lie inside the grid, so the next grid is centred towards it)";
  }
  // Ends where about 90% and 10% would buy, on the line fitted to the same points.
  const used = rows.filter((r) => (r.wave ?? 1) === wave).length >= 10 ? rows.filter((r) => (r.wave ?? 1) === wave) : rows;
  const f = lineFit(used);
  const b = clampBounds(next, priceAt(f, RULES.accHigh), priceAt(f, RULES.accLow));
  const g = ruleGrid({ centre: next, lo: b.lo, hi: b.hi, levels, cost, maxLevels });
  return { centre: r2(next), grid: g, reason: why, fit: s.fit, accLo, accHi };
}
