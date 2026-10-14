# Plano de Implementação

Convenções para todos os testes: `node:test` + `node:assert/strict`, arquivos em `test/*.test.mjs`, sem dependências novas. Testes de propriedade usam o helper `test/helpers/prop.mjs`. Testes e2e sobem `server/index.js` como processo filho com `DATA_DIR=server/.test-data-<nome>`, `NODE_ENV=test` e porta exclusiva (conferir as portas já usadas em `test/e2e-*.test.mjs`). No Windows não dá para enviar sinais ao processo filho: o encerramento gracioso é testado pela mensagem IPC `"shutdown"` (`spawn` com `stdio: [..., "ipc"]` + `child.send("shutdown")`); se o filho não sair no prazo, o teste registra a falha e encerra com `child.kill()` para não travar a suíte.

- [x] 1. Escrever os testes exploratórios da condição do bug
  - **Property 1: Bug Condition** - Persistência, conteúdo do admin, sessão e borda HTTP
  - **CRÍTICO**: estes testes DEVEM FALHAR no código sem correção; a falha confirma que o bug existe
  - **NÃO tente corrigir o teste nem o código quando falhar**
  - **NOTA**: os testes codificam o comportamento esperado (Properties 1–7 do design) e validam a correção quando passarem depois da implementação
  - **OBJETIVO**: surgir contraexemplos que demonstrem o bug e confirmem (ou refutem) a causa raiz hipotética
  - **Abordagem PBT com escopo**: bugs determinísticos (blueprint, rotas 404, token aceito, cabeçalhos ausentes) usam casos concretos; os demais usam `forAll` com semente fixa
  - Condição do bug: `isBugCondition(X) = C_persistencia(X) OR C_seguranca(X)` (seção "Condição do Bug" do design)
  - Comportamento esperado: `expectedBehavior(X, resultado)` (seção "Verificação da Correção" do design)
  - Criar `test/helpers/prop.mjs`: gerador com semente (mulberry32), geradores básicos (inteiros, strings, bytes, escolha, listas) e `forAll(gerador, propriedade, { runs, seed })` que imprime semente e contraexemplo na falha; conferir que `node --test` não quebra ao carregar o helper (arquivo sem testes)
  - Testes que no código sem correção alteram arquivos versionados (`src/data/modelo_cartas.json`, `public/assets/avatars/`, `public/assets/cards/`) DEVEM guardar hash/conteúdo/listagem antes e restaurar em `after()`
  - `test/deploy-config.test.mjs` (1.1): lê `render.yaml` como texto e exige `plan: starter`, disco com `mountPath: /data`, `DATA_DIR` = `/data` e `TRUST_PROXY`
  - `test/db-persistence.test.mjs` (1.2): define `DATA_DIR` temporário antes do `import()` dinâmico de `server/db.js`; após `initDb()`, 50 `INSERT`s seguidos; leitura em memória vê as 50 linhas, mas o arquivo em disco (aberto com outro `SQL.Database`) ainda não as tem e `typeof db.flush === "function"`; propriedade com `forAll`: sequências aleatórias de escritas intercaladas com `flush()` → banco reaberto do disco = estado em memória no último flush
  - `test/atomic-write.test.mjs` (1.3): `import()` de `server/lib/atomicWrite.js`; propriedade: conteúdos aleatórios (vazio, grande, binário) × falha injetada via `fsImpl` em `writeSync`/`fsyncSync`/`renameSync` → destino byte a byte igual ao anterior ou ao novo, sem `.tmp` restante; `cleanupStaleTemps` remove só os temporários do arquivo indicado (no código sem correção falha por módulo ausente: `_save()` grava direto no destino)
  - `test/e2e-persistence.test.mjs` (1.4, 1.6, 1.7, 1.9): (a) servidor filho com IPC recebe `"shutdown"` e deve sair com código 0 em até 5 s; (b) admin cria carta `TST-0001` → `DATA_DIR/cards/modelo_cartas.json` contém a carta e o hash de `src/data/modelo_cartas.json` não muda; (c) upload de avatar → `GET <avatar_url>` responde 200 `image/jpeg`; (d) upload de imagem de carta → arquivo em `DATA_DIR/assets/cards` e `GET /assets/cards/TST-0001.jpg` 200
  - `test/backup.test.mjs` (1.5): `import()` de `server/lib/backup.js`; propriedade: N e K ≥ 1 aleatórios → `DATA_DIR/backups` contém exatamente os min(N, K) snapshots mais recentes, cada um reabre como SQLite válido, e arquivos “estranhos” nunca são apagados; `resolveBackupConfig` desliga com `NODE_ENV=test` salvo `BACKUP_ENABLED=1`
  - Em `test/e2e-persistence.test.mjs` (1.5): `GET /api/admin/backup` com token de admin → 200 e corpo começando com `SQLite format 3\0`, incluindo escrita feita logo antes (dentro da janela de debounce); jogador → 403; sem token → 401, mensagens em pt-BR
  - `test/seed-data.test.mjs` (1.6, 1.7): `import()` de `server/lib/seedData.js`; propriedade: subconjuntos aleatórios de arquivos pré-existentes em um `DATA_DIR` temporário com conteúdo aleatório → seed cria todo o resto e nunca altera bytes existentes; segunda execução não muda nada
  - Em `test/e2e-persistence.test.mjs` (1.8): `GET /api/cards` responde 200 com o mesmo formato do JSON do repositório e inclui `TST-0001` sem novo build
  - `test/card-data-source.test.mjs` (1.8): `import()` de `src/lib/cardDataSource.js`; propriedade: respostas aleatórias (válida, status ≠ 200, JSON inválido, formato inválido, erro de rede, timeout) → `source: "api"` só para dados válidos, senão `source: "bundled"` com o fallback
  - `test/security.test.mjs` (1.10): app Express mínimo com o `loginLimiter` real e a configuração atual do `index.js` (sem `trust proxy`); 10 POSTs com `X-Forwarded-For: 203.0.113.1` e depois 1 POST com `X-Forwarded-For: 203.0.113.2` → o segundo cliente NÃO deve receber 429 (no código sem correção recebe); `node --test` não define `NODE_ENV=test`, então o limitador fica ativo
  - Em `test/security.test.mjs` (1.14): `resolveCorsOptions({ NODE_ENV: "production", SITE_URL })` aplicado a app mínimo; `Origin: https://site-malicioso.example` não recebe `Access-Control-Allow-Origin`; origens aleatórias só recebem o cabeçalho se forem a origem de `SITE_URL`/`RENDER_EXTERNAL_URL` (no código sem correção, reproduzir com `cors({ origin: true, credentials: true })` mostra a origem refletida)
  - `test/e2e-session.test.mjs` (1.11–1.13): (a) `POST /api/auth/change-password` → 200 com `token` novo aceito e token antigo 401; (b) após `reset-password` (token lido do console, como em `e2e-pwreset`), token antigo em `GET /api/auth/me/export` → 401 com mensagem em pt-BR; (c) após `DELETE /api/auth/me`, token antigo → 401; (d) rotas com `optionalAuth` (`GET /api/decks/community`, `GET /api/profile/:username`) tratam token revogado como anônimo
  - `test/e2e-security-headers.test.mjs` (1.15): `GET /api/health`, `GET /assets/cards/<id existente>.jpg` e 404 de asset inexistente devem ter `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy`, `content-security-policy` com `frame-ancestors 'none'`, e não ter `strict-transport-security` em `NODE_ENV=test`
  - `test/csp-compat.test.mjs` (caso de borda 1.15/3.12): nenhuma string passada a `document.write` em `src/App.jsx` e `src/components/AdminPanel.jsx` contém `<script` (no código sem correção os dois pop-ups de impressão têm script inline)
  - Rodar cada arquivo no código SEM a correção
  - **RESULTADO ESPERADO**: os testes FALHAM (isso é o correto: prova que o bug existe)
  - Documentar os contraexemplos encontrados (ex.: “arquivo do banco já contém as 50 linhas sem flush”, “`/api/cards` responde 404”, “segundo cliente recebe 429”, “token antigo responde 200 após reset”, “`/api/health` sem `content-security-policy`”)
  - Marcar a tarefa como concluída quando os testes estiverem escritos, executados e as falhas documentadas
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15_

