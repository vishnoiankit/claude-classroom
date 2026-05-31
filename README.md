# ⬡ Claude Connector Classroom

A full-stack virtual classroom with user auth, live AI labs, scorecard, and certificate generation.

---

## 📁 Project Structure

```
claude-classroom/
├── public/
│   └── index.html          ← Full frontend (auth + classroom + certificate)
├── netlify/
│   └── functions/
│       ├── _utils.js       ← Shared auth utilities (JWT, rate limiting, bcrypt)
│       ├── auth.js         ← All auth endpoints (register, login, verify, reset...)
│       └── claude.js       ← Anthropic API proxy (JWT-protected)
├── netlify.toml            ← Netlify config + security headers
├── package.json            ← Dependencies
└── README.md               ← This file
```

---

## 🚀 Deploy to Netlify (5 minutes)

### Step 1 — Push to GitHub
```bash
cd claude-classroom
git init
git add .
git commit -m "Initial commit"
# Create repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/claude-classroom.git
git push -u origin main
```

### Step 2 — Connect to Netlify
1. Go to https://netlify.com → "Add new site" → "Import from GitHub"
2. Select your repo
3. Build settings are auto-detected from `netlify.toml`
4. Click **Deploy**

### Step 3 — Set Environment Variables
In Netlify → Site → **Environment Variables**, add:

| Variable | Value | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | ✅ Yes |
| `JWT_SECRET` | Any long random string (32+ chars) | ✅ Yes |
| `SITE_URL` | `https://your-site.netlify.app` | ✅ Yes |
| `FROM_EMAIL` | `noreply@yourdomain.com` | Optional |
| `SMTP_HOST` | e.g. `smtp.gmail.com` | Optional (for real emails) |
| `SMTP_PORT` | `587` | Optional |
| `SMTP_USER` | Your SMTP username | Optional |
| `SMTP_PASS` | Your SMTP password | Optional |

> **Without SMTP config:** Email links are logged to the Netlify function console (visible in Netlify → Functions → Logs). You can manually verify accounts this way during testing.

### Step 4 — Trigger redeploy
After setting env vars, go to **Deploys → Trigger deploy**.

---

## 🔑 Getting your Anthropic API Key
1. Go to https://console.anthropic.com
2. API Keys → Create Key
3. Copy and paste into Netlify env var `ANTHROPIC_API_KEY`

---

## 🔒 Security Features Built-in
- JWT authentication (7-day tokens)
- bcrypt password hashing (cost factor 12)
- Rate limiting: 5 registrations/15min, 10 logins/15min, 30 API calls/min per user
- Account lockout after 5 failed login attempts (15 min)
- Timing-safe password comparison (prevents user enumeration)
- Security headers: X-Frame-Options, CSP, XSS Protection, etc.
- Input sanitisation on all fields
- Password strength enforcement (8+ chars, upper, lower, digit)

---

## 🎓 Certificate Unlock
Users must complete **5 or more labs** to unlock the certificate download button.
The certificate is generated client-side on a Canvas element and downloaded as a PNG.

---

## ⚠️ Production Notes
- The in-memory user store (`_utils.js`) **resets on function cold start**. For a persistent production app, replace it with **FaunaDB**, **Supabase**, or **PlanetScale** (free tiers available).
- For real email delivery, configure SMTP (Gmail App Password, SendGrid, Mailgun, etc.)
- Set `JWT_SECRET` to a strong random value — never commit it to git.

