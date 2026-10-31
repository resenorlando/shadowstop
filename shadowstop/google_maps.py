"""Optional Google Maps context. Credentials stay on the server, never in assets."""
from __future__ import annotations

import os
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit

import requests
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response

router = APIRouter(prefix="/api/google", tags=["Google Maps"])
TILES_ROOT = "https://tile.googleapis.com/v1/3dtiles/"


def maps_key() -> str:
    # Deliberately do not reuse the unrelated Gemini credential.
    return os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()


def require_key() -> str:
    key = maps_key()
    if not key:
        raise HTTPException(503, "Set GOOGLE_MAPS_API_KEY with Solar API and Map Tiles API enabled, then restart the server.")
    return key


def google_get(url: str, params: dict):
    key = require_key()
    try:
        response = requests.get(url, params={**params, "key": key}, timeout=20)
    except requests.RequestException:
        # requests exceptions contain the URL, including its credential.
        raise HTTPException(502, "Google Maps could not be reached. Try again shortly.") from None
    if not response.ok:
        status = response.status_code if response.status_code in (400, 403, 404, 429) else 502
        messages = {
            403: "Google denied this request. Check that the API is enabled, billing is active, and the key permits server requests.",
            404: "Google has no matching coverage at this location.",
            429: "Google Maps quota reached. Try again later.",
        }
        raise HTTPException(status, messages.get(status, "Google Maps could not complete the request."))
    return response


@router.get("/status")
def status():
    return {"configured": bool(maps_key()), "solar": "building context only", "tileset_url": "/api/google/tiles/root.json"}


@router.get("/solar")
def solar(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)):
    response = google_get("https://solar.googleapis.com/v1/buildingInsights:findClosest", {
        "location.latitude": lat, "location.longitude": lon, "requiredQuality": "BASE",
    })
    data = response.json()
    potential = data.get("solarPotential", {})
    return {
        "source": "Google Solar API", "scope": "Nearest building roof; not waiting-area shade",
        "center": data.get("center"), "bounding_box": data.get("boundingBox"),
        "imagery_date": data.get("imageryDate"), "imagery_quality": data.get("imageryQuality"),
        "max_sunshine_hours_per_year": potential.get("maxSunshineHoursPerYear"),
        "roof_area_m2": potential.get("wholeRoofStats", {}).get("areaMeters2"),
        "roof_segments": len(potential.get("roofSegmentStats", [])),
    }


def rewrite_tile_uris(value, base_url: str):
    """Keep all tile requests on the fixed Google host and strip keys from JSON."""
    if isinstance(value, list):
        return [rewrite_tile_uris(item, base_url) for item in value]
    if not isinstance(value, dict):
        return value
    output = {}
    for name, item in value.items():
        if name in ("uri", "url") and isinstance(item, str) and not item.startswith("data:"):
            target = urlsplit(urljoin(base_url, item))
            if target.hostname != "tile.googleapis.com" or not target.path.startswith("/v1/3dtiles/"):
                raise HTTPException(502, "Unexpected Google tile resource.")
            query = urlencode([(k, v) for k, v in parse_qsl(target.query) if k != "key"])
            output[name] = "/api/google/tiles/" + target.path.removeprefix("/v1/3dtiles/") + ("?" + query if query else "")
        else:
            output[name] = rewrite_tile_uris(item, base_url)
    return output


@router.get("/tiles/{tile_path:path}")
def tiles(tile_path: str, request: Request):
    if not tile_path or ".." in tile_path or "\\" in tile_path or ":" in tile_path or tile_path.startswith("/"):
        raise HTTPException(400, "Invalid tile path")
    # A fixed origin and a narrow query allowlist prevent arbitrary proxy requests.
    params = {k: v for k, v in request.query_params.items() if k in ("session",)}
    response = google_get(TILES_ROOT + tile_path, params)
    media_type = response.headers.get("Content-Type", "application/octet-stream").split(";")[0]
    if "json" in media_type or tile_path.endswith(".json"):
        return JSONResponse(rewrite_tile_uris(response.json(), response.url), headers={"Cache-Control": "no-store"})
    return Response(response.content, media_type=media_type, headers={"Cache-Control": "no-store"})
