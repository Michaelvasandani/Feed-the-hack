import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Minus } from "lucide-react";
import { useEffect, useState } from "react";
import { api, cx } from "./lib";
import type { Campaign, Creator } from "./types";
import { Button, Spinner } from "./ui";

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
    <div className="min-h-dvh">
      <nav className="sticky top-3 z-40 mx-auto max-w-5xl px-3 sm:px-4">
        <div className="glass glass-blur rounded-full flex items-center justify-between h-12 pl-4 pr-5">
          <Logo />
          <div className="hidden sm:block text-[12px] text-mute">Data from Oriane · Models on GMI Cloud</div>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <section className="pt-16 sm:pt-24 pb-10 sm:pb-14 text-center">
          <h1 className="text-[clamp(2.25rem,5.5vw,3.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] [text-shadow:0_2px_24px_rgb(0_0_0/0.5)]">
            Every video about your brand.
            <br />
            <span className="text-white/55">Including the untagged ones.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[17px] sm:text-[19px] leading-relaxed text-white/80 [text-shadow:0_1px_12px_rgb(0_0_0/0.6)]">
            Add a brand and a creator roster. Feedboard pulls every TikTok and Reel that shows or says your product, reads each one, and tells you who to rehire, who to nudge and what to brief next.
          </p>
          {thumbs.length > 0 && (
            <div className="mt-10 flex justify-center gap-2 sm:gap-3 overflow-hidden" aria-hidden>
              {thumbs.slice(0, 7).map((u, i) => (
                <img key={i} src={u} alt="" className={cx("aspect-[9/16] w-16 sm:w-24 rounded-[16px] object-cover bg-panel-2 shadow-[0_12px_40px_rgb(0_0_0/0.5),0_0_0_0.5px_rgb(255_255_255/0.2)]", i > 4 && "hidden sm:block")} />
              ))}
            </div>
          )}
        </section>

        <section className="pb-12">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3 px-1">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em]">New campaign</h2>
            <Button variant="outline" onClick={loadDemo} disabled={loadingDemo} className="!py-1.5 !text-[13px]">
              {loadingDemo && <Spinner />} Use the Rare Beauty example
            </Button>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
            <div className="space-y-6">
              <Group title="Brand">
                <Row label="Name"><input className="row-input" placeholder="Rare Beauty" value={c.brand.name} onChange={(e) => setBrand({ name: e.target.value })} /></Row>
                <Row label="TikTok"><input className="row-input" placeholder="@rarebeauty" value={c.brand.handles.tiktok ?? ""} onChange={(e) => setBrand({ handles: { ...c.brand.handles, tiktok: e.target.value.replace(/^@/, "") } })} /></Row>
                <Row label="Instagram"><input className="row-input" placeholder="@rarebeauty" value={c.brand.handles.instagram ?? ""} onChange={(e) => setBrand({ handles: { ...c.brand.handles, instagram: e.target.value.replace(/^@/, "") } })} /></Row>
                <Row label="Also match"><input className="row-input" placeholder="soft pinch, rarebeauty" value={c.brand.aliases.join(", ")} onChange={(e) => setBrand({ aliases: e.target.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) })} /></Row>
              </Group>
              <Group title="Campaign" footer="Product images are optional. They catch videos that show the product without naming it.">
                <Row label="From"><input type="date" className="row-input" value={c.window.start} onChange={(e) => set({ window: { ...c.window, start: e.target.value } })} /></Row>
                <Row label="To"><input type="date" className="row-input" value={c.window.end} onChange={(e) => set({ window: { ...c.window, end: e.target.value } })} /></Row>
                <Row label="Images"><input className="row-input" placeholder="Image URLs, comma-separated" value={c.brand.productImageUrls.join(", ")} onChange={(e) => setBrand({ productImageUrls: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></Row>
                <div className="px-4 py-3">
                  <textarea aria-label="Brief" className="w-full bg-transparent min-h-20 resize-y text-[15px] placeholder:text-mute" placeholder="Brief: what should creators post? Key messages, formats, must-says…" value={c.brief} onChange={(e) => set({ brief: e.target.value })} />
                </div>
              </Group>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5 px-4">
                <div className="text-[13px] text-white/70">Creators{c.creators.length > 0 && ` · ${c.creators.length}`}</div>
                <div className="flex gap-3 text-[13px]">
                  <button className="text-accent hover:underline cursor-pointer" onClick={() => setShowPaste((s) => !s)}>Paste list</button>
                  <button className="text-accent hover:underline cursor-pointer" onClick={() => set({ creators: [...c.creators, { name: "", handles: {} }] })}>Add</button>
                </div>
              </div>
              <div className="surface rounded-[20px] overflow-hidden">
                <AnimatePresence>
                  {showPaste && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b border-line">
                      <div className="p-3">
                        <textarea autoFocus className="field font-mono text-[12px] min-h-28 mb-2" placeholder={"One per line:\nRachael Potash @rachaelpotash ig:rachaelpotash\n@presliewatson\nhttps://www.tiktok.com/@selenamup"} value={paste} onChange={(e) => setPaste(e.target.value)} />
                        <Button className="w-full" onClick={applyPaste} disabled={!paste.trim()}>Add {paste.split("\n").filter((l) => l.trim()).length || ""} creators</Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {c.creators.length === 0 ? (
                  <div className="px-6 py-14 text-center">
                    <div className="text-[15px] text-soft">No creators yet</div>
                    <div className="mt-1 text-[13px] text-mute max-w-xs mx-auto">Paste handles, or leave this empty and Feedboard will find the creators already posting about {c.brand.name.trim() || "your brand"}.</div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 px-4 pt-2.5 pb-1.5 text-[12px] text-mute border-b border-line">
                      <span>Name</span><span>TikTok</span><span>Instagram</span><span />
                    </div>
                    <div className="max-h-[26rem] overflow-auto scroll-thin divide-y divide-line">
                      {c.creators.map((cr, i) => (
                        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 px-4 items-center">
                          <input className="row-input !text-[14px] py-2.5" placeholder="Name" value={cr.name} onChange={(e) => setCreator(i, { ...cr, name: e.target.value })} />
                          <input className="row-input !text-[14px] py-2.5" placeholder="@handle" value={cr.handles.tiktok ?? ""} onChange={(e) => setCreator(i, { ...cr, handles: { ...cr.handles, tiktok: e.target.value.replace(/^@/, "") || undefined } })} />
                          <input className="row-input !text-[14px] py-2.5" placeholder="@handle" value={cr.handles.instagram ?? ""} onChange={(e) => setCreator(i, { ...cr, handles: { ...cr.handles, instagram: e.target.value.replace(/^@/, "") || undefined } })} />
                          <button aria-label={`Remove ${cr.name || "creator"}`} className="h-7 w-7 grid place-items-center rounded-full text-mute hover:text-rose hover:bg-fill cursor-pointer" onClick={() => set({ creators: c.creators.filter((_, j) => j !== i) })}><Minus size={15} /></button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col-reverse sm:flex-row items-center justify-end gap-4">
            <button className="text-[13px] text-mute hover:text-soft cursor-pointer disabled:opacity-40 disabled:cursor-default" disabled={!valid || !hasRoster} onClick={() => valid && hasRoster && onRun({ ...c, id: c.id || "demo" }, "fixtures")}>
              Use sample videos (offline)
            </button>
            <Button onClick={submit} disabled={!valid} className="w-full sm:w-auto !px-6 !py-2.5 !text-[15px]">
              {hasRoster ? "Build board" : "Find creators and build"}
            </Button>
          </div>
        </section>

        {recent.length > 0 && (
          <section className="pb-20">
            <div className="text-[13px] text-white/70 mb-1.5 px-4">Recent boards</div>
            <div className="surface rounded-[20px] divide-y divide-line overflow-hidden">
              {recent.map((r) => (
                <button key={r.id} onClick={() => onOpen(r.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-fill transition cursor-pointer">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px]">{r.brandName}</div>
                    <div className="text-[13px] text-mute">{r.videos} videos · {Intl.NumberFormat("en", { notation: "compact" }).format(r.views)} views</div>
                  </div>
                  <ChevronRight size={16} className="text-mute" />
                </button>
              ))}
            </div>
          </section>
        )}
        <footer className="pb-8 text-center text-[12px] text-white/40">Background: Orion Nebula fly-through, NASA/JPL-Caltech</footer>
      </div>
    </div>
  );
}

/** Inset grouped list, as in iOS Settings. */
function Group({ title, footer, children }: { title: string; footer?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[13px] text-white/70 mb-1.5 px-4">{title}</div>
      <div className="surface rounded-[20px] divide-y divide-line overflow-hidden">{children}</div>
      {footer && <div className="text-[12px] text-white/60 mt-1.5 px-4 leading-snug">{footer}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-4 px-4 min-h-11">
      <span className="w-24 shrink-0 text-[15px]">{label}</span>
      {children}
    </label>
  );
}

export function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <button onClick={onClick} className={cx("flex items-center gap-2", onClick && "cursor-pointer")}>
      <div className="grid h-6 w-6 place-items-center rounded-[7px] bg-fg">
        <svg viewBox="0 0 32 32" className="h-3.5 w-3.5"><path d="M9 23V9h12M9 16h9" stroke="var(--bg-elevated)" strokeWidth="3.6" fill="none" strokeLinecap="round" /></svg>
      </div>
      <span className="text-[15px] font-semibold tracking-[-0.02em]">Feedboard</span>
    </button>
  );
}
