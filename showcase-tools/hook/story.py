"""Story sequence (after the 7 s hook): the ShadowStop pipeline in 7 fast beats.

story(t) -> (MAIN panel image 1336x840 RGB, state dict for chrome.draw_chrome).
All numbers come from web/assets/hero.json (recorded verifier run, 2026-07-19).
"""
import math
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
W, H = 1336, 840
BG = (8, 9, 11)
PANEL = (16, 17, 20)
AMBER = (255, 159, 67)
CYAN = (90, 220, 255)
RED = (255, 84, 84)
GREEN = (80, 230, 140)
TEXT = (225, 228, 232)
DIM = (110, 116, 124)

INTER = "/usr/share/fonts/opentype/inter/"
DJV = "/usr/share/fonts/truetype/dejavu/"


def _font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


F_MONO = _font(DJV + "DejaVuSansMono.ttf", 18)
F_MONO_S = _font(DJV + "DejaVuSansMono.ttf", 15)
F_MONO_B = _font(DJV + "DejaVuSansMono-Bold.ttf", 20)
F_MONO_BL = _font(DJV + "DejaVuSansMono-Bold.ttf", 28)
F_BLACK = _font(INTER + "Inter-Black.otf", 92)
F_BLACK_M = _font(INTER + "Inter-Black.otf", 60)
F_BOLD = _font(INTER + "Inter-Bold.otf", 34)
F_SEMI = _font(INTER + "Inter-SemiBold.otf", 24)
F_BANNER = _font(INTER + "Inter-Black.otf", 56)
F_BANNER_S = _font(INTER + "Inter-Black.otf", 48)
F_SERIF = _font(DJV + "DejaVuSerif-Bold.ttf", 54)

PHOTO_CREDIT = "Mare Street by Cjc13 (CC BY-SA 3.0, Wikimedia Commons)"
OSM_CREDIT = "Map © OpenStreetMap contributors"

# ---------------------------------------------------------------- beat table
BEATS = [  # (start, end, step, kind)
    (0.0, 3.0, "01", "scan"),
    (3.0, 6.4, "02", "photo"),
    (6.4, 9.4, "03", "heat"),
    (9.4, 12.2, "04", "v0"),
    (12.2, 15.0, "05", "v1"),
    (15.0, 17.9, "06", "v2"),
    (17.9, 20.4, "07", "approve"),
    (20.4, 23.8, "07", "render"),
    (23.8, 29.0, "07", "card"),
]
STORY_LEN = 29.0
XF = 0.22  # crossfade seconds

# ---------------------------------------------------------------- assets (cached)
_CACHE = {}


def _cover(im, w=W, h=H, fx=0.5, fy=0.5, oversize=1.08):
    """Resize-crop im to cover (w*oversize, h*oversize) around focus (fx, fy)."""
    tw, th = int(w * oversize), int(h * oversize)
    s = max(tw / im.width, th / im.height)
    r = im.resize((max(tw, round(im.width * s)), max(th, round(im.height * s))), Image.LANCZOS)
    cx, cy = fx * r.width, fy * r.height
    x0 = int(min(max(cx - tw / 2, 0), r.width - tw))
    y0 = int(min(max(cy - th / 2, 0), r.height - th))
    return r.crop((x0, y0, x0 + tw, y0 + th))


def _film_still(sec):
    out = os.path.join(tempfile.gettempdir(), f"shadowstop_story_still_{sec}.png")
    if not os.path.exists(out):
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(sec), "-i",
                        os.path.join(ROOT, "docs", "shadowstop_film.mp4"), "-frames:v", "1", out],
                       check=False)
    try:
        return Image.open(out).convert("RGB")
    except Exception:
        im = Image.new("RGB", (1920, 1080), PANEL)
        return im


