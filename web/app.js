// ShadowStop web app: 3D shade view + verification panel.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { scoreScene } from './engine.js';

// ---------------------------------------------------------------- utilities
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (v) => (v == null || isNaN(v) ? '--' : Math.round(v * 100) + '%');
const scoreOf = (s) => (s == null ? null : typeof s === 'number' ? s : s.score);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtClock = (h) => {
  const m = Math.round(h * 60);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
const parseClock = (t) => { const [h, m] = String(t).split(':').map(Number); return h + (m || 0) / 60; };

function toast(msg, kind = 'error') {
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'info' ? ' info' : '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'info' ? 3500 : 6000);
}

async function api(path, { method = 'GET', body, form, timeout = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const opts = { method, signal: ctrl.signal, headers: {} };
    if (form) { opts.body = form; }
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    const res = await fetch(path, opts);
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : JSON.stringify(j); }
      catch { detail = res.statusText; }
      throw new Error(`${res.status} ${detail}`.slice(0, 220));
    }
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`timed out after ${Math.round(timeout / 1000)} s`);
    throw e;
  } finally { clearTimeout(timer); }
}

function busy(btn, on, label) {
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${label || 'Working…'}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

// Embedded copy of scenes/demo.json: last-resort fallback so the stage demo never shows an empty view.
const EMBEDDED_DEMO = {"id":"demo-glass-shelter","name":"Demo stop: glass shelter on an east-west street","lat":51.545,"lon":-0.0553,"date":"2026-07-19","hours":[9,18],"utc_offset":1,"waiting_area":[[-3,-1.6],[3,-1.6],[3,0.6],[-3,0.6]],"buildable_area":[[-6,-4],[6,-4],[6,1.5],[-6,1.5]],"occluders":[{"id":"bldg-north","kind":"building","shape":"prism","footprint":[[-20,4],[20,4],[20,16],[-20,16]],"z0":0,"z1":12,"opacity":1.0,"source":"osm","confidence":0.9,"note":"terrace north of the stop, 4 levels"},{"id":"bldg-south","kind":"building","shape":"prism","footprint":[[-18,-26],[-4,-26],[-4,-14],[-18,-14]],"z0":0,"z1":9,"opacity":1.0,"source":"osm","confidence":0.9,"note":"across the road, 3 levels"},{"id":"roof","kind":"shelter_roof","shape":"box","center":[0,-0.3],"size":[4,1.4],"rotation_deg":0,"z0":2.4,"z1":2.5,"opacity":0.1,"source":"argon","confidence":0.8,"note":"clear polycarbonate roof: OSM says shelter=yes, but it gives almost no shade"},{"id":"back-panel","kind":"wall","shape":"box","center":[0,0.45],"size":[4,0.05],"rotation_deg":0,"z0":0.1,"z1":2.4,"opacity":0.1,"source":"argon","confidence":0.8,"note":"glass back panel"},{"id":"tree-west","kind":"tree","shape":"sphere","center":[-9,-2],"radius":2.5,"z0":3,"z1":8,"opacity":0.7,"source":"argon","confidence":0.6},{"id":"pole","kind":"wall","shape":"cylinder","center":[3.5,-1.8],"radius":0.05,"z0":0,"z1":3,"opacity":1.0,"source":"measured","confidence":1.0,"note":"bus stop flag pole, 3 m"}],"proposals":[{"id":"canopy-1","kind":"canopy","shape":"box","center":[0,-1.0],"size":[6,2.6],"rotation_deg":0,"z0":2.6,"z1":2.7,"opacity":1.0,"source":"proposal","confidence":1.0,"note":"opaque canopy over the waiting area"}]};

// ---------------------------------------------------------------- sun model (NOAA-style, matches server convention)
// azimuth: degrees clockwise from north; elevation: degrees above horizon.
function computeSun(lat, lon, dateStr, localHour, utcOffset) {
  const rad = Math.PI / 180;
  const [Y, M, D] = dateStr.split('-').map(Number);
  const N = Math.round((Date.UTC(Y, M - 1, D) - Date.UTC(Y, 0, 0)) / 86400000);
  const B = (360 / 365) * (N - 81) * rad;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minutes
  const decl = 23.44 * Math.sin((360 / 365) * (N + 284) * rad) * rad;
  const solarT = localHour - utcOffset + lon / 15 + eot / 60;
  const H = 15 * (solarT - 12) * rad;
  const phi = lat * rad;
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / rad + 180;
  az = ((az % 360) + 360) % 360;
  return { azimuth: az, elevation: el / rad };
}
function sunDirScene(azDeg, elDeg) {
  const a = azDeg * Math.PI / 180, e = elDeg * Math.PI / 180;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}
// scene (x east, y north, z up) -> three (x, z, -y)
const toThree = (x, y, z) => new THREE.Vector3(x, z, -y);

// ---------------------------------------------------------------- state
const state = {
  scene: null,
  before: null,       // score object without proposals
  after: null,        // score object with proposals
  mode: 'after',      // before | after
  heat: true,
  hour: 12,
  playing: false,
  serverSun: null,    // {hour, azimuth, elevation} last /api/sun answer
  proposing: false,
  attempts: [],       // last /api/propose attempts
  accepted: null,     // accepted attempt (verifier said yes)
  approved: null,     // {at: Date} once the human operator approves
  beforeBaseline: null, // verified score before any proposal (for the brief)
};

// ---------------------------------------------------------------- three.js setup
const viewEl = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewEl.appendChild(renderer.domElement);

const scene3 = new THREE.Scene();
scene3.fog = new THREE.Fog(0x0b0f14, 90, 220);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
camera.position.set(15, 16, 25);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, -1);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.03;

