import { getPublicCatalog } from '../../lib/server-catalog.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Método no permitido.' });
  }
  try {
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({ products: await getPublicCatalog() });
  } catch (error) {
    response.setHeader('Cache-Control', 'no-store');
    return response.status(error.status || 502).json({
      error: error.status === 503
        ? 'El catálogo todavía no está conectado.'
        : 'No se pudo cargar el catálogo. Volvé a intentar en unos minutos.',
    });
  }
}
