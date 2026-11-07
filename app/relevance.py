"""Drops discovered videos that only use the brand's name as an ordinary word.

Discovery searches every creator for the brand aliases, so a brand named after a common word
("Lovable", "Glossier"…) pulls in videos about lovable dogs. Each untagged video from a creator
outside the roster gets one question: is it about the brand, or just the word? Tagged videos and
roster creators are kept as-is.

Backend follows classify.pick_backend(): Jev, else Claude, else no check (everything kept).
Verdicts are cached per brand and video id in .cache/relevance.json.
"""
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pydantic import BaseModel, Field

from app import classify
from app.env import load_env

RELEVANCE_MIN = float(os.environ.get("RELEVANCE_MIN", "0.5"))
CACHE_PATH = Path(__file__).resolve().parent.parent / ".cache" / "relevance.json"
_lock = threading.Lock()


class Verdict(BaseModel):
    about_brand: bool
    confidence: float = Field(description="0 to 1, how sure you are that about_brand is right")


def brand_context(camp):
    b = camp["brand"]
    parts = [f'Brand: {b["name"]}', "Also written as: " + ", ".join(b.get("aliases") or [])]
    if b.get("description"):
        parts.append(f'What it is: {b["description"]}')
    if camp.get("brief"):
        parts.append(f'Campaign brief: {camp["brief"]}')
    return "\n".join(parts)


def needs_check(v, roster):
    return not v.get("tagged") and (v["platform"], v["creatorHandle"].lower()) not in roster


def _jev(camp, v):
    from typesafe_sdk import Choice, TypeSafeClient
    if classify._jev_client is None:
        classify._jev_client = TypeSafeClient(model=classify.JEV_MODEL)
    name = camp["brand"]["name"]
    state = {
        "brand": brand_context(camp),
        "platform": v["platform"],
        "caption": v.get("caption") or "",
        "transcript": (v.get("transcript") or "")[:4000],
        "on_screen_text": (v.get("onScreenText") or [])[:30],
    }
    criteria = {
        "about_brand": f"the video talks about, shows or uses the company/product {name} described in `brand`",
        "just_the_word": f'"{name}" only appears as an ordinary word, a different thing with the same name, or not at all',
    }
    resp = classify._jev_client.system_one(state=state, questions={"relevance": Choice(
        instructions=f"Is this short-form video about the brand {name}, or does it just happen to contain the word?",
        criteria=criteria)})
    return resp.choices["relevance"].probabilities.get("about_brand", 0.0)


def _claude(camp, v):
    import anthropic
    if classify._claude_client is None:
        classify._claude_client = anthropic.Anthropic()
    resp = classify._claude_client.beta.messages.parse(
        model=classify.CLAUDE_MODEL,
        max_tokens=1024,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system="You check whether a social video is about a specific brand, or only contains its name as an "
               "ordinary word or refers to something else with the same name.",
        output_config={"effort": "low"},
        output_format=Verdict,
        messages=[{"role": "user", "content": brand_context(camp) + "\n\n" + classify._video_text(v)}],
    )
    out = resp.parsed_output
    if out is None:
        raise RuntimeError(f"no verdict (stop_reason={resp.stop_reason})")
    c = max(0.0, min(1.0, out.confidence))
    return c if out.about_brand else 1 - c


def filter_relevant(camp, videos_doc, backend=None, workers=16):
    """Returns videos_doc without off-brand discovered videos; adds `droppedOffBrand`."""
    load_env()
    backend = backend or classify.pick_backend()
    roster = {(p, h.lower()) for c in camp.get("creators") or [] for p, h in c["handles"].items()}
    todo = [v for v in videos_doc["videos"] if needs_check(v, roster)]
    if backend not in ("jev", "claude") or not todo:
        return {**videos_doc, "droppedOffBrand": 0}
    ask = _jev if backend == "jev" else _claude
    try:
        cache = json.loads(CACHE_PATH.read_text())
    except (OSError, ValueError):
        cache = {}
    key = lambda v: f'{backend}:{camp["brand"]["name"].lower()}:{v["id"]}'  # noqa: E731

    def run(v):
        if key(v) in cache:
            return v["id"], cache[key(v)]
        try:
            p = round(ask(camp, v), 3)
        except Exception as e:  # noqa: BLE001 - keep the video rather than lose it on an API error
            print(f"relevance {v['id']}: {backend}: {type(e).__name__}: {e}; keeping")
            return v["id"], None
        with _lock:
            cache[key(v)] = p
        return v["id"], p

    scores = dict(ThreadPoolExecutor(workers).map(run, todo))
    CACHE_PATH.parent.mkdir(exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, indent=1))
    kept = [{**v, "brandRelevance": scores[v["id"]]} if v["id"] in scores else v for v in videos_doc["videos"]
            if scores.get(v["id"]) is None or scores[v["id"]] >= RELEVANCE_MIN]
    return {**videos_doc, "videos": kept, "droppedOffBrand": len(videos_doc["videos"]) - len(kept)}
