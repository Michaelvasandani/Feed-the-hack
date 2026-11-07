import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, ArrowUpRight, Bell, Crown, Eye, Film, Heart, MessageCircle, RefreshCw, Sparkles, Telescope, UserPlus, Users, Wand2, X } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Brief from "./Brief";
import Creators from "./Creators";
import Discover from "./Discover";
import { api, compact, cx, date, fmtMeta, mult, pct } from "./lib";
import { Logo } from "./Setup";
import type { Board as BoardT, InsightAction } from "./types";
import { Avatar, Button, Card, CountUp, FormatChip, SectionTitle, Spinner } from "./ui";
import Videos from "./Videos";

const TABS = [
  { key: "overview", label: "Overview", icon: Sparkles },
  { key: "creators", label: "Creators", icon: Users },
  { key: "videos", label: "Videos", icon: Film },
  { key: "discover", label: "Discover", icon: Telescope },
  { key: "brief", label: "Next brief", icon: Wand2 },
] as const;
export type Tab = (typeof TABS)[number]["key"];

export default function Board({ board, onHome, onRerun }: { board: BoardT; onHome: () => void; onRerun: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [videoFilter, setVideoFilter] = useState<{ creator?: string; untagged?: boolean }>({});
  const goVideos = (f: { creator?: string; untagged?: boolean }) => {
    setVideoFilter(f);
    setTab("videos");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-dvh pb-32">
      <header className="sticky top-3 z-40 mx-auto max-w-7xl px-3 sm:px-4">
        <div className="glass glass-blur rounded-full flex justify-between md:grid md:grid-cols-[1fr_auto_1fr] items-center gap-4 h-14 pl-4 pr-2">
          <div className="flex items-center gap-3 min-w-0">
            <Logo onClick={onHome} />
            <div className="hidden lg:block text-[13px] text-mute truncate">
              {board.campaign.brandName} · {date(board.campaign.window.start)} – {date(board.campaign.window.end)}
            </div>
          </div>
          <nav role="tablist" className="hidden md:flex rounded-full bg-black/20 p-1 shadow-[inset_0_1px_2px_rgb(0_0_0/0.3)]">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cx("relative px-4 py-1.5 text-[13px] whitespace-nowrap cursor-pointer rounded-full", tab === t.key ? "text-fg font-medium" : "text-soft hover:text-fg")}>
                {tab === t.key && <motion.div layoutId="tab" transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }} className="absolute inset-0 rounded-full bg-white/18 shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.4),inset_0_0_0_0.5px_rgb(255_255_255/0.2)]" />}
                <span className="relative">{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="flex justify-end">
            <Button variant="ghost" className="!px-3 !py-1.5 !text-[13px]" onClick={onRerun}><RefreshCw size={14} /> <span className="hidden sm:inline">Refresh</span></Button>
          </div>
        </div>
        {/* Compact screens: a scrolling row of the same tabs. */}
        <div className="md:hidden flex gap-1.5 overflow-x-auto [scrollbar-width:none] pt-2 px-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={cx("shrink-0 rounded-full px-3 py-1 text-[13px] cursor-pointer", tab === t.key ? "glass text-fg font-medium" : "bg-black/50 text-soft")}>{t.label}</button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 pt-10">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
            {tab === "overview" && <Overview board={board} setTab={setTab} goVideos={goVideos} />}
            {tab === "creators" && <Creators board={board} goVideos={goVideos} />}
            {tab === "videos" && <Videos board={board} initial={videoFilter} />}
            {tab === "discover" && <Discover board={board} />}
            {tab === "brief" && <Brief board={board} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <AskBar board={board} />
    </div>
  );
}

// ---------------- Overview ----------------

