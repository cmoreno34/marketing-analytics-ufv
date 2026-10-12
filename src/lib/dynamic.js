/* Dynamic price updates for a live room.
 *
 * The first wave of offers sits around the WTP optimum. After it, the
 * elasticity measured on the class's yes / no answers points to a new price,
 * P* = c·ε/(1+ε), and the next wave is centred there — and so on.
 *
 * A class is small, so the measured elasticity can come out impossible (at or
 * above −1, when around an optimal price demand must be elastic) or far too
 * uncertain. Then the update borrows strength from phase 1: synthetic groups
 * are drawn from the WTP answers the same class gave for that situation, at
 * the prices being offered, and fitted together with the real ones. It is a
 * prior, and it fades: synthetic groups only fill up to TARGET points, so the
 * more the class answers, the fewer are added, until the real answers decide
 * alone. Every result says how many synthetic groups it used; the Lab's
 * analysis stays on the real answers.
 */
import { fitElasticity, optimalPrice } from "./elasticity.js";
import { mulberry32 } from "./prep.js";

export const TARGET = 30;          // points per situation the synthetic groups fill up to
export const MAX_WIDTH = 1;        // a 95% interval wider than this is too uncertain to price on

/* k groups of `size` people drawn (with replacement) from the stated WTP
 * answers; each says yes when their WTP reaches the price. Spread evenly over
 * the prices offered. */
export function syntheticGroups(wtps, prices, k, size = 5, seed = 1) {
  if (!wtps?.length || !prices?.length || k <= 0) return [];
  const rng = mulberry32(seed);
  const out = [];
  for (let i = 0; i < k; i++) {
    const price = prices[i % prices.length];
    let yes = 0;
    for (let j = 0; j < size; j++) if (wtps[Math.floor(rng() * wtps.length)] >= price) yes++;
    out.push({ price, share: (yes || 0.5) / size, offers: size, accepts: yes, zeroFixed: yes === 0, synthetic: true });
  }
  return out;
}

const fit = (rows) => {
  if (rows.length < 3 || new Set(rows.map((r) => r.price)).size < 2) return null;
  try { return fitElasticity(rows, { price: "price", qty: "share" }).bySegment[0]; } catch { return null; }
};

/* The next centre for one situation.
 *   rows     the real group points of that situation ({ price, share, wave })
 *   wtps     its phase-1 answers (may be empty: a one-phase room)
 *   centre   the current centre; prices the current grid
 * Returns the real fit, the fit used, how many synthetic groups went in, the
 * suggested price and why: it stays put while the current price is inside the
 * range of optimal prices the 95% interval of ε allows, and otherwise moves
 * half-way towards P*, at most half the tested range per wave. */
export function suggestCentre({ rows, wtps = [], centre, prices, cost, rangePct, wave, groupSize = 5, seed = 7 }) {
  // The current wave if it has enough points, else every wave.
  const current = rows.filter((r) => (r.wave ?? 1) === wave);
  const used = current.length >= 10 ? current : rows;
  const real = fit(used);
  const usable = (f) => f && f.eps < -1 && f.hi - f.lo <= MAX_WIDTH;
  let final = real, synthetic = 0;
  if (!usable(real) && wtps.length) {
    synthetic = Math.max(0, TARGET - used.length);
    const aug = fit([...used, ...syntheticGroups(wtps, prices, synthetic, groupSize, seed)]);
    if (aug) final = aug;
  }
  // Move only when the data say the price is wrong, and then only half-way:
  // P* = c·ε/(1+ε) magnifies the noise in ε, so a full jump on a small sample
  // makes the price swing from wave to wave.
  const step = rangePct / 2 / 100;
  const lo = centre * (1 - step), hi = centre * (1 + step);
  let price = centre, reason, short = "keep";
  if (!final) reason = "too few groups to estimate yet";
  else if (!(final.eps < -1)) { reason = `ε ${final.eps.toFixed(2)} is not elastic: noise, keep collecting`; short = "noise: keep"; }
  else if (!(cost > 0)) { reason = "the room has no unit cost: P* = c·ε/(1+ε) needs one"; short = "no cost"; }
  else {
    const p = optimalPrice(final.eps, cost);
    const pLo = optimalPrice(final.lo, cost);                       // the most elastic end: the lowest P*
    const pHi = final.hi < -1 ? optimalPrice(final.hi, cost) : Infinity;
    if (centre >= pLo * 0.995 && centre <= pHi * 1.005) {
      reason = `P* ${p.toFixed(2)}, but anything from ${pLo.toFixed(2)} to ${Number.isFinite(pHi) ? pHi.toFixed(2) : "above"} fits the data: keep the price`;
    } else {
      price = Math.min(hi, Math.max(lo, centre + (p - centre) / 2));
      reason = `P* ${p.toFixed(2)}: half-way towards it, at most ±${Math.round(step * 100)}% a wave`;
      short = `½ way to P* ${p.toFixed(2)}`;
    }
  }
  return { real, final, synthetic, points: used.length, price: Math.round(price * 100) / 100, reason, short, moved: Math.abs(price - centre) > 0.005 };
}
