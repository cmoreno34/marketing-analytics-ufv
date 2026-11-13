/* Two towers by hand — the step-by-step view of workbook D4 v1.1 (sheets
 * "two towers by hand" and "two towers simulation"), inside tab 4 of the
 * Content-Based Lab.
 *
 * Matrix factorisation B4 with one linear layer per tower: w(j) = V·e_u(j),
 * x(i) = Q·e_m(i), ŷ = w·x + b (w and x keep B4's meaning: the vectors whose
 * product is the prediction; e_u, e_m are the learned ID embeddings, the
 * towers' inputs. In the model code W/X hold e_u/e_m and U/M hold w/x). Every table is laid out as in the workbook
 * (users across, movies down) and carries the Excel range it must match, so a
 * student can check the sheet cell for cell. Iterations 0–2 are the hand
 * sheet's ITER0–ITER2 blocks; later ones are rows of the simulation sheet.
 *
 * Deep link: #/content-based?tab=towers&mode=hand&alpha=0.005&lambda=0.1&iter=2&ret=3
 *            &start=identity|custom&V=1,0.5,0.5,1&Q=1,0.5,0.5,1 */

import { useMemo } from "react";
import { C, inp } from "../theme.js";
import { Section, Callout, Stat, Table, Field, Chip } from "../components/UI.jsx";
import { Curves } from "../components/RecCharts.jsx";
import { TT, runTT, iterateTT, retrievalTT } from "../lib/twoTowersHand.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const MAX_IT = 300;
const BLOCKS = [26, 72, 118];          // first row of ITER0, ITER1, ITER2 in the hand sheet
const RET = 164;                       // first row of the retrieval block
const MIX = [[1, 0.5], [0.5, 1]];      // the default "other" start
const f4 = (v) => (v === null || v === undefined ? <span style={{ color: C.mut }}>—</span> : Number.isFinite(v) ? v.toFixed(4) : "—");

function readMatrix2(s, fallback) {
  const v = (s ?? "").split(",").map(Number);
  return v.length === 4 && v.every(Number.isFinite) ? [[v[0], v[1]], [v[2], v[3]]] : fallback;
}

export function initHand(params) {
  const n = (k, d) => (params.get(k) !== null && Number.isFinite(Number(params.get(k))) ? Number(params.get(k)) : d);
  return {
    alpha: n("alpha", TT.alpha), lambda: n("lambda", TT.lambda),
    iter: Math.max(0, Math.min(MAX_IT, Math.round(n("iter", 0)))), ret: Math.max(0, Math.min(MAX_IT, Math.round(n("ret", 3)))),
    identity: params.get("start") !== "custom",
    V: readMatrix2(params.get("V"), MIX), Q: readMatrix2(params.get("Q"), MIX),
  };
}

/* The Excel ranges of every table, for iteration t. */
function cellsFor(t) {
  if (t > 2) {
    const r = 28 + t;
    return { sim: true, params: `simulation row ${r}`, J: `simulation CL${r}`, Jreg: `simulation CM${r}`, next: `simulation row ${r + 1}` };
  }
  const r = BLOCKS[t], R = (a, b) => `${a}:${b}`;
  return {
    b: R(`B${r + 2}`, `E${r + 4}`), x: R(`A${r + 7}`, `B${r + 11}`), V: R(`B${r + 15}`, `C${r + 16}`), Q: R(`B${r + 20}`, `C${r + 21}`),
    u: R(`I${r + 2}`, `L${r + 3}`), m: R(`I${r + 6}`, `J${r + 10}`), pred: R(`I${r + 13}`, `L${r + 17}`),
    dif: R(`I${r + 20}`, `L${r + 24}`), db: R(`I${r + 25}`, `L${r + 25}`), sq: R(`I${r + 28}`, `L${r + 32}`),
    reg: `B${r + 32}`, J: `I${r + 36}`, Jreg: `I${r + 37}`,
    difM1: R(`Q${r + 9}`, `T${r + 13}`), dU1: R(`Q${r + 14}`, `T${r + 14}`), difM2: R(`W${r + 9}`, `Z${r + 13}`), dU2: R(`W${r + 14}`, `Z${r + 14}`),
    difU1: R(`AC${r + 9}`, `AF${r + 13}`), dM1: R(`AG${r + 9}`, `AG${r + 13}`), difU2: R(`AJ${r + 9}`, `AM${r + 13}`), dM2: R(`AN${r + 9}`, `AN${r + 13}`),
    gV: R(`Q${r + 24}`, `R${r + 25}`), gQ: R(`W${r + 24}`, `X${r + 25}`), gB: R(`Q${r + 28}`, `T${r + 30}`), gX: R(`W${r + 28}`, `X${r + 32}`),
    nB: R(`Q${r + 37}`, `T${r + 39}`), nX: R(`V${r + 37}`, `W${r + 41}`), nV: R(`AB${r + 37}`, `AC${r + 38}`), nQ: R(`AF${r + 37}`, `AG${r + 38}`),
  };
}

