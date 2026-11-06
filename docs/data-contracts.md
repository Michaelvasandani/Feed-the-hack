# Pipeline contracts, version 2

These are the normative contracts for the planned implementation. The existing fixtures and fetch script still use the legacy shape; add an explicit fixture adapter in Milestone 1. TypeScript notation below specifies JSON fields, unions, and nullability. Implement equivalent runtime validation in Python and the UI before independent work begins. Fields are required unless marked optional; enum alternatives are actual values, not pipe-delimited strings.

## Common envelope and coverage

`campaign.json` keeps its existing input shape. Every generated artifact uses `Artifact<T>`: `videos.json` and `videos.labeled.json` use `VideoData`, and `board.json` uses `BoardData`. Metrics reads the entire labeled artifact, including `meta`, plus the campaign. The UI receives the entire board artifact. Coverage must not be supplied through an implicit side channel.

```ts
type Platform = "instagram" | "tiktok";
type Channel = "text" | "visual";
type CoverageStatus = "pending" | "complete" | "partial" | "failed";
type StageStatus = "not_requested" | "pending" | "complete" | "partial" | "failed";
type RunState = "queued" | "running" | "succeeded" | "partial" | "failed" | "interrupted";
type Warning = { code: string; message: string; queryId: string | null };
type Coverage = {
  platform: Platform;
  creatorHandle: string;
  channel: Channel;
  queryIds: string[];
  status: CoverageStatus;
  rawRecordsFetched: number;
  reason: string | null;
};
type ClassificationSummary = {
  status: StageStatus;
  total: number;
  notRequested: number;
  pending: number;
  classified: number;
  noEvidence: number;
  failed: number;
};
type PipelineMeta = {
  runId: string;
  resultRevision: number;
  campaignId: string;
  source: "live" | "fixture";
  createdAt: string;
  updatedAt: string;
  fetchedAt: string | null;
  runState: RunState;
  retrieval: {
    scope: "oriane_index" | "fixture";
    requestedChannels: Channel[];
    status: CoverageStatus;
    coverage: Coverage[];
  };
  classification: ClassificationSummary;
  warnings: Warning[];
};
type Artifact<T> = { schemaVersion: 2; meta: PipelineMeta; data: T };
```

- Times are ISO-8601 UTC strings. Counts are nonnegative integers; all numerical values must be finite. Convert legacy millisecond timestamps at the adapter boundary.
- Create coverage rows for every requested `(platform, creatorHandle, channel)` before the first request, including creators who return zero records. Missing rows are a validation error, never evidence of completeness.
- A row is `complete` only after every planned query/page for that account/channel is exhausted. `partial` means some usable pages but unfinished retrieval; `failed` means no usable result from a required query; `pending` means work remains. Global coverage is complete only when every row is complete; mixed terminal outcomes are partial, all failed is failed, and outstanding work is pending.
- `complete` means the planned queries exhausted the available Oriane index, not exhaustive coverage of Instagram or TikTok. Record changing totals, repeated pages, missing required anchors, and unexpected pagination behavior as warnings and partial coverage.
- No images means `requestedChannels: ["text"]`; visual coverage was not requested. Failed requested visual searches must remain visible and prevent complete coverage for their accounts.
- Classification summary counters partition **accepted** videos and must sum to `total`. Before classification, all are `notRequested`; while work remains, summary status is pending. All terminal classified/no-evidence results mean complete, a mixture with failures means partial, and all failed means failed. Zero accepted videos is complete with zero counters. Candidates are not sent to the classifier until accepted.
- Each stage preserves provenance and retrieval coverage, updates its own counters, and writes a new validated snapshot. `resultRevision` is a positive integer, shared by the artifacts for one initial build or review rebuild. Status exposes both current work state and the last published revision/state; an older published board retains its own immutable state while a newer revision is running. When no newer work is active, status and the latest board must agree.

## Video, creative classification, and match evidence

