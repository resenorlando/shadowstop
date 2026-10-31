"""Hook film: intro (hook) + pipeline story + diagnosis postcard, in an agent-console layout.

    python showcase-tools/render_hook.py [--procs 4] [--only 1.0,9.5]

Writes docs/shadowstop_hook.mp4 (the hook) and docs/shadowstop_full.mp4 (hook + the
verifier-rendered data film docs/shadowstop_film.mp4). Every number comes from
web/assets/hero.json (recorded verifier output) or the engine; see showcase-tools/hook/BRIEF.md.
"""
import argparse
import pathlib
import shutil
import subprocess
import sys
import tempfile
from multiprocessing import Pool

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
FPS = 30
MAIN_XY = (552, 96)


def _mods():
    from hook import chrome, intro, story
    return intro, story, chrome


def render(t):
    from PIL import Image
    intro, story, chrome = _mods()
    if t < intro.INTRO_LEN:
        return intro.frame_intro(t)
    st = t - intro.INTRO_LEN
    main, state = story.story(min(st, story.STORY_LEN - 1e-3))
    im = Image.new("RGB", (1920, 1080), (8, 9, 11))
    im.paste(main.convert("RGB").resize((1336, 840)), MAIN_XY)
    return chrome.draw_chrome(im, st, state)


def _job(args):
    i, out = args
    render(i / FPS).save(out / f"{i:05d}.png", compress_level=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--procs", type=int, default=4)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    intro, story, _ = _mods()
    total = intro.INTRO_LEN + story.STORY_LEN
    if a.only:
        for s in a.only.split(","):
            render(float(s)).save(f"/tmp/hook_{s}.png")
            print("/tmp/hook_" + s + ".png")
        return
    tmp = pathlib.Path(tempfile.mkdtemp())
    n = int(total * FPS)
    with Pool(a.procs) as p:
        p.map(_job, [(i, tmp) for i in range(n)], chunksize=8)
    hook = ROOT / "docs/shadowstop_hook.mp4"
    enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-r", str(FPS), "-i", str(tmp / "%05d.png"), *enc, str(hook)], check=True)
    lst = tmp / "list.txt"
    lst.write_text(f"file '{hook}'\nfile '{ROOT / 'docs/shadowstop_film.mp4'}'\n")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-r", str(FPS), *enc,
                    str(ROOT / "docs/shadowstop_full.mp4")], check=True)
    shutil.rmtree(tmp)
    print(f"wrote {hook} ({total:.1f} s) and docs/shadowstop_full.mp4")


if __name__ == "__main__":
    main()
