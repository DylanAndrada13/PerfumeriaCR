// Meeting points (the customer proposes 3 dates) and the two shops (pickup during opening hours).
export const pickUpPoints = ['Coto Lanús', 'Ciclón Caraza', 'UPA Recondo', 'Maxi Carrefour', 'Santa Marta'];
export const localPickups = ['Local Itatí', 'Local La Haya'];
export const isLocalPickup = point => localPickups.includes(point);
// Meeting-point deliveries happen on Thursdays only. Dates as YYYY-MM-DD in Argentina (UTC-3 all year),
// from tomorrow on: the next `count` Thursdays.
export const PICKUP_WEEKDAY = 4;
export function pickupDateOptions(count = 8) {
  const today = new Date(Date.now() - 3 * 3600 * 1000);
  const dates = [];
  for (let offset = 1; dates.length < count && offset < 120; offset += 1) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset));
    if (day.getUTCDay() === PICKUP_WEEKDAY) dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}
export function formatPickupDate(isoDate, options = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Intl.DateTimeFormat('es-AR', { ...options, timeZone: 'UTC' }).format(new Date(`${isoDate}T12:00:00Z`));
}
export const CART_STORAGE = 'cr-perfumeria-cart-v1';

const formatters = new Map();
export function money(value) {
  const amount = Number(value) || 0;
  const digits = Number.isInteger(amount) ? 0 : 2;
  if (!formatters.has(digits)) {
    formatters.set(digits, new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: digits, maximumFractionDigits: 2 }));
  }
  return formatters.get(digits).format(amount);
}

export function readCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_STORAGE) || '[]');
    return Array.isArray(saved) ? saved.filter(line => line && line.id && Number(line.qty) > 0) : [];
  } catch { return []; }
}

export function saveCart(cart) {
  try { localStorage.setItem(CART_STORAGE, JSON.stringify(cart)); } catch { /* storage unavailable */ }
}

export const sameText = (a, b) => String(a || '').trim().toLocaleLowerCase('es') === String(b || '').trim().toLocaleLowerCase('es');