def _assets():
    if _CACHE:
        return _CACHE
    a = _CACHE
    a["scan"] = _cover(_film_still(5.5), fx=0.0, fy=0.5, oversize=1.0)
    a["heat"] = [_cover(_film_still(s), fx=0.0, fy=0.5, oversize=1.0) for s in (12.0, 13.5, 15.0)]
    photo = Image.open(os.path.join(ROOT, "web/assets/hackney_mare_street.jpg")).convert("RGB")
    after = Image.open(os.path.join(ROOT, "web/assets/hackney_mare_street_after.jpg")).convert("RGB")
    a["photo_size"] = photo.size
    a["photo"] = _cover(photo, fx=0.5, fy=0.62)
    a["after"] = _cover(after.resize(photo.size, Image.LANCZOS), fx=0.5, fy=0.62)
    a["photo_dark"] = Image.blend(a["photo"], Image.new("RGB", a["photo"].size, BG), 0.55)
    a["verify_bg"] = _verify_bg()
    try:
        ui = _cover(Image.open(os.path.join(ROOT, "docs/screenshot.png")).convert("RGB"), oversize=1.0)
    except Exception:
        ui = Image.new("RGB", (W, H), PANEL)
    a["ui_dark"] = Image.blend(ui, Image.new("RGB", ui.size, BG), 0.6)
    try:
        import importlib
        pc = importlib.import_module("hook.postcard")
        test = pc.postcard(0.0)
        a["postcard"] = pc.postcard if test.size == (W, H) else None
    except Exception:
        a["postcard"] = None
    return a


def _photo_xy(px, py):
    """Map original photo pixel coords to MAIN-panel coords of the 'photo' cover crop."""
    pw, ph = _CACHE["photo_size"]
    tw, th = int(W * 1.08), int(H * 1.08)
    s = max(tw / pw, th / ph)
    rw, rh = round(pw * s), round(ph * s)
    x0 = min(max(0.5 * rw - tw / 2, 0), rw - tw)
    y0 = min(max(0.62 * rh - th / 2, 0), rh - th)
    return px * s - x0, py * s - y0


# ---------------------------------------------------------------- helpers
def _ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def _push(im, p, z0=1.0, z1=1.07, fx=0.5, fy=0.5):
    """Subtle push-in: crop a window that shrinks with p, output W x H."""
    z = z0 + (z1 - z0) * p
    cw, ch = im.width / z * (W / im.width) * (im.width / W), im.height / z
    cw = im.width / z
    x0 = (im.width - cw) * fx
    y0 = (im.height - ch) * fy
    return im.resize((W, H), Image.BILINEAR, box=(x0, y0, x0 + cw, y0 + ch))


def _scale_xy(x, y, p, z0, z1, src_w, src_h, fx=0.5, fy=0.5):
    z = z0 + (z1 - z0) * p
    cw, ch = src_w / z, src_h / z
    x0 = (src_w - cw) * fx
    y0 = (src_h - ch) * fy
    return (x - x0) * W / cw, (y - y0) * H / ch


def _txt(d, xy, s, font, fill, anchor="la"):
    d.text(xy, s, font=font, fill=fill, anchor=anchor)


def _tag_box(d, x, y, s, color, font=F_MONO_S, bg=(8, 9, 11, 215)):
    tw = d.textlength(s, font=font)
    d.rectangle((x, y, x + tw + 16, y + 26), fill=bg)
    d.rectangle((x, y, x + 3, y + 26), fill=color)
    d.text((x + 10, y + 4), s, font=font, fill=color)


def _corners(d, box, color, L=22, w=3):
    x0, y0, x1, y1 = box
    for (x, y, sx, sy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        d.line((x, y, x + sx * L, y), fill=color, width=w)
        d.line((x, y, x, y + sy * L), fill=color, width=w)


# ---------------------------------------------------------------- beat 04 background
def _verify_bg():
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    for x in range(0, W, 40):
        d.line((x, 0, x, H), fill=(14, 16, 19))
    for y in range(0, H, 40):
        d.line((0, y, W, y), fill=(14, 16, 19))
    _txt(d, (40, 34), "VERIFIER  //  deterministic · NOAA sun + ray casting @ 1.2 m", F_MONO_B, CYAN)
    _txt(d, (40, 66), "Hackney Town Hall · 2026-07-19 · 09:00–18:00 every 15 min · budget £8,000",
         F_MONO_S, DIM)
    return im


def _sky(d, cx, cy, R, az, el, color, label):
    """Sky dome seen from above: rings = elevation, sun dot at (az, el)."""
    for e in (0, 30, 60):
        r = R * (90 - e) / 90
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(40, 46, 54), width=2)
    d.line((cx - R, cy, cx + R, cy), fill=(32, 36, 42), width=1)
    d.line((cx, cy - R, cx, cy + R), fill=(32, 36, 42), width=1)
    for s, (dx, dy) in (("N", (0, -1)), ("E", (1, 0)), ("S", (0, 1)), ("W", (-1, 0))):
        _txt(d, (cx + dx * (R + 16), cy + dy * (R + 16)), s, F_MONO_S, DIM, "mm")
    r = R * (90 - el) / 90
    a = math.radians(az)
    sx, sy = cx + r * math.sin(a), cy - r * math.cos(a)
    d.line((cx, cy, sx, sy), fill=color, width=3)
    for k, al in ((26, 40), (18, 90)):
        d.ellipse((sx - k, sy - k, sx + k, sy + k), fill=color + (al,))
    d.ellipse((sx - 10, sy - 10, sx + 10, sy + 10), fill=color)
    _txt(d, (cx, cy + R + 46), label, F_MONO_B, color, "mm")


