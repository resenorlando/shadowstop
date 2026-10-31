"""Agent-console chrome for the ShadowStop hook film.

API:
    draw_chrome(im, t, state) -> im
im is a 1920x1080 RGB frame whose MAIN panel (552,96,1336x840) is already
filled. Everything else (top bar, agent log, frame, overlays inside MAIN,
caption strip, bottom status bar) is drawn here.

state keys (all optional): step, caption, log [(t_start, text)], badge
(value, label, fraction[, sub]), label ("Big serif\nsmall sub line"), tag,
credit, hook, progress (0..1), metrics (str, bottom-right status bar).
Log lines may start with a level word (INFO / D / OK / WARN / ERR); tokens are
coloured automatically: REJECTED red, ACCEPTED/APPROVED green, tool names
cyan, numbers amber.
"""
from __future__ import annotations

import re
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1920, 1080
MX, MY, MW, MH = 552, 96, 1336, 840
LX0, LX1, LY0, LY1 = 32, 528, 96, 1032
CY0, CY1 = 948, 1032

BG = (8, 9, 11)
PANEL = (16, 17, 20)
AMBER = (255, 159, 67)
CYAN = (90, 220, 255)
RED = (255, 84, 84)
GREEN = (80, 230, 140)
TEXT = (225, 228, 232)
DIM = (110, 116, 124)
DIMMER = (62, 66, 72)
LINE = (38, 40, 45)
BLUE = (120, 170, 235)

INTER = "/usr/share/fonts/opentype/inter/"
JB = "/usr/share/fonts/truetype/jetbrains-mono/"
SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"

TYPE_CPS = 90.0
BASE_CLOCK = 16 * 3600 + 12 * 60 + 24.487  # console clock at t=0

STEPS = ["SCAN", "SCENE", "SUN", "DESIGN", "APPROVE", "RENDER", "BRIEF"]


@lru_cache(maxsize=None)
def F(name: str, size: int) -> ImageFont.FreeTypeFont:
    paths = {
        "mono": JB + "JetBrainsMono-Regular.ttf",
        "monob": JB + "JetBrainsMono-Bold.ttf",
        "monom": JB + "JetBrainsMono-Medium.ttf",
        "inter": INTER + "Inter-Regular.otf",
        "interm": INTER + "Inter-Medium.otf",
        "inters": INTER + "Inter-SemiBold.otf",
        "interb": INTER + "Inter-Bold.otf",
        "disp": INTER + "InterDisplay-Bold.otf",
        "serif": SERIF,
        "dmono": "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "black": INTER + "Inter-Black.otf",
    }
    try:
        return ImageFont.truetype(paths[name], size)
    except OSError:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", size)


