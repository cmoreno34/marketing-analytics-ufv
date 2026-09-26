/* Validates the elasticity maths against statsmodels (test/elasticity_reference.json,
 * produced by test/ref_elasticity.py). If these pass, an elasticity, its
 * standard error, the per-segment elasticities and the "do they differ" test
 * in the browser are what a Python regression would have printed. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  fitElasticity, optimalPrice, aggregateOffers, priceGrid, simulateSales, simulateOffers,
  tQuantile, COLAB_PAIRS, COLAB_RAIN, LN_P,
} from "../src/lib/elasticity.js";
import { parseCSV } from "../src/lib/parse.js";

const ref = JSON.parse(fs.readFileSync(new URL("./elasticity_reference.json", import.meta.url)));
const close = (a, b, tol = 1e-8) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// statsmodels' formula names → the lab's column names.
const rename = (s) => s
  .replace(/^Intercept$/, "const")
  .replace(/^lp:C\((\w+)\)\[T\.(.+)\]$/, `${LN_P} × $1=$2`)
  .replace(/^C\((\w+)\)\[T\.(.+)\]$/, "$1=$2")
  .replace(/^lp$/, LN_P)
  .replace(/^lt$/, "ln(temp)");

const pairs = COLAB_PAIRS.map(([price, units], i) => ({ price, units, rain: String(COLAB_RAIN[i]) }));

test("univariate Colab pairs: elasticity, SE, p and R² match statsmodels", () => {
  const f = fitElasticity(pairs, { price: "price", qty: "units" });
  const m = f.model;
  for (let i = 0; i < 2; i++) {
    assert.ok(close(m.beta[i], ref.pairs.beta[i]), `beta ${i}: ${m.beta[i]} vs ${ref.pairs.beta[i]}`);
    assert.ok(close(m.se[i], ref.pairs.se[i]), `se ${i}`);
    assert.ok(close(m.p[i], ref.pairs.p[i], 1e-6), `p ${i}: ${m.p[i]} vs ${ref.pairs.p[i]}`);
  }
  assert.ok(close(m.r2, ref.pairs.r2));
  assert.ok(close(f.bySegment[0].eps, ref.pairs.beta[1]));
});

test("optimal price is c·ε/(1+ε), and undefined when demand is inelastic", () => {
  const eps = ref.pairs.beta[1];
  assert.ok(close(optimalPrice(eps, 1.8), (1.8 * eps) / (1 + eps)));
  assert.equal(optimalPrice(-0.9, 1.8), null);
  assert.equal(optimalPrice(-1, 1.8), null);
});

test("rain model with interaction matches statsmodels, coefficient by coefficient", () => {
  const f = fitElasticity(pairs, { price: "price", qty: "units", segment: "rain" });
  const R = ref.rain.full;
  R.names.forEach((nm, i) => {
    const j = f.names.indexOf(rename(nm));
    assert.ok(j >= 0, `missing column ${rename(nm)} (have ${f.names.join(", ")})`);
    assert.ok(close(f.model.beta[j], R.beta[i]), `${nm}: ${f.model.beta[j]} vs ${R.beta[i]}`);
    assert.ok(close(f.model.se[j], R.se[i]), `${nm} se`);
    assert.ok(close(f.model.p[j], R.p[i], 1e-6), `${nm} p: ${f.model.p[j]} vs ${R.p[i]}`);
  });
  assert.ok(close(f.model.adjR2, R.adjR2));
  const wet = f.bySegment.find((s) => s.level === "1");
  assert.ok(close(wet.eps, ref.rain.eps_rain));
  assert.ok(close(wet.se, ref.rain.se_rain));
  assert.ok(close(f.slopeTest.F, ref.rain.slopeF), `F ${f.slopeTest.F} vs ${ref.rain.slopeF}`);
  assert.ok(close(f.slopeTest.p, ref.rain.slopeP, 1e-6), `F p ${f.slopeTest.p} vs ${ref.rain.slopeP}`);
});

test("the Colab's two separate regressions give the same slopes as the interaction model", () => {
  const f = fitElasticity(pairs, { price: "price", qty: "units", segment: "rain" });
  for (const s of f.separate) {
    assert.ok(close(s.eps, ref.rain.separate[s.level]), `separate ${s.level}`);
    const joint = f.bySegment.find((b) => b.level === s.level);
    assert.ok(close(s.eps, joint.eps), `level ${s.level}: separate ${s.eps} vs joint ${joint.eps}`);
  }
});

test("synthetic set: segment, shifter and log covariate all match statsmodels", () => {
  const { rows } = parseCSV(fs.readFileSync(new URL("./elasticity_synth.csv", import.meta.url), "utf8"));
  const f = fitElasticity(rows, {
    price: "price", qty: "units", segment: "channel", shifters: ["day"], nums: [{ col: "temp", log: true }],
  });
  const S = ref.synth;
  assert.equal(f.model.df, S.df);
  S.names.forEach((nm, i) => {
    const j = f.names.indexOf(rename(nm));
    assert.ok(j >= 0, `missing column ${rename(nm)}`);
    assert.ok(close(f.model.beta[j], S.beta[i]), `${nm}: ${f.model.beta[j]} vs ${S.beta[i]}`);
    assert.ok(close(f.model.se[j], S.se[i]), `${nm} se`);
  });
  for (const [lv, [eps, se]] of Object.entries(S.eps)) {
    const b = f.bySegment.find((s) => s.level === lv);
    assert.ok(close(b.eps, eps), `eps ${lv}`);
    assert.ok(close(b.se, se), `se ${lv}`);
  }
  const kiosk = f.bySegment.find((s) => s.level === "kiosk");
  assert.ok(close(kiosk.lo, S.ci_kiosk[0], 1e-7) && close(kiosk.hi, S.ci_kiosk[1], 1e-7), "95% CI");
  assert.ok(close(f.slopeTest.F, S.slopeF));
});

test("t quantile", () => {
  assert.ok(Math.abs(tQuantile(0.975, 10) - 2.228138852) < 1e-6);
  assert.ok(Math.abs(tQuantile(0.975, 1000) - 1.962339) < 1e-5);
});

test("simulated sales recover the elasticities they were built with", () => {
  const rows = simulateSales({
    n: 3000, pMin: 1, pMax: 3, pRef: 2, qRef: 200, noise: 0.1,
    segment: { name: "weather", levels: [{ name: "sun", eps: -2.5, shift: 1, share: 1 }, { name: "rain", eps: -1.3, shift: 0.8, share: 1 }] },
    nums: [{ name: "temp", min: 5, max: 30, eff: 0.4 }],
  }, 1);
  const f = fitElasticity(rows, { price: "price", qty: "units", segment: "weather", nums: [{ col: "temp", log: true }] });
  const sun = f.bySegment.find((s) => s.level === "sun"), wet = f.bySegment.find((s) => s.level === "rain");
  assert.ok(Math.abs(sun.eps + 2.5) < 0.05, `sun ${sun.eps}`);
  assert.ok(Math.abs(wet.eps + 1.3) < 0.05, `rain ${wet.eps}`);
  assert.ok(Math.abs(f.model.beta[f.names.indexOf("ln(temp)")] - 0.4) < 0.05);
});

test("offers aggregate to acceptance shares, zero cells kept with half an acceptance", () => {
  const cells = aggregateOffers([
    { price: 2, accept: 1 }, { price: 2, accept: 0 }, { price: 3, accept: 0 }, { price: 3, accept: "no" },
  ]);
  assert.deepEqual(cells.map((c) => [c.price, c.offers, c.accepts, c.share, c.zeroFixed]),
    [[2, 2, 1, 0.5, false], [3, 2, 0, 0.25, true]]);
  assert.deepEqual(priceGrid(10, 20, 5), [8, 9, 10, 11, 12]);
  const sim = simulateOffers({ respondents: 50, start: 10, rangePct: 30, levels: 7, offersEach: 7, sigma: 0.3, wtp: 10 }, 3);
  assert.equal(sim.length, 350);
  // Every respondent sees every grid price exactly once when offersEach = levels.
  const r1 = sim.filter((r) => r.respondent === "r1").map((r) => r.price).sort((a, b) => a - b);
  assert.deepEqual(r1, priceGrid(10, 30, 7));
});
