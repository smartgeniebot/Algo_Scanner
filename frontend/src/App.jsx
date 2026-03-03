import React, { useState, useEffect, useMemo } from 'react';
import SectorHeatmap from './components/SectorHeatmap';
import IndustryHeatmap from './components/IndustryHeatmap';

function App() {
  const [hierarchy, setHierarchy] = useState({});
  const [selectedIndustries, setSelectedIndustries] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'rs_score', direction: 'desc' });
  const [activeView, setActiveView] = useState('scanner'); 
  const [searchTerm, setSearchTerm] = useState('');
  
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    fetch('https://algo-scanner-lnck.onrender.com/api/filters').then(res => res.json()).then(res => setHierarchy(res.data));
  }, []);

  const handleScan = () => {
    setLoading(true);
    fetch('https://algo-scanner-lnck.onrender.com/api/stocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industries: selectedIndustries })
    }).then(res => res.json()).then(res => { setStocks(res.data); setLoading(false); });
  };

  const triggerScanFromHeatmap = (industriesToScan) => {
    setSelectedIndustries(industriesToScan);
    setActiveView('scanner');
    setLoading(true);
    fetch('https://algo-scanner-lnck.onrender.com/api/stocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industries: industriesToScan })
    }).then(res => res.json()).then(res => { setStocks(res.data); setLoading(false); });
  };

  const handleSelectAll = () => setSelectedIndustries(Object.values(hierarchy).flat());
  
  const handleClear = () => {
    setSelectedIndustries([]);
    setStocks([]);
    setSearchTerm(''); 
  };

  const formatDT = (dt) => {
    if (!dt || dt === "--") return "--";
    const parts = dt.split(' ');
    const d = parts[0].split('-');
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const formattedDate = `${d[2]} ${months[parseInt(d[1])-1]}`;
    return parts[1] ? `${formattedDate} ${parts[1]}` : formattedDate;
  };

  const filteredStocks = useMemo(() => {
    if (!searchTerm) return stocks;
    const lowerSearch = searchTerm.toLowerCase();
    return stocks.filter(stock =>
      Object.values(stock).some(val => String(val).toLowerCase().includes(lowerSearch))
    );
  }, [stocks, searchTerm]);

  const sortedStocks = useMemo(() => {
    let items = [...filteredStocks]; 
    if (sortConfig.key) {
      items.sort((a, b) => {
        const valA = a[sortConfig.key] ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
        const valB = b[sortConfig.key] ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return items;
  }, [filteredStocks, sortConfig]);

  const toggleSort = (key) => setSortConfig({ key, direction: sortConfig.key === key && sortConfig.direction === 'desc' ? 'asc' : 'desc' });

  // 🎨 UNIFIED SLATE PALETTE: Tickers, Main Text, and Muted Text all use #64748b
  const themes = {
    light: {  
      bgApp: '#f1f5f9', bgPanel: '#ffffff', 
      textMain: '#64748b',      // 🏛️ Unified Slate
      textTicker: '#64748b',    // 🏛️ Unified Slate
      textMuted: '#64748b',     // 🏛️ Unified Slate
      border: '#e2e8f0', 
      hover: '#f8fafc', 
      inputBg: '#ffffff',
      btnPrimaryBg: '#2563eb', btnPrimaryText: '#ffffff',
      btnSuccessBg: '#dcfce7', btnSuccessText: '#15803d', btnSuccessBorder: '#bbf7d0',
      btnDangerBg: '#fee2e2', btnDangerText: '#b91c1c', btnDangerBorder: '#fecaca',
      rsPosBg: '#ecfdf5', rsPosText: '#059669', rsNegBg: '#fef2f2', rsNegText: '#dc2626',
      icon15m: '#8b5cf6', icon1h: '#3b82f6'
    },
    dark: {
      bgApp: '#020617', bgPanel: '#0f172a', 
      textMain: '#f8fafc',
      textTicker: '#38bdf8',    
      textMuted: '#cbd5e1',
      border: '#1e293b', 
      hover: '#1e293b', 
      inputBg: '#020617',
      btnPrimaryBg: '#3b82f6', btnPrimaryText: '#ffffff',
      btnSuccessBg: 'rgba(34, 197, 94, 0.2)', btnSuccessText: '#4ade80', btnSuccessBorder: 'rgba(34, 197, 94, 0.4)',
      btnDangerBg: 'rgba(239, 68, 68, 0.2)', btnDangerText: '#f87171', btnDangerBorder: 'rgba(239, 68, 68, 0.4)',
      rsPosBg: 'rgba(16, 185, 129, 0.2)', rsPosText: '#34d399', rsNegBg: 'rgba(244, 63, 94, 0.2)', rsNegText: '#fb7185',
      icon15m: '#a78bfa', icon1h: '#60a5fa'
    }
  };
  const t = themes[theme]; 

  const gridRowStyle = { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', width: '100%', alignItems: 'center', textAlign: 'center' };
  const headerSortStyle = { cursor: 'pointer', userSelect: 'none', transition: 'color 0.2s' };
  const tabStyle = { padding: '6px 16px', borderRadius: '6px', border: 'none', fontWeight: '700', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s' }; 

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden', fontFamily: 'Inter, sans-serif', backgroundColor: t.bgApp, color: t.textMain, transition: 'background-color 0.3s' }}>
      
      <header style={{ height: '65px', backgroundColor: t.bgPanel, padding: '0 25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${t.border}`, flexShrink: 0, transition: 'all 0.3s', position: 'relative', zIndex: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '900', letterSpacing: '-0.5px' }}>CHART HAWKS</h1>
          <div style={{ display: 'flex', backgroundColor: t.bgApp, borderRadius: '8px', padding: '4px' }}>
            <button onClick={() => setActiveView('scanner')} style={{...tabStyle, backgroundColor: activeView === 'scanner' ? t.bgPanel : 'transparent', color: activeView === 'scanner' ? t.textMain : t.textMuted, boxShadow: activeView === 'scanner' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}}>📊 Scanner</button>
            <button onClick={() => setActiveView('heatmap')} style={{...tabStyle, backgroundColor: activeView === 'heatmap' ? t.bgPanel : 'transparent', color: activeView === 'heatmap' ? t.textMain : t.textMuted, boxShadow: activeView === 'heatmap' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}}>🔥 Sectors</button>
            <button onClick={() => setActiveView('industries')} style={{...tabStyle, backgroundColor: activeView === 'industries' ? t.bgPanel : 'transparent', color: activeView === 'industries' ? t.textMain : t.textMuted, boxShadow: activeView === 'industries' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}}>🏭 Industries</button>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} style={{ padding: '6px 12px', borderRadius: '20px', backgroundColor: t.bgApp, color: t.textMain, border: `1px solid ${t.border}`, cursor: 'pointer', fontWeight: 'bold', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s' }}>
            {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
          </button>
          <div style={{ fontWeight: '600', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: t.textMuted }}>
            <span style={{ width: '8px', height: '8px', backgroundColor: '#10b981', borderRadius: '50%', display: 'inline-block' }}></span>
            LIVE DATA READY
          </div>
        </div>
      </header>

      {activeView === 'scanner' ? (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          
          <div style={{ width: '340px', minWidth: '340px', backgroundColor: t.bgPanel, borderRight: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', transition: 'all 0.3s' }}>
            
            <div style={{ padding: '20px 15px', display: 'flex', flexDirection: 'column', gap: '12px', borderBottom: `1px solid ${t.border}` }}>
              <button onClick={handleScan} style={{ padding: '12px', backgroundColor: t.btnPrimaryBg, color: t.btnPrimaryText, border: 'none', borderRadius: '6px', fontWeight: '700', fontSize: '14px', cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseEnter={e => e.target.style.opacity = 0.9} onMouseLeave={e => e.target.style.opacity = 1}>Scan Active Crosses</button>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={handleSelectAll} style={{ padding: '10px', backgroundColor: t.btnSuccessBg, color: t.btnSuccessText, border: `1px solid ${t.btnSuccessBorder}`, borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', flex: 1 }}>Select All</button>
                <button onClick={handleClear} style={{ padding: '10px', backgroundColor: t.btnDangerBg, color: t.btnDangerText, border: `1px solid ${t.btnDangerBorder}`, borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', flex: 1 }}>Clear All</button>
              </div>
            </div>
            
            <div style={{ flex: 1, overflow: 'auto', padding: '15px' }}>
              {Object.keys(hierarchy).map(s => (
                <div key={s} style={{ marginBottom: '18px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', fontSize: '14px', cursor: 'pointer', marginBottom: '8px' }}>
                    <input type="checkbox" style={{ accentColor: t.btnPrimaryBg, width: '16px', height: '16px' }} onChange={() => {
                      const inds = hierarchy[s];
                      const allSel = inds.every(i => selectedIndustries.includes(i));
                      setSelectedIndustries(prev => allSel ? prev.filter(i => !inds.includes(i)) : [...new Set([...prev, ...inds])]);
                    }} checked={hierarchy[s].every(i => selectedIndustries.includes(i))} /> {s}
                  </label>
                  {hierarchy[s].map(i => (
                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '24px', marginTop: '6px', fontSize: '13px', color: t.textMuted, cursor: 'pointer' }}>
                      <input type="checkbox" style={{ accentColor: t.btnPrimaryBg, width: '14px', height: '14px' }} checked={selectedIndustries.includes(i)} onChange={() => setSelectedIndustries(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])} /> {i}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', width: 'calc(100vw - 340px)', backgroundColor: t.bgPanel, margin: '15px', borderRadius: '10px', border: `1px solid ${t.border}`, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', transition: 'all 0.3s' }}>
            
            <div style={{ padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${t.border}`, backgroundColor: t.bgApp, position: 'relative', zIndex: 20 }}>
              <div style={{ fontWeight: '700', fontSize: '16px' }}>
                Scan Results <span style={{ fontWeight: '500', color: t.textMuted, fontSize: '14px' }}>({sortedStocks.length})</span>
              </div>
              <input
                type="text"
                placeholder="🔍 Search symbols, dates, industries..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ padding: '8px 16px', borderRadius: '6px', border: `1px solid ${t.border}`, width: '320px', outline: 'none', fontSize: '13px', backgroundColor: t.inputBg, color: t.textMain, transition: 'border 0.2s' }}
                onFocus={(e) => e.target.style.borderColor = t.btnPrimaryBg}
                onBlur={(e) => e.target.style.borderColor = t.border}
              />
            </div>

            <div style={{ ...gridRowStyle, padding: '16px 0', borderBottom: `2px solid ${t.border}`, fontWeight: '700', fontSize: '13px', color: t.textMuted, backgroundColor: t.bgPanel, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.5px', position: 'sticky', top: 0, zIndex: 10 }}>
              <div onClick={() => toggleSort('fyers_symbol')} style={headerSortStyle}>Ticker ⇅</div>
              <div onClick={() => toggleSort('rs_score')} style={headerSortStyle}>RS Score ⇅</div>
              <div onClick={() => toggleSort('daily_cross_date')} style={headerSortStyle}>Daily Cross ⇅</div>
              <div onClick={() => toggleSort('first_15m_cross_time')} style={headerSortStyle}>15m Pullback ⇅</div>
              <div onClick={() => toggleSort('first_1h_cross_time')} style={headerSortStyle}>1H Pullback ⇅</div>
              <div onClick={() => toggleSort('industry')} style={headerSortStyle}>Industry ⇅</div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? <div style={{textAlign:'center', padding:'60px', fontSize:'15px', color: t.textMuted}}>Analyzing the Vault...</div> : 
                stocks.length === 0 ? <div style={{textAlign:'center', padding:'60px', fontSize:'15px', color: t.textMuted}}>Select industries from the sidebar and click Scan.</div> :
                sortedStocks.length === 0 ? <div style={{textAlign:'center', padding:'60px', fontSize:'15px', color: t.rsNegText}}>No records match your search query.</div> :
                sortedStocks.map((s, idx) => (
                <div key={idx} style={{ ...gridRowStyle, padding: '16px 0', borderBottom: `1px solid ${t.border}`, fontSize: '14px', transition: 'background-color 0.2s', cursor: 'default' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = t.hover} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  
                  <div style={{fontSize: '14px', fontWeight:'800', color: t.textTicker}}>{s.fyers_symbol.split(':')[1].replace('-EQ','')}</div>
                  
                  {/* RS SCORE: Kept colorful so it stands out */}
                  <div style={{ fontWeight: '800', color: s.rs_score > 0 ? t.rsPosText : t.rsNegText, backgroundColor: s.rs_score > 0 ? t.rsPosBg : t.rsNegBg, padding: '4px 8px', borderRadius: '4px', display: 'inline-block', margin: '0 auto' }}>
                    {s.rs_score !== null ? (s.rs_score > 0 ? `+${s.rs_score}` : s.rs_score) : "--"}
                  </div>
                  
                  <div style={{color: t.textMuted, fontWeight: '600'}}>{formatDT(s.daily_cross_date)}</div>
                  <div style={{display:'flex', justifyContent:'center', gap:'6px', color: t.textMuted, fontWeight: '600'}}>
                    {s.first_15m_cross_time ? <><PullbackIcon color={t.icon15m} /> {formatDT(s.first_15m_cross_time)}</> : "--"}
                  </div>
                  <div style={{display:'flex', justifyContent:'center', gap:'6px', color: t.textMuted, fontWeight: '600'}}>
                    {s.first_1h_cross_time ? <><PullbackIcon color={t.icon1h} /> {formatDT(s.first_1h_cross_time)}</> : "--"}
                  </div>
                  <div style={{ fontSize: '13px', fontWeight:'600', color: t.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 15px' }} title={s.industry}>{s.industry}</div>
                </div>
              ))}
            </div>
          </main>
        </div>
      ) : activeView === 'heatmap' ? (
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: t.bgApp }}>
          <SectorHeatmap onScanNavigate={triggerScanFromHeatmap} theme={theme} />
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: t.bgApp }}>
          <IndustryHeatmap onScanNavigate={triggerScanFromHeatmap} theme={theme} />
        </div>
      )}
    </div>
  );
}

const PullbackIcon = ({ color }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
    <path d="M4 16C10 14.5 14 13 20 11.5" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <path d="M4 8C10 10 14 16 20 20" stroke={color} strokeOpacity="0.4" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export default App;
