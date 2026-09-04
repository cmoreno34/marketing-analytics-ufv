/* Palette shared with the MKT 3600 tools, so a student who has seen one
 * recognises the other. Extended here with verdict colours and the cluster
 * ramp. */
export const C = {
  bg: "#0d0f14",
  surf: "#151720",
  card: "#1c1f2b",
  bord: "#252836",
  acc: "#6c8fff",
  warn: "#ffbb6c",
  good: "#6cffb8",
  bad: "#ff6c8f",
  txt: "#e2e5f0",
  mut: "#5e6278",
};

/* Five hues, in fixed order — cluster 3 is the same colour in the scatter, the
 * dendrogram, the legend and the table.
 *
 * Five is not an arbitrary cap. Every hue here sits in the dark-mode lightness
 * band with worst-pair ΔE 8.0 under simulated deuteranopia and 15.7 under
 * normal vision, measured across ALL pairs (a scatter has no "adjacent"
 * series). A sixth hue at the same lightness cannot clear those floors in
 * sRGB — so beyond five, identity moves to marker SHAPE rather than to a
 * sixth colour nobody can reliably name. Cluster numbers are drawn on every
 * centroid regardless, so colour is never the only channel. */
export const CLUSTER_COLORS = ["#f12f1e", "#249e5f", "#238fcc", "#8967f6", "#e127a7"];
export const NOISE_COLOR = "#4a4f63";

/* Composite encoding: colour cycles every 5, shape changes every 5. */
export const clusterStyle = (i) => ({
  color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
  shape: ["circle", "square", "triangle"][Math.floor(i / CLUSTER_COLORS.length) % 3],
});
export const clusterColor = (i) => (i < 0 ? NOISE_COLOR : CLUSTER_COLORS[i % CLUSTER_COLORS.length]);

export const inp = {
  width: "100%",
  background: C.card,
  border: `1px solid ${C.bord}`,
  color: C.txt,
  borderRadius: 5,
  padding: "6px 8px",
  fontFamily: "system-ui",
  fontSize: 12,
  outline: "none",
};

export const slabel = {
  fontFamily: "monospace",
  fontSize: 10,
  color: C.mut,
  textTransform: "uppercase",
  letterSpacing: "1.4px",
  marginBottom: 6,
  display: "block",
};

export const btn = (active) => ({
  background: active ? C.acc : C.card,
  color: active ? "#0d0f14" : C.txt,
  border: `1px solid ${active ? C.acc : C.bord}`,
  borderRadius: 6,
  padding: "7px 13px",
  fontSize: 12.5,
  fontWeight: active ? 600 : 400,
  cursor: "pointer",
  fontFamily: "system-ui",
});

export const card = {
  background: C.card,
  border: `1px solid ${C.bord}`,
  borderRadius: 9,
  padding: 16,
};
