"""Deterministic search evidence, reciprocal-rank fusion, and shortlist ranking."""
from collections import Counter
from copy import deepcopy
import math
import re
import unicodedata

VERSION = "hybrid-rrf-v1"
RRF_K = 60
STOPWORDS = set("a an and are as at be brand by for from has have how i in is it its my of on or our "
                "say show that the their this to use video videos was we with you your".split())


def normalize(text):
    return " ".join(unicodedata.normalize("NFKC", text or "").casefold().split())


def handle(text):
    return normalize(text).lstrip("@")


def aliases(camp):
    return list(dict.fromkeys(normalize(a) for a in camp["brand"].get("aliases", []) if normalize(a)))


def tokens(text):
    return [t for t in re.findall(r"[^\W_]+", normalize(text)) if t not in STOPWORDS]


def phrase_matches(text, phrase):
    """Return a normalized span; never match a brand inside a longer word."""
    text, phrase = normalize(text), normalize(phrase)
    if not phrase:
        return None
    def word(char):
        return char == "_" or unicodedata.category(char)[0] in "LNM"
    for match in re.finditer(re.escape(phrase), text):
        a, b = match.span()
        if (a == 0 or not word(text[a - 1])) and (b == len(text) or not word(text[b])):
            return a, b
    return None


def text_evidence(video, camp):
    out = []
    for field in ("caption", "transcript", "onScreenText"):
        parts = (video.get(field) or []) if field == "onScreenText" else [video.get(field) or ""]
        for original in parts:
            for alias in aliases(camp):
                # A compact compound name is accepted only as a whole hashtag.
                phrases = [alias]
                if " " in alias:
                    phrases.append("#" + re.sub(r"\W", "", alias))
                if any(phrase_matches(original, p) for p in phrases):
                    out.append({"kind": field, "alias": alias, "text": original})
                    break
    return out


def exact_brand_tag(caption, mentions, brand_handle):
    target = handle(brand_handle)
    if not target:
        return False
    if target in {handle(m.get("profileHandle")) for m in mentions if isinstance(m, dict)}:
        return True
    caption_handles = re.findall(r"(?<![\w.@])@([\w.]+)", normalize(caption))
    return target in {h.rstrip(".") for h in caption_handles}


def lexical_relevance(video, camp):
    """Conservative evidence fallback, not a calibrated semantic probability."""
    evidence = text_evidence(video, camp)
    if video.get("tagged"):
        return "accepted", 1.0, "Exact brand handle tag"
    if not evidence:
        return "candidate", None, "No verifiable brand text; review visual or provider evidence"
    # Multiple-word names are less ambiguous; single-word names need nearby context.
    if any(len(e["alias"].split()) > 1 for e in evidence):
        return "accepted", 0.85, "Exact multi-word brand phrase"
    context = set(tokens(camp["brand"].get("description", "") + " " + camp.get("brief", "")))
    context -= {t for a in aliases(camp) for t in tokens(a)}
    for e in evidence:
        text = normalize(e["text"])
        span = phrase_matches(text, e["alias"])
        if span and context.intersection(tokens(text[max(0, span[0] - 160):span[1] + 160])):
            return "accepted", 0.75, "Brand phrase with nearby campaign context"
    return "candidate", None, "Ambiguous brand word; needs semantic verification"


def fuse_results(lists):
    """Merge ranked provider streams without comparing incompatible score scales.

    Each list is (source, weight, records). Duplicates contribute once per list.
    """
    merged = {}
    for source, weight, records in lists:
        seen = set()
        for rank, record in enumerate(records, 1):
            ident = record["id"]
            if ident in seen:
                continue
            seen.add(ident)
            if ident not in merged:
                merged[ident] = {**deepcopy(record), "_rrfScore": 0.0, "_retrievalRanks": [],
                                 "_visualEvidence": []}
            target = merged[ident]
            target["_rrfScore"] += weight / (RRF_K + rank)
            target["_retrievalRanks"].append({"source": source, "rank": rank})
            target["_visualEvidence"].extend(deepcopy(record.get("_visualEvidence", [])))
            target["matchedQueries"] = sorted(set(target.get("matchedQueries", [])) |
                                               set(record.get("matchedQueries", [])))
            # Prefer the richest media representation, retaining visual evidence separately.
            if len(str(record.get("media", []))) > len(str(target.get("media", []))):
                target["media"] = deepcopy(record["media"])
    return list(merged.values())


def bm25_scores(videos, query):
    """Small in-memory BM25 reranker for campaign description/brief fit."""
    terms = set(tokens(query))
    docs = [tokens(" ".join([v.get("caption") or "", v.get("transcript") or "",
                              " ".join(v.get("onScreenText") or [])])) for v in videos]
    avg = sum(map(len, docs)) / len(docs) if docs else 1
    counts = [Counter(d) for d in docs]
    df = Counter(t for c in counts for t in terms if t in c)
    scores = []
    for doc, count in zip(docs, counts):
        score = 0.0
        for term in terms:
            freq = count[term]
            if freq:
                idf = math.log(1 + (len(docs) - df[term] + 0.5) / (df[term] + 0.5))
                score += idf * freq * 2.2 / (freq + 1.2 * (0.25 + 0.75 * len(doc) / (avg or 1)))
        scores.append(score)
    return scores


def rank_videos(camp, doc):
    """Rank verified matches, then cap discovered results without dropping roster posts."""
    videos = [dict(v) for v in doc["videos"]]
    fit = bm25_scores(videos, camp["brand"].get("description", "") + " " + camp.get("brief", ""))
    max_fit = max(fit, default=0) or 1
    max_rrf = max((v.get("retrievalScore", 0) for v in videos), default=0) or 1
    for v, brief in zip(videos, fit):
        relevance = v.get("brandRelevance") or 0
        rrf = v.get("retrievalScore", 0) / max_rrf
        views = v.get("views") or 0
        interactions = sum(v.get(k) or 0 for k in ("likes", "shares", "comments"))
        engagement = min(1, (interactions + 3) / (views + 100) / 0.1) if views > 0 else 0
        v["searchScore"] = round(0.60 * relevance + 0.25 * rrf + 0.10 * brief / max_fit + 0.05 * engagement, 6)
        v["searchSignals"] = {"brand": relevance, "rrf": round(rrf, 6),
                              "brief": round(brief / max_fit, 6), "engagement": round(engagement, 6)}
    videos.sort(key=lambda v: (-v["searchScore"], -(v.get("views") or 0), v["id"]))
    roster = {(p, handle(h)) for c in camp.get("creators") or [] for p, h in c["handles"].items()}
    discovery = camp.get("discovery") or {}
    cap = int(discovery.get("maxVideos") or 200)
    per_creator = int(discovery.get("maxPerCreator") or 3)
    chosen, counts, discovered = [], Counter(), 0
    for v in videos:
        identity = (v["platform"], handle(v["creatorHandle"]))
        if identity not in roster:
            if discovered >= cap or counts[identity] >= per_creator:
                continue
            counts[identity] += 1
            discovered += 1
        chosen.append(v)
    return {**doc, "videos": chosen, "search": {**doc.get("search", {}), "algorithm": VERSION,
            "verifiedMatches": len(videos), "selectedMatches": len(chosen),
            "omittedByShortlist": len(videos) - len(chosen), "maxPerCreator": per_creator}}
