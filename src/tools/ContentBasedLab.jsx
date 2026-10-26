/* Content-Based Lab — module 10 (technical note "Recommender systems", §8).
 *
 * Collaborative filtering needs other users' ratings of an item before it can
 * recommend it. Content-based filtering recommends from what the item IS:
 *
 *   profiles     a user's taste in the items' own features, from mean-centred
 *                ratings; items scored by cosine similarity (§8.2, D4 Excel)
 *   similar      "more like this": nearest items by cosine of their features
 *   evaluation   hold out ratings, rank, count hits in the top N, against a
 *                popularity ranking (§8.3)
 *   two towers   the deep-learning model: a user network and an item network,
 *                prediction = v_user · v_item; similar items by distance
 *                between learned vectors (§8.4)
 *
 * Deep links: #/content-based?demo=catalogue|exercise|case&user=Alice&item=Midnight%20Ferry
 *             &train=80&seed=1&n=3&like=4&k=4&hidden=0&lr=0.01&lambda=0.01&epochs=300&tab=profile|similar|evaluate|towers
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { C, inp } from "../theme.js";
import { Section, Callout, Stat, Table, Field, Chip, Spinner } from "../components/UI.jsx";
import { Curves, HBars } from "../components/RecCharts.jsx";
import { readTableFile, readDemo } from "../lib/recData.js";
import {
  guessColumns, readMatrix, countRated, userProfile, cosine, similarItems, contentScores, splitTrainTest,
  precisionAtN, popularityScores, trainTwoTower, baselines, itemMeans,
} from "../lib/recommender.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const SOURCES = [
  { id: "catalogue", file: "streaming_catalogue.csv", label: "Streaming catalogue: 30 films × 12 users × 6 genres",
    what: "streaming_catalogue.xlsx — synthetic, built for this lab: each user has a clear taste for some genres." },
  { id: "exercise", file: "rec_cb_exercise.csv", label: "D4 exercise: 8 films, Alice",
    what: "The films and Alice’s ratings of the D4 workbook: check your hand calculations here." },
  { id: "case", file: "rec_case.csv", label: "C4 case: 100 movies × 12 users",
    what: "The collaborative-filtering case. Only two features (romance, action): see how far content gets with so little description." },
];

const TABS = [["profile", "1 · A user’s profile"], ["similar", "2 · Similar items"], ["evaluate", "3 · Does it work?"], ["towers", "4 · Two towers (deep learning)"]];
const fx = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "—");

export default function ContentBasedLab() {
  const params = useMemo(() => new URLSearchParams(window.location.hash.split("?")[1] ?? ""), []);
  const resultsOnly = params.get("view") === "results";
  const [source, setSource] = useState(null);
  const [raw, setRaw] = useState(null);
  const [roles, setRoles] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(params.get("tab") || "profile");
  const [user, setUser] = useState(0);
  const [item, setItem] = useState(0);
  const [ev, setEv] = useState({ train: 80, seed: 1, n: 3, like: 4 });
  const [tw, setTw] = useState({ k: 4, hidden: 0, lr: 0.01, lambda: 0.01, epochs: 300 });
  const [towers, setTowers] = useState(null);
  const [busy, setBusy] = useState(false);

  const take = useCallback((t, id) => {
    setRaw(t); setRoles(guessColumns(t.headers, t.rows)); setSource(id); setErr(""); setTowers(null); setUser(0); setItem(0);
  }, []);
  const choose = useCallback(async (id) => {
    try { take(await readDemo(SOURCES.find((s) => s.id === id).file), id); } catch (e) { setErr(String(e.message || e)); }
  }, [take]);
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { take(await readTableFile(f), "file"); } catch (x) { setErr(`Could not read ${f.name}: ${x.message || x}`); }
    e.target.value = "";
  };

  const data = useMemo(() => (raw && roles ? readMatrix(raw.rows, roles) : null), [raw, roles]);
  const ok = data && data.X && data.users.length > 0;

  useEffect(() => {
    const demo = params.get("demo");
    if (!demo || !SOURCES.some((s) => s.id === demo)) return;
    choose(demo);
    const e = {}, t = {};
    for (const k of ["train", "seed", "n", "like"]) if (params.get(k)) e[k] = Number(params.get(k));
    for (const k of ["k", "hidden", "lr", "lambda", "epochs"]) if (params.get(k)) t[k] = Number(params.get(k));
    setEv((v) => ({ ...v, ...e })); setTw((v) => ({ ...v, ...t }));
  }, [params, choose]);
  // Name-based selection from the link once the data is in.
  useEffect(() => {
    if (!data) return;
    const u = params.get("user"), it = params.get("item");
    if (u && data.users.includes(u)) setUser(data.users.indexOf(u));
    if (it && data.items.includes(it)) setItem(data.items.indexOf(it));
  }, [data, params]);

  const trainTowers = () => {
    setBusy(true);
    setTimeout(() => {
      try {
        const { train, test, nTest } = splitTrainTest(data.Y, ev.train, ev.seed);
        const r = trainTwoTower({ train, X: data.X, test: nTest ? test : null, k: tw.k, hidden: tw.hidden, alpha: tw.lr, lambda: tw.lambda, epochs: tw.epochs, seed: ev.seed });
        setTowers({ ...r, base: nTest ? baselines(train, test) : null, cfg: { ...tw, ...ev } });
      } catch (e) { setErr(String(e.message || e)); }
      setBusy(false);
    }, 30);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <style>{"::-webkit-scrollbar{width:7px;height:7px;background:transparent}::-webkit-scrollbar-thumb{background:#252836;border-radius:4px}"}</style>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "34px 22px 90px" }}>
        {!resultsOnly && (
          <>
            <a href="#/" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← all tools</a>
            <h1 style={{ fontSize: 25, margin: "12px 0 7px", fontWeight: 600 }}>Content-Based Lab</h1>
            <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.7, maxWidth: 720, margin: "0 0 8px" }}>
              Recommend from what the items <em>are</em> — genre, category, price, ingredients — instead of from who else liked them.
              A user’s taste becomes a profile in the same terms as the items, and the items closest to the profile are recommended.
              It works for a film nobody has rated yet, which collaborative filtering cannot do.
            </p>
            <p style={{ color: C.mut, fontSize: 12.5, lineHeight: 1.7, maxWidth: 720, margin: "0 0 22px" }}>
              Technical note: <em>Recommender systems</em>, section 8. Activity D4 and its workbook.
              Rating patterns instead of descriptions? <a href="#/recommender" style={{ color: C.acc }}>Collaborative Filtering Lab →</a>
            </p>
          </>
        )}

        {!resultsOnly && (
          <Section title="1 · Choose the data" note={raw ? `Loaded: ${raw.name} — ${data?.items.length ?? 0} items × ${data?.users.length ?? 0} users, ${data ? countRated(data.Y) : 0} ratings, ${data?.features.length ?? 0} features` : "One row per item: its name, one column per user (rating or empty) and one column per feature."}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SOURCES.map((s) => <Chip key={s.id} active={source === s.id} onClick={() => choose(s.id)}>{s.label}</Chip>)}
              <label style={{ ...chipLike, borderStyle: "dashed" }}>
                Your file (.xlsx / .csv)
                <input type="file" accept=".csv,.xlsx,.xls,.xlsm,.txt" onChange={onFile} style={{ display: "none" }} />
              </label>
            </div>
            {source && source !== "file" && <p style={{ fontSize: 11.5, color: C.mut, margin: "8px 0 0" }}>{SOURCES.find((s) => s.id === source)?.what}</p>}
            {raw && roles && (
              <div style={{ marginTop: 10, display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: C.mut, marginRight: 4 }}>Click a column to switch user ⇄ feature:</span>
                {[...roles.users, ...roles.features].map((h) => {
                  const isF = roles.features.includes(h);
                  return <button key={h} onClick={() => setRoles({ ...roles, features: isF ? roles.features.filter((x) => x !== h) : [...roles.features, h], users: isF ? [...roles.users, h] : roles.users.filter((x) => x !== h) })}
                    style={{ ...chipLike, padding: "3px 8px", background: isF ? `${C.warn}22` : C.surf, borderColor: isF ? C.warn : C.bord }}>{isF ? "feature" : "user"} · {h}</button>;
                })}
              </div>
            )}
          </Section>
        )}
        {err && <Callout tone="bad" title="Something is wrong">{err}</Callout>}
        {data && !data.X && <Callout tone="warn" title="No features">Content-based filtering needs at least one feature column describing the items. Click a column above to make it a feature.</Callout>}

        {ok && (
          <>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", margin: "4px 0 14px" }}>
              {TABS.map(([id, l]) => <Chip key={id} active={tab === id} onClick={() => setTab(id)}>{l}</Chip>)}
            </div>
            {tab === "profile" && <ProfileTab data={data} user={user} setUser={setUser} />}
            {tab === "similar" && <SimilarTab data={data} item={item} setItem={setItem} />}
            {tab === "evaluate" && <EvaluateTab data={data} ev={ev} setEv={setEv} />}
            {tab === "towers" && <TowersTab data={data} ev={ev} setEv={setEv} tw={tw} setTw={setTw} res={towers} busy={busy} run={trainTowers} item={item} setItem={setItem} />}
          </>
        )}
      </div>
    </div>
  );
}

function ProfileTab({ data, user, setUser }) {
  const p = useMemo(() => userProfile(data.Y, data.X, user), [data, user]);
  const scored = data.items.map((it, i) => ({ i, it, s: cosine(p.profile, data.X[i]), rated: data.Y[i][user] }))
    .filter((d) => d.rated === null).sort((a, b) => b.s - a.s);
  const norm = Math.sqrt(p.profile.reduce((s, v) => s + v * v, 0));
  return (
    <Section title={`${data.users[user]}’s taste, in the items’ own features`}
      right={<select value={user} onChange={(e) => setUser(Number(e.target.value))} style={{ ...inp, width: 160 }}>{data.users.map((u, j) => <option key={u} value={j}>{u}</option>)}</select>}
      note="Step 1: centre the ratings on the user’s own average (a 4 from a generous user and a 4 from a harsh one do not mean the same). Step 2: profile = the item features weighted by those centred ratings, divided by the sum of their absolute values. Step 3: score each unseen item by the cosine between the profile and its features.">
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
        <div>
          <p style={sub}>Rated items: rating − average ({fx(p.mean, 3)}) = weight</p>
          <Table head={["item", "rating", "weight", ...data.features]} maxHeight={330}
            rows={p.weights.map((w) => [data.items[w.i], fx(w.rating, 1), <span style={{ color: w.weight >= 0 ? C.good : C.bad }}>{fx(w.weight, 3)}</span>, ...data.X[w.i].map((v) => fx(v, 2))])} />
          <p style={{ fontSize: 11.5, color: C.mut }}>Σ|weight| = {fx(p.wsum, 3)} · ‖profile‖ = {fx(norm, 4)}</p>
        </div>
        <div>
          <p style={sub}>Profile — positive: the user likes more of this feature; negative: less</p>
          <HBars items={data.features.map((f, q) => ({ label: f, value: p.profile[q] }))} format={(v) => v.toFixed(4)} />
        </div>
      </div>
      <h3 style={h3}>Unseen items, ranked by cosine(profile, item)</h3>
      {norm === 0
        ? <Callout tone="warn">This user rated everything the same: the profile is zero and cannot rank anything — the cold-start problem of content-based filtering. A popularity ranking, or asking for preferences, is the usual fallback.</Callout>
        : <Table head={["rank", "item", "cosine", ...data.features]} maxHeight={360}
          rows={scored.map((d, r) => [r + 1, d.it, <strong style={{ color: d.s > 0 ? C.good : C.bad }}>{fx(d.s, 4)}</strong>, ...data.X[d.i].map((v) => fx(v, 2))])} />}
    </Section>
  );
}

function SimilarTab({ data, item, setItem }) {
  const sims = similarItems(data.X, item, Math.min(8, data.items.length - 1), "cosine");
  const means = itemMeans(data.Y);
  return (
    <Section title="More like this" right={<select value={item} onChange={(e) => setItem(Number(e.target.value))} style={{ ...inp, width: 240 }}>{data.items.map((it, i) => <option key={i} value={i}>{it}</option>)}</select>}
      note="“Because you watched…” rows: the items whose feature vectors point in the same direction. No ratings are used — this works on the day an item is added to the catalogue.">
      <p style={{ fontSize: 12, color: C.mut }}>{data.items[item]}: {data.features.map((f, q) => `${f} ${fx(data.X[item][q], 2)}`).join(" · ")}</p>
      <Table head={["item", "cosine", "average rating", ...data.features]}
        rows={sims.map((s) => [data.items[s.i], <strong>{fx(s.value, 4)}</strong>, fx(means[s.i], 2), ...data.X[s.i].map((v) => fx(v, 2))])} />
      <Callout tone="info" title="Read it critically">
        Many ties at cosine 1.000 mean the features cannot tell those items apart: two genres describe a catalogue poorly. Richer item
        descriptions (director, cast, keywords, price) separate them — and that, not the algorithm, is usually the content-based system’s limit.
      </Callout>
    </Section>
  );
}

function EvaluateTab({ data, ev, setEv }) {
  const r = useMemo(() => {
    const { train, test, nTest } = splitTrainTest(data.Y, ev.train, ev.seed);
    if (!nTest) return null;
    const cb = precisionAtN(contentScores(train, data.X), train, test, ev.n, ev.like);
    const pop = precisionAtN(popularityScores(train), train, test, ev.n, ev.like);
    return { cb, pop, nTest };
  }, [data, ev]);
  const set = (k, v) => setEv((e) => ({ ...e, [k]: v }));
  return (
    <Section title="Does it recommend what users go on to like?"
      note="Hide some ratings, build every profile from the rest, recommend the top N unseen items to each user, and count how many of them are hidden items the user rated at or above the “liked” threshold. Compare with recommending the items with the best average rating to everyone.">
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", marginBottom: 12 }}>
        <Field label="ratings used to build profiles"><select value={ev.train} onChange={(e) => set("train", Number(e.target.value))} style={inp}>{[90, 80, 70, 60].map((v) => <option key={v} value={v}>{v}% / {100 - v}% hidden</option>)}</select></Field>
        <Field label="top N"><input type="number" min="1" max="10" value={ev.n} onChange={(e) => set("n", Math.max(1, Math.round(Number(e.target.value))))} style={inp} /></Field>
        <Field label="“liked” = rating ≥"><input type="number" step="0.5" value={ev.like} onChange={(e) => set("like", Number(e.target.value))} style={inp} /></Field>
        <Field label="seed" hint="Change it to see how much the answer depends on which ratings were hidden."><input type="number" min="1" value={ev.seed} onChange={(e) => set("seed", Math.max(1, Math.round(Number(e.target.value))))} style={inp} /></Field>
      </div>
      {!r ? <p style={{ color: C.mut }}>Hide some ratings first.</p> : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Stat label={`content-based precision@${ev.n}`} value={fx(r.cb.precision, 3)} hint={`${r.cb.hits} hits · recall ${fx(r.cb.recall, 2)}`} tone={r.cb.precision > r.pop.precision ? "good" : "warn"} />
            <Stat label={`popularity precision@${ev.n}`} value={fx(r.pop.precision, 3)} hint={`${r.pop.hits} hits · recall ${fx(r.pop.recall, 2)}`} />
            <Stat label="users evaluated" value={r.cb.users} hint={`with a liked hidden item · ${r.nTest} hidden ratings`} />
          </div>
          <Callout tone={r.cb.precision > r.pop.precision ? "good" : "warn"}>
            {r.cb.precision > r.pop.precision
              ? `Personalising pays: ${fx(r.cb.precision * 100, 1)}% of the recommended slots are items the user went on to like, against ${fx(r.pop.precision * 100, 1)}% with the same list for everybody.`
              : "Here the popular list does as well or better: the features do not describe what makes these users differ. Better item descriptions, or collaborative filtering, are the way forward."}
            {r.cb.users < 10 && " With so few users evaluated, change the seed before drawing a conclusion."}
          </Callout>
        </>
      )}
    </Section>
  );
}

function TowersTab({ data, ev, setEv, tw, setTw, res, busy, run, item, setItem }) {
  const set = (k, v) => setTw((t) => ({ ...t, [k]: v }));
  const bestBase = res?.base ? Math.min(...res.base.map((b) => b.rmse)) : null;
  return (
    <Section title="Two towers — content-based filtering with deep learning"
      note="A user network turns what we know about the user (their average rating of each feature, and overall) into k numbers v_user; an item network turns the item’s features into k numbers v_item. Predicted rating = v_user · v_item + the average rating. Both networks are trained together on the training ratings (with Adam, the usual optimiser for neural networks).">
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))" }}>
        <Field label="k (vector length)"><input type="number" min="1" max="16" value={tw.k} onChange={(e) => set("k", Math.max(1, Math.min(16, Math.round(Number(e.target.value)))))} style={inp} /></Field>
        <Field label="hidden units" hint="0 = each tower is linear"><input type="number" min="0" max="64" value={tw.hidden} onChange={(e) => set("hidden", Math.max(0, Math.min(64, Math.round(Number(e.target.value)))))} style={inp} /></Field>
        <Field label="learning rate"><input type="number" step="0.001" min="0" value={tw.lr} onChange={(e) => set("lr", Number(e.target.value))} style={inp} /></Field>
        <Field label="λ"><input type="number" step="0.01" min="0" value={tw.lambda} onChange={(e) => set("lambda", Number(e.target.value))} style={inp} /></Field>
        <Field label="epochs"><input type="number" step="50" min="10" max="3000" value={tw.epochs} onChange={(e) => set("epochs", Math.max(10, Math.min(3000, Math.round(Number(e.target.value)))))} style={inp} /></Field>
        <Field label="train / test"><select value={ev.train} onChange={(e) => setEv((v) => ({ ...v, train: Number(e.target.value) }))} style={inp}>{[90, 80, 70].map((v) => <option key={v} value={v}>{v}% / {100 - v}%</option>)}</select></Field>
        <Field label="seed"><input type="number" min="1" value={ev.seed} onChange={(e) => setEv((v) => ({ ...v, seed: Math.max(1, Math.round(Number(e.target.value))) }))} style={inp} /></Field>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "14px 0" }}>
        <button onClick={run} disabled={busy} style={primaryBtn}>{busy ? "Training…" : "Train the two towers"}</button>
        {busy && <Spinner label="training" />}
      </div>
      {res?.diverged && <Callout tone="bad" title="Training diverged">The learning rate is too large: lower it and train again.</Callout>}
      {res && !res.diverged && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <Stat label="train RMSE" value={fx(res.trainRMSE)} />
            <Stat label="test RMSE" value={fx(res.testRMSE)} tone={bestBase != null && res.testRMSE < bestBase ? "good" : "warn"} hint={bestBase != null ? `best baseline ${fx(bestBase)}` : undefined} />
          </div>
          <Curves data={res.history} series={[{ key: "train", label: "train RMSE", color: C.good }, { key: "test", label: "test RMSE", color: C.bad, dash: true }]} xLabel="epoch" yLabel="RMSE" />
          {res.base && <Table head={["baseline", "test RMSE"]} rows={res.base.map((b) => [b.name, fx(b.rmse)])} />}
          <h3 style={h3}>Similar items from the learned vectors: smallest ‖v(k) − v(i)‖²</h3>
          <div style={{ marginBottom: 8 }}><select value={item} onChange={(e) => setItem(Number(e.target.value))} style={{ ...inp, width: 260 }}>{data.items.map((it, i) => <option key={i} value={i}>{it}</option>)}</select></div>
          <Table head={["item", "squared distance", "cosine of the raw features"]}
            rows={similarItems(res.vm, item, Math.min(6, data.items.length - 1), "sqdist").map((s) => [data.items[s.i], fx(s.value, 4), fx(cosine(data.X[item], data.X[s.i]), 3)])} />
          <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6 }}>
            In a real catalogue (millions of items) these distances are computed in advance; at request time a fast <em>retrieval</em> step picks a few hundred
            candidates and a <em>ranking</em> step scores them with the full model (note §8.5).
          </p>
        </>
      )}
    </Section>
  );
}

const h3 = { fontSize: 13, fontWeight: 600, margin: "16px 0 8px" };
const sub = { fontSize: 11.5, color: C.mut, margin: "4px 0 6px" };
const chipLike = { background: C.surf, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 5, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" };
const primaryBtn = { background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6, padding: "9px 22px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
