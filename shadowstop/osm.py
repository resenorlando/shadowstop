"""Real places from OpenStreetMap (free, no key): bus stops, buildings with heights, trees, roads.

Overpass responses are cached under scenes/cache so a rehearsed demo also works offline.
"""
from __future__ import annotations

import hashlib
import json
import math
import pathlib

import requests
from shapely.geometry import Polygon

from . import engine

CACHE = pathlib.Path(__file__).resolve().parents[1] / "scenes" / "cache"
MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
UA = {"User-Agent": "ShadowStop-hackathon/0.1"}
LEVEL_HEIGHT_M = 3.0
DEFAULT_BUILDING_M = 9.0


def overpass(query: str) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / (hashlib.sha1(query.encode()).hexdigest()[:16] + ".json")
    if key.exists():
        return json.loads(key.read_text(encoding="utf-8"))
    last = None
    for url in MIRRORS:
        try:
            r = requests.post(url, data={"data": query}, headers=UA, timeout=12)
            r.raise_for_status()
            data = r.json()
            key.write_text(json.dumps(data), encoding="utf-8")
            return data
        except Exception as e:  # try the next mirror
            last = e
    raise RuntimeError(f"All Overpass mirrors failed: {last}")


def to_local(lat0: float, lon0: float, lat: float, lon: float) -> list[float]:
    x = (lon - lon0) * math.cos(math.radians(lat0)) * 111320.0
    y = (lat - lat0) * 110540.0
    return [round(x, 2), round(y, 2)]


def _height(tags: dict) -> tuple[float, str]:
    h = tags.get("height") or tags.get("building:height")
    if h:
        try:
            return float(str(h).split()[0].replace("m", "")), "OSM height tag"
        except ValueError:
            pass
    lv = tags.get("building:levels")
    if lv:
        try:
            return float(lv) * LEVEL_HEIGHT_M + 1.0, f"OSM {lv} levels x {LEVEL_HEIGHT_M:.0f} m"
        except ValueError:
            pass
    return DEFAULT_BUILDING_M, "no height in OSM: default 9 m (low confidence)"


def osm_api_bbox(south: float, west: float, north: float, east: float) -> dict:
    """Fallback when Overpass is down: the main OSM API returns raw map data for a small box.
    Converted to Overpass's 'out geom' shape so the rest of the code doesn't care."""
    import xml.etree.ElementTree as ET
    CACHE.mkdir(parents=True, exist_ok=True)
    bbox = f"{west:.6f},{south:.6f},{east:.6f},{north:.6f}"
    key = CACHE / ("api-" + hashlib.sha1(bbox.encode()).hexdigest()[:16] + ".json")
    if key.exists():
        return json.loads(key.read_text(encoding="utf-8"))
    r = requests.get(f"https://api.openstreetmap.org/api/0.6/map?bbox={bbox}", headers=UA, timeout=40)
    r.raise_for_status()
    root = ET.fromstring(r.content)
    nodes, els = {}, []
    for n in root.iter("node"):
        lat, lon = float(n.get("lat")), float(n.get("lon"))
        nodes[n.get("id")] = (lat, lon)
        tags = {t.get("k"): t.get("v") for t in n.findall("tag")}
        if tags:
            els.append({"type": "node", "id": int(n.get("id")), "lat": lat, "lon": lon, "tags": tags})
    for w in root.iter("way"):
        tags = {t.get("k"): t.get("v") for t in w.findall("tag")}
        if not ("building" in tags or "highway" in tags):
            continue
        geom = [{"lat": nodes[nd.get("ref")][0], "lon": nodes[nd.get("ref")][1]}
                for nd in w.findall("nd") if nd.get("ref") in nodes]
        els.append({"type": "way", "id": int(w.get("id")), "tags": tags, "geometry": geom})
    data = {"elements": els}
    key.write_text(json.dumps(data), encoding="utf-8")
    return data


