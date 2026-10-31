"""Ray casting from sample points towards the sun, against scene occluders.

Every occluder except spheres is treated as a vertical prism (a polygon footprint
extruded from z0 to z1). A ray from point p towards the sun d (d_z > 0) is inside the
prism's height band only for t in [t_lo, t_hi]; over that band its plan-view path is a
2D segment. The ray hits the prism exactly when that segment touches the footprint:
it crosses an edge, or starts inside. All tests are vectorised over the sample points.
"""
from __future__ import annotations

import math

import numpy as np
import shapely
from shapely.geometry import Polygon


def footprint(occ: dict) -> list[list[float]]:
    """Plan-view polygon for any non-sphere occluder."""
    shape = occ.get("shape", "box")
    if shape == "prism":
        return occ["footprint"]
    cx, cy = occ["center"]
    if shape == "box":
        w, d = occ["size"]
        a = math.radians(occ.get("rotation_deg", 0.0))
        ca, sa = math.cos(a), math.sin(a)
        pts = []
        for dx, dy in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
            pts.append([cx + dx * ca - dy * sa, cy + dx * sa + dy * ca])
        return pts
    if shape == "cylinder":
        r = occ["radius"]
        return [[cx + r * math.cos(2 * math.pi * k / 16), cy + r * math.sin(2 * math.pi * k / 16)] for k in range(16)]
    raise ValueError(f"no footprint for shape {shape}")


def _cross(ax, ay, bx, by):
    return ax * by - ay * bx


def hits_prism(p: np.ndarray, d: np.ndarray, poly: list[list[float]], z0: float, z1: float) -> np.ndarray:
    """p: (N,3) points, d: (3,) unit vector to sun with d[2] > 0. Returns (N,) bool."""
    t_lo = np.maximum((z0 - p[:, 2]) / d[2], 0.0)
    t_hi = (z1 - p[:, 2]) / d[2]
    valid = t_hi > t_lo
    ax = p[:, 0] + t_lo * d[0]
    ay = p[:, 1] + t_lo * d[1]
    bx = p[:, 0] + t_hi * d[0]
    by = p[:, 1] + t_hi * d[1]

    hit = shapely.contains_xy(Polygon(poly), ax, ay)  # segment starts inside the footprint
    pts = np.asarray(poly, dtype=float)
    nxt = np.roll(pts, -1, axis=0)
    for (cx, cy), (ex, ey) in zip(pts, nxt):
        o1 = _cross(ex - cx, ey - cy, ax - cx, ay - cy)
        o2 = _cross(ex - cx, ey - cy, bx - cx, by - cy)
        o3 = _cross(bx - ax, by - ay, cx - ax, cy - ay)
        o4 = _cross(bx - ax, by - ay, ex - ax, ey - ay)
        hit |= (o1 * o2 <= 0) & (o3 * o4 <= 0)
    return hit & valid


def hits_ellipsoid(p: np.ndarray, d: np.ndarray, occ: dict) -> np.ndarray:
    """Tree crown: horizontal radius `radius`, vertical semi-axis (z1-z0)/2, centred between z0 and z1."""
    cx, cy = occ["center"]
    r = occ["radius"]
    z0, z1 = occ["z0"], occ["z1"]
    cz = (z0 + z1) / 2
    rz = max((z1 - z0) / 2, 1e-6)
    s = r / rz  # stretch z so the ellipsoid becomes a sphere of radius r
    q = p - np.array([cx, cy, cz])
    q[:, 2] *= s
    dv = np.array([d[0], d[1], d[2] * s])
    a = dv @ dv
    b = 2 * (q @ dv)
    c = np.einsum("ij,ij->i", q, q) - r * r
    disc = b * b - 4 * a * c
    ok = disc >= 0
    sq = np.sqrt(np.where(ok, disc, 0))
    t2 = (-b + sq) / (2 * a)
    return ok & (t2 >= 0)


def hits(p: np.ndarray, d: np.ndarray, occ: dict) -> np.ndarray:
    if occ.get("shape") == "sphere":
        return hits_ellipsoid(p, d, occ)
    return hits_prism(p, d, footprint(occ), occ.get("z0", 0.0), occ["z1"])


def transmission(p: np.ndarray, d: np.ndarray, occluders: list[dict]) -> np.ndarray:
    """Fraction of direct sun reaching each point (1 = full sun, 0 = full shade)."""
    t = np.ones(len(p))
    for occ in occluders:
        h = hits(p, d, occ)
        t = np.where(h, t * (1.0 - float(occ.get("opacity", 1.0))), t)
    return t
