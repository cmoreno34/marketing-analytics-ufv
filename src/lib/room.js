/* Client for the live price rooms (worker/src/room.ts).
 *
 * The lecturer creates a room over HTTP; after that everything travels over one
 * WebSocket per device: the phone asks for an offer, answers, gets the next;
 * the lecturer's screen receives every closed group the moment it closes.
 * Connections drop on phones (screen locks, network changes), so the socket
 * reconnects by itself and the room remembers where each student was. */
import { WORKER_URL } from "./api.js";

export const isRoomCode = (c) => /^[A-Z0-9]{5}$/.test(String(c ?? "").trim().toUpperCase());
const wsBase = () => WORKER_URL.replace(/^http/, "ws");

async function asJson(res) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `The room service answered ${res.status}.`);
  return data;
}

export async function createRoom(config) {
  let res;
  try {
    res = await fetch(`${WORKER_URL}/room/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config }) });
  } catch {
    throw new Error("Could not reach the live-room server. If this is the first class with it, the server has not been set up yet (see the course README).");
  }
  return asJson(res);
}

export async function roomData(code) {
  let res;
  try { res = await fetch(`${WORKER_URL}/room/${code.trim().toUpperCase()}/data`); }
  catch { throw new Error("Could not reach the live-room server."); }
  return asJson(res);
}

/* A WebSocket that reconnects (1 s, 2 s, 4 s … up to 15 s) and tells the page
 * whether it is connected. Returns { send, close }. */
export function connectRoom(code, params, { onMessage, onStatus }) {
  let ws = null, closed = false, attempt = 0, timer = null;
  const qs = new URLSearchParams(params).toString();
  const open = () => {
    onStatus?.(attempt ? "reconnecting" : "connecting");
    ws = new WebSocket(`${wsBase()}/room/${code.trim().toUpperCase()}/ws?${qs}`);
    ws.onopen = () => { attempt = 0; onStatus?.("connected"); };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
    ws.onclose = (e) => {
      if (closed) return;
      onStatus?.(e.code === 1008 ? "refused" : "reconnecting");
      timer = setTimeout(open, Math.min(15000, 1000 * 2 ** attempt++));
    };
    ws.onerror = () => { try { ws.close(); } catch { /* already closing */ } };
  };
  open();
  return {
    send: (m) => { if (ws?.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; },
    close: () => { closed = true; clearTimeout(timer); try { ws?.close(); } catch { /* fine */ } },
  };
}

/* Every closed group is one point of the demand curve: its share of yes
 * answers at its price (and situation). A group where nobody bought gets half
 * an acceptance, so the logarithm exists — and is flagged. */
export function groupRows(groups, situationName) {
  return groups.filter((g) => g.closed && g.n > 0).map((g) => ({
    price: g.price, share: (g.yes || 0.5) / g.n, offers: g.n, accepts: g.yes, zeroFixed: g.yes === 0,
    group: g.id, ...(situationName ? { [situationName]: g.level } : {}),
  }));
}

/* One row per answer, with its group, for the Elasticity Lab. */
export function answerRows(data) {
  const sit = data.cfg.situation?.name;
  return data.groups.filter((g) => g.closed).flatMap((g) => Object.entries(g.answers || {}).map(([rid, a]) => ({
    respondent: rid.slice(0, 8), group: `G${g.id}`, price: g.price, accept: a, ...(sit ? { [sit]: g.level } : {}),
  })));
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
