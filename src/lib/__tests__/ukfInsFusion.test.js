import { describe, it, expect } from 'vitest';
import { UkfInsFusion, cholesky } from '../ukfInsFusion.js';

describe('Unscented Kalman Filter & INS-eLoran Engine (ukfInsFusion.js)', () => {
  it('computes valid Cholesky factorization of symmetric positive-definite matrix', () => {
    const A = [
      [4, 12, -16],
      [12, 37, -43],
      [-16, -43, 98],
    ];
    const L = cholesky(A);

    expect(L[0][0]).toBeCloseTo(2.0, 4);
    expect(L[1][0]).toBeCloseTo(6.0, 4);
    expect(L[1][1]).toBeCloseTo(1.0, 4);
  });

  it('generates 31 sigma points with correct dimensions for 15-state model', () => {
    const ukf = new UkfInsFusion({ position: [1000, 2000, 0] });
    const sigmas = ukf.generateSigmaPoints();

    expect(sigmas.length).toBe(31); // 2L + 1 = 31
    expect(sigmas[0][0]).toBe(1000); // 0-th point is mean
    expect(sigmas[0][1]).toBe(2000);
  });

  it('predicts vehicle kinematics under constant velocity and acceleration', () => {
    const ukf = new UkfInsFusion({ position: [0, 0, 0] });
    ukf.x[3] = 10.0; // vx = 10 m/s
    ukf.predict(2.0, [0, 0, 0]); // 2 seconds forward

    expect(ukf.x[0]).toBeCloseTo(20.0, 2); // r = r + v*dt = 20m
  });

  it('converges position and clock bias using sequential pseudorange updates', () => {
    const truePos = [500.0, 800.0, 0.0];
    const trueClockBias = 150.0; // meters

    const ukf = new UkfInsFusion({ position: [0, 0, 0] }); // starts at origin
    ukf.x[12] = 0.0; // clock bias initial guess 0

    const stations = [
      [10000.0, 0.0, 0.0],
      [0.0, 10000.0, 0.0],
      [-10000.0, 0.0, 0.0],
      [0.0, -10000.0, 0.0],
    ];

    // Multi-epoch filtering iterations
    for (let epoch = 0; epoch < 15; epoch++) {
      ukf.predict(0.1);
      for (const st of stations) {
        const dx = truePos[0] - st[0];
        const dy = truePos[1] - st[1];
        const dz = truePos[2] - st[2];
        const trueDist = Math.hypot(dx, dy, dz);
        const pseudorange = trueDist + trueClockBias;

        ukf.updatePseudorange(st, pseudorange, 2.0);
      }
    }

    // Filter converges close to true position and clock bias
    expect(Math.abs(ukf.x[0] - truePos[0])).toBeLessThan(2.0);
    expect(Math.abs(ukf.x[1] - truePos[1])).toBeLessThan(2.0);
    expect(Math.abs(ukf.x[12] - trueClockBias)).toBeLessThan(2.0);
  });
});
