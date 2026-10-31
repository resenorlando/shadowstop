# AGENTS.md: megaprompt for any coding agent working on ShadowStop

You're joining a hackathon team mid-build: the Google DeepMind **Gemini 4 Argon** hackathon in London, 31 Oct 2026. **Hard submission is at 16:00 GMT and stage demos are at 16:30** (3 minutes + 1 minute of Q&A). The app already works end to end. **Don't rewrite or restructure anything.** Make small, safe, tested changes, and keep the demo path working at every commit.

## What ShadowStop is (one paragraph)
On a heatwave day, people wait for buses in full sun, often under "shelters" with clear roofs. ShadowStop scans every bus stop in an area and rebuilds each one in 3D from OpenStreetMap, plus Gemini 4 Argon's reading of street photos. It computes how much of the waiting area is really shaded through the day. **Argon then designs a canopy or tree from a fixed material catalogue under a budget, and a deterministic verifier (real sun geometry + ray casting + buildability, cost and budget rules) accepts or rejects every design.** Rejections, with the exact counterexample time and sun angle, go back to Argon, which redesigns. A human approves the design before a "council brief" can be exported. Nano Banana 2.1 draws the *verified* design into the user's own street photo. A photo check compares the model's predicted sun/shade with a real timestamped photo.

**Golden rule: Argon reads and proposes; the verifier decides.** Every number on screen must come from `engine.py`, never from a model or a picture. Don't let a model set opacity, cost or scores.

## Who it's for (the judges' "real person" test)
A TfL / borough bus-infrastructure officer deciding which shelters to upgrade, for people like the passengers at **Hackney Town Hall** (the worst stop in our Hackney scan: 12–14% shade on a July day).

## Repo map
| Path | What it is |
|---|---|
| `shadowstop/sun.py` | NOAA sun position (azimuth clockwise from north, elevation with refraction), local↔UTC |
| `shadowstop/geometry.py` | Vectorised ray casting: prisms (boxes and cylinders become prisms), ellipsoid tree crowns, partial opacity |
| `shadowstop/engine.py` | **The verifier**: 0.5 m grid over the waiting area at 1.2 m height, 15-minute steps, `score()`, `check_constraints()`, `evaluate()` (accept/reject + reasons + counterexample), `search_best_canopy()` (coarse brute-force reference), `shade_at()` |
| `shadowstop/materials.py` | Material catalogue (opacity, indicative £ fixed + £/m², life) and `shade_value()` (£ per extra shaded passenger-hour). Costs are labelled indicative |
| `shadowstop/osm.py` | Overpass, with a fallback to the main OSM API (Overpass times out on the venue network). Responses are cached in `scenes/cache/`. `scene_from_osm()`, `scan()` |
| `shadowstop/argon.py` | All Gemini calls: `propose_fix` (Interactions API, `thinking_level` from env `SHADOWSTOP_THINKING`, default `low`, retries chained with `previous_interaction_id`, falls back to `generate_content`), `read_scene` (photos → scene corrections), `read_photo_shade`, `render_fix` (Nano Banana 2.1) |
| `shadowstop/server.py` | FastAPI: `/api/health`, `/api/sun`, `/api/score`, `/api/scene/demo`, `/api/scene/from_osm`, `/api/scan`, `/api/propose` (body `{scene, budget_gbp}`), `/api/read-scene`, `/api/photo-check`, `/api/render-fix`; serves `web/` at `/` |
| `web/` | Static Three.js 0.160 + Leaflet 1.9.4 app (no build step): map and scan, 3D scene, time slider, before/after, heatmap, verification panel, Argon attempt log, budget, business case, render panel, approve/export, photo check. `web/engine.js` is an in-browser fallback scorer used only if the server is down (labelled on screen) |
| `scenes/demo.json` | Rehearsed synthetic scene (glass shelter). The Hackney stop is built live from OSM |
| `tests/test_engine.py` | Known-answer tests (solstice sun angle, a pole's shadow length, roof vs low sun, glass, tree, buildings, constraints) |
| `SCENE_SCHEMA.md` | Scene JSON format: local metres, x = east, y = north, z = up |

## Run
```bash
pip install -r requirements.txt
```
```bash
python -m pytest -q
```
```bash
python -m uvicorn shadowstop.server:app --port 8000 --reload
```
Open http://localhost:8000. You need `GEMINI_API_KEY` in the environment for any Argon or Nano Banana feature.

**Models:**
- `gemini-4-argon`: reasoning and design.
- `gemini-nano-banana-2.1`: photo render.
- Argon on the Interactions API takes ~10–30 s per call. A full propose loop on the Hackney stop takes ~60 s.

## Verified results to protect (re-check after any change)
- **Demo scene** (`/api/scene/demo`): before 14%. The obvious fix (solid roof) is REJECTED. Argon is accepted at ~94–96%.
- **Hackney Town Hall** (scan the area around 51.545, -0.055, then click it), budget £8,000:
  - Obvious fix REJECTED (0% shade at 09:00).
  - Argon's shade-sail attempt REJECTED (13% at 18:00).
  - Argon's redesign ACCEPTED: 14% → 77%, £3,350 indicative.

## Rules for any change
1. Run `python -m pytest -q` before every commit. All tests must pass.
2. Keep the verifier deterministic and model-free. If you add a check, add a known-answer test.
3. Never put API keys in code or commits. Never commit generated "photos" as if they were real (`scenes/_*` is gitignored).
4. Make small commits, `git pull` before pushing, and don't reformat files you aren't changing. The other teammate owns `web/` or `shadowstop/`, so ask before editing both.
5. Keep honest labels: costs are indicative, shade is geometric direct-sun shading at 1.2 m (not temperature), and Nano Banana images are illustrations.

## Highest-value next tasks (in order; stop at the 15:15–15:30 freeze)
1. **Real photo flow:** with a real timestamped photo of the Hackney Town Hall stop (or any stop), test `/api/photo-check` and `/api/render-fix` end to end in the UI, and fix any bugs. These are the only paths not yet tested with real input.
2. **Demo-speed safety:** add a "Replay last run" button that reloads the last `/api/propose` response from `localStorage`, clearly labelled "replay", for when the venue Wi-Fi is slow. Keep the live path as the default.
3. **Judge-driven input:** make sure a judge can type any London postcode or click any stop on the map and get a scored 3D scene within ~30 s. Pre-cache 2–3 areas by running `/api/scan` on them now.
4. **README polish:** add one screenshot (`docs/screenshot.png`) and a 5-line "How the verifier works" section near the top.
5. Optional, only if everything above is done: weight the score by passenger demand per time of day (TfL BUSTO boarding counts) instead of a flat window.

**Don't start:** new pages, accounts, databases, refactors, a new framework, or anything that changes `engine.py`'s numbers without a test.
