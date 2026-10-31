"""Hook film, part 1: the hook (0 to 7.0 s).

frame_intro(t) -> 1920x1080 RGB frame. Every number is real: hero.json (recorded
verifier output) and the OSM cache counts (599 buildings, 17 bus stops).
Imagery: the map-scan still from docs/shadowstop_film.mp4 (~5.5 s) and the real
Mare Street photo (credited).
"""
import json
import pathlib
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

INTRO_LEN = 7.0
W, H = 1920, 1080
ROOT = pathlib.Path(__file__).resolve().parents[2]
MX, MY, MW, MH = 552, 96, 1336, 840

BG = (8, 9, 11)
PANEL = (16, 17, 20)
AMBER = (255, 159, 67)
CYAN = (90, 220, 255)
RED = (255, 84, 84)
GREEN = (80, 230, 140)
TEXT = (225, 228, 232)
DIM = (110, 116, 124)

HERO = json.loads((ROOT / "web/assets/hero.json").read_text())
STATS = HERO["stats"]
BY_TIME = HERO["before"]["by_time"]
CREDIT = HERO["photo_credit"]
N_STOPS, N_BUILDINGS = 17, 599

HOOK = ("gemini 4 argon scans every bus stop in london, finds the ones that leave people "
        "standing in full sun, and designs shade a physics verifier proves works.")

_INTER = "/usr/share/fonts/opentype/inter/"
_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
_MONOB = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
_SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
_fc = {}


def F(path, size):
    k = (path, size)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(path, size)
    return _fc[k]


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def ease_io(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def seg(t, a, b):
    return clamp((t - a) / (b - a))


# ---------------------------------------------------------------- assets
_assets = {}


def _map_still():
    if "map" not in _assets:
        p = pathlib.Path(tempfile.gettempdir()) / "shadowstop_intro_map_5p5.png"
        if not p.exists():
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", "5.5", "-i",
                            str(ROOT / "docs/shadowstop_film.mp4"), "-frames:v", "1", str(p)],
                           check=True)
        _assets["map"] = Image.open(p).convert("RGB")
    return _assets["map"]


def _photo():
    if "photo" not in _assets:
        im = Image.open(ROOT / "web/assets/hackney_mare_street.jpg").convert("RGB")
        # cover-crop 1920x1440 to the main panel aspect
        h = int(im.width * MH / MW)
        y0 = (im.height - h) // 2
        _assets["photo"] = im.crop((0, y0, im.width, y0 + h)).resize((MW, MH), Image.LANCZOS)
    return _assets["photo"]


STOP_PX = (968, 545)  # reticle position of Hackney Town Hall in the map still


def _map_view(z):
    """Crop of the map still around the stop; z in 0..1 (wide -> close)."""
    m = _map_still()
    cw = 1200 - 330 * z
    ch = cw * MH / MW
    cx, cy = STOP_PX
    box = (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2)
    return m.resize((MW, MH), Image.BICUBIC, box=box), box


def _to_panel(px, py, box):
    x0, y0, x1, y1 = box
    return MX + (px - x0) / (x1 - x0) * MW, MY + (py - y0) / (y1 - y0) * MH


# ---------------------------------------------------------------- chrome
def _wrap(d, text, font, width):
    lines, cur = [], ""
    for w in text.split(" "):
        nxt = (cur + " " + w).strip()
        if d.textlength(nxt, font=font) > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = nxt
    if cur:
        lines.append(cur)
    return lines


