"""Maths motion-graphics overlays for the hook film. Every number shown is computed live from
shadowstop.sun / shadowstop.geometry / shadowstop.engine on scenes/hackney_*.json (no invented values).

API (all draw in place onto a PIL Image, RGB or RGBA; box=(x, y, w, h); t = seconds for animation):
    solar(im, t, minutes, box)            NOAA chain (as in sun.py) with live substitution at `minutes` local
    raycast(im, t, box, minutes=None)     3D wireframe: 1.2 m grid, sun rays, canopy prism, ray/prism test
    integral(im, t, box, before=True)     score double sum + acceptance predicate (engine.evaluate rules)
    counterexample(im, t, box)            obvious fix rejected: exists t* with S_t* < 0.40
    hud_grid(im, t, box=None)             faint registration ticks, metre labels, sun-path arc
"""
from __future__ import annotations

import copy
import io
import json
import math
import re
import os
import sys
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import matplotlib  # noqa: E402
matplotlib.use("Agg")
from matplotlib import mathtext  # noqa: E402,F401
import matplotlib.pyplot as plt  # noqa: E402

from shadowstop import engine  # noqa: E402
from shadowstop.geometry import footprint, hits, transmission  # noqa: E402
from shadowstop.materials import apply_material  # noqa: E402
from shadowstop.sun import local_to_utc, sun_position, sun_vector, _julian_day  # noqa: E402

AMBER = (255, 159, 67)
CYAN = (90, 220, 255)
RED = (255, 84, 84)
GREEN = (80, 230, 140)
TEXT = (225, 228, 232)
DIM = (110, 116, 124)
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"


@lru_cache(None)
def _font(size):
    return ImageFont.truetype(MONO, size)


# ---------------------------------------------------------------- mathtext cache
@lru_cache(maxsize=512)
def tex(s: str, size: int = 26, color=TEXT) -> Image.Image:
    """Render a mathtext string to a tight transparent RGBA image (cached)."""
    fig = plt.figure(figsize=(0.01, 0.01), dpi=100)
    fig.text(0, 0, s, fontsize=size * 0.72, color=tuple(c / 255 for c in color),
             math_fontfamily="cm")
    buf = io.BytesIO()
    fig.savefig(buf, dpi=100, transparent=True, bbox_inches="tight", pad_inches=0.02)
    plt.close(fig)
    buf.seek(0)
    return Image.open(buf).convert("RGBA")


def _paste(im, sprite, x, y, alpha=1.0):
    if alpha <= 0:
        return
    if alpha < 1:
        sprite = sprite.copy()
        a = sprite.getchannel("A").point(lambda v: int(v * alpha))
        sprite.putalpha(a)
    if im.mode == "RGBA":
        im.alpha_composite(sprite, (int(x), int(y)))
    else:
        im.paste(sprite, (int(x), int(y)), sprite)


def _ease(u):
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def _col(c, a):
    return tuple(int(v) for v in c) + (int(255 * max(0, min(1, a))),)


def _overlay(im):
    return Image.new("RGBA", im.size, (0, 0, 0, 0))


def _flatten(im, ov):
    if im.mode == "RGBA":
        im.alpha_composite(ov)
    else:
        im.paste(ov, (0, 0), ov)


def _text(d, xy, s, size, color, a=1.0):
    d.text(xy, s, font=_font(size), fill=_col(color, a))


def _equations(im, t, x, y, rows, t0=0.0, dt=0.55, gap=14):
    """rows: list of (terms[list of mathtext], color, numeric-string or None). Term-by-term reveal."""
    yy = y
    for i, (terms, color, num) in enumerate(rows):
        tr = t - t0 - i * dt
        xx = x
        h = 0
        for j, term in enumerate(terms):
            sp = tex(term, 26, color)
            a = _ease((tr - j * 0.12) / 0.3)
            _paste(im, sp, xx, yy + (1 - a) * 6, a)
            xx += sp.width + 4
            h = max(h, sp.height)
        if num:
            ov = _overlay(im)
            d = ImageDraw.Draw(ov)
            a = _ease((tr - len(terms) * 0.12) / 0.4)
            _text(d, (xx + 18, yy + max(0, h - 26) / 2), num, 22, AMBER, a)
            _flatten(im, ov)
        yy += max(h, 30) + gap
    return yy


