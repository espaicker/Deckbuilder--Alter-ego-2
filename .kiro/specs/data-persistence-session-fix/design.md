# Design do Bugfix — Persistência de Dados e Segurança de Sessão

## Visão Geral (Overview)

O "Forja de Alter Egos" perde dados a cada deploy/reinício no Render, grava o banco de forma síncrona e não atômica a cada comando, não tem backup e grava conteúdo do admin (cartas, imagens, avatares) na árvore de código, onde ele não é servido em produção e some no próximo deploy. Na borda HTTP, o servidor não confia no proxy do Render (rate limit por IP do proxy), não revoga tokens JWT, reflete qualquer origem no CORS em produção e não envia cabeçalhos de segurança.

A estratégia da correção é mínima e localizada, mantendo sql.js e sem dependências novas:

1. **Diretório de dados único**: um módulo `server/lib/paths.js` deriva todos os caminhos de `DATA_DIR` (padrão `server/`). Banco, segredos, cartas, imagens de cartas, avatares e backups passam a viver ali. Na primeira inicialização, um seed copia as cópias do repositório sem nunca sobrescrever.
2. **Persistência coalescida e atômica**: o `DbWrapper` continua síncrono para as rotas; só a gravação em disco muda (debounce + arquivo temporário + `rename`), com `flush()` explícito, flush no SIGTERM/SIGINT e no `exit`.
3. **Backups**: snapshots periódicos com rotação em `DATA_DIR/backups` e download admin em `GET /api/admin/backup`.
4. **Conteúdo do admin servido em runtime**: `/assets/cards` e `/assets/avatars` servidos de `DATA_DIR` antes do build; `GET /api/cards` público alimenta o frontend, com o JSON embutido como fallback.
5. **Sessão revogável**: coluna `users.token_version` + claim `tv` no JWT, verificada em `requireAuth`/`optionalAuth`; incrementada em troca de senha (rota nova), redefinição de senha e exclusão de conta.
6. **Borda HTTP**: `trust proxy` configurável, CORS restrito em produção e um middleware próprio de cabeçalhos de segurança (CSP compatível com Google Fonts e com os pop-ups de impressão).
7. **Deploy**: `render.yaml` com plano Starter, disco em `/data`, `DATA_DIR=/data` e `TRUST_PROXY=1`.

## Glossário (Glossary)

- **Bug_Condition (C)**: condição que identifica um evento (requisição, escrita no banco, sinal de processo, deploy, upload) que hoje produz comportamento defeituoso — perda de dados, gravação não atômica/síncrona por comando, conteúdo não servido/não persistido, token não revogado, IP errado no rate limit, CORS permissivo ou ausência de cabeçalhos.
- **Property (P)**: comportamento correto esperado para eventos em C (seções 2.x do `bugfix.md`).
- **Preservation**: comportamentos para eventos fora de C que devem permanecer idênticos (seções 3.x do `bugfix.md`).
- **F / F'**: código original (sem correção) / código corrigido.
- **DATA_DIR**: diretório raiz de dados mutáveis. Padrão `server/` (dev/testes); `/data` no Render.
- **DbWrapper**: classe em `server/db.js` que imita a API síncrona do better-sqlite3 (`prepare/run/get/all/exec/pragma`) sobre sql.js.
- **flush()**: método novo do `DbWrapper` que, se houver alterações pendentes, exporta o banco e grava atomicamente em disco. Síncrono, idempotente.
- **Gravação atômica**: escrever em arquivo temporário no mesmo diretório do destino, `fsync`, e `rename` sobre o destino. O destino é sempre a versão anterior completa ou a nova completa.
- **Seed**: cópia inicial, a partir do repositório, de `src/data/modelo_cartas.json`, `public/assets/cards/` e `public/assets/avatars/` para `DATA_DIR`, só quando o destino não existe.
- **token_version (tv)**: inteiro em `users.token_version` (padrão 0) e claim `tv` no JWT. Token sem `tv` é tratado como `tv = 0`.
- **Token de admin**: JWT com `sub: 0` e `role: "admin"`; não tem linha em `users` e não passa pela checagem de versão.
- **requireAuth / optionalAuth**: middlewares em `server/middleware/auth.js`.
- **requireAdmin**: verificações locais de admin em `admin.js`, `cards.js` (verificam o JWT direto) e em `articles.js`, `forum.js` (dependem de `req.user`).

## Detalhes do Bug (Bug Details)

### Condição do Bug (Bug Condition)

O bug se manifesta em dois grupos de eventos. No grupo de persistência: deploy/reinício sem disco persistente; qualquer escrita no banco (regravação síncrona e não atômica do arquivo inteiro); término do processo sem flush; ausência de backup; escrita/leitura de cartas, imagens e avatares na árvore de código; frontend preso ao JSON do build. No grupo de segurança: requisições atrás do proxy sem `trust proxy`; tokens antigos aceitos após troca/redefinição de senha ou exclusão de conta; CORS refletindo origens arbitrárias em produção; respostas sem cabeçalhos de segurança.

**Especificação Formal:**
```
TYPE Evento = {
  tipo: "deploy" | "escrita_db" | "sinal" | "crash_durante_gravacao" | "backup"
      | "crud_carta" | "upload_imagem_carta" | "upload_avatar" | "get_asset"
      | "carregar_frontend" | "ler_cartas_rotas" | "requisicao_http",
  ambiente: { NODE_ENV, DATA_DIR?, TRUST_PROXY?, ALLOWED_ORIGINS?, SITE_URL?,
              RENDER_EXTERNAL_URL?, plano_render, disco_persistente },
  req?: { ip_proxy, x_forwarded_for?, origin?, token?, rota },
  usuario?: { id, token_version_atual, evento_seguranca_desde_emissao? }
}

FUNCTION isBugCondition(X)
  INPUT: X of type Evento
  OUTPUT: boolean

  RETURN C_persistencia(X) OR C_seguranca(X)
END FUNCTION

FUNCTION C_persistencia(X)
  RETURN (X.tipo = "deploy" AND NOT X.ambiente.disco_persistente)                       // 1.1
      OR (X.tipo = "escrita_db")                                                        // 1.2: F regrava o arquivo inteiro, síncrono, por comando
      OR (X.tipo = "crash_durante_gravacao")                                            // 1.3
      OR (X.tipo = "sinal" AND X.sinal IN ["SIGTERM", "SIGINT"])                        // 1.4
      OR (X.tipo = "backup")                                                            // 1.5
      OR (X.tipo IN ["crud_carta", "upload_imagem_carta", "upload_avatar"])             // 1.6, 1.7
      OR (X.tipo = "get_asset" AND arquivoEnviadoEmRuntime(X.req.rota))                 // 1.7: 404 em produção
      OR (X.tipo = "carregar_frontend" AND cartasEditadasDepoisDoBuild())               // 1.8
      OR (X.tipo = "ler_cartas_rotas")                                                  // 1.9
END FUNCTION

FUNCTION C_seguranca(X)
  RETURN (X.tipo = "requisicao_http" AND X.req.x_forwarded_for IS NOT NULL
          AND X.ambiente.NODE_ENV = "production")                                       // 1.10
      OR (X.tipo = "requisicao_http" AND X.req.token IS NOT NULL
          AND X.usuario.evento_seguranca_desde_emissao IN
              ["troca_senha", "redefinicao_senha", "exclusao_conta"])                   // 1.11–1.13
      OR (X.tipo = "requisicao_http" AND X.ambiente.NODE_ENV = "production"
          AND X.ambiente.ALLOWED_ORIGINS IS EMPTY
          AND X.req.origin IS NOT NULL
          AND X.req.origin NOT IN origensDoSite(X.ambiente))                            // 1.14
      OR (X.tipo = "requisicao_http")                                                   // 1.15: nenhuma resposta tem cabeçalhos
END FUNCTION
```

Observação: 1.15 torna toda requisição HTTP parte de C apenas no que diz respeito aos cabeçalhos de segurança. Para todo o resto da resposta (status, corpo, cabeçalhos funcionais), a requisição está fora de C e precisa ser preservada (Property 8).

### Exemplos

