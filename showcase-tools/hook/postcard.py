"""Diagnosis postcard for the hook film (the money shot).

postcard(t) -> PIL.Image (1336x840 RGB) for t in [0, 5] s.
0-0.6 s: card slides/scales in; 0.4-2.0 s: numbers count up; then hold.
All numbers come from web/assets/hero.json (computed by shadowstop/engine.py).
"""
from __future__ import annotations

import json
import os
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1336, 840
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ASSETS = os.path.join(ROOT, "web", "assets")
REPO_URL = "https://github.com/resenorlando/shadowstop"

INTER = "/usr/share/fonts/opentype/inter/Inter-{}.otf"
SERIF_B = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"

PAPER = (247, 242, 232)
INK = (28, 26, 24)
MUTED = (112, 104, 94)
RULE = (214, 205, 190)
SUN = (214, 88, 40)
SHADE = (32, 128, 96)
TRACK = (229, 221, 207)

# card geometry
CX, CY, CW, CH = 70, 58, 1196, 724
PAD = 34
PH_W = 470  # photo panel width


def _font(weight: str, size: int):
    try:
        return ImageFont.truetype(INTER.format(weight), size)
    except OSError:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", size)


def _serif(size: int):
    return ImageFont.truetype(SERIF_B, size)


@lru_cache(maxsize=1)
def _hero():
    with open(os.path.join(ASSETS, "hero.json")) as f:
        return json.load(f)


def _cover(im: Image.Image, w: int, h: int) -> Image.Image:
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    l, t = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((l, t, l + w, t + h))


@lru_cache(maxsize=1)
def _photo():
    return Image.open(os.path.join(ASSETS, "hackney_mare_street_after.jpg")).convert("RGB")


@lru_cache(maxsize=1)
def _background() -> Image.Image:
    bg = _cover(_photo(), W, H).filter(ImageFilter.GaussianBlur(22))
    dark = Image.new("RGB", (W, H), (8, 8, 10))
    bg = Image.blend(bg, dark, 0.8)
    # vignette
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).ellipse((-W * 0.25, -H * 0.35, W * 1.25, H * 1.35), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(120))
    return Image.composite(bg, dark, mask)


