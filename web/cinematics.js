// ShadowStop cinematic camera & reveal director (6-phase deterministic hero journey).
// Golden rule: all shade percentages and metrics displayed during the sequence are read
// strictly from the deterministic engine state (state.before / state.after), never fabricated.
import * as THREE from 'three';

const TOTAL_PHASES = 6;
const SEQUENCE_DURATION_S = 32.0;

// Phase timing table (seconds from sequence start)
export const HERO_PHASES = [
  {
    phase: 1,
    id: 'discovery',
    t0: 0.0,
    t1: 5.0,
    tag: 'PHASE 1 · AUTONOMOUS DISCOVERY',
    title: 'Finding the hottest places to wait in London',
    subtitle: 'Scanning OpenStreetMap bus stops & solar exposure across Hackney (July heatwave window 09:00–18:00 BST)',
  },
  {
    phase: 2,
    id: 'reconstruction',
    t0: 5.0,
    t1: 10.0,
    tag: 'PHASE 2 · 3D SITE RECONSTRUCTION',
    title: 'Real stop rebuilt in 3D: OSM geometry + Argon street vision',
    subtitle: 'OSM tags say shelter=yes, but Argon identifies a clear polycarbonate roof offering almost no direct shade.',
  },
  {
    phase: 3,
    id: 'diagnosis',
    t0: 10.0,
    t1: 16.5,
    tag: 'PHASE 3 · SOLAR EXPOSURE DIAGNOSIS',
    title: 'Direct shade across waiting area: unshaded through peak heat',
    subtitle: 'Sweeping solar vector from 09:00 to 18:00 BST (1.2 m torso height ray-cast)',
  },
  {
    phase: 4,
    id: 'intervention',
    t0: 16.5,
    t1: 23.5,
    tag: 'PHASE 4 · VERIFIED ARCHITECTURAL INTERVENTION',
    title: 'Gemini 4 Argon designs · Deterministic engine verifies',
    subtitle: 'Installing verified canopy: steel supports rise, cantilevered frame extends, solar louvers lock',
  },
  {
    phase: 5,
    id: 'comparison',
    t0: 23.5,
    t1: 29.5,
    tag: 'PHASE 5 · VERIFIED BEFORE / AFTER PROOF',
    title: 'Same sun, same afternoon — verified shade transformation',
    subtitle: 'Every percentage point ray-cast across waiting-area grid cells at 15-minute intervals',
  },
  {
    phase: 6,
    id: 'handoff',
    t0: 29.5,
    t1: 32.0,
    tag: 'PHASE 6 · LIVE INTERACTIVE VERIFIER',
    title: 'Try to break the design: move the sun or adjust louvers',
    subtitle: 'Drag the time slider, tilt the louvers, or ask Argon to redesign under a new budget.',
  },
];

// ---------------------------------------------------------------- math & easing helpers
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

