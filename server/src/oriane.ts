import { env } from "./env.js";

const BASE = "https://connect.oriane.xyz/rest";

export class OrianeError extends Error {}

async function call<T = any>(path: string, body: unknown, qs: Record<string, string | number | undefined> = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(qs)) if (v !== undefined) params.set(k, String(v));
  const url = `${BASE}${path}${params.size ? `?${params}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.oriane}` },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new OrianeError(`Oriane ${path} ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 400)}`);
  return json;
}

export interface SearchOpts {
  limit?: number;
  offset?: number;
  projection?: "basic" | "default" | "full";
  sort?: string;
  aiSearchAnchor?: string;
}

export const searchContents = (body: unknown, o: SearchOpts = {}) =>
  call("/contents/search", body, { limit: o.limit ?? 100, offset: o.offset, projection: o.projection ?? "full", sort: o.sort, aiSearchAnchor: o.aiSearchAnchor });

export const searchProfiles = (body: unknown, o: SearchOpts = {}) =>
  call("/profiles/search", body, { limit: o.limit ?? 20, offset: o.offset, projection: o.projection ?? "full", sort: o.sort });

/** Fetch every page (up to maxResults) of a contents search. */
export async function searchAllContents(body: unknown, o: SearchOpts & { maxResults?: number } = {}) {
  const max = o.maxResults ?? 500;
  const results: any[] = [];
  let anchor: string | undefined;
  let aggregations: any = null;
  for (let offset = 0; offset < max; offset += 100) {
    const r = await searchContents(body, { ...o, limit: Math.min(100, max - offset), offset, aiSearchAnchor: anchor });
    aggregations ??= r.data?.aggregations ?? null;
    const page = r.data?.results ?? [];
    results.push(...page);
    anchor = r.metadata?.pagination?.aiSearchAnchor ?? r.metadata?.aiSearchAnchor ?? anchor;
    const total = r.metadata?.pagination?.totalCount ?? 0;
    if (page.length === 0 || results.length >= total) break;
  }
  return { results, aggregations };
}

/** Create a reusable text or image asset for visual similarity search. */
export async function createAsset(input: { type: "text"; text: string } | { type: "url"; url: string }): Promise<string> {
  const r = await call<any>("/assets", input);
  return r.data?.id ?? r.id;
}
