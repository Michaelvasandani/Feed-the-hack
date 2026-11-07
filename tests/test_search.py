from copy import deepcopy
import json
from pathlib import Path

import pytest

from app import fetch, relevance
from app.metrics import build_board
from app.search import (bm25_scores, exact_brand_tag, fuse_results, lexical_relevance,
                        phrase_matches, rank_videos, text_evidence)

CAMP = {"id": "demo", "brand": {"name": "Lovable", "aliases": ["Lovable"],
        "description": "AI app builder", "handles": {"tiktok": "lovable_dev", "instagram": "lovable"}},
        "window": {"start": "2026-10-01", "end": "2026-11-06"}, "discover": True,
        "discovery": {"maxVideos": 3}, "creators": [], "brief": "Build a website tutorial"}


def video(ident, caption="I built my app with Lovable", **kwargs):
    return {"id": ident, "caption": caption, "platform": "tiktok", "creatorHandle": ident,
            "publishedAt": "2026-10-09T12:00:00Z", "transcript": None, "onScreenText": None,
            "views": 100, "likes": 2, "comments": 0, "shares": 0, "tagged": False,
            "url": "https://www.tiktok.com/@example", **kwargs}


def raw(ident, platform="tiktok", **kwargs):
    return {"id": ident, "profileHandle": ident, "platform": platform, "platformId": ident,
            "publishedAt": "2026-10-09T12:00:00Z", "format": "video", "caption": "Lovable app builder",
            "viewsCount": 100, "media": [], **kwargs}


def page(records, total=None, anchor=None):
    pagination = {}
    if total is not None:
        pagination["totalCount"] = total
    if anchor is not None:
        pagination["aiSearchAnchor"] = anchor
    return {"data": {"results": records}, "metadata": {"timestamp": 123, "pagination": pagination}}


@pytest.fixture(autouse=True)
def isolate_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(relevance, "CACHE_PATH", tmp_path / "relevance.json")


@pytest.mark.parametrize("text,phrase,expected", [
    ("I love RARE   Beauty!", "Rare Beauty", True), ("rarebear", "rare", False),
    ("lovable puppies", "lovable", True), ("unlovable", "lovable", False),
    ("Ｒａｒｅ Beauty", "rare beauty", True), ("#rarebeautyness", "rarebeauty", False),
    ("RARE BEAUTY", "", False), ("beauty_thing", "beauty", False),
])
def test_phrase_boundaries(text, phrase, expected):
    assert bool(phrase_matches(text, phrase)) == expected


def test_compound_hashtag_and_all_media_evidence():
    camp = {**CAMP, "brand": {"aliases": ["Rare Beauty"], "handles": {}}}
    result = fetch.to_video(raw("x", caption="#RareBeauty", media=[{}, {"transcript": "I love RARE BEAUTY",
                       "onScreenText": ["Rare Beauty"], "duration": 10}]), camp)
    assert set(result["matchedBy"]) == {"caption", "transcript", "onScreenText"}
    assert result["transcript"] == "I love RARE BEAUTY" and result["contentFormat"] == "video"


def test_handle_matching_is_exact_and_platform_specific():
    assert not exact_brand_tag("@lovable_dev_fan", [], "lovable_dev")
    assert not exact_brand_tag("me@lovable_dev", [], "lovable_dev")
    assert exact_brand_tag("Try @LOVABLE_DEV!", [], "lovable_dev")
    assert exact_brand_tag("Try @lovable_dev.", [], "lovable_dev")
    assert not fetch.to_video(raw("x", platform="instagram", caption="@lovable_dev"), CAMP)["tagged"]


def test_disambiguates_common_brand_word_without_model():
    assert lexical_relevance(video("dog", "my lovable puppy is sleeping"), CAMP)[0] == "candidate"
    assert lexical_relevance(video("app"), CAMP)[0] == "accepted"
    assert lexical_relevance(video("bad", "unlovable app builder"), CAMP)[0] == "candidate"


