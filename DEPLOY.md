# Guia de publicação (deploy)

Este guia usa o **Render**, no plano **gratuito**. Antes de começar, um
resumo honesto do que isso significa na prática:

> ⚠️ **No plano gratuito, os dados do site (contas de jogador e decks
> publicados) são apagados sempre que o serviço "dorme" por inatividade
> (15 min sem visitas) e acorda de novo, ou quando você publica uma
> atualização.** Isso é uma limitação do próprio Render, não do seu
> projeto. É perfeito para testar e mostrar pra galera, mas não trate
> como um lugar pra guardar dados que importam de verdade. Quando quiser
> resolver isso, veja a seção **"Quando quiser dados permanentes"** no
> final deste guia — é uma mudança pequena.

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
- **Variáveis de ambiente**: adicione `ADMIN_PASSWORD` (sua senha) e
  `JWT_SECRET` (qualquer texto aleatório longo, ex: gere um em
  [passwordsgenerator.net](https://passwordsgenerator.net) com uns 40+
  caracteres).

## Passo 4 — Testar

Acesse a URL que o Render deu. Confira:
- A página inicial carrega e mostra as cartas.
- `/admin` abre a tela de login do painel admin.
- Logar como admin com o usuário `admin` e a senha que você definiu no
  Passo 3 funciona.
- `/api/health` retorna `{"status":"ok",...}`.

Se a primeira visita demorar uns 30-60 segundos pra carregar, é normal —
é o "acordar" do plano gratuito depois de inatividade.

## Publicando atualizações depois

Sempre que você quiser atualizar o site (nova carta, ajuste no código),
é só:

```bash
git add .
git commit -m "descrição da mudança"
git push
```

O Render detecta o push e refaz o deploy sozinho — mas lembre: isso reseta
os dados também, pelo mesmo motivo do disco efêmero.

## Quando quiser dados permanentes

Quando decidir que quer contas e decks publicados que não somem sozinhos,
o caminho é: upgrade do serviço pra **Starter** (~US$7/mês) no painel do
Render, e anexar um **Persistent Disk** (~US$0,25/mês pelo menor
tamanho) montado em `/data`. Depois, defina a variável de ambiente
`DATA_DIR=/data` (o código já está pronto pra isso — veja `.env.example`)
e faça um novo deploy. A partir daí, os dados sobrevivem a reinícios e
atualizações normalmente.

## Backup e retencao de dados (LGPD)

Politica simples de backup e retencao. Nao e sofisticada de proposito — o
importante e existir, estar escrita e ser seguida.

### Backup do banco

- O banco e um unico arquivo `deckbuilder.db` (sql.js) em `DATA_DIR`
  (em producao, o disco persistente — ex: Persistent Disk do Render).
- **Frequencia sugerida:** copia diaria do arquivo para um armazenamento
  separado (fora do mesmo disco/servico). Exemplo manual:
  ```bash
  cp "$DATA_DIR/deckbuilder.db" "/backups/deckbuilder-$(date +%F).db"
  ```
- **Retencao de backup:** manter as ultimas 30 copias diarias; apagar as
  mais antigas. Backups contem dado pessoal — guarde em local com acesso
  restrito e, de preferencia, criptografado.
- **Restauracao:** parar o servico, substituir `deckbuilder.db` pelo backup,
  reiniciar. Testar a restauracao periodicamente.

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

