import React, { useEffect, useState } from 'react';

const IndustryHeatmap = ({ onScanNavigate }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState([]);

    useEffect(() => {
        fetch('https://algo-scanner-lnck.onrender.com/api/industry-heatmap')
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

    // Pro-grade compact score styling
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
        return <span style={{ color: '#dc2626', backgroundColor: '#fef2f2', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>⚠️ LOW (&lt;5)</span>;
    };

    const toggleSelection = (industryName) => {
        setSelected(prev => 
            prev.includes(industryName) 
                ? prev.filter(i => i !== industryName) 
                : [...prev, industryName]
        );
    };

    if (loading) return <div style={{ padding: '40px', textAlign: 'center', fontSize: '15px', fontWeight: '600', color: '#64748b' }}>Analyzing Industry Breadth Data...</div>;

    const displayData = [...data].sort((a, b) => {
        const aRS = Number(a.avg_rs) || 0;
        const bRS = Number(b.avg_rs) || 0;
        return bRS - aRS;
    });

    // 6-column grid layout for the table
    const gridLayout = '40px 2.5fr 1fr 1.5fr 1fr 1fr';

    return (
        <div style={{ fontFamily: 'Inter, sans-serif', padding: '0 20px 20px 20px', maxWidth: '1200px', margin: '0 auto' }}>
            
            {/* MAIN STICKY HEADER */}
            <div style={{ position: 'sticky', top: 0, backgroundColor: '#ffffff', zIndex: 9999, padding: '20px 0 15px 0', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', margin: 0 }}>ALL INDUSTRIES BREADTH</h2>
                    <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px', fontWeight: '500' }}>Select rows to send directly to the scanner.</div>
                </div>

                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    {selected.length > 0 && (
                        <button 
                            onClick={() => onScanNavigate(selected)}
                            style={{ backgroundColor: '#2563eb', color: '#fff', padding: '8px 16px', borderRadius: '6px', fontWeight: '700', border: 'none', cursor: 'pointer', fontSize: '14px', transition: 'all 0.2s', boxShadow: '0 2px 4px rgba(37,99,235,0.2)' }}
                        >
                            🚀 SCAN SELECTED ({selected.length})
                        </button>
                    )}
                </div>
            </div>

            {/* TABLE COLUMN HEADERS - STICKS JUST BELOW MAIN HEADER */}
            <div style={{ display: 'grid', gridTemplateColumns: gridLayout, gap: '15px', padding: '12px 16px', borderBottom: '2px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', position: 'sticky', top: '75px', backgroundColor: '#f8fafc', zIndex: 9998, borderRadius: '8px 8px 0 0', marginTop: '20px' }}>
                <div style={{ textAlign: 'center' }}>✔</div>
                <div>Industry & Sector</div>
                <div style={{ textAlign: 'center' }}>Vs NIFTY</div>
                <div>Outperforming</div>
                <div style={{ textAlign: 'center' }}>Conviction</div>
                <div style={{ textAlign: 'right' }}>EMA Crosses</div>
            </div>

            {/* TABLE BODY ROWS */}
            <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 8px 8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                {displayData.map((item, idx) => {
                    const rsValue = Number(item.avg_rs) || 0;
                    const outperformingPct = Number(item.outperforming_pct) || 0; 
                    const isSelected = selected.includes(item.industry);
                    
                    const style = getScoreStyle(rsValue);
                    const title = item.industry || "Unknown"; 
                    const rsPercent = (rsValue * 100).toFixed(1);

                    return (
                        <div 
                            key={idx} 
                            onClick={() => toggleSelection(item.industry)}
                            style={{ 
                                display: 'grid', 
                                gridTemplateColumns: gridLayout, 
                                gap: '15px', 
                                padding: '14px 16px', 
                                borderBottom: idx === displayData.length - 1 ? 'none' : '1px solid #f1f5f9',
                                alignItems: 'center',
                                backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                                cursor: 'pointer',
                                transition: 'background-color 0.15s ease',
                            }}
                            onMouseEnter={(e) => { if(!isSelected) e.currentTarget.style.backgroundColor = '#f8fafc' }}
                            onMouseLeave={(e) => { if(!isSelected) e.currentTarget.style.backgroundColor = '#ffffff' }}
                        >
                            <div style={{ textAlign: 'center' }}>
                                <input 
                                    type="checkbox" 
                                    checked={isSelected} 
                                    readOnly 
                                    style={{ transform: 'scale(1.2)', cursor: 'pointer', accentColor: '#2563eb' }}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div style={{ fontWeight: '700', fontSize: '14px', color: '#0f172a' }}>{title}</div>
                                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>{item.sector}</div>
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

                            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '2px' }}>
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

export default IndustryHeatmap;