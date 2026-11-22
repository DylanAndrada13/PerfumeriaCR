import { useState } from 'react';
import { AlertCircle, ArrowLeft, CircleUserRound, LockKeyhole, MapPin, Minus, Plus, ShoppingBag, Trash2, Wallet, X } from 'lucide-react';
import { money, pickUpPoints } from '../lib/format.js';
import Modal from './Modal.jsx';
import { ProductImage, availability } from './Products.jsx';

function CloseButton({ onClose, label = 'Cerrar' }) {
  return <button className="icon-button modal__close" type="button" onClick={onClose} aria-label={label}><X size={20} /></button>;
}

export function ProductDialog({ product, inCart, onClose, onAdd }) {
  const [qty, setQty] = useState(1);
  const state = availability(product);
  const facts = [
    product.brand && ['Marca', product.brand],
    product.quantity && ['Contenido', product.quantity],
    product.category && ['Categoría', product.category],
    product.barcode && ['Código', product.barcode],
  ].filter(Boolean);
  return (
    <Modal onClose={onClose} labelledBy="product-title" className="product-sheet">
      <CloseButton onClose={onClose} />
      <div className="product-sheet__image"><ProductImage product={product} className="product-sheet__photo" eager /></div>
      <div className="product-sheet__details">
        <h2 id="product-title" className="sheet__title">{product.name}</h2>
        <p className="product-sheet__price">{product.price > 0 ? money(product.price) : 'Precio a consultar'}</p>
        <p className={`stock ${product.inStock ? '' : 'stock--out'}`}><span aria-hidden="true" />{product.inStock ? 'Hay stock para retirar' : 'Sin stock por ahora'}</p>
        {facts.length > 0 && <dl className="facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
        {inCart > 0 && <p className="note note--gold"><ShoppingBag size={14} /> Ya tenés {inCart} en el carrito.</p>}
        <div className="product-sheet__actions">
          <div className="stepper" role="group" aria-label="Cantidad">
            <button type="button" onClick={() => setQty(n => Math.max(1, n - 1))} aria-label="Quitar una unidad" disabled={qty <= 1}><Minus size={16} /></button>
            <span aria-live="polite">{qty}</span>
            <button type="button" onClick={() => setQty(n => Math.min(99, n + 1))} aria-label="Agregar una unidad" disabled={qty >= 99}><Plus size={16} /></button>
          </div>
          <button className="button button--gold" type="button" disabled={!state.ok} onClick={() => { onAdd(product, qty); onClose(); }}>
            <ShoppingBag size={17} /> {state.ok ? 'Agregar al carrito' : state.label}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function CartDialog({ items, total, onClose, onQty, onRemove, onCheckout }) {
  const blocked = items.some(item => item.unavailable);
  const count = items.reduce((sum, item) => sum + item.qty, 0);
  return (
    <Modal onClose={onClose} variant="drawer" labelledBy="cart-title" className="drawer">
      <header className="drawer__header">
        <h2 id="cart-title" className="sheet__title">Tu carrito <span>{count} {count === 1 ? 'artículo' : 'artículos'}</span></h2>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar carrito"><X size={20} /></button>
      </header>
      <div className="drawer__items">
        {items.length === 0 && (
          <div className="empty-state empty-state--small">
            <ShoppingBag size={28} strokeWidth={1.3} />
            <h3>Tu carrito está vacío</h3>
            <p>Agregá productos desde el catálogo y aparecen acá.</p>
            <button className="button button--outline" type="button" onClick={onClose}>Ver productos</button>
          </div>
        )}
        {items.map(item => (
          <article className={`cart-line ${item.unavailable ? 'cart-line--off' : ''}`} key={item.id}>
            <div className="cart-line__photo"><ProductImage product={item} className="cart-line__img" compact /></div>
            <div className="cart-line__details">
              <strong>{item.name}</strong>
              <span>{item.unavailable ? item.unavailable : item.price > 0 ? `${money(item.price)} c/u` : 'Precio a consultar'}</span>
              <div className="stepper stepper--small" role="group" aria-label={`Cantidad de ${item.name}`}>
                <button type="button" onClick={() => onQty(item.id, item.qty - 1)} disabled={item.qty <= 1} aria-label={`Quitar una unidad de ${item.name}`}><Minus size={14} /></button>
                <span>{item.qty}</span>
                <button type="button" onClick={() => onQty(item.id, item.qty + 1)} disabled={item.qty >= 99} aria-label={`Agregar una unidad de ${item.name}`}><Plus size={14} /></button>
              </div>
            </div>
            <div className="cart-line__right">
              <strong>{item.price > 0 && !item.unavailable ? money(item.price * item.qty) : '—'}</strong>
              <button className="icon-button icon-button--quiet" type="button" onClick={() => onRemove(item.id)} aria-label={`Quitar ${item.name} del carrito`}><Trash2 size={16} /></button>
            </div>
          </article>
        ))}
      </div>
      {items.length > 0 && (
        <footer className="drawer__footer">
          <div className="total-row"><span>Subtotal</span><strong>{money(total)}</strong></div>
          {blocked
            ? <p className="alert alert--error"><AlertCircle size={16} />Quitá los productos sin stock para seguir.</p>
            : <p className="note">El precio y el stock se confirman otra vez al pagar.</p>}
          <button className="button button--gold button--wide" type="button" disabled={blocked} onClick={onCheckout}>Elegir punto de retiro</button>
          <button className="button button--ghost button--wide" type="button" onClick={onClose}>Seguir comprando</button>
        </footer>
      )}
    </Modal>
  );
}

export function CheckoutDialog({ items, total, session, onClose, onBack, onLogin, onOrdered }) {
  const [pickup, setPickup] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkoutKey] = useState(() => crypto.randomUUID());
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/orders/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ checkoutKey, pickupPoint: pickup, items: items.map(item => ({ id: item.id, quantity: item.qty })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar el pago.');
      let checkoutHost = '';
      try { checkoutHost = new URL(data.checkoutUrl).hostname; } catch { /* invalid URL */ }
      const trustedCheckout = checkoutHost === 'mercadopago.com' || checkoutHost.endsWith('.mercadopago.com') || checkoutHost === 'mercadopago.com.ar' || checkoutHost.endsWith('.mercadopago.com.ar');
      if (!trustedCheckout) throw new Error('La dirección de pago no pudo validarse. No salimos del sitio.');
      onOrdered();
      window.location.assign(data.checkoutUrl);
    } catch (err) { setError(err.message || 'No se pudo iniciar el pago.'); }
    finally { setBusy(false); }
  };
  const count = items.reduce((sum, item) => sum + item.qty, 0);
  return (
    <Modal onClose={onClose} labelledBy="checkout-title" className="sheet checkout">
      <div className="checkout__top">
        <button className="back-link" type="button" onClick={onBack || onClose}><ArrowLeft size={16} /> Volver al carrito</button>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
      </div>
      <ol className="steps" aria-label="Pasos de la compra">
        <li className="is-done"><span>1</span>Carrito</li>
        <li className="is-current"><span>2</span>Retiro y pago</li>
        <li><span>3</span>Mercado Pago</li>
      </ol>
      <h2 id="checkout-title" className="sheet__title">Retiro y pago</h2>
      <section className="checkout__section">
        <h3><MapPin size={17} /> Punto de retiro</h3>
        <div className="choice-grid" role="radiogroup" aria-label="Punto de retiro">
          {pickUpPoints.map(point => (
            <button type="button" role="radio" aria-checked={pickup === point} className={`choice ${pickup === point ? 'is-selected' : ''}`} key={point} onClick={() => setPickup(point)}>
              <span className="choice__dot" aria-hidden="true" />{point}
            </button>
          ))}
        </div>
      </section>
      <section className="checkout__section">
        <h3><Wallet size={17} /> Medio de pago</h3>
        <div className="choice is-selected choice--static"><span className="choice__dot" aria-hidden="true" />Saldo de Mercado Pago</div>
        <p className="note">Se paga con el saldo de una cuenta de Mercado Pago. No acepta tarjetas ni efectivo.</p>
      </section>
      <div className="total-row total-row--boxed"><span>{count} {count === 1 ? 'artículo' : 'artículos'}</span><strong>{money(total)}</strong></div>
      {!session?.user
        ? <button className="button button--gold button--wide" type="button" onClick={onLogin}><CircleUserRound size={17} /> Ingresar para pagar</button>
        : <button className="button button--gold button--wide" type="button" disabled={!pickup || busy || items.length === 0} onClick={submit}>{busy ? 'Conectando con Mercado Pago…' : pickup ? 'Pagar con Mercado Pago' : 'Elegí un punto de retiro'}</button>}
      {error && <p className="alert alert--error" role="alert"><AlertCircle size={16} />{error}</p>}
      <p className="sheet__secure"><LockKeyhole size={14} /> El pedido queda pagado solo cuando Mercado Pago lo confirma.</p>
    </Modal>
  );
}
