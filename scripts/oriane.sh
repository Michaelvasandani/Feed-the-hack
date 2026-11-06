#!/usr/bin/env bash
# Usage: scripts/oriane.sh <contents|profiles> '<json body>' ['query=string']
# The body needs "operator" ("and"/"or") alongside "filters", e.g. {"operator":"and","filters":{...}}.
# Reads ORIANE_API_KEY from .env and calls https://connect.oriane.xyz/rest/<kind>/search.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
kind="$1"; body="$2"; qs="${3:-}"
url="https://connect.oriane.xyz/rest/$kind/search${qs:+?$qs}"
curl -s -X POST "$url" -H 'Content-Type: application/json' -H "Authorization: Bearer $ORIANE_API_KEY" -d "$body"
