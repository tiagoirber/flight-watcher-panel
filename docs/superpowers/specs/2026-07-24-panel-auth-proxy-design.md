# Painel: proxy autenticado via Cloudflare Worker (substitui token do GitHub no navegador)

> Data: 2026-07-24 | Repositório afetado: `flight-watcher-panel` (este repo).
> Repositório `flight-watcher` (principal) não é alterado por este design.

## 1. Problema

O painel web (`flight-watcher-panel`, GitHub Pages, público) hoje exige que o
usuário cole um **fine-grained personal access token do GitHub** diretamente
no navegador a cada sessão/aba nova. O token nunca é persistido em
`localStorage`/`sessionStorage` (decisão de segurança da Fase 8 do Evolution
Protocol) — a única forma de persistência entre sessões é o gerenciador de
senhas do próprio navegador (autofill), o que se mostrou pouco confiável na
prática: o autofill falhou repetidamente, obrigando o usuário a gerar/colar
o token de novo com frequência maior do que o esperado.

## 2. Objetivo

Eliminar a dependência do autofill do navegador como mecanismo de
persistência, sem reintroduzir o risco que a Fase 8 corrigiu (token real do
GitHub, de escopo amplo e não revogável rapidamente, sentado em storage do
navegador).

## 3. Arquitetura escolhida

Introduzir um **Cloudflare Worker** (`flight-watcher-proxy`) como
intermediário entre o painel estático e a API do GitHub.

```text
Painel (GitHub Pages, estático)
   |  Authorization: Bearer <token de sessão do painel>
   v
Cloudflare Worker (flight-watcher-proxy)
   |  Authorization: Bearer <GITHUB_PAT real>
   v
api.github.com (repo privado tiagoirber/flight-watcher)
```

### 3.1 Componentes novos

- **Código do Worker**: vive em `worker/` dentro deste repositório
  (`flight-watcher-panel`). É código público (visível no repo), mas não
  contém nenhum segredo — só referencias a `env.GITHUB_PAT`,
  `env.PANEL_PASSWORD`, `env.SESSION_SECRET`.
- **3 secrets configurados só no Cloudflare** (via `wrangler secret put` ou
  painel do Cloudflare), nunca commitados:
  - `GITHUB_PAT` — o fine-grained PAT real (Actions: Read and write,
    Contents: Read-only), o mesmo que hoje era colado no navegador.
  - `PANEL_PASSWORD` — senha/PIN escolhida pelo usuário para entrar no
    painel. Deve ser uma frase/senha razoável, não um PIN numérico curto,
    já que é a única barreira de autenticação.
  - `SESSION_SECRET` — segredo aleatório usado para assinar tokens de
    sessão (HMAC-SHA256). Rotacionar este valor invalida **todas** as
    sessões abertas imediatamente (kill switch).
- **Deploy**: subdomínio grátis `*.workers.dev`, sem necessidade de domínio
  próprio ou cartão de crédito no plano free do Cloudflare.

### 3.2 Mudança de política de segurança (explícita, autorizada pelo usuário)

O token de **sessão do painel** (gerado pelo Worker após login) **pode** ser
persistido em `localStorage` do painel — diferente do `GITHUB_PAT`, que
nunca mais toca o navegador. Justificativa: o token de sessão só tem
significado para o próprio Worker (não é aceito por `api.github.com`
diretamente), tem validade e pode ser revogado globalmente trocando
`SESSION_SECRET`. Isso substitui o invariante antigo "nenhum
localStorage/sessionStorage para o token" por um invariante mais específico:
"o `GITHUB_PAT` nunca é enviado ao navegador nem persistido nele; apenas um
token de sessão escopado ao Worker pode ser persistido".

## 4. Fluxo de login

1. Usuário abre o painel; se não houver token de sessão salvo (ou o
   salvo tiver expirado), mostra um formulário simples de senha (substitui o
   atual formulário de token do GitHub).
2. Painel envia `POST /login { password }` ao Worker.
3. Worker compara `password` com `PANEL_PASSWORD` (comparação de tempo
   constante). Se não bater: `401`, mensagem genérica "senha incorreta".
4. Se bater: Worker gera `payloadJson = JSON.stringify({ exp: now + 1 ano em
   segundos })`, depois `sessionToken = base64url(payloadJson) + "." +
   base64url(HMAC-SHA256(payloadJson, SESSION_SECRET))`. Devolve `{ token,
   expiresAt }`.
5. Painel guarda `sessionToken` em `localStorage` (chave própria, ex.
   `fw_session`) e passa a anexá-lo como `Authorization: Bearer
   <sessionToken>` em toda chamada subsequente ao Worker.

Sem "esqueci minha senha" automatizado: se o usuário esquecer a senha, ele
mesmo troca `PANEL_PASSWORD` via `wrangler secret put` ou painel do
Cloudflare (mesmo acesso que já usa para configurar o token real hoje).

## 5. Endpoints do Worker

Baseado no que o `app.js` atual já faz contra `api.github.com` (levantado
lendo o código-fonte atual, não reimplementado do zero):

