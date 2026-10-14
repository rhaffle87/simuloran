/**
 * SIMULORAN — Cross-Rate Interference (CRI) & Mutual GRI Suppression
 *
 * Implements:
 * 1. Exact mathematical coincidence period between arbitrary Loran-C/eLoran chains.
 * 2. Time-domain pulse collision detection across overlapping GRI arrivals.
 * 3. CRI blanking and coherent subtractive pulse cancellation (Peterson 2006).
 *
 * References:
 * - Peterson, B. B. (2006), "Multi-chain eLoran Receiver Architectures," ION NTM.
 * - USCG Loran-C User Handbook COMDTINST M16562.4A, §4.3 (Cross-rate interference).
 */

/**
 * Computes Greatest Common Divisor using Euclidean algorithm.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function gcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * Computes Least Common Multiple.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function lcm(a, b) {
  if (a === 0 || b === 0) return 0;
  return Math.abs(Math.round(a * b)) / gcd(a, b);
}

/**
 * Computes exact coincidence epoch period between two GRI chains.
 * GRI intervals are in microseconds (GRI code * 10 us).
 *
 * @param {number} gri1Us - First GRI period in microseconds (e.g. 99300 for GRI 9930)
 * @param {number} gri2Us - Second GRI period in microseconds (e.g. 74300 for GRI 7430)
 * @returns {{ coincidenceUs: number, coincidenceSec: number, repetitionsChain1: number, repetitionsChain2: number }}
 */
export function computeCriCoincidencePeriod(gri1Us, gri2Us) {
  const g1 = Math.round(gri1Us);
  const g2 = Math.round(gri2Us);
  const coincidenceUs = lcm(g1, g2);
  return {
    coincidenceUs,
    coincidenceSec: coincidenceUs / 1e6,
    repetitionsChain1: coincidenceUs / g1,
    repetitionsChain2: coincidenceUs / g2,
  };
}

/**
 * Detects time-domain pulse overlap collisions between two pulse arrival sequences.
 *
 * @param {Array<number>} chain1ArrivalsUs - Pulse arrival timestamps in microseconds
 * @param {Array<number>} chain2ArrivalsUs - Interfering chain arrival timestamps
 * @param {number} [pulseDurationUs=300] - Effective pulse duration window in microseconds
 * @returns {Array<{ t1Us: number, t2Us: number, deltaUs: number, severity: 'direct'|'near' }>}
 */
export function detectPulseCollisions(chain1ArrivalsUs, chain2ArrivalsUs, pulseDurationUs = 300) {
  const collisions = [];
  let jStart = 0;

  for (let i = 0; i < chain1ArrivalsUs.length; i++) {
    const t1 = chain1ArrivalsUs[i];
    for (let j = jStart; j < chain2ArrivalsUs.length; j++) {
      const t2 = chain2ArrivalsUs[j];
      const diff = t2 - t1;

      if (diff < -pulseDurationUs) {
        jStart = j + 1;
        continue;
      }
      if (diff > pulseDurationUs) {
        break;
      }

      const absDiff = Math.abs(diff);
      // SZC tracking occurs at 30 us; collisions within 65 us corrupt envelope peak directly
      collisions.push({
        t1Us: t1,
        t2Us: t2,
        deltaUs: diff,
        severity: absDiff <= 65 ? 'direct' : 'near',
      });
    }
  }

  return collisions;
}

/**
 * Sourced CCIR normalized pulse envelope for interference synthesis.
 * i(t) = (t/tau)^2 * exp(-2*(t-tau)/tau)
 */
function ccirPulseEnvelope(tUs) {
  if (tUs < 0 || tUs > 300) return 0;
  const tau = 65.0;
  const ratio = tUs / tau;
  return ratio * ratio * Math.exp(-2.0 * (tUs - tau) / tau);
}

/**
 * Applies coherent subtractive pulse cancellation to mitigate Cross-Rate Interference.
 * Estimates interfering pulse from known Phase Coding Interval (PCI) and subtracts it.
 *
 * @param {Float64Array|Array<number>} compositeSignal - Sampled baseband/RF signal
 * @param {number} sampleRateHz - Sampling rate in Hz (e.g. 1e6)
 * @param {Array<{ tArrivalUs: number, amplitude: number, phaseRad: number }>} interferingPulses - Known CRI pulses
 * @param {number} [fcHz=100000] - Loran carrier frequency in Hz
 * @returns {Float64Array} Cleaned signal buffer with CRI suppressed
 */
export function cancelCrossRateInterference(
  compositeSignal,
  sampleRateHz,
  interferingPulses,
  fcHz = 100000
) {
  const cleaned = new Float64Array(compositeSignal.length);
  cleaned.set(compositeSignal);

  const dtUs = 1e6 / sampleRateHz;
  const omega = 2 * Math.PI * fcHz * 1e-6; // rad/us

  // ponytail: scalar single-thread subtraction loop. Upgrade to WASM SIMD for >10 MSps streams.
  for (let p = 0; p < interferingPulses.length; p++) {
    const { tArrivalUs, amplitude, phaseRad = 0 } = interferingPulses[p];
    const startIdx = Math.max(0, Math.floor(tArrivalUs / dtUs));
    const endIdx = Math.min(cleaned.length, Math.ceil((tArrivalUs + 300) / dtUs));

    for (let k = startIdx; k < endIdx; k++) {
      const tSampleUs = k * dtUs;
      const tRelUs = tSampleUs - tArrivalUs;
      if (tRelUs >= 0 && tRelUs <= 300) {
        const env = ccirPulseEnvelope(tRelUs);
        const rfPulse = amplitude * env * Math.sin(omega * tRelUs + phaseRad);
        cleaned[k] -= rfPulse;
      }
    }
  }

  return cleaned;
}