def _stamp(base, text, color, cx, cy, p, angle=-9):
    """Rubber stamp that slams in (scale 1.6 -> 1.0) and rotates."""
    f = F_BLACK
    tw = int(ImageDraw.Draw(base).textlength(text, font=f)) + 70
    th = 140
    st = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    sd = ImageDraw.Draw(st)
    sd.rounded_rectangle((4, 4, tw - 4, th - 4), radius=14, outline=color + (255,), width=8)
    sd.text((tw // 2, th // 2 + 4), text, font=f, fill=color + (255,), anchor="mm")
    sc = 1.0 + 0.6 * (1 - _ease(min(p / 0.35, 1)))
    st = st.resize((int(tw * sc), int(th * sc)), Image.BILINEAR).rotate(angle, expand=True,
                                                                         resample=Image.BILINEAR)
    alpha = min(p / 0.2, 1.0)
    if alpha < 1:
        st.putalpha(st.getchannel("A").point(lambda v: int(v * alpha)))
    base.alpha_composite(st, (int(cx - st.width / 2), int(cy - st.height / 2)))


ATTEMPTS = [
    dict(n="#1", who="obvious fix", design="opaque metal roof", cost="£4,290",
         ok=False, t="09:00", az=99, el=34, shade="0%",
         why="+14 pts is below the +25 pt bar · 09:00 sun slips under the roof",
         banner="REJECTED · 09:00 · sun az 99° el 34° · 0% shaded"),
    dict(n="#2", who="Argon", design="tensioned shade sail", cost="£3,360",
         ok=False, t="18:00", az=271, el=26, shade="13%",
         why="low western sun at 18:00 reaches the waiting area",
         banner="REJECTED · 18:00 · az 271° el 26° · 13% shaded"),
    dict(n="#3", who="Argon redesign", design="tensioned shade-sail fabric", cost="£3,350",
         ok=True, t="09:00–18:00", az=None, el=None, shade="77%",
         why="every 15-min step 09:00–18:00 checked · within £8,000 budget",
         banner="ACCEPTED · 77% shaded · £3,350 indicative"),
]


def _beat_verify(i, p):
    """Attempt i (0, 1, 2), local progress p in [0, 1]."""
    a = _assets()
    at = ATTEMPTS[i]
    im = a["verify_bg"].copy().convert("RGBA")
    d = ImageDraw.Draw(im, "RGBA")
    col = GREEN if at["ok"] else RED
    # left: design card
    x0, y0 = 40, 120
    d.rounded_rectangle((x0, y0, x0 + 600, y0 + 300), radius=12, fill=PANEL, outline=(40, 44, 50), width=2)
    _txt(d, (x0 + 24, y0 + 22), f"DESIGN {at['n']}  ·  {at['who']}", F_MONO_B,
         AMBER if i else DIM)
    _txt(d, (x0 + 24, y0 + 62), at["design"], F_BOLD, TEXT)
    _txt(d, (x0 + 24, y0 + 116), f"{at['cost']} indicative", F_SEMI, TEXT)
    _txt(d, (x0 + 24, y0 + 150), "material catalogue · budget £8,000", F_MONO_S, DIM)
    # checking progress bar (time sweep 09:00 -> 18:00)
    sweep = _ease(min(p / 0.42, 1.0))
    bx, by, bw = x0 + 24, y0 + 214, 552
    _txt(d, (bx, by - 24), "verifier sweep  09:00 → 18:00", F_MONO_S, DIM)
    d.rectangle((bx, by, bx + bw, by + 14), fill=(28, 31, 36))
    if at["ok"]:
        fillw = bw * sweep
    else:
        stop_frac = 0.0 if at["t"] == "09:00" else 1.0
        fillw = bw * max(sweep, 0.02) if stop_frac == 1.0 else bw * min(sweep, 0.02)
    d.rectangle((bx, by, bx + fillw, by + 14), fill=col if sweep >= 1 else CYAN)
    if not at["ok"] and sweep >= 1:
        mx = bx + (0 if at["t"] == "09:00" else bw)
        d.polygon(((mx - 9, by - 14), (mx + 9, by - 14), (mx, by - 2)), fill=RED)
        _txt(d, (mx, by + 40), at["t"], F_MONO_B, RED, "mm")
    # right: sky dome with counterexample sun
    cx, cy, R = 1000, 330, 170
    if at["ok"]:
        # all 37 steps green ticks around ring
        for k in range(37):
            if k / 37 > sweep:
                break
            ang = math.radians(-120 + 240 * k / 36)
            rx, ry = cx + R * math.sin(ang), cy - R * math.cos(ang)
            d.ellipse((rx - 6, ry - 6, rx + 6, ry + 6), fill=GREEN)
        _txt(d, (cx, cy - 10), at["shade"], F_BLACK, GREEN, "mm")
        _txt(d, (cx, cy + 64), "of waiting area shaded", F_MONO_S, TEXT, "mm")
        _txt(d, (cx, cy + R + 46), "37 / 37 sun positions pass", F_MONO_B, GREEN, "mm")
    else:
        lab = f"sun az {at['az']}°  el {at['el']}°" if sweep >= 1 else "sweeping sun positions…"
        if sweep >= 1:
            _sky(d, cx, cy, R, at["az"], at["el"], RED, lab)
        else:
            k = sweep * 37
            az = 99 + (271 - 99) * (k / 36)
            el = 34 + 25 * math.sin(math.pi * k / 36)
            _sky(d, cx, cy, R, az, el, CYAN, lab)
    # big verdict banner across MAIN
    if sweep >= 1:
        q = _ease(min((p - 0.42) / 0.12, 1.0))
        by0 = 470
        d.rectangle((0, by0, W, by0 + 110), fill=(col[0] // 6, col[1] // 6, col[2] // 6, int(235 * q)))
        d.rectangle((0, by0, 10, by0 + 110), fill=col + (int(255 * q),))
        line = at["banner"]
        f = F_BANNER
        if d.textlength(line, font=f) > W - 80:
            f = F_BANNER_S
        _txt(d, (40, by0 + 55), line, f, col + (int(255 * q),), "lm")
        _txt(d, (40, by0 + 140), at["why"], F_MONO, TEXT + (int(255 * q),))
        _txt(d, (40, by0 + 172), "→ sent back to Argon with the counterexample" if not at["ok"]
             else "→ ready for human approval", F_MONO_S, DIM + (int(255 * q),))
        if p > 0.5:
            _stamp(im, "ACCEPTED" if at["ok"] else "REJECTED", col, 1010, 735, (p - 0.5) / 0.5,
                   angle=-6 if at["ok"] else -9)
    # flash on stamp hit
    if sweep >= 1 and 0.5 < p < 0.58:
        fl = Image.new("RGBA", (W, H), col + (int(60 * (1 - (p - 0.5) / 0.08)),))
        im.alpha_composite(fl)
    return im.convert("RGB"), i, p


# ---------------------------------------------------------------- beats
def _beat_scan(lt, dur):
    a = _assets()
    p = lt / dur
    im = _push(a["scan"], _ease(p), 1.0, 1.10, fx=0.55, fy=0.5)
    d = ImageDraw.Draw(im, "RGBA")
    # sweeping scan line
    y = int((lt * 520) % (H + 200)) - 100
    for k in range(60):
        d.line((0, y - k, W, y - k), fill=(90, 220, 255, int(40 * (1 - k / 60))))
    d.line((0, y, W, y), fill=CYAN + (200,), width=2)
    return im


def _vision_overlay(im, lt):
    """Argon's reading of the photo: boxes over the shelter, bus-stop flag, tree."""
    d = ImageDraw.Draw(im, "RGBA")
    items = [
        # (photo box x0,y0,x1,y1), label, color, appear time
        ((700, 868, 1128, 1090), "bus shelter", CYAN, 0.4),
        ((1158, 785, 1218, 1075), "bus stop pole", CYAN, 0.9),
        ((760, 1040, 1180, 1120), "waiting area", AMBER, 1.4),
        ((1040, 370, 1390, 1030), "street tree", GREEN, 2.2),
    ]
    for (bx0, by0, bx1, by1), lab, col, t0 in items:
        if lt < t0:
            continue
        q = _ease((lt - t0) / 0.3)
        x0, y0 = _photo_xy(bx0, by0)
        x1, y1 = _photo_xy(bx1, by1)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        x0, x1 = cx + (x0 - cx) * (1.25 - 0.25 * q), cx + (x1 - cx) * (1.25 - 0.25 * q)
        y0, y1 = cy + (y0 - cy) * (1.25 - 0.25 * q), cy + (y1 - cy) * (1.25 - 0.25 * q)
        d.rectangle((x0, y0, x1, y1), outline=col + (int(255 * q),), width=2)
        d.rectangle((x0, y0, x1, y1), fill=col + (int(22 * q),))
        _corners(d, (x0, y0, x1, y1), col, L=14, w=4)
        if q > 0.5:
            _tag_box(d, int(x0), int(y0) - 30, lab, col)
    # scanning reticle line
    if lt < 0.6:
        x = int(W * lt / 0.6)
        d.line((x, 0, x, H), fill=CYAN + (180,), width=2)
    if lt > 2.6:
        q = _ease((lt - 2.6) / 0.3)
        _tag_box(d, 30, H - 100, "Argon scene reading → corrections to the 3D scene (verifier still decides)",
                 AMBER, font=F_MONO_S, bg=(8, 9, 11, int(230 * q)))
    return im


def _beat_photo(lt, dur):
    a = _assets()
    p = lt / dur
    im = a["photo"].crop((0, 0, W, H)) if a["photo"].size == (W, H) else a["photo"]
    z = 1.0 + 0.05 * _ease(p)
    im = _push(a["photo"], _ease(p), 1.08, 1.08 + 0.06)  # stays within oversize crop
    im = a["photo"].resize((W, H), Image.BILINEAR,
                           box=_zoom_box(a["photo"].size, 1.08 * z, 0.5, 0.62))
    return _vision_overlay(im, lt)


def _zoom_box(size, z, fx, fy):
    w, h = size
    cw, ch = w / z * 1.08, h / z * 1.08
    cw, ch = min(cw, w), min(ch, h)
    x0 = (w - cw) * fx
    y0 = (h - ch) * fy
    return (x0, y0, x0 + cw, y0 + ch)


def _beat_heat(lt, dur):
    a = _assets()
    stills = a["heat"]
    n = len(stills)
    seg = dur / n
    k = min(int(lt / seg), n - 1)
    q = (lt - k * seg) / seg
    im = stills[k]
    if q > 0.8 and k + 1 < n:
        im = Image.blend(stills[k], stills[k + 1], (q - 0.8) / 0.2)
    p = lt / dur
    return _push(im, _ease(p), 1.0, 1.06, fx=0.3, fy=0.45)


def _beat_approve(lt, dur):
    a = _assets()
    im = a["ui_dark"].copy().convert("RGBA")
    d = ImageDraw.Draw(im, "RGBA")
    cx, cy = W // 2, H // 2
    d.rounded_rectangle((cx - 380, cy - 210, cx + 380, cy + 210), radius=16, fill=PANEL + (240,),
                        outline=(48, 52, 60), width=2)
    _txt(d, (cx - 340, cy - 176), "HUMAN APPROVAL REQUIRED", F_MONO_B, AMBER)
    _txt(d, (cx - 340, cy - 130), "Design #3 · shade-sail fabric", F_BOLD, TEXT)
    _txt(d, (cx - 340, cy - 80), "verifier: ACCEPTED · 77% · £3,350 indicative", F_MONO, GREEN)
    _txt(d, (cx - 340, cy - 50), "no export without a person signing off", F_MONO_S, DIM)
    # button
    press = lt > 1.0
    exported = lt > 1.6
    bx0, by0, bx1, by1 = cx - 340, cy + 40, cx + 340, cy + 140
    if press:
        d.rounded_rectangle((bx0, by0, bx1, by1), radius=12, fill=GREEN)
        _txt(d, (cx, (by0 + by1) // 2), "✓  APPROVED" + ("  ·  council brief exported" if exported else ""),
             F_SEMI, BG, "mm")
    else:
        d.rounded_rectangle((bx0, by0, bx1, by1), radius=12, outline=GREEN, width=3)
        _txt(d, (cx, (by0 + by1) // 2), "Approve design", F_SEMI, GREEN, "mm")
    # cursor moving to button
    if exported:
        _tag_box(d, cx - 340, cy + 160, "council_brief_hackney_town_hall.pdf  exported", GREEN)
    q = _ease(min(lt / 0.9, 1.0))
    mx = int(cx + 300 - 260 * q)
    my = int(cy + 300 - 210 * q)
    if press:
        my += 2
    d.polygon(((mx, my), (mx, my + 30), (mx + 8, my + 23), (mx + 14, my + 36), (mx + 19, my + 34),
               (mx + 13, my + 21), (mx + 23, my + 21)), fill=(255, 255, 255), outline=BG)
    if 1.0 < lt < 1.4:
        r = int(20 + 120 * (lt - 1.0) / 0.4)
        d.ellipse((mx - r, my - r, mx + r, my + r), outline=GREEN + (int(255 * (1.4 - lt) / 0.4),), width=3)
    return im.convert("RGB")


def _beat_render(lt, dur):
    a = _assets()
    p = lt / dur
    box = _zoom_box(a["photo"].size, 1.08 * (1.0 + 0.05 * _ease(p)), 0.5, 0.62)
    before = a["photo"].resize((W, H), Image.BILINEAR, box=box)
    after = a["after"].resize((W, H), Image.BILINEAR, box=box)
    # wipe left->right between 0.5 s and 2.2 s, then hold
    w = _ease((lt - 0.5) / 1.7)
    xw = int(W * w)
    im = before.copy()
    if xw > 0:
        im.paste(after.crop((0, 0, xw, H)), (0, 0))
    d = ImageDraw.Draw(im, "RGBA")
    if 0 < xw < W:
        d.line((xw, 0, xw, H), fill=(255, 255, 255), width=4)
        d.ellipse((xw - 18, H // 2 - 18, xw + 18, H // 2 + 18), fill=(255, 255, 255))
        _txt(d, (xw, H // 2), "⇆", F_MONO_B, BG, "mm")
    if xw > 140:
        _tag_box(d, 24, 24, "AFTER · Nano Banana 2.1 illustration of the VERIFIED design", GREEN)
    if xw < W - 260:
        tw = d.textlength("BEFORE · real photo", font=F_MONO_S)
        _tag_box(d, int(W - tw - 44), 24, "BEFORE · real photo", TEXT)
    return im


def _beat_card(lt, dur):
    a = _assets()
    if a.get("postcard"):
        try:
            im = a["postcard"](lt)
            if im.size == (W, H):
                return im.convert("RGB")
        except Exception:
            pass
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im, "RGBA")
    d.rounded_rectangle((40, 40, W - 40, H - 40), radius=18, fill=(236, 232, 222))
    ink = (24, 24, 26)
    _txt(d, (90, 90), "COUNCIL BRIEF · SHADE DIAGNOSIS", F_MONO_B, (150, 90, 30))
    _txt(d, (90, 130), "Hackney Town Hall, Mare Street", F_SERIF, ink)
    _txt(d, (90, 200), "bus stop osm-469771287 · 51.5452, -0.0554 · July day (2026-07-19)", F_MONO_S, (90, 90, 96))
    q = _ease(lt / 1.2)
    rows = [
        ("waiting area shaded", "14%", "77%"),
        ("direct sun on the stop", "7.7 h", "2.1 h"),
    ]
    for k, (lab, b, af) in enumerate(rows):
        y = 280 + k * 150
        _txt(d, (90, y), lab, F_SEMI, (90, 90, 96))
        _txt(d, (90, y + 36), b, F_BLACK_M, (200, 60, 50))
        _txt(d, (300, y + 50), "→", F_BOLD, ink)
        _txt(d, (370, y + 36), af, F_BLACK_M, (30, 140, 80))
        bx = 640
        d.rectangle((bx, y + 60, bx + 560, y + 80), fill=(210, 205, 195))
        frac = (0.14 + (0.77 - 0.14) * q) if k == 0 else (7.7 - (7.7 - 2.1) * q) / 10.4
        d.rectangle((bx, y + 60, bx + 560 * frac, y + 80), fill=(30, 140, 80) if k == 0 else (220, 120, 40))
    _txt(d, (90, 600), "£3,350 indicative  ·  £0.45 per extra shaded passenger-hour", F_BOLD, ink)
    _txt(d, (90, 660), "design #3 shade-sail fabric · verifier ACCEPTED · human approved", F_MONO_S, (90, 90, 96))
    _txt(d, (90, 690), "geometric direct-sun shading at 1.2 m · costs indicative", F_MONO_S, (90, 90, 96))
    return im


# ---------------------------------------------------------------- log + captions
def _build_log():
    import json
    log = [
        (0.05, "osm.fetch     bbox Hackney · overpass"),
        (0.30, "osm.fetch     overpass timeout -> main OSM API"),
        (0.60, "osm.parse     599 buildings (with heights)"),
        (0.85, "osm.parse     17 bus stops · trees"),
        (1.30, "scene.build   osm-469771287 Hackney Town Hall"),
        (1.70, "scene.build   51.5452, -0.0554 · waiting area"),
        (2.20, "engine.score  queued 17 stops"),
        (3.05, "argon.read    hackney_mare_street.jpg"),
        (3.40, "argon.read    shelter · pole · waiting area"),
        (4.00, "argon.read    kerb · street tree"),
        (4.80, "scene.patch   proposals -> 3D scene"),
        (6.45, "engine.sun    NOAA · 2026-07-19 · 15-min steps"),
    ]
    try:
        with open(os.path.join(ROOT, "web/assets/hero.json")) as fh:
            bt = json.load(fh)["before"]["by_time"]
        steps = bt[::3]
        for k, r in enumerate(steps):
            log.append((6.7 + 2.3 * k / max(len(steps) - 1, 1),
                        f"engine.ray    {r['t']} az {r['sun_az']:5.1f} el {r['sun_el']:4.1f}  {r['shade'] * 100:3.0f}%"))
    except Exception:
        pass
    log += [
        (9.2, "engine.score  14% shaded · 7.7 h direct sun"),
        (9.45, "argon.propose #1 opaque metal roof  £4,290"),
        (10.2, "verify        sweep 37 sun positions"),
        (10.9, "verify   #1   REJECTED 09:00 az 99 el 34 -> 0%"),
        (11.3, "verify   #1   +14 pts < +25 pt bar"),
        (12.25, "argon.propose #2 tensioned shade sail  £3,360"),
        (12.6, "argon         previous_interaction_id chained"),
        (13.7, "verify   #2   REJECTED 18:00 az 271 el 26 -> 13%"),
        (15.05, "argon.propose #3 shade-sail redesign  £3,350"),
        (16.0, "verify   #3   37/37 steps · budget £8,000 OK"),
        (16.4, "verify   #3   ACCEPTED 77% shaded"),
        (17.95, "human.review  design #3"),
        (18.9, "human.approve OK"),
        (19.5, "brief.export  council brief"),
        (20.45, "nano_banana   render verified design -> photo"),
        (22.0, "nano_banana   labelled: illustration"),
        (23.85, "brief         14% -> 77% · 7.7 h -> 2.1 h"),
        (24.3, "brief         £3,350 indicative · £0.45/pax-h"),
    ]
    return sorted(log)


LOG = _build_log()

CAPTIONS = {
    "scan": "Scanning 17 Hackney bus stops from OpenStreetMap",
    "photo": "Argon reads the street photo, corrects the 3D scene",
    "heat": "Sun ray-cast every 15 min: 14% shaded",
    "v0": "Obvious metal roof: REJECTED, 0% shaded at 09:00",
    "v1": "Argon's shade sail: REJECTED, 13% at 18:00",
    "v2": "Redesign ACCEPTED: 77% shaded, £3,350 indicative",
    "approve": "Officer approves; council brief exported",
    "render": "Officer approves; Nano Banana draws the verified design",
    "card": "14% → 77% shaded · £0.45 per extra shaded passenger-hour",
}
WHO = {"scan": "OSM", "photo": "ARGON", "heat": "VERIFIER", "v0": "VERIFIER", "v1": "VERIFIER",
       "v2": "VERIFIER", "approve": "HUMAN", "render": "NANO BANANA", "card": "VERIFIER"}


def _render_beat(idx, t):
    s, e, step, kind = BEATS[idx]
    lt, dur = t - s, e - s
    if kind == "scan":
        return _beat_scan(lt, dur)
    if kind == "photo":
        return _beat_photo(lt, dur)
    if kind == "heat":
        return _beat_heat(lt, dur)
    if kind.startswith("v"):
        return _beat_verify(int(kind[1]), lt / dur)[0]
    if kind == "approve":
        return _beat_approve(lt, dur)
    if kind == "render":
        return _beat_render(lt, dur)
    return _beat_card(lt, dur)


def _beat_index(t):
    for i, (s, e, _, _) in enumerate(BEATS):
        if t < e:
            return i
    return len(BEATS) - 1


def story(t):
    t = min(max(float(t), 0.0), STORY_LEN - 1e-3)
    _assets()
    i = _beat_index(t)
    s, e, step, kind = BEATS[i]
    im = _render_beat(i, t)
    if i > 0 and t - s < XF:
        prev = _render_beat(i - 1, s - 1e-3)
        im = Image.blend(prev, im, _ease((t - s) / XF))
    if im.mode != "RGB":
        im = im.convert("RGB")
    p = (t - s) / (e - s)
    state = {
        "step": step,
        "who": WHO[kind],
        "caption": CAPTIONS[kind],
        "log": [(ts, txt) for ts, txt in LOG if ts <= t],
        "progress": t / STORY_LEN,
        "badge": ("14", "% of waiting area shaded", 0.14),
        "label": "Hackney Town Hall",
        "tag": None,
        "credit": None,
    }
    if kind == "scan":
        state["tag"] = "● OpenStreetMap scan · 599 buildings · 17 stops"
        state["credit"] = OSM_CREDIT
        state["label"] = "Hackney, London"
        state["badge"] = ("17", "bus stops scanned", min(p * 1.3, 1.0))
    elif kind == "photo":
        state["tag"] = "● street photo · CC BY-SA · Argon scene reading (pipeline step)"
        state["credit"] = PHOTO_CREDIT
        state["label"] = "Mare Street, E8"
    elif kind == "heat":
        state["tag"] = "● direct-sun exposure · ray-cast at 1.2 m"
        state["credit"] = OSM_CREDIT
        state["badge"] = ("7.7", "hours of direct sun a day", 0.77)
    elif kind in ("v0", "v1", "v2"):
        state["tag"] = "● verifier · recorded run"
        n = int(kind[1])
        hit = p > 0.42
        if n == 0:
            state["badge"] = ("0", "% shaded at 09:00 (design #1)", 0.0) if hit else ("14", "% of waiting area shaded", 0.14)
        elif n == 1:
            state["badge"] = ("13", "% shaded at 18:00 (design #2)", 0.13) if hit else ("14", "% of waiting area shaded", 0.14)
        else:
            state["badge"] = ("77", "% of waiting area shaded", 0.77) if hit else ("14", "% of waiting area shaded", 0.14)
    elif kind == "approve":
        state["tag"] = "● human in the loop"
        state["badge"] = ("77", "% of waiting area shaded", 0.77)
    elif kind == "render":
        state["tag"] = "● Nano Banana 2.1 · illustration of the verified design"
        state["credit"] = PHOTO_CREDIT + " · render: illustration"
        state["badge"] = ("77", "% of waiting area shaded", 0.77)
    elif kind == "card":
        state["tag"] = "● council brief"
        state["label"] = None  # the postcard carries its own address
        state["badge"] = None  # the postcard carries its own numbers
    return im, state


if __name__ == "__main__":
    import sys
    import time
    out = sys.argv[1] if len(sys.argv) > 1 else "story_test.mp4"
    fps = 30
    n = int(STORY_LEN * fps)
    story(0)
    p = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                          "-s", f"{W}x{H}", "-r", str(fps), "-i", "-", "-pix_fmt", "yuv420p",
                          "-c:v", "libx264", "-crf", "20", out], stdin=subprocess.PIPE)
    t0 = time.time()
    worst = 0
    for f in range(n):
        a = time.time()
        im, st = story(f / fps)
        worst = max(worst, time.time() - a)
        assert im.size == (W, H) and im.mode == "RGB"
        assert len(st["caption"]) <= 80, st["caption"]
        p.stdin.write(im.tobytes())
    p.stdin.close()
    p.wait()
    print(f"{n} frames in {time.time() - t0:.1f}s, worst {worst * 1000:.0f} ms")
