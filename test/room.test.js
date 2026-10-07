/* The live room's data, as the Lab and the room page read it: several
 * situations become columns, a numeric one becomes a number, and the model
 * draws lines by the first categorical situation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRows, answerRows, roomSpec, situationsOf, leadingNumber } from "../src/lib/room.js";
import { fitElasticity } from "../src/lib/elasticity.js";

const cfg = {
  situations: [
    { name: "weather", question: "Outside", levels: ["raining", "dry"] },
    { name: "temp", question: "It is", levels: ["10 °C", "30 °C"], numeric: true },
  ],
};

test("leading numbers", () => {
  assert.equal(leadingNumber("15 °C"), 15);
  assert.equal(leadingNumber("1,5 km"), 1.5);
  assert.ok(Number.isNaN(leadingNumber("hot")));
});

test("old rooms with a single situation still read", () => {
  assert.deepEqual(situationsOf({ situation: { name: "w", levels: ["a", "b"] } }).map((x) => x.name), ["w"]);
  const rows = groupRows([{ id: 1, closed: true, n: 5, yes: 2, price: 3, level: "a" }], { situation: { name: "w", levels: ["a", "b"] } });
  assert.equal(rows[0].w, "a");
});

test("two situations: columns, numbers and the model", () => {
  const groups = [];
  let id = 1;
  for (const w of ["raining", "dry"]) for (const t of ["10 °C", "30 °C"]) for (const p of [4, 6, 8, 10, 12]) {
    const share = Math.min(1, (w === "raining" ? 1.4 : 1) * (t === "30 °C" ? 1.2 : 1) * (8 / p) ** 2 * 0.4);
    groups.push({ id: id++, closed: true, n: 5, yes: Math.max(0, Math.round(share * 5)), price: p, level: `${w} · ${t}`, levels: [w, t],
      answers: { a: 1, b: 0 } });
  }
  const rows = groupRows(groups, cfg);
  assert.equal(rows[0].weather, "raining");
  assert.equal(rows[0].temp, 10);
  const spec = roomSpec(cfg, rows);
  assert.equal(spec.segment, "weather");
  assert.deepEqual(spec.nums, [{ col: "temp", log: true }]);
  const f = fitElasticity(rows, spec);
  assert.ok(f.names.includes("ln(temp)"));
  const ans = answerRows({ cfg, groups });
  assert.equal(ans[0].temp, 10);
  assert.equal(ans[0].group, "G1");
});
