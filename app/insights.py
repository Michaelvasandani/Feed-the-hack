"""Intelligence layer: board.json -> board.json + per-video signals + campaign insights.

Two steps run with every board:
- Per video (many calls, parallel): hook, product prominence, sentiment, product claims and, when
  Oriane returned comments, what the audience says. Runs on GMI Cloud (OpenAI-compatible, open
  models) when GMI_API_KEY is set, else a heuristic.
- Per campaign (one call): a headline, ranked actions and a draft next brief, written from the
  board numbers plus the video signals. Claude when ANTHROPIC_API_KEY is set, else GMI, else rules.

On demand (board tabs): a structured next brief, outreach drafts, answers to questions about the
board, and an AI sample video of the brief (GMI request queue).

Force a backend with SIGNALS_BACKEND=gmi|heuristic and INSIGHTS_BACKEND=claude|gmi|rules.
Model signals are cached per backend and video id in .cache/signals.json.
"""
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from app.env import load_env

load_env()

GMI_BASE_URL = os.environ.get("GMI_BASE_URL", "https://api.gmi-serving.com/v1")
# Fast model for the many per-video calls, stronger one for the single campaign summary.
GMI_MODEL = os.environ.get("GMI_MODEL", "deepseek-ai/DeepSeek-V4-Flash")
GMI_INSIGHTS_MODEL = os.environ.get("GMI_INSIGHTS_MODEL", "deepseek-ai/DeepSeek-V4-Pro")
CLAUDE_MODEL = os.environ.get("INSIGHTS_MODEL", "claude-opus-5-5")
GMI_VIDEO_MODEL = os.environ.get("GMI_VIDEO_MODEL", "kling-3.0-turbo-t2v")
GMI_QUEUE_URL = os.environ.get("GMI_QUEUE_URL", "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey")
CACHE_PATH = Path(__file__).resolve().parent.parent / ".cache" / "signals.json"
_lock = threading.Lock()

PROMINENCE = ["hero", "featured", "background", "none"]
SENTIMENT = ["positive", "mixed", "neutral", "negative"]
HOOK_TYPES = ["question", "bold_claim", "story", "problem", "demo", "trend", "other"]

SIGNALS_SYSTEM = f"""You analyse short-form social videos (TikTok / Instagram Reels) for an agency running a UGC campaign for a brand.
Return only a JSON object with these keys:
- "hook": the opening line or text that grabs attention, translated to English, at most 15 words
- "hookType": one of {HOOK_TYPES}
- "productProminence": how central the brand's product is. One of {PROMINENCE} (hero = the video is about it)
- "sentiment": the creator's attitude to the brand's product. One of {SENTIMENT}
- "claims": up to 3 short things the creator says about the product, in English (empty list if none)
- "audience": null if no comments are given, else {{"score": -1 to 1 how the commenters feel about the video and brand, "purchaseIntent": 0 to 1 share of comments that signal wanting or buying the product, "summary": "at most 14 words on what commenters say, in English", "topQuote": "the most telling comment, verbatim, or null"}}"""

INSIGHTS_SYSTEM = """You are the strategist at an agency running a UGC creator campaign. You get the campaign's board numbers and per-video signals.
Creators with "discovered": true were not hired; they posted about the brand on their own, so the action for them is "recruit", not "rehire".
Write what the account team should do on Monday. Be specific, cite numbers from the data, never invent numbers.
Return only a JSON object with these keys:
- "headline": one sentence under 25 words, the single most important takeaway
- "actions": 3 to 5 items, most important first, each {"kind": "brief" | "rehire" | "recruit" | "nudge" | "watch", "title": "short imperative", "detail": "one or two sentences with the evidence"}
- "nextBrief": a short draft brief for the next wave (3 to 5 sentences): format, hook style, what to say about the product"""


class Audience(BaseModel):
    score: float = Field(ge=-1, le=1)
    purchaseIntent: float = Field(ge=0, le=1)
    summary: str
    topQuote: str | None = None


