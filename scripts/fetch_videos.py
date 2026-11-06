"""Fetch every campaign video from Oriane and write it in the shared videos.json shape.

Usage: python3 scripts/fetch_videos.py [campaign.json] [videos.json]
"""
import json,subprocess,sys
campaign_path=sys.argv[1] if len(sys.argv)>1 else "fixtures/campaign.json"
out_path=sys.argv[2] if len(sys.argv)>2 else "fixtures/videos.json"
camp=json.load(open(campaign_path))
handles=sorted({h for c in camp["creators"] for h in c["handles"].values()})
aliases=camp["brand"]["aliases"]; bh=sorted(set(camp["brand"]["handles"].values()))
body={"operator":"and","filters":{"profileHandle":{"exactMatch":{"values":handles}},"publishedAt":{"after":camp["window"]["start"]},"platform":{"includes":["instagram","tiktok"]}},
 "queries":[{"operator":"or","filters":{"transcript":{"includesExactly":{"values":aliases}},"onScreenText":{"includesExactly":{"values":aliases}},"caption":{"includesExactly":{"values":aliases}},"mentionHandles":{"exactMatch":{"values":bh}}}}]}
raw=json.loads(subprocess.check_output(["./scripts/oriane.sh","contents",json.dumps(body),"limit=100&projection=full&sort=publishedAt"]))
if "error" in raw: sys.exit(json.dumps(raw["error"]))
def low(x): return (x or "").lower()
pairs={(p,h.lower()) for c in camp["creators"] for p,h in c["handles"].items()}
out=[]
for r in raw["data"]["results"]:
    if (r["platform"],r["profileHandle"].lower()) not in pairs: continue
    m=(r.get("media") or [{}])[0]
    ost=m.get("onScreenText") or []
    tr=m.get("transcript")
    mentions=[x.get("profileHandle","").lower() for x in r.get("mentions") or []]
    cap=r.get("caption") or ""
    matched=[]
    if any(a in low(cap) for a in aliases): matched.append("caption")
    if any(a in low(tr) for a in aliases): matched.append("transcript")
    if any(a in low(" ".join(ost)) for a in aliases): matched.append("onScreenText")
    tagged=any(h in mentions for h in bh) or any("@"+h in low(cap) for h in bh) or "@rare beauty" in low(cap)
    if tagged: matched.append("mention")
    url=f'https://www.tiktok.com/@{r["profileHandle"]}/video/{r["platformId"]}' if r["platform"]=="tiktok" else None
    out.append({"id":r["id"],"platform":r["platform"],"url":url,"creatorHandle":r["profileHandle"],"publishedAt":r["publishedAt"],
      "caption":cap,"transcript":tr,"onScreenText":ost,"durationSeconds":m.get("duration"),
      "thumbnailUrl":r.get("thumbnailMediaUrl"),"frameUrls":[f["url"] for f in (m.get("frames") or [])][::10][:6],
      "views":r.get("viewsCount"),"likes":r.get("likesCount"),"comments":r.get("commentsCount"),"shares":r.get("sharesCount"),
      "followers":r.get("profileFollowersCount"),"viewsPerFollowerPct":r.get("viewsRatePerFollowers"),"engagementPerViewPct":r.get("engagementRatePerViews"),
      "matchedBy":matched,"tagged":tagged,"format":None})
json.dump({"campaignId":camp["id"],"fetchedAt":raw["metadata"].get("timestamp"),"videos":out},open(out_path,"w"),indent=1,ensure_ascii=False)
print(len(out),"videos")
for v in out: print(v["creatorHandle"],v["platform"],v["publishedAt"][:10],v["views"],v["matchedBy"],"tagged" if v["tagged"] else "UNTAGGED")
