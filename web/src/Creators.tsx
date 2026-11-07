import { motion } from "motion/react";
import { Bell, Check, Copy, Crown, Film, ThumbsUp, UserPlus } from "lucide-react";
import { useState } from "react";
import { api, compact, cx, date, mult, pct, secs } from "./lib";
import type { Board, CreatorRow } from "./types";
import { Avatar, Button, Card, Meter, Modal, Pill, SectionTitle, Spinner } from "./ui";

export default function Creators({ board, goVideos }: { board: Board; goVideos: (f: { creator?: string }) => void }) {
  const [draftFor, setDraftFor] = useState<CreatorRow | null>(null);
  const [filter, setFilter] = useState<"all" | CreatorRow["recommendation"]>("all");
  const rows = board.creators.filter((c) => filter === "all" || c.recommendation === filter);
  const counts = { all: board.creators.length, rehire: 0, recruit: 0, nudge: 0, keep: 0 } as Record<string, number>;
  board.creators.forEach((c) => counts[c.recommendation]++);
  // Recruits only exist when the board was built with discovery on.
  const filters = (["all", "rehire", "recruit", "nudge", "keep"] as const).filter((f) => f !== "recruit" || counts.recruit);

  return (
    <div>
      <SectionTitle
        eyebrow="Roster"
        title={`${board.totals.creatorsPosted} of ${board.totals.creatorsTotal} creators posted`}
        right={
          <div className="flex rounded-[9px] bg-fill p-0.5">
            {filters.map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cx("relative rounded-[7px] px-3 py-1 text-[13px] capitalize cursor-pointer", filter === f ? "text-fg font-medium" : "text-soft hover:text-fg")}>
                {filter === f && <motion.div layoutId="cf" transition={{ duration: 0.25 }} className="absolute inset-0 rounded-[7px] bg-segment shadow-[0_1px_3px_rgb(0_0_0/0.12)]" />}
                <span className="relative">{f} <span className="text-mute">{counts[f]}</span></span>
              </button>
            ))}
          </div>
        }
      />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-sm min-w-[980px]">
            <thead>
              <tr className="text-left text-[12px] text-mute border-b border-line">
                <th className="px-5 py-3 font-medium">Creator</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium text-right">Videos</th>
                <th className="px-3 py-3 font-medium text-right">Views</th>
                <th className="px-3 py-3 font-medium text-right" title="Best video's views as a multiple of follower count">Best × followers</th>
                <th className="px-3 py-3 font-medium text-right">Engagement</th>
                <th className="px-3 py-3 font-medium w-40" title="Comment sentiment and purchase intent, read by the LLM">Audience</th>
                <th className="px-3 py-3 font-medium text-right" title="Average time into the video before the brand is said or shown">Brand at</th>
                <th className="px-3 py-3 font-medium text-right" title="Posts in the window that never mention the brand">Off-brief</th>
                <th className="px-5 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <motion.tr key={c.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="border-b border-line/60 last:border-0 hover:bg-fill/60 transition">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar src={c.profilePictureUrl} name={c.name} />
                      <div className="min-w-0">
                        <div className="font-medium flex items-center gap-1.5">{c.name} {c.overperformer && <Crown size={13} className="text-amber" />}</div>
                        <div className="text-xs text-mute truncate">
                          {Object.entries(c.handles).filter(([, h]) => h).map(([p, h]) => `${p === "tiktok" ? "TT" : "IG"} @${h}`).join(" · ")}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {c.status === "posted" ? <Pill tone="mint">Posted</Pill> : <Pill tone="neutral">Quiet</Pill>}
                    {c.lastPostedAt && <div className="text-[11px] text-mute mt-1">last {date(c.lastPostedAt)}</div>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{c.videos}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{compact(c.views)}</td>
                  <td className="px-3 py-3 text-right">
                    <span className={cx("tabular-nums", c.overperformer ? "text-fg font-semibold" : "text-soft")}>{c.status === "quiet" ? "—" : mult(c.bestViewsPerFollowerPct)}</span>
                    {(c.followers ?? 0) > 0 && <div className="text-[11px] text-mute">{compact(c.followers)} followers</div>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-soft">{pct(c.avgEngagementPerViewPct, 1)}</td>
                  <td className="px-3 py-3">
                    {c.sentimentScore != null ? (
                      <div className="space-y-1.5" title={`Sentiment ${Math.round((c.sentimentScore + 1) * 50)}/100 · purchase intent ${Math.round((c.purchaseIntent ?? 0) * 100)}%`}>
                        <div className="flex items-center gap-2"><span className="w-12 text-[10px] text-mute">Love</span><Meter value={(c.sentimentScore + 1) / 2} color="var(--green)" className="flex-1" /></div>
                        <div className="flex items-center gap-2"><span className="w-12 text-[10px] text-mute">Want it</span><Meter value={c.purchaseIntent} color="var(--orange)" className="flex-1" /></div>
                      </div>
                    ) : <span className="text-mute text-xs">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-soft">
                    <span className={cx(c.avgFirstMentionSeconds != null && c.avgFirstMentionSeconds > 30 && "text-rose")}>{secs(c.avgFirstMentionSeconds)}</span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-soft">{c.offBriefPosts || "—"}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1.5">
                      {c.videos > 0 && <Button variant="ghost" className="!p-2" onClick={() => goVideos({ creator: c.name })}><Film size={15} /></Button>}
                      <RecButton c={c} onClick={() => setDraftFor(c)} />
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-3 text-xs text-mute">
        Rehire = best video beat the creator's follower count. Nudge = no campaign video in the window. Brand in <span className="text-rose">red</span> = mentioned after 30s, when most viewers have already scrolled away.
      </p>
      <DraftModal board={board} creator={draftFor} onClose={() => setDraftFor(null)} />
    </div>
  );
}

function RecButton({ c, onClick }: { c: CreatorRow; onClick: () => void }) {
  const map = {
    rehire: { label: "Rehire", icon: Crown, cls: "bg-amber/12 text-amber hover:bg-amber/20" },
    recruit: { label: "Recruit", icon: UserPlus, cls: "bg-mint/12 text-mint hover:bg-mint/20" },
    nudge: { label: "Nudge", icon: Bell, cls: "bg-rose/12 text-rose hover:bg-rose/20" },
    keep: { label: "Thank", icon: ThumbsUp, cls: "bg-fill text-fg hover:bg-fill-2" },
  }[c.recommendation];
  return (
    <button onClick={onClick} className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium transition cursor-pointer", map.cls)}>
      <map.icon size={13} /> {map.label}
    </button>
  );
}

function DraftModal({ board, creator, onClose }: { board: Board; creator: CreatorRow | null; onClose: () => void }) {
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [forName, setForName] = useState<string | null>(null);
  if (creator && forName !== creator.name) {
    setForName(creator.name);
    setDraft(null);
    setErr(null);
    api.draft(board.campaign.id, creator.name).then(setDraft).catch((e) => setErr(e.message));
  }
  const copy = () => {
    if (!draft) return;
    navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Modal open={!!creator} onClose={() => { setForName(null); onClose(); }} title={creator && <span>{{ nudge: "Nudge", rehire: "Rehire", recruit: "Recruit", keep: "Thank" }[creator.recommendation]} {creator.name}</span>}>
      {err ? <div className="text-sm text-rose">{err}</div> : !draft ? (
        <div className="flex items-center gap-2 text-sm text-soft py-8 justify-center"><Spinner /> Drafting from their campaign data…</div>
      ) : (
        <div>
          <div className="text-xs text-mute mb-1">Subject</div>
          <input className="field mb-3" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          <div className="text-xs text-mute mb-1">Message</div>
          <textarea className="field min-h-48 leading-relaxed" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setForName(null); }}>Regenerate</Button>
            <Button onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy message"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
