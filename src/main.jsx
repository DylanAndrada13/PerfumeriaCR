import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// Keep the browser's install offer so the install notice can use it later.
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  window.__crInstallPrompt = event;
  window.dispatchEvent(new Event('cr-install-ready'));
});

// Keep the page fixed on phones: no pinch zoom (iOS Safari ignores user-scalable=no) and no double-tap zoom.
document.addEventListener('gesturestart', event => event.preventDefault(), { passive: false });
document.addEventListener('dblclick', event => { if (event.target.closest?.('button, a')) event.preventDefault(); }, { passive: false });

createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>,
);
