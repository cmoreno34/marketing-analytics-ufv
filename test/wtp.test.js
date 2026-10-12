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

import { syntheticGroups, suggestCentre, TARGET } from "../src/lib/dynamic.js";

test("synthetic groups follow the stated WTP and fade as real groups arrive", () => {
  const wtps = Array.from({ length: 40 }, (_, i) => 5 + (i % 9));       // 5 … 13
  const g = syntheticGroups(wtps, [6, 8, 10, 12], 400, 5, 3);
  const at = (p) => g.filter((x) => x.price === p).reduce((a, x) => a + x.accepts, 0) / g.filter((x) => x.price === p).reduce((a, x) => a + x.offers, 0);
  assert.ok(at(6) > at(8) && at(8) > at(10) && at(10) > at(12));
  // An impossible real estimate (flat shares) gets synthetic help; plenty of real points get none.
  const flat = Array.from({ length: 12 }, (_, i) => ({ price: [8, 9, 10][i % 3], share: 0.6, wave: 1 }));
  const s1 = suggestCentre({ rows: flat, wtps, centre: 9, prices: [8, 9, 10], cost: 3, rangePct: 15, wave: 1 });
  assert.equal(s1.synthetic, TARGET - 12);
  assert.ok(s1.final.eps < s1.real.eps);
  const many = Array.from({ length: 40 }, (_, i) => ({ price: [8, 9, 10][i % 3], share: 0.6, wave: 1 }));
  assert.equal(suggestCentre({ rows: many, wtps, centre: 9, prices: [8, 9, 10], cost: 3, rangePct: 15, wave: 1 }).synthetic, 0);
});

test("the price moves half-way, at most half the range, and only when the data say so", () => {
  // Clean data with ε = −3 around 8 and cost 3: P* = 4.5, far below 8 → move, damped.
  const rows = [6, 7, 8, 9, 10].flatMap((p) => [0, 1, 2].map(() => ({ price: p, share: 0.5 * (8 / p) ** 3, wave: 1 })));
  const s = suggestCentre({ rows, centre: 8, prices: [6, 7, 8, 9, 10], cost: 3, rangePct: 30, wave: 1 });
  assert.equal(s.price, 6.8);                                   // 8 − 15%, not all the way to 4.5
  // Centre already at P* = 4.5: keep it.
  const k = suggestCentre({ rows, centre: 4.5, prices: [6, 7, 8, 9, 10], cost: 3, rangePct: 30, wave: 1 });
  assert.equal(k.price, 4.5);
  assert.match(k.reason, /keep the price/);
});
