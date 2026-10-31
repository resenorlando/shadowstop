"""API contract tests. They prove the HTTP endpoints work and that the headline numbers shown on screen
(demo 14%, Hackney Town Hall 14% before, obvious fix rejected at 09:00) are genuine outputs of the
deterministic verifier in engine.py. No network and no GEMINI_API_KEY needed: no Argon or OSM calls."""
import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from shadowstop import engine
from shadowstop.server import _obvious_fix, app

ROOT = pathlib.Path(__file__).resolve().parents[1]
client = TestClient(app)


def _load(rel: str) -> dict:
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def demo() -> dict:
    return client.get("/api/scene/demo").json()


@pytest.fixture(scope="module")
def hackney() -> dict:
    return _load("scenes/hackney_town_hall.json")


@pytest.fixture(scope="module")
def hero() -> dict:
    return _load("web/assets/hero.json")


def test_health_ok():
    """The server boots and reports healthy, even with no API key set."""
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_sun_london_july_midday():
    """/api/sun gives the right sun for London at 13:00 BST on 19 Jul (solar noon): high in the south."""
    r = client.get("/api/sun", params=dict(lat=51.5, lon=0.0, date="2026-07-19", time="13:00", utc_offset=1))
    assert r.status_code == 200
    s = r.json()
    assert abs(s["elevation"] - 59.3) < 1.0
    assert abs(s["azimuth"] - 180) < 5
    assert s["dir"][2] > 0.8 and s["dir"][1] < 0  # unit vector points up and to the south


def test_demo_scene_before_shade_is_14_percent(demo):
    """The rehearsed glass-shelter scene scores ~14% shade before any fix (observed 0.1354)."""
    assert demo["waiting_area"] and demo["occluders"]
    r = client.post("/api/score", json={"scene": demo})
    assert r.status_code == 200
    s = r.json()
    assert s["score"] == pytest.approx(0.1354, abs=1e-4)
    assert s["worst_time"] == "11:45"
    assert len(s["by_time"]) > 0 and len(s["cells"]) > 0


def test_demo_obvious_fix_rejected_and_stored_canopy_accepted(demo):
    """Verifier rejects the 'obvious' solid roof with a counterexample time and sun angle,
    and accepts the stored opaque canopy proposal in demo.json."""
    bare = dict(demo, proposals=[])
    v = engine.evaluate(bare, _obvious_fix(demo))
    assert v["accepted"] is False
    assert v["worst_time"] == "11:45" and v["worst_time_sun"]["elevation"] > 0
    assert any("at 11:45 (sun az 145 deg, el 55 deg)" in r for r in v["reasons"])
    good = engine.evaluate(bare, demo["proposals"][0])
    assert good["accepted"] is True and good["reasons"] == []
    assert good["score_after"] == pytest.approx(0.876, abs=1e-3)


def test_hackney_before_and_obvious_fix_match_hero_json(hackney, hero):
    """The numbers in web/assets/hero.json (shown on screen) are reproduced exactly by the verifier:
    Hackney Town Hall 13.99% before, and the obvious fix REJECTED (0% shaded at 09:00, £4,290)."""
    before = engine.score(hackney)
    assert before["score"] == hero["before"]["score"] == pytest.approx(0.1399, abs=1e-4)
    assert before["worst_time"] == hero["before"]["worst_time"] == "09:00"
    assert [r["shade"] for r in before["by_time"]] == [r["shade"] for r in hero["before"]["by_time"]]
    assert round(before["score"] * 100) == hero["stats"]["shade_before_pct"] == 14

    v = engine.evaluate(hackney, _obvious_fix(hackney), 8000)
    stored = next(a for a in hero["attempts"] if a["by"] == "baseline")
    assert v["accepted"] is False and stored["accepted"] is False
    assert "; ".join(v["reasons"]) == stored["reason"]
    assert v["score_after"] == stored["score_after"] == pytest.approx(0.2798, abs=1e-4)
    assert v["cost_gbp"] == stored["cost_gbp"] == 4290.0
    assert v["worst_time"] == "09:00" and v["worst_time_shade"] == 0.0


def test_hero_accepted_design_is_consistent(hero):
    """The final accepted design on screen is the last accepted attempt, with matching cost and score."""
    final = [a for a in hero["attempts"] if a["accepted"]][-1]
    assert final["reason"] == "passes every check"
    assert hero["design"]["cost_gbp"] == final["cost_gbp"] == hero["stats"]["cost_gbp"] == 3350.0
    assert hero["after"]["score"] == final["score_after"]
    assert round(final["score_after"] * 100) == hero["stats"]["shade_after_pct"] == 77
    assert any(not a["accepted"] and "at 18:00" in a["reason"] for a in hero["attempts"] if a["by"] == "argon")


def test_propose_without_argon_runs_offline(demo):
    """/api/propose with use_argon=False is network-free: baseline is rejected, the brute-force
    reference search finds an accepted design, and the final scene contains it."""
    r = client.post("/api/propose", json={"scene": demo, "use_argon": False})
    assert r.status_code == 200
    body = r.json()
    assert body["baseline"]["score"] == pytest.approx(0.1354, abs=1e-4)
    assert body["attempts"][0]["by"] == "baseline" and body["attempts"][0]["accepted"] is False
    assert body["attempts"][-1]["by"] == "search" and body["attempts"][-1]["accepted"] is True
    assert len(body["final_scene"]["proposals"]) == 1


def test_scoring_is_deterministic(demo):
    """Scoring the same scene twice gives byte-identical results (no randomness, no model)."""
    a = client.post("/api/score", json={"scene": demo, "include_proposals": True}).json()
    b = client.post("/api/score", json={"scene": demo, "include_proposals": True}).json()
    assert a == b
