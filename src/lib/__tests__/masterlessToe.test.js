import { describe, it, expect } from 'vitest';
import {
  computeStationToeEpoch,
  solveMasterlessFix,
} from '../masterlessToe.js';
import { haversineDistance } from '../geodesy.js';

describe('Masterless Multi-Chain Time-of-Emission (TOE) Engine (masterlessToe.js)', () => {
  it('computes periodic TOE epochs and phase fractions correctly', () => {
    const epochSec = 10.0;
    const griUs = 99300; // 0.0993 sec
    const toe = computeStationToeEpoch(epochSec, griUs);

    expect(toe.lastToeSec).toBeLessThanOrEqual(epochSec);
    expect(toe.nextToeSec).toBeGreaterThan(epochSec);
    expect(toe.nextToeSec - toe.lastToeSec).toBeCloseTo(0.0993, 4);
    expect(toe.pulsePhaseFraction).toBeGreaterThanOrEqual(0.0);
    expect(toe.pulsePhaseFraction).toBeLessThanOrEqual(1.0);
  });

  it('solves all-in-view position fix without ANY master station in view', () => {
    // 4 secondary stations from multiple different chains (GRI 9930, 8390, 7430)
    const trueLat = 37.5;
    const trueLng = 126.8;
    const trueClockBiasMeters = 450.0; // ~1.5 us receiver clock offset

    const stations = [
      { id: 'S1-9930', label: 'W', lat: 38.0, lng: 126.0, griUs: 99300, isMaster: false },
      { id: 'S2-9930', label: 'X', lat: 37.0, lng: 127.5, griUs: 99300, isMaster: false },
      { id: 'S3-8390', label: 'Y', lat: 36.8, lng: 126.2, griUs: 83900, isMaster: false },
      { id: 'S4-7430', label: 'Z', lat: 37.9, lng: 127.6, griUs: 74300, isMaster: false },
    ];

    const observations = stations.map((st) => {
      const dist = haversineDistance(trueLat, trueLng, st.lat, st.lng);
      return {
        station: st,
        pseudorangeMeters: dist + trueClockBiasMeters,
        sigmaMeters: 5.0,
      };
    });

    const fix = solveMasterlessFix(observations, { lat: 37.0, lng: 126.5 });

    expect(fix.converged).toBe(true);
    expect(fix.hasMasterInView).toBe(false); // Masterless confirmed!
    expect(fix.lat).toBeCloseTo(trueLat, 4);
    expect(fix.lng).toBeCloseTo(trueLng, 4);
    expect(fix.clockBiasMeters).toBeCloseTo(trueClockBiasMeters, 2);
    expect(fix.hdop).toBeLessThan(5.0);
  });

  it('fails gracefully when fewer than 3 transmitters are in view', () => {
    const obs = [
      { station: { lat: 35, lng: 125, isMaster: false }, pseudorangeMeters: 100000 },
      { station: { lat: 36, lng: 126, isMaster: false }, pseudorangeMeters: 120000 },
    ];

    const fix = solveMasterlessFix(obs);
    expect(fix.converged).toBe(false);
    expect(fix.reason).toContain('at least 3 stations');
  });
});