def clock(t: float, ms: bool = True) -> str:
    s = BASE_CLOCK + t
    h, m = int(s // 3600) % 24, int(s % 3600 // 60)
    sec = s % 60
    return f"{h:02d}:{m:02d}:{sec:06.3f}" if ms else f"{h:02d}:{m:02d}:{int(sec):02d}"


# ---------------------------------------------------------------- fast text
_SPRITES: dict = {}


class FastDraw:
    """ImageDraw wrapper whose text() pastes cached glyph masks (~20x faster)."""

    def __init__(self, im):
        self.im = im
        self.d = ImageDraw.Draw(im)

    def __getattr__(self, k):
        return getattr(self.d, k)

    def text(self, xy, s, font=None, fill=TEXT, anchor=None):
        if not s:
            return
        key = (s, id(font), anchor)
        sp = _SPRITES.get(key)
        if sp is None:
            bb = font.getbbox(s, anchor=anchor or "la")
            w, h = max(1, bb[2] - bb[0]), max(1, bb[3] - bb[1])
            m = Image.new("L", (w, h), 0)
            ImageDraw.Draw(m).text((-bb[0], -bb[1]), s, font=font, fill=255, anchor=anchor or "la")
            sp = (m, bb[0], bb[1])
            if len(_SPRITES) > 20000:
                _SPRITES.clear()
            _SPRITES[key] = sp
        m, ox, oy = sp
        x, y = int(round(xy[0])) + ox, int(round(xy[1])) + oy
        col = tuple(fill[:3])
        self.im.paste(col, (x, y, x + m.width, y + m.height), m)


# ---------------------------------------------------------------- tokenising
LEVELS = {"INFO": BLUE, "D": DIM, "OK": GREEN, "WARN": RED, "ERR": RED, "FAIL": RED}
RED_W = {"REJECTED", "REJECT", "FAIL", "FAILED", "ERROR", "BLOCKED", "WARN"}
GREEN_W = {"ACCEPTED", "APPROVED", "PASS", "PASSED", "OK", "VERIFIED", "DONE"}
TOKEN_RE = re.compile(r"(\s+|[^\s]+)")
NUM_RE = re.compile(r"^[(\[]?[£$+\-−~#]?\d[\d,.:/]*(%|h|m|s|ms|pts?|deg|°|x|k|px|m²)?[)\],;]?$")
TOOL_RE = re.compile(r"^(/api/[\w/\-]+|[a-z][a-z0-9]*(?:[._][a-z0-9]+)+(?:\(\))?|[a-z]+\(\)|gemini-[\w.\-]+|nano-banana[\w.\-]*)[:,]?$")


def tok_color(tok: str, base=TEXT):
    core = tok.strip(".,:;()[]")
    if core.upper() == core and core in RED_W:
        return RED
    if core.upper() == core and core in GREEN_W:
        return GREEN
    if TOOL_RE.match(tok):
        return CYAN
    if NUM_RE.match(tok):
        return AMBER
    if tok in ("·", "|"):
        return DIMMER
    return base


def split_level(text: str):
    head, _, rest = text.partition(" ")
    if head in LEVELS:
        return head, rest
    up = text.upper()
    if "REJECTED" in up:
        return "WARN", text
    if "ACCEPTED" in up or "APPROVED" in up:
        return "OK", text
    return "INFO", text


# ---------------------------------------------------------------- static base
_STATIC: dict = {}


def _rr(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, r, fill=fill, outline=outline, width=width)


def _static_layer() -> Image.Image:
    """Everything that never changes: an RGBA overlay with a hole for MAIN."""
    if "base" in _STATIC:
        return _STATIC["base"]
    L = Image.new("RGBA", (W, H), BG + (255,))
    d = ImageDraw.Draw(L)
    # MAIN hole with rounded corners
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle((MX, MY, MX + MW - 1, MY + MH - 1), 12, fill=255)
    L.putalpha(Image.eval(mask, lambda v: 255 - v))
    d = ImageDraw.Draw(L)
    # top bar
    d.rectangle((0, 0, W, 36), fill=(12, 13, 15, 255))
    d.line((0, 36, W, 36), fill=LINE + (255,))
    d.line((0, 84, W, 84), fill=LINE + (255,))
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        d.ellipse((18 + i * 22, 12, 30 + i * 22, 24), fill=c + (255,))
    # left column panel
    d.line((LX1 + 12, 84, LX1 + 12, 1040), fill=LINE + (255,))
    # bottom bar
    d.rectangle((0, 1040, W, H), fill=(12, 13, 15, 255))
    d.line((0, 1040, W, 1040), fill=LINE + (255,))
    # caption strip
    _rr(d, (MX, CY0, MX + MW - 1, CY1), 10, fill=PANEL + (255,), outline=LINE + (255,))
    # MAIN frame
    d.rounded_rectangle((MX - 1, MY - 1, MX + MW, MY + MH), 13, outline=(72, 52, 40, 255), width=2)
    _STATIC["base"] = L
    # bottom gradient for the label legibility (inside MAIN)
    g = Image.new("L", (1, 300))
    for y in range(300):
        g.putpixel((0, y), int(215 * (y / 299) ** 1.6))
    _STATIC["grad"] = Image.merge("RGBA", [Image.new("L", (MW, 300), 0)] * 3 + [g.resize((MW, 300))])
    tg = Image.new("L", (1, 120))
    for y in range(120):
        tg.putpixel((0, y), int(120 * (1 - y / 119) ** 1.8))
    _STATIC["tgrad"] = Image.merge("RGBA", [Image.new("L", (MW, 120), 0)] * 3 + [tg.resize((MW, 120))])
    return L


# ---------------------------------------------------------------- log column
LOG_FS = 15
LOG_LH = 19
LOG_TOP = 136
LOG_BOT = 878
TS_X = LX0 + 2
LV_X = TS_X + 117
MSG_X = LV_X + 46
MSG_W = LX1 - MSG_X - 4


def _wrap(msg: str, font, width: int, maxlines=3):
    words = msg.split(" ")
    lines, cur = [], ""
    for w_ in words:
        cand = (cur + " " + w_) if cur else w_
        if font.getlength(cand) <= width or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = w_
    lines.append(cur)
    if len(lines) > maxlines:
        lines = lines[:maxlines]
        lines[-1] = lines[-1][: max(0, len(lines[-1]) - 2)] + " …"
    return lines


@lru_cache(maxsize=4096)
def _line_parts(text: str):
    lvl, msg = split_level(text)
    return lvl, _wrap(msg, F("dmono", LOG_FS), MSG_W)


def _draw_tokens(d, x, y, s, font, base=TEXT):
    for tok in TOKEN_RE.findall(s):
        if not tok.isspace():
            d.text((x, y), tok, font=font, fill=tok_color(tok, base))
        x += font.getlength(tok)
    return x


def _draw_log(im, d, t, log):
    font = F("dmono", LOG_FS)
    # build rows: (row_text_parts) for visible entries
    rows = []  # (kind, ...)
    typing_row = None
    for i, (t0, text) in enumerate(sorted(log, key=lambda e: e[0])):
        if t0 > t:
            break
        lvl, wrapped = _line_parts(text)
        total = sum(len(s) for s in wrapped)
        n = int((t - t0) * TYPE_CPS) + 1
        shown = min(n, total)
        rem = shown
        for j, seg in enumerate(wrapped):
            if rem <= 0 and j > 0:
                break
            part = seg[: max(0, rem)]
            rem -= len(seg)
            rows.append((t0 if j == 0 else None, lvl if j == 0 else None, part, shown < total))
        if shown < total:
            typing_row = len(rows) - 1
    max_rows = (LOG_BOT - LOG_TOP) // LOG_LH
    rows = rows[-max_rows:]
    if typing_row is not None:
        typing_row = len(rows) - 1
    # rows pinned to the bottom like a terminal; fade the oldest few
    y = LOG_BOT - len(rows) * LOG_LH
    for k, (t0, lvl, part, typing) in enumerate(rows):
        age_fade = 1.0 if len(rows) < max_rows else min(1.0, 0.35 + k * 0.16)
        def fc(c):
            return tuple(int(BG[i] + (c[i] - BG[i]) * age_fade) for i in range(3))
        if t0 is not None:
            d.text((TS_X, y), clock(t0), font=font, fill=fc(DIM))
            d.text((LV_X, y), lvl, font=font, fill=fc(LEVELS.get(lvl, DIM)))
        if age_fade < 1:
            d.text((MSG_X, y), part, font=font, fill=fc(TEXT))
        else:
            x = _draw_tokens(d, MSG_X, y, part, font)
            if typing and k == len(rows) - 1:
                d.rectangle((x + 1, y + 2, x + 8, y + 16), fill=AMBER)
        y += LOG_LH
    # prompt line with blinking cursor
    yp = LOG_BOT + 6
    d.text((TS_X, yp), "$", font=font, fill=DIM)
    if typing_row is None and int(t * 2) % 2 == 0:
        d.rectangle((TS_X + 14, yp + 2, TS_X + 21, yp + 16), fill=TEXT)
    return rows


def _counters(d, t, log, over=None):
    vis = " ".join(txt for t0, txt in log if t0 <= t).upper()
    tried = vis.count("PROPOSE_FIX")
    appr = vis.count("APPROVED")
    scanned = "17" if ("SCAN" in vis or "STOP" in vis) else "0"
    blds = "599" if ("BUILDING" in vis or "599" in vis) else "0"
    vals = {"STOPS SCANNED": scanned, "BUILDINGS": blds, "DESIGNS TRIED": str(tried), "APPROVED": str(appr)}
    vals.update(over or {})
    items = [(k, str(v), GREEN if k == "APPROVED" and str(v) not in ("0", "") else
              (AMBER if k == "DESIGNS TRIED" and str(v) != "0" else TEXT)) for k, v in vals.items()][:4]
    y = 912
    d.line((LX0, y - 8, LX1, y - 8), fill=LINE)
    colw = (LX1 - LX0) // 4
    for i, (k, v, c) in enumerate(items):
        x = LX0 + 2 + i * colw
        d.text((x, y), k, font=F("monom", 11), fill=DIM)
        d.text((x, y + 16), v, font=F("monob", 22), fill=c)
    note = ("shade = geometric direct-sun shading at 1.2 m, 09:00-18:00, 15-min steps. "
            "NOAA sun + ray casting. costs indicative. Argon proposes, the verifier decides. "
            "recorded run.")
    lines = _wrap(note, F("mono", 11), LX1 - LX0 - 4, maxlines=4)
    for j, s in enumerate(lines):
        d.text((LX0 + 2, y + 52 + j * 15), s, font=F("mono", 11), fill=DIMMER)


# ---------------------------------------------------------------- top bar
TABS = [("Scan", (1,)), ("Scene", (2,)), ("Sun", (3,)), ("Designs", (4, 5)), ("Brief", (6, 7))]


def _top(d, t, state):
    step = int(state.get("step") or 1)
    f = F("monom", 13)
    crumbs = [("GEMINI 4 ARGON", DIM), (" / ", DIMMER), ("SHADOWSTOP · AGENT CONSOLE", TEXT),
              (" / ", DIMMER), ("BUS STOPS", DIM), (" / ", DIMMER), ("HACKNEY", TEXT)]
    tw = sum(f.getlength(s) for s, _ in crumbs) + 12
    x = (W - tw) / 2
    for s, c in crumbs:
        for ch_i, ch in enumerate(s):  # letter-spaced caps
            pass
        d.text((x, 10), s, font=f, fill=c)
        x += f.getlength(s)
    # LIVE + clock
    on = int(t * 2) % 2 == 0
    lx = W - 210
    d.ellipse((lx, 13, lx + 9, 22), fill=RED if on else (120, 40, 40))
    d.text((lx + 16, 10), "LIVE", font=F("monob", 13), fill=RED)
    d.text((lx + 62, 10), clock(t, ms=False) + "", font=f, fill=DIM)
    # tabs
    x = 24
    for name, steps in TABS:
        fnt = F("inters", 17)
        active = step in steps
        col = AMBER if active else DIM
        if name == "Brief":
            col = AMBER if active else (190, 120, 55)
        d.text((x, 49), name, font=fnt, fill=col)
        w = fnt.getlength(name)
        if active:
            d.line((x, 82, x + w, 82), fill=AMBER, width=2)
        x += w + 30
    # right status
    rs = "OPENSTREETMAP · NOAA SUN · 15-MIN · 1.2 M GRID"
    fr = F("monom", 13)
    rw = fr.getlength(rs)
    d.ellipse((W - 32 - rw - 16, 56, W - 32 - rw - 8, 64), fill=GREEN)
    d.text((W - 32 - rw, 51), rs, font=fr, fill=DIM)
    hook = state.get("hook")
    if hook:
        left, right = x + 20, W - 32 - rw - 40
        size = 24
        while size > 14 and F("inters", size).getlength(hook) > right - left:
            size -= 1
        fh = F("inters", size)
        hw = fh.getlength(hook)
        cx = max(left, (W - hw) / 2)
        cx = min(cx, right - hw)
        d.text((cx, 60), hook, font=fh, fill=TEXT, anchor="lm")
    # log header (prompt)
    cmd = "argon@shadowstop ~ % shadowstop scan --area hackney --date 2026-07-19 --budget 8000"
    fc = F("mono", 12)
    s = cmd
    while fc.getlength(s) > LX1 - LX0 - 4:
        s = s[:-2]
    if s != cmd:
        s = s[:-1] + "…"
    d.text((LX0 + 2, 104), s, font=fc, fill=DIM)


# ---------------------------------------------------------------- MAIN overlays
def _alpha_box(im, box, fill, radius=8, outline=None):
    x0, y0, x1, y1 = [int(v) for v in box]
    tile = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, x1 - x0 - 1, y1 - y0 - 1), radius, fill=fill, outline=outline)
    im.paste(tile.convert("RGB"), (x0, y0), tile.getchannel("A"))


