import React, { useState, useMemo } from 'react';

// Checkbox with 3 states: checked, unchecked, indeterminate
function Checkbox({ checked, indeterminate, onChange, accentColor }) {
  return (
    <div
      onClick={onChange}
      style={{
        width: '15px', height: '15px', flexShrink: 0,
        border: `2px solid ${checked || indeterminate ? accentColor : '#94a3b8'}`,
        borderRadius: '3px',
        backgroundColor: checked ? accentColor : 'transparent',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
        position: 'relative',
      }}
    >
      {checked && (
        <span style={{ color: '#fff', fontSize: '10px', fontWeight: '900', lineHeight: 1 }}>✓</span>
      )}
      {indeterminate && !checked && (
        <span style={{ color: accentColor, fontSize: '12px', fontWeight: '900', lineHeight: 1, marginTop: '-1px' }}>−</span>
      )}
    </div>
  );
}

function Chevron({ open }) {
  return (
    <span style={{
      display: 'inline-block',
      fontSize: '9px',
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.2s',
      color: '#94a3b8',
      lineHeight: 1,
      flexShrink: 0,
    }}>▶</span>
  );
}

export default function FilterTree({
  tree,           // { sector: { macro: [micros] } }
  selected,       // Set of selected micro industry strings
  onChange,       // (newSet) => void
  t,
  theme,
  searchTerm,
}) {
  const [openSectors, setOpenSectors]  = useState({});
  const [openMacros,  setOpenMacros]   = useState({});

  const accentColor = '#3b82f6';

  // Flatten all micros across tree for "select all" use
  const allMicros = useMemo(() => {
    const list = [];
    Object.values(tree).forEach(macros =>
      Object.values(macros).forEach(micros => list.push(...micros))
    );
    return list;
  }, [tree]);

  // Filter tree by searchTerm — returns pruned copy
  const filteredTree = useMemo(() => {
    if (!searchTerm.trim()) return tree;
    const q = searchTerm.toLowerCase();
    const result = {};
    Object.entries(tree).forEach(([sector, macros]) => {
      const filteredMacros = {};
      Object.entries(macros).forEach(([macro, micros]) => {
        const filteredMicros = micros.filter(mi =>
          mi.toLowerCase().includes(q) ||
          macro.toLowerCase().includes(q) ||
          sector.toLowerCase().includes(q)
        );
        if (filteredMicros.length) filteredMacros[macro] = filteredMicros;
      });
      if (Object.keys(filteredMacros).length) result[sector] = filteredMacros;
    });
    return result;
  }, [tree, searchTerm]);

  // Auto-expand sectors/macros that match search
  const searchActive = searchTerm.trim().length > 0;

  const toggleMicro = (micro) => {
    const next = new Set(selected);
    next.has(micro) ? next.delete(micro) : next.add(micro);
    onChange(next);
  };

  const toggleMacro = (micros) => {
    const allSel = micros.every(mi => selected.has(mi));
    const next = new Set(selected);
    if (allSel) micros.forEach(mi => next.delete(mi));
    else micros.forEach(mi => next.add(mi));
    onChange(next);
  };

  const toggleSector = (macros) => {
    const allMicrosInSector = Object.values(macros).flat();
    const allSel = allMicrosInSector.every(mi => selected.has(mi));
    const next = new Set(selected);
    if (allSel) allMicrosInSector.forEach(mi => next.delete(mi));
    else allMicrosInSector.forEach(mi => next.add(mi));
    onChange(next);
  };

  const toggleSectorOpen = (sector) =>
    setOpenSectors(prev => ({ ...prev, [sector]: !prev[sector] }));

  const toggleMacroOpen = (key) =>
    setOpenMacros(prev => ({ ...prev, [key]: !prev[key] }));

  const sectorStyle = {
    display: 'flex', alignItems: 'center', gap: '7px',
    padding: '7px 12px', cursor: 'pointer',
    borderRadius: '5px', transition: 'background-color 0.12s',
    userSelect: 'none',
  };

  const macroStyle = {
    display: 'flex', alignItems: 'center', gap: '7px',
    padding: '5px 12px 5px 28px', cursor: 'pointer',
    borderRadius: '5px', transition: 'background-color 0.12s',
    userSelect: 'none',
  };

  const microStyle = {
    display: 'flex', alignItems: 'center', gap: '7px',
    padding: '4px 12px 4px 48px', cursor: 'pointer',
    borderRadius: '5px', transition: 'background-color 0.12s',
    userSelect: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {Object.entries(filteredTree).map(([sector, macros]) => {
        const allMicrosInSector = Object.values(macros).flat();
        const selCount = allMicrosInSector.filter(mi => selected.has(mi)).length;
        const sectorChecked = selCount === allMicrosInSector.length && allMicrosInSector.length > 0;
        const sectorIndet  = selCount > 0 && !sectorChecked;
        const isSectorOpen = searchActive ? true : !!openSectors[sector];

        return (
          <div key={sector}>
            {/* SECTOR ROW */}
            <div
              style={{ ...sectorStyle, backgroundColor: sectorChecked ? (theme === 'dark' ? 'rgba(59,130,246,0.12)' : '#eff6ff') : 'transparent' }}
              onMouseEnter={e => { if (!sectorChecked) e.currentTarget.style.backgroundColor = t.hover; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = sectorChecked ? (theme === 'dark' ? 'rgba(59,130,246,0.12)' : '#eff6ff') : 'transparent'; }}
            >
              <div onClick={() => toggleSectorOpen(sector)} style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1, minWidth: 0 }}>
                <Chevron open={isSectorOpen} />
                <Checkbox checked={sectorChecked} indeterminate={sectorIndet} onChange={(e) => { e?.stopPropagation?.(); toggleSector(macros); }} accentColor={accentColor} />
                <span
                  onClick={e => { e.stopPropagation(); toggleSector(macros); }}
                  style={{ fontWeight: '700', fontSize: '13px', color: t.textMain, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                >
                  {sector}
                </span>
              </div>
              {selCount > 0 && (
                <span style={{ fontSize: '10px', fontWeight: '800', color: accentColor, backgroundColor: theme === 'dark' ? 'rgba(59,130,246,0.2)' : '#dbeafe', borderRadius: '10px', padding: '1px 6px', flexShrink: 0 }}>
                  {selCount}
                </span>
              )}
            </div>

            {/* MACRO INDUSTRIES */}
            {isSectorOpen && Object.entries(macros).map(([macro, micros]) => {
              const macroSelCount = micros.filter(mi => selected.has(mi)).length;
              const macroChecked  = macroSelCount === micros.length && micros.length > 0;
              const macroIndet    = macroSelCount > 0 && !macroChecked;
              const macroKey      = `${sector}__${macro}`;
              const isMacroOpen   = searchActive ? true : !!openMacros[macroKey];

              return (
                <div key={macro}>
                  {/* MACRO ROW */}
                  <div
                    style={{ ...macroStyle, backgroundColor: macroChecked ? (theme === 'dark' ? 'rgba(59,130,246,0.08)' : '#f0f7ff') : 'transparent' }}
                    onMouseEnter={e => { if (!macroChecked) e.currentTarget.style.backgroundColor = t.hover; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = macroChecked ? (theme === 'dark' ? 'rgba(59,130,246,0.08)' : '#f0f7ff') : 'transparent'; }}
                  >
                    <div onClick={() => toggleMacroOpen(macroKey)} style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1, minWidth: 0 }}>
                      <Chevron open={isMacroOpen} />
                      <Checkbox checked={macroChecked} indeterminate={macroIndet} onChange={e => { e?.stopPropagation?.(); toggleMacro(micros); }} accentColor={accentColor} />
                      <span
                        onClick={e => { e.stopPropagation(); toggleMacro(micros); }}
                        style={{ fontWeight: '600', fontSize: '12px', color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                      >
                        {macro}
                      </span>
                    </div>
                  </div>

                  {/* MICRO INDUSTRIES */}
                  {isMacroOpen && micros.map(micro => {
                    const isSelected = selected.has(micro);
                    return (
                      <div
                        key={micro}
                        onClick={() => toggleMicro(micro)}
                        style={{ ...microStyle, backgroundColor: isSelected ? (theme === 'dark' ? 'rgba(59,130,246,0.1)' : '#eff6ff') : 'transparent' }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = t.hover; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = isSelected ? (theme === 'dark' ? 'rgba(59,130,246,0.1)' : '#eff6ff') : 'transparent'; }}
                      >
                        <Checkbox checked={isSelected} indeterminate={false} onChange={() => toggleMicro(micro)} accentColor={accentColor} />
                        <span style={{ fontSize: '12px', color: isSelected ? accentColor : t.textMuted, fontWeight: isSelected ? '600' : '400', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {micro}
                        </span>
                      </div>
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
