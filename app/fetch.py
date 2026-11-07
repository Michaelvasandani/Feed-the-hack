"""Bounded multi-pass Oriane retrieval with explicit coverage and ranked evidence."""
from datetime import date, datetime, timezone
import json
import os
import re
import urllib.error
from urllib.parse import urlencode, urlparse
import urllib.request

from app.env import load_env
from app.search import VERSION, aliases, exact_brand_tag, fuse_results, handle, text_evidence

BASE = "https://connect.oriane.xyz/rest"
PAGE = 100
MAX_PAGES = 20
MAX_REQUESTS = 40
VISUAL_MIN_SCORE = float(os.environ.get("VISUAL_MIN_SCORE", "0.82"))
DISCOVER_MAX_VIDEOS = 200


class OrianeError(RuntimeError):
    pass


def _post(path, body, params=None):
    load_env()
    key = os.environ.get("ORIANE_API_KEY")
    if not key:
        raise OrianeError("ORIANE_API_KEY is not set (run scripts/set-oriane-key.sh)")
    qs = "?" + urlencode(params) if params else ""
    req = urllib.request.Request(f"{BASE}/{path}{qs}", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = json.load(r)
    except urllib.error.HTTPError as e:
        message = e.read()[:500].decode(errors="replace").replace(key, "[REDACTED]")
        raise OrianeError(f"{path}: HTTP {e.code} {message}") from e
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise OrianeError(f"{path}: {type(e).__name__}") from e
    if not isinstance(raw, dict) or raw.get("error"):
        raise OrianeError(f"{path}: invalid or unsuccessful response")
    return raw


def create_image_asset(url):
    return _post("assets", {"type": "image", "image": {"type": "url", "url": url}})["data"]["id"]


def build_query(camp, asset_ids=(), handles=None, *, platform=None, channel="text"):
    """One OR match group beneath scope filters; tags are platform-specific."""
    names = aliases(camp)
    brand_handles = sorted({handle(h) for p, h in (camp["brand"].get("handles") or {}).items()
                            if h and (platform is None or platform == p)})
    published = {"after": camp["window"]["start"]}
    if camp["window"].get("end"):
        published["before"] = camp["window"]["end"]
    match = {}
    if channel == "text":
        hashtags = ["#" + re.sub(r"\W", "", a) for a in names if " " in a]
        match = {"transcript": {"includesExactly": {"values": names}},
                 "onScreenText": {"includesExactly": {"values": names}},
                 "caption": {"includesExactly": {"values": names + hashtags}}}
    if channel in ("text", "mention") and brand_handles:
        match["mentionHandles"] = {"exactMatch": {"values": brand_handles}}
        if channel == "mention":
            match["caption"] = {"includesExactly": {"values": ["@" + h for h in brand_handles]}}
    if channel == "visual" and asset_ids:
        match["visualSimilarity"] = {"includes": {"values": [
            {"assetId": a, "minScore": VISUAL_MIN_SCORE} for a in asset_ids]}}
    if not match:
        raise ValueError(f"No operands for {channel} search")
    filters = {"publishedAt": published, "platform": {"includes": [platform] if platform else ["instagram", "tiktok"]},
               "format": {"includes": ["video"]}}
    if handles is not None:
        filters["profileHandle"] = {"exactMatch": {"values": sorted({handle(h) for h in handles})}}
    else:
        d = camp.get("discovery") or {}
        followers = {k: d[f] for k, f in [("min", "minFollowers"), ("max", "maxFollowers")] if d.get(f) is not None}
        if followers:
            filters["profileFollowersCount"] = followers
    query = {"operator": "and", "filters": filters,
             "queries": [{"name": channel, "operator": "or", "filters": match}]}
    def count(value):
        if isinstance(value, dict):
            return sum(count(v) for k, v in value.items() if k not in ("operator", "name"))
        return sum(map(count, value)) if isinstance(value, list) else 1
    if count(query) > 500 or len(asset_ids) > 10:
        raise ValueError("Campaign exceeds Oriane's 500 filter-value / 10 visual-value limits")
    return query


def search_all(body, sort="publishedAt:desc", max_results=PAGE * MAX_PAGES, *, report=None, budget=None):
    report = report if report is not None else {}
    report.update(complete=False, pages=0, rawCount=0, reason=None)
    results, seen_pages, anchor, offset, ts, total = [], set(), None, 0, None, None
    visual = "visualSimilarity" in body["queries"][0]["filters"]
    while offset < max_results and report["pages"] < MAX_PAGES:
        if budget is not None and budget["remaining"] <= 0:
            report["reason"] = "request_budget"
            break
        params = {"limit": min(PAGE, max_results - offset), "offset": offset, "projection": "full", "sort": sort}
        if anchor:
            params["aiSearchAnchor"] = anchor
        if budget is not None:
            budget["remaining"] -= 1
        try:
            raw = _post("contents/search", body, params)
        except OrianeError as error:
            report["reason"] = str(error)
            break
        page = (raw.get("data") or {}).get("results")
        if not isinstance(page, list) or any(not isinstance(r, dict) or not r.get("id") for r in page):
            report["reason"] = "invalid_page"
            break
        report["pages"] += 1
        meta = raw.get("metadata") or {}
        ts = ts or meta.get("timestamp")
        pag = meta.get("pagination") or {}
        new_total = pag.get("totalCount")
        if isinstance(new_total, int):
            if total is not None and new_total != total:
                report["reason"] = "total_changed"
            total = new_total
        if not page:
            report["complete"] = not report["reason"] and (total is None or offset >= total)
            report["reason"] = report["reason"] or (None if report["complete"] else "unexpected_empty_page")
            break
        fingerprint = tuple(sorted(r["id"] for r in page))
        if fingerprint in seen_pages:
            report["reason"] = "repeated_page"
            break
        seen_pages.add(fingerprint)
        results.extend(page)
        offset += len(page)  # Advance before local filtering/deduplication.
        report["rawCount"] = offset
        next_anchor = pag.get("aiSearchAnchor")
        if anchor and next_anchor and anchor != next_anchor:
            report["reason"] = "anchor_changed"
            break
        anchor = anchor or next_anchor
        if total is not None and offset >= total:
            report["complete"] = not report["reason"]
            break
        if visual and not anchor:
            report["reason"] = "missing_visual_anchor"
            break
    if not report["complete"] and not report["reason"]:
        report["reason"] = "candidate_limit" if offset >= max_results else "page_limit"
    report["totalCount"] = total
    return results, ts


def video_url(r):
    if r["platform"] == "tiktok":
        return f'https://www.tiktok.com/@{r["profileHandle"]}/video/{r["platformId"]}' if r.get("platformId") else f'https://www.tiktok.com/@{r["profileHandle"]}'
    # Oriane returns no Instagram shortcode, but the thumbnail path carries it.
    m = re.search(r"/instagram/([A-Za-z0-9_-]{6,})/", r.get("thumbnailMediaUrl") or "")
    return f"https://www.instagram.com/p/{m.group(1)}/" if m else f'https://www.instagram.com/{r["profileHandle"]}/'


def to_video(r, camp):
    media = r.get("media") or []
    transcripts = list(dict.fromkeys(m["transcript"] for m in media if m.get("transcript")))
    ost = list(dict.fromkeys(t for m in media for t in m.get("onScreenText") or []))
    frames = list(dict.fromkeys(f["url"] for m in media for f in m.get("frames") or [] if f.get("url")))
    video = {
        "id": r["id"], "platform": r["platform"], "contentFormat": r.get("format"), "url": video_url(r),
        "creatorHandle": r["profileHandle"], "publishedAt": r["publishedAt"],
        "caption": r.get("caption") or "", "transcript": "\n".join(transcripts) or None,
        "onScreenText": ost or None, "durationSeconds": sum(m.get("duration") or 0 for m in media) or None,
        "thumbnailUrl": r.get("thumbnailMediaUrl"),
        "frameUrls": frames[::max(1, len(frames) // 6)][:6],
        "views": r.get("viewsCount"), "likes": r.get("likesCount"), "comments": r.get("commentsCount"),
        "shares": r.get("sharesCount"), "followers": r.get("profileFollowersCount"),
        "viewsPerFollowerPct": r.get("viewsRatePerFollowers"),
        "engagementPerViewPct": r.get("engagementRatePerViews"),
        "retrievalScore": r.get("_rrfScore", 0), "retrievalRanks": r.get("_retrievalRanks", []), "format": None,
    }
    brand_handle = (camp["brand"].get("handles") or {}).get(r["platform"], "")
    video["tagged"] = exact_brand_tag(video["caption"], r.get("mentions") or [], brand_handle)
    evidence = [{"kind": e["kind"], "alias": e["alias"], "excerpt": e["text"][:500]} for e in text_evidence(video, camp)]
    if video["tagged"]:
        evidence.append({"kind": "mention", "handle": handle(brand_handle)})
    evidence.extend(r.get("_visualEvidence", []))
    video["matchEvidence"] = evidence
    video["matchedBy"] = list(dict.fromkeys(e["kind"] for e in evidence))
    return video


def keep_result(r, camp, roster):
    """Roster videos always count; with discovery on, so does anyone but the brand itself."""
    key = (r["platform"], handle(r["profileHandle"]))
    if key in roster:
        return True
    if not camp.get("discover"):
        return False
    brand_handle = (camp["brand"].get("handles") or {}).get(key[0], "")
    skip = {handle(h) for h in (camp.get("discovery") or {}).get("excludeHandles", [])}
    return key[1] != handle(brand_handle) and key[1] not in skip


def validate_campaign(camp):
    if not aliases(camp):
        raise ValueError("Add at least one nonempty brand alias")
    start = date.fromisoformat(camp.get("window", {}).get("start", ""))
    end = date.fromisoformat(camp["window"]["end"]) if camp["window"].get("end") else date.max
    if end < start:
        raise ValueError("Window end must be on or after its start")
    d = camp.get("discovery") or {}
    for name, default in (("maxVideos", 200), ("maxCandidates", 600), ("maxPerCreator", 3)):
        value = d.get(name) if d.get(name) is not None else default
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 2000:
            raise ValueError(f"{name} must be an integer between 1 and 2000")
    for name in ("minFollowers", "maxFollowers"):
        value = d.get(name)
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
            raise ValueError(f"{name} must be a nonnegative integer")
    if d.get("maxFollowers") is not None and d["maxFollowers"] < (d.get("minFollowers") or 0):
        raise ValueError("maxFollowers must be at least minFollowers")
    images = camp["brand"].get("productImageUrls") or []
    if len(images) > 10 or any(urlparse(u).scheme != "https" or not urlparse(u).hostname for u in images):
        raise ValueError("Use at most 10 public HTTPS product-image URLs")
    for creator in camp.get("creators") or []:
        if any(p not in ("instagram", "tiktok") or not handle(h) for p, h in creator["handles"].items()):
            raise ValueError("Each creator needs valid Instagram/TikTok handles")


def in_scope(r, camp):
    if r.get("platform") not in ("instagram", "tiktok") or r.get("format") != "video":
        return False
    try:
        timestamp = datetime.fromisoformat(r["publishedAt"].replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            return False
        day = timestamp.astimezone(timezone.utc).date()
    except (KeyError, TypeError, ValueError):
        return False
    return date.fromisoformat(camp["window"]["start"]) <= day <= date.fromisoformat(camp["window"].get("end") or "9999-12-31")


def fetch_videos(camp):
    validate_campaign(camp)
    roster = {(p, handle(h)) for c in camp.get("creators") or [] for p, h in c["handles"].items()}
    d = camp.get("discovery") or {}
    cap = d.get("maxVideos") or DISCOVER_MAX_VIDEOS
    pool = d.get("maxCandidates") or min(2000, cap * 3)
    images = list(dict.fromkeys(camp["brand"].get("productImageUrls") or []))
    streams = []
    # Validate all query shapes before creating any paid image assets.
    for platform in ("instagram", "tiktok"):
        handles = {h for p, h in roster if p == platform}
        scopes = (["roster"] if handles else []) + (["discovery"] if camp.get("discover") else [])
        for scope in scopes:
            base = dict(platform=platform, handles=handles if scope == "roster" else None)
            choices = [("text", "transcriptRelevance:desc,viewsCount:desc", 1.0, None)]
            if scope == "discovery":
                choices.append(("recent", "publishedAt:desc", 0.7, None))
                if (camp["brand"].get("handles") or {}).get(platform):
                    choices.append(("mention", "viewsCount:desc", 1.2, None))
            # Similar reference images must not multiply the visual channel's weight.
            choices += [("visual", "visualSimilarity:desc", 0.8 / len(images), i) for i in range(len(images))]
            for channel, sort, weight, image_index in choices:
                body = build_query(camp, ["asset-placeholder"] if channel == "visual" else [], **base,
                                   channel="text" if channel == "recent" else channel)
                streams.append({"scope": scope, "platform": platform, "channel": channel, "sort": sort,
                                "weight": weight if scope == "discovery" else 0,
                                "imageIndex": image_index, "body": body})
    asset_ids = [create_image_asset(u) for u in images]
    discovery_count = sum(s["scope"] == "discovery" for s in streams)
    if d.get("maxCandidates") is None:
        pool = max(pool, discovery_count)  # A small final shortlist still searches both platforms.
    quota, remainder = divmod(pool, discovery_count or 1)
    budget, reports, lists, ts = {"remaining": MAX_REQUESTS}, [], [], None
    discovery_index = 0
    order = {"text": 0, "recent": 1, "mention": 2, "visual": 3}
    streams.sort(key=lambda s: (s["scope"] != "roster", order[s["channel"]], s["imageIndex"] or 0, s["platform"]))
    for stream in streams:
        scope, platform, channel = (stream[k] for k in ("scope", "platform", "channel"))
        limit = PAGE * MAX_PAGES
        if scope == "discovery":
            limit = quota + (discovery_index < remainder)
            discovery_index += 1
        source = f'{scope}:{platform}:{channel}:{stream["imageIndex"]}'
        report = {"source": source, "scope": scope, "platform": platform, "channel": channel}
        if limit <= 0:
            reports.append({**report, "complete": False, "reason": "candidate_limit", "rawCount": 0})
            continue
        if channel == "visual":
            stream["body"]["queries"][0]["filters"]["visualSimilarity"]["includes"]["values"][0]["assetId"] = asset_ids[stream["imageIndex"]]
        records, timestamp = search_all(stream["body"], stream["sort"], limit, report=report, budget=budget)
        ts = ts or timestamp
        reports.append(report)
        eligible = []
        for record in records:
            if record.get("platform") != platform or not in_scope(record, camp) or not keep_result(record, camp, roster):
                continue
            if scope == "roster" and (platform, handle(record["profileHandle"])) not in roster:
                continue
            if channel == "visual":
                frames = [f for m in record.get("media") or [] for f in m.get("frames") or []
                          if f.get("visualSimilarityScore") is not None]
                best = max(frames, key=lambda f: f["visualSimilarityScore"], default={})
                record = {**record, "_visualEvidence": [{"kind": "visual", "queryId": source,
                          "assetId": asset_ids[stream["imageIndex"]], "score": best.get("visualSimilarityScore"),
                          "matchedFrameUrl": best.get("url")}]}
            eligible.append(record)
        lists.append((source, stream["weight"], eligible))
    if reports and all(not r.get("pages") for r in reports):
        raise OrianeError("No search completed: " + str(reports[0].get("reason")))
    videos = [to_video(record, camp) for record in fuse_results(lists)]
    return {"campaignId": camp["id"], "fetchedAt": ts, "videos": videos,
            "search": {"algorithm": VERSION, "queries": reports,
                       "partial": any(not r["complete"] for r in reports),
                       "rosterComplete": all(r["complete"] for r in reports if r["scope"] == "roster"),
                       "rawRecords": sum(r.get("rawCount", 0) for r in reports), "uniqueCandidates": len(videos)}}


if __name__ == "__main__":
    import sys
    camp_path = sys.argv[1] if len(sys.argv) > 1 else "fixtures/campaign.json"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "out/videos.json"
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    doc = fetch_videos(json.load(open(camp_path)))
    json.dump(doc, open(out_path, "w"), indent=1, ensure_ascii=False)
    print(len(doc["videos"]), "candidates; run relevance verification and ranking before building metrics")
    for v in doc["videos"]:
        print(v["creatorHandle"], v["platform"], v["publishedAt"][:10], v["views"], v["matchedBy"],
              "tagged" if v["tagged"] else "UNTAGGED", v["url"])
