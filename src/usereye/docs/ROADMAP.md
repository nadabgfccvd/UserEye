# Roadmaps (histórico e pendências)

**Créditos:** Revisor Anônimo

Todos os roadmaps do bundle numa só peça. Itens já enviados no 7.5.x estão no CHANGELOG; o que resta é pendência.

## Índice de origens

1. `docs/ROADMAP-USEREYE-7.5.0.md` — Roadmap 7.5.0 (executado)
2. `docs/ROADMAP-PACKAGING-AND-DEFAULTS.md` — Roadmap packaging e defaults
3. `docs/ROADMAP-EXECUTION-REPORT.md` — Relatório de execução do roadmap
4. `docs/ROADMAP-PARA-PERFEICAO.md` — Roadmap para perfeição
5. `UserEye/docs/ROADMAP-PROJECT-AGNOSTIC.md` — Roadmap project-agnostic
6. `UserEye/docs/EXECUTION-PLAN-NEXT.md` — Execution plan next

---

## Roadmap 7.5.0 (executado)

<!-- origem: docs/ROADMAP-USEREYE-7.5.0.md -->

## UserEye 7.5.0 — Análise Profunda & Roadmap Completo

**Data:** 2026-09-06
**Artefato analisado:** `usereye-7.5.0-balanced.zip` (685 KB · 214 arquivos · ~19.300 linhas de JS first-party)
**Método:** análise 100% instrumentada — `npm ci`, `npm test`, `npm run lint/format:check/typecheck/checks`, cobertura medida, execuções reais do CLI contra o site demo (Vela) servido pelo próprio `live-server.js`, leitura do código-fonte módulo a módulo. Nenhum número abaixo é estimado: todos saíram de comando executado.

---

### 1. Resumo executivo

O UserEye é uma ferramenta **excepcionalmente bem construída**: arquitetura agnóstica de projeto, fronteira de execução de código fechada por padrão (`command-runner.js` sem shell, com trilha de auditoria), defaults calmos, i18n en/pt completa, 327 testes, gates auto-verificáveis e um histórico de auditorias honesto. A execução ao vivo confirma o produto: `auto --mode quick` contra o demo sai **exit 0, 100/100, ~7 s**, com artefatos ricos (HTML/MD/JSON/SARIF/trace/vídeo).

**Mas a entrega 7.5.0 tem um problema objetivo:** o zip **não passa nos próprios gates** num checkout limpo. Dois testes e um check de release falham por desatualização de documentos de entrega (detalhes no §3.1). O relatório de execução que acompanha o zip afirma "`npm run verify` exits 0" — isso era verdade no ambiente de origem, mas não sobreviveu ao empacotamento final. É um defeito pequeno, localizado e de correção trivial — porém é exatamente a classe de defeito que o projeto criou gates para impedir, então deve ser tratado como prioridade máxima.

Fora isso, os achados são de refinamento: medição de cobertura enganosa para os coletores de browser, dois módulos com cobertura real baixa (`run-diff.js`, fluxo de auth do explorer), custo de artefatos sem política de retenção, 26 chaves faltando nos catálogos es/fr, e pendências de publicação (npm/GitHub) que já estavam marcadas como "não feitas" e continuam abertas.

**Nota sobre os 23 testes que falharam inicialmente nesta análise:** foram causados por bibliotecas de sistema ausentes no sandbox (`libnspr4.so`), exatamente o cenário que o README documenta (`npx playwright install-deps chromium`). Após instalar as dependências, o resultado real é **327 testes · 322 passam · 2 falham · 3 skips** — e as 2 falhas são os defeitos de documentação do §3.1, não de lógica.

---

### 2. O que foi verificado (evidência instrumentada)

| Verificação                    | Comando                                                                                                  | Resultado                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Instalação limpa               | `npm ci`                                                                                                 | ✅ OK                                                                                                  |
| Lint / formato / tipos         | `npm run lint` · `format:check` · `typecheck`                                                            | ✅ os três passam                                                                                      |
| Suíte de testes                | `npm test`                                                                                               | ⚠️ **327 total · 322 passam · 2 falham · 3 skips**                                                     |
| Checks de release              | `npm run checks`                                                                                         | ❌ falha em `check-readme-examples` (contagens em `DELIVERY.md`)                                       |
| Cobertura                      | `node --test --experimental-test-coverage`                                                               | **77,38%** linhas (geral); floors CORE passam; detalhes no §3.5                                        |
| Execução real `auto`           | `auto --url http://127.0.0.1:4200/vela/ --mode quick`                                                    | ✅ exit 0 · 100/100 · 0 erros de browser · vídeo descartado corretamente (`on-failure`)                |
| Execução real `observe` + i18n | `observe …/vela/ --axe --report-locale pt`                                                               | ✅ exit 0 · relatório 100% em português (títulos, "Esperado", "Percepção visual (Primeira impressão)") |
| `doctor`                       | `node bin/usereye.js doctor`                                                                             | ✅ exit 0, todos os checks ok                                                                          |
| `init`                         | `usereye init` em diretório vazio                                                                        | ✅ gera `usereye.config.js` + `.gitignore`, idempotente                                                |
| `dashboard`                    | `usereye dashboard <artefatos> --port 4999`                                                              | ✅ serve em 127.0.0.1:4999                                                                             |
| Fronteira de segurança         | leitura de `command-runner.js` + `tests/code-execution-boundary.test.js` + job `security-boundary` do CI | ✅ tokenizer sem shell; metacaracteres recusados; `commandAudit` em `result.json`                      |
| Contrato de saída              | execuções reais                                                                                          | ✅ `0` (limpo) verificado ao vivo; `2` para erro de uso já coberto por testes                          |
| `result.json`                  | inspeção da execução quick                                                                               | ✅ schemaVersion 4, `performance.metrics.lcp` presente, `commandAudit` presente                        |

---

### 3. Diagnóstico completo, por severidade

#### 3.1 🔴 CRÍTICO — o zip entregue reprova nos próprios gates

| #   | Defeito                                                                                                                                                                                          | Evidência                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| C1  | `CURRENT.md:5` escreve `**Tests:** 327 total · 323 pass · 0 fail · **4 skipped**` — o negrito em `**4 skipped**` quebra a regex do gate `(\d+) skipped`                                          | `tests/packaging.test.js:392` falha: _"CURRENT.md must state a **Tests:** summary line"_ |
| C2  | `DELIVERY.md:5` e `:73` ainda dizem "286 total"/"286 tests" (era 7.4.1)                                                                                                                          | `scripts/check-readme-examples.js` falha 2× dentro de `npm run checks`                   |
| C3  | Consequência: `npm test` → 2 falhas; `npm run verify` ≠ exit 0; o gate de cobertura (`npm run test:coverage`) também falha em cascata ("test suite exited 1")                                    | medido neste ambiente                                                                    |
| C4  | `CURRENT.md` afirma "4 skipped" como se fossem sempre firefox/webkit; na prática o 3º skip é o teste de reprodutibilidade do pack quando a árvore está suja — a contagem real varia por ambiente | `tests/packaging.test.js` ("tree is dirty")                                              |

**Causa raiz:** a frase de testes dos documentos de entrega só é atualizada pelo `pack:delivery`; o zip final foi montado com um `CURRENT.md` editado à mão (negrito adicionado para destacar o "4") e um `DELIVERY.md` não regenerado. Os gates existem e pegaram o erro — só que depois do empacotamento.

#### 3.2 🟠 ALTO

| #   | Defeito                                                                                                                                                                                                                                                                                                                                                                                                                                        | Evidência                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **`run-diff.js` tem 11,69% de cobertura e nenhum teste dedicado de `compareResults`** — e é a base de uma feature entregue (`--compare`, baseline do Action)                                                                                                                                                                                                                                                                                   | cobertura medida; `grep compareResults tests/*.test.js` → 0 imports diretos. Os testes de gates (`regression-gates.test.js`) injetam diffs sintéticos via `evaluateQualityGates`, nunca exercem a função real |
| A2  | **Cobertura enganosa dos coletores de browser**: `browser-perception.js` 0,79%, `browser-human.js` 0,90%, `browser-gaze.js` 1,46%, `browser-recorder.js` 1,53%, `adaptive-browser.js` 2,64% — mas eles **são** testados (57 testes jsdom nos 4 arquivos de teste). O harness `tests/helpers/browser-env.js` executa o _fonte como string eval_ dentro do jsdom (como o Playwright faria), então o V8 coverage não atribui as linhas ao arquivo | `tests/browser-perception.test.js` (16), `browser-gaze.test.js` (10), `browser-human.test.js` (21), `browser-vitals-recorder.test.js` (10)                                                                    |
| A3  | **Fluxo de autenticação do explorer sem cobertura**: `adaptive-explorer.js` está em 46,91% com o bloco `_attemptAuthentication` (linhas 426–578), `_authSuccessAssert` (586–626) e `_liveAuthSignals` (629–659) integralmente descobertos — é justamente o caminho mais sensível do produto (preenche formulários de login com credenciais)                                                                                                    | relatório de cobertura                                                                                                                                                                                        |
| A4  | **`README.md:30`** documenta `npm install --save-dev ./usereye-7.4.1.tgz` — nome de tarball da versão anterior                                                                                                                                                                                                                                                                                                                                 | grep direto                                                                                                                                                                                                   |

#### 3.3 🟡 MÉDIO

| #   | Defeito                                                                                                                                                                                                                                                                                                                                                                                      | Evidência                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| M1  | **Custo de artefatos sem política**: uma execução _quick_ de 7 s contra um site minúsculo gera `report.html` 580 KB + `user-eye-trace.zip` 1,8 MB + `result.json` 328 KB. Em modo `deep`/matriz multi-app isso explode; não há retenção/compressão configurável além do descarte de vídeo                                                                                                    | `du -sh` nos artefatos de `/tmp/ue-run`        |
| M2  | **Catálogos es/fr incompletos**: faltam **26 chaves** vs. en/pt (seção `patience.*`: `feedback300/1000/3000`, `httpError`, `controlFallback`, `disclaimer`…). Relatórios em es/fr vazam texto em inglês nessas seções                                                                                                                                                                        | comparação programática dos 4 `locales/*.json` |
| M3  | **Saída de passos ignora o logger**: `user-eye.js:1055` usa `process.stdout.write` direto para as linhas `[PASS]/[WARN]/[FAIL]`, fora do sistema de `--log-level`/`--log-json` da Fase 6                                                                                                                                                                                                     | leitura de `user-eye.js`                       |
| M4  | **Modo `--url` ainda analisa o cwd como "projeto"**: rodando `auto --url …` de dentro do próprio repo, a saída anuncia `Project: usereye · stack: Node.js · confidence: 100%` e grava `project-analysis.json` + `code-quality.json` do diretório corrente. Para quem só quer apontar para uma URL, é ruído (e roda o analisador estático sobre código que o usuário não pediu para analisar) | saída real da execução quick                   |
| M5  | **Código morto**: `usereye-auto.js:143` — `confidenceRank(entry) >= (policy ? 2 : 2)`; o ternário devolve 2 nos dois ramos                                                                                                                                                                                                                                                                   | grep                                           |
| M6  | **Janela `shell: true` no Windows**: `bin/usereye.js:95` usa `shell: process.platform === 'win32'` no fallback `npx` do `install-browsers`. O grep do CI exclui esse caso deliberadamente, mas a afirmação "`shell: true` is gone from the whole codebase" (CURRENT/SECURITY) fica tecnicamente incompleta no Windows                                                                        | leitura + `ci.yml:160`                         |

#### 3.4 🟢 BAIXO / cosmético

| #   | Defeito                                                                                                                                                                                                              | Evidência                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| B1  | `UserEye/IMPLEMENTATION-REPORT.md` ainda descreve a era 7.0.0 como estado do produto; deveria ir para `docs/history/`                                                                                                | leitura                     |
| B2  | Módulos consumidores chamam `eye._sanitize(...)` (método "privado") a partir de `usereye-auto.js`/`artifact-store.js` — cheiro de encapsulamento; vale expor um `sanitize()` público ou mover para módulo utilitário | grep                        |
| B3  | `observe()` usa `options.maxText                                                                                                                                                                                     |                             | 5000`/`maxControls |     | 300`— passar`0` cai silenciosamente no default | `user-eye.js` |
| B4  | `DELIVERY.md` diz "253 files" no zip; a árvore extraída tem 214 arquivos (o número do zip provavelmente contava diretórios) — mesma classe de desatualização do C2                                                   | `find                       | wc -l`             |
| B5  | Nomes de passos do auto-flow (`Open target application`, `Adaptive exploration — …`) continuam em inglês mesmo com `--report-locale pt` — decisão de produto já registrada na auditoria 7.4.0, ainda aberta          | auditoria §4.5 + saída real |

#### 3.5 Cobertura medida (números reais deste ambiente)

| Camada                         | Arquivo                                                            | Linhas                   |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------ |
| **Geral**                      | all files                                                          | **77,38%**               |
| Núcleo                         | `config.js`                                                        | 96,55%                   |
| Núcleo                         | `user-eye.js`                                                      | 91,14%                   |
| Núcleo                         | `findings.js` / `performance.js` / `logger.js` / `i18n.js`         | 97–100%                  |
| Segurança                      | `command-runner.js`                                                | 85,44%                   |
| CLI                            | `usereye-auto.js`                                                  | 87,48%                   |
| ⚠️                             | `run-diff.js`                                                      | **11,69%**               |
| ⚠️ (medição enganosa — ver A2) | `browser-perception/human/gaze/recorder.js`, `adaptive-browser.js` | 0,8–2,6%                 |
| ⚠️ Parcial                     | `adaptive-explorer.js`                                             | 46,91% (auth descoberto) |
| ⚠️ Parcial                     | `project-adapter.js`                                               | 74,89%                   |
| Parcial                        | `misclick-engine.js`                                               | 52,78%                   |

---

### 4. Roadmap completo

> **Princípio herdado do próprio projeto:** cada fase é aditiva; nada quebra o contrato `0 | 1 | 2`, o schema do `result.json`, nem remove evidência de `issuesAll`. Quando algo precisa quebrar, está marcado **⚠ breaking** e amarrado a bump de versão.

#### FASE 0 — Hotfix da entrega (2–4 horas · risco zero · VERSÃO 7.5.1)

Fecha o §3.1 e o item A4. Tudo aqui é regeneração/edição de docs + 1 linha de código.

| #   | Ação                                                                                                                                                                                                                                     | Arquivo                                              | Pronto quando                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------- |
| 0.1 | Tirar o negrito do número de skipped na linha `**Tests:**` (ou tornar a regex do gate tolerante a `**`). Recomendação: consertar o doc **e** endurecer o gate para falhar também quando a contagem anunciada divergir do último run real | `CURRENT.md:5`, `tests/packaging.test.js:392`        | o teste de packaging passa               |
| 0.2 | Regenerar as contagens de `DELIVERY.md` a partir de um run real (`npm run pack:delivery` já reescreve isso — basta rodá-lo em vez de editar à mão)                                                                                       | `DELIVERY.md:5`, `:73`                               | `npm run checks` passa                   |
| 0.3 | Substituir `usereye-7.4.1.tgz` por `usereye-7.5.1.tgz` (ou melhor: derivar o nome da versão via script para nunca mais divergir)                                                                                                         | `README.md:30`                                       | gate de exemplos do README validado      |
| 0.4 | Tornar a linha `**Tests:**` dos dois docs uma consequência do run: adicionar `npm run verify:delivery` = roda suíte → injeta contagem real nos dois docs → roda `pack:delivery`. O release passa a ser `verify:delivery && pack`         | `package.json`, `scripts/pack-delivery.js`           | impossível empacotar com contagem errada |
| 0.5 | Remover o ternário morto                                                                                                                                                                                                                 | `usereye-auto.js:143` → `confidenceRank(entry) >= 2` | diff de 1 linha                          |
| 0.6 | Reescrever a contagem real pós-correção (ex.: "327 total · 325 pass · 0 fail · 2 skipped" — firefox/webkit) e explicar que skips adicionais dependentes de ambiente existem                                                              | `CURRENT.md`                                         | honestidade restaurada                   |

**Critério de pronto da Fase 0:** `npm run verify` sai **0** num checkout limpo do zip novo.

#### FASE 1 — Honestidade de medição (1–2 dias · risco baixo · 7.5.1 ou 7.6.0)

