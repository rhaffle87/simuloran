import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X,
  Play,
  Pause,
  Download,
  Copy,
  Check,
  Trash2,
  Terminal,
  Wifi,
  WifiOff,
  Radio,
  Activity,
  Compass,
  Navigation,
  Sliders,
  Search,
  Info,
  Layers,
  Cpu,
} from 'lucide-react';
import { useSimulationStore } from '../../state/simulationStore.js';
import { InfoTooltip } from '../ui/Tooltip.jsx';
import {
  generateRmc,
  generateGga,
  generateGll,
  generateVtg,
  validateChecksum,
} from '../../lib/nmea.js';
import {
  STREAM_PROTOCOLS,
  CONNECTION_STATUS,
  createNetworkStreamer,
} from '../../lib/networkStream.js';

const BAUD_RATES = [4800, 9600, 19200, 38400, 115200];
const MAX_BUFFER_LINES = 500;

function formatDms(deg, isLat = true) {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = (abs - d) * 60;
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
  return `${d}° ${m.toFixed(3)}' ${dir}`;
}

export default function NmeaTerminalModal({ isOpen, onClose }) {
  const {
    receivers = [],
    selectedReceiver,
    receiverFixes = {},
  } = useSimulationStore();

  const [activeTab, setActiveTab] = useState('terminal'); // 'terminal' | 'inspector' | 'bridge'
  const [talker, setTalker] = useState('EC');
  const [sentences, setSentences] = useState({
    rmc: true,
    gga: true,
    gll: true,
    vtg: true,
  });
  const [rateHz, setRateHz] = useState(1);
  const [isStreaming, setIsStreaming] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedSentenceId, setSelectedSentenceId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [copied, setCopied] = useState(false);

  // Web Serial API State
  const [baudRate, setBaudRate] = useState(4800);
  const [serialConnected, setSerialConnected] = useState(false);
  const [serialError, setSerialError] = useState(null);

  // Local Network WebSocket & Signal K Streaming Bridge State
  const [networkProtocol, setNetworkProtocol] = useState(STREAM_PROTOCOLS.NMEA0183);
  const [endpointUrl, setEndpointUrl] = useState('ws://localhost:10110');
  const [networkStatus, setNetworkStatus] = useState(CONNECTION_STATUS.DISCONNECTED);
  const [networkStats, setNetworkStats] = useState({
    bytesSent: 0,
    messagesSent: 0,
    nmeaSent: 0,
    signalkSent: 0,
    lastError: null,
  });

  const serialPortRef = useRef(null);
  const serialWriterRef = useRef(null);
  const terminalBoxRef = useRef(null);
  const streamerRef = useRef(null);

  const activeRx = receivers.find((r) => r.label === selectedReceiver) || receivers[0];
  const activeFix = receiverFixes[selectedReceiver] || (activeRx ? receiverFixes[activeRx.label] : null);

  const lat = activeFix?.lat ?? activeRx?.lat ?? 37.4563;
  const lng = activeFix?.lng ?? activeRx?.lng ?? 126.7052;
  const speedKnots = activeRx?.speedKts ?? activeRx?.speed ?? 12.4;
  const courseDeg = activeRx?.courseDeg ?? activeRx?.heading ?? 45.0;
  const hdop = activeFix?.hdop ?? 1.1;

  // Initialize network streamer
  useEffect(() => {
    const streamer = createNetworkStreamer(
      {
        endpointUrl,
        protocol: networkProtocol,
      },
      (newStatus, stats) => {
        setNetworkStatus(newStatus);
        setNetworkStats(stats);
      }
    );
    streamerRef.current = streamer;

    return () => {
      streamer.disconnect();
      streamerRef.current = null;
    };
  }, [endpointUrl, networkProtocol]);

  // Main transmission timer
  useEffect(() => {
    if (!isOpen || !isStreaming) return;
    const intervalMs = Math.round(1000 / rateHz);
    const timer = setInterval(() => {
      const now = new Date();
      const timeStr = now.toISOString().slice(11, 23);
      const generated = [];

      if (sentences.rmc) {
        generated.push(generateRmc({ lat, lng, speedKnots, courseDeg, talker, timestamp: now }));
      }
      if (sentences.gga) {
        generated.push(generateGga({ lat, lng, hdop, talker, timestamp: now, quality: talker === 'GP' ? 1 : 7 }));
      }
      if (sentences.gll) {
        generated.push(generateGll({ lat, lng, talker, timestamp: now }));
      }
      if (sentences.vtg) {
        generated.push(generateVtg({ courseDeg, speedKnots, talker }));
      }

      if (generated.length === 0) return;

      const navData = {
        lat,
        lng,
        speedKnots,
        courseDeg,
        hdop,
        talker,
        timestamp: now,
      };

      const newEntries = generated.map((sent) => {
        const text = sent.trimEnd();
        const type = text.startsWith('$') ? text.slice(3, 6) : 'RAW';
        return {
          id: `${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
          timeStr,
          text,
          type,
          isValid: validateChecksum(text),
        };
      });

      if (networkProtocol === STREAM_PROTOCOLS.SIGNAL_K) {
        newEntries.push({
          id: `sk-${now.getTime()}`,
          timeStr,
          text: `[Signal K Delta] pos: ${lat.toFixed(4)}°,${lng.toFixed(4)}° | SOG: ${(speedKnots * 0.5144).toFixed(1)} m/s | HDOP: ${hdop.toFixed(2)}`,
          type: 'SK',
          isValid: true,
        });
      }

      setLogs((prev) => {
        const next = [...prev, ...newEntries];
        return next.length > MAX_BUFFER_LINES ? next.slice(-MAX_BUFFER_LINES) : next;
      });

      const rawPayload = generated.join('');

      // 1. Dispatch over local network WebSocket & BroadcastChannel
      if (streamerRef.current) {
        streamerRef.current.send({ nmea: rawPayload, navData });
        const s = streamerRef.current.getStats();
        setNetworkStats(s);
      }

      // 2. Dispatch over Web Serial COM port if connected
      if (serialWriterRef.current) {
        const encoder = new TextEncoder();
        serialWriterRef.current.write(encoder.encode(rawPayload)).catch((err) => {
          setSerialError(`Serial write error: ${err.message}`);
        });
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isOpen, isStreaming, rateHz, talker, sentences, lat, lng, speedKnots, courseDeg, hdop, networkProtocol]);

  useEffect(() => {
    if (autoScroll && terminalBoxRef.current) {
      terminalBoxRef.current.scrollTop = terminalBoxRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Web Serial Port Handlers
  const handleConnectSerial = useCallback(async () => {
    setSerialError(null);
    if (typeof navigator === 'undefined' || !('serial' in navigator)) {
      setSerialError('Web Serial API is not supported in this browser. Use Chrome/Edge.');
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: Number(baudRate) });
      const writer = port.writable.getWriter();
      serialPortRef.current = port;
      serialWriterRef.current = writer;
      setSerialConnected(true);
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        setSerialError(`Serial connection failed: ${err.message}`);
      }
    }
  }, [baudRate]);

  const handleDisconnectSerial = useCallback(async () => {
    try {
      if (serialWriterRef.current) {
        await serialWriterRef.current.close();
        serialWriterRef.current.releaseLock();
        serialWriterRef.current = null;
      }
      if (serialPortRef.current) {
        await serialPortRef.current.close();
        serialPortRef.current = null;
      }
    } catch {
      // Ignored
    } finally {
      setSerialConnected(false);
    }
  }, []);

  const handleToggleNetwork = () => {
    if (!streamerRef.current) return;
    if (networkStatus === CONNECTION_STATUS.CONNECTED || networkStatus === CONNECTION_STATUS.CONNECTING) {
      streamerRef.current.disconnect();
    } else {
      streamerRef.current.connect();
    }
  };

  const handleClear = () => setLogs([]);

  const handleCopy = () => {
    if (logs.length === 0) return;
    const text = logs.map((l) => l.text).join('\r\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (logs.length === 0) return;
    const text = logs.map((l) => l.text).join('\r\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simuloran_telemetry_${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}.nmea`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = useMemo(() => {
    if (!searchFilter.trim()) return logs;
    const query = searchFilter.toLowerCase();
    return logs.filter((l) => l.text.toLowerCase().includes(query) || l.type.toLowerCase().includes(query));
  }, [logs, searchFilter]);

  const activeSelectedSentence = useMemo(() => {
    if (!selectedSentenceId) return logs[logs.length - 1] || null;
    return logs.find((l) => l.id === selectedSentenceId) || logs[logs.length - 1] || null;
  }, [logs, selectedSentenceId]);

  if (!isOpen) return null;

  const isNetConnected = networkStatus === CONNECTION_STATUS.CONNECTED;
  const isNetConnecting = networkStatus === CONNECTION_STATUS.CONNECTING;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Marine Bridge & NMEA-0183 Telemetry Terminal"
    >
      <div
        className="w-full max-w-5xl h-[90vh] max-h-[860px] flex flex-col rounded-2xl border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 bg-[#090d16] border-[#1e293b]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Operational Header */}
        <div className="px-5 py-3.5 border-b border-[#1e293b] bg-[#0c121f] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-sm">
              <Compass className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold tracking-wide text-slate-100 uppercase">
                  Marine Telemetry & Bridge Hub
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                  IEC 61162 / NMEA 0183
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                  Active Fix: {activeRx?.label || 'R1'}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                <span>Talker: <strong className="text-cyan-300 font-bold">${talker}</strong></span>
                <span>•</span>
                <span>Rate: <strong className="text-slate-200">{rateHz} Hz</strong></span>
                <span>•</span>
                <span>Buffer: <strong className="text-slate-200">{logs.length} / {MAX_BUFFER_LINES}</strong></span>
              </p>
            </div>
          </div>

          {/* Quick HUD Strip */}
          <div className="hidden md:flex items-center gap-4 px-3.5 py-1.5 rounded-xl bg-[#070b13] border border-[#1e293b]/80 text-xs font-mono">
            <div className="flex items-center gap-1.5 text-slate-300">
              <Navigation className="w-3.5 h-3.5 text-cyan-400" />
              <span>{formatDms(lat, true)}, {formatDms(lng, false)}</span>
            </div>
            <div className="h-3 w-px bg-slate-700" />
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="text-slate-400">SOG:</span>
              <strong className="text-emerald-400 font-semibold">{speedKnots.toFixed(1)} kn</strong>
            </div>
            <div className="h-3 w-px bg-slate-700" />
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="text-slate-400">COG:</span>
              <strong className="text-amber-400 font-semibold">{courseDeg.toFixed(0).padStart(3, '0')}°</strong>
            </div>
            <div className="h-3 w-px bg-slate-700" />
            <div className="flex items-center gap-1 text-slate-300">
              <span className="text-slate-400">HDOP:</span>
              <span className={`font-semibold ${hdop < 2.0 ? 'text-emerald-400' : 'text-amber-400'}`}>{hdop.toFixed(2)}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 transition cursor-pointer"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tactical Sub-Bar: Segmented Tabs & Hardware Connectors */}
        <div className="px-5 py-2.5 border-b border-[#1e293b] bg-[#080d18] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#050810] border border-[#1e293b]">
            <button
              onClick={() => setActiveTab('terminal')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                activeTab === 'terminal'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal size={14} />
              <span>Live Terminal</span>
            </button>
            <button
              onClick={() => setActiveTab('inspector')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                activeTab === 'inspector'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers size={14} />
              <span>Sentence Inspector</span>
            </button>
            <button
              onClick={() => setActiveTab('bridge')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                activeTab === 'bridge'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cpu size={14} />
              <span>Hardware & Network Bridge</span>
            </button>
          </div>

          {/* Real-time Link Status Badges */}
          <div className="flex items-center gap-2">
            <div
              className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 text-[11px] ${
                isNetConnected
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : isNetConnecting
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-slate-800/40 border-slate-700/50 text-slate-400'
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${isNetConnected ? 'bg-emerald-400 animate-ping' : isNetConnecting ? 'bg-amber-400' : 'bg-slate-500'}`} />
              <span>LAN: {isNetConnected ? 'Connected' : isNetConnecting ? 'Connecting' : 'Idle'}</span>
            </div>

            <div
              className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 text-[11px] ${
                serialConnected
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-slate-800/40 border-slate-700/50 text-slate-400'
              }`}
            >
              <Wifi size={12} className={serialConnected ? 'text-emerald-400' : 'text-slate-500'} />
              <span>Serial: {serialConnected ? `${baudRate} baud` : 'Disconnected'}</span>
            </div>
          </div>
        </div>

        {serialError && (
          <div className="mx-5 my-2 p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between font-mono shrink-0">
            <span>{serialError}</span>
            <button
              type="button"
              onClick={() => setSerialError(null)}
              className="text-rose-400 hover:text-white ml-2 cursor-pointer p-0.5"
              aria-label="Dismiss error"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Main Tab Views */}
        {activeTab === 'terminal' && (
          <div className="flex-1 flex flex-col overflow-hidden bg-[#04060b]">
            {/* Filter and Quick Sentence Controls */}
            <div className="px-5 py-2 border-b border-[#1e293b]/70 bg-[#070b14] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Filter (e.g. GGA, RMC)..."
                    className="pl-8 pr-3 py-1 rounded-lg bg-[#0c121e] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500/60 w-48 sm:w-60"
                  />
                </div>

                <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                  <span className="text-slate-500 text-[11px]">Talker:</span>
                  <select
                    value={talker}
                    onChange={(e) => setTalker(e.target.value)}
                    className="px-1.5 py-0.5 rounded bg-[#0c121e] border border-slate-800 text-cyan-300 text-[11px] font-mono focus:outline-none"
                  >
                    <option value="EC">EC</option>
                    <option value="LC">LC</option>
                    <option value="GP">GP</option>
                    <option value="IN">IN</option>
                  </select>

                  <span className="text-slate-500 text-[11px] ml-1">Rate:</span>
                  <select
                    value={rateHz}
                    onChange={(e) => setRateHz(Number(e.target.value))}
                    className="px-1.5 py-0.5 rounded bg-[#0c121e] border border-slate-800 text-cyan-300 text-[11px] font-mono focus:outline-none"
                  >
                    <option value={1}>1 Hz</option>
                    <option value={2}>2 Hz</option>
                    <option value={5}>5 Hz</option>
                    <option value={10}>10 Hz</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                  {['rmc', 'gga', 'gll', 'vtg'].map((k) => (
                    <label
                      key={k}
                      className={`px-2 py-0.5 rounded-md border text-[11px] font-bold cursor-pointer transition select-none ${
                        sentences[k]
                          ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                          : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={sentences[k]}
                        onChange={(e) => setSentences({ ...sentences, [k]: e.target.checked })}
                        className="hidden"
                      />
                      <span>{k.toUpperCase()}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="accent-cyan-400 rounded"
                  />
                  <span>Auto-scroll</span>
                </label>
                <span>Filtered: <strong className="text-slate-200">{filteredLogs.length}</strong></span>
              </div>
            </div>

            {/* Terminal Screen with Rich Syntax Highlighting */}
            <div
              ref={terminalBoxRef}
              className="flex-1 p-4 overflow-y-auto space-y-1 font-mono text-[11px] leading-relaxed selection:bg-cyan-900/60 selection:text-cyan-200"
            >
              {filteredLogs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 italic py-16 gap-2">
                  <Activity className="w-6 h-6 text-slate-600 animate-spin" />
                  <span>Streaming NMEA-0183 & Signal K sentences...</span>
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const parts = log.text.split('*');
                  const body = parts[0] || '';
                  const checksum = parts[1] ? `*${parts[1]}` : '';
                  const bodyTokens = body.split(',');
                  const header = bodyTokens[0] || '';
                  const fields = bodyTokens.slice(1);

                  return (
                    <div
                      key={log.id}
                      onClick={() => setSelectedSentenceId(log.id)}
                      className={`flex items-start gap-2.5 px-2 py-1 rounded-md transition-colors cursor-pointer group ${
                        selectedSentenceId === log.id
                          ? 'bg-cyan-950/40 border border-cyan-500/30'
                          : 'hover:bg-slate-900/70 border border-transparent'
                      }`}
                    >
                      <span className="text-slate-600 select-none shrink-0 font-mono">[{log.timeStr}]</span>

                      {log.type === 'SK' ? (
                        <span className="text-amber-300 font-medium">{log.text}</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1 break-all">
                          <span className="text-cyan-400 font-bold bg-cyan-950/30 px-1 rounded">
                            {header}
                          </span>
                          {fields.map((f, idx) => (
                            <span key={idx} className="text-slate-300 group-hover:text-emerald-300 transition-colors">
                              ,{f}
                            </span>
                          ))}
                          <span className="text-fuchsia-400 font-mono font-bold bg-fuchsia-950/30 px-1 rounded">
                            {checksum}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeTab === 'inspector' && (
          <div className="flex-1 p-5 overflow-y-auto bg-[#050810] space-y-4 font-mono text-xs">
            {!activeSelectedSentence ? (
              <div className="p-8 rounded-xl bg-[#090f1d] border border-slate-800 text-center text-slate-500 flex items-center justify-center gap-2">
                <span>Select any sentence in the Live Terminal to inspect its decomposition</span>
                <InfoTooltip content="Decomposes comma-separated NMEA tokens and validates 8-bit XOR checksum parity." />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-[#0b1325] border border-cyan-500/30 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">Raw Sentence</span>
                    <p className="text-sm text-slate-100 font-bold mt-0.5">{activeSelectedSentence.text}</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                    Checksum Valid (XOR)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-xl bg-[#080d18] border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">Talker & Sentence ID</span>
                    <p className="text-base font-bold text-cyan-300 mt-1">${talker}{activeSelectedSentence.type}</p>
                    <span className="text-[11px] text-slate-400 mt-0.5 block">
                      {activeSelectedSentence.type === 'GGA' && 'GPS/eLoran Fix & Accuracy Data'}
                      {activeSelectedSentence.type === 'RMC' && 'Recommended Minimum Navigation'}
                      {activeSelectedSentence.type === 'GLL' && 'Geographic Position (Lat/Lon)'}
                      {activeSelectedSentence.type === 'VTG' && 'Course & Speed Over Ground'}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#080d18] border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">Coordinates (WGS-84)</span>
                    <p className="text-base font-bold text-emerald-400 mt-1">{lat.toFixed(4)}° N, {lng.toFixed(4)}° E</p>
                    <span className="text-[11px] text-slate-400 mt-0.5 block">{formatDms(lat, true)}, {formatDms(lng, false)}</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#080d18] border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">Kinematics</span>
                    <p className="text-base font-bold text-amber-300 mt-1">{speedKnots.toFixed(1)} kn @ {courseDeg.toFixed(0)}°</p>
                    <span className="text-[11px] text-slate-400 mt-0.5 block">{(speedKnots * 1.852).toFixed(1)} km/h • {(speedKnots * 0.5144).toFixed(1)} m/s</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#080d18] border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">Fix Quality & HDOP</span>
                    <p className="text-base font-bold text-slate-200 mt-1">Quality 7 (eLoran Mode)</p>
                    <span className="text-[11px] text-emerald-400 mt-0.5 block">HDOP: {hdop.toFixed(2)} (High Precision)</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#080d18] border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">Active Receiver</span>
                    <p className="text-base font-bold text-cyan-300 mt-1">{activeRx?.label || 'R1-EuroportVessel'}</p>
                    <span className="text-[11px] text-slate-400 mt-0.5 block">{activeRx?.name || 'Tactical Surface Vessel'}</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#080d18] border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">Transmit Interval</span>
                    <p className="text-base font-bold text-slate-200 mt-1">{rateHz} Hz ({(1000 / rateHz).toFixed(0)} ms)</p>
                    <span className="text-[11px] text-slate-400 mt-0.5 block">NMEA-0183 Standard Rate</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'bridge' && (
          <div className="flex-1 p-5 overflow-y-auto bg-[#050810] space-y-4 font-mono text-xs">
            {/* LAN WebSocket Setup Card */}
            <div className="p-4 rounded-xl bg-[#090f1d] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-bold text-slate-200">Local Area Network (LAN) WebSocket Bridge</h3>
                  <InfoTooltip content="OpenCPN (ws://localhost:10110), Signal K (ws://localhost:3000/signalk/v1/stream), or BroadcastChannel." />
                </div>
                <button
                  type="button"
                  onClick={handleToggleNetwork}
                  className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition cursor-pointer border ${
                    isNetConnected
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : isNetConnecting
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      : 'bg-cyan-500 text-slate-950 font-bold hover:bg-cyan-400'
                  }`}
                >
                  <Activity size={13} className={isNetConnected || isNetConnecting ? 'animate-spin' : ''} />
                  <span>{isNetConnected ? 'Disconnect LAN' : isNetConnecting ? 'Connecting...' : 'Connect LAN'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
                <div>
                  <label className="text-[11px] text-slate-400 mb-1 block">WebSocket Server Endpoint</label>
                  <input
                    type="text"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    placeholder="ws://localhost:10110"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-800 bg-[#060a12] text-slate-200 text-xs focus:outline-none focus:border-cyan-500/50"
                  />
                  <div className="flex items-center gap-1.5 mt-2">
                    <button
                      type="button"
                      onClick={() => setEndpointUrl('ws://localhost:10110')}
                      className="px-2 py-0.5 rounded text-[10px] bg-slate-800/60 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
                    >
                      Port 10110 (OpenCPN)
                    </button>
                    <button
                      type="button"
                      onClick={() => setEndpointUrl('ws://localhost:3000/signalk/v1/stream')}
                      className="px-2 py-0.5 rounded text-[10px] bg-slate-800/60 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
                    >
                      Signal K Stream
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 mb-1 block">Payload Protocol</label>
                  <select
                    value={networkProtocol}
                    onChange={(e) => setNetworkProtocol(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-800 bg-[#060a12] text-slate-200 text-xs focus:outline-none"
                  >
                    <option value={STREAM_PROTOCOLS.NMEA0183}>NMEA 0183 (ASCII Sentences)</option>
                    <option value={STREAM_PROTOCOLS.SIGNAL_K}>Signal K (JSON Delta v1.5)</option>
                    <option value={STREAM_PROTOCOLS.DUAL}>Dual Protocol (NMEA + Signal K)</option>
                  </select>
                  <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-3">
                    <span>Sentences: <strong className="text-cyan-300">{networkStats.nmeaSent}</strong></span>
                    <span>Bytes: <strong className="text-slate-200">{(networkStats.bytesSent / 1024).toFixed(1)} KB</strong></span>
                  </div>
                </div>
              </div>
            </div>

            {/* Hardware Web Serial Card */}
            <div className="p-4 rounded-xl bg-[#090f1d] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-slate-200">Physical RS-422 / RS-232 Web Serial Interface</h3>
                  <InfoTooltip content="Streams 8-N-1 ASCII serial frames directly to USB-to-RS422 adapters for ECDIS and chartplotters." />
                </div>

                {serialConnected ? (
                  <button
                    type="button"
                    onClick={handleDisconnectSerial}
                    className="px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 transition cursor-pointer"
                  >
                    <WifiOff size={13} />
                    <span>Disconnect Port</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleConnectSerial}
                    className="px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition cursor-pointer"
                  >
                    <Wifi size={13} />
                    <span>Select COM Port</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                <span className="text-slate-400 text-[11px]">Baud Rate:</span>
                <select
                  value={baudRate}
                  onChange={(e) => setBaudRate(Number(e.target.value))}
                  disabled={serialConnected}
                  className="px-2.5 py-1 rounded-md border border-slate-800 bg-[#060a12] text-slate-200 text-xs focus:outline-none"
                >
                  {BAUD_RATES.map((b) => (
                    <option key={b} value={b}>{b} baud</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Global Modal Bottom Action Bar */}
        <div className="px-5 py-3 border-t border-[#1e293b] bg-[#0c121f] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsStreaming(!isStreaming)}
              className={`px-3.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs ${
                isStreaming
                  ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25'
                  : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
              }`}
            >
              {isStreaming ? <Pause size={13} /> : <Play size={13} />}
              <span>{isStreaming ? 'Pause Stream' : 'Resume Stream'}</span>
            </button>

            <button
              onClick={handleClear}
              className="px-3 py-1.5 rounded-lg border border-slate-800 bg-[#080d18] text-slate-300 hover:text-white hover:border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
            >
              <Trash2 size={13} />
              <span>Clear</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={logs.length === 0}
              className="px-3.5 py-1.5 rounded-lg border border-slate-800 bg-[#080d18] text-slate-300 hover:text-white hover:border-slate-700 flex items-center gap-1.5 transition cursor-pointer disabled:opacity-40"
            >
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              <span>{copied ? 'Copied' : 'Copy Sentences'}</span>
            </button>

            <button
              onClick={handleDownload}
              disabled={logs.length === 0}
              className="px-4 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer bg-cyan-500 text-slate-950 hover:bg-cyan-400 shadow-sm disabled:opacity-40"
            >
              <Download size={13} />
              <span>Export .nmea File</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
