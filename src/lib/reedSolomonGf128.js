/**
 * SIMULORAN — Galois Field GF(128) & Reed-Solomon RS(30, 10) Codec
 *
 * Implements:
 * 1. Galois Field GF(2^7) = GF(128) arithmetic with primitive polynomial p(x) = x^7 + x^3 + 1 (0x89).
 * 2. Exponential (antilog) and logarithm lookup tables for field multiplication, inversion, and division.
 * 3. Systematic Reed-Solomon RS(30, 10) encoder: 10 message symbols (70 bits), 20 parity symbols (140 bits).
 * 4. Berlekamp-Massey / Chien search / Forney syndrome decoder correcting up to 5 symbol errors.
 *
 * References:
 * - International Loran Association (ILA), "eLoran Definition Document" (2007).
 * - RTCM Paper 80-2007/SC127-MS41, "Loran Data Channel Technical Specification".
 * - Lin, S. & Costello, D. J. (2004), "Error Control Coding: Fundamentals and Applications".
 */

export const GF_ORDER = 128;
export const PRIMITIVE_POLY = 0x89; // x^7 + x^3 + 1

// Field lookup tables
export const EXP_TABLE = new Uint8Array(256);
export const LOG_TABLE = new Uint8Array(GF_ORDER);

// Initialize GF(128) tables
(function initGf128Tables() {
  let x = 1;
  for (let i = 0; i < 127; i++) {
    EXP_TABLE[i] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x & 128) {
      x ^= PRIMITIVE_POLY;
    }
  }
  for (let i = 127; i < 256; i++) {
    EXP_TABLE[i] = EXP_TABLE[i - 127];
  }
  LOG_TABLE[0] = 0; // Log of 0 is undefined, set to 0 by convention
})();

/**
 * Multiplies two elements in GF(128).
 * @param {number} a
 * @param {number} b
 * @returns {number} Product in GF(128)
 */
export function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a] + LOG_TABLE[b]) % 127];
}

/**
 * Inverts an element in GF(128).
 * @param {number} a
 * @returns {number} Multiplicative inverse in GF(128)
 */
export function gfInv(a) {
  if (a === 0) throw new Error('Division by zero in GF(128)');
  return EXP_TABLE[127 - LOG_TABLE[a]];
}

/**
 * Multiplies two polynomials over GF(128).
 * @param {Array<number>} p
 * @param {Array<number>} q
 * @returns {Array<number>}
 */
export function polyMul(p, q) {
  const result = new Array(p.length + q.length - 1).fill(0);
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      result[i + j] ^= gfMul(p[i], q[j]);
    }
  }
  return result;
}

/**
 * Computes generator polynomial g(x) = prod_{i=1}^{20} (x - alpha^i) for RS(30, 10).
 * @returns {Array<number>} 21 coefficients of g(x) (highest degree first)
 */
export function computeRs3010GeneratorPoly() {
  let g = [1];
  for (let i = 1; i <= 20; i++) {
    const root = EXP_TABLE[i];
    g = polyMul(g, [1, root]);
  }
  return g;
}

const GENERATOR_POLY_RS3010 = computeRs3010GeneratorPoly();

/**
 * Encodes 10 message symbols into 30 systematic code symbols using RS(30, 10).
 * Code word layout: [m_0, m_1, ..., m_9, p_0, p_1, ..., p_19]
 *
 * @param {Array<number>} messageSymbols - 10 symbols each in [0, 127]
 * @returns {Array<number>} 30 systematic code symbols in [0, 127]
 */
export function encodeRs3010(messageSymbols) {
  if (messageSymbols.length !== 10) {
    throw new Error(`RS(30,10) requires exactly 10 message symbols, got ${messageSymbols.length}`);
  }

  const remainder = new Array(20).fill(0);
  for (let i = 0; i < 10; i++) {
    const feedback = messageSymbols[i] ^ remainder[0];
    for (let j = 0; j < 19; j++) {
      remainder[j] = remainder[j + 1] ^ gfMul(feedback, GENERATOR_POLY_RS3010[j + 1]);
    }
    remainder[19] = gfMul(feedback, GENERATOR_POLY_RS3010[20]);
  }

  return [...messageSymbols, ...remainder];
}


/**
 * Decodes 30 received symbols using RS(30, 10) Berlekamp-Massey & Forney algorithms.
 * Corrects up to 5 symbol errors.
 *
 * @param {Array<number>} receivedSymbols - 30 symbols in [0, 127]
 * @returns {{ corrected: Array<number>, errorsCorrected: number, success: boolean }}
 */
