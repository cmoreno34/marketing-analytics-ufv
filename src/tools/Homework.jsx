/* Homework — the guided version of activity C4.
 *
 * The deliverable C4 asks for is a comparison of several algorithms on one
 * customer base, reconciled, with a defended choice and buyer personas. That
 * is a lot of structure for a student to hold in their head while also
 * learning the methods, and the usual failure is a report that presents four
 * results and never reconciles them.
 *
 * So the structure is the tool: each step runs one method, asks what it found,
 * and the last steps force the reconciliation and the decision. What comes out
 * is a report with the parameters needed to reproduce every number in it. */

import { useState, useEffect, useMemo, useRef } from "react";
import { C, card, inp, clusterStyle } from "../theme.js";
import { Section, Callout, Stat, Table, CentroidTable, Field, Chip, Spinner } from "../components/UI.jsx";
import { LineOverK, Scatter, Dendrogram, SilhouettePlot, KDistance, Legend, fmt, clearSnapshots } from "../components/Charts.jsx";
import Worksheet from "../components/Worksheet.jsx";
import { parseFile, parseCSV } from "../lib/parse.js";
import { profileAll, fillMissing, dropMissing, toNum } from "../lib/prep.js";
import { analyse, silhouetteCurve, dbCurve } from "../lib/analysis.js";
import { silhouetteVerdict, adjustedRand } from "../lib/validation.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export default function Homework() {
  const [setup, setSetup] = useState(null);   // { rows, numCols, catCols, name, missing }
  const [k, setK] = useState(4);

  if (!setup) return <Setup onReady={setSetup} />;
  return <Guided setup={setup} k={k} setK={setK} onRestart={() => setSetup(null)} />;
}

