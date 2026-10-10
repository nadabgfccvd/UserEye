# Documentação UserEye 7.5.1

**Créditos:** Revisor Anônimo

Uma pasta: `UserEye/docs/`. Sem `docs/` na raiz do zip, sem `audits/`, `history/` ou `evidence/` separados.

| Ficheiro                           | Conteúdo (fundido de)                              |
| ---------------------------------- | -------------------------------------------------- |
| [CLI.md](CLI.md)                   | Referência de todos os comandos                    |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Runtime, heurísticas, matrix                       |
| [CHANGELOG.md](CHANGELOG.md)       | HISTORY + CHANGELOG + RELEASE*                     |
| [ROADMAP.md](ROADMAP.md)           | Todos os ROADMAP-* e execution-plan                |
| [AUDITS.md](AUDITS.md)             | Auditorias + evidência + history reports           |
| [OPERATIONS.md](OPERATIONS.md)     | CURRENT + DELIVERY + README do zip                 |
| [CONFIG.md](CONFIG.md)             | Gerado de DEFAULT_CONFIG — não editar à mão        |
| [API.md](API.md)                   | Gerado da superfície pública — não editar à mão    |
| [HEURISTICS.md](HEURISTICS.md)     | Triagem, padrões aceitos e critérios de heurística |
| [PLUGINS.md](PLUGINS.md)           | Contrato de plugins                                |

Fora de `docs/` (convenção GitHub / npm / gates):

| Ficheiro                                         | Porquê na raiz do pacote                             |
| ------------------------------------------------ | ---------------------------------------------------- |
| `UserEye/README.md`                              | Manual do produto (`npm` mostra este)                |
| `UserEye/HISTORY.md`                             | Gate `check-delivery-names` / `sync-version`         |
| `UserEye/SECURITY.md`                            | GitHub Security                                      |
| `UserEye/CONTRIBUTING.md`                        | GitHub contributing                                  |
| `CURRENT.md` / `DELIVERY.md` / `README.md` (zip) | Gates de packing; conteúdo completo em OPERATIONS.md |
| `.github/*.md`, `.changeset/README.md`           | Templates de processo, não manual                    |

## Mapa do código (primeira linha → última)

Entrada CLI: `bin/usereye.js` → `observe` (`usereye-observe.js`), `auto`/`analyze` (`usereye-auto.js`), `doctor`, `init`, `auth`, `dashboard`, `export-issues`, `install-browsers`, `--self-test`.

Motor: `user-eye.js` (browser, steps, evidência). Exploração: `adaptive-explorer.js`. Config: `config.js`. Protocolos: `protocols/`. Review modes: `review-modes/`. Relatórios: `report.js`, `sarif.js`. Fronteira de execução: `command-runner.js`.

Biblioteca: `index.js` + `types/`. Testes: `tests/*.test.js`. Empacotamento: `scripts/`.
