"""ShadowStop API + static web app.  Run:  python -m uvicorn shadowstop.server:app --port 8000"""
from __future__ import annotations

import io
import json
import pathlib
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from shapely.geometry import Polygon

from . import argon, engine, osm
try:  # optional Google Maps routes; the app must start without them
    from .google_maps import router as google_maps_router
except ImportError:
    google_maps_router = None
from .sun import local_to_utc, sun_position, sun_vector

ROOT = pathlib.Path(__file__).resolve().parents[1]
app = FastAPI(title="ShadowStop")
if google_maps_router is not None:
    app.include_router(google_maps_router)
MAX_ARGON_ATTEMPTS = 3


@app.get("/api/health")
def health():
    import os
    return {"ok": True, "model": argon.MODEL, "gemini_key": bool(os.environ.get("GEMINI_API_KEY"))}


@app.get("/api/sun")
def sun(lat: float, lon: float, date: str, time: str = "12:00", utc_offset: float = 0):
    hh, mm = (int(p) for p in time.split(":"))
    az, el = sun_position(lat, lon, local_to_utc(date, hh, mm, utc_offset))
    return {"azimuth": round(az, 3), "elevation": round(el, 3), "dir": [round(v, 5) for v in sun_vector(az, el)]}


class ScoreReq(BaseModel):
    scene: dict
    include_proposals: bool = False


@app.post("/api/score")
def score(req: ScoreReq):
    return engine.score(req.scene, include_proposals=req.include_proposals)


class HeatReq(BaseModel):
    scene: dict
    include_proposals: bool = False
    radius: float = 60.0
    step: float = 2.0
    minutes_step: int = 30


@app.post("/api/heatgrid")
def heatgrid(req: HeatReq):
    return engine.heatgrid(req.scene, req.include_proposals, min(req.radius, 100.0), max(req.step, 1.0), req.minutes_step)


@app.get("/api/satellite-eye")
def satellite_eye(lat: float, lon: float, name: str = "bus stop"):
    """Argon reads the real aerial image around the stop and returns labelled detections (pixel boxes + georef)."""
    try:
        return argon.satellite_eye(lat, lon, name)
    except Exception as e:
        raise HTTPException(502, f"Argon satellite analysis failed: {e}")


@app.get("/api/scene/demo")
def scene_demo():
    return json.loads((ROOT / "scenes" / "demo.json").read_text(encoding="utf-8"))


@app.get("/api/scene/from_osm")
def scene_from_osm(lat: float, lon: float, id: str | None = None, name: str | None = None):
    try:
        return osm.scene_from_osm(lat, lon, id, name)
    except Exception as e:
        raise HTTPException(502, f"OpenStreetMap lookup failed: {e}")


@app.get("/api/scan")
def scan(south: float, west: float, north: float, east: float, limit: int = 40):
    try:
        return {"stops": osm.scan(south, west, north, east, limit)}
    except Exception as e:
        raise HTTPException(502, f"Scan failed: {e}")


@app.get("/api/geocode")
def geocode(q: str):
    try:
        return osm.geocode_london(q)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"Geocode failed: {e}")


class ProposeReq(BaseModel):
    scene: dict
    use_argon: bool = True
    budget_gbp: float | None = None


def _obvious_fix(scene: dict) -> dict:
    """The fix a person would try first: make the existing shelter roof solid (or cover the waiting area).
    Shown honestly as a baseline so the audience sees why 'obvious' isn't enough."""
    roof = next((o for o in scene.get("occluders", []) if o.get("kind") == "shelter_roof"), None)
    if roof:
        p = {k: roof[k] for k in roof if k not in ("source", "note", "confidence")}
        p.update({"id": "obvious-fix", "kind": "canopy", "material": "opaque_metal_roof"})
        note = "Obvious fix: swap the clear roof for a solid one, same size and position."
    else:
        poly = Polygon(scene["waiting_area"])
        c = poly.centroid
        minx, miny, maxx, maxy = poly.bounds
        p = {"id": "obvious-fix", "kind": "canopy", "shape": "box", "center": [c.x, c.y],
             "size": [min(maxx - minx, 4), min(maxy - miny, 1.4)], "rotation_deg": 0, "z0": 2.4, "z1": 2.5,
             "material": "opaque_metal_roof"}
        note = "Obvious fix: a standard 4 x 1.4 m solid roof over the stop."
    p.update({"source": "proposal", "note": note})
    return p


