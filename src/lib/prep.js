/* Data preparation: missing values, scaling, type detection.
 *
 * Everything downstream assumes the matrices produced here are dense and
 * numeric. Standardisation is not optional for distance-based clustering —
 * an income column in euros would otherwise drown an age column in years,
 * which is the single most common mistake students make. */

/* A seeded generator, so a student who reports "k=4, seed 42" can be given
 * the same clusters back by anyone re-running it. Math.random() cannot do
 * that, and reproducibility is part of what the deliverable is marked on. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const isMissing = (v) =>
  v === "" ||
  v === null ||
  v === undefined ||
  (typeof v === "number" && !Number.isFinite(v)) ||
  /^(\?|NA|N\/A|nan|none|null|-)$/i.test(String(v).trim());

/* A column is numeric when every non-missing value parses as a finite number.
 * Survey data often codes categories as 1/2/3, which would pass this test —
 * hence `distinctCount`, which the UI uses to warn that a "numeric" column
 * with 4 distinct values is probably an ordinal scale. */
export function profileColumn(rows, key) {
  let numeric = 0;
  let present = 0;
  const distinct = new Set();
  for (const r of rows) {
    const v = r[key];
    if (isMissing(v)) continue;
    present++;
    distinct.add(String(v));
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (Number.isFinite(n)) numeric++;
  }
  return {
    key,
    present,
    missing: rows.length - present,
    distinctCount: distinct.size,
    isNumeric: present > 0 && numeric === present,
    values: distinct,
  };
}

export function profileAll(rows, headers) {
  return headers.map((h) => profileColumn(rows, h));
}

export const toNum = (v) =>
  typeof v === "number" ? v : Number(String(v).replace(",", "."));

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mode = (a) => {
  const f = new Map();
  for (const v of a) f.set(v, (f.get(v) || 0) + 1);
  let best = null;
  let bn = -1;
  for (const [v, n] of f) if (n > bn) { bn = n; best = v; }
  return best;
};

export { mean, median, mode };

/* Missing-value fill. Returns a new array of rows; never mutates the input,
 * because the raw upload is kept so the user can change strategy and re-run. */
export function fillMissing(rows, cols, strategy) {
  const fills = {};
  for (const c of cols) {
    const present = rows.map((r) => r[c.key]).filter((v) => !isMissing(v));
    if (!present.length) { fills[c.key] = c.isNumeric ? 0 : "unknown"; continue; }
    if (!c.isNumeric) { fills[c.key] = mode(present.map(String)); continue; }
    const nums = present.map(toNum);
    fills[c.key] =
      strategy === "median" ? median(nums)
      : strategy === "mode" ? toNum(mode(present.map(String)))
      : mean(nums);
  }
  return rows.map((r) => {
    const o = { ...r };
    for (const c of cols) if (isMissing(o[c.key])) o[c.key] = fills[c.key];
    return o;
  });
}

export function dropMissing(rows, cols) {
  return rows.filter((r) => cols.every((c) => !isMissing(r[c.key])));
}

/* z-score. Returns the matrix plus the mus and sigmas, because the centroid
 * table has to be shown in original units — a centroid of "-0.83" means
 * nothing to a marketer, "income = 24,300 €" does. */
export function standardize(matrix) {
  const n = matrix.length;
  const d = matrix[0]?.length ?? 0;
  const mu = new Array(d).fill(0);
  const sigma = new Array(d).fill(0);
  for (let j = 0; j < d; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += matrix[i][j];
    mu[j] = s / n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (matrix[i][j] - mu[j]) ** 2;
    // Population sd: the data is the whole set being clustered, not a sample of it.
    sigma[j] = Math.sqrt(v / n) || 1;
  }
  const z = matrix.map((row) => row.map((x, j) => (x - mu[j]) / sigma[j]));
  return { z, mu, sigma };
}

export const destandardize = (vec, mu, sigma) =>
  vec.map((x, j) => x * sigma[j] + mu[j]);

export function minmax(matrix) {
  const d = matrix[0]?.length ?? 0;
  const lo = new Array(d).fill(Infinity);
  const hi = new Array(d).fill(-Infinity);
  for (const row of matrix)
    for (let j = 0; j < d; j++) {
      if (row[j] < lo[j]) lo[j] = row[j];
      if (row[j] > hi[j]) hi[j] = row[j];
    }
  const rng = lo.map((l, j) => hi[j] - l || 1);
  return { z: matrix.map((r) => r.map((x, j) => (x - lo[j]) / rng[j])), mu: lo, sigma: rng };
}

export function buildMatrix(rows, keys) {
  return rows.map((r) => keys.map((k) => toNum(r[k])));
}

export function buildCatMatrix(rows, keys) {
  return rows.map((r) => keys.map((k) => String(r[k])));
}

/* Squared Euclidean. Squared on purpose: monotone in the true distance, so it
 * ranks neighbours identically while skipping a sqrt in the hottest loop. */
export const eucSq = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
};
export const euc = (a, b) => Math.sqrt(eucSq(a, b));

/* Hamming, normalised by nothing — it is a raw count of mismatching
 * attributes, which is what the k-prototypes cost function expects. */
export const hamming = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) s++;
  return s;
};

/* Full pairwise distance matrix, upper triangle mirrored. O(n²) memory, which
 * is why hierarchical clustering is capped in the UI. */
export function distanceMatrix(points) {
  const n = points.length;
  const D = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = euc(points[i], points[j]);
      D[i][j] = d;
      D[j][i] = d;
    }
  return D;
}

/* Gower distance for mixed data, in [0,1]. Numeric contributions are ranged,
 * categorical ones are 0/1. This is what makes hierarchical clustering usable
 * on survey data, where Ward on raw categories is meaningless. */
export function gowerMatrix(num, cat) {
  const n = Math.max(num.length, cat.length);
  const dn = num[0]?.length ?? 0;
  const dc = cat[0]?.length ?? 0;
  const rng = new Array(dn).fill(1);
  for (let j = 0; j < dn; j++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const v = num[i][j]; if (v < lo) lo = v; if (v > hi) hi = v; }
    rng[j] = hi - lo || 1;
  }
  const D = Array.from({ length: n }, () => new Float64Array(n));
  const p = dn + dc;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      let s = 0;
      for (let k = 0; k < dn; k++) s += Math.abs(num[i][k] - num[j][k]) / rng[k];
      for (let k = 0; k < dc; k++) s += cat[i][k] !== cat[j][k] ? 1 : 0;
      const d = p ? s / p : 0;
      D[i][j] = d;
      D[j][i] = d;
    }
  return D;
}
