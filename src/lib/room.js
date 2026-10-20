/* Client for the live price rooms.
 *
 * The rooms live in a Firebase Realtime Database (see roomEngine.js for how
 * groups are formed without a server, and firebaseAdapter.js for the
 * connection). The three functions the pages use — createRoom, roomData,
 * connectRoom — and the messages they deliver are the ones the Cloudflare
 * Worker used, so the pages did not change. */
// Firebase is loaded only when a room is opened, so the other tools stay light.
const firebaseDb = () => import("./firebaseAdapter.js").then((m) => m.firebaseDb());
import { createRoom as engineCreate, readRoom, viewOf, studentSession, hostSession } from "./roomEngine.js";

export const isRoomCode = (c) => /^[A-Z0-9]{5}$/.test(String(c ?? "").trim().toUpperCase());

export async function createRoom(config) {
  const db = await firebaseDb();
  return engineCreate(db, config);
}

export async function roomData(code) {
  const db = await firebaseDb();
  const room = await readRoom(db, code.trim().toUpperCase());
  const { _internal, ...v } = viewOf(room, true);
  return v;
}

/* Connects a phone (role "student") or the lecturer's screen (role "host").
 * The database reconnects by itself after a dropped connection; the page is
 * told the status. Returns { send, close }, as before. */
export function connectRoom(code, params, { onMessage, onStatus }) {
  let session = null, closed = false, offConn = null;
  const pending = [];
  onStatus?.("connecting");
  firebaseDb().then((db) => {
    if (closed) return;
    let wasConnected = false;
    offConn = db.onConnection((on) => {
      if (on) { onStatus?.("connected"); wasConnected = true; }
      else if (wasConnected) onStatus?.("reconnecting");
    });
    const emit = (m) => {
      if (m.t === "refused") { onStatus?.("refused"); onMessage({ error: m.error }); return; }
      onMessage(m);
    };
    const C = code.trim().toUpperCase();
    session = params.role === "host" ? hostSession(db, C, emit) : studentSession(db, C, emit);
    for (const m of pending.splice(0)) session.send(m);
  }).catch((e) => { onStatus?.("refused"); onMessage({ t: "error", error: e.message }); });
  return {
    send: (m) => { if (session) return session.send(m); pending.push(m); return true; },
    close: () => { closed = true; session?.close(); offConn?.(); },
  };
}

/* The situations of a room (none, one, or up to three crossed). Rooms made
 * before situations could be crossed have a single `situation`. */
export const situationsOf = (cfg) => cfg?.situations ?? (cfg?.situation ? [cfg.situation] : []);

/* "15 °C" → 15, "1,5 km" → 1.5; NaN when the text does not start with a number. */
export function leadingNumber(text) {
  const m = String(text ?? "").trim().match(/^[-+]?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : NaN;
}

/* One column per situation: the level as text, or its number when the
 * situation is numeric (a temperature enters the model as a number). */
function situationColumns(cfg, g) {
  const sits = situationsOf(cfg);
  const lv = g.levels ?? (g.level != null ? [g.level] : []);
  return Object.fromEntries(sits.map((x, i) => [x.name, x.numeric ? leadingNumber(lv[i]) : lv[i] ?? ""]));
}

/* Where a group comes from: the class's answers to the offers, or the
 * phase-1 base (their stated WTP played at the phase-2 prices). */
export const sourceOf = (g) => (g.synthetic ? "stated" : "answered");

/* Every closed group is one point of the demand curve: its share of yes
 * answers at its price (and situations). A group where nobody bought gets half
 * an acceptance, so the logarithm exists — and is flagged. */
export function groupRows(groups, cfg) {
  return groups.filter((g) => g.closed && g.n > 0).map((g) => ({
    price: g.price, share: (g.yes || 0.5) / g.n, offers: g.n, accepts: g.yes, zeroFixed: g.yes === 0,
    group: g.id, wave: g.wave ?? 1, source: sourceOf(g), ...situationColumns(cfg, g),
  }));
}

/* One row per answer, with its group, for the Elasticity Lab. The respondent
 * is the random end of the id, the same for a student's stated and real rows. */
export function answerRows(data, { stated = true } = {}) {
  return data.groups.filter((g) => g.closed && (stated || !g.synthetic)).flatMap((g) => Object.entries(g.answers || {}).map(([rid, a]) => ({
    respondent: rid.slice(-6), group: `G${g.id}`, price: g.price, accept: a, source: sourceOf(g), ...situationColumns(data.cfg, g),
  })));
}

/* The model a room's live chart fits: lines by the first categorical
 * situation, other categorical ones as demand shifts, numeric ones as ln(x). */
export function roomSpec(cfg, rows) {
  const sits = situationsOf(cfg).filter((x) => new Set(rows.map((r) => r[x.name])).size > 1);
  const cats = sits.filter((x) => !x.numeric).map((x) => x.name);
  const nums = sits.filter((x) => x.numeric).map((x) => ({ col: x.name, log: rows.every((r) => r[x.name] > 0) }));
  return { price: "price", qty: "share", segment: cats[0] ?? null, shifters: cats.slice(1), nums };
}

/* The lecturer's rooms, kept in this browser (the host key opens them). */
const KEY = "elasticity-rooms";
export const myRooms = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
export function saveRoom(r) {
  const next = [r, ...myRooms().filter((x) => x.code !== r.code)].slice(0, 20);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}
export function forgetRoom(code) {
  const next = myRooms().filter((x) => x.code !== code);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

/* Situation combinations: the key the room uses ("it is raining|2:00 …") and
 * every combination of the situations' levels (none → one empty one). */
export const comboKey = (levels) => levels.join("|");
export const combosOf = (cfg) => situationsOf(cfg).reduce((acc, x) => acc.flatMap((c) => x.levels.map((l) => [...c, l])), [[]]);

/* A picture for a situation, so a phone shows at a glance whether it is
 * raining. A level that starts with an emoji keeps its own. */
const ICONS = [
  [/not rain|no rain|dry|sunny|sun\b|clear/i, "☀️"], [/rain|drizzl|storm|wet/i, "🌧️"], [/snow/i, "❄️"],
  [/°c|temperature|degrees/i, (t) => (parseFloat(t) >= 25 ? "🥵" : parseFloat(t) <= 10 ? "🥶" : "🌡️")],
  [/\b5%|battery is low|low battery/i, "🪫"], [/\b80%|full battery/i, "🔋"],
  [/friends|with others/i, "👥"], [/alone/i, "👤"], [/airport/i, "✈️"], [/neighbourhood|neighborhood|near home/i, "🏘️"],
  [/night|2:00|midnight|metro is closed/i, "🌙"], [/morning|8:30|before your first/i, "🌅"], [/evening|17:00|19:00|after/i, "🌇"],
  [/company|expense|business/i, "🏢"], [/own pocket|yourself|your own/i, "👛"],
  [/right now|urgent|today/i, "⏱️"], [/this month|this week|later/i, "📅"],
  [/few tickets|almost sold out|last/i, "🔥"], [/plenty|available/i, "🎟️"],
  [/cheaper|20%|rival|competitor/i, "🏷️"], [/no other offer/i, "🛒"],
  [/saturday|friday|weekend/i, "🎉"], [/tuesday|monday|weekday/i, "🗓️"],
  [/budget|€|income/i, "💶"],
];
export function iconFor(level) {
  const t = String(level ?? "").trim();
  const own = t.match(/^\p{Extended_Pictographic}\uFE0F?/u);
  if (own) return own[0];
  for (const [re, icon] of ICONS) if (re.test(t)) return typeof icon === "function" ? icon(t) : icon;
  return "📍";
}