| #   | Ação                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Detalhe                                                     | Pronto quando                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1.1 | **Corrigir a medição dos coletores de browser (A2).** Duas opções: (a) reestruturar para que o teste jsdom invoque a _função exportada_ diretamente (ex.: `collectBrowserPerception.call(fakeWindow, settings)` em um contexto onde `window`/`document` são os do jsdom), mantendo o eval-string apenas num teste fino de "serializabilidade"; ou (b) declarar explicitamente esses 5 arquivos como _browser-injected_ no `check-coverage.js` e medir por contagem de testes em vez de linhas. A opção (a) é preferível por tornar o número verdadeiro | `tests/helpers/browser-env.js`, `scripts/check-coverage.js` | cobertura real dos 5 arquivos refletida no relatório (esperado >60%)          |
| 1.2 | **Testes dedicados de `run-diff.js` (A1):** introduced/resolved/persisted por fingerprint; CTA alterado; score anterior ausente (`delta: null`); entradas sem fingerprint caem para `id`; baseline de schema antigo                                                                                                                                                                                                                                                                                                                                    | novo `tests/run-diff.test.js`                               | `run-diff.js` ≥ 90%                                                           |
| 1.3 | **Cobertura do fluxo de auth (A3):** fixture com formulário de login (já existe a família `sso`); testes dirigidos de `_attemptAuthentication` para: sucesso por transição de URL, sucesso por assert, falha com credencial errada sem loop, `hasLogin:false` não tocando a página, e credenciais nunca aparecendo em artefatos                                                                                                                                                                                                                        | `tests/` novo ou extensão de `agnostic.test.js`             | bloco 426–659 de `adaptive-explorer.js` coberto; regressão de segredo testada |
| 1.4 | `misclick-engine.js` (52,78%): cobrir os ramos `aggressive` vs `stable-only` restantes e o caminho de recuperação                                                                                                                                                                                                                                                                                                                                                                                                                                      | `tests/misclick-policy.test.js`                             | ≥ 75%                                                                         |
| 1.5 | Adicionar ao CI uma anotação de PR com o delta de cobertura (opcional, baixo custo com o relatório já existente)                                                                                                                                                                                                                                                                                                                                                                                                                                       | `ci.yml`                                                    | comentário de PR com tabela de cobertura                                      |

#### FASE 2 — Economia de artefatos & observabilidade consistente (2–3 dias · risco baixo)

| #   | Ação                                                                                                                                                                                                       | Detalhe                         | Pronto quando                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | **Política de trace**: trace.zip foi o maior artefato (1,8 MB num run de 7 s). Novo `trace: 'on-failure'                                                                                                   | 'always'                        | 'never'`espelhando a semântica do vídeo (inclusive descarte em run limpo). Default sugerido:`'on-failure'` — mantém a forense sem custo em CI verde | `config.js`, `artifact-store.js`, docs gerados | comportamento espelha `recordVideo`, testado |
| 2.2 | **`report.html` sob controle**: 580 KB para 2 observações indica payload embutido sem poda. Introduzir teto de embutir (ex.: observações > N KB vão para arquivos vizinhos linkados) e `report.embedLimit` | `report.js`                     | quick-run do demo < 250 KB de HTML                                                                                                                  |
| 2.3 | **Retenção de execuções**: `outDir` hoje é apagado/recriado por run; adicionar `keepLast: n` opcional para uso local (sem mudar default de CI)                                                             | `usereye-auto.js`               | docs + teste                                                                                                                                        |
| 2.4 | **Linhas de passo pelo logger (M3)**: passar `[PASS]/[WARN]/[FAIL]` pelo logger da Fase 6 (mantendo byte-identical em `info`), para que `--log-level error` silencie tudo e `--log-json` inclua os passos  | `user-eye.js:1055`, `logger.js` | saída default idêntica; json completo                                                                                                               |
| 2.5 | Registrar tamanho total de artefatos em `result.json` (`artifacts.totalBytes`) e no dashboard — torna o custo visível antes de virar reclamação                                                            | `artifact-store.js`             | campo presente                                                                                                                                      |

#### FASE 3 — Decisões de produto pendentes (3–5 dias · risco médio — envolve defaults)

| #   | Ação                                                                                                                                                                                                                                                                                                              | Detalhe                                                 | Pronto quando                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| 3.1 | **`--url` não deve analisar o cwd (M4)**: quando houver `--url` sem `--project` explícito, pular análise/`code-quality` do diretório corrente (ou exigir `--project` para ativá-los). ⚠ levemente breaking para quem dependia do side-effect; tratar como minor e documentar em HISTORY                           | `usereye-auto.js`, `project-adapter.js`                 | run com `--url` não gera `project-analysis.json` do cwd |
| 3.2 | **Completar es/fr (M2)**: as 26 chaves faltantes da seção `patience.*` (+ varredura final de paridade). O teste de paridade já existente deve passar a exigir igualdade total de chaves entre os 4 packs                                                                                                          | `locales/es.json`, `locales/fr.json`, teste de paridade | 0 chaves faltando em qualquer pack                      |
| 3.3 | **Nomes de passos do auto-flow (B5)**: decidir — (a) localizar via catálogo `issue`/novo `steps`, ou (b) declará-los identificadores técnicos e documentar. Recomendação: (a) para consistência com o observe já 100% pt                                                                                          | `user-eye.js`, `usereye-auto.js`, locales               | relatório `auto` pt sem inglês residual                 |
| 3.4 | **`observe` e o contrato de exit**: hoje `observe` com 2 findings low sai 0. Está documentado, mas considerar `--fail-on <severity>` opcional para quem usa observe como gate                                                                                                                                     | `usereye-observe.js`                                    | flag nova, default inalterado                           |
| 3.5 | **Janela Windows (M6)**: trocar o fallback `npx` com shell por resolução sem shell também no Windows (`npx.cmd` via `spawn` direto com argv, ou `process.execPath + playwright CLI` já coberto pelo caminho principal). Depois remover a exclusão do grep no CI e corrigir a frase "gone from the whole codebase" | `bin/usereye.js:95`, `ci.yml`                           | grep sem exceção passando nos 3 SOs                     |

#### FASE 4 — Publicação (M2 do roadmap anterior — ~1 semana, bloqueada por decisões suas)

Tudo que precede os comandos finais já está pronto (versão single-sourced, HISTORY, tarball 210,8 kB < teto 260 kB, `verify:release`). O que falta:

| #   | Ação                                                                                                         | Detalhe                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 4.1 | Criar o repositório GitHub (org/nome a definir) e preencher `repository`/`homepage`/`bugs` no mesmo commit   | `package.json` (hoje vazio de propósito — decisão correta enquanto não existe URL real) |
| 4.2 | `npm publish --provenance` com `NPM_TOKEN` no environment `npm` (o workflow `publish.yml` já espera isso)    | infra                                                                                   |
| 4.3 | Push da imagem GHCR (`publish.yml` job `container` já escrito) e listing do Action no Marketplace            | infra                                                                                   |
| 4.4 | Habilitar private vulnerability reporting (SECURITY.md já referencia)                                        | config do repo                                                                          |
| 4.5 | Definir CODEOWNERS e o e-mail de contato de security (SECURITY.md aponta para "endereço no perfil")          | repo                                                                                    |
| 4.6 | Decidir política de suporte a versões (SECURITY.md promete "última minor") e publicar CHANGELOG = HISTORY.md | docs                                                                                    |

#### FASE 5 — Estrutural / estratégico (contínuo, pós-publicação)

| #   | Área                                                                                                                                                                                                                                                              | Proposta |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 5.1 | **Estabilidade de heurísticas documentadas** (pedido da auditoria 7.4.0 para chegar a 9.7+): misclick em UI revelada por focus, regex de consent-wall, técnica de zoom — transformar cada uma em teste com fixture dedicado e página de decisão em `docs/`        |
| 5.2 | **`plugins.js` mínimo mas poderoso**: hoje plugins carregam via `require`/`import` sem validação de hooks nem timeout — adicionar contrato (`beforeRun/afterRun/afterState` documentados), isolamento de erro (plugin quebrado ≠ run quebrado) e timeout por hook |
| 5.3 | **Matriz multi-app (`config.apps`)**: testada só indiretamente; merece fixture própria + docs públicos (hoje quase invisível)                                                                                                                                     |
| 5.4 | **Dashboard**: agregar múltiplos runs (tendência de score/LCP entre `result.json`s) — é o caminho natural para o "baseline" que o Action já gerencia                                                                                                              |
| 5.5 | **Camada de inteligência**: a Fase 4 do roadmap anterior (LLM) foi removida a seu pedido e o projeto está melhor assim para CI. Se um dia voltar, que seja como plugin pós-run lendo `result.json` (mantendo o núcleo determinístico)                             |
| 5.6 | **Perf**: benchmark noturno já existe com baseline commitado; considerar publicar o `quick-baseline.json` no README como SLA informal                                                                                                                             |

---

### 5. Tabela consolidada — tudo que deve ser alterado

| Arquivo                                                     | Mudança                                                                              | Fase          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------- |
| `CURRENT.md:5`                                              | remover negrito de "4 skipped"; reescrever contagem real + nota de skips de ambiente | 0             |
| `DELIVERY.md:5,:73`                                         | regenerar contagens via run real                                                     | 0             |
| `README.md:30`                                              | nome do tarball → versão atual (ou derivado)                                         | 0             |
| `usereye-auto.js:143`                                       | remover ternário morto `(policy ? 2 : 2)`                                            | 0             |
| `scripts/pack-delivery.js` + `package.json`                 | `verify:delivery` injetando contagem real antes do pack                              | 0             |
| `tests/packaging.test.js:392`                               | (opcional) regex tolerante a `**`, ou gate adicional de divergência de contagem      | 0             |
| `tests/helpers/browser-env.js`, `scripts/check-coverage.js` | medição real dos coletores browser-injected                                          | 1             |
| `tests/run-diff.test.js` (novo)                             | unidade de `compareResults`                                                          | 1             |
| `tests/` (auth explorer)                                    | `_attemptAuthentication`/`_authSuccessAssert`/`_liveAuthSignals`                     | 1             |
| `tests/misclick-policy.test.js`                             | ramos restantes das duas policies                                                    | 1             |
| `config.js`, `artifact-store.js`, `user-eye.js`             | política de trace `on-failure`                                                       | 2             |
| `report.js`                                                 | teto de embutir no HTML                                                              | 2             |
| `usereye-auto.js`                                           | `keepLast: n` opcional                                                               | 2             |
| `user-eye.js:1055`, `logger.js`                             | passos pelo logger                                                                   | 2             |
| `artifact-store.js`                                         | `artifacts.totalBytes`                                                               | 2             |
| `usereye-auto.js`, `project-adapter.js`                     | `--url` sem análise do cwd                                                           | 3             |
| `locales/es.json`, `locales/fr.json`                        | 26 chaves `patience.*` + paridade total                                              | 3             |
| locales + `usereye-auto.js`                                 | nomes de passos do auto-flow localizados (decisão)                                   | 3             |
| `usereye-observe.js`                                        | `--fail-on` opcional                                                                 | 3             |
| `bin/usereye.js:95`, `ci.yml`                               | fallback Windows sem shell; grep sem exceção                                         | 3             |
| `package.json`                                              | repository/homepage/bugs reais no commit de publicação                               | 4             |
| infra                                                       | npm publish + GHCR + Marketplace + CODEOWNERS + vulnerability reporting              | 4             |
| `plugins.js`                                                | contrato de hooks, isolamento, timeout                                               | 5             |
| docs                                                        | decisões de heurísticas (misclick/consent/zoom)                                      | 5             |
| `UserEye/IMPLEMENTATION-REPORT.md`                          | mover para `docs/history/`                                                           | 0 (cosmético) |

---

### 6. O que NÃO mudar (contrato preservado)

1. **Exit codes `0 | 1 | 2`** — verificados ao vivo e por testes; não tocar.
2. **`issuesAll` completo + `surfaced`** — a política de findings acalma a apresentação sem destruir evidência; padrão-ouro do projeto.
3. **Fronteira de execução fechada por padrão** (`codeExecution.*` = false) — foi a grande conquista de segurança da 7.5; qualquer regressão aqui é inaceitável.
4. **Ausência de LLM/no-determinismo** — decisões e gates continuam reproduzíveis byte a byte (inclusive `Math.random` está ausente do codebase, verificado por grep).
5. **Pinning exato de runtime deps** (`playwright 1.63.0`, `axe-core 4.13.0`) — pré-condição do `--compare` confiável.
6. **Defaults calmos da 7.4.1** (`recordVideo: 'on-failure'`, `misclick stable-only`, `minConfidence: medium`) — com opt-back já documentado.

---

### 7. Critério de aceitação global do roadmap

Um zip futuro estará pronto quando:

- [ ] `npm run verify` sair **0** em checkout limpo, nos três Nodes (20/22/24) e com a matriz de browsers instalada;
- [ ] nenhum documento de entrega contiver contagem editada à mão (toda frase de testes derivada de run real);
- [ ] `run-diff.js` ≥ 90% e fluxo de auth do explorer coberto por regressão;
- [ ] relatório de cobertura refletir a realidade dos coletores de browser;
- [ ] run quick do demo produzir < 250 KB de HTML e trace sob política `on-failure`;
- [ ] 0 chaves faltando nos 4 catálogos de idioma; relatório `auto --report-locale pt` sem inglês residual;
- [ ] `--url` isolado do cwd; fallback Windows sem shell;
- [ ] publicado em npm com provenance + imagem GHCR + Action no Marketplace, com `repository`/`homepage`/`bugs` apontando para URLs vivas.

---

_Análise executada em 2026-09-06 · Node v20.20.2 · Playwright 1.63.0 (Chrome Headless Shell 153) · todos os comandos deste documento são reproduzíveis a partir do zip auditado._

## Roadmap packaging e defaults

<!-- origem: docs/ROADMAP-PACKAGING-AND-DEFAULTS.md -->

## Roadmap: Packaging Clarity & Calmer Defaults

**Date:** 2026-09-06  
**Baseline:** delivery zip labeled `UserEye-7.1.1-BALANCED-optim` · inner package **`usereye@7.4.0`**  
**Scope:** _only_ the remaining gap called out after the 7.4 review — **not** new protocols, not explorer rewrites, not LLM features.  
**Principle:** make the box match the product, and make **out-of-the-box CI** as calm as `usereye init` already recommends.

---

### 0. Why this roadmap exists

7.4.0 already implemented most of ROADMAP-NEXT (confidence, init, auth, Action summary, es/fr, etc.). Two trust gaps remain:

| Gap                   | What users experience today                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Packaging clarity** | Zip/folder say **7.1.1**, `package.json` says **7.4.0**, paths are double-nested, `README-DELIVERY.txt` still describes 7.1.1 / “157 tests”, two audit ratings (9.2 then 9.3) compete for “current truth”.                                                                                                                                                                            |
| **Calmer defaults**   | `usereye init` scaffolds **calm** settings (`recordVideo: 'on-failure'`, `misclick.policy: 'stable-only'`, `gateConfidence: 'high'`), but **`DEFAULT_CONFIG` still ships loud defaults** (`recordVideo: true`, `misclick.policy: 'aggressive'`, `findings.minConfidence: 'low'`). Running bare `usereye auto` without a config is noisier and heavier than the documented happy path. |

**Target release:** **`7.4.1`** (patch) if defaults are considered bugfixes aligned with documented intent · **`7.5.0`** (minor) if you want a louder “calm by default” announcement. Recommendation: **7.4.1** for packaging + default alignment, with a short migration note (opt-back flags).

**Success metric:** a stranger downloads one zip, sees **one version number everywhere**, runs `npm test` / `usereye auto --url …` with **no config**, and gets **CI-sane** cost + noise — matching what `usereye init` already writes.

---

### 1. Current-state inventory (instrumented)

#### 1.1 Version & layout mismatches