/* ── Phase 1: data and variables ── */
function Setup({ onReady }) {
  const [raw, setRaw] = useState(null);
  const [name, setName] = useState("");
  const [numSel, setNumSel] = useState([]);
  const [catSel, setCatSel] = useState([]);
  const [missing, setMissing] = useState("mean");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const profiles = useMemo(() => (raw ? profileAll(raw.rows, raw.headers) : []), [raw]);
  const numeric = profiles.filter((p) => p.isNumeric);
  const categorical = profiles.filter((p) => !p.isNumeric && p.distinctCount <= 25);

  function apply(parsed, label) {
    setRaw(parsed); setName(label); setErr("");
    const prof = profileAll(parsed.rows, parsed.headers);
    const nums = prof.filter((p) => p.isNumeric && !isIndexLike(p, parsed.rows));
    setNumSel(nums.slice(0, 6).map((p) => p.key));
    setCatSel(prof.filter((p) => !p.isNumeric && p.distinctCount > 1 && p.distinctCount <= 8).slice(0, 2).map((p) => p.key));
  }

  async function loadSample() {
    setBusy(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/marketing_campaign.csv`);
      apply(parseCSV(await res.text()), "marketing_campaign.csv");
    } catch { setErr("Could not load the sample."); }
    setBusy(false);
  }

  async function loadFile(f) {
    setBusy(true);
    try { apply(await parseFile(f), f.name); }
    catch (e) { setErr(e.message || "Could not read that file."); }
    setBusy(false);
  }

  const toggle = (list, set, key) =>
    set(list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);

  function start() {
    const cols = [...numSel, ...catSel].map((key) => profiles.find((p) => p.key === key)).filter(Boolean);
    const rows = missing === "drop" ? dropMissing(raw.rows, cols) : fillMissing(raw.rows, cols, missing);
    if (rows.length < 20) { setErr("Fewer than 20 usable rows are left. Choose different variables or a different way of handling missing values."); return; }
    onReady({ rows, numCols: numSel, catCols: catSel, name, missing, dropped: raw.rows.length - rows.length, originalRows: raw.rows.length });
  }

  const ready = raw && numSel.length >= 3;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "42px 22px 80px" }}>
        <a href="#/" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← all tools</a>
        <h1 style={{ fontSize: 26, margin: "14px 0 8px", fontWeight: 600 }}>Homework: segment a customer base</h1>
        <p style={{ color: C.mut, fontSize: 13.5, lineHeight: 1.75, maxWidth: 660, margin: "0 0 24px" }}>
          Group activity. You will run four algorithms on the same customers, reconcile what they say, choose one and
          defend it, and write the buyer personas. The tool keeps the structure so you can concentrate on the
          judgement; at the end it produces the report you hand in.
        </p>

        <Section title="1 · Your data" note={raw ? `${name} — ${raw.rows.length} rows, ${raw.headers.length} columns` : "The course dataset, or your own if your group collected one."}>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <Chip onClick={loadSample}>Marketing campaign (2 240) — the course dataset</Chip>
            <button onClick={() => fileRef.current?.click()} style={{
              background: C.surf, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 5,
              padding: "5px 10px", fontSize: 11.5, cursor: "pointer",
            }}>Upload your own CSV / Excel</button>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
          </div>
          {busy && <div style={{ marginTop: 11 }}><Spinner label="Reading…" /></div>}
          {err && <Callout tone="bad" title="Problem">{err}</Callout>}
        </Section>

        {raw && (
          <Section title="2 · Choose your variables"
            note="This is the first decision you will have to defend. Numeric variables drive the distance; categorical ones are what makes K-Prototypes worth running. Do not include a customer ID.">
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
              numeric — {numSel.length} selected {numSel.length < 3 && <span style={{ color: C.warn }}>(choose at least 3)</span>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
              {numeric.map((p) => (
                <Chip key={p.key} active={numSel.includes(p.key)} onClick={() => toggle(numSel, setNumSel, p.key)}
                  title={`${p.distinctCount} distinct values, ${p.missing} missing`}>{p.key}</Chip>
              ))}
            </div>

            {categorical.length > 0 && (
              <>
                <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
                  categorical — {catSel.length} selected
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
                  {categorical.map((p) => (
                    <Chip key={p.key} active={catSel.includes(p.key)} onClick={() => toggle(catSel, setCatSel, p.key)}
                      title={`${p.distinctCount} categories`}>
                      {p.key} <span style={{ opacity: 0.6, fontSize: 10 }}>{p.distinctCount}</span>
                    </Chip>
                  ))}
                </div>
              </>
            )}

            <div style={{ maxWidth: 300 }}>
              <Field label="missing values" hint="Whatever you choose here, you will be asked to justify it.">
                <select value={missing} onChange={(e) => setMissing(e.target.value)} style={inp}>
                  <option value="mean">Fill numeric with the mean</option>
                  <option value="median">Fill numeric with the median</option>
                  <option value="drop">Drop the row</option>
                </select>
              </Field>
            </div>

            {catSel.length === 0 && (
              <Callout tone="warn">
                With no categorical variables selected, K-Prototypes cannot run and you will have three methods to
                compare instead of four. That is allowed, but the deliverable asks you to say why.
              </Callout>
            )}

            <button onClick={start} disabled={!ready} style={{
              background: ready ? C.acc : C.card, color: ready ? "#0d0f14" : C.mut,
              border: `1px solid ${ready ? C.acc : C.bord}`, borderRadius: 6, marginTop: 16,
              padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: ready ? "pointer" : "not-allowed",
            }}>Run the analysis →</button>
          </Section>
        )}
      </div>
    </div>
  );
}

function isIndexLike(p, rows) {
  if (p.distinctCount !== rows.length || rows.length < 3) return false;
  if (/(^|[_\s.-])(id|n|no|num|number|code|key|index)$/i.test(p.key.trim())) return true;
  const vals = rows.map((r) => toNum(r[p.key]));
  if (!vals.every((v) => Number.isInteger(v))) return false;
  const sorted = [...vals].sort((a, b) => a - b);
  return sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
}

/* ── Phase 2: the guided analysis ── */
function Guided({ setup, k, setK, onRestart }) {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    clearSnapshots();
    setState({ status: "loading" });
    (async () => {
      await new Promise((r) => setTimeout(r, 40));  // let the spinner paint
      try {
        const a = analyse(setup.rows, setup.numCols, setup.catCols, { seed: 42, restarts: 25 });
        if (!cancelled) setState({ status: "ready", a });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [setup]);

  if (state.status === "loading")
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "90px 22px" }}>
          <Spinner label={`Running four algorithms across k = 2 to 8 on ${setup.rows.length} rows — a few seconds.`} />
        </div>
      </div>
    );
  if (state.status === "error")
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, padding: 60 }}>
        <Callout tone="bad" title="The analysis failed">{state.message}</Callout>
      </div>
    );

  const { a } = state;
  const ctx = { a, setup, k, setK };

  return (
    <Worksheet
      id="homework-c4"
      badge="homework · group"
      title="Homework: segment a customer base"
      subtitle={`${setup.name} — ${a.n} rows, ${a.numCols.length} numeric and ${a.catCols.length} categorical variables. Every number below comes from your own selection, so your report is yours and not a copy of anyone else's.`}
      steps={buildSteps(ctx)}
      ctx={ctx}
      activity="C4 — group homework: segment a customer base"
      rubric={"Variable selection and data preparation with reasoning (1.5) · correct use of the four methods and their parameters (2) · validation, choosing k with evidence and reporting quality honestly (2) · RECONCILIATION: where methods agree, where they do not, what was chosen and what rejected (2.5, the highest weight) · personas grounded in centroid values plus concrete actions (1.5) · stating the limitations of the analysis (0.5)."}
      reportMeta={(c) => [
        ["Activity", "C4 — group homework, segmentation and buyer persona"],
        ["Dataset", `${c.setup.name} — ${c.a.n} rows used of ${c.setup.originalRows}`],
        ["Numeric variables", c.a.numCols.join(", ")],
        ["Categorical variables", c.a.catCols.length ? c.a.catCols.join(", ") : "none"],
        ["Missing values", c.setup.missing === "drop" ? `rows dropped (${c.setup.dropped})` : `filled with the ${c.setup.missing}`],
        ["Scaling", "z-score (standardised)"],
        ["Chosen k", String(c.k)],
        ["Reproducibility", `seed ${c.a.seed}, ${c.a.restarts} restarts; Ward linkage; DBSCAN eps ${c.a.dbscan.eps}, minPts ${c.a.dbscan.minPts}${c.a.kproto ? `; K-Prototypes gamma ${c.a.kproto.gamma}` : ""}`],
        ...(c.a.sampleSize ? [["Note", `silhouette estimated on a fixed random sample of ${c.a.sampleSize} rows (as scikit-learn does above ~1000 rows)`]] : []),
      ]}
      onRestart={onRestart}
    />
  );
}

function KPicker({ k, setK, ks }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "13px 0" }}>
      <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.mut, textTransform: "uppercase", letterSpacing: "1px" }}>your k</span>
      {ks.map((v) => (
        <button key={v} onClick={() => setK(v)} style={{
          background: v === k ? C.acc : C.surf, color: v === k ? "#0d0f14" : C.txt,
          border: `1px solid ${v === k ? C.acc : C.bord}`, borderRadius: 5, padding: "5px 12px",
          fontFamily: MONO, fontSize: 12, cursor: "pointer", fontWeight: v === k ? 700 : 400,
        }}>{v}</button>
      ))}
    </div>
  );
}