- **1.1** Deploy no Render (plano `free`, sem disco): usuário `ana` se cadastra, há um push, o serviço reinicia e `POST /api/auth/login` de `ana` retorna 401 "Usuário ou senha incorretos." porque `server/deckbuilder.db` sumiu. Esperado: login continua funcionando.
- **1.2** Publicar um torneio com 32 inscrições gera dezenas de `run()`; cada um faz `db.export()` + `writeFileSync` do arquivo inteiro, bloqueando o event loop dezenas de vezes. Esperado: uma única gravação por janela de debounce.
- **1.3** Processo morto (SIGKILL/OOM) no meio do `writeFileSync(DB_PATH, ...)`: o arquivo fica truncado e `new SQL.Database(buffer)` falha no próximo boot. Esperado: o arquivo é a versão anterior ou a nova, nunca parcial.
- **1.5** Admin apaga um usuário por engano: não há snapshot nem forma de baixar o banco. Esperado: snapshots diários com rotação e `GET /api/admin/backup`.
- **1.6/1.8** Admin cria a carta `ACA-0099` em produção: `src/data/modelo_cartas.json` é alterado no disco efêmero, o deck builder continua sem a carta (JSON embutido no build) e ela some no próximo deploy. Esperado: gravada em `DATA_DIR`, visível via `GET /api/cards` sem novo build.
- **1.7** Usuário envia avatar: `POST /api/profile/avatar` retorna `/assets/avatars/12.jpg`, mas `GET /assets/avatars/12.jpg` retorna 404 em produção (só `dist/` é servido). Esperado: 200 `image/jpeg`.
- **1.10** Dez logins errados de um cliente atrás do proxy do Render bloqueiam todos os outros usuários por 15 minutos (`req.ip` é o IP do proxy). Esperado: só o cliente que errou é limitado.
- **1.12** Usuário redefine a senha porque desconfia de invasão; o token roubado continua aceito em `GET /api/auth/me/export` por até 7 dias. Esperado: 401 com mensagem em pt-BR.
- **1.13** Após `DELETE /api/auth/me`, o token antigo ainda retorna 200 em `GET /api/auth/me/export` (com dados anonimizados). Esperado: 401.
- **1.14** Produção sem `ALLOWED_ORIGINS`: requisição com `Origin: https://site-malicioso.example` recebe `Access-Control-Allow-Origin: https://site-malicioso.example` e `Access-Control-Allow-Credentials: true`. Esperado: sem cabeçalho de CORS para essa origem.
- **1.15 (borda)** `GET /api/health` não tem `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` nem `Content-Security-Policy`. Esperado: todos presentes; HSTS só em produção.
- **Caso de borda (preservação)** Token emitido antes da mudança, sem claim `tv`, para usuário que nunca trocou a senha: deve continuar aceito (`tv` ausente = 0 = `token_version` padrão).

## Comportamento Esperado (Expected Behavior)

### Requisitos de Preservação (Preservation Requirements)

**Comportamentos Inalterados:**
- A suíte existente (`node --test`, 19 arquivos, 273 testes) continua passando sem alterar asserções (3.1).
- Sem `DATA_DIR`, o servidor usa `server/` como diretório de dados; o banco continua em `server/deckbuilder.db` e os segredos em `server/.jwt-secret` / `server/.admin-credentials.json` (3.2).
- Testes e2e com `DATA_DIR` temporário e `NODE_ENV=test` continuam isolados nessa pasta — agora também para cartas, imagens e avatares, que hoje vazam para `src/` e `public/` (3.3).
- Banco existente abre com todos os dados; a coluna `token_version` entra por migração com padrão 0 (3.4).
- Tokens antigos sem `tv` de usuários sem evento de segurança continuam válidos até expirar (3.5).
- Login e autorização do admin (`sub: 0`, sem linha em `users`) continuam iguais (3.6).
- Cadastro, login, decks, torneios, fórum, lojas, artigos, ranking, perfil e LGPD respondem como antes (3.7).
- `GET/POST/PUT/DELETE /api/admin/cards` e `POST /api/admin/cards/:id/image` aceitam os mesmos formatos e retornam as mesmas mensagens (3.8).
- Imagens do repositório/build continuam nas mesmas URLs `/assets/cards/<id>.jpg` e `/assets/avatars/...` (3.9).
- Limites e mensagens de rate limit inalterados; `NODE_ENV=test` continua desativando-os (3.10).
- `ALLOWED_ORIGINS` definido continua permitindo exatamente a lista; fora de produção o CORS continua permissivo (3.11).
- Scripts, estilos, fontes do Google, imagens, chamadas à API e pop-ups de impressão (proxies do deck e coleção do admin) continuam funcionando com a CSP (3.12).
- `/api/*`, `/api/health`, `/admin`, `/` e o fallback da SPA respondem como antes (3.13).
- Fluxo de recuperação de senha (e-mail + token de reset) inalterado (3.14).
- Todas as mensagens novas em pt-BR (3.15).
- Só sql.js, sem dependências nativas nem novas (3.16).
- **Estado efetivo de `PRAGMA foreign_keys` inalterado** (ver achado em "Causa Raiz Hipotética", item 3).

**Escopo:**
Todos os eventos que NÃO satisfazem `isBugCondition` devem ficar inalterados. Isso inclui:
- Leituras no banco (`get`/`all`) e o resultado lógico de qualquer escrita (`changes`, `lastInsertRowid`, dados visíveis na leitura seguinte).
- Requisições a rotas `/api/*` com tokens válidos e não revogados, ou sem token — status e corpo idênticos.
- Requisições sem `X-Forwarded-For` (dev local, testes).
- Requisições sem `Origin`, ou com `Origin` listada em `ALLOWED_ORIGINS`, ou em desenvolvimento.
- Requisições a arquivos de build (`/assets/index-*.js`, `/assets/*.css`) e imagens já existentes no repositório.

## Causa Raiz Hipotética (Hypothesized Root Cause)

Hipóteses confirmadas por leitura do código, salvo indicação:

1. **Infraestrutura sem disco persistente (1.1)**: `render.yaml` usa `plan: free`, sem `disk` e sem `DATA_DIR`. `server/db.js` já suporta `DATA_DIR`, mas cai em `server/` (efêmero).

2. **`_save()` chamado em todo `exec`/`run` (1.2, 1.3, 1.4)**: `DbWrapper._save()` faz `this._db.export()` + `writeFileSync(DB_PATH, ...)` direto no destino, de forma síncrona, sem arquivo temporário nem `rename`. Não há handlers de SIGTERM/SIGINT/`exit` em `server/index.js`. Como hoje toda escrita é persistida na hora, a falta de flush no encerramento só vira perda real quando a gravação passar a ser adiada — por isso o flush de encerramento é parte obrigatória da correção.

3. **Achado colateral: `export()` do sql.js reinicia os PRAGMAs**: verificado com sql.js 1.14.1 instalado — após `PRAGMA foreign_keys = ON`, `db.export()` fecha e reabre o banco e `PRAGMA foreign_keys` volta a `0`. Como `initDb()` chama `pragma("foreign_keys = ON")` e logo depois `exec(CREATE TABLE ...)` (que chama `_save()`), **hoje as foreign keys ficam efetivamente desligadas em runtime**. Com debounce, elas ficariam ligadas até o primeiro flush e desligadas depois — comportamento não determinístico, que poderia quebrar inserções que dependem disso (ex.: `articles.author_user_id` com o admin `id 0`, que não existe em `users`). Decisão: preservar o estado efetivo atual de forma determinística (flush síncrono ao fim de `initDb()`, documentado em comentário e coberto por teste de preservação). Ligar FKs de verdade fica fora deste bugfix.

4. **Ausência de backup (1.5)**: não existe nenhum código de snapshot nem rota de download; `DEPLOY.md` só descreve cópia manual.

5. **Caminhos de conteúdo fixos na árvore de código (1.6, 1.7, 1.9)**: `server/routes/cards.js` (`CARDS_JSON_PATH = src/data/modelo_cartas.json`, `CARDS_IMG_DIR = public/assets/cards`), `server/routes/decks.js` e `server/routes/profile.js` (leem `src/data/modelo_cartas.json`; `AVATAR_DIR = public/assets/avatars`) e também `server/routes/admin.js` (analytics de meta lê `src/data/modelo_cartas.json`). `writeCardsData` usa `writeFileSync` direto (não atômico).

