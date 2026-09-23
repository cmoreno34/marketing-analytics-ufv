/* Activity D1 — segment a customer base, then defend the targeting decision.
 *
 * Two tabs. The first is a general clustering tool: it preloads nothing, so
 * the student has to open a file, work out which columns describe a customer
 * and set the parameters, exactly as they would with data nobody had prepared
 * for them. That is deliberate — a tool that only works on the one dataset the
 * lecturer loaded teaches nothing about doing this at work, and this one runs
 * on any file with a header row.
 *
 * The second tab carries the case: it shows back what their own run produced
 * and asks five questions that can only be answered from it.
 *
 * What survives a page reload is the *summary* of the run — parameters,
 * centroids, indices, sizes — not the uploaded rows. Two thousand customers do
 * not belong in localStorage, and the summary is what the questions and the
 * report actually need.
 */

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { C, inp, card, clusterStyle } from "../theme.js";
import { Section, Callout, Stat, Table, CentroidTable, Field, Chip, Spinner } from "../components/UI.jsx";
import { LineOverK, Scatter, Dendrogram, SilhouettePlot, Legend, fmt, snapshot, clearSnapshots } from "../components/Charts.jsx";
import { AnswerFeedback, ReviewPanel, wordCount } from "../components/Feedback.jsx";
import { parseFile } from "../lib/parse.js";
import { profileAll, fillMissing, dropMissing, toNum } from "../lib/prep.js";
import { analyse, silhouetteCurve, dbCurve } from "../lib/analysis.js";
import { silhouetteVerdict, adjustedRand } from "../lib/validation.js";
import { reportShell, answerBlock, table as tableHtml, figure as figureHtml, openForPrint, downloadHtml, slug } from "../lib/report.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const KEY = "mkt.d1";
const ACTIVITY = "D1 — segment a customer base and justify the targeting";

const RUBRIC =
  "Choosing k with evidence and saying what was done when the indices disagreed (2) · describing each segment from " +
  "its own centroid values without inventing attributes (2) · the sub-segment analysis and whether it changes the " +
  "decision (2) · a targeting decision argued from size, value and reachability rather than from the indices alone " +
  "(2.5) · what would be done differently per segment, and an honest statement of what the analysis cannot claim (1.5).";

const QUESTIONS = [
  {
    id: "q1",
    title: "How many segments does this customer base have?",
    prompt: "State the number of segments you settled on and justify it. Quote the elbow, the average silhouette, the Davies-Bouldin index and the biggest gap in the dendrogram, by value. If they disagreed — they usually do — say which you followed and why.",
    rubric: "Must quote at least two indices by value and state explicitly what was done when they disagreed. A number with no evidence, or evidence with no decision, is incomplete. A commercial tie-break against the arithmetic is fine if it is argued.",
    minWords: 60,
  },
  {
    id: "q2",
    title: "What are those segments, and what separates them?",
    prompt: "Give each segment a short name and describe it in two or three sentences, quoting the centroid values that justify the description. Then say which two or three variables do most of the separating, and which turned out not to matter.",
    rubric: "One name plus a description per segment, each grounded in quoted centroid values. Inventing attributes the data does not contain (lifestyle, motivation, brand preference) is the main failure to catch. Naming the variables that did NOT separate is worth credit — it is the half students skip.",
    minWords: 90,
  },
  {
    id: "q3",
    title: "What is inside your segments?",
    prompt: "Pick the segment you consider most important and report what happened when you clustered inside it: how many subgroups, how big, and how they differ from each other. Does that sub-structure change how you would treat the segment, or is it noise?",
    rubric: "Must report the sub-clustering actually run — number of subgroups, sizes, and what distinguishes them — and then make a judgement. Concluding that the sub-structure is weak and should be ignored is a correct answer when the silhouette supports it.",
    minWords: 60,
  },
  {
    id: "q4",
    title: "Which segments would you target, and which would you not?",
    prompt: "Choose the segments the company should put its budget behind and the ones it should not. Argue from the data: how many customers, how much they spend, how reachable they are through the channels in the file, and how they responded to past campaigns. Validation indices alone are not an answer to this question.",
    rubric: "Must name specific segments on both sides and argue from size, value, channel reachability and campaign response — quoting figures from their own centroid table. An answer that reasons only from the silhouette has answered a different question.",
    minWords: 80,
  },
  {
    id: "q5",
    title: "What would you actually do, and what can you not claim?",
    prompt: "For each segment you would target, say what you would do differently — channel, offer, message — concrete enough to brief on Monday. Then state honestly what this analysis does not let you claim, and what you would need in order to claim it.",
    rubric: "Each action must name a channel, an offer or a message; 'personalised communication' is exactly the vagueness to flag. The limitations must be specific to this dataset — two years of history, no cost or margin data, no control group — not generic caveats.",
    minWords: 70,
  },
];

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const save = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private window */ } };

export default function CaseStudy() {
  const [store, setStore] = useState(load);
  const [tab, setTab] = useState("tool");
  const answers = store.answers || {};
  const identity = store.identity || { name: "", group: "" };
  const snap = store.snapshot || null;

  useEffect(() => { save(store); }, [store]);
  useEffect(() => { clearSnapshots(); }, []);

  const setAnswer = useCallback((id, v) =>
    setStore((s) => ({ ...s, answers: { ...(s.answers || {}), [id]: v } })), []);
  const setIdentity = useCallback((patch) =>
    setStore((s) => ({ ...s, identity: { name: "", group: "", ...(s.identity || {}), ...patch } })), []);
  const setFeedback = useCallback((fb) => setStore((s) => ({ ...s, feedback: fb })), []);
  const setSnapshot = useCallback((sn) => setStore((s) => ({ ...s, snapshot: sn })), []);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <style>{`::-webkit-scrollbar{width:7px;height:7px;background:transparent}::-webkit-scrollbar-thumb{background:#252836;border-radius:4px}`}</style>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "30px 22px 90px" }}>
        <a href="#/" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← all tools</a>

        <div style={{ display: "flex", alignItems: "baseline", gap: 11, margin: "12px 0 6px", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 24, margin: 0, fontWeight: 600 }}>Segment a customer base</h1>
          <span style={{
            fontFamily: MONO, fontSize: 10, color: C.acc, border: `1px solid ${C.acc}66`,
            borderRadius: 4, padding: "3px 8px", letterSpacing: ".08em", textTransform: "uppercase",
          }}>activity D1 · group · graded</span>
        </div>
        <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.7, maxWidth: 700, margin: "0 0 18px" }}>
          Nothing is loaded for you. Open the customer file, decide which columns describe a customer, run the methods,
          and then answer five questions about what you found — the same way you would with data nobody had prepared.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          <TabButton active={tab === "tool"} onClick={() => setTab("tool")}
            n="1" label="Analysis tool" hint="upload, choose variables, run" />
          <TabButton active={tab === "case"} onClick={() => setTab("case")}
            n="2" label="Case study" hint={snap ? "your results and the five questions" : "run the analysis first"} />
        </div>

        {tab === "tool"
          ? <ToolTab snap={snap} setSnapshot={setSnapshot} goToCase={() => { setTab("case"); window.scrollTo(0, 0); }} />
          : <CaseTab snap={snap} answers={answers} setAnswer={setAnswer} identity={identity}
              setIdentity={setIdentity} feedback={store.feedback} setFeedback={setFeedback}
              goToTool={() => { setTab("tool"); window.scrollTo(0, 0); }} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, n, label, hint }) {
  return (
    <button onClick={onClick} style={{
      background: active ? C.card : "transparent", border: `1px solid ${active ? C.acc : C.bord}`,
      borderRadius: 8, padding: "10px 16px", cursor: "pointer", textAlign: "left", minWidth: 200,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 19, height: 19, borderRadius: "50%", background: active ? C.acc : C.bord,
          color: active ? "#0d0f14" : C.mut, fontSize: 11, fontWeight: 700, fontFamily: MONO,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>{n}</span>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: active ? C.txt : C.mut }}>{label}</span>
      </div>
      <div style={{ fontSize: 11, color: C.mut, marginTop: 4, marginLeft: 27 }}>{hint}</div>
    </button>
  );
}

