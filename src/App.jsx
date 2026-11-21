import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, Check, ChevronDown, CircleUserRound,
  CreditCard, Heart, LockKeyhole, LogOut, MapPin, Menu, Minus, Package,
  Plus, Search, ShieldCheck, ShoppingBag, ShoppingCart, Sparkles, X,
} from 'lucide-react';
import { authReady, supabase } from './lib/supabase.js';

const pickUpPoints = ['Coto Lanús', 'Ciclón Caraza', 'UPA Recondo', 'Maxi Carrefour', 'Santa Marta'];
const CART_STORAGE = 'cr-perfumeria-cart-v1';
const money = value => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value || 0);
const mpConnectMessages = {
  success: 'Mercado Pago autorizó la cuenta. El panel confirma abajo si quedó guardada.',
  cancelled: 'Se canceló la autorización de Mercado Pago.',
  invalid_state: 'La autorización venció o volvió en otra sesión del navegador. Iniciá la conexión otra vez desde este panel.',
  token_rejected: 'Mercado Pago rechazó el intercambio OAuth. Revisá Client ID, Client Secret, URL de retorno y PKCE en Vercel/Mercado Pago.',
  live_account_rejected: 'La cuenta autorizada no es la cuenta vendedora de prueba configurada. No se guardó la conexión.',
  missing_test_seller_config: 'Falta MERCADOPAGO_TEST_USER_ID en Vercel. No se guardó la conexión.',
  wrong_test_seller: 'El User ID autorizado no coincide con MERCADOPAGO_TEST_USER_ID. Compará el ID esperado que muestra este panel con el vendedor de prueba.',
  test_seller_in_production: 'No se puede conectar la cuenta vendedora de prueba mientras el entorno está en producción. No se guardó la conexión.',
  wrong_test_token_type: 'Mercado Pago no devolvió las credenciales APP_USR requeridas para el vendedor de prueba. No se guardó la conexión.',
  identity_mismatch: 'Mercado Pago devolvió IDs de cuenta distintos. No se guardó la conexión.',
  server_config_error: 'Falta una variable de configuración OAuth en Vercel. No se guardó la conexión.',
  encryption_error: 'MP_TOKEN_ENCRYPTION_KEY no es una clave Base64 válida de 32 bytes. No se guardó la conexión.',
  database_error: 'Supabase rechazó el guardado de la conexión. Revisá la función save_mp_seller_connection y SUPABASE_SECRET_KEY en Vercel.',
  failed: 'Falló el callback OAuth. No se guardó la conexión; revisá los registros de funciones de Vercel para ver el detalle.',
};

function readCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_STORAGE) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

function Brand({ onClick }) {
  return (
    <button className="brand" type="button" onClick={onClick} aria-label="CR Perfumería, ir al inicio">
      <span className="brand__seal"><span>CR</span><i /></span>
      <span className="brand__name">CR <span>Perfumería</span><small>& Limpieza</small></span>
    </button>
  );
}

function ImageFallback({ product }) {
  return (
    <div className="image-fallback" aria-label="Imagen no disponible">
      <span className="image-fallback__orbit" />
      <Package size={30} strokeWidth={1.15} />
      <span>{product?.category || 'CR Perfumería'}</span>
    </div>
  );
}

function ProductImage({ product, className = '' }) {
  const [failed, setFailed] = useState(false);
  if (!product.image || failed) return <ImageFallback product={product} />;
  return <img className={className} src={product.image} alt={product.name} loading="lazy" onError={() => setFailed(true)} />;
}

