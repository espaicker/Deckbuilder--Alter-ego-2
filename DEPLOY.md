# Guia de publicação (deploy)

Este guia usa o **Render**, no plano pago **Starter** com um **disco
persistente** montado em `/data`. Antes de começar, o que isso significa na
prática:

> 💾 **Os dados do site (contas, decks, torneios, fórum, cartas editadas no
> painel, imagens de cartas, avatares e backups) ficam no disco persistente
> e sobrevivem a deploys e reinícios.** No plano gratuito o sistema de
> arquivos é efêmero e tudo isso seria apagado a cada deploy — por isso o
> `render.yaml` usa `plan: starter` com o disco `forja-data`.
>
> - **Custo:** plano Starter (~US$7/mês) + disco (~US$0,25/GB/mês; o
>   blueprint pede 1 GB). Confira os valores atuais no site do Render.
> - **Instância única, sem deploy zero-downtime:** com disco anexado, o
>   Render para a instância antiga antes de subir a nova. Cada deploy deixa
>   o site fora do ar por alguns segundos. O servidor grava tudo o que está
>   pendente no banco ao receber o aviso de encerramento (SIGTERM).

O deck builder individual (offline, sem publicar na comunidade) **não é
afetado por nada disso** — continua funcionando 100% no navegador de cada
pessoa, com localStorage, independente do backend.

## Passo 1 — Colocar o código no GitHub

O Render publica direto a partir de um repositório Git. Se seu projeto
ainda não é um repositório:

```bash
cd Deckbuilder--Alter-ego--master
git init
git add .
git commit -m "Primeira versão"
```

