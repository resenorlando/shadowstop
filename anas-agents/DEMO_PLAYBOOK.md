# ShadowStop — Stage Demo Playbook (16:30 GMT Presentation)

**Format:** 3 minutes live stage demo + 1 minute Judge Q&A  
**Golden Rule on Stage:** *Gemini 4 Argon reads and proposes; `engine.py` deterministically verifies and decides.* Every number on screen comes from solar geometry and ray casting — never from a language model or an image generator.

---

## 1. Single-Command Startup & 60-Second Preflight Check

### Startup Command
From `c:\Users\Kodoo\Shadow-Stop`:
```powershell
$env:SHADOWSTOP_THINKING="low"; python -m uvicorn shadowstop.server:app --port 8000
```
*(Ensure `GEMINI_API_KEY` is exported in the terminal session for live Argon + Nano Banana 2.1 calls).*

### Preflight Checklist (T-Minus 5 Minutes)
1. **Run unit tests (`17 passed`):**
   ```powershell
   python -m pytest -q
   ```
2. **Verify API health:** Open `http://localhost:8000/api/health` → confirm `{"ok": true, "model": "gemini-4-argon", "gemini_key": true}`.
3. **Warm browser & fallback cache:**
   - Open `http://localhost:8000` in Chrome/Edge at `1920×1080` (100% zoom, dark OS theme).
   - Verify the **Hero Demo** / **Hackney Town Hall** scene loads in < 1 s and `scenes/cache/` serves the Hackney stops without hitting external Overpass mirrors.
   - Have one real timestamped street photo of the Hackney stop ready in the file picker directory for the **See it on the real street** (Nano Banana 2.1) and **Photo check** panels.

---

## 2. Exact 3-Minute Stage Script (Synchronized Operator & Presenter Cues)

### `0:00 – 0:30` | Act I: The Problem & Area-Wide Discovery
- **Operator Action:**
  - Start on the **Map** tab centred on Hackney (`E8 1EA`, `51.5450, -0.0553`).
  - Click **Scan this area** (or trigger the **Hero Demo** flow).
  - Click **#1 Hackney Town Hall** (`12%` fast scan / `14%` full daily shade) in the ranked list.
- **Presenter Script:**
  > *"On a 32°C London heatwave day, thousands of bus passengers wait in full sun — often underneath shelters with clear polycarbonate roofs that act like greenhouses. We built **ShadowStop** for TfL and borough infrastructure officers. We give ShadowStop a London postcode, and it reconstructs every bus stop in 3D from OpenStreetMap and ranks them worst-first. Right at the top is **Hackney Town Hall** on Mare Street: despite OSM tagging `shelter=yes`, passengers get just **14% shade** across the day."*

---

### `0:30 – 1:10` | Act II: 3D Reconstruction & Deterministic Solar Physics
- **Operator Action:**
  - Toggle to **BEFORE** (`B` key) and scrub the **Time Slider** from `09:00` through `13:30` to `18:00` (or press `Space` to play the solar arc).
  - Point out the cyan waiting area (`6.0 × 2.2 m`), orange dashed buildable zone (`12.0 × 5.0 m`), and red pavement heatmap (`0%–20%` shade).
  - Click the `shelter-roof` item in **Scene provenance** to flash the existing roof in 3D.
- **Presenter Script:**
  > *"Here is Hackney Town Hall in 3D. Every 15 minutes from 9 am to 6 pm, our deterministic engine in `engine.py` computes NOAA solar azimuth and elevation and casts rays from a 0.5-metre grid at 1.2 metres torso height through surrounding buildings, trees, and the shelter. Notice why this stop fails: Argon inspects the street scene and flags that the existing roof is clear glass or polycarbonate (`opacity = 0.1`), letting 90% of direct sun straight onto waiting passengers."*

---

### `1:10 – 2:05` | Act III: The Argon Propose–Verify–Redesign Loop
- **Operator Action:**
  - Set **Budget £** to `8000`.
  - Click **✨ Ask Argon to fix it** (or click **Instant Verified Replay** if venue Wi-Fi lags > 5 s).
  - Let the 3-attempt verification sequence play out in the **Argon proposal loop** log:
    1. **Attempt 1 (`baseline` — Obvious 4×1.4 m solid roof):** **REJECTED** (`0%` shade at `09:00`, sun az `102°`, el `37°`). Watch the 3D view tint crimson and snap to `09:00`.
    2. **Attempt 2 (`argon` — Narrow tensioned shade sail):** **REJECTED** (`13%` shade at `18:00`, sun az `272°`, el `29°` — fails the 40% worst-hour floor).
    3. **Attempt 3 (`argon` — Redesigned `shade_fabric` canopy):** **ACCEPTED** (**14% → 77% shade**, **£3,350 indicative** of £8,000 budget, passing every geometric and buildability rule).