def test_fusion_counts_each_document_once_per_stream_and_preserves_visual_evidence():
    a, b = raw("a"), raw("b")
    b["_visualEvidence"] = [{"kind": "visual", "assetId": "asset", "score": 0.9}]
    fused = {r["id"]: r for r in fuse_results([("text", 1, [a, a, b]), ("visual", 1, [b])])}
    assert fused["a"]["_rrfScore"] == pytest.approx(1 / 61)
    assert fused["b"]["_rrfScore"] > fused["a"]["_rrfScore"]
    assert fused["b"]["_visualEvidence"]
    assert "_rrfScore" not in a


def test_pagination_without_total_and_raw_offsets(monkeypatch):
    responses = iter([page([raw("a"), raw("a")]), page([raw("b")]), page([])])
    offsets = []
    def post(path, body, params):
        offsets.append(params["offset"])
        return next(responses)
    monkeypatch.setattr(fetch, "_post", post)
    report = {}
    records, _ = fetch.search_all(fetch.build_query(CAMP), max_results=10, report=report)
    assert offsets == [0, 2, 3] and [r["id"] for r in records] == ["a", "a", "b"]
    assert report["complete"]


def test_repeated_page_stops_as_partial(monkeypatch):
    monkeypatch.setattr(fetch, "_post", lambda *args: page([raw("a")], 100))
    report = {}
    records, _ = fetch.search_all(fetch.build_query(CAMP), report=report)
    assert len(records) == 1 and report["reason"] == "repeated_page" and not report["complete"]


def test_visual_anchor_is_preserved_and_required(monkeypatch):
    responses = iter([page([raw("a")], 2, "anchor + & /"), page([raw("b")], 2)])
    params_seen = []
    def post(path, body, params):
        params_seen.append(params)
        return next(responses)
    monkeypatch.setattr(fetch, "_post", post)
    report = {}
    body = fetch.build_query(CAMP, ["asset"], channel="visual")
    fetch.search_all(body, report=report)
    assert params_seen[1]["aiSearchAnchor"] == "anchor + & /" and report["complete"]
    monkeypatch.setattr(fetch, "_post", lambda *args: page([raw("a")], 2))
    report = {}
    fetch.search_all(body, report=report)
    assert report["reason"] == "missing_visual_anchor"


def test_budget_and_changed_totals_do_not_claim_complete(monkeypatch):
    monkeypatch.setattr(fetch, "_post", lambda *args: page([raw("a")], 200))
    report = {}
    fetch.search_all(fetch.build_query(CAMP), report=report, budget={"remaining": 1})
    assert report["reason"] == "request_budget"
    responses = iter([page([raw("a")], 2), page([raw("b")], 1)])
    monkeypatch.setattr(fetch, "_post", lambda *args: next(responses))
    report = {}
    fetch.search_all(fetch.build_query(CAMP), report=report)
    assert report["reason"] == "total_changed" and not report["complete"]


def test_fused_discovery_queries_are_balanced_and_video_only(monkeypatch):
    camp = deepcopy(CAMP)
    camp["discovery"] = {"maxVideos": 2, "maxCandidates": 12}
    calls = []
    def post(path, body, params):
        calls.append((body, params))
        platform = body["filters"]["platform"]["includes"][0]
        return page([raw(platform, platform)], 1)
    monkeypatch.setattr(fetch, "_post", post)
    out = fetch.fetch_videos(camp)
    assert len(calls) == 6 and len(out["videos"]) == 2
    assert {p["sort"] for _, p in calls} == {"transcriptRelevance:desc,viewsCount:desc", "publishedAt:desc", "viewsCount:desc"}
    assert all(b["filters"]["format"]["includes"] == ["video"] for b, _ in calls)
    assert all(p["limit"] == 2 for _, p in calls)


def test_roster_platform_identity_and_local_date_content_filters(monkeypatch):
    camp = {**CAMP, "discover": False, "creators": [{"name": "A", "handles": {"tiktok": "@A"}}]}
    records = [raw("ok", profileHandle="a"), raw("ig", "instagram", profileHandle="a"),
               raw("old", profileHandle="a", publishedAt="2026-09-30T23:59:59Z"),
               raw("image", profileHandle="a", format="image")]
    monkeypatch.setattr(fetch, "_post", lambda *args: page(records, 4))
    out = fetch.fetch_videos(camp)
    assert [v["id"] for v in out["videos"]] == ["ok"]
    assert fetch.in_scope(raw("last", publishedAt="2026-11-06T23:59:59.999Z"), camp)
    assert not fetch.in_scope(raw("next", publishedAt="2026-11-07T00:00:00Z"), camp)


