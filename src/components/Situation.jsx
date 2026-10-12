/* A situation as students must see it: big, with a picture, so nobody answers
 * a price without noticing that it is raining. */
import { C } from "../theme.js";
import { iconFor } from "../lib/room.js";

export function SituationCard({ situations, levels, size = "big" }) {
  const rows = situations.map((x, i) => [x, levels[i]]).filter(([, l]) => l);
  if (!rows.length) return null;
  const big = size === "big";
  return (
    <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
      {rows.map(([x, l]) => (
        <div key={x.name} style={{
          display: "flex", alignItems: "center", gap: big ? 14 : 9, padding: big ? "12px 14px" : "7px 10px",
          borderRadius: 12, background: `${C.acc}1f`, border: `2px solid ${C.acc}`,
        }}>
          <span aria-hidden style={{ fontSize: big ? 46 : 26, lineHeight: 1 }}>{iconFor(l)}</span>
          <div style={{ lineHeight: 1.25 }}>
            {x.question && <div style={{ fontSize: big ? 13.5 : 11.5, color: C.mut }}>{x.question}</div>}
            <div style={{ fontSize: big ? 21 : 15, fontWeight: 700 }}>{l}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
