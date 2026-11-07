import { ExternalLink, Mail, RefreshCw, Tag, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { api, compact, mult, type DiscoveryResult } from "./lib";
import type { Board } from "./types";
import { Avatar, Button, Card, Pill, SectionTitle, Shimmer } from "./ui";
import { CandidateList, SearchStatus } from "./SearchStatus";

export default function Discover({ board }: { board: Board }) {
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const list = result?.prospects;
  const [err, setErr] = useState<string | null>(null);
  const load = (refresh = false) => {
    setResult(null);
    setErr(null);
    api.discover(board.campaign.id, refresh).then(setResult).catch((e) => setErr(e.message));
  };
  useEffect(() => load(), [board.campaign.id]);

  return (
    <div>
      <SectionTitle
        eyebrow="Discover"
        title={<>Creators already talking about {board.campaign.brandName}, not on your roster</>}
        right={<Button variant="ghost" className="!py-1.5 text-xs" onClick={() => load(true)}><RefreshCw size={14} /> Rescan</Button>}
      />
      <p className="text-sm text-mute -mt-2 mb-6 max-w-2xl">
        Creators with accepted brand matches from the ranked search shortlist, ordered by how far their video outran their follower count. Review their content before deciding whom to recruit.
      </p>
      {result && <SearchStatus search={result.search} candidates={result.candidates} />}
      {err && <div className="text-rose text-sm">{err}</div>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {!list && !err && Array.from({ length: 6 }, (_, i) => <Shimmer key={i} className="h-44" />)}
        {list?.map((p, i) => (
          <Card key={`${p.platform}:${p.handle}`} className="p-4 flex gap-4" delay={i * 0.04}>
            <a href={p.topVideo.url ?? undefined} target="_blank" rel="noreferrer" className="relative w-24 shrink-0 aspect-[9/16] rounded-[12px] overflow-hidden bg-panel-2 text-white group">
              {p.topVideo.thumbnailUrl && <img src={p.topVideo.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover group-hover:scale-105 transition duration-500" />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <div className="absolute bottom-1.5 left-2 text-sm font-semibold">{compact(p.topVideo.views)}</div>
              <ExternalLink size={12} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition" />
            </a>
            <div className="min-w-0 flex-1 flex flex-col">
              <div className="flex items-center gap-2">
                <Avatar src={p.profilePictureUrl} name={p.displayName ?? p.handle} size={30} />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{p.displayName ?? p.handle}</div>
                  <div className="text-[11px] text-mute truncate">{p.platform === "tiktok" ? "TikTok" : "IG"} @{p.handle}</div>
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-3">
                <div><span className="text-lg font-semibold tabular-nums">{mult(p.bestViewsPerFollowerPct)}</span> <span className="text-[11px] text-mute">followers</span></div>
                <div className="text-xs text-mute">{compact(p.followers)} fol.</div>
              </div>
              {p.bio && <div className="mt-1.5 text-[11px] text-mute line-clamp-2">{p.bio}</div>}
              <div className="mt-auto pt-3 flex flex-wrap items-center gap-1.5">
                {!p.tagged && <Pill tone="amber"><Tag size={10} /> Untagged fan</Pill>}
                {p.publicEmail ? (
                  <a href={`mailto:${p.publicEmail}?subject=${encodeURIComponent(`${board.campaign.brandName} x @${p.handle}`)}`} className="inline-flex items-center gap-1 rounded-full bg-mint/12 px-2 py-0.5 text-[11px] font-medium text-mint ring-inset hover:bg-mint/20">
                    <Mail size={10} /> Email
                  </a>
                ) : (
                  <a href={p.platform === "tiktok" ? `https://www.tiktok.com/@${p.handle}` : `https://www.instagram.com/${p.handle}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-fill px-2 py-0.5 text-[11px] text-soft hover:bg-fill">
                    <UserPlus size={10} /> DM
                  </a>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
      {list && !list.length && <div className="text-center text-mute py-16">No accepted prospects in this search.</div>}
      {result && <CandidateList candidates={result.candidates} />}
    </div>
  );
}