const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x3a3226, 0.75);
scene3.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene3.add(sun);
scene3.add(sun.target);
const sunBall = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffb23f, transparent: true, opacity: 0.25 }));
sunBall.add(sunGlow);
scene3.add(sunBall);

// ground + road
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x59606a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene3.add(ground);
const road = new THREE.Mesh(new THREE.PlaneGeometry(400, 8), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 1 }));
road.rotation.x = -Math.PI / 2;
road.receiveShadow = true;
scene3.add(road);
const pavement = new THREE.Mesh(new THREE.PlaneGeometry(400, 1), new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 1 }));
pavement.rotation.x = -Math.PI / 2;
pavement.receiveShadow = true;
scene3.add(pavement);

// north marker
function makeLabel(text, color = '#ffd23f') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(11,15,20,.7)'; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
  g.fillStyle = color; g.font = 'bold 72px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sp.scale.set(2.2, 2.2, 1);
  return sp;
}
const northLabel = makeLabel('N');
scene3.add(northLabel);

const occGroup = new THREE.Group(); scene3.add(occGroup);
const propGroup = new THREE.Group(); scene3.add(propGroup);
const overlayGroup = new THREE.Group(); scene3.add(overlayGroup);
let heatMesh = null;
let sceneRadius = 30;
const meshById = new Map();

const MAT = {
  building: () => new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.95 }),
  glass: () => new THREE.MeshStandardMaterial({ color: 0x6fc3ff, transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.1, depthWrite: false }),
  shelter_roof: () => new THREE.MeshStandardMaterial({ color: 0x6b7480, roughness: 0.6 }),
  wall: () => new THREE.MeshStandardMaterial({ color: 0x4a525c, roughness: 0.7 }),
  tree: () => new THREE.MeshStandardMaterial({ color: 0x3c9a4b, roughness: 0.9, flatShading: true }),
  canopy: () => new THREE.MeshStandardMaterial({ color: 0xe0703c, roughness: 0.55, emissive: 0x3a1206 }),
  proposalTree: () => new THREE.MeshStandardMaterial({ color: 0x8bd94a, roughness: 0.85, flatShading: true, emissive: 0x1a3306 }),
  trunk: () => new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 }),
};

function materialFor(o, isProposal) {
  const op = o.opacity ?? 1;
  if (isProposal || o.source === 'proposal' || o.kind === 'canopy') {
    return o.kind === 'tree' ? MAT.proposalTree() : MAT.canopy();
  }
  if (op < 0.3) return MAT.glass();
  return (MAT[o.kind] || MAT.building)();
}

function buildOccluder(o, isProposal = false) {
  const grp = new THREE.Group();
  grp.userData.occ = o;
  const mat = materialFor(o, isProposal);
  const z0 = o.z0 ?? 0, z1 = o.z1 ?? z0 + 1;
  const h = Math.max(0.02, z1 - z0);
  let mesh;
  if (o.shape === 'prism' && o.footprint?.length >= 3) {
    const shp = new THREE.Shape(o.footprint.map(([x, y]) => new THREE.Vector2(x, y)));
    mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shp, { depth: h, bevelEnabled: false }), mat);
    mesh.rotation.x = -Math.PI / 2; // local (x,y,z) -> (x, z, -y)
    mesh.position.y = z0;
  } else if (o.shape === 'box') {
    const [cx, cy] = o.center || [0, 0];
    const [sx, sy] = o.size || [1, 1];
    mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sy), mat);
    mesh.position.copy(toThree(cx, cy, (z0 + z1) / 2));
    mesh.rotation.y = THREE.MathUtils.degToRad(o.rotation_deg || 0);
  } else if (o.shape === 'cylinder') {
    const [cx, cy] = o.center || [0, 0];
    const r = Math.max(o.radius ?? 0.2, 0.04);
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), mat);
    mesh.position.copy(toThree(cx, cy, (z0 + z1) / 2));
  } else if (o.shape === 'sphere') {
    const [cx, cy] = o.center || [0, 0];
    const r = o.radius ?? 1;
    const cz = (z0 + z1) / 2;
    mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), mat);
    mesh.position.copy(toThree(cx, cy, cz));
    if (o.kind === 'tree') {
      const trunkTop = Math.max(0.5, cz - r * 0.6);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, trunkTop, 10), MAT.trunk());
      trunk.position.copy(toThree(cx, cy, trunkTop / 2));
      trunk.castShadow = true; trunk.receiveShadow = true;
      grp.add(trunk);
    }
  } else {
    console.warn('unknown occluder shape', o);
    return grp;
  }
  mesh.castShadow = (o.opacity ?? 1) >= 0.3; // clear glass must not throw a hard shadow
  mesh.receiveShadow = (o.opacity ?? 1) >= 0.3;
  grp.add(mesh);
  if (isProposal) {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), new THREE.LineBasicMaterial({ color: 0xffd23f }));
    edges.position.copy(mesh.position); edges.rotation.copy(mesh.rotation);
    grp.add(edges);
  }
  return grp;
}

function clearGroup(g) {
  while (g.children.length) {
    const c = g.children.pop();
    c.traverse((n) => { n.geometry?.dispose?.(); if (n.material) { n.material.map?.dispose?.(); n.material.dispose?.(); } });
  }
}

function occExtent(o) {
  const pts = [];
  if (o.footprint) pts.push(...o.footprint);
  if (o.center) {
    const r = o.radius ?? Math.hypot(...(o.size || [1, 1])) / 2;
    pts.push([o.center[0] - r, o.center[1] - r], [o.center[0] + r, o.center[1] + r]);
  }
  return pts.reduce((m, [x, y]) => Math.max(m, Math.hypot(x, y)), 0);
}

