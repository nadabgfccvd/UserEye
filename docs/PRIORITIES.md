# Prioridades e issues — derivadas da pesquisa de out/2026

> Fonte de análise: [`RESEARCH-2026-10.md`](RESEARCH-2026-10.md). Issues em <https://github.com/nadabgfccvd/UserEye/issues>.
> Regra: issue sem marco é sinal de roadmap desatualizado; marco sem issue é sinal de roadmap fantasma.

## Abertas (criadas em 2026-10-10)

| # | Issue | Prioridade | Marco | Fonte |
|---|-------|-----------|-------|-------|
| [#1](https://github.com/nadabgfccvd/UserEye/issues/1) | CI — GitHub Actions, matriz Node 20/22/24 + lint | **P0** | M1 (2026-11-30) | Governança de evidência |
| [#2](https://github.com/nadabgfccvd/UserEye/issues/2) | Publicar no npm + metadados + SARIF no code scanning | **P0** | M2 (2026-12-31) | §5 SARIF single-run |
| [#3](https://github.com/nadabgfccvd/UserEye/issues/3) | Registry de benchmarks de latência/memória em CI | P1 | M3 (2027-01-31) | §3 benchmarks, §4 flakiness |
| [#4](https://github.com/nadabgfccvd/UserEye/issues/4) | MCP server alpha para agentes de IA | P1 | M5 (2027-03-31), GA em M6 (2027-04-30) | §5 tendências IA |
| [#5](https://github.com/nadabgfccvd/UserEye/issues/5) | Regressão visual local-first (review-mode visual) | P2 | M7 (2027-05-31) | §1 Percy |
| [#6](https://github.com/nadabgfccvd/UserEye/issues/6) | Mapeamento WCAG 2.2 AA no a11y-strict | P2 | M8 (2027-06-30) | §5 a11y |
| [#7](https://github.com/nadabgfccvd/UserEye/issues/7) | Matriz de browsers em CI (Firefox) + install-deps | P1 | M4 (2027-02-28) | Relatório de testes |
| [#8](https://github.com/nadabgfccvd/UserEye/issues/8) | Docs: arquitetura vs Cypress (multi-tab/cross-origin) | P3 | M9 (2027-07-31) | §1 prior-art |

## Critério de priorização

- **P0** — destrava tudo (CI é pré-requisito de publicação e de confiança em PRs de agentes).
- **P1** — diferencial defensável ou demanda do mercado 2026 (benchmarks = credibilidade; MCP = distribuição; Firefox = cobertura).
- **P2/P3** — valor real, sem urgência externa.

## Backlog não-triado (observações de pesquisa sem issue ainda)

- Plugin de comparação semântica estilo Visual AI (Applitools) — aguardar demanda; `plugins.js` já suporta.
- Upload SARIF multi-categoria: consolidar antes do M2 (risco técnico mapeado na pesquisa §6.4).
- Suporte a login/SSO como protocolo first-class no modo URL-only (hoje exige storage-state).
