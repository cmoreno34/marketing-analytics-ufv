# Course AI service

A Cloudflare Worker that holds the course Anthropic key so students never need one.

| Endpoint | Model | What it does |
|---|---|---|
| `POST /interpret` | `claude-opus-5` | Reads a centroid table as buyer personas |
| `POST /research` | `claude-sonnet-5` + web search | Builds a sector dataset from the open web |
| `GET /status` | — | Today's usage against the caps |

Opus for interpretation, where the quality of the reading is the point; Sonnet for research, which is mechanical collection work and would otherwise be the expensive half.

## Setup

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
| `DAILY_INTERPRET` | 400 | Cheap. A class of 60 running several segmentations each fits comfortably. |
| `DAILY_RESEARCH` | 60 | Each call runs up to 14 web searches — this is the expensive endpoint. |
| `HOURLY_PER_IP` | 12 | Stops one person consuming the day's budget. |

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

`/research` collects **firmographic data about companies**, never about identifiable individuals; the system prompt refuses that and says so. Demand-side information is aggregate, from published research, with sources. This is a deliberate GDPR boundary for a European university, not a technical limitation.

## Watching it run

```bash
npx wrangler tail
```
