/* Live class price sessions over ntfy.sh — no server of our own.
 *
 * Same approach as projective-live: ntfy.sh is a public publish/subscribe
 * service that needs no account and keeps a topic's messages for about
 * twelve hours. A session is a topic; the lecturer's page publishes the
 * session settings to it, each student publishes their answers to it, and
 * any page can read the whole topic back. Everything stays on GitHub Pages.
 *
 * Consequences worth knowing:
 *   - Topics are public to anyone who knows the name. Answers are anonymous
 *     (a random respondent id, a price, yes/no, the categories) — nothing
 *     personal is ever sent. The code is random enough not to be guessed.
 *   - ntfy rate-limits per IP and a class shares one university IP, so each
 *     student sends ONE message with all their answers, not one per click,
 *     and publishing backs off and retries on 429.
 *   - After ~12 h ntfy forgets the topic. The lecturer's page keeps a copy of
 *     every answer it has seen in this browser, and the lab offers the CSV.
 */

const NTFY = "https://ntfy.sh/";
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const topicOf = (code) => `mkt-ufv-price-${String(code).trim().toUpperCase()}`;
const r2dp = (v) => Math.round(v * 100) / 100;

export const isCode = (c) => /^[A-Z0-9]{6}$/.test(String(c).trim().toUpperCase());

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/* What the lecturer typed, cleaned and turned into a price grid. Returns a
 * string when something is wrong. */
export function makeConfig(raw) {
  const str = (v, max) => String(v ?? "").trim().slice(0, max);
  const start = Number(raw?.start), rangePct = Number(raw?.rangePct);
  const levels = Math.round(Number(raw?.levels)), offersEach = Math.round(Number(raw?.offersEach));
  if (!str(raw?.product, 80)) return "Give the product a name.";
  if (!(start > 0)) return "The starting price must be a positive number.";
  if (!(rangePct >= 2 && rangePct <= 90)) return "The price range must be between 2% and 90%.";
  if (!(levels >= 3 && levels <= 15)) return "Use between 3 and 15 price levels.";
  if (!(offersEach >= 1 && offersEach <= 20)) return "Each student can see between 1 and 20 offers.";
  const factors = (raw.factors ?? []).slice(0, 3).map((f) => ({
    name: str(f.name, 30).replace(/[^\p{L}\p{N}_-]/gu, "_"),
    kind: f.kind === "profile" ? "profile" : "scenario",
    question: str(f.question, 200),
    levels: [...new Set((Array.isArray(f.levels) ? f.levels : String(f.levels ?? "").split(","))
      .map((l) => str(l, 40)).filter(Boolean))].slice(0, 8),
  })).filter((f) => f.name && f.levels.length >= 2);
  const lo = start * (1 - rangePct / 100), hi = start * (1 + rangePct / 100);
  return {
    product: str(raw.product, 80), description: str(raw.description, 500), currency: str(raw.currency, 4) || "€",
    start, rangePct, levels, offersEach, factors,
    grid: Array.from({ length: levels }, (_, i) => r2dp(lo + ((hi - lo) * i) / (levels - 1))),
  };
}

/* The settings also travel in the join link, so a student's phone never has
 * to wait for the topic to answer before showing the first offer. */
export const encodeConfig = (cfg) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cfg)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function decodeConfig(s) {
  try {
    const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))));
  } catch { return null; }
}

/* Publish with back-off: a class answering at once can hit ntfy's per-IP
 * limit, and a retry a few seconds later is all it takes. */
export async function publish(code, obj, { tries = 8 } = {}) {
  const body = JSON.stringify(obj);
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(NTFY + topicOf(code), { method: "POST", body });
      if (r.ok) return true;
      if (r.status !== 429) throw new Error(`ntfy answered ${r.status}`);
    } catch (e) {
      if (i === tries - 1) throw new Error(`Could not send: ${e.message}. Check the connection and try again.`);
    }
    await new Promise((res) => setTimeout(res, 2500 + Math.random() * 3500 * (i + 1)));
  }
  throw new Error("The message service is busy. Wait a few seconds and press send again.");
}

/* Everything on the topic, oldest first. */
export async function readTopic(code) {
  let txt;
  try { txt = await (await fetch(`${NTFY}${topicOf(code)}/json?poll=1&since=all`)).text(); }
  catch { throw new Error("Could not reach the message service (ntfy.sh). Check the connection."); }
  const out = [];
  for (const line of txt.split("\n")) {
    try {
      const d = JSON.parse(line);
      if (d.event === "message") out.push({ ...JSON.parse(d.message), _time: d.time });
    } catch { /* keepalives and foreign messages */ }
  }
  return out;
}

/* Turns a topic into the session: the latest settings, open or closed, and
 * one set of answers per respondent (a resend replaces the earlier one). */
export function sessionFromMessages(msgs, fallbackConfig = null) {
  let config = fallbackConfig, open = true;
  const byRid = new Map();
  for (const m of msgs) {
    if (m.t === "cfg" && m.cfg) config = m.cfg;
    else if (m.t === "ctrl") open = m.open !== false;
    else if (m.t === "ans" && m.rid && Array.isArray(m.a)) byRid.set(String(m.rid).slice(0, 40), { a: m.a, ts: m._time });
  }
  const responses = [];
  if (config) {
    const valid = new Set(config.grid);
    for (const [rid, { a, ts }] of byRid) {
      for (const x of a.slice(0, 20)) {
        const price = Number(x.p);
        if (!valid.has(price)) continue;
        const cats = {};
        let ok = true;
        for (const f of config.factors) {
          const v = x.c?.[f.name];
          if (!f.levels.includes(v)) { ok = false; break; }
          cats[f.name] = v;
        }
        if (ok) responses.push({ respondent: rid, price, accept: x.y ? 1 : 0, ...cats, ts });
      }
    }
  }
  return { config, open, responses, respondents: byRid.size };
}

export async function loadSession(code) {
  return sessionFromMessages(await readTopic(code), hostCache(code)?.config ?? null);
}

/* ── The lecturer's copy, so a session outlives ntfy's twelve hours ── */
const HOST = "elasticity-host-sessions";
export function hostSessions() {
  try { return JSON.parse(localStorage.getItem(HOST) || "[]"); } catch { return []; }
}
export function saveHostSession(entry) {
  const next = [entry, ...hostSessions().filter((s) => s.code !== entry.code)].slice(0, 20);
  try { localStorage.setItem(HOST, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}
export function forgetHostSession(code) {
  const next = hostSessions().filter((s) => s.code !== code);
  try { localStorage.setItem(HOST, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}
export const hostCache = (code) => hostSessions().find((s) => s.code === String(code).toUpperCase()) ?? null;

/* Merge what the topic returned with what this browser already had: the
 * topic wins while it holds the data, the cache fills in once it has expired. */
export function mergeWithCache(code, live) {
  const cached = hostCache(code);
  if (!cached) return live;
  if (live.responses.length >= (cached.responses?.length ?? 0)) {
    saveHostSession({ ...cached, config: live.config ?? cached.config, responses: live.responses, open: live.open });
    return live;
  }
  return { ...live, config: live.config ?? cached.config, responses: cached.responses, respondents: new Set(cached.responses.map((r) => r.respondent)).size, fromCache: true };
}
