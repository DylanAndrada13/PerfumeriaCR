import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { money, pickupLabel, formatPickupDate } from '../lib/format.js';

// Purchase ticket for a thermal printer (Xprinter XP-58 / XP-80 and similar).
// The ticket is a small HTML page rendered in an iframe at real paper width. The same iframe is
// what gets printed through the Windows printer driver, so the preview is exactly what comes out.
// A thermal printer prints a raster image of the page: fonts, lines and the logo all print, in black only.

export const PAPERS = {
  58: { paper: 58, printable: 48, font: 11 },
  80: { paper: 80, printable: 72, font: 12.5 },
};
const PREFS_KEY = 'cr-ticket-prefs-v1';
const MM_PER_PX = 25.4 / 96;

export function readTicketPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { width: PAPERS[saved.width] ? Number(saved.width) : 58, logo: saved.logo !== false };
  } catch { return { width: 58, logo: true }; }
}
function saveTicketPrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// The brand logo is gold on a black disc; printed as-is it would come out as a solid black circle.
// Turn it into a 1-bit image: the bright gold strokes become black, the dark background becomes white paper.
let logoCache = null;
export function thermalLogo(src = '/brand/logo-384.png') {
  if (!logoCache) {
    logoCache = new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const size = 256;
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, size, size);
          const data = ctx.getImageData(0, 0, size, size);
          const px = data.data;
          for (let i = 0; i < px.length; i += 4) {
            const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            const ink = px[i + 3] > 128 && lum > 105;
            const v = ink ? 0 : 255;
            px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
          }
          ctx.putImageData(data, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch { resolve(''); }
      };
      img.onerror = () => resolve('');
      img.src = src;
    });
  }
  return logoCache;
}

const PAYMENT_STATUS = { paid: 'PAGADO', failed: 'RECHAZADO', pending: 'PENDIENTE' };

