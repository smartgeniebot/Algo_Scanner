import React, { useEffect, useState } from 'react';

const SectorHeatmap = ({ onScanNavigate }) => {
    const [data, setData] = useState([]);
    const [selectedSector, setSelectedSector] = useState(null);
    const [loading, setLoading] = useState(true);
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

    const handleDrillDown = (sectorItem) => {
        setSelectedSector(sectorItem);
        setSearchTerm(''); // Clear search for better UX
    };

    const handleBack = () => {
        setSelectedSector(null);
        setSearchTerm(''); // Clear search for better UX
    };

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
            setSelected(prev => prev.includes(identifier) ? prev.filter(i => i !== identifier) : [...prev, identifier]);
        }
    };

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

    const executeScan = () => {
        if (selected.length > 0 && onScanNavigate) {
            onScanNavigate(selected);
        }
    };

    if (loading) return <div style={{ padding: '40px', textAlign: 'center', fontSize: '15px', fontWeight: '600', color: '#64748b' }}>Analyzing Sector Breadth Data...</div>;

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
        <div style={{ fontFamily: 'Inter, sans-serif', maxWidth: '1200px', margin: '0 auto', paddingBottom: '30px' }}>
            
            <div style={{ position: 'sticky', top: 0, zIndex: 9999, backgroundColor: '#ffffff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', borderRadius: '0 0 8px 8px' }}>
                
                <div style={{ padding: '20px 24px 15px 24px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
                                {selectedSector ? (
                                    <>
                                        <button 
                                            onClick={handleBack}
                                            style={{ cursor: 'pointer', background: '#0f172a', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}
                                        >
                                            ← BACK
                                        </button>
                                        {selectedSector.sector}
                                    </>
                                ) : 'MACRO SECTOR BREADTH'}
                            </h2>
                            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px', fontWeight: '500' }}>
                                {selectedSector ? 'Filter industries to send to scanner.' : 'Filter sectors to scan or drill down.'}
                            </div>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '12px', fontWeight: '700', color: '#475569' }}>Legend:</span>
                            {getConfidenceBadge(15)} {getConfidenceBadge(7)} {getConfidenceBadge(2)}
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={selectPerformers} style={{ backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '8px 16px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer' }}>Select Performers</button>
                            <button onClick={selectUnderperformers} style={{ backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', padding: '8px 16px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer' }}>Select Underperformers</button>
                            <button onClick={clearAll} style={{ backgroundColor: '#ffffff', color: '#64748b', border: '1px solid #e2e8f0', padding: '8px 16px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer' }}>Clear All</button>
                        </div>

                        {/* SEARCH & SCAN BOX */}
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <input 
                                type="text" 
                                placeholder={isMacroView ? "🔍 Filter Sectors..." : "🔍 Filter Industries..."} 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{ padding: '10px 15px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '13px', width: '220px', outline: 'none' }}
                            />
                            <button 
                                onClick={executeScan}
                                disabled={selected.length === 0}
                                style={{ backgroundColor: selected.length > 0 ? '#2563eb' : '#e2e8f0', color: selected.length > 0 ? '#ffffff' : '#94a3b8', padding: '10px 20px', borderRadius: '6px', fontWeight: '700', border: 'none', cursor: selected.length > 0 ? 'pointer' : 'not-allowed', fontSize: '14px' }}
                            >
                                🚀 SCAN ({selected.length})
                            </button>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: gridLayout, gap: '15px', padding: '12px 24px', borderTop: '1px solid #e2e8f0', borderBottom: '2px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', backgroundColor: '#f8fafc' }}>
                    <div style={{ textAlign: 'center' }}>✔</div>
                    <div>{isMacroView ? 'Macro Sector' : 'Industry'}</div>
                    <div style={{ textAlign: 'center' }}>Vs Nifty</div>
                    <div>Outperforming Stocks %</div>
                    <div style={{ textAlign: 'center' }}>Conviction</div>
                    <div style={{ textAlign: 'center' }}>D EMA Cross</div>
                </div>
            </div>

            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
                {displayData.map((item, idx) => {
                    const rsValue = Number(item.avg_rs) || 0;
                    const outperformingPct = Number(item.outperforming_pct) || 0; 
                    const title = item.industry || item.sector || "Unknown"; 
                    const rsPercent = (rsValue * 100).toFixed(1);

                    let isSelected = false;
                    if (isMacroView) {
                        const industryNames = item.industries ? item.industries.map(ind => ind.industry) : [];
                        isSelected = industryNames.length > 0 && industryNames.every(name => selected.includes(name));
                    } else {
                        isSelected = selected.includes(item.industry);
                    }

                    const style = getScoreStyle(rsValue);

                    return (
                        <div key={idx} onClick={() => toggleSelection(item, isMacroView)} style={{ display: 'grid', gridTemplateColumns: gridLayout, gap: '15px', padding: '14px 24px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', backgroundColor: isSelected ? '#eff6ff' : '#ffffff', cursor: 'pointer' }}>
                            <div style={{ textAlign: 'center' }}><input type="checkbox" checked={isSelected} readOnly style={{ accentColor: '#2563eb' }} /></div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
                                <div style={{ fontWeight: '700', fontSize: '14px', color: '#0f172a' }}>{title}</div>
                                {isMacroView ? (
                                    <button onClick={(e) => { e.stopPropagation(); handleDrillDown(item); }} style={{ backgroundColor: '#f1f5f9', color: '#3b82f6', border: '1px solid #e2e8f0', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>📂 View Industries</button>
                                ) : (
                                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>in {item.sector}</div>
                                )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'center' }}><span style={{ backgroundColor: style.bg, color: style.text, padding: '4px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: '800' }}>{rsValue > 0 ? `+${rsPercent}%` : `${rsPercent}%`}</span></div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center' }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '700' }}><span>{outperformingPct}%</span></div><div style={{ width: '100%', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}><div style={{ width: `${outperformingPct}%`, height: '100%', backgroundColor: style.bar, borderRadius: '3px' }}></div></div></div>
                            <div style={{ display: 'flex', justifyContent: 'center' }}>{getConfidenceBadge(item.total_stocks)}</div>
                            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}><div style={{ fontWeight: '800', color: '#0f172a', fontSize: '13px' }}>{item.active_crosses || 0}</div><div style={{ fontWeight: '600', color: '#64748b', fontSize: '11px' }}>of {item.total_stocks || 0}</div></div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SectorHeatmap;