/* Collaborative Filtering Lab — module 10 (technical note "Recommender systems", §3–7).
 *
 * Replaces the three claude.ai artifacts the note and activities A10, B10 and
 * C10 linked to. Those implemented three different models (with and without
 * movie biases, batch and stochastic descent) and split the data at random on
 * every click, so no two groups could compare numbers. Here there is one
 * model — the note's — and every random choice comes from a seed:
 *
 *   features known    w(j)·x(i) + b(j), learn w and b             (§3, A10)
 *   features learned  the same, learning x as well                 (§4, B10)
 *   compare           both on the same split, with the baselines   (§5–6, C10)
 *
 * With the workbooks' starting values (toy data, "Excel start") the step-by-
 * step table reproduces A10 and B10 cell for cell.
 *
 * Deep links: #/recommender?demo=toy|case|large&mode=known|learned|compare
 *             &alpha=0.005&lambda=0.1&iters=2000&k=2&train=80&seed=1&norm=1&start=excel&run=1&view=results
 */

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { C, inp } from "../theme.js";
import { Section, Callout, Stat, Table, Field, Chip, Spinner } from "../components/UI.jsx";
import { Curves } from "../components/RecCharts.jsx";
import { toCSV, download } from "../lib/parse.js";
import { readTableFile, readDemo } from "../lib/recData.js";
import {
  guessColumns, readMatrix, splitTrainTest, baselines, trainCF, traceCF, recommend, countRated, TOY,
} from "../lib/recommender.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const SOURCES = [
  { id: "toy", file: "rec_toy.csv", label: "A10 / B10: 5 movies × 4 users",
    what: "The running example of the technical note and of the A10 and B10 workbooks.",
    defaults: { mode: "known", start: "excel", train: 100, iters: 3, alpha: 0.2, lambda: 0.1, k: 2 } },
  { id: "case", file: "rec_case.csv", label: "C10 case: 100 movies × 12 users",
    what: "movie_ratings_complete.xlsx — the C10 group case. Romance and Action scores from 0 to 1.",
    defaults: { mode: "compare", start: "random", train: 80, iters: 2000, alpha: 0.005, lambda: 0.1, k: 2 } },
  { id: "large", file: "rec_large.csv", label: "Large: 100 movies × 12 users",
    what: "movie_ratings_large.xlsx (A10). Its romance and action scores go from 0 to 5, not 0 to 1 — watch the learning rate.",
    defaults: { mode: "known", start: "random", train: 80, iters: 3000, alpha: 0.001, lambda: 0.1, k: 2 } },
];

const MODES = [
  { id: "known", label: "Features known (§3)", hint: "Learn w and b for each user; the movie features are given." },
  { id: "learned", label: "Features learned (§4)", hint: "Learn the movie features x as well: collaborative filtering proper." },
  { id: "compare", label: "Compare both (§5)", hint: "Both models on the same training ratings, judged on the same test ratings." },
];

const fx = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "—");

