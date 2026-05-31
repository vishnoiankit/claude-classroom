// ═══════════════════════════════════════════════════════════
// /api/auth  — handles all authentication actions
// Query param: ?action=register|login|verify-email|...
// ═══════════════════════════════════════════════════════════
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const {
  rateLimit, ok, err, preflight, CORS,
  signToken, verifyToken, extractToken,
  hashPassword, checkPassword,
  sanitise, isValidEmail, isStrongPassword, getIP,
  getUser, saveUser, saveToken, getToken, deleteToken,
} = require('./_utils');

// ── Mailer (configure SMTP via env vars)
function getMailer() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  // Dev fallback: log to console
  return {
    sendMail: async (opts) => {
      console.log('📧 EMAIL (dev mode):\n', JSON.stringify(opts, null, 2));
      return { messageId: 'dev-' + Date.now() };
    },
  };
}

const SITE_URL = process.env.SITE_URL || 'http://localhost:8888';
const FROM_EMAIL = process.env.FROM_EMAIL || 'classroom@claudelab.dev';

async function sendVerificationEmail(email, token, name) {
  const mailer = getMailer();
  const link = `${SITE_URL}/?verify=${token}`;
  await mailer.sendMail({
    from: `"Claude Connector Classroom" <${FROM_EMAIL}>`,
    to: email,
    subject: '✅ Verify your Claude Classroom account',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#07090f;color:#dde3f0;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#00d9c8,#4d8ef7);padding:28px 32px;">
          <h1 style="margin:0;font-size:1.4rem;color:#fff;">⬡ Claude Connector Classroom</h1>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#00d9c8;margin-top:0;">Hi ${name}, welcome aboard! 🎉</h2>
          <p style="color:#8090b0;">Click the button below to verify your email and activate your account.</p>
          <a href="${link}" style="display:inline-block;background:#00d9c8;color:#07090f;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;margin:16px 0;">Verify My Email →</a>
          <p style="color:#5a6480;font-size:12px;">Link expires in 1 hour. If you didn't register, ignore this email.</p>
        </div>
      </div>`,
  });
}

async function sendResetEmail(email, token, name) {
  const mailer = getMailer();
  const link = `${SITE_URL}/?reset=${token}`;
  await mailer.sendMail({
    from: `"Claude Connector Classroom" <${FROM_EMAIL}>`,
    to: email,
    subject: '🔑 Reset your password — Claude Classroom',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#07090f;color:#dde3f0;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#f5a623,#f06292);padding:28px 32px;">
          <h1 style="margin:0;font-size:1.4rem;color:#fff;">⬡ Password Reset</h1>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#f5a623;margin-top:0;">Hi ${name}</h2>
          <p style="color:#8090b0;">We received a request to reset your password. Click below to set a new one.</p>
          <a href="${link}" style="display:inline-block;background:#f5a623;color:#07090f;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;margin:16px 0;">Reset Password →</a>
          <p style="color:#5a6480;font-size:12px;">Link expires in 1 hour. If you didn't request this, ignore this email.</p>
        </div>
      </div>`,
  });
}

