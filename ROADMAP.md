# ROADMAP — UserEye

> **Este arquivo vive permanentemente na raiz do repo.** Futuros agentes: leia antes de trabalhar.
> Ao modificar: atualize `Última revisão`, vincule issues, registre decisões em [`DECISIONS.md`](DECISIONS.md).

**Última revisão:** 2026-10-10 (revisão 2 — expansão da tabela de marcos para M0–M12, cadência mensal)
**Revisão anterior:** 2026-10-10 (revisão inaugural, pós-reorganização do repositório)
**Próxima revisão agendada:** 2027-01-10 (trimestral — anexada ao marco M3)

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

| # | Objetivo | Métrica de sucesso | Marcos |
|---|----------|--------------------|--------|
| O1 | **Publicar o pacote** (`usereye` no npm) com pipeline de release e SARIF no GitHub code scanning | `npm install usereye` funciona; SARIF aparece na aba Security | M1, M2 |
| O2 | **Interface para agentes de IA (MCP)** — expor `auto/observe/analyze` como tools do Model Context Protocol | Um agente externo roda uma auditoria completa via MCP; transporte stdio + HTTP | M5, M6 |
| O3 | **Registry de benchmarks de performance** — latência e memória do motor medidos em CI, com baseline versionado | Benchmarks rodam em cada PR; regressão >10% falha o gate | M3 |
| O4 | **Regressão visual local-first** (estilo Percy, mas sem SaaS) como review-mode opcional | DOM/screenshot diff integrado ao relatório, opt-in | M7 |
| O5 | **Acessibilidade WCAG 2.2 AA** — mapeamento explícito regra→critério no modo `a11y-strict` | 100% das regras axe-core usadas mapeadas; doc de cobertura | M8 |
| O6 | **Matriz de browsers em CI** — chromium + firefox (e webkit best-effort) por PR | CI roda a suíte nos 2 browsers principais por PR | M4 |
| O7 | **Performance e escala do motor** — paralelização de protocolos e custo de artefatos sob controle | Soak test em app grande (100+ páginas) sem degradação >10%; P95 de latência por protocolo documentado | M10 |
| O8 | **Ecossistema de plugins** — API de hooks estável e comunidade | ≥3 plugins de exemplo publicados; guia de autoria; API versionada com contrato de compatibilidade | M11 |

## 3. Marcos com datas alvo (M0 → M12)

> Cadência: ~1 marco/mês. Cada fim de trimestre (M3, M6, M9, M12) carrega a **revisão trimestral** de governança.
> Datas são alvos, não promessas; qualquer slip registra decisão em `DECISIONS.md` no mesmo dia.

