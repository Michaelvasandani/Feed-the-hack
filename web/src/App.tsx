import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
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
    <div className="noise">
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
