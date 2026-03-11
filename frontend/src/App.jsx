import React, { useState, useEffect, useMemo } from 'react';
import SectorHeatmap from './components/SectorHeatmap';
import IndustryHeatmap from './components/IndustryHeatmap';

function App() {
  const [hierarchy, setHierarchy] = useState({});
  const [selectedIndustries, setSelectedIndustries] = useState([]);
  const [selectedFundamentals, setSelectedFundamentals] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'rs_score', direction: 'desc' });
  const [activeView, setActiveView] = useState('scanner'); 
  const [searchTerm, setSearchTerm] = useState('');
  const [theme, setTheme] = useState('light');
  
  const [activeChart, setActiveChart] = useState(null);

  useEffect(() => {
    fetch('https://algo-scanner-lnck.onrender.com/api/filters')
      .then(res => res.json())
      .then(res => setHierarchy(res.data || {})) 
      .catch(err => { console.error("Filter Error:", err); setHierarchy({}); });
  }, []);

  const handleScan = () => {
    if (selectedIndustries.length === 0 && selectedFundamentals.length === 0) return;
    setLoading(true);
    fetch('https://algo-scanner-lnck.onrender.com/api/stocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industries: selectedIndustries, fundamentals: selectedFundamentals })
    }).then(res => res.json())
      .then(res => { setStocks(res.data || []); setLoading(false); })
      .catch(err => { console.error("Scan Error:", err); setStocks([]); setLoading(false); });
  };

  const triggerScanFromHeatmap = (industriesToScan) => {
    setSelectedIndustries(industriesToScan);
    setActiveView('scanner');
    setActiveChart(null); // 🛡️ HIDDEN BUG FIX: Clears the chart so you don't look at a stale stock
    setLoading(true);
    fetch('https://algo-scanner-lnck.onrender.com/api/stocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industries: industriesToScan, fundamentals: selectedFundamentals })
    }).then(res => res.json())
      .then(res => { setStocks(res.data || []); setLoading(false); })
      .catch(err => { console.error("Scan Error:", err); setStocks([]); setLoading(false); });
  };

  const handleSelectAll = () => {
    // 🛡️ FIX: Now selects both all industries and all fundamentals
    setSelectedIndustries(Object.values(hierarchy).flat());
    setSelectedFundamentals(['high_growth', 'moderate_growth']);
  };
  
  const handleClear = () => {
    setSelectedIndustries([]);
    setSelectedFundamentals([]); 
    setStocks([]);
    setSearchTerm(''); 
    setActiveChart(null); 
  };

  const handleExportCSV = () => {
    if (sortedStocks.length === 0) return;

    const headers = ["Ticker", "Sector", "Industry", "RS Score", "Daily Cross Date", "1H Pullback Time", "15M Pullback Time"];
    
    const csvRows = sortedStocks.map(stock => {
      const cleanSymbol = stock.fyers_symbol ? stock.fyers_symbol.split(':')[1].replace('-EQ','') : '--';
      const mappedSector = Object.keys(hierarchy).find(sector => 
        hierarchy[sector].includes(stock.industry)
      ) || '--';
      
      return [
        cleanSymbol,
        `"${mappedSector}"`,
        `"${stock.industry || '--'}"`,
        stock.rs_score !== null ? stock.rs_score : '--',
        stock.daily_cross_date || '--',
        stock.first_1h_cross_time || '--',
        stock.first_15m_cross_time || '--'
      ].join(',');
    });

    const csvString = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ChartHawks_Scan_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
      // 🛡️ HIDDEN BUG FIX: Added || '' to prevent silent crashes if a database column is NULL
      Object.values(stock).some(val => String(val || '').toLowerCase().includes(lowerSearch))
    );
  }, [stocks, searchTerm]);

  const sortedStocks = useMemo(() => {
    let items = [...filteredStocks]; 
    if (sortConfig.key) {
      items.sort((a, b) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];

        const isDateColumn = ['daily_cross_date', 'first_15m_cross_time', 'first_1h_cross_time'].includes(sortConfig.key);

        if (isDateColumn) {
          valA = (valA && valA !== "--") ? new Date(valA).getTime() : (sortConfig.direction === 'asc' ? Infinity : -Infinity);
          valB = (valB && valB !== "--") ? new Date(valB).getTime() : (sortConfig.direction === 'asc' ? Infinity : -Infinity);
        } else {
          valA = valA ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
          valB = valB ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
          
          if (typeof valA === 'string' && typeof valB === 'string' && valA !== Infinity && valB !== Infinity) {
              return sortConfig.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
          }
        }

        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return items;
  }, [filteredStocks, sortConfig]);

  const toggleSort = (key) => setSortConfig({ key, direction: sortConfig.key === key && sortConfig.direction === 'desc' ? 'asc' : 'desc' });

  const themes = {
    light: {  
      bgApp: '#f1f5f9', bgPanel: '#ffffff', textMain: '#0f172a', textTicker: '#64748b', textMuted: '#64748b', 
      border: '#e2e8f0', hover: '#f8fafc', inputBg: '#ffffff', btnPrimaryBg: '#2563eb', btnPrimaryText: '#ffffff',
      btnSuccessBg: '#dcfce7', btnSuccessText: '#15803d', btnSuccessBorder: '#bbf7d0',
      btnDangerBg: '#fee2e2', btnDangerText: '#b91c1c', btnDangerBorder: '#fecaca',
      rsPosBg: '#ecfdf5', rsPosText: '#059669', rsNegBg: '#fef2f2', rsNegText: '#dc2626',
      icon15m: '#8b5cf6', icon1h: '#3b82f6'
    },
    dark: {
      bgApp: '#020617', bgPanel: '#0f172a', textMain: '#f8fafc', textTicker: '#38bdf8', textMuted: '#cbd5e1',
      border: '#1e293b', hover: '#1e293b', inputBg: '#020617', btnPrimaryBg: '#3b82f6', btnPrimaryText: '#ffffff',
      btnSuccessBg: 'rgba(34, 197, 94, 0.2)', btnSuccessText: '#4ade80', btnSuccessBorder: 'rgba(34, 197, 94, 0.4)',
      btnDangerBg: 'rgba(239, 68, 68, 0.2)', btnDangerText: '#f87171', btnDangerBorder: 'rgba(239, 68, 68, 0.4)',
      rsPosBg: 'rgba(16, 185, 129, 0.2)', rsPosText: '#34d399', rsNegBg: 'rgba(244, 63, 94, 0.2)', rsNegText: '#fb7185',
      icon15m: '#a78bfa', icon1h: '#60a5fa'
    }
  };
  const t = themes[theme]; 

  const gridRowStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1.8fr', width: '100%', alignItems: 'center', textAlign: 'center' };
  const headerSortStyle = { cursor: 'pointer', userSelect: 'none', transition: 'color 0.2s' };
  const tabStyle = { padding: '6px 16px', borderRadius: '6px', border: 'none', fontWeight: '700', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s' }; 
  const isScanDisabled = selectedIndustries.length === 0 && selectedFundamentals.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden', fontFamily: 'Inter, sans-serif', backgroundColor: t.bgApp, color: t.textMain, transition: 'background-color 0.3s' }}>
      
      <header style={{ height: '65px', backgroundColor: t.bgPanel, padding: '0 25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${t.border}`, flexShrink: 0, position: 'relative', zIndex: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '900', letterSpacing: '-0.5px' }}>CHART HAWKS</h1>
          <div style={{ display: 'flex', backgroundColor: t.bgApp, borderRadius: '8px', padding: '4px' }}>
            <button onClick={() => setActiveView('scanner')} style={{...tabStyle, backgroundColor: activeView === 'scanner' ? t.bgPanel : 'transparent', color: activeView === 'scanner' ? t.textMain : t.textMuted}}>📊 Scanner</button>
            <button onClick={() => setActiveView('heatmap')} style={{...tabStyle, backgroundColor: activeView === 'heatmap' ? t.bgPanel : 'transparent', color: activeView === 'heatmap' ? t.textMain : t.textMuted}}>🔥 Sectors</button>
            <button onClick={() => setActiveView('industries')} style={{...tabStyle, backgroundColor: activeView === 'industries' ? t.bgPanel : 'transparent', color: activeView === 'industries' ? t.textMain : t.textMuted}}>🏭 Industries</button>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} style={{ padding: '6px 12px', borderRadius: '20px', backgroundColor: t.bgApp, color: t.textMain, border: `1px solid ${t.border}`, cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
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
          <div style={{ width: '340px', minWidth: '340px', backgroundColor: t.bgPanel, borderRight: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 15px', display: 'flex', flexDirection: 'column', gap: '12px', borderBottom: `1px solid ${t.border}` }}>
              <button 
                onClick={handleScan} 
                disabled={isScanDisabled}
                style={{ padding: '12px', backgroundColor: isScanDisabled ? t.border : t.btnPrimaryBg, color: isScanDisabled ? t.textMuted : t.btnPrimaryText, border: 'none', borderRadius: '6px', fontWeight: '700', fontSize: '14px', cursor: isScanDisabled ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}
              >
                {isScanDisabled ? "Select Filters to Scan" : "Scan Active Crosses"}
              </button>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={handleSelectAll} style={{ padding: '10px', backgroundColor: t.btnSuccessBg, color: t.btnSuccessText, border: `1px solid ${t.btnSuccessBorder}`, borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', flex: 1 }}>Select All</button>
                <button onClick={handleClear} style={{ padding: '10px', backgroundColor: t.btnDangerBg, color: t.btnDangerText, border: `1px solid ${t.btnDangerBorder}`, borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', flex: 1 }}>Clear All</button>
              </div>
            </div>
            
            <div style={{ flex: 1, overflow: 'auto' }}>
              
              <div style={{ padding: '15px', borderBottom: `2px solid ${t.border}`, backgroundColor: theme === 'dark' ? '#0f172a' : '#f8fafc' }}>
                <div style={{ fontWeight: '800', fontSize: '12px', color: t.textMuted, textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.5px' }}>Fundamental Filters</div>
                
                {/* 🛡️ UI FIX: Font size and weight perfectly mirror the sector checkboxes */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', fontSize: '14px', cursor: 'pointer', marginBottom: '10px' }}>
                  <input 
                    type="checkbox" 
                    style={{ accentColor: t.btnPrimaryBg }} 
                    checked={selectedFundamentals.includes('high_growth')}
                    onChange={() => setSelectedFundamentals(prev => prev.includes('high_growth') ? prev.filter(x => x !== 'high_growth') : [...prev, 'high_growth'])} 
                  /> 
                  🚀 High Growth (ROCE)
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', fontSize: '14px', cursor: 'pointer', marginBottom: '8px' }}>
                  <input 
                    type="checkbox" 
                    style={{ accentColor: t.btnPrimaryBg }} 
                    checked={selectedFundamentals.includes('moderate_growth')}
                    onChange={() => setSelectedFundamentals(prev => prev.includes('moderate_growth') ? prev.filter(x => x !== 'moderate_growth') : [...prev, 'moderate_growth'])} 
                  /> 
                  📈 Moderate Growth (ROCE)
                </label>
              </div>

              <div style={{ padding: '15px' }}>
                <div style={{ fontWeight: '800', fontSize: '12px', color: t.textMuted, textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.5px' }}>Sectors & Industries</div>
                {Object.keys(hierarchy).map(s => (
                  <div key={s} style={{ marginBottom: '18px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>
                      <input type="checkbox" style={{ accentColor: t.btnPrimaryBg }} onChange={() => {
                        const inds = hierarchy[s];
                        const allSel = inds.every(i => selectedIndustries.includes(i));
                        setSelectedIndustries(prev => allSel ? prev.filter(i => !inds.includes(i)) : [...new Set([...prev, ...inds])]);
                      }} checked={hierarchy[s]?.every(i => selectedIndustries.includes(i))} /> {s}
                    </label>
                    {hierarchy[s].map(i => (
                      <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '24px', marginTop: '6px', fontSize: '13px', color: t.textMuted, cursor: 'pointer' }}>
                        <input type="checkbox" style={{ accentColor: t.btnPrimaryBg }} checked={selectedIndustries.includes(i)} onChange={() => setSelectedIndustries(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])} /> {i}
                      </label>
                    ))}
                  </div>
                ))}
              </div>

            </div>
          </div>

          <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: t.bgPanel, margin: '15px', borderRadius: '10px', border: `1px solid ${t.border}` }}>
            <div style={{ padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${t.border}`, backgroundColor: t.bgApp }}>
              <div style={{ fontWeight: '700', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div>Scan Results ({sortedStocks.length})</div>
                {sortedStocks.length > 0 && (
                  <button onClick={handleExportCSV} style={{ padding: '4px 12px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>📥 Export CSV</button>
                )}
              </div>
              <input type="text" placeholder="🔍 Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ padding: '8px 16px', borderRadius: '6px', border: `1px solid ${t.border}`, width: '300px', backgroundColor: t.inputBg, color: t.textMain }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              
              <div style={{ display: 'flex', flexDirection: 'column', flex: activeChart ? '0 0 50%' : '1 1 100%', overflow: 'hidden', transition: 'flex 0.3s ease' }}>
                <div style={{ ...gridRowStyle, padding: '16px 0', borderBottom: `2px solid ${t.border}`, fontWeight: '900', fontSize: '14px', color: t.textMuted, backgroundColor: t.bgPanel, position: 'sticky', top: 0, zIndex: 10 }}>
                  <div onClick={() => toggleSort('fyers_symbol')} style={headerSortStyle}>Ticker ⇅</div>
                  <div onClick={() => toggleSort('rs_score')} style={headerSortStyle}>RS Score ⇅</div>
                  <div onClick={() => toggleSort('daily_cross_date')} style={headerSortStyle}>Daily Cross ⇅</div>
                  <div onClick={() => toggleSort('first_15m_cross_time')} style={headerSortStyle}>15m Pullback ⇅</div>
                  <div onClick={() => toggleSort('first_1h_cross_time')} style={headerSortStyle}>1H Pullback ⇅</div>
                  <div onClick={() => toggleSort('industry')} style={headerSortStyle}>Industry & Sector ⇅</div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {loading ? <div style={{textAlign:'center', padding:'60px'}}>Scanning...</div> : 
                    sortedStocks.map((s, idx) => {
                      const mappedSector = Object.keys(hierarchy).find(sector => hierarchy[sector].includes(s.industry)) || '--';
                      const cleanTicker = s.fyers_symbol ? s.fyers_symbol.split(':')[1].replace('-EQ','') : '';
                      const bseSymbol = `BSE:${cleanTicker}`;
                      const isRowActive = activeChart === bseSymbol;

                      return (
                        <div 
                          key={idx} 
                          onClick={() => { if(cleanTicker) setActiveChart(bseSymbol); }}
                          style={{ 
                            ...gridRowStyle, 
                            padding: '16px 0', 
                            borderBottom: `1px solid ${t.border}`, 
                            fontSize: '14px',
                            cursor: 'pointer',
                            backgroundColor: isRowActive ? (theme === 'dark' ? '#1e293b' : '#f1f5f9') : 'transparent',
                            transition: 'background-color 0.15s ease'
                          }}
                          onMouseEnter={(e) => { if(!isRowActive) e.currentTarget.style.backgroundColor = t.hover }}
                          onMouseLeave={(e) => { if(!isRowActive) e.currentTarget.style.backgroundColor = 'transparent' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <div style={{fontWeight:'800', color: isRowActive ? '#3b82f6' : t.textTicker}}>{cleanTicker || '--'}</div>
                          </div>

                          <div style={{ fontWeight: '800', color: s.rs_score > 0 ? t.rsPosText : t.rsNegText, backgroundColor: s.rs_score > 0 ? t.rsPosBg : t.rsNegBg, padding: '4px 8px', borderRadius: '4px', display: 'inline-block', margin: '0 auto' }}>{s.rs_score ?? "--"}</div>
                          
                          <div style={{ color: t.textTicker, fontWeight: '700' }}>{formatDT(s.daily_cross_date)}</div>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', color: t.textTicker, fontWeight: '700' }}>{s.first_15m_cross_time ? <><PullbackIcon color={t.icon15m}/>{formatDT(s.first_15m_cross_time)}</> : "--"}</div>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', color: t.textTicker, fontWeight: '700' }}>{s.first_1h_cross_time ? <><PullbackIcon color={t.icon1h}/>{formatDT(s.first_1h_cross_time)}</> : "--"}</div>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 10px', textAlign: 'center' }}>
                            <div style={{ fontSize: '13px', fontWeight: '700', color: t.textTicker, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.industry}>{s.industry}</div>
                            <div style={{ fontSize: '10px', color: t.textMuted, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>in {mappedSector}</div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {activeChart && (
                <div style={{ flex: '1 1 50%', display: 'flex', flexDirection: 'column', borderTop: `3px solid ${t.border}`, backgroundColor: t.bgPanel }}>
                  <div style={{ padding: '8px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: t.bgApp, borderBottom: `1px solid ${t.border}` }}>
                    <div style={{ fontWeight: '800', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                      📊 {activeChart.replace('BSE:', '')}
                    </div>
                    <button 
                      onClick={() => setActiveChart(null)} 
                      style={{ background: 'transparent', border: 'none', color: t.textMuted, cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                    >
                      Close Split View ✖
                    </button>
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <TVChart key={activeChart + theme} symbol={activeChart} theme={theme} />
                  </div>
                </div>
              )}

            </div>
          </main>
        </div>
      ) : activeView === 'heatmap' ? (
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: t.bgApp, position: 'relative' }}>
          <SectorHeatmap onScanNavigate={triggerScanFromHeatmap} theme={theme} />
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: t.bgApp, position: 'relative' }}>
          <IndustryHeatmap onScanNavigate={triggerScanFromHeatmap} theme={theme} />
        </div>
      )}
    </div>
  );
}

const PullbackIcon = ({ color }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 16C10 14.5 14 13 20 11.5" stroke={color} strokeWidth="3" strokeLinecap="round" /><path d="M4 8C10 10 14 16 20 20" stroke={color} strokeOpacity="0.4" strokeWidth="3" strokeLinecap="round" /></svg>
);

const TVChart = ({ symbol, theme }) => {
  useEffect(() => {
    const containerId = 'tv_chart_container';
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = ''; 

    const loadChart = () => {
      if (window.TradingView) {
        new window.TradingView.widget({
          autosize: true,
          symbol: symbol,
          interval: "D",
          timezone: "Asia/Kolkata",
          theme: theme,
          style: "1",
          locale: "en",
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          container_id: containerId,
          studies: [
            { id: "MAExp@tv-basicstudies", inputs: { length: 20 } },
            { id: "MAExp@tv-basicstudies", inputs: { length: 50 } },
            { id: "MASimple@tv-basicstudies", inputs: { length: 200 } }
          ]
        });
      }
    };

    if (typeof window.TradingView === 'undefined') {
      const script = document.createElement('script');
      script.id = 'tv-js-script';
      script.src = 'https://s3.tradingview.com/tv.js';
      script.async = true;
      script.onload = loadChart;
      document.body.appendChild(script);
    } else {
      loadChart();
    }
  }, []); 

  return <div id="tv_chart_container" style={{ width: '100%', height: '100%' }} />;
};

export default App;