function Overview({ board, setTab, goVideos }: { board: BoardT; setTab: (t: Tab) => void; goVideos: (f: { creator?: string; untagged?: boolean }) => void }) {
  const t = board.totals;
  const win = board.formats.find((f) => f.winner);
  const untaggedShare = t.views ? (t.untaggedViews / t.views) * 100 : 0;
  const rehire = board.creators.filter((c) => c.recommendation === "rehire" || c.recommendation === "recruit");
  const nudge = board.creators.filter((c) => c.recommendation === "nudge");
  const top = board.videos.filter((v) => v.views != null).slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Headline */}
      <section className="pt-2 pb-2">
        <div>
          <div className="text-[13px] font-medium text-mute mb-2">{board.campaign.brandName} · {date(board.campaign.window.start)} – {date(board.campaign.window.end)}</div>
          <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-[-0.03em] leading-[1.1] max-w-4xl [text-shadow:0_2px_24px_rgb(0_0_0/0.5)]">
            <CountUp value={t.views} format={(n) => compact(n)} /> views from {t.videos} videos.{" "}
            {t.untaggedVideos > 0 && (
              <span className="text-white/55">
                {pct(untaggedShare)} came from{" "}
                <button className="text-accent hover:underline underline-offset-4 decoration-2 cursor-pointer" onClick={() => goVideos({ untagged: true })}>
                  {t.untaggedVideos} videos that never tagged you
                </button>
                .
              </span>
            )}
          </h1>
          {win && (
            <p className="mt-4 text-soft text-[17px] leading-relaxed max-w-3xl">
              <FormatChip format={win.format} /> is the format that won: on average its videos reached <b className="text-fg font-semibold">{mult(win.avgViewsPerFollowerPct)}</b> each creator's follower count.{" "}
              <button className="text-accent hover:underline underline-offset-4 cursor-pointer" onClick={() => setTab("brief")}>Brief more of these</button>
            </p>
          )}
        </div>
      </section>

      {board.insights && <InsightsCard board={board} setTab={setTab} />}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Stat icon={Eye} label="Total views" value={t.views} fmt={compact} delay={0.05} />
        <Stat icon={Film} label="Videos found" value={t.videos} fmt={(n) => Math.round(n).toString()} delay={0.1} />
        <Stat icon={Users} label="Creators posted" value={t.creatorsPosted} fmt={(n) => `${Math.round(n)}/${t.creatorsTotal}`} delay={0.15} />
        <Stat icon={Telescope} label="Untagged views found" value={t.untaggedViews} fmt={compact} accent delay={0.2} />
        <Stat icon={Heart} label="Avg engagement" value={t.avgEngagementPerViewPct ?? 0} fmt={(n) => `${n.toFixed(1)}%`} delay={0.25} />
        <Stat icon={MessageCircle} label="Audience sentiment" value={t.avgSentiment == null ? 0 : (t.avgSentiment + 1) * 50} fmt={(n) => `${Math.round(n)}/100`} delay={0.3} />
      </div>

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-6">
        <Card className="p-5 sm:p-6" delay={0.1}>
          <SectionTitle eyebrow="Momentum" title="Views by publish day" />
          <Timeline data={board.timeline} />
        </Card>
        <Card className="p-5 sm:p-6" delay={0.15}>
          <SectionTitle eyebrow="What worked" title="Views ÷ followers, by format" />
          <FormatBars board={board} />
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="p-5 sm:p-6" delay={0.2}>
          <SectionTitle eyebrow="Rehire" title={<span className="flex items-center gap-2">Punched above their follower count</span>} right={<Button variant="ghost" className="!py-1.5 text-xs" onClick={() => setTab("creators")}>All creators <ArrowUpRight size={14} /></Button>} />
          <div className="space-y-2">
            {rehire.slice(0, 5).map((c) => (
              <button key={c.name} onClick={() => goVideos({ creator: c.name })} className="w-full flex items-center gap-3 rounded-xl p-2 hover:bg-fill transition text-left cursor-pointer">
                <Avatar src={c.profilePictureUrl} name={c.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{c.name}</div>
                  <div className="text-xs text-mute">{compact(c.followers)} followers · {c.videos} video{c.videos === 1 ? "" : "s"}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">{mult(c.bestViewsPerFollowerPct)}</div>
                  <div className="text-[11px] text-mute">their followers</div>
                </div>
              </button>
            ))}
            {!rehire.length && <div className="text-sm text-mute">No overperformers yet.</div>}
          </div>
        </Card>
        <Card className="p-5 sm:p-6" delay={0.25}>
          <SectionTitle eyebrow="Nudge" title={<span className="flex items-center gap-2">Went quiet</span>} right={<Button variant="ghost" className="!py-1.5 text-xs" onClick={() => setTab("discover")}>Find replacements <ArrowUpRight size={14} /></Button>} />
          <div className="space-y-2">
            {nudge.map((c) => (
              <div key={c.name} className="flex items-center gap-3 rounded-xl p-2">
                <Avatar src={c.profilePictureUrl} name={c.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{c.name}</div>
                  <div className="text-xs text-mute">
                    {c.offBriefPosts > 0 ? <>Active — posted <b className="text-soft">{c.offBriefPosts}×</b> in the window, never about you</> : "No posts at all in the window"}
                  </div>
                </div>
              </div>
            ))}
            {!nudge.length && <div className="text-sm text-mute py-4">Everyone on the roster posted.</div>}
          </div>
        </Card>
      </div>

      <Card className="p-5 sm:p-6" delay={0.3}>
        <SectionTitle eyebrow="Top videos" title="What's carrying the campaign" right={<Button variant="ghost" className="!py-1.5 text-xs" onClick={() => setTab("videos")}>All videos <ArrowUpRight size={14} /></Button>} />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {top.map((v, i) => (
            <motion.a key={v.id} href={v.url ?? undefined} target="_blank" rel="noreferrer" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 + i * 0.05 }} className="group relative aspect-[9/16] rounded-xl overflow-hidden bg-panel-2">
              {v.thumbnailUrl && <img src={v.thumbnailUrl} className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" alt="" />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <div className="absolute top-2 left-2"><FormatChip format={v.format} size="xs" onMedia /></div>
              <div className="absolute bottom-0 inset-x-0 p-2.5 text-white">
                <div className="text-lg font-semibold leading-none">{compact(v.views)}</div>
                <div className="text-[11px] text-white/75 truncate mt-1">@{v.creatorHandle}</div>
              </div>
            </motion.a>
          ))}
        </div>
      </Card>
    </div>
  );
}

