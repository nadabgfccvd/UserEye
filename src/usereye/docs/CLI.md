# UserEye 7.5.1 — CLI reference

**Créditos:** Revisor Anônimo

Fonte de verdade dos menus: as constantes `HELP`, `USAGE`, `INSTALL_USAGE`, `AUTH_USAGE`, `INIT_USAGE`, `DASHBOARD_USAGE`, `EXPORT_USAGE` e o comando `usereye --self-test`. Qualquer flag listada aqui existe no parser (`config.js` `VALUE_FLAGS` / `BOOLEAN_FLAGS`) ou no subcomando correspondente.

Contrato de saída (inalterado):

| Código    | Significado                                    |
| --------- | ---------------------------------------------- |
| 0         | Concluído; gates de qualidade passaram         |
| 1         | Concluído com falhas de qualidade / severidade |
| 2         | Uso inválido ou falha de setup                 |
| 130 / 143 | SIGINT / SIGTERM                               |

```bash
usereye --help
usereye <command> --help
usereye --version          # imprime 7.5.1
usereye --self-test        # asserções in-process; não abre browser
```

Saída esperada de `--version`: uma linha com o valor de `package.json#version`.

Saída esperada de `--help`: o menu global com todos os comandos abaixo.

---

## `observe`

Observação de uma única página. Não explora, não arranca o repositório.

```text
Usage: usereye observe [url] [options]
```

| Flag                                             | Função                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| positional URL / `--url`                         | Alvo                                                                                                                                                          |
| `--config <path>`                                | JS, MJS, CJS ou JSON                                                                                                                                          |
| `--mobile`                                       | Viewport 390×844                                                                                                                                              |
| `--viewport <WxH>`                               | Viewport explícito                                                                                                                                            |
| `--headed`                                       | Janela visível                                                                                                                                                |
| `--browser <name>`                               | chromium (default), firefox, webkit                                                                                                                           |
| `--axe`                                          | Corre axe-core                                                                                                                                                |
| `--locale` `--timezone` `--color-scheme`         | Contexto do browser                                                                                                                                           |
| `--storage-state <path>`                         | Playwright storageState                                                                                                                                       |
| `--wait <ms>`                                    | Espera após load (default 500)                                                                                                                                |
| `--navigation-timeout` `--retries` `--min-delay` | Resiliência                                                                                                                                                   |
| `--out <dir>`                                    | Artefactos                                                                                                                                                    |
| `--keep-last <n>`                                | Retenção local                                                                                                                                                |
| `--report-locale` `--report-format`              | Relatório                                                                                                                                                     |
| `--ignore-https-errors`                          | TLS                                                                                                                                                           |
| `--video` / `--video-on-failure` / `--no-video`  | Política de vídeo (default on-failure)                                                                                                                        |
| `--trace <policy>`                               | on-failure \| always \| never                                                                                                                                 |
| `--fail-on <level>`                              | never \| minor \| major \| critical \| blocker. Omitir: qualquer achado não opinativo sai 1. Padrões aceitos não derrubam CI; erros do browser sempre saem 1. |
| `--log-level` `--log-json`                       | Observabilidade                                                                                                                                               |
| `-h, --help`                                     | Este menu; **antes** de carregar config                                                                                                                       |

Exemplos:

```bash
usereye observe https://example.com --axe --out artifacts/usereye
usereye observe --url http://127.0.0.1:4200/vela/ --axe --report-locale pt-BR --fail-on major
```

Saída esperada (stdout, nível `info`):

```text
UserEye observation: http://…
Controls: N
Visual findings: N
Issues: N
Unexpected browser errors: N
Artifacts: <dir>
```

---

## `auto`

Exploração adaptativa de um URL ou repositório. Escreve evidência + gates.

Todas as flags de `VALUE_FLAGS` / `BOOLEAN_FLAGS` aplicáveis a `auto` estão no `USAGE` do comando (`usereye auto --help`), incluindo:

`--config --project --app-dir --url --command --mode --review-mode --flows --install --email --username --password --storage-state --allow-write --allow-destructive --allow-downloads --protocols --workers --out --keep-last --compare --profile --browser --retries --navigation-timeout --dialog-timeout --min-delay --analyze --dry-run --no-axe --no-code-quality --video --video-on-failure --no-video --trace --misclick-policy --allow-project-commands --log-level --log-json --timings --headed --env --locale --timezone --color-scheme --viewport --mobile --report-locale --report-format --startup-timeout --protocol-timeout --code-quality-timeout --min-score --max-blocker --max-critical --max-browser-errors --seed --block-path --block-name --pattern-pack --keep --ignore-https-errors --no-ignore-query-params --axe`

`--review-mode normal|perf-seo|flows|a11y-strict` selecciona o runner; `--mode quick|standard|deep` continua a ser o orçamento do explorador.

`--allow-project-commands` (default: nenhum) é a fronteira de execução de código: sem ela, `--project` é análise estática.

Exemplos:

```bash
usereye auto --url http://127.0.0.1:4200/vela/ --mode quick --out artifacts/vela-quick
usereye auto --project . --mode standard --allow-project-commands lint,typecheck
usereye auto --review-mode a11y-strict --url http://127.0.0.1:4200/vela/
usereye auto --url https://staging.example --mode deep --dry-run
```

### API de `flows`

O escopo `run({ eye, page, expect })` inclui assertions nativas:

```js
await expect(page).text('#timeDisplay', '25:00');
await expect(page).text('#atMeta', 'concluída', { contains: true, timeout: 5000 });
await expect(page).count('#taskList .task-item', 3);
await eye.waitText('#statMin', '50', { timeout: 5000 });
await eye.waitFor(() => document.title.length > 0, { timeout: 90000 });
```

`text` compara o conteúdo com `trim()`; `contains: true` usa substring. `count` espera
a cardinalidade exata. `eye.waitFor(fn, { timeout, polling, arg })` encaminha para
`page.waitForFunction(fn, arg, options)`: as opções ficam sempre no terceiro argumento,
portanto `{ timeout }` nunca é confundido com `ARG`.

Saída esperada (bloco final):

```text
=== UserEye ===
Quality: N/100 · states: N · URLs: N
Coverage: N% · protocols failed: N
Issues: N · unexpected browser errors: N
Actionable: N · Signals: N
… gates: PASS|FAIL
Artifacts: <dir> (<size>, N files)
```

---

## `analyze`

Detecção + `plan.json` apenas. Sem browser. Menu próprio (`Usage: usereye analyze`), não o menu de `auto`.

```text
Usage: usereye analyze [options]
```

Flags: `--project --app-dir --url --config --mode --out --allow-project-commands --pattern-pack --profile --protocols`.

```bash
usereye analyze --project ./apps/web --out artifacts/plan
usereye analyze --help
```

Exit 0 escreveu o plano; 2 uso/setup.

---

## `doctor`

Preflight de ambiente. Não substitui `--self-test`.

```text
Usage: usereye doctor [options]
  --url --project --config --json --update-check -h/--help
Exit: 0 saudável · 2 pelo menos um check required falhou.
```

Checks required: `node-version`, `playwright-installed`, `browser-chromium`, `config-loads`, `artifacts-writable`, e `target-reachable` se `--url` for passado.

---

## `install-browsers`

```text
Usage: usereye install-browsers [chromium|firefox|webkit|all ...]
```

Sem argumentos instala chromium. `--help` **não** dispara download.

---

## `gc`

```text
Usage: usereye gc [artifacts-dir] --older-than <age> [--dry-run]
```

Remove somente diretórios que contêm um `result.json` do UserEye e são mais antigos
que a idade (`12h`, `7d`, `4w`). A raiz informada nunca é removida; diretórios sem
`result.json` e symlinks não são tocados. Use `--dry-run` para listar antes de apagar.
Para retenção contínua durante novas execuções, `--keep-last N` mantém apenas as N
rodadas anteriores em `<out>-history/`.

---

## `dashboard`

```text
Usage: usereye dashboard [artifacts-dir] [--port <n>] [--host <addr>]
```

Default: `artifacts/usereye`, porta 4174, bind `127.0.0.1`. Índice read-only com guarda de path traversal.

Saída: `UserEye dashboard: http://127.0.0.1:<port>/ (serving <root>)`

---

## `export-issues`

```text
Usage: usereye export-issues <result.json|artifacts-dir> --format github|jira|linear
  --severity blocker,critical  --project <jira key>  --labels …  --out <file>
```

---

## `init`

```text
Usage: usereye init [dir] [--workflow] [--no-gitignore]
```

Recusa overwrite de `usereye.config.js` existente (exit 2).

---

## `auth save`

```text
Usage: usereye auth save --url <app> --out <file.json> [options]
  --email/--username/--password --headed/--headless --submit --navigate-to
  --wait-ms --browser --timeout
```

`--help` não exige `--url`. Exit 0 gravado; 1 login incompleto; 2 uso/setup.

---

## `--self-test` / `self-test` / `diag`

Asserções in-process: versão, HELP vs `COMMANDS`, carga dos módulos, defaults calmos, contrato `observeExitCode`, `--help` de cada subcomando, comando desconhecido → 2.

```bash
usereye --self-test
usereye self-test --json
usereye diag
```

Não lança browser. Para Chromium/config/URL use `doctor`.

---

## Códigos de ambiente relevantes

`USEREYE_CONFIG`, `USEREYE_BASE_URL`, `USEREYE_MODE`, `USEREYE_REVIEW_MODE`, `USEREYE_STORAGE_STATE`, `USEREYE_LOCALE`, `USEREYE_TIMEZONE`, `USEREYE_COLOR_SCHEME`, `USEREYE_REPORT_LOCALE`, `USEREYE_OUT_DIR`, `USEREYE_BROWSER`, `USEREYE_LOG_LEVEL`, `USEREYE_EMAIL`, `USEREYE_USERNAME`, `USEREYE_PASSWORD`, `USEREYE_PROFILE`, `USEREYE_STRICT_CONFIG=1`.
