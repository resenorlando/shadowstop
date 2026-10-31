// ShadowStop cinematic story: auto-playing 1920x1080 demo for screen recording.
(() => {
  const $ = (id) => document.getElementById(id);
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const ESRI_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics';
  // pausable wait: gsap delayedCall respects globalTimeline.pause()
  const wait = (s) => new Promise((r) => gsap.delayedCall(s, r));
  const tw = (target, vars) => new Promise((r) => gsap.to(target, { ...vars, onComplete: r }));
  const pct = (v) => Math.round(v * 100) + '%';
  const trunc = (s, n = 70) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const fmtHM = (min) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} m`;
  const gbp = (v, dp = 0) => '£' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });

  // ---------- stage scaling (design at 1920x1080)
  const stage = $('stage');
  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    stage.style.transformOrigin = '50% 50%';
    stage.style.left = '50%'; stage.style.top = '50%';
    stage.style.marginLeft = '0'; stage.style.marginTop = '0';
    stage.style.transform = `translate(${-960}px, ${-540}px) scale(${s})`;
    stage.style.transformOrigin = '960px 540px';
  }
  addEventListener('resize', fit); fit();

  // ---------- data
  let H = null;
  async function loadData() {
    try {
      const r = await fetch('assets/hero.json', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      H = await r.json();
      if (!H?.stop || !H?.before?.by_time?.length) throw new Error('hero.json is missing stop / before.by_time');
    } catch (e) {
      const el = $('err'); el.style.display = 'block';
      el.innerHTML = `<b>Couldn't load assets/hero.json</b><br><span style="color:#6b7682;font-size:20px">${String(e.message || e)}</span>`;
      $('playBtn').style.display = 'none';
      throw e;
    }
  }

  // ---------- map
  // Adapter: MapLibre GL (3D buildings, pitched GTA-style dive) with a Leaflet fallback.
  let M = null;
  function el(html) { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  function makeMapLibre() {
    if (!window.maplibregl) throw new Error('maplibre not loaded');
    const map = new maplibregl.Map({
      container: 'map', center: [-0.12, 51.51], zoom: 9.5, pitch: 0, bearing: 0, interactive: false,
      attributionControl: { compact: false, customAttribution: '© OpenFreeMap © OpenStreetMap contributors' },
      maxPitch: 85, fadeDuration: 0,
      style: {
        version: 8,
        sources: {
          esri: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: ESRI_ATTR },
          openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
        },
        layers: [
          { id: 'sat', type: 'raster', source: 'esri' },
          { id: 'bldg', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
            paint: { 'fill-extrusion-color': '#e8e4dc', 'fill-extrusion-opacity': 0.85,
              'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] } },
        ],
      },
    });
    const add = (lat, lon, html, anchor = 'center') => {
      const m = new maplibregl.Marker({ element: el(html), anchor }).setLngLat([lon, lat]).addTo(map);
      return { remove: () => m.remove(), show: () => { m.getElement().style.opacity = 1; }, hide: () => { m.getElement().style.opacity = 0; }, el: m.getElement() };
    };
    return {
      kind: 'maplibre',
      x: (lat, lon) => map.project([lon, lat]).x,
      add,
      async dive(stop) {
        await new Promise((r) => { map.once('moveend', r); map.easeTo({ zoom: 12, pitch: 45, bearing: -20, duration: 1500 }); });
        await new Promise((r) => { map.once('moveend', r); map.flyTo({ center: [stop.lon, stop.lat], zoom: 18.6, pitch: 70, bearing: 35, duration: 4500, curve: 1.6, essential: true }); });
      },
      orbit(secs) { map.easeTo({ bearing: map.getBearing() + 25, duration: secs * 1000, easing: (t) => t }); },
    };
  }
  function makeLeaflet() {
    const map = L.map('map', { zoomControl: false, attributionControl: true, zoomSnap: 0, fadeAnimation: true, inertia: false })
      .setView([51.5072, -0.1276], 11);
    L.tileLayer(ESRI, { maxZoom: 20, maxNativeZoom: 19, attribution: ESRI_ATTR, keepBuffer: 4 }).addTo(map);
    map.attributionControl.setPrefix(false);
    const add = (lat, lon, html, anchor = 'center') => {
      const node = el(html);
      const w = parseInt(node.getAttribute('data-w') || 26), h = parseInt(node.getAttribute('data-h') || 26);
      const m = L.marker([lat, lon], { icon: L.divIcon({ className: '', html, iconSize: [w, h], iconAnchor: anchor === 'bottom' ? [w / 2, h - 2] : [w / 2, h / 2] }), interactive: false }).addTo(map);
      return { remove: () => m.remove(), show: () => m.setOpacity(1), hide: () => m.setOpacity(0), get el() { return m.getElement(); } };
    };
    return {
      kind: 'leaflet',
      x: (lat, lon) => map.latLngToContainerPoint([lat, lon]).x,
      add,
      async dive(stop) { map.flyTo([stop.lat, stop.lon], 19, { duration: 5 }); await wait(5.1); },
      orbit() {},
    };
  }
  function initMap() {
    try { M = makeMapLibre(); }
    catch (e) {
      console.warn('MapLibre unavailable, using Leaflet', e);
      $('map').innerHTML = '';
      M = makeLeaflet();
    }
  }

  // ---------- photo layout: inner box has the photo's aspect and covers the stage, so the SVG polygon stays aligned
  function layoutPhoto(img) {
    const ar = (img.naturalWidth || 16) / (img.naturalHeight || 9);
    let w = 1920, h = 1920 / ar;
    if (h < 1080) { h = 1080; w = 1080 * ar; }
    Object.assign($('photoInner').style, { width: w + 'px', height: h + 'px', left: (1920 - w) / 2 + 'px', top: (1080 - h) / 2 + 'px' });
  }
  const loadImg = (img, src) => new Promise((res) => { if (!src) return res(false); img.onload = () => res(true); img.onerror = () => res(false); img.src = src; });

  // ---------- colour helpers
  const lerp = (a, b, t) => a + (b - a) * t;
  function areaColor(shade) {
    // hot red (sun) -> cool blue (shade)
    const hot = [255, 59, 47], cool = [47, 134, 255];
    const t = Math.max(0, Math.min(1, (shade - 0.25) / 0.5));
    const c = hot.map((v, i) => Math.round(lerp(v, cool[i], t)));
    return `rgba(${c[0]},${c[1]},${c[2]},0.55)`;
  }

  // ---------- day sweep over the current photo
  async function daySweep(byTime, label, isAfter, seconds) {
    const tag = $('tag');
    $('tagPill').textContent = isAfter ? 'AFTER' : 'BEFORE';
    $('tagPill').className = 'pill ' + (isAfter ? 'after' : 'before');
    $('tagTxt').textContent = label;
    gsap.set(['#hudPct', '#hudTot'], { clearProps: 'all' });
    $('hudTot').textContent = fmtHM(0);
    gsap.to(tag, { opacity: 1, x: 0, duration: 0.7, ease: 'power3.out', startAt: { x: -40 } });
    gsap.to('#clock', { opacity: 1, duration: 0.7 });
    gsap.to('#hud', { opacity: 1, x: 0, duration: 0.8, ease: 'power3.out', startAt: { x: 60 } });
    gsap.to('#areaPoly', { attr: { opacity: 1 }, duration: 0.6 });
    const step = seconds / byTime.length;
    const st = { sunMin: 0, pct: 0 };
    for (const b of byTime) {
      const up = (b.sun_el ?? 30) > 0;
      const sun = up ? 1 - b.shade : 0;
      $('clock').textContent = b.t;
      const az = b.sun_az ?? 180, el = Math.max(0, b.sun_el ?? 30);
      const sx = Math.max(5, Math.min(95, ((az - 80) / 200) * 100));
      const sy = Math.max(0, 40 - el * 0.6);
      gsap.to('#sunTint', { opacity: up ? 0.15 + 0.45 * sun : 0.05, '--sx': sx + '%', '--sy': sy + '%', duration: step * 0.95, ease: 'sine.inOut' });
      gsap.to('#sunWash', { opacity: up ? 0.1 + 0.35 * sun : 0, '--sx': sx + '%', '--sy': sy + '%', duration: step * 0.95, ease: 'sine.inOut' });
      gsap.to('#areaPoly', { attr: { fill: areaColor(b.shade) }, duration: step * 0.8 });
      gsap.to(st, { pct: sun * 100, duration: step * 0.9, ease: 'power1.out', onUpdate: () => { $('hudPct').textContent = Math.round(st.pct) + '%'; $('hudPct').style.color = st.pct > 50 ? '#ff3b2f' : '#2f86ff'; } });
      st.sunMin += sun * 15;
      $('hudTot').textContent = fmtHM(st.sunMin);
      // sun on the arc: azimuth 60..300 -> x, elevation -> height
      const t = Math.max(0, Math.min(1, (az - 60) / 240));
      const ang = Math.PI * (1 - t);
      gsap.to('#arcSun', { attr: { cx: 150 + 130 * Math.cos(ang), cy: 110 - (el / 65) * 100 }, duration: step * 0.9, ease: 'none' });
      $('arcEl').textContent = `sun ${Math.round(el)}°`;
      await wait(step);
    }
    return st.sunMin;
  }
  async function hideSweepUI() {
    await Promise.all([
      tw('#tag', { opacity: 0, duration: 0.5 }), tw('#clock', { opacity: 0, duration: 0.5 }),
      tw('#hud', { opacity: 0, x: 60, duration: 0.5 }),
    ]);
  }
  async function hold(n, l, color, secs = 2.2) {
    $('holdN').textContent = n; $('holdN').style.color = color; $('holdL').textContent = l;
    await tw('#hold', { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.6)', startAt: { scale: 0.85 } });
    await wait(secs);
    await tw('#hold', { opacity: 0, scale: 0.95, duration: 0.4 });
  }
  async function title(text, sub, secsIn = 0.8) {
    $('title').textContent = text; $('subtitle').textContent = sub || '';
    gsap.to('#title', { opacity: 1, y: 0, duration: secsIn, ease: 'power3.out', startAt: { y: 30 } });
    if (sub) gsap.to('#subtitle', { opacity: 1, y: 0, duration: secsIn, delay: 0.2, ease: 'power3.out', startAt: { y: 20 } });
    await wait(secsIn);
  }
  const untitle = () => Promise.all([tw('#title', { opacity: 0, duration: 0.5 }), tw('#subtitle', { opacity: 0, duration: 0.5 })]);

  // ---------- stats (from hero.json, with derived fallbacks)
  function stats() {
    const s = H.stats || {};
    const sunH = (bt) => bt.reduce((a, b) => a + ((b.sun_el ?? 1) > 0 ? (1 - b.shade) * 0.25 : 0), 0);
    const bS = s.shade_before_pct != null ? s.shade_before_pct / 100 : H.before.score;
    const aS = s.shade_after_pct != null ? s.shade_after_pct / 100 : (H.after?.score ?? bS);
    s.before_min ??= s.wait10_sun_min_before; s.after_min ??= s.wait10_sun_min_after;
    const bh = s.before_h ?? s.sun_hours_before ?? sunH(H.before.by_time);
    const ah = s.after_h ?? s.sun_hours_after ?? (H.after?.by_time ? sunH(H.after.by_time) : bh);
    return {
      bS, aS,
      bMin: s.before_min ?? s.wait10_before_min ?? (1 - bS) * 10,
      aMin: s.after_min ?? s.wait10_after_min ?? (1 - aS) * 10,
      bh, ah,
      uv: s.uv_cut_pct ?? (bh > 0 ? (1 - ah / bh) * 100 : 0),
      cost: s.cost_gbp ?? H.design?.cost_gbp,
      perHour: s.gbp_per_shaded_passenger_hour ?? s.gbp_per_hour,
      context: s.context,
    };
  }
  function countUp(el, to, { dp = 0, prefix = '', suffix = '', dur = 1.4, delay = 0 } = {}) {
    const o = { v: 0 };
    gsap.to(o, { v: to, duration: dur, delay, ease: 'power2.out', onUpdate: () => {
      el.textContent = prefix + Number(o.v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp }) + suffix;
    } });
  }

  // ---------- the show
  async function run() {
    const stop = H.stop;
    // preload photos
    const okB = await loadImg($('pBefore'), H.photo_before);
    const okA = await loadImg($('pAfter'), H.photo_after);
    if (okB) layoutPhoto($('pBefore'));
    const poly = (H.waiting_area_px || []).map(([x, y]) => `${x},${y}`).join(' ');
    $('areaPoly').setAttribute('points', poly);

    // 1. London scan (0-6 s)
    await tw('#intro', { opacity: 0, duration: 0.8 });
    $('intro').style.display = 'none';
    title('Which London bus stops leave people in the sun?');
    gsap.to('#sweep', { opacity: 1, duration: 0.3 });
    gsap.fromTo('#sweep .bar', { left: -300 }, { left: 1920, duration: 3.6, ease: 'power1.inOut' });
    /* counter removed: we don't claim a London-wide scan */
    const cnt = { v: 0 };
    gsap.to(cnt, { v: 19347, duration: 3.6, ease: 'power1.in', delay: 0.4, onUpdate: () => { $('counterN').textContent = Math.round(cnt.v).toLocaleString('en-GB') + '…'; } });
    // decorative dots, revealed with the sweep line
    const dots = [];
    for (let i = 0; i < 60; i++) {
      const lat = 51.40 + Math.random() * 0.21, lon = -0.40 + Math.random() * 0.55;
      const m = M.add(lat, lon, `<div class="dot ${Math.random() < 0.5 ? 'amber' : ''}" data-w="14" data-h="14" style="opacity:0;transition:opacity .3s"></div>`);
      const px = M.x(lat, lon);
      dots.push(m);
      gsap.delayedCall(0.4 + Math.max(0, Math.min(1, px / 1920)) * 3.4, () => { const e = m.el; if (e) { (e.firstElementChild || e).style.opacity = 1; e.style.opacity = 1; } });
    }
    await wait(4.2);
    $('worstName').textContent = stop.name;
    gsap.to('#counter', { opacity: 0, duration: 0.4 });
    gsap.to('#sweep', { opacity: 0, duration: 0.4 });
    gsap.to('#worst', { opacity: 1, y: 0, duration: 0.7, ease: 'back.out(1.4)', startAt: { y: 40 } });
    const heroMarker = M.add(stop.lat, stop.lon, '<div class="hero-dot" data-w="26" data-h="26"></div>');
    await wait(1.6);

    // 2. GTA-style dive to the stop (6-13 s)
    untitle();
    dots.forEach((m, i) => gsap.delayedCall(i * 0.01, () => m.remove()));
    gsap.to('#worst', { opacity: 0, y: 20, duration: 0.6, delay: 1.0 });
    await M.dive(stop);
    heroMarker.remove();
    const pinSvg = `<svg class="pin" viewBox="0 0 64 84"><path d="M32 2C16 2 4 14 4 30c0 21 28 52 28 52s28-31 28-52C60 14 48 2 32 2z" fill="#ff3b2f" stroke="#fff" stroke-width="4"/><circle cx="32" cy="30" r="10" fill="#fff"/></svg>`;
    const pin = M.add(stop.lat, stop.lon, `<div data-w="64" data-h="84" style="width:64px;height:84px;position:relative"><div class="hero-dot" style="position:absolute;left:19px;bottom:-13px"></div><div id="pinEl" style="position:absolute;inset:0">${pinSvg}</div></div>`, 'bottom');
    gsap.from('#pinEl', { y: -260, duration: 0.8, ease: 'bounce.out' });
    M.orbit(2.5);
    title(stop.name, H.date ? `A July heatwave day · ${H.date}` : 'A July heatwave day');
    await wait(2.0);

    // 3. map -> real photo (11-13 s)
    await untitle();
    gsap.to('#map', { scale: 1.6, filter: 'blur(14px)', duration: 1.6, ease: 'power2.in' });
    gsap.set('#photoInner', { scale: 1.35, filter: 'blur(18px)' });
    gsap.to('#photo', { opacity: 1, duration: 1.4, ease: 'power2.inOut', delay: 0.3 });
    await tw('#photoInner', { scale: 1.06, filter: 'blur(0px)', duration: 1.8, ease: 'power3.out' });
    pin.remove();
    gsap.to('#photoInner', { scale: 1.16, duration: 40, ease: 'none' }); // Ken Burns

    // 4. BEFORE day sweep (13-25 s)
    await daySweep(H.before.by_time, 'A July heatwave day', false, 9.5);
    await hideSweepUI();
    await hold(`Shaded only ${pct(H.before.score)}`, 'of the day, on a July heatwave day.', '#ff3b2f', 1.6);

    // 5. Argon designs, the verifier tests (25-33 s)
    gsap.to('#sunTint', { opacity: 0.25, duration: 0.6 });
    gsap.to('#scrim', { opacity: 1, duration: 0.6 });
    $('title').style.textAlign = 'left'; $('title').style.padding = '0 0 0 90px'; $('title').style.fontSize = '54px';
    $('subtitle').style.textAlign = 'left'; $('subtitle').style.padding = '0 0 0 90px'; $('subtitle').style.top = '170px';
    await title('Gemini 4 Argon designs a fix.', 'A physics verifier tests every design against the real sun.');
    const atts = (H.attempts || []).slice(-3);
    const box = $('attempts');
    box.innerHTML = '';
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      const el = document.createElement('div');
      el.className = 'att card';
      const mat = a.material_label || (a.material ? String(a.material).replace(/_/g, ' ') : '');
      el.innerHTML = `<div class="stamp ${a.accepted ? 'ok' : 'bad'}">${a.accepted ? 'ACCEPTED' : 'REJECTED'}</div>
        <div><div class="n">Attempt ${i + 1}${a.by ? ' · ' + a.by : ''}${a.score_after != null ? ' · ' + pct(a.score_after) + ' shade' : ''}</div>
        <div class="r">${a.accepted ? `${mat ? mat.charAt(0).toUpperCase() + mat.slice(1) : 'Design'}${a.cost_gbp != null ? ' · ' + gbp(a.cost_gbp) + ' indicative' : ''}` : trunc(a.reason)}</div>
        ${a.accepted && a.reason ? `<div class="m">${trunc(a.reason, 80)}</div>` : ''}</div>`;
      box.appendChild(el);
      gsap.to(el, { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out', startAt: { x: 120 } });
      gsap.from(el.querySelector('.stamp'), { scale: 2.4, opacity: 0, duration: 0.45, delay: 0.45, ease: 'back.out(2)' });
      await wait(a.accepted ? 2.4 : 2.0);
    }
    await Promise.all([tw('#attempts', { opacity: 0, duration: 0.5 }), untitle(), tw('#scrim', { opacity: 0, duration: 0.6 })]);
    box.innerHTML = ''; gsap.set('#attempts', { opacity: 1 });

    // 6. build: wipe photo_after in from the top (33-38 s)
    $('installN').textContent = H.design?.material_label || 'Verified canopy';
    gsap.to('#install', { opacity: 1, y: 0, duration: 0.6, ease: 'back.out(1.5)', startAt: { y: 30 } });
    gsap.to('#sunTint', { opacity: 0, duration: 0.6 });
    gsap.to('#areaPoly', { attr: { opacity: 0 }, duration: 0.4 });
    if (okA) {
      const ph = $('photoInner').offsetHeight;
      gsap.set('#shine', { opacity: 1, top: -160 });
      gsap.to('#shine', { top: ph, duration: 2.6, ease: 'power2.inOut' });
      const clip = { p: 100 };
      await tw(clip, { p: 0, duration: 2.6, ease: 'power2.inOut', onUpdate: () => { $('pAfter').style.clipPath = `inset(0 0 ${clip.p}% 0)`; } });
      gsap.to('#shine', { opacity: 0, duration: 0.3 });
    } else {
      await wait(2.6);
    }
    gsap.fromTo('#flash', { opacity: 0.55 }, { opacity: 0, duration: 0.8, ease: 'power2.out' });
    await wait(1.4);
    await tw('#install', { opacity: 0, duration: 0.4 });

    // 7. AFTER day sweep (38-48 s)
    await daySweep(H.after?.by_time || H.before.by_time, 'Same day, same sun', true, 9.0);
    await hideSweepUI();
    gsap.to('#sunTint', { opacity: 0, duration: 0.6 });
    gsap.to('#areaPoly', { attr: { opacity: 0 }, duration: 0.6 });

    // 8. final stats postcard (48-55 s)
    const S = stats();
    gsap.to('#photoInner', { filter: 'blur(10px) brightness(.6)', duration: 0.8 });
    const post = $('post');
    post.innerHTML = `
      <div class="head"><div class="kick">ShadowStop diagnosis · verified</div><div class="kick" style="color:#6b7682">${H.date || ''}</div></div>
      <div class="stop">${stop.name}</div>
      <div class="grid">
        <div class="stat hero"><div class="l">Waiting area shaded, over the day</div><div class="v"><span class="from" id="s1a">0%</span><span class="ar">→</span><span class="to" id="s1b">0%</span></div></div>
        <div class="stat"><div class="l">Direct sun during a 10-minute wait</div><div class="v"><span class="from" id="s2a">0</span><span class="ar">→</span><span class="to" id="s2b">0</span><span style="font-size:28px;color:#6b7682"> min</span></div></div>
        <div class="stat"><div class="l">Hours of direct sun on the waiting area</div><div class="v"><span class="from" id="s3a">0</span><span class="ar">→</span><span class="to" id="s3b">0</span><span style="font-size:28px;color:#6b7682"> h</span></div></div>
        <div class="stat"><div class="l">Direct-beam UV exposure cut by</div><div class="v"><span class="to" id="s4">0%</span></div></div>
        <div class="stat"><div class="l">Indicative cost${H.design?.material_label ? ' · ' + H.design.material_label : ''}</div><div class="v" id="s5">£0</div></div>
        <div class="stat"><div class="l">Per extra shaded passenger-hour</div><div class="v"><span class="to" id="s6">£0</span></div></div>
      </div>
      ${S.context ? `<div class="ctx">${Array.isArray(S.context) ? S.context.join(' · ') : S.context}</div>` : ''}
      <div class="foot">Every number computed by ShadowStop's sun-geometry verifier • Photo: ${H.photo_credit || '—'} • 'After' image is an illustration of the verified design</div>`;
    await tw(post, { opacity: 1, scale: 1, duration: 0.8, ease: 'power3.out', startAt: { scale: 0.92 } });
    countUp($('s1a'), S.bS * 100, { suffix: '%' }); countUp($('s1b'), S.aS * 100, { suffix: '%', delay: 0.3 });
    countUp($('s2a'), S.bMin, { dp: 1 }); countUp($('s2b'), S.aMin, { dp: 1, delay: 0.3 });
    countUp($('s3a'), S.bh, { dp: 1 }); countUp($('s3b'), S.ah, { dp: 1, delay: 0.3 });
    countUp($('s4'), S.uv, { suffix: '%' });
    if (S.cost != null) countUp($('s5'), S.cost, { prefix: '£' }); else $('s5').textContent = '—';
    if (S.perHour != null) countUp($('s6'), S.perHour, { prefix: '£', dp: 2 }); else $('s6').textContent = '—';
    await wait(6.5);
    await tw('#end', { opacity: 1, duration: 1.0, ease: 'power2.inOut' });
    gsap.from('#end .logo, #end .tl, #end .sun', { y: 30, opacity: 0, duration: 0.9, stagger: 0.15, ease: 'power3.out' });
  }

  // ---------- controls
  let started = false;
  async function start() {
    if (started) return;
    started = true;
    gsap.to('#playBtn', { opacity: 0, scale: 0.9, duration: 0.3, onComplete: () => ($('playBtn').style.display = 'none') });
    try { await run(); } catch (e) { console.error(e); }
  }
  $('playBtn').addEventListener('click', start);
  $('replayBtn').addEventListener('click', () => { location.href = location.pathname + '?autoplay=1'; });
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (!started) { start(); return; }
    const g = gsap.globalTimeline; g.paused(!g.paused());
  });

  loadData().then(() => {
    initMap();
    if (new URLSearchParams(location.search).get('autoplay')) setTimeout(start, 600);
  }).catch(() => {});
})();
