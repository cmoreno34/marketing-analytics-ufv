/* Group activity D4 — build your own sector dataset, then segment it.
 *
 * Every other activity hands the student clean data. This one does not, and
 * that is the point: the collection and the verification are where the
 * judgement lives, and they are what the marking weights. The clustering at
 * the end is deliberately harder than on the course datasets — small n,
 * missing values, self-reported categories — because that is what a dataset
 * you built yourself actually looks like. */

import { useState, useEffect, useMemo, useRef } from "react";
import { C, inp, clusterStyle } from "../theme.js";
import { Section, Callout, Stat, Table, CentroidTable, Field, Chip, Spinner } from "../components/UI.jsx";
import { LineOverK, Scatter, Legend, fmt, clearSnapshots } from "../components/Charts.jsx";
import Worksheet from "../components/Worksheet.jsx";
import { parseFile, parseCSV, toCSV, download } from "../lib/parse.js";
import { profileAll, fillMissing, isMissing } from "../lib/prep.js";
import { analyse, silhouetteCurve } from "../lib/analysis.js";
import { silhouetteVerdict, adjustedRand } from "../lib/validation.js";
import { researchSector, buildResearchPrompt, ApiError } from "../lib/api.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const VARIABLE_SETS = {
  core: ["company_name", "country", "city", "founded_year", "employees", "annual_revenue_eur", "business_model", "primary_channel"],
  positioning: ["price_positioning", "target_customer", "product_range_breadth", "own_brand", "sustainability_claim"],
  digital: ["website", "ecommerce", "social_followers", "app", "loyalty_programme", "marketplace_presence"],
};

export default function SectorProject() {
  const [data, setData] = useState(null);   // { rows, headers, sector, geography, source }
  const [k, setK] = useState(4);

  if (!data) return <Collect onReady={setData} />;
  return <Guided data={data} k={k} setK={setK} onRestart={() => setData(null)} />;
}

