// Blueprint: shows what Terraform declared for this environment
// and what actually runs on Clever Cloud right now.
import http from 'node:http';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const BEAT_MS = 3000;
const ALIVE_S = 12;

// What Terraform declared: the module turns its inputs into these variables.
const env = process.env;
const declared = {
  environment: env.IAC_ENVIRONMENT || 'local',
  source: env.IAC_SOURCE || 'not deployed by Terraform',
  region: env.IAC_REGION || null,
  smallestFlavor: env.IAC_SMALLEST_FLAVOR || null,
  biggestFlavor: env.IAC_BIGGEST_FLAVOR || null,
  minInstances: toInt(env.IAC_MIN_INSTANCES),
  maxInstances: toInt(env.IAC_MAX_INSTANCES),
  dbPlan: env.IAC_DB_PLAN || null,
  dbVersion: env.IAC_DB_VERSION || null,
  dbEncryption: env.IAC_DB_ENCRYPTION ? env.IAC_DB_ENCRYPTION === 'true' : null,
  dbBackup: env.IAC_DB_BACKUP ? env.IAC_DB_BACKUP === 'true' : null,
  dbId: env.IAC_DB_ID || null,
};

// This instance, as measured from inside it.
const self = {
  id: env.INSTANCE_ID || `${os.hostname()}-${process.pid}`,
  number: toInt(env.INSTANCE_NUMBER) ?? 0,
  deployment: env.CC_DEPLOYMENT_ID || 'local',
  vcpus: os.availableParallelism(),
  memoryMb: Math.round(os.totalmem() / 1048576),
  startedAt: new Date(),
  requests: 0,
};

// Only a fixed list of platform variables is shown, never the whole environment.
const platform = {
  CC_APP_NAME: env.CC_APP_NAME || null,
  APP_ID: env.APP_ID || null,
  INSTANCE_NUMBER: env.INSTANCE_NUMBER ?? null,
  INSTANCE_TYPE: env.INSTANCE_TYPE || null,
  CC_PRETTY_INSTANCE_NAME: env.CC_PRETTY_INSTANCE_NAME || null,
  CC_COMMIT_ID: env.CC_COMMIT_ID || null,
  CC_DEPLOYMENT_ID: env.CC_DEPLOYMENT_ID || null,
};

// The add-on variable is read here, at runtime: never copied into another variable.
const dbUrl = env.POSTGRESQL_ADDON_URI || env.DATABASE_URL;
const pool = dbUrl ? new pg.Pool({ connectionString: dbUrl, max: 3, connectionTimeoutMillis: 4000 }) : null;
pool?.on('error', (err) => console.error('pg pool error:', err.code || err.message));

const db = { connected: false, error: pool ? null : 'no database configured', info: null, instances: [] };
let schemaReady = false;

async function beat() {
  if (!pool) return;
  try {
    if (!schemaReady) {
      await pool.query(`CREATE TABLE IF NOT EXISTS blueprint_instances (
        instance_id     text PRIMARY KEY,
        instance_number int NOT NULL,
        deployment_id   text NOT NULL,
        vcpus           int NOT NULL,
        memory_mb       int NOT NULL,
        requests        int NOT NULL DEFAULT 0,
        started_at      timestamptz NOT NULL,
        last_seen       timestamptz NOT NULL DEFAULT now()
      )`);
      schemaReady = true;
    }
    await pool.query(
      `INSERT INTO blueprint_instances (instance_id, instance_number, deployment_id, vcpus, memory_mb, requests, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (instance_id) DO UPDATE SET requests = EXCLUDED.requests, last_seen = now()`,
      [self.id, self.number, self.deployment, self.vcpus, self.memoryMb, self.requests, self.startedAt],
    );
    const alive = await pool.query(
      `SELECT instance_id, instance_number, deployment_id, vcpus, memory_mb, requests, started_at
         FROM blueprint_instances
        WHERE last_seen > now() - make_interval(secs => $1)
        ORDER BY instance_number, started_at`,
      [ALIVE_S],
    );
    const info = await pool.query(
      `SELECT current_setting('server_version') AS version,
              current_database() AS name,
              pg_database_size(current_database()) AS bytes`,
    );
    await pool.query(`DELETE FROM blueprint_instances WHERE last_seen < now() - interval '10 minutes'`);
    db.instances = alive.rows.map((r) => ({
      id: r.instance_id,
      number: r.instance_number,
      deployment: r.deployment_id,
      vcpus: r.vcpus,
      memoryMb: r.memory_mb,
      requests: r.requests,
      startedAt: r.started_at,
    }));
    db.info = { version: info.rows[0].version, name: info.rows[0].name, bytes: Number(info.rows[0].bytes) };
    db.connected = true;
    db.error = null;
  } catch (err) {
    // The message of a pg error may carry connection details: log the code, show a generic text.
    console.error('heartbeat failed:', err.code || err.message);
    db.connected = false;
    db.error = 'database unreachable';
  }
}