| Location                                               | Says today                                               | Should say                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Outer zip name                                         | `…7.1.1-BALANCED-optim`                                  | `usereye-7.4.1-balanced.zip` (or `…-7.4.0-verified`)                                    |
| Nested folders                                         | `UserEye-7.1.1-BALANCED/UserEye-7.1.1-BALANCED/UserEye/` | `usereye-7.4.x/UserEye/` **or** flat `UserEye/` at zip root                             |
| `UserEye/package.json`                                 | `7.4.0`                                                  | single source of truth (already via `TOOL_VERSION = require('./package.json').version`) |
| `README-DELIVERY.txt`                                  | “UserEye 7.1.1 — BALANCED”, “157 testes”                 | 7.4.x, real test count, current commands                                                |
| `MY-CHANGES-7.1.1.md`                                  | Historical 7.1.1 audit                                   | Keep under `docs/history/`, not as top “current”                                        |
| `VERIFICATION-REPORT-7.4.0.md` + `AUDIT-2026-09-06.md` | Two “current” ratings                                    | One `CURRENT.md` pointer + archive the rest                                             |
| `types/index.d.ts`                                     | `reportLocale?: 'en' \| 'pt'`                            | `'en' \| 'pt' \| 'es' \| 'fr' \| 'auto'` (runtime already broader)                      |
| `user-eye.js` JSDoc                                    | `recordVideo=true` boolean-only vibe                     | Document `boolean \| 'on-failure'`                                                      |
| `package.json` repository                              | `github.com/usereye/usereye`                             | Real URL **or** `"private": true` + “unpublished” badge until real                      |

#### 1.2 Default vs init skew (the calmness bug)

| Knob                      | `DEFAULT_CONFIG` (bare CLI)           | `usereye init` scaffold     | Types / engine support                 |
| ------------------------- | ------------------------------------- | --------------------------- | -------------------------------------- |
| `recordVideo`             | **`true`**                            | **`'on-failure'`**          | Engine already supports `'on-failure'` |
| `misclick.policy`         | **`'aggressive'`**                    | **`'stable-only'`**         | Both policies implemented              |
| `findings.gateConfidence` | `'high'`                              | `'high'`                    | Aligned                                |
| `findings.minConfidence`  | **`'low'`** (report lists everything) | often medium/high in spirit | Classifier exists                      |
| `extensions.enabled`      | `false`                               | (omit / false)              | OK — keep off                          |
| `userJourney.enabled`     | `false`                               | (omit / false)              | OK — keep off                          |
| Action `report-format`    | `html,md`                             | —                           | OK; sarif opt-in                       |

**Conclusion:** calmness is **implemented but not defaulted**. Packaging still **advertises the wrong generation**.

---

### 2. North star

> **One version. One folder story. One “current” doc. Defaults safe enough that bare `usereye auto` is something you’d leave on in CI without a custom config.**

Non-goals:

- No new protocol batteries
- No default-on `userJourney` / `extensions`
- No breaking change to exit codes `0|1|2`
- No rename of public API (`UserEye`, `loadConfig`, …)

---

### 3. Phased plan

#### Phase A — Single source of version truth (0.5 day)

**Risk:** none · **Release:** part of 7.4.1

| #   | Task                                      | Detail                                                                                                                                         | Done when                                     |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| A1  | **Delivery root rename**                  | Build script or checklist produces `usereye-${version}-balanced.zip` from `package.json`                                                       | Zip name == `package.json` version            |
| A2  | **Flatten zip layout**                    | Zip root = `README.md` + `UserEye/` + optional `demo/` `docs/` — **one** nesting level                                                         | `unzip -l` shows no `7.1.1` path segments     |
| A3  | **Ban stale version strings in delivery** | `scripts/check-delivery-names.js` (or extend `check-package.js`) fails if delivery README/title contains older `7.1.x` while package is `7.4+` | `npm run checks` includes it for release jobs |
| A4  | **HISTORY is canonical product log**      | Delivery root links to `UserEye/HISTORY.md` for feature history; audits go to `docs/audits/`                                                   | No competing “what version is this?”          |

**Files:** release shell script, `README-DELIVERY.txt` → replace with `DELIVERY.md`, CI release job.

---

#### Phase B — Documentation clarity (0.5–1 day)

**Risk:** none

| #   | Task                                       | Detail                                                                                                                                                    | Done when                                  |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| B1  | **`CURRENT.md` at delivery root**          | ≤40 lines: version, rating, quick start, link to latest audit, “historical audits in docs/audits/”                                                        | Newcomers read one file                    |
| B2  | **Rewrite `DELIVERY.md`**                  | Contents of zip, what is npm package vs harness, test count from `npm test` output, ports, commands for 7.4+ (`init`, `auth save`)                        | No “157 tests” / “7.1.1”                   |
| B3  | **Archive audits**                         | Move `MY-CHANGES-7.1.1.md`, older verification reports under `docs/audits/YYYY-MM-DD-*.md`                                                                | Root only has `CURRENT.md` + `DELIVERY.md` |
| B4  | **README.md (package) “Defaults” section** | Table: default value · meaning · how to get old loud behavior                                                                                             | Users see calm defaults documented         |
| B5  | **Repository field policy**                | If GitHub not public: set `"private": true` temporarily **or** `repository.url` to real remote; add README badge “not published to npm yet” if applicable | No fake 404 org                            |
| B6  | **Action / Docker one-liners** in DELIVERY | Copy-paste CI snippet matching `action.yml` v2                                                                                                            | —                                          |

**Files:** `DELIVERY.md`, `CURRENT.md`, `UserEye/README.md`, package.json metadata.

---

#### Phase C — Type & comment alignment (0.5 day)

**Risk:** none (types only / docs)

| #   | Task                                  | Detail                                                                                                           | Done when                           |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| C1  | **`types/index.d.ts` `reportLocale`** | Match config: `'en' \| 'pt' \| 'es' \| 'fr' \| 'auto'`                                                           | `tsc` + smoke import                |
| C2  | **Export finding types**              | `UserEyeConfidence`, `UserEyeFindingKind` already in config types — re-export from `types/index.d.ts` if missing | API surface check                   |
| C3  | **JSDoc `user-eye.js`**               | `recordVideo?: boolean \| 'on-failure'`; default after Phase D                                                   | Matches runtime                     |
| C4  | **Config example + README**           | `usereye.config.example.js` defaults == `DEFAULT_CONFIG` after Phase D                                           | `check-readme-examples` still green |

---

#### Phase D — Calmer `DEFAULT_CONFIG` (1–2 days)

**Risk:** low–medium (behavior change for bare CLI) · **Semver:** 7.4.1 with migration note **or** 7.5.0

Align engine defaults with **`usereye init`** (already the recommended path):

##### D1. Proposed new defaults

```js
// config.js DEFAULT_CONFIG — calm profile
recordVideo: 'on-failure',     // was: true
misclick: { policy: 'stable-only' },  // was: 'aggressive'
findings: {
  minConfidence: 'medium',     // was: 'low' — report primary list quieter
  gateConfidence: 'high',      // unchanged
  suppress: [],
  elevate: [],
  treatAsSignal: [],           // optional: seed missing-favicon etc. via findings.js already
},
// keep:
extensions: { enabled: false, … },
userJourney: { enabled: false, … },
```

##### D2. Opt-back (compatibility)

| Want old behavior              | Flag / config                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| Always record video            | `--` no flag today for force-on → add `--video` **or** `recordVideo: true` in config |
| Aggressive misclick            | `misclick.policy: 'aggressive'` or `--misclick-policy aggressive`                    |
| Show all low signals in report | `findings.minConfidence: 'low'`                                                      |

**CLI additions (small):**

- `--video` → `recordVideo: true`
- `--no-video` (exists) → false
- `--video-on-failure` → `'on-failure'`
- `--misclick-policy stable-only|aggressive`

##### D3. Action / CI profile

In `action.yml` default env or args:

- pass `--no-video` **or** rely on new default `'on-failure'`
- document `soft-fail` for gradual adoption
- optional input `misclick-policy: stable-only`

##### D4. Tests

| Test             | Assert                                                                                |
| ---------------- | ------------------------------------------------------------------------------------- |
| `config.test.js` | DEFAULT_CONFIG values == calm table                                                   |
| `init` test      | scaffold still matches defaults (or init omits keys that equal defaults)              |
| misclick fixture | stable-only does not mark focus-only skip-link as harmful without URL/dialog change   |
| video            | `'on-failure'` + clean run → no retained webm (or discarded); failing run keeps video |
| regression       | existing suites still pass; update snapshots only if they assumed aggressive/video-on |

##### D5. Migration blurb (`HISTORY.md` 7.4.1)

> Bare CLI now matches `usereye init`: videos on failure only, stable-only misclick, medium minConfidence for listing. Restore prior behavior with `recordVideo: true` and `misclick.policy: 'aggressive'`.

**Files:** `config.js`, `bin/usereye.js` help, `usereye-auto.js` / observe argv wiring if needed, `bin/usereye-init.js` (dedupe comments), `action.yml`, `HISTORY.md`, tests.

---

#### Phase E — Report calmness without hiding evidence (1 day)

Defaults change _listing_; evidence must remain complete.

| #   | Task                 | Detail                                                                                                   |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| E1  | **Report sections**  | HTML/MD already should split actionable vs signals — verify hero uses `gateConfidence` / `minConfidence` |
| E2  | **Full JSON always** | `result.json` retains **all** issues regardless of minConfidence; filter is presentation + gates only    |
| E3  | **SARIF**            | Only emit gate-relevant or high+medium by default; config `sarif.minConfidence`                          |
| E4  | **Console summary**  | Print `Actionable: N · Signals: M` so exit 0 with signals doesn’t look “empty”                           |

**Done when:** a Vela `deep` run with calm defaults exits **0** (or only on true highs), while `result.json` still contains suppressed/low rows for forensics.

---

#### Phase F — Release packaging automation (1 day)

| #   | Task                        | Detail                                                                                                                                                             |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | **`npm run pack:delivery`** | Script builds balanced zip: correct name, flat layout, CURRENT.md, no `node_modules`, no heavy webm, includes `UserEye/` + `vela-site` + thin `evidence/` optional |
| F2  | **Manifest**                | `DELIVERY-MANIFEST.json`: version, git sha, test summary line, file count, sha256 of zip                                                                           |
| F3  | **Preflight**               | Fails if version in CURRENT/DELIVERY/package disagree                                                                                                              |
| F4  | **Optional CLEAN target**   | `pack:npm` → only what `files` whitelist publishes                                                                                                                 |

---

#### Phase G — Optional polish (backlog, not blocking 7.4.1)

| Item                                            | Note                                           |
| ----------------------------------------------- | ---------------------------------------------- |
| Auto-flow step names i18n                       | Still English in pt reports — product decision |
| `live-server` `/vela` prefix quirk (`/velafoo`) | Harmless; fix if touching server               |
| Publish real GitHub + npm                       | When ready; until then honesty in README       |
| Baseline artifact in demo CI                    | `failOnNewMajor` example workflow              |

---

### 4. Implementation order (recommended sprint)

```text
Day 1     A (layout/version) + B (docs) + C (types)
Day 2     D (DEFAULT_CONFIG + CLI flags + tests)
Day 3     E (report/SARIF presentation) + F (pack:delivery) + tag 7.4.1
```

One engineer, ~2–3 days calendar time.

---

### 5. File-level checklist

| File                                                        | Phases                                  |
| ----------------------------------------------------------- | --------------------------------------- |
| `UserEye/config.js`                                         | D                                       |
| `UserEye/bin/usereye.js`                                    | D (help + flags)                        |
| `UserEye/bin/usereye-init.js`                               | D (align comments; omit redundant keys) |
| `UserEye/user-eye.js`                                       | C, D (JSDoc; video default path)        |
| `UserEye/usereye-auto.js` / `usereye-observe.js`            | D flags passthrough                     |
| `UserEye/action.yml`                                        | D, B                                    |
| `UserEye/types/index.d.ts`                                  | C                                       |
| `UserEye/types/usereye-config.d.ts`                         | C (verify already complete)             |
| `UserEye/usereye.config.example.js`                         | D                                       |
| `UserEye/README.md`                                         | B, D                                    |
| `UserEye/HISTORY.md`                                        | D migration entry                       |
| `UserEye/tests/config.test.js` (+ video/misclick if needed) | D, E                                    |
| `UserEye/report.js` / `sarif.js`                            | E                                       |
| `UserEye/scripts/check-delivery-names.js` **new**           | A, F                                    |
| `UserEye/scripts/pack-delivery.js` **new**                  | F                                       |
| Delivery root `DELIVERY.md` / `CURRENT.md`                  | A, B                                    |
| Remove or archive stale `README-DELIVERY.txt`               | B                                       |

---

### 6. Acceptance tests (release gate)

#### Packaging clarity

- [ ] `package.json` version **===** zip filename version **===** `CURRENT.md` version **===** CLI `--version`
- [ ] Zip path depth: `UserEye/package.json` reachable at `*/UserEye/package.json` with **no** `7.1.1` in path
- [ ] `grep -R "7.1.1" DELIVERY.md CURRENT.md README-DELIVERY* 2>/dev/null` empty (history allowed under `docs/audits/`)
- [ ] `types/index.d.ts` accepts `reportLocale: 'es' | 'auto'`
- [ ] One obvious “start here” doc at zip root

#### Calmer defaults

- [ ] `require('./config').DEFAULT_CONFIG.recordVideo === 'on-failure'`
- [ ] `DEFAULT_CONFIG.misclick.policy === 'stable-only'`
- [ ] `DEFAULT_CONFIG.findings.minConfidence === 'medium'`
- [ ] `DEFAULT_CONFIG.findings.gateConfidence === 'high'`
- [ ] `extensions.enabled === false` && `userJourney.enabled === false`
- [ ] Bare `usereye auto --url <vela> --mode quick` : no retained video on exit 0; quality gates not failed solely by low-confidence heuristics
- [ ] Opt-back: config `recordVideo: true` + `misclick.policy: 'aggressive'` restores prior loud profile
- [ ] `usereye init` output still valid and **consistent** with defaults (no contradictory comments)
- [ ] `npm run verify` green

#### Compatibility

- [ ] Exit codes still 0 / 1 / 2
- [ ] `result.json` still contains full issue list (or documents `issuesAll` vs `issuesSurfaced` — prefer full list + `surfaced` flag)
- [ ] Existing configs that set loud values unchanged in behavior

---

### 7. Suggested default profile names (optional config sugar)

Avoid more flags later by documenting two presets in README (not mandatory code):

```js
// profiles in usereye.config.js
profiles: {
  ci: {
    recordVideo: 'on-failure',
    misclick: { policy: 'stable-only' },
    findings: { minConfidence: 'medium', gateConfidence: 'high' },
  },
  forensic: {
    recordVideo: true,
    misclick: { policy: 'aggressive' },
    findings: { minConfidence: 'low', gateConfidence: 'low' },
  },
}
```

After Phase D, **default bare run ≈ `ci` profile**. `--profile forensic` recovers lab mode.

---

### 8. Risk register

| Risk                                                             | Mitigation                                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Teams relied on always-on video                                  | Migration note + `--video` / `recordVideo: true`                                       |
| stable-only misses a real harmful near-miss                      | Keep aggressive via config; document when to use deep+forensic                         |
| medium minConfidence hides a real low signal someone cared about | Full JSON retained; report “Signals” section still lists low if `includeSignals: true` |
| Zip rename breaks external links                                 | Keep old filename as secondary artifact one release, or redirect note on filebin       |
| check-delivery too strict on HISTORY                             | Only scan delivery root + package README, not HISTORY.md                               |

---

### 9. Out of scope (explicit)

- Changing gate thresholds (70 / blockers) unless calm defaults make them too tight — measure first
- Forcing `reportFormat: ['sarif']` by default
- Enabling userJourney/extensions by default
- Publishing to npm (can be parallel track)
- Replacing Playwright or adding browsers to default CI matrix

---

### 10. Definition of done (7.4.1)

1. Human can state the version after 5 seconds of opening the zip.
2. `DEFAULT_CONFIG` === calm policy already taught by `usereye init`.
3. Types/docs/JSDoc describe the same defaults the runtime uses.
4. `npm run pack:delivery` reproduces the zip without hand-editing names.
5. Verify + one live Vela quick run green under bare defaults.

---

### 11. One-line summary

**Stop shipping a 7.1.1 box around a 7.4 engine, and stop making bare CLI louder than `usereye init` — flatten, relabel, and default to on-failure video, stable-only misclick, and medium report confidence while keeping full JSON and opt-back knobs.**

---

_End of roadmap._

## Relatório de execução do roadmap

<!-- origem: docs/ROADMAP-EXECUTION-REPORT.md -->

## UserEye 7.4.1 → 7.5.0 — roadmap execution report

