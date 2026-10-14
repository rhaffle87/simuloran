/**
 * SIMULORAN — Real-Time Kinematic Loran (RTK-Loran) & Carrier Phase Double-Differencing
 *
 * Implements:
 * 1. Double-difference 100 kHz carrier phase observation equations.
 * 2. Integer cycle ambiguity resolution over short baselines (< 10 km).
 * 3. Centimeter/decimeter relative vector positioning between monitor base and rover.
 *
 * References:
 * - Williams, P. & Hargreaves, C. (2010), "High Accuracy eLoran Carrier Phase Measurements," Royal Institute of Navigation.
 * - Teunissen, P. J. G. (1995), "The least-squares ambiguity decorrelation adjustment: a method for fast GPS integer ambiguity estimation," Journal of Geodesy.
 * - Gao et al. (2025), "Carrier Phase eLoran Positioning and Ambiguity Resolution."
 */

import { SPEED_OF_LIGHT } from './geodesy.js';

export const LF_CARRIER_FREQ_HZ = 100000;
export const LF_WAVELENGTH_METERS = SPEED_OF_LIGHT / LF_CARRIER_FREQ_HZ; // ~2997.92458 m

/**
 * Computes single-differenced carrier phase between rover (r) and base (b) for station (s).
 * Delta_Phi_br^s = (rho_r^s - rho_b^s)/lambda + (clk_r - clk_b)/lambda + (N_r^s - N_b^s) + noise
 *
 * @param {number} rangeRoverMeters - Geodesic distance from station s to rover r
 * @param {number} rangeBaseMeters - Geodesic distance from station s to base b
 * @param {number} [receiverClockDiffSec=0] - Clock bias offset between receivers
 * @param {number} [integerCycleDiff=0] - Integer phase ambiguity difference
 * @returns {number} Single-differenced phase in cycles
 */
export function computeSingleDifferencePhase(
  rangeRoverMeters,
  rangeBaseMeters,
  receiverClockDiffSec = 0,
  integerCycleDiff = 0
) {
  const geomCycles = (rangeRoverMeters - rangeBaseMeters) / LF_WAVELENGTH_METERS;
  const clockCycles = (receiverClockDiffSec * SPEED_OF_LIGHT) / LF_WAVELENGTH_METERS;
  return geomCycles + clockCycles + integerCycleDiff;
}

/**
 * Computes double-differenced carrier phase between receivers (rover, base) and stations (k, pivot j).
 * Eliminates receiver clock biases completely:
 * Nabla_Delta_Phi = (Delta_rho^k - Delta_rho^j) / lambda + Nabla_Delta_N
 *
 * @param {number} sdPhaseK - Single difference phase for station k (cycles)
 * @param {number} sdPhasePivot - Single difference phase for pivot station j (cycles)
 * @returns {number} Double differenced phase observation in cycles
 */
export function computeDoubleDifferencePhase(sdPhaseK, sdPhasePivot) {
  return sdPhaseK - sdPhasePivot;
}

/**
 * Resolves integer double-difference ambiguities using nearest-integer bootstrapping
 * over short baselines (< 10 km) where residual differential ASF is negligible.
 *
 * @param {Array<number>} observedDdCycles - Measured double-difference carrier phase in cycles
 * @param {Array<number>} approximateGeomDdCycles - Computed double-difference from code pseudorange fix
 * @returns {{ resolvedAmbiguities: Array<number>, residualsCycles: Array<number>, success: boolean }}
 */
export function resolveIntegerAmbiguities(observedDdCycles, approximateGeomDdCycles) {
  const resolvedAmbiguities = [];
  const residualsCycles = [];
  let success = true;

  // ponytail: Bootstrapping integer rounding holds for short baselines (<10 km).
  // Upgrade to multi-dimensional LAMBDA ellipsoid search for >25 km baselines.
  for (let i = 0; i < observedDdCycles.length; i++) {
    const rawAmbiguity = observedDdCycles[i] - approximateGeomDdCycles[i];
    const rounded = Math.round(rawAmbiguity);
    const residual = Math.abs(rawAmbiguity - rounded);

    resolvedAmbiguities.push(rounded);
    residualsCycles.push(residual);

    // If residual exceeds 0.25 cycles (~750m phase pull), flag ambiguity failure
    if (residual > 0.25) {
      success = false;
    }
  }

  return {
    resolvedAmbiguities,
    residualsCycles,
    success,
  };
}

/**
 * Computes relative baseline vector [deltaX, deltaY] (meters East, North)
 * from resolved double-differenced carrier phases.
 *
 * @param {Array<{ ue: number, un: number }>} stationUnitVectors - Line-of-sight unit vectors from base
 * @param {Array<number>} ddPhaseResidualMeters - Carrier phase observation residuals in meters
 * @returns {{ deltaEastMeters: number, deltaNorthMeters: number, baselineLengthMeters: number }}
 */
export function solveRtkBaseline(stationUnitVectors, ddPhaseResidualMeters) {
  // Least squares on 2x2 normal equations: H * [dx, dy]^T = res
  let h11 = 0;
  let h12 = 0;
  let h22 = 0;
  let b1 = 0;
  let b2 = 0;

  for (let i = 0; i < stationUnitVectors.length; i++) {
    const { ue, un } = stationUnitVectors[i];
    const res = ddPhaseResidualMeters[i];
    h11 += ue * ue;
    h12 += ue * un;
    h22 += un * un;
    b1 += ue * res;
    b2 += un * res;
  }

  const det = h11 * h22 - h12 * h12;
  if (Math.abs(det) < 1e-9) {
    return { deltaEastMeters: 0, deltaNorthMeters: 0, baselineLengthMeters: 0 };
  }

  const dx = (h22 * b1 - h12 * b2) / det;
  const dy = (-h12 * b1 + h11 * b2) / det;

  return {
    deltaEastMeters: dx,
    deltaNorthMeters: dy,
    baselineLengthMeters: Math.hypot(dx, dy),
  };
}
