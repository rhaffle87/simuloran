/**
 * SIMULORAN — 3D Tropospheric Vertical Refractivity Gradient & Ducting Engine
 *
 * Implements:
 * 1. Effective Earth radius factor (k-factor) as a function of vertical refractivity gradient dN/dh.
 * 2. Modified refractivity M-profile and atmospheric duct detection (ITU-R P.453 & ITU-R P.834).
 * 3. Tropospheric phase velocity modification and excess delay over marine surface ducts.
 * 4. Refraction radio horizon calculation for groundwave and low-elevation LF rays.
 *
 * References:
 * - ITU-R Recommendation P.453-14: "The radio refractive index: its formula and refractivity data".
 * - ITU-R Recommendation P.834-9: "Effects of tropospheric refraction on radiowave propagation".
 * - Bean, B. R. & Dutton, E. J. (1968), "Radio Meteorology," NBS Monograph 92.
 */

import { SPEED_OF_LIGHT, EARTH_RADIUS } from './geodesy.js';

export const STANDARD_DNDH_N_UNITS_PER_KM = -39.24; // Standard atmosphere dN/dh
export const DUCT_CRITICAL_GRADIENT = -157.0; // N-units/km, threshold where dM/dh <= 0

/**
 * Computes effective Earth radius factor (k-factor) from vertical refractivity gradient dN/dh.
 * Standard atmosphere (dN/dh = -39.24 N/km): k = 4/3 ~ 1.333.
 *
 * Formula: k = 1 / (1 + (R_E / 10^6) * (dN/dh))
 *
 * @param {number} dNdHPerKm - Refractivity gradient in N-units/km (typically -180 to +50)
 * @returns {number} Effective Earth radius factor k
 */
export function computeEffectiveEarthRadiusFactor(dNdHPerKm = STANDARD_DNDH_N_UNITS_PER_KM) {
  const rE_km = EARTH_RADIUS / 1000.0;
  const denominator = 1.0 + (rE_km / 1e6) * dNdHPerKm;

  // Handle asymptotic singularity near dN/dh = -157 N/km
  if (Math.abs(denominator) < 1e-6) {
    return dNdHPerKm < -157.0 ? -99.9 : 99.9;
  }
  return 1.0 / denominator;
}

/**
 * Computes modified refractivity M at altitude h (meters) from refractivity N.
 * M = N + (h_meters / R_E_meters) * 10^6 = N + 157 * (h_meters / 1000)
 *
 * @param {number} nUnits - Refractivity N at altitude h
 * @param {number} altitudeMeters - Geometric altitude in meters above sea level
 * @returns {number} Modified refractivity M
 */
export function computeModifiedRefractivity(nUnits, altitudeMeters) {
  return nUnits + 0.157 * altitudeMeters;
}

/**
 * Evaluates tropospheric refraction regime based on vertical gradient dN/dh.
 *
 * @param {number} dNdHPerKm - Refractivity gradient in N-units/km
 * @returns {'SUB_REFRACTION'|'STANDARD'|'SUPER_REFRACTION'|'DUCTING'} Regime classification
 */
export function classifyRefractionRegime(dNdHPerKm) {
  if (dNdHPerKm > 0) return 'SUB_REFRACTION';
  if (dNdHPerKm > -100.0) return 'STANDARD';
  if (dNdHPerKm > -157.0) return 'SUPER_REFRACTION';
  return 'DUCTING';
}

/**
 * Computes radio horizon distance in kilometers over effective Earth.
 *
 * @param {number} txAntennaHeightMeters - Transmitter antenna height
 * @param {number} rxAntennaHeightMeters - Receiver antenna height
 * @param {number} [kFactor=1.3333] - Effective Earth radius factor k
 * @returns {number} Radio line-of-sight horizon distance in km
 */
export function computeRadioHorizonKm(txAntennaHeightMeters, rxAntennaHeightMeters, kFactor = 1.3333) {
  const kEff = Math.max(0.5, Math.abs(kFactor));
  const rEffMeters = kEff * EARTH_RADIUS;

  const d1 = Math.sqrt(2.0 * rEffMeters * Math.max(0.0, txAntennaHeightMeters));
  const d2 = Math.sqrt(2.0 * rEffMeters * Math.max(0.0, rxAntennaHeightMeters));

  return (d1 + d2) / 1000.0;
}

/**
 * Computes excess phase delay in microseconds induced by a surface duct layer.
 * In a marine surface duct, trapped energy propagates through high-humidity air with N > N_std,
 * introducing a small differential phase lag across long over-water paths.
 *
 * @param {number} pathDistKm - Total path distance in km
 * @param {number} ductThicknessMeters - Thickness of marine inversion duct in meters
 * @param {number} deltaNUnits - Mean refractivity excess inside duct relative to standard atmosphere
 * @returns {number} Excess propagation delay in microseconds (us)
 */
export function computeDuctExcessDelayUs(pathDistKm, ductThicknessMeters, deltaNUnits) {
  if (pathDistKm <= 0 || ductThicknessMeters <= 0 || deltaNUnits === 0) return 0.0;

  // Path length through duct in meters
  const distMeters = pathDistKm * 1000.0;
  // Delay increment dt = (dist / c) * (deltaN * 1e-6)
  const excessDelaySec = (distMeters / SPEED_OF_LIGHT) * (deltaNUnits * 1e-6);
  return excessDelaySec * 1e6;
}
