/* DBSCAN — density-based clustering.
 *
 * The reason it earns a place next to k-means in a marketing course: it does
 * not force every customer into a segment. Points in no dense region come back
 * as noise (label -1), and those outliers are frequently the commercially
 * interesting ones — the whale, the fraud, the mis-keyed record. */

import { euc, eucSq } from "./prep.js";

const UNCLASSIFIED = -2;
export const NOISE = -1;

export function dbscan(points, eps, minPts) {
  const n = points.length;
  const labels = new Int32Array(n).fill(UNCLASSIFIED);
  let clusterId = 0;

  const region = (i) => {
    const out = [];
    for (let j = 0; j < n; j++) if (euc(points[i], points[j]) <= eps) out.push(j);
    return out;
  };

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNCLASSIFIED) continue;
    const neighbours = region(i);
    // minPts counts the point itself, matching scikit-learn's min_samples.
    if (neighbours.length < minPts) { labels[i] = NOISE; continue; }

    labels[i] = clusterId;
    const queue = neighbours.filter((j) => j !== i);
    for (let q = 0; q < queue.length; q++) {
      const j = queue[q];
      // A point previously written off as noise can still join as a border
      // point — it just cannot seed expansion of its own.
      if (labels[j] === NOISE) labels[j] = clusterId;
      if (labels[j] !== UNCLASSIFIED) continue;
      labels[j] = clusterId;
      const jn = region(j);
      if (jn.length >= minPts) for (const x of jn) if (labels[x] === UNCLASSIFIED || labels[x] === NOISE) queue.push(x);
    }
    clusterId++;
  }

  const counts = new Array(clusterId).fill(0);
  let noise = 0;
  for (const l of labels) (l === NOISE ? (noise += 1) : (counts[l] += 1));
  return { labels: Array.from(labels), nClusters: clusterId, noise, counts };
}

/* The k-distance curve: sorted distance to each point's k-th nearest
 * neighbour. Its knee is the standard way to pick eps, and it gives students
 * something to justify the parameter with instead of guessing.
 *
 * Only the k-th smallest distance is wanted, so the whole row is never sorted:
 * a k-sized running list of the smallest squared distances is kept instead,
 * and the square root is taken once at the end. On a few thousand rows that is
 * the difference between a visible freeze and an instant answer. */
export function kDistance(points, k) {
  const n = points.length;
  const out = new Float64Array(n);
  const kk = Math.max(1, Math.min(k, n - 1));
  const best = new Float64Array(kk);

  for (let i = 0; i < n; i++) {
    best.fill(Infinity);
    const pi = points[i];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = eucSq(pi, points[j]);
      if (d >= best[kk - 1]) continue;
      // Insert into the sorted running list; kk is small, so this beats a sort.
      let p = kk - 1;
      while (p > 0 && best[p - 1] > d) { best[p] = best[p - 1]; p--; }
      best[p] = d;
    }
    const v = best[kk - 1];
    out[i] = Number.isFinite(v) ? Math.sqrt(v) : 0;
  }
  return Array.from(out).sort((a, b) => a - b);
}

/* Knee of the k-distance curve by maximum distance to the chord joining its
 * endpoints — the "kneedle" construction. Only ever a starting suggestion:
 * the UI shows it as a proposed eps that the student can override. */
export function suggestEps(sortedKDist) {
  const n = sortedKDist.length;
  if (n < 3) return sortedKDist[0] ?? 0.5;
  const x0 = 0, y0 = sortedKDist[0], x1 = n - 1, y1 = sortedKDist[n - 1];
  const dx = x1 - x0, dy = y1 - y0;
  const norm = Math.hypot(dx, dy) || 1;
  let bestI = 0, bestD = -Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(dy * (i - x0) - dx * (sortedKDist[i] - y0)) / norm;
    if (d > bestD) { bestD = d; bestI = i; }
  }
  return Math.round(sortedKDist[bestI] * 1000) / 1000;
}

/* minPts rule of thumb: twice the dimensionality (Sander et al.), floored at 4.
 * Stated in the UI so the choice is defensible rather than arbitrary. */
export const suggestMinPts = (dim) => Math.max(4, 2 * dim);
