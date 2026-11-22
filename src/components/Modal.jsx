import { useEffect, useRef } from 'react';

let openCount = 0;

// Shared shell for every dialog: closes on Escape or a click outside, locks page scroll, returns focus.
export default function Modal({ onClose, variant = 'center', labelledBy, className = '', children }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    openCount += 1;
    document.documentElement.classList.add('has-modal');
    const onKey = event => { if (event.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    const first = panel.current?.querySelector('input:not([type="hidden"])') || panel.current;
    first?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      openCount -= 1;
      if (openCount <= 0) { openCount = 0; document.documentElement.classList.remove('has-modal'); }
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className={`modal modal--${variant}`} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panel} tabIndex={-1} className={`modal__panel ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </section>
    </div>
  );
}
