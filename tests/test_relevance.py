from types import SimpleNamespace

import pytest

from app import classify, relevance

CAMP = {"brand": {"name": "Lovable", "aliases": ["lovable"], "handles": {"tiktok": "lovable_dev"},
                  "description": "AI app builder"},
        "creators": [{"name": "Hired", "handles": {"tiktok": "hired"}}], "discover": True}


def vid(i, handle="someone", tagged=False):
    return {"id": f"v{i}", "platform": "tiktok", "creatorHandle": handle, "tagged": tagged,
            "caption": f"caption {i}", "transcript": None, "onScreenText": None}


class FakeJev:
    def __init__(self, about):
        self.about, self.calls = about, []

    def system_one(self, state, questions):
        self.calls.append(state)
        p = self.about[state["caption"]]
        return SimpleNamespace(choices={"relevance": SimpleNamespace(
            probabilities={"about_brand": p, "just_the_word": 1 - p})})


@pytest.fixture(autouse=True)
def tmp_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(relevance, "CACHE_PATH", tmp_path / "relevance.json")


def test_drops_off_brand_keeps_tagged_and_roster(monkeypatch):
    fake = FakeJev({"caption 1": 0.9, "caption 2": 0.1, "caption 4": 0.9})
    monkeypatch.setattr(classify, "_jev_client", fake)
    doc = {"videos": [vid(1), vid(2), vid(3, tagged=True), vid(4, handle="Hired")]}
    out = relevance.filter_relevant(CAMP, doc, backend="jev")
    assert [v["id"] for v in out["videos"]] == ["v1", "v3", "v4"]
    assert out["droppedOffBrand"] == 1
    assert out["videos"][0]["brandRelevance"] == 0.9
    assert len(fake.calls) == 3 and "AI app builder" in fake.calls[0]["brand"]


def test_api_error_keeps_candidate_out_of_totals(monkeypatch):
    class Boom:
        def system_one(self, **_):
            raise RuntimeError("down")
    monkeypatch.setattr(classify, "_jev_client", Boom())
    out = relevance.filter_relevant(CAMP, {"videos": [vid(1)]}, backend="jev")
    assert not out["videos"] and len(out["candidates"]) == 1 and out["droppedOffBrand"] == 0


def test_no_model_requires_actual_brand_evidence():
    out = relevance.filter_relevant(CAMP, {"videos": [vid(1)]}, backend="keyword")
    assert not out["videos"] and len(out["candidates"]) == 1