const ACTION_META: Record<InsightAction["kind"], { label: string; icon: typeof Eye; cls: string; tab: Tab }> = {
  brief: { label: "Brief", icon: Wand2, cls: "bg-violet/12 text-violet", tab: "brief" },
  rehire: { label: "Rehire", icon: Crown, cls: "bg-amber/12 text-amber", tab: "creators" },
  recruit: { label: "Recruit", icon: UserPlus, cls: "bg-mint/12 text-mint", tab: "discover" },
  nudge: { label: "Nudge", icon: Bell, cls: "bg-rose/12 text-rose", tab: "creators" },
  watch: { label: "Watch", icon: Eye, cls: "bg-fill text-soft", tab: "videos" },
};
const SOURCE = { claude: "Claude", gmi: "GMI Cloud", rules: "board rules" } as const;

/** The intelligence layer's read of the board: one headline and the ranked actions behind it. */
function InsightsCard({ board, setTab }: { board: BoardT; setTab: (t: Tab) => void }) {
  const ins = board.insights!;
  const model = ins.insightsModel?.split("/").pop();
  return (
    <Card className="p-5 sm:p-6" delay={0.05}>
      <SectionTitle
        eyebrow="What to do next"
        title={ins.headline}
      />
      <div className="grid sm:grid-cols-2 gap-2">
        {ins.actions.map((a, i) => {
          const m = ACTION_META[a.kind] ?? ACTION_META.watch;
          return (
            <motion.button key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.05 }} onClick={() => setTab(m.tab)}
              className="flex gap-3 rounded-[12px] p-3 text-left bg-fill hover:bg-fill-2 transition cursor-pointer">
              <span className={cx("inline-flex h-fit items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium shrink-0", m.cls)}><m.icon size={12} /> {m.label}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">{a.title}</span>
                <span className="block text-xs text-mute mt-0.5 leading-relaxed">{a.detail}</span>
              </span>
            </motion.button>
          );
        })}
      </div>
      <div className="mt-3 text-[11px] text-mute">Written by {SOURCE[ins.insightsSource] ?? ins.insightsSource}{model ? ` · ${model}` : ""} from the board numbers and each video's hook, claims and comments.</div>
    </Card>
  );
}

function Stat({ icon: Icon, label, value, fmt, accent, delay }: { icon: typeof Eye; label: string; value: number; fmt: (n: number) => string; accent?: boolean; delay?: number }) {
  return (
    <Card className="p-4" delay={delay}>
      <div className="flex items-center gap-1.5 text-[13px] text-mute"><Icon size={13} /> {label}</div>
      <div className={cx("mt-1.5 text-[24px] font-semibold tracking-[-0.02em] tabular-nums", accent && "text-amber")}>
        <CountUp value={value} format={fmt} />
      </div>
    </Card>
  );
}