- **Presenter Script:**
  > *"Now we ask **Gemini 4 Argon** to design an upgrade under an £8,000 budget. Our golden rule: **Argon proposes; the deterministic verifier decides.**  
  > First, the obvious fix — swapping the existing 4×1.4 m roof panel for solid metal — is **rejected** by the verifier! Why? It returns the exact counterexample: at **09:00**, low morning sun (`37°` elevation) slips right under the narrow roof, leaving **0% shade**.  
  > We feed that exact geometric counterexample back to Argon via the Interactions API. Argon's first shade-sail attempt is also **rejected** at **18:00** (`13%` shade).  
  > On its redesign, Argon widens and shifts the tensioned shade-sail canopy across the solar path. The verifier **accepts** it: daily shade jumps from **14% to 77%** (`+63 pts`), worst-hour shade stays above 40%, and indicative cost is **£3,350** — **£0.22 per extra shaded passenger-hour**."*

---

### `2:05 – 2:35` | Act IV: Live Physics Control, Human Approval & Council Brief Export
- **Operator Action:**
  - Press `B` and `A` to toggle **BEFORE (14%)** vs **AFTER (77%)** at the same camera angle.
  - Scrub the **Time Slider** and adjust the **Louver / Canopy Angle** control live to show real-time shadow movement and numeric updates.
  - Click **✓ Approve design** in the Attempt 3 card, then click **📄 Export council brief** to download `shadowstop-osm-469771287-brief.json`.
- **Presenter Script:**
  > *"Nothing is a canned animation: as we scrub time or adjust louver geometry, shadows and ray-cast coverage update live. And because public infrastructure requires accountability, a council officer must explicitly **Approve** the verified design before exporting a full JSON **Council Brief** containing the provenance, counterexamples, and indicative business case."*

---

### `2:35 – 3:00` | Act V: Nano Banana Street Photo Render & Reality Photo Check
- **Operator Action:**
  - Under **See it on the real street**, select the Hackney street photo and click **Render the verified fix into this photo** (shows side-by-side *Today* vs *With the fix* rendered by `gemini-nano-banana-2.1`, badged `Verified: 77% shade`).
  - Under **Photo check**, run or display the timestamped photo check showing point-by-point agreement between observed pavement shadows and `engine.shade_at()`.
- **Presenter Script:**
  > *"Finally, **Nano Banana 2.1** renders only a **verifier-accepted** design directly into a real street photo for public consultation — clearly labelled as an illustration while the numbers remain strictly from the physics engine. And our **Photo Check** validates the 3D model itself against real timestamped street photos, matching predicted vs observed sun and shadow across the waiting area. Thank you!"*

---

## 3. Venue Wi-Fi Fallback Protocol ("Zero-Stall Guarantee")

If venue Wi-Fi drops or the live Gemini API takes longer than expected during the 3-minute slot:

| Failure Mode | Automatic / 1-Click Fallback | What the Judges See |
| :--- | :--- | :--- |
| **Overpass API times out during `/api/scan` or `/api/scene/from_osm`** | Automatic fallback to `scenes/cache/*.json` on disk, plus `CACHED_HACKNEY_STOPS` and `HACKNEY_HERO_SCENE` in `web/demo_presets.js`. | Instant `< 200 ms` load of real Hackney OSM stops and 3D buildings. |
| **Venue Wi-Fi slows `/api/propose` (> 15 s)** | Click the **Replay Verified Run** button (or load from `REPLAY_HACKNEY_PROPOSE` / `REPLAY_DEMO_PROPOSE` / `localStorage`). | Plays the exact 3-attempt verifier loop (`REJECTED 09:00` → `REJECTED 18:00` → `ACCEPTED 14% → 77%, £3,350`), clearly badged **`REPLAY (cached verified run)`**. |
| **Python backend process is stopped** | `web/app.js` automatically switches to `web/engine.js` (in-browser NOAA sun + ray caster) and `EMBEDDED_DEMO` / `demo_presets.js`. | Banner notes `Server offline: in-browser ray caster`; all 3D shadows, heatmaps, and time sliders continue working at 60 FPS. |

---

## 4. Top 5 Judge Q&A Answers (Backed by `engine.py` & `tests/test_engine.py`)