| Endpoint (Worker) | Requer sessão | Repassa para GitHub |
|---|---|---|
| `POST /login` | não | — |
| `GET /repo/*path` | sim | `GET /repos/OWNER/REPO/contents/*path?ref=master` — restrito a prefixos `config/` e `data/` (allowlist), rejeita qualquer outro caminho (`403`) |
| `POST /dispatch` | sim | `POST /repos/OWNER/REPO/actions/workflows/manage-flights.yml/dispatches` com o mesmo corpo (`ref`, `inputs`) que o painel já monta hoje |

O Worker é deliberadamente um **proxy fino com allowlist de caminho** — não
reimplementa a lógica de negócio (score, recomendação, histórico,
dashboard, assistente determinístico). Essas funções continuam 100% no
painel (`score.mjs`, `history.mjs`, `recommendation.mjs`, `dashboard.mjs`,
`intelligence.mjs`), operando sobre o mesmo JSON que hoje — só muda de quem
o painel pergunta os dados.

## 6. Mudanças no painel (`index.html` / `app.js` / `validation.mjs`)

- `index.html`: formulário de token do GitHub substituído por formulário de
  senha simples (um campo, `type="password"`, sem necessidade de
  autocomplete especial já que agora persiste via `localStorage`).
- `app.js`:
  - `sessionToken` (hoje o token cru do GitHub) vira o token de sessão do
    Worker; passa a ser lido/escrito em `localStorage` no carregamento da
    página.
  - `githubFetch` passa a apontar para o Worker (`WORKER_BASE_URL`) em vez
    de `api.github.com`, e o cabeçalho `Authorization` carrega o token de
    sessão, não mais o PAT.
  - Em qualquer resposta `401` do Worker: limpar o token salvo e voltar
    para a tela de login com aviso "sessão expirada, entre novamente".
  - `looksLikeGitHubToken` (validação de formato do PAT) é removida — não
    faz mais sentido, o painel nunca mais vê um PAT.
- `validation.mjs` / `security.test.mjs`: remover testes de
  `looksLikeGitHubToken`; adicionar testes equivalentes para o novo fluxo
  (ver seção 8).

Nenhuma mudança em `score.mjs`, `history.mjs`, `recommendation.mjs`,
`dashboard.mjs`, `flexible-search.mjs`, `intelligence.mjs` — essas
continuam recebendo os mesmos formatos de dado de sempre.

## 7. Tratamento de erros

- Senha errada → `401` genérico, sem detalhes.
- Rate limiting básico em `/login` (regra nativa do Cloudflare, poucas
  tentativas por minuto por IP) para dificultar força bruta — sem
  implementar um sistema de auth completo.
- Token de sessão ausente, expirado ou com assinatura inválida → `401` em
  qualquer endpoint autenticado.
- Caminho fora do allowlist (`config/`, `data/`) em `GET /repo/*path` →
  `403`, sem repassar para o GitHub.
- Falha ao falar com `api.github.com` (rate limit, instabilidade) → Worker
  repassa status + mensagem curta e sanitizada, nunca o `GITHUB_PAT` nem
  corpo de erro bruto do GitHub.
- Worker inacessível → painel mostra erro de conexão, mesmo padrão de log
  (`showLog`) já usado hoje para outras falhas.

## 8. Testes

- Funções puras de sessão (`createSessionToken`, `verifySessionToken`)
  extraídas para um módulo pequeno e testado com `node --test`, no mesmo
  estilo dos arquivos já existentes em `tests/`:
  - senha certa gera token válido;
  - senha errada é rejeitada;
  - token não expirado é aceito;
  - token expirado é rejeitado;
  - token com assinatura adulterada é rejeitado.
- `security.test.mjs` atualizado: remove os casos de
  `looksLikeGitHubToken`, adiciona casos equivalentes de validação de
  sessão (formato do token, rejeição de token vazio/malformado).
- Antes do deploy real: teste manual local com `wrangler dev` cobrindo
  login → listar voos → adicionar/remover voo de teste → carregar
  histórico.
- CI (`quality.yml`) deste repo continua rodando `node --test
  tests/*.test.mjs` sem mudança de comando (só ganha os novos arquivos de
  teste automaticamente pelo glob).
- Repositório `flight-watcher` (backend Python, cron) **não é afetado** —
  suíte de 170 testes em pytest permanece intocada e fora do escopo desta
  mudança.

## 9. Fora de escopo (YAGNI)

- Troca de senha pela própria UI do painel (feito via `wrangler secret
  put`/dashboard, como já é o fluxo hoje para o PAT).
- Múltiplos usuários/contas — ferramenta pessoal de uma pessoa só.
- Login "Entrar com o Google" (OAuth) — avaliado e descartado nesta rodada
  por exigir configuração desproporcional (projeto no Google Cloud Console,
  tela de consentimento, client ID/secret) para um ganho pequeno frente à
  senha/PIN com sessão persistente de 1 ano.
- "Esqueci minha senha" automatizado.

## 10. Riscos residuais

- Se o `localStorage` do navegador for comprometido (extensão maliciosa,
  acesso físico ao dispositivo desbloqueado), o atacante ganha o token de
  sessão — mas isso só permite as operações restritas do Worker (ler
  `config/`/`data/`, disparar o workflow de gerenciar voos), nunca acesso
  direto e irrestrito ao GitHub. Mitigação: rotacionar `SESSION_SECRET`
  revoga tudo instantaneamente.
- Senha fraca facilita força bruta apesar do rate limiting. Mitigação:
  orientação explícita para usar uma frase-senha longa, não um PIN curto.