// ════════════════════════════════════════════════════════════
exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');

  const ip = getIP(event);
  const action = event.queryStringParameters?.action;
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }

  // ── REGISTER
  if (action === 'register') {
    const rl = rateLimit(ip, 'register', 5, 15 * 60 * 1000); // 5 per 15min
    if (rl.limited) return err(429, `Too many registrations. Retry in ${rl.retryAfter}s`);

    const name = sanitise(body.name, 80);
    const email = sanitise(body.email, 254).toLowerCase();
    const password = body.password || '';
    const role = sanitise(body.role || 'Learner', 60);
    const company = sanitise(body.company || '', 100);

    if (!name || name.length < 2) return err(400, 'Name must be at least 2 characters');
    if (!isValidEmail(email)) return err(400, 'Invalid email address');
    if (!isStrongPassword(password)) return err(400, 'Password needs 8+ chars, uppercase, lowercase, and a number');
    if (getUser(email)) return err(409, 'An account with this email already exists');

    const hashed = await hashPassword(password);
    const verifyToken = uuidv4();

    saveUser(email, {
      id: uuidv4(),
      name, email, password: hashed, role, company,
      verified: false,
      createdAt: new Date().toISOString(),
      progress: { xp: 0, labsDone: [], quizCorrect: 0, quizTotal: 0, streak: 0, badges: [], connectorScores: {} },
      loginAttempts: 0,
      lockedUntil: null,
    });

    saveToken(verifyToken, { type: 'verify', email });
    await sendVerificationEmail(email, verifyToken, name);

    return ok({ message: 'Account created! Check your email to verify your account.' });
  }

  // ── LOGIN
  if (action === 'login') {
    const rl = rateLimit(ip, 'login', 10, 15 * 60 * 1000); // 10 per 15min
    if (rl.limited) return err(429, `Too many login attempts. Retry in ${rl.retryAfter}s`);

    const email = sanitise(body.email || '', 254).toLowerCase();
    const password = body.password || '';

    if (!email || !password) return err(400, 'Email and password required');

    const user = getUser(email);

    // Timing-safe: always check password even if user not found
    const dummyHash = '$2a$12$invaliddummyhashtopreventtimingattacks00000000000000000';
    const match = user
      ? await checkPassword(password, user.password)
      : await checkPassword(password, dummyHash).then(() => false);

    if (!user || !match) {
      if (user) {
        user.loginAttempts = (user.loginAttempts || 0) + 1;
        if (user.loginAttempts >= 5) {
          user.lockedUntil = Date.now() + 15 * 60 * 1000;
          user.loginAttempts = 0;
        }
        saveUser(email, user);
      }
      return err(401, 'Invalid email or password');
    }

    if (user.lockedUntil && Date.now() < user.lockedUntil) {
      const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      return err(423, `Account temporarily locked. Try again in ${mins} minute(s)`);
    }

    if (!user.verified) return err(403, 'Please verify your email before logging in. Check your inbox.');

    user.loginAttempts = 0;
    user.lockedUntil = null;
    user.lastLogin = new Date().toISOString();
    saveUser(email, user);

    const token = signToken({ sub: user.id, email: user.email, name: user.name });
    return ok({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, company: user.company, progress: user.progress, createdAt: user.createdAt },
    });
  }

  // ── VERIFY EMAIL
  if (action === 'verify-email') {
    const { token } = body;
    if (!token) return err(400, 'Token required');
    const t = getToken(token);
    if (!t || t.type !== 'verify') return err(400, 'Invalid or expired verification link');

    const user = getUser(t.email);
    if (!user) return err(404, 'User not found');

    user.verified = true;
    saveUser(t.email, user);
    deleteToken(token);

    const authToken = signToken({ sub: user.id, email: user.email, name: user.name });
    return ok({
      message: 'Email verified! Welcome to the classroom.',
      token: authToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, company: user.company, progress: user.progress, createdAt: user.createdAt },
    });
  }

  // ── FORGOT PASSWORD
  if (action === 'forgot-password') {
    const rl = rateLimit(ip, 'forgot', 3, 60 * 60 * 1000); // 3 per hour
    if (rl.limited) return err(429, `Too many requests. Retry in ${rl.retryAfter}s`);

    const email = sanitise(body.email || '', 254).toLowerCase();
    // Always return success to not leak whether email exists
    const user = getUser(email);
    if (user && user.verified) {
      const token = uuidv4();
      saveToken(token, { type: 'reset', email });
      await sendResetEmail(email, token, user.name);
    }
    return ok({ message: 'If that email is registered, you\'ll receive a reset link shortly.' });
  }

  // ── RESET PASSWORD
  if (action === 'reset-password') {
    const { token, password } = body;
    if (!token || !password) return err(400, 'Token and new password required');
    if (!isStrongPassword(password)) return err(400, 'Password needs 8+ chars, uppercase, lowercase, and a number');

    const t = getToken(token);
    if (!t || t.type !== 'reset') return err(400, 'Invalid or expired reset link');

    const user = getUser(t.email);
    if (!user) return err(404, 'User not found');

    user.password = await hashPassword(password);
    saveUser(t.email, user);
    deleteToken(token);

    return ok({ message: 'Password reset successfully. You can now log in.' });
  }

  // ── CHANGE PASSWORD (authenticated)
  if (action === 'change-password') {
    const authToken = extractToken(event);
    if (!authToken) return err(401, 'Authentication required');
    const { valid, payload } = verifyToken(authToken);
    if (!valid) return err(401, 'Session expired. Please log in again');

    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) return err(400, 'Current and new password required');
    if (!isStrongPassword(newPassword)) return err(400, 'New password needs 8+ chars, uppercase, lowercase, and a number');

    const user = getUser(payload.email);
    if (!user) return err(404, 'User not found');

    const match = await checkPassword(currentPassword, user.password);
    if (!match) return err(401, 'Current password is incorrect');

    user.password = await hashPassword(newPassword);
    saveUser(payload.email, user);
    return ok({ message: 'Password changed successfully.' });
  }

  // ── GET PROFILE (authenticated)
  if (action === 'me') {
    const authToken = extractToken(event);
    if (!authToken) return err(401, 'Authentication required');
    const { valid, payload } = verifyToken(authToken);
    if (!valid) return err(401, 'Session expired. Please log in again');

    const user = getUser(payload.email);
    if (!user) return err(404, 'User not found');

    return ok({ id: user.id, name: user.name, email: user.email, role: user.role, company: user.company, progress: user.progress, createdAt: user.createdAt, lastLogin: user.lastLogin });
  }

  // ── UPDATE PROFILE (authenticated)
  if (action === 'update-profile') {
    const authToken = extractToken(event);
    if (!authToken) return err(401, 'Authentication required');
    const { valid, payload } = verifyToken(authToken);
    if (!valid) return err(401, 'Session expired. Please log in again');

    const user = getUser(payload.email);
    if (!user) return err(404, 'User not found');

    if (body.name) user.name = sanitise(body.name, 80);
    if (body.role !== undefined) user.role = sanitise(body.role, 60);
    if (body.company !== undefined) user.company = sanitise(body.company, 100);
    saveUser(payload.email, user);

    return ok({ name: user.name, role: user.role, company: user.company });
  }

  // ── SAVE PROGRESS (authenticated)
  if (action === 'save-progress') {
    const authToken = extractToken(event);
    if (!authToken) return err(401, 'Authentication required');
    const { valid, payload } = verifyToken(authToken);
    if (!valid) return err(401, 'Session expired');

    const user = getUser(payload.email);
    if (!user) return err(404, 'User not found');

    if (body.progress && typeof body.progress === 'object') {
      user.progress = { ...user.progress, ...body.progress };
      saveUser(payload.email, user);
    }
    return ok({ saved: true });
  }

  return err(400, `Unknown action: ${action}`);
};
