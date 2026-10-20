/* The rules every price grid of a live room follows (src/lib/priceRules.js),
 * in words — shown on the room page and on the room guide. */
import { C } from "../theme.js";
import { RULES } from "../lib/priceRules.js";

export function PriceRulesList() {
  const b = (t) => <strong style={{ color: C.txt }}>{t}</strong>;
  return (
    <ol style={{ paddingLeft: 20, margin: "6px 0 0", lineHeight: 1.7 }}>
      <li>{b("Steps a buyer notices")}: at least {RULES.minStepPct}% of the highest price (the just-noticeable difference, Weber's law). Smaller steps get the same answer at different prices and push the elasticity towards 0.</li>
      <li>{b(`Range between ±${RULES.minRangePct}% and ±${RULES.maxRangePct}%`)} of the centre. Narrower: the slope is measured with a huge interval (its precision grows with the spread of ln P). Wider: the elasticity is no longer constant and the log-log line bends.</li>
      <li>{b("Ends where about 90% and 10% would buy")}: a price where everybody (or nobody) buys tells nothing about the slope. First from the phase-1 WTP (its 10th and 90th percentiles), then from the curve fitted to the answers; a wave where everybody bought at the top, or nobody at the bottom, moves the whole grid that way.</li>
      <li>{b("The optimum inside the grid")}: each wave is centred on the tested price with the highest (P − c) × share buying — where the local elasticity meets Lerner's rule, ε = −P/(P − c). If that is an end of the grid, the optimum lies beyond it and the grid moves that way. (One constant elasticity fitted across a wide grid is steeper than the elasticity near the optimum, so the formula P* = c·ε/(1+ε) overshoots; the profit at the prices actually tested does not.)</li>
      <li>{b("Nothing at or below the unit cost")}: the lowest price is at least {Math.round((RULES.costMargin - 1) * 100)}% above it.</li>
      <li>{b(`At least ${RULES.minLevels} prices`)}, rounded to prices a buyer reads at a glance (steps of 1, 2 or 5 × 10ⁿ).</li>
      <li>{b("A synthetic seed")} keeps the curve near reality while real answers are few: the class's own phase-1 WTP played at every price offered (yes where the stated maximum reaches the price). A one-phase room gets a small prior instead — {RULES.priorGroups} groups per price through the starting price, first wave only, and left out of the decisions once there are ten real groups. A switch on the room page shows the fit without the seed.</li>
      <li>{b("When a wave ends")}: when everybody who started it has climbed the whole ladder and every price has {RULES.minGroupsPerPrice} closed groups — or, in a small class, when 80% have finished and nobody has answered for 45 seconds.</li>
    </ol>
  );
}
