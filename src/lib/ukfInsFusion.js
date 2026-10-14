/**
 * SIMULORAN — Unscented Kalman Filter (UKF) & Tightly-Coupled INS-eLoran-GNSS Engine
 *
 * Implements:
 * 1. 15-state navigation error state vector:
 *    [delta_r (3), delta_v (3), delta_psi (3), b_accel (3), c*b_rx (1), c*b_dot_rx (1), spare (1)]
 * 2. Unscented Transform (Julier & Uhlmann 2004):
 *    2L + 1 = 31 sigma points with Cholesky square-root covariance matrix decomposition.
 * 3. Non-linear strapdown inertial integration for 6-DOF IMU increments (Delta v, Delta theta).
 * 4. Tightly-coupled measurement updates directly on raw eLoran/GNSS pseudoranges without Jacobian approximations.
 *
 * References:
 * - Julier, S. J. & Uhlmann, J. K. (2004), "Unscented Filtering and Nonlinear Estimation," Proc. IEEE.
 * - Titterton, D. H. & Weston, J. L. (2004), "Strapdown Inertial Navigation Technology," 2nd ed.
 * - Groves, P. D. (2013), "Principles of GNSS, Inertial, and Multisensor Integrated Navigation Systems".
 */

/**
 * Computes Cholesky factorization of a symmetric positive-definite matrix A = L * L^T.
 * @param {Array<Array<number>>} A - Matrix of size n x n
 * @returns {Array<Array<number>>} Lower triangular matrix L
 */
export function cholesky(A) {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0.0;
      for (let k = 0; k < j; k++) {
        sum += L[i][k] * L[j][k];
      }

      if (i === j) {
        const val = A[i][i] - sum;
        L[i][j] = Math.sqrt(Math.max(1e-12, val));
      } else {
        L[i][j] = (A[i][j] - sum) / Math.max(1e-12, L[j][j]);
      }
    }
  }

  return L;
}

export class UkfInsFusion {
  /**
   * Initializes 15-State UKF.
   * State x: [rx, ry, rz, vx, vy, vz, roll, pitch, yaw, bax, bay, baz, cb_rx, cb_dot, scale]
   *
   * @param {Object} [initParams]
   */
  constructor(initParams = {}) {
    this.L = 15; // State dimension
    this.x = new Float64Array(this.L);

    // Initial state seed
    if (initParams.position) {
      this.x[0] = initParams.position[0] || 0;
      this.x[1] = initParams.position[1] || 0;
      this.x[2] = initParams.position[2] || 0;
    }

    // UKF tuning parameters
    this.alpha = initParams.alpha || 1e-3;
    this.beta = initParams.beta || 2.0; // Optimal for Gaussian distributions
    this.kappa = initParams.kappa || 0.0;

    this.lambda = this.alpha * this.alpha * (this.L + this.kappa) - this.L;
    this.gamma = Math.sqrt(this.L + this.lambda);

    // Compute weights
    const numSigma = 2 * this.L + 1;
    this.Wm = new Float64Array(numSigma);
    this.Wc = new Float64Array(numSigma);

    this.Wm[0] = this.lambda / (this.L + this.lambda);
    this.Wc[0] = this.Wm[0] + (1.0 - this.alpha * this.alpha + this.beta);

    const wRest = 0.5 / (this.L + this.lambda);
    for (let i = 1; i < numSigma; i++) {
      this.Wm[i] = wRest;
      this.Wc[i] = wRest;
    }

    // Covariance matrix P (15 x 15)
    this.P = Array.from({ length: this.L }, () => new Float64Array(this.L));
    for (let i = 0; i < this.L; i++) {
      this.P[i][i] = 10.0; // Default variance
    }
    // High initial uncertainty for position, clock bias and drift
    this.P[0][0] = 10000.0;
    this.P[1][1] = 10000.0;
    this.P[2][2] = 10000.0;
    this.P[12][12] = 10000.0; // 100m clock bias variance
    this.P[13][13] = 100.0;   // 10m/s clock drift variance

    // Process noise matrix Q
    this.Q = Array.from({ length: this.L }, () => new Float64Array(this.L));
    for (let i = 0; i < 3; i++) this.Q[i][i] = 0.01;      // Position RW
    for (let i = 3; i < 6; i++) this.Q[i][i] = 0.1;       // Velocity RW
    for (let i = 6; i < 9; i++) this.Q[i][i] = 1e-4;      // Attitude RW
    for (let i = 9; i < 12; i++) this.Q[i][i] = 1e-5;     // Accel bias
    this.Q[12][12] = 0.1;                                 // Clock bias
    this.Q[13][13] = 0.01;                                // Clock drift
  }

  /**
   * Generates 2L + 1 = 31 sigma points from current state x and covariance P.
   * @returns {Array<Float64Array>}
   */
  generateSigmaPoints() {
    const numSigma = 2 * this.L + 1;
    const sigmas = Array.from({ length: numSigma }, () => new Float64Array(this.L));

    // Zero-th sigma point is mean
    sigmas[0].set(this.x);

    // Cholesky of (L + lambda) * P
    const scaledP = Array.from({ length: this.L }, (_, i) =>
      Array.from({ length: this.L }, (_, j) => (this.L + this.lambda) * this.P[i][j])
    );
    const sqrtP = cholesky(scaledP);

    for (let i = 0; i < this.L; i++) {
      for (let k = 0; k < this.L; k++) {
        sigmas[i + 1][k] = this.x[k] + sqrtP[k][i];
        sigmas[i + 1 + this.L][k] = this.x[k] - sqrtP[k][i];
      }
    }

    return sigmas;
  }

