/**
 * SIMULORAN — Space Weather, Geomagnetic Storm & Ionospheric Scintillation Engine
 *
 * Implements:
 * 1. Planetary Kp-index (0 to 9) and equatorial Dst-index (-400 to +50 nT) geomagnetic storm dynamics.
 * 2. Ionospheric virtual reflection height compression during solar proton events (Davies 1990).
 * 3. Auroral D-region excess absorption and signal attenuation (ITU-R P.684-7).
 * 4. Phase scintillation spectral jitter and storm-induced cycle-slip risk escalation.
 *
 * References:
 * - Davies, K. (1990), "Ionospheric Radio," IEE Electromagnetic Waves Series.
 * - ITU-R Recommendation P.684-7: "Prediction of field strength at frequencies below about 150 kHz".
 * - Doherty et al. (1961), "Timing Potentials of Loran-C," Proc. IRE.
 */

/**
 * Computes ionospheric virtual reflection height depression during geomagnetic storms.
 * Quiet conditions (Kp <= 2): depression = 0.
 * Severe storm (Kp = 9): depression up to ~26 km, bringing nighttime E-layer down towards daytime D-layer.
 *
 * @param {number} kpIndex - Planetary Kp index (0.0 to 9.0)
 * @param {number} [geomagneticLatDeg=45.0] - Geomagnetic latitude in degrees
 * @returns {number} Reflection height depression in meters
 */
export function computeStormHeightDepressionMeters(kpIndex, geomagneticLatDeg = 45.0) {
  const kp = Math.max(0, Math.min(9.0, kpIndex));
  if (kp <= 2.5) return 0.0;

  // Latitudinal scaling: auroral and high-latitude zones experience stronger depression
  const latFactor = Math.sin((Math.abs(geomagneticLatDeg) * Math.PI) / 180.0);
  const beta0 = 1800.0; // 1.8 km base scaling
  const excessKp = kp - 2.5;

  // Quadratic/power law height depression
  const depressionKm = (beta0 * Math.pow(excessKp, 1.45) * Math.max(0.4, latFactor)) / 1000.0;
  return Math.min(30000.0, depressionKm * 1000.0); // Capped at 30 km depression
}

/**
 * Computes auroral and polar cap D-region absorption excess in dB.
 *
 * @param {number} kpIndex - Planetary Kp index (0.0 to 9.0)
 * @param {number} [dstIndexNt=0.0] - Disturbance storm time index in nT (-400 to +50)
 * @returns {{ excessAbsorptionDb: number, attenuationLinear: number }}
 */
export function computeAuroralAbsorption(kpIndex, dstIndexNt = 0.0) {
  const kp = Math.max(0, Math.min(9.0, kpIndex));
  const dstExcess = dstIndexNt < -50 ? Math.abs(dstIndexNt + 50) * 0.02 : 0.0;

  // ITU-R P.684 empirical auroral absorption curve: ~3.2 dB per Kp unit above quiet baseline
  const excessAbsorptionDb = Math.max(0.0, 3.2 * (kp - 2.0)) + dstExcess;
  const attenuationLinear = Math.pow(10, -excessAbsorptionDb / 20.0);

  return {
    excessAbsorptionDb,
    attenuationLinear,
  };
}

/**
 * Computes phase scintillation variance and standard deviation in degrees.
 * High Kp increases phase jitter, pulling zero-crossing tracking loops into cycle slips.
 *
 * @param {number} kpIndex - Planetary Kp index (0.0 to 9.0)
 * @param {number} [basePhaseJitterDeg=2.0] - Nominal receiver phase jitter in degrees
 * @returns {{ phaseStdDevDeg: number, cycleSlipRiskMultiplier: number }}
 */
export function computePhaseScintillation(kpIndex, basePhaseJitterDeg = 2.0) {
  const kp = Math.max(0, Math.min(9.0, kpIndex));
  // Quadratic variance growth under geomagnetic storm turbulence
  const varianceMultiplier = 1.0 + 0.45 * Math.pow(kp, 2.1);
  const phaseStdDevDeg = basePhaseJitterDeg * Math.sqrt(varianceMultiplier);

  // Cycle slip risk increases exponentially once phase standard deviation exceeds ~15 degrees
  const cycleSlipRiskMultiplier = Math.exp(Math.max(0.0, (phaseStdDevDeg - 10.0) / 4.0));

  return {
    phaseStdDevDeg,
    cycleSlipRiskMultiplier,
  };
}

/**
 * Evaluates comprehensive space weather effect on 100 kHz skywave propagation.
 *
 * @param {Object} params
 * @param {number} params.nominalHeightMeters - Nominal undisturbed reflection height (e.g. 70000m or 90000m)
 * @param {number} params.kpIndex - Planetary Kp index (0 to 9)
 * @param {number} [params.dstIndexNt=0] - Dst index in nT
 * @param {number} [params.geomagneticLatDeg=50] - Geomagnetic latitude
 * @returns {Object} Effective ionospheric parameters
 */
export function evaluateSpaceWeatherEnvironment({
  nominalHeightMeters,
  kpIndex,
  dstIndexNt = 0,
  geomagneticLatDeg = 50,
}) {
  const depressionMeters = computeStormHeightDepressionMeters(kpIndex, geomagneticLatDeg);
  const effectiveHeightMeters = Math.max(55000.0, nominalHeightMeters - depressionMeters);

  const absorption = computeAuroralAbsorption(kpIndex, dstIndexNt);
  const scintillation = computePhaseScintillation(kpIndex);

  // Storm classification
  let stormClass = 'QUIET';
  if (kpIndex >= 8) stormClass = 'SEVERE_G4_G5';
  else if (kpIndex >= 6) stormClass = 'MODERATE_G2_G3';
  else if (kpIndex >= 4) stormClass = 'MINOR_G1';

  return {
    nominalHeightMeters,
    effectiveHeightMeters,
    depressionMeters,
    excessAbsorptionDb: absorption.excessAbsorptionDb,
    attenuationLinear: absorption.attenuationLinear,
    phaseStdDevDeg: scintillation.phaseStdDevDeg,
    cycleSlipRiskMultiplier: scintillation.cycleSlipRiskMultiplier,
    stormClass,
  };
}