/* ───────────────────────────── Tab 1 — the tool ───────────────────────────── */

function ToolTab({ snap, setSnapshot, goToCase }) {
  const [raw, setRaw] = useState(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [numSel, setNumSel] = useState([]);
  const [catSel, setCatSel] = useState([]);
  const [missing, setMissing] = useState("median");
  const [scaling, setScaling] = useState("z");
  const [k, setK] = useState(4);
  const [seed, setSeed] = useState(42);
  const [restarts, setRestarts] = useState(25);
  const [linkMethod, setLinkMethod] = useState("ward");

  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [view, setView] = useState("k");
  const [xVar, setXVar] = useState(0);
  const [yVar, setYVar] = useState(1);

  const [subSeg, setSubSeg] = useState(0);
  const [subK, setSubK] = useState(2);
  const [sub, setSub] = useState(null);
  const [subBusy, setSubBusy] = useState(false);

  const fileRef = useRef(null);
  const profiles = useMemo(() => (raw ? profileAll(raw.rows, raw.headers) : []), [raw]);
  const numericCols = useMemo(() => profiles.filter((p) => p.isNumeric), [profiles]);
  const catCols = useMemo(() => profiles.filter((p) => !p.isNumeric), [profiles]);

  async function open(f, sheet) {
    setLoading(true); setErr("");
    try {
      const parsed = await parseFile(f, sheet);
      if (!parsed.rows.length) throw new Error("That sheet has no data rows. Try another one.");
      setRaw(parsed);
      setFile(f);
      setRes(null); setSub(null);
      const prof = profileAll(parsed.rows, parsed.headers);
      const nums = prof.filter((p) => p.isNumeric && !isIdentifier(p, parsed.rows));
      // Nothing is pre-selected: choosing the variables is the first marked
      // decision of the activity, and a default would make it for them.
      setNumSel([]); setCatSel([]);
      setXVar(0); setYVar(Math.min(1, Math.max(0, nums.length - 1)));
    } catch (e) { setErr(e.message || "Could not read that file."); }
    setLoading(false);
  }

  const toggle = (list, set, key) =>
    set(list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);

  const prepared = useMemo(() => {
    if (!raw || numSel.length < 2) return null;
    const cols = [...numSel, ...catSel].map((key) => profiles.find((p) => p.key === key)).filter(Boolean);
    const rows = missing === "drop" ? dropMissing(raw.rows, cols) : fillMissing(raw.rows, cols, missing);
    return rows.length >= 10 ? rows : null;
  }, [raw, numSel, catSel, missing, profiles]);

  const run = useCallback(() => {
    if (!prepared) return;
    setBusy(true); setSub(null);
    setTimeout(() => {
      try {
        const a = analyse(prepared, numSel, catSel, { seed, restarts, scaling, skipDbscan: true });
        setRes(a); setErr("");
        setView("k");
      } catch (e) { setErr(e.message || "The analysis failed on this data."); setRes(null); }
      setBusy(false);
    }, 20);
  }, [prepared, numSel, catSel, seed, restarts, scaling]);

  /* Sub-clustering: the same machinery, run again on the members of one
   * segment. This is what "what is inside this group" actually means, and it
   * is the step that turns a flat partition into something a marketing team
   * can act on differently within a segment. */
  const runSub = useCallback(() => {
    if (!res) return;
    setSubBusy(true);
    setTimeout(() => {
      try {
        const members = res.rows.filter((_, i) => res.kmeans[k].labels[i] === subSeg);
        if (members.length < 20) throw new Error(`Segment ${subSeg + 1} holds ${members.length} customers — too few to split further.`);
        const a = analyse(members, numSel, catSel, { seed, restarts: Math.min(restarts, 15), scaling, skipDbscan: true });
        setSub({ segment: subSeg, n: members.length, a });
      } catch (e) { setSub({ error: e.message }); }
      setSubBusy(false);
    }, 20);
  }, [res, k, subSeg, numSel, catSel, seed, restarts, scaling]);

  const canRun = raw && numSel.length >= 2;

  function sendToCase() {
    if (!res) return;
    const km = res.kmeans[k];
    const kp = res.kproto?.byK[k];
    const w = res.ward?.byK[k];
    setSnapshot({
      at: new Date().toISOString(),
      file: file?.name ?? "uploaded file",
      sheet: raw?.sheetName ?? null,
      n: res.n, rowsBefore: raw.rows.length,
      numCols: numSel, catCols: catSel, missing, scaling, seed, restarts, k, linkMethod,
      curve: res.ks.map((kk) => ({
        k: kk,
        wcss: res.elbow.find((e) => e.k === kk)?.wcss ?? null,
        silhouette: res.kmeans[kk].metrics.silhouette,
        db: res.kmeans[kk].metrics.daviesBouldin,
        ch: res.kmeans[kk].metrics.calinskiHarabasz,
      })),
      bestK: res.bestK,
      kmeans: {
        sizes: km.sizes, centroids: km.centroids,
        silhouette: km.metrics.silhouette, db: km.metrics.daviesBouldin, ch: km.metrics.calinskiHarabasz,
        perCluster: km.metrics.silhouettePerCluster,
      },
      kproto: kp ? {
        gamma: res.kproto.gamma, sizes: kp.sizes, centroids: kp.centroids,
        silhouette: kp.metrics.silhouette, db: kp.metrics.daviesBouldin,
        ari: adjustedRand(km.labels, kp.labels),
      } : null,
      ward: w ? {
        sizes: w.sizes, silhouette: w.metrics.silhouette, db: w.metrics.daviesBouldin,
        gaps: res.ward.gaps.slice(0, 4), ari: adjustedRand(km.labels, w.labels),
      } : null,
      sub: sub && !sub.error ? {
        segment: sub.segment + 1, n: sub.n, k: subK,
        sizes: sub.a.kmeans[subK].sizes,
        centroids: sub.a.kmeans[subK].centroids,
        silhouette: sub.a.kmeans[subK].metrics.silhouette,
      } : null,
      figures: {
        indices: snapshot("d1-indices"),
        scatter: snapshot("d1-scatter"),
        silhouette: snapshot("d1-sil"),
        dendrogram: snapshot("d1-dendro"),
        sub: snapshot("d1-sub"),
      },
    });
    goToCase();
  }

  return (
    <>
      <Section title="1 · Open the customer file"
        note={raw
          ? `${file?.name}${raw.sheetName ? ` · sheet “${raw.sheetName}”` : ""} — ${raw.rows.length} rows, ${raw.headers.length} columns`
          : "Download the workbook from Canvas, read its Data dictionary sheet, then open it here. Nothing is preloaded: this tool works on any file with a header row, which is the point."}>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => fileRef.current?.click()} style={{
            background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6,
            padding: "9px 17px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
          }}>{raw ? "Open a different file" : "Open CSV or Excel"}</button>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm" style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && open(e.target.files[0])} />
          {/* A download, not a preload: the file still has to be opened by hand,
              which is the step that makes this transfer to any other dataset. */}
          <a href={`${import.meta.env.BASE_URL}data/customer_base.xlsx`} download style={{
            background: C.surf, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6,
            padding: "9px 15px", fontSize: 12.5, textDecoration: "none",
          }}>Download the workbook</a>
          {raw?.sheetNames?.length > 1 && (
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: C.mut }}>
              sheet
              <select value={raw.sheetName} onChange={(e) => open(file, e.target.value)}
                style={{ ...inp, width: "auto", minWidth: 150 }}>
                {raw.sheetNames.map((n) => (
                  <option key={n} value={n}>{n} ({raw.sheetRowCounts?.[n] ?? 0} rows)</option>
                ))}
              </select>
            </label>
          )}
          {loading && <Spinner label="Reading…" />}
        </div>
        {err && <Callout tone="bad" title="Problem">{err}</Callout>}
        {raw?.sheetNames?.length > 1 && (
          <Callout tone="info">
            This workbook has {raw.sheetNames.length} sheets and the tool opened the longest one. The other sheet is the
            data dictionary — read it before you choose variables.
          </Callout>
        )}
        {raw && (
          <div style={{ marginTop: 13 }}>
            <Table head={raw.headers.slice(0, 8)}
              rows={raw.rows.slice(0, 4).map((r) => raw.headers.slice(0, 8).map((h) => String(r[h] ?? "").slice(0, 20)))}
              maxHeight={190} />
          </div>
        )}
      </Section>

      {raw && (
        <Section title="2 · Choose the variables"
          note="Nothing is selected for you. What a customer IS, for this analysis, is the first decision you make and the one every number afterwards depends on — it is marked in question 2.">
          <VarPicker label={`numeric (${numSel.length} selected)`} cols={numericCols} sel={numSel}
            onToggle={(k) => toggle(numSel, setNumSel, k)} rows={raw.rows} />
          {catCols.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <VarPicker label={`categorical (${catSel.length} selected — K-Prototypes only)`} cols={catCols}
                sel={catSel} onToggle={(k) => toggle(catSel, setCatSel, k)} rows={raw.rows} categorical />
            </div>
          )}
          {numSel.some((key) => numericCols.find((p) => p.key === key)?.distinctCount <= 3) && (
            <Callout tone="info">
              Some selected columns take only two or three values — the campaign flags, for instance. They are usable,
              but on standardised data a 0/1 column swings as hard as income does. Say in your report whether you meant
              that.
            </Callout>
          )}
          <div style={{ display: "grid", gap: 13, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", marginTop: 15 }}>
            <Field label="missing values" hint={`${raw.rows.length - (prepared?.length ?? raw.rows.length)} rows affected by your choice`}>
              <select value={missing} onChange={(e) => setMissing(e.target.value)} style={inp}>
                <option value="median">Fill numeric with the median</option>
                <option value="mean">Fill numeric with the mean</option>
                <option value="mode">Fill with the most frequent value</option>
                <option value="drop">Drop the row</option>
              </select>
            </Field>
            <Field label="scaling" hint={scaling === "none" ? "Without scaling the widest-ranging variable decides every segment." : "z-scores put every variable on the same footing."}>
              <select value={scaling} onChange={(e) => setScaling(e.target.value)} style={inp}>
                <option value="z">Standardise (z-score)</option>
                <option value="minmax">Min–max to [0,1]</option>
                <option value="none">None (not recommended)</option>
              </select>
            </Field>
          </div>
        </Section>
      )}

      {raw && (
        <Section title="3 · Run the methods"
          note="K-Means, K-Prototypes and hierarchical clustering on the same variables, scored with the elbow, the average silhouette and Davies-Bouldin.">
          <div style={{ display: "grid", gap: 13, gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", marginBottom: 15 }}>
            <Field label={`segments (k = ${k})`} hint="Change it and re-run: the indices below tell you whether it was a good choice.">
              <input type="range" min="2" max="8" value={k} onChange={(e) => setK(+e.target.value)} style={{ width: "100%", accentColor: C.acc }} />
            </Field>
            <Field label="random seed" hint="Same seed, same segments. Quote it in your report.">
              <input type="number" value={seed} onChange={(e) => setSeed(+e.target.value || 0)} style={inp} />
            </Field>
            <Field label="restarts" hint="Keeps the lowest-cost run out of this many.">
              <input type="number" min="1" max="100" value={restarts}
                onChange={(e) => setRestarts(Math.max(1, +e.target.value || 1))} style={inp} />
            </Field>
            <Field label="linkage" hint="For the hierarchical run.">
              <select value={linkMethod} onChange={(e) => setLinkMethod(e.target.value)} style={inp}>
                <option value="ward">Ward</option>
              </select>
            </Field>
          </div>
          <div style={{ display: "flex", gap: 11, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={run} disabled={!canRun || busy} style={{
              background: canRun ? C.acc : C.card, color: canRun ? "#0d0f14" : C.mut,
              border: `1px solid ${canRun ? C.acc : C.bord}`, borderRadius: 6,
              padding: "9px 19px", fontSize: 13, fontWeight: 600, cursor: canRun && !busy ? "pointer" : "not-allowed",
            }}>{busy ? "Running…" : res ? "Run again" : "Run"}</button>
            {busy && <Spinner label="Clustering — a few seconds on two thousand customers." />}
            {!canRun && <span style={{ fontSize: 12, color: C.warn }}>Select at least two numeric variables.</span>}
          </div>
        </Section>
      )}

      {res && (
        <Results res={res} k={k} numSel={numSel} catSel={catSel} view={view} setView={setView}
          xVar={xVar} yVar={yVar} setXVar={setXVar} setYVar={setYVar}
          subSeg={subSeg} setSubSeg={setSubSeg} subK={subK} setSubK={setSubK}
          sub={sub} subBusy={subBusy} runSub={runSub} sendToCase={sendToCase} snap={snap} />
      )}
    </>
  );
}

function VarPicker({ label, cols, sel, onToggle, rows, categorical }) {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
        {label}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {cols.slice(0, 40).map((p) => {
          const tooMany = categorical && p.distinctCount > 12;
          const idish = !categorical && isIdentifier(p, rows);
          return (
            <Chip key={p.key} active={sel.includes(p.key)} onClick={() => onToggle(p.key)} disabled={tooMany}
              title={tooMany ? `${p.distinctCount} distinct values — too many to be a useful category`
                : idish ? "Looks like a row identifier, not a measurement"
                : `${p.distinctCount} distinct · ${p.missing} missing`}>
              {p.key}
              {idish && <span style={{ opacity: 0.55, marginLeft: 5, fontSize: 10 }}>id?</span>}
              {p.missing > 0 && <span style={{ opacity: 0.55, marginLeft: 5, fontSize: 10 }}>{p.missing} missing</span>}
              {categorical && <span style={{ opacity: 0.55, marginLeft: 5, fontSize: 10 }}>{p.distinctCount}</span>}
            </Chip>
          );
        })}
      </div>
    </div>
  );
}

/* A column is a key, not a measurement, when every value is distinct and it is
 * either named like an id or a consecutive integer run. Clustering on a
 * customer number produces beautiful, meaningless segments. */
function isIdentifier(profile, rows) {
  if (profile.distinctCount !== rows.length || rows.length < 3) return false;
  if (/(^|[_\s.-])(id|n|no|num|number|code|key|index)$/i.test(profile.key.trim())) return true;
  const vals = rows.map((r) => toNum(r[profile.key]));
  if (!vals.every((v) => Number.isInteger(v))) return false;
  const sorted = [...vals].sort((a, b) => a - b);
  return sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
}

function Results({ res, k, numSel, catSel, view, setView, xVar, yVar, setXVar, setYVar,
                   subSeg, setSubSeg, subK, setSubK, sub, subBusy, runSub, sendToCase, snap }) {
  const km = res.kmeans[k];
  const kp = res.kproto?.byK[k];
  const w = res.ward?.byK[k];
  const verdict = silhouetteVerdict(km.metrics.silhouette);
  const views = [
    ["k", "Choosing k"],
    ["kmeans", "K-Means"],
    ...(kp ? [["kproto", "K-Prototypes"]] : []),
    ...(w ? [["hier", "Hierarchical"]] : []),
    ["sub", "Inside a segment"],
  ];

  return (
    <>
      <Section title="4 · Results"
        right={<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {views.map(([id, label]) => (
            <Chip key={id} active={view === id} onClick={() => setView(id)}>{label}</Chip>
          ))}
        </div>}>
        <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginBottom: 16 }}>
          <Stat label="segments" value={k} hint={`${res.n} customers`} />
          <Stat label="silhouette" value={km.metrics.silhouette.toFixed(3)} hint={verdict.label}
            tone={verdict.tone === "good" ? "good" : verdict.tone === "warn" ? "warn" : "bad"} />
          <Stat label="Davies-Bouldin" value={km.metrics.daviesBouldin.toFixed(3)} hint="lower is better" />
          <Stat label="Calinski-Harabasz" value={fmt(km.metrics.calinskiHarabasz)} hint="higher is better" />
          {res.sampleSize > 0 && <Stat label="silhouette on" value={`${res.sampleSize} of ${res.n}`} hint="sampled, for speed" />}
        </div>

        {view === "k" && <ChoosingK res={res} k={k} />}
        {view === "kmeans" && <KMeansView res={res} km={km} k={k} numSel={numSel} catSel={catSel}
          xVar={xVar} yVar={yVar} setXVar={setXVar} setYVar={setYVar} />}
        {view === "kproto" && kp && <KProtoView res={res} kp={kp} km={km} k={k} numSel={numSel} catSel={catSel} />}
        {view === "hier" && w && <HierView res={res} w={w} km={km} k={k} numSel={numSel} catSel={catSel} />}
        {view === "sub" && <SubView res={res} k={k} km={km} numSel={numSel} catSel={catSel}
          subSeg={subSeg} setSubSeg={setSubSeg} subK={subK} setSubK={setSubK}
          sub={sub} subBusy={subBusy} runSub={runSub} />}
      </Section>

      <Section title="5 · Take these results to the case study"
        note="This copies your parameters, your centroid table, your indices and the charts into tab 2, where the five questions are. Run it again whenever you change the analysis.">
        <div style={{ display: "flex", gap: 11, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={sendToCase} style={{
            background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6,
            padding: "10px 19px", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>Send these results to the case study →</button>
          {snap && (
            <span style={{ fontSize: 12, color: C.mut }}>
              Last sent {new Date(snap.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
              {" · "}k = {snap.k}, {snap.numCols.length} variables
            </span>
          )}
        </div>
        {!sub && (
          <Callout tone="warn" title="Question 3 needs the sub-segment analysis">
            Open <strong>Inside a segment</strong> above and run it before you send. Without it you cannot answer what
            is inside your segments, which is worth 2 of the 10 marks.
          </Callout>
        )}
      </Section>
    </>
  );
}

function ChoosingK({ res, k }) {
  const chCurveData = res.ks.map((kk) => ({ k: kk, ch: res.kmeans[kk].metrics.calinskiHarabasz }));
  return (
    <>
      <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
        <LineOverK captureId="d1-indices" data={res.elbow} yKey="wcss" yLabel="WCSS" selected={k}
          label="Elbow — within-cluster sum of squares" />
        <LineOverK data={silhouetteCurve(res)} yKey="silhouette" yLabel="silhouette" selected={k}
          invertGood={false} label="Average silhouette (higher is better)" />
        <LineOverK data={dbCurve(res)} yKey="daviesBouldin" yLabel="Davies-Bouldin" selected={k}
          invertGood label="Davies-Bouldin (lower is better)" />
      </div>
      <div style={{ marginTop: 16 }}>
        <Table head={["k", "WCSS", "silhouette", "Davies-Bouldin", "Calinski-Harabasz", "segment sizes"]}
          rows={res.ks.map((kk) => {
            const m = res.kmeans[kk].metrics;
            const sel = kk === k;
            const cell = (v) => sel ? <strong style={{ color: C.acc }}>{v}</strong> : v;
            return [
              cell(kk),
              cell(fmt(res.elbow.find((e) => e.k === kk)?.wcss ?? 0)),
              cell(m.silhouette.toFixed(3)),
              cell(m.daviesBouldin.toFixed(3)),
              cell(fmt(m.calinskiHarabasz)),
              cell(res.kmeans[kk].sizes.join(" · ")),
            ];
          })} />
      </div>
      <Callout tone="info" title="Reading this table is question 1">
        The elbow only ever falls, so it can show where the gain slows but never whether the split is any good. The
        silhouette and Davies-Bouldin can. Where they disagree, the segment sizes and the business decide — and your
        report has to say which you followed.
      </Callout>
    </>
  );
}

function KMeansView({ res, km, k, numSel, catSel, xVar, yVar, setXVar, setYVar }) {
  return (
    <>
      <div style={{ marginBottom: 12 }}><Legend k={k} sizes={km.sizes} /></div>
      <CentroidTable centroids={km.centroids} numCols={numSel} catCols={catSel}
        sizes={km.sizes} total={res.n} silhouettePerCluster={km.metrics.silhouettePerCluster} />
      <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, marginTop: 9 }}>
        Numeric values are cluster means in the original units; categorical values are the most frequent category.
        This table is your answer to question 2 — read down each column for what is extreme, then across each row for
        what kind of customer that combination describes.
      </p>

      <div style={{ display: "grid", gap: 13, gridTemplateColumns: "1fr 1fr", margin: "18px 0 11px", maxWidth: 440 }}>
        <Field label="x axis">
          <select value={xVar} onChange={(e) => setXVar(+e.target.value)} style={inp}>
            {numSel.map((c, i) => <option key={c} value={i}>{c}</option>)}
          </select>
        </Field>
        <Field label="y axis">
          <select value={yVar} onChange={(e) => setYVar(+e.target.value)} style={inp}>
            {numSel.map((c, i) => <option key={c} value={i}>{c}</option>)}
          </select>
        </Field>
      </div>
      <Scatter captureId="d1-scatter" points={res.numRaw.map((r) => [r[xVar] ?? 0, r[yVar] ?? 0])}
        labels={km.labels} centroids={km.centroids.map((c) => [c[numSel[xVar]], c[numSel[yVar]]])}
        xLabel={numSel[xVar]} yLabel={numSel[yVar]} height={320} />
      <div style={{ marginTop: 18 }}>
        <SilhouettePlot captureId="d1-sil" perPoint={km.metrics.silhouettePerPoint}
          labels={km.labels} k={k} mean={km.metrics.silhouette} height={280} />
      </div>
    </>
  );
}

function KProtoView({ res, kp, km, k, numSel, catSel }) {
  const ari = adjustedRand(km.labels, kp.labels);
  return (
    <>
      <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginBottom: 15 }}>
        <Stat label="gamma" value={res.kproto.gamma} hint="weight of a category mismatch" />
        <Stat label="silhouette" value={kp.metrics.silhouette.toFixed(3)} hint="numeric part only" />
        <Stat label="agreement with K-Means" value={ari.toFixed(3)}
          hint="1 = same grouping, 0 = chance"
          tone={ari >= 0.7 ? "good" : ari >= 0.4 ? "warn" : "bad"} />
      </div>
      <div style={{ marginBottom: 12 }}><Legend k={k} sizes={kp.sizes} /></div>
      <CentroidTable centroids={kp.centroids} numCols={numSel} catCols={catSel}
        sizes={kp.sizes} total={res.n} silhouettePerCluster={kp.metrics.silhouettePerCluster} />
      <Callout tone="info" title="What did the categories buy you?">
        The Adjusted Rand Index above compares this partition with the K-Means one on the same customers. Close to 1
        means the categorical variables changed almost nothing and the structure is driven by the numbers; a low value
        means they matter. Either answer is a finding — reporting it is question 2.
      </Callout>
      {catSel.length === 0 && (
        <Callout tone="warn">No categorical variable was selected, so K-Prototypes reduces to K-Means here.</Callout>
      )}
    </>
  );
}

function HierView({ res, w, km, k, numSel, catSel }) {
  const ari = adjustedRand(km.labels, w.labels);
  const big = res.n > 300;
  return (
    <>
      <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginBottom: 15 }}>
        <Stat label="silhouette" value={w.metrics.silhouette.toFixed(3)} />
        <Stat label="Davies-Bouldin" value={w.metrics.daviesBouldin.toFixed(3)} hint="lower is better" />
        <Stat label="agreement with K-Means" value={ari.toFixed(3)}
          tone={ari >= 0.7 ? "good" : ari >= 0.4 ? "warn" : "bad"} hint="Adjusted Rand Index" />
      </div>
      <Dendrogram captureId="d1-dendro" layout={res.ward.layout} n={res.n}
        cutHeight={cutHeight(res.ward.Z, k)} labels={w.labels} leafNames={null} height={300} />
      {big && (
        <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, marginTop: 9 }}>
          With {res.n} customers the individual leaves are not readable — what you are looking at is the shape: where
          the tree splits early, and how balanced the branches are. Names become readable in the per-segment tree
          under <strong>Inside a segment</strong>.
        </p>
      )}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
          biggest jumps in merge distance
        </div>
        <Table head={["cut to k", "merge at", "next merge at", "jump"]}
          rows={res.ward.gaps.slice(0, 5).map((g) => [
            <strong>{g.k}</strong>, g.from.toFixed(3), g.to.toFixed(3),
            <span style={{ color: C.acc }}>+{g.gap.toFixed(3)}</span>,
          ])} />
        <p style={{ fontSize: 11.5, color: C.mut, marginTop: 8, lineHeight: 1.6 }}>
          The largest jump is the most defensible place to cut: merging past it joins two genuinely different groups.
          Whether it agrees with your silhouette is question 1.
        </p>
      </div>
    </>
  );
}

