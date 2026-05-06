import React, { useEffect, useState } from 'react';

const SectorHeatmap = ({ onScanNavigate, theme }) => {
    const [data, setData] = useState([]);
    const [selectedSector, setSelectedSector] = useState(null);
    const [loading, setLoading] = useState(true);
    
    // SOURCE OF TRUTH: This array now ONLY ever holds exact Industry names. Never Sector names.
    const [selected, setSelected] = useState([]); 
    const [searchTerm, setSearchTerm] = useState(''); // NEW SEARCH STATE

    useEffect(() => {
        fetch('https://algo-scanner-lnck.onrender.com/api/sector-heatmap')
            .then(res => res.json())
            .then(res => { 
                const validData = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
                setData(validData); 
                setLoading(false); 
            })
            .catch(err => { 
                console.error("API Error", err); 
                setData([]);
                setLoading(false); 
            });
    }, []);

    // Theme-Aware Color Mapping
    const isDark = theme === 'dark';
    const t = {
        bgApp: isDark ? '#020617' : '#f1f5f9',
        bgPanel: isDark ? '#0f172a' : '#ffffff',
        textMain: isDark ? '#f8fafc' : '#0f172a',
        textMuted: isDark ? '#cbd5e1' : '#64748b',
        border: isDark ? '#1e293b' : '#e2e8f0',
        inputBg: isDark ? '#020617' : '#ffffff',
        rowHover: isDark ? '#1e293b' : '#f8fafc',
        selectedBg: isDark ? 'rgba(59, 130, 246, 0.15)' : '#eff6ff',
        headerBg: isDark ? '#0f172a' : '#f8fafc',
        legendBg: isDark ? '#020617' : '#f8fafc',
        btnLightBg: isDark ? 'rgba(255, 255, 255, 0.05)' : '#ffffff'
    };

    const getScoreStyle = (rs) => {
        const numRs = Number(rs) || 0;
        if (numRs > 0) return { 
            text: isDark ? '#34d399' : '#059669', 
            bg: isDark ? 'rgba(16, 185, 129, 0.2)' : '#ecfdf5', 
            bar: isDark ? '#10b981' : '#10b981' 
        };
        return { 
            text: isDark ? '#fb7185' : '#b91c1c', 
            bg: isDark ? 'rgba(244, 63, 94, 0.2)' : '#fef2f2', 
            bar: isDark ? '#f43f5e' : '#dc2626' 
        };
    };

    const getConfidenceBadge = (total) => {
        const numTotal = Number(total) || 0;
        const styles = {
            high: { color: isDark ? '#34d399' : '#059669', bg: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ecfdf5', border: isDark ? 'rgba(16, 185, 129, 0.3)' : '#a7f3d0' },
            med: { color: isDark ? '#fbbf24' : '#d97706', bg: isDark ? 'rgba(245, 158, 11, 0.15)' : '#fffbeb', border: isDark ? 'rgba(245, 158, 11, 0.3)' : '#fde68a' },
            low: { color: isDark ? '#f87171' : '#dc2626', bg: isDark ? 'rgba(239, 68, 68, 0.15)' : '#fef2f2', border: isDark ? 'rgba(239, 68, 68, 0.3)' : '#fecaca' }
        };
        if (numTotal >= 10) return <span style={{ color: styles.high.color, backgroundColor: styles.high.bg, border: `1px solid ${styles.high.border}`, padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '800' }}>🛡️ HIGH</span>;
        if (numTotal >= 5) return <span style={{ color: styles.med.color, backgroundColor: styles.med.bg, border: `1px solid ${styles.med.border}`, padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '800' }}>⚖️ MED</span>;
        return <span style={{ color: styles.low.color, backgroundColor: styles.low.bg, border: `1px solid ${styles.low.border}`, padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '800' }}>⚠️ LOW</span>;
    };

    // --- Navigation Handlers ---
    const handleDrillDown = (sectorItem) => {
        setSelectedSector(sectorItem);
        setSearchTerm(''); // Clear search for better UX
    };

    const handleBack = () => {
        setSelectedSector(null);
        setSearchTerm(''); // Clear search for better UX
    };

    // --- The Smart Toggle Engine ---
    const toggleSelection = (item, isMacroView) => {
        if (isMacroView) {
            const industryNames = item.industries ? item.industries.map(ind => ind.industry) : [];
            const allSelected = industryNames.length > 0 && industryNames.every(name => selected.includes(name));

            if (allSelected) {
                setSelected(prev => prev.filter(name => !industryNames.includes(name)));
            } else {
                setSelected(prev => [...new Set([...prev, ...industryNames])]);
            }
        } else {
            const identifier = item.industry;
            setSelected(prev => 
                prev.includes(identifier) 
                    ? prev.filter(i => i !== identifier) 
                    : [...prev, identifier]
            );
        }
    };

    // --- Bulk Selection Actions ---
    const selectPerformers = () => {
        const itemsToAdd = [];
        displayData.forEach(item => {
            if ((Number(item.avg_rs) || 0) > 0) {
                if (!selectedSector && item.industries) {
                    itemsToAdd.push(...item.industries.map(ind => ind.industry));
                } else if (item.industry) {
                    itemsToAdd.push(item.industry);
                }
            }
        });
        setSelected(prev => [...new Set([...prev, ...itemsToAdd])]);
    };

    const selectUnderperformers = () => {
        const itemsToAdd = [];
        displayData.forEach(item => {
            if ((Number(item.avg_rs) || 0) < 0) {
                if (!selectedSector && item.industries) {
                    itemsToAdd.push(...item.industries.map(ind => ind.industry));
                } else if (item.industry) {
                    itemsToAdd.push(item.industry);
                }
            }
        });
        setSelected(prev => [...new Set([...prev, ...itemsToAdd])]);
    };

    const clearAll = () => setSelected([]);

    // --- The Scan Engine ---
    const executeScan = () => {
        if (selected.length > 0 && onScanNavigate) {
            onScanNavigate(selected);
        }
    };

    if (loading) return <div style={{ padding: '40px', textAlign: 'center', fontSize: '15px', fontWeight: '600', color: t.textMuted }}>Analyzing Sector Breadth Data...</div>;

    // --- DATA FILTERING LOGIC ---
    const isMacroView = !selectedSector;
    const sectorData = selectedSector ? (Array.isArray(data) ? data : []).find(s => s.sector === selectedSector.sector) : null;
    const rawDisplayData = (selectedSector && sectorData && sectorData.industries) ? sectorData.industries : data;

    const displayData = [...(Array.isArray(rawDisplayData) ? rawDisplayData : [])]
        .filter(item => {
            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            const target = isMacroView ? (item.sector || "") : (item.industry || "");
            return target.toLowerCase().includes(term);
        })
        .sort((a, b) => (Number(b.avg_rs) || 0) - (Number(a.avg_rs) || 0));

    const gridLayout = '40px 2.5fr 1fr 1.5fr 1fr 1fr';

    return (
        <div style={{ fontFamily: 'Inter, sans-serif', maxWidth: '1200px', margin: '0 auto', paddingBottom: '30px', color: t.textMain }}>
            
            {/* UNIFIED STICKY HEADER */}
            <div style={{ position: 'sticky', top: 0, zIndex: 9999, backgroundColor: t.bgPanel, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', borderRadius: '0 0 8px 8px', borderBottom: `1px solid ${t.border}` }}>
                
                <div style={{ padding: '20px 24px 15px 24px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    
                    {/* Top Row: Title & Legend */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h2 style={{ fontSize: '20px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
                                {selectedSector ? (
                                    <>
                                        <button 
                                            onClick={handleBack}
                                            style={{ cursor: 'pointer', background: isDark ? '#1e293b' : '#0f172a', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}
                                        >
                                            ← BACK
                                        </button>
                                        {selectedSector.sector}
                                    </>
                                ) : 'MACRO SECTOR BREADTH'}
                            </h2>
                            <div style={{ fontSize: '13px', color: t.textMuted, marginTop: '4px', fontWeight: '500' }}>
                                {selectedSector ? 'Filter industries to send to scanner.' : 'Filter sectors to scan or drill down.'}
                            </div>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', backgroundColor: t.legendBg, padding: '8px 12px', borderRadius: '6px', border: `1px solid ${t.border}` }}>
                            <span style={{ fontSize: '12px', fontWeight: '700', color: t.textMuted }}>Conviction Legend:</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: t.textMuted, fontWeight: '500' }}>{getConfidenceBadge(15)} ≥ 10 Stocks</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: t.textMuted, fontWeight: '500' }}>{getConfidenceBadge(7)} 5-9 Stocks</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: t.textMuted, fontWeight: '500' }}>{getConfidenceBadge(2)} &lt; 5 Stocks</div>
                        </div>
                    </div>

                    {/* Bottom Row: Buttons & Search */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={selectPerformers} style={{ backgroundColor: isDark ? 'rgba(34, 197, 94, 0.15)' : '#f0fdf4', color: isDark ? '#4ade80' : '#166534', border: `1px solid ${isDark ? 'rgba(34, 197, 94, 0.3)' : '#bbf7d0'}`, padding: '8px 16px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s' }}>Select Performers</button>
                            <button onClick={selectUnderperformers} style={{ backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#fef2f2', color: isDark ? '#f87171' : '#991b1b', border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.3)' : '#fecaca'}`, padding: '8px 16px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s' }}>Select Underperformers</button>
                            <button onClick={clearAll} style={{ backgroundColor: t.btnLightBg, color: t.textMuted, border: `1px solid ${t.border}`, padding: '8px 16px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s' }}>Clear All</button>
                        </div>

                        {/* SEARCH & SCAN BOX */}
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <input 
                                type="text" 
                                placeholder={isMacroView ? "🔍 Filter Sectors..." : "🔍 Filter Industries..."} 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{ padding: '10px 15px', borderRadius: '6px', border: `1px solid ${t.border}`, fontSize: '13px', width: '220px', outline: 'none', backgroundColor: t.inputBg, color: t.textMain }}
                            />
                            <button 
                                onClick={executeScan}
                                disabled={selected.length === 0}
                                style={{ backgroundColor: selected.length > 0 ? '#2563eb' : t.border, color: selected.length > 0 ? '#ffffff' : t.textMuted, padding: '10px 20px', borderRadius: '6px', fontWeight: '700', border: 'none', cursor: selected.length > 0 ? 'pointer' : 'not-allowed', fontSize: '14px', transition: 'all 0.2s' }}
                            >
                                🚀 SCAN ({selected.length})
                            </button>
                        </div>
                    </div>
                </div>

                {/* Sub-Header Columns */}
                <div style={{ display: 'grid', gridTemplateColumns: gridLayout, gap: '15px', padding: '12px 24px', borderTop: `1px solid ${t.border}`, fontSize: '12px', fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', backgroundColor: t.headerBg }}>
                    <div style={{ textAlign: 'center' }}>✔</div>
                    <div>{isMacroView ? 'Macro Sector' : 'Industry'}</div>
                    <div style={{ textAlign: 'center' }}>Vs Nifty</div>
                    <div>Outperforming Stocks %</div>
                    <div style={{ textAlign: 'center' }}>Conviction</div>
                    <div style={{ textAlign: 'center' }}>D EMA Cross</div>
                </div>
            </div>

            {/* TABLE BODY ROWS */}
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', backgroundColor: t.bgPanel, border: `1px solid ${t.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
                {displayData.map((item, idx) => {
                    const rsRaw = item.avg_rs != null ? Number(item.avg_rs) : null;
                    const rsValue = rsRaw ?? 0;
                    const outperformingPct = Number(item.outperforming_pct) || 0;
                    const title = item.industry || item.sector || "Unknown";
                    const rsDisplay = rsRaw != null ? (rsValue > 0 ? `+${(rsValue * 100).toFixed(1)}%` : `${(rsValue * 100).toFixed(1)}%`) : '--';

                    let isSelected = false;
                    let isPartiallySelected = false;

                    if (isMacroView) {
                        const industryNames = item.industries ? item.industries.map(ind => ind.industry) : [];
                        if (industryNames.length > 0) {
                            isSelected = industryNames.every(name => selected.includes(name));
                            isPartiallySelected = !isSelected && industryNames.some(name => selected.includes(name));
                        }
                    } else {
                        isSelected = selected.includes(item.industry);
                    }

                    const style = rsRaw != null ? getScoreStyle(rsValue) : { bg: 'transparent', text: '#94a3b8', bar: '#94a3b8' };

                    return (
                        <div 
                            key={idx} 
                            onClick={() => toggleSelection(item, isMacroView)}
                            style={{ 
                                display: 'grid', gridTemplateColumns: gridLayout, gap: '15px', padding: '14px 24px', 
                                borderBottom: idx === displayData.length - 1 ? 'none' : `1px solid ${t.border}`, alignItems: 'center',
                                backgroundColor: isSelected ? t.selectedBg : (isPartiallySelected ? t.rowHover : 'transparent'), 
                                cursor: 'pointer', transition: 'background-color 0.15s ease',
                            }}
                            onMouseEnter={(e) => { if(!isSelected) e.currentTarget.style.backgroundColor = t.rowHover }}
                            onMouseLeave={(e) => { if(!isSelected) e.currentTarget.style.backgroundColor = isPartiallySelected ? t.rowHover : 'transparent' }}
                        >
                            <div style={{ textAlign: 'center' }}>
                                <input type="checkbox" checked={isSelected} readOnly style={{ transform: 'scale(1.2)', cursor: 'pointer', accentColor: '#3b82f6' }} />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
                                <div style={{ fontWeight: '700', fontSize: '14px', color: t.textMain }}>{title}</div>
                                
                                {isMacroView ? (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); handleDrillDown(item); }}
                                        style={{ backgroundColor: isDark ? 'rgba(59, 130, 246, 0.1)' : '#f1f5f9', color: '#3b82f6', border: `1px solid ${isDark ? 'rgba(59, 130, 246, 0.2)' : '#e2e8f0'}`, padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    >
                                        📂 View Industries
                                    </button>
                                ) : (
                                    <div style={{ fontSize: '11px', color: t.textMuted, fontWeight: '600', textTransform: 'uppercase' }}>in {item.sector}</div>
                                )}
                            </div>
                            
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                <span style={{ backgroundColor: style.bg, color: style.text, padding: '4px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: '800' }}>
                                    {rsDisplay}
                                </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '700', color: t.textMuted }}>
                                    <span>{outperformingPct}%</span>
                                </div>
                                <div style={{ width: '100%', height: '6px', backgroundColor: t.border, borderRadius: '3px', overflow: 'hidden' }}>
                                    <div style={{ width: `${outperformingPct}%`, height: '100%', backgroundColor: style.bar, borderRadius: '3px' }}></div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                {getConfidenceBadge(item.total_stocks)}
                            </div>

                            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                <div style={{ fontWeight: '800', color: t.textMain, fontSize: '13px' }}>{item.active_crosses || 0}</div>
                                <div style={{ fontWeight: '600', color: t.textMuted, fontSize: '11px' }}>of {item.total_stocks || 0}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SectorHeatmap;