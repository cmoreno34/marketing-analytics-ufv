import { useState, useEffect } from "react";
import { C } from "./theme.js";
import SegmentationLab from "./tools/SegmentationLab.jsx";
import RFMLab from "./tools/RFMLab.jsx";
import SectorResearch from "./tools/SectorResearch.jsx";
import Practice from "./tools/Practice.jsx";
import Homework from "./tools/Homework.jsx";

/* Hash routing on purpose. GitHub Pages serves static files with no rewrite
 * rules, so #/segmentation survives a refresh and a bookmark where
 * /segmentation would 404. These URLs go straight into Canvas and have to keep
 * working untouched for a whole term. */

const TOOLS = [
  {
    hash: "#/practice", title: "Practice: segmenting a market", module: "Module 4", note: "Activity A4 · in class",
    blurb: "A guided forty minutes: run four algorithms on one dataset, decide how many segments it really has, and judge whether the answer is good enough to show a client. Ends with a report to hand in.",
    ready: true, el: Practice, kind: "activity",
  },
  {
    hash: "#/homework", title: "Homework: segment a customer base", module: "Module 4", note: "Activity C4 · group",
    blurb: "The graded deliverable, step by step. Your own variables, four methods, the reconciliation, the personas and the actions — and a report carrying every parameter needed to reproduce it.",
    ready: true, el: Homework, kind: "activity",
  },
  {
    hash: "#/segmentation", title: "Segmentation Lab", module: "Module 4", note: "Technical note §5–15",
    blurb: "K-Means, K-Prototypes, hierarchical and DBSCAN on one dataset, scored with the same validation indices. Elbow, silhouette, dendrogram, centroid table and an AI reading of the segments.",
    ready: true, el: SegmentationLab,
  },
  {
    hash: "#/rfm", title: "RFM Lab", module: "Module 4", note: "Technical note §17",
    blurb: "Recency, Frequency, Monetary scoring on transactional data. What your customers are worth, as opposed to what they are like.",
    ready: true, el: RFMLab,
  },
  {
    hash: "#/sector-research", title: "Sector Research", module: "Module 4", note: "Technical note §18",
    blurb: "Builds a segmentation dataset for a sector by searching the open web, one row per company, with a source for every row.",
    ready: true, el: SectorResearch,
  },
  {
    hash: "#/perceptual", title: "Perceptual Maps", module: "Module 6", note: "Differentiation & positioning",
    blurb: "Positioning maps from attribute ratings, with the brand-space geometry behind them.",
    ready: false,
  },
  {
    hash: "#/pricing", title: "Pricing & WTP", module: "Module 8", note: "Pricing notes",
    blurb: "Willingness to pay, exchange value and demand-based optimal price.",
    ready: false,
  },
];

export default function App() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  // Strip any ?query — tools read their own deep-link parameters from it.
  const route = hash.split("?")[0].replace(/\/$/, "");
  const hit = TOOLS.find((t) => t.ready && t.hash === route);
  if (hit) { const El = hit.el; return <El />; }
  return <Landing />;
}

function Landing() {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <style>{`a{text-decoration:none}::-webkit-scrollbar{width:7px;background:transparent}::-webkit-scrollbar-thumb{background:#252836;border-radius:4px}`}</style>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "56px 24px 72px" }}>
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: C.acc, letterSpacing: "2px", marginBottom: 10 }}>
          MARKETING ANALYTICS · UFV
        </div>
        <h1 style={{ fontSize: 30, margin: "0 0 12px", fontWeight: 600 }}>Analysis tools</h1>
        <p style={{ color: C.mut, fontSize: 14, lineHeight: 1.7, maxWidth: 630, margin: "0 0 8px" }}>
          One tool per step of the course. Upload your own data, get the numbers, take them to your deliverable.
        </p>
        <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.7, maxWidth: 630, margin: "0 0 40px" }}>
          Everything runs in your browser — your file is never uploaded, which is what makes these safe to use with
          project data. Each tool does the arithmetic; <span style={{ color: C.txt }}>reading the result is still your
          job</span>, and it is what you are marked on.
        </p>

        <SectionLabel>Guided activities — start here</SectionLabel>
        <div style={{ display: "grid", gap: 12, marginBottom: 34 }}>
          {TOOLS.filter((t) => t.kind === "activity").map(renderCard)}
        </div>

        <SectionLabel>Tools — use these freely, and for your own data</SectionLabel>
        <div style={{ display: "grid", gap: 12 }}>
          {TOOLS.filter((t) => t.kind !== "activity").map(renderCard)}
        </div>

        <p style={{ color: C.mut, fontSize: 11, marginTop: 40, lineHeight: 1.75 }}>
          César Moreno Pascual, PhD · Marketing Analytics, Universidad Francisco de Vitoria. Source:{" "}
          <a href="https://github.com/cmoreno34/marketing-analytics-ufv" style={{ color: C.acc }}>
            github.com/cmoreno34/marketing-analytics-ufv
          </a>
        </p>
      </div>
    </div>
  );
}

const tagStyle = {
  fontSize: 9, fontFamily: "ui-monospace, monospace", color: C.mut,
  border: `1px solid ${C.bord}`, borderRadius: 4, padding: "2px 6px",
};

function SectionLabel({ children }) {
  return (
    <div style={{
      fontFamily: "ui-monospace, monospace", fontSize: 10, color: C.mut, letterSpacing: "1.4px",
      textTransform: "uppercase", marginBottom: 12,
    }}>{children}</div>
  );
}

/* Activities lead with an accent edge — a student arriving from Canvas should
 * see at a glance which two cards are the thing they were sent here to do. */
function renderCard(t) {
  const style = {
    display: "block", background: C.card, border: `1px solid ${t.kind === "activity" ? `${C.acc}55` : C.bord}`,
    borderLeft: t.kind === "activity" ? `3px solid ${C.acc}` : `1px solid ${C.bord}`,
    borderRadius: 10, padding: "18px 20px",
    opacity: t.ready ? 1 : 0.45, cursor: t.ready ? "pointer" : "default",
  };
  const inner = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 15, color: C.txt }}>{t.title}</strong>
        <span style={tagStyle}>{t.module}</span>
        <span style={tagStyle}>{t.note}</span>
        <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: "ui-monospace, monospace", color: t.ready ? C.acc : C.mut }}>
          {t.ready ? "OPEN →" : "SOON"}
        </span>
      </div>
      <div style={{ color: C.mut, fontSize: 12.5, lineHeight: 1.6 }}>{t.blurb}</div>
    </>
  );
  return t.ready
    ? <a key={t.hash} href={t.hash} style={style}>{inner}</a>
    : <div key={t.hash} style={style}>{inner}</div>;
}
