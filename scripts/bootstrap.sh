#!/usr/bin/env bash
# Bootstrap do ambiente de desenvolvimento UserEye.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/src/usereye"

echo ">> node: $(node --version)"
echo ">> npm:  $(npm --version)"

cd "$PKG"
echo ">> npm ci…"
npm ci

echo ">> browsers do Playwright (chromium; firefox opcional)…"
npx playwright install chromium

echo ">> diagnóstico do engine…"
node bin/usereye.js doctor || true

echo ">> suíte de testes…"
npm test

echo
echo "OK. Próximos passos:"
echo "  node demo/live-server.js            # (na raiz do repo) sobe o site demo"
echo "  node bin/usereye.js auto --url http://127.0.0.1:4200/vela/ --mode quick"
echo "  ../../tests/e2e-run.sh              # E2E completo + controle negativo"