def test_invalid_inputs_make_no_paid_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(fetch, "_post", lambda *args: calls.append(args))
    camp = deepcopy(CAMP)
    camp["brand"]["aliases"] = [f"alias {i}" for i in range(200)]
    with pytest.raises(ValueError, match="500"):
        fetch.fetch_videos(camp)
    with pytest.raises(ValueError, match="maxVideos"):
        fetch.fetch_videos({**CAMP, "discovery": {"maxVideos": -1}})
    assert calls == []


def test_model_errors_ambiguity_and_visual_only_matches_are_candidates(monkeypatch):
    monkeypatch.setattr(relevance, "_jev", lambda *args: 0.5)
    doc = relevance.filter_relevant(CAMP, {"videos": [video("a"), video("v", "nice product", matchedBy=["visual"])]}, backend="jev")
    assert not doc["videos"] and len(doc["candidates"]) == 2
    monkeypatch.setattr(relevance, "_jev", lambda *args: float("nan"))
    doc = relevance.filter_relevant(CAMP, {"videos": [video("b")]}, backend="jev")
    assert not doc["videos"] and doc["candidates"][0]["brandRelevance"] is None


def test_relevance_cache_invalidates_on_brand_context_or_content(monkeypatch):
    calls = []
    def model(*args):
        calls.append(args)
        return 0.9
    monkeypatch.setattr(relevance, "_jev", model)
    for camp, v in [(CAMP, video("a")), (CAMP, video("a")),
                    ({**CAMP, "brief": "different campaign"}, video("a")),
                    (CAMP, video("a", "changed transcript"))]:
        relevance.filter_relevant(camp, {"videos": [v]}, backend="jev")
    assert len(calls) == 3


def test_ranking_prefers_relevance_diversifies_and_preserves_roster():
    camp = {**CAMP, "creators": [{"name": "Hired", "handles": {"tiktok": "hired"}}],
            "discovery": {"maxVideos": 3, "maxPerCreator": 1}}
    rows = [video("viral", "lovable dogs", views=100_000_000, brandRelevance=0.1),
            video("relevant", brandRelevance=0.9, retrievalScore=0.03),
            video("repeat", creatorHandle="relevant", brandRelevance=0.9, retrievalScore=0.02),
            video("another", brandRelevance=0.9),
            *[video(f"h{i}", creatorHandle="hired", brandRelevance=0.8) for i in range(5)]]
    out = rank_videos(camp, {"videos": rows})
    assert out["videos"][0]["id"] == "relevant"
    assert sum(v["creatorHandle"] == "hired" for v in out["videos"]) == 5
    assert sum(v["creatorHandle"] == "relevant" for v in out["videos"]) == 1
    assert len(out["videos"]) == 8


def test_brief_fit_and_metrics_preserve_search_order_and_candidate_exclusion():
    assert bm25_scores([video("a", "website tutorial"), video("b", "puppy walking")], "website tutorial")[0] > 0
    camp = {**CAMP, "creators": [{"name": "Hired", "handles": {"tiktok": "hired"}}]}
    doc = {"videos": [video("best", searchScore=0.9), video("viral", views=999999, searchScore=0.5)],
           "candidates": [video("hired", views=100_000_000)], "search": {"rosterComplete": False}}
    board = build_board(camp, doc)
    assert [v["id"] for v in board["videos"]] == ["best", "viral"]
    assert board["totals"]["views"] == 1000099
    hired = next(c for c in board["creators"] if c["name"] == "Hired")
    assert hired["status"] == "unknown" and hired["recommendation"] is None


