import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Compass, Radio, Activity, Layers,
  ShieldCheck, TrendingDown, ArrowRight, BookOpen,
  Cpu, Database, Search, X, ChevronDown, ChevronUp
} from 'lucide-react';
import TrialValidationPanel from '../components/panels/TrialValidationPanel.jsx';
import { useSimulationStore } from '../state/simulationStore.js';
import MathView from '../components/ui/MathView.jsx';

const CATEGORIES = [
  { id: 'all', label: 'All Topics', icon: BookOpen },
  { id: 'positioning', label: 'Geodesy & Positioning', icon: Compass },
  { id: 'rf', label: 'RF Waveforms & Carrier', icon: Activity },
  { id: 'propagation', label: 'Groundwave & ASF Physics', icon: Layers },
  { id: 'resilience', label: 'Resilience & Modern eLoran', icon: ShieldCheck },
];

const CONCEPTS = [
  {
    id: 'tdoa',
    category: 'positioning',
    title: 'Time Difference of Arrival (TDOA) & Hyperbolas',
    standard: 'Classical Loran-C Standard',
    citation: 'USCG COMDTINST M16562.4A',
    icon: Radio,
    accentVar: '--accent-eloran',
    oneLiner: 'Positioning is derived from differential arrival times between synchronized transmitters, forming hyperbolic Lines of Position (LOPs).',
    math: '\\text{TDOA}_i = t_{\\text{arr}, i} - t_{\\text{arr}, M} = \\frac{\\|\\mathbf{x} - \\mathbf{s}_i\\| - \\|\\mathbf{x} - \\mathbf{s}_M\\|}{c} + \\text{ED}_i',
    mechanism: 'Each secondary station radiates with a calibrated Emission Delay (ED). The receiver measures arrival time differences relative to the Master pulse group.',
    operationalLimit: 'Geometric dilution occurs along baseline extensions where hyperbolas collapse into straight lines, losing cross-track resolution.',
    targetStandard: 'Position fix error < 460 m (0.25 NM) for classical Loran-C; < 10 m for differential eLoran.',
    deepDive: 'For any fixed time difference, the locus of points having a constant distance difference from two fixed stations forms a hyperbola. The intersection of two or more LOPs uniquely fixes the receiver in two dimensions. In eLoran, direct pseudorange Time of Arrival (TOA) multilateration supplements TDOA, eliminating reliance on a single master station.',
    presetId: 'rotterdam_harbor_approach',
    targetRoute: '/loran-c',
    buttonLabel: 'Launch Baseline TDOA Demo',
  },
  {
    id: 'gdop',
    category: 'positioning',
    title: 'Geometric Dilution of Precision (GDOP)',
    standard: 'Navigation Geometry Criterion',
    citation: 'IEEE Trans. Aerospace & Electronic Systems',
    icon: TrendingDown,
    accentVar: '--accent-loran-c',
    oneLiner: 'Station geometry mathematically scales timing jitter into positional uncertainty on the navigation chart.',
    math: '\\text{GDOP} = \\sqrt{\\mathrm{Tr}\\left( (H^T H)^{-1} \\right)}, \\quad \\sigma_{\\text{pos}} = \\text{GDOP} \\cdot c \\cdot \\sigma_{\\tau}',
    mechanism: 'The geometry matrix H maps line-of-sight unit vectors to the receiver. Wide angular baselines (~90°) minimize the trace of the inverse normal matrix.',
    operationalLimit: 'Collinear stations or baseline extensions cause det(H^T H) -> 0, magnifying sub-microsecond jitter into kilometer-scale fix errors.',
    targetStandard: 'Optimal fix: GDOP <= 1.5; Coastal navigation limit: GDOP <= 3.0; USCG service limit: GDOP <= 10.92.',
    deepDive: 'When transmitter stations subtend narrow angles relative to the receiver, hyperbolic lines of position intersect at grazing angles. A 10 ns timing jitter translates into hundreds of metres of horizontal position error. SIMULORAN computes the full inverted covariance matrix Q = (H^T W H)^-1 in real time, projecting the 95% confidence error ellipse on the vector map.',
    presetId: 'north_sea_historical',
    targetRoute: '/loran-c',
    buttonLabel: 'Inspect Geometry & GDOP',
  },
  {
    id: 'gauss-newton',
    category: 'positioning',
    title: 'Gauss-Newton & Levenberg-Marquardt Solvers',
    standard: 'Non-Linear Iterative Multilateration',
    citation: 'Bancroft (1985) / Levenberg (1944)',
    icon: Compass,
    accentVar: '--accent-eloran',
    oneLiner: 'Iterative metric-conditioned normal equations solve 2D position fixes with singularity damping.',
    math: '\\Delta \\mathbf{x} = (J^T W J + \\lambda I)^{-1} J^T W \\Delta \\mathbf{\\rho}, \\quad \\det(J^T J) > 10^{-12}',
    mechanism: 'Hyperbolic and pseudorange residuals are linearized around an initial estimate using the 2D Jacobian matrix J, iterating until ||Δx|| < 0.01 m.',
    operationalLimit: 'Standard time-domain formulation causes determinants to collapse to order 10^-34; solving in distance-metre space guarantees numerical stability.',
    targetStandard: 'Rapid convergence in <= 4 iterations with condition number kappa(J) < 10^4.',
    deepDive: 'Formulating normal equations in metric distance space rather than seconds space prevents double-precision underflow. The Levenberg-Marquardt damping parameter lambda dynamically adapts when geometry degrades near baseline extensions, seamlessly transitioning between gradient descent and Gauss-Newton steps.',
    presetId: 'rotterdam_harbor_approach',
    targetRoute: '/loran-c',
    buttonLabel: 'Launch Multilateration Solver',
  },
  {
    id: 'asf',
    category: 'propagation',
    title: 'Additional Secondary Factor (ASF) & Millington Method',
    standard: 'ITU-R Rec. P.368-10 Groundwave Model',
    citation: 'Millington (1949), Proc. IEE 96(39)',
    icon: Layers,
    accentVar: '--accent-eloran',
    oneLiner: 'Excess phase retardation accumulated as LF groundwaves propagate across resistive terrestrial terrain and coastlines.',
    math: '\\Phi_{\\text{Millington}} = \\frac{1}{2} \\left[ \\Phi_{\\text{forward}} + \\Phi_{\\text{reverse}} \\right], \\quad \\text{ASF} = \\frac{\\Phi}{2\\pi f_0}',
    mechanism: 'Ray-paths are segmented into discrete land/sea conductivity sections (sigma: 0.0001 to 5.0 S/m), integrating phase delays in forward and reverse directions.',
    operationalLimit: 'Uncalibrated inland terrain delays can induce 1 to 5 microseconds of timing error (300 m to 1,500 m positional offset) if left uncompensated.',
    targetStandard: 'Calibrated eLoran ASF maps restore harbor approach positioning accuracy to < 10 m (HEA 95% compliance).',
    deepDive: 'At coastlines transitioning from land to sea, Millington recovery produces a sudden surge in field strength and phase acceleration. SIMULORAN implements exact multi-boundary Millington integration in grwave.js with 10m Natural Earth coastal boundaries and soil conductivity classifications.',
    presetId: 'north_sea_historical',
    targetRoute: '/eloran',
    buttonLabel: 'Explore North Sea ASF Grid',
  },
  {
    id: 'groundwave-decomposition',
    category: 'propagation',
    title: 'Total Groundwave Delay Decomposition (PF, SF & ASF)',
    standard: 'Physical Phase Delay Triad',
    citation: 'Brunavs (1977) / Johler (1956)',
    icon: Layers,
    accentVar: '--accent-eloran',
    oneLiner: 'Total LF propagation delay is rigorously partitioned into atmospheric, seawater, and heterogeneous terrestrial terms.',
    math: 't_{\\text{prop}} = \\frac{d}{c} + \\text{PF}(\\eta) + \\text{SF}(d, \\sigma_{\\text{sea}}) + \\text{ASF}(d, \\sigma_{\\text{land}})',
    mechanism: 'Primary Factor (PF) accounts for atmospheric refractivity (n approx 1.000338). Secondary Factor (SF) models all-seawater spherical earth curvature. ASF models excess land impedance.',
    operationalLimit: 'Ignoring tropospheric weather changes (temperature, humidity, pressure) induces up to 100 ns diurnal phase variations across 500 km paths.',
    targetStandard: 'Brunavs (1977) polynomial evaluation accuracy within +/- 1.5 ns against full Sommerfeld wave equations.',
    deepDive: 'Total groundwave transit time decomposes into: PF (speed of light in air c/n), SF (curvature and finite conductivity over seawater sigma = 4.0 S/m), and ASF (excess delay from terrain, elevation, and geology). In maritime environments, SF dominates at long distances while ASF becomes paramount near ports.',
    presetId: 'north_sea_historical',
    targetRoute: '/eloran',
    buttonLabel: 'Inspect Groundwave Delay Grids',
  },
  {
    id: 'gri',
    category: 'rf',
    title: 'Group Repetition Interval (GRI) & Chain Architecture',
    standard: 'ITU-R CCIR Rec. 589 Allocation',
    citation: 'USCG Navigation Center (NAVCEN)',
    icon: Activity,
    accentVar: '--accent-eloran',
    oneLiner: 'Periodic pulse group repetition uniquely identifies transmitting chains and prevents cross-rate co-channel interference.',
    math: '\\text{Period} = \\text{GRI} \\times 10\\,\\mu\\text{s}, \\quad \\text{e.g., GRI } 8390 = 83\\,900\\,\\mu\\text{s} \\ (11.92\\,\\text{Hz})',
    mechanism: 'Transmitters emit groups of 8 pulses (spaced 1,000 µs apart), with the Master emitting a 9th pulse for visual and algorithmic chain identification.',
    operationalLimit: 'Cross-rate interference occurs when pulses from two distinct chains overlap in time; phase code sequences cancel these periodic cross-signals.',
    targetStandard: 'Atomic synchronization maintains GRI pulse jitter < 25 ns RMS relative to UTC(BIPM).',
    deepDive: 'The GRI value represents the interval in tens of microseconds between successive pulse group transmissions. Because multiple chains operate on the identical 100 kHz carrier frequency worldwide, distinct GRIs ensure that overlapping pulses from adjacent chains are rejected by coherent averaging loops.',
    presetId: 'rotterdam_harbor_approach',
    targetRoute: '/waveforms',
    buttonLabel: 'Open RF Oscilloscope',
  },
  {
    id: 'uscg-pulse',
    category: 'rf',
    title: '100 kHz Standard Pulse & USCG Envelope Specification',
    standard: 'USCG COMDTINST M16562.4A Specification',
    citation: 'FAA / USCG Loran-C Specification (1994)',
    icon: Radio,
    accentVar: '--accent-eloran',
    oneLiner: 'Asymmetric exponential pulse envelope designed to concentrate radiated energy strictly inside the 90-110 kHz band.',
    math: 'i(t) = A \\cdot \\left(\\frac{t}{\\tau}\\right)^2 e^{-2(t - \\tau)/\\tau} \\sin(\\omega_c t), \\quad \\tau = 65\\,\\mu\\text{s}, \\quad f_c = 100\\,\\text{kHz}',
    mechanism: 'Steep rise time maximizes energy in early cycles (first 30 µs), followed by a controlled exponential decay through 300 µs.',
    operationalLimit: 'Excessive envelope-to-cycle difference (ECD) distorts the zero crossing position, requiring calibrated envelope tracking.',
    targetStandard: '> 99.0% of total spectral power confined within 90 kHz to 110 kHz international radionavigation spectrum.',
    deepDive: 'The standard USCG pulse exhibits an envelope peak at tau = 65 µs from virtual origin. At the 3rd carrier cycle (t = 30 µs), the normalized amplitude reaches exactly e(30)/e(65) = 0.62534 with a steep derivative de/dt, providing the optimal point for carrier phase tracking.',
    presetId: 'rotterdam_harbor_approach',
    targetRoute: '/waveforms',
    buttonLabel: 'Inspect 100 kHz Waveform in Oscilloscope',
  },
  {
    id: 'rf-carrier-modulation',
    category: 'rf',
    title: '100 kHz Modulated Carrier & Phase Code Inversion',
    standard: 'Phase Code Modulation Standard',
    citation: 'RTCM 10403.3 / USCG M16562.4A',
    icon: Activity,
    accentVar: '--accent-eloran',
    oneLiner: 'Bi-phase (0° / 180°) modulation across consecutive pulse groups cancels continuous-wave interference and skywaves.',
    math: 's(t) = i(t) \\cdot \\cos(\\omega_c t + \\phi_k), \\quad \\phi_k \\in \\{0, \\pi\\}, \\quad \\text{Group A: } (++--+-+-)',
    mechanism: 'Consecutive pulses in a GRI cycle are phase-inverted according to Barker-like sequences (Group A and Group B). Coherent summation cancels unmodulated CW.',
    operationalLimit: 'Continuous Wave (CW) near-carrier jammers are attenuated by > 35 dB when integrating across alternating phase groups.',
    targetStandard: 'Receiver cross-correlation suppression > 40 dB against non-synchronized transmitters.',
    deepDive: 'Phase coding serves two fundamental objectives: it eliminates continuous wave (CW) interferers by algebraic cancellation upon coherent integration across Group A and Group B, and it prevents multi-hop ionospheric skywaves from prior pulses from constructively biasing subsequent groundwave tracking cycles.',
    presetId: 'rotterdam_harbor_approach',
    targetRoute: '/waveforms',
    buttonLabel: 'Inspect Carrier Phase in Oscilloscope',
  },
  {
    id: 'skywave-discrimination',
    category: 'rf',
    title: 'Groundwave Sampling & Skywave Multi-path Discrimination',
    standard: 'D-Layer / E-Layer Ionospheric Model',
    citation: 'Doherty et al. / USCG R&D Center',
    icon: Activity,
    accentVar: '--status-ok',
    oneLiner: 'Sampling at the 3rd zero crossing (30 µs) achieves 100% immunity against delayed ionospheric skywave reflections.',
    math: 't_{\\text{sample}} = 30\\,\\mu\\text{s} < t_{\\text{skywave}} = t_{\\text{ground}} + \\frac{2\\sqrt{h_{\\text{iono}}^2 + (d/2)^2} - d}{c}',
    mechanism: 'Groundwaves propagate via Earth surface diffraction. Skywaves reflect off the ionospheric D-layer (70-90 km) and always arrive > 35 µs after groundwave onset.',
    operationalLimit: 'At ranges > 1,200 km, groundwaves attenuate heavily while skywaves dominate, causing severe cycle ambiguity if sampled after 35 µs.',
    targetStandard: 'Zero-crossing sampling tolerance locked to +/- 50 ns before first skywave arrival.',
    deepDive: 'Because the ionosphere lies at least 70 km above Earth, the reflected slant path is geometrically longer than the direct surface geodesic. By locking the receiver tracking loop strictly to the Standard Zero Crossing (SZC) at exactly 30 µs from onset, the measurement is completed before the earliest skywave energy reaches the antenna.',
    presetId: 'rotterdam_harbor_approach',
    targetRoute: '/waveforms',
    buttonLabel: 'Simulate Skywave in Oscilloscope',
  },
  {
    id: 'cycle-selection',
    category: 'resilience',
    title: 'Cycle Selection, Envelope Ratio & Boyce (2006) Model',
    standard: 'Carrier Cycle Slip Prevention',
    citation: 'Boyce, Lo, Powell, & Enge (ILA 2006)',
    icon: ShieldCheck,
    accentVar: '--accent-loran-c',
    oneLiner: 'Envelope ratio testing prevents catastrophic 10 µs carrier cycle slips (3 km position jump) in low SNR environments.',
    math: '\\text{Ratio}(\\tau) = \\frac{E(\\tau - 15\\,\\mu\\text{s})}{E(\\tau)}, \\quad P[\\text{Slip}] = \\text{erfc}\\left( \\frac{5\\,\\mu\\text{s}}{\\sigma_{\\text{ECD}} \\sqrt{2}} \\right)',
    mechanism: 'Receivers compare envelope amplitude samples spaced 15 µs apart: Ratio(30) = E(15)/E(30) approx 0.3966. If ratio falls outside [0.25, 0.52], a cycle slip is flagged.',
    operationalLimit: 'Mistaking the 3rd cycle for the 2nd or 4th introduces exactly +/- 10 µs (approx 3,000 m error in hyperbolic range difference).',
    targetStandard: 'Wrong-cycle slip probability P(wc) < 10^-5 at SNR >= 0 dB with coherent pulse averaging.',
    deepDive: 'At 100 kHz, one full carrier cycle spans exactly 10 microseconds, corresponding to 3 km of propagation distance. Boyce et al. (Stanford University) established that tracking the ratio of envelope samples spaced 15 µs apart provides a robust metric that isolates the 3rd cycle with a +/- 5 µs margin of safety.',
    presetId: 'rotterdam_harbor_approach',
    targetRoute: '/waveforms',
    buttonLabel: 'Launch Boyce Monte Carlo Simulator',
  },
  {
    id: 'fusion',
    category: 'resilience',
    title: 'GNSS-eLoran Multi-Source PNT Resiliency & EW Defense',
    standard: 'Sovereign Resilient PNT Standard',
    citation: 'UK General Lighthouse Authorities (GLA)',
    icon: ShieldCheck,
    accentVar: '--status-ok',
    oneLiner: 'Complementary fusion of UHF satellite signals (faint, microwave) with LF megawatt terrestrial groundwaves.',
    math: '\\mathbf{x}_{\\text{BLUE}} = \\left( P_{\\text{GNSS}}^{-1} + P_{\\text{eLoran}}^{-1} \\right)^{-1} \\left( P_{\\text{GNSS}}^{-1} \\mathbf{x}_{\\text{GNSS}} + P_{\\text{eLoran}}^{-1} \\mathbf{x}_{\\text{eLoran}} \\right)',
    mechanism: 'Best Linear Unbiased Estimator (BLUE) weights GNSS and eLoran covariance matrices. Autonomous integrity monitoring detects and isolates jammed or spoofed satellite signals.',
    operationalLimit: 'GNSS signals (-130 dBm) are easily jammed by low-power 1-watt chirp devices; megawatt eLoran groundwaves are immune to UHF jamming.',
    targetStandard: 'Zero-downtime maritime bridge navigation continuity during 100% GNSS denial.',
    deepDive: 'Satellite GNSS and terrestrial eLoran represent ideal complementary radionavigation systems. GNSS provides high vertical and horizontal precision in open sky but is fragile against electronic warfare and space weather. eLoran radiates multi-megawatt LF signals at 100 kHz that penetrate urban canyons, maritime fjords, and high-power RF jammers.',
    presetId: 'dover_strait_tss',
    targetRoute: '/eloran',
    buttonLabel: 'Test Dover Strait GNSS Outage',
  },
  {
    id: 'ast-parser',
    category: 'resilience',
    title: 'Sandboxed AST Mathematical Expression Parser',
    categoryLabel: 'Security & Computation',
    standard: 'Zero-Eval Safe Syntax Tree',
    citation: 'Formal Grammar & Recursive Descent',
    icon: Cpu,
    accentVar: '--status-ok',
    oneLiner: 'Sandboxed recursive descent compiler evaluates user-defined spatial conductivity distributions without dynamic code execution.',
    math: '\\text{Tokenize}(s) \\to \\text{AST Node} \\to \\text{Safe Dispatch Evaluation}, \\quad \\text{Sec: 0 eval(), 0 new Function()}',
    mechanism: 'Mathematical expressions are lexed into tokens, compiled into a typed binary syntax tree, and evaluated via pure mathematical functions.',
    operationalLimit: 'Standard JavaScript eval() introduces catastrophic arbitrary code execution vulnerabilities in scientific web applications.',
    targetStandard: '100% compliant with strict Content Security Policy (CSP) with zero dynamic code injection vectors.',
    deepDive: 'SIMULORAN includes a self-contained Recursive Descent Parser for user-customizable spatial ASF conductivity distributions. The compiler verifies syntactic grammar, checks for division-by-zero singularities, and executes safe AST traversal with zero reliance on eval() or Function constructors.',
    presetId: 'north_sea_historical',
    targetRoute: '/eloran',
    buttonLabel: 'Explore North Sea ASF Grid',
  },
];

