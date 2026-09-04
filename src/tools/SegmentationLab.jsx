/* Segmentation Lab — module 4.
 *
 * Four algorithms on one dataset, scored with the same indices, so the
 * comparison the homework asks for is a tab rather than four notebooks. */

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { C, inp, card, clusterStyle } from "../theme.js";
import { Section, Callout, Stat, Table, CentroidTable, Field, Chip, Spinner } from "../components/UI.jsx";
import { LineOverK, Scatter, Dendrogram, SilhouettePlot, KDistance, Legend, fmt } from "../components/Charts.jsx";
import Interpret from "../components/Interpret.jsx";
import { parseFile, parseCSV, toCSV, download } from "../lib/parse.js";
import {
  profileAll, fillMissing, dropMissing, buildMatrix, buildCatMatrix,
  standardize, minmax, toNum, gowerMatrix,
} from "../lib/prep.js";
import { kmeans, kprototypes, elbow, suggestGamma } from "../lib/kmeans.js";
import { linkage, cutTree, dendrogramLayout, mergeGaps, centroidsFromLabels } from "../lib/hierarchical.js";
import { dbscan, kDistance, suggestEps, suggestMinPts } from "../lib/dbscan.js";
import { scorePartition, silhouetteVerdict, adjustedRand } from "../lib/validation.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const HIER_LIMIT = 3000;

const SAMPLES = [
  { id: "cities", file: "cities.csv", name: "US cities (49)", blurb: "The demographic dataset from the technical note. Small, all-numeric, visibly clustered — start here." },
  { id: "poke", file: "poke_survey.csv", name: "Poke survey (40)", blurb: "The in-class case. Six survey scales, semicolon-separated, Spanish headers." },
  { id: "campaign", file: "marketing_campaign.csv", name: "Marketing campaign (2 240)", blurb: "The homework dataset. Mixed numeric and categorical — the one that needs K-Prototypes." },
];

const ALGOS = [
  { id: "kmeans", label: "K-Means", needs: "numeric" },
  { id: "kproto", label: "K-Prototypes", needs: "mixed" },
  { id: "hier", label: "Hierarchical", needs: "numeric" },
  { id: "dbscan", label: "DBSCAN", needs: "numeric" },
  { id: "compare", label: "Compare all", needs: "numeric" },
];