def test_common_word_regression_precision_at_three():
    # A small adversarial regression set, not a real-world relevance benchmark.
    rows = [video("dog", "lovable dog", views=99_000_000), video("cat", "lovable cat", views=88_000_000),
            video("a", views=1000), video("b", "Lovable website tutorial", views=500), video("c", views=200)]
    accepted = relevance.filter_relevant(CAMP, {"videos": rows}, backend="keyword")
    new = rank_videos(CAMP, accepted)["videos"][:3]
    relevant = {"a", "b", "c"}
    baseline = sorted(rows, key=lambda v: -v["views"])[:3]
    assert sum(v["id"] in relevant for v in baseline) == 1
    assert sum(v["id"] in relevant for v in new) == 3


def test_verification_budget_does_not_spend_on_every_candidate(monkeypatch):
    calls = []
    def model(*args):
        calls.append(args)
        return 0.9
    monkeypatch.setattr(relevance, "_jev", model)
    rows = [video(f"x{i:03}", "lovable puppy") for i in range(205)]
    out = relevance.filter_relevant(CAMP, {"videos": rows}, backend="jev")
    assert len(calls) == 200 and len(out["candidates"]) == 5


def test_failed_search_stream_preserves_other_results(monkeypatch):
    def post(path, body, params):
        platform = body["filters"]["platform"]["includes"][0]
        if platform == "instagram":
            raise fetch.OrianeError("temporary failure")
        return page([raw("a")], 1)
    monkeypatch.setattr(fetch, "_post", post)
    out = fetch.fetch_videos(CAMP)
    assert out["search"]["partial"] and [v["id"] for v in out["videos"]] == ["a"]


def test_url_encoding_preserves_anchor(monkeypatch):
    import io
    seen = []
    monkeypatch.setenv("ORIANE_API_KEY", "fake")
    def open_request(request, **kwargs):
        seen.append(request.full_url)
        return io.BytesIO(b'{"data": {"results": []}}')
    monkeypatch.setattr(fetch.urllib.request, "urlopen", open_request)
    fetch._post("contents/search", {}, {"aiSearchAnchor": "a + & /"})
    from urllib.parse import parse_qs, urlparse
    assert parse_qs(urlparse(seen[0]).query)["aiSearchAnchor"] == ["a + & /"]


def test_sample_pipeline_remains_offline_with_model_keys(monkeypatch, tmp_path):
    from app import server, classify, insights
    monkeypatch.setenv("TYPESAFE_API_KEY", "should-never-be-used")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "should-never-be-used")
    monkeypatch.setenv("GMI_API_KEY", "should-never-be-used")
    monkeypatch.setattr(server, "STORE", tmp_path / "store")
    monkeypatch.setattr(classify, "CACHE_PATH", tmp_path / "formats.json")
    monkeypatch.setattr(insights, "CACHE_PATH", tmp_path / "signals.json")
    def forbidden(*args, **kwargs):
        pytest.fail("Sample mode called a paid provider")
    monkeypatch.setattr(server, "fetch_videos", forbidden)
    monkeypatch.setattr(classify, "_jev", forbidden)
    monkeypatch.setattr(classify, "_claude", forbidden)
    monkeypatch.setattr(insights, "_gmi_request", forbidden)
    monkeypatch.setattr(insights, "_claude_insights", forbidden)
    result = server.run_pipeline(server.demo_campaign(), live=False)
    assert result["totals"]["videos"] == 16
    assert result["totals"]["views"] == 16854570
    assert result["insights"]["insightsSource"] == "rules"
    assert server.store_read("boards", result["campaign"]["id"])["totals"] == result["totals"]


def test_normalized_roster_is_not_double_counted_as_discovered():
    camp = {**CAMP, "window": {"start": "2026-10-01", "end": None},
            "creators": [{"name": "Hired", "handles": {"tiktok": "@HIRED"}}]}
    board = build_board(camp, {"videos": [video("hired")]})
    assert len(board["creators"]) == 1
    assert board["totals"]["creatorsPosted"] == 1 and board["totals"]["creatorsDiscovered"] == 0


def test_one_result_default_still_searches_both_platforms(monkeypatch):
    calls = []
    def post(path, body, params):
        calls.append(body["filters"]["platform"]["includes"][0])
        return page([], 0)
    monkeypatch.setattr(fetch, "_post", post)
    fetch.fetch_videos({**CAMP, "discovery": {"maxVideos": 1}})
    assert calls == ["instagram", "tiktok"] * 3