6. **Assets enviados não são servidos (1.7)**: `server/index.js` só faz `express.static(DIST_DIR)`; o fallback da SPA pula `/assets/` e cai em 404. Arquivos gravados em `public/` após o build não estão em `dist/`. Em dev, o Vite serve `public/`, mas não serviria `DATA_DIR`.

7. **Cartas embutidas no bundle (1.8)**: `src/App.jsx` e `src/components/DecklistsTab.jsx` fazem `import CARD_DATA from "../data/modelo_cartas.json"`; não há endpoint público de cartas. `App.jsx` também restaura o build salvo (`normalizeBuild(parsed, cardIndex)`) com o índice embutido, então cartas novas seriam descartadas se a troca de dados acontecesse depois da restauração.

8. **Sem `trust proxy` (1.10)**: `server/index.js` nunca chama `app.set("trust proxy", ...)`. Atrás do proxy do Render, `req.ip` é o IP do proxy e o `express-rate-limit` v8 (chave padrão = `req.ip`) agrupa todos os clientes (e registra `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`).

9. **JWT sem estado revogável (1.11–1.13, 2.17)**: `requireAuth`/`optionalAuth` só fazem `jwt.verify`. O payload (`sub`, `username`) não tem versão; `reset-password` e `DELETE /me` não invalidam nada. **Não existe rota de troca de senha** (`/api/auth/change-password`): a correção de 1.11/2.14 inclui criá-la.

10. **CORS com `origin: true` (1.14)**: sem `ALLOWED_ORIGINS`, `cors({ origin: true, credentials: true })` reflete qualquer origem, inclusive em produção.

11. **Sem cabeçalhos de segurança (1.15)**: nenhum middleware define cabeçalhos; o `<meta http-equiv="X-Content-Type-Options">` em `index.html`/`admin.html` não tem efeito (esse cabeçalho só vale como HTTP).

12. **Restrições da CSP descobertas no frontend**:
    - `index.html` e `admin.html` carregam Google Fonts (`fonts.googleapis.com` → CSS, `fonts.gstatic.com` → fontes) e têm `style="..."` no `<body>` (atributo de estilo parseado do HTML exige `'unsafe-inline'` em `style-src`).
    - O build do Vite (entradas `main` e `admin`) só gera `<script type="module" src>` — sem scripts inline. Estilos via prop `style` do React usam CSSOM e não são afetados.
    - Os pop-ups de impressão (`App.jsx` ~linha 612 e `AdminPanel.jsx` ~linha 247) usam `window.open("", "_blank")` + `document.write`. Um documento `about:blank` **herda a CSP de quem o abriu**. Eles escrevem `<style>` inline, atributos `style="background:..."` (swatches) e um **`<script>` inline** que espera as imagens e chama `window.print()`. Com `script-src 'self'`, esse script seria bloqueado e a impressão automática pararia de funcionar.

## Correctness Properties

Property 1: Bug Condition - Banco persistente, coalescido e com flush no encerramento

_For any_ sequência de comandos de escrita (`exec`/`run`) executada no `DbWrapper` corrigido, seguida opcionalmente de SIGTERM/SIGINT (ou `flush()` explícito, ou saída do processo), o sistema SHALL refletir cada escrita imediatamente nas leituras seguintes em memória, SHALL gravar o arquivo do banco no máximo uma vez por janela de debounce (nunca uma vez por comando), e SHALL deixar em `DATA_DIR/deckbuilder.db` um banco que, ao ser reaberto, contém exatamente todas as escritas feitas antes do flush/encerramento; e o blueprint de deploy SHALL declarar plano pago com disco montado em `/data` e `DATA_DIR=/data`.

**Validates: Requirements 2.1, 2.2, 2.4**

Property 2: Bug Condition - Gravação atômica de arquivos de dados

_For any_ arquivo de dados gravado pelo sistema corrigido (banco, JSON de cartas, imagem de carta, avatar, snapshot de backup) e _for any_ falha injetada em qualquer etapa da gravação (escrita, fsync, rename), o arquivo de destino SHALL conter byte a byte ou a versão anterior completa ou a nova versão completa, e nenhum arquivo temporário SHALL permanecer após a falha (nem após o próximo boot, para o banco).

**Validates: Requirements 2.3, 2.8**

Property 3: Bug Condition - Snapshots com rotação e download restrito ao admin

_For any_ número N de snapshots gerados e _for any_ limite de retenção K ≥ 1, o diretório `DATA_DIR/backups` SHALL conter exatamente os min(N, K) snapshots mais recentes, cada um sendo um banco SQLite válido que reabre com os dados do momento do snapshot; e _for any_ requisição a `GET /api/admin/backup`, o sistema SHALL responder 200 com uma cópia consistente do banco (incluindo escritas ainda não gravadas em disco) somente para token de admin válido, e 401/403 com mensagem em pt-BR para qualquer outro caso.

**Validates: Requirements 2.5, 2.6**

Property 4: Bug Condition - Conteúdo do admin em DATA_DIR, seed sem sobrescrita e servido em runtime

_For any_ estado inicial de `DATA_DIR` (vazio, parcial ou completo), o seed SHALL criar apenas o que falta (JSON de cartas, diretório de imagens de cartas, diretório de avatares) a partir do repositório e SHALL deixar inalterado byte a byte todo arquivo já existente; _for any_ criação/edição/remoção de carta, upload de imagem de carta ou upload de avatar, o sistema SHALL gravar somente em `DATA_DIR` (nunca em `src/` ou `public/`); _for any_ arquivo `X` em `/assets/cards/X` ou `/assets/avatars/X`, o sistema SHALL servir a versão de `DATA_DIR` se existir e, senão, a do repositório/build; e as rotas de decks, perfil e analytics SHALL ler os mesmos dados de cartas que a administração.

**Validates: Requirements 2.7, 2.8, 2.9, 2.10, 2.12**

Property 5: Bug Condition - Cartas carregadas em tempo de execução no frontend

_For any_ resposta de `GET /api/cards` que seja um conjunto de dados de cartas válido, o frontend corrigido SHALL usar esses dados (incluindo cartas criadas/editadas pelo admin depois do build) no deck builder e na aba de decklists, e SHALL restaurar o build salvo somente depois de os dados estarem definidos; _for any_ falha da API (erro de rede, status ≠ 200, JSON inválido, formato inválido ou timeout), o frontend SHALL usar os dados embutidos no build.

**Validates: Requirements 2.11**

Property 6: Bug Condition - Revogação de tokens por versão

_For any_ usuário e _for any_ token emitido para ele antes de uma troca de senha, redefinição de senha ou exclusão de conta, o sistema corrigido SHALL responder 401 com mensagem em pt-BR em toda rota com `requireAuth` e SHALL tratar a requisição como anônima em toda rota com `optionalAuth`; a troca de senha SHALL devolver um token novo que é aceito; e _for any_ token cuja claim `tv` (ausente = 0) difira de `users.token_version` atual, ou cujo usuário não exista mais, o mesmo tratamento SHALL ser aplicado.

**Validates: Requirements 2.14, 2.15, 2.16, 2.17**

Property 7: Bug Condition - Borda HTTP: IP real, CORS restrito e cabeçalhos de segurança

_For any_ par de clientes com IPs reais distintos atrás de um proxy confiável (`X-Forwarded-For` diferentes, mesmo IP de proxy), o rate limit corrigido SHALL contabilizar cada cliente separadamente; _for any_ origem `O` em produção sem `ALLOWED_ORIGINS`, o sistema SHALL emitir `Access-Control-Allow-Origin: O` somente se `O` for a origem de `SITE_URL` ou `RENDER_EXTERNAL_URL`; e _for any_ resposta (API, estático, SPA, 404), o sistema SHALL incluir `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Content-Security-Policy` com `frame-ancestors 'none'`, e `Strict-Transport-Security` somente quando `NODE_ENV=production`.

**Validates: Requirements 2.13, 2.18, 2.19**

Property 8: Preservation - Dados, API e conteúdo do admin