function Timeline({ data }: { data: BoardT["timeline"] }) {
  return (
    <div className="h-64 -ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--blue)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--blue)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--separator)" />
          <XAxis dataKey="date" tickFormatter={(d) => date(d)} tick={{ fill: "var(--label-3)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis tickFormatter={(n) => compact(n)} tick={{ fill: "var(--label-3)", fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            cursor={{ stroke: "var(--separator)", strokeWidth: 1 }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className="rounded-[14px] glass-sheet px-3 py-2 text-xs">
                  <div className="text-mute mb-0.5">{date(payload[0].payload.date)}</div>
                  <div className="tabular-nums text-fg">{compact(payload[0].payload.views)} views</div>
                  <div className="text-mute">{payload[0].payload.videos} video{payload[0].payload.videos === 1 ? "" : "s"} published</div>
                </div>
              ) : null
            }
          />
          <Area type="monotone" dataKey="views" stroke="var(--blue)" strokeWidth={2} fill="url(#viewsFill)" dot={false} activeDot={{ r: 4, fill: "var(--blue)", stroke: "var(--bg-elevated)", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars, log-scaled because views/follower spans 1000× between formats. */
function FormatBars({ board }: { board: BoardT }) {
  const rows = board.formats.filter((f) => f.avgViewsPerFollowerPct != null);
  const max = Math.log10(Math.max(...rows.map((r) => r.avgViewsPerFollowerPct!), 10) + 1);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="space-y-2.5">
      {rows.map((f, i) => {
        const m = fmtMeta(f.format);
        const w = (Math.log10(f.avgViewsPerFollowerPct! + 1) / max) * 100;
        return (
          <div key={f.format} className="relative" onMouseEnter={() => setHover(f.format)} onMouseLeave={() => setHover(null)}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="flex items-center gap-1.5 text-soft">
                {m.label}
                {f.winner && <span className="inline-flex items-center gap-1 rounded-full bg-amber/12 px-1.5 py-px text-[11px] font-medium text-amber">Best</span>}
              </span>
              <span className="tabular-nums text-fg">{mult(f.avgViewsPerFollowerPct)}</span>
            </div>
            <div className="h-2.5 rounded-full bg-fill">
              <motion.div className="h-full rounded-[4px]" style={{ background: m.color }} initial={{ width: 0 }} animate={{ width: `${Math.max(2, w)}%` }} transition={{ delay: 0.2 + i * 0.06, duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
            </div>
            <AnimatePresence>
              {hover === f.format && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute z-10 right-0 top-full mt-1 rounded-[14px] glass-sheet px-3 py-2 text-xs">
                  <div className="font-medium text-fg mb-0.5">{m.label}</div>
                  <div className="text-mute">{f.videos} videos · {compact(f.views)} views · {pct(f.avgEngagementPerViewPct, 1)} engagement</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
      <div className="pt-2 text-[11px] text-mute">Avg views as a multiple of the creator's followers · log scale · winner needs ≥ 2 videos</div>
    </div>
  );
}

// ---------------- Ask the board ----------------

const SUGGESTIONS = ["Who should I rehire and why?", "Which untagged videos performed best?", "What should the next brief change?", "Who's posting but ignoring the brief?"];

function AskBar({ board }: { board: BoardT }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    setAnswer({ q: question, a: "" });
    try {
      const r = await api.ask(board.campaign.id, question);
      setAnswer({ q: question, a: r.answer });
    } catch (e: any) {
      setAnswer({ q: question, a: e.message });
    } finally {
      setBusy(false);
      setQ("");
    }
  };
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 pointer-events-none">
      <div className="mx-auto max-w-3xl px-4 pb-4 pointer-events-auto">
        <AnimatePresence>
          {answer && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} className="mb-2 rounded-[24px] glass-sheet p-4 max-h-[45dvh] overflow-auto scroll-thin">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="text-xs text-mute">{answer.q}</div>
                <button className="text-mute hover:text-fg cursor-pointer" onClick={() => setAnswer(null)}><X size={15} /></button>
              </div>
              {busy ? <div className="flex items-center gap-2 text-sm text-soft"><Spinner /> Reading the board…</div> : <Markdown text={answer.a} />}
            </motion.div>
          )}
        </AnimatePresence>
        {!answer && (
          <div className="flex gap-1.5 mb-2 overflow-x-auto [scrollbar-width:none] p-1 -m-1">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => ask(s)} className="glass shrink-0 rounded-full px-3.5 py-1.5 text-[13px] text-soft hover:text-fg transition cursor-pointer">{s}</button>
            ))}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="glass glass-blur flex items-center gap-2 rounded-full p-1.5 pl-5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this campaign" aria-label="Ask about this campaign" className="flex-1 bg-transparent text-[15px] placeholder:text-mute min-w-0" />
          <Button type="submit" className="!p-0 h-8 w-8" disabled={busy || !q.trim()}>{busy ? <Spinner /> : <ArrowUp size={17} strokeWidth={2.5} />}</Button>
        </form>
      </div>
    </div>
  );
}

/** Tiny markdown: bullets + **bold**. */
export function Markdown({ text }: { text: string }) {
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{bold(l)}</li>)}</ul>);
    list = [];
  };
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*[-*•]\s+(.*)/);
    if (m) list.push(m[1]);
    else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length} className="mb-2">{bold(line)}</p>);
    }
  }
  flush();
  return <div className="prose-answer text-sm text-soft leading-relaxed">{blocks}</div>;
}
