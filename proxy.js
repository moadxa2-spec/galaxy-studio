const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function addCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const server = http.createServer((req, res) => {
  addCorsHeaders(res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── PROXY: /proxy/ollama/* → https://ollama.com/* ──
  if (req.url.startsWith('/proxy/ollama/')) {
    const targetPath = req.url.replace('/proxy/ollama', '');
    const targetUrl = `https://ollama.com${targetPath}`;

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      body = Buffer.concat(body);

      const parsedUrl = new URL(targetUrl);
      const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'User-Agent': 'AppBuilder/1.0',
        },
      };

      // Forward the Authorization header if present
      if (req.headers['authorization']) {
        options.headers['Authorization'] = req.headers['authorization'];
      }

      if (body.length > 0) {
        options.headers['Content-Length'] = body.length;
      }

      const proxyReq = https.request(options, (proxyRes) => {
        addCorsHeaders(res);
        res.writeHead(proxyRes.statusCode, {
          ...proxyRes.headers,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('Proxy error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
      });

      if (body.length > 0) proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // ── PROXY: /proxy/gemini/* → https://generativelanguage.googleapis.com/* ──
  if (req.url.startsWith('/proxy/gemini/')) {
    const targetPath = req.url.replace('/proxy/gemini', '');
    const targetUrl = `https://generativelanguage.googleapis.com${targetPath}`;

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      body = Buffer.concat(body);

      const parsedUrl = new URL(targetUrl);
      const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'User-Agent': 'AppBuilder/1.0',
        },
      };

      if (body.length > 0) {
        options.headers['Content-Length'] = body.length;
      }

      const proxyReq = https.request(options, (proxyRes) => {
        addCorsHeaders(res);
        res.writeHead(proxyRes.statusCode, {
          ...proxyRes.headers,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('Proxy error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
      });

      if (body.length > 0) proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // ── STATIC FILE SERVER ──
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  ✦ App Builder Server running at:`);
  console.log(`    → http://localhost:${PORT}\n`);
  console.log(`  Proxy routes:`);
  console.log(`    /proxy/ollama/*  → https://ollama.com/*`);
  console.log(`    /proxy/gemini/*  → https://generativelanguage.googleapis.com/*\n`);
});
