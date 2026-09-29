/* Live price rooms for the Elasticity Lab (module 8).
 *
 * The lecturer creates a scenario — a product, a base price, how far prices vary
 * around it, and optional situations ("it is raining" / "it is not raining").
 * Students join the room and are placed in GROUPS of a fixed size (5 by
 * default). Every group gets one price and one situation; each member answers
 * "I would buy it" or not. When the group is full it closes, and its share of
 * yes answers is the demand at that price: one point of the class demand curve.
 * Each student answers several rounds, each time in a new group with another
 * price, so a class of 50 produces dozens of points in a few minutes.
 *
 * One Durable Object per room. It is the only writer, so group filling is exact
 * even with 50 phones answering at the same instant, and it keeps a WebSocket
 * open to every phone and to the lecturer's screen, pushing each offer and each
 * closed group the moment they happen. WebSocket hibernation: an idle room
 * costs nothing. No AI and no key are involved.
 *
 * Seats that are never answered (a student closes the phone) expire after
 * SEAT_TIMEOUT and the place goes to someone else, so no group is stuck.
 */
import { DurableObject } from "cloudflare:workers";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DAILY_ROOMS = 60;
const LIFETIME_MS = 14 * 24 * 3600 * 1000;
const SEAT_TIMEOUT = 120 * 1000;
const MAX_STUDENTS = 400;

export interface RoomConfig {
  product: string;
  description: string;
  currency: string;
  base: number;
  rangePct: number;
  levels: number;
  groupSize: number;
  rounds: number;
  situation: { name: string; question: string; levels: string[] } | null;
  grid: number[];
}

interface Group {
  id: number;
  price: number;
  level: string | null;
  seats: Record<string, number>;          // rid -> time the seat was given
  answers: Record<string, 0 | 1>;
  closed: boolean;
  closedAt?: number;
}

interface State {
  cfg: RoomConfig;
  hostKey: string;
  open: boolean;
  created: number;
  groups: Group[];
  students: Record<string, { done: number; current: number | null; history: string[] }>;
  nextId: number;
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function validateConfig(raw: any): RoomConfig | string {
  const base = Number(raw?.base), rangePct = Number(raw?.rangePct);
  const levels = Math.round(Number(raw?.levels)), groupSize = Math.round(Number(raw?.groupSize));
  const rounds = Math.round(Number(raw?.rounds));
  if (!str(raw?.product, 80)) return "Give the product a name.";
  if (!(base > 0 && base < 1e7)) return "The base price must be a positive number.";
  if (!(rangePct >= 5 && rangePct <= 90)) return "The variation must be between 5% and 90%.";
  if (!(levels >= 3 && levels <= 15)) return "Use between 3 and 15 prices.";
  if (!(groupSize >= 2 && groupSize <= 20)) return "Groups must have between 2 and 20 students.";
  if (!(rounds >= 1 && rounds <= 20)) return "Each student can answer between 1 and 20 rounds.";
  let situation = null;
  if (raw?.situation && str(raw.situation.name, 30)) {
    const lv = [...new Set((Array.isArray(raw.situation.levels) ? raw.situation.levels : String(raw.situation.levels ?? "").split(","))
      .map((l: unknown) => str(l, 50)).filter(Boolean))].slice(0, 6) as string[];
    if (lv.length >= 2) situation = { name: str(raw.situation.name, 30).replace(/[^\p{L}\p{N}_-]/gu, "_"), question: str(raw.situation.question, 200), levels: lv };
  }
  const lo = base * (1 - rangePct / 100), hi = base * (1 + rangePct / 100);
  return {
    product: str(raw.product, 80), description: str(raw?.description, 500), currency: str(raw?.currency, 4) || "€",
    base, rangePct, levels, groupSize, rounds, situation,
    grid: Array.from({ length: levels }, (_, i) => r2(lo + ((hi - lo) * i) / (levels - 1))),
  };
}

type Tag = { role: "host" | "student"; rid: string };

export class PriceRoom extends DurableObject {
  state: State | null = null;

  async load(): Promise<State | null> {
    if (!this.state) this.state = (await this.ctx.storage.get<State>("state")) ?? null;
    return this.state;
  }
  async save() { await this.ctx.storage.put("state", this.state); }

  /* ── HTTP: create, data, and the WebSocket upgrade ── */
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const op = url.pathname.split("/").pop();
    if (op === "init") {
      if (await this.load()) return Response.json({ error: "taken" }, { status: 409 });
      const { cfg, hostKey } = await req.json<any>();
      this.state = { cfg, hostKey, open: true, created: Date.now(), groups: [], students: {}, nextId: 1 };
      await this.save();
      await this.ctx.storage.setAlarm(Date.now() + LIFETIME_MS);
      return Response.json({ ok: true });
    }
    const s = await this.load();
    if (!s) return Response.json({ error: "There is no room with that code. Check it with your lecturer." }, { status: 404 });