function state() {
  const instances = db.connected && db.instances.length ? db.instances : [selfAsRow()];
  return {
    declared,
    servedBy: self.id,
    instances: instances.map((i) => ({ ...i, self: i.id === self.id, current: i.deployment === self.deployment })),
    database: { connected: db.connected, error: db.error, ...(db.info || {}) },
    platform,
    now: new Date(),
  };
}

function selfAsRow() {
  const { id, number, deployment, vcpus, memoryMb, requests, startedAt } = self;
  return { id, number, deployment, vcpus, memoryMb, requests, startedAt };
}

const ASSETS = {
  '/app.css': ['public/app.css', 'text/css; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/cc-brand.css': ['public/cc-brand.css', 'text/css; charset=utf-8'],
  '/cc-logo.svg': ['public/cc-logo.svg', 'image/svg+xml'],
};
const files = {};
for (const [route, [path]] of Object.entries(ASSETS)) {
  files[route] = await readFile(new URL(path, import.meta.url));
}
const page = (await readFile(new URL('public/index.html', import.meta.url), 'utf8')).replace(
  '__LOGO__',
  files['/cc-logo.svg'].toString('utf8'),
);

const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; frame-ancestors 'none'",
};

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { ...HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'method not allowed');

  if (pathname === '/') {
    self.requests++;
    const json = JSON.stringify(state()).replace(/</g, '\\u003c');
    const html = page
      .replaceAll('__ENVIRONMENT__', escapeHtml(declared.environment))
      .replace('__STATE__', json);
    return send(res, 200, 'text/html; charset=utf-8', html, { 'Cache-Control': 'no-store' });
  }
  if (pathname === '/api/state') {
    self.requests++;
    return send(res, 200, 'application/json', JSON.stringify(state()), { 'Cache-Control': 'no-store' });
  }
  if (pathname === '/health') return send(res, 200, 'text/plain', 'ok');
  if (pathname === '/health/deep') {
    await beat();
    return db.connected
      ? send(res, 200, 'text/plain', 'ok: database reachable')
      : send(res, 503, 'text/plain', `degraded: ${db.error}`);
  }
  if (files[pathname]) {
    return send(res, 200, ASSETS[pathname][1], files[pathname], { 'Cache-Control': 'public, max-age=300' });
  }
  return send(res, 404, 'text/plain', 'not found');
});

await beat();
const timer = setInterval(beat, BEAT_MS);
server.listen(PORT, HOST, () => {
  console.log(`blueprint (${declared.environment}) listening on ${HOST}:${PORT}, instance ${self.number}`);
});

// On stop, leave the board at once instead of waiting for the row to go stale.
async function shutdown(signal) {
  console.log(`${signal} received, leaving`);
  clearInterval(timer);
  server.close();
  try {
    await pool?.query('DELETE FROM blueprint_instances WHERE instance_id = $1', [self.id]);
    await pool?.end();
  } catch {
    // Exiting anyway.
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function toInt(value) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isNaN(n) ? null : n;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