| Marco | Data alvo | Escopo | Critério de aceite | Issues |
|-------|-----------|--------|--------------------|--------|
| **M0 — Repo organizado** | ✅ 2026-10-10 | Estrutura src/docs/tests/scripts, zip arquivado em tag `v7.5.1-zip`, roadmap/mission/decisions, relatório de testes real (446/442/0/4; E2E 100/100 Chromium+Firefox; controle negativo 10 issues) | Repo navegável por agente novo em <10 min | — |
| **M1 — CI (GitHub Actions)** | 2026-11-30 | Workflow com matriz Node 20/22/24; `npm run verify` completo por PR; cache do Playwright; badge no README | PR vermelho impede merge; badge visível | #1 |
| **M2 — Publicação npm + SARIF** | 2026-12-31 | `npm publish`; metadados `repository/homepage/bugs` no MESMO commit (política D-006); upload SARIF 2.1.0 (1 arquivo por tool+category) | `npm install usereye` funciona; findings na aba Security | #2 |
| **M3 — Benchmark registry** 🔍 trimestral | 2027-01-31 | `docs/BENCHMARKS.md`; job de CI medindo latência média e pico de RAM contra baseline versionado; telemetria de retries/espera exposta no relatório | Gate falha com regressão >10%; baseline commitado | #3 |
| **M4 — Matriz de browsers** | 2027-02-28 | Firefox no CI por PR (#7); WebKit best-effort com `install-deps` documentado; relatório de compat por engine | Suíte + E2E quick rodam em chromium e firefox no CI | #7 |
| **M5 — MCP server alpha** | 2027-03-31 | `usereye-mcp` expondo `auto`/`observe`/`analyze` via stdio; resposta = resumo + caminho de artefatos (nunca binário); fronteiras de execução herdadas (D-003) | Um agente externo completa uma auditoria via MCP | #4 |
| **M6 — MCP GA + integrações** 🔍 trimestral | 2027-04-30 | Transporte HTTP além de stdio; docs e exemplo end-to-end com agente real; tratamento de execução longa (timeout/progresso) | MCP documentado como canal suportado no README do produto | #4 |
| **M7 — Regressão visual local-first** | 2027-05-31 | Review-mode `visual`: DOM snapshot determinístico + diff de screenshot, thresholds configuráveis, integração com `report.md/html` e dashboard; baselines por commit | Diff local sem SaaS; falsos positivos mascaráveis (conteúdo dinâmico) | #5 |
| **M8 — WCAG 2.2 AA mapping** 🔍 trimestral | 2027-06-30 | Tabela regra→critério→técnica em `HEURISTICS.md`; touch target size e focus appearance explícitos; thresholds Core Web Vitals (LCP≤2,5s · INP≤200ms · CLS≤0,1) citados no relatório | 100% das regras axe usadas mapeadas; findings a11y citam critério WCAG | #6 |
| **M9 — Posicionamento e descoberta** | 2027-07-31 | Seção "How it compares" honesta no README do produto (#8: multi-tab/cross-origin vs Cypress); landing/docs em GitHub Pages; guia de quick-start por persona (dev, QA, agente de IA) | Landing publicada; comparativo revisado por par | #8 |
| **M10 — Performance e escala** | 2027-08-31 | Paralelização de protocolos (`parallel-scheduler.js`) com workers ajustáveis; soak test contra app grande; política de artefatos (`keepLast`, limites de bytes) afinada | Soak 100+ páginas sem degradação >10%; P95 por protocolo documentado | — |
| **M11 — Ecossistema de plugins** | 2027-09-30 | API de hooks (`plugins.js`) estável e versionada; ≥3 plugins de exemplo; guia de autoria/publicação; contrato de compatibilidade por versão | 3 exemplos rodando em CI; guia publicado | — |
| **M12 — Revisão anual + horizonte 2028** 🔍 trimestral + anual | 2027-10-10 | Retro do ano; nova pesquisa de mercado (concorrência IA evoluiu); reavaliação da decisão BiDi (D-009); replanejamento M13–M24 | Novo roadmap 12 meses publicado na raiz | — |

**Dependências críticas:** M2 depende de M1 (publicar sem CI = release às cegas); M6 depende de M5; M10 e M11 podem ser reordenados entre si sem impacto (decidir na revisão de jul/2027); M12 nunca desliza (âncora anual).

## 4. Áreas de pesquisa

### 4.1 Tendências do setor (pesquisa de 2026-10-10)

- **Testes exploratórios autônomos viraram categoria.** Ferramentas comerciais (Autonoma, QAeverest, Explorbot — open source) fazem login, crawleiam e geram fluxos Gherkin automaticamente. O diferencial do UserEye: *evidência auditável + fronteira de execução* — concorrentes raramente mostram o que o agente tocou.
- **IA agêntica como consumidor de ferramentas.** O Model Context Protocol (doado à Linux Foundation em dez/2025) padronizou como agentes usam ferramentas. Ser "MCP-native" vira requisito de distribuição, não feature. (M5–M6)
- **WCAG 2.2 AA é o novo piso global** (Test Guild 2026): ferramentas 2026 se apoiam em axe-core + screen readers. axe-core 4.5+ já cobre touch target size e focus appearance. (M8)
- **Flakiness é a dor #1** (lit. acadêmica e industrial): race conditions lideram as causas; wait explícito/network-idle e detecção por re-runs são as práticas padrão. O engine de paciência/misclick do UserEye ataca exatamente isso — documentar e medir é oportunidade. (M3, M10)

### 4.2 Projetos similares (prior-art)

| Projeto | Modelo | Onde UserEye é diferente |
|---------|--------|--------------------------|
| **Playwright** | framework de automação dirigido por testes escritos | UserEye é *não-dirigido*: explora sozinho, acima do Playwright, e produz julgamento de qualidade (gates), não só pass/fail de steps |
| **Cypress** | runner in-browser, single-origin | Cypress roda **dentro** do browser: sem multi-tab, cross-origin restrito. UserEye usa Playwright out-of-process: multi-tab, iframes, origins múltiplas sem hacks (comunicar: M9) |
| **Percy (BrowserStack)** | visual testing SaaS: captura **DOM snapshots**, renderiza determinístico, compara entre browsers/larguras | Percy exige serviço cloud + baselines remotos. M7 é o equivalente local-first: diff offline, sem enviar DOM a terceiros |
| **Applitools** | Visual AI (comparação semântica) | Fora de escopo para o core; um dia pode virar plugin via `plugins.js` (M11) |
| **Explorbot / Autonoma / QAeverest** | exploração autônoma com IA, gera testes | UserEye não gera testes — audita estado atual com evidência; IA entra como *cliente* via MCP (M5–M6), não como motor |

### 4.3 Tecnologias emergentes a monitorar (trimestral)

- **WebDriver BiDi (W3C):** cross-browser bidirecional; Puppeteer já usa para Firefox; Selenium empurra. Playwright mantém protocolo próprio para FF/WebKit. **Decisão hoje: ficar no Playwright** (evita reescrita; BiDi ainda não cobre tudo que o engine usa). Reavaliar no M12.
- **Chrome DevTools Protocol:** continue sendo o "control surface" do Chromium; UserEye já usa via Playwright (network, runtime, tracing) — nada a migrar.
- **Core Web Vitals 2026:** LCP ≤ 2,5 s · INP ≤ 200 ms · CLS ≤ 0,1 são os thresholds "good" publicados (web.dev/Google). Alinhar `first-impression`/vitals a esses números explícitos no relatório (M3 e M8).
- **SARIF 2.1.0** no GitHub code scanning — nota: desde jul/2025 o GitHub não combina múltiplos SARIF do mesmo tool+category; upload único por execução (M2).

### 4.4 Estudos de falhas comuns de UI (base para heurísticas)

| Falha | Evidência/probe atual | Gap → marco/issue |
|-------|----------------------|-------------------|
| **Layout shift (CLS)** | protocolo `first-impression`, vitals | Medir CLS explícito e reportar com threshold 0,1 (M3/#3, M8/#6) |
| **Imagens quebradas** | protocolo `broken-media` ✅ (validado no controle negativo) | — |
| **Race conditions/flaky** | `patience.js`, `misclick-engine.js`, retries de navegação | Telemetria de retris exposta no relatório (M3/#3) |
| **Contraste/bloqueio visual** | heurísticas axe + visual adaptation ✅ (validado) | — |
| **Zoom 200% / touch target** | protocolos `zoom-200`, `touch-pointer` ✅ | Mapear a WCAG 2.2 (M8/#6) |

## 5. Decisões vigentes (resumo)

Ver [`DECISIONS.md`](DECISIONS.md) para o log completo com rationale.

- Playwright 1.63.0 pinned; migração de versão é evento deliberado com suite verde.
- `--url` puro não analisa o projeto (opt-in via `--project`).
- Fronteira de execução de código fechada por padrão; auditoria em `commandAudit`.
- Metadados npm (`repository/homepage/bugs`) só no commit de publicação.
- Repo organizado em `src/usereye` + `demo/` + `tests/` + `scripts/`; zip 7.5.1 arquivado na tag `v7.5.1-zip`.
- Cadência mensal de marcos (D-011): 1 marco/mês, slip registrado em `DECISIONS.md` no mesmo dia.

## 6. Governance

1. **Revisão trimestral** anexada aos marcos de fim de trimestre (M3 → jan/2027, M6 → abr/2027, M9 → jul/2027, M12 → out/2027): marcos, pesquisa, prioridades. Registrar em `Última revisão` + `DECISIONS.md`.
2. **Cadência mensal:** cada marco tem data alvo explícita; marco atrasado recebe decisão documentada (replaneja, reduz escopo ou cancela) — nunca fica "em silêncio".
3. Todo marco tem **issue vinculada** quando aplicável; issue fechada sem marco entregue = regressão de escopo a documentar.
4. Mudanças de princípio (§1) exigem decisão formal em `DECISIONS.md` com alternativas.
5. Pesquisa de mercado (§4.2) re-feita a cada revisão trimestral — concorrência autônoma com IA evolui rápido.
6. **M12 nunca desliza:** a âncora anual garante que a janela de 12 meses termine com replanejamento completo (M13–M24).
