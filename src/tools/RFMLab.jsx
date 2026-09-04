/* RFM Lab.
 *
 * Sits next to the clustering lab on purpose. Clustering asks "what are my
 * customers LIKE"; RFM asks "what are they WORTH". A segmentation deliverable
 * that answers only the first is half a deliverable. */

import { useState, useMemo, useRef } from "react";
import { C, inp, clusterStyle } from "../theme.js";
import { Section, Callout, Stat, Table, Field, Chip, Spinner } from "../components/UI.jsx";
import { fmt } from "../components/Charts.jsx";
import { parseFile, parseCSV, toCSV, download } from "../lib/parse.js";
import { profileAll } from "../lib/prep.js";
import { computeRFM, guessRFMColumns, SEGMENT_ACTIONS } from "../lib/rfm.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export default function RFMLab() {
  const [raw, setRaw] = useState(null);
  const [fileName, setFileName] = useState("");
  const [cfg, setCfg] = useState({ id: "", recency: "", frequency: "", monetary: "", recencyIsDate: false, referenceDate: "2014-10-01" });
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  const profiles = useMemo(() => (raw ? profileAll(raw.rows, raw.headers) : []), [raw]);

  function apply(parsed, name) {
    setRaw(parsed); setFileName(name); setResult(null);
    const prof = profileAll(parsed.rows, parsed.headers);
    const g = guessRFMColumns(prof);
    setCfg((c) => ({ ...c, id: g.id, recency: g.recency || g.dateColumn, frequency: g.frequency, monetary: g.monetary, recencyIsDate: !g.recency && !!g.dateColumn }));
  }

  async function loadSample() {
    setLoading(true); setErr("");
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/marketing_campaign.csv`);
      apply(parseCSV(await res.text()), "marketing_campaign.csv");
    } catch { setErr("Could not load the sample."); }
    setLoading(false);
  }

  async function loadFile(f) {
    setLoading(true); setErr("");
    try { apply(await parseFile(f), f.name); }
    catch (e) { setErr(e.message || "Could not read that file."); }
    setLoading(false);
  }

  function run() {
    setErr("");
    try {
      if (!cfg.recency || !cfg.frequency || !cfg.monetary) throw new Error("Choose a column for recency, frequency and monetary value.");
      const r = computeRFM(raw.rows, cfg);
      if (!r.rows.length) throw new Error("No rows had usable values in all three columns.");
      setResult(r);
    } catch (e) { setErr(e.message); setResult(null); }
  }

  const cols = profiles.map((p) => p.key);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "34px 22px 90px" }}>
        <a href="#/" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← all tools</a>
        <h1 style={{ fontSize: 25, margin: "12px 0 7px", fontWeight: 600 }}>RFM Lab</h1>
        <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.7, maxWidth: 660, margin: "0 0 26px" }}>
          Recency, Frequency and Monetary value — the oldest segmentation in direct marketing, and still the first thing
          anyone runs on transactional data. It is not clustering: the segments come from a scoring rule, which is
          exactly why it is worth comparing against what K-Means finds on the same customers.
        </p>

        <Section title="1 · Data" note={raw ? `${fileName} — ${raw.rows.length} rows` : "A row per customer, with a recency, a frequency and a spend column."}>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <button onClick={() => fileRef.current?.click()} style={{
              background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6,
              padding: "8px 15px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}>Upload CSV / Excel</button>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
            <Chip onClick={loadSample}>Marketing campaign (2 240)</Chip>
          </div>
          {loading && <div style={{ marginTop: 11 }}><Spinner label="Reading…" /></div>}
        </Section>

        {raw && (
          <Section title="2 · Map the three columns"
            note="Recency is time since the last purchase — smaller is better, so it scores in reverse. Frequency is how many times they bought. Monetary is what they spent.">
            <div style={{ display: "grid", gap: 13, gridTemplateColumns: "repeat(auto-fit,minmax(185px,1fr))" }}>
              <Field label="customer id (optional)">
                <select value={cfg.id} onChange={(e) => setCfg({ ...cfg, id: e.target.value })} style={inp}>
                  <option value="">— row number —</option>
                  {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="recency">
                <select value={cfg.recency} onChange={(e) => setCfg({ ...cfg, recency: e.target.value })} style={inp}>
                  <option value="">— choose —</option>
                  {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="recency is…">
                <select value={cfg.recencyIsDate ? "date" : "days"} onChange={(e) => setCfg({ ...cfg, recencyIsDate: e.target.value === "date" })} style={inp}>
                  <option value="days">already a number of days</option>
                  <option value="date">a date of last purchase</option>
                </select>
              </Field>
              {cfg.recencyIsDate && (
                <Field label="reference date" hint="Days are counted back from here.">
                  <input type="date" value={cfg.referenceDate} onChange={(e) => setCfg({ ...cfg, referenceDate: e.target.value })} style={inp} />
                </Field>
              )}
              <Field label="frequency">
                <select value={cfg.frequency} onChange={(e) => setCfg({ ...cfg, frequency: e.target.value })} style={inp}>
                  <option value="">— choose —</option>
                  {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="monetary">
                <select value={cfg.monetary} onChange={(e) => setCfg({ ...cfg, monetary: e.target.value })} style={inp}>
                  <option value="">— choose —</option>
                  {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </div>
            <button onClick={run} style={{
              background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6, marginTop: 15,
              padding: "9px 19px", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>Score the customers</button>
            {err && <Callout tone="bad" title="Problem">{err}</Callout>}
          </Section>
        )}

        {result && <RFMResults result={result} raw={raw} cfg={cfg} />}
      </div>
    </div>
  );
}

function RFMResults({ result, raw, cfg }) {
  const { summary, rows, totalValue, dropped } = result;
  const top = summary[0];
  const champions = summary.find((s) => s.segment === "Champions");

  function exportCsv() {
    const headers = [...raw.headers, "R", "F", "M", "RFM_cell", "RFM_segment"];
    const out = raw.rows.map((r, i) => {
      const hit = rows.find((x) => x.rowIndex === i);
      return { ...r, R: hit?.R ?? "", F: hit?.F ?? "", M: hit?.M ?? "", RFM_cell: hit?.cell ?? "", RFM_segment: hit?.segment ?? "" };
    });
    download("rfm_segments.csv", toCSV(out, headers));
  }

  return (
    <>
      <Section title="3 · Where the value sits"
        note="Share of customers against share of revenue. The gap between those two columns is the whole argument for segmenting at all.">
        <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginBottom: 15 }}>
          <Stat label="customers scored" value={rows.length} hint={dropped ? `${dropped} dropped for missing values` : "all rows usable"} />
          <Stat label="total value" value={fmt(totalValue)} />
          <Stat label="largest segment by value" value={top?.segment ?? "—"} hint={`${(top?.valueShare * 100).toFixed(1)}% of revenue from ${(top?.share * 100).toFixed(1)}% of customers`} />
          {champions && <Stat label="champions" value={champions.n} tone="good" hint={`${(champions.valueShare * 100).toFixed(1)}% of revenue`} />}
        </div>

        <Table
          head={["segment", "customers", "% of base", "% of value", "avg recency", "avg frequency", "avg spend"]}
          rows={summary.map((s) => [
            <strong>{s.segment}</strong>,
            s.n,
            `${(s.share * 100).toFixed(1)}%`,
            <ValueBar share={s.valueShare} />,
            fmt(s.avgRecency),
            fmt(s.avgFrequency),
            fmt(s.avgMonetary),
          ])}
        />
        <button onClick={exportCsv} style={{
          background: C.surf, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6,
          padding: "8px 15px", fontSize: 12.5, cursor: "pointer", marginTop: 13,
        }}>Export with R, F, M and segment</button>
      </Section>

      <Section title="4 · What to do with each"
        note="These actions are the conventional RFM playbook. They are a starting point for your recommendation, not a substitute for it — nothing here knows your product or your margins.">
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: "repeat(auto-fit,minmax(255px,1fr))" }}>
          {summary.map((s, i) => (
            <div key={s.segment} style={{
              background: C.surf, border: `1px solid ${C.bord}`, borderLeft: `3px solid ${clusterStyle(i).color}`,
              borderRadius: 7, padding: "12px 14px",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
                <strong style={{ fontSize: 13.5 }}>{s.segment}</strong>
                <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10.5, color: C.mut }}>
                  {s.n} · {(s.valueShare * 100).toFixed(1)}% value
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, color: C.txt, opacity: 0.88, lineHeight: 1.6 }}>{s.action}</p>
            </div>
          ))}
        </div>
        <Callout tone="info" title="Take this to the clustering lab">
          Export the file above, load it into the Segmentation Lab, and cluster on the same customers using behavioural
          variables. Then cross-tabulate your clusters against these RFM segments. Where a behavioural cluster splits
          across several value tiers, you have found something a single method would have missed.
        </Callout>
      </Section>
    </>
  );
}

/* A share needs a visual comparator, not just a number — the point of the
 * table is that these two percentages diverge. */
function ValueBar({ share }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, justifyContent: "flex-end" }}>
      <span style={{ width: 54, height: 5, background: C.bord, borderRadius: 3, overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", width: `${Math.min(100, share * 100)}%`, height: "100%", background: C.acc }} />
      </span>
      <span style={{ minWidth: 42, textAlign: "right" }}>{(share * 100).toFixed(1)}%</span>
    </span>
  );
}
