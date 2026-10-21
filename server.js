// Servidor local do Ciclo RFB: serve o app e guarda o progresso dos ciclos
// num banco SQLite (data/progresso.db). Sem dependências: requer Node 22.13+.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'progresso.db');

// ---------- Catálogo de itens válidos (derivado de data.js) ----------
const DISC = ['LP', 'LI', 'RLM', 'EST', 'ECO', 'ADG', 'ADP', 'AUD', 'CG', 'CASP', 'FD', 'CI', 'DA', 'DC', 'DP', 'RT', 'DT', 'LT', 'PD'];
const EXTRAS = ['BIE', 'REP'];
const CICLOS = 40;

function buildCatalog() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'), sandbox);
  const cycles = [];
  let cur = null, code = null;
  sandbox.window.CICLO_RAW.split('\n').forEach(line => {
    line = line.trim();
    if (!line) return;
    if (line[0] === '@') { cur = { n: +line.slice(1), items: {} }; cycles.push(cur); return; }
    if (/^\d/.test(line)) { cur.items[code].push(line); return; }
    code = line;
    cur.items[code] = cur.items[code] || [];
  });

  const items = new Map(); // id -> { ciclo, disciplina, tipo }
  const count = Object.fromEntries(DISC.map(d => [d, 0]));
  cycles.forEach(c => {
    DISC.forEach(d => {
      const list = c.items[d] || [];
      if (!list.length) items.set(`r-${c.n}-${d}`, { ciclo: c.n, disciplina: d, tipo: 'revisao' });
      list.forEach(() => { count[d]++; items.set(`${d}-${count[d]}`, { ciclo: c.n, disciplina: d, tipo: 'aula' }); });
    });
    EXTRAS.forEach(e => (c.items[e] || []).forEach((_, i) =>
      items.set(`x-${e}-${c.n}-${i + 1}`, { ciclo: c.n, disciplina: e, tipo: 'extra' })));
  });
  return items;
}
const CATALOG = buildCatalog();

