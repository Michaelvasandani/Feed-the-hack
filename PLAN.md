# Project Completion Plan

## Outcome

Ship an agency campaign dashboard that takes a brand, brief, date window, and creator list; finds matching Instagram and TikTok posts; classifies their formats; and shows who posted, who outperformed their follower count, and what to brief next. Find untagged posts through captions, speech, on-screen text, and optional product-image matching.

The first milestone is a working hackathon demo. Complete the text-based campaign flow before adding visual matching, then finish the visual path to support the full product described in `idea.md`. Authentication, billing, scheduled monitoring, and sending messages to creators are outside this release. Nudge/rehire are recommendations only.

## Current state

Reviewed baseline: commit `5b7c1d4`.

- `scripts/fetch_videos.py` is a working fetch draft, limited to one page and missing the campaign end-date filter.
- `docs/oriane-openapi.json` documents the API; the repository includes helper scripts for authenticated requests.
- The Rare Beauty fixture contains 9 listed creators, 16 posts, 8 creators with matching posts, 7 untagged posts, and 16,854,570 views. Colby Odonis has no matching post in the fixture.
- All 16 format labels are unset, and one Instagram post lacks a URL.
- No classifier, metrics module, web API, or dashboard is implemented yet.

The separate `oriane-api/search.py` starter verifies connectivity and basic pagination. Integrate useful behavior into this repository's campaign fetcher instead of maintaining two competing pipelines.

## Architecture and ownership

Keep the four data stages independently runnable through JSON files. Add a thin Python API to orchestrate them and a web dashboard that reads the same `board.json` contract. Proposed implementation: Python 3.11 + FastAPI, React + Vite + TypeScript, and Claude for format classification, following the existing project direction. Treat Lovable as optional final polish after the integrated app works.

```
campaign.json ──► [1 Fetch] ──► videos.json ──► [2 Classify] ──► videos.labeled.json ──► [3 Metrics] ──► board.json ──► [4 Board UI]
```

| Part | Reads | Writes | Starts from |
|------|-------|--------|-------------|
| 1. Fetch | `campaign.json` | `videos.json` | `scripts/fetch_videos.py` (working draft) |
| 2. Classify formats | `videos.json` | `videos.labeled.json` | `fixtures/videos.json` |
| 3. Board metrics | `campaign.json` + `videos.labeled.json` | `board.json` | `fixtures/` (treat `format: null` as `"unclassified"` until Part 2 lands) |
| 4. Board UI | `board.json` | the app | the board generated from the fixtures by Part 3 |

For a four-person team, assign one owner to each part. The fetch owner also owns API orchestration; the UI owner owns deployment integration. For one builder, follow the milestone order below. Freeze shared contracts before working independently.

## Milestones in execution order

### 1. Freeze contracts and make the fixture board reproducible

Deliverables:
- Preserve the JSON contracts below and validate campaign inputs: nonempty brand aliases, supported platforms, normalized creator handles, valid start/end dates, and no duplicate creator identities.
- Define campaign dates as inclusive calendar dates in UTC: start at 00:00 UTC and end at the next day's 00:00 UTC, exclusive. Translate this into the API's documented date comparisons and verify boundary records locally.
- Implement pure metrics functions and a CLI that builds `board.json` from the fixtures. Until classification lands, display `format: null` as `unclassified`.
- Add `.env.example` placeholders for Oriane and classifier credentials, dependency manifests, and setup commands. Keep secrets on the server and out of Git.

Acceptance:
- One documented command generates the same board without API calls.
- The fixture board reports 16 posts, 16,854,570 views, 8/9 creators posted, and 7 untagged posts.
- Colby Odonis receives `quiet` / `nudge`; there is no format winner while every post is unclassified.

### 2. Build a usable dashboard against that board

Deliverables:
- A clearly labeled sample campaign loads immediately.
- Summary cards, creator table, format comparison, and video feed render from generated `board.json`.
- A campaign setup form collects brand aliases, brand handles, brief, dates, creator/platform pairs, and optional product images.
- Loading, empty, partial, and error states are designed before live requests are connected.

Acceptance:
- A user can inspect the sample campaign and understand who to nudge and which posts matched without opening JSON.
- Unknown metrics are displayed as unavailable. Missing formats do not appear as real classifications.
- Every video shows its match evidence and whether it was tagged. The Instagram fallback is clearly labeled as a profile link when no post link is available.

### 3. Complete live retrieval and classification

These two workstreams can proceed independently after Milestone 1.

