/* Two towers by hand — workbook D4 v1.1, sheets "two towers by hand" and
 * "two towers simulation".
 *
 * Matrix factorisation (B4) with one linear layer on top of each side:
 *
 *   user tower   u(j) = V·w(j)          w(j) ∈ R² learned per user (as B4)
 *   item tower   m(i) = Q·x(i)          x(i) ∈ R² learned per movie (as B4)
 *   prediction   ŷ(i,j) = u(j)·m(i) + b(j)
 *
 * Cost J = ½ Σ_{r(i,j)=1} (ŷ − y)²;  J+reg = J + λ/2 (Σw² + Σx² + ΣV² + ΣQ²),
 * b not regularised. Backpropagation in two steps: first the gradient with
 * respect to the tower outputs u and m, then the chain rule down to V, w, Q
 * and x. All 30 parameters are updated at once from the same errors.
 *
 * With V = Q = identity the model is exactly B4 (ITER0 J = 14.6).
 *
 * Layout as everywhere in the recommender code: Y[i][j] (rows = movies,
 * columns = users, null = not rated), W[j] = w(j), X[i] = x(i), V[k][l], Q[k][l]. */

import { TOY } from "./recommender.js";

export const TT = {
  users: ["alice", "bob", "carol", "dave"],
  items: TOY.items,
  Y: TOY.Y,
  start: { b: TOY.B4.b, W: TOY.B4.W, X: TOY.B4.X, V: [[1, 0], [0, 1]], Q: [[1, 0], [0, 1]] },
  alpha: 0.005,
  lambda: 0.1,
};

const rated = (v) => v !== null && v !== undefined;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const sq = (M) => sum(M.map((r) => sum(r.map((v) => v * v))));
const mv = (A, x) => A.map((row) => row[0] * x[0] + row[1] * x[1]);   // A·x for 2×2
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm = (a) => Math.sqrt(dot(a, a));
const copy = (p) => ({ b: [...p.b], W: p.W.map((r) => [...r]), X: p.X.map((r) => [...r]), V: p.V.map((r) => [...r]), Q: p.Q.map((r) => [...r]) });

/* Forward pass and cost. E[i][j] = ŷ − y on rated cells, null elsewhere. */
export function forwardTT(p, Y = TT.Y, lambda = TT.lambda) {
  const U = p.W.map((w) => mv(p.V, w));
  const M = p.X.map((x) => mv(p.Q, x));
  const P = M.map((m) => U.map((u, j) => dot(u, m) + p.b[j]));
  const E = Y.map((row, i) => row.map((y, j) => (rated(y) ? P[i][j] - y : null)));
  const S2 = E.map((row) => row.map((e) => (e === null ? null : e * e)));
  const J = 0.5 * sum(S2.flat().filter((v) => v !== null));
  const reg = (lambda / 2) * (sq(p.W) + sq(p.X) + sq(p.V) + sq(p.Q));
  return { U, M, P, E, S2, J, reg, Jreg: J + reg };
}

/* Backpropagation. Step 1: ∂J/∂u(j), ∂J/∂m(i) and the products behind them
 * (the workbook's "dif·m" and "dif·u" tables). Step 2: chain rule to the
 * parameters, plus λ·θ for the regularised ones. */
export function backwardTT(p, f, lambda = TT.lambda) {
  const nm = f.E.length, nu = p.b.length;
  const e = (i, j) => f.E[i][j] ?? 0;
  // difM[k][i][j] = e_ij · m_k(i);  difU[k][i][j] = e_ij · u_k(j)  (null where not rated)
  const difM = [0, 1].map((k) => f.E.map((row, i) => row.map((v) => (v === null ? null : v * f.M[i][k]))));
  const difU = [0, 1].map((k) => f.E.map((row) => row.map((v, j) => (v === null ? null : v * f.U[j][k]))));
  const dU = Array.from({ length: nu }, (_, j) => [0, 1].map((k) => sum(f.M.map((m, i) => e(i, j) * m[k]))));
  const dM = Array.from({ length: nm }, (_, i) => [0, 1].map((k) => sum(f.U.map((u, j) => e(i, j) * u[k]))));
  const db = Array.from({ length: nu }, (_, j) => sum(f.E.map((_, i) => e(i, j))));
  const dV = [0, 1].map((k) => [0, 1].map((l) => sum(p.W.map((w, j) => dU[j][k] * w[l])) + lambda * p.V[k][l]));
  const dW = p.W.map((w, j) => [0, 1].map((l) => dU[j][0] * p.V[0][l] + dU[j][1] * p.V[1][l] + lambda * w[l]));
  const dQ = [0, 1].map((k) => [0, 1].map((l) => sum(p.X.map((x, i) => dM[i][k] * x[l])) + lambda * p.Q[k][l]));
  const dX = p.X.map((x, i) => [0, 1].map((l) => dM[i][0] * p.Q[0][l] + dM[i][1] * p.Q[1][l] + lambda * x[l]));
  return { difM, difU, dU, dM, db, dV, dW, dQ, dX };
}

