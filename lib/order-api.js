import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { getPublicCatalog } from './server-catalog.js';
import { getActiveSellerToken, getSellerToken } from './mercadopago-oauth.js';

const pickupPoints = new Set(['Coto Lanús', 'Ciclón Caraza', 'UPA Recondo', 'Maxi Carrefour', 'Santa Marta']);
const money = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const json = (res, status, body) => res.status(status).json(body);
const config = () => ({
  url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  key: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  anon: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
});

async function db(path, { method = 'GET', body, prefer } = {}) {
  const { url, key } = config();
  if (!url || !key) throw new Error('El backend no tiene conexión de Supabase configurada.');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase rechazó la operación (${response.status}). ${text.slice(0, 350)}`);
  return text ? JSON.parse(text) : null;
}

async function verifyUser(token) {
  const { url, anon } = config();
  if (!url || !anon) throw new Error('Falta configurar la clave pública de Supabase Auth en el servidor.');
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  return response.json();
}

function bearer(req) { return (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]; }
function safeEqual(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
function adminCookie(value) {
  const [payload, signature] = String(value || '').split('.');
  const secret = process.env.SHOP_ADMIN_PASSWORD || '';
  if (!secret || !payload || !signature) return false;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
function isAdmin(req) {
  const cookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('cr_shop_admin='))?.slice('cr_shop_admin='.length);
  return adminCookie(cookie);
}

export async function createOrder(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método no permitido.' }); }
  try {
    const token = bearer(req); if (!token) return json(res, 401, { error: 'Iniciá sesión para continuar.' });
    const user = await verifyUser(token); if (!user?.id || !user.email) return json(res, 401, { error: 'La sesión venció. Volvé a iniciar sesión.' });
    const seller = await getActiveSellerToken();
    if (!seller) return json(res, 503, { error: 'Primero conectá una cuenta vendedora de Mercado Pago desde Pedidos del local. No guardamos el pedido ni se realizó ningún cobro.' });
    if (process.env.MERCADOPAGO_ENV === 'test' && String(seller.sellerId) !== String(process.env.MERCADOPAGO_TEST_USER_ID || '')) return json(res, 503, { error: 'La cuenta conectada no es la cuenta vendedora de prueba configurada. No guardamos el pedido ni se realizó ningún cobro.' });
    if (!process.env.MERCADOPAGO_WEBHOOK_SECRET) return json(res, 503, { error: 'Falta configurar la firma del webhook. No guardamos el pedido ni se realizó ningún cobro.' });
    const baseUrl = process.env.PUBLIC_APP_URL || '';
    if (!/^https:\/\//.test(baseUrl)) return json(res, 503, { error: 'Falta configurar la URL HTTPS de prueba. No guardamos el pedido ni se realizó ningún cobro.' });
    const { pickupPoint, items } = req.body || {};
    const checkoutKey = String(req.body?.checkoutKey || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutKey)) return json(res, 400, { error: 'La sesión de compra no es válida. Volvé a intentar.' });
    if (!pickupPoints.has(pickupPoint) || !Array.isArray(items) || items.length < 1 || items.length > 60) return json(res, 400, { error: 'Revisá el carrito y el punto de retiro.' });
    const existing = await db(`web_orders?checkout_key=eq.${encodeURIComponent(checkoutKey)}&user_id=eq.${encodeURIComponent(user.id)}&select=order_number,mp_checkout_url&limit=1`);
    if (existing?.[0]) {
      if (existing[0].mp_checkout_url) return json(res, 200, { orderNumber: existing[0].order_number, checkoutUrl: existing[0].mp_checkout_url });
      return json(res, 409, { error: 'Este intento ya está en proceso. Esperá un momento antes de volver a intentar.' });
    }

    const catalog = await getPublicCatalog({ includeInventory: true });
    const productMap = new Map(catalog.map(p => [String(p.id), p]));
    const lines = [];
    for (const raw of items) {
      const product = productMap.get(String(raw.id));
      const quantity = Number(raw.quantity);
      if (!product || !product.inStock || !(product.price > 0) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99 || quantity > product.stock) return json(res, 409, { error: 'Un producto cambió o la cantidad ya no está disponible. Actualizá el carrito.' });
      lines.push({ product, quantity, unitPrice: money(product.price) });
    }
    const total = money(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
    if (!(total > 0) || total > 100000000) return json(res, 400, { error: 'El total del carrito no es válido.' });

    const orderId = randomUUID();
    const orderNumber = `CR-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const order = {
      id: orderId, order_number: orderNumber, checkout_key: checkoutKey, user_id: user.id,
      customer_name: String(user.user_metadata?.full_name || user.user_metadata?.name || user.email).slice(0, 160),
      customer_email: user.email, pickup_point: pickupPoint, payment_method: 'mercado_pago',
      payment_status: 'pending', order_status: 'awaiting_payment', currency: 'ARS', total_amount: total,
    };
    const snapshots = lines.map(({ product, quantity, unitPrice }) => ({
      order_id: orderId, product_barcode: String(product.id), product_name: product.name,
      image_url: product.image || null, quantity, unit_price: unitPrice,
    }));
    try {
      await db('rpc/create_web_order', { method: 'POST', body: { p_order: order, p_items: snapshots } });
    } catch (error) {
      const retry = await db(`web_orders?checkout_key=eq.${encodeURIComponent(checkoutKey)}&user_id=eq.${encodeURIComponent(user.id)}&select=order_number,mp_checkout_url&limit=1`).catch(() => []);
      if (retry?.[0]?.mp_checkout_url) return json(res, 200, { orderNumber: retry[0].order_number, checkoutUrl: retry[0].mp_checkout_url });
      throw error;
    }

    const returnUrl = `${baseUrl}/?pedido=${encodeURIComponent(orderNumber)}`;
    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${seller.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        external_reference: orderId,
        ...(process.env.MERCADOPAGO_ENV === 'test' ? {} : { payer: { email: user.email } }),
        notification_url: `${baseUrl}/api/orders/webhook`,
        back_urls: { success: returnUrl, failure: returnUrl, pending: returnUrl },
        auto_return: 'approved',
        items: lines.map(({ product, quantity, unitPrice }) => ({ id: String(product.id), title: product.name.slice(0, 200), quantity, currency_id: 'ARS', unit_price: unitPrice })),
      }), signal: AbortSignal.timeout(20000),
    });
    const mp = await mpResponse.json();
    const checkoutUrl = process.env.MERCADOPAGO_ENV === 'test' ? (mp.sandbox_init_point || mp.init_point) : mp.init_point;
    if (!mpResponse.ok || !mp.id || !checkoutUrl) {
      console.error('Mercado Pago create order rejected', mpResponse.status, JSON.stringify(mp).slice(0, 600));
      return json(res, 502, { error: 'El pedido quedó guardado, pero no se pudo iniciar el pago. Contactá al local con el número de pedido.', orderNumber });
    }
    await db(`web_orders?id=eq.${encodeURIComponent(orderId)}`, { method: 'PATCH', body: { mp_preference_id: String(mp.id), mp_seller_id: String(seller.sellerId), mp_checkout_url: checkoutUrl } });
    return json(res, 201, { orderNumber, checkoutUrl });
  } catch (error) {
    console.error('Order creation failed:', error.message);
    return json(res, 500, { error: error.message.includes('web_orders') || error.message.includes('web_order_items')
      ? 'Falta preparar las tablas de pedidos. No se realizó ningún cobro.'
      : 'No pudimos iniciar la compra. Verificá tu conexión e intentá nuevamente.' });
  }
}