### Q1: *"How do you know Gemini isn't hallucinating the shade improvement or the cost?"*
- **Answer:** Gemini **cannot** set opacity, cost, or shade scores. In `shadowstop/engine.py` (`evaluate()`, lines 123–153) and `shadowstop/materials.py` (`apply_material()`, lines 50–60), the verifier overwrites any model-supplied opacity with the fixed material catalogue (`opaque_metal_roof = 1.0`, `shade_fabric = 0.85`, `street_tree = 0.7`, `solar_polycarbonate = 0.6`, `clear_polycarbonate = 0.1`) and computes cost strictly from plan area (`cost_fixed_gbp + cost_per_m2_gbp * area`). Shade is computed by vectorised ray-prism and ray-ellipsoid intersection in `geometry.py`.

### Q2: *"What are the exact mathematical criteria for the verifier to accept or reject a design?"*
- **Answer:** Every proposal must pass **five hard checks** in `engine.py` (lines 20–25, 89–153):
  1. **Minimum daily gain (`MIN_GAIN = 0.25`):** Mean shade across `09:00–18:00` (37 steps at 15-min intervals) at `SAMPLE_HEIGHT_M = 1.2 m` must increase by at least **+25 percentage points**.
  2. **Worst-hour floor (`MIN_WORST_TIME_SHADE = 0.40`):** At **no** sun-up timestamp between `09:00` and `18:00` may waiting-area shade drop below **40%**. (This is what catches the obvious roof at `09:00` and narrow sails at `18:00`).
  3. **Footprint & headroom (`MAX_CANOPY_AREA_M2 = 24.0`, `CANOPY_HEIGHT_RANGE = (2.3, 4.5)`):** Canopy area $\le 24\text{ m}^2$, underside clearance between $2.3\text{ m}$ and $4.5\text{ m}$ (or tree crown radius $\le 4.0\text{ m}$).
  4. **Buildable zone & collision (`check_constraints()`):** Proposal must lie strictly inside `buildable_area` (kerb/footway envelope, not over the carriageway) and have $< 0.01\text{ m}^2$ intersection with any OSM building footprint.
  5. **Budget cap:** Indicative cost must not exceed `budget_gbp` (e.g. `£8,000`).

### Q3: *"Why does the Multi-Turn Interactions API matter here versus a single prompt?"*
- **Answer:** Designing for 3D solar geometry across a 9-hour sun arc is non-trivial because low morning sun (`az ~102°, el ~37°`) and low afternoon sun (`az ~272°, el ~29°`) cast diagonal shadows offset from the shelter footprint. In `argon.py` (`propose_fix()`, lines 127–136), we chain attempts with `previous_interaction_id` on `gemini-4-argon` and feed back the verifier's exact counterexample timestamp, solar azimuth/elevation, and failure reason. Argon uses that geometric counterexample to shift and size its next proposal rather than guessing blindly.

### Q4: *"How did you validate that your solar and ray-casting physics engine is accurate?"*
- **Answer:** `tests/test_engine.py` contains **17 deterministic known-answer tests** against analytical trigonometry and astronomical benchmarks:
  - London summer solstice solar noon elevation (`61.9° ± 0.3°`, azimuth `180° ± 2°`).
  - Equator equinox overhead sun (`> 89°`), east sunrise / west sunset quadrants, and negative night elevation.
  - Exact $45^\circ$ pole shadow length trigonometry (a $3\text{ m}$ pole casts a $3.0\text{ m}$ shadow due north: point at $2.5\text{ m}$ is shaded, point at $3.5\text{ m}$ is in sun).
  - South building wall shading ($10\text{ m}$ wall at $40^\circ$ sun shades $10/\tan(40^\circ) = 11.9\text{ m}$ north).
  - Partial transmission through $0.1$ glass (`0.9` transmission) and $0.7$ ellipsoid tree crowns (`0.3` transmission).

### Q5: *"How does Argon help with input data quality when OpenStreetMap is incomplete?"*
- **Answer:** OSM tells us where bus stops and building footprints are, and often has `shelter=yes`, but rarely records whether a shelter roof is opaque metal or clear glass, or where street trees sit if unmapped. `argon.read_scene()` (`/api/read-scene`) takes street-level photos, identifies map discrepancies (such as a clear polycarbonate roof or unmapped tree), and updates occluder opacities with explicit provenance badges (`OSM` vs `argon` vs `measured`) and confidence scores — and `/api/photo-check` then tests the resulting 3D model against real shadows in timestamped photos.
