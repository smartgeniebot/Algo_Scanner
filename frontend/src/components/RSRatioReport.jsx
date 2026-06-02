import React, { useEffect, useState, useMemo } from 'react';

const API = 'https://algo-scanner-lnck.onrender.com';
const DAYS = 63;
const ROC_PERIOD = 10;

// ── Dorsey Wright / RRG formulas ─────────────────────────────────────────────
//
// RS Ratio   = (last_raw_ratio / mean_raw_ratio_63d) × 100
//              > 100 = sector outperforming Nifty500 on average over the window
//              < 100 = underperforming
//
// RS Momentum = 100 + 10d_ROC_of_RS_Ratio
//              > 100 = RS Ratio is accelerating (gaining faster or losing slower)
//              < 100 = RS Ratio is decelerating
//
// Quadrant (original Dorsey Wright / RRG):
//   LEADING   : RS Ratio ≥ 100  AND  RS Momentum ≥ 100
//   WEAKENING : RS Ratio ≥ 100  AND  RS Momentum <  100
//   IMPROVING : RS Ratio <  100  AND  RS Momentum ≥ 100
//   LAGGING   : RS Ratio <  100  AND  RS Momentum <  100

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
  if (!series || series.length < ROC_PERIOD + 1) return null;

  const raw = series.map(d => d.rs_ratio);
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;

  // RS Ratio series (centered at 100)
  const rsRatioSeries = raw.map(v => (v / mean) * 100);
  const rsRatioCurrent = rsRatioSeries[rsRatioSeries.length - 1];

  // RS Momentum = 100 + 10d ROC of RS Ratio
  const cur  = rsRatioSeries[rsRatioSeries.length - 1];
  const past = rsRatioSeries[rsRatioSeries.length - 1 - ROC_PERIOD];
  const roc  = past ? ((cur - past) / past) * 100 : 0;
  const rsMomentum = 100 + roc;

  // Quadrant
  let quadrant;
  if      (rsRatioCurrent >= 100 && rsMomentum >= 100) quadrant = 'LEADING';
  else if (rsRatioCurrent >= 100 && rsMomentum <  100) quadrant = 'WEAKENING';
  else if (rsRatioCurrent <  100 && rsMomentum >= 100) quadrant = 'IMPROVING';
  else                                                  quadrant = 'LAGGING';

  // 10D Dir: slope of last 10 RS Ratio values as %/day
  const last10 = rsRatioSeries.slice(-ROC_PERIOD);
  const slope  = linRegSlope(last10);
  const meanL10 = last10.reduce((a, b) => a + b, 0) / last10.length || 1;
  const pctPerDay = Math.abs((slope / meanL10) * 100);

  // % from 63d high of RS Ratio series
  const highRS    = Math.max(...rsRatioSeries);
  const pctFromHigh = highRS > 0 ? ((rsRatioCurrent - highRS) / highRS) * 100 : 0;

  return {
    rsRatioCurrent,   // e.g. 96.13 or 110.09
    rsMomentum,       // e.g. 98.67 or 106.00
    roc,              // e.g. -1.33 or +2.15
    quadrant,
    slopeRising: slope > 0,
    pctPerDay,
    pctFromHigh,
    rsRatioSeries,    // full series for sparkline
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
    <span style={{ fontSize: 12, fontWeight: 700, color: slopeRising ? '#16a34a' : '#dc2626', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
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
  const [sortKey, setSortKey]           = useState('rsRatioCurrent');
  const [sortDir, setSortDir]           = useState('desc');
  const [qFilter, setQFilter]           = useState('ALL');
  const [search, setSearch]             = useState('');
  const [showInfo, setShowInfo]         = useState(false);

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
    return [...rows].sort((a, b) => {
      const get = r => {
        const m = r._metrics;
        if (sortKey === 'rsRatioCurrent') return m?.rsRatioCurrent ?? -Infinity;
        if (sortKey === 'rsMomentum')     return m?.rsMomentum ?? -Infinity;
        if (sortKey === 'roc')            return m?.roc ?? -Infinity;
        if (sortKey === 'pctFromHigh')    return m?.pctFromHigh ?? -Infinity;
        if (sortKey === 'quadrant')       return m?.quadrant ?? '';
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
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px' }}>Dorsey Wright RS Ratio Report</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: t.muted }}>
              Relative Rotation — sector RS Ratio vs RS Momentum · 63-day window vs Nifty500
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
                RS Ratio   = (sector_avg_close / Nifty500_close) / mean_of_same_63d  x  100<br />
                RS Momentum = 100 + ((RS_Ratio_today - RS_Ratio_10d_ago) / RS_Ratio_10d_ago x 100)<br />
                ROC         = RS_Ratio_today - RS_Ratio_10d_ago  /  RS_Ratio_10d_ago  x  100<br />
                % from High = (RS_Ratio_today - max_RS_Ratio_63d) / max_RS_Ratio_63d  x  100
              </code>
              <div style={{ marginTop: 10, padding: '8px 12px', backgroundColor: isDark ? 'rgba(22,163,74,0.1)' : '#f0fdf4', borderRadius: 6, border: `1px solid ${isDark ? 'rgba(22,163,74,0.3)' : '#bbf7d0'}`, fontSize: 12, color: isDark ? '#4ade80' : '#15803d', fontWeight: 600 }}>
                Look for: LEADING quadrant · RS Ratio above 100 · RS Momentum above 100 · ROC positive · % from High near 0%
              </div>
            </div>

            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 0 }}>
              {[
                {
                  col: 'RS RATIO (63D) — Sparkline',
                  color: '#3b82f6',
                  formula: 'RS Ratio series plotted over 63 trading days. Centerline = 100.',
                  means: 'Each point = (sector_avg_close / Nifty500_close) / 63d_mean × 100. Shows whether the sector has been above or below its average relative strength. Color = quadrant.',
                  lookfor: 'A line trending up and staying above 100 = sustained outperformance. Crossing above 100 from below = potential IMPROVING → LEADING rotation.',
                },
                {
                  col: 'RS RATIO (current value)',
                  color: '#8b5cf6',
                  formula: '(sector_avg_close_today / Nifty500_close_today) / mean_ratio_63d × 100',
                  means: 'Current position vs the 63-day mean. Above 100 = sector is outperforming Nifty500 on average over the window. Below 100 = underperforming. The further from 100, the stronger/weaker.',
                  lookfor: 'Above 100 = outperformer. The higher, the stronger. Below 100 = underperformer. Green = above 100, Red = below 100.',
                  example: '110.09 = 10% above its 63d mean relative strength → outperforming Nifty · 96.13 = 4% below → underperforming',
                },
                {
                  col: '10D DIR',
                  color: '#0ea5e9',
                  formula: 'Linear regression slope of the last 10 RS Ratio values, expressed as %/day',
                  means: 'Direction and speed of RS Ratio movement over the last 10 trading days. Independent of whether the sector is above or below 100 — purely about which way it is moving right now.',
                  lookfor: '▲ Rising = RS Ratio gaining ground vs Nifty right now. ▼ Falling = losing ground. Use alongside RS Momentum to confirm quadrant direction.',
                  example: '▲ Rising (0.34%/d) = RS Ratio growing 0.34% per day · ▼ Falling (0.17%/d) = shrinking 0.17% per day',
                },
                {
                  col: 'ROC OF RATIO',
                  color: '#f59e0b',
                  formula: '(RS_Ratio_today - RS_Ratio_10d_ago) / RS_Ratio_10d_ago × 100',
                  means: 'Total % change in RS Ratio over the last 10 trading days. This is the raw input to RS Momentum (RS Momentum = 100 + ROC). Positive = sector is gaining relative strength. Negative = losing it.',
                  lookfor: 'Positive ROC = money flowing into this sector vs Nifty. Negative = flowing out. ROC above +2% is a strong signal. Confirms the quadrant: LEADING needs both RS Ratio > 100 and ROC > 0.',
                  example: '+2.15% = RS Ratio is 2.15% higher than 10 days ago → accelerating outperformance · -1.33% = losing ground',
                },
                {
                  col: 'QUADRANT',
                  color: '#16a34a',
                  formula: 'RS Ratio vs 100 (benchmark line) + RS Momentum vs 100 (acceleration line)',
                  means: [
                    { q: 'LEADING',   desc: 'RS Ratio > 100 AND RS Momentum > 100. Sector is outperforming Nifty AND that outperformance is accelerating. This is the strongest quadrant — overweight.' },
                    { q: 'WEAKENING', desc: 'RS Ratio > 100 BUT RS Momentum < 100. Still outperforming but momentum is fading. The sector is losing steam. Consider reducing or watching for rotation out.' },
                    { q: 'IMPROVING', desc: 'RS Ratio < 100 BUT RS Momentum > 100. Still underperforming Nifty but recovering momentum. Early rotation signal — watch for crossover into LEADING.' },
                    { q: 'LAGGING',   desc: 'RS Ratio < 100 AND RS Momentum < 100. Underperforming and getting worse. Avoid. Rotation cycle: LAGGING → IMPROVING → LEADING → WEAKENING → LAGGING.' },
                  ],
                  lookfor: 'LEADING = overweight. IMPROVING = watch for entry. WEAKENING = reduce. LAGGING = avoid.',
                },
                {
                  col: '% FROM HIGH',
                  color: '#ef4444',
                  formula: '(RS_Ratio_today - max_RS_Ratio_in_63d) / max_RS_Ratio_in_63d × 100',
                  means: 'How far today\'s RS Ratio is from its 63-day peak. 0.0% (shown as —) means at its strongest right now. -14.6% means the RS Ratio has dropped 14.6% from its peak.',
                  lookfor: '— or near 0% = sector at peak relative strength right now, combine with LEADING for strongest signal. Large negatives on LEADING sectors = pulling back but still strong fundamentally.',
                  example: '— = at 63d RS high right now · -14.6% = RS Ratio has fallen 14.6% from its 63d peak (like Diversified)',
                },
              ].map((item, i) => (
                <div key={i} style={{ padding: '14px 0', borderBottom: i < 5 ? `1px solid ${t.border}` : 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 3, height: 16, backgroundColor: item.color, borderRadius: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 900, color: t.text, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{item.col}</span>
                  </div>
                  <Row label="Formula" val={<code style={{ fontSize: 11, color: isDark ? '#7dd3fc' : '#1e40af', lineHeight: 1.6 }}>{item.formula}</code>} />
                  <Row label="Means" val={
                    item.col === 'QUADRANT' ? (
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
            <button key={k} onClick={() => { setTab(k); setSearch(''); setSortKey('rsRatioCurrent'); setSortDir('desc'); }}
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

      {/* Table */}
      <div style={{ backgroundColor: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <TH label="Group"         k="_name" />
              <TH label="Stocks"        k="total_stocks" align="center" />
              <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', backgroundColor: t.header, borderBottom: `2px solid ${t.border}`, whiteSpace: 'nowrap' }}>RS Ratio ({DAYS}D)</th>
              <TH label="RS Ratio"      k="rsRatioCurrent" align="right" />
              <TH label="10D Dir"       k="roc" align="left" />
              <TH label="ROC of Ratio"  k="roc" align="right" />
              <TH label="Quadrant"      k="quadrant" />
              <TH label="% from High"   k="pctFromHigh" align="right" />
              <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', backgroundColor: t.header, borderBottom: `2px solid ${t.border}`, textAlign: 'center', whiteSpace: 'nowrap' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {histLoading ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: t.muted, fontWeight: 600 }}>Loading RS Ratio data...</td></tr>
            ) : displayed.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: t.muted, fontWeight: 600 }}>No data matches the current filter.</td></tr>
            ) : displayed.map((row, idx) => {
              const m = row._metrics;
              const isLast = idx === displayed.length - 1;

              const rsRatioStr  = m ? m.rsRatioCurrent.toFixed(2) : '—';
              const rsRatioClr  = !m ? t.muted : m.rsRatioCurrent >= 100 ? '#16a34a' : '#dc2626';
              const rocStr      = m ? `${m.roc >= 0 ? '+' : ''}${m.roc.toFixed(2)}%` : '—';
              const rocClr      = !m ? t.muted : m.roc >= 0 ? '#16a34a' : '#dc2626';
              const pctStr      = m ? (m.pctFromHigh === 0 ? '—' : `${m.pctFromHigh.toFixed(1)}%`) : '—';
              const pctClr      = !m ? t.muted : m.pctFromHigh >= -2 ? t.text : '#dc2626';

              return (
                <tr key={idx} style={{ borderBottom: isLast ? 'none' : `1px solid ${t.border}`, transition: 'background-color 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = t.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>

                  <td style={{ padding: '11px 14px', fontWeight: 700, fontSize: 13, maxWidth: 180 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row._name}>{row._name}</div>
                    {tab !== 'sector' && row.sector && <div style={{ fontSize: 10, color: t.muted, marginTop: 2 }}>{row.sector}</div>}
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'center', fontSize: 13, color: t.muted, fontWeight: 600 }}>{row.total_stocks}</td>

                  <td style={{ padding: '7px 14px' }}>
                    {m ? <Sparkline rsRatioSeries={m.rsRatioSeries} quadrant={m.quadrant} /> : <span style={{ color: t.muted, fontSize: 11 }}>No data</span>}
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: rsRatioClr }}>{rsRatioStr}</span>
                  </td>

                  <td style={{ padding: '11px 14px' }}>
                    {m ? <DirCell slopeRising={m.slopeRising} pctPerDay={m.pctPerDay} /> : <span style={{ color: t.muted, fontSize: 12 }}>—</span>}
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: rocClr }}>{rocStr}</span>
                  </td>

                  <td style={{ padding: '11px 14px' }}>
                    {m ? <QuadrantBadge q={m.quadrant} /> : <span style={{ color: t.muted, fontSize: 12 }}>—</span>}
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: pctClr }}>{pctStr}</span>
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                    {onScanNavigate && tab !== 'micro' && (
                      <button
                        onClick={() => {
                          if (tab === 'industry') onScanNavigate([row.industry], 'macro');
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
        RS Ratio centered at 100 (mean of 63d window) · RS Momentum = 100 + 10d ROC · Updated daily after market close
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
