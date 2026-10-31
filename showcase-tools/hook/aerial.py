"""Aerial view of the Hackney Town Hall stop with a ray-cast shadow / direct-sun exposure overlay.

aerial_frame(t, mode, **kw) -> 1336x840 RGB PIL image (the MAIN panel of the hook film).
Uses web/assets/hackney_aerial.jpg + .json (Esri imagery, georef from argon.satellite_tile_image) when present,
otherwise a pseudo-aerial rendered from the real OSM cache + scene occluders (labelled as a placeholder).
All shade numbers come from shadowstop.engine / geometry (ray casting) and shadowstop.sun (NOAA)."""
from __future__ import annotations

import glob
import pathlib
import json
import math
import os
import sys
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
from shadowstop import engine  # noqa: E402
from shadowstop.geometry import footprint, transmission  # noqa: E402
from shadowstop.sun import local_to_utc, sun_position, sun_vector  # noqa: E402

W, H = 1336, 840
AMBER, CYAN, RED, GREEN = (255, 159, 67), (90, 220, 255), (255, 84, 84), (80, 230, 140)
TEXT, DIM = (225, 228, 232), (110, 116, 124)
FONT_DIR = "/usr/share/fonts/opentype/inter/"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
M_PER_DEG = 111320.0
FIELD_R = 60.0      # shadow field half-size (m); views wider than 2*FIELD_R are clamped
FIELD_STEP = 0.5    # shadow field resolution (m)


@lru_cache(maxsize=None)
def _font(name: str, size: int):
    try:
        return ImageFont.truetype(name if name.startswith("/") else FONT_DIR + name, size)
    except OSError:
        return ImageFont.load_default()


@lru_cache(maxsize=None)
def _scene(after: bool) -> dict:
    s = json.load(open(os.path.join(ROOT, "scenes", "hackney_accepted.json" if after else "hackney_town_hall.json")))
    # material opacity comes from the catalogue, exactly as engine.evaluate() does
    s["proposals"] = [engine.apply_material(p) for p in s.get("proposals", [])]
    return s


# ---------------------------------------------------------------- georef / mapping
class Geo:
    def __init__(self, georef: dict, lat0: float, lon0: float):
        self.g, self.lat0, self.lon0 = georef, lat0, lon0
        self.size = georef["size"]

    def m2px(self, x, y):
        """scene local metres (x east, y north, origin = stop) -> base-image px (linear within the image)."""
        lat = self.lat0 + np.asarray(y) / M_PER_DEG
        lon = self.lon0 + np.asarray(x) / (M_PER_DEG * math.cos(math.radians(self.lat0)))
        g = self.g
        px = (lon - g["west"]) / (g["east"] - g["west"]) * self.size
        py = (g["north"] - lat) / (g["north"] - g["south"]) * self.size
        return px, py

    def px_per_m(self):
        g = self.g
        return self.size / ((g["east"] - g["west"]) * M_PER_DEG * math.cos(math.radians(self.lat0)))


# ---------------------------------------------------------------- base image
def _osm_ways():
    nodes, ways = {}, {}
    for f in glob.glob(os.path.join(ROOT, "scenes", "cache", "*.json")):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        for e in d.get("elements", []):
            if e.get("type") == "node":
                nodes[e["id"]] = (e["lat"], e["lon"])
            elif e.get("type") == "way":
                ways[e["id"]] = e
    return nodes, ways


