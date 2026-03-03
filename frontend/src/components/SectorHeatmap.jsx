import React, { useEffect, useState } from 'react';

const SectorHeatmap = ({ onScanNavigate, theme }) => {
    const [data, setData] = useState([]);
    const [selectedSector, setSelectedSector] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState([]); 
    const [searchTerm, setSearchTerm] = useState('');

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

    const isDark = theme === 'dark';
    const t = {
        bgApp: isDark ? '#020617' : '#f1f5f9',
        bgPanel: isDark ? '#0f172a' : '#ffffff',
        textMain: isDark ? '#f8fafc' : '#0f172a',
        textMuted: isDark ? '#cbd5e1' : '#64748b',
        border: isDark ? '#1e293b' : '#e2e8f0',
        inputBg: isDark ? '#020617' : '#ffffff',
        rowHover: isDark ? '#1e293b' : '#f8fafc',
        selectedBg: isDark ? 'rgba(59, 130, 246, 0.15)' : '#eff6ff'
    };

    const getScoreStyle = (rs) => {
        const numRs = Number(rs) || 0;
        if (numRs > 0) return { text: isDark ? '#34d399' : '#059669', bg: isDark ? 'rgba(16, 185, 129, 0.2)' : '#ecfdf5', bar: '#10b981' };
        return { text: isDark ? '#fb7185' : '#b91c1c', bg: isDark ? 'rgba(244, 63, 94, 0.2)' : '#fef2f2', bar: '#dc2626' };
    };

    const getConfidenceBadge = (total) => {
        const numTotal = Number(total) || 0;
        if (numTotal >= 10) return <span style={{ color: isDark ? '#34d399' : '#059669', backgroundColor: isDark ? 'rgba(16, 185, 129, 0.1)' : '#ecfdf5', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>🛡️ HIGH</span>;
        if (numTotal >= 5) return <span style={{ color: isDark ? '#fbbf24' : '#d97706', backgroundColor: isDark ? 'rgba(245, 158, 11, 0.1)' : '#fffbeb', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>⚖️ MED</span>;
        return <span style={{ color: isDark ? '#f87171' : '#dc2626', backgroundColor: isDark ? 'rgba(239, 68, 68, 0.1)' : '#fef2f2', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>⚠️ LOW</span>;
    };

    const isMacroView = !selectedSector;
    const rawDisplayData = selectedSector ? selectedSector.industries : data;

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
            <div style={{ position: 'sticky', top: 0, zIndex: 9999, backgroundColor: t.bgPanel, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.2)', borderRadius: '0 0 8px 8px', borderBottom: `1px solid ${t.border}` }}>
                <div style={{ padding: '20px 24px 15px 24px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h2 style={{ fontSize: '20px', fontWeight: '800', margin: 0 }}>
                                {selectedSector ? (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <button onClick={() => { setSelectedSector(null); setSearchTerm(''); }} style={{ cursor: 'pointer', background: isDark ? '#1e293b' : '#0f172a', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px' }}>← BACK</button>
                                        {selectedSector.sector}
                                    </span>
                                ) : 'MACRO SECTOR BREADTH'}
                            </h2>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>{getConfidenceBadge(15)} {getConfidenceBadge(7)} {getConfidenceBadge(2)}</div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => setSelected(prev => [...new Set([...prev, ...displayData.filter(i => (i.avg_rs||0)>0).map(i => i.industry||i.sector)])])} style={{ backgroundColor: isDark ? 'rgba(34, 197, 94, 0.15)' : '#f0fdf4', color: isDark ? '#4ade80' : '#166534', border: `1px solid ${isDark ? 'rgba(34, 197, 94, 0.3)' : '#bbf7d0'}`, padding: '8px 16px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer' }}>Performers</button>
                            <button onClick={() => setSelected([])} style={{ backgroundColor: t.bgApp, color: t.textMuted, border: `1px solid ${t.border}`, padding: '8px 16px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer' }}>Clear All</button>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <input type="text" placeholder="🔍 Filter..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ padding: '10px 15px', borderRadius: '6px', border: `1px solid ${t.border}`, fontSize: '13px', width: '200px', outline: 'none', backgroundColor: t.inputBg, color: t.textMain }} />
                            <button onClick={() => onScanNavigate(selected)} disabled={selected.length === 0} style={{ backgroundColor: selected.length > 0 ? '#3b82f6' : t.border, color: '#fff', padding: '10px 20px', borderRadius: '6px', border: 'none', cursor: 'pointer' }}>🚀 SCAN ({selected.length})</button>
                        </div>
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: gridLayout, gap: '15px', padding: '12px 24px', borderTop: `1px solid ${t.border}`, fontSize: '12px', fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', backgroundColor: t.bgApp }}>
                    <div style={{ textAlign: 'center' }}>✔</div>
                    <div>{isMacroView ? 'Macro Sector' : 'Industry'}</div>
                    <div style={{ textAlign: 'center' }}>Vs Nifty</div>
                    <div>Outperforming %</div>
                    <div style={{ textAlign: 'center' }}>Conviction</div>
                    <div style={{ textAlign: 'center' }}>D EMA Cross</div>
                </div>
            </div>

            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', backgroundColor: t.bgPanel, border: `1px solid ${t.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
                {displayData.map((item, idx) => {
                    const identifier = isMacroView ? item.sector : item.industry;
                    const industryNames = item.industries ? item.industries.map(ind => ind.industry) : [];
                    const isSelected = isMacroView ? (industryNames.length > 0 && industryNames.every(name => selected.includes(name))) : selected.includes(identifier);
                    const style = getScoreStyle(item.avg_rs);

                    return (
                        <div key={idx} onClick={() => {
                            if (isMacroView) {
                                setSelected(prev => isSelected ? prev.filter(name => !industryNames.includes(name)) : [...new Set([...prev, ...industryNames])]);
                            } else {
                                setSelected(prev => prev.includes(identifier) ? prev.filter(i => i !== identifier) : [...prev, identifier]);
                            }
                        }} style={{ display: 'grid', gridTemplateColumns: gridLayout, gap: '15px', padding: '14px 24px', borderBottom: `1px solid ${t.border}`, alignItems: 'center', backgroundColor: isSelected ? t.selectedBg : 'transparent', cursor: 'pointer' }} onMouseEnter={e => !isSelected && (e.currentTarget.style.backgroundColor = t.rowHover)} onMouseLeave={e => !isSelected && (e.currentTarget.style.backgroundColor = 'transparent')}>
                            <div style={{ textAlign: 'center' }}><input type="checkbox" checked={isSelected} readOnly style={{ accentColor: '#3b82f6' }} /></div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{ fontWeight: '700' }}>{identifier}</div>
                                {isMacroView && <button onClick={(e) => { e.stopPropagation(); setSelectedSector(item); setSearchTerm(''); }} style={{ backgroundColor: isDark ? 'rgba(59, 130, 246, 0.1)' : '#f1f5f9', color: '#3b82f6', border: `1px solid ${isDark ? 'rgba(59, 130, 246, 0.2)' : '#e2e8f0'}`, padding: '4px 8px', borderRadius: '4px', fontSize: '10px', width: 'fit-content', cursor: 'pointer' }}>📂 View Industries</button>}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'center' }}><span style={{ backgroundColor: style.bg, color: style.text, padding: '4px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: '800' }}>{(item.avg_rs * 100).toFixed(1)}%</span></div>
                            <div style={{ width: '100%', padding: '0 10px' }}><div style={{ width: '100%', height: '6px', backgroundColor: t.border, borderRadius: '3px' }}><div style={{ width: `${item.outperforming_pct}%`, height: '100%', backgroundColor: style.bar, borderRadius: '3px' }}></div></div></div>
                            <div style={{ display: 'flex', justifyContent: 'center' }}>{getConfidenceBadge(item.total_stocks)}</div>
                            <div style={{ textAlign: 'center' }}><div style={{ fontWeight: '800', fontSize: '13px' }}>{item.active_crosses || 0}</div><div style={{ fontSize: '11px', color: t.textMuted }}>of {item.total_stocks || 0}</div></div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SectorHeatmap;