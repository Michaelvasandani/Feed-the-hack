"""Part 2: videos.json -> videos.labeled.json. Labels each video's format.

Backends (CLASSIFY_BACKEND, else picked from whichever key is set):
- jev: TypeSafe's Jev model, one Choice question over caption/transcript/on-screen text.
  Returns a real probability per format. Low-confidence answers escalate to Claude when an
  Anthropic key is available.
- claude: Claude with structured output, also looks at 2-3 video frames.
- keyword: regex heuristic, used when no key is set or a call fails.

Model labels are cached per backend and video id in .cache/formats.json.
"""
import json
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from app.env import load_env

load_env()

FORMAT_DEFS = {
    "unboxing": "opening a package or PR box, first reveal of products",
    "grwm": '"get ready with me": doing makeup or an outfit while talking to camera',
    "review": "a verdict on one or a few products (worth it?, honest review, first impressions with an opinion)",
    "haul": "showing off many recent purchases",
    "tutorial": "a step-by-step how-to the viewer can follow",
    "gift_guide": "gift ideas or holiday gift recommendations",
    "day_in_life": "a vlog of the creator's day",
    "other": "none of the above",
}
FORMATS = list(FORMAT_DEFS)
CLAUDE_MODEL = os.environ.get("CLASSIFY_MODEL", "claude-opus-5-5")
JEV_MODEL = os.environ.get("JEV_MODEL", "jev-latest")
# Jev answers below this confidence go to Claude, if an Anthropic key is set.
JEV_ESCALATE_BELOW = float(os.environ.get("JEV_ESCALATE_BELOW", "0.5"))
CACHE_PATH = Path(__file__).resolve().parent.parent / ".cache" / "formats.json"
_lock = threading.Lock()

SYSTEM = f"""You label short-form social videos (TikTok / Instagram Reels) by content format, for an agency tracking a UGC campaign.

Formats:
{chr(10).join(f"- {k}: {d}" for k, d in FORMAT_DEFS.items())}

Pick the single best fit. Captions and transcripts may be in any language. Hashtags like #grwm are strong evidence. Keep `reason` to one short sentence citing the evidence."""

JEV_INSTRUCTIONS = ("Which content format best describes this short-form social video (TikTok or Instagram Reel)? "
                    "Use `caption`, `transcript` and `on_screen_text`. They may be in any language, and hashtags "
                    "like #grwm are strong evidence. Pick the single best fit.")


class FormatLabel(BaseModel):
    format: Literal["unboxing", "grwm", "review", "haul", "tutorial", "gift_guide", "day_in_life", "other"]
    confidence: float = Field(description="0 to 1")
    reason: str


def _load_cache():
    try:
        return json.loads(CACHE_PATH.read_text())
    except (OSError, ValueError):
        return {}


def _save_cache(cache):
    CACHE_PATH.parent.mkdir(exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, indent=1, ensure_ascii=False))


def _video_text(v):
    parts = [f"Platform: {v['platform']}", f"Caption: {v.get('caption') or '(none)'}"]
    if v.get("transcript"):
        parts.append(f"Transcript: {v['transcript'][:4000]}")
    if v.get("onScreenText"):
        parts.append("On-screen text: " + " | ".join(v["onScreenText"][:30]))
    if v.get("durationSeconds"):
        parts.append(f"Duration: {v['durationSeconds']}s")
    return "\n".join(parts)


KEYWORDS = [
    ("grwm", r"grwm|get ready with me|getreadywithme"),
    ("unboxing", r"unbox|pr package|pr box|\bpr haul\b|opening (my|this)"),
    ("gift_guide", r"gift guide|gift ideas|giftguide|stocking stuffer|gifts? for"),
    ("haul", r"\bhaul\b"),
    ("tutorial", r"tutorial|how to|step by step|howto"),
    ("review", r"review|worth it|honest|first impression|tried"),
    ("day_in_life", r"day in (my|the) life|ditl|vlog"),
]


def heuristic(v):
    text = " ".join([v.get("caption") or "", v.get("transcript") or "", " ".join(v.get("onScreenText") or [])]).lower()
    for fmt, pat in KEYWORDS:
        m = re.search(pat, text)
        if m:
            return {"format": fmt, "formatConfidence": 0.5, "formatReason": f'keyword match: "{m.group(0)}"',
                    "formatSource": "keyword"}
    return {"format": "other", "formatConfidence": 0.2, "formatReason": "no keyword match", "formatSource": "keyword"}


_claude_client = None
_jev_client = None


