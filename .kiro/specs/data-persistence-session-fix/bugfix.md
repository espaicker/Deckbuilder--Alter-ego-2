# Documento de Requisitos do Bugfix

## Introdução

O "Forja de Alter Egos" perde dados em produção e tem falhas de segurança na sessão e na borda HTTP. No Render, o serviço roda no plano grátis com sistema de arquivos efêmero e sem disco persistente configurado, então todo deploy ou reinício apaga usuários, decks, torneios, fórum e demais dados. Além disso, o banco é regravado por inteiro, de forma síncrona e não atômica, a cada escrita; não existe backup; e o conteúdo gerenciado pelo admin (cartas, imagens de cartas e avatares) é gravado na árvore de código/build, não é servido em produção e some no próximo deploy. As edições de cartas também só chegam aos jogadores depois de um novo build.

Na parte de segurança: o servidor não confia no proxy do Render, então o rate limit pode agrupar todos os clientes sob o IP do proxy; tokens JWT não podem ser revogados após troca/redefinição de senha ou exclusão de conta; o CORS reflete qualquer origem com credenciais quando `ALLOWED_ORIGINS` não está definido; e não há cabeçalhos de segurança.

Decisão do usuário: usar disco persistente do Render (plano pago Starter, disco montado em `/data`). Não migrar para Postgres, não usar armazenamento de objetos externo e manter o sql.js (sem dependências nativas).

## Análise do Bug

### Comportamento Atual (Defeito)

**Grupo 1 — Perda de dados / persistência**

1.1 WHEN o serviço é implantado ou reiniciado no Render com a configuração atual (plano grátis, sem disco persistente, sem `DATA_DIR`) THEN o sistema perde o banco de dados inteiro (usuários, decks, torneios, fórum etc.), pois o arquivo do banco fica no sistema de arquivos efêmero

1.2 WHEN qualquer comando de escrita é executado no banco (exec/run) THEN o sistema exporta e regrava o arquivo inteiro do banco de forma síncrona, bloqueando o event loop a cada escrita

1.3 WHEN o processo é interrompido (crash, SIGKILL ou falha de disco) no meio da gravação do arquivo do banco THEN o sistema pode deixar o arquivo do banco parcialmente escrito e corrompido, pois a gravação não é atômica

1.4 WHEN o processo recebe SIGTERM ou SIGINT (como o Render faz em todo deploy) THEN o sistema não executa nenhum procedimento explícito de persistência final antes de encerrar

1.5 WHEN o banco é corrompido ou dados são apagados por engano THEN o sistema não dispõe de nenhum backup para recuperação, nem oferece ao admin uma forma de baixar uma cópia do banco

1.6 WHEN o admin cria ou edita cartas THEN o sistema grava os dados das cartas no arquivo de dados dentro da árvore de código-fonte (`src/data/modelo_cartas.json`), que é perdido no próximo deploy

1.7 WHEN o admin envia uma imagem de carta ou um usuário envia um avatar THEN o sistema grava o arquivo em `public/assets/cards` ou `public/assets/avatars`, que não é servido em produção (o servidor só serve `dist/`, resultando em 404) e é perdido no próximo deploy

1.8 WHEN o admin edita cartas em produção THEN o sistema continua exibindo aos jogadores os dados de cartas embutidos no build do frontend, e a edição só aparece após um novo build

1.9 WHEN as rotas de decks e de perfil precisam dos dados das cartas THEN o sistema lê o arquivo da árvore de código-fonte, ignorando qualquer local persistente de dados

**Grupo 2 — Segurança**

1.10 WHEN o servidor roda atrás do proxy do Render THEN o sistema identifica o cliente pelo IP do proxy em vez do IP real, fazendo com que o rate limit (por exemplo, de login) bloqueie todos os usuários juntos por falhas de um único usuário, ou se torne ineficaz

1.11 WHEN um usuário troca a senha THEN o sistema continua aceitando os tokens emitidos antes da troca por até 7 dias

1.12 WHEN um usuário redefine a senha pelo fluxo de recuperação THEN o sistema continua aceitando os tokens emitidos antes da redefinição por até 7 dias

1.13 WHEN um usuário exclui a própria conta THEN o sistema não invalida explicitamente os tokens emitidos para essa conta

