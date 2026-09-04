/* Course AI service for the Marketing Analytics tools.
 *
 * Holds the Anthropic key so students do not need one. Two jobs:
 *   POST /interpret  read a centroid table as buyer personas   (Opus 5)
 *   POST /research   build a sector dataset from the open web  (Sonnet 5 + web search)
 *
 * Spend control is the whole reason this file is careful. The URL is public,
 * so the caps below are the only thing between a leaked link and a surprising
 * invoice: a hard daily ceiling per endpoint, a per-IP hourly limit, and a
 * bounded number of search rounds per research call. Every limit fails CLOSED —
 * if the counter store is unavailable the request is refused rather than run.
 *
 * ACCESS_CODE is unset by default (the course chose an open service). Setting
 * it as a secret turns on a code gate with no redeploy:
 *     npx wrangler secret put ACCESS_CODE
 */

import Anthropic from "@anthropic-ai/sdk";

export interface Env {
  ANTHROPIC_API_KEY: string;
  QUOTA: KVNamespace;
  ACCESS_CODE?: string;
  DAILY_INTERPRET?: string;
  DAILY_RESEARCH?: string;
  HOURLY_PER_IP?: string;
  ALLOWED_ORIGINS?: string;
}

const MODEL_INTERPRET = "claude-opus-5";
const MODEL_RESEARCH = "claude-sonnet-5";

const DEFAULTS = { interpret: 400, research: 60, perIp: 12 };
const MAX_SEARCH_ROUNDS = 12;

/* ── CORS ── */
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowList = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allow = allowList.length === 0 ? origin || "*" : allowList.includes(origin) ? origin : allowList[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/* ── Quota ──
 * KV is eventually consistent, so two simultaneous requests can both read the
 * same count. That is acceptable here: the drift is a request or two, and the
 * ceiling exists to stop runaway spend, not to be exact to the unit. */
const todayKey = () => new Date().toISOString().slice(0, 10);
const hourKey = () => new Date().toISOString().slice(0, 13);

async function checkAndCount(env: Env, kind: "interpret" | "research", ip: string) {
  const dailyCap = Number(kind === "research" ? env.DAILY_RESEARCH : env.DAILY_INTERPRET)
    || (kind === "research" ? DEFAULTS.research : DEFAULTS.interpret);
  const ipCap = Number(env.HOURLY_PER_IP) || DEFAULTS.perIp;

  const dayK = `d:${kind}:${todayKey()}`;
  const ipK = `h:${ip}:${hourKey()}`;
  const [dayRaw, ipRaw] = await Promise.all([env.QUOTA.get(dayK), env.QUOTA.get(ipK)]);
  const dayN = Number(dayRaw ?? 0);
  const ipN = Number(ipRaw ?? 0);

  if (dayN >= dailyCap)
    return { ok: false as const, status: 429, retryAfter: secondsToMidnight(),
      error: `The class has used today's quota for this service (${dailyCap} requests). Everything else in the tool still works — clustering, the charts and the export need no service at all. Use "Show the prompt" and paste it into Claude or ChatGPT, or come back tomorrow.` };

  if (ipN >= ipCap)
    return { ok: false as const, status: 429, retryAfter: 3600,
      error: `You have made ${ipCap} requests in the last hour, which is this service's per-user limit. Use "Show the prompt" to run the same analysis in Claude or ChatGPT in the meantime.` };

  // 48h/2h TTLs: the keys are date-stamped, so expiry is only housekeeping.
  await Promise.all([
    env.QUOTA.put(dayK, String(dayN + 1), { expirationTtl: 172800 }),
    env.QUOTA.put(ipK, String(ipN + 1), { expirationTtl: 7200 }),
  ]);
  return { ok: true as const, remaining: dailyCap - dayN - 1 };
}

const secondsToMidnight = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.round((midnight.getTime() - now.getTime()) / 1000);
};

/* ── Schemas ── */
const INTERPRET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["segments", "attractiveness", "warnings"],
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cluster", "name", "description", "recommendation", "confidence", "distinguishing_variable"],
        properties: {
          cluster: { type: "integer" },
          name: { type: "string" },
          description: { type: "string" },
          recommendation: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          distinguishing_variable: { type: "string" },
        },
      },
    },
    attractiveness: { type: "string" },
    warnings: { type: "string" },
  },
} as const;

const RESEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["companies", "demand", "sources"],
  properties: {
    companies: {
      type: "array",
      items: { type: "object", additionalProperties: { type: "string" } },
    },
    demand: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "metrics", "trends"],
      properties: {
        summary: { type: "string" },
        metrics: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value", "period"],
            properties: { label: { type: "string" }, value: { type: "string" }, period: { type: "string" } },
          },
        },
        trends: { type: "array", items: { type: "string" } },
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url"],
        properties: { title: { type: "string" }, url: { type: "string" } },
      },
    },
  },
} as const;

/* ── Handlers ── */
async function handleInterpret(body: any, env: Env) {
  const { algorithm, k, numCols = [], catCols = [], centroids = [], sizes = [], metrics, context } = body ?? {};
  if (!Array.isArray(centroids) || !centroids.length) throw new HttpError(400, "No centroids were sent.");
  if (centroids.length > 12) throw new HttpError(400, "That is more segments than this endpoint accepts.");

  const total = sizes.reduce((a: number, b: number) => a + b, 0) || 1;
  const table = centroids.map((row: any, i: number) => {
    const nums = numCols.map((c: string) => `${c} = ${typeof row[c] === "number" ? row[c].toFixed(2) : row[c]}`);
    const cats = catCols.map((c: string) => `${c} = ${row[c]}`);
    return `Segment ${i + 1} (n = ${sizes[i]}, ${((sizes[i] / total) * 100).toFixed(1)}% of the base): ${[...nums, ...cats].join("; ")}`;
  }).join("\n");

  const quality = metrics
    ? `Partition quality: average silhouette ${metrics.silhouette?.toFixed?.(3)}, Davies-Bouldin ${metrics.daviesBouldin?.toFixed?.(3)}, Calinski-Harabasz ${metrics.calinskiHarabasz?.toFixed?.(1)}.`
    : "No validation indices were supplied.";

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL_INTERPRET,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: INTERPRET_SCHEMA } } as any,
    system:
      "You are a marketing analytics expert helping a university student interpret a customer segmentation. " +
      "Ground every claim in the centroid values you are given: quote the numbers that justify each persona and never " +
      "invent an attribute the data does not contain. If a segment is tiny, or the validation indices are poor, say so " +
      "plainly rather than writing a confident persona for a group that may be an artefact — a student who is told the " +
      "clustering is weak learns more than one who is handed four polished personas.",
    messages: [{
      role: "user",
      content: `Algorithm: ${algorithm}
Number of segments: ${k}
Numeric variables are cluster MEANS in original units. Categorical variables are cluster MODES.
${context ? `\nBusiness context supplied by the student: ${context}\n` : ""}
${table}

${quality}

For each segment: a short memorable persona name, three or four sentences describing who they are with the centroid values that justify it, one concrete marketing action, your confidence, and the single variable that most distinguishes this segment from the others.

Then say which segments are commercially attractive and which are not, and flag any segment that looks like an artefact of the algorithm rather than a real group.`,
    }],
  } as any);

  return extractJson(response);
}

