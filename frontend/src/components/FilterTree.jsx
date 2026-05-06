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
      transition: 'transform 0.2s', color: '#94a3b8', lineHeight: 1,
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

  // Flat list — no DOM nesting between sector/macro/micro rows
  const rows = useMemo(() => {
    const list = [];
    Object.entries(filteredTree).forEach(([sector, macros]) => {
      const allMicrosInSector = Object.values(macros).flat();
      list.push({ type: 'sector', sector, macros, allMicros: allMicrosInSector });

      const isSectorOpen = searchActive ? true : !!openSectors[sector];
      if (!isSectorOpen) return;

      Object.entries(macros).forEach(([macro, micros]) => {
        const macroKey = `${sector}__${macro}`;
        list.push({ type: 'macro', macro, micros, macroKey });

        const isMacroOpen = searchActive ? true : !!openMacros[macroKey];
        if (!isMacroOpen) return;

        micros.forEach(micro => {
          list.push({ type: 'micro', micro });
        });
      });
    });
    return list;
  }, [filteredTree, openSectors, openMacros, searchActive]);

  const rowBase = {
    display: 'flex', alignItems: 'center', borderRadius: '5px',
    userSelect: 'none', transition: 'background-color 0.12s',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {rows.map((row) => {

        if (row.type === 'sector') {
          const { sector, macros, allMicros } = row;
          const selCount      = allMicros.filter(mi => selected.has(mi)).length;
          const checked       = selCount === allMicros.length && allMicros.length > 0;
          const indeterminate = selCount > 0 && !checked;
          const isOpen        = searchActive ? true : !!openSectors[sector];
          const bg            = checked ? (theme === 'dark' ? 'rgba(59,130,246,0.12)' : '#eff6ff') : 'transparent';

          return (
            <div
              key={`sector-${sector}`}
              style={{ ...rowBase, padding: '7px 12px', gap: '4px', backgroundColor: bg }}
              onMouseEnter={e => { if (!checked) e.currentTarget.style.backgroundColor = t.hover; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = bg; }}
            >
              <div
                onClick={(e) => { e.stopPropagation(); setOpenSectors(prev => ({ ...prev, [sector]: !prev[sector] })); }}
                style={{ padding: '2px 6px 2px 0', cursor: 'pointer', flexShrink: 0 }}
              >
                <Chevron open={isOpen} />
              </div>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  const allSel = allMicros.every(mi => selected.has(mi));
                  const next = new Set(selected);
                  if (allSel) allMicros.forEach(mi => next.delete(mi));
                  else allMicros.forEach(mi => next.add(mi));
                  onChange(next);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0, cursor: 'pointer' }}
              >
                <Checkbox checked={checked} indeterminate={indeterminate} accentColor={accentColor} />
                <span style={{ fontWeight: '700', fontSize: '13px', color: t.textMain, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sector}
                </span>
              </div>
              {selCount > 0 && (
                <span style={{ fontSize: '10px', fontWeight: '800', color: accentColor, backgroundColor: theme === 'dark' ? 'rgba(59,130,246,0.2)' : '#dbeafe', borderRadius: '10px', padding: '1px 6px', flexShrink: 0 }}>
                  {selCount}
                </span>
              )}
            </div>
          );
        }

        if (row.type === 'macro') {
          const { macro, micros, macroKey } = row;
          const selCount      = micros.filter(mi => selected.has(mi)).length;
          const checked       = selCount === micros.length && micros.length > 0;
          const indeterminate = selCount > 0 && !checked;
          const isOpen        = searchActive ? true : !!openMacros[macroKey];
          const bg            = checked ? (theme === 'dark' ? 'rgba(59,130,246,0.08)' : '#f0f7ff') : 'transparent';

          return (
            <div
              key={`macro-${macroKey}`}
              style={{ ...rowBase, padding: '5px 12px 5px 20px', gap: '4px', backgroundColor: bg }}
              onMouseEnter={e => { if (!checked) e.currentTarget.style.backgroundColor = t.hover; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = bg; }}
            >
              <div
                onClick={(e) => { e.stopPropagation(); setOpenMacros(prev => ({ ...prev, [macroKey]: !prev[macroKey] })); }}
                style={{ padding: '2px 6px 2px 0', cursor: 'pointer', flexShrink: 0 }}
              >
                <Chevron open={isOpen} />
              </div>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  const allSel = micros.every(mi => selected.has(mi));
                  const next = new Set(selected);
                  if (allSel) micros.forEach(mi => next.delete(mi));
                  else micros.forEach(mi => next.add(mi));
                  onChange(next);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0, cursor: 'pointer' }}
              >
                <Checkbox checked={checked} indeterminate={indeterminate} accentColor={accentColor} />
                <span style={{ fontWeight: '600', fontSize: '12px', color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {macro}
                </span>
              </div>
            </div>
          );
        }

        if (row.type === 'micro') {
          const { micro } = row;
          const isSelected = selected.has(micro);
          const bg = isSelected ? (theme === 'dark' ? 'rgba(59,130,246,0.1)' : '#eff6ff') : 'transparent';

          return (
            <div
              key={`micro-${micro}`}
              onClick={(e) => {
                e.stopPropagation();
                const next = new Set(selected);
                next.has(micro) ? next.delete(micro) : next.add(micro);
                onChange(next);
              }}
              style={{ ...rowBase, padding: '4px 12px 4px 44px', gap: '7px', cursor: 'pointer', backgroundColor: bg }}
              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = t.hover; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = bg; }}
            >
              <Checkbox checked={isSelected} indeterminate={false} accentColor={accentColor} />
              <span style={{ fontSize: '12px', color: isSelected ? accentColor : t.textMuted, fontWeight: isSelected ? '600' : '400', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {micro}
              </span>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
