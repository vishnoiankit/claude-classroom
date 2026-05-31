// ═══════════════════════════════════════════════════════════
// Shared utilities for all Netlify auth functions
// ═══════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_IN_PRODUCTION';
const JWT_EXPIRES = '7d';

// ── In-memory rate limiter (resets on function cold start)
// For production, use Redis/Upstash. This covers most abuse.
const rateLimitStore = new Map();

function rateLimit(ip, action, max, windowMs) {
  const key = `${ip}:${action}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };

  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }

  entry.count++;
  rateLimitStore.set(key, entry);

  if (entry.count > max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { limited: true, retryAfter };
  }
  return { limited: false };
}

// ── CORS headers
const CORS = {
  'Access-Control-Allow-Origin': process.env.SITE_URL || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
};

function respond(statusCode, body, extra = {}) {
  return { statusCode, headers: { ...CORS, ...extra }, body: JSON.stringify(body) };
}

function ok(body) { return respond(200, body); }
function err(code, msg) { return respond(code, { error: msg }); }

function preflight() {
  return { statusCode: 204, headers: CORS, body: '' };
}

// ── JWT helpers
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try { return { valid: true, payload: jwt.verify(token, JWT_SECRET) }; }
  catch (e) { return { valid: false, error: e.message }; }
}

function extractToken(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

// ── Password helpers
async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

async function checkPassword(plain, hashed) {
  return bcrypt.compare(plain, hashed);
}

// ── Input sanitisation
function sanitise(str, maxLen = 255) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen).replace(/[<>]/g, '');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function isStrongPassword(pw) {
  // Min 8 chars, 1 uppercase, 1 lowercase, 1 digit
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw);
}

// ── Get real IP (works behind Netlify CDN)
function getIP(event) {
  return (
    event.headers?.['x-nf-client-connection-ip'] ||
    event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}

// ── Simple in-memory user store
// In production, replace with FaunaDB / Supabase / PlanetScale
const userStore = new Map();
const tokenStore = new Map(); // email verification & password reset tokens

function getUser(email) { return userStore.get(email.toLowerCase()) || null; }
function saveUser(email, data) { userStore.set(email.toLowerCase(), data); }
function deleteUser(email) { userStore.delete(email.toLowerCase()); }

function saveToken(token, data) { tokenStore.set(token, { ...data, createdAt: Date.now() }); }
function getToken(token) {
  const t = tokenStore.get(token);
  if (!t) return null;
  if (Date.now() - t.createdAt > 60 * 60 * 1000) { tokenStore.delete(token); return null; } // 1hr expiry
  return t;
}
function deleteToken(token) { tokenStore.delete(token); }

module.exports = {
  rateLimit, respond, ok, err, preflight, CORS,
  signToken, verifyToken, extractToken,
  hashPassword, checkPassword,
  sanitise, isValidEmail, isStrongPassword, getIP,
  getUser, saveUser, deleteUser,
  saveToken, getToken, deleteToken,
};
