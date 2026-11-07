# Feedboard

**One board for every UGC creator and every video, including the ones that never tagged you.**

Add a brand, a brief and a creator roster. Feedboard pulls every TikTok and Instagram video that **says, shows or captions** the product (via Oriane). A vision LLM on GMI Cloud watches each one and reads its comments. The board then tells you who to **rehire**, who to **nudge**, who to **recruit**, and what to **brief next**. It can also render an AI sample video of that brief.

## Run it

```bash
# .env at the repo root (gitignored)
ORIANE_API_KEY=...
GMI_API_KEY=...

npm run setup   # installs root, server/ and web/
npm run dev     # API on :8787, web on http://localhost:5173
```

Click **Load Rare Beauty demo** → **Build the board**. Use *Offline mode* to run against `fixtures/videos.json` without calling Oriane.

Production / single process (e.g. a GMI Cloud container): `npm run build && npm start` → the API serves `web/dist` on `:8787`.

## What's on the board

| Tab | What it shows | Powered by |
|---|---|---|
| **Overview** | Total views, % of views from untagged videos, format winner, views over time, rehire and nudge lists, top videos | Oriane search + metrics |
| **Creators** | Posted/quiet status, views, best views ÷ followers, engagement, audience love and purchase intent, **when the brand is first mentioned**, **off-brief posts**, and one-click AI outreach drafts | Oriane `popularComments`, `transcriptChunks`, an all-posts activity query, GMI LLM |
| **Videos** | Feed with hover-to-scrub frames, an *untagged* badge with *why it matched* ("Said it at 0:04", "On screen at 0:02"), a timeline of brand moments, and a comment summary | Oriane full projection, GMI vision |
| **Discover** | Organic fans who mentioned the brand but aren't on the roster, ranked by views ÷ followers, with public email when available | Oriane contents + profiles search |
| **Next brief** | Evidence-backed brief (hook, must-dos, avoids, shot list) plus an **8s AI sample video** | GMI LLM + Kling 3.0 Turbo on GMI |
| **Ask bar** | Natural-language Q&A over the campaign data | GMI LLM |

## Architecture

```
web/  (Vite + React 19 + Tailwind 4 + Motion + react-three-fiber + Recharts)
  │  /api (Vite proxy in dev)
server/  (Node + Express 5 + TypeScript via tsx)
  fetch.ts     campaign → videos       Oriane /contents/search (paginated, window start+end, visual search, brand moments, IG links)
  classify.ts  videos → labeled        GMI openai/gpt-6-luna vision: format + product visible + comment sentiment (cached per video id)
  metrics.ts   → board.json            pure functions (PLAN.md Part 3)
  insights.ts  discover · outreach drafts · next brief · sample video · ask
  index.ts     REST + NDJSON progress stream, image proxy for WebGL textures
```

The PLAN.md JSON contracts still work stage by stage:

```bash
cd server
npm run pipeline -- fetch    ../fixtures/campaign.json out/videos.json
npm run pipeline -- classify out/videos.json out/videos.labeled.json ../fixtures/campaign.json
npm run pipeline -- metrics  ../fixtures/campaign.json out/videos.labeled.json out/board.json
```

Models are configurable via env: `GMI_LLM_MODEL` (default `openai/gpt-6-luna`, vision), `GMI_FAST_MODEL` (`google/gemini-3.8-flash`), `GMI_VIDEO_MODEL` (`kling-3.0-turbo-t2v`).

## Notes / gotchas

- GMI's Gemini models reject image URLs, so vision runs on `gpt-6-luna`.
- Oriane content thumbnails don't send CORS headers, so `/api/img` proxies them for the 3D hero.
- Kling returns `outcome.media_urls[].url`, not `video_url`. The server saves the MP4 to `server/data/videos/` because provider links expire.
- Instagram posts have no shortcode field. We read it from the thumbnail path.
