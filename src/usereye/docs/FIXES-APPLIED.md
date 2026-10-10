# UserEye 7.5.1 — Correções aplicadas / What changed

**Auditado em:** 2026-09-07 · Node v20.20.2 · npm 10.8.2 · Linux (Debian 13) · Playwright 1.63.0
**Método:** nada foi adivinhado. Cada afirmação abaixo vem de um comando executado de verdade.

---

## TL;DR

O teu código **não estava quebrado**. Havia **1 bug real** (um teste que faltava) e
**9 ficheiros com formatação fora do padrão**. Tudo o resto que parecia "quebrado" era
**o ambiente**, não o projeto.

| Antes                                       | Depois                            |
| ------------------------------------------- | --------------------------------- |
| `npm test` → 436 testes, **43 falhas**      | 437 testes, **0 falhas**, 3 skips |
| `npm run verify` → falhava                  | **passa inteiro** (exit 0)        |
| `format:check` → 9 ficheiros fora do padrão | limpo                             |

---

## 1. As 43 falhas iniciais NÃO eram do teu código

**Sintoma:**

```
chrome-headless-shell: error while loading shared libraries:
libnspr4.so: cannot open shared object file: No such file or directory
```

**Causa:** o Chromium do Playwright foi descarregado, mas as **bibliotecas de sistema**
(libnspr4, libnss3, libatk, libcups, …) não estavam instaladas. Toda chamada a
`browserType.launch()` morria, e as 43 falhas eram todas o mesmo erro em cascata.

**Correção (ambiente, não código):**

```bash
npx playwright install chromium
sudo npx playwright install-deps chromium
```

Resultado imediato: **43 falhas → 1 falha**. Nenhum ficheiro foi tocado para isto.

> Isto é provavelmente o que te bloqueou tanto tempo. No Windows não aparece; em
> Linux/CI/Docker limpo é obrigatório. O teu `CURRENT.md` já documenta isto
> (`sudo npx playwright install-deps chromium`) — o passo só não tinha sido corrido.

---

## 2. O único bug real: gate de versão sem o teste que ele exige

**Falha:**

```
not ok 388 - hygiene: version single-source gate passes (items 0.8/5.2)
  sync-version: FAIL — tests/smoke.test.js should assert the CLI version
  against ../package.json.
```

**Causa:** `scripts/sync-version.js` (linha 41) exige que `tests/smoke.test.js` contenha
`require('../package.json')`:

```js
if (!/require\('\.\.\/package\.json'\)/.test(smoke)) {
  problems.push('tests/smoke.test.js should assert the CLI version against ../package.json.');
}
```

O `tests/smoke.test.js` entregue tinha só 3 testes (`analyze`, `matrix`, `exit code 2`)
e **nenhuma referência a `package.json`**. A asserção de versão existia, mas em
`tests/self-test.test.js` — ficheiro errado para este gate. Provavelmente foi movida
num refactor e o gate ficou órfão.

**Correção — `tests/smoke.test.js` (puramente aditiva):**

```js
const pkg = require('../package.json');

test('CLI --version matches package.json (single source of truth)', () => {
  const run = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.equal(run.stdout.trim(), pkg.version);
});
```

### O que esta função faz

- `require('../package.json')` — satisfaz o gate e lê a **fonte única de verdade** da versão.
- `spawnSync(node, [cli, '--version'])` — corre o CLI **como processo real**, não importa
  o módulo. Testa o binário como o utilizador o usa.
- `assert.equal(run.status, 0)` — o `--version` tem de sair com código 0.
- `assert.equal(run.stdout.trim(), pkg.version)` — impede que a versão do CLI e a do
  `package.json` divirjam (o que era exatamente o objetivo do gate 0.8/5.2).

**Nenhum teste existente foi alterado ou removido.** Só foi acrescentado 1 teste
(436 → 437).

Verificado:

```
sync-version: OK — 7.5.1 is single-sourced from package.json.
tests/repo-hygiene.test.js → 9/9 pass
```

---

## 3. Formatação: 9 ficheiros

`npm run format:check` reprovava:

```
docs/ARCHITECTURE.md  docs/AUDITS.md  docs/CHANGELOG.md  docs/CLI.md
docs/OPERATIONS.md    docs/README.md  docs/ROADMAP.md
perception.js         tests/hostile-page.test.js
```

Diferenças **100% cosméticas**:

- `perception.js` — um literal `viewport: {…}` longo demais para 1 linha (Prettier quebra em 8).
- `docs/*.md` — larguras de coluna de tabelas markdown desalinhadas (os acentos em PT
  contam como largura diferente).
- `tests/hostile-page.test.js` — um `response.end('…')` longo, quebrado em 3 linhas.

**Correção:** `npm run format` — o script do próprio projeto.

### Prova de que nenhuma lógica mudou

Comparei os **token streams** (ignorando espaços, comentários e vírgulas finais) do zip
original vs. o corrigido:

```
perception.js                TOKEN-IDENTICAL (formatting only)
tests/hostile-page.test.js   TOKEN-IDENTICAL (formatting only)
tests/smoke.test.js          DIFFERS  ← única mudança de lógica (o teste novo)
```

Ou seja: **um único ficheiro do projeto teve mudança semântica**, e foi uma adição.

---

## 4. Ficheiros alterados (10 no total)

