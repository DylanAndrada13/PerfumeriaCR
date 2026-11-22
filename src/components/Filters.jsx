import { useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { sameText } from '../lib/format.js';

export function brandsFor(facets, category) {
  if (!category) return facets.brands;
  return facets.brands.filter(brand => brand.categories.some(name => sameText(name, category)));
}

export function FilterPanel({ facets, filters, onChange, idPrefix = 'f' }) {
  const [brandQuery, setBrandQuery] = useState('');
  const brands = useMemo(() => {
    const term = brandQuery.trim().toLocaleLowerCase('es');
    const list = brandsFor(facets, filters.category);
    return term ? list.filter(brand => brand.name.toLocaleLowerCase('es').includes(term)) : list;
  }, [facets, filters.category, brandQuery]);

  const pickCategory = name => {
    const category = sameText(name, filters.category) ? '' : name;
    const keepBrand = filters.brand && brandsFor(facets, category).some(brand => sameText(brand.name, filters.brand));
    onChange({ category, brand: keepBrand ? filters.brand : '' });
  };

  return (
    <div className="filters">
      <label className="toggle">
        <input type="checkbox" checked={filters.inStock} onChange={event => onChange({ inStock: event.target.checked })} />
        <span className="toggle__track" aria-hidden="true"><span /></span>
        <span>Solo con stock</span>
      </label>

      <fieldset className="filters__group">
        <legend>Categorías</legend>
        <ul className="filters__list">
          <li><button type="button" className={!filters.category ? 'is-selected' : ''} onClick={() => onChange({ category: '', brand: filters.brand })}><span>Todas</span><small>{facets.total || ''}</small></button></li>
          {facets.categories.map(item => (
            <li key={item.name}><button type="button" className={sameText(item.name, filters.category) ? 'is-selected' : ''} aria-pressed={sameText(item.name, filters.category)} onClick={() => pickCategory(item.name)}><span>{item.name}</span><small>{item.count}</small></button></li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="filters__group">
        <legend>Marcas</legend>
        <label className="filters__search" htmlFor={`${idPrefix}-brand-search`}>
          <Search size={15} aria-hidden="true" />
          <input id={`${idPrefix}-brand-search`} value={brandQuery} onChange={event => setBrandQuery(event.target.value)} placeholder="Buscar marca" aria-label="Buscar marca" />
        </label>
        <ul className="filters__list filters__list--brands">
          {brands.length === 0 && <li className="filters__empty">No hay marcas con ese nombre.</li>}
          {brands.map(item => {
            const selected = sameText(item.name, filters.brand);
            return (
              <li key={item.name}><button type="button" className={selected ? 'is-selected' : ''} aria-pressed={selected} onClick={() => onChange({ brand: selected ? '' : item.name })}>
                <span className="filters__check" aria-hidden="true">{selected && <Check size={12} />}</span><span>{item.name}</span><small>{item.count}</small>
              </button></li>
            );
          })}
        </ul>
      </fieldset>
    </div>
  );
}

export function ActiveFilters({ filters, onChange, onClear }) {
  const chips = [
    filters.q.trim() && { key: 'q', label: `“${filters.q.trim()}”`, clear: { q: '' } },
    filters.category && { key: 'category', label: filters.category, clear: { category: '' } },
    filters.brand && { key: 'brand', label: filters.brand, clear: { brand: '' } },
    filters.inStock && { key: 'stock', label: 'Con stock', clear: { inStock: false } },
  ].filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className="active-filters" aria-label="Filtros aplicados">
      {chips.map(chip => <button type="button" key={chip.key} className="active-filters__chip" onClick={() => onChange(chip.clear)} aria-label={`Quitar filtro ${chip.label}`}>{chip.label}<X size={14} /></button>)}
      {chips.length > 1 && <button type="button" className="text-link" onClick={onClear}>Borrar filtros</button>}
    </div>
  );
}
