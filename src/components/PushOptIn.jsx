import { useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';

// Offers the buyer a phone notification when their order changes status (accepted, ready...).
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

let keyRequest = null;
const loadPublicKey = () => (keyRequest ||= fetch('/api/push/key').then(r => (r.ok ? r.json() : {})).then(d => d.publicKey || null).catch(() => null));

export default function PushOptIn({ compact = false }) {
  const [state, setState] = useState('checking'); // checking | hidden | ios | idle | busy | on | error
  const [publicKey, setPublicKey] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (isIos() && !isStandalone()) { if (alive) setState('ios'); return; }
      if (!pushSupported() || Notification.permission === 'denied') { if (alive) setState('hidden'); return; }
      const key = await loadPublicKey();
      if (!alive) return;
      if (!key) { setState('hidden'); return; }
      setPublicKey(key);
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (alive) setState(existing && Notification.permission === 'granted' ? 'on' : 'idle');
      } catch { if (alive) setState('idle'); }
    })();
    return () => { alive = false; };
  }, []);

  const enable = async () => {
    setState('busy');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setState(permission === 'denied' ? 'hidden' : 'idle'); return; }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription()
        || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const { data } = supabase ? await supabase.auth.getSession() : { data: {} };
      const token = data?.session?.access_token;
      if (!token) throw new Error('no session');
      const response = await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!response.ok) throw new Error('subscribe failed');
      setState('on');
    } catch { setState('error'); }
  };

  if (state === 'checking' || state === 'hidden') return null;
  if (state === 'ios') return <p className={`push-optin push-optin--info ${compact ? 'push-optin--compact' : ''}`}><BellRing size={16} />En iPhone, instalá la tienda en la pantalla de inicio para recibir avisos.</p>;
  if (state === 'on') return <p className={`push-optin push-optin--on ${compact ? 'push-optin--compact' : ''}`}><CheckCircle2 size={16} />Avisos activados ✓</p>;
  return (
    <div className={`push-optin ${compact ? 'push-optin--compact' : ''}`}>
      <button type="button" className="button button--ghost button--wide" onClick={enable} disabled={state === 'busy'}>
        {state === 'busy' ? <Loader2 size={16} className="spin" /> : <BellRing size={16} />} Avisarme cuando mi pedido esté listo
      </button>
      {state === 'error' && <p className="note">No pudimos activar los avisos. Probá de nuevo en un rato.</p>}
    </div>
  );
}
