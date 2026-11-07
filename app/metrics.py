"""Part 3: campaign.json + videos.labeled.json -> board.json. Pure functions, no API calls."""
import time
from statistics import mean, median
from app.search import handle

UNCLASSIFIED = "unclassified"
# Formats that can't be a brief recommendation, so never "win".
NON_WINNING = {UNCLASSIFIED, "other"}


def _sum(vals):
    return sum(v for v in vals if v is not None)


def _avg(vals):
    vals = [v for v in vals if v is not None]
    return round(mean(vals), 2) if vals else None


def _median(vals):
    vals = [v for v in vals if v is not None]
    return round(median(vals), 2) if vals else None


def in_window(video, window):
    day = (video.get("publishedAt") or "")[:10]
    return bool(day) and window["start"] <= day <= (window.get("end") or "9999-12-31")


def build_totals(videos, creators):
    untagged = [v for v in videos if not v.get("tagged")]
    mentioned = [v for v in videos if v.get("firstMentionSeconds") is not None]
    return {
        "videos": len(videos),
        "views": _sum(v.get("views") for v in videos),
        "likes": _sum(v.get("likes") for v in videos),
        "comments": _sum(v.get("comments") for v in videos),
        "shares": _sum(v.get("shares") for v in videos),
        "creatorsPosted": sum(c["status"] == "posted" and not c.get("discovered") for c in creators),
        "creatorsTotal": sum(not c.get("discovered") for c in creators),
        "creatorsDiscovered": sum(bool(c.get("discovered")) for c in creators),
        "untaggedVideos": len(untagged),
        "untaggedViews": _sum(v.get("views") for v in untagged),
        "avgEngagementPerViewPct": _avg(v.get("engagementPerViewPct") for v in videos),
        # Share of videos that say or show the brand in the first 3 seconds, of those where we found the moment.
        "earlyMentionPct": round(100 * sum(v["firstMentionSeconds"] <= 3 for v in mentioned) / len(mentioned), 1)
        if mentioned else None,
    }


def discovered_creators(campaign, videos):
    """Creators who posted about the brand but aren't on the roster, one per handle across platforms."""
    roster = {(p, handle(h)) for c in campaign.get("creators") or [] for p, h in c["handles"].items()}
    found = {}
    for v in videos:
        h = handle(v["creatorHandle"])
        if (v["platform"], h) not in roster:
            found.setdefault(h, {"name": "@" + v["creatorHandle"], "handles": {}, "discovered": True})
            found[h]["handles"].setdefault(v["platform"], v["creatorHandle"])
    return list(found.values())


def build_timeline(videos):
    days = {}
    for v in videos:
        d = days.setdefault(v["publishedAt"][:10], {"views": 0, "videos": 0})
        d["views"] += v.get("views") or 0
        d["videos"] += 1
    return [{"date": d, **e} for d, e in sorted(days.items())]


def build_creators(campaign, videos, activity=None, search=None, candidates=()):
    out = []
    for c in [*(campaign.get("creators") or []), *discovered_creators(campaign, videos)]:
        keys = {(p, handle(h)) for p, h in c["handles"].items()}
        mine = [v for v in videos if (v["platform"], handle(v["creatorHandle"])) in keys]
        uncertain = bool(search and not search.get("rosterComplete", True)) or any(
            (v["platform"], handle(v["creatorHandle"])) in keys for v in candidates)
        # Followers: largest count seen per platform, summed across platforms.
        per_platform = {}
        for v in mine:
            if v.get("followers") is not None:
                per_platform[v["platform"]] = max(per_platform.get(v["platform"], 0), v["followers"])
        vpf = [v.get("viewsPerFollowerPct") for v in mine if v.get("viewsPerFollowerPct") is not None]
        best = round(max(vpf), 2) if vpf else None
        status = "posted" if mine else "unknown" if uncertain else "quiet"
        overperformer = best is not None and best >= 100
        if c.get("discovered"):
            recommendation = "recruit" if overperformer else "keep"
        else:
            recommendation = "nudge" if status == "quiet" else "rehire" if overperformer else "keep"
        if uncertain:
            recommendation = None
        out.append({
            "name": c["name"],
            "handles": c["handles"],
            "discovered": bool(c.get("discovered")),
            "status": status,
            "videos": len(mine),
            "views": _sum(v.get("views") for v in mine),
            "followers": sum(per_platform.values()) if per_platform else None,
            "bestViewsPerFollowerPct": best,
            "lastPostedAt": max((v["publishedAt"] for v in mine), default=None),
            "overperformer": overperformer,
            "recommendation": recommendation,
            "profilePictureUrl": next((v["profilePictureUrl"] for v in mine if v.get("profilePictureUrl")), None),
            "avgEngagementPerViewPct": _avg(v.get("engagementPerViewPct") for v in mine),
            "avgFirstMentionSeconds": _avg(v.get("firstMentionSeconds") for v in mine),
            # Posts in the window that never mention the brand (needs the fetch's activity counts).
            "offBriefPosts": max(0, sum((activity or {}).get(f"{p}:{h}", 0) for p, h in keys) - len(mine))
            if activity is not None and not uncertain and (search or {}).get("activityComplete", True) else None,
        })
    out.sort(key=lambda c: (c["status"] != "posted", c["discovered"], -c["views"]))
    return out


