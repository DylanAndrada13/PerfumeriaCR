import { signUp } from '../lib/auth-api.js';
import { orderStatusPush, pushPublicKey, subscribePush, unsubscribePush } from '../lib/push.js';
import {
  adminLogin,
  adminOrderAction,
  adminOrders,
  createOrder,
  mercadoPagoWebhook,
  myOrders,
  orderStatus,
  paymentOptions,
  reconcilePendingOrders,
  sellerRecentPayments,
} from '../lib/order-api.js';
import {
  mercadoPagoOAuthCallback,
  mercadoPagoConnectionStatus,
  startMercadoPagoConnect,
} from '../lib/mercadopago-oauth.js';
import {
  CATALOG_CACHE,
  catalogErrorMessage,
  getCatalogPage,
  getProductsByIds,
  getCatalogFacets,
} from '../lib/server-catalog.js';

const handlers = {
  'admin/login': adminLogin,
  'admin/order-action': adminOrderAction,
  'admin/orders': adminOrders,
  'admin/mp/connect': startMercadoPagoConnect,
  'admin/mp/status': mercadoPagoConnectionStatus,
  'admin/mp/payments': sellerRecentPayments,
  'payments/options': paymentOptions,
  'push/key': pushPublicKey,
  'push/subscribe': subscribePush,
  'push/unsubscribe': unsubscribePush,
  'push/order-status': orderStatusPush,
  'auth/signup': signUp,
  'catalog/facets': handleCatalogFacets,
  'catalog/products': handleCatalogProducts,
  'mp/oauth/callback': mercadoPagoOAuthCallback,
  'orders/create': createOrder,
  'orders/mine': myOrders,
  'orders/reconcile': reconcilePendingOrders,
  'orders/status': orderStatus,
  'orders/webhook': mercadoPagoWebhook,
};

export default async function handler(request, response) {
  const route = getRoute(request);
  const routeHandler = handlers[route];

  if (!routeHandler) {
    return response.status(404).json({ error: 'Ruta no encontrada.' });
  }

  return routeHandler(request, response);
}

function getRoute(request) {
  const routed = request.query?.route;
  if (routed) return Array.isArray(routed) ? routed.join('/') : String(routed);

  const urlPath = String(request.url || '').split('?')[0];
  const fromUrl = urlPath.replace(/^\/api\/?/, '').replace(/\/$/, '');
  if (fromUrl) return decodeURIComponent(fromUrl);

  return '';
}

async function handleCatalogProducts(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const query = request.query || {};
    const result = query.ids
      ? { products: await getProductsByIds(String(query.ids).split(',')) }
      : await getCatalogPage(query);
    response.setHeader('Cache-Control', CATALOG_CACHE);
    return response.status(200).json(result);
  } catch (error) {
    response.setHeader('Cache-Control', 'no-store');
    return response.status(error.status || 502).json({ error: catalogErrorMessage(error) });
  }
}

async function handleCatalogFacets(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const result = await getCatalogFacets();
    response.setHeader('Cache-Control', CATALOG_CACHE);
    return response.status(200).json(result);
  } catch (error) {
    response.setHeader('Cache-Control', 'no-store');
    return response.status(error.status || 502).json({ error: catalogErrorMessage(error) });
  }
}
