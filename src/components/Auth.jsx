import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Eye, EyeOff, LockKeyhole, MapPin, ShoppingBag, Store, Wallet } from 'lucide-react';
import { authReady, supabase } from '../lib/supabase.js';
import { localPickups, pickUpPoints } from '../lib/format.js';
import Modal from './Modal.jsx';

export const LOGO = { small: '/brand/logo-160.webp', medium: '/brand/logo-384.webp', large: '/brand/logo-768.webp' };

export function Logo({ size = 'small', className = '', eager = false }) {
  return (
    <img
      className={`logo ${className}`}
      src={LOGO[size]}
      srcSet={size === 'small' ? `${LOGO.small} 160w, ${LOGO.medium} 384w` : `${LOGO.medium} 384w, ${LOGO.large} 768w`}
      sizes={size === 'small' ? '56px' : '(max-width: 640px) 220px, 320px'}
      alt="CR Perfumería & Limpieza"
      width="160"
      height="160"
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}

function friendlyAuthError(error) {
  const text = String(error?.message || '').toLowerCase();
  if (text.includes('invalid login')) return 'El correo o la contraseña no coinciden. Revisalos o recuperá la contraseña.';
  if (text.includes('email not confirmed')) return 'Tu cuenta todavía no está confirmada. Revisá el correo que te enviamos.';
  if (text.includes('rate limit') || text.includes('too many')) return 'Hiciste varios intentos seguidos. Esperá unos minutos y volvé a probar.';
  if (text.includes('fetch') || text.includes('network')) return 'No hay conexión. Revisá internet e intentá de nuevo.';
  return error?.message || 'No se pudo completar el acceso.';
}

function PasswordField({ label = 'Contraseña', value, onChange, autoComplete, minLength = 8, hint }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field">
      {label}
      <span className="field__password">
        <input type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={onChange} required minLength={minLength} maxLength={72} />
        <button type="button" className="field__reveal" onClick={() => setVisible(v => !v)} aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
      </span>
      {hint && <small className="field__hint">{hint}</small>}
    </label>
  );
}

export function AuthForm({ initialMode = 'signup', onSignedIn }) {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const switchMode = next => { setMode(next); setError(''); setMessage(''); };

  const submit = async event => {
    event.preventDefault();
    setError(''); setMessage('');
    if (!authReady || !supabase) { setError('Las cuentas todavía no están configuradas en este sitio.'); return; }
    setBusy(true);
    try {
      if (mode === 'signup') {
        const response = await fetch('/api/auth/signup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, phone, password, website }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 409 && data.exists) { switchMode('login'); setMessage(data.error); return; }
        if (!response.ok) throw new Error(data.error || 'No pudimos crear la cuenta.');
        const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        onSignedIn(auth.session, 'signup');
      } else if (mode === 'recover') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (authError) throw authError;
        setMessage('Si el correo tiene una cuenta, te llega un enlace para crear una contraseña nueva.');
      } else {
        const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        onSignedIn(auth.session, 'login');
      }
    } catch (authError) { setError(friendlyAuthError(authError)); }
    finally { setBusy(false); }
  };

  return (
    <div className="auth-form">
      {mode !== 'recover' && (
        <div className="segmented" role="tablist" aria-label="Tipo de acceso">
          <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'is-active' : ''} onClick={() => switchMode('signup')}>Crear cuenta</button>
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => switchMode('login')}>Ya tengo cuenta</button>
        </div>
      )}
      {mode === 'recover' && <h2 className="auth-form__title">Recuperar contraseña</h2>}
      <form onSubmit={submit} className="form" noValidate={false}>
        {mode === 'signup' && <label className="field">Nombre y apellido<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={120} /></label>}
        {mode === 'signup' && <label className="field">WhatsApp<input type="tel" inputMode="tel" autoComplete="tel" placeholder="11 2345 6789" value={phone} onChange={e => setPhone(e.target.value.replace(/[^\d\s()+-]/g, ''))} required minLength={8} maxLength={40} /><small className="field__hint">Te escribimos por acá para coordinar el día y la hora de retiro.</small></label>}
        <label className="field">Correo electrónico<input type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        {mode !== 'recover' && (
          <PasswordField
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={mode === 'signup' ? 8 : 6}
            hint={mode === 'signup' ? 'Mínimo 8 caracteres.' : undefined}
          />
        )}
        {mode === 'signup' && <input className="hp-field" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} aria-hidden="true" name="website" />}
        {error && <p className="alert alert--error" role="alert"><AlertCircle size={16} />{error}</p>}
        {message && <p className="alert" role="status"><Check size={16} />{message}</p>}
        <button className="button button--gold button--wide button--large" type="submit" disabled={busy}>
          {busy ? 'Un momento…' : mode === 'signup' ? 'Crear cuenta y entrar' : mode === 'recover' ? 'Enviar enlace' : 'Entrar a la tienda'}
        </button>
      </form>
      <div className="auth-form__links">
        {mode === 'login' && <button type="button" className="text-link" onClick={() => switchMode('recover')}>Olvidé mi contraseña</button>}
        {mode === 'recover' && <button type="button" className="text-link" onClick={() => switchMode('login')}>Volver a ingresar</button>}
      </div>
      <p className="auth-form__secure"><LockKeyhole size={14} /> Tu sesión queda guardada en este dispositivo hasta que cierres sesión.</p>
    </div>
  );
}

