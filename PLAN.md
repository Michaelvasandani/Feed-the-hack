# Project Completion Plan

## Outcome

Ship an agency campaign dashboard that takes a brand, brief, date window, and creator list; finds matching Instagram and TikTok posts; classifies their formats; and shows who posted, who outperformed their follower count, and what to brief next. Find untagged posts through captions, speech, on-screen text, and optional product-image matching.

The first milestone is a working hackathon demo. Complete the text-based campaign flow before adding visual matching, then finish the visual path to support the full product described in `idea.md`. Full user accounts, billing, scheduled monitoring, and sending messages to creators are outside this release; a small demo access gate protects paid actions. Nudge/rehire are recommendations only. Initially, live retrieval admits video content only; static images and carousels are excluded.

## Current state

Reviewed baseline: commit `5b7c1d4`.

- `scripts/fetch_videos.py` is a working fetch draft, limited to one page and missing the campaign end-date filter.
- `docs/oriane-openapi.json` documents the API; the repository includes helper scripts for authenticated requests.
- The Rare Beauty fixture contains 9 listed creators, 16 unique posts, 8 creators represented, 7 records stored as untagged, and 16,854,570 views. Colby Odonis has no matching post in the fixture. These are verified fixture arithmetic, not independent attribution, tagging, content-type, or platform-coverage verification.
- All 16 format labels are unset, and one Instagram post lacks a URL.
- No classifier, metrics module, web API, or dashboard is implemented yet.

The separate `oriane-api/search.py` starter verifies connectivity and basic pagination. Integrate useful behavior into this repository's campaign fetcher instead of maintaining two competing pipelines.

## Architecture and ownership

Keep the four data stages independently runnable through JSON files. Use Python 3.11 + FastAPI, React + Vite + TypeScript, and Claude for classification. Deploy one API/static-web service and one worker on a GMI Cloud Linux VM with a persistent disk, SQLite, and Docker Compose. Verify target access early. Treat Lovable as optional polish after integration.

Two normative documents remove implementation ambiguity:

- [Version-2 pipeline contracts](docs/data-contracts.md): typed envelopes, coverage, classification states, evidence, candidate acceptance, nullable metrics, and fixture migration.
- [Run execution contract](docs/run-execution.md): deployment target, endpoints, persisted queue, idempotency, budgets, worker ownership, and restart recovery.

```
campaign.json ──► [1 Fetch] ──► videos.json ──► [2 Classify] ──► videos.labeled.json ──► [3 Metrics] ──► board.json ──► [4 Board UI]
```

| Part | Reads | Writes | Starts from |
|------|-------|--------|-------------|
| 1. Fetch | `campaign.json` | `videos.json` | `scripts/fetch_videos.py` (working draft) |
| 2. Classify formats | `videos.json` | `videos.labeled.json` | `fixtures/videos.json` |
| 3. Board metrics | `campaign.json` + the complete `videos.labeled.json` envelope, including coverage | `board.json` envelope | adapted `fixtures/` (non-classified statuses display as `unclassified`) |
| 4. Board UI | `board.json` | the app | the board generated from the fixtures by Part 3 |

For a four-person team, assign one owner to each part. The fetch owner also owns API orchestration; the UI owner owns deployment integration. For one builder, follow the milestone order below. Freeze shared contracts before working independently.

## Milestones in execution order

### 1. Freeze contracts and make the fixture board reproducible

Deliverables:
- Implement runtime validators for the version-2 contracts and an explicit legacy-fixture adapter. Include per-account/channel coverage, candidate decisions, classification statuses, nullable metrics, unknown creators, and nullable recommendations before separate components are built.
- Validate normalized aliases and handles, dates, content types, and all request/image limits in the validation section below. Reject oversized inputs before asset creation or other paid calls.
- Send inclusive API bounds `after: "2026-10-01"` and `before: "2026-11-06"` for the fixture window. Locally compare `2026-10-01T00:00:00Z <= publishedAt < 2026-11-07T00:00:00Z`; do not send November 7 as the API's inclusive upper bound.
- Implement pure metrics functions and a CLI that builds the version-2 board from adapted fixtures. Until classification lands, display unclassified with its not-requested status.
- Add `.env.example` placeholders for Oriane and classifier credentials, dependency manifests, and setup commands. Keep secrets on the server and out of Git.
- Verify access to the chosen VM and classifier early with a single bounded check during implementation; record model availability, latency, and cost before committing to live classification in the demo.