def _box(lat: float, lon: float, radius_m: float):
    dlat = radius_m / 110540.0
    dlon = radius_m / (111320.0 * math.cos(math.radians(lat)))
    return lat - dlat, lon - dlon, lat + dlat, lon + dlon


def stops_in_bbox(south: float, west: float, north: float, east: float) -> list[dict]:
    q = f'[out:json][timeout:40];node["highway"="bus_stop"]({south},{west},{north},{east});out;'
    try:
        elements = overpass(q).get("elements", [])
    except RuntimeError:
        elements = [e for e in osm_api_bbox(south, west, north, east)["elements"]
                    if e["type"] == "node" and e.get("tags", {}).get("highway") == "bus_stop"]
    out = []
    for el in elements:
        t = el.get("tags", {})
        out.append({"id": f"osm-{el['id']}", "osm_id": el["id"], "lat": el["lat"], "lon": el["lon"],
                    "name": t.get("name") or t.get("local_ref") or f"Stop {el['id']}",
                    "shelter": t.get("shelter"), "bench": t.get("bench")})
    return out


def surroundings(lat: float, lon: float, radius: int = 70) -> dict:
    q = (f'[out:json][timeout:40];('
         f'way["building"](around:{radius},{lat},{lon});'
         f'node["natural"="tree"](around:{radius},{lat},{lon});'
         f'way["highway"](around:30,{lat},{lon});'
         f'node["highway"="bus_stop"](around:15,{lat},{lon});'
         f');out geom;')
    try:
        return overpass(q)
    except RuntimeError:
        return osm_api_bbox(*_box(lat, lon, radius))


