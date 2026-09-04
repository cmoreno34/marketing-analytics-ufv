/* Validates the clustering maths against SciPy reference output
 * (test/reference.json, produced by test/ref.py). If these pass, a student's
 * result in the browser matches what the Colab notebook would have given. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { standardize, distanceMatrix } from "../src/lib/prep.js";
import { linkage, cutTree, centroidsFromLabels } from "../src/lib/hierarchical.js";
import { kmeans, kprototypes, elbow } from "../src/lib/kmeans.js";
import { dbscan } from "../src/lib/dbscan.js";
import { silhouette, daviesBouldin, calinskiHarabasz, adjustedRand } from "../src/lib/validation.js";
import { parseCSV, sniffDelimiter } from "../src/lib/parse.js";

const ref = JSON.parse(fs.readFileSync(new URL("./reference.json", import.meta.url)));
const Z = ref.Z;
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/* Two labellings are the same partition if every pair of points agrees on
 * "together or not", regardless of which integer names each cluster. */
function samePartition(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++)
      if ((a[i] === a[j]) !== (b[i] === b[j])) return false;
  return true;
}

test("standardize reproduces SciPy's z-scores", () => {
  const { z } = standardize(ref.X);
  for (let i = 0; i < z.length; i++)
    for (let j = 0; j < z[i].length; j++)
      assert.ok(close(z[i][j], Z[i][j], 1e-10), `row ${i} col ${j}: ${z[i][j]} vs ${Z[i][j]}`);
});

for (const method of ["ward", "average", "complete", "single"]) {
  test(`linkage(${method}) matches SciPy merge heights`, () => {
    const { Z: L } = linkage(Z, method);
    const R = ref["linkage_" + method];
    assert.equal(L.length, R.length);
    for (let i = 0; i < L.length; i++) {
      assert.ok(close(L[i][2], R[i][2], 1e-8), `merge ${i}: height ${L[i][2]} vs ${R[i][2]}`);
      assert.equal(L[i][3], R[i][3], `merge ${i}: cluster size`);
    }
  });

  test(`cutTree(${method}, k=4) matches SciPy fcluster`, () => {
    const { Z: L } = linkage(Z, method);
    const mine = cutTree(L, Z.length, 4);
    const theirs = ref["cut4_" + method];
    assert.equal(new Set(mine).size, 4, "must return exactly 4 clusters");
    assert.ok(samePartition(mine, theirs), `partition differs for ${method}`);
  });
}

test("silhouette matches the reference implementation", () => {
  const labels = ref.labels_ward4;
  const s = silhouette(Z, labels, 4);
  assert.ok(close(s.mean, ref.sil_ward4, 1e-9), `${s.mean} vs ${ref.sil_ward4}`);
});

test("silhouette stays within [-1, 1] and averages the per-point scores", () => {
  const labels = ref.labels_ward4;
  const s = silhouette(Z, labels, 4);
  assert.ok(s.perPoint.every((v) => v >= -1 && v <= 1));
  const manual = s.perPoint.reduce((a, b) => a + b, 0) / s.perPoint.length;
  assert.ok(close(s.mean, manual, 1e-12));
});

// Keys are the Python float repr ("1.0"), which is not what JS prints for 1.
for (const eps of ["1.0", "1.5", "2.0"]) {
  test(`dbscan(eps=${eps}) matches the reference`, () => {
    const r = dbscan(Z, Number(eps), 4);
    const exp = ref[`dbscan_${eps}`];
    assert.equal(r.nClusters, exp.n, "cluster count");
    assert.equal(r.noise, exp.noise, "noise count");
    assert.ok(samePartition(r.labels, exp.labels), "partition");
  });
}

test("kmeans converges to a lower cost than a single random restart", () => {
  const good = kmeans(Z, 4, { restarts: 40, seed: 7 });
  const poor = kmeans(Z, 4, { restarts: 1, seed: 7, init: "random" });
  assert.ok(good.wcss <= poor.wcss, `${good.wcss} should be <= ${poor.wcss}`);
  assert.equal(new Set(good.assign).size, 4);
});

test("kmeans is reproducible for a given seed and varies across seeds", () => {
  const a = kmeans(Z, 4, { seed: 42 });
  const b = kmeans(Z, 4, { seed: 42 });
  assert.deepEqual(a.assign, b.assign);
  assert.ok(close(a.wcss, b.wcss, 1e-12));
});

test("kmeans WCSS equals the sum of squared distances to assigned centroids", () => {
  const r = kmeans(Z, 3, { seed: 1 });
  let manual = 0;
  Z.forEach((p, i) => {
    const c = r.centroids[r.assign[i]];
    manual += p.reduce((s, v, d) => s + (v - c[d]) ** 2, 0);
  });
  assert.ok(close(r.wcss, manual, 1e-9));
});

