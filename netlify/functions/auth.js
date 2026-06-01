// ═══════════════════════════════════════════════════════════
// /api/auth — All authentication + admin actions
// ═══════════════════════════════════════════════════════════
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const {
  rateLimit, ok, err, preflight,
  signToken, verifyToken, extractToken,
  hashPassword, checkPassword,
  sanitise, isValidEmail, isStrongPassword, getIP,
} = require('./_utils');
const { db } = require('./_db');

const SITE_URL = process.env.SITE_URL || 'http://localhost:8888';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@claudelab.dev';
const ADMIN_EMAIL = 'ankitvishnoi.cse@geu.ac.in';

function getMailer() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return {
    sendMail: async (opts) => {
      console.log('📧 EMAIL (dev):\n', JSON.stringify(opts, null, 2));
      return { messageId: 'dev-' + Date.now() };
    },
  };
}

// ── Email: notify admin of new student registration
async function sendAdminApprovalEmail(student, approveToken, rejectToken) {
  const mailer = getMailer();
  const approveLink = `${SITE_URL}/api/auth?action=admin-approve&token=${approveToken}`;
  const rejectLink = `${SITE_URL}/api/auth?action=admin-reject&token=${rejectToken}`;
  await mailer.sendMail({
    from: `"Claude Classroom" <${FROM_EMAIL}>`,
    to: ADMIN_EMAIL,
    subject: `🎓 New Student Registration — ${student.name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#06080f;color:#dde3f0;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#00d9c8,#4d8ef7);padding:24px 32px;">
          <h1 style="margin:0;font-size:1.3rem;color:#fff;">⬡ Claude Connector Classroom</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">New Student Registration — Action Required</p>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#00d9c8;margin-top:0;">New Student Requesting Access</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
            <tr><td style="padding:8px;color:#8090b0;width:160px;">Full Name</td><td style="padding:8px;color:#eef0f8;font-weight:700;">${student.name}</td></tr>
            <tr style="background:rgba(255,255,255,0.02);"><td style="padding:8px;color:#8090b0;">Email</td><td style="padding:8px;color:#eef0f8;">${student.email}</td></tr>
            <tr><td style="padding:8px;color:#8090b0;">Enrollment No.</td><td style="padding:8px;color:#eef0f8;">${student.enrollment_no}</td></tr>
            <tr style="background:rgba(255,255,255,0.02);"><td style="padding:8px;color:#8090b0;">Roll No.</td><td style="padding:8px;color:#eef0f8;">${student.roll_no}</td></tr>
            <tr><td style="padding:8px;color:#8090b0;">Course</td><td style="padding:8px;color:#eef0f8;">${student.course}</td></tr>
            <tr style="background:rgba(255,255,255,0.02);"><td style="padding:8px;color:#8090b0;">Branch</td><td style="padding:8px;color:#eef0f8;">${student.branch}</td></tr>
            <tr><td style="padding:8px;color:#8090b0;">Section</td><td style="padding:8px;color:#eef0f8;">${student.section}</td></tr>
            <tr style="background:rgba(255,255,255,0.02);"><td style="padding:8px;color:#8090b0;">Semester</td><td style="padding:8px;color:#eef0f8;">${student.semester}</td></tr>
            <tr><td style="padding:8px;color:#8090b0;">Department</td><td style="padding:8px;color:#eef0f8;">${student.department}</td></tr>
            <tr style="background:rgba(255,255,255,0.02);"><td style="padding:8px;color:#8090b0;">College/University</td><td style="padding:8px;color:#eef0f8;">${student.college}</td></tr>
            <tr><td style="padding:8px;color:#8090b0;">Registered At</td><td style="padding:8px;color:#eef0f8;">${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</td></tr>
          </table>
          <div style="display:flex;gap:12px;margin-top:8px;">
            <a href="${approveLink}" style="flex:1;display:block;background:#3dd68c;color:#06080f;font-weight:700;padding:14px 20px;border-radius:8px;text-decoration:none;text-align:center;font-size:14px;">✅ Approve Access</a>
            <a href="${rejectLink}" style="flex:1;display:block;background:#f0607a;color:#fff;font-weight:700;padding:14px 20px;border-radius:8px;text-decoration:none;text-align:center;font-size:14px;">❌ Reject</a>
          </div>
          <p style="color:#4a5578;font-size:11px;margin-top:16px;">These links expire in 7 days. Once approved, the student will receive a verification email to set their password.</p>
        </div>
      </div>`,
  });
}

