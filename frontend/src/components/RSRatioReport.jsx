import React, { useEffect, useState, useMemo } from 'react';

const API = 'https://algo-scanner-lnck.onrender.com';
const DAYS = 63;
const JDK_PERIOD  = 14;   // SMA + StdDev window — original JdK parameter
const ROC_PERIOD  = 10;   // ROC lookback — original JdK parameter

// ── Exact JdK RRG formulas (Julius de Kempenaer) ─────────────────────────────
//
// RS Ratio   = 100 + (RS - SMA14(RS)) / StdDev14(RS)
//   RS = sector_avg_close / Nifty500_close  (stored daily in sector_rs_history)
//   Normalises the ratio as a Z-score centred at 100.
//   > 100 = above average relative strength vs Nifty500
//   < 100 = below average relative strength
//
// ROC        = (RS_Ratio[t] - RS_Ratio[t-10]) / RS_Ratio[t-10] × 100
//
// RS Momentum = 100 + (ROC - SMA14(ROC)) / StdDev14(ROC)
//   Normalises the rate-of-change as a Z-score centred at 100.
//   > 100 = momentum accelerating  (ROC above its recent norm)
//   < 100 = momentum decelerating  (ROC below its recent norm)
//
// Quadrants:
//   LEADING   : RS Ratio ≥ 100  AND  RS Momentum ≥ 100
//   WEAKENING : RS Ratio ≥ 100  AND  RS Momentum <  100
//   IMPROVING : RS Ratio <  100  AND  RS Momentum ≥ 100
//   LAGGING   : RS Ratio <  100  AND  RS Momentum <  100

