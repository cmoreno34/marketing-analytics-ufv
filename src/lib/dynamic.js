/* Dynamic price updates for a live room.
 *
 * The first wave of offers sits around the WTP optimum. After it, the
 * elasticity measured on the class's yes / no answers points to a price,
 * P* = c·ε/(1+ε), and the next wave can be centred there — and so on.
 *
 * Only the class's real answers count, and the rule adds no tuning numbers of
 * its own:
 *   - no usable estimate yet (too few groups, or ε at or above −1, which
 *     around an optimal price is noise): keep the price and collect more;
 *   - the current price inside the range of P* the 95% interval of ε allows:
 *     the data do not contradict it, keep it;
 *   - otherwise move to P*, but not beyond the prices just tested — outside
 *     them there are no data, and the formula would be extrapolating.
 */
import { fitElasticity, optimalPrice } from "./elasticity.js";

const fit = (rows) => {
  if (rows.length < 3 || new Set(rows.map((r) => r.price)).size < 2) return null;
  try { return fitElasticity(rows, { price: "price", qty: "share" }).bySegment[0]; } catch { return null; }
};

/* The next centre for one situation.
 *   rows     the real group points of that situation ({ price, share, wave })
 *   centre   the current centre; prices the current grid
 * Returns the fit, the suggested price and why. */
export function suggestCentre({ rows, centre, prices, cost, wave }) {
  // The current wave if it has enough points, else every wave.
  const current = rows.filter((r) => (r.wave ?? 1) === wave);
  const used = current.length >= 10 ? current : rows;
  const f = fit(used);
  const keep = (reason, short) => ({ fit: f, points: used.length, price: centre, reason, short, moved: false });
  if (!f) return keep("too few groups to estimate yet: keep the price and collect more answers", "wait");
  if (!(f.eps < -1)) return keep(`ε ${f.eps.toFixed(2)} is not elastic — around an optimal price that is noise: keep the price and collect more answers`, "wait");
  if (!(cost > 0)) return keep("the room has no unit cost: P* = c·ε/(1+ε) needs one", "no cost");
  const p = optimalPrice(f.eps, cost);
  const pLo = optimalPrice(f.lo, cost);                                  // the most elastic end: the lowest P*
  const pHi = f.hi < -1 ? optimalPrice(f.hi, cost) : Infinity;
  if (centre >= pLo * 0.995 && centre <= pHi * 1.005)
    return keep(`P* ${p.toFixed(2)}, but anything from ${pLo.toFixed(2)} to ${Number.isFinite(pHi) ? pHi.toFixed(2) : "above"} fits the data: keep the price`, "keep");
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const price = Math.round(Math.min(hi, Math.max(lo, p)) * 100) / 100;
  const edge = p < lo || p > hi;
  return {
    fit: f, points: used.length, price, moved: true,
    reason: edge ? `P* ${p.toFixed(2)} is outside the prices tested: go to the edge of what was tested, ${price.toFixed(2)}` : `P* = c·ε/(1+ε) = ${p.toFixed(2)}`,
    short: edge ? `towards P* ${p.toFixed(2)}` : "P*",
  };
}
