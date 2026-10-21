# Ciclo de Estudos – Auditor-Fiscal RFB

Gerenciador dos 40 ciclos de estudo (2.162 aulas), responsivo para celular.

## Onde o progresso é salvo

1. **Supabase**, se o `config.js` estiver preenchido. Exige login e sincroniza entre aparelhos; funciona no GitHub Pages.
2. **SQLite local** (`data/progresso.db`), se o app for aberto pelo `server.js`.
3. **Navegador**, nos outros casos.

### Configurar o Supabase

1. No painel do Supabase, abra **SQL Editor**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
2. Em **Project Settings → API**, copie a **Project URL** e a chave **anon / publishable** para o `config.js`. Nunca use a `service_role`.
3. Em **Authentication → URL Configuration**, coloque o endereço do site publicado em **Site URL** e em **Redirect URLs**.
4. Abra o site, clique em **Criar conta** e confirme o e-mail.
5. Recomendado: em **Authentication → Sign In / Providers**, desative **Allow new users to sign up**.

## Como rodar localmente

Requer Node.js 22.13 ou mais recente. Não há dependências para instalar.

```bash
npm start
```

Abra http://localhost:3000.

O progresso dos ciclos fica salvo no banco SQLite `data/progresso.db`. O tema e o filtro de tela ficam no navegador.

Se você abrir o `index.html` direto, sem o servidor, o app continua funcionando, mas salva o progresso só no navegador. Na primeira vez que abrir pelo servidor com o banco vazio, o progresso que já estava no navegador é copiado para o banco.

### Usar no celular (mesma rede Wi-Fi)

```bash
HOST=0.0.0.0 npm start        # PowerShell: $env:HOST="0.0.0.0"; npm start
```

No celular, abra `http://<IP-do-computador>:3000`.

## Banco de dados

| Tabela | Conteúdo |
|---|---|
| `itens_concluidos` | aulas, revisões e extras marcados (`item_id`, `ciclo`, `disciplina`, `tipo`, `concluido_em`) |
| `fechamento_ciclo` | as 3 caixas do fechamento e os assuntos mais difíceis de cada ciclo |
| `revisao_diaria` | dias em que a revisão rápida foi feita |
| `v_progresso_ciclo` (view) | totais por ciclo |

Para fazer backup, copie `data/progresso.db` com o servidor parado ou use **Ajustes → Exportar progresso**. A pasta `data/` está no `.gitignore`.

## API

| Método | Rota | Corpo |
|---|---|---|
| GET | `/api/progresso` | — |
| POST | `/api/itens` | `{ "ids": ["LP-1"], "concluido": true }` |
| PUT | `/api/fechamento/:ciclo` | `{ "rev": true, "mix": false, "hard": true, "text": "..." }` (parcial) |
| PUT | `/api/revisao-diaria/:AAAA-MM-DD` | `{ "feita": true }` |
| PUT | `/api/progresso` | substitui tudo (importação) |
| DELETE | `/api/progresso` | zera o progresso |
