import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Check, ChevronDown, CircleUserRound, LogOut, MapPin, Menu, PackageSearch,
  RefreshCw, Search, ShoppingBag, SlidersHorizontal, Store, Wallet, X,
} from 'lucide-react';
import { supabase } from './lib/supabase.js';
import { money, pickUpPoints, readCart, saveCart, sameText } from './lib/format.js';
import { DEFAULT_FILTERS, PAGE_SIZE, filtersFromUrl, useCatalogPage, useDebounced, useFacets, useFreshProducts, useShowcase, writeFiltersToUrl } from './lib/catalog.js';
import { Pagination, ProductCard, ProductImage, SkeletonCard } from './components/Products.jsx';
import { ActiveFilters, FilterPanel } from './components/Filters.jsx';
import { AuthDialog, CartDialog, CheckoutDialog, ProductDialog } from './components/Dialogs.jsx';
import OrderMonitor from './components/OrderMonitor.jsx';
import Modal from './components/Modal.jsx';

const SORT_OPTIONS = [
  ['name', 'Nombre (A a Z)'],
  ['recent', 'Novedades'],
  ['price-low', 'Menor precio'],
  ['price-high', 'Mayor precio'],
];

function Brand({ onClick }) {
  return (
    <button className="brand" type="button" onClick={onClick} aria-label="CR Perfumería, ir al inicio">
      <span className="brand__seal" aria-hidden="true">CR</span>
      <span className="brand__name">CR <em>Perfumería</em><small>& Limpieza</small></span>
    </button>
  );
}

