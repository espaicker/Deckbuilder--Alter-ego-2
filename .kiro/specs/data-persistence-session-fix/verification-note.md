# Nota de verificação — iteração 1 (implementação inicial)

Ambiente: Windows, PowerShell, Node v24.18.0, sql.js (sem dependências novas; `package.json` inalterado).
Sem `review.json` → primeira iteração: tarefas 3.1–3.17 implementadas, 3.18/3.19 e Tarefa 4 executadas.

## O que foi implementado

- 3.1 `server/lib/paths.js` (`resolvePaths(env)` + constantes + `ensureDataDir()`, que só cria a pasta se faltar). `db.js` e `secrets.js` importam daqui; `secrets.js` chama `ensureDataDir()` só antes de gravar.
- 3.2 `server/lib/atomicWrite.js` (`writeFileAtomicSync` com `fsImpl`, temporário `.<base>.<pid>.<ts>.<rand>.tmp`, `fsync`, até 5 tentativas de `rename` em EPERM/EBUSY/EACCES, limpeza do temporário em falha; `cleanupStaleTemps`). `writeSync` é chamado mesmo para conteúdo vazio (comportamento uniforme).
- 3.3 `DbWrapper` com debounce (`_markDirty`, timer único `unref()`, `DB_SAVE_DELAY_MS` padrão 250), `flush()`/`serialize()`/`close()`, `initDb({ dbPath, saveDelayMs })` com `cleanupStaleTemps` no início e flush forçado no fim (comentário sobre o reset de PRAGMA pelo `export()`; `foreign_keys` efetivo continua 0).
  - Detalhe de preservação: antes, o `export()` de cada `run()` zerava `changes`/`last_insert_rowid`. Agora `run()` calcula os dois só sobre o próprio comando (`total_changes()` antes/depois; `lastInsertRowid` só para INSERT/REPLACE que inseriu, senão 0). Coberto pelo teste de preservação Property 8.
- 3.4 `server/index.js`: `const server = app.listen(...)` (log `Rodando em` mantido), `shutdown(motivo)` único (para backups, `db.close()`, `server.close()`, `exit(0|1)`, timeout 5 s `unref`), SIGTERM/SIGINT/IPC `"shutdown"`, `process.on("exit", () => db.flush())`.
- 3.5 `server/lib/backup.js` (`createSnapshot`, `rotateSnapshots`, `resolveBackupConfig`, `startBackupSchedule`, `snapshotFileName`); `GET /api/admin/backup` em `admin.js`; botão "Baixar backup do banco" na aba Estatísticas do `AdminPanel.jsx`.
- 3.6 `server/lib/seedData.js` (`seedDataDir(paths)`), chamado antes de `initDb()`.
- 3.7 `server/lib/cardStore.js`; `cards.js`, `decks.js`, `profile.js`, `admin.js` (meta analytics) usam `readCardData()`/`writeCardData()`.
- 3.8 Upload de carta → `DATA_DIR/assets/cards` e avatar → `DATA_DIR/assets/avatars` com `writeFileAtomicSync`; estáticos `/assets/cards` e `/assets/avatars` (DATA_DIR → repositório, `index: false`) antes do bloco do `dist/`.
- 3.9 `publicCardsRouter` em `/api/cards` (`Cache-Control: no-cache`).
- 3.10 `src/lib/cardDataSource.js`, `src/hooks/useCardData.jsx`, `main.jsx` com `CardDataProvider`, `App.jsx` (memos dependem de `CARD_DATA`; restauração do build salvo só quando `loaded`, uma vez), `DecklistsTab.jsx` (índice via `useMemo` + `useCardData()`, calculado uma vez por versão dos dados).
- 3.11 `vite.config.js`: plugin `dataDirAssets()` (regex restrita, sem traversal), `loadEnv` + `resolvePaths`, proxy `/api` inalterado.
- 3.12 `render.yaml` (starter, disco `forja-data` em `/data`, `DATA_DIR=/data`, `TRUST_PROXY="1"`), `DEPLOY.md`, `README.md`, `.env.example`, `.gitignore`.
- 3.13–3.17 `server/middleware/security.js` (`resolveTrustProxy`, `resolveCorsOptions`, `securityHeaders`); `token_version` (migração, `signUserToken`, `resolveSessionUser`, `requireAuth`/`optionalAuth`); `passwordChangeLimiter` + `POST /api/auth/change-password`; reset e `DELETE /me` incrementam `token_version`; `api.changePassword`; `src/lib/printPopup.js` e remoção do `<script>` inline dos dois pop-ups.
  - 404/erro padrão do Express (finalhandler) sobrescreve a CSP com `default-src 'none'`. O middleware mantém essa política (mais restrita) e só acrescenta `frame-ancestors 'none'`. Corpo e status do 404 continuam idênticos.

## Erros encontrados na varredura e corrigidos