function easeInOutCubic(t) {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function easeOutCubic(t) {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

function easeInOutQuint(t) {
  const x = clamp01(t);
  return x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2;
}

function toVec3(v, fallback = [0, 0, 0]) {
  if (v instanceof THREE.Vector3) return v.clone();
  if (Array.isArray(v) && v.length >= 3) return new THREE.Vector3(Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0);
  if (v && typeof v === 'object' && 'x' in v && 'y' in v && 'z' in v) {
    return new THREE.Vector3(Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- real engine metric helpers
function scoreOf(s) {
  if (s == null) return null;
  if (typeof s === 'number') return isFinite(s) ? s : null;
  return typeof s.score === 'number' && isFinite(s.score) ? s.score : null;
}

function pct(v) {
  return v == null || !isFinite(v) ? '--' : Math.round(v * 100) + '%';
}

function fmtClock(h) {
  const totalMin = Math.round((Number(h) || 0) * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = ((totalMin % 60) + 60) % 60;
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

function parseClock(t) {
  if (typeof t === 'number') return t;
  if (!t) return NaN;
  const [h, m] = String(t).split(':').map(Number);
  return h + (m || 0) / 60;
}

function shadeAtHour(scoreObj, hour) {
  if (!scoreObj?.by_time?.length || hour == null || !isFinite(hour)) return null;
  let best = null;
  let bestDist = 1e9;
  for (const entry of scoreObj.by_time) {
    const d = Math.abs(parseClock(entry.t) - hour);
    if (d < bestDist) {
      bestDist = d;
      best = entry;
    }
  }
  return bestDist <= 0.35 && best && isFinite(best.shade) ? best.shade : null;
}

function resolveAfternoonCounterexampleHour(state) {
  const wt = parseClock(state?.before?.worst_time);
  // If engine's worst_time is in the afternoon window where canopy shadow lands across waiting zone, use it;
  // otherwise use 15:00 BST (peak afternoon thermal stress) while still reporting exact engine metrics.
  if (isFinite(wt) && wt >= 12.5 && wt <= 17.25) return wt;
  return 15.0;
}

function buildPhaseMetrics(phaseNum, state, subInfo = {}) {
  const beforeDaily = scoreOf(state?.before);
  const afterDaily = scoreOf(state?.after) ?? scoreOf(state?.accepted?.score_after);
  const hour = state?.hour ?? 13.5;
  const beforeNow = shadeAtHour(state?.before, hour);
  const afterNow = shadeAtHour(state?.after, hour);
  const worstTime = state?.before?.worst_time || null;

  switch (phaseNum) {
    case 1: {
      return {
        metricLabel: 'Baseline waiting-area shade (09:00–18:00)',
        metricValue: beforeDaily != null
          ? `${pct(beforeDaily)} mean shade${worstTime ? ` · worst ${worstTime}` : ''}`
          : 'Scanning Hackney stops…',
      };
    }
    case 2: {
      return {
        metricLabel: 'Existing shelter direct shade',
        metricValue: beforeDaily != null
          ? `${pct(beforeDaily)} daily mean (${pct(beforeNow ?? beforeDaily)} at ${fmtClock(hour)})`
          : 'Evaluating 3D occluders…',
      };
    }
    case 3: {
      const nowVal = beforeNow ?? beforeDaily;
      return {
        metricLabel: `Waiting area in direct shade (${fmtClock(hour)} BST)`,
        metricValue: nowVal != null
          ? `${pct(nowVal)} shaded${beforeDaily != null ? ` · ${pct(beforeDaily)} day avg` : ''}${worstTime ? ` · low at ${worstTime}` : ''}`
          : 'Ray-casting solar sweep…',
      };
    }
    case 4: {
      const cost = state?.accepted?.cost_gbp;
      const costStr = cost != null && isFinite(cost) ? ` · £${Number(cost).toLocaleString('en-GB')} indicative` : '';
      return {
        metricLabel: subInfo.stageLabel || 'Verified canopy intervention',
        metricValue: beforeDaily != null && afterDaily != null
          ? `${pct(beforeDaily)} → ${pct(afterDaily)} daily shade${costStr}`
          : afterDaily != null
            ? `${pct(afterDaily)} verified shade${costStr}`
            : 'Constructing verified canopy…',
      };
    }
    case 5: {
      const bVal = beforeNow ?? beforeDaily;
      const aVal = afterNow ?? afterDaily;
      const deltaPts = bVal != null && aVal != null ? Math.round((aVal - bVal) * 100) : null;
      const deltaStr = deltaPts != null ? ` (${deltaPts >= 0 ? '+' : ''}${deltaPts} pts)` : '';
      return {
        metricLabel: `Verified comparison at ${fmtClock(hour)} BST (${(state?.mode || 'after').toUpperCase()})`,
        metricValue: bVal != null && aVal != null
          ? `Before ${pct(bVal)} → After ${pct(aVal)}${deltaStr}`
          : beforeDaily != null && afterDaily != null
            ? `Before ${pct(beforeDaily)} → After ${pct(afterDaily)}`
            : '--',
      };
    }
    case 6:
    default: {
      const bVal = beforeDaily;
      const aVal = afterDaily;
      const deltaPts = bVal != null && aVal != null ? Math.round((aVal - bVal) * 100) : null;
      return {
        metricLabel: 'Live deterministic verifier active',
        metricValue: bVal != null && aVal != null
          ? `${pct(bVal)} → ${pct(aVal)} (${deltaPts >= 0 ? '+' : ''}${deltaPts} pts) · ${fmtClock(hour)} BST`
          : `Sun at ${fmtClock(hour)} BST`,
      };
    }
  }
}

// ---------------------------------------------------------------- camera spline definitions
// All coordinates are Three.js world space: [x (east), y (height up), z (south = -north)].
// Carefully routed along the southern/eastern street corridor to avoid clipping northern (z: -16..-4)
// or southern (x: -18..-4, z: 14..26) buildings.
const P1_START_POS = new THREE.Vector3(0, 82, 66);
const P1_END_POS = new THREE.Vector3(0, 78, 62);
const P1_TARGET = new THREE.Vector3(0, 0, 0);

const P2_CURVE = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 78, 62),
  new THREE.Vector3(5.8, 38, 37),
  new THREE.Vector3(10.6, 11.2, 19.5),
  new THREE.Vector3(9.5, 2.8, 11.5),
], false, 'centripetal', 0.5);
const P2_START_TARGET = new THREE.Vector3(0, 0, 0);
const P2_END_TARGET = new THREE.Vector3(0, 1.3, -0.3);

const P3_START_POS = new THREE.Vector3(9.5, 2.8, 11.5);
const P3_END_POS = new THREE.Vector3(7.5, 3.6, 10.5);
const P3_START_TARGET = new THREE.Vector3(0, 1.3, -0.3);
const P3_END_TARGET = new THREE.Vector3(0, 1.3, -0.4);

const P4_ORBIT_CURVE = new THREE.CatmullRomCurve3([
  new THREE.Vector3(7.5, 3.6, 10.5),
  new THREE.Vector3(0.4, 4.1, 12.2),
  new THREE.Vector3(-8.5, 3.8, 10.0),
  new THREE.Vector3(-4.5, 3.2, 11.5),
], false, 'centripetal', 0.5);
const P4_TARGET_CURVE = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 1.3, -0.4),
  new THREE.Vector3(0, 1.65, -0.45),
  new THREE.Vector3(0, 1.45, -0.45),
  new THREE.Vector3(0, 1.25, -0.4),
], false, 'centripetal', 0.5);

const P5_START_POS = new THREE.Vector3(-4.5, 3.2, 11.5);
const P5_HOLD_POS = new THREE.Vector3(-4.5, 3.4, 11.2);
const P5_TARGET = new THREE.Vector3(0, 1.2, -0.4);

const P6_START_POS = new THREE.Vector3(-4.5, 3.4, 11.2);
const P6_END_POS = new THREE.Vector3(8.5, 5.5, 13.5);
const P6_START_TARGET = new THREE.Vector3(0, 1.2, -0.4);
const P6_END_TARGET = new THREE.Vector3(0, 1.2, -0.5);

// ---------------------------------------------------------------- controller factory
export function createDemoController(ctx = {}) {
  const {
    camera,
    controls,
    scene3,
    getState = () => ({}),
  } = ctx;

  // Internal state
  let mode = 'idle'; // 'idle' | 'sequence' | 'install_only' | 'fly_to'
  let seqStartMs = 0;
  let seqPausedAtOffsetMs = null;
  let lastPhaseNumber = 0;
  let lastTickMs = -1;
  let rafId = null;

  // Standalone install animation state
  let installAnim = null; // { startMs, durationMs, resolve }
  // Standalone camera flight state
  let flyAnim = null; // { startMs, durationMs, fromPos, toPos, fromTarget, toTarget, resolve }

  // Track phase-5 mode switches so we don't thrash DOM needlessly on every frame
  let lastAppliedMode = null;
  let lastAppliedHeat = null;
  let lastAppliedHour = null;

  const tmpPos = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();

  function safeSetMode(m, force = false) {
    if (!force && lastAppliedMode === m) return;
    lastAppliedMode = m;
    try { ctx.setMode?.(m); } catch (e) { console.warn('cinematics setMode error:', e); }
  }

  function safeSetHeat(on, force = false) {
    if (!force && lastAppliedHeat === on) return;
    lastAppliedHeat = on;
    try { ctx.setHeat?.(on); } catch (e) { console.warn('cinematics setHeat error:', e); }
  }

  function safeSetHour(h, force = false) {
    const rounded = Math.round(h * 60) / 60;
    if (!force && lastAppliedHour !== null && Math.abs(lastAppliedHour - rounded) < 1e-4) return;
    lastAppliedHour = rounded;
    try { ctx.setHour?.(rounded); } catch (e) { console.warn('cinematics setHour error:', e); }
  }

  // Fallback 3D install animation if ctx.setInstallProgress is not provided by host
  function applyInstallProgress(progress, louverDeg = 0) {
    const p = clamp01(progress);
    if (typeof ctx.setInstallProgress === 'function') {
      try {
        ctx.setInstallProgress(p, louverDeg);
      } catch (e) {
        console.warn('cinematics setInstallProgress error:', e);
      }
      return;
    }
    // Fallback: animate any proposal meshes inside scene3
    if (!scene3) return;
    scene3.traverse((obj) => {
      if (obj.userData?.occ && (obj.userData.occ.source === 'proposal' || obj.userData.occ.kind === 'canopy')) {
        const ease = easeOutCubic(p);
        obj.scale.set(ease, Math.max(0.01, ease), ease);
        obj.visible = p > 0.01;
      }
    });
  }

  function applyCameraPose(posVec3, targetVec3) {
    if (!camera) return;
    camera.position.copy(posVec3);
    if (controls) {
      const prevDamping = controls.enableDamping;
      controls.enableDamping = false;
      controls.target.copy(targetVec3);
      camera.lookAt(targetVec3);
      controls.update();
      controls.enableDamping = prevDamping;
    } else {
      camera.lookAt(targetVec3);
    }
  }

  function setControlsInteractive(enabled) {
    if (!controls) return;
    if (enabled) {
      const prevDamping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = prevDamping;
      controls.enabled = true;
    } else {
      controls.enabled = false;
    }
  }

  function emitPhaseChange(payload) {
    try {
      ctx.onPhaseChange?.(payload);
    } catch (e) {
      console.warn('cinematics onPhaseChange error:', e);
    }
  }

  function cancelInternalRaf() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function ensureInternalRaf() {
    if (rafId != null) return;
    const loop = (now) => {
      rafId = null;
      tick(now);
      if (mode !== 'idle') {
        rafId = requestAnimationFrame(loop);
      }
    };
    rafId = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- phase execution
  function findPhaseDef(elapsedS) {
    for (let i = 0; i < HERO_PHASES.length; i++) {
      const p = HERO_PHASES[i];
      if (elapsedS < p.t1 || i === HERO_PHASES.length - 1) return p;
    }
    return HERO_PHASES[HERO_PHASES.length - 1];
  }

  function enterPhase(phaseNum, state) {
    lastPhaseNumber = phaseNum;
    if (phaseNum === 1) {
      safeSetMode('before', true);
      safeSetHeat(true, true);
      safeSetHour(13.5, true);
      applyInstallProgress(0.0, -35);

      const lat = state?.scene?.lat ?? 51.545;
      const lon = state?.scene?.lon ?? -0.0553;
      try {
        Promise.resolve(ctx.focusMapOnStop?.(lat, lon)).catch((e) => console.warn('focusMapOnStop failed:', e));
      } catch (e) {
        console.warn('focusMapOnStop error:', e);
      }
      try {
        Promise.resolve(ctx.ensureHeroSceneLoaded?.()).catch((e) => console.warn('ensureHeroSceneLoaded failed:', e));
      } catch (e) {
        console.warn('ensureHeroSceneLoaded error:', e);
      }
    } else if (phaseNum === 2) {
      safeSetMode('before', true);
      safeSetHeat(true, true);
      safeSetHour(13.5, true);
    } else if (phaseNum === 3) {
      safeSetMode('before', true);
      safeSetHeat(true, true);
    } else if (phaseNum === 4) {
      const targetHour = resolveAfternoonCounterexampleHour(state);
      safeSetHour(targetHour, true);
      safeSetMode('after', true);
      safeSetHeat(true, true);
      applyInstallProgress(0.0, -35);
    } else if (phaseNum === 5) {
      applyInstallProgress(1.0, 0);
      safeSetHeat(true, true);
    } else if (phaseNum === 6) {
      safeSetMode('after', true);
      safeSetHeat(true, true);
      applyInstallProgress(1.0, 0);
      safeSetHour(15.0, true);
    }
  }

  function updateSequenceAt(elapsedS) {
    const state = getState() || {};
    const reduced = prefersReducedMotion();
    const clampedS = Math.max(0, Math.min(SEQUENCE_DURATION_S, elapsedS));
    const overallProgress = clamp01(clampedS / SEQUENCE_DURATION_S);
    const phaseDef = findPhaseDef(clampedS);
    const phaseSpan = Math.max(0.001, phaseDef.t1 - phaseDef.t0);
    const localP = clamp01((clampedS - phaseDef.t0) / phaseSpan);

    if (phaseDef.phase !== lastPhaseNumber) {
      enterPhase(phaseDef.phase, state);
    }

    let subInfo = {};

    switch (phaseDef.phase) {
      case 1: {
        // Phase 1 (0.0s - 5.0s): Bird's-eye overview at [0, 78, 62] targeting [0, 0, 0]
        if (reduced) {
          applyCameraPose(P1_END_POS, P1_TARGET);
        } else {
          const e = easeOutCubic(localP);
          tmpPos.lerpVectors(P1_START_POS, P1_END_POS, e);
          applyCameraPose(tmpPos, P1_TARGET);
        }
        break;
      }

      case 2: {
        // Phase 2 (5.0s - 10.0s): Swoop from [0, 78, 62] to [9.5, 2.8, 11.5] looking at [0, 1.3, -0.3]
        if (reduced) {
          applyCameraPose(P3_START_POS, P2_END_TARGET);
        } else {
          const e = easeInOutQuint(localP);
          P2_CURVE.getPoint(e, tmpPos);
          tmpTarget.lerpVectors(P2_START_TARGET, P2_END_TARGET, easeInOutCubic(localP));
          applyCameraPose(tmpPos, tmpTarget);
        }
        break;
      }

      case 3: {
        // Phase 3 (10.0s - 16.5s): Glide [9.5, 2.8, 11.5] -> [7.5, 3.6, 10.5];
        // sweep sun 09:00 -> 18:00 then settle on worst afternoon sun hour (15:00 or state.before.worst_time)
        if (reduced) {
          applyCameraPose(P3_END_POS, P3_END_TARGET);
        } else {
          const e = easeInOutCubic(localP);
          tmpPos.lerpVectors(P3_START_POS, P3_END_POS, e);
          tmpTarget.lerpVectors(P3_START_TARGET, P3_END_TARGET, e);
          applyCameraPose(tmpPos, tmpTarget);
        }

        const settleHour = resolveAfternoonCounterexampleHour(state);
        let h;
        if (localP < 0.72) {
          const sweepP = easeInOutCubic(localP / 0.72);
          h = lerp(9.0, 18.0, sweepP);
        } else {
          const settleP = easeInOutCubic((localP - 0.72) / 0.28);
          h = lerp(18.0, settleHour, settleP);
        }
        safeSetHour(h);
        break;
      }

      case 4: {
        // Phase 4 (16.5s - 23.5s): 7.0s total.
        // Canopy installs over 5.5s (elapsedInPhase 0 -> 5.5s), then holds 1.5s so shadow is admired.
        const elapsedInPhase = clampedS - phaseDef.t0;
        const rawInstallP = clamp01(elapsedInPhase / 5.5);
        const easedInstallP = reduced ? (rawInstallP > 0.15 ? 1.0 : rawInstallP) : easeInOutCubic(rawInstallP);

        // Louver tilt animates from -36 deg to 0 deg during final assembly phase (0.60 -> 1.00)
        const louverP = clamp01((easedInstallP - 0.60) / 0.40);
        const louverDeg = lerp(-36, 0, easeOutCubic(louverP));

        safeSetMode('after');
        applyInstallProgress(easedInstallP, louverDeg);

        if (easedInstallP < 0.34) {
          subInfo.stageLabel = 'Stage 1/3 · Steel support columns rising';
        } else if (easedInstallP < 0.68) {
          subInfo.stageLabel = 'Stage 2/3 · Cantilevered roof frame extending';
        } else if (easedInstallP < 0.99) {
          subInfo.stageLabel = 'Stage 3/3 · Solar louvers locking to sun vector';
        } else {
          subInfo.stageLabel = 'Verified canopy locked · Shadow cast on waiting zone';
        }

        if (reduced) {
          applyCameraPose(P5_START_POS, P5_TARGET);
        } else {
          const orbitE = easeInOutCubic(localP);
          P4_ORBIT_CURVE.getPoint(orbitE, tmpPos);
          P4_TARGET_CURVE.getPoint(orbitE, tmpTarget);
          applyCameraPose(tmpPos, tmpTarget);
        }
        break;
      }

      case 5: {
        // Phase 5 (23.5s - 29.5s): Comparator camera [-4.5, 3.4, 11.2],
        // deliberate BEFORE -> AFTER pulse + afternoon sun sweep (11:00 -> 17:00)
        applyInstallProgress(1.0, 0);
        if (reduced) {
          applyCameraPose(P5_HOLD_POS, P5_TARGET);
        } else {
          const camE = easeOutCubic(clamp01(localP / 0.25));
          tmpPos.lerpVectors(P5_START_POS, P5_HOLD_POS, camE);
          applyCameraPose(tmpPos, P5_TARGET);
        }

        if (localP < 0.22) {
          // Hold BEFORE at 14:30 so audience sees exposed red waiting zone
          safeSetMode('before');
          safeSetHour(14.5);
        } else if (localP < 0.44) {
          // Flip to AFTER at same 14:30 hour for unmistakable side-by-side shadow proof
          safeSetMode('after');
          safeSetHour(14.5);
        } else if (localP < 0.88) {
          // Sweep sun 11:00 -> 17:00 in AFTER mode
          safeSetMode('after');
          const sweepP = easeInOutCubic((localP - 0.44) / 0.44);
          safeSetHour(lerp(11.0, 17.0, sweepP));
        } else {
          // Settle at 15:00 in AFTER mode
          safeSetMode('after');
          const settleP = easeOutCubic((localP - 0.88) / 0.12);
          safeSetHour(lerp(17.0, 15.0, settleP));
        }
        break;
      }

      case 6: {
        // Phase 6 (29.5s - 32.0s): Ease to interactive orbit [8.5, 5.5, 13.5] targeting [0, 1.2, -0.5]
        safeSetMode('after');
        applyInstallProgress(1.0, 0);
        if (reduced) {
          applyCameraPose(P6_END_POS, P6_END_TARGET);
        } else {
          const e = easeInOutCubic(localP);
          tmpPos.lerpVectors(P6_START_POS, P6_END_POS, e);
          tmpTarget.lerpVectors(P6_START_TARGET, P6_END_TARGET, e);
          applyCameraPose(tmpPos, tmpTarget);
        }
        break;
      }
    }

    const metrics = buildPhaseMetrics(phaseDef.phase, state, subInfo);
    const isFinished = clampedS >= SEQUENCE_DURATION_S - 1e-4;

    if (isFinished) {
      mode = 'idle';
      setControlsInteractive(true);
      emitPhaseChange({
        phase: 6,
        totalPhases: TOTAL_PHASES,
        id: 'handoff',
        tag: phaseDef.tag,
        title: phaseDef.title,
        subtitle: phaseDef.subtitle,
        metricLabel: metrics.metricLabel,
        metricValue: metrics.metricValue,
        progress: 1,
        phaseProgress: 1,
        active: false,
        completed: true,
        skipped: false,
        reducedMotion: reduced,
      });
    } else {
      emitPhaseChange({
        phase: phaseDef.phase,
        totalPhases: TOTAL_PHASES,
        id: phaseDef.id,
        tag: phaseDef.tag,
        title: phaseDef.title,
        subtitle: phaseDef.subtitle,
        metricLabel: metrics.metricLabel,
        metricValue: metrics.metricValue,
        progress: overallProgress,
        phaseProgress: localP,
        active: true,
        completed: false,
        skipped: false,
        reducedMotion: reduced,
      });
    }
  }

  // ---------------------------------------------------------------- public API methods
  function start() {
    // Cancel any standalone animations
    if (installAnim?.resolve) installAnim.resolve(false);
    installAnim = null;
    if (flyAnim?.resolve) flyAnim.resolve(false);
    flyAnim = null;

    lastAppliedMode = null;
    lastAppliedHeat = null;
    lastAppliedHour = null;
    lastPhaseNumber = 0;
    lastTickMs = -1;
    seqPausedAtOffsetMs = null;
    seqStartMs = performance.now();
    mode = 'sequence';

    setControlsInteractive(false);
    updateSequenceAt(0);
    ensureInternalRaf();
    return controller;
  }

  function skipToInteractive() {
    cancelInternalRaf();
    if (installAnim?.resolve) installAnim.resolve(false);
    installAnim = null;
    if (flyAnim?.resolve) flyAnim.resolve(false);
    flyAnim = null;

    mode = 'idle';
    seqPausedAtOffsetMs = null;

    safeSetMode('after', true);
    safeSetHeat(true, true);
    applyInstallProgress(1.0, 0);

    const state = getState() || {};
    const targetHour = resolveAfternoonCounterexampleHour(state);
    safeSetHour(targetHour, true);

    applyCameraPose(P6_END_POS, P6_END_TARGET);
    setControlsInteractive(true);

    const handoffDef = HERO_PHASES[HERO_PHASES.length - 1];
    const metrics = buildPhaseMetrics(6, getState() || {});
    emitPhaseChange({
      phase: 6,
      totalPhases: TOTAL_PHASES,
      id: handoffDef.id,
      tag: handoffDef.tag,
      title: handoffDef.title,
      subtitle: handoffDef.subtitle,
      metricLabel: metrics.metricLabel,
      metricValue: metrics.metricValue,
      progress: 1,
      phaseProgress: 1,
      active: false,
      completed: true,
      skipped: true,
      reducedMotion: prefersReducedMotion(),
    });
    return controller;
  }

  // Alias stop() to skipToInteractive() as required by specification
  function stop() {
    return skipToInteractive();
  }

  function reset() {
    cancelInternalRaf();
    if (installAnim?.resolve) installAnim.resolve(false);
    installAnim = null;
    if (flyAnim?.resolve) flyAnim.resolve(false);
    flyAnim = null;

    mode = 'idle';
    lastPhaseNumber = 0;
    seqPausedAtOffsetMs = null;

    safeSetMode('before', true);
    safeSetHeat(true, true);
    safeSetHour(12.0, true);
    applyInstallProgress(0.0, 0);
    applyCameraPose(P1_END_POS, P1_TARGET);
    setControlsInteractive(true);

    const p1 = HERO_PHASES[0];
    const metrics = buildPhaseMetrics(1, getState() || {});
    emitPhaseChange({
      phase: 1,
      totalPhases: TOTAL_PHASES,
      id: p1.id,
      tag: p1.tag,
      title: p1.title,
      subtitle: p1.subtitle,
      metricLabel: metrics.metricLabel,
      metricValue: metrics.metricValue,
      progress: 0,
      phaseProgress: 0,
      active: false,
      completed: false,
      skipped: false,
      reducedMotion: prefersReducedMotion(),
    });
    return controller;
  }

  function jumpToPhase(phaseNumber) {
    const idx = Math.max(1, Math.min(TOTAL_PHASES, Number(phaseNumber) || 1)) - 1;
    const targetDef = HERO_PHASES[idx];
    lastAppliedMode = null;
    lastAppliedHeat = null;
    lastAppliedHour = null;
    lastPhaseNumber = 0;
    seqPausedAtOffsetMs = null;
    seqStartMs = performance.now() - targetDef.t0 * 1000;
    mode = 'sequence';
    setControlsInteractive(false);
    updateSequenceAt(targetDef.t0);
    ensureInternalRaf();
    return controller;
  }

  function pause() {
    if (mode === 'sequence' && seqPausedAtOffsetMs == null) {
      seqPausedAtOffsetMs = performance.now() - seqStartMs;
      setControlsInteractive(true);
    }
    return controller;
  }

  function resume() {
    if (mode === 'sequence' && seqPausedAtOffsetMs != null) {
      seqStartMs = performance.now() - seqPausedAtOffsetMs;
      seqPausedAtOffsetMs = null;
      setControlsInteractive(false);
      ensureInternalRaf();
    }
    return controller;
  }

  function playInstallAnimationOnly(durationMs = 3200) {
    if (mode === 'sequence') {
      // End sequence cleanly before running standalone install
      mode = 'idle';
    }
    if (installAnim?.resolve) installAnim.resolve(false);

    const dur = Math.max(250, Number(durationMs) || 3200);
    safeSetMode('after', true);
    applyInstallProgress(0.0, -36);

    return new Promise((resolve) => {
      installAnim = {
        startMs: performance.now(),
        durationMs: dur,
        resolve,
      };
      if (mode === 'idle') mode = 'install_only';
      ensureInternalRaf();
    });
  }

  function flyToCamera(posVec3, targetVec3, durationMs = 1400) {
    if (!camera) return Promise.resolve(false);
    if (mode === 'sequence') {
      mode = 'idle';
    }
    if (flyAnim?.resolve) flyAnim.resolve(false);

    const toPos = toVec3(posVec3, [8.5, 5.5, 13.5]);
    const currentTarget = controls?.target ? controls.target.clone() : new THREE.Vector3(0, 1.2, -0.5);
    const toTarget = targetVec3 != null ? toVec3(targetVec3, [0, 1.2, -0.5]) : currentTarget;

    if (prefersReducedMotion() || durationMs <= 0) {
      applyCameraPose(toPos, toTarget);
      setControlsInteractive(true);
      return Promise.resolve(true);
    }

    const fromPos = camera.position.clone();
    const fromTarget = currentTarget.clone();
    const dur = Math.max(120, Number(durationMs) || 1400);

    setControlsInteractive(false);

    return new Promise((resolve) => {
      flyAnim = {
        startMs: performance.now(),
        durationMs: dur,
        fromPos,
        toPos,
        fromTarget,
        toTarget,
        resolve,
      };
      if (mode === 'idle') mode = 'fly_to';
      ensureInternalRaf();
    });
  }

  function tick(nowMs = performance.now()) {
    // Guard against duplicate ticks within the same animation frame
    if (lastTickMs > 0 && Math.abs(nowMs - lastTickMs) < 4) return;
    lastTickMs = nowMs;

    // 1. Hero 6-phase sequence
    if (mode === 'sequence') {
      if (seqPausedAtOffsetMs != null) return;
      const elapsedS = (nowMs - seqStartMs) / 1000;
      updateSequenceAt(elapsedS);
    }

    // 2. Standalone canopy install choreography
    if (installAnim) {
      const rawP = clamp01((nowMs - installAnim.startMs) / installAnim.durationMs);
      const easedP = prefersReducedMotion() ? 1.0 : easeInOutCubic(rawP);
      const louverP = clamp01((easedP - 0.60) / 0.40);
      const louverDeg = lerp(-36, 0, easeOutCubic(louverP));
      applyInstallProgress(easedP, louverDeg);

      if (rawP >= 1.0) {
        const done = installAnim.resolve;
        installAnim = null;
        if (mode === 'install_only' && !flyAnim) mode = 'idle';
        done?.(true);
      }
    }

    // 3. Standalone smooth camera flyTo
    if (flyAnim) {
      const rawP = clamp01((nowMs - flyAnim.startMs) / flyAnim.durationMs);
      const easedP = easeInOutCubic(rawP);
      tmpPos.lerpVectors(flyAnim.fromPos, flyAnim.toPos, easedP);
      tmpTarget.lerpVectors(flyAnim.fromTarget, flyAnim.toTarget, easedP);
      applyCameraPose(tmpPos, tmpTarget);

      if (rawP >= 1.0) {
        const done = flyAnim.resolve;
        flyAnim = null;
        if (mode === 'fly_to' && !installAnim) {
          mode = 'idle';
          setControlsInteractive(true);
        }
        done?.(true);
      }
    }
  }

  const controller = {
    start,
    stop,
    skipToInteractive,
    reset,
    jumpToPhase,
    pause,
    resume,
    playInstallAnimationOnly,
    flyToCamera,
    tick,
    get active() {
      return mode === 'sequence';
    },
    get playing() {
      return mode === 'sequence' && seqPausedAtOffsetMs == null;
    },
    get phase() {
      return lastPhaseNumber;
    },
    get phases() {
      return HERO_PHASES;
    },
  };

  return controller;
}

export default createDemoController;
