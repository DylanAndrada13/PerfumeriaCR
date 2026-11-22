// Read-only access to the shared shop_products table. Nothing here writes to the database.
const COLUMNS = 'barcode,name,brand,category,quantity,image_url,price,stock,updated_at';
const MAX_PAGE_SIZE = 48;
const DEFAULT_PAGE_SIZE = 20;
const FACETS_TTL_MS = 5 * 60 * 1000;
// The shop only lists products that have a photo and a price. The rows stay in shop_products untouched
// (gestión still sees them); they reappear here as soon as gestión gives them a photo and a price.
const VISIBLE = [['image_url', 'like.http*'], ['price', 'gt.0']];
const onlyVisible = params => { for (const [column, rule] of VISIBLE) params.append(column, rule); return params; };

const SORTS = {
  name: 'name.asc,barcode.asc',
  recent: 'updated_at.desc.nullslast,barcode.asc',
  'price-low': 'price.asc,name.asc,barcode.asc',
  'price-high': 'price.desc,name.asc,barcode.asc',
};

function configuration() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw Object.assign(new Error('Missing Supabase server configuration'), { status: 503 });
  return { url, key };
}

async function select(params, { count = false } = {}) {
  const { url, key } = configuration();
  const headers = {
    apikey: key,
    Accept: 'application/json',
    ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
    ...(count ? { Prefer: 'count=exact' } : {}),
  };
  const response = await fetch(`${url}/rest/v1/shop_products?${params}`, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
  const rows = await response.json();
  const total = count ? Number((response.headers.get('content-range') || '').split('/')[1]) : undefined;
  return { rows: Array.isArray(rows) ? rows : [], total: Number.isFinite(total) ? total : undefined };
}

function toProduct(row, includeInventory = false) {
  return {
    id: row.barcode,
    barcode: row.barcode,
    name: row.name,
    brand: row.brand || '',
    category: (row.category || '').trim(),
    quantity: row.quantity || '',
    image: row.image_url || '',
    price: Number(row.price) || 0,
    inStock: Number(row.stock) > 0,
    ...(includeInventory ? { stock: Number(row.stock) || 0 } : {}),
    updatedAt: row.updated_at || null,
  };
}

// PostgREST reserves , ( ) * " \ inside filter values; strip them so a search can never alter the query.
const cleanTerm = value => String(value || '').replace(/[,()*"\\:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const quoted = value => `"${String(value).replace(/["\\]/g, '')}"`;

export function parseCatalogQuery(query = {}) {
  const page = Math.max(1, Math.min(500, Number.parseInt(query.page, 10) || 1));
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Number.parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const sort = SORTS[query.sort] ? query.sort : 'name';
  return {
    page,
    pageSize,
    sort,
    q: cleanTerm(query.q),
    category: String(query.category || '').trim().slice(0, 80),
    brand: String(query.brand || '').trim().slice(0, 80),
    inStock: query.inStock === '1' || query.inStock === 'true',
    withImage: query.withImage === '1',
  };
}

export async function getCatalogPage(options) {
  const { page, pageSize, sort, q, category, brand, inStock, withImage } = parseCatalogQuery(options);
  const params = new URLSearchParams({
    select: COLUMNS,
    order: SORTS[sort],
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  // ilike without wildcards = case-insensitive equality, so "Aerosol" and "aerosol" are one category.
  if (category) params.append('category', `ilike.${category.replace(/[*%]/g, '')}`);
  if (brand) params.append('brand', `ilike.${brand.replace(/[*%]/g, '')}`);
  if (inStock) params.append('stock', 'gt.0');
  if (q) {
    // Each word must appear in the name, brand, category or barcode.
    const words = q.split(' ').filter(Boolean).slice(0, 5);
    const groups = words.map(word => `or(name.ilike.*${word}*,brand.ilike.*${word}*,category.ilike.*${word}*,barcode.ilike.*${word}*)`);
    params.append('and', `(${groups.join(',')})`);
  }
  onlyVisible(params);
  const { rows, total = rows.length } = await select(params, { count: true });
  return {
    products: rows.map(row => toProduct(row)),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getProductsByIds(ids, { includeInventory = false } = {}) {
  const unique = [...new Set((ids || []).map(id => String(id).trim()).filter(id => id && id.length <= 64))].slice(0, 60);
  if (!unique.length) return [];
  const params = new URLSearchParams({ select: COLUMNS, barcode: `in.(${unique.map(quoted).join(',')})`, limit: String(unique.length) });
  const { rows } = await select(params);
  return rows.map(row => toProduct(row, includeInventory));
}

let facetsCache = null;
export async function getCatalogFacets() {
  if (facetsCache && facetsCache.expires > Date.now()) return facetsCache.value;
  const rows = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const params = onlyVisible(new URLSearchParams({ select: 'category,brand', order: 'barcode.asc', limit: '1000', offset: String(offset) }));
    const { rows: page } = await select(params);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  // Group spellings that differ only in case; show the most used spelling (capitalised on a tie).
  const group = () => new Map();
  const add = (map, label, extra) => {
    const key = label.toLocaleLowerCase('es');
    const entry = map.get(key) || { spellings: new Map(), count: 0, ...extra() };
    entry.count += 1;
    entry.spellings.set(label, (entry.spellings.get(label) || 0) + 1);
    map.set(key, entry);
    return entry;
  };
  const label = entry => [...entry.spellings].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  const categories = group();
  const brands = group();
  for (const row of rows) {
    const category = (row.category || '').trim();
    const brand = (row.brand || '').trim();
    if (category) add(categories, category, () => ({}));
    if (brand) {
      const entry = add(brands, brand, () => ({ categoryKeys: new Set() }));
      if (category) entry.categoryKeys.add(category.toLocaleLowerCase('es'));
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name, 'es');
  const categoryName = new Map([...categories].map(([key, entry]) => [key, label(entry)]));
  const value = {
    total: rows.length,
    categories: [...categories.values()].map(entry => ({ name: label(entry), count: entry.count })).sort(byName),
    brands: [...brands.values()].map(entry => ({ name: label(entry), count: entry.count, categories: [...entry.categoryKeys].map(key => categoryName.get(key)) })).sort(byName),
  };
  // A few recent in-stock products with photos for the home page, cached together with the facets.
  const showcaseParams = onlyVisible(new URLSearchParams({ select: COLUMNS, stock: 'gt.0', order: SORTS.recent, limit: '3' }));
  value.showcase = (await select(showcaseParams)).rows.map(row => toProduct(row));
  facetsCache = { value, expires: Date.now() + FACETS_TTL_MS };
  return value;
}

export function catalogErrorMessage(error) {
  return error?.status === 503
    ? 'El catálogo todavía no está conectado.'
    : 'No se pudo cargar el catálogo. Volvé a intentar en unos minutos.';
}

// Short shared cache: the CDN answers repeated requests, so Supabase is queried at most once a minute per filter.
export const CATALOG_CACHE = 'public, max-age=30, s-maxage=60, stale-while-revalidate=300';
