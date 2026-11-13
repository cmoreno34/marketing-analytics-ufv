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

/* Two towers by hand (D4 v1.1, sheets "two towers by hand" and "two towers
 * simulation"). Cell values read from the solution workbook after a full
 * recalculation; J at iterations 10, 100 and 300 from an independent NumPy run. */
import { TT, runTT, iterateTT, retrievalTT } from "../src/lib/twoTowersHand.js";

test("two towers by hand: ITER0 is B4, step 1 and step 2 match the workbook", () => {
  const { f, g, next } = iterateTT(TT.start, { alpha: 0.005, lambda: 0.1 });
  near(f.J, 14.6, 1e-12); near(f.reg, 5.57, 1e-12); near(f.Jreg, 20.17, 1e-12);   // I62, B58, I63
  near(f.P[0][0], 4.2, 1e-12);                                                       // I39
  near(f.E[0][0], -0.8, 1e-12); near(g.db[0], 2, 1e-12);                             // I46, I51
  [-0.56, 0.24, 2.56, 2.92].forEach((v, j) => near(g.dU[j][0], v, 1e-12));           // Q40:T40
  [2.56, 2.76, -0.56, 0.88].forEach((v, j) => near(g.dU[j][1], v, 1e-12));           // W40:Z40
  near(g.dM[0][0], -4.4, 1e-12); near(g.dM[0][1], 16.4, 1e-12);                      // AG35, AN35
  [[3.98, 27.08], [26.92, 7.02]].forEach((r, k) => r.forEach((v, l) => near(g.dV[k][l], v, 1e-12)));  // Q50:R51
  [[3.98, 26.92], [27.08, 7.02]].forEach((r, k) => r.forEach((v, l) => near(g.dQ[k][l], v, 1e-12)));  // simulation EF28:EI28
  near(g.difM[0][0][0], -0.64, 1e-12); near(g.difU[0][0][0], -4, 1e-12);                 // Q35, AC35
  near(g.dW[0][0], -0.06, 1e-12); near(g.dW[3][1], 1.38, 1e-12);                        // Q55, T56
  near(g.db[3], 3.8, 1e-12); near(g.dX[0][0], -4.32, 1e-12); near(g.dX[4][1], -0.32, 1e-12);       // T54 (∂J/∂b dave), W54, X58
  [-0.01, -0.015, -0.01, -0.019].forEach((v, j) => near(next.b[j], v, 1e-12));      // Q63:T63
  near(next.W[0][0], 5.0003, 1e-12); near(next.W[0][1], 0.9867, 1e-12); near(next.W[3][1], 4.9931, 1e-12);  // T65
  near(next.X[0][0], 0.8216, 1e-12); near(next.X[0][1], 0.1179, 1e-12);             // V63:W63
  [[0.9801, -0.1354], [-0.1346, 0.9649]].forEach((r, k) => r.forEach((v, l) => near(next.V[k][l], v, 1e-12)));  // AB63:AC64
  [[0.9801, -0.1346], [-0.1354, 0.9649]].forEach((r, k) => r.forEach((v, l) => near(next.Q[k][l], v, 1e-12)));  // AF63:AG64
});

test("two towers by hand: the cost curve matches the workbook and NumPy", () => {
  const { history, params, diverged } = runTT({ iters: 300 });
  assert.equal(diverged, false);
  assert.equal(history.length, 301);
  near(history[1].J, 5.0881767612368956, 1e-10); near(history[1].Jreg, 10.636174725736897, 1e-10);  // I108, I109
  near(history[2].J, 1.1862853616442026, 1e-10); near(history[2].Jreg, 6.784676040491885, 1e-10);    // I154, I155
  near(params[2].b[0], 0.0006134292435111474, 1e-12); near(params[2].W[0][0], 5.007765974331156, 1e-12);  // Q109, Q110
  near(history[3].J, 0.5056, 1e-4); near(history[3].Jreg, 6.1166, 1e-4);
  near(history[10].J, 0.2091, 1e-4); near(history[10].Jreg, 5.7957, 1e-4);
  near(history[100].J, 0.0382, 1e-4); near(history[100].Jreg, 5.1985, 1e-4);
  near(history[300].J, 0.0014, 1e-4); near(history[300].Jreg, 4.3514, 1e-4);
  near(params[300].W[0][0], 4.343025829089769, 1e-9);                                 // simulation F328
  near(params[300].b[2], 0.20387861051463538, 1e-9);                                  // simulation D328
});

test("two towers by hand: B4's α = 0.02 overshoots (J 14.6 → 54.6)", () => {
  const { history } = runTT({ alpha: 0.02, iters: 1 });
  near(history[1].J, 54.6, 0.05);
});

test("two towers by hand: retrieval after three updates matches rows 164-199", () => {
  const r = retrievalTT(runTT({ iters: 3 }).params[3]);
  near(r.M[0][0], 0.9468806326299783, 1e-10); near(r.normM[0], 0.9482402023823361, 1e-10);  // I167, K167
  near(r.U[0][0], 5.20335000501423, 1e-10); near(r.normU[3], 5.091514259864308, 1e-10);     // I174, L176
  near(r.S[0][0], 4.913166157020297, 1e-10); near(r.S[4][3], 4.474749870041651, 1e-10);     // I179, L183
  near(r.S[2][3], 0.2318, 1e-4);
  assert.equal(r.rank[0][0], "seen"); assert.equal(r.rank[4][3], 1);                         // I186, L190
  assert.deepEqual(r.top.map((t) => TT.items[t.i]), ["cute puppies", "romance forever", "romance forever", "swords"]);  // I191:L191
  near(r.top[0].pred, 4.310499277299161, 1e-10); near(r.top[3].pred, 4.4512029026367665, 1e-10);  // I192, L192
  near(r.cos[0][0], 0.9944187950955731, 1e-10); near(r.cos[4][3], 0.9963856191954416, 1e-10);     // I195, L199
});