def _top(d, t):
    # window dots + breadcrumb, like the inspiration
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        d.ellipse((22 + i * 22, 14, 34 + i * 22, 26), fill=c)
    crumb = "GEMINI 4 ARGON  /  SHADOWSTOP  /  AREA SCAN  ·  HACKNEY, LONDON"
    f = F(_MONO, 15)
    d.text(((W - d.textlength(crumb, font=f)) / 2, 12), crumb, font=f, fill=DIM)
    if int(t * 2) % 2 == 0 or t > 1.0:
        d.ellipse((1806, 15, 1816, 25), fill=RED)
    d.text((1824, 12), "LIVE", font=F(_MONO, 15), fill=DIM)

    # hook text: snaps in word by word, 0.1 .. 1.7 s
    f = F(_INTER + "Inter-SemiBold.otf", 25)
    words = HOOK.split(" ")
    n = int(len(words) * ease(seg(t, 0.1, 1.7)) + 0.999) if t > 0.1 else 0
    full = _wrap(d, HOOK, f, 1830)
    shown = " ".join(words[:n])
    y = 38
    used = 0
    for ln in full:
        part = shown[used:used + len(ln)]
        used += len(ln) + 1
        if part:
            d.text((44, y), part, font=f, fill=TEXT)
            if len(part) < len(ln) and int(t * 8) % 2 == 0:
                x = 44 + d.textlength(part, font=f) + 4
                d.rectangle((x, y + 4, x + 11, y + 28), fill=AMBER)
        y += 32
    # thin rule under top bar
    d.line((0, 88, W, 88), fill=(30, 32, 36))


LOG = [
    (0.20, "$", "shadowstop scan --area 'Hackney, London'", TEXT),
    (0.45, "INFO", "overpass · cache hit · scenes/cache", CYAN),
    (0.70, "OK", f"buildings loaded · {N_BUILDINGS} w/ heights", GREEN),
    (0.95, "OK", f"bus stops found · {N_STOPS}", GREEN),
    (1.20, "INFO", "sun · NOAA · 2026-07-19 · 09:00-18:00", CYAN),
    (1.45, "D", "grid 1.2 m · step 15 min · 37 samples", DIM),
    (2.60, "WARN", "worst stop · Hackney Town Hall", AMBER),
    (2.85, "D", "osm-469771287 · 51.5452, -0.0554", DIM),
    (3.30, "WARN", f"shaded {STATS['shade_before_pct']}% of waiting area", RED),
    (3.55, "WARN", f"direct sun {STATS['sun_hours_before']} h / day", RED),
    (3.80, "WARN", "09:00 · sun az 99° el 34° · 0% shaded", RED),
    (4.60, "INFO", "photo · Mare Street · waiting area", CYAN),
    (5.40, "INFO", "handing to argon · budget £8,000", CYAN),
]


def _log(d, t):
    d.text((32, 100), "shadowstop@argon-4 : ~ %", font=F(_MONO, 14), fill=DIM)
    d.line((32, 124, 528, 124), fill=(30, 32, 36))
    fm, fb = F(_MONO, 14), F(_MONOB, 14)
    y = 134
    for i, (t0, lvl, msg, col) in enumerate(LOG):
        if t < t0:
            break
        a = ease(seg(t, t0, t0 + 0.18))
        def mix(c):
            return tuple(int(BG[k] + (c[k] - BG[k]) * a) for k in range(3))
        ts = f"16:12:{24 + t0:06.3f}"
        d.text((32, y), ts, font=fm, fill=mix(DIM))
        d.text((158, y), lvl, font=fb, fill=mix(col if lvl != "D" else DIM))
        msg = msg if len(msg) <= 38 else msg[:37] + "…"
        d.text((206, y), msg, font=fm, fill=mix(TEXT if lvl in ("$", "OK", "INFO") else col))
        y += 22
    # cursor
    if int(t * 3) % 2 == 0:
        d.rectangle((32, y + 2, 41, y + 18), fill=TEXT)
    # counters (like SOLD PULLED / FLAGGED)
    sc = int(round(N_STOPS * ease(seg(t, 0.4, 2.4))))
    bc = int(round(N_BUILDINGS * ease(seg(t, 0.4, 2.4))))
    fl = 1 if t > 2.6 else 0
    cols = [("STOPS SCANNED", str(sc), CYAN), ("BUILDINGS", str(bc), CYAN),
            ("FLAGGED", str(fl), RED if fl else DIM)]
    for i, (k, v, c) in enumerate(cols):
        x = 32 + i * 170
        d.text((x, 930), k, font=F(_MONO, 12), fill=DIM)
        d.text((x, 950), v, font=F(_MONOB, 24), fill=c)
    d.text((32, 994), "OpenStreetMap stops + buildings · shade = geometric", font=F(_MONO, 11), fill=DIM)
    d.text((32, 1010), "direct-sun shading at 1.2 m, recorded verifier run", font=F(_MONO, 11), fill=DIM)


