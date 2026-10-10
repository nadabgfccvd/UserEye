# ROADMAP — UserEye

> **Este arquivo vive permanentemente na raiz do repo.** Futuros agentes: leia antes de trabalhar.
> Ao modificar: atualize `Última revisão`, vincule issues, registre decisões em [`DECISIONS.md`](DECISIONS.md).

**Última revisão:** 2026-10-10 (revisão inaugural, pós-reorganização do repositório)
**Próxima revisão agendada:** 2027-01-10 (trimestral)

---

## 1. Visão

**Ser a ferramenta open-source de referência para percepção de UI como um usuário real:** abrir qualquer aplicação web sem acesso ao código-fonte, enxergar o que o usuário enxerga (zoom, contraste, layout, consentimento), explorar caminhos com segurança comprovada, e entregar evidência reproduzível (HTML/MD/JSON/trace/vídeo/SARIF) que um humano consegue revisar em minutos.

Princípios não negociáveis (herdados das auditorias 7.5.x):

1. **Fronteira de execução fechada** — o motor nunca executa código do projeto alvo sem autorização explícita (`--allow-project-commands`); `shell: true` permanece banido.
2. **Segurança exploratória** — sem escritas, sem ações destrutivas, sem downloads por padrão.
3. **Evidência honesta** — nenhum número digitado à mão; gates reescrevem métricas de execuções reais.
4. **Agnóstico de projeto** — zero nomes de produto/rotas/credenciais no motor; política fica no repositório alvo (`usereye.config.*`).
5. **Contrato de saída estável** — `0 | 1 | 2` (ok | falha de gates | erro de uso).

## 2. Objetivos a 12 meses (out/2026 → out/2027)

| # | Objetivo | Métrica de sucesso |
|---|----------|--------------------|
| O1 | **Publicar o pacote** (`usereye` no npm) + pipeline de release com SARIF no GitHub code scanning | `npm install usereye` funciona; SARIF aparece na aba Security |
| O2 | **Interface para agentes de IA (MCP)** — expor `auto/observe/analyze` como tools do Model Context Protocol | Um agente externo roda uma auditoria completa via MCP |
| O3 | **Registry de benchmarks de performance** — latência e memória do motor medidos em CI, com baseline versionado | Benchmarks rodam em cada PR; regressão >10% falha o gate |
| O4 | **Regressão visual local-first** (estilo Percy, mas sem SaaS) como review-mode opcional | DOM/screenshot diff integrado ao relatório, opt-in |
| O5 | **Acessibilidade WCAG 2.2 AA** — mapeamento explícito regra→critério no modo `a11y-strict` | 100% das regras axe-core usadas mapeadas; doc de cobertura |
| O6 | **Matriz de browsers em CI** — chromium + firefox (e webkit best-effort) por PR | CI roda a suíte nos 2 browsers principais |

## 3. Marcos com datas alvo

| Marco | Data alvo | Escopo | Issues |
|-------|-----------|--------|--------|
| **M0 — Repo organizado** | ✅ 2026-10-10 | Estrutura src/docs/tests/scripts, zip arquivado em tag, roadmap/mission/decisions, relatório de testes real | — |
| **M1 — Publicação + CI** | 2026-11-30 | GitHub Actions (test matrix 20/22/24), `npm publish`, metadados `repository/homepage/bugs` no mesmo commit (política existente), upload SARIF | #1 #2 |
| **M2 — Benchmark registry** | 2027-01-31 | `docs/BENCHMARKS.md` + job de CI medindo latência/memória contra baseline (`tests/benchmarks/quick-baseline.json` já existe) | #3 |
| **M3 — MCP server alpha** | 2027-03-31 | `usereye-mcp` expondo auto/observe/analyze; transporte stdio + HTTP | #4 |
| **M4 — Visual regression local-first** | 2027-06-30 | Review-mode `visual`: DOM snapshot + screenshot diff, thresholds configuráveis, integrado ao `report.md/html` | #5 |
| **M5 — WCAG 2.2 AA mapping** | 2027-09-30 | Tabela regra→critério→técnica em `HEURISTICS.md`; touch target size e focus appearance explícitos | #6 |
| **M6 — Revisão anual** | 2027-10-10 | Retro do roadmap, nova pesquisa de mercado, replanejamento 12 meses | — |

Datas são alvos, não promessas; qualquer slip registra decisão em `DECISIONS.md`.

## 4. Áreas de pesquisa

### 4.1 Tendências do setor (pesquisa de 2026-10-10)

