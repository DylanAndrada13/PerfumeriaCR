import { CATALOG_CACHE, catalogErrorMessage, getCatalogPage, getProductsByIds } from '../../lib/server-catalog.js';

export default async function handler(request, response) {
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