class VideoSignals(BaseModel):
    hook: str
    hookType: Literal["question", "bold_claim", "story", "problem", "demo", "trend", "other"]
    productProminence: Literal["hero", "featured", "background", "none"]
    sentiment: Literal["positive", "mixed", "neutral", "negative"]
    claims: list[str] = Field(default_factory=list)
    audience: Audience | None = None


class Action(BaseModel):
    kind: Literal["brief", "rehire", "recruit", "nudge", "watch"]
    title: str
    detail: str


class CampaignInsights(BaseModel):
    headline: str
    actions: list[Action]
    nextBrief: str


def _load_cache():
    try:
        return json.loads(CACHE_PATH.read_text())
    except (OSError, ValueError):
        return {}


def _save_cache(cache):
    CACHE_PATH.parent.mkdir(exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, indent=1, ensure_ascii=False))


def _parse_json(text):
    """Pull the first JSON object out of a model reply (open models sometimes wrap it in prose or fences)."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        raise ValueError(f"no JSON object in reply: {text[:200]!r}")
    return json.loads(m.group(0))


def _gmi_request(url, body=None, timeout=60):
    key = os.environ.get("GMI_API_KEY")
    if not key:
        raise RuntimeError("GMI_API_KEY is not set")
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 method="POST" if body is not None else "GET",
                                 # GMI's Cloudflare front rejects urllib's default User-Agent (error 1010).
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}",
                                          "User-Agent": "campaign-board/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"GMI HTTP {e.code} {e.read()[:300].decode(errors='replace')}") from e


def _gmi_chat(system, user, max_tokens=1000, model=GMI_MODEL, temperature=0.2):
    body = {"model": model, "temperature": temperature, "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if "deepseek" in model.lower():
        # DeepSeek-V4 reasons by default and can spend the whole token budget before answering.
        body["thinking"] = {"type": "disabled"}
    return _gmi_request(f"{GMI_BASE_URL}/chat/completions", body)["choices"][0]["message"]["content"]


# ---- per-video signals -------------------------------------------------------------------------

def _video_prompt(v, brand):
    parts = [f"Brand: {brand}", f"Platform: {v['platform']}", f"Caption: {v.get('caption') or '(none)'}"]
    if v.get("transcript"):
        parts.append(f"Transcript: {v['transcript'][:3000]}")
    if v.get("onScreenText"):
        parts.append("On-screen text: " + " | ".join(v["onScreenText"][:20]))
    if v.get("popularComments"):
        parts.append("Top comments:\n" + "\n".join(f"[{c['likes']} likes] {c['text']}" for c in v["popularComments"]))
    return "\n".join(parts)


POSITIVE = r"love|obsessed|holy grail|amazing|favou?rite|best|perfect|gorgeous|must.have|adoro|amo|incr[ií]vel|melhor"
NEGATIVE = r"hate|disappoint|not worth|broke me out|wouldn'?t recommend|returned|meh|pior|n[aã]o gostei"


def _first_line(text, words=15):
    text = re.sub(r"#\S+|@\S+", "", text or "").strip()
    first = re.split(r"(?<=[.!?])\s|\n", text, maxsplit=1)[0]
    return " ".join(first.split()[:words])


def heuristic_signals(v, brand):
    """No-model fallback: opening line as the hook, keyword sentiment, prominence from where the brand matched."""
    hook = _first_line(v.get("transcript")) or _first_line(" ".join((v.get("onScreenText") or [])[:2])) \
        or _first_line(v.get("caption"))
    text = " ".join([v.get("caption") or "", v.get("transcript") or ""]).lower()
    pos, neg = bool(re.search(POSITIVE, text)), bool(re.search(NEGATIVE, text))
    sentiment = "mixed" if pos and neg else "positive" if pos else "negative" if neg else "neutral"
    matched = set(v.get("matchedBy") or [])
    prominence = "featured" if {"transcript", "visual"} & matched else "background" if matched else "none"
    return {"hook": hook, "hookType": "question" if hook.endswith("?") else "other",
            "productProminence": prominence, "sentiment": sentiment, "claims": [], "audience": None,
            "signalsSource": "heuristic"}


def _gmi_signals(v, brand):
    out = VideoSignals.model_validate(_parse_json(_gmi_chat(SIGNALS_SYSTEM, _video_prompt(v, brand))))
    return {**out.model_dump(), "claims": out.claims[:3], "signalsSource": "gmi"}


def pick_signals_backend():
    return os.environ.get("SIGNALS_BACKEND") or ("gmi" if os.environ.get("GMI_API_KEY") else "heuristic")


def signals_one(v, brand, backend):
    if backend == "gmi":
        try:
            return _gmi_signals(v, brand)
        except Exception as e:  # noqa: BLE001 - one bad video shouldn't sink the board
            print(f"signals {v['id']}: gmi: {type(e).__name__}: {e}; using heuristic")
    return heuristic_signals(v, brand)


def add_signals(videos, brand, backend=None, workers=16):
    backend = backend or pick_signals_backend()
    cache = _load_cache()
    key = lambda v: f"{backend}:v2:{v['id']}"  # noqa: E731 - v2: signals gained `audience`
    todo = [v for v in videos if key(v) not in cache]

    def run(v):
        s = signals_one(v, brand, backend)
        # Only cache model output, so adding a key later upgrades heuristic signals.
        if s["signalsSource"] != "heuristic":
            with _lock:
                cache[key(v)] = s
        return v["id"], s

    fresh = dict(ThreadPoolExecutor(workers).map(run, todo)) if todo else {}
    _save_cache(cache)
    sig = {**{v["id"]: cache[key(v)] for v in videos if key(v) in cache}, **fresh}
    return [{**v, "signals": sig[v["id"]]} for v in videos]


# ---- campaign insights -------------------------------------------------------------------------

def _summary(board):
    """The compact view of the board a model gets: numbers plus the top videos' signals."""
    return {
        "campaign": board["campaign"],
        "totals": board["totals"],
        "creators": [{k: c.get(k) for k in ("name", "status", "videos", "views", "followers",
                                             "bestViewsPerFollowerPct", "recommendation", "discovered")}
                     for c in board["creators"]],
        "formats": [{k: f[k] for k in ("format", "videos", "views", "avgViewsPerFollowerPct", "winner")}
                    for f in board["formats"]],
        "videos": [{"creator": v["creatorHandle"], "format": v.get("format"), "views": v.get("views"),
                    "viewsPerFollowerPct": round(v["viewsPerFollowerPct"], 1) if v.get("viewsPerFollowerPct") else None,
                    "tagged": v.get("tagged"), **{k: v.get("signals", {}).get(k) for k in
                                                  ("hook", "hookType", "productProminence", "sentiment", "claims")}}
                   for v in board["videos"][:25]],
    }