Fetch deliverables:
- Refactor the fetch script into an importable function plus CLI; accept campaign input and return the shared video shape.
- Page through all matches, deduplicate by content ID, enforce both date boundaries, and retain exact `(platform, normalized handle)` membership checks.
- Remove the hardcoded Rare Beauty tagging rule. Derive all matching from campaign aliases and platform-specific brand handles.
- Preserve the evidence behind caption, transcript, on-screen-text, and mention matches. Process all relevant media entries rather than silently taking only the first.
- Add request timeouts, bounded retries for transient failures, clear authentication/credit errors, and configurable request/result budgets. When a budget or error stops a run, report it as partial.

Classifier deliverables:
- Classify captions, transcripts, on-screen text, and optional sampled frames into the agreed format list.
- Validate `{format, confidence, reason}`. Treat social content as untrusted data rather than instructions.
- Cache by content ID plus an input/prompt/model version, use bounded concurrency, and keep failed classifications as unclassified with a visible status.
- Use `other` for valid content outside the taxonomy, not for request failures.

Acceptance:
- A controlled multipage response yields every unique video exactly once, including the first and final pages.
- Missing transcripts, null metrics, mixed-case handles, and date boundaries are covered by focused tests.
- A manually reviewed sample includes several distinct formats and no invalid labels or invented evidence.
- A failed classifier request does not discard fetched videos or prevent a usable board.

### 4. Connect the complete live flow

Deliverables:
- A backend starts an analysis, exposes fetch/classify/metrics progress, and returns the resulting board. Long runs must not depend on one browser request remaining open.
- Store each run's campaign, fetched videos, labeled videos, and board under a unique run ID. Write completed artifacts atomically and keep the last successful result available if a later run fails.
- Store run status, completeness, warnings, and timestamps alongside the existing data contracts. Show this metadata in the UI; preserve the `board.json` schema below.
- Add a run action and a separate explicit refresh action. Loading or navigating the dashboard must not automatically repeat paid API calls.

Acceptance:
- Entering a campaign produces the same totals and recommendations through CLI and web paths.
- Refreshing the page retains the selected run; repeated status reads do not trigger new analyses.
- A partial retrieval is visibly marked. Creator absence is described as "no matching posts found"; quiet/nudge conclusions are suppressed while retrieval is incomplete.
- Live data and sample data are visibly distinguished, with their retrieval timestamps.

### 5. Complete product-image matching

Deliverables:
- Upload supplied product images through Oriane's asset API and run visual searches constrained to the same creators and dates.
- Preserve each visual search's `aiSearchAnchor` across its later offset pages.
- Union text and visual results by content ID and combine match reasons.
- Calibrate a similarity threshold using manually reviewed matches and nonmatches. Expose visual evidence for review rather than presenting every similar image as confirmed brand use.

Acceptance:
- A controlled example with no brand tag or text match is found through the image path, with reviewable evidence.
- A post found through both text and image searches is counted once and retains both match reasons.
- Campaigns without product images continue to work through the text path. If visual retrieval fails, the UI clearly reports that coverage limitation.

### 6. Verify, deploy, and rehearse

Deliverables:
- Run the focused data tests, frontend build, and an end-to-end sample flow.
- Perform one bounded live campaign run to verify credentials and integration without unnecessary repeated API charges.
- Deploy the API and dashboard with server-side secrets, restricted CORS, and durable storage for run artifacts/cache. If the demo is publicly accessible, protect paid analysis actions with an access gate and request limits.
- Add a README with local setup, fixture mode, live mode, environment variables, deployment steps, and known limitations.
- Preserve a known-good Rare Beauty result for an explicitly labeled offline demo if external services fail.

Acceptance:
- The deployed app opens from a fresh browser, finishes an authorized analysis, and retains the result after a refresh.
- No API keys are present in browser bundles, network responses, or committed files.
- The demo shows an untagged mention, a creator with no matching posts, an overperformer, and a format comparison backed by actual labeled results. Only call a format a winner when it satisfies the rule below.
- Rehearse a short story: campaign input → missing mentions found → creator decisions → next creative brief.

## Priority and fallback

- **Demo gate:** Milestones 1–4 and 6. If time runs short, use the real saved fixture with a sample-data label and omit unfinished controls. Never fabricate a winning format or a live result.
- **Full feature gate:** Milestone 5 plus a deployed visual search check. The full "shows the product without saying or tagging it" promise depends on this work.
- **After the demo:** Saved multi-user campaigns, authentication, scheduled refreshes, stronger campaign attribution review, creator messaging, and longer-term monitoring.

