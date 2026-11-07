import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chatJSON, type ChatMessage } from "./gmi.js";
import { FORMATS, type Format, type Sentiment, type Video } from "./types.js";

const CACHE_PATH = resolve(process.cwd(), "data/cache/classify.json");
type Label = { format: Format; confidence: number; reason: string; productVisible: boolean | null; sentiment: Sentiment | null };
let cache: Record<string, Label> = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};
const saveCache = () => {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache));
};

const SYSTEM = `You label short-form social videos (TikTok / Instagram) for an influencer-marketing agency.
Formats (pick exactly one):
- unboxing: opening a package / PR box, first reveal of products
- grwm: "get ready with me" — creator does their makeup/outfit while talking
- review: verdict-focused; tries a product and rates/judges it (incl. "first impressions", "worth it?")
- haul: showing off many purchased items
- tutorial: step-by-step how-to the viewer can follow
- gift_guide: gift ideas / holiday wishlist / "what to buy"
- day_in_life: vlog of the creator's day where products appear incidentally
- other: none of the above
Always write reason and summary in English (quotes stay verbatim).
Return strict JSON:
{"format": one of the formats, "confidence": 0..1, "reason": "<=18 words, cite evidence",
 "productVisible": true|false|null (is a product from the brand visibly shown in the frames; null if no frames),
 "sentiment": null if no comments, else {"score": -1..1 audience feeling toward the video/brand, "purchaseIntent": 0..1 share of comments signalling wanting/buying the product, "summary": "<=14 words on what the audience is saying", "topQuote": "most telling comment, verbatim, or null"}}`;

function userMessage(v: Video, brand: string, withFrames: boolean): ChatMessage {
  const text = [
    `Brand: ${brand}`,
    `Platform: ${v.platform}, duration ${v.durationSeconds ?? "?"}s`,
    `Caption: ${v.caption?.slice(0, 1200) || "(none)"}`,
    `Transcript: ${v.transcript ? v.transcript.slice(0, 2500) : "(not available)"}`,
    `On-screen text: ${v.onScreenText?.length ? v.onScreenText.slice(0, 30).join(" | ") : "(not available)"}`,
    `Top comments: ${v.popularComments?.length ? v.popularComments.map((c) => `[${c.likes}♥] ${c.text}`).join("\n") : "(none)"}`,
  ].join("\n");
  const frames = withFrames ? v.frameUrls.slice(0, 3) : [];
  if (!frames.length) return { role: "user", content: text };
  return { role: "user", content: [{ type: "text", text }, ...frames.map((url) => ({ type: "image_url" as const, image_url: { url } }))] };
}

/** Cheap keyword fallback when the LLM is unavailable. */
export function heuristicFormat(v: Video): Label {
  const t = `${v.caption} ${v.transcript ?? ""} ${(v.onScreenText ?? []).join(" ")}`.toLowerCase();
  const rules: [Format, RegExp][] = [
    ["grwm", /\bgrwm\b|get ready with me/],
    ["unboxing", /unbox|pr package|what'?s in the box|opening/],
    ["gift_guide", /gift guide|gift ideas|christmas list|wishlist|stocking stuffer/],
    ["haul", /\bhaul\b|everything i bought/],
    ["tutorial", /tutorial|how to|step \d|hack/],
    ["review", /review|worth it|honest|first impression|rating/],
    ["day_in_life", /day in (my|the) life|vlog/],
  ];
  const hit = rules.find(([, re]) => re.test(t));
  return { format: hit?.[0] ?? "other", confidence: hit ? 0.55 : 0.3, reason: hit ? "Keyword match in caption/transcript" : "No clear format signal", productVisible: null, sentiment: null };
}

function normalize(raw: any): Label {
  const format = (FORMATS as readonly string[]).includes(raw?.format) ? (raw.format as Format) : "other";
  const s = raw?.sentiment;
  return {
    format,
    confidence: Math.max(0, Math.min(1, Number(raw?.confidence ?? 0.5))),
    reason: String(raw?.reason ?? "").slice(0, 160),
    productVisible: typeof raw?.productVisible === "boolean" ? raw.productVisible : null,
    sentiment: s && typeof s === "object"
      ? { score: Math.max(-1, Math.min(1, Number(s.score ?? 0))), purchaseIntent: Math.max(0, Math.min(1, Number(s.purchaseIntent ?? 0))), summary: String(s.summary ?? ""), topQuote: s.topQuote ? String(s.topQuote) : null }
      : null,
  };
}

async function classifyOne(v: Video, brand: string): Promise<Label> {
  const sys: ChatMessage = { role: "system", content: SYSTEM };
  try {
    return normalize(await chatJSON([sys, userMessage(v, brand, true)]));
  } catch {
    try {
      return normalize(await chatJSON([sys, userMessage(v, brand, false)])); // frames unreachable → text only
    } catch {
      return heuristicFormat(v);
    }
  }
}

export async function classifyVideos(videos: Video[], brand: string, log: (m: string) => void = () => {}, concurrency = 10): Promise<Video[]> {
  const todo = videos.filter((v) => !cache[v.id]);
  log(`Classifying ${todo.length} new videos with GMI vision LLM (${videos.length - todo.length} cached)…`);
  let i = 0, done = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
      while (i < todo.length) {
        const v = todo[i++];
        cache[v.id] = await classifyOne(v, brand);
        if (++done % 5 === 0 || done === todo.length) log(`Classified ${done}/${todo.length}`);
      }
    }),
  );
  if (todo.length) saveCache();
  return videos.map((v) => {
    const l = cache[v.id];
    return { ...v, format: l.format, formatConfidence: l.confidence, formatReason: l.reason, productVisible: l.productVisible, sentiment: l.sentiment };
  });
}