def _attempt(scene: dict, prop: dict, who: str, budget: float | None = None) -> dict:
    v = engine.evaluate(scene, prop, budget)
    prop = dict(v["proposal"], _interaction_id=prop.get("_interaction_id"))
    return {"by": who, "proposal": prop, "accepted": v["accepted"],
            "cost_gbp": v["cost_gbp"], "material": prop.get("material"), "value": v["value"],
            "reason": "; ".join(v["reasons"]) or "passes every check",
            "score_before": v["score_before"], "score_after": v["score_after"],
            "worst_time": v["worst_time"], "worst_time_shade": v["worst_time_shade"],
            "worst_time_sun": v["worst_time_sun"]}


@app.post("/api/propose")
def propose(req: ProposeReq):
    scene = dict(req.scene, proposals=[])
    baseline = engine.score(scene)
    budget = req.budget_gbp
    attempts = [_attempt(scene, _obvious_fix(scene), "baseline", budget)]
    argon_error = None
    ref = engine.search_best_canopy(scene)  # the verifier's own brute-force optimiser (a tool Argon can consult)
    if req.use_argon:
        history = [{"proposal": attempts[0]["proposal"], "verdict": attempts[0]["reason"],
                    "shade_after": attempts[0]["score_after"]}]
        for k in range(MAX_ARGON_ATTEMPTS + 1):
            hint = None
            if k >= 2 and ref:  # after two rejections, hand Argon the optimiser's geometry as a tool result
                hint = {"tool": "verifier.search_best_canopy",
                        "best_geometry": {kk: ref["proposal"][kk] for kk in ("center", "size", "rotation_deg", "z0", "z1")},
                        "shade_score_with_opaque_material": ref["score"],
                        "note": "Brute-force optimum over simple canopies. Adapt it: choose material and size for the budget."}
            try:
                prop = argon.propose_fix(scene, baseline, history, budget, hint=hint, deep=k >= 2)
                att = _attempt(scene, prop, "argon", budget)
            except Exception as e:
                argon_error = f"{type(e).__name__}: {str(e)[:200]}"
                break
            attempts.append(att)
            history.append({"proposal": {k: v for k, v in prop.items() if k != "_interaction_id"},
                            "verdict": att["reason"], "shade_after": att["score_after"],
                            "interaction_id": prop.get("_interaction_id")})
            if att["accepted"]:
                break
    accepted = [a for a in attempts if a["accepted"]]
    chosen = accepted[-1] if accepted else None
    if chosen is None and ref:  # nothing passed: show the search result, clearly labelled
        chosen = _attempt(scene, dict(ref["proposal"], note="Exhaustive search result (Argon did not pass)"), "search", budget)
        attempts.append(chosen)
    final_scene = dict(scene, proposals=[chosen["proposal"]] if chosen else [])
    return {"baseline": {"score": baseline["score"], "worst_time": baseline["worst_time"]},
            "budget_gbp": budget, "materials": __import__("shadowstop.materials", fromlist=["CATALOGUE"]).CATALOGUE,
            "attempts": attempts, "final_scene": final_scene,
            "reference_search": ref, "argon_error": argon_error}


@app.post("/api/read-scene")
async def read_scene(scene: str = Form(...), photos: list[UploadFile] = File(...)):
    sc = json.loads(scene)
    imgs = [(await f.read(), f.content_type) for f in photos]
    try:
        upd = argon.read_scene(sc, imgs)
    except Exception as e:
        raise HTTPException(502, f"Argon failed: {e}")
    new = argon.apply_updates(sc, upd)
    return {"scene": new, "argon": upd,
            "score_before": engine.score(sc)["score"], "score_after": engine.score(new)["score"]}


def _exif_time(data: bytes) -> datetime | None:
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(data))
        exif = img.getexif()
        raw = exif.get_ifd(0x8769).get(36867) or exif.get(306)
        return datetime.strptime(str(raw), "%Y:%m:%d %H:%M:%S") if raw else None
    except Exception:
        return None


def _named_points(scene: dict) -> list[dict]:
    poly = Polygon(scene["waiting_area"]).buffer(-0.3)
    if poly.is_empty:
        poly = Polygon(scene["waiting_area"])
    c = poly.centroid
    pts = [{"label": "middle of the waiting area", "xy": [round(c.x, 2), round(c.y, 2)]}]
    coords = list(poly.exterior.coords)[:-1]
    names = ["corner A (first corner of the waiting area)", "corner B", "corner C", "corner D"]
    for n, (x, y) in zip(names, coords[:4]):
        pts.append({"label": n, "xy": [round(x, 2), round(y, 2)]})
    roof = next((o for o in scene.get("occluders", []) if o.get("kind") == "shelter_roof"), None)
    if roof and roof.get("center"):
        pts.append({"label": "pavement directly under the shelter roof", "xy": roof["center"]})
    return pts


