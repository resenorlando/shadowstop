"""Story with satellite + maths beats spliced in.

Wraps hook.story (unchanged timeline) and inserts beats rendered on the real aerial
(hook.aerial) with live maths overlays (hook.mathfx). Original log timestamps are shifted
by the inserted durations so the agent log stays in sync.
"""
from PIL import Image

from hook import story as base
from hook import aerial, mathfx

W, H = 1336, 840
# (insert at original story time, [(kind, duration)])
INSERTS = [
    (6.4, [("sat_sweep", 5.0), ("sat_expo", 3.2)]),
    (17.9, [("sat_after", 3.4)]),
]
# base-story ranges replaced by the inserts (the old flat exposure-grid beat 6.4-9.4)
SKIP = {6.4: 3.0}
STORY_LEN = base.STORY_LEN + sum(d for _, segs in INSERTS for _, d in segs) - sum(SKIP.values())

CAP = {
    "sat_sweep": "Real aerial: shadows ray-cast from the sun, 09:00 → 18:00",
    "sat_expo": "Hours of direct sun on the waiting area: 7.7 h a day",
    "sat_after": "Same sun, verified canopy: 14% → 77% shaded",
}
EXTRA_LOG = {
    "sat_sweep": [(0.2, "INFO aerial    esri z19 · 0.19 m/px · georeferenced"),
                  (0.9, "INFO sun.noaa  δ=+20.8° · h → A, e every 15 min"),
                  (1.8, "INFO geometry  ray-cast 37 sun positions × waiting-area grid"),
                  (3.2, "WARN exposure  waiting area in direct sun most of the day")],
    "sat_expo": [(0.3, "INFO engine.score  S = 0.1399  ·  7.7 h direct sun")],
    "sat_after": [(0.3, "OK   engine.score  S = 0.7655 with verified canopy  ·  2.1 h")],
}


def _offset_before(ts):
    off = 0.0
    for at, segs in INSERTS:
        if at <= ts:
            off += sum(d for _, d in segs)
            sk = SKIP.get(at, 0.0)
            off -= min(sk, ts - at)  # lines from a skipped range land inside the insert
    return off


def _locate(t):
    """Map new time -> ('base', original_t) or (kind, local_t, insert_at, insert_start_new)."""
    cur_new = 0.0
    prev_orig = 0.0
    for at, segs in INSERTS:
        span = at - prev_orig
        if t < cur_new + span:
            return ("base", prev_orig + (t - cur_new))
        cur_new += span
        for kind, d in segs:
            if t < cur_new + d:
                return (kind, t - cur_new, at)
            cur_new += d
        prev_orig = at + SKIP.get(at, 0.0)
    return ("base", min(prev_orig + (t - cur_new), base.STORY_LEN - 1e-3))


def _shift_log(log):
    return [(ts + _offset_before(ts), txt) for ts, txt in log]


def _panel(im, box, alpha=185):
    from PIL import ImageDraw
    x, y, w, h = box
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(ov).rounded_rectangle((x - 12, y - 10, x + w + 12, y + h + 10), 12,
                                         fill=(8, 9, 11, alpha), outline=(60, 64, 70, 200))
    base_ = im.convert("RGBA")
    base_.alpha_composite(ov)
    return base_


def _sat(kind, lt):
    if kind == "sat_sweep":
        im = aerial.aerial_frame(lt, "sweep", dur=5.0, shift_y_m=10.0)
        minutes = 540 + 540 * min(lt / 5.0, 1.0)
        im = _panel(im, (24, 70, 1100, 385))
        mathfx.solar(im, lt, minutes, (24, 70, 1100, 385))
    elif kind == "sat_expo":
        im = aerial.aerial_frame(lt, "exposure", shift_y_m=8.5)
        im = _panel(im, (24, 70, 1100, 230))
        mathfx.integral(im, lt, (24, 70, 1100, 230), before=True)
    else:
        im = aerial.aerial_frame(lt, "after", dur=3.4, shift_y_m=13.0)
        im = _panel(im, (24, 70, 1100, 490))
        mathfx.integral(im, lt + 2.0, (24, 70, 1100, 490), before=False)
    return im.convert("RGB")


def story(t):
    t = min(max(float(t), 0.0), STORY_LEN - 1e-3)
    loc = _locate(t)
    if loc[0] == "base":
        im, state = base.story(loc[1])
        state = dict(state)
        state["log"] = _shift_log(state.get("log", []))
        state["progress"] = t / STORY_LEN
        return im, state
    kind, lt, at = loc
    _, state = base.story(at - 1e-3 if kind != "sat_after" else at - 0.5)
    state = dict(state)
    ins_start = t - lt
    log = _shift_log(state.get("log", []))
    for k, segs in INSERTS:
        if k != at:
            continue
        s0 = ins_start - sum(d for kk, d in segs[: [x for x, _ in segs].index(kind)])
        acc = s0
        for kk, d in segs:
            for ts, txt in EXTRA_LOG.get(kk, []):
                if acc + ts <= t:
                    log.append((acc + ts, txt))
            acc += d
    state.update(
        log=sorted(log),
        progress=t / STORY_LEN,
        caption=CAP[kind],
        who="VERIFIER",
        label="Hackney Town Hall",
        credit="Imagery © Esri, Maxar, Earthstar Geographics · shadows: ShadowStop ray casting",
    )
    if kind == "sat_sweep":
        state.update(step="03", tag="● satellite · ray-cast shadow sweep", badge=None)
    elif kind == "sat_expo":
        state.update(step="03", tag="● direct-sun hours · not temperature", badge=None)
    else:
        state.update(step="06", tag="● verified canopy · same sun", badge=None)
    im = _sat(kind, lt)
    return im, state
