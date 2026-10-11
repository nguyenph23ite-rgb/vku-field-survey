const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const net = require('node:net');
const test = require('node:test');

const serverPath = path.resolve(__dirname, '..', 'server.cjs');

async function reservePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startTestServer(t, initialSurveys) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vku-survey-api-test-'));
  fs.writeFileSync(
    path.join(dataDir, 'surveys.json'),
    JSON.stringify(initialSurveys, null, 2),
    'utf8',
  );

  const port = await reservePort();
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      VKU_SURVEY_PORT: String(port),
      VKU_SURVEY_DATA_DIR: dataDir,
    },
    stdio: 'ignore',
  });

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Test API exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  assert.equal(ready, true, 'temporary test API should become ready');
  return { baseUrl, dataFile: path.join(dataDir, 'surveys.json') };
}

function makeSurvey(syncId, overrides = {}) {
  return {
    syncId,
    building: 'A',
    room: '101',
    item: 'Door',
    condition: 'Good',
    description: 'Survey payload',
    createdAt: '2026-10-11T00:00:00.000Z',
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

test('UUID POST/DELETE are idempotent and legacy data/deletes stay protected', async t => {
  const initialSurveys = [
    { id: 7, clientId: '7', building: 'Legacy A' },
    { id: 77, clientId: '77', building: 'Legacy B1' },
    { id: 77, clientId: '77', building: 'Legacy B2' },
  ];
  const { baseUrl, dataFile } = await startTestServer(t, initialSurveys);

  const firstId = '11111111-1111-4111-8111-111111111111';
  const secondId = '22222222-2222-4222-8222-222222222222';
  const firstSurvey = makeSurvey(firstId, { id: 1 });

  let response = await fetch(`${baseUrl}/api/surveys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(firstSurvey),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true });

  response = await fetch(`${baseUrl}/api/surveys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(firstSurvey),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, duplicate: true });

  response = await fetch(`${baseUrl}/api/surveys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(makeSurvey(firstId, { id: 1, description: 'Changed payload' })),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).success, false);

  response = await fetch(`${baseUrl}/api/surveys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(makeSurvey(secondId, { id: 1 })),
  });
  assert.equal(response.status, 201, 'different devices may have the same local numeric id');

  let stored = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const firstStored = stored.find(item => item.syncId === firstId);
  assert.equal(firstStored.clientId, firstId);
  assert.equal(Object.hasOwn(firstStored, 'id'), false, 'new server rows must not store the local IndexedDB key');
  assert.equal(stored.filter(item => item.syncId === firstId).length, 1);
  assert.equal(stored.filter(item => item.syncId === secondId).length, 1);

  response = await fetch(`${baseUrl}/api/surveys`);
  const getRecords = await response.json();
  const getFirst = getRecords.find(item => item.syncId === firstId);
  assert.equal(getFirst.clientId, firstId);
  assert.equal(Object.hasOwn(getFirst, 'id'), false);
  assert.equal(getRecords.some(item => item.clientId === '7' && item.building === 'Legacy A'), true);

  response = await fetch(`${baseUrl}/api/surveys/${firstId}`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, deleted: 1 });

  response = await fetch(`${baseUrl}/api/surveys/${firstId}`, { method: 'DELETE' });
  assert.deepEqual(await response.json(), { success: true, deleted: 0 });

  response = await fetch(`${baseUrl}/api/surveys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 9,
      building: 'Legacy',
      room: '9',
      item: 'Window',
      condition: 'Fair',
    }),
  });
  assert.equal(response.status, 201);

  response = await fetch(`${baseUrl}/api/surveys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 9,
      building: 'Legacy',
      room: '9',
      item: 'Window',
      condition: 'Fair',
    }),
  });
  assert.equal(response.status, 200, 'legacy POST retries retain the numeric dedupe behavior');
  assert.deepEqual(await response.json(), { success: true, duplicate: true });

  response = await fetch(`${baseUrl}/api/surveys/9`, { method: 'DELETE' });
  assert.equal(response.status, 409, 'legacy numeric delete must be retained for reconciliation');
  assert.equal((await response.json()).success, false);

  response = await fetch(`${baseUrl}/api/surveys/77`, { method: 'DELETE' });
  assert.equal(response.status, 409, 'ambiguous legacy numeric delete must not delete multiple rows');

  stored = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.deepEqual(
    stored.filter(item => item.clientId === '77').map(item => item.building),
    ['Legacy B1', 'Legacy B2'],
  );
  assert.equal(stored.some(item => item.syncId === secondId), true);
  assert.equal(stored.some(item => item.clientId === '9'), true);
});