function Showcase({ products, onOpen }) {
  if (!products.length) {
    return <div className="showcase showcase--empty" aria-hidden="true"><span className="showcase__monogram">CR</span></div>;
  }
  return (
    <div className={`showcase showcase--${products.length}`}>
      {products.map((product, index) => (
        <button key={product.id} type="button" className={`showcase__tile showcase__tile--${index}`} onClick={() => onOpen(product)} aria-label={`Ver ${product.name}`}>
          <ProductImage product={product} className="showcase__img" eager />
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS, ...filtersFromUrl() }));
  const debouncedQ = useDebounced(filters.q, 350);
  const queryFilters = useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ]);
  const catalog = useCatalogPage(queryFilters);
  const facets = useFacets();
  const showcase = useShowcase();

  const [cart, setCart] = useState(readCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const searchRef = useRef(null);
  const catalogRef = useRef(null);
  const toastTimer = useRef(0);

  const notify = useCallback(message => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  }, []);

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
  useEffect(() => { saveCart(cart); }, [cart]);
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
  const signOut = async () => { if (supabase) await supabase.auth.signOut(); setSession(null); notify('Cerraste sesión.'); };
  const toTop = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); setMobileMenu(false); };
  const firstName = session?.user?.user_metadata?.full_name?.split(' ')[0] || 'Mi cuenta';

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
            <button type="button" className="main-nav__link" onClick={() => { document.getElementById('retiro')?.scrollIntoView({ behavior: 'smooth' }); setMobileMenu(false); }}>Puntos de retiro</button>
          </nav>
          <form className="search" role="search" onSubmit={event => { event.preventDefault(); scrollCatalog(); searchRef.current?.blur(); }}>
            <Search size={17} aria-hidden="true" />
            <input ref={searchRef} type="search" value={filters.q} onChange={event => updateFilters({ q: event.target.value })} placeholder="Buscar por producto, marca o código" aria-label="Buscar productos" enterKeyHint="search" />
            {filters.q ? <button type="button" className="search__clear" onClick={() => updateFilters({ q: '' })} aria-label="Borrar búsqueda"><X size={15} /></button> : <kbd>Ctrl K</kbd>}
          </form>
          <div className="header-actions">
            {session
              ? <button className="header-action" type="button" onClick={signOut} title="Cerrar sesión" aria-label={`Cerrar sesión de ${firstName}`}><CircleUserRound size={20} /><span>{firstName}</span><LogOut size={14} className="header-action__extra" /></button>
              : <button className="header-action" type="button" onClick={() => startAuth('login')}><CircleUserRound size={20} /><span>Ingresar</span></button>}
            <button className="header-action header-action--cart" type="button" onClick={() => setCartOpen(true)} aria-label={`Abrir carrito, ${cartCount} artículos`}>
              <ShoppingBag size={20} /><span>Carrito</span>{cartCount > 0 && <b key={cartCount}>{cartCount}</b>}
            </button>
            <button className="icon-button menu-toggle" onClick={() => setMobileMenu(v => !v)} aria-expanded={mobileMenu} aria-controls="main-nav" aria-label={mobileMenu ? 'Cerrar menú' : 'Abrir menú'} type="button">{mobileMenu ? <X size={20} /> : <Menu size={20} />}</button>
          </div>
        </div>
      </header>

      <main>
        {returnedOrder && (
          <div className={`order-return wrap order-return--${returnedOrderStatus?.payment_status || 'pending'}`} role="status">
            <span className="order-return__icon">{returnedOrderStatus?.payment_status === 'paid' ? <Check size={18} /> : <RefreshCw size={17} className={returnedOrderStatus?.payment_status === 'failed' ? '' : 'spin'} />}</span>
            <div>
              <strong>{returnedOrderStatus?.payment_status === 'paid' ? 'Pago verificado' : returnedOrderStatus?.payment_status === 'failed' ? 'Pago no confirmado' : 'Estamos verificando tu pago'}</strong>
              <span>Pedido {returnedOrder} · {returnedOrderStatus?.error || (returnedOrderStatus?.payment_status === 'paid' ? 'Recibimos la confirmación segura de Mercado Pago.' : 'Volver a esta página no confirma el pago; esperamos la validación de Mercado Pago.')}</span>
            </div>
            <button type="button" className="icon-button icon-button--quiet" onClick={() => { setReturnedOrder(null); const url = new URL(window.location.href); url.searchParams.delete('pedido'); window.history.replaceState({}, '', url); }} aria-label="Cerrar aviso"><X size={17} /></button>
          </div>
        )}

        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero__copy">
            <p className="kicker">Tienda online de CR</p>
            <h1 id="hero-title">Perfumería y limpieza para retirar <em>cerca de casa</em></h1>
            <p className="hero__lead">Armá el pedido acá, pagalo con Mercado Pago y retiralo en el punto que te quede mejor.</p>
            <div className="hero__actions">
              <button className="button button--gold button--large" type="button" onClick={() => scrollCatalog()}>Ver productos <ArrowRight size={18} /></button>
              <button className="button button--outline button--large" type="button" onClick={() => document.getElementById('retiro')?.scrollIntoView({ behavior: 'smooth' })}>Ver puntos de retiro</button>
            </div>
            <dl className="hero__facts">
              <div><dt>{productTotal || '—'}</dt><dd>productos en el catálogo</dd></div>
              <div><dt>{pickUpPoints.length}</dt><dd>puntos de retiro</dd></div>
              <div><dt><Wallet size={22} aria-label="Mercado Pago" /></dt><dd>pago con Mercado Pago</dd></div>
            </dl>
          </div>
          <Showcase products={showcase} onOpen={setDetailProduct} />
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
            <p>No hay envío a domicilio: elegís uno de los cinco puntos al pagar y lo pasás a buscar.</p>
          </div>
          <ol className="how">
            <li><span>1</span><div><strong>Elegí los productos</strong><p>Buscá por nombre, marca o categoría y sumalos al carrito.</p></div></li>
            <li><span>2</span><div><strong>Pagá con Mercado Pago</strong><p>Ingresás con tu cuenta y pagás con el saldo de Mercado Pago.</p></div></li>
            <li><span>3</span><div><strong>Retirá el pedido</strong><p>Lo buscás en el punto que elegiste con el número de pedido.</p></div></li>
          </ol>
          <ul className="points">
            {pickUpPoints.map(point => <li key={point}><MapPin size={18} /><span>{point}</span></li>)}
          </ul>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap site-footer__row">
          <Brand onClick={toTop} />
          <p>Perfumería y limpieza con retiro en {pickUpPoints.length} puntos.</p>
          <button className="text-link site-footer__admin" type="button" onClick={() => setOrderMonitorOpen(true)}><Store size={15} /> Pedidos del local</button>
          <span>© {new Date().getFullYear()} CR Perfumería & Limpieza</span>
        </div>
      </footer>

      {cartCount > 0 && !cartOpen && !checkoutOpen && (
        <aside className="floating-cart" aria-label="Resumen del carrito">
          <span className="floating-cart__count"><ShoppingBag size={17} /> {cartCount}</span>
          <strong>{money(cartTotal)}</strong>
          <button className="button button--gold" type="button" onClick={() => setCartOpen(true)}>Ver carrito <ArrowRight size={16} /></button>
        </aside>
      )}

      {toast && <div className="toast" role="status"><span><Check size={16} /></span>{toast}</div>}
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
      {checkoutOpen && <CheckoutDialog items={cartItems.filter(item => !item.unavailable)} total={cartTotal} session={session} onClose={() => setCheckoutOpen(false)} onBack={() => { setCheckoutOpen(false); setCartOpen(true); }} onOrdered={() => { setCart([]); setCheckoutOpen(false); }} onLogin={() => { setCheckoutOpen(false); startAuth('login'); }} />}
      {authOpen && <AuthDialog mode={authMode} onMode={setAuthMode} onClose={() => setAuthOpen(false)} onSignedIn={setSession} />}
      {detailProduct && <ProductDialog product={detailProduct} inCart={qtyInCart[detailProduct.id] || 0} onClose={() => setDetailProduct(null)} onAdd={addToCart} />}
      {orderMonitorOpen && <OrderMonitor connectionResult={mpConnectResult} onClose={() => setOrderMonitorOpen(false)} />}
    </div>
  );
}
