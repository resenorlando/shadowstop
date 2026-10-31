"""Everything Gemini 4 Argon does. Argon reads and proposes; engine.py decides.

Requires GEMINI_API_KEY in the environment.
"""
from __future__ import annotations

import json
import os
import re

from google import genai
from google.genai import types

MODEL = os.environ.get("SHADOWSTOP_MODEL", "gemini-4-argon")
IMAGE_MODEL = os.environ.get("SHADOWSTOP_IMAGE_MODEL", "gemini-nano-banana-2.1")
# "interactions" (recommended Interactions API, server-side state across retries) or "generate"
API = os.environ.get("SHADOWSTOP_API", "interactions")
THINKING = os.environ.get("SHADOWSTOP_THINKING", "low")
_client = None


def client():
    global _client
    if _client is None:
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        _client = genai.Client(api_key=key)
    return _client


def _json(text: str):
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1)
    start = min([i for i in (text.find("{"), text.find("[")) if i >= 0], default=0)
    return json.loads(text[start:])


def _ask(parts: list, system: str) -> dict:
    r = client().models.generate_content(
        model=MODEL,
        contents=parts,
        config=types.GenerateContentConfig(system_instruction=system, response_mime_type="application/json"),
    )
    return _json(r.text)


def _image_part(data: bytes, mime: str):
    return types.Part.from_bytes(data=data, mime_type=mime or "image/jpeg")


SCHEMA_HINT = (
    "Coordinates are local metres around the bus stop: origin = the stop, x = east, y = north, z = up. "
    "Occluder shapes: box {center:[x,y], size:[w,d], rotation_deg, z0, z1}, cylinder {center, radius, z0, z1}, "
    "sphere (tree crown) {center, radius, z0, z1}, prism {footprint:[[x,y],...], z0, z1}. "
    "opacity: 1 = solid, ~0.7 = tree foliage, ~0.1 = clear glass/polycarbonate."
)


def read_scene(scene: dict, images: list[tuple[bytes, str]]) -> dict:
    """Argon looks at street photos/video frames of the stop and corrects what the map gets wrong."""
    system = ("You are a street-scene surveyor. You correct a 3D model of a bus stop from photos. "
              "Only report what the photos support; give a confidence for each item. " + SCHEMA_HINT)
    prompt = {
        "task": ("Compare the photos with this map-derived scene. Return JSON with: "
                 "'occluder_updates': list of {id (existing id to modify, or new id), action: 'update'|'add'|'remove', "
                 "fields: {...occluder fields...}, evidence: short string}; "
                 "'waiting_area': polygon where people actually stand or sit (may differ from the pole position), or null; "
                 "'scale_anchors': list of {object, assumed_size_m}; "
                 "'map_errors': list of short strings (e.g. 'OSM says shelter=yes but the roof is clear glass'); "
                 "'notes': string."),
        "scene": scene,
    }
    parts = [_image_part(b, m) for b, m in images] + [json.dumps(prompt)]
    return _ask(parts, system)


def apply_updates(scene: dict, upd: dict) -> dict:
    sc = json.loads(json.dumps(scene))
    by_id = {o["id"]: o for o in sc.get("occluders", [])}
    for u in upd.get("occluder_updates", []) or []:
        oid, act, fields = u.get("id"), u.get("action", "update"), u.get("fields", {}) or {}
        if act == "remove" and oid in by_id:
            sc["occluders"] = [o for o in sc["occluders"] if o["id"] != oid]
        elif act == "update" and oid in by_id:
            by_id[oid].update(fields)
            by_id[oid]["source"] = "argon"
            by_id[oid]["note"] = u.get("evidence", by_id[oid].get("note", ""))
        elif act == "add" or oid not in by_id:
            occ = {"id": oid or f"argon-{len(sc['occluders'])}", **fields, "source": "argon",
                   "note": u.get("evidence", "")}
            if {"shape", "z1"} <= occ.keys():
                sc["occluders"].append(occ)
    if upd.get("waiting_area"):
        sc["waiting_area"] = upd["waiting_area"]
    sc["argon_map_errors"] = upd.get("map_errors", [])
    sc["argon_notes"] = upd.get("notes", "")
    return sc