def _reach(pct):
    return f"{pct / 100:.0f}× their follower count" if pct >= 200 else f"{pct:.0f}% of their followers"


def _ratio(a, b):
    return f"{a / b:.1f}×" if a and b else None


def rule_insights(board):
    """No-model fallback built straight from the board numbers."""
    t, creators, formats = board["totals"], board["creators"], board["formats"]
    brand = board["campaign"]["brandName"]
    ranked = [f for f in formats if f["format"] not in ("other", "unclassified") and f["avgViewsPerFollowerPct"]]
    winner = next((f for f in formats if f["winner"]), None)
    runner = next((f for f in ranked if winner and f["format"] != winner["format"]), None)
    stars = [c for c in creators if c["overperformer"]]
    quiet = [c for c in creators if c["status"] == "quiet"]
    name = lambda f: f["format"].replace("_", " ")  # noqa: E731

    actions = []
    if winner:
        vs = f" ({_ratio(winner['avgViewsPerFollowerPct'], runner['avgViewsPerFollowerPct'])} the {name(runner)} average)" if runner else ""
        actions.append({"kind": "brief", "title": f"Brief more {name(winner)} videos",
                        "detail": f"{name(winner).capitalize()} videos reached {_reach(winner['avgViewsPerFollowerPct'])} "
                                  f"on average across {winner['videos']} videos{vs}."})
    for c in stars[:2]:
        kind = "recruit" if c.get("discovered") else "rehire"
        actions.append({"kind": kind, "title": f"{kind.capitalize()} {c['name']}",
                        "detail": f"Best video reached {_reach(c['bestViewsPerFollowerPct'])} "
                                  f"({c['views']:,} views in total)."})
    if quiet:
        actions.append({"kind": "nudge", "title": f"Nudge {', '.join(c['name'] for c in quiet)}",
                        "detail": f"No post in the window yet; {t['creatorsPosted']} of {t['creatorsTotal']} hired creators have posted."})
    if t["untaggedVideos"]:
        share = t["untaggedViews"] / t["views"] if t["views"] else 0
        actions.append({"kind": "watch", "title": "Ask creators to tag the brand",
                        "detail": f"{t['untaggedVideos']} videos ({share:.0%} of views) mention {brand} without tagging it."})

    if winner and stars:
        headline = f"{name(winner).capitalize()} is the winning format, and {len(stars)} creator{'s' if len(stars) > 1 else ''} beat their follower count."
    elif winner:
        headline = f"{name(winner).capitalize()} is the winning format so far."
    else:
        headline = f"{t['videos']} videos and {t['views']:,} views so far; not enough of any one format to call a winner yet."
    handles = board["campaign"].get("handles") or {}
    tag = "@" + (handles.get("tiktok") or handles.get("instagram")) if handles else "the brand"
    hooks = [v["signals"]["hook"] for v in board["videos"][:3] if v.get("signals", {}).get("hook")]
    brief = (f"Next wave: lead with {name(winner)} content. " if winner else "Next wave: keep formats open while we gather data. ") \
        + (f"Model the opening on the top performers (\"{hooks[0]}\"). " if hooks else "") \
        + f"Say or show {brand} in the first few seconds and tag {tag} in the caption."
    return {"headline": headline, "actions": actions[:5], "nextBrief": brief, "insightsSource": "rules"}


