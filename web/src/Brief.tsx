import { motion } from "motion/react";
import { Ban, Check, Clapperboard, Copy, Download, RefreshCw, Sparkles, Target } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type NextBrief } from "./lib";
import type { Board } from "./types";
import { Button, Card, FormatChip, SectionTitle, Shimmer, Spinner } from "./ui";
import type { Format } from "./types";

export default function Brief({ board }: { board: Board }) {
  const [brief, setBrief] = useState<NextBrief | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const load = (refresh = false) => {
    setBrief(null);
    setErr(null);
    api.brief(board.campaign.id, refresh).then(setBrief).catch((e) => setErr(e.message));
  };
  useEffect(() => load(), [board.campaign.id]);
  const win = board.formats.find((f) => f.winner);

  const copy = () => {
    if (!brief) return;
    const txt = [
      `# ${brief.headline}`, `Format: ${brief.format}`, "", `Hook: "${brief.hook}"`, "",
      "Why:", ...brief.why.map((w) => `- ${w}`), "", "Must do:", ...brief.mustDo.map((w) => `- ${w}`), "",
      "Avoid:", ...brief.avoid.map((w) => `- ${w}`), "", "Shot list:", ...brief.shotList.map((w) => `- ${w}`),
    ].join("\n");
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <SectionTitle
        eyebrow="Next brief"
        title="What to brief next, written from what actually worked"
        right={
          <div className="flex gap-1">
            <Button variant="ghost" className="!py-1.5 text-xs" onClick={() => load(true)}><RefreshCw size={14} /> Rewrite</Button>
            <Button variant="outline" className="!py-1.5 text-xs" onClick={copy} disabled={!brief}>{copied ? <Check size={14} /> : <Copy size={14} />} Copy brief</Button>
          </div>
        }
      />
      {err && <div className="text-rose text-sm mb-4">{err}</div>}
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
        <Card className="p-6 sm:p-8">
          {!brief ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-soft"><Spinner /> Reading {board.totals.videos} videos and their comments…</div>
              <Shimmer className="h-10 w-3/4" /><Shimmer className="h-24" /><Shimmer className="h-40" />
            </div>
          ) : (
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                {win && <FormatChip format={win.format as Format} />}
                <span className="text-xs text-mute">for {board.campaign.brandName}</span>
              </div>
              <h2 className="text-[28px] sm:text-[34px] font-semibold tracking-[-0.03em] leading-[1.15] mb-6">{brief.headline}</h2>
              <div className="rounded-[14px] bg-fill p-4 mb-6">
                <div className="text-[13px] text-mute mb-1">Open with</div>
                <div className="text-[19px] sm:text-[22px] font-medium text-fg leading-snug">“{brief.hook}”</div>
              </div>
              <List icon={Sparkles} tone="text-amber" title="Why this format" items={brief.why} />
              <List icon={Target} tone="text-mint" title="Must do" items={brief.mustDo} />
              <List icon={Ban} tone="text-rose" title="Avoid" items={brief.avoid} />
              <div className="mt-6 text-[11px] text-mute">Written by {brief.briefSource === "gmi" ? `GMI Cloud · ${brief.briefModel?.split("/").pop()}` : "board rules (add GMI_API_KEY for a model-written brief)"}</div>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="p-5 sm:p-6" delay={0.1}>
            <div className="flex items-center gap-2 font-medium mb-3">Shot list</div>
            {!brief ? <Shimmer className="h-40" /> : (
              <ol className="space-y-2">
                {brief.shotList.map((s, i) => {
                  const [t, ...rest] = s.split(":");
                  return (
                    <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="flex gap-3 text-sm">
                      <span className="tabular-nums text-[11px] text-mute w-12 shrink-0 pt-0.5">{rest.length ? t : `#${i + 1}`}</span>
                      <span className="text-soft">{rest.length ? rest.join(":").trim() : s}</span>
                    </motion.li>
                  );
                })}
              </ol>
            )}
          </Card>
          <SampleVideo prompt={brief?.videoPrompt ?? null} boardId={board.campaign.id} />
        </div>
      </div>
    </div>
  );
}

function List({ icon: Icon, title, items, tone }: { icon: typeof Sparkles; title: string; items: string[]; tone: string }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-center gap-1.5 text-sm font-medium mb-2"><Icon size={15} className={tone} /> {title}</div>
      <ul className="space-y-1.5">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-soft leading-relaxed"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fill" />{x}</li>
        ))}
      </ul>
    </div>
  );
}

