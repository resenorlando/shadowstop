// ShadowStop hero 3D: a close, architectural view of the real Hackney Town Hall stop, before and after
// the verified design, with the sun moving through the scored day.
//
// Honesty rules (see AGENTS.md):
// - Geometry is scenes/hackney_accepted.json (OSM buildings/trees/shelter + the accepted proposal).
// - Every shadow-casting structure (buildings, tree crowns, shelter roof, the obvious fix, the accepted
//   canopy) casts its shadow from the EXACT verifier geometry, with partial opacity rendered as a dither.
//   The sail/glass you see are drawn inside that verified envelope; masts, people and bench are cosmetic.
// - Sun angles come from the engine's by_time in assets/hero.json (interpolated between quarter-hours).
// - Shade percentages are never computed here: shadeAt() looks them up in hero.json (engine.py output).
//
// Use standalone (hero3d.html) or from the film: window.H3D (resolves via window.H3D_READY).
import * as THREE from 'three';

const toThree = (x, y, z) => new THREE.Vector3(x, z, -y); // scene x=east, y=north, z=up -> three
const deg = THREE.MathUtils.degToRad;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const parseClock = (t) => { const [h, m] = String(t).split(':').map(Number); return h + (m || 0) / 60; };

async function getJSON(paths) {
  let err;
  for (const p of paths) {
    try { const r = await fetch(p, { cache: 'no-store' }); if (r.ok) return await r.json(); err = new Error(p + ' ' + r.status); }
    catch (e) { err = e; }
  }
  throw err;
}

// Mare Street centreline near the stop, local metres (from the cached OSM ways used to build the scene).
const MARE_ST = [[7.4, -90], [7.9, -52.5], [8.4, -43.7], [9.0, -36.6], [11.4, -3.2], [12.7, 10.6], [13.4, 19.3], [15.3, 44.1], [16.4, 90]];
const ROAD_W = 12.5;

// ---------------------------------------------------------------- textures
function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true, nearest = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  t.anisotropy = 8;
  return t;
}
function noise(ctx, w, h, a, n = 9000) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * a})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
// dither alpha map: exactly round(opacity*N) of N texels opaque, in an irregular (seeded noise) order,
// so the shadow reads as dappled light at the verifier's opacity rather than a regular grid.
function ditherTex(opacity, n = 32) {
  let sd = 12345; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const order = Array.from({ length: n * n }, (_, i) => [r(), i]).sort((a, b) => a[0] - b[0]);
  const on = new Set(order.slice(0, Math.round(opacity * n * n)).map((x) => x[1]));
  return canvasTex(n, n, (ctx) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, n, n); ctx.fillStyle = '#fff';
    for (const i of on) ctx.fillRect(i % n, Math.floor(i / n), 1, 1);
  }, { srgb: false, nearest: true });
}

