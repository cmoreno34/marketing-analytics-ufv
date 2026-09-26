/* Elasticity Lab — module 8.
 *
 * Replaces the two Colabs of the demand-based-models note (univariate and
 * "with rain") with one page that works for any product:
 *
 *   data     the Colab's 14 days, a simulation the student designs, their own
 *            file, or the answers a class has just given in a live session;
 *   model    ln Q on ln P, plus categories (a demand shift, and optionally an
 *            elasticity of their own) and numeric variables;
 *   result   the log-log line, an elasticity per category with its interval,
 *            whether the categories really differ, and the optimal price
 *            P* = c·ε/(1+ε) with the warnings that make it honest.
 *
 * Deep links: #/elasticity?demo=colab|rain|sim-sales|sim-offers&cost=1.8
 *             #/elasticity?session=ABCDE           (a live class session)
 *             &view=results                        (projecting in class)
 */

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { C, inp, card, clusterStyle } from "../theme.js";
import { Section, Callout, Stat, Table, Field, Chip, Spinner } from "../components/UI.jsx";
import { snapshot } from "../components/Charts.jsx";
import { LogLogChart, DemandChart, ProfitChart, groupsFromFit } from "../components/ElasticityCharts.jsx";
import { parseFile, toCSV, download } from "../lib/parse.js";
import { profileAll, toNum, isMissing } from "../lib/prep.js";
import {
  fitElasticity, predictLnQ, optimalPrice, aggregateOffers, looksBinary,
  simulateSales, simulateOffers, lognormalElasticity, COLAB_PAIRS, COLAB_RAIN, COLAB_COST, LN_P,
} from "../lib/elasticity.js";
import { isCode, loadSession as readSession, mergeWithCache, watchTopic, sessionFromMessages, hostCache } from "../lib/live.js";
import { reportShell, openForPrint, downloadHtml, table as htmlTable, figure, esc } from "../lib/report.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const DEFAULT_SALES = {
  product: "Coffee to go", n: 60, pMin: 2.1, pMax: 3.3, pRef: 2.5, qRef: 50, noise: 0.12,
  useSegment: true,
  segment: { name: "weather", levels: [
    { name: "dry", eps: -2.6, shift: 1, share: 60 },
    { name: "rain", eps: -1.9, shift: 0.85, share: 40 },
  ] },
  nums: [{ name: "temperature", min: 8, max: 30, eff: -0.3 }],
  shifters: [],
};

const DEFAULT_OFFERS = {
  product: "Cinema ticket", respondents: 60, start: 8, rangePct: 35, levels: 7, offersEach: 7, sigma: 0.3, wtp: 8,
  useSegment: true,
  segment: { name: "profile", levels: [
    { name: "student", wtp: 6.5, share: 55 },
    { name: "working", wtp: 9.5, share: 45 },
  ] },
};

const SOURCES = [
  { id: "colab", label: "Colab: 14 days", blurb: "The 14 price–demand pairs from the technical note and the univariate Colab. Unit cost 1.8." },
  { id: "rain", label: "Colab: 14 days + rain", blurb: "The same days with the weather, as in the multivariate Colab." },
  { id: "sim-sales", label: "Simulate sales", blurb: "Design a product, its true elasticities and the variables that move demand — then see whether the regression recovers them." },
  { id: "sim-offers", label: "Simulate a class", blurb: "Virtual respondents with a willingness to pay answer yes/no to prices around a start price — the live session played by the computer." },
  { id: "upload", label: "Upload a file", blurb: "Any CSV or Excel with a price column and a quantity (or yes/no) column." },
  { id: "session", label: "Live class session", blurb: "The answers your class gave in a live session." },
];

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const pFmt = (p) => (!Number.isFinite(p) ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3));

/* Column guesses for an uploaded file. The student can override every one. */
function guessMapping(headers, rows) {
  const prof = profileAll(rows, headers);
  const numeric = prof.filter((p) => p.isNumeric).map((p) => p.key);
  const find = (re, pool) => pool.find((h) => re.test(h));
  const price = find(/price|precio|pvp|tarifa/i, numeric) ?? numeric[0] ?? "";
  const qty = find(/unit|qty|quant|demand|sales|sold|ventas|cantidad|unidades|accept|buy|compra|acept/i, headers.filter((h) => h !== price))
    ?? numeric.find((h) => h !== price) ?? "";
  const cats = prof.filter((p) => !p.isNumeric && p.distinctCount >= 2 && p.distinctCount <= 12 && p.key !== qty).map((p) => p.key);
  const lowCardNum = prof.filter((p) => p.isNumeric && p.distinctCount === 2 && p.key !== qty && p.key !== price).map((p) => p.key);
  return { price, qty, segment: cats[0] ?? lowCardNum[0] ?? "", shifters: [], nums: [] };
}

