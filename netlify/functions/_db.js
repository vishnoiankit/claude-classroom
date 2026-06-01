// ═══════════════════════════════════════════════════════════
// Supabase database client — used by all functions
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function db(table) {
  const base = `${SUPABASE_URL}/rest/v1/${table}`;
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  return {
    async select(query = '*', filters = {}) {
      let url = `${base}?select=${query}`;
      Object.entries(filters).forEach(([k, v]) => url += `&${k}=eq.${encodeURIComponent(v)}`);
      const r = await fetch(url, { headers });
      return r.json();
    },
    async selectOne(query = '*', filters = {}) {
      let url = `${base}?select=${query}&limit=1`;
      Object.entries(filters).forEach(([k, v]) => url += `&${k}=eq.${encodeURIComponent(v)}`);
      const r = await fetch(url, { headers });
      const rows = await r.json();
      return Array.isArray(rows) ? rows[0] || null : null;
    },
    async insert(data) {
      const r = await fetch(base, {
        method: 'POST', headers,
        body: JSON.stringify(data),
      });
      const result = await r.json();
      return { ok: r.ok, data: Array.isArray(result) ? result[0] : result, status: r.status };
    },
    async update(data, filters = {}) {
      let url = base + '?';
      Object.entries(filters).forEach(([k, v]) => url += `${k}=eq.${encodeURIComponent(v)}&`);
      const r = await fetch(url, {
        method: 'PATCH', headers,
        body: JSON.stringify(data),
      });
      const result = await r.json();
      return { ok: r.ok, data: Array.isArray(result) ? result[0] : result };
    },
    async delete(filters = {}) {
      let url = base + '?';
      Object.entries(filters).forEach(([k, v]) => url += `${k}=eq.${encodeURIComponent(v)}&`);
      const r = await fetch(url, { method: 'DELETE', headers });
      return { ok: r.ok };
    },
    async rpc(fn, params = {}) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers,
        body: JSON.stringify(params),
      });
      return r.json();
    }
  };
}

module.exports = { db };