Acceptance:
- One documented command generates the same board without API calls.
- The fixture board reports 16 posts, 16,854,570 views, 8/9 creators posted, and 7 untagged posts.
- Colby Odonis receives `quiet` / `nudge` within the explicitly labeled fixture scope; there is no format winner while every post is unclassified.
- A creator whose videos are on an unfetched page is unknown with a null recommendation. A high-view visual candidate cannot affect totals or rehire recommendations. No-evidence and failed classifications remain distinct.

### 2. Build a usable dashboard against that board

Deliverables:
- A clearly labeled sample campaign loads immediately.
- Summary cards, creator table, format comparison, and video feed render from generated `board.json`.
- A campaign setup form collects brand aliases, brand handles, brief, dates, creator/platform pairs, and optional product images.
- Loading, empty, partial, and error states are designed before live requests are connected.

Acceptance:
- A user can inspect the sample campaign and understand who to nudge and which posts matched without opening JSON.
- Unknown metrics are displayed as unavailable. Missing formats do not appear as real classifications.
- Every video shows available match evidence and tagging state, including unknown. Fixture-only annotations are labeled. The Instagram fallback is clearly labeled as a profile link when no post link is available.

### 3. Complete live retrieval and classification

These two workstreams can proceed independently after Milestone 1.

Fetch deliverables:
- Refactor the fetch script into an importable function plus CLI; accept campaign input and return the shared video shape.
- Page through all matches, advance offsets by the raw API page size before local filtering/deduplication, enforce both date boundaries, and retain exact `(platform, normalized handle)` membership checks.
- Require `format.includes: ["video"]` on every live text/visual query and preserve provider type as `contentFormat`, separately from creative classification.
- Remove the hardcoded Rare Beauty tagging rule. Derive all matching from campaign aliases and platform-specific brand handles.
- Normalize aliases and searched text identically, preserve original excerpts, and apply the explicit phrase/handle boundary rules in the data contract. Retain unresolved provider/local-evidence mismatches as candidates.
- Preserve the evidence behind caption, transcript, on-screen-text, and mention matches. Process all relevant media entries rather than silently taking only the first.
- Add request timeouts, bounded retries for transient failures, clear authentication/credit errors, and configurable request/result budgets. When a budget or error stops a run, report it as partial.

Classifier deliverables:
- Classify captions, transcripts, on-screen text, and optional sampled frames into the agreed format list.
- Validate model output and populate the typed `classification` object. Treat social content as untrusted data rather than instructions.
- Cache by content ID plus an input/prompt/model version, use bounded concurrency, and keep failed classifications as unclassified with a visible status.
- No usable evidence means `no_evidence` and null format without a model call. Use `other` only for valid content outside the taxonomy; request failures remain failed/unclassified.

Acceptance:
- A controlled multipage response yields every unique video exactly once, including the first and final pages.
- Missing transcripts, null metrics, mixed-case handles and aliases, phrase boundaries, excluded static/carousel content, raw-page offsets, request limits, and inclusive API/exclusive local date boundaries are covered by focused tests.
- A manually reviewed sample includes several distinct formats and no invalid labels or invented evidence.
- A failed classifier request does not discard fetched videos or prevent a usable board.

### 4. Connect the complete live flow

Deliverables:
- Implement the endpoints and single-worker persisted queue in [the execution contract](docs/run-execution.md). Idempotent start requests enqueue work; status/result reads make no paid calls.
- Store versioned artifacts and SQLite state on a persistent disk, with atomic artifact publication, ownership tokens, heartbeat/lease checks, and interrupted-run recovery. Keep the last published result available during a refresh/review rebuild.
- Carry typed metadata inside every artifact envelope; metrics and the UI receive exactly the same coverage snapshot. Validate classification counters and run/result state consistency.
- Add a run action and a separate explicit refresh action. Loading or navigating the dashboard must not automatically repeat paid API calls.