- [x] 2. Escrever os testes de propriedade de preservação (ANTES da correção)
  - **Property 2: Preservation** - Dados, sessões existentes, ambientes, rate limit, CORS e CSP
  - **IMPORTANTE**: seguir a metodologia de observação primeiro: rodar o código SEM a correção com entradas fora da condição do bug (`NOT isBugCondition(X)`), registrar as saídas e então escrever as propriedades
  - Os testes devem rodar nas duas versões: chamar `flush()`/`close()` só se existirem; asserções sobre `token_version` só se a coluna existir; asserções sobre CSP só se o cabeçalho existir
  - `test/db-preservation.test.mjs` (3.4, 3.7, 3.16): propriedade: sequências aleatórias de `INSERT/UPDATE/DELETE/SELECT` em tabela de teste → mesmos `changes`, `lastInsertRowid` e linhas observados no código original; migração: banco com schema original e dados aleatórios abre com `initDb()` com todas as linhas preservadas (e `token_version = 0` quando a coluna existir); `PRAGMA foreign_keys` vale `0` após `initDb()` (estado efetivo observado com sql.js 1.14.1); só `sql.js` em `package.json`, sem dependência nativa nova
  - `test/e2e-session-preservation.test.mjs` (3.5, 3.6, 3.15): tokens gerados com `jwt.sign({ sub, username })` (sem `tv`) para usuários sem evento de segurança → mesmo status/corpo observado em `GET /api/decks/me` e `GET /api/auth/me/export`; token de admin (`sub: 0`, `role: "admin"`) → mesmo comportamento observado em `/api/admin/users`, `/api/admin/cards`, `/api/admin/articles` e na moderação do fórum; mensagens de erro em pt-BR
  - `test/security-preservation.test.mjs` (3.10): mesma sequência de requisições de um único cliente (sem `X-Forwarded-For`) ao `loginLimiter` → 429 no mesmo ponto e com a mesma mensagem em pt-BR observados
  - `test/e2e-preservation.test.mjs` (3.2, 3.3, 3.9, 3.11, 3.13): (a) CORS com `NODE_ENV=test`: origens aleatórias são refletidas com credenciais como hoje; com `ALLOWED_ORIGINS` definido, só as origens listadas recebem `Access-Control-Allow-Origin`; (b) para uma amostra de imagens de `public/assets/cards` presentes em `dist/assets/cards`, `GET /assets/cards/<id>.jpg` devolve os mesmos bytes (pular se `dist/` não existir); (c) `/api/health`, rotas `/api/*` e fallback da SPA respondem como antes; (d) isolamento: ao final, hash de `src/data/modelo_cartas.json`, listagem de `public/assets/` e de `server/` (fora de `.test-data-*`) iguais aos de antes, exercitando só operações fora da condição do bug (cadastro, login, decks)
  - Em `test/db-preservation.test.mjs` (3.2): sem `DATA_DIR`, o caminho do banco continua `server/deckbuilder.db` e os segredos `server/.jwt-secret` / `server/.admin-credentials.json` (verificação por leitura das constantes exportadas, sem gravar em `server/`)
  - Em `test/csp-compat.test.mjs` (3.12): se `dist/` existir, `dist/index.html` e `dist/admin.html` não têm `<script>` inline; registrar as origens externas usadas nos HTML (`fonts.googleapis.com`, `fonts.gstatic.com`) e, se houver cabeçalho CSP, exigir que ele as permita
  - Rodar a suíte existente (`node --test`, 19 arquivos / 273 testes) e os novos testes de preservação no código SEM a correção
  - **RESULTADO ESPERADO**: os testes PASSAM (confirma o comportamento de base a preservar)
  - Marcar a tarefa como concluída quando os testes estiverem escritos, executados e passando no código sem correção
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10, 3.11, 3.12, 3.13, 3.15, 3.16_

