import json
from pathlib import Path

from app.fetch import build_query, keep_result

FIX = Path(__file__).resolve().parent.parent / "fixtures"
CAMP = json.loads((FIX / "campaign.json").read_text())
ROSTER = {(p, h.lower()) for c in CAMP["creators"] for p, h in c["handles"].items()}


def test_roster_query_filters_handles():
    q = build_query(CAMP, handles={"presliewatson"})
    assert q["filters"]["profileHandle"]["exactMatch"]["values"] == ["presliewatson"]
    assert "profileFollowersCount" not in q["filters"]


def test_discovery_query_searches_everyone():
    q = build_query(CAMP)
    assert "profileHandle" not in q["filters"]
    assert q["filters"]["profileFollowersCount"] == {"min": 1000}


def test_keep_result_drops_brand_and_excluded():
    r = lambda h, p="tiktok": {"platform": p, "profileHandle": h}  # noqa: E731
    assert keep_result(r("RareBeauty"), CAMP, ROSTER) is False
    assert keep_result(r("selenagomez", "instagram"), CAMP, ROSTER) is False
    assert keep_result(r("someone_new"), CAMP, ROSTER) is True
    assert keep_result(r("presliewatson"), CAMP, ROSTER) is True
    assert keep_result(r("someone_new"), {**CAMP, "discover": False}, ROSTER) is False


def test_no_brand_handles_skips_mention_filter():
    camp = {**CAMP, "brand": {**CAMP["brand"], "handles": {}}}
    assert "mentionHandles" not in build_query(camp)["queries"][0]["filters"]