def build_formats(videos):
    groups = {}
    for v in videos:
        groups.setdefault(v.get("format") or UNCLASSIFIED, []).append(v)
    out = [{
        "format": f,
        "videos": len(vs),
        "views": _sum(v.get("views") for v in vs),
        "avgViewsPerFollowerPct": _avg(v.get("viewsPerFollowerPct") for v in vs),
        "medianViewsPerFollowerPct": _median(v.get("viewsPerFollowerPct") for v in vs),
        "avgEngagementPerViewPct": _avg(v.get("engagementPerViewPct") for v in vs),
        "winner": False,
    } for f, vs in groups.items()]
    eligible = [f for f in out if f["videos"] >= 2 and f["format"] not in NON_WINNING
                and f["avgViewsPerFollowerPct"] is not None]
    if eligible:
        max(eligible, key=lambda f: f["avgViewsPerFollowerPct"])["winner"] = True
    out.sort(key=lambda f: -(f["avgViewsPerFollowerPct"] or 0))
    return out


def build_board(campaign, labeled):
    window = campaign["window"]
    videos = [dict(v, format=v.get("format") or UNCLASSIFIED)
              for v in labeled["videos"] if in_window(v, window)]
    videos.sort(key=lambda v: (-(v.get("searchScore") or 0), -(v.get("views") or 0)))
    names = {(p, handle(h)): c["name"] for c in campaign.get("creators") or [] for p, h in c["handles"].items()}
    for v in videos:
        v["creatorName"] = names.get((v["platform"], handle(v["creatorHandle"])))
    candidates = labeled.get("candidates", [])
    search = labeled.get("search", {})
    creators = build_creators(campaign, videos, activity=labeled.get("activity"), search=search, candidates=candidates)
    return {
        "campaign": {"id": campaign["id"], "brandName": campaign["brand"]["name"],
                     "handles": campaign["brand"].get("handles", {}),
                     "brief": campaign.get("brief", ""), "window": window,
                     "discover": bool(campaign.get("discover"))},
        "totals": {**build_totals(videos, creators), "droppedOffBrand": labeled.get("droppedOffBrand", 0)},
        "creators": creators,
        "formats": build_formats(videos),
        "timeline": build_timeline(videos),
        "generatedAt": int(time.time() * 1000),
        "videos": videos,
        "candidates": candidates,
        "search": search,
    }


if __name__ == "__main__":
    import json, sys
    camp_path = sys.argv[1] if len(sys.argv) > 1 else "fixtures/campaign.json"
    vids_path = sys.argv[2] if len(sys.argv) > 2 else "fixtures/videos.json"
    out_path = sys.argv[3] if len(sys.argv) > 3 else "out/board.json"
    import os
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    board = build_board(json.load(open(camp_path)), json.load(open(vids_path)))
    json.dump(board, open(out_path, "w"), indent=1, ensure_ascii=False)
    print(json.dumps(board["totals"]))