def _tag(im, d, text):
    f = F("monom", 15)
    text = text.upper()
    w = f.getlength(text)
    x0, y0 = MX + 18, MY + 16
    _alpha_box(im, (x0, y0, x0 + w + 44, y0 + 34), (14, 15, 18, 200), 7, outline=(70, 70, 76, 200))
    d.ellipse((x0 + 13, y0 + 12, x0 + 23, y0 + 22), fill=AMBER)
    _draw_tokens(d, x0 + 32, y0 + 8, text, f)


def _label(im, d, label):
    big, _, sub = label.partition("\n")
    size = 44
    while size > 30 and F("serif", size).getlength(big) > MW - 560:
        size -= 2
    fs = F("serif", size)
    yb = MY + MH - (66 if sub else 40)
    d.text((MX + 30 + 2, yb + 2), big, font=fs, fill=(0, 0, 0), anchor="ls")
    d.text((MX + 30, yb), big, font=fs, fill=(248, 244, 236), anchor="ls")
    if sub:
        _draw_tokens(d, MX + 32, yb + 16, sub, F("mono", 15), base=(205, 208, 212))


def _badge(im, d, badge, kicker=None):
    value, label, frac = badge[0], badge[1], max(0.0, min(1.0, float(badge[2])))
    sub = badge[3] if len(badge) > 3 else "09:00–18:00 · 15-min steps · 1.2 m"
    kicker = kicker or "MEASURED · WAITING AREA · 19 JULY"
    bw, bh = 480, 250
    x0, y0 = MX + MW - bw - 26, MY + MH - bh - 40
    _alpha_box(im, (x0, y0, x0 + bw, y0 + bh), (16, 13, 11, 226), 10, outline=(96, 66, 46, 230))
    d.text((x0 + 22, y0 + 20), kicker, font=F("monom", 13), fill=DIM)
    fv = F("black", 96)
    d.text((x0 + 18, y0 + 140), value, font=fv, fill=AMBER, anchor="ls")
    vx = x0 + 18 + fv.getlength(value) + 16
    ll = _wrap(label, F("interm", 20), x0 + bw - 20 - vx, maxlines=3)
    for j, s_ in enumerate(ll):
        d.text((vx, y0 + 134 - (len(ll) - 1 - j) * 25), s_, font=F("interm", 20), fill=TEXT, anchor="ls")
    # 12-segment meter
    n = 12
    bx0, bx1, by = x0 + 22, x0 + bw - 22, y0 + 160
    cw = (bx1 - bx0) / n
    lit = frac * n
    for i in range(n):
        cx = bx0 + i * cw
        d.rectangle((cx + 2, by, cx + cw - 3, by + 26), fill=(52, 42, 36))
        part = max(0.0, min(1.0, lit - i))
        if part > 0:
            d.rectangle((cx + 2, by + 26 * (1 - part), cx + cw - 3, by + 26), fill=AMBER)
    d.text((bx0, by + 34), "09:00", font=F("mono", 11), fill=DIM)
    d.text((bx1, by + 34), "18:00", font=F("mono", 11), fill=DIM, anchor="ra")
    d.text(((bx0 + bx1) / 2, by + 34), "direct-sun exposure", font=F("mono", 11), fill=DIM, anchor="ma")
    d.text((x0 + 22, y0 + bh - 14), sub, font=F("mono", 13), fill=(150, 140, 130), anchor="ls")


