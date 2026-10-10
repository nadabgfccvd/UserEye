# Pesquisa profunda — out/2026 (mercado, prior-art, tecnologia)

> Pesquisa realizada em **2026-10-10** via busca web (fontes listadas por seção).
> Destino das conclusões: issues #1–#8 e ROADMAP.md §4. Revisar na governança trimestral.

---

## 1. Prior-art: comparação com Playwright, Cypress e Percy

### Playwright (Microsoft)
- Multi-engine nativo (Chromium, Firefox, WebKit) com protocolo próprio para FF/WebKit; CDP por baixo no Chromium.
- Em micro-benchmarks publicados: cenário E2E completo em ~4,5 s vs ~4,8 s do Puppeteer (~5–6% mais rápido no caso testado); outras medições apontam Puppeteer 15–20% mais rápido em scraping puro no Chromium — para *auditoria* multi-protocolo, a vantagem do Playwright é o modelo de eventos e o trace integrado.
- Eficiência de protocolo citada: Playwright emite 43–46 mensagens vs 318–320 do Puppeteer no mesmo fluxo (arquitetura com menos round-trips).
- **Posição do UserEye:** camada acima — exploração não-dirigida, julgamento de qualidade (gates), evidência. Não compete, usa.

### Cypress
- Roda **dentro** do browser (runner in-browser): debug ao vivo e auto-waits, mas **sem multi-tab nativo** e cross-origin/multi-domínio restrito (requer proxy/`web security` desligado em cenários difíceis — documentação oficial reconhece a limitação).
- **Implicação para UserEye:** a arquitetura out-of-process (Playwright) já dá multi-tab, sessões simultâneas e origins múltiplas — vantagem arquitetural a comunicar no README/landing.

### Percy (BrowserStack) e visual testing
- Percy captura **DOM snapshots** (não screenshots crus), renderiza de forma determinística e compara entre browsers/larguras; review workflow SaaS.
- Boas práticas de mercado (Percy/Applitools/Argos 2026): capturar **páginas e estados críticos** (não tudo), esconder conteúdo dinâmico (timestamps/ads), dados de teste consistentes, baselines por PR.
- **Implicação para UserEye (M4):** regressão visual local-first com diff de DOM+screenshot, opt-in via review-mode; diferencial: nada sai da máquina do usuário.

Fontes: docs.cypress.io (cross-origin), webfuse.com (comparação honesta E2E), percy.io/how-it-works, browserstack.com/percy, argos-ci.com (guia 2026), applitools.com, tech-insider.org e lightpanda.io (benchmarks), gologin.com (mensagens de protocolo), skyvern.com.

## 2. Automação de browser: W3C WebDriver e Chrome DevTools Protocol

- **CDP** (chromedevtools.github.io): superfície de controle do Chromium — instrumentação por domínios (DOM, Network, Runtime, Input, Tracing). "Não foi desenhado para automação, mas acabou alimentando todas as bibliotecas principais" (lightpanda deep-dive). UserEye consome via Playwright: sem ação necessária.
- **WebDriver BiDi (W3C):** padrão bidirecional cross-browser; Selenium começou a contribuir em 2020; Puppeteer já controla Firefox via BiDi; Playwright mantém protocolo próprio. Status: nenhum dos dois cobre 100% das features que UserEye usa (tracing, permissões, probes CDP-específicos).
- **Decisão registrada:** permanecer no Playwright (DECISIONS.md D-009), reavaliar na revisão anual ou se BiDi atingir paridade.

Fontes: chromedevtools.github.io, browserbase.com (CDP explicado), lightpanda.io ×2, browser-use.com, firecrawl.dev, olostep.com, news.ycombinator.com (thread Selenium/BiDi).

## 3. Registry de benchmarks (latência, memória)

Números públicos relevantes (2025–2026) para calibrar nosso registry:

| Métrica | Valor de referência | Fonte |
|---|---|---|
| Cenário E2E típico (Playwright) | ~4,5 s (vs 4,8 s Puppeteer) | tech-insider.org, jun/2026 |
| Scraping puro Chromium | Puppeteer 15–20% mais rápido | lightpanda.io, nov/2025 |
| Mensagens de protocolo no mesmo fluxo | PW 43–46 vs PP 318–320 | gologin.com, set/2026 |
| RAM por browser headless | ~200–600 MB por instância | fastcrw.com, 2026 |
| Startup micro-benchmark | Puppeteer marginalmente mais rápido em scripts de 1 ação | olostep.com, jun/2026 |

