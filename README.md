# UserEye

**Percepção de browser agnóstica de projeto, acessibilidade e testes exploratórios seguros para qualquer aplicação web.**

UserEye abre uma aplicação web real, observa o que um usuário vê, explora caminhos seguros, checa acessibilidade e resiliência — e deixa evidência reproduzível: HTML, Markdown, JSON, trace, screenshot, vídeo e SARIF opcional.

- **Versão:** 7.5.1 · MIT · Node.js >= 20.11 · Playwright 1.63.0 (pinned)
- **Suite atual:** 446 testes · 442 pass · 0 fail · 4 skip ([relatório](tests/usereye_test_report.md))
- **Status:** pacote funcional, ainda não publicado no npm ([ROADMAP](ROADMAP.md) M1)

---

## Layout do repositório

```text
.
├── ROADMAP.md         ← rumo do projeto (visão, marcos, pesquisa) — revisão trimestral
├── MISSION.md         ← missão e próximas ações
├── DECISIONS.md       ← log de decisões (data + rationale)
├── README.md          ← este arquivo
├── CURRENT.md         ← status da entrega 7.5.1 (gerado por verify:delivery)
├── DELIVERY.md        ← inventário/runbook do bundle 7.5.1
├── src/usereye/       ← O PACOTE npm (runtime, testes, types, docs do produto)
├── demo/              ← harness: site demo Vela, live-server, probes (não publicado)
├── docs/              ← docs do repositório (índice, pesquisa, prioridades)
├── tests/             ← relatórios de teste E2E reais + script e2e
└── scripts/           ← utilitários do repositório (bootstrap, etc.)
```

> Documentação completa do produto: **[`src/usereye/docs/README.md`](src/usereye/docs/README.md)** — CLI, arquitetura, heurísticas, config, plugins, auditorias.

## Instalação

Requisitos: Node.js >= 20.11 (testado em 20.x e 24.x), npm >= 10.

```bash
git clone https://github.com/nadabgfccvd/UserEye.git
cd UserEye/src/usereye
npm ci
npx playwright install chromium        # bare Linux: + sudo npx playwright install-deps chromium
node bin/usereye.js doctor             # diagnóstico do ambiente
npm test                               # suíte completa (446 testes)
```

Ou via script de bootstrap:

```bash
./scripts/bootstrap.sh
```

## Uso (60 segundos)

```bash
# terminal 1 — site demo
node demo/live-server.js               # http://127.0.0.1:4200

# terminal 2 — auditoria exploratória
cd src/usereye
node bin/usereye.js auto --url http://127.0.0.1:4200/vela/ --mode quick
```

Comandos principais: `auto` (exploração ponta a ponta), `observe` (só observação),
`analyze` (análise estática do projeto), `doctor`, `--self-test`.
Referência completa: [`src/usereye/docs/CLI.md`](src/usereye/docs/CLI.md).

```bash
node bin/usereye.js auto --browser firefox ...   # chromium (default) | firefox | webkit
node bin/usereye.js auto ... --review-mode a11y-strict
node bin/usereye.js observe --fail-on major
```

## Como contribuir

Leia [`CONTRIBUTING.md`](CONTRIBUTING.md). Resumo:

1. Abra uma issue descrevendo o problema/proposta (ver [issues abertas](https://github.com/nadabgfccvd/UserEye/issues)).
2. Fork → branch → `npm ci` → mudança → `npm test` + `npm run lint` verdes.
3. PR descrevendo **o quê** e **por quê**; um PR = uma preocupação.
4. Decisões com impacto arquitetural: registre em [`DECISIONS.md`](DECISIONS.md).
5. Roadmap: mudanças de direção passam por issue + atualização de [`ROADMAP.md`](ROADMAP.md) (data + rationale).

## Governança de documentos (para agentes futuros)

- `ROADMAP.md` fica **sempre na raiz**; ao modificar, atualize o campo `Última revisão` e vincule issues.
- Toda decisão importante entra em `DECISIONS.md` com **data + contexto + rationale + alternativas descartadas**.
- Revisão trimestral do roadmap: ajustar marcos, re-classificar prioridades, atualizar áreas de pesquisa.
- Números de teste no `CURRENT.md`/`DELIVERY.md` são reescritos por `npm run verify:delivery` — nunca digitados à mão.

## Licença

MIT — veja [`src/usereye/LICENSE`](src/usereye/LICENSE).