```ts
type CreativeFormat = "unboxing" | "grwm" | "review" | "haul" |
  "tutorial" | "gift_guide" | "day_in_life" | "other";
type Classification =
  | { status: "classified"; format: CreativeFormat; confidence: number;
      reason: string; errorCode: null }
  | { status: "not_requested" | "pending" | "no_evidence" | "failed";
      format: null; confidence: null; reason: string | null;
      errorCode: string | null };
type TextEvidence = {
  kind: "caption" | "transcript" | "onScreenText";
  queryId: string;
  alias: string;
  excerpt: string;
  mediaIndex: number | null;
  normalizationVersion: "nfkc-casefold-whitespace-v1";
};
type MentionEvidence = {
  kind: "mention";
  queryId: string;
  platform: Platform;
  handle: string;
  source: "provider_mention" | "caption_handle_token";
};
type VisualEvidence = {
  kind: "visual";
  queryId: string;
  assetId: string;
  score: number | null;
  matchedFrameUrl: string | null;
  matchedFrameTimeSeconds: number | null;
};
type Evidence = TextEvidence | MentionEvidence | VisualEvidence;
type Review = {
  decision: "accept" | "reject";
  reviewerId: string;
  reviewedAt: string;
  reason: string;
};
type Video = {
  id: string;
  platform: Platform;
  contentFormat: "video" | "image" | "carousel" | "unknown";
  creatorHandle: string;
  publishedAt: string;
  url: string | null;
  urlKind: "post" | "profile" | null;
  caption: string | null;
  transcript: string | null;
  onScreenText: string[] | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  frameUrls: string[];
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  followers: number | null;
  viewsPerFollowerPct: number | null;
  engagementPerViewPct: number | null;
  tagged: boolean | null;
  taggingBasis: "observed" | "unknown" | "fixture";
  evidence: Evidence[];
  match: {
    status: "accepted" | "candidate" | "rejected";
    basis: "text" | "review" | "fixture" | null;
    review: Review | null;
  };
  classification: Classification;
};
type VideoData = { videos: Video[] };
```

### Content eligibility and acceptance

1. All live text and visual requests include `format.includes: ["video"]`. Locally validate the provider's `format`, dates, and exact platform/creator pair. Images, carousels, and missing live content types cannot enter accepted totals. Preserve provider content type as `contentFormat`; creative labels live under `classification.format`.
2. Within that scope, a locally verified alias phrase or exact platform-specific brand handle is accepted under `basis: "text"`. This means it meets the configured campaign-matching criteria, not proof that the agency commissioned it or that it followed the brief. The UI calls these matching posts. An explicit reviewer rejection overrides automatic acceptance.
3. Visual-only hits begin as candidates. Similarity scores can rank candidates, but no score threshold alone accepts them for this release. A reviewer must inspect an available matched frame or the source video, record a reason, and accept or reject. If the media cannot be inspected, the hit remains a candidate.
4. Preserve asset ID, query ID, and any provider-returned score/frame evidence. Use one product asset per visual query initially so asset attribution is unambiguous. Do not substitute a generic thumbnail or sampled frame for a provider-identified matched frame. Missing provider evidence stays null and is called out in review.
5. Deduplicate by provider content ID and merge evidence. Text acceptance can admit a text+visual hit without a visual review; count it once. A later review is audited, increments the run's result revision, and rebuilds classification/metrics as needed without another Oriane fetch.
6. `videos.json` preserves accepted, candidate, and rejected scoped records. Metrics counts only accepted records. The board exposes candidates separately for review; rejected records remain in the audit artifact. Unresolved candidates for a creator suppress that creator's recommendations, and unresolved candidates anywhere suppress a format winner.
7. `tagged: true` requires observed matching mention/handle evidence. `false` means no matching tag was found in the returned caption/mention fields after checking them; it does not prove complete platform tagging coverage. Missing usable tagging fields produce null/unknown. Only explicit false values count as untagged; report unknown-tag counts separately.

### Evidence matching and classification semantics

- Normalize both aliases and searched text using Unicode NFKC, casefolding, and collapsed whitespace. Preserve original aliases and original excerpts for display. Empty normalized aliases are invalid.
- An alias phrase must occur contiguously in normalized text, with neither adjacent character a Unicode letter, number, mark, or underscore. Thus `Rare Beauty` matches `I love RARE BEAUTY!` but not `Rare Beautyness`; `rare` must not match `rarely`. Preserve punctuation inside the phrase; alternate punctuation forms require explicit aliases. Exact handle tokens use platform handle boundaries instead of this phrase rule.
- This is the local acceptance rule. Oriane documents exact phrases but not full tokenizer/case/punctuation parity. Keep provider hits lacking verifiable local evidence as candidates for review and record the mismatch; do not silently invent evidence or claim parity.
- No usable caption, transcript, on-screen text, or inspectable frame means `classification.status: "no_evidence"`, with null format/confidence and a reason. Do not call the model. The UI displays "unclassified" for every non-classified state and its separate status.
- `other` is a successful classification for usable evidence outside the taxonomy. Provider failures or invalid structured output become failed after bounded retries; pending and not-requested remain distinct. Confidence is in `[0,1]`, and errors are sanitized codes/messages rather than credentials or raw provider payloads.
- The v2 contract replaces legacy `format`, `formatConfidence`, `formatReason`, and `matchedBy`. Derive badges from `evidence` and `classification`; do not maintain competing mutable sources of truth.

