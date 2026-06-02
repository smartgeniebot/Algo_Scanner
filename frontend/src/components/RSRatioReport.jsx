import React, { useEffect, useState, useMemo } from 'react';

const API = 'https://algo-scanner-lnck.onrender.com';
const DAYS = 63;
const ROC_PERIOD = 10; // days used for ROC and direction

// ── Trend classification ─────────────────────────────────────────────────────
// HIGH   : ratio in top 10% of its 63-day range
// RISING : slope positive (10d linear regression) AND in top half of range
// FALLING: slope negative
// LOW    : ratio in bottom 10% of its 63-day range
function classifyTrend(series) {
  if (!series || series.length < 2) return 'LOW';
  const ratios = series.map(d => d.rs_ratio);
  const min = Math.min(...ratios), max = Math.max(...ratios);
  const range = max - min || 1;
  const last  = ratios[ratios.length - 1];
  const pos   = (last - min) / range;          // 0..1 position in range

  // 10-day linear regression slope
  const window = ratios.slice(-ROC_PERIOD);
  const n = window.length, mx = (n - 1) / 2;
  const my = window.reduce((a, b) => a + b, 0) / n;
  const slope = window.reduce((s, v, i) => s + (i - mx) * (v - my), 0) /
                (window.reduce((s, _, i) => s + (i - mx) ** 2, 0) || 1);

  if (pos >= 0.90) return 'HIGH';
  if (pos <= 0.10) return 'LOW';
  return slope > 0 ? 'RISING' : 'FALLING';
}

// ROC = (ratio_today − ratio_10d_ago) / ratio_10d_ago × 100
function calcROC(series) {
  if (!series || series.length < ROC_PERIOD + 1) return null;
  const ratios = series.map(d => d.rs_ratio);
  const cur  = ratios[ratios.length - 1];
  const past = ratios[ratios.length - 1 - ROC_PERIOD] ?? ratios[0];
  return past ? ((cur - past) / past) * 100 : null;
}

// 10-day direction: slope sign + magnitude per day
function calc10DDir(series) {
  if (!series || series.length < 2) return null;
  const window = series.slice(-ROC_PERIOD).map(d => d.rs_ratio);
  const n = window.length, mx = (n - 1) / 2;
  const my = window.reduce((a, b) => a + b, 0) / n;
  const slope = window.reduce((s, v, i) => s + (i - mx) * (v - my), 0) /
                (window.reduce((s, _, i) => s + (i - mx) ** 2, 0) || 1);
  return slope; // units: ratio-units per day (tiny but directionally correct)
}

// % from 63-day high
function calcPctFromHigh(series) {
  if (!series || series.length === 0) return 0;
  const ratios = series.map(d => d.rs_ratio);
  const high = Math.max(...ratios);
  const last = ratios[ratios.length - 1];
  return high > 0 ? ((last - high) / high) * 100 : 0;
}

// ── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ series, trend }) {
  if (!series || series.length < 2) {
    return <div style={{ width: 120, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#94a3b8' }}>No data</div>;
  }
  const vals = series.map(d => d.rs_ratio);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 0.0001;
  const W = 120, H = 40, pad = 3;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // fill area under line
  const firstX = pad, lastX = pad + (W - pad * 2);
  const firstY = pad + (1 - (vals[0] - min) / range) * (H - pad * 2);
  const lastY  = pad + (1 - (vals[vals.length - 1] - min) / range) * (H - pad * 2);
  const fillPts = `${firstX},${H - pad} ${pts} ${lastX},${H - pad}`;

  const color = trend === 'HIGH'    ? '#16a34a'
              : trend === 'RISING'  ? '#3b82f6'
              : trend === 'FALLING' ? '#ef4444'
              : '#a855f7';  // LOW → purple

  const fillColor = trend === 'HIGH'    ? 'rgba(22,163,74,0.15)'
                  : trend === 'RISING'  ? 'rgba(59,130,246,0.12)'
                  : trend === 'FALLING' ? 'rgba(239,68,68,0.12)'
                  : 'rgba(168,85,247,0.12)';

  return (
    <svg width={W} height={H} style={{ overflow: 'visible', display: 'block' }}>
      <polygon points={fillPts} fill={fillColor} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {/* endpoint dot */}
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

// ── Trend badge (matches the screenshot: HIGH / RISING / FALLING / LOW) ──────
const TREND_CFG = {
  HIGH:    { color: '#16a34a', bg: 'rgba(22,163,74,0.15)',   border: 'rgba(22,163,74,0.4)'   },
  RISING:  { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.35)' },
  FALLING: { color: '#dc2626', bg: 'rgba(220,38,38,0.13)',   border: 'rgba(220,38,38,0.4)'   },
  LOW:     { color: '#a855f7', bg: 'rgba(168,85,247,0.13)',  border: 'rgba(168,85,247,0.4)'  },
};

function TrendBadge({ trend }) {
  const cfg = TREND_CFG[trend] ?? TREND_CFG.LOW;
  return (
    <span style={{ padding: '3px 10px', borderRadius: '5px', fontSize: 11, fontWeight: 800, letterSpacing: '0.3px', color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}`, whiteSpace: 'nowrap' }}>
      {trend}
    </span>
  );
}

// ── 10D Direction cell ────────────────────────────────────────────────────────
function DirCell({ series }) {
  const slope = calc10DDir(series);
  if (slope === null) return <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>;
  const rising = slope > 0;
  const pctPerDay = Math.abs(slope * 100).toFixed(2); // convert ratio to %
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: rising ? '#16a34a' : '#dc2626', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      {rising ? '▲' : '▼'} {rising ? 'Rising' : 'Falling'} <span style={{ fontWeight: 500, opacity: 0.75 }}>({pctPerDay}%/d)</span>
    </span>
  );
}

// ── Fallback static enrichment (when no history yet) ─────────────────────────
// Used only until the snapshot job has run at least ROC_PERIOD+1 times.
function staticEnrich(rows) {
  return rows.map(r => ({
    ...r,
    _series:       null,
    trend:         null,
    roc:           null,
    dir:           null,
    pctFromHigh:   null,
    currentRatio:  null,
  }));
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RSRatioReport({ theme, onScanNavigate }) {
  const isDark = theme === 'dark';

  const [tab, setTab]           = useState('sector');
  // Static heatmap data (for stock counts, scan button)
  const [sectorMeta, setSectorMeta]   = useState([]);
  const [industryMeta, setIndustryMeta] = useState([]);
  const [microMeta, setMicroMeta]     = useState([]);
  // Historical RS series keyed by group name
  const [history, setHistory]   = useState({});    // { groupName: [{trade_date, rs_ratio}] }
  const [histLoading, setHistLoading] = useState(true);
  const [hasHistory, setHasHistory]   = useState(false);

  const [sortKey, setSortKey]   = useState('currentRatio');
  const [sortDir, setSortDir]   = useState('desc');
  const [trendFilter, setTrendFilter] = useState('ALL');
  const [search, setSearch]     = useState('');
  const [showInfo, setShowInfo] = useState(false);

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
    sector:   { label: 'Sector',         key: 'sector',         groupType: 'sector',         meta: sectorMeta },
    industry: { label: 'Macro Industry', key: 'industry',       groupType: 'industry',       meta: industryMeta },
    micro:    { label: 'Basic Industry', key: 'basic_industry',  groupType: 'basic_industry', meta: microMeta },
  };

  // Load static meta (stock counts etc) once
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

  // Load historical RS data for current tab
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
      .catch(() => { setHistLoading(false); });
  }, [tab]);

  // Build enriched row list
  const enriched = useMemo(() => {
    const { key: groupKey, meta } = tabConfig[tab];
    return meta.map(row => {
      const name   = row[groupKey] || row.sector || row.industry || row.basic_industry || '';
      const series = history[name] || null;
      const hasSeries = series && series.length >= 2;

      const trend        = hasSeries ? classifyTrend(series) : null;
      const roc          = hasSeries ? calcROC(series) : null;
      const pctFromHigh  = hasSeries ? calcPctFromHigh(series) : null;
      const currentRatio = hasSeries ? series[series.length - 1].rs_ratio : null;

      return {
        ...row,
        _name:        name,
        _series:      series,
        trend,
        roc,
        pctFromHigh,
        currentRatio,
        _groupKey:    groupKey,
      };
    });
  }, [tab, sectorMeta, industryMeta, microMeta, history]);

  const displayed = useMemo(() => {
    let rows = enriched;
    if (trendFilter !== 'ALL') rows = rows.filter(r => r.trend === trendFilter);
    if (search) {
      const lo = search.toLowerCase();
      rows = rows.filter(r => r._name.toLowerCase().includes(lo));
    }
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity);
      const bv = b[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity);
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [enriched, trendFilter, search, sortKey, sortDir]);

  // Trend count summary
  const trendCounts = useMemo(() => {
    const c = { HIGH: 0, RISING: 0, FALLING: 0, LOW: 0, null: 0 };
    enriched.forEach(r => { c[r.trend ?? 'null']++; });
    return c;
  }, [enriched]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };
  const sortArrow = (key) => sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  const colHdr = (label, key, align = 'left') => (
    <th onClick={() => toggleSort(key)}
      style={{ padding: '10px 14px', fontSize: 11, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', cursor: 'pointer', textAlign: align, userSelect: 'none', whiteSpace: 'nowrap', backgroundColor: t.header, borderBottom: `2px solid ${t.border}` }}>
      {label}{sortArrow(key)}
    </th>
  );

  const isLoading = histLoading;

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', backgroundColor: t.bg, minHeight: '100%', padding: '20px 24px', color: t.text }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px' }}>Dorsey Wright RS Ratio Report</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: t.muted }}>
              63-day sector RS ratio vs Nifty500 · Trend, direction, ROC &amp; sparkline
            </p>
          </div>
          <button onClick={() => setShowInfo(v => !v)}
            style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${t.border}`, backgroundColor: t.panel, color: t.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
            {showInfo ? 'Hide formula ▲' : 'Formula & what to look for ▼'}
          </button>
        </div>

        {/* Formula box */}
        {showInfo && (
          <div style={{ marginTop: 14, padding: '14px 18px', backgroundColor: t.panel, border: `1px solid ${t.border}`, borderRadius: 8, borderLeft: `3px solid #2563eb`, fontSize: 12, color: t.muted, lineHeight: 1.8 }}>
            <code style={{ display: 'block', color: isDark ? '#7dd3fc' : '#1d4ed8', marginBottom: 6 }}>
              Ratio = sector_avg_close ÷ Nifty500_close (daily, {DAYS} bars)<br />
              ROC Ratio = (ratio_today − ratio_{ROC_PERIOD}d_ago) / ratio_{ROC_PERIOD}d_ago × 100<br />
              Trend: HIGH=top 10% range · RISING=slope&gt;0 &amp; pos≥50% · FALLING=slope&lt;0 · LOW=bottom 10%
            </code>
            <strong style={{ color: '#16a34a' }}>Look for:</strong> Trend=RISING or HIGH · ROC positive · 10d Dir rising.
          </div>
        )}

        {/* No-history notice */}
        {!histLoading && !hasHistory && (
          <div style={{ marginTop: 14, padding: '12px 16px', backgroundColor: isDark ? 'rgba(234,179,8,0.1)' : '#fefce8', border: `1px solid ${isDark ? 'rgba(234,179,8,0.3)' : '#fde68a'}`, borderRadius: 8, fontSize: 12, color: isDark ? '#fcd34d' : '#92400e' }}>
            <strong>Historical data not yet available.</strong> Run <code>python sector_rs_snapshot.py --backfill</code> (or trigger the <em>RS Ratio Snapshot</em> GitHub Actions workflow with <code>--backfill</code>) to populate 63 days of ratio history. Until then the table shows current stock metadata only — sparklines, ROC and Trend will appear once the first snapshot runs.
          </div>
        )}
      </div>

      {/* ── Trend filter summary cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
        {['HIGH', 'RISING', 'FALLING', 'LOW'].map(tr => {
          const cfg    = TREND_CFG[tr];
          const active = trendFilter === tr;
          const desc   = tr === 'HIGH' ? 'Top 10% of range' : tr === 'RISING' ? 'Positive slope' : tr === 'FALLING' ? 'Negative slope' : 'Bottom 10% of range';
          return (
            <div key={tr} onClick={() => setTrendFilter(active ? 'ALL' : tr)}
              style={{ padding: '13px 16px', borderRadius: 8, border: `1px solid ${active ? cfg.color : t.border}`, backgroundColor: active ? cfg.bg : t.panel, cursor: 'pointer', transition: 'all 0.15s' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{tr}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: t.text, margin: '4px 0 2px' }}>{hasHistory ? trendCounts[tr] : '—'}</div>
              <div style={{ fontSize: 11, color: t.muted }}>{desc}</div>
            </div>
          );
        })}
      </div>

      {/* ── Tab + search row ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', backgroundColor: t.panel, borderRadius: 8, border: `1px solid ${t.border}`, padding: 3, gap: 2 }}>
          {Object.entries(tabConfig).map(([k, v]) => (
            <button key={k} onClick={() => { setTab(k); setSearch(''); setSortKey('currentRatio'); setSortDir('desc'); }}
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

      {/* ── Table ── */}
      <div style={{ backgroundColor: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {colHdr('Group', '_name')}
              {colHdr('Stocks', 'total_stocks', 'center')}
              <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', backgroundColor: t.header, borderBottom: `2px solid ${t.border}`, whiteSpace: 'nowrap' }}>
                RS Ratio ({DAYS}D)
              </th>
              {colHdr('Ratio', 'currentRatio', 'right')}
              {colHdr('10D Dir', 'currentRatio', 'left')}
              {colHdr('ROC of Ratio', 'roc', 'right')}
              {colHdr('Trend', 'trend')}
              {colHdr('% from High', 'pctFromHigh', 'right')}
              <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 800, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', backgroundColor: t.header, borderBottom: `2px solid ${t.border}`, textAlign: 'center', whiteSpace: 'nowrap' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: t.muted, fontWeight: 600 }}>Loading RS Ratio data...</td></tr>
            ) : displayed.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: t.muted, fontWeight: 600 }}>No data matches the current filter.</td></tr>
            ) : displayed.map((row, idx) => {
              const isLast = idx === displayed.length - 1;
              const rocVal = row.roc;
              const rocStr = rocVal != null ? `${rocVal >= 0 ? '+' : ''}${rocVal.toFixed(2)}%` : '—';
              const rocColor = rocVal == null ? t.muted : rocVal >= 0 ? '#16a34a' : '#dc2626';
              const pctStr = row.pctFromHigh != null ? `${row.pctFromHigh.toFixed(1)}%` : '—';
              const pctColor = row.pctFromHigh == null ? t.muted : row.pctFromHigh >= -2 ? t.text : '#dc2626';
              const ratioStr = row.currentRatio != null ? row.currentRatio.toFixed(5) : '—';

              return (
                <tr key={idx} style={{ borderBottom: isLast ? 'none' : `1px solid ${t.border}`, transition: 'background-color 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = t.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>

                  {/* Group name */}
                  <td style={{ padding: '12px 14px', fontWeight: 700, fontSize: 13, maxWidth: 180 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row._name}>{row._name}</div>
                    {tab !== 'sector' && row.sector && (
                      <div style={{ fontSize: 10, color: t.muted, marginTop: 2 }}>{row.sector}</div>
                    )}
                  </td>

                  {/* Stock count */}
                  <td style={{ padding: '12px 14px', textAlign: 'center', fontSize: 13, color: t.muted, fontWeight: 600 }}>{row.total_stocks}</td>

                  {/* Sparkline */}
                  <td style={{ padding: '8px 14px' }}>
                    <Sparkline series={row._series} trend={row.trend} />
                  </td>

                  {/* Current ratio value */}
                  <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: t.muted, fontVariantNumeric: 'tabular-nums' }}>
                    {ratioStr}
                  </td>

                  {/* 10D direction */}
                  <td style={{ padding: '12px 14px' }}>
                    {row._series ? <DirCell series={row._series} /> : <span style={{ color: t.muted, fontSize: 12 }}>—</span>}
                  </td>

                  {/* ROC */}
                  <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: rocColor }}>{rocStr}</span>
                  </td>

                  {/* Trend badge */}
                  <td style={{ padding: '12px 14px' }}>
                    {row.trend ? <TrendBadge trend={row.trend} /> : <span style={{ color: t.muted, fontSize: 12 }}>—</span>}
                  </td>

                  {/* % from high */}
                  <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: pctColor }}>{pctStr}</span>
                  </td>

                  {/* Scan */}
                  <td style={{ padding: '12px 14px', textAlign: 'center' }}>
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
        RS Ratio = sector avg close ÷ Nifty500 close · Updated daily after market close
      </div>
    </div>
  );
}
