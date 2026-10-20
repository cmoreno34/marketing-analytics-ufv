/* The room's WTP optimum must equal the WTP Price Optimizer's, so the tool's
 * own code (functions copied from its index.html at test time when the repo is
 * next to this one, else the frozen reference below) is run on the same input. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { wtpOptimum, scaleLevels, frequencies, lernerElasticity, centredGrid } from "../src/lib/wtp.js";

const OPT = new URL("../../wtp-pricing-optimizer/index.html", import.meta.url);

function originalCompute() {
  if (!fs.existsSync(OPT)) return null;
  const html = fs.readFileSync(OPT, "utf8");
  // Each function from "function name(" to its matching closing brace.
  const grab = (name) => {
    const start = html.indexOf(`function ${name}(`);
    let i = html.indexOf("{", start), depth = 0;
    for (; i < html.length; i++) {
      if (html[i] === "{") depth++;
      else if (html[i] === "}" && --depth === 0) break;
    }
    return html.slice(start, i + 1);
  };
  const src = ["pchipSlopes", "pEnd", "pchip", "compute"].map(grab).join("\n");
  return new Function(`${src}; return compute;`)();
}

test("same optimum as the WTP Price Optimizer on its default case", () => {
  const prices = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6], answers = [3, 5, 8, 12, 9, 6, 4, 2, 1];
  const mine = wtpOptimum(prices, answers, { D: 15000, m: 100, vcu: 0.85, fc: 8500 });
  const compute = originalCompute();
  if (compute) {
    const theirs = compute(prices, answers, 15000, 100, 0.85, 8500, 0, 10000);
    assert.equal(mine.optPrice, theirs.optPrice);
    assert.equal(mine.optProfit, theirs.optProfit);
    assert.deepEqual(mine.ys, theirs.ys);
  }
  assert.ok(Math.abs(mine.optPrice - 3.2525252525) < 1e-9, String(mine.optPrice));   // the tool shows 3.25
});

test("market size and fixed cost never move the optimum", () => {
  const prices = [4, 5, 6, 7, 8, 9, 10], answers = [2, 4, 7, 9, 6, 3, 1];
  const a = wtpOptimum(prices, answers, { vcu: 2 }).optPrice;
  assert.equal(wtpOptimum(prices, answers, { D: 5000, fc: 999, vcu: 2 }).optPrice, a);
});

test("scale, frequencies, Lerner and the centred grid", () => {
  assert.deepEqual(scaleLevels(1, 2, 0.25), [1, 1.25, 1.5, 1.75, 2]);
  assert.deepEqual(frequencies([1, 1.2, 2, 7, 1.74], [1, 1.25, 1.5, 1.75, 2]), [1, 1, 0, 1, 2]);
  assert.ok(Math.abs(lernerElasticity(7.14, 3) + 1.7246) < 1e-3);
  assert.deepEqual(centredGrid(10, 15, 7), [8.5, 9, 9.5, 10, 10.5, 11, 11.5]);
});

import { suggestCentre } from "../src/lib/dynamic.js";

// Clean data with ε = −3 around 8, cost 3: P* = 4.5.
const clean = [6, 7, 8, 9, 10].flatMap((p) => [0, 1, 2].map(() => ({ price: p, share: 0.5 * (8 / p) ** 3, wave: 1 })));

test("the update is local: towards the optimum, never beyond the prices tested", () => {
  // ε = −3 measured around 8 with cost 3: the class is more elastic than 8 can bear (8 needs −1.6).
  const s = suggestCentre({ rows: clean, centre: 8, prices: [6, 7, 8, 9, 10], cost: 3, wave: 1 });
  assert.equal(s.short, "lower");
  assert.equal(s.price, 6);                                     // the formula's 4.5 is outside the prices tested
  assert.ok(Math.abs(s.needed + 1.6) < 1e-9);
  const t = suggestCentre({ rows: clean, centre: 5, prices: [4, 4.5, 5, 5.5, 6], cost: 3, wave: 1 });
  assert.equal(t.price, 4.5);                                   // inside the prices tested: the local optimum itself
});

test("the price is kept when the class shows the elasticity it needs, or cannot say yet", () => {
  const k = suggestCentre({ rows: clean, centre: 4.5, prices: [6, 7, 8, 9, 10], cost: 3, wave: 1 });
  assert.equal(k.price, 4.5);                                   // 4.5 needs ε = −3: exactly what the class shows
  assert.match(k.reason, /keep the price/);
  const flat = Array.from({ length: 12 }, (_, i) => ({ price: [8, 9, 10][i % 3], share: 0.6, wave: 1 }));
  const w = suggestCentre({ rows: flat, centre: 9, prices: [8, 9, 10], cost: 3, wave: 1 });
  assert.equal(w.price, 9);
  assert.equal(w.short, "wait");
});

import { niceStep } from "../src/lib/wtp.js";

test("the phase-2 grid: round prices, steps a student notices, centred on the WTP optimum", () => {
  assert.deepEqual([0.07, 0.12, 0.3, 0.6, 1.4, 3, 6].map(niceStep), [0.05, 0.1, 0.2, 0.5, 1, 2, 5]);
  assert.deepEqual(centredGrid(6.95, 30, 7), [5.5, 6, 6.5, 7, 7.5, 8, 8.5]);         // not 4.87 · 5.56 · 6.26 …
  assert.deepEqual(centredGrid(10.06, 30, 7), [7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(centredGrid(2.03, 30, 7), [1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6]);
  assert.deepEqual(centredGrid(60, 30, 7), [45, 50, 55, 60, 65, 70, 75]);
  for (const c of [0.37, 1.5, 3.3, 6.47, 9.21, 13.17, 18, 41, 120]) for (const [r, l] of [[20, 5], [30, 7], [40, 9]]) {
    const g = centredGrid(c, r, l), step = g[1] - g[0];
    assert.equal(g.length, l);
    assert.ok(g.every((p, i) => p > 0 && (i === 0 || Math.abs(p - g[i - 1] - step) < 1e-9)), `${c}: equal steps ${g}`);
    assert.ok(step / c >= 0.05 && step / c <= 0.17, `${c} ±${r}%: a step of ${step} is ${(100 * step / c).toFixed(0)}%`);
    assert.ok(Math.abs(g[(l - 1) / 2] - c) <= step / 2 + 1e-9, `${c}: centre ${g[(l - 1) / 2]}`);
  }
});