## Board metrics and unknown states

```ts
type SumMetric = { value: number | null; observed: number; expected: number };
type CreatorBoard = {
  name: string;
  handles: Partial<Record<Platform, string>>;
  coverage: "complete" | "incomplete";
  status: "posted" | "quiet" | "unknown";
  videos: number;
  candidateVideos: number;
  views: SumMetric;
  followers: number | null;
  bestViewsPerFollowerPct: number | null;
  lastPostedAt: string | null;
  overperformer: boolean | null;
  recommendation: "rehire" | "nudge" | "keep" | null;
};
type FormatBoard = {
  format: CreativeFormat;
  videos: number;
  views: SumMetric;
  avgViewsPerFollowerPct: number | null;
  viewsPerFollowerSamples: number;
  avgEngagementPerViewPct: number | null;
  engagementPerViewSamples: number;
  winner: boolean;
};
type BoardData = {
  campaign: { id: string; brandName: string; window: { start: string; end: string } };
  totals: {
    videos: number; views: SumMetric; likes: SumMetric;
    comments: SumMetric; shares: SumMetric;
    creatorsPosted: number; creatorsTotal: number; creatorsUnknown: number;
    untaggedVideos: number; untaggedViews: SumMetric; unknownTagVideos: number;
    candidateVideos: number; rejectedVideos: number;
  };
  creators: CreatorBoard[];
  formats: FormatBoard[];
  unclassifiedVideos: number;
  videos: Video[];
  candidates: Video[];
};
```

- For a sum, `expected` is the number of accepted records in that group and `observed` is the number with non-null values. Sum known values, with `value: null` if expected > 0 and observed = 0; an empty group is `{value: 0, observed: 0, expected: 0}`. Show partial-observation labels when observed < expected, in addition to any retrieval warning. Averages use known valid ratios only and are null with zero observations.
- Creator coverage is complete only when every requested account/channel row for that creator is complete. One accepted post means posted, even during incomplete retrieval. Zero accepted posts means quiet only with complete coverage and zero unresolved candidates; otherwise unknown.
- Recommendations are null for incomplete creator coverage, unresolved creator candidates, or posted creators with no valid ratio. Otherwise quiet → nudge; posted with an observed ratio ≥ 100 → rehire; posted with all observed valid ratios below 100 → keep. Describe these as performance heuristics. `overperformer` is null without any valid ratio, true with any ≥ 100, and false otherwise.
- Use positive follower/view denominators. `followers` on a creator is the maximum known account count, labeled as such, not a sum of overlapping audiences. A creator appearing on both platforms counts once.
- `board.data.videos` contains accepted records sorted by known views descending (null last, then ID for ties); candidates are separate and never affect totals, creator performance, or format averages.
- No format winner while retrieval is incomplete, candidates remain, or accepted classifications are pending/failed/not-requested. `no_evidence` records stay unclassified and their count is visible. Among eligible classified formats with ≥ 2 valid views/follower observations, highest average wins; ties resolve lexicographically by format. No eligible format means no winner.

## Legacy fixture adapter and required examples

Do not rewrite the original fixtures to imply independent verification. A fixture-only adapter wraps the saved records with `source: "fixture"`, `scope: "fixture"`, accepted/fixture match basis, stored tagging values with fixture basis, and not-requested classification. Preserve existing URLs and text. Because the legacy fixture discarded provider content type and precise evidence provenance, use `contentFormat: "unknown"` and an empty structured evidence array rather than inventing them; permit this only in fixture mode. Legacy match labels may be shown as clearly labeled fixture annotations outside computed evidence.

Coverage rows may be complete **within the saved fixture** for all listed accounts; include a warning that this is not a verified live index crawl. This preserves the arithmetic baseline: 16 accepted fixture records, 16,854,570 known views, 8/9 creators represented, and 7 stored untagged records. It does not verify campaign attribution, content type, tagging accuracy, or platform exhaustiveness.

Milestone 1 must include examples/tests for: a fully fetched zero-result creator; a creator whose records are on an unfetched page (unknown/null recommendation); a posted creator with incomplete coverage (posted/null recommendation); a visual-only candidate with large views excluded from totals; accepted and rejected visual reviews; no classification evidence versus a provider failure; all-null and partially known metrics; and the fixture adapter baseline.
