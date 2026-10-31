// Browser fallback scorer and client-side physics helpers.
// Mirrors shadowstop/sun.py, shadowstop/geometry.py, and shadowstop/engine.py so that
// fallback scores, tree ellipsoids, sampling height (1.2 m), and buildability checks
// match the deterministic Python verifier.

export const SAMPLE_HEIGHT_M = 1.2; // torso height of a waiting passenger (matches shadowstop/engine.py)
export const MIN_GAIN = 0.25;
export const MIN_WORST_TIME_SHADE = 0.4;
export const MAX_CANOPY_AREA_M2 = 24.0;
export const CANOPY_HEIGHT_RANGE = [2.3, 4.5];
export const MAX_TREE_RADIUS = 4.0;

// Exact port of shadowstop/sun.py (Meeus/NOAA equations with atmospheric refraction)
export function computeSunNOAA(lat, lon, dateStr, localHour, utcOffset = 0) {
  const rad = Math.PI / 180.0;
  const deg = 180.0 / Math.PI;
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const totalMin = Math.round(localHour * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = ((totalMin % 60) + 60) % 60;
  const utcMs = Date.UTC(y, mo - 1, d, hh, mm, 0) - (utcOffset ?? 0) * 3600000;
  const jd = utcMs / 86400000.0 + 2440587.5;
  const t = (jd - 2451545.0) / 36525.0;

  const l0 = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360.0) + 360.0) % 360.0;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mr = m * rad;
  const c =
    Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * mr) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * mr) * 0.000289;
  const trueLong = l0 + c;
  const omega = (125.04 - 1934.136 * t) * rad;
  const appLong = (trueLong - 0.00569 - 0.00478 * Math.sin(omega)) * rad;
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * rad;
  const decl = Math.asin(Math.sin(eps) * Math.sin(appLong));

  const yv = Math.tan(eps / 2) ** 2;
  const l0r = l0 * rad;
  const eqTime =
    4 *
    deg *
    (yv * Math.sin(2 * l0r) -
      2 * e * Math.sin(mr) +
      4 * e * yv * Math.sin(mr) * Math.cos(2 * l0r) -
      0.5 * yv * yv * Math.sin(4 * l0r) -
      1.25 * e * e * Math.sin(2 * mr));

  const dt = new Date(utcMs);
  const minutes = dt.getUTCHours() * 60 + dt.getUTCMinutes() + dt.getUTCSeconds() / 60.0;
  const trueSolar = (((minutes + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  let ha = trueSolar / 4 - 180;
  if (ha < -180) ha += 360;
  const har = ha * rad;
  const latr = lat * rad;

  const cosZen = Math.sin(latr) * Math.sin(decl) + Math.cos(latr) * Math.cos(decl) * Math.cos(har);
  const zen = Math.acos(Math.max(-1.0, Math.min(1.0, cosZen))) * deg;
  let elev = 90.0 - zen;
  const az =
    (((Math.atan2(Math.sin(har), Math.cos(har) * Math.sin(latr) - Math.tan(decl) * Math.cos(latr)) * deg + 180.0) %
      360.0) +
      360.0) %
    360.0;

  let refr = 0.0;
  if (elev > 85) {
    refr = 0.0;
  } else if (elev > 5) {
    const te = Math.tan(elev * rad);
    refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  } else if (elev > -0.575) {
    refr = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
  } else {
    refr = -20.772 / Math.tan(elev * rad);
  }
  elev += refr / 3600.0;
  return { azimuth: az, elevation: elev };
}

function cross2D(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointDistToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointInPolyBuffered(x, y, poly, eps = 1e-6) {
  if (pointInPoly(x, y, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (pointDistToSeg(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]) <= eps) return true;
  }
  return false;
}

export function footprint(occ) {
  const shape = occ?.shape || 'box';
  if (shape === 'prism') return occ.footprint || [];
  const [cx, cy] = occ.center || [0, 0];
  if (shape === 'box') {
    const [w, d] = occ.size || [0, 0];
    const a = ((occ.rotation_deg || 0) * Math.PI) / 180.0;
    const ca = Math.cos(a), sa = Math.sin(a);
    return [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(([dx, dy]) => [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca]);
  }
  if (shape === 'cylinder' || shape === 'sphere') {
    const r = occ.radius ?? (shape === 'sphere' ? 1 : 0.2);
    const pts = [];
    for (let k = 0; k < 16; k++) {
      const ang = (2 * Math.PI * k) / 16;
      pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
    }
    return pts;
  }
  return [];
}

function polySignedArea(poly) {
  if (!poly || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return a / 2;
}

function polyArea(poly) {
  return Math.abs(polySignedArea(poly));
}

// Sutherland-Hodgman polygon clipping (clips subjectPoly against convex clipPoly)
function polyIntersectionArea(subjectPoly, clipPoly) {
  if (!subjectPoly?.length || !clipPoly?.length) return 0;
  const clip = polySignedArea(clipPoly) >= 0 ? clipPoly : [...clipPoly].reverse();
  let output = subjectPoly.map((p) => [p[0], p[1]]);
  for (let i = 0; i < clip.length; i++) {
    const [ax, ay] = clip[i];
    const [bx, by] = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    const isInside = (p) => cross2D(bx - ax, by - ay, p[0] - ax, p[1] - ay) >= -1e-9;
    const intersect = (p1, p2) => {
      const dx1 = p2[0] - p1[0], dy1 = p2[1] - p1[1];
      const dx2 = bx - ax, dy2 = by - ay;
      const denom = cross2D(dx1, dy1, dx2, dy2);
      if (Math.abs(denom) < 1e-12) return p1;
      const t = cross2D(ax - p1[0], ay - p1[1], dx2, dy2) / denom;
      return [p1[0] + t * dx1, p1[1] + t * dy1];
    };
    let s = input[input.length - 1];
    for (const e of input) {
      if (isInside(e)) {
        if (!isInside(s)) output.push(intersect(s, e));
        output.push(e);
      } else if (isInside(s)) {
        output.push(intersect(s, e));
      }
      s = e;
    }
  }
  return polyArea(output);
}

export function hits(o, p, d) {
  const z0 = o.z0 ?? 0, z1 = o.z1 ?? z0 + 1;
  if (o.shape === 'sphere') {
    // Exact match to hits_ellipsoid in shadowstop/geometry.py:
    // horizontal radius `radius`, vertical semi-axis (z1 - z0) / 2, centred at (z0 + z1) / 2
    const cx = o.center[0], cy = o.center[1];
    const r = o.radius ?? 1;
    const cz = (z0 + z1) / 2;
    const rz = Math.max((z1 - z0) / 2, 1e-6);
    const s = r / rz; // stretch z so the ellipsoid becomes a sphere of radius r
    const qx = p[0] - cx, qy = p[1] - cy, qz = (p[2] - cz) * s;
    const dvx = d[0], dvy = d[1], dvz = d[2] * s;
    const a = dvx * dvx + dvy * dvy + dvz * dvz;
    if (a < 1e-12) return false;
    const b = 2 * (qx * dvx + qy * dvy + qz * dvz);
    const c = qx * qx + qy * qy + qz * qz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const t2 = (-b + Math.sqrt(disc)) / (2 * a);
    return t2 >= 0;
  }
  // Exact match to hits_prism in shadowstop/geometry.py
  if (d[2] <= 1e-12) return false;
  const tLo = Math.max((z0 - p[2]) / d[2], 0.0);
  const tHi = (z1 - p[2]) / d[2];
  if (tHi <= tLo) return false;
  const poly = footprint(o);
  if (!poly.length) return false;
  const ax = p[0] + tLo * d[0], ay = p[1] + tLo * d[1];
  const bx = p[0] + tHi * d[0], by = p[1] + tHi * d[1];
  if (pointInPoly(ax, ay, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    const [cx, cy] = poly[i];
    const [ex, ey] = poly[(i + 1) % poly.length];
    const o1 = cross2D(ex - cx, ey - cy, ax - cx, ay - cy);
    const o2 = cross2D(ex - cx, ey - cy, bx - cx, by - cy);
    const o3 = cross2D(bx - ax, by - ay, cx - ax, cy - ay);
    const o4 = cross2D(bx - ax, by - ay, ex - ax, ey - ay);
    if (o1 * o2 <= 0 && o3 * o4 <= 0) return true;
  }
  return false;
}

/**
 * Computes physically grounded effective direct-beam opacity for an articulated louvered canopy
 * when the user tilts the louvers (`louverAngleDeg` in `[-45, 45]`).
 * At `louverAngleDeg === 0`, returns `baseOpacity` untouched so verifier scores are unchanged.
 */
export function computeLouverEffectiveOpacity(baseOpacity, louverAngleDeg, sunElDeg, sunAzDeg, canopyRotDeg = 0) {
  const base = Math.max(0, Math.min(1, Number(baseOpacity ?? 1.0)));
  if (!louverAngleDeg || Math.abs(louverAngleDeg) < 1e-6) {
    return base;
  }
  const tilt = Math.max(-45, Math.min(45, Number(louverAngleDeg)));
  const rad = Math.PI / 180.0;
  const el = Math.max(0, Math.min(90, Number(sunElDeg ?? 45)));
  const relAz = (Number(sunAzDeg ?? 180) - Number(canopyRotDeg ?? 0)) * rad;
  const horizProj = Math.max(0.15, Math.cos(el * rad) * Math.abs(Math.cos(relAz)));
  const profileAngleDeg = Math.atan2(Math.sin(el * rad), horizProj) / rad;
  const cutoffRatio = Math.max(0, Math.cos((profileAngleDeg - tilt) * rad));
  const modulated = base * (0.35 + 0.65 * cutoffRatio);
  return +Math.max(0.35, Math.min(1.0, modulated)).toFixed(4);
}

/**
 * Client-side mirror of shadowstop/engine.py's check_constraints(scene, proposal).
 * Returns { ok, reasons, areaM2, clearanceM }.
 */
export function checkConstraintsClient(scene, proposal) {
  const errs = [];
  const kind = proposal?.kind;
  const clearanceM = proposal?.z0 ?? 0;
  if (kind !== 'canopy' && kind !== 'tree') {
    errs.push(`kind must be canopy or tree, got ${JSON.stringify(kind)}`);
    return { ok: false, reasons: errs, areaM2: 0, clearanceM };
  }
  let base = [];
  let areaM2 = 0;
  if (proposal.shape === 'sphere') {
    const r = proposal.radius ?? 0;
    areaM2 = +(Math.PI * r * r).toFixed(2);
    if (r > MAX_TREE_RADIUS) {
      errs.push(`tree crown radius ${r} m exceeds ${MAX_TREE_RADIUS} m`);
    }
    const [cx, cy] = proposal.center || [0, 0];
    base = [
      [cx + 0.3, cy],
      [cx, cy + 0.3],
      [cx - 0.3, cy],
      [cx, cy - 0.3],
    ];
  } else {
    const plan = footprint(proposal);
    base = plan;
    const rawArea = polyArea(plan);
    areaM2 = +rawArea.toFixed(2);
    if (rawArea > MAX_CANOPY_AREA_M2) {
      errs.push(`canopy area ${rawArea.toFixed(1)} m2 exceeds ${MAX_CANOPY_AREA_M2} m2`);
    }
    const [lo, hi] = CANOPY_HEIGHT_RANGE;
    if (!(lo <= clearanceM && clearanceM <= hi)) {
      errs.push(`canopy underside at ${proposal.z0} m; must be between ${lo} and ${hi} m (headroom / bus clearance)`);
    }
  }

  if (scene?.buildable_area?.length && base.length) {
    const zone = scene.buildable_area;
    let insideZone = true;
    for (let i = 0; i < base.length; i++) {
      const [vx, vy] = base[i];
      const [nx, ny] = base[(i + 1) % base.length];
      if (!pointInPolyBuffered(vx, vy, zone, 1e-6) || !pointInPolyBuffered((vx + nx) / 2, (vy + ny) / 2, zone, 1e-6)) {
        insideZone = false;
        break;
      }
    }
    if (!insideZone) {
      errs.push('outside the buildable area (would sit over the carriageway or private land)');
    }
  }

  for (const occ of scene?.occluders || []) {
    if (occ.kind === 'building') {
      const bldgFp = occ.shape === 'prism' ? occ.footprint : footprint(occ);
      if (bldgFp?.length && polyIntersectionArea(bldgFp, base) > 0.01) {
        errs.push(`collides with ${occ.id || 'a building'}`);
      }
    }
  }

  return {
    ok: errs.length === 0,
    reasons: errs,
    areaM2,
    clearanceM,
  };
}

export function scoreScene(
  scene,
  includeProposals = false,
  computeSun = computeSunNOAA,
  { step = 0.5, minutes = 15, height = SAMPLE_HEIGHT_M } = {}
) {
  const sunFn = typeof computeSun === 'function' ? computeSun : computeSunNOAA;
  const occ = [...(scene.occluders || []), ...(includeProposals ? scene.proposals || [] : [])];
  const wa = scene.waiting_area || [];
  const xs = wa.map((p) => p[0]), ys = wa.map((p) => p[1]);
  const cells = [];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let y = minY + step / 2; y < maxY; y += step) {
      if (pointInPoly(x, y, wa)) {
        cells.push({ x: +x.toFixed(3), y: +y.toFixed(3), sum: 0, n: 0 });
      }
    }
  }
  if (!cells.length && wa.length) {
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    cells.push({ x: +cx.toFixed(3), y: +cy.toFixed(3), sum: 0, n: 0 });
  }

  const [h0, h1] = scene.hours || [9, 18];
  const by_time = [];
  let nSun = 0;

  for (let m = h0 * 60; m <= h1 * 60 + 1e-6; m += minutes) {
    const hour = m / 60;
    const s = sunFn(scene.lat, scene.lon, scene.date, hour, scene.utc_offset ?? 0);
    const t = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.round(m % 60)).padStart(2, '0');
    const sunAz = +Number(s.azimuth).toFixed(2);
    const sunEl = +Number(s.elevation).toFixed(2);
    if (s.elevation <= 0) {
      by_time.push({ t, sun_az: sunAz, sun_el: sunEl, shade: null });
      continue;
    }
    const a = (s.azimuth * Math.PI) / 180.0;
    const e = (s.elevation * Math.PI) / 180.0;
    const d = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
    let acc = 0;
    for (const c of cells) {
      let trans = 1.0;
      for (const o of occ) {
        if (hits(o, [c.x, c.y, height], d)) {
          const tilt = o.louver_angle_deg ?? o.louverAngleDeg ?? 0;
          const effOpacity = tilt
            ? computeLouverEffectiveOpacity(o.opacity ?? 1.0, tilt, s.elevation, s.azimuth, o.rotation_deg ?? 0)
            : Number(o.opacity ?? 1.0);
          trans *= 1.0 - effOpacity;
        }
      }
      const sh = 1.0 - trans;
      c.sum += sh;
      c.n++;
      acc += sh;
    }
    const shade = cells.length ? +(acc / cells.length).toFixed(4) : 0;
    by_time.push({ t, sun_az: sunAz, sun_el: sunEl, shade });
    nSun++;
  }

  const sunRows = by_time.filter((b) => b.shade !== null && b.sun_el > 0);
  const total = sunRows.length ? sunRows.reduce((s, r) => s + r.shade, 0) / sunRows.length : 0.0;
  const worst = sunRows.reduce((w, b) => (!w || b.shade < w.shade ? b : w), null);
  const denom = Math.max(nSun, 1);

  return {
    score: +total.toFixed(4),
    by_time,
    cells: cells.map((c) => ({
      x: +c.x.toFixed(2),
      y: +c.y.toFixed(2),
      shade: +(c.sum / denom).toFixed(4),
    })),
    worst_time: worst?.t ?? null,
    worst_time_shade: worst?.shade ?? null,
    worst_time_sun: worst ? { azimuth: worst.sun_az, elevation: worst.sun_el } : null,
    grid_step: step,
    minutes_step: minutes,
    sample_height_m: height,
    _client: true,
  };
}
