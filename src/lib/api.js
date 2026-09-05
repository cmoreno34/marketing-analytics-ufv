/* Client for the course Worker.
 *
 * The Worker holds the Anthropic key; the browser never sees it. Three calls:
 * interpret a segmentation, research a sector, and review a student's written
 * answers. All return JSON.
 *
 * Everything here degrades: if the Worker is down, over its daily cap, or not
 * deployed yet, the tool still clusters, still plots and still exports. The AI
 * layer is an accelerator on top of a complete tool, never a dependency —
 * a class of 60 must not be blocked by one rate limit. */

export const WORKER_URL =
  import.meta.env?.VITE_WORKER_URL || "https://mkt-analytics-agent.cmoreno34.workers.dev";

export class ApiError extends Error {
  constructor(message, { status, retryAfter, kind } = {}) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.kind = kind;
  }
}

async function post(path, body, { timeoutMs = 180000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => ctrl.abort());
  let res;
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new ApiError("The request took too long and was cancelled.", { kind: "timeout" });
    throw new ApiError("Could not reach the course service — it may not be running, or you may be offline. Everything else in the tool works without it.", { kind: "network" });
  }
  clearTimeout(timer);

  let data = null;
  try { data = await res.json(); } catch { /* fall through to status handling */ }

  if (!res.ok) {
    const retryAfter = Number(res.headers.get("retry-after")) || data?.retryAfter;
    if (res.status === 429)
      throw new ApiError(
        data?.error || "The class has used today's quota for this service. Clustering, charts and export all still work — the AI reading is the only thing paused.",
        { status: 429, retryAfter, kind: "quota" }
      );
    throw new ApiError(data?.error || `Service error (${res.status}).`, { status: res.status, kind: "server" });
  }
  return data;
}

/* Ask Claude to read a centroid table as buyer personas. */
export function interpretSegments(payload, opts) {
  return post("/interpret", payload, opts);
}

/* Ask Claude to research a sector on the open web and return rows. */
export function researchSector(payload, opts) {
  return post("/research", payload, { timeoutMs: 300000, ...opts });
}

/* Formative feedback on a student's written answers.
 *
 * One call per attempt, carrying every written answer at once — both because
 * it is far cheaper than a call per question, and because feedback written
 * with the whole submission in view is better feedback. */
export function reviewAnswers(payload, opts) {
  return post("/review", payload, { timeoutMs: 240000, ...opts });
}

export function buildReviewPrompt({ activity, context = [], rubric, answers = [] }) {
  const facts = context.map((c) => `- ${c[0]}: ${c[1]}`).join("\n");
  const block = answers.map((a, i) => {
    const parts = [`--- Question ${i + 1}`, `Asked: ${a.prompt}`];
    if (a.rubric) parts.push(`A good answer contains: ${a.rubric}`);
    parts.push(`My answer: ${String(a.answer || "").trim() || "(nothing yet)"}`);
    return parts.join("\n");
  }).join("\n\n");

  return `You are giving formative feedback on my written answers for a university marketing analytics activity. You are not the examiner — my lecturer marks the work. Tell me what is good, what is missing, and what to do about it.

Judge my answers against what my analysis actually produced:
${facts || "(not supplied)"}

${rubric ? `How this activity is marked:\n${rubric}\n\n` : ""}Rules for your feedback:
- An answer that contradicts the facts above is wrong. Say so and quote the correct figure.
- Reward answers that cite specific numbers from my own run over ones that are fluent but generic.
- Reward honesty: if the validation indices show weak structure, saying the segments are not trustworthy is BETTER than confidently describing personas.
- Do not reward length.
- Two or three sentences per answer, addressed to me as "you".

For each answer give: a band (strong / adequate / needs work / not attempted), the feedback, and what is missing. Then an overall comment, an indicative mark out of 10, my strengths and my gaps.

Activity: ${activity}

${block}`;
}

export function serviceStatus() {
  return fetch(`${WORKER_URL}/status`).then((r) => r.json()).catch(() => null);
}

/* The offline path. Produces the exact prompt the Worker would have sent, so a
 * student with no service (or who simply wants to see the prompt) can paste it
 * into Claude or ChatGPT and get the same analysis. Seeing the prompt is also
 * the point pedagogically — it shows that the "AI magic" is a well-specified
 * request built from the centroid table. */
export function buildInterpretPrompt({ algorithm, k, numCols, catCols, centroids, sizes, metrics, context }) {
  const rows = centroids.map((row, i) => {
    const nums = numCols.map((c) => `${c} = ${typeof row[c] === "number" ? row[c].toFixed(2) : row[c]}`);
    const cats = catCols.map((c) => `${c} = ${row[c]}`);
    return `Segment ${i + 1} (n = ${sizes[i]}, ${((sizes[i] / sizes.reduce((a, b) => a + b, 0)) * 100).toFixed(1)}% of the base): ${[...nums, ...cats].join("; ")}`;
  }).join("\n");

  const quality = metrics
    ? `\nQuality of this partition: average silhouette ${metrics.silhouette?.toFixed(3)}, Davies-Bouldin ${metrics.daviesBouldin?.toFixed(3)}, Calinski-Harabasz ${metrics.calinskiHarabasz?.toFixed(1)}.`
    : "";

  return `You are a marketing analytics expert. Below are the results of a customer segmentation.

Algorithm: ${algorithm}
Number of segments: ${k}
Numeric variables are cluster MEANS in original units. Categorical variables are cluster MODES.
${context ? `\nBusiness context: ${context}\n` : ""}
${rows}
${quality}

For each segment give me:
1. A short memorable persona name (2-4 words).
2. Three or four sentences describing who these customers are. Quote the actual centroid values that justify your description — do not invent attributes the data does not contain.
3. One concrete, specific marketing action for this segment.
4. How confident you are in this persona, and which variable most distinguishes it from the others.

Then, separately:
- Say which segments are commercially attractive and which are not, and why.
- Flag any segment that looks like an artefact of the algorithm rather than a real group.`;
}

export function buildResearchPrompt({ sector, geography, n, variables }) {
  return `Research the ${sector} sector${geography ? ` in ${geography}` : ""} and build a dataset of ${n} real companies operating in it.

For each company collect: ${variables.join(", ")}.

Rules:
- Use only public sources: company websites, public registries, industry reports, reputable press.
- Company-level (firmographic) data only. Do not collect data about identifiable individuals.
- Cite the source URL for each company.
- If a value is not available, write "NA" rather than estimating.

Return the result as a CSV with a header row.`;
}
