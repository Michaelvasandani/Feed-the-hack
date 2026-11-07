# Claude handoff: include the search algorithm in the PR

Repository: `Michaelvasandani/Feed-the-hack`

Algorithm commit: `9e0f738` — `Improve video discovery with hybrid retrieval and relevance ranking`

Source branch: `plan/project-completion`

## Integration instructions

1. Fetch origin and inspect the intended PR branch and its current changes. This algorithm commit builds on Michael's `ce9adb6` campaign/discovery implementation. Preserve subsequent work on the PR branch.
2. If the algorithm is not already included, apply **commit `9e0f738`**, normally with `git cherry-pick 9e0f738` on the PR's head branch. Resolve conflicts by integrating the behaviors below. Do not replace newer files wholesale. The source branch also contains planning documents; merging that entire branch is unnecessary when only the algorithm is wanted.
3. Include all files from the algorithm commit. `app/search.py` alone is insufficient: retrieval, relevance filtering, server wiring, metrics, UI, tests, and the algorithm documentation work together.
4. Keep the live pipeline in this order: `fetch_videos → filter_relevant → rank_videos → classify_videos → build_board`. Preserve `searchScore`, `searchSignals`, candidates, and search coverage through the board response. Default to best-match ordering; offer most-viewed as a separate UI sort.
5. Run `.venv/bin/python -m pytest -q`; the source commit passes 52 tests. Check the inline JavaScript syntax and the sample dashboard. Keep sample mode offline even when model keys are configured. Do not make additional paid API calls solely to repeat the supplied smoke test.
6. Update the existing PR, or create the intended PR if none exists. Include the algorithm explicitly in its title/description, list validation, and link the source commit. Do not merge the PR automatically. Return the PR URL and the integration commit SHA.

## Behaviors the PR must preserve

- Per-platform transcript-relevance, recent-post, brand-tag, and optional visual retrieval; larger bounded candidate pool; exact creator/platform and video/date constraints.
- Weighted reciprocal rank fusion (`k=60`), followed by brand verification, BM25 brief-fit ranking, smoothed engagement, and creator diversity limits.
- Exact normalized phrase/handle evidence, including all media entries. Brand lookalikes, uncertain model outcomes, and visual-only candidates remain separate from verified totals.
- Correct raw offsets, independent URL-encoded visual anchors, duplicate/repeated-page handling, request limits, and visible partial coverage.
- Versioned relevance cache, a 200-uncached-verification cap, preserved roster posts, and unknown/null recommendations when coverage is incomplete.

## PR description facts

Previously, discovery fetched a view-count-sorted list and truncated it before relevance filtering. It now combines independent candidate lists and prioritizes verified brand relevance and campaign fit, with a separate most-viewed option.

Validation: 52 tests passed at `9e0f738`; Python compilation and JavaScript syntax checks passed. Six bounded live text/recent/tag requests fetched 12 raw records / 11 unique candidates and returned a ranked shortlist. No classifier API call was used in that smoke check. Visual/model quality still needs a labeled live evaluation; do not claim a general accuracy improvement from the small synthetic regression example.

Implementation detail: `docs/search-ranking.md` describes the shipped algorithm. `docs/data-contracts.md` and `docs/run-execution.md` describe a broader future design; this commit does not implement that entire migration or worker architecture.