export async function mercadoPagoWebhook(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método no permitido.' }); }
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET || '';
  const signature = req.headers['x-signature'] || '';
  const requestId = req.headers['x-request-id'] || '';
  const dataId = String(req.query?.['data.id'] || req.body?.data?.id || '').toLowerCase();
  const parts = Object.fromEntries(signature.split(',').map(pair => pair.trim().split('=')));
  const timestamp = Number(parts.ts);
  const timestampMs = timestamp > 1e12 ? timestamp : timestamp * 1000;
  if (!secret || !Number.isFinite(timestampMs) || !parts.v1 || !requestId || !dataId || Math.abs(Date.now() - timestampMs) > 300000) return json(res, 401, { error: 'Notificación no válida.' });
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  if (!safeEqual(parts.v1, expected)) return json(res, 401, { error: 'Notificación no válida.' });
  try {
    const notificationUserId = String(req.body?.user_id || '');
    if (!notificationUserId) return json(res, 400, { error: 'La notificación no informa la cuenta vendedora.' });
    const seller = await getSellerToken(notificationUserId);
    if (!seller) return json(res, 200, { received: true });
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, { headers: { Authorization: `Bearer ${seller.accessToken}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return json(res, 502, { error: 'No se pudo verificar la orden con Mercado Pago.' });
    const payment = await response.json();
    const externalId = String(payment.external_reference || '');
    const [order] = await db(`web_orders?id=eq.${encodeURIComponent(externalId)}&select=id,total_amount,currency,mp_preference_id,mp_seller_id,payment_status`);
    if (!order || String(order.mp_seller_id) !== String(payment.collector_id) || String(order.mp_seller_id) !== notificationUserId || Number(order.total_amount) !== Number(payment.transaction_amount) || order.currency !== payment.currency_id || String(order.mp_preference_id) !== String(payment.preference_id)) return json(res, 200, { received: true });
    const paid = payment.status === 'approved';
    const failed = ['rejected', 'cancelled', 'refunded', 'charged_back'].includes(payment.status);
    await db(`web_orders?id=eq.${encodeURIComponent(order.id)}&payment_status=neq.paid`, {
      method: 'PATCH', body: paid
        ? { payment_status: 'paid', order_status: 'confirmed', mp_payment_id: String(payment.id), paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        : failed ? { payment_status: 'failed', mp_payment_id: String(payment.id), updated_at: new Date().toISOString() } : { mp_payment_id: String(payment.id), updated_at: new Date().toISOString() },
    });
    return json(res, 200, { received: true });
  } catch (error) { console.error('Mercado Pago webhook processing failed:', error.message); return json(res, 500, { error: 'No se pudo procesar la notificación.' }); }
}

export async function orderStatus(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Método no permitido.' }); }
  try {
    const token = bearer(req); if (!token) return json(res, 401, { error: 'Iniciá sesión para consultar tu pedido.' });
    const user = await verifyUser(token); if (!user?.id) return json(res, 401, { error: 'La sesión venció. Volvé a iniciar sesión.' });
    const number = String(req.query?.orderNumber || '').slice(0, 80);
    if (!number) return json(res, 400, { error: 'Falta el número de pedido.' });
    const [order] = await db(`web_orders?order_number=eq.${encodeURIComponent(number)}&user_id=eq.${encodeURIComponent(user.id)}&select=order_number,payment_status,order_status,total_amount,created_at,paid_at`);
    if (!order) return json(res, 404, { error: 'No encontramos ese pedido en tu cuenta.' });
    return json(res, 200, { order });
  } catch (error) { console.error('Order status lookup failed:', error.message); return json(res, 503, { error: 'No se pudo consultar el pedido.' }); }
}

export async function adminLogin(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método no permitido.' }); }
  const password = process.env.SHOP_ADMIN_PASSWORD || '';
  if (!password || !safeEqual(req.body?.password || '', password)) return json(res, 401, { error: 'Clave incorrecta o panel no configurado.' });
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  const signature = createHmac('sha256', password).update(payload).digest('base64url');
  res.setHeader('Set-Cookie', `cr_shop_admin=${payload}.${signature}; HttpOnly; SameSite=Lax; Path=/api/admin; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return json(res, 200, { ok: true });
}

export async function adminOrders(req, res) {
  if (!isAdmin(req)) return json(res, 401, { error: 'Iniciá sesión en el panel de pedidos.' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Método no permitido.' }); }
  try {
    const orders = await db('web_orders?select=id,order_number,customer_name,customer_email,pickup_point,payment_method,payment_status,order_status,total_amount,created_at,paid_at,web_order_items(product_name,quantity,unit_price,line_total)&order=created_at.desc&limit=100');
    return json(res, 200, { orders });
  } catch (error) { console.error('Admin order list failed:', error.message); return json(res, 503, { error: 'No se pudieron cargar los pedidos. Revisá que la migración revisada esté aplicada.' }); }
}
