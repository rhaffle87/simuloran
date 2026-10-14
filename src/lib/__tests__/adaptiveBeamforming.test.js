import { describe, it, expect } from 'vitest';
import {
  createCircularArray,
  computeSteeringVector,
  computeMvdrWeights,
  computeArrayGain,
  LF_LAMBDA_METERS,
} from '../adaptiveBeamforming.js';

describe('CRPA & Adaptive Beamforming Engine (adaptiveBeamforming.js)', () => {
  it('creates 4-element circular array geometry', () => {
    const arr = createCircularArray(10.0);
    expect(arr.length).toBe(4);
    expect(arr[0].x).toBeCloseTo(10.0, 4);
    expect(arr[0].y).toBeCloseTo(0.0, 4);
    expect(arr[1].x).toBeCloseTo(0.0, 4);
    expect(arr[1].y).toBeCloseTo(10.0, 4);
  });

  it('computes unit-magnitude steering vectors across azimuths', () => {
    const arr = createCircularArray(15.0);
    const s0 = computeSteeringVector(arr, 0.0);
    const s90 = computeSteeringVector(arr, 90.0);

    expect(s0.length).toBe(4);
    expect(s90.length).toBe(4);

    for (const v of s0) {
      expect(Math.hypot(v.re, v.im)).toBeCloseTo(1.0, 6);
    }
  });

  it('synthesizes MVDR weights placing a deep spatial null on jammer azimuth', () => {
    const arr = createCircularArray(25.0);
    const signalAz = 45.0; // Desired station at 45 deg
    const jammerAz = 180.0; // High-power EW jammer from South (180 deg)

    const sSig = computeSteeringVector(arr, signalAz);
    const sJam = computeSteeringVector(arr, jammerAz);

    // Build covariance matrix Rxx = sigma_n^2 * I + P_jam * sJam * sJam^H
    const n = arr.length;
    const pJam = 1000.0; // Strong jammer (+30 dB)
    const Rxx = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        const noise = i === j ? 1.0 : 0.0;
        // sJam_i * conj(sJam_j)
        const jamRe = sJam[i].re * sJam[j].re + sJam[i].im * sJam[j].im;
        const jamIm = sJam[i].im * sJam[j].re - sJam[i].re * sJam[j].im;
        return {
          re: noise + pJam * jamRe,
          im: pJam * jamIm,
        };
      })
    );

    const weights = computeMvdrWeights(Rxx, sSig);

    // Evaluate array gain in direction of desired transmitter
    const desiredGain = computeArrayGain(weights, arr, signalAz);
    expect(desiredGain.gainLinear).toBeCloseTo(1.0, 2); // Unit distortionless gain
    expect(Math.abs(desiredGain.gainDb)).toBeLessThan(0.5);

    // Evaluate array gain in direction of jammer (should show deep null)
    const jammerGain = computeArrayGain(weights, arr, jammerAz);
    expect(jammerGain.gainDb).toBeLessThan(-20.0); // Spatial null > 20 dB suppression
  });
});
