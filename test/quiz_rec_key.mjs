/* Answer keys of the module 10 quizzes (A4, B4, D4), computed with the
 * labs' own code and the data the links load. Run: node test/quiz_rec_key.mjs
 * The TEMA 4 folder's make_quizzes.py copies these numbers; if a lab default
 * or a dataset changes, re-run this and that. */

import fs from "node:fs";
import { parseCSV } from "../src/lib/parse.js";
import * as R from "../src/lib/recommender.js";

const load = (f) => {
  const { headers, rows } = parseCSV(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), "utf8"));
  return R.readMatrix(rows, R.guessColumns(headers, rows));
};
const out = {};

// ── A4: features known ──
const tA = R.traceCF({ Y: R.TOY.Y, X: R.TOY.X, W: R.TOY.A4.W, b: R.TOY.A4.b, alpha: 0.2, lambda: 0.1, learnX: false, steps: 3 });
out.A4_alice_puppies = tA[3].P[2][0];
out.A4_w2_carol_iter3 = tA[3].before.W[2][1];
// α = 1 on the toy data with the workbook's start, 3 and 50 iterations.
out.A4_alpha1_J = R.traceCF({ Y: R.TOY.Y, X: R.TOY.X, W: R.TOY.A4.W, b: R.TOY.A4.b, alpha: 1, lambda: 0.1, learnX: false, steps: 3 }).map((s) => s.J);
out.A4_alpha1_diverged = R.trainCF({ Y: R.TOY.Y, Xknown: R.TOY.X, alpha: 1, lambda: 0.1, iters: 50, start: { X: R.TOY.X, W: R.TOY.A4.W, b: R.TOY.A4.b } }).diverged;
const large = load("rec_large.csv");
{
  const { train, test } = R.splitTrainTest(large.Y, 80, 1);
  out.A4_large_a0005_diverged = R.trainCF({ Y: train, Xknown: large.X, alpha: 0.005, lambda: 0.1, iters: 3000, seed: 1, test }).diverged;
  const ok = R.trainCF({ Y: train, Xknown: large.X, alpha: 0.001, lambda: 0.1, iters: 3000, seed: 1, test });
  out.A4_large_a0001 = { train: ok.trainRMSE, test: ok.testRMSE, params: ok.nParams, diverged: ok.diverged };
  out.A4_large_baselines = R.baselines(train, test).map((b) => [b.name, b.rmse]);
}

// ── B4: features learned ──
const tB = R.traceCF({ Y: R.TOY.Y, X: R.TOY.B4.X, W: R.TOY.B4.W, b: R.TOY.B4.b, alpha: 0.02, lambda: 0.1, learnX: true, steps: 3 });
out.B4_params = R.paramCount(5, 4, 2, true);
out.B4_x1_love_iter3 = tB[3].before.X[0][0];
out.B4_w1_alice_iter3 = tB[3].before.W[0][0];
out.B4_alice_puppies = tB[3].P[2][0];

// ── C4: the case, default settings (compare, seed 1) ──
const cas = load("rec_case.csv");
{
  const { train, test } = R.splitTrainTest(cas.Y, 80, 1);
  const kn = R.trainCF({ Y: train, Xknown: cas.X, alpha: 0.005, lambda: 0.1, iters: 2000, seed: 1, test });
  const le = R.trainCF({ Y: train, k: 2, alpha: 0.005, lambda: 0.1, iters: 2000, seed: 1, test });
  out.C4_default = { known: [kn.trainRMSE, kn.testRMSE, kn.nParams], learned: [le.trainRMSE, le.testRMSE, le.nParams] };
  out.C4_lambda_sweep = [0.01, 0.1, 1, 5, 10, 20].map((l) => {
    const r = R.trainCF({ Y: train, k: 10, alpha: 0.005, lambda: l, iters: 2000, seed: 1, test });
    return [l, r.diverged ? "div" : +r.trainRMSE.toFixed(3), r.diverged ? "div" : +r.testRMSE.toFixed(3)];
  });
  out.C4_k_sweep = [2, 5, 10, 15].map((k) => {
    const r = R.trainCF({ Y: train, k, alpha: 0.005, lambda: 1, iters: 2000, seed: 1, test });
    return [k, r.diverged ? "div" : +r.trainRMSE.toFixed(3), r.diverged ? "div" : +r.testRMSE.toFixed(3)];
  });
  out.C4_baselines = R.baselines(train, test).map((b) => [b.name, +b.rmse.toFixed(3)]);
}

// ── D4: content-based ──
const ex = load("rec_cb_exercise.csv");
const p = R.userProfile(ex.Y, ex.X, 0);
out.D4_mean = p.mean;
out.D4_profile = p.profile;
out.D4_cos = ex.items.map((it, i) => [it, R.cosine(p.profile, ex.X[i])]);
const cat = load("streaming_catalogue.csv");
{
  const pa = R.userProfile(cat.Y, cat.X, 0).profile;
  out.D4_cat_alice_profile = cat.features.map((f, q) => [f, +pa[q].toFixed(4)]);
  out.D4_cat_alice_top = cat.items.map((it, i) => [it, R.cosine(pa, cat.X[i]), cat.Y[i][0]]).filter((x) => x[2] === null).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const { train, test } = R.splitTrainTest(cat.Y, 80, 1);
  out.D4_p3 = [R.precisionAtN(R.contentScores(train, cat.X), train, test, 3, 4), R.precisionAtN(R.popularityScores(train), train, test, 3, 4)];
  const tw = R.trainTwoTower({ train, X: cat.X, test, k: 4, hidden: 0, alpha: 0.01, lambda: 0.01, epochs: 300, seed: 1 });
  out.D4_towers = { train: tw.trainRMSE, test: tw.testRMSE, base: R.baselines(train, test).map((b) => b.rmse) };
  const mf = cat.items.indexOf("Midnight Ferry");
  out.D4_similar_midnight = R.similarItems(cat.X, mf, 3).map((s) => [cat.items[s.i], s.value]);
}
console.log(JSON.stringify(out, null, 1));
