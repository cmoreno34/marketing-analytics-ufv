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
  simulateSales, simulateOffers, repeatSales, lognormalElasticity, COLAB_PAIRS, COLAB_RAIN, COLAB_COST, LN_P,
} from "../lib/elasticity.js";
import { isRoomCode, roomData, answerRows, situationsOf } from "../lib/room.js";
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
  product: "Cinema ticket", respondents: 60, start: 8, rangePct: 35, levels: 7, offersEach: 7, groupSize: 5, sigma: 0.3, wtp: 8,
  useSegment: true,
  segment: { name: "profile", levels: [
    { name: "student", wtp: 6.5, share: 55 },
    { name: "working", wtp: 9.5, share: 45 },
  ] },
};

/* Each source says what it is and what it is for, so a student opening the
 * page can choose without knowing the course history. */
const SOURCES = [
  { id: "colab", group: "Examples from the technical note", label: "Colab: 14 days",
    what: "A shop sold at 14 slightly different prices on 14 days (the example of section 10 of the note). Unit cost 1.8.",
    learn: "The basic method: the slope of ln Q on ln P is the elasticity, and P* = c·ε/(1+ε)." },
  { id: "rain", group: "Examples from the technical note", label: "Colab: 14 days + rain",
    what: "The same 14 days, knowing whether it rained. Rain changes demand.",
    learn: "One elasticity per category, and whether the difference is real (F test) — with only 14 days, it is not." },
  { id: "sim-sales", group: "Simulations — you decide the truth", label: "Simulate sales",
    what: "You set the true elasticity of each category and the variables that move demand; the computer generates daily sales with noise.",
    learn: "Whether the regression recovers the elasticity you set, and how many observations that takes." },
  { id: "sim-offers", group: "Simulations — you decide the truth", label: "Simulate a class",
    what: "Virtual students with a willingness to pay answer yes or no to prices around a start price — the live room played by the computer.",
    learn: "What a live class will produce, before running it; why the curve bends at the ends." },
  { id: "session", group: "Real data", label: "Your class’s live room",
    what: "The groups your class answered in a live price room: each closed group is one point.",
    learn: "Your own class’s elasticity, one line per situation (e.g. raining / not raining)." },
  { id: "upload", group: "Real data", label: "Upload a file",
    what: "Any CSV or Excel with a price column and a quantity column (or a yes/no answer to a price).",
    learn: "The elasticity of your own product or market." },
];

/* The sales simulation as the library wants it: one elasticity when there is
 * no category (the first level's), the category only when it is switched on. */
const salesSim = (cfg) => ({ ...cfg, eps: cfg.segment.levels[0]?.eps ?? -2, segment: cfg.useSegment ? cfg.segment : null });

/* Ready-made experiments: each changes one thing and says what to look at. */
const SEG = (dry, rain) => ({ name: "weather", levels: [{ name: "dry", eps: dry, shift: 1, share: 50 }, { name: "rain", eps: rain, shift: 1, share: 50 }] });
const SALES_EXPERIMENTS = [
  { label: "Like the Colab: 14 days, close prices", look: "Prices only between 2.40 and 2.73 and 14 days: the estimate can land far from your true −2.5 and the 95% interval is wide.",
    cfg: { n: 14, pMin: 2.4, pMax: 2.73, pRef: 2.5, qRef: 50, noise: 0.1, useSegment: false, nums: [], segment: SEG(-2.5, -1.5) } },
  { label: "The same with 300 days", look: "Same prices, 20 times the data: the interval shrinks to about a quarter (√(300/14) ≈ 4.6). More data buys precision, slowly.",
    cfg: { n: 300, pMin: 2.4, pMax: 2.73, pRef: 2.5, qRef: 50, noise: 0.1, useSegment: false, nums: [], segment: SEG(-2.5, -1.5) } },
  { label: "14 days, prices far apart", look: "Back to 14 days, but prices from 1.80 to 3.50: the interval is as narrow as with hundreds of days. Trying different prices is the cheapest information a firm can buy.",
    cfg: { n: 14, pMin: 1.8, pMax: 3.5, pRef: 2.5, qRef: 50, noise: 0.1, useSegment: false, nums: [], segment: SEG(-2.5, -1.5) } },
  { label: "Rain vs dry: can the data tell?", look: "True ε −2.5 when dry and −1.5 when raining, 30 days, noise 0.2. Does each interval contain its true value? Does the F test see the difference? Then try 300 days, and Repeat 200 times to see how often it is detected.",
    cfg: { n: 30, pMin: 2.1, pMax: 3.3, pRef: 2.5, qRef: 50, noise: 0.2, useSegment: true, nums: [],
      segment: SEG(-2.5, -1.5) } },
  { label: "An inelastic product", look: "True ε −0.6: there is no optimal price — the formula needs ε < −1. The Lab warns you instead of inventing a price.",
    cfg: { n: 60, pMin: 2.1, pMax: 3.3, pRef: 2.5, qRef: 50, noise: 0.12, useSegment: false, nums: [], segment: SEG(-0.6, -0.4) } },
  { label: "Another variable moves demand", look: "Temperature changes sales every day (effect −0.3: 1% hotter, 0.3% fewer coffees). In step 2, untick temperature: ε barely moves, because temperature is unrelated to price here, but the interval widens — what the model cannot explain becomes noise.",
    cfg: { n: 60, pMin: 2.1, pMax: 3.3, pRef: 2.5, qRef: 50, noise: 0.08, useSegment: false, nums: [{ name: "temperature", min: 8, max: 30, eff: -0.3 }], segment: SEG(-2.5, -1.5) } },
];

