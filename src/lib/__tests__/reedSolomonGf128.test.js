import { describe, it, expect } from 'vitest';
import {
  gfMul,
  gfInv,
  encodeRs3010,
  decodeRs3010,
  EXP_TABLE,
  LOG_TABLE,
} from '../reedSolomonGf128.js';

describe('Galois Field GF(128) & Reed-Solomon RS(30, 10) Codec (reedSolomonGf128.js)', () => {
  it('satisfies Galois Field GF(128) arithmetic axioms', () => {
    // Multiplicative identity
    expect(gfMul(42, 1)).toBe(42);
    expect(gfMul(0, 100)).toBe(0);

    // Multiplicative inverse: a * a^-1 = 1 for all non-zero elements
    for (let i = 1; i < 128; i++) {
      const inv = gfInv(i);
      expect(gfMul(i, inv)).toBe(1);
    }
  });

  it('performs systematic encoding producing 30 symbols from 10 message symbols', () => {
    const message = [10, 25, 42, 7, 99, 120, 3, 55, 68, 14];
    const codeword = encodeRs3010(message);

    expect(codeword.length).toBe(30);
    // Systematic property: first 10 symbols are identical to message
    expect(codeword.slice(0, 10)).toEqual(message);
  });

  it('decodes clean codeword with zero errors', () => {
    const message = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const codeword = encodeRs3010(message);

    const decoded = decodeRs3010(codeword);
    expect(decoded.success).toBe(true);
    expect(decoded.errorsCorrected).toBe(0);
    expect(decoded.corrected).toEqual(codeword);
  });

  it('detects and corrects up to 3 corrupted symbols in transmission', () => {
    const message = [12, 34, 56, 78, 90, 11, 22, 33, 44, 55];
    const codeword = encodeRs3010(message);

    // Inject 3 random byte/symbol corruptions
    const corrupted = [...codeword];
    corrupted[2] ^= 0x1F;
    corrupted[11] ^= 0x47;
    corrupted[28] ^= 0x33;

    const decoded = decodeRs3010(corrupted);
    expect(decoded.success).toBe(true);
    expect(decoded.errorsCorrected).toBe(3);
    expect(decoded.corrected).toEqual(codeword);
    expect(decoded.corrected.slice(0, 10)).toEqual(message);
  });
});
