import React, { useEffect, useState, useMemo } from 'react';

const API = 'https://algo-scanner-lnck.onrender.com';

const QUADRANT = {
  LEADING:   { label: 'Leading',   color: '#16a34a', bg: 'rgba(22,163,74,0.15)',   border: 'rgba(22,163,74,0.4)',   desc: 'Outperforming & Strengthening' },
  IMPROVING: { label: 'Improving', color: '#d97706', bg: 'rgba(217,119,6,0.15)',   border: 'rgba(217,119,6,0.4)',   desc: 'Underperforming but Gaining Momentum' },
  WEAKENING: { label: 'Weakening', color: '#ea580c', bg: 'rgba(234,88,12,0.15)',   border: 'rgba(234,88,12,0.4)',   desc: 'Outperforming but Losing Momentum' },
  LAGGING:   { label: 'Lagging',   color: '#dc2626', bg: 'rgba(220,38,38,0.15)',   border: 'rgba(220,38,38,0.4)',   desc: 'Underperforming & Weakening' },
};

// RS Ratio: scale avg_rs to be centered at 100
// avg_rs of 0 → ratio of 100 (neutral); positive → above 100; negative → below 100
// Scale: 1 unit of avg_rs = 10 ratio points (so +0.10 avg_rs → ratio 101)
function toRSRatio(avg_rs) {
  return 100 + (Number(avg_rs) || 0) * 100;
}

// RS Momentum: derived from outperforming_pct
// 50% outperforming → 100 (neutral). Scale: 1% outperformance = 1 momentum point
function toRSMomentum(outperforming_pct, active_crosses, total_stocks) {
  const breadth = total_stocks > 0 ? (active_crosses / total_stocks) * 100 : 50;
  // Blend outperforming % with breadth (EMA cross ratio) for a composite momentum
  const blended = (Number(outperforming_pct) * 0.7) + (breadth * 0.3);
  return blended; // 50 = neutral → scale to 100 center
}

function getQuadrant(rsRatio, rsMomentum) {
  const ratioStrong = rsRatio >= 100;
  const momentumStrong = rsMomentum >= 50; // 50% is neutral for our scale
  if (ratioStrong && momentumStrong)  return 'LEADING';
  if (!ratioStrong && momentumStrong) return 'IMPROVING';
  if (ratioStrong && !momentumStrong) return 'WEAKENING';
  return 'LAGGING';
}

function QuadrantBadge({ q, small = false }) {
  const cfg = QUADRANT[q];
  return (
    <span style={{
      display: 'inline-block',
      padding: small ? '3px 8px' : '4px 10px',
      borderRadius: '5px',
      fontSize: small ? '10px' : '11px',
      fontWeight: '800',
      letterSpacing: '0.3px',
      color: cfg.color,
      backgroundColor: cfg.bg,
      border: `1px solid ${cfg.border}`,
      whiteSpace: 'nowrap',
    }}>
      {cfg.label.toUpperCase()}
    </span>
  );
}