Crie um repositório novo em [github.com/new](https://github.com/new).
Recomendo deixá-lo **privado** — não por causa de senhas (nenhuma fica no
código, como já garantimos), mas porque as artes das cartas e os dados do
jogo são seus, e um repo privado mantém isso fora do público até você
decidir o contrário.

Depois, conecte e envie:

```bash
git remote add origin https://github.com/SEU-USUARIO/NOME-DO-REPO.git
git branch -M main
git push -u origin main
```

## Passo 2 — Criar conta no Render

Entre em [render.com](https://render.com) e crie uma conta (dá pra usar
login do GitHub direto, facilita o próximo passo).

## Passo 3 — Criar o serviço

Esse projeto já vem com um arquivo `render.yaml`, que descreve a
configuração inteira — o Render lê ele sozinho:

1. No painel do Render, clique em **New** → **Blueprint**.
2. Escolha o repositório que você acabou de subir.
3. O Render vai detectar o `render.yaml` e mostrar o serviço configurado
   (build command, start command, variáveis de ambiente já setadas).
4. Quando pedir o valor de `ADMIN_PASSWORD`, digite a senha que você quer
   usar pra entrar no painel admin (escolha algo forte — essa é a senha
   real que vai proteger a exclusão de usuários e decks).
5. Clique em **Apply** / **Create**.

O primeiro deploy demora alguns minutos (instala dependências e roda o
build do front-end). Quando terminar, o Render te dá uma URL tipo
`https://forja-alter-egos.onrender.com`.

**Não tem o arquivo `render.yaml` ou prefere configurar na mão?** Crie um
**Web Service** manualmente com:
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Plano**: Starter, com um **Disk** montado em `/data`.
- **Variáveis de ambiente**: `NODE_ENV=production`, `DATA_DIR=/data`,
  `TRUST_PROXY=1`, `ADMIN_PASSWORD` (sua senha) e `JWT_SECRET` (qualquer
  texto aleatório longo, ex: gere um em
  [passwordsgenerator.net](https://passwordsgenerator.net) com uns 40+
  caracteres).

### Variáveis de dados e segurança

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `DATA_DIR` | `server/` | Pasta de todos os dados mutáveis. No Render: `/data`. |
| `TRUST_PROXY` | `1` em produção | Quantos proxies confiar para achar o IP real do cliente (rate limit por cliente). |
| `ALLOWED_ORIGINS` | vazio | Lista de origens aceitas no CORS. Vazio em produção = só `SITE_URL`/`RENDER_EXTERNAL_URL`. |
| `BACKUP_ENABLED` | ligado | Snapshots automáticos do banco em `DATA_DIR/backups`. |
| `BACKUP_INTERVAL_HOURS` | `24` | Intervalo entre snapshots (`0` desliga). |
| `BACKUP_KEEP` | `7` | Quantos snapshots manter (os mais antigos são apagados). |
| `DB_SAVE_DELAY_MS` | `250` | Janela para agrupar as gravações do banco em disco. |

## Passo 4 — Testar

Acesse a URL que o Render deu. Confira:
- A página inicial carrega e mostra as cartas.
- `/admin` abre a tela de login do painel admin.
- Logar como admin com o usuário `admin` e a senha que você definiu no
  Passo 3 funciona.
- `/api/health` retorna `{"status":"ok",...}`.

- Cadastre um usuário de teste, faça um novo deploy e confira que o login
  continua funcionando (os dados estão no disco).

## Publicando atualizações depois

Sempre que você quiser atualizar o site (nova carta, ajuste no código),
é só:

```bash
git add .
git commit -m "descrição da mudança"
git push
```

O Render detecta o push e refaz o deploy sozinho. Os dados no disco
(`/data`) são preservados.

### Cartas: o JSON do repositório é só o ponto de partida

No primeiro boot com o disco vazio, o servidor copia para `DATA_DIR`
`src/data/modelo_cartas.json` (vira `DATA_DIR/cards/modelo_cartas.json`),
as imagens de `public/assets/cards` e os avatares de `public/assets/avatars`.
Nada que já exista no disco é sobrescrito.

A partir daí, **as cartas são geridas pelo painel admin** e o frontend as
recebe em tempo real por `GET /api/cards` (sem novo build). Cartas novas
adicionadas ao JSON do repositório em deploys futuros **não** são mescladas
automaticamente: crie-as pelo painel. Imagens novas do repositório continuam
aparecendo (o servidor procura primeiro em `DATA_DIR` e depois no build).

## Backup e retencao de dados (LGPD)

Politica simples de backup e retencao. Nao e sofisticada de proposito — o
importante e existir, estar escrita e ser seguida.

### Backup do banco

- O banco e um unico arquivo `deckbuilder.db` (sql.js) em `DATA_DIR`
  (em producao, o disco persistente do Render em `/data`). A gravacao e
  atomica (arquivo temporario + renomeacao), entao uma queda no meio da
  gravacao nao corrompe o arquivo.
- **Snapshots automaticos:** o servidor grava `DATA_DIR/backups/deckbuilder-<data>.db`
  a cada `BACKUP_INTERVAL_HOURS` (padrao 24 h) e mantem os `BACKUP_KEEP`
  mais recentes (padrao 7).
- **Limite dos snapshots:** eles ficam **no mesmo disco** do banco. Protegem
  contra corrupcao e exclusao acidental, **nao** contra a perda do disco ou
  da conta no Render.
- **Copia externa (recomendado):** no painel admin, aba **Estatisticas**,
  clique em **Baixar backup do banco** (rota `GET /api/admin/backup`, so
  admin). Guarde a copia fora do Render, por exemplo semanalmente.
- **Retencao de backup:** manter as ultimas 30 copias externas; apagar as
  mais antigas. Backups contem dado pessoal — guarde em local com acesso
  restrito e, de preferencia, criptografado.
- **Restauracao:** num momento sem uso do site, pelo Shell do Render,
  copie o backup sobre `/data/deckbuilder.db` (ex.:
  `cp /data/backups/deckbuilder-AAAAMMDDTHHMMSSZ.db /data/deckbuilder.db`)
  e reinicie o servico logo em seguida (Manual Deploy → Restart). O servidor
  so regrava o arquivo quando ha alteracoes pendentes, entao qualquer escrita
  feita entre a copia e o reinicio sobrescreveria a restauracao — por isso o
  site deve estar sem uso. Testar a restauracao periodicamente.

### Retencao de contas inativas

- Dados de conta ativa sao mantidos enquanto a conta existir.
- **Conta inativa:** sem login por **24 meses** pode ser marcada para
  remocao. Antes de remover, notificar o titular no e-mail cadastrado com
  prazo para se manifestar.
- Remocao de conta inativa segue a **mesma anonimizacao** de
  `DELETE /api/auth/me`: e-mail/senha apagados, `username` anonimizado,
  historico competitivo preservado sem vinculo pessoal.
- Backups antigos que ainda contenham o dado removido expiram naturalmente
  pela politica de retencao de 30 dias acima.

### Titular quer exportar ou apagar antes disso

Qualquer usuario pode, a qualquer momento, exportar os proprios dados
("Baixar meus dados") ou apagar a conta pela tela de configuracoes — nao
depende de solicitacao manual ao administrador.

## Status de npm audit (Fase 9)

Ultima verificacao: 2 alertas restantes, ambos em **dependencias de
desenvolvimento** (esbuild/vite), nao no runtime do servidor:

- `nanoid` (high): **corrigido** via `npm audit fix` (nao-breaking).
- `esbuild` / `vite` (1 moderate + 1 high): a unica correcao disponivel e
  atualizar para `vite@8` (mudanca major/breaking). O alerta do esbuild se
  refere ao **servidor de desenvolvimento** do Vite, que **nao roda em
  producao** — em producao servimos apenas o `dist/` estatico ja compilado.
  Por isso, e para respeitar a estabilidade da stack, mantemos `vite@5` por
  ora. Reavaliar em uma janela de manutencao dedicada.

Nenhuma vulnerabilidade alta/critica **sem solucao** afeta o codigo de
runtime do servidor.

