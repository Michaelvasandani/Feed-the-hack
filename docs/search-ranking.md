# Video retrieval and ranking

Implemented in `app/fetch.py`, `app/relevance.py`, and `app/search.py`. This improves the existing application using additive fields; it does not implement the entire version-2 artifact/worker plan.

## Retrieval

The previous discovery path fetched one view-count-sorted list and truncated it before relevance filtering. The new path retrieves a larger, bounded pool from independent lists on **each platform**:

| List | Provider sort | Fusion weight |
|---|---|---|
| Brand aliases in transcript/caption/on-screen text, plus known brand handles | Transcript relevance, then views | 1.0 |
| The same brand criteria, recent posts | Published date | 0.7 |
| Exact configured brand handles, when supplied | Views | 1.2 |
| One product image per query, when supplied | Visual similarity | 0.8 divided across supplied images |

Roster retrieval runs separately before discovery, scoped to the exact platform/handle pairs. Roster records are retained independently of the final discovery shortlist, and their retrieval lists do not add a ranking boost merely for being hired. All live queries require provider content format `video`; local checks also enforce format, platform, UTC date window, brand-account exclusions, and configured excluded handles.

Default discovery retrieves up to `min(2000, 3 * maxVideos)` raw records, raised to at least one per list for tiny shortlists and divided across lists. Platforms are interleaved when distributing leftover budget. `discovery.maxCandidates` overrides that pool cap (1–2000); `maxVideos` remains the final discovered-video limit. A search has at most 40 search requests, at most 20 pages per list, and at most 10 image assets. A fixed per-list allocation may underfill when lists overlap or return no matches; the app does not claim exhaustive coverage or automatically spend additional requests to fill the shortlist.

Pagination advances by raw page length, before local filtering/deduplication. Missing total counts no longer stop after one page. Repeated pages, changing totals, exhausted budgets, missing/changing visual anchors, and failed streams produce explicit partial-coverage reports. Anchors are URL-encoded and kept within their own query. Other successful streams remain usable when one fails. Both API date bounds are inclusive, followed by local UTC date checks.

## Fusion and verification

For each unique content ID, weighted reciprocal rank fusion computes:

```text
RRF(video) = sum(weight(list) / (60 + rank(video, list)))
```

Each video contributes at most once per list. This combines ordinal ranks without pretending transcript, visual, or popularity scores share a numerical scale. Reference images share a total visual weight to avoid multiplying influence through near-identical images. See [Elastic's RRF reference](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion).

Before a video can affect totals:

- Exact brand-handle tags are checked by platform; `@brand_fan` is not `@brand`.
- Aliases and text use Unicode NFKC, casefolding, whitespace normalization, and phrase boundaries. Compound brand hashtags are supported. Evidence is collected across all returned media entries.
- Untagged posts, including roster posts, use the configured Jev/Claude brand verifier when available. Scores ≥ 0.7 are accepted, ≤ 0.3 rejected, and the middle range remains a candidate. These are initial decision thresholds, not calibrated probabilities of campaign membership.
- Model errors, invalid scores, and ambiguous matches remain candidates outside totals. Visual-only matches always require source inspection; similarity alone cannot accept them. The UI provides candidate links, but an audited accept/reject workflow is still future work.
- Without a model, a multi-word brand phrase can pass the deterministic check. A single-word brand needs nearby description/brief context. This fallback is deliberately conservative but cannot reliably distinguish every homonym; the UI labels the evidence reason.
- At most 200 uncached model verifications run per request, prioritizing fused retrieval scores. Remaining records use the deterministic evidence fallback. Cached decisions include brand configuration, brief, video text, backend, model, and prompt version, so edits invalidate stale scores. Errors are never cached as successful decisions.

## Final ranking and diversity

Verified matches receive:

```text
searchScore = 0.60 * brandEvidence
            + 0.25 * normalizedRRF
            + 0.10 * normalizedBM25BriefFit
            + 0.05 * smoothedEngagement
```

BM25 runs locally against the campaign description/brief, using caption, transcript, and on-screen text (`k1=1.2`, `b=0.75`). Scores are normalized by the maximum in the verified pool. Engagement uses `(likes + comments + shares + 3) / (views + 100)`, capped at a 10% rate, to reduce the influence of tiny denominators. Missing/zero views contribute no engagement boost. Raw views break ties rather than dominating the ranking. These weights are a transparent starting configuration, not evidence of a universally best algorithm.

The final discovery shortlist defaults to three videos per `(platform, creatorHandle)`, configurable through `discovery.maxPerCreator`. All accepted roster videos survive the discovery cap. The board preserves best-match order and offers a separate most-viewed sort. Unresolved candidates are listed separately, and incomplete roster coverage prevents quiet/nudge conclusions. Totals describe the selected verified results; omitted verified matches and partial retrieval are disclosed.

## Integration with Feedboard

The React Videos tab defaults to **Best match** and offers **Most views** for comparison. Cards display the ranking score; details show the acceptance reason. The board exposes partial coverage, shortlist omissions, and unresolved candidates. Old saved boards and offline fixtures have no ranking scores; run a live refresh to populate them.

The pipeline is `fetch → verify relevance → rank → classify → metrics → insights`. Brand moments, profile details, comments, timelines, and Michael's intelligence layer are retained. Missing creators remain unknown when retrieval is incomplete or their matches are unresolved. Recommendations and outreach drafts are withheld for those creators. Offline sample runs force keyword classification, heuristic signals, and rule insights even with model keys configured.

The Discover tab uses the same hybrid retrieval, verification, and shortlist policy, excludes hired platform/handle pairs, then orders the accepted prospects by views per follower. `/api/boards/{id}/discover` now returns `{prospects, search, candidates}`; cached arrays from the previous implementation are refreshed automatically.

Optional roster activity searches run after campaign retrieval using the remaining shared 40-request budget, with at most one 100-record page per roster platform. They deduplicate records and enforce platform, video format, and dates. Incomplete activity makes `offBriefPosts` null rather than asserting zero.

## Validation and limits

- Offline tests cover exact phrase/tag boundaries, common-word ambiguity, duplicate fusion, date/content constraints, missing totals, repeated pages, raw offsets, anchors, request limits, candidate exclusion, cache invalidation, verification budgets, diversity, ranking preservation, and offline sample mode.
- Integration validation: 67 Python tests pass, including retained intelligence evidence, activity budgets, prospect acceptance, and the complete live pipeline with mocked retrieval. The React production build and server-render checks pass. ESLint has no errors and retains three existing hook/fast-refresh warnings. No paid provider calls were made for this integration.
- A five-record adversarial regression set improves precision@3 from 1/3 under view-count sorting to 3/3 after evidence filtering/ranking. This is a regression check, not a general relevance benchmark.
- A bounded live Rare Beauty check executed six text/recent/tag queries, fetched 12 raw records / 11 unique candidates, and returned three ranked matches without a classifier API call. Visual pagination and model quality were tested with controlled responses; they still need a labeled live evaluation.
- Next tuning step: label 50–100 results across multi-word brands, common-word brands, and visual-only products. Compare precision@10, recall within the judged candidate pool, unique creators@10, latency, and cost against the original view-count baseline before changing weights or thresholds.