function ProductCard({ product, onAdd, onOpen }) {
  const unavailable = !product.inStock || product.price <= 0;
  const deal = Number(product.previousPrice) > product.price;
  return (
    <article className="product-card">
      <button className="product-card__photo" type="button" onClick={() => onOpen(product)} aria-label={`Ver ${product.name}`}>
        {deal && <span className="sale-chip">Oferta</span>}
        <ProductImage product={product} className="product-card__image" />
        <span className="product-card__zoom"><ArrowRight size={16} /></span>
      </button>
      <div className="product-card__content">
        <div className="product-card__name-line">
          <button className="product-card__name" type="button" onClick={() => onOpen(product)}>{product.name}</button>
          {product.brand && <span className="product-card__brand">{product.brand}</span>}
        </div>
        <div className="product-card__bottom">
          <div className="price-block">
            {deal && <del>{money(product.previousPrice)}</del>}
            <strong>{product.price > 0 ? money(product.price) : 'Consultar precio'}</strong>
          </div>
          <button className="add-button" type="button" disabled={unavailable} onClick={() => onAdd(product)} aria-label={`Agregar ${product.name} al carrito`}>
            {!product.inStock ? 'Agotado' : product.price <= 0 ? 'Sin precio' : <><Plus size={16} /><span>Agregar</span></>}
          </button>
        </div>
      </div>
    </article>
  );
}

function AuthDialog({ mode, onMode, onClose, onSignedIn }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async event => {
    event.preventDefault();
    setError(''); setMessage('');
    if (!authReady || !supabase) {
      setError('Falta configurar la clave pública de Supabase Auth para habilitar cuentas.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: name.trim() } },
        });
        if (authError) throw authError;
        if (data.session) { onSignedIn(data.session); onClose(); }
        else setMessage('Te enviamos un correo para confirmar tu cuenta.');
      } else if (mode === 'recover') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (authError) throw authError;
        setMessage('Si el correo está registrado, vas a recibir un enlace para cambiar la contraseña.');
      } else {
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        onSignedIn(data.session); onClose();
      }
    } catch (authError) { setError(authError.message || 'No se pudo completar el acceso.'); }
    finally { setBusy(false); }
  };

  const title = mode === 'signup' ? 'Crear cuenta' : mode === 'recover' ? 'Recuperar contraseña' : 'Hola de nuevo';
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="icon-button dialog__close" type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        <span className="dialog__mark"><CircleUserRound size={22} /></span>
        <p className="eyebrow">Tu espacio CR</p>
        <h2 id="auth-title">{title}</h2>
        <p className="dialog__intro">{mode === 'signup' ? 'Registrate para guardar tu compra y volver cuando quieras.' : mode === 'recover' ? 'Te enviamos un enlace para crear una contraseña nueva.' : 'Ingresá para continuar con tu compra.'}</p>
        <form onSubmit={submit} className="auth-form">
          {mode === 'signup' && <label>Nombre completo<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} required minLength={2} /></label>}
          <label>Correo electrónico<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
          {mode !== 'recover' && <label>Contraseña<input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={6} /></label>}
          {!authReady && <p className="inline-note">La conexión de cuentas se habilita al configurar Supabase Auth.</p>}
          {error && <p className="form-message form-message--error" role="alert">{error}</p>}
          {message && <p className="form-message" role="status">{message}</p>}
          <button className="button button--gold button--wide" type="submit" disabled={busy}>{busy ? 'Un momento…' : mode === 'signup' ? 'Crear cuenta' : mode === 'recover' ? 'Enviar enlace' : 'Iniciar sesión'}</button>
        </form>
        <div className="auth-switches">
          {mode === 'login' && <button type="button" onClick={() => onMode('recover')}>¿Olvidaste tu contraseña?</button>}
          {mode === 'recover' ? <button type="button" onClick={() => onMode('login')}>Volver al inicio de sesión</button> : <button type="button" onClick={() => onMode(mode === 'signup' ? 'login' : 'signup')}>{mode === 'signup' ? 'Ya tengo cuenta' : 'Crear una cuenta'}</button>}
        </div>
        <div className="dialog__secure"><LockKeyhole size={14} /> Acceso seguro con Supabase</div>
      </section>
    </div>
  );
}

