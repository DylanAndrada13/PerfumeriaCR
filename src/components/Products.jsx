import { useState } from 'react';
import { ChevronLeft, ChevronRight, Droplets, Plus, ShoppingBag } from 'lucide-react';
import { money } from '../lib/format.js';

export function ImageFallback({ product, compact = false }) {
  const label = String(product?.brand || product?.category || 'CR').trim();
  return (
    <div className={`image-fallback ${compact ? 'image-fallback--compact' : ''}`} role="img" aria-label={`${product?.name || 'Producto'}, sin foto`}>
      <span className="image-fallback__ring"><Droplets size={compact ? 16 : 22} strokeWidth={1.3} /></span>
      {!compact && <span className="image-fallback__mark">{label}</span>}
    </div>
  );
}

export function ProductImage({ product, className = '', compact = false, eager = false }) {
  const [failed, setFailed] = useState(false);
  if (!product?.image || failed) return <ImageFallback product={product} compact={compact} />;
  return <img className={className} src={product.image} alt={product.name} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} />;
}

export function availability(product) {
  if (!product.inStock) return { ok: false, label: 'Sin stock' };
  if (!(product.price > 0)) return { ok: false, label: 'Sin precio' };
  return { ok: true, label: 'Agregar' };
}

export function ProductCard({ product, inCart, onAdd, onOpen }) {
  const state = availability(product);
  return (
    <article className={`product-card ${state.ok ? '' : 'product-card--off'}`}>
      <button className="product-card__photo" type="button" onClick={() => onOpen(product)} aria-label={`Ver detalle de ${product.name}`}>
        <ProductImage product={product} className="product-card__image" />
        {!product.inStock && <span className="product-card__flag">Sin stock</span>}
        {inCart > 0 && <span className="product-card__flag product-card__flag--cart"><ShoppingBag size={12} /> {inCart}</span>}
      </button>
      <div className="product-card__body">
        <p className="product-card__meta">{[product.brand, product.quantity].filter(Boolean).join(' · ') || product.category || 'CR'}</p>
        <h3 className="product-card__name"><button type="button" onClick={() => onOpen(product)}>{product.name}</button></h3>
        <div className="product-card__foot">
          <strong className="product-card__price">{product.price > 0 ? money(product.price) : 'Consultar'}</strong>
          <button className="add-button" type="button" disabled={!state.ok} onClick={() => onAdd(product)} aria-label={state.ok ? `Agregar ${product.name} al carrito` : `${product.name}: ${state.label}`}>
            {state.ok ? <><Plus size={16} /><span>Agregar</span></> : <span>{state.label}</span>}
          </button>
        </div>
      </div>
    </article>
  );
}

export function SkeletonCard() {
  return (
    <div className="product-card product-card--skeleton" aria-hidden="true">
      <div className="product-card__photo"><span className="shimmer" /></div>
      <div className="product-card__body"><span className="shimmer shimmer--line" /><span className="shimmer shimmer--title" /><span className="shimmer shimmer--line shimmer--short" /></div>
    </div>
  );
}

function pageList(page, totalPages) {
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach(n => pages.add(n));
  if (page >= totalPages - 2) [totalPages - 1, totalPages - 2, totalPages - 3].forEach(n => pages.add(n));
  const sorted = [...pages].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((n, i) => { if (i && n - sorted[i - 1] > 1) out.push(`gap-${n}`); out.push(n); });
  return out;
}

export function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Páginas del catálogo">
      <button type="button" className="pagination__step" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={17} /><span>Anterior</span></button>
      <ol className="pagination__pages">
        {pageList(page, totalPages).map(item => typeof item === 'string'
          ? <li key={item} className="pagination__gap" aria-hidden="true">…</li>
          : <li key={item}><button type="button" className={item === page ? 'is-current' : ''} aria-current={item === page ? 'page' : undefined} aria-label={`Página ${item}`} onClick={() => onPage(item)}>{item}</button></li>)}
      </ol>
      <span className="pagination__compact">Página {page} de {totalPages}</span>
      <button type="button" className="pagination__step" disabled={page >= totalPages} onClick={() => onPage(page + 1)}><span>Siguiente</span><ChevronRight size={17} /></button>
    </nav>
  );
}
