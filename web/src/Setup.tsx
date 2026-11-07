import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ClipboardPaste, ImagePlus, Plus, Sparkles, Trash2, Zap } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { api, cx } from "./lib";
import type { Campaign, Creator } from "./types";
import { Button, Spinner } from "./ui";

const Scene3D = lazy(() => import("./Scene3D"));

const empty: Campaign = {
  id: "",
  brand: { name: "", aliases: [], handles: {}, productImageUrls: [] },
  brief: "",
  window: { start: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) },
  creators: [],
};

/** "Rachael Potash @rachaelpotash ig:rachaelpotash" | "@handle" | "tiktok.com/@x" → Creator */
function parseCreatorLine(line: string): Creator | null {
  const l = line.trim();
  if (!l) return null;
  const handles: Creator["handles"] = {};
  const ig = l.match(/(?:ig:|instagram\.com\/|insta:)@?([\w.]+)/i)?.[1];
  const tt = l.match(/(?:tt:|tiktok:|tiktok\.com\/@)@?([\w.]+)/i)?.[1];
  if (ig) handles.instagram = ig.toLowerCase();
  if (tt) handles.tiktok = tt.toLowerCase();
  const bare = [...l.matchAll(/(?:^|\s)@([\w.]+)/g)].map((m) => m[1].toLowerCase()).filter((h) => h !== ig && h !== tt);
  if (bare[0] && !handles.tiktok) handles.tiktok = bare[0];
  if (!handles.tiktok && !handles.instagram) handles.tiktok = l.replace(/^@/, "").split(/\s+/)[0].toLowerCase();
  const name = l.replace(/(?:ig:|tt:|tiktok:|insta:)?@?[\w.]*(?:instagram\.com|tiktok\.com)\/@?[\w.]+|(?:ig:|tt:|tiktok:|insta:)@?[\w.]+|@[\w.]+/gi, "").replace(/[|,—-]+/g, " ").trim();
  return { name: name || (handles.tiktok ?? handles.instagram)!, handles };
}