// ---------- Banco de dados ----------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- Cada aula, revisão ou extra marcado como concluído
  CREATE TABLE IF NOT EXISTS itens_concluidos (
    item_id      TEXT PRIMARY KEY,
    ciclo        INTEGER NOT NULL CHECK (ciclo BETWEEN 1 AND ${CICLOS}),
    disciplina   TEXT    NOT NULL,
    tipo         TEXT    NOT NULL CHECK (tipo IN ('aula', 'revisao', 'extra')),
    concluido_em TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_itens_ciclo ON itens_concluidos (ciclo);
  CREATE INDEX IF NOT EXISTS idx_itens_data  ON itens_concluidos (concluido_em);

  -- Fechamento de cada ciclo (as 3 caixas + os assuntos mais difíceis)
  CREATE TABLE IF NOT EXISTS fechamento_ciclo (
    ciclo             INTEGER PRIMARY KEY CHECK (ciclo BETWEEN 1 AND ${CICLOS}),
    revisar_resumos   INTEGER NOT NULL DEFAULT 0 CHECK (revisar_resumos IN (0, 1)),
    questoes_mistas   INTEGER NOT NULL DEFAULT 0 CHECK (questoes_mistas IN (0, 1)),
    assuntos_anotados INTEGER NOT NULL DEFAULT 0 CHECK (assuntos_anotados IN (0, 1)),
    assuntos_dificeis TEXT    NOT NULL DEFAULT '',
    atualizado_em     TEXT    NOT NULL
  );

  -- Dias em que a revisão rápida (10–15 min) foi feita
  CREATE TABLE IF NOT EXISTS revisao_diaria (
    data     TEXT PRIMARY KEY,
    feita_em TEXT NOT NULL
  );

  -- Resumo por ciclo, para consultas manuais
  CREATE VIEW IF NOT EXISTS v_progresso_ciclo AS
  SELECT ciclo,
         SUM(tipo = 'aula')    AS aulas_concluidas,
         SUM(tipo = 'revisao') AS revisoes_concluidas,
         SUM(tipo = 'extra')   AS extras_concluidos,
         MIN(concluido_em)     AS inicio,
         MAX(concluido_em)     AS ultima_marcacao
  FROM itens_concluidos GROUP BY ciclo;
`);

const CLOSING_COLS = { rev: 'revisar_resumos', mix: 'questoes_mistas', hard: 'assuntos_anotados' };

const q = {
  allItems: db.prepare('SELECT item_id, concluido_em FROM itens_concluidos'),
  allClosing: db.prepare('SELECT * FROM fechamento_ciclo'),
  allDaily: db.prepare('SELECT data FROM revisao_diaria'),
  insertItem: db.prepare(`INSERT INTO itens_concluidos (item_id, ciclo, disciplina, tipo, concluido_em)
                          VALUES (?, ?, ?, ?, ?) ON CONFLICT (item_id) DO NOTHING`),
  deleteItem: db.prepare('DELETE FROM itens_concluidos WHERE item_id = ?'),
  getClosing: db.prepare('SELECT * FROM fechamento_ciclo WHERE ciclo = ?'),
  upsertClosing: db.prepare(`INSERT INTO fechamento_ciclo
      (ciclo, revisar_resumos, questoes_mistas, assuntos_anotados, assuntos_dificeis, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (ciclo) DO UPDATE SET
        revisar_resumos = excluded.revisar_resumos, questoes_mistas = excluded.questoes_mistas,
        assuntos_anotados = excluded.assuntos_anotados, assuntos_dificeis = excluded.assuntos_dificeis,
        atualizado_em = excluded.atualizado_em`),
  insertDaily: db.prepare('INSERT INTO revisao_diaria (data, feita_em) VALUES (?, ?) ON CONFLICT (data) DO NOTHING'),
  deleteDaily: db.prepare('DELETE FROM revisao_diaria WHERE data = ?'),
};

function transaction(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function readProgress() {
  const done = {};
  q.allItems.all().forEach(r => { done[r.item_id] = r.concluido_em; });
  const closing = {};
  q.allClosing.all().forEach(r => {
    closing[r.ciclo] = { rev: !!r.revisar_resumos, mix: !!r.questoes_mistas, hard: !!r.assuntos_anotados, text: r.assuntos_dificeis };
  });
  const daily = {};
  q.allDaily.all().forEach(r => { daily[r.data] = true; });
  return { done, closing, daily };
}

// ---------- Validação ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTs = s => typeof s === 'string' && !Number.isNaN(Date.parse(s));
function cicloParam(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > CICLOS) throw new HttpError(400, 'Ciclo inválido');
  return n;
}
function itemMeta(id) {
  const m = CATALOG.get(id);
  if (!m) throw new HttpError(400, `Item desconhecido: ${id}`);
  return m;
}

function setItems(ids, concluido, when = new Date().toISOString()) {
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Informe "ids"');
  const metas = ids.map(id => [id, itemMeta(id)]);
  transaction(() => metas.forEach(([id, m]) => {
    if (concluido) q.insertItem.run(id, m.ciclo, m.disciplina, m.tipo, when);
    else q.deleteItem.run(id);
  }));
}

function setClosing(ciclo, patch) {
  const cur = q.getClosing.get(ciclo) || { revisar_resumos: 0, questoes_mistas: 0, assuntos_anotados: 0, assuntos_dificeis: '' };
  for (const [k, col] of Object.entries(CLOSING_COLS)) if (k in patch) cur[col] = patch[k] ? 1 : 0;
  if ('text' in patch) cur.assuntos_dificeis = String(patch.text ?? '').slice(0, 5000);
  q.upsertClosing.run(ciclo, cur.revisar_resumos, cur.questoes_mistas, cur.assuntos_anotados, cur.assuntos_dificeis, new Date().toISOString());
}

function clearAll() {
  db.exec('DELETE FROM itens_concluidos; DELETE FROM fechamento_ciclo; DELETE FROM revisao_diaria;');
}

function replaceAll(p) {
  if (!p || typeof p.done !== 'object') throw new HttpError(400, 'Formato inválido');
  const done = Object.entries(p.done).filter(([id, ts]) => CATALOG.has(id) && isTs(ts));
  const closing = Object.entries(p.closing || {}).filter(([n]) => Number.isInteger(+n) && +n >= 1 && +n <= CICLOS);
  const daily = Object.keys(p.daily || {}).filter(isDay);
  transaction(() => {
    clearAll();
    done.forEach(([id, ts]) => { const m = CATALOG.get(id); q.insertItem.run(id, m.ciclo, m.disciplina, m.tipo, ts); });
    closing.forEach(([n, c]) => setClosing(+n, c || {}));
    const now = new Date().toISOString();
    daily.forEach(d => q.insertDaily.run(d, now));
  });
}

// ---------- HTTP ----------
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/data.js': ['data.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new HttpError(413, 'Corpo muito grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // remove "api"
  const route = `${req.method} /${parts[0] || ''}`;

  switch (route) {
    case 'GET /saude':
      return send(res, 200, { ok: true, banco: path.relative(ROOT, DB_FILE) });

    case 'GET /progresso':
      return send(res, 200, readProgress());

    case 'PUT /progresso': // importação / migração: substitui tudo
      replaceAll(await readJson(req));
      return send(res, 200, readProgress());

    case 'DELETE /progresso':
      transaction(clearAll);
      return send(res, 200, { ok: true });

    case 'POST /itens': {
      const body = await readJson(req);
      setItems(body.ids, !!body.concluido);
      return send(res, 200, { ok: true });
    }

    case 'PUT /fechamento': {
      const ciclo = cicloParam(parts[1]);
      setClosing(ciclo, await readJson(req));
      return send(res, 200, { ok: true });
    }

    case 'PUT /revisao-diaria': {
      if (!isDay(parts[1])) throw new HttpError(400, 'Data inválida (use AAAA-MM-DD)');
      const body = await readJson(req);
      if (body.feita) q.insertDaily.run(parts[1], new Date().toISOString());
      else q.deleteDaily.run(parts[1]);
      return send(res, 200, { ok: true });
    }
  }
  throw new HttpError(404, 'Rota não encontrada');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const file = STATIC[url.pathname];
    if (!file || req.method !== 'GET') throw new HttpError(404, 'Não encontrado');
    send(res, 200, fs.readFileSync(path.join(ROOT, file[0])), file[1]);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    send(res, status, { erro: status === 500 ? 'Erro interno' : err.message });
  }
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Ciclo RFB rodando em http://${shown}:${PORT}`);
  console.log(`Banco de dados: ${DB_FILE}`);
});

process.on('SIGINT', () => { db.close(); process.exit(0); });
