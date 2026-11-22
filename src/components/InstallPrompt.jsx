import { useEffect, useState } from 'react';
import { Download, PlusSquare, Share, X } from 'lucide-react';
import { LOGO } from './Auth.jsx';

const VISITS_KEY = 'cr-visits';
const SESSION_KEY = 'cr-visit-counted';
const EVERY = 3;

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const platform = () => {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
};

// Counts one visit per browser session and returns true on every 3rd visit.
function isPromptVisit() {
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return false;
    sessionStorage.setItem(SESSION_KEY, '1');
    const visits = (Number(localStorage.getItem(VISITS_KEY)) || 0) + 1;
    localStorage.setItem(VISITS_KEY, String(visits));
    return visits % EVERY === 0;
  } catch { return false; }
}

// The browser's install event can fire before React mounts, so main.jsx keeps it on window.
const deferredPrompt = () => window.__crInstallPrompt || null;

export default function InstallPrompt() {
  const [open, setOpen] = useState(false);
  const [canInstall, setCanInstall] = useState(() => Boolean(deferredPrompt()));
  const [kind] = useState(platform);

  useEffect(() => {
    if (isStandalone()) return undefined;
    const due = isPromptVisit();
    const onReady = () => setCanInstall(true);
    const onInstalled = () => setOpen(false);
    window.addEventListener('cr-install-ready', onReady);
    window.addEventListener('appinstalled', onInstalled);
    // On a computer, only offer it when the browser can install it with one click.
    const timer = due ? window.setTimeout(() => { if (kind !== 'desktop' || deferredPrompt()) setOpen(true); }, 2500) : 0;
    return () => { window.clearTimeout(timer); window.removeEventListener('cr-install-ready', onReady); window.removeEventListener('appinstalled', onInstalled); };
  }, [kind]);

  if (!open) return null;

  const install = async () => {
    const promptEvent = deferredPrompt();
    if (!promptEvent) return;
    promptEvent.prompt();
    try { await promptEvent.userChoice; } catch { }
    window.__crInstallPrompt = null;
    setOpen(false);
  };

  return (
    <aside className="install" role="dialog" aria-labelledby="install-title" aria-describedby="install-text">
      <button className="icon-button icon-button--quiet install__close" type="button" onClick={() => setOpen(false)} aria-label="Cerrar"><X size={18} /></button>
      <div className="install__head">
        <img src={LOGO.small} alt="" width="48" height="48" />
        <div>
          <h2 id="install-title">Instalá la app de CR</h2>
          <p id="install-text">Entrás directo desde la pantalla de inicio, sin buscar la página.</p>
        </div>
      </div>
      {canInstall ? (
        <button className="button button--gold button--wide" type="button" onClick={install}><Download size={17} /> Instalar app</button>
      ) : kind === 'ios' ? (
        <ol className="install__steps">
          <li>Tocá <Share size={16} aria-label="Compartir" /> <strong>Compartir</strong> en la barra de Safari.</li>
          <li>Elegí <PlusSquare size={16} aria-hidden="true" /> <strong>Agregar a inicio</strong>.</li>
          <li>Tocá <strong>Agregar</strong> arriba a la derecha.</li>
        </ol>
      ) : (
        <ol className="install__steps">
          <li>Abrí el menú <strong>⋮</strong> del navegador.</li>
          <li>Elegí <strong>Instalar app</strong> o <strong>Agregar a pantalla de inicio</strong>.</li>
        </ol>
      )}
      <button className="text-link install__later" type="button" onClick={() => setOpen(false)}>Ahora no</button>
    </aside>
  );
}
