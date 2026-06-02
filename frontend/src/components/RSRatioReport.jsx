import React, { useEffect, useState, useMemo } from 'react';

const API = 'https://algo-scanner-lnck.onrender.com';
const DAYS = 63;
const ROC_PERIOD = 10;

// Normalize a raw series so day-0 = 1.0
// This converts the raw price-ratio (e.g. 0.12) into a relative performance index
// where 1.0 = same as day 1, 1.05 = 5% stronger than Nifty since day 1, 0.95 = 5% weaker
function normalize(series) {
  if (!series || series.length === 0) return [];
  const base = series[0].rs_ratio;
  if (!base) return series.map(d => ({ ...d, norm: 1 }));
  return series.map(d => ({ ...d, norm: d.rs_ratio / base }));
}

// Linear regression slope over last N values
function linRegSlope(vals) {
  const n = vals.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = vals.reduce((a, b) => a + b, 0) / n;
  const num = vals.reduce((s, v, i) => s + (i - mx) * (v - my), 0);
  const den = vals.reduce((s, _, i) => s + (i - mx) ** 2, 0) || 1;
  return num / den;
}

// Trend from NORMALIZED series
// HIGH    : last norm value in top 10% of its 63d range
// LOW     : last norm value in bottom 10% of its 63d range
// RISING  : 10d slope positive (and not in bottom 10%)
// FALLING : 10d slope negative (and not in top 10%)
function classifyTrend(normed) {
  if (!normed || normed.length < 2) return 'LOW';
  const vals = normed.map(d => d.norm);
  const min  = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 0.0001;
  const last  = vals[vals.length - 1];
  const pos   = (last - min) / range;

  const slope = linRegSlope(vals.slice(-ROC_PERIOD));

  if (pos >= 0.90) return 'HIGH';
  if (pos <= 0.10) return 'LOW';
  return slope > 0 ? 'RISING' : 'FALLING';
}

// ROC on normalized series: (norm_today - norm_10d_ago) / norm_10d_ago * 100
function calcROC(normed) {
  if (!normed || normed.length < ROC_PERIOD + 1) return null;
  const vals = normed.map(d => d.norm);
  const cur  = vals[vals.length - 1];
  const past = vals[vals.length - 1 - ROC_PERIOD] ?? vals[0];
  return past ? ((cur - past) / past) * 100 : null;
}

// 10D direction: slope expressed as % of ratio per day
function calc10DDir(normed) {
  if (!normed || normed.length < 2) return null;
  const vals  = normed.slice(-ROC_PERIOD).map(d => d.norm);
  const slope = linRegSlope(vals);  // change in norm per day
  const mean  = vals.reduce((a, b) => a + b, 0) / vals.length || 1;
  const pctPerDay = (slope / mean) * 100;  // convert to % per day
  return { rising: slope > 0, pctPerDay: Math.abs(pctPerDay) };
}

// % from 63-day high on normalized series
function calcPctFromHigh(normed) {
  if (!normed || normed.length === 0) return 0;
  const vals = normed.map(d => d.norm);
  const high = Math.max(...vals);
  const last = vals[vals.length - 1];
  return high > 0 ? ((last - high) / high) * 100 : 0;
}