function ProductDialog({ product, onClose, onAdd }) {
  const [qty, setQty] = useState(1);
  const max = 99;
  const unavailable = !product.inStock || product.price <= 0;
  const deal = Number(product.previousPrice) > product.price;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog product-dialog" role="dialog" aria-modal="true" aria-labelledby="product-title">
        <button className="icon-button dialog__close" type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        <div className="product-dialog__image"><ProductImage product={product} className="product-dialog__photo" /></div>
        <div className="product-dialog__details">
          {product.category && <p className="eyebrow">{product.category}</p>}
          <h2 id="product-title">{product.name}</h2>
          {product.brand && <p className="product-dialog__brand">{product.brand}</p>}
          {deal && <del className="old-price">{money(product.previousPrice)}</del>}
          <p className="product-dialog__price">{product.price > 0 ? money(product.price) : 'Consultar precio'}</p>
          <p className={`stock-caption ${!product.inStock ? 'stock-caption--out' : ''}`}>{product.inStock ? 'Disponible para agregar' : 'Sin stock por el momento'}</p>
          <div className="product-dialog__actions">
            <div className="stepper" aria-label="Cantidad">
              <button type="button" onClick={() => setQty(n => Math.max(1, n - 1))} aria-label="Quitar una unidad"><Minus size={16} /></button>
              <span>{qty}</span>
              <button type="button" onClick={() => setQty(n => Math.min(max, n + 1))} aria-label="Agregar una unidad" disabled={qty >= max}><Plus size={16} /></button>
            </div>
            <button className="button button--gold" type="button" disabled={unavailable} onClick={() => { onAdd(product, qty); onClose(); }}><ShoppingBag size={17} /> Agregar al carrito</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function CartDialog({ items, total, onClose, onQty, onRemove, onCheckout }) {
  return (
    <div className="modal-backdrop modal-backdrop--cart" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="cart-dialog" role="dialog" aria-modal="true" aria-labelledby="cart-title">
        <header className="cart-dialog__header">
          <div><p className="eyebrow">Tu selección</p><h2 id="cart-title">Carrito <span>({items.length})</span></h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar carrito"><X size={21} /></button>
        </header>
        <div className="cart-dialog__items">
          {items.map(item => (
            <article className="cart-line" key={item.id}>
              <div className="cart-line__photo"><ProductImage product={item} className="cart-line__img" /></div>
              <div className="cart-line__details"><strong>{item.name}</strong><span>{item.price > 0 ? money(item.price) : 'Consultar precio'}</span>
                <div className="stepper stepper--small">
                  <button type="button" onClick={() => onQty(item.id, item.qty - 1)} aria-label={`Quitar unidad de ${item.name}`}><Minus size={13} /></button><span>{item.qty}</span><button type="button" onClick={() => onQty(item.id, item.qty + 1)} disabled={item.qty >= 99} aria-label={`Agregar unidad de ${item.name}`}><Plus size={13} /></button>
                </div>
              </div>
              <div className="cart-line__right"><strong>{item.price > 0 ? money(item.price * item.qty) : '—'}</strong><button className="text-button" type="button" onClick={() => onRemove(item.id)}>Quitar</button></div>
            </article>
          ))}
        </div>
        <footer className="cart-dialog__footer">
          <div className="subtotal"><span>Subtotal</span><strong>{money(total)}</strong></div>
          <p>El precio final se confirma antes de realizar el pedido.</p>
          <button className="button button--gold button--wide" type="button" onClick={onCheckout}>Continuar con la compra <ArrowRight size={17} /></button>
          <button className="button button--text button--wide" type="button" onClick={onClose}>Seguir mirando</button>
        </footer>
      </section>
    </div>
  );
}

function CheckoutDialog({ items, total, session, onClose, onLogin, onOrdered }) {
  const [pickup, setPickup] = useState('');
  const [payment, setPayment] = useState('Mercado Pago');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('El checkout acepta pagos con saldo de una cuenta de Mercado Pago. No admite tarjetas ni efectivo.');
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
  return (
    <div className="modal-backdrop modal-backdrop--cart" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
        <header className="cart-dialog__header"><button className="back-link" type="button" onClick={onClose}><ArrowLeft size={16} /> Volver al carrito</button><button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar"><X size={21} /></button></header>
        <p className="eyebrow">Último paso</p><h2 id="checkout-title">¿Dónde y cómo retirás?</h2>
        <div className="checkout-section"><h3><MapPin size={17} /> Punto de retiro</h3><div className="option-grid">{pickUpPoints.map(point => <button type="button" className={`choice ${pickup === point ? 'is-selected' : ''}`} key={point} onClick={() => setPickup(point)}>{point}{pickup === point && <Check size={15} />}</button>)}</div></div>
        <div className="checkout-section"><h3><CreditCard size={17} /> Medio de pago</h3><div className="payment-options"><div className="choice is-selected">Saldo de Mercado Pago <Check size={15} /></div></div></div>
        <div className="checkout-summary"><span>{items.reduce((sum, item) => sum + item.qty, 0)} artículos</span><strong>{money(total)}</strong></div>
        {!session?.user ? <button className="button button--gold button--wide" type="button" onClick={onLogin}>Iniciá sesión para continuar</button> : <button className="button button--gold button--wide" type="button" disabled={!pickup || !payment || busy} onClick={submit}>{busy ? 'Conectando con Mercado Pago…' : 'Continuar a Mercado Pago'}</button>}
        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        <p className="checkout-note" role="status">{notice}</p>
        <p className="checkout-note checkout-note--secure"><LockKeyhole size={13} /> Nunca confirmamos un pago por la pantalla de regreso.</p>
      </section>
    </div>
  );
}

function OrderMonitor({ onClose, connectionResult }) {
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sellerConnection, setSellerConnection] = useState(null);
  const [connectionError, setConnectionError] = useState('');
  const load = async () => {
    const response = await fetch('/api/admin/orders', { credentials: 'same-origin' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los pedidos.');
    setOrders(data.orders || []); setLoggedIn(true); setError('');
    const connectionResponse = await fetch('/api/admin/mp/status', { credentials: 'same-origin' });
    const connectionData = await connectionResponse.json();
    if (connectionResponse.ok) { setSellerConnection(connectionData); setConnectionError(''); }
    else setConnectionError(connectionData.error || 'No se pudo consultar la cuenta conectada.');
  };
  const login = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'No se pudo ingresar.');
      await load(); setPassword('');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { load().catch(() => {}); }, []);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <button className="icon-button dialog__close" type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        <span className="dialog__mark"><ShieldCheck size={22} /></span><p className="eyebrow">Vista temporal del local</p><h2 id="admin-title">Pedidos online</h2>
        {!loggedIn ? <form onSubmit={login} className="auth-form"><p className="dialog__intro">Ingresá la clave de administración configurada en el servidor.</p><label>Clave<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label><button className="button button--gold button--wide" disabled={busy}>{busy ? 'Ingresando…' : 'Ver pedidos'}</button></form> : <><section className="mp-connection"><div><strong>Cuenta vendedora de Mercado Pago</strong><span>{sellerConnection?.connected ? `Conectada: ${sellerConnection.seller.nickname || `cuenta ${sellerConnection.seller.id}`}` : 'Todavía no hay una cuenta conectada.'}</span><span className={`mp-environment ${sellerConnection?.environment === 'test' ? 'mp-environment--test' : 'mp-environment--warning'}`}>{sellerConnection?.environment === 'test' ? 'Entorno: PRUEBA' : sellerConnection?.environment === 'production' ? 'Entorno: PRODUCCIÓN' : 'Entorno: sin configurar'}</span>{sellerConnection?.environment === 'test' && sellerConnection.configuredTestSellerId && <span>Vendedor de prueba esperado: {sellerConnection.configuredTestSellerId}</span>}</div><a className="button button--outline" href="/api/admin/mp/connect">{sellerConnection?.connected ? 'Cambiar cuenta' : 'Conectar cuenta'}</a></section>{connectionResult && <p className={`connection-result ${connectionResult === 'success' ? 'connection-result--success' : 'connection-result--error'}`} role="status">{mpConnectMessages[connectionResult] || mpConnectMessages.failed}</p>}{sellerConnection?.environment === 'test' && !sellerConnection.testSellerConfigured && <p className="form-message form-message--error" role="alert">Falta MERCADOPAGO_TEST_USER_ID en Vercel; no se aceptan pagos de prueba hasta configurarlo.</p>}{sellerConnection?.sellerMatchesTestUser === false && <p className="form-message form-message--error" role="alert">La cuenta conectada no coincide con la cuenta vendedora de prueba configurada.</p>}{sellerConnection?.sellerIsTestAccount && <p className="form-message form-message--error" role="alert">La cuenta conectada es de prueba. En producción no se habilitarán cobros hasta conectar una cuenta real.</p>}{connectionError && <p className="form-message form-message--error" role="alert">{connectionError}</p>}<p className="checkout-note">El pedido se guarda y el pago se confirma mediante el webhook de Mercado Pago. Esta aplicación no modifica el stock del catálogo.</p><div className="admin-toolbar"><span>{orders.length} pedidos recientes</span><button className="text-button" type="button" onClick={() => load().catch(err => setError(err.message))}>Actualizar</button></div><div className="admin-orders">{orders.length === 0 ? <p className="checkout-note">Todavía no hay pedidos.</p> : orders.map(order => <article className="admin-order" key={order.id}><header><strong>{order.order_number}</strong><span className={`status-pill status-pill--${order.payment_status}`}>{order.payment_status === 'paid' ? 'Pago verificado' : order.payment_status === 'failed' ? 'Pago rechazado' : 'Pago pendiente'}</span></header><p>{order.customer_name} · {order.customer_email}</p><p>{new Date(order.created_at).toLocaleString('es-AR')} · Retiro: {order.pickup_point}</p><ul>{(order.web_order_items || []).map((item, i) => <li key={`${item.product_name}-${i}`}>{item.quantity} × {item.product_name}</li>)}</ul><footer><span>{order.payment_method === 'mercado_pago' ? 'Mercado Pago' : order.payment_method}</span><strong>{money(order.total_amount)}</strong></footer></article>)}</div></>}
        {error && <p className="form-message form-message--error" role="alert">{error}</p>}
        <div className="dialog__secure"><LockKeyhole size={14} /> Los pagos se marcan pagados solo al verificar a Mercado Pago</div>
      </section>
    </div>
  );
}

