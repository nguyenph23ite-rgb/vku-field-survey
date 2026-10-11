const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.VKU_SURVEY_PORT || 3000);
const DATA_DIR = process.env.VKU_SURVEY_DATA_DIR || path.join(__dirname, 'server-data');
const DATA_FILE = path.join(DATA_DIR, 'surveys.json');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SURVEY_IDENTITY_FIELDS = [
  'building', 'room', 'item', 'condition', 'description', 'createdAt',
  'latitude', 'longitude', 'photoDataUrl'
];

function sameSurveyIdentity(left, right) {
  return SURVEY_IDENTITY_FIELDS.every(
    field => JSON.stringify(left[field] ?? null) === JSON.stringify(right[field] ?? null)
  );
}

function sendJson(res, status, body) {
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

const server = http.createServer((req, res) => {
  console.log(new Date().toLocaleTimeString(), req.method, req.url);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

  const deleteMatch = req.url.match(/^\/api\/surveys\/([^/?]+)$/);

  if (req.method === 'DELETE' && deleteMatch) {
    try {
      const targetId = decodeURIComponent(deleteMatch[1]);
      const surveys = JSON.parse(
        fs.readFileSync(DATA_FILE, 'utf8').replace(/^\uFEFF/, '')
      );

      if (UUID_PATTERN.test(targetId)) {
        const matches = surveys.filter(item => item.syncId === targetId);

        if (matches.length > 1) {
          return sendJson(res, 409, {
            success: false,
            error: 'Ambiguous syncId; no records were deleted'
          });
        }

        const remaining = matches.length === 0
          ? surveys
          : surveys.filter(item => item.syncId !== targetId);
        const deleted = surveys.length - remaining.length;

        if (deleted > 0) {
          fs.writeFileSync(DATA_FILE, JSON.stringify(remaining, null, 2), 'utf8');
        }

        return sendJson(res, 200, { success: true, deleted });
      }

      if (!/^\d+$/.test(targetId)) {
        return sendJson(res, 400, {
          success: false,
          error: 'Invalid survey identifier'
        });
      }

      const legacyMatches = surveys.filter(
        item => !item.syncId && String(item.clientId ?? item.id ?? '') === targetId
      );

      // Legacy numeric IDs have no device provenance. Even one match may belong
      return sendJson(res, 409, {
        success: false,
        error: legacyMatches.length === 0
          ? 'Legacy delete target is not confirmed; request must be reconciled'
          : 'Legacy numeric delete target cannot be identified safely'
      });
    } catch (error) {
      console.error('[DELETE /api/surveys] Error:', error);
      res.writeHead(500);
      return res.end(JSON.stringify({
        success: false,
        error: 'Internal server error'
      }));
    }
  }
  if (req.url === '/api/surveys' && req.method === 'POST') {
    let body = '';
    let payloadTooLarge = false;
    const MAX_BODY_SIZE = 10 * 1024 * 1024;
    let bodyBytes = 0;

    req.on('data', chunk => {
      if (payloadTooLarge) return;

      bodyBytes += chunk.length;
      if (bodyBytes > MAX_BODY_SIZE) {
        payloadTooLarge = true;
        res.writeHead(413);
        res.end(JSON.stringify({ success: false, error: 'Payload too large (max 10 MiB)' }));
        req.resume();
        return;
      }

      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (payloadTooLarge) return;
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

        if (survey.syncId !== undefined &&
            (typeof survey.syncId !== 'string' || !UUID_PATTERN.test(survey.syncId))) {
          return sendJson(res, 400, {
            success: false,
            error: 'Invalid syncId'
          });
        }

        const surveys = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8').replace(/^\uFEFF/, ''));

        if (survey.syncId) {
          const matches = surveys.filter(item => item.syncId === survey.syncId);

          if (matches.length > 1) {
            return sendJson(res, 409, {
              success: false,
              error: 'Ambiguous syncId already exists'
            });
          }

          if (matches.length === 1) {
            if (!sameSurveyIdentity(matches[0], survey)) {
              return sendJson(res, 409, {
                success: false,
                error: 'syncId is already associated with a different survey payload'
              });
            }

            return sendJson(res, 200, { success: true, duplicate: true });
          }

          const storedSurvey = { ...survey };
          delete storedSurvey.id;
          delete storedSurvey.syncStatus;
          delete storedSurvey.clientId;
          delete storedSurvey.receivedAt;

          surveys.push({
            ...storedSurvey,
            clientId: survey.syncId,
            receivedAt: new Date().toISOString()
          });
        } else {
          const clientId = String(survey.id ?? '');

          if (clientId && surveys.some(
            item => !item.syncId && String(item.clientId ?? '') === clientId
          )) {
            res.writeHead(200);
            return res.end(JSON.stringify({ success: true, duplicate: true }));
          }

          surveys.push({
            ...survey,
            clientId,
            receivedAt: new Date().toISOString()
          });
        }

        fs.writeFileSync(DATA_FILE, JSON.stringify(surveys, null, 2), 'utf8');
        res.writeHead(201);
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        console.error('[POST /api/surveys] Error:', error);

        if (error instanceof SyntaxError) {
          res.writeHead(400);
          return res.end(JSON.stringify({
            success: false,
            error: 'Invalid JSON'
          }));
        }

        res.writeHead(500);
        res.end(JSON.stringify({
          success: false,
          error: 'Internal server error'
        }));
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