// ── Email: student approved — verify email
async function sendStudentApprovedEmail(student, verifyToken) {
  const mailer = getMailer();
  const link = `${SITE_URL}/?verify=${verifyToken}`;
  await mailer.sendMail({
    from: `"Claude Classroom" <${FROM_EMAIL}>`,
    to: student.email,
    subject: '✅ Your Claude Classroom access has been approved!',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#06080f;color:#dde3f0;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#3dd68c,#00d9c8);padding:24px 32px;">
          <h1 style="margin:0;font-size:1.3rem;color:#fff;">⬡ Claude Connector Classroom</h1>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#3dd68c;margin-top:0;">Welcome, ${student.name}! 🎉</h2>
          <p style="color:#8090b0;">Dr. Ankit Vishnoi has approved your access to the Claude Connector Classroom. Click below to verify your email and set your password.</p>
          <a href="${link}" style="display:inline-block;background:#00d9c8;color:#06080f;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;margin:16px 0;">Verify Email & Get Started →</a>
          <p style="color:#4a5578;font-size:11px;">Link expires in 24 hours.</p>
        </div>
      </div>`,
  });
}

// ── Email: student rejected
async function sendStudentRejectedEmail(student) {
  const mailer = getMailer();
  await mailer.sendMail({
    from: `"Claude Classroom" <${FROM_EMAIL}>`,
    to: student.email,
    subject: 'Claude Classroom — Registration Update',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#06080f;color:#dde3f0;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#f0607a,#f5a83a);padding:24px 32px;">
          <h1 style="margin:0;font-size:1.3rem;color:#fff;">⬡ Claude Connector Classroom</h1>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#f5a83a;margin-top:0;">Registration Update</h2>
          <p style="color:#8090b0;">Dear ${student.name}, your registration request could not be approved at this time. Please contact Dr. Ankit Vishnoi at ${ADMIN_EMAIL} for more information.</p>
        </div>
      </div>`,
  });
}

// ── Email: certificate approval request to admin
async function sendCertApprovalEmail(student, certToken, denyToken) {
  const mailer = getMailer();
  const approveLink = `${SITE_URL}/api/auth?action=cert-approve&token=${certToken}`;
  const denyLink = `${SITE_URL}/api/auth?action=cert-deny&token=${denyToken}`;
  await mailer.sendMail({
    from: `"Claude Classroom" <${FROM_EMAIL}>`,
    to: ADMIN_EMAIL,
    subject: `🎓 Certificate Request — ${student.name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#06080f;color:#dde3f0;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#f5a83a,#f0607a);padding:24px 32px;">
          <h1 style="margin:0;font-size:1.3rem;color:#fff;">⬡ Certificate Issuance Request</h1>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#f5a83a;margin-top:0;">Student Requesting Certificate</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
            <tr><td style="padding:8px;color:#8090b0;width:160px;">Full Name</td><td style="padding:8px;color:#eef0f8;font-weight:700;">${student.name}</td></tr>
            <tr style="background:rgba(255,255,255,0.02);"><td style="padding:8px;color:#8090b0;">Email</td><td style="padding:8px;color:#eef0f8;">${student.email}</td></tr>
            <tr><td style="padding:8px;color:#8090b0;">Enrollment No.</td><td style="padding:8px;color:#eef0f8;">${student.enrollment_no}</td></tr>
            <tr style="background:rgba(255,255,255,0.02);"><td style="padding:8px;color:#8090b0;">Roll No.</td><td style="padding:8px;color:#eef0f8;">${student.roll_no}</td></tr>
            <tr><td style="padding:8px;color:#8090b0;">Course / Branch</td><td style="padding:8px;color:#eef0f8;">${student.course} — ${student.branch}</td></tr>
            <tr style="background:rgba(255,255,255,0.02);"><td style="padding:8px;color:#8090b0;">Semester</td><td style="padding:8px;color:#eef0f8;">${student.semester}</td></tr>
            <tr><td style="padding:8px;color:#8090b0;">College</td><td style="padding:8px;color:#eef0f8;">${student.college}</td></tr>
            <tr style="background:rgba(255,255,255,0.02);"><td style="padding:8px;color:#8090b0;">Modules Completed</td><td style="padding:8px;color:#3dd68c;font-weight:700;">${student.labs_done} / 10</td></tr>
            <tr><td style="padding:8px;color:#8090b0;">XP Earned</td><td style="padding:8px;color:#f5a83a;font-weight:700;">${student.xp} XP</td></tr>
            <tr style="background:rgba(255,255,255,0.02);"><td style="padding:8px;color:#8090b0;">Quiz Score</td><td style="padding:8px;color:#eef0f8;">${student.quiz_correct} correct</td></tr>
          </table>
          <div style="display:flex;gap:12px;">
            <a href="${approveLink}" style="flex:1;display:block;background:#3dd68c;color:#06080f;font-weight:700;padding:14px 20px;border-radius:8px;text-decoration:none;text-align:center;">🎓 Issue Certificate</a>
            <a href="${denyLink}" style="flex:1;display:block;background:#f0607a;color:#fff;font-weight:700;padding:14px 20px;border-radius:8px;text-decoration:none;text-align:center;">❌ Deny</a>
          </div>
          <p style="color:#4a5578;font-size:11px;margin-top:16px;">Once approved, the student will be notified and can download their certificate.</p>
        </div>
      </div>`,
  });
}

