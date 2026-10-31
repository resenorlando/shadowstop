// ShadowStop — Frontier Architectural HUD, Parametric Canopy Tuner & City Discovery (hud.js)

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------------------
// 1. Instant Offline London Postcode & Area Directory + Nominatim Fallback
// ---------------------------------------------------------------------------
const LONDON_PRESETS = [
  {
    keys: ['e8', 'e8 1ea', 'e81ea', 'hackney', 'hackney town hall', 'mare street', 'mare st', 'hackney e8'],
    lat: 51.545,
    lon: -0.0553,
    label: 'Hackney Town Hall · Mare St (E8 1EA)',
  },
  {
    keys: ['e1', 'e1 6je', 'shoreditch', 'shoreditch e1', 'shoreditch high st', 'whitechapel', 'brick lane', 'spitalfields'],
    lat: 51.5245,
    lon: -0.0755,
    label: 'Shoreditch High St (E1)',
  },
  {
    keys: ['sw9', 'sw9 8pa', 'brixton', 'brixton sw9', 'brixton road', 'brixton station'],
    lat: 51.4613,
    lon: -0.1156,
    label: 'Brixton Road (SW9)',
  },
  {
    keys: ['n1', 'n1c', 'n1c 4tb', "king's cross", 'kings cross', "king's cross n1c", 'st pancras', 'islington', 'angel'],
    lat: 51.5319,
    lon: -0.1246,
    label: "King's Cross · Pancras Rd (N1C)",
  },
  {
    keys: ['se1', 'se1 7ab', 'waterloo', 'waterloo se1', 'southwark', 'london bridge', 'borough'],
    lat: 51.5036,
    lon: -0.1143,
    label: 'Waterloo · Baylis Rd (SE1)',
  },
  {
    keys: ['w1', 'w1b', 'w1d', 'oxford circus', 'soho', 'regent street', 'oxford street', 'westminster'],
    lat: 51.5152,
    lon: -0.1419,
    label: 'Oxford Circus (W1)',
  },
  {
    keys: ['e14', 'e14 5ab', 'canary wharf', 'poplar', 'isle of dogs'],
    lat: 51.5054,
    lon: -0.0235,
    label: 'Canary Wharf (E14)',
  },
  {
    keys: ['nw1', 'camden', 'camden town', 'euston'],
    lat: 51.539,
    lon: -0.1426,
    label: 'Camden Town (NW1)',
  },
  {
    keys: ['ec1', 'ec2', 'ec2m', 'liverpool street', 'farringdon', 'clerkenwell', 'city of london'],
    lat: 51.5188,
    lon: -0.0814,
    label: 'Liverpool Street (EC2)',
  },
  {
    keys: ['sw1', 'sw1v', 'victoria', 'whitehall', 'trafalgar square'],
    lat: 51.4965,
    lon: -0.1447,
    label: 'Victoria (SW1)',
  },
  {
    keys: ['se15', 'peckham', 'rye lane'],
    lat: 51.4733,
    lon: -0.0692,
    label: 'Peckham High St (SE15)',
  },
  {
    keys: ['e2', 'bethnal green', 'cambridge heath'],
    lat: 51.5273,
    lon: -0.0555,
    label: 'Bethnal Green (E2)',
  },
  {
    keys: ['n4', 'finsbury park', 'manor house'],
    lat: 51.5642,
    lon: -0.1065,
    label: 'Finsbury Park (N4)',
  },
  {
    keys: ['e15', 'e20', 'stratford'],
    lat: 51.5416,
    lon: -0.0022,
    label: 'Stratford (E15)',
  },
];