async function handleResearch(body: any, env: Env) {
  const { sector, geography = "", n = 25, variables = [], includeDemand = true } = body ?? {};
  if (!sector || typeof sector !== "string") throw new HttpError(400, "Describe the sector to research.");
  const count = Math.max(5, Math.min(60, Number(n) || 25));

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: 14 },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10 },
  ];

  const system =
    "You build segmentation datasets for a university marketing analytics course by researching the open web.\n\n" +
    "Rules you must follow:\n" +
    "1. COMPANIES, NOT PEOPLE. Collect firmographic data about legal entities only. If asked for data about " +
    "identifiable individuals, refuse that part and explain why in the demand summary.\n" +
    "2. Every company row carries a source_url pointing at the page the data came from.\n" +
    "3. Write \"NA\" for anything you could not verify. Never estimate a number and present it as observed — a dataset " +
    "with honest gaps is usable, one with invented figures is not.\n" +
    "4. Prefer official sources: company sites, public registries, regulator filings, established industry reports.\n" +
    "5. Every company must use exactly the requested variable names as keys, all values as strings.";

  const messages: any[] = [{
    role: "user",
    content: `Research the ${sector} sector${geography ? ` in ${geography}` : ""}.

Build a dataset of up to ${count} real companies operating in it. For each company collect exactly these fields: ${variables.join(", ")}, plus source_url.

${includeDemand
  ? "Also research the demand side: market size, growth rate and the consumer trends driving the sector. Report these in AGGREGATE from published research, with sources. Do not build consumer-level records."
  : "Set the demand object to a brief note that demand-side research was not requested."}

Search efficiently — you have a limited number of searches. Prefer industry listings and association directories that cover many companies at once over one search per company.`,
  }];

  let response: any = null;
  for (let round = 0; round < MAX_SEARCH_ROUNDS; round++) {
    response = await client.messages.create({
      model: MODEL_RESEARCH,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      tools: tools as any,
      output_config: { format: { type: "json_schema", schema: RESEARCH_SCHEMA } } as any,
      messages,
    } as any);

    // Server tools can stop a long turn early; push it back and continue.
    // Without this the loop returns a silently truncated answer.
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    break;
  }
  return extractJson(response);
}

/* Structured output arrives parsed when the model complies, but a run that
 * ends on max_tokens or a tool pause can still leave raw text — so try both. */
function extractJson(response: any) {
  if (response?.parsed_output) return response.parsed_output;
  const text = (response?.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new HttpError(502, "The model returned no usable content. Try again.");
  const cleaned = text.replace(/^```(?:json)?/gm, "").replace(/```$/gm, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { /* fall through */ }
    }
    throw new HttpError(502, "The model's answer was not valid JSON. Try again, or use the prompt directly in Claude.");
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const ip = request.headers.get("CF-Connecting-IP") ?? "anon";

    if (url.pathname === "/status") {
      const [i, r] = await Promise.all([
        env.QUOTA.get(`d:interpret:${todayKey()}`),
        env.QUOTA.get(`d:research:${todayKey()}`),
      ]);
      return json({
        ok: true,
        gated: Boolean(env.ACCESS_CODE),
        interpret: { used: Number(i ?? 0), cap: Number(env.DAILY_INTERPRET) || DEFAULTS.interpret },
        research: { used: Number(r ?? 0), cap: Number(env.DAILY_RESEARCH) || DEFAULTS.research },
      }, 200, cors);
    }

    const kind = url.pathname === "/interpret" ? "interpret"
      : url.pathname === "/research" ? "research" : null;
    if (!kind) return json({ error: "Not found." }, 404, cors);
    if (request.method !== "POST") return json({ error: "Use POST." }, 405, cors);

    let body: any;
    try { body = await request.json(); }
    catch { return json({ error: "The request body was not valid JSON." }, 400, cors); }

    if (env.ACCESS_CODE && body?.accessCode !== env.ACCESS_CODE)
      return json({ error: "This service needs the course access code. Your lecturer gives it out in class." }, 401, cors);

    if (!env.ANTHROPIC_API_KEY)
      return json({ error: "The service is not configured yet — no API key has been set." }, 503, cors);

    // Fails closed: no counter store, no request.
    let quota;
    try { quota = await checkAndCount(env, kind, ip); }
    catch { return json({ error: "The usage counter is unavailable, so the service is paused to avoid uncapped spend. Use “Show the prompt” instead." }, 503, cors); }
    if (!quota.ok)
      return json({ error: quota.error, retryAfter: quota.retryAfter }, quota.status,
        { ...cors, "retry-after": String(quota.retryAfter) });

    try {
      const data = kind === "interpret" ? await handleInterpret(body, env) : await handleResearch(body, env);
      return json(data, 200, cors);
    } catch (e: any) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      // Anthropic SDK errors carry a status; surface rate limits as such.
      const status = typeof e?.status === "number" ? e.status : 502;
      const message = status === 429
        ? "The AI service is rate limited right now. Wait a minute and try again."
        : status === 401
          ? "The service key was rejected. Your lecturer needs to check the Worker configuration."
          : `The AI service failed (${status}). Use “Show the prompt” to run the same analysis yourself.`;
      return json({ error: message }, status === 429 ? 429 : 502, cors);
    }
  },
};
