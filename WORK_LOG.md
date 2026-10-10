# WORK_LOG — registro de iterações de desenvolvimento

> Cada execução autônoma adiciona uma entrada: data, foco, mudanças, checagens, status no GitHub, problemas conhecidos e próxima tarefa. Entradas em ordem cronológica reversa.

---

## 2026-10-10 · Iteração 3 — CI ativo na raiz (M1/issue #1) + fix de coverage no Node 24

**Foco escolhido:** ativar o CI do repositório (marco M1, issue #1) — os workflows originais do pacote (`src/usereye/.github/workflows/`) são invisíveis para o GitHub Actions, que só lê `.github/workflows/` na raiz. Antes disso, um **defeito bloqueador** apareceu no baseline e foi priorizado.

**Mudanças:**

1. **DEFECT — `scripts/check-coverage.js` quebrado no Node ≥24** (bloqueava `npm run verify` inteiro):
   - `node --test tests/` (diretório como argumento) não é portável: no Node 24.21 o runner tentou executar o diretório como módulo (MODULE_NOT_FOUND, 1 teste "fail"). O delivery original foi verificado no Node 20, onde funcionava.
     → Fix: descoberta explícita dos `tests/**/*.test.js` no script (walk recursivo + lista explícita ao runner) — funciona em Node 18/20/22/24.
   - O Node ≥24 também mudou o formato da tabela de cobertura: renderização em **árvore** (linhas de diretório sem %, filhos indentados 1 espaço/nível) + prefixo `ℹ` em todas as linhas. O parser antigo lia nomes como `"ℹ config.js"` → todos os floors reportados MISSING.
     → Fix: `parseCoverage` reconstrói caminhos da árvore (stack de diretórios por indentação), aceita também o formato plano (Node ≤22) e `normalize()` descarta caminhos que não existem no repo (cobertura de cópias temporárias dos testes de packaging, ex. `usereye-gate-copy-*/`, sem poluir floors).
   - Prettier aplicado ao arquivo editado (gate de formatação do próprio repo).
2. **M1 — CI na raiz**: `.github/workflows/ci.yml` adaptado do original do pacote (6 jobs: quality 20/22/24, engine, acceptance-browsers chromium/firefox/webkit, fixture-matrix, security-boundary, nightly) com `defaults.run.working-directory: src/usereye`, `cache-dependency-path` e paths de artefatos ajustados; job de coverage comenta a tabela em PRs.
3. **M1 — publish pronto para o M2**: `.github/workflows/publish.yml` adaptado (npm publish + container ghcr com `context: src/usereye`); disparo só em release/dispatch; exige `secrets.NPM_TOKEN` (a configurar no M2).
4. **Badge de CI** no README da raiz.
5. `src/usereye/.github/` mantido como referência histórica (inerte para o Actions).

**Checagens e resultados:**
- `npm run verify` (lint + format:check + typecheck + 446 testes + checks + coverage gate): **EXIT 0** no Node 24 — antes do fix: EXIT 1 (coverage MODULE_NOT_FOUND → depois floors MISSING).
- Parser validado offline contra stdout capturado: 25/25 engine files, média 86,4% (floor 40%), core ≥70%, overall 81,11% (floor 45%), zero vazamentos de temp-copies.
- YAML dos 2 workflows validado (6 jobs, wd, artifact paths).

**Status no GitHub:** commit na `main` (neste push); primeira execução real do Actions acompanhará o push.

**Problemas conhecidos:** `npm audit` reporta vulnerabilidades em devDependencies (triagem pendente — ver comentário na issue #1); WebKit leg do CI não roda localmente (validação real só no runner).

**Próxima tarefa útil:** verificar o run real do Actions (verde em todas as pernas, badge visível), fechar #1; então M2 (publicação npm + SARIF + secrets).