/* θ := θ − α ∂J/∂θ, all at once. */
export function updateTT(p, g, alpha) {
  const n = copy(p);
  n.b = p.b.map((v, j) => v - alpha * g.db[j]);
  n.W = p.W.map((w, j) => w.map((v, l) => v - alpha * g.dW[j][l]));
  n.X = p.X.map((x, i) => x.map((v, l) => v - alpha * g.dX[i][l]));
  n.V = p.V.map((r, k) => r.map((v, l) => v - alpha * g.dV[k][l]));
  n.Q = p.Q.map((r, k) => r.map((v, l) => v - alpha * g.dQ[k][l]));
  return n;
}

/* One full iteration, everything the hand sheet shows for one block. */
export function iterateTT(p, { alpha = TT.alpha, lambda = TT.lambda, Y = TT.Y } = {}) {
  const f = forwardTT(p, Y, lambda);
  const g = backwardTT(p, f, lambda);
  return { p, f, g, next: updateTT(p, g, alpha) };
}

const finite = (p) => [p.b, ...p.W, ...p.X, ...p.V, ...p.Q].flat().every(Number.isFinite);

/* `iters` updates from `start`. params[t] = the parameters after t updates
 * (the workbook's ITER t block, the simulation sheet's row 28 + t);
 * history[t] = { iter, J, Jreg } of params[t]. Stops if anything overflows. */
export function runTT({ start = TT.start, alpha = TT.alpha, lambda = TT.lambda, iters = 300, Y = TT.Y } = {}) {
  const params = [copy(start)], history = [];
  let diverged = false;
  for (let t = 0; t <= iters; t++) {
    const p = params[t];
    const f = forwardTT(p, Y, lambda);
    if (!Number.isFinite(f.Jreg) || f.Jreg > 1e12) { diverged = true; history.push({ iter: t, J: NaN, Jreg: NaN }); break; }
    history.push({ iter: t, J: f.J, Jreg: f.Jreg });
    if (t === iters) break;
    const next = updateTT(p, backwardTT(p, f, lambda), alpha);
    if (!finite(next)) { diverged = true; break; }
    params.push(next);
  }
  return { params, history, diverged };
}

/* Vector retrieval with trained towers: index m(i), query u(j), score u·m
 * (b left out: it is the same for every movie of one user), rank among the
 * movies the user has not rated, the top-1 and its predicted rating (score + b),
 * and the cosine (the same ranking if the vectors are normalised). */
export function retrievalTT(p, Y = TT.Y) {
  const U = p.W.map((w) => mv(p.V, w));
  const M = p.X.map((x) => mv(p.Q, x));
  const normU = U.map(norm), normM = M.map(norm);
  const S = M.map((m) => U.map((u) => dot(u, m)));
  const cos = S.map((row, i) => row.map((s, j) => s / (normM[i] * normU[j])));
  const rank = S.map((row, i) => row.map((s, j) => {
    if (rated(Y[i][j])) return "seen";
    return 1 + Y.reduce((c, r, k) => c + (!rated(r[j]) && S[k][j] > s ? 1 : 0), 0);
  }));
  const top = U.map((_, j) => {
    const i = rank.findIndex((r) => r[j] === 1);
    return i < 0 ? null : { i, score: S[i][j], pred: S[i][j] + p.b[j] };
  });
  return { U, M, normU, normM, S, cos, rank, top };
}
