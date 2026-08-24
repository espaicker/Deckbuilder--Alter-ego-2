# Dados Coletados — Forja de Alter Egos

> Auditoria de dados pessoais tratados pela plataforma (LGPD — Lei Geral de
> Protecao de Dados, Lei 13.709/2018). Este documento reflete o estado atual
> do banco de dados e deve ser atualizado sempre que uma nova coluna/tabela
> passar a armazenar dado pessoal.
>
> **Aviso:** este material e a base tecnica, nao um parecer juridico. Para um
> lancamento publico real, recomenda-se revisao por profissional qualificado.

Ultima revisao: Fase 9.

## O que e considerado dado pessoal aqui

Dado pessoal e qualquer informacao que identifique ou possa identificar uma
pessoa natural. No projeto atual, isso inclui: **nome de usuario, e-mail** e,
indiretamente, o **historico de jogo vinculado a um usuario identificavel**.
Senha e armazenada apenas como **hash bcrypt** (nao e reversivel), mas ainda
assim tratada como dado sensivel de conta.

## Tabelas e campos

### `users` — conta do jogador
| Campo | Dado pessoal? | Observacao |
|---|---|---|
| `id` | Indireto | Identificador interno. |
| `username` | **Sim** | Nome de exibicao publico. Anonimizado ao apagar conta. |
| `email` | **Sim** | Privado, nunca exposto a terceiros. Apagado ao apagar conta. |
| `password_hash` | Sim (sensivel) | Hash bcrypt. Substituido por hash aleatorio ao apagar conta. |
| `bio` | Possivel | Texto livre do usuario; pode conter dado pessoal. Limpo ao apagar conta. |
| `avatar_url` | Possivel | Imagem enviada pelo usuario. Limpo ao apagar conta. |
| `created_at` | Nao | Data de criacao da conta. |
| `terms_accepted_at` | Nao (metadado) | Evidencia de consentimento (LGPD). |
| `is_judge` | Nao | Papel de moderacao. |

### `community_decks` — decks publicados
| Campo | Dado pessoal? | Observacao |
|---|---|---|
| `user_id` | Indireto | Vincula o deck ao autor. Apos anonimizacao, aponta para conta anonima. |
| `name`, `description` | Possivel | Texto livre. |
| demais campos | Nao | Conteudo de jogo (cartas). |

### `tournaments` / `tournament_players` / `tournament_rounds` / `tournament_matches`
| Campo | Dado pessoal? | Observacao |
|---|---|---|
| `organizer_id`, `user_id`, `reported_by`, `overridden_by_user_id` | Indireto | Vinculam registros a um usuario. Anonimizados junto com a conta. |
| resultados de partida | Indireto | Historico competitivo — mantido para integridade do ranking de terceiros. |

### `point_history` — pontuacao de ranking
| Campo | Dado pessoal? | Observacao |
|---|---|---|
| `user_id` | Indireto | Vincula pontos ao usuario. Anonimizado com a conta. |

### `forum_topics` / `forum_replies` / `forum_reports`
| Campo | Dado pessoal? | Observacao |
|---|---|---|
| `author_id`, `reporter_id` | Indireto | Autoria de conteudo. Anonimizada com a conta. |
| `title`, `body`, `reason` | Possivel | Texto livre do usuario. |

### `stores` — lojas parceiras (Fase 7)
| Campo | Dado pessoal? | Observacao |
|---|---|---|
| `owner_user_id` | Indireto | Dono da loja. |
| `contact_info` | **Sim (de negocio)** | Contato publico da LOJA, escolhido por quem cadastra. Nao e o e-mail pessoal da conta. |

### `articles` — noticias (Fase 8)
| Campo | Dado pessoal? | Observacao |
|---|---|---|
| `author_user_id` | Indireto | So admin publica. |

### `password_reset_tokens`
| Campo | Dado pessoal? | Observacao |
|---|---|---|
| `user_id` | Indireto | Vincula o token ao usuario. |
| `token_hash` | Sim (sensivel) | Apenas o HASH do token, nunca o token puro. Apagado ao apagar conta. |

## Compartilhamento com terceiros

**Nenhum.** A plataforma nao vende, aluga nem compartilha dado pessoal com
terceiros. O unico envio externo e o **e-mail transacional** de recuperacao de
senha (provedor de e-mail configurado em `server/lib/email.js`), estritamente
para entregar o link ao proprio titular.

## Direitos do titular implementados

- **Acesso / portabilidade:** `GET /api/auth/me/export` retorna todo o dado
  pessoal do usuario logado em JSON. UI: botao "Baixar meus dados".
- **Eliminacao (direito ao esquecimento):** `DELETE /api/auth/me` (exige senha).
  Aplica **anonimizacao** (ver Politica de Privacidade e comentario na rota):
  `username` vira "Usuario removido #ID", `email`/`password_hash`/`bio`/`avatar`
  sao removidos, e o historico competitivo permanece sem vinculo a uma pessoa.
- **Consentimento:** cadastro exige `accepted_terms: true`; `terms_accepted_at`
  guarda quando o aceite ocorreu.

## Retencao e backup

Ver `DEPLOY.md`, secao "Backup e retencao de dados (LGPD)".
