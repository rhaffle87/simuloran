/**
 * SIMULORAN — Controlled Reception Pattern Antenna (CRPA) & Adaptive Beamforming
 *
 * Implements:
 * 1. Multi-element antenna steering vector synthesis for 100 kHz LF pulsed signals.
 * 2. Minimum Variance Distortionless Response (MVDR / Capon) beamformer.
 * 3. Deep spatial null-steering against Electronic Warfare jammers.
 *
 * References:
 * - Capon, J. (1969), "High-resolution frequency-wavenumber spectrum analysis," Proc. IEEE.
 * - USCG Electronic Warfare & Jamming Resistance Technical Reports (2007).
 * - RTCM 10410.1 (Anti-jamming antenna considerations).
 */

import { SPEED_OF_LIGHT } from './geodesy.js';

export const LF_LAMBDA_METERS = SPEED_OF_LIGHT / 100000; // ~2997.92 m

/**
 * Standard 4-element circular array geometry (radius r in meters).
 * @param {number} [radiusMeters=10.0] - Array radius
 * @returns {Array<{ x: number, y: number, z: number }>}
 */
export function createCircularArray(radiusMeters = 10.0) {
  const elements = [];
  const n = 4;
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    elements.push({
      x: radiusMeters * Math.cos(angle),
      y: radiusMeters * Math.sin(angle),
      z: 0,
    });
  }
  return elements;
}

/**
 * Computes complex steering vector for a given incident azimuth angle (degrees CW from North).
 *
 * @param {Array<{ x: number, y: number, z: number }>} arrayGeometry - Element positions in meters
 * @param {number} azimuthDeg - Angle in degrees (0 = North, 90 = East)
 * @param {number} [wavelengthMeters=LF_LAMBDA_METERS] - Carrier wavelength in meters
 * @returns {Array<{ re: number, im: number }>} Complex array steering vector
 */
export function computeSteeringVector(
  arrayGeometry,
  azimuthDeg,
  wavelengthMeters = LF_LAMBDA_METERS
) {
  const k = (2 * Math.PI) / wavelengthMeters;
  const azRad = (azimuthDeg * Math.PI) / 180;
  // Direction unit vector towards source: East = sin(az), North = cos(az)
  const ux = Math.sin(azRad);
  const uy = Math.cos(azRad);

  return arrayGeometry.map((elem) => {
    // Spatial phase advance: psi = k * (elem.x * ux + elem.y * uy)
    const psi = k * (elem.x * ux + elem.y * uy);
    return {
      re: Math.cos(psi),
      im: Math.sin(psi),
    };
  });
}

/**
 * Computes 4x4 matrix inverse for complex Hermitian sample covariance matrix.
 * Solves using Gauss-Jordan elimination with partial pivoting.
 */
function invertComplexMatrix(matrix) {
  const n = matrix.length;
  // Create augmented matrix [A | I]
  const aug = Array.from({ length: n }, (_, i) =>
    Array.from({ length: 2 * n }, (_, j) => {
      if (j < n) return { ...matrix[i][j] };
      return { re: i === j - n ? 1 : 0, im: 0 };
    })
  );

  for (let col = 0; col < n; col++) {
    // Pivot selection
    let maxRow = col;
    let maxVal = Math.hypot(aug[col][col].re, aug[col][col].im);
    for (let row = col + 1; row < n; row++) {
      const v = Math.hypot(aug[row][col].re, aug[row][col].im);
      if (v > maxVal) {
        maxVal = v;
        maxRow = row;
      }
    }
    if (maxVal < 1e-12) throw new Error('Singular covariance matrix');

    if (maxRow !== col) {
      const temp = aug[col];
      aug[col] = aug[maxRow];
      aug[maxRow] = temp;
    }

    // Scale pivot row
    const pivot = aug[col][col];
    const pivMag2 = pivot.re * pivot.re + pivot.im * pivot.im;
    const invPivot = { re: pivot.re / pivMag2, im: -pivot.im / pivMag2 };

    for (let j = 0; j < 2 * n; j++) {
      const cur = aug[col][j];
      aug[col][j] = {
        re: cur.re * invPivot.re - cur.im * invPivot.im,
        im: cur.re * invPivot.im + cur.im * invPivot.re,
      };
    }

    // Eliminate column in other rows
    for (let i = 0; i < n; i++) {
      if (i === col) continue;
      const factorRe = aug[i][col].re;
      const factorIm = aug[i][col].im;
      for (let j = 0; j < 2 * n; j++) {
        const subRe = factorRe * aug[col][j].re - factorIm * aug[col][j].im;
        const subIm = factorRe * aug[col][j].im + factorIm * aug[col][j].re;
        aug[i][j] = {
          re: aug[i][j].re - subRe,
          im: aug[i][j].im - subIm,
        };
      }
    }
  }

  // Extract right half
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => aug[i][j + n])
  );
}

/**
 * Computes MVDR (Minimum Variance Distortionless Response / Capon) adaptive weights.
 * Minimizes total output power subject to unit gain at desired signal azimuth.
 *
 * @param {Array<Array<{ re: number, im: number }>>} Rxx - Complex covariance matrix (N x N)
 * @param {Array<{ re: number, im: number }>} sVec - Steering vector toward desired transmitter
 * @returns {Array<{ re: number, im: number }>} Optimal complex weights w
 */
export function computeMvdrWeights(Rxx, sVec) {
  const n = sVec.length;
  const invR = invertComplexMatrix(Rxx);

  // v = invR * sVec
  const v = new Array(n);
  for (let i = 0; i < n; i++) {
    let sumRe = 0;
    let sumIm = 0;
    for (let j = 0; j < n; j++) {
      sumRe += invR[i][j].re * sVec[j].re - invR[i][j].im * sVec[j].im;
      sumIm += invR[i][j].re * sVec[j].im + invR[i][j].im * sVec[j].re;
    }
    v[i] = { re: sumRe, im: sumIm };
  }

  // denom = sVec^H * invR * sVec = sVec^H * v (scalar real)
  let denom = 0;
  for (let i = 0; i < n; i++) {
    // sVec^H conjugate: (re, -im) * (v.re, v.im) -> real part = s.re*v.re + s.im*v.im
    denom += sVec[i].re * v[i].re + sVec[i].im * v[i].im;
  }
  if (Math.abs(denom) < 1e-12) denom = 1e-12;

  // w = v / denom
  return v.map((elem) => ({
    re: elem.re / denom,
    im: elem.im / denom,
  }));
}

/**
 * Computes the spatial array gain in dB for a given weight vector and evaluation azimuth.
 *
 * @param {Array<{ re: number, im: number }>} weights - Complex beamformer weights
 * @param {Array<{ x: number, y: number, z: number }>} arrayGeometry - Element positions
 * @param {number} azimuthDeg - Evaluation angle (degrees CW from North)
 * @returns {{ gainLinear: number, gainDb: number }}
 */
export function computeArrayGain(weights, arrayGeometry, azimuthDeg) {
  const s = computeSteeringVector(arrayGeometry, azimuthDeg);
  let respRe = 0;
  let respIm = 0;

  // Array output: w^H * s = sum( conj(w_i) * s_i )
  for (let i = 0; i < weights.length; i++) {
    respRe += weights[i].re * s[i].re + weights[i].im * s[i].im;
    respIm += weights[i].re * s[i].im - weights[i].im * s[i].re;
  }

  const gainLinear = Math.hypot(respRe, respIm);
  const gainDb = 20 * Math.log10(Math.max(1e-6, gainLinear));
  return { gainLinear, gainDb };
}