_For any_ evento fora da condição do bug (leituras, resultados lógicos de escritas, requisições a `/api/*` com token válido não revogado ou sem token, operações de admin sobre cartas, fluxo de recuperação de senha), o sistema corrigido SHALL produzir o mesmo status, corpo e efeito nos dados que o original, incluindo abrir bancos existentes sem perda (com `token_version = 0` adicionado por migração), manter o estado efetivo de `PRAGMA foreign_keys` e continuar usando apenas sql.js.

**Validates: Requirements 3.1, 3.4, 3.7, 3.8, 3.13, 3.14, 3.16**

Property 9: Preservation - Sessões existentes e admin

_For any_ token válido emitido antes da mudança (com ou sem claim `tv`) para um usuário cujo `token_version` ainda é 0, e _for any_ token de admin (`sub: 0`, `role: "admin"`), o sistema corrigido SHALL aceitar o token nas mesmas rotas e com o mesmo `req.user` que o original, até a expiração normal; e toda mensagem nova SHALL estar em pt-BR.

**Validates: Requirements 3.5, 3.6, 3.15**

Property 10: Preservation - Ambientes (dev/teste) e URLs de assets

_For any_ inicialização sem `DATA_DIR`, o sistema corrigido SHALL usar `server/` como diretório de dados (mesmos caminhos do banco e dos segredos); _for any_ inicialização com `DATA_DIR` temporário e `NODE_ENV=test`, todo arquivo criado ou alterado pelo servidor SHALL estar dentro desse diretório (sem alterar `src/`, `public/` ou `server/`), sem timers de backup ativos; e _for any_ imagem existente no repositório, a URL `/assets/...` SHALL continuar servindo o mesmo conteúdo, tanto no servidor quanto no Vite em desenvolvimento.

**Validates: Requirements 3.2, 3.3, 3.9**

Property 11: Preservation - Rate limit, CORS fora do caso do bug e compatibilidade da CSP

_For any_ sequência de requisições de um mesmo cliente, os limites, janelas e mensagens de rate limit SHALL ser iguais aos originais; _for any_ configuração com `ALLOWED_ORIGINS` definido ou fora de produção, a decisão de CORS SHALL ser igual à original; e _for any_ página do build (`index.html`, `admin.html`) e pop-up de impressão, a CSP SHALL permitir todos os scripts, estilos, fontes, imagens e chamadas à API que o app usa, com a impressão automática funcionando.

**Validates: Requirements 3.10, 3.11, 3.12**

## Implementação da Correção (Fix Implementation)

### Mudanças Necessárias

Assumindo que a análise de causa raiz está correta. Nenhuma dependência nova é adicionada.

**Arquivo**: `server/lib/paths.js` (novo)

**Função**: `resolvePaths(env = process.env)` + constantes exportadas

**Mudanças Específicas**:
1. **Fonte única de caminhos**: função pura `resolvePaths(env)` (testável) e constantes resolvidas no import:
   - `SERVER_DIR`, `PROJECT_ROOT`, `DATA_DIR = resolve(env.DATA_DIR || SERVER_DIR)`
   - `DB_PATH = DATA_DIR/deckbuilder.db`, `JWT_SECRET_PATH = DATA_DIR/.jwt-secret`, `ADMIN_CREDENTIALS_PATH = DATA_DIR/.admin-credentials.json` (mesmos nomes de hoje)
   - `CARDS_JSON_PATH = DATA_DIR/cards/modelo_cartas.json`, `CARDS_IMG_DIR = DATA_DIR/assets/cards`, `AVATARS_DIR = DATA_DIR/assets/avatars`, `BACKUPS_DIR = DATA_DIR/backups`
   - Origens do seed/fallback: `SEED_CARDS_JSON_PATH = src/data/modelo_cartas.json`, `PUBLIC_CARDS_IMG_DIR = public/assets/cards`, `PUBLIC_AVATARS_DIR = public/assets/avatars`, `DIST_DIR = dist`
2. **`ensureDataDir()`**: `mkdirSync(DATA_DIR, { recursive: true })`, chamado por `secrets.js` antes de gravar segredos (o `getJwtSecret()` roda no import de `middleware/auth.js`, antes do corpo de `index.js`).
3. `server/db.js` e `server/secrets.js` passam a importar os caminhos daqui (removendo os `DATA_DIR` locais duplicados).

**Arquivo**: `server/lib/atomicWrite.js` (novo)

**Função**: `writeFileAtomicSync(targetPath, data, { fsImpl } = {})`, `cleanupStaleTemps(dir, baseName)`

**Mudanças Específicas**:
1. Grava em `<dir>/.<base>.<pid>.<timestamp>.<aleatório>.tmp` (mesmo diretório → mesmo sistema de arquivos), `openSync` / `writeSync` / `fsyncSync` / `closeSync`, depois `renameSync(tmp, target)`.
2. No Windows, `rename` sobre arquivo existente pode falhar com `EPERM`/`EBUSY`/`EACCES` (antivírus/indexador): até 5 tentativas com espera curta.
3. Em qualquer falha: tenta `unlinkSync(tmp)` e relança o erro (o destino fica intacto).
4. `fsImpl` opcional (padrão `node:fs`) permite injeção de falhas nos testes.
5. `cleanupStaleTemps` remove `.<base>.*.tmp` deixados por um crash anterior.

**Arquivo**: `server/db.js`

**Função**: `DbWrapper`, `StatementWrapper.run`, `initDb`

**Mudanças Específicas**:
1. **Debounce**: `exec()` e `run()` chamam `_markDirty()` no lugar de `_save()`. `_markDirty()` marca `dirty = true` e, se não houver timer, agenda `flush()` em `saveDelayMs` (padrão 250 ms, env `DB_SAVE_DELAY_MS`). O timer tem `unref()`. Escritas seguintes na mesma janela só marcam `dirty` (latência máxima limitada a uma janela).
2. **`flush()`** (síncrono, idempotente): se `!dirty`, retorna `false`; senão limpa o timer, `data = this._db.export()`, `writeFileAtomicSync(dbPath, data)`, `dirty = false`, retorna `true`. Em erro: registra `[db] Falha ao gravar o banco em disco` (sem dados sensíveis), mantém `dirty = true`, reagenda com espera maior (5 s) e relança só quando chamado de forma explícita (encerramento/backup), para o chamador decidir.
3. **`serialize()`**: `flush()` e retorna `this._db.export()` (cópia consistente para backup/download). Como tudo é síncrono e single-thread, nenhuma escrita intercala.
4. **`close()`**: limpa o timer e chama `flush()`. Usado no encerramento e nos testes.
5. **Gravação síncrona em vez de assíncrona, de propósito**: o custo de bloquear o event loop passa de "uma vez por comando" para "no máximo uma vez por janela", e evita corridas entre gravações assíncronas concorrentes e o flush de encerramento. Com o banco na casa de poucos MB, é o equilíbrio mais simples.
6. **`initDb({ dbPath = DB_PATH, saveDelayMs } = {})`**: parâmetros opcionais para testes unitários; sem argumentos, comportamento padrão. No início chama `cleanupStaleTemps(dirname(dbPath), "deckbuilder.db")`.
7. **Migração `token_version`**: seguindo o padrão `PRAGMA table_info(users)` + `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0` dentro de `try/catch`.
8. **Preservar o estado efetivo de PRAGMAs** (achado do item 3 da causa raiz): `initDb()` termina com um `flush()` forçado (marca `dirty` e grava). Isso garante que o arquivo exista após o boot (como hoje) e que o estado de `foreign_keys` em runtime seja exatamente o atual (resetado pelo `export()`), de forma determinística. Comentário explica o motivo e aponta que ligar FKs é trabalho futuro.
9. A API pública (`exec`, `prepare().run/get/all`, `pragma`) e o retorno `{ changes, lastInsertRowid }` não mudam.

**Arquivo**: `server/lib/seedData.js` (novo)

**Função**: `seedDataDir(paths = defaultPaths)`