- `e2e-security-headers`: 404 de `/assets/cards/NAO-EXISTE-9999.jpg` vinha com CSP `default-src 'none'` (finalhandler) sem `frame-ancestors` → corrigido em `securityHeaders` (acima).
- `server/routes/admin.js`: caractere BOM (U+FEFF) perdido no meio do arquivo (linha da consulta de meta analytics) removido; imports mortos (`fileURLToPath`/`dirname`/`__dirname`) e `import("fs")`/`import("path")` dinâmicos removidos junto com o caminho fixo `src/data/modelo_cartas.json`.
- `server/routes/profile.js`: `extname`, `readFileSync`, `__dirname` e `import("fs")` dinâmico não usados mais → removidos.
- `server/routes/auth.js`: `jwt`, `JWT_SECRET`, `JWT_EXPIRES_IN` sem uso após `signUserToken` → removidos.
- Varredura: nenhum `src/data/modelo_cartas.json`/`public/assets`/`__dirname` restante em `server/` (só comentários em `paths.js`/`cardStore.js`); em `src/`, `../data/modelo_cartas.json` só é importado por `src/hooks/useCardData.jsx` (fallback embutido, como o design pede).

## Testes executados (saída redirecionada para arquivo e lida depois)

| Execução | Arquivos | Resultado |
| --- | --- | --- |
| 3.18 — Tarefa 1 (`deploy-config`, `db-persistence`, `atomic-write`, `backup`, `seed-data`, `card-data-source`, `security`, `csp-compat`, `e2e-persistence`, `e2e-session`, `e2e-security-headers`) | 11 | 1ª rodada: 41 testes, 39 ok, 2 falhas (404 sem `frame-ancestors`). Após a correção, `e2e-security-headers` passou (rodada abaixo) e a suíte completa confirmou os 11 arquivos verdes. |
| 3.19 — Tarefa 2 (`db-preservation`, `e2e-session-preservation`, `security-preservation`, `e2e-preservation`, `csp-compat`) + `e2e-security-headers` | 6 | 34 testes, 34 ok, 0 falhas. |
| Tarefa 4 — suíte completa `node --test` | 35 (19 originais + 16 novos) | **332 testes, 330 ok, 2 falhas** (1 subteste + o teste pai, ambos em `test/e2e-lgpd.test.mjs`). Duração ~35 s. |

### Falha pendente (bloqueio — decisão do usuário)

`test/e2e-lgpd.test.mjs:136` — "Email e hash de senha nao vazam para outro usuario apos anonimizacao":

```js
// alice nao consegue mais usar o token? token ainda valido por 7d, mas conta anonimizada:
const { data: aliceExport } = await req("GET", "/api/auth/me/export", undefined, aliceToken);
assert.equal(aliceExport.account.email, null, "email deve ter sido apagado");
```

Esse teste original espera que o token antigo continue aceito depois de `DELETE /api/auth/me` (exatamente o defeito 1.13). O bugfix exige o contrário (2.16) e o teste novo `e2e-session` ("exclusao de conta revoga o token antigo") cobra 401 para a mesma requisição. As duas asserções são incompatíveis; nenhuma implementação satisfaz ambas sem "trapacear" a resposta. Não alterei o teste original (asserções não podem mudar sem autorização). Pedido de decisão enviado ao usuário.

## Build

`npm run build` (Vite 5.4.21): 65 módulos, `dist/index.html`, `dist/admin.html`, `App-*.css`, `main-*.js`, `App-*.js`, `admin-*.js`; "built in 4.20s", sem erros nem avisos.

## Boot local em produção (após o build)

Script temporário: `NODE_ENV=production`, `DATA_DIR` em pasta temporária do sistema, `PORT=3099`, `SITE_URL=https://forja.example`; encerrado via IPC `"shutdown"` (código de saída 0) e pasta temporária removida.

| Rota | Status | Content-Type |
| --- | --- | --- |
| `/` | 200 | text/html |
| `/admin` | 200 | text/html |
| `/api/health` | 200 | application/json |
| `/api/cards` | 200 | application/json (34 013 bytes) |
| `/assets/cards/ACA-0001.jpg` | 200 | image/jpeg (120 370 bytes) |
| `/assets/cards/NAO-EXISTE.jpg` | 404 | text/html (CSP `default-src 'none'; frame-ancestors 'none'`) |

- Em todas as respostas 200: CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` → Google Fonts (CSS e arquivos de fonte) permitidos.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=15552000` (produção), sem `X-Powered-By`.
- CORS: `Origin: https://site-malicioso.example` → sem `Access-Control-Allow-Origin`; `Origin: https://forja.example` → refletida.
- Log do boot: seed criou `cards/modelo_cartas.json`, `assets/cards`, `assets/avatars`; backup automático gravou `backups/deckbuilder-20261009T122835Z.db` (primeiro disparo imediato, sem snapshot anterior); conteúdo de `DATA_DIR` ao fim: `assets`, `backups`, `cards`, `deckbuilder.db`.
- Não verificado (exige navegador): console sem violações de CSP e impressão automática dos pop-ups de proxies; imagem/avatar enviado aparecendo no `npm run dev`.

## Isolamento e limpeza

- `git status`: nenhum arquivo versionado em `src/`, `public/` ou `server/` alterado por testes (só os arquivos editados de propósito nesta tarefa). Nenhuma pasta `server/.test-data-*` e nenhum `.tmp` em `server/`, `src/` ou `public/`.
- Observação: o teste original `test/e2e-api.test.mjs` sobe o servidor **sem** `DATA_DIR` (usa `server/`, comportamento de dev 3.2). Com o seed, ele cria `server/cards/` e `server/assets/` (cópias do repositório, ~15,6 MB, já no `.gitignore`). As cópias criadas pela minha execução foram apagadas. Nada versionado é tocado.
- Arquivos temporários de verificação (`_*.txt`, `_boot*`, `_mark.mjs`) apagados.
