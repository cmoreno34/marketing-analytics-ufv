/* Live price rooms on a shared realtime database (Firebase Realtime Database).
 *
 * The same rooms the Cloudflare Worker ran (worker/src/room.ts), without a
 * server of our own: the lecturer's page and every phone read and write one
 * small tree per room, and the database keeps them in sync in real time.
 *
 * What a server did, done without one:
 *   - Forming groups. Each price step of the ladder has a counter. A phone takes
 *     the next seat with an atomic increment (a transaction on a few bytes), so
 *     50 phones arriving at the same step at the same moment get seats 0…49 and
 *     land in groups of 5 without ever colliding: seat s is in group ⌊s / 5⌋.
 *   - Answers. Each phone writes only its own answer, under its own anonymous
 *     id; the database rules forbid writing anyone else's.
 *   - Phases, waves, pause and finish. Only the lecturer's id may change the
 *     room's settings; every phone listens and follows.
 *   - A student who walks away mid-group leaves it one answer short. The
 *     lecturer's page closes such groups (two answers or more) once newer groups
 *     at the same step exist and nobody has answered for three minutes, and
 *     "Finish" closes the rest — as the Worker's seat timeout and finish did.
 *
 * The messages each page receives are the Worker's, so the pages did not change:
 * hello / offer / ok / finished / phase / open / rounds / wtp-ok / error for a
 * phone; state for the lecturer. `db` is a small adapter (firebaseAdapter.js in
 * the browser, test/memoryDb.js in the tests), so this file has no Firebase in it.
 *
 * Only ladder rooms (every room the pages create): each student climbs every
 * price of every situation, lowest first, once per wave.
 */
import { ruleGrid, clampBounds, wtpBounds, priorGroups, planNext, RULES } from "./priceRules.js";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LIFETIME_MS = 60 * 24 * 3600 * 1000;
const STALE_MS = 180 * 1000;
const MAX_CELLS = 60;
const MAX_WTP_COMBOS = 6;
const WAVE_IDLE_MS = 45 * 1000;

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const r2 = (v) => Math.round(v * 100) / 100;

