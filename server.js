import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_CACHE, catalogErrorMessage, getCatalogFacets, getCatalogPage, getProductsByIds } from './lib/server-catalog.js';
import { createOrder, mercadoPagoWebhook, orderStatus, adminLogin, adminOrders, adminOrderAction, myOrders, paymentOptions, sellerRecentPayments, reconcilePendingOrders } from './lib/order-api.js';
import { signUp } from './lib/auth-api.js';
import { pushPublicKey, subscribePush, unsubscribePush, orderStatusPush } from './lib/push.js';
import { startMercadoPagoConnect, mercadoPagoOAuthCallback, mercadoPagoConnectionStatus } from './lib/mercadopago-oauth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, '.env.local')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const app = express();
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || '127.0.0.1';

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.post('/api/auth/signup', signUp);
app.post('/api/orders/create', createOrder);
app.get('/api/orders/status', orderStatus);
app.get('/api/orders/mine', myOrders);
app.post('/api/admin/order-action', adminOrderAction);
app.post('/api/orders/webhook', mercadoPagoWebhook);
app.post('/api/admin/login', adminLogin);
app.get('/api/admin/orders', adminOrders);
app.get('/api/admin/mp/connect', startMercadoPagoConnect);
app.get('/api/admin/mp/status', mercadoPagoConnectionStatus);
app.get('/api/admin/mp/payments', sellerRecentPayments);
app.get('/api/payments/options', paymentOptions);
app.get('/api/push/key', pushPublicKey);
app.post('/api/push/subscribe', subscribePush);
app.post('/api/push/unsubscribe', unsubscribePush);
app.post('/api/push/order-status', orderStatusPush);
app.all('/api/orders/reconcile', reconcilePendingOrders);
app.get('/api/mp/oauth/callback', mercadoPagoOAuthCallback);
app.get('/api/catalog/products', async (request, response) => {
  try {
    const result = request.query.ids
      ? { products: await getProductsByIds(String(request.query.ids).split(',')) }
      : await getCatalogPage(request.query);
    response.set('Cache-Control', CATALOG_CACHE).json(result);
  } catch (error) {
    response.set('Cache-Control', 'no-store').status(error.status || 502).json({ error: catalogErrorMessage(error) });
  }
});
app.get('/api/catalog/facets', async (_request, response) => {
  try {
    response.set('Cache-Control', 'public, max-age=120').json(await getCatalogFacets());
  } catch (error) {
    response.set('Cache-Control', 'no-store').status(error.status || 502).json({ error: catalogErrorMessage(error) });
  }
});

if (process.argv.includes('--production')) {
  app.use(express.static(path.join(here, 'dist'), { index: false }));
  app.get('*', (_request, response) => response.sendFile(path.join(here, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(port, host, () => console.log(`CR tienda disponible en http://localhost:${port}`));