def propose_fix(scene: dict, baseline: dict, history: list[dict], budget_gbp: float | None = None,
                hint: dict | None = None, deep: bool = False) -> dict:
    """Argon proposes ONE canopy or tree. It sees the verifier's verdicts on earlier attempts."""
    system = ("You design shade for bus stops. Propose one buildable canopy or tree that shades the waiting area "
              "through the whole analysis window, especially the hours the verifier says are worst. "
              "Think about the sun path for the given latitude and date: low morning sun from the east, "
              "high midday sun from the south, low afternoon sun from the west. " + SCHEMA_HINT +
              " Constraints: canopy underside 2.3-4.5 m, area at most 24 m2, inside buildable_area, "
              "not overlapping buildings; tree crown radius at most 4 m.")
    worst = baseline.get("worst_time"), baseline.get("worst_time_sun")
    prompt = {
        "task": ("Return JSON {proposal: {id, kind: 'canopy'|'tree', shape: 'box'|'sphere', center, size or radius, "
                 "rotation_deg, z0, z1, material}, rationale: one or two sentences}. "
                 "material MUST be one key of material_catalogue; opacity and cost are set from it by the verifier. "
                 "Prefer the cheapest design that passes; stay within the budget. "
                 "If earlier attempts were rejected, fix exactly what the verifier objected to."),
        "material_catalogue": __import__("shadowstop.materials", fromlist=["CATALOGUE"]).CATALOGUE,
        "budget_gbp": budget_gbp,
        "scene": {k: v for k, v in scene.items() if k != "proposals"},
        "current_shade_score": baseline.get("score"),
        "worst_time_and_sun": worst,
        "shade_by_time": [r for r in baseline.get("by_time", []) if r.get("shade") is not None][::2],
        "previous_attempts_and_verifier_verdicts": history,
        "optimizer_tool_result": hint,
    }
    out = None
    if API == "interactions":
        try:
            prev = history[-1].get("interaction_id") if history else None
            kwargs = dict(model=MODEL, input=system + "\n\n" + json.dumps(prompt),
                          generation_config={"thinking_level": THINKING})
            if prev:  # keep Argon's own earlier reasoning server-side across verifier rejections
                kwargs["previous_interaction_id"] = prev
            it = client().interactions.create(**kwargs)
            out = _json(it.output_text)
            out["_interaction_id"] = it.id
        except Exception as e:  # fall back to generate_content so the demo never stalls
            out = None
            print(f"[argon] interactions failed, falling back: {type(e).__name__}: {str(e)[:200]}")
    if out is None:
        out = _ask([json.dumps(prompt)], system)
    prop = out.get("proposal", out)
    prop["_interaction_id"] = out.get("_interaction_id")
    prop.setdefault("id", f"argon-{len(history) + 1}")
    prop.setdefault("opacity", 1.0)
    prop.setdefault("rotation_deg", 0)
    prop["source"] = "proposal"
    prop["note"] = out.get("rationale", "")
    if prop.get("kind") == "canopy" and "z1" not in prop and "z0" in prop:
        prop["z1"] = prop["z0"] + 0.1
    return prop


def read_photo_shade(scene: dict, image: tuple[bytes, str], points: list[dict]) -> dict:
    """Argon reports, for each named point, whether it is in direct sun or shadow in the photo."""
    system = ("You inspect a photo of a bus stop and report, for each named location, whether it is in direct "
              "sunlight or in shadow AT THE MOMENT THE PHOTO WAS TAKEN. If you cannot see it, say 'unknown'. "
              "Base this on visible shadows only, not on what you expect.")
    prompt = {
        "task": "Return JSON {points: [{label, observed: 'sun'|'shade'|'unknown', evidence}], overcast: bool}.",
        "named_points": points,
        "scene_summary": {"waiting_area": scene.get("waiting_area"),
                          "occluders": [{k: o.get(k) for k in ("id", "kind", "note")} for o in scene.get("occluders", [])]},
    }
    return _ask([_image_part(*image), json.dumps(prompt)], system)


