# ShadowStop

**Find the bus stops that leave people standing in the sun, and design shade that's proven to work.**

On a heatwave day, people waiting for a bus stand in full sun, often under a "shelter" with a clear roof. ShadowStop scans every stop in an area, rebuilds each stop in 3D from OpenStreetMap plus Gemini 4 Argon's reading of street photos, and computes how much of the waiting area is actually shaded through the day. Argon then designs a canopy or tree, and **a deterministic geometry engine accepts or rejects every design**. Nothing on screen is a generated picture of success: every number is ray-cast from the real sun position.

> Demo stop: a glass shelter gives **14%** shade across a July day (1.7% at lunchtime). The "obvious fix" (a solid roof) is **rejected** by the verifier: at 11:45 only 17% of the waiting area is shaded. Argon's canopy, designed using the verifier's counterexample, is **accepted at 94%**.

## How it works
```
OpenStreetMap ─┐                     ┌─> Argon proposes a canopy/tree ─┐
(stops, buildings, trees, roads)     │                                 │
               ├─> 3D scene ─> VERIFIER (sun position + ray casting) <─┘  accept / reject + counterexample
Street photos ─┘   ▲                     │
 (Argon reads what │                     └─> shade score, heat map, worst time of day
  the map gets     │
  wrong)           └── Photo check: a real timestamped photo must show sun/shade where the model predicts it
```

| Part | Who does it | File |
|---|---|---|
| Find stops, buildings (with heights), trees, kerb direction | OpenStreetMap (Overpass, falls back to the OSM API) | `shadowstop/osm.py` |
| Correct the map from photos (e.g. *"OSM says shelter=yes but the roof is clear polycarbonate"*), find where people really wait | **Gemini 4 Argon** | `shadowstop/argon.py` |
| Sun position (NOAA equations), ray casting, shade score, buildability rules | **Deterministic verifier** (no model calls) | `shadowstop/sun.py`, `geometry.py`, `engine.py` |
| Design a fix; read the verifier's rejection and try again | **Gemini 4 Argon** | `argon.propose_fix` |
| Reality check against a timestamped photo | Argon reads the photo; the verifier predicts it | `/api/photo-check` |

**The rule: Argon reads and proposes; the verifier decides.** A proposal is accepted only if it:
- adds at least **+25 points** of shade over the day;
- keeps at least **40%** of the waiting area shaded at the worst moment;
- fits buildability limits: underside 2.3–4.5 m, area ≤ 24 m², inside the pavement zone, not inside a building.

A rejected proposal goes back to Argon with the counterexample (time, sun azimuth and elevation, shade %).

## Run it
```bash
pip install -r requirements.txt
```
```bash
setx GEMINI_API_KEY "<your key>"
```
```bash
python -m uvicorn shadowstop.server:app --port 8000
```
Open http://localhost:8000. On Windows, `./run.ps1` picks the key up from your user environment.

Tests (known-answer checks of the sun and the geometry):
```bash
python -m pytest -q
```

## API
| Endpoint | What it does |
|---|---|
| `GET /api/scan?south&west&north&east` | Every bus stop in the box with a baseline shade score, worst first |
| `GET /api/scene/from_osm?lat&lon` | Builds the 3D scene for one stop |
| `GET /api/scene/demo` | The rehearsed demo scene |
| `POST /api/score {scene, include_proposals}` | Shade score, by time of day, heat-map cells, worst time |
| `POST /api/propose {scene}` | Obvious fix → Argon attempts → verdicts → final scene, plus a brute-force reference search |
| `POST /api/read-scene` (photos + scene) | Argon corrects the scene from photos |
| `POST /api/photo-check` (photo + scene) | Predicted vs observed sun/shade at named points of a real photo |
| `GET /api/sun?lat&lon&date&time&utc_offset` | Sun azimuth and elevation |

Scene format: [SCENE_SCHEMA.md](SCENE_SCHEMA.md).

## Limits (read before trusting a number)
- **Shade is direct sunlight blocked at torso height (1.2 m)** over the waiting area, 15-minute steps. It isn't air temperature, radiant heat or UV index.
- **Heights come from OSM tags.** Where they're missing, the default is 9 m (shown as low confidence). Tree crowns are estimated from height.
- **Glass and foliage are modelled as partial opacity** (glass 0.1, foliage 0.7), not optics.
- **Argon's scene corrections are only as good as the photos**, and every Argon-sourced object is labelled with its evidence and confidence in the UI.
- **The brute-force reference search is coarse** (1 m grid, hourly steps, 4 canopy sizes), so a good Argon design can beat it.
- This is a **geometry-backed estimate for prioritising stops**, not a certified structural or planning design.