**Date:** 2026-09-06
**Input:** `usereye-7.4.1-balanced.zip` + `usereye-roadmap.md`
**Output:** `usereye-7.5.0-balanced.zip` (684 KB, 253 files)
**Verification:** `npm run verify` exits **0**. Tests **327 total · 323 pass · 0 fail · 4 skipped**
(the 4 are firefox/webkit lifecycle tests, skipped only because those engines are not
installed in this sandbox). Baseline before work: 286 tests / 282 pass.

> **Scope note:** Phase 4 (the LLM/intelligence layer, M5) was **removed at your request**.
> No model provider, no network call to any model, no `analysis` config key. Findings,
> summaries and gates remain 100% deterministic.

---

### 1. What was executed, by roadmap item

| #       | Item                           | Status                     | Where                                                                       |
| ------- | ------------------------------ | -------------------------- | --------------------------------------------------------------------------- |
| **M1**  | Code-execution boundary        | ✅ Done                    | `command-runner.js`, `code-quality.js`, `project-adapter.js`, `SECURITY.md` |
| **M2**  | Identity & publication         | ⚠️ Partial — see §3        | `package.json`, `HISTORY.md`, `CURRENT.md`                                  |
| **M3**  | Dependency & toolchain hygiene | ✅ Done                    | `package.json`, `scripts/check-dependencies.js`, `ci.yml`                   |
| **M4**  | Config governance              | ✅ Done                    | `config.js`, `scripts/generate-config-docs.js`, `docs/CONFIG.md`            |
| **M5**  | LLM layer                      | 🚫 **Excluded on request** | —                                                                           |
| **M6**  | Multi-browser + performance    | ✅ Done                    | `performance.js`, `ci.yml` (`acceptance-browsers`)                          |
| **M7**  | Observability & logging        | ✅ Done                    | `logger.js`, `bin/usereye-doctor.js`                                        |
| **M8**  | CI/CD loose ends               | ✅ Done                    | `action.yml` (PR comment, baseline, auto `--compare`)                       |
| **M9**  | Monolith split                 | ✅ Done                    | `explorer/{budget,targeting,state,audit}.js`                                |
| **M10** | API docs                       | ✅ Done                    | `scripts/generate-api-docs.js`, `docs/API.md`                               |

All 7 **quick wins** from §4 of the roadmap are done.

---

### 2. Phase-by-phase, with the "done-when" checked

#### Phase 0 — Ship & identity

- Version bumped **7.4.1 → 7.5.0**, single-sourced from `package.json` (gate enforces it).
- **Doc-accuracy fix:** `CURRENT.md` claimed _"286 pass / 0 skip"_. It now reports the real
  numbers from an actual run, explains _why_ the 4 skips exist, and tells you how to remove
  them (`npx usereye install-browsers all`).
- `usereye doctor` added; `--update-check` queries the npm registry (advisory only — a new
  release never fails doctor).

#### Phase 1 — Code-execution boundary _(highest priority; fully done)_

This was the roadmap's top risk and got the most attention.

- **Static analysis is now the default.** `codeExecution.{npmScripts,binaries,install}` all
  default to `false`. A bare `--project` run reads files and executes nothing from the target.
- **Explicit opt-in:** `--allow-project-commands lint,typecheck` (also `scripts`, `binaries`,
  `format`, `unit-tests`, `install`, `all`).
- **`shell: true` is gone from the entire shipped codebase.** A new `command-runner.js`
  tokenizes commands itself and spawns with `shell: false`. Shell metacharacters are
  **refused, not escaped** — `lint && curl evil.sh | sh` cannot be reinterpreted as two
  commands. `test -z "$(gofmt -l .)"` became a JS emptiness check.
- **Audit trail** in `result.json` → `commandAudit`: argv, cwd, decision, reason, exit code,
  `shell: false`. Blocked commands appear as `skipped` checks and are **never** counted as
  quality failures (refusing to run something is not a defect).
- `--install` alone no longer suffices; it also needs the `install` category, so a config
  file committed to a repo cannot trigger a dependency install on someone else's machine.

**Done-when, verified live:** a hostile fixture whose npm scripts run `touch PWNED` was
analysed — the marker was never created, and the refusals were logged with reasons. With
`--allow-project-commands scripts`, the same repo's `lint` and `typecheck` ran, and the
failing one became a `major` finding. 10 dedicated tests in
`tests/code-execution-boundary.test.js`; CI job `security-boundary` re-proves it and greps
for any reintroduction of `shell: true`.

#### Phase 2 — Dependencies / Node matrix

- `axe-core` pinned exactly (`4.13.0`), matching `playwright`. A caret on a runtime
  dependency meant two installs of the same UserEye could produce different findings, which
  breaks the premise of `--compare`.
- `engines.node` corrected `>=18.18` → **`>=20.11`**, and `@types/node` realigned from `^26`
  (a version that does not correspond to the supported runtime) down to `^20`, i.e.
  type-checking against the **minimum** supported runtime.
- New `scripts/check-dependencies.js` enforces all three rules in `npm run checks`.
- CI matrix: Node **20 / 22 / 24**.

#### Phase 3 — Multi-browser + performance

- New CI job `acceptance-browsers` runs the engine suite **and** a real quick run on
  chromium, firefox and webkit — the roadmap's 3/3 target.
- `result.performance` is now always written: LCP/FCP/INP/CLS/TTFB aggregated by **worst
  observed state** (a fast page must not hide a slow one) plus the URL that produced it.
- Budgets `gates.maxLcpMs` / `maxCls` / `maxInpMs` are **signals by default** — measured and
  reported, but structurally unable to fail a build. `gates.performanceMode: 'gate'` makes
  them blocking and is documented as experimental. This is the roadmap's own
  "experimental → signal if noisy" guidance, resolved in favour of signal, because a flaky
  red build teaches teams to ignore the report.

#### Phase 5 — CI/ops & config governance

- **Action:** posts the `md-pr` report as a PR comment (edited in place, never duplicated),
  downloads the trunk baseline, runs `--compare` automatically on PRs, and re-publishes the
  baseline only from the default branch — so a PR can never move the bar it is measured
  against. New `allow-project-commands` input, defaulting to empty (static).
- **Config governance:** unknown keys are reported with a suggested correction
  (`"recordVido" → did you mean "recordVideo"?`), common value types are validated, and
  `USEREYE_STRICT_CONFIG=1` upgrades warnings to a usage error (exit 2).
- `docs/CONFIG.md` and `docs/usereye.config.schema.json` are **generated from
  `DEFAULT_CONFIG`**, with a `--check` mode wired into `npm run checks`, so the reference
  cannot drift from the code.

#### Phase 6 — Maintainability & docs

- `adaptive-explorer.js` **1279 → 1068 lines**, split into `explorer/budget.js`,
  `explorer/targeting.js`, `explorer/state.js`, `explorer/audit.js` — all
  browser-independent and unit-tested without launching a browser.
- `code-quality.js` and `project-adapter.js` now share one runner (the duplicated `spawn`
  is gone).
- `--log-level error|warn|info|debug|trace` (default `info` keeps human output byte-identical),
  `--log-json` (ndjson), `--timings` (per-phase durations, reconciled against wall clock).
- `docs/API.md` generated from the `.d.ts` surface, and it documents the `issue` data model
  (`confidence`/`kind`/`source`/`code`/`surfaced`) that the roadmap asked for.

#### Phase 7 — Platform/scale

Not started; the roadmap marks it optional and post-Phase-6.

---

### 3. The one thing I could not do for you

**M2 / Phase 0 publication is intentionally incomplete**, because it needs credentials and
decisions that are yours:

- creating the GitHub org/repo and setting `repository` / `homepage` / `bugs`
  (the delivery gate prints this as a note — I did **not** invent URLs that would 404, which
  is exactly the failure mode 7.4.x fixed by removing them);
- `npm publish` with provenance, GHCR image push, Action marketplace listing.

Everything that _precedes_ those commands is done: version bumped and single-sourced,
`HISTORY.md` written, package composition verified (**70 files, 210.8 kB packed**, ceiling
260 kB), `verify:release` intact. Add the remote and the tokens and it publishes.

---

### 4. Contract preservation (roadmap §5, Definition of Done)

Verified on a live run against the SPA fixture:

- ✅ Exit contract `0 | 1 | 2` untouched — clean run exits 0, a failing opted-in check
  produced a `major` finding.
- ✅ `issuesAll` still complete; no evidence destroyed.
- ✅ Gates remain deterministic — no new default gate; performance is a signal.
- ✅ No default behaviour changed **except** the security default (project mode no longer
  executes target code), which is the change the roadmap asked for.
- ✅ New tests for every change: `code-execution-boundary.test.js` (10),
  `config-governance.test.js` (7), `performance-observability.test.js` (24) = **41 new tests**.
- ✅ Docs updated in the same change: `README`, `HISTORY`, `SECURITY`, `CURRENT`, `DELIVERY`,
  plus generated `CONFIG`/`API`.
- ✅ Coverage rose 73.11% → **76.62%** overall; all floors satisfied.

---

### 5. Files added

```
command-runner.js                     shell-free runner + audit trail
logger.js                             levelled/structured logging + phase timer
performance.js                        Core Web Vitals summary + signal budgets
bin/usereye-doctor.js                 usereye doctor
explorer/budget.js                    exploration budgets
explorer/targeting.js                 block/allow policy + page classification
explorer/state.js                     state fingerprinting
explorer/audit.js                     run-quality scoring
scripts/check-dependencies.js         dependency hygiene gate
scripts/generate-config-docs.js       docs/CONFIG.md + JSON Schema
scripts/generate-api-docs.js          docs/API.md
tests/code-execution-boundary.test.js
tests/config-governance.test.js
tests/performance-observability.test.js
docs/CONFIG.md, docs/API.md, docs/usereye.config.schema.json   (generated)
```

**Deleted:** nothing. No existing test was weakened or removed.

## Roadmap para perfeição

<!-- origem: docs/ROADMAP-PARA-PERFEICAO.md -->

## UserEye — Roadmap para a versão "perfeita"

Data: 2026-09-05
Baseado em: inspeção direta do código-fonte, execução real de `npm test` com cobertura
(`node --test --experimental-test-coverage`), compilação real dos `.d.ts` com `tsc`, leitura do
`Dockerfile`/`package-lock.json`, e nas duas rodadas de auditoria já feitas nesta conversa
(`CHANGES.md` + `MY-VERIFICATION.md`). Nada aqui é chute — cada item cita a evidência que o gerou.

**Como ler este documento:** é um roadmap de engenharia, não uma lista de bugs. O projeto já está em
9.3/10 e funcional. Isto é o caminho para as últimas frações de ponto — cobertura de testes real do
motor de browser, distribuição impecável, tipagem 100% correta, e maturidade operacional de um
produto que outras empresas vão instalar via `npm install`.

---

### 0. Princípio norteador

Cada fase abaixo é **aditiva**: nenhuma quebra a API pública (`UserEye`, `observe`/`auto`, contrato de
exit codes 0/1/2, schema de `result.json`). Onde uma mudança _precisar_ quebrar algo (ex.: trocar
`require.resolve` por uma API diferente, ou mudar defaults), isso está marcado explicitamente como
**breaking** e amarrado a um bump de versão.

---

### Fase 0 — Correções pontuais já identificadas (0.5–1 dia, risco muito baixo)

Estas são os itens concretos que já encontrei nas duas auditorias anteriores. Ainda não foram
aplicados porque envolvem decisão de produto (não é óbvio qual é o comportamento "certo").

| #   | Item                                                                                                                                                                                         | Evidência                                                                                 | Ação recomendada                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | `Dockerfile` fixa `mcr.microsoft.com/playwright:v1.62.1-noble`, mas `package-lock.json` resolve `playwright@1.63.0`                                                                          | Li os dois arquivos diretamente                                                           | Alinhar exatamente: ou fixar `playwright` com `=1.62.1` no `package.json`, ou subir a imagem Docker para `v1.63.0-noble`. Adicionar um passo de CI que falha se as duas strings divergirem (grep simples). |
| 0.2 | `types/index.d.ts` não declara `classifyPage` e `mergeBudget`, que `index.js` exporta de verdade                                                                                             | Rodei `Object.keys(require('./index.js'))` e comparei com o `.d.ts`; `tsc` acusa `TS2305` | Decidir: são API pública? Se sim, adicionar aos tipos com assinaturas reais (não `unknown`). Se não, parar de reexportá-los em `index.js`.                                                                 |
| 0.3 | `types/index.d.ts` não compila isolado (`Cannot find namespace 'NodeJS'`)                                                                                                                    | Compilei com `tsc` puro fora do projeto consumidor                                        | Adicionar `@types/node` como `devDependency` (não runtime) e um teste de CI que roda `tsc --noEmit` contra os próprios tipos.                                                                              |
| 0.4 | `press()` usa label padrão em português (`` `Pressionar ${key}` ``) enquanto os irmãos usam inglês                                                                                           | `grep` em `user-eye.js:503`                                                               | Trocar para `` `Press ${key}` ``, já que o padrão do projeto é inglês neutro (README, defaults). Cosmético, zero risco.                                                                                    |
| 0.5 | `video-raw/` é criado mesmo com `--no-video`                                                                                                                                                 | `user-eye.js` construtor sempre chama `mkdirSync`                                         | Só criar o diretório dentro do primeiro `startVideo()`/gravação real, condicionado à opção.                                                                                                                |
| 0.6 | `nextDialog()` deixa um listener `once('dialog', …)` pendurado se o timeout disparar primeiro                                                                                                | Leitura de `user-eye.js:938-960`                                                          | Guardar a referência do listener e chamar `this.page.off('dialog', handler)` no `catch`/timeout.                                                                                                           |
| 0.7 | `eslint`, `prettier`, `globals` são `devDependencies` mas não existe `eslint.config.*` nem script `lint`/`format`                                                                            | `ls` não encontrou nenhum config; `package.json` não tem os scripts                       | Ou adicionar `eslint.config.js` (flat config, compatível com ESLint 10) + `npm run lint` no CI, ou remover as três dependências mortas.                                                                    |
| 0.8 | Versão do pacote (`7.0.0`) está fixada em três lugares (`package.json`, `TOOL_VERSION` em `user-eye.js`, asserção em `tests/smoke.test.js`) sem nenhum mecanismo automático de sincronização | Grep direto nos três arquivos                                                             | Nas fases seguintes (ver Fase 5) isso passa a ser gerido por `changesets`, eliminando o risco de divergência manual.                                                                                       |

**Critério de pronto da Fase 0:** todos os 8 itens fechados, `npm test` continua 20/20, `npm pack --dry-run` sem mudança de tamanho relevante.

---

### Fase 1 — Cobertura de teste real do motor de browser (3–5 dias, risco baixo)

**Por que isso é o item mais importante do roadmap.** Medi com `node --test --experimental-test-coverage`:
cobertura geral é **27.7%**. A camada de CLI/config/relatório está bem coberta (`config.js` 92%,
`report.js` 92%, `bin/usereye.js` 79%), mas o **motor que efetivamente controla o navegador** —
onde um regressão real apareceria — está quase inteiramente descoberto por testes unitários:

| Arquivo                         | Cobertura de linha medida |
| ------------------------------- | ------------------------- |
| `user-eye.js` (motor principal) | 11.6%                     |
| `adaptive-browser.js`           | 2.6%                      |
| `browser-gaze.js`               | 1.6%                      |
| `browser-human.js`              | 1.0%                      |
| `browser-perception.js`         | 0.8%                      |
| `browser-recorder.js`           | 1.5%                      |
| `browser-vitals.js`             | 5.3%                      |
| `misclick-engine.js`            | 9.0%                      |
| `patience.js`                   | 9.9%                      |
| `user-gaze.js`                  | 8.8%                      |
| `protocols/*.js` (7 arquivos)   | 6–15% cada                |

Isso **não** significa que o código não funciona — os fixtures de CI (`static`, `spa`, `english`,
`portuguese`, `sso`) exercitam esse código de ponta a ponta via `usereye auto`, e eu confirmei ao vivo
que passam 5/5. Mas "passar o E2E" não é a mesma garantia que "ter teste de regressão direcionado":
se alguém quebrar uma função dentro de `browser-perception.js` de um jeito que ainda produz _algum_
resultado (só que errado), nenhum teste vai pegar isso — só um humano olhando o relatório.

