import { brandTerms, toVideo } from "./fetch.js";
import { chat, chatJSON, getGeneration, submitGeneration } from "./gmi.js";
import { env } from "./env.js";
import { searchAllContents, searchProfiles } from "./oriane.js";
import type { Board, Campaign, CreatorRow, Video } from "./types.js";

const fmtPct = (x: number | null | undefined) => (x == null ? "n/a" : `${Math.round(x)}%`);

// ---------- Discover: organic fans already posting about the brand, not on the roster ----------

export interface Prospect {
  handle: string;
  platform: string;
  displayName: string | null;
  profilePictureUrl: string | null;
  followers: number | null;
  bio: string | null;
  publicEmail: string | null;
  videos: number;
  views: number;
  bestViewsPerFollowerPct: number | null;
  tagged: boolean;
  topVideo: Pick<Video, "id" | "url" | "thumbnailUrl" | "caption" | "views" | "viewsPerFollowerPct" | "matchedBy">;
}

export async function discoverCreators(c: Campaign, limit = 12): Promise<Prospect[]> {
  const { aliases, handles } = brandTerms(c);
  const roster = new Set(c.creators.flatMap((cr) => Object.values(cr.handles).filter(Boolean).map((h) => h!.toLowerCase())));
  const brandOwn = new Set(handles);
  const { results } = await searchAllContents(
    {
      operator: "and",
      filters: {
        publishedAt: { after: c.window.start, before: c.window.end },
        platform: { includes: ["instagram", "tiktok"] },
        profileFollowersCount: { min: 5000 },
      },
      queries: [{ operator: "or", filters: { transcript: { includesExactly: { values: aliases } }, onScreenText: { includesExactly: { values: aliases } }, caption: { includesExactly: { values: aliases } } } }],
    },
    { projection: "full", sort: "viewsRatePerFollowers:desc", maxResults: 200 },
  );

  const groups = new Map<string, Video[]>();
  const raw = new Map<string, any>();
  for (const r of results) {
    const h = String(r.profileHandle).toLowerCase();
    if (roster.has(h) || brandOwn.has(h)) continue;
    const k = `${r.platform}:${h}`;
    groups.set(k, [...(groups.get(k) ?? []), toVideo(r, c)]);
    if (!raw.has(k)) raw.set(k, r);
  }
  const ranked = [...groups.entries()]
    .map(([k, vs]) => ({ k, vs, best: Math.max(...vs.map((v) => v.viewsPerFollowerPct ?? 0)), views: vs.reduce((a, v) => a + (v.views ?? 0), 0) }))
    .sort((a, b) => b.best - a.best)
    .slice(0, limit);

  // Enrich with profile data (bio, public email) in one profiles call.
  const profiles = await searchProfiles(
    { operator: "and", filters: { handle: { exactMatch: { values: ranked.map((r) => raw.get(r.k).profileHandle) } } } },
    { limit: 100, projection: "full" },
  ).catch(() => null);
  const byKey = new Map<string, any>((profiles?.data?.results ?? []).map((p: any) => [`${p.platform}:${String(p.handle).toLowerCase()}`, p]));

  return ranked.map(({ k, vs, best, views }) => {
    const r = raw.get(k);
    const p = byKey.get(k);
    const top = [...vs].sort((a, b) => (b.viewsPerFollowerPct ?? 0) - (a.viewsPerFollowerPct ?? 0))[0];
    return {
      handle: r.profileHandle,
      platform: r.platform,
      displayName: r.profileDisplayName ?? p?.displayName ?? null,
      profilePictureUrl: r.profilePictureUrl ?? p?.profilePictureUrl ?? null,
      followers: r.profileFollowersCount ?? p?.followersCount ?? null,
      bio: p?.bio ?? r.profileBio ?? null,
      publicEmail: p?.publicEmail ?? null,
      videos: vs.length,
      views,
      bestViewsPerFollowerPct: best,
      tagged: vs.some((v) => v.tagged),
      topVideo: { id: top.id, url: top.url, thumbnailUrl: top.thumbnailUrl, caption: top.caption, views: top.views, viewsPerFollowerPct: top.viewsPerFollowerPct, matchedBy: top.matchedBy },
    };
  });
}

// ---------- Outreach drafts ----------

