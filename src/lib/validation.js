/* Cluster validation.
 *
 * The elbow alone cannot tell you whether a partition is any good — it only
 * ever decreases, so it says nothing about separation. These three indices do,
 * and they are what lets a student defend "we chose k = 4" with something
 * other than "the curve bends a bit here".
 *
 * Read them together, not one at a time: they disagree often, and the
 * disagreement is itself informative. */

import { euc, mulberry32 } from "./prep.js";

/* Silhouette. For point i: a = mean distance to its own cluster, b = mean
 * distance to the nearest OTHER cluster, s = (b − a) / max(a, b).
 * s → 1 well inside its cluster, s ≈ 0 on a boundary, s < 0 probably
 * misassigned. Singleton clusters score 0 by definition.
 *
 * Cost is O(n²), which on a few thousand customers is several seconds — and
 * the guided activities compute it twenty-odd times. `sampleSize` scores a
 * random subset of points while still measuring their distances against every
 * point, which is what scikit-learn's `sample_size` does. The mean is then an
 * estimate, and anything that uses it says so. */
export function silhouette(points, labels, k, opts = {}) {
  const n = points.length;
  const { sampleSize = 0, seed = 42 } = opts;
  const sizes = new Array(k).fill(0);
  for (const l of labels) if (l >= 0) sizes[l]++;

  let scored = null;
  if (sampleSize && sampleSize < n) {
    // Deterministic subset, so a reported figure can be reproduced.
    const rnd = mulberry32(seed);
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    scored = new Set(idx.slice(0, sampleSize));
  }

  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const own = labels[i];
    if (own < 0 || sizes[own] <= 1 || (scored && !scored.has(i))) { s[i] = 0; continue; }
    const sums = new Float64Array(k);
    const counts = new Int32Array(k);
    for (let j = 0; j < n; j++) {
      if (i === j || labels[j] < 0) continue;
      const d = euc(points[i], points[j]);
      sums[labels[j]] += d;
      counts[labels[j]]++;
    }
    const a = counts[own] ? sums[own] / counts[own] : 0;
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === own || !counts[c]) continue;
      const m = sums[c] / counts[c];
      if (m < b) b = m;
    }
    s[i] = b === Infinity ? 0 : (b - a) / Math.max(a, b);
  }

  const perCluster = new Array(k).fill(0);
  const pcCount = new Array(k).fill(0);
  let total = 0;
  let counted = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] < 0 || (scored && !scored.has(i))) continue;
    perCluster[labels[i]] += s[i];
    pcCount[labels[i]]++;
    total += s[i];
    counted++;
  }
  return {
    mean: counted ? total / counted : 0,
    perPoint: Array.from(s),
    perCluster: perCluster.map((v, i) => (pcCount[i] ? v / pcCount[i] : 0)),
    // Non-null when the mean is an estimate rather than the exact figure.
    sampled: scored ? counted : null,
    scoredIndices: scored,
  };
}

/* Davies–Bouldin: mean over clusters of the worst-case ratio
 * (spread_i + spread_j) / distance(centroid_i, centroid_j).
 * LOWER is better — the one index here where that is true. */
export function daviesBouldin(points, labels, centroids) {
  const k = centroids.length;
  const spread = new Array(k).fill(0);
  const counts = new Array(k).fill(0);
  points.forEach((p, i) => {
    const l = labels[i];
    if (l < 0) return;
    spread[l] += euc(p, centroids[l]);
    counts[l]++;
  });
  for (let i = 0; i < k; i++) spread[i] = counts[i] ? spread[i] / counts[i] : 0;

  let total = 0;
  let used = 0;
  for (let i = 0; i < k; i++) {
    if (!counts[i]) continue;
    let worst = 0;
    for (let j = 0; j < k; j++) {
      if (i === j || !counts[j]) continue;
      const sep = euc(centroids[i], centroids[j]) || 1e-12;
      const r = (spread[i] + spread[j]) / sep;
      if (r > worst) worst = r;
    }
    total += worst;
    used++;
  }
  return used ? total / used : 0;
}

