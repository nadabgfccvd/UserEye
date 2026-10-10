# Contributing — UserEye

Obrigado por contribuir! Regras curtas, atualizadas em 2026-10-10 junto com a reorganização do repo.

## Antes de codar

1. Leia [`MISSION.md`](MISSION.md) (1 página) e [`ROADMAP.md`](ROADMAP.md) (direção + marcos).
2. Verifique se já existe issue para o tema; se não, abra uma antes de PR grande.
3. Decisões com impacto arquitetural: proponha em issue; ao aprovar, registre em [`DECISIONS.md`](DECISIONS.md) (data + rationale + alternativas).

## Setup

```bash
git clone https://github.com/nadabgfccvd/UserEye.git
cd UserEye && ./scripts/bootstrap.sh
```

O bootstrap roda `npm ci`, instala o Chromium do Playwright, roda `doctor` e a suíte completa.

## Regras de código

- **Contrato de saída:** `0 | 1 | 2` (ok | gates falharam | erro de uso). Nunca mude sem decisão registrada.
- **Fronteira de execução:** nada executa código do projeto alvo sem `--allow-project-commands`; `shell: true` é banido. Testes de fronteira (`tests/code-execution-boundary.test.js`) devem continuar verdes.
- **Evidência honesta:** números de teste/versão em docs de entrega vêm de `npm run verify:delivery` — nunca digitados à mão (o gate reprova).
- **i18n:** strings novas precisam das 4 locales (en/pt/es/fr) — gates de governança cobrem.
- Estilo: `npm run lint` e `npm run format:check` obrigatórios; types: `npm run typecheck`.

## Testes

```bash
cd src/usereye
npm test                 # suíte completa (446)
npm run test:smoke       # rápido
../../tests/e2e-run.sh   # E2E real contra o demo + controle negativo
```

Nada mergea com `npm test` vermelho. Mudanças em protocolos/heurísticas exigem teste novo cobrindo o comportamento.

## Commits e PRs

- Um PR = uma preocupação. Mensagens no formato `area: o que muda` (ex.: `protocols: ajusta zoom-200 para iframes`).
- PRs atualizam, quando aplicável: `CHANGELOG.md` do pacote, docs afetadas, `ROADMAP.md` (se mexe em marco) e `DECISIONS.md` (se decisão).
- O revisor deve conseguir reproduzir sua evidência: inclua comandos executados.

## Revisão trimestral (para mantenedores e agentes)

- Revisar [`ROADMAP.md`](ROADMAP.md): marcos, pesquisa (§4), issues vinculadas.
- Re-executar a pesquisa de concorrência (§4.2) — a categoria "exploração autônoma com IA" evolui rápido.
- Atualizar `Última revisão` no topo do roadmap e registrar a revisão em `DECISIONS.md`.