export default function SegmentationLab() {
  const [raw, setRaw] = useState(null);          // { headers, rows, delimiter }
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [numSel, setNumSel] = useState([]);
  const [catSel, setCatSel] = useState([]);
  const [missing, setMissing] = useState("mean");
  const [scaling, setScaling] = useState("z");

  const [algo, setAlgo] = useState("kmeans");
  const [k, setK] = useState(4);
  const [seed, setSeed] = useState(42);
  const [restarts, setRestarts] = useState(25);
  const [initMode, setInitMode] = useState("kmeans++");
  const [gamma, setGamma] = useState(null);
  const [linkMethod, setLinkMethod] = useState("ward");
  const [hierMetric, setHierMetric] = useState("euclidean");
  const [eps, setEps] = useState(null);
  const [minPts, setMinPts] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  // ?view=results — hides the configuration panels. For projecting a worked
  // example in class, and for capturing figures for the technical note.
  const [resultsOnly, setResultsOnly] = useState(false);
  const [xVar, setXVar] = useState(0);
  const [yVar, setYVar] = useState(1);
  const fileRef = useRef(null);

  const profiles = useMemo(() => (raw ? profileAll(raw.rows, raw.headers) : []), [raw]);
  const numericCols = useMemo(() => profiles.filter((p) => p.isNumeric), [profiles]);
  const catCols = useMemo(() => profiles.filter((p) => !p.isNumeric), [profiles]);

  /* Rows and matrices for the current variable selection. Recomputed on
   * selection change, not on every render. */
  const prepared = useMemo(() => {
    if (!raw || !numSel.length) return null;
    const cols = [...numSel, ...catSel].map((key) => profiles.find((p) => p.key === key)).filter(Boolean);
    const rows = missing === "drop" ? dropMissing(raw.rows, cols) : fillMissing(raw.rows, cols, missing);
    if (rows.length < 4) return null;
    const numRaw = buildMatrix(rows, numSel);
    const scaled = scaling === "minmax" ? minmax(numRaw) : scaling === "none"
      ? { z: numRaw, mu: numSel.map(() => 0), sigma: numSel.map(() => 1) }
      : standardize(numRaw);
    return {
      rows, numRaw, cat: catSel.length ? buildCatMatrix(rows, catSel) : rows.map(() => []),
      z: scaled.z, mu: scaled.mu, sigma: scaled.sigma, dropped: raw.rows.length - rows.length,
    };
  }, [raw, numSel, catSel, missing, scaling, profiles]);

  const rowNames = useMemo(() => {
    if (!prepared || !raw) return null;
    const idCol = profiles.find((p) => !p.isNumeric && p.distinctCount === raw.rows.length)?.key
      ?? profiles.find((p) => /name|city|nombre|id/i.test(p.key))?.key;
    return idCol ? prepared.rows.map((r) => String(r[idCol])) : null;
  }, [prepared, profiles, raw]);

  /* Deep links: #/segmentation?demo=cities&algo=hier&k=4&run=1
   *
   * Lets a lecturer put an exact configuration into Canvas — "open this and
   * look at the dendrogram" — instead of a page of instructions telling
   * students which buttons to press. */
  useEffect(() => {
    const q = new URLSearchParams((window.location.hash.split("?")[1] ?? ""));
    const demo = q.get("demo");
    if (!demo) return;
    const sample = SAMPLES.find((s) => s.id === demo);
    if (!sample) return;
    const wanted = q.get("algo");
    if (wanted && ALGOS.some((a) => a.id === wanted)) setAlgo(wanted);
    const wantedK = Number(q.get("k"));
    if (wantedK >= 2 && wantedK <= 10) setK(wantedK);
    if (q.get("link")) setLinkMethod(q.get("link"));
    if (q.get("view") === "results") setResultsOnly(true);
    if (q.get("eps")) setEps(Number(q.get("eps")));
    if (q.get("minPts")) setMinPts(Number(q.get("minPts")));
    loadSample(sample).then(() => {
      const cols = q.get("vars");
      if (cols) setNumSel(cols.split(","));
      if (q.get("run")) setAutoRun(true);
    });
  }, []);

  /* Rows handed over from Sector Research, so a researched dataset goes
   * straight into clustering without a trip through the Downloads folder.
   * Consumed once — a refresh should not silently reload stale rows. */
  useEffect(() => {
    let payload;
    try {
      const stored = sessionStorage.getItem("mkt.handoff");
      if (!stored) return;
      sessionStorage.removeItem("mkt.handoff");
      payload = JSON.parse(stored);
    } catch { return; }
    if (payload?.rows?.length) applyData({ headers: payload.headers, rows: payload.rows, delimiter: "," }, payload.name);
  }, []);

  async function loadFile(file) {
    setLoading(true); setErr("");
    try {
      const parsed = await parseFile(file);
      if (!parsed.rows.length) throw new Error("The file has no data rows.");
      applyData(parsed, file.name);
    } catch (e) { setErr(e.message || "Could not read that file."); }
    setLoading(false);
  }

  async function loadSample(s) {
    setLoading(true); setErr("");
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/${s.file}`);
      if (!res.ok) throw new Error("Sample not found.");
      applyData(parseCSV(await res.text()), s.name);
    } catch (e) { setErr(e.message || "Could not load the sample."); }
    setLoading(false);
  }

  function applyData(parsed, name) {
    setRaw(parsed);
    setFileName(name);
    setResult(null);
    const prof = profileAll(parsed.rows, parsed.headers);
    // Pre-select numeric columns that are measures, not keys. Clustering on a
    // row index produces beautiful, meaningless segments, and it is the single
    // easiest mistake to make with these files (cities.csv leads with City_n).
    const nums = prof.filter((p) => p.isNumeric && !isIndexLike(p, parsed.rows));
    setNumSel(nums.slice(0, 6).map((p) => p.key));
    setCatSel([]);
    setXVar(0); setYVar(Math.min(1, Math.max(0, nums.length - 1)));
    setGamma(null); setEps(null); setMinPts(null);
  }

  const toggle = (list, setList, key) =>
    setList(list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);

  /* ── Run ── */
  const run = useCallback(() => {
    if (!prepared) return;
    setBusy(true);
    // Yield a frame so the spinner paints before a long synchronous run.
    setTimeout(() => {
      try { setResult(compute()); setErr(""); }
      catch (e) { setErr(e.message || "The algorithm failed on this data."); setResult(null); }
      setBusy(false);
    }, 20);

    function compute() {
      const { z, numRaw, cat, rows, mu, sigma } = prepared;
      const n = z.length;
      const opts = { restarts, seed, init: initMode };

      const centroidRows = (labels, kk) => {
        const cs = centroidsFromLabels(numRaw, labels, kk);
        const out = [];
        for (let c = 0; c < kk; c++) {
          const o = {};
          numSel.forEach((key, j) => { o[key] = cs[c][j]; });
          catSel.forEach((key, j) => {
            const vals = rows.filter((_, i) => labels[i] === c).map((r) => String(r[key]));
            const f = new Map();
            vals.forEach((v) => f.set(v, (f.get(v) || 0) + 1));
            o[key] = [...f.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
          });
          out.push(o);
        }
        return out;
      };
      const sizesOf = (labels, kk) => Array.from({ length: kk }, (_, c) => labels.filter((l) => l === c).length);

      if (algo === "kmeans" || algo === "kproto") {
        const isProto = algo === "kproto";
        const g = gamma ?? suggestGamma(z);
        const res = isProto
          ? kprototypes(z, cat, k, { gamma: g, restarts: Math.min(restarts, 20), seed })
          : kmeans(z, k, opts);
        const labels = res.assign;
        const zc = isProto ? res.numC : res.centroids;
        const metrics = scorePartition(z, labels, zc, k);
        const kMax = Math.min(10, n - 1);
        const curve = isProto ? null : elbow(z, kMax, { restarts: Math.min(restarts, 15), seed });
        const silCurve = [];
        for (let kk = 2; kk <= kMax; kk++) {
          const r = isProto
            ? kprototypes(z, cat, kk, { gamma: g, restarts: 8, seed })
            : kmeans(z, kk, { restarts: 10, seed });
          const lab = r.assign;
          const cc = isProto ? r.numC : r.centroids;
          const s = scorePartition(z, lab, cc, kk);
          silCurve.push({ k: kk, silhouette: s.silhouette, daviesBouldin: s.daviesBouldin, calinskiHarabasz: s.calinskiHarabasz });
        }
        return {
          kind: algo, labels, k, metrics, curve, silCurve, gamma: g,
          centroids: centroidRows(labels, k), sizes: sizesOf(labels, k), n, iterations: res.iterations,
          wcss: res.wcss ?? res.cost,
        };
      }

      if (algo === "hier") {
        if (n > HIER_LIMIT) throw new Error(`Hierarchical clustering needs an n × n distance matrix; ${n} rows would need about ${Math.round((n * n * 8) / 1e6)} MB. Sample down to ${HIER_LIMIT} rows or use K-Means.`);
        const useGower = hierMetric === "gower" && catSel.length;
        const pre = useGower ? gowerMatrix(z, cat) : null;
        const { Z: L } = linkage(z, useGower ? "average" : linkMethod, { precomputed: pre });
        const labels = cutTree(L, n, k);
        const zc = centroidsFromLabels(z, labels, k);
        const metrics = scorePartition(z, labels, zc, k);
        const layout = dendrogramLayout(L, n);
        const cutHeight = L.length >= k - 1 && k > 1 ? (L[L.length - k + 1]?.[2] + L[L.length - k]?.[2]) / 2 : null;
        const silCurve = [];
        for (let kk = 2; kk <= Math.min(10, n - 1); kk++) {
          const lab = cutTree(L, n, kk);
          const s = scorePartition(z, lab, centroidsFromLabels(z, lab, kk), kk);
          silCurve.push({ k: kk, silhouette: s.silhouette, daviesBouldin: s.daviesBouldin, calinskiHarabasz: s.calinskiHarabasz });
        }
        return {
          kind: "hier", labels, k, metrics, layout, linkageMatrix: L, cutHeight, gaps: mergeGaps(L, 8), silCurve,
          centroids: centroidRows(labels, k), sizes: sizesOf(labels, k), n, usedGower: !!useGower,
        };
      }

      if (algo === "dbscan") {
        const mp = minPts ?? suggestMinPts(numSel.length);
        const kd = kDistance(z, mp);
        const e = eps ?? suggestEps(kd);
        const res = dbscan(z, e, mp);
        const kk = res.nClusters;
        const metrics = kk >= 2
          ? scorePartition(z, res.labels, centroidsFromLabels(z, res.labels, kk), kk)
          : null;
        return {
          kind: "dbscan", labels: res.labels, k: kk, metrics, kdist: kd, eps: e, minPts: mp,
          noise: res.noise, centroids: kk ? centroidRows(res.labels, kk) : [], sizes: res.counts, n,
        };
      }

      // Compare: same k, same scaled matrix, four partitions, one table.
      const km = kmeans(z, k, opts);
      const partitions = [
        { id: "kmeans", label: "K-Means", labels: km.assign },
      ];
      if (catSel.length) {
        const kp = kprototypes(z, cat, k, { gamma: gamma ?? suggestGamma(z), restarts: 12, seed });
        partitions.push({ id: "kproto", label: "K-Prototypes", labels: kp.assign });
      }
      if (n <= HIER_LIMIT) {
        const { Z: L } = linkage(z, linkMethod);
        partitions.push({ id: "hier", label: `Hierarchical (${linkMethod})`, labels: cutTree(L, n, k) });
      }
      const mp = minPts ?? suggestMinPts(numSel.length);
      const e = eps ?? suggestEps(kDistance(z, mp));
      const db = dbscan(z, e, mp);
      partitions.push({ id: "dbscan", label: `DBSCAN (eps ${e}, minPts ${mp})`, labels: db.labels, note: `${db.nClusters} cluster${db.nClusters === 1 ? "" : "s"}, ${db.noise} noise` });

      const scored = partitions.map((p) => {
        const kk = Math.max(...p.labels) + 1;
        const s = kk >= 2 ? scorePartition(z, p.labels, centroidsFromLabels(z, p.labels, kk), kk) : null;
        return { ...p, k: kk, metrics: s, sizes: sizesOf(p.labels, Math.max(kk, 0)) };
      });
      const ari = scored.map((a) => scored.map((b) => adjustedRand(a.labels, b.labels)));
      return { kind: "compare", partitions: scored, ari, n, k };
    }
  }, [prepared, algo, k, seed, restarts, initMode, gamma, linkMethod, hierMetric, eps, minPts, numSel, catSel]);

  /* Deep-link auto-run. Defined after run() on purpose: an effect that closes
   * over it must come after the binding exists. It waits for `prepared`,
   * because running in the same tick as the state above would cluster the
   * default variable selection rather than the one the link asked for. */
  useEffect(() => {
    if (autoRun && prepared) { setAutoRun(false); run(); }
  }, [autoRun, prepared, run]);

  function exportCsv() {
    if (!result || !prepared) return;
    const labels = result.labels ?? result.partitions?.[0]?.labels;
    if (!labels) return;
    const headers = [...raw.headers, "cluster"];
    const rows = prepared.rows.map((r, i) => ({
      ...r,
      cluster: labels[i] < 0 ? "noise" : labels[i] + 1,
    }));
    download(`segments_${algo}_k${k}.csv`, toCSV(rows, headers));
  }

  const canRun = prepared && numSel.length >= 2 && (algo !== "kproto" || catSel.length >= 1);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <style>{`::-webkit-scrollbar{width:7px;height:7px;background:transparent}::-webkit-scrollbar-thumb{background:#252836;border-radius:4px}`}</style>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "34px 22px 90px" }}>
        {!resultsOnly && (
          <>
            <a href="#/" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← all tools</a>
            <h1 style={{ fontSize: 25, margin: "12px 0 7px", fontWeight: 600 }}>Segmentation Lab</h1>
            <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.7, maxWidth: 660, margin: "0 0 26px" }}>
              K-Means, K-Prototypes, hierarchical and DBSCAN on your own data, scored with the same validation indices so
              you can actually compare them. Everything runs in this page — your file is never uploaded.
            </p>
          </>
        )}

        {/* ── 1. Data ── */}
        {!resultsOnly && <Section title="1 · Data" note={raw ? `${fileName} — ${raw.rows.length} rows, ${raw.headers.length} columns (delimiter “${raw.delimiter}”)` : "Upload a CSV or Excel file, or start from one of the course datasets."}>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginBottom: 13 }}>
            <button onClick={() => fileRef.current?.click()} style={{
              background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6,
              padding: "8px 15px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}>Upload CSV / Excel</button>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
            {SAMPLES.map((s) => (
              <Chip key={s.id} onClick={() => loadSample(s)} title={s.blurb}>{s.name}</Chip>
            ))}
          </div>
          {loading && <Spinner label="Reading the file…" />}
          {err && <Callout tone="bad" title="Problem">{err}</Callout>}
          {raw && (
            <Table
              head={raw.headers.slice(0, 9)}
              rows={raw.rows.slice(0, 4).map((r) => raw.headers.slice(0, 9).map((h) => String(r[h]).slice(0, 22)))}
              maxHeight={200}
            />
          )}
        </Section>}

        {/* ── 2. Variables ── */}
        {raw && !resultsOnly && (
          <Section title="2 · Variables"
            note="Pick what the segments should be built from. Numeric variables drive the distance; categorical ones are only used by K-Prototypes (and by hierarchical clustering if you switch to Gower distance).">
            <div style={{ marginBottom: 13 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
                numeric ({numSel.length} selected)
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {numericCols.map((p) => (
                  <Chip key={p.key} active={numSel.includes(p.key)} onClick={() => toggle(numSel, setNumSel, p.key)}
                    title={`${p.distinctCount} distinct values, ${p.missing} missing`}>
                    {p.key}
                    {p.distinctCount <= 7 && <span style={{ opacity: 0.6, marginLeft: 5, fontSize: 10 }}>{p.distinctCount} levels</span>}
                  </Chip>
                ))}
              </div>
              {numSel.some((key) => (numericCols.find((p) => p.key === key)?.distinctCount ?? 99) <= 7) && (
                <Callout tone="info">
                  Some selected columns have very few distinct values — they are probably ordinal survey scales coded as
                  numbers. K-Means will treat the gap from 1 to 2 as identical to the gap from 4 to 5. That is usually
                  acceptable for a Likert scale, but if they are unordered categories, move them to K-Prototypes instead.
                </Callout>
              )}
            </div>

            {catCols.length > 0 && (
              <div style={{ marginBottom: 13 }}>
                <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
                  categorical ({catSel.length} selected)
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {catCols.slice(0, 24).map((p) => (
                    <Chip key={p.key} active={catSel.includes(p.key)} onClick={() => toggle(catSel, setCatSel, p.key)}
                      disabled={p.distinctCount > 40}
                      title={p.distinctCount > 40 ? `${p.distinctCount} distinct values — too many to be a useful category` : `${p.distinctCount} categories`}>
                      {p.key} <span style={{ opacity: 0.6, fontSize: 10 }}>{p.distinctCount}</span>
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "grid", gap: 13, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
              <Field label="missing values" hint={prepared?.dropped ? `${prepared.dropped} rows affected` : "none detected in the selection"}>
                <select value={missing} onChange={(e) => setMissing(e.target.value)} style={inp}>
                  <option value="mean">Fill numeric with the mean</option>
                  <option value="median">Fill numeric with the median</option>
                  <option value="mode">Fill with the most frequent value</option>
                  <option value="drop">Drop the row</option>
                </select>
              </Field>
              <Field label="scaling" hint={scaling === "none" ? "Warning: without scaling, the widest-ranging variable dominates the distance." : "z-scores put every variable on the same footing."}>
                <select value={scaling} onChange={(e) => setScaling(e.target.value)} style={inp}>
                  <option value="z">Standardise (z-score)</option>
                  <option value="minmax">Min–max to [0,1]</option>
                  <option value="none">None (not recommended)</option>
                </select>
              </Field>
            </div>
          </Section>
        )}

        {/* ── 3. Algorithm ── */}
        {raw && !resultsOnly && (
          <Section title="3 · Algorithm">
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 15 }}>
              {ALGOS.map((a) => (
                <Chip key={a.id} active={algo === a.id} onClick={() => { setAlgo(a.id); setResult(null); }}>{a.label}</Chip>
              ))}
            </div>

            <AlgoHelp algo={algo} />

            <div style={{ display: "grid", gap: 13, gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", marginBottom: 15 }}>
              {algo !== "dbscan" && (
                <Field label={`number of segments (k = ${k})`} hint="Use the elbow and the silhouette below to justify this.">
                  <input type="range" min="2" max="10" value={k} onChange={(e) => setK(+e.target.value)} style={{ width: "100%", accentColor: C.acc }} />
                </Field>
              )}
              {(algo === "kmeans" || algo === "kproto" || algo === "compare") && (
                <>
                  <Field label="random seed" hint="Same seed, same result — quote it in your report.">
                    <input type="number" value={seed} onChange={(e) => setSeed(+e.target.value || 0)} style={inp} />
                  </Field>
                  <Field label="restarts" hint="Runs the algorithm this many times and keeps the lowest cost.">
                    <input type="number" min="1" max="200" value={restarts} onChange={(e) => setRestarts(Math.max(1, +e.target.value || 1))} style={inp} />
                  </Field>
                </>
              )}
              {algo === "kmeans" && (
                <Field label="initialisation" hint={initMode === "random" ? "Random start reproduces the local-optimum problem from the note." : "k-means++ spreads the starting centroids apart."}>
                  <select value={initMode} onChange={(e) => setInitMode(e.target.value)} style={inp}>
                    <option value="kmeans++">k-means++</option>
                    <option value="random">Random (as in the note)</option>
                  </select>
                </Field>
              )}
              {algo === "kproto" && (
                <Field label="gamma" hint={`Weight of the categorical part. Suggested: ${prepared ? suggestGamma(prepared.z) : "—"}`}>
                  <input type="number" step="0.1" value={gamma ?? (prepared ? suggestGamma(prepared.z) : 1)}
                    onChange={(e) => setGamma(+e.target.value)} style={inp} />
                </Field>
              )}
              {(algo === "hier" || algo === "compare") && (
                <Field label="linkage" hint={linkMethod === "ward" ? "Ward minimises the variance added by each merge." : "Alternative linkage — compare the dendrograms."}>
                  <select value={linkMethod} onChange={(e) => setLinkMethod(e.target.value)} style={inp}>
                    <option value="ward">Ward</option>
                    <option value="average">Average</option>
                    <option value="complete">Complete</option>
                    <option value="single">Single</option>
                  </select>
                </Field>
              )}
              {algo === "hier" && catSel.length > 0 && (
                <Field label="distance" hint="Gower handles mixed numeric and categorical data; Ward cannot.">
                  <select value={hierMetric} onChange={(e) => setHierMetric(e.target.value)} style={inp}>
                    <option value="euclidean">Euclidean (numeric only)</option>
                    <option value="gower">Gower (mixed)</option>
                  </select>
                </Field>
              )}
              {(algo === "dbscan" || algo === "compare") && (
                <>
                  <Field label="eps" hint={prepared ? "Leave blank to use the knee of the k-distance curve." : ""}>
                    <input type="number" step="0.05" value={eps ?? ""} placeholder="auto"
                      onChange={(e) => setEps(e.target.value === "" ? null : +e.target.value)} style={inp} />
                  </Field>
                  <Field label="minPts" hint={`Rule of thumb: 2 × variables = ${suggestMinPts(numSel.length)}`}>
                    <input type="number" min="2" value={minPts ?? ""} placeholder={String(suggestMinPts(numSel.length))}
                      onChange={(e) => setMinPts(e.target.value === "" ? null : +e.target.value)} style={inp} />
                  </Field>
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: 11, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={run} disabled={!canRun || busy} style={{
                background: canRun ? C.acc : C.card, color: canRun ? "#0d0f14" : C.mut, border: `1px solid ${canRun ? C.acc : C.bord}`,
                borderRadius: 6, padding: "9px 19px", fontSize: 13, fontWeight: 600, cursor: canRun && !busy ? "pointer" : "not-allowed",
              }}>{busy ? "Running…" : "Run"}</button>
              {busy && <Spinner label="Clustering…" />}
              {!canRun && numSel.length < 2 && <span style={{ fontSize: 12, color: C.warn }}>Select at least two numeric variables.</span>}
              {!canRun && algo === "kproto" && numSel.length >= 2 && <span style={{ fontSize: 12, color: C.warn }}>K-Prototypes needs at least one categorical variable.</span>}
              {result && <button onClick={exportCsv} style={{
                background: C.surf, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6,
                padding: "8px 15px", fontSize: 12.5, cursor: "pointer", marginLeft: "auto",
              }}>Export data with cluster column</button>}
            </div>
          </Section>
        )}

        {/* ── 4. Results ── */}
        {result && (
          <Results
            result={result} prepared={prepared} numSel={numSel} catSel={catSel}
            xVar={xVar} yVar={yVar} setXVar={setXVar} setYVar={setYVar}
            rowNames={rowNames} k={k} setK={setK} algo={algo} linkMethod={linkMethod}
          />
        )}

        {!resultsOnly && <footer style={{ color: C.mut, fontSize: 11, marginTop: 40, lineHeight: 1.75, borderTop: `1px solid ${C.bord}`, paddingTop: 16 }}>
          César Moreno Pascual, PhD · Marketing Analytics, Universidad Francisco de Vitoria.<br />
          Your data is parsed in this page and never uploaded. Source:{" "}
          <a href="https://github.com/cmoreno34/marketing-analytics-ufv" style={{ color: C.acc }}>github.com/cmoreno34/marketing-analytics-ufv</a>
        </footer>}
      </div>
    </div>
  );
}

/* A column is a row identifier, not a measure, if every value is distinct AND
 * the values form a consecutive integer run — which is what City_n, ID and
 * "record number" all look like. Naming conventions are too varied to detect
 * this from the header text alone. */
function isIndexLike(profile, rows) {
  const allDistinct = profile.distinctCount === rows.length;
  if (!allDistinct || rows.length < 3) return false;
  // Named like a key (City_n, ID, customer_no) and unique in every row.
  if (/(^|[_\s.-])(id|n|no|num|number|code|key|index)$/i.test(profile.key.trim())) return true;
  // Or unnamed but a consecutive integer run, which only a row counter is.
  const vals = rows.map((r) => toNum(r[profile.key]));
  if (!vals.every((v) => Number.isInteger(v))) return false;
  const sorted = [...vals].sort((a, b) => a - b);
  return sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
}

function AlgoHelp({ algo }) {
  const text = {
    kmeans: "Partitions into k spherical clusters by minimising the distance to k centroids. Fast, interpretable, and the baseline everything else is compared against. Needs k up front, assumes round clusters of similar size, and forces every customer into a segment.",
    kproto: "K-Means and K-Modes combined: Euclidean distance on the numeric variables plus a mismatch count on the categorical ones, traded off by gamma. This is what you want for real survey data, where most variables are categories.",
    hier: "Merges the two closest clusters over and over, recording every merge. You get a dendrogram instead of a single answer, and you choose k afterwards by cutting it. Needs an n × n distance matrix, so it does not scale.",
    dbscan: "Finds dense regions and labels everything else as noise. It decides the number of clusters itself and does not force every customer into a segment — the outliers it rejects are often the commercially interesting ones. It has no centroids, so persona definition needs another step.",
    compare: "Runs every applicable algorithm on the same variables at the same k, scores them with the same indices, and measures how much they agree. This is the reconciliation step your report needs.",
  }[algo];
  return <p style={{ fontSize: 12.5, color: C.mut, lineHeight: 1.7, margin: "0 0 15px", maxWidth: 720 }}>{text}</p>;
}

function Results({ result, prepared, numSel, catSel, xVar, yVar, setXVar, setYVar, rowNames, k, setK, algo, linkMethod }) {
  const { z, numRaw } = prepared;
  const scatterPts = useMemo(
    () => numRaw.map((r) => [r[xVar] ?? 0, r[yVar] ?? 0]),
    [numRaw, xVar, yVar]
  );

  if (result.kind === "compare") return <CompareResults result={result} />;

  const m = result.metrics;
  const verdict = m ? silhouetteVerdict(m.silhouette) : null;

  return (
    <>
      <Section title="4 · How good is this partition?"
        note="Read the three together. They disagree often, and the disagreement is the finding — a high Calinski-Harabasz with a low silhouette usually means one dominant cluster and several thin ones.">
        {m ? (
          <>
            <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginBottom: 15 }}>
              <Stat label="segments" value={result.k} hint={`${result.n} rows`} />
              <Stat label="silhouette" value={m.silhouette.toFixed(3)} hint={verdict.label}
                tone={verdict.tone === "good" ? "good" : verdict.tone === "warn" ? "warn" : "bad"} />
              <Stat label="Davies-Bouldin" value={m.daviesBouldin.toFixed(3)} hint="lower is better" />
              <Stat label="Calinski-Harabasz" value={fmt(m.calinskiHarabasz)} hint="higher is better" />
              {result.noise != null && <Stat label="noise" value={result.noise} hint={`${((result.noise / result.n) * 100).toFixed(1)}% unassigned`} tone={result.noise / result.n > 0.4 ? "warn" : undefined} />}
              {result.wcss != null && <Stat label="WCSS (J)" value={fmt(result.wcss)} hint={`converged in ${result.iterations} iterations`} />}
            </div>
            {m.silhouette < 0.26 && (
              <Callout tone="warn" title="Weak structure">
                An average silhouette below 0.26 means the algorithm split the data, but the groups overlap heavily.
                That is a legitimate finding — not every market has natural segments. Say so in your report rather
                than presenting these clusters as if they were real, and try fewer variables or a different k.
              </Callout>
            )}
            <SilhouettePlot perPoint={m.silhouettePerPoint} labels={result.labels} k={result.k} mean={m.silhouette} />
            <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, marginTop: 9 }}>
              Each bar is one customer. A wide block of long bars is a solid segment; a short, ragged block is one the
              algorithm invented. Bars to the left of zero are customers who sit closer to a different segment.
            </p>
          </>
        ) : (
          <Callout tone="warn" title="Not enough clusters to score">
            DBSCAN found {result.k} cluster{result.k === 1 ? "" : "s"} at these settings, so the validation indices
            cannot be computed — they all need at least two groups. Lower <strong>eps</strong> or reduce{" "}
            <strong>minPts</strong>.
          </Callout>
        )}
      </Section>

      {result.kind === "dbscan" && <DbscanExtras result={result} dims={numSel.length} />}

      {result.silCurve && (
        <Section title="Choosing k"
          note="The elbow only ever falls, so it cannot tell you whether the split is any good — it can only show where the gain slows. The silhouette can, which is why both are here.">
          <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
            {result.curve && <LineOverK data={result.curve} yKey="wcss" yLabel="WCSS" selected={k} onSelect={setK} label="Elbow — within-cluster sum of squares" />}
            <LineOverK data={result.silCurve} yKey="silhouette" yLabel="silhouette" selected={k} onSelect={setK} invertGood={false} label="Average silhouette (higher is better)" />
            <LineOverK data={result.silCurve} yKey="daviesBouldin" yLabel="Davies-Bouldin" selected={k} onSelect={setK} invertGood label="Davies-Bouldin (lower is better)" />
          </div>
          <Callout tone="info">
            Pick k where these agree, then sanity-check it commercially. Four segments you can actually run different
            campaigns for beat seven the maths marginally prefers. The note makes this point with t-shirt sizes; it is
            the same argument.
          </Callout>
        </Section>
      )}

      {result.kind === "hier" && (
        <Section title="Dendrogram"
          note="Height is the distance at which two groups merged. Cut just below the biggest vertical jump: the number of vertical lines you cross is k.">
          <Dendrogram layout={result.layout} n={result.n} cutHeight={result.cutHeight} labels={result.labels}
            leafNames={rowNames} height={360} />
          <div style={{ marginTop: 14 }}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 }}>
              biggest jumps in merge distance
            </div>
            <Table
              head={["cut to k", "merge at", "next merge at", "jump"]}
              rows={result.gaps.slice(0, 6).map((g) => [
                <strong>{g.k}</strong>, g.from.toFixed(3), g.to.toFixed(3),
                <span style={{ color: C.acc }}>+{g.gap.toFixed(3)}</span>,
              ])}
            />
            <p style={{ fontSize: 11.5, color: C.mut, marginTop: 8, lineHeight: 1.6 }}>
              The largest jump is the most defensible place to cut — merging past it joins two genuinely different groups.
            </p>
          </div>
          {result.usedGower && (
            <Callout tone="info">
              Using Gower distance with average linkage, because Ward is defined on squared Euclidean distances and has
              no meaning for categorical variables.
            </Callout>
          )}
        </Section>
      )}

      <Section title="The segments"
        note="Numeric values are cluster means in the original units; categorical values are the most frequent category. This table is your buyer persona, before anyone writes a word of prose about it."
        right={<Legend k={result.k} sizes={result.sizes} noise={result.noise} />}>
        <CentroidTable centroids={result.centroids} numCols={numSel} catCols={catSel}
          sizes={result.sizes} total={result.n} silhouettePerCluster={result.metrics?.silhouettePerCluster} />

        <div style={{ display: "grid", gap: 13, gridTemplateColumns: "1fr 1fr", margin: "18px 0 11px", maxWidth: 430 }}>
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
        <Scatter points={scatterPts} labels={result.labels}
          centroids={result.centroids.map((c) => [c[numSel[xVar]], c[numSel[yVar]]])}
          xLabel={numSel[xVar]} yLabel={numSel[yVar]} rowNames={rowNames} />
        <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, marginTop: 9 }}>
          This is a two-variable slice of a {numSel.length}-dimensional result. Segments that overlap here may be cleanly
          separated on another pair — check a few before concluding the clustering failed.
        </p>
      </Section>

      <Section title="Reading the segments with Claude">
        <Interpret payload={{
          algorithm: result.kind, k: result.k, numCols: numSel, catCols: catSel,
          centroids: result.centroids, sizes: result.sizes, metrics: result.metrics,
        }} />
      </Section>
    </>
  );
}

