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
        setSearchTerm(''); // Clear search when diving in
    };

    const handleBack = () => {
        setSelectedSector(null);
        setSearchTerm(''); // Clear search when coming out
    };

    const toggleSelection = (item, isMacroView) => {
        if (isMacroView) {
            const industryNames = item.industries ? item.industries.map(ind => ind.industry) : [];
            const allSelected = industryNames.length > 0 && industryNames.every(name => selected.includes(name));
            setSelected(prev => allSelected ? prev.filter(name => !industryNames.includes(name)) : [...new Set([...prev, ...industryNames])]);
        } else {
            const identifier = item.industry;
            setSelected(prev => prev.includes(identifier) ? prev.filter(i => i !== identifier) : [...prev, identifier]);
        }
    };

    const selectPerformers = () => {
        const itemsToAdd = displayData.filter(item => (Number(item?.avg_rs) || 0) > 0).flatMap(item => !selectedSector ? item.industries.map(i => i.industry) : [item.industry]);
        setSelected(prev => [...new Set([...prev, ...itemsToAdd])]);
    };

    const selectUnderperformers = () => {
        const itemsToAdd = displayData.filter(item => (Number(item?.avg_rs) || 0) < 0).flatMap(item => !selectedSector ? item.industries.map(i => i.industry) : [item.industry]);
        setSelected(prev => [...new Set([...prev, ...itemsToAdd])]);
    };

    const clearAll = () => setSelected([]);

    if (loading) return <div style={{ padding: '40px', textAlign: 'center', fontSize: '15px', fontWeight: '600', color: '#64748b' }}>Analyzing Sector Breadth Data...</div>;

    const isMacroView = !selectedSector;
    const rawDisplayData = selectedSector ? selectedSector.industries : data;

    // --- SEARCH & SORT LOGIC ---
    const displayData = (Array.isArray(rawDisplayData) ? rawDisplayData : [])
        .filter(item => {
            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            const target = isMacroView ? item?.sector : item?.industry;
            return target?.toLowerCase().includes(term);
        })
        .sort((a, b) => (Number(b?.avg_rs) || 0) - (Number(a?.avg_rs) || 0));

    const gridLayout = '40px 2.5fr 1fr 1.5fr 1fr 1fr';

    return (
        <div style={{ fontFamily: 'Inter, sans-serif', maxWidth: '1200px', margin: '0 auto', paddingBottom: '30px' }}>
            <div style={{ position: 'sticky', top: 0, zIndex: 9999, backgroundColor: '#ffffff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', borderRadius: '0 0 8px 8px' }}>
                <div style={{ padding: '20px 24px 15px 24px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', margin: 0 }}>{selectedSector ? selectedSector.sector : 'MACRO SECTOR BREADTH'}</h2>
                            {selectedSector && <button onClick={handleBack} style={{ fontSize: '11px', marginTop: '5px', cursor: 'pointer' }}>← Back to Sectors</button>}
                        </div>
                        <div style={{ display: 'flex', gap: '15px' }}>{getConfidenceBadge(15)} {getConfidenceBadge(7)} {getConfidenceBadge(2)}</div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={selectPerformers} style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', backgroundColor: '#f0fdf4' }}>Performers</button>
                            <button onClick={selectUnderperformers} style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', backgroundColor: '#fef2f2' }}>Underperformers</button>
                            <button onClick={clearAll} style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>Clear</button>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <input 
                                type="text" 
                                placeholder={isMacroView ? "🔍 Filter Sectors..." : "🔍 Filter Industries..."} 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{ padding: '10px 15px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '13px', width: '220px', outline: 'none' }}
                            />
                            <button onClick={() => onScanNavigate(selected)} disabled={selected.length === 0} style={{ backgroundColor: selected.length > 0 ? '#2563eb' : '#e2e8f0', color: '#fff', padding: '10px 20px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}>🚀 SCAN ({selected.length})</button>
                        </div>
                    </div>
                </div>
                {/* Column Headers omitted for brevity - same as industry */}
            </div>
            {/* Table Rows logic similar to Industry Heatmap but using isMacroView for toggleSelection */}
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderTop: 'none' }}>
                {displayData.map((item, idx) => {
                    const identifier = isMacroView ? item.sector : item.industry;
                    const isSelected = isMacroView ? (item.industries?.every(i => selected.includes(i.industry))) : selected.includes(identifier);
                    return (
                        <div key={idx} onClick={() => toggleSelection(item, isMacroView)} style={{ display: 'grid', gridTemplateColumns: gridLayout, gap: '15px', padding: '14px 24px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', backgroundColor: isSelected ? '#eff6ff' : '#ffffff', cursor: 'pointer' }}>
                            <div style={{ textAlign: 'center' }}><input type="checkbox" checked={isSelected} readOnly /></div>
                            <div>
                                <div style={{ fontWeight: '700' }}>{identifier}</div>
                                {isMacroView && <button onClick={(e) => { e.stopPropagation(); handleDrillDown(item); }} style={{ fontSize: '10px', cursor: 'pointer' }}>📂 View Industries</button>}
                            </div>
                            {/* Score, Bar, and Crosses columns same as industry */}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SectorHeatmap;