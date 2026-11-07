from types import SimpleNamespace

import pytest

from app import classify

VIDEO = {"id": "cnt_1", "platform": "tiktok", "caption": "grwm for a wedding #grwm", "transcript": "get ready with me",
         "onScreenText": ["GRWM"], "durationSeconds": 40, "frameUrls": []}


class FakeJev:
    def __init__(self, probs):
        self.probs, self.calls = probs, []

    def system_one(self, state, questions):
        self.calls.append((state, questions))
        choice = max(self.probs, key=self.probs.get)
        ans = SimpleNamespace(choice=choice, confidence=self.probs[choice], probabilities=self.probs)
        return SimpleNamespace(choices={"format": ans})


@pytest.fixture
def jev(monkeypatch):
    def install(probs):
        fake = FakeJev(probs)
        monkeypatch.setattr(classify, "_jev_client", fake)
        return fake
    return install


def test_jev_label_maps_probabilities(jev):
    fake = jev({"grwm": 0.8, "tutorial": 0.15, "review": 0.05})
    label = classify._jev(VIDEO)
    assert label["format"] == "grwm" and label["formatConfidence"] == 0.8
    assert label["formatReason"] == "Jev: 80% grwm · 15% tutorial"
    assert label["formatSource"] == "jev"
    state, questions = fake.calls[0]
    assert state["caption"] == VIDEO["caption"]
    assert set(questions["format"].criteria) == set(classify.FORMATS)


def test_low_confidence_escalates_to_claude(jev, monkeypatch):
    jev({"grwm": 0.4, "tutorial": 0.35, "review": 0.25})
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(classify, "_claude", lambda v: {"format": "tutorial", "formatConfidence": 0.9,
                                                        "formatReason": "steps", "formatSource": "claude"})
    label = classify.label_one(VIDEO, "jev")
    assert label["format"] == "tutorial" and label["formatSource"] == "jev→claude"


def test_low_confidence_stays_jev_without_anthropic_key(jev, monkeypatch):
    jev({"grwm": 0.4, "tutorial": 0.35, "review": 0.25})
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert classify.label_one(VIDEO, "jev")["formatSource"] == "jev"


def test_backend_error_falls_back_to_keywords(monkeypatch):
    monkeypatch.setattr(classify, "_jev", lambda v: (_ for _ in ()).throw(RuntimeError("down")))
    label = classify.label_one(VIDEO, "jev")
    assert label["formatSource"] == "keyword" and label["format"] == "grwm"
