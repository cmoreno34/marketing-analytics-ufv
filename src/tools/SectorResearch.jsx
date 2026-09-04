/* Sector Research — the data-collection agent.
 *
 * Builds a segmentation dataset for a sector by searching the open web, rather
 * than handing students yet another pre-cleaned CSV. Real projects start with
 * no data, and the collection step is where most of the judgement lives.
 *
 * Two deliberate scope limits, both of which are teaching points:
 *   - Companies, not people. Firmographic data on legal entities is public;
 *     assembling profiles of identifiable individuals from the web is not
 *     something a European university should be teaching, GDPR aside.
 *   - Consumer demand is described in AGGREGATE from published research, and
 *     the individual-level rows the tool can generate from it are explicitly
 *     synthetic and labelled as such. */

import { useState } from "react";
import { C, inp, card } from "../theme.js";
import { Section, Callout, Stat, Table, Field, Chip, Spinner } from "../components/UI.jsx";
import { toCSV, download } from "../lib/parse.js";
import { researchSector, buildResearchPrompt, ApiError } from "../lib/api.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const VARIABLE_SETS = {
  core: ["company_name", "country", "city", "founded_year", "employees", "annual_revenue_eur", "business_model", "primary_channel"],
  positioning: ["price_positioning", "target_customer", "product_range_breadth", "own_brand", "sustainability_claim"],
  digital: ["website", "ecommerce", "social_followers", "app", "loyalty_programme", "marketplace_presence"],
};

const PRESETS = [
  { sector: "specialty coffee roasters", geography: "Spain" },
  { sector: "poke bowl and healthy fast-casual restaurants", geography: "Madrid, Spain" },
  { sector: "electric vehicle charging operators", geography: "Spain" },
  { sector: "craft beer breweries", geography: "Spain" },
  { sector: "boutique fitness studios", geography: "Madrid, Spain" },
];

export default function SectorResearch() {
  const [sector, setSector] = useState("");
  const [geography, setGeography] = useState("Spain");
  const [n, setN] = useState(25);
  const [sets, setSets] = useState(["core", "positioning"]);
  const [includeDemand, setIncludeDemand] = useState(true);
  const [state, setState] = useState({ status: "idle" });
  const [showPrompt, setShowPrompt] = useState(false);

  const variables = sets.flatMap((s) => VARIABLE_SETS[s]);
  const prompt = buildResearchPrompt({ sector, geography, n, variables });

  async function run() {
    if (!sector.trim()) { setState({ status: "error", error: new ApiError("Describe the sector first.") }); return; }
    setState({ status: "loading" });
    try {
      const data = await researchSector({ sector, geography, n, variables, includeDemand });
      setState({ status: "done", data });
    } catch (e) {
      setState({ status: "error", error: e instanceof ApiError ? e : new ApiError(e.message) });
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "34px 22px 90px" }}>
        <a href="#/" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← all tools</a>
        <h1 style={{ fontSize: 25, margin: "12px 0 7px", fontWeight: 600 }}>Sector Research</h1>
        <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.7, maxWidth: 680, margin: "0 0 22px" }}>
          Builds a segmentation dataset for a sector by searching the open web. You get one row per company with a
          source URL for every row, so the data can be checked — which is the part that makes it usable in a report.
        </p>

        <Callout tone="info" title="What this collects, and what it will not">
          Companies, not people. Firmographic data about legal entities is public and fair to compile; assembling
          profiles of identifiable individuals from the web is a GDPR problem regardless of intent, so the agent will
          decline it. Where consumer demand matters, it is described in aggregate from published research — and if you
          ask for individual consumer rows, what you get is <strong>synthetic data calibrated to those aggregates</strong>,
          labelled as such in the export. Never present synthetic rows as observed customers.
        </Callout>

        <Section title="1 · What to research">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {PRESETS.map((p) => (
              <Chip key={p.sector} onClick={() => { setSector(p.sector); setGeography(p.geography); }}>{p.sector}</Chip>
            ))}
          </div>
          <div style={{ display: "grid", gap: 13, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
            <Field label="sector" hint="Be specific. “restaurants” is too broad to segment; “poke bowl chains in Madrid” is not.">
              <input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="e.g. specialty coffee roasters" style={inp} />
            </Field>
            <Field label="geography">
              <input value={geography} onChange={(e) => setGeography(e.target.value)} style={inp} />
            </Field>
            <Field label={`companies (${n})`} hint="Twenty-five is enough to cluster; more takes longer and adds little.">
              <input type="range" min="10" max="60" step="5" value={n} onChange={(e) => setN(+e.target.value)} style={{ width: "100%", accentColor: C.acc }} />
            </Field>
          </div>

          <div style={{ marginTop: 15 }}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
              variables to collect
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {Object.entries(VARIABLE_SETS).map(([key, vars]) => (
                <Chip key={key} active={sets.includes(key)}
                  onClick={() => setSets(sets.includes(key) ? sets.filter((s) => s !== key) : [...sets, key])}
                  title={vars.join(", ")}>
                  {key} <span style={{ opacity: 0.6, fontSize: 10 }}>{vars.length}</span>
                </Chip>
              ))}
              <Chip active={includeDemand} onClick={() => setIncludeDemand((v) => !v)}
                title="Adds market size, growth and consumer trends from published research, with sources.">
                + demand-side context
              </Chip>
            </div>
            <p style={{ fontSize: 11, color: C.mut, marginTop: 8, lineHeight: 1.6 }}>
              {variables.join(" · ")}
            </p>
          </div>

          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
            <button onClick={run} disabled={state.status === "loading"} style={{
              background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6,
              padding: "9px 19px", fontSize: 13, fontWeight: 600, cursor: state.status === "loading" ? "wait" : "pointer",
            }}>{state.status === "loading" ? "Researching…" : "Research this sector"}</button>
            <Chip active={showPrompt} onClick={() => setShowPrompt((v) => !v)}>{showPrompt ? "Hide" : "Show"} the prompt</Chip>
            {state.status === "loading" && <Spinner label="Searching the web — this takes a minute or two." />}
          </div>

          {showPrompt && (
            <textarea readOnly value={prompt} rows={11} style={{
              width: "100%", marginTop: 12, background: "#0d0f14", border: `1px solid ${C.bord}`, color: C.mut,
              borderRadius: 6, padding: 11, fontSize: 11.5, fontFamily: MONO, lineHeight: 1.55, resize: "vertical",
            }} />
          )}

          {state.status === "error" && (
            <Callout tone={state.error.kind === "quota" ? "warn" : "bad"} title={state.error.kind === "quota" ? "Daily quota reached" : "Could not complete the research"}>
              {state.error.message}
              <div style={{ marginTop: 7 }}>
                Copy the prompt above into Claude or ChatGPT with web search enabled, save the CSV it returns, and
                upload it to the Segmentation Lab. The result is the same.
              </div>
            </Callout>
          )}
        </Section>

        {state.status === "done" && <ResearchResults data={state.data} sector={sector} />}
      </div>
    </div>
  );
}

