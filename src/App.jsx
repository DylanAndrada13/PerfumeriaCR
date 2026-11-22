import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, ChevronDown, CircleUserRound, LogOut, MapPin, Menu, MessageCircle, Package, PackageSearch,
  RefreshCw, Search, ShoppingBag, SlidersHorizontal, Store, X,
} from 'lucide-react';
import { supabase } from './lib/supabase.js';
import { localPickups, money, pickUpPoints, readCart, saveCart, sameText } from './lib/format.js';
import { DEFAULT_FILTERS, PAGE_SIZE, filtersFromUrl, useCatalogPage, useDebounced, useFacets, useFreshProducts, writeFiltersToUrl } from './lib/catalog.js';
import { Pagination, ProductCard, SkeletonCard } from './components/Products.jsx';
import { ActiveFilters, FilterPanel } from './components/Filters.jsx';
import { CartDialog, CheckoutDialog, MyOrdersDialog, OrderResultDialog, ProductDialog } from './components/Dialogs.jsx';
import { AuthDialog, AuthGate, BootSplash, IntroOverlay, Logo, PasswordResetDialog } from './components/Auth.jsx';
import OrderMonitor from './components/OrderMonitor.jsx';
import CleaningScene from './components/CleaningScene.jsx';
import Modal from './components/Modal.jsx';
import InstallPrompt from './components/InstallPrompt.jsx';

const WHATSAPP_URL = 'https://wa.me/5491133697693';

const SORT_OPTIONS = [
  ['name', 'Nombre (A a Z)'],
  ['recent', 'Novedades'],
  ['price-low', 'Menor precio'],
  ['price-high', 'Mayor precio'],
];

function Brand({ onClick }) {
  return (
    <button className="brand" type="button" onClick={onClick} aria-label="CR Perfumería, ir al inicio">
      <Logo className="brand__logo" eager />
      <span className="brand__name">CR <em>Perfumería</em><small>& Limpieza</small></span>
    </button>
  );
}

function AccountMenu({ session, firstName, onSignOut, onOrders }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (event.type === 'keydown' ? event.key === 'Escape' : !ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div className="account" ref={ref}>
      <button className="header-action" type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-haspopup="true" aria-label={`Tu cuenta, ${firstName}`}>
        <CircleUserRound size={20} /><span>{firstName}</span><ChevronDown size={14} className="header-action__extra" />
      </button>
      {open && (
        <div className="account__menu">
          <p><strong>{session.user.user_metadata?.full_name || firstName}</strong><span>{session.user.email}</span></p>
          <button type="button" onClick={() => { setOpen(false); onOrders(); }}><Package size={16} /> Mis pedidos</button>
          <button type="button" onClick={() => { setOpen(false); onSignOut(); }}><LogOut size={16} /> Cerrar sesión</button>
        </div>
      )}
    </div>
  );
}


