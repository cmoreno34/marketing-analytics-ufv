/* One analysis, computed once, read by every step of a worksheet.
 *
 * The guided activities ask about k-means at several k, the Ward tree, DBSCAN
 * and the agreement between them. Recomputing per step would be both slow and
 * — worse — inconsistent, because a step that re-ran k-means with a different
 * restart count could quietly contradict the step before it. So it all happens
 * here, once, with one seed. */

import { standardize, minmax, buildMatrix, buildCatMatrix } from "./prep.js";
import { kmeans, kprototypes, suggestGamma } from "./kmeans.js";
import { linkage, cutTree, centroidsFromLabels, mergeGaps, dendrogramLayout } from "./hierarchical.js";
import { dbscan, kDistance, suggestEps, suggestMinPts } from "./dbscan.js";
import { scorePartition, adjustedRand } from "./validation.js";

export const K_RANGE = [2, 3, 4, 5, 6, 7, 8];
const HIER_LIMIT = 3000;

/* Cluster means in original units, plus modes for any categorical column —
 * the table a student actually reads. */
function centroidTable(rows, numRaw, numCols, catCols, labels, k) {
  const cs = centroidsFromLabels(numRaw, labels, k);
  return Array.from({ length: k }, (_, c) => {
    const o = {};
    numCols.forEach((key, j) => { o[key] = cs[c][j]; });
    catCols.forEach((key) => {
      const freq = new Map();
      rows.forEach((r, i) => {
        if (labels[i] !== c) return;
        const v = String(r[key]);
        freq.set(v, (freq.get(v) || 0) + 1);
      });
      o[key] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    });
    return o;
  });
}

/* WCSS at k = 1: the spread of the whole dataset around its own mean. */
function totalSS(z) {
  const d = z[0]?.length ?? 0;
  const mean = new Float64Array(d);
  for (const row of z) for (let j = 0; j < d; j++) mean[j] += row[j];
  for (let j = 0; j < d; j++) mean[j] /= z.length;
  let s = 0;
  for (const row of z) for (let j = 0; j < d; j++) s += (row[j] - mean[j]) ** 2;
  return s;
}

const sizesOf = (labels, k) => Array.from({ length: k }, (_, c) => labels.filter((l) => l === c).length);

export function analyse(rows, numCols, catCols = [], opts = {}) {
  const { seed = 42, restarts = 25, scaling = "z" } = opts;
  // The silhouette is O(n^2) and this function computes it around twenty
  // times. Past a couple of thousand rows that is several seconds of frozen
  // tab, so score a deterministic subset instead and let callers report that
  // the figure is an estimate.
  const SAMPLE_ABOVE = 1200;
  const sampleSize = rows.length > SAMPLE_ABOVE ? 700 : 0;
  const silOpts = { sampleSize, seed };
  const numRaw = buildMatrix(rows, numCols);
  const scaled = scaling === "minmax" ? minmax(numRaw) : standardize(numRaw);
  const z = scaled.z;
  const cat = catCols.length ? buildCatMatrix(rows, catCols) : rows.map(() => []);
  const n = z.length;
  const kMax = Math.min(8, n - 1);
  const ks = K_RANGE.filter((k) => k <= kMax);

  const table = (labels, k) => centroidTable(rows, numRaw, numCols, catCols, labels, k);

  // ── k-means across the range ──
  const km = {};
  for (const k of ks) {
    const r = kmeans(z, k, { restarts, seed });
    const m = scorePartition(z, r.assign, r.centroids, k, silOpts);
    km[k] = { labels: r.assign, wcss: r.wcss, iterations: r.iterations, metrics: m,
              sizes: sizesOf(r.assign, k), centroids: table(r.assign, k) };
  }

  // ── Ward ──
  let ward = null;
  if (n <= HIER_LIMIT) {
    const { Z: L } = linkage(z, "ward");
    const byK = {};
    for (const k of ks) {
      const labels = cutTree(L, n, k);
      byK[k] = { labels, metrics: scorePartition(z, labels, centroidsFromLabels(z, labels, k), k, silOpts),
                 sizes: sizesOf(labels, k), centroids: table(labels, k) };
    }
    ward = { Z: L, byK, gaps: mergeGaps(L, 8), layout: dendrogramLayout(L, n) };
  }

  // ── DBSCAN with the automatic parameters ──
  const minPts = suggestMinPts(numCols.length);
  const kdist = kDistance(z, minPts);
  const eps = suggestEps(kdist);
  const dbRes = dbscan(z, eps, minPts);
  const dbMetrics = dbRes.nClusters >= 2
    ? scorePartition(z, dbRes.labels, centroidsFromLabels(z, dbRes.labels, dbRes.nClusters), dbRes.nClusters, silOpts)
    : null;

  // ── K-Prototypes, only where there is something categorical to use ──
  let kproto = null;
  if (catCols.length) {
    const gamma = suggestGamma(z);
    kproto = { gamma, byK: {} };
    for (const k of ks) {
      const r = kprototypes(z, cat, k, { gamma, restarts: Math.min(restarts, 8), seed });
      kproto.byK[k] = { labels: r.assign, metrics: scorePartition(z, r.assign, r.numC, k, silOpts),
                        sizes: sizesOf(r.assign, k), centroids: table(r.assign, k) };
    }
  }

  const best = (pick, better) => ks.reduce((b, k) => (better(pick(k), pick(b)) ? k : b), ks[0]);

  return {
    n, ks, z, numRaw, rows, numCols, catCols, seed, restarts, scaling, sampleSize,
    mu: scaled.mu, sigma: scaled.sigma,
    // k=1 has no k-means run of its own (every point is in one cluster, so the
    // WCSS is the total sum of squares); the rest reuse the runs above rather
    // than clustering the same data a second time.
    elbow: [{ k: 1, wcss: totalSS(z) }, ...ks.map((k) => ({ k, wcss: km[k].wcss }))],
    kmeans: km,
    ward,
    kproto,
    dbscan: { ...dbRes, eps, minPts, kdist, metrics: dbMetrics },
    bestK: {
      silhouette: best((k) => km[k].metrics.silhouette, (a, b) => a > b),
      daviesBouldin: best((k) => km[k].metrics.daviesBouldin, (a, b) => a < b),
      calinski: best((k) => km[k].metrics.calinskiHarabasz, (a, b) => a > b),
      wardGap: ward?.gaps?.[0]?.k ?? null,
    },
    ari: (k) => (ward ? adjustedRand(km[k].labels, ward.byK[k].labels) : null),
    ariDbscan: (k) => adjustedRand(km[k].labels, dbRes.labels),
  };
}

/* Curves shaped for the chart components. */
export const silhouetteCurve = (a, src = "kmeans") =>
  a.ks.map((k) => ({ k, silhouette: (src === "ward" ? a.ward.byK : a.kmeans)[k].metrics.silhouette }));

export const dbCurve = (a, src = "kmeans") =>
  a.ks.map((k) => ({ k, daviesBouldin: (src === "ward" ? a.ward.byK : a.kmeans)[k].metrics.daviesBouldin }));

export const chCurve = (a, src = "kmeans") =>
  a.ks.map((k) => ({ k, calinskiHarabasz: (src === "ward" ? a.ward.byK : a.kmeans)[k].metrics.calinskiHarabasz }));