export default function ElasticityLab() {
  const params = useMemo(() => new URLSearchParams(window.location.hash.split("?")[1] ?? ""), []);
  const resultsOnly = params.get("view") === "results";

  const [source, setSource] = useState(null);
  const [raw, setRaw] = useState(null);             // { name, headers, rows, truth? }
  const [kind, setKind] = useState("sales");        // "sales" rows or yes/no "offers"
  const [map, setMap] = useState({ price: "", qty: "", segment: "", shifters: [], nums: [] });
  const [cost, setCost] = useState(COLAB_COST);
  const [current, setCurrent] = useState("");
  const [units, setUnits] = useState(false);
  const [sales, setSales] = useState(DEFAULT_SALES);
  const [offers, setOffers] = useState(DEFAULT_OFFERS);
  const [seed, setSeed] = useState(42);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState((params.get("session") || "").toUpperCase());
  const [live, setLive] = useState(false);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef(null);

  /* ── Loading data ── */
  const takeRows = useCallback((name, rows, kindIs, mapping, extra = {}) => {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    setRaw({ name, headers, rows, ...extra });
    setKind(kindIs);
    setMap({ shifters: [], nums: [], segment: "", ...mapping });
    setErr("");
  }, []);

  const loadColab = useCallback((withRain) => {
    const rows = COLAB_PAIRS.map(([price, units], i) => ({
      day: i + 1, price, units, ...(withRain ? { weather: COLAB_RAIN[i] ? "rain" : "no rain" } : {}),
    }));
    takeRows(withRain ? "Colab — 14 days with rain" : "Colab — 14 days", rows, "sales",
      { price: "price", qty: "units", segment: withRain ? "weather" : "" });
    setCost(COLAB_COST);
    setCurrent("");
  }, [takeRows]);

  const runSales = useCallback((cfg = sales, s = seed) => {
    const sim = {
      ...cfg,
      eps: cfg.segment.levels[0]?.eps ?? -2,
      segment: cfg.useSegment ? cfg.segment : null,
    };
    const rows = simulateSales(sim, s);
    const truth = cfg.useSegment
      ? Object.fromEntries(cfg.segment.levels.map((l) => [l.name, Number(l.eps)]))
      : { all: Number(sim.eps) };
    takeRows(`Simulated sales — ${cfg.product}`, rows, "sales", {
      price: "price", qty: "units", segment: cfg.useSegment ? cfg.segment.name : "",
      shifters: (cfg.shifters ?? []).map((x) => x.name), nums: cfg.nums.map((x) => ({ col: x.name, log: true })),
    }, { truth, truthKind: "sales", truthNums: Object.fromEntries(cfg.nums.map((x) => [x.name, Number(x.eff)])) });
  }, [sales, seed, takeRows]);

  const runOffers = useCallback((cfg = offers, s = seed) => {
    const rows = simulateOffers({ ...cfg, segment: cfg.useSegment ? cfg.segment : null }, s);
    takeRows(`Simulated class — ${cfg.product}`, rows, "offers", {
      price: "price", qty: "accept", segment: cfg.useSegment ? cfg.segment.name : "",
    }, { truthKind: "offers", truthOffers: { sigma: cfg.sigma, wtp: cfg.wtp, levels: cfg.useSegment ? cfg.segment.levels : null } });
    setCurrent(String(cfg.start));
  }, [offers, seed, takeRows]);

  const loadFile = useCallback(async (file) => {
    setLoading(true);
    setErr("");
    try {
      const d = await parseFile(file);
      const rows = d.rows.filter((r) => d.headers.some((h) => !isMissing(r[h])));
      const m = guessMapping(d.headers, rows);
      takeRows(file.name, rows, m.qty && looksBinary(rows, m.qty) ? "offers" : "sales", m);
    } catch (e) {
      setErr(`Could not read that file: ${e.message}`);
    }
    setLoading(false);
  }, [takeRows]);

  const loadSession = useCallback(async (c = code, quiet = false) => {
    const cc = c.trim().toUpperCase();
    if (!isCode(cc)) { setErr("A session code has six letters or digits."); return; }
    if (!quiet) setLoading(true);
    try {
      const d = mergeWithCache(cc, await readSession(cc));
      if (!d.config) throw new Error("There is no session with that code, or it is more than about twelve hours old and was not created on this device.");
      setSessionInfo({ code: cc, config: d.config, open: d.open, n: d.responses.length, fromCache: d.fromCache });
      const seg = d.config.factors[0]?.name ?? "";
      setRaw({ name: `Class session ${cc} — ${d.config.product}`, headers: ["respondent", "price", "accept", ...d.config.factors.map((f) => f.name)], rows: d.responses });
      setKind("offers");
      setMap((m) => (quiet && m.price ? m : { price: "price", qty: "accept", segment: seg, shifters: d.config.factors.slice(1).map((f) => f.name), nums: [] }));
      if (!quiet) { setCurrent(String(d.config.start)); setErr(""); }
    } catch (e) {
      setErr(e.message);
      setLive(false);
    }
    if (!quiet) setLoading(false);
  }, [code]);

  // Live refresh while a class is answering: one open subscription.
  useEffect(() => {
    if (!live || source !== "session" || !isCode(code)) return;
    const cc = code.trim().toUpperCase();
    return watchTopic(cc, (msgs) => {
      const d = mergeWithCache(cc, sessionFromMessages(msgs, hostCache(cc)?.config ?? null));
      if (!d.config) return;
      setSessionInfo({ code: cc, config: d.config, open: d.open, n: d.responses.length, fromCache: d.fromCache });
      setRaw({ name: `Class session ${cc} — ${d.config.product}`, headers: ["respondent", "price", "accept", ...d.config.factors.map((f) => f.name)], rows: d.responses });
    });
  }, [live, source, code]);

  const choose = (id) => {
    setSource(id);
    setErr("");
    if (id === "colab") loadColab(false);
    else if (id === "rain") loadColab(true);
    else if (id === "sim-sales") { runSales(); setCost(1.5); setCurrent("2.5"); }
    else if (id === "sim-offers") { runOffers(); setCost(3); }
    else setRaw(null);
  };

  // Deep link on first render.
  useEffect(() => {
    const demo = params.get("demo");
    if (params.get("session")) { setSource("session"); loadSession(params.get("session")); setLive(params.get("live") === "1"); }
    else if (SOURCES.some((s) => s.id === demo)) {
      choose(demo);
    }
    // After the source has set its own default cost.
    if (params.get("cost")) setTimeout(() => setCost(Number(params.get("cost"))), 0);
  }, []);

  /* ── Model ── */
  const profiles = useMemo(() => (raw ? profileAll(raw.rows, raw.headers) : []), [raw]);
  const numericCols = profiles.filter((p) => p.isNumeric).map((p) => p.key);
  const catCandidates = profiles.filter((p) => p.distinctCount >= 2 && p.distinctCount <= 12 && p.key !== map.price && p.key !== map.qty).map((p) => p.key);

  const prepared = useMemo(() => {
    if (!raw || !map.price || !map.qty) return null;
    const cats = [map.segment, ...map.shifters].filter(Boolean);
    if (kind === "offers") {
      const cells = aggregateOffers(raw.rows.map((r) => ({ ...r, [map.price]: toNum(r[map.price]) })),
        { price: map.price, accept: map.qty, cats });
      return { rows: cells.map((c) => ({ ...c, [map.price]: c.price })), qty: "share", cells, offers: raw.rows.length };
    }
    const rows = raw.rows.map((r) => {
      const o = { ...r, [map.price]: toNum(r[map.price]), [map.qty]: toNum(r[map.qty]) };
      for (const n of map.nums) o[n.col] = toNum(r[n.col]);
      for (const c of cats) o[c] = isMissing(r[c]) ? "" : String(r[c]);
      return o;
    });
    return { rows, qty: map.qty };
  }, [raw, map, kind]);

  const spec = useMemo(() => prepared && ({
    price: map.price, qty: prepared.qty, segment: map.segment || null,
    shifters: map.shifters.filter((s) => s !== map.segment),
    nums: kind === "offers" ? [] : map.nums,
  }), [prepared, map, kind]);

  const fit = useMemo(() => {
    if (!prepared || !spec) return null;
    try { return fitElasticity(prepared.rows, spec); }
    catch (e) { return { error: e.message }; }
  }, [prepared, spec]);

  const ok = fit && !fit.error;
  const qtyLabel = kind === "offers" ? "share accepting" : map.qty || "quantity";
  const currency = sessionInfo?.config?.currency || "€";

  /* Chart groups: one per segment level. */
  const groups = useMemo(() => {
    if (!ok) return [];
    return groupsFromFit(fit, kind === "offers");
  }, [ok, fit, kind]);

  const truthFor = useCallback((s) => {
    if (!raw?.truthKind || !ok) return null;
    if (raw.truthKind === "sales") return raw.truth?.[s.level ?? "all"] ?? null;
    const t = raw.truthOffers;
    const lv = t.levels?.find((l) => l.name === s.level);
    return lognormalElasticity(s.avgPrice, Number(lv ? lv.wtp : t.wtp), Number(t.sigma));
  }, [raw, ok]);

  const profit = useMemo(() => {
    if (!ok || !(cost > 0)) return null;
    const scale = kind === "offers" ? 100 : 1;
    const pMin = Math.min(...fit.bySegment.map((s) => s.minPrice));
    const pMax = Math.max(...fit.bySegment.map((s) => s.maxPrice));
    const opts = fit.bySegment.map((s) => optimalPrice(s.eps, cost)).filter((v) => v != null);
    const lo = Math.max(cost * 1.01, pMin * 0.6);
    const hi = Math.min(Math.max(pMax * 1.4, ...opts.map((o) => o * 1.2)), pMax * 3);
    if (!(hi > lo)) return null;
    return {
      observed: [pMin, pMax],
      curves: fit.bySegment.map((s, i) => ({
        label: groups[i]?.label ?? "all",
        opt: optimalPrice(s.eps, cost),
        pts: Array.from({ length: 160 }, (_, k) => {
          const p = lo + ((hi - lo) * k) / 159;
          return [p, (p - cost) * Math.exp(predictLnQ(fit, s.level, p)) * scale];
        }),
      })),
    };
  }, [ok, fit, cost, kind, groups]);

  /* ── Export ── */
  const deepLink = () => {
    const base = `${window.location.origin}${window.location.pathname}#/elasticity`;
    if (source === "session" && sessionInfo) return `${base}?session=${sessionInfo.code}&cost=${cost}`;
    if (["colab", "rain", "sim-sales", "sim-offers"].includes(source)) return `${base}?demo=${source}&cost=${cost}`;
    return base;
  };

  const report = () => {
    if (!ok) return;
    const segRows = fit.bySegment.map((s) => {
      const opt = optimalPrice(s.eps, cost);
      return [s.level ?? "all", s.n, f2(s.avgPrice), s.eps.toFixed(3), `[${s.lo.toFixed(2)}, ${s.hi.toFixed(2)}]`, pFmt(s.p), opt ? f2(opt) : "none (|ε| ≤ 1)"];
    });
    const coefRows = fit.names.map((n, j) => [n, fit.model.beta[j].toFixed(4), fit.model.se[j].toFixed(4), fit.model.t[j].toFixed(2), pFmt(fit.model.p[j])]);
    const body = `
<section><h2>Elasticity by ${esc(spec.segment || "product")}</h2>
${htmlTable([spec.segment || "segment", "n", "avg price", "ε", "95% CI", "p", `P* (cost ${cost})`], segRows)}
${fit.slopeTest ? `<p>Do the elasticities differ? F(${fit.slopeTest.d1}, ${fit.slopeTest.d2}) = ${fit.slopeTest.F.toFixed(2)}, p = ${pFmt(fit.slopeTest.p)}.</p>` : ""}
</section>
<section><h2>Figures</h2>
${figure(snapshot("el-loglog"), "Log-log regression: the slope of each line is the elasticity.")}
${figure(snapshot("el-demand"), "Fitted demand in original units. The shaded band is the range of prices observed.")}
${figure(snapshot("el-profit"), "Profit against price, with the optimal price P* marked.")}
</section>
<section><h2>Model coefficients</h2>
<p>ln(${esc(qtyLabel)}) regressed on ${esc(fit.names.slice(1).join(", "))}. n = ${fit.model.n}, R² = ${fit.model.r2.toFixed(3)}, adjusted R² = ${fit.model.adjR2.toFixed(3)}.</p>
${htmlTable(["term", "coefficient", "SE", "t", "p"], coefRows)}
</section>`;
    const html = reportShell({
      title: "Elasticity Lab — price elasticity and optimal price",
      metaRows: [
        ["Data", raw.name],
        ["Rows", kind === "offers" ? `${prepared.offers} yes/no answers in ${prepared.cells.length} price cells` : `${fit.rows.length} used of ${raw.rows.length}`],
        ["Price column", map.price], ["Quantity column", `${map.qty}${kind === "offers" ? " (yes/no → share accepting)" : ""}`],
        ["Elasticity by", spec.segment || "—"], ["Demand shifters", [...spec.shifters, ...spec.nums.map((n) => (n.log ? `ln(${n.col})` : n.col))].join(", ") || "—"],
        ["Unit cost", String(cost)], ["Reproduce", deepLink()],
      ],
      body,
    });
    if (!openForPrint(html)) downloadHtml("elasticity_report.html", html);
  };

  /* ── Render ── */
  const setM = (k, v) => setMap((m) => ({ ...m, [k]: v }));
  const toggleShifter = (c) => setM("shifters", map.shifters.includes(c) ? map.shifters.filter((x) => x !== c) : [...map.shifters, c]);
  const toggleNum = (c) => setM("nums", map.nums.some((n) => n.col === c) ? map.nums.filter((n) => n.col !== c) : [...map.nums, { col: c, log: true }]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <style>{`::-webkit-scrollbar{width:7px;height:7px;background:transparent}::-webkit-scrollbar-thumb{background:#252836;border-radius:4px}`}</style>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "34px 22px 90px" }}>
        {!resultsOnly && (
          <>
            <a href="#/" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← all tools</a>
            <h1 style={{ fontSize: 25, margin: "12px 0 7px", fontWeight: 600 }}>Elasticity Lab</h1>
            <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.7, maxWidth: 700, margin: "0 0 8px" }}>
              Estimate a price elasticity from data and turn it into a price. With constant elasticity, demand is
              Q = A·P<sup>ε</sup>, which is a straight line in logarithms — ln Q = a + ε·ln P — so ε is the slope of a
              regression. Add a category (rain / no rain, student / working) and each one can have its own slope;
              add a variable (temperature, a competitor’s price) and it is held constant while ε is measured.
            </p>
            <p style={{ color: C.mut, fontSize: 12.5, lineHeight: 1.7, maxWidth: 700, margin: "0 0 24px" }}>
              Technical note: <em>demand-based theoretical models</em>. Running a class session?{" "}
              <a href="#/price-session" style={{ color: C.acc }}>Open the lecturer’s session page →</a>
            </p>
          </>
        )}

        {/* ── 1. Data ── */}
        {!resultsOnly && (
          <Section title="1 · Data" note={raw ? `${raw.name} — ${raw.rows.length} rows` : "Where the prices and quantities come from."}>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12 }}>
              {SOURCES.map((s) => <Chip key={s.id} active={source === s.id} onClick={() => choose(s.id)} title={s.blurb}>{s.label}</Chip>)}
            </div>
            {source && <p style={{ fontSize: 12, color: C.mut, margin: "0 0 12px", lineHeight: 1.6 }}>{SOURCES.find((s) => s.id === source)?.blurb}</p>}

            {source === "sim-sales" && <SalesDesigner cfg={sales} setCfg={setSales} seed={seed} setSeed={setSeed}
              onRun={(c, s) => runSales(c, s)} />}
            {source === "sim-offers" && <OffersDesigner cfg={offers} setCfg={setOffers} seed={seed} setSeed={setSeed}
              onRun={(c, s) => runOffers(c, s)} />}

            {source === "upload" && (
              <div style={{ marginBottom: 10 }}>
                <button onClick={() => fileRef.current?.click()} style={primaryBtn}>Upload CSV / Excel</button>
                <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" style={{ display: "none" }}
                  onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
                <span style={{ fontSize: 11.5, color: C.mut, marginLeft: 10 }}>
                  One row per observation: a price and a quantity sold — or a yes/no answer (0/1) to a price offer.
                </span>
              </div>
            )}

            {source === "session" && (
              <div style={{ display: "flex", gap: 9, alignItems: "end", flexWrap: "wrap", marginBottom: 10 }}>
                <Field label="session code">
                  <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6}
                    style={{ ...inp, width: 110, fontFamily: MONO, fontSize: 15, letterSpacing: 2 }} />
                </Field>
                <button onClick={() => loadSession()} style={primaryBtn}>Load answers</button>
                {sessionInfo && (
                  <label style={{ fontSize: 12, color: C.mut, display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
                    update live while the class answers
                  </label>
                )}
                {sessionInfo && <span style={{ fontSize: 12, color: sessionInfo.open ? C.good : C.mut }}>
                  {sessionInfo.n} answers · {sessionInfo.open ? "open" : "closed"}{sessionInfo.fromCache ? " · saved copy" : ""}
                </span>}
              </div>
            )}

            {loading && <Spinner label="Loading…" />}
            {err && <Callout tone="bad" title="Problem">{err}</Callout>}
            {raw && raw.rows.length > 0 && (
              <Table head={raw.headers.slice(0, 8)} maxHeight={170}
                rows={raw.rows.slice(0, 5).map((r) => raw.headers.slice(0, 8).map((h) => String(r[h] ?? "").slice(0, 20)))} />
            )}
          </Section>
        )}

        {/* ── 2. Model ── */}
        {raw && !resultsOnly && (
          <Section title="2 · Model" note="Which column is the price, which is the quantity, and what else moves demand.">
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", marginBottom: 12 }}>
              <Field label="price">
                <select value={map.price} onChange={(e) => setM("price", e.target.value)} style={inp}>
                  <option value="">—</option>
                  {numericCols.map((h) => <option key={h}>{h}</option>)}
                </select>
              </Field>
              <Field label="quantity" hint={kind === "offers" ? "yes/no answers — each price becomes a share of acceptances" : "units sold, demand"}>
                <select value={map.qty} onChange={(e) => { setM("qty", e.target.value); setKind(looksBinary(raw.rows, e.target.value) ? "offers" : "sales"); }} style={inp}>
                  <option value="">—</option>
                  {raw.headers.filter((h) => h !== map.price).map((h) => <option key={h}>{h}</option>)}
                </select>
              </Field>
              <Field label="elasticity by category" hint="each level gets its own slope (and its own level)">
                <select value={map.segment} onChange={(e) => setM("segment", e.target.value)} style={inp}>
                  <option value="">— one elasticity for all —</option>
                  {catCandidates.map((h) => <option key={h}>{h}</option>)}
                </select>
              </Field>
              <Field label="unit cost" hint="for the optimal price">
                <input type="number" step="any" value={cost} onChange={(e) => setCost(Number(e.target.value))} style={inp} />
              </Field>
              <Field label="current price" hint="optional, marked on the profit curve">
                <input type="number" step="any" value={current} onChange={(e) => setCurrent(e.target.value)} style={inp} />
              </Field>
            </div>

            {catCandidates.filter((c) => c !== map.segment).length > 0 && (
              <div style={{ marginBottom: 11 }}>
                <div style={miniLabel}>categories that only shift demand (same elasticity)</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {catCandidates.filter((c) => c !== map.segment).map((c) => (
                    <Chip key={c} active={map.shifters.includes(c)} onClick={() => toggleShifter(c)}>{c}</Chip>
                  ))}
                </div>
              </div>
            )}

            {kind === "sales" && numericCols.filter((c) => c !== map.price && c !== map.qty && c !== map.segment && !map.shifters.includes(c)).length > 0 && (
              <div>
                <div style={miniLabel}>numeric variables that move demand</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {numericCols.filter((c) => c !== map.price && c !== map.qty && c !== map.segment && !map.shifters.includes(c)).map((c) => {
                    const on = map.nums.find((n) => n.col === c);
                    return (
                      <span key={c} style={{ display: "inline-flex", gap: 3 }}>
                        <Chip active={!!on} onClick={() => toggleNum(c)}>{c}</Chip>
                        {on && <Chip active={on.log} title="enter as ln(x): the coefficient is then an elasticity"
                          onClick={() => setM("nums", map.nums.map((n) => (n.col === c ? { ...n, log: !n.log } : n)))}>{on.log ? "ln" : "linear"}</Chip>}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {kind === "offers" && (
              <Callout tone="info">
                Yes/no answers are grouped by price{map.segment || map.shifters.length ? " and category" : ""}: the share of
                offers accepted at each price is the demand. {prepared?.cells && `${prepared.offers} answers → ${prepared.cells.length} cells.`}
                {" "}Numeric variables are not available here — they vary person to person and cannot be averaged into a cell.
              </Callout>
            )}
          </Section>
        )}

        {fit?.error && <Callout tone="bad" title="The model cannot be fitted">{fit.error}</Callout>}

        {/* ── 3. Results ── */}
        {ok && <Results fit={fit} spec={spec} kind={kind} cost={cost} current={Number(current)} groups={groups}
          profit={profit} units={units} setUnits={setUnits} qtyLabel={qtyLabel} truthFor={truthFor} raw={raw}
          prepared={prepared} currency={currency} />}

        {/* ── 4. Report ── */}
        {ok && !resultsOnly && (
          <Section title="4 · Take it with you">
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={report} style={primaryBtn}>Printable report</button>
              <button onClick={() => download(`elasticity_data.csv`, toCSV(kind === "offers" ? prepared.cells : fit.rows,
                kind === "offers" ? ["price", ...[spec.segment, ...spec.shifters].filter(Boolean), "offers", "accepts", "share"] : raw.headers))} style={ghostBtn}>
                Download the data (CSV)
              </button>
              <button onClick={() => { navigator.clipboard?.writeText(deepLink()); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={ghostBtn}>
                {copied ? "Copied" : "Copy link to this analysis"}
              </button>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

/* ── Results ── */

function Results({ fit, spec, kind, cost, current, groups, profit, units, setUnits, qtyLabel, truthFor, raw, prepared, currency }) {
  const m = fit.model;
  const segName = spec.segment;
  const hasTruth = !!raw?.truthKind;
  const zeroCells = prepared?.cells?.filter((c) => c.zeroFixed).length ?? 0;
  const dropped = fit.dropped.nonPositive + fit.dropped.missing;

  const segRows = fit.bySegment.map((s, i) => {
    const opt = optimalPrice(s.eps, cost);
    const st = clusterStyle(i);
    const truth = truthFor(s);
    const outside = opt != null && (opt < s.minPrice * 0.97 || opt > s.maxPrice * 1.03);
    return [
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        {fit.bySegment.length > 1 && <span style={{ width: 9, height: 9, background: st.color, borderRadius: st.shape === "circle" ? "50%" : 2, display: "inline-block" }} />}
        <strong>{s.level ?? "all"}</strong>
      </span>,
      s.n,
      `${f2(s.minPrice)}–${f2(s.maxPrice)}`,
      <strong style={{ color: s.eps < -1 ? C.txt : C.warn }}>{s.eps.toFixed(2)}</strong>,
      <span style={{ color: s.lo < -1 && s.hi > -1 ? C.warn : C.txt }}>[{s.lo.toFixed(2)}, {s.hi.toFixed(2)}]</span>,
      pFmt(s.p),
      s.eps < -1 ? "elastic" : s.eps < 0 ? <span style={{ color: C.warn }}>inelastic</span> : <span style={{ color: C.bad }}>positive?</span>,
      opt != null ? <span style={{ color: outside ? C.warn : C.good }}>{f2(opt)} {currency}{outside ? " ⚠" : ""}</span> : <span style={{ color: C.mut }}>none</span>,
      opt != null ? `${((opt - cost) / opt * 100).toFixed(0)}%` : "—",
      ...(hasTruth ? [Number.isFinite(truth) ? truth.toFixed(2) : "—"] : []),
    ];
  });

  const coefRows = fit.names.map((n, j) => [
    <span style={{ fontFamily: MONO, fontSize: 11.5 }}>{n}</span>,
    m.beta[j].toFixed(4), m.se[j].toFixed(4), m.t[j].toFixed(2),
    <span style={{ color: m.p[j] < 0.05 ? C.good : C.mut }}>{pFmt(m.p[j])}</span>,
    <span style={{ color: C.mut, whiteSpace: "normal", display: "inline-block", maxWidth: 360, textAlign: "left" }}>
      {readCoef(n, m.beta[j], spec, fit, raw)}
    </span>,
  ]);

  const inelastic = fit.bySegment.filter((s) => s.eps >= -1);
  const ambiguous = fit.bySegment.filter((s) => s.eps < -1 && s.hi > -1);
  const outsideAny = fit.bySegment.some((s) => {
    const o = optimalPrice(s.eps, cost);
    return o != null && (o < s.minPrice * 0.97 || o > s.maxPrice * 1.03);
  });

  return (
    <>
      <Section title="3 · Results" note={`${m.n} observations${kind === "offers" ? " (price cells)" : ""} · ${m.k} coefficients · R² ${m.r2.toFixed(3)} · adjusted R² ${m.adjR2.toFixed(3)}`}
        right={<div style={{ display: "flex", gap: 5 }}>
          <Chip active={!units} onClick={() => setUnits(false)}>ln values</Chip>
          <Chip active={units} onClick={() => setUnits(true)}>{currency} and units, log axes</Chip>
        </div>}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          {fit.bySegment.slice(0, 4).map((s) => (
            <Stat key={s.level ?? "all"} label={s.level == null ? "elasticity" : `elasticity · ${s.level}`} value={s.eps.toFixed(2)}
              hint={`95% CI ${s.lo.toFixed(2)} to ${s.hi.toFixed(2)}`} tone={s.eps < -1 ? undefined : "warn"} />
          ))}
          {fit.bySegment.slice(0, 3).map((s) => {
            const o = optimalPrice(s.eps, cost);
            return <Stat key={`o${s.level}`} label={s.level == null ? "optimal price" : `P* · ${s.level}`}
              value={o != null ? `${f2(o)}` : "—"} hint={o != null ? `cost ${cost} · markup ${((o / cost - 1) * 100).toFixed(0)}%` : "|ε| ≤ 1: no finite optimum"} tone={o != null ? "good" : "warn"} />;
          })}
        </div>

        <LogLogChart groups={groups} units={units} priceLabel={spec.price} qtyLabel={qtyLabel} captureId="el-loglog" />
        <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, margin: "8px 0 0" }}>
          Each line is the model’s prediction for that {segName ? "category" : "product"} with every other variable at its
          average; its slope is the elasticity. {kind === "offers" && "Marker size grows with the number of offers at that price. "}
          {spec.nums.length > 0 && "Points scatter around the lines partly because the numeric variables vary from row to row."}
        </p>

        {dropped > 0 && <Callout tone="warn">{dropped} row{dropped > 1 ? "s were" : " was"} left out: {fit.dropped.nonPositive > 0 && `${fit.dropped.nonPositive} with a zero or negative value (a logarithm needs positive numbers)`}{fit.dropped.nonPositive > 0 && fit.dropped.missing > 0 && ", "}{fit.dropped.missing > 0 && `${fit.dropped.missing} with a missing value`}.</Callout>}
        {zeroCells > 0 && <Callout tone="warn">{zeroCells} price cell{zeroCells > 1 ? "s" : ""} had no acceptances at all. They are plotted (faded) at half an acceptance so the logarithm exists; dropping them instead would flatten the curve at exactly the prices that show demand dying.</Callout>}
        {m.n < 12 && <Callout tone="warn">Only {m.n} observations. The interval around each elasticity is the honest measure of how little that is.</Callout>}
      </Section>

      <Section title={`Elasticity ${segName ? `by ${segName}` : ""} and optimal price`}
        note={<>P* = c·ε / (1 + ε) with unit cost c = {cost}. It only exists when demand is elastic (ε &lt; −1); the markup it implies over cost is 1/|ε| of the price.</>}>
        <Table head={[segName || "", "n", "prices seen", "elasticity", "95% CI", "p", "reading", "P*", "margin at P*", ...(hasTruth ? ["true value"] : [])]} rows={segRows} />
        {hasTruth && raw.truthKind === "offers" && (
          <p style={{ fontSize: 11.5, color: C.mut, marginTop: 7, lineHeight: 1.6 }}>
            “True ε” for simulated respondents is the elasticity of the log-normal willingness-to-pay curve at the average
            price offered. It is not constant — the curve bends — so the regression line is an approximation over the prices
            actually offered.
          </p>
        )}
        {inelastic.length > 0 && (
          <Callout tone="warn" title={`Inelastic: ${inelastic.map((s) => s.level ?? "the product").join(", ")}`}>
            With |ε| ≤ 1 a price rise increases revenue and lowers cost, so the formula has no optimum: the model says
            “keep raising the price”. In reality something the data does not see stops you — a competitor, the
            willingness-to-pay ceiling, a price the brand cannot hold. Test higher prices before trusting this.
          </Callout>
        )}
        {ambiguous.length > 0 && (
          <Callout tone="warn" title="Elastic or not? The data cannot say">
            The 95% interval for {ambiguous.map((s) => s.level ?? "the product").join(", ")} includes −1. The optimal price
            shown depends on a point estimate that the data does not pin down.
          </Callout>
        )}
        {outsideAny && (
          <Callout tone="warn" title="⚠ Optimal price outside the prices observed">
            The constant-elasticity curve is being extrapolated. Nothing in the data says demand keeps the same elasticity
            there — test that price before setting it.
          </Callout>
        )}
      </Section>

      {fit.slopeTest && (
        <Section title={`Do the ${segName} categories really differ?`}
          note="Two nested comparisons of the full model against simpler ones, each with an F test.">
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
            <Verdict title="Different elasticities (slopes)" test={fit.slopeTest}
              yes={`The price sensitivity of ${segName} categories differs significantly. Pricing them differently is supported by the data.`}
              no={`The data cannot tell the slopes apart. Different prices per ${segName} would rest on the point estimates, not on evidence — collect more observations or use one elasticity.`} />
            <Verdict title={`Any effect of ${segName} (level or slope)`} test={fit.levelTest}
              yes={`${segName} matters for demand.`} no={`With this data ${segName} does not detectably move demand at all.`} />
          </div>
          {fit.separate && (
            <>
              <h3 style={{ fontSize: 12.5, margin: "16px 0 8px", fontWeight: 600 }}>The Colab way: one regression per category</h3>
              <Table head={[segName, "n", "separate regression", "one model with interaction", "R² separate"]}
                rows={fit.separate.map((s) => [s.level, s.n, f2(s.eps), f2(fit.bySegment.find((b) => b.level === s.level)?.eps), Number.isFinite(s.r2) ? s.r2.toFixed(3) : "—"])} />
              <p style={{ fontSize: 11.5, color: C.mut, marginTop: 7, lineHeight: 1.6 }}>
                {spec.shifters.length || spec.nums.length
                  ? "They differ here because the one-model version also holds the other variables constant; the separate regressions ignore them."
                  : "Identical slopes: the separate regressions and the model with interactions are the same fit. The single model is what makes the F test above possible, because it has one residual variance for both."}
              </p>
            </>
          )}
        </Section>
      )}

      <Section title="Demand and profit" note="Back in euros and units. The shaded band is the range of prices in the data.">
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))" }}>
          <div>
            <div style={miniLabel}>fitted demand</div>
            <DemandChart groups={groups} priceLabel={spec.price} qtyLabel={qtyLabel} captureId="el-demand" />
          </div>
          <div>
            <div style={miniLabel}>profit = (P − c) · Q(P)</div>
            {profit ? <ProfitChart curves={profit.curves} observed={profit.observed} cost={cost} current={current} currency={currency}
              yLabel={kind === "offers" ? "profit per 100 people offered" : "profit per observation"} captureId="el-profit" />
              : <Callout tone="info">Enter a unit cost to see the profit curve.</Callout>}
          </div>
        </div>
      </Section>

      <Section title="All coefficients" note={`ln(${qtyLabel}) = the sum of these terms. Green p-values are below 0.05.`}>
        <Table head={["term", "coefficient", "SE", "t", "p", "how to read it"]} rows={coefRows} />
      </Section>
    </>
  );
}

function Verdict({ title, test, yes, no }) {
  if (!test) return null;
  const sig = test.p < 0.05;
  return (
    <div style={{ ...card, background: C.surf, borderLeft: `3px solid ${sig ? C.good : C.warn}` }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.mut, marginBottom: 6 }}>
        F({test.d1}, {test.d2}) = {test.F.toFixed(2)} · p = {pFmt(test.p)}
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.6 }}>{sig ? yes : no}</div>
    </div>
  );
}

/* Plain-language reading of each term, so a coefficient table is not a wall
 * of numbers. */
function readCoef(name, b, spec, fit, raw) {
  const seg = spec.segment;
  const base = fit.segLevels?.[0];
  const pctShift = `${((Math.exp(b) - 1) * 100).toFixed(1)}%`;
  if (name === "const") return "ln Q when every other term is zero — no business meaning on its own.";
  if (name === LN_P) return seg ? `The elasticity for the reference category (${seg} = ${base}).` : "The price elasticity: +1% price → this % change in quantity.";
  if (name.startsWith(`${LN_P} × `)) return `How much more (or less) price-sensitive this category is than ${seg} = ${base}. Add it to ln(price) to get its elasticity.`;
  if (seg && name.startsWith(`${seg}=`)) return `Level difference at a price of 1 — not interpretable alone once the slopes differ; read the lines on the chart.`;
  if (name.startsWith("ln(")) {
    const truth = raw?.truthNums?.[name.slice(3, -1)];
    return `An elasticity: +1% in ${name.slice(3, -1)} → ${b.toFixed(2)}% in quantity, price held constant.${truth != null ? ` (Simulated with ${truth}.)` : ""}`;
  }
  if (name.includes("=")) return `Same price, demand is ${pctShift} ${b >= 0 ? "higher" : "lower"} than the reference level.`;
  return `+1 unit of ${name} → ${pctShift} in quantity.`;
}

/* ── Simulation designers ── */

function SalesDesigner({ cfg, setCfg, seed, setSeed, onRun }) {
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  const setLevel = (i, k, v) => setCfg((c) => ({ ...c, segment: { ...c.segment, levels: c.segment.levels.map((l, j) => (j === i ? { ...l, [k]: v } : l)) } }));
  const setNum = (i, k, v) => setCfg((c) => ({ ...c, nums: c.nums.map((n, j) => (j === i ? { ...n, [k]: v } : n)) }));
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
      <div style={grid}>
        <Field label="product"><input value={cfg.product} onChange={(e) => set("product", e.target.value)} style={inp} /></Field>
        <Field label="observations (days)"><NumIn v={cfg.n} on={(v) => set("n", Math.max(5, Math.round(v)))} /></Field>
        <Field label="lowest price"><NumIn v={cfg.pMin} on={(v) => set("pMin", v)} /></Field>
        <Field label="highest price"><NumIn v={cfg.pMax} on={(v) => set("pMax", v)} /></Field>
        <Field label="units sold at reference price" hint={`reference price ${cfg.pRef}`}><NumIn v={cfg.qRef} on={(v) => set("qRef", v)} /></Field>
        <Field label="noise" hint="sd of ln Q; 0.1 ≈ ±10% day to day"><NumIn v={cfg.noise} on={(v) => set("noise", v)} /></Field>
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: 12, display: "flex", gap: 7, alignItems: "center", marginBottom: 7 }}>
          <input type="checkbox" checked={cfg.useSegment} onChange={(e) => set("useSegment", e.target.checked)} />
          a category with its own elasticity
          {cfg.useSegment && <input value={cfg.segment.name} onChange={(e) => setCfg((c) => ({ ...c, segment: { ...c.segment, name: e.target.value.replace(/\s+/g, "_") } }))} style={{ ...inp, width: 130 }} />}
        </label>
        {cfg.useSegment ? (
          <LevelTable levels={cfg.segment.levels} cols={[["name", "level", "text"], ["eps", "true ε", "num"], ["shift", "demand × (same price)", "num"], ["share", "% of days", "num"]]}
            onChange={setLevel}
            onAdd={() => setCfg((c) => ({ ...c, segment: { ...c.segment, levels: [...c.segment.levels, { name: `level${c.segment.levels.length + 1}`, eps: -2, shift: 1, share: 30 }] } }))}
            onRemove={(i) => setCfg((c) => ({ ...c, segment: { ...c.segment, levels: c.segment.levels.filter((_, j) => j !== i) } }))} />
        ) : (
          <Field label="true elasticity ε"><NumIn v={cfg.segment.levels[0]?.eps ?? -2} on={(v) => setLevel(0, "eps", v)} /></Field>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={miniLabel}>numeric variables that move demand · Q ∝ (x / midpoint)^effect</div>
        <LevelTable levels={cfg.nums} cols={[["name", "variable", "text"], ["min", "min", "num"], ["max", "max", "num"], ["eff", "effect (an elasticity)", "num"]]}
          onChange={setNum}
          onAdd={() => setCfg((c) => ({ ...c, nums: [...c.nums, { name: `x${c.nums.length + 1}`, min: 1, max: 10, eff: 0.2 }] }))}
          onRemove={(i) => setCfg((c) => ({ ...c, nums: c.nums.filter((_, j) => j !== i) }))} />
      </div>

      <div style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 12 }}>
        <button onClick={() => onRun(cfg, seed)} style={primaryBtn}>Generate data</button>
        <button onClick={() => { const s = seed + 1; setSeed(s); onRun(cfg, s); }} style={ghostBtn}>New sample</button>
        <span style={{ fontSize: 11, color: C.mut, fontFamily: MONO }}>seed {seed}</span>
      </div>
    </div>
  );
}