**Mudanças Específicas**:
1. Cria `DATA_DIR`, `DATA_DIR/cards`, `DATA_DIR/assets`.
2. JSON de cartas: se `CARDS_JSON_PATH` não existe, `copyFileSync(SEED_CARDS_JSON_PATH, CARDS_JSON_PATH, COPYFILE_EXCL)` (ignora `EEXIST`) — nunca sobrescreve.
3. Imagens de cartas: se `CARDS_IMG_DIR` não existe, `cpSync(PUBLIC_CARDS_IMG_DIR, CARDS_IMG_DIR, { recursive: true, force: false, errorOnExist: false })` (~15,6 MB hoje; só na primeira vez).
4. Avatares: cria `AVATARS_DIR`; se acabou de ser criado e `PUBLIC_AVATARS_DIR` existe, copia com `force: false`.
5. Retorna um resumo (`{ criados: [...] }`) e registra no log o que foi semeado.
6. Depois do seed, os dados em `DATA_DIR` são a fonte de verdade: cartas novas adicionadas ao JSON do repositório em deploys futuros **não** são mescladas automaticamente (documentado no DEPLOY.md/README). Imagens novas do repositório continuam acessíveis pelo fallback de `public/`/`dist/`.

**Arquivo**: `server/lib/cardStore.js` (novo)

**Função**: `readCardData()`, `writeCardData(data)`

**Mudanças Específicas**:
1. `readCardData()`: lê `CARDS_JSON_PATH`; se não existir (seed falhou), lê `SEED_CARDS_JSON_PATH` como fallback somente leitura.
2. `writeCardData(data)`: `writeFileAtomicSync(CARDS_JSON_PATH, JSON.stringify(data, null, 2))` — mesmo formato de hoje.
3. Leitura por chamada, como hoje (arquivo ~47 KB; sem cache para não introduzir invalidação).

**Arquivo**: `server/routes/cards.js`

**Mudanças Específicas**:
1. Remove `CARDS_JSON_PATH`/`CARDS_IMG_DIR` locais; usa `cardStore` e `paths.CARDS_IMG_DIR`.
2. Upload de imagem grava com `writeFileAtomicSync(join(CARDS_IMG_DIR, id + ".jpg"), processed)`; remoção de `.png/.webp` antigos mantida.
3. Exporta também `publicCardsRouter` com `GET /` → `res.set("Cache-Control", "no-cache")` + `res.json(readCardData())` (mesmo formato do JSON do repositório). Montado em `/api/cards`, sem autenticação (dados já públicos no bundle).
4. Validações, mensagens e formatos das rotas admin inalterados.

**Arquivos**: `server/routes/decks.js`, `server/routes/profile.js`, `server/routes/admin.js`

**Mudanças Específicas**:
1. `decks.js` `loadCardData()` e `profile.js` (heurísticas) e `admin.js` (analytics de meta) passam a usar `readCardData()`.
2. `profile.js`: `AVATAR_DIR` → `paths.AVATARS_DIR`; gravação com `writeFileAtomicSync`; URL retornada continua `/assets/avatars/<id>.jpg`.
3. `admin.js`: nova rota `GET /api/admin/backup` com o `requireAdmin` local:
   - `const data = req.db.serialize()`;
   - cabeçalhos `Content-Type: application/vnd.sqlite3`, `Content-Disposition: attachment; filename="deckbuilder-<AAAAMMDDTHHMMSSZ>.db"`, `Cache-Control: no-store`;
   - `res.end(Buffer.from(data))`; erro → 500 `{ error: "Erro ao gerar backup do banco." }`.
   - Log `[admin] Backup do banco baixado` (sem dados).

**Arquivo**: `server/lib/backup.js` (novo)

**Função**: `createSnapshot(db, { backupsDir, keep, now })`, `rotateSnapshots(backupsDir, keep)`, `resolveBackupConfig(env)`, `startBackupSchedule(db, config)`

**Mudanças Específicas**:
1. `createSnapshot`: `data = db.serialize()`; `writeFileAtomicSync(backupsDir/deckbuilder-<AAAAMMDDTHHMMSSZ>.db, data)`; depois `rotateSnapshots`.
2. `rotateSnapshots`: lista só arquivos que casam `^deckbuilder-\d{8}T\d{6}Z\.db$`, ordena pelo nome (UTC ordena lexicograficamente) e apaga os mais antigos além de `keep`. Não toca em outros arquivos.
3. `resolveBackupConfig(env)`: `BACKUP_ENABLED` (padrão ligado, **desligado quando `NODE_ENV=test`**, a não ser que `BACKUP_ENABLED=1|true`), `BACKUP_INTERVAL_HOURS` (padrão 24; `0` desliga), `BACKUP_KEEP` (padrão 7, mínimo 1). Valores inválidos → padrão + aviso.
4. `startBackupSchedule`: como deploys reiniciam o processo com frequência, um `setInterval` de 24 h poderia nunca disparar. Por isso, no boot, calcula a idade do snapshot mais recente e agenda o próximo para `max(0, intervalo − idade)`; depois repete a cada intervalo. Todos os timers com `unref()`. Erros são registrados e não derrubam o servidor. Retorna `stop()`.
5. Backups ficam no mesmo disco: protegem contra corrupção/exclusão acidental, não contra perda do disco. O download admin cobre a cópia externa (documentado).

**Arquivo**: `server/middleware/auth.js`

**Função**: `signUserToken`, `requireAuth`, `optionalAuth`, novo `resolveSessionUser`

**Mudanças Específicas**:
1. `signUserToken({ id, username, token_version })` → `jwt.sign({ sub: id, username, tv: token_version ?? 0 }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })`. `JWT_EXPIRES_IN` continua `"7d"`.
2. `resolveSessionUser(payload, db)`:
   - `payload.role === "admin"` → aceito sem consulta (admin `sub: 0` não tem linha em `users`).
   - Senão `row = db.prepare("SELECT token_version FROM users WHERE id = ?").get(payload.sub)`; sem linha → inválido; `(payload.tv ?? 0) !== (row.token_version ?? 0)` → inválido.
   - Custo: uma consulta por chave primária em banco em memória por requisição autenticada (microssegundos; `requireJudgeOrAdmin` já faz o mesmo).
3. `requireAuth`: JWT inválido/expirado → 401 `"Token inválido ou expirado."` (mensagem atual). Sessão revogada → 401 `{ error: "Sua sessão expirou. Faça login novamente.", code: "SESSION_REVOKED" }`.
4. `optionalAuth`: em qualquer falha (JWT ou versão), segue sem `req.user` (anônimo).
5. `req.user` mantém exatamente o formato atual `{ id, username, role }`.
6. Os `requireAdmin` locais de `admin.js`/`cards.js` não mudam (só aceitam `role: "admin"`, fora da revogação).

**Arquivo**: `server/routes/auth.js`

**Mudanças Específicas**:
1. `register` e `login` usam `signUserToken` (registro: `token_version` 0; login: valor da linha).
2. **Nova rota** `POST /api/auth/change-password` (`passwordChangeLimiter`, `requireAuth`): corpo `{ currentPassword, newPassword }`; valida o tamanho como no reset; confere a senha atual (401 `"Senha atual incorreta."`); `UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?`; lê a linha atualizada e responde `{ message: "Senha alterada com sucesso.", token }` com token novo; envia `passwordChangedEmail` sem `await` (como no reset).
3. `reset-password`: o `UPDATE` passa a incluir `token_version = token_version + 1`.
4. `DELETE /me`: o `UPDATE` de anonimização passa a incluir `token_version = token_version + 1`.
5. Demais respostas e mensagens inalteradas.

**Arquivo**: `server/middleware/rateLimit.js`

**Mudanças Específicas**:
1. Só adiciona `passwordChangeLimiter` (5 a cada 15 min, `"Muitas tentativas. Tente novamente em alguns minutos."`). Limitadores existentes intactos.

**Arquivo**: `server/middleware/security.js` (novo)

**Função**: `resolveTrustProxy(env)`, `resolveCorsOptions(env)`, `securityHeaders({ isProduction })`

**Mudanças Específicas**:
1. `resolveTrustProxy(env)`: `TRUST_PROXY` vazio/ausente → `1` em produção, `false` fora; `^\d+$` → número de saltos; `"true"`/`"false"` → booleano (com aviso: `true` é permissivo e o `express-rate-limit` reclama); outro texto → repassado ao Express (ex.: `"loopback, 10.0.0.0/8"`).
2. `resolveCorsOptions(env)`:
   - `ALLOWED_ORIGINS` definido → `{ origin: lista, credentials: true }` (exatamente como hoje).
   - Produção sem `ALLOWED_ORIGINS` → lista `[SITE_URL, RENDER_EXTERNAL_URL]` normalizada com `new URL(x).origin` (ignorando inválidos); `origin` vira função: sem cabeçalho `Origin` → permite (mesma origem ou cliente não-navegador); na lista → permite; fora → `callback(null, false)` (sem cabeçalhos CORS, sem erro 500). Requisições de mesma origem não dependem de CORS, então continuam funcionando mesmo quando o navegador envia `Origin`.
   - Fora de produção → `{ origin: true, credentials: true }` (permissivo como hoje).
