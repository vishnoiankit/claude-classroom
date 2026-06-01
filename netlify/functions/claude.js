// /api/claude — Anthropic API proxy (requires valid JWT)
const { rateLimit, err, preflight, CORS, verifyToken, extractToken } = require('./_utils');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');

  const token = extractToken(event);
  if (!token) return err(401, 'Login required to use the lab');
  const { valid, payload } = verifyToken(token);
  if (!valid) return err(401, 'Session expired. Please log in again');

  const rl = rateLimit(payload.sub, 'claude-api', 30, 60 * 1000);
  if (rl.limited) return err(429, `Rate limit hit. Retry in ${rl.retryAfter}s`);

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return err(500, 'ANTHROPIC_API_KEY not configured');

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }
  if (!body.messages || !Array.isArray(body.messages)) return err(400, 'messages array required');
  if (body.messages.length > 50) return err(400, 'Too many messages');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-5',
        max_tokens: Math.min(body.max_tokens || 1000, 2000),
        system: (body.system || '').slice(0, 4000),
        messages: body.messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content).slice(0, 8000) })),
      }),
    });
    const data = await response.json();
    return { statusCode: response.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  } catch (e) {
    return err(502, 'Upstream API error: ' + e.message);
  }
};
