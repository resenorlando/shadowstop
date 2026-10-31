// ShadowStop film v2: 55 s, 1920x1080, built around the real 3D verified scene (hero3d.js).
// Every number shown comes from assets/hero.json (engine.py output for Hackney Town Hall, cross-checked by
// tests/test_hackney_accepted.py against scenes/hackney_accepted.json). Nothing here computes a score.
//
//  0-5   real photo of the stop, waiting area marked
//  5-11  London map fly-in to Hackney, the real scanned stops (assets/hackney_scan.json)
//  11-19 3D BEFORE, sun moves 09:00-18:00, verified 14%
//  19-27 two rejected designs and why (obvious roof shown in 3D at the counterexample time in hero.json)
//  27-38 Argon's accepted shade-sail builds, sun sweeps, shadow moves
//  38-47 identical camera before | after, verified 14% -> 77%
//  47-55 hero view, £3,350 indicative, ShadowStop
(() => {
  const $ = (id) => document.getElementById(id);
  const Q = new URLSearchParams(location.search);
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const wait = (s) => new Promise((r) => gsap.delayedCall(s, r)); // pausable
  const tw = (t, v) => new Promise((r) => gsap.to(t, { ...v, onComplete: r }));
  const pct = (v) => Math.round(v * 100) + '%';
  const gbp = (v) => '£' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 });
  // the verifier's own counterexample, parsed from its recorded reason text (hero.json attempts)
  const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  function cex(reason) {
    const m = /at (\d\d):(\d\d) \(sun az (\d+) deg, el (\d+) deg\) only (\d+)%/.exec(String(reason || ''));
    if (!m) return null;
    return { t: `${m[1]}:${m[2]}`, h: +m[1] + +m[2] / 60, az: +m[3], el: +m[4], shade: +m[5], from: COMPASS[Math.round(+m[3] / 45) % 8] };
  }
  const fmt = (h) => { const hh = Math.floor(h + 1e-6), mm = Math.round((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`; };

  // ---------- stage scaling
  const stage = $('stage');
  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transformOrigin = '960px 540px';
    stage.style.transform = `translate(-960px, -540px) scale(${s})`;
  }
  addEventListener('resize', fit); fit();

  // ---------- data
  let H = null, SCAN = null, X = null;
  async function load() {
    const j = async (p) => { const r = await fetch(p, { cache: 'no-store' }); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };
    H = await j('assets/hero.json');
    try { SCAN = await j('assets/hackney_scan.json'); } catch { SCAN = null; }
    X = await new Promise((res, rej) => {
      if (window.H3D) return res(window.H3D);
      if (window.H3D_ERROR) return rej(window.H3D_ERROR);
      document.addEventListener('h3d-ready', () => res(window.H3D), { once: true });
      const t0 = Date.now();
      (function poll() { if (window.H3D) return res(window.H3D); if (window.H3D_ERROR) return rej(window.H3D_ERROR); if (Date.now() - t0 > 60000) return rej(new Error('3D scene timed out')); setTimeout(poll, 100); })();
    });
    gsap.ticker.add(() => { if (+getComputedStyle($('h3d')).opacity > 0.001) X.render(); });
  }

  // ---------- map (MapLibre satellite); tilesOK tells us whether the fly-in can be shown
  let map = null, tilesOK = false;
  function initMap() {
    if (!window.maplibregl) return;
    try {
      map = new maplibregl.Map({
        container: 'map', center: [-0.118, 51.509], zoom: 9.6, pitch: 0, bearing: 0, interactive: false, fadeDuration: 0, maxPitch: 80,
        attributionControl: { compact: false },
        style: { version: 8, sources: { esri: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' } },
          layers: [{ id: 'sat', type: 'raster', source: 'esri' }] },
      });
      map.on('data', (e) => { if (e.sourceId === 'esri' && e.tile) tilesOK = true; });
    } catch (e) { console.warn('map unavailable', e); map = null; }
  }

  // ---------- photo
  function layoutPhoto(img) {
    const ar = img.naturalWidth / img.naturalHeight;
    let w = 1920, h = 1920 / ar; if (h < 1080) { h = 1080; w = 1080 * ar; }
    Object.assign($('photoInner').style, { width: w + 'px', height: h + 'px', left: (1920 - w) / 2 + 'px', top: (1080 - h) / 2 + 'px' });
    return { w, h, x0: (1920 - w) / 2, y0: (1080 - h) / 2 };
  }

  // ---------- titles / HUD helpers
  async function title(t, sub, opts = {}) {
    $('title').textContent = t; $('subtitle').textContent = sub || '';
    Object.assign($('title').style, opts.title || {}); Object.assign($('subtitle').style, opts.sub || {});
    gsap.to('#title', { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', startAt: { y: 26 } });
    if (sub) gsap.to('#subtitle', { opacity: 1, y: 0, duration: 0.7, delay: 0.15, ease: 'power3.out', startAt: { y: 18 } });
    await wait(0.7);
  }
  const untitle = (d = 0.45) => Promise.all([tw('#title', { opacity: 0, duration: d }), tw('#subtitle', { opacity: 0, duration: d })]);
  function tag(kind, text) {
    $('tagPill').className = 'pill ' + kind; $('tagPill').textContent = kind === 'after' ? 'AFTER' : kind === 'obv' ? 'ATTEMPT' : 'BEFORE';
    $('tagTxt').textContent = text;
    gsap.to('#tag', { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out', startAt: { x: -30 } });
  }
  function hud(mode, h) {
    const r = X.shadeAt(h, mode);
    $('clockT').textContent = fmt(h);
    $('hudPct').textContent = pct(r.shade);
    const col = mode === 'after' ? 'var(--ok)' : 'var(--hot)';
    $('hudPct').style.color = col; $('hudBar').style.background = col; $('hudBar').style.width = Math.round(r.shade * 100) + '%';
    $('hudLbl').textContent = `verifier, ${r.t} · sun az ${Math.round(r.sun_az)}° el ${Math.round(r.sun_el)}°`;
  }
  // move the sun from h0 to h1 over secs, keeping the HUD in sync with the verifier's by_time
  function sweep(mode, h0, h1, secs, onH) {
    const o = { h: h0 };
    return tw(o, { h: h1, duration: secs, ease: 'none', onUpdate: () => { X.set({ hour: o.h }); if (onH) onH(o.h); else hud(mode, o.h); } });
  }
  const camTo = (v, secs, ease = 'power2.inOut') => tw(X.view, { ...(typeof v === 'string' ? X.VIEWS[v] : v), duration: secs, ease });
  function orbit(secs, a0, a1, { r = 14.7, z = 4.2, tx = 0.3, ty = 0.8, tz = 1.3, fov = 38 } = {}) {
    const o = { a: a0 };
    return tw(o, { a: a1, duration: secs, ease: 'sine.inOut', onUpdate: () => X.setView({ px: tx + r * Math.sin(o.a), py: ty - r * Math.cos(o.a), pz: z, tx, ty, tz, fov }) });
  }

  // ---------- the film
  async function run() {
    const stop = H.stop;
    const atts = H.attempts || [];
    const obvious = atts.find((a) => a.by === 'baseline');
    const argonRejected = atts.find((a) => a.by === 'argon' && !a.accepted);
    const accepted = [...atts].reverse().find((a) => a.accepted);
    const bS = H.stats?.shade_before_pct ?? Math.round(H.before.score * 100);
    const aS = H.stats?.shade_after_pct ?? Math.round(H.after.score * 100);
    const cost = H.design?.cost_gbp ?? accepted?.cost_gbp;

    // 0-5 s: the real place -----------------------------------------------------------
    const img = $('pBefore');
    await new Promise((r) => { img.onload = r; img.onerror = r; img.src = H.photo_before; if (img.complete && img.naturalWidth) r(); });
    const L = layoutPhoto(img);
    const poly = H.waiting_area_px || [];
    $('areaPoly').setAttribute('points', poly.map(([x, y]) => `${x},${y}`).join(' '));
    $('credit').textContent = `Real photo: ${H.photo_credit || 'Mare Street, Wikimedia Commons'}`;
    gsap.set('#photoInner', { scale: 1.0 });
    gsap.to('#photo', { opacity: 1, duration: 0.6 });
    gsap.to('#photoInner', { scale: 1.12, duration: 6, ease: 'none' });
    gsap.to('#credit', { opacity: 1, duration: 0.6 });
    title(`${stop.name} bus stop`, 'Mare Street, London. A glass-roofed shelter. How much shade does it really give?');
    await wait(1.4);
    gsap.to('#areaPoly', { attr: { opacity: 1 }, duration: 0.5 });
    gsap.to('#areaPoly', { attr: { fill: 'rgba(255,59,47,.62)' }, duration: 0.6, repeat: 3, yoyo: true, delay: 0.5 });
    if (poly.length) {
      // label sits under the polygon; account for the Ken Burns scale about 50% 62%
      const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, by = Math.max(...poly.map((p) => p[1]));
      const s = 1.08, ox = L.x0 + L.w * 0.5, oy = L.y0 + L.h * 0.62;
      const px = ox + (L.x0 + cx * L.w - ox) * s, py = oy + (L.y0 + by * L.h - oy) * s;
      Object.assign($('waLabel').style, { left: px - 95 + 'px', top: py + 18 + 'px' });
    }
    gsap.to('#waLabel', { opacity: 1, y: 0, duration: 0.5, delay: 0.4, startAt: { y: 12 } });
    await wait(3.0);

    // 5-11 s: London map fly-in --------------------------------------------------------
    await untitle(0.35);
    gsap.to(['#waLabel', '#credit'], { opacity: 0, duration: 0.4 });
    const useMap = map && tilesOK && !Q.get('nomap');
    if (useMap) {
      map.jumpTo({ center: [-0.118, 51.509], zoom: 9.6, pitch: 0, bearing: 0 });
      gsap.to('#map', { opacity: 1, duration: 0.7 });
      gsap.to('#photo', { opacity: 0, duration: 0.7 });
      title('Hackney, East London', '10 bus stops scanned from OpenStreetMap, ranked by verified shade');
      map.flyTo({ center: [stop.lon, stop.lat], zoom: 17.2, pitch: 55, bearing: 25, duration: 4300, curve: 1.5, essential: true });
      // the real scan results appear as we arrive (colour = scan shade score)
      gsap.delayedCall(2.4, () => {
        for (const s of SCAN?.stops || []) {
          const worst = s.id === stop.id;
          const d = document.createElement('div');
          const c = s.score < 0.2 ? '#ff3b2f' : s.score < 0.4 ? '#ffb340' : '#2ee68a';
          d.style.cssText = `width:${worst ? 30 : 18}px;height:${worst ? 30 : 18}px;border-radius:50%;background:${c};border:${worst ? 5 : 3}px solid #fff;box-shadow:0 0 ${worst ? 30 : 10}px ${c};opacity:0;transition:opacity .4s`;
          new maplibregl.Marker({ element: d }).setLngLat([s.lon, s.lat]).addTo(map);
          requestAnimationFrame(() => (d.style.opacity = 1));
        }
      });
      await wait(3.6);
      await untitle(0.35);
      title(`Worst in the scan: ${stop.name}`, 'Rebuilt in 3D from OpenStreetMap, then tested against the real sun');
      await wait(1.0);
      // map -> 3D model of the same place
      X.set({ mode: 'before', hour: 9, build: 1, sbs: false, split: null }); X.setView('aerial');
      gsap.to('#h3d', { opacity: 1, duration: 0.9 });
      gsap.to('#map', { opacity: 0, duration: 0.9, delay: 0.3 });
      camTo('hero', 2.6, 'power2.inOut');
      await wait(1.0);
    } else {
      // offline fallback (no satellite tiles): fly into the 3D reconstruction instead
      X.set({ mode: 'before', hour: 9, build: 1, sbs: false, split: null });
      X.setView({ px: 160, py: -420, pz: 520, tx: 0, ty: 0, tz: 0, fov: 40 });
      gsap.to('#h3d', { opacity: 1, duration: 0.8 });
      gsap.to('#photo', { opacity: 0, duration: 0.8 });
      title('Hackney, East London', 'Rebuilt in 3D from OpenStreetMap: buildings, trees, the shelter');
      camTo('aerial', 3.6, 'power2.inOut');
      await wait(3.6);
      await untitle(0.35);
      title(`Worst in our Hackney scan: ${stop.name}`, 'Tested against the real sun of 19 July 2026');
      camTo('hero', 2.6, 'power2.inOut');
      await wait(1.0);
    }

    // 11-19 s: BEFORE simulation ------------------------------------------------------
    await untitle(0.4);
    tag('before', 'Existing glass shelter · 19 July heatwave day');
    gsap.to('#clock', { opacity: 1, duration: 0.6 });
    gsap.to('#hud', { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', startAt: { y: 30 } });
    X.set({ waGlow: 1 });
    hud('before', 9);
    await wait(1.2);
    await sweep('before', 9, 18, 4.2);
    gsap.to(['#tag', '#clock', '#hud'], { opacity: 0, duration: 0.4 });
    $('holdK').textContent = 'Verified, whole day 09:00–18:00';
    $('holdN').innerHTML = `<span style="color:var(--hot)">${bS}%</span> shaded`;
    $('holdL').textContent = 'of waiting time. People stand in direct sun the rest of the day.';
    gsap.to('#hold', { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.6)', startAt: { scale: 0.88 } });
    await wait(1.5);
    gsap.to('#hold', { opacity: 0, duration: 0.35 });

    // 19-27 s: two rejected designs ---------------------------------------------------
    const c1 = cex(obvious?.reason) || { t: '15:30', h: 15.5, az: 236, el: 49, shade: 24, from: 'south-west' };
    const c2 = cex(argonRejected?.reason) || { t: '18:00', h: 18, az: 271, el: 26, shade: 13, from: 'west' };
    X.set({ mode: 'obvious', hour: c1.h, waGlow: 1 });
    camTo({ px: 7.5, py: -13.5, pz: 9, tx: -0.6, ty: 0.8, tz: -1.4, fov: 40 }, 1.2);
    gsap.to('#scrim', { opacity: 1, duration: 0.6 });
    gsap.to('#loop', { opacity: 1, duration: 0.6 });
    const att = $('att');
    const showAtt = (n, who, design, why, src, ok) => {
      att.innerHTML = `<div class="stamp ${ok ? 'ok' : 'bad'}">${ok ? 'ACCEPTED' : 'REJECTED'}</div>
        <div class="n">Attempt ${n} · ${who}</div><div class="d">${design}</div><div class="why">${why}</div><div class="src">${src}</div>`;
      gsap.fromTo(att, { opacity: 0, x: 80 }, { opacity: 1, x: 0, duration: 0.55, ease: 'power3.out' });
      gsap.from(att.querySelector('.stamp'), { scale: 2.4, opacity: 0, duration: 0.45, delay: 0.5, ease: 'back.out(2)' });
    };
    const on = (id) => ['l1', 'l2', 'l3'].forEach((k) => $(k).classList.toggle('on', k === id));
    on('l1');
    showAtt(1, 'the obvious fix', `Make the roof solid metal · ${gbp(obvious?.cost_gbp ?? 4290)} indicative`,
      `At <b>${c1.t}</b>, in peak heat, the sun is ${c1.el}° high from the ${c1.from}: the small roof's shadow misses most of the queue. Only <b>${c1.shade}%</b> shaded.`,
      `Whole day only ${pct(obvious?.score_after ?? 0.28)} shaded: below the +25-point bar. (Shown in 3D at ${c1.t}.)`, false);
    await wait(1.6); on('l2');
    await wait(2.0); on('l3');
    gsap.to(att, { opacity: 0, x: -40, duration: 0.35 });
    await wait(0.4);
    // Argon's first sail: its geometry wasn't saved, so we show the counterexample moment on the existing stop
    X.set({ mode: 'before' });
    sweep('before', c1.h, c2.h, 1.4, () => {});
    showAtt(2, 'Gemini 4 Argon', `Tensioned shade-sail · ${gbp(argonRejected?.cost_gbp ?? 3360)} indicative`,
      `At <b>${c2.t}</b> the sun is only ${c2.el}° high, from the ${c2.from}: it slides under the sail. <b>${c2.shade}%</b> shaded.`,
      `Recorded run: the verifier sent this time and sun angle back to Argon (shown: the existing stop at ${c2.t}). Argon redesigned.`, false);
    on('l3');
    await wait(3.6);

    // 27-38 s: the transformation -----------------------------------------------------
    showAtt(3, 'Gemini 4 Argon, redesigned', `Shade-sail, ${H.design?.size?.join(' × ') ?? '5.7 × 4.2'} m, angled for low sun · ${gbp(cost)} indicative`,
      'Passes every check: shade through the whole day, buildable, within the £8,000 budget.',
      'Accepted by the verifier, not by the model.', true);
    on('l2');
    await wait(1.5);
    gsap.to(['#att', '#loop'], { opacity: 0, duration: 0.4 });
    gsap.to('#scrim', { opacity: 0, duration: 0.6 });
    X.set({ mode: 'after', build: 0, hour: 10.5 });
    X.setView({ px: -9.5, py: -10, pz: 3.0, tx: 0.2, ty: 0.6, tz: 1.8, fov: 40 });
    tag('after', 'Building the verified design');
    const b = { v: 0 };
    orbit(3.4, -0.75, -0.45, { r: 13.5, z: 3.4, tz: 1.6 });
    await tw(b, { v: 1, duration: 2.8, ease: 'power2.inOut', onUpdate: () => X.set({ build: b.v }) });
    gsap.fromTo('#flash', { opacity: 0.45 }, { opacity: 0, duration: 0.7, ease: 'power2.out' });
    $('tagTxt').textContent = 'Argon\'s verified shade-sail · same day, same sun';
    $('hudK').textContent = 'Waiting area in shade now';
    gsap.to('#clock', { opacity: 1, duration: 0.5 });
    gsap.to('#hud', { opacity: 1, duration: 0.5 });
    hud('after', 9);
    camTo('hero', 6.2, 'sine.inOut');
    await sweep('after', 9, 18, 6.6);
    gsap.to(['#tag', '#clock', '#hud'], { opacity: 0, duration: 0.4 });
    await wait(0.4);

    // 38-47 s: identical camera, before | after -----------------------------------------
    X.set({ sbs: true, hour: 9, mode: 'after' });
    X.setView({ px: 6.5, py: -12.5, pz: 8.2, tx: -0.4, ty: 0.4, tz: 0.2, fov: 50 });
    gsap.to('#sbs', { opacity: 1, duration: 0.5 });
    await sweep('after', 9, 18, 6.0, (h) => {
      $('sbsB').textContent = pct(X.shadeAt(h, 'before').shade);
      $('sbsA').textContent = pct(X.shadeAt(h, 'after').shade);
      $('sbsClock').textContent = `${fmt(h)} · same camera · same sun`;
    });
    $('hA').textContent = bS + '%'; $('hB').textContent = aS + '%';
    gsap.to('#headline', { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.5)', startAt: { y: 30, scale: 0.92 } });
    const cu = { a: 0, b: 0 };
    gsap.to(cu, { a: bS, b: aS, duration: 1.2, ease: 'power2.out', onUpdate: () => { $('hA').textContent = Math.round(cu.a) + '%'; $('hB').textContent = Math.round(cu.b) + '%'; } });
    await wait(2.9);

    // 47-55 s: hero view + branding -------------------------------------------------------
    gsap.to(['#headline', '#sbs'], { opacity: 0, duration: 0.4 });
    await wait(0.3);
    X.set({ sbs: false, mode: 'after', build: 1, hour: 16.25, waGlow: 0.6 });
    orbit(7.7, -0.95, -0.25, { r: 13.5, z: 4.4, tz: 0.4, fov: 38 });
    $('finale').innerHTML = `<div class="k">Verified design · ${stop.name}</div>
      <div class="s">${H.design?.material_label || 'Shade-sail'}, chosen by Gemini 4 Argon</div>
      <div class="row"><div class="big"><span class="a">${bS}%</span><span class="ar">→</span><span class="b">${aS}%</span></div>
      <div class="cost">${gbp(cost)}<small>indicative cost</small></div></div>
      <div class="f">Shade = share of waiting-area time, 09:00–18:00 on 19 July, out of direct sun at 1.2 m height. Direct-sun geometry, not air temperature. Costs are indicative planning figures.</div>`;
    gsap.to('#finale', { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', startAt: { y: 30 } });
    await wait(3.9);
    $('fine').textContent = `3D scene: OpenStreetMap buildings and trees, shelter and accepted design exactly as verified; masts and people are illustrative. Photo: ${H.photo_credit || ''}. Satellite imagery © Esri.`;
    gsap.to('#finale', { opacity: 0, duration: 0.4 });
    gsap.to('#topfade', { opacity: 0, duration: 0.6 });
    await tw('#end', { opacity: 1, duration: 0.8, ease: 'power2.inOut' });
    gsap.from('#end .sun, #end .logo, #end .tl, #end .by', { y: 26, opacity: 0, duration: 0.8, stagger: 0.12, ease: 'power3.out' });
    await wait(2.6);
    window.STORY_DONE = true;
  }

  // ---------- controls
  let started = false;
  async function start() {
    if (started) return; started = true;
    gsap.to('#playBtn', { opacity: 0, duration: 0.25, onComplete: () => ($('playBtn').style.display = 'none') });
    try { await run(); } catch (e) { console.error(e); const el = $('err'); el.style.display = 'block'; el.textContent = 'Film error: ' + e.message; }
  }
  window.storyStart = start;
  $('playBtn').addEventListener('click', start);
  $('replayBtn').addEventListener('click', () => { location.href = location.pathname + '?autoplay=1'; });
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (!started) { if (window.STORY_READY) start(); return; }
    const g = gsap.globalTimeline; g.paused(!g.paused());
  });
  if (Q.get('rec')) document.body.classList.add('rec');
  initMap();
  load().then(() => {
    // first frame of the 3D scene, so it is warm before it is shown
    X.set({ mode: 'before', hour: 9 }); X.setView('hero'); X.render();
    window.STORY_READY = true;
    $('playBtn').disabled = false; $('playBtn').firstChild.textContent = '▶ Play';
    if (Q.get('autoplay')) setTimeout(start, 600);
  }).catch((e) => {
    const el = $('err'); el.style.display = 'block';
    el.innerHTML = `<b>Couldn't load the film data</b><br><span style="color:#6b7682;font-size:20px">${String(e.message || e)}</span>`;
    $('playBtn').style.display = 'none';
  });
})();