3. `securityHeaders({ isProduction })` (middleware escrito à mão, sem helmet):
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
   - `Strict-Transport-Security: max-age=15552000` somente se `isProduction` (sem `includeSubDomains`, para não afetar outros subdomínios de um domínio próprio).
   - Justificativa de `'unsafe-inline'` só em `style-src`: necessário para o `style` do `<body>` nos HTML e para o `<style>`/`style="..."` dos pop-ups `about:blank` (que herdam a CSP). Injeção de CSS é risco baixo aqui (React escapa conteúdo; `escapeHtml` nos pop-ups). `script-src` continua estrito.

**Arquivo**: `server/index.js`

**Mudanças Específicas** (ordem dos middlewares):
1. `import "./env.js"` continua primeiro.
2. `app.disable("x-powered-by")`; `app.set("trust proxy", resolveTrustProxy(process.env))`.
3. `app.use(securityHeaders({ isProduction }))` antes de tudo (inclui estáticos e 404).
4. `app.use(cors(resolveCorsOptions(process.env)))`; `express.json` como hoje.
5. `seedDataDir()` → `const db = await initDb()` → injeção de `req.db` → rotas existentes + `app.use("/api/cards", publicCardsRouter)` → `/api/health`.
6. Estáticos de conteúdo **antes** do `dist/`, sempre (com ou sem `dist/`):
   - `app.use("/assets/cards", express.static(CARDS_IMG_DIR, { index: false }), express.static(PUBLIC_CARDS_IMG_DIR, { index: false }))`
   - `app.use("/assets/avatars", express.static(AVATARS_DIR, { index: false }), express.static(PUBLIC_AVATARS_DIR, { index: false }))`
   - Nunca monta a raiz de `DATA_DIR` (o banco, segredos e backups não ficam expostos). `express.static` já bloqueia `..` e dotfiles. Cache padrão (ETag/Last-Modified) para que uma imagem substituída com o mesmo nome apareça.
7. Bloco do `dist/` e fallback da SPA inalterados.
8. `const server = app.listen(...)` mantendo o log `Rodando em` (os testes dependem dele); depois `startBackupSchedule(db, resolveBackupConfig(process.env))`.
9. **Encerramento gracioso** `shutdown(motivo)` (executa uma vez): para o agendador de backup, `db.close()` (flush), `server.close()`, `process.exit(0)` (ou 1 se o flush falhar), com timeout de segurança de 5 s (`unref`). Registrado em `SIGTERM`, `SIGINT` e, se `process.send` existir (processo filho com canal IPC), na mensagem `"shutdown"` — para os testes e2e no Windows, onde não dá para enviar sinais a processos filhos. `process.on("exit", () => db.flush())` como rede de segurança.

**Arquivo**: `vite.config.js`

**Mudanças Específicas**:
1. Plugin local `dataDirAssets()` com `configureServer(server)` que registra um middleware **antes** dos internos do Vite: para `GET /assets/(cards|avatars)/<nome>` com `<nome>` casando `^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$`, se o arquivo existir no diretório correspondente de `DATA_DIR`, faz stream com o `Content-Type` certo; senão `next()` e o Vite serve `public/` como hoje.
2. `DATA_DIR` vem de `loadEnv(mode, process.cwd(), "")` + `resolvePaths()` de `server/lib/paths.js` (mesma regra do servidor). Sem dependências novas; não exige o backend rodando para ver as imagens do repositório.
3. Proxy `/api` inalterado (já cobre `/api/cards` e `/api/admin/backup`).

**Arquivos**: frontend (`src/`)

**Mudanças Específicas**:
1. `src/lib/cardDataSource.js` (novo, puro, testável em Node): `isValidCardData(d)` (exige `cards` array, `colors` array, `types` objeto) e `fetchCardData({ fallback, fetchImpl = fetch, timeoutMs = 5000 })` → `{ data, source: "api" | "bundled" }` com `AbortController`; qualquer falha devolve `fallback`.
2. `src/hooks/useCardData.jsx` (novo): `CardDataProvider` (importa o JSON embutido como fallback e estado inicial; busca `/api/cards` uma vez) e `useCardData()` → `{ cardData, loaded }`.
3. `src/main.jsx`: envolve `<App />` com `CardDataProvider`.
4. `src/App.jsx`: troca o `import CARD_DATA` por `const { cardData: CARD_DATA, loaded: cardsLoaded } = useCardData()`; os `useMemo` que hoje têm dependência `[]` passam a depender de `CARD_DATA`; o efeito de restauração do build só roda quando `cardsLoaded` é `true` (evita descartar cartas novas via `normalizeBuild`); a tela "Carregando arsenal…" cobre essa espera (com timeout de 5 s no pior caso).
5. `src/components/DecklistsTab.jsx`: o `cardIndex` de módulo vira `useMemo(() => createCardIndex(CARD_DATA.cards), [CARD_DATA])` dentro do componente, usando `useCardData()`.
6. `src/lib/printPopup.js` (novo): `printWhenImagesLoaded(popup, delayMs)` executado pela janela que abriu o pop-up — espera `load` (ou `readyState === "complete"`), aguarda `popup.document.images` e chama `popup.print()`. `App.jsx` e `AdminPanel.jsx` removem o `<script>` inline do HTML escrito e chamam essa função após `document.close()`. `<style>` e `style="..."` continuam (permitidos por `style-src 'unsafe-inline'`).
7. `src/lib/api.js`: `changePassword(currentPassword, newPassword)` que chama a rota nova e salva o token devolvido com `setToken`. (Tela de troca de senha fica fora deste bugfix; não existe hoje.)
8. `src/components/AdminPanel.jsx`: botão "Baixar backup do banco" que faz `fetch("/api/admin/backup")` com o token de admin e baixa via `Blob` + `<a download>`; erro exibido com `flash` em pt-BR.

**Arquivos**: deploy e documentação

**Mudanças Específicas**:
1. `render.yaml`: `plan: starter`; `disk: { name: forja-data, mountPath: /data, sizeGB: 1 }`; `envVars` com `DATA_DIR=/data` e `TRUST_PROXY=1`; comentários sobre disco efêmero atualizados. `JWT_SECRET`/`ADMIN_PASSWORD`/e-mail inalterados.
2. `DEPLOY.md`: o disco é pago (plano Starter + disco); serviço com disco fica **instância única e sem deploy zero-downtime** (o Render para a instância antiga antes de subir a nova — há alguns segundos de indisponibilidade a cada deploy); variáveis `BACKUP_*`, `DB_SAVE_DELAY_MS`, `TRUST_PROXY`; como baixar o backup pelo painel admin e guardar fora do Render; restauração (parar o serviço, substituir `DATA_DIR/deckbuilder.db`, subir); que os backups locais não protegem contra perda do disco; que após o primeiro boot o conteúdo de cartas é gerido pelo painel e o JSON do repositório é só seed/fallback. Remove o texto "isso reseta os dados também".
3. `README.md`: em dev, o banco de cartas editável passa a ser `server/cards/modelo_cartas.json` (semeado de `src/data/modelo_cartas.json`); para voltar ao seed, apague a cópia; para levar edições feitas no admin local para o repositório, copie o arquivo de volta para `src/data/`.
4. `.env.example`: documenta `DATA_DIR`, `TRUST_PROXY`, `BACKUP_ENABLED`, `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP`, `DB_SAVE_DELAY_MS`.
5. `.gitignore`: `server/cards/`, `server/assets/`, `server/backups/`, `server/.*.tmp`.

## Estratégia de Testes (Testing Strategy)

### Abordagem de Validação