def _claude_insights(board):
    import anthropic
    client = anthropic.Anthropic()
    resp = client.messages.parse(
        model=CLAUDE_MODEL,
        max_tokens=4096,
        system=INSIGHTS_SYSTEM,
        output_config={"effort": "low"},
        output_format=CampaignInsights,
        messages=[{"role": "user", "content": json.dumps(_summary(board), ensure_ascii=False)}],
    )
    if resp.parsed_output is None:
        raise RuntimeError(f"no insights (stop_reason={resp.stop_reason})")
    return {**resp.parsed_output.model_dump(), "insightsSource": "claude", "insightsModel": CLAUDE_MODEL}


def _gmi_insights(board):
    reply = _gmi_chat(INSIGHTS_SYSTEM, json.dumps(_summary(board), ensure_ascii=False), max_tokens=1500,
                      model=GMI_INSIGHTS_MODEL)
    out = CampaignInsights.model_validate(_parse_json(reply))
    return {**out.model_dump(), "actions": [a.model_dump() for a in out.actions[:5]], "insightsSource": "gmi",
            "insightsModel": GMI_INSIGHTS_MODEL}


def pick_insights_backend():
    choice = os.environ.get("INSIGHTS_BACKEND")
    if choice:
        return choice
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "claude"
    if os.environ.get("GMI_API_KEY"):
        return "gmi"
    return "rules"


