// /api/claude — Groq API proxy (requires valid JWT)
const { rateLimit, err, preflight, CORS, verifyToken, extractToken } = require('./_utils');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');

  // ── Auth check
  const token = extractToken(event);
  if (!token) return err(401, 'Login required to use the lab');
  const { valid, payload } = verifyToken(token);
  if (!valid) return err(401, 'Session expired. Please log in again');

  // ── Rate limit per user
  const rl = rateLimit(payload.sub, 'groq-api', 30, 60 * 1000);
  if (rl.limited) return err(429, `Rate limit hit. Retry in ${rl.retryAfter}s`);

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return err(500, 'GROQ_API_KEY not configured in environment variables');

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }
  if (!body.messages || !Array.isArray(body.messages)) return err(400, 'messages array required');
  if (body.messages.length > 50) return err(400, 'Too many messages');

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: Math.min(body.max_tokens || 1000, 2000),
        messages: [
          // Groq uses OpenAI format — system message goes first
          ...(body.system ? [{ role: 'system', content: body.system.slice(0, 4000) }] : []),
          ...body.messages.map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: String(m.content).slice(0, 8000),
          })),
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || JSON.stringify(data.error) || 'Groq API error ' + response.status;
      return err(response.status, errMsg);
    }

    // ── Convert Groq OpenAI format → Anthropic format so frontend works unchanged
    const content = data.choices?.[0]?.message?.content || 'No response received.';
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: [{ type: 'text', text: content }],
        model: data.model,
        usage: data.usage,
      }),
    };
  } catch (e) {
    return err(502, 'Groq API error: ' + e.message);
  }
};