export default function RecommenderLab() {
  const params = useMemo(() => new URLSearchParams(window.location.hash.split("?")[1] ?? ""), []);
  const resultsOnly = params.get("view") === "results";

  const [source, setSource] = useState(null);
  const [raw, setRaw] = useState(null);
  const [roles, setRoles] = useState(null);
  const [mode, setMode] = useState("known");
  const [cfg, setCfg] = useState({ alpha: 0.005, lambda: 0.1, iters: 2000, k: 2, train: 80, seed: 1, norm: false, start: "random" });
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("overview");
  const [log, setLog] = useState([]);
  const [copied, setCopied] = useState(false);
  const pending = useRef(null);

  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  const take = useCallback((t, src, defaults) => {
    const g = guessColumns(t.headers, t.rows);
    setRaw(t); setRoles(g); setRes(null); setErr("");
    if (defaults) {
      const { mode: m, ...rest } = defaults;
      setMode(m);
      setCfg((c) => ({ ...c, ...rest, seed: 1, norm: false }));
    } else setCfg((c) => ({ ...c, start: "random" }));
    setSource(src);
  }, []);

  const choose = useCallback(async (id) => {
    const s = SOURCES.find((x) => x.id === id);
    try { take(await readDemo(s.file), id, s.defaults); } catch (e) { setErr(String(e.message || e)); }
  }, [take]);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { take(await readTableFile(f), "file", null); } catch (x) { setErr(`Could not read ${f.name}: ${x.message || x}`); }
    e.target.value = "";
  };

  const data = useMemo(() => (raw && roles ? readMatrix(raw.rows, roles) : null), [raw, roles]);
  const isToy = source === "toy";
  const excelStart = isToy && cfg.start === "excel";

  /* ── Training ── */
  const run = useCallback((m = mode, c = cfg) => {
    if (!data || !data.users.length) return;
    if ((m === "known" || m === "compare") && !data.X) {
      setErr("Features known needs at least one feature column — tick one under “columns”, or choose “features learned”.");
      return;
    }
    setBusy(true); setErr("");
    setTimeout(() => {
      try {
        const { train, test, nTest } = splitTrainTest(data.Y, c.train, c.seed);
        const testOrNull = nTest ? test : null;
        const common = { lambda: c.lambda, iters: c.iters, seed: c.seed, normalise: c.norm, test: testOrNull };
        const out = { split: { train, test: testOrNull, nTest, nTrain: countRated(train) }, cfg: { ...c }, mode: m };
        if (m !== "learned") {
          const start = excelStart ? { X: TOY.X, W: TOY.A10.W, b: TOY.A10.b } : null;
          out.known = trainCF({ ...common, Y: train, Xknown: data.X, alpha: c.alpha, start });
          if (excelStart) out.knownTrace = traceCF({ Y: train, X: TOY.X, W: TOY.A10.W, b: TOY.A10.b, alpha: c.alpha, lambda: c.lambda, learnX: false, steps: Math.min(3, c.iters) });
        }
        if (m !== "known") {
          const start = excelStart ? { X: TOY.B10.X, W: TOY.B10.W, b: TOY.B10.b } : null;
          out.learned = trainCF({ ...common, Y: train, k: excelStart ? 2 : c.k, alpha: c.alpha, start });
          if (excelStart) out.learnedTrace = traceCF({ Y: train, X: TOY.B10.X, W: TOY.B10.W, b: TOY.B10.b, alpha: c.alpha, lambda: c.lambda, learnX: true, steps: Math.min(3, c.iters) });
        }
        out.base = testOrNull ? baselines(train, test) : null;
        setRes(out);
        setTab(excelStart ? "steps" : "overview");
        const rows = [];
        for (const [name, r] of [["known", out.known], ["learned", out.learned]]) {
          if (!r) continue;
          rows.push({
            n: 0, model: name === "known" ? "features known" : `features learned (k=${r.k})`,
            alpha: c.alpha, lambda: c.lambda, iters: c.iters, train: `${c.train}%`, seed: c.seed, norm: c.norm ? "yes" : "no",
            params: r.nParams, J: r.diverged ? "diverged" : fx(r.J, 4), trainRMSE: r.diverged ? "—" : fx(r.trainRMSE, 4),
            testRMSE: r.diverged || r.testRMSE == null ? "—" : fx(r.testRMSE, 4),
          });
        }
        setLog((l) => [...rows.map((r, i) => ({ ...r, n: l.length + i + 1 })), ...l]);
      } catch (e) { setErr(String(e.message || e)); }
      setBusy(false);
    }, 30);
  }, [data, mode, cfg, excelStart]);

  /* Deep link on first load. */
  useEffect(() => {
    const demo = params.get("demo");
    if (!demo || !SOURCES.some((s) => s.id === demo)) return;
    (async () => {
      const s = SOURCES.find((x) => x.id === demo);
      const t = await readDemo(s.file);
      take(t, demo, s.defaults);
      const over = {};
      for (const k of ["alpha", "lambda", "iters", "k", "train", "seed"]) if (params.get(k)) over[k] = Number(params.get(k));
      if (params.get("norm")) over.norm = params.get("norm") === "1";
      if (params.get("start")) over.start = params.get("start") === "excel" ? "excel" : "random";
      const m = MODES.some((x) => x.id === params.get("mode")) ? params.get("mode") : s.defaults.mode;
      // Each workbook has its own learning rate: 0.2 in A10, 0.02 in B10.
      if ((over.start ?? s.defaults.start) === "excel" && !params.get("alpha")) over.alpha = m === "learned" ? TOY.B10.alpha : TOY.A10.alpha;
      setCfg((c) => ({ ...c, ...over }));
      setMode(m);
      if (params.get("run") === "1" || resultsOnly) pending.current = true;
    })().catch((e) => setErr(String(e.message || e)));
  }, [params, take, resultsOnly]);
  useEffect(() => { if (pending.current && data) { pending.current = false; run(); } }, [data, run]);

  const deepLink = () => {
    const q = new URLSearchParams({ demo: source ?? "case", mode, alpha: cfg.alpha, lambda: cfg.lambda, iters: cfg.iters, k: cfg.k, train: cfg.train, seed: cfg.seed });
    if (cfg.norm) q.set("norm", "1");
    if (excelStart) q.set("start", "excel");
    q.set("run", "1");
    return `${window.location.origin}${window.location.pathname}#/recommender?${q}`;
  };

  const exportLog = () => download("recommender_experiments.csv", toCSV(log.slice().reverse(),
    ["n", "model", "alpha", "lambda", "iters", "train", "seed", "norm", "params", "J", "trainRMSE", "testRMSE"]));

  /* ── Render ── */
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <style>{"::-webkit-scrollbar{width:7px;height:7px;background:transparent}::-webkit-scrollbar-thumb{background:#252836;border-radius:4px}"}</style>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "34px 22px 90px" }}>
        {!resultsOnly && (
          <>
            <a href="#/" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← all tools</a>
            <h1 style={{ fontSize: 25, margin: "12px 0 7px", fontWeight: 600 }}>Collaborative Filtering Lab</h1>
            <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.7, maxWidth: 720, margin: "0 0 8px" }}>
              Predict the ratings users have not given yet and recommend the highest. Each user j gets a small linear model,
              rating ≈ <span style={{ fontFamily: MONO, color: C.txt }}>w(j)·x(i) + b(j)</span>, fitted by gradient descent on the ratings that exist.
              When the movie features x are known (romance, action…) only w and b are learned; when they are not, the ratings
              of all users together are enough to learn x as well — that is <em>collaborative</em> filtering.
            </p>
            <p style={{ color: C.mut, fontSize: 12.5, lineHeight: 1.7, maxWidth: 720, margin: "0 0 22px" }}>
              Technical note: <em>Recommender systems</em>, sections 3–7. Same model, same cost function and the same update rules as the
              note and the A10/B10 workbooks: with the toy data and the Excel starting values the step-by-step table matches the workbook.
              Items with features but no ratings? See the <a href="#/content-based" style={{ color: C.acc }}>Content-Based Lab →</a>
            </p>
          </>
        )}

        {!resultsOnly && (
          <Section title="1 · Choose the data" note={raw ? `Loaded: ${raw.name}${raw.sheet ? ` (sheet “${raw.sheet}”)` : ""} — ${data?.items.length ?? 0} items × ${data?.users.length ?? 0} users, ${data ? countRated(data.Y) : 0} ratings` : "A course dataset, or your own file: one row per item, one column per user, optional feature columns. Empty, “#” or “?” = not rated."}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {SOURCES.map((s) => <Chip key={s.id} active={source === s.id} onClick={() => choose(s.id)}>{s.label}</Chip>)}
              <label style={{ ...chipLike, borderStyle: "dashed" }}>
                Your file (.xlsx / .csv)
                <input type="file" accept=".csv,.xlsx,.xls,.xlsm,.txt" onChange={onFile} style={{ display: "none" }} />
              </label>
            </div>
            {source && source !== "file" && <p style={{ fontSize: 11.5, color: C.mut, margin: "8px 0 0" }}>{SOURCES.find((s) => s.id === source)?.what}</p>}
            {raw && roles && <Roles raw={raw} roles={roles} setRoles={(r) => { setRoles(r); setRes(null); }} />}
          </Section>
        )}

        {data && !resultsOnly && (
          <Section title="2 · Model and settings">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
              {MODES.map((m) => <Chip key={m.id} active={mode === m.id} disabled={m.id !== "learned" && !data.X}
                onClick={() => { setMode(m.id); setRes(null); if (excelStart) set("alpha", m.id === "learned" ? TOY.B10.alpha : TOY.A10.alpha); }}>{m.label}</Chip>)}
            </div>
            <p style={{ fontSize: 11.5, color: C.mut, margin: "0 0 12px" }}>{MODES.find((m) => m.id === mode)?.hint}</p>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
              <Field label="α learning rate" hint="Too big and J explodes; too small and it barely moves.">
                <input type="number" step="0.001" min="0" value={cfg.alpha} onChange={(e) => set("alpha", Number(e.target.value))} style={inp} />
              </Field>
              <Field label="λ regularisation" hint="Penalises large w (and x). Up = simpler model.">
                <input type="number" step="0.1" min="0" value={cfg.lambda} onChange={(e) => set("lambda", Number(e.target.value))} style={inp} />
              </Field>
              <Field label="iterations">
                <input type="number" step="100" min="1" max="20000" value={cfg.iters} onChange={(e) => set("iters", Math.max(1, Math.min(20000, Math.round(Number(e.target.value)))))} style={inp} />
              </Field>
              {mode !== "known" && (
                <Field label="k learned features" hint={excelStart ? "The workbook uses k = 2." : "Number of latent features per movie (§6)."}>
                  <input type="number" min="1" max="30" value={excelStart ? 2 : cfg.k} disabled={excelStart} onChange={(e) => set("k", Math.max(1, Math.min(30, Math.round(Number(e.target.value)))))} style={inp} />
                </Field>
              )}
              <Field label="ratings used to train" hint={cfg.train >= 100 ? "100%: no test set, nothing to measure overfitting with." : `${100 - cfg.train}% held out as test ratings.`}>
                <select value={cfg.train} onChange={(e) => set("train", Number(e.target.value))} style={inp}>
                  {[100, 90, 80, 70, 60].map((v) => <option key={v} value={v}>{v}%{v < 100 ? ` / ${100 - v}% test` : " (no test)"}</option>)}
                </select>
              </Field>
              <Field label="seed" hint="Same seed, same split and same start: everyone gets the same numbers.">
                <input type="number" min="1" value={cfg.seed} onChange={(e) => set("seed", Math.max(1, Math.round(Number(e.target.value))))} style={inp} />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12, fontSize: 12.5 }}>
              <label style={{ display: "flex", gap: 7, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={cfg.norm} onChange={(e) => set("norm", e.target.checked)} />
                Mean normalisation (subtract each movie’s average first, §3)
              </label>
              {isToy && (
                <label style={{ display: "flex", gap: 7, alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={excelStart} onChange={(e) => {
                    const on = e.target.checked;
                    setCfg((c) => ({ ...c, start: on ? "excel" : "random", ...(on ? { alpha: mode === "learned" ? TOY.B10.alpha : TOY.A10.alpha, iters: 3, train: 100, lambda: 0.1, norm: false } : {}) }));
                  }} />
                  Start from the workbook’s values (A10 / B10)
                </label>
              )}
            </div>
            {excelStart && mode === "compare" && <Callout tone="info">Compare uses A10’s start for “known” and B10’s for “learned”; each has its own α in the workbook (0.2 and 0.02). Here both get the α above.</Callout>}
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
              <button onClick={() => run()} disabled={busy} style={primaryBtn}>{busy ? "Training…" : "Train"}</button>
              {busy && <Spinner label="gradient descent running" />}
              {res && <button onClick={() => { navigator.clipboard?.writeText(deepLink()); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={ghostBtn}>{copied ? "link copied ✓" : "copy a link to these settings"}</button>}
            </div>
          </Section>
        )}

        {err && <Callout tone="bad" title="Something is wrong">{err}</Callout>}

        {res && data && <Results res={res} data={data} tab={tab} setTab={setTab} excelStart={excelStart} />}

        {log.length > 0 && !resultsOnly && (
          <Section title="Experiment history" note="Every run is recorded here, so a table of experiments (C10) is one download away."
            right={<span style={{ display: "flex", gap: 8 }}><button onClick={exportLog} style={ghostBtn}>download CSV</button><button onClick={() => setLog([])} style={ghostBtn}>clear</button></span>}>
            <Table head={["#", "model", "α", "λ", "iters", "train", "seed", "norm.", "params", "J", "train RMSE", "test RMSE"]}
              rows={log.map((r) => [r.n, r.model, r.alpha, r.lambda, r.iters, r.train, r.seed, r.norm, r.params, r.J, r.trainRMSE, r.testRMSE])} maxHeight={300} />
          </Section>
        )}
      </div>
    </div>
  );
}

/* Which column is the item, which are users, which are features. */
function Roles({ raw, roles, setRoles }) {
  const numeric = raw.headers.filter((h) => h !== roles.item && (roles.users.includes(h) || roles.features.includes(h)));
  const others = raw.headers.filter((h) => h !== roles.item && !numeric.includes(h));
  const flip = (h) => {
    const isF = roles.features.includes(h);
    setRoles({ ...roles, features: isF ? roles.features.filter((x) => x !== h) : [...roles.features, h], users: isF ? [...roles.users, h] : roles.users.filter((x) => x !== h) });
  };
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.bord}` }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Field label="item column">
          <select value={roles.item} onChange={(e) => setRoles(guessFromItem(raw, e.target.value))} style={{ ...inp, width: 200 }}>
            {raw.headers.map((h) => <option key={h}>{h}</option>)}
          </select>
        </Field>
        <div style={{ flex: 1, minWidth: 260 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", display: "block", marginBottom: 5 }}>
            columns — click to switch user ⇄ feature
          </span>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {numeric.map((h) => (
              <button key={h} onClick={() => flip(h)} style={{
                ...chipLike, padding: "4px 9px", background: roles.features.includes(h) ? `${C.warn}22` : C.surf,
                borderColor: roles.features.includes(h) ? C.warn : C.bord,
              }}>{roles.features.includes(h) ? "feature" : "user"} · {h}</button>
            ))}
          </div>
          {others.length > 0 && <p style={{ fontSize: 11, color: C.mut, margin: "6px 0 0" }}>Not numeric, ignored: {others.join(", ")}</p>}
        </div>
      </div>
    </div>
  );
}

function guessFromItem(raw, item) {
  return guessColumns(raw.headers, raw.rows, item);
}

function Results({ res, data, tab, setTab, excelStart }) {
  const models = [["known", res.known], ["learned", res.learned]].filter(([, r]) => r);
  const tabs = [["overview", "Overview"], ["predictions", "Predictions"], ["parameters", "Parameters"], ["recommend", "Recommendations"]];
  if (res.knownTrace || res.learnedTrace) tabs.unshift(["steps", "Step by step (Excel)"]);
  const bestBase = res.base ? Math.min(...res.base.map((b) => b.rmse)) : null;

  return (
    <Section title="3 · Results" note={`${res.split.nTrain} ratings used to train${res.split.nTest ? `, ${res.split.nTest} held out to test` : " (no test set)"} · seed ${res.cfg.seed}`}>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {tabs.map(([id, l]) => <Chip key={id} active={tab === id} onClick={() => setTab(id)}>{l}</Chip>)}
      </div>

      {tab === "overview" && (
        <>
          {models.map(([name, r]) => <ModelSummary key={name} name={name} r={r} res={res} data={data} bestBase={bestBase} />)}
          {res.known && res.learned && !res.known.diverged && !res.learned.diverged && res.split.nTest > 0 && (
            <Callout tone="info" title="Which model generalises better?">
              Test RMSE {fx(res.known.testRMSE)} with the features known ({res.known.nParams} parameters) against {fx(res.learned.testRMSE)} learning
              k = {res.learned.k} features ({res.learned.nParams} parameters) from {res.split.nTrain} training ratings.{" "}
              {res.known.testRMSE <= res.learned.testRMSE
                ? "Knowing the features wins here: fewer parameters to estimate from the same ratings (note §5.2)."
                : "Learning the features wins here: the ratings carry patterns the given features do not describe."}
            </Callout>
          )}
          {res.base && (
            <>
              <h3 style={h3}>Baselines — what the model has to beat</h3>
              <Table head={["prediction", "test RMSE"]} rows={res.base.map((b) => [b.name, fx(b.rmse)])} />
            </>
          )}
        </>
      )}

      {tab === "steps" && (
        <>
          {res.knownTrace && <Trace trace={res.knownTrace} data={data} learnX={false} cells={A10_CELLS} title="A10 · features known" />}
          {res.learnedTrace && <Trace trace={res.learnedTrace} data={data} learnX cells={B10_CELLS} title="B10 · features learned" />}
          {!excelStart && <p style={{ color: C.mut, fontSize: 12 }}>Tick “start from the workbook’s values” to compare with Excel.</p>}
        </>
      )}

      {tab === "predictions" && models.map(([name, r]) => <Predictions key={name} name={name} r={r} res={res} data={data} />)}
      {tab === "parameters" && models.map(([name, r]) => <Parameters key={name} name={name} r={r} data={data} />)}
      {tab === "recommend" && models.map(([name, r]) => <Recommendations key={name} name={name} r={r} data={data} res={res} />)}
    </Section>
  );
}

const title = (name, r) => (name === "known" ? "Features known" : `Features learned (k = ${r.k})`);

function ModelSummary({ name, r, res, data, bestBase }) {
  const ratio = r.testRMSE != null && r.trainRMSE > 0 ? r.testRMSE / r.trainRMSE : null;
  const perParam = r.nRatings / r.nParams;
  let verdict = null;
  if (r.diverged) verdict = <Callout tone="bad" title="Gradient descent diverged">J grew without limit after {r.iters} iterations: α = {res.cfg.alpha} is too large for this data. Each step overshoots the minimum and the next one overshoots more. Divide α by 5 and train again{data.X && Math.max(...data.X.flat()) > 1.5 ? " — the features here go up to " + fx(Math.max(...data.X.flat()), 1) + ", so the gradients are larger than with features between 0 and 1" : ""}.</Callout>;
  else if (r.testRMSE != null && bestBase != null && r.testRMSE >= bestBase) verdict = <Callout tone="warn" title="No better than a baseline">Test RMSE {fx(r.testRMSE)} does not beat the simplest prediction ({fx(bestBase)}). With these settings the model is not worth deploying.</Callout>;
  else if (ratio != null && ratio > 1.3) {
    const best = r.history.reduce((b, h) => (h.test < b.test ? h : b), r.history[0]);
    verdict = <Callout tone="warn" title="Overfitting">Much better on the ratings it learned from (train {fx(r.trainRMSE)}) than on new ones (test {fx(r.testRMSE)}): it is memorising, not generalising. Raise λ{name === "learned" ? " or lower k" : ""}.{best.iter < r.iters * 0.8 ? ` The test error was lowest, ${fx(best.test)}, at iteration ${best.iter} and rose afterwards.` : ""}</Callout>;
  }
  const hist = r.history;
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={h3}>{title(name, r)}</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Stat label="final cost J" value={r.diverged ? "∞" : fx(r.J, 3)} tone={r.diverged ? "bad" : undefined} />
        <Stat label="train RMSE" value={fx(r.trainRMSE)} />
        <Stat label="test RMSE" value={r.testRMSE == null ? "—" : fx(r.testRMSE)} hint={ratio ? `test / train = ${fx(ratio, 2)}` : "no test set"} />
        <Stat label="parameters" value={r.nParams} hint={`${r.nRatings} ratings → ${fx(perParam, 1)} per parameter`} tone={perParam < 2 ? "warn" : undefined} />
      </div>
      {verdict}
      {hist.length > 1 && (
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <Curves data={hist} series={[{ key: "J", label: "cost J (training)", color: C.acc }]} yLabel="J" logY={hist[0].J / Math.max(hist.at(-1).J, 1e-9) > 10} />
          <Curves data={hist} series={[{ key: "train", label: "train RMSE", color: C.good }, ...(r.testRMSE != null ? [{ key: "test", label: "test RMSE", color: C.bad, dash: true }] : [])]} yLabel="RMSE" />
        </div>
      )}
    </div>
  );
}

function Predictions({ name, r, res, data }) {
  const { train, test } = res.split;
  const cell = (i, j) => {
    const p = r.P[i][j];
    if (train[i][j] !== null) return <span title="rating used to train" style={{ color: C.mut }}>{fx(train[i][j], 1)} → {fx(p, 2)}</span>;
    if (test && test[i][j] !== null) return <span title="held-out rating" style={{ color: C.warn }}>{fx(test[i][j], 1)} → {fx(p, 2)}</span>;
    return <strong title="not rated: the prediction" style={{ color: C.good }}>{fx(p, 2)}</strong>;
  };
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={h3}>{title(name, r)}</h3>
      <p style={{ fontSize: 11.5, color: C.mut, margin: "0 0 8px" }}>
        <span style={{ color: C.mut }}>grey: rating → prediction (training)</span> · <span style={{ color: C.warn }}>amber: held-out rating → prediction</span> · <span style={{ color: C.good }}>green: not rated — what the system would recommend from</span>
      </p>
      <Table head={["item", ...data.users]} rows={data.items.map((it, i) => [it, ...data.users.map((_, j) => cell(i, j))])} />
    </div>
  );
}

function Parameters({ name, r, data }) {
  const k = r.k;
  const fnames = r.learnX ? Array.from({ length: k }, (_, f) => `x${f + 1}`) : data.features;
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={h3}>{title(name, r)}</h3>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
        <div>
          <p style={sub}>Users: w(j) and b(j)</p>
          <Table head={["user", ...fnames.map((f) => `w · ${f}`), "b"]} rows={data.users.map((u, j) => [u, ...r.W[j].map((v) => fx(v, 4)), fx(r.b[j], 4)])} />
        </div>
        <div>
          <p style={sub}>{r.learnX ? "Movies: the learned features x(i)" : "Movies: the given features x(i)"}</p>
          <Table head={["item", ...fnames]} rows={data.items.map((it, i) => [it, ...r.X[i].map((v) => fx(v, 4))])} />
        </div>
      </div>
      {r.learnX && <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6 }}>Learned features have no names: x1 is not “romance” unless the movies that score high on it turn out to be romances. Sort them in your head and name them — that is the analyst’s job.</p>}
      {r.mu && <p style={{ fontSize: 11.5, color: C.mut }}>Mean normalisation was on: each prediction also adds the movie’s average rating.</p>}
    </div>
  );
}

function Recommendations({ name, r, data, res }) {
  const top = recommend(r.P, res.split.train, 3);
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={h3}>{title(name, r)} — top 3 not yet rated by each user (in training)</h3>
      <Table head={["user", "1st", "2nd", "3rd"]} rows={data.users.map((u, j) => [u, ...[0, 1, 2].map((q) => top[j][q] ? `${data.items[top[j][q].i]} (${fx(top[j][q].score, 2)})` : "—")])} />
    </div>
  );
}

/* Where each quantity lives in the workbooks, so the table can be read side
 * by side with Excel. Rows of the parameters after update t. */
const A10_CELLS = { params: ["B27:E29", "B56:E58", "B85:E87", "Q107:T109"], J: ["I52", "I81", "I110", "—"] };
const B10_CELLS = { params: ["B27:E29", "B71:E73", "B115:E117", "Q144:T146"], X: ["A32:B36", "A76:B80", "A120:B124", "V144:W148"], J: ["I59", "I103", "I147", "—"] };

function Trace({ trace, data, learnX, cells, title: t }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={h3}>{t}</h3>
      <p style={{ fontSize: 11.5, color: C.mut, margin: "0 0 8px", lineHeight: 1.6 }}>
        Iteration 0 is the starting point typed in the workbook; each row after it is one gradient-descent update, all parameters at once from the same errors.
        J is the cost of the parameters in that row (the workbook’s “J+reg”).
      </p>
      <Table head={["iteration", "J", ...data.users.flatMap((u) => [`${u} b`, `${u} w1`, `${u} w2`]), "Excel cells"]}
        rows={trace.map((s, t2) => [s.iter, fx(s.J, 4), ...s.before.b.flatMap((b, j) => [fx(b, 4), fx(s.before.W[j][0], 4), fx(s.before.W[j][1], 4)]),
          <span style={{ color: C.mut, fontFamily: MONO }}>{cells.params[t2]} · J {cells.J[t2]}</span>])} />
      {learnX && (
        <>
          <p style={sub}>Movie features x(i) = (x1, x2)</p>
          <Table head={["iteration", ...data.items, "Excel cells"]}
            rows={trace.map((s, t2) => [s.iter, ...s.before.X.map((x) => `${fx(x[0], 4)} · ${fx(x[1], 4)}`), <span style={{ color: C.mut, fontFamily: MONO }}>{cells.X[t2]}</span>])} />
        </>
      )}
      <p style={sub}>Predictions after the last update</p>
      <Table head={["item", ...data.users]} rows={data.items.map((it, i) => [it, ...data.users.map((_, j) => fx(trace.at(-1).P[i][j], 4))])} />
    </div>
  );
}

const h3 = { fontSize: 13, fontWeight: 600, margin: "6px 0 8px" };
const sub = { fontSize: 11.5, color: C.mut, margin: "10px 0 6px" };
const chipLike = { background: C.surf, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 5, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" };
const primaryBtn = { background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6, padding: "9px 22px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const ghostBtn = { background: "transparent", color: C.acc, border: `1px solid ${C.bord}`, borderRadius: 6, padding: "6px 11px", fontSize: 11.5, cursor: "pointer" };