| Ficheiro                             | Tipo                           | Lógica alterada? |
| ------------------------------------ | ------------------------------ | ---------------- |
| `UserEye/tests/smoke.test.js`        | **+1 teste** (correção do bug) | Sim — aditiva    |
| `UserEye/perception.js`              | formatação                     | Não              |
| `UserEye/tests/hostile-page.test.js` | formatação                     | Não              |
| `UserEye/docs/ARCHITECTURE.md`       | formatação                     | Não              |
| `UserEye/docs/AUDITS.md`             | formatação                     | Não              |
| `UserEye/docs/CHANGELOG.md`          | formatação                     | Não              |
| `UserEye/docs/CLI.md`                | formatação                     | Não              |
| `UserEye/docs/OPERATIONS.md`         | formatação                     | Não              |
| `UserEye/docs/README.md`             | formatação                     | Não              |
| `UserEye/docs/ROADMAP.md`            | formatação                     | Não              |

Nenhum ficheiro foi apagado ou renomeado. Nenhuma dependência foi mexida.

---

## 5. Estado final verificado

`npm run verify` (lint → format → typecheck → test → checks → coverage) — **exit 0**:

```
eslint .                     sem erros
prettier --check .           All matched files use Prettier code style!
tsc --noEmit                 sem erros
node --test tests/*.test.js  437 tests · 434 pass · 0 fail · 3 skipped

sync-version:      OK — 7.5.1 single-sourced from package.json
api-surface:       OK — 21 runtime exports, UserEye type cobre 55 membros
readme-check:      OK — 17 blocos de código parseiam
playwright-check:  OK — package.json=1.63.0 lock=1.63.0 docker=v1.63.0-noble
package-check:     OK — 83 ficheiros, 270.6 kB (teto 280 kB)
delivery-names:    OK — 7.5.1 consistente em package.json, CLI, CURRENT.md, DELIVERY.md
dependency-check:  OK — axe-core@4.13.0, playwright@1.63.0 (ambos pinned)
config-docs:       OK      api-docs: OK
coverage-gate:     OK — all floors satisfied (overall 87.83%, floor 45%)
```

### Os 3 skips são do ambiente, não bugs

```
SKIP firefox not installed (npx playwright install firefox)
SKIP webkit not installed  (npx playwright install webkit)
SKIP tree is dirty; reproducibility is not claimed
```

Exatamente o que o `CURRENT.md` já previa. Instala firefox/webkit e os 2 primeiros correm.

### `doctor`

```
[ok] node-version 20.20.2   [ok] playwright 1.63.0 (pinned)
[ok] browser-chromium       [ok] config-loads / config-keys
[ok] code-execution-boundary: npmScripts=false binaries=false install=false
[ok] artifacts-writable
[warn] browser-matrix: só chromium instalado
All required checks passed.
```

### Execução real contra servidor live

```
node demo/live-server.js            → live-server on :4200
node bin/usereye.js auto --url http://127.0.0.1:4200/vela/ --mode quick

[PASS] 01 Open target application (325 ms)
[PASS] 02 Adaptive exploration — quick (2555 ms)
[PASS] 03 Concurrent protocols — quick (2167 ms)
[PASS] 04 Code quality and final quality floor (1 ms)

Quality: 100/100 · states 2 · URLs 2 · Issues 0 · gates PASS · exit 0
```

---

## 6. Avaliação do projeto — 9.2 / 10

**Pontos fortes reais (não elogio vazio):**

- **Honestidade de medição.** O gate que apanhou o teu próprio bug (`sync-version`) é
  um projeto a policiar-se a si mesmo. A regra de que a linha `**Tests:**` é escrita por
  um run real e nunca digitada à mão é rara e madura.
- **Fronteira de execução de código.** `shell: true` removido, nada do repo alvo corre
  sem `--allow-project-commands`, e tudo fica auditado em `result.json#commandAudit`.
  Isto é postura de segurança séria para uma ferramenta que aponta a código alheio.
- **Coverage com pisos por camada** (`honest` 85%, `core` 70%, `engine` 40%) em vez de um
  número global cosmético.
- **437 testes** com fixtures reais (SPA, Django, Next, consent walls, páginas hostis).
- Dependências **pinned**, versão Playwright verificada contra o lockfile _e_ o Dockerfile.
- Contrato de exit codes estável (`0 | 1 | 2`), i18n completo (en/es/fr/pt), tipos TS.

**O que trava a nota:**

- **-0.5** — o gate `sync-version` exigia um teste que não existia. Ironia: a
  infraestrutura de qualidade estava certa, o artefacto é que tinha ficado para trás.
  Sugestão: `npm run verify` num pre-commit hook teria apanhado isto antes do zip.
- **-0.2** — `format:check` faz parte do `verify`, mas o zip foi entregue com 9 ficheiros
  fora do padrão. Mesma causa raiz: o `verify` completo não correu antes de empacotar.
- **-0.1** — `package.json` é publicável (`private: false`) mas não declara `repository`,
  `homepage` nem `bugs`. O próprio `check-delivery-names` avisa disto.
- Ficheiros `err.txt` e `out.txt` vazios ficaram na raiz de `UserEye/` (lixo de debug).
- `protocols/file.js` com 9.8% de cobertura destoa do resto.

**Veredito:** engenharia acima da média. Não estavas perto de desistir por causa de
código mau — estavas a lutar contra `libnspr4.so`. O bug real era de uma linha.

---

## Como correr (Linux limpo)

```bash
cd UserEye
npm ci
npx playwright install chromium
sudo npx playwright install-deps chromium   # <— o passo que faltava
npm run verify

# demo live
node ../demo/live-server.js                 # terminal 2 → http://127.0.0.1:4200/vela/
node bin/usereye.js auto --url http://127.0.0.1:4200/vela/ --mode quick
```

No Windows o `install-deps` não é preciso (as DLLs vêm com o browser).