Duas fases: primeiro, surgir contraexemplos que demonstram o bug no código **sem a correção** (confirmando ou refutando a causa raiz); depois, verificar que a correção funciona (fix checking) e preserva o comportamento existente (preservation checking).

Ferramentas: `node:test` + `node:assert/strict`, arquivos em `test/*.test.mjs`. Para testes de propriedade, sem dependência nova: um helper `test/helpers/prop.mjs` com gerador pseudoaleatório com semente (ex.: mulberry32) e `forAll(gerador, propriedade, { runs, seed })`, que imprime a semente e o contraexemplo na falha. Testes e2e iniciam `server/index.js` com `DATA_DIR` temporário (`server/.test-data-<nome>`, já no `.gitignore`), `NODE_ENV=test` e portas exclusivas, como os testes atuais.

### Verificação Exploratória da Condição do Bug (Exploratory Bug Condition Checking)

**Objetivo**: surgir contraexemplos que demonstram o bug ANTES da correção. Confirmar ou refutar a causa raiz; se refutada, refazer a hipótese.

**Plano de Teste**: escrever os testes abaixo e rodá-los no código SEM a correção para observar as falhas. Testes que alterariam arquivos versionados no código sem correção (ex.: criar carta grava em `src/data/modelo_cartas.json`, avatar grava em `public/assets/avatars`) devem guardar o hash/conteúdo antes e restaurar em `after()`.

**Casos de Teste**:
1. **Blueprint sem disco** (`test/deploy-config.test.mjs`): lê `render.yaml` como texto e exige `plan: starter`, `mountPath: /data`, `DATA_DIR` = `/data` e `TRUST_PROXY` (vai falhar no código sem correção).
2. **Gravação por comando** (`test/db-persistence.test.mjs`): `initDb` em pasta temporária, 50 `INSERT`s em sequência e, logo depois (sem flush), abrir o arquivo em disco com outro `SQL.Database`: no código corrigido o arquivo ainda não tem as 50 linhas e `typeof db.flush === "function"`; no código sem correção o arquivo já tem as 50 linhas e `flush` não existe (vai falhar).
3. **Encerramento** (`test/e2e-persistence.test.mjs`): servidor filho com IPC; envia `"shutdown"` (ou SIGINT fora do Windows) e espera saída com código 0 em até 5 s (vai falhar: o código sem correção ignora a mensagem e não sai).
4. **Backup** : `GET /api/admin/backup` com token de admin espera 200 e corpo começando com `SQLite format 3\0` (vai falhar: 404).
5. **Conteúdo do admin**: admin cria carta `TST-0001` → espera `DATA_DIR/cards/modelo_cartas.json` com a carta e `src/data/modelo_cartas.json` com hash inalterado; `GET /api/cards` contém a carta; upload de avatar → `GET <avatar_url>` 200 `image/jpeg` (vão falhar: grava em `src/`/`public/`, `/api/cards` 404, avatar 404 — no e2e o `dist/` pode nem existir, e mesmo existindo o arquivo não está nele).
6. **Rate limit atrás de proxy** (`test/security.test.mjs`): app Express mínimo com `loginLimiter` real e a configuração padrão do Express (sem `trust proxy`, como no `index.js` atual); 10 POSTs com `X-Forwarded-For: 203.0.113.1` e depois 1 POST com `X-Forwarded-For: 203.0.113.2` → o segundo cliente recebe 429 (contraexemplo que confirma a hipótese 8). Obs.: `node --test` não define `NODE_ENV=test`, então os limitadores ficam ativos nesse teste unitário.
7. **Revogação** (`test/e2e-session.test.mjs`): (a) `POST /api/auth/change-password` → espera 200 com `token` (vai falhar: 404); (b) após `reset-password`, o token antigo em `GET /api/auth/me/export` espera 401 (vai falhar: 200); (c) após `DELETE /api/auth/me`, o token antigo espera 401 (vai falhar: 200 com dados anonimizados).
8. **CORS em produção** (unitário): `resolveCorsOptions({ NODE_ENV: "production" })` aplicado a um app mínimo; `Origin: https://site-malicioso.example` não deve receber `Access-Control-Allow-Origin` (no código sem correção, reproduzir com `cors({ origin: true, credentials: true })` mostra a origem refletida).
9. **Cabeçalhos** (e2e): `GET /api/health` espera `x-content-type-options`, `x-frame-options`, `referrer-policy`, `content-security-policy` (vai falhar).
10. **Caso de borda — pop-up e CSP** (`test/csp-compat.test.mjs`): busca por `<script` dentro das strings passadas a `document.write` em `src/App.jsx` e `src/components/AdminPanel.jsx` (vai falhar: os dois têm script inline, que a CSP nova bloquearia).
11. **Caso de borda — PRAGMA**: confirmar no código sem correção que `PRAGMA foreign_keys` vale `0` depois de `initDb()` (já confirmado manualmente com sql.js 1.14.1); vira teste de preservação.

**Contraexemplos Esperados**:
- O arquivo do banco é regravado inteiro a cada `run()`; não há `flush()`, `close()` nem handler de encerramento.
- `src/data/modelo_cartas.json` muda após `POST /api/admin/cards`; `/assets/avatars/<id>.jpg` responde 404; `/api/cards` responde 404.
- Clientes distintos atrás do mesmo proxy compartilham o mesmo contador de rate limit.
- Tokens antigos continuam aceitos após reset de senha e exclusão de conta; a rota de troca de senha não existe.
- Origem arbitrária refletida com credenciais; nenhuma resposta tem cabeçalhos de segurança.
- Possíveis causas: `_save()` em todo `exec/run`; caminhos fixos em `src/`/`public/`; ausência de `trust proxy`; JWT sem versão; `origin: true`; ausência de middleware de cabeçalhos.

### Verificação da Correção (Fix Checking)

**Objetivo**: verificar que, para toda entrada onde a condição do bug vale, a função corrigida produz o comportamento esperado.

**Pseudocódigo:**
```
FOR ALL X WHERE isBugCondition(X) DO
  resultado := sistema_corrigido(X)
  ASSERT expectedBehavior(X, resultado)
END FOR

FUNCTION expectedBehavior(X, resultado)
  CASE X.tipo OF
    "deploy":                 RETURN blueprintTemDisco("/data") AND dadosSobrevivemReinicio()
    "escrita_db":             RETURN leituraImediataVeEscrita()
                                     AND gravacoesEmDisco(janela) <= 1
    "crash_durante_gravacao": RETURN arquivo IN {versaoAnteriorCompleta, versaoNovaCompleta}
                                     AND semTemporariosRestantes()
    "sinal":                  RETURN discoContemTodasAsEscritasPendentes() AND codigoSaida = 0
    "backup":                 RETURN snapshots = minimo(N, K) mais recentes
                                     AND (admin => 200 bancoValido) AND (NOT admin => 401|403)
    "crud_carta", "upload_imagem_carta", "upload_avatar":
                              RETURN gravadoEm(DATA_DIR) AND NOT alterou(src/, public/)
                                     AND gravacaoAtomica()
    "get_asset":              RETURN serveDe(DATA_DIR) OR (NOT existeEm(DATA_DIR) AND serveDoBuild())
    "carregar_frontend":      RETURN cartasUsadas = (apiValida ? dadosDaApi : dadosEmbutidos)
    "ler_cartas_rotas":       RETURN fonte = CARDS_JSON_PATH em DATA_DIR
    "requisicao_http":
      IF X.req.x_forwarded_for AND proxyConfiavel THEN ASSERT chaveRateLimit = ipRealDoCliente
      IF tokenRevogado(X) THEN ASSERT (requireAuth => 401 pt-BR) AND (optionalAuth => anonimo)
      IF producao AND NOT ALLOWED_ORIGINS AND X.req.origin NOT IN origensDoSite
         THEN ASSERT semCabecalhoAllowOrigin(resultado)
      RETURN temCabecalhosSeguranca(resultado) AND (HSTS <=> producao)
  END CASE
END FUNCTION
```

### Verificação de Preservação (Preservation Checking)

**Objetivo**: verificar que, para toda entrada onde a condição do bug NÃO vale, a função corrigida produz o mesmo resultado que a original.

