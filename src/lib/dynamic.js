/* Dynamic price updates for a live room.
 *
 * The first wave of offers sits around the WTP optimum. The elasticity the
 * class shows there is a LOCAL measure: P* = c·ε/(1+ε) assumes the elasticity
 * is constant, which only holds near the prices where it was measured — far
 * from them the demand curve bends and the formula gives a false price. So
 * the update is local. It reads the points the room page fits — the class's
 * answers and, unless the lecturer switches it off, the phase-1 base (their
 * stated WTP at the same prices, which anchors the first wave at the WTP
 * optimum):
 *
 *   - At an optimal price the elasticity must be ε = P/(c − P) (Lerner's rule,
 *     the same condition as P = c·ε/(1+ε)). If the 95% interval of the measured
 *     ε contains the value the current price needs, this price is, as far as
 *     the data can tell, the optimum: keep it.
 *   - If the class is more elastic than the price needs, the price is too high
 *     (lower it); if less elastic, too low (raise it) — but only within the
 *     prices just tested, where the measured elasticity is valid.
 *   - No usable estimate yet (too few groups, or ε ≥ −1, which around an
 *     optimal price is noise): keep the price and collect more answers.
 */
import { fitElasticity, optimalPrice } from "./elasticity.js";
import { lernerElasticity } from "./wtp.js";

const fit = (rows) => {
  if (rows.length < 3 || new Set(rows.map((r) => r.price)).size < 2) return null;
  try { return fitElasticity(rows, { price: "price", qty: "share" }).bySegment[0]; } catch { return null; }
};

/* The next centre for one situation.
 *   rows     the real group points of that situation ({ price, share, wave })
 *   centre   the current centre; prices the current grid
 * Returns the fit, the elasticity the centre needs to be optimal, the
 * suggested price and why. */
export function suggestCentre({ rows, centre, prices, cost, wave }) {
  // The current wave if it has enough points, else every wave.
  const current = rows.filter((r) => (r.wave ?? 1) === wave);
  const used = current.length >= 10 ? current : rows;
  const f = fit(used);
  const needed = cost > 0 ? lernerElasticity(centre, cost) : NaN;
  const keep = (reason, short) => ({ fit: f, needed, points: used.length, price: centre, reason, short, moved: false });
  if (!f) return keep("too few groups to estimate yet: keep the price and collect more answers", "wait");
  if (!(f.eps < -1)) return keep(`ε ${f.eps.toFixed(2)} is not elastic — around an optimal price that is noise: keep the price and collect more answers`, "wait");
  if (!(cost > 0)) return keep("the room has no unit cost: the optimum condition needs one", "no cost");
  if (needed >= f.lo - 1e-6 && needed <= f.hi + 1e-6)
    return keep(`for ${centre.toFixed(2)} to be optimal the class must show ε = ${needed.toFixed(2)}; it shows ${f.eps.toFixed(2)} [${f.lo.toFixed(2)}, ${f.hi.toFixed(2)}], which contains it: keep the price`, "keep");
  const lower = f.hi < needed;                     // more elastic than the price can bear
  const p = optimalPrice(f.eps, cost);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const price = Math.round(Math.min(hi, Math.max(lo, p)) * 100) / 100;
  const inside = p >= lo && p <= hi;
  const dir = lower ? "more elastic than this price can bear: lower it" : "less elastic than this price needs: raise it";
  return {
    fit: f, needed, points: used.length, price, moved: true,
    reason: inside
      ? `the class is ${dir} — to ${price.toFixed(2)}, where ε ${f.eps.toFixed(2)} would be optimal (inside the prices tested)`
      : `the class is ${dir} — but only to ${price.toFixed(2)}, the edge of the prices tested: further away the elasticity is not the one measured, and the formula's ${p.toFixed(2)} cannot be trusted`,
    short: lower ? "lower" : "raise",
  };
}
