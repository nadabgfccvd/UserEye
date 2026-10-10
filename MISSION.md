# MISSION — UserEye

> Para quem chega agora (humano ou agente): este é o resumo de 1 página. Detalhes em [`ROADMAP.md`](ROADMAP.md).

## Missão

**Tornar a qualidade de UI verificável por evidência, não por opinião.** O UserEye simula um usuário real dentro de um browser, enxerga o que ele enxerga (zoom, contraste, consentimento, imagens quebradas, controles sobrepostos), explora a aplicação com segurança comprovada e entrega um dossiê reproduzível — HTML, Markdown, JSON, trace, vídeo, SARIF — que qualquer pessoa (ou agente de IA) consegue auditar.

## O que o UserEye é hoje (2026-10-10)

- **v7.5.1**, pacote npm auto-contido em `src/usereye/`, MIT, Node >= 20.11, Playwright 1.63.0.
- **446 testes próprios** (442 pass, 4 skip) + validação E2E real: **100/100 de qualidade** no site demo Vela em **Chromium e Firefox**, e **captura correta de 10 falhas plantadas** (imagens quebradas, contraste, sobreposição, lang/title ausentes) com vídeo+trace preservados — ver [`tests/usereye_test_report.md`](tests/usereye_test_report.md).
- 26 protocolos de percepção (teclado, touch, zoom, PWA, offline, websocket, consent-wall, dark-mode, impressão…), misclick engine, gates de qualidade, i18n en/pt/es/fr, SARIF, dashboard, plugins.
- Auditoria independente: **9.3/10** (documentada em `src/usereye/docs/AUDITS.md`).

## Estado do repositório (reorganizado em 2026-10-10)

- Layout convencional: `src/usereye/` (pacote) · `demo/` (harness) · `docs/` (repositório) · `tests/` (relatórios reais) · `scripts/`.
- Zip de entrega arquivado na tag `v7.5.1-zip`; git passou a ser a fonte da verdade.
- Roadmap permanente na raiz com marcos M0–M12 (cadência mensal) e governança trimestral anexada aos marcos de fim de trimestre.

## Próximas ações (na ordem)

1. **M1 (30/nov/2026):** GitHub Actions com matriz Node 20/22/24 — issue #1.
2. **M2 (31/dez/2026):** publicação npm + metadados + SARIF no code scanning — issue #2.
3. **M3 (31/jan/2027):** registry de benchmarks de latência/memória em CI — issue #3.
4. **M4 (28/fev/2027):** Firefox na matriz de CI — issue #7.
5. **M5–M6 (mar–abr/2027):** MCP server alpha → GA para agentes de IA — issue #4.
6. Depois: regressão visual local-first (M7/#5), WCAG 2.2 AA mapping (M8/#6), posicionamento (M9/#8), performance (M10), plugins (M11), revisão anual (M12).

O roadmap completo (M0–M12, critérios de aceite, dependências) está em [`ROADMAP.md`](ROADMAP.md).

## Como um agente futuro deve trabalhar aqui

1. Leia `ROADMAP.md` (raiz) e `DECISIONS.md` antes de qualquer mudança.
2. Rode `npm test` em `src/usereye/` — nada mergea vermelho.
3. Registre toda decisão com impacto arquitetural em `DECISIONS.md` (data + rationale).
4. Mantenha a promessa de evidência honesta: nenhum número de teste digitado à mão.
5. Revisão trimestral do roadmap: atualize data, marque e revise pesquisa de concorrência.
