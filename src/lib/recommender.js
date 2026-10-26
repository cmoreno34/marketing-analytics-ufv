/* Recommender maths — module 10 (technical note "Recommender systems").
 *
 * One model throughout, the note's model (§3–4), so the lab, the Excel
 * workbooks and the note give the same numbers:
 *
 *   prediction(i, j) = w(j) · x(i) + b(j)            (+ the movie mean if normalised)
 *   J = ½ Σ_{r(i,j)=1} (prediction − y)²  +  λ/2 Σ w²  [ +  λ/2 Σ x²  when x is learned ]
 *
 * Batch gradient descent, every parameter updated from the same errors. The
 * bias b is not regularised (as in the note). With the A4/B4 starting values
 * this reproduces the workbooks cell for cell (test/recommender.test.js).
 *
 * Content-based part (note §8): item profiles, user profiles from mean-centred
 * ratings, cosine similarity, precision@N against a popularity baseline, and
 * the two-tower model (a user network and an item network whose
 * outputs are multiplied).
 *
 * Matrices are item × user, like the workbooks: Y[i][j] is user j's rating of
 * item i, null when not rated.
 */

import { mulberry32 } from "./prep.js";

/* ── Reading a table ─────────────────────────────────────────────────────── */

export const isBlank = (v) =>
  v === null || v === undefined || (typeof v === "string" && /^\s*(#|\?|-|na|n\/a|nan|)\s*$/i.test(v));

export function num(v) {
  if (isBlank(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const FEATURE_NAME = /^(x\d+|feature|romance|action|comedy|drama|thriller|horror|sci.?fi|animation|family|documentary|adventure|crime|fantasy|genre|price|year|length|duration)/i;

/* First text column = the item. A numeric column is a FEATURE when its name
 * says so, or when it is complete and lies in [0, 1] while the rating columns
 * have gaps — the shape of every course file. The student can change it. */
export function guessColumns(headers, rows, forcedItem) {
  const numericShare = (h) => {
    const vals = rows.map((r) => r[h]).filter((v) => !isBlank(v));
    return vals.length ? vals.filter((v) => num(v) !== null).length / vals.length : 0;
  };
  const item = forcedItem ?? headers.find((h) => numericShare(h) < 0.5) ?? headers[0];
  const numeric = headers.filter((h) => h !== item && numericShare(h) >= 0.9);
  const stats = Object.fromEntries(numeric.map((h) => {
    const v = rows.map((r) => num(r[h]));
    const present = v.filter((x) => x !== null);
    return [h, { missing: v.length - present.length, min: Math.min(...present), max: Math.max(...present) }];
  }));
  const anyGaps = numeric.some((h) => stats[h].missing > 0);
  const features = numeric.filter((h) =>
    FEATURE_NAME.test(h) || (anyGaps && stats[h].missing === 0 && stats[h].min >= 0 && stats[h].max <= 1));
  return { item, users: numeric.filter((h) => !features.includes(h)), features };
}

export function readMatrix(rows, { item, users, features }) {
  const kept = rows.filter((r) => !isBlank(r[item]));
  return {
    items: kept.map((r) => String(r[item]).trim()),
    users: [...users],
    features: [...features],
    Y: kept.map((r) => users.map((u) => num(r[u]))),
    X: features.length ? kept.map((r) => features.map((f) => num(r[f]) ?? 0)) : null,
  };
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const zeros = (r, c) => Array.from({ length: r }, () => new Array(c).fill(0));
const dot = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };
export const clone = (M) => M.map((r) => [...r]);

export function countRated(Y) {
  let n = 0;
  for (const r of Y) for (const v of r) if (v !== null) n++;
  return n;
}

export function rmse(P, Y) {
  let s = 0, n = 0;
  for (let i = 0; i < Y.length; i++) for (let j = 0; j < Y[i].length; j++) {
    if (Y[i][j] === null) continue;
    const e = P[i][j] - Y[i][j];
    s += e * e; n++;
  }
  return n ? Math.sqrt(s / n) : NaN;
}

/* Hold out a share of the KNOWN ratings, reproducibly: same seed, same split,
 * so every group in a class sees the same numbers. */
export function splitTrainTest(Y, trainPct, seed = 1) {
  const train = clone(Y), test = Y.map((r) => r.map(() => null));
  if (trainPct >= 100) return { train, test, nTest: 0 };
  const cells = [];
  Y.forEach((r, i) => r.forEach((v, j) => { if (v !== null) cells.push([i, j]); }));
  const rng = mulberry32(seed);
  for (let a = cells.length - 1; a > 0; a--) {
    const b = Math.floor(rng() * (a + 1));
    [cells[a], cells[b]] = [cells[b], cells[a]];
  }
  const nTrain = Math.round((cells.length * trainPct) / 100);
  cells.slice(nTrain).forEach(([i, j]) => { test[i][j] = Y[i][j]; train[i][j] = null; });
  return { train, test, nTest: cells.length - nTrain };
}

/* Mean rating of each item over the ratings it has (0 if none) — what mean
 * normalisation subtracts, and the "predict the movie's average" baseline. */
export function itemMeans(Y) {
  return Y.map((r) => {
    const v = r.filter((x) => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  });
}

export function userMeans(Y) {
  const nu = Y[0]?.length ?? 0;
  return Array.from({ length: nu }, (_, j) => {
    const v = Y.map((r) => r[j]).filter((x) => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  });
}

/* The three predictions any model has to beat. */
export function baselines(train, test) {
  const all = train.flat().filter((v) => v !== null);
  const g = all.reduce((a, b) => a + b, 0) / (all.length || 1);
  const im = itemMeans(train), um = userMeans(train);
  const nm = train.length, nu = train[0].length;
  const P = (f) => Array.from({ length: nm }, (_, i) => Array.from({ length: nu }, (_, j) => f(i, j)));
  const hasItem = train.map((r) => r.some((v) => v !== null));
  return [
    { name: "Everyone gets the overall average", rmse: rmse(P(() => g), test) },
    { name: "Each movie's average rating", rmse: rmse(P((i) => (hasItem[i] ? im[i] : g)), test) },
    { name: "Each user's average rating", rmse: rmse(P((_, j) => um[j]), test) },
  ];
}

/* ── Collaborative filtering, the note's model ───────────────────────────── */

export function cfCost(Y, X, W, b, lambda, lambdaX, learnX) {
  let J = 0;
  for (let i = 0; i < Y.length; i++) for (let j = 0; j < W.length; j++) {
    if (Y[i][j] === null) continue;
    const e = dot(W[j], X[i]) + b[j] - Y[i][j];
    J += e * e;
  }
  J /= 2;
  let w2 = 0, x2 = 0;
  for (const r of W) for (const v of r) w2 += v * v;
  if (learnX) for (const r of X) for (const v of r) x2 += v * v;
  return J + (lambda / 2) * w2 + (learnX ? (lambdaX / 2) * x2 : 0);
}

/* One batch gradient-descent step. Returns the new parameters and the
 * intermediate quantities the workbooks show (errors and gradients), so the
 * step-by-step view can be checked against Excel cell by cell. */
export function cfStep(Y, X, W, b, { alpha, lambda, lambdaX = lambda, learnX }) {
  const nm = Y.length, nu = W.length, k = W[0].length;
  const E = Y.map((r, i) => r.map((y, j) => (y === null ? null : dot(W[j], X[i]) + b[j] - y)));
  const gW = zeros(nu, k), gb = new Array(nu).fill(0), gX = zeros(nm, k);
  for (let i = 0; i < nm; i++) for (let j = 0; j < nu; j++) {
    const e = E[i][j];
    if (e === null) continue;
    gb[j] += e;
    for (let f = 0; f < k; f++) { gW[j][f] += e * X[i][f]; gX[i][f] += e * W[j][f]; }
  }
  for (let j = 0; j < nu; j++) for (let f = 0; f < k; f++) gW[j][f] += lambda * W[j][f];
  if (learnX) for (let i = 0; i < nm; i++) for (let f = 0; f < k; f++) gX[i][f] += lambdaX * X[i][f];
  const J = cfCost(Y, X, W, b, lambda, lambdaX, learnX);
  return {
    J, E, gW, gb, gX,
    W: W.map((r, j) => r.map((v, f) => v - alpha * gW[j][f])),
    b: b.map((v, j) => v - alpha * gb[j]),
    X: learnX ? X.map((r, i) => r.map((v, f) => v - alpha * gX[i][f])) : X,
  };
}

export function predict(X, W, b, mu) {
  return X.map((x, i) => W.map((w, j) => dot(w, x) + b[j] + (mu ? mu[i] : 0)));
}

/* Starting values. Random ones are small and centred on zero (with learned
 * features, all-equal starting values would make every movie identical for
 * ever); b starts at 0. Same seed, same start. */
export function initParams(nm, nu, k, learnX, seed = 1, Xknown = null) {
  const rng = mulberry32(seed);
  const r = () => (rng() - 0.5) * 0.2;
  return {
    X: learnX ? Array.from({ length: nm }, () => Array.from({ length: k }, r)) : clone(Xknown),
    W: Array.from({ length: nu }, () => Array.from({ length: k }, r)),
    b: new Array(nu).fill(0),
  };
}

/* The A4 and B4 starting values, as typed in the workbooks. */
export const TOY = {
  items: ["love at last", "romance forever", "cute puppies", "nonstop car", "swords"],
  users: ["Alice", "Bob", "Carol", "Dave"],
  Y: [[5, 5, 0, 0], [5, null, null, 0], [null, 4, 0, null], [0, 0, 5, 4], [0, 0, 5, null]],
  features: ["romance", "action"],
  X: [[0.9, 0], [1, 0.01], [0.99, 0], [0.1, 1], [0, 0.9]],
  A4: { b: [2, 2, 2, 1.5], W: [[2.5, -2], [2, -2], [-2, 2.5], [-2, 2]], alpha: 0.2, lambda: 0.1 },
  B4: { b: [0, 0, 0, 0], W: [[5, 1], [5, 1], [1, 5], [1, 5]],
    X: [[0.8, 0.2], [0.8, 0.2], [0.8, 0.2], [0.2, 0.8], [0.2, 0.8]], alpha: 0.02, lambda: 0.1 },
};

/* Number of parameters gradient descent has to learn (note §5). */
export const paramCount = (nm, nu, k, learnX) => nu * k + nu + (learnX ? nm * k : 0);

/* Full training run.
 *   Y        ratings used for training (item × user, null = unknown)
 *   Xknown   features when known; null to learn k of them
 *   test     held-out ratings (optional) for the test RMSE
 *   start    {X, W, b} to start from (the workbooks' values); else random
 *   normalise  subtract each movie's mean first (note §3, mean normalisation) */
export function trainCF({ Y, Xknown = null, k = 2, alpha = 0.01, lambda = 0.1, iters = 1000, seed = 1,
  normalise = false, test = null, start = null, every = 0 }) {
  const learnX = !Xknown;
  const nm = Y.length, nu = Y[0].length;
  const K = learnX ? k : Xknown[0].length;
  const mu = normalise ? itemMeans(Y) : null;
  const Yn = mu ? Y.map((r, i) => r.map((v) => (v === null ? null : v - mu[i]))) : Y;
  let { X, W, b } = start ? { X: clone(start.X), W: clone(start.W), b: [...start.b] } : initParams(nm, nu, K, learnX, seed, Xknown);
  const step = every || Math.max(1, Math.round(iters / 200));
  const history = [];
  let diverged = false, last = Infinity, done = 0;
  for (let t = 0; t <= iters; t++) {
    const s = t < iters ? cfStep(Yn, X, W, b, { alpha, lambda, learnX }) : { J: cfCost(Yn, X, W, b, lambda, lambda, learnX) };
    if (!Number.isFinite(s.J) || s.J > 1e12 || (t > 5 && s.J > last * 1e3)) { diverged = true; break; }
    if (t % step === 0 || t === iters) {
      const P = predict(X, W, b, mu);
      history.push({ iter: t, J: s.J, train: rmse(P, Y), test: test ? rmse(P, test) : null });
    }
    last = Math.min(last, s.J);
    if (t < iters) ({ X, W, b } = s);
    done = t;
  }
  const P = predict(X, W, b, mu);
  return {
    X, W, b, mu, P, history, diverged, iters: done, learnX, k: K,
    J: history.length ? history[history.length - 1].J : NaN,
    trainRMSE: rmse(P, Y), testRMSE: test ? rmse(P, test) : null,
    nParams: paramCount(nm, nu, K, learnX), nRatings: countRated(Y),
  };
}

/* The first `steps` updates with every intermediate value, for the
 * step-by-step (Excel) view. */
export function traceCF({ Y, X, W, b, alpha, lambda, lambdaX = lambda, learnX, steps = 3 }) {
  const out = [];
  for (let t = 0; t < steps; t++) {
    const s = cfStep(Y, X, W, b, { alpha, lambda, lambdaX, learnX });
    out.push({ iter: t, before: { X, W, b }, ...s, P: predict(X, W, b) });
    ({ X, W, b } = s);
  }
  out.push({ iter: steps, before: { X, W, b }, J: cfCost(Y, X, W, b, lambda, lambdaX, learnX), P: predict(X, W, b) });
  return out;
}

/* Top-n unrated items for each user. */
export function recommend(P, Y, n = 3) {
  return Y[0].map((_, j) => P.map((r, i) => ({ i, score: r[j] }))
    .filter(({ i }) => Y[i][j] === null)
    .sort((a, c) => c.score - a.score)
    .slice(0, n));
}

/* ── Content-based filtering (note §8) ───────────────────────────────────── */

export function cosine(a, b) {
  const na = Math.sqrt(dot(a, a)), nb = Math.sqrt(dot(b, b));
  return na && nb ? dot(a, b) / (na * nb) : 0;
}

export const sqDist = (a, b) => a.reduce((s, v, k) => s + (v - b[k]) ** 2, 0);

/* A user's taste in the items' own terms: the item features weighted by how
 * much more (or less) than usual the user liked each item,
 *     profile(j) = Σ_i (r_ij − r̄_j) · x(i) / Σ_i |r_ij − r̄_j|.
 * Items rated above the user's average pull the profile towards their
 * features; items rated below push it away. */
export function userProfile(Y, X, j) {
  const rated = Y.map((r, i) => [i, r[j]]).filter(([, v]) => v !== null);
  const mean = rated.reduce((s, [, v]) => s + v, 0) / (rated.length || 1);
  const nf = X[0].length;
  const p = new Array(nf).fill(0);
  let wsum = 0;
  const weights = rated.map(([i, v]) => {
    const w = v - mean;
    for (let f = 0; f < nf; f++) p[f] += w * X[i][f];
    wsum += Math.abs(w);
    return { i, rating: v, weight: w };
  });
  return { mean, profile: wsum ? p.map((v) => v / wsum) : p, weights, wsum };
}

/* Score of every item for every user: cosine(profile, item features). */
export function contentScores(Y, X) {
  const profiles = Y[0].map((_, j) => userProfile(Y, X, j).profile);
  return X.map((x) => profiles.map((p) => cosine(p, x)));
}

export function itemSimilarity(X) {
  return X.map((a) => X.map((b) => cosine(a, b)));
}

/* "Users who liked this also…" is collaborative; "items like this one" is
 * content-based: nearest items by cosine of their features (or, for learned
 * vectors, by squared distance). */
export function similarItems(V, i, n = 5, metric = "cosine") {
  return V.map((v, m) => ({ i: m, value: metric === "cosine" ? cosine(V[i], v) : sqDist(V[i], v) }))
    .filter(({ i: m }) => m !== i)
    .sort((a, b) => (metric === "cosine" ? b.value - a.value : a.value - b.value))
    .slice(0, n);
}

/* Ranking quality on held-out ratings. For each user with at least one liked
 * test item: rank every item the user has NOT rated in training, take the top
 * n, and count how many are held-out items the user liked (rating ≥ like).
 * The popularity baseline ranks by each item's average training rating. */
export function precisionAtN(scores, train, test, n = 3, like = 4) {
  const nu = train[0].length;
  let hits = 0, slots = 0, users = 0, relevant = 0;
  for (let j = 0; j < nu; j++) {
    const liked = new Set(test.map((r, i) => [i, r[j]]).filter(([, v]) => v !== null && v >= like).map(([i]) => i));
    if (!liked.size) continue;
    const ranked = scores.map((r, i) => ({ i, s: r[j] })).filter(({ i }) => train[i][j] === null)
      .sort((a, b) => b.s - a.s).slice(0, n);
    const h = ranked.filter(({ i }) => liked.has(i)).length;
    hits += h; slots += ranked.length; users++; relevant += Math.min(liked.size, n);
  }
  return { precision: slots ? hits / slots : NaN, recall: relevant ? hits / relevant : NaN, users, hits };
}

export function popularityScores(train) {
  const m = itemMeans(train);
  return train.map((r, i) => r.map(() => m[i]));
}

/* ── Two towers (note §8.4) ──────────────────────────────────── */

/* What the user network sees: the user's average rating of each feature,
 * weighted by how much of the feature the item has, plus the user's overall
 * average — "the user's average rating per genre". */
export function userFeatures(Y, X) {
  const nf = X[0].length, nu = Y[0].length;
  return Array.from({ length: nu }, (_, j) => {
    const out = [];
    let all = 0, n = 0;
    for (let f = 0; f < nf; f++) {
      let s = 0, w = 0;
      for (let i = 0; i < Y.length; i++) if (Y[i][j] !== null) { s += Y[i][j] * X[i][f]; w += X[i][f]; }
      out.push(w ? s / w : 0);
    }
    for (let i = 0; i < Y.length; i++) if (Y[i][j] !== null) { all += Y[i][j]; n++; }
    out.push(n ? all / n : 0);
    return out;
  });
}

function standardiseCols(M) {
  const nc = M[0].length;
  const mu = [], sd = [];
  for (let c = 0; c < nc; c++) {
    const v = M.map((r) => r[c]);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const s = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
    mu.push(m); sd.push(s);
  }
  return M.map((r) => r.map((v, c) => (v - mu[c]) / sd[c]));
}

/* A tower: input → (optional hidden ReLU layer) → k numbers. */
function makeTower(nIn, hidden, k, rng) {
  const r = (n) => (rng() * 2 - 1) * Math.sqrt(6 / (n + k));
  const layer = (a, b) => ({ W: Array.from({ length: b }, () => Array.from({ length: a }, () => r(a))), c: new Array(b).fill(0) });
  return hidden ? [layer(nIn, hidden), layer(hidden, k)] : [layer(nIn, k)];
}

function forward(tower, x) {
  const acts = [x];
  tower.forEach((L, li) => {
    const z = L.W.map((w, o) => dot(w, acts[acts.length - 1]) + L.c[o]);
    acts.push(li < tower.length - 1 ? z.map((v) => Math.max(0, v)) : z);
  });
  return acts;
}

function backward(tower, acts, gOut, grads) {
  let g = gOut;
  for (let li = tower.length - 1; li >= 0; li--) {
    const L = tower[li], a = acts[li];
    const gPrev = new Array(a.length).fill(0);
    for (let o = 0; o < L.W.length; o++) {
      grads[li].c[o] += g[o];
      for (let q = 0; q < a.length; q++) { grads[li].W[o][q] += g[o] * a[q]; gPrev[q] += g[o] * L.W[o][q]; }
    }
    g = li > 0 ? gPrev.map((v, q) => (acts[li][q] > 0 ? v : 0)) : gPrev;
  }
}

const zeroGrads = (tower) => tower.map((L) => ({ W: L.W.map((r) => r.map(() => 0)), c: L.c.map(() => 0) }));

/* Trains both towers on the training ratings with Adam. Prediction = v_user · v_item + overall training average. */
export function trainTwoTower({ train, X, test = null, k = 4, hidden = 0, alpha = 0.01, lambda = 0.01, epochs = 300, seed = 1 }) {
  const rng = mulberry32(seed);
  const Xu = standardiseCols(userFeatures(train, X));
  const Xm = standardiseCols(X);
  const all = train.flat().filter((v) => v !== null);
  const g = all.reduce((a, b) => a + b, 0) / all.length;
  const U = makeTower(Xu[0].length, hidden, k, rng), M = makeTower(Xm[0].length, hidden, k, rng);
  const params = [U, M];
  const mom = params.map((t) => [zeroGrads(t), zeroGrads(t)]);
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  const pairs = [];
  train.forEach((r, i) => r.forEach((v, j) => { if (v !== null) pairs.push([i, j, v]); }));
  const history = [];
  const evalAll = () => {
    const vu = Xu.map((x) => forward(U, x).at(-1)), vm = Xm.map((x) => forward(M, x).at(-1));
    return { vu, vm, P: vm.map((m) => vu.map((u) => dot(u, m) + g)) };
  };
  const every = Math.max(1, Math.round(epochs / 150));
  for (let ep = 1; ep <= epochs; ep++) {
    const gU = zeroGrads(U), gM = zeroGrads(M);
    const fu = Xu.map((x) => forward(U, x)), fm = Xm.map((x) => forward(M, x));
    const dU = fu.map((a) => new Array(a.at(-1).length).fill(0)), dM = fm.map((a) => new Array(a.at(-1).length).fill(0));
    let J = 0;
    for (const [i, j, y] of pairs) {
      const vu = fu[j].at(-1), vm = fm[i].at(-1);
      const e = dot(vu, vm) + g - y;
      J += e * e / 2;
      for (let q = 0; q < k; q++) { dU[j][q] += e * vm[q]; dM[i][q] += e * vu[q]; }
    }
    // Loss per rating: J = (1/N) Σ ½e² + λ/2 Σ w² (the network weights).
    J /= pairs.length;
    fu.forEach((a, j) => backward(U, a, dU[j], gU));
    fm.forEach((a, i) => backward(M, a, dM[i], gM));
    [[U, gU], [M, gM]].forEach(([T, G], ti) => T.forEach((L, li) => {
      const [m1, m2] = mom[ti];
      L.W.forEach((row, o) => row.forEach((w, q) => {
        const gr = G[li].W[o][q] / pairs.length + lambda * w;
        J += (lambda / 2) * w * w;
        m1[li].W[o][q] = b1 * m1[li].W[o][q] + (1 - b1) * gr;
        m2[li].W[o][q] = b2 * m2[li].W[o][q] + (1 - b2) * gr * gr;
        row[q] -= alpha * (m1[li].W[o][q] / (1 - b1 ** ep)) / (Math.sqrt(m2[li].W[o][q] / (1 - b2 ** ep)) + eps);
      }));
      L.c.forEach((c, o) => {
        const gr = G[li].c[o] / pairs.length;
        m1[li].c[o] = b1 * m1[li].c[o] + (1 - b1) * gr;
        m2[li].c[o] = b2 * m2[li].c[o] + (1 - b2) * gr * gr;
        L.c[o] -= alpha * (m1[li].c[o] / (1 - b1 ** ep)) / (Math.sqrt(m2[li].c[o] / (1 - b2 ** ep)) + eps);
      });
    }));
    if (!Number.isFinite(J)) return { diverged: true, history };
    if (ep % every === 0 || ep === epochs || ep === 1) {
      const { P } = evalAll();
      history.push({ iter: ep, J, train: rmse(P, train), test: test ? rmse(P, test) : null });
    }
  }
  const { vu, vm, P } = evalAll();
  return { vu, vm, P, history, diverged: false, trainRMSE: rmse(P, train), testRMSE: test ? rmse(P, test) : null, mean: g };
}
