#!/usr/bin/env bash
# Prompts for the Oriane API key (hidden input) and stores it in .env (gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."
read -rsp "Paste your Oriane API key (input hidden): " key
echo
[ -n "$key" ] || { echo "No key entered."; exit 1; }
grep -v '^ORIANE_API_KEY=' .env 2>/dev/null > .env.tmp || true
echo "ORIANE_API_KEY=$key" >> .env.tmp
mv .env.tmp .env && chmod 600 .env
echo "Saved to .env. Testing it..."
./scripts/oriane.sh contents '{"operator":"and","filters":{"platform":{"includes":["tiktok"]}}}' 'limit=1&projection=basic' | head -c 400
echo
