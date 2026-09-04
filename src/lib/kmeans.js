/* K-means and K-prototypes.
 *
 * Both are Lloyd-style alternating minimisation: assign, recompute, repeat.
 * The only differences are the distance and what "recompute the centre" means
 * — mean for numeric, mode for categorical. */

import { mulberry32, eucSq, hamming, mode } from "./prep.js";

/* k-means++ seeding. The plain "pick k rows at random" of the original script
 * is what produces the bad local optimum shown in the technical note; ++ picks
 * far-apart seeds and converges to a good solution far more often. Kept as an
 * option so the note's local-optimum demonstration still reproduces. */
function initPlusPlus(points, k, rnd) {
  const n = points.length;
  const centroids = [[...points[Math.floor(rnd() * n)]]];
  const d2 = new Float64Array(n).fill(Infinity);
  while (centroids.length < k) {
    const last = centroids[centroids.length - 1];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = eucSq(points[i], last);
      if (d < d2[i]) d2[i] = d;
      total += d2[i];
    }
    if (total === 0) { // all remaining points are duplicates of a centroid
      centroids.push([...points[Math.floor(rnd() * n)]]);
      continue;
    }
    let target = rnd() * total;
    let idx = n - 1;
    for (let i = 0; i < n; i++) { target -= d2[i]; if (target <= 0) { idx = i; break; } }
    centroids.push([...points[idx]]);
  }
  return centroids;
}

function initRandom(points, k, rnd) {
  const picked = new Set();
  while (picked.size < k) picked.add(Math.floor(rnd() * points.length));
  return [...picked].map((i) => [...points[i]]);
}

export function wcss(points, centroids, assign) {
  let s = 0;
  for (let i = 0; i < points.length; i++) s += eucSq(points[i], centroids[assign[i]]);
  return s;
}

function lloyd(points, k, centroids, maxIter) {
  const n = points.length;
  const dim = points[0].length;
  let assign = new Int32Array(n).fill(-1);
  let iterations = 0;
  for (; iterations < maxIter; iterations++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < k; j++) {
        const d = eucSq(points[i], centroids[j]);
        if (d < bd) { bd = d; best = j; }
      }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }
    if (!changed) break;
    const sums = Array.from({ length: k }, () => new Float64Array(dim));
    const counts = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      const a = assign[i];
      for (let d = 0; d < dim; d++) sums[a][d] += points[i][d];
      counts[a]++;
    }
    for (let j = 0; j < k; j++)
      if (counts[j] > 0) centroids[j] = Array.from(sums[j], (x) => x / counts[j]);
    // An empty cluster keeps its previous centroid rather than being dropped:
    // silently returning fewer than k clusters would break the centroid table.
  }
  return { centroids, assign: Array.from(assign), iterations };
}

/* Runs the algorithm `restarts` times and keeps the lowest-WCSS solution.
 * This is exactly the "initialise several times and select the lowest cost J"
 * remedy the technical note prescribes for the local-optimum problem. */
export function kmeans(points, k, opts = {}) {
  const { restarts = 25, maxIter = 300, seed = 42, init = "kmeans++" } = opts;
  const rnd = mulberry32(seed);
  let best = null;
  for (let r = 0; r < restarts; r++) {
    const start = init === "random" ? initRandom(points, k, rnd) : initPlusPlus(points, k, rnd);
    const res = lloyd(points, k, start, maxIter);
    const cost = wcss(points, res.centroids, res.assign);
    if (!best || cost < best.wcss) best = { ...res, wcss: cost, restart: r };
  }
  return best;
}

export function elbow(points, kMax, opts = {}) {
  const out = [];
  const top = Math.min(kMax, points.length - 1);
  for (let k = 1; k <= top; k++) out.push({ k, wcss: kmeans(points, k, opts).wcss });
  return out;
}

/* K-prototypes (Huang 1997): Euclidean on the numeric part plus gamma times
 * Hamming on the categorical part. Gamma trades the two off; Huang's rule of
 * thumb is half the mean numeric standard deviation, which is what the UI
 * offers as the default. */
export function kprototypes(num, cat, k, opts = {}) {
  const { gamma = 1, restarts = 15, maxIter = 300, seed = 42 } = opts;
  const rnd = mulberry32(seed);
  const n = num.length;
  const dn = num[0]?.length ?? 0;
  const dc = cat[0]?.length ?? 0;

  const cost = (numC, catC, assign) => {
    let s = 0;
    for (let i = 0; i < n; i++)
      s += eucSq(num[i], numC[assign[i]]) + gamma * hamming(cat[i], catC[assign[i]]);
    return s;
  };

  let best = null;
  for (let r = 0; r < restarts; r++) {
    const picked = new Set();
    while (picked.size < k) picked.add(Math.floor(rnd() * n));
    const seeds = [...picked];
    let numC = seeds.map((i) => [...num[i]]);
    let catC = seeds.map((i) => [...cat[i]]);
    let assign = new Int32Array(n).fill(-1);
    let iterations = 0;

    for (; iterations < maxIter; iterations++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        let bestJ = 0;
        let bd = Infinity;
        for (let j = 0; j < k; j++) {
          const d = eucSq(num[i], numC[j]) + gamma * hamming(cat[i], catC[j]);
          if (d < bd) { bd = d; bestJ = j; }
        }
        if (assign[i] !== bestJ) { assign[i] = bestJ; changed = true; }
      }
      if (!changed) break;

      const sums = Array.from({ length: k }, () => new Float64Array(dn));
      const buckets = Array.from({ length: k }, () => Array.from({ length: dc }, () => []));
      const counts = new Int32Array(k);
      for (let i = 0; i < n; i++) {
        const a = assign[i];
        for (let d = 0; d < dn; d++) sums[a][d] += num[i][d];
        for (let d = 0; d < dc; d++) buckets[a][d].push(cat[i][d]);
        counts[a]++;
      }
      for (let j = 0; j < k; j++) {
        if (!counts[j]) continue;
        numC[j] = Array.from(sums[j], (x) => x / counts[j]);
        catC[j] = buckets[j].map((col) => mode(col));
      }
    }
    const c = cost(numC, catC, assign);
    if (!best || c < best.cost) best = { numC, catC, assign: Array.from(assign), iterations, cost: c, wcss: c };
  }
  return best;
}

/* Huang's heuristic for gamma: half the average standard deviation of the
 * standardised numeric columns. On z-scored data that is ~0.5, but it is
 * computed rather than hardcoded so it stays right if scaling changes. */
export function suggestGamma(num) {
  if (!num.length || !num[0].length) return 1;
  const d = num[0].length;
  let total = 0;
  for (let j = 0; j < d; j++) {
    let m = 0;
    for (const row of num) m += row[j];
    m /= num.length;
    let v = 0;
    for (const row of num) v += (row[j] - m) ** 2;
    total += Math.sqrt(v / num.length);
  }
  return Math.round((total / d) * 0.5 * 100) / 100 || 1;
}
