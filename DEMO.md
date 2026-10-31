# 3-minute stage demo: ShadowStop

**Setup before going on stage:**
- Server running (`python -m uvicorn shadowstop.server:app --port 8000`); browser on http://localhost:8000, full screen.
- The Hackney scan already run once, so it's cached.
- The street photo of a real stop is on the desktop.
- Backup video ready in another tab.

| Time | Do | Say |
|---|---|---|
| **0:00–0:15** | The map is already open on Hackney. Click **Scan this area**. Red and green dots appear, with the ranked list | "On a summer heatwave day, people wait for buses in full sun. This is every bus stop around Hackney Town Hall, scored by how much shade people waiting there actually get." |
| **0:15–0:35** | Click the worst stop, **Hackney Town Hall**. The 3D scene loads. Press **play**: the sun sweeps and shadows move | "The map says this stop has a shelter. On a July day, the waiting area is shaded **14%** of the time. At 9 am, nobody's in shade at all." |
| **0:35–1:35** | Budget **£8,000** → **Ask Argon to fix it**. While it runs, point at the attempt log as cards appear | "The obvious fix, a solid roof, gets **rejected** by our verifier: real sun geometry and ray casting, no AI. Argon's first design is a shade sail, also **rejected**, because at 6 pm the low western sun gets under it. Argon reads that exact counterexample and redesigns. **Accepted: 14% → 77%, for about £3,350.**" |
| **1:35–1:55** | Drag the time slider to **18:00** and toggle **Before / After** | "Every number here is computed from the sun's position. The model proposes; the geometry decides." |
| **1:55–2:20** | Business-case box → **Approve design** → **Export council brief** | "Indicative cost, extra shaded passenger-hours a year, cost per shaded hour. A person approves before anything leaves the tool. For scale, TfL's new shelters cost about £12,500–£24,500." |
| **2:20–2:50** | **Render the verified fix into this photo** (the real stop photo) | "And here's what that verified design looks like on the real street, drawn by Nano Banana. Only designs that pass the verifier get drawn." |
| **2:50–3:00** | Back to the map | "ShadowStop: find the stops that leave people in the sun, and design shade that's proven to work." |

**If something is slow:** the Argon loop takes about 60 s. Talk through the attempt cards as they arrive. If the network dies, use the demo scene (Load demo; the loop is ~20 s) or the backup video.

**Likely judge questions:**
- *"How do you know the shade numbers are right?"*
  - Known-answer tests: the solstice sun angle, a 3 m pole casting a 3 m shadow at 45°, low sun slipping under a roof, glass vs solid.
  - The photo check compares predicted sun/shade with a real timestamped photo.
  - The verifier contains no model calls.
- *"Why do you need Argon if the verifier does the maths?"*
  - The verifier can only *check* a design. Argon *creates* it: it reads the scene, weighs materials and budget, and learns from each rejection.
  - On the demo stop, Argon's design beats our brute-force reference search.
- *"Are the costs real?"* They're indicative planning assumptions, editable in `materials.py`, and labelled as such. They're for comparing options, not quotes.
