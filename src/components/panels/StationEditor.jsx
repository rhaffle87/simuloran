import React, { useRef, useState } from 'react';
import { Upload, Download, Plus, Trash2, FileCode, RotateCcw, Save, FolderOpen, Network, CheckCircle2 } from 'lucide-react';
import { useSimulationStore } from '../../state/simulationStore.js';
import { PRESET_SCENARIOS } from '../../state/presets.js';
import { parseStationsCsv, exportStationsCsv, exportScenarioGeoJson } from '../../lib/stations.js';
import { solveCrossChainFix, evaluateCrossChainDopGain } from '../../lib/crossChain.js';
import { haversineDistance } from '../../lib/geodesy.js';
import Modal from '../ui/Modal.jsx';
import { InfoTooltip } from '../ui/Tooltip.jsx';

const ROLE_COLOR_VAR = {
  master:   '--accent-eloran',
  slave:    '--accent-loran-c',
  receiver: '--status-ok',
};
const ROLE_LABEL = { master: 'MST', slave: 'SEC', receiver: 'RCV' };

const CANDIDATE_CROSS_STATIONS = [
  // East Asia / China
  { id: '7430M', label: 'Helong (7430M)', lat: 42.533, lng: 129.000, chainId: 'GRI 7430' },
  { id: '7430X', label: 'Dalian (7430X)', lat: 38.950, lng: 121.733, chainId: 'GRI 7430' },
  { id: '9930M', label: 'Pohang (9930M)', lat: 36.186, lng: 129.352, chainId: 'GRI 9930' },
  { id: '9930W', label: 'Kwangju (9930W)', lat: 35.043, lng: 126.705, chainId: 'GRI 9930' },
  // Europe / North Sea
  { id: '6731M', label: 'Lessay (6731M)', lat: 49.150, lng: -1.503, chainId: 'GRI 6731' },
  { id: '7499M', label: 'Sylt (7499M)', lat: 54.808, lng: 8.293, chainId: 'GRI 7499' },
  { id: '7499Y', label: 'Værlandet (7499Y)', lat: 61.297, lng: 4.696, chainId: 'GRI 7499' },
  { id: '9007M', label: 'Ejde (9007M)', lat: 62.298, lng: -7.070, chainId: 'GRI 9007' },
  // North America
  { id: '9960M', label: 'Seneca (9960M)', lat: 42.714, lng: -76.826, chainId: 'GRI 9960' },
  { id: '8970M', label: 'Dana (8970M)', lat: 39.854, lng: -87.486, chainId: 'GRI 8970' },
  { id: '7980M', label: 'Grangeville (7980M)', lat: 30.725, lng: -90.830, chainId: 'GRI 7980' },
];