/* ── Phase 1: get a dataset ── */
function Collect({ onReady }) {
  const [sector, setSector] = useState("");
  const [geography, setGeography] = useState("Spain");
  const [n, setN] = useState(25);
  const [sets, setSets] = useState(["core", "positioning"]);
  const [state, setState] = useState({ status: "idle" });
  const [showPrompt, setShowPrompt] = useState(false);
  const fileRef = useRef(null);

  const variables = sets.flatMap((s) => VARIABLE_SETS[s]);
  const prompt = buildResearchPrompt({ sector, geography, n, variables });

  async function run() {
    if (!sector.trim()) { setState({ status: "error", error: new ApiError("Describe the sector first.") }); return; }
    setState({ status: "loading" });
    try {
      const d = await researchSector({ sector, geography, n, variables, includeDemand: true });
      const rows = d.companies ?? [];
      if (!rows.length) throw new ApiError("The agent returned no companies. Try a broader sector.");
      onReady({ rows, headers: Object.keys(rows[0]), sector, geography, demand: d.demand, sources: d.sources, source: "agent" });
    } catch (e) {
      setState({ status: "error", error: e instanceof ApiError ? e : new ApiError(e.message) });
    }
  }

  async function loadFile(f) {
    setState({ status: "loading" });
    try {
      const parsed = await parseFile(f);
      if (!parsed.rows.length) throw new Error("That file has no data rows.");
      onReady({ rows: parsed.rows, headers: parsed.headers, sector: sector || f.name, geography, source: "upload" });
    } catch (e) {
      setState({ status: "error", error: new ApiError(e.message) });
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "42px 22px 80px" }}>
        <a href="#/" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← all tools</a>
        <h1 style={{ fontSize: 26, margin: "14px 0 8px", fontWeight: 600 }}>Project: build a sector dataset and segment it</h1>
        <p style={{ color: C.mut, fontSize: 13.5, lineHeight: 1.75, maxWidth: 660, margin: "0 0 20px" }}>
          Group activity. Real segmentation work does not start with a clean file — it starts with nothing. You will
          build the dataset, check it against its own sources, segment it, and recommend where to enter the market.
        </p>

        <Callout tone="info" title="Companies, not people">
          Firmographic data about companies is public and fair to compile. Building profiles of identifiable
          individuals from the web is a GDPR problem whatever the intent, and the agent will decline it. Consumer
          demand comes back in aggregate, from published research, with sources.
        </Callout>

        <Section title="1 · Choose your sector">
          <div style={{ display: "grid", gap: 13, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
            <Field label="sector" hint="Be specific. “restaurants” cannot be segmented; “poke bowl chains in Madrid” can.">
              <input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="e.g. specialty coffee roasters" style={inp} />
            </Field>
            <Field label="geography">
              <input value={geography} onChange={(e) => setGeography(e.target.value)} style={inp} />
            </Field>
            <Field label={`companies (${n})`} hint="Twenty-five is enough to cluster.">
              <input type="range" min="10" max="50" step="5" value={n} onChange={(e) => setN(+e.target.value)} style={{ width: "100%", accentColor: C.acc }} />
            </Field>
          </div>

          <div style={{ marginTop: 15 }}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
              variables to collect
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {Object.entries(VARIABLE_SETS).map(([key, vars]) => (
                <Chip key={key} active={sets.includes(key)} title={vars.join(", ")}
                  onClick={() => setSets(sets.includes(key) ? sets.filter((s) => s !== key) : [...sets, key])}>
                  {key} <span style={{ opacity: 0.6, fontSize: 10 }}>{vars.length}</span>
                </Chip>
              ))}
            </div>
            <p style={{ fontSize: 11, color: C.mut, marginTop: 8, lineHeight: 1.6 }}>
              Keep a mix: numbers to cluster on (revenue, employees, founded year) and categories that describe
              positioning. K-Prototypes needs both.
            </p>
          </div>

          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", marginTop: 17 }}>
            <button onClick={run} disabled={state.status === "loading"} style={{
              background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6,
              padding: "10px 19px", fontSize: 13, fontWeight: 600, cursor: state.status === "loading" ? "wait" : "pointer",
            }}>{state.status === "loading" ? "Researching…" : "Research this sector"}</button>
            <Chip active={showPrompt} onClick={() => setShowPrompt((v) => !v)}>{showPrompt ? "Hide" : "Show"} the prompt</Chip>
            <button onClick={() => fileRef.current?.click()} style={{
              background: C.surf, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6,
              padding: "9px 15px", fontSize: 12.5, cursor: "pointer", marginLeft: "auto",
            }}>I already have a CSV</button>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
          </div>
          {state.status === "loading" && <div style={{ marginTop: 12 }}><Spinner label="Searching the web — this takes a minute or two." /></div>}

          {showPrompt && (
            <textarea readOnly value={prompt} rows={10} style={{
              width: "100%", marginTop: 12, background: "#0d0f14", border: `1px solid ${C.bord}`, color: C.mut,
              borderRadius: 6, padding: 11, fontSize: 11.5, fontFamily: MONO, lineHeight: 1.55, resize: "vertical",
            }} />
          )}

          {state.status === "error" && (
            <Callout tone={state.error.kind === "quota" ? "warn" : "bad"}
              title={state.error.kind === "quota" ? "Daily quota reached" : "Could not complete the research"}>
              {state.error.message}
              <div style={{ marginTop: 7 }}>
                Copy the prompt above into Claude or ChatGPT with web search on, save what it returns as a CSV, and
                use <strong>I already have a CSV</strong>. The activity and the marks are identical.
              </div>
            </Callout>
          )}
        </Section>
      </div>
    </div>
  );
}

/* ── Phase 2: the guided project ── */
function Guided({ data, k, setK, onRestart }) {
  const [state, setState] = useState({ status: "loading" });

  const profiles = useMemo(() => profileAll(data.rows, data.headers), [data]);

  useEffect(() => {
    let cancelled = false;
    clearSnapshots();
    (async () => {
      await new Promise((r) => setTimeout(r, 40));
      try {
        const numCols = profiles.filter((p) => p.isNumeric && p.present >= data.rows.length * 0.5).map((p) => p.key);
        const catCols = profiles
          .filter((p) => !p.isNumeric && p.key !== "source_url" && p.distinctCount > 1 && p.distinctCount <= 8)
          .slice(0, 4).map((p) => p.key);
        if (numCols.length < 2) {
          setState({ status: "error", message: `Only ${numCols.length} numeric variable came back with enough values to cluster on. Collect a sector where revenue or headcount is published, or add more companies.` });
          return;
        }
        const cols = [...numCols, ...catCols].map((key) => profiles.find((p) => p.key === key));
        const rows = fillMissing(data.rows, cols, "median");
        const a = analyse(rows, numCols, catCols, { seed: 42, restarts: 25 });
        // The same companies clustered on numbers alone, to show what the
        // categorical variables actually contributed.
        const numericOnly = analyse(rows, numCols, [], { seed: 42, restarts: 25 });
        if (!cancelled) setState({ status: "ready", a, numericOnly, numCols, catCols, rows });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [data, profiles]);

  if (state.status === "loading")
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.txt }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "90px 22px" }}>
          <Spinner label="Clustering the companies you collected…" />
        </div>
      </div>
    );
  if (state.status === "error")
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
        <div style={{ maxWidth: 780, margin: "0 auto", padding: "70px 22px" }}>
          <Callout tone="bad" title="This dataset cannot be clustered yet">{state.message}</Callout>
          <button onClick={onRestart} style={{
            background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6,
            padding: "9px 17px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 14,
          }}>Collect again</button>
        </div>
      </div>
    );

  const ctx = { ...state, data, profiles, k, setK };

  return (
    <Worksheet
      id="project-sector"
      badge="group project · graded"
      title={`Project: ${data.sector}`}
      subtitle={`${data.rows.length} companies collected${data.source === "agent" ? " by the research agent" : " from your own file"}. From here on, everything is computed from the data you built — nobody else in the class has this dataset.`}
      steps={buildSteps(ctx)}
      ctx={ctx}
      activity="D4 — group project: build a sector dataset and segment it"
      rubric={"Collection and verification carry the most weight (methods paragraph, spot-checks against sources, honest handling of gaps). Then the segmentation and its validation, the interpretation as market structures rather than buyer personas, and the entry recommendation. A modest segmentation of a dataset that is fully accounted for scores better than an elegant one built on numbers nobody checked."}
      reportMeta={(c) => [
        ["Activity", "D4 — group project, sector dataset and segmentation"],
        ["Sector", `${c.data.sector}${c.data.geography ? ` · ${c.data.geography}` : ""}`],
        ["Source", c.data.source === "agent" ? "collected by the research agent from public web sources" : "uploaded by the group"],
        ["Collected on", new Date().toISOString().slice(0, 10)],
        ["Companies", String(c.data.rows.length)],
        ["Numeric variables", c.numCols.join(", ")],
        ["Categorical variables", c.catCols.length ? c.catCols.join(", ") : "none usable"],
        ["Missing values", "filled with the column median"],
        ["Chosen k", String(c.k)],
        ["Reproducibility", `seed ${c.a.seed}, ${c.a.restarts} restarts, z-score scaling`],
      ]}
      onRestart={onRestart}
    />
  );
}