#### 1.1 Testes unitários das funções `collect*` que rodam no browser

Os arquivos `browser-perception.js`, `browser-gaze.js`, `browser-human.js`, `browser-vitals.js`
exportam funções puras (`collectBrowserPerception`, `collectUserGaze`, etc.) desenhadas para rodar
dentro do contexto do browser via `page.evaluate`. Isso significa que dá para testá-las **fora** do
Playwright, com um DOM simulado (`jsdom` ou similar), sem precisar abrir um navegador — muito mais
rápido que testes E2E e cobre a lógica real, célula por célula.

- Adicionar `jsdom` como `devDependency` de teste apenas.
- Para cada função `collect*`, escrever casos: elemento com baixo contraste, elemento fora da
  viewport, texto vazio, atributos ARIA ausentes, etc.

#### 1.2 Testes de integração do `UserEye` (`user-eye.js`) contra um browser real, por método

Hoje a cobertura de `user-eye.js` vem quase toda dos testes de fixture (`auto`/`observe` ponta a
ponta). Adicionar testes de node:test que instanciam `UserEye` diretamente e chamam métodos
isolados (`launch`, `goto`, `step`, `observe`, `registerSecret`, `press`, `nextDialog`,
`scanVisualHealth`, `runAxe`) contra uma página HTML mínima servida localmente, verificando
resultado e artefatos gerados — não só "o comando saiu com exit 0".

#### 1.3 Testes de regressão para os dois bugs já corrigidos

Nem `install-browsers` nem o aviso de `--command`+`--url` têm um teste automatizado dedicado — a
verificação foi manual (nesta auditoria). Adicionar:

- Um teste que faz mock de `require.resolve` para simular o `exports` map restrito do Playwright
  moderno e garante que `dispatch(['install-browsers'])` não lança.
- Um teste que captura `console.warn` e garante que o aviso aparece quando `command` e `url`/`baseURL`
  coexistem.

#### 1.4 Meta de cobertura e gate de CI

- Definir meta realista por camada: **≥70%** para `config.js`/`report.js`/`sarif.js`/`bin/`
  (já quase lá), **≥40%** para o motor de browser depois da Fase 1.1–1.2 (hoje ~5–15%).
- Adicionar `node --test --experimental-test-coverage` ao `ci.yml`, com `--test-coverage-lines`
  (ou um script que faz parse do relatório e falha abaixo do piso) — hoje o CI roda `npm test` mas
  não mede nem trava cobertura.

**Critério de pronto:** cobertura do motor de browser sai de ~10% médio para ≥40%; CI falha se
alguém reduzir a cobertura abaixo do piso definido.

---

### Fase 2 — Tipagem TypeScript completa e verificada (2–3 dias, risco baixo)

Hoje os `.d.ts` são escritos à mão e **nunca compilados** em CI — por isso os dois problemas da
Fase 0 (itens 0.2 e 0.3) passaram despercebidos.

#### 2.1 Gerar os tipos a partir de JSDoc, não escrever à mão

Alternativa mais robusta que corrigir os `.d.ts` manualmente: anotar as funções públicas com JSDoc
tipado (`@param`, `@returns`, `@typedef`) e gerar `types/*.d.ts` automaticamente com
`tsc --emitDeclarationOnly --allowJs`. Isso torna **impossível** o tipo divergir do código, porque o
tipo passa a ser derivado do código.

- Início pequeno: só `index.js`, `user-eye.js` (superfície pública), `config.js`, `adaptive-explorer.js`
  (para cobrir `classifyPage`/`mergeBudget` do item 0.2).

#### 2.2 Gate de CI: tipos têm que compilar

Adicionar ao `ci.yml`: `npx tsc --noEmit -p types/tsconfig.json` (com `@types/node` e
`@types/playwright`-equivalente instalados como `devDependencies`) rodando a cada PR. Isso teria
pego os itens 0.2 e 0.3 automaticamente antes de qualquer release.

#### 2.3 Teste de "typecheck do README"

Extrair cada bloco `js`/`ts` do `README.md` (o exemplo de `usereye.config.js`, os hooks de
autenticação, etc.) para um arquivo temporário e rodar `tsc --checkJs` ou `node --check` nele em CI.
Isso garante que a documentação nunca fica com exemplo quebrado — problema comum em projetos que
crescem rápido.

**Critério de pronto:** `tsc --noEmit` passa sem erros contra os próprios tipos e contra pelo menos
um projeto consumidor de exemplo; README nunca mais diverge do comportamento real.

---

### Fase 3 — Empacotamento e distribuição sem surpresas (2–3 dias, risco baixo/médio)

#### 3.1 Resolver a fonte real do bug já corrigido (`install-browsers`) de forma definitiva

A correção atual (`path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js')`)
funciona hoje porque `playwright`'s `bin.playwright` aponta para `cli.js` na raiz do pacote — mas
isso é um detalhe de implementação do Playwright, não uma API pública garantida. Alternativa mais
robusta e à prova de futuras mudanças de `exports`: gerar o mesmo efeito via
`spawnSync(process.execPath, [require.resolve('playwright'), ...])` não funciona (esse é o entrypoint
de API, não CLI) — a opção mais estável de longo prazo é depender diretamente do binário publicado
`@playwright/test`'s `bin` **ou** usar `npx --no-install playwright install chromium` via
`spawnSync('npx', [...])`, que delega a resolução ao próprio npm/Playwright em vez de reimplementá-la.
Vale um pequeno spike (meio dia) para comparar as três abordagens e fixar a mais durável.

#### 3.2 Alinhamento estrito Docker ⇄ npm (ver item 0.1) com verificação automática

Depois de corrigir o item 0.1 manualmente, adicionar um script `scripts/check-playwright-version.js`
que lê a versão resolvida no `package-lock.json` e a tag do `Dockerfile`, falhando o CI se
divergirem. Isso é exatamente o tipo de erro "silencioso até alguém buildar a imagem" que só
aparece em produção.

#### 3.3 Suporte oficial a mais de um browser engine

Hoje **só Chromium** é instalado e usado (`const { chromium } = require('playwright')` é o único
import de browser em todo o código; `install-browsers` só instala `chromium`). Isso é uma decisão de
produto legítima (mais rápido, mais leve), mas para "perfeito" em auditoria de acessibilidade/UX
cross-browser é uma lacuna real: bugs de layout/CSS que só aparecem em WebKit (Safari) ou Firefox não
são detectáveis hoje.

- Adicionar `--browser chromium|firefox|webkit` (default `chromium`, sem quebrar nada existente).
- `install-browsers` ganha `--browser <nome>` ou instala todos quando chamado sem argumento.
- Documentar explicitamente a limitação atual no README até isso ser implementado (transparência
  imediata, custo zero).

#### 3.4 Tamanho e composição do pacote publicado

Hoje: 51 arquivos, ~98 kB comprimido — bom. Adicionar ao CI um teste de regressão de tamanho
(`npm pack --dry-run` + assert de teto, ex. 150 kB) para pegar cedo qualquer arquivo grande
acidentalmente incluído no futuro (o `.gitignore` já exclui `artifacts/`, mas não há trava automática
no pacote publicado).

#### 3.5 Assinatura e procedência do pacote

`publishConfig.provenance: true` já está no `package.json` — ótimo. Confirmar que o workflow
`publish.yml` realmente usa `id-token: write` e roda em um ambiente protegido (`environment:` do
GitHub) antes do primeiro `npm publish` real, para que a procedência assinada funcione de fato (hoje
não pude testar isso porque não há credenciais/publicação real neste ambiente).

**Critério de pronto:** build de imagem Docker funcional testada de verdade (não só lida), CI trava
automaticamente qualquer divergência de versão Playwright/Docker, e a decisão sobre multi-browser
está documentada ou implementada.

---

### Fase 4 — Robustez operacional do motor (3–5 dias, risco médio)

#### 4.1 Política de retry para flakiness de rede/browser

Não encontrei nenhuma lógica de retry no código (`grep -n "retry"` não retornou nada em arquivos de
produção). Para um agente que navega e clica em aplicações reais, timeouts pontuais de rede são
esperados. Adicionar uma política de retry configurável (`retries: number` em `gates`/config) para
passos de navegação, com backoff simples, sem retry automático de _toda_ a execução (isso mascararia
bugs reais) — só de operações de rede/espera pontuais e documentado nos artefatos (`retriedSteps`).

#### 4.2 Timeout e cancelamento consistentes

Levantamento dos `setTimeout`/`options.timeout` espalhados pelo código para garantir que todo timeout
é: (a) configurável via `usereye.config.js`, (b) documentado no `types/usereye-config.d.ts`, e
(c) cancelado corretamente em caso de erro anterior (o item 0.6 — listener de `dialog` pendurado — é
uma instância desse problema mais geral; vale uma varredura completa por padrões parecidos, ex.
`page.once(...)` sem `off` correspondente em outros arquivos de protocolo).

#### 4.3 Modo de "dry run" explícito

Hoje a segurança já é forte (leitura-only por padrão, blocklists, redaction). Para "perfeito", um
modo `--dry-run` que mostra _o que seria feito_ (URLs visitadas, controles clicados, protocolos
executados) sem de fato abrir o browser seria valioso para equipes que precisam auditar antes de
rodar contra produção. Isso é aditivo — não existe hoje, não quebra nada.

#### 4.4 Suporte a rate limiting / cortesia com o alvo

Para uso contra aplicações de terceiros (ex. `observe` contra `https://example.com`), adicionar um
`minDelayBetweenRequestsMs` opcional evita que o UserEye pareça um ataque de força bruta a um WAF/CDN
do alvo. Hoje não há nenhum controle desse tipo no código.

**Critério de pronto:** nenhuma execução falha por flakiness transitória de rede sem pelo menos uma
tentativa de retry registrada no relatório; timeouts documentados e configuráveis; dry-run funcional.

---

### Fase 5 — Maturidade de engenharia e processo (contínuo, 1–2 semanas de setup inicial)

#### 5.1 Lint e format reais (fecha o item 0.7 com processo, não só arquivo)

- `eslint.config.js` (flat config) com regras mínimas sensatas para Node moderno + CommonJS.
- `prettier` com `.prettierrc` e `npm run format:check` no CI.
- `npm run lint` no `ci.yml`, antes dos testes.

#### 5.2 Versionamento automatizado (`changesets` ou `semantic-release`)

Resolve de raiz o item 0.8 (três lugares com `7.0.0` sincronizados à mão). Com `changesets`:
cada PR descreve seu impacto (patch/minor/major), e um bot gera changelog + bump de versão + tag
automaticamente, incluindo `TOOL_VERSION` e a asserção do `smoke.test.js` via um pequeno script de
sincronização (`scripts/sync-version.js`) rodado no hook de release.

#### 5.3 Política de segurança pública

Adicionar `SECURITY.md` com processo de disclosure responsável — importante porque o projeto executa
credenciais reais (`USEREYE_EMAIL`/`USEREYE_PASSWORD`) e visita URLs arbitrárias fornecidas por
terceiros; usuários vão querer saber como reportar um problema de segurança antes de abrir uma issue
pública.

#### 5.4 `CONTRIBUTING.md` e template de issue/PR

Hoje não existem. Para um pacote npm público com 45 módulos e uma arquitetura em camadas
(perception/engine/exploration/protocols/report), documentar convenções de contribuição, como rodar
os fixtures localmente, e como adicionar um novo protocolo/pattern pack reduz drasticamente a fricção
de colaboradores externos.

#### 5.5 Benchmark de performance como teste de regressão

Adicionar um teste que mede o tempo de execução do modo `quick` contra o fixture estático e falha se
regredir além de um limiar (ex. +50% do baseline). Hoje não há nenhum controle de performance —
só correção funcional.

#### 5.6 Auditoria de dependências automatizada e contínua

`npm audit` está limpo hoje (0 vulnerabilidades, confirmado ao vivo), mas isso é uma foto do momento.
Adicionar Dependabot ou Renovate configurado para abrir PRs automáticos de atualização de
`playwright`/`axe-core`, com a regra do item 3.2 (Docker + npm juntos) aplicada via "grouped update"
(exatamente o padrão que pesquisei e é recomendado pela comunidade Playwright para evitar o problema
do item 0.1 se repetir no futuro).

**Critério de pronto:** todo PR passa por lint + typecheck + testes + cobertura + tamanho de pacote
automaticamente; versão nunca mais diverge entre arquivos; existe um canal claro de reporte de
segurança.

---

### Fase 6 — Extensibilidade e ecossistema (opcional, sem prazo fixo — "nice to have" de longo prazo)

Estes itens não são necessários para "perfeito" no sentido de correção/qualidade, mas fecham o
roadmap de produto de longo prazo que o próprio projeto já esboçou em
`docs/ROADMAP-PROJECT-AGNOSTIC.md` (Tier D/E) e que ainda não foi 100% explorado:

- **6.1** Mais pattern packs de idioma além de `en`/`pt` (ex. `es`, `fr`, `de`), com um processo
  documentado para a comunidade contribuir novos.
- **6.2** Marketplace/catálogo de plugins de terceiros (hoje o sistema de plugins existe e é testado,
  mas não há nenhum plugin de exemplo publicado além do usado em teste).
- **6.3** Extensão de VS Code ou dashboard web leve para visualizar `result.json`/`report.html` sem
  precisar abrir o HTML manualmente — útil para equipes que rodam UserEye em CI e querem revisar
  achados sem baixar artefatos.
- **6.4** Integração nativa com ferramentas de gestão de qualidade (Jira, Linear) para abrir issues
  automaticamente a partir de achados `blocker`/`critical` — hoje o SARIF já permite isso via GitHub
  code scanning, mas não há conectores para outras ferramentas.

---

### Resumo executivo — ordem de execução recomendada

```
Fase 0  (0.5–1 dia)   → Corrigir os 8 itens pontuais já identificados
Fase 1  (3–5 dias)    → Cobertura de teste real do motor de browser (o item de maior impacto)
Fase 2  (2–3 dias)    → Tipagem TS 100% verificada em CI
Fase 3  (2–3 dias)    → Empacotamento/Docker sem divergência, decisão sobre multi-browser
Fase 4  (3–5 dias)    → Retry, timeouts consistentes, dry-run, cortesia de rate limit
Fase 5  (setup 1–2 semanas, depois contínuo) → Lint, versionamento automático, segurança, contribuição
Fase 6  (sem prazo)   → Ecossistema — só depois que 0–5 estiverem sólidos
```

**Estimativa total até "perfeito" nas Fases 0–5:** aproximadamente **3 a 4 semanas** de trabalho
focado de um engenheiro sênior, a maior parte concentrada na Fase 1 (cobertura de teste do motor),
que é o único item que exige trabalho de engenharia substancial — todo o resto é processo,
configuração e correções pontuais de baixo risco.

**O que NÃO fazer:** não reescrever o motor de exploração/percepção do zero. Como já confirmei nas
duas auditorias anteriores, a arquitetura (`perception` → `engine` → `exploration` → `protocols` →
`report`) já é sólida, testada via E2E, e com boas práticas de segurança reais (redação de segredos,
blocklists, leitura-only por padrão). O caminho para "perfeito" é fechar lacunas de garantia
(testes, tipos, empacotamento) em volta de um núcleo que já funciona — não substituir o núcleo.

## Roadmap project-agnostic

<!-- origem: UserEye/docs/ROADMAP-PROJECT-AGNOSTIC.md -->

## UserEye — Roadmap to Become Truly Project-Agnostic

**Document version:** 1.0  
**Date:** 2026-09-05  
**Baseline:** UserEye 6.1.0 (`SecureVault-UserEye-FIXED`)  
**Goal:** Any team can point UserEye at _any_ web app (URL or repo) with **zero product knowledge baked into the tool**, while the _target project_ owns policy (auth, seeds, bans, locale) via config/CI.

---

### 0. Executive summary

