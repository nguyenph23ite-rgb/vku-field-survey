const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'server-data');
const DATA_FILE = path.join(DATA_DIR, 'surveys.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

const server = http.createServer((req, res) => {
  console.log(new Date().toLocaleTimeString(), req.method, req.url);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.url === '/api/health' && req.method === 'GET') {
    res.writeHead(200);
    return res.end(JSON.stringify({ success: true }));
  }

  if (req.url === '/api/surveys' && req.method === 'GET') {
    res.writeHead(200);
    return res.end(fs.readFileSync(DATA_FILE, 'utf8'));
  }

  if (req.url === '/api/surveys' && req.method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        res.writeHead(413);
        res.end(JSON.stringify({ success: false, error: 'Payload too large' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const survey = JSON.parse(body);

        if (
          !survey ||
          typeof survey.building !== 'string' ||
          typeof survey.room !== 'string' ||
          typeof survey.item !== 'string' ||
          typeof survey.condition !== 'string'
        ) {
          res.writeHead(400);
          return res.end(JSON.stringify({ success: false, error: 'Invalid survey' }));
        }

        const surveys = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const clientId = String(survey.id ?? '');

        if (clientId && surveys.some(item => item.clientId === clientId)) {
          res.writeHead(200);
          return res.end(JSON.stringify({ success: true, duplicate: true }));
        }

        surveys.push({
          ...survey,
          clientId,
          receivedAt: new Date().toISOString()
        });

        fs.writeFileSync(DATA_FILE, JSON.stringify(surveys, null, 2), 'utf8');
        res.writeHead(201);
        res.end(JSON.stringify({ success: true }));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      }
    });

    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ success: false, error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`VKU Survey API running at http://127.0.0.1:${PORT}`);
});

