/**
 * SIMULORAN — Masterless Multi-Chain Time-of-Emission (TOE) Loran Network Engine
 *
 * Implements:
 * 1. Absolute UTC(k) Time of Emission (TOE) scheduling without master-secondary baseline interlocks.
 * 2. Heterogeneous all-in-view pseudorange multilateration fusing arbitrary transmitters across multiple GRIs.
 * 3. Autonomous resilience: zero navigation interruption during single or multi-station master outages.
 *
 * References:
 * - Uragan & BACC Technical Standards (2018), "Independent Time-of-Emission Synchronization in LF Navigation".
 * - RTCM Standard 10410.1: "Standard for Electronic Loran (eLoran) Receivers".
 * - Offermans, G. & Johannessen, R. (2012), "eLoran Masterless Transmission Trials," Royal Institute of Navigation.
 */

import { SPEED_OF_LIGHT, haversineDistance, initialBearing } from './geodesy.js';

const DEG2RAD = Math.PI / 180.0;

/**
 * Computes the scheduled Time of Emission (TOE) for a transmitter relative to an absolute UTC epoch.
 *
 * @param {number} epochTimeSec - Current simulation/system time in seconds
 * @param {number} griUs - Group Repetition Interval in microseconds
 * @param {number} [phaseCodingOffsetUs=0] - Phase coding interval / emission delay offset
 * @returns {{ lastToeSec: number, nextToeSec: number, pulsePhaseFraction: number }}
 */
export function computeStationToeEpoch(epochTimeSec, griUs, phaseCodingOffsetUs = 0) {
  const griSec = griUs * 1e-6;
  const offsetSec = phaseCodingOffsetUs * 1e-6;

  // Relative time within current GRI cycle
  const tAdj = epochTimeSec - offsetSec;
  const cycleCount = Math.floor(tAdj / griSec);
  const lastToeSec = cycleCount * griSec + offsetSec;
  const nextToeSec = lastToeSec + griSec;
  const pulsePhaseFraction = Math.max(0.0, Math.min(1.0, (epochTimeSec - lastToeSec) / griSec));

  return {
    lastToeSec,
    nextToeSec,
    pulsePhaseFraction,
  };
}

/**
 * Solves all-in-view masterless position from heterogeneous multi-GRI pseudorange observations.
 * Does NOT require any master station to be operational or in view.
 *
 * @param {Array<Object>} observations - Array of station pseudorange measurements:
 *   [{
 *     station: { id, label, lat, lng, griUs, isMaster },
 *     pseudorangeMeters: number, // Observed range: true_dist + c * b_rx + noise + ASF
 *     sigmaMeters: number,       // Weighting standard deviation
 *     asfCorrectionMeters?: number
 *   }]
 * @param {Object} [initialGuess={ lat: 0, lng: 0 }] - Seed coordinates
 * @param {Object} [options]
 * @param {number} [options.maxIterations=20]
 * @param {number} [options.toleranceMeters=0.01]
 * @returns {Object} Solution descriptor
 */
