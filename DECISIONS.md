# DECISIONS — log de decisões (ADR-lite)

> Formato: `D-NNN · data · decisão · contexto · rationale · alternativas descartadas`.
> **Regra para agentes futuros:** toda decisão com impacto arquitetural, de segurança, de release ou de direção entra aqui ANTES do PR que a materializa.

---

## D-001 · 2025-09-06 (herdada) · Playwright 1.63.0 pinned

- **Decisão:** versão do Playwright fixada (`1.63.0`) e verificada por gate (`scripts/check-playwright-version.js`).
- **Contexto:** protocolos de percepção dependem de comportamento estável de network/runtime/trace.
- **Rationale:** reproduibilidade — o mesmo código deve produzir a mesma evidência em qualquer ambiente; upgrades são eventos deliberados.
- **Alternativas descartadas:** semver flutuante (^) — quebra reprodutibilidade de evidência.

## D-002 · 2025-09 (herdada, 7.5.0) · URL-only por padrão

- **Decisão:** `--url` puro NÃO analisa o repositório atual; `--project` é opt-in explícito.
- **Rationale:** menor surpresa e menor superfície: auditar um site não deve tocar o disco local além dos artefatos declarados.
- **Alternativas descartadas:** auto-detect de projeto no CWD — comportamento mágico indesejado.

## D-003 · 2025-09 (herdada, 7.5.0) · Fronteira de execução de código fechada

- **Decisão:** nada do projeto alvo é executado sem `--allow-project-commands …`; `shell: true` banido; todo comando executado/bloqueado vai para `result.json#commandAudit`.
- **Rationale:** ferramenta de auditoria não pode virar vetor de execução no alvo que ela audita.
- **Alternativas descartadas:** whitelist implícita de scripts npm comuns — ainda permite surpresas.

## D-004 · 2026-10-10 · Zip de entrega arquivado em tag; git vira fonte da verdade

- **Decisão:** remover `usereye-7.5.1-balanced-Final-por-enquanto.zip` da árvore; conteúdo desempacotado no repo; tag `v7.5.1-zip` marca o commit original do upload.
- **Contexto:** repo tinha 1 commit e 1 arquivo binário de 900 KB.
- **Rationale:** binário na árvore impede diff/PR/review; o conteúdo está integralmente no repo; releases futuros usarão GitHub Releases (anexo de tarball gerado por `pack:npm`).
- **Alternativas descartadas:** manter o zip "por garantia" — git history + tag cumprem o mesmo papel sem custo.

## D-005 · 2026-10-10 · Layout do repositório

- **Decisão:** `src/usereye/` (pacote npm auto-contido, com seus próprios testes/docs) · `demo/` (harness, não publicado) · `docs/` (repositório: pesquisa, prioridades, índice) · `tests/` (relatórios E2E reais + script) · `scripts/` (bootstrap) · docs de entrega (`CURRENT.md`, `DELIVERY.md`) na raiz.
- **Rationale:** convenção amplamente reconhecida (`src/`); o pacote continua publicável intacto (`files` do package.json relativo a si mesmo); separa "produto" de "evidência de validação".
- **Alternativas descartadas:** (a) mover docs do produto para `docs/` da raiz — quebraria `files` do npm e ~30 links internos; (b) repo monorepo com workspaces — over-engineering para 1 pacote.

## D-006 · 2026-10-10 · Metadados npm NÃO adicionados agora

- **Decisão:** não preencher `repository/homepage/bugs` do `package.json` nesta reorganização.
- **Contexto:** política existente do projeto (README do pacote): adicionar remote real + homepage + bugs **no mesmo commit que publica**; `check-delivery-names.js` falha o release se apontarem para URL morta.
- **Rationale:** link morto é pior que link ausente; o remote atual (conta pessoal) pode mudar antes do M1.
- **Alternativas descartadas:** preencher agora e corrigir depois — viola a política e o gate.

## D-007 · 2026-10-10 · Governança documental

- **Decisão:** `ROADMAP.md` permanente na raiz com revisão trimestral obrigatória; `DECISIONS.md` (este arquivo) como log append-only; `MISSION.md` como página de entrada; relatórios de teste **reais** em `tests/`.
- **Rationale:** continuidade para agentes futuros: direção (roadmap), histórico (decisões), entrada rápida (mission) e evidência (testes) em locais previsíveis.
- **Alternativas descartadas:** wiki do GitHub — menos versionado e menos visível em PRs.

## D-008 · 2026-10-10 · Browsers de validação: Chromium + Firefox

- **Decisão:** validar E2E em Chromium (headless shell 153) e Firefox 155 neste ambiente; WebKit fica best-effort/CI.
- **Contexto:** sandbox sem privilégios de sistema; ambos os browsers do Playwright rodaram sem `install-deps`.
- **Rationale:** cobre os 2 engines dominantes; a suíte própria já pula firefox/webkit ausentes de forma honesta (skip, não fail).
- **Alternativas descartadas:** insistir em WebKit no sandbox — custo alto, valor marginal agora; M1 coloca webkit na matriz de CI se viável.

## D-009 · 2026-10-10 · Protocolo de browser: permanecer no Playwright (não migrar p/ WebDriver BiDi)

- **Decisão:** continuar sobre Playwright; monitorar WebDriver BiDi (W3C) trimestralmente.
- **Contexto:** pesquisa de 2026-10-10 — BiDi ainda não cobre tudo que o engine usa (tracing, permissions, CDP-specific probes); Puppeteer usa BiDi p/ Firefox, Selenium empurra a spec.
- **Rationale:** custo de reescrita alto vs. ganho hoje zero (Playwright já dá cross-browser); reavaliar no M6 (out/2027) ou antes se BiDi atingir paridade de features usadas.
- **Alternativas descartadas:** camada de abstração dupla (CDP+BiDi) agora — complexidade sem demanda real.

## D-010 · 2026-10-10 · Pesquisa e issues como artefatos versionados

- **Decisão:** a pesquisa profunda de mercado/tecnologia de 2026-10-10 vive em `docs/RESEARCH-2026-10.md`; prioridades dela viraram issues #1–#8 e o resumo está no §4 do ROADMAP.
- **Rationale:** pesquisa que não vira issue nem doc morre no chat; versionada, ela é auditável e reutilizável na revisão trimestral.
- **Alternativas descartadas:** só issues sem doc — perde contexto e fontes.
