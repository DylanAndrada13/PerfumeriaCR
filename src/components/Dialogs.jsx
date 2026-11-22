import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, Banknote, CheckCircle2, CircleUserRound, Contact, Clock3, Loader2, LockKeyhole, MapPin, Minus, Package, Plus, ShoppingBag, Trash2, Wallet, X, XCircle } from 'lucide-react';
import { formatPickupDate, localPickups, money, pickUpPoints, pickupDateOptions } from '../lib/format.js';
import { supabase } from '../lib/supabase.js';
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

export function CheckoutDialog({ items, total, session, onClose, onBack, onLogin, onOrdered, onCashOrdered }) {
  const [pickupType, setPickupType] = useState('');
  const [pickup, setPickup] = useState('');
  const [pickupDates, setPickupDates] = useState([]);
  const [dateOptions] = useState(() => pickupDateOptions(21));
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkoutKey, setCheckoutKey] = useState(() => crypto.randomUUID());
  const meta = session?.user?.user_metadata || {};
  const [customerName, setCustomerName] = useState(() => String(meta.full_name || meta.name || ''));
  const [customerPhone, setCustomerPhone] = useState(() => String(meta.phone || ''));
  const [customerNote, setCustomerNote] = useState('');
  const phoneDigits = customerPhone.replace(/\D/g, '');
  const contactReady = customerName.trim().length >= 2 && phoneDigits.length >= 8 && phoneDigits.length <= 15;
  const pickupReady = Boolean(pickup) && (pickupType === 'local' || pickupDates.length === 3);
  const chooseType = type => { setPickupType(type); setPickup(''); setPickupDates([]); };
  const toggleDate = date => setPickupDates(current => current.includes(date) ? current.filter(d => d !== date) : current.length >= 3 ? current : [...current, date].sort());
  const cash = method === 'efectivo';
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/orders/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ checkoutKey, paymentMethod: method, pickupType, pickupPoint: pickup, pickupDates: pickupType === 'encuentro' ? pickupDates : [], customerName: customerName.trim(), customerPhone: customerPhone.trim(), customerNote: customerNote.trim(), items: items.map(item => ({ id: item.id, quantity: item.qty })) }),
      });
      const data = await response.json();
      if (!response.ok) {
        // A rejected attempt saved nothing, so the next try gets a fresh key.
        if (response.status !== 409 || !/en proceso/.test(data.error || '')) setCheckoutKey(crypto.randomUUID());
        throw new Error(data.error || 'No se pudo enviar el pedido.');
      }
      // Remember name and phone on the account so the next checkout comes filled in.
      if (supabase && (customerPhone.trim() !== String(meta.phone || '') || customerName.trim() !== String(meta.full_name || ''))) {
        await supabase.auth.updateUser({ data: { phone: customerPhone.trim(), full_name: customerName.trim() } }).catch(() => {});
      }
      if (data.paymentMethod === 'efectivo') { onCashOrdered(data, items); return; }
      let checkoutHost = '';
      try { checkoutHost = new URL(data.checkoutUrl).hostname; } catch { /* invalid URL */ }
      const trustedCheckout = checkoutHost === 'mercadopago.com' || checkoutHost.endsWith('.mercadopago.com') || checkoutHost === 'mercadopago.com.ar' || checkoutHost.endsWith('.mercadopago.com.ar');
      if (!trustedCheckout) throw new Error('La dirección de pago no pudo validarse. No salimos del sitio.');
      onOrdered();
      window.location.assign(data.checkoutUrl);
    } catch (err) { setError(err.message || 'No se pudo enviar el pedido.'); }
    finally { setBusy(false); }
  };
  const count = items.reduce((sum, item) => sum + item.qty, 0);
  const label = busy
    ? (cash ? 'Enviando pedido…' : 'Conectando con Mercado Pago…')
    : !contactReady ? 'Completá tu nombre y teléfono'
    : !pickupType ? 'Elegí cómo retirás el pedido'
    : !pickup ? (pickupType === 'local' ? 'Elegí el local' : 'Elegí un punto de encuentro')
    : !pickupReady ? `Elegí ${3 - pickupDates.length} ${3 - pickupDates.length === 1 ? 'fecha más' : 'fechas más'}`
      : !method ? 'Elegí cómo vas a pagar'
        : cash ? 'Enviar pedido' : 'Pagar con Mercado Pago';
  return (
    <Modal onClose={onClose} labelledBy="checkout-title" className="sheet checkout">
      <div className="checkout__top">
        <button className="back-link" type="button" onClick={onBack || onClose}><ArrowLeft size={16} /> Volver al carrito</button>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
      </div>
      <ol className="steps" aria-label="Pasos de la compra">
        <li className="is-done"><span>1</span>Carrito</li>
        <li className="is-current"><span>2</span>Retiro y pago</li>
        <li><span>3</span>{cash ? 'Confirmación' : 'Pago'}</li>
      </ol>
      <h2 id="checkout-title" className="sheet__title">Retiro y pago</h2>
      <section className="checkout__section">
        <h3><Contact size={17} /> Tus datos</h3>
        <div className="checkout__contact">
          <label className="field">Nombre y apellido<input autoComplete="name" value={customerName} onChange={e => setCustomerName(e.target.value)} required minLength={2} maxLength={160} /></label>
          <label className="field">Teléfono o WhatsApp<input type="tel" inputMode="tel" autoComplete="tel" placeholder="11 2345 6789" value={customerPhone} onChange={e => setCustomerPhone(e.target.value.replace(/[^\d\s()+-]/g, ''))} required maxLength={40} /></label>
          <label className="field checkout__note">Nota para el local (opcional)<textarea rows={2} maxLength={300} value={customerNote} onChange={e => setCustomerNote(e.target.value)} placeholder="Por ejemplo, en qué horario te queda mejor" /></label>
        </div>
        <p className="note">El local te escribe a este número si hay algún cambio con tu pedido.</p>
      </section>
      <section className="checkout__section">
        <h3><MapPin size={17} /> Cómo lo retirás</h3>
        <div className="choice-grid" role="radiogroup" aria-label="Forma de retiro">
          <button type="button" role="radio" aria-checked={pickupType === 'local'} className={`choice choice--tall ${pickupType === 'local' ? 'is-selected' : ''}`} onClick={() => chooseType('local')}>
            <span className="choice__dot" aria-hidden="true" /><span><strong>Retiro en el local</strong><small>Itatí o La Haya, en horario de atención</small></span>
          </button>
          <button type="button" role="radio" aria-checked={pickupType === 'encuentro'} className={`choice choice--tall ${pickupType === 'encuentro' ? 'is-selected' : ''}`} onClick={() => chooseType('encuentro')}>
            <span className="choice__dot" aria-hidden="true" /><span><strong>Punto de encuentro</strong><small>Elegís el lugar y 3 fechas posibles</small></span>
          </button>
        </div>
        {pickupType && (
          <div className="choice-grid" role="radiogroup" aria-label={pickupType === 'local' ? 'Local' : 'Punto de encuentro'}>
            {(pickupType === 'local' ? localPickups : pickUpPoints).map(point => (
              <button type="button" role="radio" aria-checked={pickup === point} className={`choice ${pickup === point ? 'is-selected' : ''}`} key={point} onClick={() => setPickup(point)}>
                <span className="choice__dot" aria-hidden="true" />{point}
              </button>
            ))}
          </div>
        )}
        {pickupType === 'encuentro' && pickup && (
          <div className="pickup-dates">
            <p className="pickup-dates__title">Elegí 3 fechas en las que podés pasar <span>{pickupDates.length} de 3</span></p>
            <div className="pickup-dates__grid" role="group" aria-label="Fechas posibles de retiro">
              {dateOptions.map(date => {
                const selected = pickupDates.includes(date);
                return (
                  <button type="button" key={date} aria-pressed={selected} className={`date-chip ${selected ? 'is-selected' : ''}`} disabled={!selected && pickupDates.length >= 3} onClick={() => toggleDate(date)}>
                    {formatPickupDate(date)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {pickupType && <p className="note">{pickupType === 'local' ? 'Te escribimos por WhatsApp cuando el pedido esté listo para retirar.' : 'El local te escribe por WhatsApp para confirmar una de las fechas y la hora del encuentro.'}</p>}
      </section>
      <section className="checkout__section">
        <h3><Wallet size={17} /> Medio de pago</h3>
        <div className="choice-grid" role="radiogroup" aria-label="Medio de pago">
          <button type="button" role="radio" aria-checked={method === 'mercado_pago'} className={`choice choice--tall ${method === 'mercado_pago' ? 'is-selected' : ''}`} onClick={() => setMethod('mercado_pago')}>
            <span className="choice__dot" aria-hidden="true" /><span><strong>Mercado Pago</strong><small>Pagás ahora con el saldo de tu cuenta</small></span>
          </button>
          <button type="button" role="radio" aria-checked={cash} className={`choice choice--tall ${cash ? 'is-selected' : ''}`} onClick={() => setMethod('efectivo')}>
            <span className="choice__dot" aria-hidden="true" /><Banknote size={18} className="choice__icon" /><span><strong>Efectivo al retirar</strong><small>Pagás en el punto de retiro</small></span>
          </button>
        </div>
        {cash && <p className="note">El local revisa el pedido y te lo prepara. Separamos los productos apenas lo enviás; lo pagás en efectivo cuando lo retirás.</p>}
        {method === 'mercado_pago' && <p className="note">Se paga con el saldo de una cuenta de Mercado Pago. No acepta tarjetas.</p>}
      </section>
      <div className="total-row total-row--boxed"><span>{count} {count === 1 ? 'artículo' : 'artículos'}</span><strong>{money(total)}</strong></div>
      {!session?.user
        ? <button className="button button--gold button--wide" type="button" onClick={onLogin}><CircleUserRound size={17} /> Ingresar para pagar</button>
        : <button className="button button--gold button--wide" type="button" disabled={!contactReady || !pickupReady || !method || busy || items.length === 0} onClick={submit}>{label}</button>}
      {error && <p className="alert alert--error" role="alert"><AlertCircle size={16} />{error}</p>}
      <p className="sheet__secure"><LockKeyhole size={14} /> {cash ? 'No se cobra nada ahora: pagás al retirar.' : 'El pedido queda pagado solo cuando Mercado Pago lo confirma.'}</p>
    </Modal>
  );
}

const STEP_TEXT = {
  pending_review: 'Esperando que el local lo acepte',
  awaiting_payment: 'Esperando el pago',
  confirmed: 'Pago confirmado, en preparación',
  preparing: 'En preparación',
  ready_for_pickup: 'Listo para retirar',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};
export function orderStatusText(order) {
  if (order.order_status === 'awaiting_payment' && order.payment_status === 'failed') return 'Pago rechazado';
  return STEP_TEXT[order.order_status] || 'En proceso';
}

// Shown after a cash order is sent, and after coming back from Mercado Pago.
export function OrderResultDialog({ result, onClose, onShowOrders }) {
  const { state, order } = result;
  const content = {
    cash: { icon: <CheckCircle2 size={44} />, tone: 'ok', title: '¡Tu pedido fue enviado!', text: 'El local lo revisa y te lo prepara. Lo pagás en efectivo cuando lo retirás.' },
    paid: { icon: <CheckCircle2 size={44} />, tone: 'ok', title: '¡Tu compra fue hecha!', text: 'Mercado Pago confirmó el pago. Te avisamos el estado en Mis pedidos; retiralo con el número de pedido.' },
    checking: { icon: <Loader2 size={40} className="spin" />, tone: 'wait', title: 'Estamos confirmando tu pago', text: 'Mercado Pago nos avisa en unos segundos. No cierres esta pantalla.' },
    pending: { icon: <Clock3 size={42} />, tone: 'wait', title: 'Tu pago está pendiente', text: 'Mercado Pago todavía no lo confirmó. Cuando se acredite, el pedido pasa a preparación; podés seguirlo en Mis pedidos.' },
    failed: { icon: <XCircle size={42} />, tone: 'error', title: 'El pago no se completó', text: 'Mercado Pago no aprobó el pago y no se cobró nada. Podés volver a intentarlo desde el carrito.' },
    error: { icon: <AlertCircle size={42} />, tone: 'error', title: 'No pudimos consultar el pedido', text: result.error || 'Revisá tu conexión. El estado también aparece en Mis pedidos.' },
  }[state];
  return (
    <Modal onClose={onClose} labelledBy="result-title" className={`sheet sheet--narrow result result--${content.tone}`}>
      <button className="icon-button modal__close" type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
      <span className="result__icon">{content.icon}</span>
      <h2 id="result-title" className="sheet__title">{content.title}</h2>
      <p className="sheet__intro">{content.text}</p>
      {order?.order_number && (
        <dl className="result__facts">
          <div><dt>Pedido</dt><dd>{order.order_number}</dd></div>
          {order.pickup_point && <div><dt>Retiro</dt><dd>{order.pickup_point}</dd></div>}
          {order.pickup_dates?.length > 0 && <div><dt>Fechas propuestas</dt><dd>{order.pickup_dates.map(date => formatPickupDate(date)).join(' · ')}</dd></div>}
          {order.total_amount != null && <div><dt>Total</dt><dd>{money(order.total_amount)}</dd></div>}
          <div><dt>Pago</dt><dd>{order.payment_method === 'efectivo' ? 'Efectivo al retirar' : 'Mercado Pago'}</dd></div>
        </dl>
      )}
      {order?.items?.length > 0 && (
        <ul className="result__items">{order.items.map((item, i) => <li key={`${item.product_name}-${i}`}><span>{item.quantity} ×</span> {item.product_name}</li>)}</ul>
      )}
      <div className="result__actions">
        <button className="button button--gold button--wide" type="button" onClick={onClose}>Seguir comprando</button>
        <button className="button button--ghost button--wide" type="button" onClick={onShowOrders}>Ver mis pedidos</button>
      </div>
    </Modal>
  );
}

export function MyOrdersDialog({ session, onClose }) {
  const [state, setState] = useState({ loading: true, orders: [], error: '' });
  useEffect(() => {
    let alive = true;
    fetch('/api/orders/mine', { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then(data => { if (alive) setState({ loading: false, orders: data.orders || [], error: '' }); })
      .catch(error => { if (alive) setState({ loading: false, orders: [], error: error.message || 'No se pudieron cargar tus pedidos.' }); });
    return () => { alive = false; };
  }, [session.access_token]);
  return (
    <Modal onClose={onClose} variant="drawer" labelledBy="orders-title" className="drawer">
      <header className="drawer__header">
        <h2 id="orders-title" className="sheet__title">Mis pedidos</h2>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
      </header>
      <div className="drawer__items">
        {state.loading && <p className="note my-orders__loading"><Loader2 size={16} className="spin" /> Cargando pedidos…</p>}
        {state.error && <p className="alert alert--error"><AlertCircle size={16} />{state.error}</p>}
        {!state.loading && !state.error && state.orders.length === 0 && (
          <div className="empty-state empty-state--small"><Package size={28} strokeWidth={1.3} /><h3>Todavía no hiciste pedidos</h3><p>Cuando compres algo, lo vas a ver acá con su estado.</p></div>
        )}
        {state.orders.map(order => (
          <article className="my-order" key={order.order_number}>
            <header><strong>{order.order_number}</strong><span className={`status-pill status-pill--${order.order_status}`}>{orderStatusText(order)}</span></header>
            <p>{new Date(order.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · Retiro en {order.pickup_point}</p>
            <ul>{(order.web_order_items || []).map((item, i) => <li key={`${item.product_name}-${i}`}>{item.quantity} × {item.product_name}</li>)}</ul>
            <footer><span>{order.payment_method === 'efectivo' ? 'Efectivo al retirar' : 'Mercado Pago'}{order.payment_status === 'paid' ? ' · pagado' : ''}</span><strong>{money(order.total_amount)}</strong></footer>
          </article>
        ))}
      </div>
    </Modal>
  );
}
