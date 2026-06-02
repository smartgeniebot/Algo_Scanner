import React, { useState, useEffect, useMemo } from 'react';
import SectorHeatmap from './components/SectorHeatmap';
import IndustryHeatmap from './components/IndustryHeatmap';
import MicroIndustryHeatmap from './components/MicroIndustryHeatmap';
import StocksDirectory from './components/StocksDirectory';
import FilterTree from './components/FilterTree';
import RSRatioReport from './components/RSRatioReport';

function App() {
  const [hierarchy, setHierarchy] = useState({});
  const [selectedMicros, setSelectedMicros] = useState(new Set());
  const [selectedFundamentals, setSelectedFundamentals] = useState([]);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'rs_score', direction: 'desc' });
  const [activeView, setActiveView] = useState('scanner'); 
  const [searchTerm, setSearchTerm] = useState('');
  const [theme, setTheme] = useState('light');
  
  const [activeChart, setActiveChart] = useState(null);

  const [fyersWlStatus, setFyersWlStatus] = useState('idle');

  const [weeklyEmaFilter, setWeeklyEmaFilter] = useState(() => {
    const stored = localStorage.getItem('weeklyEmaFilter');
    return stored === null ? true : stored === 'true';
  });

  const [triggerStatus, setTriggerStatus] = useState('idle');
  const [triggerLog, setTriggerLog] = useState([]);
  const [intradayStatus, setIntradayStatus] = useState('idle');
  const [intradayLog, setIntradayLog] = useState([]);
  const [refreshTickerStatus, setRefreshTickerStatus] = useState('idle');
  const [refreshLog, setRefreshLog] = useState([]);

  const [firstDailyBase, setFirstDailyBase] = useState([]);
  const [fdbLoading, setFdbLoading] = useState(false);
  const [fdbSearch, setFdbSearch] = useState('');
  const [fdbSort, setFdbSort] = useState({ key: 'signal_date', direction: 'desc' });

  const [fdbTriggerStatus, setFdbTriggerStatus] = useState('idle');
  const [fdbTriggerLog, setFdbTriggerLog] = useState([]);
  useEffect(() => {
    fetch('https://algo-scanner-lnck.onrender.com/api/filters')
      .then(res => res.json())
      .then(res => setHierarchy(res.data || {}))
      .catch(err => { console.error("Filter Error:", err); setHierarchy({}); });
  }, []);

  useEffect(() => {
    if (activeView !== 'firstdailybase') return;
    setFdbLoading(true);
    fetch('https://algo-scanner-lnck.onrender.com/api/first-daily-base')
      .then(r => r.json())
      .then(res => { setFirstDailyBase(res.data || []); setFdbLoading(false); })
      .catch(() => { setFirstDailyBase([]); setFdbLoading(false); });
  }, [activeView]);

  const doScan = (micros, fundamentals) => {
    setLoading(true);
    fetch('https://algo-scanner-lnck.onrender.com/api/stocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industries: [], basic_industries: [...micros], fundamentals, weekly_ema_filter: weeklyEmaFilter })
    }).then(r => r.json())
      .then(res => { setStocks(res.data || []); setLoading(false); })
      .catch(err => { console.error("Scan Error:", err); setStocks([]); setLoading(false); });
  };

  const handleScan = () => {
    if (selectedMicros.size === 0 && selectedFundamentals.length === 0) return;
    doScan(selectedMicros, selectedFundamentals);
  };

  const triggerScanFromHeatmap = (itemsToScan, level = 'macro') => {
    setActiveView('scanner');
    setActiveChart(null);
    setLoading(true);

    let body;
    if (level === 'micro') {
      setSelectedMicros(new Set(itemsToScan));
      body = { industries: [], basic_industries: itemsToScan, fundamentals: selectedFundamentals };
    } else {
      const micros = new Set();
      Object.values(hierarchy).forEach(macros =>
        Object.entries(macros).forEach(([macro, microList]) => {
          if (itemsToScan.includes(macro)) microList.forEach(mi => micros.add(mi));
        })
      );
      setSelectedMicros(micros);
      body = { industries: itemsToScan, basic_industries: [], fundamentals: selectedFundamentals };
    }

    fetch('https://algo-scanner-lnck.onrender.com/api/stocks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, weekly_ema_filter: weeklyEmaFilter })
    }).then(r => r.json())
      .then(res => { setStocks(res.data || []); setLoading(false); })
      .catch(err => { console.error("Scan Error:", err); setStocks([]); setLoading(false); });
  };

  const handleSelectAll = () => {
    const all = new Set();
    Object.values(hierarchy).forEach(macros =>
      Object.values(macros).forEach(micros => micros.forEach(mi => all.add(mi)))
    );
    setSelectedMicros(all);
    setSelectedFundamentals(['high_growth', 'moderate_growth']);
  };

  const handleClear = () => {
    setSelectedMicros(new Set());
    setSelectedFundamentals([]);
    setStocks([]);
    setSearchTerm('');
    setActiveChart(null);
  };

  const handleTriggerEngine = async () => {
    setTriggerStatus('loading');
    setTriggerLog([]);
    const log = (msg) => setTriggerLog(prev => [...prev, msg]);

    log('🚀 Triggering Full Data Fetch via GitHub Actions...');
    try {
      const r = await fetch('https://algo-scanner-lnck.onrender.com/api/trigger-scan', { method: 'POST' });
      const d = await r.json();
      if (d.status !== 'success') { log(`❌ ${d.message}`); setTriggerStatus('error'); return; }
    } catch (e) { log(`❌ Network error: ${e.message}`); setTriggerStatus('error'); return; }

    log('  ↳ Workflow triggered — waiting for GitHub Actions to start...');
    let lastId = 0;

    const progressInterval = setInterval(async () => {
      try {
        const r = await fetch(`https://algo-scanner-lnck.onrender.com/api/scan-progress?since_id=${lastId}`);
        const d = await r.json();
        if (d.lines && d.lines.length > 0) {
          d.lines.forEach(({ id, line }) => { log(line); lastId = id; });
        }
      } catch (_) {}
    }, 3000);

    await new Promise((resolve, reject) => {
      const ghInterval = setInterval(async () => {
        try {
          const r = await fetch('https://algo-scanner-lnck.onrender.com/api/scan-status');
          const d = await r.json();
          if (d.status === 'completed') {
            clearInterval(ghInterval);
            setTimeout(async () => {
              try {
                const r2 = await fetch(`https://algo-scanner-lnck.onrender.com/api/scan-progress?since_id=${lastId}`);
                const d2 = await r2.json();
                if (d2.lines && d2.lines.length > 0) d2.lines.forEach(({ line }) => log(line));
              } catch (_) {}
              clearInterval(progressInterval);
              d.conclusion === 'success' ? resolve() : reject(new Error(d.conclusion));
            }, 4000);
          }
        } catch (_) {}
      }, 15000);
    }).then(() => {
      setTriggerStatus('success');
    }).catch((e) => {
      log(`❌ Workflow failed (${e.message}). Check GitHub Actions for details.`);
      clearInterval(progressInterval);
      setTriggerStatus('error');
    });
  };

  const handleTriggerIntraday = async () => {
    setIntradayStatus('loading');
    setIntradayLog([]);
    const log = (msg) => setIntradayLog(prev => [...prev, msg]);

    log('⚡ Triggering Intraday Pulse via GitHub Actions...');
    try {
      const r = await fetch('https://algo-scanner-lnck.onrender.com/api/trigger-intraday', { method: 'POST' });
      const d = await r.json();
      if (d.status !== 'success') { log(`❌ ${d.message}`); setIntradayStatus('error'); return; }
    } catch (e) { log(`❌ Network error: ${e.message}`); setIntradayStatus('error'); return; }

    log('  ↳ Workflow triggered — waiting for GitHub Actions to start...');
    let lastId = 0;

    const progressInterval = setInterval(async () => {
      try {
        const r = await fetch(`https://algo-scanner-lnck.onrender.com/api/intraday-progress?since_id=${lastId}`);
        const d = await r.json();
        if (d.lines && d.lines.length > 0) {
          d.lines.forEach(({ id, line }) => { log(line); lastId = id; });
        }
      } catch (_) {}
    }, 3000);

    await new Promise((resolve, reject) => {
      const ghInterval = setInterval(async () => {
        try {
          const r = await fetch('https://algo-scanner-lnck.onrender.com/api/intraday-status');
          const d = await r.json();
          if (d.status === 'completed') {
            clearInterval(ghInterval);
            setTimeout(async () => {
              try {
                const r2 = await fetch(`https://algo-scanner-lnck.onrender.com/api/intraday-progress?since_id=${lastId}`);
                const d2 = await r2.json();
                if (d2.lines && d2.lines.length > 0) d2.lines.forEach(({ line }) => log(line));
              } catch (_) {}
              clearInterval(progressInterval);
              d.conclusion === 'success' ? resolve() : reject(new Error(d.conclusion));
            }, 4000);
          }
        } catch (_) {}
      }, 15000);
    }).then(() => {
      setIntradayStatus('success');
    }).catch((e) => {
      log(`❌ Workflow failed (${e.message}). Check GitHub Actions for details.`);
      clearInterval(progressInterval);
      setIntradayStatus('error');
    });
  };

  const handleRefreshNseTickers = async () => {
    setRefreshTickerStatus('loading');
    setRefreshLog([]);
    const log = (msg) => setRefreshLog(prev => [...prev, msg]);

    log('🚀 Triggering stock list sync via GitHub Actions...');
    try {
      const r = await fetch('https://algo-scanner-lnck.onrender.com/api/refresh-nse-tickers', { method: 'POST' });
      const d = await r.json();
      if (d.status !== 'triggered') { log(`❌ ${d.message}`); setRefreshTickerStatus('error'); return; }
    } catch (e) { log(`❌ Network error: ${e.message}`); setRefreshTickerStatus('error'); return; }

    log('  ↳ Workflow triggered — waiting for GitHub Actions to start...');

    let lastId = 0;

    // Poll job_progress every 3s for live script output
    const progressInterval = setInterval(async () => {
      try {
        const r = await fetch(`https://algo-scanner-lnck.onrender.com/api/refresh-progress?since_id=${lastId}`);
        const d = await r.json();
        if (d.lines && d.lines.length > 0) {
          d.lines.forEach(({ id, line }) => {
            log(line);
            lastId = id;
          });
        }
      } catch (_) {}
    }, 3000);

    // Poll GitHub Actions status every 15s to detect completion
    await new Promise((resolve, reject) => {
      const ghInterval = setInterval(async () => {
        try {
          const r = await fetch('https://algo-scanner-lnck.onrender.com/api/refresh-nse-status');
          const d = await r.json();
          if (d.status === 'completed') {
            clearInterval(ghInterval);
            // Give progress poller one final pass to catch last lines
            setTimeout(async () => {
              try {
                const r2 = await fetch(`https://algo-scanner-lnck.onrender.com/api/refresh-progress?since_id=${lastId}`);
                const d2 = await r2.json();
                if (d2.lines && d2.lines.length > 0) {
                  d2.lines.forEach(({ line }) => log(line));
                }
              } catch (_) {}
              clearInterval(progressInterval);
              d.conclusion === 'success' ? resolve() : reject(new Error(d.conclusion));
            }, 4000);
          }
        } catch (_) {}
      }, 15000);
    }).then(() => {
      setRefreshTickerStatus('success');
    }).catch((e) => {
      log(`❌ Workflow failed (${e.message}). Check GitHub Actions for details.`);
      clearInterval(progressInterval);
      setRefreshTickerStatus('error');
    });
  };


  const handleTriggerFirstDailyBase = async () => {
    setFdbTriggerStatus('loading');
    setFdbTriggerLog([]);
    const log = (msg) => setFdbTriggerLog(prev => [...prev, msg]);

    log('🏛️ Triggering 1st Daily Base Scan via GitHub Actions...');
    try {
      const r = await fetch('https://algo-scanner-lnck.onrender.com/api/trigger-first-daily-base', { method: 'POST' });
      const d = await r.json();
      if (d.status !== 'success') { log(`❌ ${d.message || 'Unknown error — endpoint may not be deployed yet'}`); setFdbTriggerStatus('error'); return; }
    } catch (e) { log(`❌ Network error: ${e.message} — deploy the latest backend to Render first`); setFdbTriggerStatus('error'); return; }

    log('  ↳ Workflow triggered — waiting for GitHub Actions to start...');
    let lastId = 0;

    const progressInterval = setInterval(async () => {
      try {
        const r = await fetch(`https://algo-scanner-lnck.onrender.com/api/first-daily-base-progress?since_id=${lastId}`);
        const d = await r.json();
        if (d.lines && d.lines.length > 0) {
          d.lines.forEach(({ id, line }) => { log(line); lastId = id; });
        }
      } catch (_) {}
    }, 3000);

    await new Promise((resolve, reject) => {
      const ghInterval = setInterval(async () => {
        try {
          const r = await fetch('https://algo-scanner-lnck.onrender.com/api/first-daily-base-status');
          const d = await r.json();
          if (d.status === 'completed') {
            clearInterval(ghInterval);
            setTimeout(async () => {
              try {
                const r2 = await fetch(`https://algo-scanner-lnck.onrender.com/api/first-daily-base-progress?since_id=${lastId}`);
                const d2 = await r2.json();
                if (d2.lines && d2.lines.length > 0) d2.lines.forEach(({ line }) => log(line));
              } catch (_) {}
              clearInterval(progressInterval);
              d.conclusion === 'success' ? resolve() : reject(new Error(d.conclusion));
            }, 4000);
          }
        } catch (_) {}
      }, 15000);
    }).then(() => {
      setFdbTriggerStatus('success');
    }).catch((e) => {
      log(`❌ Workflow failed (${e.message}). Check GitHub Actions for details.`);
      clearInterval(progressInterval);
      setFdbTriggerStatus('error');
    });
  };

  const handleExportCSV = () => {
    if (sortedStocks.length === 0) return;

    const headers = ["Ticker", "Sector", "Macro Industry", "Micro Industry", "RS Score", "Daily Cross Date", "1H Pullback Time", "15M Pullback Time"];
    
    const csvRows = sortedStocks.map(stock => {
      const cleanSymbol = stock.fyers_symbol ? stock.fyers_symbol.split(':')[1].replace(/-EQ$|-BE$|-BZ$|-BL$|-BT$|-SM$|-ST$/, '') : '--';
      const mappedSector = Object.keys(hierarchy).find(sector =>
        Object.keys(hierarchy[sector] || {}).includes(stock.industry)
      ) || '--';
      return [
        cleanSymbol,
        `"${mappedSector}"`,
        `"${stock.industry || '--'}"`,
        `"${stock.basic_industry || '--'}"`,
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

  const handleFyersWatchlist = async () => {
    if (sortedStocks.length === 0) return;
    const symbols = sortedStocks.map(s => s.fyers_symbol).filter(Boolean);
    setFyersWlStatus('loading');

    let jobId = null;
    try {
      const r = await fetch('https://algo-scanner-lnck.onrender.com/api/fyers-watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols })
      });
      const d = await r.json();
      if (d.status !== 'success') { setFyersWlStatus('error'); return; }
      jobId = d.job_id;
    } catch {
      setFyersWlStatus('error');
      return;
    }

    // Poll for completion (runner picks it up locally, marks done on Render)
    const deadline = Date.now() + 20 * 60 * 1000; // 20 min max
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`https://algo-scanner-lnck.onrender.com/api/fyers-watchlist-status?job_id=${jobId}`);
        const d = await r.json();
        if (d.status === 'done') {
          clearInterval(poll);
          setFyersWlStatus('success');
          setTimeout(() => setFyersWlStatus('idle'), 5000);
        } else if (d.status === 'failed' || d.status === 'cancelled') {
          clearInterval(poll);
          setFyersWlStatus('error');
          setTimeout(() => setFyersWlStatus('idle'), 5000);
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          setFyersWlStatus('error');
        }
      } catch {
        // keep polling on network blip
      }
    }, 4000);
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
  const isScanDisabled = selectedMicros.size === 0 && selectedFundamentals.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden', fontFamily: 'Inter, sans-serif', backgroundColor: t.bgApp, color: t.textMain, transition: 'background-color 0.3s' }}>
      
      <header style={{ height: '65px', backgroundColor: t.bgPanel, padding: '0 25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${t.border}`, flexShrink: 0, position: 'relative', zIndex: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '900', letterSpacing: '-0.5px', color: '#64748b' }}>CHART HAWKS</h1>
          <div style={{ display: 'flex', backgroundColor: t.bgApp, borderRadius: '8px', padding: '4px' }}>
            <button onClick={() => setActiveView('scanner')} style={{...tabStyle, backgroundColor: activeView === 'scanner' ? t.bgPanel : 'transparent', color: activeView === 'scanner' ? t.textMain : t.textMuted}}>📊 Scanner</button>
            <button onClick={() => setActiveView('heatmap')} style={{...tabStyle, backgroundColor: activeView === 'heatmap' ? t.bgPanel : 'transparent', color: activeView === 'heatmap' ? t.textMain : t.textMuted}}>🔥 Sectors</button>
            <button onClick={() => setActiveView('industries')} style={{...tabStyle, backgroundColor: activeView === 'industries' ? t.bgPanel : 'transparent', color: activeView === 'industries' ? t.textMain : t.textMuted}}>🏭 Macro Industries</button>
            <button onClick={() => setActiveView('micro')} style={{...tabStyle, backgroundColor: activeView === 'micro' ? t.bgPanel : 'transparent', color: activeView === 'micro' ? t.textMain : t.textMuted}}>🔬 Micro Industries</button>
            <button onClick={() => setActiveView('directory')} style={{...tabStyle, backgroundColor: activeView === 'directory' ? t.bgPanel : 'transparent', color: activeView === 'directory' ? t.textMain : t.textMuted}}>📋 Stocks Directory</button>
            <button onClick={() => setActiveView('rsratio')} style={{...tabStyle, backgroundColor: activeView === 'rsratio' ? t.bgPanel : 'transparent', color: activeView === 'rsratio' ? t.textMain : t.textMuted}}>📐 RS Ratio</button>
            <button onClick={() => setActiveView('firstdailybase')} style={{...tabStyle, backgroundColor: activeView === 'firstdailybase' ? t.bgPanel : 'transparent', color: activeView === 'firstdailybase' ? t.textMain : t.textMuted}}>🏛️ 1st Daily Base</button>
            <button onClick={() => setActiveView('settings')} style={{...tabStyle, backgroundColor: activeView === 'settings' ? t.bgPanel : 'transparent', color: activeView === 'settings' ? t.textMain : t.textMuted}}>⚙️ Settings</button>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} style={{ padding: '6px 12px', borderRadius: '20px', backgroundColor: t.bgApp, color: t.textMain, border: `1px solid ${t.border}`, cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
            {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
          </button>
          
          <div style={{ fontWeight: '600', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: t.textMuted }}>
            <span style={{ width: '8px', height: '8px', backgroundColor: '#10b981', borderRadius: '50%', display: 'inline-block' }}></span>
            LIVE
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
            
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>

              {/* Fundamental Filters */}
              <div style={{ padding: '12px 14px', borderBottom: `1px solid ${t.border}`, backgroundColor: theme === 'dark' ? '#0f172a' : '#f8fafc', flexShrink: 0 }}>
                <div style={{ fontWeight: '800', fontSize: '11px', color: t.textMuted, textTransform: 'uppercase', marginBottom: '10px', letterSpacing: '0.5px' }}>Fundamentals</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', marginBottom: '8px', color: t.textMain }}>
                  <input type="checkbox" style={{ accentColor: t.btnPrimaryBg }} checked={selectedFundamentals.includes('high_growth')}
                    onChange={() => setSelectedFundamentals(prev => prev.includes('high_growth') ? prev.filter(x => x !== 'high_growth') : [...prev, 'high_growth'])} />
                  🚀 High Growth (ROCE)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', color: t.textMain }}>
                  <input type="checkbox" style={{ accentColor: t.btnPrimaryBg }} checked={selectedFundamentals.includes('moderate_growth')}
                    onChange={() => setSelectedFundamentals(prev => prev.includes('moderate_growth') ? prev.filter(x => x !== 'moderate_growth') : [...prev, 'moderate_growth'])} />
                  📈 Moderate Growth (ROCE)
                </label>
              </div>

              {/* Search + Tree Header */}
              <div style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontWeight: '800', fontSize: '11px', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Sector / Industry
                  </div>
                  {selectedMicros.size > 0 && (
                    <span style={{ fontSize: '11px', fontWeight: '700', color: '#3b82f6' }}>{selectedMicros.size} selected</span>
                  )}
                </div>
                <input
                  id="sidebar-search"
                  name="sidebar-search"
                  type="text"
                  autoComplete="off"
                  placeholder="🔍 Search..."
                  value={sidebarSearch}
                  onChange={e => setSidebarSearch(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '5px', border: `1px solid ${t.border}`, backgroundColor: t.inputBg, color: t.textMain, fontSize: '12px', boxSizing: 'border-box' }}
                />
              </div>

              {/* 3-Level Filter Tree */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
                <FilterTree
                  tree={hierarchy}
                  selected={selectedMicros}
                  onChange={setSelectedMicros}
                  t={t}
                  theme={theme}
                  searchTerm={sidebarSearch}
                />
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
                {sortedStocks.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }}>
                    <button
                      onClick={handleFyersWatchlist}
                      disabled={fyersWlStatus !== 'idle'}
                      style={{
                        padding: '4px 12px',
                        backgroundColor: fyersWlStatus === 'success' ? '#10b981' : fyersWlStatus === 'error' ? '#ef4444' : fyersWlStatus === 'loading' ? '#eab308' : '#6366f1',
                        color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: '700',
                        cursor: fyersWlStatus !== 'idle' ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {fyersWlStatus === 'idle'    && 'Fyers Watchlist Import'}
                      {fyersWlStatus === 'loading' && 'Waiting for runner...'}
                      {fyersWlStatus === 'success' && 'Imported!'}
                      {fyersWlStatus === 'error'   && 'Failed — run watchlist_runner.py first'}
                    </button>
                    <span style={{ fontSize: '10px', color: t.textMuted, fontStyle: 'italic' }}>Contact admin to run this feature</span>
                  </div>
                )}
              </div>
              <input id="results-search" name="results-search" type="text" autoComplete="off" placeholder="🔍 Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ padding: '8px 16px', borderRadius: '6px', border: `1px solid ${t.border}`, width: '300px', backgroundColor: t.inputBg, color: t.textMain }} />
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
                      const mappedSector = Object.keys(hierarchy).find(sector => Object.keys(hierarchy[sector] || {}).includes(s.industry)) || '--';
                      const cleanTicker = s.fyers_symbol ? s.fyers_symbol.split(':')[1].replace(/-EQ$|-BE$|-BZ$|-BL$|-BT$|-SM$|-ST$/, '') : '';
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
                            <div style={{ fontSize: '12px', fontWeight: '700', color: t.textTicker, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.basic_industry}>{s.basic_industry || s.industry}</div>
                            <div style={{ fontSize: '10px', color: t.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.industry}</div>
                            <div style={{ fontSize: '10px', color: t.textMuted, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mappedSector}</div>
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
      ) : activeView === 'industries' ? (
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: t.bgApp, position: 'relative' }}>
          <IndustryHeatmap onScanNavigate={triggerScanFromHeatmap} theme={theme} />
        </div>
      ) : activeView === 'micro' ? (
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: t.bgApp, position: 'relative' }}>
          <MicroIndustryHeatmap onScanNavigate={triggerScanFromHeatmap} theme={theme} />
        </div>
      ) : activeView === 'directory' ? (
        <StocksDirectory theme={theme} t={t} />
      ) : activeView === 'rsratio' ? (
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: t.bgApp, position: 'relative' }}>
          <RSRatioReport theme={theme} onScanNavigate={triggerScanFromHeatmap} />
        </div>
      ) : activeView === 'firstdailybase' ? (
        <FirstDailyBaseView
          t={t} theme={theme}
          stocks={firstDailyBase} loading={fdbLoading}
          search={fdbSearch} setSearch={setFdbSearch}
          sort={fdbSort} setSort={setFdbSort}
          formatDT={formatDT}
          onRefresh={() => {
            setFdbLoading(true);
            fetch('https://algo-scanner-lnck.onrender.com/api/first-daily-base')
              .then(r => r.json())
              .then(res => { setFirstDailyBase(res.data || []); setFdbLoading(false); })
              .catch(() => { setFirstDailyBase([]); setFdbLoading(false); });
          }}
        />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: t.bgApp, padding: '40px' }}>
          <div style={{ maxWidth: '600px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: t.textMain }}>Settings</h2>

            {/* Scanner Filters */}
            <div style={{ backgroundColor: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ fontWeight: '700', fontSize: '15px', color: t.textMain }}>Scanner Filters</div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer' }}>
                <div style={{ position: 'relative', flexShrink: 0, marginTop: '2px' }}>
                  <input
                    type="checkbox"
                    checked={weeklyEmaFilter}
                    onChange={e => {
                      setWeeklyEmaFilter(e.target.checked);
                      localStorage.setItem('weeklyEmaFilter', e.target.checked);
                    }}
                    style={{ width: '18px', height: '18px', accentColor: t.btnPrimaryBg, cursor: 'pointer' }}
                  />
                </div>
                <div>
                  <div style={{ fontWeight: '700', fontSize: '14px', color: t.textMain, marginBottom: '3px' }}>Weekly EMA Filter (20 &gt; 50)</div>
                  <div style={{ fontSize: '12px', color: t.textMuted, lineHeight: '1.5' }}>
                    When enabled, the Scanner only shows stocks where <strong>Weekly EMA20 &gt; EMA50</strong> — confirming a weekly uptrend. Daily crossover and intraday pulse also respect this condition. Enabled by default.
                  </div>
                </div>
              </label>
            </div>

            <div style={{ backgroundColor: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ fontWeight: '700', fontSize: '15px', color: t.textMain, marginBottom: '4px' }}>Fyers API - Full Data Fetch</div>
                <div style={{ fontSize: '13px', color: t.textMuted, lineHeight: '1.5' }}>
                  Triggers the <strong>market_engine</strong> workflow on GitHub Actions. Fetches 364 days of OHLCV data from Fyers API for every NSE stock, computes EMA20/EMA50 crossovers, calculates RS scores against Nifty 50, detects 1H and 15M intraday pullbacks, and updates the database. Runs automatically after market close — use this to trigger it manually if needed.
                </div>
              </div>
              <button
                onClick={handleTriggerEngine}
                disabled={triggerStatus !== 'idle'}
                style={{
                  alignSelf: 'flex-start',
                  padding: '10px 22px',
                  borderRadius: '8px',
                  border: 'none',
                  fontWeight: '700',
                  fontSize: '14px',
                  cursor: triggerStatus === 'idle' ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                  backgroundColor:
                    triggerStatus === 'loading' ? '#eab308' :
                    triggerStatus === 'success' ? '#10b981' :
                    triggerStatus === 'error'   ? '#ef4444' :
                    t.btnPrimaryBg,
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                {triggerStatus === 'idle'    && '🔄 Sync Market Data'}
                {triggerStatus === 'loading' && '⏳ Starting...'}
                {triggerStatus === 'success' && '✅ Triggered!'}
                {triggerStatus === 'error'   && '❌ Failed — Retry'}
              </button>

              {triggerLog.length > 0 && (
                <div style={{ backgroundColor: theme === 'dark' ? '#020617' : '#0f172a', borderRadius: '8px', padding: '14px 16px', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8', maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {triggerLog.map((line, i) => (
                    <div key={i} style={{ color: line.startsWith('❌') ? '#f87171' : line.startsWith('✅') || line.startsWith('🎉') ? '#4ade80' : line.startsWith('🎯') || line.startsWith('📊') || line.startsWith('📋') ? '#60a5fa' : line.startsWith('  ↳') || line.startsWith('  •') ? '#94a3b8' : line.startsWith('⚠️') ? '#fbbf24' : '#e2e8f0' }}>{line}</div>
                  ))}
                  {triggerStatus === 'loading' && <div style={{ color: '#eab308', marginTop: '4px' }}>▌</div>}
                </div>
              )}
            </div>

            <div style={{ backgroundColor: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ fontWeight: '700', fontSize: '15px', color: t.textMain, marginBottom: '4px' }}>Intraday H &amp; 15 mins Cross</div>
                <div style={{ fontSize: '13px', color: t.textMuted, lineHeight: '1.5' }}>
                  Triggers the <strong>intraday_engine</strong> workflow on GitHub Actions. Scans only stocks with an active daily uptrend and detects the first EMA20/EMA50 bearish crossover on 1H and 15M timeframes — signalling a pullback entry opportunity. Runs automatically every hour during market hours — use this to trigger it manually if needed.
                </div>
              </div>
              <button
                onClick={handleTriggerIntraday}
                disabled={intradayStatus !== 'idle'}
                style={{
                  alignSelf: 'flex-start',
                  padding: '10px 22px',
                  borderRadius: '8px',
                  border: 'none',
                  fontWeight: '700',
                  fontSize: '14px',
                  cursor: intradayStatus === 'idle' ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                  backgroundColor:
                    intradayStatus === 'loading' ? '#eab308' :
                    intradayStatus === 'success' ? '#10b981' :
                    intradayStatus === 'error'   ? '#ef4444' :
                    t.btnPrimaryBg,
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                {intradayStatus === 'idle'    && '⚡ Run Intraday Pulse'}
                {intradayStatus === 'loading' && '⏳ Starting...'}
                {intradayStatus === 'success' && '✅ Triggered!'}
                {intradayStatus === 'error'   && '❌ Failed — Retry'}
              </button>

              {intradayLog.length > 0 && (
                <div style={{ backgroundColor: theme === 'dark' ? '#020617' : '#0f172a', borderRadius: '8px', padding: '14px 16px', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8', maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {intradayLog.map((line, i) => (
                    <div key={i} style={{ color: line.startsWith('❌') ? '#f87171' : line.startsWith('✅') || line.startsWith('🎉') ? '#4ade80' : line.startsWith('🚨') || line.startsWith('📊') || line.startsWith('⚡') ? '#60a5fa' : line.startsWith('  ↳') ? '#94a3b8' : line.startsWith('⚠️') ? '#fbbf24' : '#e2e8f0' }}>{line}</div>
                  ))}
                  {intradayStatus === 'loading' && <div style={{ color: '#eab308', marginTop: '4px' }}>▌</div>}
                </div>
              )}
            </div>

            <div style={{ backgroundColor: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ fontWeight: '700', fontSize: '15px', color: t.textMain, marginBottom: '4px' }}>1st Daily Base Scan</div>
                <div style={{ fontSize: '13px', color: t.textMuted, lineHeight: '1.5' }}>
                  Triggers the <strong>first_daily_base_engine</strong> workflow on GitHub Actions. Scans all NSE stocks for the 3-step sequence: <strong>EMA50 crosses above SMA200</strong> → <strong>EMA20 crosses below EMA50</strong> → <strong>EMA9 crosses above EMA20</strong>. Only stocks where the final signal occurred within the <strong>last 14 days</strong> are shown in the 1st Daily Base tab. Runs automatically at 01:30 AM IST daily — use this to trigger it manually.
                </div>
              </div>
              <button
                onClick={handleTriggerFirstDailyBase}
                disabled={fdbTriggerStatus !== 'idle'}
                style={{
                  alignSelf: 'flex-start',
                  padding: '10px 22px',
                  borderRadius: '8px',
                  border: 'none',
                  fontWeight: '700',
                  fontSize: '14px',
                  cursor: fdbTriggerStatus === 'idle' ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                  backgroundColor:
                    fdbTriggerStatus === 'loading' ? '#eab308' :
                    fdbTriggerStatus === 'success' ? '#10b981' :
                    fdbTriggerStatus === 'error'   ? '#ef4444' :
                    t.btnPrimaryBg,
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                {fdbTriggerStatus === 'idle'    && '🏛️ Run 1st Daily Base Scan'}
                {fdbTriggerStatus === 'loading' && '⏳ Starting...'}
                {fdbTriggerStatus === 'success' && '✅ Triggered!'}
                {fdbTriggerStatus === 'error'   && '❌ Failed — Retry'}
              </button>

              {fdbTriggerLog.length > 0 && (
                <div style={{ backgroundColor: theme === 'dark' ? '#020617' : '#0f172a', borderRadius: '8px', padding: '14px 16px', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8', maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {fdbTriggerLog.map((line, i) => (
                    <div key={i} style={{ color: line.startsWith('❌') ? '#f87171' : line.startsWith('✅') || line.startsWith('🎉') ? '#4ade80' : line.startsWith('🎯') || line.startsWith('📊') || line.startsWith('🏛️') ? '#60a5fa' : line.startsWith('  ↳') ? '#94a3b8' : line.startsWith('⚠️') ? '#fbbf24' : '#e2e8f0' }}>{line}</div>
                  ))}
                  {fdbTriggerStatus === 'loading' && <div style={{ color: '#eab308', marginTop: '4px' }}>▌</div>}
                </div>
              )}
            </div>

            <div style={{ backgroundColor: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ fontWeight: '700', fontSize: '15px', color: t.textMain, marginBottom: '4px' }}>NSE Stock Universe</div>
                <div style={{ fontSize: '13px', color: t.textMuted, lineHeight: '1.5' }}>
                  Downloads the full NSE equity list from <strong>EQUITY_L.csv</strong>, fetches sector, industry &amp; basic industry for every stock live from the <strong>NSE quote API</strong>, and syncs everything into the database. Delisted stocks are removed automatically. Runs automatically on the <strong>1st of every month at 6:00 AM IST</strong> — use this to trigger it manually if needed.
                </div>
              </div>

              <button
                onClick={handleRefreshNseTickers}
                disabled={refreshTickerStatus === 'loading'}
                style={{
                  alignSelf: 'flex-start',
                  padding: '10px 22px',
                  borderRadius: '8px',
                  border: 'none',
                  fontWeight: '700',
                  fontSize: '14px',
                  cursor: refreshTickerStatus === 'loading' ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  backgroundColor:
                    refreshTickerStatus === 'loading' ? '#eab308' :
                    refreshTickerStatus === 'success' ? '#10b981' :
                    refreshTickerStatus === 'error'   ? '#ef4444' :
                    t.btnPrimaryBg,
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                {refreshTickerStatus === 'idle'    && 'Refresh NSE Tickers'}
                {refreshTickerStatus === 'loading' && '⏳ Running...'}
                {refreshTickerStatus === 'success' && '✅ Done'}
                {refreshTickerStatus === 'error'   && '❌ Failed — Retry'}
              </button>

              {refreshLog.length > 0 && (
                <div style={{
                  backgroundColor: theme === 'dark' ? '#020617' : '#0f172a',
                  borderRadius: '8px',
                  padding: '14px 16px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  lineHeight: '1.8',
                  maxHeight: '320px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}>
                  {refreshLog.map((line, i) => (
                    <div key={i} style={{
                      color: line.startsWith('❌') ? '#f87171'
                           : line.startsWith('✅') || line.startsWith('🎉') ? '#4ade80'
                           : line.startsWith('🔍') || line.startsWith('💾') || line.startsWith('📥') ? '#60a5fa'
                           : line.startsWith('  ↳') ? '#94a3b8'
                           : '#e2e8f0'
                    }}>{line}</div>
                  ))}
                  {refreshTickerStatus === 'loading' && (
                    <div style={{ color: '#eab308', marginTop: '4px' }}>▌</div>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

function FirstDailyBaseView({ t, theme, stocks, loading, search, setSearch, sort, setSort, formatDT, onRefresh }) {
  const fdbGridStyle = {
    display: 'grid',
    gridTemplateColumns: '1.2fr 0.8fr 0.8fr 0.8fr 0.8fr 1.8fr',
    width: '100%',
    alignItems: 'center',
    textAlign: 'center',
  };

  const toggleSort = (key) => setSort({ key, direction: sort.key === key && sort.direction === 'desc' ? 'asc' : 'desc' });

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return s ? stocks.filter(r => Object.values(r).some(v => String(v || '').toLowerCase().includes(s))) : stocks;
  }, [stocks, search]);

  const sorted = useMemo(() => {
    const items = [...filtered];
    if (!sort.key) return items;
    items.sort((a, b) => {
      let va = a[sort.key], vb = b[sort.key];
      const dateKeys = ['step1_date', 'step2_date', 'signal_date'];
      if (dateKeys.includes(sort.key)) {
        va = va ? new Date(va).getTime() : (sort.direction === 'asc' ? Infinity : -Infinity);
        vb = vb ? new Date(vb).getTime() : (sort.direction === 'asc' ? Infinity : -Infinity);
      } else {
        va = va ?? (sort.direction === 'asc' ? Infinity : -Infinity);
        vb = vb ?? (sort.direction === 'asc' ? Infinity : -Infinity);
      }
      if (va < vb) return sort.direction === 'asc' ? -1 : 1;
      if (va > vb) return sort.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return items;
  }, [filtered, sort]);

  const hdrStyle = { cursor: 'pointer', userSelect: 'none', transition: 'color 0.2s' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: t.bgApp }}>
      <div style={{ backgroundColor: t.bgPanel, margin: '15px', borderRadius: '10px', border: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>

        {/* Header bar */}
        <div style={{ padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${t.border}`, backgroundColor: t.bgApp, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ fontWeight: '700', fontSize: '16px' }}>
              1st Daily Base &nbsp;<span style={{ fontWeight: '400', fontSize: '13px', color: t.textMuted }}>EMA50 &gt; SMA200 → EMA20 &lt; EMA50 → EMA9 &gt; EMA20 (last 14 days)</span>
            </div>
            <span style={{ fontWeight: '700', fontSize: '13px', color: t.textMuted }}>({sorted.length})</span>
            <button
              onClick={onRefresh}
              disabled={loading}
              style={{ padding: '4px 12px', backgroundColor: t.btnPrimaryBg, color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: '700', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? '⏳ Loading...' : '🔄 Refresh'}
            </button>
          </div>
          <input
            type="text" autoComplete="off" placeholder="🔍 Search..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ padding: '8px 16px', borderRadius: '6px', border: `1px solid ${t.border}`, width: '280px', backgroundColor: t.inputBg, color: t.textMain, fontSize: '13px' }}
          />
        </div>

        {/* Table header */}
        <div style={{ ...fdbGridStyle, padding: '14px 0', borderBottom: `2px solid ${t.border}`, fontWeight: '900', fontSize: '13px', color: t.textMuted, backgroundColor: t.bgPanel, flexShrink: 0 }}>
          <div onClick={() => toggleSort('fyers_symbol')} style={hdrStyle}>Ticker ⇅</div>
          <div onClick={() => toggleSort('rs_score')} style={hdrStyle}>RS Score ⇅</div>
          <div onClick={() => toggleSort('step1_date')} style={hdrStyle}>Step 1 (EMA50&gt;SMA200) ⇅</div>
          <div onClick={() => toggleSort('step2_date')} style={hdrStyle}>Step 2 (EMA20&lt;EMA50) ⇅</div>
          <div onClick={() => toggleSort('signal_date')} style={hdrStyle}>Signal (EMA9&gt;EMA20) ⇅</div>
          <div onClick={() => toggleSort('industry')} style={hdrStyle}>Industry &amp; Sector ⇅</div>
        </div>

        {/* Table body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px', color: t.textMuted }}>Scanning...</div>
          ) : sorted.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px', color: t.textMuted }}>
              {stocks.length === 0 ? 'No signals found in the last 14 days. Run the 1st Daily Base scan to populate results.' : 'No results match your search.'}
            </div>
          ) : sorted.map((s, idx) => {
            const cleanTicker = s.fyers_symbol ? s.fyers_symbol.split(':')[1].replace(/-EQ$|-BE$|-BZ$|-BL$|-BT$|-SM$|-ST$/, '') : '';
            return (
              <div
                key={idx}
                style={{ ...fdbGridStyle, padding: '14px 0', borderBottom: `1px solid ${t.border}`, fontSize: '13px', transition: 'background-color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = t.hover}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <div style={{ fontWeight: '800', color: t.textTicker }}>{cleanTicker || '--'}</div>
                <div style={{ fontWeight: '800', color: s.rs_score > 0 ? t.rsPosText : t.rsNegText, backgroundColor: s.rs_score > 0 ? t.rsPosBg : t.rsNegBg, padding: '3px 8px', borderRadius: '4px', display: 'inline-block', margin: '0 auto' }}>
                  {s.rs_score ?? '--'}
                </div>
                <div style={{ color: t.textTicker, fontWeight: '600' }}>{formatDT(s.step1_date)}</div>
                <div style={{ color: t.textTicker, fontWeight: '600' }}>{formatDT(s.step2_date)}</div>
                <div style={{ fontWeight: '800', color: '#10b981' }}>{formatDT(s.signal_date)}</div>
                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: t.textTicker, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.basic_industry}>{s.basic_industry || s.industry}</div>
                  <div style={{ fontSize: '10px', color: t.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.industry}</div>
                  <div style={{ fontSize: '10px', color: t.textMuted, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.sector}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
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
          hide_legend: true,
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