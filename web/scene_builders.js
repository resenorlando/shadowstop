import * as THREE from 'three';

// ============================================================================
// ShadowStop — Hero 3D Scene & Architectural Canopy Builders (ES Module)
// Coordinates: local scene metres (x = east, y = north, z = up)
// Three.js mapping: toThree(x, y, z) = new THREE.Vector3(x, z, -y)
// ============================================================================

const TEX_CACHE = new Map();

function protectSharedTexture(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.dispose = () => {}; // prevent clearGroup() from destroying cached procedural textures
  return tex;
}

function hashString(str = '') {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function easeOutCubic(t) {
  const u = clamp01(t);
  return 1 - Math.pow(1 - u, 3);
}

function easeOutBack(t) {
  const u = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
}

// ----------------------------------------------------------------------------
// Procedural Canvas Textures (In-Memory, Fast, Cached)
// ----------------------------------------------------------------------------

function getAsphaltTexture() {
  if (TEX_CACHE.has('asphalt')) return TEX_CACHE.get('asphalt');
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 512;
  const g = cv.getContext('2d');

  g.fillStyle = '#2d3239';
  g.fillRect(0, 0, 512, 512);

  // Subtle longitudinal wheel-track polish bands
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, 'rgba(20,24,28,0.28)');
  grad.addColorStop(0.22, 'rgba(62,68,76,0.12)');
  grad.addColorStop(0.5, 'rgba(22,25,30,0.22)');
  grad.addColorStop(0.78, 'rgba(62,68,76,0.12)');
  grad.addColorStop(1.0, 'rgba(20,24,28,0.28)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);

  // Fine granite aggregate speckle
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 6500; i++) {
    const x = Math.floor(rand() * 512);
    const y = Math.floor(rand() * 512);
    const v = 36 + Math.floor(rand() * 42);
    g.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    g.fillRect(x, y, rand() > 0.7 ? 2 : 1, rand() > 0.7 ? 2 : 1);
  }

  const tex = protectSharedTexture(new THREE.CanvasTexture(cv));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(36, 2);
  TEX_CACHE.set('asphalt', tex);
  return tex;
}

function getBusBayTexture() {
  if (TEX_CACHE.has('bus_bay')) return TEX_CACHE.get('bus_bay');
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 256;
  const g = cv.getContext('2d');

  // TfL iron-oxide red tarmac bus bay surfacing
  g.fillStyle = '#6e2826';
  g.fillRect(0, 0, 1024, 256);

  // Aggregate grit texture on red tarmac
  let seed = 9001;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 4500; i++) {
    const x = Math.floor(rand() * 1024);
    const y = Math.floor(rand() * 256);
    const dr = Math.floor((rand() - 0.5) * 28);
    g.fillStyle = `rgb(${110 + dr},${42 + Math.floor(dr * 0.4)},${38 + Math.floor(dr * 0.4)})`;
    g.fillRect(x, y, 2, 2);
  }

  // Double red line (Red Route) along kerb edge (top of texture = kerb side)
  g.fillStyle = '#d93829';
  g.fillRect(0, 8, 1024, 7);
  g.fillRect(0, 21, 1024, 7);

  // Crisp white dashed cage boundary along outer carriageway edge (bottom) & ends
  g.fillStyle = '#f2f5f8';
  const dashW = 76;
  const gapW = 52;
  for (let x = 16; x < 1008; x += dashW + gapW) {
    g.fillRect(x, 234, Math.min(dashW, 1008 - x), 14);
  }
  // End boundary bars (left and right of cage)
  for (let y = 32; y < 236; y += 44) {
    g.fillRect(8, y, 14, 28);
    g.fillRect(1002, y, 14, 28);
  }

  // Authentic elongated road-marking "BUS STOP" lettering
  g.save();
  g.translate(512, 142);
  g.scale(1.25, 1.55);
  g.fillStyle = 'rgba(244, 247, 250, 0.92)';
  g.font = '900 58px "Arial Narrow", Impact, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.letterSpacing = '6px';
  g.fillText('BUS   STOP', 0, 0);
  g.restore();

  const tex = protectSharedTexture(new THREE.CanvasTexture(cv));
  TEX_CACHE.set('bus_bay', tex);
  return tex;
}

function getPavementSlabTexture() {
  if (TEX_CACHE.has('pavement_slabs')) return TEX_CACHE.get('pavement_slabs');
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 512;
  const g = cv.getContext('2d');

  g.fillStyle = '#b9bec6';
  g.fillRect(0, 0, 512, 512);

  // 0.6m x 0.9m staggered London concrete flag bond (4 rows x 3 cols per tile)
  const rows = 4;
  const cols = 3;
  const rowH = 512 / rows;
  const colW = 512 / cols;

  let seed = 4242;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const x = c * colW + offset;
      const y = r * rowH;
      const tone = 182 + Math.floor((rand() - 0.5) * 16);
      g.fillStyle = `rgb(${tone},${tone + 3},${tone + 7})`;
      g.fillRect(x + 2, y + 2, colW - 4, rowH - 4);

      // Subtle slab edge bevel highlight
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.lineWidth = 1.5;
      g.strokeRect(x + 3, y + 3, colW - 6, rowH - 6);

      // Mortar joint
      g.strokeStyle = '#7c838d';
      g.lineWidth = 3;
      g.strokeRect(x, y, colW, rowH);
    }
  }

  // Fine surface grain
  for (let i = 0; i < 3500; i++) {
    const x = Math.floor(rand() * 512);
    const y = Math.floor(rand() * 512);
    const v = 150 + Math.floor(rand() * 60);
    g.fillStyle = `rgba(${v},${v + 2},${v + 4},0.28)`;
    g.fillRect(x, y, 2, 2);
  }

  const tex = protectSharedTexture(new THREE.CanvasTexture(cv));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 3.5);
  TEX_CACHE.set('pavement_slabs', tex);
  return tex;
}

function getTactilePavingTexture() {
  if (TEX_CACHE.has('tactile')) return TEX_CACHE.get('tactile');
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const g = cv.getContext('2d');

  // Buff tactile blister slab base
  g.fillStyle = '#cfa968';
  g.fillRect(0, 0, 256, 256);

  // Slab joints
  g.strokeStyle = '#8f6e38';
  g.lineWidth = 4;
  g.strokeRect(2, 2, 124, 124);
  g.strokeRect(130, 2, 124, 124);
  g.strokeRect(2, 130, 124, 124);
  g.strokeRect(130, 130, 124, 124);

  // Raised blister grid
  const n = 8;
  const step = 256 / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cx = (i + 0.5) * step;
      const cy = (j + 0.5) * step;
      // Drop shadow
      g.fillStyle = 'rgba(95, 68, 28, 0.65)';
      g.beginPath();
      g.arc(cx + 2, cy + 2, 7.5, 0, Math.PI * 2);
      g.fill();
      // Blister dome
      g.fillStyle = '#dfc082';
      g.beginPath();
      g.arc(cx, cy, 7.2, 0, Math.PI * 2);
      g.fill();
      // Specular top-left highlight
      g.fillStyle = 'rgba(255, 246, 218, 0.75)';
      g.beginPath();
      g.arc(cx - 2, cy - 2, 3.2, 0, Math.PI * 2);
      g.fill();
    }
  }

  const tex = protectSharedTexture(new THREE.CanvasTexture(cv));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 1.2);
  TEX_CACHE.set('tactile', tex);
  return tex;
}

function getGraniteKerbTexture() {
  if (TEX_CACHE.has('kerb')) return TEX_CACHE.get('kerb');
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const g = cv.getContext('2d');

  g.fillStyle = '#9298a1';
  g.fillRect(0, 0, 512, 128);

  // Bevel highlight along top lip
  g.fillStyle = '#b8bec7';
  g.fillRect(0, 48, 512, 18);

  // Granite block mortar joints
  g.fillStyle = '#555b63';
  for (let x = 0; x < 512; x += 128) {
    g.fillRect(x, 0, 5, 128);
  }

  // Crystalline granite speckle
  let seed = 777;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 2200; i++) {
    const x = Math.floor(rand() * 512);
    const y = Math.floor(rand() * 128);
    const v = 110 + Math.floor(rand() * 85);
    g.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    g.fillRect(x, y, 2, 2);
  }

  const tex = protectSharedTexture(new THREE.CanvasTexture(cv));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(65, 1);
  TEX_CACHE.set('kerb', tex);
  return tex;
}

function getBusFlagTexture(stopLetter = 'N') {
  const key = `bus_flag_${stopLetter}`;
  if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 384;
  const g = cv.getContext('2d');

  // Enamel white body
  g.fillStyle = '#f6f8fa';
  g.fillRect(0, 0, 256, 384);

  // Top red stop-letter header band
  g.fillStyle = '#d62828';
  g.fillRect(0, 0, 256, 78);

  // Stop letter circle badge
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(128, 39, 27, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#d62828';
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(stopLetter, 128, 41);

  // Iconic London Bus Roundel
  g.strokeStyle = '#d62828';
  g.lineWidth = 14;
  g.beginPath();
  g.arc(128, 138, 36, 0, Math.PI * 2);
  g.stroke();

  g.fillStyle = '#1d3557';
  g.fillRect(68, 125, 120, 26);
  g.fillStyle = '#ffffff';
  g.font = 'bold 16px system-ui, sans-serif';
  g.fillText('BUS STOP', 128, 139);

  // Dark route badge panel at bottom
  g.fillStyle = '#22272e';
  g.fillRect(12, 202, 232, 168);

  const routes = ['38', '55', '106', '242', '254', 'N38'];
  routes.forEach((rt, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const rx = 22 + col * 74;
    const ry = 216 + row * 72;
    g.fillStyle = idx === 5 ? '#1b263b' : '#f1f5f9';
    g.fillRect(rx, ry, 64, 54);
    g.strokeStyle = idx === 5 ? '#ffd23f' : '#cbd5e1';
    g.lineWidth = 2;
    g.strokeRect(rx, ry, 64, 54);
    g.fillStyle = idx === 5 ? '#ffd23f' : '#0f172a';
    g.font = 'bold 24px system-ui, sans-serif';
    g.fillText(rt, rx + 32, ry + 29);
  });

  // Metallic frame border
  g.strokeStyle = '#64748b';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 248, 376);

  const tex = protectSharedTexture(new THREE.CanvasTexture(cv));
  TEX_CACHE.set(key, tex);
  return tex;
}

