import React, { useState, useEffect, useMemo, useRef } from 'react';

const API = 'https://algo-scanner-lnck.onrender.com';

const COLUMNS = [
  { key: 'ticker',         label: 'Ticker' },
  { key: 'stock_name',     label: 'Name' },
  { key: 'sector',         label: 'Sector' },
  { key: 'industry',       label: 'Macro Industry' },
  { key: 'basic_industry', label: 'Micro Industry' },
  { key: 'rs_score',       label: 'RS55' },
];

function useClickOutside(ref, handler) {
  useEffect(() => {
    const listener = (e) => { if (ref.current && !ref.current.contains(e.target)) handler(); };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler]);
}

function DropdownFilter({ label, options, selected, onChange, t }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false));

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));
  const allSelected = selected.length === 0;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '5px 10px', borderRadius: '6px', border: `1px solid ${selected.length ? '#3b82f6' : t.border}`,
          backgroundColor: selected.length ? (t.bgApp === '#020617' ? 'rgba(59,130,246,0.15)' : '#eff6ff') : t.bgPanel,
          color: selected.length ? '#3b82f6' : t.textMuted, fontWeight: '600', fontSize: '12px',
          cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px'
        }}
      >
        {label} {selected.length ? `(${selected.length})` : ''} ▾
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 1000, minWidth: '200px', maxWidth: '280px',
          backgroundColor: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)', marginTop: '4px', overflow: 'hidden'
        }}>
          <div style={{ padding: '8px' }}>
            <input
              autoFocus
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '6px 10px', borderRadius: '5px', border: `1px solid ${t.border}`, backgroundColor: t.bgApp, color: t.textMain, fontSize: '12px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            <div
              onClick={() => { onChange([]); setOpen(false); }}
              style={{ padding: '7px 14px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', color: allSelected ? '#3b82f6' : t.textMuted, backgroundColor: allSelected ? (t.bgApp === '#020617' ? 'rgba(59,130,246,0.1)' : '#eff6ff') : 'transparent' }}
            >
              All
            </div>
            {filtered.map(opt => {
              const checked = selected.includes(opt);
              return (
                <div
                  key={opt}
                  onClick={() => onChange(checked ? selected.filter(x => x !== opt) : [...selected, opt])}
                  style={{ padding: '7px 14px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: checked ? '#3b82f6' : t.textMain, backgroundColor: checked ? (t.bgApp === '#020617' ? 'rgba(59,130,246,0.08)' : '#f0f7ff') : 'transparent' }}
                >
                  <span style={{ width: '14px', height: '14px', border: `2px solid ${checked ? '#3b82f6' : t.border}`, borderRadius: '3px', backgroundColor: checked ? '#3b82f6' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {checked && <span style={{ color: '#fff', fontSize: '10px', fontWeight: '900' }}>✓</span>}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
                </div>
              );
            })}
            {filtered.length === 0 && <div style={{ padding: '10px 14px', fontSize: '12px', color: t.textMuted }}>No results</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StocksDirectory({ theme, t }) {
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('rs_score');
  const [sortDir, setSortDir] = useState('desc');

  const [filterSector,   setFilterSector]   = useState([]);
  const [filterMacro,    setFilterMacro]    = useState([]);
  const [filterMicro,    setFilterMicro]    = useState([]);
  const [filterRS,       setFilterRS]       = useState('all'); // all | positive | negative

  useEffect(() => {
    fetch(`${API}/api/stocks-directory`)
      .then(r => r.json())
      .then(data => { setRaw(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const rows = useMemo(() => raw.map(r => ({
    ...r,
    ticker: r.fyers_symbol ? r.fyers_symbol.split(':')[1]?.replace(/-EQ$|-BE$|-BZ$|-BL$|-BT$|-SM$|-ST$/, '') : '--',
  })), [raw]);

  const sectors   = useMemo(() => [...new Set(rows.map(r => r.sector).filter(Boolean))].sort(), [rows]);
  const macros    = useMemo(() => [...new Set(rows.map(r => r.industry).filter(Boolean))].sort(), [rows]);
  const micros    = useMemo(() => [...new Set(rows.map(r => r.basic_industry).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    let data = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      data = data.filter(r =>
        (r.ticker || '').toLowerCase().includes(q) ||
        (r.stock_name || '').toLowerCase().includes(q) ||
        (r.sector || '').toLowerCase().includes(q) ||
        (r.industry || '').toLowerCase().includes(q) ||
        (r.basic_industry || '').toLowerCase().includes(q)
      );
    }
    if (filterSector.length)  data = data.filter(r => filterSector.includes(r.sector));
    if (filterMacro.length)   data = data.filter(r => filterMacro.includes(r.industry));
    if (filterMicro.length)   data = data.filter(r => filterMicro.includes(r.basic_industry));
    if (filterRS === 'positive') data = data.filter(r => r.rs_score != null && r.rs_score > 0);
    if (filterRS === 'negative') data = data.filter(r => r.rs_score != null && r.rs_score <= 0);
    return data;
  }, [rows, search, filterSector, filterMacro, filterMicro, filterRS]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let va = a[sortKey === 'ticker' ? 'ticker' : sortKey];
      let vb = b[sortKey === 'ticker' ? 'ticker' : sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'rs_score' ? 'desc' : 'asc'); }
  };

  const activeFilters = filterSector.length + filterMacro.length + filterMicro.length + (filterRS !== 'all' ? 1 : 0);

  const clearAll = () => { setFilterSector([]); setFilterMacro([]); setFilterMicro([]); setFilterRS('all'); setSearch(''); };

  const colWidths = '100px 1fr 160px 200px 200px 90px';

  const headerCell = (key, label) => {
    const active = sortKey === key;
    return (
      <div
        onClick={() => toggleSort(key)}
        style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px', color: active ? '#3b82f6' : t.textMuted, fontWeight: '800', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}
      >
        {label}
        <span style={{ fontSize: '10px', opacity: active ? 1 : 0.4 }}>{active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: t.bgApp }}>

      {/* Toolbar */}
      <div style={{ padding: '12px 20px', backgroundColor: t.bgPanel, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', flexShrink: 0 }}>
        <input
          placeholder="🔍 Search ticker, name, sector, industry..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '7px 14px', borderRadius: '6px', border: `1px solid ${t.border}`, backgroundColor: t.inputBg, color: t.textMain, fontSize: '13px', width: '300px' }}
        />

        <DropdownFilter label="Sector"         options={sectors} selected={filterSector} onChange={setFilterSector} t={t} />
        <DropdownFilter label="Macro Industry" options={macros}   selected={filterMacro}  onChange={setFilterMacro}  t={t} />
        <DropdownFilter label="Micro Industry" options={micros}   selected={filterMicro}  onChange={setFilterMicro}  t={t} />

        {/* RS filter */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {[['all','All RS'],['positive','RS > 0'],['negative','RS ≤ 0']].map(([val, lbl]) => (
            <button key={val} onClick={() => setFilterRS(val)} style={{ padding: '5px 10px', borderRadius: '6px', border: `1px solid ${filterRS === val ? '#3b82f6' : t.border}`, backgroundColor: filterRS === val ? '#3b82f6' : t.bgPanel, color: filterRS === val ? '#fff' : t.textMuted, fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}>{lbl}</button>
          ))}
        </div>

        {activeFilters > 0 && (
          <button onClick={clearAll} style={{ padding: '5px 12px', borderRadius: '6px', border: `1px solid ${t.border}`, backgroundColor: t.bgApp, color: t.textMuted, fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}>
            ✕ Clear ({activeFilters})
          </button>
        )}

        <div style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: '700', color: t.textMuted }}>
          {sorted.length.toLocaleString()} / {rows.length.toLocaleString()} stocks
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: colWidths, padding: '12px 20px', backgroundColor: t.bgPanel, borderBottom: `2px solid ${t.border}`, gap: '12px', flexShrink: 0 }}>
          {COLUMNS.map(col => <div key={col.key}>{headerCell(col.key === 'ticker' ? 'ticker' : col.key === 'stock_name' ? 'stock_name' : col.key === 'sector' ? 'sector' : col.key === 'industry' ? 'industry' : col.key === 'basic_industry' ? 'basic_industry' : 'rs_score', col.label)}</div>)}
        </div>

        {/* Rows */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px', color: t.textMuted, fontSize: '14px' }}>Loading stocks...</div>
          ) : sorted.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px', color: t.textMuted, fontSize: '14px' }}>No stocks match your filters.</div>
          ) : sorted.map((row, i) => {
            const rs = row.rs_score;
            const rsColor = rs == null ? t.textMuted : rs > 0 ? t.rsPosText : t.rsNegText;
            const rsBg    = rs == null ? 'transparent' : rs > 0 ? t.rsPosBg : t.rsNegBg;
            return (
              <div
                key={i}
                style={{ display: 'grid', gridTemplateColumns: colWidths, padding: '11px 20px', borderBottom: `1px solid ${t.border}`, gap: '12px', alignItems: 'center', fontSize: '13px', transition: 'background-color 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = t.hover}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <div style={{ fontWeight: '800', color: t.textTicker, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.ticker || '--'}</div>
                <div style={{ color: t.textMain, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.stock_name}>{row.stock_name || '--'}</div>
                <div style={{ color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.sector}>{row.sector || '--'}</div>
                <div style={{ color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.industry}>{row.industry || '--'}</div>
                <div style={{ color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.basic_industry}>{row.basic_industry || '--'}</div>
                <div style={{ fontWeight: '700', color: rsColor, backgroundColor: rsBg, borderRadius: '5px', padding: '2px 8px', textAlign: 'center', fontSize: '12px' }}>
                  {rs != null ? (rs > 0 ? `+${rs}` : `${rs}`) : '--'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