function cutHeight(Z, k) {
  if (!Z?.length || k < 2) return null;
  const hi = Z[Z.length - k + 1]?.[2];
  const lo = Z[Z.length - k]?.[2];
  return hi != null && lo != null ? (hi + lo) / 2 : null;
}

function SubView({ res, k, km, numSel, catSel, subSeg, setSubSeg, subK, setSubK, sub, subBusy, runSub }) {
  return (
    <>
      <p style={{ fontSize: 13, color: C.txt, opacity: 0.9, lineHeight: 1.7, margin: "0 0 14px" }}>
        A segment is rarely uniform. Pick one and cluster its members again, on the same variables: if the subgroups
        are real, the segment is two businesses wearing one name, and treating them alike wastes budget on both.
      </p>
      <div style={{ display: "grid", gap: 13, gridTemplateColumns: "repeat(auto-fit,minmax(175px,1fr))", marginBottom: 14 }}>
        <Field label="segment to open">
          <select value={subSeg} onChange={(e) => setSubSeg(+e.target.value)} style={inp}>
            {km.sizes.map((s, i) => (
              <option key={i} value={i}>Segment {i + 1} — {s} customers</option>
            ))}
          </select>
        </Field>
        <Field label={`subgroups (k = ${subK})`} hint="Two or three is usually all a segment can carry.">
          <input type="range" min="2" max="5" value={subK} onChange={(e) => setSubK(+e.target.value)}
            style={{ width: "100%", accentColor: C.acc }} />
        </Field>
      </div>
      <button onClick={runSub} disabled={subBusy} style={{
        background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6,
        padding: "9px 17px", fontSize: 12.5, fontWeight: 600, cursor: subBusy ? "wait" : "pointer",
      }}>{subBusy ? "Running…" : `Cluster inside segment ${subSeg + 1}`}</button>
      {subBusy && <div style={{ marginTop: 11 }}><Spinner label="Clustering the members of that segment…" /></div>}

      {sub?.error && <Callout tone="warn" title="Cannot split that segment">{sub.error}</Callout>}

      {sub && !sub.error && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginBottom: 14 }}>
            <Stat label="opened" value={`segment ${sub.segment + 1}`} hint={`${sub.n} customers`} />
            <Stat label="subgroups" value={subK} hint={sub.a.kmeans[subK].sizes.join(" · ")} />
            <Stat label="silhouette inside" value={sub.a.kmeans[subK].metrics.silhouette.toFixed(3)}
              hint={silhouetteVerdict(sub.a.kmeans[subK].metrics.silhouette).label}
              tone={silhouetteVerdict(sub.a.kmeans[subK].metrics.silhouette).tone === "good" ? "good" : "warn"} />
          </div>
          <CentroidTable centroids={sub.a.kmeans[subK].centroids} numCols={numSel} catCols={catSel}
            sizes={sub.a.kmeans[subK].sizes} total={sub.n}
            silhouettePerCluster={sub.a.kmeans[subK].metrics.silhouettePerCluster} />
          {sub.a.ward && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
                the same customers as a tree
              </div>
              <Dendrogram captureId="d1-sub" layout={sub.a.ward.layout} n={sub.n}
                cutHeight={cutHeight(sub.a.ward.Z, subK)} labels={sub.a.ward.byK[subK].labels}
                leafNames={null} height={250} />
            </div>
          )}
          <Callout tone={sub.a.kmeans[subK].metrics.silhouette < 0.26 ? "warn" : "info"}
            title={sub.a.kmeans[subK].metrics.silhouette < 0.26 ? "Weak sub-structure — and that is an answer" : "Read this before question 3"}>
            {sub.a.kmeans[subK].metrics.silhouette < 0.26
              ? "The silhouette inside this segment is below 0.26, so the subgroups are a division of a continuous cloud rather than real sub-markets. Saying so, and treating the segment as one, is a better answer than inventing two personas."
              : "Compare these sub-centroids with the parent segment's row in the K-Means table. What distinguishes the subgroups from each other, and is that difference worth a different campaign?"}
          </Callout>
        </div>
      )}
    </>
  );
}

