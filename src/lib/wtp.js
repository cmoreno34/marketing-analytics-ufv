/* Willingness to pay → optimal price, exactly as the WTP Price Optimizer
 * (github.com/cmoreno34/wtp-pricing-optimizer) computes it, so a live room's
 * WTP phase and that tool give the same price for the same answers.
 *
 * Each respondent picks the most they would pay on a scale of price levels.
 * The demand at a level is the share of respondents whose WTP is at or above
 * it, times the market size D; a monotone cubic (PCHIP) joins the levels; the
 * profit (p − VCu − FCu)·D(p) − FC is evaluated at m evenly spaced prices
 * between the lowest and highest level, and the best one is the optimum.
 * FC and D scale the profit but never move the optimum.
 *
 * The PCHIP functions below are the tool's own, unchanged.
 */

function pEnd(h1, h2, d1, d2) {
  let s = ((2 * h1 + h2) * d1 - h1 * d2) / (h1 + h2);
  if (Math.sign(s) !== Math.sign(d1)) s = 0;
  else if (Math.sign(d1) !== Math.sign(d2) && Math.abs(s) > Math.abs(3 * d1)) s = 3 * d1;
  return s;
}

function pchipSlopes(x, y) {
  const n = x.length, d = new Array(n), h = [], dl = [];
  for (let i = 0; i < n - 1; i++) { h.push(x[i + 1] - x[i]); dl.push((y[i + 1] - y[i]) / h[i]); }
  d[0] = pEnd(h[0], h[1], dl[0], dl[1]);
  d[n - 1] = pEnd(h[n - 2], h[n - 3] || h[n - 2], dl[n - 2], dl[n - 3] || dl[n - 2]);
  for (let i = 1; i < n - 1; i++) {
    if (dl[i - 1] * dl[i] <= 0) d[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; d[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i]); }
  }
  return { h, dl, d };
}

export function pchip(x, y, xq) {
  const n = x.length;
  if (n < 2) return xq.map(() => y[0] || 0);
  const { h, d } = pchipSlopes(x, y);
  return xq.map((xv) => {
    let i = 0;
    for (let j = 0; j < n - 1; j++) if (xv >= x[j]) i = j;
    if (i >= n - 1) i = n - 2;
    const t = (xv - x[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h[i] * d[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h[i] * d[i + 1];
  });
}

/* The tool's compute(): prices = the scale, answers = how many respondents
 * chose each level. Returns the optimum and the curves. */
export function wtpOptimum(prices, answers, { D = 100, m = 100, vcu = 0, fc = 0, fcu = 0 } = {}) {
  const t = answers.reduce((a, b) => a + b, 0);
  if (t === 0 || prices.length < 2) return null;
  const fr = answers.map((a) => a / t);
  const dem = prices.map((_, i) => D * fr.slice(i).reduce((a, b) => a + b, 0));
  const xn = Math.min(...prices), xx = Math.max(...prices);
  const xs = Array.from({ length: m }, (_, i) => xn + ((xx - xn) * i) / (m - 1));
  const ys = pchip(prices, dem, xs).map((v) => Math.max(0, v));
  const tc = vcu + fcu;
  const pr = xs.map((p, i) => p * ys[i] - tc * ys[i] - fc);
  let mx = -Infinity, oi = 0;
  pr.forEach((v, i) => { if (v > mx) { mx = v; oi = i; } });
  return { n: t, fr, dem, xs, ys, pr, optPrice: xs[oi], optDemand: ys[oi], optProfit: mx, optShare: ys[oi] / D };
}

/* The levels of a WTP scale: from, to, step → [from, from+step, …, to]. */
export function scaleLevels(from, to, step) {
  const a = Number(from), b = Number(to), s = Number(step);
  if (!(s > 0) || !(b > a)) return [];
  const n = Math.floor((b - a) / s + 1e-9);
  return Array.from({ length: n + 1 }, (_, i) => Math.round((a + i * s) * 100) / 100);
}

/* WTP answers (values on the scale) → how many chose each level. A value off
 * the scale goes to the nearest level. */
export function frequencies(values, levels) {
  const out = levels.map(() => 0);
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    let k = 0;
    for (let i = 1; i < levels.length; i++) if (Math.abs(levels[i] - v) < Math.abs(levels[k] - v)) k = i;
    out[k]++;
  }
  return out;
}

/* At a profit-maximising price the markup obeys Lerner's rule,
 * (P − c)/P = −1/ε, so the WTP optimum implies the elasticity the price
 * experiment should find around it: ε = P/(c − P). */
export const lernerElasticity = (price, cost) => (price > cost ? price / (cost - price) : NaN);

/* The price grid of the experiment: `levels` prices in equal steps from
 * centre −range% to centre +range%. */
export function centredGrid(centre, rangePct, levels) {
  const L = Math.max(2, Math.round(levels));
  return Array.from({ length: L }, (_, i) => Math.round(centre * (1 - rangePct / 100 + (2 * rangePct / 100) * i / (L - 1)) * 100) / 100);
}