export async function lookupLondonLocation(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (!q) return null;
  const norm = q.toLowerCase().replace(/\s+/g, ' ');

  // 1. Exact key match in preset table
  for (const p of LONDON_PRESETS) {
    if (p.keys.includes(norm)) {
      return { lat: p.lat, lon: p.lon, label: p.label, source: 'preset' };
    }
  }

  // 2. Outward postcode prefix or substring match (e.g. "E8 2PB" -> E8)
  const outward = norm.split(' ')[0];
  const prefixHit = LONDON_PRESETS.find((p) => p.keys.includes(outward) || p.keys.some((k) => k.length >= 4 && norm.includes(k)));
  if (prefixHit && norm.length <= 4) {
    return { lat: prefixHit.lat, lon: prefixHit.lon, label: prefixHit.label, source: 'preset' };
  }

  // 3. Nominatim OpenStreetMap lookup bounded to Greater London
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb' +
      '&viewbox=-0.5103,51.6919,0.3340,51.2868&bounded=1&q=' +
      encodeURIComponent(q.toLowerCase().includes('london') ? q : `${q}, London, UK`);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const arr = await res.json();
      if (Array.isArray(arr) && arr.length > 0) {
        const hit = arr[0];
        const lat = parseFloat(hit.lat);
        const lon = parseFloat(hit.lon);
        if (isFinite(lat) && isFinite(lon)) {
          const shortName = String(hit.display_name || q)
            .split(',')
            .slice(0, 2)
            .join(', ')
            .trim();
          return { lat, lon, label: shortName || q, source: 'nominatim' };
        }
      }
    }
  } catch {
    // Fall through to outward postcode fallback
  } finally {
    clearTimeout(timer);
  }

  if (prefixHit) {
    return { lat: prefixHit.lat, lon: prefixHit.lon, label: `${prefixHit.label} (${q.toUpperCase()})`, source: 'fallback' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2. Client-Side Buildability & Geometry Constraint Checker (matches engine.py)
// ---------------------------------------------------------------------------
const MAX_CANOPY_AREA_M2 = 24.0;
const CANOPY_HEIGHT_MIN = 2.3;
const CANOPY_HEIGHT_MAX = 4.5;

function pointInPoly(x, y, poly) {
  if (!Array.isArray(poly) || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function boxFootprint(center, size, rotDeg) {
  const [cx, cy] = center || [0, 0];
  const [w, d] = size || [6, 2.5];
  const rad = ((rotDeg || 0) * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const hw = w / 2;
  const hd = d / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([dx, dy]) => [cx + dx * c - dy * s, cy + dx * s + dy * c]);
}

export function checkCanopyConstraintsClient(scene, { widthM, depthM, heightM, rotationDeg, center }, extraErrors = []) {
  const errs = [...(extraErrors || [])];
  const area = widthM * depthM;
  if (area > MAX_CANOPY_AREA_M2 + 1e-6) {
    errs.push(`area ${area.toFixed(1)} m² > ${MAX_CANOPY_AREA_M2} m² max`);
  }
  if (heightM < CANOPY_HEIGHT_MIN - 1e-6 || heightM > CANOPY_HEIGHT_MAX + 1e-6) {
    errs.push(`clearance ${heightM.toFixed(2)} m outside ${CANOPY_HEIGHT_MIN}–${CANOPY_HEIGHT_MAX} m`);
  }
  if (scene?.buildable_area?.length >= 3) {
    const fp = boxFootprint(center || [0, -0.5], [widthM, depthM], rotationDeg);
    const outside = fp.some(([x, y]) => !pointInPoly(x, y, scene.buildable_area));
    if (outside && !errs.some((e) => e.includes('buildable'))) {
      errs.push('extends outside buildable kerb zone');
    }
  }
  return {
    ok: errs.length === 0,
    area,
    heightM,
    errors: errs,
  };
}

// ---------------------------------------------------------------------------
// 3. One-Click Real Hackney Mare St Photo Loader (CC BY-SA 3.0 Cjc13)
// ---------------------------------------------------------------------------
const PHOTO_CREDIT = 'Hackney Mare St Bus Shelter · 14:30 BST · CC BY-SA 3.0 Cjc13';
let cachedPhotoBlob = null;

async function fetchSamplePhotoBlob() {
  if (cachedPhotoBlob) return cachedPhotoBlob;
  for (const path of ['/assets/hackney_mare_street.jpg', 'assets/hackney_mare_street.jpg']) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 0) {
          cachedPhotoBlob = blob;
          return blob;
        }
      }
    } catch {
      // try next path
    }
  }
  // Last-resort synthetic street shelter image if asset file is unavailable offline
  const cv = document.createElement('canvas');
  cv.width = 640;
  cv.height = 420;
  const g = cv.getContext('2d');
  g.fillStyle = '#6897bb';
  g.fillRect(0, 0, 640, 220);
  g.fillStyle = '#8b5a3c';
  g.fillRect(40, 60, 560, 160);
  g.fillStyle = '#3a3f46';
  g.fillRect(0, 220, 640, 200);
  g.strokeStyle = '#ff7a3d';
  g.lineWidth = 5;
  g.strokeRect(180, 130, 260, 150);
  g.fillStyle = '#ffffff';
  g.font = 'bold 20px sans-serif';
  g.fillText('Hackney Mare St Stop — 14:30 BST', 195, 115);
  return await new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/jpeg', 0.9));
}

