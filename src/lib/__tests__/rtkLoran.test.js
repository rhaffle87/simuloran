import { describe, it, expect } from 'vitest';
import {
  computeSingleDifferencePhase,
  computeDoubleDifferencePhase,
  resolveIntegerAmbiguities,
  solveRtkBaseline,
  LF_WAVELENGTH_METERS,
} from '../rtkLoran.js';

describe('RTK-Loran & Carrier Phase Engine (rtkLoran.js)', () => {
  it('computes single and double-difference carrier phase observations', () => {
    const rangeRover = 50000; // 50 km
    const rangeBase = 49000;  // 49 km
    const sd1 = computeSingleDifferencePhase(rangeRover, rangeBase, 0, 0);

    // Delta range = 1000m -> cycles = 1000 / 2997.92458
    expect(sd1).toBeCloseTo(1000 / LF_WAVELENGTH_METERS, 6);

    const sd2 = computeSingleDifferencePhase(60000, 59500, 0, 0); // 500m
    const dd = computeDoubleDifferencePhase(sd2, sd1);
    expect(dd).toBeCloseTo((500 - 1000) / LF_WAVELENGTH_METERS, 6);
  });

  it('resolves integer cycle ambiguities when within tolerance', () => {
    const approx = [1.02, -3.95, 0.04];
    const observed = [5.01, 2.06, 3.03]; // true ambiguities: 4, 6, 3

    const res = resolveIntegerAmbiguities(observed, approx);
    expect(res.success).toBe(true);
    expect(res.resolvedAmbiguities).toEqual([4, 6, 3]);
    expect(res.residualsCycles[0]).toBeCloseTo(0.01, 3);
  });

  it('solves relative RTK baseline vector with sub-meter accuracy', () => {
    // 3 stations forming good geometric diversity
    const unitVectors = [
      { ue: 1.0, un: 0.0 }, // East
      { ue: 0.0, un: 1.0 }, // North
      { ue: -0.7071, un: -0.7071 }, // Southwest
    ];

    // True relative offset: +15.5m East, +22.0m North
    const trueDx = 15.5;
    const trueDy = 22.0;

    const residuals = unitVectors.map((v) => v.ue * trueDx + v.un * trueDy);

    const fix = solveRtkBaseline(unitVectors, residuals);
    expect(fix.deltaEastMeters).toBeCloseTo(trueDx, 4);
    expect(fix.deltaNorthMeters).toBeCloseTo(trueDy, 4);
    expect(fix.baselineLengthMeters).toBeCloseTo(Math.hypot(trueDx, trueDy), 4);
  });
});