Do not spend the integration window on cosmetic polish or secondary features. First obtain a reproducible fixture board, then a complete live text run, then the visual path and deployment checks.

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
              "creatorsPosted": 8, "creatorsTotal": 9, "untaggedVideos": 7, "untaggedViews": 0 },
  "creators": [{ "name": "…", "handles": {}, "status": "posted | quiet", "videos": 0, "views": 0,
                 "followers": 0, "bestViewsPerFollowerPct": 0, "lastPostedAt": "…",
                 "overperformer": true, "recommendation": "rehire | nudge | keep" }],
  "formats": [{ "format": "grwm", "videos": 0, "views": 0, "avgViewsPerFollowerPct": 0,
                "avgEngagementPerViewPct": 0, "winner": true }],
  "videos": [ "…videos.labeled.json entries, sorted by views…" ]
}
```

---

## Implementation details by part

### Part 1: Fetch (Oriane → `videos.json`)

- Use `limit` up to 100 and `offset`; advance using the returned page, stop at exhaustion, and detect a repeated page rather than looping forever.
- Preserve raw responses for diagnosis without logging credentials. Keep the normalized video contract separate from provider-specific fields.
- Construct Instagram post URLs when a usable platform ID is available; otherwise provide a clearly labeled profile fallback. The current fixture has one missing Instagram URL.
- `matchedBy` records observed evidence. Do not mark a post `visual` solely because it was included in a mixed text/visual result set.
- Match brand tags by normalized handles and platform, not loose caption substrings that can confuse similarly named accounts.

API notes: auth is `Authorization: Bearer <key>`, and `operator` is required on every query. Use `includesExactly` for brand names; `includesFuzzy` matches loose words. Use `projection=full` to get transcripts. Instagram carousels have `views: null`. Spec: `docs/oriane-openapi.json`.

### Part 2: Classify formats (`videos.json` → `videos.labeled.json`)

- Use caption, transcript, `onScreenText`, and optionally 2–3 representative `frameUrls`.
- Handle missing speech/text by falling back to remaining evidence. Bound input sizes, concurrency, and retries.
- Return one allowed format plus confidence from 0–1 and a short evidence-based reason. Provide rubric examples for overlapping classes such as GRWM versus tutorial and haul versus unboxing.
- Record latency and provider failures during the live check; tune concurrency from measurements rather than promising a fixed throughput.

### Part 3: Board metrics (`campaign.json` + `videos.labeled.json` → `board.json`)
Pure functions with no API calls, so they're easy to test on the fixtures.
- Totals across unique videos; untagged count and views (`tagged: false`).
- Per creator: join on `(platform, normalized handle)` and count a creator with both platforms only once. `quiet` means no matching videos in a completed retrieval window.
- `overperformer`: best video has views ≥ followers (`viewsPerFollowerPct >= 100`); require valid positive follower data.
- `recommendation`: quiet → `nudge`, overperformer → `rehire`, else `keep`. Label these as performance heuristics.
- Per format: count, views, average views/follower, average engagement/view. `winner` = highest average views/follower among classified formats with ≥ 2 valid ratio observations. Allow no winner; use a documented deterministic tie-break.
- Skip `null` metrics in averages instead of counting them as zero. Guard zero denominators. Sum known counts and indicate unavailable metrics in the UI.
- Do not add follower counts across a creator's platforms as if they were a deduplicated audience. For the scalar creator `followers` field, use the maximum observed account count and label it accordingly; keep ratios attached to their original post/account.

### Part 4: Board UI (`board.json` → app)

- Setup screen: brand, aliases, handles, brief, date window, creator list with explicit platform selection, optional product images.
- Totals row: views, posts, creators posted out of total, untagged mentions found.
- Creator table: matching-post status, views, views/follower, overperformer badge, and nudge/rehire recommendation.
- Format chart: average views/follower by format, sample counts, and an eligible winner. Avoid calling a low-sample difference conclusive.
- Video feed: thumbnail, creator, views, format/confidence, link, and an untagged badge with evidence such as speech or on-screen text.
- Keep layout usable on desktop and mobile; provide accessible labels, keyboard controls, and readable loading/error states.

## Release checklist

- [ ] Fixture metrics match the verified baseline.
- [ ] Live text fetch paginates and obeys creators and date boundaries.
- [ ] Format labels are valid, reviewable, cached, and resilient to failed requests.
- [ ] Campaign → fetch → classify → metrics → dashboard works end to end.
- [ ] Partial runs and sample mode are clearly marked.
- [ ] Visual-only evidence is demonstrated before claiming visual product detection is complete.
- [ ] Deployed secrets, access to paid actions, refresh behavior, and persistence are verified.
- [ ] README setup and demo steps work from a fresh checkout.
- [ ] Final demo is rehearsed with a saved fallback.
