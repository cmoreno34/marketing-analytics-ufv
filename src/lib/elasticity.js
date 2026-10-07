/* Price elasticity — module 8.
 *
 * The constant-elasticity model of the technical note ("demand-based
 * theoretical models"): Q = A·P^ε, which is a straight line in log-log,
 *
 *     ln Q = a + ε·ln P
 *
 * so the elasticity is the slope of an ordinary least-squares fit. Everything
 * the lab adds is the same regression with more columns:
 *
 *   - a categorical variable (rain / no rain) enters as dummies that shift the
 *     demand level, and — if the student asks for an elasticity per category —
 *     as dummy × ln P interactions that change the slope;
 *   - a numeric variable (temperature, competitor price) enters as ln x, whose
 *     coefficient is itself an elasticity, or as x.
 *
 * The course Colab estimates "rain" and "no rain" with two separate
 * regressions. The single model with interactions gives exactly the same
 * slopes (it is the same fit, parameterised differently) but one residual
 * variance, which is what makes a test of "do the elasticities differ?"
 * possible. The lab shows both so the equivalence can be seen, not asserted.
 *
 * Checked against statsmodels in test/elasticity.test.js.
 */

import { mulberry32 } from "./prep.js";

/* ── Linear algebra: small dense matrices only (a model has < 20 columns) ── */

function invert(A) {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  const scale = Math.max(1e-300, ...A.map((r, i) => Math.abs(r[i])));
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-11 * scale) {
      throw new Error("The model cannot be estimated: two of its columns carry the same information (for example a category with no observations, or a variable that never changes).");
    }
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r) => r.slice(n));
}

/* ── Distributions, for p-values and confidence intervals ── */