1.14 WHEN o servidor roda em produção sem `ALLOWED_ORIGINS` definido THEN o sistema responde ao CORS refletindo qualquer origem com credenciais habilitadas

1.15 WHEN qualquer página ou resposta da API é servida THEN o sistema não envia cabeçalhos de segurança (X-Content-Type-Options, X-Frame-Options/frame-ancestors, Referrer-Policy, HSTS, Content-Security-Policy)

### Comportamento Esperado (Correto)

**Grupo 1 — Perda de dados / persistência**

2.1 WHEN o serviço é implantado ou reiniciado no Render THEN o sistema SHALL manter todos os dados, usando um plano pago com disco persistente montado em `/data` e `DATA_DIR=/data` configurado no blueprint de deploy

2.2 WHEN comandos de escrita são executados no banco THEN o sistema SHALL agrupar (coalescer/debounce) as gravações em disco, sem regravar o arquivo inteiro de forma síncrona a cada comando, mantendo os dados em memória imediatamente consistentes para as leituras seguintes

2.3 WHEN o arquivo do banco é gravado em disco THEN o sistema SHALL gravar de forma atômica (arquivo temporário no mesmo diretório seguido de renomeação), de modo que o arquivo do banco seja sempre a versão anterior completa ou a nova versão completa

2.4 WHEN o processo recebe SIGTERM ou SIGINT THEN o sistema SHALL gravar no disco todas as alterações pendentes antes de encerrar

2.5 WHEN o servidor está em execução com o banco persistente THEN o sistema SHALL gerar snapshots periódicos do banco (por exemplo, diários) dentro do diretório de dados, mantendo apenas os N mais recentes (rotação)

2.6 WHEN o admin autenticado solicita um backup THEN o sistema SHALL permitir o download de uma cópia consistente do banco, e WHEN um usuário não admin ou não autenticado solicita THEN o sistema SHALL negar o acesso

2.7 WHEN o servidor inicia e os dados de cartas, imagens de cartas ou o diretório de avatares não existem em `DATA_DIR` THEN o sistema SHALL criá-los a partir das cópias incluídas no repositório (seed), sem sobrescrever dados já existentes em `DATA_DIR`

2.8 WHEN o admin cria ou edita cartas THEN o sistema SHALL gravar os dados das cartas em `DATA_DIR`, de forma atômica

2.9 WHEN o admin envia uma imagem de carta ou um usuário envia um avatar THEN o sistema SHALL gravar o arquivo em `DATA_DIR`, e o arquivo SHALL ficar acessível em `/assets/cards/...` ou `/assets/avatars/...` também em produção

2.10 WHEN um arquivo é solicitado em `/assets/cards/...` ou `/assets/avatars/...` THEN o sistema SHALL servi-lo primeiro a partir de `DATA_DIR` e, se não existir lá, a partir dos arquivos incluídos no build

2.11 WHEN o frontend é carregado THEN o sistema SHALL obter os dados das cartas de um endpoint da API em tempo de execução, usando os dados embutidos no build apenas como fallback caso a API falhe, de modo que edições do admin apareçam sem novo build

2.12 WHEN as rotas de decks e de perfil precisam dos dados das cartas THEN o sistema SHALL ler a mesma fonte persistente usada pela administração de cartas (`DATA_DIR`)

**Grupo 2 — Segurança**

2.13 WHEN o servidor roda atrás de proxy THEN o sistema SHALL confiar em um número configurável de saltos de proxy (padrão 1 em produção, configurável por variável de ambiente), de modo que o rate limit seja aplicado por IP real do cliente

2.14 WHEN um usuário troca a senha THEN o sistema SHALL invalidar todos os tokens emitidos anteriormente para esse usuário e SHALL devolver um token novo e válido para a sessão que fez a troca

2.15 WHEN um usuário redefine a senha pelo fluxo de recuperação THEN o sistema SHALL invalidar todos os tokens emitidos anteriormente para esse usuário

2.16 WHEN um usuário exclui a própria conta THEN o sistema SHALL rejeitar qualquer token emitido anteriormente para essa conta