def _credit(d, credit):
    f = F("mono", 12)
    w = f.getlength(credit)
    x, y = MX + MW - 18 - w, MY + MH - 14
    d.text((x + 1, y + 1), credit, font=f, fill=(0, 0, 0), anchor="ls")
    d.text((x, y), credit, font=f, fill=(200, 202, 206), anchor="ls")


# ---------------------------------------------------------------- caption
def _caption(d, t, state):
    step = state.get("step")
    cap = state.get("caption") or ""
    prog = state.get("progress")
    x = MX + 22
    if step:
        d.text((x, 961), "STEP", font=F("monom", 12), fill=DIM)
        d.text((x, 975), f"{step}", font=F("monob", 30), fill=AMBER)
        d.text((x + 40, 989), "/07", font=F("mono", 13), fill=DIM)
        x += 92
        d.line((x - 14, 960, x - 14, 1020), fill=LINE)
    who = (state.get("who") or "").upper()
    if who:
        wc = {"ARGON": AMBER, "VERIFIER": GREEN, "HUMAN": TEXT, "OSM": BLUE, "NANO BANANA": (230, 200, 90)}.get(who, CYAN)
        fw = F("monob", 18)
        ww = fw.getlength(who)
        d.rounded_rectangle((x, 961, x + ww + 16, 987), 5, outline=wc, width=1)
        d.text((x + 8, 974), who, font=fw, fill=wc, anchor="lm")
        x0c = x
    else:
        d.text((x, 961), "AGENT READ", font=F("monom", 12), fill=DIM)
    pw = 470 if prog is not None else 0
    avail = MX + MW - 24 - pw - 30 - x
    size = 30
    while size > 16 and F("inters", size).getlength(cap) > avail:
        size -= 1
    fc = F("inters", size)
    s = cap
    while fc.getlength(s) > avail and len(s) > 4:
        s = s[:-2]
    if s != cap:
        s = s[:-1] + "…"
    d.text((x, 1012), s, font=fc, fill=TEXT, anchor="lm")
    if prog is not None:
        prog = max(0.0, min(1.0, float(prog)))
        px0, px1 = MX + MW - 24 - pw, MX + MW - 24
        seg = (px1 - px0) / 7
        cur = int(step) - 1 if step else int(prog * 7 - 1e-6)
        for i, name in enumerate(STEPS):
            sx = px0 + i * seg
            fill = max(0.0, min(1.0, prog * 7 - i))
            d.rectangle((sx + 2, 984, sx + seg - 3, 989), fill=(40, 42, 47))
            if fill > 0:
                d.rectangle((sx + 2, 984, sx + 2 + (seg - 5) * fill, 989),
                            fill=GREEN if fill >= 1 and i != cur else AMBER)
            col = AMBER if i == cur else (TEXT if fill >= 1 else DIM)
            d.text((sx + 2, 1000), name if name != "APPROVE" else "APPRV", font=F("monom", 11), fill=col)
        d.text((px0 + 2, 962), "PIPELINE", font=F("monom", 12), fill=DIM)
        d.text((px1, 962), f"{int(round(prog * 100))}%", font=F("monom", 12), fill=AMBER, anchor="ra")