export default function Setup({ onRun, recent, onOpen }: {
  onRun: (c: Campaign, source: "live" | "fixtures") => void;
  recent: { id: string; brandName: string; videos: number; views: number }[];
  onOpen: (id: string) => void;
}) {
  const [c, setC] = useState<Campaign>(empty);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);

  useEffect(() => {
    fetch("/api/showcase").then((r) => r.json()).then(setThumbs).catch(() => {});
  }, []);

  const loadDemo = async () => {
    setLoadingDemo(true);
    try { setC(await api.demoCampaign()); } finally { setLoadingDemo(false); }
  };
  const set = (patch: Partial<Campaign>) => setC((x) => ({ ...x, ...patch }));
  const setBrand = (patch: Partial<Campaign["brand"]>) => setC((x) => ({ ...x, brand: { ...x.brand, ...patch } }));
  const setCreator = (i: number, cr: Creator) => set({ creators: c.creators.map((x, j) => (j === i ? cr : x)) });
  const applyPaste = () => {
    const parsed = paste.split(/\n/).map(parseCreatorLine).filter(Boolean) as Creator[];
    set({ creators: [...c.creators, ...parsed] });
    setPaste("");
    setShowPaste(false);
  };
  const hasRoster = c.creators.some((x) => x.handles.tiktok || x.handles.instagram);
  // With no roster, the run searches everyone for the brand and lists who posted.
  const valid = !!c.brand.name.trim();
  const submit = () => {
    const brandSlug = c.brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    onRun({
      ...c,
      id: c.id || `${brandSlug}-${c.window.start}`,
      brand: { ...c.brand, aliases: c.brand.aliases.length ? c.brand.aliases : [c.brand.name.toLowerCase()] },
      creators: c.creators.filter((x) => x.handles.tiktok || x.handles.instagram).map((x) => ({ ...x, name: x.name || (x.handles.tiktok ?? x.handles.instagram)! })),
      discover: !hasRoster,
    }, "live");
  };

  return (
    <div className="relative min-h-dvh overflow-hidden">
      {/* 3D hero */}
      <div className="absolute inset-x-0 top-0 h-[78dvh] opacity-75 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]">
        <Suspense fallback={null}><Scene3D urls={thumbs} /></Suspense>
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[78dvh] bg-[radial-gradient(ellipse_at_center,transparent_20%,#07070b_75%)]" />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <nav className="flex items-center justify-between py-5">
          <Logo />
          <div className="flex items-center gap-2 text-xs text-mute">
            <span className="hidden sm:inline">Powered by</span>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-soft ring-1 ring-white/10">Oriane</span>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-soft ring-1 ring-white/10">GMI Cloud</span>
          </div>
        </nav>

        <section className="pt-[22dvh] sm:pt-[26dvh] pb-10 text-center">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
            <div className="inline-flex items-center gap-2 rounded-full glass px-3 py-1.5 text-xs text-soft mb-6">
              <Sparkles size={13} className="text-amber" /> Finds the videos your creators never tagged you in
            </div>
            <h1 className="text-[clamp(2.4rem,6.5vw,5.2rem)] font-semibold leading-[0.98] tracking-[-0.035em]">
              Every creator. Every video.
              <br />
              <span className="font-serif italic font-normal grad-text">One board.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base sm:text-lg text-soft/90">
              Add your brand, brief and creator roster. We pull every TikTok & Reel that shows or says your product, read what each one does, and tell you who to rehire, who to nudge, and what to brief next.
            </p>
          </motion.div>
        </section>

        <motion.section
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="grad-border glass rounded-3xl p-5 sm:p-8 mb-10"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-mute">New campaign</div>
              <div className="text-xl font-semibold tracking-tight">Set up your board</div>
            </div>
            <Button variant="outline" onClick={loadDemo} disabled={loadingDemo}>
              {loadingDemo ? <Spinner /> : <Zap size={15} className="text-amber" />} Load Rare Beauty demo
            </Button>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
            <div className="space-y-4">
              <Field label="Brand">
                <input className="field" placeholder="Rare Beauty" value={c.brand.name} onChange={(e) => setBrand({ name: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="TikTok handle">
                  <input className="field" placeholder="@rarebeauty" value={c.brand.handles.tiktok ?? ""} onChange={(e) => setBrand({ handles: { ...c.brand.handles, tiktok: e.target.value.replace(/^@/, "") } })} />
                </Field>
                <Field label="Instagram handle">
                  <input className="field" placeholder="@rarebeauty" value={c.brand.handles.instagram ?? ""} onChange={(e) => setBrand({ handles: { ...c.brand.handles, instagram: e.target.value.replace(/^@/, "") } })} />
                </Field>
              </div>
              <Field label="Also match" hint="comma-separated product names / spellings">
                <input className="field" placeholder="rare beauty, soft pinch, rarebeauty" value={c.brand.aliases.join(", ")} onChange={(e) => setBrand({ aliases: e.target.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) })} />
              </Field>
              <Field label="Brief">
                <textarea className="field min-h-24 resize-y" placeholder="What should creators post? Key messages, formats, must-says…" value={c.brief} onChange={(e) => set({ brief: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From">
                  <input type="date" className="field" value={c.window.start} onChange={(e) => set({ window: { ...c.window, start: e.target.value } })} />
                </Field>
                <Field label="To">
                  <input type="date" className="field" value={c.window.end} onChange={(e) => set({ window: { ...c.window, end: e.target.value } })} />
                </Field>
              </div>
              <Field label="Product images" hint="optional · finds videos that show it without saying it">
                <div className="relative">
                  <ImagePlus size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
                  <input className="field !pl-9" placeholder="https://… image URL (comma-separated)" value={c.brand.productImageUrls.join(", ")} onChange={(e) => setBrand({ productImageUrls: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                </div>
              </Field>
            </div>

            <div className="flex flex-col rounded-2xl bg-black/25 ring-1 ring-white/[0.06] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium">Creator roster <span className="text-mute font-normal">· {c.creators.length}</span></div>
                <div className="flex gap-1">
                  <Button variant="ghost" className="!px-2.5 !py-1.5 text-xs" onClick={() => setShowPaste((s) => !s)}><ClipboardPaste size={14} /> Paste list</Button>
                  <Button variant="ghost" className="!px-2.5 !py-1.5 text-xs" onClick={() => set({ creators: [...c.creators, { name: "", handles: {} }] })}><Plus size={14} /> Add</Button>
                </div>
              </div>
              <AnimatePresence>
                {showPaste && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <textarea autoFocus className="field font-mono text-xs min-h-28 mb-2" placeholder={"One per line:\nRachael Potash @rachaelpotash ig:rachaelpotash\n@presliewatson\nhttps://www.tiktok.com/@selenamup"} value={paste} onChange={(e) => setPaste(e.target.value)} />
                    <Button variant="outline" className="w-full mb-3 !py-2 text-xs" onClick={applyPaste}><Check size={14} /> Add {paste.split("\n").filter((l) => l.trim()).length || ""} creators</Button>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 px-1 pb-1.5 text-[10px] uppercase tracking-wider text-mute">
                <span>Name</span><span>TikTok</span><span>Instagram</span><span className="w-7" />
              </div>
              <div className="flex-1 space-y-1.5 overflow-auto scroll-thin max-h-[23rem] pr-1">
                {c.creators.length === 0 && (
                  <div className="grid place-items-center text-center text-sm text-mute h-40 rounded-xl border border-dashed border-white/10">
                    <span>Paste handles or load the demo.<br /><span className="text-xs">Or leave it empty and we'll find the creators already posting about {c.brand.name.trim() || "your brand"}.</span></span>
                  </div>
                )}
                <AnimatePresence initial={false}>
                  {c.creators.map((cr, i) => (
                    <motion.div key={i} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                      <input className="field !py-2 !text-xs" placeholder="Name" value={cr.name} onChange={(e) => setCreator(i, { ...cr, name: e.target.value })} />
                      <input className="field !py-2 !text-xs" placeholder="@handle" value={cr.handles.tiktok ?? ""} onChange={(e) => setCreator(i, { ...cr, handles: { ...cr.handles, tiktok: e.target.value.replace(/^@/, "") || undefined } })} />
                      <input className="field !py-2 !text-xs" placeholder="@handle" value={cr.handles.instagram ?? ""} onChange={(e) => setCreator(i, { ...cr, handles: { ...cr.handles, instagram: e.target.value.replace(/^@/, "") || undefined } })} />
                      <button className="w-7 grid place-items-center text-mute hover:text-rose cursor-pointer" onClick={() => set({ creators: c.creators.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <button className="text-xs text-mute hover:text-soft underline-offset-4 hover:underline cursor-pointer disabled:opacity-40" disabled={!valid || !hasRoster} onClick={() => valid && hasRoster && onRun({ ...c, id: c.id || "demo" }, "fixtures")}>
              Offline mode: use sample videos
            </button>
            <Button onClick={submit} disabled={!valid} className="!px-6 !py-3 text-base">
              {hasRoster ? "Build the board" : "Find creators & build"} <ArrowRight size={17} />
            </Button>
          </div>
        </motion.section>

        {recent.length > 0 && (
          <section className="mb-16">
            <div className="text-[11px] uppercase tracking-[0.18em] text-mute mb-3">Recent boards</div>
            <div className="flex flex-wrap gap-2">
              {recent.map((r) => (
                <button key={r.id} onClick={() => onOpen(r.id)} className="glass rounded-xl px-4 py-2.5 text-left hover:bg-white/[0.06] transition cursor-pointer">
                  <div className="text-sm font-medium">{r.brandName}</div>
                  <div className="text-xs text-mute">{r.videos} videos · {Intl.NumberFormat("en", { notation: "compact" }).format(r.views)} views</div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline gap-2 text-xs font-medium text-soft">
        {label} {hint && <span className="font-normal text-mute/80">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <button onClick={onClick} className={cx("flex items-center gap-2.5", onClick && "cursor-pointer")}>
      <div className="relative h-8 w-8 rounded-[10px] bg-gradient-to-br from-rose via-violet to-amber p-[1.5px]">
        <div className="grid h-full w-full place-items-center rounded-[9px] bg-ink">
          <svg viewBox="0 0 32 32" className="h-4.5 w-4.5"><path d="M9 23V9h12M9 16h9" stroke="white" strokeWidth="3.2" fill="none" strokeLinecap="round" /></svg>
        </div>
      </div>
      <span className="text-[17px] font-semibold tracking-tight">Feedboard</span>
    </button>
  );
}