2.17 WHEN uma requisição chega com um token cuja versão não corresponde à versão atual do usuário (ou sem versão, para usuários cuja versão já foi incrementada) THEN o sistema SHALL rejeitá-lo nas rotas que exigem autenticação com mensagem em pt-BR, e SHALL tratá-lo como anônimo nas rotas de autenticação opcional

2.18 WHEN o servidor roda em produção sem `ALLOWED_ORIGINS` definido THEN o sistema SHALL permitir via CORS apenas a própria origem do site (mesma origem, `SITE_URL` e/ou `RENDER_EXTERNAL_URL`), sem refletir origens arbitrárias

2.19 WHEN qualquer resposta é servida THEN o sistema SHALL incluir X-Content-Type-Options: nosniff, proteção contra framing (X-Frame-Options e/ou `frame-ancestors`), Referrer-Policy e uma Content-Security-Policy compatível com o app (incluindo Google Fonts usado em `index.html` e `admin.html`), e SHALL incluir HSTS apenas em produção

### Comportamento Inalterado (Prevenção de Regressão)

3.1 WHEN a suíte de testes existente (19 arquivos, 273 testes, executada com `node --test`) é executada THEN o sistema SHALL CONTINUE TO passar em todos os testes

3.2 WHEN o desenvolvedor roda localmente (`npm run dev:server` + `npm run dev`) sem `DATA_DIR` definido THEN o sistema SHALL CONTINUE TO funcionar usando `server/` como diretório de dados padrão

3.3 WHEN os testes e2e iniciam o servidor com `DATA_DIR` apontando para uma pasta temporária e `NODE_ENV=test` THEN o sistema SHALL CONTINUE TO isolar todos os dados nessa pasta temporária

3.4 WHEN o servidor inicia com um banco existente THEN o sistema SHALL CONTINUE TO preservar todos os usuários, decks, torneios, fórum e demais dados, aplicando novas colunas por migração sem perda

3.5 WHEN um usuário existente possui um token válido emitido antes da mudança e não trocou/redefiniu a senha nem excluiu a conta THEN o sistema SHALL CONTINUE TO aceitar esse token até sua expiração normal

3.6 WHEN o admin faz login com as credenciais de admin (token sem usuário correspondente na tabela de usuários) THEN o sistema SHALL CONTINUE TO autenticar e autorizar o admin normalmente

3.7 WHEN usuários fazem cadastro, login, criam/editam/excluem decks, participam de torneios e usam o fórum THEN o sistema SHALL CONTINUE TO se comportar como antes

3.8 WHEN o admin cria, edita ou remove cartas e imagens pelo painel THEN o sistema SHALL CONTINUE TO aceitar as mesmas operações e formatos de dados de antes

3.9 WHEN imagens de cartas e avatares já incluídos no repositório/build são solicitados THEN o sistema SHALL CONTINUE TO servi-los nas mesmas URLs `/assets/...`

3.10 WHEN o rate limit é aplicado a requisições de um mesmo cliente THEN o sistema SHALL CONTINUE TO usar os mesmos limites e mensagens de erro em pt-BR

3.11 WHEN `ALLOWED_ORIGINS` está definido THEN o sistema SHALL CONTINUE TO permitir exatamente as origens listadas, e WHEN o servidor roda em desenvolvimento THEN o sistema SHALL CONTINUE TO aceitar as origens de desenvolvimento (comportamento permissivo)

3.12 WHEN o frontend (build do Vite) e as páginas `index.html` e `admin.html` são carregados com os novos cabeçalhos THEN o sistema SHALL CONTINUE TO carregar scripts, estilos, fontes, imagens e chamadas à API sem bloqueios

3.13 WHEN as rotas `/api/*` e o fallback da SPA são acessados THEN o sistema SHALL CONTINUE TO responder como antes, incluindo o health check em `/api/health`

3.14 WHEN o fluxo de recuperação de senha por e-mail é usado THEN o sistema SHALL CONTINUE TO enviar o e-mail e aceitar o token de redefinição como antes

3.15 WHEN qualquer mensagem é exibida ao usuário (incluindo novos erros de sessão inválida ou backup) THEN o sistema SHALL CONTINUE TO usar pt-BR

3.16 WHEN o projeto é instalado e construído THEN o sistema SHALL CONTINUE TO usar sql.js, sem dependências nativas