# ---------------------------------------------------------------- bottom bar
def _bottom(d, t, state):
    f = F("mono", 13)
    y = 1060
    x = 24
    parts = [("●", GREEN), (" gemini-4-argon", TEXT), (" · thinking low", DIM), ("  │  ", DIMMER),
             ("verifier: ", DIM), ("deterministic", GREEN), ("  │  ", DIMMER),
             ("nano-banana-2.1", TEXT), (" renders = illustration", DIM), ("  │  ", DIMMER),
             ("map © OpenStreetMap contributors", DIM)]
    for s, c in parts:
        d.text((x, y), s, font=f, fill=c, anchor="lm")
        x += f.getlength(s)
    m = state.get("metrics") or "stop osm-469771287 · 51.5452, -0.0554 · budget £8,000 · costs indicative"
    mw = f.getlength(m)
    _draw_tokens(d, W - 24 - mw, y - 9, m, f, base=DIM)


# ---------------------------------------------------------------- entry
def draw_chrome(im: Image.Image, t: float, state: dict) -> Image.Image:
    state = state or {}
    if im.size != (W, H):
        im = im.resize((W, H))
    rgba = im.convert("RGB") if im.mode != "RGB" else im
    base = _static_layer()
    if "base_rgb" not in _STATIC:
        _STATIC["base_rgb"] = base.convert("RGB")
        _STATIC["base_a"] = base.getchannel("A")
        _STATIC["grad_a"] = _STATIC["grad"].getchannel("A")
        _STATIC["tgrad_a"] = _STATIC["tgrad"].getchannel("A")
    # soft gradients inside MAIN for legibility of overlays
    if state.get("label") or state.get("badge") or state.get("credit"):
        rgba.paste((0, 0, 0), (MX, MY + MH - 300, MX + MW, MY + MH), _STATIC["grad_a"])
    if state.get("tag"):
        rgba.paste((0, 0, 0), (MX, MY, MX + MW, MY + 120), _STATIC["tgrad_a"])
    rgba.paste(_STATIC["base_rgb"], (0, 0), _STATIC["base_a"])
    d = FastDraw(rgba)
    _top(d, t, state)
    _draw_log(rgba, d, t, state.get("log") or [])
    _counters(d, t, state.get("log") or [], state.get("counters"))
    if state.get("tag"):
        _tag(rgba, d, state["tag"])
    if state.get("label"):
        _label(rgba, d, state["label"])
    if state.get("badge"):
        _badge(rgba, d, state["badge"], state.get("badge_kicker"))
    if state.get("credit"):
        _credit(d, state["credit"])
    _caption(d, t, state)
    _bottom(d, t, state)
    return rgba


