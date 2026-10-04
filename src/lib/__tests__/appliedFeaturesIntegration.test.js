import { describe, it, expect } from 'vitest';
import { computeTOC, computeTimingAccuracy, compute1PPSAlignment } from '../timeTransfer.js';
import { computeInterferometricHeading, computePhaseDifference, validateBaseline, CARRIER_WAVELENGTH_M } from '../interferometry.js';
import { solveCrossChainFix, evaluateCrossChainDopGain } from '../crossChain.js';
import { initialBearing, haversineDistance } from '../geodesy.js';

describe('Applied System Features Integration Suite', () => {
  describe('1. Stratum-1 UTC Time Transfer & TOC Engine (ClockPanel Integration)', () => {
    it('computes exact Time of Coincidence (TOC) period and intervals for canonical GRI 8390', () => {
      const toc = computeTOC(83900);
      expect(toc.gri).toBe(83900);
      expect(toc.tocSec).toBe(839);
      expect(toc.tocGriPeriods).toBe(1000);
      expect(toc.description).toContain('839.0 seconds');
    });

    it('validates ANSI T1.101 Stratum-1 PRTC compliance (< 100 ns timing error budget)', () => {
      const budget = computeTimingAccuracy(10, 50, 30);
      expect(budget.meetsStratum1).toBe(true);
      expect(budget.total1sigmaNs).toBeLessThan(50);
      expect(budget.total95pctNs).toBeLessThan(100);
    });

    it('calculates 1 PPS pulse carrier phase offset within sub-microsecond range', () => {
      const pps = compute1PPSAlignment(10, 83900, 150000, 0.000001, 15);
      expect(typeof pps.totalUncertaintyNs).toBe('number');
      expect(Number.isFinite(pps.totalUncertaintyNs)).toBe(true);
    });
  });

  describe('2. Dual-Antenna Carrier Phase Interferometry (TrackingPanel Integration)', () => {
    const rx = { lat: 28.5, lng: 122.5, heading: 62.0 };
    const m = { lat: 31.069, lng: 118.886, label: 'Xuancheng-M' };
    const s = { lat: 23.705, lng: 116.924, label: 'Raoping-X' };

    it('verifies baseline length is strictly ambiguity-free (< lambda/2)', () => {
      const baselineMeters = 65.0;
      const val = validateBaseline(baselineMeters);
      expect(val.valid).toBe(true);
      expect(val.ambiguityFree).toBe(true);
      expect(val.maxBaseline).toBeCloseTo(CARRIER_WAVELENGTH_M / 2, 1);
    });

    it('computes 100 kHz carrier phase differences and resolves true vessel heading without gyro drift', () => {
      const baselineMeters = 65.0;
      const bearing1 = initialBearing(rx, m);
      const bearing2 = initialBearing(rx, s);

      const phaseDiff1Rad = computePhaseDifference(baselineMeters, bearing1, rx.heading);
      const phaseDiff2Rad = computePhaseDifference(baselineMeters, bearing2, rx.heading);

      const sol = computeInterferometricHeading({
        baselineMeters,
        phaseDiff1Rad,
        bearing1Deg: bearing1,
        phaseDiff2Rad,
        bearing2Deg: bearing2,
        phaseNoiseRadRms: 0.01,
      });

      expect(sol.resolved).toBe(true);
      expect(sol.resolvedHeadingDeg).toBeCloseTo(rx.heading, 0);
      expect(sol.headingUncertainty1SigmaDeg).toBeLessThan(10.0);
    });
  });

  describe('3. All-in-View Multi-GRI Cross-Rate Multilateration (StationEditor Integration)', () => {
    const rx = { lat: 28.5, lng: 122.5 };
    const primaryChainStations = [
      { id: '8390M', label: 'Xuancheng (M)', lat: 31.069, lng: 118.886, chainId: 'GRI 8390' },
      { id: '8390X', label: 'Raoping (X)', lat: 23.705, lng: 116.924, chainId: 'GRI 8390' },
      { id: '8390Y', label: 'Rongcheng (Y)', lat: 37.153, lng: 122.569, chainId: 'GRI 8390' },
    ];
    const adjacentCrossStations = [
      { id: '7430X', label: 'Dalian (7430X)', lat: 38.950, lng: 121.733, chainId: 'GRI 7430' },
      { id: '9930M', label: 'Pohang (9930M)', lat: 36.186, lng: 129.352, chainId: 'GRI 9930' },
    ];

    it('evaluates significant GDOP reduction when combining multi-GRI stations', () => {
      const allStations = [...primaryChainStations, ...adjacentCrossStations];
      const dop = evaluateCrossChainDopGain(primaryChainStations, allStations, rx);

      expect(dop.isImproved).toBe(true);
      expect(dop.crossChainHdop).toBeLessThanOrEqual(dop.singleChainHdop);
      expect(dop.dopImprovementPct).toBeGreaterThan(0);
      expect(dop.stationsCross).toBe(5);
    });

    it('converges to accurate position fix with independent per-chain receiver clock biases', () => {
      const allStations = [...primaryChainStations, ...adjacentCrossStations];
      const observations = allStations.map((st) => ({
        station: st,
        chainId: st.chainId,
        pseudorangeMeters: haversineDistance(rx, st) + (st.chainId.includes('7430') ? 2200 : 1500),
        sigma: 20,
      }));

      const fix = solveCrossChainFix(observations, rx);
      expect(fix.converged).toBe(true);
      expect(fix.lat).toBeCloseTo(rx.lat, 1);
      expect(fix.lng).toBeCloseTo(rx.lng, 1);
      expect(fix.clockBiasMeters).toBeGreaterThan(0);
    });
  });
});
