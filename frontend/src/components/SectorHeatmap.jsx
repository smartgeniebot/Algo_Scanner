import React, { useEffect, useState } from 'react';

const SectorHeatmap = ({ onScanNavigate }) => {
    const [data, setData] = useState([]);
    const [selectedSector, setSelectedSector] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState([]);

    useEffect(() => {
        fetch('https://algo-scanner-lnck.onrender.com/api/sector-heatmap')
            .then(res => res.json())
            .then(res => { 
                setData(Array.isArray(res) ? res : []); 
                setLoading(false); 
            })
            .catch(err => { 
                console.error("API Error", err); 
                setData([]);
                setLoading(false); 
            });
    }, []);

    const getScoreStyle = (rs) => {
        const numRs = Number(rs) || 0;
        if (numRs >= 0.05) return { text: '#059669', bg: '#ecfdf5', bar: '#10b981' }; 
        if (numRs > 0) return { text: '#10b981', bg: '#f0fdf4', bar: '#34d399' }; 
        if (numRs > -0.05) return { text: '#dc2626', bg: '#fef2f2', bar: '#ef4444' }; 
        return { text: '#b91c1c', bg: '#fef2f2', bar: '#dc2626' }; 
    };

    const getConfidenceBadge = (total) => {
        const numTotal = Number(total) || 0;
        if (numTotal >= 10) return <span style={{ color: '#059669', backgroundColor: '#ecfdf5', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>🛡️ HIGH</span>;
        if (numTotal >= 5) return <span style={{ color: '#d97706', backgroundColor: '#fffbeb', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>⚖️ MED</span>;
        return <span style={{ color: '#dc2626', backgroundColor: '#fef2f2', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>⚠️ LOW</span>;
    };

    // --- Navigation & Selection Handlers ---
    const handleDrillDown = (sectorItem) => {
        setSelectedSector(sectorItem);
        setSelected([]); // Clear selections when changing views
    };

    const handleBack = () => {
        setSelectedSector(null);
        setSelected([]); // Clear selections when going back
    };

    const toggleSelection = (identifier) => {
        setSelected(prev => 
            prev.includes(identifier) 
                ? prev.filter(i => i !== identifier) 
                : [...prev, identifier]
        );
    };

    const selectPerformers = () => {
        const performers = displayData.filter(item => (Number(item.avg_rs) || 0) > 0).map(item => item.industry || item.sector);
        setSelected(performers);
    };

    const selectUnderperformers = () => {
        const underperformers = displayData.filter(item => (Number(item.avg_rs) || 0) < 0).map(item => item.industry || item.sector);
        setSelected(underperformers);
    };

    const clearAll = () => setSelected([]);

    if (loading) return <div style={{ padding: '40px', textAlign: 'center', fontSize: '15px', fontWeight: '600', color: '#64748b' }}>Analyzing Sector Breadth Data...</div>;

    // --- Data Prep ---
    const sectorData = selectedSector ? data.find(s => s.sector === selectedSector.sector) : null;
    const rawDisplayData = (selectedSector && sectorData && sectorData.industries) ? sectorData.industries : data;

    const displayData = [...(Array.isArray(rawDisplayData) ? rawDisplayData : [])].sort((a, b) => {
        const aRS = Number(a.avg_rs) || 0;
        const bRS = Number(b.avg_rs) || 0;
        return bRS - aRS;
    });

    const gridLayout = '40px 2.5fr 1fr 1.5fr 1fr 1fr';

    return (
        <div style={{ fontFamily: 'Inter, sans-serif', maxWidth: '1200px', margin: '0 auto', paddingBottom: '30px' }}>
            
            {/* UNIFIED STICKY HEADER */}
            <div style={{ position: 'sticky', top: 0, zIndex: 9999, backgroundColor: '#ffffff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', borderRadius: '0 0 8px 8px' }}>
                
                <div style={{ padding: '20px 24px 15px 24px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    
                    {/* Top Row: Title & Legend */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
                                {selectedSector ? (
                                    <>
                                        <button 
                                            onClick={handleBack}
                                            style={{ cursor: 'pointer', background: '#0f172a', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', transition: 'background-color 0.2s' }}
                                            onMouseEnter={e=>e.target.style.background='#1e293b'} onMouseLeave={e=>e.target.style.background='#0f172a'}
                                        >
                                            ← BACK
                                        </button>
                                        {selectedSector.sector}
                                    </>
                                ) : 'MACRO SECTOR BREADTH'}
                            </h2>
                            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px', fontWeight: '500' }}>
                                {selectedSector ? 'Select industries to send to the scanner.' : 'Select macro sectors to scan, or drill down into specific industries.'}
                            </div>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '12px', fontWeight: '700', color: '#475569' }}>Conviction Legend:</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b', fontWeight: '500' }}>{getConfidenceBadge(15)} ≥ 10 Stocks</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b', fontWeight: '500' }}>{getConfidenceBadge(7)} 5-9 Stocks</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b', fontWeight: '500' }}>{getConfidenceBadge(2)} &lt; 5 Stocks</div>
                        </div>
                    </div>

                    {/* Bottom Row: Buttons */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={selectPerformers} style={{ backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '8px 16px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', transition: 'background-color 0.2s' }}>Select Performers</button>
                            <button onClick={selectUnderperformers} style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', padding: '8px 16px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', transition: 'background-color 0.2s' }}>Select Underperformers</button>
                            <button onClick={clearAll} style={{ backgroundColor: '#ffffff', color: '#64748b', border: '1px solid #e2e8f0', padding: '8px 16px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', transition: 'background-color 0.2s' }}>Clear All</button>
                        </div>

                        <button 
                            onClick={() => selected.length > 0 && onScanNavigate && onScanNavigate(selected)}
                            disabled={selected.length === 0}
                            style={{ 
                                backgroundColor: selected.length > 0 ? '#2563eb' : '#e2e8f0', 
                                color: selected.length > 0 ? '#ffffff' : '#94a3b8', 
                                padding: '10px 20px', borderRadius: '6px', fontWeight: '700', border: 'none', 
                                cursor: selected.length > 0 ? 'pointer' : 'not-allowed', fontSize: '14px', transition: 'all 0.2s',
                                boxShadow: selected.length > 0 ? '0 2px 4px rgba(37,99,235,0.2)' : 'none'
                            }}
                        >
                            🚀 SCAN SELECTED ({selected.length})
                        </button>
                    </div>
                </div>

                {/* Sub-Header Columns */}
                <div style={{ display: 'grid', gridTemplateColumns: gridLayout, gap: '15px', padding: '12px 24px', borderTop: '1px solid #e2e8f0', borderBottom: '2px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', backgroundColor: '#f8fafc' }}>
                    <div style={{ textAlign: 'center' }}>✔</div>
                    <div>{selectedSector ? 'Industry' : 'Macro Sector'}</div>
                    <div style={{ textAlign: 'center' }}>Vs Nifty</div>
                    <div>Outperforming Stocks %</div>
                    <div style={{ textAlign: 'center' }}>Conviction</div>
                    <div style={{ textAlign: 'center' }}>D EMA Cross</div>
                </div>
            </div>

            {/* TABLE BODY ROWS */}
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 8px 8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                {displayData.map((item, idx) => {
                    const rsValue = Number(item.avg_rs) || 0;
                    const outperformingPct = Number(item.outperforming_pct) || 0; 
                    const identifier = item.industry || item.sector;
                    const isSelected = selected.includes(identifier);
                    
                    const style = getScoreStyle(rsValue);
                    const title = identifier || "Unknown"; 
                    const rsPercent = (rsValue * 100).toFixed(1);

                    return (
                        <div 
                            key={idx} 
                            onClick={() => toggleSelection(identifier)}
                            style={{ 
                                display: 'grid', gridTemplateColumns: gridLayout, gap: '15px', padding: '14px 24px', 
                                borderBottom: idx === displayData.length - 1 ? 'none' : '1px solid #f1f5f9', alignItems: 'center',
                                backgroundColor: isSelected ? '#eff6ff' : '#ffffff', cursor: 'pointer', transition: 'background-color 0.15s ease',
                            }}
                            onMouseEnter={(e) => { if(!isSelected) e.currentTarget.style.backgroundColor = '#f8fafc' }}
                            onMouseLeave={(e) => { if(!isSelected) e.currentTarget.style.backgroundColor = '#ffffff' }}
                        >
                            <div style={{ textAlign: 'center' }}>
                                <input 
                                    type="checkbox" checked={isSelected} readOnly 
                                    style={{ transform: 'scale(1.2)', cursor: 'pointer', accentColor: '#2563eb' }}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
                                <div style={{ fontWeight: '700', fontSize: '14px', color: '#0f172a' }}>{title}</div>
                                
                                {/* Macro View gets the Drill Down Button, Micro View gets the subtitle */}
                                {!selectedSector ? (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); handleDrillDown(item); }}
                                        style={{ backgroundColor: '#f1f5f9', color: '#3b82f6', border: '1px solid #e2e8f0', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '4px' }}
                                        onMouseEnter={e=>{e.target.style.backgroundColor='#e2e8f0'; e.target.style.color='#2563eb'}}
                                        onMouseLeave={e=>{e.target.style.backgroundColor='#f1f5f9'; e.target.style.color='#3b82f6'}}
                                    >
                                        📂 View Industries
                                    </button>
                                ) : (
                                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>in {item.sector}</div>
                                )}
                            </div>
                            
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                <span style={{ backgroundColor: style.bg, color: style.text, padding: '4px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: '800' }}>
                                    {rsValue > 0 ? `+${rsPercent}%` : `${rsPercent}%`}
                                </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '700', color: '#475569' }}>
                                    <span>{outperformingPct}%</span>
                                </div>
                                <div style={{ width: '100%', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div style={{ width: `${outperformingPct}%`, height: '100%', backgroundColor: style.bar, borderRadius: '3px' }}></div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                {getConfidenceBadge(item.total_stocks)}
                            </div>

                            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '13px' }}>{item.active_crosses || 0}</div>
                                <div style={{ fontWeight: '600', color: '#64748b', fontSize: '11px' }}>of {item.total_stocks || 0}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SectorHeatmap;