/** Generates an 8s vertical sample clip of the brief on GMI Cloud (Kling 3.0 Turbo). */
function SampleVideo({ prompt, boardId }: { prompt: string | null; boardId: string }) {
  const [state, setState] = useState<{ status: "idle" | "queued" | "done" | "error"; url?: string; msg?: string; started?: number }>({ status: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);
  // Show a previously generated clip for this board, if one was saved.
  useEffect(() => {
    const url = `/api/boards/${boardId}/video.mp4`;
    fetch(url, { method: "HEAD" }).then((r) => r.ok && setState({ status: "done", url })).catch(() => {});
  }, [boardId]);

  const start = async () => {
    if (!prompt) return;
    try {
      const { request_id } = await api.video(prompt);
      const started = Date.now();
      setState({ status: "queued", started });
      timer.current = setInterval(async () => {
        setElapsed(Math.round((Date.now() - started) / 1000));
        try {
          const r = await api.videoStatus(request_id, boardId);
          if (r.videoUrl) {
            clearInterval(timer.current);
            setState({ status: "done", url: r.videoUrl });
          } else if (/fail|error|cancel/i.test(r.status)) {
            clearInterval(timer.current);
            setState({ status: "error", msg: `Generation ${r.status}` });
          }
        } catch { /* keep polling */ }
      }, 4000);
    } catch (e: any) {
      setState({ status: "error", msg: e.message });
    }
  };

  return (
    <Card className="p-5 sm:p-6" delay={0.2}>
      <div className="flex items-center gap-2 font-medium mb-1">Sample video</div>
      <p className="text-xs text-mute mb-4">Show creators the vibe: an 8-second AI-generated mock of this brief, rendered on GMI Cloud.</p>
      <div className="relative mx-auto w-full max-w-[240px] aspect-[9/16] rounded-[16px] overflow-hidden bg-fill grid place-items-center">
        {state.status === "done" && state.url ? (
          <video src={state.url} autoPlay loop muted playsInline controls className="absolute inset-0 h-full w-full object-cover" />
        ) : state.status === "queued" ? (
          <div className="text-center px-4">
            <div className="relative mx-auto mb-3 h-12 w-12">
              <div className="absolute inset-0 rounded-full border-2 border-fill-2" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-spin" />
            </div>
            <div className="text-sm text-soft">Rendering… {elapsed}s</div>
            <div className="text-[11px] text-mute mt-1">usually 1–3 min</div>
          </div>
        ) : (
          <div className="text-center px-5">
            <Clapperboard size={28} className="mx-auto text-mute mb-3" />
            {prompt && <div className="text-[11px] text-mute line-clamp-6 mb-4">{prompt}</div>}
            <Button onClick={start} disabled={!prompt} className="text-xs !px-3 !py-2">Generate</Button>
            {state.status === "error" && <div className="text-[11px] text-rose mt-2">{state.msg}</div>}
          </div>
        )}
      </div>
      {state.status === "done" && state.url && (
        <div className="mt-3 flex justify-center gap-4">
          <a href={state.url} download className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"><Download size={13} /> Download MP4</a>
          <button onClick={start} disabled={!prompt} className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline cursor-pointer disabled:opacity-40"><RefreshCw size={13} /> Generate another</button>
        </div>
      )}
    </Card>
  );
}