// ---------------------------------------------------------------- main
export async function createHero(container, opts = {}) {
  const P = new URLSearchParams(location.search);
  const [scene, hero] = await Promise.all([
    getJSON(['/scenes/hackney_accepted.json', '../scenes/hackney_accepted.json']),
    getJSON(['assets/hero.json', '/assets/hero.json']),
  ]);
  const BT = { before: hero.before.by_time, after: hero.after.by_time };

  const W = () => container.clientWidth || innerWidth, H = () => container.clientHeight || innerHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!opts.preserve });
  renderer.setPixelRatio(opts.pixelRatio ?? Math.min(devicePixelRatio, 2));
  renderer.setSize(W(), H());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  container.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });

  const s3 = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, W() / H(), 0.1, 2000);

  // sky: vertical gradient on a big sphere, re-tinted with sun height
  const skyU = { top: { value: new THREE.Color('#2f6fc4') }, hor: { value: new THREE.Color('#f3dfbd') } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vp; void main(){ float t = pow(clamp(vp.y*1.4+0.02,0.,1.),0.55); gl_FragColor = vec4(mix(hor, top, t),1.); }',
  }));
  s3.add(sky);
  s3.fog = new THREE.Fog(0xe9d9bf, 120, 420);

  const hemi = new THREE.HemisphereLight(0xc4dbff, 0x7d705f, 0.62);
  s3.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
  s3.add(sun); s3.add(sun.target);
  // the sun itself, far away along its direction
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: canvasTex(128, 128, (ctx) => { const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,252,235,1)'); g.addColorStop(0.18, 'rgba(255,236,170,1)'); g.addColorStop(0.4, 'rgba(255,200,90,.35)'); g.addColorStop(1, 'rgba(255,180,60,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128); }),
    fog: false, depthWrite: false, transparent: true,
  }));
  sunSprite.scale.setScalar(90); s3.add(sunSprite);

  // ---------- ground: paving + Mare Street carriageway
  const paving = canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#a9a39a'; ctx.fillRect(0, 0, w, h); noise(ctx, w, h, 0.07);
    ctx.strokeStyle = 'rgba(70,62,52,.28)'; ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * 128, 0); ctx.lineTo(i * 128, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * 128); ctx.lineTo(w, i * 128); ctx.stroke(); }
  }, { repeat: [400 / 2.4, 400 / 2.4] }); // 0.6 m slabs
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: paving, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s3.add(ground);

  const asphalt = canvasTex(256, 256, (ctx, w, h) => { ctx.fillStyle = '#3c3f44'; ctx.fillRect(0, 0, w, h); noise(ctx, w, h, 0.12, 12000); }, { repeat: [3, 40] });
  function strip(pts, half, y, mat, offset = 0) {
    // ribbon along a polyline in scene x/y, at height y (three up)
    const L = [], R = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1]; const n = Math.hypot(dx, dy); dx /= n; dy /= n;
      const nx = dy, ny = -dx; // right-hand normal (east for a northbound road)
      L.push([pts[i][0] + nx * (offset - half), pts[i][1] + ny * (offset - half)]);
      R.push([pts[i][0] + nx * (offset + half), pts[i][1] + ny * (offset + half)]);
    }
    const pos = [], uv = [], idx = [];
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      for (const [p, u] of [[L[i], 0], [R[i], 1]]) { const v = toThree(p[0], p[1], 0); pos.push(v.x, y, v.z); uv.push(u, acc / 10); }
      if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; s3.add(m); return m;
  }
  strip(MARE_ST, ROAD_W / 2, 0.012, new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.9 }));
  strip(MARE_ST, 0.16, 0.06, new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.8 }), -ROAD_W / 2 - 0.1); // west kerb
  strip(MARE_ST, 0.16, 0.06, new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.8 }), ROAD_W / 2 + 0.1);
  const dash = canvasTex(64, 256, (ctx) => { ctx.clearRect(0, 0, 64, 256); ctx.fillStyle = '#f2f2ee'; ctx.fillRect(0, 0, 64, 110); }, { repeat: [1, 1] });
  strip(MARE_ST, 0.08, 0.018, new THREE.MeshStandardMaterial({ map: dash, transparent: true, roughness: 0.7 }), 0);
  const bstop = canvasTex(64, 256, (ctx) => { ctx.clearRect(0, 0, 64, 256); ctx.fillStyle = '#f2c230'; ctx.fillRect(0, 0, 64, 140); }, { repeat: [1, 1] });
  strip(MARE_ST.slice(3, 6), 0.07, 0.02, new THREE.MeshStandardMaterial({ map: bstop, transparent: true }), -ROAD_W / 2 + 0.45); // bus-stop kerb marking

  // ---------- helpers for "exact verifier geometry casts the shadow"
  const casters = { base: new THREE.Group(), obvious: new THREE.Group(), after: new THREE.Group() };
  const visuals = { base: new THREE.Group(), obvious: new THREE.Group(), after: new THREE.Group() };
  Object.values(casters).forEach((g) => s3.add(g)); Object.values(visuals).forEach((g) => s3.add(g));
  // Invisible in the colour pass; in the shadow pass three.js copies alphaMap/alphaTest from this material,
  // so a dither alphaMap gives a partial shadow matching the verifier's opacity.
  function shadowProxy(geom, opacity, uvScale = 1) {
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    if (opacity < 0.999) { const t = ditherTex(opacity); t.repeat.set(uvScale, uvScale); mat.alphaMap = t; mat.alphaTest = 0.5; }
    const m = new THREE.Mesh(geom, mat);
    m.castShadow = true; m.receiveShadow = false;
    return m;
  }
  function boxGeom(o) {
    const [sx, sy] = o.size, h = o.z1 - o.z0;
    const g = new THREE.BoxGeometry(sx, h, sy);
    g.rotateY(deg(o.rotation_deg || 0));
    const c = toThree(o.center[0], o.center[1], (o.z0 + o.z1) / 2);
    g.translate(c.x, c.y, c.z);
    return g;
  }
  function placeLocal(obj, o, z) { // put obj at the occluder centre with its rotation (local x = size[0])
    const c = toThree(o.center[0], o.center[1], z);
    obj.position.copy(c); obj.rotation.y = deg(o.rotation_deg || 0);
    return obj;
  }

  // buildings (exact prisms, opaque)
  const BRICK = [0xc7b39b, 0xb48a6c, 0xd9cfbf, 0xa9785a, 0xcfc4b3, 0xbfa58a];
  const facade = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); noise(ctx, w, h, 0.05);
    for (let r = 0; r < 4; r++) {
      ctx.fillStyle = 'rgba(0,0,0,.06)'; ctx.fillRect(0, r * 64 + 58, w, 6); // storey string course
      for (let c = 0; c < 4; c++) {
        const x = c * 64 + 20, y = r * 64 + 12;
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(x - 3, y - 3, 30, 44); // stone surround
        const g = ctx.createLinearGradient(0, y, 0, y + 38); g.addColorStop(0, '#5d7286'); g.addColorStop(1, '#2c3a48');
        ctx.fillStyle = g; ctx.fillRect(x, y, 24, 38);
        ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x + 11, y, 2, 38); ctx.fillRect(x, y + 17, 24, 2);
      }
    }
  }, { repeat: [1, 1] });
  let bi = 0;
  for (const o of scene.occluders.filter((o) => o.kind === 'building' && o.shape === 'prism')) {
    const shp = new THREE.Shape(o.footprint.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shp, { depth: o.z1 - o.z0, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); g.translate(0, o.z0, 0);
    // walls get window texture scaled to 3 m storeys
    const uv = g.attributes.uv, pos = g.attributes.position, nrm = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(nrm.getY(i)) < 0.5) uv.setXY(i, (pos.getX(i) * Math.abs(nrm.getZ(i)) + pos.getZ(i) * Math.abs(nrm.getX(i))) / 12, pos.getY(i) / 12);
      else uv.setXY(i, 0.02, 0.02);
    }
    const mat = new THREE.MeshStandardMaterial({ color: BRICK[bi++ % BRICK.length], map: facade, roughness: 0.92 });
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true;
    casters.base.add(m);
  }

  // trees: exact ellipsoid crown casts a dithered shadow; the visible crown is a few leafy lumps inside it
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f8a3a, roughness: 0.95, flatShading: true });
  const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x3f7a30, roughness: 0.95, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a5240, roughness: 1 });
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const o of scene.occluders.filter((o) => o.kind === 'tree')) {
    const r = o.radius, zc = (o.z0 + o.z1) / 2, rz = (o.z1 - o.z0) / 2;
    const proxyG = new THREE.SphereGeometry(1, 24, 16); proxyG.scale(r, rz, r);
    const c = toThree(o.center[0], o.center[1], zc); proxyG.translate(c.x, c.y, c.z);
    casters.base.add(shadowProxy(proxyG, o.opacity ?? 0.7, 14));
    const grp = new THREE.Group(); grp.position.copy(toThree(o.center[0], o.center[1], 0));
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, zc, 8), trunkMat);
    trunk.position.y = zc / 2; trunk.castShadow = true; grp.add(trunk);
    for (let k = 0; k < 6; k++) {
      const lr = r * (0.45 + rnd() * 0.25);
      const g = new THREE.IcosahedronGeometry(lr, 1);
      const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.9 + rnd() * 0.2), p.getY(i) * (0.85 + rnd() * 0.2), p.getZ(i) * (0.9 + rnd() * 0.2));
      g.computeVertexNormals();
      const lump = new THREE.Mesh(g, k % 2 ? leafMat : leafMat2);
      const a = rnd() * Math.PI * 2, d = (r - lr) * rnd();
      lump.position.set(Math.cos(a) * d, zc + (rnd() - 0.5) * (rz - lr) * 1.2, Math.sin(a) * d);
      lump.receiveShadow = true; grp.add(lump);
    }
    visuals.base.add(grp);
  }

  // existing shelter: the verifier's roof box (opacity 0.5) casts a 50% dithered shadow; glass + frame drawn on top
  const roof = scene.occluders.find((o) => o.kind === 'shelter_roof');
  const steel = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.45, metalness: 0.6 });
  if (roof) {
    casters.base.add(shadowProxy(boxGeom(roof), roof.opacity ?? 0.5, 4));
    const [sx, sy] = roof.size;
    const sh = placeLocal(new THREE.Group(), roof, 0);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(sx, roof.z1 - roof.z0, sy),
      new THREE.MeshPhysicalMaterial({ color: 0xa9d6ea, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false }));
    glass.position.y = (roof.z0 + roof.z1) / 2; sh.add(glass);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: 0x2a2f36 }));
    edge.position.copy(glass.position); sh.add(edge);
    // two rear posts (cosmetic) on the side away from the kerb (west)
    for (const sxn of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, roof.z0, 0.08), steel);
      post.position.set(sxn * (sx / 2 - 0.15), roof.z0 / 2, -(sy / 2 - 0.12)); post.castShadow = true; sh.add(post);
    }
    // bench (OSM bench=yes), cosmetic
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: 0x5c6670, roughness: 0.5, metalness: 0.4 }));
    bench.position.set(0, 0.48, -(sy / 2 - 0.35)); bench.castShadow = true; bench.receiveShadow = true; sh.add(bench);
    visuals.base.add(sh);

    // the "obvious fix": same box, opaque metal roof (exactly what server._obvious_fix verifies)
    casters.obvious.add(shadowProxy(boxGeom(roof), 1));
    const ob = placeLocal(new THREE.Group(), roof, 0);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(sx, roof.z1 - roof.z0, sy), new THREE.MeshStandardMaterial({ color: 0x59606a, roughness: 0.35, metalness: 0.7 }));
    panel.position.y = (roof.z0 + roof.z1) / 2; ob.add(panel);
    const obEdge = new THREE.LineSegments(new THREE.EdgesGeometry(panel.geometry), new THREE.LineBasicMaterial({ color: 0xff3b2f }));
    obEdge.position.copy(panel.position); ob.add(obEdge);
    visuals.obvious.add(ob);
  }

  // accepted design: verifier box casts (shade fabric, opacity 0.85); a hypar sail drawn inside that envelope
  const prop = scene.proposals[0];
  const sailGroup = placeLocal(new THREE.Group(), prop, 0);
  const sailProxy = shadowProxy(boxGeom(prop), prop.opacity ?? 0.85, 6); // shade_fabric catalogue opacity
  casters.after.add(sailProxy);
  const [px, py] = prop.size, z0 = prop.z0, z1 = prop.z1;
  const sailG = new THREE.PlaneGeometry(px, py, 24, 24);
  { const p = sailG.attributes.position; for (let i = 0; i < p.count; i++) { const u = p.getX(i) / (px / 2), v = p.getY(i) / (py / 2); p.setZ(i, (z0 + z1) / 2 + (z1 - z0) / 2 * u * v); } }
  sailG.rotateX(-Math.PI / 2); sailG.computeVertexNormals();
  const sailTex = canvasTex(256, 256, (ctx, w, h) => { ctx.fillStyle = '#f4efe4'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = 'rgba(150,140,120,.18)'; ctx.lineWidth = 2; for (let i = 0; i < w; i += 16) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); } }, { repeat: [4, 4] });
  const sail = new THREE.Mesh(sailG, new THREE.MeshStandardMaterial({ map: sailTex, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x6b6253, emissiveIntensity: 0.55 })); // fabric glows a little when back-lit
  sail.receiveShadow = false; sailGroup.add(sail);
  const sailEdgeG = new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([u, v]) => new THREE.Vector3(u * px / 2, (z0 + z1) / 2 + (z1 - z0) / 2 * u * v, -v * py / 2)));
  sailGroup.add(new THREE.Line(sailEdgeG, new THREE.LineBasicMaterial({ color: 0xc9bfa8 })));
  const masts = [];
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const top = (z0 + z1) / 2 + (z1 - z0) / 2 * u * v + 0.35;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, top, 10), steel);
    m.geometry.translate(0, top / 2, 0);
    m.position.set(u * (px / 2 + 0.12), 0, -v * (py / 2 + 0.12)); m.castShadow = true;
    sailGroup.add(m); masts.push(m);
  }
  visuals.after.add(sailGroup);

  // waiting area outline (verifier polygon), on the ground
  const wa = scene.waiting_area;
  const waLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(wa.map(([x, y]) => toThree(x, y, 0.03))),
    new THREE.LineDashedMaterial({ color: 0xffb340, dashSize: 0.35, gapSize: 0.22, transparent: true, opacity: 0.95 }));
  waLine.computeLineDistances(); s3.add(waLine);
  const waFill = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(wa.map(([x, y]) => new THREE.Vector2(x, y)))),
    new THREE.MeshBasicMaterial({ color: 0xffb340, transparent: true, opacity: 0.0, depthWrite: false }));
  waFill.rotation.x = -Math.PI / 2; waFill.position.y = 0.025; s3.add(waFill);

  // people waiting (scale figures)
  const PEOPLE = [[0.3, -1.6, 0x2f5d8a, 1.72], [-0.4, 0.4, 0xb5523b, 1.62], [0.45, 1.9, 0x3e6b4a, 1.78], [-0.2, -2.5, 0x6b4b7a, 1.15]];
  for (const [x, y, col, hgt] of PEOPLE) {
    const g = new THREE.Group(); g.position.copy(toThree(x, y, 0));
    const k = hgt / 1.7, cloth = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17 * k, 0.42 * k, 4, 10), cloth);
    body.scale.z = 0.7; body.position.y = hgt * 0.66; body.castShadow = true; g.add(body);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.065 * k, 0.055 * k, hgt * 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.9 }));
      leg.position.set(sx * 0.08 * k, hgt * 0.25, 0); leg.castShadow = true; g.add(leg);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12 * hgt / 1.7, 14, 10), new THREE.MeshStandardMaterial({ color: 0xc69c7d, roughness: 0.7 }));
    head.position.y = hgt * 0.92; head.castShadow = true; g.add(head);
    s3.add(g);
  }

  // ---------- state
  const st = { mode: 'before', hour: 13, build: 1, split: null, sbs: false, waGlow: 0 };
  function sunAt(hour, bt = BT.before) {
    const h0 = parseClock(bt[0].t), h1 = parseClock(bt[bt.length - 1].t);
    const f = (clamp(hour, h0, h1) - h0) * 4, i = Math.min(bt.length - 2, Math.floor(f)), t = f - i;
    return { az: bt[i].sun_az + (bt[i + 1].sun_az - bt[i].sun_az) * t, el: bt[i].sun_el + (bt[i + 1].sun_el - bt[i].sun_el) * t };
  }
  // verifier output at the nearest quarter-hour (never computed in the browser)
  function shadeAt(hour, mode = st.mode) {
    const bt = mode === 'after' ? BT.after : BT.before; // 'obvious' has only the 09:00 counterexample, see hero.json
    const i = clamp(Math.round((hour - parseClock(bt[0].t)) * 4), 0, bt.length - 1);
    return { t: bt[i].t, shade: bt[i].shade, sun_az: bt[i].sun_az, sun_el: bt[i].sun_el };
  }
  function applySun() {
    const { az, el } = sunAt(st.hour);
    const d = new THREE.Vector3(Math.sin(deg(az)) * Math.cos(deg(el)), Math.sin(deg(el)), -Math.cos(deg(az)) * Math.cos(deg(el)));
    sun.position.copy(d.clone().multiplyScalar(150)); sun.target.position.set(0, 0, 0);
    sunSprite.position.copy(d.clone().multiplyScalar(700));
    const warm = clamp((40 - el) / 20, 0, 1); // low sun -> warmer light and sky
    sun.color.setRGB(1, 0.95 - 0.12 * warm, 0.86 - 0.26 * warm);
    sun.intensity = 2.6 + 0.7 * clamp(el / 55, 0, 1);
    skyU.top.value.set('#2f6fc4').lerp(new THREE.Color('#3a5f9e'), warm * 0.6);
    skyU.hor.value.set('#f1e3c6').lerp(new THREE.Color('#f6c88e'), warm);
    s3.fog.color.copy(skyU.hor.value);
  }
  function applyBuild(groupMode) {
    const b = clamp(st.build, 0, 1);
    const showAfter = groupMode === 'after';
    casters.after.visible = visuals.after.visible = showAfter && b > 0.001;
    // masts rise first (0..0.45), sail unfurls from the centre (0.35..1)
    const mb = clamp(b / 0.45, 0, 1), sb = clamp((b - 0.35) / 0.65, 0, 1);
    masts.forEach((m) => { m.scale.y = Math.max(0.001, 1 - Math.pow(1 - mb, 3)); });
    const e = 1 - Math.pow(1 - sb, 3);
    sail.scale.set(Math.max(0.001, e), 1, Math.max(0.001, e)); sail.visible = sb > 0.001;
    sailGroup.children[1].visible = sb > 0.98;
    // shadow proxy grows with the sail about the proposal centre; exact verifier geometry at b = 1
    const c = toThree(prop.center[0], prop.center[1], 0);
    sailProxy.scale.set(Math.max(0.001, e), 1, Math.max(0.001, e));
    sailProxy.position.set(c.x * (1 - e), 0, c.z * (1 - e));
    sailProxy.visible = sb > 0.001;
  }
  function showMode(m) {
    casters.obvious.visible = visuals.obvious.visible = m === 'obvious';
    applyBuild(m);
  }

  const view = { px: 9, py: -11, pz: 3.6, tx: -0.4, ty: -0.2, tz: 1.3, fov: 38 };
  const VIEWS = {
    hero: { px: -7, py: -12, pz: 4.2, tx: 0.3, ty: 0.8, tz: 1.3, fov: 38 },
    compare: { px: 7, py: -13, pz: 7.5, tx: -0.4, ty: 0.2, tz: 0.2, fov: 40 },
    top: { px: 0.6, py: -6.5, pz: 15, tx: -0.3, ty: 0.2, tz: 0, fov: 40 },
    aerial: { px: 45, py: -110, pz: 140, tx: 0, ty: 0, tz: 0, fov: 40 },
  };
  function applyView() {
    camera.position.copy(toThree(view.px, view.py, view.pz));
    camera.lookAt(toThree(view.tx, view.ty, view.tz));
    if (camera.fov !== view.fov) { camera.fov = view.fov; camera.updateProjectionMatrix(); }
  }
  function resize() {
    renderer.setSize(W(), H(), false);
    camera.aspect = W() / H(); camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);

  function render() {
    applySun(); applyView();
    waFill.material.opacity = 0.28 * st.waGlow;
    const w = renderer.domElement.width / renderer.getPixelRatio(), h = renderer.domElement.height / renderer.getPixelRatio();
    if (st.sbs) { // identical camera, side by side: left = before, right = after
      const hw = Math.floor(w / 2);
      camera.aspect = hw / h; camera.updateProjectionMatrix();
      renderer.setScissorTest(true);
      showMode('before'); renderer.setViewport(0, 0, hw, h); renderer.setScissor(0, 0, hw, h); renderer.render(s3, camera);
      showMode('after'); renderer.setViewport(w - hw, 0, hw, h); renderer.setScissor(w - hw, 0, hw, h); renderer.render(s3, camera);
      renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    } else if (st.split == null) {
      showMode(st.mode);
      renderer.setScissorTest(false);
      renderer.render(s3, camera);
    } else {
      const sx = Math.round(w * clamp(st.split, 0, 1));
      renderer.setScissorTest(true);
      showMode('before'); renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, sx, h); renderer.render(s3, camera);
      showMode('after'); renderer.setScissor(sx, 0, w - sx, h); renderer.render(s3, camera);
      renderer.setScissorTest(false);
    }
  }
  let loop = !opts.manual;
  (function tick() { if (!loop) return; render(); requestAnimationFrame(tick); })();

  const api = {
    THREE, scene: s3, camera, renderer, hero, sceneJSON: scene, VIEWS, view, state: st,
    set(o) { Object.assign(st, o); return api; },
    setView(v) { Object.assign(view, typeof v === 'string' ? VIEWS[v] : v); return api; },
    sunAt, shadeAt, render, resize,
    stopLoop() { loop = false; },
  };
  return api;
}

// auto-init when the page has <div id="h3d">
const host = document.getElementById('h3d');
if (host) {
  window.H3D_READY = createHero(host, { manual: host.dataset.manual === '1', pixelRatio: host.dataset.pr ? Number(host.dataset.pr) : undefined, preserve: host.dataset.preserve === '1' })
    .then((h) => { window.H3D = h; document.dispatchEvent(new CustomEvent('h3d-ready')); return h; })
    .catch((e) => { console.error('hero3d failed', e); window.H3D_ERROR = e; throw e; });
}
