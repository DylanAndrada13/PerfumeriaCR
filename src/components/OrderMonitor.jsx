import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bell, LockKeyhole, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { money } from '../lib/format.js';
import Modal from './Modal.jsx';

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

const statusLabel = status => (status === 'paid' ? 'Pagado' : status === 'failed' ? 'Pago rechazado' : 'Pago pendiente');
const ORDER_LABEL = {
  pending_review: 'Nuevo, sin aceptar', awaiting_payment: 'Esperando pago', confirmed: 'Pagado, a preparar',
  preparing: 'En preparación', ready_for_pickup: 'Listo para retirar', delivered: 'Entregado', cancelled: 'Cancelado',
};
const FILTERS = [['active', 'En curso'], ['pending_review', 'Nuevos'], ['done', 'Cerrados'], ['all', 'Todos']];
const isActive = order => !['delivered', 'cancelled'].includes(order.order_status) && !(order.order_status === 'awaiting_payment' && order.payment_method === 'mercado_pago');

function actionsFor(order) {
  const cash = order.payment_method === 'efectivo';
  switch (order.order_status) {
    case 'pending_review': return [['accept', 'Aceptar'], ['reject', 'Rechazar']];
    case 'confirmed': return [['ready', 'Listo para retirar'], ['deliver', 'Entregado']];
    case 'preparing': return [['ready', 'Listo para retirar'], ['deliver', cash ? 'Cobrado y entregado' : 'Entregado'], ...(cash ? [['reject', 'Cancelar']] : [])];
    case 'ready_for_pickup': return [['deliver', cash ? 'Cobrado y entregado' : 'Entregado'], ...(cash ? [['reject', 'Cancelar']] : [])];
    default: return [];
  }
}