function buildSteps({ a, numericOnly, numCols, catCols, rows, data, profiles, k, setK }) {
  const km = a.kmeans[k];
  const kp = a.kproto?.byK[k];
  const verdict = silhouetteVerdict(km.metrics.silhouette);

  const naCount = data.rows.reduce((acc, r) =>
    acc + Object.values(r).filter((v) => isMissing(v) || String(v).toUpperCase() === "NA").length, 0);
  const cells = data.rows.length * data.headers.length;
  const naShare = cells ? naCount / cells : 0;
  const withSource = data.rows.filter((r) => r.source_url).length;

  const sample = data.rows.slice(0, 5);

  return [
    {
      id: "what", title: "What you actually collected", minutes: 10,
      intro: (
        <p style={{ margin: 0 }}>
          Before anything is clustered, look at what came back. Gaps are normal and honest: revenue and headcount are
          simply not public for small private companies. A column that is mostly NA is more useful than one that is
          complete because it was invented.
        </p>
      ),
      render: () => (
        <>
          <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginBottom: 14 }}>
            <Stat label="companies" value={data.rows.length} />
            <Stat label="variables" value={data.headers.length} />
            <Stat label="with a source" value={`${withSource}/${data.rows.length}`}
              tone={withSource === data.rows.length ? "good" : "warn"} />
            <Stat label="missing values" value={`${(naShare * 100).toFixed(0)}%`}
              tone={naShare > 0.3 ? "warn" : undefined} hint="marked NA, not guessed" />
          </div>
          <Table
            head={data.headers.filter((h) => h !== "source_url").slice(0, 7)}
            rows={data.rows.slice(0, 6).map((r) =>
              data.headers.filter((h) => h !== "source_url").slice(0, 7).map((h) => String(r[h] ?? "").slice(0, 26)))}
          />
          <div style={{ marginTop: 13 }}>
            <Table head={["variable", "values present", "distinct", "usable for clustering"]}
              rows={profiles.filter((p) => p.key !== "source_url").map((p) => [
                p.key,
                `${p.present} / ${data.rows.length}`,
                p.distinctCount,
                numCols.includes(p.key)
                  ? <span style={{ color: C.good }}>numeric</span>
                  : catCols.includes(p.key)
                    ? <span style={{ color: C.acc }}>categorical</span>
                    : <span style={{ color: C.mut }}>—</span>,
              ])} />
          </div>
        </>
      ),
      questions: [
        {
          id: "d4-methods", kind: "text", minWords: 60, rows: 5,
          rubric: "Must cover all five: what was collected, from what kinds of source, on what date, the proportion missing and how it was handled, and which variables were excluded and why. This paragraph is what makes a commercial segmentation auditable and it is marked as such.",
          prompt: "Write the methods paragraph for your report. Cover: what you collected, from what kinds of source, on what date, what proportion of values are missing and how you handled them, and which variables you excluded and why.",
          placeholder: "We collected … from … on … Of the … cells, …% were unavailable and were …",
        },
        {
          id: "d4-drop", kind: "text", minWords: 25, rows: 3,
          rubric: "Names specific variables from the table above and gives a reason grounded in the coverage figures. A generic answer about 'removing incomplete data' without naming columns is weak.",
          prompt: "Looking at the coverage table, which variables would you drop before clustering, and why? Name them.",
        },
      ],
    },

    {
      id: "verify", title: "Check it against its own sources", minutes: 15,
      intro: (
        <>
          <p style={{ margin: "0 0 10px" }}>
            This step carries real marks, and it is the one groups skip. An agent that has misread a table will do so
            confidently, and a dataset nobody has spot-checked is not evidence.
          </p>
          <p style={{ margin: 0 }}>
            Open the source for at least five companies and check the figures against the page they cite.
          </p>
        </>
      ),
      render: () => (
        <>
          <Table
            head={["company", ...numCols.slice(0, 3), "source"]}
            rows={sample.map((r) => [
              <strong>{String(r[data.headers[0]] ?? "").slice(0, 30)}</strong>,
              ...numCols.slice(0, 3).map((c) => String(r[c] ?? "NA")),
              r.source_url
                ? <a href={r.source_url} target="_blank" rel="noreferrer noopener" style={{ color: C.acc, fontSize: 11.5 }}>open ↗</a>
                : <span style={{ color: C.warn, fontSize: 11.5 }}>none</span>,
            ])} />
          <Callout tone="info" title="What counts as a check">
            Not "the company exists". Does the page actually state the revenue, the headcount, the founding year that
            the row claims? If it does not, the value was inferred, and you should record that.
          </Callout>
        </>
      ),
      questions: [
        {
          id: "d4-verify", kind: "text", minWords: 60, rows: 6,
          rubric: "Must name the specific companies checked, what was verified against what, and what was found — including errors. Finding and reporting an error is the strongest possible answer here. A claim that everything was correct, with no detail about what was actually opened, is the weakest.",
          prompt: "Which rows did you check, against what, and what did you find? Name the companies. Report the errors you found — finding one is a better outcome than finding none, and it is marked that way.",
          placeholder: "We checked … against … The revenue for … was stated as … but the source says …",
        },
      ],
    },

    {
      id: "segment", title: "Segment the companies", minutes: 15,
      intro: (
        <>
          <p style={{ margin: "0 0 10px" }}>
            This data is genuinely mixed: {numCols.length} numeric variables and {catCols.length} categorical ones.
            That is what K-Prototypes exists for, and the comparison below is the same companies clustered with and
            without the categories.
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: C.mut }}>
            Expect worse indices than on the course datasets. Small n, real gaps and self-reported categories all cost
            you separation. That is what collected data is like, and saying so is part of the report.
          </p>
        </>
      ),
      capture: ["d4-sil"],
      render: () => (
        <>
          <LineOverK captureId="d4-sil" data={silhouetteCurve(a)} yKey="silhouette" yLabel="silhouette"
            selected={k} invertGood={false} label="Average silhouette against k" />
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "13px 0" }}>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.mut, textTransform: "uppercase", letterSpacing: "1px" }}>your k</span>
            {a.ks.map((v) => (
              <button key={v} onClick={() => setK(v)} style={{
                background: v === k ? C.acc : C.surf, color: v === k ? "#0d0f14" : C.txt,
                border: `1px solid ${v === k ? C.acc : C.bord}`, borderRadius: 5, padding: "5px 12px",
                fontFamily: MONO, fontSize: 12, cursor: "pointer", fontWeight: v === k ? 700 : 400,
              }}>{v}</button>
            ))}
          </div>
          <Table head={["method", "silhouette", "Davies-Bouldin", "segment sizes"]} rows={[
            ["K-Means (numbers only)", numericOnly.kmeans[k].metrics.silhouette.toFixed(3),
              numericOnly.kmeans[k].metrics.daviesBouldin.toFixed(3), numericOnly.kmeans[k].sizes.join(" · ")],
            ...(kp ? [["K-Prototypes (+ categories)", kp.metrics.silhouette.toFixed(3),
              kp.metrics.daviesBouldin.toFixed(3), kp.sizes.join(" · ")]] : []),
          ]} />
          {kp && (
            <div style={{ marginTop: 13 }}>
              <Stat label="agreement between them (ARI)" value={adjustedRand(numericOnly.kmeans[k].labels, kp.labels).toFixed(3)}
                hint="1 = identical grouping, 0 = chance" />
            </div>
          )}
        </>
      ),
      questions: [
        {
          id: "d4-cats", kind: "text", minWords: 40, rows: 4,
          rubric: "Uses the ARI between the two runs as evidence, and states what the categorical variables changed. Noting that they changed little — if that is what the number shows — is a correct answer, not a failed one.",
          prompt: kp
            ? "Did the categorical variables change the segmentation? Use the ARI between the two runs as your evidence, and say what that means for whether positioning or size drives structure in this sector."
            : "No categorical variable was usable here. Explain why that limits what this segmentation can say about positioning, and what you would collect differently.",
        },
        {
          id: "d4-quality", kind: "text", minWords: 30, rows: 4,
          rubric: "Quotes the actual silhouette value and interprets it against the Kaufman & Rousseeuw bands honestly. An answer that reports weak structure as weak scores better than one that talks around it.",
          prompt: `Your best silhouette is ${km.metrics.silhouette.toFixed(3)} (${verdict.label}). Read that honestly against the bands in section 9 of the technical note. How much weight can your conclusions carry?`,
        },
      ],
    },

    {
      id: "structures", title: "Read the segments as market structures", minutes: 12,
      intro: (
        <p style={{ margin: 0 }}>
          These are companies, not consumers, so what you are describing is <strong>market structure</strong>, not
          buyer personas: "established multi-site operators with own-brand ranges", not "Health-Conscious Hannah".
        </p>
      ),
      capture: ["d4-scatter"],
      render: () => (
        <>
          <div style={{ marginBottom: 12 }}><Legend k={k} sizes={km.sizes} /></div>
          <CentroidTable centroids={km.centroids} numCols={numCols} catCols={catCols}
            sizes={km.sizes} total={a.n} silhouettePerCluster={km.metrics.silhouettePerCluster} />
          {numCols.length >= 2 && (
            <div style={{ marginTop: 16 }}>
              <Scatter captureId="d4-scatter" points={a.numRaw.map((r) => [r[0], r[1]])} labels={km.labels}
                centroids={km.centroids.map((c) => [c[numCols[0]], c[numCols[1]]])}
                xLabel={numCols[0]} yLabel={numCols[1]}
                rowNames={rows.map((r) => String(r[data.headers[0]] ?? ""))} height={290} />
            </div>
          )}
        </>
      ),
      questions: [
        {
          id: "d4-structures", kind: "text", minWords: 90, rows: 8,
          rubric: "One named structure per segment, each justified with quoted centroid values, described as a type of competitor rather than as a consumer persona. Declining to name a segment that is too small or too weak is a creditable judgement.",
          prompt: `Describe each of your ${k} segments as a market structure: a short name, and two or three sentences quoting the centroid values that justify it. If a segment is too small or too weak to name, say so instead of inventing one.`,
          placeholder: "Segment 1 — “…”\n…",
        },
      ],
    },

    {
      id: "enter", title: "Where would you enter this market?", minutes: 10,
      intro: (
        <p style={{ margin: 0 }}>
          The question that makes this a marketing exercise rather than a clustering exercise.
        </p>
      ),
      render: () => (
        <Table head={["segment", "companies", "share of the sector", "silhouette"]}
          rows={km.sizes.map((s, i) => [
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 9, height: 9, background: clusterStyle(i).color, borderRadius: "50%", display: "inline-block" }} />
              Segment {i + 1}
            </span>,
            s, `${((s / a.n) * 100).toFixed(0)}%`, km.metrics.silhouettePerCluster[i].toFixed(3),
          ])} />
      ),
      questions: [
        {
          id: "d4-entry", kind: "text", minWords: 60, rows: 6,
          rubric: "Names one segment, argues from its size and its centroid characteristics, and explains what the entrant would offer that the incumbents in that segment do not. An answer that names a segment without saying what the competitive opening is has not finished the argument.",
          prompt: "If you were entering this sector, which segment would you attack and which would you avoid? Argue from the segment sizes and their characteristics, and say what an entrant would offer that the companies already in that segment do not.",
        },
        {
          id: "d4-limits", kind: "text", minWords: 35, rows: 4,
          rubric: "States specific limitations of THIS dataset — sample size, missing values, sources, the weak indices — and what would be needed to strengthen the conclusion. Generic caveats that could apply to any study are weak.",
          prompt: "What would you not claim from this analysis, and what would you need to collect in order to claim more? Be specific to your dataset, not generic.",
        },
      ],
    },
  ];
}