def campaign_insights(board, backend=None):
    backend = backend or pick_insights_backend()
    try:
        if backend == "claude":
            return _claude_insights(board)
        if backend == "gmi":
            return _gmi_insights(board)
    except Exception as e:  # noqa: BLE001 - the board still renders with rule-based insights
        print(f"insights: {backend}: {type(e).__name__}: {e}; using rules")
    return rule_insights(board)


def _mean(vals):
    vals = [v for v in vals if v is not None]
    return round(sum(vals) / len(vals), 3) if vals else None


def rollup_audience(board):
    """Copy each video's audience read to `sentiment` and average it per creator and campaign."""
    videos = [{**v, "sentiment": (v.get("signals") or {}).get("audience")} for v in board["videos"]]
    creators = []
    for c in board["creators"]:
        keys = {(p, h.lower()) for p, h in c["handles"].items()}
        mine = [v["sentiment"] for v in videos if v["sentiment"] and (v["platform"], v["creatorHandle"].lower()) in keys]
        creators.append({**c, "sentimentScore": _mean(s["score"] for s in mine),
                         "purchaseIntent": _mean(s["purchaseIntent"] for s in mine)})
    avg = _mean(v["sentiment"]["score"] for v in videos if v["sentiment"])
    return {**board, "videos": videos, "creators": creators, "totals": {**board["totals"], "avgSentiment": avg}}


def add_insights(board):
    load_env()  # keys added after the server started still get picked up
    board = rollup_audience({**board, "videos": add_signals(board["videos"], board["campaign"]["brandName"])})
    return {**board, "insights": campaign_insights(board)}


# ---- on demand: next brief, outreach drafts, ask, sample video ----------------------------------

BRIEF_SYSTEM = """You are a senior creative strategist at an agency running a UGC creator campaign. From the campaign data, write the NEXT creator brief that doubles down on what worked. Be specific and evidence-based: cite numbers from the data, never invent them.
Return only a JSON object: {"headline": "at most 10 words", "format": "the winning format", "why": ["3 evidence bullets"], "hook": "the exact first line the creator should say", "mustDo": ["3 or 4 bullets"], "avoid": ["2 or 3 bullets"], "shotList": ["5 short shots with seconds, e.g. 0-2s: ..."], "videoPrompt": "a vivid 9:16 text-to-video prompt (at most 600 characters) for an 8s sample UGC clip in this format: the creator, setting, lighting, camera moves and product moment; no on-screen text, no logos"}"""

DRAFT_SYSTEM = """You are a warm, concise influencer-campaign manager at an agency. Write a short DM or email (at most 110 words) to a UGC creator.
nudge = they haven't posted for the campaign yet: friendly reminder, restate the one key ask from the brief, suggest the winning format, offer help.
rehire = they overperformed: celebrate a specific number, propose a follow-up collab.
recruit = they are not on the roster but posted about the brand on their own and it did well: compliment the specific video, propose a paid collab.
keep = thank them and suggest one concrete improvement.
No hashtags, at most one emoji. Return only a JSON object {"subject": "...", "body": "..."}"""

ASK_SYSTEM = ("You are a sharp campaign analyst. Answer the agency's question using ONLY the JSON data. "
              "Be concise (at most 120 words), lead with the answer, cite creators and numbers. Use markdown bullets when listing.")


class NextBrief(BaseModel):
    headline: str
    format: str
    why: list[str]
    hook: str
    mustDo: list[str]
    avoid: list[str]
    shotList: list[str]
    videoPrompt: str


class Draft(BaseModel):
    subject: str
    body: str


