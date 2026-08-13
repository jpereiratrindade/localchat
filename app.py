import json
import os
from typing import Any

import requests
from flask import Flask, Response, jsonify, render_template, request, stream_with_context

app = Flask(__name__)

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "")


def ollama_get(path: str, timeout: int = 5) -> requests.Response:
    return requests.get(f"{OLLAMA_BASE_URL}{path}", timeout=timeout)


@app.get("/")
def index():
    return render_template("index.html", default_model=DEFAULT_MODEL)


@app.get("/api/health")
def health():
    try:
        response = ollama_get("/api/tags")
        response.raise_for_status()
        return jsonify({"ok": True, "ollama": OLLAMA_BASE_URL})
    except requests.RequestException as exc:
        return jsonify({"ok": False, "error": str(exc), "ollama": OLLAMA_BASE_URL}), 503


@app.get("/api/models")
def models():
    try:
        response = ollama_get("/api/tags")
        response.raise_for_status()
        payload = response.json()

        model_list = []
        for item in payload.get("models", []):
            name = item.get("name") or item.get("model")
            if name:
                model_list.append(
                    {
                        "name": name,
                        "size": item.get("size"),
                        "modified_at": item.get("modified_at"),
                    }
                )

        return jsonify({"models": model_list, "default_model": DEFAULT_MODEL})
    except (requests.RequestException, ValueError) as exc:
        return jsonify({"error": f"Não foi possível consultar o Ollama: {exc}"}), 503


@app.post("/api/chat")
def chat():
    data: dict[str, Any] = request.get_json(silent=True) or {}

    model = str(data.get("model") or DEFAULT_MODEL).strip()
    messages = data.get("messages")
    system_prompt = str(data.get("system_prompt") or "").strip()

    if not model:
        return jsonify({"error": "Selecione um modelo do Ollama."}), 400

    if not isinstance(messages, list) or not messages:
        return jsonify({"error": "A conversa está vazia."}), 400

    clean_messages = []
    if system_prompt:
        clean_messages.append({"role": "system", "content": system_prompt})

    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        content = msg.get("content")
        if role in {"user", "assistant", "system"} and isinstance(content, str):
            clean_messages.append({"role": role, "content": content})

    payload = {
        "model": model,
        "messages": clean_messages,
        "stream": True,
    }

    def generate():
        try:
            with requests.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json=payload,
                stream=True,
                timeout=(10, 600),
            ) as upstream:
                upstream.raise_for_status()

                for line in upstream.iter_lines(decode_unicode=True):
                    if line:
                        if isinstance(line, bytes):
                            line = line.decode("utf-8", errors="replace")
                        yield line + "\n"

        except requests.RequestException as exc:
            yield json.dumps(
                {
                    "done": True,
                    "error": f"Falha ao conversar com o Ollama: {exc}",
                },
                ensure_ascii=False,
            ) + "\n"

    return Response(
        stream_with_context(generate()),
        content_type="application/x-ndjson; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    host = os.environ.get("LOCALCHAT_HOST", "127.0.0.1")
    port = int(os.environ.get("LOCALCHAT_PORT", "5000"))
    app.run(host=host, port=port, debug=False, threaded=True)