/* Calinski–Harabasz (variance ratio): between-cluster dispersion over
 * within-cluster dispersion, scaled by the degrees of freedom. HIGHER is
 * better. Rewards compact, well-separated clusters and penalises k directly. */
export function calinskiHarabasz(points, labels, centroids) {
  const n = points.length;
  const k = centroids.length;
  const dim = points[0]?.length ?? 0;
  const grand = new Float64Array(dim);
  let valid = 0;
  points.forEach((p, i) => {
    if (labels[i] < 0) return;
    for (let d = 0; d < dim; d++) grand[d] += p[d];
    valid++;
  });
  if (!valid || k < 2) return 0;
  for (let d = 0; d < dim; d++) grand[d] /= valid;

  const counts = new Array(k).fill(0);
  for (const l of labels) if (l >= 0) counts[l]++;

  let between = 0;
  for (let j = 0; j < k; j++) {
    if (!counts[j]) continue;
    let s = 0;
    for (let d = 0; d < dim; d++) s += (centroids[j][d] - grand[d]) ** 2;
    between += counts[j] * s;
  }
  let within = 0;
  points.forEach((p, i) => {
    const l = labels[i];
    if (l < 0) return;
    for (let d = 0; d < dim; d++) within += (p[d] - centroids[l][d]) ** 2;
  });
  if (within === 0) return 0;
  return (between / (k - 1)) / (within / (valid - k));
}

/* Everything at once, for the k-selection table. */
export function scorePartition(points, labels, centroids, k, opts = {}) {
  const sil = silhouette(points, labels, k, opts);
  return {
    k,
    silhouette: sil.mean,
    silhouettePerCluster: sil.perCluster,
    silhouettePerPoint: sil.perPoint,
    silhouetteSampled: sil.sampled,
    silhouetteScored: sil.scoredIndices,
    daviesBouldin: daviesBouldin(points, labels, centroids),
    calinskiHarabasz: calinskiHarabasz(points, labels, centroids),
  };
}

/* Plain-language reading of a silhouette score, using Kaufman & Rousseeuw's
 * conventional bands. Shown next to the number so it is interpreted rather
 * than just reported. */
export function silhouetteVerdict(s) {
  if (s >= 0.71) return { label: "strong structure", tone: "good" };
  if (s >= 0.51) return { label: "reasonable structure", tone: "good" };
  if (s >= 0.26) return { label: "weak — could be artificial", tone: "warn" };
  return { label: "no substantial structure", tone: "bad" };
}

/* Agreement between two partitions, for the reconciliation step: how often do
 * two algorithms put the same pair of customers together? Adjusted Rand
 * Index — 1 identical, 0 what chance would give, negative worse than chance. */
export function adjustedRand(a, b) {
  const n = a.length;
  const ai = new Map();
  const bi = new Map();
  for (const v of a) if (!ai.has(v)) ai.set(v, ai.size);
  for (const v of b) if (!bi.has(v)) bi.set(v, bi.size);
  const table = Array.from({ length: ai.size }, () => new Array(bi.size).fill(0));
  for (let i = 0; i < n; i++) table[ai.get(a[i])][bi.get(b[i])]++;

  const c2 = (x) => (x * (x - 1)) / 2;
  let sumIJ = 0;
  const rowSums = new Array(ai.size).fill(0);
  const colSums = new Array(bi.size).fill(0);
  for (let i = 0; i < ai.size; i++)
    for (let j = 0; j < bi.size; j++) {
      sumIJ += c2(table[i][j]);
      rowSums[i] += table[i][j];
      colSums[j] += table[i][j];
    }
  const sumRow = rowSums.reduce((s, x) => s + c2(x), 0);
  const sumCol = colSums.reduce((s, x) => s + c2(x), 0);
  const total = c2(n);
  const expected = (sumRow * sumCol) / (total || 1);
  const max = (sumRow + sumCol) / 2;
  return max - expected === 0 ? 0 : (sumIJ - expected) / (max - expected);
}
