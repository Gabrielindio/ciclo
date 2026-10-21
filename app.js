(() => {
  'use strict';

  // ---------- Definições ----------
  const AREAS = {
    bas: { name: 'Básicas', color: 'var(--a-bas)' },
    eco: { name: 'Economia e Gestão', color: 'var(--a-eco)' },
    con: { name: 'Contábeis', color: 'var(--a-con)' },
    dad: { name: 'Dados e Comércio', color: 'var(--a-dad)' },
    dir: { name: 'Direito', color: 'var(--a-dir)' },
    tri: { name: 'Tributárias', color: 'var(--a-tri)' },
    dis: { name: 'Discursiva', color: 'var(--a-dis)' },
    ext: { name: 'Extras', color: 'var(--a-ext)' },
  };

  const DISC = [
    ['LP', 'Língua Portuguesa', 'bas'],
    ['LI', 'Língua Inglesa', 'bas'],
    ['RLM', 'Raciocínio Lógico-Matemático', 'bas'],
    ['EST', 'Estatística', 'bas'],
    ['ECO', 'Economia e Finanças Públicas', 'eco'],
    ['ADG', 'Administração Geral', 'eco'],
    ['ADP', 'Administração Pública', 'eco'],
    ['AUD', 'Auditoria', 'con'],
    ['CG', 'Contabilidade Geral', 'con'],
    ['CASP', 'Contabilidade Aplicada ao Setor Público', 'con'],
    ['FD', 'Fluência em Dados', 'dad'],
    ['CI', 'Comércio Internacional', 'dad'],
    ['DA', 'Direito Administrativo', 'dir'],
    ['DC', 'Direito Constitucional', 'dir'],
    ['DP', 'Direito Previdenciário', 'dir'],
    ['RT', 'Reforma Tributária', 'tri'],
    ['DT', 'Direito Tributário', 'tri'],
    ['LT', 'Legislação Tributária', 'tri'],
    ['PD', 'Prova Discursiva', 'dis'],
  ].map(([code, name, area], i) => ({ code, name, area, num: i + 1, color: AREAS[area].color }));
  const DISC_BY = Object.fromEntries(DISC.map(d => [d.code, d]));

  const EXTRAS = [
    { code: 'BIE', name: 'Bônus – Inteligência Emocional', color: AREAS.ext.color },
    { code: 'REP', name: 'Reprise Eventos', color: AREAS.ext.color },
  ];

  const CLOSING = [
    ['rev', 'Revisar resumos e erros'],
    ['mix', 'Questões misturando as disciplinas'],
    ['hard', 'Anotar os 3 assuntos mais difíceis'],
  ];

  // ---------- Construção do modelo a partir dos dados ----------
  function parse(raw) {
    const cycles = [];
    let cur = null, code = null;
    raw.split('\n').forEach(line => {
      line = line.trim();
      if (!line) return;
      if (line[0] === '@') { cur = { n: +line.slice(1), items: {} }; cycles.push(cur); return; }
      if (/^\d/.test(line)) { cur.items[code].push(line); return; }
      code = line;
      cur.items[code] = cur.items[code] || [];
    });
    return cycles;
  }

  const CYCLES = parse(window.CICLO_RAW);
  const LESSONS = {};               // id -> aula
  const BY_DISC = {};               // código -> [aulas]
  DISC.forEach(d => { BY_DISC[d.code] = []; });

  let cumulative = 0;
  CYCLES.forEach(c => {
    c.disc = {};
    c.reviews = [];
    c.extras = [];
    c.newCount = 0;
    DISC.forEach(d => {
      const before = BY_DISC[d.code].length;
      const list = (c.items[d.code] || []).map((title, i) => {
        const idx = before + i + 1;
        const L = { id: `${d.code}-${idx}`, code: d.code, idx, title, cycle: c.n, kind: 'lesson' };
        LESSONS[L.id] = L;
        BY_DISC[d.code].push(L);
        return L;
      });
      c.disc[d.code] = { list, before };
      c.newCount += list.length;
    });
    EXTRAS.forEach(e => {
      (c.items[e.code] || []).forEach((title, i) => {
        const X = { id: `x-${e.code}-${c.n}-${i + 1}`, code: e.code, title, cycle: c.n, kind: 'extra' };
        LESSONS[X.id] = X;
        c.extras.push(X);
      });
    });
    cumulative += c.newCount;
    c.cumulative = cumulative;
  });
  const TOTAL = cumulative;
  DISC.forEach(d => { d.total = BY_DISC[d.code].length; d.endCycle = BY_DISC[d.code][d.total - 1].cycle; });

  // Tarefas de revisão para disciplinas sem aula nova no ciclo
  CYCLES.forEach(c => {
    DISC.forEach(d => {
      const info = c.disc[d.code];
      if (info.list.length) return;
      const finished = info.before >= d.total;
      let text;
      if (finished) text = d.code === 'PD' ? 'Disciplina concluída: continue treinando 1 texto por ciclo' : 'Disciplina concluída: revise o resumo e resolva questões';
      else text = d.code === 'PD' ? 'Sem aula nova neste ciclo: treine 1 texto ou questão discursiva' : 'Sem aula nova neste ciclo: revise seu resumo e resolva questões';
      const R = { id: `r-${c.n}-${d.code}`, code: d.code, title: text, cycle: c.n, kind: 'review', finished };
      LESSONS[R.id] = R;
      info.review = R;
      c.reviews.push(R);
    });
  });

  // ---------- Estado ----------
  // O progresso (done/closing/daily) é salvo em um destes lugares, nesta ordem:
  //  1. Supabase, se config.js estiver preenchido (exige login);
  //  2. banco SQLite local, se o app for servido pelo server.js;
  //  3. o próprio navegador (localStorage).
  // Preferências de tela (tema, filtro) ficam sempre no navegador.
  const KEY = 'cicloRFB:v1';
  const PREFS_KEY = 'cicloRFB:prefs';
  const SB_CFG = window.SUPABASE_CONFIG || {};
  const SB_WANTED = !!(SB_CFG.url && SB_CFG.anonKey);
  const API = location.protocol.startsWith('http') ? '/api' : null;
  const TIPO = { lesson: 'aula', review: 'revisao', extra: 'extra' };
  const WHERE = { supabase: 'da sua conta', server: 'do banco local', local: 'deste navegador' };
  let mode = 'local';      // 'supabase' | 'server' | 'local'
  let backend = null;      // null = navegador
  let sb = null, user = null;
  const emptyProgress = () => ({ done: {}, closing: {}, daily: {} });
  const defaults = () => Object.assign(emptyProgress(), { theme: 'auto', hideDone: false });
  let state = Object.assign(defaults(), readLocalProgress(), readPrefs());

  function readJsonKey(key) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : null; }
    catch (e) { return null; }
  }
  function readLocalProgress() {
    const s = readJsonKey(KEY);
    return s ? { done: s.done || {}, closing: s.closing || {}, daily: s.daily || {} } : emptyProgress();
  }
  function readPrefs() {
    const p = readJsonKey(PREFS_KEY) || readJsonKey(KEY) || {};
    return { theme: p.theme || 'auto', hideDone: !!p.hideDone };
  }
  function progressOf(s) { return { done: s.done, closing: s.closing, daily: s.daily }; }
  const isEmptyProgress = p => !Object.keys(p.done).length && !Object.keys(p.closing).length && !Object.keys(p.daily).length;

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: state.theme, hideDone: state.hideDone })); }
    catch (e) { /* preferências são opcionais */ }
  }
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(progressOf(state))); }
    catch (e) { toast('Não foi possível salvar no navegador.'); }
  }

  // ----- Servidor local (server.js + SQLite) -----
  async function api(method, url, body) {
    const r = await fetch(API + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.erro || `HTTP ${r.status}`);
    return data;
  }
  const serverBackend = {
    load: () => api('GET', '/progresso'),
    items: (ids, value) => api('POST', '/itens', { ids, concluido: value }),
    closing: n => api('PUT', `/fechamento/${n}`, state.closing[n] || {}),
    daily: (day, feita) => api('PUT', `/revisao-diaria/${day}`, { feita }),
    replace: p => api('PUT', '/progresso', p),
    clear: () => api('DELETE', '/progresso'),
  };

  // ----- Supabase -----
  const TABLES = ['itens_concluidos', 'fechamento_ciclo', 'revisao_diaria'];
  function sbCheck({ data, error }) { if (error) throw error; return data; }
  async function sbAll(table, cols) {
    const rows = [], size = 1000; // o Supabase devolve no máximo 1000 linhas por consulta
    for (let from = 0; ; from += size) {
      const data = sbCheck(await sb.from(table).select(cols).range(from, from + size - 1));
      rows.push(...data);
      if (data.length < size) return rows;
    }
  }
  async function sbInsert(table, rows) {
    for (let i = 0; i < rows.length; i += 500) sbCheck(await sb.from(table).insert(rows.slice(i, i + 500)));
  }
  function itemRow(id, when) {
    const L = LESSONS[id];
    return { user_id: user.id, item_id: id, ciclo: L.cycle, disciplina: L.code, tipo: TIPO[L.kind], concluido_em: when || new Date().toISOString() };
  }
  function closingRow(n, c = {}) {
    return {
      user_id: user.id, ciclo: +n,
      revisar_resumos: !!c.rev, questoes_mistas: !!c.mix, assuntos_anotados: !!c.hard,
      assuntos_dificeis: String(c.text || '').slice(0, 5000), atualizado_em: new Date().toISOString(),
    };
  }
  const supabaseBackend = {
    async load() {
      const [items, closings, days] = await Promise.all([
        sbAll('itens_concluidos', 'item_id, concluido_em'),
        sbAll('fechamento_ciclo', 'ciclo, revisar_resumos, questoes_mistas, assuntos_anotados, assuntos_dificeis'),
        sbAll('revisao_diaria', 'data'),
      ]);
      const p = emptyProgress();
      items.forEach(r => { p.done[r.item_id] = r.concluido_em; });
      closings.forEach(r => { p.closing[r.ciclo] = { rev: r.revisar_resumos, mix: r.questoes_mistas, hard: r.assuntos_anotados, text: r.assuntos_dificeis }; });
      days.forEach(r => { p.daily[r.data] = true; });
      return p;
    },
    async items(ids, value) {
      if (value) {
        const rows = ids.map(id => itemRow(id, state.done[id]));
        sbCheck(await sb.from('itens_concluidos').upsert(rows, { onConflict: 'user_id,item_id', ignoreDuplicates: true }));
      } else {
        sbCheck(await sb.from('itens_concluidos').delete().eq('user_id', user.id).in('item_id', ids));
      }
    },
    async closing(n) {
      sbCheck(await sb.from('fechamento_ciclo').upsert(closingRow(n, state.closing[n]), { onConflict: 'user_id,ciclo' }));
    },
    async daily(day, feita) {
      if (feita) sbCheck(await sb.from('revisao_diaria').upsert({ user_id: user.id, data: day }, { onConflict: 'user_id,data', ignoreDuplicates: true }));
      else sbCheck(await sb.from('revisao_diaria').delete().eq('user_id', user.id).eq('data', day));
    },
    async clear() {
      for (const t of TABLES) sbCheck(await sb.from(t).delete().eq('user_id', user.id));
    },
    async replace(p) {
      await supabaseBackend.clear();
      const ids = Object.keys(p.done).filter(id => LESSONS[id] && !Number.isNaN(Date.parse(p.done[id])));
      await sbInsert('itens_concluidos', ids.map(id => itemRow(id, p.done[id])));
      await sbInsert('fechamento_ciclo', Object.entries(p.closing || {})
        .filter(([n]) => +n >= 1 && +n <= 40).map(([n, c]) => closingRow(n, c)));
      await sbInsert('revisao_diaria', Object.keys(p.daily || {})
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).map(d => ({ user_id: user.id, data: d })));
      return supabaseBackend.load();
    },
  };

  // Grava uma alteração de progresso no destino em uso.
  function store(op, ...args) {
    if (!backend) { saveLocal(); return; }
    backend[op](...args).catch(err => {
      console.error(err);
      toast(mode === 'supabase'
        ? '⚠ Não foi possível salvar no Supabase. Verifique a conexão.'
        : '⚠ Não foi possível salvar no banco local. O servidor está rodando?');
    });
  }

  // Carrega do destino remoto. Se ele estiver vazio e houver progresso salvo
  // no navegador, envia esse progresso uma única vez (migração).
  async function loadRemote() {
    const remote = await backend.load();
    const local = readLocalProgress();
    if (isEmptyProgress(remote) && Object.keys(local.done).length) {
      Object.assign(state, await backend.replace(local));
      try { localStorage.setItem(`${KEY}:migrado`, JSON.stringify(local)); localStorage.removeItem(KEY); } catch (e) { /* ok */ }
      toast(mode === 'supabase' ? 'Progresso do navegador enviado para sua conta' : 'Progresso do navegador copiado para o banco local');
    } else {
      Object.assign(state, remote);
    }
  }

  // Links de confirmação de e-mail voltam com tokens no "#", que é usado pelas rotas.
  function cleanAuthHash() {
    const h = location.hash;
    if (!/access_token=|error=|type=signup|type=recovery/.test(h)) return;
    const err = new URLSearchParams(h.replace(/^#/, '')).get('error_description');
    if (err) setTimeout(() => toast(`⚠ ${err.replace(/\+/g, ' ')}`), 300);
    history.replaceState(null, '', location.pathname + location.search + '#/');
  }

  async function useSupabaseUser(next) {
    user = next;
    if (user) {
      backend = supabaseBackend;
      try { await loadRemote(); }
      catch (err) { console.error(err); toast('⚠ Não foi possível carregar seu progresso do Supabase'); }
    } else {
      backend = null;
      Object.assign(state, emptyProgress());
    }
  }

  async function initStorage() {
    if (SB_WANTED) {
      if (!window.supabase) { toast('⚠ Não foi possível carregar o Supabase. Usando só o navegador.'); return; }
      mode = 'supabase';
      sb = window.supabase.createClient(SB_CFG.url, SB_CFG.anonKey);
      const { data } = await sb.auth.getSession();
      cleanAuthHash();
      await useSupabaseUser(data.session ? data.session.user : null);
      sb.auth.onAuthStateChange((event, session) => {
        const next = session ? session.user : null;
        if ((next && next.id) === (user && user.id)) return;
        // fora do callback, como recomenda a documentação do supabase-js
        setTimeout(() => useSupabaseUser(next).then(() => render()), 0);
      });
      return;
    }
    if (!API) return;
    try {
      mode = 'server';
      backend = serverBackend;
      await loadRemote();
    } catch (e) {
      mode = 'local';
      backend = null;
      console.warn('Banco local indisponível, usando o navegador.', e);
    }
  }

  // ---------- Utilitários ----------
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pad = n => String(n).padStart(2, '0');
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const isDone = id => !!state.done[id];
  const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtDate = iso => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const plural = (n, s, p) => `${n.toLocaleString('pt-BR')} ${n === 1 ? s : p}`;

  function rangeLabel(info, d) {
    const n = info.list.length;
    const a = info.before + 1, b = info.before + n;
    const end = b === d.total ? ' · fim' : '';
    return n === 1 ? `aula ${a} de ${d.total}${end}` : `aulas ${a}–${b} de ${d.total}${end}`;
  }

  // ---------- Cálculos de progresso ----------
  function cycleItems(c) {
    const items = [];
    DISC.forEach(d => { const info = c.disc[d.code]; items.push(...info.list); if (info.review) items.push(info.review); });
    return items;
  }
  function closingDone(n) {
    const cl = state.closing[n] || {};
    return CLOSING.filter(([k]) => cl[k]).length;
  }
  function cycleProgress(c) {
    const items = cycleItems(c);
    const done = items.filter(i => isDone(i.id)).length + closingDone(c.n);
    const total = items.length + CLOSING.length;
    const lessonsDone = Object.values(c.disc).reduce((s, info) => s + info.list.filter(l => isDone(l.id)).length, 0);
    return { done, total, complete: done === total, lessonsDone, ratio: done / total };
  }
  function currentCycle() {
    const c = CYCLES.find(c => !cycleProgress(c).complete);
    return c || CYCLES[CYCLES.length - 1];
  }
  function totalDone() {
    let n = 0;
    for (const id in state.done) if (LESSONS[id] && LESSONS[id].kind === 'lesson') n++;
    return n;
  }
  function discDone(code) { return BY_DISC[code].filter(l => isDone(l.id)).length; }
  function nextInCycle(c) { return cycleItems(c).find(i => !isDone(i.id)); }

  function paceStats() {
    const dates = Object.entries(state.done)
      .filter(([id]) => LESSONS[id] && LESSONS[id].kind === 'lesson')
      .map(([, ts]) => new Date(ts));
    const today = todayKey();
    const todayCount = dates.filter(d => todayKey(d) === today).length;
    const now = Date.now(), DAY = 864e5;
    const last14 = dates.filter(d => now - d.getTime() < 14 * DAY);
    let pace = 0;
    if (last14.length) {
      const first = Math.min(...last14.map(d => d.getTime()));
      const days = Math.max(1, Math.min(14, Math.ceil((now - first) / DAY)));
      pace = last14.length / days;
    }
    const remaining = TOTAL - dates.length;
    let eta = null;
    if (pace > 0 && remaining > 0) eta = new Date(now + Math.ceil(remaining / pace) * DAY);
    const activeDays = new Set(dates.map(d => todayKey(d)));
    let streak = 0;
    const cursor = new Date();
    if (!activeDays.has(todayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (activeDays.has(todayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    return { todayCount, pace, eta, remaining, streak };
  }

  // ---------- Componentes ----------
  function bar(ratio, cls = '') {
    return `<div class="bar ${cls}"><span style="width:${Math.round(ratio * 100)}%"></span></div>`;
  }

  function lessonItem(item, opts = {}) {
    const done = isDone(item.id);
    const cls = ['lesson', done ? 'done' : '', item.kind === 'review' ? 'review' : ''].join(' ');
    let title = esc(item.title);
    if (opts.highlight) {
      const q = opts.highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      title = title.replace(new RegExp(`(${q})`, 'ig'), '<mark>$1</mark>');
    }
    const when = done && opts.showDate !== false ? `<span class="when">Concluída em ${fmtDate(state.done[item.id])}</span>` : '';
    const tag = opts.cycleTag ? `<a class="tag" href="#/ciclo/${item.cycle}">Ciclo ${pad(item.cycle)}</a>` : '';
    return `<li class="${cls}"><label>
      <input type="checkbox" data-toggle="${item.id}" ${done ? 'checked' : ''}>
      <span class="t">${title}${when}</span>${tag}
    </label></li>`;
  }

  // ---------- Telas ----------
  function viewPainel() {
    const cur = currentCycle();
    const cp = cycleProgress(cur);
    const done = totalDone();
    const cyclesDone = CYCLES.filter(c => cycleProgress(c).complete).length;
    const s = paceStats();
    const next = nextInCycle(cur);
    const today = todayKey();
    const allDone = cyclesDone === CYCLES.length;

    let nextHtml;
    if (allDone) {
      nextHtml = `<div class="banner"><span>🏁</span><div><strong>Todos os 40 ciclos concluídos!</strong><br>Agora o ciclo vira um ciclo de revisão. Veja o <a href="#/guia">Guia</a>.</div></div>`;
    } else if (next) {
      const d = DISC_BY[next.code];
      nextHtml = `
        <div class="next-lesson" style="--c:${d.color}">
          <div class="disc">${d.num}. ${esc(d.name)}</div>
          <div class="title">${esc(next.title)}</div>
        </div>
        <div class="btn-row">
          <button class="btn primary" data-toggle="${next.id}">✓ Concluir ${next.kind === 'review' ? 'revisão' : 'aula'}</button>
          <a class="btn" href="#/ciclo/${cur.n}">Abrir ciclo ${pad(cur.n)}</a>
        </div>
        <p class="muted small" style="margin:0">Marque só depois de assistir, resumir e resolver as questões.</p>`;
    } else {
      nextHtml = `
        <div class="banner"><span>📝</span><div><strong>Aulas do ciclo ${pad(cur.n)} concluídas.</strong><br>Falta o fechamento do ciclo (revisão + questões).</div></div>
        <div class="btn-row"><a class="btn primary" href="#/ciclo/${cur.n}#fechamento">Fazer fechamento</a></div>`;
    }

    const grid = CYCLES.map(c => {
      const p = cycleProgress(c);
      const cls = ['cycle-cell', p.complete ? 'done' : '', c.n === cur.n && !allDone ? 'current' : ''].join(' ');
      return `<a class="${cls}" href="#/ciclo/${c.n}" title="Ciclo ${pad(c.n)}: ${pct(p.done, p.total)}%"><div class="fill" style="height:${Math.round(p.ratio * 100)}%"></div><span>${pad(c.n)}</span></a>`;
    }).join('');

    const etaTxt = s.eta ? s.eta.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    return `<div class="stack">
      <div class="page-head">
        <div><h1>Painel</h1><p class="muted">Ciclo de Estudos · Auditor-Fiscal da Receita Federal</p></div>
      </div>

      <label class="daily">
        <input type="checkbox" data-daily="${today}" ${state.daily[today] ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
        <span><strong>Revisão rápida de hoje</strong> <span class="muted small">— 10 a 15 min do que você estudou ontem</span></span>
      </label>

      <div class="grid-2">
        <section class="card next">
          <div class="card-title" style="margin:0">
            <h2>${allDone ? 'Ciclo concluído' : `Continuar · Ciclo ${pad(cur.n)}`}</h2>
            <span class="muted small">${cp.done}/${cp.total} itens</span>
          </div>
          ${bar(cp.ratio)}
          ${nextHtml}
        </section>

        <section class="card">
          <div class="card-title"><h2>Progresso geral</h2><span class="muted small">${pct(done, TOTAL)}%</span></div>
          ${bar(done / TOTAL)}
          <p class="muted small" style="margin:8px 0 0">${plural(done, 'aula vista', 'aulas vistas')} de ${TOTAL.toLocaleString('pt-BR')} · ${plural(cyclesDone, 'ciclo concluído', 'ciclos concluídos')} de 40</p>
          <p class="muted small" style="margin:6px 0 0">Ritmo de referência: ~5 aulas/dia, ≈ 11 dias de estudo + 1 a 2 de fechamento por ciclo.</p>
        </section>
      </div>

      <div class="stats">
        <div class="stat"><div class="label">Aulas hoje</div><div class="value">${s.todayCount}</div><div class="sub">meta de referência: 5</div></div>
        <div class="stat"><div class="label">Ritmo (14 dias)</div><div class="value">${s.pace ? s.pace.toFixed(1).replace('.', ',') : '0'}</div><div class="sub">aulas por dia</div></div>
        <div class="stat"><div class="label">Sequência</div><div class="value">${s.streak}</div><div class="sub">${s.streak === 1 ? 'dia seguido' : 'dias seguidos'}</div></div>
        <div class="stat"><div class="label">Previsão de término</div><div class="value" style="font-size:1.05rem;padding-top:6px">${etaTxt}</div><div class="sub">${plural(s.remaining, 'aula restante', 'aulas restantes')}</div></div>
      </div>

      <section class="card">
        <div class="card-title"><h2>Meus ciclos</h2><a class="small" href="#/ciclo/${cur.n}">Ir para o atual →</a></div>
        <div class="cycle-grid">${grid}</div>
        <div class="legend">
          <span><i style="background:var(--accent)"></i>Concluído</span>
          <span><i style="background:var(--surface-2);outline:2px solid var(--primary)"></i>Atual</span>
          <span><i style="background:color-mix(in srgb,var(--accent) 25%,var(--surface-2))"></i>Em andamento</span>
        </div>
      </section>
    </div>`;
  }

  function viewCiclo(n) {
    const c = CYCLES[n - 1];
    if (!c) return viewNotFound();
    const p = cycleProgress(c);
    const hide = state.hideDone;
    const extrasTxt = c.extras.length ? ` + ${plural(c.extras.length, 'extra', 'extras')}` : '';

    const cards = DISC.map(d => {
      const info = c.disc[d.code];
      const items = info.list.length ? info.list : [info.review];
      const doneCount = items.filter(i => isDone(i.id)).length;
      const complete = doneCount === items.length;
      const visible = hide ? items.filter(i => !isDone(i.id)) : items;
      if (hide && !visible.length) return '';
      let sub;
      if (info.list.length) sub = rangeLabel(info, d);
      else if (info.review.finished) sub = 'disciplina já concluída';
      else sub = `${info.before} de ${d.total} aulas vistas`;
      const allBtn = info.list.length > 1 && !complete
        ? `<button class="btn sm" data-all="${c.n}:${d.code}" title="Marcar todas as aulas desta disciplina">✓ Todas</button>` : '';
      return `<article class="disc-card ${complete ? 'complete' : ''}" style="--c:${d.color}">
        <div class="stripe"></div>
        <div class="body">
          <div class="head">
            <div>
              <a class="name" href="#/disciplina/${d.code}"><span class="num">${d.num}</span>${esc(d.name)}</a>
              <div class="range">${sub}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">${allBtn}<span class="count">${complete ? '✓ ' : ''}${doneCount}/${items.length}</span></div>
          </div>
          <ul class="lessons">${visible.map(i => lessonItem(i, { showDate: false })).join('')}</ul>
        </div>
      </article>`;
    }).join('');

    const extras = EXTRAS.map((e, i) => {
      const items = c.extras.filter(x => x.code === e.code);
      if (!items.length) return '';
      const visible = hide ? items.filter(x => !isDone(x.id)) : items;
      if (hide && !visible.length) return '';
      return `<article class="disc-card" style="--c:${e.color}">
        <div class="stripe"></div>
        <div class="body">
          <div class="head"><div><div class="name"><span class="num">${20 + i}</span>${esc(e.name)}</div><div class="range">extra (opcional)</div></div></div>
          <ul class="lessons">${visible.map(x => lessonItem(x, { showDate: false })).join('')}</ul>
        </div>
      </article>`;
    }).join('');

    const cl = state.closing[c.n] || {};
    const closing = `<section class="card closing" id="fechamento">
      <div class="card-title" style="margin-bottom:4px"><h2>Fechamento do ciclo</h2><span class="muted small">${closingDone(c.n)}/${CLOSING.length}</span></div>
      <ul class="lessons">${CLOSING.map(([k, label]) => `<li class="lesson ${cl[k] ? 'done' : ''}"><label>
        <input type="checkbox" data-closing="${c.n}:${k}" ${cl[k] ? 'checked' : ''}><span class="t">${label}</span></label></li>`).join('')}</ul>
      <textarea data-hardtext="${c.n}" placeholder="Os 3 assuntos mais difíceis deste ciclo…" aria-label="Os 3 assuntos mais difíceis">${esc(cl.text || '')}</textarea>
    </section>`;

    const banner = p.complete
      ? `<div class="banner"><span>🎉</span><div><strong>Ciclo ${pad(c.n)} concluído!</strong>${c.n < 40 ? ` <a href="#/ciclo/${c.n + 1}">Começar o ciclo ${pad(c.n + 1)} →</a>` : ' Parabéns, você viu 100% do conteúdo.'}</div></div>` : '';

    return `<div class="stack">
      <section class="cycle-head">
        <div class="row">
          <a class="nav-btn ${c.n === 1 ? 'disabled' : ''}" href="#/ciclo/${c.n - 1}" aria-label="Ciclo anterior">‹</a>
          <div style="flex:1;min-width:0;text-align:center">
            <h1>CICLO ${pad(c.n)} <small>de 40</small></h1>
            <div class="meta">${c.newCount} aulas novas${extrasTxt} · ao concluir: ${pct(c.cumulative, TOTAL)}% do conteúdo</div>
          </div>
          <a class="nav-btn ${c.n === 40 ? 'disabled' : ''}" href="#/ciclo/${c.n + 1}" aria-label="Próximo ciclo">›</a>
        </div>
        ${bar(p.ratio)}
        <div class="small" style="margin-top:6px;opacity:.85">${p.done} de ${p.total} itens · ${p.lessonsDone}/${c.newCount} aulas</div>
      </section>
      ${banner}
      <div class="toolbar">
        <label class="switch"><input type="checkbox" data-hide ${hide ? 'checked' : ''}> Ocultar concluídas</label>
        <span class="muted small">Siga a ordem: terminou uma disciplina, passe para a próxima.</span>
      </div>
      <div class="disc-list">${cards}${extras}</div>
      ${hide && !cards.trim() && !extras.trim() ? '<div class="empty">Tudo marcado neste ciclo. Falta só o fechamento abaixo.</div>' : ''}
      ${closing}
    </div>`;
  }

  function viewDisciplinas(q = '') {
    const rows = DISC.map(d => {
      const n = discDone(d.code);
      return `<a class="disc-row" href="#/disciplina/${d.code}" style="--c:${d.color}">
        <span class="stripe"></span>
        <span class="info"><span class="n">${d.num}. ${esc(d.name)}</span><br>
          <span class="a">${AREAS[d.area].name} · média ${(d.total / 40).toFixed(1).replace('.', ',')}/ciclo · termina no ciclo ${d.endCycle}</span>
          ${bar(n / d.total, 'thin')}</span>
        <span class="pct">${pct(n, d.total)}%<small>${n}/${d.total}</small></span>
      </a>`;
    }).join('');

    const legend = Object.values(AREAS).map(a => `<span style="--c:${a.color}"><i></i>${a.name}</span>`).join('');

    return `<div class="stack">
      <div class="page-head"><div><h1>Disciplinas</h1><p class="muted">A ordem da “roda” se repete em todos os 40 ciclos.</p></div></div>
      <input class="search" type="search" id="search" placeholder="Buscar aula por assunto (ex.: ICMS, crase, LGPD)…" value="${esc(q)}" autocomplete="off">
      <div id="searchResults">${q ? searchResults(q) : ''}</div>
      <section class="card" style="padding:4px 0 4px 0">
        <div class="disc-table">${rows}</div>
      </section>
      <div class="area-legend">${legend}</div>
    </div>`;
  }

  function searchResults(q) {
    q = q.trim();
    if (q.length < 2) return '';
    const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const nq = norm(q);
    const found = Object.values(LESSONS).filter(l => l.kind !== 'review' && norm(l.title).includes(nq));
    if (!found.length) return `<div class="card empty">Nenhuma aula encontrada para “${esc(q)}”.</div>`;
    const shown = found.slice(0, 60);
    const groups = {};
    shown.forEach(l => { (groups[l.code] = groups[l.code] || []).push(l); });
    const html = Object.entries(groups).map(([code, list]) => {
      const d = DISC_BY[code] || EXTRAS.find(e => e.code === code);
      return `<div class="group-title"><span>${esc(d.name)}</span></div>
        <ul class="lessons">${list.map(l => lessonItem(l, { cycleTag: true, highlight: q })).join('')}</ul>`;
    }).join('');
    return `<section class="card">
      <div class="card-title"><h2>Resultados</h2><span class="muted small">${found.length > 60 ? `60 de ${found.length}` : plural(found.length, 'aula', 'aulas')}</span></div>
      ${html}
    </section>`;
  }

  function viewDisciplina(code) {
    const d = DISC_BY[code];
    if (!d) return viewNotFound();
    const n = discDone(code);
    const groups = {};
    BY_DISC[code].forEach(l => { (groups[l.cycle] = groups[l.cycle] || []).push(l); });
    const body = Object.entries(groups).map(([cy, list]) => {
      const dn = list.filter(l => isDone(l.id)).length;
      return `<div class="group-title"><span>Ciclo ${pad(+cy)} · ${dn}/${list.length}</span><a href="#/ciclo/${cy}">abrir ciclo</a></div>
        <ul class="lessons">${list.map(l => lessonItem(l)).join('')}</ul>`;
    }).join('');
    const idx = DISC.indexOf(d);
    const prev = DISC[idx - 1], next = DISC[idx + 1];
    return `<div class="stack">
      <div class="page-head">
        <div>
          <a class="small" href="#/disciplinas">← Disciplinas</a>
          <h1 style="margin-top:6px">${d.num}. ${esc(d.name)}</h1>
          <p class="muted">${AREAS[d.area].name} · ${d.total} aulas · termina no ciclo ${d.endCycle}</p>
        </div>
        <div class="btn-row">
          ${prev ? `<a class="btn sm" href="#/disciplina/${prev.code}">‹ ${esc(prev.name)}</a>` : ''}
          ${next ? `<a class="btn sm" href="#/disciplina/${next.code}">${esc(next.name)} ›</a>` : ''}
        </div>
      </div>
      <section class="card" style="border-left:4px solid ${d.color}">
        <div class="card-title"><h2>${pct(n, d.total)}% concluído</h2><span class="muted small">${n}/${d.total} aulas</span></div>
        ${bar(n / d.total)}
      </section>
      <section class="card">${body}</section>
    </div>`;
  }

  function viewGuia() {
    return `<div class="stack prose">
      <div class="page-head"><div><h1>Como funciona</h1><p class="muted">40 ciclos · 2.162 aulas das 19 disciplinas · + 13 aulas extras · sem datas</p></div></div>
      <section class="card">
        <p style="margin-top:0">Todo o conteúdo foi reorganizado em <strong>40 ciclos</strong>, sem datas. Em cada ciclo você passa por <strong>todas as disciplinas, sempre na mesma ordem</strong>, estudando um pedaço de cada uma. Quando termina o ciclo, começa o próximo exatamente de onde parou. Ao concluir o Ciclo 40, você terá visto <strong>100% das aulas</strong>.</p>
        <p style="margin-bottom:0">As aulas foram divididas de forma proporcional: disciplinas com mais conteúdo (como Contabilidade Geral, Economia e Direito Tributário) recebem mais aulas por ciclo, e todas avançam juntas até o final.</p>
      </section>
      <section class="card">
        <h2>Regras simples</h2>
        <ul>
          <li><strong>Siga a ordem da tabela.</strong> Terminou as aulas de uma disciplina no ciclo? Passe para a próxima.</li>
          <li><strong>Parou no meio?</strong> No dia seguinte, continue da próxima caixinha em branco — o Painel mostra qual é. Não existe atraso: o ciclo só termina quando todas as caixas estiverem marcadas.</li>
          <li><strong>Disciplina sem aula nova no ciclo?</strong> Ela continua no ciclo: use a sessão para revisar o resumo dela e resolver questões.</li>
          <li><strong>Fechou o ciclo?</strong> Faça o fechamento (revisão + questões) que aparece no fim de cada ciclo antes de começar o próximo.</li>
        </ul>
      </section>
      <section class="card">
        <h2 style="margin-bottom:12px">Rotina de cada aula</h2>
        <div class="steps">
          <div class="step"><b>1. Assistir</b>Assista à videoaula com atenção. Se quiser, use velocidade 1,25x a 1,5x.</div>
          <div class="step"><b>2. Resumir</b>Anote os pontos principais em poucas linhas (resumo, mapa mental ou marcação na lei seca).</div>
          <div class="step"><b>3. Praticar</b>Resolva questões do assunto (10 a 20). Anote os erros: eles viram material de revisão.</div>
          <div class="step"><b>4. Marcar</b>Marque a caixinha da aula. Ela só conta como concluída depois das questões.</div>
        </div>
        <p style="margin-bottom:0">Todo dia, antes de começar, faça uma <strong>revisão rápida de 10 a 15 minutos</strong> do que estudou no dia anterior.</p>
      </section>
      <section class="card">
        <h2>Ritmo de referência</h2>
        <p style="margin-bottom:0">O cronograma original tinha cerca de <strong>5 aulas por dia</strong> e um dia de revisão a cada 6 dias de estudo. Nesse ritmo, cada ciclo (≈ 54 aulas) leva por volta de <strong>11 dias de estudo + 1 a 2 dias de fechamento</strong>. Se você estudar menos horas, o ciclo simplesmente demora mais — a ordem continua a mesma.</p>
      </section>
      <section class="card">
        <h2>Extras</h2>
        <p style="margin-bottom:0">As aulas <strong>Bônus – Inteligência Emocional</strong> estão nos ciclos 1 a 6 (uma por ciclo). Das aulas de <strong>Reprise Eventos</strong>, as de orientação estão no Ciclo 1 e as de resolução de questões de prova ficam nos ciclos 37 a 40. Extras são opcionais e não contam para fechar o ciclo.</p>
      </section>
      <section class="card">
        <h2>Depois do Ciclo 40</h2>
        <p>Todo o conteúdo terá sido visto. A partir daí, o ciclo vira um <strong>ciclo de revisão</strong>, na mesma ordem de disciplinas:</p>
        <ul style="margin-bottom:0">
          <li>Em cada sessão, revise os resumos de uma disciplina e resolva questões dela, priorizando os assuntos anotados como difíceis.</li>
          <li>Faça um simulado completo ao fim de cada volta da roda e corrija com calma.</li>
          <li>Mantenha o treino da Prova Discursiva (pelo menos um texto por volta).</li>
          <li>Quando sair o edital, compare-o com este material e dê mais peso às disciplinas e assuntos cobrados.</li>
        </ul>
      </section>
    </div>`;
  }

  function viewAjustes() {
    const t = state.theme;
    const hard = CYCLES.filter(c => (state.closing[c.n] || {}).text).map(c =>
      `<div class="group-title"><span>Ciclo ${pad(c.n)}</span><a href="#/ciclo/${c.n}#fechamento">abrir</a></div><p style="margin:4px 0 0;white-space:pre-wrap">${esc(state.closing[c.n].text)}</p>`).join('');
    return `<div class="stack">
      <div class="page-head"><div><h1>Ajustes</h1></div></div>
      <section class="card">
        <h2 style="margin-bottom:8px">Onde o progresso é salvo</h2>
        ${storageCard()}
      </section>
      <section class="card">
        <h2 style="margin-bottom:12px">Tema</h2>
        <div class="seg" role="group" aria-label="Tema">
          <button data-theme-set="auto" class="${t === 'auto' ? 'on' : ''}">Automático</button>
          <button data-theme-set="light" class="${t === 'light' ? 'on' : ''}">Claro</button>
          <button data-theme-set="dark" class="${t === 'dark' ? 'on' : ''}">Escuro</button>
        </div>
      </section>
      <section class="card">
        <h2>Backup</h2>
        <p class="muted small">Exporte um arquivo para guardar seu progresso ou levá-lo para outro aparelho (celular ↔ computador).</p>
        <div class="btn-row">
          <button class="btn primary" data-export>Exportar progresso</button>
          <label class="btn">Importar arquivo<input type="file" accept="application/json,.json" data-import hidden></label>
        </div>
      </section>
      <section class="card">
        <h2 style="margin-bottom:8px">Assuntos mais difíceis anotados</h2>
        ${hard || '<p class="muted small" style="margin:0">Nada anotado ainda. Use o campo no fechamento de cada ciclo.</p>'}
      </section>
      <section class="card">
        <h2>Zerar progresso</h2>
        <p class="muted small">Apaga todas as marcações e anotações ${WHERE[mode]}. Faça um backup antes.</p>
        <button class="btn danger" data-reset>Zerar tudo</button>
      </section>
    </div>`;
  }

  function storageCard() {
    if (mode === 'supabase') {
      return `<div class="banner"><span>☁️</span><div style="flex:1;min-width:0"><strong>Sua conta no Supabase</strong><br>
        <span class="small">Conectado como ${esc(user ? user.email : '')}. O progresso sincroniza entre seus aparelhos.</span></div>
        <button class="btn sm" data-logout>Sair</button></div>`;
    }
    if (mode === 'server') {
      return `<div class="banner"><span>🗄️</span><div><strong>Banco de dados local</strong><br><span class="small">Arquivo <code>data/progresso.db</code> (SQLite) na pasta do projeto.</span></div></div>`;
    }
    return `<p class="muted small" style="margin:0">Somente neste navegador. Para sincronizar entre aparelhos, preencha o <code>config.js</code> com os dados do Supabase.</p>`;
  }

  function viewLogin() {
    return `<div class="stack" style="max-width:420px;margin:16px auto 0">
      <div><h1>Entrar</h1><p class="muted" style="margin:4px 0 0">Seu progresso fica salvo na sua conta e sincroniza entre celular e computador.</p></div>
      <form class="card stack" id="loginForm" novalidate>
        <label class="field"><span>E-mail</span><input class="search" type="email" name="email" autocomplete="email" required></label>
        <label class="field"><span>Senha</span><input class="search" type="password" name="password" autocomplete="current-password" minlength="6" required></label>
        <div class="btn-row">
          <button class="btn primary" type="submit" data-auth="in">Entrar</button>
          <button class="btn" type="submit" data-auth="up">Criar conta</button>
        </div>
        <p class="muted small" id="loginMsg" role="status" style="margin:0"></p>
      </form>
    </div>`;
  }

  function authMessage(err) {
    const m = String((err && err.message) || err);
    if (/invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
    if (/already registered|already been registered/i.test(m)) return 'Este e-mail já tem conta. Use “Entrar”.';
    if (/signups? not allowed|signup is disabled/i.test(m)) return 'Novos cadastros estão desativados neste projeto.';
    if (/password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (/rate limit/i.test(m)) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
    return m;
  }

  function viewNotFound() {
    return `<div class="card empty">Página não encontrada. <a href="#/">Voltar ao painel</a></div>`;
  }

  // ---------- Roteamento e renderização ----------
  function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [path, anchor] = hash.split('#');
    const parts = path.split('/').filter(Boolean);
    return { parts, anchor };
  }

  let searchQuery = '';

  function render(keepScroll = false) {
    const y = window.scrollY;
    const { parts, anchor } = route();
    const page = parts[0] || 'painel';
    let html, nav = page;
    if (mode === 'supabase' && !user) { html = viewLogin(); nav = ''; }
    else switch (page) {
      case 'painel': html = viewPainel(); break;
      case 'ciclo': html = viewCiclo(parts[1] ? +parts[1] : currentCycle().n); break;
      case 'disciplinas': html = viewDisciplinas(searchQuery); break;
      case 'disciplina': html = viewDisciplina(parts[1]); nav = 'disciplinas'; break;
      case 'guia': html = viewGuia(); break;
      case 'ajustes': html = viewAjustes(); break;
      default: html = viewNotFound();
    }
    $('#app').innerHTML = html;
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
    updateTop();
    if (keepScroll) window.scrollTo(0, y);
    else if (anchor) { const el = document.getElementById(anchor); if (el) el.scrollIntoView({ block: 'start' }); }
    else window.scrollTo(0, 0);
  }

  function updateTop() {
    const done = totalDone();
    const p = pct(done, TOTAL);
    $('#topProgress').textContent = `${done.toLocaleString('pt-BR')}/${TOTAL.toLocaleString('pt-BR')} · ${p}%`;
    document.querySelector('.brand-ring').style.setProperty('--p', `${(done / TOTAL) * 100}%`);
  }

  function applyTheme() {
    const root = document.documentElement;
    if (state.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.theme);
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- Ações ----------
  function setDone(ids, value) {
    const touched = new Set(ids.map(id => LESSONS[id] && LESSONS[id].cycle).filter(Boolean));
    const before = {};
    touched.forEach(n => { before[n] = cycleProgress(CYCLES[n - 1]).complete; });
    const now = new Date().toISOString();
    ids.forEach(id => { if (value) state.done[id] = state.done[id] || now; else delete state.done[id]; });
    store('items', ids, value);
    touched.forEach(n => { if (!before[n] && cycleProgress(CYCLES[n - 1]).complete) toast(`🎉 Ciclo ${pad(n)} concluído!`); });
  }

  function setClosing(n, key, value) {
    const was = cycleProgress(CYCLES[n - 1]).complete;
    state.closing[n] = state.closing[n] || {};
    state.closing[n][key] = value;
    store('closing', n);
    if (!was && cycleProgress(CYCLES[n - 1]).complete) toast(`🎉 Ciclo ${pad(n)} concluído!`);
  }

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.toggle) { setDone([t.dataset.toggle], t.checked); render(true); }
    else if (t.dataset.closing) { const [n, k] = t.dataset.closing.split(':'); setClosing(+n, k, t.checked); render(true); }
    else if (t.dataset.daily) {
      const day = t.dataset.daily, feita = t.checked;
      if (feita) state.daily[day] = true; else delete state.daily[day];
      store('daily', day, feita);
    }
    else if ('hide' in t.dataset) { state.hideDone = t.checked; savePrefs(); render(true); }
    else if ('import' in t.dataset && t.files[0]) importFile(t.files[0]);
  });

  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.toggle) {
      const L = LESSONS[b.dataset.toggle];
      setDone([b.dataset.toggle], true);
      toast(`✓ ${L.kind === 'review' ? 'Revisão' : 'Aula'} concluída`);
      render(true);
    } else if (b.dataset.all) {
      const [n, code] = b.dataset.all.split(':');
      setDone(CYCLES[n - 1].disc[code].list.map(l => l.id), true);
      render(true);
    } else if (b.dataset.themeSet) {
      state.theme = b.dataset.themeSet; savePrefs(); applyTheme(); render(true);
    } else if ('logout' in b.dataset) {
      sb.auth.signOut().then(() => { location.hash = '#/'; });
    } else if ('export' in b.dataset) {
      exportFile();
    } else if ('reset' in b.dataset) {
      const where = WHERE[mode];
      if (confirm(`Apagar todo o progresso ${where}? Isso não pode ser desfeito.`)) {
        Object.assign(state, emptyProgress());
        store('clear');
        toast('Progresso zerado'); render();
      }
    }
  });

  document.addEventListener('submit', async e => {
    if (e.target.id !== 'loginForm') return;
    e.preventDefault();
    const f = e.target;
    const signUp = e.submitter && e.submitter.dataset.auth === 'up';
    const email = f.email.value.trim(), password = f.password.value;
    const msg = $('#loginMsg');
    if (!email || password.length < 6) { msg.textContent = 'Informe o e-mail e uma senha de pelo menos 6 caracteres.'; return; }
    f.querySelectorAll('button').forEach(b => { b.disabled = true; });
    msg.textContent = 'Aguarde…';
    try {
      if (signUp) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) msg.textContent = 'Conta criada! Abra o link de confirmação enviado ao seu e-mail e depois entre aqui.';
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        msg.textContent = 'Carregando seu progresso…';
      }
    } catch (err) {
      msg.textContent = authMessage(err);
    } finally {
      f.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  });

  let saveTextTimer;
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.hardtext) {
      const n = t.dataset.hardtext;
      state.closing[n] = state.closing[n] || {};
      state.closing[n].text = t.value;
      clearTimeout(saveTextTimer);
      saveTextTimer = setTimeout(() => store('closing', n), 500);
    } else if (t.id === 'search') {
      searchQuery = t.value;
      $('#searchResults').innerHTML = searchResults(searchQuery);
    }
  });

  function exportFile() {
    const data = { app: 'ciclo-rfb', version: 1, exportedAt: new Date().toISOString(), state: progressOf(state) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ciclo-rfb-backup-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const s = data && data.state;
        if (!s || typeof s.done !== 'object') throw new Error('formato');
        if (!confirm('Substituir o progresso atual pelo do arquivo?')) return;
        const incoming = { done: s.done, closing: s.closing || {}, daily: s.daily || {} };
        if (backend) {
          backend.replace(incoming)
            .then(saved => { Object.assign(state, saved); toast('Progresso importado'); render(); })
            .catch(err => { console.error(err); toast('⚠ Falha ao importar o progresso'); });
        } else {
          Object.assign(state, incoming);
          saveLocal(); toast('Progresso importado'); render();
        }
      } catch (err) {
        toast('Arquivo inválido');
      }
    };
    reader.readAsText(file);
  }

  window.addEventListener('hashchange', () => render());
  window.addEventListener('storage', e => {
    if (e.key === KEY && mode === 'local') { Object.assign(state, readLocalProgress()); render(true); }
  });
  // No modo servidor, ao voltar para a aba recarrega o progresso do banco
  // (pode ter sido alterado em outra aba ou aparelho).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !backend) return;
    backend.load().then(p => { Object.assign(state, p); render(true); }).catch(() => {});
  });

  applyTheme();
  initStorage().then(() => render());
})();