def _bottom(d, t):
    d.line((0, 1040, W, 1040), fill=(30, 32, 36))
    f = F(_MONO, 14)
    items = [("HACKNEY TOWN HALL", TEXT), ("Mare Street · osm-469771287", DIM),
             ("2026-07-19 · 09:00-18:00 · 15-min steps", DIM), ("verifier: deterministic", GREEN)]
    x = 32
    for s, c in items:
        d.text((x, 1052), s, font=f, fill=c)
        x += d.textlength(s, font=f) + 40


# ---------------------------------------------------------------- main panel
def _badge(im, t, x, y, a):
    """Inspiration-style badge: label, big number, unit, bar meter (by_time)."""
    if a <= 0:
        return
    bw, bh = 470, 260
    ov = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle((0, 0, bw - 1, bh - 1), 14, fill=(14, 12, 12, 236), outline=(90, 40, 40, 255))
    d.text((24, 20), "MEASURED · WAITING AREA · JULY", font=F(_MONO, 14), fill=DIM)
    k = ease(seg(t, 3.15, 4.0))
    pct = int(round(STATS["shade_before_pct"] * k))
    big = F(_SERIF, 84)
    d.text((22, 40), f"{pct}%", font=big, fill=RED)
    nx = 22 + d.textlength(f"{STATS['shade_before_pct']}%", font=big) + 16
    d.text((nx, 74), "of the waiting area", font=F(_INTER + "Inter-Medium.otf", 22), fill=TEXT)
    d.text((nx, 102), "shaded, 09:00-18:00", font=F(_INTER + "Inter-Medium.otf", 22), fill=TEXT)
    hrs = STATS["sun_hours_before"] * ease(seg(t, 3.5, 4.3))
    d.text((24, 148), f"{hrs:.1f} h of direct sun a day", font=F(_INTER + "Inter-SemiBold.otf", 22), fill=AMBER)
    # bar meter: one bar per 15-min sample; height = unshaded fraction
    n = len(BY_TIME)
    x0, x1, yb, hh = 24, bw - 24, 228, 42
    sw = (x1 - x0) / n
    reveal = seg(t, 3.6, 4.6)
    for i, s in enumerate(BY_TIME):
        on = i / n < reveal
        sun = 1 - s["shade"]
        bx = x0 + i * sw
        col = (RED if sun > 0.85 else AMBER) if on else (40, 40, 44)
        d.rectangle((bx + 1, yb - max(3, hh * sun), bx + sw - 2, yb), fill=col + (255,))
    d.text((x0, yb + 6), "09:00", font=F(_MONO, 11), fill=DIM)
    d.text(((x0 + x1) / 2 - 18, yb + 6), "13:30", font=F(_MONO, 11), fill=DIM)
    d.text((x1 - 36, yb + 6), "18:00", font=F(_MONO, 11), fill=DIM)
    if a < 1:
        al = ov.getchannel("A").point(lambda v: int(v * a))
        ov.putalpha(al)
    dy = int((1 - a) * 24)
    im.paste(ov, (x, y + dy), ov)


