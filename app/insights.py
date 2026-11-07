"""Intelligence layer: board.json -> board.json + per-video signals + campaign insights.

Two steps:
- Per video (many calls, parallel): hook, product prominence, sentiment and product claims.
  Runs on GMI Cloud (OpenAI-compatible, open models) when GMI_API_KEY is set, else a heuristic.
- Per campaign (one call): a headline, ranked actions and a draft next brief, written from the
  board numbers plus the video signals. Claude when ANTHROPIC_API_KEY is set, else GMI, else rules.

Force a backend with SIGNALS_BACKEND=gmi|heuristic and INSIGHTS_BACKEND=claude|gmi|rules.
Model signals are cached per backend and video id in .cache/signals.json.
"""
import json
import os
import re
import threading
import urllib.error
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
- "claims": up to 3 short things the creator says about the product, in English (empty list if none)"""

INSIGHTS_SYSTEM = """You are the strategist at an agency running a UGC creator campaign. You get the campaign's board numbers and per-video signals.
Write what the account team should do on Monday. Be specific, cite numbers from the data, never invent numbers.
Return only a JSON object with these keys:
- "headline": one sentence, the single most important takeaway
- "actions": 3 to 5 items, most important first, each {"kind": "brief" | "rehire" | "nudge" | "watch", "title": "short imperative", "detail": "one or two sentences with the evidence"}
- "nextBrief": a short draft brief for the next wave (3 to 5 sentences): format, hook style, what to say about the product"""


class VideoSignals(BaseModel):
    hook: str
    hookType: Literal["question", "bold_claim", "story", "problem", "demo", "trend", "other"]
    productProminence: Literal["hero", "featured", "background", "none"]
    sentiment: Literal["positive", "mixed", "neutral", "negative"]
    claims: list[str] = Field(default_factory=list)


class Action(BaseModel):
    kind: Literal["brief", "rehire", "nudge", "watch"]
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


def _gmi_chat(system, user, max_tokens=1000, model=GMI_MODEL):
    key = os.environ.get("GMI_API_KEY")
    if not key:
        raise RuntimeError("GMI_API_KEY is not set")
    body = {"model": model, "temperature": 0.2, "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if "deepseek" in model.lower():
        # DeepSeek-V4 reasons by default and can spend the whole token budget before answering.
        body["thinking"] = {"type": "disabled"}
    req = urllib.request.Request(f"{GMI_BASE_URL}/chat/completions", data=json.dumps(body).encode(), method="POST",
                                 # GMI's Cloudflare front rejects urllib's default User-Agent (error 1010).
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}",
                                          "User-Agent": "campaign-board/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"GMI HTTP {e.code} {e.read()[:300].decode(errors='replace')}") from e
    return raw["choices"][0]["message"]["content"]


# ---- per-video signals -------------------------------------------------------------------------

def _video_prompt(v, brand):
    parts = [f"Brand: {brand}", f"Platform: {v['platform']}", f"Caption: {v.get('caption') or '(none)'}"]
    if v.get("transcript"):
        parts.append(f"Transcript: {v['transcript'][:3000]}")
    if v.get("onScreenText"):
        parts.append("On-screen text: " + " | ".join(v["onScreenText"][:20]))
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
            "productProminence": prominence, "sentiment": sentiment, "claims": [], "signalsSource": "heuristic"}


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
    key = lambda v: f"{backend}:{v['id']}"  # noqa: E731
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
        "creators": [{k: c[k] for k in ("name", "status", "videos", "views", "followers",
                                         "bestViewsPerFollowerPct", "recommendation")} for c in board["creators"]],
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
        actions.append({"kind": "rehire", "title": f"Rehire {c['name']}",
                        "detail": f"Best video reached {_reach(c['bestViewsPerFollowerPct'])} "
                                  f"({c['views']:,} views in total)."})
    if quiet:
        actions.append({"kind": "nudge", "title": f"Nudge {', '.join(c['name'] for c in quiet)}",
                        "detail": f"No post in the window yet; {t['creatorsPosted']} of {t['creatorsTotal']} creators have posted."})
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


def add_insights(board):
    load_env()  # keys added after the server started still get picked up
    board = {**board, "videos": add_signals(board["videos"], board["campaign"]["brandName"])}
    return {**board, "insights": campaign_insights(board)}


if __name__ == "__main__":
    import sys
    src = sys.argv[1] if len(sys.argv) > 1 else "out/board.json"
    dst = sys.argv[2] if len(sys.argv) > 2 else src
    out = add_insights(json.load(open(src)))
    json.dump(out, open(dst, "w"), indent=1, ensure_ascii=False)
    print("signals:", pick_signals_backend(), "· insights:", out["insights"]["insightsSource"])
    print(json.dumps(out["insights"], indent=1, ensure_ascii=False))