function Shop({ session, setSession, onAdmin, notify }) {
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS, ...filtersFromUrl() }));
  const debouncedQ = useDebounced(filters.q, 350);
  const queryFilters = useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ]);
  const catalog = useCatalogPage(queryFilters);
  const facets = useFacets();

  const [cart, setCart] = useState(readCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [detailProduct, setDetailProduct] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [returnedOrder, setReturnedOrder] = useState(() => new URLSearchParams(window.location.search).get('pedido'));
  const [returnedOrderStatus, setReturnedOrderStatus] = useState(null);
  const [returnPollDone, setReturnPollDone] = useState(false);
  const [cashResult, setCashResult] = useState(null);
  const [ordersOpen, setOrdersOpen] = useState(false);
  // Mercado Pago appends its own status to the return URL. It is only a hint for the message; the webhook decides.
  const [mpHint] = useState(() => { const params = new URLSearchParams(window.location.search); return params.get('collection_status') || params.get('status') || ''; });
  const searchRef = useRef(null);
  const catalogRef = useRef(null);

  const scrollCatalog = useCallback((behavior = 'smooth') => {
    catalogRef.current?.scrollIntoView({ behavior, block: 'start' });
    setMobileMenu(false);
  }, []);

  // Any filter change goes back to page 1; only the pager moves between pages.
  const updateFilters = useCallback(patch => setFilters(current => ({ ...current, ...patch, page: 1 })), []);
  const clearFilters = useCallback(() => setFilters(current => ({ ...DEFAULT_FILTERS, sort: current.sort })), []);
  const goToPage = page => { setFilters(current => ({ ...current, page })); scrollCatalog(); };

  useEffect(() => { writeFiltersToUrl(queryFilters); }, [queryFilters]);
  useEffect(() => {
    if (!debouncedQ.trim()) return;
    const top = catalogRef.current?.getBoundingClientRect().top ?? 0;
    if (top > window.innerHeight * 0.6) scrollCatalog();
  }, [debouncedQ, scrollCatalog]);

  useEffect(() => { saveCart(cart); }, [cart]);
  useEffect(() => {
    if (!returnedOrder || !session?.access_token) return undefined;
    // Few, spaced checks: the webhook usually confirms within seconds, so there is no need to poll every 4 s.
    const delays = [0, 3000, 5000, 8000, 12000, 20000, 30000];
    let alive = true;
    let timer = 0;
    const check = async attempt => {
      try {
        const response = await fetch(`/api/orders/status?orderNumber=${encodeURIComponent(returnedOrder)}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No pudimos consultar el pedido.');
        if (!alive) return;
        setReturnedOrderStatus(result.order);
        if (['paid', 'failed'].includes(result.order.payment_status)) return;
        // Without an approval from Mercado Pago there is nothing to wait for.
        if (mpHint !== 'approved' && mpHint !== 'in_process' && mpHint !== 'pending') { setReturnPollDone(true); return; }
      } catch (error) { if (alive) setReturnedOrderStatus({ error: error.message }); }
      if (alive && attempt + 1 < delays.length) timer = window.setTimeout(() => check(attempt + 1), delays[attempt + 1]);
      else if (alive) setReturnPollDone(true);
    };
    check(0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [returnedOrder, session?.access_token, mpHint]);
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

  const fresh = useFreshProducts(cart.map(line => line.id), cartOpen || checkoutOpen);
  const cartItems = useMemo(() => cart.map(line => {
    const latest = fresh[line.id];
    if (latest?.missing) return { ...line, unavailable: 'Ya no está en el catálogo' };
    const product = latest || line;
    const unavailable = latest && !latest.inStock ? 'Sin stock por ahora' : latest && !(latest.price > 0) ? 'Sin precio por ahora' : '';
    return { ...product, qty: line.qty, unavailable };
  }).filter(line => line.qty > 0), [cart, fresh]);
  const cartCount = cartItems.reduce((sum, item) => sum + item.qty, 0);
  const cartTotal = cartItems.reduce((sum, item) => sum + (item.unavailable ? 0 : item.price * item.qty), 0);
  const qtyInCart = useMemo(() => Object.fromEntries(cart.map(line => [line.id, line.qty])), [cart]);

  const addToCart = (product, qty = 1) => {
    if (product.price <= 0 || !product.inStock) { notify('Este producto no está disponible para agregar.'); return; }
    setCart(current => {
      const existing = current.find(line => line.id === product.id);
      const { stock, ...snapshot } = product;
      if (existing) return current.map(line => line.id === product.id ? { ...snapshot, qty: Math.min(99, line.qty + qty) } : line);
      return [...current, { ...snapshot, qty: Math.min(99, qty) }];
    });
    notify(qty > 1 ? `Agregaste ${qty} unidades al carrito` : 'Agregado al carrito');
  };
  const changeQty = (id, qty) => setCart(current => current.map(line => line.id === id ? { ...line, qty: Math.min(99, Math.max(1, qty)) } : line));
  const removeItem = id => setCart(current => current.filter(line => line.id !== id));
  const startCheckout = () => { setCartOpen(false); setCheckoutOpen(true); };
  const startAuth = mode => { setAuthMode(mode || 'login'); setAuthOpen(true); setMobileMenu(false); };
  const signOut = async () => { if (supabase) await supabase.auth.signOut(); setSession(null); };
  const toTop = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); setMobileMenu(false); };
  const firstName = session?.user?.user_metadata?.full_name?.split(' ')[0] || 'Mi cuenta';

  const returnResult = (() => {
    const order = returnedOrderStatus && !returnedOrderStatus.error
      ? { ...returnedOrderStatus, items: returnedOrderStatus.web_order_items || [] }
      : { order_number: returnedOrder };
    if (returnedOrderStatus?.error) return { state: 'error', error: returnedOrderStatus.error, order };
    if (returnedOrderStatus?.payment_status === 'paid') return { state: 'paid', order };
    if (returnedOrderStatus?.payment_status === 'failed') return { state: 'failed', order };
    if (!returnPollDone) return { state: 'checking', order };
    return { state: mpHint === 'approved' || mpHint === 'in_process' || mpHint === 'pending' ? 'pending' : 'failed', order };
  })();
  const closeReturn = () => {
    setReturnedOrder(null);
    const url = new URL(window.location.href);
    ['pedido', 'collection_id', 'collection_status', 'payment_id', 'status', 'external_reference', 'payment_type', 'merchant_order_id', 'preference_id', 'site_id', 'processing_mode', 'merchant_account_id'].forEach(key => url.searchParams.delete(key));
    window.history.replaceState({}, '', url);
  };

  const from = catalog.total ? (filters.page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(catalog.total, filters.page * PAGE_SIZE);
  const activeCount = [filters.category, filters.brand, filters.inStock].filter(Boolean).length;
  const productTotal = facets.total || 0;
  const heading = filters.category || (filters.brand ? `Productos ${filters.brand}` : debouncedQ.trim() ? 'Resultados de búsqueda' : 'Todos los productos');

  return (
    <div className="storefront">
      <a className="skip-link" href="#catalogo">Ir al catálogo</a>
      <header className="site-header">
        <div className="site-header__row wrap">
          <Brand onClick={toTop} />
          <nav className={`main-nav ${mobileMenu ? 'main-nav--open' : ''}`} id="main-nav" aria-label="Navegación principal">
            <button type="button" className="main-nav__link" onClick={() => scrollCatalog()}>Productos</button>
            <button type="button" className="main-nav__link" onClick={() => { updateFilters({ sort: 'recent' }); scrollCatalog(); }}>Novedades</button>
            <button type="button" className="main-nav__link" onClick={() => { document.getElementById('retiro')?.scrollIntoView({ behavior: 'smooth' }); setMobileMenu(false); }}>Dónde retirar</button>
          </nav>
          <form className="search" role="search" onSubmit={event => { event.preventDefault(); scrollCatalog(); searchRef.current?.blur(); }}>
            <Search size={17} aria-hidden="true" />
            <input ref={searchRef} type="search" value={filters.q} onChange={event => updateFilters({ q: event.target.value })} placeholder="Buscar por producto, marca o código" aria-label="Buscar productos" enterKeyHint="search" />
            {filters.q ? <button type="button" className="search__clear" onClick={() => updateFilters({ q: '' })} aria-label="Borrar búsqueda"><X size={15} /></button> : <kbd>Ctrl K</kbd>}
          </form>
          <div className="header-actions">
            <AccountMenu session={session} firstName={firstName} onSignOut={signOut} onOrders={() => setOrdersOpen(true)} />
            <button className="header-action header-action--cart" type="button" onClick={() => setCartOpen(true)} aria-label={`Abrir carrito, ${cartCount} artículos`}>
              <ShoppingBag size={20} /><span>Carrito</span>{cartCount > 0 && <b key={cartCount}>{cartCount}</b>}
            </button>
            <button className="icon-button menu-toggle" onClick={() => setMobileMenu(v => !v)} aria-expanded={mobileMenu} aria-controls="main-nav" aria-label={mobileMenu ? 'Cerrar menú' : 'Abrir menú'} type="button">{mobileMenu ? <X size={20} /> : <Menu size={20} />}</button>
          </div>
        </div>
      </header>

      <main>
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero__copy">
            <h1 id="hero-title">Perfumería y limpieza para retirar cerca de casa</h1>
            <p className="hero__lead">Armá el pedido, pagalo con Mercado Pago o en efectivo y retiralo en nuestros locales o en un punto de encuentro.</p>
            <div className="hero__actions">
              <button className="button button--gold button--large" type="button" onClick={() => scrollCatalog()}>Ver productos</button>
              <button className="button button--outline button--large" type="button" onClick={() => document.getElementById('retiro')?.scrollIntoView({ behavior: 'smooth' })}>Dónde retirar</button>
            </div>
            <dl className="hero__facts">
              <div><dt>{productTotal || '—'}</dt><dd>productos en el catálogo</dd></div>
              <div><dt>{pickUpPoints.length + localPickups.length}</dt><dd>lugares de retiro</dd></div>
            </dl>
          </div>
          <CleaningScene />
        </section>

        <section className="catalog wrap" id="catalogo" ref={catalogRef} aria-labelledby="catalog-title">
          <aside className="catalog__sidebar" aria-label="Filtros">
            <h2 className="catalog__sidebar-title">Filtrar</h2>
            <FilterPanel facets={facets} filters={filters} onChange={updateFilters} idPrefix="side" />
          </aside>
          <div className="catalog__main">
            <div className="catalog__head">
              <div>
                <h2 id="catalog-title">{heading}</h2>
                <p className="catalog__count" aria-live="polite">
                  {catalog.status === 'error' ? 'No pudimos cargar los productos' : catalog.total ? `Mostrando ${from} a ${to} de ${catalog.total} productos` : catalog.status === 'loading' ? 'Buscando productos…' : 'Sin resultados'}
                </p>
              </div>
              <div className="catalog__tools">
                <button className="button button--outline filters-button" type="button" onClick={() => setFiltersOpen(true)}><SlidersHorizontal size={16} /> Filtros{activeCount > 0 && <b>{activeCount}</b>}</button>
                <label className="select">
                  <span>Ordenar</span>
                  <select value={filters.sort} onChange={event => updateFilters({ sort: event.target.value })}>
                    {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <ChevronDown size={15} aria-hidden="true" />
                </label>
              </div>
            </div>
            <div className="category-rail" aria-label="Categorías">
              <button type="button" className={`chip ${!filters.category ? 'is-selected' : ''}`} onClick={() => updateFilters({ category: '' })}>Todas</button>
              {facets.categories.slice().sort((a, b) => b.count - a.count).slice(0, 12).map(item => (
                <button type="button" key={item.name} className={`chip ${sameText(item.name, filters.category) ? 'is-selected' : ''}`} onClick={() => updateFilters({ category: sameText(item.name, filters.category) ? '' : item.name, brand: '' })}>{item.name}</button>
              ))}
            </div>
            <ActiveFilters filters={{ ...filters, q: debouncedQ }} onChange={updateFilters} onClear={clearFilters} />

            {catalog.status === 'error' && (
              <div className="empty-state">
                <PackageSearch size={32} strokeWidth={1.3} />
                <h3>El catálogo no respondió</h3>
                <p>{catalog.error}</p>
                <button className="button button--outline" type="button" onClick={catalog.retry}><RefreshCw size={16} /> Cargar de nuevo</button>
              </div>
            )}
            {catalog.status !== 'error' && (catalog.products.length > 0 || catalog.status === 'loading') && (
              <div className={`product-grid ${catalog.status === 'loading' && catalog.products.length ? 'is-refreshing' : ''}`} aria-busy={catalog.status === 'loading'}>
                {catalog.status === 'loading' && !catalog.products.length
                  ? Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} />)
                  : catalog.products.map(product => <ProductCard key={product.id} product={product} inCart={qtyInCart[product.id] || 0} onAdd={addToCart} onOpen={setDetailProduct} />)}
              </div>
            )}
            {catalog.status === 'ready' && catalog.products.length === 0 && (
              <div className="empty-state">
                <Search size={30} strokeWidth={1.3} />
                <h3>No encontramos productos con esos filtros</h3>
                <p>Probá con otra palabra, otra marca o quitá algún filtro.</p>
                <button type="button" className="button button--outline" onClick={clearFilters}>Borrar filtros</button>
              </div>
            )}
            {catalog.status !== 'error' && <Pagination page={filters.page} totalPages={catalog.totalPages} onPage={goToPage} />}
          </div>
        </section>

        <section className="pickup wrap" id="retiro" aria-labelledby="pickup-title">
          <div className="pickup__intro">
            <h2 id="pickup-title">Cómo comprar y dónde retirar</h2>
            <p>No hay envío a domicilio. Lo retirás en uno de nuestros locales o en un punto de encuentro, y te confirmamos el día y la hora por WhatsApp.</p>
          </div>
          <ol className="how">
            <li><span>1</span><div><strong>Elegí los productos</strong><p>Buscá por nombre, marca o categoría y sumalos al carrito.</p></div></li>
            <li><span>2</span><div><strong>Elegí cómo pagar</strong><p>Con saldo de Mercado Pago ahora, o en efectivo cuando lo retirás.</p></div></li>
            <li><span>3</span><div><strong>Retirá el pedido</strong><p>En el local o en el punto de encuentro, con el número de pedido.</p></div></li>
          </ol>
          <div className="places">
            <div className="places__group">
              <h3><Store size={17} /> Retiro en el local</h3>
              <ul>{localPickups.map(point => <li key={point}>{point}</li>)}</ul>
            </div>
            <div className="places__group">
              <h3><MapPin size={17} /> Puntos de encuentro</h3>
              <ul>{pickUpPoints.map(point => <li key={point}>{point}</li>)}</ul>
            </div>
          </div>
          <p className="pickup__help">¿Tenés una consulta sobre un producto o un pedido? <a className="text-link" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} /> Escribinos por WhatsApp</a></p>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap site-footer__row">
          <Brand onClick={toTop} />
          <a className="text-link" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} /> WhatsApp 11 3369-7693</a>
          <button className="text-link site-footer__admin" type="button" onClick={onAdmin}><Store size={15} /> Pedidos del local</button>
          <span>© {new Date().getFullYear()} CR Perfumería & Limpieza</span>
        </div>
      </footer>

      {cartCount > 0 && !cartOpen && !checkoutOpen && (
        <aside className="floating-cart" aria-label="Resumen del carrito">
          <span className="floating-cart__count"><ShoppingBag size={17} /> {cartCount}</span>
          <strong>{money(cartTotal)}</strong>
          <button className="button button--gold" type="button" onClick={() => setCartOpen(true)}>Ver carrito</button>
        </aside>
      )}

      {filtersOpen && (
        <Modal onClose={() => setFiltersOpen(false)} variant="drawer" labelledBy="filters-title" className="drawer drawer--filters">
          <header className="drawer__header"><h2 id="filters-title" className="sheet__title">Filtros</h2><button className="icon-button" type="button" onClick={() => setFiltersOpen(false)} aria-label="Cerrar filtros"><X size={20} /></button></header>
          <div className="drawer__items"><FilterPanel facets={facets} filters={filters} onChange={updateFilters} idPrefix="sheet" /></div>
          <footer className="drawer__footer">
            <button className="button button--gold button--wide" type="button" onClick={() => { setFiltersOpen(false); scrollCatalog(); }}>{catalog.status === 'loading' ? 'Buscando…' : `Ver ${catalog.total} productos`}</button>
            {activeCount > 0 && <button className="button button--ghost button--wide" type="button" onClick={clearFilters}>Borrar filtros</button>}
          </footer>
        </Modal>
      )}
      {cartOpen && <CartDialog items={cartItems} total={cartTotal} onClose={() => setCartOpen(false)} onQty={changeQty} onRemove={removeItem} onCheckout={startCheckout} />}
      {checkoutOpen && <CheckoutDialog items={cartItems.filter(item => !item.unavailable)} total={cartTotal} session={session} onClose={() => setCheckoutOpen(false)} onBack={() => { setCheckoutOpen(false); setCartOpen(true); }} onOrdered={() => { setCart([]); setCheckoutOpen(false); }} onCashOrdered={(data, items) => { setCart([]); setCheckoutOpen(false); setCashResult({ state: 'cash', order: { order_number: data.orderNumber, pickup_point: data.pickupPoint, pickup_dates: data.pickupDates, total_amount: data.total, payment_method: 'efectivo', items: items.map(item => ({ product_name: item.name, quantity: item.qty })) } }); }} onLogin={() => { setCheckoutOpen(false); startAuth('login'); }} />}
      {returnedOrder && <OrderResultDialog result={returnResult} onClose={closeReturn} onShowOrders={() => { closeReturn(); setOrdersOpen(true); }} />}
      {cashResult && <OrderResultDialog result={cashResult} onClose={() => setCashResult(null)} onShowOrders={() => { setCashResult(null); setOrdersOpen(true); }} />}
      {ordersOpen && <MyOrdersDialog session={session} onClose={() => setOrdersOpen(false)} />}
      {authOpen && <AuthDialog mode={authMode} onClose={() => setAuthOpen(false)} onSignedIn={nextSession => setSession(nextSession)} />}
      {detailProduct && <ProductDialog product={detailProduct} inCart={qtyInCart[detailProduct.id] || 0} onClose={() => setDetailProduct(null)} onAdd={addToCart} />}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(Boolean(supabase));
  const [intro, setIntro] = useState(null);
  const [recovering, setRecovering] = useState(false);
  const [toast, setToast] = useState('');
  const [orderMonitorOpen, setOrderMonitorOpen] = useState(false);
  const [mpConnectResult, setMpConnectResult] = useState(null);
  const toastTimer = useRef(0);

  const notify = useCallback(message => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  }, []);

  // Supabase Auth keeps the session in this browser and refreshes it, so a returning customer goes straight in.
  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;
    supabase.auth.getSession()
      .then(({ data }) => { if (alive) setSession(data.session); })
      .finally(() => { if (alive) setChecking(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

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

  const signedIn = (nextSession, kind) => {
    setSession(nextSession);
    setIntro({ kind, name: nextSession?.user?.user_metadata?.full_name || '' });
  };

  let screen;
  if (checking) screen = <BootSplash />;
  else if (!session) screen = <AuthGate onSignedIn={signedIn} onAdmin={() => setOrderMonitorOpen(true)} />;
  else screen = <Shop session={session} setSession={setSession} onAdmin={() => setOrderMonitorOpen(true)} notify={notify} />;

  return (
    <>
      {screen}
      {intro && session && <IntroOverlay name={intro.name} kind={intro.kind} onDone={() => setIntro(null)} />}
      {recovering && session && <PasswordResetDialog onClose={() => setRecovering(false)} onDone={() => { setRecovering(false); notify('Guardamos tu contraseña nueva.'); }} />}
      {orderMonitorOpen && <OrderMonitor connectionResult={mpConnectResult} onClose={() => setOrderMonitorOpen(false)} />}
      {!checking && <InstallPrompt />}
      {toast && <div className="toast" role="status"><span><Check size={16} /></span>{toast}</div>}
    </>
  );
}