// ── Math helpers ─────────────────────────────────────────────────────────────
function rollingMean(vals, period) {
  return vals.map((_, i) => {
    const w = vals.slice(Math.max(0, i - period + 1), i + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
}

function rollingPStdDev(vals, period) {
  return vals.map((_, i) => {
    const w = vals.slice(Math.max(0, i - period + 1), i + 1);
    if (w.length < 2) return 0.0001;
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    return Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / w.length) || 0.0001;
  });
}

function linRegSlope(vals) {
  const n = vals.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = vals.reduce((a, b) => a + b, 0) / n;
  const num = vals.reduce((s, v, i) => s + (i - mx) * (v - my), 0);
  const den = vals.reduce((s, _, i) => s + (i - mx) ** 2, 0) || 1;
  return num / den;
}

function computeMetrics(series) {
  if (!series || series.length < JDK_PERIOD + ROC_PERIOD + 2) return null;

  const raw = series.map(d => d.rs_ratio);

  // ── vs Nifty500 & Absolute Return (63d from anchor) ─────────────────────────
  // rs_ratio    = avg_stock_return_from_anchor / nifty_return_from_anchor
  // sector_return = avg_stock_return_from_anchor (raw, e.g. 1.1628 = +16.28%)
  const latestRaw      = raw[raw.length - 1];
  const latestSectorRet = series[series.length - 1]?.sector_return ?? null;
  const vsNifty500     = (latestRaw - 1) * 100;                                   // e.g. +17.7%
  const absReturn63d   = latestSectorRet != null ? (latestSectorRet - 1) * 100 : null; // e.g. +16.28%

  // ── RS Ratio: Z-score of raw ratio using 14-period SMA + StdDev ──
  const rsMean   = rollingMean(raw, JDK_PERIOD);
  const rsStdDev = rollingPStdDev(raw, JDK_PERIOD);
  const rsRatioSeries = raw.map((v, i) =>
    100 + (v - rsMean[i]) / rsStdDev[i]
  );
  const rsRatioCurrent = rsRatioSeries[rsRatioSeries.length - 1];

  // ── ROC of RS Ratio (10-period) ──
  const rocSeries = rsRatioSeries.map((v, i) => {
    if (i < ROC_PERIOD) return 0;
    const past = rsRatioSeries[i - ROC_PERIOD];
    return past ? ((v - past) / past) * 100 : 0;
  });
  const rocCurrent = rocSeries[rocSeries.length - 1];

  // ── RS Momentum: Z-score of ROC using 14-period SMA + StdDev ──
  const rocMean   = rollingMean(rocSeries, JDK_PERIOD);
  const rocStdDev = rollingPStdDev(rocSeries, JDK_PERIOD);
  const rsMomSeries = rocSeries.map((v, i) =>
    100 + (v - rocMean[i]) / rocStdDev[i]
  );
  const rsMomentum = rsMomSeries[rsMomSeries.length - 1];

  // ── Quadrant ──
  let quadrant;
  if      (rsRatioCurrent >= 100 && rsMomentum >= 100) quadrant = 'LEADING';
  else if (rsRatioCurrent >= 100 && rsMomentum <  100) quadrant = 'WEAKENING';
  else if (rsRatioCurrent <  100 && rsMomentum >= 100) quadrant = 'IMPROVING';
  else                                                  quadrant = 'LAGGING';

  // ── 10D Dir: slope of last 10 RS Ratio values, as %/day ──
  const last10    = rsRatioSeries.slice(-ROC_PERIOD);
  const slope     = linRegSlope(last10);
  const meanL10   = last10.reduce((a, b) => a + b, 0) / last10.length || 1;
  const pctPerDay = Math.abs((slope / meanL10) * 100);

  // ── % from 63d high of RS Ratio series ──
  const highRS      = Math.max(...rsRatioSeries);
  const pctFromHigh = highRS > 0 ? ((rsRatioCurrent - highRS) / highRS) * 100 : 0;

  // ── Sparkline: normalized raw ratio (day1 = 100) — smooth price trend ──
  // Z-score series is noisy because the rolling mean shifts daily.
  // Raw ratio normalized to 100 on day 1 shows the actual relative trend clearly.
  const base0 = raw[0] || 1;
  const sparklineSeries = raw.map(v => (v / base0) * 100);

  return {
    rsRatioCurrent,   // Z-score centred at 100
    rsMomentum,       // Z-score centred at 100
    roc: rocCurrent,  // raw 10d ROC of RS Ratio (input to RS Momentum)
    quadrant,
    slopeRising: slope > 0,
    pctPerDay,
    pctFromHigh,
    vsNifty500,       // % outperformance vs Nifty500 from anchor (e.g. +17.7)
    absReturn63d,     // % absolute return of sector from anchor (e.g. +16.28)
    rsRatioSeries,    // Z-score series (used for RS Ratio value, RS Momentum, quadrant)
    sparklineSeries,  // normalized raw ratio (used only for the sparkline visual)
  };
}

// ── Sparkline (plots RS Ratio series, centerline at 100) ─────────────────────
function Sparkline({ rsRatioSeries, quadrant }) {
  if (!rsRatioSeries || rsRatioSeries.length < 2) {
    return <div style={{ width: 120, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#94a3b8' }}>No data</div>;
  }
  const vals = rsRatioSeries;
  const min  = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 0.01;
  const W = 120, H = 40, pad = 3;

  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const lastX   = pad + (W - pad * 2);
  const lastY   = pad + (1 - (vals[vals.length - 1] - min) / range) * (H - pad * 2);
  const fillPts = `${pad},${H - pad} ${pts} ${lastX},${H - pad}`;

  const color = quadrant === 'LEADING'   ? '#16a34a'
              : quadrant === 'IMPROVING' ? '#f59e0b'
              : quadrant === 'WEAKENING' ? '#ea580c'
              : '#dc2626';

  const fillColor = quadrant === 'LEADING'   ? 'rgba(22,163,74,0.12)'
                  : quadrant === 'IMPROVING' ? 'rgba(245,158,11,0.12)'
                  : quadrant === 'WEAKENING' ? 'rgba(234,88,12,0.12)'
                  : 'rgba(220,38,38,0.10)';

  return (
    <svg width={W} height={H} style={{ overflow: 'visible', display: 'block' }}>
      <polygon points={fillPts} fill={fillColor} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

// ── Quadrant badge ─────────────────────────────────────────────────────────────
const Q_CFG = {
  LEADING:   { color: '#16a34a', bg: 'rgba(22,163,74,0.15)',   border: 'rgba(22,163,74,0.4)'   },
  WEAKENING: { color: '#ea580c', bg: 'rgba(234,88,12,0.13)',   border: 'rgba(234,88,12,0.4)'   },
  IMPROVING: { color: '#d97706', bg: 'rgba(245,158,11,0.13)',  border: 'rgba(245,158,11,0.4)'  },
  LAGGING:   { color: '#dc2626', bg: 'rgba(220,38,38,0.12)',   border: 'rgba(220,38,38,0.4)'   },
};

function QuadrantBadge({ q }) {
  const cfg = Q_CFG[q] ?? Q_CFG.LAGGING;
  return (
    <span style={{ padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 800, letterSpacing: '0.3px', color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}`, whiteSpace: 'nowrap' }}>
      {q}
    </span>
  );
}

// ── 10D Dir cell ──────────────────────────────────────────────────────────────
function DirCell({ slopeRising, pctPerDay }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: slopeRising ? '#16a34a' : '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      {slopeRising ? '▲' : '▼'} {slopeRising ? 'Rising' : 'Falling'}
      <span style={{ fontWeight: 500, opacity: 0.75 }}>({pctPerDay.toFixed(2)}%/d)</span>
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RSRatioReport({ theme, onScanNavigate }) {
  const isDark = theme === 'dark';

  const [tab, setTab]                   = useState('sector');
  const [sectorMeta, setSectorMeta]     = useState([]);
  const [industryMeta, setIndustryMeta] = useState([]);
  const [microMeta, setMicroMeta]       = useState([]);
  const [history, setHistory]           = useState({});
  const [histLoading, setHistLoading]   = useState(true);
  const [hasHistory, setHasHistory]     = useState(false);
  const [sortKey, setSortKey]           = useState('quadrant');
  const [sortDir, setSortDir]           = useState('asc');
  const [qFilter, setQFilter]           = useState('ALL');
  const [search, setSearch]             = useState('');
  const [showInfo, setShowInfo]         = useState(false);
  const [selectedRows, setSelectedRows] = useState(new Set());

  const t = {
    bg:      isDark ? '#020617' : '#f1f5f9',
    panel:   isDark ? '#0f172a' : '#ffffff',
    text:    isDark ? '#f8fafc' : '#0f172a',
    muted:   isDark ? '#94a3b8' : '#64748b',
    border:  isDark ? '#1e293b' : '#e2e8f0',
    hover:   isDark ? '#1e293b' : '#f8fafc',
    header:  isDark ? '#0f172a' : '#f8fafc',
    inputBg: isDark ? '#020617' : '#ffffff',
  };

  const tabConfig = {
    sector:   { label: 'Sector',         groupType: 'sector',        key: 'sector',         meta: sectorMeta },
    industry: { label: 'Macro Industry', groupType: 'industry',      key: 'industry',       meta: industryMeta },
    micro:    { label: 'Basic Industry', groupType: 'basic_industry', key: 'basic_industry', meta: microMeta },
  };

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/sector-heatmap`).then(r => r.json()),
      fetch(`${API}/api/industry-heatmap`).then(r => r.json()),
      fetch(`${API}/api/micro-industry-heatmap`).then(r => r.json()),
    ]).then(([s, i, m]) => {
      setSectorMeta(Array.isArray(s) ? s : []);
      setIndustryMeta(Array.isArray(i) ? i : []);
      setMicroMeta(Array.isArray(m) ? m : []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setHistLoading(true);
    setHistory({});
    const gt = tabConfig[tab].groupType;
    fetch(`${API}/api/sector-rs-history?group_type=${gt}&days=${DAYS}`)
      .then(r => r.json())
      .then(data => {
        const hasData = data && Object.keys(data).length > 0 &&
          Object.values(data).some(arr => arr.length >= ROC_PERIOD + 1);
        setHasHistory(hasData);
        setHistory(data || {});
        setHistLoading(false);
      })
      .catch(() => setHistLoading(false));
  }, [tab]);

  const enriched = useMemo(() => {
    const { key: groupKey, meta } = tabConfig[tab];
    return meta.map(row => {
      const name    = row[groupKey] || '';
      const series  = history[name] || null;
      const metrics = series ? computeMetrics(series) : null;
      return { ...row, _name: name, _series: series, _metrics: metrics, _groupKey: groupKey };
    });
  }, [tab, sectorMeta, industryMeta, microMeta, history]);

  const displayed = useMemo(() => {
    let rows = enriched;
    if (qFilter !== 'ALL') rows = rows.filter(r => r._metrics?.quadrant === qFilter);
    if (search) {
      const lo = search.toLowerCase();
      rows = rows.filter(r => r._name.toLowerCase().includes(lo));
    }
    // Quadrant rotation order: LEADING → IMPROVING → WEAKENING → LAGGING
    // Within each quadrant: sort by Euclidean distance from center (100, 100)
    // — original RRG method. Furthest from center = strongest signal = shown first.
    // distance = sqrt((RS_Ratio - 100)^2 + (RS_Momentum - 100)^2)
    const Q_ORDER = { LEADING: 0, IMPROVING: 1, WEAKENING: 2, LAGGING: 3 };
    const dist = r => {
      const m = r._metrics;
      if (!m) return 0;
      return Math.sqrt((m.rsRatioCurrent - 100) ** 2 + (m.rsMomentum - 100) ** 2);
    };

    return [...rows].sort((a, b) => {
      if (sortKey === 'quadrant') {
        const qa = Q_ORDER[a._metrics?.quadrant] ?? 4;
        const qb = Q_ORDER[b._metrics?.quadrant] ?? 4;
        if (qa !== qb) return sortDir === 'asc' ? qa - qb : qb - qa;
        // Within same quadrant: furthest from center (100,100) first
        return dist(b) - dist(a);
      }
      const get = r => {
        const m = r._metrics;
        if (sortKey === 'rsRatioCurrent') return m?.rsRatioCurrent ?? -Infinity;
        if (sortKey === 'rsMomentum')     return m?.rsMomentum ?? -Infinity;
        if (sortKey === 'pctFromHigh')    return m?.pctFromHigh ?? -Infinity;
        if (sortKey === 'vsNifty500')     return m?.vsNifty500 ?? -Infinity;
        if (sortKey === 'absReturn63d')   return m?.absReturn63d ?? -Infinity;
        if (sortKey === '_name')          return r._name ?? '';
        if (sortKey === 'total_stocks')   return r.total_stocks ?? 0;
        return -Infinity;
      };
      const av = get(a), bv = get(b);
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [enriched, qFilter, search, sortKey, sortDir]);

  const qCounts = useMemo(() => {
    const c = { LEADING: 0, WEAKENING: 0, IMPROVING: 0, LAGGING: 0 };
    enriched.forEach(r => { const q = r._metrics?.quadrant; if (q) c[q]++; });
    return c;
  }, [enriched]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };
  const sa = (key) => sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  const TH = ({ label, k, align = 'left' }) => (
    <th onClick={() => toggleSort(k)}
      style={{ padding: '10px 14px', fontSize: 11, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', cursor: 'pointer', textAlign: align, userSelect: 'none', whiteSpace: 'nowrap', backgroundColor: t.header, borderBottom: `2px solid ${t.border}` }}>
      {label}{sa(k)}
    </th>
  );

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', backgroundColor: t.bg, minHeight: '100%', padding: '20px 24px', color: t.text }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px' }}>Relative Rotation Graph (RRG)</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: t.muted }}>
              JdK RS Ratio vs RS Momentum · 63-day window vs Nifty500 · Original Julius de Kempenaer formula
            </p>
          </div>
          <button onClick={() => setShowInfo(v => !v)}
            style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${t.border}`, backgroundColor: t.panel, color: t.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
            {showInfo ? 'Hide formula ▲' : 'Formula & what to look for ▼'}
          </button>
        </div>

        {/* Formula panel */}
        {showInfo && (
          <div style={{ marginTop: 14, backgroundColor: t.panel, border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: `1px solid ${t.border}`, backgroundColor: isDark ? '#0f172a' : '#f8fafc' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: t.text }}>Formula & What to Look For</div>
            </div>

            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, backgroundColor: isDark ? 'rgba(30,41,59,0.4)' : '#f8fafc' }}>
              <code style={{ display: 'block', fontSize: 12, lineHeight: 2, color: isDark ? '#7dd3fc' : '#1e40af', fontFamily: 'monospace' }}>
                RS               = avg(stock_return_from_anchor) / nifty500_return_from_anchor  (stored daily)<br />
                Abs Return (63D) = avg stock return from anchor date  e.g. +16.3% means sector avg up 16.3%<br />
                vs Nifty500 (63D)= (RS_ratio - 1) × 100  e.g. +17.7% means sector beat Nifty500 by 17.7 pts<br />
                RS Ratio         = 100 + (RS - SMA14(RS)) / StdDev14(RS)  — Z-score centred at 100<br />
                RS Momentum (10D)= 100 + (ROC10 - SMA14(ROC10)) / StdDev14(ROC10)  where ROC10 = 10-day ROC of RS Ratio<br />
                % from High      = (RS_Ratio_today - max_RS_Ratio_63d) / max_RS_Ratio_63d × 100
              </code>
              <div style={{ marginTop: 10, padding: '8px 12px', backgroundColor: isDark ? 'rgba(22,163,74,0.1)' : '#f0fdf4', borderRadius: 6, border: `1px solid ${isDark ? 'rgba(22,163,74,0.3)' : '#bbf7d0'}`, fontSize: 12, color: isDark ? '#4ade80' : '#15803d', fontWeight: 600 }}>
                Look for: IMPROVING → LEADING rotation · RS Ratio above 100 · RS Momentum (10D) above 100 · vs Nifty500 positive · % from High near 0%
              </div>
            </div>

            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 0 }}>
              {[
                {
                  col: 'RS Ratio (63D) — Sparkline',
                  color: '#3b82f6',
                  formula: 'Full 63-day series of RS Ratio = 100 + (RS - SMA14(RS)) / StdDev14(RS)',
                  means: 'Line chart of the RS Ratio Z-score over 63 trading days. Centerline is 100. Each point shows how many standard deviations the sector\'s relative strength vs Nifty500 is from its own 14-day average. Above 100 = outperforming on a normalised basis. Below 100 = below recent average.',
                  lookfor: 'Line trending upward and staying above 100 = sustained relative strength. Crossing from below 100 to above = IMPROVING → LEADING rotation beginning. Color = quadrant: Green (LEADING) · Orange (IMPROVING) · Dark Orange (WEAKENING) · Red (LAGGING).',
                },
                {
                  col: 'vs Nifty 500 (63D)',
                  color: '#f59e0b',
                  formula: '(rs_ratio - 1) × 100  where rs_ratio = avg(stock_return_from_anchor) / nifty500_return_from_anchor',
                  means: 'How much the sector has outperformed or underperformed Nifty500 in percentage points over the 63-day window from anchor date. This is the raw outperformance number — Nifty500 is always the baseline (0%). Positive = beating Nifty500. Negative = lagging Nifty500.',
                  lookfor: 'Positive and growing = sector gaining ground vs Nifty500. Use alongside RS Ratio to confirm strength.',
                  example: '+17.7% = sector returned 17.7 percentage points more than Nifty500 from anchor · -2.1% = sector lagged Nifty500 by 2.1 pts',
                },
                {
                  col: 'Abs Return (63D)',
                  color: '#6366f1',
                  formula: '(avg_stock_return_from_anchor - 1) × 100  — average % gain of all stocks in the sector from anchor date',
                  means: 'The actual absolute return of the sector\'s stocks from the anchor date (first day of the 63-day window), regardless of what Nifty500 did. This shows the raw price performance of the sector itself.',
                  lookfor: 'Use alongside vs Nifty500 to understand the full picture. High abs return + high vs Nifty500 = sector leading in both absolute and relative terms.',
                  example: '+16.3% = sector stocks gained 16.3% on average from anchor date · -2.6% = sector down 2.6% from anchor',
                },
                {
                  col: 'RS Ratio',
                  color: '#8b5cf6',
                  formula: '100 + (RS_today - SMA14(RS)) / StdDev14(RS)  where RS = avg(stock_return) / nifty500_return',
                  means: 'The current Z-score of the sector\'s relative strength vs its own 14-day history. Above 100 = sector\'s outperformance is above its recent average (gaining). Below 100 = below its recent average (fading). Think of it as speed — how fast the sector is moving vs Nifty500 right now compared to its own recent norm.',
                  lookfor: 'Above 100 = outperformer (green). Below 100 = underperformer (red). Values typically stay in the 95–105 range — small deviations are significant.',
                  example: '101.32 = RS is above its 14d mean → outperforming · 99.78 = below its 14d mean → fading',
                },
                {
                  col: 'RS Momentum (10D)',
                  color: '#10b981',
                  formula: '100 + (ROC10 - SMA14(ROC10)) / StdDev14(ROC10)  where ROC10 = 10-day rate of change of RS Ratio',
                  means: 'The Z-score of the RS Ratio\'s own rate of change — measures whether the sector is accelerating or decelerating vs Nifty500. Think of RS Ratio as speed and RS Momentum as acceleration. A car going fast but slowing down = RS Ratio > 100, RS Momentum < 100 (Weakening). A car going slow but speeding up = RS Ratio < 100, RS Momentum > 100 (Improving).',
                  lookfor: 'Above 100 = momentum accelerating (green). Below 100 = decelerating (red). Both RS Ratio and RS Momentum > 100 = LEADING (strongest). RS Ratio < 100 but RS Momentum > 100 = IMPROVING (early entry opportunity).',
                  example: '101.57 = ROC above its 14d norm → momentum building · 98.95 = ROC below its 14d norm → momentum fading',
                },
                {
                  col: 'Quadrant',
                  color: '#16a34a',
                  formula: 'RS Ratio vs 100 (relative strength line) + RS Momentum (10D) vs 100 (acceleration line)',
                  means: [
                    { q: 'LEADING',   desc: 'RS Ratio > 100 AND RS Momentum > 100. Sector is outperforming Nifty500 AND accelerating. Strongest quadrant — overweight.' },
                    { q: 'WEAKENING', desc: 'RS Ratio > 100 BUT RS Momentum < 100. Still outperforming but momentum is fading. Like a fast car slowing down — consider reducing exposure.' },
                    { q: 'IMPROVING', desc: 'RS Ratio < 100 BUT RS Momentum > 100. Below recent average but accelerating. Like a slow car speeding up — best early entry signal before rotation into LEADING.' },
                    { q: 'LAGGING',   desc: 'RS Ratio < 100 AND RS Momentum < 100. Underperforming and getting worse. Avoid. Rotation cycle: LAGGING → IMPROVING → LEADING → WEAKENING → LAGGING.' },
                  ],
                  lookfor: 'Best entry: IMPROVING (early) or fresh LEADING (confirmed). Exit signal: WEAKENING. Avoid: LAGGING.',
                },
                {
                  col: '% from High',
                  color: '#ef4444',
                  formula: '(RS_Ratio_today - max_RS_Ratio_in_63d) / max_RS_Ratio_in_63d × 100',
                  means: 'How far today\'s RS Ratio Z-score is from its 63-day peak. Shown as — when at the peak. A large negative means the sector had a stronger relative strength run earlier in the window but has since pulled back.',
                  lookfor: '— or near 0% + LEADING quadrant = sector at peak relative strength right now, freshest signal. Large negative on a LEADING sector = still strong but extended, higher risk entry.',
                  example: '— = at 63d RS high right now (strongest signal) · -14.6% = RS Ratio has fallen 14.6% from its 63d peak',
                },
              ].map((item, i, arr) => (
                <div key={i} style={{ padding: '14px 0', borderBottom: i < arr.length - 1 ? `1px solid ${t.border}` : 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 3, height: 16, backgroundColor: item.color, borderRadius: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 900, color: t.text, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{item.col}</span>
                  </div>
                  <Row label="Formula" val={<code style={{ fontSize: 11, color: isDark ? '#7dd3fc' : '#1e40af', lineHeight: 1.6 }}>{item.formula}</code>} />
                  <Row label="Means" val={
                    item.col === 'QUADRANT' || item.col === 'Quadrant' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {item.means.map(({ q, desc }) => (
                          <div key={q} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <QuadrantBadge q={q} />
                            <span style={{ fontSize: 12, color: t.muted, lineHeight: 1.6 }}>{desc}</span>
                          </div>
                        ))}
                      </div>
                    ) : <span style={{ fontSize: 12, color: t.muted, lineHeight: 1.6 }}>{item.means}</span>
                  } />
                  {item.example && <Row label="Example" val={<span style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#475569', fontStyle: 'italic', lineHeight: 1.6 }}>{item.example}</span>} />}
                  {item.lookfor && <Row label="Look for" val={<span style={{ fontSize: 12, color: isDark ? '#4ade80' : '#15803d', fontWeight: 600, lineHeight: 1.6 }}>{item.lookfor}</span>} labelColor="#16a34a" />}
                </div>
              ))}
            </div>
          </div>
        )}

        {!histLoading && !hasHistory && (
          <div style={{ marginTop: 14, padding: '12px 16px', backgroundColor: isDark ? 'rgba(234,179,8,0.1)' : '#fefce8', border: `1px solid ${isDark ? 'rgba(234,179,8,0.3)' : '#fde68a'}`, borderRadius: 8, fontSize: 12, color: isDark ? '#fcd34d' : '#92400e' }}>
            <strong>No history yet.</strong> Run <code>python sector_rs_snapshot.py --backfill</code> to populate 63 days of data.
          </div>
        )}
      </div>

      {/* Quadrant summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
        {['LEADING','WEAKENING','IMPROVING','LAGGING'].map(q => {
          const cfg    = Q_CFG[q];
          const active = qFilter === q;
          const descs  = {
            LEADING:   'RS Ratio > 100 · Momentum > 100',
            WEAKENING: 'RS Ratio > 100 · Momentum < 100',
            IMPROVING: 'RS Ratio < 100 · Momentum > 100',
            LAGGING:   'RS Ratio < 100 · Momentum < 100',
          };
          return (
            <div key={q} onClick={() => setQFilter(active ? 'ALL' : q)}
              style={{ padding: '13px 16px', borderRadius: 8, border: `1px solid ${active ? cfg.color : t.border}`, backgroundColor: active ? cfg.bg : t.panel, cursor: 'pointer', transition: 'all 0.15s' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{q}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: t.text, margin: '4px 0 2px' }}>{hasHistory ? qCounts[q] : '—'}</div>
              <div style={{ fontSize: 11, color: t.muted }}>{descs[q]}</div>
            </div>
          );
        })}
      </div>

      {/* Tab + search */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', backgroundColor: t.panel, borderRadius: 8, border: `1px solid ${t.border}`, padding: 3, gap: 2 }}>
          {Object.entries(tabConfig).map(([k, v]) => (
            <button key={k} onClick={() => { setTab(k); setSearch(''); setSortKey('quadrant'); setSortDir('asc'); setSelectedRows(new Set()); }}
              style={{ padding: '6px 14px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer', backgroundColor: tab === k ? '#2563eb' : 'transparent', color: tab === k ? '#fff' : t.muted, transition: 'all 0.2s' }}>
              {v.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {qFilter !== 'ALL' && (
            <button onClick={() => setQFilter('ALL')}
              style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${t.border}`, backgroundColor: t.panel, color: t.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Clear filter ×
            </button>
          )}
          <input type="text" placeholder={`Search ${tabConfig[tab].label}...`} value={search} onChange={e => setSearch(e.target.value)}
            style={{ padding: '7px 12px', borderRadius: 6, border: `1px solid ${t.border}`, backgroundColor: t.inputBg, color: t.text, fontSize: 12, width: 200, outline: 'none' }} />
        </div>
      </div>

      {/* Multi-select scan bar */}
      {onScanNavigate && selectedRows.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginBottom: 10, backgroundColor: isDark ? '#1e3a5f' : '#dbeafe', border: `1px solid ${isDark ? '#2563eb' : '#93c5fd'}`, borderRadius: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: isDark ? '#93c5fd' : '#1d4ed8' }}>
            {selectedRows.size} {tabConfig[tab].label}{selectedRows.size > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => {
              const names = Array.from(selectedRows);
              if (tab === 'micro') onScanNavigate(names, 'micro');
              else if (tab === 'industry') onScanNavigate(names, 'macro');
              else {
                // sector: expand to all their industries
                const allIndustries = [];
                displayed.filter(r => names.includes(r._name)).forEach(r => {
                  if (r.industries) r.industries.forEach(i => allIndustries.push(i.industry));
                });
                onScanNavigate(allIndustries.length ? allIndustries : names, 'macro');
              }
            }}
            style={{ padding: '6px 18px', borderRadius: 6, border: 'none', backgroundColor: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
            Scan Selected ({selectedRows.size})
          </button>
          <button onClick={() => setSelectedRows(new Set())}
            style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${isDark ? '#2563eb' : '#93c5fd'}`, backgroundColor: 'transparent', color: isDark ? '#93c5fd' : '#1d4ed8', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div style={{ backgroundColor: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {onScanNavigate && (
                <th style={{ padding: '10px 10px', backgroundColor: t.header, borderBottom: `2px solid ${t.border}`, width: 36 }}>
                  <input type="checkbox"
                    checked={displayed.length > 0 && displayed.every(r => selectedRows.has(r._name))}
                    onChange={e => {
                      if (e.target.checked) setSelectedRows(new Set(displayed.map(r => r._name)));
                      else setSelectedRows(new Set());
                    }}
                    style={{ cursor: 'pointer', width: 14, height: 14 }} />
                </th>
              )}
              <TH label="Group"         k="_name"          align="center" />
              <TH label="Stocks"        k="total_stocks"   align="center" />
              <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', backgroundColor: t.header, borderBottom: `2px solid ${t.border}`, whiteSpace: 'nowrap', textAlign: 'center' }}>RS Ratio ({DAYS}D)</th>
              <TH label="vs Nifty 500 (63D)"   k="vsNifty500"   align="center" />
              <TH label="Abs Return (63D)"      k="absReturn63d" align="center" />
              <TH label="RS Ratio"           k="rsRatioCurrent" align="center" />
              <TH label="RS Momentum (10D)" k="rsMomentum"     align="center" />
              <TH label="Quadrant"      k="quadrant"       align="center" />
              <TH label="% from High"   k="pctFromHigh"    align="center" />
              <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', backgroundColor: t.header, borderBottom: `2px solid ${t.border}`, textAlign: 'center', whiteSpace: 'nowrap' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {histLoading ? (
              <tr><td colSpan={onScanNavigate ? 11 : 10} style={{ padding: 40, textAlign: 'center', color: t.muted, fontWeight: 600 }}>Loading RS Ratio data...</td></tr>
            ) : displayed.length === 0 ? (
              <tr><td colSpan={onScanNavigate ? 11 : 10} style={{ padding: 40, textAlign: 'center', color: t.muted, fontWeight: 600 }}>No data matches the current filter.</td></tr>
            ) : displayed.map((row, idx) => {
              const m = row._metrics;
              const isLast = idx === displayed.length - 1;
              const isSelected = selectedRows.has(row._name);

              const rsRatioStr  = m ? m.rsRatioCurrent.toFixed(2) : '—';
              const rsRatioClr  = !m ? t.muted : m.rsRatioCurrent >= 100 ? '#16a34a' : '#dc2626';
              const pctStr      = m ? (m.pctFromHigh === 0 ? '—' : `${m.pctFromHigh.toFixed(1)}%`) : '—';
              const pctClr      = !m ? t.muted : m.pctFromHigh >= -2 ? t.text : '#dc2626';

              return (
                <tr key={idx} style={{ borderBottom: isLast ? 'none' : `1px solid ${t.border}`, transition: 'background-color 0.1s', backgroundColor: isSelected ? (isDark ? 'rgba(37,99,235,0.12)' : 'rgba(219,234,254,0.6)') : 'transparent' }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = t.hover; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}>

                  {onScanNavigate && (
                    <td style={{ padding: '11px 10px', textAlign: 'center', width: 36 }}>
                      <input type="checkbox" checked={isSelected}
                        onChange={() => {
                          setSelectedRows(prev => {
                            const next = new Set(prev);
                            if (next.has(row._name)) next.delete(row._name);
                            else next.add(row._name);
                            return next;
                          });
                        }}
                        style={{ cursor: 'pointer', width: 14, height: 14 }} />
                    </td>
                  )}

                  <td style={{ padding: '11px 14px', fontWeight: 700, fontSize: 13, maxWidth: 180, textAlign: 'center' }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row._name}>{row._name}</div>
                    {tab !== 'sector' && row.sector && <div style={{ fontSize: 10, color: t.muted, marginTop: 2 }}>{row.sector}</div>}
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'center', fontSize: 13, color: t.muted, fontWeight: 600 }}>{row.total_stocks}</td>

                  <td style={{ padding: '7px 14px', textAlign: 'center' }}>
                    {m ? <Sparkline rsRatioSeries={m.sparklineSeries} quadrant={m.quadrant} /> : <span style={{ color: t.muted, fontSize: 11 }}>No data</span>}
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                    {m != null ? (
                      <span style={{ fontSize: 13, fontWeight: 700, color: m.vsNifty500 >= 0 ? '#16a34a' : '#dc2626' }}>
                        {m.vsNifty500 >= 0 ? '+' : ''}{m.vsNifty500.toFixed(1)}%
                      </span>
                    ) : <span style={{ color: t.muted }}>—</span>}
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                    {m != null && m.absReturn63d != null ? (
                      <span style={{ fontSize: 13, fontWeight: 700, color: m.absReturn63d >= 0 ? '#16a34a' : '#dc2626' }}>
                        {m.absReturn63d >= 0 ? '+' : ''}{m.absReturn63d.toFixed(1)}%
                      </span>
                    ) : <span style={{ color: t.muted }}>—</span>}
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: rsRatioClr }}>{rsRatioStr}</span>
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
                    title="RS Momentum = 100 + ROC. Above 100 = accelerating. Below 100 = decelerating.">
                    {m ? (
                      <span style={{ fontSize: 13, fontWeight: 700, color: m.rsMomentum >= 100 ? '#16a34a' : '#dc2626' }}>
                        {m.rsMomentum.toFixed(2)}
                      </span>
                    ) : <span style={{ color: t.muted }}>—</span>}
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                    {m ? <QuadrantBadge q={m.quadrant} /> : <span style={{ color: t.muted, fontSize: 12 }}>—</span>}
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: pctClr }}>{pctStr}</span>
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                    {onScanNavigate && (
                      <button
                        onClick={() => {
                          if (tab === 'micro') onScanNavigate([row.basic_industry], 'micro');
                          else if (tab === 'industry') onScanNavigate([row.industry], 'macro');
                          else if (tab === 'sector' && row.industries) onScanNavigate(row.industries.map(i => i.industry), 'macro');
                        }}
                        style={{ padding: '4px 12px', borderRadius: 5, border: 'none', backgroundColor: '#2563eb', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                        Scan
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: t.muted, textAlign: 'right' }}>
        JdK RRG formula · RS Ratio = Z-score(SMA14) · RS Momentum = Z-score(ROC10, SMA14) · Updated daily after market close
      </div>
    </div>
  );
}

// Helper label row for formula panel
function Row({ label, val, labelColor }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: labelColor ?? '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2, flexShrink: 0, width: 60 }}>{label}</span>
      <div style={{ flex: 1 }}>{val}</div>
    </div>
  );
}