export function ticketHtml(order, { width = 58, logo = '' } = {}) {
  const paper = PAPERS[width] || PAPERS[58];
  const side = (paper.paper - paper.printable) / 2;
  const created = order.created_at ? new Date(order.created_at) : new Date();
  const date = created.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
  const time = created.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
  const items = order.web_order_items || [];
  const units = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const cash = order.payment_method === 'efectivo';
  const paid = order.payment_status === 'paid';
  const payment = cash ? 'Efectivo al retirar' : 'Mercado Pago';
  const payState = paid ? 'PAGADO' : cash ? 'A COBRAR' : (PAYMENT_STATUS[order.payment_status] || 'PENDIENTE');
  const dates = (order.pickup_dates || []).map(d => formatPickupDate(d)).join(' / ');

  const rows = items.map(item => {
    const qty = Number(item.quantity) || 0;
    const unit = Number(item.unit_price) || 0;
    const line = item.line_total != null ? Number(item.line_total) : unit * qty;
    return `<div class="item"><div class="item__name">${esc(item.product_name)}</div>
      <div class="row row--money"><span>${qty} x ${esc(money(unit))}</span><span>${esc(money(line))}</span></div></div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Ticket ${esc(order.order_number)}</title>
<style id="page-size">@page { size: ${paper.paper}mm 200mm; margin: 0; }</style>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; color: #000; overflow: hidden; }
  body { width: ${paper.paper}mm; padding: 3mm ${side}mm 6mm; font: 600 ${paper.font}px/1.35 Arial, Helvetica, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .center { text-align: center; }
  .logo { display: block; width: ${width === 80 ? 30 : 24}mm; height: auto; margin: 0 auto 2mm; image-rendering: pixelated; }
  .shop { font-size: 1.25em; font-weight: 800; letter-spacing: .02em; }
  .muted { font-weight: 500; }
  .big { font-size: 1.55em; font-weight: 800; letter-spacing: .03em; }
  hr { border: 0; border-top: 1.5px dashed #000; margin: 2mm 0; }
  hr.solid { border-top: 2px solid #000; }
  .row { display: flex; justify-content: space-between; gap: 2mm; }
  .row span:first-child { flex: none; }
  .row span:last-child { min-width: 0; text-align: right; overflow-wrap: anywhere; }
  .row--money span:last-child { flex: none; white-space: nowrap; }
  .label { font-weight: 500; }
  .item { margin: 1.2mm 0; }
  .item__name { font-weight: 700; word-break: break-word; }
  .total { font-size: 1.45em; font-weight: 800; }
  .badge { display: inline-block; margin-top: 1.5mm; padding: .6mm 2mm; border: 2px solid #000; font-weight: 800; letter-spacing: .06em; }
  .badge--solid { background: #000; color: #fff; }
  .note { margin-top: 1.5mm; word-break: break-word; }
  .legal { margin-top: 2mm; font-size: .85em; font-weight: 500; }
</style></head><body>
  <div class="center">
    ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
    <div class="shop">CR PERFUMERÍA &amp; LIMPIEZA</div>
    <div class="muted">Tienda online</div>
  </div>
  <hr class="solid">
  <div class="center"><div class="label">PEDIDO</div><div class="big">${esc(order.order_number)}</div></div>
  <div class="row"><span class="label">Fecha</span><span>${esc(date)} ${esc(time)}</span></div>
  <hr>
  <div class="row"><span class="label">Cliente</span><span>${esc(order.customer_name || '-')}</span></div>
  ${order.customer_phone ? `<div class="row"><span class="label">Tel.</span><span>${esc(order.customer_phone)}</span></div>` : ''}
  <div class="row"><span class="label">Retiro</span><span>${esc(pickupLabel(order.pickup_point) || '-')}</span></div>
  ${dates ? `<div class="row"><span class="label">Fechas</span><span>${esc(dates)}</span></div>` : ''}
  <hr>
  ${rows || '<div class="center muted">Sin productos</div>'}
  <hr class="solid">
  <div class="row"><span class="label">Artículos</span><span>${units}</span></div>
  <div class="row row--money total"><span>TOTAL</span><span>${esc(money(order.total_amount))}</span></div>
  <hr>
  <div class="row"><span class="label">Pago</span><span>${esc(payment)}</span></div>
  <div class="center"><span class="badge ${paid ? 'badge--solid' : ''}">${esc(payState)}</span></div>
  ${order.customer_note ? `<hr><div class="note"><span class="label">Nota:</span> ${esc(order.customer_note)}</div>` : ''}
  <hr>
  <div class="center">¡Gracias por tu compra!</div>
  <div class="center legal">Comprobante de pedido. No válido como factura.</div>
</body></html>`;
}

// Size the printed page to the ticket's real length so the PDF / printer cut lands right after the text.
function fitPage(frame, width) {
  const doc = frame?.contentDocument;
  if (!doc?.body) return 0;
  const heightPx = Math.ceil(doc.documentElement.scrollHeight);
  const heightMm = Math.ceil(heightPx * MM_PER_PX) + 2;
  const style = doc.getElementById('page-size');
  if (style) style.textContent = `@page { size: ${PAPERS[width].paper}mm ${heightMm}mm; margin: 0; }`;
  return heightPx;
}

export default function OrderTicket({ order, onBack }) {
  const [prefs, setPrefs] = useState(readTicketPrefs);
  const [logo, setLogo] = useState('');
  const [height, setHeight] = useState(400);
  const frame = useRef(null);

  useEffect(() => { saveTicketPrefs(prefs); }, [prefs]);
  useEffect(() => {
    let alive = true;
    if (prefs.logo) thermalLogo().then(url => { if (alive) setLogo(url); });
    return () => { alive = false; };
  }, [prefs.logo]);

  const html = ticketHtml(order, { width: prefs.width, logo: prefs.logo ? logo : '' });
  const onLoad = () => {
    const doc = frame.current?.contentDocument;
    const measure = () => setHeight(fitPage(frame.current, prefs.width) || 400);
    measure();
    doc?.querySelectorAll('img').forEach(img => { if (!img.complete) img.addEventListener('load', measure, { once: true }); });
  };
  const print = () => {
    fitPage(frame.current, prefs.width);
    frame.current?.contentWindow?.focus();
    frame.current?.contentWindow?.print();
  };

  return (
    <div className="ticket-view">
      <div className="ticket-view__bar">
        <button className="button button--ghost button--small" type="button" onClick={onBack}><ArrowLeft size={15} /> Volver a pedidos</button>
        <button className="button button--gold button--small" type="button" onClick={print}><Printer size={15} /> Imprimir</button>
      </div>
      <div className="ticket-view__options">
        <div className="admin__filters" role="radiogroup" aria-label="Ancho del papel">
          {Object.keys(PAPERS).map(w => (
            <button key={w} type="button" role="radio" aria-checked={prefs.width === Number(w)} className={`chip ${prefs.width === Number(w) ? 'is-selected' : ''}`} onClick={() => setPrefs(p => ({ ...p, width: Number(w) }))}>Papel {w} mm</button>
          ))}
        </div>
        <label className="ticket-view__check"><input type="checkbox" checked={prefs.logo} onChange={e => setPrefs(p => ({ ...p, logo: e.target.checked }))} /> Logo</label>
      </div>
      <div className="ticket-view__paper">
        <iframe ref={frame} title={`Ticket ${order.order_number}`} srcDoc={html} onLoad={onLoad} scrolling="no"
          style={{ width: `${PAPERS[prefs.width].paper}mm`, height: `${height}px` }} />
      </div>
      <p className="note">Vista a tamaño real. Sin impresora, elegí “Guardar como PDF” en el diálogo de impresión para revisar el resultado. Con la Xprinter: elegila como impresora, papel {prefs.width} mm y márgenes “Ninguno”.</p>
    </div>
  );
}
