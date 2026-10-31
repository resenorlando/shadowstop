"""Render the ShadowStop showcase film (deterministic, no browser, no model calls).

Every number drawn comes from shadowstop/engine.py + shadowstop/sun.py run on the saved scenes,
or from the recorded Argon run in web/assets/hero.json. The map is cached OpenStreetMap vector data.

    python showcase-tools/render_film.py [--out docs/shadowstop_film.mp4] [--frames DIR] [--every N]
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import shutil
import subprocess
import sys
from multiprocessing import Pool

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.collections import LineCollection, PolyCollection  # noqa: E402
from matplotlib.patches import Polygon as MPoly, Circle, FancyBboxPatch  # noqa: E402
import shapely  # noqa: E402
from shapely.geometry import Polygon  # noqa: E402

from shadowstop import engine  # noqa: E402
from shadowstop.geometry import footprint  # noqa: E402
from shadowstop.materials import apply_material  # noqa: E402
from shadowstop.osm import to_local  # noqa: E402
from shadowstop.server import _obvious_fix  # noqa: E402
from shadowstop.sun import local_to_utc, sun_position  # noqa: E402

FPS, W, H, DPI = 30, 1920, 1080, 100
DUR = 42.0
NF = int(DUR * FPS)
BG = "#05080d"
CYAN = "#3fe0ff"
AMBER = "#ffb23f"
RED = "#ff4d5e"
GREEN = "#3dff9a"
DIM = "#4a6070"
TXT = "#cfe8f2"
MONO = "DejaVu Sans Mono"
OSM_CREDIT = "Map data © OpenStreetMap contributors"
from matplotlib.colors import ListedColormap  # noqa: E402
THERM = ListedColormap(plt.get_cmap("inferno")(np.linspace(0.0, 0.78, 256)))

D: dict = {}


# ------------------------------------------------------------------ data
def load_osm(lat0, lon0):
    seen, bld, roads, stops = set(), [], [], []
    for f in sorted(glob.glob(os.path.join(ROOT, "scenes", "cache", "*.json"))):
        try:
            els = json.load(open(f)).get("elements", [])
        except Exception:
            continue
        for e in els:
            k = (e.get("type"), e.get("id"))
            if k in seen:
                continue
            seen.add(k)
            tags = e.get("tags", {}) or {}
            if e.get("type") == "way" and e.get("geometry"):
                pts = [to_local(lat0, lon0, g["lat"], g["lon"]) for g in e["geometry"]]
                if "building" in tags and len(pts) >= 3:
                    bld.append(np.array(pts))
                elif "highway" in tags:
                    roads.append((np.array(pts), tags["highway"]))
            elif e.get("type") == "node" and tags.get("highway") == "bus_stop":
                stops.append((to_local(lat0, lon0, e["lat"], e["lon"]), tags.get("name", "")))
    return bld, roads, stops


def exposure_frames(scene, include_props, radius=34.0, step=0.5, z=1.2, extra=None):
    """Direct-sun fraction (1 = full sun) on a grid at z, every 15 min, via engine.shade_at."""
    xs = np.arange(-radius + step / 2, radius, step)
    gx, gy = np.meshgrid(xs, xs)
    pts = np.column_stack([gx.ravel(), gy.ravel()])
    inside = np.zeros(len(pts), bool)
    for o in scene["occluders"]:
        if o.get("kind") == "building":
            inside |= shapely.contains_xy(Polygon(o["footprint"]), pts[:, 0], pts[:, 1])
    sc = dict(scene)
    if extra is not None:
        sc = dict(scene, proposals=[extra])
        include_props = True
    out = []
    for hh, mm in engine.times(scene, 15):
        dt = local_to_utc(scene["date"], hh, mm, scene.get("utc_offset", 0))
        sh = np.array(engine.shade_at(sc, pts.tolist(), dt, include_props, z=z))
        sun = 1.0 - sh
        sun[inside] = np.nan
        out.append(sun.reshape(gx.shape))
    return np.array(out), radius


def prepare():
    before = json.load(open(os.path.join(ROOT, "scenes", "hackney_town_hall.json")))
    after = json.load(open(os.path.join(ROOT, "scenes", "hackney_accepted.json")))
    # opacity comes from the material catalogue, exactly as engine.evaluate() does
    after["proposals"] = [apply_material(p) for p in after["proposals"]]
    hero = json.load(open(os.path.join(ROOT, "web", "assets", "hero.json")))
    sb = engine.score(before)
    sa = engine.score(after, include_proposals=True)
    obvious = apply_material(_obvious_fix(before))
    eb, R = exposure_frames(before, False)
    ea, _ = exposure_frames(after, True)
    eo, _ = exposure_frames(before, False, extra=obvious)
    bld, roads, stops = load_osm(before["lat"], before["lon"])
    suns = []
    for hh, mm in engine.times(before, 15):
        dt = local_to_utc(before["date"], hh, mm, before.get("utc_offset", 0))
        suns.append(sun_position(before["lat"], before["lon"], dt))
    return dict(before=before, after=after, hero=hero, sb=sb, sa=sa, obvious=obvious,
                eb=eb, ea=ea, eo=eo, R=R, bld=bld, roads=roads, stops=stops, suns=suns,
                tl=[f"{h:02d}:{m:02d}" for h, m in engine.times(before, 15)])


# ------------------------------------------------------------------ helpers
def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def seg(t, a, b):
    return ease((t - a) / (b - a))


def lerp(a, b, u):
    return a + (b - a) * u


def frame_at(arr, s):
    """Blend between 15-min frames; s in [0, n-1]."""
    s = min(max(s, 0), len(arr) - 1)
    i = int(math.floor(s))
    j = min(i + 1, len(arr) - 1)
    f = s - i
    return arr[i] * (1 - f) + arr[j] * f


def camera(t):
    """(cx, cy, width) in local metres."""
    if t < 7:
        u = seg(t, 0, 7)
        return (lerp(-20, 0, u), lerp(10, 0, u), lerp(720, 560, u))
    if t < 10:
        u = seg(t, 7, 10)
        w = math.exp(lerp(math.log(560), math.log(38), u))
        return (lerp(0.0, -6.0, u), 0.0, w)
    if t < 17:
        return (-6.0, 0.0, 38.0)
    u = seg(t, 17, 18.2)
    return (lerp(-6.0, 5.0, u), lerp(0, 0.5, u), 38.0)


def txt(fig, x, y, s, size=14, color=TXT, alpha=1.0, **kw):
    kw.setdefault("family", MONO)
    return fig.text(x, y, s, fontsize=size, color=color, alpha=max(0, min(1, alpha)), **kw)


def hud_frame(fig, t):
    ax = fig.add_axes([0, 0, 1, 1], facecolor="none")
    ax.set_xlim(0, W)
    ax.set_ylim(0, H)
    ax.axis("off")
    # corner brackets
    L = 40
    for (x, y, dx, dy) in ((24, 24, 1, 1), (W - 24, 24, -1, 1), (24, H - 24, 1, -1), (W - 24, H - 24, -1, -1)):
        ax.plot([x, x + dx * L], [y, y], color=CYAN, lw=1.2, alpha=0.8)
        ax.plot([x, x], [y, y + dy * L], color=CYAN, lw=1.2, alpha=0.8)
    # ticks along top and bottom
    xs = np.arange(80, W - 80, 40)
    segs = [[(x, H - 30), (x, H - 30 - (8 if i % 5 == 0 else 4))] for i, x in enumerate(xs)]
    segs += [[(x, 30), (x, 30 + (8 if i % 5 == 0 else 4))] for i, x in enumerate(xs)]
    ax.add_collection(LineCollection(segs, colors=DIM, linewidths=0.8, alpha=0.7))
    # scan lines
    yl = np.arange(0, H, 4)
    ax.add_collection(LineCollection([[(0, y), (W, y)] for y in yl], colors="#000000",
                                     linewidths=0.6, alpha=0.18))
    # moving scan band
    yb = (t * 260) % (H + 200) - 100
    ax.axhspan(yb, yb + 60, color=CYAN, alpha=0.025, lw=0)
    txt(fig, 0.985, 0.955, f"T+{t:05.2f}s  ·  FRAME {int(t * FPS):04d}", 10, DIM, ha="right")
    return ax


def draw_map(ax, cam, t, light_stops=1.0, map_alpha=1.0):
    cx, cy, w = cam
    h = w * H / W
    ax.set_xlim(cx - w / 2, cx + w / 2)
    ax.set_ylim(cy - h / 2, cy + h / 2)
    ax.set_facecolor(BG)
    ax.axis("off")
    lw_scale = min(1.6, max(0.5, 300 / w))
    # grid ticks (metric grid)
    g = 100 if w > 200 else (10 if w > 30 else 5)
    gxs = np.arange(math.floor((cx - w / 2) / g) * g, cx + w / 2 + g, g)
    gys = np.arange(math.floor((cy - h / 2) / g) * g, cy + h / 2 + g, g)
    gl = [[(x, cy - h), (x, cy + h)] for x in gxs] + [[(cx - w, y), (cx + w, y)] for y in gys]
    ax.add_collection(LineCollection(gl, colors="#0f2230", linewidths=0.7, zorder=0))
    # roads
    major = {"primary", "secondary", "tertiary", "trunk", "primary_link", "secondary_link"}
    segs_major = [r for r, k in D["roads"] if k in major]
    segs_minor = [r for r, k in D["roads"] if k not in major]
    ax.add_collection(LineCollection(segs_minor, colors="#1d3a4a", linewidths=0.8 * lw_scale,
                                     alpha=map_alpha, zorder=1))
    ax.add_collection(LineCollection(segs_major, colors="#2f6f86", linewidths=1.6 * lw_scale,
                                     alpha=map_alpha, zorder=1))
    # buildings: offset "extrusion" + outline
    off = np.array([0.012, 0.018]) * w * 0.25
    ax.add_collection(PolyCollection([b + off for b in D["bld"]], facecolors="#0a1822",
                                     edgecolors="none", alpha=map_alpha, zorder=2))
    ax.add_collection(PolyCollection(D["bld"], facecolors="#0d1f2b", edgecolors="#3fa9c8",
                                     linewidths=0.5 * lw_scale, alpha=map_alpha, zorder=3))


def sweep_and_stops(ax, t, cam):
    cx, cy, w = cam
    ang = (t / 7.0) * 2 * math.pi * 1.15  # radar sweep from target
    Rr = w
    a0 = math.pi / 2 - ang
    # sweep wedge
    for k in range(12):
        aa = a0 + k * 0.03
        ax.plot([0, Rr * math.cos(aa)], [0, Rr * math.sin(aa)], color=CYAN,
                lw=1.5 if k == 0 else 1.0, alpha=0.5 * (1 - k / 12) ** 2, zorder=5)
    xy = np.array([p for p, _ in D["stops"]])
    if len(xy):
        sa = np.mod(math.pi / 2 - np.arctan2(xy[:, 1], xy[:, 0]), 2 * math.pi)  # clockwise from north
        swept = sa <= ang
        ax.scatter(xy[~swept, 0], xy[~swept, 1], s=8, c=DIM, zorder=6, lw=0)
        ax.scatter(xy[swept, 0], xy[swept, 1], s=46, c=AMBER, zorder=6, lw=0, alpha=0.25)
        ax.scatter(xy[swept, 0], xy[swept, 1], s=12, c=AMBER, zorder=7, lw=0)
    return int(swept.sum()) if len(xy) else 0


def reticle(ax, x, y, r, color=CYAN, alpha=1.0, spin=0.0):
    for k in range(4):
        a = spin + k * math.pi / 2
        th = np.linspace(a + 0.25, a + math.pi / 2 - 0.25, 20)
        ax.plot(x + r * np.cos(th), y + r * np.sin(th), color=color, lw=1.6, alpha=alpha, zorder=9)
    ax.plot([x - r * 1.5, x - r * 0.7], [y, y], color=color, lw=1, alpha=alpha, zorder=9)
    ax.plot([x + r * 0.7, x + r * 1.5], [y, y], color=color, lw=1, alpha=alpha, zorder=9)
    ax.plot([x, x], [y - r * 1.5, y - r * 0.7], color=color, lw=1, alpha=alpha, zorder=9)
    ax.plot([x, x], [y + r * 0.7, y + r * 1.5], color=color, lw=1, alpha=alpha, zorder=9)


def draw_exposure(ax, arr, R, alpha=0.85, z=4):
    m = np.ma.masked_invalid(arr)
    ax.imshow(m, origin="lower", extent=(-R, R, -R, R), cmap=THERM, vmin=0, vmax=1,
              alpha=alpha, interpolation="bilinear", zorder=z)


def draw_stop(ax, scene, alpha=1.0, props=None, prop_color=GREEN):
    wa = np.array(scene["waiting_area"])
    ax.add_patch(MPoly(wa, closed=True, fill=False, ec=CYAN, lw=2.0, ls="--", alpha=alpha, zorder=8))
    roof = next(o for o in scene["occluders"] if o["kind"] == "shelter_roof")
    ax.add_patch(MPoly(np.array(footprint(roof)), closed=True, fill=False, ec="#9fb8c4", lw=1.2,
                       alpha=alpha * 0.8, zorder=8))
    for o in scene["occluders"]:
        if o["kind"] == "tree":
            ax.add_patch(Circle(o["center"], o["radius"], fill=False, ec="#6fdc8c", lw=1.0,
                                alpha=alpha * 0.6, zorder=8))
    for p in props or []:
        fp = np.array(footprint(p))
        ax.add_patch(MPoly(fp, closed=True, fc=prop_color, ec=prop_color, lw=2.2, alpha=alpha * 0.22, zorder=8))
        ax.add_patch(MPoly(fp, closed=True, fill=False, ec=prop_color, lw=2.2, alpha=alpha, zorder=8))


def compass(fig, rect, az, el, alpha=1.0):
    ax = fig.add_axes(rect, facecolor="none")
    ax.set_xlim(-1.4, 1.4)
    ax.set_ylim(-1.4, 1.4)
    ax.set_aspect("equal")
    ax.axis("off")
    th = np.linspace(0, 2 * np.pi, 120)
    ax.plot(np.cos(th), np.sin(th), color=CYAN, lw=1, alpha=0.7 * alpha)
    ax.plot(0.5 * np.cos(th), 0.5 * np.sin(th), color=DIM, lw=0.6, alpha=0.6 * alpha)
    for k in range(36):
        a = math.radians(k * 10)
        r0 = 0.9 if k % 9 else 0.8
        ax.plot([r0 * math.sin(a), math.sin(a)], [r0 * math.cos(a), math.cos(a)], color=CYAN, lw=0.6,
                alpha=0.6 * alpha)
    for lab, a in (("N", 0), ("E", 90), ("S", 180), ("W", 270)):
        ax.text(1.22 * math.sin(math.radians(a)), 1.22 * math.cos(math.radians(a)), lab, ha="center",
                va="center", fontsize=10, color=TXT, family=MONO, alpha=alpha)
    r = 1 - el / 90.0
    a = math.radians(az)
    sx, sy = r * math.sin(a), r * math.cos(a)
    ax.plot([0, sx], [0, sy], color=AMBER, lw=2, alpha=alpha)
    ax.scatter([sx], [sy], s=120, c=AMBER, alpha=alpha, zorder=5)
    ax.scatter([sx], [sy], s=420, c=AMBER, alpha=0.2 * alpha, zorder=4)
    return ax


def colorbar(fig, rect, alpha=1.0, label="direct-sun exposure · ray-cast at 1.2 m"):
    if alpha < 0.03:
        return
    ax = fig.add_axes(rect, facecolor="none")
    ax.imshow(np.linspace(0, 1, 256)[None, :], aspect="auto", cmap=THERM, extent=(0, 1, 0, 1), alpha=alpha)
    ax.set_yticks([])
    ax.set_xticks([0, 1])
    ax.set_xticklabels(["shaded", "full sun"], family=MONO, fontsize=9, color=TXT, alpha=alpha)
    ax.tick_params(colors=DIM, length=3)
    for s in ax.spines.values():
        s.set_color(DIM)
    txt(fig, rect[0], rect[1] + rect[3] + 0.006, label, 10, TXT, alpha)


# ------------------------------------------------------------------ shots
def shot_map_layer(fig, t):
    cam = camera(t)
    ax = fig.add_axes([0, 0, 1, 1])
    draw_map(ax, cam, t)
    return ax, cam


def render(i):
    t = i / FPS
    fig = plt.figure(figsize=(W / DPI, H / DPI), dpi=DPI, facecolor=BG)
    before, after, hero = D["before"], D["after"], D["hero"]
    sb, sa = D["sb"], D["sa"]
    n_t = len(D["tl"])

    if t < 38.0:
        ax, cam = shot_map_layer(fig, t)
        # -- shot 1: scan
        if t < 9.0:
            a1 = 1 - seg(t, 7.5, 9.0)
            if t < 7.6:
                n = sweep_and_stops(ax, t, cam)
            reticle(ax, 0, 0, cam[2] * 0.02, CYAN, a1, spin=t * 0.8)
            ax.text(cam[2] * 0.03, cam[2] * 0.025, "HACKNEY TOWN HALL", color=CYAN, family=MONO, fontsize=15,
                    fontweight="bold", alpha=seg(t, 3.5, 4.5) * a1, zorder=10)
            ax.text(cam[2] * 0.03, cam[2] * 0.008, f"stop {before['id']}  {before['lat']:.5f}, {before['lon']:.5f}",
                    color=TXT, family=MONO, fontsize=10, alpha=seg(t, 4.0, 5.0) * a1, zorder=10)
            txt(fig, 0.04, 0.9, "SHADOWSTOP // AREA SCAN", 30, CYAN, a1, fontweight="bold")
            txt(fig, 0.04, 0.865, "Hackney, London  ·  OpenStreetMap vector data  ·  "
                f"{len(D['bld'])} buildings  ·  {len(D['stops'])} bus stops", 13, TXT, a1)
            if t < 7.6:
                txt(fig, 0.04, 0.83, f"STOPS SWEPT  {n:3d}/{len(D['stops'])}", 13, AMBER, a1)
        # -- shot 2..3: stop close-up with exposure grid
        if t >= 8.0:
            ga = seg(t, 8.6, 10.0)
            if t < 17.0:
                s = lerp(0, n_t - 1, seg(t, 10.0, 16.6) if True else 0)
                arr = frame_at(D["eb"], s)
                cur = int(math.floor(s + 1e-6))
            elif t < 29.0:
                s, arr, cur = None, None, None
            else:
                s, arr, cur = None, None, None
            # shot 3 state machine
            props = []
            stamp = None
            if 17.0 <= t < 29.0:
                if t < 21.0:
                    k = 0
                elif t < 25.0:
                    k = 1
                else:
                    k = 2
                import re as _re
                _ct = [(_re.search(r"at (\d\d:\d\d)", a_.get("reason", "")) or [None, "13:00"])[1] for a_ in D["hero"]["attempts"]]
                if k == 0:
                    cur = D["tl"].index(_ct[0])  # counterexample time recorded in hero.json
                    arr = D["eo"][cur]
                    props = [(D["obvious"], AMBER)]
                elif k == 1:
                    cur = D["tl"].index(_ct[1])
                    arr = D["eb"][cur]
                else:
                    cur = D["tl"].index("13:00")
                    arr = D["ea"][cur]
                    props = [(after["proposals"][0], GREEN)]
            if t >= 29.0:
                cur = D["tl"].index("13:00")
                arr = D["ea"][cur]
                props = [(after["proposals"][0], GREEN)]
            draw_exposure(ax, arr, D["R"], alpha=0.72 * ga)
            left_scrim(fig, ga)
            draw_stop(ax, before, alpha=ga)
            for p, c in props:
                draw_stop_prop(ax, p, c, ga)
            az, el = D["suns"][cur]
            if t < 17.0:
                ax.text(-1.0, -4.6, "waiting area", color=CYAN, family=MONO, fontsize=11, alpha=ga, zorder=10,
                        ha="center")
            if t < 29.0:
                txt(fig, 0.04, 0.9, "HACKNEY TOWN HALL (MARE STREET)", 26, CYAN, ga, fontweight="bold")
                txt(fig, 0.04, 0.865, f"{before['date']}  ·  9 to 18 h local  ·  15-min steps  ·  "
                    "NOAA sun + ray casting", 13, TXT, ga)
                clock_box(fig, D["tl"][cur], az, el, ga)
                colorbar(fig, [0.04, 0.07, 0.22, 0.02], ga)
            if t < 17.0:
                row = sb["by_time"][cur]
                txt(fig, 0.04, 0.60, "SHADED NOW", 12, DIM, ga)
                txt(fig, 0.04, 0.545, f"{row['shade'] * 100:.0f}%", 40, AMBER, ga, fontweight="bold")
                txt(fig, 0.04, 0.515, "of waiting area at 1.2 m", 11, TXT, ga)
                bA = seg(t, 13.0, 14.0)
                txt(fig, 0.04, 0.44, "BEFORE", 13, DIM, bA)
                txt(fig, 0.04, 0.39, f"{sb['score'] * 100:.0f}%", 44, RED, bA, fontweight="bold")
                txt(fig, 0.04, 0.36, "of waiting-area hours shaded", 11, TXT, bA)
            if 17.0 <= t < 29.0:
                agent_panel(fig, t)
        if t >= 29.0:
            split_screen(fig, t)
        txt(fig, 0.985, 0.04, OSM_CREDIT, 10, TXT, 0.8, ha="right")
    if t >= 37.0:
        end_card(fig, t)
    hud_frame(fig, t)
    path = os.path.join(D["frames"], f"f_{i:05d}.png")
    fig.savefig(path, dpi=DPI, facecolor=BG)
    plt.close(fig)
    return path


def left_scrim(fig, a):
    sx = fig.add_axes([0, 0, 1, 1], facecolor="none")
    sx.axis("off")
    g = np.linspace(1, 0, 256)[None, :] ** 1.5
    rgba = np.zeros((1, 256, 4))
    rgba[..., :3] = matplotlib.colors.to_rgb(BG)
    rgba[..., 3] = g * 0.9 * a
    sx.imshow(rgba, extent=(0, 0.42, 0, 1), aspect="auto", zorder=0)
    sx.set_xlim(0, 1)
    sx.set_ylim(0, 1)


def draw_stop_prop(ax, p, c, a):
    fp = np.array(footprint(p))
    ax.add_patch(MPoly(fp, closed=True, fc=c, ec=c, lw=0, alpha=a * 0.18, zorder=8))
    ax.add_patch(MPoly(fp, closed=True, fill=False, ec=c, lw=2.4, alpha=a, zorder=9))


def clock_box(fig, tl, az, el, a):
    txt(fig, 0.04, 0.75, "LOCAL TIME", 12, DIM, a)
    txt(fig, 0.04, 0.685, tl, 52, TXT, a, fontweight="bold")
    compass(fig, [0.17, 0.66, 0.12, 0.13 * 16 / 9 * 0.6], az, el, a)
    txt(fig, 0.17, 0.645, f"SUN az {az:5.1f}°  el {el:4.1f}°", 12, AMBER, a)


def typed(s, t, t0, cps=70):
    n = int(max(0, (t - t0) * cps))
    return s[:n]


def agent_panel(fig, t):
    a = seg(t, 17.0, 18.0)
    att = D["hero"]["attempts"]
    px, pw = 0.60, 0.375
    bg = fig.add_axes([px, 0.08, pw, 0.84])
    bg.set_xlim(0, 1)
    bg.set_ylim(0, 1)
    bg.axis("off")
    bg.add_patch(FancyBboxPatch((0, 0), 1, 1, boxstyle="square,pad=0", fc="#06101a", ec=CYAN, lw=1,
                                alpha=0.92 * a, transform=bg.transAxes))
    txt(fig, px + 0.015, 0.885, "AGENT LOOP", 22, CYAN, a, fontweight="bold")
    txt(fig, px + 0.015, 0.858, "RECORDED RUN · replay  ·  Argon proposes, verifier decides", 11, AMBER, a)
    starts = [18.0, 21.0, 25.0]
    labels = ["#1 OBVIOUS FIX (baseline)", "#2 ARGON · shade sail", "#3 ARGON · redesign"]
    y = 0.80
    import textwrap
    for k, (at, t0, lab) in enumerate(zip(att, starts, labels)):
        if t < t0:
            break
        active = (k == 2 and t >= t0) or (k < 2 and t < starts[k + 1])
        al = a * (1.0 if active else 0.45)
        txt(fig, px + 0.015, y, lab, 15, TXT, al, fontweight="bold")
        y_lab = y
        y -= 0.03
        meta = f"{at['material_label']}  ·  £{at['cost_gbp']:,.0f} indicative  ·  shade {at['score_after'] * 100:.0f}%"
        txt(fig, px + 0.015, y, typed(meta, t, t0 + 0.2, 90), 11, TXT, al)
        y -= 0.028
        reason = "verifier: " + at["reason"]
        for line in textwrap.wrap(typed(reason, t, t0 + 0.9, 80), 58):
            txt(fig, px + 0.015, y, line, 11, RED if not at["accepted"] else GREEN, al)
            y -= 0.024
        if k == 1 and active:
            txt(fig, px + 0.015, y, "(footprint of this attempt was not recorded)", 10, DIM, al)
            y -= 0.024
        st = seg(t, t0 + 1.8, t0 + 2.1)
        if st > 0:
            stamp = "ACCEPTED · verifier" if at["accepted"] else "REJECTED"
            col = GREEN if at["accepted"] else RED
            fig.text(px + pw - 0.02, y_lab, stamp, family=MONO, fontsize=16, color=col, alpha=al * st,
                     ha="right", fontweight="bold",
                     bbox=dict(boxstyle="square,pad=0.3", fc="none", ec=col, lw=2, alpha=al * st))
            if active:
                big = "ACCEPTED" if at["accepted"] else "REJECTED"
                fig.text(0.31, 0.22, big, family=MONO, fontsize=48, color=col, alpha=st * 0.9, ha="center",
                         fontweight="bold", rotation=0 if at["accepted"] else 6,
                         bbox=dict(boxstyle="square,pad=0.25", fc="none", ec=col, lw=3, alpha=st * 0.9))
        y -= 0.05


def split_screen(fig, t):
    a = seg(t, 29.0, 30.0)
    before, sb, sa = D["before"], D["sb"], D["sa"]
    n_t = len(D["tl"])
    shade = fig.add_axes([0, 0, 1, 1])
    shade.axis("off")
    shade.add_patch(FancyBboxPatch((0, 0), 1, 1, boxstyle="square,pad=0", fc=BG, alpha=0.93 * a,
                                   transform=shade.transAxes))
    s = lerp(0, n_t - 1, seg(t, 30.0, 36.5))
    cur = int(math.floor(s + 1e-6))
    for j, (arr, name, col, scn, props) in enumerate(((D["eb"], "BEFORE", RED, before, []),
                                                       (D["ea"], "AFTER · accepted design", GREEN,
                                                        before, D["after"]["proposals"]))):
        x0 = 0.04 + j * 0.31
        ax = fig.add_axes([x0, 0.37, 0.29, 0.29 * 16 / 9 * 0.75])
        ax.set_facecolor(BG)
        ax.set_xlim(-9, 9)
        ax.set_ylim(-9 * 0.75, 9 * 0.75)
        ax.set_xticks([])
        ax.set_yticks([])
        for sp in ax.spines.values():
            sp.set_color(col)
            sp.set_alpha(a)
        draw_exposure(ax, frame_at(arr, s), D["R"], alpha=a, z=2)
        draw_stop(ax, scn, alpha=a)
        for p in props:
            draw_stop_prop(ax, p, GREEN, a)
        txt(fig, x0, 0.37 + 0.29 * 16 / 9 * 0.75 + 0.012, name, 15, col, a, fontweight="bold")
        res = sb if j == 0 else sa
        v = res["by_time"][cur]["shade"]
        txt(fig, x0 + 0.29, 0.37 + 0.29 * 16 / 9 * 0.75 + 0.012, f"{D['tl'][cur]}  shaded {v * 100:3.0f}%", 13,
            TXT, a, ha="right")
    # curves
    cax = fig.add_axes([0.04, 0.08, 0.60, 0.2], facecolor="none")
    xs = np.arange(n_t)
    yb = np.array([r["shade"] for r in sb["by_time"]]) * 100
    ya = np.array([r["shade"] for r in sa["by_time"]]) * 100
    m = cur + 1
    cax.plot(xs[:m], yb[:m], color=RED, lw=2, alpha=a)
    cax.plot(xs[:m], ya[:m], color=GREEN, lw=2, alpha=a)
    cax.fill_between(xs[:m], yb[:m], ya[:m], color=GREEN, alpha=0.08 * a, lw=0)
    cax.axhline(40, color=AMBER, lw=0.8, ls=":", alpha=a)
    cax.text(n_t - 1, 42, "40% worst-moment floor", color=AMBER, fontsize=9, family=MONO, ha="right", alpha=a)
    cax.set_xlim(0, n_t - 1)
    cax.set_ylim(0, 100)
    ticks = [k for k, l in enumerate(D["tl"]) if l.endswith(":00")]
    cax.set_xticks(ticks)
    cax.set_xticklabels([D["tl"][k][:2] for k in ticks], family=MONO, fontsize=9, color=TXT)
    cax.set_yticks([0, 50, 100])
    cax.set_yticklabels(["0%", "50%", "100%"], family=MONO, fontsize=9, color=TXT)
    cax.tick_params(colors=DIM)
    for sp in cax.spines.values():
        sp.set_color(DIM)
    txt(fig, 0.04, 0.29, "waiting area shaded vs local time  (engine.score by_time, 15-min steps)", 11, TXT, a)
    # big numbers
    nb = seg(t, 31.0, 32.0)
    bx = 0.70
    txt(fig, bx, 0.80, "SHADE OVER THE DAY", 13, DIM, a)
    txt(fig, bx, 0.68, f"{sb['score'] * 100:.0f}%", 72, RED, a * nb, fontweight="bold")
    txt(fig, bx + 0.115, 0.70, "→", 48, TXT, a * nb)
    txt(fig, bx + 0.155, 0.68, f"{sa['score'] * 100:.0f}%", 72, GREEN, a * nb, fontweight="bold")
    gain = round(sa["score"] * 100) - round(sb["score"] * 100)
    txt(fig, bx, 0.60, f"+{gain} pts", 34, CYAN, a * seg(t, 32.0, 33.0), fontweight="bold")
    att = D["hero"]["attempts"][-1]
    ca = a * seg(t, 33.0, 34.0)
    txt(fig, bx, 0.52, f"£{att['cost_gbp']:,.0f} indicative  ·  budget £8,000", 15, TXT, ca)
    txt(fig, bx, 0.485, f"{att['material_label']}", 12, TXT, ca)
    st = D["hero"]["stats"]
    txt(fig, bx, 0.43, f"sun hours in waiting area  {st['sun_hours_before']} h → {st['sun_hours_after']} h",
        12, TXT, a * seg(t, 34.0, 35.0))
    txt(fig, bx, 0.30, "ACCEPTED · verifier", 20, GREEN, a * seg(t, 34.5, 35.5), fontweight="bold")
    txt(fig, bx, 0.265, "shade = geometric direct-sun shading at 1.2 m,", 10, DIM, a)
    txt(fig, bx, 0.245, "not air temperature. Costs indicative.", 10, DIM, a)
    colorbar(fig, [0.70, 0.12, 0.22, 0.02], a)


def end_card(fig, t):
    a = seg(t, 37.0, 38.2)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.axis("off")
    ax.add_patch(FancyBboxPatch((0, 0), 1, 1, boxstyle="square,pad=0", fc=BG, alpha=a, transform=ax.transAxes))
    # thin sun-path arcs, real azimuth/elevation of the scene day
    az = np.array([s[0] for s in D["suns"]])
    el = np.array([s[1] for s in D["suns"]])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.plot(0.5 + (az - 180) / 360 * 0.9, 0.12 + el / 90 * 0.4, color=AMBER, lw=1, alpha=0.35 * a)
    a2 = seg(t, 38.0, 39.0)
    txt(fig, 0.5, 0.55, "SHADOWSTOP", 84, CYAN, a2, ha="center", fontweight="bold")
    txt(fig, 0.5, 0.47, "Argon proposes. The verifier decides.", 28, TXT, seg(t, 38.6, 39.6), ha="center")
    txt(fig, 0.5, 0.12, "Every number: deterministic NOAA sun + ray casting.   Map © OpenStreetMap contributors",
        12, DIM, seg(t, 39.2, 40.2), ha="center")
    txt(fig, 0.5, 0.09, "Agent loop shown is a recorded run (replay). Exposure is direct sun, not temperature.",
        11, DIM, seg(t, 39.2, 40.2), ha="center")


def init(d):
    D.update(d)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "shadowstop_film.mp4"))
    ap.add_argument("--frames", default=os.path.join(ROOT, "showcase-tools", "_frames"))
    ap.add_argument("--only", type=str, default=None, help="comma list of seconds to render as stills")
    ap.add_argument("--procs", type=int, default=os.cpu_count() or 4)
    args = ap.parse_args()
    data = prepare()
    print(f"before {data['sb']['score']}  after {data['sa']['score']}  bld {len(data['bld'])} "
          f"stops {len(data['stops'])}", flush=True)
    os.makedirs(args.frames, exist_ok=True)
    data["frames"] = args.frames
    idx = list(range(NF)) if not args.only else [int(float(s) * FPS) for s in args.only.split(",")]
    with Pool(args.procs, initializer=init, initargs=(data,)) as pool:
        for k, _ in enumerate(pool.imap(render, idx, chunksize=4)):
            if k % 100 == 0:
                print("frame", k, flush=True)
    if args.only:
        return
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-r", str(FPS), "-i",
                    os.path.join(args.frames, "f_%05d.png"), "-c:v", "libx264", "-crf", "20",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", args.out], check=True)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
