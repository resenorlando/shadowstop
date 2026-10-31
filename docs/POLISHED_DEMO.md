# Polished demo

Run `./run.ps1` and open `/demo.html` (also the default `/` route). The original workbench remains at `/index.html`; the earlier map story remains at `/story.html`.

## A 45-second presentation

1. Open on the real Hackney aerial view: 14% existing daily shade, 77% with the recorded design.
2. Select **Explore this stop**. The camera moves into the site and the recorded proposal history appears. Expand a counterexample to explain a rejection.
3. Select **Proposed**, then the shade-layer button (half circle). Drag the time slider. The numeric waiting-area results are sampled at 1.2 m; the optional map layer shows ground-level ray casting at 5 cm.
4. Select **See the difference**. Drag across the historic source photo and the archived AI illustration. The image is explicitly illustrative.
5. **Review council brief** requires current local verification and an explicit operator-review checkbox before text export.

The recorded proposal geometry is in `scenes/hackney_verified.json`. `/api/demo/verified` reevaluates it using the current engine and returns fresh before/after series plus rule metadata. The historical rejection trace can include earlier rule windows; current rules are shown in the methodology dialog. A new live design uses `/api/propose`; its resulting geometry and metrics replace the recorded run only after an accepted result. The old illustration is removed for a new design so it cannot be confused with that new geometry.

## Optional Google services

Set `GOOGLE_MAPS_API_KEY` in the process or Windows user environment, enable **Map Tiles API** for photorealistic 3D, then restart. **Solar API** is separately required for the optional nearest-building context. The key must permit server-side requests. No credential is sent to the browser or stored in the repository. Gemini keys are not reused.

The 3D button checks live access before loading Cesium. `/api/google/tiles/` proxies only Google's fixed tile origin, strips credentials from child JSON URLs, preserves session and attribution metadata, and does not persist tile data. Without credentials, aerial imagery, the deterministic sun timeline, shade layer, historic comparison and brief still work. Google access is not claimed as verified until a live request succeeds.

The optional Solar result describes the nearest building roof, not bus-stop shading. All waiting-area shade metrics remain outputs of `engine.py`. The street source photo is historic (2009), and the proposal image is an AI illustration. The original attribution is in `web/assets/CREDITS.md`.

## Validation

Run `python -m pytest -q` and `node --check web/demo.js`. Google proxy tests use mocks/test values and do not require a paid service or real key.