def render_fix(image: tuple[bytes, str], scene: dict, proposal: dict) -> tuple[bytes, str, str]:
    """Nano Banana 2.1 draws the VERIFIED design into the user's own street photo.
    The picture is an illustration; the shade numbers come only from the verifier."""
    if proposal.get("shape") == "sphere":
        what = (f"a street tree with a dense crown about {2 * proposal.get('radius', 2):.1f} m wide, "
                f"crown from {proposal.get('z0', 3):.1f} m to {proposal.get('z1', 7):.1f} m high")
    else:
        w, d = proposal.get("size", [6, 2.5])
        looks = {
            "shade_fabric": "an off-white tensioned shade-sail fabric canopy on slim steel masts, gently angled",
            "opaque_metal_roof": "a slim reflective light-grey metal roof canopy on dark steel posts",
            "solar_polycarbonate": "a tinted bronze solar-control polycarbonate canopy on slim steel posts",
            "clear_polycarbonate": "a clear polycarbonate canopy on slim steel posts",
        }
        look = looks.get(proposal.get("material"), "a slim bus-stop canopy on steel posts")
        what = (f"{look}, roughly {w:.1f} m long and {d:.1f} m deep, its underside about "
                f"{proposal.get('z0', 2.6):.1f} m above the pavement, over the waiting area by the bus shelter")
    prompt = (f"Edit this photo of a real bus stop. Add {what}, placed as described: "
              f"{proposal.get('note') or 'over the area where people wait'}. "
              "Make it look like real, well-built London street furniture at the correct scale relative to the existing shelter and bench. "
              "Keep everything else in the photo exactly the same: same camera, buildings, people, light. "
              "Do not add text or labels.")
    r = client().models.generate_content(
        model=IMAGE_MODEL,
        contents=[_image_part(*image), prompt],
        config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]),
    )
    for part in r.candidates[0].content.parts:
        if getattr(part, "inline_data", None) and part.inline_data.data:
            return part.inline_data.data, part.inline_data.mime_type or "image/png", prompt
    raise RuntimeError("image model returned no image")


def satellite_tile_image(lat: float, lon: float, z: int = 19, span: int = 2) -> tuple[bytes, dict]:
    """Stitch Esri World Imagery tiles around a point into one JPEG. Returns (jpeg, georef)."""
    import io
    import math as _m
    import requests
    from PIL import Image
    n = 2 ** z
    fx = (lon + 180) / 360 * n
    fy = (1 - _m.log(_m.tan(_m.radians(lat)) + 1 / _m.cos(_m.radians(lat))) / _m.pi) / 2 * n
    cx, cy = int(fx), int(fy)
    size = 256 * (2 * span + 1)
    img = Image.new("RGB", (size, size))
    for dx in range(-span, span + 1):
        for dy in range(-span, span + 1):
            url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{cy + dy}/{cx + dx}"
            r = requests.get(url, timeout=15, headers={"User-Agent": "ShadowStop-hackathon/0.1"})
            img.paste(Image.open(io.BytesIO(r.content)).convert("RGB"), ((dx + span) * 256, (dy + span) * 256))
    def px_to_ll(px, py):
        tx = cx - span + px / 256
        ty = cy - span + py / 256
        lo = tx / n * 360 - 180
        la = _m.degrees(_m.atan(_m.sinh(_m.pi * (1 - 2 * ty / n))))
        return la, lo
    nw, se = px_to_ll(0, 0), px_to_ll(size, size)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    stop_px = [(fx - (cx - span)) * 256, (fy - (cy - span)) * 256]
    return buf.getvalue(), {"size": size, "north": nw[0], "west": nw[1], "south": se[0], "east": se[1], "stop_px": stop_px}


def satellite_eye(lat: float, lon: float, name: str = "bus stop") -> dict:
    """Argon inspects the real aerial image of the stop and marks what matters for heat exposure."""
    jpeg, geo = satellite_tile_image(lat, lon)
    system = ("You are an urban heat-exposure analyst reading a high-resolution aerial photo. "
              "Report only what is visible. Coordinates are pixels in this image (origin top-left).")
    prompt = {
        "task": ("The bus stop is at pixel " + str([round(v) for v in geo["stop_px"]]) + f" ({name}). "
                 "Return JSON {detections: [{label, kind: 'shelter'|'tree_canopy'|'hard_surface'|'building_shadow'|"
                 "'waiting_area'|'road'|'other', box: [x0,y0,x1,y1] in pixels, finding: one short technical sentence about "
                 "heat or shade relevance, confidence: 0..1}], summary: one sentence}. "
                 "Give 5-10 detections focused within ~40 m of the stop."),
        "image_size_px": geo["size"],
    }
    out = _ask([_image_part(jpeg, "image/jpeg"), json.dumps(prompt)], system)
    import base64
    return {"image_b64": base64.b64encode(jpeg).decode(), "georef": geo, **out}