export default function App() {
  const [products, setProducts] = useState([]);
  const [catalogStatus, setCatalogStatus] = useState('loading');
  const [catalogMessage, setCatalogMessage] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todos');
  const [cart, setCart] = useState(readCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [detailProduct, setDetailProduct] = useState(null);
  const [session, setSession] = useState(null);
  const [toast, setToast] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [orderMonitorOpen, setOrderMonitorOpen] = useState(false);
  const [mpConnectResult, setMpConnectResult] = useState(null);
  const [returnedOrder, setReturnedOrder] = useState(() => new URLSearchParams(window.location.search).get('pedido'));
  const [returnedOrderStatus, setReturnedOrderStatus] = useState(null);
  const [sort, setSort] = useState('name');
  const searchRef = useRef(null);

  const notify = useCallback(message => {
    setToast(message);
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(''), 2600);
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatalogStatus('loading');
    try {
      const response = await fetch('/api/catalog/products', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo cargar el catálogo.');
      const normalized = (data.products || []).map(product => ({
        ...product,
        price: Number(product.price) || 0,
        inStock: Boolean(product.inStock),
      }));
      setProducts(normalized);
      setCatalogStatus('ready');
      setCatalogMessage('');
    } catch (error) {
      setCatalogStatus('error');
      setCatalogMessage(error.message || 'No se pudo cargar el catálogo.');
    }
  }, []);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectStatus = params.get('mp_connect');
    if (!connectStatus) return;
    setOrderMonitorOpen(true);
    setMpConnectResult(connectStatus);
    if (connectStatus === 'success') notify('La cuenta vendedora de Mercado Pago quedó conectada.');
    else if (connectStatus !== 'cancelled') notify('No se pudo conectar la cuenta de Mercado Pago. Revisá la configuración e intentá de nuevo.');
    params.delete('mp_connect'); params.delete('panel');
    const nextUrl = `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', nextUrl);
  }, [notify]);
  useEffect(() => { localStorage.setItem(CART_STORAGE, JSON.stringify(cart)); }, [cart]);
  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) setSession(data.session); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!returnedOrder || !session?.access_token) return undefined;
    let attempts = 0;
    let alive = true;
    const check = async () => {
      attempts += 1;
      try {
        const response = await fetch(`/api/orders/status?orderNumber=${encodeURIComponent(returnedOrder)}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No pudimos consultar el pedido.');
        if (alive) setReturnedOrderStatus(result.order);
        if (['paid', 'failed'].includes(result.order.payment_status)) window.clearInterval(timer);
      } catch (error) { if (alive) setReturnedOrderStatus({ error: error.message }); }
      if (attempts >= 20) window.clearInterval(timer);
    };
    check();
    const timer = window.setInterval(check, 4000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [returnedOrder, session?.access_token]);
  useEffect(() => {
    const onShortcut = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  const categories = useMemo(() => ['Todos', ...new Set(products.map(product => product.category.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'es')))], [products]);
  const filteredProducts = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('es');
    const filtered = products.filter(product => {
      const matchesCategory = category === 'Todos' || product.category === category;
      const haystack = `${product.name} ${product.brand} ${product.category} ${product.quantity}`.toLocaleLowerCase('es');
      return matchesCategory && (!term || haystack.includes(term));
    });
    if (sort === 'price-low') return filtered.sort((a, b) => a.price - b.price);
    if (sort === 'price-high') return filtered.sort((a, b) => b.price - a.price);
    if (sort === 'recent') return filtered.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    return filtered.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [products, query, category, sort]);

  const cartItems = useMemo(() => cart.map(line => {
    const product = products.find(item => item.id === line.id) || line;
    return { ...product, qty: line.qty };
  }).filter(line => line.qty > 0), [cart, products]);
  const cartCount = cartItems.reduce((sum, item) => sum + item.qty, 0);
  const cartTotal = cartItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  const heroProduct = products.find(product => product.image) || products[0];

  const addToCart = (product, qty = 1) => {
    if (product.price <= 0 || !product.inStock) { notify('Este producto no está disponible para agregar.'); return; }
    const wasEmpty = cart.length === 0;
    setCart(current => {
      const existing = current.find(line => line.id === product.id);
      if (existing) return current.map(line => line.id === product.id ? { ...product, qty: Math.min(99, line.qty + qty) } : line);
      return [...current, { ...product, qty: Math.min(99, qty) }];
    });
    notify(wasEmpty ? '¡Iniciaste una compra!' : 'Agregado al carrito');
  };
  const changeQty = (id, qty) => setCart(current => current.map(line => line.id === id ? { ...line, qty: Math.min(99, Math.max(1, qty)) } : line));
  const removeItem = id => setCart(current => current.filter(line => line.id !== id));
  const startCheckout = () => { setCartOpen(false); setCheckoutOpen(true); };
  const startAuth = mode => { setAuthMode(mode || 'login'); setAuthOpen(true); setMobileMenu(false); };
  const signOut = async () => { if (supabase) await supabase.auth.signOut(); setSession(null); notify('Cerraste sesión.'); };
  const scrollCatalog = () => { document.getElementById('catalogo')?.scrollIntoView({ behavior: 'smooth' }); setMobileMenu(false); };

  return (
    <div className="storefront">
      <div className="notice-bar"><span>CR Perfumería & Limpieza</span><span className="notice-bar__divider" /><span>Comprá online, retiralo donde te quede cómodo</span><ArrowDown size={13} /></div>
      <header className="site-header">
        <Brand onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
        <button className={`menu-toggle icon-button ${mobileMenu ? 'is-open' : ''}`} onClick={() => setMobileMenu(v => !v)} aria-label={mobileMenu ? 'Cerrar menú' : 'Abrir menú'} type="button">{mobileMenu ? <X /> : <Menu />}</button>
        <nav className={`main-nav ${mobileMenu ? 'main-nav--open' : ''}`} aria-label="Navegación principal">
          <button type="button" className="main-nav__link is-active" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Inicio</button>
          <button type="button" className="main-nav__link" onClick={scrollCatalog}>Catálogo</button>
          <button type="button" className="main-nav__link" onClick={() => { setSort('recent'); scrollCatalog(); }}>Novedades</button>
        </nav>
        <div className="header-actions">
          <label className="header-search"><Search size={16} /><input ref={searchRef} value={query} onChange={e => { setQuery(e.target.value); setCategory('Todos'); }} placeholder="Buscar productos" aria-label="Buscar productos" /><kbd>Ctrl K</kbd></label>
          {session ? <div className="account-menu"><button className="account-button" type="button" onClick={signOut} title="Cerrar sesión"><CircleUserRound size={19} /><span>{session.user.user_metadata?.full_name?.split(' ')[0] || 'Mi cuenta'}</span><LogOut size={14} /></button></div> : <button className="account-button" type="button" onClick={() => startAuth('login')}><CircleUserRound size={20} /><span>Ingresar</span></button>}
          <button className="header-cart" type="button" onClick={() => setCartOpen(true)} aria-label={`Abrir carrito, ${cartCount} artículos`}><ShoppingBag size={20} /><span>Carrito</span><b>{cartCount}</b></button>
        </div>
      </header>

      <main>
        {returnedOrder && <div className={`order-return order-return--${returnedOrderStatus?.payment_status || 'pending'}`} role="status"><div><strong>{returnedOrderStatus?.payment_status === 'paid' ? 'Pago verificado' : returnedOrderStatus?.payment_status === 'failed' ? 'Pago no confirmado' : 'Estamos verificando tu pago'}</strong><span>Pedido {returnedOrder} · {returnedOrderStatus?.error || (returnedOrderStatus?.payment_status === 'paid' ? 'Recibimos la confirmación segura de Mercado Pago.' : 'Volver a esta página no confirma el pago; esperamos la validación de Mercado Pago.')}</span></div><button type="button" onClick={() => { setReturnedOrder(null); const url = new URL(window.location.href); url.searchParams.delete('pedido'); window.history.replaceState({}, '', url); }} aria-label="Cerrar aviso"><X size={17} /></button></div>}
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__copy">
            <p className="eyebrow"><span className="eyebrow__line" />Tu casa, en buenas manos</p>
            <h1 id="hero-title">Todo lo que<br />te hace bien<span>.</span></h1>
            <p className="hero__text">Perfumería y limpieza para todos los días. Elegí con calma, armá tu compra y pasá a buscarla.</p>
            <div className="hero__actions"><button className="button button--gold" type="button" onClick={scrollCatalog}>Explorar catálogo <ArrowRight size={17} /></button><span className="hero__caption"><ShieldCheck size={15} /> Compra simple y segura</span></div>
            <div className="hero__divider" />
            <div className="hero__facts"><span><MapPin size={16} /> 5 puntos de retiro</span><span><Sparkles size={15} /> Perfumería & hogar</span></div>
          </div>
          <div className="hero-art" aria-label={heroProduct ? `Producto del catálogo: ${heroProduct.name}` : 'CR Perfumería & Limpieza'}>
            <div className="hero-art__halo" />
            <div className="hero-art__frame">
              <div className="hero-art__corner hero-art__corner--tl" /><div className="hero-art__corner hero-art__corner--br" />
              <span className="hero-art__label">CR · Selección del local</span>
              {heroProduct ? <ProductImage product={heroProduct} className="hero-art__product" /> : <div className="hero-art__monogram">CR</div>}
              <div className="hero-art__foot"><span>{heroProduct?.name || 'Perfumería & Limpieza'}</span><span>{heroProduct?.price ? money(heroProduct.price) : 'Para tu día a día'}</span></div>
            </div>
            <div className="hero-art__seal"><span>CR</span><small>DESDE<br />EL BARRIO</small></div>
          </div>
          <span className="hero__index">01 <i /> 03</span>
        </section>

        <section className="catalog-section" id="catalogo" aria-labelledby="catalog-title">
          <div className="section-heading">
            <div><p className="eyebrow">El catálogo del local</p><h2 id="catalog-title">Encontrá tus favoritos<span>.</span></h2><p>Lo que buscás, en un solo lugar.</p></div>
            <label className="sort-control"><span>Ordenar por</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="name">Nombre</option><option value="recent">Últimos actualizados</option><option value="price-low">Precio: menor a mayor</option><option value="price-high">Precio: mayor a menor</option></select><ChevronDown size={14} /></label>
          </div>
          <div className="catalog-toolbar">
            <div className="category-list" aria-label="Filtrar por categoría">{categories.map(item => <button key={item} type="button" className={`category-chip ${category === item ? 'is-selected' : ''}`} onClick={() => setCategory(item)}>{item}</button>)}</div>
            <span className="product-count">{catalogStatus === 'ready' ? `${filteredProducts.length} productos` : 'Catálogo CR'}</span>
          </div>
          {catalogStatus === 'loading' && <div className="loading-state"><span className="loader" /><p>Abriendo el catálogo…</p></div>}
          {catalogStatus === 'error' && <div className="catalog-state"><span className="catalog-state__icon"><Package size={24} /></span><h3>El catálogo todavía no está disponible</h3><p>{catalogMessage}</p><button className="button button--outline" type="button" onClick={loadCatalog}>Volver a intentar <ArrowRight size={16} /></button></div>}
          {catalogStatus === 'ready' && filteredProducts.length > 0 && <div className="product-grid">{filteredProducts.map(product => <ProductCard key={product.id} product={product} onAdd={addToCart} onOpen={setDetailProduct} />)}</div>}
          {catalogStatus === 'ready' && filteredProducts.length === 0 && <div className="catalog-state catalog-state--quiet"><Search size={25} /><h3>No encontramos ese producto</h3><p>Probá con otro nombre o categoría.</p><button type="button" className="text-button" onClick={() => { setQuery(''); setCategory('Todos'); }}>Limpiar búsqueda</button></div>}
        </section>

        <section className="promise-strip" aria-label="Compra online en CR">
          <div><span className="promise-strip__icon"><ShieldCheck size={19} /></span><p><strong>Una compra tranquila</strong><small>Elegí y revisá todo antes de confirmar</small></p></div>
          <div><span className="promise-strip__icon"><MapPin size={19} /></span><p><strong>Retirá cerca tuyo</strong><small>Elegí entre nuestros puntos disponibles</small></p></div>
          <div><span className="promise-strip__icon"><Heart size={19} /></span><p><strong>Atención de siempre</strong><small>CR Perfumería & Limpieza</small></p></div>
        </section>
      </main>

      <footer className="site-footer"><Brand onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} /><p>Lo cotidiano, un poco más simple.</p><button className="text-button site-footer__admin" type="button" onClick={() => setOrderMonitorOpen(true)}>Pedidos del local</button><span>© {new Date().getFullYear()} CR Perfumería & Limpieza</span></footer>

      {cartCount > 0 && <aside className="floating-cart"><div className="floating-cart__summary"><span className="floating-cart__count"><ShoppingBag size={17} /> {cartCount}</span><span>{cartCount === 1 ? 'artículo en tu compra' : 'artículos en tu compra'}</span></div><strong>{money(cartTotal)}</strong><button className="button button--gold" type="button" onClick={() => setCartOpen(true)}>Ver carrito <ArrowRight size={16} /></button></aside>}

      {toast && <div className="toast" role="status"><span><Check size={17} /></span>{toast}</div>}
      {cartOpen && <CartDialog items={cartItems} total={cartTotal} onClose={() => setCartOpen(false)} onQty={changeQty} onRemove={removeItem} onCheckout={startCheckout} />}
      {checkoutOpen && <CheckoutDialog items={cartItems} total={cartTotal} session={session} onClose={() => setCheckoutOpen(false)} onOrdered={() => { setCart([]); setCheckoutOpen(false); }} onLogin={() => { setCheckoutOpen(false); startAuth('login'); }} />}
      {authOpen && <AuthDialog mode={authMode} onMode={setAuthMode} onClose={() => setAuthOpen(false)} onSignedIn={setSession} />}
      {detailProduct && <ProductDialog product={detailProduct} onClose={() => setDetailProduct(null)} onAdd={addToCart} />}
      {orderMonitorOpen && <OrderMonitor connectionResult={mpConnectResult} onClose={() => setOrderMonitorOpen(false)} />}
    </div>
  );
}