- **Testes exploratórios autônomos viraram categoria.** Ferramentas comerciais (Autonoma, QAeverest, Explorbot — open source) fazem login, crawleiam e geram fluxos Gherkin automaticamente. O diferencial do UserEye: *evidência auditável + fronteira de execução* — concorrentes raramente mostram o que o agente tocou.
- **IA agêntica como consumidor de ferramentas.** O Model Context Protocol (doado à Linux Foundation em dez/2025) padronizou como agentes usam ferramentas. Ser "MCP-native" vira requisito de distribuição, não feature. (M3)
- **WCAG 2.2 AA é o novo piso global** (Test Guild 2026): ferramentas 2026 se apoiam em axe-core + screen readers. axe-core 4.5+ já cobre touch target size e focus appearance.
- **Flakiness é a dor #1** (lit. acadêmica e industrial): race conditions lideram as causas; wait explícito/network-idle e detecção por re-runs são as práticas padrão. O engine de paciência/misclick do UserEye ataca exatamente isso — documentar e medir é oportunidade.

### 4.2 Projetos similares (prior-art)

| Projeto | Modelo | Onde UserEye é diferente |
|---------|--------|--------------------------|
| **Playwright** | framework de automação dirigido por testes escritos | UserEye é *não-dirigido*: explora sozinho, acima do Playwright, e produz julgamento de qualidade (gates), não só pass/fail de steps |
| **Cypress** | runner in-browser, single-origin | Cypress roda **dentro** do browser: sem multi-tab, cross-origin restrito. UserEye usa Playwright out-of-process: multi-tab, iframes, origins múltiplas sem hacks |
| **Percy (BrowserStack)** | visual testing SaaS: captura **DOM snapshots**, renderiza determinístico, compara entre browsers/larguras | Percy exige serviço cloud + baselines remotos. M4 é o equivalente local-first: diff offline, sem enviar DOM a terceiros |
| **Applitools** | Visual AI (comparação semântica) | Fora de escopo para o core; um dia pode virar plugin via `plugins.js` |
| **Explorbot / Autonoma / QAeverest** | exploração autônoma com IA, gera testes | UserEye não gera testes — audita estado atual com evidência; IA entra como *cliente* via MCP (M3), não como motor |

### 4.3 Tecnologias emergentes a monitorar (trimestral)

- **WebDriver BiDi (W3C):** cross-browser bidirecional; Puppeteer já usa para Firefox; Selenium empurra. Playwright mantém protocolo próprio para FF/WebKit. **Decisão hoje: ficar no Playwright** (evita reescrita; BiDi ainda não cobre tudo que o engine usa). Reavaliar no M6.
- **Chrome DevTools Protocol:** continue sendo o "control surface" do Chromium; UserEye já usa via Playwright (network, runtime, tracing) — nada a migrar.
- **Core Web Vitals 2026:** LCP ≤ 2,5 s · INP ≤ 200 ms · CLS ≤ 0,1 são os thresholds "good" publicados (web.dev/Google). Alinhar `first-impression`/vitals a esses números explícitos no relatório (part of M2/M5).
- **SARIF 2.1.0** no GitHub code scanning — nota: desde jul/2025 o GitHub não combina múltiplos SARIF do mesmo tool+category; upload único por execução.

### 4.4 Estudos de falhas comuns de UI (base para heurísticas)

| Falha | Evidência/probe atual | Gap → issue |
|-------|----------------------|-------------|
| **Layout shift (CLS)** | protocolo `first-impression`, vitals | Medir CLS explícito e reportar com threshold 0,1 (#3/#6) |
| **Imagens quebradas** | protocolo `broken-media` ✅ (validado no controle negativo) | — |
| **Race conditions/flaky** | `patience.js`, `misclick-engine.js`, retries de navegação | Telemetria de retris exposta no relatório (#3) |
| **Contaste/bloqueio visual** | heurísticas axe + visual adaptation ✅ (validado) | — |
| **Zoom 200% / touch target** | protocolos `zoom-200`, `touch-pointer` ✅ | Mapear a WCAG 2.2 (#6) |

## 5. Decisões vigentes (resumo)

Ver [`DECISIONS.md`](DECISIONS.md) para o log completo com rationale.

- Playwright 1.63.0 pinned; migração de versão é evento deliberado com suite verde.
- `--url` puro não analisa o projeto (opt-in via `--project`).
- Fronteira de execução de código fechada por padrão; auditoria em `commandAudit`.
- Metadados npm (`repository/homepage/bugs`) só no commit de publicação.
- Repo organizado em `src/usereye` + `demo/` + `tests/` + `scripts/`; zip 7.5.1 arquivado na tag `v7.5.1-zip`.

## 6. Governance

1. **Revisão trimestral** (jan/abr/jul/out): marcos, pesquisa, prioridades. Registrar em `Última revisão` + `DECISIONS.md`.
2. Todo marco tem **issue vinculada**; issue fechada sem marco entregue = regressão de escopo a documentar.
3. Mudanças de princípio (§1) exigem decisão formal em `DECISIONS.md` com alternativas.
4. Pesquisa de mercado (§4.2) re-feita a cada revisão trimestral — concorrência autônoma com IA evolui rápido.