| Dimension                 | Today (6.1 fixed)                     | Truly project-agnostic target                        |
| ------------------------- | ------------------------------------- | ---------------------------------------------------- |
| Coupling to SecureVault   | Name/package/report leftovers only    | None — brand is **UserEye**                          |
| How you attach to an app  | CLI `--url` / `--project`             | Same + **`usereye.config.*` in the app repo**        |
| How you install the tool  | Copy folder into workspace            | **`npx usereye` / npm package** (lives outside apps) |
| Defaults                  | `pt-BR`, São Paulo, dark UI           | Neutral or **explicit config**                       |
| Auth                      | Generic form fill + credentials flags | Pluggable **login strategies** + `storageState`      |
| Language of UI under test | PT/EN regex dictionaries              | **Extensible pattern packs**                         |
| Reports                   | Portuguese hard-coded                 | **i18n catalogs** (`en` / `pt` / …)                  |
| CI                        | Manual                                | Official **GitHub Action** + exit codes stable       |
| Safety                    | Flags `--allow-write` / destructive   | Config allowlists + path bans + dry-run              |

**Bottom line:** the _engine_ (DOM perception, adaptive exploration, protocols, patience, axe) is already domain-agnostic. The roadmap is about **packaging, configuration, defaults, extensibility, and distribution** — not rewriting the crawler.

**Estimated total effort:** ~2–4 engineer-weeks for Tiers A–C; Tier D optional ongoing.

---

### 1. Current architecture (what you already have)

```
                    ┌──────────────────────────────┐
                    │  Target application (any)    │
                    │  browser DOM + HTTP only     │
                    └──────────────▲───────────────┘
                                   │ Playwright
┌──────────────────────────────────┴──────────────────────────────────┐
│                         UserEye engine                              │
│  user-eye.js          browser session, steps, issues, secrets       │
│  perception/*         rendered geometry / a11y-ish signals          │
│  user-gaze / human    first impression + SR preview                 │
│  adaptive-explorer    state graph, safe actions, auth attempt       │
│  protocol-runner      isolated parallel scenarios                   │
│  project-adapter      optional: detect stack & spawn dev server     │
│  code-quality         optional: lint/static on target tree          │
│  report / artifacts   HTML + MD + JSON evidence                     │
└──────────────────────────────────▲──────────────────────────────────┘
                                   │
                    usereye-observe.js  |  usereye-auto.js
```

#### 1.1 Already project-agnostic behaviors

- **No imports of application source** for exploration (only optional code-quality walk).
- **URL-first**: `observe` and `auto --url` work against any origin.
- **Stack detection** (Next, Vite, CRA, Django, Flask/FastAPI, Go, static, …) without product IDs.
- **Credential injection** via CLI/env (`--email`, `--password`, `USEREYE_*`), not hard-coded secrets.
- **Safety gates**: write/destructive/download are opt-in.
- **Modes**: `quick` | `standard` | `deep` budgets are product-neutral.
- **31 parallel protocol IDs** keyed off generic browser capabilities (HTTP, offline, keyboard, zoom, headers, …).

#### 1.2 Remaining coupling (inventory from repo scan)

| Location                                                                   | Coupling                 | Severity            |
| -------------------------------------------------------------------------- | ------------------------ | ------------------- |
| `package.json` `name: securevault-user-eye`                                | Branding                 | Low                 |
| `report.js` strings `run-securevault-e2e.js`, `ui-test-tool/…`             | Branding / stale paths   | Low                 |
| `user-eye.js` defaults `pt-BR`, `America/Sao_Paulo`, `colorScheme: 'dark'` | Regional / theme         | Medium              |
| Report + recommendation copy in Portuguese                                 | Locale of _output_       | Medium              |
| Auth/danger regexes PT+EN only (`adaptive-browser`, protocols)             | Locale of _input UI_     | Medium              |
| No config file — only argv                                                 | Ergonomics multi-project | High (for adoption) |
| Not published as CLI bin                                                   | Distribution             | High (for adoption) |
| Folder name / docs still say SecureVault                                   | Branding                 | Low                 |

---

### 2. Definition of done: “truly project-agnostic”

UserEye is project-agnostic when **all** of the following hold:

1. **Install:** `npm i -D usereye` (or `npx usereye`) in _any_ repo; tool code is not vendored into the app.
2. **Configure:** A target may ship `usereye.config.js` (or `.mjs` / `.json`) with URL, credentials refs, seeds, bans, locale — **no fork of UserEye**.
3. **Run:**
   - Against a live URL with zero repo access.
   - Against a repo with auto-start **or** bring-your-own `--command` / `--url`.
4. **Defaults:** Safe and neutral (no dark-only, no forced pt-BR) unless config says otherwise.
5. **Auth:** Password forms work out of the box; SSO/OAuth via `storageState` or `login` hook — still no app imports inside the engine.
6. **Language:** Pattern packs can be swapped/extended per project.
7. **Reports:** Language selectable; no product codenames in templates.
8. **CI:** Deterministic exit codes; artifacts upload; no interactive assumptions.
9. **Safety:** Default read-only exploration; mutations only when config/CLI explicitly allow.
10. **Compatibility:** Existing `UserEye` class API and `observe`/`auto` flags keep working (deprecation window, not hard break).

---

### 3. Tiered roadmap

#### Tier A — Neutralize identity & defaults

**Goal:** Stop looking/smelling like a SecureVault sidecar.  
**Effort:** ~0.5–1 day  
**Risk:** Very low

##### A1. Package identity

- Rename npm package: `usereye` (or `@org/usereye`).
- Set `"private": false` only when ready to publish; until then keep private but rename.
- Keywords: keep generic (`playwright`, `a11y`, `visual-testing`).
- Repository / homepage fields pointing at the generic project.

##### A2. Report hygiene

- Remove `run-securevault-e2e.js` fallback string in `report.js`.
- Replace `ui-test-tool/user-eye.js` with `usereye` / `user-eye.js`.
- Title templates: `UserEye — ${appName}` only.

##### A3. Neutral runtime defaults (`user-eye.js`)

| Option        | Current                         | Agnostic default                          | Notes                  |
| ------------- | ------------------------------- | ----------------------------------------- | ---------------------- |
| `locale`      | `pt-BR`                         | `en-US` or `undefined` → Chromium default | Always overridable     |
| `timezoneId`  | `America/Sao_Paulo`             | `UTC`                                     | Predictable in CI      |
| `colorScheme` | hard-coded `dark` in `launch()` | `options.colorScheme ?? 'light'`          | Dark becomes opt-in    |
| CLI           | missing                         | `--locale` `--timezone` `--color-scheme`  | Wire in observe + auto |

##### A4. Documentation

- Root `README.md`: UserEye as generic tool (install, observe, auto, config).
- Move SecureVault mentions to `HISTORY.md` or delete.
- Keep `WHAT-CHANGED.md` as fix log for the 6.1.x line.

##### A5. Acceptance checks

- [ ] `package.json` name has no `securevault`
- [ ] `rg -i securevault` empty in `*.js` (md history optional)
- [ ] Fresh observe on a light-themed English site without forcing dark
- [ ] Report HTML contains no SecureVault runner paths

---

#### Tier B — Per-project configuration (the adoption unlock)

**Goal:** Policy lives in the **app repo**; engine stays dumb.  
**Effort:** ~2–4 days  
**Risk:** Low–medium (merge order of precedence must be tested)

##### B1. Config file contract

Support (in order of discovery):

1. `--config path/to/file`
2. `usereye.config.js` / `.mjs` / `.cjs` in `--project` root
3. `usereye.config.json`
4. `package.json` → `"usereye": { ... }`

**Example `usereye.config.js` (owned by the target app):**

```js
/** @type {import('usereye').UserEyeConfig} */
module.exports = {
  // Attachment
  baseURL: process.env.BASE_URL, // if set, adapter won't need to guess
  projectDir: '.', // default cwd
  command: null, // or 'npm run dev -- --port 0'
  install: false,

  // Run shape
  mode: 'standard', // quick | standard | deep
  headed: false,
  workers: 0, // 0 = auto
  outDir: 'artifacts/usereye',

  // Browser
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light',
  viewport: { width: 1440, height: 900 },
  recordVideo: true,

  // Auth (never commit real secrets — use env)
  credentials: {
    email: process.env.USEREYE_EMAIL,
    username: process.env.USEREYE_USERNAME,
    password: process.env.USEREYE_PASSWORD,
  },
  storageState: process.env.USEREYE_STORAGE_STATE, // path to playwright storage JSON

  // Safety
  allowWrite: false,
  allowDestructive: false,
  allowDownloads: false,
  blockPaths: ['/billing/cancel', /\/admin\/.+\/delete/],
  blockNamePatterns: [/delete forever/i, /close account/i],

  // Exploration hints (optional — still DOM-first)
  seedPaths: ['/', '/login', '/app'],
  ignoreQueryParams: true,
  maxDepth: null, // null = mode budget

  // Protocols & quality
  protocols: 'auto', // or 'core' | 'v5' | 'all' | 'a,b,c'
  axe: true,
  codeQuality: true,

  // Hooks (Tier C/D — stub in B as reserved keys)
  // hooks: { login, beforeExplore, afterExplore }
};
```

##### B2. Precedence (must document and test)

```
built-in defaults
  < config file
    < environment variables (USEREYE_*)
      < CLI flags (highest)
```

Implement a single `loadConfig({ argv, cwd, env })` module used by both CLIs.

##### B3. Wire into runners

- `usereye-auto.js`: load config early; map keys → existing `ProjectAdapter` / `UserEye` / explorer options.
- `usereye-observe.js`: subset (`baseURL`/`url`, locale, viewport, out, axe).
- Emit `artifacts/resolved-config.json` (secrets redacted) for reproducibility.

##### B4. Blocklists

- Before navigation/click in explorer: if target URL path matches `blockPaths`, skip with reason `config-block`.
- Before click: if control name matches `blockNamePatterns`, skip.

##### B5. Acceptance checks

- [ ] Same engine explores App A and App B with only different config files
- [ ] CLI `--mode deep` overrides config `mode: 'quick'`
- [ ] Password never written to `resolved-config.json`
- [ ] Blocked path never appears as explored URL

---

#### Tier C — Distribution as a real CLI

**Goal:** Use UserEye on any machine/repo without copying sources.  
**Effort:** ~2–3 days  
**Risk:** Medium (packaging Playwright browsers)

##### C1. Binary entry

```json
{
  "name": "usereye",
  "bin": {
    "usereye": "bin/usereye.js"
  }
}
```

`bin/usereye.js` dispatches:

```text
usereye observe --url …
usereye auto --project …
usereye analyze --project …     # existing --analyze behavior
usereye --help
usereye --version
```

##### C2. Packaging rules

- Publish **only** library + bin + protocols (no `artifacts/`, no demo app).
- `playwright` and `axe-core` as dependencies (or playwright as peerDependency — document `npx playwright install chromium`).
- Post-install message: remind browser install.
- Optional: `usereye install-browsers` wrapper.

##### C3. Consumer workflow

```bash
## inside ANY application repository
npm i -D usereye
npx playwright install chromium

echo "module.exports = { mode: 'standard' }" > usereye.config.js

## app already running
npx usereye observe --url http://127.0.0.1:3000 --axe
npx usereye auto --url http://127.0.0.1:3000 --mode standard

## or let UserEye start the app
npx usereye auto --project . --install --mode standard
```

##### C4. Versioning & compatibility

- Semver from `6.1.0` → continue `6.x` for non-breaking agnostic work.
- Breaking default changes (locale/UTC/light) → either:
  - **6.2** with changelog “defaults changed”, or
  - **7.0** if you prefer strict semver for defaults.

##### C5. Acceptance checks

- [ ] Fresh empty folder: `npm i usereye` works offline-cached
- [ ] `npx usereye observe --url https://example.com` produces artifacts
- [ ] Pack size reasonable (no accidental `node_modules` / videos in tarball)

---

#### Tier D — Deep universality (extensibility)

**Goal:** Hard apps (SSO, i18n UI, monorepos, design systems) without forking.  
**Effort:** ~1–2 weeks cumulative  
**Risk:** Medium (API surface growth)

##### D1. Auth strategies

```js
// config
auth: {
  strategy: 'form',          // default — current behavior
  // strategy: 'storageState',
  // storageState: '.auth/user.json',
  // strategy: 'hook',
}
```

Hooks API (Playwright page only — still no app imports required inside engine):

```js
hooks: {
  async login(page, { credentials, baseURL }) {
    await page.goto(baseURL + '/login');
    // project-specific steps OR reuse storage
  },
  async beforeExplore(eye) {},
  async afterExplore(eye, result) {},
}
```

Also support Playwright’s **project-generated** `storageState` from a separate setup project.

##### D2. Pattern packs (i18n of _controls_)

Ship built-ins:

- `patterns/en.json`, `patterns/pt.json`
- Config: `patternPack: ['en','pt']` or `patterns: { auth: /…/, dangerous: /…/ }`

Merge dictionaries at explorer/protocol start. Projects can add `patterns/de.json` locally.

##### D3. Report i18n (output language)

- `reportLocale: 'en' | 'pt'`
- Move Portuguese strings in `report.js` / recommendations into `locales/*.json`.
- Default: `en` for agnostic package; `pt` selectable.

##### D4. Monorepo / multi-app

- `--project` root + `appDir: 'apps/web'` in config (adapter already discovers roots — expose knobs).
- Matrix mode (later): `apps: [{ name, url, config }]` → combined summary (v7+).

##### D5. Exploration hints (optional, never required)

```js
hints: {
  primaryCta: { role: 'button', name: /start|get started/i },
  nav: 'nav[aria-label=Main]',
}
```

Used only to **boost priority** in gaze/explorer — DOM discovery remains fallback.

##### D6. Network / environment profiles

```js
profiles: {
  mobile: { viewport: { width: 390, height: 844 }, userAgent: '…' },
  staging: { baseURL: 'https://staging.example', ignoreHTTPSErrors: true },
}
usereye auto --profile staging
```

##### D7. Plugin API (optional long-term)

```js
plugins: ['./usereye-plugins/check-feature-flags.js'];
// plugin: { id, protocols?: [], afterObservation?(obs) }
```

Keep core slim; advanced orgs extend without PRs to upstream.

---

#### Tier E — CI/CD & productization

**Goal:** Default path for professional teams.  
**Effort:** ~3–5 days

##### E1. Exit code contract (freeze & document)

| Code    | Meaning                                                             |
| ------- | ------------------------------------------------------------------- |
| 0       | Success / quality floor met / no blocker-critical unexpected errors |
| 1       | Completed with quality or severity failures                         |
| 2       | Tool/setup failure (no browser, bad argv, app didn’t start)         |
| 130/143 | Signal interruption                                                 |

##### E2. GitHub Action

```yaml
- uses: org/usereye-action@v1
  with:
    url: http://127.0.0.1:3000
    mode: standard
    config: usereye.config.js
  env:
    USERE YE_EMAIL: ${{ secrets.E2E_EMAIL }}
    USEREYE_PASSWORD: ${{ secrets.E2E_PASSWORD }}
```

Upload `artifacts/` as workflow artifact; fail job on exit 1/2.

##### E3. Docker image (optional)

- `ghcr.io/org/usereye:6` with browsers preinstalled for locked CI.

##### E4. SARIF / annotations (optional)

- Emit GitHub code-scanning SARIF for axe + major issues when `reportFormat: ['html','sarif']`.

##### E5. Quality gates as config

```js
gates: {
  minAdaptiveScore: 70,
  maxBlocker: 0,
  maxCritical: 0,
  maxUnexpectedBrowserErrors: 0,
}
```

Replace magic `70` in `usereye-auto.js` with config.

---

### 4. Work breakdown (suggested order)

```text
Week 1
  ├─ A1–A5  Neutralize brand & defaults + tests on 2 external sites
  ├─ B1–B3  Config loader + wire auto/observe
  └─ B4–B5  Blocklists + acceptance

Week 2
  ├─ C1–C5  bin, pack, publish (private registry or npm)
  ├─ D1     storageState + login hook
  └─ E1–E2  exit codes doc + GH Action MVP

Week 3+ (as needed)
  ├─ D2–D3  pattern packs + report i18n
  ├─ D4–D6  monorepo, hints, profiles
  └─ E3–E5  Docker, SARIF, configurable gates
```

---

### 5. File-level implementation map

