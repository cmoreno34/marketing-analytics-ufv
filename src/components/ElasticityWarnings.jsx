/* The two warnings a class-sized elasticity needs, shared by the room page,
 * the WTP results page and the Lab.
 *
 *  - Around a profit-maximising price demand must be elastic (ε < −1): a firm
 *    never sets its price where demand is inelastic, because raising it would
 *    add revenue and save cost. When the prices were centred on the WTP
 *    optimum, an estimate at or above −1 is not a finding: it is noise.
 *  - An interval wider than about one unit is unstable: the width shrinks with
 *    √n, so halving it takes about four times as many answers.
 */
import { Callout } from "./UI.jsx";

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const name = (s) => (s.level == null ? "the product" : s.level);

export function ElasticityWarnings({ segments, aroundOptimum = false, unit = "groups", maxWidth = 1 }) {
  if (!segments?.length) return null;
  const impossible = aroundOptimum ? segments.filter((s) => s.eps >= -1) : [];
  const unstable = segments.filter((s) => !impossible.includes(s) && s.hi - s.lo > maxWidth);
  return (
    <>
      {impossible.length > 0 && (
        <Callout tone="bad" title={`This cannot be right: ε ${impossible.map((s) => `${f2(s.eps)} for ${name(s)}`).join(", ")}`}>
          The prices were centred on the optimal price, and around an optimal price demand <strong>must be elastic (ε below −1)</strong>:
          a firm never sets its price where demand is inelastic, because raising it would bring more revenue and save cost. An estimate
          at or above −1 here is not a fact about the market — it is noise from too few answers ({impossible.map((s) => `${s.n} ${unit}`).join(", ")}).
          Do not read it or price on it: add rounds or reopen the room with another class group, and look again.
        </Callout>
      )}
      {unstable.length > 0 && (
        <Callout tone="warn" title="Unstable: the sample is too small to pin the elasticity down">
          {unstable.map((s) => (
            <div key={name(s)}>
              {s.level != null && <strong>{s.level}: </strong>}ε = {f2(s.eps)}, but the 95% interval runs from {f2(s.lo)} to {f2(s.hi)} — {f2(s.hi - s.lo)} wide,
              from {s.n} {unit}. Another class of the same size could easily give any value in that range.
            </div>
          ))}
          <div style={{ marginTop: 4 }}>
            The width shrinks with the square root of the sample: halving it takes about <strong>four times</strong> as many answers. Add rounds,
            reopen the room with another group, or pool several classes before drawing conclusions.
          </div>
        </Callout>
      )}
    </>
  );
}