export async function draftMessage(board: Board, creator: CreatorRow): Promise<{ subject: string; body: string }> {
  const vids = board.videos.filter((v) => Object.values(creator.handles).some((h) => h?.toLowerCase() === v.creatorHandle.toLowerCase()));
  const win = board.formats.find((f) => f.winner);
  const ctx = {
    brand: board.campaign.brandName,
    brief: board.campaign.brief,
    window: board.campaign.window,
    creator: { name: creator.name, status: creator.status, recommendation: creator.recommendation, views: creator.views, bestViewsPerFollowerPct: creator.bestViewsPerFollowerPct, offBriefPosts: creator.offBriefPosts, sentiment: creator.sentimentScore, purchaseIntent: creator.purchaseIntent },
    theirVideos: vids.slice(0, 3).map((v) => ({ format: v.format, views: v.views, caption: v.caption.slice(0, 160), audience: v.sentiment?.summary, topComment: v.sentiment?.topQuote })),
    winningFormat: win?.format,
  };
  return chatJSON<{ subject: string; body: string }>(
    [
      {
        role: "system",
        content:
          "You are a warm, concise influencer-campaign manager at an agency. Write a short DM/email (max 110 words) to a UGC creator. " +
          "nudge = they haven't posted for the campaign yet: friendly reminder, restate the one key ask from the brief, suggest the winning format, offer help. " +
          "rehire = they overperformed: celebrate a specific number or audience reaction, propose a follow-up collab. keep = thank them and suggest one concrete improvement. " +
          'No hashtags, no emojis overload (max 1). Return JSON {"subject": "...", "body": "..."}',
      },
      { role: "user", content: JSON.stringify(ctx) },
    ],
    { model: env.fastModel },
  );
}

// ---------- Next brief (+ video prompt) ----------

export interface NextBrief {
  headline: string;
  format: string;
  why: string[];
  hook: string;
  mustDo: string[];
  avoid: string[];
  shotList: string[];
  videoPrompt: string;
}

export async function nextBrief(board: Board): Promise<NextBrief> {
  const top = board.videos.filter((v) => v.views != null).slice(0, 6);
  const ctx = {
    brand: board.campaign.brandName,
    currentBrief: board.campaign.brief,
    totals: board.totals,
    formats: board.formats.map((f) => ({ format: f.format, videos: f.videos, avgViewsPerFollower: fmtPct(f.avgViewsPerFollowerPct), avgEngagement: fmtPct(f.avgEngagementPerViewPct), winner: f.winner })),
    topVideos: top.map((v) => ({
      format: v.format, views: v.views, viewsPerFollower: fmtPct(v.viewsPerFollowerPct), firstBrandMentionSec: v.firstMentionSeconds,
      tagged: v.tagged, caption: v.caption.slice(0, 200), transcriptStart: v.transcript?.slice(0, 300), audience: v.sentiment?.summary, topComment: v.sentiment?.topQuote,
    })),
  };
  return chatJSON<NextBrief>([
    {
      role: "system",
      content:
        "You are a senior creative strategist. From this campaign data, write the NEXT creator brief that doubles down on what worked. Be specific and evidence-based (cite numbers). " +
        'Return JSON {"headline": "<=10 words", "format": "<winning format>", "why": ["3 evidence bullets"], "hook": "the exact first line the creator should say", ' +
        '"mustDo": ["3-4 bullets"], "avoid": ["2-3 bullets"], "shotList": ["5 short shots with seconds, e.g. 0-2s: ..."], ' +
        '"videoPrompt": "a vivid 9:16 text-to-video prompt (<=600 chars) for an 8s sample UGC clip in this format; describe the creator, setting, lighting, camera moves and product moment; no on-screen text, no logos"}',
    },
    { role: "user", content: JSON.stringify(ctx) },
  ]);
}

export async function generateSampleVideo(prompt: string) {
  return submitGeneration(env.videoModel, { prompt, aspect_ratio: "9:16", duration: "8", resolution: "720p" });
}
export const sampleVideoStatus = getGeneration;

// ---------- Ask the board (natural-language Q&A over campaign data) ----------

export async function askBoard(board: Board, question: string): Promise<string> {
  const slim = {
    campaign: board.campaign,
    totals: board.totals,
    creators: board.creators,
    formats: board.formats,
    videos: board.videos.map((v) => ({ creator: v.creatorHandle, platform: v.platform, date: v.publishedAt.slice(0, 10), format: v.format, views: v.views, vpf: v.viewsPerFollowerPct, eng: v.engagementPerViewPct, tagged: v.tagged, matchedBy: v.matchedBy, firstMentionSec: v.firstMentionSeconds, productVisible: v.productVisible, audience: v.sentiment?.summary, intent: v.sentiment?.purchaseIntent })),
  };
  return chat(
    [
      { role: "system", content: "You are a sharp campaign analyst. Answer the agency's question using ONLY the JSON data. Be concise (<=120 words), lead with the answer, cite creators and numbers. Use markdown bullets when listing." },
      { role: "user", content: `DATA:\n${JSON.stringify(slim)}\n\nQUESTION: ${question}` },
    ],
    { model: env.fastModel },
  );
}
