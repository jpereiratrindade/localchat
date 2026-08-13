#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -x .venv/bin/python ]]; then
  PYTHON=.venv/bin/python
else
  PYTHON="${PYTHON:-python3}"
fi

echo "==> Dependências Python"
"$PYTHON" - <<'PY'
from importlib.metadata import version
import requests
print(f"Flask: {version('flask')}")
print(f"requests: {requests.__version__}")
PY

echo
echo "==> Sintaxe Python"
"$PYTHON" -m py_compile app.py

echo
echo "==> JSON de perfis"
"$PYTHON" -m json.tool model_profiles.json >/dev/null

echo
echo "==> Testes unitários"
"$PYTHON" -m unittest discover -s tests -v

if command -v node >/dev/null 2>&1; then
  echo
  echo "==> Sintaxe JavaScript"
  node --check static/app.js
else
  echo
  echo "[SKIP] node não encontrado; checagem estática do JavaScript não executada."
fi

echo
echo "==> Git whitespace"
git diff --check

echo
echo "[PASS] LocalChat P2 verificado."