export function leadingNumber(text) {
  const m = String(text ?? "").trim().match(/^[-+]?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : NaN;
}
export const comboKey = (levels) => levels.join("|");
export const combosOf = (cfg) => (cfg.situations ?? []).reduce((acc, x) => acc.flatMap((c) => x.levels.map((l) => [...c, l])), [[]]);

/* The lecturer's settings, checked as the Worker checked them. */
export function validateConfig(raw) {
  const base = Number(raw?.base), rangePct = Number(raw?.rangePct);
  const levels = Math.round(Number(raw?.levels)), groupSize = Math.round(Number(raw?.groupSize));
  if (!str(raw?.product, 80)) return "Give the product a name.";
  if (!(base > 0 && base < 1e7)) return "The base price must be a positive number.";
  if (!(rangePct >= 5 && rangePct <= 90)) return "The variation must be between 5% and 90%.";
  if (!(levels >= 3 && levels <= 15)) return "Use between 3 and 15 prices.";
  if (!(groupSize >= 2 && groupSize <= 20)) return "Groups must have between 2 and 20 students.";
  const situations = [];
  const list = Array.isArray(raw?.situations) ? raw.situations : raw?.situation ? [raw.situation] : [];
  for (const x of list.slice(0, 3)) {
    const name = str(x?.name, 30).replace(/[^\p{L}\p{N}_-]/gu, "_");
    if (!name || situations.some((y) => y.name === name)) continue;
    const lv = [...new Set((Array.isArray(x.levels) ? x.levels : String(x.levels ?? "").split(",")).map((l) => str(l, 50)).filter(Boolean))].slice(0, 6);
    if (lv.length < 2) continue;
    const numeric = x.numeric === true;
    if (numeric && lv.some((l) => !Number.isFinite(leadingNumber(l))))
      return `Every level of the numeric situation “${name}” must start with a number (for example 15 °C, 25 °C).`;
    situations.push({ name, question: str(x.question, 200), levels: lv, ...(numeric ? { numeric } : {}) });
  }
  const combos = situations.reduce((n, x) => n * x.levels.length, 1);
  const cells = combos * levels;
  if (cells > MAX_CELLS) return `${cells} combinations of price and situation is too many for a class (at most ${MAX_CELLS}): use fewer prices or fewer levels.`;
  const mode = raw?.mode === "wtp" ? "wtp" : "price";
  const cost = Number(raw?.cost) >= 0 && Number(raw?.cost) < 1e7 ? r2(Number(raw.cost)) : 0;
  let wtpScale;
  if (mode === "wtp") {
    wtpScale = (Array.isArray(raw?.wtpScale) ? raw.wtpScale : []).map(Number).filter((v) => v > 0 && v < 1e7).map(r2);
    if (wtpScale.length < 3 || wtpScale.length > 40 || wtpScale.some((v, i) => i && v <= wtpScale[i - 1]))
      return "The willingness-to-pay scale needs between 3 and 40 increasing prices.";
    if (combos > MAX_WTP_COMBOS) return `Each student would have to give ${combos} maximum prices; use at most ${MAX_WTP_COMBOS} combinations of situations.`;
  }
  // The grid follows the rules of priceRules.js: the variation asked for is a
  // starting point, held within ±20–50%, steps a buyer notices, above cost.
  const maxLevels = Math.max(RULES.minLevels, Math.min(RULES.maxLevels, Math.floor(MAX_CELLS / combos)));
  const autoWaves = Math.min(5, Math.max(1, Math.round(Number(raw?.autoWaves)) || 3));
  return {
    product: str(raw.product, 80), description: str(raw?.description, 500), currency: str(raw?.currency, 4) || "€",
    base, rangePct, levels, groupSize, situations, situation: situations[0] ?? null,
    rounds: cells, grid: gridFor(base, rangePct, levels, cost, maxLevels), maxLevels, autoWaves, auto: raw?.auto !== false,
    mode, cost, order: "ladder", ...(wtpScale ? { wtpScale } : {}),
  };
}

const gridFor = (centre, rangePct, levels, cost, maxLevels, b) => {
  const bounds = b ?? { lo: centre * (1 - rangePct / 100), hi: centre * (1 + rangePct / 100) };
  return ruleGrid({ centre, ...clampBounds(centre, bounds.lo, bounds.hi), levels, cost, maxLevels });
};

/* The ladder of a wave: situations in the order written, prices lowest first. */
export function ladderOf(cfg) {
  const out = [];
  combosOf(cfg).forEach((c, ci) => {
    for (const p of [...(cfg.grids?.[comboKey(c)] ?? cfg.grid)].sort((a, b) => a - b)) out.push({ price: p, ci, levels: c });
  });
  return out.map((x, cell) => ({ ...x, cell }));
}

/* The seed: synthetic groups at every price of the grid that has none yet.
 * Two-phase rooms play each student's phase-1 WTP at the price, in teams of
 * the group size (yes where the stated maximum reaches it); one-phase rooms
 * draw a small prior through the starting price (priceRules.js), in the first
 * wave only — it steers until the real answers are enough. `have` holds
 * the "ci|price" already seeded, so a new wave only seeds its new prices. */
function seedGroups(cfg, wtp, wave, now, have = new Set()) {
  const size = cfg.groupSize, out = {};
  let n = 0;
  combosOf(cfg).forEach((c, ci) => {
    const prices = (cfg.grids?.[comboKey(c)] ?? cfg.grid).filter((p) => !have.has(`${ci}|${p}`));
    if (!prices.length) return;
    if (cfg.mode === "wtp") {
      const ids = Object.keys(wtp ?? {}).filter((u) => Number.isFinite(wtp[u]?.[ci]));
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      const teams = [];
      for (let i = 0; i < ids.length; i += size) teams.push(ids.slice(i, i + size));
      if (teams.length > 1 && teams[teams.length - 1].length < 2) teams[teams.length - 2].push(...(teams.pop() ?? []));
      for (const p of prices) for (const t of teams) {
        out[`w${wave}s${n++}`] = { price: p, ci, wave, t: now + n,
          answers: JSON.stringify(Object.fromEntries(t.map((u) => [`stated-${u.slice(-6)}`, wtp[u][ci] >= p ? 1 : 0]))) };
      }
    } else if (wave === 1) {
      // The prior is only a start: later waves rest on the real answers.
      for (const g of priorGroups({ grid: prices, centre: cfg.base, cost: cfg.cost, size })) {
        out[`w${wave}s${n++}`] = { price: g.price, ci, wave, t: now + n, prior: true,
          answers: JSON.stringify(Object.fromEntries(g.answers.map((a, i) => [`prior-${i + 1}`, a]))) };
      }
    }
  });
  return out;
}

const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

/* ── Reading a room ──
 * Everything a page shows, built from the room's tree. Group numbers are given
 * in the order groups were created (phase-1 base first), so they are stable. */
export function viewOf(room, withAnswers = false) {
  const meta = room.meta;
  const cfg = parse(meta.cfg, null);
  const combos = combosOf(cfg);
  const levelsFor = (ci) => combos[ci] ?? [];
  const size = cfg.groupSize;
  const closedBy = room.closedBy ?? {};
  const groups = [];
  for (const [gid, g] of Object.entries(room.stated ?? {})) {
    const answers = parse(g.answers, {});
    const vals = Object.values(answers);
    groups.push({ gid, t: g.t ?? 0, price: g.price, ci: g.ci, wave: g.wave ?? 1, synthetic: true, ...(g.prior ? { prior: true } : {}), answers,
      n: vals.length, yes: vals.reduce((a, b) => a + b, 0), closed: true, closedAt: g.t ?? 0 });
  }
  for (const [gid, g] of Object.entries(room.groups ?? {})) {
    const ans = room.ans?.[gid] ?? {};
    const answers = Object.fromEntries(Object.entries(ans).map(([u, a]) => [u, a.b]));
    const times = Object.values(ans).map((a) => a.t ?? 0);
    const n = Object.keys(answers).length;
    if (!n) continue;
    const closed = n >= size || (closedBy[gid] === true && n >= 2);
    groups.push({ gid, t: g.t ?? 0, price: g.price, ci: g.ci, wave: g.wave ?? 1, cell: g.cell, k: g.k, answers,
      n, yes: Object.values(answers).reduce((a, b) => a + b, 0), closed, closedAt: closed ? Math.max(...times) : null, last: Math.max(...times) });
  }
  groups.sort((a, b) => (a.synthetic === b.synthetic ? 0 : a.synthetic ? -1 : 1) || a.t - b.t || (a.gid < b.gid ? -1 : 1));
  const views = groups.map((g, i) => {
    const lv = levelsFor(g.ci);
    return { id: i + 1, gid: g.gid, price: g.price, level: lv.length ? lv.join(" · ") : null, levels: lv, wave: g.wave, n: g.n, yes: g.yes,
      closed: g.closed, closedAt: g.closedAt, ...(g.synthetic ? { synthetic: true } : {}), ...(g.prior ? { prior: true } : {}), ...(withAnswers ? { answers: g.answers } : {}),
      _cell: g.cell, _k: g.k, _last: g.last };
  });
  const real = views.filter((g) => !g.synthetic);
  const wtpLists = {};
  for (const a of Object.values(room.wtp ?? {})) {
    const ans = parse(a, {});
    for (const [ci, v] of Object.entries(ans)) (wtpLists[comboKey(levelsFor(Number(ci)))] ??= []).push(v);
  }
  const answersCount = real.reduce((a, g) => a + g.n, 0);
  return {
    cfg, open: meta.open !== false, phase: meta.phase ?? "prices", created: meta.created, expires: (meta.created ?? 0) + LIFETIME_MS,
    connected: Object.keys(room.presence ?? {}).length, students: Object.keys(room.students ?? {}).length,
    answers: answersCount, closedGroups: real.filter((g) => g.closed).length, openGroups: real.filter((g) => !g.closed).length,
    statedGroups: views.length - real.length, wtpAnswers: Object.keys(room.wtp ?? {}).length, wtp: wtpLists,
    groups: views.map(({ _cell, _k, _last, ...g }) => g),
    _internal: views,
  };
}

/* ── Creating a room ── */
export async function createRoom(db, config) {
  const cfg = validateConfig(config);
  if (typeof cfg === "string") throw new Error(cfg);
  for (let i = 0; i < 8; i++) {
    const code = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
    const meta = { cfg: JSON.stringify(cfg), hostUid: db.uid, open: true, phase: cfg.mode === "wtp" ? "wtp" : "prices", created: db.now() };
    const res = await db.txn(`rooms/${code}/meta`, (cur) => (cur ? undefined : meta));
    if (!res.committed) continue;
    if (cfg.mode !== "wtp") await db.set(`rooms/${code}/stated`, seedGroups(cfg, null, 1, db.now()));
    return { code, hostKey: db.uid, config: cfg };
  }
  throw new Error("Could not allocate a room code. Try again.");
}

export async function readRoom(db, code) {
  const room = await db.get(`rooms/${code}`);
  if (!room?.meta) throw new Error("There is no room with that code. Check it with your lecturer.");
  return room;
}

/* ── A phone ── */
export function studentSession(db, code, emit) {
  const base = `rooms/${code}`;
  let room = null, cfg = null, me = { done: {}, current: null, wtp: null }, stopped = false, busy = false;
  const ladder = () => ladderOf(cfg);
  const wave = () => cfg.wave ?? 1;
  const doneThisWave = () => new Set(Object.keys(me.done[`w${wave()}`] ?? {}).map(Number));

  async function start() {
    const meta = await db.get(`${base}/meta`);
    if (!meta) { emit({ t: "refused", error: "There is no room with that code." }); return; }
    const mine = (await db.get(`${base}/students/${db.uid}`)) ?? {};
    me = { done: mine.done ?? {}, current: mine.current ?? null, wtp: parse(await db.get(`${base}/wtp/${db.uid}`), null) };
    await db.update(`${base}/students/${db.uid}`, { j: db.now() });
    db.presence(`${base}/presence/${db.uid}`);
    room = { meta };
    cfg = parse(meta.cfg, null);
    emit({ t: "hello", cfg, open: meta.open !== false, phase: meta.phase ?? "prices", me: viewWith(meta) });
    let last = meta;
    const off = db.listen(`${base}/meta`, (m) => {
      if (!m || stopped) return;
      const prev = last; last = m; room.meta = m;
      cfg = parse(m.cfg, cfg);
      if ((prev.open !== false) !== (m.open !== false)) emit({ t: "open", open: m.open !== false, expires: (m.created ?? 0) + LIFETIME_MS });
      if (prev.phase !== m.phase) emit({ t: "phase", phase: m.phase, cfg });
      else if (parse(prev.cfg, {}).wave !== cfg.wave) emit({ t: "rounds", rounds: cfg.rounds, me: viewWith(m) });
    });
    return off;
  }
  const viewWith = (meta) => ({ done: (meta.phase ?? "prices") === "prices" ? doneThisWave().size : 0, rounds: ladder().length, wtp: me.wtp });

  async function next() {
    if (!room.meta || room.meta.open === false) return emit({ t: "closed" });
    if (room.meta.phase === "wtp") return emit({ t: "phase", phase: "wtp", cfg });
    const L = ladder();
    if (me.current) {
      const g = await db.get(`${base}/groups/${me.current}`);
      const closedBy = await db.get(`${base}/closedBy/${me.current}`);
      const mineAns = await db.get(`${base}/ans/${me.current}/${db.uid}`);
      if (g && !closedBy && !mineAns && (g.wave ?? 1) === wave()) return emit(offerOf(g, me.current, L));
      me.current = null;
    }
    const done = doneThisWave();
    const step = L.find((c) => !done.has(c.cell));
    if (!step) return emit({ t: "finished", me: viewWith(room.meta) });
    const seat = await db.txn(`${base}/seq/w${wave()}/c${step.cell}`, (n) => (n ?? 0) + 1);
    if (!seat.committed) return emit({ t: "wait" });
    const s = seat.value - 1, k = Math.floor(s / cfg.groupSize);
    const gid = `w${wave()}c${step.cell}k${k}`;
    const g = { price: step.price, ci: step.ci, wave: wave(), cell: step.cell, k, t: db.now() };
    if (s % cfg.groupSize === 0) await db.set(`${base}/groups/${gid}`, g);
    else if (!(await db.get(`${base}/groups/${gid}`))) await db.set(`${base}/groups/${gid}`, g);
    me.current = gid;
    await db.update(`${base}/students/${db.uid}`, { current: gid });
    emit(offerOf(g, gid, L));
  }
  const offerOf = (g, gid, L) => {
    const levels = combosOf(cfg)[g.ci] ?? [];
    return { t: "offer", group: gid, label: `${g.cell + 1}·${g.k + 1}`, price: g.price, level: levels.length ? levels.join(" · ") : null, levels,
      wave: g.wave ?? 1, round: doneThisWave().size + 1, of: L.length };
  };

  async function answer(gid, buy) {
    const g = await db.get(`${base}/groups/${gid}`);
    if (!g || me.current !== gid) { me.current = null; return emit({ t: "error", error: "That offer has expired. Here is a new one." }); }
    const w = `w${g.wave ?? 1}`;
    await db.update(base, {
      [`ans/${gid}/${db.uid}`]: { b: buy ? 1 : 0, t: db.now() },
      [`students/${db.uid}/done/${w}/${g.cell}`]: true,
      [`students/${db.uid}/current`]: null,
    });
    (me.done[w] ??= {})[g.cell] = true;
    me.current = null;
    emit({ t: "ok", me: viewWith(room.meta) });
  }

  async function wtp(answers) {
    if (room.meta.phase !== "wtp") return emit({ t: "phase", phase: room.meta.phase, cfg });
    const scale = cfg.wtpScale ?? [];
    const ans = {};
    for (const [ci, c] of combosOf(cfg).entries()) {
      const v = Number(answers?.[comboKey(c)]);
      if (!(v >= scale[0] && v <= scale[scale.length - 1])) return emit({ t: "error", error: "Give a maximum price for every situation." });
      ans[ci] = r2(v);
    }
    await db.set(`${base}/wtp/${db.uid}`, JSON.stringify(ans));
    me.wtp = Object.fromEntries(combosOf(cfg).map((c, ci) => [comboKey(c), ans[ci]]));
    emit({ t: "wtp-ok", me: viewWith(room.meta) });
  }

  // One message at a time: a phone that taps twice does not take two seats.
  const queue = [];
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const m = queue.shift();
      try {
        if (m.t === "next") await next();
        else if (m.t === "answer") await answer(m.group, m.buy);
        else if (m.t === "wtp") await wtp(m.answers);
      } catch (e) { emit({ t: "error", error: e.message || "Could not reach the room. Trying again." }); }
    }
    busy = false;
  }
  let unlisten = null;
  const ready = start().then((off) => { unlisten = off; });
  return {
    ready,
    send: (m) => { queue.push(m); ready.then(pump); return true; },
    close: () => { stopped = true; unlisten?.(); },
  };
}

