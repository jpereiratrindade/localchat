#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
LOCALCHAT_HOST="${LOCALCHAT_HOST:-127.0.0.1}"
LOCALCHAT_PORT="${LOCALCHAT_PORT:-5000}"

if [[ ! -d ".venv" ]]; then
  echo "Ambiente virtual não encontrado. Rode novamente o setup."
  exit 1
fi

source .venv/bin/activate

if curl -fsS "$OLLAMA_BASE_URL/api/tags" >/dev/null 2>&1; then
  echo "✓ Ollama conectado em $OLLAMA_BASE_URL"
else
  echo "⚠ Ollama não respondeu em $OLLAMA_BASE_URL"
  echo "  Em outro terminal, tente: ollama serve"
  echo "  O LocalChat será iniciado mesmo assim."
fi

echo "✓ LocalChat: http://$LOCALCHAT_HOST:$LOCALCHAT_PORT"
echo "  Ctrl+C para encerrar."
echo

export OLLAMA_BASE_URL LOCALCHAT_HOST LOCALCHAT_PORT
exec python app.py
