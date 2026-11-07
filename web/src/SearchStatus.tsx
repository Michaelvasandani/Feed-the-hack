import type { SearchMetadata, Video } from "./types";

export function SearchStatus({ search, candidates = [] }: { search?: SearchMetadata; candidates?: Video[] }) {
  if (!search?.algorithm && !candidates.length) return null;
  return (
    <div className="mb-6 rounded-[16px] surface p-4 text-sm text-soft space-y-2" role="status">
      <p>Ranked campaign matches · totals include selected, accepted videos only.</p>
      {search?.partial && <p className="text-amber">Search coverage is partial. More matching videos may exist in pages we could not retrieve.</p>}
      {search?.rosterComplete === false && <p className="text-amber">Roster coverage is incomplete. Missing creators remain unknown and recommendations are withheld.</p>}
      {!!search?.omittedByShortlist && <p>{search.omittedByShortlist} accepted matches were omitted by the shortlist or per-creator limit.</p>}
      {!!candidates.length && <p>{candidates.length} unresolved candidates need review and are excluded from totals.</p>}
    </div>
  );
}

export function CandidateList({ candidates }: { candidates: Video[] }) {
  if (!candidates.length) return null;
  return (
    <details className="mt-6 rounded-[16px] surface p-4">
      <summary className="cursor-pointer text-sm text-amber">Needs review · {candidates.length} candidates excluded from totals</summary>
      <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
        {candidates.map((v) => (
          <div key={v.id} className="text-xs text-soft border-t border-line pt-3">
            <div className="font-medium">@{v.creatorHandle} · {v.platform}</div>
            <p className="my-1">{v.relevanceReason ?? "Brand match is unresolved."}</p>
            {v.matchEvidence?.filter((e) => e.kind === "visual").map((e, i) => (
              <p key={i} className="text-mute">Visual similarity {e.score == null ? "unavailable" : e.score.toFixed(3)}
                {e.matchedFrameUrl && <> · <a href={e.matchedFrameUrl} target="_blank" rel="noreferrer" className="underline">Matched frame</a></>}
              </p>
            ))}
            {v.url && <a href={v.url} target="_blank" rel="noreferrer" className="underline">Review source video ↗</a>}
          </div>
        ))}
      </div>
    </details>
  );
}
