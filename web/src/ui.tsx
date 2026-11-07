import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cx, fmtMeta } from "./lib";
import type { Format } from "./types";

export function Card({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: delay * 0.5, ease: [0.25, 0.1, 0.25, 1] }}
      className={cx("surface rounded-[18px]", className)}
    >
      {children}
    </motion.div>
  );
}

export function SectionTitle({ eyebrow, title, right }: { eyebrow?: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div>
        {eyebrow && <div className="text-[13px] font-medium text-mute mb-0.5">{eyebrow}</div>}
        <h2 className="text-[19px] font-semibold tracking-[-0.02em]">{title}</h2>
      </div>
      {right}
    </div>
  );
}

/** Number that eases to its value when it mounts / changes. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 120, damping: 26 });
  const text = useTransform(spring, (v) => format(v));
  useEffect(() => mv.set(value), [value, mv]);
  return <motion.span>{text}</motion.span>;
}

export function Avatar({ src, name, size = 36 }: { src?: string | null; name: string; size?: number; ring?: string }) {
  const [err, setErr] = useState(false);
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="shrink-0 rounded-full overflow-hidden bg-panel-2" style={{ width: size, height: size }}>
      {src && !err ? (
        <img src={src} alt="" onError={() => setErr(true)} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full grid place-items-center text-[11px] font-semibold text-soft">{initials}</div>
      )}
    </div>
  );
}

export function FormatChip({ format, size = "sm", onMedia }: { format: Format | null | undefined; size?: "sm" | "xs"; onMedia?: boolean }) {
  const m = fmtMeta(format);
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2.5 py-1 text-[13px]" : "px-2 py-0.5 text-[11px]",
        onMedia ? "bg-black/45 text-white backdrop-blur-md" : "bg-fill text-fg",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

export function Pill({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "rose" | "mint" | "amber" | "violet" | "sky"; className?: string }) {
  const tones = {
    neutral: "bg-fill text-soft",
    rose: "bg-rose/12 text-rose",
    mint: "bg-mint/12 text-mint",
    amber: "bg-amber/12 text-amber",
    violet: "bg-violet/12 text-violet",
    sky: "bg-sky/12 text-sky",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function Button({ children, onClick, variant = "primary", disabled, className, type = "button" }: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "outline"; disabled?: boolean; className?: string; type?: "button" | "submit";
}) {
  const v = {
    primary: "bg-accent text-white hover:brightness-110 active:brightness-95",
    ghost: "text-accent hover:bg-fill",
    outline: "bg-fill text-fg hover:bg-fill-2",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx("inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-medium transition-[filter,background-color] disabled:opacity-40 disabled:pointer-events-none cursor-pointer", v[variant], className)}
    >
      {children}
    </button>
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
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <div className="absolute inset-0 bg-black/40" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            className="relative w-full max-w-lg rounded-[20px] bg-panel p-6 shadow-[0_24px_80px_rgb(0_0_0/0.25)] max-h-[85dvh] overflow-auto scroll-thin"
          >
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="text-[17px] font-semibold">{title}</div>
              <button onClick={onClose} aria-label="Close" className="h-7 w-7 grid place-items-center rounded-full bg-fill text-soft hover:bg-fill-2 cursor-pointer"><X size={14} strokeWidth={2.5} /></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Meter({ value, color = "var(--blue)", className }: { value: number | null; color?: string; className?: string }) {
  return (
    <div className={cx("h-1.5 rounded-full bg-fill overflow-hidden", className)}>
      {value != null && (
        <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${Math.max(3, Math.min(100, value * 100))}%` }} transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }} />
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block w-4 h-4 rounded-full border-2 border-current/20 border-t-current animate-spin", className)} />;
}

export function Shimmer({ className }: { className?: string }) {
  return <div className={cx("rounded-[14px] bg-gradient-to-r from-fill via-fill-2 to-fill bg-[length:200%_100%] animate-[shimmer_1.6s_infinite]", className)} />;
}