@app.post("/api/photo-check")
async def photo_check(scene: str = Form(...), photo: UploadFile = File(...),
                      time: str | None = Form(None), utc_offset: float | None = Form(None),
                      fallback_time: str | None = Form(None)):
    """Reality check: does the model predict which parts of the stop are sunny in a real, timestamped photo?"""
    sc = json.loads(scene)
    if utc_offset is None:
        utc_offset = float(sc.get("utc_offset", 0))
    data = await photo.read()
    local = _exif_time(data)
    t_str = (time or "").strip() or (fallback_time.strip() if local is None and fallback_time else "")
    if t_str:  # manual override "YYYY-MM-DD HH:MM" or "HH:MM" (scene date)
        sc_date = datetime.strptime(sc.get("date", "2026-07-19"), "%Y-%m-%d").date()
        local = (datetime.strptime(t_str[:16], "%Y-%m-%d %H:%M") if "-" in t_str
                 else datetime.combine(sc_date, datetime.strptime(t_str[:5], "%H:%M").time()))
    if local is None:
        raise HTTPException(400, "Photo has no timestamp: enter the time it was taken")
    dt_utc = (local - timedelta(hours=utc_offset)).replace(tzinfo=timezone.utc)
    az, el = sun_position(sc["lat"], sc["lon"], dt_utc)
    pts = _named_points(sc)
    predicted = engine.shade_at(sc, [p["xy"] for p in pts], dt_utc)
    try:
        seen = argon.read_photo_shade(sc, (data, photo.content_type), [{"label": p["label"]} for p in pts])
    except Exception as e:
        raise HTTPException(502, f"Argon failed: {e}")
    obs = {p.get("label"): p for p in seen.get("points", [])}
    rows, agree, n = [], 0, 0
    for p, s in zip(pts, predicted):
        o = obs.get(p["label"], {})
        observed = o.get("observed", "unknown")
        pred = "shade" if s >= 0.5 else "sun"
        ok = None if observed == "unknown" else observed == pred
        if ok is not None:
            n += 1
            agree += ok
        rows.append({"label": p["label"], "xy": p["xy"], "predicted": pred, "predicted_shade": round(s, 2),
                     "observed": observed, "evidence": o.get("evidence", ""), "agree": ok})
    return {"photo_time": local.strftime("%Y-%m-%d %H:%M"), "utc_offset": utc_offset,
            "sun": {"azimuth": round(az, 1), "elevation": round(el, 1)},
            "overcast": seen.get("overcast"), "points": rows,
            "agreement": round(agree / n, 3) if n else None}


@app.post("/api/render-fix")
async def render_fix(scene: str = Form(...), photo: UploadFile = File(...)):
    sc = json.loads(scene)
    props = sc.get("proposals") or []
    if not props:
        raise HTTPException(400, "No proposal in the scene yet: ask Argon first")
    prop = props[-1]
    verdict = engine.evaluate(dict(sc, proposals=[]), prop)  # re-verify: only render designs that pass
    prop = verdict["proposal"]
    if not verdict["accepted"]:
        raise HTTPException(409, "This design has not passed the verifier: " + "; ".join(verdict["reasons"]))
    import base64
    try:
        img, mime, prompt = argon.render_fix((await photo.read(), photo.content_type), sc, prop)
    except Exception as e:
        raise HTTPException(502, f"Image model failed: {e}")
    return {"image_b64": base64.b64encode(img).decode(), "mime": mime, "prompt": prompt,
            "proposal_id": prop.get("id"), "verified_score": verdict["score_after"]}


@app.get("/api/demo/verified")
def verified_demo():
    """Replay recorded Gemini geometry, with fresh deterministic verification."""
    scene = json.loads((ROOT / "scenes" / "hackney_verified.json").read_text(encoding="utf-8"))
    base = dict(scene, proposals=[])
    verdict = engine.evaluate(base, scene["proposals"][-1], budget_gbp=8000)
    return {"source": "Recorded Gemini proposal, reverified locally", "scene": scene,
            "verdict": verdict, "before": engine.score(base),
            "after": engine.score(scene, include_proposals=True)}


@app.get("/")
def polished_demo():
    return RedirectResponse("/story.html")


app.mount("/scenes", StaticFiles(directory=ROOT / "scenes"), name="scenes")
if (ROOT / "web").exists():
    app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
