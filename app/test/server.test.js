// Smoke test: starts the real server and calls every route.
// Without a database by default; set TEST_DATABASE_URL to also check the heartbeat.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${PORT}`;
const withDb = Boolean(process.env.TEST_DATABASE_URL);
let child;

before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      PATH: process.env.PATH,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      IAC_ENVIRONMENT: 'staging',
      IAC_SOURCE: 'infra/staging/main.tf',
      IAC_MIN_INSTANCES: '1',
      IAC_MAX_INSTANCES: '1',
      IAC_DB_PLAN: 'xxs_sml',
      IAC_DB_ENCRYPTION: 'true',
      ...(withDb ? { DATABASE_URL: process.env.TEST_DATABASE_URL } : {}),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (b) => b.toString().includes('listening') && resolve());
    child.on('exit', (code) => reject(new Error(`server exited with ${code}`)));
  });
});

after(() => child?.kill('SIGTERM'));

test('home page shows the environment', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /This is <span class="env-name">staging<\/span>/);
  assert.match(html, /class="env-staging"/);
  assert.doesNotMatch(html, /__[A-Z]+__/);
  assert.match(html, /href="https:\/\/academy\.clever\.cloud\/"/);
  assert.match(html, /class="cc-cert__badge"/);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
});

test('state reports the declaration and this instance', async () => {
  const st = await (await fetch(`${base}/api/state`)).json();
  assert.equal(st.declared.environment, 'staging');
  assert.equal(st.declared.minInstances, 1);
  assert.equal(st.declared.dbEncryption, true);
  assert.equal(st.instances.length, 1);
  assert.equal(st.instances[0].self, true);
  assert.equal(st.database.connected, withDb);
  assert.ok(!JSON.stringify(st).includes('postgres://'), 'no connection string in the state');
});

test('health checks', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/health/deep`)).status, withDb ? 200 : 503);
});

test('assets and 404', async () => {
  for (const path of ['/app.css', '/app.js', '/cc-brand.css', '/cc-logo.svg']) {
    assert.equal((await fetch(`${base}${path}`)).status, 200, path);
  }
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
});
