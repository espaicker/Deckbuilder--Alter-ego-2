# Forja de Alter Egos — Deck Builder

Deck builder web para o card game. Front-end em React + Vite, com um
backend leve (Express + SQLite via `sql.js`, sem compilação nativa) para
contas de jogador, login Google OAuth, comunidade de decks publicados e painel admin. Os
decks montados individualmente continuam funcionando 100% offline, salvos
no `localStorage` do navegador — o backend só entra em cena se você
quiser publicar um deck na comunidade ou acessar o painel admin.

Pra publicar o site de verdade (não só rodar na sua máquina), veja o
[guia de publicação](./DEPLOY.md).

## Rodando localmente

Pré-requisito: [Node.js](https://nodejs.org/) 18 ou mais recente.

```bash
npm install
npm run dev:server   # backend, em outro terminal — http://localhost:3001
npm run dev          # front-end — http://localhost:5173
```

(ou `npm run dev:all` pra subir os dois de uma vez). Qualquer alteração
no código recarrega a página automaticamente. Sem o backend rodando, o
deck builder individual funciona normalmente — só a aba "Comunidade" e o
login ficam indisponíveis.

## Painel admin e segurança

- **Decks publicados são validados no servidor** (`server/routes/decks.js`),
  usando as mesmas regras do front-end (`src/lib/deckRules.js`): cartas
  precisam existir de verdade, respeitar o máximo de 4 cópias, usar só
  cores do Alter Ego escolhido, e ter exatamente 50 cartas no deck e 10 no
  monte de Drops. Isso vale mesmo se alguém chamar a API diretamente,
  sem passar pela interface — protege a comunidade e as estatísticas do
  admin contra dados incompletos ou adulterados.
- **Limite de tentativas de login** (rate limiting): 10 tentativas a cada
  15 min por IP no login de jogador, 10 registros por hora, e 5 tentativas
  a cada 15 min no login de admin (o alvo mais sensível). Passado o
  limite, a API responde `429` até a janela de tempo passar.

O painel admin (aba "Admin", visível só depois de logar como admin) usa
credenciais que **nunca ficam expostas em texto puro no código**:

- Na primeira vez que o backend roda (`npm run dev:server`), ele gera uma
  senha aleatória, mostra ela **uma única vez** no terminal, e salva só o
  hash em `server/.admin-credentials.json` (arquivo local, fora do Git).
  Guarde essa senha assim que aparecer — não tem como recuperá-la depois.
- Pra usar uma senha própria (ex: ao publicar o site de verdade), defina
  as variáveis de ambiente `ADMIN_USERNAME` e `ADMIN_PASSWORD` antes de
  rodar o servidor — elas sempre têm prioridade sobre o arquivo gerado.
- Esqueceu a senha gerada? Apague `server/.admin-credentials.json` e
  reinicie o servidor — uma nova será gerada.
- O segredo usado para assinar os logins (JWT) segue a mesma lógica: por
  padrão é gerado automaticamente em `server/.jwt-secret`, ou você pode
  fixar via `JWT_SECRET` no ambiente.
- Existem dois níveis administrativos:
  - `superadmin`: login principal via `ADMIN_USERNAME`/`ADMIN_PASSWORD`;
    consegue promover e rebaixar outros usuários para admin.
  - `admin`: acessa o painel e gerencia usuários, decks e cartas, mas não
    altera permissões administrativas.
- O login Google fica ativo quando `GOOGLE_CLIENT_ID` está configurado.
  O backend valida o token do Google antes de criar ou atualizar a conta.

**Ao publicar o site de verdade**, configure `ADMIN_PASSWORD`,
`JWT_SECRET` e `GOOGLE_CLIENT_ID` como variáveis de ambiente no painel do seu serviço de
hospedagem (Render, Railway, etc.) em vez de depender dos arquivos
gerados localmente.

## Testes

As regras de deck (`src/lib/deckRules.js`) são cobertas por testes
automatizados:

```bash
npm test
```

## Build para publicar

```bash
npm run build
```

Gera a pasta `dist/` com os arquivos estáticos prontos. Essa pasta pode ser
publicada em qualquer serviço de hospedagem estática — não precisa de
servidor próprio (Vercel, Netlify ou GitHub Pages, por exemplo).

## Estrutura do projeto

```
├── public/
│   └── assets/cards/         ← imagens das cartas (nome = {id}.jpg)
├── src/
│   ├── data/
│   │   └── modelo_cartas.json  ← banco de dados das cartas
│   ├── lib/
│   │   └── deckRules.js        ← regras de deck (puro, testável)
│   ├── App.jsx                 ← interface do deck builder
│   ├── App.css                  ← estilos
│   └── main.jsx                  ← ponto de entrada do React
├── test/
│   └── deckRules.test.mjs      ← testes das regras de deck
├── index.html
├── package.json
└── vite.config.js
```

## Funcionalidades

- **Buscar Cartas** — catálogo com todas as cartas do jogo, filtrável por
  cor/tipo/subtipo e busca por nome, disponível mesmo antes de escolher um
  Alter Ego. Útil pra conferir o texto e a arte de qualquer carta.
- **Home com estética de HQ** — a página inicial usa a identidade visual
  do site Alter Ego: tipografia Bangers/Oswald, bordas grossas, sombras
  duras, cards inclinados e artes de lore/notícias/artigos.
- **Escolha de Alter Ego** — define as cores permitidas no deck. Clique no
  texto de efeito expande/retrai a descrição completa.
- **Montagem do deck e do monte de Drops** — respeitando cor, cópias
  máximas e tamanho fixo (ver regras abaixo).
- **Distribuição de cores** — o HUD mostra uma barra segmentada com a
  proporção de cada cor no deck e nos Drops (passe o mouse pra ver o
  percentual exato); a aba Resumo traz a mesma informação com os números
  explícitos.
- **Estatísticas do deck** (aba Resumo, aparece assim que houver cartas no
  deck) — quatro gráficos leves em SVG/CSS puro (sem biblioteca externa):
  - **Cores do deck**: gráfico de rosca com a proporção de cada cor.
  - **Curva de custo**: barras mostrando quantas cartas existem em cada
    valor de custo — ajuda a ver se o deck está bem balanceado ou "pesado"
    demais em cartas caras.
  - **Composição por tipo**: barra segmentada por subtipo dentro de cada
    tipo (Ação/Reação/Tática).
  - **Combate**: média de Ataque e Defesa das cartas do deck, ponderada
    pela quantidade de cada carta.
- **Visualização de carta cheia** — botão "Ver carta" (ou clique na
  miniatura) abre um modal com a arte grande e o efeito completo.
- **Decks salvos** — ficam no `localStorage` do navegador (não
  sincronizam entre dispositivos).
- **Gerar PDF de proxies** — na aba Resumo, monta uma folha A4 (3 cartas
  por linha, 63×88mm) com o Alter Ego, os Drops e todas as cartas do deck
  nas quantidades corretas, abrindo a caixa de impressão do navegador
  (escolha "Salvar como PDF").

## Adicionando novas cartas

1. Edite `src/data/modelo_cartas.json` seguindo o padrão já existente.
2. Salve a arte da carta como `public/assets/cards/{id}.jpg` (JPEG,
   qualidade ~80-85%, lado maior por volta de 900px).
3. Não precisa reiniciar nada: o Vite recarrega sozinho em desenvolvimento.

Se uma carta ainda não tiver arte pronta, o app não quebra — mostra um
retângulo de cor sólida no lugar até você adicionar o arquivo.

### Cartas de Drop

As 5 cartas de Drop (uma por cor) usam os ids `"82"` a `"86"` em
`modelo_cartas.json` e suas imagens em `public/assets/cards/82.jpg` a
`86.jpg`. O mapeamento cor → id de imagem usado na geração do PDF fica na
constante `DROP_IMAGE_ID` dentro de `printProxyPdf`, em `src/App.jsx`.

## Regras de deck configuráveis

As regras de montagem ficam centralizadas em `src/lib/deckRules.js`:

```js
export const DECK_RULES = Object.freeze({
  mainDeckSize: 50,  // tamanho fixo do deck principal
  dropPileSize: 10,  // tamanho fixo do monte de Drops
  maxCopies: 4,       // cópias máximas por carta
});
```

Mudar esses valores atualiza automaticamente a validação, os medidores do
HUD e a geração de PDF — é a única fonte de verdade dessas regras.

## Impressão de deck como proxy (PDF)

O botão "Gerar PDF de proxies" (aba Resumo) abre uma janela com a folha de
impressão e dispara a caixa de impressão do navegador automaticamente
assim que as imagens carregam — escolha "Salvar como PDF" como destino.

O que vem na folha:

- **Página de conferência** (primeira página): lista com o nome do Alter
  Ego, todas as cartas do deck e a quantidade de cada Drop, pra você bater
  o olho antes de recortar e confirmar que saiu tudo certo.
- **Páginas de cartas**: 9 cartas por página (3×3), cada uma com **marcas
  de corte nos 4 cantos** (o mesmo padrão usado por sites de proxy) —
  facilita muito cortar reto sem precisar medir com régua.
- **Rodapé** em toda página com o nome do Alter Ego, a data e a numeração
  de página, útil quando você imprime vários decks e quer organizar depois.

As medidas são calibradas para encaixar exatamente numa A4 com 6mm de
margem: cartas em 63×88mm (tamanho físico real, padrão MTG/Pokémon) com
4.5mm de espaço entre elas — a matemática fecha certinho (198mm de largura
de conteúdo em 198mm úteis), então não há corte cortado ou desalinhamento
por acúmulo de erro de arredondamento.