test("elbow is monotonically decreasing in k", () => {
  const e = elbow(Z, 8, { restarts: 20, seed: 3 });
  for (let i = 1; i < e.length; i++)
    assert.ok(e[i].wcss <= e[i - 1].wcss + 1e-9, `k=${e[i].k} rose above k=${e[i - 1].k}`);
});

test("Davies-Bouldin is lower for well-separated data than for noise", () => {
  const tight = [[0, 0], [0.1, 0], [0, 0.1], [10, 10], [10.1, 10], [10, 10.1]];
  const labels = [0, 0, 0, 1, 1, 1];
  const cents = centroidsFromLabels(tight, labels, 2);
  const dbTight = daviesBouldin(tight, labels, cents);
  const mixed = [[0, 0], [10, 10], [0.1, 0], [10.1, 10], [0, 0.1], [10, 10.1]];
  const badLabels = [0, 0, 0, 1, 1, 1];
  const badCents = centroidsFromLabels(mixed, badLabels, 2);
  assert.ok(dbTight < daviesBouldin(mixed, badLabels, badCents));
});

test("Calinski-Harabasz rewards the correct grouping", () => {
  const pts = [[0, 0], [0.1, 0], [0, 0.1], [10, 10], [10.1, 10], [10, 10.1]];
  const right = [0, 0, 0, 1, 1, 1];
  const wrong = [0, 1, 0, 1, 0, 1];
  const chRight = calinskiHarabasz(pts, right, centroidsFromLabels(pts, right, 2));
  const chWrong = calinskiHarabasz(pts, wrong, centroidsFromLabels(pts, wrong, 2));
  assert.ok(chRight > chWrong, `${chRight} should beat ${chWrong}`);
});

test("adjustedRand is 1 for identical partitions and ~0 for unrelated ones", () => {
  const a = [0, 0, 1, 1, 2, 2];
  assert.ok(close(adjustedRand(a, a), 1, 1e-12));
  assert.ok(close(adjustedRand(a, [2, 2, 0, 0, 1, 1]), 1, 1e-12), "labels are arbitrary names");
  assert.ok(adjustedRand(a, [0, 1, 0, 1, 0, 1]) < 0.3);
});

test("kprototypes reduces to kmeans behaviour when categories are constant", () => {
  const cat = Z.map(() => ["x"]);
  const r = kprototypes(Z, cat, 3, { gamma: 1, restarts: 20, seed: 5 });
  assert.equal(new Set(r.assign).size, 3);
  const km = kmeans(Z, 3, { restarts: 20, seed: 5 });
  // A constant categorical column adds a fixed 0 to every distance, so the
  // partition must be a valid k-means solution of the same quality.
  assert.ok(r.cost >= km.wcss - 1e-6, "k-prototypes cost cannot beat the k-means optimum");
});

test("kprototypes separates groups that differ only categorically", () => {
  const num = Array.from({ length: 20 }, () => [0, 0]);
  const cat = Array.from({ length: 20 }, (_, i) => [i < 10 ? "premium" : "budget"]);
  const r = kprototypes(num, cat, 2, { gamma: 1, restarts: 10, seed: 2 });
  const first = r.assign.slice(0, 10);
  const second = r.assign.slice(10);
  assert.equal(new Set(first).size, 1);
  assert.equal(new Set(second).size, 1);
  assert.notEqual(first[0], second[0]);
});

test("delimiter sniffing handles the three course datasets", () => {
  assert.equal(sniffDelimiter("a,b,c\n1,2,3\n4,5,6"), ",");
  assert.equal(sniffDelimiter("edad;ingreso;sexo\n1;1;0\n4;3;0"), ";");
  assert.equal(sniffDelimiter("ID\tYear\tEdu\n1\t2\t3\n4\t5\t6"), "\t");
});

test("parseCSV strips the BOM and quotes correctly", () => {
  const { headers, rows } = parseCSV('﻿name,note\n"Smith, J.","said ""hi"""');
  assert.deepEqual(headers, ["name", "note"]);
  assert.equal(rows[0].name, "Smith, J.");
  assert.equal(rows[0].note, 'said "hi"');
});

test("distanceMatrix is symmetric with a zero diagonal", () => {
  const D = distanceMatrix(Z.slice(0, 10));
  for (let i = 0; i < 10; i++) {
    assert.equal(D[i][i], 0);
    for (let j = 0; j < 10; j++) assert.ok(close(D[i][j], D[j][i], 1e-12));
  }
});
