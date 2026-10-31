# ShadowStop stage runbook (3 min demo + 1 min Q&A)

The film is the intro; the live 3D scene is the proof. Never rely on the film alone.

## Pre-flight (do this before walking on)
1. Start the server: `python -m uvicorn shadowstop.server:app --port 8000`.
2. Open these tabs in this order, full screen (F11), and leave them loaded:
   - **Tab 1, film:** `showcase-tools/out/shadowstop_demo.mp4` in a video player. If there is no MP4, use http://localhost:8000/story_v2.html and press Play.
   - **Tab 2, live app:** http://localhost:8000/index.html?scene=hackney. This opens the verified Hackney Town Hall scene with the accepted design already loaded. Check that the right panel reads **14% → 77%**. If the large diagnosis card covers the 3D view, click it once to dock it.
   - **Tab 3, backup 3D:** http://localhost:8000/hero3d.html. This is a standalone verified scene that needs no map tiles.
   - **Tab 4, backup cards:** `docs/cards/problem.png`, `intelligence.png`, `result.png`.
3. In Tab 2, click **Replay last run** once so the attempt log is cached. It works offline: if localStorage is empty it rebuilds the recorded run from `assets/hero.json` and `scenes/hackney_accepted.json`.
4. Drag the time slider once and confirm the shadows move.

## The 3 minutes
| Time | On screen | Say (roughly) |
|---|---|---|
| 0:00–0:55 | **Film** | Let it play; talk over it lightly. "A real bus stop in Hackney. On a July heatwave day its glass-roofed shelter shades the waiting area 14% of the time." |
| 0:55–1:35 | **Tab 2, live**: drag the slider 09:00 → 13:00 → 18:00 | "This is the working app, not the video. Drag the sun: the sun angle comes from NOAA, and the shade number is the engine ray-casting 0.5 m cells at 1.2 m height. Press **B**: the existing shelter, 0% at 09:00. Press **A**: Argon's design, 47% at the same moment." |
| 1:35–2:15 | Tab 2: **Replay last run** (log on the right) | "Argon proposes and the verifier decides. The obvious solid roof is rejected: only 24% shaded at 15:30, in peak heat, and +14 points over the day is below the bar. Argon's first sail was rejected in the recorded run: 13% at 18:00, low western sun. That exact counterexample goes back to Argon, and the redesign is accepted: 14% → 77%, £3,350 indicative." |
| 2:15–2:40 | Tab 2: approve, then **Export council brief** (optional) | "A human approves before anything is exported for the council." |
| 2:40–3:00 | Tab 3 **Split**, or the result card | "Same camera, same sun, before and after. Gemini designs; physics proves." |

If the live app misbehaves: switch to **Tab 3** (same verified scene, works offline). If that also fails, use the **cards**.

## Q&A, grounded answers
- **What is 77%?** The share of sampled waiting-area time from 09:00 to 18:00 on 19 July 2026 that is out of direct sun at 1.2 m height (37 sun positions × the waiting-area grid). It is geometric direct-sun shade. It is **not** air temperature and **not** a measured UV dose.
- **Who decides?** `engine.py`, deterministically. Argon proposes geometry and materials from a fixed catalogue. Opacity and cost come from the catalogue, never from the model.
- **£3,350?** An indicative figure from the material catalogue (fixed + per-m² rate). It is not a quote.
- **The after photo?** An architectural illustration of the verified design, made by Nano Banana 2.1. It is not a photograph and not a source of any number.
- **The 3D?** OpenStreetMap buildings and trees, with the shelter roof and the accepted design exactly as verified. Shadows are cast by that geometry; partial opacity shows as dappled shade. Masts and people are illustrative.
- **Argon's rejected sail:** its geometry wasn't saved. The film shows the existing stop at the counterexample time (18:00), labelled as such. That rejection is from the recorded run. The verifier has since been changed to apply its worst-moment rule only in the 11:00–16:00 peak-heat window, so if asked, say that 18:00 was the rule at the time of the run.
- **Obvious fix:** the verifier's current reason (in `hero.json`) is +14 points (below the +25 bar) and only 24% shaded at 15:30. It is also 0% shaded at 09:00.
