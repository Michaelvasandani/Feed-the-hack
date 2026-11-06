import json
from pathlib import Path

import pytest

from app.metrics import build_board, build_formats

FIX = Path(__file__).resolve().parent.parent / "fixtures"


@pytest.fixture
def campaign():
    return json.loads((FIX / "campaign.json").read_text())


@pytest.fixture
def board(campaign):
    return build_board(campaign, json.loads((FIX / "videos.json").read_text()))


def vid(**kw):
    base = {"platform": "tiktok", "creatorHandle": "a", "publishedAt": "2026-10-10T00:00:00Z",
            "views": 100, "likes": 1, "comments": 1, "shares": 1, "followers": 100,
            "viewsPerFollowerPct": 100, "engagementPerViewPct": 5, "tagged": True, "format": None}
    return {**base, **kw}


def test_totals_on_fixture(board):
    t = board["totals"]
    assert t["videos"] == 16
    assert t["creatorsTotal"] == 9
    assert t["creatorsPosted"] == 8
    assert t["untaggedVideos"] == 7
    assert t["views"] == sum(v["views"] for v in board["videos"])


def test_quiet_creator_gets_nudge(board):
    colby = next(c for c in board["creators"] if c["handles"]["tiktok"] == "colbyodonis")
    assert colby["status"] == "quiet"
    assert colby["recommendation"] == "nudge"
    assert board["creators"][-1] is colby


def test_overperformer_rehire(board):
    preslie = next(c for c in board["creators"] if c["name"] == "Preslie Watson")
    assert preslie["overperformer"] and preslie["recommendation"] == "rehire"
    selena = next(c for c in board["creators"] if c["name"] == "Selena")
    assert not selena["overperformer"] and selena["recommendation"] == "keep"


def test_multi_platform_creator_joins_both(board):
    rachael = next(c for c in board["creators"] if c["name"] == "Rachael Potash")
    assert rachael["videos"] == 2
    assert rachael["followers"] == 64700 + 65553


def test_null_format_is_unclassified(board):
    assert {f["format"] for f in board["formats"]} == {"unclassified"}
    assert not any(f["winner"] for f in board["formats"])


def test_videos_sorted_by_views(board):
    views = [v["views"] for v in board["videos"]]
    assert views == sorted(views, reverse=True)


def test_null_metrics_skipped_in_averages():
    fs = build_formats([vid(format="haul", viewsPerFollowerPct=200), vid(format="haul", viewsPerFollowerPct=None, views=None)])
    assert fs[0]["avgViewsPerFollowerPct"] == 200
    assert fs[0]["views"] == 100


def test_winner_needs_two_videos():
    fs = build_formats([vid(format="grwm", viewsPerFollowerPct=9999),
                        vid(format="haul", viewsPerFollowerPct=50), vid(format="haul", viewsPerFollowerPct=70)])
    winners = [f["format"] for f in fs if f["winner"]]
    assert winners == ["haul"]


def test_window_end_filters(campaign):
    labeled = {"videos": [vid(creatorHandle="presliewatson", publishedAt="2026-12-01T00:00:00Z")]}
    assert build_board(campaign, labeled)["totals"]["videos"] == 0