def _reticle(d, cx, cy, r, col, w=3):
    d.arc((cx - r, cy - r, cx + r, cy + r), 200, 250, fill=col, width=w)
    d.arc((cx - r, cy - r, cx + r, cy + r), 290, 340, fill=col, width=w)
    d.arc((cx - r, cy - r, cx + r, cy + r), 20, 70, fill=col, width=w)
    d.arc((cx - r, cy - r, cx + r, cy + r), 110, 160, fill=col, width=w)
    L = r * 0.45
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        d.line((cx + dx * (r - L * 0.4), cy + dy * (r - L * 0.4), cx + dx * (r + L), cy + dy * (r + L)),
               fill=col, width=w)


def _chip(d, x, y, label, rest):
    f1, f2 = F(_INTER + "Inter-SemiBold.otf", 17), F(_MONO, 13)
    w = 46 + d.textlength(label, font=f1) + 12 + d.textlength(rest, font=f2) + 18
    d.rounded_rectangle((x, y, x + w, y + 34), 8, fill=(20, 22, 26))
    d.ellipse((x + 16, y + 12, x + 26, y + 22), outline=AMBER, width=2)
    d.text((x + 38, y + 6), label, font=f1, fill=TEXT)
    d.text((x + 38 + d.textlength(label, font=f1) + 12, y + 10), rest, font=f2, fill=DIM)


