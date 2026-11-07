import { createAsset, searchAllContents } from "./oriane.js";
import type { BrandMoment, Campaign, MatchSource, Platform, Video, VideosFile } from "./types.js";

const low = (s: unknown) => (typeof s === "string" ? s.toLowerCase() : "");

export function brandTerms(c: Campaign) {
  const aliases = [...new Set([c.brand.name, ...c.brand.aliases].map((a) => a.toLowerCase().trim()).filter(Boolean))];
  const handles = [...new Set(Object.values(c.brand.handles).filter(Boolean).map((h) => h!.toLowerCase()))];
  return { aliases, handles };
}

function rosterPairs(c: Campaign) {
  const pairs = new Map<string, string>(); // "platform:handle" -> creator name
  for (const cr of c.creators) for (const [p, h] of Object.entries(cr.handles)) if (h) pairs.set(`${p}:${h.toLowerCase()}`, cr.name);
  return pairs;
}

function postUrl(r: any): string | null {
  if (r.platform === "tiktok") return `https://www.tiktok.com/@${r.profileHandle}/video/${r.platformId}`;
  // Oriane has no IG shortcode field, but the thumbnail path carries it: .../instagram/<shortcode>/thumbnail.webp
  const sc = String(r.thumbnailMediaUrl ?? "").match(/\/instagram\/([A-Za-z0-9_-]+)\//)?.[1];
  if (sc) return `https://www.instagram.com/p/${sc}/`;
  return `https://www.instagram.com/${r.profileHandle}/`;
}

/** Find where in the video the brand is said or shown, with timestamps. */
function brandMoments(media: any, aliases: string[]): BrandMoment[] {
  const out: BrandMoment[] = [];
  for (const ch of media?.transcriptChunks ?? []) {
    if (aliases.some((a) => low(ch.text).includes(a))) out.push({ source: "transcript", atSeconds: ch.startSeconds ?? 0, text: ch.text });
  }
  const seenText = new Set<string>();
  for (const f of media?.frames ?? []) {
    for (const reg of f.onScreenTextRegions ?? []) {
      if (aliases.some((a) => low(reg.text).includes(a)) && !seenText.has(low(reg.text))) {
        seenText.add(low(reg.text));
        out.push({ source: "onScreenText", atSeconds: f.timestampSeconds ?? 0, text: reg.text });
      }
    }
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}

export function toVideo(r: any, c: Campaign, creatorName?: string): Video {
  const { aliases, handles } = brandTerms(c);
  const m = r.media?.[0] ?? {};
  const ost: string[] | null = m.onScreenText ?? null;
  const tr: string | null = m.transcript ?? null;
  const cap: string = r.caption ?? "";
  const mentions = (r.mentions ?? []).map((x: any) => low(x.profileHandle));
  const matched: MatchSource[] = [];
  if (aliases.some((a) => low(cap).includes(a))) matched.push("caption");
  if (aliases.some((a) => low(tr).includes(a))) matched.push("transcript");
  if (aliases.some((a) => low((ost ?? []).join(" ")).includes(a))) matched.push("onScreenText");
  const tagged =
    handles.some((h) => mentions.includes(h) || low(cap).includes("@" + h)) ||
    aliases.some((a) => low(cap).includes("@" + a));
  if (tagged) matched.push("mention");
  if ((r.matchedQueries ?? []).includes("visual")) matched.push("visual");
  const moments = brandMoments(m, aliases);
  const frames: string[] = (m.frames ?? []).map((f: any) => f.url).filter(Boolean);
  const step = Math.max(1, Math.floor(frames.length / 6));
  return {
    id: r.id,
    platform: r.platform as Platform,
    url: postUrl(r),
    creatorHandle: r.profileHandle,
    creatorName,
    profilePictureUrl: r.profilePictureUrl ?? null,
    publishedAt: r.publishedAt,
    caption: cap,
    transcript: tr,
    onScreenText: ost,
    durationSeconds: m.duration ?? null,
    thumbnailUrl: r.thumbnailMediaUrl ?? null,
    frameUrls: frames.filter((_, i) => i % step === 0).slice(0, 6),
    views: r.viewsCount ?? null,
    likes: r.likesCount ?? null,
    comments: r.commentsCount ?? null,
    shares: r.sharesCount ?? null,
    followers: r.profileFollowersCount ?? null,
    viewsPerFollowerPct: r.viewsRatePerFollowers ?? null,
    engagementPerViewPct: r.engagementRatePerViews ?? null,
    matchedBy: matched,
    tagged,
    brandMoments: moments,
    firstMentionSeconds: moments.length ? moments[0].atSeconds : null,
    popularComments: (r.popularComments ?? [])
      .slice(0, 8)
      .map((x: any) => ({ handle: x.profileHandle, text: x.content, likes: x.likesCount ?? 0 })),
    format: null,
  };
}

export async function fetchVideos(c: Campaign, log: (msg: string) => void = () => {}): Promise<VideosFile> {
  const { aliases, handles } = brandTerms(c);
  const pairs = rosterPairs(c);
  const rosterHandles = [...new Set(c.creators.flatMap((cr) => Object.values(cr.handles).filter(Boolean) as string[]))];
  const base = {
    profileHandle: { exactMatch: { values: rosterHandles } },
    publishedAt: { after: c.window.start, before: c.window.end },
    platform: { includes: ["instagram", "tiktok"] },
  };

  const textQuery: any = {
    name: "text",
    operator: "or",
    filters: {
      transcript: { includesExactly: { values: aliases } },
      onScreenText: { includesExactly: { values: aliases } },
      caption: { includesExactly: { values: aliases } },
      ...(handles.length ? { mentionHandles: { exactMatch: { values: handles } } } : {}),
    },
  };
  const queries: any[] = [textQuery];

  const images = (c.brand.productImageUrls ?? []).filter(Boolean).slice(0, 10);
  if (images.length) {
    log(`Uploading ${images.length} product image(s) for visual search…`);
    const ids = await Promise.all(images.map((url) => createAsset({ type: "url", url }).catch(() => null)));
    const values = ids.filter(Boolean).map((assetId) => ({ assetId, minScore: 0.8 }));
    if (values.length) queries.push({ name: "visual", operator: "or", filters: { visualSimilarity: { includes: { values } } } });
  }

  log(`Searching Oriane for ${aliases.join(", ")} across ${rosterHandles.length} creator handles…`);
  const [{ results }, activity] = await Promise.all([
    searchAllContents({ operator: "and", filters: base, queries: [{ operator: "or", queries }] }, { projection: "full", sort: "publishedAt:desc", maxResults: 500 }),
    fetchActivity(base).catch(() => ({})),
  ]);

  const videos = results
    .filter((r) => pairs.has(`${r.platform}:${low(r.profileHandle)}`))
    .map((r) => toVideo(r, c, pairs.get(`${r.platform}:${low(r.profileHandle)}`)));
  log(`Found ${videos.length} campaign videos (${videos.filter((v) => !v.tagged).length} untagged).`);
  return { campaignId: c.id, fetchedAt: Date.now(), videos, activity };
}

/** Every post by the roster in the window, brand or not — tells us who's active but off-brief. */
async function fetchActivity(baseFilters: any) {
  const { results } = await searchAllContents({ operator: "and", filters: baseFilters }, { projection: "basic", maxResults: 500 });
  const out: Record<string, { posts: number; views: number }> = {};
  for (const r of results) {
    const k = `${r.platform}:${low(r.profileHandle)}`;
    out[k] ??= { posts: 0, views: 0 };
    out[k].posts++;
    out[k].views += r.viewsCount ?? 0;
  }
  return out;
}
