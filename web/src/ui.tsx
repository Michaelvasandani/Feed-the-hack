import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cx, fmtMeta } from "./lib";
import type { Format } from "./types";

export function Card({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cx("glass rounded-2xl", className)}
    >
      {children}
    </motion.div>
  );
}

export function SectionTitle({ eyebrow, title, right }: { eyebrow?: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div>
        {eyebrow && <div className="text-[11px] uppercase tracking-[0.18em] text-mute mb-1">{eyebrow}</div>}
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      </div>
      {right}
    </div>
  );
}

/** Number that counts up when it mounts / changes. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 60, damping: 20 });
  const text = useTransform(spring, (v) => format(v));
  useEffect(() => mv.set(value), [value, mv]);
  return <motion.span>{text}</motion.span>;
}

export function Avatar({ src, name, size = 36, ring }: { src?: string | null; name: string; size?: number; ring?: string }) {
  const [err, setErr] = useState(false);
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="shrink-0 rounded-full p-[2px]" style={{ width: size, height: size, background: ring ?? "rgb(255 255 255 / 0.1)" }}>
      {src && !err ? (
        <img src={src} alt="" onError={() => setErr(true)} className="w-full h-full rounded-full object-cover bg-panel" />
      ) : (
        <div className="w-full h-full rounded-full bg-panel-2 grid place-items-center text-[11px] font-semibold text-soft">{initials}</div>
      )}
    </div>
  );
}

export function FormatChip({ format, size = "sm" }: { format: Format | null | undefined; size?: "sm" | "xs" }) {
  const m = fmtMeta(format);
  return (
    <span
      className={cx("inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap text-soft", size === "sm" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]")}
      style={{ background: `${m.color}1c`, boxShadow: `inset 0 0 0 1px ${m.color}40` }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

export function Pill({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "rose" | "mint" | "amber" | "violet" | "sky"; className?: string }) {
  const tones = {
    neutral: "bg-white/[0.06] text-soft ring-white/10",
    rose: "bg-rose/15 text-rose ring-rose/25",
    mint: "bg-mint/15 text-mint ring-mint/25",
    amber: "bg-amber/15 text-amber ring-amber/25",
    violet: "bg-violet/15 text-[#b9a0ff] ring-violet/30",
    sky: "bg-sky/15 text-sky ring-sky/25",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function Button({ children, onClick, variant = "primary", disabled, className, type = "button" }: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "outline"; disabled?: boolean; className?: string; type?: "button" | "submit";
}) {
  const v = {
    primary: "bg-gradient-to-r from-rose to-violet text-white shadow-[0_8px_30px_-8px_rgb(255_77_141/0.6)] hover:brightness-110",
    ghost: "text-soft hover:text-white hover:bg-white/[0.06]",
    outline: "text-white ring-1 ring-inset ring-white/15 hover:bg-white/[0.06]",
  };
  return (
    <motion.button
      type={type}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      disabled={disabled}
      className={cx("inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none cursor-pointer", v[variant], className)}
    >
      {children}
    </motion.button>
  );
}

export function Modal({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="relative w-full max-w-lg rounded-2xl bg-panel border border-line p-6 shadow-2xl max-h-[85dvh] overflow-auto scroll-thin"
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="text-lg font-semibold">{title}</div>
              <button onClick={onClose} className="text-mute hover:text-white cursor-pointer"><X size={18} /></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Meter({ value, color = "#ff4d8d", className }: { value: number | null; color?: string; className?: string }) {
  return (
    <div className={cx("h-1.5 rounded-full bg-white/[0.07] overflow-hidden", className)}>
      {value != null && (
        <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${Math.max(3, Math.min(100, value * 100))}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin", className)} />;
}

export function Shimmer({ className }: { className?: string }) {
  return <div className={cx("rounded-xl bg-gradient-to-r from-white/[0.03] via-white/[0.08] to-white/[0.03] bg-[length:200%_100%] animate-[shimmer_1.6s_infinite]", className)} />;
}
