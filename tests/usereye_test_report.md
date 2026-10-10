# Relatório de testes — UserEye 7.5.1

**Data da execução:** 2026-10-10 · **Executor:** agente (Z.ai Code) · **Ambiente:** sandbox Linux x86_64 (kernel 5.10.134), Node v24.21.0, npm 11.19.0, sem privilégios de sistema (sem sudo)

> Todos os números abaixo saíram de execuções reais neste ambiente. Nada foi transcrito de outra fonte.

---

## 1. Suíte própria do pacote (`npm test`)

```text
ℹ tests 446   ℹ pass 442   ℹ fail 0   ℹ skipped 4   ℹ duration_ms 151656
TEST_EXIT=0
```

| Item | Resultado |
|------|-----------|
| Total | 446 testes (node:test, 60+ arquivos) |
| Passaram | 442 |
| Falharam | **0** |
| Skipped | 4 — firefox/webkit não instalados na hora da suíte + "tree dirty" (skips declarados pela própria suíte, comportamento documentado) |
| Exit code | 0 ✅ |

Os testes incluem o smoke do CLI (`--mode quick` em dry-run sem browser), governança de config, i18n, SARIF, dashboard, plugins, fronteiras de execução de código, e bateria de user-journey contra fixture viva.

## 2. E2E — simulação de usuário no site demo (Vela)

Servidor: `demo/live-server.js` → `http://127.0.0.1:4200/vela/` (site de 9 páginas com modais, tabs, charts e formulários).
Comando: `node bin/usereye.js auto --url http://127.0.0.1:4200/vela/ --mode quick --out <dir>`

### 2.1 Chromium (headless shell 153.0.8010.12)

| Passo | Resultado | Tempo |
|-------|-----------|-------|
| 01 Open target application | PASS | 357 ms |
| 02 Adaptive exploration — quick | PASS | 2.576 ms |
| 03 Concurrent protocols — quick | PASS | 2.422 ms |
| 04 Code quality + quality floor | PASS | 1 ms |
| **Qualidade** | **100/100** · 2 estados · 2 URLs · cobertura 38% (modo quick) | |
| Issues / erros de browser | **0 / 0** | |
| Quality gates | **PASS** · exit 0 | |
| Artefatos | 1,1 MB · 24 arquivos (report.html/md, result.json, screenshots, responsive…) · vídeo/trace descartados por política on-failure em run limpa | |

### 2.2 Firefox 155.0 (Playwright firefox v1543)

| Passo | Resultado | Tempo |
|-------|-----------|-------|
| 01 Open target application | PASS | 814 ms |
| 02 Adaptive exploration — quick | PASS | 3.824 ms |
| 03 Concurrent protocols — quick | PASS | 8.782 ms |
| 04 Code quality + quality floor | PASS | 0 ms |
| **Qualidade** | **100/100** · gates PASS · exit 0 | |
| Artefatos | 1,3 MB · 24 arquivos | |

**Conclusão de compatibilidade:** mesma auditoria, mesmo resultado (100/100) nos dois engines. Firefox foi ~2,5× mais lento no modo quick (13,4 s vs 5,4 s de protocolos+exploração) — dentro do esperado (engine + análise de rede mais conservadora). Sem diferenças de comportamento detectadas nos protocolos executados.

## 3. Protocolos exercitados (simulação de entrada real)

Modo quick seleciona 26 protocolos via "auto", incluindo navegação por teclado, touch/pointer, zoom 200%, validação de formulários, broken-media, first-impression, consent-wall, dark scheme, offline, slow-network, histórico back/forward, print-preview, service-worker, websocket/SSE, clipboard, skip-link, tab-order, security-headers.

## 4. Controle negativo — captura de erros de UI (prova de detecção)

Página plantada com defeitos servida em `http://127.0.0.1:4299/` (imagem quebrada com alt vazio, imagem sem alt, texto com contraste abaixo de WCAG AA, botão sobrepondo link, sem `<title>`, sem `lang`, sem landmarks):

```text
Issues: 10 (1 critical · 6 major · 3 minor) · unexpected browser errors: 12
Quality gates: FAIL · vídeo e trace PRESERVADOS (política on-failure) · 832 KB / 25 arquivos
```

Falhas plantadas → detectadas (amostra real de `result.json`):

| Defeito plantado | Finding capturado | Severidade |
|---|---|---|
| Botão sobrepondo link | "Visual adaptation: Visible controls are blocked by other elements" + "Misclick left around 'Clique sobreposto'" | major |
| Imagem quebrada (src inexistente) | "Visual adaptation: Visible images failed to load" | major |
| Texto cinza-sobre-cinza | "Visible text below WCAG AA contrast" + regra axe de contraste | major |
| `<img>` sem alt | "Images must have alternative text" | **critical** |
| Sem `<title>` / sem `lang` | Regras axe correspondentes | major ×2 |
| Sem landmarks | Regras axe (main landmark / containment) | minor ×2 |

**Conclusão:** o pipeline de percepção não é "só pass/fail": detecta as classes de falha alvo (imagens quebradas, sobreposição/CLS-adjacente, contraste, a11y), classifica severidade, mantém evidência (vídeo + trace) e falha os gates — exatamente o comportamento contratado.

## 5. Mapeamento com os requisitos desta validação

| Requisito | Resultado |
|-----------|-----------|
| Simular entradas de usuário no browser | ✅ exploração adaptativa + 26 protocolos (teclado, touch, forms, zoom) |
| Capturar erros de UI | ✅ controle negativo: 10 issues classificadas + vídeo/trace |
| Compatibilidade Chrome (Chromium) | ✅ 100/100, exit 0 |
| Compatibilidade Firefox | ✅ 100/100, exit 0 (Firefox 155) |
| Documentar resultados | ✅ este arquivo |

## 6. Limitações e observações do ambiente

- **WebKit não testado** neste sandbox (browser não instalado na suíte; exigiria `install-deps` com root). Issue #7 cobre na CI.
- Skips da suíte são honestos e declarados (firefox/webkit ausentes + tree dirty) — coerente com a política de evidência do projeto.
- `npm ci` reporta **21 vulnerabilidades (4 moderadas, 17 altas)** em dependências de desenvolvimento — inventário e triagem ficam para a CI do M1 (issue #1); nenhuma afeta a execução validada aqui.
- Reprodução: `scripts/bootstrap.sh` + `tests/e2e-run.sh` (no repo).

## 7. Veredito

**APROVADO.** A ferramenta funciona de ponta a ponta neste ambiente: suíte íntegra (0 falhas), E2E limpo em 2 engines com score máximo, e detecção real e classificada de defeitos de UI plantados. Próximo passo natural: CI (issue #1).