export default function OrderMonitor({ onClose, connectionResult }) {
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sellerConnection, setSellerConnection] = useState(null);
  const [connectionError, setConnectionError] = useState('');
  const [filter, setFilter] = useState('active');
  const [working, setWorking] = useState('');
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
  const refresh = async () => {
    setBusy(true);
    try { await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  useEffect(() => { load().catch(() => {}); }, []);
  // While the panel is open and signed in, new orders show up every minute without pressing Actualizar.
  useEffect(() => {
    if (!loggedIn) return undefined;
    const timer = window.setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 60000);
    return () => window.clearInterval(timer);
  }, [loggedIn]);
  const act = async (order, action) => {
    if (action === 'reject' && !window.confirm(`¿Cancelar el pedido ${order.order_number}? El stock reservado vuelve al inventario.`)) return;
    setWorking(`${order.id}:${action}`); setError('');
    try {
      const response = await fetch('/api/admin/order-action', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id, action }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo actualizar el pedido.');
      await load();
    } catch (err) { setError(err.message); }
    finally { setWorking(''); }
  };
  const newCount = orders.filter(order => order.order_status === 'pending_review').length;
  const visible = useMemo(() => orders.filter(order => (
    filter === 'all' ? true
      : filter === 'pending_review' ? order.order_status === 'pending_review'
        : filter === 'done' ? !isActive(order)
          : isActive(order)
  )), [orders, filter]);

  const env = sellerConnection?.environment;
  return (
    <Modal onClose={onClose} labelledBy="admin-title" className="sheet admin">
      <button className="icon-button modal__close" type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
      <span className="sheet__mark"><ShieldCheck size={22} /></span>
      <h2 id="admin-title" className="sheet__title">Pedidos del local</h2>
      {!loggedIn ? (
        <form onSubmit={login} className="form">
          <p className="sheet__intro">Ingresá la clave de administración configurada en el servidor.</p>
          <label className="field">Clave<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
          <button className="button button--gold button--wide" disabled={busy}>{busy ? 'Ingresando…' : 'Ver pedidos'}</button>
        </form>
      ) : (
        <>
          <section className="mp-connection">
            <div>
              <strong>Cuenta vendedora de Mercado Pago</strong>
              <span>{sellerConnection?.connected ? `Conectada: ${sellerConnection.seller.nickname || `cuenta ${sellerConnection.seller.id}`}` : 'Todavía no hay una cuenta conectada.'}</span>
              <span className={`badge ${env === 'test' ? '' : 'badge--warn'}`}>{env === 'test' ? 'Entorno: PRUEBA' : env === 'production' ? 'Entorno: PRODUCCIÓN' : 'Entorno: sin configurar'}</span>
              {env === 'test' && sellerConnection.configuredTestSellerId && <span>Vendedor de prueba esperado: {sellerConnection.configuredTestSellerId}</span>}
            </div>
            <a className="button button--outline" href="/api/admin/mp/connect">{sellerConnection?.connected ? 'Cambiar cuenta' : 'Conectar cuenta'}</a>
          </section>
          {connectionResult && <p className={`alert ${connectionResult === 'success' ? 'alert--ok' : 'alert--error'}`} role="status">{mpConnectMessages[connectionResult] || mpConnectMessages.failed}</p>}
          {env === 'test' && !sellerConnection.testSellerConfigured && <p className="alert alert--error" role="alert"><AlertCircle size={16} />Falta MERCADOPAGO_TEST_USER_ID en Vercel; no se aceptan pagos de prueba hasta configurarlo.</p>}
          {sellerConnection?.sellerMatchesTestUser === false && <p className="alert alert--error" role="alert"><AlertCircle size={16} />La cuenta conectada no coincide con la cuenta vendedora de prueba configurada.</p>}
          {sellerConnection?.sellerIsTestAccount && <p className="alert alert--error" role="alert"><AlertCircle size={16} />La cuenta conectada es de prueba. En producción no se habilitarán cobros hasta conectar una cuenta real.</p>}
          {connectionError && <p className="alert alert--error" role="alert"><AlertCircle size={16} />{connectionError}</p>}
          <p className="note">Mercado Pago descuenta el stock cuando el webhook confirma el pago. Efectivo lo reserva al enviar el pedido y lo devuelve si lo cancelás.</p>
          {newCount > 0 && <p className="alert admin__new" role="status"><Bell size={16} />Tenés {newCount} {newCount === 1 ? 'pedido nuevo' : 'pedidos nuevos'} en efectivo para aceptar o rechazar.</p>}
          <div className="admin__filters" role="tablist" aria-label="Filtrar pedidos">
            {FILTERS.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={`chip ${filter === value ? 'is-selected' : ''}`} onClick={() => setFilter(value)}>{label}{value === 'pending_review' && newCount > 0 ? ` (${newCount})` : ''}</button>)}
          </div>
          <div className="admin__toolbar">
            <span>{visible.length} de {orders.length} pedidos</span>
            <button className="button button--ghost button--small" type="button" onClick={refresh} disabled={busy}><RefreshCw size={15} /> Actualizar</button>
          </div>
          <div className="admin__orders">
            {visible.length === 0 ? <p className="note">No hay pedidos en esta vista.</p> : visible.map(order => (
              <article className={`admin-order ${order.order_status === 'pending_review' ? 'admin-order--new' : ''}`} key={order.id}>
                <header><strong>{order.order_number}</strong><span className={`status-pill status-pill--${order.order_status}`}>{ORDER_LABEL[order.order_status] || order.order_status}</span></header>
                <p>{order.customer_name} · {order.customer_email}{order.customer_phone ? ` · ${order.customer_phone}` : ""}</p>
                {order.customer_note && <p className="note">Nota: {order.customer_note}</p>}
                <p>{new Date(order.created_at).toLocaleString('es-AR')} · Retiro: {order.pickup_point}{order.pickup_dates?.length ? ` · Fechas: ${order.pickup_dates.join(', ')}` : ''}</p>
                <ul>{(order.web_order_items || []).map((item, i) => <li key={`${item.product_name}-${i}`}>{item.quantity} × {item.product_name}</li>)}</ul>
                {order.stock_shortage?.length > 0 && <p className="alert alert--error"><AlertCircle size={16} />Faltó stock al descontar: revisá {order.stock_shortage.length === 1 ? 'un producto' : `${order.stock_shortage.length} productos`} antes de prepararlo.</p>}
                <footer><span>{order.payment_method === 'mercado_pago' ? 'Mercado Pago' : 'Efectivo al retirar'} · {statusLabel(order.payment_status)}</span><strong>{money(order.total_amount)}</strong></footer>
                {actionsFor(order).length > 0 && (
                  <div className="admin-order__actions">
                    {actionsFor(order).map(([action, label]) => (
                      <button key={action} type="button" className={`button button--small ${action === 'reject' ? 'button--ghost' : action === 'accept' || action === 'deliver' ? 'button--gold' : 'button--outline'}`} disabled={Boolean(working)} onClick={() => act(order, action)}>
                        {working === `${order.id}:${action}` ? 'Guardando…' : label}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {error && <p className="alert alert--error" role="alert"><AlertCircle size={16} />{error}</p>}
      <p className="sheet__secure"><LockKeyhole size={14} /> Un pedido figura pagado solo después de verificarlo con Mercado Pago.</p>
    </Modal>
  );
}