def _main(im, t):
    d = ImageDraw.Draw(im)
    # phase A: map scan 0.2 .. 4.4 ; phase B: real photo 4.2 .. 6.3 ; then clean panel.
    fade_in = ease(seg(t, 0.15, 0.6))
    z = ease_io(seg(t, 2.3, 3.4))
    if t < 4.6:
        view, box = _map_view(z)
        if fade_in < 1:
            view = Image.blend(Image.new("RGB", view.size, PANEL), view, fade_in)
        im.paste(view, (MX, MY))
        # scan sweep line 0.4 .. 2.4
        st = seg(t, 0.4, 2.4)
        if 0 < st < 1:
            sy = MY + int(MH * ease_io(st))
            ov = Image.new("RGBA", (MW, 90), (0, 0, 0, 0))
            od = ImageDraw.Draw(ov)
            for k in range(90):
                od.line((0, k, MW, k), fill=CYAN + (int(55 * (k / 90) ** 2),))
            im.paste(ov, (MX, sy - 90), ov)
            d.line((MX, sy, MX + MW, sy), fill=CYAN, width=2)
        cx, cy = _to_panel(*STOP_PX, box)
        # reticle lock 2.3 .. 3.0
        if t > 2.3:
            k = ease(seg(t, 2.3, 2.95))
            r = 220 - 150 * k
            col = RED if t > 2.95 else AMBER
            _reticle(d, cx, cy, r, col, 3)
            if t > 2.95:
                pulse = seg(t, 2.95, 3.6)
                rr = 70 + 90 * pulse
                c = tuple(int(PANEL[i] + (RED[i] - PANEL[i]) * (1 - pulse)) for i in range(3))
                d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=c, width=2)
        _chip(d, MX + 16, MY + 16, "area scan" if t < 2.6 else "worst stop",
              "OPENSTREETMAP · 17 STOPS · 599 BUILDINGS" if t < 2.6 else "LOCKED · 15-MIN SUN SWEEP")
        d.text((MX + MW - 290, MY + MH - 26), "Map © OpenStreetMap contributors", font=F(_MONO, 13), fill=DIM)
    if t >= 4.2:
        # cross-cut to the real street photo (fast dissolve)
        a = ease(seg(t, 4.2, 4.6))
        ph = _photo()
        sc = 1.0 + 0.05 * seg(t, 4.2, 6.4)
        w2, h2 = int(MW * sc), int(MH * sc)
        crop = ph.resize((w2, h2), Image.BICUBIC).crop(((w2 - MW) // 2, (h2 - MH) // 2,
                                                         (w2 - MW) // 2 + MW, (h2 - MH) // 2 + MH))
        if a < 1:
            crop = Image.blend(im.crop((MX, MY, MX + MW, MY + MH)), crop, a)
        im.paste(crop, (MX, MY))
        d = ImageDraw.Draw(im)
        # outline the real waiting area
        if t > 4.5:
            pa = ease(seg(t, 4.5, 4.9))
            pts = [(MX + u * MW, MY + (v * 1440 - (1440 - 1920 * MH / MW) / 2) / (1920 * MH / MW) * MH)
                   for u, v in HERO["waiting_area_px"]]
            ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
            od = ImageDraw.Draw(ov)
            od.polygon(pts, fill=RED + (int(70 * pa),), outline=RED + (int(255 * pa),))
            im.paste(ov, (0, 0), ov)
            d = ImageDraw.Draw(im)
        _chip(d, MX + 16, MY + 16, "real photo", "MARE STREET · WAITING AREA OUTLINED")
        ct = CREDIT
        cf = F(_MONO, 13)
        cw = d.textlength(ct, font=cf)
        d.rounded_rectangle((MX + MW - cw - 30, MY + 16, MX + MW - 14, MY + 42), 6, fill=(12, 13, 16))
        d.text((MX + MW - cw - 22, MY + 21), ct, font=cf, fill=(200, 204, 208))
    # vignette bottom for the title
    if t > 2.6:
        ta = ease(seg(t, 2.6, 3.1))
        gh = 240
        grad = Image.new("L", (1, gh))
        grad.putdata([int(235 * ta * (k / gh) ** 1.4) for k in range(gh)])
        ov = Image.new("RGBA", (MW, gh), PANEL + (0,))
        ov.putalpha(grad.resize((MW, gh)))
        im.paste(ov, (MX, MY + MH - gh), ov)
        d = ImageDraw.Draw(im)
        title = "Hackney Town Hall"
        d.text((MX + 30, MY + MH - 128 + int(16 * (1 - ta))), title, font=F(_SERIF, 54),
               fill=tuple(int(PANEL[i] + (TEXT[i] - PANEL[i]) * ta) for i in range(3)))
        d.text((MX + 32, MY + MH - 62), "Mare Street · bus stop · 2026-07-19 · a July heatwave day",
               font=F(_MONO, 14), fill=tuple(int(PANEL[i] + (DIM[i] + 60 - PANEL[i]) * ta) for i in range(3)))
    # badge
    ba = ease(seg(t, 3.0, 3.45))
    _badge(im, t, MX + MW - 470 - 28, MY + MH - 260 - 70, ba)
    # outro: clean frame by 7.0 s
    oa = ease_io(seg(t, 6.3, 6.95))
    if oa > 0:
        cur = im.crop((MX, MY, MX + MW, MY + MH))
        im.paste(Image.blend(cur, Image.new("RGB", cur.size, PANEL), oa), (MX, MY))


def _caption(d, t):
    if t < 0.6:
        return
    if t < 2.6:
        lab, txt = "AGENT SCAN", f"{min(N_STOPS, int(N_STOPS * ease(seg(t, 0.4, 2.4)) + 0.5))} stops swept · sun every 15 min, 09:00-18:00"
    elif t < 6.3:
        lab, txt = "AGENT READ", "people wait here in direct sun"
    else:
        lab, txt = "NEXT", "01 · scan every stop from OpenStreetMap"
    d.text((MX + 16, 968), lab, font=F(_MONO, 15), fill=DIM)
    d.text((MX + 140, 965), txt, font=F(_INTER + "Inter-Medium.otf", 20), fill=TEXT)
    d.text((MX + MW - 330, 968), "direct-sun shading at 1.2 m", font=F(_MONO, 14), fill=DIM)


def _frame_intro_legacy(t: float) -> Image.Image:
    t = clamp(t, 0.0, INTRO_LEN - 1e-6)
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((MX - 2, MY - 2, MX + MW + 1, MY + MH + 1), 10, fill=PANEL, outline=(40, 42, 48))
    _main(im, t)
    d = ImageDraw.Draw(im)
    d.rectangle((MX, 940, MX + MW, 1036), fill=BG)
    d.line((MX, 946, MX + MW, 946), fill=(30, 32, 36))
    _top(d, t)
    _log(d, t)
    _bottom(d, t)
    _caption(d, t)
    return im


# ---------------------------------------------------------------- v2: big hook over a real photo
HOOK2 = ("Hackney Town Hall bus stop: 14% shade on a July day. Gemini 4 Argon designs the fix; "
         "a physics verifier rejects it until it works. A human signs off.")
HOOK_TOP = "Gemini 4 Argon designs shade for London's most sun-exposed bus stops. A physics verifier decides."
AMBER_WORDS = {"14%"}

LOG2 = [
    (0.15, "$ shadowstop scan --area 'Hackney, London'"),
    (0.55, "INFO overpass · cache hit · scenes/cache"),
    (0.95, f"OK buildings loaded · {N_BUILDINGS} w/ heights"),
    (1.35, f"OK bus stops found · {N_STOPS}"),
    (1.75, "INFO sun · NOAA · 2026-07-19 · 09:00-18:00"),
    (2.15, "D grid 1.2 m · step 15 min · 37 samples"),
    (2.60, "WARN worst stop · Hackney Town Hall"),
    (3.00, "D osm-469771287 · 51.5452, -0.0554"),
    (3.40, f"WARN shaded {STATS['shade_before_pct']}% of waiting area"),
    (3.80, f"WARN direct sun {STATS['sun_hours_before']} h / day"),
    (4.20, "WARN 09:00 · sun az 99° el 34° · 0% shaded"),
    (4.70, "INFO photo · Mare Street · waiting area"),
    (5.40, "INFO handing to argon · budget £8,000"),
]

_hook_cache = {}


def _hook_layout():
    if "lay" in _hook_cache:
        return _hook_cache["lay"]
    f = F(_INTER + "Inter-Bold.otf", 46)
    tmp = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    space = tmp.textlength(" ", font=f)
    maxw, lh = 1160, 62
    words, x, y = [], 0, 0
    for w in HOOK2.split(" "):
        ww = tmp.textlength(w, font=f)
        if x > 0 and x + ww > maxw:
            x, y = 0, y + lh
        words.append((w, x, y, ww))
        x += ww + space
    _hook_cache["lay"] = (f, words, y + lh)
    return _hook_cache["lay"]


def _draw_hook(im, t):
    """Big hook over MAIN; words snap in 0.1..1.7 s; settles up and out 3.5..4.1 s."""
    f, words, th = _hook_layout()
    out = ease_io(seg(t, 3.5, 4.1))
    if out >= 1:
        return
    layer = Image.new("RGBA", (1240, th + 20), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    n = len(words)
    for i, (w, x, y, ww) in enumerate(words):
        t0 = 0.1 + 1.6 * i / n
        a = ease(seg(t, t0, t0 + 0.14))
        if a <= 0:
            break
        col = AMBER if w.strip(":.;,") in AMBER_WORDS else (255, 255, 255)
        d.text((x, y + 10 + int(10 * (1 - a))), w, font=f, fill=col + (int(255 * a),))
    # cursor after last shown word while typing
    sc = 1 - 0.45 * out
    if sc < 1:
        layer = layer.resize((int(layer.width * sc), int(layer.height * sc)), Image.LANCZOS)
    if out > 0:
        layer.putalpha(layer.getchannel("A").point(lambda v: int(v * (1 - out))))
    x0 = MX + 72
    y0 = MY + (MH - th) // 2 - 40
    y = int(y0 + (MY + 20 - y0) * out)
    im.paste(layer, (x0, y), layer)


def _main2(im, t):
    ph = _photo()
    sc = 1.0 + 0.07 * seg(t, 0.0, 6.5)
    w2, h2 = int(MW * sc), int(MH * sc)
    ox, oy = (w2 - MW) / 2, (h2 - MH) * 0.6
    view = ph.resize((MW, MH), Image.BICUBIC, box=(ox / sc, oy / sc, (ox + MW) / sc, (oy + MH) / sc))
    dim = 0.68 * (1 - ease_io(seg(t, 3.6, 4.3)))
    fin = ease(seg(t, 0.0, 0.45))
    dark = Image.new("RGB", view.size, BG)
    view = Image.blend(dark, view, max(0.0, min(1.0, fin * (1 - dim))))
    im.paste(view, (MX, MY))
    # waiting area outline (amber) from hero.json, 4.3 .. 4.7
    if t > 4.3:
        pa = ease(seg(t, 4.3, 4.7))
        hh = 1920 * MH / MW  # visible height of source in source px at sc=1
        y_off = (1440 - hh) / 2

        def P(u, v):
            sx, sy = u * MW, (v * 1440 - y_off) / hh * MH
            return MX + sx * sc - ox, MY + sy * sc - oy
        pts = [P(u, v) for u, v in HERO["waiting_area_px"]]
        ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        od.polygon(pts, fill=AMBER + (int(60 * pa),))
        od.line(pts + [pts[0]], fill=AMBER + (int(255 * pa),), width=3)
        im.paste(ov, (0, 0), ov)
    _draw_hook(im, t)
    oa = ease_io(seg(t, 6.3, 6.95))
    if oa > 0:
        cur = im.crop((MX, MY, MX + MW, MY + MH))
        im.paste(Image.blend(cur, Image.new("RGB", cur.size, PANEL), oa), (MX, MY))


def _state(t):
    st = {"step": "00", "caption": "The problem", "log": LOG2}
    if t >= 3.9:
        st["hook"] = HOOK_TOP
    if 0.3 < t < 6.3:
        st["credit"] = CREDIT
    if 4.4 <= t < 6.3:
        st["label"] = "Hackney Town Hall\nMare Street bus stop · 19 July 2026 · waiting area outlined"
    if 4.8 <= t < 6.3:
        k = ease(seg(t, 4.8, 5.4))
        st["badge"] = (f"{int(round(STATS['shade_before_pct'] * k))}%",
                       "of the waiting area shaded", 0.14 * k,
                       f"{STATS['sun_hours_before']} h of direct sun a day · 0% shaded at 09:00")
    st["metrics"] = "stop osm-469771287 · 17 stops · 599 buildings · recorded verifier run"
    return st


def frame_intro(t: float) -> Image.Image:
    t = clamp(t, 0.0, INTRO_LEN - 1e-6)
    try:
        from hook import chrome
    except Exception:
        try:
            import chrome  # type: ignore
        except Exception:
            return _frame_intro_legacy(t)
    im = Image.new("RGB", (W, H), BG)
    im.paste(Image.new("RGB", (MW, MH), PANEL), (MX, MY))
    _main2(im, t)
    out = chrome.draw_chrome(im, t, _state(t))
    return out.convert("RGB")


if __name__ == "__main__":
    sys_path = str(pathlib.Path(__file__).resolve().parents[1])
    import sys as _s
    if sys_path not in _s.path:
        _s.path.insert(0, sys_path)
    import sys
    import time
    out = sys.argv[1] if len(sys.argv) > 1 else "intro_test.mp4"
    t0 = time.time()
    fps = 30
    p = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                          "-s", f"{W}x{H}", "-r", str(fps), "-i", "-", "-c:v", "libx264",
                          "-pix_fmt", "yuv420p", "-crf", "18", out], stdin=subprocess.PIPE)
    n = int(INTRO_LEN * fps)
    for i in range(n):
        p.stdin.write(frame_intro(i / fps).tobytes())
    p.stdin.close()
    p.wait()
    print(f"{n} frames, {(time.time() - t0) / n * 1000:.0f} ms/frame -> {out}")
