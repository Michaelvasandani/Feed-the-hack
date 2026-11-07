import json
from pathlib import Path

import pytest

from app import insights
from app.metrics import build_board

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


@pytest.fixture
def board():
    campaign = json.loads((FIXTURES / "campaign.json").read_text())
    videos = json.loads((FIXTURES / "videos.json").read_text())
    # Give two formats enough videos that one wins.
    for i, v in enumerate(videos["videos"]):
        v["format"] = "grwm" if i % 2 else "review"
    return build_board(campaign, videos)


@pytest.fixture(autouse=True)
def no_keys(monkeypatch, tmp_path):
    for k in ("GMI_API_KEY", "ANTHROPIC_API_KEY", "SIGNALS_BACKEND", "INSIGHTS_BACKEND"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(insights, "load_env", lambda: None)
    monkeypatch.setattr(insights, "CACHE_PATH", tmp_path / "signals.json")


def test_parse_json_strips_prose_and_fences():
    assert insights._parse_json('Sure!\n```json\n{"a": 1}\n```') == {"a": 1}
    with pytest.raises(ValueError):
        insights._parse_json("no json here")


def test_heuristic_signals():
    v = {"transcript": "Is this the best blush ever? I love it.", "caption": "#grwm", "matchedBy": ["transcript"]}
    s = insights.heuristic_signals(v, "Rare Beauty")
    assert s["hook"] == "Is this the best blush ever?"
    assert s["hookType"] == "question"
    assert s["sentiment"] == "positive"
    assert s["productProminence"] == "featured"


def test_gmi_signals_validated_and_cached(monkeypatch, board):
    calls = []

    def fake_chat(system, user, max_tokens=600, model=None):
        calls.append(user)
        return json.dumps({"hook": "Wait for it", "hookType": "trend", "productProminence": "hero",
                           "sentiment": "positive", "claims": ["a", "b", "c", "d"]})

    monkeypatch.setattr(insights, "_gmi_chat", fake_chat)
    vids = insights.add_signals(board["videos"][:3], "Rare Beauty", backend="gmi")
    assert all(v["signals"]["signalsSource"] == "gmi" for v in vids)
    assert vids[0]["signals"]["claims"] == ["a", "b", "c"]
    insights.add_signals(board["videos"][:3], "Rare Beauty", backend="gmi")
    assert len(calls) == 3  # second run served from cache


def test_bad_gmi_reply_falls_back_to_heuristic(monkeypatch, board):
    monkeypatch.setattr(insights, "_gmi_chat", lambda *a, **k: '{"hook": "x", "hookType": "nonsense"}')
    vids = insights.add_signals(board["videos"][:1], "Rare Beauty", backend="gmi")
    assert vids[0]["signals"]["signalsSource"] == "heuristic"


def test_rule_insights_from_board(board):
    out = insights.add_insights(board)
    ins = out["insights"]
    assert ins["insightsSource"] == "rules"
    kinds = [a["kind"] for a in ins["actions"]]
    assert kinds[0] == "brief" and "rehire" in kinds and "nudge" in kinds
    assert any("Colby" in a["title"] for a in ins["actions"] if a["kind"] == "nudge")
    assert "@rarebeauty" in ins["nextBrief"]
    assert all("signals" in v for v in out["videos"])


def test_gmi_insights_used_when_key_set(monkeypatch, board):
    monkeypatch.setenv("GMI_API_KEY", "test")
    monkeypatch.setattr(insights, "_gmi_chat", lambda system, user, max_tokens=600, model=None: json.dumps(
        {"hook": "h", "hookType": "other", "productProminence": "none", "sentiment": "neutral", "claims": []}
        if system == insights.SIGNALS_SYSTEM else
        {"headline": "GRWM wins", "actions": [{"kind": "brief", "title": "More GRWM", "detail": "3x"}],
         "nextBrief": "Do GRWMs."}))
    ins = insights.add_insights(board)["insights"]
    assert ins == {"headline": "GRWM wins", "actions": [{"kind": "brief", "title": "More GRWM", "detail": "3x"}],
                   "nextBrief": "Do GRWMs.", "insightsSource": "gmi", "insightsModel": insights.GMI_INSIGHTS_MODEL}


def test_insights_backend_error_falls_back_to_rules(monkeypatch, board):
    def boom(*a, **k):
        raise RuntimeError("down")
    monkeypatch.setattr(insights, "_gmi_chat", boom)
    assert insights.campaign_insights(board, backend="gmi")["insightsSource"] == "rules"


def test_rollup_audience_averages_comment_reads(board):
    aud = {"score": 0.5, "purchaseIntent": 0.2, "summary": "people want it", "topQuote": None}
    vids = [{**v, "signals": {"audience": aud if i == 0 else None}} for i, v in enumerate(board["videos"])]
    out = insights.rollup_audience({**board, "videos": vids})
    assert out["videos"][0]["sentiment"] == aud and out["videos"][1]["sentiment"] is None
    assert out["totals"]["avgSentiment"] == 0.5
    top = out["videos"][0]["creatorHandle"].lower()
    c = next(c for c in out["creators"] if top in {h.lower() for h in c["handles"].values()})
    assert c["sentimentScore"] == 0.5 and c["purchaseIntent"] == 0.2


def test_rule_brief_and_drafts_without_keys(board):
    b = insights.add_insights(board)
    brief = insights.next_brief(b)
    assert brief["briefSource"] == "rules" and brief["format"] == b["formats"][0]["format"]
    assert set(insights.NextBrief.model_fields) <= set(brief)
    quiet = next(c for c in b["creators"] if c["recommendation"] == "nudge")
    assert "haven't seen a post" in insights.draft_message(b, quiet)["body"]
    assert "paid collab" in insights.rule_draft(b, {**quiet, "recommendation": "recruit"})["body"]
    with pytest.raises(RuntimeError):
        insights.ask_board(b, "who should I rehire?")
