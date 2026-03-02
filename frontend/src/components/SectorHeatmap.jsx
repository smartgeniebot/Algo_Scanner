import React, { useEffect, useState } from 'react';

const SectorHeatmap = () => {
    const [data, setData] = useState([]);
    const [selectedSector, setSelectedSector] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('http://127.0.0.1:8000/api/sector-heatmap')
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

    const getCardStyle = (rs) => {
        const numRs = Number(rs) || 0;
        if (numRs >= 0.05) return { bg: '#e8f8f5', border: '#2ecc71', text: '#27ae60', bar: '#2ecc71' }; 
        if (numRs > 0) return { bg: '#f4fcf7', border: '#82e0aa', text: '#2ecc71', bar: '#82e0aa' }; 
        if (numRs > -0.05) return { bg: '#fdedec', border: '#e74c3c', text: '#c0392b', bar: '#e74c3c' }; 
        return { bg: '#fadbd8', border: '#c0392b', text: '#922b21', bar: '#c0392b' }; 
    };

    const getConfidenceBadge = (total) => {
        const numTotal = Number(total) || 0;
        if (numTotal >= 10) return <span style={{ color: '#27ae60', fontWeight: 'bold' }}>🛡️ High Conviction</span>;
        if (numTotal >= 5) return <span style={{ color: '#f39c12', fontWeight: 'bold' }}>⚖️ Med Conviction</span>;
        return <span style={{ color: '#c0392b', fontWeight: 'bold' }}>⚠️ Low Sample (&lt;5)</span>;
    };

    if (loading) return <div style={{ padding: '40px', textAlign: 'center', fontSize: '18px', fontWeight: 'bold', color: '#0d47a1' }}>Analyzing Breadth Data...</div>;

    const sectorData = selectedSector ? data.find(s => s.sector === selectedSector.sector) : null;
    const rawDisplayData = (selectedSector && sectorData && sectorData.industries) ? sectorData.industries : data;

    const displayData = [...(Array.isArray(rawDisplayData) ? rawDisplayData : [])].sort((a, b) => {
        const aRS = Number(a.avg_rs) || 0;
        const bRS = Number(b.avg_rs) || 0;
        return bRS - aRS;
    });

    return (
        <div style={{ fontFamily: 'Inter, sans-serif' }}>
            
            <div style={{ position: 'sticky', top: 0, backgroundColor: '#fcfcfc', zIndex: 10, padding: '20px 30px 15px 30px', borderBottom: '2px solid #e3f2fd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: '900', color: '#0d47a1', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {selectedSector ? (
                            <React.Fragment>
                                <button 
                                    onClick={() => setSelectedSector(null)}
                                    style={{ cursor: 'pointer', background: '#0d47a1', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: '4px', fontSize: '14px', fontWeight: 'bold' }}
                                >
                                    ← BACK
                                </button>
                                {selectedSector.sector} Industries
                            </React.Fragment>
                        ) : 'MACRO SECTOR BREADTH'}
                    </h2>
                    <div style={{ fontSize: '13px', color: '#555', marginTop: '5px', fontWeight: '600' }}>
                        Click any sector to drill down into underlying industries.
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '15px', fontSize: '12px', backgroundColor: '#f8f9fa', padding: '8px 15px', borderRadius: '6px', border: '1px solid #ddd' }}>
                    {getConfidenceBadge(15)}
                    {getConfidenceBadge(7)}
                    {getConfidenceBadge(2)}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px', padding: '20px 30px' }}>
                {displayData.map((item, idx) => {
                    const rsValue = Number(item.avg_rs) || 0;
                    const outperformingPct = Number(item.outperforming_pct) || 0; 
                    
                    const style = getCardStyle(rsValue);
                    const title = item.industry || item.sector || "Unknown"; 
                    const rsPercent = (rsValue * 100).toFixed(1);

                    return (
                        <div 
                            key={idx} 
                            onClick={() => !selectedSector && setSelectedSector(item)}
                            style={{ 
                                backgroundColor: style.bg, 
                                border: `2px solid ${style.border}`, 
                                padding: '18px', 
                                borderRadius: '10px', 
                                cursor: !selectedSector ? 'pointer' : 'default',
                                boxShadow: '0 4px 6px rgba(0,0,0,0.02)',
                                transition: 'transform 0.1s',
                                display: 'flex', flexDirection: 'column', gap: '12px'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ fontWeight: '900', fontSize: '17px', color: '#111', width: '65%', lineHeight: '1.2' }}>{title}</div>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: '#fff', padding: '6px 10px', borderRadius: '6px', border: `1px solid ${style.border}`, minWidth: '70px' }}>
                                    <span style={{ fontSize: '10px', fontWeight: '800', color: '#7f8c8d', marginBottom: '2px' }}>Vs NIFTY</span>
                                    <span style={{ fontSize: '16px', fontWeight: '900', color: style.text }}>{rsValue > 0 ? `+${rsPercent}%` : `${rsPercent}%`}</span>
                                </div>
                            </div>

                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '800', marginBottom: '4px', color: '#333', textTransform: 'uppercase' }}>
                                    <span>Outperforming Stocks:</span>
                                    <span>{outperformingPct}%</span>
                                </div>
                                <div style={{ width: '100%', height: '10px', backgroundColor: '#ddd', borderRadius: '5px', overflow: 'hidden' }}>
                                    <div style={{ width: `${outperformingPct}%`, height: '100%', backgroundColor: style.bar }}></div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: '10px', fontSize: '13px' }}>
                                <div>{getConfidenceBadge(item.total_stocks)}</div>
                                <div style={{ textAlign: 'right', lineHeight: '1.2' }}>
                                    <div style={{ fontWeight: '900', color: '#111', fontSize: '13px' }}><span style={{ color: style.text, fontSize: '15px' }}>{item.active_crosses || 0}</span> EMA Crosses</div>
                                    <div style={{ fontWeight: '700', color: '#777', fontSize: '11px' }}>of {item.total_stocks || 0} Total Stocks</div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SectorHeatmap;