// ── Email: notify student their certificate is approved
async function sendCertApprovedEmail(student) {
  const mailer = getMailer();
  await mailer.sendMail({
    from: `"Claude Classroom" <${FROM_EMAIL}>`,
    to: student.email,
    subject: '🎓 Your Certificate is Ready — Claude Connector Classroom',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#06080f;color:#dde3f0;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#f5a83a,#f0607a);padding:24px 32px;">
          <h1 style="margin:0;font-size:1.3rem;color:#fff;">🎓 Certificate Approved!</h1>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#f5a83a;margin-top:0;">Congratulations, ${student.name}!</h2>
          <p style="color:#8090b0;">Dr. Ankit Vishnoi has approved your certificate. Log in to the classroom and click "Download Certificate" to get your official certificate.</p>
          <a href="${SITE_URL}" style="display:inline-block;background:#f5a83a;color:#06080f;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;margin:16px 0;">Download My Certificate →</a>
        </div>
      </div>`,
  });
}

// ════════════════════════════════════════════════════════════
exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' }, body: '' };
  }

  const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const respond = (code, body) => ({ statusCode: code, headers: CORS, body: JSON.stringify(body) });

  const ip = (event.headers?.['x-nf-client-connection-ip'] || event.headers?.['x-forwarded-for'] || '0.0.0.0').split(',')[0].trim();
  const action = event.queryStringParameters?.action;

  // ── GET actions (email link clicks)
  if (event.httpMethod === 'GET') {
    const users = await db('users');
    const tokens = await db('tokens');

    // Admin approves student
    if (action === 'admin-approve') {
      const token = event.queryStringParameters?.token;
      if (!token) return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: '<h2>Invalid link</h2>' };
      const t = await tokens.selectOne('*', { token, type: 'admin-approve' });
      if (!t) return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: '<h2>Link expired or already used</h2>' };
      const student = await users.selectOne('*', { id: t.user_id });
      if (!student) return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: '<h2>Student not found</h2>' };
      await users.update({ status: 'approved' }, { id: student.id });
      await tokens.delete({ token });
      // Send student verification email
      const vToken = uuidv4();
      const tokensDb = await db('tokens');
      await tokensDb.insert({ token: vToken, type: 'verify', user_id: student.id, created_at: new Date().toISOString() });
      await sendStudentApprovedEmail(student, vToken);
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#06080f;color:#dde3f0;"><h1 style="color:#3dd68c;">✅ Student Approved</h1><p>${student.name} has been approved and will receive a verification email shortly.</p><p style="color:#4a5578;font-size:13px;">You can close this tab.</p></body></html>` };
    }

    // Admin rejects student
    if (action === 'admin-reject') {
      const token = event.queryStringParameters?.token;
      if (!token) return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: '<h2>Invalid link</h2>' };
      const t = await tokens.selectOne('*', { token, type: 'admin-approve' });
      if (!t) return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: '<h2>Link expired or already used</h2>' };
      const student = await users.selectOne('*', { id: t.user_id });
      if (student) {
        await users.update({ status: 'rejected' }, { id: student.id });
        await sendStudentRejectedEmail(student);
      }
      await tokens.delete({ token });
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#06080f;color:#dde3f0;"><h1 style="color:#f0607a;">❌ Student Rejected</h1><p>The student has been notified.</p><p style="color:#4a5578;font-size:13px;">You can close this tab.</p></body></html>` };
    }

    // Admin approves certificate
    if (action === 'cert-approve') {
      const token = event.queryStringParameters?.token;
      const t = await tokens.selectOne('*', { token, type: 'cert-approve' });
      if (!t) return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: '<h2>Link expired or already used</h2>' };
      const certs = await db('certificates');
      await certs.update({ status: 'approved', approved_at: new Date().toISOString() }, { id: t.cert_id });
      const student = await users.selectOne('*', { id: t.user_id });
      if (student) await sendCertApprovedEmail(student);
      await tokens.delete({ token });
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#06080f;color:#dde3f0;"><h1 style="color:#f5a83a;">🎓 Certificate Approved</h1><p>${student?.name || 'Student'} has been notified and can now download their certificate.</p><p style="color:#4a5578;font-size:13px;">You can close this tab.</p></body></html>` };
    }

    // Admin denies certificate
    if (action === 'cert-deny') {
      const token = event.queryStringParameters?.token;
      const t = await tokens.selectOne('*', { token, type: 'cert-approve' });
      if (!t) return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: '<h2>Link expired</h2>' };
      const certs = await db('certificates');
      await certs.update({ status: 'denied' }, { id: t.cert_id });
      await tokens.delete({ token });
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#06080f;color:#dde3f0;"><h1 style="color:#f0607a;">Certificate Denied</h1><p style="color:#4a5578;font-size:13px;">You can close this tab.</p></body></html>` };
    }

    return respond(400, { error: 'Unknown GET action' });
  }

  // POST actions
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON' }); }

  const users = await db('users');
  const tokens = await db('tokens');
  const progress = await db('progress');
  const certs = await db('certificates');

  const sanitise_s = (s, n = 255) => (typeof s === 'string' ? s.trim().slice(0, n).replace(/[<>]/g, '') : '');

  // ── REGISTER
  if (action === 'register') {
    const rl = rateLimit(ip, 'register', 5, 15 * 60 * 1000);
    if (rl.limited) return respond(429, { error: `Too many registrations. Retry in ${rl.retryAfter}s` });

    const name = sanitise_s(body.name, 80);
    const email = sanitise_s(body.email, 254).toLowerCase();
    const password = body.password || '';
    const course = sanitise_s(body.course, 80);
    const department = sanitise_s(body.department, 80);
    const branch = sanitise_s(body.branch, 80);
    const section = sanitise_s(body.section, 20);
    const semester = sanitise_s(body.semester, 20);
    const enrollment_no = sanitise_s(body.enrollment_no, 50);
    const roll_no = sanitise_s(body.roll_no, 50);
    const college = sanitise_s(body.college, 150);

    if (!name || name.length < 2) return respond(400, { error: 'Name must be at least 2 characters' });
    if (!isValidEmail(email)) return respond(400, { error: 'Invalid email address' });
    if (!isStrongPassword(password)) return respond(400, { error: 'Password needs 8+ chars, uppercase, lowercase, and a number' });
    if (!course || !branch || !enrollment_no || !roll_no || !college) return respond(400, { error: 'Please fill in all required fields' });

    const existing = await users.selectOne('id', { email });
    if (existing) return respond(409, { error: 'An account with this email already exists' });

    const hashed = await hashPassword(password);
    const userId = uuidv4();

    const insertResult = await users.insert({
      id: userId, name, email, password: hashed,
      course, department, branch, section, semester,
      enrollment_no, roll_no, college,
      role: 'student', status: 'pending', verified: false,
      created_at: new Date().toISOString(),
    });

    if (!insertResult.ok) return respond(500, { error: 'Registration failed. Please try again.' });

    // Send admin approval email
    const approveToken = uuidv4();
    const rejectToken = uuidv4();
    await tokens.insert({ token: approveToken, type: 'admin-approve', user_id: userId, created_at: new Date().toISOString() });
    await tokens.insert({ token: rejectToken, type: 'admin-approve', user_id: userId, created_at: new Date().toISOString() });

    try {
      await sendAdminApprovalEmail({ name, email, course, department, branch, section, semester, enrollment_no, roll_no, college }, approveToken, rejectToken);
    } catch (e) {
      console.error('Email send error:', e.message);
    }

    return respond(200, { message: 'Registration submitted! Dr. Ankit Vishnoi will review your request and you will receive an email once approved.' });
  }

  // ── LOGIN
  if (action === 'login') {
    const rl = rateLimit(ip, 'login', 10, 15 * 60 * 1000);
    if (rl.limited) return respond(429, { error: `Too many attempts. Retry in ${rl.retryAfter}s` });

    const email = sanitise_s(body.email, 254).toLowerCase();
    const pw = body.password || '';
    if (!email || !pw) return respond(400, { error: 'Email and password required' });

    const user = await users.selectOne('*', { email });
    const dummy = '$2a$12$invaliddummyhashtopreventtiming000000000000000000000000';
    const match = user ? await checkPassword(pw, user.password) : await checkPassword(pw, dummy).then(() => false);

    if (!user || !match) return respond(401, { error: 'Invalid email or password' });
    if (user.status === 'pending') return respond(403, { error: 'Your registration is pending approval from Dr. Ankit Vishnoi. You will receive an email once approved.' });
    if (user.status === 'rejected') return respond(403, { error: 'Your registration was not approved. Please contact ankitvishnoi.cse@geu.ac.in for assistance.' });
    if (!user.verified) return respond(403, { error: 'Please verify your email first. Check your inbox for the verification link.' });

    // Get progress
    const prog = await progress.selectOne('*', { user_id: user.id });
    // Get cert status
    const cert = await certs.selectOne('status, approved_at', { user_id: user.id });

    const token = signToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
    return respond(200, {
      token,
      user: {
        id: user.id, name: user.name, email: user.email,
        role: user.role, course: user.course, branch: user.branch,
        department: user.department, section: user.section,
        semester: user.semester, enrollment_no: user.enrollment_no,
        roll_no: user.roll_no, college: user.college,
        created_at: user.created_at,
        progress: prog ? {
          xp: prog.xp || 0, labsDone: prog.labs_done || [],
          quizCorrect: prog.quiz_correct || 0, quizTotal: prog.quiz_total || 0,
          streak: prog.streak || 0, badges: prog.badges || [],
          connectorScores: prog.connector_scores || {},
        } : null,
        certStatus: cert?.status || null,
        certApprovedAt: cert?.approved_at || null,
      },
    });
  }

  // ── VERIFY EMAIL
  if (action === 'verify-email') {
    const { token, password } = body;
    if (!token) return respond(400, { error: 'Token required' });
    const t = await tokens.selectOne('*', { token, type: 'verify' });
    if (!t) return respond(400, { error: 'Invalid or expired verification link' });
    const user = await users.selectOne('*', { id: t.user_id });
    if (!user) return respond(404, { error: 'User not found' });

    const updates = { verified: true };
    if (password) {
      if (!isStrongPassword(password)) return respond(400, { error: 'Password needs 8+ chars, uppercase, lowercase, and a number' });
      updates.password = await hashPassword(password);
    }
    await users.update(updates, { id: user.id });
    await tokens.delete({ token });

    const authToken = signToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
    return respond(200, {
      message: 'Email verified! Welcome to the classroom.',
      token: authToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, course: user.course, branch: user.branch, department: user.department, section: user.section, semester: user.semester, enrollment_no: user.enrollment_no, roll_no: user.roll_no, college: user.college, created_at: user.created_at, progress: null, certStatus: null },
    });
  }

  // ── FORGOT PASSWORD
  if (action === 'forgot-password') {
    const rl = rateLimit(ip, 'forgot', 3, 60 * 60 * 1000);
    if (rl.limited) return respond(429, { error: 'Too many requests. Try again later.' });
    const email = sanitise_s(body.email, 254).toLowerCase();
    const user = await users.selectOne('id,name,email,verified', { email });
    if (user && user.verified) {
      const resetToken = uuidv4();
      await tokens.insert({ token: resetToken, type: 'reset', user_id: user.id, created_at: new Date().toISOString() });
      const mailer = getMailer();
      await mailer.sendMail({
        from: `"Claude Classroom" <${FROM_EMAIL}>`,
        to: email,
        subject: '🔑 Reset your password — Claude Classroom',
        html: `<div style="font-family:sans-serif;padding:32px;background:#06080f;color:#dde3f0;border-radius:12px;"><h2 style="color:#f5a83a;">Password Reset</h2><p style="color:#8090b0;">Hi ${user.name}, click below to reset your password.</p><a href="${SITE_URL}/?reset=${resetToken}" style="display:inline-block;background:#f5a83a;color:#06080f;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;margin:16px 0;">Reset Password →</a><p style="color:#4a5578;font-size:11px;">Expires in 1 hour.</p></div>`,
      });
    }
    return respond(200, { message: "If that email is registered, you'll receive a reset link shortly." });
  }

  // ── RESET PASSWORD
  if (action === 'reset-password') {
    const { token, password } = body;
    if (!token || !password) return respond(400, { error: 'Token and password required' });
    if (!isStrongPassword(password)) return respond(400, { error: 'Password needs 8+ chars, uppercase, lowercase, and a number' });
    const t = await tokens.selectOne('*', { token, type: 'reset' });
    if (!t) return respond(400, { error: 'Invalid or expired reset link' });
    const hashed = await hashPassword(password);
    await users.update({ password: hashed }, { id: t.user_id });
    await tokens.delete({ token });
    return respond(200, { message: 'Password reset successfully. You can now log in.' });
  }

  // ── CHANGE PASSWORD
  if (action === 'change-password') {
    const authToken = extractToken(event);
    if (!authToken) return respond(401, { error: 'Authentication required' });
    const { valid, payload } = verifyToken(authToken);
    if (!valid) return respond(401, { error: 'Session expired' });
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) return respond(400, { error: 'Both passwords required' });
    if (!isStrongPassword(newPassword)) return respond(400, { error: 'New password needs 8+ chars, uppercase, lowercase, and a number' });
    const user = await users.selectOne('*', { id: payload.sub });
    if (!user) return respond(404, { error: 'User not found' });
    const match = await checkPassword(currentPassword, user.password);
    if (!match) return respond(401, { error: 'Current password is incorrect' });
    await users.update({ password: await hashPassword(newPassword) }, { id: user.id });
    return respond(200, { message: 'Password changed successfully.' });
  }

  // ── GET ME
  if (action === 'me') {
    const authToken = extractToken(event);
    if (!authToken) return respond(401, { error: 'Authentication required' });
    const { valid, payload } = verifyToken(authToken);
    if (!valid) return respond(401, { error: 'Session expired' });
    const user = await users.selectOne('*', { id: payload.sub });
    if (!user) return respond(404, { error: 'User not found' });
    const prog = await progress.selectOne('*', { user_id: user.id });
    const cert = await certs.selectOne('status, approved_at', { user_id: user.id });
    return respond(200, {
      id: user.id, name: user.name, email: user.email,
      role: user.role, course: user.course, branch: user.branch,
      department: user.department, section: user.section,
      semester: user.semester, enrollment_no: user.enrollment_no,
      roll_no: user.roll_no, college: user.college,
      created_at: user.created_at,
      progress: prog ? { xp: prog.xp || 0, labsDone: prog.labs_done || [], quizCorrect: prog.quiz_correct || 0, quizTotal: prog.quiz_total || 0, streak: prog.streak || 0, badges: prog.badges || [], connectorScores: prog.connector_scores || {} } : null,
      certStatus: cert?.status || null,
      certApprovedAt: cert?.approved_at || null,
    });
  }

  // ── UPDATE PROFILE
  if (action === 'update-profile') {
    const authToken = extractToken(event);
    if (!authToken) return respond(401, { error: 'Authentication required' });
    const { valid, payload } = verifyToken(authToken);
    if (!valid) return respond(401, { error: 'Session expired' });
    const updates = {};
    if (body.name) updates.name = sanitise_s(body.name, 80);
    if (body.course !== undefined) updates.course = sanitise_s(body.course, 80);
    if (body.department !== undefined) updates.department = sanitise_s(body.department, 80);
    if (body.branch !== undefined) updates.branch = sanitise_s(body.branch, 80);
    if (body.section !== undefined) updates.section = sanitise_s(body.section, 20);
    if (body.semester !== undefined) updates.semester = sanitise_s(body.semester, 20);
    await users.update(updates, { id: payload.sub });
    return respond(200, { message: 'Profile updated.' });
  }

  // ── SAVE PROGRESS
  if (action === 'save-progress') {
    const authToken = extractToken(event);
    if (!authToken) return respond(401, { error: 'Authentication required' });
    const { valid, payload } = verifyToken(authToken);
    if (!valid) return respond(401, { error: 'Session expired' });
    if (!body.progress) return respond(400, { error: 'Progress data required' });
    const p = body.progress;
    const existing = await progress.selectOne('id', { user_id: payload.sub });
    const data = {
      user_id: payload.sub,
      xp: p.xp || 0,
      labs_done: p.labsDone || [],
      quiz_correct: p.quizCorrect || 0,
      quiz_total: p.quizTotal || 0,
      streak: p.streak || 0,
      badges: p.badges || [],
      connector_scores: p.connectorScores || {},
      updated_at: new Date().toISOString(),
    };
    if (existing) {
      await progress.update(data, { user_id: payload.sub });
    } else {
      await progress.insert({ ...data, id: uuidv4() });
    }
    return respond(200, { saved: true });
  }

  // ── REQUEST CERTIFICATE
  if (action === 'request-certificate') {
    const authToken = extractToken(event);
    if (!authToken) return respond(401, { error: 'Authentication required' });
    const { valid, payload } = verifyToken(authToken);
    if (!valid) return respond(401, { error: 'Session expired' });

    const user = await users.selectOne('*', { id: payload.sub });
    if (!user) return respond(404, { error: 'User not found' });

    const prog = await progress.selectOne('*', { user_id: user.id });
    const labsDone = (prog?.labs_done || []).length;
    if (labsDone < 7) return respond(400, { error: `You need to complete at least 7 modules. You have completed ${labsDone}.` });

    // Check if already requested
    const existingCert = await certs.selectOne('*', { user_id: user.id });
    if (existingCert) {
      if (existingCert.status === 'approved') return respond(200, { message: 'Your certificate is already approved! You can download it now.', status: 'approved' });
      if (existingCert.status === 'pending') return respond(200, { message: 'Your certificate request is pending approval from Dr. Ankit Vishnoi.', status: 'pending' });
    }

    // Create cert record
    const certId = uuidv4();
    await certs.insert({ id: certId, user_id: user.id, status: 'pending', requested_at: new Date().toISOString() });

    // Send admin email
    const certToken = uuidv4();
    const denyToken = uuidv4();
    await tokens.insert({ token: certToken, type: 'cert-approve', user_id: user.id, cert_id: certId, created_at: new Date().toISOString() });
    await tokens.insert({ token: denyToken, type: 'cert-approve', user_id: user.id, cert_id: certId, created_at: new Date().toISOString() });

    await sendCertApprovalEmail({
      name: user.name, email: user.email,
      enrollment_no: user.enrollment_no, roll_no: user.roll_no,
      course: user.course, branch: user.branch,
      semester: user.semester, college: user.college,
      labs_done: labsDone, xp: prog?.xp || 0,
      quiz_correct: prog?.quiz_correct || 0,
    }, certToken, denyToken);

    return respond(200, { message: 'Certificate request sent to Dr. Ankit Vishnoi for approval. You will receive an email when it is approved.', status: 'pending' });
  }

  // ── ADMIN: GET ALL STUDENTS
  if (action === 'admin-students') {
    const authToken = extractToken(event);
    if (!authToken) return respond(401, { error: 'Authentication required' });
    const { valid, payload } = verifyToken(authToken);
    if (!valid || payload.role !== 'admin') return respond(403, { error: 'Admin access required' });
    const allUsers = await users.select('id,name,email,course,branch,department,section,semester,enrollment_no,roll_no,college,status,verified,created_at,role');
    return respond(200, { students: Array.isArray(allUsers) ? allUsers.filter(u => u.role === 'student') : [] });
  }

  return respond(400, { error: `Unknown action: ${action}` });
};