# ---------------------------------------------------------------- demo
DEMO_LOG = [
    (0.0, "INFO osm.scan · bbox 51.540,-0.062 → 51.550,-0.048"),
    (0.4, "D overpass timeout → fallback api.openstreetmap.org"),
    (0.9, "OK scene_from_osm · 17 bus stops · 599 buildings"),
    (1.4, "INFO stop osm-469771287 · Hackney Town Hall, Mare St"),
    (1.9, "INFO read_scene · gemini-4-argon · 1 street photo"),
    (2.6, "WARN shelter roof = clear glazing · opacity 0.10"),
    (3.2, "INFO engine.score · 09:00-18:00 · 37 steps · 1.2 m"),
    (3.8, "D 09:00 · az 99 · el 34 · full sun"),
    (4.1, "D 12:00 · az 152 · el 58 · full sun"),
    (4.4, "D 15:00 · az 222 · el 48 · full sun"),
    (4.7, "D 18:00 · az 271 · el 26 · full sun"),
    (5.0, "OK measured · shade 14% · 7.7 h direct sun"),
    (5.6, "INFO propose_fix #1 · opaque metal roof · £4,290"),
    (6.3, "WARN engine.evaluate REJECTED · +14 pts < +25 bar · 09:00 az 99 el 34 · 0% shaded"),
    (7.4, "INFO propose_fix #2 · argon shade sail · £3,360"),
    (8.1, "WARN engine.evaluate REJECTED · 18:00 az 271 el 26 · 13% shaded"),
    (9.0, "INFO propose_fix #3 · tensioned shade-sail fabric · £3,350"),
    (9.7, "OK engine.evaluate ACCEPTED · shade 14% → 77% · £3,350 indicative"),
    (10.5, "OK officer APPROVED · council brief unlocked"),
    (11.0, "INFO render_fix · nano-banana-2.1 · illustration of verified design"),
    (11.8, "OK brief · 938 extra shaded passenger-hours/yr · £0.45 each"),
]


