import { motion } from "motion/react";
import { Check, TriangleAlert } from "lucide-react";
import { cx } from "./lib";
import { Button, Spinner } from "./ui";

const STAGES = [
  { key: "fetch", title: "Searching TikTok and Instagram", sub: "Captions, transcripts, on-screen text, tags and product visuals" },
  { key: "classify", title: "Watching each video", sub: "Labels the format and reads the comments" },
  { key: "metrics", title: "Scoring the roster", sub: "Who posted, who went quiet, who beat their follower count" },
] as const;

export default function Running({ brand, stage, log, error, onBack }: { brand: string; stage: number; log: string[]; error: string | null; onBack: () => void }) {
  return (
    <div className="min-h-dvh grid place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-[13px] text-mute mb-1">Building board</div>
          <h1 className="text-[28px] font-semibold tracking-[-0.03em]">{brand}</h1>
        </div>
        <div className="surface rounded-[14px] divide-y divide-line overflow-hidden">
          {STAGES.map((s, i) => {
            const state = error && i === stage ? "error" : i < stage ? "done" : i === stage ? "active" : "todo";
            return (
              <div key={s.key} className={cx("flex items-center gap-3 px-4 py-3 transition-opacity", state === "todo" && "opacity-45")}>
                <div className={cx("h-6 w-6 shrink-0 rounded-full grid place-items-center", state === "done" ? "bg-mint text-white" : state === "error" ? "bg-rose text-white" : "text-mute")}>
                  {state === "done" ? <Check size={14} strokeWidth={3} /> : state === "error" ? <TriangleAlert size={13} /> : state === "active" ? <Spinner /> : <span className="h-2 w-2 rounded-full bg-fill-2" />}
                </div>
                <div className="min-w-0">
                  <div className="text-[15px]">{s.title}</div>
                  <div className="text-[13px] text-mute truncate">{s.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 px-1 font-mono text-[11px] text-mute h-24 overflow-hidden flex flex-col-reverse [mask-image:linear-gradient(to_bottom,transparent,black_60%)]" aria-live="polite">
          <div>
            {log.map((l, i) => (
              <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={i === log.length - 1 ? "text-soft" : ""}>{l}</motion.div>
            ))}
          </div>
        </div>
        {error && (
          <div className="mt-4 text-center">
            <div className="text-[15px] text-rose mb-3">{error}</div>
            <Button variant="outline" onClick={onBack}>Back to setup</Button>
          </div>
        )}
      </div>
    </div>
  );
}
