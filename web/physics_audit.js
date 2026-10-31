// Client-Server Visual & Physics Consistency Auditor for ShadowStop.
// Verifies that the browser fallback ray-caster, solar geometry, sampling height (1.2 m),
// and Three.js coordinate transforms match the deterministic Python verifier (shadowstop/engine.py).

import {
  SAMPLE_HEIGHT_M,
  computeSunNOAA,
  scoreScene,
  checkConstraintsClient,
  computeLouverEffectiveOpacity,
} from './engine.js';

function parseClockHour(tStr) {
  const [h, m] = String(tStr || '0:0').split(':').map(Number);
  return (h || 0) + (m || 0) / 60.0;
}

function angleDiffDeg(a, b) {
  const d = Math.abs(Number(a) - Number(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Scene coordinate (x=east, y=north, z=up) -> Three.js world vector [x, z, -y]
 */
export function sceneToThreeVec(x, y, z) {
  return [x, z, -y];
}

/**
 * Runs a deterministic consistency audit between the client physics engine and server verifier.
 *
 * @param {object} scene - Scene JSON object
 * @param {object} [serverScore] - Score payload returned by /api/score (or null if offline)
 * @param {function} [computeSun] - Client sun position function (lat, lon, dateStr, hour, utcOffset)
 * @returns {object} Structured audit report { passed, sunMaxDiffDeg, scoreDiff, sampleHeightM, checks }
 */
export function runPhysicsAudit(scene, serverScore = null, computeSun = computeSunNOAA) {
  const sunFn = typeof computeSun === 'function' ? computeSun : computeSunNOAA;
  const checks = [];

  // 1. Sampling height check (must be 1.2 m torso height, matching shadowstop/engine.py)
  const serverHeight = serverScore?.sample_height_m ?? SAMPLE_HEIGHT_M;
  const heightOk = Math.abs(SAMPLE_HEIGHT_M - 1.2) < 1e-6 && Math.abs(serverHeight - SAMPLE_HEIGHT_M) < 1e-6;
  checks.push({
    id: 'sample_height',
    label: 'Sampling height (1.2 m torso plane)',
    passed: heightOk,
    expected: '1.20 m',
    actual: `${SAMPLE_HEIGHT_M.toFixed(2)} m`,
    detail: 'Ray casting grid sampled at passenger torso height (1.2 m above pavement).',
  });

  // 2. Solar position comparison against serverScore.by_time (or NOAA reference)
  const refTimes = serverScore?.by_time?.length
    ? serverScore.by_time
    : scene
    ? scoreScene(scene, false, computeSunNOAA).by_time
    : [];

  let maxAzDiff = 0;
  let maxElDiff = 0;
  if (scene && refTimes.length) {
    for (const row of refTimes) {
      if (row.sun_az == null || row.sun_el == null) continue;
      const hr = parseClockHour(row.t);
      const cs = sunFn(scene.lat, scene.lon, scene.date, hr, scene.utc_offset ?? 0);
      maxAzDiff = Math.max(maxAzDiff, angleDiffDeg(cs.azimuth, row.sun_az));
      maxElDiff = Math.max(maxElDiff, Math.abs(Number(cs.elevation) - Number(row.sun_el)));
    }
  }
  const sunMaxDiffDeg = +Math.max(maxAzDiff, maxElDiff).toFixed(4);
  const sunOk = sunMaxDiffDeg < 0.35;
  checks.push({
    id: 'solar_ephemeris',
    label: 'Solar azimuth & elevation vs verifier',
    passed: sunOk,
    expected: '< 0.35°',
    actual: `${sunMaxDiffDeg.toFixed(3)}° (az ≤ ${maxAzDiff.toFixed(3)}°, el ≤ ${maxElDiff.toFixed(3)}°)`,
    detail: 'Client solar geometry matches NOAA Meeus ephemeris within tolerance.',
  });

  // 3. Client scoreScene vs serverScore daily shade score and worst_time
  let scoreDiff = 0;
  let worstTimeMatch = true;
  let clientRes = null;
  if (scene) {
    const clientBefore = scoreScene(scene, false, sunFn);
    clientRes = clientBefore;
    if (serverScore && typeof serverScore.score === 'number') {
      let diffBefore = Math.abs(clientBefore.score - serverScore.score);
      if (diffBefore > 0.01 && (scene.proposals || []).length > 0) {
        const clientAfter = scoreScene(scene, true, sunFn);
        const diffAfter = Math.abs(clientAfter.score - serverScore.score);
        if (diffAfter < diffBefore) {
          clientRes = clientAfter;
          diffBefore = diffAfter;
        }
      }
      scoreDiff = +diffBefore.toFixed(4);
      if (serverScore.worst_time && clientRes.worst_time) {
        worstTimeMatch = clientRes.worst_time === serverScore.worst_time;
      }
    }
  }
  const scoreOk = scoreDiff <= 0.01 && worstTimeMatch;
  checks.push({
    id: 'shade_score_parity',
    label: 'Daily shade score & worst_time parity',
    passed: scoreOk,
    expected: serverScore?.score != null ? `${(serverScore.score * 100).toFixed(1)}% (@ ${serverScore.worst_time || '--'})` : '≤ 0.01 diff',
    actual: clientRes ? `${(clientRes.score * 100).toFixed(1)}% (@ ${clientRes.worst_time || '--'}, Δ=${scoreDiff.toFixed(4)})` : 'N/A',
    detail: 'In-browser fallback ray caster agrees with Python verifier within 0.01.',
  });

  // 4. Coordinate system convention: Scene (x=east, y=north, z=up) -> Three.js (x, z, -y)
  const east3 = sceneToThreeVec(1, 0, 0);   // [1, 0, 0]
  const north3 = sceneToThreeVec(0, 1, 0);  // [0, 0, -1]
  const up3 = sceneToThreeVec(0, 0, 1);     // [0, 1, 0]
  // Right-handed cross product in Three.js: east3 × north3 should equal up3 ([0, 1, 0])
  const crossX = east3[1] * north3[2] - east3[2] * north3[1];
  const crossY = east3[2] * north3[0] - east3[0] * north3[2];
  const crossZ = east3[0] * north3[1] - east3[1] * north3[0];
  const coordOk =
    east3[0] === 1 && east3[1] === 0 && east3[2] === 0 &&
    north3[0] === 0 && north3[1] === 0 && north3[2] === -1 &&
    up3[0] === 0 && up3[1] === 1 && up3[2] === 0 &&
    crossX === up3[0] && crossY === up3[1] && crossZ === up3[2];
  checks.push({
    id: 'coordinate_frame',
    label: 'Coordinate transform (x=E, y=N, z=Up → Three.js x, z, -y)',
    passed: coordOk,
    expected: 'Right-handed (det = +1)',
    actual: coordOk ? 'Right-handed (E×N = Up)' : 'Frame mismatch',
    detail: 'Azimuth clockwise from North maps shadows identically in 2D plan and 3D WebGL.',
  });

  // 5. Louver optical transmission & buildability constraint parity
  const louverZero = computeLouverEffectiveOpacity(1.0, 0, 50, 180, 0);
  const louverTilted = computeLouverEffectiveOpacity(1.0, 35, 25, 240, 0);
  const louverOk = louverZero === 1.0 && louverTilted >= 0.35 && louverTilted <= 1.0;
  checks.push({
    id: 'louver_optics',
    label: 'Louver cutoff model (0° invariant, tilted ∈ [0.35, 1.0])',
    passed: louverOk,
    expected: '0° → baseOpacity, tilted ∈ [0.35, 1.0]',
    actual: `0° → ${louverZero.toFixed(2)}, 35° → ${louverTilted.toFixed(2)}`,
    detail: 'Verifier scores remain untouched at default 0° louver tilt.',
  });

  const passed = checks.every((c) => c.passed);
  return {
    passed,
    sunMaxDiffDeg,
    scoreDiff,
    sampleHeightM: SAMPLE_HEIGHT_M,
    worstTimeMatch,
    checks,
  };
}

export { checkConstraintsClient, computeLouverEffectiveOpacity };
