import { useCallback, useEffect, useState } from 'react';

// Coming back from Mercado Pago. The return link carries the order number and a read-only key (t), so the
// status shows even when the page opens without the shopper's session (another browser, or the installed
// app on iPhone, whose storage is separate from Safari). The installed app also remembers the order it sent
// to Mercado Pago and shows its status when the shopper switches back to it.
const PENDING_KEY = 'cr-pending-order';
const PENDING_MAX_AGE = 3 * 60 * 60 * 1000;
const RETURN_PARAMS = ['pedido', 't', 'collection_id', 'collection_status', 'payment_id', 'status', 'external_reference', 'payment_type', 'merchant_order_id', 'preference_id', 'site_id', 'processing_mode', 'merchant_account_id'];
const WAITING_HINTS = ['approved', 'in_process', 'pending', 'resume'];
const DELAYS = [0, 3000, 5000, 8000, 12000, 20000, 30000];

export function rememberPendingOrder(number, token) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ number, token: token || '', at: Date.now() })); } catch { }
}
function readPending() {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    return value?.number && Date.now() - value.at < PENDING_MAX_AGE ? value : null;
  } catch { return null; }
}
function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { }
}
function fromUrl() {
  const params = new URLSearchParams(window.location.search);
  const number = params.get('pedido');
  if (!number) return null;
  // Mercado Pago appends its own status. It is only a hint for the message; the webhook decides.
  return { number, token: params.get('t') || '', hint: params.get('collection_status') || params.get('status') || '' };
}

export function useOrderReturn(session, checking) {
  const [target, setTarget] = useState(fromUrl);
  const [status, setStatus] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      setTarget(current => {
        if (current) return current;
        const pending = readPending();
        return pending ? { number: pending.number, token: pending.token, hint: 'resume' } : null;
      });
    };
    resume();
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, []);

  const accessToken = session?.access_token || '';
  useEffect(() => {
    if (!target) return undefined;
    if (!target.token && !accessToken) {
      if (!checking) { setStatus({ error: 'Iniciá sesión para ver el estado de tu pedido.' }); setDone(true); }
      return undefined;
    }
    let alive = true;
    let timer = 0;
    setStatus(null); setDone(false);
    const query = `orderNumber=${encodeURIComponent(target.number)}${target.token ? `&t=${encodeURIComponent(target.token)}` : ''}`;
    const check = async attempt => {
      try {
        const response = await fetch(`/api/orders/status?${query}`, { headers: accessToken && !target.token ? { Authorization: `Bearer ${accessToken}` } : {}, cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No pudimos consultar el pedido.');
        if (!alive) return;
        setStatus(result.order);
        if (['paid', 'failed'].includes(result.order.payment_status) || result.order.payment_method === 'efectivo') { clearPending(); setDone(true); return; }
        if (!WAITING_HINTS.includes(target.hint)) { setDone(true); return; }
      } catch (error) { if (alive) setStatus({ error: error.message }); }
      if (alive && attempt + 1 < DELAYS.length) timer = window.setTimeout(() => check(attempt + 1), DELAYS[attempt + 1]);
      else if (alive) setDone(true);
    };
    check(0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [target, accessToken, checking]);

  const close = useCallback(() => {
    clearPending();
    setTarget(null); setStatus(null); setDone(false);
    const url = new URL(window.location.href);
    RETURN_PARAMS.forEach(key => url.searchParams.delete(key));
    window.history.replaceState({}, '', url);
  }, []);

  if (!target) return { result: null, close };
  const order = status && !status.error ? { ...status, items: status.web_order_items || [] } : { order_number: target.number };
  let state;
  if (status?.error) state = 'error';
  else if (status?.payment_status === 'paid') state = 'paid';
  else if (status?.payment_status === 'failed') state = 'failed';
  else if (!done) state = 'checking';
  else state = WAITING_HINTS.includes(target.hint) ? 'pending' : 'failed';
  return { result: { state, error: status?.error, order }, close };
}
