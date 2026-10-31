# Hook film brief (shared by all agents)

Goal: a ~35 s, 1920x1080, 30 fps hook film for ShadowStop (Gemini 4 Argon hackathon, London; judges watch the video and read the repo). It must replicate the FORMAT of the viral "patio" video as closely as possible:
- Inspiration video: `/root/.claude/uploads/f261938e-6d56-5267-8a48-f3a0497ae03e/1bf3151f-1_patio_fable_-_Search_X.mp4` (12.6 s). One frame per second, already extracted: `/tmp/claude-0/-home-user-shadowstop/f261938e-6d56-5267-8a48-f3a0497ae03e/scratchpad/insp/i_01.png` … `i_13.png`. LOOK AT THEM.
- Its format: near-black terminal "agent console"; top text is the tweet hook; a left column with a scrolling, timestamped agent log (monospace, tiny, dense, coloured status words); a big main panel cutting fast: aerial → real photo → AI render of the fix → diagnosis postcard with a big serif address and a "11.0 hours of direct sun" badge with bar meter and a QR; a bottom status bar. Fast, confident, highly technical, viral.
- Its tweet hook (adapt the tone, NOT the content): "claude fable 5 can scrape thousands of sold homes and finds the patios with zero shade in 100°+ heat. then it mails the owner a postcard with the fix rendered into their own backyard."

Our story (problem → solution, the whole pipeline, and how Gemini is used):
Problem: on heatwave days Londoners wait for buses in full sun, often under "shelters" with clear roofs. Hackney Town Hall: 14% of the waiting area shaded across a July day.
Pipeline: (1) scans every bus stop in an area from OpenStreetMap (stops, buildings w/ heights, trees); (2) Gemini 4 Argon reads street photos and corrects the 3D scene (e.g. a "shelter" whose roof is clear glazing); (3) measures the sun on the waiting area every 15 min, 09:00–18:00 (NOAA sun position + ray casting at 1.2 m); (4) Argon designs shade from a material catalogue under a £8,000 budget; a deterministic verifier accepts/rejects every design with an exact counterexample (time + sun angle), Argon redesigns; (5) a human approves; (6) Nano Banana 2.1 draws the VERIFIED design into the real street photo; (7) a council brief / postcard with the diagnosis.

REAL DATA ONLY (judges inspect the repo; never invent numbers). Read `web/assets/hero.json`:
- stats: shade 14% → 77%, sun_hours 7.7 → 2.1 h, wait10_sun_min 8.6 → 2.3, uv_cut 73%, cost £3,350 indicative, £0.45 per extra shaded passenger-hour, 938 extra shaded passenger-hours/yr (assumptions in value_assumptions).
- attempts: #1 obvious fix (opaque metal roof, £4,290) REJECTED: "shade gain +14 pts is below the +25 pt bar; at 09:00 (sun az 99 deg, el 34 deg) only 0% of the waiting area is shaded"; #2 Argon shade sail (£3,360) REJECTED at 18:00 (az 271, el 26) only 13% shaded; #3 Argon redesign ACCEPTED 77%, £3,350, tensioned shade-sail fabric.
- stop: Hackney Town Hall, Mare Street, osm-469771287, 51.5452, -0.0554; date 2026-07-19.
- OSM cache counts: 599 buildings, 17 bus stops in the cached area (scenes/cache).
Assets: real photo `web/assets/hackney_mare_street.jpg` (credit "Mare Street by Cjc13 (CC BY-SA 3.0, Wikimedia Commons)" must appear when shown); Nano Banana illustration `web/assets/hackney_mare_street_after.jpg` (must be labelled as an illustration of the verified design); verifier-rendered film `docs/shadowstop_film.mp4` (extract stills with ffmpeg: ~5.5 s map scan, ~13.5 s thermal exposure grid, ~27.5 s agent-loop panel, ~35 s before/after split); `docs/screenshot.png` (the live app UI). Scene data: `scenes/hackney_town_hall.json`, `scenes/hackney_accepted.json`; engine in `shadowstop/engine.py`.
Honesty rules: shade = geometric direct-sun shading at 1.2 m, NOT temperature (never print °C or "temperature"); costs "indicative"; the Argon loop is a "recorded run"; Nano Banana image = "illustration"; "Map © OpenStreetMap contributors" when the map shows. A colour "heat" look is fine if labelled "direct-sun exposure".

Tech: Python + Pillow 12 (numpy ok), fonts: Inter at `/usr/share/fonts/opentype/inter/` (Inter-Bold.otf, Inter-Black.otf, Inter-SemiBold.otf, Inter-Medium.otf, InterDisplay-*.otf), DejaVu Mono/Serif at `/usr/share/fonts/truetype/dejavu/`. ffmpeg available. No network (pip from PyPI works). No browser.

LAYOUT CONTRACT (all modules must follow, canvas 1920x1080):
- MAIN panel: x=552, y=96, w=1336, h=840 (the big image area).
- LEFT log column: x=32..528, y=96..1032.
- CAPTION strip: x=552..1888, y=948..1032.
- TOP bar: y=0..84 (hook text lives here or over MAIN during the intro). BOTTOM status bar: y=1040..1080.
Palette: bg (8,9,11), panel (16,17,20), amber (255,159,67), cyan (90,220,255), red (255,84,84), green (80,230,140), text (225,228,232), dim (110,116,124).

Baseline draft (ran never, use for ideas only): `showcase-tools/render_hook.py`.
Do NOT run git. Do not edit files outside your assigned module. Each module must be importable (`import hook.<name>` with `showcase-tools` on sys.path) and must render a test PNG/MP4 into the scratchpad for self-inspection (look at it with the Read tool and iterate).