if __name__ == "__main__":
    import os
    import time

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    photo = Image.open(os.path.join(root, "web/assets/hackney_mare_street.jpg")).convert("RGB")
    sw, sh = photo.size
    sc = max(MW / sw, MH / sh)
    photo = photo.resize((int(sw * sc + 1), int(sh * sc + 1)), Image.LANCZOS)
    ox, oy = (photo.width - MW) // 2, (photo.height - MH) // 2
    photo = photo.crop((ox, oy, ox + MW, oy + MH))
    frame = Image.new("RGB", (W, H), BG)
    frame.paste(photo, (MX, MY))
    out = "/tmp/claude-0/-home-user-shadowstop/f261938e-6d56-5267-8a48-f3a0497ae03e/scratchpad"
    credit = "Mare Street by Cjc13 · CC BY-SA 3.0 · Wikimedia Commons"
    frames = [
        (2.9, {"step": "02", "who": "argon", "caption": "Argon reads the street photo: the \"shelter\" roof is clear glazing",
               "log": DEMO_LOG, "tag": "street photo · Mare Street, Hackney", "credit": credit,
               "label": "Hackney Town Hall, Mare St", "progress": 0.22,
               "hook": "gemini 4 argon scans every bus stop in London and finds the ones that leave you in full sun"}),
        (6.6, {"step": "04", "who": "verifier", "caption": "Verifier rejects the obvious fix: 0% shaded at 09:00 (sun az 99°, el 34°)",
               "log": DEMO_LOG, "tag": "street photo · before", "credit": credit,
               "label": "Hackney Town Hall, Mare St\nosm-469771287 · 51.5452, -0.0554 · 19 jul 2026",
               "badge": ("7.7", "hours of direct sun a day", 0.77), "progress": 0.52}),
        (14.0, {"step": "07", "who": "human", "caption": "Shade 14% → 77% · £3,350 indicative · approved by a human",
                "log": DEMO_LOG, "tag": "the fix · verified design", "credit": credit,
                "label": "Hackney Town Hall, Mare St\nshade 14% → 77% · tensioned shade-sail · £3,350 indicative",
                "badge": ("2.1", "hours of direct sun after the fix", 0.21), "progress": 1.0}),
    ]
    for i, (t, st) in enumerate(frames):
        t0 = time.perf_counter()
        res = draw_chrome(frame.copy(), t, st)
        dt = (time.perf_counter() - t0) * 1000
        p = os.path.join(out, f"chrome_{i + 1}.png")
        res.save(p)
        print(p, f"{dt:.1f} ms")
    # timing over many frames
    t0 = time.perf_counter()
    for k in range(30):
        draw_chrome(frame.copy(), 5 + k / 30, frames[1][1])
    print(f"avg {(time.perf_counter() - t0) / 30 * 1000:.1f} ms/frame")