**Baseline próprio:** o repo já tem `tests/benchmark.test.js` e `tests/benchmarks/quick-baseline.json` (execução local do UserEye em modo quick). Ação M2 (issue #3): transformar em job de CI com arquivo de baseline versionado e gate de regressão (falha se piorar >10% em latência média ou pico de memória), documentado em `docs/BENCHMARKS.md` com máquina/versões fixadas.

## 4. Estudos de falhas comuns de UI

### Layout shift / Core Web Vitals (thresholds oficiais vigentes)
- **Bom:** LCP ≤ 2,5 s · **INP ≤ 200 ms** · **CLS ≤ 0,1** (Google/web.dev; confirmado em guias 2026).
- Web Almanac 2025: apenas ~62% das páginas mobile atingem LCP "bom" — layout/lazy-loading continuam sendo a dor #1.
- **Ação:** reportar CLS/INP/LCP medidos com esses thresholds explícitos no relatório (issues #3/#6).

### Imagens quebradas
- Probe `broken-media` do UserEye já detecta; **validado empiricamente** no controle negativo de 2026-10-10 (ver test report §4): imagem quebrada → "Visible images failed to load" (major).

### Race conditions / flakiness
- Literatura converge: **race conditions são a causa #1 de flaky tests** (dev.to/out/2025; ScienceDirect/Tahir 2023 — rerun-based detection é o método mais comum de detecção).
- Causas recorrentes: race conditions, estado vazado entre testes, dependência de rede, aleatoriedade, sleeps fixos.
- **Ação:** expor telemetria de retries/espera do engine (patience.js, misclick-engine) no relatório — transforma "o tool esperou X ms" em evidência auditável (issue #3; partes já existem em `patience-report.json`).

Fontes: developers.google.com/search/docs (CWV), web.dev (metodologia dos thresholds), corewebvitals.io (Web Almanac 2025), nitropack.io, yassersoliman.com, dev.to, sciencedirect.com, trunk.io, codewithjason.com, testgrid.io.

## 5. Tendências: IA agêntica e exploração autônoma

- **MCP doado à Linux Foundation (dez/2025)** via Agentic AI Foundation — virou padrão de fato para conectar agentes a ferramentas. Ferramentas de QA que expõem MCP (ex.: Playwright MCP) ganham distribuição instantânea em IDEs/agentes.
- **Categoria "autonomous exploratory testing" consolidada em 2026:** Autonoma, QAeverest, Explorbot (open-source) — login automático, crawl, geração de Gherkin. Nenhum destaca evidência auditável ou fronteira de execução — o posicionamento do UserEye.
- **SARIF + GitHub code scanning:** SARIF 2.1.0 é o formato de upload; desde jul/2025 o GitHub não combina múltiplos SARIF do mesmo tool+category — 1 execução = 1 upload (afeta desenho do pipeline M1).
- **A11y:** WCAG 2.2 AA é o piso global de 2026; tooling real = axe-core + screen reader; axe-core 4.5+ cobre regras novas (touch target size, focus appearance). UserEye já usa axe — M5 é mapear regra→critério no modo strict.

Fontes: anthropic.com, modelcontextprotocol.io, en.wikipedia.org (MCP), stackoverflow.blog, qaeverest.ai, getautonoma.com, testomat.io (Explorbot), atlassian.com/virtuosoqa.com/minitap.ai (exploratory), docs.github.com + github.blog + learn.microsoft.com (SARIF), testguild.com (a11y 2026), deque.com (axe-core/WCAG 2.2), playwright.dev (a11y testing).

## 6. Riscos identificados na pesquisa

1. **Comoditização:** Playwright MCP + agentes genéricos podem "chupar" o caso de uso de auditoria simples → resposta: evidência auditável + gates + i18n como fosso.
2. **Dependência de versão do Playwright:** pin alto (D-001) protege, mas atrasa features novas → janela de upgrade trimestral.
3. **WebKit no sandbox sem sudo:** exigirá `install-deps` (root) ou imagem CI — documentado no M1.
4. **SARIF single-run:** pipeline precisa consolidar resultados em 1 arquivo por categoria antes do upload.
