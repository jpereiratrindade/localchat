import json
import unittest
from unittest.mock import MagicMock, patch

import app as localchat


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise localchat.requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class LocalChatTests(unittest.TestCase):
    def setUp(self):
        localchat.app.config.update(TESTING=True)
        self.client = localchat.app.test_client()

    def test_sanitize_options_restricts_keys_and_ranges(self):
        result = localchat.sanitize_options(
            {
                "temperature": 9,
                "top_p": -1,
                "seed": 42,
                "num_ctx": 128,
                "num_predict": 999999,
                "unknown": "ignored",
            }
        )
        self.assertEqual(result["temperature"], 2.0)
        self.assertEqual(result["top_p"], 0.0)
        self.assertEqual(result["seed"], 42)
        self.assertEqual(result["num_ctx"], 256)
        self.assertEqual(result["num_predict"], 131072)
        self.assertNotIn("unknown", result)

    def test_extract_context_length_uses_largest_context(self):
        info = {
            "model.context_length": 32768,
            "model.vision.context_length": 4096,
            "other": "ignored",
        }
        self.assertEqual(localchat.extract_context_length(info), 32768)

    @patch("app.ollama_post")
    @patch("app.ollama_get")
    def test_models_marks_embedding_as_not_chat_capable(self, get_mock, post_mock):
        get_mock.return_value = FakeResponse(
            {
                "models": [
                    {
                        "name": "nomic-embed-text:latest",
                        "size": 123,
                        "digest": "abc",
                        "details": {"parameter_size": "137M"},
                    }
                ]
            }
        )
        post_mock.return_value = FakeResponse(
            {
                "capabilities": ["embedding"],
                "details": {"family": "nomic-bert"},
                "model_info": {"nomic-bert.context_length": 8192},
            }
        )

        response = self.client.get("/api/models")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        model = payload["models"][0]
        self.assertFalse(model["chat_capable"])
        self.assertEqual(model["context_length"], 8192)
        self.assertEqual(model["profile"]["category"], "embedding")

    @patch("app.requests.post")
    def test_chat_forwards_sanitized_options(self, post_mock):
        upstream = MagicMock()
        upstream.__enter__.return_value = upstream
        upstream.__exit__.return_value = False
        upstream.raise_for_status.return_value = None
        upstream.iter_lines.return_value = [
            json.dumps(
                {
                    "message": {"role": "assistant", "content": "ok"},
                    "done": True,
                    "eval_count": 1,
                    "eval_duration": 1_000_000_000,
                }
            )
        ]
        post_mock.return_value = upstream

        response = self.client.post(
            "/api/chat",
            json={
                "model": "qwen2.5:3b",
                "messages": [{"role": "user", "content": "teste"}],
                "options": {"temperature": 0.25, "evil": "no"},
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('"eval_count": 1', body)
        sent_payload = post_mock.call_args.kwargs["json"]
        self.assertEqual(sent_payload["options"], {"temperature": 0.25})


if __name__ == "__main__":
    unittest.main()