// First screen for visitors without a session: register (or sign in) before entering the shop.
export function AuthGate({ onSignedIn, onAdmin }) {
  return (
    <div className="gate">
      <div className="gate__glow" aria-hidden="true" />
      <div className="gate__inner">
        <section className="gate__brand" aria-labelledby="gate-title">
          <Logo size="medium" className="gate__logo" eager />
          <h1 id="gate-title">Perfumería y limpieza con retiro en el local o en un punto de encuentro</h1>
          <p>Creá tu cuenta para ver el catálogo, armar el pedido y pagarlo con Mercado Pago o en efectivo.</p>
          <ul className="gate__perks">
            <li><ShoppingBag size={18} /> Catálogo con precios y stock del local</li>
            <li><Wallet size={18} /> Pago con Mercado Pago o en efectivo al retirar</li>
            <li><MapPin size={18} /> Retiro en {localPickups.join(' o ')}, o en {pickUpPoints.length} puntos de encuentro</li>
          </ul>
        </section>
        <section className="gate__panel" aria-label="Crear cuenta o ingresar">
          <AuthForm initialMode="signup" onSignedIn={onSignedIn} />
        </section>
      </div>
      <button type="button" className="gate__admin text-link" onClick={onAdmin}><Store size={15} /> Pedidos del local</button>
    </div>
  );
}

export function AuthDialog({ mode, onClose, onSignedIn }) {
  return (
    <Modal onClose={onClose} labelledBy="auth-dialog-title" className="sheet sheet--narrow">
      <h2 id="auth-dialog-title" className="sheet__title sheet__title--small">Tu sesión venció</h2>
      <p className="sheet__intro">Ingresá de nuevo para seguir con el pedido.</p>
      <AuthForm initialMode={mode || 'login'} onSignedIn={(session, kind) => { onSignedIn(session, kind); onClose(); }} />
    </Modal>
  );
}

export function PasswordResetDialog({ onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw authError;
      onDone();
    } catch (authError) { setError(friendlyAuthError(authError)); }
    finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} labelledBy="reset-title" className="sheet sheet--narrow">
      <h2 id="reset-title" className="sheet__title">Elegí una contraseña nueva</h2>
      <p className="sheet__intro">La vas a usar la próxima vez que entres desde otro dispositivo.</p>
      <form onSubmit={submit} className="form">
        <PasswordField label="Contraseña nueva" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" hint="Mínimo 8 caracteres." />
        {error && <p className="alert alert--error" role="alert"><AlertCircle size={16} />{error}</p>}
        <button className="button button--gold button--wide" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
      </form>
    </Modal>
  );
}

export function BootSplash() {
  return <div className="boot" aria-label="Cargando la tienda" role="status"><Logo size="medium" className="boot__logo" eager /></div>;
}

// One orchestrated entrance after registering or signing in: the seal lights up, the ring closes,
// the greeting appears, then the curtain opens onto the shop. Click or Escape skips it.
export function IntroOverlay({ name, kind, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const leaveAt = reduced ? 700 : 2300;
    const t1 = window.setTimeout(() => setLeaving(true), leaveAt);
    const t2 = window.setTimeout(() => doneRef.current(), leaveAt + (reduced ? 200 : 750));
    const skip = event => { if (event.key === 'Escape') { setLeaving(true); window.setTimeout(() => doneRef.current(), 300); } };
    window.addEventListener('keydown', skip);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); window.removeEventListener('keydown', skip); };
  }, []);
  const first = String(name || '').trim().split(' ')[0];
  return (
    <div className={`intro ${leaving ? 'intro--leaving' : ''}`} role="status" aria-live="polite" onClick={() => { setLeaving(true); window.setTimeout(() => doneRef.current(), 300); }}>
      <div className="intro__stage">
        <svg className="intro__ring" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="96" /></svg>
        <div className="intro__seal">
          <img src={LOGO.large} alt="" className="intro__logo" />
          <span className="intro__shine" aria-hidden="true" />
        </div>
      </div>
      <p className="intro__greeting">{kind === 'signup' ? `Te damos la bienvenida${first ? `, ${first}` : ''}` : `Hola de nuevo${first ? `, ${first}` : ''}`}</p>
      <p className="intro__sub">{kind === 'signup' ? 'Tu cuenta está lista.' : 'Abriendo la tienda.'}</p>
    </div>
  );
}
