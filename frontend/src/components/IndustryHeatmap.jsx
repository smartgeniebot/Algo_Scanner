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

    // Pro-grade compact score styling (Cool Palette)
    const getScoreStyle = (rs) => {
        const numRs = Number(rs) || 0;
        if (numRs >= 0.05) return { text: '#065f46', bg: '#ecfdf5', bar: '#059669' }; 
        if (numRs > 0) return { text: '#0f766e', bg: '#f0fdfa', bar: '#14b8a6' }; 
        if (numRs > -0.05) return { text: '#991b1b', bg: '#fef2f2', bar: '#dc2626' }; 
        return { text: '#7f1d1d', bg: '#fff1f1', bar: '#b91c1c' }; 
    };

    const getConfidenceBadge = (total) => {
        const numTotal = Number(total) || 0;
        if (numTotal >= 10) return <span style={{ color: '#065f46', backgroundColor: '#d1fae5', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '800', border: '1px solid #a7f3d0' }}>🛡️ HIGH</span>;
        if (numTotal >= 5) return <span style={{ color: '#92400e', backgroundColor: '#fef3c7', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '800', border: '1px solid #fde68a' }}>⚖️ MED</span>;
        return <span style={{ color: '#991b1b', backgroundColor: '#fee2e2', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '800', border: '1px solid #fecaca' }}>⚠️ LOW (&lt;5)</span>;
    };

    const toggleSelection = (industryName) => {
        setSelected(prev => 
            prev.includes(industryName) 
                ? prev.filter(i => i !== industryName) 
                : [...prev, industryName]
        );
    };

    // --- Bulk Selection Actions ---
    const selectPerformers = () => {
        const performers = displayData.filter(item => (Number(item.avg_rs) || 0) > 0).map(item => item.industry);
        setSelected(performers);
    };

    const selectUnderperformers = () => {
        const underperformers = displayData.filter(item => (Number(item.avg_rs) || 0) < 0).map(item => item.industry);
        setSelected(underperformers);
    };

    const clearAll = () => setSelected([]);
    // ----------------------------

    if (loading) return <div style={{ padding: '40px', textAlign: 'center', fontSize: '15px', fontWeight: '600', color: '#64748b' }}>Analyzing Industry Breadth Data...</div>;

    const displayData = [...data].sort((a, b) => {
        const aRS = Number(a.avg_rs) || 0;
        const bRS = Number(b.avg_rs) || 0;
        return bRS - aRS;
    });

    // 6-column grid layout for the table (Slightly wider for labels)
    const gridLayout = '40px 2.8fr 1fr 1.8fr 1.2fr 1.2fr';

    // UI Colors (Slate palette with blue accents)
    const t = {
        bgMain: '#ffffff', bgApp: '#f1f5f9', bgHover: '#f8fafc',
        textMain: '#0f172a', textMuted: '#64748b', textAction: '#2563eb',
        border: '#e2e8f0', borderBlue: '#93c5fd', borderMuted: '#cbd5e1'
    };

    const actionButtonStyle = { padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', transition: 'all 0.15s', outline: 'none' };
    const scanButtonStyle = { backgroundColor: '#2563eb', color: '#ffffff', padding: '10px 20px', borderRadius: '8px', fontWeight: '800', border: 'none', fontSize: '15px', transition: 'all 0.2s' };
    const scanDisabledStyle = { backgroundColor: '#e2e8f0', color: '#94a3b8', cursor: 'not-allowed', boxShadow: 'none' };

    return (
        <div style={{ fontFamily: 'Inter, sans-serif', maxWidth: '1400px', margin: '0 auto', color: t.textMain }}>
            
            {/* MAIN STICKY HEADER & SELECTION PANEL */}
            <div style={{ position: 'sticky', top: 0, backgroundColor: t.bgMain, zIndex: 9999, padding: '20px 30px', borderBottom: `2px solid ${t.border}`, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                    <div>
                        <h2 style={{ fontSize: '22px', fontWeight: '900', color: t.textMain, margin: 0, letterSpacing: '-0.5px' }}>ALL INDUSTRIES BREADTH</h2>
                        <div style={{ fontSize: '13px', color: t.textMuted, marginTop: '4px', fontWeight: '600' }}>Deep dive into relative industry strength Vs Nifty (Current Session).</div>
                    </div>
                    
                    {/* CONVICTION LEGEND - RESTORED & PERMANENT */}
                    <div style={{ display: 'flex', gap: '10px', fontSize: '11px', backgroundColor: t.bgHover, padding: '8px 15px', borderRadius: '8px', border: `1px solid ${t.border}` }}>
                        <span style={{color:t.textMuted, fontWeight:'800', marginRight:'5px', textTransform:'uppercase'}}>Conviction Key:</span>
                        {getConfidenceBadge(15)} {getConfidenceBadge(7)} {getConfidenceBadge(2)}
                    </div>
                </div>

                {/* BULK SELECTION PANEL */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${t.border}`, paddingTop: '15px' }}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button onClick={selectPerformers} style={{ ...actionButtonStyle, color: t.textAction, backgroundColor: '#eff6ff', border: `1px solid ${t.borderBlue}` }} onMouseEnter={e=>e.target.style.backgroundColor='#dbeafe'} onMouseLeave={e=>e.target.style.backgroundColor='#eff6ff'}>🟢 Select All Performers</button>
                        <button onClick={selectUnderperformers} style={{ ...actionButtonStyle, color: '#dc2626', backgroundColor: '#fef2f2', border: `1px solid #fecaca` }} onMouseEnter={e=>e.target.style.backgroundColor='#fee2e2'} onMouseLeave={e=>e.target.style.backgroundColor='#fef2f2'}>🔴 Select All Underperformers</button>
                        <button onClick={clearAll} style={{ ...actionButtonStyle, color: t.textMuted, backgroundColor: t.bgMain, border: `1px solid ${t.borderMuted}` }} onMouseEnter={e=>e.target.style.backgroundColor=t.bgHover} onMouseLeave={e=>e.target.style.backgroundColor=t.bgMain}>❌ Clear All ({selected.length})</button>
                    </div>

                    {/* SCAN BUTTON - PERMANENT, ENABLED ON SELECTION */}
                    <button 
                        onClick={() => selected.length > 0 && onScanNavigate(selected)}
                        style={{ ...scanButtonStyle, ...(selected.length === 0 ? scanDisabledStyle : { cursor: 'pointer', boxShadow: '0 4px 10px -1px rgba(37, 99, 235, 0.4)' }) }}
                        disabled={selected.length === 0}
                    >
                        🚀 SCAN SELECTED ({selected.length})
                    </button>
                </div>
            </div>

            {/* TABLE BODY (Contains Table Headers) */}
            <div style={{ padding: '0 30px 30px 30px', backgroundColor: t.bgApp }}>
                
                {/* TABLE COLUMN HEADERS - STICKS BELOW MAIN HEADER (Approx 135px down) */}
                <div style={{ display: 'grid', gridTemplateColumns: gridLayout, gap: '15px', padding: '15px 20px', borderBottom: `2px solid ${t.borderMuted}`, fontSize: '12px', fontWeight: '800', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.7px', position: 'sticky', top: '135px', backgroundColor: t.bgApp, zIndex: 9998 }}>
                    <div style={{ textAlign: 'center' }}>✔</div>
                    <div>Industry & Sector</div>
                    <div style={{ textAlign: 'center' }}>Vs Nifty</div>
                    <div>Outperforming Stocks %</div>
                    <div style={{ textAlign: 'center' }}>Conviction</div>
                    <div style={{ textAlign: 'right' }}>D EMA Cross</div>
                </div>

                {/* TABLE BODY ROWS */}
                <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: t.bgMain, border: `1px solid ${t.borderMuted}`, borderTop: 'none', borderRadius: '0 0 10px 10px', boxShadow: '0 2px 5px rgba(0,0,0,0.03)', overflow: 'hidden' }}>
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
                                    display: 'grid', gridTemplateColumns: gridLayout, gap: '15px', padding: '16px 20px', 
                                    borderBottom: idx === displayData.length - 1 ? 'none' : `1px solid ${t.border}`, alignItems: 'center',
                                    backgroundColor: isSelected ? '#eff6ff' : t.bgMain, cursor: 'pointer', transition: 'background-color 0.1s ease',
                                }}
                                onMouseEnter={(e) => { if(!isSelected) e.currentTarget.style.backgroundColor = t.bgHover }}
                                onMouseLeave={(e) => { if(!isSelected) e.currentTarget.style.backgroundColor = t.bgMain }}
                            >
                                <div style={{ textAlign: 'center' }}>
                                    <input 
                                        type="checkbox" checked={isSelected} readOnly 
                                        style={{ transform: 'scale(1.25)', cursor: 'pointer', accentColor: '#2563eb' }}
                                    />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                    <div style={{ fontWeight: '800', fontSize: '15px', color: t.textMain, letterSpacing: '-0.2px', textTransform: 'capitalize' }}>{title.toLowerCase()}</div>
                                    <div style={{ fontSize: '11px', color: t.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing:'0.5px' }}>in {item.sector}</div>
                                </div>
                                
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    <span style={{ color: style.text, padding: '4px 10px', borderRadius: '6px', fontSize: '14px', fontWeight: '900', border: `1px solid ${style.bar}` }}>
                                        {rsValue > 0 ? `+${rsPercent}%` : `${rsPercent}%`}
                                    </span>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', justifyContent: 'center' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems:'baseline' }}>
                                        <span style={{ fontWeight: '800', color: style.text, fontSize: '15px' }}>{outperformingPct}%</span>
                                        <span style={{ fontSize: '10px', fontWeight:'700', color: t.textMuted }}>of {item.total_stocks} STOCKS</span>
                                    </div>
                                    <div style={{ width: '100%', height: '8px', backgroundColor: t.bgApp, borderRadius: '4px', overflow: 'hidden' }}>
                                        <div style={{ width: `${outperformingPct}%`, height: '100%', backgroundColor: style.bar, borderRadius: '4px' }}></div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    {getConfidenceBadge(item.total_stocks)}
                                </div>

                                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <div style={{ fontWeight: '900', color: t.textMain, fontSize: '15px' }}>{item.active_crosses || 0}</div>
                                    <div style={{ fontWeight: '700', color: t.textMuted, fontSize: '11px' }}>({item.total_stocks || 0} TOTAL)</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default IndustryHeatmap;