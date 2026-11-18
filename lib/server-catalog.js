const pageSize = 1000;

function configuration() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw Object.assign(new Error('Missing Supabase server configuration'), { status: 503 });
  return { url, key };
}

async function requestPage(url, key, offset) {
  const headers = {
    apikey: key,
    Accept: 'application/json',
    ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
  };
  const params = new URLSearchParams({
    select: 'barcode,name,brand,category,quantity,image_url,price,stock,updated_at',
    order: 'name.asc,barcode.asc',
    limit: String(pageSize),
    offset: String(offset),
  });
  const response = await fetch(`${url}/rest/v1/shop_products?${params}`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
  return response.json();
}

export async function getPublicCatalog({ includeInventory = false } = {}) {
  const { url, key } = configuration();
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await requestPage(url, key, offset);
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows.map(row => ({
    id: row.barcode,
    barcode: row.barcode,
    name: row.name,
    brand: row.brand || '',
    category: row.category || '',
    quantity: row.quantity || '',
    image: row.image_url || '',
    price: Number(row.price) || 0,
    inStock: Number(row.stock) > 0,
    ...(includeInventory ? { stock: Number(row.stock) || 0 } : {}),
    updatedAt: row.updated_at || null,
  }));
}