function OffersDesigner({ cfg, setCfg, seed, setSeed, onRun }) {
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  const setLevel = (i, k, v) => setCfg((c) => ({ ...c, segment: { ...c.segment, levels: c.segment.levels.map((l, j) => (j === i ? { ...l, [k]: v } : l)) } }));
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
      <div style={grid}>
        <Field label="product"><input value={cfg.product} onChange={(e) => set("product", e.target.value)} style={inp} /></Field>
        <Field label="respondents"><NumIn v={cfg.respondents} on={(v) => set("respondents", Math.max(2, Math.round(v)))} /></Field>
        <Field label="start price"><NumIn v={cfg.start} on={(v) => set("start", v)} /></Field>
        <Field label="range ± %" hint="prices offered from start −% to start +%"><NumIn v={cfg.rangePct} on={(v) => set("rangePct", v)} /></Field>
        <Field label="price levels"><NumIn v={cfg.levels} on={(v) => set("levels", Math.max(3, Math.round(v)))} /></Field>
        <Field label="offers per respondent"><NumIn v={cfg.offersEach} on={(v) => set("offersEach", Math.max(1, Math.round(v)))} /></Field>
        <Field label="spread of WTP" hint="sd of ln WTP"><NumIn v={cfg.sigma} on={(v) => set("sigma", v)} /></Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: 12, display: "flex", gap: 7, alignItems: "center", marginBottom: 7 }}>
          <input type="checkbox" checked={cfg.useSegment} onChange={(e) => set("useSegment", e.target.checked)} />
          respondents belong to categories
          {cfg.useSegment && <input value={cfg.segment.name} onChange={(e) => setCfg((c) => ({ ...c, segment: { ...c.segment, name: e.target.value.replace(/\s+/g, "_") } }))} style={{ ...inp, width: 130 }} />}
        </label>
        {cfg.useSegment ? (
          <LevelTable levels={cfg.segment.levels} cols={[["name", "category", "text"], ["wtp", "median WTP", "num"], ["share", "% of respondents", "num"]]}
            onChange={setLevel}
            onAdd={() => setCfg((c) => ({ ...c, segment: { ...c.segment, levels: [...c.segment.levels, { name: `group${c.segment.levels.length + 1}`, wtp: c.start, share: 30 }] } }))}
            onRemove={(i) => setCfg((c) => ({ ...c, segment: { ...c.segment, levels: c.segment.levels.filter((_, j) => j !== i) } }))} />
        ) : (
          <Field label="median willingness to pay"><NumIn v={cfg.wtp} on={(v) => set("wtp", v)} /></Field>
        )}
      </div>
      <div style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 12 }}>
        <button onClick={() => onRun(cfg, seed)} style={primaryBtn}>Run the virtual class</button>
        <button onClick={() => { const s = seed + 1; setSeed(s); onRun(cfg, s); }} style={ghostBtn}>New class</button>
        <span style={{ fontSize: 11, color: C.mut, fontFamily: MONO }}>seed {seed}</span>
      </div>
    </div>
  );
}

