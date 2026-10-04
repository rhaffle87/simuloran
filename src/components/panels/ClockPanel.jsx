import React, { useEffect } from 'react';
import { Play, Pause, RotateCcw, Clock, Zap, ShieldCheck } from 'lucide-react';
import { useSimulationStore } from '../../state/simulationStore.js';
import { OSCILLATOR_PRESETS } from '../../lib/clocks.js';
import { computeTOC, computeTimingAccuracy } from '../../lib/timeTransfer.js';
import Slider from '../ui/Slider.jsx';
import InfoTooltip from '../ui/Tooltip.jsx';

export default function ClockPanel() {
  const {
    masters, simTimeSec, isSimRunning,
    setSimTime, toggleSimRunning, updateStation, evaluateReceivers,
  } = useSimulationStore();

  // Periodic simulation tick loop
  useEffect(() => {
    let interval = null;
    if (isSimRunning) {
      interval = setInterval(() => {
        setSimTime(simTimeSec + 1);
        evaluateReceivers();
      }, 1000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isSimRunning, simTimeSec, setSimTime, evaluateReceivers]);

  const master = masters[0];
  const currentGriUs = master?.griUs || (master?.griMs ? master.griMs * 1000 : 83900);
  const tocData = computeTOC(currentGriUs);
  const nextTocRemaining = Math.max(0, tocData.tocSec - (simTimeSec % tocData.tocSec));
  const timingStats = computeTimingAccuracy(10, 50, 30);
  const ppsOffsetNs = ((simTimeSec * 1e9) % (currentGriUs * 1000)) / 1000 % 100;

  const handleOscillatorChange = (presetKey) => {
    const preset = OSCILLATOR_PRESETS[presetKey];
    if (!preset || !master) return;
    updateStation(master.label, {
      clock: {
        type: presetKey,
        biasSec: preset.typicalBiasSec,
        driftPerSec: preset.typicalDriftSecPerSec,
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* Clock control card */}
      <div
        className="p-3 rounded-lg space-y-3 font-mono"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent-eloran)' }}>
            <Clock size={14} aria-hidden="true" /> Master Clock
          </div>
          <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {simTimeSec.toFixed(0)} <span className="text-xs font-normal" style={{ color: 'var(--text-dim)' }}>sec</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleSimRunning}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition cursor-pointer hover:opacity-90"
            style={isSimRunning
              ? { background: 'var(--status-warn-subtle)', border: '1px solid var(--status-warn-border)', color: 'var(--status-warn)' }
              : { background: 'var(--accent-eloran)', color: 'var(--btn-eloran-text)', border: '1px solid transparent' }}
            title={isSimRunning ? "Pause clock simulation" : "Start clock simulation"}
            aria-label={isSimRunning ? "Pause clock simulation" : "Start clock simulation"}
          >
            {isSimRunning ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Run Clock</>}
          </button>
          <button
            onClick={() => setSimTime(0)}
            className="p-1.5 rounded-lg transition cursor-pointer hover:text-[var(--text-primary)]"
            style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
            title="Reset Time to 0s"
            aria-label="Reset simulation time to 0 seconds"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      {/* Stratum-1 eLoran UTC Time Transfer & TOC Engine */}
      <div
        data-testid="stratum1-timetransfer-card"
        className="p-3 rounded-lg space-y-3 font-mono text-xs"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px]" style={{ color: 'var(--accent-eloran)' }}>
            <Zap size={13} aria-hidden="true" />
            <span>Stratum-1 UTC Time Transfer</span>
          </div>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center gap-1"
            style={timingStats.meetsStratum1
              ? { background: 'var(--status-ok-subtle)', color: 'var(--status-ok)', border: '1px solid var(--status-ok-border)' }
              : { background: 'var(--status-warn-subtle)', color: 'var(--status-warn)', border: '1px solid var(--status-warn-border)' }}
          >
            <ShieldCheck size={11} />
            <span>{timingStats.meetsStratum1 ? 'PRTC < 100ns (PASS)' : 'DEGRADED'}</span>
          </span>
        </div>

        {/* TOC Parameters */}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="p-2 rounded bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
            <div className="text-[10px] text-[var(--text-dim)] uppercase">Time of Coincidence (TOC)</div>
            <div className="font-bold text-[var(--text-primary)] mt-0.5">{tocData.tocSec.toFixed(1)} s ({tocData.tocGriPeriods} GRIs)</div>
            <div className="text-[9px] text-[var(--text-dim)]">UTC 1 PPS Coincidence</div>
          </div>
          <div className="p-2 rounded bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
            <div className="text-[10px] text-[var(--text-dim)] uppercase">Next TOC Epoch</div>
            <div className="font-bold text-[var(--text-primary)] mt-0.5">{nextTocRemaining.toFixed(1)} s</div>
            <div className="text-[9px] text-[var(--accent-eloran)]">{currentGriUs} µs GRI</div>
          </div>
        </div>

        {/* 1 PPS Alignment & Uncertainty Budget */}
        <div className="p-2.5 rounded bg-[var(--bg-canvas)] border border-[var(--border-subtle)] space-y-1.5 text-[11px]">
          <div className="flex justify-between items-center">
            <span className="text-[var(--text-dim)]">1 PPS Carrier Offset:</span>
            <span className="font-bold text-[var(--accent-eloran)] font-mono">{ppsOffsetNs.toFixed(2)} ns</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[var(--text-dim)]">Receiver Jitter (10 avg):</span>
            <span className="font-mono text-[var(--text-primary)]">±{timingStats.averagedJitterNs.toFixed(1)} ns</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[var(--text-dim)]">Spatial ASF Uncertainty:</span>
            <span className="font-mono text-[var(--text-primary)]">±{timingStats.asfUncertaintyNs.toFixed(1)} ns</span>
          </div>
          <div className="pt-1 border-t border-[var(--border-subtle)] flex justify-between items-center">
            <span className="font-semibold text-[var(--text-primary)]">Combined 1σ Timing Error:</span>
            <span className="font-bold font-mono" style={{ color: timingStats.total1sigmaNs <= 50 ? 'var(--status-ok)' : 'var(--status-warn)' }}>
              ±{timingStats.total1sigmaNs.toFixed(1)} ns
            </span>
          </div>
        </div>

        <div className="text-[10px] text-[var(--text-dim)] leading-relaxed">
          eLoran transmitters are locked to UTC(BIPM) via Stratum-1 Cesium atomic frequency standards. Phase-locking to the 3rd zero crossing at Time of Coincidence (TOC) delivers autonomous, sovereign 1 PPS time transfer compliant with ANSI T1.101 Primary Reference Source requirements (&lt; 100 ns).
        </div>
      </div>

      {/* Oscillator Selector */}
      {master && (
        <div className="space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-dim)' }}>
            Master Frequency Standard
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {Object.entries(OSCILLATOR_PRESETS).map(([key, osc]) => {
              const isSelected = (master.clock?.type || 'gps-disciplined') === key;
              return (
                <div
                  key={key}
                  onClick={() => handleOscillatorChange(key)}
                  className="p-2.5 rounded-lg text-xs cursor-pointer transition select-none"
                  style={isSelected
                    ? { background: 'var(--accent-eloran-subtle)', border: '1px solid var(--accent-eloran-border)', color: 'var(--accent-eloran)' }
                    : { background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold truncate" style={{ color: isSelected ? 'var(--accent-eloran)' : 'var(--text-primary)' }}>
                        {osc.name}
                      </span>
                      <InfoTooltip text={osc.description} />
                    </div>
                    <span className="text-[10px] font-mono shrink-0 ml-2" style={{ color: 'var(--text-dim)' }}>
                      {osc.typicalDriftSecPerSec.toExponential(0)} s/s
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Clock Bias & Drift Tuning */}
          <div className="pt-2 space-y-3">
            <Slider
              label="Clock Bias Override"
              value={master.clock?.biasSec || 0}
              min={-0.0001} max={0.0001} step={0.000001} unit="s"
              tooltip="Fixed static timing synchronization offset"
              onChange={(val) => updateStation(master.label, { clock: { ...master.clock, biasSec: val } })}
            />
            <Slider
              label="Clock Drift Rate"
              value={master.clock?.driftPerSec || 0}
              min={-1e-8} max={1e-8} step={1e-10} unit="s/s"
              tooltip="Continuous oscillator frequency drift per elapsed second"
              onChange={(val) => updateStation(master.label, { clock: { ...master.clock, driftPerSec: val } })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
