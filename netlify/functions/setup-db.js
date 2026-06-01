// ═══════════════════════════════════════════════════════════
// One-time database setup — visit /api/setup-db?secret=SETUP_SECRET
// Creates all tables and admin account
// ═══════════════════════════════════════════════════════════
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function runSQL(sql) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

async function supabaseQuery(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, opts);
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, data: JSON.parse(text) }; }
  catch { return { ok: r.ok, status: r.status, data: text }; }
}

exports.handler = async function(event) {
  const secret = event.queryStringParameters?.secret;
  if (secret !== process.env.SETUP_SECRET) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const logs = [];

  try {
    // ── Create users table
    const createUsers = await supabaseQuery('users?select=id&limit=1');
    if (!createUsers.ok) {
      logs.push('Users table needs creation — use Supabase SQL editor');
    } else {
      logs.push('Users table exists ✓');
    }

    // ── Create admin if not exists
    const adminCheck = await supabaseQuery('users?email=eq.avishnoi.cse%40geu.ac.in&select=id');
    if (adminCheck.ok && Array.isArray(adminCheck.data) && adminCheck.data.length === 0) {
      const hashed = await bcrypt.hash('GEU@Claude2026#Admin', 12);
      const adminInsert = await supabaseQuery('users', 'POST', {
        id: uuidv4(),
        name: 'Dr. Ankit Vishnoi',
        email: 'avishnoi.cse@geu.ac.in',
        password: hashed,
        role: 'admin',
        status: 'approved',
        verified: true,
        course: 'N/A', department: 'Computer Science', branch: 'CSE',
        section: 'N/A', semester: 'N/A', enrollment_no: 'ADMIN001',
        roll_no: 'ADMIN', college: 'Graphic Era Deemed to be University',
        created_at: new Date().toISOString(),
      });
      logs.push(adminInsert.ok ? 'Admin account created ✓' : `Admin creation failed: ${JSON.stringify(adminInsert.data)}`);
    } else {
      logs.push('Admin account already exists ✓');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, logs }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message, logs }) };
  }
};