# ---------------------------------------------------------------- real data
SCENE = json.load(open(os.path.join(ROOT, "scenes", "hackney_accepted.json")))
LAT, LON, DATE, OFF = SCENE["lat"], SCENE["lon"], SCENE["date"], SCENE.get("utc_offset", 1)


def solar_chain(minutes: float) -> dict:
    """Same arithmetic as shadowstop.sun.sun_position, exposing its intermediates."""
    hh, mm = int(minutes // 60), int(minutes % 60)
    dt = local_to_utc(DATE, hh, mm, OFF)
    jd = _julian_day(dt)
    T = (jd - 2451545.0) / 36525.0
    l0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360.0
    m = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    mr = math.radians(m)
    c = (math.sin(mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + math.sin(2 * mr) * (0.019993 - 0.000101 * T)
         + math.sin(3 * mr) * 0.000289)
    omega = math.radians(125.04 - 1934.136 * T)
    lam = l0 + c - 0.00569 - 0.00478 * math.sin(omega)
    eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
    eps = math.radians(eps0 + 0.00256 * math.cos(omega))
    decl = math.asin(math.sin(eps) * math.sin(math.radians(lam)))
    y = math.tan(eps / 2) ** 2
    l0r = math.radians(l0)
    E = 4 * math.degrees(y * math.sin(2 * l0r) - 2 * e * math.sin(mr) + 4 * e * y * math.sin(mr) * math.cos(2 * l0r)
                         - 0.5 * y * y * math.sin(4 * l0r) - 1.25 * e * e * math.sin(2 * mr))
    utc_min = dt.hour * 60 + dt.minute
    ts = (utc_min + E + 4 * LON) % 1440
    ha = ts / 4 - 180
    latr = math.radians(LAT)
    sin_e = math.sin(latr) * math.sin(decl) + math.cos(latr) * math.cos(decl) * math.cos(math.radians(ha))
    az, el = sun_position(LAT, LON, dt)  # the engine's own answer (with refraction)
    return dict(hh=hh, mm=mm, jd=jd, T=T, L0=l0, M=m, lam=lam, decl=math.degrees(decl), E=E, ts=ts, h=ha,
                sin_e=sin_e, e_geo=math.degrees(math.asin(sin_e)), az=az, el=el, s=sun_vector(az, el))


@lru_cache(None)
def _scores():
    obvious = None
    hero = os.path.join(ROOT, "web", "assets", "hero.json")
    hj = json.load(open(hero))
    base = {k: v for k, v in SCENE.items() if k != "proposals"}
    ev = engine.evaluate(base, SCENE["proposals"][0], 8000)
    after = copy.deepcopy(base)
    after["proposals"] = [apply_material(SCENE["proposals"][0])]
    sa = engine.score(after, include_proposals=True)
    sb = engine.score(base)
    try:
        for a in hj.get("attempts", []):
            if not a.get("accepted"):
                obvious = a
                break
    except Exception:
        pass
    return dict(ev=ev, sa=sa, sb=sb, G=len(engine.grid(base)), T=len(sb["by_time"]), obvious=obvious,
                prop=apply_material(SCENE["proposals"][0]))


# ---------------------------------------------------------------- 1. solar
def solar(im, t, minutes, box):
    x, y, w, h = box
    c = solar_chain(minutes)
    ov = _overlay(im)
    d = ImageDraw.Draw(ov)
    a = _ease(t / 0.4)
    _text(d, (x, y), "SOLAR POSITION  ·  NOAA / Meeus  ·  shadowstop/sun.py", 16, CYAN, a)
    _text(d, (x, y + 24), f"φ = {LAT:.4f}°   λ = {LON:.4f}°   {DATE}  {c['hh']:02d}:{c['mm']:02d} BST (UTC+1)", 16, DIM, a)
    d.line([x, y + 50, x + int((w - 10) * _ease(t / 0.8)), y + 50], fill=_col(CYAN, 0.5), width=1)
    _flatten(im, ov)
    rows = [
        ([r"$T=\frac{JD-2451545}{36525}$"], TEXT, f"JD {c['jd']:.4f}   T = {c['T']:.8f}"),
        ([r"$L_0=280.46646+36000.76983\,T$", r"$,\;M=357.52911+35999.05\,T$"], TEXT,
         f"L0 = {c['L0']:.3f}°  M = {c['M'] % 360:.3f}°"),
        ([r"$\delta=\arcsin(\sin\varepsilon\,\sin\lambda_{app})$"], TEXT, f"δ = {c['decl']:+.4f}°"),
        ([r"$E=4\,[\,y\sin2L_0-2e\sin M+4ey\sin M\cos2L_0-\ldots\,]$"], TEXT, f"E = {c['E']:+.3f} min"),
        ([r"$h=\frac{t_{utc}+E+4\lambda}{4}-180^\circ$"], TEXT, f"h = {c['h']:+.3f}°"),
        ([r"$\sin e=\sin\varphi\,\sin\delta+\cos\varphi\,\cos\delta\,\cos h$"], CYAN,
         f"sin e = {c['sin_e']:.5f}"),
        ([r"$A=\mathrm{atan2}(\sin h,\;\cos h\sin\varphi-\tan\delta\cos\varphi)+180^\circ$"], CYAN, None),
    ]
    yy = _equations(im, t, x, y + 66, rows, t0=0.3, dt=0.45)
    ov = _overlay(im)
    d = ImageDraw.Draw(ov)
    a = _ease((t - 0.3 - len(rows) * 0.45) / 0.4)
    _text(d, (x, yy + 6), f"A = {c['az']:7.2f}°   e = {c['el']:6.2f}°  (+ refraction)", 26, AMBER, a)
    sx, sy, sz = c["s"]
    _text(d, (x, yy + 44), f"s = (sin A cos e, cos A cos e, sin e) = ({sx:+.3f}, {sy:+.3f}, {sz:+.3f})", 18, TEXT, a)
    _flatten(im, ov)


# ---------------------------------------------------------------- 2. raycast
def _proj(p, cx, cy, k):
    # oblique axonometric: x east, y north (into page), z up
    X, Y, Z = p
    return (cx + k * (X * 0.94 - Y * 0.42), cy - k * (Z * 0.92 + X * 0.18 + Y * 0.30))


def raycast(im, t, box, minutes=None):
    x, y, w, h = box
    sc = _scores()
    prop = sc["prop"]
    if minutes is None:
        minutes = 9 * 60 + ((t * 40) % (9 * 60))  # sweep the day
    c = solar_chain(minutes)
    s = np.array(c["s"])
    pts = engine.grid(SCENE)
    blocked = hits(pts, s, prop)
    fp = footprint(prop)
    z0, z1 = prop["z0"], prop["z1"]
    k = min(w, h) / 11.5
    cx, cy = x + w * 0.30, y + h * 0.66
    ov = _overlay(im)
    d = ImageDraw.Draw(ov)
    a0 = _ease(t / 0.5)
    _text(d, (x, y), "RAY CAST  ·  shadowstop/geometry.py  hits_prism()", 16, CYAN, a0)
    _text(d, (x, y + 22), f"|G| = {len(pts)} cells @ 0.5 m, z = {engine.SAMPLE_HEIGHT_M} m   "
          f"canopy {prop['size'][0]}×{prop['size'][1]} m, z0 {z0} m, α = {prop['opacity']}", 15, DIM, a0)
    # ground grid / waiting area
    wa = SCENE["waiting_area"] + [SCENE["waiting_area"][0]]
    d.line([_proj((px, py, 0), cx, cy, k) for px, py in wa], fill=_col(DIM, 0.8 * a0), width=1)
    for gx in range(-4, 5, 2):
        d.line([_proj((gx, -7, 0), cx, cy, k), _proj((gx, 7, 0), cx, cy, k)], fill=_col(DIM, 0.18 * a0))
    for gy in range(-6, 7, 2):
        d.line([_proj((-4, gy, 0), cx, cy, k), _proj((4, gy, 0), cx, cy, k)], fill=_col(DIM, 0.18 * a0))
    # canopy prism (write-on)
    wa_p = _ease((t - 0.3) / 0.8)
    for zz in (z0, z1):
        ring = [_proj((px, py, zz), cx, cy, k) for px, py in fp + [fp[0]]]
        n = max(2, int(len(ring) * wa_p + 0.999))
        d.line(ring[:n], fill=_col(CYAN, 0.9 * wa_p), width=2 if zz == z0 else 1)
    for px, py in fp:
        d.line([_proj((px, py, 0), cx, cy, k), _proj((px, py, z0), cx, cy, k)], fill=_col(DIM, 0.35 * wa_p))
        d.line([_proj((px, py, z0), cx, cy, k), _proj((px, py, z1), cx, cy, k)], fill=_col(CYAN, 0.7 * wa_p))
    # rays
    ra = _ease((t - 0.8) / 0.8)
    L = 9.0 / max(s[2], 0.15)
    for i, (p, b) in enumerate(zip(pts, blocked)):
        if i % 2:
            continue
        p0 = _proj(p, cx, cy, k)
        if b:
            tl = max((z0 - p[2]) / s[2], 0)
            p1 = _proj(p + s * tl, cx, cy, k)
            d.line([p0, p1], fill=_col(CYAN, 0.75 * ra), width=1)
            d.ellipse([p1[0] - 2, p1[1] - 2, p1[0] + 2, p1[1] + 2], fill=_col(CYAN, ra))
        else:
            seg = min(L, 6.0 / max(np.hypot(s[0], s[1]), 0.2)) * ra
            p1 = _proj(p + s * seg, cx, cy, k)
            d.line([p0, p1], fill=_col(AMBER, 0.55 * ra), width=1)
        d.ellipse([p0[0] - 2, p0[1] - 2, p0[0] + 2, p0[1] + 2], fill=_col(AMBER if not b else CYAN, a0))
    # sun vector arrow
    o = _proj((-3.5, 5.5, 0), cx, cy, k)
    e_ = _proj(np.array((-3.5, 5.5, 0)) + s * 4.0, cx, cy, k)
    d.line([o, e_], fill=_col(AMBER, a0), width=2)
    d.ellipse([e_[0] - 7, e_[1] - 7, e_[0] + 7, e_[1] + 7], outline=_col(AMBER, a0), width=2)
    _text(d, (e_[0] + 12, e_[1] - 10), f"ŝ  A {c['az']:.1f}°  e {c['el']:.1f}°", 16, AMBER, a0)
    occ = [o for o in SCENE.get("occluders", [])] + [prop]
    st = float(1.0 - transmission(pts, s, occ).mean())  # engine's per-time shade (all occluders)
    _text(d, (x, y + h - 52), f"t = {c['hh']:02d}:{c['mm']:02d}   blocked {int(blocked.sum())}/{len(pts)}"
          f"   S_t = 1 − mean τ = {st:.4f}", 18, TEXT, a0)
    _flatten(im, ov)
    rows = [
        ([r"$t_{lo}=\max\!\left(\frac{z_0-p_z}{s_z},0\right)$"], TEXT, None),
        ([r"$t_{hi}=\frac{z_1-p_z}{s_z}$"], TEXT, None),
        ([r"$\mathrm{hit}\Leftrightarrow t_{hi}>t_{lo}\ \wedge\ [p+t_{lo}s,\,p+t_{hi}s]\cap F\neq\emptyset$"], CYAN, None),
        ([r"$\tau_g=\prod_o\,(1-\alpha_o)^{\mathrm{hit}_o(g)}$"], AMBER, None),
    ]
    _equations(im, t, x + w * 0.58, y + 70, rows, t0=0.6, dt=0.4, gap=18)


# ---------------------------------------------------------------- 3. integral
def integral(im, t, box, before=True):
    x, y, w, h = box
    sc = _scores()
    ev = sc["ev"]
    S0, S1 = ev["score_before"], ev["score_after"]
    ov = _overlay(im)
    d = ImageDraw.Draw(ov)
    a0 = _ease(t / 0.4)
    _text(d, (x, y), "SCORE  ·  shadowstop/engine.py  score()", 16, CYAN, a0)
    d.line([x, y + 26, x + int((w - 10) * _ease(t / 0.8)), y + 26], fill=_col(CYAN, 0.5), width=1)
    _flatten(im, ov)
    rows = [
        ([r"$S=\frac{1}{|T|}\sum_{t\in T}$", r"$\frac{1}{|G|}\sum_{g\in G}$", r"$\left(1-\prod_{o}(1-\alpha_o)^{\mathbf{1}[\mathrm{ray}(g,\hat s_t)\cap o]}\right)$"], TEXT, None),
    ]
    yy = _equations(im, t, x, y + 44, rows, t0=0.2)
    ov = _overlay(im)
    d = ImageDraw.Draw(ov)
    a = _ease((t - 1.0) / 0.4)
    _text(d, (x, yy + 4), f"|G| = {sc['G']} cells (0.5 m, z = 1.2 m)   |T| = {sc['T']} steps (09:00–18:00, 15 min)", 18, DIM, a)
    # ticking value
    u = _ease((t - 1.3) / 1.6)
    val = S0 if before else S0 + (S1 - S0) * u
    _text(d, (x, yy + 34), f"S = {val:.4f}", 44, AMBER if before else (AMBER if u < 1 else GREEN), a)
    if not before:
        _text(d, (x + 340, yy + 56), f"before {S0:.4f}  →  after {S1:.4f}", 18, TEXT, a)
    _flatten(im, ov)
    if before:
        return
    lo, hi = engine.PEAK_HEAT_HOURS
    gain = S1 - S0
    peak = [r for r in sc["sa"]["by_time"] if r["shade"] is not None and lo * 60 <= int(r["t"][:2]) * 60 + int(r["t"][3:]) <= hi * 60]
    pw = min(peak, key=lambda r: r["shade"])
    p = sc["prop"]
    area = p["size"][0] * p["size"][1]
    zlo, zhi = engine.CANOPY_HEIGHT_RANGE
    preds = [
        (r"$\Delta S \geq %.2f$" % engine.MIN_GAIN, f"{gain:+.4f}", gain >= engine.MIN_GAIN),
        (r"$\min_{t\in[%02d{:}00,\,%02d{:}00]} S_t \geq %.2f$" % (lo, hi, engine.MIN_WORST_TIME_SHADE),
         f"{pw['shade']:.4f} @ {pw['t']}", pw["shade"] >= engine.MIN_WORST_TIME_SHADE),
        (r"$%.1f \leq z_0 \leq %.1f$" % (zlo, zhi), f"z0 = {p['z0']} m", zlo <= p["z0"] <= zhi),
        (r"$|F| \leq %.0f\,\mathrm{m}^2$" % engine.MAX_CANOPY_AREA_M2, f"{area:.2f} m²", area <= engine.MAX_CANOPY_AREA_M2),
        (r"$c \leq B$", f"£{p['cost_gbp']:,.0f} ≤ £8,000 (indicative)", p["cost_gbp"] <= 8000),
    ]
    y2 = yy + 110
    for i, (lx, num, ok) in enumerate(preds):
        tr = t - 2.6 - i * 0.35
        a = _ease(tr / 0.3)
        if a <= 0:
            continue
        sp = tex((r"$\wedge\;$" if i else r"$\;\;\;$") + lx, 26, TEXT)
        _paste(im, sp, x, y2, a)
        ov = _overlay(im)
        d = ImageDraw.Draw(ov)
        _text(d, (x + 420, y2 + 4), num, 20, DIM, a)
        _text(d, (x + 760, y2 + 2), "✓" if ok else "✗", 24, GREEN if ok else RED, _ease((tr - 0.25) / 0.2))
        _flatten(im, ov)
        y2 += max(sp.height, 30) + 10
    a = _ease((t - 2.6 - len(preds) * 0.35 - 0.2) / 0.4)
    ov = _overlay(im)
    d = ImageDraw.Draw(ov)
    v = "ACCEPTED" if ev["accepted"] else "REJECTED"
    _text(d, (x, y2 + 10), f"⇒ verifier: {v}", 30, GREEN if ev["accepted"] else RED, a)
    _flatten(im, ov)


# ---------------------------------------------------------------- 4. counterexample
@lru_cache(None)
def _obvious():
    """Recorded rejection of attempt #1 (web/assets/hero.json) and the engine sun at 09:00."""
    hj = json.load(open(os.path.join(ROOT, "web", "assets", "hero.json")))
    att = hj.get("attempts", [])
    a1 = att[0] if att else {}
    r = a1.get("reason", "")
    m = re.search(r"at (\d\d:\d\d) \(sun az (\d+) deg, el (\d+) deg\) only (\d+)% ", r)
    tstar = m.group(1) if m else "09:00"
    c = solar_chain(int(tstar[:2]) * 60 + int(tstar[3:]))
    c["tstar"] = tstar
    c["Sstar"] = int(m.group(4)) / 100 if m else 0.0
    return a1, c


def counterexample(im, t, box):
    x, y, w, h = box
    a1, c = _obvious()
    ov = _overlay(im)
    d = ImageDraw.Draw(ov)
    a0 = _ease(t / 0.4)
    _text(d, (x, y), "COUNTEREXAMPLE  ·  attempt #1 (obvious fix)  ·  recorded run", 16, RED, a0)
    d.line([x, y + 26, x + int((w - 10) * _ease(t / 0.8)), y + 26], fill=_col(RED, 0.5), width=1)
    _flatten(im, ov)
    rows = [
        ([r"$\exists\, t^{*}=%s\;:$" % c["tstar"].replace(":", "{:}"), r"$\;S_{t^{*}}=%.2f$" % c["Sstar"],
          r"$\;<\;%.2f$" % engine.MIN_WORST_TIME_SHADE], TEXT, None),
        ([r"$\hat s_{t^{*}}=(\sin A\cos e,\ \cos A\cos e,\ \sin e)$"], CYAN, None),
    ]
    yy = _equations(im, t, x, y + 44, rows, t0=0.3, dt=0.7)
    sx, sy, sz = c["s"]
    ov = _overlay(im)
    d = ImageDraw.Draw(ov)
    a = _ease((t - 1.6) / 0.4)
    _text(d, (x, yy + 2), f"A = {c['az']:.2f}°  e = {c['el']:.2f}°  ŝ = ({sx:+.3f}, {sy:+.3f}, {sz:+.3f})", 20, AMBER, a)
    reasons = [p.strip() for p in a1.get("reason", "").split(";") if p.strip()]
    ry = yy + 36
    for r in reasons[:2]:
        _text(d, (x, ry), "verifier: " + r[:96], 15, DIM, a)
        ry += 22
    # elevation diagram: horizon, sun ray at e, roof edge
    gx, gy = x + 40, y + h - 60
    ww = min(w - 80, 520)
    u = _ease((t - 2.0) / 0.8)
    d.line([gx, gy, gx + ww * u, gy], fill=_col(DIM, 0.8), width=1)
    el = math.radians(c["el"])
    L = ww * 0.75 * u
    sxp, syp = gx + ww * 0.15, gy - 52
    ex, ey = sxp + L * math.cos(el), syp - L * math.sin(el)
    d.line([sxp, syp, ex, ey], fill=_col(AMBER, u), width=2)
    d.ellipse([ex - 9, ey - 9, ex + 9, ey + 9], outline=_col(AMBER, u), width=2)
    d.arc([sxp - 60, syp - 60, sxp + 60, syp + 60], -c["el"], 0, fill=_col(AMBER, u))
    _text(d, (sxp + 66, syp - 26), f"e = {c['el']:.0f}°", 16, AMBER, u)
    # roof slab above the person: the low ray passes under it
    rx0, rz = sxp - 30, gy - 150
    d.line([rx0, rz, rx0 + 70, rz], fill=_col(CYAN, u), width=3)
    _text(d, (rx0 - 10, rz - 24), "roof", 14, CYAN, u)
    d.line([sxp, gy, sxp, syp], fill=_col(TEXT, 0.6 * u), width=2)
    _text(d, (sxp - 60, syp + 16), "1.2 m", 13, DIM, u)
    pulse = 0.5 + 0.5 * math.sin(t * 6)
    _text(d, (gx + ww * 0.62, gy - 40), "UNBLOCKED", 18, RED, u * (0.6 + 0.4 * pulse))
    _flatten(im, ov)


# ---------------------------------------------------------------- 5. HUD
@lru_cache(None)
def _sunpath():
    return [solar_chain(m) for m in range(9 * 60, 18 * 60 + 1, 15)]


def hud_grid(im, t, box=None):
    x, y, w, h = box or (0, 0, im.width, im.height)
    ov = _overlay(im)
    d = ImageDraw.Draw(ov)
    a = 0.22 * _ease(t / 0.6)
    step = 64
    for i, gx in enumerate(range(x, x + w + 1, step)):
        L = 8 if i % 4 else 14
        d.line([gx, y, gx, y + L], fill=_col(DIM, a * 2))
        d.line([gx, y + h - L, gx, y + h], fill=_col(DIM, a * 2))
        if i % 4 == 0:
            _text(d, (gx + 3, y + h - 26), f"{(i - w // step // 2) * 2:+d} m", 11, DIM, a * 2.2)
    for j, gy in enumerate(range(y, y + h + 1, step)):
        L = 8 if j % 4 else 14
        d.line([x, gy, x + L, gy], fill=_col(DIM, a * 2))
        d.line([x + w - L, gy, x + w, gy], fill=_col(DIM, a * 2))
    for cx_, cy_ in ((x + 24, y + 24), (x + w - 24, y + 24), (x + 24, y + h - 24), (x + w - 24, y + h - 24)):
        d.line([cx_ - 8, cy_, cx_ + 8, cy_], fill=_col(CYAN, a * 2.5))
        d.line([cx_, cy_ - 8, cx_, cy_ + 8], fill=_col(CYAN, a * 2.5))
    # faint sun path (real azimuth/elevation 09:00-18:00), azimuth -> x, elevation -> y
    sp = _sunpath()
    pts = [(x + w * 0.1 + w * 0.8 * (c["az"] - 90) / 190, y + h * 0.85 - h * 0.7 * c["el"] / 65) for c in sp]
    n = max(2, int(len(pts) * _ease(t / 2.5)))
    d.line(pts[:n], fill=_col(AMBER, a * 0.9), width=1)
    for i in range(0, n, 4):
        px, py = pts[i]
        d.ellipse([px - 2, py - 2, px + 2, py + 2], fill=_col(AMBER, a * 2))
        _text(d, (px + 5, py - 14), f"{sp[i]['hh']:02d}:{sp[i]['mm']:02d}", 10, DIM, a * 2)
    k = int((t * 4) % len(sp))
    px, py = pts[min(k, n - 1)]
    d.ellipse([px - 5, py - 5, px + 5, py + 5], outline=_col(AMBER, a * 3))
    _text(d, (x + 30, y + 30), f"φ {LAT:.4f}  λ {LON:.4f}  ·  {DATE}  ·  grid 0.5 m @ z 1.2 m  ·  Δt 15 min", 11, DIM, a * 2.5)
    _flatten(im, ov)


# ---------------------------------------------------------------- self test
if __name__ == "__main__":
    import time
    out = "/tmp/claude-0/-home-user-shadowstop/f261938e-6d56-5267-8a48-f3a0497ae03e/scratchpad"
    W, H = 1336, 840
    photo = Image.open(os.path.join(ROOT, "web", "assets", "hackney_mare_street.jpg")).convert("RGB").resize((W, H))
    photo = Image.blend(photo, Image.new("RGB", (W, H), (8, 9, 11)), 0.78)
    layers = {
        "solar": lambda im, t: solar(im, t, 13 * 60 + 30, (60, 60, 1200, 720)),
        "raycast": lambda im, t: raycast(im, t, (60, 60, 1220, 720), minutes=13 * 60),
        "integral_before": lambda im, t: integral(im, t, (60, 80, 1200, 700), before=True),
        "integral_after": lambda im, t: integral(im, t, (60, 80, 1200, 700), before=False),
        "counter": lambda im, t: counterexample(im, t, (60, 80, 1200, 700)),
        "hud": lambda im, t: hud_grid(im, t),
    }
    for name, fn in layers.items():
        for ti in (0.6, 1.8, 6.0):
            for bgname, bg in (("dark", Image.new("RGB", (W, H), (8, 9, 11))), ("photo", photo)):
                if bgname == "photo" and ti != 6.0:
                    continue
                im = bg.copy()
                if name != "hud":
                    hud_grid(im, ti)
                t0 = time.perf_counter()
                fn(im, ti)
                ms = (time.perf_counter() - t0) * 1000
                im.save(f"{out}/math_{name}_{bgname}_{ti:.1f}.png")
                print(name, bgname, ti, f"{ms:.1f} ms")
