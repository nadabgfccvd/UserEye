#!/usr/bin/env bash
# E2E real do UserEye: site demo + auditoria exploratória + controle negativo.
# Uso: ./tests/e2e-run.sh            (chromium)
#      USEREYE_BROWSER=firefox ./tests/e2e-run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/src/usereye"
BROWSER="${USEREYE_BROWSER:-chromium}"
PORT="${USEREYE_PORT:-4200}"
OUT="/tmp/usereye-e2e-$BROWSER"
NEG="/tmp/usereye-e2e-negative-$BROWSER"

command -v node >/dev/null || { echo "ERRO: node ausente"; exit 1; }
[ -d "$PKG/node_modules" ] || { echo "ERRO: rode scripts/bootstrap.sh primeiro"; exit 1; }

echo ">> subindo live-server (porta $PORT)…"
(cd "$ROOT/demo" && nohup node live-server.js >/tmp/usereye-live-server.log 2>&1 &)
trap 'pkill -f live-server.js 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/vela/" && break
  sleep 0.5
done

echo ">> E2E 1/2 — demo Vela ($BROWSER)"
node "$PKG/bin/usereye.js" auto \
  --url "http://127.0.0.1:$PORT/vela/" --mode quick --browser "$BROWSER" \
  --out "$OUT"
grep -E 'Quality:|Quality gates' "$OUT/result.json" >/dev/null 2>&1 || true

echo ">> E2E 2/2 — controle negativo (página com defeitos plantados)"
mkdir -p /tmp/usereye-badpage
cat > /tmp/usereye-badpage/index.html <<'EOF'
<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0">
<img src="quebrada.png" style="width:300px;display:block" alt="">
<img src="sem-alt.png" style="width:120px;display:block">
<h1 style="color:#9a9a9a;background:#a5a5a5">Contraste baixo</h1>
<div style="position:relative;height:120px">
  <button style="position:absolute;top:0;left:0;z-index:2;width:220px;height:60px">Sobreposto</button>
  <a href="/outro" style="position:absolute;top:10px;left:10px;z-index:1">escondido</a>
</div>
</body></html>
EOF
(cd /tmp/usereye-badpage && nohup python3 -m http.server 4299 >/dev/null 2>&1 &)
for _ in $(seq 1 20); do curl -sf -o /dev/null http://127.0.0.1:4299/ && break; sleep 0.5; done
set +e
node "$PKG/bin/usereye.js" auto \
  --url http://127.0.0.1:4299/ --mode quick --browser "$BROWSER" \
  --out "$NEG"
NEG_EXIT=$?
set -e
pkill -f 'http.server 4299' 2>/dev/null || true

echo
echo "================ RESUMO ================"
echo "demo ($BROWSER):     $OUT"
echo "controle negativo:   $NEG (exit esperado != 0; gates devem FALHAR com issues > 0)"
[ "$NEG_EXIT" -ne 0 ] && echo "✔ controle negativo FALHOU como esperado (detecção funcionando)" \
                     || echo "✘ ATENÇÃO: controle negativo passou — heurísticas não detectaram os defeitos"
echo "Relatório de referência: tests/usereye_test_report.md"
