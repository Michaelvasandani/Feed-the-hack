"""Part 3: campaign.json + videos.labeled.json -> board.json. Pure functions, no API calls."""
from statistics import mean, median

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
    return bool(day) and window["start"] <= day <= window.get("end", "9999-12-31")


def build_totals(videos, creators):
    untagged = [v for v in videos if not v.get("tagged")]
    return {
        "videos": len(videos),
        "views": _sum(v.get("views") for v in videos),
        "likes": _sum(v.get("likes") for v in videos),
        "comments": _sum(v.get("comments") for v in videos),
        "shares": _sum(v.get("shares") for v in videos),
        "creatorsPosted": sum(c["status"] == "posted" for c in creators),
        "creatorsTotal": len(creators),
        "untaggedVideos": len(untagged),
        "untaggedViews": _sum(v.get("views") for v in untagged),
    }


def build_creators(campaign, videos):
    out = []
    for c in campaign["creators"]:
        keys = {(p, h.lower()) for p, h in c["handles"].items()}
        mine = [v for v in videos if (v["platform"], v["creatorHandle"].lower()) in keys]
        # Followers: largest count seen per platform, summed across platforms.
        per_platform = {}
        for v in mine:
            if v.get("followers") is not None:
                per_platform[v["platform"]] = max(per_platform.get(v["platform"], 0), v["followers"])
        vpf = [v.get("viewsPerFollowerPct") for v in mine if v.get("viewsPerFollowerPct") is not None]
        best = round(max(vpf), 2) if vpf else None
        status = "posted" if mine else "quiet"
        overperformer = best is not None and best >= 100
        out.append({
            "name": c["name"],
            "handles": c["handles"],
            "status": status,
            "videos": len(mine),
            "views": _sum(v.get("views") for v in mine),
            "followers": sum(per_platform.values()) if per_platform else None,
            "bestViewsPerFollowerPct": best,
            "lastPostedAt": max((v["publishedAt"] for v in mine), default=None),
            "overperformer": overperformer,
            "recommendation": "nudge" if status == "quiet" else "rehire" if overperformer else "keep",
        })
    out.sort(key=lambda c: (c["status"] != "posted", -c["views"]))
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
    videos.sort(key=lambda v: -(v.get("views") or 0))
    creators = build_creators(campaign, videos)
    return {
        "campaign": {"id": campaign["id"], "brandName": campaign["brand"]["name"],
                     "handles": campaign["brand"].get("handles", {}),
                     "brief": campaign.get("brief", ""), "window": window},
        "totals": build_totals(videos, creators),
        "creators": creators,
        "formats": build_formats(videos),
        "videos": videos,
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
