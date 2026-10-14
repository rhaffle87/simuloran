import { describe, it, expect } from 'vitest';
import {
  computeStormHeightDepressionMeters,
  computeAuroralAbsorption,
  computePhaseScintillation,
  evaluateSpaceWeatherEnvironment,
} from '../spaceWeather.js';

describe('Space Weather & Ionospheric Scintillation Engine (spaceWeather.js)', () => {
  it('computes zero reflection height depression under quiet conditions (Kp <= 2)', () => {
    expect(computeStormHeightDepressionMeters(1.0)).toBe(0.0);
    expect(computeStormHeightDepressionMeters(2.5)).toBe(0.0);
  });

  it('computes progressive height depression as Kp reaches severe storm levels', () => {
    const depKp5 = computeStormHeightDepressionMeters(5.0, 60.0);
    const depKp9 = computeStormHeightDepressionMeters(9.0, 60.0);

    expect(depKp5).toBeGreaterThan(1000.0); // > 1 km depression
    expect(depKp9).toBeGreaterThan(depKp5);
    expect(depKp9).toBeLessThanOrEqual(30000.0); // bounded
  });

  it('computes auroral D-region absorption excess', () => {
    const quiet = computeAuroralAbsorption(2.0, 0.0);
    expect(quiet.excessAbsorptionDb).toBe(0.0);
    expect(quiet.attenuationLinear).toBe(1.0);

    const severe = computeAuroralAbsorption(7.0, -150.0);
    expect(severe.excessAbsorptionDb).toBeGreaterThan(15.0); // > 15 dB absorption
    expect(severe.attenuationLinear).toBeLessThan(0.2);
  });

  it('escalates phase scintillation and cycle-slip risk with storm intensity', () => {
    const quiet = computePhaseScintillation(1.5, 2.0);
    const storm = computePhaseScintillation(8.5, 2.0);

    expect(quiet.phaseStdDevDeg).toBeCloseTo(2.87, 1);
    expect(quiet.cycleSlipRiskMultiplier).toBeCloseTo(1.0, 1);

    expect(storm.phaseStdDevDeg).toBeGreaterThan(12.0);
    expect(storm.cycleSlipRiskMultiplier).toBeGreaterThan(2.0);
  });

  it('evaluates comprehensive space weather environment', () => {
    const res = evaluateSpaceWeatherEnvironment({
      nominalHeightMeters: 90000.0,
      kpIndex: 8.5,
      dstIndexNt: -200.0,
      geomagneticLatDeg: 65.0,
    });

    expect(res.stormClass).toBe('SEVERE_G4_G5');
    expect(res.effectiveHeightMeters).toBeLessThan(90000.0);
    expect(res.effectiveHeightMeters).toBeGreaterThanOrEqual(55000.0);
    expect(res.excessAbsorptionDb).toBeGreaterThan(10.0);
  });
});
