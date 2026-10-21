-- Ciclo de Estudos RFB — tabelas de progresso no Supabase.
-- Cole tudo no SQL Editor do projeto e clique em "Run". Pode rodar de novo sem erro.
-- Cada usuário logado só enxerga e altera as próprias linhas (Row Level Security).

-- Cada aula, revisão ou extra marcado como concluído
create table if not exists public.itens_concluidos (
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  item_id      text        not null check (char_length(item_id) <= 40),
  ciclo        smallint    not null check (ciclo between 1 and 40),
  disciplina   text        not null check (char_length(disciplina) <= 10),
  tipo         text        not null check (tipo in ('aula', 'revisao', 'extra')),
  concluido_em timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index if not exists itens_concluidos_ciclo_idx on public.itens_concluidos (user_id, ciclo);

-- Fechamento de cada ciclo (as 3 caixas + os assuntos mais difíceis)
create table if not exists public.fechamento_ciclo (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  ciclo             smallint    not null check (ciclo between 1 and 40),
  revisar_resumos   boolean     not null default false,
  questoes_mistas   boolean     not null default false,
  assuntos_anotados boolean     not null default false,
  assuntos_dificeis text        not null default '' check (char_length(assuntos_dificeis) <= 5000),
  atualizado_em     timestamptz not null default now(),
  primary key (user_id, ciclo)
);

-- Dias em que a revisão rápida (10–15 min) foi feita
create table if not exists public.revisao_diaria (
  user_id  uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  data     date        not null,
  feita_em timestamptz not null default now(),
  primary key (user_id, data)
);

-- Segurança: só o dono acessa as próprias linhas
alter table public.itens_concluidos enable row level security;
alter table public.fechamento_ciclo enable row level security;
alter table public.revisao_diaria  enable row level security;

drop policy if exists "dono" on public.itens_concluidos;
create policy "dono" on public.itens_concluidos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "dono" on public.fechamento_ciclo;
create policy "dono" on public.fechamento_ciclo for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "dono" on public.revisao_diaria;
create policy "dono" on public.revisao_diaria for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.itens_concluidos, public.fechamento_ciclo, public.revisao_diaria from anon;
grant select, insert, update, delete
  on public.itens_concluidos, public.fechamento_ciclo, public.revisao_diaria to authenticated;

-- Resumo por ciclo (respeita o RLS de quem consulta)
create or replace view public.v_progresso_ciclo with (security_invoker = true) as
select user_id,
       ciclo,
       count(*) filter (where tipo = 'aula')    as aulas_concluidas,
       count(*) filter (where tipo = 'revisao') as revisoes_concluidas,
       count(*) filter (where tipo = 'extra')   as extras_concluidos,
       min(concluido_em)                        as inicio,
       max(concluido_em)                        as ultima_marcacao
from public.itens_concluidos
group by user_id, ciclo;

revoke all on public.v_progresso_ciclo from anon;
grant select on public.v_progresso_ciclo to authenticated;
