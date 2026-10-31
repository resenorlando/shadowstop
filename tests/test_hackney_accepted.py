"""Known-answer test: the engine reproduces the recorded verdict for Argon's accepted Hackney design.

The geometry in scenes/hackney_accepted.json was recovered by search to match web/assets/hero.json.
"""
import copy
import json
from pathlib import Path

from shadowstop import engine

ROOT = Path(__file__).resolve().parents[1]


def _load():
    scene = json.loads((ROOT / "scenes" / "hackney_accepted.json").read_text())
    hero = json.loads((ROOT / "web" / "assets" / "hero.json").read_text())
    return scene, hero


def test_hackney_accepted_reproduces_recorded_output():
    scene, hero = _load()
    prop = scene["proposals"][0]
    base = dict(copy.deepcopy(scene), proposals=[])
    v = engine.evaluate(base, prop, budget_gbp=8000)
    assert v["accepted"], v["reasons"]
    assert v["cost_gbp"] == 3350
    assert v["score_before"] == 0.1399
    assert v["score_after"] == 0.7655
    after = engine.score(dict(base, proposals=[v["proposal"]]), include_proposals=True)
    assert after["score"] == 0.7655
    assert [r["t"] for r in after["by_time"]] == [r["t"] for r in hero["after"]["by_time"]]
    assert [r["shade"] for r in after["by_time"]] == [r["shade"] for r in hero["after"]["by_time"]]
    assert prop["material"] == hero["design"]["material"]
    assert prop["size"] == hero["design"]["size"]


def test_hackney_accepted_file_scores_as_recorded_without_evaluate():
    """The live app loads this file and scores it with /api/score (engine.score, no apply_material).
    The proposal must therefore carry its catalogue opacity, or the after-score reads 88% instead of 77%."""
    scene, hero = _load()
    after = engine.score(scene, include_proposals=True)
    assert after["score"] == hero["after"]["score"] == 0.7655
    before = engine.score(dict(scene, proposals=[]))
    assert before["score"] == hero["before"]["score"]
