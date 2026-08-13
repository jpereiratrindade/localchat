import fnmatch
import json
import os
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path
from typing import Any

import requests
from flask import Flask, Response, jsonify, render_template, request, stream_with_context

app = Flask(__name__)

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "")
MODEL_PROFILES_PATH = Path(
    os.environ.get("LOCALCHAT_MODEL_PROFILES", Path(__file__).with_name("model_profiles.json"))
)


def ollama_get(path: str, timeout: int = 5) -> requests.Response:
    return requests.get(f"{OLLAMA_BASE_URL}{path}", timeout=timeout)


def ollama_post(path: str, *, payload: dict[str, Any], timeout: int = 10) -> requests.Response:
    return requests.post(f"{OLLAMA_BASE_URL}{path}", json=payload, timeout=timeout)


@lru_cache(maxsize=1)
def load_model_profiles() -> list[dict[str, Any]]:
    try:
        payload = json.loads(MODEL_PROFILES_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []

    profiles = payload.get("profiles", []) if isinstance(payload, dict) else []
    return [item for item in profiles if isinstance(item, dict)]


def resolve_model_profile(name: str) -> dict[str, Any]:
    for profile in load_model_profiles():
        pattern = str(profile.get("match") or "").strip()
        if pattern and fnmatch.fnmatch(name, pattern):
            return {
                key: value
                for key, value in profile.items()
                if key in {"label", "category", "description", "tags"}
            }
    return {}


def extract_context_length(model_info: Any) -> int | None:
    if not isinstance(model_info, dict):
        return None

    architecture = model_info.get("general.architecture")
    if isinstance(architecture, str):
        primary = model_info.get(f"{architecture}.context_length")
        if isinstance(primary, int) and primary > 0:
            return primary

    values = []
    for key, value in model_info.items():
        if str(key).endswith(".context_length") and isinstance(value, int) and value > 0:
            values.append(value)

    return max(values) if values else None


def sanitize_options(raw: Any) -> dict[str, int | float]:
    if not isinstance(raw, dict):
        return {}

    cleaned: dict[str, int | float] = {}

    numeric_ranges: dict[str, tuple[float, float]] = {
        "temperature": (0.0, 2.0),
        "top_p": (0.0, 1.0),
    }
    integer_ranges: dict[str, tuple[int, int]] = {
        "seed": (-1, 2_147_483_647),
        "num_ctx": (256, 1_048_576),
        "num_predict": (1, 131_072),
    }

    for key, (minimum, maximum) in numeric_ranges.items():
        value = raw.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            cleaned[key] = max(minimum, min(maximum, float(value)))

    for key, (minimum, maximum) in integer_ranges.items():
        value = raw.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            cleaned[key] = max(minimum, min(maximum, value))

    return cleaned


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

        items = [item for item in payload.get("models", []) if isinstance(item, dict)]

        def enrich_model(item: dict[str, Any]) -> dict[str, Any] | None:
            name = item.get("name") or item.get("model")
            if not name:
                return None

            show_payload: dict[str, Any] = {}
            try:
                show_response = ollama_post("/api/show", payload={"model": name}, timeout=8)
                show_response.raise_for_status()
                parsed = show_response.json()
                if isinstance(parsed, dict):
                    show_payload = parsed
            except (requests.RequestException, ValueError):
                # A listagem continua útil mesmo em versões antigas do Ollama
                # ou quando um modelo específico não responde ao /api/show.
                pass

            details = item.get("details") if isinstance(item.get("details"), dict) else {}
            show_details = (
                show_payload.get("details") if isinstance(show_payload.get("details"), dict) else {}
            )
            merged_details = {**details, **show_details}

            capabilities = show_payload.get("capabilities", [])
            if not isinstance(capabilities, list):
                capabilities = []
            capabilities = [str(value) for value in capabilities]

            # /api/show moderno distingue completion de embedding. Sem essa
            # informação, preservamos compatibilidade e tratamos o modelo como chat.
            chat_capable = "completion" in capabilities if capabilities else True

            return {
                "name": name,
                "size": item.get("size"),
                "modified_at": item.get("modified_at"),
                "digest": item.get("digest"),
                "details": merged_details,
                "capabilities": capabilities,
                "context_length": extract_context_length(show_payload.get("model_info")),
                "chat_capable": chat_capable,
                "profile": resolve_model_profile(str(name)),
            }

        if not items:
            return jsonify({"models": [], "default_model": DEFAULT_MODEL})

        # /api/show é uma chamada local e independente por modelo. Fazemos as
        # consultas em paralelo para não transformar 20 modelos em 20 esperas
        # sequenciais na abertura da interface.
        max_workers = min(8, len(items))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            enriched = list(executor.map(enrich_model, items))

        model_list = [item for item in enriched if item is not None]
        return jsonify({"models": model_list, "default_model": DEFAULT_MODEL})
    except (requests.RequestException, ValueError) as exc:
        return jsonify({"error": f"Não foi possível consultar o Ollama: {exc}"}), 503


@app.post("/api/chat")
def chat():
    data: dict[str, Any] = request.get_json(silent=True) or {}

    model = str(data.get("model") or DEFAULT_MODEL).strip()
    messages = data.get("messages")
    system_prompt = str(data.get("system_prompt") or "").strip()
    options = sanitize_options(data.get("options"))

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

    payload: dict[str, Any] = {
        "model": model,
        "messages": clean_messages,
        "stream": True,
    }
    if options:
        payload["options"] = options

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