**Pseudocódigo:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT sistema_original(X) = sistema_corrigido(X)
END FOR
```

**Abordagem de Teste**: testes baseados em propriedades são recomendados para a verificação de preservação porque:
- Geram muitos casos automaticamente em todo o domínio de entradas
- Pegam casos de borda que testes unitários manuais deixariam passar
- Dão garantia forte de que o comportamento não muda para entradas fora do bug

**Plano de Teste**: observar primeiro o comportamento no código SEM a correção (resultados de sequências de operações no banco, respostas da API, decisões de CORS, limites de rate limit) e então escrever testes de propriedade que capturem esse comportamento.

**Casos de Teste**:
1. **Equivalência do banco**: observar no código original que, para sequências aleatórias de `INSERT/UPDATE/DELETE/SELECT` numa tabela de teste, os retornos (`changes`, `lastInsertRowid`, linhas) são X; propriedade: o `DbWrapper` corrigido produz os mesmos retornos para a mesma sequência e, após `flush()`, o banco reaberto do disco é igual ao estado em memória.
2. **Migração sem perda**: criar um banco com o schema original (sem `token_version`) e dados aleatórios; abrir com o `initDb` corrigido; todas as linhas preservadas e `token_version = 0` para todos.
3. **PRAGMA efetivo**: `PRAGMA foreign_keys` após `initDb()` e após qualquer flush continua `0`, igual ao código original.
4. **Sessões antigas e admin**: tokens gerados com `jwt.sign({ sub, username })` (sem `tv`) para usuários sem evento de segurança → mesmo status/corpo em `GET /api/decks/me`, `GET /api/auth/me/export`; token de admin (`sub: 0`) → mesmo comportamento em `/api/admin/users`, `/api/admin/cards`, `/api/admin/articles`, rotas de moderação do fórum.
5. **Rate limit**: mesma sequência de requisições de um único cliente (sem `X-Forwarded-For`) → mesmos status 429 no mesmo ponto e mesma mensagem, antes e depois.
6. **CORS fora do caso do bug**: para origens aleatórias, com `ALLOWED_ORIGINS` aleatório definido ou `NODE_ENV` ≠ `production`, `resolveCorsOptions` produz a mesma decisão que a configuração original (`lista` ou `true`).
7. **Assets do repositório**: para uma amostra de imagens de `public/assets/cards`, `GET /assets/cards/<id>.jpg` devolve os mesmos bytes, com e sem `dist/`.
8. **Isolamento de testes**: ao fim de um e2e, hash de `src/data/modelo_cartas.json`, listagem de `public/assets/` e `server/` (fora de `.test-data-*`) iguais aos de antes.
9. **Suíte existente**: `npm test` passa sem alterar asserções.

### Testes Unitários (Unit Tests)

- `atomicWrite`: grava conteúdo correto; falha injetada em `writeSync`/`fsyncSync`/`renameSync` mantém o destino e não deixa `.tmp`; `cleanupStaleTemps` remove só os temporários do arquivo indicado; retentativa de `rename` com `EPERM`.
- `db.js`: debounce (N escritas → 1 gravação), `flush()` idempotente (retorna `false` sem pendências), `serialize()` inclui escritas não gravadas, `close()` limpa o timer, falha de gravação mantém `dirty` e reagenda, migração `token_version`, limpeza de temporários no boot.
- `paths.js`: `resolvePaths({})` → `server/`; `resolvePaths({ DATA_DIR })` → todos os caminhos dentro de `DATA_DIR`.
- `seedData.js`: `DATA_DIR` vazio → cria JSON, imagens, avatares; segunda execução não altera nada.
- `backup.js`: nome do arquivo, rotação, `resolveBackupConfig` (padrões, `NODE_ENV=test` desliga, `BACKUP_ENABLED=1` força), cálculo do primeiro disparo a partir da idade do último snapshot, timers com `unref`.
- `auth.js` (middleware): admin passa sem consulta; `tv` ausente = 0; `tv` diferente → 401 `SESSION_REVOKED`; usuário inexistente → 401; `optionalAuth` anônimo nos mesmos casos.
- `security.js`: `resolveTrustProxy` (vazio/produção → 1; número; `true`/`false`; lista), `resolveCorsOptions` (três modos, normalização de URLs com barra final/caminho), `securityHeaders` (valores exatos; HSTS só em produção).
- `cardDataSource.js`: API válida → `source: "api"`; rede falha, status 500, JSON inválido, formato inválido, timeout → `source: "bundled"`.
- `csp-compat`: nenhum `<script` nos HTML escritos pelos pop-ups; se `dist/` existir, nenhum `<script>` inline em `dist/index.html`/`dist/admin.html` (pulado sem `dist/`).

### Testes Baseados em Propriedades (Property-Based Tests)

- **Property 1**: sequências aleatórias de escritas intercaladas com `flush()`/`close()` em pontos aleatórios → banco reaberto do disco = estado em memória no último flush; número de gravações ≤ número de janelas/flushes.
- **Property 2**: conteúdos aleatórios (vazios, grandes, binários) × etapa de falha aleatória → destino ∈ {anterior, novo}, sem `.tmp`.
- **Property 3**: N e K aleatórios → exatamente min(N, K) snapshots mais recentes, cada um reabre como SQLite válido; arquivos "estranhos" no diretório nunca são apagados.
- **Property 4**: subconjuntos aleatórios de arquivos pré-existentes em `DATA_DIR` com conteúdo aleatório → seed nunca altera bytes existentes e cria todo o resto; para nomes aleatórios presentes só em `DATA_DIR`, só no repositório ou em ambos, `/assets/...` serve a fonte correta.
- **Property 5**: respostas aleatórias da API (válidas/ inválidas/ erro) → dados escolhidos seguem a regra API-ou-fallback.
- **Property 6**: sequências aleatórias de eventos por usuário (login, troca de senha, reset, exclusão) com tokens guardados em cada passo → um token é aceito se e somente se seu `tv` é igual ao `token_version` atual e a conta existe; admin sempre aceito.
- **Property 7**: pares aleatórios de IPs em `X-Forwarded-For` com `trust proxy` 1 → contadores independentes; origens aleatórias em produção sem `ALLOWED_ORIGINS` → `Allow-Origin` só para as origens do site; rotas aleatórias (API, estático, SPA, 404) → cabeçalhos presentes.
- **Properties 8–11**: casos de preservação 1, 2, 4, 5, 6 e 7 acima, com geradores de sequências, tokens, origens e amostras de imagens.

### Testes de Integração (Integration Tests)

- **Reinício com disco persistente** (`test/e2e-persistence.test.mjs`): sobe o servidor com `DATA_DIR` temporário; cadastra usuário, publica deck, cria carta, envia imagem de carta e avatar; encerra via `"shutdown"` (IPC); sobe de novo com o mesmo `DATA_DIR`; login, deck, carta (`GET /api/cards`), imagem e avatar continuam disponíveis; `src/` e `public/` intactos.
- **Backup ponta a ponta**: escritas recentes (antes do debounce) aparecem no arquivo baixado de `/api/admin/backup`; jogador → 403; sem token → 401; com `BACKUP_ENABLED=1` e intervalo curto, snapshots aparecem em `DATA_DIR/backups` com rotação.
- **Sessão ponta a ponta** (`test/e2e-session.test.mjs`): troca de senha (token velho 401, novo 200, login com a senha nova), reset de senha (token do console, como em `e2e-pwreset`), exclusão de conta, rotas com `optionalAuth` (`GET /api/decks/community`, `GET /api/profile/:username`) tratando token revogado como anônimo, admin inalterado.
- **Cabeçalhos e estáticos** (`test/e2e-security-headers.test.mjs`): `/api/health`, `/assets/cards/<id>.jpg`, 404 de asset inexistente e, se `dist/` existir, `/` e `/admin` com todos os cabeçalhos; sem HSTS em `NODE_ENV=test`; fallback da SPA ainda não captura `/api/` e `/assets/`.
- **Verificação manual (não automatizável aqui)**: após `npm run build` e `npm start` com `NODE_ENV=production` local, abrir `/` e `/admin` no navegador e confirmar no console que não há violações de CSP (fontes do Google carregam), que os PDFs de proxies do deck e da coleção abrem e chamam a impressão sozinhos, e que em `npm run dev` + `npm run dev:server` uma imagem/avatar enviado aparece no Vite.
