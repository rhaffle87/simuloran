import { describe, it, expect } from 'vitest';
import {
  computeEffectiveEarthRadiusFactor,
  computeModifiedRefractivity,
  classifyRefractionRegime,
  computeRadioHorizonKm,
  computeDuctExcessDelayUs,
  STANDARD_DNDH_N_UNITS_PER_KM,
} from '../troposphericDucting.js';

describe('3D Tropospheric Refractivity Gradient & Ducting Engine (troposphericDucting.js)', () => {
  it('computes standard atmosphere effective Earth radius factor (k ~ 4/3)', () => {
    const k = computeEffectiveEarthRadiusFactor(STANDARD_DNDH_N_UNITS_PER_KM);
    expect(k).toBeCloseTo(1.333, 2); // 4/3
  });

  it('correctly classifies refraction regimes across refractivity gradients', () => {
    expect(classifyRefractionRegime(20.0)).toBe('SUB_REFRACTION');
    expect(classifyRefractionRegime(-50.0)).toBe('STANDARD');
    expect(classifyRefractionRegime(-120.0)).toBe('SUPER_REFRACTION');
    expect(classifyRefractionRegime(-180.0)).toBe('DUCTING');
  });

  it('computes modified refractivity M profile', () => {
    const mGround = computeModifiedRefractivity(320.0, 0.0);
    const m1000m = computeModifiedRefractivity(280.0, 1000.0);

    expect(mGround).toBe(320.0);
    expect(m1000m).toBeCloseTo(280.0 + 157.0, 1);
  });

  it('computes radio horizon line-of-sight distance', () => {
    // 100m transmitter mast, 10m receiver antenna mast
    const horizon = computeRadioHorizonKm(100.0, 10.0, 1.3333);
    // d1 ~ sqrt(2 * 8495km * 0.1km) ~ 41.2km; d2 ~ sqrt(2 * 8495km * 0.01km) ~ 13.0km -> ~54.2 km
    expect(horizon).toBeGreaterThan(45.0);
    expect(horizon).toBeLessThan(65.0);
  });

  it('computes excess delay inside surface duct', () => {
    // 200 km path across Red Sea / Persian Gulf duct with Delta N = +25 N-units
    const delayUs = computeDuctExcessDelayUs(200.0, 50.0, 25.0);
    // 200e3 / 3e8 * 25e-6 * 1e6 ~ 0.0167 us
    expect(delayUs).toBeGreaterThan(0.01);
    expect(delayUs).toBeLessThan(0.03);
  });
});
