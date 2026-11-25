import { timingSafeEqual } from 'node:crypto';
import * as webpush from 'web-push';

// Web push notifications to the buyer when their order changes status.
// Subscriptions live in web_push_subscriptions and only this server writes them.

const json = (res, status, body) => res.status(status).json(body);
const LOCAL_PICKUPS = new Set(['Local Itatí', 'Local La Haya']);
const PICKUP_LABELS = { 'Maxi Carrefour': 'Maxi Carrefour (Camino Negro y Rodríguez)' };
const placeName = point => PICKUP_LABELS[point] || point;
const config = () => ({
  url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  key: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  anon: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
});

let vapidReady = null;
function vapid() {
  if (vapidReady !== null) return vapidReady;
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.VAPID_SUBJECT || 'https://perfumeria-cr.vercel.app').trim();
  if (!publicKey || !privateKey) return (vapidReady = false);
  try { webpush.setVapidDetails(subject, publicKey, privateKey); vapidReady = true; }
  catch (error) { console.error('Web push config invalid:', error.message); vapidReady = false; }
  return vapidReady;
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

async function verifyUser(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const { url, anon } = config();
  if (!url || !anon) return null;
  const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  return response.ok ? response.json() : null;
}

function staffKeyValid(req) {
  const key = process.env.STAFF_API_KEY || '';
  const sent = String(req.headers['x-staff-key'] || '');
  if (key.length < 24 || !sent) return false;
  const a = Buffer.from(sent); const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

const validSubscription = sub => {
  const endpoint = String(sub?.endpoint || '');
  let https = false;
  try { https = new URL(endpoint).protocol === 'https:'; } catch { /* invalid URL */ }
  return https && endpoint.length <= 1000 && typeof sub?.keys?.p256dh === 'string' && typeof sub?.keys?.auth === 'string'
    && sub.keys.p256dh.length > 0 && sub.keys.p256dh.length <= 200 && sub.keys.auth.length > 0 && sub.keys.auth.length <= 100;
};

export function pushPublicKey(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Método no permitido.' }); }
  res.setHeader('Cache-Control', 'public, max-age=300');
  return json(res, 200, { publicKey: vapid() ? String(process.env.VAPID_PUBLIC_KEY).trim() : null });
}

export async function subscribePush(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método no permitido.' }); }
  if (!vapid()) return json(res, 503, { error: 'Los avisos no están configurados.' });
  try {
    const user = await verifyUser(req);
    if (!user?.id) return json(res, 401, { error: 'Iniciá sesión para activar los avisos.' });
    const sub = req.body?.subscription || req.body;
    if (!validSubscription(sub)) return json(res, 400, { error: 'La suscripción no es válida.' });
    await db('web_push_subscriptions?on_conflict=endpoint', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: { user_id: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: String(req.headers['user-agent'] || '').slice(0, 300) },
    });
    return json(res, 200, { ok: true });
  } catch (error) { console.error('Push subscribe failed:', error.message); return json(res, 503, { error: 'No se pudieron activar los avisos.' }); }
}

export async function unsubscribePush(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método no permitido.' }); }
  try {
    const user = await verifyUser(req);
    if (!user?.id) return json(res, 401, { error: 'Iniciá sesión.' });
    const endpoint = String(req.body?.endpoint || '');
    if (!endpoint) return json(res, 400, { error: 'Falta el endpoint.' });
    await db(`web_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: 'DELETE', prefer: 'return=minimal' });
    return json(res, 200, { ok: true });
  } catch (error) { console.error('Push unsubscribe failed:', error.message); return json(res, 503, { error: 'No se pudieron desactivar los avisos.' }); }
}

function statusMessage(order) {
  const n = order.order_number;
  const local = order.pickup_type === 'local' || (!order.pickup_type && LOCAL_PICKUPS.has(order.pickup_point));
  switch (order.order_status) {
    case 'preparing': return `Tu pedido ${n} fue aceptado y ya lo estamos preparando.`;
    case 'confirmed': return order.payment_method === 'transferencia'
      ? `Recibimos tu transferencia. Ya estamos preparando tu pedido ${n}.`
      : `Tu pedido ${n} fue aceptado y ya lo estamos preparando.`;
    case 'ready_for_pickup': return local
      ? `Tu pedido ${n} está listo. Ya podés pasar a retirarlo por ${placeName(order.pickup_point)}.`
      : `Tu pedido ${n} está listo. Te vamos a escribir por WhatsApp para coordinar el encuentro en ${placeName(order.pickup_point)}.`;
    case 'cancelled': return `Tu pedido ${n} fue cancelado.${order.status_note ? ` Motivo: ${String(order.status_note).slice(0, 140)}` : ''}`;
    default: return null;
  }
}

// Sends the buyer a notification for the order's current status. Never throws.
export async function sendOrderStatusPush(orderId) {
  const result = { sent: 0, removed: 0, skipped: '' };
  try {
    if (!vapid()) { result.skipped = 'not_configured'; return result; }
    if (!/^[0-9a-f-]{36}$/i.test(String(orderId || ''))) { result.skipped = 'invalid_order'; return result; }
    let rows;
    try { rows = await db(`web_orders?id=eq.${orderId}&select=user_id,order_number,order_status,payment_method,payment_status,pickup_type,pickup_point,pickup_dates,status_note&limit=1`); }
    catch { rows = await db(`web_orders?id=eq.${orderId}&select=user_id,order_number,order_status,payment_method,payment_status,pickup_point&limit=1`); }
    const order = rows?.[0];
    if (!order?.user_id) { result.skipped = 'order_not_found'; return result; }
    const body = statusMessage(order);
    if (!body) { result.skipped = 'no_message_for_status'; return result; }
    const subs = await db(`web_push_subscriptions?user_id=eq.${encodeURIComponent(order.user_id)}&select=id,endpoint,p256dh,auth`) || [];
    if (!subs.length) { result.skipped = 'no_subscriptions'; return result; }
    const payload = JSON.stringify({ title: 'CR Perfumería', body, url: '/?mis-pedidos=1', tag: order.order_number });
    await Promise.all(subs.map(async sub => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 24 * 60 * 60, timeout: 10000 });
        result.sent += 1;
        await db(`web_push_subscriptions?id=eq.${sub.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { last_used_at: new Date().toISOString() } }).catch(() => {});
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          result.removed += 1;
          await db(`web_push_subscriptions?id=eq.${sub.id}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
        } else console.error('Push send failed:', error.statusCode || '', error.message);
      }
    }));
  } catch (error) { console.error('Order status push failed:', error.message); result.skipped = 'error'; }
  return result;
}

// Server to server: gestión asks for the notice after changing an order's status.
export async function orderStatusPush(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método no permitido.' }); }
  if (!staffKeyValid(req)) return json(res, 401, { error: 'No autorizado.' });
  const result = await sendOrderStatusPush(String(req.body?.orderId || ''));
  return json(res, 200, result);
}
