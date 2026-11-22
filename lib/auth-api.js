// Creates a customer account that is ready to use right away (no confirmation email),
// so the shopper stays signed in after registering. Never edits or deletes existing users.
const json = (res, status, body) => res.status(status).json(body);
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function limited(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter(time => now - time < WINDOW_MS);
  recent.push(now);
  attempts.set(ip, recent);
  if (attempts.size > 5000) attempts.clear();
  return recent.length > MAX_PER_WINDOW;
}

export async function signUp(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método no permitido.' }); }
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return json(res, 503, { error: 'El registro todavía no está configurado.' });

  const body = req.body || {};
  if (body.website) return json(res, 400, { error: 'No se pudo crear la cuenta.' }); // honeypot
  const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const password = String(body.password || '');
  if (name.length < 2) return json(res, 400, { error: 'Escribí tu nombre y apellido.', field: 'name' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(res, 400, { error: 'Escribí un correo válido, por ejemplo nombre@gmail.com.', field: 'email' });
  if (password.length < 8 || password.length > 72) return json(res, 400, { error: 'La contraseña tiene que tener entre 8 y 72 caracteres.', field: 'password' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
  if (limited(ip)) return json(res, 429, { error: 'Hiciste varios intentos seguidos. Esperá unos minutos y volvé a probar.' });

  try {
    const response = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } }),
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) return json(res, 201, { ok: true });
    const detail = await response.json().catch(() => ({}));
    const text = `${detail.code || ''} ${detail.error_code || ''} ${detail.msg || detail.message || ''}`.toLowerCase();
    if (response.status === 422 && (text.includes('exists') || text.includes('registered'))) {
      return json(res, 409, { error: 'Ya hay una cuenta con ese correo. Ingresá con tu contraseña.', field: 'email', exists: true });
    }
    if (text.includes('password')) return json(res, 400, { error: 'Elegí una contraseña más segura, con letras y números.', field: 'password' });
    console.error('Sign up rejected', response.status, text.slice(0, 200));
    return json(res, 502, { error: 'No pudimos crear la cuenta. Probá de nuevo en unos minutos.' });
  } catch (error) {
    console.error('Sign up failed:', error.message);
    return json(res, 502, { error: 'No pudimos crear la cuenta. Revisá tu conexión e intentá de nuevo.' });
  }
}
