#!/usr/bin/env bash
# One-shot setup for the course AI service.
#
# Run it from this directory:   bash deploy.sh
#
# It never sees your Anthropic key: `wrangler secret put` prompts you directly
# and the value goes from your terminal to Cloudflare. The key is not written
# to any file here, and nothing in this repo should ever contain it.
set -euo pipefail

cd "$(dirname "$0")"
WRANGLER="./node_modules/.bin/wrangler"

echo "==> 1/5  Installing dependencies"
[ -d node_modules ] || npm install

echo
echo "==> 2/5  Cloudflare login"
if ! "$WRANGLER" whoami >/dev/null 2>&1; then
  echo "    A browser window will open. Approve the request, then come back here."
  "$WRANGLER" login
else
  echo "    Already logged in."
fi

echo
echo "==> 3/5  Request-counter storage (KV)"
if grep -q "REPLACE_WITH_KV_ID" wrangler.toml; then
  echo "    Creating the QUOTA namespace…"
  OUT="$("$WRANGLER" kv namespace create QUOTA 2>&1 || true)"
  echo "$OUT"
  # wrangler prints the new id inside the snippet it suggests pasting.
  KV_ID="$(printf '%s' "$OUT" | grep -oE '"?id"?[[:space:]]*[:=][[:space:]]*"?[0-9a-f]{32}' | grep -oE '[0-9a-f]{32}' | head -1)"
  if [ -z "$KV_ID" ]; then
    echo
    echo "    Could not read the namespace id automatically."
    echo "    Copy the 32-character id from the output above, paste it into wrangler.toml"
    echo "    in place of REPLACE_WITH_KV_ID, then run this script again."
    exit 1
  fi
  sed -i.bak "s/REPLACE_WITH_KV_ID/$KV_ID/" wrangler.toml && rm -f wrangler.toml.bak
  echo "    Namespace $KV_ID written to wrangler.toml"
else
  echo "    Already configured."
fi

echo
echo "==> 4/5  Anthropic API key"
echo "    Paste your key at the prompt (it is hidden and is sent straight to Cloudflare)."
echo "    Get one at console.anthropic.com — and set a spend limit on it there first."
"$WRANGLER" secret put ANTHROPIC_API_KEY

echo
echo "==> 5/5  Deploying"
"$WRANGLER" deploy

cat <<'DONE'

Done.

Check it is alive by opening the /status URL of the worker printed above
in a browser — it reports today's usage against the caps.

Daily caps live in wrangler.toml (DAILY_INTERPRET, DAILY_RESEARCH,
HOURLY_PER_IP). Change them there and re-run `npx wrangler deploy`.

If the URL ever leaks and strangers start using your quota, turn on the
course access code with no code change:

    npx wrangler secret put ACCESS_CODE
    npx wrangler deploy

Remove it again with:

    npx wrangler secret delete ACCESS_CODE
DONE
