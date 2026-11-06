"""Part 1: campaign.json -> videos.json. Pulls every matching creator video from Oriane.

Matches brand aliases in caption / transcript / on-screen text, brand @mentions, and (when the
campaign has productImageUrls) videos that visually look like the product.
"""
import json
import os
import re
import urllib.error
import urllib.request

from app.env import load_env

BASE = "https://connect.oriane.xyz/rest"
PAGE = 100
MAX_PAGES = 20
VISUAL_MIN_SCORE = float(os.environ.get("VISUAL_MIN_SCORE", "0.82"))


class OrianeError(RuntimeError):
    pass


def _post(path, body, params=None):
    load_env()
    key = os.environ.get("ORIANE_API_KEY")
    if not key:
        raise OrianeError("ORIANE_API_KEY is not set (run scripts/set-oriane-key.sh)")
    qs = "?" + "&".join(f"{k}={v}" for k, v in params.items()) if params else ""
    req = urllib.request.Request(f"{BASE}/{path}{qs}", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = json.load(r)
    except urllib.error.HTTPError as e:
        raise OrianeError(f"{path}: HTTP {e.code} {e.read()[:500].decode(errors='replace')}") from e
    if raw.get("error"):
        raise OrianeError(f"{path}: {json.dumps(raw['error'])[:500]}")
    return raw


def create_image_asset(url):
    return _post("assets", {"type": "image", "image": {"type": "url", "url": url}})["data"]["id"]


def build_query(camp, asset_ids=()):
    handles = sorted({h for c in camp["creators"] for h in c["handles"].values()})
    aliases = camp["brand"]["aliases"]
    brand_handles = sorted(set(camp["brand"]["handles"].values()))
    published = {"after": camp["window"]["start"]}
    if camp["window"].get("end"):
        published["before"] = camp["window"]["end"]
    match = [{"name": "text", "operator": "or", "filters": {
        "transcript": {"includesExactly": {"values": aliases}},
        "onScreenText": {"includesExactly": {"values": aliases}},
        "caption": {"includesExactly": {"values": aliases}},
        "mentionHandles": {"exactMatch": {"values": brand_handles}},
    }}]
    if asset_ids:
        match.append({"name": "visual", "operator": "or", "filters": {"visualSimilarity": {"includes": {
            "operator": "or", "values": [{"assetId": a, "minScore": VISUAL_MIN_SCORE} for a in asset_ids]}}}})
    return {"operator": "and",
            "filters": {"profileHandle": {"exactMatch": {"values": handles}}, "publishedAt": published,
                        "platform": {"includes": ["instagram", "tiktok"]}},
            "queries": [{"operator": "or", "queries": match}]}


def search_all(body):
    results, anchor, offset, ts = [], None, 0, None
    for _ in range(MAX_PAGES):
        params = {"limit": PAGE, "offset": offset, "projection": "full", "sort": "publishedAt"}
        if anchor:
            params["aiSearchAnchor"] = anchor
        raw = _post("contents/search", body, params)
        page = raw["data"]["results"]
        results += page
        meta = raw.get("metadata") or {}
        ts = ts or meta.get("timestamp")
        pag = meta.get("pagination") or {}
        anchor = anchor or pag.get("aiSearchAnchor")
        offset += len(page)
        if not page or offset >= pag.get("totalCount", 0):
            break
    return results, ts


def video_url(r):
    if r["platform"] == "tiktok":
        return f'https://www.tiktok.com/@{r["profileHandle"]}/video/{r["platformId"]}'
    # Oriane returns no Instagram shortcode, but the thumbnail path carries it.
    m = re.search(r"/instagram/([A-Za-z0-9_-]{6,})/", r.get("thumbnailMediaUrl") or "")
    return f"https://www.instagram.com/p/{m.group(1)}/" if m else f'https://www.instagram.com/{r["profileHandle"]}/'


def to_video(r, camp):
    def low(x):
        return (x or "").lower()
    aliases = [a.lower() for a in camp["brand"]["aliases"]]
    brand_handles = {h.lower() for h in camp["brand"]["handles"].values()}
    m = (r.get("media") or [{}])[0]
    ost = m.get("onScreenText")
    tr = m.get("transcript")
    cap = r.get("caption") or ""
    mentions = {low(x.get("profileHandle")) for x in r.get("mentions") or []}
    matched = []
    if any(a in low(cap) for a in aliases):
        matched.append("caption")
    if any(a in low(tr) for a in aliases):
        matched.append("transcript")
    if any(a in low(" ".join(ost or [])) for a in aliases):
        matched.append("onScreenText")
    tagged = bool(mentions & brand_handles) or any("@" + h in low(cap) for h in brand_handles) \
        or any("@" + a in low(cap) for a in aliases)
    if tagged:
        matched.append("mention")
    if "visual" in (r.get("matchedQueries") or []):
        matched.append("visual")
    return {
        "id": r["id"], "platform": r["platform"], "url": video_url(r),
        "creatorHandle": r["profileHandle"], "publishedAt": r["publishedAt"],
        "caption": cap, "transcript": tr, "onScreenText": ost, "durationSeconds": m.get("duration"),
        "thumbnailUrl": r.get("thumbnailMediaUrl"),
        "frameUrls": [f["url"] for f in (m.get("frames") or [])][::10][:6],
        "views": r.get("viewsCount"), "likes": r.get("likesCount"), "comments": r.get("commentsCount"),
        "shares": r.get("sharesCount"), "followers": r.get("profileFollowersCount"),
        "viewsPerFollowerPct": r.get("viewsRatePerFollowers"),
        "engagementPerViewPct": r.get("engagementRatePerViews"),
        "matchedBy": matched, "tagged": tagged, "format": None,
    }


def fetch_videos(camp):
    asset_ids = [create_image_asset(u) for u in camp["brand"].get("productImageUrls") or []]
    results, ts = search_all(build_query(camp, asset_ids))
    pairs = {(p, h.lower()) for c in camp["creators"] for p, h in c["handles"].items()}
    seen, out = set(), []
    for r in results:
        if (r["platform"], r["profileHandle"].lower()) in pairs and r["id"] not in seen:
            seen.add(r["id"])
            out.append(to_video(r, camp))
    return {"campaignId": camp["id"], "fetchedAt": ts, "videos": out}


if __name__ == "__main__":
    import sys
    camp_path = sys.argv[1] if len(sys.argv) > 1 else "fixtures/campaign.json"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "out/videos.json"
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    doc = fetch_videos(json.load(open(camp_path)))
    json.dump(doc, open(out_path, "w"), indent=1, ensure_ascii=False)
    print(len(doc["videos"]), "videos")
    for v in doc["videos"]:
        print(v["creatorHandle"], v["platform"], v["publishedAt"][:10], v["views"], v["matchedBy"],
              "tagged" if v["tagged"] else "UNTAGGED", v["url"])
