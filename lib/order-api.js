import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { getProductsByIds } from './server-catalog.js';
import { getActiveSellerToken, getSellerToken } from './mercadopago-oauth.js';
import { sendOrderStatusPush } from './push.js';

const localPickups = new Set(['Local Itatí', 'Local La Haya']);
const meetingPoints = new Set(['Coto Lanús', 'Ciclón Caraza', 'UPA Recondo', 'Maxi Carrefour']);
const PICKUP_DATE_DAYS = 60;
const PICKUP_WEEKDAY = 4; // meeting-point deliveries happen on Thursdays
// Holiday weeks: the delivery moves to the Wednesday before (same table as src/lib/format.js).
const PICKUP_DATE_SWAPS = { '2026-12-24': '2026-12-23', '2026-12-31': '2026-12-30' };
const SWAPPED_IN = new Set(Object.values(PICKUP_DATE_SWAPS));
const money = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const json = (res, status, body) => res.status(status).json(body);
const config = () => ({
  url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  key: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  anon: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
});

// Online payment (Mercado Pago) surcharge, in percent. The server always computes it; the browser only shows it.
const surchargePercent = () => {
  const value = Number(process.env.ONLINE_SURCHARGE_PERCENT ?? 8);
  return Number.isFinite(value) && value >= 0 && value <= 30 ? value : 8;
};
// Account that receives bank transfers. Set in the server environment so it can change without a deploy of code.
export const transferAccount = () => {
  const alias = String(process.env.TRANSFER_ALIAS || '').trim();
  const cvu = String(process.env.TRANSFER_CVU || '').replace(/\s+/g, '');
  const holder = String(process.env.TRANSFER_HOLDER || '').trim();
  return { enabled: Boolean(alias && /^\d{22}$/.test(cvu) && holder), alias, cvu, holder, bank: String(process.env.TRANSFER_BANK || 'Mercado Pago').trim() };
};

export async function paymentOptions(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Método no permitido.' }); }
  const { enabled } = transferAccount();
  res.setHeader('Cache-Control', 'public, max-age=60');
  return json(res, 200, { surchargePercent: surchargePercent(), transferEnabled: enabled });
}

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