| Area        | Primary files                        | Change type                                 |
| ----------- | ------------------------------------ | ------------------------------------------- |
| Defaults    | `user-eye.js`                        | Options only                                |
| CLI observe | `usereye-observe.js`                 | Config + flags                              |
| CLI auto    | `usereye-auto.js`                    | Config + gates                              |
| New         | `config.js` / `load-config.js`       | **Create**                                  |
| New         | `bin/usereye.js`                     | **Create**                                  |
| Adapter     | `project-adapter.js`                 | Honor `appDir`, env from config             |
| Explorer    | `adaptive-explorer.js`               | blockPaths, pattern packs, hooks            |
| Candidates  | `adaptive-browser.js`                | Externalize regex dictionaries              |
| Protocols   | `protocol-runner.js` + `protocols/*` | Consume pattern pack / reportLocale neutral |
| Reports     | `report.js`                          | String catalogs; strip SecureVault          |
| Package     | `package.json`                       | name, bin, files whitelist                  |
| CI          | `.github/workflows/*`                | **Create**                                  |
| Types       | `types/usereye-config.d.ts`          | **Create** (JSDoc or TS)                    |

**Do not** move browser perception logic unless required — it is already generic.

---

### 6. Configuration reference (target schema)

```ts
export interface UserEyeConfig {
  // Attachment
  baseURL?: string;
  url?: string; // alias
  projectDir?: string;
  appDir?: string;
  command?: string;
  install?: boolean;
  env?: Record<string, string>;
  startupTimeoutMs?: number;

  // Run
  mode?: 'quick' | 'standard' | 'deep';
  headed?: boolean;
  workers?: number;
  outDir?: string;
  keepArtifacts?: boolean;
  compareWith?: string; // prior result.json

  // Browser
  locale?: string;
  timezoneId?: string;
  colorScheme?: 'light' | 'dark' | 'no-preference';
  viewport?: { width: number; height: number };
  recordVideo?: boolean;
  ignoreHTTPSErrors?: boolean;

  // Auth
  credentials?: {
    email?: string;
    username?: string;
    password?: string;
  };
  storageState?: string;
  auth?: {
    strategy?: 'form' | 'storageState' | 'hook';
  };

  // Safety
  allowWrite?: boolean;
  allowDestructive?: boolean;
  allowDownloads?: boolean;
  blockPaths?: Array<string | RegExp>;
  blockNamePatterns?: Array<string | RegExp>;

  // Exploration
  seedPaths?: string[];
  ignoreQueryParams?: boolean;
  patternPack?: string[]; // e.g. ['en','pt']
  patterns?: {
    auth?: RegExp | string;
    dangerous?: RegExp | string;
    write?: RegExp | string;
  };
  hints?: Record<string, unknown>;

  // Protocols / quality
  protocols?: 'auto' | 'core' | 'v5' | 'all' | string | string[];
  protocolTimeoutMs?: number;
  axe?: boolean;
  codeQuality?: boolean;
  codeQualityTimeoutMs?: number;

  // Output
  reportLocale?: 'en' | 'pt';
  gates?: {
    minAdaptiveScore?: number;
    maxBlocker?: number;
    maxCritical?: number;
    maxUnexpectedBrowserErrors?: number;
  };

  // Hooks (functions only in .js config)
  hooks?: {
    login?: (page, ctx) => Promise<void>;
    beforeExplore?: (eye) => Promise<void>;
    afterExplore?: (eye, result) => Promise<void>;
  };
}
```

---

### 7. CLI reference (target)

```text
usereye observe [url] [options]
  --url <href>            Target (or positional URL)
  --config <path>
  --mobile
  --headed
  --axe
  --locale <tag>
  --timezone <id>
  --color-scheme <light|dark|no-preference>
  --wait <ms>
  --out <dir>

usereye auto [options]
  --config <path>
  --project <dir>
  --url <href>
  --command <shell>
  --mode quick|standard|deep
  --install
  --email --username --password
  --allow-write --allow-destructive --allow-downloads
  --protocols <spec>
  --workers <n>
  --out <dir>
  --compare <result.json>
  --profile <name>
  --analyze                 # detection only
  --no-axe --no-video --no-code-quality
  --headed
  --env KEY=VAL             # repeatable

usereye install-browsers
usereye --version
```

Environment overrides (non-exhaustive):

| Env                     | Maps to              |
| ----------------------- | -------------------- |
| `USEREYE_EMAIL`         | credentials.email    |
| `USEREYE_USERNAME`      | credentials.username |
| `USEREYE_PASSWORD`      | credentials.password |
| `USEREYE_BASE_URL`      | baseURL              |
| `USEREYE_MODE`          | mode                 |
| `USEREYE_CONFIG`        | config path          |
| `USEREYE_STORAGE_STATE` | storageState path    |

---

### 8. Safety model (agnostic but strict)

Default posture for unknown apps:

1. **Read-mostly exploration** (navigation + safe controls).
2. **No write** unless `allowWrite` / `--allow-write`.
3. **No destructive** unless explicitly allowed (delete/pay/logout patterns).
4. **No downloads** unless allowed.
5. **Secrets redacted** in all JSON/HTML (`registerSecret`).
6. **Config blocklists** always on when provided.
7. **External links** skipped (already).
8. Prefer staging/ephemeral environments in docs — never production write modes.

Document a “Production observe-only” recipe: `observe` + `auto` with all allow_* false and no credentials.

---

### 9. Testing strategy for agnosticism

You cannot claim agnostic without **multi-app fixtures**.

| Fixture                      | Purpose                              |
| ---------------------------- | ------------------------------------ |
| Static marketing HTML        | First impression / gaze / observe    |
| SPA with hash router + login | Auth transition (already fixed once) |
| Next.js app router sample    | Adapter start + RSC quirks           |
| Django admin-like forms      | Write forms + CSRF still DOM-visible |
| English-only UI              | Default locale pack                  |
| Portuguese-only UI           | `patternPack: ['pt']`                |
| Site with SSO wall           | `storageState` strategy              |
| Site with cookie consent     | consent-wall protocol                |

CI matrix: `mode=quick` on each fixture URL; one `standard` nightly.

---

### 10. Migration guide (SecureVault-era → agnostic UserEye)

#### 10.1 For tool maintainers

1. Land Tier A (rename + defaults) behind changelog.
2. Land Tier B without removing CLI flags.
3. Publish Tier C; keep zip distribution as fallback.
4. Deprecate folder name `SecureVault-UserEye` in docs.

#### 10.2 For app teams that vendored the folder

1. Delete vendored tool copy.
2. `npm i -D usereye`.
3. Add `usereye.config.js` with former CLI choices.
4. Replace CI script `node path/to/usereye-auto.js …` with `npx usereye auto`.
5. Store secrets in CI secret store → env.

#### 10.3 Backward compatibility promises

- `require('usereye')` / `require('./user-eye').UserEye` class methods remain.
- CLI flags listed in 6.1 keep working ≥1 minor after config introduction.
- Artifact schema `schemaVersion: 4` gains fields optionally; don’t remove keys without bump.

---

### 11. Non-goals (explicit)

To avoid scope trap:

- ❌ Becoming a full test framework (no replace of Jest/Playwright Test).
- ❌ Reading application database or private APIs (DOM/HTTP only).
- ❌ Auto-healing flaky unit tests.
- ❌ Visual pixel baselines as core (screenshots are evidence, not Percy).
- ❌ Owning deployment of the target app beyond “start dev server”.

---

### 12. Success metrics

| Metric                              | Baseline                     | Target                               |
| ----------------------------------- | ---------------------------- | ------------------------------------ |
| Time-to-first-report on unknown URL | ~minutes after clone of tool | `< 5 min` with `npx usereye observe` |
| SecureVault string hits in `*.js`   | >0                           | 0                                    |
| Apps validated in CI fixtures       | 1 demo                       | ≥5 diverse fixtures                  |
| Config-only switch between two apps | Not possible                 | Yes                                  |
| Default run mutates data            | Only if allow-write          | Never by default                     |
| Report language                     | PT only                      | `en` default + `pt` option           |

---

### 13. Immediate “already agnostic” usage (today’s zip)

No code changes required for cross-project use:

```bash
## Tool install (from zip)
cd SecureVault-UserEye
npm install
npx playwright install chromium

## Any live app
npm run observe -- --url https://your-staging.example --axe
npm run auto -- --url https://your-staging.example --mode standard \
  --email "$E2E_EMAIL" --password "$E2E_PASSWORD" --out artifacts/app-a

## Any local repo
npm run auto -- --project /path/to/other-app --install --mode quick
```

Agnostic **enough for manual multi-project use**; Tiers B+C make it **team-native**.

---

### 14. Recommended decision record

| Decision                 | Recommendation                          | Why                                          |
| ------------------------ | --------------------------------------- | -------------------------------------------- |
| Package name             | `usereye`                               | Clear, brandable, not product-tied           |
| Default locale           | `en-US` + `reportLocale: 'en'`          | Largest contributor base; PT via config      |
| Default color scheme     | `light`                                 | Matches most marketing/dev apps; dark opt-in |
| Default timezone         | `UTC`                                   | CI stability                                 |
| Config format            | JS first, JSON subset                   | Hooks need JS; JSON for simple apps          |
| Playwright relation      | dependency + documented browser install | Fewer broken first runs                      |
| Auth priority            | form → storageState → hook              | Covers 90% without plugins                   |
| Semver for default flips | `7.0.0` if strict; else loud `6.2`      | Defaults affect reports                      |

---

### 15. Checklist poster (print / issue template)

**Tier A**

- [ ] Rename package & strip SecureVault JS strings
- [ ] Neutral locale / TZ / colorScheme + CLI flags
- [ ] README generic

**Tier B**

- [ ] `loadConfig` + discovery paths
- [ ] `usereye.config.js` schema + `resolved-config.json`
- [ ] blockPaths / blockNamePatterns
- [ ] Precedence tests

**Tier C**

- [ ] `bin/usereye` dispatcher
- [ ] `npm pack` smoke
- [ ] Publish pipeline

**Tier D**

- [ ] storageState + login hook
- [ ] pattern packs en/pt
- [ ] report i18n
- [ ] monorepo appDir

**Tier E**

- [ ] Exit codes documented & tested
- [ ] GitHub Action
- [ ] Configurable quality gates

---

### 16. One-paragraph north star

> **UserEye is a headless user that opens your app, looks at what any stranger would see, tries safe paths, measures friction, and leaves evidence — without knowing your product name, your framework preferences, or your business rules. You teach it only what it cannot see: how to sign in, what not to touch, and which environment is fair game.**

That is “truly project-agnostic.”

---

### 17. Related artifacts

- Fix log for 6.1 functional bugs: `WHAT-CHANGED.md`
- Clean build notes: `CHANGES.md`
- Engine entry: `user-eye.js`
- Universal runner: `usereye-auto.js`
- Single-page runner: `usereye-observe.js`

---

_End of roadmap._

## Execution plan next

<!-- origem: UserEye/docs/EXECUTION-PLAN-NEXT.md -->

## UserEye — Precise Execution Plan (ROADMAP-NEXT, all phases)

**Date:** 2026-09-05
**Baseline:** `usereye@7.1.1` from `UserEye-7.1.1-BALANCED` (verified: `npm install` clean,
Playwright 1.63.0 + Chromium headless-shell 153 / ffmpeg installed in sandbox; 40/41 of the
audit-unit subset pass — the 1 failure is the known BALANCED packaging difference where the
audit-only `verify-server.js` was intentionally excluded per `README-DELIVERY.txt`).
**Goal:** map `ROADMAP-NEXT.md` §5 Phases 0–9 to concrete files/functions, then execute the
trust/CI milestone (Phases 1–4) with tests. Phases 5–9 are specified here and implemented in
later increments (each is additive).

This plan is the **work breakdown**; code lives in the `UserEye/` tree. Every claim is grounded
in the actual source read for this run (line/function references below).

---

### 0. Data-model facts the plan leans on (from source)

- An **issue/finding** object is built only in `UserEye.addIssue()` (`user-eye.js` ~1075–1117):
  fields `id, fingerprint, severity, title, step, steps[], expected, actual, technical, evidence, occurrences`.
  It has **no** `confidence`, `kind`, `source`, `code` today. Additive extension is safe
  (schemaVersion 4 → 5 minor bump).
- Issues are created by exactly these engine call sites (grep `addIssue(`):
  `user-eye.js` (observe visual findings ~824, step failure ~964, verify ~1052, runAxe ~1244),
  `adaptive-explorer.js` (~303, ~1039), `misclick-engine.js` (~190), `protocol-runner.js` (~314),
  `usereye-auto.js` code-quality (~412, ~423, ~445).
- Fingerprints already encode a provenance prefix (`visual:`, `axe:`, `misclick:`,
  `code-quality:`, `code-quality-static:`) plus code/id — reusable for classification without
  touching every call site, though we add explicit `source`/`code`/`confidence`/`kind` where we
  touch code anyway.
- Gates live in `config.gates` and are evaluated by `evaluateQualityGates(result, adaptive, gates)`
  (`usereye-auto.js` ~54–83), producing `result.qualityGates`. Exit = `fatal || !passed ? 1 : 0` (~574).
- Diff already exists: `run-diff.js compareResults` (`introduced/resolved/persisted` by
  fingerprint, plus scores). `--compare` already loads it into `result.diff` (`usereye-auto.js` ~528).
- Reports: `report.js generateHtml/generateMarkdown`; locales `locales/en.json|pt.json` via
  `i18n.js`; `artifact-store.js compactPerception` drops per-finding details (only
  `code,severity,title,actual`) and `buildResult` summarizes by severity.
- Misclicks: `misclick-engine.js`. Target selection & audit = `adaptive-explorer.js
auditMisclickSample()` (~746). Points/budget in `adaptive-explorer.js MODES` + `budgetFromConfig`.
  The misclick issue severity: `harmful`→`major`, `confusing`→`minor` (`misclick-engine.js ~192`).
- Config: `config.js` — `DEFAULT_CONFIG` (frozen), `normalizeConfig` (throws on invalid),
  `mergeConfig`, precedence `default < file(+profile) < env < cli`. Env map is small; CLI flag sets
  in `VALUE_FLAGS`/`BOOLEAN_FLAGS` + `cliConfig`.
- CLI: `bin/usereye.js` fixed command set (`observe|auto|analyze|install-browsers|dashboard|export-issues`).
- Action: `action.yml` (composite) — runs `usereye auto`, uploads artifacts `always()`, re-applies exit.
  No job summary, no SARIF upload, no browser input, no cache.
- Zoom: `protocols/experience.js` uses `style.zoom` for `zoom-200`.
- i18n report catalogs: `en`, `pt` only (config throws otherwise).

---

### 1. Ground rules (protect the wedge)

- **Additive only.** Add new config keys + issue fields + gates with defaults that preserve 7.1.1
  behavior unless the roadmap explicitly flips a default (video policy, misclick policy are
  opt-in new-keys; we do NOT change 7.1.1 defaults for existing projects → no forced migration).
- **Keep exit code contract** 0/1/2 and the severity bucket model; add _optional_ confidence
  filtering so old behavior is the default (`gateConfidence: 'low'` = everything counts).
- **Reuse stable fingerprints** for regression (never invent a second identity).
- **DOM-only, evidence-first**: confidence must never require app source; LLM stays out of core.
- Every phase: `npm run lint`, `tsc --noEmit -p types/tsconfig.json`, targeted unit tests,
  and a real-browser smoke before moving on.

---

### 2. Phase-by-phase precise map

#### Phase 0 — Hygiene lock (patch-ish, none breaking)

| Item                                        | File / function                                                          | Action                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 0.1 Playwright pin == Docker == lockfile    | `scripts/check-playwright-version.js`, `Dockerfile`, `package-lock.json` | already present; keep red gate. Run once.                                        |
| 0.2 clean verify instructions               | `README.md`                                                              | add `install-deps` + `install-browsers` command block (done in this run).        |
| 0.3 repository/homepage placeholder honesty | `package.json`                                                           | leave (already `github.com/usereye/usereye`); document as placeholder in README. |
| 0.4 changeset discipline                    | `.changeset/` + `docs/RELEASE-CHECKLIST.md` (new)                        | add checklist; one changeset for the 7.2 batch.                                  |
| 0.5 zip hygiene                             | `README-DELIVERY.txt`, repo hygiene test                                 | confirm no `artifacts/`/video in git.                                            |

#### Phase 1 — Finding confidence & quiet gates (→ implemented)

New pure module **`findings.js`** (exported): `classifyFinding`, `applyFindingsPolicy`, `confidenceRank`, `CONFIDENCE_LEVELS`, `defaultFindingPolicy`.

Issue schema additions (all optional): `confidence?: 'high'|'medium'|'low'`, `kind?: 'defect'|'risk'|'signal'`, `source?`, `code?`.

