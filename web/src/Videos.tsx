import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, Eye, Heart, MessageCircle, Mic, ScanText, Tag, TextQuote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { compact, cx, date, fmtMeta, mult, pct, secs } from "./lib";
import type { Board, Format, Video } from "./types";
import { Avatar, FormatChip, Meter, Modal, Pill } from "./ui";
import { CandidateList } from "./SearchStatus";

type Sort = "match" | "views" | "vpf" | "recent";

/** Human "why it matched" for untagged videos. */
export function whyMatched(v: Video): { icon: typeof Mic; text: string }[] {
  const out: { icon: typeof Mic; text: string }[] = [];
  const said = v.brandMoments?.find((m) => m.source === "transcript");
  const shown = v.brandMoments?.find((m) => m.source === "onScreenText");
  if (said) out.push({ icon: Mic, text: `Said it at ${secs(said.atSeconds)}` });
  else if (v.matchedBy.includes("transcript")) out.push({ icon: Mic, text: "Said it" });
  if (shown) out.push({ icon: ScanText, text: `On screen at ${secs(shown.atSeconds)}` });
  else if (v.matchedBy.includes("onScreenText")) out.push({ icon: ScanText, text: "Shown on screen" });
  if (v.matchedBy.includes("visual")) out.push({ icon: Eye, text: "Visual similarity" });
  if (v.matchedBy.includes("caption") && !v.tagged) out.push({ icon: TextQuote, text: "Named in caption" });
  return out;
}

export default function Videos({ board, initial }: { board: Board; initial: { creator?: string; untagged?: boolean } }) {
  const [format, setFormat] = useState<Format | "all">("all");
  const [tagFilter, setTagFilter] = useState<"all" | "tagged" | "untagged">(initial.untagged ? "untagged" : "all");
  const [creator, setCreator] = useState<string | "all">(initial.creator ?? "all");
  const [sort, setSort] = useState<Sort>("match");
  const [open, setOpen] = useState<Video | null>(null);

  const creatorHandles = useMemo(() => {
    const c = board.creators.find((x) => x.name === creator);
    return c ? Object.values(c.handles).filter(Boolean).map((h) => h!.toLowerCase()) : null;
  }, [creator, board]);

  const vids = board.videos
    .filter((v) => format === "all" || v.format === format)
    .filter((v) => tagFilter === "all" || (tagFilter === "tagged" ? v.tagged : !v.tagged))
    .filter((v) => !creatorHandles || creatorHandles.includes(v.creatorHandle.toLowerCase()))
    .sort((a, b) => (sort === "match" ? (b.searchScore ?? 0) - (a.searchScore ?? 0) || (b.views ?? -1) - (a.views ?? -1) : sort === "views" ? (b.views ?? -1) - (a.views ?? -1) : sort === "vpf" ? (b.viewsPerFollowerPct ?? -1) - (a.viewsPerFollowerPct ?? -1) : b.publishedAt.localeCompare(a.publishedAt)));
  const formats = [...new Set(board.videos.map((v) => v.format as Format))];

  return (
    <div>
      {/* Filters: one row */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <Seg value={tagFilter} onChange={setTagFilter} options={[["all", "All"], ["untagged", `Untagged · ${board.totals.untaggedVideos}`], ["tagged", "Tagged"]]} />
        <select value={creator} onChange={(e) => setCreator(e.target.value)} className="field !w-auto !py-2 !text-xs cursor-pointer">
          <option value="all">All creators</option>
          {board.creators.filter((c) => c.videos).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setFormat("all")} className={cx("rounded-full px-2.5 py-1 text-xs ring-1 ring-inset cursor-pointer transition", format === "all" ? "bg-white/10 ring-white/25 text-white" : "ring-white/10 text-mute hover:text-soft")}>All formats</button>
          {formats.map((f) => (
            <button key={f} onClick={() => setFormat(f)} className={cx("rounded-full cursor-pointer transition", format === f ? "opacity-100" : "opacity-55 hover:opacity-90")}><FormatChip format={f} size="xs" /></button>
          ))}
        </div>
        <div className="ml-auto"><Seg value={sort} onChange={setSort} options={[["match", "Best match"], ["views", "Most views"], ["vpf", "× followers"], ["recent", "Newest"]]} /></div>
      </div>
      {!board.search?.algorithm && <p className="text-xs text-mute mb-4">This saved or sample board has no search scores. Run a live refresh to compare Best match with Most views.</p>}

      <motion.div layout className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        <AnimatePresence mode="popLayout">
          {vids.map((v) => <VideoCard key={v.id} v={v} onOpen={() => setOpen(v)} />)}
        </AnimatePresence>
      </motion.div>
      {!vids.length && <div className="text-center text-mute py-20">No videos match these filters.</div>}
      <CandidateList candidates={board.candidates ?? []} />
      <VideoModal v={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex gap-1 rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/[0.06]">
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} className={cx("rounded-lg px-3 py-1.5 text-xs cursor-pointer transition whitespace-nowrap", value === k ? "bg-white/[0.09] text-white" : "text-mute hover:text-soft")}>{label}</button>
      ))}
    </div>
  );
}

