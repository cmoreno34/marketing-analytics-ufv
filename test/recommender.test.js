/* The recommender labs against the course workbooks.
 *
 * The A4 and B4 numbers below were read from the corrected workbooks after a
 * full Excel recalculation and checked against an independent NumPy gradient
 * descent (TEMA 4 folder, verify_excel.py). The D4 numbers come from the
 * D4 solution workbook (make_d4_excel.py --check). If these pass, the lab,
 * the workbooks and the quiz keys agree. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  TOY, traceCF, trainCF, splitTrainTest, userProfile, cosine, guessColumns, readMatrix, paramCount, countRated, sqDist,
} from "../src/lib/recommender.js";
import { parseCSV } from "../src/lib/parse.js";

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("A4: three updates with the workbook's start match the corrected solution", () => {
  const t = traceCF({ Y: TOY.Y, X: TOY.X, W: TOY.A4.W, b: TOY.A4.b, alpha: 0.2, lambda: 0.1, learnX: false, steps: 3 });
  const [J0, J1, J2] = t.map((s) => s.J);
  near(J0, 4.00455); near(J1, 3.0168202, 1e-6); near(J2, 2.8844, 1e-4);
  const p = t[3].before;
  near(p.b[0], 2.1522479214656, 1e-10);           // Q107
  near(p.W[2][1], 2.816069404816, 1e-10);         // S109 — quiz: w2 Carol iter3 = 2.8
  near(p.b[3], 1.8140, 1e-4);                     // Dave, wrong (0.8809) before the fix
  near(t[3].P[2][0], 4.8988, 1e-4);               // I122 — quiz: Alice / cute puppies = 4.9
});

test("B4: three updates learning x match the corrected solution and the new key", () => {
  const t = traceCF({ Y: TOY.Y, X: TOY.B4.X, W: TOY.B4.W, b: TOY.B4.b, alpha: 0.02, lambda: 0.1, learnX: true, steps: 3 });
  near(t[0].J, 19.97, 1e-9);
  const p = t[3].before;
  near(p.X[0][0], 1.0157, 1e-4);                  // V144 — quiz key (was 1.0226 with the bugs)
  near(p.W[0][0], 5.0173, 1e-4);                  // Q145
  near(t[3].P[2][0], 3.8192, 1e-4);               // I163
  near(p.b[1], -0.0408, 1e-4);                    // Bob's bias, which used Alice's errors before
  assert.equal(paramCount(5, 4, 2, true), 22);    // quiz: parameters to learn
});

test("trainCF with start = workbook values equals the trace", () => {
  const r = trainCF({ Y: TOY.Y, Xknown: TOY.X, alpha: 0.2, lambda: 0.1, iters: 3, start: { X: TOY.X, W: TOY.A4.W, b: TOY.A4.b } });
  near(r.W[2][1], 2.816069404816, 1e-10);
});

test("the same seed gives the same split", () => {
  const Y = Array.from({ length: 20 }, (_, i) => Array.from({ length: 5 }, (_, j) => ((i + j) % 3 ? (i * j) % 5 : null)));
  const a = splitTrainTest(Y, 80, 7), b = splitTrainTest(Y, 80, 7), c = splitTrainTest(Y, 80, 8);
  assert.deepEqual(a.test, b.test);
  assert.notDeepEqual(a.test, c.test);
  assert.equal(countRated(a.train) + countRated(a.test), countRated(Y));
});

test("divergence is detected (α too large on features from 0 to 5)", () => {
  const { headers, rows } = parseCSV(fs.readFileSync(new URL("../public/data/rec_large.csv", import.meta.url), "utf8"));
  const d = readMatrix(rows, guessColumns(headers, rows));
  assert.deepEqual(d.features, ["romance", "action"]);
  const { train } = splitTrainTest(d.Y, 80, 1);
  assert.equal(trainCF({ Y: train, Xknown: d.X, alpha: 0.02, iters: 500 }).diverged, true);
  assert.equal(trainCF({ Y: train, Xknown: d.X, alpha: 0.001, iters: 500 }).diverged, false);
});

test("D4: profile, cosine and squared distance match the workbook", () => {
  const { headers, rows } = parseCSV(fs.readFileSync(new URL("../public/data/rec_cb_exercise.csv", import.meta.url), "utf8"));
  const d = readMatrix(rows, guessColumns(headers, rows));
  assert.deepEqual(d.features, ["Romance", "Action", "Comedy", "Animation"]);
  const p = userProfile(d.Y, d.X, 0);
  near(p.mean, 3.25); near(p.wsum, 5);
  [0.415, -0.435, 0.07, 0].forEach((v, q) => near(p.profile[q], v, 1e-12));
  near(cosine(p.profile, d.X[6]), 0.6822433510993564, 1e-12);   // C32: A Quiet Promise, the recommendation
  near(cosine(d.X[0], d.X[4]), 0.5857122361103717, 1e-12);      // B38: Highway Hearts
  near(sqDist([0.3, -0.2, 0.6], [1.1, -0.3, 0.2]), 0.81, 1e-12); // F50: Laugh Track
});
