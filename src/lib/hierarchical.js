/* Agglomerative hierarchical clustering.
 *
 * Produces a linkage matrix in the same layout SciPy uses — [a, b, distance,
 * size], one row per merge, cluster ids n..2n-2 for merged nodes — so the
 * table the technical note walks through row by row is literally this output,
 * and anything students read about scipy.cluster.hierarchy transfers.
 *
 * The merge loop is nearest-neighbour chain (Murtagh), O(n²) rather than the
 * textbook O(n³) scan-for-the-minimum. That is what makes the 2 240-row
 * marketing_campaign.csv finish in the browser instead of hanging the tab. */

import { distanceMatrix } from "./prep.js";

const LANCE_WILLIAMS = {
  /* Ward works on SQUARED distances; the merge height reported at the end is
   * the square root, which is the scale SciPy plots and the note describes. */
  ward: (dik, djk, dij, ni, nj, nk) =>
    ((ni + nk) * dik + (nj + nk) * djk - nk * dij) / (ni + nj + nk),
  average: (dik, djk, _dij, ni, nj) => (ni * dik + nj * djk) / (ni + nj),
  complete: (dik, djk) => Math.max(dik, djk),
  single: (dik, djk) => Math.min(dik, djk),
};

/* Assigns the final n..2n-2 cluster ids. Only ever queried with ORIGINAL
 * observation indices; find() then walks up through whatever labels earlier
 * merges created. Keeping the chain's own bookkeeping out of this index space
 * is what makes that safe — see the note in linkage(). */
class UnionFind {
  constructor(n) { this.parent = new Int32Array(2 * n - 1).fill(-1); this.next = n; }
  find(x) {
    let root = x;
    while (this.parent[root] !== -1) root = this.parent[root];
    while (this.parent[x] !== -1) { const p = this.parent[x]; this.parent[x] = root; x = p; }
    return root;
  }
  union(a, b) { const id = this.next++; this.parent[a] = id; this.parent[b] = id; return id; }
}

/* @param points  n x d numeric matrix (already standardised), or
 * @param opts.precomputed  an n x n distance matrix (used for Gower on mixed data)
 * @returns { Z, order } — Z is the linkage matrix, order the leaf order for drawing */
export function linkage(points, method = "ward", opts = {}) {
  const D0 = opts.precomputed ?? distanceMatrix(points);
  const n = D0.length;
  if (n < 2) return { Z: [], order: [0].slice(0, n) };

  const squared = method === "ward";
  /* Working copy, n x n. Cluster slots stay inside [0, n) for the whole chain:
   * a merge folds one cluster into the other's slot and retires the loser,
   * rather than allocating a fresh n+i id. That matters because the relabelling
   * pass below also hands out ids from n upwards — letting the chain use them
   * too would make find() follow a parent pointer that belongs to a different
   * cluster, and the tree would silently lose leaves. */
  const D = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const v = squared ? D0[i][j] * D0[i][j] : D0[i][j];
      D[i][j] = v;
      D[j][i] = v;
    }

  const size = new Int32Array(n).fill(1);
  const active = new Set(Array.from({ length: n }, (_, i) => i));
  const update = LANCE_WILLIAMS[method] ?? LANCE_WILLIAMS.ward;
  const merges = [];
  const chain = [];

  while (active.size > 1) {
    if (!chain.length) chain.push(active.values().next().value);
    const a = chain[chain.length - 1];

    // Nearest neighbour of a among active clusters; ties broken by lowest id
    // so the same data always yields the same dendrogram.
    let b = -1;
    let bd = Infinity;
    for (const c of active) {
      if (c === a) continue;
      const d = D[a][c];
      if (d < bd || (d === bd && c < b)) { bd = d; b = c; }
    }

    if (chain.length >= 2 && b === chain[chain.length - 2]) {
      // a and b are reciprocal nearest neighbours -> merge them.
      chain.pop();
      chain.pop();
      const na = size[a];
      const nb = size[b];
      merges.push({ a, b, d: bd, size: na + nb });
      // Keep b, retire a. b's row is rewritten by Lance-Williams.
      active.delete(a);
      for (const c of active) {
        if (c === b) continue;
        const nd = update(D[a][c], D[b][c], bd, na, nb, size[c]);
        D[b][c] = nd;
        D[c][b] = nd;
      }
      size[b] = na + nb;
    } else {
      chain.push(b);
    }
  }

  /* NN-chain emits merges in an order that is valid but not sorted by height,
   * while a linkage matrix is defined to be sorted. Sort, then relabel through
   * a union-find so each row refers to the ids the earlier rows created. */
  merges.sort((x, y) => x.d - y.d);
  const uf = new UnionFind(n);
  const Z = merges.map((m) => {
    const x = uf.find(m.a);
    const y = uf.find(m.b);
    uf.union(x, y);
    const dist = squared ? Math.sqrt(m.d) : m.d;
    return [Math.min(x, y), Math.max(x, y), dist, m.size];
  });

  return { Z, order: leafOrder(Z, n) };
}