function getTimetableTexture() {
  if (TEX_CACHE.has('timetable')) return TEX_CACHE.get('timetable');
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 384;
  const g = cv.getContext('2d');

  g.fillStyle = '#f8fafc';
  g.fillRect(0, 0, 256, 384);

  // Header band
  g.fillStyle = '#d62828';
  g.fillRect(12, 12, 232, 42);
  g.fillStyle = '#ffffff';
  g.font = 'bold 18px system-ui, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('BUSES FROM THIS STOP', 22, 33);

  // Spider map diagram lines
  const colors = ['#d62828', '#2563eb', '#16a34a', '#d97706'];
  colors.forEach((c, i) => {
    g.strokeStyle = c;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(35 + i * 18, 72);
    g.lineTo(128, 135);
    g.lineTo(60 + i * 45, 210);
    g.stroke();
  });

  // Timetable columns
  g.fillStyle = '#e2e8f0';
  g.fillRect(16, 228, 106, 136);
  g.fillRect(134, 228, 106, 136);
  g.fillStyle = '#334155';
  for (let y = 240; y < 355; y += 12) {
    g.fillRect(24, y, 88, 5);
    g.fillRect(142, y, 88, 5);
  }

  const tex = protectSharedTexture(new THREE.CanvasTexture(cv));
  TEX_CACHE.set('timetable', tex);
  return tex;
}

// ----------------------------------------------------------------------------
// Google Earth Satellite Terrain & Roof Projection Helpers
// ----------------------------------------------------------------------------

const DEFAULT_HACKNEY_SAT_BOUNDS = {
  z19: { url: './assets/hackney_google_sat.jpg', west_m: -155.03, east_m: 177.73, south_m: -160.14, north_m: 172.61 },
  z20: { url: './assets/hackney_google_sat_z20.jpg', west_m: -83.72, east_m: 82.65, south_m: -88.84, north_m: 77.54 },
};

let activeSatelliteState = {
  z19Tex: null,
  z19Bounds: DEFAULT_HACKNEY_SAT_BOUNDS.z19,
  z20Tex: null,
  z20Bounds: DEFAULT_HACKNEY_SAT_BOUNDS.z20,
};

function getPrebakedHackneySatTextures() {
  if (!TEX_CACHE.has('sat_hackney_z19')) {
    const loader = new THREE.TextureLoader();
    const t19 = protectSharedTexture(loader.load(DEFAULT_HACKNEY_SAT_BOUNDS.z19.url));
    t19.anisotropy = 8;
    t19.minFilter = THREE.LinearMipmapLinearFilter;
    t19.magFilter = THREE.LinearFilter;
    TEX_CACHE.set('sat_hackney_z19', t19);

    const t20 = protectSharedTexture(loader.load(DEFAULT_HACKNEY_SAT_BOUNDS.z20.url));
    t20.anisotropy = 8;
    t20.minFilter = THREE.LinearMipmapLinearFilter;
    t20.magFilter = THREE.LinearFilter;
    TEX_CACHE.set('sat_hackney_z20', t20);
  }
  return {
    t19: TEX_CACHE.get('sat_hackney_z19'),
    t20: TEX_CACHE.get('sat_hackney_z20'),
  };
}

function latLonToTileFloat(lat, lon, z) {
  const n = Math.pow(2, z);
  const xt = ((lon + 180.0) / 360.0) * n;
  const latRad = (lat * Math.PI) / 180.0;
  const yt = ((1.0 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2.0) * n;
  return [xt, yt];
}

function tileFloatToLatLon(xt, yt, z) {
  const n = Math.pow(2, z);
  const lon = (xt / n) * 360.0 - 180.0;
  const latRad = Math.atan(Math.sinh(Math.PI * (1.0 - (2.0 * yt) / n)));
  return [(latRad * 180.0) / Math.PI, lon];
}

function toLocalMeters(lat0, lon0, lat, lon) {
  const y = (lat - lat0) * 110540.0;
  const x = (lon - lon0) * 111320.0 * Math.cos((lat0 * Math.PI) / 180.0);
  return [x, y];
}

function buildLiveGoogleSatelliteTexture(lat, lon, z = 19, halfGrid = 2) {
  const key = `live_sat_${lat.toFixed(4)}_${lon.toFixed(4)}_z${z}`;
  if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);

  const [cxF, cyF] = latLonToTileFloat(lat, lon, z);
  const cxI = Math.floor(cxF);
  const cyI = Math.floor(cyF);
  const grid = halfGrid * 2 + 1;
  const cv = document.createElement('canvas');
  cv.width = grid * 256;
  cv.height = grid * 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#38413a';
  g.fillRect(0, 0, cv.width, cv.height);

  const [nwLat, nwLon] = tileFloatToLatLon(cxI - halfGrid, cyI - halfGrid, z);
  const [seLat, seLon] = tileFloatToLatLon(cxI + halfGrid + 1, cyI + halfGrid + 1, z);
  const [west_m, north_m] = toLocalMeters(lat, lon, nwLat, nwLon);
  const [east_m, south_m] = toLocalMeters(lat, lon, seLat, seLon);

  const tex = protectSharedTexture(new THREE.CanvasTexture(cv));
  tex.anisotropy = 8;
  const entry = {
    tex,
    bounds: { west_m, east_m, south_m, north_m },
  };
  TEX_CACHE.set(key, entry);

  for (let dy = -halfGrid; dy <= halfGrid; dy++) {
    for (let dx = -halfGrid; dx <= halfGrid; dx++) {
      const tx = cxI + dx;
      const ty = cyI + dy;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        g.drawImage(img, (dx + halfGrid) * 256, (dy + halfGrid) * 256, 256, 256);
        tex.needsUpdate = true;
      };
      img.src = `https://mt1.google.com/vt/lyrs=s&x=${tx}&y=${ty}&z=${z}`;
    }
  }
  return entry;
}

function applySatelliteRoofUVs(roofGeo, bounds) {
  const pos = roofGeo.attributes.position;
  const uv = roofGeo.attributes.uv;
  if (!pos || !uv || !bounds) return;
  const w = (bounds.east_m - bounds.west_m) || 1;
  const h = (bounds.north_m - bounds.south_m) || 1;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = clamp01((x - bounds.west_m) / w);
    const v = clamp01((y - bounds.south_m) / h);
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

function getBuildingFacadeTexture(styleIndex = 0) {
  const key = `facade_v2_${styleIndex}`;
  if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);

  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 512;
  const g = cv.getContext('2d');

  // 4 authentic London architectural masonry palettes:
  // 0: Warm Georgian London Stock Brick
  // 1: Hackney Victorian Terracotta / Red Brick
  // 2: Civic Portland Stone / Ashlar Limestone (Hackney Town Hall style)
  // 3: Contemporary Charcoal / Buff Brick Cladding
  const palettes = [
    { wall: '#8f775d', mortar: '#6e5a45', lintel: '#cdc5b6', glassTop: '#16222f', glassBot: '#273849', mullion: '#d6d0c4' },
    { wall: '#8a4c3e', mortar: '#66352a', lintel: '#d4cdc0', glassTop: '#15202b', glassBot: '#243546', mullion: '#ded8cc' },
    { wall: '#b8b1a4', mortar: '#968f82', lintel: '#d9d3c7', glassTop: '#182432', glassBot: '#2b3e52', mullion: '#7d6e58' },
    { wall: '#6b6761', mortar: '#4f4c47', lintel: '#9e9990', glassTop: '#141e29', glassBot: '#233344', mullion: '#8f969e' },
  ];
  const pal = palettes[styleIndex % palettes.length];

  g.fillStyle = pal.wall;
  g.fillRect(0, 0, 512, 512);

  let seed = 300 + styleIndex * 97;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Fine brick/ashlar coursing across 2x2 architectural bays
  const courseRows = styleIndex === 2 ? 16 : 48;
  const ch = 512 / courseRows;
  for (let r = 0; r < courseRows; r++) {
    const y = r * ch;
    const cols = styleIndex === 2 ? 8 : 16;
    const cw = 512 / cols;
    const off = (r % 2) * (cw * 0.5);
    for (let c = -1; c <= cols; c++) {
      const x = c * cw + off;
      const dv = Math.floor((rand() - 0.5) * 14);
      g.fillStyle = dv >= 0 ? `rgba(255,248,235,${dv / 255})` : `rgba(18,14,10,${-dv / 255})`;
      g.fillRect(x + 1, y + 1, cw - 2, ch - 2);
    }
    g.fillStyle = pal.mortar;
    g.fillRect(0, Math.floor(y), 512, 1);
  }

  // Draw 2x2 architectural window bays (slender Georgian/Victorian recessed windows)
  for (let row = 0; row < 2; row++) {
    const by = row * 256;
    // Subtle string course band per floor
    g.fillStyle = pal.lintel;
    g.fillRect(0, by + 6, 512, 8);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, by + 14, 512, 3);

    for (let col = 0; col < 2; col++) {
      const bx = col * 256;
      const wx = bx + 78;
      const wy = by + 56;
      const ww = 100;
      const wh = 148;

      // Stone lintel & sill
      g.fillStyle = pal.lintel;
      g.fillRect(wx - 5, wy - 10, ww + 10, 10);
      g.fillRect(wx - 7, wy + wh, ww + 14, 8);

      // Deep recessed reveal shadow
      g.fillStyle = 'rgba(10, 14, 20, 0.72)';
      g.fillRect(wx - 3, wy - 3, ww + 6, wh + 3);

      // Smoked architectural glazing with subtle warm interior variation
      const wGrad = g.createLinearGradient(0, wy, 0, wy + wh);
      wGrad.addColorStop(0, pal.glassTop);
      wGrad.addColorStop(0.7, pal.glassBot);
      wGrad.addColorStop(1, rand() > 0.55 ? '#383228' : '#1e2c3a');
      g.fillStyle = wGrad;
      g.fillRect(wx, wy, ww, wh);

      // Soft sky sheen
      g.fillStyle = 'rgba(190, 220, 245, 0.09)';
      g.beginPath();
      g.moveTo(wx + 6, wy + 6);
      g.lineTo(wx + ww * 0.55, wy + 6);
      g.lineTo(wx + ww * 0.2, wy + wh - 6);
      g.lineTo(wx + 6, wy + wh - 6);
      g.closePath();
      g.fill();

      // Delicate window frame & sash bars (thin 2.5px lines, never cartoon grids)
      g.strokeStyle = pal.mullion;
      g.lineWidth = 2.5;
      g.strokeRect(wx + 2, wy + 2, ww - 4, wh - 4);
      g.fillStyle = pal.mullion;
      g.fillRect(wx + 2, wy + Math.floor(wh * 0.5) - 1, ww - 4, 2.5);
      g.fillRect(wx + Math.floor(ww * 0.5) - 1, wy + 2, 2, wh - 4);
    }
  }

  const tex = protectSharedTexture(new THREE.CanvasTexture(cv));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  TEX_CACHE.set(key, tex);
  return tex;
}

// ----------------------------------------------------------------------------
// Helper Geometry Builders
// ----------------------------------------------------------------------------

