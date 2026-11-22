export const pickUpPoints = ['Coto Lanús', 'Ciclón Caraza', 'UPA Recondo', 'Maxi Carrefour', 'Santa Marta'];
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