function polyShape(poly) { return new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y))); }

function buildScene3D() {
  const s = state.scene;
  clearGroup(occGroup); clearGroup(overlayGroup); meshById.clear();
  heatMesh = null;
  for (const o of s.occluders || []) { const g = buildOccluder(o); occGroup.add(g); meshById.set(o.id, g); }
  setProposals3D(s.proposals || []);

  // waiting area: filled + outline
  if (s.waiting_area?.length >= 3) {
    const wa = new THREE.Mesh(new THREE.ShapeGeometry(polyShape(s.waiting_area)),
      new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.18, depthWrite: false }));
    wa.rotation.x = -Math.PI / 2; wa.position.y = 0.02;
    overlayGroup.add(wa);
    const pts = s.waiting_area.map(([x, y]) => toThree(x, y, 0.06));
    pts.push(pts[0].clone());
    overlayGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x00e5ff })));
  }
  if (s.buildable_area?.length >= 3) {
    const pts = s.buildable_area.map(([x, y]) => toThree(x, y, 0.05));
    pts.push(pts[0].clone());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: 0xff7a3d, dashSize: 0.5, gapSize: 0.35 }));
    line.computeLineDistances();
    overlayGroup.add(line);
  }

  // road: guess south of the waiting area (demo convention); pavement strip at its kerb
  const wa = s.waiting_area || [[-3, -1], [3, 1]];
  const minY = Math.min(...wa.map((p) => p[1]));
  road.position.copy(toThree(0, minY - 6.5, 0.005));
  pavement.position.copy(toThree(0, minY - 2.3, 0.008));

  sceneRadius = Math.min(80, Math.max(18, ...[...(s.occluders || []), ...(s.proposals || [])].map(occExtent)) + 4);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -sceneRadius; cam.right = cam.top = sceneRadius;
  cam.near = 1; cam.far = sceneRadius * 6;
  cam.updateProjectionMatrix();
  northLabel.position.copy(toThree(0, Math.min(sceneRadius - 2, 22), 0.6));
  updateHeatmap();
}

function setProposals3D(list, highlight) {
  clearGroup(propGroup);
  for (const p of list || []) {
    const g = buildOccluder(p, true);
    if (highlight) g.traverse((n) => { if (n.material?.color && n.isMesh) { n.material.color.set(highlight); n.material.emissive?.set(0x220000); } });
    propGroup.add(g);
  }
  propGroup.visible = state.mode === 'after';
}

// heat colour: shade 0 hot red -> 1 cool blue
function heatColor(v) {
  const stops = [[0, [255, 59, 48]], [0.25, [255, 159, 10]], [0.5, [255, 214, 10]], [0.75, [90, 200, 250]], [1, [47, 107, 255]]];
  v = Math.max(0, Math.min(1, v));
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const t = (v - a) / (b - a);
      return ca.map((c, k) => Math.round(c + (cb[k] - c) * t));
    }
  }
  return stops[stops.length - 1][1];
}

