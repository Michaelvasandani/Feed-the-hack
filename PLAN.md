# Build Plan: 4 Parallel Parts

The four parts only talk through JSON files. Each one can start now against the sample data in `fixtures/` and switch to live data at integration.

```
campaign.json ──► [1 Fetch] ──► videos.json ──► [2 Classify] ──► videos.labeled.json ──► [3 Metrics] ──► board.json ──► [4 Board UI]
```

| Part | Reads | Writes | Starts from |
|------|-------|--------|-------------|
| 1. Fetch | `campaign.json` | `videos.json` | `scripts/fetch_videos.py` (working draft) |
| 2. Classify formats | `videos.json` | `videos.labeled.json` | `fixtures/videos.json` |
| 3. Board metrics | `campaign.json` + `videos.labeled.json` | `board.json` | `fixtures/` (treat `format: null` as `"unclassified"` until Part 2 lands) |
| 4. Board UI | `board.json` | the app | a hand-written `board.json` that matches the shape below |

## Shared contracts

### `campaign.json` (input; sample in `fixtures/campaign.json`)
```json
{
  "id": "rare-beauty-holiday-2026",
  "brand": { "name": "Rare Beauty", "aliases": ["rare beauty"], "handles": { "instagram": "rarebeauty", "tiktok": "rarebeauty" }, "productImageUrls": [] },
  "brief": "…",
  "window": { "start": "2026-10-01", "end": "2026-11-06" },
  "creators": [ { "name": "Rachael Potash", "handles": { "instagram": "rachaelpotash", "tiktok": "rachaelpotash" } } ]
}
```

### `videos.json` (sample in `fixtures/videos.json`: 16 real videos)
```json
{
  "campaignId": "…", "fetchedAt": 1794006438892,
  "videos": [{
    "id": "cnt_…", "platform": "tiktok", "url": "https://www.tiktok.com/@h/video/…",
    "creatorHandle": "rachaelpotash", "publishedAt": "2026-10-09T…Z",
    "caption": "…", "transcript": "…", "onScreenText": ["…"], "durationSeconds": 34,
    "thumbnailUrl": "…", "frameUrls": ["…"],
    "views": 12000000, "likes": 0, "comments": 0, "shares": 0, "followers": 64700,
    "viewsPerFollowerPct": 18547.1, "engagementPerViewPct": 6.9,
    "matchedBy": ["caption", "transcript", "onScreenText", "mention", "visual"],
    "tagged": false,
    "format": null
  }]
}
```
`videos.labeled.json` has the same shape, plus `format`, `formatConfidence` (0–1) and `formatReason` on each video.

Formats: `unboxing`, `grwm`, `review`, `haul`, `tutorial`, `gift_guide`, `day_in_life`, `other`.

### `board.json` (output of Part 3, input of Part 4)
```json
{
  "campaign": { "id": "…", "brandName": "Rare Beauty", "window": { "start": "…", "end": "…" } },
  "totals": { "videos": 16, "views": 0, "likes": 0, "comments": 0, "shares": 0,
              "creatorsPosted": 8, "creatorsTotal": 9, "untaggedVideos": 8, "untaggedViews": 0 },
  "creators": [{ "name": "…", "handles": {}, "status": "posted | quiet", "videos": 0, "views": 0,
                 "followers": 0, "bestViewsPerFollowerPct": 0, "lastPostedAt": "…",
                 "overperformer": true, "recommendation": "rehire | nudge | keep" }],
  "formats": [{ "format": "grwm", "videos": 0, "views": 0, "avgViewsPerFollowerPct": 0,
                "avgEngagementPerViewPct": 0, "winner": true }],
  "videos": [ "…videos.labeled.json entries, sorted by views…" ]
}
```

---

## Part 1: Fetch (Oriane → `videos.json`)
`scripts/fetch_videos.py` already works end to end on the sample campaign. Remaining work:
- [ ] Paginate past 100 results (`offset`; pass `aiSearchAnchor` on later pages when using visual search).
- [ ] Visual matches: upload `productImageUrls` with `POST /rest/assets`, add a `visualSimilarity` filter, and tag hits `"visual"` in `matchedBy`.
- [ ] Respect `window.end` (`publishedAt.before`).
- [ ] Instagram post URLs: Oriane returns no shortcode, so currently `null`. Find a fallback (for example, link to the profile).
- [ ] Turn it into a function or endpoint the app can call (input: campaign, output: videos).

API notes: auth is `Authorization: Bearer <key>`, and `operator` is required on every query. Use `includesExactly` for brand names; `includesFuzzy` matches loose words. Use `projection=full` to get transcripts. Instagram carousels have `views: null`. Spec: `docs/oriane-openapi.json`.

## Part 2: Classify formats (`videos.json` → `videos.labeled.json`)
- [ ] Send Claude the caption, transcript, `onScreenText` and optionally 2–3 `frameUrls`; get back `{format, confidence, reason}` as structured output.
- [ ] Handle `transcript: null` and `onScreenText: null` (not processed yet). Fall back to caption plus frames.
- [ ] Optional signal: an Oriane text asset (for example, "a person unboxing a package") used in a `visualSimilarity` search. In testing, real unboxings scored ~0.88 and hauls/GRWMs ~0.71–0.79.
- [ ] Batch or run in parallel so 100+ videos finish in under a minute; cache by video `id`.

## Part 3: Board metrics (`campaign.json` + `videos.labeled.json` → `board.json`)
Pure functions with no API calls, so they're easy to test on the fixtures.
- [ ] Totals across all videos; untagged count and views (`tagged: false`).
- [ ] Per creator: join on `(platform, handle)`. `quiet` if no videos in the window (`colbyodonis` in the fixture).
- [ ] `overperformer`: best video has views ≥ followers (`viewsPerFollowerPct >= 100`).
- [ ] `recommendation`: quiet → `nudge`, overperformer → `rehire`, else `keep`.
- [ ] Per format: count, views, average views/follower, average engagement/view; `winner` = highest average views/follower with ≥ 2 videos.
- [ ] Skip `null` metrics (carousels) in averages instead of counting them as 0.

## Part 4: Board UI (`board.json` → app)
- [ ] Setup screen: brand, aliases, brief, date window, creator list (paste handles), optional product images.
- [ ] Totals row: views, videos, creators posted out of total, untagged mentions found.
- [ ] Creator table: posted/quiet, views, views/follower, overperformer badge, nudge/rehire action.
- [ ] Format chart: views/follower by format, with the winner called out ("brief more GRWMs").
- [ ] Video feed: thumbnail, creator, views, format, and an "untagged" badge with *why* it matched (said it / shown on screen).
- [ ] Build it with Claude first, then move it to Lovable for the final polish (saves Lovable credits).

## Integration checkpoints
- **3:30** Each part works on the fixtures by itself.
- **4:30** Chain them: campaign → fetch → classify → metrics → UI on live data.
- **5:00** Freeze features, rehearse the demo on the Rare Beauty campaign.