def _brief_context(board):
    pct = lambda x: None if x is None else f"{round(x)}%"  # noqa: E731
    return {
        "brand": board["campaign"]["brandName"], "currentBrief": board["campaign"].get("brief"),
        "totals": board["totals"],
        "formats": [{"format": f["format"], "videos": f["videos"], "avgViewsPerFollower": pct(f["avgViewsPerFollowerPct"]),
                     "avgEngagement": pct(f["avgEngagementPerViewPct"]), "winner": f["winner"]} for f in board["formats"]],
        "topVideos": [{"format": v.get("format"), "views": v.get("views"), "viewsPerFollower": pct(v.get("viewsPerFollowerPct")),
                       "firstBrandMentionSec": v.get("firstMentionSeconds"), "tagged": v.get("tagged"),
                       "caption": (v.get("caption") or "")[:200], "transcriptStart": (v.get("transcript") or "")[:300],
                       **{k: (v.get("signals") or {}).get(k) for k in ("hook", "hookType", "claims")},
                       "audience": (v.get("sentiment") or {}).get("summary")}
                      for v in board["videos"] if v.get("views") is not None][:6],
        "strategistNotes": board.get("insights"),
    }


def rule_brief(board):
    """No-model next brief, built from the board's rule insights and top videos."""
    ins = board.get("insights") or rule_insights(board)
    win = next((f for f in board["formats"] if f["winner"]), None)
    fmt = win["format"].replace("_", " ") if win else "open"
    brand = board["campaign"]["brandName"]
    hooks = [v["signals"]["hook"] for v in board["videos"][:3] if (v.get("signals") or {}).get("hook")]
    return {
        "headline": f"More {fmt} videos, brand up front" if win else f"Test formats, say {brand} early",
        "format": win["format"] if win else "other",
        "why": [a["detail"] for a in ins["actions"] if a["kind"] in ("brief", "watch", "rehire")][:3],
        "hook": hooks[0] if hooks else f"Okay, I need to talk about {brand}.",
        "mustDo": [f"Say or show {brand} in the first 3 seconds", "Tag the brand in the caption",
                   "Show the product in hand, in natural light"],
        "avoid": ["Burying the product after 30 seconds", "Posting without the brand tag"],
        "shotList": ["0-2s: hook to camera", "2-5s: product reveal", "5-15s: use it on camera",
                     "15-25s: honest reaction", "25-30s: where to get it"],
        "videoPrompt": f"Vertical 9:16 UGC clip: a creator in a bright bedroom, natural window light, handheld phone camera, "
                       f"films a {fmt} video, lifts a {brand} product toward the lens and smiles, close-up of the product in hand.",
        "briefSource": "rules",
    }


def next_brief(board):
    if os.environ.get("GMI_API_KEY"):
        try:
            reply = _gmi_chat(BRIEF_SYSTEM, json.dumps(_brief_context(board), ensure_ascii=False),
                              max_tokens=1800, model=GMI_INSIGHTS_MODEL)
            return {**NextBrief.model_validate(_parse_json(reply)).model_dump(), "briefSource": "gmi",
                    "briefModel": GMI_INSIGHTS_MODEL}
        except Exception as e:  # noqa: BLE001 - fall back to the rule brief
            print(f"brief: gmi: {type(e).__name__}: {e}; using rules")
    return rule_brief(board)


def _creator_videos(board, creator):
    keys = {(p, h.lower()) for p, h in creator["handles"].items()}
    return [v for v in board["videos"] if (v["platform"], v["creatorHandle"].lower()) in keys]


def rule_draft(board, creator):
    first = creator["name"].lstrip("@").split(" ")[0]
    brand = board["campaign"]["brandName"]
    kind = creator.get("recommendation", "keep")
    body = {
        "nudge": f"Hey {first}! Quick check-in on the {brand} campaign: we haven't seen a post yet. "
                 f"Anything you need from us to get it live this week?",
        "rehire": f"Hey {first}! Your {brand} video crushed it, way past your follower count. "
                  f"We'd love to book you for the next drop. Interested?",
        "recruit": f"Hey {first}! We loved your {brand} video, it reached way past your follower count. "
                   f"We run {brand}'s creator program and would love to work with you on the next drop. Open to a paid collab?",
    }.get(kind, f"Hey {first}! Thanks for your {brand} video. We'd love to keep working together.")
    return {"subject": f"{brand} x {first}", "body": body, "draftSource": "rules"}


