# Feed the Hack: Campaign Board

Add a brand, brief and creator list; get one board with every matching TikTok/Instagram video (tagged or not), who posted vs went quiet, who beat their follower count, and which format won. See `PLAN.md` for the design.

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
scripts/set-oriane-key.sh                 # ORIANE_API_KEY -> .env
echo "TYPESAFE_API_KEY=..." >> .env          # optional: Jev format labels (preferred)
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env  # optional: Claude labels, or escalation for unsure Jev answers
.venv/bin/uvicorn app.server:app --reload --port 8000
```

Open http://localhost:8000. "Load sample data" works offline from `fixtures/`; "Build board (live)" calls Oriane.

## Layout

| Part | Module | CLI |
|------|--------|-----|
| 1. Fetch | `app/fetch.py` | `.venv/bin/python -m app.fetch fixtures/campaign.json out/videos.json` |
| 2. Classify | `app/classify.py` | `.venv/bin/python -m app.classify fixtures/videos.json out/videos.labeled.json` |
| 3. Metrics | `app/metrics.py` | `.venv/bin/python -m app.metrics fixtures/campaign.json out/videos.labeled.json out/board.json` |
| 4. UI | `web/index.html` + `app/server.py` | single static page, no build step (ready to paste into Lovable) |

Tests: `.venv/bin/python -m pytest -q`

Format labels: with `TYPESAFE_API_KEY` set, Jev labels each video and returns a probability per format. Answers with confidence below `JEV_ESCALATE_BELOW` (default 0.5) go to Claude when `ANTHROPIC_API_KEY` is also set. Force a backend with `CLASSIFY_BACKEND=jev|claude|keyword`. With no keys it uses keyword matching.

Notes: visual product search (`productImageUrls`) works but the Oriane query takes ~80s. Format labels are cached by video id in `.cache/formats.json`; only model labels are cached (per backend), so adding a key later upgrades heuristic ones.