function updateHeatmap() {
  if (heatMesh) { overlayGroup.remove(heatMesh); heatMesh.geometry.dispose(); heatMesh.material.map?.dispose(); heatMesh.material.dispose(); heatMesh = null; }
  const sc = state.mode === 'after' && state.after ? state.after : state.before;
  $('legend').classList.toggle('hidden', !(state.heat && sc?.cells?.length));
  if (!state.heat || !sc?.cells?.length) return;
  const step = sc.grid_step || 0.5;
  const xs = sc.cells.map((c) => c.x), ys = sc.cells.map((c) => c.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cols = Math.round((maxX - minX) / step) + 1, rows = Math.round((maxY - minY) / step) + 1;
  const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows;
  const g = cv.getContext('2d');
  const img = g.createImageData(cols, rows);
  for (const c of sc.cells) {
    const i = Math.round((c.x - minX) / step), j = Math.round((maxY - c.y) / step);
    if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
    const [r, gg, b] = heatColor(c.shade);
    const k = (j * cols + i) * 4;
    img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 215;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  heatMesh = new THREE.Mesh(new THREE.PlaneGeometry(cols * step, rows * step),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  heatMesh.rotation.x = -Math.PI / 2;
  heatMesh.position.copy(toThree((minX + maxX) / 2, (minY + maxY) / 2, 0.04));
  heatMesh.renderOrder = 2;
  overlayGroup.add(heatMesh);
}

function resize() {
  const w = viewEl.clientWidth, h = viewEl.clientHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
  camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewEl);
resize();

// ---------------------------------------------------------------- sun / time
function sunAt(hour) {
  const s = state.scene;
  // server authority: by_time from the score response carries the engine's own sun angles
  const bt = state.before?.by_time;
  if (bt?.length && !state.playing) {
    const hit = bt.find((b) => Math.abs(parseClock(b.t) - hour) < 1 / 120);
    if (hit && hit.sun_az != null) return { azimuth: hit.sun_az, elevation: hit.sun_el, src: 'engine' };
  }
  if (state.serverSun && Math.abs(state.serverSun.hour - hour) < 1 / 120) return { ...state.serverSun, src: 'server' };
  return { ...computeSun(s.lat, s.lon, s.date, hour, s.utc_offset ?? 0), src: 'client' };
}

function applySun(hour) {
  if (!state.scene) return;
  state.hour = hour;
  const sp = sunAt(hour);
  const d = sunDirScene(sp.azimuth, sp.elevation);
  const v = toThree(d[0], d[1], d[2]).normalize();
  sun.position.copy(v.clone().multiplyScalar(sceneRadius * 3));
  sun.target.position.set(0, 0, 0);
  const up = sp.elevation > 0;
  sun.intensity = up ? 2.6 * Math.min(1, 0.35 + sp.elevation / 25) : 0;
  sunBall.visible = up;
  sunBall.position.copy(v.clone().multiplyScalar(Math.min(70, sceneRadius * 1.6)));
  $('clock').textContent = fmtClock(hour);
  $('sunAz').textContent = sp.azimuth.toFixed(0);
  $('sunEl').textContent = sp.elevation.toFixed(0);
  $('sunSrc').textContent = sp.src === 'client' ? 'sun: client model' : sp.src === 'engine' ? 'sun: engine ✓' : 'sun: server ✓';
  updateNowShade();
  drawChart();
}

function nearestByTime(sc, hour) {
  if (!sc?.by_time?.length) return null;
  let best = null, bd = 1e9;
  for (const b of sc.by_time) { const d = Math.abs(parseClock(b.t) - hour); if (d < bd) { bd = d; best = b; } }
  return bd <= 0.26 ? best : null;
}
function updateNowShade() {
  const b = nearestByTime(state.before, state.hour), a = nearestByTime(state.after, state.hour);
  const el = $('nowShade');
  if (!b) { el.textContent = '--'; return; }
  if (state.mode === 'after' && a) el.innerHTML = `<span style="color:var(--red)">${pct(b.shade)}</span> → <span style="color:var(--green)">${pct(a.shade)}</span>`;
  else el.innerHTML = `<span style="color:var(--red)">${pct(b.shade)}</span>`;
}

const slider = $('timeSlider');
function setupSlider() {
  const [h0, h1] = state.scene.hours || [9, 18];
  slider.min = 0; slider.max = Math.round((h1 - h0) * 4); slider.step = 1;
}
function hourFromSlider() { return (state.scene.hours?.[0] ?? 9) + Number(slider.value) / 4; }
function setHour(hour) {
  const h0 = state.scene.hours?.[0] ?? 9;
  slider.value = Math.round((hour - h0) * 4);
  applySun(hour);
}
let sunFetchTimer = null;
slider.addEventListener('input', () => {
  stopPlay();
  applySun(hourFromSlider());
  clearTimeout(sunFetchTimer);
  sunFetchTimer = setTimeout(fetchServerSun, 250);
});
async function fetchServerSun() {
  const s = state.scene; if (!s) return;
  const hour = hourFromSlider();
  if (sunAt(hour).src === 'engine') return;
  const q = new URLSearchParams({ lat: s.lat, lon: s.lon, date: s.date, time: fmtClock(hour), utc_offset: s.utc_offset ?? 0 });
  try {
    const r = await api('/api/sun?' + q, { timeout: 4000 });
    state.serverSun = { hour, azimuth: r.azimuth, elevation: r.elevation };
    if (!state.playing && Math.abs(hourFromSlider() - hour) < 1e-6) applySun(hour);
  } catch { /* client model is fine */ }
}

let playLast = 0;
function stopPlay() { state.playing = false; $('playBtn').classList.remove('on'); $('playBtn').innerHTML = '&#9654;'; }
$('playBtn').addEventListener('click', () => {
  if (!state.scene) return;
  if (state.playing) { stopPlay(); setHour(Math.round(state.hour * 4) / 4); return; }
  state.playing = true; playLast = performance.now();
  $('playBtn').classList.add('on'); $('playBtn').innerHTML = '&#10074;&#10074;';
  const [h0, h1] = state.scene.hours || [9, 18];
  if (state.hour >= h1 - 0.01) state.hour = h0;
});
function tickPlay(now) {
  if (!state.playing || !state.scene) return;
  const [h0, h1] = state.scene.hours || [9, 18];
  const dt = (now - playLast) / 1000; playLast = now;
  let h = state.hour + dt * (h1 - h0) / 14; // whole window in ~14 s
  if (h > h1) h = h0;
  slider.value = Math.round((h - h0) * 4);
  applySun(h);
}

// ---------------------------------------------------------------- chart
function drawChart() {
  const cv = $('chart');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 380, H = 150;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const pad = { l: 34, r: 10, t: 10, b: 22 };
  const s = state.scene; if (!s) return;
  const [h0, h1] = s.hours || [9, 18];
  const X = (h) => pad.l + (h - h0) / (h1 - h0) * (W - pad.l - pad.r);
  const Yv = (v) => pad.t + (1 - v) * (H - pad.t - pad.b);
  g.strokeStyle = '#263241'; g.fillStyle = '#8b98a8'; g.font = '11px sans-serif'; g.lineWidth = 1;
  for (const v of [0, 0.5, 1]) { g.beginPath(); g.moveTo(pad.l, Yv(v)); g.lineTo(W - pad.r, Yv(v)); g.stroke(); g.fillText(Math.round(v * 100) + '%', 4, Yv(v) + 4); }
  for (let h = Math.ceil(h0); h <= h1; h += (h1 - h0 > 6 ? 3 : 1)) g.fillText(String(h).padStart(2, '0'), X(h) - 7, H - 6);
  const line = (sc, color, width) => {
    if (!sc?.by_time?.length) return;
    g.strokeStyle = color; g.lineWidth = width; g.beginPath();
    sc.by_time.forEach((b, i) => { const x = X(parseClock(b.t)), y = Yv(b.shade); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  };
  line(state.before, '#ff4d4f', 2.5);
  line(state.after, '#36d67e', 2.5);
  if (state.before?.worst_time) {
    const x = X(parseClock(state.before.worst_time));
    g.fillStyle = 'rgba(255,210,63,.9)'; g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x - 5, pad.t - 6 + 6); g.lineTo(x + 5, pad.t); g.fill();
  }
  const x = X(state.hour);
  g.strokeStyle = '#ffd23f'; g.lineWidth = 1.5; g.setLineDash([4, 3]);
  g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, H - pad.b); g.stroke(); g.setLineDash([]);
}

// ---------------------------------------------------------------- scoring
async function rescore() {
  const s = state.scene;
  $('scoreBefore').innerHTML = '<span class="spinner"></span>';
  $('scoreAfter').innerHTML = '<span class="spinner"></span>';
  const hasProps = (s.proposals || []).length > 0;
  const [b, a] = await Promise.allSettled([
    api('/api/score', { method: 'POST', body: { scene: s, include_proposals: false }, timeout: 30000 }),
    hasProps ? api('/api/score', { method: 'POST', body: { scene: s, include_proposals: true }, timeout: 30000 }) : Promise.resolve(null),
  ]);
  if (state.scene !== s) return; // a newer scene was loaded meanwhile
  state.before = b.status === 'fulfilled' ? b.value : null;
  state.after = a.status === 'fulfilled' ? a.value : null;
  if (b.status === 'rejected') {
    // server engine offline: fall back to the in-browser ray caster so numbers still show
    toast('Scoring API unreachable (' + b.reason.message + '): using in-browser engine', 'info');
    try {
      state.before = scoreScene(s, false, computeSun);
      if (hasProps) state.after = scoreScene(s, true, computeSun);
    } catch (e) { console.error(e); toast('Local scoring failed: ' + e.message); }
  } else if (hasProps && a.status === 'rejected') {
    try { state.after = scoreScene(s, true, computeSun); } catch { /* leave blank */ }
  }
  renderScores();
  updateHeatmap();
  if (state.before?.worst_time && !state.playing) setHour(parseClock(state.before.worst_time));
  else applySun(state.hour);
}

function renderScores() {
  const b = scoreOf(state.before), a = scoreOf(state.after);
  $('scoreBefore').textContent = pct(b);
  $('scoreAfter').textContent = a == null ? '--' : pct(a);
  const d = $('scoreDelta');
  if (b != null && a != null) {
    const pts = Math.round((a - b) * 100);
    d.textContent = (pts >= 0 ? '+' : '') + pts + ' pts shade';
    d.classList.toggle('neg', pts < 0);
  } else d.innerHTML = b != null ? '<span class="muted" style="font-size:15px;font-weight:400">No proposal yet: ask Argon</span>' : '&nbsp;';
  $('worstTime').textContent = state.before?.worst_time ? `worst: ${state.before.worst_time}` : '';
  const sc = state.before;
  if (sc?.by_time) {
    const nCells = sc.cells?.length ?? '?';
    $('verifierNote').innerHTML = `${sc._client ? '<b style="color:var(--yellow)">Server offline: in-browser ray caster.</b> ' : ''}Verified by deterministic engine: <b>${sc.by_time.length}</b> sun positions × <b>${nCells}</b> cells (${sc.grid_step ?? 0.5} m, ${sc.minutes_step ?? 15} min).`;
  } else $('verifierNote').textContent = 'Deterministic engine: sun position + ray casting.';
  drawChart();
  updateNowShade();
}

// ---------------------------------------------------------------- provenance list
function renderOccList() {
  const s = state.scene;
  const items = [...(s.occluders || []), ...(s.proposals || []).map((p) => ({ ...p, source: p.source || 'proposal', _prop: true }))];
  $('occList').innerHTML = items.map((o) => `
    <li data-id="${esc(o.id)}">
      <div class="top"><span class="badge ${esc(o.source)}">${esc(o.source === 'osm' ? 'OSM' : o.source || '?')}</span>
        <span class="id">${esc(o.id)} <span class="muted">· ${esc(o.kind)}${(o.opacity ?? 1) < 0.3 ? ' (glass)' : ''}</span></span>
        <span class="conf">${o.confidence != null ? Math.round(o.confidence * 100) + '%' : ''}</span></div>
      ${o.note ? `<div class="note">${esc(o.note)}</div>` : ''}
    </li>`).join('') || '<li class="muted">No occluders</li>';
  $('occList').querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', () => flash(li.dataset.id)));
}
function flash(id) {
  const g = meshById.get(id) || propGroup.children.find((c) => c.userData.occ?.id === id);
  if (!g) return;
  const mats = []; g.traverse((n) => { if (n.isMesh && n.material.emissive) mats.push([n.material, n.material.emissive.getHex()]); });
  mats.forEach(([m]) => m.emissive.set(0xffd23f));
  setTimeout(() => mats.forEach(([m, hex]) => m.emissive.setHex(hex)), 900);
}

// ---------------------------------------------------------------- scene loading
function loadScene(scene, { keepLog = false } = {}) {
  if (!scene || !Array.isArray(scene.occluders)) { toast('Scene JSON looks invalid'); return; }
  scene.hours = scene.hours || [9, 18];
  state.scene = scene;
  state.before = state.after = null;
  state.serverSun = null;
  $('sceneName').textContent = scene.name || scene.id || 'Scene';
  if (!keepLog) {
    $('proposeLog').innerHTML = '';
    $('renderResult').innerHTML = '';
    state.attempts = []; state.accepted = null; state.approved = null;
    updateGate();
  }
  $('photoResult').innerHTML = '';
  buildScene3D();
  setupSlider();
  renderOccList();
  const [h0, h1] = scene.hours;
  setHour(Math.min(h1, Math.max(h0, 15)));
  if (window.L && map && scene.lat != null) { map.setView([scene.lat, scene.lon], Math.max(map.getZoom(), 17)); }
  return rescore();
}

async function loadDemo() {
  const btn = $('demoBtn');
  busy(btn, true, 'Loading…');
  try {
    let scene = null;
    try { scene = await api('/api/scene/demo', { timeout: 6000 }); }
    catch (e) {
      for (const p of ['/scenes/demo.json', '../scenes/demo.json', 'scenes/demo.json']) {
        try { scene = await api(p, { timeout: 4000 }); break; } catch { /* next */ }
      }
      if (!scene) scene = structuredClone(EMBEDDED_DEMO);
      toast('API unreachable: showing the bundled demo scene', 'info');
    }
    await loadScene(scene);
  } finally { busy(btn, false); }
}
$('demoBtn').addEventListener('click', loadDemo);

// ---------------------------------------------------------------- before / after + heatmap toggles
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('#baToggle button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  propGroup.visible = mode === 'after';
  const badge = $('modeBadge'); badge.textContent = mode.toUpperCase(); badge.className = 'mode-badge ' + mode;
  updateHeatmap(); updateNowShade();
}
document.querySelectorAll('#baToggle button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('heatBtn').addEventListener('click', () => { state.heat = !state.heat; $('heatBtn').classList.toggle('on', state.heat); updateHeatmap(); });
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
  if (e.key === 'b') setMode('before');
  if (e.key === 'a') setMode('after');
  if (e.key === ' ') { e.preventDefault(); $('playBtn').click(); }
});

// ---------------------------------------------------------------- Argon propose loop
$('proposeBtn').addEventListener('click', async () => {
  if (!state.scene || state.proposing) return;
  state.proposing = true;
  const btn = $('proposeBtn');
  busy(btn, true, 'Argon is designing a fix…');
  const log = $('proposeLog');
  log.innerHTML = '<div class="thinking"><span class="spinner"></span>Argon proposes, the geometry engine verifies each attempt across the whole day…</div>';
  const origProps = state.scene.proposals || [];
  state.accepted = null; state.approved = null; state.attempts = [];
  updateGate();
  try {
    const res = await api('/api/propose', { method: 'POST', body: { scene: state.scene }, timeout: 120000 });
    log.innerHTML = '';
    setMode('after');
    const attempts = res.attempts || [];
    for (let i = 0; i < attempts.length; i++) {
      const at = attempts[i];
      const props = Array.isArray(at.proposal) ? at.proposal : at.proposal ? [at.proposal] : [];
      const note = props.map((p) => p.note || `${p.kind} ${p.shape}`).join('; ') || 'proposal';
      const card = document.createElement('div');
      card.className = 'attempt';
      card.innerHTML = `<div class="head"><span class="num">Attempt ${i + 1}${at.by ? ' · by ' + esc(at.by) : ''}</span><span class="verdict pending"><span class="spinner"></span>VERIFYING</span></div>
        <div class="note">${esc(note)}</div>`;
      log.appendChild(card);
      setProposals3D(props);
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      await sleep(1500);
      const sb = scoreOf(at.score_before), sa = scoreOf(at.score_after);
      card.classList.add(at.accepted ? 'accepted' : 'rejected');
      card.querySelector('.verdict').outerHTML = at.accepted ? '<span class="verdict ok">ACCEPTED</span>' : '<span class="verdict bad">REJECTED</span>';
      card.insertAdjacentHTML('beforeend', `
        <div class="nums"><span style="color:var(--red)">${pct(sb)}</span> → <span style="color:${at.accepted ? 'var(--green)' : 'var(--red)'}">${pct(sa)}</span></div>
        ${at.reason ? `<div class="reason">${esc(at.reason)}</div>` : ''}
        ${at.worst_time ? `<div class="cex">Counterexample: ${esc(at.worst_time)}</div>` : ''}`);
      if (!at.accepted) {
        setProposals3D(props, 0xc0392b);
        if (at.worst_time) setHour(parseClock(at.worst_time)); // show the moment it fails
      }
      await sleep(at.accepted ? 1200 : 2000);
    }
    const acc = [...attempts].reverse().find((a) => a.accepted) || null;
    if (res.final_scene) {
      await loadScene(res.final_scene, { keepLog: true });
      setMode('after');
      $('right').scrollTo({ top: 0, behavior: 'smooth' }); // land on the big verified numbers
      toast('Verified fix loaded', 'info');
    } else if (!acc) {
      setProposals3D(origProps);
    }
    state.attempts = attempts;
    state.accepted = acc;
    state.approved = null;
    if (acc) addOperatorButtons(log.querySelectorAll('.attempt')[attempts.lastIndexOf(acc)]);
    updateGate();
  } catch (e) {
    log.innerHTML = '';
    setProposals3D(origProps);
    toast('Argon propose failed: ' + e.message);
  } finally {
    state.proposing = false;
    busy(btn, false);
  }
});

// ---------------------------------------------------------------- human-in-control approval + council brief
function updateGate() {
  const acc = !!state.accepted;
  $('approvalBox').classList.toggle('hidden', !acc && !state.approved);
  $('exportBtn').disabled = !state.approved;
  const st = $('approvalStatus');
  if (state.approved) { st.className = 'approval-status ok'; st.textContent = `✓ Approved by operator at ${fmtClock(state.approved.at.getHours() + state.approved.at.getMinutes() / 60)}`; }
  else if (acc) { st.className = 'approval-status'; st.textContent = 'Verified by the engine. Awaiting operator approval before export.'; }
  $('renderBtn').disabled = !acc;
  $('renderHint').classList.toggle('hidden', acc);
}

function addOperatorButtons(card) {
  if (!card) return;
  const box = document.createElement('div');
  box.className = 'op-actions';
  box.innerHTML = '<button class="approve">✓ Approve design</button><button class="reject">✗ Reject</button>';
  card.appendChild(box);
  box.querySelector('.approve').addEventListener('click', () => {
    state.approved = { at: new Date() };
    box.innerHTML = `<div class="approval-status ok">Approved by operator at ${fmtClock(state.approved.at.getHours() + state.approved.at.getMinutes() / 60)}</div>`;
    updateGate();
  });
  box.querySelector('.reject').addEventListener('click', () => {
    state.approved = null;
    state.accepted = null;
    box.innerHTML = '<div class="approval-status bad">Rejected by operator: not exported</div>';
    updateGate();
    $('approvalBox').classList.remove('hidden');
    const st = $('approvalStatus'); st.className = 'approval-status bad'; st.textContent = 'Design rejected by operator. Ask Argon again for a new proposal.';
  });
}

$('exportBtn').addEventListener('click', () => {
  if (!state.approved || !state.accepted || !state.scene) return;
  const s = state.scene, acc = state.accepted;
  const props = Array.isArray(acc.proposal) ? acc.proposal : [acc.proposal];
  const brief = {
    title: `ShadowStop council brief: ${s.name || s.id}`,
    generated_at: new Date().toISOString(),
    approved_by_operator_at: state.approved.at.toISOString(),
    scene: { id: s.id, name: s.name, lat: s.lat, lon: s.lon, date: s.date, hours: s.hours, utc_offset: s.utc_offset },
    verified: {
      method: 'deterministic geometry engine: sun position + ray casting over the waiting area',
      score_before: scoreOf(acc.score_before) ?? scoreOf(state.before),
      score_after: scoreOf(acc.score_after) ?? scoreOf(state.after),
      worst_time_before: state.before?.worst_time ?? null,
      worst_time_after: acc.worst_time ?? state.after?.worst_time ?? null,
      engine: state.before?._client ? 'in-browser fallback' : 'server',
    },
    accepted_proposal: props.length === 1 ? props[0] : props,
    attempts: state.attempts.map((a, i) => ({
      n: i + 1, by: a.by ?? null, proposal: a.proposal, verdict: a.accepted ? 'ACCEPTED' : 'REJECTED',
      reason: a.reason ?? null, score_before: scoreOf(a.score_before), score_after: scoreOf(a.score_after), worst_time: a.worst_time ?? null,
    })),
    occluder_provenance: (s.occluders || []).map((o) => ({ id: o.id, kind: o.kind, source: o.source, confidence: o.confidence ?? null, note: o.note ?? null })),
  };
  const blob = new Blob([JSON.stringify(brief, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `shadowstop-${String(s.id || 'scene').replace(/[^\w.-]+/g, '_')}-brief.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Council brief exported', 'info');
});

// ---------------------------------------------------------------- render the verified fix into a street photo
function lightbox(src) {
  const d = document.createElement('div'); d.id = 'lightbox';
  d.innerHTML = `<img src="${src}" alt="">`;
  d.addEventListener('click', () => d.remove());
  document.body.appendChild(d);
}
$('renderBtn').addEventListener('click', async () => {
  const f = $('streetInput').files[0];
  if (!state.accepted) return toast('Needs an accepted Argon proposal first');
  if (!f) return toast('Choose a street photo of the stop first');
  const btn = $('renderBtn');
  busy(btn, true, 'Nano Banana is rendering… (20–60 s)');
  const fd = new FormData();
  fd.append('photo', f);
  fd.append('scene', JSON.stringify(state.scene));
  try {
    const r = await api('/api/render-fix', { method: 'POST', form: fd, timeout: 120000 });
    const orig = URL.createObjectURL(f);
    const out = `data:${r.mime || 'image/png'};base64,${r.image_b64}`;
    const vs = scoreOf(r.verified_score) ?? scoreOf(state.after);
    $('renderResult').innerHTML = `<div class="render-res">
      <div class="render-pair">
        <figure><img src="${orig}" alt="original"><figcaption>Today</figcaption></figure>
        <figure class="after"><img src="${out}" alt="with verified fix"><figcaption>With the fix${r.proposal_id ? ' (' + esc(r.proposal_id) + ')' : ''}</figcaption></figure>
      </div>
      ${vs != null ? `<span class="verified-chip">Verified: ${pct(vs)} shade</span>` : ''}
      <div class="render-caption">Illustration by <b>Nano Banana 2.1</b>. The shade numbers come from the verifier, not from this picture.</div>
    </div>`;
    $('renderResult').querySelectorAll('img').forEach((im) => im.addEventListener('click', () => lightbox(im.src)));
  } catch (e) {
    toast('Render failed: ' + e.message);
  } finally {
    busy(btn, false);
    updateGate();
  }
});

// ---------------------------------------------------------------- photo check
$('photoBtn').addEventListener('click', async () => {
  const f = $('photoInput').files[0];
  if (!state.scene) return toast('Load a scene first');
  if (!f) return toast('Choose a photo first');
  const btn = $('photoBtn');
  busy(btn, true, 'Argon is reading the photo…');
  const fd = new FormData();
  fd.append('photo', f);
  fd.append('scene', JSON.stringify(state.scene));
  if ($('photoTime').value) fd.append('time', $('photoTime').value);
  const out = $('photoResult');
  try {
    const r = await api('/api/photo-check', { method: 'POST', form: fd, timeout: 90000 });
    const url = URL.createObjectURL(f);
    const pts = r.points || [];
    const agr = r.agreement ?? (pts.length ? pts.filter((p) => p.agree).length / pts.length : null);
    const col = agr == null ? 'var(--muted)' : agr >= 0.75 ? 'var(--green)' : agr >= 0.5 ? 'var(--yellow)' : 'var(--red)';
    out.innerHTML = `<div class="photo-res">
      <img src="${url}" alt="photo">
      <div style="display:flex;align-items:baseline;gap:12px"><span class="agree" style="color:${col}">${pct(agr)}</span><span class="muted">agreement with the model</span></div>
      <div class="small muted">Photo time ${esc(r.photo_time ?? '?')}${r.sun ? ` · sun az ${Number(r.sun.azimuth).toFixed(0)}° el ${Number(r.sun.elevation).toFixed(0)}°` : ''}</div>
      <table class="pts"><tr><th>Point</th><th>Photo</th><th>Model</th><th></th></tr>
      ${pts.map((p) => `<tr><td>${esc(p.label)}</td><td>${esc(p.observed)}</td><td>${esc(p.predicted)}</td><td class="${p.agree ? 'y' : 'n'}">${p.agree ? '✓' : '✗'}</td></tr>`).join('')}
      </table></div>`;
    if (r.photo_time) {
      const h = parseClock(String(r.photo_time).slice(-5).includes(':') ? String(r.photo_time).match(/(\d{1,2}:\d{2})/)?.[1] : r.photo_time);
      if (!isNaN(h)) { stopPlay(); setHour(Math.round(h * 4) / 4); }
    }
  } catch (e) {
    toast('Photo check failed: ' + e.message);
  } finally { busy(btn, false); }
});

// ---------------------------------------------------------------- map + scan
let map = null;
let stopLayer = null;
function initMap() {
  if (!window.L) { $('map').innerHTML = '<div class="muted" style="padding:12px">Map library failed to load (offline?)</div>'; return; }
  map = L.map('map', { zoomControl: true }).setView([51.545, -0.0553], 17);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  stopLayer = L.layerGroup().addTo(map);
}
function scoreColor(v) {
  // red (poor shade) -> green (good shade)
  const t = Math.max(0, Math.min(1, v ?? 0));
  return `hsl(${Math.round(t * 120)}, 85%, 50%)`;
}
$('scanBtn').addEventListener('click', async () => {
  if (!map) return toast('Map not available');
  const btn = $('scanBtn');
  const b = map.getBounds();
  busy(btn, true, 'Scanning…');
  try {
    const q = new URLSearchParams({ south: b.getSouth().toFixed(6), west: b.getWest().toFixed(6), north: b.getNorth().toFixed(6), east: b.getEast().toFixed(6) });
    const r = await api('/api/scan?' + q, { timeout: 60000 });
    const stops = (r.stops || []).slice().sort((a, b) => (a.score ?? 1) - (b.score ?? 1));
    stopLayer.clearLayers();
    for (const s of stops) {
      L.circleMarker([s.lat, s.lon], { radius: 9, color: '#0b0f14', weight: 2, fillColor: scoreColor(s.score), fillOpacity: 0.95 })
        .bindTooltip(`${s.name || s.id}: ${pct(s.score)} shade${s.shelter ? ' · shelter' : ''}`)
        .on('click', () => openStop(s)).addTo(stopLayer);
    }
    const list = $('stopList');
    list.innerHTML = stops.length ? '' : '<li class="muted">No bus stops found in view.</li>';
    stops.forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="rk">${i + 1}</span><span class="dot" style="background:${scoreColor(s.score)}"></span>
        <span class="nm">${esc(s.name || s.id)}${s.shelter ? ' <span class="muted small">shelter</span>' : ''}</span><span class="sc">${pct(s.score)}</span>`;
      li.addEventListener('click', () => openStop(s));
      list.appendChild(li);
    });
    toast(`Found ${stops.length} stops`, 'info');
  } catch (e) {
    toast('Scan failed: ' + e.message);
  } finally { busy(btn, false); }
});
async function openStop(s) {
  toast(`Reconstructing ${s.name || s.id} in 3D…`, 'info');
  $('sceneName').innerHTML = `<span class="spinner"></span>Reconstructing ${esc(s.name || s.id)}…`;
  try {
    const q = new URLSearchParams({ lat: s.lat, lon: s.lon, id: s.id });
    const scene = await api('/api/scene/from_osm?' + q, { timeout: 90000 });
    await loadScene(scene);
  } catch (e) {
    toast('Could not build scene: ' + e.message);
    $('sceneName').textContent = state.scene?.name || 'No scene loaded';
  }
}

// tabs
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
  document.querySelectorAll('.tab-body').forEach((b) => b.classList.toggle('hidden', b.id !== 'tab-' + t.dataset.tab));
  if (t.dataset.tab === 'map' && map) setTimeout(() => map.invalidateSize(), 50);
}));

// ---------------------------------------------------------------- render loop + boot
function frame(now) {
  requestAnimationFrame(frame);
  tickPlay(now);
  controls.update();
  renderer.render(scene3, camera);
}
requestAnimationFrame(frame);
window.addEventListener('resize', () => { drawChart(); map?.invalidateSize(); });

initMap();
loadDemo();

// handy for debugging on stage
window.shadowstop = { state, loadScene, computeSun, setHour };
