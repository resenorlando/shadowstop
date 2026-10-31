"""Known-answer tests for the verifier. If these fail, no score on screen can be trusted."""
import json
import math
import pathlib
from datetime import datetime, timezone

import numpy as np
import pytest

from shadowstop.engine import check_constraints, evaluate, score, shade_at
from shadowstop.geometry import transmission
from shadowstop.sun import sun_position, sun_vector

ROOT = pathlib.Path(__file__).resolve().parents[1]


# --- Sun position against known values -------------------------------------------------
def test_london_summer_solstice_noon():
    az, el = sun_position(51.5, 0.0, datetime(2026, 6, 21, 12, 2, tzinfo=timezone.utc))
    assert abs(el - (90 - 51.5 + 23.44)) < 0.3   # ~61.9 deg at solar noon
    assert abs(az - 180) < 2


def test_equator_equinox_noon_is_overhead():
    _, el = sun_position(0.0, 0.0, datetime(2026, 3, 20, 12, 7, tzinfo=timezone.utc))
    assert el > 89


def test_sun_rises_in_the_east_and_sets_in_the_west():
    az_am, _ = sun_position(51.5, 0.0, datetime(2026, 6, 21, 6, 0, tzinfo=timezone.utc))
    az_pm, _ = sun_position(51.5, 0.0, datetime(2026, 6, 21, 18, 0, tzinfo=timezone.utc))
    assert 45 < az_am < 135 and 225 < az_pm < 315


def test_night_has_negative_elevation():
    _, el = sun_position(51.5, 0.0, datetime(2026, 12, 21, 0, 0, tzinfo=timezone.utc))
    assert el < 0


# --- Ray casting against shapes with hand-computable answers ----------------------------
def _pt(x, y, z=1.2):
    return np.array([[x, y, z]], dtype=float)


def test_empty_scene_is_full_sun():
    d = np.array(sun_vector(180, 45))
    assert transmission(_pt(0, 0), d, [])[0] == 1.0


def test_opaque_roof_directly_overhead_blocks_high_sun():
    roof = {"shape": "box", "center": [0, 0], "size": [2, 2], "z0": 2.4, "z1": 2.5, "opacity": 1.0}
    assert transmission(_pt(0, 0), np.array(sun_vector(180, 80)), [roof])[0] == 0.0


def test_low_sun_slips_under_the_roof():
    # Roof edge is 1 m away, 1.2 m above the sample point -> sun lower than ~50 deg (from that side) gets under it
    roof = {"shape": "box", "center": [0, 0], "size": [2, 2], "z0": 2.4, "z1": 2.5, "opacity": 1.0}
    assert transmission(_pt(0, 0), np.array(sun_vector(270, 30)), [roof])[0] == 1.0


def test_glass_lets_most_sun_through():
    glass = {"shape": "box", "center": [0, 0], "size": [2, 2], "z0": 2.4, "z1": 2.5, "opacity": 0.1}
    assert transmission(_pt(0, 0), np.array(sun_vector(180, 80)), [glass])[0] == pytest.approx(0.9)


def test_pole_shadow_length_matches_trigonometry():
    # A 3 m pole; at 45 deg sun elevation its shadow (at ground) is 3 m long, pointing away from the sun.
    pole = {"shape": "cylinder", "center": [0, 0], "radius": 0.1, "z0": 0, "z1": 3, "opacity": 1.0}
    d = np.array(sun_vector(180, 45))  # sun due south, shadow falls north
    assert transmission(_pt(0, 2.5, 0.0), d, [pole])[0] == 0.0   # inside the 3 m shadow
    assert transmission(_pt(0, 3.5, 0.0), d, [pole])[0] == 1.0   # beyond it
    assert transmission(_pt(0, -1.0, 0.0), d, [pole])[0] == 1.0  # sunny side


def test_building_to_the_south_shades_point_behind_it():
    bldg = {"shape": "prism", "footprint": [[-10, -10], [10, -10], [10, -5], [-10, -5]], "z0": 0, "z1": 10, "opacity": 1}
    # Sun due south at 40 deg: the 10 m wall shades ~10/tan(40) = 11.9 m north of it -> point at y=0 (5 m away) is shaded
    assert transmission(_pt(0, 0), np.array(sun_vector(180, 40)), [bldg])[0] == 0.0
    assert transmission(_pt(0, 0), np.array(sun_vector(0, 40)), [bldg])[0] == 1.0  # sun behind us


def test_tree_crown():
    tree = {"shape": "sphere", "center": [0, 3], "radius": 2, "z0": 3, "z1": 7, "opacity": 0.7}
    d = np.array(sun_vector(0, 45))  # sun due north; ray from origin rises 1:1 towards the crown
    assert transmission(_pt(0, 0, 1.2), d, [tree])[0] == pytest.approx(0.3)


# --- Whole-scene behaviour -----------------------------------------------------------------
def _demo():
    return json.loads((ROOT / "scenes" / "demo.json").read_text())


def test_demo_glass_shelter_scores_low():
    s = score(_demo())
    assert 0 <= s["score"] < 0.4
    assert s["worst_time"] is not None


def test_opaque_canopy_beats_glass_roof():
    sc = _demo()
    assert score(sc, include_proposals=True)["score"] > score(sc)["score"]


def test_constraints_reject_canopy_over_the_road():
    sc = _demo()
    bad = {"kind": "canopy", "shape": "box", "center": [0, -8], "size": [6, 2.5], "z0": 2.6, "z1": 2.7, "opacity": 1}
    assert any("buildable" in e for e in check_constraints(sc, bad))


def test_constraints_reject_low_headroom():
    sc = _demo()
    bad = {"kind": "canopy", "shape": "box", "center": [0, -1], "size": [6, 2.5], "z0": 1.5, "z1": 1.6, "opacity": 1}
    assert check_constraints(sc, bad)


def test_evaluate_returns_verdict_and_counterexample():
    v = evaluate(_demo(), _demo()["proposals"][0])
    assert set(v) >= {"accepted", "reasons", "score_before", "score_after", "worst_time"}


def test_shade_at_named_points():
    sc = _demo()
    vals = shade_at(sc, [[0, -0.3]], datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc))
    assert 0 <= vals[0] <= 1
