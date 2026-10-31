"""The verifier: deterministic shade scoring and proposal checks.

Nothing here calls a model. Argon proposes; this module decides.
"""
from __future__ import annotations

import copy
import math

import numpy as np
import shapely
from shapely.geometry import Polygon

from .geometry import footprint, transmission
from .materials import apply_material, shade_value
from .sun import local_to_utc, sun_position, sun_vector

SAMPLE_HEIGHT_M = 1.2  # torso height of a person waiting; shade is measured here

# Acceptance rules for a proposed fix (all must pass)
MIN_GAIN = 0.25            # at least +25 percentage points of shade over the day
MIN_WORST_TIME_SHADE = 0.4  # and no moment in the peak-heat window where the waiting area is under 40% shaded
PEAK_HEAT_HOURS = (11, 16)  # worst-moment rule applies when heat stress peaks; low 09:00/18:00 sun can't be blocked by one roof
MAX_CANOPY_AREA_M2 = 24.0
CANOPY_HEIGHT_RANGE = (2.3, 4.5)
MAX_TREE_RADIUS = 4.0


def grid(scene: dict, step: float = 0.5) -> np.ndarray:
    poly = Polygon(scene["waiting_area"])
    minx, miny, maxx, maxy = poly.bounds
    xs = np.arange(minx + step / 2, maxx, step)
    ys = np.arange(miny + step / 2, maxy, step)
    gx, gy = np.meshgrid(xs, ys)
    gx, gy = gx.ravel(), gy.ravel()
    inside = shapely.contains_xy(poly, gx, gy)
    if not inside.any():  # tiny polygon: fall back to its centroid
        c = poly.centroid
        gx, gy, inside = np.array([c.x]), np.array([c.y]), np.array([True])
    pts = np.column_stack([gx[inside], gy[inside], np.full(inside.sum(), SAMPLE_HEIGHT_M)])
    return pts