function applyArchitecturalUVs(extrudeGeo) {
  const pos = extrudeGeo.attributes.position;
  const norm = extrudeGeo.attributes.normal;
  const uv = extrudeGeo.attributes.uv;
  if (!pos || !norm || !uv) return;

  for (let i = 0; i < pos.count; i++) {
    const nx = norm.getX(i);
    const ny = norm.getY(i);
    const nz = norm.getZ(i);
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (Math.abs(nz) < 0.5) {
      const len = Math.hypot(nx, ny) || 1;
      const tx = -ny / len;
      const ty = nx / len;
      const s = tx * x + ty * y;
      // 1 512x512 tile = 2 bays wide (7.2m) x 2 floors tall (6.4m)
      uv.setXY(i, s / 7.2, z / 6.4);
    } else {
      uv.setXY(i, x / 6.0, y / 6.0);
    }
  }
  uv.needsUpdate = true;
}

function buildPerimeterCoping(footprint, zBottom, zTop, thickness, mat, toThree) {
  const grp = new THREE.Group();
  const h = Math.max(0.04, zTop - zBottom);
  const zMid = (zBottom + zTop) / 2;
  for (let i = 0; i < footprint.length; i++) {
    const [x0, y0] = footprint[i];
    const [x1, y1] = footprint[(i + 1) % footprint.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 0.05) continue;
    const ang = Math.atan2(dy, dx);
    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(segLen + thickness * 0.6, h, thickness),
      mat
    );
    seg.position.copy(toThree((x0 + x1) / 2, (y0 + y1) / 2, zMid));
    seg.rotation.y = ang;
    seg.castShadow = true;
    seg.receiveShadow = true;
    grp.add(seg);
  }
  return grp;
}

function buildBusStopFlagPole() {
  const grp = new THREE.Group();

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.28,
    metalness: 0.82,
  });
  const baseCollarMat = new THREE.MeshStandardMaterial({
    color: 0x22272e,
    roughness: 0.5,
    metalness: 0.6,
  });
  const redCapMat = new THREE.MeshStandardMaterial({
    color: 0xd62828,
    roughness: 0.35,
    metalness: 0.2,
  });

  // Optional shaft (hidden when scene.occluders already has a 'pole' cylinder)
  const shaftGroup = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.056, 3.1, 20), steelMat);
  post.position.y = 1.55;
  post.castShadow = true;
  post.receiveShadow = true;
  shaftGroup.add(post);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.085, 0.68, 20), baseCollarMat);
  collar.position.y = 0.34;
  collar.castShadow = true;
  collar.receiveShadow = true;
  shaftGroup.add(collar);
  grp.add(shaftGroup);
  grp.userData.shaftGroup = shaftGroup;

  // Finial cap at top of pole
  const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.08, 20), redCapMat);
  finial.position.y = 3.12;
  grp.add(finial);

  // Double-sided TfL-style Bus Stop Flag sign at z = 2.45..2.98 m
  const flagGroup = new THREE.Group();
  flagGroup.position.set(0.24, 2.72, 0);

  const flagFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.58, 0.032),
    baseCollarMat
  );
  flagFrame.castShadow = true;
  flagFrame.receiveShadow = true;
  flagGroup.add(flagFrame);

  const flagFaceMat = new THREE.MeshStandardMaterial({
    map: getBusFlagTexture('N'),
    roughness: 0.32,
    metalness: 0.08,
  });
  const faceFront = new THREE.Mesh(new THREE.PlaneGeometry(0.39, 0.55), flagFaceMat);
  faceFront.position.z = 0.018;
  flagGroup.add(faceFront);

  const faceBack = new THREE.Mesh(new THREE.PlaneGeometry(0.39, 0.55), flagFaceMat);
  faceBack.position.z = -0.018;
  faceBack.rotation.y = Math.PI;
  flagGroup.add(faceBack);
  grp.add(flagGroup);

  // Eye-level Timetable Display Case at z = 1.42 m
  const ttGroup = new THREE.Group();
  ttGroup.position.set(0, 1.42, 0.068);
  const ttFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.46, 0.035),
    baseCollarMat
  );
  ttFrame.castShadow = true;
  ttGroup.add(ttFrame);

  const ttFace = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.42),
    new THREE.MeshStandardMaterial({ map: getTimetableTexture(), roughness: 0.25 })
  );
  ttFace.position.z = 0.019;
  ttGroup.add(ttFace);
  grp.add(ttGroup);

  return grp;
}

function buildShelterSubstructure() {
  const root = new THREE.Group();

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x242a32,
    roughness: 0.36,
    metalness: 0.72,
  });
  const stainlessMat = new THREE.MeshStandardMaterial({
    color: 0xd0d7de,
    roughness: 0.25,
    metalness: 0.85,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x8d5832,
    roughness: 0.68,
    metalness: 0.05,
  });

  // 1. Shelter Structural Columns & Glazing Mullions (only shown when stop is sheltered)
  const frameColumnsGroup = new THREE.Group();
  root.add(frameColumnsGroup);
  root.userData.frameColumnsGroup = frameColumnsGroup;

  // Rear structural columns at normalized coordinates (scaled in updateEnvironmentForScene)
  const colPositions = [-1.85, 0, 1.85];
  for (const lx of colPositions) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.085, 2.42, 0.085), frameMat);
    col.position.set(lx, 1.21, -0.58);
    col.castShadow = true;
    col.receiveShadow = true;
    frameColumnsGroup.add(col);

    // Baseplate
    const bp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.18), stainlessMat);
    bp.position.set(lx, 0.015, -0.58);
    frameColumnsGroup.add(bp);

    // Cantilever roof support arm under shelter_roof
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.075, 1.32), frameMat);
    arm.position.set(lx, 2.38, 0.02);
    arm.castShadow = false; // Do not alter roof shadow
    frameColumnsGroup.add(arm);

    // Stainless spider glazing clamps on rear panel
    for (const cz of [0.45, 2.05]) {
      const clamp = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.04, 12), stainlessMat);
      clamp.rotation.x = Math.PI / 2;
      clamp.position.set(lx, cz, -0.53);
      frameColumnsGroup.add(clamp);
    }
  }

  // Rear top & bottom horizontal structural rails
  const topRail = new THREE.Mesh(new THREE.BoxGeometry(3.82, 0.065, 0.065), frameMat);
  topRail.position.set(0, 2.36, -0.58);
  frameColumnsGroup.add(topRail);

  const botRail = new THREE.Mesh(new THREE.BoxGeometry(3.82, 0.05, 0.05), frameMat);
  botRail.position.set(0, 0.16, -0.58);
  frameColumnsGroup.add(botRail);

  // West end-panel route map / timetable display frame (open-sided glass frame so it doesn't add shade)
  const endMullion = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.4, 0.06), frameMat);
  endMullion.position.set(-1.85, 1.2, 0.45);
  frameColumnsGroup.add(endMullion);

  // 2. Cantilevered Wooden-Slat & Stainless Waiting Bench (2.0m wide at z = 0.45m)
  const benchGroup = new THREE.Group();
  root.add(benchGroup);
  root.userData.benchGroup = benchGroup;

  // 4 hardwood timber slats
  for (let s = 0; s < 4; s++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.036, 0.075), woodMat);
    slat.position.set(0, 0.45 + (s === 0 ? -0.01 : 0), -0.42 + s * 0.09);
    slat.castShadow = true;
    slat.receiveShadow = true;
    benchGroup.add(slat);
  }

  // Stainless steel support brackets & armrests
  for (const bx of [-0.78, 0, 0.78]) {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.06, 0.42), stainlessMat);
    bracket.position.set(bx, 0.41, -0.28);
    bracket.castShadow = true;
    benchGroup.add(bracket);

    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.42, 12), frameMat);
    leg.position.set(bx, 0.21, -0.44);
    leg.castShadow = true;
    benchGroup.add(leg);
  }

  for (const ax of [-0.96, 0.96]) {
    const arm = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.016, 10, 20, Math.PI), stainlessMat);
    arm.rotation.y = Math.PI / 2;
    arm.position.set(ax, 0.46, -0.26);
    benchGroup.add(arm);
  }

  return root;
}

function buildArchitecturalPassenger(heightM = 1.72, colorHex = 0xeae5dc) {
  const fig = new THREE.Group();
  const s = heightM / 1.72;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.74,
    metalness: 0.06,
  });
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x2b323c,
    roughness: 0.5,
    metalness: 0.4,
  });

  // Subtle architectural plinth disc at feet
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.02, 24), baseMat);
  plinth.position.y = 0.01;
  plinth.receiveShadow = true;
  fig.add(plinth);

  // Legs (0.02 -> 0.84m)
  for (const lx of [-0.075, 0.075]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.062 * s, 0.048 * s, 0.82 * s, 14), bodyMat);
    leg.position.set(lx * s, 0.43 * s, 0);
    leg.castShadow = true;
    leg.receiveShadow = true;
    fig.add(leg);
  }

  // Pelvis & Torso (0.80 -> 1.41m)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.155 * s, 0.115 * s, 0.62 * s, 18), bodyMat);
  torso.scale.set(1.15, 1, 0.72);
  torso.position.set(0, 1.11 * s, 0);
  torso.castShadow = true;
  torso.receiveShadow = true;
  fig.add(torso);

  // Shoulders
  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.175 * s, 18, 12), bodyMat);
  shoulders.scale.set(1.22, 0.42, 0.68);
  shoulders.position.set(0, 1.39 * s, 0);
  shoulders.castShadow = true;
  shoulders.receiveShadow = true;
  fig.add(shoulders);

  // Relaxed arms at sides
  for (const ax of [-0.185, 0.185]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.044 * s, 0.036 * s, 0.54 * s, 12), bodyMat);
    arm.position.set(ax * s, 1.12 * s, 0.01);
    arm.rotation.z = ax < 0 ? 0.06 : -0.06;
    arm.castShadow = true;
    arm.receiveShadow = true;
    fig.add(arm);
  }

  // Neck & Sculpted Architectural Head (1.44 -> 1.72m)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.048 * s, 0.054 * s, 0.08 * s, 12), bodyMat);
  neck.position.set(0, 1.46 * s, 0);
  fig.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.108 * s, 20, 16), bodyMat);
  head.scale.set(0.92, 1.14, 0.98);
  head.position.set(0, 1.595 * s, 0);
  head.castShadow = true;
  head.receiveShadow = true;
  fig.add(head);

  // Subtle Cyan Verification Datum Ring at exact z = 1.20 m (engine.py SAMPLE_HEIGHT_M)
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.85,
  });
  const sampleRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.011, 10, 32), ringMat);
  sampleRing.rotation.x = Math.PI / 2;
  sampleRing.position.y = 1.20; // exact 1.20 m verification sampling plane
  fig.add(sampleRing);

  return fig;
}

function buildHeritageBollard() {
  const g = new THREE.Group();
  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x1b2028,
    roughness: 0.45,
    metalness: 0.72,
  });
  const bandMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.25,
    emissive: 0x222830,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xeab308,
    roughness: 0.3,
    metalness: 0.8,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.12, 0.26, 12), ironMat);
  base.position.y = 0.13;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.56, 12), ironMat);
  shaft.position.y = 0.54;
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  g.add(shaft);

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.082, 0.09, 16), bandMat);
  band.position.y = 0.70;
  g.add(band);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.082, 14, 12), goldMat);
  cap.position.y = 0.85;
  cap.castShadow = true;
  g.add(cap);

  return g;
}

