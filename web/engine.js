// Browser fallback scorer: same idea as the server engine (sun position + ray casting),
// used ONLY when /api/score is unreachable so the stage demo never shows blank numbers.
// The server's numbers are the authority whenever they are available.

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
// parameter interval where p.z + t*d.z is within [z0, z1], t >= 0
function zRange(p, d, z0, z1) {
  if (Math.abs(d[2]) < 1e-9) return p[2] >= z0 && p[2] <= z1 ? [0, 1e6] : null;
  let a = (z0 - p[2]) / d[2], b = (z1 - p[2]) / d[2];
  if (a > b) [a, b] = [b, a];
  a = Math.max(a, 0);
  return b >= a ? [a, Math.min(b, 1e6)] : null;
}

function hits(o, p, d) {
  const z0 = o.z0 ?? 0, z1 = o.z1 ?? z0 + 1;
  if (o.shape === 'sphere') {
    const c = [o.center[0], o.center[1], (z0 + z1) / 2], r = o.radius ?? 1;
    const m = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const b = m[0] * d[0] + m[1] * d[1] + m[2] * d[2];
    const cc = m[0] ** 2 + m[1] ** 2 + m[2] ** 2 - r * r;
    const disc = b * b - cc;
    return disc >= 0 && -b + Math.sqrt(disc) > 0;
  }
  const zr = zRange(p, d, z0, z1);
  if (!zr) return false;
  const [ta, tb] = zr;
  if (o.shape === 'cylinder') {
    const r = o.radius ?? 0.2;
    const ox = p[0] - o.center[0], oy = p[1] - o.center[1];
    const A = d[0] ** 2 + d[1] ** 2;
    if (A < 1e-12) return ox * ox + oy * oy <= r * r;
    const B = ox * d[0] + oy * d[1], C = ox * ox + oy * oy - r * r;
    const disc = B * B - A * C;
    if (disc < 0) return false;
    const s = Math.sqrt(disc), t1 = (-B - s) / A, t2 = (-B + s) / A;
    return Math.max(t1, ta) <= Math.min(t2, tb);
  }
  if (o.shape === 'box') {
    const rot = -((o.rotation_deg || 0) * Math.PI) / 180, cs = Math.cos(rot), sn = Math.sin(rot);
    const lx = p[0] - o.center[0], ly = p[1] - o.center[1];
    const P = [lx * cs - ly * sn, lx * sn + ly * cs], D = [d[0] * cs - d[1] * sn, d[0] * sn + d[1] * cs];
    let lo = ta, hi = tb;
    for (let k = 0; k < 2; k++) {
      const h = o.size[k] / 2;
      if (Math.abs(D[k]) < 1e-12) { if (Math.abs(P[k]) > h) return false; continue; }
      let a = (-h - P[k]) / D[k], b = (h - P[k]) / D[k];
      if (a > b) [a, b] = [b, a];
      lo = Math.max(lo, a); hi = Math.min(hi, b);
      if (lo > hi) return false;
    }
    return true;
  }
  if (o.shape === 'prism') {
    const fp = o.footprint;
    const ax = p[0] + d[0] * ta, ay = p[1] + d[1] * ta, bx = p[0] + d[0] * tb, by = p[1] + d[1] * tb;
    if (pointInPoly(ax, ay, fp) || pointInPoly(bx, by, fp)) return true;
    for (let i = 0, j = fp.length - 1; i < fp.length; j = i++) {
      if (segsCross(ax, ay, bx, by, fp[j][0], fp[j][1], fp[i][0], fp[i][1])) return true;
    }
    return false;
  }
  return false;
}

export function scoreScene(scene, includeProposals, computeSun, { step = 0.5, minutes = 15, height = 0.05 } = {}) {
  const occ = [...(scene.occluders || []), ...(includeProposals ? scene.proposals || [] : [])];
  const wa = scene.waiting_area;
  const xs = wa.map((p) => p[0]), ys = wa.map((p) => p[1]);
  const cells = [];
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step)
    for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step)
      if (pointInPoly(x, y, wa)) cells.push({ x: +x.toFixed(3), y: +y.toFixed(3), sum: 0, n: 0 });
  const [h0, h1] = scene.hours || [9, 18];
  const by_time = [];
  let tot = 0, totN = 0;
  for (let m = h0 * 60; m <= h1 * 60 + 1e-6; m += minutes) {
    const hour = m / 60;
    const s = computeSun(scene.lat, scene.lon, scene.date, hour, scene.utc_offset ?? 0);
    const t = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.round(m % 60)).padStart(2, '0');
    if (s.elevation <= 0) { by_time.push({ t, shade: 1, sun_az: s.azimuth, sun_el: s.elevation }); continue; }
    const a = (s.azimuth * Math.PI) / 180, e = (s.elevation * Math.PI) / 180;
    const d = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
    let acc = 0;
    for (const c of cells) {
      let trans = 1;
      for (const o of occ) if (hits(o, [c.x, c.y, height], d)) trans *= 1 - (o.opacity ?? 1);
      const sh = 1 - trans;
      c.sum += sh; c.n++; acc += sh;
    }
    const shade = cells.length ? acc / cells.length : 0;
    by_time.push({ t, shade, sun_az: s.azimuth, sun_el: s.elevation });
    tot += acc; totN += cells.length;
  }
  const up = by_time.filter((b) => b.sun_el > 0);
  const worst = up.reduce((w, b) => (!w || b.shade < w.shade ? b : w), null);
  return {
    score: totN ? tot / totN : 0,
    by_time,
    cells: cells.map((c) => ({ x: c.x, y: c.y, shade: c.n ? c.sum / c.n : 1 })),
    worst_time: worst?.t ?? null,
    grid_step: step,
    minutes_step: minutes,
    _client: true,
  };
}