function DbscanExtras({ result, dims }) {
  const noiseShare = result.noise / result.n;
  return (
    <Section title="Density and the choice of eps"
      note="Sort every point by the distance to its minPts-th neighbour. The knee is where points stop being in dense company — that distance is the natural eps.">
      <KDistance values={result.kdist} eps={result.eps} />
      <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginTop: 13 }}>
        <Stat label="eps used" value={result.eps} />
        <Stat label="minPts" value={result.minPts} />
        <Stat label="clusters found" value={result.k} hint="chosen by the algorithm" />
      </div>
      {(result.k <= 1 || noiseShare > 0.5) && (
        <Callout tone="warn" title="This is the curse of dimensionality, not a bug">
          With {dims} variables, distances between points become nearly equal, so no region looks dense relative to
          another and DBSCAN collapses to one cluster or calls almost everything noise. This is a real and well-known
          limitation, and it is worth stating in your report: DBSCAN is excellent in two or three dimensions, and
          unreliable in eight. Try again with two or three variables, or reduce the dimensionality first.
        </Callout>
      )}
      {result.k > 1 && noiseShare > 0.05 && noiseShare <= 0.5 && (
        <Callout tone="info" title="Look at the outliers before discarding them">
          {result.noise} customers ({(noiseShare * 100).toFixed(1)}%) fit no dense region. In a marketing dataset these
          are rarely errors — they are usually the very high spenders, the one-off buyers, or the mis-keyed records.
          Export the data and read them individually.
        </Callout>
      )}
    </Section>
  );
}

