export type Platform = "instagram" | "tiktok";

export const FORMATS = ["unboxing", "grwm", "review", "haul", "tutorial", "gift_guide", "day_in_life", "other"] as const;
export type Format = (typeof FORMATS)[number] | "unclassified";

export interface Creator {
  name: string;
  handles: Partial<Record<Platform, string>>;
}

export interface Campaign {
  id: string;
  brand: { name: string; aliases: string[]; handles: Partial<Record<Platform, string>>; productImageUrls: string[] };
  brief: string;
  window: { start: string; end: string };
  creators: Creator[];
  discover?: boolean; // also find creators outside the roster who posted about the brand
}

export type MatchSource = "caption" | "transcript" | "onScreenText" | "mention" | "visual";

export interface BrandMoment {
  source: "transcript" | "onScreenText";
  atSeconds: number;
  text: string;
}

export interface Comment {
  handle: string;
  text: string;
  likes: number;
}

export interface Video {
  id: string;
  platform: Platform;
  url: string | null;
  creatorHandle: string;
  creatorName?: string;
  profilePictureUrl?: string | null;
  publishedAt: string;
  caption: string;
  transcript: string | null;
  onScreenText: string[] | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  frameUrls: string[];
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  followers: number | null;
  viewsPerFollowerPct: number | null;
  engagementPerViewPct: number | null;
  matchedBy: MatchSource[];
  tagged: boolean;
  brandMoments?: BrandMoment[];
  firstMentionSeconds?: number | null;
  popularComments?: Comment[];
  format: Format | null;
  formatConfidence?: number;
  formatReason?: string;
  productVisible?: boolean | null;
  sentiment?: Sentiment | null;
  signals?: Signals;
}

/** Per-video read from the intelligence layer (GMI, or a keyword heuristic without a key). */
export interface Signals {
  hook: string;
  hookType: "question" | "bold_claim" | "story" | "problem" | "demo" | "trend" | "other";
  productProminence: "hero" | "featured" | "background" | "none";
  sentiment: "positive" | "mixed" | "neutral" | "negative";
  claims: string[];
  audience: Sentiment | null;
  signalsSource: "gmi" | "heuristic";
}

export interface InsightAction {
  kind: "brief" | "rehire" | "recruit" | "nudge" | "watch";
  title: string;
  detail: string;
}

export interface Insights {
  headline: string;
  actions: InsightAction[];
  nextBrief: string;
  insightsSource: "claude" | "gmi" | "rules";
  insightsModel?: string;
}

export interface Sentiment {
  score: number; // -1..1
  purchaseIntent: number; // 0..1
  summary: string;
  topQuote: string | null;
}

export interface VideosFile {
  campaignId: string;
  fetchedAt: number;
  videos: Video[];
  activity?: Record<string, { posts: number; views: number }>; // all posts per handle in window (any topic)
}

export interface CreatorRow {
  name: string;
  handles: Partial<Record<Platform, string>>;
  profilePictureUrl: string | null;
  status: "posted" | "quiet";
  videos: number;
  views: number;
  followers: number | null;
  bestViewsPerFollowerPct: number | null;
  avgEngagementPerViewPct: number | null;
  lastPostedAt: string | null;
  overperformer: boolean;
  recommendation: "rehire" | "recruit" | "nudge" | "keep";
  discovered?: boolean; // not on the roster; found posting about the brand on their own
  offBriefPosts: number; // posts in window that don't mention the brand
  sentimentScore: number | null;
  purchaseIntent: number | null;
  avgFirstMentionSeconds: number | null;
}

export interface FormatRow {
  format: Format;
  videos: number;
  views: number;
  avgViewsPerFollowerPct: number | null;
  avgEngagementPerViewPct: number | null;
  winner: boolean;
}

export interface Board {
  campaign: { id: string; brandName: string; brief: string; window: { start: string; end: string } };
  generatedAt: number;
  totals: {
    videos: number; views: number; likes: number; comments: number; shares: number;
    creatorsPosted: number; creatorsTotal: number; untaggedVideos: number; untaggedViews: number;
    avgEngagementPerViewPct: number | null; avgSentiment: number | null; earlyMentionPct: number | null;
  };
  creators: CreatorRow[];
  formats: FormatRow[];
  timeline: { date: string; views: number; videos: number }[];
  videos: Video[];
  insights?: Insights;
}
