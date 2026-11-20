import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const apiBase = 'https://api.mercadopago.com';
const authBase = 'https://auth.mercadopago.com/authorization';
const supabaseConfig = () => ({
  url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  key: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
});

function mpAppConfig() {
  const clientId = process.env.MERCADOPAGO_CLIENT_ID || '';
  const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET || '';
  const redirectUri = process.env.MERCADOPAGO_REDIRECT_URI || '';
  if (!clientId || !clientSecret || !/^https:\/\//.test(redirectUri)) throw new Error('Falta configurar la aplicación OAuth de Mercado Pago y su URL HTTPS de retorno.');
  return { clientId, clientSecret, redirectUri };
}

function encryptionKey() {
  const key = Buffer.from(process.env.MP_TOKEN_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('MP_TOKEN_ENCRYPTION_KEY debe ser una clave Base64 de 32 bytes.');
  return key;
}

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}
function decrypt(value) {
  const [ivText, tagText, dataText] = String(value).split('.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
}

async function db(path, { method = 'GET', body } = {}) {
  const { url, key } = supabaseConfig();
  if (!url || !key) throw new Error('Supabase no está configurado en el servidor.');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase rechazó la operación OAuth (${response.status}). ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function adminCookieValid(req) {
  const password = process.env.SHOP_ADMIN_PASSWORD || '';
  const cookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('cr_shop_admin='))?.slice('cr_shop_admin='.length);
  const [payload, signature] = String(cookie || '').split('.');
  if (!password || !payload || !signature) return false;
  const expected = createHmac('sha256', password).update(payload).digest('base64url');
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
const cookieValue = (req, name) => (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
const json = (res, status, body) => res.status(status).json(body);
const redirect = (res, url) => res.redirect(302, url);

export async function startMercadoPagoConnect(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Método no permitido.' }); }
  if (!adminCookieValid(req)) return json(res, 401, { error: 'Ingresá al panel del local antes de conectar Mercado Pago.' });
  try {
    const { clientId, clientSecret, redirectUri } = mpAppConfig();
    const nonce = randomBytes(24).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const exp = Date.now() + 10 * 60 * 1000;
    const payload = Buffer.from(JSON.stringify({ nonce, verifier, exp })).toString('base64url');
    const signature = createHmac('sha256', clientSecret).update(payload).digest('base64url');
    const signedState = `${payload}.${signature}`;
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `mp_oauth_state=${signedState}; HttpOnly; SameSite=Lax; Path=/api/mp/oauth/callback; Max-Age=600${secure}`);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const url = new URL(authBase);
    url.search = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      platform_id: 'mp',
      state: signedState,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return redirect(res, url.toString());
  } catch (error) { console.error('Mercado Pago OAuth start failed:', error.message); return json(res, 503, { error: 'No está configurada la conexión segura con Mercado Pago.' }); }
}

function verifyOAuthState(req) {
  const state = String(req.query?.state || '');
  const cookie = cookieValue(req, 'mp_oauth_state') || '';
  if (!state || !cookie || !safeEqualText(state, cookie)) return null;
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return null;
  const { clientSecret } = mpAppConfig();
  const expected = createHmac('sha256', clientSecret).update(payload).digest('base64url');
  if (!safeEqualText(signature, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return decoded.exp > Date.now() ? decoded : null;
  } catch { return null; }
}
function safeEqualText(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function mercadoPagoOAuthCallback(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Método no permitido.' }); }
  res.setHeader('Set-Cookie', 'mp_oauth_state=; HttpOnly; SameSite=Lax; Path=/api/mp/oauth/callback; Max-Age=0; Secure');
  if (req.query?.error) return redirect(res, '/?mp_connect=cancelled');
  try {
    const state = verifyOAuthState(req);
    if (!state || !req.query?.code) return redirect(res, '/?mp_connect=invalid_state');
    const { clientId, clientSecret, redirectUri } = mpAppConfig();
    const tokenResponse = await fetch(`${apiBase}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code',
        code: String(req.query.code), redirect_uri: redirectUri, code_verifier: state.verifier,
        test_token: process.env.MERCADOPAGO_ENV === 'test' ? 'true' : 'false',
      }), signal: AbortSignal.timeout(15000),
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token || !token.refresh_token || !token.user_id) {
      console.error('Mercado Pago OAuth token exchange rejected:', tokenResponse.status, JSON.stringify(token).slice(0, 300));
      return redirect(res, '/?mp_connect=token_rejected');
    }
    const profileResponse = await fetch(`${apiBase}/users/me`, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10000) });
    const seller = profileResponse.ok ? await profileResponse.json() : {};
    if (String(seller.id || token.user_id) !== String(token.user_id)) return redirect(res, '/?mp_connect=identity_mismatch');
    if (process.env.MERCADOPAGO_ENV === 'test' && token.live_mode !== false) return redirect(res, '/?mp_connect=live_account_rejected');
    if (process.env.MERCADOPAGO_ENV === 'test' && !process.env.MERCADOPAGO_TEST_USER_ID) return redirect(res, '/?mp_connect=missing_test_seller_config');
    if (process.env.MERCADOPAGO_ENV === 'test' && String(token.user_id) !== String(process.env.MERCADOPAGO_TEST_USER_ID)) return redirect(res, '/?mp_connect=wrong_test_seller');
    const expiresAt = new Date(Date.now() + Number(token.expires_in || 0) * 1000).toISOString();
    await db('rpc/save_mp_seller_connection', { method: 'POST', body: {
      p_seller_user_id: String(token.user_id), p_seller_nickname: String(seller.nickname || '').slice(0, 120) || null,
      p_access_token_ciphertext: encrypt(token.access_token), p_refresh_token_ciphertext: encrypt(token.refresh_token),
      p_token_expires_at: expiresAt,
    } });
    return redirect(res, '/?mp_connect=success&panel=orders');
  } catch (error) {
    console.error('Mercado Pago OAuth callback failed:', error.message);
    const message = String(error?.message || '');
    const code = message.includes('MP_TOKEN_ENCRYPTION_KEY') ? 'encryption_error'
      : message.includes('Supabase no está configurado') || message.includes('Falta configurar la aplicación OAuth') ? 'server_config_error'
        : message.includes('Supabase rechazó') ? 'database_error'
          : 'failed';
    return redirect(res, `/?mp_connect=${code}`);
  }
}

export async function mercadoPagoConnectionStatus(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Método no permitido.' }); }
  if (!adminCookieValid(req)) return json(res, 401, { error: 'Iniciá sesión en el panel del local.' });
  try {
    const rows = await db('mp_seller_connections?is_active=eq.true&select=seller_user_id,seller_nickname,connected_at&limit=1');
    const seller = rows?.[0];
    const environment = process.env.MERCADOPAGO_ENV === 'test' ? 'test' : process.env.MERCADOPAGO_ENV ? 'production' : 'unset';
    const testSellerId = process.env.MERCADOPAGO_TEST_USER_ID || '';
    return json(res, 200, {
      connected: Boolean(seller),
      environment,
      testSellerConfigured: Boolean(testSellerId),
      configuredTestSellerId: testSellerId || null,
      sellerMatchesTestUser: environment === 'test' && seller ? String(seller.seller_user_id) === String(testSellerId) : null,
      seller: seller ? { id: seller.seller_user_id, nickname: seller.seller_nickname, connectedAt: seller.connected_at } : null,
    });
  } catch (error) { console.error('Mercado Pago connection status failed:', error.message); return json(res, 503, { error: 'Revisá que esté aplicada la migración de conexiones OAuth.' }); }
}

async function findConnection(sellerId) {
  const rows = await db(`mp_seller_connections?seller_user_id=eq.${encodeURIComponent(String(sellerId))}&select=seller_user_id,seller_nickname,access_token_ciphertext,refresh_token_ciphertext,token_expires_at,is_active&limit=1`);
  const row = rows?.[0];
  if (!row) return null;
  return {
    sellerId: row.seller_user_id, nickname: row.seller_nickname, isActive: row.is_active,
    accessToken: decrypt(row.access_token_ciphertext), refreshToken: decrypt(row.refresh_token_ciphertext), expiresAt: row.token_expires_at,
  };
}

export async function getActiveSellerToken() {
  const rows = await db('mp_seller_connections?is_active=eq.true&select=seller_user_id&limit=1');
  if (!rows?.[0]) return null;
  return getSellerToken(rows[0].seller_user_id);
}

export async function getSellerToken(sellerId) {
  const seller = await findConnection(sellerId);
  if (!seller) return null;
  if (new Date(seller.expiresAt).getTime() > Date.now() + 5 * 60 * 1000) return seller;
  const { clientId, clientSecret } = mpAppConfig();
  const response = await fetch(`${apiBase}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: seller.refreshToken, test_token: process.env.MERCADOPAGO_ENV === 'test' ? 'true' : 'false' }),
    signal: AbortSignal.timeout(15000),
  });
  const refreshed = await response.json();
  if (!response.ok || !refreshed.access_token || !refreshed.refresh_token) throw new Error('La conexión de Mercado Pago venció; volvé a autorizar la cuenta vendedora.');
  const expiresAt = new Date(Date.now() + Number(refreshed.expires_in || 0) * 1000).toISOString();
  await db(`mp_seller_connections?seller_user_id=eq.${encodeURIComponent(seller.sellerId)}`, { method: 'PATCH', body: {
    access_token_ciphertext: encrypt(refreshed.access_token), refresh_token_ciphertext: encrypt(refreshed.refresh_token),
    token_expires_at: expiresAt, updated_at: new Date().toISOString(),
  } });
  return { ...seller, accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, expiresAt };
}
