import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import BoardView from "./Board";
import { api, runCampaign } from "./lib";
import Running from "./Running";
import Setup from "./Setup";
import type { Board, Campaign } from "./types";

type View = { kind: "setup" } | { kind: "running" } | { kind: "board"; board: Board };

export default function App() {
  const [view, setView] = useState<View>({ kind: "setup" });
  const [recent, setRecent] = useState<{ id: string; brandName: string; videos: number; views: number }[]>([]);
  const [run, setRun] = useState<{ brand: string; stage: number; log: string[]; error: string | null }>({ brand: "", stage: 0, log: [], error: null });
  const [last, setLast] = useState<{ c: Campaign; source: "live" | "fixtures" } | null>(null);

  // Deep link: #board=<id>
  useEffect(() => {
    api.boards().then(setRecent).catch(() => {});
    const id = new URLSearchParams(location.hash.slice(1)).get("board");
    if (id) api.board(id).then((board) => setView({ kind: "board", board })).catch(() => {});
  }, []);
  useEffect(() => {
    if (view.kind === "board") history.replaceState(null, "", `#board=${view.board.campaign.id}`);
    else if (view.kind === "setup") history.replaceState(null, "", location.pathname);
    window.scrollTo({ top: 0 });
  }, [view]);

  const start = async (c: Campaign, source: "live" | "fixtures") => {
    setLast({ c, source });
    setRun({ brand: c.brand.name, stage: 0, log: [], error: null });
    setView({ kind: "running" });
    try {
      await runCampaign(c, source, (e) => {
        if (e.type === "progress") setRun((r) => ({ ...r, log: [...r.log, e.message] }));
        if (e.type === "stage") setRun((r) => ({ ...r, stage: e.stage === "classify" ? 1 : 2 }));
        if (e.type === "error") setRun((r) => ({ ...r, error: e.message }));
        if (e.type === "done") {
          setRun((r) => ({ ...r, stage: 3 }));
          setTimeout(() => setView({ kind: "board", board: e.board }), 600);
          api.boards().then(setRecent).catch(() => {});
        }
      });
    } catch (err: unknown) {
      setRun((r) => ({ ...r, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  return (
    <div>
      <SpaceBackground dim={view.kind === "setup" ? 0.62 : 0.72} blur={view.kind !== "setup"} />
      <AnimatePresence mode="wait">
        <motion.div key={view.kind} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
          {view.kind === "setup" && <Setup onRun={start} recent={recent} onOpen={(id) => api.board(id).then((board) => setView({ kind: "board", board }))} />}
          {view.kind === "running" && <Running {...run} onBack={() => setView({ kind: "setup" })} />}
          {view.kind === "board" && <BoardView board={view.board} onHome={() => setView({ kind: "setup" })} onRerun={() => (last ? start(last.c, last.source) : api.campaign(view.board.campaign.id).then((c) => start(c, "live")))} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Orion Nebula fly-through (NASA/JPL-Caltech, public domain). Shows the still frame when the viewer prefers reduced motion. */
function SpaceBackground({ dim, blur }: { dim: number; blur: boolean }) {
  const still = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <div className="space-bg" data-blur={blur || undefined} style={{ "--dim": dim } as CSSProperties} aria-hidden>
      {still ? <img src="/space.jpg" alt="" /> : <video src="/space.mp4" poster="/space.jpg" autoPlay muted loop playsInline preload="auto" />}
      <Stars />
    </div>
  );
}

/** Seeded so the sky doesn't reshuffle between renders. */
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

// Each layer is one 1px element whose box-shadows are the stars, so it paints once and then
// only opacity and transform animate (both run on the compositor).
const FIELD = { w: 2560, h: 1600 };
const LAYERS = [
  { count: 1700, size: 1.3, glow: 0, alpha: [0.6, 1], twinkle: "7s", drift: "240s" },
  { count: 450, size: 2, glow: 1, alpha: [0.75, 1], twinkle: "4.5s", drift: "180s" },
  { count: 90, size: 2.6, glow: 4, alpha: [0.85, 1], twinkle: "3s", drift: "120s" },
];

function Stars() {
  const layers = useMemo(() => {
    const r = rng(42);
    // Split each size into three groups that twinkle out of phase, so the sky shimmers rather than pulses.
    return LAYERS.flatMap((l) => [0, 1, 2].map((g) => {
      const dots: string[] = [];
      for (let i = 0; i < l.count / 3; i++) {
        const x = Math.round(r() * FIELD.w);
        const y = Math.round(r() * FIELD.h);
        const a = (l.alpha[0] + r() * (l.alpha[1] - l.alpha[0])).toFixed(2);
        // A few stars get a faint blue or warm tint.
        const t = r();
        const c = t < 0.12 ? `rgb(170 200 255 / ${a})` : t > 0.92 ? `rgb(255 225 190 / ${a})` : `rgb(255 255 255 / ${a})`;
        // Repeat one field-height down so the upward drift loops seamlessly.
        dots.push(`${x}px ${y}px ${l.glow}px ${c}`, `${x}px ${y + FIELD.h}px ${l.glow}px ${c}`);
      }
      return { ...l, delay: `${-g * (parseFloat(l.twinkle) / 3)}s`, shadow: dots.join(",") };
    }));
  }, []);
  return (
    <div className="stars">
      {layers.map((l, i) => (
        <div key={i} className="star-layer" style={{ "--twinkle": l.twinkle, "--drift": l.drift, "--delay": l.delay } as CSSProperties}>
          <div style={{ width: l.size, height: l.size, borderRadius: "50%", boxShadow: l.shadow }} />
        </div>
      ))}
    </div>
  );
}
