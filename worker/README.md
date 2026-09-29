# Course AI service

A Cloudflare Worker that holds the course Anthropic key so students never need one.

| Endpoint | Model | What it does |
|---|---|---|
| `POST /interpret` | `claude-opus-5` | Reads a centroid table as buyer personas |
| `POST /research` | `claude-sonnet-5` + web search | Builds a sector dataset from the open web |
| `POST /review` | `claude-opus-5` | Formative feedback on a student's written answers |
| `GET /status` | — | Today's usage against the caps |
| `/room/…` | — | Live price rooms for the Elasticity Lab: create (POST), data (GET), WebSocket per phone. See `src/room.ts`. |

Opus for interpretation, where the quality of the reading is the point; Sonnet for research, which is mechanical collection work and would otherwise be the expensive half.

## Deploying from GitHub (no local install)

`.github/workflows/worker.yml` deploys this Worker from GitHub Actions. Once:

1. Cloudflare dashboard → *My Profile → API Tokens → Create Token* → template **Edit Cloudflare Workers** → create, copy the token.
2. Copy the **Account ID** from the right-hand column of the Cloudflare dashboard home (Workers & Pages).
3. GitHub → this repo → *Settings → Secrets and variables → Actions → New repository secret*: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Optionally `ANTHROPIC_API_KEY` (AI features) and `ACCESS_CODE`.
4. *Actions → Deploy the course Worker → Run workflow*.

The workflow creates the KV namespace on its first run, deploys, sets the optional secrets, and rebuilds the site so it points at the deployed URL. It serves the AI features of module 4 (which need `ANTHROPIC_API_KEY`) and the live price rooms of module 8 (which need nothing else — no AI, free-plan Durable Objects).

## Setup (from a terminal)

```bash
bash deploy.sh
```

That logs you into Cloudflare, creates the counter storage, asks for your Anthropic key, and deploys. Five minutes, once.

**Before you paste the key: set a spend limit on it** at console.anthropic.com → Limits. The caps below bound the number of requests, but a spend limit is the only thing that bounds euros, and it is the backstop worth having.

The key goes from your terminal straight to Cloudflare. It is never written into this repo, and nothing here should ever contain it.

### If you prefer to do it by hand

```bash
npm install
npx wrangler login
npx wrangler kv namespace create QUOTA     # paste the id into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Then put the deployed URL into the front end: `VITE_WORKER_URL` at build time, or edit the default in `src/lib/api.js`.

## Spend control

The URL is public, so these caps are what stands between a shared link and a surprising invoice. They live in `wrangler.toml`:

| Variable | Default | Why |
|---|---|---|
| `DAILY_INTERPRET` | 60 | Four runs each for 15 groups. |
| `DAILY_RESEARCH` | 15 | One per group. Each call runs up to 8 web searches, billed per search — this is the expensive endpoint. |
| `DAILY_REVIEW` | 90 | Feedback on written answers. One call per attempt, not per answer, and students re-run it as they improve — hence the higher cap. |
| `HOURLY_PER_IP` | 8 | Stops one person consuming the day's budget. |

Sized for 10–15 groups doing a few runs each. At these caps a maxed-out day costs roughly **€5**, so a leaked URL cannot run up a bill before you notice. An interpretation is about €0.03 (Opus 5 at medium effort, 4k output); a review of written answers about €0.05; a sector research call about €0.20 (Sonnet 5 plus its searches). A whole run of module 4 should land well under €25.

Change a number, then `npx wrangler deploy`.

Everything **fails closed**. If the counter store is unreachable, requests are refused rather than run uncapped. When a cap is hit, students get a clear message telling them the rest of the tool still works and to use *Show the prompt* instead — nobody is blocked from finishing their work.

Check usage any time at `https://<your-worker>.workers.dev/status`.

## If the URL leaks

Turn on a course access code without touching any code:

```bash
npx wrangler secret put ACCESS_CODE     # e.g. UFV-MKT-26
npx wrangler deploy
```

Students then enter it once. Remove it with `npx wrangler secret delete ACCESS_CODE`.

## Data handling

`/interpret` receives the **centroid table only** — segment means, modes, sizes and validation scores. Individual rows never leave the student's browser.

`/review` receives the student's **written answers** and the summary figures of their own run (variables, k, seed, index values), so the feedback can catch an answer that contradicts its own analysis. Their data rows are not sent.

`/research` collects **firmographic data about companies**, never about identifiable individuals; the system prompt refuses that and says so. Demand-side information is aggregate, from published research, with sources. This is a deliberate GDPR boundary for a European university, not a technical limitation.

## Watching it run

```bash
npx wrangler tail
```