export async function loadSamplePhotoIntoInput(targetInputId) {
  const input = $(targetInputId);
  if (!input) return null;
  const blob = await fetchSamplePhotoBlob();
  const file = new File([blob], 'hackney_mare_street.jpg', {
    type: blob.type || 'image/jpeg',
    lastModified: Date.now(),
  });
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  } catch (e) {
    console.warn('DataTransfer assignment failed:', e);
  }

  // Always set #photoTime to 14:30 for Hackney Mare St verification
  const timeInput = $('photoTime');
  if (timeInput) {
    timeInput.value = '14:30';
    timeInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  input.dispatchEvent(new Event('change', { bubbles: true }));
  renderPhotoPreviewFor(targetInputId, file);
  return file;
}

function renderPhotoPreviewFor(targetInputId, file) {
  const previewId = `${targetInputId}Preview`;
  let box = $(previewId);
  const input = $(targetInputId);
  if (!input) return;
  if (!box) {
    box = document.createElement('div');
    box.id = previewId;
    box.className = 'sample-photo-preview';
    input.insertAdjacentElement('afterend', box);
  }
  const url = URL.createObjectURL(file);
  box.innerHTML = `
    <img src="${url}" alt="Hackney Mare Street">
    <div class="sample-photo-meta">
      <b>hackney_mare_street.jpg (${Math.max(1, Math.round(file.size / 1024))} KB)</b>
      <span>${esc(PHOTO_CREDIT)}</span>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// 4. Main HUD Initializer — initHUD(hooks)
// ---------------------------------------------------------------------------
export function initHUD(hooks = {}) {
  // Ensure hud.css is linked in document.head
  if (!document.querySelector('link[href*="hud.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'hud.css';
    document.head.appendChild(link);
  }

  const getState = () => (typeof hooks.getState === 'function' ? hooks.getState() : window.shadowstop?.state || null);

  // -------------------------------------------------------------------------
  // A. TOPBAR COMMAND CONTROLS (.hero-demo-btn, .replay-btn, .cinema-btn)
  // -------------------------------------------------------------------------
  const topbar = $('topbar');
  const topActions = topbar?.querySelector('.top-actions');
  let topControls = $('hudTopControls');
  if (topbar && !topControls) {
    topControls = document.createElement('div');
    topControls.id = 'hudTopControls';
    topControls.className = 'hud-top-controls';
    topControls.innerHTML = `
      <button id="heroDemoBtn" class="hero-demo-btn" title="Run the choreographed Hackney Town Hall 3D verification showcase">
        <span>&#9654; RUN HERO DEMO</span>
      </button>
      <button id="replayBtn" class="replay-btn" title="Demo-speed safety: instantly replay last verified Argon proposal loop without waiting for live API">
        <span>&#8634; Instant Verified Replay</span>
        <span id="replayBadge" class="replay-pill">REPLAY / CACHED</span>
      </button>
      <button id="cinemaBtn" class="cinema-btn" title="Collapse sidebars for full-screen 3D solar theatre (Shortcut: C)">
        <span id="cinemaBtnLabel">&#9974; Cinema View</span>
      </button>
    `;
    if (topActions) {
      topbar.insertBefore(topControls, topActions);
    } else {
      topbar.appendChild(topControls);
    }
  }

  const heroDemoBtn = $('heroDemoBtn');
  const replayBtn = $('replayBtn');
  const cinemaBtn = $('cinemaBtn');

  if (heroDemoBtn) {
    heroDemoBtn.onclick = () => {
      if (typeof hooks.onRunHeroDemo === 'function') {
        hooks.onRunHeroDemo();
      }
    };
  }

  if (replayBtn) {
    replayBtn.onclick = () => {
      if (typeof hooks.onReplayPropose === 'function') {
        hooks.onReplayPropose();
      }
    };
  }

  let cinemaOn = false;
  function setCinemaMode(on) {
    cinemaOn = Boolean(on);
    document.body.classList.toggle('cinema-mode', cinemaOn);
    if (cinemaBtn) {
      cinemaBtn.classList.toggle('on', cinemaOn);
      const lbl = $('cinemaBtnLabel');
      if (lbl) lbl.innerHTML = cinemaOn ? '&#10064; Exit Cinema' : '&#9974; Cinema View';
    }
    if (typeof hooks.onResizeView === 'function') {
      hooks.onResizeView();
    }
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      if (typeof hooks.onResizeView === 'function') hooks.onResizeView();
    });
  }

  if (cinemaBtn) {
    cinemaBtn.onclick = () => setCinemaMode(!cinemaOn);
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'c' || e.key === 'C') {
      setCinemaMode(!cinemaOn);
    } else if (e.key === 'Escape' && cinemaOn) {
      setCinemaMode(false);
    }
  });

  function setReplayAvailable(hasLocalStorageReplay) {
    const badge = $('replayBadge');
    if (!replayBtn || !badge) return;
    replayBtn.classList.toggle('has-local', Boolean(hasLocalStorageReplay));
    badge.textContent = hasLocalStorageReplay ? 'REPLAY · SAVED' : 'REPLAY / CACHED';
  }

  // -------------------------------------------------------------------------
  // B. CINEMATIC NARRATIVE BANNER (#cinematicBanner) inside #view
  // -------------------------------------------------------------------------
  const viewEl = $('view');
  let bannerEl = $('cinematicBanner');
  if (viewEl && !bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.id = 'cinematicBanner';
    bannerEl.className = 'hidden';
    bannerEl.innerHTML = `
      <div class="cb-top">
        <span id="cbTag" class="cb-tag">STAGE TELEMETRY</span>
        <div class="cb-right-group">
          <div id="cbMetricPill" class="cb-metric">
            <span id="cbMetricLbl" class="cb-metric-lbl">SHADE</span>
            <span id="cbMetricVal" class="cb-metric-val">--</span>
          </div>
          <div class="cb-actions">
            <button id="cbRestartBtn" class="cb-btn" type="button" title="Restart hero sequence">&#8634; Restart</button>
            <button id="cbSkipBtn" class="cb-btn" type="button" title="Skip to interactive controls">Skip to Interactive &rarr;</button>
          </div>
        </div>
      </div>
      <div id="cbTitle" class="cb-title">ShadowStop Verification Engine</div>
      <div id="cbSubtitle" class="cb-subtitle">Deterministic solar ray-casting across the waiting area.</div>
      <div class="cb-progress"><div id="cbProgressBar" class="cb-progress-bar"></div></div>
    `;
    viewEl.appendChild(bannerEl);

    $('cbSkipBtn')?.addEventListener('click', () => {
      if (typeof hooks.onSkipHeroDemo === 'function') {
        hooks.onSkipHeroDemo();
      } else {
        updateCinematicBanner({ active: false });
      }
    });

    $('cbRestartBtn')?.addEventListener('click', () => {
      if (typeof hooks.onResetHeroDemo === 'function') {
        hooks.onResetHeroDemo();
      } else if (typeof hooks.onRunHeroDemo === 'function') {
        hooks.onRunHeroDemo();
      }
    });
  }

  function updateCinematicBanner(info = {}) {
    if (!bannerEl) return;
    const active = Boolean(info?.active);
    bannerEl.classList.toggle('hidden', !active);
    heroDemoBtn?.classList.toggle('running', active);
    if (!active) return;

    const tag = info.tag ?? info.phaseTag ?? 'SOLAR TELEMETRY';
    const title = info.title ?? info.headline ?? '';
    const subtitle = info.subtitle ?? info.description ?? '';
    const metricLabel = info.metricLabel ?? info.metric_label ?? 'SHADE';
    const metricValue = info.metricValue ?? info.metric_value ?? info.metricPill ?? '--';
    let prog = info.progress != null ? Number(info.progress) : 0;
    if (prog > 0 && prog <= 1) prog *= 100;
    prog = Math.max(0, Math.min(100, prog || 0));

    const tagEl = $('cbTag');
    const titleEl = $('cbTitle');
    const subEl = $('cbSubtitle');
    const mLblEl = $('cbMetricLbl');
    const mValEl = $('cbMetricVal');
    const mPillEl = $('cbMetricPill');
    const barEl = $('cbProgressBar');

    if (tagEl) tagEl.textContent = tag;
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subtitle;
    if (mLblEl) mLblEl.textContent = metricLabel;
    if (mValEl) mValEl.textContent = metricValue;
    if (mPillEl) mPillEl.classList.toggle('hidden', !metricValue && !metricLabel);
    if (barEl) barEl.style.width = `${prog.toFixed(1)}%`;

    const upper = `${tag} ${title} ${metricValue}`.toUpperCase();
    bannerEl.classList.remove('tone-verified', 'tone-rejected');
    if (upper.includes('ACCEPT') || upper.includes('VERIFIED') || upper.includes('77%') || upper.includes('95%')) {
      bannerEl.classList.add('tone-verified');
    } else if (upper.includes('REJECT') || upper.includes('EXPOSED') || upper.includes('FAIL') || upper.includes('0%')) {
      bannerEl.classList.add('tone-rejected');
    }
  }

  // -------------------------------------------------------------------------
  // C. POSTCODE & LONDON AREA QUICK-JUMP BAR (#tab-map) + RADAR OVERLAY
  // -------------------------------------------------------------------------
  const tabMap = $('tab-map');
  const mapEl = $('map');
  if (tabMap && mapEl && !$('postcodeBar')) {
    const bar = document.createElement('div');
    bar.id = 'postcodeBar';
    bar.className = 'postcode-bar';
    bar.innerHTML = `
      <div class="postcode-input-row">
        <input id="postcodeInput" type="text" placeholder="Postcode or area (e.g. E8 1EA, Brixton, Shoreditch)..." autocomplete="off">
        <button id="postcodeGoBtn" type="button" class="primary">Go</button>
      </div>
      <div class="area-chips" id="areaChips">
        <button type="button" class="area-chip active" data-query="E8 1EA">Hackney E8</button>
        <button type="button" class="area-chip" data-query="Shoreditch E1">Shoreditch E1</button>
        <button type="button" class="area-chip" data-query="Brixton SW9">Brixton SW9</button>
        <button type="button" class="area-chip" data-query="King's Cross N1C">King's Cross N1C</button>
      </div>
      <div id="postcodeStatus" class="postcode-status">
        <span>London Borough Discovery · Instant OSM 3D Rebuild</span>
      </div>
    `;
    tabMap.insertBefore(bar, mapEl);

    const pcInput = $('postcodeInput');
    const pcGoBtn = $('postcodeGoBtn');
    const pcStatus = $('postcodeStatus');
    const chips = bar.querySelectorAll('.area-chip');

    async function triggerJump(queryText, chipEl = null) {
      const q = String(queryText || pcInput?.value || '').trim();
      if (!q) return;
      if (pcInput) pcInput.value = q;
      if (pcStatus) pcStatus.innerHTML = `<span>Locating <b>${esc(q)}</b>…</span>`;
      if (pcGoBtn) pcGoBtn.disabled = true;
      try {
        const loc = await lookupLondonLocation(q);
        if (!loc) {
          if (pcStatus) pcStatus.innerHTML = `<span style="color:var(--red)">Could not find "${esc(q)}" in Greater London</span>`;
          return;
        }
        chips.forEach((c) => c.classList.toggle('active', c === chipEl || c.dataset.query.toLowerCase() === q.toLowerCase()));
        if (pcStatus) {
          pcStatus.innerHTML = `<span>&#10003; ${esc(loc.label)}</span><span class="muted">${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}</span>`;
        }
        if (typeof hooks.onPostcodeJump === 'function') {
          hooks.onPostcodeJump(loc.lat, loc.lon, loc.label, true);
        }
      } finally {
        if (pcGoBtn) pcGoBtn.disabled = false;
      }
    }

    pcGoBtn?.addEventListener('click', () => triggerJump(pcInput?.value));
    pcInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerJump(pcInput.value);
      }
    });
    chips.forEach((chip) => {
      chip.addEventListener('click', () => triggerJump(chip.dataset.query, chip));
    });
  }

  // Radar scan pulse overlay inside #map
  let scanOverlay = $('mapScanPulse');
  if (mapEl && !scanOverlay) {
    scanOverlay = document.createElement('div');
    scanOverlay.id = 'mapScanPulse';
    scanOverlay.className = 'map-scan-overlay hidden';
    scanOverlay.innerHTML = `
      <div class="radar-ring"></div>
      <div class="radar-sweep"></div>
      <div id="mapScanStatus" class="scan-status">Scanning OSM bus stops &amp; 3D buildings…</div>
    `;
    mapEl.appendChild(scanOverlay);
  }

  function showMapScanPulse(on, statusText) {
    if (!scanOverlay && mapEl) {
      scanOverlay = $('mapScanPulse');
    }
    if (!scanOverlay) return;
    if (mapEl && scanOverlay.parentElement !== mapEl) {
      mapEl.appendChild(scanOverlay);
    }
    scanOverlay.classList.toggle('hidden', !on);
    const st = $('mapScanStatus');
    if (st && statusText) st.textContent = statusText;
  }

  // Automatically observe #scanBtn busy state so radar pulse activates during any map scan
  const scanBtn = $('scanBtn');
  if (scanBtn) {
    const obs = new MutationObserver(() => {
      if (scanBtn.disabled) {
        showMapScanPulse(true, 'Scanning OSM stops & scoring shade…');
      } else {
        showMapScanPulse(false);
      }
    });
    obs.observe(scanBtn, { attributes: true, attributeFilter: ['disabled'] });
  }

  // -------------------------------------------------------------------------
  // D. INTERACTIVE CANOPY & LOUVER TUNER CARD (#canopyTunerCard) in #right
  // -------------------------------------------------------------------------
  const rightPanel = $('right');
  const chartLegend = rightPanel?.querySelector('.chart-legend');
  let tunerCard = $('canopyTunerCard');
  if (rightPanel && !tunerCard) {
    tunerCard = document.createElement('div');
    tunerCard.id = 'canopyTunerCard';
    tunerCard.innerHTML = `
      <div class="tuner-head">
        <div class="tuner-title-wrap">
          <div class="tuner-title">&#9881; Parametric Canopy &amp; Louver Tuner</div>
          <div id="tunerSub" class="tuner-sub">Live sun-vector geometry &amp; buildability check</div>
        </div>
        <div class="louver-viz" id="louverViz" title="Live louver blade tilt preview">
          <div class="louver-blade"></div>
          <div class="louver-blade"></div>
          <div class="louver-blade"></div>
          <div class="louver-blade"></div>
          <div class="louver-blade"></div>
        </div>
      </div>

      <div class="tuner-grid">
        <div class="tuner-row">
          <div class="tuner-label-line">
            <span class="tl-name">Louver Angle (solar blade tilt)</span>
            <span id="tunerLouverVal" class="tl-val">0&deg;</span>
          </div>
          <input id="tunerLouver" type="range" min="-45" max="45" step="1" value="0">
        </div>

        <div class="tuner-row">
          <div class="tuner-label-line">
            <span class="tl-name">Canopy Orientation (rotation)</span>
            <span id="tunerRotationVal" class="tl-val">0&deg;</span>
          </div>
          <input id="tunerRotation" type="range" min="-90" max="90" step="1" value="0">
        </div>

        <div class="tuner-row">
          <div class="tuner-label-line">
            <span class="tl-name">Canopy Span (width &times; depth)</span>
            <span id="tunerSpanVal" class="tl-val">6.0m &times; 2.6m (15.6 m&sup2;)</span>
          </div>
          <div class="tuner-dual-sliders">
            <div class="tuner-dual-item">
              <span><em>Width</em> <b id="tunerWidthLbl">6.0m</b></span>
              <input id="tunerWidth" type="range" min="2.4" max="8.0" step="0.2" value="6.0">
            </div>
            <div class="tuner-dual-item">
              <span><em>Depth</em> <b id="tunerDepthLbl">2.6m</b></span>
              <input id="tunerDepth" type="range" min="1.4" max="4.4" step="0.1" value="2.6">
            </div>
          </div>
        </div>

        <div class="tuner-row">
          <div class="tuner-label-line">
            <span class="tl-name">Underside Clearance Height (z0)</span>
            <span id="tunerHeightVal" class="tl-val">2.60 m</span>
          </div>
          <input id="tunerHeight" type="range" min="2.3" max="4.2" step="0.05" value="2.6">
        </div>
      </div>

      <div id="tunerConstraintBadge" class="tuner-constraint-badge ok">
        &#10003; Buildable: 2.6m clearance, 15.6 m&sup2; &le; 24 m&sup2;
      </div>

      <button id="tunerWeakestBtn" type="button" class="tuner-weakest-btn" title="Jump to the weakest sun-up hour and ask Argon to redesign for that counterexample angle">
        &#9889; Send Weakest Hour to Argon
      </button>
    `;

    if (chartLegend) {
      chartLegend.insertAdjacentElement('afterend', tunerCard);
    } else {
      rightPanel.appendChild(tunerCard);
    }
  }

  const sLouver = $('tunerLouver');
  const sRotation = $('tunerRotation');
  const sWidth = $('tunerWidth');
  const sDepth = $('tunerDepth');
  const sHeight = $('tunerHeight');

  function readTunerValues() {
    return {
      louverAngleDeg: Number(sLouver?.value ?? 0),
      rotationDeg: Number(sRotation?.value ?? 0),
      widthM: Number(sWidth?.value ?? 6.0),
      depthM: Number(sDepth?.value ?? 2.6),
      heightM: Number(sHeight?.value ?? 2.6),
    };
  }

  function renderTunerUI(vals, externalErrors = []) {
    const { louverAngleDeg, rotationDeg, widthM, depthM, heightM } = vals;
    const area = widthM * depthM;

    const lVal = $('tunerLouverVal');
    if (lVal) lVal.textContent = `${louverAngleDeg > 0 ? '+' : ''}${louverAngleDeg}°`;

    const rVal = $('tunerRotationVal');
    if (rVal) rVal.textContent = `${rotationDeg > 0 ? '+' : ''}${rotationDeg}°`;

    const spVal = $('tunerSpanVal');
    if (spVal) spVal.textContent = `${widthM.toFixed(1)}m × ${depthM.toFixed(1)}m (${area.toFixed(1)} m²)`;

    const wLbl = $('tunerWidthLbl');
    if (wLbl) wLbl.textContent = `${widthM.toFixed(1)}m`;

    const dLbl = $('tunerDepthLbl');
    if (dLbl) dLbl.textContent = `${depthM.toFixed(1)}m`;

    const hVal = $('tunerHeightVal');
    if (hVal) hVal.textContent = `${heightM.toFixed(2)} m`;

    // Rotate louver preview blades
    const viz = $('louverViz');
    if (viz) {
      viz.querySelectorAll('.louver-blade').forEach((b) => {
        b.style.transform = `rotate(${louverAngleDeg}deg)`;
      });
    }

    // Evaluate buildability & constraints
    const st = getState();
    const scene = st?.scene || null;
    const activeProp = (scene?.proposals || [])[0];
    const center = activeProp?.center || [0, -0.5];
    const check = checkCanopyConstraintsClient(scene, { widthM, depthM, heightM, rotationDeg, center }, externalErrors);

    const badge = $('tunerConstraintBadge');
    if (badge) {
      if (check.ok) {
        badge.className = 'tuner-constraint-badge ok';
        badge.textContent = `✓ Buildable: ${heightM.toFixed(1)}m clearance, ${area.toFixed(1)} m² ≤ 24 m²`;
      } else {
        badge.className = 'tuner-constraint-badge bad';
        badge.textContent = `⚠ Constraint violation: ${check.errors.join(' · ')}`;
      }
    }
  }

  function onSliderInput() {
    const vals = readTunerValues();
    renderTunerUI(vals);
    if (typeof hooks.onTunerChange === 'function') {
      hooks.onTunerChange(vals);
    }
  }

  [sLouver, sRotation, sWidth, sDepth, sHeight].forEach((inp) => {
    inp?.addEventListener('input', onSliderInput);
  });

  $('tunerWeakestBtn')?.addEventListener('click', () => {
    const st = getState();
    const worst = st?.after?.worst_time || st?.before?.worst_time;
    if (worst && window.shadowstop?.setHour) {
      const [h, m] = String(worst).split(':').map(Number);
      if (isFinite(h)) window.shadowstop.setHour(h + (m || 0) / 60);
    }
    const proposeBtn = $('proposeBtn');
    if (proposeBtn && !proposeBtn.disabled) {
      proposeBtn.click();
    }
  });

  function syncTunerFromProposal(proposalInput, louverAngleDeg = 0, constraintErrors = []) {
    const prop = Array.isArray(proposalInput)
      ? proposalInput.find((p) => p?.kind === 'canopy' || p?.shape === 'box') || proposalInput[0]
      : proposalInput;

    if (prop) {
      const w = prop.size?.[0] ?? (prop.radius ? prop.radius * 2 : 6.0);
      const d = prop.size?.[1] ?? (prop.radius ? prop.radius * 2 : 2.6);
      const z0 = prop.z0 ?? 2.6;
      const rot = prop.rotation_deg ?? 0;

      if (sWidth) sWidth.value = String(Math.max(2.0, Math.min(8.0, Number(w) || 6.0)));
      if (sDepth) sDepth.value = String(Math.max(1.2, Math.min(4.5, Number(d) || 2.6)));
      if (sHeight) sHeight.value = String(Math.max(2.1, Math.min(4.5, Number(z0) || 2.6)));
      if (sRotation) sRotation.value = String(Math.max(-90, Math.min(90, Math.round(Number(rot) || 0))));
    }
    if (louverAngleDeg != null && sLouver) {
      sLouver.value = String(Math.max(-45, Math.min(45, Math.round(Number(louverAngleDeg) || 0))));
    }

    const sub = $('tunerSub');
    if (sub && prop) {
      sub.textContent = `${prop.id || prop.kind || 'Canopy'}${prop.material ? ' · ' + String(prop.material).replace(/_/g, ' ') : ''}`;
    }

    renderTunerUI(readTunerValues(), constraintErrors);
  }

  // -------------------------------------------------------------------------
  // E. ONE-CLICK REAL HACKNEY STREET PHOTO LOADER BUTTONS
  // -------------------------------------------------------------------------
  function attachSamplePhotoButton(inputId, btnId) {
    const input = $(inputId);
    if (!input || $(btnId)) return;
    const btn = document.createElement('button');
    btn.id = btnId;
    btn.type = 'button';
    btn.className = 'sample-photo-btn';
    btn.innerHTML = '&#128247; Load Hackney Mare St Photo (CC BY-SA)';
    input.insertAdjacentElement('beforebegin', btn);

    let loading = false;
    btn.addEventListener('click', async () => {
      if (loading) return;
      loading = true;
      const prevHtml = btn.innerHTML;
      btn.innerHTML = '<span class="spinner"></span>Loading Hackney Mare St photo…';
      btn.disabled = true;
      try {
        await loadSamplePhotoIntoInput(inputId);
        // Also pre-load into the paired photo input so both Render & Photo Check are 1-click ready
        const otherId = inputId === 'streetInput' ? 'photoInput' : 'streetInput';
        if ($(otherId) && !$(otherId).files?.length) {
          await loadSamplePhotoIntoInput(otherId);
        }
        if (typeof hooks.onLoadSamplePhoto === 'function') {
          await hooks.onLoadSamplePhoto(inputId);
        }
        btn.innerHTML = '&#10003; Loaded Hackney Mare St Photo (14:30 BST)';
      } catch (e) {
        console.error('Failed to load sample photo:', e);
        btn.innerHTML = prevHtml;
      } finally {
        btn.disabled = false;
        loading = false;
      }
    });

    // Also show preview if user manually selects a file
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) renderPhotoPreviewFor(inputId, f);
    });
  }

  attachSamplePhotoButton('streetInput', 'loadStreetSampleBtn');
  attachSamplePhotoButton('photoInput', 'loadPhotoCheckSampleBtn');

  // Initial sync of tuner UI
  const initState = getState();
  if (initState?.scene?.proposals?.[0]) {
    syncTunerFromProposal(initState.scene.proposals[0], 0, []);
  } else {
    renderTunerUI(readTunerValues(), []);
  }

  return {
    updateCinematicBanner,
    syncTunerFromProposal,
    setReplayAvailable,
    setCinemaMode,
    showMapScanPulse,
  };
}

export default initHUD;