Acceptance:
- Entering a campaign produces the same totals and recommendations through CLI and web paths.
- Refreshing the page retains the selected run; repeated status reads do not trigger new analyses.
- A partial retrieval is visibly marked. A creator with no accepted post is unknown until requested coverage completes and candidate review is resolved. Recommendations stay null when the creator's coverage or accepted evidence is insufficient.
- Live data and sample data are visibly distinguished, with their retrieval timestamps.
- Repeated submissions enqueue once; worker crashes become interrupted, preserve checkpoints, and never silently replay paid calls. Validate stale-owner fencing and persistence after container restarts.

### 5. Complete product-image matching

Deliverables:
- Upload supplied product images through Oriane's asset API and run visual searches constrained to the same creators and dates.
- Preserve each visual search's `aiSearchAnchor` across its later offset pages.
- Union text and visual results by content ID and combine structured evidence, preserving query/asset identity and any supplied score or matched frame.
- Keep visual-only hits in a separate candidate review queue. Thresholds rank candidates; explicit review accepts or rejects them. Accepted text+visual duplicates count once. Review decisions are audited and trigger a versioned rebuild without refetching Oriane.

Acceptance:
- A controlled example with no brand tag or text match is found through the image path, inspected and accepted, and only then contributes to totals. An unresolved or rejected visual candidate contributes nothing.
- A post found through both text and image searches is counted once and retains both match reasons.
- Campaigns without product images continue to work through the text path. If visual retrieval fails, the UI clearly reports that coverage limitation.

### 6. Verify, deploy, and rehearse

Deliverables:
- Run the focused data tests, frontend build, and an end-to-end sample flow.
- Perform one bounded live campaign run to verify credentials and integration without unnecessary repeated API charges.
- Deploy the selected single-VM API/worker design with HTTPS, same-origin frontend, durable disk, server-side secrets, a demo access gate, request budgets, and the documented recovery checks.
- Add a README with local setup, fixture mode, live mode, environment variables, deployment steps, and known limitations.
- Preserve a known-good Rare Beauty result for an explicitly labeled offline demo if external services fail.

Acceptance:
- The deployed app opens from a fresh browser, finishes an authorized analysis, and retains the result after a refresh.
- No API keys are present in browser bundles, network responses, or committed files.
- The demo shows an untagged mention, a creator with no matching posts, an overperformer, and a format comparison backed by actual labeled results. Only call a format a winner when it satisfies the rule below.
- Rehearse a short story: campaign input → missing mentions found → creator decisions → next creative brief.

## Priority and fallback

- **Live text-demo gate:** Milestones 1–4 and 6. Full live retrieval, classification, integration, and deployment must actually pass before calling this gate complete.
- **Fixture-demo fallback:** Offline metrics and dashboard over the saved sample, with a sample-data label, unavailable features omitted, and live/deployment milestones explicitly incomplete. Never fabricate a winning format or a live result.
- **Full feature gate:** Milestone 5 plus a deployed visual search check. The full "shows the product without saying or tagging it" promise depends on this work.
- **After the demo:** Saved multi-user campaigns, authentication, scheduled refreshes, stronger campaign attribution review, creator messaging, and longer-term monitoring.

Do not spend the integration window on cosmetic polish or secondary features. First obtain a reproducible fixture board, then a complete live text run, then the visual path and deployment checks.

For the 3:42 PM handoff and 5:30 PM demo schedule, budget the remaining 108 minutes as follows. These are stop points, not promises that the whole scope fits:

