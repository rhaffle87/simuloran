import { describe, it, expect } from 'vitest';
import {
  gcd,
  lcm,
  computeCriCoincidencePeriod,
  detectPulseCollisions,
  cancelCrossRateInterference,
} from '../crossRateInterference.js';

describe('Cross-Rate Interference (CRI) Engine (crossRateInterference.js)', () => {
  it('calculates correct GCD and LCM for GRI intervals', () => {
    expect(gcd(99300, 74300)).toBe(100);
    // (99300 * 74300) / 100 = 73779900 us
    expect(lcm(99300, 74300)).toBe(73779900);
  });

  it('computes exact coincidence periods between active chains', () => {
    const res = computeCriCoincidencePeriod(99300, 74300);
    expect(res.coincidenceUs).toBe(73779900);
    expect(res.coincidenceSec).toBeCloseTo(73.7799, 4);
    expect(res.repetitionsChain1).toBe(743);
    expect(res.repetitionsChain2).toBe(993);
  });

  it('detects direct and near pulse collisions across overlapping arrivals', () => {
    const chain1 = [1000, 5000, 10000];
    const chain2 = [1020, 5150, 20000]; // 1020 is within 20 us (direct), 5150 is 150 us (near)
    const collisions = detectPulseCollisions(chain1, chain2, 300);

    expect(collisions.length).toBe(2);
    expect(collisions[0]).toEqual({
      t1Us: 1000,
      t2Us: 1020,
      deltaUs: 20,
      severity: 'direct',
    });
    expect(collisions[1]).toEqual({
      t1Us: 5000,
      t2Us: 5150,
      deltaUs: 150,
      severity: 'near',
    });
  });

  it('performs subtractive pulse cancellation to suppress interfering CRI pulses', () => {
    const sampleRate = 1e6; // 1 MHz -> 1 us / sample
    const length = 1000;
    const signal = new Float64Array(length);

    // Inject interfering pulse at t = 200 us
    const interferingPulses = [{ tArrivalUs: 200, amplitude: 5.0, phaseRad: 0 }];
    const dtUs = 1e6 / sampleRate;
    const omega = 2 * Math.PI * 100000 * 1e-6;

    for (let i = 0; i < length; i++) {
      const tRel = i * dtUs - 200;
      if (tRel >= 0 && tRel <= 300) {
        const ratio = tRel / 65.0;
        const env = ratio * ratio * Math.exp(-2.0 * (tRel - 65.0) / 65.0);
        signal[i] = 5.0 * env * Math.sin(omega * tRel);
      }
    }

    // Verify signal has non-zero peak
    let maxBefore = 0;
    for (let i = 0; i < length; i++) maxBefore = Math.max(maxBefore, Math.abs(signal[i]));
    expect(maxBefore).toBeGreaterThan(1.0);

    // Cancel interference
    const cleaned = cancelCrossRateInterference(signal, sampleRate, interferingPulses);

    let maxAfter = 0;
    for (let i = 0; i < length; i++) maxAfter = Math.max(maxAfter, Math.abs(cleaned[i]));
    expect(maxAfter).toBeLessThan(1e-12); // Coherently cancelled to numerical zero
  });
});
