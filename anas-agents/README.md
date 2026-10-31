# anas-agents: 3D demo film, backup cards and stage kit

Deliverables from the final demo-polish pass. The working code stays where the app serves it; this folder holds the outputs and points to the sources.

## Files here
| File | What it is |
|---|---|
| `shadowstop_3d_film.mp4` | The 56 s, 1920×1080, 30 fps film built around the real 3D scene. It was rendered in a cloud container that blocks satellite tiles, so the 5–11 s fly-in dives into the 3D reconstruction instead of the satellite map. Re-record on a laptop with internet for the satellite version (see below). |
| `qa/qa_*.jpg` | Stills from the render at the key beats (opening, fly-in, before, rejections, canopy build, before/after, ending), used for QA. |
| `cards/problem.png`, `cards/intelligence.png`, `cards/result.png` | Three 1920×1080 backup cards, rendered from the same verified scene. |
| `STAGE_RUNBOOK.md` | Copy of `docs/STAGE_RUNBOOK.md`: the 3-minute stage workflow and grounded Q&A. |

## Film timeline
| Time | Beat |
|---|---|
| 0–5 s | Real photo of the Hackney Town Hall stop, waiting area marked |
| 5–11 s | Fly-in to Hackney: satellite map with the real cached scan (10 stops) when online, otherwise the 3D reconstruction |
| 11–19 s | 3D before: the sun moves 09:00 → 18:00, verified 14% |
| 19–27 s | Two rejections: the obvious solid roof (verifier: 24% at 15:30, +14 pts below the bar), and Argon's first sail (recorded run: 13% at 18:00) |
| 27–38 s | Argon's accepted shade-sail builds, then the sun sweeps and the shadow moves |
| 38–47 s | Identical camera, before and after side by side: 14% → 77% |
| 47–55 s | Hero view, £3,350 indicative, ShadowStop |

Every number comes from `web/assets/hero.json`, which is engine output re-checked by `tests/test_hackney_accepted.py`. Shade means the share of waiting-area time from 09:00 to 18:00 out of direct sun at 1.2 m height. It is geometry, not temperature, and not a UV measurement. Costs are indicative. The Nano Banana image is labelled as an architectural illustration.

## Sources (in the app)
- `web/hero3d.js`, `web/hero3d.html`: the 3D scene (http://localhost:8000/hero3d.html)
- `web/story_v2.html`, `web/story_v2.js`: the film page (http://localhost:8000/story_v2.html)
- `web/cards.html`: the cards (`?card=problem|intelligence|result`)
- `showcase-tools/record.js`: recorder (frame by frame on a virtual clock); `snap.js`: stills
- Live app straight into the verified scene: http://localhost:8000/index.html?scene=hackney

## Re-record the film (with satellite tiles)
With the server running, then:
```bash
cd showcase-tools && npm install && npx playwright install chromium && node record.js
```
The output goes to `showcase-tools/out/shadowstop_demo.mp4`.

## Other films in the repo
All are 1920×1080, 30 fps, H.264, no audio, so they join losslessly:
- `docs/shadowstop_hook.mp4` (36 s): hook and agent-console film
- `docs/shadowstop_film.mp4` (42 s): data film
- `docs/shadowstop_full.mp4` (78 s): hook followed by the data film