| Time | Checkpoint / stop decision |
|---|---|
| 3:42–3:52 | Freeze contracts; verify classifier and VM access. If unavailable, choose fixture-demo fallback immediately. |
| 3:52–4:25 | Produce the fixture board/UI while fetch and classification owners complete their bounded paths. Solo: prioritize fixture metrics and UI. |
| 4:25–4:55 | Integrate one live text run only if independent paths work. Otherwise freeze the fixture demo. |
| 4:55–5:10 | Attempt deployment only with a working local flow and available target. Visual matching is deferred unless live text and deployment already pass. |
| 5:10–5:30 | Freeze features, verify the saved fallback, and rehearse. Record remaining full-feature work explicitly. |

If implementation starts later, shorten feature scope rather than cutting the rehearsal/fallback window. A solo builder should treat the fixture demo as the realistic target unless a working integrated application already exists.

## Shared contracts

The authoritative type definitions and behavior are in [docs/data-contracts.md](docs/data-contracts.md). Generated artifacts use `{schemaVersion: 2, meta, data}`. This is an intentional migration from the existing fixtures, not a promise of compatibility with the draft fetcher's current output.

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

`videos.json` and `videos.labeled.json` share the `Artifact<VideoData>` shape. Classification updates each accepted video's `classification` object and the envelope summary; no-evidence and failures retain null creative formats.

`board.json` is `Artifact<BoardData>`. Accepted videos affect metrics; candidates are separate; completeness and classification states travel inside the same artifact. Nullable metrics include observation counts so a partial known sum cannot masquerade as a complete measurement.

## Request validation before paid work

- Build the exact request first and count all filter-value occurrences across every query level, including aliases repeated in caption/transcript/on-screen-text filters, handles, platforms, and content-type constraints. Enforce the documented 500-value maximum; count scalar bounds conservatively too. Reject oversized campaigns with field-specific errors; automatic batching is outside the demo scope.
- Use only a root query plus one nested group, within the API's maximum two-level nesting. Disallow deeper user-supplied query structures.
- Enforce at most 10 visual-similarity values across all query levels and at most 10 input images. Initial visual queries each use one asset to preserve attribution. Pagination is supported; oversized input batching is not.
- Accept only JPEG, PNG, or WebP, at most 20 MiB of decoded bytes per image. Validate actual bytes and type before asset creation. For HTTPS URL inputs, verify scheme, public destination (including redirects), and a bounded download before upload; reject private/local addresses and unverifiable images. Client-side hints alone are insufficient validation.
- The [execution contract](docs/run-execution.md) specifies separate request, asset, record, model-attempt, and queue budgets. Repeated pages and retries consume budgets. Exceeding an input limit is a preflight error; exhausting a run budget publishes partial coverage and a warning.
- Required boundary checks: 500/501 aggregate values, permitted/excess query nesting, 10/11 visual values, exactly 20 MiB/one byte over, allowed/unsupported media types, and oversized decoded base64. Oversized inputs must result in zero paid requests.

---

## Implementation details by part

### Part 1: Fetch (Oriane → `videos.json`)

- Use `limit` up to 100 and `offset`; advance by raw returned records before local filtering/deduplication. Stop on validated exhaustion and detect repeated pages rather than looping forever. Offset stability and exhaustion edge cases still require a bounded live check.
- Preserve raw responses for diagnosis without logging credentials. Keep the normalized video contract separate from provider-specific fields.
- Construct Instagram post URLs when a usable platform ID is available; otherwise provide a clearly labeled profile fallback. The current fixture has one missing Instagram URL.
- Structured `evidence` records observed match provenance. Do not assign visual evidence solely because a record appeared in a mixed query. Missing verifiable evidence leaves a candidate.
- Match brand tags by normalized handles and platform, not loose caption substrings that can confuse similarly named accounts.

API notes: `operator` is required at each query level. `includesExactly` requests exact phrases; `includesFuzzy` matches words in any order, including partial words. `projection=default` includes transcripts; `full` adds useful frame/transcript-chunk detail. Views can be null generally. Both API date bounds are inclusive; date-only end bounds expand through 23:59:59.999Z. Bearer authentication worked in the earlier live check but is absent from the checked-in spec's security definitions. Spec: `docs/oriane-openapi.json`.