const OFFER_EXPERIMENTS = [
  { label: "As the live room does it", look: "50 students, 5 rounds, groups of 5, prices ±50% around 8 €: about 50 points, the same as a real class. This is what the lecturer's screen will look like.",
    cfg: { respondents: 50, start: 8, rangePct: 50, levels: 7, offersEach: 5, groupSize: 5, sigma: 0.35, wtp: 8, useSegment: false } },
  { label: "Range too narrow (±10%)", look: "Every price is close to what people pay: the share of yes hardly changes, the points form a cloud and the slope is badly measured.",
    cfg: { respondents: 50, start: 8, rangePct: 10, levels: 7, offersEach: 5, groupSize: 5, sigma: 0.35, wtp: 8, useSegment: false } },
  { label: "Range too wide (±85%)", look: "Cheap prices: everybody buys; expensive ones: nobody does. The points bend away from a straight line at both ends — the constant-elasticity line is only an approximation.",
    cfg: { respondents: 50, start: 8, rangePct: 85, levels: 7, offersEach: 5, groupSize: 5, sigma: 0.35, wtp: 8, useSegment: false } },
  { label: "Students who all agree", look: "Spread of WTP 0.1: everyone would pay about the same, so demand falls off a cliff around 8 € — very elastic.",
    cfg: { respondents: 50, start: 8, rangePct: 40, levels: 7, offersEach: 5, groupSize: 5, sigma: 0.1, wtp: 8, useSegment: false } },
  { label: "Start price far too high", look: "Start at 14 € when people would pay about 8 €: most answers are no and the curve is measured only where demand is dying. Choose the start price near what people pay.",
    cfg: { respondents: 50, start: 14, rangePct: 40, levels: 7, offersEach: 5, groupSize: 5, sigma: 0.35, wtp: 8, useSegment: false } },
  { label: "Two kinds of buyer", look: "Students (median 6.5 €) and working people (9.5 €): choose profile as the category in step 2 to get one line and one optimal price each.",
    cfg: { respondents: 60, start: 8, rangePct: 35, levels: 7, offersEach: 7, groupSize: 5, sigma: 0.3, wtp: 8, useSegment: true } },
];

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const ID_LIKE = /^(day|date|row|id|n|obs)$/i;
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
  const [code, setCode] = useState((params.get("room") || params.get("session") || "").toUpperCase());
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
    const name = withRain ? "Colab — 14 days with rain" : "Colab — 14 days";
    takeRows(name, rows, "sales", { price: "price", qty: "units", segment: withRain ? "weather" : "" }, { original: rows, baseName: name });
    setCost(COLAB_COST);
    setCurrent("");
  }, [takeRows]);

  const runSales = useCallback((cfg = sales, s = seed) => {
    const sim = salesSim(cfg);
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
    }, { truthKind: "offers", truthOffers: { sigma: cfg.sigma, wtp: cfg.wtp, levels: cfg.useSegment ? cfg.segment.levels : null },
      ...(Number(cfg.groupSize) > 1 ? { groupCol: "group" } : {}) });
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
    if (!isRoomCode(cc)) { setErr("A room code has five letters or digits."); return; }
    if (!quiet) setLoading(true);
    try {
      const d = await roomData(cc);
      const sits = situationsOf(d.cfg);
      const cats = sits.filter((x) => !x.numeric).map((x) => x.name);
      const rows = answerRows(d);
      setSessionInfo({ code: cc, config: { ...d.cfg, start: d.cfg.base }, open: d.open, n: rows.length, groups: d.closedGroups });
      setRaw({ name: `Class room ${cc} — ${d.cfg.product}`, headers: ["respondent", "group", "price", "accept", ...sits.map((x) => x.name)], rows, groupCol: "group" });
      setKind("offers");
      setMap((m) => (quiet && m.price ? m : {
        price: "price", qty: "accept", segment: cats[0] ?? "", shifters: cats.slice(1),
        nums: sits.filter((x) => x.numeric).map((x) => ({ col: x.name, log: rows.every((r) => r[x.name] > 0) })),
      }));
      // A room has no cost of its own: start from 40 % of the base price; the class changes it.
      if (!quiet) { setCurrent(String(d.cfg.base)); setCost(Math.round(d.cfg.base * 0.4 * 100) / 100); setErr(""); }
    } catch (e) {
      setErr(e.message);
      setLive(false);
    }
    if (!quiet) setLoading(false);
  }, [code]);

  // Live refresh while a class is answering.
  useEffect(() => {
    if (!live || source !== "session" || !isRoomCode(code)) return;
    const t = setInterval(() => loadSession(code, true), 4000);
    return () => clearInterval(t);
  }, [live, source, code, loadSession]);

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
    const roomCode = params.get("room") || params.get("session");
    if (roomCode) { setSource("session"); loadSession(roomCode); setLive(true); }
    else if (SOURCES.some((s) => s.id === demo)) {
      choose(demo);
    }
    // After the source has set its own default cost.
    if (params.get("cost")) setTimeout(() => setCost(Number(params.get("cost"))), 0);
  }, []);

  /* ── Model ── */
  const profiles = useMemo(() => (raw ? profileAll(raw.rows, raw.headers) : []), [raw]);
  const numericCols = profiles.filter((p) => p.isNumeric).map((p) => p.key);
  const catCandidates = profiles.filter((p) => p.distinctCount >= 2 && p.distinctCount <= 12 && p.key !== map.price && p.key !== map.qty
    && p.key !== raw?.groupCol && p.key !== "respondent").map((p) => p.key);

  const prepared = useMemo(() => {
    if (!raw || !map.price || !map.qty) return null;
    const cats = [map.segment, ...map.shifters].filter(Boolean);
    if (kind === "offers") {
      // Room data: every group is its own point (share of its members), not
      // pooled with other groups at the same price. A numeric situation is the
      // same for the whole group, so it travels with the group's point.
      const numCols = raw.groupCol ? map.nums.map((n) => n.col) : [];
      const cells = aggregateOffers(raw.rows.map((r) => ({ ...r, [map.price]: toNum(r[map.price]) })),
        { price: map.price, accept: map.qty, cats: raw.groupCol ? [...cats, ...numCols, raw.groupCol] : cats });
      return {
        rows: cells.map((c) => ({ ...c, [map.price]: c.price, ...Object.fromEntries(numCols.map((n) => [n, toNum(c[n])])) })),
        qty: "share", cells, offers: raw.rows.length,
      };
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
    nums: kind === "offers" && !raw.groupCol ? [] : map.nums,
  }), [prepared, map, kind, raw]);

  /* The note's 14 days as they were, fitted with the same model, so an
   * edited Colab table can be compared with the original. */
  const baseFit = useMemo(() => {
    if (!raw?.original || !spec || raw.rows === raw.original) return null;
    try { return fitElasticity(raw.original, spec); } catch { return null; }
  }, [raw, spec]);
  const editRows = (rows) => setRaw((r) => ({ ...r, rows, name: `${r.baseName} — edited by you (${rows.length} days)` }));

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
    if (source === "session" && sessionInfo) return `${base}?room=${sessionInfo.code}&cost=${cost}`;
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
  // A row counter such as "day" is a time trend: per day, not in logs.
  const toggleNum = (c) => setM("nums", map.nums.some((n) => n.col === c) ? map.nums.filter((n) => n.col !== c) : [...map.nums, { col: c, log: !ID_LIKE.test(c) }]);

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
              Technical note: <em>demand-based theoretical models</em>, section 10. The page has four steps:
              <strong> 1 · choose the data</strong>, <strong>2 · say what explains demand</strong>,
              <strong> 3 · read the elasticity and the optimal price</strong>, <strong>4 · take the report</strong>.
              Running a class? <a href="#/price-session" style={{ color: C.acc }}>Open a live price room →</a>
            </p>
          </>
        )}

        {/* ── 1. Data ── */}
        {!resultsOnly && (
          <Section title="1 · Choose the data" note={raw ? `Loaded: ${raw.name} — ${raw.rows.length} rows` : "Pick a source. Each card says what it is and what it teaches."}>
            {[...new Set(SOURCES.map((x) => x.group))].map((g) => (
              <div key={g} style={{ marginBottom: 10 }}>
                <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 6 }}>{g}</div>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
                  {SOURCES.filter((x) => x.group === g).map((x) => (
                    <button key={x.id} onClick={() => choose(x.id)} style={{
                      textAlign: "left", cursor: "pointer", borderRadius: 8, padding: "10px 12px",
                      background: source === x.id ? `${C.acc}22` : C.surf, border: `1px solid ${source === x.id ? C.acc : C.bord}`, color: C.txt,
                    }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{x.label}</div>
                      <div style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.5 }}>{x.what}</div>
                      <div style={{ fontSize: 11.5, color: C.txt, lineHeight: 1.5, marginTop: 4 }}><span style={{ color: C.acc }}>You learn:</span> {x.learn}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {(source === "colab" || source === "rain") && raw?.original && (
              <ColabEditor rows={raw.rows} original={raw.original} withRain={source === "rain"} onChange={editRows}
                fit={ok ? fit : null} baseFit={baseFit} cost={cost} />
            )}
            {source === "sim-sales" && <SalesDesigner cfg={sales} setCfg={setSales} seed={seed} setSeed={setSeed}
              onRun={(c, s) => runSales(c, s)} fit={ok ? fit : null} truthFor={truthFor} />}
            {source === "sim-offers" && <OffersDesigner cfg={offers} setCfg={setOffers} seed={seed} setSeed={setSeed}
              onRun={(c, s) => runOffers(c, s)} fit={ok ? fit : null} truthFor={truthFor} />}

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
              <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "11px 14px", marginBottom: 10, fontSize: 12.5, lineHeight: 1.65 }}>
                <strong>This card reads a room; it does not open one.</strong> The room is opened on its own page:
                <ol style={{ margin: "6px 0 8px", paddingLeft: 20 }}>
                  <li>The lecturer opens the <a href="#/price-session" style={{ color: C.acc }}>live price room</a>, chooses the product and the situations, and projects the QR code.</li>
                  <li>Students answer on their phones; the room page already shows the curve as groups close.</li>
                  <li>For the full analysis — categories, F tests, optimal price, report — press <em>Analyse in the Elasticity Lab</em> on the room page, or type the room code here.</li>
                </ol>
                <a href="#/price-session" style={{ ...primaryBtn, textDecoration: "none", display: "inline-block" }}>Open a live price room →</a>
              </div>
            )}
            {source === "session" && (
              <div style={{ display: "flex", gap: 9, alignItems: "end", flexWrap: "wrap", marginBottom: 10 }}>
                <Field label="room code" hint="From the lecturer’s room page">
                  <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={5}
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
                  {sessionInfo.groups} closed groups · {sessionInfo.n} answers · {sessionInfo.open ? "room open" : "room closed"}
                </span>}
              </div>
            )}

            {loading && <Spinner label="Loading…" />}
            {err && <Callout tone="bad" title="Problem">{err}</Callout>}
            {raw && raw.rows.length > 0 && !raw.original && (
              <Table head={raw.headers.slice(0, 8)} maxHeight={170}
                rows={raw.rows.slice(0, 5).map((r) => raw.headers.slice(0, 8).map((h) => String(r[h] ?? "").slice(0, 20)))} />
            )}
          </Section>
        )}

        {/* ── 2. Model ── */}
        {raw && !resultsOnly && (
          <Section title="2 · Say what explains demand" note="Which column is the price, which is the quantity, and what else moves demand. The examples come already set; change them to see what happens.">
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

            {(kind === "sales" || raw.groupCol) && numericCols.filter((c) => c !== map.price && c !== map.qty && c !== map.segment && !map.shifters.includes(c)).length > 0 && (
              <div>
                <div style={miniLabel}>numeric variables that move demand</div>
                <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, margin: "0 0 8px", maxWidth: 760 }}>
                  Price is the variable we study, but other <strong style={{ color: C.txt }}>independent variables</strong> also change sales —
                  temperature, a competitor’s price, advertising. A variable ticked here enters the regression next to price, so ε is measured
                  <em> holding it constant</em>. As ln(x) its coefficient is itself an elasticity (+1% in x → that % in quantity). Tick only what
                  plausibly moves demand.
                  {numericCols.some((c) => ID_LIKE.test(c)) && <> <strong style={{ color: C.txt }}>day</strong> is not a cause of demand — it is just the
                  row’s number (1, 2, … 14). Ticking it adds a <em>time trend</em>: are sales rising or falling over the days, at the same price? Leave it off unless that is the question.</>}
                  {" "}Once a variable is ticked, a second button says how it enters: <strong style={{ color: C.txt }}>as ln(x)</strong> — its coefficient is an
                  elasticity, % change in quantity per 1% change in x (right for temperature, incomes, competitor prices) — or <strong style={{ color: C.txt }}>as x</strong> —
                  % change in quantity per one more unit of x (right for a day counter).
                </p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {numericCols.filter((c) => c !== map.price && c !== map.qty && c !== map.segment && !map.shifters.includes(c)).map((c) => {
                    const on = map.nums.find((n) => n.col === c);
                    return (
                      <span key={c} style={{ display: "inline-flex", gap: 3 }}>
                        <Chip active={!!on} onClick={() => toggleNum(c)}>{c}{ID_LIKE.test(c) ? " · time trend" : ""}</Chip>
                        {on && <Chip active={false} title="click to switch: as ln(x) the coefficient is an elasticity; as x it is the % change per unit"
                          onClick={() => setM("nums", map.nums.map((n) => (n.col === c ? { ...n, log: !n.log } : n)))}>{on.log ? "as ln(x): % per %" : "as x: % per unit"} ⇄</Chip>}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {kind === "offers" && (
              <Callout tone="info">
                {raw.groupCol
                  ? <>Yes/no answers are grouped as they were answered: each group (one price{map.segment || map.shifters.length ? ", one situation" : ""}) is one point,
                    its share of yes the demand. {prepared?.cells && `${prepared.offers} answers → ${prepared.cells.length} groups.`}</>
                  : <>Yes/no answers are grouped by price{map.segment || map.shifters.length ? " and category" : ""}: the share of
                    offers accepted at each price is the demand. {prepared?.cells && `${prepared.offers} answers → ${prepared.cells.length} cells.`}
                    {" "}Numeric variables are not available here — they vary person to person and cannot be averaged into a cell.</>}
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
          <Section title="4 · Take the report" note="A printable report with the numbers and charts, the data as CSV, and a link that reopens exactly this analysis.">
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
      <Section title="3 · The elasticity and the optimal price" note={`${m.n} observations${kind === "offers" ? " (price cells or groups)" : ""} · ${m.k} coefficients · R² ${m.r2.toFixed(3)} · adjusted R² ${m.adjR2.toFixed(3)}`}
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
          note={<>The two elasticities above will never be exactly equal, even if {segName} changed nothing: every sample has noise.
            These tests ask whether the difference is bigger than noise would make it.</>}>
          <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "10px 13px", marginBottom: 12, fontSize: 12.5, lineHeight: 1.65 }}>
            <strong>Is this an ANOVA?</strong> Almost — it is its regression version, an <em>F test between nested models</em>. A one-way ANOVA would ask
            whether average sales differ by {segName}; here the question is whether the <em>price line</em> differs. The Lab fits the model twice:
            a simple one (one price slope for every {segName}) and the full one (one slope per {segName}). The full model always fits a little better;
            the F test asks whether the improvement — the drop in the unexplained variation, the sum of squared residuals (SSE) — is bigger than
            chance would give:
            <div style={{ fontFamily: MONO, fontSize: 12, margin: "6px 0", color: C.txt }}>
              F = [(SSE simple − SSE full) ÷ extra coefficients] ÷ [SSE full ÷ residual degrees of freedom]
            </div>
            A large F, with p below 0.05, means the categories really differ. With price as a covariate this is the test of equal slopes in an
            ANCOVA; the second test, on level and slope together, is known as the Chow test.
          </div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
            <Verdict title="Different elasticities (slopes)" test={fit.slopeTest} simple="one slope for all, a level per category"
              yes={`The price sensitivity of ${segName} categories differs significantly. Pricing them differently is supported by the data.`}
              no={`The data cannot tell the slopes apart. Different prices per ${segName} would rest on the point estimates, not on evidence — collect more observations or use one elasticity.`} />
            <Verdict title={`Any effect of ${segName} (level or slope)`} test={fit.levelTest} simple={`no ${segName} at all: one line for everybody`}
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

function Verdict({ title, test, yes, no, simple }) {
  if (!test) return null;
  const sig = test.p < 0.05;
  const g = (v) => (v < 0.01 ? v.toPrecision(3) : v.toFixed(4));
  return (
    <div style={{ ...card, background: C.surf, borderLeft: `3px solid ${sig ? C.good : C.warn}` }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {simple && <div style={{ fontSize: 11.5, color: C.mut, marginBottom: 4 }}>simple model: {simple}</div>}
      {test.sseSimple != null && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.mut, marginBottom: 4, lineHeight: 1.6 }}>
          SSE simple {g(test.sseSimple)} · SSE full {g(test.sseFull)}<br />
          F = [({g(test.sseSimple)} − {g(test.sseFull)}) ÷ {test.d1}] ÷ [{g(test.sseFull)} ÷ {test.d2}]
        </div>
      )}
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
  if (ID_LIKE.test(name)) return `A time trend: each ${name} that passes, demand changes by ${pctShift} at the same price.`;
  return `+1 unit of ${name} → ${pctShift} in quantity.`;
}

/* ── The Colab's 14 days, editable ──
 *
 * The student changes a number, adds days or deletes them, and the model
 * refits at once; a strip compares the result with the note's 14 days, and a
 * few ready-made additions show what moves an elasticity and what does not. */

const COLAB_TRIES = [
  { label: "Two days at prices never tried", rows: [{ price: 2.2, units: 79, weather: "no rain" }, { price: 2.95, units: 28, weather: "no rain" }],
    look: "Days at 2.20 € and 2.95 €, close to what the line predicts. The interval narrows a lot: prices further apart pin the slope down — two such days are worth more than many days at the usual prices." },
  { label: "Four more days at the usual prices", rows: [{ price: 2.45, units: 55, weather: "no rain" }, { price: 2.55, units: 47, weather: "rain" }, { price: 2.62, units: 43, weather: "no rain" }, { price: 2.68, units: 39, weather: "rain" }],
    look: "Four more ordinary days between 2.45 € and 2.68 €: the interval narrows only a little. More of the same data helps, slowly." },
  { label: "One odd day", rows: [{ price: 2.6, units: 70, weather: "no rain" }],
    look: "2.60 € and 70 units — a local festival, say. With 14 days one surprise moves ε and widens the interval a lot. In real data, find out why that day was different before trusting the result." },
  { label: "Rainy days at high prices", rain: true, rows: [{ price: 2.85, units: 36, weather: "rain" }, { price: 2.95, units: 33, weather: "rain" }, { price: 3.05, units: 31, weather: "rain" }],
    look: "Rain at prices the shop never charged: if rainy-day buyers keep buying, the rain line flattens. Watch the two elasticities and the F test — does the difference become significant?" },
];

function ColabEditor({ rows, original, withRain, onChange, fit, baseFit, cost }) {
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const nextDay = () => Math.max(0, ...rows.map((r) => Number(r.day) || 0)) + 1;
  const add = (extra) => {
    let d = nextDay();
    onChange([...rows, ...extra.map((x) => ({ day: d++, price: x.price, units: x.units, ...(withRain ? { weather: x.weather } : {}) }))]);
  };
  const orig = (r) => original.find((o) => o.day === r.day);
  const isNew = (r) => !orig(r);
  const changed = (r, k) => { const o = orig(r); return o && String(o[k]) !== String(r[k]); };
  const edited = rows !== original;
  const tries = COLAB_TRIES.filter((t) => withRain || !t.rain);

  const strip = (f, title) => f && (
    <div style={{ flex: "1 1 260px", background: C.card, border: `1px solid ${C.bord}`, borderRadius: 7, padding: "8px 11px" }}>
      <div style={miniLabel}>{title}</div>
      {f.bySegment.map((s) => {
        const o = optimalPrice(s.eps, cost);
        return (
          <div key={s.level ?? "all"} style={{ fontSize: 12.5, lineHeight: 1.7, fontVariantNumeric: "tabular-nums" }}>
            {s.level != null && <span style={{ color: C.mut }}>{s.level}: </span>}
            ε <strong>{s.eps.toFixed(2)}</strong> <span style={{ color: C.mut }}>[{s.lo.toFixed(2)}, {s.hi.toFixed(2)}] · width {(s.hi - s.lo).toFixed(2)}</span>
            {" · "}P* <strong>{o != null ? o.toFixed(2) : "none"}</strong>
          </div>
        );
      })}
      {f.slopeTest && <div style={{ fontSize: 11.5, color: C.mut }}>do they differ? F test p = {pFmt(f.slopeTest.p)}</div>}
    </div>
  );

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
      <p style={{ fontSize: 12.5, lineHeight: 1.65, margin: "0 0 10px", maxWidth: 780 }}>
        These are the 14 days of the technical note{withRain ? ", with the weather of each day" : ""}. <strong>Change any number, add days or delete
        them</strong>: the elasticity, the optimal price and every chart below recalculate at once. Changed values and new days are highlighted;
        the original is one click away. Try the additions below to see what moves an elasticity — and what does not.
      </p>

      {edited && (fit || baseFit) && (
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginBottom: 10 }}>
          {strip(baseFit, `the note's 14 days`)}
          {strip(fit, `your data · ${rows.length} days`)}
        </div>
      )}

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", alignItems: "start" }}>
        <div>
          <div style={{ maxHeight: 360, overflowY: "auto", border: `1px solid ${C.bord}`, borderRadius: 7 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
              <thead>
                <tr>{["day", "price", "units", ...(withRain ? ["weather"] : []), ""].map((h) => (
                  <th key={h} style={{ position: "sticky", top: 0, background: C.surf, textAlign: "left", padding: "6px 7px", ...miniLabel, marginBottom: 0, borderBottom: `1px solid ${C.bord}` }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const hl = (k) => ({ ...cellInp, ...(isNew(r) ? newCell : changed(r, k) ? changedCell : {}) });
                  return (
                    <tr key={r.day}>
                      <td style={{ padding: "3px 7px", color: isNew(r) ? C.acc : C.mut, fontFamily: MONO }}>{r.day}{isNew(r) ? " new" : ""}</td>
                      <td style={{ padding: 3 }}><NumIn v={r.price} on={(v) => set(i, "price", v)} style={hl("price")} /></td>
                      <td style={{ padding: 3 }}><NumIn v={r.units} on={(v) => set(i, "units", v)} style={hl("units")} /></td>
                      {withRain && (
                        <td style={{ padding: 3 }}>
                          <select value={r.weather} onChange={(e) => set(i, "weather", e.target.value)} style={hl("weather")}>
                            <option>no rain</option><option>rain</option>
                          </select>
                        </td>
                      )}
                      <td style={{ padding: 3, width: 28 }}>
                        <button onClick={() => onChange(rows.filter((_, j) => j !== i))} title="delete this day" style={{ ...ghostBtn, padding: "2px 7px" }}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button onClick={() => add([{ price: rows[rows.length - 1]?.price ?? 2.5, units: rows[rows.length - 1]?.units ?? 45, weather: "no rain" }])} style={ghostBtn}>+ add a day</button>
            {edited && <button onClick={() => onChange(original)} style={ghostBtn}>Back to the note's 14 days</button>}
          </div>
        </div>

        <div>
          <div style={miniLabel}>try this — each adds days to the table</div>
          {tries.map((t) => (
            <div key={t.label} style={{ background: C.card, border: `1px solid ${C.bord}`, borderRadius: 7, padding: "8px 11px", marginBottom: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <strong style={{ fontSize: 12.5 }}>{t.label}</strong>
                <button onClick={() => add(t.rows)} style={{ ...ghostBtn, padding: "3px 10px", fontSize: 11.5 }}>add</button>
              </div>
              <div style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.55, marginTop: 3 }}>
                <span style={{ fontFamily: MONO }}>{t.rows.map((x) => `${x.price.toFixed(2)} € → ${x.units}${withRain ? ` (${x.weather})` : ""}`).join(" · ")}</span><br />{t.look}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Did the regression find the truth? ──
 * Shared by both simulations: the value the student set against what the
 * regression recovered, and whether the 95% interval contains it. */
function TruthCheck({ fit, truthFor, offers }) {
  if (!fit) return null;
  const rows = fit.bySegment.map((s) => {
    const t = truthFor(s);
    const inside = Number.isFinite(t) && s.lo <= t && t <= s.hi;
    return [s.level ?? "all", Number.isFinite(t) ? t.toFixed(2) : "—", s.eps.toFixed(2), `[${s.lo.toFixed(2)}, ${s.hi.toFixed(2)}]`,
      ...(offers ? [] : [Number.isFinite(t) ? <span style={{ color: inside ? C.good : C.warn }}>{inside ? "✓ inside" : "✗ outside"}</span> : "—"])];
  });
  return (
    <div style={{ marginTop: 12 }}>
      <div style={miniLabel}>did the regression find the truth?</div>
      <Table head={["", offers ? "true ε at the average price" : "true ε (yours)", "estimated ε", "95% interval", ...(offers ? [] : ["truth inside?"])]} rows={rows} />
      <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, margin: "6px 0 0" }}>
        {offers
          ? "With yes/no answers there is no single true elasticity: the true curve bends (willingness to pay is log-normal), steeper where few people still buy. The value shown is its slope at the average price; the regression line averages the bend over all the prices offered, so the two only roughly agree — least when prices sit far above what a category would pay, and when many groups had nobody buying (they are plotted at half an acceptance, which flattens the line). That gap is the price of fitting a straight line to a curve."
          : "The regression never saw the number you typed — only the sales. A ✓ means its 95% interval caught it. About 1 sample in 20 misses by pure chance: that is what 95% means. Press New sample a few times, or repeat it 200 times below."}
      </p>
    </div>
  );
}

/* The same simulation repeated with new random noise: the estimates scatter
 * around the truth, about 95% of the intervals contain it, and the F test
 * detects a real difference only some of the time — its power. */
function RepeatPanel({ cfg, seed }) {
  const [res, setRes] = useState(null);
  const key = JSON.stringify(cfg);
  const run = () => setRes({ key, ...repeatSales(salesSim(cfg), 200, seed * 1000 + 1) });
  const fresh = res && res.key === key;
  const lv = fresh ? Object.entries(res.levels) : [];
  const all = lv.flatMap(([, o]) => [...o.est, o.truth]);
  const lo = Math.min(...all), hi = Math.max(...all);
  const x = (v) => 20 + ((v - lo) / (hi - lo || 1)) * 560;
  const q = (arr, p) => { const a = [...arr].sort((m, n) => m - n); return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))]; };
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={run} style={ghostBtn}>Repeat 200 times</button>
        <span style={{ fontSize: 11.5, color: C.mut }}>Same truth, 200 new samples: does the method get it right on average, and how much does one sample wander?</span>
      </div>
      {fresh && (
        <div style={{ marginTop: 9 }}>
          <Table head={["", "true ε", "average estimate", "95% of estimates between", "intervals containing the truth"]}
            rows={lv.map(([name, o]) => [name, o.truth.toFixed(2), (o.est.reduce((a, b) => a + b, 0) / (o.est.length || 1)).toFixed(2),
              `${q(o.est, 0.025).toFixed(2)} and ${q(o.est, 0.975).toFixed(2)}`,
              <span style={{ color: Math.abs(o.covered / (o.est.length || 1) - 0.95) < 0.04 ? C.good : C.warn }}>{Math.round((o.covered / (o.est.length || 1)) * 100)}%</span>])} />
          <svg viewBox={`0 0 600 ${26 * lv.length + 22}`} style={{ width: "100%", marginTop: 8 }} role="img" aria-label="Estimates from 200 samples, with the true value marked">
            {lv.map(([name, o], i) => {
              const st = clusterStyle(i);
              return (
                <g key={name}>
                  {o.est.map((v, j) => <circle key={j} cx={x(v)} cy={14 + 26 * i + ((j * 7) % 11) - 5} r={2.2} fill={st.color} opacity={0.45} />)}
                  <line x1={x(o.truth)} x2={x(o.truth)} y1={4 + 26 * i} y2={24 + 26 * i} stroke={C.txt} strokeWidth={2} />
                  <text x={x(o.truth) + 4} y={8 + 26 * i} fill={C.txt} fontSize={10}>{name} · truth {o.truth}</text>
                </g>
              );
            })}
            <text x={20} y={26 * lv.length + 18} fill={C.mut} fontSize={10}>{lo.toFixed(2)}</text>
            <text x={580} y={26 * lv.length + 18} fill={C.mut} fontSize={10} textAnchor="end">{hi.toFixed(2)}</text>
          </svg>
          <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, margin: "4px 0 0" }}>
            Each dot is the ε estimated from one sample; the line is the truth you set. The cloud is centred on the truth: the method works.
            Its width is what one real sample — the only one a firm ever has — can be off by.
            {lv.length > 1 && <> The F test found the difference between the categories in <strong style={{ color: C.txt }}>{res.detected} of {res.reps}</strong> samples
            ({Math.round((res.detected / res.reps) * 100)}% — the test’s power with this much data).</>}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Simulation designers ── */

function Experiments({ list, onPick }) {
  const [picked, setPicked] = useState(null);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={miniLabel}>experiments — each changes one thing; click, then look at the results</div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {list.map((e) => <Chip key={e.label} active={picked === e.label} onClick={() => { setPicked(e.label); onPick(e.cfg); }}>{e.label}</Chip>)}
      </div>
      {picked && <Callout tone="info" title="What to look at">{list.find((e) => e.label === picked)?.look}</Callout>}
    </div>
  );
}

function SalesDesigner({ cfg, setCfg, seed, setSeed, onRun, fit, truthFor }) {
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  const setLevel = (i, k, v) => setCfg((c) => ({ ...c, segment: { ...c.segment, levels: c.segment.levels.map((l, j) => (j === i ? { ...l, [k]: v } : l)) } }));
  const setNum = (i, k, v) => setCfg((c) => ({ ...c, nums: c.nums.map((n, j) => (j === i ? { ...n, [k]: v } : n)) }));
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
      <Callout tone="info" title="What this is for">
        With real sales you never know the true elasticity, so you cannot tell whether a regression got it right. Here <strong>you are the
        market</strong>: you type the true ε, the computer invents daily sales that follow it — with random noise, like real days — and the Lab
        estimates ε from those sales alone, without seeing your number. If the estimate lands near your number and its 95% interval contains it,
        the method works. Then change <strong>one thing at a time</strong> (fewer days, more noise, prices closer together) and watch the estimate get worse.
        <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.mut, marginTop: 6 }}>
          units = units at reference price × (price ÷ reference price)<sup>ε</sup> × demand factor × (x ÷ midpoint)<sup>effect</sup> × random noise
        </div>
      </Callout>

      <Experiments list={SALES_EXPERIMENTS} onPick={(c) => { const n = { ...cfg, ...c }; setCfg(n); onRun(n, seed); }} />

      <div style={grid}>
        <Field label="product" hint="Only a name for the charts and the report."><input value={cfg.product} onChange={(e) => set("product", e.target.value)} style={inp} /></Field>
        <Field label="observations (days)" hint="Days of sales. More → narrower intervals. The Colab has 14."><NumIn v={cfg.n} on={(v) => set("n", Math.max(5, Math.round(v)))} /></Field>
        <Field label="lowest price" hint="The cheapest price tried."><NumIn v={cfg.pMin} on={(v) => set("pMin", v)} /></Field>
        <Field label="highest price" hint="A wider range measures the slope better than more days."><NumIn v={cfg.pMax} on={(v) => set("pMax", v)} /></Field>
        <Field label="reference price" hint="A typical price; it only sets the scale."><NumIn v={cfg.pRef} on={(v) => set("pRef", v)} /></Field>
        <Field label="units sold at reference price" hint="The size of demand: moves the line up or down, not ε."><NumIn v={cfg.qRef} on={(v) => set("qRef", v)} /></Field>
        <Field label="noise" hint="Randomness price does not explain: 0 = all on the line, 0.1 ≈ ±10%, 0.3 = very noisy."><NumIn v={cfg.noise} on={(v) => set("noise", v)} /></Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ fontSize: 12, display: "flex", gap: 7, alignItems: "center", marginBottom: 4 }}>
          <input type="checkbox" checked={cfg.useSegment} onChange={(e) => set("useSegment", e.target.checked)} />
          a category with its own elasticity
          {cfg.useSegment && <input value={cfg.segment.name} onChange={(e) => setCfg((c) => ({ ...c, segment: { ...c.segment, name: e.target.value.replace(/\s+/g, "_") } }))} style={{ ...inp, width: 130 }} />}
        </label>
        <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.55, margin: "0 0 8px" }}>
          {cfg.useSegment
            ? <>Each day falls in one level (with the <em>% of days</em> you set). Each level has its own <em>true ε</em> — how price-sensitive buyers are
              that day — and a <em>demand ×</em> that moves its whole line: 0.85 = 15% fewer sales at the same price. Different ε → different optimal prices.</>
            : <>Off: one elasticity for every day. Switch it on to give rain and dry days (or weekdays and weekends) different price sensitivities.</>}
        </p>
        {cfg.useSegment ? (
          <LevelTable levels={cfg.segment.levels} cols={[["name", "level", "text"], ["eps", "true ε", "num"], ["shift", "demand × (same price)", "num"], ["share", "% of days", "num"]]}
            onChange={setLevel}
            onAdd={() => setCfg((c) => ({ ...c, segment: { ...c.segment, levels: [...c.segment.levels, { name: `level${c.segment.levels.length + 1}`, eps: -2, shift: 1, share: 30 }] } }))}
            onRemove={(i) => setCfg((c) => ({ ...c, segment: { ...c.segment, levels: c.segment.levels.filter((_, j) => j !== i) } }))} />
        ) : (
          <Field label="true elasticity ε" hint="Below −1 = elastic (an optimal price exists); between −1 and 0 = inelastic."><NumIn v={cfg.segment.levels[0]?.eps ?? -2} on={(v) => setLevel(0, "eps", v)} /></Field>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={miniLabel}>numeric variables that move demand · Q ∝ (x / midpoint)^effect</div>
        <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.55, margin: "0 0 8px" }}>
          Something besides price that changes sales every day — an independent variable such as temperature (8 to 30 °C). <em>Effect</em> is its
          elasticity: −0.3 means 1% hotter → 0.3% fewer coffees. It varies at random, unrelated to price. The Lab puts it in the model as ln(x);
          untick it in step 2 to see what leaving it out does. Remove them all for the simplest case.
        </p>
        <LevelTable levels={cfg.nums} cols={[["name", "variable", "text"], ["min", "min", "num"], ["max", "max", "num"], ["eff", "effect (an elasticity)", "num"]]}
          onChange={setNum}
          onAdd={() => setCfg((c) => ({ ...c, nums: [...c.nums, { name: `x${c.nums.length + 1}`, min: 1, max: 10, eff: 0.2 }] }))}
          onRemove={(i) => setCfg((c) => ({ ...c, nums: c.nums.filter((_, j) => j !== i) }))} />
      </div>

      <div style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
        <button onClick={() => onRun(cfg, seed)} style={primaryBtn}>Generate data</button>
        <button onClick={() => { const s = seed + 1; setSeed(s); onRun(cfg, s); }} style={ghostBtn}>New sample</button>
        <span style={{ fontSize: 11, color: C.mut }}>After changing a setting, press Generate data. New sample = same truth, new random days. <span style={{ fontFamily: MONO }}>seed {seed}</span></span>
      </div>

      <TruthCheck fit={fit} truthFor={truthFor} />
      <RepeatPanel cfg={cfg} seed={seed} />
    </div>
  );
}

function OffersDesigner({ cfg, setCfg, seed, setSeed, onRun, fit, truthFor }) {
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  const setLevel = (i, k, v) => setCfg((c) => ({ ...c, segment: { ...c.segment, levels: c.segment.levels.map((l, j) => (j === i ? { ...l, [k]: v } : l)) } }));
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
      <Callout tone="info" title="What this is for">
        A rehearsal of the live price room, played by the computer. Each virtual student has a <strong>willingness to pay</strong> (WTP): the most
        they would pay. Shown a price, they say yes if it is below their WTP. The share of yes at each price is the demand curve — exactly what a
        class produces. Use it before class to choose the start price and the range, and to see what the curve will look like.
        The settings match the room page: start price = <em>base price</em>, range = <em>variation ± %</em>, offers = <em>rounds per student</em>,
        group size = <em>students per group</em>.
      </Callout>

      <Experiments list={OFFER_EXPERIMENTS} onPick={(c) => { const n = { ...cfg, ...c }; setCfg(n); onRun(n, seed); }} />

      <div style={grid}>
        <Field label="product" hint="Only a name."><input value={cfg.product} onChange={(e) => set("product", e.target.value)} style={inp} /></Field>
        <Field label="respondents" hint="The class size."><NumIn v={cfg.respondents} on={(v) => set("respondents", Math.max(2, Math.round(v)))} /></Field>
        <Field label="start price" hint="Centre of the prices offered: put it near what people would pay."><NumIn v={cfg.start} on={(v) => set("start", v)} /></Field>
        <Field label="range ± %" hint="Too narrow: a flat cloud. Too wide: all-yes and all-no ends. ±30–50% works."><NumIn v={cfg.rangePct} on={(v) => set("rangePct", v)} /></Field>
        <Field label="price levels" hint="How many different prices. Fewer → more answers each."><NumIn v={cfg.levels} on={(v) => set("levels", Math.max(3, Math.round(v)))} /></Field>
        <Field label="offers per respondent" hint="Rounds: prices each student answers."><NumIn v={cfg.offersEach} on={(v) => set("offersEach", Math.max(1, Math.round(v)))} /></Field>
        <Field label="group size" hint="As in the room: each group at one price is one point. 1 = pool all answers per price."><NumIn v={cfg.groupSize ?? 1} on={(v) => set("groupSize", Math.max(1, Math.round(v)))} /></Field>
        <Field label="spread of WTP" hint="How different the students are: 0.1 = they agree (very elastic); 0.6 = very different (gentle)."><NumIn v={cfg.sigma} on={(v) => set("sigma", v)} /></Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <label style={{ fontSize: 12, display: "flex", gap: 7, alignItems: "center", marginBottom: 4 }}>
          <input type="checkbox" checked={cfg.useSegment} onChange={(e) => set("useSegment", e.target.checked)} />
          respondents belong to categories
          {cfg.useSegment && <input value={cfg.segment.name} onChange={(e) => setCfg((c) => ({ ...c, segment: { ...c.segment, name: e.target.value.replace(/\s+/g, "_") } }))} style={{ ...inp, width: 130 }} />}
        </label>
        <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.55, margin: "0 0 8px" }}>
          {cfg.useSegment
            ? <>Types of buyer with a different <em>median WTP</em> — the price at which half of that type would buy — in the proportions you set.
              In step 2, choose this column as the category to get one line and one optimal price per type.</>
            : <>Off: everybody comes from one market. The <em>median WTP</em> is the price at which half the class would buy.</>}
        </p>
        {cfg.useSegment ? (
          <LevelTable levels={cfg.segment.levels} cols={[["name", "category", "text"], ["wtp", "median WTP", "num"], ["share", "% of respondents", "num"]]}
            onChange={setLevel}
            onAdd={() => setCfg((c) => ({ ...c, segment: { ...c.segment, levels: [...c.segment.levels, { name: `group${c.segment.levels.length + 1}`, wtp: c.start, share: 30 }] } }))}
            onRemove={(i) => setCfg((c) => ({ ...c, segment: { ...c.segment, levels: c.segment.levels.filter((_, j) => j !== i) } }))} />
        ) : (
          <Field label="median willingness to pay"><NumIn v={cfg.wtp} on={(v) => set("wtp", v)} /></Field>
        )}
      </div>
      <div style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
        <button onClick={() => onRun(cfg, seed)} style={primaryBtn}>Run the virtual class</button>
        <button onClick={() => { const s = seed + 1; setSeed(s); onRun(cfg, s); }} style={ghostBtn}>New class</button>
        <span style={{ fontSize: 11, color: C.mut }}>After changing a setting, press Run. New class = same settings, new students. <span style={{ fontFamily: MONO }}>seed {seed}</span></span>
      </div>
      <TruthCheck fit={fit} truthFor={truthFor} offers />
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

function NumIn({ v, on, style }) {
  const [s, setS] = useState(String(v));
  useEffect(() => { setS((cur) => (toNum(cur) === Number(v) ? cur : String(v))); }, [v]);
  return <input value={s} inputMode="decimal" style={style ?? inp}
    onChange={(e) => { setS(e.target.value); const n = toNum(e.target.value); if (Number.isFinite(n)) on(n); }} />;
}

const primaryBtn = { background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6, padding: "8px 15px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const ghostBtn = { background: C.card, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6, padding: "7px 13px", fontSize: 12.5, cursor: "pointer" };
const miniLabel = { fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", marginBottom: 7 };
const cellInp = { ...inp, padding: "4px 7px", fontSize: 12.5, width: "100%", boxSizing: "border-box" };
const changedCell = { borderColor: C.warn, background: `${C.warn}18` };
const newCell = { borderColor: C.acc, background: `${C.acc}18` };
const grid = { display: "grid", gap: 11, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" };