function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a, b, x) {
  const EPS = 3e-16, FPMIN = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/* Regularised incomplete beta I_x(a, b). */
export function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export const tCDF = (t, df) => {
  const x = df / (df + t * t);
  const tail = 0.5 * ibeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
};
export const tPValue = (t, df) => (df > 0 && Number.isFinite(t) ? ibeta(df / (df + t * t), df / 2, 0.5) : NaN);
export const fPValue = (F, d1, d2) => (F > 0 && d2 > 0 ? 1 - ibeta((d1 * F) / (d1 * F + d2), d1 / 2, d2 / 2) : NaN);

export function tQuantile(p, df) {
  let lo = -1e3, hi = 1e3;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCDF(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/* Standard normal, for the simulated-respondent "truth". */
const phi = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
function Phi(z) {
  // Abramowitz–Stegun 7.1.26 via erf; plenty for a reference value on screen.
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/* ── Ordinary least squares ── */

export function ols(X, y) {
  const n = X.length, k = X[0]?.length ?? 0;
  if (n <= k) throw new Error(`Not enough observations: the model has ${k} coefficients and only ${n} usable rows.`);
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    for (let a = 0; a < k; a++) {
      Xty[a] += xi[a] * y[i];
      for (let b = a; b < k; b++) XtX[a][b] += xi[a] * xi[b];
    }
  }
  for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
  const inv = invert(XtX);
  const beta = inv.map((r) => r.reduce((s, v, j) => s + v * Xty[j], 0));
  const fitted = X.map((xi) => xi.reduce((s, v, j) => s + v * beta[j], 0));
  const resid = y.map((v, i) => v - fitted[i]);
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  const sse = resid.reduce((s, v) => s + v * v, 0);
  const sst = y.reduce((s, v) => s + (v - ybar) ** 2, 0);
  const df = n - k;
  const s2 = sse / df;
  const cov = inv.map((r) => r.map((v) => v * s2));
  const se = cov.map((r, i) => Math.sqrt(r[i]));
  const t = beta.map((b, i) => b / se[i]);
  const p = t.map((v) => tPValue(v, df));
  const r2 = sst > 0 ? 1 - sse / sst : NaN;
  const adjR2 = 1 - ((1 - r2) * (n - 1)) / df;
  return { beta, se, t, p, cov, sse, sst, r2, adjR2, df, n, k, s2, fitted, resid };
}

/* ── Design matrix ──
 *
 * spec = {
 *   price: "price", qty: "units",
 *   segment: "rain" | null,        // the category that gets its own elasticity
 *   segmentBase: "0",              // optional reference level
 *   shifters: ["weekday"],         // categories that only move the demand level
 *   nums: [{ col: "temp", log: true }],
 * }
 */
export const LN_P = "ln(price)";

export function levelsOf(rows, col, base) {
  const set = [...new Set(rows.map((r) => String(r[col])))];
  const numeric = set.every((v) => v !== "" && Number.isFinite(Number(v)));
  set.sort(numeric ? (a, b) => Number(a) - Number(b) : (a, b) => a.localeCompare(b));
  if (base != null && set.includes(String(base))) return [String(base), ...set.filter((v) => v !== String(base))];
  return set;
}

export function buildDesign(rows, spec, { interactions = true, segmentDummies = true } = {}) {
  const dropped = { nonPositive: 0, missing: 0 };
  const usable = [];
  for (const r of rows) {
    const p = Number(r[spec.price]), q = Number(r[spec.qty]);
    const cats = [spec.segment, ...(spec.shifters ?? [])].filter(Boolean);
    if (!Number.isFinite(p) || !Number.isFinite(q) || cats.some((c) => r[c] === "" || r[c] == null)) { dropped.missing++; continue; }
    if (p <= 0 || q <= 0) { dropped.nonPositive++; continue; }
    let ok = true;
    for (const nm of spec.nums ?? []) {
      const v = Number(r[nm.col]);
      if (!Number.isFinite(v)) { dropped.missing++; ok = false; break; }
      if (nm.log && v <= 0) { dropped.nonPositive++; ok = false; break; }
    }
    if (ok) usable.push(r);
  }

  const names = ["const", LN_P];
  const cols = [() => 1, (r) => Math.log(Number(r[spec.price]))];
  const segLevels = spec.segment ? levelsOf(usable, spec.segment, spec.segmentBase) : [];

  if (spec.segment && segmentDummies) {
    for (const lv of segLevels.slice(1)) {
      names.push(`${spec.segment}=${lv}`);
      cols.push((r) => (String(r[spec.segment]) === lv ? 1 : 0));
    }
  }
  for (const sh of spec.shifters ?? []) {
    for (const lv of levelsOf(usable, sh).slice(1)) {
      names.push(`${sh}=${lv}`);
      cols.push((r) => (String(r[sh]) === lv ? 1 : 0));
    }
  }
  for (const nm of spec.nums ?? []) {
    names.push(nm.log ? `ln(${nm.col})` : nm.col);
    cols.push(nm.log ? (r) => Math.log(Number(r[nm.col])) : (r) => Number(r[nm.col]));
  }
  if (spec.segment && interactions) {
    for (const lv of segLevels.slice(1)) {
      names.push(`${LN_P} × ${spec.segment}=${lv}`);
      cols.push((r) => (String(r[spec.segment]) === lv ? Math.log(Number(r[spec.price])) : 0));
    }
  }
  const X = usable.map((r) => cols.map((f) => f(r)));
  const y = usable.map((r) => Math.log(Number(r[spec.qty])));
  return { X, y, names, rows: usable, dropped, segLevels };
}

/* ── The analysis the lab shows ── */

export function optimalPrice(eps, cost) {
  if (!(eps < -1) || !(cost > 0)) return null;
  return (cost * eps) / (1 + eps);
}

export function fitElasticity(rows, spec) {
  const full = buildDesign(rows, spec);
  if (full.rows.length < 3) throw new Error("Fewer than three usable rows — nothing to fit.");
  const m = ols(full.X, full.y);
  const idx = (name) => full.names.indexOf(name);
  const iP = idx(LN_P);
  const crit = tQuantile(0.975, m.df);

  // Elasticity per segment level: the base slope plus that level's interaction.
  const levels = spec.segment ? full.segLevels : [null];
  const bySegment = levels.map((lv, li) => {
    const ii = lv != null && li > 0 ? idx(`${LN_P} × ${spec.segment}=${lv}`) : -1;
    const eps = m.beta[iP] + (ii >= 0 ? m.beta[ii] : 0);
    const v = m.cov[iP][iP] + (ii >= 0 ? m.cov[ii][ii] + 2 * m.cov[iP][ii] : 0);
    const se = Math.sqrt(v);
    const sub = lv == null ? full.rows : full.rows.filter((r) => String(r[spec.segment]) === lv);
    const prices = sub.map((r) => Number(r[spec.price]));
    return {
      level: lv, eps, se, lo: eps - crit * se, hi: eps + crit * se,
      t: eps / se, p: tPValue(eps / se, m.df),
      n: sub.length,
      avgPrice: prices.reduce((s, x) => s + x, 0) / (prices.length || 1),
      minPrice: Math.min(...prices), maxPrice: Math.max(...prices),
    };
  });

  // Nested comparison: does letting the slope differ by segment help?
  let slopeTest = null, levelTest = null, restricted = null;
  if (spec.segment && full.segLevels.length > 1) {
    const r = buildDesign(rows, spec, { interactions: false });
    restricted = ols(r.X, r.y);
    const q = full.segLevels.length - 1;
    const F = ((restricted.sse - m.sse) / q) / (m.sse / m.df);
    slopeTest = { F, d1: q, d2: m.df, p: fPValue(F, q, m.df), sseSimple: restricted.sse, sseFull: m.sse };
    // And does the segment move the level at all (dummies + interactions together)?
    const z = buildDesign(rows, spec, { interactions: false, segmentDummies: false });
    const none = ols(z.X, z.y);
    const q2 = 2 * q;
    const F2 = ((none.sse - m.sse) / q2) / (m.sse / m.df);
    levelTest = { F: F2, d1: q2, d2: m.df, p: fPValue(F2, q2, m.df), sseSimple: none.sse, sseFull: m.sse };
  }

  // The one-line version — price only — for comparison with the full model.
  const pooledRows = full.rows;
  const pooled = ols(pooledRows.map((r) => [1, Math.log(Number(r[spec.price]))]), pooledRows.map((r) => Math.log(Number(r[spec.qty]))));

  // Separate regressions per level, exactly as the course Colab does them.
  const separate = spec.segment ? full.segLevels.map((lv) => {
    const sub = full.rows.filter((r) => String(r[spec.segment]) === lv);
    if (sub.length < 3) return { level: lv, n: sub.length, eps: NaN };
    const o = ols(sub.map((r) => [1, Math.log(Number(r[spec.price]))]), sub.map((r) => Math.log(Number(r[spec.qty]))));
    return { level: lv, n: sub.length, eps: o.beta[1], se: o.se[1], r2: o.r2, intercept: o.beta[0] };
  }) : null;

  return {
    spec, names: full.names, model: m, rows: full.rows, dropped: full.dropped,
    segLevels: full.segLevels, bySegment, slopeTest, levelTest, restricted, pooled, separate,
  };
}

/* ln Q predicted for one segment level at a price, with every other variable
 * held at its sample mean ("average conditions"). */
export function predictLnQ(fit, level, price) {
  const { names, model, spec } = fit;
  const means = columnMeans(fit);
  return names.reduce((s, name, j) => {
    let x;
    if (name === "const") x = 1;
    else if (name === LN_P) x = Math.log(price);
    else if (spec.segment && name === `${spec.segment}=${level}`) x = 1;
    else if (spec.segment && name.startsWith(`${spec.segment}=`)) x = 0;
    else if (spec.segment && name === `${LN_P} × ${spec.segment}=${level}`) x = Math.log(price);
    else if (spec.segment && name.startsWith(`${LN_P} × ${spec.segment}=`)) x = 0;
    else x = means[j];
    return s + model.beta[j] * x;
  }, 0);
}

// Cached per fit: a profit curve calls predictLnQ a few hundred times.
const MEANS_CACHE = new WeakMap();
function columnMeans(fit) {
  let m = MEANS_CACHE.get(fit);
  if (!m) {
    const { X } = buildDesign(fit.rows, fit.spec);
    m = fit.names.map((_, j) => X.reduce((s, r) => s + r[j], 0) / X.length);
    MEANS_CACHE.set(fit, m);
  }
  return m;
}

/* ── Offer data (accept / reject) → demand ──
 *
 * One response says little; the share of people who accept at each price is
 * the demand curve. Rows are grouped by price and by every category column,
 * and a cell where nobody accepted gets half an acceptance, so ln(0) does not
 * throw the cell away (dropping it would bias the elasticity towards zero —
 * the cells that vanish are exactly the high-price ones). The fix is flagged. */
export function aggregateOffers(responses, { price = "price", accept = "accept", cats = [] } = {}) {
  const cells = new Map();
  for (const r of responses) {
    const p = Number(r[price]);
    if (!Number.isFinite(p)) continue;
    const key = [p.toFixed(4), ...cats.map((c) => String(r[c]))].join("|");
    let cell = cells.get(key);
    if (!cell) {
      cell = { price: p, offers: 0, accepts: 0 };
      for (const c of cats) cell[c] = String(r[c]);
      cells.set(key, cell);
    }
    cell.offers++;
    if (Number(r[accept]) === 1 || r[accept] === true || /^(y|yes|si|sí|true)$/i.test(String(r[accept]))) cell.accepts++;
  }
  return [...cells.values()]
    .sort((a, b) => a.price - b.price)
    .map((c) => ({ ...c, share: (c.accepts || 0.5) / c.offers, zeroFixed: c.accepts === 0 }));
}

/* Detects whether an uploaded quantity column is really yes/no. */
export function looksBinary(rows, col) {
  const vals = new Set(rows.map((r) => String(r[col]).trim().toLowerCase()).filter((v) => v !== ""));
  return vals.size > 0 && vals.size <= 2 && [...vals].every((v) => ["0", "1", "yes", "no", "si", "sí", "true", "false", "y", "n"].includes(v));
}

/* ── Simulation ──
 *
 * Two kinds of data, the two kinds the course uses:
 *
 *  simulateSales      — one row per day (or store): the price charged and the
 *                       units sold, like the Colab's 14 pairs. Demand is built
 *                       constant-elasticity on purpose, so the student can
 *                       check the regression recovers the ε they typed in.
 *  simulateOffers     — virtual respondents, each with a willingness to pay,
 *                       answering yes/no to prices around a starting price.
 *                       This is the live class exercise played by a computer.
 */
function normal(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pickLevel(levels, rng) {
  const tot = levels.reduce((s, l) => s + (Number(l.share) || 0), 0) || levels.length;
  let u = rng() * tot;
  for (const l of levels) {
    u -= Number(l.share) || (tot === levels.length ? 1 : 0);
    if (u <= 0) return l;
  }
  return levels[levels.length - 1];
}

const r2dp = (v) => Math.round(v * 100) / 100;

/* cfg = {
 *   n, pMin, pMax, pRef, qRef, noise,
 *   segment: { name, levels: [{ name, eps, shift, share }] } | null,
 *   eps,                                   // used when there is no segment
 *   shifters: [{ name, levels: [{ name, shift, share }] }],
 *   nums: [{ name, min, max, eff }],       // Q ∝ (x / mid)^eff
 * } */
export function simulateSales(cfg, seed = 42) {
  const rng = mulberry32(seed);
  const out = [];
  for (let i = 0; i < cfg.n; i++) {
    const row = {};
    const price = r2dp(cfg.pMin + rng() * (cfg.pMax - cfg.pMin));
    row.price = price;
    let eps = Number(cfg.eps), mult = 1;
    if (cfg.segment?.levels?.length) {
      const l = pickLevel(cfg.segment.levels, rng);
      row[cfg.segment.name] = l.name;
      eps = Number(l.eps);
      mult *= Number(l.shift) || 1;
    }
    for (const sh of cfg.shifters ?? []) {
      const l = pickLevel(sh.levels, rng);
      row[sh.name] = l.name;
      mult *= Number(l.shift) || 1;
    }
    for (const nm of cfg.nums ?? []) {
      const lo = Number(nm.min), hi = Number(nm.max);
      const x = Math.round((lo + rng() * (hi - lo)) * 10) / 10;
      row[nm.name] = x;
      const mid = (lo + hi) / 2;
      if (mid > 0 && x > 0) mult *= (x / mid) ** Number(nm.eff || 0);
    }
    const q = cfg.qRef * mult * (price / cfg.pRef) ** eps * Math.exp(Number(cfg.noise || 0) * normal(rng));
    row.units = cfg.qRef >= 20 ? Math.max(1, Math.round(q)) : Math.max(0.1, Math.round(q * 10) / 10);
    out.push(row);
  }
  return out;
}

/* The price grid a live session offers from: `levels` prices spread evenly
 * over start ± range%. A grid rather than continuous prices so every price is
 * offered many times and its acceptance share means something. */
export function priceGrid(start, rangePct, levels) {
  const lo = start * (1 - rangePct / 100), hi = start * (1 + rangePct / 100);
  if (levels < 2) return [r2dp(start)];
  return Array.from({ length: levels }, (_, i) => r2dp(lo + ((hi - lo) * i) / (levels - 1)));
}

/* Which prices one respondent sees: `k` of the grid, in random order, no
 * repeats until the grid is exhausted — so answers are spread over the whole
 * range and nobody sees the prices climb in a neat staircase (which would
 * anchor them). */
export function offerSequence(grid, k, rng) {
  const out = [];
  while (out.length < k) {
    const pool = [...grid];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    out.push(...pool);
  }
  return out.slice(0, k);
}

/* cfg = { respondents, start, rangePct, levels, offersEach, sigma,
 *         segment: { name, levels: [{ name, wtp, share }] } | null, wtp,
 *         groupSize }                    // > 1: answers in groups, as the live room
 *
 * With groupSize the answers at each price (and category) are dealt into
 * groups of that size, like the live room does, and every group becomes one
 * point; a last group left short at a price is kept, smaller. */
export function simulateOffers(cfg, seed = 42) {
  const rng = mulberry32(seed);
  const grid = priceGrid(cfg.start, cfg.rangePct, cfg.levels);
  const out = [];
  for (let i = 0; i < cfg.respondents; i++) {
    const l = cfg.segment?.levels?.length ? pickLevel(cfg.segment.levels, rng) : null;
    const median = Number(l ? l.wtp : cfg.wtp);
    const wtp = median * Math.exp(Number(cfg.sigma) * normal(rng));
    for (const price of offerSequence(grid, cfg.offersEach, rng)) {
      const row = { respondent: `r${i + 1}`, price, accept: wtp >= price ? 1 : 0 };
      if (l) row[cfg.segment.name] = l.name;
      out.push(row);
    }
  }
  const size = Math.round(Number(cfg.groupSize) || 0);
  if (size > 1) {
    const cells = new Map();
    for (const r of out) {
      const key = `${r.price}|${cfg.segment ? r[cfg.segment.name] : ""}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(r);
    }
    let g = 0;
    for (const rows of cells.values()) {
      for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [rows[i], rows[j]] = [rows[j], rows[i]];
      }
      rows.forEach((r, i) => { if (i % size === 0) g++; r.group = `g${g}`; });
    }
  }
  return out;
}

/* The sales simulation run many times with new random noise, each sample
 * fitted with the model that matches how it was generated. What it shows:
 * the estimates scatter around the true ε (the method is unbiased) and about
 * 95% of the 95% intervals contain it. Returns, per level, the estimates and
 * how many intervals covered the truth. */
export function repeatSales(cfg, reps = 200, seed = 1) {
  const spec = {
    price: "price", qty: "units", segment: cfg.segment ? cfg.segment.name : null,
    shifters: [], nums: (cfg.nums ?? []).map((x) => ({ col: x.name, log: true })),
  };
  const truth = cfg.segment
    ? Object.fromEntries(cfg.segment.levels.map((l) => [l.name, Number(l.eps)]))
    : { all: Number(cfg.eps) };
  const out = Object.fromEntries(Object.keys(truth).map((k) => [k, { truth: truth[k], est: [], covered: 0 }]));
  let failed = 0, detected = 0;
  for (let r = 0; r < reps; r++) {
    try {
      const f = fitElasticity(simulateSales(cfg, seed + r), spec);
      for (const s of f.bySegment) {
        const o = out[s.level ?? "all"];
        if (!o) continue;
        o.est.push(s.eps);
        if (s.lo <= o.truth && o.truth <= s.hi) o.covered++;
      }
      if (f.slopeTest && f.slopeTest.p < 0.05) detected++;
    } catch {
      failed++;
    }
  }
  return { levels: out, reps, failed, detected, spec };
}

/* The elasticity implied at price P when willingness to pay is log-normal with
 * this median and sigma: the share accepting is S(P) = 1 − Φ(z), so
 * ε(P) = d ln S / d ln P = −φ(z) / (σ·S). Not constant — which is the point the
 * lab makes with it: a log-log line is an approximation of this curve over the
 * range of prices actually offered. */
export function lognormalElasticity(P, median, sigma) {
  const z = (Math.log(P) - Math.log(median)) / sigma;
  const S = 1 - Phi(z);
  return S > 1e-9 ? -phi(z) / (sigma * S) : -Infinity;
}

/* ── The course datasets ── */

// The 14 price-demand pairs from the technical note and the univariate Colab.
export const COLAB_PAIRS = [
  [2.4, 62], [2.4, 53], [2.4, 51], [2.45, 58], [2.47, 58], [2.53, 47], [2.57, 48],
  [2.59, 39], [2.6, 43], [2.6, 45], [2.65, 42], [2.67, 43], [2.71, 38], [2.73, 33],
];
// The same days with the weather, from the multivariate Colab (1 = it rained).
export const COLAB_RAIN = [0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1];
export const COLAB_COST = 1.8;