/* ── The lecturer's screen ── */
export function hostSession(db, code, emit, { throttleMs = 400, idleMs = WAVE_IDLE_MS } = {}) {
  const base = `rooms/${code}`;
  let room = null, timer = null, stopped = false, tick = null;
  const push = () => {
    if (timer || stopped) return;
    timer = setTimeout(() => { timer = null; if (room?.meta) emit({ t: "state", ...stripInternal(viewOf(room)) }); }, throttleMs);
  };
  const stripInternal = ({ _internal, ...v }) => v;
  const ready = (async () => {
    const meta = await db.get(`${base}/meta`);
    if (!meta) { emit({ t: "refused", error: "There is no room with that code." }); return; }
    if (meta.hostUid !== db.uid) { emit({ t: "refused", error: "Only the lecturer who created the room can open it as host (same browser)." }); return; }
    const off = db.listen(base, (r) => { room = r; push(); maybeAdvance().catch((e) => emit({ error: e.message })); });
    // Groups left one answer short by a student who walked away; waves gone idle.
    tick = setInterval(() => { closeStale().catch(() => {}); maybeAdvance().catch(() => {}); }, Math.min(20000, idleMs / 2));
    tick.unref?.();                                     // never keeps a test process alive
    return off;
  })();

  async function closeStale() {
    if (!room?.meta) return;
    const v = viewOf(room)._internal.filter((g) => !g.synthetic);
    const now = db.now(), upd = {};
    for (const g of v) {
      if (g.closed || g.n < 2 || now - (g._last ?? now) < STALE_MS) continue;
      if (v.some((h) => h.wave === g.wave && h._cell === g._cell && h._k > g._k)) upd[`closedBy/${g.gid}`] = true;
    }
    if (Object.keys(upd).length) await db.update(base, upd);
  }

  /* A new wave: its centres and grids, and the reason for each, kept in the
   * price path. `plans` maps each situation to { centre, grid, reason }. */
  function nextCfg(cfg, plans, from) {
    const path = [...(cfg.path ?? (Array.isArray(cfg.waves) ? cfg.waves : []))];
    const wave = from === "wtp" ? 1 : (cfg.wave ?? 1) + 1;
    if (from !== "wtp" && !path.length)
      path.push({ wave: 1, centres: cfg.centres ?? Object.fromEntries(combosOf(cfg).map((c) => [comboKey(c), cfg.base])), at: room.meta.created, from: cfg.mode === "wtp" ? "wtp" : "lecturer" });
    const centres = Object.fromEntries(Object.entries(plans).map(([k, p]) => [k, p.centre]));
    path.push({ wave, centres, at: db.now(), from, reasons: Object.fromEntries(Object.entries(plans).map(([k, p]) => [k, p.reason ?? ""])) });
    return { ...cfg, centres, grids: Object.fromEntries(Object.entries(plans).map(([k, p]) => [k, p.grid])), wave, path };
  }
  const readCentres = (cfg, given) => {
    const out = {};
    for (const c of combosOf(cfg)) {
      const v = Number(given?.[comboKey(c)]);
      if (!(v > 0 && v < 1e7)) throw new Error(`No price for “${comboKey(c) || "the product"}”.`);
      out[comboKey(c)] = r2(v);
    }
    return out;
  };
  const wtpOf = () => Object.fromEntries(Object.entries(room.wtp ?? {}).map(([u, a]) => [u, parse(a, {})]));
  const seeded = () => new Set(Object.values(room.stated ?? {}).map((g) => `${g.ci}|${g.price}`));
  const maxL = (cfg) => cfg.maxLevels ?? RULES.maxLevels;

  /* Phase 2 from the WTP optimum: each grid's ends where about 90% and 10% of
   * the class said they would still buy (rule 3), within the other rules. */
  function plansFromWtp(cfg, centres) {
    const wtp = wtpOf(), plans = {};
    combosOf(cfg).forEach((c, ci) => {
      const k = comboKey(c), centre = centres[k];
      const vals = Object.values(wtp).map((a) => a[ci]).filter(Number.isFinite);
      const b = vals.length >= 3 ? wtpBounds(vals) : null;
      plans[k] = { centre, grid: gridFor(centre, cfg.rangePct, cfg.levels, cfg.cost, maxL(cfg), b),
        reason: b ? "WTP optimum; the ends where about 90% and 10% of the class said they would buy" : "WTP optimum" };
    });
    return plans;
  }

  /* The next wave, decided by the rules from every closed group so far. */
  function plansFromAnswers(cfg) {
    const v = viewOf(room)._internal.filter((g) => g.closed && g.n > 0);
    const plans = {};
    for (const c of combosOf(cfg)) {
      const k = comboKey(c);
      const mine = v.filter((g) => comboKey(g.levels) === k);
      // A prior seed only steers until there are ten real groups; the class's
      // own phase-1 WTP stays in, as it is their answers.
      const enoughReal = mine.filter((g) => !g.synthetic).length >= 10;
      const rows = mine.filter((g) => !(g.prior && enoughReal))
        .map((g) => ({ price: g.price, share: (g.yes || 0.5) / g.n, wave: g.wave ?? 1, synthetic: !!g.synthetic }));
      const grid = cfg.grids?.[k] ?? cfg.grid, centre = cfg.centres?.[k] ?? cfg.base;
      plans[k] = planNext({ rows, centre, grid, cost: cfg.cost, wave: cfg.wave ?? 1, levels: cfg.levels, maxLevels: maxL(cfg) });
    }
    return plans;
  }

  /* The short groups of a wave that is over count, as "finish" counts them. */
  function closeShort(wave) {
    const upd = {};
    for (const g of viewOf(room)._internal) if (!g.synthetic && !g.closed && g.n >= 2 && g.wave === wave) upd[`closedBy/${g.gid}`] = true;
    return upd;
  }

  async function startWave(plans, from) {
    const cfg = parse(room.meta.cfg, null);
    const next = nextCfg(cfg, plans, from);
    const upd = { ...closeShort(cfg.wave ?? 1), "meta/cfg": JSON.stringify(next) };
    for (const [id, g] of Object.entries(seedGroups(next, wtpOf(), next.wave, db.now(), seeded()))) upd[`stated/${id}`] = g;
    await db.update(base, upd);
  }

  /* Automatic waves: once the class has climbed the whole ladder — everyone
   * who started this wave has finished and every price has three closed
   * groups, or 80% have finished and nobody has answered for 45 seconds (a
   * small class) — the room moves to the next wave on its own, up to the
   * number of waves set for the room. */
  let advancing = false;
  async function maybeAdvance() {
    if (advancing || !room?.meta || room.meta.phase !== "prices" || room.meta.open === false) return;
    const cfg = parse(room.meta.cfg, null);
    const wave = cfg.wave ?? 1;
    if (cfg.auto === false || wave >= (cfg.autoWaves ?? 1)) return;
    const L = ladderOf(cfg).length, w = `w${wave}`;
    const counts = Object.values(room.students ?? {}).map((st) => Object.keys(st.done?.[w] ?? {}).length).filter((n) => n > 0);
    const started = counts.length, finished = counts.filter((n) => n >= L).length;
    if (started < 2 || finished === 0) return;
    const mine = viewOf(room)._internal.filter((g) => !g.synthetic && g.wave === wave);
    const last = Math.max(0, ...mine.map((g) => g._last ?? 0));
    const idle = db.now() - last >= idleMs;
    // Enough points: every price of the ladder has its groups closed this wave.
    const closedAt = (cell) => mine.filter((g) => g.closed && g._cell === cell).length;
    const enough = ladderOf(cfg).every((c) => closedAt(c.cell) >= RULES.minGroupsPerPrice);
    if (!((enough && finished === started) || (finished >= 0.8 * started && idle))) return;
    advancing = true;
    try { await startWave(plansFromAnswers(cfg), "rules"); } finally { advancing = false; }
  }

  async function handle(m) {
    if (!room?.meta) return;
    const cfg = parse(room.meta.cfg, null);
    if (m.t === "open" || m.t === "close") await db.update(`${base}/meta`, { open: m.t === "open" });
    else if (m.t === "start-prices" && room.meta.phase === "wtp") {
      const next = nextCfg(cfg, plansFromWtp(cfg, readCentres(cfg, m.centres)), "wtp");
      await db.update(base, { stated: seedGroups(next, wtpOf(), 1, db.now()), "meta/cfg": JSON.stringify(next), "meta/phase": "prices" });
    } else if (m.t === "recentre" && room.meta.phase === "prices") {
      // Centres given by hand; the grids still follow the rules.
      const centres = readCentres(cfg, m.centres);
      await startWave(Object.fromEntries(Object.entries(centres).map(([k, c]) => [k,
        { centre: c, grid: gridFor(c, cfg.rangePct, cfg.levels, cfg.cost, maxL(cfg)), reason: "set by the lecturer" }])), "lecturer");
    } else if (m.t === "next-wave" && room.meta.phase === "prices") {
      await startWave(plansFromAnswers(cfg), "rules");
    } else if (m.t === "finish") {
      const upd = { "meta/open": false };
      for (const g of viewOf(room)._internal) if (!g.synthetic && !g.closed && g.n >= 2) upd[`closedBy/${g.gid}`] = true;
      await db.update(base, upd);
    }
  }
  let unlisten = null;
  ready.then((off) => { unlisten = off; });
  return {
    ready,
    send: (m) => { ready.then(() => handle(m)).catch((e) => emit({ error: e.message })); return true; },
    close: () => { stopped = true; clearInterval(tick); clearTimeout(timer); unlisten?.(); },
  };
}