def _claude(v):
    global _claude_client
    import anthropic
    if _claude_client is None:
        _claude_client = anthropic.Anthropic()
    # Transcript/onScreenText can be null (not processed yet); frames carry the signal then.
    n_frames = 2 if v.get("transcript") else 3
    content = [{"type": "image", "source": {"type": "url", "url": u}} for u in (v.get("frameUrls") or [])[:n_frames]]
    content.append({"type": "text", "text": _video_text(v)})
    resp = _claude_client.beta.messages.parse(
        model=CLAUDE_MODEL,
        max_tokens=2048,
        system=SYSTEM,
        output_config={"effort": "low"},
        output_format=FormatLabel,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        messages=[{"role": "user", "content": content}],
    )
    if resp.stop_reason == "refusal" or resp.parsed_output is None:
        raise RuntimeError(f"no label (stop_reason={resp.stop_reason})")
    out = resp.parsed_output
    return {"format": out.format, "formatConfidence": round(max(0.0, min(1.0, out.confidence)), 2),
            "formatReason": out.reason, "formatSource": "claude"}


def _jev(v):
    global _jev_client
    from typesafe_sdk import Choice, TypeSafeClient
    if _jev_client is None:
        _jev_client = TypeSafeClient(model=JEV_MODEL)
    state = {
        "platform": v["platform"],
        "caption": v.get("caption") or "",
        "transcript": (v.get("transcript") or "")[:4000],
        "on_screen_text": (v.get("onScreenText") or [])[:30],
        "duration_seconds": v.get("durationSeconds"),
    }
    resp = _jev_client.system_one(
        state=state,
        questions={"format": Choice(instructions=JEV_INSTRUCTIONS, criteria=FORMAT_DEFS)},
    )
    ans = resp.choices["format"]
    top = sorted(ans.probabilities.items(), key=lambda kv: -kv[1])[:2]
    reason = " · ".join(f"{round(p * 100)}% {f.replace('_', ' ')}" for f, p in top if p >= 0.05)
    return {"format": ans.choice, "formatConfidence": round(ans.confidence, 2),
            "formatReason": f"Jev: {reason}", "formatProbabilities": {f: round(p, 3) for f, p in ans.probabilities.items()},
            "formatSource": "jev"}


def pick_backend():
    choice = os.environ.get("CLASSIFY_BACKEND")
    if choice:
        return choice
    if os.environ.get("TYPESAFE_API_KEY"):
        return "jev"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "claude"
    return "keyword"


def label_one(v, backend):
    try:
        if backend == "jev":
            label = _jev(v)
            if label["formatConfidence"] < JEV_ESCALATE_BELOW and os.environ.get("ANTHROPIC_API_KEY"):
                try:
                    return {**_claude(v), "formatProbabilities": label["formatProbabilities"],
                            "formatSource": "jev→claude"}
                except Exception as e:  # noqa: BLE001 - keep Jev's answer if Claude fails
                    print(f"classify {v['id']}: escalation failed: {type(e).__name__}: {e}")
            return label
        if backend == "claude":
            return _claude(v)
    except Exception as e:  # noqa: BLE001 - one bad video shouldn't sink the board
        print(f"classify {v['id']}: {backend}: {type(e).__name__}: {e}; using heuristic")
    return heuristic(v)


def classify_videos(videos_doc, backend=None, workers=16):
    load_env()  # keys added after the server started still get picked up
    backend = backend or pick_backend()
    cache = _load_cache()
    key = lambda v: f"{backend}:{v['id']}"  # noqa: E731
    todo = [v for v in videos_doc["videos"] if key(v) not in cache]

    def run(v):
        label = label_one(v, backend)
        # Only cache real model labels, so adding a key later upgrades heuristic ones.
        if label["formatSource"] != "keyword":
            with _lock:
                cache[key(v)] = label
        return v["id"], label

    fresh = dict(ThreadPoolExecutor(workers).map(run, todo)) if todo else {}
    _save_cache(cache)
    labels = {**{v["id"]: cache[key(v)] for v in videos_doc["videos"] if key(v) in cache}, **fresh}
    return {**videos_doc, "videos": [{**v, **labels[v["id"]]} for v in videos_doc["videos"]]}


if __name__ == "__main__":
    import sys
    src = sys.argv[1] if len(sys.argv) > 1 else "fixtures/videos.json"
    dst = sys.argv[2] if len(sys.argv) > 2 else "out/videos.labeled.json"
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    doc = classify_videos(json.load(open(src)))
    json.dump(doc, open(dst, "w"), indent=1, ensure_ascii=False)
    print("backend:", pick_backend())
    for v in doc["videos"]:
        print(f'{v["creatorHandle"]:22} {v["format"]:12} {v["formatConfidence"]:.2f} {v["formatSource"]:11} {v["formatReason"][:70]}')