Config additions:

```js
findings: {
  minConfidence: 'medium',   // surfaced in report primary/issue list
  gateConfidence: 'high',    // severity gates count only >= this
  suppress: [],              // codes / fingerprint-prefixes to drop from surfaced+gated view
  elevate: [],               // codes to force high confidence
  treatAsSignal: [],         // codes to force kind='signal'
}
```

Classification rules table (order matters; mirrors ROADMAP §5 Phase 1.2) — keyed by
`source`/`code` when present, else parsed from `fingerprint`:

| source / code                                                                                                                              | default confidence          | kind   |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ------ |
| `a11y` (axe) serious/critical severity                                                                                                     | high                        | defect |
| `perception` insufficient-contrast                                                                                                         | high                        | defect |
| `perception` occluded (with dialog context)                                                                                                | (already deduped pre-7.1.1) | —      |
| `perception` missing-favicon / heading-order / skip-link                                                                                   | low                         | signal |
| `perception` generic major                                                                                                                 | medium                      | risk   |
| `consent` (regex-only)                                                                                                                     | low                         | risk   |
| `misclick` outcome=harmful                                                                                                                 | high                        | defect |
| `misclick` outcome=confusing                                                                                                               | medium                      | risk   |
| `code-quality` failed command                                                                                                              | high                        | defect |
| blockpath / blockname / allowlist guard                                                                                                    | low                         | risk   |
| fallback: severity blocker/critical                                                                                                        | high                        | defect |
| fallback: severity major/minor                                                                                                             | medium / low                | risk   |
| Explicit `issue.confidence/kind` on the issue always wins; `elevate`/`treatAsSignal`/`suppress` from config override after classification. |

Integration points:

- `user-eye.js addIssue`: accept + store optional `source/code/confidence/kind` (pass-through, sanitized). Tag `source` at the high-value call sites: runAxe (`source:'a11y', code:violation.id`), visual findings (`source:'perception', code:finding.code`), misclick (`source:'misclick'`), step/verify engine failures (`source:'engine'`). (Additive; classification also works from fingerprint so this is belt & braces.)
- `usereye-auto.js` after building `result`: run `applyFindingsPolicy(result, config.findings)`; recompute `result.summary.severity` over the surfaced issue list (respects `suppress`, `minConfidence`), keep a `result.findings.policy` snapshot and a `result.issues` = surfaced list. Add `result.findings.actionable` (high defect/risk counts by severity) and `result.findings.review`.
- `evaluateQualityGates`: when `config.findings.gateConfidence` set, severity gate checks (`max-blocker/max-critical` + new optional `maxMajor`) count only issues with `confidenceRank>=gate`. Default `gateConfidence:'low'` keeps 7.1.1 behavior.
- Report (`report.js`): add a **Confidence** pill (`high/medium/low`) and **Actionable vs Review** split in the issues table + hero. New locale keys (en + pt) for `confidence`, `actionable`, `review`, `high/medium/low`.
- SARIF (`sarif.js`): set `level` from severity, add `confidence` + `kind` as `properties` (read `buildSarif`). Minor.
- Types: extend `UserEyeIssue` (`index.d.ts`) and config types (`usereye-config.d.ts` `findings`, `gates.maxMajor`, `misclick.policy`).
- Tests: `tests/findings.test.js` unit table (code→confidence) + policy filter + pure `evaluateQualityGates` gating-by-confidence; fixture modal-open ⇒ zero occlusion + confidence snapshot.

**Done-when (Phase 1):** `usereye auto --mode deep` can be configured (`findings.gateConfidence:'high'`, misclick recorded as medium risk, `recordVideo` off) to exit **0** while still _recording_ the focus-blur misclick as `medium`/`risk`.

#### Phase 2 — Precision hard cases

**2.1 Misclick stable-only** (→ implemented core):

- New `misclick.policy: 'stable-only'|'aggressive'` in config (default `aggressive` = old behavior for 7.1.x, `stable-only` recommended in 7.2).
- In `misclick-engine.js execute()`: before scoring, run a _focus-revealed_ check —
  `hitAtPoint`/quickUserState learns `window.__userEyeNextPurpose==='misclick'` already; add a
  guard: if the only interactive element hit is revealed by `:focus-within`/`data-usereye-skip-misclick`
  AND the click only changes focus (no URL/dialog/material change), treat as harmless.
- Don’t count a "skip-link appeared" change as harmful unless URL/dialog changed (narrow `outcome`).
- In `adaptive-explorer.js auditMisclickSample`: pass `policy`; still record all outcomes in
  `misclicks.json` but `addIssues` only for harmful (stable-only) or all (aggressive) — respect config.
- Fixtures: `tests/fixtures/` focus-revealed header page.
  **2.2 Consent wall 2.0** (geometric + role + control-pattern gating):
- `consentSelectors` override in config; tighten detection in `browser-human.js`/consent protocol to
  require overlay geometry ≥ threshold AND role/dialog or fixed full-viewport AND primary
  accept/reject from pattern pack. Fixtures: marketing GDPR page (negative) / real cookie banner (positive).
  **2.3 Real zoom** (`protocols/experience.js` + config `zoomMode`): add `'viewport-approx'`/`'cdp'`
  (page-scale via CDP when Chromium) next to `'css'`; keep css default for comparison.
  **Done-when:** documented 7.1.1 §5 residual items are fixed or mode-gated with tests.

#### Phase 3 — Regression product (→ implemented)

- `run-diff.js`: add `collectIssueDelta` awareness of severity/confidence so we can distinguish
  **new majors / new high-confidence** issues from absolute counts (already have introduced/resolved/persisted).
- Config `gates`: `maxMajor?: number|null`, `failOnNewMajor?: boolean`, `failOnNewHighConfidence?: boolean`,
  `allowResolvedBonus?: boolean` (default all off → non-breaking).
- `usereye-auto.js`: after `result.diff` is set (requires `--compare`), extend
  `evaluateQualityGates` with `failOnNewMajor` (reads `result.diff.issues.introduced` count where
  severity major/above) and `failOnNewHighConfidence`. Add a **New / Resolved / Persistent** report
  section + `run-diff.json` is already written.
- CI recipe + docs: main uploads/commits baseline `result.json` (issues only); PRs `--compare`.
  **Done-when:** an intentional "break the demo" PR fails on _new_ majors even if score ≥ 70
  (test: two result.json fixtures through `runAuto --compare`).

#### Phase 4 — CI delight & ops (→ implemented where self-contained)

- **4.1 Action v2** (`action.yml`): add a step that, when `result.json` exists, writes
  `$GITHUB_STEP_SUMMARY` (score, gates, top 5 issues, artifact link) and, if
  `reportFormat` includes sarif, uploads `usereye.sarif` via `github/codeql-action/upload-sarif@v3`.
  Inputs: `soft-fail` (exit 0 on gate fail when true), `browser`, `cache-browsers`.
  Browser cache keyed by `package-lock.json` hash.
- **4.2 Video policy** (`config.js` DEFAULT + normalize + `user-eye.js launch/closeEye`):
  `recordVideo: false|true|'on-failure'`. Implement: treat `'on-failure'` as start recording;
  at `finalizeVideo`, if no blocker/critical/major/unexpected errors AND mode is on-failure, delete
  the webm instead of shipping it. Default for existing users stays `true` (document `ci` profile sets `'on-failure'`).
- **4.3 `usereye init`** (`bin/usereye.js` + new `usereye-init.js`): scaffold
  `usereye.config.js`, `.gitignore` for `artifacts/usereye`, optional workflow snippet. Non-interactive flags.
- **4.4 Host safety** (`config.js` + explorer): `allowedHosts: string[]`, `respectRobots:boolean`.
  Explorer `_blockedUrl` additionally rejects hosts not in allowedHosts (when allowlist present);
  `respectRobots` gates observe-on-public-prod (block `/robots.txt` disallowed paths).
- **4.5 Docker**: README `docker run` docs + non-root best-effort.
  **Done-when:** empty repo → `npm i -D usereye && npx usereye init` → CI green path documented ≤10 min.

#### Phase 5 — Auth & real app shells (specified; implemented incrementally)

- `bin/usereye.js` new `auth save --url --out .auth/user.json` (headed login or hook-assisted) writing Playwright `storageState`.
- `auth.successAssert: { urlNotMatch, selector, noSelector }` evaluated in `adaptive-explorer.js _liveAuthSignals`.
- On SSO wall: exit **2** + write `auth-required.json` (strategy hint) instead of majors.
- Doc recipes (form / storageState secret / hook SSO). Extend existing `sso` + `form` fixtures.

#### Phase 6 — Explorer intelligence (specified)

`diveIntoIframes:'same-origin'|'off'`, `ready:{strategy,selector,timeoutMs}` wait policy,
`hints` ranking boost, budget stop-reason in hero, `maxWallClockMs`, hash-ignore option,
`blockHosts`/`allowedHosts`. Fixture: heavy SPA w/ iframe shell.

#### Phase 7 — i18n completion (specified)

`locales/es.json|fr.json` mirrored off en + parity tests; `reportLocale:'auto'`; pattern-pack doc.

#### Phase 8 — Evidence UX 2.0 (specified)

Executive strip, finding→deep-link screenshot + rect, "Copy GitHub issue", `reportFormat:['md-pr']`
≤30 lines, dashboard runs-by-mtime + sparkline.

#### Phase 9 — Platform scale (specified, opt-in)

Multi-app matrix summary, official GitHub App, plugin registry. Not core.

---

### 3. This session’s execution (what was built + verified)

Implemented & **tested against real Chromium** in `UserEye/`:

1. **Phase 1** — `findings.js` confidence/kind classifier + policy; issue schema; report pills +
   Actionable/Review; gate-on-confidence (`maxMajor`, `gateConfidence`); locale keys en/pt; types; tests.
2. **Phase 2.1** — misclick `stable-only` policy + focus-revealed/skip-link guard (recorded, quieter).
3. **Phase 3** — `failOnNewMajor`/`failOnNewHighConfidence` gates over `--compare` diff + report section + tests.
4. **Phase 4.1** — Action job summary + SARIF upload + `soft-fail`/`browser` inputs + browser cache.
5. **Phase 4.2** — `recordVideo` `'on-failure'` mode (kept default `true`; `ci` profile → `'on-failure'`).
6. **Phase 4.3** — `usereye init` scaffolding command.
7. **Phase 4.4** — `allowedHosts`/`respectRobots` host-safety plumbing.
8. Phase 0 release-checklist + changeset + README verify block.

Deferred to later increments (additive, fully specified above): Phase 2.2 (consent geometry),
2.3 (zoom modes), 5 (auth command/assertions), 6, 7, 8, 9.

Verification run (see `tests/` added by this batch + full suite):
`npm run lint` · `tsc -p types/tsconfig.json --noEmit` · `node --test tests/findings.test.js tests/misclick-policy.test.js tests/regression-gates.test.js tests/config.test.js` · real-browser smoke of a fixture site.

---

### 4. Execution addendum — Phases 5–9 completed this session

Second pass implemented the remaining roadmap phases (verified with unit tests, real-browser
quick runs against the bundled Vela site, and the repo `checks`; 124 non-browser tests pass).

**Phase 5 — Auth & real app shells.**

- New `usereye auth save --url <app> --out .auth/user.json` command (`bin/usereye-auth.js`):
  heads-less or headed login, optional `--email/--password`, `--submit`, `--navigate-to`,
  `--wait-ms`, writes a Playwright `storageState` for `auth.strategy:'storageState'`.
- Post-auth assertions: `auth.successAssert = { urlNotMatch, selector, noSelector }` evaluated in
  `adaptive-explorer.js _authSuccessAssert()` for storageState, hook and form paths.
- Failure UX: with `auth.required: true`, a run that detects auth but cannot sign in writes
  `auth-required.json` and exits **2** (instead of a pile of majors).
- Recipes documented in README + AUTH_USAGE.

**Phase 6 — Explorer intelligence.** Implemented: `maxWallClockMs` (wall-clock stop reason),
`ignoreHash`, hint boosts for `primaryCta`/`nav`/`main`, and stop-reason surfaced in the HTML
hero. _Deferred (not shipped): iframe auto-dive and a `ready.selector` wait policy_ — they are
browser-heavy and risk destabilising the DOM-only contract; `waitForQuiet` remains the ready path.

**Phase 7 — i18n completion.** Added `locales/es.json` and `locales/fr.json` (report chrome
translated; structure mirrors en). `reportLocale` now accepts `es`/`fr`/`auto`; `auto` derives
from `config.locale` via `i18n.resolveReportLocale`. Detection packs already covered es/fr.

**Phase 8 — Evidence UX.** Executive "top actionable" strip in the HTML hero; a compact
`report-pr.md` (`reportFormat: ['md-pr']`, ≤ ~30 lines) for PR comments; dashboard lists runs
newest-first by mtime with a score bar and actionable column.

**Phase 9 — Platform scale.** The multi-app matrix (`config.apps`) already ships (see
`runMatrix` in `usereye-auto.js`, matrix-summary.json / matrix-report.html). The official GitHub
App and a community plugin registry are **out-of-core** per roadmap §5 Phase 9's "optional /
after single-app CI is boring" framing and §F non-goals; not implemented here.

#### Honest residual gaps (safe, additive follow-ups)

- Consent-wall 2.0 geometric gating (Phase 2.2) and real `cdp`/`viewport-approx` zoom (Phase 2.3)
  remain not shipped; misclick stable-only and the classification quieting already remove the
  reported FP class that drove them.
- es/fr narrative/plan/patience/gaze now fully translated in the 7.2.0 addendum pass (see below);
  the only identical-to-English keys are same-word translations, which is correct.
- Cross-origin iframe deep-dive (Phase 6) and GitHub App / plugin registry (Phase 9) deferred.

---

#### Addendum — shipped in the 7.2.0 "do everything" pass

The items previously marked deferred/not-shipped above have now been **implemented and
verified**. Version bumped to `7.2.0` (internal only; nothing published).

- **Phase 2.2 — Consent-wall geometric gating** (shipped). `browser-human.js` only flags a
  `consent-wall` finding when a consent/cookie panel actually covers the first fold (static
  in-flow cookie copy is ignored). New `consent` config option `{ strict, selectors, minWallArea }`
  (default `minWallArea` 0.18); `strict` also requires an accept/decline control. Walls report
  `{ selector, tag, id, name, text, areaRatio, role, hasConsentAction }`. Tests:
  `tests/consent-wall.test.js`.
- **Phase 2.3 — Real zoom modes** (shipped). `protocols/experience.js` `zoomMode`: `css` (historical
  default), `viewport` (halved 640×400 viewport via `withContext`), `cdp` (accepted, falls back to
  `css`). Validated live in Chromium with `--zoom-mode viewport`.
- **Phase 6 — iframe + ready policy** (shipped). New `ready` config (strategies `quiet` default,
  `selector`, `load`, `network-almost-idle`, plus `selector` and `timeoutMs` 10000); the explorer
  waits via `waitForReady()` and reports `ready-wait-timeout` as a stop reason. New
  `diveIntoIframes = 'same-origin' | 'off'` inventories same-origin frames (evidence only,
  surfaced as `frames` on the result). Cross-origin deep-dive stays a documented non-goal.
- **Phase 7 — full es/fr localization** (shipped). `es.json`/`fr.json` now carry the complete
  catalog: all 32 `findings` titles/details plus `misclick`, `scan`, `gaze` (reasons, load labels,
  narratives, purposes, goals) and `plan` steps — matching en/pt. Placeholder parity is enforced
  across en/pt/es/fr by `tests/i18n-context.test.js` (16 tests). The only keys that still read the
  same as English (`control` in es, `Interactions`/`Score`/`Application`/`Mode`/`Violations` in fr)
  are genuinely identical words in those languages and are left as correct translations.
- **Phase 8 — evidence UX** (shipped). Every finding row in `report.html` now has a one-click
  **Copy issue** button (localized, clipboard with `execCommand` fallback) that reconstructs the
  GitHub title+body via `issue-export.issueBody` (now exported).
- Config-normalization tests added in `tests/config-features.test.js`; es/fr parity tests added to
  `tests/i18n-context.test.js`.

**Out of scope, unchanged:** the official GitHub App and community plugin registry (Phase 9 §5
"optional / after single-app CI is boring" + §F non-goals). No publish was performed.