// Read-only key for one order: lets the page Mercado Pago returns to show that order's status even
// when it opens without the shopper's session (another browser, or an installed app on iPhone).
function returnToken(orderNumber) {
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createHmac('sha256', secret).update(`order-return:${orderNumber}`).digest('base64url').slice(0, 32);
}
function validReturnToken(orderNumber, token) {
  return Boolean(orderNumber && token) && safeEqual(String(token), returnToken(orderNumber));
}
// Mercado Pago sends the shopper back to the same address the shop was opened from (the installed app's
// origin), not to a different domain where the shopper has no session. Only this deployment's own host qualifies.
function shopOrigin(req, fallback) {
  const origin = String(req.headers.origin || '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return /^https:\/\/[a-z0-9.-]+$/i.test(origin) && host && origin === `https://${host}` ? origin : fallback;
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

function paymentMatchesOrder(payment, order, sellerId) {
  return String(payment.external_reference || '') === String(order.id)
    && String(payment.collector_id || '') === String(sellerId)
    && String(order.mp_seller_id || '') === String(sellerId)
    && Number(payment.transaction_amount) === Number(order.total_amount)
    && String(payment.currency_id || '') === String(order.currency)
    // Mercado Pago may omit preference_id from a payment response. The unique
    // external_reference plus seller, amount, and currency still bind it to the order.
    && (!payment.preference_id || String(order.mp_preference_id || '') === String(payment.preference_id));
}

// Discounts the order's stock once Mercado Pago approves it. The database function is idempotent
// (guarded by stock_applied_at), so a repeated webhook or a reconciliation never discounts twice.
async function applyPaidOrderStock(orderId) {
  await db('rpc/apply_web_order_stock', { method: 'POST', body: { p_order_id: orderId, p_strict: false } });
}

// Argentina has no daylight saving: UTC-3 all year.
const argentinaToday = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (isoDate, days) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Pickup: at one of the shops, or at a meeting point with exactly 3 possible dates.
function pickupChoice(body) {
  const type = body?.pickupType === 'local' ? 'local' : 'encuentro';
  const point = String(body?.pickupPoint || '');
  if (type === 'local') {
    if (!localPickups.has(point)) return { error: 'Elegí en qué local retirás el pedido.' };
    return { type, point, dates: null };
  }
  if (!meetingPoints.has(point)) return { error: 'Elegí un punto de encuentro.' };
  const today = argentinaToday();
  const first = addDays(today, 1);
  const last = addDays(today, PICKUP_DATE_DAYS);
  const dates = [...new Set((Array.isArray(body?.pickupDates) ? body.pickupDates : []).map(String))].sort();
  const isThursday = date => SWAPPED_IN.has(date) || (!PICKUP_DATE_SWAPS[date] && new Date(`${date}T12:00:00Z`).getUTCDay() === PICKUP_WEEKDAY);
  if (dates.length !== 1 || dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < first || date > last || !isThursday(date))) {
    return { error: 'Elegí una fecha de entrega de las que te ofrece la tienda: las entregas en los puntos de encuentro son los jueves.' };
  }
  return { type, point, dates };
}

// Buyer contact sent from the checkout. The name falls back to the account name.
function buyerContact(body, user) {
  const accountName = String(user.user_metadata?.full_name || user.user_metadata?.name || user.email);
  const name = String(body?.customerName || '').replace(/\s+/g, ' ').trim().slice(0, 160) || accountName.slice(0, 160);
  const rawPhone = String(body?.customerPhone || '').trim().slice(0, 40);
  const digits = rawPhone.replace(/\D/g, '');
  const note = String(body?.customerNote || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (name.length < 2) return { error: 'Escribí tu nombre y apellido.', field: 'name' };
  if (digits.length < 8 || digits.length > 15 || /[^\d\s()+-]/.test(rawPhone)) return { error: 'Escribí un teléfono válido, por ejemplo 11 2345 6789.', field: 'phone' };
  const dni = String(body?.customerDni || '').replace(/[.\s]/g, '');
  if (dni && !/^\d{6,9}$/.test(dni)) return { error: 'Escribí el DNI solo con números, por ejemplo 30123456.', field: 'dni' };
  return { name, phone: rawPhone.replace(/\s+/g, ' '), note, dni };
}

// Phone and note live in columns added by 202611220003_web_orders_customer_contact.sql.
// If that migration is missing, the order still goes through and the gap is logged.
// Pickup type and dates live in columns added by 202611220004_web_orders_pickup_options.sql.
async function saveOrderDetails(orderId, contact, pickup) {
  const target = `web_orders?id=eq.${encodeURIComponent(orderId)}`;
  try {
    await db(target, { method: 'PATCH', body: { customer_phone: contact.phone, customer_note: contact.note || null } });
  } catch (error) { console.error('Buyer contact not saved (run the customer contact migration):', error.message); }
  try {
    await db(target, { method: 'PATCH', body: { pickup_type: pickup.type, pickup_dates: pickup.dates } });
  } catch (error) { console.error('Pickup details not saved (run the pickup options migration):', error.message); }
}
// The database rejects 'Local Itatí' / 'Local La Haya' until the pickup options migration runs.
const pickupRuleMissing = error => dbErrorCode(error) === '23514' && /pickup_point/i.test(String(error?.message || ''));

const CASH_PENDING_LIMIT = 3;
// PostgREST error details travel inside the message thrown by db(); read its code to classify it.
const dbErrorCode = error => String(error?.message || '').match(/"code"\s*:\s*"([^"]+)"/)?.[1] || '';
// Only a function that does not exist yet means the cash migration is missing.
const missingMigration = error => ['PGRST202', '42883'].includes(dbErrorCode(error)) || /could not find the function/i.test(String(error?.message || ''));

const transferDetails = account => ({ alias: account.alias, cvu: account.cvu, holder: account.holder, bank: account.bank });

export async function createOrder(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método no permitido.' }); }
  if (!['efectivo', 'transferencia'].includes(req.body?.paymentMethod) && process.env.MERCADOPAGO_CHECKOUT_ENABLED !== 'true') {
    return json(res, 400, { error: 'El pago con Mercado Pago no está disponible. Elegí efectivo o transferencia.' });
  }
  try {
    const paymentMethod = ['efectivo', 'transferencia'].includes(req.body?.paymentMethod) ? req.body.paymentMethod : 'mercado_pago';
    const transfer = paymentMethod === 'transferencia';
    // Cash and transfer orders are checked by the local, so they never go through Mercado Pago checkout.
    const cash = paymentMethod === 'efectivo' || transfer;
    const account = transferAccount();
    if (transfer && !account.enabled) return json(res, 503, { error: 'El pago por transferencia todavía no está habilitado. Elegí otro medio de pago.' });
    const mpEnvironment = process.env.MERCADOPAGO_ENV || '';
    if (!cash && !['test', 'production'].includes(mpEnvironment)) return json(res, 503, { error: 'MERCADOPAGO_ENV debe estar configurado como test o production.' });
    const token = bearer(req); if (!token) return json(res, 401, { error: 'Iniciá sesión para continuar.' });
    const user = await verifyUser(token); if (!user?.id || !user.email) return json(res, 401, { error: 'La sesión venció. Volvé a iniciar sesión.' });

    let seller = null;
    const baseUrl = process.env.PUBLIC_APP_URL || '';
    if (!cash) {
      seller = await getActiveSellerToken();
      if (!seller) return json(res, 503, { error: 'Primero conectá una cuenta vendedora de Mercado Pago desde Pedidos del local. No guardamos el pedido ni se realizó ningún cobro.' });
      const testSellerId = process.env.MERCADOPAGO_TEST_USER_ID || '';
      if (mpEnvironment === 'test' && String(seller.sellerId) !== String(testSellerId)) return json(res, 503, { error: 'La cuenta conectada no es la cuenta vendedora de prueba configurada. No guardamos el pedido ni se realizó ningún cobro.' });
      if (mpEnvironment === 'production' && (!testSellerId || String(seller.sellerId) === String(testSellerId))) return json(res, 503, { error: 'Producción requiere una cuenta vendedora real conectada. Volvé a autorizarla desde Pedidos del local; no se inició ningún cobro.' });
      if (!process.env.MERCADOPAGO_WEBHOOK_SECRET) return json(res, 503, { error: 'Falta configurar la firma del webhook. No guardamos el pedido ni se realizó ningún cobro.' });
      if (!/^https:\/\//.test(baseUrl)) return json(res, 503, { error: 'Falta configurar la URL HTTPS pública. No guardamos el pedido ni se realizó ningún cobro.' });
    }

    const { items } = req.body || {};
    const contact = buyerContact(req.body, user);
    if (contact.error) return json(res, 400, { error: contact.error, field: contact.field });
    if (transfer && !contact.dni) return json(res, 400, { error: 'Escribí tu DNI: lo usamos para reconocer tu transferencia.', field: 'dni' });
    const checkoutKey = String(req.body?.checkoutKey || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutKey)) return json(res, 400, { error: 'La sesión de compra no es válida. Volvé a intentar.' });
    const pickup = pickupChoice(req.body);
    if (pickup.error) return json(res, 400, { error: pickup.error, field: 'pickup' });
    if (!Array.isArray(items) || items.length < 1 || items.length > 60) return json(res, 400, { error: 'Revisá el carrito y el punto de retiro.' });
    const existing = await db(`web_orders?checkout_key=eq.${encodeURIComponent(checkoutKey)}&user_id=eq.${encodeURIComponent(user.id)}&select=order_number,mp_checkout_url,payment_method,total_amount,pickup_point&limit=1`);
    if (existing?.[0]) {
      if (existing[0].payment_method === 'efectivo') return json(res, 200, { orderNumber: existing[0].order_number, paymentMethod: 'efectivo', total: Number(existing[0].total_amount), pickupPoint: existing[0].pickup_point });
      if (existing[0].payment_method === 'transferencia') return json(res, 200, { orderNumber: existing[0].order_number, paymentMethod: 'transferencia', total: Number(existing[0].total_amount), pickupPoint: existing[0].pickup_point, transfer: transferDetails(account) });
      if (existing[0].mp_checkout_url) return json(res, 200, { orderNumber: existing[0].order_number, checkoutUrl: existing[0].mp_checkout_url, returnToken: returnToken(existing[0].order_number) });
      return json(res, 409, { error: 'Este intento ya está en proceso. Esperá un momento antes de volver a intentar.' });
    }
    if (cash) {
      const pending = await db(`web_orders?user_id=eq.${encodeURIComponent(user.id)}&payment_method=in.(efectivo,transferencia)&order_status=eq.pending_review&select=id&limit=${CASH_PENDING_LIMIT}`).catch(() => []);
      if ((pending || []).length >= CASH_PENDING_LIMIT) return json(res, 429, { error: `Ya tenés ${CASH_PENDING_LIMIT} pedidos esperando que el local los revise. Esperá a que los confirmen antes de hacer otro.` });
    }

    const catalog = await getProductsByIds(items.map(item => item?.id), { includeInventory: true });
    const productMap = new Map(catalog.map(p => [String(p.id), p]));
    const lines = [];
    const requested = new Map();
    for (const raw of items) {
      const product = productMap.get(String(raw?.id));
      const quantity = Number(raw?.quantity);
      if (!product || !product.inStock || !(product.price > 0) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return json(res, 409, { error: 'Un producto cambió o la cantidad ya no está disponible. Actualizá el carrito.' });
      requested.set(product.id, (requested.get(product.id) || 0) + quantity);
      if (requested.get(product.id) > product.stock) return json(res, 409, { error: product.stock === 1 ? `Solo queda 1 unidad de ${product.name}. Ajustá la cantidad en el carrito.` : `Solo quedan ${product.stock} unidades de ${product.name}. Ajustá la cantidad en el carrito.` });
      lines.push({ product, quantity, unitPrice: money(product.price) });
    }
    const subtotal = money(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
    // Only the online payment (Mercado Pago) carries the surcharge. Cash and transfer pay the list price.
    const rate = cash ? 0 : surchargePercent() / 100;
    const surcharge = money(subtotal * rate);
    const total = money(subtotal + surcharge);
    if (!(subtotal > 0) || total > 100000000) return json(res, 400, { error: 'El total del carrito no es válido.' });

    const orderId = randomUUID();
    const orderNumber = `CR-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const order = {
      id: orderId, order_number: orderNumber, checkout_key: checkoutKey, user_id: user.id,
      customer_name: contact.name,
      customer_email: user.email, pickup_point: pickup.point, payment_method: paymentMethod,
      payment_status: transfer ? 'pending_verification' : 'pending', order_status: cash ? 'pending_review' : 'awaiting_payment', currency: 'ARS', total_amount: total,
      ...(surcharge > 0 ? { surcharge_amount: surcharge, surcharge_rate: rate } : {}),
      ...(contact.dni ? { customer_dni: contact.dni } : {}),
    };
    const snapshots = lines.map(({ product, quantity, unitPrice }) => ({
      order_id: orderId, product_barcode: String(product.id), product_name: product.name,
      image_url: product.image || null, quantity, unit_price: unitPrice,
    }));

    if (cash) {
      // The order and its stock reservation are saved together; if any product ran out, nothing is saved.
      try {
        await db(transfer ? 'rpc/create_transfer_web_order' : 'rpc/create_cash_web_order', { method: 'POST', body: { p_order: order, p_items: snapshots } });
      } catch (error) {
        if (transfer && (missingMigration(error) || /customer_dni|surcharge/i.test(error.message))) { console.error('Transfer migration missing:', error.message); return json(res, 503, { error: 'El pago por transferencia todavía no está habilitado. Elegí otro medio de pago.' }); }
        if (/insufficient_stock/i.test(error.message)) return json(res, 409, { error: 'Mientras armabas el pedido se agotó uno de los productos. Actualizá el carrito y volvé a intentar.' });
        if (pickupRuleMissing(error)) return json(res, 503, { error: 'El retiro en el local todavía no está habilitado. Elegí un punto de encuentro.' });
        if (missingMigration(error)) { console.error('Cash order migration missing:', error.message); return json(res, 503, { error: 'El pago en efectivo todavía no está habilitado. Probá más tarde o escribinos por WhatsApp.' }); }
        const code = dbErrorCode(error);
        console.error('Cash order rejected by the database:', code, error.message);
        return json(res, 500, { error: `No pudimos guardar el pedido en efectivo (código ${code || 'desconocido'}). No se reservó stock; avisá al local.`, code });
      }
      await saveOrderDetails(orderId, contact, pickup);
      return json(res, 201, { orderNumber, paymentMethod, total, pickupPoint: pickup.point, pickupType: pickup.type, pickupDates: pickup.dates, ...(transfer ? { transfer: transferDetails(account) } : {}) });
    }

    try {
      await db('rpc/create_web_order', { method: 'POST', body: { p_order: order, p_items: snapshots } });
    } catch (error) {
      const retry = await db(`web_orders?checkout_key=eq.${encodeURIComponent(checkoutKey)}&user_id=eq.${encodeURIComponent(user.id)}&select=order_number,mp_checkout_url&limit=1`).catch(() => []);
      if (retry?.[0]?.mp_checkout_url) return json(res, 200, { orderNumber: retry[0].order_number, checkoutUrl: retry[0].mp_checkout_url });
      if (pickupRuleMissing(error)) return json(res, 503, { error: 'El retiro en el local todavía no está habilitado. Elegí un punto de encuentro. No se realizó ningún cobro.' });
      if (surcharge > 0 && /total does not match|surcharge/i.test(error.message)) { console.error('Surcharge migration missing:', error.message); return json(res, 503, { error: 'El pago online todavía no está habilitado. Elegí efectivo o transferencia. No se realizó ningún cobro.' }); }
      throw error;
    }
    await saveOrderDetails(orderId, contact, pickup);

    const returnUrl = `${shopOrigin(req, baseUrl)}/?pedido=${encodeURIComponent(orderNumber)}&t=${returnToken(orderNumber)}`;
    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${seller.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        external_reference: orderId,
        ...(mpEnvironment === 'test' ? {} : { payer: { email: user.email } }),
        purpose: 'wallet_purchase',
        notification_url: `${baseUrl}/api/orders/webhook`,
        back_urls: { success: returnUrl, failure: returnUrl, pending: returnUrl },
        auto_return: 'approved',
        items: [
          ...lines.map(({ product, quantity, unitPrice }) => ({ id: String(product.id), title: product.name.slice(0, 200), quantity, currency_id: 'ARS', unit_price: unitPrice })),
          ...(surcharge > 0 ? [{ id: 'recargo-pago-online', title: `Recargo por pago online (${surchargePercent()}%)`, quantity: 1, currency_id: 'ARS', unit_price: surcharge }] : []),
        ],
      }), signal: AbortSignal.timeout(20000),
    });
    const mp = await mpResponse.json();
    const checkoutUrl = mp.init_point;
    if (!mpResponse.ok || !mp.id || !checkoutUrl) {
      console.error('Mercado Pago create order rejected', mpResponse.status, JSON.stringify(mp).slice(0, 600));
      return json(res, 502, { error: 'El pedido quedó guardado, pero no se pudo iniciar el pago. Contactá al local con el número de pedido.', orderNumber });
    }
    await db(`web_orders?id=eq.${encodeURIComponent(orderId)}`, { method: 'PATCH', body: { mp_preference_id: String(mp.id), mp_seller_id: String(seller.sellerId), mp_checkout_url: checkoutUrl } });
    return json(res, 201, { orderNumber, checkoutUrl, returnToken: returnToken(orderNumber) });
  } catch (error) {
    console.error('Order creation failed:', error.message);
    return json(res, 500, { error: error.message.includes('web_orders') || error.message.includes('web_order_items')
      ? 'Falta preparar las tablas de pedidos. No se realizó ningún cobro.'
      : 'No pudimos iniciar la compra. Verificá tu conexión e intentá nuevamente.' });
  }
}

// Returns why a webhook signature cannot be verified, or '' when it is valid. Never logs secrets.
function webhookSignatureProblem({ secret, signature, requestId, dataId }) {
  if (!secret) return 'MERCADOPAGO_WEBHOOK_SECRET is not set';
  if (!signature) return 'missing x-signature header';
  if (!requestId) return 'missing x-request-id header';
  const parts = Object.fromEntries(signature.split(',').map(pair => pair.trim().split('=')));
  const timestamp = Number(parts.ts);
  if (!parts.v1 || !Number.isFinite(timestamp)) return 'malformed x-signature header';
  const timestampMs = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const skew = Math.round(Math.abs(Date.now() - timestampMs) / 1000);
  if (skew > 300) return `timestamp too old (${skew} s)`;
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  if (!safeEqual(parts.v1, expected)) return 'signature mismatch';
  return '';
}

export async function mercadoPagoWebhook(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método no permitido.' }); }
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET || '';
  const signature = req.headers['x-signature'] || '';
  const requestId = req.headers['x-request-id'] || '';
  const dataId = String(req.query?.['data.id'] || req.body?.data?.id || '').toLowerCase();
  const notificationUserId = String(req.body?.user_id || '');
  if (!dataId) { console.warn('Mercado Pago webhook rejected:', 'missing data.id'); return json(res, 401, { error: 'Notificación no válida.' }); }
  if (!notificationUserId) { console.warn('Mercado Pago webhook rejected:', 'missing user_id'); return json(res, 401, { error: 'Notificación no válida.' }); }
  // A signature that cannot be verified is only logged: the payment is re-read from Mercado Pago
  // with the seller's token and must still match the order, so the request body is never trusted.
  const signatureProblem = webhookSignatureProblem({ secret, signature, requestId, dataId });
  if (signatureProblem) console.warn('Mercado Pago webhook signature not verified, checking the payment with Mercado Pago:', signatureProblem);
  try {
    const seller = await getSellerToken(notificationUserId);
    if (!seller) return json(res, 200, { received: true });
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, { headers: { Authorization: `Bearer ${seller.accessToken}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return json(res, 502, { error: 'No se pudo verificar la orden con Mercado Pago.' });
    const payment = await response.json();
    const externalId = String(payment.external_reference || '');
    const [order] = await db(`web_orders?id=eq.${encodeURIComponent(externalId)}&select=id,total_amount,currency,mp_preference_id,mp_seller_id,payment_status`);
    if (!order || String(order.mp_seller_id) !== notificationUserId || !paymentMatchesOrder(payment, order, notificationUserId)) return json(res, 200, { received: true });
    const paid = payment.status === 'approved';
    const failed = ['rejected', 'cancelled', 'refunded', 'charged_back'].includes(payment.status);
    await db(`web_orders?id=eq.${encodeURIComponent(order.id)}&payment_status=neq.paid`, {
      method: 'PATCH', body: paid
        ? { payment_status: 'paid', order_status: 'confirmed', mp_payment_id: String(payment.id), paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        : failed ? { payment_status: 'failed', mp_payment_id: String(payment.id), updated_at: new Date().toISOString() } : { mp_payment_id: String(payment.id), updated_at: new Date().toISOString() },
    });
    if (paid) {
      // Idempotent in the database: a repeated notification never discounts twice.
      await applyPaidOrderStock(order.id)
        .catch(error => console.error('Stock discount failed for order', order.id, error.message));
    }
    return json(res, 200, { received: true });
  } catch (error) { console.error('Mercado Pago webhook processing failed:', error.message); return json(res, 500, { error: 'No se pudo procesar la notificación.' }); }
}

async function findApprovedPaymentForOrder(order) {
  if (!order.mp_seller_id) return null;
  const seller = await getSellerToken(order.mp_seller_id);
  if (!seller) return null;
  const params = new URLSearchParams({
    sort: 'date_created', criteria: 'desc', external_reference: String(order.id),
    range: 'date_created', begin_date: new Date(order.created_at).toISOString(), end_date: new Date().toISOString(), limit: '10',
  });
  const response = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
    headers: { Authorization: `Bearer ${seller.accessToken}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Mercado Pago payment search returned ${response.status}`);
  const result = await response.json();
  return (result.results || []).find(payment => payment.status === 'approved' && paymentMatchesOrder(payment, order, order.mp_seller_id)) || null;
}

// Marks a pending Mercado Pago order as paid when Mercado Pago reports an approved payment
// that matches it. Returns that payment, or null.
async function reconcileOrder(order) {
  const payment = await findApprovedPaymentForOrder(order);
  if (!payment) return null;
  await db(`web_orders?id=eq.${encodeURIComponent(order.id)}&payment_status=neq.paid`, {
    method: 'PATCH', body: { payment_status: 'paid', order_status: 'confirmed', mp_payment_id: String(payment.id), paid_at: payment.date_approved || new Date().toISOString(), updated_at: new Date().toISOString() },
  });
  await applyPaidOrderStock(order.id).catch(error => console.error('Stock discount failed for reconciled order', order.id, error.message));
  return payment;
}

// Backup for missed webhooks: re-checks recent pending Mercado Pago orders. It only marks as paid
// what Mercado Pago confirms with the seller's token, so it needs no authentication.
const RECONCILE_THROTTLE_MS = 20000;
const RECONCILE_DAYS = 14;
let lastReconciliation = { at: 0, result: null };
async function runReconciliation() {
  if (lastReconciliation.result && Date.now() - lastReconciliation.at < RECONCILE_THROTTLE_MS) return lastReconciliation.result;
  const since = new Date(Date.now() - RECONCILE_DAYS * 86400000).toISOString();
  const orders = await db(`web_orders?payment_method=eq.mercado_pago&payment_status=eq.pending&created_at=gte.${encodeURIComponent(since)}&select=id,order_number,total_amount,currency,mp_preference_id,mp_seller_id,created_at&order=created_at.desc&limit=25`) || [];
  const paid = [];
  for (const order of orders) {
    try { if (await reconcileOrder(order)) paid.push(order.order_number); } catch (error) { console.error('Reconciliation failed for order', order.order_number, error.message); }
  }
  const result = { checked: orders.length, paid };
  lastReconciliation = { at: Date.now(), result };
  return result;
}

export async function reconcilePendingOrders(req, res) {
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return json(res, 405, { error: 'Método no permitido.' }); }
  res.setHeader('Cache-Control', 'no-store');
  try { return json(res, 200, await runReconciliation()); } catch (error) { console.error('Pending order reconciliation failed:', error.message); return json(res, 503, { error: 'No se pudieron conciliar los pagos.' }); }
}

export async function orderStatus(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Método no permitido.' }); }
  try {
    const number = String(req.query?.orderNumber || '').slice(0, 80);
    if (!number) return json(res, 400, { error: 'Falta el número de pedido.' });
    // Either the shopper's session or the order's return key from the Mercado Pago link.
    const keyed = validReturnToken(number, req.query?.t);
    let owner = '';
    if (!keyed) {
      const token = bearer(req); if (!token) return json(res, 401, { error: 'Iniciá sesión para consultar tu pedido.' });
      const user = await verifyUser(token); if (!user?.id) return json(res, 401, { error: 'La sesión venció. Volvé a iniciar sesión.' });
      owner = `&user_id=eq.${encodeURIComponent(user.id)}`;
    }
    const [order] = await db(`web_orders?order_number=eq.${encodeURIComponent(number)}${owner}&select=id,order_number,payment_method,payment_status,order_status,total_amount,currency,mp_preference_id,mp_seller_id,pickup_point,created_at,paid_at,web_order_items(product_barcode,product_name,quantity,unit_price)`);
    if (!order) return json(res, 404, { error: 'No encontramos ese pedido en tu cuenta.' });
    if (order.payment_method === 'mercado_pago' && order.payment_status === 'pending') {
      try {
        const payment = await reconcileOrder(order);
        if (payment) {
          order.payment_status = 'paid'; order.order_status = 'confirmed'; order.mp_payment_id = String(payment.id); order.paid_at = payment.date_approved || new Date().toISOString();
        }
      } catch (error) { console.error('Payment status reconciliation failed:', error.message); }
    }
    // Internal payment references stay on the server.
    const { id, mp_preference_id: _pref, mp_seller_id: _seller, mp_payment_id: _payment, currency: _currency, ...visible } = order;
    if (visible.payment_method === 'transferencia' && visible.payment_status !== 'paid' && visible.order_status !== 'cancelled' && transferAccount().enabled) visible.transfer = transferDetails(transferAccount());
    res.setHeader('Cache-Control', 'private, no-store');
    return json(res, 200, { order: visible });
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
  // Fix orders whose webhook never arrived before listing them.
  await runReconciliation().catch(error => console.error('Pending order reconciliation failed:', error.message));
  try {
    const base = 'id,order_number,customer_name,customer_email,pickup_point,payment_method,payment_status,order_status,total_amount,created_at,paid_at';
    const items = 'web_order_items(product_name,quantity,unit_price,line_total)';
    // Newest columns first; older databases fall back to the fields they have.
    const variants = [`${base},customer_phone,customer_note,pickup_type,pickup_dates,stock_applied_at,stock_shortage,customer_dni,subtotal_amount,surcharge_amount`, `${base},customer_phone,customer_note,pickup_type,pickup_dates,stock_applied_at,stock_shortage`, `${base},customer_phone,customer_note,stock_applied_at,stock_shortage`, `${base},stock_applied_at,stock_shortage`, base];
    let orders; let lastError;
    for (const fields of variants) {
      try { orders = await db(`web_orders?select=${fields},${items}&order=created_at.desc&limit=100`); break; } catch (error) { lastError = error; }
    }
    if (!orders) throw lastError;
    return json(res, 200, { orders });
  } catch (error) { console.error('Admin order list failed:', error.message); return json(res, 503, { error: 'No se pudieron cargar los pedidos. Revisá que la migración revisada esté aplicada.' }); }
}

const ADMIN_ACTIONS = new Set(['accept', 'confirm_payment', 'ready', 'deliver', 'reject']);
export async function adminOrderAction(req, res) {
  if (!isAdmin(req)) return json(res, 401, { error: 'Iniciá sesión en el panel de pedidos.' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método no permitido.' }); }
  const orderId = String(req.body?.orderId || '');
  const action = String(req.body?.action || '');
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !ADMIN_ACTIONS.has(action)) return json(res, 400, { error: 'Acción no válida.' });
  try {
    const order = await db('rpc/set_web_order_status', { method: 'POST', body: { p_order_id: orderId, p_action: action, p_note: String(req.body?.note || '').slice(0, 300) || null } });
    await sendOrderStatusPush(orderId).catch(() => {});
    return json(res, 200, { order });
  } catch (error) {
    if (/invalid_transition/i.test(error.message)) return json(res, 409, { error: 'El pedido cambió de estado. Actualizá la lista.' });
    if (/set_web_order_status|PGRST202|42883/i.test(error.message)) return json(res, 503, { error: 'Falta aplicar la migración de pedidos en Supabase.' });
    console.error('Admin order action failed:', error.message);
    return json(res, 500, { error: 'No se pudo actualizar el pedido.' });
  }
}

export async function myOrders(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Método no permitido.' }); }
  try {
    const token = bearer(req); if (!token) return json(res, 401, { error: 'Iniciá sesión para ver tus pedidos.' });
    const user = await verifyUser(token); if (!user?.id) return json(res, 401, { error: 'La sesión venció. Volvé a iniciar sesión.' });
    const base = 'order_number,payment_method,payment_status,order_status,total_amount,pickup_point,created_at,web_order_items(product_name,quantity)';
    const mine = fields => db(`web_orders?user_id=eq.${encodeURIComponent(user.id)}&select=${fields}&order=created_at.desc&limit=20`);
    // Newer columns first; a database without the latest migrations still answers with the base fields.
    let orders;
    for (const fields of [`${base},status_note,pickup_type,pickup_dates,subtotal_amount,surcharge_amount`, `${base},status_note,pickup_type,pickup_dates`, `${base},status_note`, base]) {
      try { orders = await mine(fields); break; } catch (error) { if (fields === base) throw error; }
    }
    const account = transferAccount();
    if (account.enabled) for (const order of orders || []) {
      if (order.payment_method === 'transferencia' && order.payment_status !== 'paid' && order.order_status !== 'cancelled') order.transfer = transferDetails(account);
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return json(res, 200, { orders });
  } catch (error) { console.error('My orders failed:', error.message); return json(res, 503, { error: 'No se pudieron cargar tus pedidos.' }); }
}

// Latest money received by the connected seller account, for the local to check transfers without
// opening the Mercado Pago app. Read-only. Allowed with the shop's admin session or, for gestión
// (server to server), with the x-staff-key header matching STAFF_API_KEY.
function staffKeyValid(req) {
  const key = process.env.STAFF_API_KEY || '';
  const sent = String(req.headers['x-staff-key'] || '');
  return key.length >= 24 && Boolean(sent) && safeEqual(sent, key);
}
const PAYMENT_KIND = payment => {
  const op = String(payment.operation_type || '');
  if (op === 'pos_payment') return 'Cobro con posnet';
  const type = String(payment.payment_type_id || '');
  if (op === 'money_transfer' || type === 'bank_transfer' || /transfer/i.test(String(payment.payment_method_id || ''))) return 'Transferencia';
  if (op === 'regular_payment') return 'Cobro';
  return op || type || 'Movimiento';
};
const payerName = payment => {
  const payer = payment.payer || {};
  const full = [payer.first_name, payer.last_name].filter(Boolean).join(' ').trim();
  return full || payment.additional_info?.payer?.first_name || payer.email || '';
};

export async function sellerRecentPayments(req, res) {
  if (!isAdmin(req) && !staffKeyValid(req)) return json(res, 401, { error: 'No autorizado.' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Método no permitido.' }); }
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const seller = await getActiveSellerToken();
    if (!seller) return json(res, 200, { connected: false, payments: [] });
    const days = Math.min(Math.max(Number(req.query?.days) || 7, 1), 30);
    const params = new URLSearchParams({ sort: 'date_created', criteria: 'desc', range: 'date_created', begin_date: `NOW-${days}DAYS`, end_date: 'NOW', limit: '50' });
    const response = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, { headers: { Authorization: `Bearer ${seller.accessToken}` }, signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { console.error('Seller payments search failed', response.status, JSON.stringify(result).slice(0, 300)); return json(res, 502, { error: 'Mercado Pago no devolvió los cobros. Probá de nuevo en un rato.' }); }
    // Only money that came in to this account.
    const incoming = (result.results || []).filter(payment => String(payment.collector_id || '') === String(seller.sellerId));
    const refs = [...new Set(incoming.map(payment => String(payment.external_reference || '')).filter(ref => /^[0-9a-f-]{36}$/i.test(ref)))];
    const orders = refs.length ? await db(`web_orders?id=in.(${refs.join(',')})&select=id,order_number`).catch(() => []) : [];
    const orderByRef = new Map((orders || []).map(order => [String(order.id), order.order_number]));
    const payments = incoming.map(payment => {
      const orderNumber = orderByRef.get(String(payment.external_reference || '')) || '';
      return {
      id: String(payment.id),
      date: payment.date_approved || payment.date_created,
      amount: Number(payment.transaction_amount),
      netAmount: payment.transaction_details?.net_received_amount != null ? Number(payment.transaction_details.net_received_amount) : null,
      status: payment.status,
      kind: orderNumber ? 'Pago de la tienda' : PAYMENT_KIND(payment),
      payer: payerName(payment),
      payerDni: payment.payer?.identification?.number ? String(payment.payer.identification.number) : '',
      description: String(payment.description || '').slice(0, 120),
      orderNumber,
      operationType: payment.operation_type || '',
      paymentType: payment.payment_type_id || '',
      };
    });
    return json(res, 200, { connected: true, sellerNickname: seller.nickname || '', days, payments });
  } catch (error) { console.error('Seller payments failed:', error.message); return json(res, 503, { error: 'No se pudieron consultar los cobros de Mercado Pago.' }); }
}
