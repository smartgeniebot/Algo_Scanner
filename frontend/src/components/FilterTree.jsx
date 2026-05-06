import React, { useState, useMemo } from 'react';

function Checkbox({ checked, indeterminate, accentColor }) {
  return (
    <div style={{
      width: '15px', height: '15px', flexShrink: 0,
      border: `2px solid ${checked || indeterminate ? accentColor : '#94a3b8'}`,
      borderRadius: '3px',
      backgroundColor: checked ? accentColor : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.15s',
      pointerEvents: 'none',
    }}>
      {checked && <span style={{ color: '#fff', fontSize: '10px', fontWeight: '900', lineHeight: 1 }}>✓</span>}
      {indeterminate && !checked && <span style={{ color: accentColor, fontSize: '12px', fontWeight: '900', lineHeight: 1, marginTop: '-1px' }}>−</span>}
    </div>
  );
}

function Chevron({ open }) {
  return (
    <span style={{
      display: 'inline-block', fontSize: '9px',
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.2s', color: '#94a3b8', lineHeight: 1, flexShrink: 0,
      pointerEvents: 'none',
    }}>▶</span>
  );
}

export default function FilterTree({ tree, selected, onChange, t, theme, searchTerm }) {
  const [openSectors, setOpenSectors] = useState({});
  const [openMacros,  setOpenMacros]  = useState({});

  const accentColor = '#3b82f6';

  const filteredTree = useMemo(() => {
    if (!searchTerm.trim()) return tree;
    const q = searchTerm.toLowerCase();
    const result = {};
    Object.entries(tree).forEach(([sector, macros]) => {
      const fm = {};
      Object.entries(macros).forEach(([macro, micros]) => {
        const fmi = micros.filter(mi =>
          mi.toLowerCase().includes(q) || macro.toLowerCase().includes(q) || sector.toLowerCase().includes(q)
        );
        if (fmi.length) fm[macro] = fmi;
      });
      if (Object.keys(fm).length) result[sector] = fm;
    });
    return result;
  }, [tree, searchTerm]);

  const searchActive = searchTerm.trim().length > 0;

  const toggleMicro = (e, micro) => {
    e.stopPropagation();
    const next = new Set(selected);
    next.has(micro) ? next.delete(micro) : next.add(micro);
    onChange(next);
  };

  const toggleMacro = (e, micros) => {
    e.stopPropagation();
    const allSel = micros.every(mi => selected.has(mi));
    const next = new Set(selected);
    if (allSel) micros.forEach(mi => next.delete(mi));
    else micros.forEach(mi => next.add(mi));
    onChange(next);
  };

  const toggleSector = (e, macros) => {
    e.stopPropagation();
    const all = Object.values(macros).flat();
    const allSel = all.every(mi => selected.has(mi));
    const next = new Set(selected);
    if (allSel) all.forEach(mi => next.delete(mi));
    else all.forEach(mi => next.add(mi));
    onChange(next);
  };

  const toggleSectorOpen = (e, sector) => {
    e.stopPropagation();
    setOpenSectors(prev => ({ ...prev, [sector]: !prev[sector] }));
  };

  const toggleMacroOpen = (e, key) => {
    e.stopPropagation();
    setOpenMacros(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {Object.entries(filteredTree).map(([sector, macros]) => {
        const allMicrosInSector = Object.values(macros).flat();
        const selCount     = allMicrosInSector.filter(mi => selected.has(mi)).length;
        const sectorChecked = selCount === allMicrosInSector.length && allMicrosInSector.length > 0;
        const sectorIndet  = selCount > 0 && !sectorChecked;
        const isSectorOpen = searchActive ? true : !!openSectors[sector];

        return (
          <div key={sector}>
            {/* ── SECTOR ROW ── */}
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '7px 12px', borderRadius: '5px', userSelect: 'none',
                backgroundColor: sectorChecked ? (theme === 'dark' ? 'rgba(59,130,246,0.12)' : '#eff6ff') : 'transparent',
                transition: 'background-color 0.12s',
              }}
              onMouseEnter={e => { if (!sectorChecked) e.currentTarget.style.backgroundColor = t.hover; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = sectorChecked ? (theme === 'dark' ? 'rgba(59,130,246,0.12)' : '#eff6ff') : 'transparent'; }}
            >
              {/* Chevron: only opens/closes */}
              <button
                onClick={e => toggleSectorOpen(e, sector)}
                style={{ background: 'none', border: 'none', padding: '2px 4px 2px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}
              >
                <Chevron open={isSectorOpen} />
              </button>

              {/* Checkbox + label: only toggles selection */}
              <button
                onClick={e => toggleSector(e, macros)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0, textAlign: 'left' }}
              >
                <Checkbox checked={sectorChecked} indeterminate={sectorIndet} accentColor={accentColor} />
                <span style={{ fontWeight: '700', fontSize: '13px', color: t.textMain, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sector}
                </span>
              </button>

              {selCount > 0 && (
                <span style={{ fontSize: '10px', fontWeight: '800', color: accentColor, backgroundColor: theme === 'dark' ? 'rgba(59,130,246,0.2)' : '#dbeafe', borderRadius: '10px', padding: '1px 6px', flexShrink: 0 }}>
                  {selCount}
                </span>
              )}
            </div>

            {/* ── MACRO ROWS ── */}
            {isSectorOpen && Object.entries(macros).map(([macro, micros]) => {
              const macroSelCount = micros.filter(mi => selected.has(mi)).length;
              const macroChecked  = macroSelCount === micros.length && micros.length > 0;
              const macroIndet    = macroSelCount > 0 && !macroChecked;
              const macroKey      = `${sector}__${macro}`;
              const isMacroOpen   = searchActive ? true : !!openMacros[macroKey];

              return (
                <div key={macroKey}>
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '5px 12px 5px 20px', borderRadius: '5px', userSelect: 'none',
                      backgroundColor: macroChecked ? (theme === 'dark' ? 'rgba(59,130,246,0.08)' : '#f0f7ff') : 'transparent',
                      transition: 'background-color 0.12s',
                    }}
                    onMouseEnter={e => { if (!macroChecked) e.currentTarget.style.backgroundColor = t.hover; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = macroChecked ? (theme === 'dark' ? 'rgba(59,130,246,0.08)' : '#f0f7ff') : 'transparent'; }}
                  >
                    {/* Chevron: only opens/closes */}
                    <button
                      onClick={e => toggleMacroOpen(e, macroKey)}
                      style={{ background: 'none', border: 'none', padding: '2px 4px 2px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                    >
                      <Chevron open={isMacroOpen} />
                    </button>

                    {/* Checkbox + label: only toggles selection */}
                    <button
                      onClick={e => toggleMacro(e, micros)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0, textAlign: 'left' }}
                    >
                      <Checkbox checked={macroChecked} indeterminate={macroIndet} accentColor={accentColor} />
                      <span style={{ fontWeight: '600', fontSize: '12px', color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {macro}
                      </span>
                    </button>
                  </div>

                  {/* ── MICRO ROWS ── */}
                  {isMacroOpen && micros.map(micro => {
                    const isSelected = selected.has(micro);
                    return (
                      <button
                        key={micro}
                        onClick={e => toggleMicro(e, micro)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '7px',
                          padding: '4px 12px 4px 44px', borderRadius: '5px',
                          width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                          backgroundColor: isSelected ? (theme === 'dark' ? 'rgba(59,130,246,0.1)' : '#eff6ff') : 'transparent',
                          transition: 'background-color 0.12s', userSelect: 'none',
                        }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = t.hover; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = isSelected ? (theme === 'dark' ? 'rgba(59,130,246,0.1)' : '#eff6ff') : 'transparent'; }}
                      >
                        <Checkbox checked={isSelected} indeterminate={false} accentColor={accentColor} />
                        <span style={{ fontSize: '12px', color: isSelected ? accentColor : t.textMuted, fontWeight: isSelected ? '600' : '400', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {micro}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
