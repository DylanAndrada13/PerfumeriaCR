import { catalogErrorMessage, getCatalogFacets } from '../../lib/server-catalog.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Método no permitido.' });
  }
  try {
    const facets = await getCatalogFacets();
    response.setHeader('Cache-Control', 'public, max-age=120, s-maxage=300, stale-while-revalidate=900');
    return response.status(200).json(facets);
  } catch (error) {
    response.setHeader('Cache-Control', 'no-store');
    return response.status(error.status || 502).json({ error: catalogErrorMessage(error) });
  }
}
