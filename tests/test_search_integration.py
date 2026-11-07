"""Regression checks for integrating hybrid search with Michael's React/insights pipeline."""
import pytest

from app import classify, fetch, insights, relevance, server
from app.metrics import build_board
from tests.test_search import CAMP, page, raw, video


@pytest.fixture(autouse=True)
def isolated_storage(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "STORE", tmp_path / "store")
    for module in (classify, relevance, insights):
        monkeypatch.setattr(module, "CACHE_PATH", tmp_path / f"{module.__name__}.json")
    for key, value in (("CLASSIFY_BACKEND", "keyword"), ("RELEVANCE_BACKEND", "keyword"),
                       ("SIGNALS_BACKEND", "heuristic"), ("INSIGHTS_BACKEND", "rules")):
        monkeypatch.setenv(key, value)


def test_normalization_keeps_intelligence_evidence():
    record = raw("creator", profilePictureUrl="https://example.com/avatar.jpg", profileDisplayName="Creator",
                 profileBio="App demos", popularComments=[{"profileHandle": "fan", "content": "Love it", "likesCount": 7}],
                 media=[{"transcript": "Lovable app tutorial", "transcriptChunks": [
                     {"text": "Unlovable", "startSeconds": 0}, {"text": "LOVABLE app builder", "startSeconds": 2}],
                     "frames": [{"timestampSeconds": 4, "onScreenTextRegions": [{"text": "Lovable"}]}]}])
    result = fetch.to_video(record, CAMP)
    assert result["firstMentionSeconds"] == 2
    assert [m["source"] for m in result["brandMoments"]] == ["transcript", "onScreenText"]
    assert result["popularComments"][0]["likes"] == 7
    assert result["profileDisplayName"] == "Creator" and result["matchedBy"] == ["caption", "transcript"]


def test_activity_respects_platform_deduplication_and_shared_budget(monkeypatch):
    records = [raw("a", profileHandle="hired"), raw("a", profileHandle="hired"),
               raw("wrong-platform", "instagram", profileHandle="hired"),
               raw("image", profileHandle="hired", format="image")]
    calls = []
    def post(path, body, params):
        calls.append(body)
        return page(records, 4)
    monkeypatch.setattr(fetch, "_post", post)
    counts, reports = fetch.fetch_activity(CAMP, {("tiktok", "hired")}, {"remaining": 1})
    assert counts == {"tiktok:hired": 1} and reports[0]["complete"]
    assert calls[0]["filters"]["format"]["includes"] == ["video"]
    counts, reports = fetch.fetch_activity(CAMP, {("tiktok", "hired")}, {"remaining": 0})
    assert counts == {} and reports[0]["reason"] == "request_budget" and len(calls) == 1


def test_live_pipeline_preserves_ranked_matches_candidates_and_insights(monkeypatch):
    camp = {**CAMP, "creators": [{"name": "Hired", "handles": {"tiktok": "hired"}}]}
    monkeypatch.setattr(server, "fetch_videos", lambda c: {
        "videos": [video("tutorial", retrievalScore=0.04), video("viral", views=9000000),
                   video("hired", "lovable puppy")],
        "activity": {"tiktok:hired": 4}, "search": {"partial": True, "rosterComplete": False, "activityComplete": True}})
    stages = []
    board = server.run_pipeline(camp, True, stage=stages.append)
    assert [v["id"] for v in board["videos"]] == ["tutorial", "viral"]
    assert board["candidates"][0]["id"] == "hired" and board["totals"]["videos"] == 2
    creator = next(c for c in board["creators"] if c["name"] == "Hired")
    assert creator["status"] == "unknown" and creator["recommendation"] is None and creator["offBriefPosts"] is None
    assert not any(a["kind"] == "nudge" for a in board["insights"]["actions"])
    assert stages == ["classify", "metrics"] and board["timeline"]
    assert all(v["signals"]["signalsSource"] == "heuristic" for v in board["videos"])


def test_prospects_use_acceptance_policy_and_exclude_roster(monkeypatch):
    camp = {**CAMP, "creators": [{"name": "Hired", "handles": {"tiktok": "@HIRED"}}]}
    def fetched(c, **kwargs):
        assert c["discover"] and c["creators"] == [] and kwargs["include_activity"] is False
        return {"videos": [video("hired"), video("creator", viewsPerFollowerPct=500, profileDisplayName="Creator"),
                           video("pet", "lovable puppy", views=99999999)], "search": {"partial": True}}
    monkeypatch.setattr(fetch, "fetch_videos", fetched)
    out = fetch.discover_prospects(camp)
    assert [p["handle"] for p in out["prospects"]] == ["creator"]
    assert out["prospects"][0]["displayName"] == "Creator"
    assert out["prospects"][0]["topVideo"]["searchScore"] > 0
    assert out["search"]["partial"] and out["candidates"][0]["id"] == "pet"


def test_insights_do_not_recommend_creators_with_incomplete_evidence():
    camp = {**CAMP, "creators": [{"name": "Hired", "handles": {"tiktok": "hired"}}]}
    board = build_board(camp, {"videos": [video("hired", viewsPerFollowerPct=900)], "search": {"rosterComplete": False}})
    result = insights.rule_insights(board)
    assert not any(a["kind"] in ("rehire", "recruit", "nudge") for a in result["actions"])
    assert insights._summary(board)["search"]["rosterComplete"] is False
