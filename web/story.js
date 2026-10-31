// ShadowStop Live: interactive satellite-analysis view. Every number shown comes from the API
// (/api/scan, /api/scene/from_osm, /api/heatgrid, /api/propose, /api/score) or assets/hero.json.
(() => {
  const $ = (id) => document.getElementById(id);
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const DATE = '2026-07-19', UTC_OFF = 1;
  const HERO_ID = 'osm-469771287';
  const HACKNEY_BOX = { south: 51.5425, west: -0.0600, north: 51.5475, east: -0.0500 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pct = (v) => Math.round(v) + '%';
  const gbp = (v, dp = 0) => '£' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 6000); }
  async function api(path, { method = 'GET', body, timeout = 30000 } = {}) {
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(path, { method, signal: ctrl.signal, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 160));
      return await r.json();
    } catch (e) { if (e.name === 'AbortError') throw new Error('timeout ' + timeout / 1000 + 's'); throw e; }
    finally { clearTimeout(tm); }
  }

  // ---------------------------------------------------------------- sun (NOAA-style, matches server convention)
  function sunPos(lat, lon, hour) {
    const rad = Math.PI / 180, [Y, M, D] = DATE.split('-').map(Number);
    const N = Math.round((Date.UTC(Y, M - 1, D) - Date.UTC(Y, 0, 0)) / 864e5);
    const B = (360 / 365) * (N - 81) * rad;
    const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    const decl = 23.44 * Math.sin((360 / 365) * (N + 284) * rad) * rad;
    const H = 15 * (hour - UTC_OFF + lon / 15 + eot / 60 - 12) * rad, phi = lat * rad;
    const el = Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H));
    let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / rad + 180;
    return { az: ((az % 360) + 360) % 360, el: el / rad };
  }
  function sunTimes(lat, lon) {
    let rise = null, set = null;
    for (let m = 3 * 60; m < 23 * 60; m++) { const e = sunPos(lat, lon, m / 60).el; if (rise == null && e > -0.83) rise = m; if (rise != null && e > -0.83) set = m; }
    const f = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    return [f(rise), f(set)];
  }

  // ---------------------------------------------------------------- map
  $('hudDate').textContent = DATE;
  const map = new maplibregl.Map({
    container: 'map', center: [-0.085, 51.528], zoom: 11.5, pitch: 50, bearing: -15, maxPitch: 85,
    attributionControl: { compact: false, customAttribution: '© OpenFreeMap © OpenStreetMap contributors' },
    style: {
      version: 8,
      sources: {
        esri: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
        openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      },
      layers: [
        { id: 'sat', type: 'raster', source: 'esri', paint: { 'raster-saturation': -0.15, 'raster-contrast': 0.08 } },
        { id: 'bldg', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
          paint: {
            'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 10], 0, '#b9a48f', 10, '#a8826a', 20, '#8f6f5e', 40, '#7a6a62'],
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true,
          } },
      ],
    },
  });
  let simHour = 13;
  function setSun(az, el, label) {
    try { map.setLight({ anchor: 'map', position: [1.5, az, Math.max(5, Math.min(89, 90 - el))], color: '#fff4e0', intensity: 0.55 }); } catch { /* ignore */ }
    $('hudSun').textContent = `sun az ${az.toFixed(1)}° el ${el.toFixed(1)}°${label ? ' · ' + label : ''}`;
  }
  function setSimHour(h) { simHour = h; const c = map.getCenter(); const s = sunPos(c.lat, c.lng, h); setSun(s.az, s.el, fmtH(h)); }
  const fmtH = (h) => String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');

  // orbit when idle in sequence
  let orbiting = false, lastT = performance.now();
  function tick(t) {
    const dt = (t - lastT) / 1000; lastT = t;
    if (orbiting && !map.isMoving()) map.setBearing(map.getBearing() + dt * 2.2);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------------------------------------------------------------- HUD log (typewriter)
  const logEl = $('log');
  function ts() { const d = new Date(); return d.toTimeString().slice(0, 8); }
  async function log(text, cls = '') {
    logEl.style.display = 'block';
    const ln = document.createElement('div'); ln.className = 'ln ' + cls;
    ln.innerHTML = `<span class="t">${ts()}</span><span class="x"></span><span class="cursor"></span>`;
    logEl.appendChild(ln);
    while (logEl.children.length > 14) logEl.firstChild.remove();
    const x = ln.querySelector('.x');
    for (let i = 0; i <= text.length; i += 2) { x.textContent = text.slice(0, i); await sleep(9); }
    x.textContent = text; ln.querySelector('.cursor').remove();
  }
  const clearLog = () => { logEl.innerHTML = ''; };

  // ---------------------------------------------------------------- stops
  const markers = new Map();
  function scoreColor(s) { const t = Math.max(0, Math.min(1, (s ?? 0.5) / 0.6)); return `hsl(${Math.round(t * 130)}, 95%, 55%)`; }
  function addStops(stops) {
    for (const s of stops) {
      if (markers.has(s.id)) continue;
      const el = document.createElement('div');
      el.className = 'stopm';
      const c = scoreColor(s.score);
      el.style.background = c; el.style.color = c; el.style.boxShadow = `0 0 14px ${c}`;
      el.innerHTML = `<span class="lbl">${esc(s.name || s.id)} · ${s.score != null ? Math.round(s.score * 100) + '% shade' : ''}</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); runSequence(s); });
      markers.set(s.id, new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map));
    }
  }
  async function scan(box, limit, label) {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Number(v).toFixed(5)])), limit });
    log(`SCAN ${label} bbox [${box.south.toFixed(4)}, ${box.west.toFixed(4)}, ${box.north.toFixed(4)}, ${box.east.toFixed(4)}]…`);
    const r = await api('/api/scan?' + q, { timeout: 150000 });
    const stops = r.stops || [];
    addStops(stops);
    const worst = [...stops].sort((a, b) => (a.score ?? 1) - (b.score ?? 1))[0];
    await log(`${stops.length} bus stops scored${worst ? ` · worst: ${worst.name} ${Math.round(worst.score * 100)}% shade` : ''}`, 'ok');
    return stops;
  }
  $('scanBtn').addEventListener('click', async () => {
    const b = map.getBounds(), btn = $('scanBtn');
    btn.disabled = true;
    try { await scan({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, 40, 'view'); }
    catch (e) { toast('Scan failed: ' + e.message); log('scan failed: ' + e.message, 'err'); }
    finally { btn.disabled = false; }
  });

  // ---------------------------------------------------------------- geometry helpers (local metres <-> lat/lon)
  let origin = null;
  const toLL = (x, y) => [origin.lon + x / (111320 * Math.cos((origin.lat * Math.PI) / 180)), origin.lat + y / 110540];
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function occFootprint(o) {
    if (o.footprint) return o.footprint;
    const [cx, cy] = o.center || [0, 0];
    if (o.shape === 'box') {
      const [sx, sy] = o.size || [1, 1], r = ((o.rotation_deg || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      return [[-sx / 2, -sy / 2], [sx / 2, -sy / 2], [sx / 2, sy / 2], [-sx / 2, sy / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
    }
    const rad = o.radius ?? 1;
    return Array.from({ length: 20 }, (_, k) => [cx + rad * Math.cos((k / 20) * 2 * Math.PI), cy + rad * Math.sin((k / 20) * 2 * Math.PI)]);
  }

  // ---------------------------------------------------------------- thermal overlay
  const RAMP = [[0, [11, 26, 110]], [25, [0, 213, 255]], [55, [255, 225, 74]], [75, [255, 138, 31]], [90, [255, 42, 26]], [100, [255, 241, 224]]];
  function ramp(v) {
    for (let i = 1; i < RAMP.length; i++) if (v <= RAMP[i][0]) {
      const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i], t = (v - a) / (b - a);
      return ca.map((c, k) => Math.round(c + (cb[k] - c) * t));
    }
    return RAMP[RAMP.length - 1][1];
  }
  const SCALE = 8;
  const small = document.createElement('canvas'), big = document.createElement('canvas');
  let grid = null;      // current heatgrid (before)
  let gridAfter = null; // after heatgrid
  function drawGrid(arr, g, arrB = null, wipeCol = -1) {
    small.width = g.nx; small.height = g.ny;
    const sg = small.getContext('2d'), img = sg.createImageData(g.nx, g.ny);
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const v = arrB && i < wipeCol ? arrB[j * g.nx + i] : arr[j * g.nx + i];
      const p = ((g.ny - 1 - j) * g.nx + i) * 4; // canvas row 0 = north
      if (v == null || v < 0) { img.data[p + 3] = 0; continue; }
      const [r, gg, b] = ramp(v);
      img.data[p] = r; img.data[p + 1] = gg; img.data[p + 2] = b; img.data[p + 3] = Math.round(140 + v * 0.6);
    }
    sg.putImageData(img, 0, 0);
    big.width = g.nx * SCALE; big.height = g.ny * SCALE;
    const bg = big.getContext('2d');
    bg.clearRect(0, 0, big.width, big.height);
    bg.filter = 'blur(2px)'; bg.imageSmoothingEnabled = true;
    bg.drawImage(small, 0, 0, big.width, big.height);
    bg.filter = 'none';
    if (wipeCol >= 0 && wipeCol <= g.nx) { bg.fillStyle = '#3de8ff'; bg.fillRect(wipeCol * SCALE - 1, 0, 3, big.height); }
    const url = big.toDataURL();
    const src = map.getSource('heat');
    const half = g.step / 2;
    const x0 = g.xs[0] - half, x1 = g.xs[g.nx - 1] + half, y0 = g.ys[0] - half, y1 = g.ys[g.ny - 1] + half;
    const coords = [toLL(x0, y1), toLL(x1, y1), toLL(x1, y0), toLL(x0, y0)];
    if (src) src.updateImage({ url, coordinates: coords });
    else {
      map.addSource('heat', { type: 'image', url, coordinates: coords });
      map.addLayer({ id: 'heat', type: 'raster', source: 'heat', paint: { 'raster-opacity': 0.72, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, 'bldg');
    }
  }
  function waIdx(g) {
    const wa = g.waiting_area || [];
    const idx = [];
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) if (pointInPoly(g.xs[i], g.ys[j], wa)) idx.push(j * g.nx + i);
    if (!idx.length && wa.length) { // waiting area smaller than a cell: nearest cell to its centroid
      const cx = wa.reduce((a, p) => a + p[0], 0) / wa.length, cy = wa.reduce((a, p) => a + p[1], 0) / wa.length;
      let best = 0, bd = 1e9;
      for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const d = (g.xs[i] - cx) ** 2 + (g.ys[j] - cy) ** 2; if (d < bd) { bd = d; best = j * g.nx + i; } }
      idx.push(best);
    }
    return idx;
  }
  function exposureSeries(g) {
    if (g.waiting_area_sun_pct?.length === g.frames.length) return g.waiting_area_sun_pct;
    const idx = waIdx(g);
    return g.frames.map((f) => { const v = idx.map((k) => f[k]).filter((x) => x >= 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
  }
  function drawSpark(series, k, series2) {
    const cv = $('spark'), c = cv.getContext('2d'), W = cv.width, H = cv.height;
    c.clearRect(0, 0, W, H);
    c.strokeStyle = 'rgba(61,232,255,.15)'; c.lineWidth = 1;
    for (const y of [0, 0.5, 1]) { c.beginPath(); c.moveTo(0, 6 + y * (H - 12)); c.lineTo(W, 6 + y * (H - 12)); c.stroke(); }
    const line = (s, col) => {
      c.strokeStyle = col; c.lineWidth = 3; c.beginPath();
      s.forEach((v, i) => { const x = (i / (s.length - 1)) * W, y = 6 + (1 - v / 100) * (H - 12); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
    };
    line(series, '#ff8a1f');
    if (series2) line(series2, '#2ee68a');
    if (k != null) { const x = (k / (series.length - 1)) * W; c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  }
  function setWaitingArea(wa) {
    const ring = wa.map(([x, y]) => toLL(x, y)); ring.push(ring[0]);
    const data = { type: 'Feature', geometry: { type: 'LineString', coordinates: ring } };
    if (map.getSource('wa')) map.getSource('wa').setData(data);
    else {
      map.addSource('wa', { type: 'geojson', data });
      map.addLayer({ id: 'wa-glow', type: 'line', source: 'wa', paint: { 'line-color': '#3de8ff', 'line-width': 10, 'line-blur': 6, 'line-opacity': 0.6 } });
      map.addLayer({ id: 'wa', type: 'line', source: 'wa', paint: { 'line-color': '#ffffff', 'line-width': 2.5 } });
    }
  }
  let pulseT = 0;
  setInterval(() => { pulseT += 0.15; if (map.getLayer('wa')) map.setPaintProperty('wa', 'line-opacity', 0.55 + 0.45 * Math.sin(pulseT)); }, 60);
  function setCanopy(proposals) {
    const feats = (proposals || []).map((p) => {
      const ring = occFootprint(p).map(([x, y]) => toLL(x, y)); ring.push(ring[0]);
      const isTree = p.kind === 'tree';
      return { type: 'Feature', properties: { base: isTree ? (p.z0 ?? 3) : (p.z0 ?? 2.5), top: p.z1 ?? 3, color: isTree ? '#3fae4a' : '#ff8a1f' }, geometry: { type: 'Polygon', coordinates: [ring] } };
    });
    const data = { type: 'FeatureCollection', features: feats };
    if (map.getSource('canopy')) map.getSource('canopy').setData(data);
    else {
      map.addSource('canopy', { type: 'geojson', data });
      map.addLayer({ id: 'canopy', type: 'fill-extrusion', source: 'canopy', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-opacity': 0.95 } });
    }
  }
  function clearOverlays() {
    for (const id of ['heat', 'wa', 'wa-glow', 'canopy']) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of ['heat', 'wa', 'canopy']) if (map.getSource(id)) map.removeSource(id);
  }

  // ---------------------------------------------------------------- day animation
  let playToken = 0;
  async function playDay(g, seconds = 10, { gB = null, label = '' } = {}) {
    const my = ++playToken;
    const series = exposureSeries(g), seriesB = gB ? exposureSeries(gB) : null;
    $('clock').style.display = 'block'; $('clockSub').style.display = 'block'; $('side').style.display = 'block'; $('legend').style.display = 'block';
    $('clockSub').textContent = label;
    const n = g.frames.length, dt = (seconds * 1000) / n;
    for (let k = 0; k < n; k++) {
      if (my !== playToken) return;
      drawGrid(g.frames[k], g);
      $('clock').textContent = g.times[k];
      const s = g.sun?.[k]; if (s) setSun(s.az, s.el, g.times[k]);
      $('expo').textContent = pct(series[k]);
      $('expo').style.color = series[k] > 50 ? '#ff5a3a' : '#3de8ff';
      drawSpark(seriesB || series, k, seriesB ? series : null);
      await sleep(dt);
    }
  }
  function summarize(g) {
    const s = exposureSeries(g);
    let pk = 0; s.forEach((v, i) => { if (v > s[pk]) pk = i; });
    $('peak').textContent = `${g.times[pk]} · ${pct(s[pk])}`;
    $('gridInfo').textContent = `${g.nx}×${g.ny} @ ${g.step} m · ${g.times.length} t`;
    return { series: s, peak: g.times[pk] };
  }
  let dailyOn = false;
  $('dailyBtn').addEventListener('click', () => {
    const g = gridAfter || grid; if (!g) return;
    dailyOn = !dailyOn; $('dailyBtn').classList.toggle('on', dailyOn);
    playToken++;
    if (dailyOn) { drawGrid(g.daily, g); $('clock').textContent = 'DAILY'; $('legendK').textContent = 'Daily direct sun · 09:00–18:00'; }
    else { $('legendK').textContent = 'Direct sun · thermal ramp'; drawGrid(g.frames[Math.floor(g.frames.length / 2)], g); }
  });
  $('replayDay').addEventListener('click', () => { const g = gridAfter || grid; if (g) { dailyOn = false; $('dailyBtn').classList.remove('on'); playDay(g, 10, { gB: gridAfter ? grid : null, label: gridAfter ? 'AFTER · verified design' : 'BEFORE' }); } });

  // ---------------------------------------------------------------- Argon panel
  async function proposeWithTrace(scene, demo) {
    const panel = $('argon'); panel.style.display = 'block'; $('side').style.display = 'none';
    $('atts').innerHTML = ''; $('argonTrace').innerHTML = '';
    const t0 = performance.now();
    const elT = setInterval(() => { $('argonElapsed').textContent = `thinking · ${((performance.now() - t0) / 1000).toFixed(1)} s · Interactions API`; }, 100);
    const occ = scene.occluders || [];
    const trace = [
      `context: ${occ.length} occluders, waiting area ${(scene.waiting_area || []).length}-gon, hours ${scene.hours?.join('–')}`,
      `constraint: budget £8,000 · buildable area · material catalogue`,
      `objective: maximise verified shade over the waiting area`,
      `submitting candidates to the ray-casting verifier…`,
    ];
    (async () => { for (const t of trace) { if (!panel.style.display || panel.style.display === 'none') return; $('argonTrace').insertAdjacentHTML('beforeend', `<div>› ${esc(t)}</div>`); await sleep(1200); } })();
    let res = null, fromCache = false;
    try {
      res = await api('/api/propose', { method: 'POST', body: { scene, budget_gbp: 8000 }, timeout: demo ? 75000 : 150000 });
    } catch (e) {
      if (demo && hero) { res = { attempts: hero.attempts, final_scene: null }; fromCache = true; log('propose slow (' + e.message + '): replaying cached Argon run from hero.json', 'warn'); }
      else { clearInterval(elT); throw e; }
    }
    clearInterval(elT);
    $('argonElapsed').textContent = fromCache ? 'REPLAY of cached run (assets/hero.json)' : `done in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    const atts = res.attempts || [];
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      const mat = a.material_label || res.materials?.[a.material]?.label || (a.material ? String(a.material).replace(/_/g, ' ') : '');
      const el = document.createElement('div');
      el.className = 'att ' + (a.accepted ? 'ok' : 'bad');
      el.innerHTML = `<div class="h"><span>Attempt ${i + 1}${a.by ? ' · ' + esc(a.by) : ''}${a.score_after != null ? ' · ' + Math.round((a.score_after.score ?? a.score_after) * 100) + '% shade' : ''}</span><span class="stamp">${a.accepted ? 'ACCEPTED' : 'REJECTED'}</span></div>
        <div class="r">${esc(String(a.reason || '').slice(0, 150))}</div>
        <div class="m">${esc(mat)}${a.cost_gbp != null ? ' · ' + gbp(a.cost_gbp) + ' indicative' : ''}${a.worst_time ? ' · worst ' + esc(a.worst_time) : ''}</div>`;
      $('atts').appendChild(el);
      gsap.from(el, { x: 60, opacity: 0, duration: 0.5, ease: 'power3.out' }); el.scrollIntoView({ block: 'nearest' });
      if (!a.accepted && a.worst_time) {
        $('clock').style.display = 'block'; $('clock').textContent = a.worst_time; $('clock').classList.add('flash');
        $('clockSub').style.display = 'block'; $('clockSub').textContent = 'COUNTEREXAMPLE · verifier found sun on the waiting area';
        const [h, m] = a.worst_time.split(':').map(Number); setSimHour(h + m / 60);
        await sleep(1900); $('clock').classList.remove('flash');
      } else await sleep(1600);
    }
    return { res, fromCache, accepted: [...atts].reverse().find((a) => a.accepted) || null };
  }

  // ---------------------------------------------------------------- stats + photo
  function sunHours(byTime) { return byTime.reduce((a, b) => a + ((b.sun_el ?? 1) > 0 ? (1 - b.shade) * 0.25 : 0), 0); }
  function countUp(el, to, dp = 0, prefix = '', suffix = '') {
    const o = { v: 0 };
    gsap.to(o, { v: to, duration: 1.4, ease: 'power2.out', onUpdate: () => { el.textContent = prefix + o.v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp }) + suffix; } });
  }
  function showStats(name, S) {
    const p = $('stats');
    p.innerHTML = `<button class="close" id="statsClose">✕</button>
      <div class="k">ShadowStop · verified result · ${DATE}</div><div class="stop">${esc(name)}</div>
      <div class="grid">
        <div class="st"><div class="l">Waiting area shaded over the day</div><div class="v"><span class="a" id="v1a"></span><span class="ar">→</span><span class="b" id="v1b"></span></div></div>
        <div class="st"><div class="l">Direct sun per 10-minute wait</div><div class="v"><span class="a" id="v2a"></span><span class="ar">→</span><span class="b" id="v2b"></span><span style="font-size:18px;color:#7f97a4"> min</span></div></div>
        <div class="st"><div class="l">Sun hours on the waiting area</div><div class="v"><span class="a" id="v3a"></span><span class="ar">→</span><span class="b" id="v3b"></span><span style="font-size:18px;color:#7f97a4"> h</span></div></div>
        <div class="st"><div class="l">Direct-beam UV exposure cut</div><div class="v"><span class="b" id="v4"></span></div></div>
        <div class="st"><div class="l">Indicative cost${S.material ? ' · ' + esc(S.material) : ''}</div><div class="v" id="v5">—</div></div>
        <div class="st"><div class="l">£ per extra shaded passenger-hour</div><div class="v"><span class="b" id="v6">—</span></div></div>
      </div>
      <div class="foot">Every number computed by ShadowStop's sun-geometry verifier (NOAA ephemeris + ray casting, 15-min steps). Costs are indicative planning assumptions, not quotes. Shade = geometric direct-sun shading, not temperature.</div>`;
    p.style.display = 'block';
    gsap.from(p, { opacity: 0, scale: 0.94, duration: 0.6, ease: 'power3.out' });
    countUp($('v1a'), S.bS * 100, 0, '', '%'); countUp($('v1b'), S.aS * 100, 0, '', '%');
    countUp($('v2a'), S.bMin, 1); countUp($('v2b'), S.aMin, 1);
    countUp($('v3a'), S.bh, 1); countUp($('v3b'), S.ah, 1);
    countUp($('v4'), S.uv, 0, '', '%');
    if (S.cost != null) countUp($('v5'), S.cost, 0, '£');
    if (S.perHour != null) countUp($('v6'), S.perHour, 2, '£');
    $('statsClose').addEventListener('click', () => (p.style.display = 'none'));
  }
  function showPhoto() {
    if (!hero?.photo_before) return;
    $('phB').src = hero.photo_before; $('phA').src = hero.photo_after;
    $('phCap').textContent = `Photo: ${hero.photo_credit || ''} · right side is an illustration of the verified design (Nano Banana 2.1); numbers come from the verifier.`;
    const set = (v) => { $('phA').style.clipPath = `inset(0 0 0 ${v}%)`; $('phDiv').style.left = v + '%'; $('phRange').value = v; };
    $('phRange').oninput = (e) => set(Number(e.target.value));
    $('photo').style.display = 'block';
    const o = { v: 100 };
    gsap.to(o, { v: 0, duration: 2.6, ease: 'power2.inOut', onUpdate: () => set(o.v), onComplete: () => gsap.to(o, { v: 50, duration: 1.2, ease: 'power2.inOut', onUpdate: () => set(o.v) }) });
  }

  // ---------------------------------------------------------------- Argon aerial analysis (/api/satellite-eye)
  async function satelliteEye(stop, demo) {
    const q = new URLSearchParams({ lat: stop.lat, lon: stop.lon, name: stop.name || '' });
    try { return await api('/api/satellite-eye?' + q, { timeout: demo ? 45000 : 60000 }); }
    catch (e) {
      if (stop.id === HERO_ID) { try { const c = await api('/scenes/_sat_eye.json', { timeout: 4000 }); c._cached = true; return c; } catch { /* none */ } }
      log('aerial analysis unavailable: ' + e.message, 'warn');
      return null;
    }
  }
  const EYE_COL = { shelter: '#3de8ff', tree_canopy: '#3de8ff', building_shadow: '#3de8ff', waiting_area: '#ffffff', hard_surface: '#ffb340', road: '#ff5a3a', other: '#ffb340' };
  let eyeMarkers = [];
  function clearEye() {
    eyeMarkers.forEach((m) => m.remove()); eyeMarkers = [];
    for (const id of ['eye-glow', 'eye']) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource('eye')) map.removeSource('eye');
  }
  async function showEye(eye) {
    const gr = eye.georef; if (!gr || !eye.detections?.length) return;
    const P = (x, y) => [gr.west + (x / gr.size) * (gr.east - gr.west), gr.north - (y / gr.size) * (gr.north - gr.south)];
    await log(`GEMINI 4 ARGON // AERIAL ANALYSIS${eye._cached ? ' (cached run)' : ''} · ${eye.detections.length} detections`, 'warn');
    clearEye();
    const feats = [];
    map.addSource('eye', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'eye-glow', type: 'line', source: 'eye', paint: { 'line-color': ['get', 'c'], 'line-width': 7, 'line-blur': 5, 'line-opacity': 0.45 } });
    map.addLayer({ id: 'eye', type: 'line', source: 'eye', paint: { 'line-color': ['get', 'c'], 'line-width': 1.6, 'line-dasharray': [3, 1.5] } });
    for (const d of eye.detections) {
      const [x0, y0, x1, y1] = d.box, c = EYE_COL[d.kind] || '#ffb340';
      const ring = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0)];
      feats.push({ type: 'Feature', properties: { c }, geometry: { type: 'LineString', coordinates: ring } });
      map.getSource('eye').setData({ type: 'FeatureCollection', features: feats });
      const el = document.createElement('div');
      el.style.cssText = `font:600 11px var(--mono);letter-spacing:1px;color:${c};background:rgba(4,6,10,.8);border:1px solid ${c};padding:2px 6px;border-radius:2px;white-space:nowrap;text-transform:uppercase;pointer-events:none`;
      el.textContent = `${d.label}${d.confidence != null ? ' · ' + Math.round(d.confidence * 100) + '%' : ''}`;
      eyeMarkers.push(new maplibregl.Marker({ element: el, anchor: 'bottom-left' }).setLngLat(P(x0, y0)).addTo(map));
      gsap.from(el, { opacity: 0, y: -8, duration: 0.4 });
      await log(`[${d.kind}] ${d.label}: ${String(d.finding || '').slice(0, 120)}`, d.kind === 'hard_surface' || d.kind === 'road' ? 'warn' : '');
      await sleep(500);
    }
    if (eye.summary) await log(`ARGON: ${eye.summary}`, 'ok');
    await sleep(1800);
  }

  // ---------------------------------------------------------------- the sequence
  let hero = null;
  fetch('assets/hero.json').then((r) => (r.ok ? r.json() : null)).then((h) => (hero = h)).catch(() => {});
  let running = false;
  async function runSequence(stop, { demo = false } = {}) {
    if (running) return; running = true;
    for (const id of ['stats', 'photo', 'argon']) $(id).style.display = 'none';
    clearLog(); clearOverlays(); grid = gridAfter = null; dailyOn = false; $('dailyBtn').classList.remove('on');
    orbiting = false;
    try {
      $('hudPlace').textContent = stop.name || stop.id;
      await log(`TARGET LOCK  ${stop.name || stop.id}  ${stop.lat.toFixed(6)}, ${stop.lon.toFixed(6)}`, 'warn');
      map.flyTo({ center: [stop.lon, stop.lat], zoom: 18.3, pitch: 65, bearing: map.getBearing() + 40, duration: 5000, curve: 1.5, essential: true });
      $('radar').style.display = 'block';
      const q = new URLSearchParams({ lat: stop.lat, lon: stop.lon, id: stop.id, name: stop.name || '' });
      const eyeP = satelliteEye(stop, demo);
      await log('Querying OpenStreetMap + Argon scene reconstruction…');
      const scene = await api('/api/scene/from_osm?' + q, { timeout: 90000 });
      origin = { lat: scene.lat, lon: scene.lon };
      const occ = scene.occluders || [];
      const nB = occ.filter((o) => o.kind === 'building').length, nT = occ.filter((o) => o.kind === 'tree').length;
      await log(`OSM: ${nB} buildings, ${nT} trees, ${occ.length - nB - nT} street objects within 70 m`, 'ok');
      const [rise, set] = sunTimes(scene.lat, scene.lon);
      await log(`Solar ephemeris ${DATE}: sunrise ${rise} → sunset ${set} (BST)`);
      setWaitingArea(scene.waiting_area || []);
      const hgP = api('/api/heatgrid', { method: 'POST', body: { scene, include_proposals: false, radius: 60, step: 2 }, timeout: 90000 });
      const scP = api('/api/score', { method: 'POST', body: { scene, include_proposals: false }, timeout: 60000 }).catch(() => null);
      hgP.catch(() => {});
      // Argon aerial analysis beat (runs while the verifier ray-casts)
      const eye = await eyeP;
      if (eye) await showEye(eye);
      grid = await hgP;
      clearEye();
      $('radar').style.display = 'none';
      await log(`Ray-casting ${grid.nx * grid.ny} ground cells × ${grid.times.length} timesteps = ${(grid.nx * grid.ny * grid.times.length).toLocaleString('en-GB')} sun rays`, 'ok');
      const sum = summarize(grid);
      orbiting = true;
      await playDay(grid, 10, { label: 'BEFORE · direct sun, July heatwave day' });
      await log(`Waiting area: peak direct-sun exposure at ${sum.peak}`, 'warn');
      const scoreB = await scP;

      // Argon designs, verifier decides
      orbiting = false;
      let { res, fromCache, accepted } = await proposeWithTrace(scene, demo);
      if (!accepted && demo && stop.id === HERO_ID && hero?.attempts) {
        await log(`Live run: no design passed the verifier in ${(res.attempts || []).length} attempts. Replaying the earlier verified run (assets/hero.json).`, 'warn');
        await sleep(1500);
        res = { attempts: hero.attempts, final_scene: null }; fromCache = true;
        accepted = [...hero.attempts].reverse().find((a) => a.accepted) || null;
        $('atts').innerHTML = '';
        $('argonElapsed').textContent = 'REPLAY of cached verified run (assets/hero.json)';
        for (const a of hero.attempts) {
          const el = document.createElement('div');
          el.className = 'att ' + (a.accepted ? 'ok' : 'bad');
          el.innerHTML = `<div class="h"><span>${esc(a.by || '')}${a.score_after != null ? ' · ' + Math.round((a.score_after.score ?? a.score_after) * 100) + '% shade' : ''}</span><span class="stamp">${a.accepted ? 'ACCEPTED' : 'REJECTED'}</span></div>
            <div class="r">${esc(String(a.reason || '').slice(0, 150))}</div><div class="m">${esc(a.material_label || a.material || '')}${a.cost_gbp != null ? ' · ' + gbp(a.cost_gbp) + ' indicative' : ''}</div>`;
          $('atts').appendChild(el); gsap.from(el, { x: 60, opacity: 0, duration: 0.5 }); el.scrollIntoView({ block: 'nearest' });
          await sleep(1400);
        }
      }
      if (!accepted) { await log('No design passed the verifier. Nothing is shown as a fix.', 'err'); return; }
      await log(`ACCEPTED: ${accepted.material || 'design'} · ${accepted.cost_gbp != null ? gbp(accepted.cost_gbp) : ''}`, 'ok');

      // AFTER
      let scoreA = null;
      if (res.final_scene && !fromCache) {
        setCanopy(res.final_scene.proposals);
        const hgA = api('/api/heatgrid', { method: 'POST', body: { scene: res.final_scene, include_proposals: true, radius: 60, step: 2 }, timeout: 90000 });
        const scA = api('/api/score', { method: 'POST', body: { scene: res.final_scene, include_proposals: true }, timeout: 60000 }).catch(() => null);
        gridAfter = await hgA;
        $('argon').style.display = 'none';
        // wipe before -> after on the daily map
        const g = gridAfter, o = { c: 0 };
        await new Promise((r) => gsap.to(o, { c: g.nx, duration: 2.4, ease: 'power2.inOut', onUpdate: () => drawGrid(grid.daily, g, g.daily, Math.round(o.c)), onComplete: r }));
        orbiting = true;
        summarize(gridAfter);
        await playDay(gridAfter, 10, { gB: grid, label: 'AFTER · verified design, same day, same sun' });
        scoreA = await scA;
      } else {
        $('argon').style.display = 'none';
      }

      // stats
      let S;
      if (stop.id === HERO_ID && hero?.stats && (fromCache || !scoreA)) {
        const s = hero.stats;
        S = { bS: s.shade_before_pct / 100, aS: s.shade_after_pct / 100, bMin: s.wait10_sun_min_before, aMin: s.wait10_sun_min_after, bh: s.sun_hours_before, ah: s.sun_hours_after, uv: s.uv_cut_pct, cost: s.cost_gbp, perHour: s.gbp_per_shaded_passenger_hour, material: hero.design?.material_label };
      } else {
        const bS = scoreB?.score ?? (accepted.score_before?.score ?? accepted.score_before);
        const aS = scoreA?.score ?? (accepted.score_after?.score ?? accepted.score_after);
        const bh = scoreB?.by_time ? sunHours(scoreB.by_time) : null, ah = scoreA?.by_time ? sunHours(scoreA.by_time) : null;
        S = { bS, aS, bMin: (1 - bS) * 10, aMin: (1 - aS) * 10, bh: bh ?? 0, ah: ah ?? 0, uv: bh ? (1 - ah / bh) * 100 : (1 - (1 - aS) / (1 - bS)) * 100,
          cost: accepted.cost_gbp, perHour: accepted.value?.gbp_per_shaded_passenger_hour, material: res.materials?.[accepted.material]?.label || accepted.material };
      }
      orbiting = false;
      showStats(stop.name || stop.id, S);
      if (stop.id === HERO_ID) { await sleep(6500); $('stats').style.display = 'none'; showPhoto(); }
    } catch (e) {
      console.error(e); toast('Sequence error: ' + e.message); await log('ERROR ' + e.message, 'err');
      $('radar').style.display = 'none';
    } finally { running = false; }
  }

  $('demoBtn').addEventListener('click', async () => {
    const s = { id: HERO_ID, name: 'Hackney Town Hall', lat: 51.5452115, lon: -0.0554389 };
    if (hero?.stop) Object.assign(s, hero.stop);
    runSequence(s, { demo: true });
  });
  $('resetBtn').addEventListener('click', () => {
    if (running) return;
    playToken++; orbiting = false;
    for (const id of ['stats', 'photo', 'argon', 'side', 'legend', 'clock', 'clockSub']) $(id).style.display = 'none';
    clearOverlays(); $('hudPlace').textContent = 'London';
    map.flyTo({ center: [-0.085, 51.528], zoom: 11.5, pitch: 50, bearing: -15, duration: 3000 });
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('stats').style.display = 'none'; $('photo').style.display = 'none'; } });

  map.on('load', async () => {
    try { if (map.setSky) map.setSky({ 'sky-color': '#9fc8ec', 'horizon-color': '#f3dcc0', 'fog-color': '#d9e4ee', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85 }); } catch { /* optional */ }
    setSimHour(13);
    try { await scan(HACKNEY_BOX, 25, 'Hackney (cached)'); } catch (e) { log('Hackney preload failed: ' + e.message, 'err'); }
  });
  window.shadowstopLive = { runSequence, map };
})();