- [x] 3. Corrigir persistência de dados e segurança de sessão/borda HTTP

  - [x] 3.1 Criar `server/lib/paths.js` e centralizar os caminhos
    - `resolvePaths(env)` pura + constantes: `DATA_DIR` (padrão `server/`), `DB_PATH`, `JWT_SECRET_PATH`, `ADMIN_CREDENTIALS_PATH`, `CARDS_JSON_PATH`, `CARDS_IMG_DIR`, `AVATARS_DIR`, `BACKUPS_DIR`, `SEED_CARDS_JSON_PATH`, `PUBLIC_CARDS_IMG_DIR`, `PUBLIC_AVATARS_DIR`, `DIST_DIR`
    - `ensureDataDir()`; `server/db.js` e `server/secrets.js` passam a importar daqui (remover `DATA_DIR` duplicados); `secrets.js` chama `ensureDataDir()` antes de gravar
    - _Bug_Condition: C_persistencia(X), X.tipo IN ["deploy", "ler_cartas_rotas"]_
    - _Expected_Behavior: todos os dados mutáveis derivados de `DATA_DIR`_
    - _Preservation: sem `DATA_DIR`, mesmos caminhos em `server/` (Property 10)_
    - _Requirements: 2.1, 2.12, 3.2, 3.3_

  - [x] 3.2 Criar `server/lib/atomicWrite.js`
    - `writeFileAtomicSync(target, data, { fsImpl })`: temporário `.<base>.<pid>.<ts>.<rand>.tmp` no mesmo diretório, `open/write/fsync/close`, `renameSync`; até 5 tentativas de `rename` em `EPERM`/`EBUSY`/`EACCES` (Windows); em falha, apaga o temporário e relança
    - `cleanupStaleTemps(dir, baseName)` remove só `.<base>.*.tmp`
    - _Bug_Condition: X.tipo = "crash_durante_gravacao"_
    - _Expected_Behavior: destino ∈ {versão anterior completa, versão nova completa}, sem `.tmp` (Property 2)_
    - _Preservation: conteúdo gravado idêntico ao de hoje_
    - _Requirements: 2.3, 2.8_

  - [x] 3.3 Debounce e `flush()` no `DbWrapper` (`server/db.js`)
    - `exec()`/`run()` chamam `_markDirty()`; timer único com `unref()`, `saveDelayMs` padrão 250 ms (`DB_SAVE_DELAY_MS`)
    - `flush()` síncrono e idempotente com `writeFileAtomicSync`; em erro registra log em pt-BR sem dados sensíveis, mantém `dirty`, reagenda em 5 s e relança só em chamada explícita
    - `serialize()` (flush + `export()`), `close()` (limpa timer + flush)
    - `initDb({ dbPath, saveDelayMs } = {})`; `cleanupStaleTemps` no início; flush forçado ao final de `initDb()` com comentário sobre o reset de PRAGMA pelo `export()` (preserva `foreign_keys` efetivo = 0)
    - API pública e retorno `{ changes, lastInsertRowid }` inalterados
    - _Bug_Condition: X.tipo = "escrita_db"_
    - _Expected_Behavior: leitura imediata vê a escrita AND gravações em disco por janela ≤ 1 (Property 1)_
    - _Preservation: mesmos retornos, banco existente sem perda, PRAGMA efetivo inalterado (Property 8)_
    - _Requirements: 2.2, 2.3, 3.4, 3.16_

  - [x] 3.4 Flush no encerramento (`server/index.js`)
    - `const server = app.listen(...)` mantendo o log `Rodando em`
    - `shutdown(motivo)` executado uma vez: para o agendador de backup, `db.close()`, `server.close()`, `process.exit(0)` (1 se o flush falhar), timeout de segurança de 5 s com `unref()`
    - Registrar em `SIGTERM`, `SIGINT` e, se `process.send` existir, na mensagem IPC `"shutdown"`; `process.on("exit", () => db.flush())` como rede de segurança
    - _Bug_Condition: X.tipo = "sinal" AND X.sinal IN ["SIGTERM", "SIGINT"]_
    - _Expected_Behavior: disco contém todas as escritas pendentes AND código de saída 0 (Property 1)_
    - _Preservation: inicialização e log de boot iguais (Property 10)_
    - _Requirements: 2.4, 3.13_

  - [x] 3.5 Backups: `server/lib/backup.js` e `GET /api/admin/backup`
    - `createSnapshot` (`db.serialize()` + `writeFileAtomicSync` em `BACKUPS_DIR/deckbuilder-<AAAAMMDDTHHMMSSZ>.db`), `rotateSnapshots` (só nomes `^deckbuilder-\d{8}T\d{6}Z\.db$`), `resolveBackupConfig(env)` (`BACKUP_ENABLED`, `BACKUP_INTERVAL_HOURS` = 24, `BACKUP_KEEP` = 7; desligado em `NODE_ENV=test` salvo `BACKUP_ENABLED=1|true`), `startBackupSchedule` (primeiro disparo em `max(0, intervalo − idade do último)`, timers `unref()`, retorna `stop()`)
    - Chamar `startBackupSchedule(db, resolveBackupConfig(process.env))` após o `listen` em `server/index.js`
    - `admin.js`: rota `GET /api/admin/backup` com o `requireAdmin` local, `Content-Type: application/vnd.sqlite3`, `Content-Disposition` com nome datado, `Cache-Control: no-store`; erro → 500 `"Erro ao gerar backup do banco."`
    - `AdminPanel.jsx`: botão "Baixar backup do banco" (fetch com token de admin, `Blob` + `<a download>`, erro via `flash` em pt-BR)
    - _Bug_Condition: X.tipo = "backup"_
    - _Expected_Behavior: min(N, K) snapshots mais recentes AND (admin ⇒ 200 banco válido) AND (não admin ⇒ 401/403) (Property 3)_
    - _Preservation: sem timers em `NODE_ENV=test` (Property 10); mensagens em pt-BR_
    - _Requirements: 2.5, 2.6, 3.3, 3.15_

  - [x] 3.6 Seed de `DATA_DIR` (`server/lib/seedData.js`)
    - `seedDataDir(paths)`: cria `cards/` e `assets/`; copia `modelo_cartas.json` com `COPYFILE_EXCL`; copia `public/assets/cards` só se `CARDS_IMG_DIR` não existir (`force: false`); cria `AVATARS_DIR` e copia avatares do repositório só se acabou de criá-lo; retorna resumo e registra log
    - Chamar `seedDataDir()` em `server/index.js` antes de `initDb()`
    - _Bug_Condition: X.tipo IN ["crud_carta", "upload_imagem_carta", "upload_avatar"] em `DATA_DIR` sem dados_
    - _Expected_Behavior: cria só o que falta, nunca sobrescreve (Property 4)_
    - _Preservation: dados existentes em `DATA_DIR` intactos byte a byte_
    - _Requirements: 2.7, 3.4_

  - [x] 3.7 `server/lib/cardStore.js` e leitores de cartas
    - `readCardData()` (lê `CARDS_JSON_PATH`; fallback somente leitura em `SEED_CARDS_JSON_PATH`) e `writeCardData(data)` (`writeFileAtomicSync` com `JSON.stringify(data, null, 2)`)
    - `server/routes/cards.js`: remove caminhos locais e usa `cardStore`; validações, mensagens e formatos inalterados
    - `decks.js` (`loadCardData`), `profile.js` (heurísticas) e `admin.js` (analytics de meta) usam `readCardData()`
    - _Bug_Condition: X.tipo IN ["crud_carta", "ler_cartas_rotas"]_
    - _Expected_Behavior: gravado em `DATA_DIR` de forma atômica AND rotas leem `CARDS_JSON_PATH` (Property 4)_
    - _Preservation: mesmas operações e formatos do admin de cartas (Property 8)_
    - _Requirements: 2.8, 2.12, 3.8_

  - [x] 3.8 Uploads em `DATA_DIR` e serviço de `/assets/cards` e `/assets/avatars`
    - `cards.js`: upload grava `join(CARDS_IMG_DIR, id + ".jpg")` com `writeFileAtomicSync`; remoção de `.png/.webp` antigos mantida
    - `profile.js`: `AVATAR_DIR` → `AVATARS_DIR` com `writeFileAtomicSync`; URL retornada continua `/assets/avatars/<id>.jpg`
    - `server/index.js`: antes do bloco do `dist/` (com ou sem `dist/`), `express.static(CARDS_IMG_DIR)` + `express.static(PUBLIC_CARDS_IMG_DIR)` em `/assets/cards` e o equivalente para avatares, com `index: false`; nunca montar a raiz de `DATA_DIR`
    - _Bug_Condition: X.tipo IN ["upload_imagem_carta", "upload_avatar"] OR (X.tipo = "get_asset" AND arquivoEnviadoEmRuntime)_
    - _Expected_Behavior: serve de `DATA_DIR`, senão do repositório/build; nada gravado em `public/` (Property 4)_
    - _Preservation: mesmas URLs e bytes para imagens do repositório (Property 10)_
    - _Requirements: 2.9, 2.10, 3.9_

  - [x] 3.9 Endpoint público `GET /api/cards`
    - Exportar `publicCardsRouter` em `cards.js`: `Cache-Control: no-cache` + `res.json(readCardData())`, sem autenticação
    - Montar em `server/index.js` com `app.use("/api/cards", publicCardsRouter)`
    - _Bug_Condition: X.tipo = "carregar_frontend" AND cartasEditadasDepoisDoBuild()_
    - _Expected_Behavior: API devolve os dados atuais de `DATA_DIR` (Property 5)_
    - _Preservation: mesmo formato do JSON do repositório; demais rotas `/api/*` inalteradas_
    - _Requirements: 2.11, 3.13_

  - [x] 3.10 Cartas em tempo de execução no frontend
    - `src/lib/cardDataSource.js`: `isValidCardData(d)` e `fetchCardData({ fallback, fetchImpl, timeoutMs = 5000 })` → `{ data, source }`
    - `src/hooks/useCardData.jsx`: `CardDataProvider` (JSON embutido como estado inicial/fallback, busca `/api/cards` uma vez) e `useCardData()` → `{ cardData, loaded }`; `src/main.jsx` envolve `<App />`
    - `src/App.jsx`: usa `useCardData()`; `useMemo` dependem de `CARD_DATA`; restauração do build salvo (`normalizeBuild`) só quando `loaded`
    - `src/components/DecklistsTab.jsx`: `cardIndex` via `useMemo` com `useCardData()`
    - _Bug_Condition: X.tipo = "carregar_frontend"_
    - _Expected_Behavior: cartasUsadas = (apiValida ? dadosDaApi : dadosEmbutidos) (Property 5)_
    - _Preservation: sem API, comportamento igual ao de hoje com o JSON embutido_
    - _Requirements: 2.11, 3.7, 3.12_

  - [x] 3.11 Plugin de desenvolvimento no Vite (`vite.config.js`)
    - Plugin local `dataDirAssets()` com `configureServer`: para `GET /assets/(cards|avatars)/<nome>` com `<nome>` em `^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$`, faz stream do arquivo de `DATA_DIR` se existir (com `Content-Type`), senão `next()`
    - `DATA_DIR` via `loadEnv(mode, process.cwd(), "")` + `resolvePaths()`; proxy `/api` inalterado
    - _Bug_Condition: X.tipo = "get_asset" em desenvolvimento_
    - _Expected_Behavior: imagens enviadas aparecem no Vite (Property 4)_
    - _Preservation: imagens de `public/` continuam servidas pelo Vite (Property 10)_
    - _Requirements: 2.10, 3.2, 3.9_

  - [x] 3.12 Blueprint e documentação de deploy
    - `render.yaml`: `plan: starter`; `disk: { name: forja-data, mountPath: /data, sizeGB: 1 }`; `DATA_DIR=/data`, `TRUST_PROXY=1`; comentários atualizados
    - `DEPLOY.md`: custo do disco, instância única sem deploy zero-downtime, variáveis `BACKUP_*`/`DB_SAVE_DELAY_MS`/`TRUST_PROXY`, download e restauração de backup, limites dos backups locais, JSON do repositório como seed/fallback; remover "isso reseta os dados também"
    - `README.md` (cartas editáveis em `server/cards/modelo_cartas.json` no dev), `.env.example` (novas variáveis), `.gitignore` (`server/cards/`, `server/assets/`, `server/backups/`, `server/.*.tmp`)
    - _Bug_Condition: X.tipo = "deploy" AND NOT X.ambiente.disco_persistente_
    - _Expected_Behavior: blueprintTemDisco("/data") AND dadosSobrevivemReinicio() (Property 1)_
    - _Preservation: `JWT_SECRET`, `ADMIN_PASSWORD` e variáveis de e-mail inalteradas_
    - _Requirements: 2.1, 2.13_

  - [x] 3.13 `trust proxy` configurável (`server/middleware/security.js` + `server/index.js`)
    - `resolveTrustProxy(env)`: vazio → `1` em produção e `false` fora; `^\d+$` → número; `"true"`/`"false"` → booleano com aviso; outro texto → repassado ao Express
    - `server/index.js`: `app.disable("x-powered-by")` e `app.set("trust proxy", resolveTrustProxy(process.env))`
    - _Bug_Condition: X.tipo = "requisicao_http" AND X.req.x_forwarded_for AND produção_
    - _Expected_Behavior: chaveRateLimit = ipRealDoCliente (Property 7)_
    - _Preservation: mesmos limites e mensagens; sem `X-Forwarded-For` nada muda (Property 11)_
    - _Requirements: 2.13, 3.10_

  - [x] 3.14 Versão de token: migração e middlewares
    - `server/db.js`: migração `token_version INTEGER NOT NULL DEFAULT 0` via `PRAGMA table_info(users)` + `ALTER TABLE` em `try/catch`
    - `server/middleware/auth.js`: `signUserToken` inclui `tv: token_version ?? 0`; `resolveSessionUser(payload, db)` (admin aceito sem consulta; usuário inexistente ou `(tv ?? 0) !== token_version` → inválido)
    - `requireAuth`: JWT inválido → 401 `"Token inválido ou expirado."`; sessão revogada → 401 `{ error: "Sua sessão expirou. Faça login novamente.", code: "SESSION_REVOKED" }`; `optionalAuth` segue anônimo em qualquer falha; `req.user` mantém `{ id, username, role }`
    - `server/routes/auth.js`: `register` e `login` usam `signUserToken`
    - _Bug_Condition: X.req.token IS NOT NULL AND tv do token ≠ token_version atual_
    - _Expected_Behavior: requireAuth ⇒ 401 pt-BR AND optionalAuth ⇒ anônimo (Property 6)_
    - _Preservation: tokens sem `tv` com `token_version = 0` e token de admin aceitos (Property 9); migração sem perda (Property 8)_
    - _Requirements: 2.17, 3.4, 3.5, 3.6, 3.15_

  - [x] 3.15 Troca de senha, reset e exclusão revogam tokens
    - `server/middleware/rateLimit.js`: adicionar `passwordChangeLimiter` (5 a cada 15 min, `"Muitas tentativas. Tente novamente em alguns minutos."`); limitadores existentes intactos
    - Nova rota `POST /api/auth/change-password` (`passwordChangeLimiter`, `requireAuth`): valida tamanho como no reset, senha atual errada → 401 `"Senha atual incorreta."`, `UPDATE ... token_version = token_version + 1`, responde `{ message: "Senha alterada com sucesso.", token }`, envia `passwordChangedEmail` sem `await`
    - `reset-password` e `DELETE /me`: `UPDATE` inclui `token_version = token_version + 1`
    - `src/lib/api.js`: `changePassword(currentPassword, newPassword)` salva o token devolvido com `setToken`
    - _Bug_Condition: X.usuario.evento_seguranca_desde_emissao IN ["troca_senha", "redefinicao_senha", "exclusao_conta"]_
    - _Expected_Behavior: tokens anteriores rejeitados AND troca devolve token novo aceito (Property 6)_
    - _Preservation: fluxo de recuperação por e-mail e demais respostas inalterados (Property 8)_
    - _Requirements: 2.14, 2.15, 2.16, 3.14, 3.15_

  - [x] 3.16 CORS restrito em produção
    - `resolveCorsOptions(env)` em `security.js`: com `ALLOWED_ORIGINS` → lista exata como hoje; produção sem `ALLOWED_ORIGINS` → função que permite sem `Origin` ou com a origem normalizada (`new URL(x).origin`) de `SITE_URL`/`RENDER_EXTERNAL_URL`, e `callback(null, false)` para as demais; fora de produção → `{ origin: true, credentials: true }`
    - `server/index.js`: `app.use(cors(resolveCorsOptions(process.env)))`
    - _Bug_Condition: produção AND ALLOWED_ORIGINS vazio AND X.req.origin NOT IN origensDoSite_
    - _Expected_Behavior: semCabecalhoAllowOrigin(resultado) (Property 7)_
    - _Preservation: decisão igual com `ALLOWED_ORIGINS` definido ou fora de produção (Property 11)_
    - _Requirements: 2.18, 3.11_

  - [x] 3.17 Cabeçalhos de segurança e helper de impressão para a CSP
    - `securityHeaders({ isProduction })` em `security.js`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP do design (`script-src 'self'`, `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, `font-src 'self' https://fonts.gstatic.com data:`, `frame-ancestors 'none'` etc.), `Strict-Transport-Security: max-age=15552000` só em produção
    - `server/index.js`: `app.use(securityHeaders({ isProduction }))` antes de tudo (cobre estáticos e 404)
    - `src/lib/printPopup.js`: `printWhenImagesLoaded(popup, delayMs)`; `App.jsx` e `AdminPanel.jsx` removem o `<script>` inline do HTML do pop-up e chamam o helper após `document.close()`
    - _Bug_Condition: X.tipo = "requisicao_http" (cabeçalhos ausentes)_
    - _Expected_Behavior: temCabecalhosSeguranca(resultado) AND (HSTS ⇔ produção) (Property 7)_
    - _Preservation: scripts, estilos, Google Fonts, imagens, API e impressão automática funcionando (Property 11)_
    - _Requirements: 2.19, 3.12_

  - [x] 3.18 Verificar que os testes exploratórios agora passam
    - **Property 1: Expected Behavior** - Persistência, conteúdo do admin, sessão e borda HTTP
    - **IMPORTANTE**: rodar novamente os MESMOS testes da tarefa 1; NÃO escrever testes novos
    - Os testes da tarefa 1 codificam o comportamento esperado; passar confirma que ele foi atingido
    - Rodar `test/deploy-config`, `db-persistence`, `atomic-write`, `backup`, `seed-data`, `card-data-source`, `security`, `csp-compat`, `e2e-persistence`, `e2e-session` e `e2e-security-headers`
    - **RESULTADO ESPERADO**: os testes PASSAM (confirma que o bug foi corrigido)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17, 2.18, 2.19_

  - [x] 3.19 Verificar que os testes de preservação continuam passando
    - **Property 2: Preservation** - Dados, sessões existentes, ambientes, rate limit, CORS e CSP
    - **IMPORTANTE**: rodar novamente os MESMOS testes da tarefa 2; NÃO escrever testes novos
    - Rodar `test/db-preservation`, `e2e-session-preservation`, `security-preservation`, `e2e-preservation` e `csp-compat`
    - **RESULTADO ESPERADO**: os testes PASSAM (confirma que não há regressões)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16_

- [ ] 4. Checkpoint - Garantir que todos os testes passam
  - Rodar a suíte completa com `node --test`: os 19 arquivos / 273 testes originais passam sem alteração de asserções, junto com todos os testes novos
  - Rodar `npm run build` e confirmar que conclui sem erros
  - Confirmar que nenhum arquivo versionado em `src/`, `public/` ou `server/` foi alterado pelos testes e que não restaram pastas `server/.test-data-*` nem `.tmp`
  - Verificação manual (fora da automação): `NODE_ENV=production` local após o build, abrir `/` e `/admin` sem violações de CSP no console e com os PDFs de impressão disparando sozinhos; em `npm run dev` + `npm run dev:server`, imagem/avatar enviado aparece no Vite
  - Perguntar ao usuário se surgirem dúvidas
  - _Requirements: 3.1, 3.12, 3.16_
