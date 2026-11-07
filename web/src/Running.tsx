import { motion } from "motion/react";
import { BarChart3, Brain, Check, Search, TriangleAlert } from "lucide-react";
import { cx } from "./lib";
import { Button } from "./ui";

const STAGES = [
  { key: "fetch", icon: Search, title: "Scanning TikTok & Instagram", sub: "Captions, transcripts, on-screen text, tags and product visuals via Oriane" },
  { key: "classify", icon: Brain, title: "Watching every video", sub: "Vision LLM on GMI Cloud labels the format and reads the comments" },
  { key: "metrics", icon: BarChart3, title: "Scoring the roster", sub: "Who posted, who went quiet, who punched above their weight" },
] as const;

export default function Running({ brand, stage, log, error, onBack }: { brand: string; stage: number; log: string[]; error: string | null; onBack: () => void }) {
  return (
    <div className="min-h-dvh grid place-items-center px-4">
      <div className="w-full max-w-xl">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <div className="text-[11px] uppercase tracking-[0.2em] text-mute mb-2">Building board</div>
          <h1 className="text-4xl font-semibold tracking-tight">
            <span className="font-serif italic font-normal grad-text">{brand}</span>
          </h1>
        </motion.div>
        <div className="space-y-3">
          {STAGES.map((s, i) => {
            const state = error && i === stage ? "error" : i < stage ? "done" : i === stage ? "active" : "todo";
            const Icon = s.icon;
            return (
              <motion.div
                key={s.key}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: state === "todo" ? 0.4 : 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className={cx("glass rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden", state === "active" && "grad-border")}
              >
                {state === "active" && <motion.div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" animate={{ x: ["-100%", "100%"] }} transition={{ repeat: Infinity, duration: 1.8, ease: "linear" }} />}
                <div className={cx("h-10 w-10 shrink-0 rounded-xl grid place-items-center", state === "done" ? "bg-mint/15 text-mint" : state === "error" ? "bg-rose/15 text-rose" : "bg-white/[0.06] text-soft")}>
                  {state === "done" ? <Check size={18} /> : state === "error" ? <TriangleAlert size={18} /> : <Icon size={18} className={state === "active" ? "animate-pulse" : ""} />}
                </div>
                <div className="min-w-0">
                  <div className="font-medium">{s.title}</div>
                  <div className="text-xs text-mute truncate">{s.sub}</div>
                </div>
              </motion.div>
            );
          })}
        </div>
        <div className="mt-6 rounded-xl bg-black/40 ring-1 ring-white/[0.06] p-3 font-mono text-[11px] text-mute h-32 overflow-auto scroll-thin flex flex-col-reverse">
          <div>
            {log.map((l, i) => (
              <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={i === log.length - 1 ? "text-soft" : ""}>
                <span className="text-rose/70">›</span> {l}
              </motion.div>
            ))}
          </div>
        </div>
        {error && (
          <div className="mt-4 text-center">
            <div className="text-sm text-rose mb-3">{error}</div>
            <Button variant="outline" onClick={onBack}>Back to setup</Button>
          </div>
        )}
      </div>
    </div>
  );
}