Still requiring later live verification: stable pagination/exhaustion and the precise meaning of HTTP 206; visual anchor continuity, score/frame evidence availability, and threshold usefulness; mention/tag coverage; tokenizer parity; and classifier access, latency, and cost. A previous HTTP 206 response returned usable data, but its exact provider semantics are not established by this spec. Index exhaustion is not proof of exhaustive social-platform coverage.

### Part 2: Classify formats (`videos.json` → `videos.labeled.json`)

- Use caption, transcript, `onScreenText`, and optionally 2–3 representative `frameUrls`.
- Handle missing speech/text by falling back to remaining evidence. Bound input sizes, concurrency, and retries.
- Return one allowed format plus confidence from 0–1 and an evidence-based reason only on classified results. Otherwise preserve the typed non-classified state and null label. Provide rubric examples for GRWM versus tutorial and haul versus unboxing.
- Record latency and provider failures during the live check; tune concurrency from measurements rather than promising a fixed throughput.

### Part 3: Board metrics (`campaign.json` + `videos.labeled.json` → `board.json`)
Pure functions with no API calls, so they're easy to test on the fixtures.
- Read retrieval coverage and classification status from the labeled envelope. Use the normative [board-state rules](docs/data-contracts.md#board-metrics-and-unknown-states).
- Count unique accepted videos only; unresolved/rejected candidates cannot inflate totals, overperformance, or format statistics. Count only explicit `tagged: false` as untagged, and report unknown tags separately.
- Join on `(platform, normalized handle)` and count a creator across platforms once. Zero accepted posts with unfinished coverage or unresolved candidates means unknown, with null recommendation.
- Compute observed overperformance only with valid positive followers. Recommendations remain null where coverage, candidate review, or required performance data is insufficient.
- Format winners require complete coverage, resolved candidates, completed eligible classification, and ≥ 2 valid ratio observations. Resolve equal averages lexicographically; allow no winner.
- Skip null metrics in averages, guard zero denominators, and carry known/expected observation counts in sums. All-unknown metrics remain null.
- Do not add follower counts across a creator's platforms as if they were a deduplicated audience. For the scalar creator `followers` field, use the maximum observed account count and label it accordingly; keep ratios attached to their original post/account.

### Part 4: Board UI (`board.json` → app)

- Setup screen: brand, aliases, handles, brief, date window, creator list with explicit platform selection, optional product images.
- Totals row: views, posts, creators posted out of total, untagged mentions found.
- Creator table: matching-post status, views, views/follower, overperformer badge, and nudge/rehire recommendation.
- Format chart: average views/follower by format, sample counts, and an eligible winner. Avoid calling a low-sample difference conclusive.
- Video feed: accepted-post thumbnail, creator, views, classification/status, link, and observed tagging/evidence. Provide a separate candidate review queue with available asset/score/frame evidence and an audited accept/reject action.
- Keep layout usable on desktop and mobile; provide accessible labels, keyboard controls, and readable loading/error states.

## Release checklist

- [ ] Fixture metrics match the verified baseline.
- [ ] Version-2 validators and fixture migration preserve honest unknown/partial states.
- [ ] An unfetched creator page cannot produce quiet/nudge; unresolved visual candidates cannot change campaign totals.
- [ ] Alias/phrase boundaries, video-only eligibility, and API input/image limits are covered by offline boundary checks.
- [ ] Live text fetch paginates and obeys creators and date boundaries.
- [ ] Format labels are valid, reviewable, cached, and resilient to failed requests.
- [ ] Campaign → fetch → classify → metrics → dashboard works end to end.
- [ ] Partial runs and sample mode are clearly marked.
- [ ] Visual-only evidence is demonstrated before claiming visual product detection is complete.
- [ ] Deployed secrets, access to paid actions, refresh behavior, and persistence are verified.
- [ ] Duplicate starts, worker interruption/recovery, stale ownership, and review rebuilds satisfy the execution contract.
- [ ] README setup and demo steps work from a fresh checkout.
- [ ] Final demo is rehearsed with a saved fallback.