function ResearchResults({ data, sector }) {
  const rows = data?.companies ?? [];
  const cols = rows.length ? Object.keys(rows[0]).filter((c) => c !== "source_url") : [];
  const withSource = rows.filter((r) => r.source_url).length;
  const naCount = rows.reduce((n, r) => n + Object.values(r).filter((v) => String(v).toUpperCase() === "NA").length, 0);
  const cells = rows.length * (cols.length || 1);

  function exportCsv() {
    download(`sector_${sector.replace(/\W+/g, "_").slice(0, 40)}.csv`, toCSV(rows, [...cols, "source_url"]));
  }

  /* Hands the rows to the Segmentation Lab without a round trip through the
   * user's Downloads folder. sessionStorage, so it dies with the tab. */
  function sendToLab() {
    try {
      sessionStorage.setItem("mkt.handoff", JSON.stringify({ name: `${sector} (researched)`, rows, headers: [...cols, "source_url"] }));
      window.location.hash = "#/segmentation";
    } catch { exportCsv(); }
  }

  return (
    <>
      <Section title="2 · What came back"
        note="Check a few rows against their sources before you cluster them. A dataset you have not spot-checked is not evidence."
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={sendToLab} style={{
              background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6,
              padding: "7px 13px", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>Send to Segmentation Lab</button>
            <button onClick={exportCsv} style={{
              background: C.surf, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6,
              padding: "7px 13px", fontSize: 12, cursor: "pointer",
            }}>Download CSV</button>
          </div>
        }>
        <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginBottom: 15 }}>
          <Stat label="companies" value={rows.length} />
          <Stat label="variables" value={cols.length} />
          <Stat label="with a source" value={`${withSource}/${rows.length}`} tone={withSource === rows.length ? "good" : "warn"} />
          <Stat label="missing values" value={`${((naCount / (cells || 1)) * 100).toFixed(0)}%`}
            tone={naCount / (cells || 1) > 0.3 ? "warn" : undefined}
            hint={naCount > 0 ? "marked NA, not guessed" : "complete"} />
        </div>
        <Table
          head={[...cols, "source"]}
          rows={rows.map((r) => [
            ...cols.map((c) => {
              const v = String(r[c] ?? "");
              return v.toUpperCase() === "NA"
                ? <span style={{ color: C.mut, fontStyle: "italic" }}>NA</span>
                : v.slice(0, 34);
            }),
            r.source_url
              ? <a href={r.source_url} target="_blank" rel="noreferrer noopener" style={{ color: C.acc, fontSize: 11 }}>link</a>
              : <span style={{ color: C.warn, fontSize: 11 }}>none</span>,
          ])}
        />
        {naCount / (cells || 1) > 0.3 && (
          <Callout tone="warn" title="A lot of gaps">
            Over 30% of the cells came back NA. That is honest reporting rather than a failure — revenue and headcount
            are simply not public for small private companies. Before clustering, either drop the sparsest variables or
            narrow the sector to firms that file accounts.
          </Callout>
        )}
      </Section>

      {data?.demand && (
        <Section title="3 · The demand side"
          note="Aggregate market context from published research. Use it to sanity-check whether the segments you find are commercially meaningful.">
          <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginBottom: 14 }}>
            {(data.demand.metrics ?? []).map((m, i) => (
              <Stat key={i} label={m.label} value={m.value} hint={m.period} />
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: C.txt, opacity: 0.9, lineHeight: 1.7 }}>{data.demand.summary}</p>
          {(data.demand.trends ?? []).length > 0 && (
            <ul style={{ fontSize: 12.5, color: C.txt, opacity: 0.9, lineHeight: 1.75, paddingLeft: 19, margin: "10px 0 0" }}>
              {data.demand.trends.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          )}
          {(data.sources ?? []).length > 0 && (
            <div style={{ marginTop: 15 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
                sources
              </div>
              <ol style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.8, paddingLeft: 19, margin: 0 }}>
                {data.sources.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} target="_blank" rel="noreferrer noopener" style={{ color: C.acc }}>{s.title || s.url}</a>
                  </li>
                ))}
              </ol>
              <p style={{ fontSize: 11, color: C.mut, marginTop: 10, lineHeight: 1.6 }}>
                Cite these in your report. A figure without a source is not a finding.
              </p>
            </div>
          )}
        </Section>
      )}
    </>
  );
}
