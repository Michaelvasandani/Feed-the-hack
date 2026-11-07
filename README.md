# Feed the Hack: Campaign Board

Add a brand, brief and creator list; get one board with every matching TikTok/Instagram video (tagged or not), who posted vs went quiet, who beat their follower count, and which format won. See `PLAN.md` for the design.

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
scripts/set-oriane-key.sh                 # ORIANE_API_KEY -> .env
echo "TYPESAFE_API_KEY=..." >> .env          # optional: Jev format labels (preferred)
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env  # optional: Claude labels, or escalation for unsure Jev answers
echo "GMI_API_KEY=..." >> .env               # optional: GMI Cloud signals, insights, brief, drafts, ask, sample video
.venv/bin/uvicorn app.server:app --reload --port 8000
```

The UI is the React app in `web/` (Feedboard). For development, run it with Vite, which proxies `/api` to the Python server:

```bash
cd web && npm install && npm run dev        # http://localhost:5173
```

Or build it once (`npm run build` in `web/`) and the Python server serves it at http://localhost:8000. "Load Rare Beauty demo" with offline mode runs on `fixtures/`; otherwise the run calls Oriane.

## Layout

| Part | Module | CLI |
|------|--------|-----|
| 1. Fetch | `app/fetch.py` | `.venv/bin/python -m app.fetch fixtures/campaign.json out/videos.json` |
| 2. Classify | `app/classify.py` | `.venv/bin/python -m app.classify fixtures/videos.json out/videos.labeled.json` |
| 3. Metrics | `app/metrics.py` | `.venv/bin/python -m app.metrics fixtures/campaign.json out/videos.labeled.json out/board.json` |
| Insights | `app/insights.py` | `.venv/bin/python -m app.insights out/board.json` |
| 4. UI | `web/src/` (React + Vite) + `app/server.py` | tabs: Overview, Creators, Videos, Discover, Next brief, plus an ask bar |

Tests: `.venv/bin/python -m pytest -q`

Format labels: with `TYPESAFE_API_KEY` set, Jev labels each video and returns a probability per format. Answers with confidence below `JEV_ESCALATE_BELOW` (default 0.5) go to Claude when `ANTHROPIC_API_KEY` is also set. Force a backend with `CLASSIFY_BACKEND=jev|claude|keyword`. With no keys it uses keyword matching.

Insights: each video gets `signals` (hook, hook type, product prominence, sentiment, claims) from GMI Cloud when `GMI_API_KEY` is set (`GMI_MODEL`, default `deepseek-ai/DeepSeek-V4-Flash`; `GMI_BASE_URL`, default `https://api.gmi-serving.com/v1`), else a heuristic. The board then gets `insights` (headline, ranked actions, draft next brief) from Claude if `ANTHROPIC_API_KEY` is set, else GMI (`GMI_INSIGHTS_MODEL`, default `deepseek-ai/DeepSeek-V4-Pro`), else rules computed from the board. Force with `SIGNALS_BACKEND=gmi|heuristic` and `INSIGHTS_BACKEND=claude|gmi|rules`. Any failed call falls back, so the board always renders. When Oriane returns comments, the signals also read what the audience says (sentiment and purchase intent), which the Creators tab rolls up per creator.

On demand, the board tabs call GMI for a structured next brief (`/api/boards/{id}/brief`), outreach drafts (`/draft`), answers from the ask bar (`/ask`), and an 8-second sample video of the brief on GMI's request queue (`GMI_VIDEO_MODEL`, default `kling-3.0-turbo-t2v`). Without a GMI key the brief and drafts fall back to rules and templates; the ask bar and sample video need the key. Boards, briefs and discover results are saved in `out/store/`.

Notes: visual product search (`productImageUrls`) works but the Oriane query takes ~80s. Format labels are cached by video id in `.cache/formats.json`; only model labels are cached (per backend), so adding a key later upgrades heuristic ones.