// ── Sparkline (uses normalized values) ───────────────────────────────────────
function Sparkline({ normed, trend }) {
  if (!normed || normed.length < 2) {
    return <div style={{ width: 120, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#94a3b8' }}>No data</div>;
  }
  const vals = normed.map(d => d.norm);
  const min  = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 0.0001;
  const W = 120, H = 40, pad = 3;

  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const lastX  = pad + (W - pad * 2);
  const lastY  = pad + (1 - (vals[vals.length - 1] - min) / range) * (H - pad * 2);
  const fillPts = `${pad},${H - pad} ${pts} ${lastX},${H - pad}`;

  const color = trend === 'HIGH'    ? '#16a34a'
              : trend === 'RISING'  ? '#3b82f6'
              : trend === 'FALLING' ? '#ef4444'
              : '#a855f7';

  const fillColor = trend === 'HIGH'    ? 'rgba(22,163,74,0.15)'
                  : trend === 'RISING'  ? 'rgba(59,130,246,0.12)'
                  : trend === 'FALLING' ? 'rgba(239,68,68,0.12)'
                  : 'rgba(168,85,247,0.12)';

  return (
    <svg width={W} height={H} style={{ overflow: 'visible', display: 'block' }}>
      <polygon points={fillPts} fill={fillColor} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

// ── Trend badge ───────────────────────────────────────────────────────────────
const TREND_CFG = {
  HIGH:    { color: '#16a34a', bg: 'rgba(22,163,74,0.15)',   border: 'rgba(22,163,74,0.4)'   },
  RISING:  { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.35)' },
  FALLING: { color: '#dc2626', bg: 'rgba(220,38,38,0.13)',   border: 'rgba(220,38,38,0.4)'   },
  LOW:     { color: '#a855f7', bg: 'rgba(168,85,247,0.13)',  border: 'rgba(168,85,247,0.4)'  },
};

function TrendBadge({ trend }) {
  const cfg = TREND_CFG[trend] ?? TREND_CFG.LOW;
  return (
    <span style={{ padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 800, letterSpacing: '0.3px', color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}`, whiteSpace: 'nowrap' }}>
      {trend}
    </span>
  );
}

// ── 10D Dir cell ──────────────────────────────────────────────────────────────
function DirCell({ normed }) {
  const dir = calc10DDir(normed);
  if (!dir) return <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>;
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: dir.rising ? '#16a34a' : '#dc2626', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      {dir.rising ? '▲' : '▼'} {dir.rising ? 'Rising' : 'Falling'}
      <span style={{ fontWeight: 500, opacity: 0.75 }}>({dir.pctPerDay.toFixed(2)}%/d)</span>
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RSRatioReport({ theme, onScanNavigate }) {
  const isDark = theme === 'dark';

  const [tab, setTab]               = useState('sector');
  const [sectorMeta, setSectorMeta] = useState([]);
  const [industryMeta, setIndustryMeta] = useState([]);
  const [microMeta, setMicroMeta]   = useState([]);
  const [history, setHistory]       = useState({});
  const [histLoading, setHistLoading] = useState(true);
  const [hasHistory, setHasHistory] = useState(false);
  const [sortKey, setSortKey]       = useState('roc');
  const [sortDir, setSortDir]       = useState('desc');
  const [trendFilter, setTrendFilter] = useState('ALL');
  const [search, setSearch]         = useState('');
  const [showInfo, setShowInfo]     = useState(false);

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
    sector:   { label: 'Sector',         groupType: 'sector',         key: 'sector',         meta: sectorMeta },
    industry: { label: 'Macro Industry', groupType: 'industry',       key: 'industry',       meta: industryMeta },
    micro:    { label: 'Basic Industry', groupType: 'basic_industry',  key: 'basic_industry', meta: microMeta },
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
          Object.values(data).some(arr => arr.length >= 2);
        setHasHistory(hasData);
        setHistory(data || {});
        setHistLoading(false);
      })
      .catch(() => setHistLoading(false));
  }, [tab]);

  const enriched = useMemo(() => {
    const { key: groupKey, meta } = tabConfig[tab];
    return meta.map(row => {
      const name   = row[groupKey] || '';
      const raw    = history[name] || null;
      const normed = raw ? normalize(raw) : null;
      const hasSeries = normed && normed.length >= 2;

      const trend       = hasSeries ? classifyTrend(normed) : null;
      const roc         = hasSeries ? calcROC(normed) : null;
      const pctFromHigh = hasSeries ? calcPctFromHigh(normed) : null;
      // Display ratio: normalized value (1.0 = neutral, >1 = outperforming since day 1)
      const currentNorm = hasSeries ? normed[normed.length - 1].norm : null;
      // Raw ratio on last day (for reference tooltip)
      const currentRaw  = raw ? raw[raw.length - 1].rs_ratio : null;

      return { ...row, _name: name, _normed: normed, _groupKey: groupKey, trend, roc, pctFromHigh, currentNorm, currentRaw };
    });
  }, [tab, sectorMeta, industryMeta, microMeta, history]);

  const displayed = useMemo(() => {
    let rows = enriched;
    if (trendFilter !== 'ALL') rows = rows.filter(r => r.trend === trendFilter);
    if (search) {
      const lo = search.toLowerCase();
      rows = rows.filter(r => r._name.toLowerCase().includes(lo));
    }
    const getValue = (r, key) => {
      if (key === 'currentNorm') return r.currentNorm ?? -Infinity;
      if (key === 'roc')         return r.roc ?? -Infinity;
      if (key === 'pctFromHigh') return r.pctFromHigh ?? -Infinity;
      if (key === 'trend')       return r.trend ?? '';
      if (key === '_name')       return r._name ?? '';
      if (key === 'total_stocks') return r.total_stocks ?? 0;
      return -Infinity;
    };
    return [...rows].sort((a, b) => {
      const av = getValue(a, sortKey), bv = getValue(b, sortKey);
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [enriched, trendFilter, search, sortKey, sortDir]);

  const trendCounts = useMemo(() => {
    const c = { HIGH: 0, RISING: 0, FALLING: 0, LOW: 0 };
    enriched.forEach(r => { if (r.trend && c[r.trend] !== undefined) c[r.trend]++; });
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
              63-day sector RS ratio vs Nifty500 · Trend, 10D direction, ROC &amp; sparkline
            </p>
          </div>
          <button onClick={() => setShowInfo(v => !v)}
            style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${t.border}`, backgroundColor: t.panel, color: t.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
            {showInfo ? 'Hide formula ▲' : 'Formula & what to look for ▼'}
          </button>
        </div>

        {showInfo && (
          <div style={{ marginTop: 14, backgroundColor: t.panel, border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden' }}>

            {/* Title bar */}
            <div style={{ padding: '12px 18px', borderBottom: `1px solid ${t.border}`, backgroundColor: isDark ? '#0f172a' : '#f8fafc' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: t.text }}>Formula & What to Look For</div>
            </div>

            {/* Formula block */}
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, backgroundColor: isDark ? 'rgba(30,41,59,0.4)' : '#f8fafc' }}>
              <code style={{ display: 'block', fontSize: 12, lineHeight: 2, color: isDark ? '#7dd3fc' : '#1e40af', fontFamily: 'monospace' }}>
                Raw Ratio&nbsp;&nbsp;= sector_avg_close ÷ Nifty500_close &nbsp;(computed daily, stored in DB)<br />
                Norm Ratio = raw_ratio ÷ raw_ratio[day_1] &nbsp;→ &nbsp;starts at 1.0, drifts up or down<br />
                ROC&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= (norm_today − norm_10d_ago) ÷ norm_10d_ago × 100<br />
                10D Dir&nbsp;&nbsp;&nbsp;&nbsp;= linear regression slope of last 10 norm values, as %/day<br />
                % from High = (norm_today − max_norm_63d) ÷ max_norm_63d × 100
              </code>
              <div style={{ marginTop: 10, padding: '8px 12px', backgroundColor: isDark ? 'rgba(22,163,74,0.1)' : '#f0fdf4', borderRadius: 6, border: `1px solid ${isDark ? 'rgba(22,163,74,0.3)' : '#bbf7d0'}`, fontSize: 12, color: isDark ? '#4ade80' : '#15803d', fontWeight: 600 }}>
                Look for: Trend = RISING or HIGH &nbsp;·&nbsp; ROC positive &nbsp;·&nbsp; 10D Dir rising &nbsp;·&nbsp; % from High near 0%
              </div>
            </div>

            {/* Column-by-column explanation */}
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 0 }}>

              {[
                {
                  col: 'RS RATIO (63D) — Sparkline',
                  color: '#3b82f6',
                  formula: 'norm_ratio = (avg_sector_close ÷ Nifty500_close) ÷ same_ratio_on_day_1',
                  what: 'A 63-day line chart of how the sector has performed relative to Nifty500. The line starts at 1.0 on day 1 (63 trading days ago). If it rises above 1.0, the sector is outperforming Nifty. If it falls below, it is underperforming.',
                  lookfor: 'A line that is steadily rising and near its recent highs = money flowing into this sector consistently.',
                  colors: 'Green fill = HIGH trend · Blue = RISING · Red = FALLING · Purple = LOW',
                },
                {
                  col: 'RATIO',
                  color: '#8b5cf6',
                  formula: 'norm_ratio on the most recent trading day',
                  what: 'The current normalized ratio value. 1.0 means the sector has performed exactly in line with Nifty500 over the 63-day window. Above 1.0 means the sector is stronger than Nifty500 since the window started. Below 1.0 means it has underperformed.',
                  lookfor: 'Values above 1.0 are outperformers. The higher the number, the stronger the sector has been vs Nifty over the past 63 days. Green = above 1.0 · Red = below 1.0.',
                  example: '1.0523 → sector is 5.23% stronger than Nifty500 since day 1 of the window · 0.9015 → 9.85% weaker',
                },
                {
                  col: '10D DIR',
                  color: '#0ea5e9',
                  formula: 'Linear regression slope of the last 10 normalized ratio values, converted to %/day',
                  what: 'Shows the direction and speed of the relative strength trend over the last 10 trading days (2 calendar weeks). It tells you whether the sector is currently gaining or losing ground vs Nifty, and how fast.',
                  lookfor: '▲ Rising = sector is gaining momentum vs Nifty right now. ▼ Falling = sector is losing momentum. The %/d number shows the speed — 0.34%/d is a strong move, 0.02%/d is a slow drift.',
                  example: '▲ Rising (0.34%/d) → gaining 0.34% per day vs Nifty · ▼ Falling (0.17%/d) → losing 0.17% per day vs Nifty',
                },
                {
                  col: 'ROC OF RATIO',
                  color: '#f59e0b',
                  formula: '(norm_ratio_today − norm_ratio_10d_ago) ÷ norm_ratio_10d_ago × 100',
                  what: 'Rate of Change — the total percentage move in relative strength over the last 10 trading days. While 10D Dir shows the daily slope, ROC gives you the total accumulated change over the period. A sector can have a small daily slope but a large ROC if the move started 10 days ago.',
                  lookfor: 'Positive ROC = the sector has strengthened vs Nifty over last 10 days. Negative = weakened. ROC above +2% is strong inflow. ROC below -2% is meaningful outflow. Consistency between ROC and 10D Dir confirms a real trend.',
                  example: '+2.65% → ratio is 2.65% higher than it was 10 trading days ago · -3.73% → ratio lost 3.73%',
                },
                {
                  col: 'TREND',
                  color: '#16a34a',
                  formula: 'Position of current norm ratio within its 63-day min-max range + 10-day slope direction',
                  what: [
                    { badge: 'HIGH', cfg: TREND_CFG.HIGH, desc: 'Ratio is in the top 10% of its 63-day range. The sector has been outperforming Nifty recently and is near its strongest point in the window. This is sustained leadership.' },
                    { badge: 'RISING', cfg: TREND_CFG.RISING, desc: 'Ratio is in the upper half of its 63-day range AND the 10-day slope is positive. The sector is outperforming and momentum is building. Best time to rotate in.' },
                    { badge: 'FALLING', cfg: TREND_CFG.FALLING, desc: 'The 10-day slope is negative — the sector is losing ground vs Nifty. Even if the ratio is still above 1.0, the direction is down. Momentum is fading — consider rotating out.' },
                    { badge: 'LOW', cfg: TREND_CFG.LOW, desc: 'Ratio is in the bottom 10% of its 63-day range. The sector is at its weakest relative to Nifty. Avoid unless you see an early RISING reversal forming.' },
                  ],
                  lookfor: 'RISING and HIGH are actionable. FALLING is a warning. LOW is avoid.',
                },
                {
                  col: '% FROM HIGH',
                  color: '#ef4444',
                  formula: '(norm_ratio_today − max_norm_ratio_in_63d) ÷ max_norm_ratio_in_63d × 100',
                  what: 'How far the sector\'s relative strength is from its 63-day peak. 0.0% means the sector is at its strongest right now. -9.7% means it has pulled back 9.7% from its peak relative strength.',
                  lookfor: '0.0% = sector is at peak RS → strongest outperformer right now, shown as — (no pullback). Small negatives like -1% to -3% = healthy pullback from strength, still strong. Large negatives like -10% or worse = significant loss of relative strength, confirm with Trend before acting.',
                  example: '— (0.0%) → at 63d high right now · -9.7% → has fallen 9.7% from its 63d peak RS',
                },
              ].map((item, i) => (
                <div key={i} style={{ padding: '14px 0', borderBottom: i < 5 ? `1px solid ${t.border}` : 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>

                  {/* Column name */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 3, height: 16, backgroundColor: item.color, borderRadius: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 900, color: t.text, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{item.col}</span>
                  </div>

                  {/* Formula */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2, flexShrink: 0, width: 60 }}>Formula</span>
                    <code style={{ fontSize: 11, color: isDark ? '#7dd3fc' : '#1e40af', lineHeight: 1.6 }}>{item.formula}</code>
                  </div>

                  {/* What it means */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2, flexShrink: 0, width: 60 }}>Means</span>
                    {item.col === 'TREND' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {item.what.map(({ badge, cfg, desc }) => (
                          <div key={badge} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}`, flexShrink: 0, marginTop: 1 }}>{badge}</span>
                            <span style={{ fontSize: 12, color: t.muted, lineHeight: 1.6 }}>{desc}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: t.muted, lineHeight: 1.6 }}>{item.what}</span>
                    )}
                  </div>

                  {/* Example */}
                  {item.example && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2, flexShrink: 0, width: 60 }}>Example</span>
                      <span style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#475569', lineHeight: 1.6, fontStyle: 'italic' }}>{item.example}</span>
                    </div>
                  )}

                  {/* Look for */}
                  {item.lookfor && typeof item.lookfor === 'string' && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2, flexShrink: 0, width: 60 }}>Look for</span>
                      <span style={{ fontSize: 12, color: isDark ? '#4ade80' : '#15803d', lineHeight: 1.6, fontWeight: 500 }}>{item.lookfor}</span>
                    </div>
                  )}
                  {item.colors && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2, flexShrink: 0, width: 60 }}>Colors</span>
                      <span style={{ fontSize: 11, color: t.muted, lineHeight: 1.6 }}>{item.colors}</span>
                    </div>
                  )}

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

      {/* Trend summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
        {['HIGH','RISING','FALLING','LOW'].map(tr => {
          const cfg    = TREND_CFG[tr];
          const active = trendFilter === tr;
          const descs  = { HIGH: 'Near 63d high · Strong outperformer', RISING: 'Gaining vs Nifty', FALLING: 'Losing vs Nifty', LOW: 'Near 63d low · Weak' };
          return (
            <div key={tr} onClick={() => setTrendFilter(active ? 'ALL' : tr)}
              style={{ padding: '13px 16px', borderRadius: 8, border: `1px solid ${active ? cfg.color : t.border}`, backgroundColor: active ? cfg.bg : t.panel, cursor: 'pointer', transition: 'all 0.15s' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{tr}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: t.text, margin: '4px 0 2px' }}>{hasHistory ? trendCounts[tr] : '—'}</div>
              <div style={{ fontSize: 11, color: t.muted }}>{descs[tr]}</div>
            </div>
          );
        })}
      </div>

      {/* Tab + search */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', backgroundColor: t.panel, borderRadius: 8, border: `1px solid ${t.border}`, padding: 3, gap: 2 }}>
          {Object.entries(tabConfig).map(([k, v]) => (
            <button key={k} onClick={() => { setTab(k); setSearch(''); setSortKey('roc'); setSortDir('desc'); }}
              style={{ padding: '6px 14px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer', backgroundColor: tab === k ? '#2563eb' : 'transparent', color: tab === k ? '#fff' : t.muted, transition: 'all 0.2s' }}>
              {v.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {trendFilter !== 'ALL' && (
            <button onClick={() => setTrendFilter('ALL')}
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
              <TH label="Group"          k="_name" />
              <TH label="Stocks"         k="total_stocks" align="center" />
              <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', backgroundColor: t.header, borderBottom: `2px solid ${t.border}`, whiteSpace: 'nowrap' }}>
                RS Ratio ({DAYS}D)
              </th>
              <TH label="Ratio"          k="currentNorm"  align="right" />
              <TH label="10D Dir"        k="roc"          align="left" />
              <TH label="ROC of Ratio"   k="roc"          align="right" />
              <TH label="Trend"          k="trend" />
              <TH label="% from High"    k="pctFromHigh"  align="right" />
              <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', backgroundColor: t.header, borderBottom: `2px solid ${t.border}`, textAlign: 'center', whiteSpace: 'nowrap' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {histLoading ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: t.muted, fontWeight: 600 }}>Loading RS Ratio data...</td></tr>
            ) : displayed.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: t.muted, fontWeight: 600 }}>No data matches the current filter.</td></tr>
            ) : displayed.map((row, idx) => {
              const isLast = idx === displayed.length - 1;
              const roc    = row.roc;
              const rocStr = roc != null ? `${roc >= 0 ? '+' : ''}${roc.toFixed(2)}%` : '—';
              const rocClr = roc == null ? t.muted : roc >= 0 ? '#16a34a' : '#dc2626';
              const pct    = row.pctFromHigh;
              const pctStr = pct != null ? `${pct.toFixed(1)}%` : '—';
              const pctClr = pct == null ? t.muted : pct >= -2 ? t.text : '#dc2626';
              // Ratio display: normalize relative to 1.0 → show as e.g. 1.0523
              const normStr = row.currentNorm != null ? row.currentNorm.toFixed(4) : '—';
              const normClr = row.currentNorm == null ? t.muted : row.currentNorm >= 1 ? '#16a34a' : '#dc2626';

              return (
                <tr key={idx} style={{ borderBottom: isLast ? 'none' : `1px solid ${t.border}`, transition: 'background-color 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = t.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>

                  <td style={{ padding: '11px 14px', fontWeight: 700, fontSize: 13, maxWidth: 180 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row._name}>{row._name}</div>
                    {tab !== 'sector' && row.sector && (
                      <div style={{ fontSize: 10, color: t.muted, marginTop: 2 }}>{row.sector}</div>
                    )}
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'center', fontSize: 13, color: t.muted, fontWeight: 600 }}>{row.total_stocks}</td>

                  <td style={{ padding: '7px 14px' }}>
                    <Sparkline normed={row._normed} trend={row.trend} />
                  </td>

                  {/* Ratio: normalized value. >1 = outperforming Nifty since day 1 of window */}
                  <td style={{ padding: '11px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                    title={row.currentRaw != null ? `Raw: ${row.currentRaw.toFixed(6)}` : ''}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: normClr }}>{normStr}</span>
                  </td>

                  <td style={{ padding: '11px 14px' }}>
                    {row._normed ? <DirCell normed={row._normed} /> : <span style={{ color: t.muted, fontSize: 12 }}>—</span>}
                  </td>

                  <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: rocClr }}>{rocStr}</span>
                  </td>

                  <td style={{ padding: '11px 14px' }}>
                    {row.trend ? <TrendBadge trend={row.trend} /> : <span style={{ color: t.muted, fontSize: 12 }}>—</span>}
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
        Ratio normalized to 1.0 on day 1 of the 63-day window · Updated daily after market close · Hover Ratio column for raw value
      </div>
    </div>
  );
}