export default function Learn() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTopics, setExpandedTopics] = useState({});

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.slice(1);
      const el = document.getElementById(hash);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
      }
    }
  }, []);

  const navigate = useNavigate();
  const { loadPreset } = useSimulationStore();

  const handleLaunch = (presetId, route) => {
    loadPreset(presetId);
    navigate(route);
  };

  const toggleDeepDive = (id) => {
    setExpandedTopics((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Filtered concepts
  const filteredConcepts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return CONCEPTS.filter((c) => {
      const matchesCat = selectedCategory === 'all' || c.category === selectedCategory;
      if (!matchesCat) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.oneLiner.toLowerCase().includes(q) ||
        c.standard.toLowerCase().includes(q) ||
        c.citation.toLowerCase().includes(q) ||
        c.mechanism.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
      );
    });
  }, [selectedCategory, searchQuery]);

  return (
    <div
      className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10"
      style={{ fontFamily: 'var(--font-sans)' }}
    >
      {/* Page Header */}
      <header className="space-y-3">
        <div
          className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--accent-eloran)' }}
        >
          <BookOpen size={15} aria-hidden="true" />
          <span>Interactive Physics &amp; Mathematical Knowledge Base</span>
        </div>
        <h1
          className="text-3xl md:text-4xl font-bold font-mono tracking-tight"
          style={{ color: 'var(--text-primary)' }}
        >
          Loran-C &amp; eLoran Theoretical Foundations
        </h1>
        <p className="text-sm max-w-3xl leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Concise, mathematically rigorous principles governing low-frequency radionavigation,
          hyperbolic multilateration, Millington groundwave physics, and sovereign PNT resilience.
          Every topic provides key invariants, standard bounds, and one-click simulator verification.
        </p>

        {/* Search & Category Filter Navigation */}
        <div className="pt-4 space-y-3">
          {/* Search Bar */}
          <div className="relative max-w-md">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-dim)' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search theory, formulas, standards (e.g. Millington, GDOP, Boyce, 100 kHz)..."
              className="w-full pl-9 pr-9 py-2 rounded-xl text-xs font-mono transition focus:outline-none"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-dim)] hover:text-[var(--text-primary)]"
                title="Clear search"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = selectedCategory === cat.id;
              const count = cat.id === 'all'
                ? CONCEPTS.length
                : CONCEPTS.filter((c) => c.category === cat.id).length;

              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center gap-2 transition cursor-pointer"
                  style={{
                    background: isActive ? 'var(--accent-eloran)' : 'var(--bg-surface)',
                    color: isActive ? '#050b14' : 'var(--text-secondary)',
                    border: `1px solid ${isActive ? 'var(--accent-eloran)' : 'var(--border-subtle)'}`,
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  <Icon size={13} aria-hidden="true" />
                  <span>{cat.label}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.2 rounded-full font-mono"
                    style={{
                      background: isActive ? 'rgba(0,0,0,0.2)' : 'var(--bg-subtle)',
                      color: isActive ? '#050b14' : 'var(--text-dim)',
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Results Count / Active Filter Notice */}
      <div className="flex items-center justify-between text-xs font-mono text-[var(--text-dim)] pb-1 border-b border-[var(--border-subtle)]">
        <span>
          Showing <strong className="text-[var(--text-primary)]">{filteredConcepts.length}</strong> of {CONCEPTS.length} theoretical topics
          {searchQuery && <span> matching &ldquo;{searchQuery}&rdquo;</span>}
        </span>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="text-[var(--accent-eloran)] hover:underline flex items-center gap-1 cursor-pointer"
          >
            Reset filter
          </button>
        )}
      </div>

      {/* Concept Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredConcepts.map((c) => {
          const Icon = c.icon;
          const isExpanded = Boolean(expandedTopics[c.id]);

          return (
            <article
              key={c.id}
              id={c.id}
              className="rounded-2xl p-6 flex flex-col justify-between space-y-4 scroll-mt-24 transition-all"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              {/* Header row: Icon, Category & Standard Badge */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: `var(${c.accentVar}-subtle, var(--bg-subtle))`,
                        color: `var(${c.accentVar})`,
                        border: `1px solid var(${c.accentVar}-border, var(--border-subtle))`,
                      }}
                    >
                      <Icon size={16} aria-hidden="true" />
                    </div>
                    <span
                      className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded font-semibold"
                      style={{
                        background: 'var(--bg-subtle)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      {c.standard}
                    </span>
                  </div>

                  <span
                    className="text-[9px] font-mono text-[var(--text-dim)] shrink-0 hidden sm:inline"
                    title={c.citation}
                  >
                    {c.citation}
                  </span>
                </div>

                {/* Title & Core One-Liner */}
                <h2 className="text-base font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
                  {c.title}
                </h2>

                <p className="text-xs font-sans leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {c.oneLiner}
                </p>
              </div>

              {/* Math Formula Box */}
              <div
                className="px-4 py-2.5 rounded-xl text-xs overflow-x-auto flex items-center gap-3"
                style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
              >
                <span
                  className="text-[10px] font-mono uppercase font-bold tracking-wider shrink-0"
                  style={{ color: 'var(--text-dim)' }}
                >
                  Formula:
                </span>
                <MathView math={c.math} />
              </div>

              {/* Structured Key Points: Mechanism, Limit & Standard */}
              <div className="space-y-2 text-xs font-sans pt-1">
                <div className="flex items-start gap-2">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--text-dim)] border border-[var(--border-subtle)] shrink-0 mt-0.5">
                    PHYSICS
                  </span>
                  <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    <strong className="text-[var(--text-primary)]">Mechanism:</strong> {c.mechanism}
                  </p>
                </div>

                <div className="flex items-start gap-2">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--status-warn-subtle)] text-[var(--status-warn)] border border-[var(--status-warn-border)] shrink-0 mt-0.5">
                    LIMIT
                  </span>
                  <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    <strong className="text-[var(--text-primary)]">Boundary:</strong> {c.operationalLimit}
                  </p>
                </div>

                <div className="flex items-start gap-2">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--status-ok-subtle)] text-[var(--status-ok)] border border-[var(--status-ok-border)] shrink-0 mt-0.5">
                    SPEC
                  </span>
                  <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    <strong className="text-[var(--text-primary)]">Standard:</strong> {c.targetStandard}
                  </p>
                </div>
              </div>

              {/* Expandable Technical Deep-Dive */}
              {c.deepDive && (
                <div className="pt-2 border-t border-[var(--border-subtle)]">
                  <button
                    onClick={() => toggleDeepDive(c.id)}
                    className="text-[11px] font-mono text-[var(--text-dim)] hover:text-[var(--text-primary)] flex items-center justify-between w-full py-1 cursor-pointer transition"
                  >
                    <span>{isExpanded ? 'Hide Theoretical Derivation' : 'Expand Theoretical Derivation'}</span>
                    {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>

                  {isExpanded && (
                    <div className="mt-2 p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[11px] font-sans leading-relaxed text-[var(--text-secondary)] animate-fadeIn">
                      {c.deepDive}
                    </div>
                  )}
                </div>
              )}

              {/* Interactive Simulator Launcher CTA */}
              <div className="pt-2 border-t border-[var(--border-subtle)]">
                <button
                  onClick={() => handleLaunch(c.presetId, c.targetRoute)}
                  className="w-full py-2 px-3 rounded-lg text-xs font-mono font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
                  title={`Open ${c.title} scenario in simulator`}
                  aria-label={`Open ${c.title} scenario in simulator`}
                  style={{
                    background: `var(${c.accentVar}-subtle, var(--accent-eloran-subtle))`,
                    color: `var(${c.accentVar}, var(--accent-eloran))`,
                    border: `1px solid var(${c.accentVar}-border, var(--accent-eloran-border))`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '0.9';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '1';
                  }}
                >
                  <span>{c.buttonLabel}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* Deep-Dive Physical Foundations Section */}
      <section className="space-y-6 pt-6 border-t border-[var(--border-subtle)]">
        <div>
          <div
            className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider mb-1"
            style={{ color: 'var(--accent-eloran)' }}
          >
            <Layers size={14} aria-hidden="true" /> Electromagnetic &amp; Geodetic Physics
          </div>
          <h2
            className="text-2xl font-bold tracking-tight font-mono"
            style={{ color: 'var(--text-primary)' }}
          >
            Physical Foundations &amp; Propagation Models
          </h2>
          <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--text-secondary)' }}>
            Mathematical formulations implemented in the SIMULORAN physics engine, verified with exact
            SI units and published academic references.
          </p>
        </div>

        {/* 4 Physical Foundation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: WGS-84 Geodesics */}
          <div
            className="rounded-2xl p-5 border space-y-3 font-mono text-xs"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <span className="font-bold text-sm text-[var(--text-primary)]">
                1. WGS-84 Ellipsoidal Geodesics
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--status-ok-subtle)] text-[var(--status-ok)] border border-[var(--status-ok-border)]">
                Karney (2013)
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)] font-sans">
              Terrestrial LF waves traverse the curved oblate Earth ellipsoid. Spherical trigonometry introduces
              errors up to ~0.5% (several kilometers), catastrophic for precision eLoran navigation:
            </p>
            <div className="p-2.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] overflow-x-auto text-xs">
              <MathView math="s = b \int_0^{\sigma} \sqrt{1 + k^2 \sin^2 \sigma'} \, d\sigma', \quad a = 6378137.0\text{ m}, \quad f = 1/298.257223563" />
            </div>
            <div className="text-[10px] leading-normal text-[var(--text-muted)] space-y-0.5 font-mono bg-[var(--bg-subtle)]/50 p-2.5 rounded-lg border border-[var(--border-subtle)]">
              <div><strong>SI Parameters:</strong> Equatorial radius <strong>a = 6,378,137.0 m</strong>, flattening <strong>f = 1/298.257223563</strong>, geodesic distance <strong>s [m]</strong>.</div>
              <div className="text-[9px] pt-1 border-t border-[var(--border-subtle)] text-[var(--text-dim)]">
                <strong>Accuracy:</strong> Millimeter precision at antipodal distances via GeographicLib algorithms.
              </div>
            </div>
          </div>

          {/* Card 2: Millington Multi-Boundary */}
          <div
            className="rounded-2xl p-5 border space-y-3 font-mono text-xs"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <span className="font-bold text-sm text-[var(--text-primary)]">
                2. Millington Multi-Boundary Method
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--status-ok-subtle)] text-[var(--status-ok)] border border-[var(--status-ok-border)]">
                ITU-R P.368-10
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)] font-sans">
              Mixed land-sea propagation paths accumulate non-linear phase retardation across conductivity discontinuities:
            </p>
            <div className="p-2.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] overflow-x-auto text-xs">
              <MathView math="\Phi_F = \Delta t_1(x_1) + \sum_{k=2}^M [\Delta t_k(x_k) - \Delta t_k(x_{k-1})], \quad \text{ASF} = \frac{1}{2}(\Phi_F + \Phi_R)" />
            </div>
            <div className="text-[10px] leading-normal text-[var(--text-muted)] space-y-0.5 font-mono bg-[var(--bg-subtle)]/50 p-2.5 rounded-lg border border-[var(--border-subtle)]">
              <div><strong>Millington Recovery:</strong> At land-to-sea boundaries, <code className="text-[var(--text-primary)]">{'Δt_k(x_k) - Δt_k(x_{k-1}) < 0'}</code>, creating rapid phase recovery.</div>
              <div className="text-[9px] pt-1 border-t border-[var(--border-subtle)] text-[var(--text-dim)]">
                <strong>Standard:</strong> Verified with Millington (1949) and ITU-R Recommendation P.368-10.
              </div>
            </div>
          </div>

          {/* Card 3: Monotonic Delay & Terrain Conductivity */}
          <div
            className="rounded-2xl p-5 border space-y-3 font-mono text-xs"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <span className="font-bold text-sm text-[var(--text-primary)]">
                3. Monotonic Delay &amp; Conductivity Invariant
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--status-ok-subtle)] text-[var(--status-ok)] border border-[var(--status-ok-border)]">
                Physical Invariant
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)] font-sans">
              Electromagnetic phase delay exhibits strict physical monotonicity across path length and soil resistivity:
            </p>
            <ul className="space-y-1.5 text-[11px] text-[var(--text-secondary)] font-sans list-disc list-inside">
              <li>
                <strong className="text-[var(--text-primary)]">Seawater Paths (σ = 5.0 S/m):</strong> Propagates near speed of light in air; accumulated <span className="font-mono text-[var(--accent-eloran)]">ASF ≈ 0.00 m</span>.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Resistive Land (σ = 0.001 S/m):</strong> Accumulates monotonically: ~15 m at 100 km, ~45 m at 300 km, ~75 m at 500 km.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Reciprocal Equality:</strong> Delay along trajectory A→B strictly equals B→A (<span className="font-mono">ASF(A→B) ≡ ASF(B→A)</span>).
              </li>
            </ul>
          </div>

          {/* Card 4: Atmospheric Refractivity */}
          <div
            className="rounded-2xl p-5 border space-y-3 font-mono text-xs"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <span className="font-bold text-sm text-[var(--text-primary)]">
                4. Tropospheric Refractivity &amp; Seasonal Drift
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--status-ok-subtle)] text-[var(--status-ok)] border border-[var(--status-ok-border)]">
                Smith &amp; Weintraub (1953)
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)] font-sans">
              Tropospheric refractive index <span className="font-mono text-[var(--text-primary)]">n</span> modifies groundwave phase velocity <span className="font-mono text-[var(--text-primary)]">v = c / n</span>:
            </p>
            <div className="p-2.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] overflow-x-auto text-xs">
              <MathView math="N = (n - 1) \times 10^6 = 77.6 \frac{P}{T} + 3.73 \times 10^5 \frac{e}{T^2}" />
            </div>
            <div className="text-[10px] leading-normal text-[var(--text-muted)] space-y-0.5 font-mono bg-[var(--bg-subtle)]/50 p-2.5 rounded-lg border border-[var(--border-subtle)]">
              <div><strong>Units:</strong> Pressure <span className="text-[var(--text-primary)]">P [hPa]</span>, temperature <span className="text-[var(--text-primary)]">T [K]</span>, vapor pressure <span className="text-[var(--text-primary)]">e [hPa]</span>, refractivity <span className="text-[var(--text-primary)]">N [ppm]</span>.</div>
              <div className="text-[9px] pt-1 border-t border-[var(--border-subtle)] text-[var(--text-dim)]">
                <strong>Empirical Observation:</strong> Generates up to ~100 ns sinusoidal seasonal drift over 500 km (Song &amp; Son 2025).
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Empirical Field Trial Benchmarks & Real-World Validation */}
      <section id="empirical-benchmarks" className="space-y-4">
        <div>
          <div
            className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider mb-1"
            style={{ color: 'var(--accent-eloran)' }}
          >
            <Database size={14} aria-hidden="true" /> Empirical Scientific Verification
          </div>
          <h2
            className="text-2xl font-bold tracking-tight font-mono"
            style={{ color: 'var(--text-primary)' }}
          >
            Empirical Field Trial Benchmarks
          </h2>
          <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--text-secondary)' }}>
            To guard against circular self-validation, SIMULORAN is benchmarked against real-world
            accuracy campaigns from the Korean Nationwide eLoran Testbed (Rhee et al., 2021) and the
            Maoming Inland Ellipsoidal Geodesic Experiment (Gao et al., 2025) without artificial parameter tuning.
          </p>
        </div>

        <div
          className="rounded-2xl p-5 border"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <TrialValidationPanel />
        </div>
      </section>
    </div>
  );
}