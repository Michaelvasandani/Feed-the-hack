import type { Board, Campaign, CreatorRow, Format, FormatRow, Video, VideosFile } from "./types.js";

const num = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, x) => a + (num(x) ?? 0), 0);
/** Average that skips nulls (e.g. carousels have views: null) instead of counting them as 0. */
const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.map(num).filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function buildBoard(c: Campaign, vf: VideosFile): Board {
  const videos = [...vf.videos]
    .map((v) => ({ ...v, format: (v.format ?? "unclassified") as Format }))
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1));

  const creators: CreatorRow[] = c.creators.map((cr) => {
    const keys = Object.entries(cr.handles).filter(([, h]) => h).map(([p, h]) => `${p}:${h!.toLowerCase()}`);
    const mine = videos.filter((v) => keys.includes(`${v.platform}:${v.creatorHandle.toLowerCase()}`));
    const best = Math.max(0, ...mine.map((v) => num(v.viewsPerFollowerPct) ?? 0));
    const overperformer = best >= 100;
    const status = mine.length ? "posted" : "quiet";
    const activityPosts = keys.reduce((a, k) => a + (vf.activity?.[k]?.posts ?? 0), 0);
    const sentiments = mine.map((v) => v.sentiment).filter(Boolean);
    return {
      name: cr.name,
      handles: cr.handles,
      profilePictureUrl: mine.find((v) => v.profilePictureUrl)?.profilePictureUrl ?? null,
      status,
      videos: mine.length,
      views: sum(mine.map((v) => v.views)),
      followers: Math.max(0, ...mine.map((v) => num(v.followers) ?? 0)),
      bestViewsPerFollowerPct: best,
      avgEngagementPerViewPct: avg(mine.map((v) => v.engagementPerViewPct)),
      lastPostedAt: mine.map((v) => v.publishedAt).sort().at(-1) ?? null,
      overperformer,
      recommendation: status === "quiet" ? "nudge" : overperformer ? "rehire" : "keep",
      offBriefPosts: Math.max(0, activityPosts - mine.length),
      sentimentScore: avg(sentiments.map((s) => s!.score)),
      purchaseIntent: avg(sentiments.map((s) => s!.purchaseIntent)),
      avgFirstMentionSeconds: avg(mine.map((v) => v.firstMentionSeconds)),
    } satisfies CreatorRow;
  });
  creators.sort((a, b) => b.views - a.views || (a.status === "quiet" ? 1 : -1));

  const byFormat = new Map<Format, Video[]>();
  for (const v of videos) byFormat.set(v.format as Format, [...(byFormat.get(v.format as Format) ?? []), v]);
  const formats: FormatRow[] = [...byFormat.entries()].map(([format, vs]) => ({
    format,
    videos: vs.length,
    views: sum(vs.map((v) => v.views)),
    avgViewsPerFollowerPct: avg(vs.map((v) => v.viewsPerFollowerPct)),
    avgEngagementPerViewPct: avg(vs.map((v) => v.engagementPerViewPct)),
    winner: false,
  }));
  const eligible = formats.filter((f) => f.videos >= 2 && f.format !== "unclassified" && f.avgViewsPerFollowerPct !== null);
  const pool = eligible.length ? eligible : formats.filter((f) => f.avgViewsPerFollowerPct !== null);
  const win = pool.sort((a, b) => b.avgViewsPerFollowerPct! - a.avgViewsPerFollowerPct!)[0];
  if (win) win.winner = true;
  formats.sort((a, b) => (b.avgViewsPerFollowerPct ?? -1) - (a.avgViewsPerFollowerPct ?? -1));

  const days = new Map<string, { views: number; videos: number }>();
  for (const v of videos) {
    const d = v.publishedAt.slice(0, 10);
    const e = days.get(d) ?? { views: 0, videos: 0 };
    e.views += num(v.views) ?? 0;
    e.videos++;
    days.set(d, e);
  }
  const timeline = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, e]) => ({ date, ...e }));

  const untagged = videos.filter((v) => !v.tagged);
  const mentioned = videos.filter((v) => v.firstMentionSeconds != null);
  return {
    campaign: { id: c.id, brandName: c.brand.name, brief: c.brief, window: c.window },
    generatedAt: Date.now(),
    totals: {
      videos: videos.length,
      views: sum(videos.map((v) => v.views)),
      likes: sum(videos.map((v) => v.likes)),
      comments: sum(videos.map((v) => v.comments)),
      shares: sum(videos.map((v) => v.shares)),
      creatorsPosted: creators.filter((c) => c.status === "posted").length,
      creatorsTotal: creators.length,
      untaggedVideos: untagged.length,
      untaggedViews: sum(untagged.map((v) => v.views)),
      avgEngagementPerViewPct: avg(videos.map((v) => v.engagementPerViewPct)),
      avgSentiment: avg(videos.map((v) => v.sentiment?.score)),
      earlyMentionPct: mentioned.length ? (mentioned.filter((v) => v.firstMentionSeconds! <= 3).length / mentioned.length) * 100 : null,
    },
    creators,
    formats,
    timeline,
    videos,
  };
}
