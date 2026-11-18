#!/usr/bin/env bash
# Opens n8n's real editor at http://localhost:5678 with the Flowmingo nodes loaded, so a person can click through them.
#
#   scripts/n8n-try.sh            the nodes call PRE  (https://pre-apis.flowmingo.ai)
#   scripts/n8n-try.sh prod       the nodes call PRODUCTION
#   scripts/n8n-try.sh stop       stop it
#
# The nodes always call production once published; for pre this script builds a TEST COPY of n8n/dist with the API
# address swapped, under n8n/.try (gitignored). The source is never changed. Needs Docker (OrbStack: `orb start`).
# In the editor: create the local owner account, add a "Flowmingo API" credential with a key for the same environment,
# then search "Flowmingo" in the node panel. The nodes show as custom nodes (CUSTOM.flowmingo); the published package
# will be `n8n-nodes-flowmingo` instead, which only `npm publish` can test.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRY="$ROOT/n8n/.try"
IMAGE="docker.n8n.io/n8nio/n8n:2.45.4"
NAME="flowmingo-n8n-try"
PROD="https://apis.flowmingo.ai/company/integration"
PRE="https://pre-apis.flowmingo.ai/company/integration"

if [ "${1:-}" = "stop" ]; then
  docker rm -f "$NAME" >/dev/null 2>&1 && echo "stopped" || echo "not running"
  exit 0
fi
TARGET="$PRE"; [ "${1:-}" = "prod" ] && TARGET="$PROD"
docker info >/dev/null 2>&1 || { echo "Docker is not running: start it first (OrbStack: orb start)" >&2; exit 1; }

(cd "$ROOT/n8n" && npx n8n-node build >/dev/null)
rm -rf "$TRY/custom" && mkdir -p "$TRY/custom/n8n-nodes-flowmingo" "$TRY/home"
cp "$ROOT/n8n/package.json" "$TRY/custom/n8n-nodes-flowmingo/"
cp -R "$ROOT/n8n/dist" "$TRY/custom/n8n-nodes-flowmingo/"
if [ "$TARGET" != "$PROD" ]; then
  node -e 'const fs=require("fs");const [f,u]=process.argv.slice(1);const c=JSON.parse(fs.readFileSync(f,"utf8"));c.base_url=u;fs.writeFileSync(f,JSON.stringify(c,null,2))' \
    "$TRY/custom/n8n-nodes-flowmingo/dist/nodes/Flowmingo/contract.json" "$TARGET"
  perl -pi -e "s#\Q$PROD\E#$TARGET#g" "$TRY/custom/n8n-nodes-flowmingo/dist/credentials/FlowmingoApi.credentials.js"
fi
chmod -R a+rwX "$TRY"

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p 5678:5678 \
  -e N8N_CUSTOM_EXTENSIONS=/custom -e N8N_DIAGNOSTICS_ENABLED=false -e GENERIC_TIMEZONE=UTC \
  -v "$TRY/home:/home/node/.n8n" -v "$TRY/custom:/custom" "$IMAGE" start >/dev/null
for _ in $(seq 1 40); do
  curl -fs http://localhost:5678/healthz >/dev/null 2>&1 && break
  sleep 2
done
curl -fs http://localhost:5678/healthz >/dev/null && echo "n8n is up at http://localhost:5678 — the Flowmingo nodes call $TARGET" \
  || { echo "n8n did not answer; docker logs $NAME" >&2; exit 1; }