function LevelTable({ levels, cols, onChange, onAdd, onRemove }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols.length}, minmax(80px, 1fr)) 28px`, gap: 6, alignItems: "center" }}>
        {cols.map((c) => <span key={c[0]} style={{ ...miniLabel, marginBottom: 0 }}>{c[1]}</span>)}
        <span />
        {levels.map((l, i) => (
          <Row key={i}>
            {cols.map(([k, , t]) => t === "text"
              ? <input key={k} value={l[k]} onChange={(e) => onChange(i, k, e.target.value.replace(/\s+/g, "_"))} style={inp} />
              : <NumIn key={k} v={l[k]} on={(v) => onChange(i, k, v)} />)}
            <button onClick={() => onRemove(i)} title="remove" style={{ ...ghostBtn, padding: "4px 7px" }}>×</button>
          </Row>
        ))}
      </div>
      {levels.length < 5 && <button onClick={onAdd} style={{ ...ghostBtn, marginTop: 7, fontSize: 11.5 }}>+ add</button>}
    </div>
  );
}
const Row = ({ children }) => <>{children}</>;

function NumIn({ v, on }) {
  const [s, setS] = useState(String(v));
  useEffect(() => { setS((cur) => (toNum(cur) === Number(v) ? cur : String(v))); }, [v]);
  return <input value={s} inputMode="decimal" style={inp}
    onChange={(e) => { setS(e.target.value); const n = toNum(e.target.value); if (Number.isFinite(n)) on(n); }} />;
}

const primaryBtn = { background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6, padding: "8px 15px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const ghostBtn = { background: C.card, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6, padding: "7px 13px", fontSize: 12.5, cursor: "pointer" };
const miniLabel = { fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 };
const grid = { display: "grid", gap: 11, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" };