/* Depth-first leaf order — the left-to-right sequence the dendrogram draws,
 * chosen so branches never cross. */
export function leafOrder(Z, n) {
  const out = [];
  const walk = (node) => {
    if (node < n) { out.push(node); return; }
    const row = Z[node - n];
    walk(row[0]);
    walk(row[1]);
  };
  if (Z.length) walk(2 * n - 2); else for (let i = 0; i < n; i++) out.push(i);
  return out;
}

/* Cut the tree into exactly k clusters: undo the last k-1 merges. */
export function cutTree(Z, n, k) {
  const labels = new Int32Array(n).fill(-1);
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  const roots = [2 * n - 2];
  // Split the highest merges first until k subtrees remain.
  while (roots.length < k) {
    let bestIdx = 0;
    let bestH = -Infinity;
    roots.forEach((r, i) => {
      if (r >= n && Z[r - n][2] > bestH) { bestH = Z[r - n][2]; bestIdx = i; }
    });
    const node = roots.splice(bestIdx, 1)[0];
    if (node < n) { roots.push(node); break; }
    roots.push(Z[node - n][0], Z[node - n][1]);
  }
  const collect = (node, label) => {
    if (node < n) { labels[node] = label; return; }
    collect(Z[node - n][0], label);
    collect(Z[node - n][1], label);
  };
  roots.forEach((r, i) => collect(r, i));
  return Array.from(labels);
}

/* The merge heights, largest gap first. This is the "biggest jump" the note
 * tells students to look for, computed instead of eyeballed. */
export function mergeGaps(Z, top = 10) {
  const heights = Z.map((r) => r[2]);
  const gaps = [];
  for (let i = heights.length - 1; i >= 1 && gaps.length < top; i--) {
    gaps.push({
      k: heights.length - i + 1,
      from: heights[i - 1],
      to: heights[i],
      gap: heights[i] - heights[i - 1],
    });
  }
  return gaps.sort((a, b) => b.gap - a.gap);
}

/* Cluster centroids in original units, for the persona table. */
export function centroidsFromLabels(matrix, labels, k) {
  const dim = matrix[0]?.length ?? 0;
  const sums = Array.from({ length: k }, () => new Float64Array(dim));
  const counts = new Int32Array(k);
  matrix.forEach((row, i) => {
    const a = labels[i];
    if (a < 0) return;
    for (let d = 0; d < dim; d++) sums[a][d] += row[d];
    counts[a]++;
  });
  return Array.from({ length: k }, (_, j) =>
    counts[j] ? Array.from(sums[j], (x) => x / counts[j]) : new Array(dim).fill(0)
  );
}

/* Dendrogram geometry: one entry per merge with the coordinates of the
 * ⊓ shape, in leaf-index / distance space. The canvas just scales these. */
export function dendrogramLayout(Z, n) {
  const order = leafOrder(Z, n);
  const pos = new Float64Array(2 * n - 1);
  order.forEach((leaf, i) => { pos[leaf] = i; });
  const links = Z.map((row, i) => {
    const [a, b, h] = row;
    const xa = pos[a];
    const xb = pos[b];
    pos[n + i] = (xa + xb) / 2;
    return {
      xa, xb, h,
      ha: a < n ? 0 : Z[a - n][2],
      hb: b < n ? 0 : Z[b - n][2],
      left: a, right: b,
    };
  });
  return { order, links, maxH: Z.length ? Z[Z.length - 1][2] : 1 };
}
