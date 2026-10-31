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


def propose_fix(scene: dict, baseline: dict, history: list[dict]) -> dict:
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
                 "rotation_deg, z0, z1, opacity}, rationale: one or two sentences}. "
                 "If earlier attempts were rejected, fix exactly what the verifier objected to."),
        "scene": {k: v for k, v in scene.items() if k != "proposals"},
        "current_shade_score": baseline.get("score"),
        "worst_time_and_sun": worst,
        "shade_by_time": [r for r in baseline.get("by_time", []) if r.get("shade") is not None][::2],
        "previous_attempts_and_verifier_verdicts": history,
    }
    out = None
    if API == "interactions":
        try:
            prev = history[-1].get("interaction_id") if history else None
            kwargs = dict(model=MODEL, input=system + "\n\n" + json.dumps(prompt),
                          generation_config={"thinking_level": "medium"})
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
        what = (f"a solid, opaque bus-stop canopy roughly {w:.1f} m long and {d:.1f} m deep, "
                f"its underside about {proposal.get('z0', 2.6):.1f} m above the pavement")
    prompt = (f"Edit this photo of a real bus stop. Add {what}, placed as described: "
              f"{proposal.get('note') or 'over the area where people wait'}. "
              "Use a simple, realistic street-furniture style (dark steel posts, matte panel roof). "
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
