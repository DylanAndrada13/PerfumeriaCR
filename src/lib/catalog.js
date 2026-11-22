import { useCallback, useEffect, useRef, useState } from 'react';

export const PAGE_SIZE = 20;
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

function normalize(product) {
  return { ...product, price: Number(product.price) || 0, inStock: Boolean(product.inStock) };
}

async function getJson(url, signal) {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.data;
  const response = await fetch(url, { signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se pudo cargar el catálogo.');
  cache.set(url, { data, expires: Date.now() + CACHE_TTL_MS });
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  return data;
}

export const DEFAULT_FILTERS = { q: '', category: '', brand: '', sort: 'name', inStock: false, page: 1 };
const SORTS = ['name', 'recent', 'price-low', 'price-high'];

// Filters live in the address bar so a filtered page can be shared or reloaded.
export function filtersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    q: (params.get('buscar') || '').slice(0, 60),
    category: params.get('categoria') || '',
    brand: params.get('marca') || '',
    sort: SORTS.includes(params.get('orden')) ? params.get('orden') : 'name',
    inStock: params.get('stock') === '1',
    page: Math.max(1, Number.parseInt(params.get('pagina'), 10) || 1),
  };
}

export function writeFiltersToUrl(filters) {
  const url = new URL(window.location.href);
  const set = (key, value) => { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); };
  set('buscar', filters.q.trim());
  set('categoria', filters.category);
  set('marca', filters.brand);
  set('orden', filters.sort !== 'name' ? filters.sort : '');
  set('stock', filters.inStock ? '1' : '');
  set('pagina', filters.page > 1 ? String(filters.page) : '');
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
}

function catalogUrl(filters) {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: String(PAGE_SIZE), sort: filters.sort });
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.category) params.set('category', filters.category);
  if (filters.brand) params.set('brand', filters.brand);
  if (filters.inStock) params.set('inStock', '1');
  return `/api/catalog/products?${params}`;
}

export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useCatalogPage(filters) {
  const [state, setState] = useState({ status: 'loading', products: [], total: 0, totalPages: 1, error: '' });
  const [attempt, setAttempt] = useState(0);
  const url = catalogUrl(filters);
  useEffect(() => {
    const controller = new AbortController();
    setState(current => ({ ...current, status: 'loading', error: '' }));
    getJson(url, controller.signal)
      .then(data => setState({ status: 'ready', products: (data.products || []).map(normalize), total: data.total || 0, totalPages: data.totalPages || 1, error: '' }))
      .catch(error => { if (error.name !== 'AbortError') setState(current => ({ ...current, status: 'error', error: error.message })); });
    return () => controller.abort();
  }, [url, attempt]);
  const retry = useCallback(() => { cache.delete(url); setAttempt(n => n + 1); }, [url]);
  return { ...state, retry };
}

export function useFacets() {
  const [facets, setFacets] = useState({ categories: [], brands: [], total: 0 });
  useEffect(() => {
    const controller = new AbortController();
    getJson('/api/catalog/facets', controller.signal).then(setFacets).catch(() => {});
    return () => controller.abort();
  }, []);
  return facets;
}

export function useShowcase() {
  const [products, setProducts] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    getJson('/api/catalog/products?page=1&pageSize=3&sort=recent&withImage=1&inStock=1', controller.signal)
      .then(data => setProducts((data.products || []).map(normalize)))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return products;
}

// Re-reads the products in the cart (one request for all of them) so names, prices and stock stay current.
export function useFreshProducts(ids, enabled) {
  const [fresh, setFresh] = useState({});
  const key = [...new Set(ids)].sort().join(',');
  const lastKey = useRef('');
  useEffect(() => {
    if (!enabled || !key || key === lastKey.current) return undefined;
    const controller = new AbortController();
    fetch(`/api/catalog/products?ids=${encodeURIComponent(key)}`, { signal: controller.signal })
      .then(response => (response.ok ? response.json() : Promise.reject(new Error('stale'))))
      .then(data => {
        lastKey.current = key;
        const found = Object.fromEntries((data.products || []).map(product => [product.id, normalize(product)]));
        const missing = Object.fromEntries(key.split(',').filter(id => !found[id]).map(id => [id, { missing: true }]));
        setFresh({ ...missing, ...found });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [key, enabled]);
  return fresh;
}