def _road_bearing(elements: list[dict], lat: float, lon: float) -> float:
    """Direction (deg, CCW from east) of the nearest road segment, so the waiting area lines up with the kerb."""
    best = (1e9, 0.0)
    for el in elements:
        if el.get("type") != "way" or "highway" not in el.get("tags", {}) or "building" in el.get("tags", {}):
            continue
        if el["tags"]["highway"] in ("footway", "steps", "path", "cycleway", "service", "bus_stop", "platform"):
            continue
        g = el.get("geometry", [])
        for a, b in zip(g, g[1:]):
            pa, pb = to_local(lat, lon, a["lat"], a["lon"]), to_local(lat, lon, b["lat"], b["lon"])
            mx, my = (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2
            dist = math.hypot(mx, my)
            if dist < best[0]:
                best = (dist, math.degrees(math.atan2(pb[1] - pa[1], pb[0] - pa[0])))
    return best[1]


def _rect(cx: float, cy: float, w: float, d: float, ang_deg: float) -> list[list[float]]:
    a = math.radians(ang_deg)
    ca, sa = math.cos(a), math.sin(a)
    return [[round(cx + dx * ca - dy * sa, 2), round(cy + dx * sa + dy * ca, 2)]
            for dx, dy in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]


def _near(el: dict, lat: float, lon: float, radius: float) -> bool:
    if el.get("type") == "node":
        pts = [(el["lat"], el["lon"])]
    else:
        pts = [(g["lat"], g["lon"]) for g in el.get("geometry", [])]
    return any(math.hypot(*to_local(lat, lon, a, b)) <= radius for a, b in pts)


def scene_from_osm(lat: float, lon: float, stop_id: str | None = None, name: str | None = None,
                   date: str = "2026-07-19", hours=(9, 18), utc_offset: float = 1,
                   elements: list[dict] | None = None, shelter_tag: str | None = None) -> dict:
    if elements is None:
        els = surroundings(lat, lon).get("elements", [])
    else:  # scan mode: one big download, sliced per stop
        els = [e for e in elements if _near(e, lat, lon, 70)]
    shelter_hint = shelter_tag
    bearing = _road_bearing(els, lat, lon)
    occluders = []
    shelter = shelter_hint
    for el in els:
        tags = el.get("tags", {})
        if el.get("type") == "way" and "building" in tags and el.get("geometry"):
            pts = [to_local(lat, lon, g["lat"], g["lon"]) for g in el["geometry"]]
            if len(pts) >= 4 and pts[0] == pts[-1]:
                pts = pts[:-1]
            if len(pts) < 3 or not Polygon(pts).is_valid:
                continue
            h, note = _height(tags)
            occluders.append({"id": f"b{el['id']}", "kind": "building", "shape": "prism", "footprint": pts,
                              "z0": 0, "z1": round(h, 1), "opacity": 1.0, "source": "osm",
                              "confidence": 0.9 if "default" not in note else 0.4, "note": note})
        elif el.get("type") == "node" and tags.get("natural") == "tree":
            h = float(str(tags.get("height", "8")).split()[0]) if str(tags.get("height", "8")).split()[0].replace(".", "").isdigit() else 8.0
            occluders.append({"id": f"t{el['id']}", "kind": "tree", "shape": "sphere",
                              "center": to_local(lat, lon, el["lat"], el["lon"]),
                              "radius": round(max(1.5, h * 0.3), 1), "z0": round(h * 0.4, 1), "z1": round(h, 1),
                              "opacity": 0.7, "source": "osm", "confidence": 0.6,
                              "note": "OSM tree; crown size estimated from height"})
        elif el.get("type") == "node" and tags.get("highway") == "bus_stop" and elements is None:
            if shelter is None or (stop_id and stop_id.endswith(str(el["id"]))):
                shelter = tags.get("shelter")
                name = name or tags.get("name")

    waiting = _rect(0, 0, 6, 2.2, bearing)
    buildable = _rect(0, 0, 12, 5, bearing)
    if shelter == "yes":
        occluders.append({"id": "shelter-roof", "kind": "shelter_roof", "shape": "box", "center": [0, 0],
                          "size": [4, 1.4], "rotation_deg": round(bearing, 1), "z0": 2.4, "z1": 2.5,
                          "opacity": 0.5, "source": "osm", "confidence": 0.3,
                          "note": "OSM says shelter=yes; roof material unknown (Argon should check a photo)"})
    return {
        "id": stop_id or f"osm-{lat:.5f},{lon:.5f}", "name": name or "Bus stop",
        "lat": lat, "lon": lon, "date": date, "hours": list(hours), "utc_offset": utc_offset,
        "road_bearing_deg": round(bearing, 1), "osm_shelter": shelter,
        "waiting_area": waiting, "buildable_area": buildable,
        "occluders": occluders, "proposals": [],
    }


def scan(south: float, west: float, north: float, east: float, limit: int = 40) -> list[dict]:
    """Patio-style sweep: every stop in the box gets a fast baseline shade score; worst first."""
    stops = stops_in_bbox(south, west, north, east)[:limit]
    m = 70 / 110540.0
    try:
        q = (f'[out:json][timeout:40];(way["building"]({south - m},{west - m * 1.6},{north + m},{east + m * 1.6});'
             f'node["natural"="tree"]({south - m},{west - m * 1.6},{north + m},{east + m * 1.6});'
             f'way["highway"]({south},{west},{north},{east}););out geom;')
        everything = overpass(q)["elements"]
    except RuntimeError:
        everything = osm_api_bbox(south - m, west - m * 1.6, north + m, east + m * 1.6)["elements"]
    out = []
    for s in stops:
        try:
            sc = scene_from_osm(s["lat"], s["lon"], s["id"], s["name"], elements=everything, shelter_tag=s.get("shelter"))
            val = engine.score(sc, grid_step=1.0, minutes_step=60)["score"]
        except Exception as e:  # keep scanning if one stop fails
            val, sc = None, None
            s["error"] = str(e)[:120]
        s["score"] = val
        out.append(s)
    out.sort(key=lambda r: (r["score"] is None, r["score"] if r["score"] is not None else 1))
    return out