function VideoCard({ v, onOpen }: { v: Video; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  const [frame, setFrame] = useState(0);
  const frames = [v.thumbnailUrl, ...v.frameUrls].filter(Boolean) as string[];
  useEffect(() => {
    if (!hover || frames.length < 2) return setFrame(0);
    const t = setInterval(() => setFrame((f) => (f + 1) % frames.length), 650);
    return () => clearInterval(t);
  }, [hover, frames.length]);
  const why = whyMatched(v);
  return (
    <motion.button
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileHover={{ y: -4 }}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      onClick={onOpen}
      className="group text-left cursor-pointer"
    >
      <div className="relative aspect-[9/16] rounded-2xl overflow-hidden bg-panel-2 ring-1 ring-white/10 group-hover:ring-white/25 transition">
        {frames[frame] && <img src={frames[frame]} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-black/30" />
        <div className="absolute top-2.5 inset-x-2.5 flex items-start justify-between gap-1">
          <FormatChip format={v.format} size="xs" />
          <span className="rounded-md bg-black/50 backdrop-blur px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-soft">{v.platform === "tiktok" ? "TikTok" : "IG"}</span>
        </div>
        {hover && frames.length > 1 && (
          <div className="absolute top-10 inset-x-2.5 flex gap-0.5">
            {frames.map((_, i) => <div key={i} className={cx("h-0.5 flex-1 rounded-full", i <= frame ? "bg-white" : "bg-white/25")} />)}
          </div>
        )}
        <div className="absolute bottom-0 inset-x-0 p-3">
          {!v.tagged && (
            <div className="mb-2 flex flex-wrap gap-1">
              <Pill tone="amber"><Tag size={10} /> Untagged</Pill>
              {why.slice(0, 1).map((w, i) => <Pill key={i} tone="neutral" className="!bg-black/50 backdrop-blur"><w.icon size={10} /> {w.text}</Pill>)}
            </div>
          )}
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-xl font-semibold leading-none tracking-tight">{compact(v.views)}</div>
              <div className="text-[11px] text-soft/80 mt-1">{v.views == null ? "views unavailable" : "views"}</div>
            </div>
            {v.viewsPerFollowerPct != null && (
              <div className={cx("text-right text-xs font-mono", v.viewsPerFollowerPct >= 100 ? "text-amber" : "text-soft/80")}>{mult(v.viewsPerFollowerPct)}<div className="text-[10px] text-mute font-sans">followers</div></div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 px-0.5">
        <Avatar src={v.profilePictureUrl} name={v.creatorName ?? v.creatorHandle} size={22} />
        <span className="text-xs text-soft truncate">@{v.creatorHandle}</span>
        <span className="ml-auto text-[11px] text-mute">{date(v.publishedAt)}</span>
      </div>
      {v.searchScore != null && <div className="mt-1 px-0.5 text-[11px] text-mute">Match score {v.searchScore.toFixed(3)}</div>}
    </motion.button>
  );
}

function VideoModal({ v, onClose }: { v: Video | null; onClose: () => void }) {
  if (!v) return <Modal open={false} onClose={onClose}>{null}</Modal>;
  const dur = v.durationSeconds ?? Math.max(10, ...(v.brandMoments ?? []).map((m) => m.atSeconds + 2));
  const m = fmtMeta(v.format);
  return (
    <Modal open={!!v} onClose={onClose} title={<span className="flex items-center gap-2"><Avatar src={v.profilePictureUrl} name={v.creatorHandle} size={28} /> @{v.creatorHandle}</span>}>
      <div className="flex gap-1.5 overflow-x-auto scroll-thin pb-2 mb-4">
        {[v.thumbnailUrl, ...v.frameUrls].filter(Boolean).map((u, i) => <img key={i} src={u!} alt="" className="h-36 aspect-[9/16] rounded-lg object-cover ring-1 ring-white/10 shrink-0" />)}
      </div>
      <div className="grid grid-cols-4 gap-2 mb-4 text-center">
        {[[Eye, compact(v.views)], [Heart, compact(v.likes)], [MessageCircle, compact(v.comments)], [Eye, mult(v.viewsPerFollowerPct) + " fol."]].map(([I, val], i) => {
          const Icon = I as typeof Eye;
          return <div key={i} className="rounded-xl bg-white/[0.04] py-2"><Icon size={13} className="mx-auto text-mute mb-1" /><div className="text-sm font-mono">{val as string}</div></div>;
        })}
      </div>

      <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06] p-3 mb-4">
        {v.searchScore != null && <div className="text-sm text-soft mb-3">Match score {v.searchScore.toFixed(3)} · {v.relevanceReason}</div>}
        <div className="flex items-center justify-between mb-2">
          <FormatChip format={v.format} />
          {v.formatConfidence != null && <span className="text-[11px] text-mute">{pct(v.formatConfidence * 100)} confident</span>}
        </div>
        <div className="text-sm text-soft">{v.formatReason}</div>
        {v.productVisible != null && <div className="mt-2 text-xs text-mute">Product visible in frames: <span className={v.productVisible ? "text-mint" : "text-soft"}>{v.productVisible ? "yes" : "no"}</span></div>}
      </div>

      {!!v.brandMoments?.length && (
        <div className="mb-4">
          <div className="text-xs text-mute mb-2">Brand moments</div>
          <div className="relative h-7 rounded-lg bg-white/[0.04] mb-2">
            <div className="absolute inset-y-0 left-0 rounded-l-lg bg-mint/10" style={{ width: `${Math.min(100, (3 / dur) * 100)}%` }} title="First 3 seconds" />
            {v.brandMoments.map((bm, i) => (
              <div key={i} className="absolute top-1 bottom-1 w-1.5 rounded-full -translate-x-1/2" style={{ left: `${Math.min(98, (bm.atSeconds / dur) * 100)}%`, background: bm.source === "transcript" ? m.color : "#f0efec" }} title={`${secs(bm.atSeconds)} ${bm.text}`} />
            ))}
          </div>
          <div className="space-y-1.5 max-h-32 overflow-auto scroll-thin">
            {v.brandMoments.slice(0, 5).map((bm, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="font-mono text-mute w-9 shrink-0">{secs(bm.atSeconds)}</span>
                {bm.source === "transcript" ? <Mic size={12} className="shrink-0 mt-0.5 text-mute" /> : <ScanText size={12} className="shrink-0 mt-0.5 text-mute" />}
                <span className="text-soft">“{bm.text}”</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {v.signals?.hook && (
        <div className="mb-4 rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06] p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-mute">Hook</span>
            <span className="text-[11px] text-mute">{v.signals.hookType.replace("_", " ")} · product {v.signals.productProminence} · creator {v.signals.sentiment}</span>
          </div>
          <div className="font-serif italic text-lg text-white leading-snug">“{v.signals.hook}”</div>
          {!!v.signals.claims.length && (
            <ul className="mt-2 space-y-1">
              {v.signals.claims.map((c, i) => <li key={i} className="flex gap-2 text-xs text-soft"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/40" />{c}</li>)}
            </ul>
          )}
        </div>
      )}

      {v.sentiment && (
        <div className="mb-4 rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06] p-3">
          <div className="text-xs text-mute mb-2">What the comments say</div>
          <div className="text-sm text-soft mb-3">{v.sentiment.summary}</div>
          <div className="grid grid-cols-2 gap-3 text-[11px] text-mute">
            <div>Sentiment <Meter value={(v.sentiment.score + 1) / 2} color="#199e70" className="mt-1" /></div>
            <div>Purchase intent <Meter value={v.sentiment.purchaseIntent} color="#c98500" className="mt-1" /></div>
          </div>
          {v.sentiment.topQuote && <div className="mt-3 border-l-2 border-rose/50 pl-3 text-sm italic text-soft">“{v.sentiment.topQuote}”</div>}
        </div>
      )}

      {v.caption && <div className="text-xs text-mute leading-relaxed mb-4 line-clamp-4">{v.caption}</div>}
      {v.url && (
        <a href={v.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-white hover:underline">
          Open on {v.platform === "tiktok" ? "TikTok" : "Instagram"} <ExternalLink size={14} />
        </a>
      )}
    </Modal>
  );
}

