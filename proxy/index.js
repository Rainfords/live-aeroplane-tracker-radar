const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 8080;
const OPENSKY_BASE = 'https://opensky-network.org/api/states/all';

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const apiUrl = `${OPENSKY_BASE}${qs}`;

  try {
    const data = await get(apiUrl);
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
    res.end(data);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json', ...corsHeaders() });
    res.end(JSON.stringify({ error: err.message }));
  }
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=15',
  };
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 20000 }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject).on('timeout', function () {
      this.destroy(new Error('Request timed out'));
    });
  });
}

server.listen(PORT, () => console.log(`Proxy listening on ${PORT}`));
