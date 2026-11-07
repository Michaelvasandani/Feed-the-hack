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

Search now retrieves separate relevance, recent-post, brand-tag, and optional visual lists for each platform, merges them with reciprocal rank fusion, checks brand relevance, and ranks the verified matches against the campaign brief. The default feed is **Best match**, with **Most viewed** available separately. Discovery defaults to at most three videos per creator/platform; ambiguous and visual-only candidates appear separately and do not affect totals. See [the algorithm, budgets, and validation](docs/search-ranking.md).

`discovery.maxVideos` limits the final discovered shortlist. Optional `maxCandidates` sets the retrieval pool (default three times that limit, capped at 2,000), and `maxPerCreator` changes the diversity limit (default 3). Accepted roster videos are preserved independently of those shortlist limits. Partial search coverage and omitted matches are disclosed on the board.

Visual product queries can be slow; source review is required for visual-only candidates. Format labels remain cached by video ID/backend in `.cache/formats.json`. Brand relevance uses a separate versioned cache including campaign and text changes. Sample mode always uses offline keyword labels, even when model keys are configured.