def times(scene: dict, minutes_step: int = 15):
    h0, h1 = scene.get("hours", [9, 18])
    out = []
    m = h0 * 60
    while m <= h1 * 60:
        out.append((m // 60, m % 60))
        m += minutes_step
    return out


def score(scene: dict, include_proposals: bool = False, grid_step: float = 0.5, minutes_step: int = 15) -> dict:
    occluders = list(scene.get("occluders", []))
    if include_proposals:
        occluders += scene.get("proposals", [])
    pts = grid(scene, grid_step)
    per_time, cell_sum, n_sun = [], np.zeros(len(pts)), 0
    for hh, mm in times(scene, minutes_step):
        dt = local_to_utc(scene["date"], hh, mm, scene.get("utc_offset", 0))
        az, el = sun_position(scene["lat"], scene["lon"], dt)
        row = {"t": f"{hh:02d}:{mm:02d}", "sun_az": round(az, 2), "sun_el": round(el, 2)}
        if el <= 0:
            row["shade"] = None
        else:
            shade = 1.0 - transmission(pts, np.array(sun_vector(az, el)), occluders)
            cell_sum += shade
            n_sun += 1
            row["shade"] = round(float(shade.mean()), 4)
        per_time.append(row)
    sun_rows = [r for r in per_time if r["shade"] is not None]
    total = float(np.mean([r["shade"] for r in sun_rows])) if sun_rows else 0.0
    worst = min(sun_rows, key=lambda r: r["shade"]) if sun_rows else None
    cells = cell_sum / max(n_sun, 1)
    return {
        "score": round(total, 4),
        "by_time": per_time,
        "cells": [{"x": round(float(x), 2), "y": round(float(y), 2), "shade": round(float(s), 4)}
                  for (x, y, _), s in zip(pts, cells)],
        "worst_time": worst["t"] if worst else None,
        "worst_time_shade": worst["shade"] if worst else None,
        "worst_time_sun": {"azimuth": worst["sun_az"], "elevation": worst["sun_el"]} if worst else None,
        "grid_step": grid_step,
        "minutes_step": minutes_step,
        "sample_height_m": SAMPLE_HEIGHT_M,
    }


def check_constraints(scene: dict, proposal: dict) -> list[str]:
    """Physical/buildability rules a proposal must meet. Returns a list of violations."""
    errs = []
    kind = proposal.get("kind")
    if kind not in ("canopy", "tree"):
        errs.append(f"kind must be canopy or tree, got {kind!r}")
        return errs
    if proposal.get("shape") == "sphere":
        if proposal.get("radius", 0) > MAX_TREE_RADIUS:
            errs.append(f"tree crown radius {proposal['radius']} m exceeds {MAX_TREE_RADIUS} m")
        plan = Polygon([[proposal["center"][0] + proposal["radius"] * math.cos(a),
                         proposal["center"][1] + proposal["radius"] * math.sin(a)]
                        for a in np.linspace(0, 2 * math.pi, 16, endpoint=False)])
        base = Polygon([[proposal["center"][0] + 0.3, proposal["center"][1]], [proposal["center"][0], proposal["center"][1] + 0.3],
                        [proposal["center"][0] - 0.3, proposal["center"][1]], [proposal["center"][0], proposal["center"][1] - 0.3]])
    else:
        plan = Polygon(footprint(proposal))
        base = plan
        if plan.area > MAX_CANOPY_AREA_M2 + 0.05:  # tolerance: 24.0 m2 is allowed
            errs.append(f"canopy area {plan.area:.1f} m2 exceeds {MAX_CANOPY_AREA_M2} m2")
        lo, hi = CANOPY_HEIGHT_RANGE
        if not (lo <= proposal.get("z0", 0) <= hi):
            errs.append(f"canopy underside at {proposal.get('z0')} m; must be between {lo} and {hi} m (headroom / bus clearance)")
    if scene.get("buildable_area"):
        zone = Polygon(scene["buildable_area"])
        if not zone.buffer(1e-6).contains(base):
            errs.append("outside the buildable area (would sit over the carriageway or private land)")
    for occ in scene.get("occluders", []):
        if occ.get("kind") == "building" and occ.get("shape") == "prism":
            if Polygon(occ["footprint"]).intersection(base).area > 0.01:
                errs.append(f"collides with {occ.get('id', 'a building')}")
    return errs


def evaluate(scene: dict, proposal: dict, budget_gbp: float | None = None) -> dict:
    """Score a single proposal against the scene's current state. The accept/reject verdict.
    Material opacity and cost come from the catalogue, never from the proposer."""
    proposal = apply_material(proposal)
    before = score(scene)
    trial = copy.deepcopy(scene)
    trial["proposals"] = [proposal]
    after = score(trial, include_proposals=True)
    errs = check_constraints(scene, proposal)
    gain = after["score"] - before["score"]
    reasons = list(errs)
    if gain < MIN_GAIN:
        reasons.append(f"shade gain {gain * 100:+.0f} pts is below the +{MIN_GAIN * 100:.0f} pt bar")
    if budget_gbp is not None and proposal["cost_gbp"] > budget_gbp:
        reasons.append(f"indicative cost £{proposal['cost_gbp']:,.0f} is over the £{budget_gbp:,.0f} budget")
    lo, hi = PEAK_HEAT_HOURS
    peak = [r for r in after["by_time"] if r["shade"] is not None and lo * 60 <= int(r["t"][:2]) * 60 + int(r["t"][3:]) <= hi * 60]
    pw = min(peak, key=lambda r: r["shade"]) if peak else None
    if pw and pw["shade"] < MIN_WORST_TIME_SHADE:
        reasons.append(f"at {pw['t']} (sun az {pw['sun_az']:.0f} deg, el {pw['sun_el']:.0f} deg) "
                       f"only {pw['shade'] * 100:.0f}% of the waiting area is shaded")

    return {
        "accepted": not reasons,
        "reasons": reasons,
        "proposal": proposal,
        "cost_gbp": proposal["cost_gbp"],
        "value": shade_value(gain, proposal["cost_gbp"], proposal["life_years"]),
        "score_before": before["score"],
        "score_after": after["score"],
        "worst_time": after["worst_time"],
        "worst_time_shade": after["worst_time_shade"],
        "worst_time_sun": after["worst_time_sun"],
    }


def search_best_canopy(scene: dict, sizes=((6, 2.5), (5, 3), (7, 2), (4, 4)), heights=(2.6, 3.2), step: float = 1.0) -> dict | None:
    """Exhaustive search over simple canopies inside the buildable area: the upper bound Argon is compared to."""
    zone = Polygon(scene.get("buildable_area") or Polygon(scene["waiting_area"]).buffer(3).exterior.coords)
    minx, miny, maxx, maxy = zone.bounds
    best = None
    coarse = dict(grid_step=1.0, minutes_step=60)
    for w, d in sizes:
        for rot in (0, 90):
            for z0 in heights:
                for cx in np.arange(minx, maxx + 1e-9, step):
                    for cy in np.arange(miny, maxy + 1e-9, step):
                        prop = {"id": "search", "kind": "canopy", "shape": "box", "center": [float(cx), float(cy)],
                                "size": [w, d], "rotation_deg": rot, "z0": z0, "z1": z0 + 0.1, "opacity": 1.0,
                                "source": "search"}
                        if check_constraints(scene, prop):
                            continue
                        trial = dict(scene, proposals=[prop])
                        s = score(trial, include_proposals=True, **coarse)["score"]
                        if best is None or s > best[0]:
                            best = (s, prop)
    if best is None:
        return None
    full = score(dict(scene, proposals=[best[1]]), include_proposals=True)
    return {"proposal": best[1], "score": full["score"]}


def shade_at(scene: dict, points_xy: list[list[float]], dt_utc, include_proposals: bool = False,
             z: float = 0.02) -> list[float]:
    """Shade fraction at specific named points at a specific moment (used by the photo check).
    Default z is just above the ground, because a photo shows shadows on the pavement."""
    occluders = list(scene.get("occluders", [])) + (scene.get("proposals", []) if include_proposals else [])
    az, el = sun_position(scene["lat"], scene["lon"], dt_utc)
    if el <= 0:
        return [1.0 for _ in points_xy]
    pts = np.array([[x, y, z] for x, y in points_xy], dtype=float)
    return [float(v) for v in 1.0 - transmission(pts, np.array(sun_vector(az, el)), occluders)]


def heatgrid(scene: dict, include_proposals: bool = False, radius: float = 60.0, step: float = 2.0,
             minutes_step: int = 30) -> dict:
    """Ground-level direct-sun map around the stop: a real ray-cast shadow/heat field for every timestep.
    frames[t][j*nx+i] = % of direct sun reaching that ground cell (0..100), or -1 inside a building footprint."""
    occluders = list(scene.get("occluders", [])) + (scene.get("proposals", []) if include_proposals else [])
    xs = np.arange(-radius + step / 2, radius, step)
    ys = np.arange(-radius + step / 2, radius, step)
    gx, gy = np.meshgrid(xs, ys)  # row j = y, col i = x
    gx, gy = gx.ravel(), gy.ravel()
    pts = np.column_stack([gx, gy, np.full(gx.size, 0.05)])
    inside = np.zeros(gx.size, dtype=bool)
    for occ in scene.get("occluders", []):
        if occ.get("kind") == "building" and occ.get("shape") == "prism":
            inside |= shapely.contains_xy(Polygon(occ["footprint"]), gx, gy)
    wa = shapely.contains_xy(Polygon(scene["waiting_area"]), gx, gy)
    frames, tlabels, suns, wa_sun = [], [], [], []
    acc = np.zeros(gx.size)
    n = 0
    for hh, mm in times(scene, minutes_step):
        dt = local_to_utc(scene["date"], hh, mm, scene.get("utc_offset", 0))
        az, el = sun_position(scene["lat"], scene["lon"], dt)
        tlabels.append(f"{hh:02d}:{mm:02d}")
        suns.append({"az": round(az, 1), "el": round(el, 1)})
        if el <= 0:
            sun = np.zeros(gx.size)
        else:
            sun = transmission(pts, np.array(sun_vector(az, el)), occluders)
            acc += sun
            n += 1
        frame = np.where(inside, -1, np.round(sun * 100)).astype(int)
        frames.append(frame.tolist())
        wa_sun.append(round(float(sun[wa].mean() * 100), 1) if wa.any() else None)
    daily = np.where(inside, -1, np.round(acc / max(n, 1) * 100)).astype(int)
    return {"origin": {"lat": scene["lat"], "lon": scene["lon"]}, "step": step, "nx": len(xs), "ny": len(ys),
            "xs": [round(float(v), 2) for v in xs], "ys": [round(float(v), 2) for v in ys],
            "times": tlabels, "sun": suns, "frames": frames, "daily": daily.tolist(),
            "waiting_area": scene["waiting_area"], "waiting_area_sun_pct": wa_sun,
            "cells": int(gx.size), "occluders": len(occluders),
            "buildings": sum(1 for o in occluders if o.get("kind") == "building"),
            "trees": sum(1 for o in occluders if o.get("kind") == "tree")}