export function decodeRs3010(receivedSymbols) {
  if (receivedSymbols.length !== 30) {
    throw new Error('Received codeword must have length 30');
  }

  // 1. Calculate 20 syndromes S_1 .. S_20: S_i = r(alpha^i)
  const syndromes = new Array(20);
  let hasErrors = false;
  for (let i = 1; i <= 20; i++) {
    const root = EXP_TABLE[i];
    let syn = 0;
    for (let j = 0; j < 30; j++) {
      syn = gfMul(syn, root) ^ receivedSymbols[j];
    }
    syndromes[i - 1] = syn;
    if (syn !== 0) hasErrors = true;
  }

  if (!hasErrors) {
    return {
      corrected: [...receivedSymbols],
      errorsCorrected: 0,
      success: true,
    };
  }

  // 2. Berlekamp-Massey algorithm to find error locator polynomial Lambda(x)
  let lambda = [1];
  let b = [1];
  let l = 0;
  let k = 1;

  for (let n = 0; n < 20; n++) {
    // Discrepancy delta = sum_{i=0}^l lambda_i * S_{n-i}
    let delta = syndromes[n];
    for (let i = 1; i <= l; i++) {
      if (i < lambda.length) {
        delta ^= gfMul(lambda[i], syndromes[n - i]);
      }
    }

    if (delta === 0) {
      k++;
    } else {
      const bScaled = b.map((c) => gfMul(c, delta));
      const bShifted = new Array(k).fill(0).concat(bScaled);

      // New lambda = lambda ^ (delta * x^k * b)
      const maxLen = Math.max(lambda.length, bShifted.length);
      const newLambda = new Array(maxLen).fill(0);
      for (let i = 0; i < lambda.length; i++) newLambda[i] ^= lambda[i];
      for (let i = 0; i < bShifted.length; i++) newLambda[i] ^= bShifted[i];

      if (2 * l <= n) {
        const deltaInv = gfInv(delta);
        b = lambda.map((c) => gfMul(c, deltaInv));
        l = n + 1 - l;
        k = 1;
      } else {
        k++;
      }
      lambda = newLambda;
    }
  }

  const numErrors = l;
  if (numErrors > 10) {
    return { corrected: [...receivedSymbols], errorsCorrected: 0, success: false };
  }

  // 3. Chien search: roots of Lambda(x) indicate error positions
  const errorPositions = [];
  for (let i = 0; i < 30; i++) {
    let sum = 0;
    for (let deg = 0; deg < lambda.length; deg++) {
      sum ^= gfMul(lambda[deg], EXP_TABLE[(deg * (127 - (29 - i))) % 127]);
    }
    if (sum === 0) {
      errorPositions.push(i);
    }
  }

  if (errorPositions.length !== numErrors) {
    return { corrected: [...receivedSymbols], errorsCorrected: 0, success: false };
  }

  // 4. Solve for exact error values over GF(128)
  const t = errorPositions.length;
  const X = errorPositions.map((pos) => EXP_TABLE[29 - pos]);

  // Matrix M (t x (t+1))
  const M = Array.from({ length: t }, (_, row) =>
    Array.from({ length: t + 1 }, (_, col) => {
      if (col < t) {
        let val = 1;
        for (let p = 0; p <= row; p++) val = gfMul(val, X[col]);
        return val;
      }
      return syndromes[row];
    })
  );

  for (let col = 0; col < t; col++) {
    let pivRow = col;
    while (pivRow < t && M[pivRow][col] === 0) pivRow++;
    if (pivRow === t) return { corrected: [...receivedSymbols], errorsCorrected: 0, success: false };
    if (pivRow !== col) {
      const tmp = M[col];
      M[col] = M[pivRow];
      M[pivRow] = tmp;
    }
    const invPiv = gfInv(M[col][col]);
    for (let j = 0; j <= t; j++) M[col][j] = gfMul(M[col][j], invPiv);

    for (let r = 0; r < t; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor !== 0) {
        for (let j = 0; j <= t; j++) {
          M[r][j] ^= gfMul(factor, M[col][j]);
        }
      }
    }
  }

  const corrected = [...receivedSymbols];
  for (let k = 0; k < t; k++) {
    corrected[errorPositions[k]] ^= M[k][t];
  }

  return {
    corrected,
    errorsCorrected: errorPositions.length,
    success: true,
  };
}
