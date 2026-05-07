// ═══════════════════════════════════════════
//  Galaxy Studio — server.js
//  Production Express server for Hostinger
//  - Serves static files from ./public
//  - Proxy routes for Gemini, Ollama, Claude, OpenAI
//  - JWT auth via Supabase on proxy routes
//  - Per-user rate limiting
//  - CORS locked to ALLOWED_ORIGIN env var
// ═══════════════════════════════════════════

require('dotenv').config();

const express = require('express');
const path = require('path');
const https = require('https');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const PORT = parseInt(process.env.PORT || '8000', 10);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';
const NODE_ENV = process.env.NODE_ENV || 'development';

const sbAdmin = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const app = express();

// ── CORS ──
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGIN === '*' || origin === ALLOWED_ORIGIN;
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN === '*' ? '*' : origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Upstream-Key, X-Provider');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// ── RATE LIMITER (per IP, generous for normal use) ──
const proxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: req => req.authUserId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment.' }
});

// ── JWT AUTH MIDDLEWARE (for proxy routes) ──
async function requireAuth(req, res, next) {
  // In dev mode with no Supabase configured — allow all
  if (!sbAdmin || NODE_ENV === 'development') {
    req.authUserId = 'dev';
    return next();
  }
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token.' });
  }
  const token = auth.slice(7);
  try {
    const { data, error } = await sbAdmin.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired token.' });
    req.authUserId = data.user.id;
    req.authUser = data.user;
    next();
  } catch {
    res.status(401).json({ error: 'Auth check failed.' });
  }
}

// ── PROXY HELPER ──
function proxyRequest(targetBase, req, res) {
  // Get the upstream API key from custom header (never from our own env)
  const upstreamKey = req.headers['x-upstream-key'] || '';

  const pathAfterProxy = req.path; // already stripped by route
  const fullUrl = targetBase + pathAfterProxy + (req._parsedUrl.search || '');

  let url;
  try { url = new URL(fullUrl); } catch {
    return res.status(400).json({ error: 'Invalid proxy target URL.' });
  }

  // Security: only allow HTTPS to known providers
  const allowedHosts = [
    'generativelanguage.googleapis.com',
    'ollama.com',
    'api.anthropic.com',
    'api.openai.com',
    'openrouter.ai'
  ];
  if (!allowedHosts.includes(url.hostname)) {
    return res.status(403).json({ error: 'Proxy target not allowed.' });
  }

  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'User-Agent': 'GalaxyStudio/2.0'
    };
    if (upstreamKey) headers['Authorization'] = `Bearer ${upstreamKey}`;
    // Anthropic uses x-api-key
    const provider = req.headers['x-provider'] || '';
    if (provider === 'anthropic' && upstreamKey) {
      headers['x-api-key'] = upstreamKey;
      headers['anthropic-version'] = '2023-06-01';
      delete headers['Authorization'];
    }
    if (body.length > 0) headers['Content-Length'] = body.length;

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: req.method,
      headers
    };

    const proxyReq = https.request(options, proxyRes => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
        'Transfer-Encoding': proxyRes.headers['transfer-encoding'] || '',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN === '*' ? '*' : (req.headers.origin || '')
      });
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', err => {
      console.error('[proxy error]', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: `Proxy error: ${err.message}` });
      }
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
}

// ── PROXY ROUTES ──
app.use('/proxy/gemini', requireAuth, proxyLimiter, (req, res) => {
  proxyRequest('https://generativelanguage.googleapis.com', req, res);
});

app.use('/proxy/ollama', requireAuth, proxyLimiter, (req, res) => {
  proxyRequest('https://ollama.com', req, res);
});

app.use('/proxy/anthropic', requireAuth, proxyLimiter, (req, res) => {
  proxyRequest('https://api.anthropic.com', req, res);
});

app.use('/proxy/openai', requireAuth, proxyLimiter, (req, res) => {
  proxyRequest('https://api.openai.com', req, res);
});

