import type { Board, Campaign, Format, SearchMetadata, Video } from "./types";

// ---------- API ----------

async function json<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  // FastAPI reports errors as `detail`.
  if (!res.ok || data?.error) throw new Error(data?.error ?? data?.detail ?? `HTTP ${res.status}`);
  return data as T;
}

export type RunEvent =
  | { type: "progress"; message: string }
  | { type: "stage"; stage: "classify" | "metrics" }
  | { type: "done"; board: Board }
  | { type: "error"; message: string };

export async function runCampaign(campaign: Campaign, source: "live" | "fixtures", onEvent: (e: RunEvent) => void) {
  const res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaign, source }) });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? err?.detail ?? `HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const l of lines) if (l.trim()) onEvent(JSON.parse(l));
  }
}

export interface Prospect {
  handle: string; platform: string; displayName: string | null; profilePictureUrl: string | null; followers: number | null;
  bio: string | null; publicEmail: string | null; videos: number; views: number; bestViewsPerFollowerPct: number | null; tagged: boolean;
  topVideo: { id: string; url: string | null; thumbnailUrl: string | null; caption: string; views: number | null; viewsPerFollowerPct: number | null; matchedBy: string[] };
}
export interface NextBrief { headline: string; format: string; why: string[]; hook: string; mustDo: string[]; avoid: string[]; shotList: string[]; videoPrompt: string; briefSource?: "gmi" | "rules"; briefModel?: string }
export interface DiscoveryResult { prospects: Prospect[]; search: SearchMetadata; candidates: Video[] }

export const api = {
  demoCampaign: () => json<Campaign>("/api/demo-campaign"),
  boards: () => json<{ id: string; brandName: string; videos: number; views: number; generatedAt: number }[]>("/api/boards"),
  campaign: (id: string) => json<Campaign>(`/api/campaigns/${id}`),
  board: (id: string) => json<Board>(`/api/boards/${id}`),
  discover: (id: string, refresh = false) => json<DiscoveryResult>(`/api/boards/${id}/discover`, { refresh }),
  draft: (id: string, creatorName: string) => json<{ subject: string; body: string }>(`/api/boards/${id}/draft`, { creatorName }),
  brief: (id: string, refresh = false) => json<NextBrief>(`/api/boards/${id}/brief`, { refresh }),
  ask: (id: string, question: string) => json<{ answer: string }>(`/api/boards/${id}/ask`, { question }),
  video: (prompt: string) => json<{ request_id: string; status: string }>("/api/video", { prompt }),
  videoStatus: (rid: string, boardId: string) => json<{ status: string; videoUrl: string | null }>(`/api/video/${rid}?board=${encodeURIComponent(boardId)}`),
};

// ---------- formatting ----------

export const compact = (n: number | null | undefined) =>
  n == null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: n >= 1e6 ? 1 : 0 }).format(n);
export const pct = (n: number | null | undefined, digits = 0) => (n == null ? "—" : `${n.toFixed(digits)}%`);
/** Views-per-follower as a multiplier: 1854% → "18.5×" */
export const mult = (p: number | null | undefined) => (p == null ? "—" : p >= 1000 ? `${Math.round(p / 100)}×` : `${(p / 100).toFixed(1)}×`);
export const secs = (s: number | null | undefined) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
// Date-only strings ("2026-10-01") parse as UTC midnight; pin them to local noon so they don't shift a day.
export const date = (iso: string | null | undefined) => (iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00` : iso).toLocaleDateString("en", { month: "short", day: "numeric" }) : "—");

// Categorical slots in fixed order — validated (dataviz validator) on the #0e0e15 dark surface.
export const FORMAT_META: Record<Format, { label: string; color: string; emoji: string }> = {
  haul: { label: "Haul", color: "#3987e5", emoji: "🛍️" },
  unboxing: { label: "Unboxing", color: "#d95926", emoji: "📦" },
  tutorial: { label: "Tutorial", color: "#199e70", emoji: "🎓" },
  gift_guide: { label: "Gift guide", color: "#c98500", emoji: "🎁" },
  grwm: { label: "GRWM", color: "#d55181", emoji: "💄" },
  day_in_life: { label: "Day in life", color: "#008300", emoji: "☀️" },
  review: { label: "Review", color: "#9085e9", emoji: "⭐" },
  other: { label: "Other", color: "#7c7f8e", emoji: "✳️" },
  unclassified: { label: "Unclassified", color: "#5c5f6e", emoji: "…" },
};
export const fmtMeta = (f: Format | null | undefined) => FORMAT_META[(f ?? "unclassified") as Format] ?? FORMAT_META.other;

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
