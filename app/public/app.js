// Blueprint: renders the state, then refreshes it every 3 seconds.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let state = JSON.parse($('initial-state').textContent);
let fetchedAt = Date.now();

function hclValue(v) {
  if (v === null || v === undefined) return '<span class="c">null</span>';
  if (typeof v === 'number') return `<span class="n">${v}</span>`;
  if (typeof v === 'boolean') return `<span class="b">${v}</span>`;
  return `<span class="s">"${esc(v)}"</span>`;
}

function renderDeclaration(d) {
  const rows = [
    ['environment', d.environment],
    ['region', d.region],
    ['smallest_flavor', d.smallestFlavor],
    ['biggest_flavor', d.biggestFlavor],
    ['min_instances', d.minInstances],
    ['max_instances', d.maxInstances],
    ['db_plan', d.dbPlan],
    ['db_version', d.dbVersion],
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  const body = rows.map(([k, v]) => `  <span class="a">${k.padEnd(width)}</span> = ${hclValue(v)}`).join('\n');
  $('declaration').innerHTML =
    `<span class="k">module</span> <span class="s">"webapp"</span> {\n` +
    `  <span class="a">source</span> = <span class="s">"../modules/webapp"</span>\n\n` +
    `${body}\n}\n\n` +
    `<span class="c"># The module sets encryption = true on every\n# database, and refuses the shared dev plan.</span>`;
  $('source').textContent = d.source;
}

function size(mb) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GiB` : `${mb} MiB`;
}

function uptime(since) {
  const s = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

function renderInstances(st) {
  const d = st.declared;
  const me = st.instances.find((i) => i.self);
  const current = st.instances.filter((i) => i.current);
  const stopping = st.instances.length - current.length;
  const alive = st.instances.map((i) => {
    const cls = ['tile', i.self ? 'tile--self' : '', i.current ? '' : 'tile--old'].join(' ');
    let tag = '';
    if (i.self) tag = 'Served this page';
    else if (!i.current) tag = me && new Date(i.startedAt) > new Date(me.startedAt) ? 'New deployment' : 'Previous deployment';
    return `<div class="${cls}">
        <span class="tile__led" aria-hidden="true"></span>
        <div class="tile__num"><small>#</small>${esc(i.number)}</div>
        <div class="tile__size">${esc(i.vcpus)} vCPU · ${esc(size(i.memoryMb))}</div>
        <div class="tile__meta">up ${esc(uptime(i.startedAt))} · ${esc(i.requests)} req.</div>
        ${tag ? `<span class="tile__tag">${tag}</span>` : ''}
      </div>`;
  });
  // Declared but not running (yet): below the minimum, or room left for autoscaling.
  const missing = d.minInstances === null ? 0 : Math.max(0, d.minInstances - current.length);
  const room = d.maxInstances === null ? 0 : Math.max(0, d.maxInstances - Math.max(current.length, d.minInstances));
  const empty = (label, hint, cls) => `<div class="tile tile--empty ${cls}">
        <div class="tile__num"><small>#</small>?</div>
        <div class="tile__size">${label}</div>
        <div class="tile__meta">${hint}</div>
      </div>`;
  $('instances').innerHTML = [
    ...alive,
    ...Array.from({ length: missing }, () => empty('Declared', 'starting…', 'tile--starting')),
    ...Array.from({ length: room }, () => empty('Room to scale', `autoscaling up to ${d.maxInstances}`, '')),
  ].join('');

  const pill = $('match');
  if (d.minInstances === null) {
    pill.textContent = `${current.length} alive`;
    pill.className = 'cc-pill';
  } else {
    const range = d.minInstances === d.maxInstances ? `${d.minInstances}` : `${d.minInstances}–${d.maxInstances}`;
    const ok = current.length >= d.minInstances && current.length <= d.maxInstances;
    pill.textContent = `${current.length} alive · ${range} declared${stopping ? ` · ${stopping} stopping` : ''}`;
    pill.className = `cc-pill ${ok ? 'match--ok' : 'match--warn'}`;
  }
  $('instances-foot').textContent = stopping
    ? 'A deployment is rolling: Clever Cloud starts the new instances before it stops the old ones.'
    : 'Each instance writes a heartbeat into PostgreSQL every 3 s. This page asks every 3 s which ones are alive.';
}

function kv(rows) {
  return rows
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="${v === null || v === undefined ? 'is-empty' : ''}">${esc(v ?? 'not set')}</dd></div>`)
    .join('');
}

function renderDatabase(st) {
  const db = st.database;
  const d = st.declared;
  const onOff = (v) => (v === null ? null : v ? 'on' : 'off');
  $('database').innerHTML = kv([
    ['Engine', db.version ? `PostgreSQL ${db.version.split(' ')[0]}` : null],
    ['Plan', d.dbPlan],
    ['Encryption at rest', onOff(d.dbEncryption)],
    ['Daily backups', onOff(d.dbBackup)],
    ['Region', d.region],
    ['Size on disk', db.bytes ? size(Math.round(db.bytes / 1048576)) : null],
  ]);
  const pill = $('db-pill');
  pill.textContent = db.connected ? 'connected' : db.error || 'unreachable';
  pill.className = `cc-pill ${db.connected ? 'match--ok' : 'match--warn'}`;
}

function renderPlatform(st) {
  const p = st.platform;
  $('platform').innerHTML = kv(Object.entries(p));
  const me = st.instances.find((i) => i.self);
  $('served-by').textContent = me ? `instance #${me.number}` : 'this instance';
}

function render() {
  renderDeclaration(state.declared);
  renderInstances(state);
  renderDatabase(state);
  renderPlatform(state);
  tick();
}

function tick() {
  const s = Math.round((Date.now() - fetchedAt) / 1000);
  $('updated').textContent = s < 2 ? 'updated just now' : `updated ${s} s ago`;
}

async function refresh() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (res.ok) {
      state = await res.json();
      fetchedAt = Date.now();
      render();
    }
  } catch {
    // Keep the last state on screen; the footer shows its age.
  }
}

render();
setInterval(refresh, 3000);
setInterval(tick, 1000);