// Compact bar to visualize RS Ratio around centerline 100
function RatioBar({ value, isDark }) {
  const clamped = Math.max(80, Math.min(120, value));
  const pct = ((clamped - 80) / 40) * 100; // 80–120 → 0–100%
  const isStrong = value >= 100;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
      <div style={{ flex: 1, height: '6px', backgroundColor: isDark ? '#1e293b' : '#e2e8f0', borderRadius: '3px', position: 'relative', overflow: 'visible' }}>
        {/* centerline at 50% */}
        <div style={{ position: 'absolute', left: '50%', top: '-2px', width: '2px', height: '10px', backgroundColor: isDark ? '#475569' : '#94a3b8', borderRadius: '1px' }} />
        <div style={{
          position: 'absolute',
          left: isStrong ? '50%' : `${pct}%`,
          width: isStrong ? `${pct - 50}%` : `${50 - pct}%`,
          height: '100%',
          backgroundColor: isStrong ? '#16a34a' : '#dc2626',
          borderRadius: '3px',
        }} />
      </div>
      <span style={{ fontSize: '11px', fontWeight: '700', color: isStrong ? '#16a34a' : '#dc2626', width: '38px', textAlign: 'right', flexShrink: 0 }}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

function RotationArrow({ current, previous }) {
  if (!previous) return null;
  const quadrantOrder = { LAGGING: 0, IMPROVING: 1, LEADING: 2, WEAKENING: 3 };
  const curr = quadrantOrder[current] ?? -1;
  const prev = quadrantOrder[previous] ?? -1;
  // clockwise rotation: L→I→Le→W→L is the natural cycle
  const clockwiseNext = { LAGGING: 'IMPROVING', IMPROVING: 'LEADING', LEADING: 'WEAKENING', WEAKENING: 'LAGGING' };
  if (clockwiseNext[previous] === current) return <span style={{ color: '#16a34a', fontSize: '12px', fontWeight: '900' }} title="Rotating clockwise (bullish)">↻</span>;
  if (clockwiseNext[current] === previous) return <span style={{ color: '#dc2626', fontSize: '12px', fontWeight: '900' }} title="Rotating counter-clockwise (bearish)">↺</span>;
  return null;
}

// Mini RRG scatter plot
function RRGChart({ data, isDark, groupKey }) {
  const width = 340, height = 280;
  const pad = { top: 20, right: 20, bottom: 30, left: 40 };
  const inner = { w: width - pad.left - pad.right, h: height - pad.top - pad.bottom };

  const xs = data.map(d => d.rsRatio);
  const ys = data.map(d => d.rsMomentum);
  const xMin = Math.min(85, ...xs), xMax = Math.max(115, ...xs);
  const yMin = Math.min(20, ...ys), yMax = Math.max(80, ...ys);

  const scaleX = v => pad.left + ((v - xMin) / (xMax - xMin)) * inner.w;
  const scaleY = v => pad.top + ((yMax - v) / (yMax - yMin)) * inner.h;

  const cx = scaleX(100), cy = scaleY(50);

  const quadrantColors = {
    tl: isDark ? 'rgba(217,119,6,0.07)' : 'rgba(217,119,6,0.08)',    // IMPROVING
    tr: isDark ? 'rgba(22,163,74,0.07)' : 'rgba(22,163,74,0.08)',    // LEADING
    bl: isDark ? 'rgba(220,38,38,0.07)' : 'rgba(220,38,38,0.08)',    // LAGGING
    br: isDark ? 'rgba(234,88,12,0.07)' : 'rgba(234,88,12,0.08)',    // WEAKENING
  };

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      {/* Quadrant backgrounds */}
      <rect x={pad.left} y={pad.top} width={cx - pad.left} height={cy - pad.top} fill={quadrantColors.tl} />
      <rect x={cx} y={pad.top} width={pad.left + inner.w - cx} height={cy - pad.top} fill={quadrantColors.tr} />
      <rect x={pad.left} y={cy} width={cx - pad.left} height={pad.top + inner.h - cy} fill={quadrantColors.bl} />
      <rect x={cx} y={cy} width={pad.left + inner.w - cx} height={pad.top + inner.h - cy} fill={quadrantColors.br} />

      {/* Quadrant labels */}
      <text x={pad.left + 6} y={pad.top + 14} fontSize="9" fill="#d97706" fontWeight="700">IMPROVING</text>
      <text x={cx + 6} y={pad.top + 14} fontSize="9" fill="#16a34a" fontWeight="700">LEADING</text>
      <text x={pad.left + 6} y={pad.top + inner.h - 6} fontSize="9" fill="#dc2626" fontWeight="700">LAGGING</text>
      <text x={cx + 6} y={pad.top + inner.h - 6} fontSize="9" fill="#ea580c" fontWeight="700">WEAKENING</text>

      {/* Axes */}
      <line x1={cx} y1={pad.top} x2={cx} y2={pad.top + inner.h} stroke={isDark ? '#334155' : '#cbd5e1'} strokeWidth="1" strokeDasharray="4,3" />
      <line x1={pad.left} y1={cy} x2={pad.left + inner.w} y2={cy} stroke={isDark ? '#334155' : '#cbd5e1'} strokeWidth="1" strokeDasharray="4,3" />

      {/* Axis labels */}
      <text x={pad.left + inner.w / 2} y={height - 4} fontSize="9" fill={isDark ? '#64748b' : '#94a3b8'} textAnchor="middle">RS Ratio →</text>
      <text x={10} y={pad.top + inner.h / 2} fontSize="9" fill={isDark ? '#64748b' : '#94a3b8'} textAnchor="middle" transform={`rotate(-90, 10, ${pad.top + inner.h / 2})`}>RS Momentum →</text>

      {/* Data points */}
      {data.map((d, i) => {
        const x = scaleX(d.rsRatio), y = scaleY(d.rsMomentum);
        const q = QUADRANT[d.quadrant];
        const label = (d[groupKey] || '').substring(0, 10);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={5} fill={q.color} opacity={0.85} />
            <text x={x + 7} y={y + 4} fontSize="8" fill={isDark ? '#94a3b8' : '#475569'} fontWeight="600">{label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function RSRatioReport({ theme, onScanNavigate }) {
  const isDark = theme === 'dark';
  const [tab, setTab] = useState('sector');
  const [sectorData, setSectorData] = useState([]);
  const [industryData, setIndustryData] = useState([]);
  const [microData, setMicroData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState('rsRatio');
  const [sortDir, setSortDir] = useState('desc');
  const [quadrantFilter, setQuadrantFilter] = useState('ALL');
  const [showRRG, setShowRRG] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const t = {
    bg: isDark ? '#020617' : '#f1f5f9',
    panel: isDark ? '#0f172a' : '#ffffff',
    text: isDark ? '#f8fafc' : '#0f172a',
    muted: isDark ? '#94a3b8' : '#64748b',
    border: isDark ? '#1e293b' : '#e2e8f0',
    hover: isDark ? '#1e293b' : '#f8fafc',
    header: isDark ? '#0f172a' : '#f8fafc',
    inputBg: isDark ? '#020617' : '#ffffff',
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API}/api/sector-heatmap`).then(r => r.json()),
      fetch(`${API}/api/industry-heatmap`).then(r => r.json()),
      fetch(`${API}/api/micro-industry-heatmap`).then(r => r.json()),
    ]).then(([s, i, m]) => {
      setSectorData(Array.isArray(s) ? s : []);
      setIndustryData(Array.isArray(i) ? i : []);
      setMicroData(Array.isArray(m) ? m : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  function enrichRows(rows, groupKey) {
    const maxRatio = Math.max(...rows.map(r => toRSRatio(r.avg_rs)));
    return rows.map(r => {
      const rsRatio = toRSRatio(r.avg_rs);
      const rsMomentum = toRSMomentum(r.outperforming_pct, r.active_crosses, r.total_stocks);
      const quadrant = getQuadrant(rsRatio, rsMomentum);
      const pctFromHigh = maxRatio > 0 ? ((rsRatio - maxRatio) / maxRatio) * 100 : 0;
      return { ...r, rsRatio, rsMomentum, quadrant, pctFromHigh, [groupKey]: r[groupKey] };
    });
  }

  const tabConfig = {
    sector:   { label: 'Sector',         key: 'sector',        raw: sectorData },
    industry: { label: 'Macro Industry', key: 'industry',      raw: industryData },
    micro:    { label: 'Basic Industry', key: 'basic_industry', raw: microData },
  };

  const { key: groupKey, raw } = tabConfig[tab];

  const enriched = useMemo(() => enrichRows(raw, groupKey), [raw, groupKey]);

  const displayed = useMemo(() => {
    let rows = enriched;
    if (quadrantFilter !== 'ALL') rows = rows.filter(r => r.quadrant === quadrantFilter);
    if (searchTerm) {
      const lo = searchTerm.toLowerCase();
      rows = rows.filter(r => (r[groupKey] || '').toLowerCase().includes(lo));
    }
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [enriched, quadrantFilter, searchTerm, sortKey, sortDir, groupKey]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sortArrow = (key) => sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  // Quadrant summary counts
  const counts = useMemo(() => {
    const c = { LEADING: 0, IMPROVING: 0, WEAKENING: 0, LAGGING: 0 };
    enriched.forEach(r => { if (c[r.quadrant] !== undefined) c[r.quadrant]++; });
    return c;
  }, [enriched]);

  const colHdr = (label, key, align = 'left') => (
    <th
      onClick={() => toggleSort(key)}
      style={{ padding: '10px 14px', fontSize: '11px', fontWeight: '800', color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', cursor: 'pointer', textAlign: align, userSelect: 'none', whiteSpace: 'nowrap', backgroundColor: t.header, borderBottom: `2px solid ${t.border}` }}
    >
      {label}{sortArrow(key)}
    </th>
  );

  if (loading) {
    return <div style={{ padding: '60px', textAlign: 'center', color: t.muted, fontWeight: '600' }}>Loading RS Ratio data...</div>;
  }

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', backgroundColor: t.bg, minHeight: '100%', padding: '20px 24px', color: t.text }}>

      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '900', letterSpacing: '-0.3px' }}>RS Ratio Report</h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: t.muted }}>
              Relative Rotation — RS Ratio vs RS Momentum · Identifies sector rotation &amp; money flow
            </p>
          </div>
          <button
            onClick={() => setShowRRG(v => !v)}
            style={{ padding: '7px 14px', borderRadius: '6px', border: `1px solid ${t.border}`, backgroundColor: showRRG ? '#2563eb' : t.panel, color: showRRG ? '#fff' : t.muted, fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
          >
            {showRRG ? 'Hide RRG Chart' : 'Show RRG Chart'}
          </button>
        </div>

        {/* Methodology note */}
        <div style={{ marginTop: '14px', padding: '12px 16px', backgroundColor: t.panel, border: `1px solid ${t.border}`, borderRadius: '8px', borderLeft: `3px solid #2563eb` }}>
          <div style={{ fontSize: '12px', color: t.muted, lineHeight: '1.6' }}>
            <strong style={{ color: t.text }}>RS Ratio</strong> = sector avg return vs Nifty500 (56-day), scaled to 100 centerline.&nbsp;
            <strong style={{ color: t.text }}>RS Momentum</strong> = % of stocks outperforming Nifty + EMA breadth (blended).&nbsp;
            <strong style={{ color: QUADRANT.LEADING.color }}>Leading</strong> = strong ratio &amp; strong momentum.&nbsp;
            <strong style={{ color: QUADRANT.IMPROVING.color }}>Improving</strong> = weak ratio but rising momentum (early entry).&nbsp;
            <strong style={{ color: QUADRANT.WEAKENING.color }}>Weakening</strong> = strong ratio but fading momentum (exit signal).&nbsp;
            <strong style={{ color: QUADRANT.LAGGING.color }}>Lagging</strong> = underperforming on both dimensions.
          </div>
        </div>
      </div>

      {/* RRG Chart */}
      {showRRG && (
        <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: t.panel, border: `1px solid ${t.border}`, borderRadius: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: t.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Relative Rotation Graph — {tabConfig[tab].label}</div>
          <RRGChart data={displayed.slice(0, 30)} isDark={isDark} groupKey={groupKey} />
          <div style={{ fontSize: '11px', color: t.muted }}>Each dot = one {tabConfig[tab].label.toLowerCase()}. Clockwise rotation is bullish.</div>
        </div>
      )}

      {/* Quadrant Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {['LEADING', 'IMPROVING', 'WEAKENING', 'LAGGING'].map(q => {
          const cfg = QUADRANT[q];
          const active = quadrantFilter === q;
          return (
            <div
              key={q}
              onClick={() => setQuadrantFilter(active ? 'ALL' : q)}
              style={{ padding: '14px 16px', borderRadius: '8px', border: `1px solid ${active ? cfg.color : t.border}`, backgroundColor: active ? cfg.bg : t.panel, cursor: 'pointer', transition: 'all 0.15s' }}
            >
              <div style={{ fontSize: '11px', fontWeight: '800', color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{cfg.label}</div>
              <div style={{ fontSize: '26px', fontWeight: '900', color: t.text, margin: '4px 0 2px' }}>{counts[q]}</div>
              <div style={{ fontSize: '11px', color: t.muted }}>{cfg.desc}</div>
            </div>
          );
        })}
      </div>

      {/* Tab + Filter Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', backgroundColor: t.panel, borderRadius: '8px', border: `1px solid ${t.border}`, padding: '3px', gap: '2px' }}>
          {Object.entries(tabConfig).map(([k, v]) => (
            <button
              key={k}
              onClick={() => { setTab(k); setSearchTerm(''); }}
              style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', fontWeight: '700', fontSize: '12px', cursor: 'pointer', backgroundColor: tab === k ? '#2563eb' : 'transparent', color: tab === k ? '#fff' : t.muted, transition: 'all 0.2s' }}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {quadrantFilter !== 'ALL' && (
            <button onClick={() => setQuadrantFilter('ALL')} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${t.border}`, backgroundColor: t.panel, color: t.muted, fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
              Clear Filter ×
            </button>
          )}
          <input
            type="text"
            placeholder={`Search ${tabConfig[tab].label}...`}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ padding: '7px 12px', borderRadius: '6px', border: `1px solid ${t.border}`, backgroundColor: t.inputBg, color: t.text, fontSize: '12px', width: '200px', outline: 'none' }}
          />
        </div>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: t.panel, border: `1px solid ${t.border}`, borderRadius: '10px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {colHdr('Group', groupKey)}
              {colHdr('Stocks', 'total_stocks', 'center')}
              {colHdr('RS Ratio', 'rsRatio', 'right')}
              {colHdr('RS Momentum', 'rsMomentum', 'right')}
              {colHdr('Outperforming %', 'outperforming_pct', 'center')}
              {colHdr('Active Crosses', 'active_crosses', 'center')}
              {colHdr('Quadrant', 'quadrant')}
              {colHdr('% from High', 'pctFromHigh', 'right')}
              <th style={{ padding: '10px 14px', fontSize: '11px', fontWeight: '800', color: t.muted, textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: 'center', backgroundColor: t.header, borderBottom: `2px solid ${t.border}`, whiteSpace: 'nowrap' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: t.muted, fontWeight: '600' }}>No data matches the current filter.</td>
              </tr>
            ) : displayed.map((row, idx) => {
              const groupLabel = row[groupKey] || '—';
              const qCfg = QUADRANT[row.quadrant];
              const outpct = Number(row.outperforming_pct) || 0;
              const isLast = idx === displayed.length - 1;

              return (
                <tr
                  key={idx}
                  style={{ borderBottom: isLast ? 'none' : `1px solid ${t.border}`, transition: 'background-color 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = t.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  {/* Group name */}
                  <td style={{ padding: '13px 14px', fontWeight: '700', fontSize: '13px', color: t.text, maxWidth: '200px' }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={groupLabel}>{groupLabel}</div>
                    {tab !== 'sector' && row.sector && (
                      <div style={{ fontSize: '10px', color: t.muted, marginTop: '2px', fontWeight: '500' }}>{row.sector}</div>
                    )}
                  </td>

                  {/* Stock count */}
                  <td style={{ padding: '13px 14px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color: t.muted }}>{row.total_stocks}</td>

                  {/* RS Ratio bar */}
                  <td style={{ padding: '13px 14px', width: '160px' }}>
                    <RatioBar value={row.rsRatio} isDark={isDark} />
                  </td>

                  {/* RS Momentum */}
                  <td style={{ padding: '13px 14px', textAlign: 'right' }}>
                    <span style={{
                      fontSize: '13px', fontWeight: '800',
                      color: row.rsMomentum >= 50 ? '#16a34a' : '#dc2626',
                    }}>
                      {row.rsMomentum >= 50 ? '+' : ''}{(row.rsMomentum - 50).toFixed(1)}
                    </span>
                    <span style={{ fontSize: '10px', color: t.muted, marginLeft: '3px' }}>pts</span>
                  </td>

                  {/* Outperforming % bar */}
                  <td style={{ padding: '13px 14px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: outpct >= 50 ? '#16a34a' : '#dc2626' }}>{outpct.toFixed(0)}%</span>
                      <div style={{ width: '70px', height: '5px', backgroundColor: isDark ? '#1e293b' : '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${outpct}%`, height: '100%', backgroundColor: outpct >= 50 ? '#16a34a' : '#dc2626', borderRadius: '3px' }} />
                      </div>
                    </div>
                  </td>

                  {/* Active crosses */}
                  <td style={{ padding: '13px 14px', textAlign: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: t.text }}>{row.active_crosses || 0}</span>
                    <span style={{ fontSize: '11px', color: t.muted }}> / {row.total_stocks}</span>
                  </td>

                  {/* Quadrant badge */}
                  <td style={{ padding: '13px 14px' }}>
                    <QuadrantBadge q={row.quadrant} />
                  </td>

                  {/* % from high */}
                  <td style={{ padding: '13px 14px', textAlign: 'right' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: row.pctFromHigh >= -2 ? t.text : '#dc2626' }}>
                      {row.pctFromHigh === 0 ? '—' : `${row.pctFromHigh.toFixed(1)}%`}
                    </span>
                  </td>

                  {/* Scan action */}
                  <td style={{ padding: '13px 14px', textAlign: 'center' }}>
                    {onScanNavigate && (tab === 'industry' || tab === 'sector') && (
                      <button
                        onClick={() => {
                          if (tab === 'industry') onScanNavigate([row.industry], 'macro');
                          else if (tab === 'sector' && row.industries) onScanNavigate(row.industries.map(i => i.industry), 'macro');
                        }}
                        style={{ padding: '4px 10px', borderRadius: '5px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                      >
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

      {/* Footer note */}
      <div style={{ marginTop: '12px', fontSize: '11px', color: t.muted, textAlign: 'right' }}>
        Data refreshes daily via market engine. RS Ratio &amp; Momentum derived from 56-day Nifty500-relative returns.
      </div>
    </div>
  );
}

export default RSRatioReport;
