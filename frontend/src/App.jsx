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
  const [sectorRsStatus, setSectorRsStatus] = useState('idle');
  const [sectorRsLog, setSectorRsLog] = useState([]);

  const [scannerSubTab, setScannerSubTab] = useState('all');

  const [firstDailyBase, setFirstDailyBase] = useState([]);
  const [fdbLoading, setFdbLoading] = useState(false);
  const [fdbSort, setFdbSort] = useState({ key: 'first_base_date', direction: 'desc' });

  const [fdbTriggerStatus, setFdbTriggerStatus] = useState('idle');
  const [fdbTriggerLog, setFdbTriggerLog] = useState([]);
  const [lookbackDays, setLookbackDays] = useState(() => {
    return parseInt(localStorage.getItem('lookbackDays') || localStorage.getItem('fdbLookbackDays') || '30', 10);
  });

  const [earlyWeeklyBase, setEarlyWeeklyBase] = useState([]);
  const [ewbLoading, setEwbLoading] = useState(false);
  const [ewbSort, setEwbSort] = useState({ key: 'pullback_date', direction: 'desc' });
  const [ewbTriggerStatus, setEwbTriggerStatus] = useState('idle');
  const [ewbTriggerLog, setEwbTriggerLog] = useState([]);

  useEffect(() => {
    fetch('https://algo-scanner-lnck.onrender.com/api/filters')
      .then(res => res.json())
      .then(res => setHierarchy(res.data || {}))
      .catch(err => { console.error("Filter Error:", err); setHierarchy({}); });
  }, []);

  const doScan = (micros, fundamentals) => {
    setLoading(true);
    fetch('https://algo-scanner-lnck.onrender.com/api/stocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industries: [], basic_industries: [...micros], fundamentals, weekly_ema_filter: weeklyEmaFilter, lookback_days: lookbackDays })
    }).then(r => r.json())
      .then(res => { setStocks(res.data || []); setLoading(false); })
      .catch(err => { console.error("Scan Error:", err); setStocks([]); setLoading(false); });

    // Also refresh Early Daily Bases
    setFdbLoading(true);
    fetch(`https://algo-scanner-lnck.onrender.com/api/first-daily-base?lookback_days=${lookbackDays}&weekly_ema_filter=${weeklyEmaFilter}`)
      .then(r => r.json())
      .then(res => { setFirstDailyBase(res.data || []); setFdbLoading(false); })
      .catch(() => { setFirstDailyBase([]); setFdbLoading(false); });

    // Also refresh Early Weekly Bases
    setEwbLoading(true);
    fetch(`https://algo-scanner-lnck.onrender.com/api/early-weekly-base?lookback_days=${lookbackDays}&weekly_ema_filter=${weeklyEmaFilter}`)
      .then(r => r.json())
      .then(res => { setEarlyWeeklyBase(res.data || []); setEwbLoading(false); })
      .catch(() => { setEarlyWeeklyBase([]); setEwbLoading(false); });
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
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, weekly_ema_filter: weeklyEmaFilter, lookback_days: lookbackDays })
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
  };

  const handleClear = () => {
    setSelectedMicros(new Set());
    setStocks([]);
    setFirstDailyBase([]);
    setEarlyWeeklyBase([]);
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

  const handleTriggerSectorRs = async () => {
    setSectorRsStatus('loading');
    setSectorRsLog([]);
    const log = (msg) => setSectorRsLog(prev => [...prev, msg]);

    log('📊 Triggering Sector RS Snapshot via GitHub Actions...');
    try {
      const r = await fetch('https://algo-scanner-lnck.onrender.com/api/trigger-sector-rs', { method: 'POST' });
      const d = await r.json();
      if (d.status !== 'triggered') { log(`❌ ${d.message || 'Trigger failed'}`); setSectorRsStatus('error'); return; }
    } catch (e) { log(`❌ ${e.message}`); setSectorRsStatus('error'); return; }

    log('  ↳ Workflow triggered — waiting for GitHub Actions to start...');
    let lastId = 0;

    const progressInterval = setInterval(async () => {
      try {
        const r = await fetch(`https://algo-scanner-lnck.onrender.com/api/sector-rs-progress?since_id=${lastId}`);
        const d = await r.json();
        if (d.lines && d.lines.length > 0) {
          d.lines.forEach(({ id, line }) => { lastId = Math.max(lastId, id); log(line); });
        }
      } catch (_) {}
    }, 3000);

    new Promise((resolve, reject) => {
      const statusCheck = setInterval(async () => {
        try {
          const r = await fetch('https://algo-scanner-lnck.onrender.com/api/sector-rs-status');
          const d = await r.json();
          if (d.status === 'completed') {
            clearInterval(statusCheck);
            await new Promise(res => setTimeout(res, 4000));
            try {
              const r2 = await fetch(`https://algo-scanner-lnck.onrender.com/api/sector-rs-progress?since_id=${lastId}`);
              const d2 = await r2.json();
              if (d2.lines && d2.lines.length > 0) d2.lines.forEach(({ line }) => log(line));
            } catch (_) {}
            clearInterval(progressInterval);
            d.conclusion === 'success' ? resolve() : reject(new Error(d.conclusion));
          }
        } catch (_) {}
      }, 15000);
    }).then(() => {
      setSectorRsStatus('success');
    }).catch((e) => {
      log(`❌ Workflow failed (${e.message}). Check GitHub Actions for details.`);
      clearInterval(progressInterval);
      setSectorRsStatus('error');
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

    log('🏛️ Triggering Early Daily Bases Scan via GitHub Actions...');
    try {
      const r = await fetch('https://algo-scanner-lnck.onrender.com/api/trigger-first-daily-base', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookback_days: lookbackDays })
      });
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

  const handleTriggerEarlyWeeklyBase = async () => {
    setEwbTriggerStatus('loading');
    setEwbTriggerLog([]);
    const log = (msg) => setEwbTriggerLog(prev => [...prev, msg]);

    log('🌿 Triggering Early Weekly Base Scan via GitHub Actions...');
    try {
      const r = await fetch('https://algo-scanner-lnck.onrender.com/api/trigger-early-weekly-base', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookback_days: lookbackDays })
      });
      const d = await r.json();
      if (d.status !== 'success') { log(`❌ ${d.message || 'Unknown error'}`); setEwbTriggerStatus('error'); return; }
    } catch (e) { log(`❌ Network error: ${e.message}`); setEwbTriggerStatus('error'); return; }

    log('  ↳ Workflow triggered — waiting for GitHub Actions to start...');
    let lastId = 0;

    const progressInterval = setInterval(async () => {
      try {
        const r = await fetch(`https://algo-scanner-lnck.onrender.com/api/early-weekly-base-progress?since_id=${lastId}`);
        const d = await r.json();
        if (d.lines && d.lines.length > 0) {
          d.lines.forEach(({ id, line }) => { log(line); lastId = id; });
        }
      } catch (_) {}
    }, 3000);

    await new Promise((resolve, reject) => {
      const ghInterval = setInterval(async () => {
        try {
          const r = await fetch('https://algo-scanner-lnck.onrender.com/api/early-weekly-base-status');
          const d = await r.json();
          if (d.status === 'completed') {
            clearInterval(ghInterval);
            setTimeout(async () => {
              try {
                const r2 = await fetch(`https://algo-scanner-lnck.onrender.com/api/early-weekly-base-progress?since_id=${lastId}`);
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
      setEwbTriggerStatus('success');
    }).catch((e) => {
      log(`❌ Workflow failed (${e.message}). Check GitHub Actions for details.`);
      clearInterval(progressInterval);
      setEwbTriggerStatus('error');
    });
  };

  const handleExportCSV = () => {
    if (activeTabStocks.length === 0) return;

    const isEarly   = scannerSubTab === 'early';
    const isWeekly  = scannerSubTab === 'weekly';

    const headers = isWeekly
      ? ["Ticker", "Sector", "Macro Industry", "Micro Industry", "RS Score", "Pullback Date"]
      : isEarly
        ? ["Ticker", "Sector", "Macro Industry", "Micro Industry", "RS Score", "1st Base Date", "2nd Base Date"]
        : ["Ticker", "Sector", "Macro Industry", "Micro Industry", "RS Score", "Daily Cross Date", "1H Pullback Time", "15M Pullback Time"];

    const csvRows = activeTabStocks.map(stock => {
      const cleanSymbol = stock.fyers_symbol ? stock.fyers_symbol.split(':')[1].replace(/-EQ$|-BE$|-BZ$|-BL$|-BT$|-SM$|-ST$/, '') : '--';
      const mappedSector = Object.keys(hierarchy).find(sector =>
        Object.keys(hierarchy[sector] || {}).includes(stock.industry)
      ) || '--';
      if (isWeekly) {
        return [
          cleanSymbol,
          `"${stock.sector || mappedSector}"`,
          `"${stock.industry || '--'}"`,
          `"${stock.basic_industry || '--'}"`,
          stock.rs_score !== null ? stock.rs_score : '--',
          stock.pullback_date || '--'
        ].join(',');
      }
      if (isEarly) {
        return [
          cleanSymbol,
          `"${stock.sector || mappedSector}"`,
          `"${stock.industry || '--'}"`,
          `"${stock.basic_industry || '--'}"`,
          stock.rs_score !== null ? stock.rs_score : '--',
          stock.first_base_date || '--',
          stock.second_base_date || '--'
        ].join(',');
      }
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
    const label = isWeekly ? 'EarlyWeeklyBases' : isEarly ? 'EarlyDailyBases' : 'Scan';
    link.setAttribute('download', `ChartHawks_${label}_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFyersWatchlist = () => {
    if (activeTabStocks.length === 0) return;
    const symbols = activeTabStocks.map(s => s.fyers_symbol).filter(Boolean);
    if (symbols.length === 0) return;
    const today = new Date().toLocaleDateString('en-CA');
    const time  = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }).replace(':', '');
    const label = scannerSubTab === 'early' ? 'EarlyBases' : scannerSubTab === 'weekly' ? 'WeeklyBases' : 'Scan';
    const chunks = [];
    for (let i = 0; i < symbols.length; i += 250) chunks.push(symbols.slice(i, i + 250));
    chunks.forEach((chunk, idx) => {
      const suffix = chunks.length > 1 ? `_P${idx + 1}` : '';
      const filename = `${today}_${label}${suffix}_${time}.txt`;
      const blob = new Blob([chunk.join(',')], { type: 'text/plain;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
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
    let items = stocks;
    // high_dividend restricts universe (AND), growth filters are OR with each other
    if (selectedFundamentals.includes('high_dividend')) {
      items = items.filter(s => s.is_dividend_stock);
    }
    const growthFilters = selectedFundamentals.filter(f => f !== 'high_dividend');
    if (growthFilters.length > 0) {
      items = items.filter(s => {
        if (growthFilters.includes('high_growth') && s.is_high_roce) return true;
        if (growthFilters.includes('moderate_growth') && s.is_moderate_growth) return true;
        return false;
      });
    }
    if (!searchTerm) return items;
    const lowerSearch = searchTerm.toLowerCase();
    return items.filter(stock =>
      Object.values(stock).some(val => String(val || '').toLowerCase().includes(lowerSearch))
    );
  }, [stocks, searchTerm, selectedFundamentals]);

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
  const toggleFdbSort = (key) => setFdbSort({ key, direction: fdbSort.key === key && fdbSort.direction === 'desc' ? 'asc' : 'desc' });
  const toggleEwbSort = (key) => setEwbSort({ key, direction: ewbSort.key === key && ewbSort.direction === 'desc' ? 'asc' : 'desc' });

  // Early Daily Bases: filter by selectedMicros + fundamentals + searchTerm + sort
  const filteredFdb = useMemo(() => {
    let items = firstDailyBase;
    if (selectedMicros.size > 0) {
      items = items.filter(s => selectedMicros.has(s.basic_industry));
    }
    // high_dividend restricts universe (AND), growth filters are OR with each other
    if (selectedFundamentals.includes('high_dividend')) {
      items = items.filter(s => s.is_dividend_stock);
    }
    const growthFilters = selectedFundamentals.filter(f => f !== 'high_dividend');
    if (growthFilters.length > 0) {
      items = items.filter(s => {
        if (growthFilters.includes('high_growth') && s.is_high_roce) return true;
        if (growthFilters.includes('moderate_growth') && s.is_moderate_growth) return true;
        return false;
      });
    }
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      items = items.filter(s => Object.values(s).some(v => String(v || '').toLowerCase().includes(lowerSearch)));
    }
    return items;
  }, [firstDailyBase, selectedMicros, selectedFundamentals, searchTerm]);

  const sortedFdb = useMemo(() => {
    const items = [...filteredFdb];
    if (!fdbSort.key) return items;
    const dateKeys = ['first_base_date', 'second_base_date'];
    items.sort((a, b) => {
      let va = a[fdbSort.key], vb = b[fdbSort.key];
      if (dateKeys.includes(fdbSort.key)) {
        va = va ? new Date(va).getTime() : (fdbSort.direction === 'asc' ? Infinity : -Infinity);
        vb = vb ? new Date(vb).getTime() : (fdbSort.direction === 'asc' ? Infinity : -Infinity);
      } else {
        va = va ?? (fdbSort.direction === 'asc' ? Infinity : -Infinity);
        vb = vb ?? (fdbSort.direction === 'asc' ? Infinity : -Infinity);
      }
      if (va < vb) return fdbSort.direction === 'asc' ? -1 : 1;
      if (va > vb) return fdbSort.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return items;
  }, [filteredFdb, fdbSort]);

  // Early Weekly Base: filter + sort
  const filteredEwb = useMemo(() => {
    let items = earlyWeeklyBase;
    if (selectedMicros.size > 0) {
      items = items.filter(s => selectedMicros.has(s.basic_industry));
    }
    // high_dividend restricts universe (AND), growth filters are OR with each other
    if (selectedFundamentals.includes('high_dividend')) {
      items = items.filter(s => s.is_dividend_stock);
    }
    const growthFilters = selectedFundamentals.filter(f => f !== 'high_dividend');
    if (growthFilters.length > 0) {
      items = items.filter(s => {
        if (growthFilters.includes('high_growth') && s.is_high_roce) return true;
        if (growthFilters.includes('moderate_growth') && s.is_moderate_growth) return true;
        return false;
      });
    }
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      items = items.filter(s => Object.values(s).some(v => String(v || '').toLowerCase().includes(lowerSearch)));
    }
    return items;
  }, [earlyWeeklyBase, selectedMicros, selectedFundamentals, searchTerm]);

  const sortedEwb = useMemo(() => {
    const items = [...filteredEwb];
    if (!ewbSort.key) return items;
    items.sort((a, b) => {
      let va = a[ewbSort.key], vb = b[ewbSort.key];
      if (ewbSort.key === 'pullback_date') {
        va = va ? new Date(va).getTime() : (ewbSort.direction === 'asc' ? Infinity : -Infinity);
        vb = vb ? new Date(vb).getTime() : (ewbSort.direction === 'asc' ? Infinity : -Infinity);
      } else {
        va = va ?? (ewbSort.direction === 'asc' ? Infinity : -Infinity);
        vb = vb ?? (ewbSort.direction === 'asc' ? Infinity : -Infinity);
      }
      if (va < vb) return ewbSort.direction === 'asc' ? -1 : 1;
      if (va > vb) return ewbSort.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return items;
  }, [filteredEwb, ewbSort]);

  // Active sub-tab data for Export / Watchlist
  const activeTabStocks = scannerSubTab === 'all' ? sortedStocks : scannerSubTab === 'early' ? sortedFdb : sortedEwb;

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
            <div style={{ padding: '20px 15px', borderBottom: `1px solid ${t.border}` }}>
              <button
                onClick={handleScan}
                disabled={isScanDisabled}
                style={{ width: '100%', padding: '12px', backgroundColor: isScanDisabled ? t.border : t.btnPrimaryBg, color: isScanDisabled ? t.textMuted : t.btnPrimaryText, border: 'none', borderRadius: '6px', fontWeight: '700', fontSize: '14px', cursor: isScanDisabled ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}
              >
                {isScanDisabled ? "Select Filters to Scan" : "Scan Active Crosses"}
              </button>
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
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', marginBottom: '8px', color: t.textMain }}>
                  <input type="checkbox" style={{ accentColor: t.btnPrimaryBg }} checked={selectedFundamentals.includes('moderate_growth')}
                    onChange={() => setSelectedFundamentals(prev => prev.includes('moderate_growth') ? prev.filter(x => x !== 'moderate_growth') : [...prev, 'moderate_growth'])} />
                  📈 Moderate Growth (ROCE)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', color: t.textMain }}>
                  <input type="checkbox" style={{ accentColor: t.btnPrimaryBg }} checked={selectedFundamentals.includes('high_dividend')}
                    onChange={() => {
                      const isAdding = !selectedFundamentals.includes('high_dividend');
                      if (isAdding) {
                        // Clear all sector selections — high dividend is a standalone universe
                        setSelectedMicros(new Set());
                        setSelectedFundamentals(prev => [...prev.filter(x => x !== 'high_dividend'), 'high_dividend']);
                      } else {
                        setSelectedFundamentals(prev => prev.filter(x => x !== 'high_dividend'));
                      }
                    }} />
                  💰 High Dividend Stocks
                </label>
              </div>

              {/* Search + Tree Header */}
              <div style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontWeight: '800', fontSize: '11px', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Sector / Industry
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {selectedMicros.size > 0 && (
                      <span style={{ fontSize: '11px', fontWeight: '700', color: '#3b82f6' }}>{selectedMicros.size} selected ·</span>
                    )}
                    <button onClick={handleSelectAll} style={{ background: 'none', border: 'none', outline: 'none', padding: 0, fontSize: '11px', fontWeight: '600', color: t.btnPrimaryBg, cursor: 'pointer', textDecoration: 'underline' }}>All</button>
                    <span style={{ fontSize: '11px', color: t.textMuted }}>·</span>
                    <button onClick={handleClear} style={{ background: 'none', border: 'none', outline: 'none', padding: 0, fontSize: '11px', fontWeight: '600', color: t.textMuted, cursor: 'pointer', textDecoration: 'underline' }}>Clear</button>
                  </div>
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

            {/* Row 1: Export / Watchlist + Search */}
            <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${t.border}`, backgroundColor: t.bgApp, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {activeTabStocks.length > 0 && (
                  <button onClick={handleExportCSV} style={{ padding: '4px 12px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>📥 Export CSV</button>
                )}
                {activeTabStocks.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }}>
                    <button
                      onClick={handleFyersWatchlist}
                      style={{
                        padding: '4px 12px',
                        backgroundColor: '#6366f1',
                        color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: '700',
                        cursor: 'pointer'
                      }}
                    >
                      📥 Fyers Import
                    </button>
                  </div>
                )}
              </div>
              <input id="results-search" name="results-search" type="text" autoComplete="off" placeholder="🔍 Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ padding: '8px 16px', borderRadius: '6px', border: `1px solid ${t.border}`, width: '300px', backgroundColor: t.inputBg, color: t.textMain }} />
            </div>

            {/* Row 2: Sub-tabs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 20px', borderBottom: `1px solid ${t.border}`, backgroundColor: t.bgPanel, flexShrink: 0 }}>
              <button onClick={() => setScannerSubTab('all')} style={{ ...tabStyle, backgroundColor: scannerSubTab === 'all' ? t.btnPrimaryBg : t.bgApp, color: scannerSubTab === 'all' ? '#fff' : t.textMuted }}>
                📊 All Daily Bases{sortedStocks.length > 0 ? ` (${sortedStocks.length})` : ''}
              </button>
              <button onClick={() => setScannerSubTab('early')} style={{ ...tabStyle, backgroundColor: scannerSubTab === 'early' ? t.btnPrimaryBg : t.bgApp, color: scannerSubTab === 'early' ? '#fff' : t.textMuted }}>
                🏛️ Early Daily Bases{sortedFdb.length > 0 ? ` (${sortedFdb.length})` : ''}
              </button>
              <button onClick={() => setScannerSubTab('weekly')} style={{ ...tabStyle, backgroundColor: scannerSubTab === 'weekly' ? t.btnPrimaryBg : t.bgApp, color: scannerSubTab === 'weekly' ? '#fff' : t.textMuted }}>
                🌿 Early Weekly Bases{sortedEwb.length > 0 ? ` (${sortedEwb.length})` : ''}
              </button>
            </div>

            {/* Results area */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

              {scannerSubTab === 'all' ? (
                <>
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
                            <div key={idx} onClick={() => { if(cleanTicker) setActiveChart(bseSymbol); }}
                              style={{ ...gridRowStyle, padding: '16px 0', borderBottom: `1px solid ${t.border}`, fontSize: '14px', cursor: 'pointer', backgroundColor: isRowActive ? (theme === 'dark' ? '#1e293b' : '#f1f5f9') : 'transparent', transition: 'background-color 0.15s ease' }}
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
                        <div style={{ fontWeight: '800', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>📊 {activeChart.replace('BSE:', '')}</div>
                        <button onClick={() => setActiveChart(null)} style={{ background: 'transparent', border: 'none', color: t.textMuted, cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>Close Split View ✖</button>
                      </div>
                      <div style={{ flex: 1, position: 'relative' }}>
                        <TVChart key={activeChart + theme} symbol={activeChart} theme={theme} />
                      </div>
                    </div>
                  )}
                </>
              ) : scannerSubTab === 'weekly' ? (
                /* Early Weekly Bases sub-tab */
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 1fr 1.8fr', width: '100%', alignItems: 'center', textAlign: 'center', padding: '14px 0', borderBottom: `2px solid ${t.border}`, fontWeight: '900', fontSize: '13px', color: t.textMuted, backgroundColor: t.bgPanel, flexShrink: 0 }}>
                    <div onClick={() => toggleEwbSort('fyers_symbol')} style={headerSortStyle}>Ticker ⇅</div>
                    <div onClick={() => toggleEwbSort('rs_score')} style={headerSortStyle}>RS Score ⇅</div>
                    <div onClick={() => toggleEwbSort('pullback_date')} style={headerSortStyle}>Pullback Date ⇅</div>
                    <div onClick={() => toggleEwbSort('industry')} style={headerSortStyle}>Industry &amp; Sector ⇅</div>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {ewbLoading ? (
                      <div style={{ textAlign: 'center', padding: '60px', color: t.textMuted }}>Scanning...</div>
                    ) : sortedEwb.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '60px', color: t.textMuted }}>
                        {earlyWeeklyBase.length === 0 ? 'No signals found. Select filters and click Scan, or run the scan from Settings.' : 'No results match your filters.'}
                      </div>
                    ) : sortedEwb.map((s, idx) => {
                      const cleanTicker = s.fyers_symbol ? s.fyers_symbol.split(':')[1].replace(/-EQ$|-BE$|-BZ$|-BL$|-BT$|-SM$|-ST$/, '') : '';
                      return (
                        <div key={idx}
                          style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 1fr 1.8fr', width: '100%', alignItems: 'center', textAlign: 'center', padding: '14px 0', borderBottom: `1px solid ${t.border}`, fontSize: '13px', transition: 'background-color 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.backgroundColor = t.hover}
                          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <div style={{ fontWeight: '800', color: t.textTicker }}>{cleanTicker || '--'}</div>
                          <div style={{ fontWeight: '800', color: s.rs_score > 0 ? t.rsPosText : t.rsNegText, backgroundColor: s.rs_score > 0 ? t.rsPosBg : t.rsNegBg, padding: '3px 8px', borderRadius: '4px', display: 'inline-block', margin: '0 auto' }}>{s.rs_score ?? '--'}</div>
                          <div style={{ fontWeight: '700', color: '#f59e0b' }}>{formatDT(s.pullback_date)}</div>
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
              ) : (
                /* Early Daily Bases sub-tab */
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 1fr 1fr 1.8fr', width: '100%', alignItems: 'center', textAlign: 'center', padding: '14px 0', borderBottom: `2px solid ${t.border}`, fontWeight: '900', fontSize: '13px', color: t.textMuted, backgroundColor: t.bgPanel, flexShrink: 0 }}>
                    <div onClick={() => toggleFdbSort('fyers_symbol')} style={headerSortStyle}>Ticker ⇅</div>
                    <div onClick={() => toggleFdbSort('rs_score')} style={headerSortStyle}>RS Score ⇅</div>
                    <div onClick={() => toggleFdbSort('first_base_date')} style={headerSortStyle}>1st Base Date ⇅</div>
                    <div onClick={() => toggleFdbSort('second_base_date')} style={headerSortStyle}>2nd Base Date ⇅</div>
                    <div onClick={() => toggleFdbSort('industry')} style={headerSortStyle}>Industry &amp; Sector ⇅</div>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {fdbLoading ? (
                      <div style={{ textAlign: 'center', padding: '60px', color: t.textMuted }}>Scanning...</div>
                    ) : sortedFdb.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '60px', color: t.textMuted }}>
                        {firstDailyBase.length === 0 ? 'No signals found. Select filters and click Scan, or run the scan from Settings.' : 'No results match your filters.'}
                      </div>
                    ) : sortedFdb.map((s, idx) => {
                      const cleanTicker = s.fyers_symbol ? s.fyers_symbol.split(':')[1].replace(/-EQ$|-BE$|-BZ$|-BL$|-BT$|-SM$|-ST$/, '') : '';
                      const has2nd = !!s.second_base_date;
                      return (
                        <div key={idx}
                          style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 1fr 1fr 1.8fr', width: '100%', alignItems: 'center', textAlign: 'center', padding: '14px 0', borderBottom: `1px solid ${t.border}`, fontSize: '13px', transition: 'background-color 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.backgroundColor = t.hover}
                          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <div style={{ fontWeight: '800', color: t.textTicker }}>{cleanTicker || '--'}</div>
                          <div style={{ fontWeight: '800', color: s.rs_score > 0 ? t.rsPosText : t.rsNegText, backgroundColor: s.rs_score > 0 ? t.rsPosBg : t.rsNegBg, padding: '3px 8px', borderRadius: '4px', display: 'inline-block', margin: '0 auto' }}>{s.rs_score ?? '--'}</div>
                          <div style={{ fontWeight: '700', color: '#10b981' }}>{formatDT(s.first_base_date)}</div>
                          <div style={{ fontWeight: has2nd ? '800' : '400', color: has2nd ? '#f59e0b' : t.textMuted }}>{has2nd ? formatDT(s.second_base_date) : '--'}</div>
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
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: t.bgApp, padding: '40px' }}>
          <div style={{ maxWidth: '600px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: t.textMain }}>Settings</h2>

            {/* Scanner Filters */}
            <div style={{ backgroundColor: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ fontWeight: '700', fontSize: '15px', color: t.textMain }}>Scanner Filters</div>

              {/* Lookback Days — common to all 3 tabs */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: t.textMain, whiteSpace: 'nowrap' }}>Lookback Days</label>
                <input
                  type="number"
                  min="7"
                  max="365"
                  value={lookbackDays}
                  onChange={e => {
                    const val = Math.max(7, Math.min(365, parseInt(e.target.value) || 30));
                    setLookbackDays(val);
                    localStorage.setItem('lookbackDays', val);
                  }}
                  style={{ width: '80px', padding: '6px 10px', borderRadius: '6px', border: `1px solid ${t.border}`, backgroundColor: t.inputBg, color: t.textMain, fontSize: '13px', fontWeight: '700', textAlign: 'center' }}
                />
                <span style={{ fontSize: '12px', color: t.textMuted }}>Filters all 3 Scanner tabs — only signals within this window are shown</span>
              </div>

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
                    When enabled, only shows stocks where <strong>Weekly EMA20 &gt; EMA50</strong> — confirming a weekly uptrend. Applies to all 3 Scanner tabs (All Daily Bases, Early Daily Bases, Early Weekly Bases). Enabled by default.
                  </div>
                </div>
              </label>
            </div>

            <div style={{ backgroundColor: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ fontWeight: '700', fontSize: '15px', color: t.textMain, marginBottom: '4px' }}>All Daily Bases Scan</div>
                <div style={{ fontSize: '13px', color: t.textMuted, lineHeight: '1.5' }}>
                  Triggers the <strong>market_engine</strong> workflow on GitHub Actions. Fetches 364 days of OHLCV data from Fyers for every NSE stock, computes <strong>Daily EMA20/EMA50 crossovers</strong>, calculates RS scores against Nifty 50, detects <strong>1H and 15M intraday pullbacks</strong>, and updates the database. Results appear in the <strong>All Daily Bases</strong> tab. Runs automatically at <strong>6:00 PM IST</strong> daily — use this to trigger it manually.
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
                {triggerStatus === 'idle'    && '🔄 Run All Daily Bases Scan'}
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
                <div style={{ fontWeight: '700', fontSize: '15px', color: t.textMain, marginBottom: '4px' }}>Intraday 1H &amp; 15M Pullback</div>
                <div style={{ fontSize: '13px', color: t.textMuted, lineHeight: '1.5' }}>
                  Triggers the <strong>intraday_engine</strong> workflow on GitHub Actions. Scans stocks with an active daily uptrend and detects the <strong>first EMA20 cross below EMA50</strong> on <strong>1H and 15M</strong> timeframes — signalling an intraday pullback entry. Results appear in the <strong>All Daily Bases</strong> tab as pullback timestamps. Runs automatically <strong>every hour from 8:00 AM to 4:00 PM IST</strong> on weekdays — use this to trigger it manually.
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
                <div style={{ fontWeight: '700', fontSize: '15px', color: t.textMain, marginBottom: '4px' }}>Sector RS Snapshot</div>
                <div style={{ fontSize: '13px', color: t.textMuted, lineHeight: '1.5' }}>
                  Triggers the <strong>sector_rs_engine</strong> workflow on GitHub Actions. Computes RS ratio scores for all sectors, industries and basic industries from the <strong>daily_ohlcv</strong> cache. Runs automatically at <strong>10:00 PM IST</strong> on weekdays — use this to trigger it manually after market engine completes.
                </div>
              </div>
              <button
                onClick={handleTriggerSectorRs}
                disabled={sectorRsStatus === 'loading'}
                style={{
                  alignSelf: 'flex-start', padding: '10px 22px', borderRadius: '8px', border: 'none',
                  fontWeight: '700', fontSize: '14px',
                  cursor: sectorRsStatus === 'loading' ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  backgroundColor:
                    sectorRsStatus === 'loading' ? '#eab308' :
                    sectorRsStatus === 'success' ? '#10b981' :
                    sectorRsStatus === 'error'   ? '#ef4444' :
                    t.btnPrimaryBg,
                  color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px'
                }}
              >
                {sectorRsStatus === 'idle'    && '📊 Run Sector RS Snapshot'}
                {sectorRsStatus === 'loading' && '⏳ Running...'}
                {sectorRsStatus === 'success' && '✅ Complete!'}
                {sectorRsStatus === 'error'   && '❌ Failed — Retry'}
              </button>

              {sectorRsLog.length > 0 && (
                <div style={{ backgroundColor: theme === 'dark' ? '#020617' : '#0f172a', borderRadius: '8px', padding: '14px 16px', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8', maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {sectorRsLog.map((line, i) => (
                    <div key={i} style={{ color: line.startsWith('❌') ? '#f87171' : line.startsWith('✅') || line.startsWith('🏁') ? '#4ade80' : line.startsWith('📊') || line.startsWith('📥') || line.startsWith('📂') || line.startsWith('💾') ? '#60a5fa' : line.startsWith('  ↳') || line.startsWith('  ✅') ? '#94a3b8' : line.startsWith('⚠️') ? '#fbbf24' : '#e2e8f0' }}>{line}</div>
                  ))}
                  {sectorRsStatus === 'loading' && <div style={{ color: '#eab308', marginTop: '4px' }}>▌</div>}
                </div>
              )}
            </div>

            <div style={{ backgroundColor: t.bgPanel, border: `1px solid ${t.border}`, borderRadius: '10px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ fontWeight: '700', fontSize: '15px', color: t.textMain, marginBottom: '4px' }}>Early Daily Bases Scan</div>
                <div style={{ fontSize: '13px', color: t.textMuted, lineHeight: '1.5' }}>
                  Triggers the <strong>first_daily_base_engine</strong> workflow on GitHub Actions. Scans all NSE stocks for the 3-step sequence: <strong>Daily EMA50 crosses above SMA200</strong> → <strong>EMA20 crosses below EMA50</strong> (1st pullback) → <strong>EMA9 crosses above EMA20</strong> (re-entry base). A 2nd base is also tracked if a fresh pullback follows. Results appear in the <strong>Early Daily Bases</strong> tab. Runs automatically at <strong>2:00 AM IST</strong> daily — use this to trigger it manually.
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
                {fdbTriggerStatus === 'idle'    && '🏛️ Run Early Daily Bases Scan'}
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
                <div style={{ fontWeight: '700', fontSize: '15px', color: t.textMain, marginBottom: '4px' }}>Early Weekly Base Scan</div>
                <div style={{ fontSize: '13px', color: t.textMuted, lineHeight: '1.5' }}>
                  Triggers the <strong>early_weekly_base_engine</strong> workflow on GitHub Actions. Scans all NSE stocks for the 2-step sequence: <strong>Daily EMA50 crosses above SMA200</strong> → <strong>first pullback candle where Low drops below EMA40</strong>. Results appear in the <strong>Early Weekly Bases</strong> tab. Runs automatically at <strong>4:00 AM IST</strong> daily — use this to trigger it manually.
                </div>
              </div>
              <button
                onClick={handleTriggerEarlyWeeklyBase}
                disabled={ewbTriggerStatus !== 'idle'}
                style={{
                  alignSelf: 'flex-start',
                  padding: '10px 22px',
                  borderRadius: '8px',
                  border: 'none',
                  fontWeight: '700',
                  fontSize: '14px',
                  cursor: ewbTriggerStatus === 'idle' ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                  backgroundColor:
                    ewbTriggerStatus === 'loading' ? '#eab308' :
                    ewbTriggerStatus === 'success' ? '#10b981' :
                    ewbTriggerStatus === 'error'   ? '#ef4444' :
                    t.btnPrimaryBg,
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                {ewbTriggerStatus === 'idle'    && '🌿 Run Early Weekly Base Scan'}
                {ewbTriggerStatus === 'loading' && '⏳ Starting...'}
                {ewbTriggerStatus === 'success' && '✅ Triggered!'}
                {ewbTriggerStatus === 'error'   && '❌ Failed — Retry'}
              </button>
              {ewbTriggerLog.length > 0 && (
                <div style={{ backgroundColor: theme === 'dark' ? '#020617' : '#0f172a', borderRadius: '8px', padding: '14px 16px', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8', maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {ewbTriggerLog.map((line, i) => (
                    <div key={i} style={{ color: line.startsWith('❌') ? '#f87171' : line.startsWith('✅') || line.startsWith('🎉') ? '#4ade80' : line.startsWith('🌿') || line.startsWith('📊') ? '#60a5fa' : line.startsWith('  ↳') ? '#94a3b8' : line.startsWith('⚠️') ? '#fbbf24' : '#e2e8f0' }}>{line}</div>
                  ))}
                  {ewbTriggerStatus === 'loading' && <div style={{ color: '#eab308', marginTop: '4px' }}>▌</div>}
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