def _pseudo_aerial(scene: dict, half_m: float = 75.0, mpp: float = 0.1):
    size = int(2 * half_m / mpp)
    lat0, lon0 = scene["lat"], scene["lon"]
    dlat = half_m / M_PER_DEG
    dlon = half_m / (M_PER_DEG * math.cos(math.radians(lat0)))
    georef = {"size": size, "north": lat0 + dlat, "west": lon0 - dlon, "south": lat0 - dlat, "east": lon0 + dlon,
              "stop_px": [size / 2, size / 2]}
    geo = Geo(georef, lat0, lon0)
    rng = np.random.default_rng(7)
    # pavement: warm light grey with fine noise
    base = np.full((size, size, 3), (148, 144, 136), np.float32)
    base += rng.normal(0, 6, (size, size, 1))
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)

    def ll2px(la, lo):
        return ((lo - georef["west"]) / (georef["east"] - georef["west"]) * size,
                (georef["north"] - la) / (georef["north"] - georef["south"]) * size)

    nodes, ways = _osm_ways()
    widths = {"primary": 13, "secondary": 11, "tertiary": 9, "residential": 7, "unclassified": 7, "service": 4,
              "trunk": 14, "primary_link": 8, "secondary_link": 8, "living_street": 6}
    roads = []
    for w in ways.values():
        tg = w.get("tags", {})
        hw = tg.get("highway")
        if hw in widths and "nodes" in w:
            pts = [ll2px(*nodes[n]) for n in w["nodes"] if n in nodes]
            if len(pts) >= 2:
                roads.append((pts, widths[hw] / mpp))
    if not any(min(math.hypot(px_ - size / 2, py_ - size / 2) for px_, py_ in pts) < 40 / mpp for pts, _ in roads):
        # OSM cache holds no road geometry at the stop: approximate the carriageway beside the stop along
        # the scene's road axis (geometry.py rotates CCW from +x, so 89 deg = north-south). Placeholder only.
        a = math.radians(scene.get("road_bearing_deg", 0))
        ux, uy = math.cos(a), math.sin(a)
        vx, vy = uy, -ux
        off = 8.5
        p0 = (ux * -200 + vx * off, uy * -200 + vy * off)
        p1 = (ux * 200 + vx * off, uy * 200 + vy * off)
        q = [geo.m2px(*p0), geo.m2px(*p1)]
        roads.append(([(float(x), float(y)) for x, y in q], 11 / mpp))
    for pts, wpx in roads:   # kerb edge
        d.line(pts, fill=(118, 116, 112), width=int(wpx + 6), joint="curve")
    for pts, wpx in roads:   # asphalt
        d.line(pts, fill=(62, 63, 66), width=int(wpx), joint="curve")
    asph = np.asarray(img).astype(np.float32)
    mask = (np.abs(asph - (62, 63, 66)).sum(2) < 4)
    asph[mask] += rng.normal(0, 5, (mask.sum(), 1))
    img = Image.fromarray(np.clip(asph, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    for pts, wpx in roads:   # dashed centre line
        if wpx * mpp < 8:
            continue
        for side in (-1, 1):  # lane edge lines
            (ax_, ay_), (bx_, by_) = pts[0], pts[-1]
            L0 = math.hypot(bx_ - ax_, by_ - ay_) or 1
            nx_, ny_ = -(by_ - ay_) / L0, (bx_ - ax_) / L0
            o_ = side * (wpx / 2 - 0.6 / mpp)
            d.line([(x + nx_ * o_, y + ny_ * o_) for x, y in pts], fill=(196, 192, 180), width=int(0.12 / mpp))
        for a, b in zip(pts[:-1], pts[1:]):
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            n = int(L / (6 / mpp))
            for k in range(n):
                s0, s1 = k / max(n, 1), (k + 0.5) / max(n, 1)
                d.line([(a[0] + (b[0] - a[0]) * s0, a[1] + (b[1] - a[1]) * s0),
                        (a[0] + (b[0] - a[0]) * s1, a[1] + (b[1] - a[1]) * s1)], fill=(214, 210, 196), width=int(0.15 / mpp))
    # buildings: OSM footprints from the scene (heights known) as rooftops with AO + bevel
    ao = Image.new("L", (size, size), 0)
    dao = ImageDraw.Draw(ao)
    roof_cols = [(128, 112, 100), (150, 140, 128), (108, 104, 102), (164, 152, 138), (122, 96, 84), (140, 136, 132)]
    blds = [o for o in scene["occluders"] if o["kind"] == "building" and o.get("shape") == "prism"]
    for o in blds:
        px, py = geo.m2px(*np.array(o["footprint"]).T)
        dao.polygon(list(zip(px, py)), fill=255)
    ao = ao.filter(ImageFilter.GaussianBlur(14))
    arr = np.asarray(img).astype(np.float32) * (1 - 0.35 * (np.asarray(ao, np.float32) / 255)[..., None])
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    for i, o in enumerate(blds):
        px, py = geo.m2px(*np.array(o["footprint"]).T)
        poly = list(zip(px, py))
        c = roof_cols[int(abs(hash(o["id"])) % len(roof_cols)) if False else i % len(roof_cols)]
        d.polygon(poly, fill=tuple(int(v * 0.72) for v in c))
        # inset bevel: shrink toward centroid
        cx, cy = np.mean(px), np.mean(py)
        inset = [(x + (cx - x) * 0.04, y + (cy - y) * 0.04) for x, y in poly]
        d.polygon(inset, fill=c)
        d.line(poly + [poly[0]], fill=tuple(min(255, int(v * 1.15)) for v in c), width=3)
    arr = np.asarray(img).astype(np.float32)
    arr += rng.normal(0, 3.5, arr.shape[:2] + (1,))
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    # trees: soft dark-green blobs with a highlight
    tl = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    dt = ImageDraw.Draw(tl)
    ppm = 1 / mpp
    for o in scene["occluders"]:
        if o["kind"] == "tree":
            px, py = geo.m2px(*o["center"])
            r = o.get("radius", 2.4) * ppm
            for k, (col, rr) in enumerate([((34, 52, 30, 255), 1.0), ((52, 78, 40, 255), 0.75), ((74, 102, 52, 200), 0.45)]):
                ox = -0.18 * r * k
                dt.ellipse([px - r * rr + ox, py - r * rr + ox, px + r * rr + ox, py + r * rr + ox], fill=col)
    tl = tl.filter(ImageFilter.GaussianBlur(4))
    img.paste(tl, (0, 0), tl)
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    return img, georef


@lru_cache(maxsize=1)
def _base():
    scene = _scene(False)
    jp = os.path.join(ROOT, "web", "assets", "hackney_aerial.jpg")
    js = os.path.join(ROOT, "web", "assets", "hackney_aerial.json")
    if os.path.exists(jp) and os.path.exists(js):
        georef = json.load(open(js))
        georef = georef.get("georef", georef)
        img = Image.open(jp).convert("RGB")
        georef.setdefault("size", img.size[0])
        return img, Geo(georef, scene["lat"], scene["lon"]), "Imagery © Esri, Maxar, Earthstar Geographics", True
    img, georef = _pseudo_aerial(scene)
    return img, Geo(georef, scene["lat"], scene["lon"]), "OSM-derived aerial (placeholder) · Map © OpenStreetMap contributors", False


# ---------------------------------------------------------------- ray-cast fields (cached)
def _times(scene):
    return engine.times(scene, 15)


@lru_cache(maxsize=2)
def _field(after: bool):
    """Ground (z=0.05) direct-sun transmission per 15-min step on a FIELD_STEP grid, rows north->south."""
    scene = _scene(after)
    occ = list(scene["occluders"]) + (scene.get("proposals", []) if after else [])
    xs = np.arange(-FIELD_R + FIELD_STEP / 2, FIELD_R, FIELD_STEP)
    ys = xs[::-1]
    gx, gy = np.meshgrid(xs, ys)
    pts = np.column_stack([gx.ravel(), gy.ravel(), np.full(gx.size, 0.05)])
    frames, suns = [], []
    for hh, mm in _times(scene):
        az, el = sun_position(scene["lat"], scene["lon"], local_to_utc(scene["date"], hh, mm, scene.get("utc_offset", 0)))
        suns.append((az, el))
        s = transmission(pts, np.array(sun_vector(az, el)), occ) if el > 0 else np.zeros(len(pts))
        frames.append(s.reshape(gx.shape).astype(np.float32))
    frames = np.stack(frames)
    hours = frames[:-1].sum(0) * 0.25  # 36 x 15-min intervals = 09:00-18:00
    # waiting-area cells at the verifier's 1.2 m grid and sample height
    wpts = engine.grid(scene, 0.5)  # the verifier's score() grid (sample height 1.2 m)
    wsun = []
    for (hh, mm), (az, el) in zip(_times(scene), suns):
        wsun.append(transmission(wpts, np.array(sun_vector(az, el)), occ) if el > 0 else np.zeros(len(wpts)))
    wsun = np.stack(wsun)
    return frames, hours, suns, wpts, wsun


# ---------------------------------------------------------------- drawing helpers
def _thermal(v):
    """v in 0..1 -> RGB (deep blue -> purple -> red -> amber -> pale yellow)."""
    stops = np.array([[20, 30, 90], [90, 30, 130], [200, 40, 70], [255, 120, 40], [255, 196, 40], [255, 236, 120]], np.float32)
    x = np.clip(v, 0, 1) * (len(stops) - 1)
    i = np.clip(np.floor(x).astype(int), 0, len(stops) - 2)
    f = (x - i)[..., None]
    return stops[i] * (1 - f) + stops[i + 1] * f


def _view(t, kw):
    width_m = kw.get("width_m", 80.0)
    push = kw.get("push", 0.18)
    dur = kw.get("dur", 6.0)
    s = min(max(t / dur, 0), 1)
    s = s * s * (3 - 2 * s)
    wm = min(width_m * (1 + push * (1 - s)), 2 * FIELD_R - 1)
    return wm, wm * H / W


def _shadow_overlay(geo, base_box, field, alpha):
    """Map the field (metres grid) onto the cropped output. base_box = crop box in base px."""
    x0, y0, x1, y1 = base_box
    # convert crop px back to metres
    ppm = geo.px_per_m()
    cx, cy = geo.m2px(0.0, 0.0)
    mx0, mx1 = (x0 - cx) / ppm, (x1 - cx) / ppm
    my0, my1 = (cy - y0) / ppm, (cy - y1) / ppm  # north, south
    fi = field if isinstance(field, Image.Image) else Image.fromarray(field.astype(np.float32), mode="F")
    gx0 = (mx0 + FIELD_R) / FIELD_STEP
    gx1 = (mx1 + FIELD_R) / FIELD_STEP
    gy0 = (FIELD_R - my0) / FIELD_STEP
    gy1 = (FIELD_R - my1) / FIELD_STEP
    r = fi.resize((W, H), Image.BILINEAR, box=(gx0, gy0, gx1, gy1))
    return r if isinstance(field, Image.Image) else np.asarray(r)


@lru_cache(maxsize=2)
def _exposure_rgba(after: bool):
    hours = _field(after)[1]
    hv = np.clip(hours / 9.0, 0, 1)
    rgba = np.dstack([_thermal(hv), (0.30 + 0.30 * hv) * 255]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def _arrow_from_sun(d, az, el):
    """Arrow entering from the panel edge on the sun's side, pointing toward the stop."""
    a = math.radians(az)
    ux, uy = math.sin(a), -math.cos(a)  # screen direction toward the sun
    cx, cy = W / 2, H / 2
    k = min((W / 2 - 70) / max(abs(ux), 1e-6), (H / 2 - 70) / max(abs(uy), 1e-6))
    sx, sy = cx + ux * k, cy + uy * k
    ex, ey = cx + ux * (k - 150), cy + uy * (k - 150)
    d.line([(sx, sy), (ex, ey)], fill=AMBER, width=5)
    px, py = -uy, ux
    d.polygon([(ex - ux * 22 + px * 0, ey - uy * 22), (ex + px * 13, ey + py * 13), (ex - px * 13, ey - py * 13)], fill=AMBER)
    d.ellipse([sx - 20, sy - 20, sx + 20, sy + 20], fill=AMBER)
    for k2 in range(8):
        b = k2 * math.pi / 4
        d.line([(sx + math.cos(b) * 26, sy + math.sin(b) * 26), (sx + math.cos(b) * 36, sy + math.sin(b) * 36)], fill=AMBER, width=4)


def _label(d, xy, text, font, fg=TEXT, bg=(8, 9, 11, 200), pad=10, anchor="la"):
    bb = d.textbbox(xy, text, font=font, anchor=anchor)
    d.rounded_rectangle([bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad], radius=6, fill=bg)
    d.text(xy, text, font=font, fill=fg, anchor=anchor)
    return bb


# ---------------------------------------------------------------- main API
def aerial_frame(t: float, mode: str = "sweep", **kw) -> Image.Image:
    """mode: 'sweep' (shadows through the day), 'exposure' (direct-sun hours), 'after' (with the verified canopy).
    kw: width_m (80), push (0.18 extra zoom at t=0), dur (6 s), t0_min (540), t1_min (1080), after_view ('exposure'|'sweep')."""
    after = mode == "after"
    view = kw.get("after_view", "exposure") if after else mode
    base, geo, credit, real = _base()
    frames, hours, suns, wpts, wsun = _field(after)
    scene = _scene(after)
    wm, hm = _view(t, kw)
    ppm = geo.px_per_m()
    cx, cy = geo.m2px(0.0, kw.get("shift_y_m", 0.0))  # >0: view centre north of the stop, stop sits lower
    box = (cx - wm / 2 * ppm, cy - hm / 2 * ppm, cx + wm / 2 * ppm, cy + hm / 2 * ppm)
    img = base.resize((W, H), Image.BILINEAR, box=box)
    opx = W / wm  # output px per metre

    def o(x, y):
        bx, by = geo.m2px(x, y)
        return (np.asarray(bx) - box[0]) * W / (box[2] - box[0]), (np.asarray(by) - box[1]) * H / (box[3] - box[1])

    dur = kw.get("dur", 6.0)
    t0, t1 = kw.get("t0_min", 540), kw.get("t1_min", 1080)
    s = min(max(t / dur, 0), 1)
    tmin = t0 + (t1 - t0) * s
    fi = (tmin - 540) / 15.0
    i0 = int(np.clip(math.floor(fi), 0, len(frames) - 1))
    i1 = min(i0 + 1, len(frames) - 1)
    f = float(np.clip(fi - i0, 0, 1))

    if view == "sweep":
        sun = np.clip(frames[i0] * (1 - f) + frames[i1] * f, 0, 1)
        sh = np.zeros(sun.shape + (4,), np.uint8)
        sh[..., 0], sh[..., 1], sh[..., 2] = 8, 14, 40          # cool shadow
        sh[..., 3] = ((1 - sun) * 150).astype(np.uint8)
        warm = np.zeros_like(sh)
        warm[..., 0], warm[..., 1], warm[..., 2] = 255, 170, 60  # faint warm cast on sunlit ground
        warm[..., 3] = (sun * 26).astype(np.uint8)
        out = img.convert("RGBA")
        out.alpha_composite(_shadow_overlay(geo, box, Image.fromarray(warm, "RGBA"), 1))
        out.alpha_composite(_shadow_overlay(geo, box, Image.fromarray(sh, "RGBA"), 1))
        out = out.convert("RGB")
    else:
        out = img.convert("RGBA")
        out.alpha_composite(_shadow_overlay(geo, box, _exposure_rgba(after), 1))
        out = out.convert("RGB")

    d = ImageDraw.Draw(out, "RGBA")
    # waiting-area cells (verifier grid, 1.2 m, sample height 1.2 m)
    ws = wsun[i0] * (1 - f) + wsun[i1] * f
    whours = wsun[:-1].sum(0) * 0.25
    half = 0.25
    for k, (x, y, _) in enumerate(wpts):
        xs_, ys_ = o(np.array([x - half, x + half]), np.array([y + half, y - half]))
        if view == "sweep":
            c = tuple(int(v + (b - v) * ws[k]) for v, b in zip((30, 60, 170), AMBER))
            fill = c + (225,)
        else:
            c = tuple(int(v) for v in _thermal(np.array(whours[k] / 9.0)))
            fill = c + (235,)
        d.rectangle([xs_[0], ys_[0], xs_[1], ys_[1]], fill=fill)
    for r_ in scene["occluders"]:
        if r_["kind"] == "shelter_roof" and r_.get("shape") == "box":
            rx, ry = o(*np.array(footprint(r_)).T)
            rp = list(zip(rx, ry))
            d.line(rp + [rp[0]], fill=(200, 235, 255, 150), width=2)
    wx, wy = o(*np.array(scene["waiting_area"]).T)
    wpoly = list(zip(wx, wy))
    d.line(wpoly + [wpoly[0]], fill=(255, 255, 255, 255), width=3)

    if after:
        for p in scene.get("proposals", []):
            if p.get("shape") == "box":
                corners = footprint(p)
                cxs, cys = o(*np.array(corners).T)
                cp = list(zip(cxs, cys))
                d.polygon(cp, fill=(235, 245, 250, 90))
                d.line(cp + [cp[0]], fill=(255, 255, 255, 255), width=4)
                d.line([cp[0], cp[2]], fill=(255, 255, 255, 110), width=2)
                d.line([cp[1], cp[3]], fill=(255, 255, 255, 110), width=2)

    # cursor ring on the stop
    pcx_, pcy_ = o(0.0, 0.0)
    pcx_, pcy_ = float(pcx_), float(pcy_)
    R = 5.2 * opx
    pulse = 1 + 0.06 * math.sin(t * 4)
    d.ellipse([pcx_ - R * pulse, pcy_ - R * pulse, pcx_ + R * pulse, pcy_ + R * pulse], outline=CYAN + (255,), width=4)
    d.ellipse([pcx_ - R * 1.25, pcy_ - R * 1.25, pcx_ + R * 1.25, pcy_ + R * 1.25], outline=CYAN + (90,), width=2)
    for ang in (0, 90, 180, 270):
        b = math.radians(ang)
        d.line([(pcx_ + math.cos(b) * R * 1.25, pcy_ + math.sin(b) * R * 1.25),
                (pcx_ + math.cos(b) * R * 1.55, pcy_ + math.sin(b) * R * 1.55)], fill=CYAN + (255,), width=3)

    fb, fm, fs = _font("Inter-Bold.otf", 30), _font(MONO, 20), _font(MONO, 15)
    wa_pct = float(np.mean(ws) * 100)
    lx = pcx_ + R * 1.7
    if view == "sweep":
        hh, mm = int(tmin // 60), int(tmin % 60)
        az, el = sun_position(scene["lat"], scene["lon"], local_to_utc(scene["date"], hh, mm, scene.get("utc_offset", 0)))
        _arrow_from_sun(d, az, el)
        _label(d, (24, 24), f"{hh:02d}:{mm:02d}  ·  SUN az {az:5.1f}°  el {el:4.1f}°", fm, fg=AMBER)
        insun = wa_pct
        msg = "WAITING AREA: FULL SUN" if insun > 60 else ("WAITING AREA: PART SHADE" if insun > 25 else "WAITING AREA: SHADED")
        _label(d, (lx, pcy_ - 22), msg, fb, fg=AMBER if insun > 60 else (CYAN if insun <= 25 else TEXT))
        _label(d, (lx, pcy_ + 28), f"{insun:3.0f}% in direct sun now", fm)
        # legend
        bb = _label(d, (24, H - 64), "   direct sun      shade   (ray-cast, 15-min steps)", fs)
        d.rectangle([bb[0] + 2, bb[1] + 2, bb[0] + 14, bb[1] + 14], fill=AMBER)
        d.rectangle([bb[0] + 136, bb[1] + 2, bb[0] + 148, bb[1] + 14], fill=(30, 60, 170))
    else:
        hrs = float(np.mean(whours))
        try:  # show the verifier's recorded figure (hero.json) so every view quotes one number
            import json as _json
            _st = _json.loads((pathlib.Path(__file__).resolve().parents[2] / 'web/assets/hero.json').read_text())['stats']
            hrs = float(_st['sun_hours_after' if after else 'sun_hours_before'])
        except Exception:  # noqa: BLE001
            pass
        _label(d, (lx, pcy_ - 34), f"{hrs:.1f} h", _font("Inter-Black.otf", 54), fg=GREEN if after else AMBER)
        _label(d, (lx, pcy_ + 40), "direct sun on the waiting area", fm)
        _label(d, (lx, pcy_ + 80), "19 Jul · 09:00–18:00 · people wait here", fs, fg=DIM)
        # ramp legend
        lw = 260
        ramp = (_thermal(np.linspace(0, 1, lw))[None].repeat(14, 0)).astype(np.uint8)
        out.paste(Image.fromarray(ramp), (34, H - 92))
        d.text((34, H - 72), "0 h", font=fs, fill=TEXT)
        d.text((34 + lw, H - 72), "9 h", font=fs, fill=TEXT, anchor="ra")
        d.text((34, H - 118), "DIRECT-SUN EXPOSURE, 19 Jul (ray-cast, 1.2 m)", font=fs, fill=TEXT)
    if after:
        _label(d, (W - 24, 24), "AFTER · verified shade-sail (accepted)", fm, fg=GREEN, anchor="ra")
    _label(d, (W - 16, H - 16), credit, _font(MONO, 13), fg=DIM if real else (200, 200, 200), anchor="rd", pad=6)
    return out


if __name__ == "__main__":
    import time
    outdir = "/tmp/claude-0/-home-user-shadowstop/f261938e-6d56-5267-8a48-f3a0497ae03e/scratchpad"
    t_ = time.time()
    aerial_frame(0, "sweep"); aerial_frame(0, "after")
    print("warm", time.time() - t_)
    for mode in ("sweep", "exposure", "after"):
        for tt in (0.0, 3.0, 6.0):
            t_ = time.time()
            im = aerial_frame(tt, mode)
            print(mode, tt, f"{(time.time() - t_) * 1000:.0f} ms", im.size)
            im.save(f"{outdir}/aerial_{mode}_{tt:.0f}.png")