/* ───────────────────────────── Tab 2 — the case ───────────────────────────── */

function CaseTab({ snap, answers, setAnswer, identity, setIdentity, feedback, setFeedback, goToTool }) {
  if (!snap) {
    return (
      <Section title="Nothing to discuss yet">
        <Callout tone="info" title="Run the analysis first">
          The five questions below are about <em>your</em> results, so there is nothing to show until you have some.
          Go to the analysis tool, open the customer file, choose your variables, run the methods and the
          sub-segment analysis, then press <strong>Send these results to the case study</strong>.
        </Callout>
        <button onClick={goToTool} style={{
          background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6,
          padding: "9px 17px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginTop: 6,
        }}>← Go to the analysis tool</button>
      </Section>
    );
  }

  const written = QUESTIONS.map((q) => ({
    id: q.id, prompt: q.prompt, rubric: q.rubric, answer: answers[q.id] || "",
  }));
  const context = metaRows(snap);
  const done = written.filter((w) => wordCount(w.answer) >= 20).length;

  function buildAndOpen(download) {
    const html = buildReport(snap, answers, identity, feedback);
    if (download) { downloadHtml(`D1_${slug(identity.name || "report")}.html`, html); return; }
    if (!openForPrint(html)) {
      downloadHtml(`D1_${slug(identity.name || "report")}.html`, html);
    }
  }

  return (
    <>
      <Section title="The case"
        note="A retailer with two years of history on its customer file and a marketing budget that has to be split. Nobody has ever asked whether these customers are one market or several.">
        <p style={{ fontSize: 13.5, color: C.txt, opacity: 0.92, lineHeight: 1.75, margin: 0 }}>
          You have just answered that question with data. What follows is what your own run produced — read it, then
          use it to make and defend a targeting decision. Every question below is marked on whether the numbers in
          front of you support what you write.
        </p>
      </Section>

      <Section title="What your analysis produced"
        note="Generated from your run. If you change the analysis, send the results again and this updates."
        right={<button onClick={goToTool} style={{
          background: C.surf, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6,
          padding: "6px 12px", fontSize: 11.5, cursor: "pointer",
        }}>← back to the tool</button>}>
        <ResultsSummary snap={snap} />
      </Section>

      <Section title="The five questions"
        note={`${done} of 5 answered. Your written answers are what carries the marks — the tool has already done the arithmetic.`}>
        {QUESTIONS.map((q, i) => (
          <div key={q.id} style={{ marginBottom: 26 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 6 }}>
              <span style={{
                width: 21, height: 21, borderRadius: "50%", background: C.surf, border: `1px solid ${C.acc}`,
                color: C.acc, fontSize: 11, fontWeight: 700, fontFamily: MONO,
                display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>{i + 1}</span>
              <strong style={{ fontSize: 14.5, color: C.txt }}>{q.title}</strong>
            </div>
            <p style={{ fontSize: 13, color: C.mut, lineHeight: 1.7, margin: "0 0 9px", paddingLeft: 30 }}>{q.prompt}</p>
            <div style={{ paddingLeft: 30 }}>
              <textarea value={answers[q.id] || ""} onChange={(e) => setAnswer(q.id, e.target.value)} rows={7}
                placeholder="Your answer…"
                style={{
                  width: "100%", background: C.surf, border: `1px solid ${C.bord}`, color: C.txt,
                  borderRadius: 6, padding: "10px 12px", fontSize: 13, fontFamily: "system-ui",
                  lineHeight: 1.65, resize: "vertical", outline: "none",
                }} />
              <div style={{ display: "flex", gap: 10, marginTop: 5, fontSize: 11, color: C.mut }}>
                <span>{wordCount(answers[q.id])} words</span>
                <span style={{ color: wordCount(answers[q.id]) >= q.minWords ? C.good : C.mut }}>
                  about {q.minWords} expected
                </span>
              </div>
              <AnswerFeedback fb={feedback?.items?.[q.id]} />
            </div>
          </div>
        ))}
      </Section>

      <Section title="Check your answers before you hand in">
        <ReviewPanel written={written} context={context} rubric={RUBRIC} activity={ACTIVITY}
          feedback={feedback} setFeedback={setFeedback}
          intro="Claude reads your five answers against the results your own run produced, so an answer that contradicts your own numbers gets caught before I see it. It is feedback and an indicative mark, not your grade — I mark the work. Improve the answer and run it again." />
      </Section>

      <Section title="Generate the report you hand in"
        note="A printable page with your parameters, your results, the charts and your five answers. Print it to PDF and upload that to Canvas.">
        <div style={{ display: "grid", gap: 13, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", marginBottom: 15, maxWidth: 560 }}>
          <Field label="names" hint="Everyone in the group.">
            <input value={identity.name} onChange={(e) => setIdentity({ name: e.target.value })}
              placeholder="e.g. A. García, L. Pérez, M. Ruiz" style={inp} />
          </Field>
          <Field label="group">
            <input value={identity.group} onChange={(e) => setIdentity({ group: e.target.value })}
              placeholder="e.g. Group 4" style={inp} />
          </Field>
        </div>
        <div style={{ display: "flex", gap: 11, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => buildAndOpen(false)} style={{
            background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6,
            padding: "10px 19px", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>Open the report and print to PDF</button>
          <button onClick={() => buildAndOpen(true)} style={{
            background: C.surf, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6,
            padding: "9px 16px", fontSize: 12.5, cursor: "pointer",
          }}>Download it instead</button>
        </div>
        {done < 5 && (
          <Callout tone="warn" title={`${5 - done} question${done === 4 ? "" : "s"} still short`}>
            You can generate the report anyway — unanswered questions are marked as such in it, which is exactly what I
            will see.
          </Callout>
        )}
        <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.65, marginTop: 12 }}>
          In the print dialogue choose <strong>Save as PDF</strong> as the destination. Your answers are saved in this
          browser as you type, so you can close the tab and come back — but download the report before you finish.
        </p>
      </Section>
    </>
  );
}

function ResultsSummary({ snap }) {
  const v = silhouetteVerdict(snap.kmeans.silhouette);
  return (
    <>
      <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginBottom: 15 }}>
        <Stat label="customers" value={snap.n} hint={snap.file} />
        <Stat label="segments" value={snap.k} hint={`sizes ${snap.kmeans.sizes.join(" · ")}`} />
        <Stat label="silhouette" value={snap.kmeans.silhouette.toFixed(3)} hint={v.label}
          tone={v.tone === "good" ? "good" : v.tone === "warn" ? "warn" : "bad"} />
        <Stat label="Davies-Bouldin" value={snap.kmeans.db.toFixed(3)} hint="lower is better" />
        {snap.ward && <Stat label="Ward agrees" value={snap.ward.ari.toFixed(2)}
          hint="ARI with K-Means" tone={snap.ward.ari >= 0.7 ? "good" : snap.ward.ari >= 0.4 ? "warn" : "bad"} />}
        {snap.kproto && <Stat label="K-Prototypes agrees" value={snap.kproto.ari.toFixed(2)} hint="ARI with K-Means" />}
      </div>

      <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
        your segments (K-Means, k = {snap.k})
      </div>
      <CentroidTable centroids={snap.kmeans.centroids} numCols={snap.numCols} catCols={snap.catCols}
        sizes={snap.kmeans.sizes} total={snap.n} silhouettePerCluster={snap.kmeans.perCluster} />

      <div style={{ marginTop: 18 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
          how k was scored
        </div>
        <Table head={["k", "WCSS", "silhouette", "Davies-Bouldin", "Calinski-Harabasz"]}
          rows={snap.curve.map((r) => {
            const sel = r.k === snap.k;
            const cell = (x) => sel ? <strong style={{ color: C.acc }}>{x}</strong> : x;
            return [cell(r.k), cell(fmt(r.wcss ?? 0)), cell(r.silhouette.toFixed(3)),
                    cell(r.db.toFixed(3)), cell(fmt(r.ch))];
          })} />
      </div>

      {snap.ward?.gaps?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
            where the dendrogram says to cut
          </div>
          <Table head={["cut to k", "jump in merge distance"]}
            rows={snap.ward.gaps.map((g) => [<strong>{g.k}</strong>, `+${g.gap.toFixed(3)}`])} />
        </div>
      )}

      {snap.sub ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
            inside segment {snap.sub.segment} ({snap.sub.n} customers, split into {snap.sub.k})
          </div>
          <CentroidTable centroids={snap.sub.centroids} numCols={snap.numCols} catCols={snap.catCols}
            sizes={snap.sub.sizes} total={snap.sub.n} />
          <p style={{ fontSize: 11.5, color: C.mut, marginTop: 8 }}>
            Silhouette inside that segment: {snap.sub.silhouette.toFixed(3)} — {silhouetteVerdict(snap.sub.silhouette).label}.
          </p>
        </div>
      ) : (
        <Callout tone="warn" title="No sub-segment analysis yet">
          Question 3 asks what is inside your segments. Go back to the tool, open <strong>Inside a segment</strong>,
          run it and send the results again.
        </Callout>
      )}

      <div style={{ marginTop: 16, fontSize: 11.5, color: C.mut, lineHeight: 1.7 }}>
        <strong style={{ color: C.txt }}>Reproducible with:</strong> {snap.numCols.length} numeric
        {snap.catCols.length ? ` and ${snap.catCols.length} categorical` : ""} variables
        ({snap.numCols.join(", ")}{snap.catCols.length ? "; " + snap.catCols.join(", ") : ""}),
        {" "}{snap.scaling === "z" ? "z-score scaling" : snap.scaling === "minmax" ? "min–max scaling" : "no scaling"},
        {" "}missing values {snap.missing === "drop" ? "dropped" : `filled with the ${snap.missing}`},
        {" "}seed {snap.seed}, {snap.restarts} restarts.
      </div>
    </>
  );
}

function metaRows(snap) {
  const rows = [
    ["Activity", "D1 — segment a customer base and justify the targeting"],
    ["Data file", `${snap.file}${snap.sheet ? ` (sheet “${snap.sheet}”)` : ""}`],
    ["Customers analysed", `${snap.n} of ${snap.rowsBefore} rows`],
    ["Numeric variables", snap.numCols.join(", ")],
    ["Categorical variables", snap.catCols.length ? snap.catCols.join(", ") : "none"],
    ["Missing values", snap.missing === "drop" ? "rows dropped" : `filled with the ${snap.missing}`],
    ["Scaling", snap.scaling === "z" ? "z-score" : snap.scaling === "minmax" ? "min–max" : "none"],
    ["Segments (k)", String(snap.k)],
    ["Reproducibility", `seed ${snap.seed}, ${snap.restarts} restarts`],
    ["K-Means quality", `silhouette ${snap.kmeans.silhouette.toFixed(3)}, Davies-Bouldin ${snap.kmeans.db.toFixed(3)}, Calinski-Harabasz ${snap.kmeans.ch.toFixed(1)}`],
    ["Segment sizes", snap.kmeans.sizes.join(" · ")],
  ];
  if (snap.ward) rows.push(["Ward agreement (ARI)", snap.ward.ari.toFixed(3)]);
  if (snap.kproto) rows.push(["K-Prototypes", `gamma ${snap.kproto.gamma}, agreement with K-Means ${snap.kproto.ari.toFixed(3)}`]);
  if (snap.sub) rows.push(["Sub-segment analysis", `segment ${snap.sub.segment} (${snap.sub.n} customers) split into ${snap.sub.k}, sizes ${snap.sub.sizes.join(" · ")}, silhouette ${snap.sub.silhouette.toFixed(3)}`]);
  return rows;
}

function buildReport(snap, answers, identity, feedback) {
  const num = (v) => (typeof v === "number" ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : String(v));

  const centroidRows = snap.kmeans.centroids.map((c, i) => [
    `Segment ${i + 1}`, snap.kmeans.sizes[i],
    `${((snap.kmeans.sizes[i] / snap.n) * 100).toFixed(1)}%`,
    ...snap.numCols.map((k) => num(c[k])),
    ...snap.catCols.map((k) => String(c[k])),
    snap.kmeans.perCluster ? snap.kmeans.perCluster[i].toFixed(3) : "",
  ]);

  const body = `
<section>
  <h2>1. What the analysis produced</h2>
  <h3>Segments (K-Means, k = ${snap.k})</h3>
  ${tableHtml(["Segment", "n", "share", ...snap.numCols, ...snap.catCols, "silhouette"], centroidRows)}
  <h3>How k was scored</h3>
  ${tableHtml(["k", "WCSS", "silhouette", "Davies-Bouldin", "Calinski-Harabasz"],
    snap.curve.map((r) => [r.k, num(r.wcss ?? 0), r.silhouette.toFixed(3), r.db.toFixed(3), r.ch.toFixed(1)]))}
  ${snap.ward?.gaps?.length ? `<h3>Where the dendrogram says to cut</h3>
  ${tableHtml(["cut to k", "jump in merge distance"], snap.ward.gaps.map((g) => [g.k, `+${g.gap.toFixed(3)}`]))}` : ""}
  ${snap.sub ? `<h3>Inside segment ${snap.sub.segment} — ${snap.sub.n} customers split into ${snap.sub.k}</h3>
  ${tableHtml(["Subgroup", "n", ...snap.numCols, ...snap.catCols],
    snap.sub.centroids.map((c, i) => [`${snap.sub.segment}.${i + 1}`, snap.sub.sizes[i],
      ...snap.numCols.map((k) => num(c[k])), ...snap.catCols.map((k) => String(c[k]))]))}
  <p>Silhouette inside that segment: ${snap.sub.silhouette.toFixed(3)}.</p>` : ""}
  ${figureHtml(snap.figures?.indices, "Elbow, silhouette and Davies-Bouldin against k")}
  ${figureHtml(snap.figures?.scatter, "Segments on two of the chosen variables, with the centroids marked")}
  ${figureHtml(snap.figures?.silhouette, "Silhouette plot — one bar per customer")}
  ${figureHtml(snap.figures?.dendrogram, "Hierarchical structure of the whole customer base")}
  ${figureHtml(snap.figures?.sub, `Inside segment ${snap.sub?.segment ?? ""}`)}
</section>
<section>
  <h2>2. Interpretation and targeting decision</h2>
  ${QUESTIONS.map((q, i) => answerBlock({
    prompt: `${i + 1}. ${q.title} — ${q.prompt}`,
    answer: answers[q.id],
    feedback: feedback?.items?.[q.id],
  })).join("")}
</section>`;

  return reportShell({
    title: "Segmentation of a customer base — activity D1",
    identity, metaRows: metaRows(snap), feedback, body,
    note: `Answers written: ${QUESTIONS.filter((q) => wordCount(answers[q.id]) >= 20).length} of ${QUESTIONS.length}`,
  });
}