export default function StationEditor({ isELoran = false }) {
  const fileInputRef = useRef(null);
  const jsonInputRef = useRef(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [newRole, setNewRole] = useState('slave');
  const [newLabel, setNewLabel] = useState('');
  const [newLat, setNewLat] = useState('-6.25');
  const [newLng, setNewLng] = useState('106.85');

  const {
    masters, slaves, receivers, activePresetId,
    loadPreset, addStation, removeStation, setStations, resetAll, evaluateReceivers,
    stationStatus = {}, setStationStatus,
  } = useSimulationStore();

  const [selectedCrossIds, setSelectedCrossIds] = useState(['7430X', '9930M']);

  const toggleCrossStation = (id) => {
    setSelectedCrossIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const [hasSavedChain, setHasSavedChain] = useState(() => {
    try { return Boolean(localStorage.getItem('simuloran:custom-chain')); } catch { return false; }
  });

  const handleExportJson = () => {
    const payload = {
      version: '1.5.1',
      exportedAt: new Date().toISOString(),
      masters,
      slaves,
      receivers,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simuloran-custom-chain-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleJsonUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result);
        if (Array.isArray(data.masters) && Array.isArray(data.slaves)) {
          setStations(data.masters, data.slaves, data.receivers || []);
          setTimeout(() => evaluateReceivers(), 50);
        } else {
          alert('Invalid format: file must contain masters and slaves arrays.');
        }
      } catch (err) {
        alert('Failed to load JSON file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSaveToLocalStorage = () => {
    try {
      const payload = { masters, slaves, receivers };
      localStorage.setItem('simuloran:custom-chain', JSON.stringify(payload));
      setHasSavedChain(true);
      alert('Custom chain saved to browser storage!');
    } catch (err) {
      alert('Could not save to browser storage: ' + err.message);
    }
  };

  const handleLoadFromLocalStorage = () => {
    try {
      const raw = localStorage.getItem('simuloran:custom-chain');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.masters) && Array.isArray(data.slaves)) {
        setStations(data.masters, data.slaves, data.receivers || []);
        setTimeout(() => evaluateReceivers(), 50);
      }
    } catch (err) {
      alert('Could not load saved chain: ' + err.message);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      alert('Security Notice: Station CSV exceeds 1 MB maximum file size limit.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === 'string') {
        const { masters: m, slaves: s, receivers: r, errors } = parseStationsCsv(text);
        if (errors.length) alert(`CSV imported with warnings:\n${errors.slice(0, 5).join('\n')}`);
        setStations(m, s, r);
        setTimeout(() => evaluateReceivers(), 100);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExportCsv = () => {
    const csv = exportStationsCsv([...masters, ...slaves, ...receivers]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `loran-stations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportGeoJson = () => {
    const blob = new Blob([JSON.stringify(exportScenarioGeoJson(masters, slaves, receivers), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `loran-scenario-${new Date().toISOString().slice(0, 10)}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateStation = () => {
    const lat = parseFloat(newLat);
    const lng = parseFloat(newLng);
    if (isNaN(lat) || isNaN(lng)) return;
    addStation({
      role: newRole,
      label: newLabel.trim() || `${newRole[0].toUpperCase()}${Date.now().toString().slice(-3)}`,
      lat, lng,
      txDbm: newRole === 'master' ? 20 : 18,
      griMs: 1000,
      offsetSec: newRole === 'slave' ? 0.01 : 0,
      ddsEnabled: isELoran,
      clock: { type: 'gps-disciplined', biasSec: 0, driftPerSec: 0 },
      diffCorrections: { enabled: false, avgMeters: 0 },
      asfMeters: 0,
    });
    setModalOpen(false);
    setTimeout(() => evaluateReceivers(), 50);
  };

  const allStations = [
    ...masters.map((m) => ({ ...m, role: 'master' })),
    ...slaves.map((s) => ({ ...s, role: 'slave' })),
    ...receivers.map((r) => ({ ...r, role: 'receiver' })),
  ];

  // Shared input style
  const inputStyle = {
    width: '100%',
    background: 'var(--bg-canvas)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-primary)',
    outline: 'none',
  };

  // Cross-Chain Multi-GRI Calculations
  const rx = receivers?.[0] || { lat: 28.5, lng: 122.5 };
  const primaryChainStations = allStations.filter(s => s.role === 'master' || s.role === 'slave');

  const nearbyCandidates = CANDIDATE_CROSS_STATIONS.filter(cand => {
    const d = haversineDistance(rx, cand) / 1000;
    return d < 3500;
  });

  const activeCrossStations = nearbyCandidates.filter(c => selectedCrossIds.includes(c.id));
  const combinedConstellation = [...primaryChainStations, ...activeCrossStations];

  const crossDop = evaluateCrossChainDopGain(
    primaryChainStations.length >= 3 ? primaryChainStations : primaryChainStations.concat(CANDIDATE_CROSS_STATIONS.slice(0, 3)),
    combinedConstellation.length >= 3 ? combinedConstellation : primaryChainStations.concat(CANDIDATE_CROSS_STATIONS.slice(0, 4)),
    rx
  );

  const crossObservations = combinedConstellation.map(st => {
    const dist = haversineDistance(rx, st);
    const chainBias = st.chainId?.includes('7430') ? 2200 : st.chainId?.includes('9930') ? 1600 : 1200;
    return {
      station: st,
      chainId: st.chainId || 'PRIMARY',
      pseudorangeMeters: dist + chainBias,
      sigma: 20,
    };
  });

  const crossFixResult = crossObservations.length >= 3 ? solveCrossChainFix(crossObservations, rx) : null;

  return (
    <div className="space-y-4">
      {/* Header bar with Theory link */}
      <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
        <div>
          <span className="text-xs font-mono font-bold text-[var(--text-primary)]">Custom Station Network</span>
          <span className="text-[10px] block text-[var(--text-dim)]">Interactive Transmitter Sandbox</span>
        </div>
        <a
          href="/learn#hyperbolic"
          className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border border-[var(--accent-loran-c-border)] bg-[var(--accent-loran-c-subtle)] text-[var(--accent-loran-c)] hover:opacity-80 transition cursor-pointer"
          title="Read theoretical formulation of Loran-C/eLoran hyperbolic networks"
        >
          Theory &rarr;
        </a>
      </div>
      {/* Preset selector */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <label
              htmlFor="scenario-preset-select"
              className="text-xs font-semibold uppercase tracking-wider block"
              style={{ color: 'var(--text-dim)' }}
            >
              Scenario Presets
            </label>
            {PRESET_SCENARIOS[activePresetId]?.description && (
              <InfoTooltip
                title={PRESET_SCENARIOS[activePresetId]?.name}
                content={PRESET_SCENARIOS[activePresetId]?.description}
                align="left"
              />
            )}
          </div>
        </div>
        <select
          id="scenario-preset-select"
          value={activePresetId}
          onChange={(e) => loadPreset(e.target.value)}
          style={inputStyle}
          className="cursor-pointer"
          title="Select a geographical transmitter chain preset"
        >
          {Object.entries(PRESET_SCENARIOS).map(([id, p]) => (
            <option key={id} value={id}>{p.shortName || p.name}</option>
          ))}
        </select>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        {/* Primary Action: Add Station */}
        <button
          onClick={() => setModalOpen(true)}
          className="col-span-2 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer hover:opacity-90"
          style={{ background: 'var(--accent-eloran-subtle)', border: '1px solid var(--accent-eloran-border)', color: 'var(--accent-eloran)' }}
          title="Create a new transmission station or monitor receiver"
          aria-label="Add Station"
        >
          <Plus size={15} /> Add Station
        </button>

        {/* CSV Import / Export */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition cursor-pointer hover:bg-[var(--bg-canvas)]"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          title="Import station network from a CSV file"
          aria-label="Import CSV"
        >
          <Upload size={14} /> Import CSV
        </button>
        <button
          onClick={handleExportCsv}
          className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition cursor-pointer hover:bg-[var(--bg-canvas)]"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          title="Export current station coordinates and parameters to CSV"
          aria-label="Export CSV"
        >
          <Download size={14} /> Export CSV
        </button>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />

        {/* JSON Import / Export */}
        <button
          onClick={() => jsonInputRef.current?.click()}
          className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition cursor-pointer hover:bg-[var(--bg-canvas)]"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          title="Upload custom transmitter chain and receivers from JSON file"
          aria-label="Import JSON"
        >
          <Upload size={14} /> Import JSON
        </button>
        <button
          onClick={handleExportJson}
          className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition cursor-pointer hover:bg-[var(--bg-canvas)]"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          title="Download custom transmitter chain and receivers as JSON"
          aria-label="Export JSON"
        >
          <Download size={14} /> Export JSON
        </button>
        <input ref={jsonInputRef} type="file" accept=".json" onChange={handleJsonUpload} className="hidden" />

        {/* Browser LocalStorage Persistence */}
        <button
          onClick={handleSaveToLocalStorage}
          className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition cursor-pointer hover:bg-[var(--bg-canvas)]"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--accent-eloran)' }}
          title="Save custom chain into browser local storage for future sessions"
          aria-label="Save Chain"
        >
          <Save size={14} /> Save Chain
        </button>
        <button
          onClick={handleLoadFromLocalStorage}
          disabled={!hasSavedChain}
          className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition cursor-pointer hover:bg-[var(--bg-canvas)] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          title={hasSavedChain ? "Restore saved chain from browser local storage" : "No saved chain in browser local storage"}
          aria-label="Load Saved"
        >
          <FolderOpen size={14} /> Load Saved
        </button>

        {/* Spatial GeoJSON Export */}
        <button
          onClick={handleExportGeoJson}
          className="col-span-2 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition cursor-pointer hover:bg-[var(--bg-canvas)]"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          title="Export stations and receiver geometry as GeoJSON FeatureCollection for GIS"
          aria-label="Export GeoJSON"
        >
          <FileCode size={14} /> GeoJSON
        </button>
      </div>

      {/* Station list */}
      <div className="space-y-2 pt-2">
        <div className="flex justify-between items-center">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Active Stations ({allStations.length})
          </span>
          <button
            onClick={resetAll}
            className="text-[11px] flex items-center gap-1 transition cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
            title="Clear all stations from active simulation"
            aria-label="Clear all stations"
            onMouseEnter={e => e.currentTarget.style.color = 'var(--status-danger)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
          >
            <RotateCcw size={12} /> Clear all
          </button>
        </div>

        <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1">
          {allStations.map((st) => {
            const colorVar = ROLE_COLOR_VAR[st.role];
            return (
              <div
                key={st.label}
                className="rounded-lg p-2.5 flex items-center justify-between text-xs font-mono transition"
                style={{
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: `var(${colorVar})` }}
                  />
                  <div>
                    <div className="font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                      <span>{st.label}</span>
                      {st.name && (
                        <span className="font-normal text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                          · {st.name}
                        </span>
                      )}
                      <span
                        className="text-[9px] px-1 py-0.5 rounded font-mono"
                        style={{
                          background: `var(${colorVar}-subtle)`,
                          color: `var(${colorVar})`,
                          border: `1px solid var(${colorVar}-border)`,
                        }}
                      >
                        {ROLE_LABEL[st.role]}
                      </span>
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                      {st.lat.toFixed(4)}°, {st.lng.toFixed(4)}°
                      {st.txDbm ? ` · ${st.txDbm} dBm` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {(st.role === 'master' || st.role === 'slave') && (
                    <button
                      type="button"
                      data-testid={`btn-station-status-${st.label}`}
                      onClick={() => {
                        const cur = stationStatus[st.label] || 'nominal';
                        const next = cur === 'nominal' ? 'degraded' : cur === 'degraded' ? 'failed' : 'nominal';
                        setStationStatus(st.label, next);
                      }}
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold border transition cursor-pointer flex items-center gap-1"
                      style={{
                        background:
                          (stationStatus[st.label] || 'nominal') === 'nominal'
                            ? 'var(--status-ok-subtle)'
                            : stationStatus[st.label] === 'degraded'
                            ? 'var(--status-warn-subtle)'
                            : 'var(--status-danger-subtle)',
                        color:
                          (stationStatus[st.label] || 'nominal') === 'nominal'
                            ? 'var(--status-ok)'
                            : stationStatus[st.label] === 'degraded'
                            ? 'var(--status-warn)'
                            : 'var(--status-danger)',
                        borderColor:
                          (stationStatus[st.label] || 'nominal') === 'nominal'
                            ? 'var(--status-ok-border)'
                            : stationStatus[st.label] === 'degraded'
                            ? 'var(--status-warn-border)'
                            : 'var(--status-danger-border)',
                      }}
                      title={`Station Status: ${(stationStatus[st.label] || 'nominal').toUpperCase()} (Click to toggle Nominal -> Degraded -> Failed)`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background:
                            (stationStatus[st.label] || 'nominal') === 'nominal'
                              ? 'var(--status-ok)'
                              : stationStatus[st.label] === 'degraded'
                              ? 'var(--status-warn)'
                              : 'var(--status-danger)',
                        }}
                      />
                      <span>
                        {(stationStatus[st.label] || 'nominal') === 'nominal'
                          ? 'NOM'
                          : stationStatus[st.label] === 'degraded'
                          ? 'DEG'
                          : 'OFF'}
                      </span>
                    </button>
                  )}

                  <button
                    onClick={() => removeStation(st.label)}
                    className="p-1 rounded-md transition cursor-pointer"
                    style={{ color: 'var(--text-muted)' }}
                    title={`Delete station ${st.label}`}
                    aria-label={`Delete station ${st.label}`}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--status-danger)'; e.currentTarget.style.background = 'var(--status-danger-subtle)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}

          {allStations.length === 0 && (
            <p className="text-[11px] text-center py-6 font-mono" style={{ color: 'var(--text-dim)' }}>
              No stations — select a preset or add stations via map click
            </p>
          )}
        </div>
      </div>

      {/* All-in-View Multi-GRI Cross-Rate Multilateration */}
      <div
        data-testid="cross-chain-multilateration-card"
        className="p-3 rounded-lg space-y-3 font-mono text-xs"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px]" style={{ color: 'var(--accent-eloran)' }}>
            <Network size={13} aria-hidden="true" />
            <span>All-in-View Cross-Rate Solver</span>
          </div>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center gap-1"
            style={crossDop.isImproved
              ? { background: 'var(--status-ok-subtle)', color: 'var(--status-ok)', border: '1px solid var(--status-ok-border)' }
              : { background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            <CheckCircle2 size={11} />
            <span>{crossDop.isImproved ? `+${crossDop.dopImprovementPct.toFixed(1)}% DOP GAIN` : 'STANDALONE'}</span>
          </span>
        </div>

        <div className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
          Combines primary chain transmitters with synchronized adjacent GRI chains to eliminate single-chain geometric dilution blind spots.
        </div>

        {/* Cross-Rate DOP Comparison */}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="p-2 rounded bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
            <div className="text-[10px] text-[var(--text-dim)] uppercase">Single-Chain HDOP</div>
            <div className="font-bold text-[var(--text-primary)] mt-0.5">{crossDop.singleChainHdop.toFixed(2)}</div>
            <div className="text-[9px] text-[var(--text-dim)]">{crossDop.stationsSingle} Transmitters</div>
          </div>
          <div className="p-2 rounded bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
            <div className="text-[10px] text-[var(--text-dim)] uppercase">Cross-Chain HDOP</div>
            <div className="font-bold text-[var(--status-ok)] mt-0.5">{crossDop.crossChainHdop.toFixed(2)}</div>
            <div className="text-[9px] text-[var(--text-dim)]">{crossDop.stationsCross} Transmitters (All-in-View)</div>
          </div>
        </div>

        {/* Cross-Chain Stations Selection */}
        <div className="space-y-1.5 pt-1">
          <span className="text-[10px] font-semibold text-[var(--text-dim)] uppercase">Adjacent Transmitters in View:</span>
          <div className="space-y-1">
            {nearbyCandidates.slice(0, 4).map((cand) => {
              const active = selectedCrossIds.includes(cand.id);
              return (
                <div
                  key={cand.id}
                  onClick={() => toggleCrossStation(cand.id)}
                  className="flex items-center justify-between p-2 rounded cursor-pointer transition select-none"
                  style={active
                    ? { background: 'var(--accent-eloran-subtle)', border: '1px solid var(--accent-eloran-border)' }
                    : { background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: active ? 'var(--accent-eloran)' : 'var(--text-muted)' }} />
                    <span className="font-semibold" style={{ color: active ? 'var(--accent-eloran)' : 'var(--text-primary)' }}>
                      {cand.label}
                    </span>
                    <span className="text-[10px] text-[var(--text-dim)]">({cand.chainId})</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-dim)] font-mono">
                    {cand.lat.toFixed(2)}°N, {cand.lng.toFixed(2)}°E
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cross-Rate Fix Results */}
        {crossFixResult && (
          <div className="p-2.5 rounded bg-[var(--bg-canvas)] border border-[var(--border-subtle)] space-y-1 text-[11px]">
            <div className="flex justify-between items-center">
              <span className="text-[var(--text-dim)]">Multi-GRI Position Fix:</span>
              <span className="font-bold text-[var(--text-primary)] font-mono">
                {crossFixResult.lat.toFixed(4)}°N, {crossFixResult.lng.toFixed(4)}°E
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--text-dim)]">Resolved Clock Bias (b_rx):</span>
              <span className="font-mono text-[var(--accent-eloran)]">
                {crossFixResult.clockBiasMeters.toFixed(1)} m ({(crossFixResult.clockBiasSec * 1e6).toFixed(2)} µs)
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--text-dim)]">Convergence Status:</span>
              <span className="font-mono text-[var(--status-ok)]">
                {crossFixResult.iterations} iterations ({crossFixResult.converged ? 'CONVERGED' : 'FAILED'})
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Add Station Modal */}
      {modalOpen && (
        <Modal
          open={modalOpen}
          title="Add Transmission Station"
          onCancel={() => setModalOpen(false)}
          onConfirm={handleCreateStation}
        >
          <div className="space-y-3 pt-2 text-xs">
            <div>
              <label className="block mb-1" style={{ color: 'var(--text-secondary)' }}>Station Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                style={inputStyle}
                className="cursor-pointer"
                title="Select station operational role"
              >
                <option value="master">Master Station (M)</option>
                <option value="slave">Secondary / Slave Station (S)</option>
                <option value="receiver">Receiver (R)</option>
              </select>
            </div>
            <div>
              <label className="block mb-1" style={{ color: 'var(--text-secondary)' }}>Station Identifier / Label</label>
              <input
                type="text"
                placeholder="e.g. M1-Bay"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block mb-1" style={{ color: 'var(--text-secondary)' }}>Latitude (°)</label>
                <input type="number" step="0.0001" value={newLat} onChange={(e) => setNewLat(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label className="block mb-1" style={{ color: 'var(--text-secondary)' }}>Longitude (°)</label>
                <input type="number" step="0.0001" value={newLng} onChange={(e) => setNewLng(e.target.value)} style={inputStyle} />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
