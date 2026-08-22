const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');

const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'http://localhost:8000';
const CLIENT_ID = process.env.CLIENT_ID || 'test_client_id_1';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'test_client_secret_1';
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3001/callback';

// Main Page
app.get('/', (req, res) => {
  const token = req.cookies.app_session;
  const user = req.cookies.app_user ? JSON.parse(req.cookies.app_user) : null;

  if (user) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test App 1 - Authenticated</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-slate-900 text-white min-h-screen flex items-center justify-center p-4">
        <div class="max-w-lg w-full bg-slate-800 border border-slate-700 p-8 rounded-3xl shadow-2xl text-center">
          <div class="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/30 text-2xl">
            ✓
          </div>
          <h1 class="text-2xl font-bold text-emerald-400 mb-1">Authenticated via SSO!</h1>
          <p class="text-slate-400 text-sm mb-6">Welcome to Internal Test Application 1</p>

          <div class="bg-slate-950 p-4 rounded-2xl text-left border border-slate-800 text-xs font-mono mb-6 space-y-2">
            <div><span class="text-slate-500">Subject ID:</span> ${user.sub}</div>
            <div><span class="text-slate-500">Email:</span> ${user.email}</div>
            <div><span class="text-slate-500">Name:</span> ${user.name}</div>
            <div><span class="text-slate-500">Provider:</span> ${user.provider || 'local'}</div>
          </div>

          <a href="/logout" class="inline-block w-full py-3 bg-rose-500/20 border border-rose-500/40 text-rose-300 font-semibold rounded-xl hover:bg-rose-500/30 transition">
            Single Logout (SLO)
          </a>
        </div>
      </body>
      </html>
    `);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test App 1 - Login</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-slate-900 text-white min-h-screen flex items-center justify-center p-4">
        <div class="max-w-md w-full bg-slate-800 border border-slate-700 p-8 rounded-3xl shadow-2xl text-center">
          <h1 class="text-2xl font-bold text-white mb-2">Test Application 1</h1>
          <p class="text-slate-400 text-sm mb-6">Demonstrating OIDC Central Auth SSO</p>
          <a href="/login" class="inline-block w-full py-3.5 bg-gradient-to-r from-emerald-400 to-indigo-500 text-slate-950 font-bold rounded-xl hover:opacity-90 transition shadow-lg shadow-emerald-500/20">
            Login via Central Auth Server
          </a>
        </div>
      </body>
      </html>
    `);
  }
});

// Step 1: Redirect to Central Auth Server
app.get('/login', (req, res) => {
  const authUrl = `${AUTH_SERVER_URL}/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=openid profile email`;
  res.redirect(authUrl);
});

// Step 2: Callback handling code exchange
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Authorization code missing');

  try {
    // Exchange code for tokens
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', REDIRECT_URI);
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);

    const tokenRes = await axios.post(`${AUTH_SERVER_URL}/token`, params);
    const { access_token } = tokenRes.data;

    // Fetch user profile from /userinfo
    const userRes = await axios.get(`${AUTH_SERVER_URL}/userinfo`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    res.cookie('app_session', access_token, { httpOnly: true });
    res.cookie('app_user', JSON.stringify(userRes.data), { httpOnly: true });
    res.redirect('/');
  } catch (err) {
    console.error('Code exchange error:', err.response?.data || err.message);
    res.status(500).send('Authentication failed');
  }
});

// Step 3: Single Logout
app.get('/logout', (req, res) => {
  res.clearCookie('app_session');
  res.clearCookie('app_user');
  res.redirect(`${AUTH_SERVER_URL}/logout?post_logout_redirect_uri=${encodeURIComponent('http://localhost:3001')}`);
});

app.listen(3001, () => {
  console.log('Test Client App running on http://localhost:3001');
});