// ============================================================================
// 1. createEnvironment(scene3, toThree)
// ============================================================================

export function createEnvironment(scene3, toThree) {
  // Hide any legacy flat grey planes already in scene3 so they don't z-fight
  if (scene3 && Array.isArray(scene3.children)) {
    for (const ch of scene3.children) {
      if (ch.isMesh && ch.geometry?.type === 'PlaneGeometry') {
        const p = ch.geometry.parameters;
        if (p && p.width === 400) ch.visible = false;
      }
    }
  }

  const envGroup = new THREE.Group();
  envGroup.name = 'ShadowStopEnvironment';
  if (scene3) scene3.add(envGroup);

  // --------------------------------------------------------------------------
  // A. Procedural Sky Dome & Atmosphere Shader
  // --------------------------------------------------------------------------
  const skyUniforms = {
    uSunDir: { value: new THREE.Vector3(0.35, 0.65, 0.55).normalize() },
    uZenithColor: { value: new THREE.Color(0x2663ad) },
    uHorizonColor: { value: new THREE.Color(0xf0e8da) },
    uGroundColor: { value: new THREE.Color(0x1b222c) },
    uSunGlowColor: { value: new THREE.Color(0xffe39e) },
    uSunEl: { value: 42.0 },
  };

  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldDir;
      uniform vec3 uSunDir;
      uniform vec3 uZenithColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uGroundColor;
      uniform vec3 uSunGlowColor;
      uniform float uSunEl;

      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = dir.y;

        // Sky dome above horizon vs ground hemisphere below horizon
        float skyT = pow( clamp(h, 0.0, 1.0), 0.52 );
        vec3 skyCol = mix(uHorizonColor, uZenithColor, skyT);

        // Subtle atmospheric horizon haze band
        float haze = exp(-abs(h) * 7.5);
        skyCol = mix(skyCol, uHorizonColor, haze * 0.45);

        // Solar aureole & warm forward scatter when sun is up
        if (uSunEl > -2.0) {
          float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
          float mieWide = pow(sunDot, 6.0) * 0.24;
          float mieCore = pow(sunDot, 48.0) * 0.38;
          float vis = clamp((uSunEl + 2.0) / 14.0, 0.0, 1.0);
          skyCol += uSunGlowColor * (mieWide + mieCore) * vis;
        }

        // Below horizon smooth transition
        if (h < 0.0) {
          float gT = clamp(-h * 4.5, 0.0, 1.0);
          skyCol = mix(uHorizonColor, uGroundColor, gT);
        }

        gl_FragColor = vec4(skyCol, 1.0);
      }
    `,
  });

  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), skyMat);
  skyMesh.name = 'SkyDome';
  skyMesh.renderOrder = -10;
  envGroup.add(skyMesh);

  // --------------------------------------------------------------------------
  // B. Google Earth Satellite Terrain (z=19 City Block + z=20 Ultra-Sharp Inner Patch)
  // --------------------------------------------------------------------------
  const { t19, t20 } = getPrebakedHackneySatTextures();
  const b19 = DEFAULT_HACKNEY_SAT_BOUNDS.z19;
  const b20 = DEFAULT_HACKNEY_SAT_BOUNDS.z20;

  // Far backdrop ground beyond 330m so horizon never shows a gap
  const horizonGround = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({
      color: 0x3b423e,
      roughness: 0.96,
      metalness: 0.02,
    })
  );
  horizonGround.rotation.x = -Math.PI / 2;
  horizonGround.position.y = -0.18;
  horizonGround.receiveShadow = true;
  envGroup.add(horizonGround);

  // Outer z=19 Google Earth Satellite Terrain (~333m x 330m)
  const baseGround = new THREE.Mesh(
    new THREE.PlaneGeometry(b19.east_m - b19.west_m, b19.north_m - b19.south_m),
    new THREE.MeshStandardMaterial({
      map: t19,
      roughness: 0.92,
      metalness: 0.04,
    })
  );
  baseGround.rotation.x = -Math.PI / 2;
  baseGround.position.set((b19.west_m + b19.east_m) / 2, -0.06, -(b19.south_m + b19.north_m) / 2);
  baseGround.receiveShadow = true;
  envGroup.add(baseGround);

  // Inner z=20 Ultra-High-Res Google Earth Satellite Terrain (~166m x 165m at 9cm/px!)
  const innerSatGround = new THREE.Mesh(
    new THREE.PlaneGeometry(b20.east_m - b20.west_m, b20.north_m - b20.south_m),
    new THREE.MeshStandardMaterial({
      map: t20,
      roughness: 0.90,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    })
  );
  innerSatGround.rotation.x = -Math.PI / 2;
  innerSatGround.position.set((b20.west_m + b20.east_m) / 2, -0.025, -(b20.south_m + b20.north_m) / 2);
  innerSatGround.receiveShadow = true;
  envGroup.add(innerSatGround);

  // Crisp ShadowCatcher plane over the Google Earth satellite terrain so directional sun shadows pop cleanly
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 180),
    new THREE.ShadowMaterial({ opacity: 0.36 })
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.set(0, -0.012, 0);
  shadowCatcher.receiveShadow = true;
  envGroup.add(shadowCatcher);

  activeSatelliteState = {
    z19Tex: t19,
    z19Bounds: b19,
    z20Tex: t20,
    z20Bounds: b20,
  };

  // Corridor group rotates and centers with the stop's road bearing & waiting area
  const corridorGroup = new THREE.Group();
  corridorGroup.name = 'StreetCorridorGroup';
  envGroup.add(corridorGroup);

  const roadSubGroup = new THREE.Group();
  corridorGroup.add(roadSubGroup);

  // Localized Architectural Stop Detail Pad (blends into the real Google Earth street underneath)
  const padLen = 9.6;

  // 1. Painted Red Tarmac BUS STOP Cage Bay (9.6m x 2.5m, blended with real satellite road)
  const busBayMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(9.6, 2.5),
    new THREE.MeshStandardMaterial({
      map: getBusBayTexture(),
      roughness: 0.80,
      metalness: 0.05,
      transparent: true,
      opacity: 0.72,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
  );
  busBayMesh.rotation.x = -Math.PI / 2;
  busBayMesh.position.set(0, -0.008, 1.42);
  busBayMesh.receiveShadow = true;
  busBayMesh.visible = false; // Real Google Earth satellite photo already displays Mare St "BUS STOP" road markings
  roadSubGroup.add(busBayMesh);

  // 2. Raised Granite Kerbstone Edge along the stop boarding zone (9.6m long, 0.11m high)
  const kerbMat = new THREE.MeshStandardMaterial({
    map: getGraniteKerbTexture(),
    roughness: 0.65,
    metalness: 0.1,
  });
  const northKerb = new THREE.Mesh(new THREE.BoxGeometry(padLen, 0.11, 0.20), kerbMat);
  northKerb.position.set(0, 0.018, 0.0);
  northKerb.castShadow = true;
  northKerb.receiveShadow = true;
  roadSubGroup.add(northKerb);

  // 3. Compact Yorkstone Boarding Plinth directly under the shelter
  const slabMat = new THREE.MeshStandardMaterial({
    map: getPavementSlabTexture(),
    roughness: 0.84,
    metalness: 0.04,
    transparent: true,
    opacity: 0.45,
  });
  const stopPavement = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.4), slabMat);
  stopPavement.rotation.x = -Math.PI / 2;
  stopPavement.position.set(0, 0.005, -1.25);
  stopPavement.receiveShadow = true;
  stopPavement.visible = false; // Let real Google Earth Town Hall Square & Mare St sidewalk show directly underneath
  roadSubGroup.add(stopPavement);

  // 4. Buff/Red Blister Tactile Paving Strip along the boarding edge
  const tactileMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 0.55),
    new THREE.MeshStandardMaterial({
      map: getTactilePavingTexture(),
      roughness: 0.72,
      metalness: 0.05,
    })
  );
  tactileMesh.rotation.x = -Math.PI / 2;
  tactileMesh.position.set(0, 0.012, -0.42);
  tactileMesh.receiveShadow = true;
  roadSubGroup.add(tactileMesh);

  // 5. Iconic 3D London Red Double-Decker Bus (Routemaster / Enviro400) departing along Mare Street bus lane
  const londonBus = buildLondonDoubleDeckerBus();
  londonBus.position.set(11.5, -0.01, 2.75);
  roadSubGroup.add(londonBus);

  // --------------------------------------------------------------------------
  // C. Street Furniture & Human Scale Reference Group
  // --------------------------------------------------------------------------
  const streetFurnitureGroup = new THREE.Group();
  streetFurnitureGroup.name = 'StreetFurnitureGroup';
  envGroup.add(streetFurnitureGroup);

  // 1. Iconic London Bus Stop Flag & Pole
  const flagPoleGroup = buildBusStopFlagPole();
  streetFurnitureGroup.add(flagPoleGroup);

  // 2. Existing Shelter Frame & Waiting Bench
  const shelterSubstructure = buildShelterSubstructure();
  streetFurnitureGroup.add(shelterSubstructure);

  // 3. Human Scale Silhouette (2 waiting passengers with z=1.20m cyan rings)
  const passengerGroup = new THREE.Group();
  passengerGroup.name = 'PassengerScaleGroup';
  const pax1 = buildArchitecturalPassenger(1.72, 0xede8df);
  pax1.position.set(-0.75, 0.01, -0.15);
  pax1.rotation.y = 0.18;
  passengerGroup.add(pax1);

  const pax2 = buildArchitecturalPassenger(1.65, 0xc2bcb2);
  pax2.position.set(0.85, 0.01, 0.12);
  pax2.rotation.y = -0.22;
  passengerGroup.add(pax2);
  streetFurnitureGroup.add(passengerGroup);

  // 4. Heritage Cast-Iron Bollards near the kerb edge
  const bollardsGroup = new THREE.Group();
  const bolWest = buildHeritageBollard();
  bolWest.position.set(-4.6, 0.01, -0.28);
  const bolEast = buildHeritageBollard();
  bolEast.position.set(4.8, 0.01, -0.28);
  bollardsGroup.add(bolWest, bolEast);
  roadSubGroup.add(bollardsGroup);

  // --------------------------------------------------------------------------
  // Atmosphere Update Function
  // --------------------------------------------------------------------------
  function updateAtmosphere(sunElDeg = 40, sunAzDeg = 180) {
    const el = Number(sunElDeg) || 0;
    const az = Number(sunAzDeg) || 180;
    const aRad = (az * Math.PI) / 180;
    const eRad = (el * Math.PI) / 180;
    const sx = Math.sin(aRad) * Math.cos(eRad);
    const sy = Math.cos(aRad) * Math.cos(eRad);
    const sz = Math.sin(eRad);

    skyUniforms.uSunDir.value.set(sx, sz, -sy).normalize();
    skyUniforms.uSunEl.value = el;

    if (el <= 0) {
      skyUniforms.uZenithColor.value.setHex(0x0d1828);
      skyUniforms.uHorizonColor.value.setHex(0x1f2d40);
      skyUniforms.uSunGlowColor.value.setHex(0xff9e5e);
    } else if (el < 18) {
      const t = clamp01(el / 18);
      skyUniforms.uZenithColor.value.setHex(0x1b3f78).lerp(new THREE.Color(0x24579c), t);
      skyUniforms.uHorizonColor.value.setHex(0xf2be8d).lerp(new THREE.Color(0xf4dec0), t);
      skyUniforms.uSunGlowColor.value.setHex(0xffb86c);
    } else {
      const t = clamp01((el - 18) / 42);
      skyUniforms.uZenithColor.value.setHex(0x24579c).lerp(new THREE.Color(0x2868b5), t);
      skyUniforms.uHorizonColor.value.setHex(0xf4dec0).lerp(new THREE.Color(0xf0e9dc), t);
      skyUniforms.uSunGlowColor.value.setHex(0xffe49e);
    }

    if (scene3?.fog) {
      scene3.fog.color.copy(skyUniforms.uHorizonColor.value).lerp(new THREE.Color(0x8fa3ba), 0.35);
      if (scene3.fog.near < 150) scene3.fog.near = 165;
      if (scene3.fog.far < 340) scene3.fog.far = 380;
    }
  }

  updateAtmosphere(42, 210);

  return {
    envGroup,
    skyMesh,
    baseGround,
    innerSatGround,
    corridorGroup,
    roadSubGroup,
    streetFurnitureGroup,
    flagPoleGroup,
    shelterSubstructure,
    passengerGroup,
    londonBus,
    updateAtmosphere,
  };
}

function buildLondonDoubleDeckerBus() {
  const bus = new THREE.Group();
  bus.name = 'LondonDoubleDeckerBus';

  const redPaint = new THREE.MeshStandardMaterial({
    color: 0xd61f1f,
    roughness: 0.28,
    metalness: 0.22,
  });
  const darkGlass = new THREE.MeshStandardMaterial({
    color: 0x121c28,
    roughness: 0.14,
    metalness: 0.65,
  });
  const trimBlack = new THREE.MeshStandardMaterial({
    color: 0x1a1e24,
    roughness: 0.55,
    metalness: 0.35,
  });
  const roofWhite = new THREE.MeshStandardMaterial({
    color: 0xf1ede6,
    roughness: 0.4,
    metalness: 0.12,
  });
  const tyreMat = new THREE.MeshStandardMaterial({
    color: 0x181a1d,
    roughness: 0.85,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.3,
    metalness: 0.8,
  });
  const blindMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });

  const L = 10.6;
  const W = 2.52;
  const H = 4.36;

  // Lower deck main body (0.32m -> 2.35m)
  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(L, 2.02, W), redPaint);
  lowerBody.position.set(0, 1.33, 0);
  lowerBody.castShadow = true;
  lowerBody.receiveShadow = true;
  bus.add(lowerBody);

  // Lower deck panoramic window band (0.95m -> 2.15m)
  const lowerGlass = new THREE.Mesh(new THREE.BoxGeometry(L - 0.5, 1.16, W + 0.02), darkGlass);
  lowerGlass.position.set(0.05, 1.56, 0);
  bus.add(lowerGlass);

  // Upper deck body (2.35m -> 4.24m)
  const upperBody = new THREE.Mesh(new THREE.BoxGeometry(L - 0.18, 1.88, W - 0.04), redPaint);
  upperBody.position.set(0, 3.28, 0);
  upperBody.castShadow = true;
  upperBody.receiveShadow = true;
  bus.add(upperBody);

  // Upper deck panoramic window band (2.68m -> 3.88m)
  const upperGlass = new THREE.Mesh(new THREE.BoxGeometry(L - 0.48, 1.14, W - 0.01), darkGlass);
  upperGlass.position.set(0, 3.30, 0);
  bus.add(upperGlass);

  // Front & upper windscreens
  const frontGlassLower = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, W - 0.22), darkGlass);
  frontGlassLower.position.set(L / 2 - 0.02, 1.56, 0);
  bus.add(frontGlassLower);

  const frontGlassUpper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.16, W - 0.24), darkGlass);
  frontGlassUpper.position.set((L - 0.18) / 2 - 0.02, 3.30, 0);
  bus.add(frontGlassUpper);

  // White thermal roof cap + hybrid battery cooling pod
  const roofCap = new THREE.Mesh(new THREE.BoxGeometry(L - 0.45, 0.14, W - 0.22), roofWhite);
  roofCap.position.set(0, H - 0.06, 0);
  roofCap.castShadow = true;
  bus.add(roofCap);

  // Illuminated Route 38 Destination Blind (front & kerbside)
  const frontBlind = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.30, 1.45), blindMat);
  frontBlind.position.set(L / 2 + 0.01, 2.38, 0);
  bus.add(frontBlind);

  const sideBlind = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.26, 0.04), blindMat);
  sideBlind.position.set(L * 0.26, 2.36, -W / 2 - 0.01);
  bus.add(sideBlind);

  // Front bumper, headlights & rear tail lights
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.36, W + 0.04), trimBlack);
  bumper.position.set(L / 2 - 0.04, 0.48, 0);
  bus.add(bumper);

  for (const hz of [-W * 0.36, W * 0.36]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.26), headlightMat);
    hl.position.set(L / 2 + 0.02, 0.68, hz);
    bus.add(hl);

    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.20), taillightMat);
    tl.position.set(-L / 2 - 0.01, 0.78, hz);
    bus.add(tl);
  }

  // 3 Axles (front steering, mid, rear drive) with dual tyres & silver wheel rims
  for (const ax of [-3.35, -1.55, 3.25]) {
    for (const side of [-1, 1]) {
      const wz = side * (W / 2 - 0.12);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.32, 20), tyreMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(ax, 0.48, wz);
      wheel.castShadow = true;
      bus.add(wheel);

      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.34, 16), rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(ax, 0.48, wz);
      bus.add(rim);
    }
  }

  return bus;
}

// ============================================================================
// 2. updateEnvironmentForScene(envState, scene, toThree)
// ============================================================================

export function updateEnvironmentForScene(envState, scene, toThree) {
  if (!envState || !scene) return;
  const mapToThree = toThree || ((x, y, z) => new THREE.Vector3(x, z, -y));

  // Hide any legacy flat grey planes in scene3 if present
  const rootScene = envState.envGroup?.parent;
  if (rootScene && Array.isArray(rootScene.children)) {
    for (const ch of rootScene.children) {
      if (ch.isMesh && ch.geometry?.type === 'PlaneGeometry') {
        const p = ch.geometry.parameters;
        if (p && p.width === 400) ch.visible = false;
      }
    }
  }

  // Update Google Earth Satellite Terrain for this scene's (lat, lon)
  const sLat = Number(scene.lat) || 51.5452115;
  const sLon = Number(scene.lon) || -0.0554389;
  const isHackneyHero = Math.hypot(sLat - 51.5452115, sLon - (-0.0554389)) < 0.0004;

  if (isHackneyHero) {
    const { t19, t20 } = getPrebakedHackneySatTextures();
    const b19 = scene.satellite_bounds?.z19 || DEFAULT_HACKNEY_SAT_BOUNDS.z19;
    const b20 = scene.satellite_bounds?.z20 || DEFAULT_HACKNEY_SAT_BOUNDS.z20;
    activeSatelliteState = { z19Tex: t19, z19Bounds: b19, z20Tex: t20, z20Bounds: b20 };

    if (envState.baseGround) {
      envState.baseGround.geometry.dispose();
      envState.baseGround.geometry = new THREE.PlaneGeometry(b19.east_m - b19.west_m, b19.north_m - b19.south_m);
      envState.baseGround.material.map = t19;
      envState.baseGround.material.needsUpdate = true;
      envState.baseGround.position.set((b19.west_m + b19.east_m) / 2, -0.06, -(b19.south_m + b19.north_m) / 2);
      envState.baseGround.visible = true;
    }
    if (envState.innerSatGround) {
      envState.innerSatGround.geometry.dispose();
      envState.innerSatGround.geometry = new THREE.PlaneGeometry(b20.east_m - b20.west_m, b20.north_m - b20.south_m);
      envState.innerSatGround.material.map = t20;
      envState.innerSatGround.material.needsUpdate = true;
      envState.innerSatGround.position.set((b20.west_m + b20.east_m) / 2, -0.025, -(b20.south_m + b20.north_m) / 2);
      envState.innerSatGround.visible = true;
    }
  } else {
    const live19 = buildLiveGoogleSatelliteTexture(sLat, sLon, 19, 2);
    const live20 = buildLiveGoogleSatelliteTexture(sLat, sLon, 20, 2);
    const b19 = live19.bounds;
    const b20 = live20.bounds;
    activeSatelliteState = { z19Tex: live19.tex, z19Bounds: b19, z20Tex: live20.tex, z20Bounds: b20 };

    if (envState.baseGround) {
      envState.baseGround.geometry.dispose();
      envState.baseGround.geometry = new THREE.PlaneGeometry(b19.east_m - b19.west_m, b19.north_m - b19.south_m);
      envState.baseGround.material.map = live19.tex;
      envState.baseGround.material.needsUpdate = true;
      envState.baseGround.position.set((b19.west_m + b19.east_m) / 2, -0.06, -(b19.south_m + b19.north_m) / 2);
      envState.baseGround.visible = true;
    }
    if (envState.innerSatGround) {
      envState.innerSatGround.geometry.dispose();
      envState.innerSatGround.geometry = new THREE.PlaneGeometry(b20.east_m - b20.west_m, b20.north_m - b20.south_m);
      envState.innerSatGround.material.map = live20.tex;
      envState.innerSatGround.material.needsUpdate = true;
      envState.innerSatGround.position.set((b20.west_m + b20.east_m) / 2, -0.025, -(b20.south_m + b20.north_m) / 2);
      envState.innerSatGround.visible = true;
    }
  }

  const occluders = scene.occluders || [];
  const wa = scene.waiting_area && scene.waiting_area.length >= 3
    ? scene.waiting_area
    : [[-3, -1.1], [3, -1.1], [3, 1.1], [-3, 1.1]];

  // Compute waiting area centroid
  let waCx = 0, waCy = 0;
  for (const [x, y] of wa) {
    waCx += x;
    waCy += y;
  }
  waCx /= wa.length;
  waCy /= wa.length;

  let bearingDeg = Number(scene.road_bearing_deg) || 0;
  const bRad = (bearingDeg * Math.PI) / 180;
  const tx = Math.cos(bRad), ty = Math.sin(bRad);
  const nx = -Math.sin(bRad), ny = Math.cos(bRad);

  // Check if buildings or back-panel indicate which side of the waiting area is the building vs road
  // Default: +N is back-of-pavement (buildings), -N is kerb/road
  let minPosN = Infinity;
  let minNegN = Infinity;
  for (const o of occluders) {
    if (o.kind === 'building' && Array.isArray(o.footprint)) {
      for (const [bx, by] of o.footprint) {
        const relX = bx - waCx;
        const relY = by - waCy;
        const t = relX * tx + relY * ty;
        const n = relX * nx + relY * ny;
        if (Math.abs(t) < 16) {
          if (n > 0.5) minPosN = Math.min(minPosN, n);
          if (n < -0.5) minNegN = Math.min(minNegN, -n);
        }
      }
    }
  }
  // If a building sits immediately on the -N side (< 6.5m) while +N is much clearer, flip bearing 180 deg
  if (minNegN < 6.5 && minPosN > minNegN + 3.5) {
    bearingDeg = (bearingDeg + 180) % 360;
  }

  const finalRad = (bearingDeg * Math.PI) / 180;
  const fTx = Math.cos(finalRad), fTy = Math.sin(finalRad);
  const fNx = -Math.sin(finalRad), fNy = Math.cos(finalRad);

  // Measure waiting area half-width & half-depth in aligned frame
  let maxT = 2.5, maxN = 1.1;
  for (const [x, y] of wa) {
    const dx = x - waCx;
    const dy = y - waCy;
    maxT = Math.max(maxT, Math.abs(dx * fTx + dy * fTy));
    maxN = Math.max(maxN, Math.abs(dx * fNx + dy * fNy));
  }

  // Position and rotate the street corridor at waiting area centroid
  const { corridorGroup, roadSubGroup, flagPoleGroup, shelterSubstructure, passengerGroup } = envState;
  if (corridorGroup) {
    corridorGroup.position.copy(mapToThree(waCx, waCy, 0));
    corridorGroup.rotation.y = THREE.MathUtils.degToRad(bearingDeg);
  }
  // Place kerb edge just outside the front edge of the waiting area (+z in Three.js local space)
  const kerbOffsetZ = maxN + 0.25;
  if (roadSubGroup) {
    roadSubGroup.position.set(0, 0, kerbOffsetZ);
  }

  // 1. Align Iconic London Bus Stop Flag & Pole with existing 'pole' occluder or front-east corner
  const poleOcc = occluders.find(
    (o) => o.id === 'pole' || (o.shape === 'cylinder' && (o.radius ?? 1) <= 0.15)
  );
  if (flagPoleGroup) {
    if (poleOcc && Array.isArray(poleOcc.center)) {
      flagPoleGroup.position.copy(mapToThree(poleOcc.center[0], poleOcc.center[1], poleOcc.z0 || 0));
      flagPoleGroup.rotation.y = THREE.MathUtils.degToRad(bearingDeg);
      if (flagPoleGroup.userData.shaftGroup) {
        // buildDetailedOccluder renders the cylinder shaft for poleOcc; avoid duplicate cylinder
        flagPoleGroup.userData.shaftGroup.visible = false;
      }
    } else {
      // Place at front-east corner of waiting area near the kerb
      const px = waCx + (maxT - 0.25) * fTx - (maxN + 0.05) * fNx;
      const py = waCy + (maxT - 0.25) * fTy - (maxN + 0.05) * fNy;
      flagPoleGroup.position.copy(mapToThree(px, py, 0));
      flagPoleGroup.rotation.y = THREE.MathUtils.degToRad(bearingDeg);
      if (flagPoleGroup.userData.shaftGroup) {
        flagPoleGroup.userData.shaftGroup.visible = true;
      }
    }
  }

  // 2. Align Shelter Frame & Bench with 'shelter_roof' occluder (or hide shelter frame if unsheltered)
  const roofOcc = occluders.find((o) => o.kind === 'shelter_roof');
  const hasShelter = Boolean(roofOcc || scene.osm_shelter === 'yes');
  if (shelterSubstructure) {
    const frameCols = shelterSubstructure.userData.frameColumnsGroup;
    if (roofOcc && Array.isArray(roofOcc.center)) {
      const [rcx, rcy] = roofOcc.center;
      const [rsx, rsy] = roofOcc.size || [4, 1.4];
      const rRot = roofOcc.rotation_deg ?? bearingDeg;
      const rz0 = roofOcc.z0 ?? 2.4;
      shelterSubstructure.position.copy(mapToThree(rcx, rcy, 0));
      shelterSubstructure.rotation.y = THREE.MathUtils.degToRad(rRot);
      if (frameCols) {
        frameCols.visible = true;
        frameCols.scale.set(rsx / 4.0, rz0 / 2.42, rsy / 1.4);
      }
    } else {
      shelterSubstructure.position.copy(mapToThree(waCx, waCy, 0));
      shelterSubstructure.rotation.y = THREE.MathUtils.degToRad(bearingDeg);
      if (frameCols) {
        // Section 5 Phase 2 rule: Do NOT add a shelter frame if the stop is unsheltered
        frameCols.visible = hasShelter;
        frameCols.scale.set(1, 1, 1);
      }
    }
  }

  // 3. Position Waiting Passengers inside the waiting area
  if (passengerGroup) {
    const baseCenter = roofOcc && Array.isArray(roofOcc.center) ? roofOcc.center : [waCx, waCy];
    const baseRot = roofOcc?.rotation_deg ?? bearingDeg;
    passengerGroup.position.copy(mapToThree(baseCenter[0], baseCenter[1], 0));
    passengerGroup.rotation.y = THREE.MathUtils.degToRad(baseRot);
  }
}

// ============================================================================
// 3. buildDetailedOccluder(o, isProposal, toThree, options = {})
// ============================================================================

function buildTreeOccluder(o, isProposal, mapToThree) {
  const grp = new THREE.Group();
  grp.userData.occ = o;

  const [cx, cy] = o.center || [0, 0];
  const r = Math.max(0.8, o.radius ?? 2.5);
  const z0 = o.z0 ?? 2.5;
  const z1 = o.z1 ?? 7.5;
  const cz = (z0 + z1) / 2;
  const rz = Math.max(0.8, (z1 - z0) / 2);
  const cast = (o.opacity ?? 1) >= 0.3;

  const root = new THREE.Group();
  root.position.copy(mapToThree(cx, cy, 0));
  grp.add(root);

  const postsGroup = new THREE.Group();
  const frameGroup = new THREE.Group();
  const louversGroup = new THREE.Group();
  louversGroup.position.y = cz;
  root.add(postsGroup, frameGroup, louversGroup);

  // Dark cast-iron tree pit grille on the pavement at z = 0.015
  const grateMat = new THREE.MeshStandardMaterial({
    color: 0x22272e,
    roughness: 0.65,
    metalness: 0.7,
  });
  const grate = new THREE.Mesh(new THREE.BoxGeometry(Math.min(1.5, r * 0.65), 0.02, Math.min(1.5, r * 0.65)), grateMat);
  grate.position.y = 0.015;
  grate.receiveShadow = true;
  frameGroup.add(grate);

  if (isProposal) {
    // Golden verification accent ring + timber tree guard stakes for proposed street tree
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.68, 0.76, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    frameGroup.add(ring);

    const stakeMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.3, 8), stakeMat);
      stake.position.set(Math.cos(a) * 0.32, 0.65, Math.sin(a) * 0.32);
      stake.castShadow = true;
      postsGroup.add(stake);
    }
  }

  // Tapered organic bark trunk & primary branches
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x5c4028,
    roughness: 0.92,
  });
  const trunkH = Math.max(1.2, cz - rz * 0.25);
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(Math.max(0.11, r * 0.065), Math.max(0.18, r * 0.11), trunkH, 12),
    trunkMat
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = cast;
  trunk.receiveShadow = true;
  postsGroup.add(trunk);

  // 3 primary fork branches reaching into the crown
  for (let b = 0; b < 3; b++) {
    const ba = (b * Math.PI * 2) / 3 + 0.4;
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.095, rz * 0.9, 8), trunkMat);
    branch.position.set(Math.cos(ba) * r * 0.18, trunkH + rz * 0.15, Math.sin(ba) * r * 0.18);
    branch.rotation.z = -Math.cos(ba) * 0.42;
    branch.rotation.x = Math.sin(ba) * 0.42;
    branch.castShadow = cast;
    postsGroup.add(branch);
  }

  // Multi-cluster organic foliage crown filling the ellipsoid (radius horizontal, z0..z1 vertical)
  const palette = isProposal
    ? [0x6fd14b, 0x82de59, 0x58b838]
    : [0x388e44, 0x459e52, 0x2e7b39];

  const clusterOffsets = [
    [0, 0, 0, 0.78],
    [0.36, 0.12, 0.22, 0.56],
    [-0.38, 0.08, 0.20, 0.58],
    [0.18, 0.15, -0.38, 0.55],
    [-0.22, -0.08, -0.34, 0.54],
    [0.42, -0.14, -0.12, 0.50],
    [-0.35, -0.16, 0.28, 0.48],
    [0.0, 0.34, 0.05, 0.52],
  ];

  const louverBlades = [];
  clusterOffsets.forEach(([ox, oy, oz, sc], idx) => {
    const leafMat = new THREE.MeshStandardMaterial({
      color: palette[idx % palette.length],
      roughness: 0.86,
      flatShading: true,
      emissive: isProposal ? 0x132905 : 0x000000,
    });
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 2), leafMat);
    puff.scale.set(r * sc, rz * sc, r * sc);
    puff.position.set(ox * r, oy * rz, oz * r);
    puff.rotation.set(idx * 0.7, idx * 1.1, 0);
    puff.castShadow = cast;
    puff.receiveShadow = true;
    puff.userData.baseY = oy * rz;
    puff.userData.baseRotX = puff.rotation.x;
    puff.userData.targetScale = new THREE.Vector3(r * sc, rz * sc, r * sc);
    louversGroup.add(puff);
    louverBlades.push(puff);
  });

  grp.userData.isCanopyAssembly = true;
  grp.userData.parts = {
    postsGroup,
    frameGroup,
    louversGroup,
    louverBlades,
    baseZ0: z0,
    baseZ1: z1,
  };
  return grp;
}

function extractBoxFromOccluder(o) {
  if (o.shape === 'box' || !Array.isArray(o.footprint) || o.footprint.length < 3) {
    return {
      cx: o.center?.[0] ?? 0,
      cy: o.center?.[1] ?? 0,
      sx: o.size?.[0] ?? 4,
      sy: o.size?.[1] ?? 2,
      rotDeg: o.rotation_deg ?? 0,
    };
  }
  // Prism footprint -> compute oriented bounding box aligned with longest edge
  const fp = o.footprint;
  let cx = 0, cy = 0;
  for (const [x, y] of fp) {
    cx += x;
    cy += y;
  }
  cx /= fp.length;
  cy /= fp.length;

  let bestLen = 0, bestAng = 0;
  for (let i = 0; i < fp.length; i++) {
    const [x0, y0] = fp[i];
    const [x1, y1] = fp[(i + 1) % fp.length];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len > bestLen) {
      bestLen = len;
      bestAng = Math.atan2(y1 - y0, x1 - x0);
    }
  }
  const ca = Math.cos(bestAng), sa = Math.sin(bestAng);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [x, y] of fp) {
    const dx = x - cx, dy = y - cy;
    const u = dx * ca + dy * sa;
    const v = -dx * sa + dy * ca;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return {
    cx,
    cy,
    sx: Math.max(0.8, maxU - minU),
    sy: Math.max(0.8, maxV - minV),
    rotDeg: (bestAng * 180) / Math.PI,
  };
}

function buildHeroCanopyAssembly(o, mapToThree) {
  const grp = new THREE.Group();
  grp.userData.occ = o;
  grp.userData.isCanopyAssembly = true;

  const { cx, cy, sx, sy, rotDeg } = extractBoxFromOccluder(o);
  const z0 = o.z0 ?? 2.6;
  const z1 = o.z1 ?? z0 + 0.18;
  const h = Math.min(0.24, Math.max(0.12, z1 - z0));
  const zMid = z0 + h / 2;
  const cast = (o.opacity ?? 1) >= 0.3;

  const assembly = new THREE.Group();
  assembly.position.copy(mapToThree(cx, cy, 0));
  assembly.rotation.y = THREE.MathUtils.degToRad(rotDeg);
  grp.add(assembly);

  // Materials
  const steelPostMat = new THREE.MeshStandardMaterial({
    color: 0x222831,
    roughness: 0.35,
    metalness: 0.78,
  });
  const fasciaMat = new THREE.MeshStandardMaterial({
    color: 0x2f3640,
    roughness: 0.38,
    metalness: 0.68,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xeab308,
    roughness: 0.32,
    metalness: 0.75,
    emissive: 0x2a1a04,
  });

  // --------------------------------------------------------------------------
  // Sub-part 1: postsGroup (Cantilever steel columns along rear edge so footpath stays clear)
  // --------------------------------------------------------------------------
  const postsGroup = new THREE.Group();
  postsGroup.position.set(0, 0, 0);
  assembly.add(postsGroup);

  const numPosts = sx >= 4.4 ? 3 : 2;
  const postXs = numPosts === 3
    ? [-sx * 0.38, 0, sx * 0.38]
    : [-sx * 0.35, sx * 0.35];
  const rearZ = -sy * 0.42;

  for (const px of postXs) {
    // Baseplate at z = 0
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.28), steelPostMat);
    plate.position.set(px, 0.015, rearZ);
    plate.receiveShadow = true;
    postsGroup.add(plate);

    // Sleek vertical cantilever column rising to z0
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.13, z0, 0.16), steelPostMat);
    col.position.set(px, z0 / 2, rearZ);
    col.castShadow = true;
    col.receiveShadow = true;
    postsGroup.add(col);

    // Diagonal knee-brace bracket near top of column
    const braceLen = Math.min(0.75, sy * 0.38);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, braceLen), steelPostMat);
    brace.position.set(px, z0 - 0.22, rearZ + braceLen * 0.38);
    brace.rotation.x = -0.52;
    brace.castShadow = true;
    postsGroup.add(brace);
  }

  // --------------------------------------------------------------------------
  // Sub-part 2: frameGroup (Chamfered powder-coated aluminium perimeter fascia & cross-ribs)
  // --------------------------------------------------------------------------
  const frameGroup = new THREE.Group();
  frameGroup.position.set(0, zMid, 0);
  assembly.add(frameGroup);

  const fasciaT = 0.09;
  const fasciaH = h + 0.05;

  // Front & rear longitudinal fascia beams
  const frontBeam = new THREE.Mesh(new THREE.BoxGeometry(sx, fasciaH, fasciaT), fasciaMat);
  frontBeam.position.set(0, 0, sy / 2 - fasciaT / 2);
  frontBeam.castShadow = cast;
  frontBeam.receiveShadow = true;
  frameGroup.add(frontBeam);

  const rearBeam = new THREE.Mesh(new THREE.BoxGeometry(sx, fasciaH + 0.03, fasciaT * 1.2), fasciaMat);
  rearBeam.position.set(0, -0.01, -sy / 2 + fasciaT * 0.6);
  rearBeam.castShadow = cast;
  rearBeam.receiveShadow = true;
  frameGroup.add(rearBeam);

  // Left & right end fascia beams
  const leftBeam = new THREE.Mesh(new THREE.BoxGeometry(fasciaT, fasciaH, sy - fasciaT * 2), fasciaMat);
  leftBeam.position.set(-sx / 2 + fasciaT / 2, 0, 0);
  leftBeam.castShadow = cast;
  leftBeam.receiveShadow = true;
  frameGroup.add(leftBeam);

  const rightBeam = new THREE.Mesh(new THREE.BoxGeometry(fasciaT, fasciaH, sy - fasciaT * 2), fasciaMat);
  rightBeam.position.set(sx / 2 - fasciaT / 2, 0, 0);
  rightBeam.castShadow = cast;
  rightBeam.receiveShadow = true;
  frameGroup.add(rightBeam);

  // Hollow architectural golden/champagne perimeter reveal strips along outer fascia (keeps roof interior open!)
  const trimT = 0.022;
  const trimFront = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.02, 0.024, trimT), accentMat);
  trimFront.position.set(0, fasciaH * 0.36, sy / 2);
  const trimRear = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.02, 0.024, trimT), accentMat);
  trimRear.position.set(0, fasciaH * 0.36, -sy / 2);
  const trimLeft = new THREE.Mesh(new THREE.BoxGeometry(trimT, 0.024, sy), accentMat);
  trimLeft.position.set(-sx / 2, fasciaH * 0.36, 0);
  const trimRight = new THREE.Mesh(new THREE.BoxGeometry(trimT, 0.024, sy), accentMat);
  trimRight.position.set(sx / 2, fasciaH * 0.36, 0);
  frameGroup.add(trimFront, trimRear, trimLeft, trimRight);

  // Cantilever structural steel spine cross-ribs & upper outriggers aligned with the columns
  for (const px of postXs) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, fasciaH * 0.85, sy - fasciaT * 2), steelPostMat);
    rib.position.set(px, -0.01, 0);
    rib.castShadow = cast;
    frameGroup.add(rib);

    const upperOutrigger = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.055, sy + 0.04), steelPostMat);
    upperOutrigger.position.set(px, fasciaH * 0.56, 0);
    upperOutrigger.castShadow = cast;
    frameGroup.add(upperOutrigger);
  }

  // --------------------------------------------------------------------------
  // Sub-part 3: louversGroup (Signature Architectural Cedar-Louver & Cantilever Roof Pavilion)
  // --------------------------------------------------------------------------
  const louversGroup = new THREE.Group();
  louversGroup.position.set(0, zMid, 0);
  assembly.add(louversGroup);

  const louverBlades = [];
  const innerW = Math.max(0.4, sx - fasciaT * 2.2);
  const innerD = Math.max(0.4, sy - fasciaT * 2.2);

  // Warm Western Red Cedar / Architectural Copper-Bronze Aerofoil Louver Blades
  const cedarBladeMat = new THREE.MeshStandardMaterial({
    color: 0xdd7c3a,
    roughness: 0.36,
    metalness: 0.18,
    emissive: 0x3b1706,
  });
  const alumCapMat = new THREE.MeshStandardMaterial({
    color: 0xf4d068,
    roughness: 0.24,
    metalness: 0.82,
  });

  const numBlades = 14;
  const stepD = innerD / numBlades;
  for (let i = 0; i < numBlades; i++) {
    const bz = -innerD / 2 + (i + 0.5) * stepD;
    const bladeGrp = new THREE.Group();
    bladeGrp.position.set(0, 0.025, bz);
    bladeGrp.rotation.x = 0.34;

    const timberFin = new THREE.Mesh(
      new THREE.BoxGeometry(innerW - 0.03, 0.038, stepD * 0.58),
      cedarBladeMat
    );
    timberFin.castShadow = cast;
    timberFin.receiveShadow = true;
    bladeGrp.add(timberFin);

    // Thin brushed-champagne leading-edge nose bar along the front of each cedar fin (leaves warm cedar top exposed!)
    const topCap = new THREE.Mesh(
      new THREE.BoxGeometry(innerW - 0.02, 0.039, 0.022),
      alumCapMat
    );
    topCap.position.set(0, 0.002, (stepD * 0.58) / 2 + 0.008);
    topCap.castShadow = cast;
    bladeGrp.add(topCap);

    bladeGrp.userData.baseY = 0.025;
    bladeGrp.userData.baseRotX = 0.34;
    louversGroup.add(bladeGrp);
    louverBlades.push(bladeGrp);
  }

  // Crystal-clear architectural laminated skylight deck BELOW the louvers (casts crisp verified ground shadow while keeping louvers 100% visible from above)
  const deckMat = new THREE.MeshPhysicalMaterial({
    color: 0xdff2ff,
    roughness: 0.12,
    metalness: 0.15,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const weatherDeck = new THREE.Mesh(new THREE.BoxGeometry(innerW, 0.012, innerD), deckMat);
  weatherDeck.position.set(0, -0.032, 0);
  weatherDeck.castShadow = cast;
  weatherDeck.receiveShadow = false;
  weatherDeck.userData.baseY = -0.032;
  weatherDeck.userData.baseRotX = 0;
  louversGroup.add(weatherDeck);
  louverBlades.push(weatherDeck);

  // Warm integrated architectural LED soffit light strips under the cross-ribs
  const ledMat = new THREE.MeshStandardMaterial({
    color: 0xffefc2,
    emissive: 0xffb347,
    emissiveIntensity: 0.85,
    roughness: 0.2,
  });
  for (const px of postXs) {
    const ledBar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, innerD * 0.88), ledMat);
    ledBar.position.set(px, -fasciaH * 0.42, 0);
    frameGroup.add(ledBar);
  }

  grp.userData.parts = {
    postsGroup,
    frameGroup,
    louversGroup,
    louverBlades,
    baseZ0: z0,
    baseZ1: z1,
  };
  return grp;
}

export function buildDetailedOccluder(o, isProposal = false, toThree, options = {}) {
  const mapToThree = toThree || ((x, y, z) => new THREE.Vector3(x, z, -y));
  const grp = new THREE.Group();
  grp.userData.occ = o;
  if (!o) return grp;

  const isProp = Boolean(isProposal || o.source === 'proposal' || o.kind === 'canopy');
  const op = o.opacity ?? 1.0;
  const cast = op >= 0.3;
  const z0 = o.z0 ?? 0;
  const z1 = o.z1 ?? z0 + 1;
  const h = Math.max(0.02, z1 - z0);

  // 1. Trees (existing or proposed)
  if (o.kind === 'tree' || o.shape === 'sphere') {
    return buildTreeOccluder(o, isProp, mapToThree);
  }

  // 2. Proposed Canopy Intervention (Hero Architectural Canopy Assembly)
  if (isProp && (o.kind === 'canopy' || o.shape === 'box' || o.shape === 'prism')) {
    return buildHeroCanopyAssembly(o, mapToThree);
  }

  // 3. Buildings (extruded polygon footprint with procedural London facade + Google Earth aerial roof texture)
  if (o.kind === 'building' && o.shape === 'prism' && o.footprint?.length >= 3) {
    const styleIdx = hashString(o.id || 'bldg') % 3;
    const facadeTex = getBuildingFacadeTexture(styleIdx);

    const wallMat = new THREE.MeshStandardMaterial({
      map: facadeTex,
      roughness: 0.86,
      metalness: 0.06,
    });

    const shp = new THREE.Shape(o.footprint.map(([x, y]) => new THREE.Vector2(x, y)));
    const extrudeGeo = new THREE.ExtrudeGeometry(shp, { depth: h, bevelEnabled: false });
    applyArchitecturalUVs(extrudeGeo);

    const wallMesh = new THREE.Mesh(extrudeGeo, wallMat);
    wallMesh.rotation.x = -Math.PI / 2;
    wallMesh.position.y = z0;
    wallMesh.castShadow = cast;
    wallMesh.receiveShadow = cast;
    grp.add(wallMesh);

    // Real Google Earth satellite roof texture projected onto the building roof at z1!
    const roofGeo = new THREE.ShapeGeometry(shp);
    let cx = 0, cy = 0;
    for (const [px, py] of o.footprint) {
      cx += px;
      cy += py;
    }
    cx /= o.footprint.length;
    cy /= o.footprint.length;

    const z20B = activeSatelliteState.z20Bounds;
    const z19B = activeSatelliteState.z19Bounds;
    const inZ20 = z20B && cx >= z20B.west_m + 6 && cx <= z20B.east_m - 6 && cy >= z20B.south_m + 6 && cy <= z20B.north_m - 6;
    const useBounds = inZ20 ? z20B : z19B;
    const useTex = inZ20 ? (activeSatelliteState.z20Tex || activeSatelliteState.z19Tex) : activeSatelliteState.z19Tex;

    let roofDeckMat;
    if (useBounds && useTex) {
      applySatelliteRoofUVs(roofGeo, useBounds);
      roofDeckMat = new THREE.MeshStandardMaterial({
        map: useTex,
        color: 0xe8edf2,
        roughness: 0.85,
        metalness: 0.06,
      });
    } else {
      roofDeckMat = new THREE.MeshStandardMaterial({
        color: 0x353b43,
        roughness: 0.92,
        metalness: 0.08,
      });
    }

    const roofDeck = new THREE.Mesh(roofGeo, roofDeckMat);
    roofDeck.rotation.x = -Math.PI / 2;
    roofDeck.position.y = z1 + 0.015;
    roofDeck.receiveShadow = true;
    grp.add(roofDeck);

    // Raised Portland stone roof parapet coping rim at z1
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0xd4cfc4,
      roughness: 0.78,
      metalness: 0.05,
    });
    const parapet = buildPerimeterCoping(o.footprint, z1 - 0.05, z1 + 0.28, 0.26, stoneMat, mapToThree);
    grp.add(parapet);

    // Ground-floor shopfront cornice band at z = 3.1m for multi-storey buildings
    if (h >= 5.0) {
      const cornice = buildPerimeterCoping(o.footprint, z0 + 2.95, z0 + 3.18, 0.18, stoneMat, mapToThree);
      grp.add(cornice);
    }

    return grp;
  }

  // 4. Existing Shelter Roof / Clear Glass Back Wall
  if ((o.kind === 'shelter_roof' || o.kind === 'wall') && o.shape === 'box') {
    const [cx, cy] = o.center || [0, 0];
    const [sx, sy] = o.size || [1, 1];
    const rotRad = THREE.MathUtils.degToRad(o.rotation_deg || 0);

    const sub = new THREE.Group();
    sub.position.copy(mapToThree(cx, cy, (z0 + z1) / 2));
    sub.rotation.y = rotRad;
    grp.add(sub);

    if (op < 0.3) {
      // Clear polycarbonate / glass: lets harsh sun straight through (castShadow = false)
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0x88d8ff,
        transparent: true,
        opacity: 0.24,
        roughness: 0.08,
        metalness: 0.12,
        reflectivity: 0.9,
        depthWrite: false,
      });
      const glassMesh = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sy), glassMat);
      glassMesh.castShadow = false;
      glassMesh.receiveShadow = false;
      sub.add(glassMesh);

      // Thin dark metallic edge framing & glazing ribs (castShadow = false so shadow matches engine)
      const frameMat = new THREE.MeshStandardMaterial({
        color: 0x252b33,
        roughness: 0.4,
        metalness: 0.72,
      });
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(glassMesh.geometry, 25),
        new THREE.LineBasicMaterial({ color: 0x252b33 })
      );
      sub.add(edges);

      if (o.kind === 'shelter_roof') {
        const numRibs = 4;
        for (let i = 0; i < numRibs; i++) {
          const rx = -sx / 2 + (i / (numRibs - 1)) * sx;
          const rib = new THREE.Mesh(new THREE.BoxGeometry(0.045, h + 0.02, sy + 0.02), frameMat);
          rib.position.set(rx, 0, 0);
          rib.castShadow = false;
          sub.add(rib);
        }
      }
    } else {
      const solidMat = new THREE.MeshStandardMaterial({
        color: o.kind === 'shelter_roof' ? 0x5c6470 : 0x4a525c,
        roughness: 0.55,
        metalness: 0.4,
      });
      const solidMesh = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sy), solidMat);
      solidMesh.castShadow = true;
      solidMesh.receiveShadow = true;
      sub.add(solidMesh);
    }
    return grp;
  }

  // 5. Cylinders (Bus stop pole or cylindrical column)
  if (o.shape === 'cylinder') {
    const [cx, cy] = o.center || [0, 0];
    const r = Math.max(o.radius ?? 0.05, 0.04);
    const isPole = o.id === 'pole' || r <= 0.15;
    const mat = new THREE.MeshStandardMaterial({
      color: isPole ? 0xcbd5e1 : 0x4a525c,
      roughness: isPole ? 0.28 : 0.7,
      metalness: isPole ? 0.82 : 0.2,
    });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 20), mat);
    mesh.position.copy(mapToThree(cx, cy, (z0 + z1) / 2));
    mesh.castShadow = cast;
    mesh.receiveShadow = cast;
    grp.add(mesh);

    if (isPole) {
      const collarMat = new THREE.MeshStandardMaterial({
        color: 0x22272e,
        roughness: 0.5,
        metalness: 0.6,
      });
      const collarH = Math.min(0.68, h * 0.25);
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 1.35, r * 1.55, collarH, 20),
        collarMat
      );
      collar.position.copy(mapToThree(cx, cy, z0 + collarH / 2));
      collar.castShadow = cast;
      grp.add(collar);
    }
    return grp;
  }

  // 6. Generic Box or Prism Fallback
  const fallbackMat = new THREE.MeshStandardMaterial({
    color: isProp ? 0xe0703c : 0x8b939e,
    roughness: 0.75,
  });
  if (o.shape === 'prism' && o.footprint?.length >= 3) {
    const shp = new THREE.Shape(o.footprint.map(([x, y]) => new THREE.Vector2(x, y)));
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shp, { depth: h, bevelEnabled: false }), fallbackMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = z0;
    mesh.castShadow = cast;
    mesh.receiveShadow = cast;
    grp.add(mesh);
  } else if (o.shape === 'box') {
    const [cx, cy] = o.center || [0, 0];
    const [sx, sy] = o.size || [1, 1];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sy), fallbackMat);
    mesh.position.copy(mapToThree(cx, cy, (z0 + z1) / 2));
    mesh.rotation.y = THREE.MathUtils.degToRad(o.rotation_deg || 0);
    mesh.castShadow = cast;
    mesh.receiveShadow = cast;
    grp.add(mesh);
  }
  return grp;
}

// ============================================================================
// 4. setCanopyInstallProgress(propGroup, progress = 1.0, louverAngleDeg = 0)
// ============================================================================

export function setCanopyInstallProgress(propGroup, progress = 1.0, louverAngleDeg = 0) {
  if (!propGroup) return;
  const p = clamp01(Number(progress ?? 1.0));
  const louverRad = THREE.MathUtils.degToRad(Number(louverAngleDeg) || 0);

  for (const grp of propGroup.children) {
    const parts = grp.userData?.parts;
    if (!parts) continue;
    const { postsGroup, frameGroup, louversGroup, louverBlades = [] } = parts;

    // Phase 1 (0.00 -> 0.28): Vertical steel support columns grow smoothly from pavement
    if (postsGroup) {
      const t1 = clamp01(p / 0.28);
      const e1 = easeOutCubic(t1);
      postsGroup.visible = p > 0.001;
      postsGroup.scale.set(1, Math.max(0.001, e1), 1);
    }

    // Phase 2 (0.22 -> 0.55): Cantilever beams and perimeter fascia frame extend outward
    if (frameGroup) {
      const t2 = clamp01((p - 0.22) / (0.55 - 0.22));
      const e2 = easeOutCubic(t2);
      frameGroup.visible = p > 0.22;
      const s2 = Math.max(0.001, e2);
      frameGroup.scale.set(s2, s2, s2);
    }

    // Phase 3 (0.48 -> 0.88): Individual louver blades / roof panels cascade into position
    // Phase 4 (0.80 -> 1.00): Louver blades rotate smoothly into louverAngleDeg
    if (louversGroup) {
      louversGroup.visible = p > 0.48;
      const n = Math.max(1, louverBlades.length);
      const t4 = clamp01((p - 0.80) / 0.20);
      const e4 = easeOutCubic(t4);

      louverBlades.forEach((blade, i) => {
        const start = 0.48 + (i / n) * 0.24;
        const end = start + 0.16;
        const tb = clamp01((p - start) / (end - start));
        const eb = easeOutBack(tb);
        const ec = easeOutCubic(tb);

        blade.visible = tb > 0.001;
        if (blade.userData.targetScale) {
          blade.scale.copy(blade.userData.targetScale).multiplyScalar(Math.max(0.001, eb));
        } else {
          blade.scale.setScalar(Math.max(0.001, eb));
        }

        const baseY = blade.userData.baseY || 0;
        blade.position.y = baseY + (1 - ec) * 0.32;

        const baseRotX = blade.userData.baseRotX || 0;
        const targetRotX = baseRotX + louverRad;
        blade.rotation.x = (1 - e4) * (baseRotX - 0.55) + e4 * targetRotX;
      });
    }
  }
}

export function setCanopyLouverAngle(propGroup, louverAngleDeg = 0) {
  setCanopyInstallProgress(propGroup, 1.0, louverAngleDeg);
}