@lru_cache(maxsize=1)
def _qr() -> Image.Image:
    size = 112
    try:
        import segno

        q = segno.make(REPO_URL, error="m")
        mat = list(q.matrix)
        n = len(mat)
        quiet = 2
        cell = size / (n + 2 * quiet)
        im = Image.new("RGB", (size, size), PAPER)
        d = ImageDraw.Draw(im)
        for r, row in enumerate(mat):
            for c, v in enumerate(row):
                if v:
                    x0 = (c + quiet) * cell
                    y0 = (r + quiet) * cell
                    d.rectangle((round(x0), round(y0), round(x0 + cell) - 1, round(y0 + cell) - 1), fill=INK)
        return im
    except Exception:  # fallback: labelled placeholder, not a real code
        im = Image.new("RGB", (size, size), PAPER)
        d = ImageDraw.Draw(im)
        d.rectangle((4, 4, size - 5, size - 5), outline=INK, width=3)
        d.text((size // 2, size // 2), "repo", font=_font("Bold", 20), fill=INK, anchor="mm")
        return im


def _wrap(d, text, font, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if d.textlength(trial, font=font) <= width:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _ease_out(x: float) -> float:
    x = min(max(x, 0.0), 1.0)
    return 1 - (1 - x) ** 3


def _ease_inout(x: float) -> float:
    x = min(max(x, 0.0), 1.0)
    return 3 * x * x - 2 * x * x * x


@lru_cache(maxsize=1)
def _card_static() -> Image.Image:
    """Card with everything that does not animate."""
    h = _hero()
    st = h["stats"]
    card = Image.new("RGBA", (CW, CH), PAPER + (255,))
    d = ImageDraw.Draw(card)
    # subtle paper border
    d.rectangle((10, 10, CW - 11, CH - 11), outline=RULE, width=1)

    # photo panel
    px, py, ph = PAD, PAD, CH - 2 * PAD
    photo = _cover(_photo(), PH_W, ph)
    card.paste(photo, (px, py))
    d.rectangle((px, py, px + PH_W - 1, py + ph - 1), outline=(60, 56, 50), width=1)
    # label chip on photo
    lab = "illustration of the verified design"
    f = _font("Medium", 13)
    tw = d.textlength(lab, font=f)
    chip = Image.new("RGBA", (int(tw) + 26, 28), (12, 12, 14, 190))
    card.alpha_composite(chip, (px + 12, py + 12))
    d.text((px + 25, py + 26), lab, font=f, fill=(240, 236, 228), anchor="lm")
    # credit
    cred = "Mare Street by Cjc13 (CC BY-SA 3.0)"
    f = _font("Regular", 11)
    tw = d.textlength(cred, font=f)
    chip = Image.new("RGBA", (int(tw) + 16, 20), (12, 12, 14, 170))
    card.alpha_composite(chip, (px + PH_W - int(tw) - 16 - 8, py + ph - 28))
    d.text((px + PH_W - 16, py + ph - 18), cred, font=f, fill=(225, 220, 212), anchor="rm")

    # right column
    x0 = PAD + PH_W + 40
    xw = CW - x0 - PAD - 6
    y = PAD + 4
    d.text((x0, y), "SHADOWSTOP  ·  HEAT-SHADE DIAGNOSIS  ·  19 JULY 2026", font=_font("SemiBold", 13), fill=SUN)
    y += 30
    d.text((x0 - 2, y), h["stop"]["name"], font=_serif(46), fill=INK)
    y += 62
    d.text((x0, y), "Mare Street, London E8", font=_font("Medium", 19), fill=MUTED)
    y += 40
    d.line((x0, y, x0 + xw, y), fill=RULE, width=1)
    y += 18
    diag = (
        f"“This stop’s waiting area takes {st['sun_hours_before']} hours of direct sun a day "
        f"(09:00–18:00). On 19 July only {st['shade_before_pct']}% of it is shaded.”"
    )
    fq = _font("Medium", 21)
    for ln in _wrap(d, diag, fq, xw):
        d.text((x0, y), ln, font=fq, fill=INK)
        y += 30
    card.info["stats_y"] = y + 14
    card.info["x0"] = x0
    card.info["xw"] = xw

    # footer: verified fix + accepted + QR
    qr = _qr()
    qs = qr.width
    qx, qy = CW - PAD - qs - 6, CH - PAD - qs - 20
    card.paste(qr, (qx, qy))
    d.text((qx + qs // 2, qy + qs + 10), "scan: code + verifier", font=_font("Medium", 11), fill=MUTED, anchor="mt")

    fy = CH - PAD - 132
    d.line((x0, fy - 14, qx - 24, fy - 14), fill=RULE, width=1)
    fx = _font("SemiBold", 15)
    fr = _font("Regular", 15)
    d.text((x0, fy), "Verified fix", font=fx, fill=INK)
    fix = (f"tensioned shade-sail fabric  ·  £{st['cost_gbp']:,.0f} indicative  ·  "
           f"£{st['gbp_per_shaded_passenger_hour']:.2f} per extra shaded passenger-hour")
    for i, ln in enumerate(_wrap(d, fix, fr, qx - 24 - x0)):
        d.text((x0, fy + 22 + i * 21), ln, font=fr, fill=INK)
    by = fy + 80
    badge = "ACCEPTED"
    fb = _font("Bold", 14)
    bw = int(d.textlength(badge, font=fb)) + 26
    d.rounded_rectangle((x0, by, x0 + bw, by + 28), radius=14, fill=SHADE)
    d.text((x0 + bw // 2, by + 14), badge, font=fb, fill=(255, 255, 255), anchor="mm")
    fa = _font("Medium", 13)
    lines = ["by the deterministic verifier", "designed by Gemini 4 Argon  \u00b7  approved by a human"]
    for i, ln in enumerate(lines):
        d.text((x0 + bw + 12, by + 14 + (i - (len(lines) - 1) / 2) * 18), ln, font=fa, fill=MUTED, anchor="lm")
    return card


def _draw_stats(card: Image.Image, k_before: float, k_after: float) -> None:
    st = _hero()["stats"]
    d = ImageDraw.Draw(card)
    x0, xw, y = card.info["x0"], card.info["xw"], card.info["stats_y"]
    rows = [
        ("WAITING AREA SHADED", st["shade_before_pct"], st["shade_after_pct"], 100, "{:.0f}%", True),
        ("DIRECT SUN, 09:00–18:00", st["sun_hours_before"], st["sun_hours_after"], 9, "{:.1f} h", False),
        ("SUN IN A 10-MIN WAIT", st["wait10_sun_min_before"], st["wait10_sun_min_after"], 10, "{:.1f} min", False),
    ]
    fl = _font("SemiBold", 12)
    fbig = _font("Bold", 30)
    fsm = _font("Medium", 15)
    for label, b, a, full, fmt, good_up in rows:
        bv = b * k_before
        av = b + (a - b) * k_after
        d.text((x0, y), label, font=fl, fill=MUTED)
        # numbers: before -> after
        tb = fmt.format(bv)
        d.text((x0, y + 18), tb, font=fbig, fill=SUN)
        bx = x0 + d.textlength(tb, font=fbig) + 12
        if k_after > 0:
            alpha_col = SHADE
            d.text((bx, y + 34), "→", font=_font("Medium", 24), fill=MUTED, anchor="lm")
            d.text((bx + 34, y + 18), fmt.format(av), font=fbig, fill=alpha_col)
        # bar meter on the right
        mx = x0 + 300
        mw = xw - 300
        for j, (val, col, tag) in enumerate(((bv, SUN, "before"), (av if k_after > 0 else 0, SHADE, "after"))):
            yy = y + 20 + j * 16
            d.rounded_rectangle((mx, yy, mx + mw, yy + 8), radius=4, fill=TRACK)
            fw = max(0, min(1, val / full)) * mw
            if fw > 2:
                d.rounded_rectangle((mx, yy, mx + fw, yy + 8), radius=4, fill=col)
        d.text((mx + mw, y), "before / after", font=_font("Regular", 11), fill=MUTED, anchor="ra")
        y += 84


def postcard(t: float) -> Image.Image:
    t = max(0.0, min(5.0, float(t)))
    bg = _background()
    fade = _ease_out(t / 0.4)
    frame = Image.blend(Image.new("RGB", (W, H), (0, 0, 0)), bg, fade)

    card = _card_static().copy()
    card.info.update(_card_static().info)
    _draw_stats(card, _ease_inout((t - 0.4) / 0.8), _ease_inout((t - 1.0) / 1.0))

    e = _ease_out(t / 0.6)
    s = 0.9 + 0.1 * e
    dy = (1 - e) * 60
    cw, ch = round(CW * s), round(CH * s)
    cimg = card if s >= 0.999 else card.resize((cw, ch), Image.LANCZOS)
    ox = round(W / 2 - cw / 2)
    oy = round(CY + CH / 2 - ch / 2 + dy)

    # soft drop shadow
    sh = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sh).rectangle((ox + 6, oy + 18, ox + cw + 6, oy + ch + 18), fill=int(200 * e))
    sh = sh.filter(ImageFilter.GaussianBlur(22))
    frame = Image.composite(Image.new("RGB", (W, H), (0, 0, 0)), frame, sh)

    if e < 1:
        a = cimg.getchannel("A").point(lambda v: int(v * min(1.0, e * 1.4)))
        cimg = cimg.copy()
        cimg.putalpha(a)
    frame.paste(cimg.convert("RGB"), (ox, oy), cimg.getchannel("A"))
    return frame


if __name__ == "__main__":
    import sys

    out = sys.argv[1] if len(sys.argv) > 1 else "."
    for tt in (0.3, 1.5, 4.0):
        postcard(tt).save(os.path.join(out, f"postcard_{tt:.1f}.png"))