export function solveMasterlessFix(observations, initialGuess = null, options = {}) {
  const maxIter = options.maxIterations || 20;
  const tol = options.toleranceMeters || 0.01;

  if (!Array.isArray(observations) || observations.length < 3) {
    return {
      converged: false,
      reason: 'Masterless all-in-view multilateration requires at least 3 stations in view',
      lat: initialGuess?.lat ?? 0.0,
      lng: initialGuess?.lng ?? 0.0,
      clockBiasMeters: 0.0,
      clockBiasSec: 0.0,
      hdop: 99.9,
      iterations: 0,
      activeStationsCount: observations?.length || 0,
    };
  }

  // Initial estimate
  let curLat = initialGuess?.lat ?? 0.0;
  let curLng = initialGuess?.lng ?? 0.0;

  if (!initialGuess) {
    let sLat = 0, sLng = 0;
    for (const obs of observations) {
      sLat += obs.station.lat;
      sLng += obs.station.lng;
    }
    curLat = sLat / observations.length;
    curLng = sLng / observations.length;
  }

  let clockBiasMeters = 0.0;
  let converged = false;
  let iterations = 0;

  // Local metric scale
  const latRad = curLat * DEG2RAD;
  const mPerDegLat = 111132.954 - 559.822 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const mPerDegLng = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);

  for (let iter = 0; iter < maxIter; iter++) {
    iterations++;
    let h11 = 0, h12 = 0, h13 = 0;
    let h22 = 0, h23 = 0, h33 = 0;
    let b1 = 0, b2 = 0, b3 = 0;

    for (const obs of observations) {
      const st = obs.station;
      const sigma = Math.max(0.1, obs.sigmaMeters || 10.0);
      const w = 1.0 / (sigma * sigma);

      const d = haversineDistance(curLat, curLng, st.lat, st.lng);
      const azDeg = initialBearing(curLat, curLng, st.lat, st.lng);
      const azRad = azDeg * DEG2RAD;

      // Unit vector components pointing from user toward station
      const ue = Math.sin(azRad);
      const un = Math.cos(azRad);

      const asfCorr = obs.asfCorrectionMeters || 0.0;
      const predRange = d + clockBiasMeters - asfCorr;
      const residual = obs.pseudorangeMeters - predRange;

      // Partial derivatives: dr/dEast = -ue, dr/dNorth = -un, dr/dClock = 1
      const g1 = -ue;
      const g2 = -un;
      const g3 = 1.0;

      h11 += w * g1 * g1;
      h12 += w * g1 * g2;
      h13 += w * g1 * g3;
      h22 += w * g2 * g2;
      h23 += w * g2 * g3;
      h33 += w * g3 * g3;

      b1 += w * g1 * residual;
      b2 += w * g2 * residual;
      b3 += w * g3 * residual;
    }

    // 3x3 Symmetric matrix solve via Cramer's rule
    const A = [
      [h11, h12, h13],
      [h12, h22, h23],
      [h13, h23, h33],
    ];

    const detA =
      A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
      A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
      A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);

    if (Math.abs(detA) < 1e-12) break;

    // Solve for dx (East meters), dy (North meters), db (Clock bias meters)
    const solve3x3 = (bVec) => {
      const detX =
        bVec[0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
        A[0][1] * (bVec[1] * A[2][2] - A[1][2] * bVec[2]) +
        A[0][2] * (bVec[1] * A[2][1] - A[1][1] * bVec[2]);

      const detY =
        A[0][0] * (bVec[1] * A[2][2] - A[1][2] * bVec[2]) -
        bVec[0] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
        A[0][2] * (A[1][0] * bVec[2] - bVec[1] * A[2][0]);

      const detZ =
        A[0][0] * (A[1][1] * bVec[2] - bVec[1] * A[2][1]) -
        A[0][1] * (A[1][0] * bVec[2] - bVec[1] * A[2][0]) +
        bVec[0] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);

      return [detX / detA, detY / detA, detZ / detA];
    };

    const [dEast, dNorth, dClock] = solve3x3([b1, b2, b3]);

    curLat += dNorth / mPerDegLat;
    curLng += dEast / mPerDegLng;
    clockBiasMeters += dClock;

    if (Math.hypot(dEast, dNorth) < tol) {
      converged = true;
      break;
    }
  }

  // Compute HDOP from unweighted geometry
  let g11 = 0, g12 = 0, g13 = 0, g22 = 0, g23 = 0, g33 = 0;
  for (const obs of observations) {
    const azRad = initialBearing(curLat, curLng, obs.station.lat, obs.station.lng) * DEG2RAD;
    const ue = Math.sin(azRad);
    const un = Math.cos(azRad);
    g11 += ue * ue;
    g12 += ue * un;
    g13 += -ue;
    g22 += un * un;
    g23 += -un;
    g33 += 1.0;
  }
  const detG =
    g11 * (g22 * g33 - g23 * g23) -
    g12 * (g12 * g33 - g23 * g13) +
    g13 * (g12 * g23 - g22 * g13);

  const hdop =
    Math.abs(detG) > 1e-12
      ? Math.sqrt(Math.max(0.1, ((g22 * g33 - g23 * g23) + (g11 * g33 - g13 * g13)) / detG))
      : 99.9;

  return {
    converged,
    lat: curLat,
    lng: curLng,
    clockBiasMeters,
    clockBiasSec: clockBiasMeters / SPEED_OF_LIGHT,
    hdop: Math.min(99.9, hdop),
    iterations,
    activeStationsCount: observations.length,
    hasMasterInView: observations.some((o) => o.station.isMaster),
  };
}