/* A titled table with its Excel range on the right. */
function Block({ title, cell, children, note }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "4px 0 6px" }}>
        <span style={{ fontSize: 11.5, color: C.txt }}>{title}</span>
        {cell && <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10.5, color: C.acc, whiteSpace: "nowrap" }}>{cell}</span>}
      </div>
      {children}
      {note && <p style={{ fontSize: 11, color: C.mut, margin: "5px 0 0", lineHeight: 1.5 }}>{note}</p>}
    </div>
  );
}

const users = TT.users, items = TT.items;
const byUser = (labels, rows) => <Table head={["", ...users]} rows={labels.map((l, r) => [l, ...rows[r].map(f4)])} />;
const byMovie = (head, M, extra) => <Table head={["movie", ...head]} rows={items.map((it, i) => [it, ...M[i].map(f4), ...(extra ? [extra(i)] : [])])} />;
const mat2 = (M) => <Table head={["", "col 1", "col 2"]} rows={M.map((r, k) => [`row ${k + 1}`, ...r.map(f4)])} />;
const transpose = (M) => M[0].map((_, c) => M.map((r) => r[c]));
const userParams = (p) => [p.b, p.W.map((w) => w[0]), p.W.map((w) => w[1])];

export default function TwoTowersHand({ cfg, setCfg }) {
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  const start = useMemo(() => (cfg.identity ? TT.start : { ...TT.start, V: cfg.V, Q: cfg.Q }), [cfg.identity, cfg.V, cfg.Q]);
  const run = useMemo(() => runTT({ start, alpha: cfg.alpha, lambda: cfg.lambda, iters: MAX_IT }), [start, cfg.alpha, cfg.lambda]);
  const last = run.params.length - 1;
  const t = Math.min(cfg.iter, last);
  const step = useMemo(() => iterateTT(run.params[t], { alpha: cfg.alpha, lambda: cfg.lambda }), [run, t, cfg.alpha, cfg.lambda]);
  const tr = Math.min(cfg.ret, last);
  const ret = useMemo(() => retrievalTT(run.params[tr]), [run, tr]);
  const cells = cellsFor(t);
  const { p, f, g, next } = step;
  const h = run.history.filter((d) => Number.isFinite(d.J));
  const rises = h.length > 1 && h[1].J > h[0].J;
  const setM = (key, k, l, v) => set(key, cfg[key].map((r, a) => r.map((x, b) => (a === k && b === l ? v : x))));

  return (
    <Section title="By hand: matrix factorisation + one layer per tower (workbook D4 v1.1)"
      note="B4’s toy data built in (5 movies × 4 users). The prediction is B4’s, ŷ = w(j)·x(i) + b(j), but w(j) and x(i) are now the output of a tower — one layer of weights — whose input is a learned ID embedding: w(j) = V·e_u(j), x(i) = Q·e_m(i). With V = Q = I it is exactly B4. Gradient descent learns all 30 parameters (4 b, 8 e_u, 10 e_m, 4 V, 4 Q) at once. Every table names the cells of the sheet “two towers by hand” it must equal.">
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <Field label="α (learning rate)" hint="Workbook: Q17 = 0.005">
          <input type="number" step="0.001" min="0" value={cfg.alpha} onChange={(e) => set("alpha", Number(e.target.value))} style={inp} />
        </Field>
        <Field label="λ (regularisation)" hint="Workbook: Q18 = 0.1">
          <input type="number" step="0.01" min="0" value={cfg.lambda} onChange={(e) => set("lambda", Number(e.target.value))} style={inp} />
        </Field>
        <Field label={`iteration (0–${MAX_IT})`} hint={t <= 2 ? `= block ITER${t} of the hand sheet` : `= row ${28 + t} of the simulation sheet`}>
          <input type="number" min="0" max={MAX_IT} value={cfg.iter} onChange={(e) => set("iter", Math.max(0, Math.min(MAX_IT, Math.round(Number(e.target.value)) || 0)))} style={inp} />
        </Field>
        <Field label="retrieval: parameters after" hint="Workbook rows 164–199 use 3 updates">
          <input type="number" min="0" max={MAX_IT} value={cfg.ret} onChange={(e) => set("ret", Math.max(0, Math.min(MAX_IT, Math.round(Number(e.target.value)) || 0)))} style={inp} />
        </Field>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", margin: "10px 0 4px" }}>
        <span style={{ fontSize: 11, color: C.mut, marginRight: 4 }}>Go to iteration:</span>
        {[0, 1, 2, 3, 10, 100, 300].map((v) => <Chip key={v} active={cfg.iter === v} onClick={() => set("iter", v)}>{v}</Chip>)}
        <input type="range" min="0" max={MAX_IT} value={cfg.iter} onChange={(e) => set("iter", Number(e.target.value))} style={{ flex: "1 1 160px", accentColor: C.acc }} aria-label="iteration" />
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, margin: "10px 0 4px", cursor: "pointer" }}>
        <input type="checkbox" checked={cfg.identity} onChange={(e) => set("identity", e.target.checked)} />
        towers start as the identity (V = Q = I: ITER0 is exactly B4, J = 14.6)
      </label>
      {!cfg.identity && (
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", margin: "6px 0 4px", alignItems: "flex-start" }}>
          {["V", "Q"].map((key) => (
            <div key={key}>
              <div style={{ fontSize: 11, color: C.mut, marginBottom: 4 }}>{key === "V" ? "user tower V" : "item tower Q"} at the start</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 76px)", gap: 4 }}>
                {[0, 1].flatMap((k) => [0, 1].map((l) => (
                  <input key={`${k}${l}`} type="number" step="0.1" value={cfg[key][k][l]} aria-label={`${key}${k + 1}${l + 1}`}
                    onChange={(e) => setM(key, k, l, Number(e.target.value))} style={{ ...inp, padding: "5px 7px" }} />
                )))}
              </div>
            </div>
          ))}
          <p style={{ fontSize: 11.5, color: C.mut, maxWidth: 420, lineHeight: 1.6, margin: 0 }}>
            Not the identity: the towers mix the two learned numbers before the dot product, so ITER0 is no longer B4.
            Type the same V and Q in the workbook’s ITER0 block (B41:C42 and B46:C47) to compare.
          </p>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
        <button style={ghostBtn} onClick={() => setCfg((c) => ({ ...c, alpha: TT.alpha, lambda: TT.lambda, identity: true }))}>Workbook values (α 0.005, λ 0.1, identity)</button>
        <button style={ghostBtn} onClick={() => setCfg((c) => ({ ...c, alpha: 0.02, iter: 1 }))}>Try B4’s α = 0.02</button>
      </div>

      {run.diverged && <Callout tone="bad" title="Gradient descent diverged">J overflowed after {last} updates: α = {cfg.alpha} is far too large for two layers in series. Lower it.</Callout>}
      {rises && !run.diverged && (
        <Callout tone="warn" title="J went up on the first step">
          From {h[0].J.toFixed(4)} to {h[1].J.toFixed(4)}. With two layers in series a change in V multiplies a change in w, so the same α moves the predictions
          much more than in B4: B4’s α = 0.02 makes J jump from 14.6 to about 54.6. That is why the workbook uses α = 0.005.
        </Callout>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
        <Stat label={`J · iteration ${t}`} value={f4(f.J)} hint={cells.J} />
        <Stat label={`J+reg · iteration ${t}`} value={f4(f.Jreg)} hint={cells.Jreg} />
        <Stat label={`J · iteration ${MAX_IT}`} value={run.diverged ? "∞" : f4(h.at(-1).J)} hint={`J+reg ${run.diverged ? "∞" : h.at(-1).Jreg.toFixed(4)} · simulation CL328`} />
      </div>
      {h.length > 1 && (
        <Curves data={h} series={[{ key: "J", label: "J (squared errors)", color: C.acc }, { key: "Jreg", label: "J+reg", color: C.warn, dash: true }]}
          yLabel="cost" logY={h[0].Jreg / Math.max(h.at(-1).J, 1e-9) > 20} />
      )}
      <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, margin: "6px 0 0" }}>
        The same curve as the chart of the sheet “two towers simulation” (one row per iteration from row 28). J keeps falling towards 0 while J+reg levels off:
        the penalty λ/2·Σθ² stops the parameters from growing just to fit five-star ratings exactly.
      </p>

      <h3 style={h3}>ITER{t} — the parameters after {t} update{t === 1 ? "" : "s"} {cells.sim && <span style={simTag}>beyond the hand sheet: {cells.params}</span>}</h3>
      <div style={grid}>
        <Block title="b(j) and the user ID embedding e_u(j)" cell={cells.b}>{byUser(["b", "eu1", "eu2"], userParams(p))}</Block>
        <Block title="movie ID embedding e_m(i), learned" cell={cells.x}>{byMovie(["em1", "em2"], p.X)}</Block>
        <Block title="V — user tower weights" cell={cells.V}>{mat2(p.V)}</Block>
        <Block title="Q — item tower weights" cell={cells.Q}>{mat2(p.Q)}</Block>
      </div>

      <h3 style={h3}>Forward pass — w(j) = V·e_u(j), x(i) = Q·e_m(i), ŷ = w·x + b</h3>
      <div style={grid}>
        <Block title="user tower w(j): w_k = V_k1·eu1 + V_k2·eu2" cell={cells.u}>{byUser(["w1", "w2"], transpose(f.U))}</Block>
        <Block title="item tower x(i): x_k = Q_k1·em1 + Q_k2·em2" cell={cells.m}>{byMovie(["x1", "x2"], f.M)}</Block>
      </div>
      <div style={{ marginTop: 10 }}>
        <Block title="predictions ŷ(i,j) = w1·x1 + w2·x2 + b (as B4)" cell={cells.pred} note="Green: not rated — what the model would recommend from.">
          <Table head={["movie", ...users]} rows={items.map((it, i) => [it, ...users.map((_, j) => (TT.Y[i][j] === null
            ? <strong style={{ color: C.good }}>{f4(f.P[i][j])}</strong> : f4(f.P[i][j])))])} />
        </Block>
      </div>

      <h3 style={h3}>Cost</h3>
      <div style={grid}>
        <Block title="differences ŷ − y (rated cells only) and their sum = ∂J/∂b(j)" cell={`${cells.dif ?? ""}${cells.db ? ` · sum ${cells.db}` : ""}`}>
          <Table head={["movie", ...users]} rows={[...items.map((it, i) => [it, ...f.E[i].map(f4)]), [<strong>sum = ∂J/∂b</strong>, ...g.db.map((v) => <strong>{f4(v)}</strong>)]]} />
        </Block>
        <Block title="squared differences" cell={cells.sq}>
          <Table head={["movie", ...users]} rows={items.map((it, i) => [it, ...f.S2[i].map(f4)])} />
        </Block>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <Stat label="J = ½ Σ squared" value={f4(f.J)} hint={cells.J} />
        <Stat label="λ/2 (Σe_u² + Σe_m² + ΣV² + ΣQ²)" value={f4(f.reg)} hint={cells.reg ?? "b is not regularised"} />
        <Stat label="J+reg" value={f4(f.Jreg)} hint={cells.Jreg} />
      </div>

      <h3 style={h3}>Backpropagation, step 1 — the gradient at the towers’ outputs</h3>
      <p style={para}>∂J/∂w_k(j) = Σ_i (ŷ − y)·x_k(i), down each user’s column; ∂J/∂x_k(i) = Σ_j (ŷ − y)·w_k(j), across each movie’s row. Exactly B4’s gradients for w and x (without the λ term).</p>
      <div style={grid}>
        {[0, 1].map((k) => (
          <Block key={`m${k}`} title={`dif·x${k + 1}; column sums = ∂J/∂w${k + 1}(j)`} cell={cells.difM1 ? `${k ? cells.difM2 : cells.difM1} · sums ${k ? cells.dU2 : cells.dU1}` : null}>
            <Table head={["movie", ...users]} rows={[...items.map((it, i) => [it, ...g.difM[k][i].map(f4)]), [<strong>∂J/∂w{k + 1}</strong>, ...g.dU.map((d) => <strong>{f4(d[k])}</strong>)]]} />
          </Block>
        ))}
        {[0, 1].map((k) => (
          <Block key={`u${k}`} title={`dif·w${k + 1}; row sums = ∂J/∂x${k + 1}(i)`} cell={cells.difU1 ? `${k ? cells.difU2 : cells.difU1} · sums ${k ? cells.dM2 : cells.dM1}` : null}>
            <Table head={["movie", ...users, `∂J/∂x${k + 1}`]} rows={items.map((it, i) => [it, ...g.difU[k][i].map(f4), <strong>{f4(g.dM[i][k])}</strong>])} />
          </Block>
        ))}
      </div>

      <h3 style={h3}>Backpropagation, step 2 — the chain rule down to the parameters</h3>
      <p style={para}>
        w_k(j) = V_k1·eu1(j) + V_k2·eu2(j), so ∂w_k/∂V_kl = eu_l(j) and ∂w_k/∂eu_l = V_kl:
        ∂J/∂V_kl = Σ_j ∂J/∂w_k(j)·eu_l(j) + λV_kl and ∂J/∂eu_l(j) = Σ_k ∂J/∂w_k(j)·V_kl + λeu_l(j).
        The item tower is the same with x, Q and e_m. ∂J/∂b(j) is the sum of the user’s differences (no λ).
      </p>
      <div style={grid}>
        <Block title="∂J/∂V" cell={cells.gV}>{mat2(g.dV)}</Block>
        <Block title="∂J/∂Q" cell={cells.gQ}>{mat2(g.dQ)}</Block>
        <Block title="∂J/∂b, ∂J/∂eu1, ∂J/∂eu2" cell={cells.gB}>{byUser(["∂J/∂b", "∂J/∂eu1", "∂J/∂eu2"], [g.db, g.dW.map((d) => d[0]), g.dW.map((d) => d[1])])}</Block>
        <Block title="∂J/∂em1, ∂J/∂em2" cell={cells.gX}>{byMovie(["∂J/∂em1", "∂J/∂em2"], g.dX)}</Block>
      </div>

      <h3 style={h3}>Update — θ := θ − α·∂J/∂θ, all 30 at once (α = {cfg.alpha}) {cells.sim && <span style={simTag}>{cells.next}</span>}</h3>
      <div style={grid}>
        <Block title="new b, eu1, eu2" cell={cells.nB}>{byUser(["b", "eu1", "eu2"], userParams(next))}</Block>
        <Block title="new em1, em2" cell={cells.nX}>{byMovie(["em1", "em2"], next.X)}</Block>
        <Block title="new V" cell={cells.nV}>{mat2(next.V)}</Block>
        <Block title="new Q" cell={cells.nQ}>{mat2(next.Q)}</Block>
      </div>
      {t < 2 && <p style={para}>These are the starting values of block ITER{t + 1} (rows {BLOCKS[t + 1] + 2}–{BLOCKS[t + 1] + 21}).</p>}
      {t === 2 && <p style={para}>The parameters after the third update: the retrieval block below uses them.</p>}
      {t === MAX_IT && <p style={para}>The last row of the simulation is iteration {MAX_IT}; this update is not in the workbook.</p>}

      <h3 style={h3}>Vector retrieval with the trained towers — parameters after {tr} update{tr === 1 ? "" : "s"}</h3>
      <p style={para}>
        The item tower is run once per movie and its vectors x(i) are stored in a vector index. When the user opens the app the user tower computes w(j)
        once, and retrieval returns the movies with the highest score w·x among those not seen. b(j) is left out: it is the same for every movie of one user,
        so it does not change her ranking.{tr !== 3 && " (The workbook uses the parameters after 3 updates: set it to 3 to compare.)"}
      </p>
      <div style={grid}>
        <Block title="vector index: x(i) and ‖x‖" cell={tr === 3 ? `I${RET + 3}:K${RET + 7}` : null}>{byMovie(["x1", "x2", "‖x‖"], ret.M.map((m, i) => [...m, ret.normM[i]]))}</Block>
        <Block title="query (user tower): w(j) and ‖w‖" cell={tr === 3 ? `I${RET + 10}:L${RET + 12}` : null}>{byUser(["w1", "w2", "‖w‖"], [...transpose(ret.U), ret.normU])}</Block>
        <Block title="score w·x (green: not rated, the candidates)" cell={tr === 3 ? `I${RET + 15}:L${RET + 19}` : null}>
          <Table head={["movie", ...users]} rows={items.map((it, i) => [it, ...users.map((_, j) => (TT.Y[i][j] === null ? <strong style={{ color: C.good }}>{f4(ret.S[i][j])}</strong> : f4(ret.S[i][j])))])} />
        </Block>
        <Block title="rank among unseen, top-1 and its predicted rating (score + b)" cell={tr === 3 ? `I${RET + 22}:L${RET + 28}` : null}>
          <Table head={["movie", ...users]} rows={[
            ...items.map((it, i) => [it, ...users.map((_, j) => (ret.rank[i][j] === "seen" ? <span style={{ color: C.mut }}>seen</span> : <span style={{ color: ret.rank[i][j] === 1 ? C.good : C.txt }}>{ret.rank[i][j]}</span>))]),
            [<strong>retrieve top-1</strong>, ...ret.top.map((tp) => <strong style={{ color: C.good }}>{tp ? items[tp.i] : "—"}</strong>)],
            ["predicted rating", ...ret.top.map((tp) => f4(tp?.pred))],
          ]} />
        </Block>
        <Block title="cosine(w, x) = w·x / (‖w‖·‖x‖)" cell={tr === 3 ? `I${RET + 31}:L${RET + 35}` : null} note="Cosine ignores the length of the vectors: only the direction (the taste) counts.">
          <Table head={["movie", ...users]} rows={items.map((it, i) => [it, ...users.map((_, j) => (TT.Y[i][j] === null ? <strong style={{ color: C.good }}>{f4(ret.cos[i][j])}</strong> : f4(ret.cos[i][j])))])} />
        </Block>
      </div>
      <Callout tone="info" title="Vector indexes, ANN and RAG">
        With millions of items nobody computes every w·x: the item vectors sit in a vector index and approximate nearest-neighbour search (ANN — HNSW graphs,
        FAISS, ScaNN) finds almost the same top-N in milliseconds by visiting only the region of the space near w(j). This retrieval step feeds the
        ranking model (Module 5). RAG uses exactly the same mechanism: a query tower and a document tower put questions and text chunks in one vector space,
        and the top-k chunks by dot product or cosine are pasted into the language model’s prompt.
      </Callout>
    </Section>
  );
}

const h3 = { fontSize: 13, fontWeight: 600, margin: "22px 0 8px", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" };
const para = { fontSize: 11.5, color: C.mut, lineHeight: 1.6, margin: "0 0 10px" };
const grid = { display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" };
const simTag = { fontFamily: MONO, fontSize: 10.5, color: C.acc, fontWeight: 400 };
const ghostBtn = { background: "transparent", color: C.acc, border: `1px solid ${C.bord}`, borderRadius: 6, padding: "6px 11px", fontSize: 11.5, cursor: "pointer" };