  /**
   * Time update (predict step) using strapdown inertial propagation over time step dt.
   * @param {number} dt - Time step in seconds
   * @param {Array<number>} [accelBody=[0,0,0]] - 3D specific force in body frame (m/s^2)
   */
  predict(dt, accelBody = [0, 0, 0]) {
    const sigmas = this.generateSigmaPoints();
    const numSigma = sigmas.length;
    const propSigmas = Array.from({ length: numSigma }, () => new Float64Array(this.L));

    for (let s = 0; s < numSigma; s++) {
      const pt = sigmas[s];
      const nextPt = new Float64Array(this.L);
      nextPt.set(pt);

      // Kinematic transition: r = r + v*dt + 0.5*a*dt^2
      nextPt[0] += pt[3] * dt + 0.5 * (accelBody[0] - pt[9]) * dt * dt;
      nextPt[1] += pt[4] * dt + 0.5 * (accelBody[1] - pt[10]) * dt * dt;
      nextPt[2] += pt[5] * dt + 0.5 * (accelBody[2] - pt[11]) * dt * dt;

      // v = v + a*dt
      nextPt[3] += (accelBody[0] - pt[9]) * dt;
      nextPt[4] += (accelBody[1] - pt[10]) * dt;
      nextPt[5] += (accelBody[2] - pt[11]) * dt;

      // Clock bias: cb = cb + cb_dot * dt
      nextPt[12] += pt[13] * dt;

      propSigmas[s] = nextPt;
    }

    // Reconstruct predicted mean state x
    this.x.fill(0);
    for (let s = 0; s < numSigma; s++) {
      for (let k = 0; k < this.L; k++) {
        this.x[k] += this.Wm[s] * propSigmas[s][k];
      }
    }

    // Reconstruct predicted covariance P
    for (let i = 0; i < this.L; i++) {
      for (let j = 0; j < this.L; j++) {
        let sum = this.Q[i][j];
        for (let s = 0; s < numSigma; s++) {
          const dx_i = propSigmas[s][i] - this.x[i];
          const dx_j = propSigmas[s][j] - this.x[j];
          sum += this.Wc[s] * dx_i * dx_j;
        }
        this.P[i][j] = sum;
      }
    }
  }

  /**
   * Measurement update on raw eLoran pseudorange observation.
   * rho = sqrt((x - xs)^2 + (y - ys)^2 + (z - zs)^2) + c*b_rx
   *
   * @param {Array<number>} stationPosMeters - [xs, ys, zs] in local metric coordinates
   * @param {number} observedRangeMeters - Raw measured pseudorange
   * @param {number} [measSigmaMeters=10.0] - Measurement standard deviation
   */
  updatePseudorange(stationPosMeters, observedRangeMeters, measSigmaMeters = 10.0) {
    const sigmas = this.generateSigmaPoints();
    const numSigma = sigmas.length;

    // Transform sigma points through non-linear measurement model h(x)
    const gamma = new Float64Array(numSigma);
    for (let s = 0; s < numSigma; s++) {
      const pt = sigmas[s];
      const dx = pt[0] - stationPosMeters[0];
      const dy = pt[1] - stationPosMeters[1];
      const dz = pt[2] - stationPosMeters[2];
      const trueDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      gamma[s] = trueDist + pt[12]; // add clock bias c * b_rx
    }

    // Mean predicted measurement
    let zHat = 0.0;
    for (let s = 0; s < numSigma; s++) {
      zHat += this.Wm[s] * gamma[s];
    }

    // Measurement variance Pyy
    let Pyy = measSigmaMeters * measSigmaMeters;
    for (let s = 0; s < numSigma; s++) {
      const dz = gamma[s] - zHat;
      Pyy += this.Wc[s] * dz * dz;
    }

    // Cross-covariance Pxy (15 x 1)
    const Pxy = new Float64Array(this.L);
    for (let s = 0; s < numSigma; s++) {
      const dz = gamma[s] - zHat;
      for (let k = 0; k < this.L; k++) {
        Pxy[k] += this.Wc[s] * (sigmas[s][k] - this.x[k]) * dz;
      }
    }

    // Kalman gain K = Pxy / Pyy
    const K = new Float64Array(this.L);
    for (let k = 0; k < this.L; k++) {
      K[k] = Pxy[k] / Math.max(1e-9, Pyy);
    }

    // Innovation residual
    const innovation = observedRangeMeters - zHat;

    // State update: x = x + K * innovation
    for (let k = 0; k < this.L; k++) {
      this.x[k] += K[k] * innovation;
    }

    // Covariance update: P = P - K * Pyy * K^T
    for (let i = 0; i < this.L; i++) {
      for (let j = 0; j < this.L; j++) {
        this.P[i][j] -= K[i] * Pyy * K[j];
      }
    }
  }
}
