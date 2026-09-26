/* Live class sessions for the Elasticity Lab (module 8).
 *
 * The lecturer sets a product and a starting price; every student who joins
 * with the session code is offered prices a little above and below it and
 * answers yes or no. The pooled answers are the demand curve the class then
 * estimates.
 *
 * One Durable Object per session. A Durable Object rather than KV because a
 * class answers at the same moment: KV is eventually consistent and a single
 * key written by forty phones at once loses answers, whereas an object
 * serialises the writes and reads back exactly what was written. SQLite-backed,
 * which the free plan includes.
 *
 * No AI and no key involved, so nothing here costs money per request. The caps
 * are about abuse, not spend: sessions per day, answers per session, answers
 * per respondent. A session deletes itself 30 days after it was created.
 * Deliberately NO per-IP limit — a whole class sits behind one university IP.
 */

import { DurableObject } from "cloudflare:workers";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MAX_RESPONSES = 20000;
const MAX_PER_RESPONDENT = 60;
const DAILY_SESSIONS = 40;
const LIFETIME_MS = 30 * 24 * 3600 * 1000;

export interface PoolConfig {
  product: string;
  description: string;
  currency: string;
  start: number;
  rangePct: number;
  levels: number;
  offersEach: number;
  factors: { name: string; kind: "scenario" | "profile"; question: string; levels: string[] }[];
  grid: number[];
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const r2dp = (v: number) => Math.round(v * 100) / 100;

/* Everything a lecturer types is validated here, not trusted from the page. */
export function validateConfig(raw: any): PoolConfig | string {
  const start = Number(raw?.start);
  const rangePct = Number(raw?.rangePct);
  const levels = Math.round(Number(raw?.levels));
  const offersEach = Math.round(Number(raw?.offersEach));
  if (!str(raw?.product, 80)) return "Give the product a name.";
  if (!(start > 0 && start < 1e7)) return "The starting price must be a positive number.";
  if (!(rangePct >= 2 && rangePct <= 90)) return "The price range must be between 2% and 90%.";
  if (!(levels >= 3 && levels <= 15)) return "Use between 3 and 15 price levels.";
  if (!(offersEach >= 1 && offersEach <= 30)) return "Each student can see between 1 and 30 offers.";
  const factors = (Array.isArray(raw?.factors) ? raw.factors : []).slice(0, 3).map((f: any) => ({
    name: str(f?.name, 30).replace(/[^\p{L}\p{N} _-]/gu, ""),
    kind: f?.kind === "profile" ? "profile" as const : "scenario" as const,
    question: str(f?.question, 200),
    levels: [...new Set((Array.isArray(f?.levels) ? f.levels : []).map((l: unknown) => str(l, 40)).filter(Boolean))].slice(0, 8) as string[],
  })).filter((f: any) => f.name && f.levels.length >= 2);
  const lo = start * (1 - rangePct / 100), hi = start * (1 + rangePct / 100);
  const grid = Array.from({ length: levels }, (_, i) => r2dp(lo + ((hi - lo) * i) / (levels - 1)));
  return {
    product: str(raw.product, 80), description: str(raw?.description, 500), currency: str(raw?.currency, 4) || "€",
    start, rangePct, levels, offersEach, factors, grid,
  };
}

export class PricePool extends DurableObject {
  sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as any);
    this.sql = ctx.storage.sql;
  }

  async fetch(req: Request): Promise<Response> {
    const op = new URL(req.url).pathname.split("/").pop();
    const body: any = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const cfg = await this.ctx.storage.get<PoolConfig>("cfg");

    if (op === "init") {
      if (cfg) return Response.json({ error: "taken" }, { status: 409 });
      // Created here and not in the constructor: a mistyped code must not leave
      // behind an object with storage and no expiry alarm.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT, rid TEXT, price REAL, accept INTEGER, cats TEXT, ts INTEGER)`);
      await this.ctx.storage.put({ cfg: body.cfg, hostKey: body.hostKey, open: true, created: Date.now() });
      await this.ctx.storage.setAlarm(Date.now() + LIFETIME_MS);
      return Response.json({ ok: true });
    }
    if (!cfg) return Response.json({ error: "There is no session with that code. Check it with your lecturer." }, { status: 404 });
    const open = (await this.ctx.storage.get<boolean>("open")) ?? false;

    if (op === "info") {
      const row = this.sql.exec("SELECT COUNT(*) AS n, COUNT(DISTINCT rid) AS r FROM responses").one() as any;
      return Response.json({ config: cfg, open, responses: row.n, respondents: row.r });
    }

    if (op === "data") {
      const rows = this.sql.exec("SELECT rid, price, accept, cats, ts FROM responses ORDER BY id").toArray() as any[];
      return Response.json({
        config: cfg, open,
        responses: rows.map((r) => ({ respondent: r.rid, price: r.price, accept: r.accept, ...JSON.parse(r.cats || "{}"), ts: r.ts })),
      });
    }

    if (op === "respond") {
      if (!open) return Response.json({ error: "Your lecturer has closed this session — it is no longer taking answers." }, { status: 403 });
      const rid = str(body.rid, 40);
      const price = Number(body.price);
      const accept = body.accept === 1 || body.accept === true ? 1 : body.accept === 0 || body.accept === false ? 0 : -1;
      if (!rid || accept < 0 || !cfg.grid.some((g) => Math.abs(g - price) < 1e-9))
        return Response.json({ error: "That answer does not belong to this session." }, { status: 400 });
      const cats: Record<string, string> = {};
      for (const f of cfg.factors) {
        const v = str(body.cats?.[f.name], 40);
        if (!f.levels.includes(v)) return Response.json({ error: `Missing or unknown value for “${f.name}”.` }, { status: 400 });
        cats[f.name] = v;
      }
      const total = (this.sql.exec("SELECT COUNT(*) AS n FROM responses").one() as any).n;
      if (total >= MAX_RESPONSES) return Response.json({ error: "This session is full." }, { status: 429 });
      const mine = (this.sql.exec("SELECT COUNT(*) AS n FROM responses WHERE rid = ?", rid).one() as any).n;
      if (mine >= MAX_PER_RESPONDENT) return Response.json({ error: "You have already answered as many offers as this session allows." }, { status: 429 });
      this.sql.exec("INSERT INTO responses (rid, price, accept, cats, ts) VALUES (?, ?, ?, ?, ?)",
        rid, price, accept, JSON.stringify(cats), Date.now());
      return Response.json({ ok: true, total: total + 1 });
    }

    if (op === "close" || op === "open") {
      if (body.hostKey !== (await this.ctx.storage.get<string>("hostKey")))
        return Response.json({ error: "Only the device that created the session can do that." }, { status: 403 });
      await this.ctx.storage.put("open", op === "open");
      return Response.json({ ok: true, open: op === "open" });
    }

    return Response.json({ error: "Not found." }, { status: 404 });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

/* Routes /pool/… from the main Worker. */
export async function handlePool(
  request: Request, url: URL,
  env: { POOL: DurableObjectNamespace; QUOTA: KVNamespace; ACCESS_CODE?: string },
  reply: (body: unknown, status: number) => Response,
): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean); // ["pool", CODE?, op?]

  if (parts.length === 2 && parts[1] === "create") {
    if (request.method !== "POST") return reply({ error: "Use POST." }, 405);
    const body: any = await request.json().catch(() => null);
    if (env.ACCESS_CODE && body?.accessCode !== env.ACCESS_CODE)
      return reply({ error: "Creating a session needs the course access code." }, 401);
    const cfg = validateConfig(body?.config);
    if (typeof cfg === "string") return reply({ error: cfg }, 400);

    const dayK = `d:pool:${new Date().toISOString().slice(0, 10)}`;
    let used = 0;
    try { used = Number((await env.QUOTA.get(dayK)) ?? 0); }
    catch { return reply({ error: "The session service is unavailable right now." }, 503); }
    if (used >= DAILY_SESSIONS) return reply({ error: `Today's limit of ${DAILY_SESSIONS} class sessions has been reached.` }, 429);

    const hostKey = crypto.randomUUID();
    for (let attempt = 0; attempt < 6; attempt++) {
      const bytes = crypto.getRandomValues(new Uint8Array(5));
      const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
      const stub = env.POOL.get(env.POOL.idFromName(code));
      const res = await stub.fetch("https://pool/init", { method: "POST", body: JSON.stringify({ cfg, hostKey }) });
      if (res.ok) {
        await env.QUOTA.put(dayK, String(used + 1), { expirationTtl: 172800 });
        return reply({ code, hostKey, config: cfg }, 200);
      }
    }
    return reply({ error: "Could not allocate a session code. Try again." }, 503);
  }

  const code = (parts[1] ?? "").toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return reply({ error: "That is not a session code." }, 400);
  const op = parts[2] ?? "info";
  if (!["info", "data", "respond", "close", "open"].includes(op)) return reply({ error: "Not found." }, 404);
  if (["respond", "close", "open"].includes(op) && request.method !== "POST") return reply({ error: "Use POST." }, 405);

  const stub = env.POOL.get(env.POOL.idFromName(code));
  const res = await stub.fetch(`https://pool/${op}`, {
    method: request.method, body: request.method === "POST" ? await request.text() : undefined,
  });
  return reply(await res.json(), res.status);
}