    if (op === "data") return Response.json(this.publicState(true));

    if (op === "ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      const role = url.searchParams.get("role") === "host" ? "host" : "student";
      if (role === "host" && url.searchParams.get("key") !== s.hostKey)
        return Response.json({ error: "Only the lecturer who created the room can open it as host." }, { status: 403 });
      const rid = str(url.searchParams.get("rid"), 40) || crypto.randomUUID();
      if (role === "student" && !s.students[rid] && Object.keys(s.students).length >= MAX_STUDENTS)
        return Response.json({ error: "This room is full." }, { status: 429 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [role]);
      pair[1].serializeAttachment({ role, rid } as Tag);
      if (role === "student") {
        s.students[rid] ??= { done: 0, current: null, history: [] };
        await this.save();
        this.send(pair[1], { t: "hello", cfg: s.cfg, open: s.open, me: this.studentView(rid) });
        this.broadcastHosts({ t: "count", ...this.counts() });
      } else {
        this.send(pair[1], { t: "state", ...this.publicState(false) });
      }
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  /* ── WebSocket messages ── */
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const s = await this.load();
    if (!s) return;
    const tag = ws.deserializeAttachment() as Tag;
    let m: any;
    try { m = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }

    if (tag.role === "host") {
      if (m.t === "open" || m.t === "close") {
        s.open = m.t === "open";
        await this.save();
        this.broadcast({ t: "open", open: s.open });
      }
      if (m.t === "finish") {
        // Include incomplete groups (at least 2 answers) with their real size.
        for (const g of s.groups) if (!g.closed && Object.keys(g.answers).length >= 2) { g.closed = true; g.closedAt = Date.now(); this.broadcastHosts({ t: "group", group: this.groupView(g) }); }
        s.open = false;
        await this.save();
        this.broadcast({ t: "open", open: false });
      }
      return;
    }

    const me = s.students[tag.rid];
    if (!me) return;
    if (m.t === "next") {
      if (!s.open) return this.send(ws, { t: "closed" });
      if (me.done >= s.cfg.rounds) return this.send(ws, { t: "finished", me: this.studentView(tag.rid) });
      const g = me.current != null ? s.groups.find((x) => x.id === me.current && !x.closed) : this.assign(tag.rid);
      if (!g) return this.send(ws, { t: "wait" });
      me.current = g.id;
      await this.save();
      return this.send(ws, { t: "offer", group: g.id, price: g.price, level: g.level, round: me.done + 1, of: s.cfg.rounds });
    }
    if (m.t === "answer") {
      const g = s.groups.find((x) => x.id === m.group);
      if (!g || me.current !== g.id || !(tag.rid in g.seats)) return this.send(ws, { t: "error", error: "That offer has expired. Here is a new one." });
      g.answers[tag.rid] = m.buy ? 1 : 0;
      me.done++; me.current = null; me.history.push(`${g.price}|${g.level ?? ""}`);
      if (Object.keys(g.answers).length >= s.cfg.groupSize) { g.closed = true; g.closedAt = Date.now(); }
      await this.save();
      this.send(ws, { t: "ok", me: this.studentView(tag.rid) });
      this.broadcastHosts(g.closed ? { t: "group", group: this.groupView(g), ...this.counts() } : { t: "count", ...this.counts() });
    }
  }

  async webSocketClose(ws: WebSocket) {
    const tag = ws.deserializeAttachment() as Tag;
    if (tag?.role === "student") this.broadcastHosts({ t: "count", ...this.counts() });
  }

  async alarm() { await this.ctx.storage.deleteAll(); this.state = null; }

  /* ── Group assignment ──
   * Fill an open group the student has not been in; otherwise open a new one
   * with the price (and situation) used least so far, so the whole grid is
   * covered evenly and prices repeat across groups as the rounds go on. */
  assign(rid: string): Group | null {
    const s = this.state!;
    const now = Date.now();
    for (const g of s.groups) {                      // free seats nobody answered
      if (g.closed) continue;
      for (const [r, t] of Object.entries(g.seats)) if (!(r in g.answers) && now - t > SEAT_TIMEOUT) {
        delete g.seats[r];
        if (s.students[r]?.current === g.id) s.students[r].current = null;
      }
    }
    const seen = new Set(s.students[rid].history);
    const open = s.groups.filter((g) => !g.closed && Object.keys(g.seats).length < s.cfg.groupSize && !(rid in g.seats)
      && !seen.has(`${g.price}|${g.level ?? ""}`));
    let g = open.sort((a, b) => Object.keys(b.seats).length - Object.keys(a.seats).length)[0];
    if (!g) {
      const levels = s.cfg.situation ? s.cfg.situation.levels : [null];
      const use = new Map<string, number>();
      for (const x of s.groups) use.set(`${x.price}|${x.level ?? ""}`, (use.get(`${x.price}|${x.level ?? ""}`) ?? 0) + 1);
      const cells = s.cfg.grid.flatMap((p) => levels.map((l) => ({ price: p, level: l, key: `${p}|${l ?? ""}` })));
      const fresh = cells.filter((c) => !seen.has(c.key));
      const pool = fresh.length ? fresh : cells;
      const min = Math.min(...pool.map((c) => use.get(c.key) ?? 0));
      const least = pool.filter((c) => (use.get(c.key) ?? 0) === min);
      const pick = least[Math.floor(Math.random() * least.length)];
      g = { id: s.nextId++, price: pick.price, level: pick.level, seats: {}, answers: {}, closed: false };
      s.groups.push(g);
    }
    g.seats[rid] = now;
    return g;
  }

  /* ── Views ── */
  groupView(g: Group) {
    const n = Object.keys(g.answers).length, yes = Object.values(g.answers).reduce((a: number, b) => a + b, 0);
    return { id: g.id, price: g.price, level: g.level, n, yes, closed: g.closed, closedAt: g.closedAt ?? null };
  }
  counts() {
    const s = this.state!;
    let connected = 0;
    for (const ws of this.ctx.getWebSockets("student")) if (ws.readyState === WebSocket.OPEN) connected++;
    const answers = s.groups.reduce((a, g) => a + Object.keys(g.answers).length, 0);
    return { connected, students: Object.keys(s.students).length, answers, closedGroups: s.groups.filter((g) => g.closed).length, openGroups: s.groups.filter((g) => !g.closed).length };
  }
  publicState(withAnswers: boolean) {
    const s = this.state!;
    return {
      cfg: s.cfg, open: s.open, created: s.created, ...this.counts(),
      groups: s.groups.map((g) => ({ ...this.groupView(g), ...(withAnswers ? { answers: g.answers } : {}) })),
    };
  }
  studentView(rid: string) {
    const me = this.state!.students[rid];
    return { done: me.done, rounds: this.state!.cfg.rounds };
  }
  send(ws: WebSocket, m: unknown) { try { ws.send(JSON.stringify(m)); } catch { /* gone */ } }
  broadcastHosts(m: unknown) { for (const ws of this.ctx.getWebSockets("host")) this.send(ws, m); }
  broadcast(m: unknown) { for (const ws of this.ctx.getWebSockets()) this.send(ws, m); }
}

/* Routes /room/… from the main Worker. */
export async function handleRoom(
  request: Request, url: URL,
  env: { ROOM: DurableObjectNamespace; QUOTA: KVNamespace; ACCESS_CODE?: string },
  reply: (body: unknown, status: number) => Response,
): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean);    // ["room", CODE|create, op?]
  if (parts[1] === "create") {
    if (request.method !== "POST") return reply({ error: "Use POST." }, 405);
    const body: any = await request.json().catch(() => null);
    if (env.ACCESS_CODE && body?.accessCode !== env.ACCESS_CODE) return reply({ error: "Creating a room needs the course access code." }, 401);
    const cfg = validateConfig(body?.config);
    if (typeof cfg === "string") return reply({ error: cfg }, 400);
    const dayK = `d:room:${new Date().toISOString().slice(0, 10)}`;
    let used = 0;
    try { used = Number((await env.QUOTA.get(dayK)) ?? 0); } catch { return reply({ error: "The room service is unavailable right now." }, 503); }
    if (used >= DAILY_ROOMS) return reply({ error: `Today's limit of ${DAILY_ROOMS} rooms has been reached.` }, 429);
    const hostKey = crypto.randomUUID();
    for (let i = 0; i < 6; i++) {
      const code = [...crypto.getRandomValues(new Uint8Array(5))].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
      const res = await env.ROOM.get(env.ROOM.idFromName(code)).fetch("https://room/init", { method: "POST", body: JSON.stringify({ cfg, hostKey }) });
      if (res.ok) {
        await env.QUOTA.put(dayK, String(used + 1), { expirationTtl: 172800 });
        return reply({ code, hostKey, config: cfg }, 200);
      }
    }
    return reply({ error: "Could not allocate a room code. Try again." }, 503);
  }
  const code = (parts[1] ?? "").toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return reply({ error: "That is not a room code." }, 400);
  const op = parts[2] ?? "data";
  if (!["data", "ws"].includes(op)) return reply({ error: "Not found." }, 404);
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  const inner = new URL(request.url);
  inner.pathname = `/${op}`;
  if (op === "ws") return stub.fetch(new Request(inner.toString(), request));   // the upgrade goes straight through
  const res = await stub.fetch(inner.toString());
  return reply(await res.json(), res.status);
}