function CompareResults({ result }) {
  const { partitions, ari } = result;
  return (
    <>
      <Section title="4 · The same data, four algorithms"
        note="Same variables, same scaling, same k where the algorithm accepts one. Different answers are expected — what matters is which differences you can explain.">
        <Table
          head={["algorithm", "k found", "silhouette", "Davies-Bouldin", "Calinski-Harabasz", "segment sizes"]}
          rows={partitions.map((p) => [
            <strong>{p.label}</strong>,
            p.k > 0 ? p.k : "—",
            p.metrics ? <span style={{ color: p.metrics.silhouette >= 0.5 ? C.good : p.metrics.silhouette >= 0.26 ? C.warn : C.bad }}>{p.metrics.silhouette.toFixed(3)}</span> : "—",
            p.metrics ? p.metrics.daviesBouldin.toFixed(3) : "—",
            p.metrics ? fmt(p.metrics.calinskiHarabasz) : "—",
            p.sizes.join(" · ") + (p.note ? ` (${p.note})` : ""),
          ])}
        />
        <Callout tone="info" title="How to use this table">
          The best silhouette is not automatically the right answer. A method that finds three balanced, explainable
          segments is worth more than one with a marginally better index and a segment of four customers you cannot
          target. Say which you chose and why — that argument is the deliverable.
        </Callout>
      </Section>

      <Section title="Do the algorithms agree?"
        note="Adjusted Rand Index between every pair of partitions: 1 means identical groupings, 0 means no more agreement than chance. Where two very different algorithms agree, the segments are probably real.">
        <Table
          head={["", ...partitions.map((p) => p.id)]}
          rows={partitions.map((a, i) => [
            <strong>{a.id}</strong>,
            ...partitions.map((b, j) => {
              const v = ari[i][j];
              return i === j ? <span style={{ color: C.mut }}>—</span>
                : <span style={{ color: v >= 0.7 ? C.good : v >= 0.4 ? C.warn : C.bad }}>{v.toFixed(2)}</span>;
            }),
          ])}
        />
        <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.65, marginTop: 10 }}>
          Above 0.7 the two methods essentially found the same structure. Between 0.4 and 0.7 they agree on the broad
          shape but disagree at the boundaries. Below 0.4 they are telling different stories, and you need to decide
          which one the business can act on.
        </p>
      </Section>
    </>
  );
}