def draft_message(board, creator):
    if os.environ.get("GMI_API_KEY"):
        win = next((f["format"] for f in board["formats"] if f["winner"]), None)
        ctx = {"brand": board["campaign"]["brandName"], "brief": board["campaign"].get("brief"),
               "window": board["campaign"]["window"], "winningFormat": win,
               "creator": {k: creator.get(k) for k in ("name", "status", "recommendation", "views",
                                                       "bestViewsPerFollowerPct", "offBriefPosts", "sentimentScore")},
               "theirVideos": [{"format": v.get("format"), "views": v.get("views"), "caption": (v.get("caption") or "")[:160],
                                "hook": (v.get("signals") or {}).get("hook"),
                                "audience": (v.get("sentiment") or {}).get("summary")}
                               for v in _creator_videos(board, creator)[:3]]}
        try:
            reply = _gmi_chat(DRAFT_SYSTEM, json.dumps(ctx, ensure_ascii=False), max_tokens=600, temperature=0.6)
            return {**Draft.model_validate(_parse_json(reply)).model_dump(), "draftSource": "gmi"}
        except Exception as e:  # noqa: BLE001 - fall back to the template
            print(f"draft: gmi: {type(e).__name__}: {e}; using template")
    return rule_draft(board, creator)


def ask_board(board, question):
    slim = {
        "campaign": board["campaign"], "totals": board["totals"], "insights": board.get("insights"),
        "creators": board["creators"], "formats": board["formats"],
        "videos": [{"creator": v["creatorHandle"], "platform": v["platform"], "date": v["publishedAt"][:10],
                    "format": v.get("format"), "views": v.get("views"), "vpf": v.get("viewsPerFollowerPct"),
                    "eng": v.get("engagementPerViewPct"), "tagged": v.get("tagged"), "matchedBy": v.get("matchedBy"),
                    "firstMentionSec": v.get("firstMentionSeconds"), "hook": (v.get("signals") or {}).get("hook"),
                    "audience": (v.get("sentiment") or {}).get("summary")} for v in board["videos"]],
    }
    if not os.environ.get("GMI_API_KEY"):
        raise RuntimeError("Asking questions needs GMI_API_KEY in .env")
    return _gmi_chat(ASK_SYSTEM, f"DATA:\n{json.dumps(slim, ensure_ascii=False)}\n\nQUESTION: {question}",
                     max_tokens=800, model=GMI_INSIGHTS_MODEL)


def submit_sample_video(prompt):
    """Queue an 8s vertical clip of the brief on GMI's request queue."""
    return _gmi_request(f"{GMI_QUEUE_URL}/requests", {"model": GMI_VIDEO_MODEL, "payload": {
        "prompt": prompt, "aspect_ratio": "9:16", "duration": "8", "resolution": "720p"}})


def sample_video_status(request_id):
    r = _gmi_request(f"{GMI_QUEUE_URL}/requests/{urllib.parse.quote(request_id)}")
    o = r.get("outcome") or {}
    # Models disagree on the outcome shape (Veo: video_url, Kling: media_urls[].url).
    url = o.get("video_url") or (o.get("media_urls") or [{}])[0].get("url") or (o.get("videos") or [{}])[0].get("url")
    return {"status": r.get("status"), "videoUrl": url}


if __name__ == "__main__":
    import sys
    src = sys.argv[1] if len(sys.argv) > 1 else "out/board.json"
    dst = sys.argv[2] if len(sys.argv) > 2 else src
    out = add_insights(json.load(open(src)))
    json.dump(out, open(dst, "w"), indent=1, ensure_ascii=False)
    print("signals:", pick_signals_backend(), "· insights:", out["insights"]["insightsSource"])
    print(json.dumps(out["insights"], indent=1, ensure_ascii=False))