function buildSteps({ a, setup, k, setK }) {
  const km = a.kmeans[k];
  const ward = a.ward?.byK[k];
  const kp = a.kproto?.byK[k];
  const db = a.dbscan;
  const verdict = silhouetteVerdict(km.metrics.silhouette);

  const methods = [
    { id: "kmeans", label: "K-Means", res: km, k },
    ...(kp ? [{ id: "kproto", label: "K-Prototypes", res: kp, k }] : []),
    ...(ward ? [{ id: "ward", label: `Hierarchical (Ward)`, res: ward, k }] : []),
    { id: "dbscan", label: "DBSCAN", res: { metrics: db.metrics, sizes: db.counts }, k: db.nClusters },
  ];

  return [
    {
      id: "vars", title: "The choices you have already made", minutes: 8,
      intro: (
        <p style={{ margin: 0 }}>
          Before any result, the decisions. You chose {a.numCols.length} numeric and {a.catCols.length} categorical
          variables, and {setup.missing === "drop" ? `dropped ${setup.dropped} rows with missing values` : `filled missing values with the ${setup.missing}`}.
          Every number that follows depends on these, so they belong in the report and they have to be defended.
        </p>
      ),
      render: () => (
        <Table head={["role", "variables"]} rows={[
          ["numeric", a.numCols.join(", ")],
          ["categorical", a.catCols.length ? a.catCols.join(", ") : "none selected"],
          ["rows used", `${a.n} of ${setup.originalRows}`],
          ["scaling", "z-score — every variable contributes on the same footing"],
        ]} />
      ),
      questions: [
        {
          id: "why-vars", kind: "text", rubric: "Explains what the chosen variables capture about customer behaviour AND names at least one variable deliberately excluded, with a reason. Listing the variables without reasoning is weak.", minWords: 40, rows: 4,
          prompt: "Why these variables? Explain what you expect them to capture about customer behaviour, and name at least one variable you deliberately left out and why.",
          placeholder: "We chose … because … We excluded … because …",
        },
        {
          id: "why-missing", kind: "text", rubric: "Justifies the choice and says what would have changed under a different one. 'We used the mean' with no consequence stated is incomplete.", minWords: 20, rows: 3,
          prompt: "Justify how you handled missing values. What would have changed if you had chosen differently?",
        },
      ],
    },

    {
      id: "kmeans", title: "K-Means, and how many segments this market has", minutes: 12,
      intro: (
        <>
          <p style={{ margin: "0 0 10px" }}>
            The elbow always falls, so it can only show where improvement slows. Use the silhouette and
            Davies-Bouldin to choose, then pick your k below — everything after this step follows your choice.
          </p>
          {a.sampleSize > 0 && (
            <p style={{ margin: 0, fontSize: 12.5, color: C.mut }}>
              With {a.n} rows the silhouette is estimated on a fixed random sample of {a.sampleSize}, which is what
              scikit-learn does at this size. Report it as an estimate.
            </p>
          )}
        </>
      ),
      capture: ["h-elbow", "h-sil"],
      render: () => (
        <>
          <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit,minmax(285px,1fr))" }}>
            <LineOverK captureId="h-elbow" data={a.elbow} yKey="wcss" yLabel="WCSS" selected={k} label="Elbow" />
            <LineOverK captureId="h-sil" data={silhouetteCurve(a)} yKey="silhouette" yLabel="silhouette"
              selected={k} invertGood={false} label="Average silhouette (higher is better)" />
            <LineOverK data={dbCurve(a)} yKey="daviesBouldin" yLabel="Davies-Bouldin" selected={k} invertGood
              label="Davies-Bouldin (lower is better)" />
          </div>
          <KPicker k={k} setK={setK} ks={a.ks} />
          <div style={{ display: "flex", gap: 11, flexWrap: "wrap" }}>
            <Stat label={`silhouette at k=${k}`} value={km.metrics.silhouette.toFixed(3)} hint={verdict.label}
              tone={verdict.tone === "good" ? "good" : verdict.tone === "warn" ? "warn" : "bad"} />
            <Stat label="Davies-Bouldin" value={km.metrics.daviesBouldin.toFixed(3)} hint="lower is better" />
            <Stat label="Calinski-Harabasz" value={fmt(km.metrics.calinskiHarabasz)} hint="higher is better" />
            <Stat label="segment sizes" value={km.sizes.join(" · ")} />
          </div>
        </>
      ),
      questions: [
        {
          id: "best-sil-k", kind: "number", tol: 0, answer: a.bestK.silhouette,
          prompt: "At which k is the average silhouette highest on your variables?",
          hint: "The best point is circled on the silhouette chart.",
        },
        {
          id: "justify-k", kind: "text", rubric: "Cites at least two of the three indices by value, and states explicitly what was done when they disagreed with each other or with the silhouette optimum. A commercial choice against the arithmetic is fine if argued.", minWords: 45, rows: 4,
          prompt: "You have chosen a k. Justify it using at least two of the three indices, and say explicitly what you did if they disagreed with each other or with the value the silhouette prefers. A choice made on commercial grounds against the arithmetic is acceptable — but it has to be argued.",
        },
      ],
    },

    ...(kp ? [{
      id: "kproto", title: "K-Prototypes: what the categorical variables add", minutes: 10,
      intro: (
        <p style={{ margin: 0 }}>
          K-Means could only see your numeric variables. K-Prototypes adds the categorical ones, weighted by
          gamma = {a.kproto.gamma}, which is Huang's rule of thumb — about half the mean standard deviation of the
          standardised numeric variables. The comparison below is the same customers, the same k, with and without
          the categories.
        </p>
      ),
      render: () => (
        <>
          <Table head={["method", "silhouette", "Davies-Bouldin", "segment sizes"]} rows={[
            ["K-Means (numeric only)", km.metrics.silhouette.toFixed(3), km.metrics.daviesBouldin.toFixed(3), km.sizes.join(" · ")],
            ["K-Prototypes (+ categories)", kp.metrics.silhouette.toFixed(3), kp.metrics.daviesBouldin.toFixed(3), kp.sizes.join(" · ")],
          ]} />
          <div style={{ margin: "14px 0" }}>
            <Stat label="agreement (ARI)" value={adjustedRand(km.labels, kp.labels).toFixed(3)}
              hint="1 = identical grouping, 0 = chance" />
          </div>
          <CentroidTable centroids={kp.centroids} numCols={a.numCols} catCols={a.catCols}
            sizes={kp.sizes} total={a.n} silhouettePerCluster={kp.metrics.silhouettePerCluster} />
          <Callout tone="info" title="Read the validation indices carefully here">
            The three indices are defined on a metric space and are computed on the numeric part of the distance
            only. They say nothing about whether the categorical variables contributed. To find that out, look at the
            mode columns above: a category that is the same in every segment added nothing, whatever gamma was set to.
          </Callout>
        </>
      ),
      questions: [{
        id: "kproto-effect", kind: "text", rubric: "Uses the ARI between K-Means and K-Prototypes as evidence, and reads the mode columns of the centroid table. Noting that a category takes the same value in every segment is a finding, not a failure.", minWords: 40, rows: 4,
        prompt: "Did the categorical variables change the segmentation? Use the ARI between the two methods and the mode columns in the centroid table as evidence. If a category takes the same value in every segment, say so — that is a finding, not a failure.",
      }],
    }] : []),

    ...(ward ? [{
      id: "ward", title: "Hierarchical clustering: a tree instead of an answer", minutes: 10,
      intro: (
        <p style={{ margin: 0 }}>
          Ward never asked for k. It merged the closest pair over and over, and the height of each merge records how
          different the two groups were. The largest jump is the most defensible place to cut.
        </p>
      ),
      capture: ["h-dendro"],
      render: () => (
        <>
          {a.n <= 400
            ? <Dendrogram captureId="h-dendro" layout={a.ward.layout} n={a.n} labels={ward.labels} height={320} />
            : <Callout tone="info">
                With {a.n} rows the dendrogram is too dense to read leaf by leaf, so the merge-distance table below is
                the practical way to use it. Open the Segmentation Lab if you want to see the tree itself.
              </Callout>}
          <div style={{ marginTop: 14 }}>
            <Table head={["cut to k", "merge at", "next merge at", "jump"]}
              rows={a.ward.gaps.slice(0, 5).map((g) => [
                <strong>{g.k}</strong>, g.from.toFixed(3), g.to.toFixed(3),
                <span style={{ color: C.acc }}>+{g.gap.toFixed(3)}</span>,
              ])} />
          </div>
          <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginTop: 14 }}>
            <Stat label={`Ward silhouette at k=${k}`} value={ward.metrics.silhouette.toFixed(3)} />
            <Stat label="sizes" value={ward.sizes.join(" · ")} />
            <Stat label="agreement with k-means" value={a.ari(k).toFixed(3)}
              tone={a.ari(k) >= 0.7 ? "good" : a.ari(k) >= 0.4 ? "warn" : "bad"} />
          </div>
        </>
      ),
      questions: [
        {
          id: "ward-gap", kind: "number", tol: 0, answer: a.ward.gaps[0].k,
          prompt: "Cutting to how many clusters comes just before the biggest jump in merge distance?",
          hint: "The largest value in the jump column.",
          why: a.ward.gaps[0].k === k
            ? "The tree agrees with the k you chose, from a different principle entirely."
            : "The tree prefers a different k from the one you chose. Say so in your report and explain which you followed.",
        },
        {
          id: "ward-vs-km", kind: "text", rubric: "Compares indices, segment sizes and the ARI by value, and draws a conclusion about the structure of the data rather than just listing the differences.", minWords: 35, rows: 4,
          prompt: "Compare the Ward and K-Means results at your k: the indices, the segment sizes and the agreement between them. What does the comparison tell you about the structure of this customer base?",
        },
      ],
    }] : []),

    {
      id: "dbscan", title: "DBSCAN: density, and the customers nobody wants to segment", minutes: 8,
      intro: (
        <p style={{ margin: 0 }}>
          DBSCAN chooses its own number of clusters and is allowed to say that a customer belongs to none of them.
          Parameters come from the knee of the k-distance curve: eps = {db.eps}, minPts = {db.minPts}.
        </p>
      ),
      capture: ["h-kdist"],
      render: () => (
        <>
          <KDistance captureId="h-kdist" values={db.kdist} eps={db.eps} height={190} />
          <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginTop: 14 }}>
            <Stat label="clusters found" value={db.nClusters} tone={db.nClusters <= 1 ? "warn" : undefined} />
            <Stat label="noise" value={db.noise} hint={`${((db.noise / a.n) * 100).toFixed(1)}% unassigned`} />
            <Stat label="sizes" value={db.counts.join(" · ") || "—"} />
          </div>
          {db.nClusters <= 1 && (
            <Callout tone="warn" title="No density structure at this dimensionality">
              With {a.numCols.length} variables the distances between customers concentrate and no region is
              meaningfully denser than another. This is the curse of dimensionality. It is a finding about the data,
              and it belongs in the report rather than being quietly omitted.
            </Callout>
          )}
        </>
      ),
      questions: [{
        id: "dbscan-read", kind: "text", rubric: "If DBSCAN found nothing: explains that k-means partitions any cloud whether or not it is separated, and states the consequence for how strongly the segments can be claimed. If it found clusters: says who the noise customers might be commercially and whether to exclude or investigate them.", minWords: 35, rows: 4,
        prompt: db.nClusters <= 1
          ? "DBSCAN found no density structure while the other methods returned segments. Explain how both can be true at once, and say what it means for how strongly you can claim your segments are real."
          : `DBSCAN found ${db.nClusters} clusters and labelled ${db.noise} customers as noise. Who might those customers be in a real business, and would you exclude them or investigate them? Justify it.`,
      }],
    },

    {
      id: "reconcile", title: "Reconciliation: which answer do you take forward?", minutes: 12,
      intro: (
        <>
          <p style={{ margin: "0 0 10px" }}>
            This is the step the deliverable is really about. Four results are not four findings — they are one
            finding once you have explained where they agree, where they do not, and which one you are backing.
          </p>
          <p style={{ margin: 0 }}>
            Where two methods built on different principles agree, the structure is probably real. Where they
            disagree, the reason is usually identifiable and worth a sentence.
          </p>
        </>
      ),
      render: () => (
        <>
          <Table head={["method", "k", "silhouette", "Davies-Bouldin", "sizes"]}
            rows={methods.map((m) => [
              <strong>{m.label}</strong>, m.k,
              m.res.metrics ? m.res.metrics.silhouette.toFixed(3) : "—",
              m.res.metrics ? m.res.metrics.daviesBouldin.toFixed(3) : "—",
              (m.res.sizes || []).join(" · ") || "—",
            ])} />
          <div style={{ marginTop: 16 }}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 8 }}>
              adjusted rand index between every pair
            </div>
            <AriMatrix methods={methods.filter((m) => m.res.labels || m.id === "dbscan")} a={a} k={k} />
          </div>
        </>
      ),
      questions: [
        {
          id: "chosen-method", kind: "choice",
          prompt: "Which result are you taking forward as your segmentation? There is no correct answer here — the mark is for the justification below.",
          options: methods.map((m) => `${m.label} with ${m.k} segment${m.k === 1 ? "" : "s"}`),
        },
        {
          id: "reconcile-text", kind: "text", rubric: "Must cover all four: where methods agreed with ARI values quoted; where they disagreed and a plausible reason; which was chosen and on what grounds; what was rejected and why. This is the highest-weighted answer in the activity — a paragraph that lists results without reconciling them is the failure to catch.", minWords: 70, rows: 6,
          prompt: "Write the reconciliation paragraph. Cover: where the methods agreed and what the ARI values were; where they disagreed and why you think so; which you chose and on what grounds; and what you rejected and why. This paragraph carries more marks than any other answer in this activity.",
        },
      ],
    },

    {
      id: "personas", title: "From centroids to buyer personas", minutes: 12,
      intro: (
        <p style={{ margin: 0 }}>
          The centroid table for K-Means at k = {k}, in the original units. This is the buyer persona in quantitative
          form. Write the prose version yourself: quote the values that justify each claim, and do not invent
          attributes the data does not contain.
        </p>
      ),
      capture: ["h-scatter", "h-silplot"],
      render: () => (
        <>
          <div style={{ marginBottom: 12 }}><Legend k={k} sizes={km.sizes} /></div>
          <CentroidTable centroids={km.centroids} numCols={a.numCols} catCols={a.catCols}
            sizes={km.sizes} total={a.n} silhouettePerCluster={km.metrics.silhouettePerCluster} />
          <div style={{ marginTop: 16 }}>
            <Scatter captureId="h-scatter" points={a.numRaw.map((r) => [r[0], r[1]])} labels={km.labels}
              centroids={km.centroids.map((c) => [c[a.numCols[0]], c[a.numCols[1]]])}
              xLabel={a.numCols[0]} yLabel={a.numCols[1]} height={290} />
          </div>
          <div style={{ marginTop: 16 }}>
            <SilhouettePlot captureId="h-silplot" perPoint={km.metrics.silhouettePerPoint}
              labels={km.labels} k={k} mean={km.metrics.silhouette} height={250} />
          </div>
        </>
      ),
      questions: [
        {
          id: "personas-text", kind: "text", rubric: "One persona per segment with a name, a description built from the quoted centroid values, and a confidence statement. Declining to write a persona for a segment that is too small or too weak is a correct and creditable judgement.", minWords: 120, rows: 10,
          prompt: `Write a buyer persona for each of your ${k} segments. For each: a short memorable name, three or four sentences describing who they are with the centroid values that justify it, and how confident you are. If one of your segments is too weak or too small to deserve a persona, say so instead of writing one — that judgement earns marks.`,
          placeholder: "Segment 1 — “…”\n…\n\nSegment 2 — “…”\n…",
        },
      ],
    },

    {
      id: "actions", title: "What the business should do about it", minutes: 10,
      intro: (
        <p style={{ margin: 0 }}>
          A segmentation nobody can act on is an academic exercise. Close it with decisions: which segments are worth
          money, which are not, and what specifically to do.
        </p>
      ),
      render: () => (
        <Table head={["segment", "size", "share of base", "silhouette"]}
          rows={km.sizes.map((s, i) => [
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 9, height: 9, background: clusterStyle(i).color, borderRadius: "50%", display: "inline-block" }} />
              Segment {i + 1}
            </span>,
            s, `${((s / a.n) * 100).toFixed(1)}%`,
            km.metrics.silhouettePerCluster[i].toFixed(3),
          ])} />
      ),
      questions: [
        {
          id: "actions-text", kind: "text", rubric: "Each action must be concrete enough to brief on Monday — a channel, an offer, a message. Phrases like 'target them with personalised communication' are exactly what to flag as too vague.", minWords: 80, rows: 7,
          prompt: "One concrete marketing action per segment. Concrete means something a manager could brief on Monday — a channel, an offer, a message — not “target them with personalised communication”.",
        },
        {
          id: "target", kind: "text", rubric: "Chooses one segment and argues from size, coherence and commercial logic, not only from the validation indices.", minWords: 40, rows: 4,
          prompt: "If the budget only covered one segment, which would you take and why? Use size, coherence and commercial logic, not just the validation indices.",
        },
        {
          id: "limits", kind: "text", rubric: "States honestly what cannot be claimed from this analysis and what would be needed to claim more. Admitting weak structure where the indices show weak structure is the strong answer.", minWords: 35, rows: 4,
          prompt: "State the limitations of this analysis honestly: what would you not claim from it, and what would you need in order to claim more? An answer that admits weak structure where the indices show weak structure scores better than one that does not.",
        },
      ],
    },
  ];
}

function AriMatrix({ methods, a, k }) {
  const labelled = methods
    .map((m) => ({ ...m, labels: m.id === "dbscan" ? a.dbscan.labels : m.res.labels }))
    .filter((m) => m.labels);
  return (
    <Table
      head={["", ...labelled.map((m) => m.id)]}
      rows={labelled.map((r) => [
        <strong>{r.id}</strong>,
        ...labelled.map((c) => {
          if (r.id === c.id) return <span style={{ color: C.mut }}>—</span>;
          const v = adjustedRand(r.labels, c.labels);
          return <span style={{ color: v >= 0.7 ? C.good : v >= 0.4 ? C.warn : C.bad }}>{v.toFixed(2)}</span>;
        }),
      ])}
    />
  );
}