app.use('/proxy/openrouter', requireAuth, proxyLimiter, (req, res) => {
  proxyRequest('https://openrouter.ai', req, res);
});

// ── WEB SEARCH PROXY (uses DuckDuckGo Instant Answer API — no key needed) ──
app.get('/proxy/search', requireAuth, proxyLimiter, async (req, res) => {
  const q = req.query.q || '';
  if (!q) return res.status(400).json({ error: 'Missing query param q' });
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
  https.get(url, { headers: { 'User-Agent': 'GalaxyStudio/2.0' } }, proxyRes => {
    let data = '';
    proxyRes.on('data', c => { data += c; });
    proxyRes.on('end', () => {
      try {
        const j = JSON.parse(data);
        const results = [];
        if (j.AbstractText) results.push({ title: j.Heading, snippet: j.AbstractText, url: j.AbstractURL });
        (j.RelatedTopics || []).slice(0, 5).forEach(t => {
          if (t.Text) results.push({ title: t.Text.slice(0, 60), snippet: t.Text, url: t.FirstURL });
        });
        res.json({ results, query: q });
      } catch {
        res.status(502).json({ error: 'Search API error' });
      }
    });
  }).on('error', err => {
    res.status(502).json({ error: err.message });
  });
});

// ── FETCH PROXY (for fetch_url tool) ──
app.post('/proxy/fetch', requireAuth, proxyLimiter, express.json({ limit: '100kb' }), async (req, res) => {
  const targetUrl = req.body?.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing url in body' });
  let u;
  try { u = new URL(targetUrl); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!['http:', 'https:'].includes(u.protocol)) return res.status(400).json({ error: 'Only HTTP/HTTPS allowed' });

  const mod = u.protocol === 'https:' ? https : require('http');
  const proxyReq = mod.get(targetUrl, { headers: { 'User-Agent': 'GalaxyStudio/2.0' } }, proxyRes => {
    if (proxyRes.statusCode > 399) {
      return res.status(proxyRes.statusCode).json({ error: `HTTP ${proxyRes.statusCode}` });
    }
    let body = '';
    proxyRes.setEncoding('utf8');
    proxyRes.on('data', c => { if (body.length < 200000) body += c; });
    proxyRes.on('end', () => {
      res.json({ content: body, contentType: proxyRes.headers['content-type'] || '' });
    });
  });
  proxyReq.on('error', err => res.status(502).json({ error: err.message }));
  proxyReq.setTimeout(8000, () => { proxyReq.destroy(); res.status(408).json({ error: 'Request timed out' }); });
});

// ── STATIC FILES ──
// Serve the project root as static files (for dev).
// In production, set STATIC_DIR to ./public or ./dist.
const STATIC_DIR = process.env.STATIC_DIR || __dirname;

app.use(express.static(STATIC_DIR, {
  index: 'index.html',
  dotfiles: 'ignore',
  setHeaders(res, filePath) {
    // Prevent path traversal by ensuring resolved path is inside STATIC_DIR
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(STATIC_DIR))) {
      res.status(403).end('Forbidden');
    }
  }
}));

// ── SHARE ROUTES ──
// /p/<slug> loads the SPA which detects the slug and renders public preview
app.get('/p/:slug', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// ── SPA FALLBACK ──
app.get('*', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// ── START ──
app.listen(PORT, () => {
  console.log(`\n  ✦ Galaxy Studio server running at:`);
  console.log(`    → http://localhost:${PORT}`);
  console.log(`  Proxy routes:`);
  console.log(`    /proxy/gemini     → generativelanguage.googleapis.com`);
  console.log(`    /proxy/ollama     → ollama.com`);
  console.log(`    /proxy/anthropic  → api.anthropic.com`);
  console.log(`    /proxy/openai     → api.openai.com`);
  console.log(`    /proxy/openrouter → openrouter.ai`);
  console.log(`    /proxy/search     → DuckDuckGo (no key needed)`);
  console.log(`    /proxy/fetch      → arbitrary URL fetcher\n`);
});
